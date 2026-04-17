import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as messagingApi from "npm:@line/bot-sdk"

const { MessagingApiClient } = messagingApi.messagingApi;

// 1. 環境變數設定
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get('TIMELOG_LINE_TOKEN') || '';
const LINE_CHANNEL_SECRET = Deno.env.get('TIMELOG_LINE_SECRET') || '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || '';

// 優先順序：Gemini 1.5 Pro (針對複雜分析) > Pro (穩定) > Flash (快速)
const GEMINI_MODEL = "gemini-1.5-pro"; 

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

const lineClient = new MessagingApiClient({
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN
});

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    console.log("Receiving Request:", JSON.stringify(body));

    // 1. 手動觸發分析 (用於前端 API 呼叫)
    if (body.action === 'analyze_data' || body.action === 'generate_report_v2') {
      const report = await generateAIDataReport(body);
      return new Response(JSON.stringify({ report }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // 2. Cron 排程或是 LINE 推播觸發
    if (body.type === 'cron_trigger' || body.action === 'generate_report') {
      return await handleWeeklyReport();
    }

    // 3. 處理 LINE Webhook 事件
    if (body.events) {
      for (const event of body.events) {
        if (event.type === 'message' && event.message.type === 'text') {
          await handleLineMessage(event);
        }
      }
      return new Response(JSON.stringify({ message: 'ok' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Invalid Request Intent' }), { status: 400 });

  } catch (err) {
    console.error("Critical Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function handleLineMessage(event: any) {
  const lineId = event.source.userId;
  const userText = event.message.text.trim();
  const replyToken = event.replyToken;

  // 1. 驗證權限 (查詢 prj_settings 中帶有此 LINE ID 的管理者)
  const { data: settings } = await supabase
    .from('prj_settings')
    .select('*')
    .like('description', `%|%|${lineId}`);

  if (!settings || settings.length === 0) {
    return await lineClient.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: "❌ 您尚未獲得查詢權限。請在管理台設定您的 LINE ID 並聯繫系統管理員。" }]
    });
  }

  const today = new Date().toLocaleDateString('zh-TW');
  
  // 2. 意圖分析 (AI 解析使用者想要看什麼)
  const intentPrompt = `你是一個專業的資深助理意圖分析員。請分析使用者輸入的指令，並回傳格式嚴格的 JSON。
今天日期是：${today}

可用 Action 類型：
- "PROJECT_QUERY": 查詢特定專案的工時
- "ENGINEER_QUERY": 查詢特定人員的工時
- "GENERAL_SUMMARY": 查詢全公司或多個專案的總體進度
- "UNKNOWN": 無法理解或純粹聊天

JSON 格式：
{ 
  "action": "...", 
  "projectId": "專案代號(若有)", 
  "engineerName": "人員姓名(若有)", 
  "startDate": "YYYY-MM-DD", 
  "endDate": "YYYY-MM-DD",
  "reasoning": "分析原因" 
}

使用者指令：'${userText}'`;

  try {
    console.log("Gemini Intent Parsing...");
    const intentRaw = await askGemini(intentPrompt, true);
    const intent = JSON.parse(intentRaw.replace(/```json|```/g, '').trim());

    if (intent.action === 'UNKNOWN') {
      const chat = await askGemini(`使用者對你說：'${userText}'，請以一位貼心且專業的專案管家身分，用繁體中文簡短回覆他，說明你可以幫他查詢專案工時或產出週報。`);
      return await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: chat }] });
    }

    // 3. 抓取數據並產出報表
    console.log("Generating Enhanced Data Report...");
    const report = await generateAIDataReport(intent);
    await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: report }] });

  } catch (e) {
    console.error("Process Error:", e);
    await lineClient.replyMessage({ 
      replyToken, 
      messages: [{ type: 'text', text: "⚠️ 處理中發生技術錯誤，請稍後再試，或聯繫系統架構師。" }] 
    });
  }
}

async function handleWeeklyReport() {
  const summary = await generateAIDataReport({ action: 'GENERAL_SUMMARY' });
  const { data: users } = await supabase.from('prj_settings').select('description').like('key', 'User:%');
  const lineIds = users?.map(u => u.description.split('|')[2]).filter(id => id && id.trim() !== '') || [];

  for (const id of lineIds) {
    try {
      await lineClient.pushMessage({ 
        to: id, 
        messages: [{ type: 'text', text: `📊 【系統自動推播】本週工時進度摘要：\n\n${summary}` }] 
      });
    } catch (e) { console.error("Push failed:", id, e.message); }
  }
  return new Response(JSON.stringify({ message: "Sent" }), { headers: { 'Content-Type': 'application/json' } });
}

async function generateAIDataReport(intent: any) {
  const { action, projectId, engineerName, startDate, endDate } = intent;
  
  // 設定時間區間
  let dStart = startDate;
  let dEnd = endDate || new Date().toISOString().split('T')[0];
  if (!dStart) {
    const temp = new Date();
    temp.setDate(temp.getDate() - 7);
    dStart = temp.toISOString().split('T')[0];
  }

  // 1. 從物理數據庫抓取
  let query = supabase.from('prj_logs').select('*').gte('date', dStart).lte('date', dEnd);
  if (action === 'PROJECT_QUERY' && projectId) query = query.ilike('projectid', `%${projectId}%`);
  const { data: logs } = await query;

  if (!logs || logs.length === 0) {
    return `🔍 在 ${dStart} ~ ${dEnd} 期間，針對「${projectId || engineerName || '全公司'}」查無相關工時記錄。`;
  }

  // 2. 獲取專案名稱對照
  const { data: projects } = await supabase.from('prj_projects').select('projectid, name');
  const projectMap = projects?.reduce((acc: any, p: any) => { acc[p.projectid] = p.name; return acc; }, {}) || {};

  // 3. 格式化為 AI 友好的清單（減少 JSON 冗餘）
  const dataString = logs.map(l => 
    `[${l.date}] ${l.engineer} | ${projectMap[l.projectid] || l.projectid} | ${l.hours}H | ${l.note || l.content}`
  ).join('\n');

  // 4. 定義專業 Prompt
  const prompt = `你是一個專業的高級專案經理與工時分析專家。
請根據以下提供的工時原始數據，為「${engineerName || projectId || '全公司'}」產出一份結構清晰、富有見地的專業報表。

【原始數據 (日期 | 成員 | 專案 | 工時 | 內容)】
${dataString}

【報表要求】
1. 開場白：需包含「你好，我是專案 AI 助理」，並根據查詢對象(人員或專案)調整語氣。
2. 數據統計：精確計算總工時，若有多個專案/多位成員，請按佔比進行排序與百分比分析。
3. 關鍵洞察：歸納本段期間的主要工作進展與重點事項。
4. 專業建議：提供 1-3 點關於進度控制、資源分配或異常預警的建議。
5. 視覺化：使用適量的 Emoji、分隔線與列點，確保內容在 LINE 手機畫面上易於閱讀且排版美觀。

請使用繁體中文，語氣保持客觀、專業、溫暖。`;

  return await askGemini(prompt);
}

async function askGemini(prompt: string, jsonOnly = false) {
  if (!GEMINI_API_KEY) return "❌ 系統錯誤：Missing GEMINI_API_KEY";
  
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 2048,
          ...(jsonOnly ? { responseMimeType: "application/json" } : {})
        }
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error("Gemini API Error:", JSON.stringify(data));
      // 如果是模型不存在錯誤，嘗試降級到 Flash
      if (response.status === 404 && GEMINI_MODEL !== "gemini-1.5-flash") {
         console.warn("Model not found, falling back to gemini-1.5-flash...");
         return await askGeminiFallback(prompt, jsonOnly, "gemini-1.5-flash");
      }
      return `❌ AI 服務目前無法回應 (${response.status}): ${data.error?.message || '未知錯誤'}`;
    }

    const result = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return result || "⚠️ AI 暫時無法分析此數據，請稍後再試。";
    
  } catch (err) {
    console.error("Fetch Exception:", err);
    return `❌ 連線失敗: ${err.message}`;
  }
}

// 降級處理函數
async function askGeminiFallback(prompt: string, jsonOnly: boolean, model: string) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: jsonOnly ? { responseMimeType: "application/json" } : {}
      })
    });
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "⚠️ 降級分析失敗";
}

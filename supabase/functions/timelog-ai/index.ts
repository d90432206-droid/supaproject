import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as messagingApi from "npm:@line/bot-sdk"

const { MessagingApiClient } = messagingApi.messagingApi;

// 1. 環境變數設定
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get('TIMELOG_LINE_TOKEN') || '';
const LINE_CHANNEL_SECRET = Deno.env.get('TIMELOG_LINE_SECRET') || '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || '';

// 優先順序：Gemini 1.5 Flash (快速穩定且配額充足) 
const GEMINI_MODEL = "gemini-1.5-flash"; 

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
  const intentPrompt = `你是一個專業的資深助理意圖分析員。請分析使用者指令，回傳 JSON。
今天日期：${today}

可用 Action 類型：
- "PROJECT_QUERY": 查詢特定專案工時 (除非使用者強調最近、這週，否則預設為該專案完整週期)
- "ENGINEER_QUERY": 查詢特定人員工時
- "GENERAL_SUMMARY": 查詢全公司/多個專案總體進度
- "UNKNOWN": 無法理解或聊天

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
    let intent;
    try {
      intent = JSON.parse(intentRaw.replace(/```json|```/g, '').trim());
    } catch (e) {
      console.error("JSON Parse Error:", intentRaw);
      throw new Error("意圖解析 JSON 格式錯誤");
    }

    if (intent.action === 'UNKNOWN') {
      const chat = await askGemini(`使用者對你說：'${userText}'，請以一位專業的「專案 AI 管理助理」身分，用繁體中文簡短回覆他，說明你可以幫他查詢完整專案週期工時、人員績效或產出週報。`);
      return await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: chat }] });
    }

    // 3. 抓取數據並產出報表
    console.log("Generating Enhanced Data Report...");
    const report = await generateAIDataReport(intent);
    await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: report }] });

  } catch (e) {
    console.error("Process Error:", e);
    const errorMsg = e.message.includes('503') || e.message.includes('忙碌')
      ? "⏱️ 目前 AI 服務端忙碌中，請稍候 30 秒後再次嘗試。" 
      : "⚠️ 處理中發生錯誤，請調整提問方式或聯繫管理員。";
      
    await lineClient.replyMessage({ 
      replyToken, 
      messages: [{ type: 'text', text: errorMsg }] 
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
  
  let dStart = startDate;
  let dEnd = endDate || new Date().toISOString().split('T')[0];

  // 1. 特殊邏輯：若沒給開始日期且是查專案，嘗試抓該專案的開始日
  if (!dStart && action === 'PROJECT_QUERY' && projectId) {
    const { data: pData } = await supabase
      .from('prj_projects')
      .select('startdate')
      .ilike('projectid', `%${projectId}%`)
      .limit(1)
      .single();
    
    if (pData?.startdate) {
      dStart = pData.startdate;
      console.log(`Using project start date: ${dStart}`);
    }
  }

  // 預設日期回退 (最近一年，避免數據太少或沒抓到專案日期)
  if (!dStart) {
    const temp = new Date();
    temp.setMonth(temp.getMonth() - 12); 
    dStart = temp.toISOString().split('T')[0];
  }

  // 2. 從 SQL 抓取 Logs
  let query = supabase.from('prj_logs').select('*').gte('date', dStart).lte('date', dEnd);
  if (action === 'PROJECT_QUERY' && projectId) query = query.ilike('projectid', `%${projectId}%`);
  else if (action === 'ENGINEER_QUERY' && engineerName) query = query.ilike('engineer', `%${engineerName}%`);

  const { data: logs } = await query;

  if (!logs || logs.length === 0) {
    return `🔍 在 ${dStart} ~ ${dEnd} 期間，針對「${projectId || engineerName || '全公司'}」查無任何工時記錄。`;
  }

  // 3. 獲取專案名稱對照
  const { data: projects } = await supabase.from('prj_projects').select('projectid, name');
  const projectMap = projects?.reduce((acc: any, p: any) => { acc[p.projectid] = p.name; return acc; }, {}) || {};

  // 4. 格式化數據清單
  const dataString = logs.map(l => 
    `[${l.date}] ${l.engineer} | ${projectMap[l.projectid] || l.projectid} | ${l.hours}H | ${l.note || l.content}`
  ).join('\n');

  // 5. 定義專業 Prompt (加強百分比分析)
  const prompt = `你是一個資深的工時數據分析專家。
請分析以下工時數據，產出一份高級、專業且富有洞察力的中文報告。

【目標對象】 ${engineerName || projectId || '全公司'}
【查詢區間】 ${dStart} ~ ${dEnd}

【數據清單 (日期 | 成員 | 專案 | 工時 | 內容)】
${dataString}

【報告格式要求】
1. 開場白：需包含「你好，我是專案 AI 助理」。
2. 數據深度統計：
   - 總累計工時。
   - 【核心需求】請計算各個不同任務/專案/成員的「佔比狀況 (%)」。
   - 若數據包含「任務分工」，請條列出各任務的百分比分布。
3. 關鍵洞察：基於數據找出本區間最花時間的項目、加班狀況或資源集中度。
4. 專業經理建議：提供 1-3 點改善、風險預警或下階段重點建議。
5. 視覺化設計：使用 Emoji、分隔線與適當縮排，確保在手機版 LINE 排版美觀。

請務必精確計算百分比，語氣專業冷靜但溫暖。`;

  return await askGemini(prompt);
}

async function askGemini(prompt: string, jsonOnly = false) {
  if (!GEMINI_API_KEY) return "❌ 系統錯誤：Missing GEMINI_API_KEY";
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  
  try {
    let attempt = 0;
    const maxAttempts = 2;
    
    while (attempt < maxAttempts) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2, 
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 2048,
            ...(jsonOnly ? { responseMimeType: "application/json" } : {})
          }
        })
      });

      const data = await response.json();
      
      if (response.ok) {
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "⚠️ AI 暫時無法分析。";
      }

      if (response.status === 503 || response.status === 429) {
        console.warn(`Gemini Busy (${response.status}), retrying in 2s... (Attempt ${attempt + 1})`);
        await new Promise(r => setTimeout(r, 2000));
        attempt++;
        continue;
      }

      console.error("Gemini API Error:", JSON.stringify(data));
      throw new Error(`AI 服務目前異常 (${response.status})`);
    }

    throw new Error("AI 服務忙碌中，請稍候再試。");
    
  } catch (err) {
    console.error("Fetch Exception:", err);
    throw err;
  }
}

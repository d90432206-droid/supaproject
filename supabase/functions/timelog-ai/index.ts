import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as messagingApi from "npm:@line/bot-sdk"

const { MessagingApiClient } = messagingApi.messagingApi;

// 1. 環境變數設定
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get('TIMELOG_LINE_TOKEN') || '';
const LINE_CHANNEL_SECRET = Deno.env.get('TIMELOG_LINE_SECRET') || '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || '';

/**
 * 根據使用者截圖與指示：
 * 優先使用 Gemini 3.1 Flash Lite (配額最高，最穩定)
 * 備用方案為 Gemini 3 Flash 或 Gemini 2.5 Flash Lite
 * 完全移除所有 1.5 版本
 */
const GEMINI_MODEL = "gemini-3.1-flash-lite"; 

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

    if (body.action === 'analyze_data' || body.action === 'generate_report_v2') {
      const report = await generateAIDataReport(body);
      return new Response(JSON.stringify({ report }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    if (body.type === 'cron_trigger' || body.action === 'generate_report') {
      return await handleWeeklyReport();
    }

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

  const { data: settings } = await supabase
    .from('prj_settings')
    .select('*')
    .like('description', `%|%|${lineId}`);

  if (!settings || settings.length === 0) {
    return await lineClient.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: "❌ 您尚未獲得 AI 查詢權限。請在管理後台設定您的 LINE ID。" }]
    });
  }

  const today = new Date().toLocaleDateString('zh-TW');
  
  const intentPrompt = `你是一個專業的資深分析助理意圖解析員。
請解析使用者指令並回傳 JSON。
今天日期：${today}

可用 Action 類型：
- "PROJECT_QUERY": 查詢特定專案工時與 WBS 進度差異 (除非強調看這週/最近，否則預設看全週期)
- "ENGINEER_QUERY": 查詢人員績效與工時
- "GENERAL_SUMMARY": 總體摘要報告 (預設看最近一個月)
- "UNKNOWN": 其他聊天內容

JSON 格式要求：
{ "action": "...", "projectId": "...", "engineerName": "...", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" }

※ 重要指令：
1.除非使用者明確說「這週」、「本週」或給出具體日期，否則 "startDate" 請保留為空。
2.若是查詢單一專案進度，優先判定為 PROJECT_QUERY。`;

  try {
    const intentRaw = await askGemini(intentPrompt, true);
    let intent;
    try {
      intent = JSON.parse(intentRaw.replace(/```json|```/g, '').trim());
    } catch (e) {
      console.error("Parse Error:", intentRaw);
      throw new Error("意圖解析 JSON 格式錯誤");
    }

    if (intent.action === 'UNKNOWN') {
      const chat = await askGemini(`使用者說：'${userText}'，請以「專案管理 AI 助手」身分繁體中文回覆，說明你可以幫他用最新的 Gemini 3.1 技術分析工時。`);
      return await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: chat }] });
    }

    const report = await generateAIDataReport(intent);
    await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: report }] });

  } catch (e) {
    console.error("Process Error:", e);
    const msg = e.message.includes('503') || e.message.includes('busy')
      ? "⏱️ 目前 Gemini 3.1 服務負載較高，請於 30 秒後重新發送請求。"
      : "⚠️ 系統處理異常，請聯繫開發人員。";
    await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: msg }] });
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
        messages: [{ type: 'text', text: `📊 【AI 自動導覽】本週數據總覽：\n\n${summary}` }] 
      });
    } catch (e) { console.error("Push Error:", e.message); }
  }
  return new Response("ok");
}

async function generateAIDataReport(intent: any) {
  const { action, projectId, engineerName, startDate, endDate } = intent;
  
  let dStart = startDate;
  let dEnd = endDate || new Date().toISOString().split('T')[0];
  let wbsInfo = "";
  let projectContext = "";

  // 1. 抓取更豐富的專案上下文 (WBS, 預算, 期限)
  if (projectId) {
     const { data: p } = await supabase
       .from('prj_projects')
       .select('projectid, name, startdate, enddate, budgethours, details_json')
       .ilike('projectid', `%${projectId}%`)
       .limit(1)
       .single();
     
     if (p) {
        if (!dStart) dStart = p.startdate; // 優先使用專案開始日
        projectContext = `專案名稱: ${p.name} | 預計起迄: ${p.startdate} ~ ${p.enddate || '未定'} | 總預算工時: ${p.budgethours}H`;
        
        // 提取 WBS 資訊
        try {
          const details = typeof p.details_json === 'string' ? JSON.parse(p.details_json) : p.details_json;
          if (details?.wbs && Array.isArray(details.wbs)) {
            wbsInfo = "\n【WBS 任務預算與進度設定】:\n" + details.wbs.map((w: any) => 
              `- [${w.id}] ${w.taskName}: 預算 ${w.budgetHours}H | 預計 ${w.startDate} ~ ${w.endDate}`
            ).join('\n');
          }
        } catch (e) { console.warn("WBS Parse Error"); }
     }
  }

  // 預設日期回退
  if (!dStart) {
    const temp = new Date();
    temp.setMonth(temp.getMonth() - 12);
    dStart = temp.toISOString().split('T')[0];
  }

  // 2. 抓取工時日誌
  let query = supabase.from('prj_logs').select('*').gte('date', dStart).lte('date', dEnd);
  if (projectId) query = query.ilike('projectid', `%${projectId}%`);
  else if (engineerName) query = query.ilike('engineer', `%${engineerName}%`);
  
  const { data: logs } = await query;
  if (!logs || logs.length === 0) return `🔍 找不到 ${dStart} ~ ${dEnd} 的工時記錄。`;

  // 3. 抓取所有專案名稱對照 (用於顯示)
  const { data: allProjects } = await supabase.from('prj_projects').select('projectid, name');
  const projectMap = allProjects?.reduce((acc: any, p: any) => { acc[p.projectid] = p.name; return acc; }, {}) || {};

  // 4. 格式化日誌數據
  const dataString = logs.map(l => 
    `[${l.date}] ${l.engineer} | ${projectMap[l.projectid] || l.projectid} | ${l.taskid ? '任務:'+l.taskid : ''} | ${l.hours}H | ${l.note || l.content}`
  ).join('\n');

  // 5. 高級分析 Prompt (聚焦 Delay 偵測)
  const prompt = `你是一個資深的項目控制 (Project Control) 專家與數據分析師。
請根據以下數據，產出專業的「進度與偏差分析報告」。

【查詢目標】 ${projectContext || engineerName || '全公司'}
【資料時間】 ${dStart} ~ ${dEnd} (今日日期: ${new Date().toLocaleDateString()})
${wbsInfo}

【工時日誌明細】
${dataString}

【專業分析要求】
1. **開場白**：你好，我是專案 AI 助理。
2. **偏差分析 (Delay Detection)**：
   - 請比對「WBS 任務預算」與「實際累計工時」。
   - 如果某項任務的實際工時已接近或超過預算，請標註為 **[超支風險]**。
   - 如果今天日期已接近或超過 WBS 的結束日期但仍有大量工時產生，請標註為 **[進度落後 (Delay)]**。
3. **數據統計**：計算總工時及各任務佔比 (%)。
4. **重點摘要**：本區間的主要工作成果。
5. **行動建議**：針對 Delayed 或風險項目提出具體管理建議。

請使用繁體中文，排版需在手機 LINE 上美觀且易讀（多用列點與 Emoji）。計算需精確。`;

  return await askGemini(prompt);
}

async function askGemini(prompt: string, jsonOnly = false) {
  if (!GEMINI_API_KEY) return "❌ 缺少 GEMINI_API_KEY";
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  
  try {
    let attempt = 0;
    while (attempt < 2) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1, 
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 2048,
            ...(jsonOnly ? { responseMimeType: "application/json" } : {})
          }
        })
      });

      const data = await response.json();
      if (response.ok) return data.candidates?.[0]?.content?.parts?.[0]?.text || "⚠️ 無法產出內容";

      if (response.status === 503 || response.status === 429) {
        console.warn(`Retry due to ${response.status}...`);
        await new Promise(r => setTimeout(r, 1500));
        attempt++;
        continue;
      }

      // 如果 3.1 報錯，嘗試降級到使用者建議的 2.5 flash lite
      if (response.status === 404 && GEMINI_MODEL === "gemini-3.1-flash-lite") {
          return await askGeminiSpecific(prompt, jsonOnly, "gemini-2.5-flash-lite");
      }

      throw new Error(`Gemini Error ${response.status}`);
    }
    throw new Error("Busy");
  } catch (e) {
    console.error(e);
    throw e;
  }
}

async function askGeminiSpecific(prompt: string, jsonOnly: boolean, model: string) {
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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as messagingApi from "npm:@line/bot-sdk"

const { MessagingApiClient } = messagingApi.messagingApi;

// 1. 環境變數設定
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get('TIMELOG_LINE_TOKEN') || '';
const LINE_CHANNEL_SECRET = Deno.env.get('TIMELOG_LINE_SECRET') || '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || '';

/**
 * 模型優先級設定 (優先嘗試最新且配額高的模型)
 * 如果第一順位忙碌 (503) 或不存在 (404)，則依序降級
 */
const MODEL_PRIORITY = [
  "gemini-3.1-flash-lite", // 優先使用 (0/500 RPD)
  "gemini-3-flash",        // 次之 (0/20 RPD)
  "gemini-2.5-flash"       // 穩定備援
];

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
      messages: [{ type: 'text', text: "❌ 您尚未獲得 AI 查詢權限。" }]
    });
  }

  const today = new Date().toLocaleDateString('zh-TW');
  const intentPrompt = `你是一個專業數據分析助理。請分析指令並回傳 JSON。今天：${today}
A: PROJECT_QUERY | ENGINEER_QUERY | GENERAL_SUMMARY
Format: { "action": "...", "projectId": "...", "engineerName": "...", "startDate": "...", "endDate": "..." }
除非明確說這週，否則 startDate 留空。
指令：'${userText}'`;

  try {
    const intentRaw = await askGemini(intentPrompt, true);
    let intent;
    try {
      intent = JSON.parse(intentRaw.replace(/```json|```/g, '').trim());
    } catch (e) { throw new Error("JSON Error"); }

    if (intent.action === 'UNKNOWN') {
      const chat = await askGemini(`使用者說：'${userText}'，請以 AI 助理身分回覆，說明你可以分析專案狀況與 Delay 風險。`);
      return await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: chat }] });
    }

    const report = await generateAIDataReport(intent);
    await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: report }] });

  } catch (e) {
    console.error("Process Error:", e);
    const msg = e.message.includes('busy') ? "⏱️ AI 忙碌中，請稍候重試。" : "⚠️ 處理異常。";
    await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: msg }] });
  }
}

async function handleWeeklyReport() {
  const summary = await generateAIDataReport({ action: 'GENERAL_SUMMARY' });
  const { data: users } = await supabase.from('prj_settings').select('description').like('key', 'User:%');
  const ids = users?.map(u => u.description.split('|')[2]).filter(id => id) || [];
  for (const id of ids) {
    try { await lineClient.pushMessage({ to: id, messages: [{ type: 'text', text: summary }] }); } catch (e) {}
  }
  return new Response("ok");
}

async function generateAIDataReport(intent: any) {
  const { action, projectId, engineerName, startDate, endDate } = intent;
  let dStart = startDate;
  let dEnd = endDate || new Date().toISOString().split('T')[0];
  let wbsInfo = "";
  let pContext = "";

  if (projectId) {
     const { data: p } = await supabase.from('prj_projects').select('*').ilike('projectid', `%${projectId}%`).limit(1).single();
     if (p) {
        if (!dStart) dStart = p.startdate;
        pContext = `專案: ${p.name} | 預算: ${p.budgethours}H`;
        try {
          const det = typeof p.details_json === 'string' ? JSON.parse(p.details_json) : p.details_json;
          if (det?.wbs) wbsInfo = "\nWBS:\n" + det.wbs.map((w: any) => `- ${w.id} ${w.taskName}: ${w.budgetHours}H (${w.startDate}~${w.endDate})`).join('\n');
        } catch (e) {}
     }
  }

  if (!dStart) {
    const t = new Date(); t.setMonth(t.getMonth() - 12); dStart = t.toISOString().split('T')[0];
  }

  let query = supabase.from('prj_logs').select('*').gte('date', dStart).lte('date', dEnd);
  if (projectId) query = query.ilike('projectid', `%${projectId}%`);
  else if (engineerName) query = query.ilike('engineer', `%${engineerName}%`);
  
  const { data: logs } = await query;
  if (!logs || logs.length === 0) return `🔍 ${dStart}~${dEnd} 無紀錄。`;

  const { data: allP } = await supabase.from('prj_projects').select('projectid, name');
  const pMap = allP?.reduce((acc: any, p: any) => { acc[p.projectid] = p.name; return acc; }, {}) || {};

  const ds = logs.map(l => `[${l.date}] ${l.engineer} | ${pMap[l.projectid] || l.projectid} | ${l.taskid||''} | ${l.hours}H | ${l.note || l.content}`).join('\n');

  const prompt = `你是一個項目控制專家。請分析數據並產出 Delay 預警報告。今日: ${new Date().toLocaleDateString()}
目標: ${pContext || engineerName} | 區間: ${dStart}~${dEnd}
${wbsInfo}
日誌:
${ds}
要求:
1.開場 2.偏差分析(比對 WBS 與實際) 3.總工時與佔比(%) 4.風險建議 5.LINE 優化排版。`;

  return await askGemini(prompt);
}

// 改進的 askGemini：具備多模型自動降級與忙碌重試功能
async function askGemini(prompt: string, jsonOnly = false) {
  if (!GEMINI_API_KEY) return "❌ No Key";
  
  // 依序嘗試所有可用模型
  for (const modelId of MODEL_PRIORITY) {
    try {
      console.log(`Trying model: ${modelId}`);
      const res = await callGeminiAPI(modelId, prompt, jsonOnly);
      if (res) return res;
    } catch (e) {
      console.warn(`Model ${modelId} failed: ${e.message}. Moving to next...`);
      continue; // 嘗試下一個模型
    }
  }
  
  throw new Error("All models failed or busy.");
}

async function callGeminiAPI(model: string, prompt: string, jsonOnly: boolean) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  
  let attempts = 0;
  while (attempts < 2) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1, 
          maxOutputTokens: 2048,
          ...(jsonOnly ? { responseMimeType: "application/json" } : {})
        }
      })
    });

    const data = await response.json();
    
    // 成功回傳
    if (response.ok) {
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
      throw new Error("Empty Response");
    }

    // 處理忙碌 (503/429) -> 重試
    if (response.status === 503 || response.status === 429) {
      console.warn(`Model ${model} busy, retry ${attempts + 1}`);
      await new Promise(r => setTimeout(r, 1500));
      attempts++;
      continue;
    }

    // 處理找不到模型 (404) 或其他錯誤 -> 直接換下一個模型
    throw new Error(`API error ${response.status}: ${data.error?.message || 'unknown'}`);
  }
  
  throw new Error(`Model ${model} still busy after retries`);
}

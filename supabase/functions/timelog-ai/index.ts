import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as messagingApi from "npm:@line/bot-sdk"

const { MessagingApiClient } = messagingApi.messagingApi;

// 1. 環境變數設定
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get('TIMELOG_LINE_TOKEN') || '';
const LINE_CHANNEL_SECRET = Deno.env.get('TIMELOG_LINE_SECRET') || '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || '';

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

    if (body.type === 'cron_trigger' || body.action === 'generate_report') {
      return await handleWeeklyReport();
    }

    if (body.events) {
      if (body.events.length > 0) {
        for (const event of body.events) {
          if (event.type === 'message' && event.message.type === 'text') {
            await handleLineMessage(event);
          }
        }
      }
      return new Response(JSON.stringify({ message: 'ok' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Invalid Request' }), { status: 400 });

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
      messages: [{ type: 'text', text: "❌ 您尚未獲得查詢權限。請在管理台設定您的 LINE ID。" }]
    });
  }

  const today = new Date().toISOString().split('T')[0];
  const intentPrompt = `你是一個工時系統意圖分析員。分析使用者輸入，回傳 JSON。今天：${today}
action: "PROJECT_QUERY", "ENGINEER_QUERY", "GENERAL_SUMMARY", "UNKNOWN"
格式：{ "action": "...", "projectId": "...", "engineerName": "...", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" }
使用者：'${userText}'`;

  try {
    console.log("Gemini Intent Parsing...");
    const intentRaw = await askGemini(intentPrompt, true);
    const intent = JSON.parse(intentRaw.replace(/```json|```/g, '').trim());

    if (intent.action === 'UNKNOWN') {
      const chat = await askGemini(`使用者說：'${userText}'，請以管家身分簡短回覆他。`);
      return await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: chat }] });
    }

    console.log("Generating Data Report...");
    const report = await generateAIDataReport(intent);
    await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: report }] });

  } catch (e) {
    console.error("Process Error:", e);
    await lineClient.replyMessage({ 
      replyToken, 
      messages: [{ type: 'text', text: "⚠️ 處理中發生錯誤，請稍後再試。" }] 
    });
  }
}

async function handleWeeklyReport() {
  const summary = await generateAIDataReport({ action: 'GENERAL_SUMMARY' });
  const { data: users } = await supabase.from('prj_settings').select('description').like('key', 'User:%');
  const lineIds = users?.map(u => u.description.split('|')[2]).filter(id => id && id.trim() !== '') || [];

  for (const id of lineIds) {
    try {
      await lineClient.pushMessage({ to: id, messages: [{ type: 'text', text: `📢 週報自動推播：\n\n${summary}` }] });
    } catch (e) { console.error("Push failed:", id, e.message); }
  }
  return new Response(JSON.stringify({ message: "Sent" }), { headers: { 'Content-Type': 'application/json' } });
}

async function generateAIDataReport(intent: any) {
  const { action, projectId, engineerName, startDate, endDate } = intent;
  let dStart = startDate;
  let dEnd = endDate || new Date().toISOString().split('T')[0];
  if (!dStart) {
    const temp = new Date();
    temp.setDate(temp.getDate() - 7);
    dStart = temp.toISOString().split('T')[0];
  }

  let query = supabase.from('prj_logs').select('*').gte('date', dStart).lte('date', dEnd);
  if (action === 'PROJECT_QUERY' && projectId) query = query.ilike('projectid', `%${projectId}%`);
  else if (action === 'ENGINEER_QUERY' && engineerName) query = query.ilike('engineer', `%${engineerName}%`);

  const { data: logs } = await query;
  if (!logs || logs.length === 0) return `🔍 ${dStart}~${dEnd} 查無資料。`;

  const { data: projects } = await supabase.from('prj_projects').select('projectid, name');
  const projectMap = projects?.reduce((acc: any, p: any) => { acc[p.projectid] = p.name; return acc; }, {}) || {};

  const dataForAI = logs.map(l => ({
    日期: l.date,
    人: l.engineer,
    專案: `${projectMap[l.projectid] || ''} (${l.projectid})`,
    時數: l.hours,
    內容: l.note
  }));

  const prompt = `你是一個專業的「專案AI助理」。請根據以下數據進行分析：${JSON.stringify(dataForAI)}
查詢對象：${projectId || engineerName || '全公司週報摘要'}
時間區間：${dStart} ~ ${dEnd}

請幫經理整理報表，開頭請用「你好，我是專案AI助理」作為開場白。
1. 進行精確的時數統計與百分比佔比。
2. 歸納重點工作項目摘要。
3. 提供 1-2 點專業建議。
請多用 Emoji 與列點，格式需適合 LINE 閱讀。`;
 Linda

  return await askGemini(prompt);
}

async function askGemini(prompt: string, jsonOnly = false) {
  if (!GEMINI_API_KEY) return "❌ 系統錯誤：Missing Key";
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: jsonOnly ? { responseMimeType: "application/json" } : {}
      })
    });
    const data = await response.json();
    if (!response.ok) {
      console.error("Gemini API Error Response:", JSON.stringify(data));
      return `❌ AI 失敗 (${response.status}): ${data.error?.message || '未知錯誤'}`;
    }
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!result) console.warn("Gemini returned empty parts:", JSON.stringify(data));
    return result || "⚠️ 無回傳";
  } catch (err) {
    console.error("Fetch Exception:", err);
    return `❌ 連線失敗: ${err.message}`;
  }
}

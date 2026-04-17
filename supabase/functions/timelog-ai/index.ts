import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as messagingApi from "npm:@line/bot-sdk"

const { MessagingApiClient } = messagingApi.messagingApi;

// 1. 環境變數設定
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get('TIMELOG_LINE_TOKEN') || '';
const LINE_CHANNEL_SECRET = Deno.env.get('TIMELOG_LINE_SECRET') || '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || '';

/**
 * 模型嘗試清單 (依照最新/配額高排序)
 * 針對 503 錯誤優化：增加重試延遲並依序流轉
 */
const MODEL_PRIORITY = [
  "gemini-3.1-flash-lite", 
  "gemini-3-flash",        
  "gemini-2.5-flash"
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

    return new Response(JSON.stringify({ error: 'Invalid Intent' }), { status: 400 });

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

  const { data: settings } = await supabase.from('prj_settings').select('*').like('description', `%|%|${lineId}`);
  if (!settings || settings.length === 0) {
    return await lineClient.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: "❌ 您尚未獲得 AI 權限。" }]
    });
  }

  const today = new Date().toLocaleDateString('zh-TW');
  const intentPrompt = `分析指令回傳 JSON。今天：${today}
A: PROJECT_QUERY | ENGINEER_QUERY | GENERAL_SUMMARY
Format: { "action": "...", "projectId": "...", "engineerName": "...", "startDate": "...", "endDate": "..." }
除非指定"這週"，否則 startDate 留空。
指令：'${userText}'`;

  try {
    const intentRaw = await askGemini(intentPrompt, true);
    let intent;
    try {
      intent = JSON.parse(intentRaw.replace(/```json|```/g, '').trim());
    } catch (e) { throw new Error("Intent JSON Error"); }

    const report = await generateAIDataReport(intent);
    await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: report }] });

  } catch (e) {
    console.error("Process Error:", e);
    await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: `⚠️ 系統繁忙或發生錯誤：${e.message}` }] });
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
        pContext = `專案: ${p.projectid} ${p.name}`;
        try {
          const det = typeof p.details_json === 'string' ? JSON.parse(p.details_json) : p.details_json;
          if (det?.wbs) wbsInfo = "\n【WBS 設定】:\n" + det.wbs.slice(0, 15).map((w: any) => `- ${w.id} ${w.taskName}: ${w.budgetHours}H`).join('\n');
        } catch (e) {}
     }
  }

  if (!dStart) {
    const t = new Date(); t.setMonth(t.getMonth() - 1); dStart = t.toISOString().split('T')[0];
  }

  let query = supabase.from('prj_logs').select('*').gte('date', dStart).lte('date', dEnd);
  if (projectId) query = query.ilike('projectid', `%${projectId}%`);
  else if (engineerName) query = query.ilike('engineer', `%${engineerName}%`);
  
  const { data: logs } = await query;
  if (!logs || logs.length === 0) return `🔍 ${dStart}~${dEnd} 無工時紀錄。`;

  const ds = logs.slice(0, 200).map(l => `[${l.date}] ${l.engineer} | ${l.projectid} | ${l.hours}H | ${l.note || l.content}`).join('\n');

  const prompt = `項目助手報告。今日: ${new Date().toLocaleDateString()}
目標: ${pContext || engineerName} | 區間: ${dStart}~${dEnd}
${wbsInfo}
日誌:
${ds}
請分析 Delay 平衡進度，標註超預算風險，精確計算佔比(%)。`;

  return await askGemini(prompt);
}

/**
 * 改進的 askGemini：
 * 針對 503 錯誤增加延遲重試，並在重試無效時強制切換下一個模型。
 */
async function askGemini(prompt: string, jsonOnly = false) {
  if (!GEMINI_API_KEY) return "❌ No API Key";
  
  const errors = [];
  
  for (const modelId of MODEL_PRIORITY) {
    try {
      console.log(`[AI] Requesting ${modelId}...`);
      let attempts = 0;
      
      while (attempts < 2) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${GEMINI_API_KEY}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              ...(jsonOnly ? { responseMimeType: "application/json" } : {})
            }
          })
        });

        const data = await response.json();
        
        if (response.ok) {
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return text;
          throw new Error("Empty internal response");
        }

        // 如果遇到 503 (繁忙) 或 429 (頻率限制)，等待較長時間後重試一次
        if (response.status === 503 || response.status === 429) {
          attempts++;
          console.warn(`[AI] ${modelId} is busy (503/429), retrying in 3s...`);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        // 其他錯誤 (如 404, 400)，直接放棄當前模型嘗試下一個
        throw new Error(`API ${response.status}: ${data.error?.message || 'unknown'}`);
      }
      
      throw new Error(`${modelId} busy after retries`);
      
    } catch (e) {
      console.error(`[AI] Model ${modelId} failed: ${e.message}`);
      errors.push(`${modelId}: ${e.message}`);
      continue; // 嘗試 MODEL_PRIORITY 中的下一個模型
    }
  }
  
  throw new Error(`所有模型均不可用或繁忙。錯誤紀錄：${errors.join('; ')}`);
}

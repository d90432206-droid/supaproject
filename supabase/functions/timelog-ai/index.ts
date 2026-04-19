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
  "gemini-3.1-flash-lite-preview",  // 最新輕量，優先使用
  "gemini-3-flash-preview",         // 次選
  "gemini-2.5-flash"                // 最後備援
];

// ===== TOKEN 計費 =====
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gemini-3.1-flash-lite-preview": { input: 0.075, output: 0.30 },
  "gemini-3-flash-preview":        { input: 0.15,  output: 0.60 },
  "gemini-2.5-flash":              { input: 0.15,  output: 0.60 },
};
const USD_TO_TWD = 31;

class TokenTracker {
  inputTokens  = 0;
  outputTokens = 0;
  lastModel    = MODEL_PRIORITY[0];

  add(input: number, output: number, model: string) {
    this.inputTokens  += input;
    this.outputTokens += output;
    this.lastModel     = model;
  }

  get total() { return this.inputTokens + this.outputTokens; }

  footer(): string {
    if (this.total === 0) return "";
    const p   = MODEL_PRICING[this.lastModel] || { input: 0.15, output: 0.60 };
    const usd = (this.inputTokens * p.input + this.outputTokens * p.output) / 1_000_000;
    const twd = usd * USD_TO_TWD;
    const cost = twd < 0.01 ? "<NT$0.01" : `≈NT$${twd.toFixed(2)}`;
    return `\n\n▸ ${this.total.toLocaleString()} tokens（輸入 ${this.inputTokens.toLocaleString()} / 輸出 ${this.outputTokens.toLocaleString()}）${cost}`;
  }
}

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

  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const todayTW = now.toLocaleDateString('zh-TW');
  // 計算本週一和上週的日期範圍（週一為起點）
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  const thisMonday = new Date(now); thisMonday.setDate(now.getDate() - dow + 1);
  const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday  = new Date(thisMonday); lastSunday.setDate(thisMonday.getDate() - 1);
  const fmt = (d: Date) => d.toISOString().split('T')[0];

  const intentPrompt = `你是工時查詢意圖解析器，回傳 JSON，不附加說明。
今天：${todayTW}（${today}）
本週一：${fmt(thisMonday)}　上週：${fmt(lastMonday)}～${fmt(lastSunday)}

action 選項：
- PROJECT_QUERY：查特定專案（需 projectId）
- ENGINEER_QUERY：查特定工程師（需 engineerName）
- GENERAL_SUMMARY：查全體 / 列出有活動的專案

時間詞對應（startDate / endDate 用 YYYY-MM-DD）：
- 「本週」「這週」→ startDate=${fmt(thisMonday)}, endDate=${today}
- 「上週」「上一週」→ startDate=${fmt(lastMonday)}, endDate=${fmt(lastSunday)}
- 「最近」「近期」「最新」→ startDate 留空（系統自動取近一個月）
- 「這個月」「本月」→ startDate=${today.substring(0, 7)}-01, endDate=${today}
- 未提到時間 → startDate 留空

Format: { "action": "...", "projectId": "...", "engineerName": "...", "startDate": "...", "endDate": "..." }
指令：'${userText}'`;

  const tracker = new TokenTracker();
  try {
    const intentRaw = await askGemini(intentPrompt, true, tracker);
    let intent;
    try {
      intent = JSON.parse(intentRaw.replace(/```json|```/g, '').trim());
    } catch (e) { throw new Error("Intent JSON Error"); }

    const report = await generateAIDataReport(intent, tracker);
    await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: report + tracker.footer() }] });

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

async function generateAIDataReport(intent: any, tracker?: TokenTracker) {
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
  
  let { data: logs } = await query;

  // fallback：指定區間無資料時，自動往前找最近 30 天有紀錄的資料
  if (!logs || logs.length === 0) {
    const fallbackStart = new Date(); fallbackStart.setDate(fallbackStart.getDate() - 30);
    const fb = fallbackStart.toISOString().split('T')[0];
    let fbQuery = supabase.from('prj_logs').select('*').gte('date', fb).lte('date', dEnd).order('date', { ascending: false }).limit(100);
    if (projectId) fbQuery = fbQuery.ilike('projectid', `%${projectId}%`);
    else if (engineerName) fbQuery = fbQuery.ilike('engineer', `%${engineerName}%`);
    const { data: fbLogs } = await fbQuery;
    if (!fbLogs || fbLogs.length === 0) return `🔍 ${dStart}~${dEnd} 無工時紀錄，近 30 天亦無資料。`;
    logs = fbLogs;
    dStart = fb;
    pContext = (pContext ? pContext + "　" : "") + `⚠️ 指定區間無資料，自動改為近 30 天（${fb}~${dEnd}）`;
  }

  const ds = logs.slice(0, 200).map(l => `[${l.date}] ${l.engineer} | ${l.projectid} | ${l.hours}H | ${l.note || l.content}`).join('\n');

  const isListQuery = !projectId && !engineerName;
  const prompt = isListQuery
    ? `工時摘要。今日: ${new Date().toLocaleDateString()} | 區間: ${dStart}~${dEnd}
${pContext ? pContext + "\n" : ""}日誌:
${ds}
請：1) 列出此區間有工時紀錄的所有專案（專案ID、名稱、合計工時）。
2) 標出近期工時最多的前3名專案。
3) 若有明顯異常（單日爆量、停工）請備注。`
    : `項目助手報告。今日: ${new Date().toLocaleDateString()}
目標: ${pContext || engineerName} | 區間: ${dStart}~${dEnd}
${wbsInfo}
日誌:
${ds}
請分析 Delay 平衡進度，標註超預算風險，精確計算佔比(%)。`;

  return await askGemini(prompt, false, tracker);
}

/**
 * 改進的 askGemini：
 * 針對 503 錯誤增加延遲重試，並在重試無效時強制切換下一個模型。
 */
async function askGemini(prompt: string, jsonOnly = false, tracker?: TokenTracker) {
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
          if (text) {
            if (tracker && data.usageMetadata) {
              tracker.add(
                data.usageMetadata.promptTokenCount     || 0,
                data.usageMetadata.candidatesTokenCount || 0,
                modelId
              );
            }
            return text;
          }
          throw new Error("Empty internal response");
        }

        if (response.status === 503 || response.status === 429) {
          attempts++;
          console.warn(`[AI] ${modelId} is busy (503/429), retrying in 3s...`);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        throw new Error(`API ${response.status}: ${data.error?.message || 'unknown'}`);
      }

      throw new Error(`${modelId} busy after retries`);

    } catch (e) {
      console.error(`[AI] Model ${modelId} failed: ${e.message}`);
      errors.push(`${modelId}: ${e.message}`);
      continue;
    }
  }

  throw new Error(`所有模型均不可用或繁忙。錯誤紀錄：${errors.join('; ')}`);
}

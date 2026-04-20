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

    if (['analyze_data', 'generate_report_v2', 'PROJECT_QUERY', 'ENGINEER_QUERY', 'GENERAL_SUMMARY'].includes(body.action)) {
      const result = await generateAIDataReport(body);
      // 如果是網頁端呼叫，將物件格式化為易讀的字串
      const report = typeof result === 'object' ? formatReportToString(result) : result;
      
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

    return new Response(JSON.stringify({ error: `Invalid Intent: ${body.action}` }), { status: 400 });

  } catch (err) {
    console.error("Critical Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function formatReportToString(report: any) {
  if (typeof report === 'string') return report;
  let text = `【${report.title}】\n📅 期間: ${report.period}\n\n`;
  text += `摘要：${report.summary}\n\n`;
  
  if (report.stats && report.stats.length > 0) {
    text += `📊 數據統計：\n`;
    report.stats.forEach((s: any) => {
      text += `• ${s.label}: ${s.value} (${s.subValue || ''})\n`;
    });
    text += `\n`;
  }
  
  if (report.analysis && report.analysis.length > 0) {
    text += `📝 重點分析：\n`;
    report.analysis.forEach((a: any) => {
      text += `[${a.topic}]\n`;
      if (Array.isArray(a.items)) {
        a.items.forEach((i: any) => text += `  - ${i}\n`);
      }
    });
    text += `\n`;
  }
  
  if (report.recommendation) {
    text += `💡 建議方案：\n`;
    if (Array.isArray(report.recommendation)) {
      report.recommendation.forEach((r: any) => text += `  - ${r}\n`);
    } else {
      text += `  - ${report.recommendation}\n`;
    }
  }
  return text;
}

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
- 「全部」「歷史」「所有記錄」→ startDate=2024-01-01
- 「今年」「本年」→ startDate=${today.substring(0, 4)}-01-01
- 提及特定月份（如：3月）→ 找出該月的第一天與最後一天
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
    if (typeof report === 'object' && report.title) {
      const flexMsg = convertToFlexMessage(report, tracker.footer());
      console.log("Flex Message Payload:", JSON.stringify(flexMsg));
      await lineClient.replyMessage({ replyToken, messages: [flexMsg] });
    } else {
      const text = typeof report === 'string' ? report : JSON.stringify(report);
      await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: text + tracker.footer() }] });
    }

  } catch (e) {
    console.error("Process Error:", e);
    await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: `⚠️ 系統繁忙或發生錯誤：${e.message}` }] });
  }
}

async function handleWeeklyReport() {
  const tracker = new TokenTracker();
  const summary = await generateAIDataReport({ action: 'GENERAL_SUMMARY' }, tracker);
  const { data: users } = await supabase.from('prj_settings').select('description').like('key', 'User:%');
  const ids = users?.map(u => u.description.split('|')[2]).filter(id => id) || [];
  
  const message = (typeof summary === 'object' && summary.title)
    ? convertToFlexMessage(summary, tracker.footer())
    : { type: 'text' as const, text: (typeof summary === 'string' ? summary : JSON.stringify(summary)) + tracker.footer() };

  for (const id of ids) {
    try { 
      console.log(`Pushing report to ${id}...`);
      await lineClient.pushMessage({ to: id, messages: [message] }); 
    } catch (e) {
      console.error(`Failed to push to ${id}:`, e.message);
    }
  }
  return new Response("ok");
}

async function generateAIDataReport(intent: any, tracker?: TokenTracker) {
  const { action, projectId, engineerName, startDate, endDate } = intent;
  let dStart = startDate;
  let dEnd = endDate || new Date().toISOString().split('T')[0];
  let wbsInfo = "";
  let pContext = "";

  if (!dStart) {
    const t = new Date(); t.setMonth(t.getMonth() - 1); dStart = t.toISOString().split('T')[0];
  }

  let query = supabase.from('prj_logs').select('*').gte('date', dStart).lte('date', dEnd);

  if (projectId) {
    const { data: p } = await supabase.from('prj_projects').select('*').ilike('projectid', `%${projectId}%`).limit(1).single();
    if (p) {
      // 優先使用精確匹配 (=) 避免模糊查詢抓到相似編號的專案 (例如：25042 不應抓到 C#25042)
      query = query.eq('projectid', p.projectid);
      pContext = `專案: ${p.projectid} ${p.name}`;
      try {
        const det = typeof p.details_json === 'string' ? JSON.parse(p.details_json) : p.details_json;
        if (det?.wbs) wbsInfo = "\n【WBS 設定】:\n" + det.wbs.slice(0, 15).map((w: any) => `- ${w.id} ${w.taskName}: ${w.budgetHours}H`).join('\n');
      } catch (e) {}
    } else {
      // 找不到主專案檔時才使用模糊查詢
      query = query.ilike('projectid', `%${projectId}%`);
    }
  } else if (engineerName) {
    query = query.ilike('engineer', `%${engineerName}%`);
  }

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

  // --- 強固化統計計算：在程式碼中計算，不依賴 AI 進行加總 ---
  const engineerStats: Record<string, number> = {};
  logs.forEach(l => {
    const hours = Number(l.hours) || 0;
    const name = l.engineer || "未知";
    engineerStats[name] = (engineerStats[name] || 0) + hours;
  });
  const totalHours = Object.values(engineerStats).reduce((a, b) => a + b, 0);
  const statsDetail = Object.entries(engineerStats)
    .sort((a, b) => b[1] - a[1])
    .map(([name, hours]) => `${name}: ${hours}H (${((hours / totalHours) * 100).toFixed(1)}%)`)
    .join(", ");

  const ds = logs.slice(0, 300).map(l => `[${l.date}] ${l.engineer} | ${l.projectid} | ${l.hours}H | ${l.note || l.content}`).join('\n');

  const isListQuery = !projectId && !engineerName;
  const prompt = isListQuery
    ? `你是一個專業的專案分析助手。請分析以下工時數據並以 JSON 格式回傳報告。
今日: ${new Date().toLocaleDateString()} | 區間: ${dStart}~${dEnd}
${pContext ? pContext + "\n" : ""}日誌:
${ds}

請嚴格回傳以下 JSON 格式，不要有其他文字：
{
  "title": "所有專案週報",
  "period": "${dStart} ~ ${dEnd}",
  "summary": "整體專案現況深度評估（約 100-200 字）",
  "stats": [
    { "label": "專案名稱", "value": "總工時(H)", "subValue": "佔比(%)" }
  ],
  "analysis": [
    { "topic": "風險或重點觀察大項", "level": "warning", "items": ["詳細觀測點1", "詳細觀測點2"] }
  ],
  "recommendation": ["具體建議1", "具體建議2"]
}
Level 可選: "critical" (高風險/紅), "warning" (中風險/黃), "info" (正常/綠)。Stats 請列出每個專案的工時與佔比。請提供深度洞察而非僅描述數據。`
    : `你是一個專業的人力資源與專案進度分析師。請分析進度與風險，並以 JSON 格式回傳報告。
今日: ${new Date().toLocaleDateString()}
目標: ${pContext || engineerName} | 區間: ${dStart}~${dEnd}
【系統統計數據（請以此為準）】: 總投入 ${totalHours}H，其中 ${statsDetail}
${wbsInfo}
日誌:
${ds}

請嚴格回傳以下 JSON 格式，不要有其他文字：
{
  "title": "${projectId ? "專案進度分析" : "工程師工時分析"}",
  "period": "${dStart} ~ ${dEnd}",
  "summary": "深度的整體評估與現況摘要（約 100-200 字）",
  "stats": [
    { "label": "人員/任務", "value": "工時(H)", "subValue": "佔比(%)" }
  ],
  "analysis": [
    { "topic": "風險/進度分析大項", "level": "warning", "items": ["詳細觀測點1", "詳細觀測點2", "數據支撐與隱患"] }
  ],
  "recommendation": ["行動建議1", "行動建議2", "具體步驟與截止時間建議"]
}
Level 可選: "critical" (高風險/紅), "warning" (中風險/黃), "info" (正常/綠)。佔比請精確計算。請針對異常數據進行具體追蹤。`;

  const responseText = await askGemini(prompt, true, tracker);
  try {
    return JSON.parse(responseText.replace(/```json|```/g, '').trim());
  } catch (e) {
    // Fallback if parsing fails - though askGemini with jsonOnly should be stable
    return { title: "分析報告", summary: responseText };
  }
}

/**
 * 將 JSON 報告轉換為極致美觀的 LINE Flex Message (Premium Design)
 */
function convertToFlexMessage(report: any, trackerFooter: string) {
  const { title, period, summary, stats = [], analysis = [], recommendation } = report;

  // 1. 建立統計數據卡片 (含有視覺化的進度條)
  const statsRows = stats.map((s: any) => {
    // 嘗試解析百分比以製作進度條
    let percent = 0;
    const match = s.subValue?.match(/(\d+(\.\d+)?)/);
    if (match) percent = Math.min(100, parseFloat(match[1]));

    return {
      type: "box",
      layout: "vertical",
      margin: "md",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: `🔹 ${s.label || '無名稱'}`, size: "sm", color: "#555555", flex: 4, weight: "bold" as const, wrap: true },
            { type: "text", text: String(s.value ?? "0"), size: "sm", color: "#27323E", align: "end", weight: "bold" as const, flex: 3 },
            { type: "text", text: String(s.subValue || " "), size: "xs", color: "#999999", align: "end", flex: 2 }
          ]
        },
        // 進度條 (如果 subValue 含有百分比)
        ...(percent > 0 ? [{
          type: "box",
          layout: "vertical",
          backgroundColor: "#EEEEEE",
          height: "4px",
          margin: "sm",
          cornerRadius: "2px",
          contents: [
            {
              type: "box",
              layout: "vertical",
              backgroundColor: percent > 90 ? "#FF5B5B" : "#3b82f6",
              height: "4px",
              width: `${percent}%`,
              contents: [{ type: "text", text: " ", size: "xs" }] // Cannot be empty
            }
          ]
        }] : [])
      ]
    };
  });

  // 2. 建立分析區塊 (卡片樣式)
  const analysisBlocks = analysis.map((a: any) => {
    const color = a.level === 'critical' ? '#FF5B5B' : (a.level === 'warning' ? '#FFB11B' : '#00B900');
    const bgColor = a.level === 'critical' ? '#FFF5F5' : (a.level === 'warning' ? '#FFFBEB' : '#F0FDF4');
    
    return {
      type: "box",
      layout: "vertical",
      margin: "lg",
      paddingAll: "md",
      backgroundColor: bgColor,
      cornerRadius: "md",
      borderWidth: "1px",
      borderColor: color + "33", // 20% opacity
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: "⦿", color: color, size: "xs", flex: 0 },
            { type: "text", text: String(a.topic || "分析項目"), weight: "bold" as const, size: "sm", margin: "md", color: "#333333", flex: 1 }
          ]
        },
        ...(a.items || []).map((item: string) => ({
          type: "text" as const,
          text: `• ${item}`,
          size: "xs" as const,
          color: "#666666",
          margin: "sm" as const,
          wrap: true
        }))
      ]
    };
  });

  return {
    type: "flex" as const,
    altText: `📊 ${title} - ${period}`.substring(0, 400),
    contents: {
      type: "bubble",
      styles: {
        header: { backgroundColor: "#27323E" },
        footer: { backgroundColor: "#FDFDFD" }
      },
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "xl",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "CHUYI AI ASSISTANT", color: "#FFFFFFB3", size: "xxs", weight: "bold" as const },
              { type: "text", text: "REPORT", color: "#FFB11B", size: "xxs", weight: "bold" as const, align: "end" }
            ]
          },
          { type: "text", text: String(title || "分析報告"), color: "#FFFFFF", size: "xl", weight: "bold" as const, margin: "md" },
          {
            type: "box",
            layout: "horizontal",
            margin: "sm",
            contents: [
              { type: "text", text: "📅", size: "xs", flex: 0 },
              { type: "text", text: String(period || "時間區間"), color: "#FFFFFF99", size: "xs", margin: "sm" }
            ]
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "lg",
        contents: [
          // 意圖摘要
          {
            type: "box",
            layout: "horizontal",
            paddingStart: "sm",
            paddingEnd: "sm",
            contents: [
              { type: "text", text: "❝", size: "xxl", color: "#E0E0E0", flex: 0 },
              { 
                type: "text", 
                text: summary || "資料分析完成", 
                size: "sm", 
                color: "#444444", 
                wrap: true, 
                margin: "md", 
                flex: 1, 
                align: "center", 
                style: "italic" as const,
                gravity: "center"
              },
              { type: "text", text: "❞", size: "xxl", color: "#E0E0E0", flex: 0, align: "end", gravity: "bottom" }
            ]
          },
          { type: "separator", margin: "xl" },

          // 數據統計區
          {
            type: "text",
            text: "STATISTICS DATA",
            size: "xxs",
            color: "#999999",
            weight: "bold" as const,
            margin: "xl"
          },
          ...statsRows,
          
          { type: "separator", margin: "xl" },

          // 進度分析區
          {
            type: "text",
            text: "PROGRESS ANALYSIS",
            size: "xxs",
            color: "#999999",
            weight: "bold" as const,
            margin: "xl"
          },
          ...analysisBlocks,

          // 底部建議
          {
            type: "box",
            layout: "vertical",
            margin: "xxl",
            paddingAll: "lg",
            backgroundColor: "#27323E",
            cornerRadius: "lg",
            contents: [
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  { type: "text", text: "💡", size: "sm", flex: 0 },
                  { type: "text", text: "ACTION RECOMMENDATION", size: "xs", weight: "bold" as const, color: "#FFB11B", margin: "sm" }
                ]
              },
              ...(Array.isArray(recommendation) ? recommendation : [recommendation || "維持現狀，持續追蹤進度。"]).map((rec: string) => ({
                type: "text",
                text: `▹ ${rec}`,
                size: "xs",
                color: "#DDE0E3",
                margin: "md",
                wrap: true
              }))
            ]
          }
        ]
      },
      footer: trackerFooter.trim() ? {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: trackerFooter.trim(), size: "xxs", color: "#CCCCCC", wrap: true, align: "center" }
        ],
        paddingAll: "md"
      } : undefined
    }
  };
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

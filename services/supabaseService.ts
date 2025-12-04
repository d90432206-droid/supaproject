
import { supabase } from '../supabaseClient';
import { Project, Log, GlobalEngineer, SystemMessage } from '../types';
import { CONFIG } from '../config';

// 1. 定義與資料庫一致的介面 (PostgreSQL 標準為全小寫)
interface DBProject {
  projectid: string;
  name: string;
  client: string;
  budgethours: number;
  status: string;
  startdate: string;
  enddate: string | null;
  details_json: string;
}

interface DBLog {
  logid: string;
  date: string;
  projectid: string;
  engineer: string;
  taskid: string;
  hours: number;
  note: string;
}

interface DBSettings {
  key: string;
  value: string | number; 
  description: string;
}

interface DBMessage {
  messageid: string;
  content: string;
  date: string;
  author: string;
}

// 輔助函式：將物件鍵值轉為小寫 (以防萬一資料庫回傳大寫)
const normalizeKeys = (obj: any) => {
  if (Array.isArray(obj)) {
    return obj.map(item => normalizeKeys(item));
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj).reduce((acc, key) => {
      acc[key.toLowerCase()] = obj[key];
      return acc;
    }, {} as any);
  }
  return obj;
};

// 輔助函式：自動分頁讀取所有資料 (突破 1000/10000 筆限制)
const fetchAllData = async (table: string, sortCol: string | null = null) => {
  let allData: any[] = [];
  let page = 0;
  const pageSize = 1000; // 每次讀取 1000 筆
  
  while (true) {
    let query = supabase.from(table).select('*');
    
    // 如果有指定排序，則加入排序條件
    if (sortCol) {
      query = query.order(sortCol, { ascending: false });
    }
    
    // 分頁讀取
    const { data, error } = await query.range(page * pageSize, (page + 1) * pageSize - 1);
    
    if (error) throw new Error(`${table} Fetch Error: ${error.message}`);
    
    if (!data || data.length === 0) break; // 讀不到資料了，結束
    
    allData = allData.concat(data);
    
    if (data.length < pageSize) break; // 這次讀不滿 1000 筆，代表是最後一頁了
    
    page++;
  }
  
  return allData;
};

export const SupabaseService = {
  // 1. 載入所有資料 (使用 fetchAllData 確保讀取完整資料庫)
  loadData: async (): Promise<{ projects: Project[], logs: Log[], adminPassword: string, globalEngineers: GlobalEngineer[], messages: SystemMessage[] }> => {
    try {
      // 平行執行所有讀取
      const [rawProjectsData, rawLogsData, rawSettingsData, rawMessagesData] = await Promise.all([
        fetchAllData(CONFIG.SUPABASE.TABLES.PROJECTS),
        fetchAllData(CONFIG.SUPABASE.TABLES.LOGS, 'date'), // 依照日期排序
        fetchAllData(CONFIG.SUPABASE.TABLES.SETTINGS),
        fetchAllData(CONFIG.SUPABASE.TABLES.MESSAGES, 'date')
      ]);

      // 正規化鍵值 (轉小寫)
      const rawProjects = normalizeKeys(rawProjectsData) as DBProject[];
      const rawLogs = normalizeKeys(rawLogsData) as DBLog[];
      const rawSettings = normalizeKeys(rawSettingsData) as DBSettings[];
      const rawMessages = normalizeKeys(rawMessagesData) as DBMessage[];

      // 轉換 Projects
      const projects: Project[] = rawProjects.map(p => {
        let details: any = {};
        try { details = p.details_json ? JSON.parse(p.details_json) : {}; } catch (e) {}
        return {
          id: p.projectid,
          name: p.name,
          client: p.client,
          budgetHours: p.budgethours,
          status: p.status as 'Active' | 'Closed',
          startDate: p.startdate,
          endDate: p.enddate,
          wbs: details.wbs || [],
          engineers: details.engineers || [],
          tasks: details.tasks || [],
          holidays: details.holidays || []
        };
      });

      // 轉換 Logs
      const logs: Log[] = rawLogs.map(l => ({
        logId: Number(l.logid),
        date: l.date,
        projectId: l.projectid,
        engineer: l.engineer,
        taskId: l.taskid,
        hours: l.hours,
        note: l.note
      }));

      // 解析 Settings
      let adminPassword = '8888';
      const globalEngineers: GlobalEngineer[] = [];

      rawSettings.forEach(s => {
        if (s.key === 'AdminPassword') {
          adminPassword = String(s.value);
        } else if (s.key.startsWith('User:')) {
          // 解析工程師設定: Key="User:Name", Value="Password", Description="Color"
          globalEngineers.push({
            name: s.key.replace('User:', ''),
            password: String(s.value),
            color: s.description || '#3b82f6'
          });
        }
      });

      // 轉換 Messages
      const messages: SystemMessage[] = rawMessages.map(m => ({
        id: m.messageid,
        content: m.content,
        date: m.date,
        author: m.author
      }));

      return { projects, logs, adminPassword, globalEngineers, messages };
    } catch (e) {
      throw e;
    }
  },

  // 2. 更新或新增單一專案
  upsertProject: async (project: Project): Promise<void> => {
    try {
      const detailsObj = {
        wbs: project.wbs,
        engineers: project.engineers,
        tasks: project.tasks,
        holidays: project.holidays
      };
      const safeEndDate = project.endDate && project.endDate.trim() !== '' ? project.endDate : null;

      // 使用全小寫欄位
      const payload = {
        projectid: project.id,
        name: project.name,
        client: project.client || '',
        budgethours: Number(project.budgetHours || 0),
        status: project.status,
        startdate: project.startDate,
        enddate: safeEndDate,
        details_json: JSON.stringify(detailsObj)
      };

      const { error } = await supabase
        .from(CONFIG.SUPABASE.TABLES.PROJECTS)
        .upsert(payload, { onConflict: 'projectid' });

      if (error) throw new Error(`Upsert Project Error: ${error.message}`);
    } catch (e) {
      console.error("Save Project Error:", e);
      throw e;
    }
  },

  // 3. 更新或新增單一日報
  upsertLog: async (log: Log): Promise<void> => {
    try {
      const payload = {
        logid: String(log.logId),
        date: log.date,
        projectid: log.projectId,
        engineer: log.engineer,
        taskid: String(log.taskId || ''),
        hours: Number(log.hours),
        note: log.note || ''
      };

      const { error } = await supabase
        .from(CONFIG.SUPABASE.TABLES.LOGS)
        .upsert(payload, { onConflict: 'logid' });

      if (error) throw new Error(`Upsert Log Error: ${error.message}`);
    } catch (e) {
      console.error("Save Log Error:", e);
      throw e;
    }
  },

  // 4. 管理全域工程師 (利用 prj_settings)
  upsertGlobalEngineer: async (eng: GlobalEngineer): Promise<void> => {
    try {
      const payload = {
        key: `User:${eng.name}`,
        value: eng.password, 
        description: eng.color 
      };
      const { error } = await supabase
        .from(CONFIG.SUPABASE.TABLES.SETTINGS)
        .upsert(payload, { onConflict: 'key' });

      if (error) throw new Error(`${error.message} (Code: ${error.code})`);
    } catch (e) {
      console.error("Save Engineer Error:", e);
      throw e;
    }
  },

  deleteGlobalEngineer: async (name: string): Promise<void> => {
    try {
      const { error } = await supabase
        .from(CONFIG.SUPABASE.TABLES.SETTINGS)
        .delete()
        .eq('key', `User:${name}`);

      if (error) throw new Error(`Delete Engineer Error: ${error.message}`);
    } catch (e) {
      console.error("Delete Engineer Error:", e);
      throw e;
    }
  },

  // 5. 系統公告 CRUD
  upsertMessage: async (msg: SystemMessage): Promise<void> => {
    try {
      const payload = {
        messageid: msg.id,
        content: msg.content,
        date: msg.date,
        author: msg.author
      };
      const { error } = await supabase
        .from(CONFIG.SUPABASE.TABLES.MESSAGES)
        .upsert(payload, { onConflict: 'messageid' });

      if (error) throw new Error(`Upsert Message Error: ${error.message} (Code: ${error.code})`);
    } catch (e) {
      console.error("Save Message Error:", e);
      throw e;
    }
  },

  deleteMessage: async (id: string): Promise<void> => {
    try {
      const { error } = await supabase
        .from(CONFIG.SUPABASE.TABLES.MESSAGES)
        .delete()
        .eq('messageid', id);
        
      if (error) throw new Error(`Delete Message Error: ${error.message}`);
    } catch (e) {
      console.error("Delete Message Error:", e);
      throw e;
    }
  }
};

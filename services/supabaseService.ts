
import { supabase } from '../supabaseClient';
import { Project, Log } from '../types';

// 1. 定義與資料庫完全一致的介面 (大小寫敏感)
// 根據您的截圖，資料表與欄位名稱皆為大寫開頭
interface DBProject {
  ProjectID: string;
  Name: string;
  Client: string;
  BudgetHours: number;
  Status: string;
  StartDate: string;
  EndDate: string | null;
  Details_JSON: string; // 資料庫截圖顯示為 text 型別
}

interface DBLog {
  LogID: string; // 資料庫截圖顯示為 text 型別
  Date: string;
  ProjectID: string;
  Engineer: string;
  TaskID: string;
  Hours: number;
  Note: string;
}

interface DBSettings {
  Key: string;
  Value: string;
  Description: string;
}

export const SupabaseService = {
  // 1. 載入所有資料
  loadData: async (): Promise<{ projects: Project[], logs: Log[], adminPassword: string }> => {
    try {
      // 使用大寫 Table Name (Projects, Logs, Settings)
      const [projRes, logRes, setRes] = await Promise.all([
        supabase.from('Projects').select('*'),
        supabase.from('Logs').select('*'),
        supabase.from('Settings').select('*').eq('Key', 'AdminPassword').single()
      ]);

      if (projRes.error) {
        console.error("Projects Fetch Error:", projRes.error);
        throw projRes.error;
      }
      if (logRes.error) {
        console.error("Logs Fetch Error:", logRes.error);
        throw logRes.error;
      }

      // 轉換 Projects
      const projects: Project[] = (projRes.data as DBProject[]).map(p => {
        // 處理 Details_JSON (text -> object)
        let details: any = {};
        try {
          details = p.Details_JSON ? JSON.parse(p.Details_JSON) : {};
        } catch (e) {
          console.warn("JSON Parse Error for Project:", p.ProjectID);
        }

        return {
          id: p.ProjectID,
          name: p.Name,
          client: p.Client,
          budgetHours: p.BudgetHours,
          status: p.Status as 'Active' | 'Closed',
          startDate: p.StartDate,
          endDate: p.EndDate,
          wbs: details.wbs || [],
          engineers: details.engineers || [],
          tasks: details.tasks || [],
          holidays: details.holidays || []
        };
      });

      // 轉換 Logs
      const logs: Log[] = (logRes.data as DBLog[]).map(l => ({
        logId: Number(l.LogID), // 轉回 number
        date: l.Date,
        projectId: l.ProjectID,
        engineer: l.Engineer,
        taskId: l.TaskID,
        hours: l.Hours,
        note: l.Note
      }));

      // 取得密碼
      let adminPassword = '8888';
      if (setRes.data) {
        adminPassword = (setRes.data as DBSettings).Value; // 注意是用 Value (大寫)
      }

      return { projects, logs, adminPassword };
    } catch (e) {
      console.error("Supabase Load Error Details:", e);
      throw e;
    }
  },

  // 2. 更新或新增單一專案
  upsertProject: async (project: Project): Promise<void> => {
    try {
      // 準備存入 DB 的 JSON 物件
      const detailsObj = {
        wbs: project.wbs,
        engineers: project.engineers,
        tasks: project.tasks,
        holidays: project.holidays
      };

      const payload = {
        ProjectID: project.id,
        Name: project.name,
        Client: project.client || '',
        BudgetHours: project.budgetHours || 0,
        Status: project.status,
        StartDate: project.startDate,
        EndDate: project.endDate,
        // 將物件轉為 JSON 字串存入 text 欄位
        Details_JSON: JSON.stringify(detailsObj)
      };

      const { error } = await supabase
        .from('Projects')
        .upsert(payload, { onConflict: 'ProjectID' });

      if (error) throw error;
    } catch (e) {
      console.error("Supabase Save Project Error:", e);
      throw e;
    }
  },

  // 3. 更新或新增單一日報
  upsertLog: async (log: Log): Promise<void> => {
    try {
      const payload = {
        LogID: String(log.logId), // 轉為 string 存入
        Date: log.date,
        ProjectID: log.projectId,
        Engineer: log.engineer,
        TaskID: String(log.taskId || ''),
        Hours: log.hours,
        Note: log.note || ''
      };

      const { error } = await supabase
        .from('Logs')
        .upsert(payload, { onConflict: 'LogID' });

      if (error) throw error;
    } catch (e) {
      console.error("Supabase Save Log Error:", e);
      throw e;
    }
  }
};

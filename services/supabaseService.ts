
import { supabase } from '../supabaseClient';
import { Project, Log } from '../types';

// 1. 定義與資料庫完全一致的介面 (大小寫敏感)
interface DBProject {
  ProjectID: string;
  Name: string;
  Client: string;
  BudgetHours: number;
  Status: string;
  StartDate: string;
  EndDate: string | null;
  Details_JSON: string;
}

interface DBLog {
  LogID: string;
  Date: string;
  ProjectID: string;
  Engineer: string;
  TaskID: string;
  Hours: number;
  Note: string;
}

interface DBSettings {
  Key: string;
  Value: string | number; // 資料庫可能是 int8 或 text
  Description: string;
}

export const SupabaseService = {
  // 1. 載入所有資料
  loadData: async (): Promise<{ projects: Project[], logs: Log[], adminPassword: string }> => {
    try {
      const [projRes, logRes, setRes] = await Promise.all([
        supabase.from('Projects').select('*'),
        supabase.from('Logs').select('*'),
        supabase.from('Settings').select('*').eq('Key', 'AdminPassword').single()
      ]);

      if (projRes.error) {
        throw new Error(`Projects Fetch Error: ${projRes.error.message} (${projRes.error.details || ''})`);
      }
      if (logRes.error) {
         throw new Error(`Logs Fetch Error: ${logRes.error.message} (${logRes.error.details || ''})`);
      }

      // 轉換 Projects
      const projects: Project[] = (projRes.data as DBProject[]).map(p => {
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
        logId: Number(l.LogID),
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
        // [修正關鍵] 強制轉為字串 String()
        // 因為資料庫欄位是 int8 (數字)，但前端比對需要字串
        adminPassword = String((setRes.data as DBSettings).Value); 
      }

      return { projects, logs, adminPassword };
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

      const payload = {
        ProjectID: project.id,
        Name: project.name,
        Client: project.client || '',
        BudgetHours: Number(project.budgetHours || 0),
        Status: project.status,
        StartDate: project.startDate,
        EndDate: safeEndDate,
        Details_JSON: JSON.stringify(detailsObj)
      };

      const { error } = await supabase
        .from('Projects')
        .upsert(payload, { onConflict: 'ProjectID' });

      if (error) {
        throw new Error(`Supabase Upsert Error: ${error.message} (Code: ${error.code})`);
      }
    } catch (e) {
      console.error("Supabase Save Project Error:", e);
      throw e;
    }
  },

  // 3. 更新或新增單一日報
  upsertLog: async (log: Log): Promise<void> => {
    try {
      const payload = {
        LogID: String(log.logId),
        Date: log.date,
        ProjectID: log.projectId,
        Engineer: log.engineer,
        TaskID: String(log.taskId || ''),
        Hours: Number(log.hours),
        Note: log.note || ''
      };

      const { error } = await supabase
        .from('Logs')
        .upsert(payload, { onConflict: 'LogID' });

      if (error) {
        throw new Error(`Supabase Upsert Log Error: ${error.message}`);
      }
    } catch (e) {
      console.error("Supabase Save Log Error:", e);
      throw e;
    }
  }
};

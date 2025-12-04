
import { supabase } from '../supabaseClient';
import { Project, Log } from '../types';

// 對應資料庫欄位的介面 (Supabase 回傳的格式通常為小寫)
interface DBProject {
  projectid: string;
  name: string;
  client: string;
  budgethours: number;
  status: string;
  startdate: string;
  enddate: string | null;
  details_json: any; // WBS, engineers, tasks, holidays
}

interface DBLog {
  logid: number;
  date: string;
  projectid: string;
  engineer: string;
  taskid: string;
  hours: number;
  note: string;
}

interface DBSettings {
  key: string;
  value: string;
  description: string;
}

export const SupabaseService = {
  // 1. 載入所有資料
  loadData: async (): Promise<{ projects: Project[], logs: Log[], adminPassword: string }> => {
    try {
      // 平行請求三個表格 (使用小寫名稱)
      const [projRes, logRes, setRes] = await Promise.all([
        supabase.from('projects').select('*'),
        supabase.from('logs').select('*'),
        supabase.from('settings').select('*').eq('key', 'AdminPassword').single()
      ]);

      if (projRes.error) {
        console.error("Projects Fetch Error:", projRes.error);
        throw projRes.error;
      }
      if (logRes.error) {
        console.error("Logs Fetch Error:", logRes.error);
        throw logRes.error;
      }

      // 轉換 Projects: DB 格式 (小寫) -> App 格式
      const projects: Project[] = (projRes.data as DBProject[]).map(p => ({
        id: p.projectid,
        name: p.name,
        client: p.client,
        budgetHours: p.budgethours,
        status: p.status as 'Active' | 'Closed',
        startDate: p.startdate,
        endDate: p.enddate,
        // 解構 JSON 欄位
        wbs: p.details_json?.wbs || [],
        engineers: p.details_json?.engineers || [],
        tasks: p.details_json?.tasks || [],
        holidays: p.details_json?.holidays || []
      }));

      // 轉換 Logs: DB 格式 (小寫) -> App 格式
      const logs: Log[] = (logRes.data as DBLog[]).map(l => ({
        logId: l.logid,
        date: l.date,
        projectId: l.projectid,
        engineer: l.engineer,
        taskId: l.taskid,
        hours: l.hours,
        note: l.note
      }));

      // 取得密碼
      let adminPassword = '8888';
      if (setRes.data) {
        adminPassword = (setRes.data as DBSettings).value;
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
      // 轉換為小寫欄位名稱
      const payload = {
        projectid: project.id,
        name: project.name,
        client: project.client || '',
        budgethours: project.budgetHours || 0,
        status: project.status,
        startdate: project.startDate,
        enddate: project.endDate,
        details_json: {
          wbs: project.wbs,
          engineers: project.engineers,
          tasks: project.tasks,
          holidays: project.holidays
        }
      };

      const { error } = await supabase
        .from('projects')
        .upsert(payload, { onConflict: 'projectid' });

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
        logid: log.logId,
        date: log.date,
        projectid: log.projectId,
        engineer: log.engineer,
        taskid: log.taskId || '',
        hours: log.hours,
        note: log.note || ''
      };

      const { error } = await supabase
        .from('logs')
        .upsert(payload, { onConflict: 'logid' });

      if (error) throw error;
    } catch (e) {
      console.error("Supabase Save Log Error:", e);
      throw e;
    }
  }
};

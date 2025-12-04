
import { supabase } from '../supabaseClient';
import { Project, Log, GlobalEngineer } from '../types';
import { CONFIG } from '../config';

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
  Value: string | number; 
  Description: string;
}

export const SupabaseService = {
  // 1. 載入所有資料
  loadData: async (): Promise<{ projects: Project[], logs: Log[], adminPassword: string, globalEngineers: GlobalEngineer[] }> => {
    try {
      const [projRes, logRes, setRes] = await Promise.all([
        supabase.from(CONFIG.SUPABASE.TABLES.PROJECTS).select('*'),
        supabase.from(CONFIG.SUPABASE.TABLES.LOGS).select('*'),
        supabase.from(CONFIG.SUPABASE.TABLES.SETTINGS).select('*') // 讀取所有設定
      ]);

      if (projRes.error) throw new Error(`Projects Error: ${projRes.error.message}`);
      if (logRes.error) throw new Error(`Logs Error: ${logRes.error.message}`);
      if (setRes.error) throw new Error(`Settings Error: ${setRes.error.message}`);

      // 轉換 Projects
      const projects: Project[] = (projRes.data as DBProject[]).map(p => {
        let details: any = {};
        try { details = p.Details_JSON ? JSON.parse(p.Details_JSON) : {}; } catch (e) {}
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

      // 解析 Settings
      let adminPassword = '8888';
      const globalEngineers: GlobalEngineer[] = [];

      (setRes.data as DBSettings[]).forEach(s => {
        if (s.Key === 'AdminPassword') {
          adminPassword = String(s.Value);
        } else if (s.Key.startsWith('User:')) {
          // 解析工程師設定: Key="User:Name", Value="Password", Description="Color"
          globalEngineers.push({
            name: s.Key.replace('User:', ''),
            password: String(s.Value),
            color: s.Description || '#3b82f6'
          });
        }
      });

      return { projects, logs, adminPassword, globalEngineers };
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
        .from(CONFIG.SUPABASE.TABLES.PROJECTS)
        .upsert(payload, { onConflict: 'ProjectID' });

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
        LogID: String(log.logId),
        Date: log.date,
        ProjectID: log.projectId,
        Engineer: log.engineer,
        TaskID: String(log.taskId || ''),
        Hours: Number(log.hours),
        Note: log.note || ''
      };

      const { error } = await supabase
        .from(CONFIG.SUPABASE.TABLES.LOGS)
        .upsert(payload, { onConflict: 'LogID' });

      if (error) throw new Error(`Upsert Log Error: ${error.message}`);
    } catch (e) {
      console.error("Save Log Error:", e);
      throw e;
    }
  },

  // 4. 管理全域工程師 (利用 prj_Settings)
  upsertGlobalEngineer: async (eng: GlobalEngineer): Promise<void> => {
    try {
      const payload = {
        Key: `User:${eng.name}`,
        Value: eng.password, // 密碼存於 Value
        Description: eng.color // 顏色存於 Description
      };
      const { error } = await supabase
        .from(CONFIG.SUPABASE.TABLES.SETTINGS)
        .upsert(payload, { onConflict: 'Key' });

      if (error) throw new Error(`Upsert Engineer Error: ${error.message}`);
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
        .eq('Key', `User:${name}`);

      if (error) throw new Error(`Delete Engineer Error: ${error.message}`);
    } catch (e) {
      console.error("Delete Engineer Error:", e);
      throw e;
    }
  }
};

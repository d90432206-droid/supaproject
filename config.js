
// 專案全域設定檔
// 未來若要修改資料表名稱或 API Key，請直接修改此處

export const CONFIG = {
  SUPABASE: {
    // Supabase URL (從您的截圖與之前的檔案取得)
    URL: 'https://fbpdjnreljhfgmdflfjl.supabase.co',
    
    // Supabase Anon Key
    KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZicGRqbnJlbGpoZmdtZGZsZmpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3NjY1OTUsImV4cCI6MjA4MDM0MjU5NX0.Ocy7vUZ3tURpPC2t7PQ4062r_zxtVSNehiYN2nT6blQ',
    
    // 資料表名稱設定 (全面改為小寫以符合 PostgreSQL 標準)
    TABLES: {
      PROJECTS: 'prj_projects',
      LOGS: 'prj_logs',
      SETTINGS: 'prj_settings',
      MESSAGES: 'prj_messages'
    }
  }
};

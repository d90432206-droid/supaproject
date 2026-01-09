
// 專案全域設定檔
// 未來若要修改資料表名稱或 API Key，請直接修改此處

export const CONFIG = {
  SUPABASE: {
    // 優先讀取環境變數，若無則讀取備用值 (Vite 專案環境變數需以 VITE_ 開頭)
    URL: import.meta.env.VITE_SUPABASE_URL || 'https://wcgdapjjzpzvjprzudyq.supabase.co',
    
    // Supabase Anon Key
    KEY: import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjZ2RhcGpqenB6dmpwcnp1ZHlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5NTc4ODEsImV4cCI6MjA4MzUzMzg4MX0._Nn91KgZjMCZfvr6189RY-GIy_l-PwZSAIrQ06SYJNY',


    
    // 資料表名稱設定 (全面改為小寫以符合 PostgreSQL 標準)
    TABLES: {
      PROJECTS: 'prj_projects',
      LOGS: 'prj_logs',
      SETTINGS: 'prj_settings',
      MESSAGES: 'prj_messages'
    }
  }
};

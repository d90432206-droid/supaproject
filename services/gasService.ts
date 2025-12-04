import { BackendData, Project, Log } from '../types';

// ============================================================================
// 設定區：請將 Apps Script 部署後的網址貼在下方
// 例如: "https://script.google.com/macros/s/AKfycbx.../exec"
// ============================================================================
const API_URL = "在此貼上你的GAS_WEB_APP_URL"; 

// Mock data for local development fallback
const DEMO_PROJECTS: Project[] = [{
  id: 'DEMO-01', name: '新官方網站改版', client: 'ABC 科技', budgetHours: 200, status: 'Active',
  startDate: new Date().toISOString().split('T')[0], endDate: null,
  wbs: [{id:1, name:'需求分析', collapsed:false}, {id:2, name:'視覺設計', collapsed:false}, {id:3, name:'前端開發', collapsed:false}],
  engineers: [{id:'e1', name:'Alex', color:'#10b981'}, {id:'e2', name:'Bob', color:'#3b82f6'}],
  tasks: [], holidays: []
}];

const DEMO_LOGS: Log[] = [
  { logId: Date.now(), date: new Date().toISOString().split('T')[0], engineer: 'Alex', projectId: 'DEMO-01', hours: 4, taskId: '', note: '首頁切版' }
];

export const GasService = {
  loadData: async (): Promise<{ projects: Project[], logs: Log[], adminPassword: string }> => {
    // 1. 如果沒有設定 API URL，使用 Mock Data
    if (!API_URL || API_URL.includes("在此貼上")) {
      console.warn('API_URL 未設定，使用本機測試資料。');
      return new Promise(resolve => {
        setTimeout(() => {
          const storedP = localStorage.getItem('pm_projects');
          const storedL = localStorage.getItem('pm_logs');
          resolve({
            projects: storedP ? JSON.parse(storedP) : DEMO_PROJECTS,
            logs: storedL ? JSON.parse(storedL) : DEMO_LOGS,
            adminPassword: '8888'
          });
        }, 800);
      });
    }

    // 2. 使用 fetch 呼叫 Google Apps Script (GET)
    try {
      const response = await fetch(API_URL, {
        method: "GET",
      });
      
      if (!response.ok) throw new Error("Network response was not ok");
      
      const data = await response.json();
      
      // GAS 返回的資料已經是 JSON 物件，不需要再次 parse 字串 (除非後端回傳的是字串化的 JSON)
      // 注意：上面的 Code.gs 修改後回傳的是直接的 JSON 物件
      return {
        projects: data.projects || [],
        logs: data.logs || [],
        adminPassword: String(data.adminPassword || '8888')
      };
    } catch (e) {
      console.error("Fetch error", e);
      throw e;
    }
  },

  saveData: async (projects: Project[], logs: Log[]): Promise<void> => {
    // 1. 本機模式
    if (!API_URL || API_URL.includes("在此貼上")) {
      localStorage.setItem('pm_projects', JSON.stringify(projects));
      localStorage.setItem('pm_logs', JSON.stringify(logs));
      return Promise.resolve();
    }

    // 2. 呼叫 GAS (POST)
    // 注意：使用 text/plain 以避免瀏覽器發送 OPTIONS 預檢請求 (CORS 簡單請求策略)
    try {
      const payload = JSON.stringify({ projects, logs });
      
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8', 
        },
        body: payload
      });

      if (!response.ok) throw new Error("Save failed");
      // 等待回應確保儲存完成
      await response.json();
    } catch (e) {
      console.error("Save error", e);
      throw e;
    }
  }
};
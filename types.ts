
export interface Engineer {
  id: string;
  name: string;
  color: string;
}

// 新增全域工程師定義 (包含密碼)
export interface GlobalEngineer {
  name: string;
  password: string;
  color: string;
}

export interface Task {
  id: number;
  title: string;
  assignee: string; // Engineer ID (matches GlobalEngineer.name or specific ID)
  startDate: string; // YYYY-MM-DD
  duration: number; // Days
  hours: number; // Estimated hours
  actualHours: number;
  progress: number; // 0-100
  category: string; // WBS Category Name
}

export interface WBSCategory {
  id: number | string;
  name: string;
  collapsed: boolean;
}

export interface Project {
  id: string;
  name: string;
  client: string;
  budgetHours: number;
  status: 'Active' | 'Closed';
  startDate: string;
  endDate: string | null;
  wbs: WBSCategory[];
  engineers: Engineer[];
  tasks: Task[];
  holidays: string[];
}

export interface Log {
  logId: number;
  date: string;
  engineer: string; // Name
  projectId: string;
  taskId: string | number; // Task ID
  hours: number;
  note: string;
}

// 系統公告
export interface SystemMessage {
  id: string;
  content: string;
  date: string;
  author: string;
}

export interface LoginData {
  isLoggedIn: boolean;
  role: 'Admin' | 'Engineer';
  name: string;
  user: string; // The authenticated name
}

export type ViewState = 'dashboard' | 'projects' | 'wbs-editor' | 'timelog';

export interface BackendData {
  projects: Project[];
  logs: Log[];
  adminPassword: string;
  globalEngineers: GlobalEngineer[]; 
  messages: SystemMessage[]; // 新增此欄位
}

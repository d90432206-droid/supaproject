
import React, { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { ProjectList } from './components/ProjectList';
import { WBSEditor } from './components/WBSEditor';
import { TimeLog } from './components/TimeLog';
import { SupabaseService } from './services/supabaseService'; // Changed import
import { Project, Log, LoginData, ViewState } from './types';

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [adminPassword, setAdminPassword] = useState('8888');
  
  const [currentView, setCurrentView] = useState<ViewState>('dashboard');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);
  
  const [loginData, setLoginData] = useState<LoginData>({
    isLoggedIn: false, role: 'Engineer', name: '', user: ''
  });
  const [loginInputPass, setLoginInputPass] = useState('');

  // Initial Data Load
  useEffect(() => {
    SupabaseService.loadData()
      .then(data => {
        setProjects(data.projects);
        setLogs(data.logs);
        setAdminPassword(data.adminPassword);
        setIsOnline(true);
      })
      .catch(err => {
        console.error("Load failed full error:", err);
        const errorMsg = err instanceof Error ? err.message : JSON.stringify(err);
        // 若連線失敗，可能是 API Key 或 Table 不存在，顯示清楚的訊息
        if (!isOnline) {
             // 這裡不使用 alert 避免進入頁面就一直跳窗，僅在 Console 顯示
             console.error("Supabase 連線失敗:", errorMsg);
        }
        setIsOnline(false); 
      })
      .finally(() => setIsLoading(false));
  }, []);

  const handleLogin = () => {
    if (loginData.role === 'Admin') {
      if (loginInputPass === adminPassword) {
        setLoginData({ ...loginData, isLoggedIn: true, user: '管理員' });
      } else {
        alert('密碼錯誤');
      }
    } else {
      if (!loginData.name.trim()) return alert('請輸入姓名');
      // Verify engineer exists in at least one project
      const exists = projects.some(p => p.engineers?.some(e => e.name === loginData.name));
      if (exists) {
        setLoginData({ ...loginData, isLoggedIn: true, user: loginData.name });
      } else {
        alert('找不到此工程師姓名，請確認您已在專案成員名單中。');
      }
    }
  };

  // 修改：不再全量儲存，而是針對單一項目更新
  const handleProjectSave = async (p: Project, isNew: boolean) => {
    // 1. Optimistic Update (UI 先變)
    let newProjects = [...projects];
    if (isNew) {
      if (newProjects.some(x => x.id === p.id)) return alert('專案編號重複');
      newProjects.push(p);
    } else {
      const idx = newProjects.findIndex(x => x.id === p.id);
      if (idx !== -1) newProjects[idx] = p;
    }
    setProjects(newProjects);

    // 2. Call Supabase
    setIsLoading(true);
    try {
        await SupabaseService.upsertProject(p);
    } catch (e: any) {
        // 顯示可閱讀的錯誤訊息
        const msg = e.message || JSON.stringify(e);
        alert('儲存失敗: ' + msg + '\n\n(可能是權限不足，請檢查 Supabase RLS 設定)');
        console.error("Save Project Error:", e);
        // 若失敗可能需要還原 State (此處省略複雜還原邏輯)
    } finally {
        setIsLoading(false);
    }
  };

  const handleLogSubmit = async (log: Partial<Log>) => {
    // 準備完整的 Log 物件
    const newLogItem = log.logId 
        ? (log as Log) 
        : { ...log, logId: Date.now() } as Log;

    // 1. Optimistic Update
    let newLogs = [...logs];
    if (log.logId) {
      const idx = newLogs.findIndex(l => l.logId === log.logId);
      if (idx !== -1) newLogs[idx] = newLogItem;
    } else {
      newLogs.push(newLogItem);
    }
    setLogs(newLogs);

    // 2. Call Supabase
    setIsLoading(true);
    try {
        await SupabaseService.upsertLog(newLogItem);
    } catch (e: any) {
        const msg = e.message || JSON.stringify(e);
        alert('儲存失敗: ' + msg);
        console.error("Save Log Error:", e);
    } finally {
        setIsLoading(false);
    }
  };

  if (!loginData.isLoggedIn) {
    return (
      <div className="fixed inset-0 z-[200] bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-300">
          <div className="bg-brand-600 p-8 text-center relative overflow-hidden">
             <div className="relative z-10 flex flex-col items-center">
                 {/* Logo Replacement */}
                 <div className="w-24 h-24 mb-4 bg-white rounded-xl shadow-lg flex items-center justify-center p-2">
                    <img src="/logo.png" alt="Logo" className="w-full h-full object-contain" />
                 </div>
                 <h1 className="text-2xl font-bold text-white tracking-wide">Chuyi System</h1>
                 <p className="text-brand-100 text-sm mt-2 font-medium">制宜電測專案管理系統</p>
             </div>
             <div className="absolute -right-10 -top-10 w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
          </div>
          <div className="p-8 relative">
              {isLoading && (
                  <div className="absolute inset-0 bg-white/80 backdrop-blur-[2px] z-50 flex flex-col items-center justify-center">
                    <i className="fa-solid fa-circle-notch fa-spin text-brand-600 text-3xl mb-3"></i>
                    <p className="text-xs text-slate-500 font-bold animate-pulse">系統資料同步中...</p>
                  </div>
              )}
              <div className="mb-6">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">身份選擇</label>
                <div className="flex bg-slate-100 p-1 rounded-lg">
                  <button onClick={() => setLoginData({...loginData, role: 'Engineer'})} className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${loginData.role === 'Engineer' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-400'}`}>工程師</button>
                  <button onClick={() => setLoginData({...loginData, role: 'Admin'})} className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${loginData.role === 'Admin' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-400'}`}>管理員</button>
                </div>
              </div>
              
              {loginData.role === 'Admin' ? (
                <div className="mb-6 animate-in slide-in-from-right-2 fade-in duration-300">
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">管理密碼</label>
                  <input type="password" value={loginInputPass} onChange={e => setLoginInputPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} placeholder="請輸入管理密碼" className="w-full border border-slate-200 rounded-lg px-4 py-3 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all font-mono" />
                </div>
              ) : (
                <div className="mb-6 animate-in slide-in-from-left-2 fade-in duration-300">
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">工程師姓名</label>
                  <input type="text" value={loginData.name} onChange={e => setLoginData({...loginData, name: e.target.value})} onKeyDown={e => e.key === 'Enter' && handleLogin()} placeholder="請輸入您的姓名" className="w-full border border-slate-200 rounded-lg px-4 py-3 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all" />
                </div>
              )}

              <button onClick={handleLogin} className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-slate-900/20 transition-all active:scale-95 flex items-center justify-center">
                  <span>登入系統</span>
                  <i className="fa-solid fa-arrow-right ml-2"></i>
              </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Layout 
      loginData={loginData} 
      currentView={currentView} 
      setView={setCurrentView} 
      onLogout={() => setLoginData({...loginData, isLoggedIn: false})}
      isOnline={isOnline}
      isLoading={isLoading}
    >
      {currentView === 'dashboard' && <Dashboard projects={projects} logs={logs} />}
      {currentView === 'projects' && (
        <ProjectList 
          projects={projects} 
          loginData={loginData} 
          onSaveProject={handleProjectSave}
          onOpenWBS={(p) => { setSelectedProject(p); setCurrentView('wbs-editor'); }}
        />
      )}
      {currentView === 'wbs-editor' && selectedProject && (
        <WBSEditor 
          project={selectedProject}
          isAdmin={loginData.role === 'Admin'}
          onClose={() => setCurrentView('projects')}
          onUpdate={(updatedP) => handleProjectSave(updatedP, false)}
        />
      )}
      {currentView === 'timelog' && (
        <TimeLog 
          projects={projects} 
          logs={logs} 
          loginData={loginData} 
          onSubmitLog={handleLogSubmit} 
        />
      )}
    </Layout>
  );
}

export default App;

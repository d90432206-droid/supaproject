
import React, { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { ProjectList } from './components/ProjectList';
import { WBSEditor } from './components/WBSEditor';
import { TimeLog } from './components/TimeLog';
import { SupabaseService } from './services/supabaseService';
import { Project, Log, LoginData, ViewState, GlobalEngineer, SystemMessage } from './types';

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [adminPassword, setAdminPassword] = useState('8888');
  const [globalEngineers, setGlobalEngineers] = useState<GlobalEngineer[]>([]);
  const [systemMessages, setSystemMessages] = useState<SystemMessage[]>([]);

  const [currentView, setCurrentView] = useState<ViewState>('dashboard');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);

  const [loginData, setLoginData] = useState<LoginData>({
    isLoggedIn: false, role: 'Engineer', name: '', user: ''
  });
  const [loginInputPass, setLoginInputPass] = useState('');

  // Admin Engineer Management Modal State
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [editingEngineer, setEditingEngineer] = useState<Partial<GlobalEngineer>>({});

  // Initial Data Load
  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = () => {
    setIsLoading(true);
    SupabaseService.loadData()
      .then(data => {
        setProjects(data.projects);
        setLogs(data.logs);
        setAdminPassword(data.adminPassword);
        setGlobalEngineers(data.globalEngineers);
        setSystemMessages(data.messages);
        setIsOnline(true);
      })
      .catch(err => {
        console.error("Load failed full error:", err);
        const errorMsg = err instanceof Error ? err.message : JSON.stringify(err);
        if (!isOnline) {
          console.error("Supabase 連線失敗:", errorMsg);
        }
        setIsOnline(false);
      })
      .finally(() => setIsLoading(false));
  };

  const handleLogin = () => {
    if (loginData.role === 'Admin') {
      if (loginInputPass === adminPassword) {
        setLoginData({ ...loginData, isLoggedIn: true, user: '管理員' });
      } else {
        alert('密碼錯誤');
      }
    } else {
      if (!loginData.name.trim()) return alert('請輸入姓名');

      // 1. 驗證全域工程師名單
      const eng = globalEngineers.find(e => e.name === loginData.name);

      if (!eng) {
        return alert('找不到此工程師帳號，請聯繫管理員建立。');
      }

      // 2. 驗證密碼
      if (loginInputPass !== eng.password) {
        return alert('密碼錯誤');
      }

      setLoginData({ ...loginData, isLoggedIn: true, user: loginData.name });
    }
  };

  const handleProjectSave = async (p: Project, isNew: boolean) => {
    let newProjects = [...projects];
    if (isNew) {
      if (newProjects.some(x => x.id === p.id)) return alert('專案編號重複');
      newProjects.push(p);
    } else {
      const idx = newProjects.findIndex(x => x.id === p.id);
      if (idx !== -1) newProjects[idx] = p;
    }
    setProjects(newProjects);

    // Fix: Update selectedProject so WBSEditor receives new prop and clears unsaved flag
    if (selectedProject && selectedProject.id === p.id) {
      setSelectedProject(p);
    }

    setIsLoading(true);
    try {
      await SupabaseService.upsertProject(p);
    } catch (e: any) {
      const msg = e.message || JSON.stringify(e);
      console.error("Save Project Error:", e);

      if (msg.includes('42501') || msg.includes('row-level security')) {
        alert('儲存失敗：權限不足 (Code 42501)\n\n請到 Supabase 後台 SQL Editor 執行開啟權限的 SQL 指令。');
      } else {
        alert('儲存失敗: ' + msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteProjects = async (ids: string[], passwordInput: string): Promise<boolean> => {
    // 驗證管理員密碼
    if (passwordInput !== adminPassword) {
      alert('密碼錯誤，刪除已取消');
      return false;
    }

    setIsLoading(true);
    try {
      // API Delete
      await SupabaseService.deleteProjects(ids);

      // UI Update - Project List
      setProjects(prev => prev.filter(p => !ids.includes(p.id)));

      // UI Update - Remove related logs to ensure clean state (Fix orphan logs issue)
      setLogs(prev => prev.filter(l => !ids.includes(l.projectId)));

      // 如果刪除的包含目前選取的，清除選取
      if (selectedProject && ids.includes(selectedProject.id)) {
        setSelectedProject(null);
        setCurrentView('projects');
      }

      alert(`成功刪除 ${ids.length} 個專案及關聯的工時紀錄`);
      return true;
    } catch (e: any) {
      alert('刪除失敗: ' + (e.message || JSON.stringify(e)));
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogSubmit = async (log: Partial<Log>) => {
    const newLogItem = log.logId
      ? (log as Log)
      : { ...log, logId: Date.now() } as Log;

    let newLogs = [...logs];
    if (log.logId) {
      const idx = newLogs.findIndex(l => l.logId === log.logId);
      if (idx !== -1) newLogs[idx] = newLogItem;
    } else {
      newLogs.push(newLogItem);
    }
    setLogs(newLogs);

    setIsLoading(true);
    try {
      await SupabaseService.upsertLog(newLogItem);
    } catch (e: any) {
      const msg = e.message || JSON.stringify(e);
      if (msg.includes('42501') || msg.includes('row-level security')) {
        alert('儲存失敗：權限不足 (Code 42501)');
      } else {
        alert('儲存失敗: ' + msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Engineer Management Handlers
  const handleSaveEngineer = async () => {
    if (!editingEngineer.name || !editingEngineer.password) return alert('請輸入姓名與密碼');

    const newEng: GlobalEngineer = {
      name: editingEngineer.name,
      password: editingEngineer.password,
      color: editingEngineer.color || '#3b82f6'
    };

    // UI Update
    const exists = globalEngineers.some(e => e.name === newEng.name);
    let newList = [...globalEngineers];
    if (exists) {
      newList = newList.map(e => e.name === newEng.name ? newEng : e);
    } else {
      newList.push(newEng);
    }
    setGlobalEngineers(newList);
    setEditingEngineer({}); // Reset form

    // API Update
    try {
      await SupabaseService.upsertGlobalEngineer(newEng);
    } catch (e: any) {
      const msg = e.message || JSON.stringify(e);
      console.error("Save Engineer Full Error:", e);

      if (msg.includes('42501') || msg.includes('row-level security')) {
        alert(`儲存失敗：權限不足 (Code 42501)\n\n請確認 prj_Settings 表格已開啟 RLS 並設定 "Public Access" Policy。`);
      } else {
        alert(`工程師資料儲存失敗\n錯誤原因: ${msg}`);
      }
      loadAllData(); // Revert on error
    }
  };

  const handleDeleteEngineer = async (name: string) => {
    if (!confirm(`確定要刪除工程師 ${name} 嗎？`)) return;

    // UI Update
    setGlobalEngineers(globalEngineers.filter(e => e.name !== name));

    // API Update
    try {
      await SupabaseService.deleteGlobalEngineer(name);
    } catch (e) {
      alert('刪除失敗');
      loadAllData();
    }
  };

  // Message Handlers
  const handleSaveMessage = async (content: string) => {
    const newMessage: SystemMessage = {
      id: Date.now().toString(),
      content,
      date: new Date().toISOString().split('T')[0],
      author: loginData.user
    };

    // UI Update
    setSystemMessages([newMessage, ...systemMessages]);

    // API
    try {
      await SupabaseService.upsertMessage(newMessage);
    } catch (e: any) {
      const msg = e.message || JSON.stringify(e);
      if (msg.includes('42501')) {
        alert('發布公告失敗：權限不足 (請檢查 prj_Messages RLS 設定)');
      } else {
        alert('發布公告失敗: ' + msg);
      }
      loadAllData();
    }
  };

  const handleDeleteMessage = async (id: string) => {
    if (!confirm("確定刪除此公告?")) return;

    // UI
    setSystemMessages(systemMessages.filter(m => m.id !== id));

    // API
    try {
      await SupabaseService.deleteMessage(id);
    } catch (e) {
      alert('刪除公告失敗');
      loadAllData();
    }
  };

  if (!loginData.isLoggedIn) {
    return (
      <div className="fixed inset-0 z-[200] bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-300">
          <div className="bg-brand-600 p-8 text-center relative overflow-hidden">
            <div className="relative z-10 flex flex-col items-center">
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
                <button onClick={() => { setLoginData({ ...loginData, role: 'Engineer' }); setLoginInputPass(''); }} className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${loginData.role === 'Engineer' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-400'}`}>工程師</button>
                <button onClick={() => { setLoginData({ ...loginData, role: 'Admin' }); setLoginInputPass(''); }} className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${loginData.role === 'Admin' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-400'}`}>管理員</button>
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
                <input type="text" value={loginData.name} onChange={e => setLoginData({ ...loginData, name: e.target.value })} placeholder="請輸入您的姓名" className="w-full border border-slate-200 rounded-lg px-4 py-3 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all mb-4" />

                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">登入密碼</label>
                <input type="password" value={loginInputPass} onChange={e => setLoginInputPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} placeholder="請輸入個人密碼" className="w-full border border-slate-200 rounded-lg px-4 py-3 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all font-mono" />
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
    <>
      <Layout
        loginData={loginData}
        currentView={currentView}
        setView={setCurrentView}
        onLogout={() => { setLoginData({ ...loginData, isLoggedIn: false }); setLoginInputPass(''); }}
        onOpenAdminPanel={() => setShowAdminPanel(true)}
        isOnline={isOnline}
        isLoading={isLoading}
      >
        {currentView === 'dashboard' && (
          <Dashboard
            projects={projects}
            logs={logs}
            messages={systemMessages}
            loginData={loginData}
            onAddMessage={handleSaveMessage}
            onDeleteMessage={handleDeleteMessage}
          />
        )}
        {currentView === 'projects' && (
          <ProjectList
            projects={projects}
            loginData={loginData}
            onSaveProject={handleProjectSave}
            onDeleteProjects={handleDeleteProjects}
            onOpenWBS={(p) => { setSelectedProject(p); setCurrentView('wbs-editor'); }}
          />
        )}
        {currentView === 'wbs-editor' && selectedProject && (
          <WBSEditor
            project={selectedProject}
            logs={logs} // Pass logs for weekly stats
            globalEngineers={globalEngineers}
            loginData={loginData}
            onClose={() => setCurrentView('projects')}
            onUpdate={(updatedP) => handleProjectSave(updatedP, false)}
          />
        )}
        {currentView === 'timelog' && (
          <TimeLog
            projects={projects}
            logs={logs}
            loginData={loginData}
            engineers={globalEngineers}
            onSubmitLog={handleLogSubmit}
          />
        )}
      </Layout>

      {/* Admin Member Management Modal */}
      {showAdminPanel && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-slate-800">成員管理 (工程師)</h3>
              <button onClick={() => setShowAdminPanel(false)} className="text-slate-400 hover:text-slate-600">
                <i className="fa-solid fa-times text-xl"></i>
              </button>
            </div>

            {/* Form */}
            <div className="bg-slate-50 p-4 rounded-lg mb-6 border border-slate-200">
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase block mb-1">姓名 (ID)</label>
                  <input value={editingEngineer.name || ''} onChange={e => setEditingEngineer({ ...editingEngineer, name: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" placeholder="輸入姓名" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase block mb-1">密碼</label>
                  <input value={editingEngineer.password || ''} onChange={e => setEditingEngineer({ ...editingEngineer, password: e.target.value })} className="w-full border rounded px-3 py-2 text-sm font-mono" placeholder="設定密碼" />
                </div>
              </div>
              <div className="mb-3">
                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">代表色</label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={editingEngineer.color || '#3b82f6'} onChange={e => setEditingEngineer({ ...editingEngineer, color: e.target.value })} className="h-9 w-16 cursor-pointer border rounded" />
                  <span className="text-xs text-slate-400">用於甘特圖顯示</span>
                </div>
              </div>
              <button onClick={handleSaveEngineer} className="w-full bg-brand-600 hover:bg-brand-700 text-white font-bold py-2 rounded text-sm shadow">
                <i className="fa-solid fa-plus mr-1"></i> 新增 / 更新成員
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto custom-scroll border-t border-slate-100 pt-4">
              {globalEngineers.length === 0 ? (
                <p className="text-center text-slate-400 text-sm">目前無成員資料</p>
              ) : (
                <table className="w-full text-sm text-left table-fixed">
                  <thead className="text-xs text-slate-500 uppercase shadow-sm">
                    <tr>
                      <th className="py-2 w-[30%] pl-2 bg-white border-b border-slate-100 z-20 sticky top-0">姓名</th>
                      <th className="py-2 w-[30%] bg-white border-b border-slate-100 z-20 sticky top-0">密碼</th>
                      <th className="py-2 w-[15%] bg-white border-b border-slate-100 z-20 sticky top-0">顏色</th>
                      <th className="py-2 w-[25%] text-right pr-2 bg-white border-b border-slate-100 z-20 sticky top-0">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {globalEngineers.map(eng => (
                      <tr key={eng.name} className="hover:bg-slate-50">
                        <td className="py-2 font-bold text-slate-700 w-[30%] pl-2 truncate" title={eng.name}>{eng.name}</td>
                        <td className="py-2 font-mono text-slate-500 w-[30%] truncate">{eng.password}</td>
                        <td className="py-2 w-[15%]"><div className="w-4 h-4 rounded-full" style={{ backgroundColor: eng.color }}></div></td>
                        <td className="py-2 text-right w-[25%] flex justify-end gap-2 pr-2">
                          <button onClick={() => setEditingEngineer({ ...eng })} className="text-brand-600 hover:underline text-xs">編輯</button>
                          <button onClick={() => handleDeleteEngineer(eng.name)} className="text-red-500 hover:underline text-xs">刪除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;

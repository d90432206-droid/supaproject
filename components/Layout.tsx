
import React, { useState } from 'react';
import { LoginData, ViewState } from '../types';

interface LayoutProps {
  children: React.ReactNode;
  loginData: LoginData;
  currentView: ViewState;
  setView: (view: ViewState) => void;
  onLogout: () => void;
  onOpenAdminPanel?: () => void;
  isOnline: boolean;
  isLoading: boolean;
}

export const Layout: React.FC<LayoutProps> = ({ 
  children, loginData, currentView, setView, onLogout, onOpenAdminPanel, isOnline, isLoading 
}) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const handleNavClick = (view: ViewState) => {
    setView(view);
    setIsSidebarOpen(false); // Close sidebar on mobile after selection
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-slate-900 text-white flex items-center justify-between px-4 z-50 shadow-md">
        <div className="flex items-center">
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="text-slate-300 hover:text-white mr-4 p-2">
            <i className="fa-solid fa-bars text-xl"></i>
          </button>
          <span className="font-bold text-lg">Chuyi System</span>
        </div>
        <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-xs font-bold">
            {loginData.user.charAt(0).toUpperCase()}
        </div>
      </div>

      {/* Sidebar Backdrop (Mobile only) */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm"
          onClick={() => setIsSidebarOpen(false)}
        ></div>
      )}

      {/* Sidebar */}
      <aside className={`
        fixed md:static inset-y-0 left-0 z-50 w-64 bg-slate-900 text-slate-300 flex flex-col shrink-0 transition-transform duration-300 transform 
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} 
        md:translate-x-0 shadow-xl md:shadow-none
      `}>
        <div className="h-20 flex items-center px-6 border-b border-slate-800">
          <img 
            src="/logo.png" 
            alt="Logo" 
            className="w-10 h-10 object-contain mr-4 shrink-0 bg-white rounded-md p-1"
          />
          <div>
            <h1 className="font-bold text-white text-lg tracking-tight leading-tight">Chuyi System</h1>
            <div className="text-[11px] text-slate-500 font-medium">專案管理模組</div>
          </div>
        </div>

        <div className="px-6 py-6 border-b border-slate-800/50 bg-slate-800/20">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white flex items-center justify-center font-bold text-xl shadow-lg border-2 border-slate-700">
              {loginData.user.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="text-lg font-bold text-white leading-tight">{loginData.user}</div>
              <div className="text-xs text-brand-400 font-bold mt-0.5 uppercase tracking-wide bg-slate-800 inline-block px-1.5 py-0.5 rounded">
                {loginData.role === 'Admin' ? '系統管理員' : '工程師'}
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 py-6 space-y-1 overflow-y-auto">
          <NavItem 
            icon="fa-chart-pie" 
            label="營運儀表板" 
            isActive={currentView === 'dashboard'} 
            onClick={() => handleNavClick('dashboard')} 
          />
          <NavItem 
            icon="fa-folder-tree" 
            label="專案與 WBS" 
            isActive={currentView === 'projects' || currentView === 'wbs-editor'} 
            onClick={() => handleNavClick('projects')} 
          />
          <NavItem 
            icon="fa-stopwatch" 
            label="工時日報表" 
            isActive={currentView === 'timelog'} 
            onClick={() => handleNavClick('timelog')} 
          />
          
          {/* Admin Only Button */}
          {loginData.role === 'Admin' && (
            <div className="mt-6 px-6">
              <button onClick={() => { onOpenAdminPanel?.(); setIsSidebarOpen(false); }} className="w-full border border-slate-700 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors py-2 rounded text-xs font-bold flex items-center justify-center">
                <i className="fa-solid fa-users-gear mr-2"></i> 成員管理
              </button>
            </div>
          )}
        </nav>

        <div className="p-6 border-t border-slate-800 bg-slate-950/30">
          <div className="flex items-center gap-2 mb-3">
            <div className={`w-3 h-3 rounded-full animate-pulse shadow-[0_0_8px_rgba(0,0,0,0.5)] ${isOnline ? 'bg-emerald-500 shadow-emerald-500/50' : 'bg-amber-500 shadow-amber-500/50'}`}></div>
            <span className="font-bold text-sm text-slate-200">{isOnline ? 'Supabase DB 連線中' : '連線中斷'}</span>
          </div>
          {isLoading && (
            <p className="text-brand-400 text-xs font-medium animate-pulse mb-3">
              <i className="fa-solid fa-circle-notch fa-spin mr-1"></i> 資料同步中...
            </p>
          )}
          <button onClick={onLogout} className="w-full text-left text-red-400 hover:text-red-300 hover:bg-red-950/30 px-3 py-2 rounded transition-colors flex items-center gap-2 text-xs font-bold">
            <i className="fa-solid fa-sign-out-alt"></i> 登出系統
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-slate-50 relative w-full pt-16 md:pt-0">
        {children}
      </main>
    </div>
  );
};

const NavItem = ({ icon, label, isActive, onClick }: { icon: string, label: string, isActive: boolean, onClick: () => void }) => (
  <a onClick={onClick} className={`flex items-center px-6 py-4 cursor-pointer hover:bg-slate-800 hover:text-white transition-colors group ${isActive ? 'bg-slate-850 text-white border-r-4 border-brand-500' : 'text-slate-300'}`}>
    <i className={`fa-solid ${icon} w-6 text-lg group-hover:scale-110 transition-transform duration-200`}></i>
    <span className="font-bold text-sm tracking-wide ml-2">{label}</span>
  </a>
);

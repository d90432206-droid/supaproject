
import React from 'react';
import { LoginData, ViewState } from '../types';

interface LayoutProps {
  children: React.ReactNode;
  loginData: LoginData;
  currentView: ViewState;
  setView: (view: ViewState) => void;
  onLogout: () => void;
  isOnline: boolean;
  isLoading: boolean;
}

export const Layout: React.FC<LayoutProps> = ({ 
  children, loginData, currentView, setView, onLogout, isOnline, isLoading 
}) => {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col shrink-0 transition-all duration-300 relative z-40">
        <div className="h-20 flex items-center px-6 border-b border-slate-800">
          {/* Brand Logo - Image Replacement */}
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

        <nav className="flex-1 py-6 space-y-1">
          <NavItem 
            icon="fa-chart-pie" 
            label="營運儀表板" 
            isActive={currentView === 'dashboard'} 
            onClick={() => setView('dashboard')} 
          />
          <NavItem 
            icon="fa-folder-tree" 
            label="專案與 WBS" 
            isActive={currentView === 'projects' || currentView === 'wbs-editor'} 
            onClick={() => setView('projects')} 
          />
          <NavItem 
            icon="fa-stopwatch" 
            label="工時日報表" 
            isActive={currentView === 'timelog'} 
            onClick={() => setView('timelog')} 
          />
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
      <main className="flex-1 flex flex-col overflow-hidden bg-slate-50 relative">
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

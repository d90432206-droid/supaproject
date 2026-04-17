import React, { useState, useMemo } from 'react';
import { Project, Log, GlobalEngineer, LoginData } from '../types';
import { SupabaseService } from '../services/supabaseService';

interface ProjectSummaryProps {
  projects: Project[];
  logs: Log[];
  engineers: GlobalEngineer[];
  loginData: LoginData;
}

export const ProjectSummary: React.FC<ProjectSummaryProps> = ({ projects, logs, engineers, loginData }) => {
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const closedProjects = useMemo(() => projects.filter(p => p.status === 'Closed'), [projects]);

  const selectedProject = useMemo(() => 
    projects.find(p => p.id === selectedProjectId), 
    [projects, selectedProjectId]
  );

  const stats = useMemo(() => {
    if (!selectedProject) return null;

    const projectLogs = logs.filter(l => l.projectId === selectedProject.id);
    
    // Create a map of engineer to department for quick lookup
    const engDeptMap = new Map(engineers.map(e => [e.name, e.department || 'Unknown']));

    const deptStats: Record<string, { budget: number, actual: number }> = {
      'ATS': { budget: selectedProject.budgetATS || 0, actual: 0 },
      'CHS': { budget: selectedProject.budgetCHS || 0, actual: 0 },
      'CPD': { budget: selectedProject.budgetCPD || 0, actual: 0 },
      'MFG': { budget: selectedProject.budgetMFG || 0, actual: 0 },
      'Other': { budget: 0, actual: 0 }
    };

    const memberStats: Record<string, { department: string, hours: number }> = {};

    projectLogs.forEach(log => {
      const dept = engDeptMap.get(log.engineer) || 'Other';
      
      // Update department stats
      if (deptStats[dept]) {
        deptStats[dept].actual += log.hours;
      } else {
        deptStats['Other'].actual += log.hours;
      }

      // Update member stats
      if (!memberStats[log.engineer]) {
        memberStats[log.engineer] = { department: dept, hours: 0 };
      }
      memberStats[log.engineer].hours += log.hours;
    });

    return { deptStats, memberStats, totalActual: projectLogs.reduce((sum, l) => sum + l.hours, 0) };
  }, [selectedProject, logs, engineers]);

  const handleAIAnalysis = async () => {
    if (!selectedProject) return;
    setIsAnalyzing(true);
    setAiAnalysis('');
    try {
      const params = {
        action: 'PROJECT_QUERY',
        projectId: selectedProject.id,
        startDate: selectedProject.startDate,
        endDate: selectedProject.endDate || undefined
      };
      const result = await SupabaseService.generateAIAnalysis(params);
      setAiAnalysis(result);
    } catch (e: any) {
      alert("AI 分析失敗: " + e.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-8 animate-in fade-in duration-500 overflow-y-auto max-h-screen custom-scroll">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">專案完工結案統計</h2>
          <p className="text-slate-500 mt-1 font-medium">分析各部門預估工時與成員實績之達成效益</p>
        </div>
        
        <div className="flex items-center gap-3">
          <label className="text-sm font-bold text-slate-600 uppercase tracking-wider">選擇結案專案:</label>
          <select 
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="bg-white border-2 border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 focus:border-brand-500 outline-none shadow-sm transition-all"
          >
            <option value="">-- 請選擇專案 --</option>
            {closedProjects.map(p => (
              <option key={p.id} value={p.id}>[{p.id}] {p.name}</option>
            ))}
          </select>
        </div>
      </header>

      {!selectedProject ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border-2 border-dashed border-slate-200">
          <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4">
            <i className="fa-solid fa-file-contract text-3xl text-slate-300"></i>
          </div>
          <p className="text-slate-400 font-bold">請從上方選單選擇一個已結案的專案以查看統計數據</p>
        </div>
      ) : stats && (
        <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-5">
              <div className="w-14 h-14 bg-brand-50 rounded-xl flex items-center justify-center text-brand-600 text-2xl">
                <i className="fa-solid fa-clock"></i>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">總預算工時</div>
                <div className="text-2xl font-black text-slate-900">{selectedProject.budgetHours} <span className="text-sm font-bold text-slate-400">H</span></div>
              </div>
            </div>
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-5">
              <div className="w-14 h-14 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 text-2xl">
                <i className="fa-solid fa-stopwatch"></i>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">總實際工時</div>
                <div className="text-2xl font-black text-slate-900">{stats.totalActual} <span className="text-sm font-bold text-slate-400">H</span></div>
              </div>
            </div>
            <div className={`bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-5`}>
              <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-2xl ${stats.totalActual > selectedProject.budgetHours ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'}`}>
                <i className={`fa-solid ${stats.totalActual > selectedProject.budgetHours ? 'fa-triangle-exclamation' : 'fa-check-circle'}`}></i>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">工時達成率</div>
                <div className={`text-2xl font-black ${stats.totalActual > selectedProject.budgetHours ? 'text-rose-600' : 'text-blue-600'}`}>
                  {((stats.totalActual / (selectedProject.budgetHours || 1)) * 100).toFixed(1)} <span className="text-sm font-bold opacity-60">%</span>
                </div>
              </div>
            </div>
          </div>

          {/* AI Analysis Section */}
          <div className="bg-gradient-to-br from-brand-600 to-indigo-700 p-8 rounded-3xl shadow-xl text-white relative overflow-hidden group">
            <div className="relative z-10">
               <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="flex-1">
                     <h3 className="text-xl font-black flex items-center mb-2">
                        <i className="fa-solid fa-sparkles mr-3 text-brand-200"></i>
                        AI 專案結案分析助手
                     </h3>
                     <p className="text-brand-100 text-sm font-medium leading-relaxed max-w-2xl">
                        基於本專案所有投入工時與成員表現，產出專業的效益分析、重點摘要以及未來的改善建議。
                     </p>
                  </div>
                  <button 
                    onClick={handleAIAnalysis}
                    disabled={isAnalyzing}
                    className="bg-white text-brand-700 px-8 py-3.5 rounded-2xl font-black text-sm shadow-2xl shadow-black/20 hover:bg-brand-50 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center min-w-[160px]"
                  >
                     {isAnalyzing ? (
                        <><i className="fa-solid fa-circle-notch fa-spin mr-2"></i>分析中...</>
                     ) : (
                        <><i className="fa-solid fa-wand-magic-sparkles mr-2"></i>生成智能報告</>
                     )}
                  </button>
               </div>

               {aiAnalysis && (
                  <div className="mt-8 bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/20 animate-in fade-in slide-in-from-top-4 duration-500">
                     <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-4">
                        <span className="text-xs font-black uppercase tracking-widest opacity-80">AI Analysis Report</span>
                        <button onClick={() => setAiAnalysis('')} className="text-white/60 hover:text-white"><i className="fa-solid fa-times"></i></button>
                     </div>
                     <div className="text-sm leading-relaxed whitespace-pre-wrap font-medium">
                        {aiAnalysis}
                     </div>
                  </div>
               )}
            </div>
            
            {/* Background elements */}
            <div className="absolute top-0 right-0 -mr-20 -mt-20 w-80 h-80 bg-white/5 rounded-full blur-3xl group-hover:bg-white/10 transition-colors"></div>
            <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-60 h-60 bg-brand-400/10 rounded-full blur-2xl"></div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Department Table */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="font-bold text-slate-800 flex items-center">
                  <i className="fa-solid fa-sitemap mr-2 text-brand-600"></i>
                  各部門工時分析
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase tracking-wider bg-slate-50/50">
                      <th className="px-6 py-3 font-bold">部門名稱</th>
                      <th className="px-6 py-3 font-bold text-right">預算工時</th>
                      <th className="px-6 py-3 font-bold text-right">實際工時</th>
                      <th className="px-6 py-3 font-bold text-right">差異 (H)</th>
                      <th className="px-6 py-3 font-bold text-right">效能比例</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Object.entries(stats.deptStats).map(([name, s]) => {
                        const diff = s.actual - s.budget;
                        const ratio = s.budget === 0 ? (s.actual === 0 ? 0 : 100) : (s.actual / s.budget) * 100;
                        if (s.budget === 0 && s.actual === 0 && name === 'Other') return null;
                        
                        return (
                          <tr key={name} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 font-bold text-slate-700">{name}</td>
                            <td className="px-6 py-4 text-right text-slate-500 font-medium">{s.budget}</td>
                            <td className="px-6 py-4 text-right text-slate-900 font-bold">{s.actual}</td>
                            <td className={`px-6 py-4 text-right font-bold ${diff > 0 ? 'text-rose-600' : diff < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                              {diff > 0 ? `+${diff}` : diff}
                            </td>
                            <td className="px-6 py-4 text-right">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${ratio > 100 ? 'bg-rose-100 text-rose-700' : ratio > 80 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                {ratio.toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Member Table */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="font-bold text-slate-800 flex items-center">
                  <i className="fa-solid fa-users mr-2 text-brand-600"></i>
                  參與成員貢獻實績
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase tracking-wider bg-slate-50/50">
                      <th className="px-6 py-3 font-bold">成員姓名</th>
                      <th className="px-6 py-3 font-bold">所屬部門</th>
                      <th className="px-6 py-3 font-bold text-right">投入總工時</th>
                      <th className="px-6 py-3 font-bold text-right">佔比 (%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Object.entries(stats.memberStats)
                      .sort((a, b) => b[1].hours - a[1].hours)
                      .map(([name, info]) => (
                        <tr key={name} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 font-bold text-slate-700 flex items-center">
                             <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 mr-3 text-[10px] font-black border border-slate-200">
                                {name.charAt(0)}
                             </div>
                             {name}
                          </td>
                          <td className="px-6 py-4 text-slate-500 font-medium">
                            <span className="bg-slate-100 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-tighter">
                                {info.department}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right text-slate-900 font-black">{info.hours} <span className="text-[10px] text-slate-400">H</span></td>
                          <td className="px-6 py-4 text-right">
                             <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                                <div 
                                    className="bg-brand-500 h-full rounded-full transition-all duration-1000" 
                                    style={{ width: `${(info.hours / stats.totalActual) * 100}%` }}
                                ></div>
                             </div>
                             <span className="text-[10px] font-bold text-slate-400 mt-1 block">
                                {((info.hours / stats.totalActual) * 100).toFixed(1)}%
                             </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

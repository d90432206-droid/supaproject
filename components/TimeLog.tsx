
import React, { useState, useMemo, useEffect } from 'react';
import { Project, Log, LoginData, GlobalEngineer } from '../types';

interface TimeLogProps {
  projects: Project[];
  logs: Log[];
  loginData: LoginData;
  engineers: GlobalEngineer[]; 
  onSubmitLog: (log: Partial<Log>) => void;
}

export const TimeLog: React.FC<TimeLogProps> = ({ projects, logs, loginData, engineers, onSubmitLog }) => {
  const [view, setView] = useState<'input' | 'weekly'>('input');
  const [form, setForm] = useState<Partial<Log>>({
    date: new Date().toISOString().split('T')[0],
    hours: 1,
    engineer: loginData.role === 'Engineer' ? loginData.user : '',
    projectId: '',
    taskId: '',
    note: ''
  });
  const [weeklyDate, setWeeklyDate] = useState(new Date().toISOString().split('T')[0]);
  const [weeklyProjectFilter, setWeeklyProjectFilter] = useState(''); 

  const activeProjects = projects.filter(p => p.status === 'Active');
  
  useEffect(() => {
    setForm(prev => ({ ...prev, taskId: '' }));
  }, [form.projectId]);

  const projectTasks = useMemo(() => {
    if (!form.projectId) return [];
    return projects.find(p => p.id === form.projectId)?.tasks || [];
  }, [form.projectId, projects]);

  const sortedLogs = useMemo(() => {
    let filtered = [...logs];
    if (loginData.role === 'Engineer') {
      filtered = filtered.filter(l => l.engineer === loginData.user);
    }
    return filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 50);
  }, [logs, loginData]);

  const handleEdit = (log: Log) => {
    setForm({ ...log });
    setView('input'); 
  };

  const handleSubmit = () => {
    if (!form.projectId || !form.engineer || !form.hours) return alert("請填寫完整資訊");
    onSubmitLog(form);
    setForm({
      date: new Date().toISOString().split('T')[0],
      hours: 1,
      engineer: loginData.role === 'Engineer' ? loginData.user : '',
      projectId: '',
      taskId: '',
      note: '',
      logId: undefined
    });
  };

  const getProjectDisplay = (pid: string) => {
      const p = projects.find(x => x.id === pid);
      return p ? `${p.id} ${p.name}` : pid;
  };

  const weekDays = useMemo(() => {
      const baseDate = new Date(weeklyDate);
      const day = baseDate.getDay();
      const diff = baseDate.getDate() - day + (day === 0 ? -6 : 1); 
      const monday = new Date(baseDate.setDate(diff));
      const days = [];
      const dayNames = ['週一','週二','週三','週四','週五','週六','週日'];
      for(let i=0; i<7; i++) {
           const d = new Date(monday);
           d.setDate(monday.getDate() + i);
           days.push({ label: dayNames[i], dateStr: d.toISOString().split('T')[0] });
      }
      return days;
  }, [weeklyDate]);

  const weeklyData = useMemo(() => {
    const days = weekDays.map(d => d.dateStr);
    const rangeLogs = logs.filter(l => l.date >= days[0] && l.date <= days[6]);
    
    const filteredLogs = weeklyProjectFilter 
        ? rangeLogs.filter(l => l.projectId === weeklyProjectFilter)
        : rangeLogs;

    const grouped: Record<string, { projects: Record<string, Record<string, number>> }> = {}; 
    filteredLogs.forEach(l => {
        if(!grouped[l.engineer]) grouped[l.engineer] = { projects: {} };
        if(!grouped[l.engineer].projects[l.projectId]) grouped[l.engineer].projects[l.projectId] = {};
        const curr = grouped[l.engineer].projects[l.projectId][l.date] || 0;
        grouped[l.engineer].projects[l.projectId][l.date] = curr + l.hours;
    });
    return grouped;
  }, [logs, weekDays, weeklyProjectFilter]);

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 animate-in fade-in flex flex-col">
       <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 shrink-0 gap-4 md:gap-0">
          <h2 className="text-2xl font-bold text-slate-800">工時日報表</h2>
          <div className="flex flex-wrap bg-white p-1 rounded-lg border border-slate-200 shadow-sm w-full md:w-auto">
              <button onClick={() => setView('input')} className={`flex-1 md:flex-none px-4 py-1.5 rounded text-sm font-bold transition-all ${view==='input' ? 'bg-slate-800 text-white shadow' : 'text-slate-500 hover:bg-slate-50'}`}>日報輸入</button>
              <button onClick={() => setView('weekly')} className={`flex-1 md:flex-none px-4 py-1.5 rounded text-sm font-bold transition-all ${view==='weekly' ? 'bg-slate-800 text-white shadow' : 'text-slate-500 hover:bg-slate-50'}`}>週工時統計</button>
          </div>
       </div>

       {view === 'input' ? (
         <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 sticky top-6">
                    <h3 className="font-bold text-slate-700 mb-4 border-b pb-2">{form.logId ? '編輯紀錄' : '新增紀錄'}</h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">日期</label>
                            <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="w-full border rounded px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">專案 <span className="text-red-500">*</span></label>
                            <select value={form.projectId} onChange={e => setForm({...form, projectId: e.target.value})} className="w-full border rounded px-3 py-2 text-sm">
                                <option value="" disabled>選擇專案</option>
                                {activeProjects.map(p => (
                                    <option key={p.id} value={p.id}>{p.id} {p.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">工程師 <span className="text-red-500">*</span></label>
                            <select 
                              value={form.engineer} 
                              onChange={e => setForm({...form, engineer: e.target.value})} 
                              disabled={loginData.role === 'Engineer'}
                              className="w-full border rounded px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-600 cursor-pointer disabled:cursor-not-allowed"
                            >
                                <option value="" disabled>選擇成員</option>
                                {engineers.map(e => <option key={e.name} value={e.name}>{e.name}</option>)}
                            </select>
                            {loginData.role === 'Engineer' && (
                              <p className="text-[10px] text-slate-400 mt-1"><i className="fa-solid fa-lock mr-1"></i>已鎖定為登入帳號</p>
                            )}
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">任務</label>
                            <select value={form.taskId} onChange={e => setForm({...form, taskId: e.target.value})} className="w-full border rounded px-3 py-2 text-sm">
                                <option value="">-- 選擇任務 (選填) --</option>
                                {projectTasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">工時</label>
                            <input type="number" step="0.5" value={form.hours} onChange={e => setForm({...form, hours: Number(e.target.value)})} className="w-full border rounded px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">備註</label>
                            <textarea value={form.note} onChange={e => setForm({...form, note: e.target.value})} className="w-full border rounded px-3 py-2 text-sm h-20" placeholder="工作內容..."></textarea>
                        </div>
                        <button onClick={handleSubmit} className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-2.5 rounded shadow-lg">
                           {form.logId ? '更新紀錄' : '提交日報'}
                        </button>
                    </div>
                </div>
            </div>
            <div className="lg:col-span-2">
                <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b">
                                <tr>
                                    <th className="px-6 py-3 whitespace-nowrap">日期</th>
                                    <th className="px-6 py-3 whitespace-nowrap">人員</th>
                                    <th className="px-6 py-3 whitespace-nowrap">專案</th>
                                    <th className="px-6 py-3 min-w-[150px]">任務/備註</th>
                                    <th className="px-6 py-3 text-right whitespace-nowrap">時數</th>
                                    <th className="px-6 py-3 text-right whitespace-nowrap">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {sortedLogs.map((log, idx) => (
                                    <tr key={log.logId || idx} className="hover:bg-slate-50">
                                        <td className="px-6 py-3 text-slate-500 whitespace-nowrap">{log.date}</td>
                                        <td className="px-6 py-3 font-bold text-slate-700 whitespace-nowrap">{log.engineer}</td>
                                        <td className="px-6 py-3 text-brand-600 font-medium whitespace-nowrap">
                                            {getProjectDisplay(log.projectId)}
                                        </td>
                                        <td className="px-6 py-3">
                                            <div className="text-slate-500 text-xs break-words">{log.note}</div>
                                        </td>
                                        <td className="px-6 py-3 text-right font-mono font-bold">{log.hours}</td>
                                        <td className="px-6 py-3 text-right">
                                            {(loginData.role === 'Admin' || log.engineer === loginData.user) && (
                                                <button onClick={() => handleEdit(log)} className="text-slate-400 hover:text-brand-600">
                                                    <i className="fa-solid fa-pen"></i>
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
         </div>
       ) : (
         <div className="flex flex-col h-full">
             <div className="flex flex-wrap items-center gap-4 mb-4 bg-white p-3 rounded-lg border border-slate-200 shadow-sm w-full md:w-fit">
                 <div className="flex items-center gap-2">
                    <label className="text-xs font-bold text-slate-500 uppercase whitespace-nowrap">基準日:</label>
                    <input type="date" value={weeklyDate} onChange={e => setWeeklyDate(e.target.value)} className="border rounded px-2 py-1 text-sm font-mono" />
                 </div>
                 <div className="flex items-center gap-2 border-l pl-4 border-slate-200">
                    <label className="text-xs font-bold text-slate-500 uppercase whitespace-nowrap">專案篩選:</label>
                    <select 
                        value={weeklyProjectFilter} 
                        onChange={e => setWeeklyProjectFilter(e.target.value)}
                        className="border rounded px-2 py-1 text-sm max-w-[150px] md:max-w-[200px]"
                    >
                        <option value="">全部專案</option>
                        {projects.map(p => (
                            <option key={p.id} value={p.id}>{p.id} {p.name}</option>
                        ))}
                    </select>
                 </div>
             </div>
             
             <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left min-w-[800px]">
                        <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b">
                            <tr>
                                <th className="px-4 py-3 border-r border-slate-200 w-48">工程師 / 專案</th>
                                {weekDays.map((d, i) => (
                                    <th key={i} className={`px-2 py-3 text-center border-r border-slate-100 ${i>=5?'bg-slate-100':''}`}>
                                        <div>{d.label}</div>
                                        <div className="text-[9px]">{d.dateStr.slice(5)}</div>
                                    </th>
                                ))}
                                <th className="px-4 py-3 text-right font-bold bg-slate-50">總計</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {Object.keys(weeklyData).length === 0 ? (
                                <tr><td colSpan={9} className="text-center py-8 text-slate-400">尚無工時資料</td></tr>
                            ) : Object.entries(weeklyData).map(([engName, data]) => {
                                const typedData = data as { projects: Record<string, Record<string, number>> };
                                return (
                                    <React.Fragment key={engName}>
                                        <tr className="bg-slate-50/50">
                                            <td colSpan={9} className="px-4 py-2 font-bold text-slate-800 border-r border-slate-200">
                                                <i className="fa-solid fa-user-circle mr-2 text-slate-400"></i>{engName}
                                            </td>
                                        </tr>
                                        {Object.entries(typedData.projects).map(([projId, days]) => (
                                            <tr key={projId} className="hover:bg-brand-50/10">
                                                <td className="px-4 py-2 pl-8 border-r border-slate-200 text-xs text-slate-600 font-medium whitespace-nowrap">
                                                    {getProjectDisplay(projId)}
                                                </td>
                                                {weekDays.map((d, i) => (
                                                    <td key={i} className="px-2 py-2 text-center border-r border-slate-100 font-mono text-slate-600">
                                                        {days[d.dateStr] ? <span className="font-bold text-brand-600">{days[d.dateStr]}</span> : <span className="text-slate-200">-</span>}
                                                    </td>
                                                ))}
                                                <td className="px-4 py-2 text-right font-mono font-bold text-slate-800">
                                                    {Object.values(days).reduce((a,b)=>a+b,0)}
                                                </td>
                                            </tr>
                                        ))}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
             </div>
         </div>
       )}
    </div>
  );
};

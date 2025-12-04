import React, { useState, useMemo } from 'react';
import { Project, Log, LoginData } from '../types';

interface TimeLogProps {
  projects: Project[];
  logs: Log[];
  loginData: LoginData;
  onSubmitLog: (log: Partial<Log>) => void;
}

export const TimeLog: React.FC<TimeLogProps> = ({ projects, logs, loginData, onSubmitLog }) => {
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

  const activeProjects = projects.filter(p => p.status === 'Active');
  
  const availableEngineers = useMemo(() => {
    if (!form.projectId) return [];
    return projects.find(p => p.id === form.projectId)?.engineers || [];
  }, [form.projectId, projects]);

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
  };

  const handleSubmit = () => {
    if (!form.projectId || !form.engineer || !form.hours) return alert("請填寫完整資訊");
    onSubmitLog(form);
    // Reset
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

  // Weekly Data Logic
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
    const grouped: Record<string, { projects: Record<string, Record<string, number>> }> = {}; 
    rangeLogs.forEach(l => {
        if(!grouped[l.engineer]) grouped[l.engineer] = { projects: {} };
        if(!grouped[l.engineer].projects[l.projectId]) grouped[l.engineer].projects[l.projectId] = {};
        const curr = grouped[l.engineer].projects[l.projectId][l.date] || 0;
        grouped[l.engineer].projects[l.projectId][l.date] = curr + l.hours;
    });
    return grouped;
  }, [logs, weekDays]);

  return (
    <div className="flex-1 overflow-y-auto p-8 animate-in fade-in flex flex-col">
       <div className="flex justify-between items-center mb-6 shrink-0">
          <h2 className="text-2xl font-bold text-slate-800">工時日報表</h2>
          <div className="flex bg-white p-1 rounded-lg border border-slate-200 shadow-sm">
              <button onClick={() => setView('input')} className={`px-4 py-1.5 rounded text-sm font-bold transition-all ${view==='input' ? 'bg-slate-800 text-white shadow' : 'text-slate-500 hover:bg-slate-50'}`}>日報輸入</button>
              <button onClick={() => setView('weekly')} className={`px-4 py-1.5 rounded text-sm font-bold transition-all ${view==='weekly' ? 'bg-slate-800 text-white shadow' : 'text-slate-500 hover:bg-slate-50'}`}>週工時統計</button>
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
                                {activeProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">工程師 <span className="text-red-500">*</span></label>
                            <select 
                              value={form.engineer} 
                              onChange={e => setForm({...form, engineer: e.target.value})} 
                              disabled={loginData.role === 'Engineer' || !form.projectId}
                              className="w-full border rounded px-3 py-2 text-sm disabled:bg-slate-100"
                            >
                                <option value="" disabled>選擇成員</option>
                                {availableEngineers.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                            </select>
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
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b">
                            <tr>
                                <th className="px-6 py-3">日期</th>
                                <th className="px-6 py-3">人員</th>
                                <th className="px-6 py-3">專案</th>
                                <th className="px-6 py-3">任務/備註</th>
                                <th className="px-6 py-3 text-right">時數</th>
                                <th className="px-6 py-3 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {sortedLogs.map((log, idx) => (
                                <tr key={log.logId || idx} className="hover:bg-slate-50">
                                    <td className="px-6 py-3 text-slate-500">{log.date}</td>
                                    <td className="px-6 py-3 font-bold text-slate-700">{log.engineer}</td>
                                    <td className="px-6 py-3 text-brand-600 font-medium">{projects.find(p => p.id === log.projectId)?.name || log.projectId}</td>
                                    <td className="px-6 py-3">
                                        <div className="text-slate-500 text-xs">{log.note}</div>
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
       ) : (
         <div className="flex flex-col h-full">
             <div className="flex items-center gap-4 mb-4 bg-white p-3 rounded-lg border border-slate-200 shadow-sm w-fit">
                 <label className="text-xs font-bold text-slate-500 uppercase">基準日:</label>
                 <input type="date" value={weeklyDate} onChange={e => setWeeklyDate(e.target.value)} className="border rounded px-2 py-1 text-sm font-mono" />
             </div>
             <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                <table className="w-full text-sm text-left">
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
                        {Object.entries(weeklyData).map(([engName, data]) => (
                            <React.Fragment key={engName}>
                                <tr className="bg-slate-50/50">
                                    <td colSpan={9} className="px-4 py-2 font-bold text-slate-800 border-r border-slate-200">
                                        <i className="fa-solid fa-user-circle mr-2 text-slate-400"></i>{engName}
                                    </td>
                                </tr>
                                {Object.entries(data.projects).map(([projId, days]) => (
                                    <tr key={projId} className="hover:bg-brand-50/10">
                                        <td className="px-4 py-2 pl-8 border-r border-slate-200 text-xs text-slate-600 font-medium">{projects.find(p=>p.id===projId)?.name || projId}</td>
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
                        ))}
                    </tbody>
                </table>
             </div>
         </div>
       )}
    </div>
  );
};
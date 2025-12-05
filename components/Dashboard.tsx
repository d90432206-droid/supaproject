
import React, { useMemo, useState } from 'react';
import { Project, Log, SystemMessage, LoginData } from '../types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

interface DashboardProps {
  projects: Project[];
  logs: Log[];
  messages: SystemMessage[];
  loginData: LoginData;
  onAddMessage: (content: string) => void;
  onDeleteMessage: (id: string) => void;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#6366f1', '#ef4444'];

export const Dashboard: React.FC<DashboardProps> = ({ projects, logs, messages, loginData, onAddMessage, onDeleteMessage }) => {
  const [projectFilter, setProjectFilter] = useState('');
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear().toString());
  const [newMessage, setNewMessage] = useState('');

  const activeProjects = projects.filter(p => p.status === 'Active');
  const closedProjects = projects.filter(p => p.status === 'Closed');

  const totalBudget = projects.reduce((sum, p) => sum + (p.budgetHours || 0), 0);
  
  const rawTotalActual = logs.reduce((sum, l) => sum + (l.hours || 0), 0);
  const totalActual = Math.round(rawTotalActual * 10) / 10; 

  const alertProjects = useMemo(() => {
    return projects.map(p => {
      const actual = logs.filter(l => l.projectId === p.id).reduce((s, l) => s + l.hours, 0);
      return { ...p, actualHours: Math.round(actual * 10) / 10, usage: p.budgetHours > 0 ? (actual / p.budgetHours) : 0 };
    }).filter(p => p.budgetHours > 0 && p.actualHours > (p.budgetHours * 0.8));
  }, [projects, logs]);

  const availableYears = useMemo(() => {
      const years = new Set(logs.map(l => l.date.substring(0, 4)));
      return Array.from(years).sort().reverse();
  }, [logs]);

  const barData = useMemo(() => {
    return projects.map(p => ({
      id: p.id,
      name: p.name,
      budget: p.budgetHours,
      actual: Math.round(logs.filter(l => l.projectId === p.id).reduce((s, l) => s + l.hours, 0) * 10) / 10
    }));
  }, [projects, logs]);

  const pieData = useMemo(() => {
    let filteredLogs = logs.filter(l => l.date.startsWith(yearFilter));
    
    if (projectFilter) {
        filteredLogs = filteredLogs.filter(l => l.projectId === projectFilter);
    }

    const engHours: Record<string, number> = {};
    filteredLogs.forEach(l => {
      engHours[l.engineer] = (engHours[l.engineer] || 0) + l.hours;
    });
    return Object.entries(engHours).map(([name, value]) => ({ name, value: Math.round(value * 10) / 10 }));
  }, [logs, projectFilter, yearFilter]);

  // --- Schedule Overview Logic ---
  const scheduleTimeline = useMemo(() => {
    if (activeProjects.length === 0) return { months: [], startMonthDate: new Date() };

    // Find min start and max end date
    const dates = activeProjects.flatMap(p => [
        p.startDate ? new Date(p.startDate) : null,
        p.endDate ? new Date(p.endDate) : null
    ]).filter(Boolean) as Date[];
    
    // Default range if no dates
    if (dates.length === 0) {
        dates.push(new Date());
        dates.push(new Date(new Date().setMonth(new Date().getMonth() + 6)));
    }

    const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));

    // Buffer: -1 month, +2 months
    const start = new Date(minDate.getFullYear(), minDate.getMonth() - 1, 1);
    const end = new Date(maxDate.getFullYear(), maxDate.getMonth() + 2, 0);

    const months = [];
    let current = new Date(start);
    while (current <= end) {
        months.push({
            year: current.getFullYear(),
            month: current.getMonth() + 1
        });
        current.setMonth(current.getMonth() + 1);
    }
    return { months, startMonthDate: start, totalMonths: months.length };
  }, [activeProjects]);

  const getPosition = (dateStr: string | null) => {
    if (!dateStr) return -1;
    const date = new Date(dateStr);
    const start = scheduleTimeline.startMonthDate;
    const diffTime = date.getTime() - start.getTime();
    const daysDiff = diffTime / (1000 * 3600 * 24);
    // 60px per month approx, 2px per day
    return daysDiff * 2; 
  };
  
  const getTodayPosition = () => {
      return getPosition(new Date().toISOString().split('T')[0]);
  };

  const handlePublish = () => {
    if(!newMessage.trim()) return;
    onAddMessage(newMessage);
    setNewMessage('');
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 animate-in fade-in">
      <h2 className="text-2xl font-bold text-slate-800 mb-6">營運總覽</h2>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">執行中專案</div>
          <div className="text-3xl font-bold text-slate-800">{activeProjects.length}</div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">總預算工時</div>
          <div className="text-3xl font-bold text-brand-600">{totalBudget.toLocaleString()} h</div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">實際投入總工時</div>
          <div className={`text-3xl font-bold ${totalActual > totalBudget ? 'text-red-500' : 'text-emerald-600'}`}>{totalActual.toLocaleString()} h</div>
        </div>
      </div>

      {/* NEW SECTION: Active Projects Schedule Overview */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden mb-8 flex flex-col">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
              <h3 className="font-bold text-slate-700"><i className="fa-solid fa-calendar-alt mr-2"></i>執行中專案總排程</h3>
          </div>
          <div className="overflow-x-auto custom-scroll">
              <div className="min-w-[1000px] flex">
                  {/* Left: Project Info Table */}
                  <div className="w-[300px] flex-shrink-0 border-r border-slate-200 bg-white z-10 sticky left-0 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.1)]">
                      <div className="h-10 bg-slate-100 border-b border-slate-200 flex items-center px-4 font-bold text-xs text-slate-600">
                          <div className="w-20">案號</div>
                          <div className="w-20">客戶</div>
                          <div className="flex-1">設備名稱</div>
                      </div>
                      {activeProjects.map((p, idx) => (
                          <div key={p.id} className={`h-12 flex items-center px-4 text-xs border-b border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                              <div className="w-20 font-mono font-bold text-slate-700 truncate pr-2" title={p.id}>{p.id}</div>
                              <div className="w-20 text-slate-600 truncate pr-2" title={p.client}>{p.client}</div>
                              <div className="flex-1 font-medium text-slate-800 truncate" title={p.name}>{p.name}</div>
                          </div>
                      ))}
                  </div>

                  {/* Right: Timeline */}
                  <div className="flex-1 relative">
                      {/* Timeline Header */}
                      <div className="h-10 bg-slate-100 border-b border-slate-200 flex">
                           {scheduleTimeline.months.map((m, i) => (
                               <div key={i} className="flex-shrink-0 border-r border-slate-200 flex flex-col justify-center items-center w-[60px]">
                                   {/* Show Year only on Jan or first col */}
                                   {(m.month === 1 || i === 0) && (
                                       <div className="text-[9px] text-slate-400 font-bold leading-none mb-0.5">{m.year}</div>
                                   )}
                                   <div className="text-xs font-bold text-slate-600 leading-none">{m.month}</div>
                               </div>
                           ))}
                      </div>

                      {/* Timeline Body */}
                      <div className="relative">
                          {/* Grid Lines */}
                          <div className="absolute inset-0 flex pointer-events-none">
                              {scheduleTimeline.months.map((_, i) => (
                                  <div key={i} className="flex-shrink-0 border-r border-slate-100 w-[60px] h-full"></div>
                              ))}
                          </div>
                          
                          {/* Today Line */}
                          {getTodayPosition() >= 0 && (
                              <div className="absolute top-0 bottom-0 w-0 border-l-2 border-red-500 border-dashed z-20 pointer-events-none" 
                                   style={{ left: `${getTodayPosition()}px` }}>
                                  <div className="absolute -top-3 -left-1.5 text-red-500"><i className="fa-solid fa-caret-down"></i></div>
                              </div>
                          )}

                          {/* Rows */}
                          {activeProjects.map((p, idx) => {
                              const startPos = getPosition(p.startDate);
                              const endPos = getPosition(p.endDate);
                              return (
                                  <div key={p.id} className={`h-12 border-b border-slate-100 relative ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                                      {/* Start Star */}
                                      {startPos >= 0 && (
                                          <div className="absolute top-1/2 -translate-y-1/2 text-slate-400 z-10" style={{ left: `${startPos}px` }}>
                                              <i className="fa-solid fa-star text-sm"></i>
                                          </div>
                                      )}
                                      
                                      {/* Connection Line (Optional visual) */}
                                      {startPos >= 0 && endPos >= 0 && endPos > startPos && (
                                          <div className="absolute top-1/2 -translate-y-1/2 h-0.5 border-t-2 border-red-400 border-dashed z-0" 
                                               style={{ left: `${startPos + 10}px`, width: `${endPos - startPos - 10}px` }}></div>
                                      )}

                                      {/* End Flag & Label */}
                                      {endPos >= 0 && (
                                          <div className="absolute top-1/2 -translate-y-1/2 z-10 flex flex-col items-center" style={{ left: `${endPos}px` }}>
                                              <i className="fa-solid fa-flag text-orange-500 text-sm mb-1"></i>
                                              <div className="absolute left-3 -top-2 bg-yellow-100 border border-yellow-300 text-[9px] px-1 rounded whitespace-nowrap shadow-sm text-yellow-800 font-bold z-20">
                                                  預計 {p.endDate}
                                              </div>
                                          </div>
                                      )}
                                  </div>
                              );
                          })}
                      </div>
                  </div>
              </div>
          </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Bar Chart */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col h-[400px]">
          <h3 className="font-bold text-slate-700 mb-4 flex justify-between items-center">
            <span>預算 vs 實際 (全專案)</span>
            <span className="text-xs text-slate-400 font-normal">游標懸停查看詳細專案名稱</span>
          </h3>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={barData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <XAxis type="number" />
              <YAxis dataKey="id" type="category" width={80} tick={{fontSize: 12}} />
              <Tooltip 
                cursor={{fill: '#f1f5f9'}}
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    const projName = barData.find(d => d.id === label)?.name;
                    return (
                      <div className="bg-white p-2 border border-slate-200 shadow-lg rounded text-xs">
                        <p className="font-bold mb-1">{projName} ({label})</p>
                        <p className="text-slate-500">預算: {payload[0].value}h</p>
                        <p className="text-blue-600">實際: {payload[1].value}h</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar dataKey="budget" name="預算工時" fill="#cbd5e1" barSize={12} radius={[0, 4, 4, 0]} />
              <Bar dataKey="actual" name="實際工時" fill="#3b82f6" barSize={12} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Pie Chart */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col h-[400px]">
          <div className="flex flex-col gap-2 mb-4">
            <h3 className="font-bold text-slate-700">人力資源分佈</h3>
            <div className="flex gap-2">
                 {/* 年份篩選 */}
                <select 
                    value={yearFilter}
                    onChange={(e) => setYearFilter(e.target.value)}
                    className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 bg-slate-50 outline-none focus:border-brand-500"
                >
                    {availableYears.map(y => <option key={y} value={y}>{y}年度</option>)}
                </select>
                {/* 專案篩選 */}
                <select 
                    value={projectFilter}
                    onChange={(e) => setProjectFilter(e.target.value)}
                    className="flex-[2] text-xs border border-slate-200 rounded px-2 py-1 bg-slate-50 outline-none focus:border-brand-500"
                >
                    <option value="">全公司總覽</option>
                    {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                    ))}
                </select>
            </div>
          </div>
          <div className="flex-1 relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  fill="#8884d8"
                  paddingAngle={5}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{fontSize: '11px'}} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* System Messages */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden flex flex-col max-h-[400px]">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-brand-50">
                  <h3 className="font-bold text-brand-700">
                      <i className="fa-solid fa-bullhorn mr-2"></i>系統公告
                  </h3>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scroll">
                  {messages.length === 0 ? (
                      <p className="text-center text-slate-400 text-sm italic py-4">目前無公告</p>
                  ) : (
                      messages.map(msg => (
                          <div key={msg.id} className="bg-slate-50 p-3 rounded-lg border border-slate-100 relative group">
                              <div className="flex justify-between items-start mb-1">
                                  <span className="text-xs font-bold text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">{msg.date}</span>
                                  {loginData.role === 'Admin' && (
                                      <button onClick={() => onDeleteMessage(msg.id)} className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity">
                                          <i className="fa-solid fa-trash text-xs"></i>
                                      </button>
                                  )}
                              </div>
                              <p className="text-sm text-slate-700 font-medium whitespace-pre-wrap">{msg.content}</p>
                              <div className="mt-1 text-[10px] text-slate-400 text-right">- {msg.author}</div>
                          </div>
                      ))
                  )}
              </div>
              {loginData.role === 'Admin' && (
                  <div className="p-4 border-t border-slate-100 bg-slate-50">
                      <div className="flex gap-2">
                          <input 
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            placeholder="輸入公告內容..." 
                            className="flex-1 border border-slate-200 rounded px-3 py-2 text-sm outline-none focus:border-brand-500"
                            onKeyDown={(e) => e.key === 'Enter' && handlePublish()}
                          />
                          <button onClick={handlePublish} className="bg-brand-600 text-white px-4 py-2 rounded text-sm font-bold hover:bg-brand-700">發布</button>
                      </div>
                  </div>
              )}
          </div>

          {/* Alert List */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden max-h-[400px] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-red-50">
              <h3 className="font-bold text-red-700">
                <i className="fa-solid fa-triangle-exclamation mr-2"></i>預警專案 (&gt;80%)
              </h3>
            </div>
            <div className="overflow-y-auto custom-scroll flex-1">
                <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b sticky top-0">
                    <tr>
                    <th className="px-6 py-3">專案</th>
                    <th className="px-6 py-3 text-right">預算</th>
                    <th className="px-6 py-3 text-right">實際</th>
                    <th className="px-6 py-3 text-right">使用率</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {alertProjects.length > 0 ? (
                    alertProjects.map(p => (
                        <tr key={p.id} className="hover:bg-slate-50">
                        <td className="px-6 py-3 font-medium text-slate-800 truncate max-w-[120px]" title={p.name}>{p.name}</td>
                        <td className="px-6 py-3 text-right font-mono">{p.budgetHours}h</td>
                        <td className="px-6 py-3 text-right font-mono text-red-600 font-bold">{p.actualHours}h</td>
                        <td className="px-6 py-3 text-right">
                            <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-bold">
                            {Math.round(p.usage * 100)}%
                            </span>
                        </td>
                        </tr>
                    ))
                    ) : (
                    <tr>
                        <td colSpan={4} className="px-6 py-8 text-center text-slate-400 italic">目前無預警專案。</td>
                    </tr>
                    )}
                </tbody>
                </table>
            </div>
          </div>
      </div>

      {/* Closed Projects Review */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden mb-8">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-center lg:justify-between bg-slate-100">
              <h3 className="font-bold text-slate-700">
                <i className="fa-solid fa-archive mr-2"></i>已結案專案回顧
              </h3>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b">
                        <tr>
                            <th className="px-6 py-3">專案名稱</th>
                            <th className="px-6 py-3">客戶</th>
                            <th className="px-6 py-3 text-right">預算工時</th>
                            <th className="px-6 py-3 text-right">實際工時</th>
                            <th className="px-6 py-3 text-right">差異</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {closedProjects.map(p => {
                            const actual = logs.filter(l => l.projectId === p.id).reduce((s, l) => s + l.hours, 0);
                            const actualRounded = Math.round(actual * 10) / 10;
                            const diff = p.budgetHours - actualRounded;
                            const isOverBudget = diff < 0;
                            return (
                                <tr key={p.id} className="hover:bg-slate-50">
                                    <td className="px-6 py-3 font-medium text-slate-800">{p.name} <span className="text-xs text-slate-400 ml-1">({p.id})</span></td>
                                    <td className="px-6 py-3 text-slate-600">{p.client}</td>
                                    <td className="px-6 py-3 text-right font-mono">{p.budgetHours}h</td>
                                    <td className="px-6 py-3 text-right font-mono">{actualRounded}h</td>
                                    <td className={`px-6 py-3 text-right font-mono font-bold ${isOverBudget ? 'text-red-500' : 'text-emerald-500'}`}>
                                        {diff > 0 ? '+' : ''}{Math.round(diff * 10) / 10}h
                                    </td>
                                </tr>
                            );
                        })}
                        {closedProjects.length === 0 && (
                             <tr>
                                <td colSpan={5} className="px-6 py-8 text-center text-slate-400 italic">目前無已結案專案。</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
      </div>
    </div>
  );
};

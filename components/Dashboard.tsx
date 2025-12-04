import React, { useMemo, useState } from 'react';
import { Project, Log } from '../types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

interface DashboardProps {
  projects: Project[];
  logs: Log[];
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#6366f1', '#ef4444'];

export const Dashboard: React.FC<DashboardProps> = ({ projects, logs }) => {
  const [projectFilter, setProjectFilter] = useState('');

  const activeProjects = projects.filter(p => p.status === 'Active');
  const totalBudget = projects.reduce((sum, p) => sum + (p.budgetHours || 0), 0);
  const totalActual = logs.reduce((sum, l) => sum + (l.hours || 0), 0);

  const alertProjects = useMemo(() => {
    return projects.map(p => {
      const actual = logs.filter(l => l.projectId === p.id).reduce((s, l) => s + l.hours, 0);
      return { ...p, actualHours: actual, usage: p.budgetHours > 0 ? (actual / p.budgetHours) : 0 };
    }).filter(p => p.budgetHours > 0 && p.actualHours > (p.budgetHours * 0.8));
  }, [projects, logs]);

  const barData = useMemo(() => {
    return projects.map(p => ({
      id: p.id,
      name: p.name,
      budget: p.budgetHours,
      actual: logs.filter(l => l.projectId === p.id).reduce((s, l) => s + l.hours, 0)
    }));
  }, [projects, logs]);

  const pieData = useMemo(() => {
    const filteredLogs = projectFilter ? logs.filter(l => l.projectId === projectFilter) : logs;
    const engHours: Record<string, number> = {};
    filteredLogs.forEach(l => {
      engHours[l.engineer] = (engHours[l.engineer] || 0) + l.hours;
    });
    return Object.entries(engHours).map(([name, value]) => ({ name, value }));
  }, [logs, projectFilter]);

  return (
    <div className="flex-1 overflow-y-auto p-8 animate-in fade-in">
      <h2 className="text-2xl font-bold text-slate-800 mb-6">營運總覽 (Overview)</h2>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">執行中專案</div>
          <div className="text-3xl font-bold text-slate-800">{activeProjects.length}</div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">總預算工時</div>
          <div className="text-3xl font-bold text-brand-600">{totalBudget} h</div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">實際投入總工時</div>
          <div className={`text-3xl font-bold ${totalActual > totalBudget ? 'text-red-500' : 'text-emerald-600'}`}>{totalActual} h</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Bar Chart */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col h-[400px]">
          <h3 className="font-bold text-slate-700 mb-4 flex justify-between items-center">
            <span>預算 vs 實際</span>
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
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-slate-700">人力資源分佈</h3>
            <select 
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="text-xs border border-slate-200 rounded px-2 py-1 bg-slate-50 outline-none focus:border-brand-500"
            >
              <option value="">全公司總覽</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
              ))}
            </select>
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
                <Legend layout="vertical" verticalAlign="middle" align="right" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Alert List */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-red-50">
          <h3 className="font-bold text-red-700">
            <i className="fa-solid fa-triangle-exclamation mr-2"></i>預警專案 (實際工時 &gt; 80% 預算)
          </h3>
        </div>
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b">
            <tr>
              <th className="px-6 py-3">專案名稱</th>
              <th className="px-6 py-3 text-right">預算工時</th>
              <th className="px-6 py-3 text-right">實際工時</th>
              <th className="px-6 py-3 text-right">使用率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {alertProjects.length > 0 ? (
              alertProjects.map(p => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-6 py-3 font-medium text-slate-800">{p.name}</td>
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
                <td colSpan={4} className="px-6 py-8 text-center text-slate-400 italic">目前無預警專案，所有專案皆在控制範圍內。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
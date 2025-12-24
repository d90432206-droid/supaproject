import React, { useState, useMemo } from 'react';
import { Project, Log, GlobalEngineer } from '../types';

interface LaborReportModalProps {
    project?: Project; // Optional: If missing, implies "All Projects"
    logs: Log[];
    engineers: GlobalEngineer[];
    projects?: Project[]; // Required for "All Projects" mode to look up names
    onClose: () => void;
}

export const LaborReportModal: React.FC<LaborReportModalProps> = ({ project, logs, engineers, projects, onClose }) => {
    const [selectedEng, setSelectedEng] = useState('');
    const [startDate, setStartDate] = useState(project?.startDate || '');
    const [endDate, setEndDate] = useState(project?.endDate || '');
    const [selectedProjectId, setSelectedProjectId] = useState('');

    const targetProjectName = project ? project.name : '所有專案';

    const getProjectName = (pid: string) => {
        if (project && project.id === pid) return project.name;
        if (projects) {
            const p = projects.find(x => x.id === pid);
            return p ? p.name : pid;
        }
        return pid;
    };

    const resolveTaskName = (l: Log) => {
        // 1. Try to find project
        let proj = project;
        if (!proj && projects) {
            proj = projects.find(p => p.id === l.projectId);
        }

        if (proj && l.taskId) {
            // 2. Try to find task in project
            const t = proj.tasks.find(t => t.id == l.taskId);
            if (t) return t.title;
        }
        // 3. Fallback to taskId (custom input) or empty
        return l.taskId || '';
    };

    const filteredLogs = useMemo(() => {
        return logs.filter(l => {
            const logDate = String(l.date).replace(/\//g, '-');

            // Project Check
            if (project) {
                // Single Project Mode
                const targetId = String(project.id).trim().toLowerCase();
                const logProjStr = String(l.projectId).toLowerCase();
                const isProjectMatch = logProjStr === targetId || logProjStr.includes(targetId) || targetId.includes(logProjStr);
                if (!isProjectMatch) return false;
            } else if (selectedProjectId) {
                // Global Mode with Project Filter
                if (l.projectId !== selectedProjectId) return false;
            }

            // Date Range Check
            if (startDate && logDate < startDate) return false;
            if (endDate && logDate > endDate) return false;

            // Engineer Check
            if (selectedEng && l.engineer !== selectedEng) return false;

            return true;
        }).sort((a, b) => a.date.localeCompare(b.date));
    }, [logs, project, selectedProjectId, startDate, endDate, selectedEng]);

    const handleExport = () => {
        const headers = ['日期', '專案', '姓名', '任務', '備註內容', '工時'];
        const csvContent = [
            headers.join(','),
            ...filteredLogs.map(l => {
                const taskName = resolveTaskName(l);
                const noteContent = l.note || l.content || '';
                return [
                    l.date,
                    `"[${l.projectId}] ${getProjectName(l.projectId).replace(/"/g, '""')}"`,
                    l.engineer,
                    `"${String(taskName).replace(/"/g, '""')}"`,
                    `"${String(noteContent).replace(/"/g, '""')}"`,
                    l.hours
                ].join(',');
            })
        ].join('\n');

        const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `${targetProjectName}_工時報表_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl p-6 flex flex-col max-h-[90vh]">
                <div className="flex justify-between items-center mb-4 border-b pb-2">
                    <h3 className="font-bold text-lg text-slate-800"><i className="fa-solid fa-table-list mr-2 text-brand-600"></i>工時詳細報表 - {targetProjectName}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><i className="fa-solid fa-times text-xl"></i></button>
                </div>

                {/* Filters */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4 bg-slate-50 p-3 rounded border border-slate-100">
                    <div>
                        <label className="text-xs font-bold text-slate-500 block mb-1">人員篩選</label>
                        <select value={selectedEng} onChange={e => setSelectedEng(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm">
                            <option value="">全部人員</option>
                            {engineers.map(e => <option key={e.name} value={e.name}>{e.name}</option>)}
                        </select>
                    </div>
                    {!project && projects && (
                        <div>
                            <label className="text-xs font-bold text-slate-500 block mb-1">專案篩選</label>
                            <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm">
                                <option value="">全部專案</option>
                                {projects.map(p => <option key={p.id} value={p.id}>[{p.id}] {p.name}</option>)}
                            </select>
                        </div>
                    )}
                    <div>
                        <label className="text-xs font-bold text-slate-500 block mb-1">開始日期</label>
                        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 block mb-1">結束日期</label>
                        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" />
                    </div>
                    <div className="flex items-end">
                        <button onClick={handleExport} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 rounded text-sm shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed" disabled={filteredLogs.length === 0}>
                            <i className="fa-solid fa-file-csv mr-2"></i>匯出 CSV
                        </button>
                    </div>
                </div>

                {/* Table */}
                <div className="flex-1 overflow-auto custom-scroll border border-slate-200 rounded">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 font-bold z-10">
                            <tr>
                                <th className="px-4 py-2 bg-slate-50">日期</th>
                                <th className="px-4 py-2 bg-slate-50">專案</th>
                                <th className="px-4 py-2 bg-slate-50">姓名</th>
                                <th className="px-4 py-2 bg-slate-50">任務 / 備註內容</th>
                                <th className="px-4 py-2 bg-slate-50 text-right">工時</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredLogs.length === 0 ? (
                                <tr><td colSpan={5} className="text-center py-8 text-slate-400">無符合條件的資料</td></tr>
                            ) : filteredLogs.map((l, idx) => (
                                <tr key={`${l.logId}-${idx}`} className="hover:bg-slate-50">
                                    <td className="px-4 py-2 font-mono text-slate-600 whitespace-nowrap">{l.date}</td>
                                    <td className="px-4 py-2 text-slate-600 whitespace-nowrap max-w-[150px] truncate" title={getProjectName(l.projectId)}>
                                        {getProjectName(l.projectId)}
                                    </td>
                                    <td className="px-4 py-2 font-bold text-slate-700 whitespace-nowrap">{l.engineer}</td>
                                    <td className="px-4 py-2 text-slate-800">
                                        <div className="max-w-[300px] truncate" title={l.taskTitle || l.content || l.note}>
                                            {l.taskTitle && <span className="bg-brand-50 text-brand-700 px-1.5 py-0.5 rounded text-xs mr-2">{l.taskTitle}</span>}
                                            {l.content || l.note || <span className="text-slate-300 italic">無備註</span>}
                                        </div>
                                    </td>
                                    <td className="px-4 py-2 text-right font-mono font-bold text-brand-600">{l.hours}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="mt-2 text-xs text-slate-400 text-right">
                    共 {filteredLogs.length} 筆資料，總工時: {filteredLogs.reduce((a, b) => a + b.hours, 0)} 小時
                </div>
            </div>
        </div>
    );
};

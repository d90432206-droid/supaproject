
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Project, Task, Engineer, GlobalEngineer, Log, LoginData } from '../types';
import { LaborReportModal } from './LaborReportModal';

interface WBSEditorProps {
    project: Project;
    logs: Log[];
    onUpdate: (updatedProject: Project) => void;
    onClose: () => void;
    loginData: LoginData; // Full login data for PM check
    globalEngineers: GlobalEngineer[];
}

// Helper Functions - Timezone Safe (Local Time)
const toLocalISOString = (date: Date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const parseLocalDate = (d: string | undefined | null) => {
    if (!d) {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    // Handle YYYY-MM-DD manually to ensure local time midnight
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
        const [y, m, day] = d.split('-').map(Number);
        return new Date(y, m - 1, day);
    }
    const date = new Date(d);
    return isNaN(date.getTime()) ? new Date() : date;
};

const addDays = (d: string, n: number) => {
    const x = parseLocalDate(d);
    x.setDate(x.getDate() + n);
    return toLocalISOString(x);
};

const getDaysDiff = (s: string, e: string) => {
    const d1 = parseLocalDate(s);
    const d2 = parseLocalDate(e);
    // Use UTC conversion for difference to ignore DST hours shift issues if any
    const utc1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
    const utc2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
    return Math.floor((utc2 - utc1) / 86400000);
};

const getISOWeek = (d: Date) => {
    const date = new Date(d.getTime());
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    const week1 = new Date(date.getFullYear(), 0, 4);
    return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
};

export const WBSEditor: React.FC<WBSEditorProps> = ({ project, logs, onUpdate, onClose, globalEngineers, loginData }) => {
    const [localProject, setLocalProject] = useState<Project>(JSON.parse(JSON.stringify(project)));
    const [viewMode, setViewMode] = useState<'day' | 'week' | 'month' | 'custom'>('day');
    const [colWidth, setColWidth] = useState(40);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showTeamModal, setShowTeamModal] = useState(false);
    const [showWBSModal, setShowWBSModal] = useState(false);
    const [editingTask, setEditingTask] = useState<Partial<Task>>({});

    // Delay Reason Modal
    const [showDelayModal, setShowDelayModal] = useState(false);
    const [pendingDelayTask, setPendingDelayTask] = useState<{ task: Task, newDate: string } | null>(null);
    const [delayReasonInput, setDelayReasonInput] = useState('');

    // Report Modal
    const [showReportModal, setShowReportModal] = useState(false);

    // Default stats date to Project Start Date to ensure data visibility
    const [statsWeeklyDate, setStatsWeeklyDate] = useState(
        project.startDate ? project.startDate : toLocalISOString()
    );

    const [draggingState, setDraggingState] = useState<{ isDragging: boolean, task: Task | null, startX: number, startDate: string }>({
        isDragging: false, task: null, startX: 0, startDate: ''
    });
    const [tempDragOffsetPx, setTempDragOffsetPx] = useState(0);

    const timelineHeaderRef = useRef<HTMLDivElement>(null);
    const ganttBodyRef = useRef<HTMLDivElement>(null);

    const todayDate = toLocalISOString(); // Use local date
    const START_OFFSET = 15;

    // Consistent Sidebar Width Calculation
    // Note: Using window.innerWidth in render is fine for client-side only app, 
    // but utilizing a state or ResizeObserver would be more 'React-way' if responsiveness needs to be dynamic.
    // For now, we align with the existing logic but store it to ensure header/body match.
    const sidebarWidth = typeof window !== 'undefined' && window.innerWidth < 768 ? 160 : 260;

    // Permission Checks
    const isAdmin = loginData.role === 'Admin';
    const isPM = localProject.manager === loginData.user;
    const canEditTasks = isAdmin || isPM;

    // Sync from prop (Fix unsaved warning sticking)
    useEffect(() => {
        setLocalProject(JSON.parse(JSON.stringify(project)));
    }, [project]);

    const hasUnsavedChanges = useMemo(() => {
        return JSON.stringify(localProject) !== JSON.stringify(project);
    }, [localProject, project]);

    // Smooth Zoom (Ctrl+Wheel) & Horizontal Scroll (Shift+Wheel)
    useEffect(() => {
        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -2 : 2;
                setColWidth(prev => Math.max(10, Math.min(200, prev + delta)));
                setViewMode('custom');
            } else if (e.shiftKey) {
                e.preventDefault();
                if (ganttBodyRef.current) {
                    ganttBodyRef.current.scrollLeft += e.deltaY;
                }
            }
        };
        const el = ganttBodyRef.current;
        if (el) el.addEventListener('wheel', handleWheel, { passive: false });
        return () => { if (el) el.removeEventListener('wheel', handleWheel); };
    }, []);

    const handleCloseAttempt = () => {
        if (hasUnsavedChanges) {
            if (window.confirm("您有未儲存的變更，確定要離開嗎？")) onClose();
        } else {
            onClose();
        }
    };

    const scrollToToday = () => {
        if (ganttBodyRef.current && todayOffset >= 0) {
            const clientWidth = ganttBodyRef.current.clientWidth;
            const targetLeft = sidebarWidth + todayOffset - (clientWidth / 2);
            ganttBodyRef.current.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
        }
    };

    // Render Days
    const renderDays = useMemo(() => {
        const validStart = localProject.startDate || toLocalISOString();
        const start = addDays(validStart, -START_OFFSET);
        let duration = localProject.endDate ? getDaysDiff(validStart, localProject.endDate) + START_OFFSET + 30 : 60;
        if (duration > 3650) duration = 365; // Cap at 1 year view to prevent crash
        if (duration < 1) duration = 30;

        const days = [];
        const startDateObj = parseLocalDate(start);
        for (let i = 0; i < duration; i++) {
            const d = new Date(startDateObj);
            d.setDate(startDateObj.getDate() + i);
            const dateStr = toLocalISOString(d);
            const dayOfWeek = d.getDay();
            days.push({
                dateStr,
                isWeekend: (dayOfWeek === 0 || dayOfWeek === 6),
                isHoliday: (localProject.holidays || []).includes(dateStr),
                label: d.getDate()
            });
        }
        return days;
    }, [localProject.startDate, localProject.endDate, localProject.holidays]);

    const headerTopRow = useMemo(() => {
        const items: { label: string, width: number }[] = [];
        let currentLabel = ''; let width = 0;
        renderDays.forEach(day => {
            const d = parseLocalDate(day.dateStr);
            let label = `${d.getFullYear()}年 ${(d.getMonth() + 1).toString().padStart(2, '0')}月`;
            if (label !== currentLabel) {
                if (currentLabel) items.push({ label: currentLabel, width });
                currentLabel = label; width = 0;
            }
            width += colWidth;
        });
        if (currentLabel) items.push({ label: currentLabel, width });
        return items;
    }, [renderDays, colWidth]);

    const totalContentWidth = renderDays.length * colWidth;
    const renderStart = addDays(localProject.startDate || todayDate, -START_OFFSET);
    const todayDiff = getDaysDiff(renderStart, todayDate);
    const todayOffset = todayDiff >= 0 ? todayDiff * colWidth : -1;

    // Helper to get latest color from Global Settings if available
    const getAssigneeColor = (assigneeId: string) => {
        if (!assigneeId) return '#cbd5e1';

        // 1. Find engineer in project to get name
        const projectEng = (localProject.engineers || []).find(e => e.id === assigneeId);
        if (!projectEng) return '#cbd5e1';

        // 2. Find global settings for this engineer name to get latest color
        const globalEng = globalEngineers.find(g => g.name === projectEng.name);

        // 3. Return global color if found, else fallback to project snapshot color
        return globalEng ? globalEng.color : projectEng.color;
    };

    // Dragging Logic
    const handleMouseDown = (task: Task, e: React.MouseEvent) => {
        if (!canEditTasks) return; // Permission Check
        if (e.button !== 0) return;
        e.preventDefault();
        setDraggingState({ isDragging: true, task, startX: e.clientX, startDate: task.startDate });
        setTempDragOffsetPx(0);
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (draggingState.isDragging) setTempDragOffsetPx(e.clientX - draggingState.startX);
        };
        const handleMouseUp = () => {
            if (draggingState.isDragging && draggingState.task) {
                const daysDelta = Math.round(tempDragOffsetPx / colWidth);
                if (daysDelta !== 0) {
                    const originalTask = draggingState.task;
                    const newStartDate = addDays(draggingState.startDate, daysDelta);
                    const originalEndDate = addDays(originalTask.startDate, originalTask.duration);
                    const newEndDate = addDays(newStartDate, originalTask.duration);

                    // Delay Detection
                    if (newEndDate > originalEndDate) {
                        setPendingDelayTask({ task: { ...originalTask, startDate: newStartDate }, newDate: newStartDate });
                        setShowDelayModal(true);
                    } else {
                        const updatedTasks = (localProject.tasks || []).map(t =>
                            t.id === originalTask.id ? { ...t, startDate: newStartDate } : t
                        );
                        setLocalProject(prev => ({ ...prev, tasks: updatedTasks }));
                    }
                }
            }
            setDraggingState({ isDragging: false, task: null, startX: 0, startDate: '' });
            setTempDragOffsetPx(0);
        };

        if (draggingState.isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [draggingState, tempDragOffsetPx, colWidth, localProject.tasks]);

    const confirmDelay = () => {
        if (!delayReasonInput.trim()) return alert("請填寫延遲原因");
        if (!pendingDelayTask) return;

        const updatedTasks = (localProject.tasks || []).map(t => {
            if (t.id === pendingDelayTask.task.id) {
                return {
                    ...t,
                    startDate: pendingDelayTask.newDate,
                    delayReason: delayReasonInput
                };
            }
            return t;
        });
        setLocalProject(prev => ({ ...prev, tasks: updatedTasks }));
        setShowDelayModal(false);
        setPendingDelayTask(null);
        setDelayReasonInput('');
    };

    const getTaskLeft = (task: Task) => {
        let px = getDaysDiff(renderStart, task.startDate) * colWidth;
        if (draggingState.isDragging && draggingState.task?.id === task.id) px += tempDragOffsetPx;
        return px;
    };

    const togglePM = (engName: string) => {
        const isCurrentPM = localProject.manager === engName;
        setLocalProject({ ...localProject, manager: isCurrentPM ? undefined : engName });
    };

    // --- Robust Stats Matching Logic ---
    const weekDays = useMemo(() => {
        const baseDate = parseLocalDate(statsWeeklyDate);
        const day = baseDate.getDay();
        const diff = baseDate.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(baseDate);
        monday.setDate(diff);

        const days = [];
        const dayNames = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            days.push({ label: dayNames[i], dateStr: toLocalISOString(d) });
        }
        return days;
    }, [statsWeeklyDate]);

    const weeklyStatsData = useMemo(() => {
        const days = weekDays.map(d => d.dateStr);
        const targetId = String(project.id).trim().toLowerCase();
        const targetName = String(project.name).trim().toLowerCase();
        // Split project info into tokens for fuzzy matching
        const projectTokens = [targetId, targetName].join(' ').toLowerCase().split(/[\s,]+/).filter(Boolean);

        const rangeLogs = (logs || []).filter(l => {
            if (!l.projectId) return false;
            // Fix 1: Normalize Log Date (replace / with -)
            const logDate = String(l.date).replace(/\//g, '-');
            if (logDate < days[0] || logDate > days[6]) return false;

            // Fix 2: Fuzzy ID Matching
            const logProjStr = String(l.projectId).toLowerCase();
            // Exact match check first
            if (logProjStr === targetId) return true;

            const logTokens = logProjStr.split(/[\s,]+/).filter(Boolean);
            // Check if log tokens contain project ID or name, OR if project tokens contain log ID
            const match = logTokens.some(token => projectTokens.includes(token)) ||
                projectTokens.some(token => logTokens.includes(token));

            return match;
        });

        const grouped: Record<string, Record<string, number>> = {};
        rangeLogs.forEach(l => {
            const engName = l.engineer || '未指定';
            // Normalize date again for key
            const dateKey = String(l.date).replace(/\//g, '-');
            if (!grouped[engName]) grouped[engName] = {};
            grouped[engName][dateKey] = (grouped[engName][dateKey] || 0) + l.hours;
        });
        return grouped;
    }, [logs, weekDays, project.id, project.name]);

    const [showPdfOptions, setShowPdfOptions] = useState(false);
    const [pdfConfig, setPdfConfig] = useState({
        format: 'a3' as 'a3' | 'a4',
        orientation: 'landscape' as 'landscape' | 'portrait',
        showDateRange: true
    });

    const getWBSSummary = (category: string) => {
        const tasks = (localProject.tasks || []).filter(t => t.category === category);
        if (tasks.length === 0) return null;

        let minStart = tasks[0].startDate;
        let maxEnd = addDays(tasks[0].startDate, tasks[0].duration);
        let totalDuration = 0;
        let weightedProgress = 0;

        tasks.forEach(t => {
            if (t.startDate < minStart) minStart = t.startDate;
            const end = addDays(t.startDate, t.duration);
            if (end > maxEnd) maxEnd = end;
            totalDuration += t.duration;
            weightedProgress += t.duration * t.progress;
        });

        const avgProgress = totalDuration === 0 ? 0 : Math.round(weightedProgress / totalDuration);
        return { start: minStart, end: maxEnd, progress: avgProgress };
    };

    const toggleAllWBS = (collapse: boolean) => {
        const newWbs = (localProject.wbs || []).map(w => ({ ...w, collapsed: collapse }));
        setLocalProject({ ...localProject, wbs: newWbs });
    };

    const exportPDF = () => {
        // @ts-ignore
        if (typeof html2pdf === 'undefined') return alert("PDF 元件載入失敗");
        const el = document.getElementById('gantt-export-area');
        if (el) {
            const clone = el.cloneNode(true) as HTMLElement;
            clone.classList.add('pdf-visible');

            // Add Project Title for PDF
            const titleDiv = document.createElement('div');
            titleDiv.className = 'px-5 py-3 bg-white border-b border-slate-200 font-bold text-lg text-slate-800 flex items-center gap-4';

            let dateRangeHtml = '';
            if (pdfConfig.showDateRange && localProject.startDate) {
                dateRangeHtml = `<span class="text-sm text-slate-500 ml-auto font-normal">期間: ${localProject.startDate} ~ ${localProject.endDate || '未定'}</span>`;
            }

            titleDiv.innerHTML = `<span>專案: ${localProject.name}</span> <span class="text-xs text-slate-500 font-mono bg-slate-100 px-2 py-1 rounded">ID: ${localProject.id}</span>${dateRangeHtml}`;
            clone.insertBefore(titleDiv, clone.firstChild);

            // Temporarily Force Full Width for PDF to prevent cut-off
            // clone.style.width = '2000px'; // Optional safety if needed

            document.body.appendChild(clone);
            // @ts-ignore
            html2pdf().set({
                margin: 0.2,
                filename: `${localProject.name}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2 },
                jsPDF: { unit: 'in', format: pdfConfig.format, orientation: pdfConfig.orientation }
            }).from(clone).save().then(() => {
                document.body.removeChild(clone);
                setShowPdfOptions(false);
            });
        }
    };

    // ... (Inside render -> WBS Header) ...
    /* 
       We will insert the summary rendering logic inside the main render loop below 
       but first, let's update this block for state/export logic.
    */

    // ... 

    // RENDER RETURN BLOCK UPDATES will be done in next chunks if needed, but here we cover logic. 
    // Button Action change:
    // <button onClick={() => setShowPdfOptions(true)} ...> instead of direct exportPDF 

    // ...

    // Re-inserting the previous button logic here to match target content for replacement:
    <button onClick={() => setShowReportModal(true)} className="bg-brand-600 hover:bg-brand-700 text-white border border-brand-700 px-3 py-1 rounded text-xs font-bold shadow-sm flex items-center transition-colors">
        <i className="fa-solid fa-table-list mr-1.5"></i>詳細報表
    </button>
                    </div >
                </div >
    <div className="flex-1 overflow-auto custom-scroll">
        <table className="w-full text-xs text-left">
            <thead className="text-slate-500 bg-slate-50 sticky top-0">
                <tr>
                    <th className="px-4 py-2">人員</th>
                    {weekDays.map(d => (
                        <th key={d.dateStr} className="px-2 py-2 text-center border-l border-slate-100">
                            <div>{d.label}</div>
                            <div className="text-[9px] font-normal">{d.dateStr.slice(5)}</div>
                        </th>
                    ))}
                    <th className="px-4 py-2 text-right">總計</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {Object.entries(weeklyStatsData).length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-8 text-slate-400">本週無工時紀錄</td></tr>
                ) : Object.entries(weeklyStatsData).map(([eng, days]) => (
                    <tr key={eng}>
                        <td className="px-4 py-2 font-bold text-slate-700">{eng}</td>
                        {weekDays.map(d => (
                            <td key={d.dateStr} className="px-2 py-2 text-center border-l border-slate-100 font-mono">
                                {days[d.dateStr] ? <span className="font-bold text-brand-600">{days[d.dateStr]}</span> : <span className="text-slate-200">-</span>}
                            </td>
                        ))}
                        <td className="px-4 py-2 text-right font-bold text-slate-800">
                            {Object.values(days).reduce((a, b) => a + b, 0)}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
            </div >

    {/* --- MODALS --- */ }
{/* Task Edit Modal */ }
{
    showEditModal && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
                <h3 className="font-bold text-lg mb-4">{editingTask.id ? '編輯任務' : '新增任務'}</h3>
                <div className="space-y-3">
                    <div><label className="text-xs font-bold text-slate-500 block mb-1">任務名稱</label><input value={editingTask.title || ''} onChange={e => setEditingTask({ ...editingTask, title: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" placeholder="例如: 需求訪談" /></div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-bold text-slate-500 block mb-1">WBS 階段</label>
                            <select value={editingTask.category || ''} onChange={e => setEditingTask({ ...editingTask, category: e.target.value })} className="w-full border rounded px-3 py-2 text-sm">
                                {(localProject.wbs || []).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 block mb-1">負責人</label>
                            <select value={editingTask.assignee || ''} onChange={e => setEditingTask({ ...editingTask, assignee: e.target.value })} className="w-full border rounded px-3 py-2 text-sm">
                                <option value="">未指定</option>
                                {(localProject.engineers || []).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div><label className="text-xs font-bold text-slate-500 block mb-1">開始日期</label><input type="date" value={editingTask.startDate || ''} onChange={e => setEditingTask({ ...editingTask, startDate: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" /></div>
                        <div><label className="text-xs font-bold text-slate-500 block mb-1">工期 (天)</label><input type="number" value={editingTask.duration || 1} onChange={e => setEditingTask({ ...editingTask, duration: Number(e.target.value) })} className="w-full border rounded px-3 py-2 text-sm" /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div><label className="text-xs font-bold text-slate-500 block mb-1">進度 %</label><input type="number" min="0" max="100" value={editingTask.progress || 0} onChange={e => setEditingTask({ ...editingTask, progress: Number(e.target.value) })} className="w-full border rounded px-3 py-2 text-sm" /></div>
                        <div><label className="text-xs font-bold text-slate-500 block mb-1">延遲原因</label><input value={editingTask.delayReason || ''} onChange={e => setEditingTask({ ...editingTask, delayReason: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" placeholder="若有延遲請說明..." /></div>
                    </div>
                </div>
                <div className="mt-6 flex justify-between">
                    {editingTask.id && <button onClick={deleteTask} className="text-red-500 font-bold text-xs hover:underline">刪除任務</button>}
                    <div className="flex gap-2 ml-auto">
                        <button onClick={() => setShowEditModal(false)} className="px-4 py-2 text-slate-500 font-bold text-xs hover:bg-slate-100 rounded">取消</button>
                        <button onClick={saveTask} className="px-4 py-2 bg-brand-600 text-white font-bold text-xs rounded shadow">確認</button>
                    </div>
                </div>
            </div>
        </div>
    )
}

{/* Team Modal */ }
{
    showTeamModal && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6 max-h-[80vh] flex flex-col">
                <h3 className="font-bold text-lg mb-4">團隊成員管理</h3>
                <div className="flex-1 overflow-y-auto custom-scroll space-y-2 mb-4">
                    {globalEngineers.map(eng => {
                        const isMember = (localProject.engineers || []).some(e => e.name === eng.name);
                        const isPM = localProject.manager === eng.name;
                        return (
                            <div key={eng.name} className={`flex items-center justify-between p-2 rounded border ${isMember ? 'bg-brand-50 border-brand-200' : 'border-slate-100'}`}>
                                <label className="flex items-center gap-3 cursor-pointer flex-1">
                                    <input type="checkbox" checked={isMember} onChange={() => toggleProjectEngineer(eng)} className="accent-brand-600 w-4 h-4" />
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: eng.color }}></div>
                                        <span className={`text-sm ${isMember ? 'font-bold text-brand-800' : 'text-slate-500'}`}>{eng.name}</span>
                                    </div>
                                </label>
                                {isMember && (
                                    <button onClick={() => togglePM(eng.name)} className={`text-lg transition-colors ${isPM ? 'text-yellow-500' : 'text-slate-200 hover:text-yellow-300'}`} title={isPM ? "取消負責人" : "設為負責人"}>
                                        <i className="fa-solid fa-crown"></i>
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
                <button onClick={() => setShowTeamModal(false)} className="w-full bg-slate-800 text-white py-2 rounded text-xs font-bold">完成</button>
            </div>
        </div>
    )
}

{/* WBS Modal */ }
{
    showWBSModal && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
                <h3 className="font-bold text-lg mb-4">WBS 階段管理</h3>
                <div className="space-y-2 mb-4 max-h-[60vh] overflow-y-auto">
                    {(localProject.wbs || []).map((w, i) => (
                        <div key={w.id} className="flex gap-2">
                            <input value={w.name} onChange={e => {
                                const newName = e.target.value;
                                const oldName = localProject.wbs[i].name;
                                const newWbs = [...localProject.wbs];
                                newWbs[i].name = newName;

                                // Also update tasks associated with this WBS category to prevent orphan tasks
                                const newTasks = (localProject.tasks || []).map(t =>
                                    t.category === oldName ? { ...t, category: newName } : t
                                );

                                setLocalProject({ ...localProject, wbs: newWbs, tasks: newTasks });
                            }} className="flex-1 border rounded px-2 py-1 text-sm" />
                            <button onClick={() => {
                                const newWbs = localProject.wbs.filter((_, idx) => idx !== i);
                                setLocalProject({ ...localProject, wbs: newWbs });
                            }} className="text-red-400 hover:text-red-600"><i className="fa-solid fa-trash"></i></button>
                        </div>
                    ))}
                    <button onClick={() => setLocalProject({ ...localProject, wbs: [...localProject.wbs, { id: Date.now(), name: '新階段', collapsed: false }] })} className="w-full border border-dashed py-2 text-xs font-bold text-slate-400 hover:text-brand-600 hover:border-brand-300">+ 新增階段</button>
                </div>
                <button onClick={() => setShowWBSModal(false)} className="w-full bg-slate-800 text-white py-2 rounded text-xs font-bold">完成</button>
            </div>
        </div>
    )
}

{/* Delay Reason Modal */ }
{
    showDelayModal && (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6 border-l-4 border-amber-500">
                <h3 className="font-bold text-lg mb-2 text-slate-800"><i className="fa-solid fa-triangle-exclamation text-amber-500 mr-2"></i>任務延遲確認</h3>
                <p className="text-xs text-slate-500 mb-4">您將任務結束日期往後調整了，請說明延遲原因以利追蹤。</p>
                <textarea
                    value={delayReasonInput}
                    onChange={e => setDelayReasonInput(e.target.value)}
                    className="w-full border border-slate-300 rounded p-2 text-sm mb-4 h-24 focus:ring-2 focus:ring-amber-500 outline-none"
                    placeholder="請輸入原因 (必填)..."
                />
                <div className="flex gap-2">
                    <button onClick={() => { setShowDelayModal(false); setPendingDelayTask(null); }} className="flex-1 py-2 bg-slate-100 text-slate-600 rounded text-xs font-bold">取消變更</button>
                    <button onClick={confirmDelay} className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded text-xs font-bold">確認延遲</button>
                </div>
            </div>
        </div>
    )
}

{/* Labor Detailed Report Modal */ }
{
    showReportModal && (
        <LaborReportModal
            project={project}
            logs={logs}
            engineers={globalEngineers}
            onClose={() => setShowReportModal(false)}
        />
    )
}
        </div >
    );
};



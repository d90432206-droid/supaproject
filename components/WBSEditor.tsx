
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Project, Task, Engineer, GlobalEngineer, Log, LoginData } from '../types';

interface WBSEditorProps {
    project: Project;
    logs: Log[];
    onUpdate: (updatedProject: Project) => void;
    onClose: () => void;
    loginData: LoginData; // Full login data for PM check
    globalEngineers: GlobalEngineer[];
}

// Helpers
const safeDate = (d: string | undefined | null) => {
    if (!d) return new Date();
    const date = new Date(d);
    return isNaN(date.getTime()) ? new Date() : date;
};

const addDays = (d: string, n: number) => {
    const x = safeDate(d);
    x.setDate(x.getDate() + n);
    return x.toISOString().split('T')[0];
};

const getDaysDiff = (s: string, e: string) => {
    const d1 = safeDate(s);
    const d2 = safeDate(e);
    return Math.ceil((d2.getTime() - d1.getTime()) / 86400000);
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

    // Default stats date to Project Start Date to ensure data visibility
    const [statsWeeklyDate, setStatsWeeklyDate] = useState(
        project.startDate ? project.startDate : new Date().toISOString().split('T')[0]
    );

    const [draggingState, setDraggingState] = useState<{ isDragging: boolean, task: Task | null, startX: number, startDate: string }>({
        isDragging: false, task: null, startX: 0, startDate: ''
    });
    const [tempDragOffsetPx, setTempDragOffsetPx] = useState(0);

    const timelineHeaderRef = useRef<HTMLDivElement>(null);
    const ganttBodyRef = useRef<HTMLDivElement>(null);

    const todayDate = new Date().toISOString().split('T')[0];
    const START_OFFSET = 15;

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
            const targetLeft = (window.innerWidth < 768 ? 160 : 260) + todayOffset - (clientWidth / 2);
            ganttBodyRef.current.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
        }
    };

    // Render Days
    const renderDays = useMemo(() => {
        const validStart = localProject.startDate || new Date().toISOString().split('T')[0];
        const start = addDays(validStart, -START_OFFSET);
        let duration = localProject.endDate ? getDaysDiff(validStart, localProject.endDate) + START_OFFSET + 30 : 60;
        if (duration > 3650) duration = 365; // Cap at 1 year view to prevent crash
        if (duration < 1) duration = 30;

        const days = [];
        for (let i = 0; i < duration; i++) {
            const d = new Date(start); d.setDate(d.getDate() + i);
            const dateStr = d.toISOString().split('T')[0];
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
            const d = new Date(day.dateStr);
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
        const baseDate = safeDate(statsWeeklyDate);
        const day = baseDate.getDay();
        const diff = baseDate.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(baseDate.setDate(diff));
        const days = [];
        const dayNames = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            days.push({ label: dayNames[i], dateStr: d.toISOString().split('T')[0] });
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

    const exportPDF = () => {
        // @ts-ignore
        if (typeof html2pdf === 'undefined') return alert("PDF 元件載入失敗");
        const el = document.getElementById('gantt-export-area');
        if (el) {
            const clone = el.cloneNode(true) as HTMLElement;
            clone.classList.add('pdf-visible');
            document.body.appendChild(clone);
            // @ts-ignore
            html2pdf().set({ margin: 0.2, filename: `${localProject.name}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'in', format: 'a3', orientation: 'landscape' } }).from(clone).save().then(() => document.body.removeChild(clone));
        }
    };

    // Modals

    const handleAddTask = () => {
        // 預設選中第一個分類，避免使用者未選擇時造成空值
        const defaultCategory = (localProject.wbs && localProject.wbs.length > 0) ? localProject.wbs[0].name : '';
        setEditingTask({
            category: defaultCategory,
            startDate: localProject.startDate || new Date().toISOString().split('T')[0],
            duration: 1,
            progress: 0,
            title: '',
            assignee: '',
            delayReason: ''
        });
        setShowEditModal(true);
    };

    const saveTask = () => {
        let finalTask = { ...editingTask };

        // 防呆：如果分類為空 (使用者可能未操作選單)，強制設為第一個分類
        if (!finalTask.category && localProject.wbs && localProject.wbs.length > 0) {
            finalTask.category = localProject.wbs[0].name;
        }

        let newTasks = [...(localProject.tasks || [])];
        if (finalTask.id) {
            const idx = newTasks.findIndex(t => t.id === finalTask.id);
            if (idx !== -1) newTasks[idx] = finalTask as Task;
        } else {
            newTasks.push({
                ...finalTask,
                id: Date.now(),
                actualHours: 0,
                title: finalTask.title || '新任務',
                startDate: finalTask.startDate || new Date().toISOString().split('T')[0],
                duration: finalTask.duration || 1,
                progress: finalTask.progress || 0
            } as Task);
        }
        setLocalProject({ ...localProject, tasks: newTasks });
        setShowEditModal(false);
    };

    const deleteTask = () => {
        if (!confirm("確定刪除此任務？")) return;
        const newTasks = (localProject.tasks || []).filter(t => t.id !== editingTask.id);
        setLocalProject({ ...localProject, tasks: newTasks });
        setShowEditModal(false);
    };

    const toggleProjectEngineer = (eng: GlobalEngineer) => {
        const exists = (localProject.engineers || []).some(e => e.name === eng.name);
        let newEngineers = [...(localProject.engineers || [])];
        if (exists) {
            newEngineers = newEngineers.filter(e => e.name !== eng.name);
        } else {
            newEngineers.push({ id: `e${Date.now()}`, name: eng.name, color: eng.color });
        }
        setLocalProject({ ...localProject, engineers: newEngineers });
    };

    return (
        <div className={`flex flex-col h-full bg-[#f8fafc] text-sm font-sans absolute inset-0 z-50 ${draggingState.isDragging ? 'cursor-grabbing select-none' : ''}`}>
            {/* Header - Z-Index 70 to stay on top */}
            <header className="h-12 bg-white border-b border-slate-200 flex items-center justify-between px-2 md:px-5 shrink-0 shadow-sm z-[70]">
                <div className="flex items-center gap-2 md:gap-3 overflow-hidden">
                    <button onClick={handleCloseAttempt} className="text-xs font-bold text-slate-500 hover:text-brand-600 flex items-center gap-1 shrink-0"><i className="fa-solid fa-arrow-left"></i> 返回</button>
                    <div className="h-4 w-px bg-slate-300 mx-1 shrink-0"></div>
                    <div className="font-bold text-slate-700 flex items-center gap-2 truncate">
                        <span className="truncate max-w-[100px] md:max-w-none">{localProject.name}</span>
                        {hasUnsavedChanges && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold animate-pulse shrink-0">未儲存</span>}
                    </div>
                </div>
                <div className="flex gap-1 md:gap-2 shrink-0">
                    <button onClick={() => setShowTeamModal(true)} className="px-2 md:px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-md text-xs font-bold hover:bg-slate-50"><i className="fa-solid fa-users-gear md:mr-1.5"></i><span className="hidden md:inline">團隊成員</span></button>
                    <button onClick={exportPDF} className="px-2 md:px-3 py-1.5 bg-white border border-red-100 text-red-600 rounded-md text-xs font-bold hover:bg-red-50"><i className="fa-solid fa-file-pdf md:mr-1.5"></i>PDF</button>
                    <button onClick={() => onUpdate(localProject)} className="px-3 md:px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-bold text-xs shadow-md"><i className="fa-solid fa-save md:mr-1.5"></i>儲存 WBS</button>
                </div>
            </header>

            {/* Main Content */}
            <div id="gantt-export-area" className="flex-1 overflow-hidden bg-[#f8fafc] flex flex-col relative border-b border-slate-200">
                {/* Dashboard Controls */}
                <div className="px-2 md:px-5 py-4 shrink-0 bg-white border-b border-slate-200 z-20 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)]">
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">開始日期</label><input type="date" value={localProject.startDate} onChange={e => setLocalProject({ ...localProject, startDate: e.target.value })} className="w-full border rounded px-2 py-1 text-xs font-mono" /></div>
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">結束日期</label><input type="date" value={localProject.endDate || ''} onChange={e => setLocalProject({ ...localProject, endDate: e.target.value })} className="w-full border rounded px-2 py-1 text-xs font-mono" /></div>
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">WBS 階段</label><button onClick={() => setShowWBSModal(true)} className="w-full border rounded px-2 py-1 text-xs font-bold bg-slate-50 hover:bg-white text-slate-600 text-left"><i className="fa-solid fa-list-check mr-2"></i>編輯階段</button></div>
                    </div>
                </div>

                {/* Toolbar */}
                <div className="px-2 md:px-5 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0 z-20 overflow-x-auto gap-2">
                    <div className="flex items-center gap-2 md:gap-3 shrink-0">
                        <div className="flex bg-white p-1 rounded-lg border border-slate-200 shadow-sm">
                            {(['day', 'week', 'month'] as const).map(mode => (
                                <button key={mode} onClick={() => { setViewMode(mode); setColWidth(mode === 'day' ? 40 : mode === 'week' ? 20 : 10); }} className={`px-2 py-1 rounded-md text-xs ${viewMode === mode ? 'bg-brand-50 text-brand-600 font-bold' : 'text-slate-500'}`}>{mode === 'day' ? '日視圖' : mode === 'week' ? '週視圖' : '月視圖'}</button>
                            ))}
                        </div>
                        {/* Zoom Buttons */}
                        <button onClick={() => { setColWidth(c => Math.max(10, c - 5)); setViewMode('custom'); }} className="p-1.5 text-slate-500 bg-white border rounded shadow-sm hover:bg-slate-50" title="縮小 (Ctrl+滾輪)"><i className="fa-solid fa-magnifying-glass-minus text-xs"></i></button>
                        <button onClick={() => { setColWidth(c => Math.min(200, c + 5)); setViewMode('custom'); }} className="p-1.5 text-slate-500 bg-white border rounded shadow-sm hover:bg-slate-50" title="放大 (Ctrl+滾輪)"><i className="fa-solid fa-magnifying-glass-plus text-xs"></i></button>
                        <button onClick={scrollToToday} className="px-3 py-1 bg-red-500 text-white text-xs font-bold rounded shadow-sm hover:bg-red-600 flex items-center"><i className="fa-solid fa-calendar-day mr-1"></i> TODAY</button>
                    </div>
                    {canEditTasks && (
                        <button onClick={handleAddTask} className="bg-brand-600 text-white py-1.5 px-3 rounded-md text-xs font-bold shadow-sm flex-shrink-0"><i className="fa-solid fa-plus mr-1"></i>新增任務</button>
                    )}
                </div>

                {/* Gantt Body */}
                <div className="flex-1 flex flex-col overflow-hidden bg-white relative">
                    {/* Timeline Header */}
                    <div className="h-14 bg-slate-50/95 backdrop-blur flex flex-none border-b border-slate-200 z-20">
                        {/* Sticky Header - Z-Index 60 to cover Today Line but under Header */}
                        <div className="sticky-left-header w-[160px] md:w-[260px] flex-shrink-0 border-r border-slate-200 bg-slate-50 flex items-center px-4 font-bold text-xs text-slate-600 uppercase shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] z-[60]">任務列表 / WBS</div>
                        <div className="flex-1 overflow-hidden relative" ref={timelineHeaderRef}>
                            <div className="flex flex-col h-full bg-white" style={{ width: totalContentWidth }}>
                                <div className="h-7 border-b border-slate-100 flex items-center font-bold text-xs text-slate-500 bg-slate-50">
                                    {headerTopRow.map((item, i) => <div key={i} className="pl-3 border-r border-slate-200 h-full flex items-center" style={{ width: item.width }}>{item.label}</div>)}
                                </div>
                                <div className="h-7 flex items-center">
                                    {renderDays.map(d => (
                                        <div key={d.dateStr}
                                            className={`h-full border-r border-slate-100 flex justify-center items-center text-[10px] font-bold text-slate-600 cursor-pointer 
                                            ${d.isWeekend ? 'bg-orange-200' : ''} 
                                            ${d.isHoliday ? '!bg-red-100 !text-red-600 !border-b-2 !border-red-400' : ''}
                                         `}
                                            style={{ width: colWidth }}
                                            onClick={() => {
                                                const newHolidays = d.isHoliday ? (localProject.holidays || []).filter(h => h !== d.dateStr) : [...(localProject.holidays || []), d.dateStr];
                                                setLocalProject({ ...localProject, holidays: newHolidays });
                                            }}
                                            title={d.isHoliday ? '取消休假' : '設為休假'}
                                        >
                                            {d.label}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-auto custom-scroll relative" ref={ganttBodyRef} onScroll={e => timelineHeaderRef.current && (timelineHeaderRef.current.scrollLeft = (e.target as HTMLElement).scrollLeft)}>
                        <div className="relative min-h-full" style={{ width: (window.innerWidth < 768 ? 160 : 260) + totalContentWidth }}>
                            {/* Background Grid */}
                            <div className="absolute inset-0 flex pointer-events-none z-0 pl-[160px] md:pl-[260px]">
                                {renderDays.map(d => (
                                    <div key={`bg-${d.dateStr}`} className={`flex-shrink-0 border-r border-slate-100 h-full box-border ${d.isWeekend ? 'bg-orange-50' : ''} ${d.isHoliday ? '!bg-red-50' : ''}`} style={{ width: colWidth }}></div>
                                ))}
                            </div>

                            {/* Today Line - Z-Index 30: Above Grid (0) and Static Bars (10), but below Sticky Cols (60) and Dragged Bars (50) if desired.
                            User said "Today line covers task list", so it must be lower than Sticky (60). 
                        */}
                            {todayOffset >= 0 && (
                                <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-30 pointer-events-none" style={{ left: (window.innerWidth < 768 ? 160 : 260) + todayOffset + (colWidth / 2) }}>
                                    <div className="absolute -top-2.5 -left-1.5 text-red-500"><i className="fa-solid fa-caret-down text-sm"></i></div>
                                </div>
                            )}

                            {/* Task Rows */}
                            <div className="relative pb-10">
                                {(localProject.wbs || []).map((cat, i) => (
                                    <div key={cat.id}>
                                        {/* Sticky WBS Header - Z-Index 60 */}
                                        <div className="sticky left-0 w-[100vw] z-[60] bg-slate-50/95 border-y border-slate-200 cursor-pointer hover:bg-slate-100 flex" onClick={() => {
                                            const newWbs = localProject.wbs.map(w => w.id === cat.id ? { ...w, collapsed: !w.collapsed } : w);
                                            setLocalProject({ ...localProject, wbs: newWbs });
                                        }}>
                                            <div className="w-[160px] md:w-[260px] px-2 md:px-4 py-1.5 flex items-center font-bold text-xs text-slate-700 sticky-left-col border-r border-slate-200">
                                                <i className={`fa-solid fa-caret-down mr-2 transition-transform ${cat.collapsed ? '-rotate-90' : ''}`}></i>
                                                {cat.name}
                                            </div>
                                        </div>
                                        {!cat.collapsed && (localProject.tasks || []).filter(t => t.category === cat.name).map(task => (
                                            <div key={task.id} className="flex h-9 border-b border-slate-100 relative group hover:bg-blue-50/20">
                                                {/* Sticky Task Info - Z-Index 60 to cover Today Line (30) */}
                                                <div className="sticky left-0 w-[160px] md:w-[260px] bg-white z-[60] flex items-center px-2 md:px-4 border-r border-slate-200 sticky-left-col shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] cursor-pointer" onClick={() => { setEditingTask({ ...task }); setShowEditModal(true); }}>
                                                    <div className="w-full truncate">
                                                        <div className="flex justify-between items-center">
                                                            <span className="text-xs font-medium text-slate-700 truncate">{task.title}</span>
                                                            {task.delayReason && <i className="fa-solid fa-circle-exclamation text-amber-500 text-[10px] ml-1" title={`延遲原因: ${task.delayReason}`}></i>}
                                                        </div>
                                                        <div className="w-full h-1 bg-slate-100 rounded-full mt-1 overflow-hidden">
                                                            <div className="h-full bg-brand-500" style={{ width: `${task.progress}%` }}></div>
                                                        </div>
                                                    </div>
                                                </div>
                                                {/* Task Bar */}
                                                <div className="relative h-full w-full">
                                                    <div
                                                        className={`absolute h-5 top-2 rounded-sm shadow-sm flex items-center px-2 text-[10px] text-white font-bold whitespace-nowrap overflow-hidden border border-white/20 select-none
                                                        ${draggingState.task?.id === task.id ? 'opacity-80 scale-[1.01] shadow-xl ring-2 ring-white z-50 cursor-grabbing' : 'cursor-grab hover:brightness-110 z-10'}
                                                    `}
                                                        style={{
                                                            left: getTaskLeft(task),
                                                            width: Math.max(colWidth, task.duration * colWidth),
                                                            backgroundColor: getAssigneeColor(task.assignee)
                                                        }}
                                                        onMouseDown={(e) => handleMouseDown(task, e)}
                                                    >
                                                        {task.progress}%
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Weekly Stats Footer */}
            <div className="h-48 shrink-0 bg-white border-t border-slate-200 flex flex-col">
                <div className="px-4 py-2 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <h4 className="font-bold text-xs text-brand-600"><i className="fa-solid fa-chart-simple mr-2"></i>本專案每週工時統計</h4>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-400">週次基準日:</span>
                        <input type="date" value={statsWeeklyDate} onChange={e => setStatsWeeklyDate(e.target.value)} className="border rounded px-2 py-0.5 text-xs font-mono" />
                    </div>
                </div>
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
            </div>

            {/* --- MODALS --- */}
            {/* Task Edit Modal */}
            {showEditModal && (
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
            )}

            {/* Team Modal */}
            {showTeamModal && (
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
            )}

            {/* WBS Modal */}
            {showWBSModal && (
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
            )}

            {/* Delay Reason Modal */}
            {showDelayModal && (
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
            )}
        </div>
    );
};

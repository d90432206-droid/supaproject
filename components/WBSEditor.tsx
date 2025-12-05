
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Project, Task, Engineer, GlobalEngineer, Log } from '../types';

interface WBSEditorProps {
  project: Project;
  logs: Log[]; 
  onUpdate: (updatedProject: Project) => void;
  onClose: () => void;
  isAdmin: boolean;
  globalEngineers: GlobalEngineer[];
}

// Helpers (Safe versions to prevent crashes)
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

export const WBSEditor: React.FC<WBSEditorProps> = ({ project, logs, onUpdate, onClose, globalEngineers }) => {
  const [localProject, setLocalProject] = useState<Project>(JSON.parse(JSON.stringify(project)));
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('day');
  const [colWidth, setColWidth] = useState(40);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [showWBSModal, setShowWBSModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Partial<Task>>({});
  
  // Statistics State
  // 修正：預設日期改為專案開始日期，若無則為今天。解決開啟未來專案時統計表空白的問題。
  const [statsWeeklyDate, setStatsWeeklyDate] = useState(
      project.startDate ? project.startDate : new Date().toISOString().split('T')[0]
  );

  // Dragging state
  const [draggingState, setDraggingState] = useState<{isDragging: boolean, task: Task | null, startX: number, startDate: string}>({
    isDragging: false, task: null, startX: 0, startDate: ''
  });
  const [tempDragOffsetPx, setTempDragOffsetPx] = useState(0);

  // Refs
  const timelineHeaderRef = useRef<HTMLDivElement>(null);
  const ganttBodyRef = useRef<HTMLDivElement>(null);

  const todayDate = new Date().toISOString().split('T')[0];
  const START_OFFSET = 15;

  // --- Dirty Check / Unsaved Changes Logic ---
  const hasUnsavedChanges = useMemo(() => {
    return JSON.stringify(localProject) !== JSON.stringify(project);
  }, [localProject, project]);

  // NEW: Sync local state when parent updates project (e.g. save successful)
  useEffect(() => {
      setLocalProject(JSON.parse(JSON.stringify(project)));
  }, [project]);

  const handleCloseAttempt = () => {
    if (hasUnsavedChanges) {
      if (window.confirm("您有未儲存的變更，確定要離開嗎？\n\n離開後，未儲存的編輯將會遺失。")) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = ''; 
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Render Logic
  const renderDays = useMemo(() => {
    // Defensive coding: ensure valid start date
    const validStart = localProject.startDate || new Date().toISOString().split('T')[0];
    const start = addDays(validStart, -START_OFFSET);
    
    let duration = 60;
    if (localProject.endDate) {
        duration = getDaysDiff(validStart, localProject.endDate) + START_OFFSET + 30;
    }
    // Limit duration to prevent browser crash on bad dates (e.g. year 2099)
    if (duration > 3650) duration = 365; // Max 1 year view if calculation goes wrong
    if (duration < 1) duration = 30;

    const days = [];
    for (let i = 0; i < duration; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const dayOfWeek = d.getDay();
      days.push({ 
        dateStr, 
        dayOfWeek, 
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

  // Statistics Logic
  const weekDays = useMemo(() => {
    const baseDate = safeDate(statsWeeklyDate);
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
  }, [statsWeeklyDate]);

  const weeklyStatsData = useMemo(() => {
    const days = weekDays.map(d => d.dateStr);
    const safeLogs = logs || [];
    
    // 修正：同時比對 ID 與 Name (雙向 token 比對)
    const targetId = String(project.id).trim().toLowerCase();
    const targetName = String(project.name).trim().toLowerCase();
    
    // 將專案資訊拆解成關鍵字 (例如: ["25033", "mmcho"])
    const projectTokens = [targetId, targetName].flatMap(s => s.split(/[\s,]+/)).filter(Boolean);

    const rangeLogs = safeLogs.filter(l => {
        if (!l.projectId) return false;

        // 1. 日期格式統一化 (防止 2025/12/05 vs 2025-12-05 比對失敗)
        const logDate = String(l.date).replace(/\//g, '-');
        if (logDate < days[0] || logDate > days[6]) return false;

        // 2. Project ID 匹配邏輯
        const logProjStr = String(l.projectId).toLowerCase();
        
        // A. 直接包含 (Direct Include)
        if (logProjStr.includes(targetId)) return true;
        if (targetName && logProjStr.includes(targetName)) return true;

        // B. Token 比對 (只要 Log 中的任何一個字 出現在 專案關鍵字中，就算符合)
        const logTokens = logProjStr.split(/[\s,]+/).filter(Boolean);
        if (logTokens.some(token => projectTokens.includes(token))) return true;

        return false;
    });

    const grouped: Record<string, Record<string, number>> = {}; 
    rangeLogs.forEach(l => {
        const engName = l.engineer || '未指定';
        // Normalize log date for grouping key as well
        const dateKey = String(l.date).replace(/\//g, '-');
        if(!grouped[engName]) grouped[engName] = {};
        const curr = grouped[engName][dateKey] || 0;
        grouped[engName][dateKey] = curr + l.hours;
    });
    return grouped;
  }, [logs, weekDays, project.id, project.name]);

  // Drag Handlers
  const handleMouseDown = (task: Task, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDraggingState({ isDragging: true, task, startX: e.clientX, startDate: task.startDate });
    setTempDragOffsetPx(0);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (draggingState.isDragging) {
        setTempDragOffsetPx(e.clientX - draggingState.startX);
      }
    };
    const handleMouseUp = () => {
      if (draggingState.isDragging && draggingState.task) {
        const daysDelta = Math.round(tempDragOffsetPx / colWidth);
        if (daysDelta !== 0) {
          const updatedTasks = (localProject.tasks || []).map(t => {
            if (t.id === draggingState.task!.id) {
              return { ...t, startDate: addDays(draggingState.startDate, daysDelta) };
            }
            return t;
          });
          setLocalProject(prev => ({ ...prev, tasks: updatedTasks }));
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

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (timelineHeaderRef.current) {
      timelineHeaderRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  const getTaskLeft = (task: Task) => {
    let px = getDaysDiff(renderStart, task.startDate) * colWidth;
    if (draggingState.isDragging && draggingState.task?.id === task.id) {
      px += tempDragOffsetPx;
    }
    return px;
  };

  const getEngineer = (id: string) => (localProject.engineers || []).find(e => e.id === id) || { name: '未定', color: '#94a3b8' };

  const handleSave = () => {
    onUpdate(localProject);
  };

  const openEditModal = (task: Task | null) => {
    if (task) setEditingTask({ ...task });
    else setEditingTask({
      id: undefined, title: '新任務', assignee: localProject.engineers[0]?.id,
      startDate: localProject.startDate || todayDate, duration: 5, progress: 0, hours: 8, actualHours: 0,
      category: localProject.wbs[0]?.name || 'Default'
    });
    setShowEditModal(true);
  };

  const saveTask = () => {
    let newTasks = [...(localProject.tasks || [])];
    if (editingTask.id) {
      const idx = newTasks.findIndex(t => t.id === editingTask.id);
      if (idx !== -1) newTasks[idx] = editingTask as Task;
    } else {
      newTasks.push({ ...editingTask, id: Date.now() } as Task);
    }
    setLocalProject(prev => ({ ...prev, tasks: newTasks }));
    setShowEditModal(false);
  };

  const deleteTask = () => {
    const newTasks = (localProject.tasks || []).filter(t => t.id !== editingTask.id);
    setLocalProject(prev => ({ ...prev, tasks: newTasks }));
    setShowEditModal(false);
  };

  const toggleProjectEngineer = (globalEng: GlobalEngineer) => {
    const exists = (localProject.engineers || []).some(e => e.name === globalEng.name);
    let newEngineers = [...(localProject.engineers || [])];
    
    if (exists) {
        newEngineers = newEngineers.filter(e => e.name !== globalEng.name);
    } else {
        newEngineers.push({
            id: globalEng.name, 
            name: globalEng.name,
            color: globalEng.color
        });
    }
    setLocalProject(prev => ({ ...prev, engineers: newEngineers }));
  };

  const isOverdue = (task: Task) => {
     if(!task.startDate || !task.duration || task.progress >= 100) return false;
     const end = addDays(task.startDate, task.duration);
     return (todayDate > end);
  };

  const exportPDF = () => {
      const el = document.getElementById('gantt-export-area');
      if(!el) return;
      // @ts-ignore
      if (typeof html2pdf === 'undefined') {
          alert("PDF 匯出套件尚未載入，請稍後再試");
          return;
      }
      const clone = el.cloneNode(true) as HTMLElement;
      clone.classList.add('pdf-visible');
      document.body.appendChild(clone);
      
      // @ts-ignore
      html2pdf().set({ 
          margin: 0.2, 
          filename: `${localProject.name}.pdf`, 
          image: { type: 'jpeg', quality: 0.98 }, 
          html2canvas: { scale: 2 }, 
          jsPDF: { unit: 'in', format: 'a3', orientation: 'landscape' } 
      }).from(clone).save().then(() => {
          document.body.removeChild(clone);
      });
  };

  return (
    <div className={`flex flex-col h-full bg-[#f8fafc] text-sm font-sans absolute inset-0 z-50 ${draggingState.isDragging ? 'cursor-grabbing select-none' : ''}`}>
        
        {/* Toolbar */}
        <header className="h-12 bg-white border-b border-slate-200 flex items-center justify-between px-5 shrink-0 shadow-sm z-30">
            <div className="flex items-center gap-3">
                <button onClick={handleCloseAttempt} className="text-xs font-bold text-slate-500 hover:text-brand-600 flex items-center gap-1">
                    <i className="fa-solid fa-arrow-left"></i> 返回
                </button>
                <div className="h-4 w-px bg-slate-300 mx-2"></div>
                <div className="font-bold text-slate-700 flex items-center gap-2">
                  {localProject.name} <span className="text-slate-400 font-normal">| WBS 編輯器</span>
                  {hasUnsavedChanges && (
                    <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold animate-pulse">
                      未儲存
                    </span>
                  )}
                </div>
            </div>
            <div className="flex gap-2">
                <button onClick={() => setShowTeamModal(true)} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-md text-xs font-bold hover:bg-slate-50"><i className="fa-solid fa-users-gear mr-1.5"></i>團隊成員</button>
                <div className="w-px h-6 bg-slate-200 mx-1 self-center"></div>
                <button onClick={exportPDF} className="px-3 py-1.5 bg-white border border-red-100 text-red-600 rounded-md text-xs font-bold hover:bg-red-50"><i className="fa-solid fa-file-pdf mr-1.5"></i>PDF</button>
                <button onClick={handleSave} className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-bold text-xs shadow-md transition-all flex items-center"><i className="fa-solid fa-save mr-1.5"></i>儲存 WBS</button>
            </div>
        </header>

        {/* Main Gantt Area */}
        <div id="gantt-export-area" className="flex-1 overflow-hidden bg-[#f8fafc] flex flex-col relative border-b border-slate-200">
            
            {/* Controls */}
            <div className="px-5 py-4 shrink-0 bg-white border-b border-slate-200 z-20 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)]">
                <div className="flex flex-wrap lg:flex-nowrap gap-5 items-end">
                    <div className="flex-1 grid grid-cols-2 md:grid-cols-5 gap-4">
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">開始日期</label>
                            <input type="date" value={localProject.startDate} onChange={e => setLocalProject({...localProject, startDate: e.target.value})} className="w-full border rounded px-2 py-1 text-xs font-mono" />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">結束日期</label>
                            <input type="date" value={localProject.endDate || ''} onChange={e => setLocalProject({...localProject, endDate: e.target.value})} className="w-full border rounded px-2 py-1 text-xs font-mono" />
                        </div>
                        <div>
                             <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">WBS 階段</label>
                             <button onClick={() => setShowWBSModal(true)} className="w-full border rounded px-2 py-1 text-xs font-bold bg-slate-50 hover:bg-white text-slate-600 text-left">
                                 <i className="fa-solid fa-list-check mr-2"></i>編輯階段
                             </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* View Controls */}
            <div className="px-5 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0 z-20" data-html2canvas-ignore="true">
                <div className="flex items-center gap-3">
                    <div className="flex bg-white p-1 rounded-lg border border-slate-200 shadow-sm">
                        {(['day', 'week', 'month'] as const).map(mode => (
                            <button key={mode} onClick={() => { setViewMode(mode); setColWidth(mode === 'day' ? 40 : mode === 'week' ? 20 : 10); }} 
                                    className={`px-3 py-1 rounded-md text-xs transition-all capitalize ${viewMode === mode ? 'bg-brand-50 text-brand-600 font-bold shadow-sm ring-1 ring-brand-100' : 'text-slate-500 hover:text-slate-700 font-medium hover:bg-slate-50'}`}>
                                {mode === 'day' ? '日視圖' : mode === 'week' ? '週視圖' : '月視圖'}
                            </button>
                        ))}
                    </div>
                </div>
                <button onClick={() => openEditModal(null)} className="bg-brand-600 text-white py-1.5 px-4 rounded-md text-xs font-bold shadow-sm flex items-center"><i className="fa-solid fa-plus mr-1.5"></i>新增任務</button>
            </div>

            {/* Gantt Body */}
            <div className="flex-1 flex flex-col overflow-hidden bg-white relative">
                
                {/* Timeline Header */}
                <div className="h-14 bg-slate-50/95 backdrop-blur flex flex-none border-b border-slate-200 z-20">
                    <div className="sticky-left-header w-[260px] flex-shrink-0 border-r border-slate-200 bg-slate-50 flex items-center px-4 font-bold text-xs text-slate-600 uppercase tracking-wide">
                        任務列表 / WBS
                    </div>
                    <div className="flex-1 overflow-hidden min-w-0 relative" ref={timelineHeaderRef}>
                        <div className="flex flex-col h-full bg-white" style={{ width: totalContentWidth }}>
                            <div className="h-7 border-b border-slate-100 flex items-center font-bold text-xs text-slate-500 bg-slate-50">
                                {headerTopRow.map((item, i) => (
                                    <div key={i} className="pl-3 border-r border-slate-200 whitespace-nowrap overflow-hidden h-full flex items-center" style={{ width: item.width }}>{item.label}</div>
                                ))}
                            </div>
                            <div className="h-7 flex items-center">
                                {renderDays.map(d => (
                                    <div key={d.dateStr} className={`h-full border-r border-slate-100 flex flex-col justify-center items-center text-[10px] font-bold text-slate-600 cursor-pointer transition-colors
                                         ${d.isWeekend ? 'bg-orange-200 text-orange-800' : ''} 
                                         ${d.isHoliday ? '!bg-red-100 !text-red-600 border-b-2 border-red-400 !important' : ''}`} 
                                         style={{ width: colWidth }}
                                         onClick={() => {
                                             const newHolidays = d.isHoliday 
                                                ? (localProject.holidays || []).filter(h => h !== d.dateStr)
                                                : [...(localProject.holidays || []), d.dateStr];
                                             setLocalProject({...localProject, holidays: newHolidays});
                                         }}>
                                        <span className="leading-none">{d.label}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-auto custom-scroll relative" ref={ganttBodyRef} onScroll={handleScroll}>
                    <div className="relative min-h-full" style={{ width: 260 + totalContentWidth }}>
                        
                        {/* Grid Lines */}
                        <div className="absolute inset-0 flex pointer-events-none z-0 pl-[260px]">
                            {renderDays.map(d => (
                                <div key={`bg-${d.dateStr}`} className={`flex-shrink-0 border-r border-slate-100 h-full box-border 
                                    ${d.isWeekend ? 'bg-orange-200/30' : ''} 
                                    ${d.isHoliday ? 'bg-red-50/50' : ''}`} 
                                    style={{ width: colWidth }}></div>
                            ))}
                        </div>

                        {/* Today Line (z-40) */}
                        {todayOffset >= 0 && (
                            <div className="absolute top-0 bottom-0 w-[2px] bg-red-500 z-40 pointer-events-none" style={{ left: 260 + todayOffset + (colWidth/2) }}>
                                <div className="absolute -top-1 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[9px] px-1 rounded font-bold">TODAY</div>
                            </div>
                        )}

                        {/* Tasks Content */}
                        <div className="relative z-10 pt-1 pb-10">
                            {(localProject.wbs || []).map(wbs => (
                                <div key={wbs.id}>
                                    {/* WBS Group Header (Sticky) */}
                                    <div className="flex border-y border-slate-200 bg-slate-100 sticky-wbs-header group cursor-pointer hover:bg-slate-200 transition-colors"
                                         onClick={() => {
                                             const newWBS = localProject.wbs.map(w => w.id === wbs.id ? { ...w, collapsed: !w.collapsed } : w);
                                             setLocalProject({ ...localProject, wbs: newWBS });
                                         }}>
                                        <div className="sticky-wbs-label w-[260px] flex-shrink-0 px-4 py-1.5 flex items-center font-bold text-xs text-slate-700 bg-slate-100 z-20 border-r border-slate-200">
                                            <div className="w-4 h-4 rounded bg-slate-300 flex items-center justify-center mr-2 transition-transform">
                                                <i className={`fa-solid fa-chevron-down text-[8px] ${wbs.collapsed ? '-rotate-90' : ''}`}></i>
                                            </div>
                                            {wbs.name}
                                        </div>
                                        <div className="flex-1"></div>
                                    </div>

                                    {/* Task Rows */}
                                    {!wbs.collapsed && (localProject.tasks || []).filter(t => t.category === wbs.name).map(task => (
                                        <div key={task.id} className="flex h-10 border-b border-slate-100 relative group hover:bg-blue-50/30">
                                            
                                            {/* Sticky Left Column */}
                                            <div className="sticky-left-col w-[260px] flex-shrink-0 px-4 flex items-center cursor-pointer border-r border-slate-200 bg-white group-hover:bg-blue-50/30 z-20" onClick={() => openEditModal(task)}>
                                                <div className="flex flex-col truncate w-full">
                                                    <div className="flex justify-between items-center">
                                                        <span className="truncate text-[12px] font-semibold text-slate-700">{task.title}</span>
                                                        {isOverdue(task) && <i className="fa-solid fa-triangle-exclamation text-red-500 text-[10px]" title="已逾期"></i>}
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        <div className="w-16 h-1 bg-slate-200 rounded-full overflow-hidden"><div className="h-full bg-brand-500" style={{ width: `${task.progress}%` }}></div></div>
                                                        <span className="text-[9px] text-slate-400">{task.progress}%</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Gantt Bar Area */}
                                            <div className="relative h-full flex-1">
                                                <div 
                                                    className={`absolute h-6 top-2 rounded shadow-sm flex items-center px-2 border border-white/20 select-none cursor-grab active:cursor-grabbing hover:brightness-95 transition-all ${draggingState.task?.id === task.id ? 'z-50 ring-2 ring-white shadow-xl scale-[1.02] opacity-90' : 'z-10'}`}
                                                    style={{ 
                                                        left: getTaskLeft(task), 
                                                        width: Math.max(colWidth, task.duration * colWidth), 
                                                        backgroundColor: isOverdue(task) ? '#ef4444' : getEngineer(task.assignee).color 
                                                    }}
                                                    onMouseDown={(e) => handleMouseDown(task, e)}
                                                >
                                                    <div className="text-[9px] text-white font-bold truncate flex items-center gap-2 w-full">
                                                        <span>{getEngineer(task.assignee).name}</span>
                                                        <span className="ml-auto bg-black/10 px-1 rounded">{task.actualHours || 0}/{task.hours}h</span>
                                                    </div>
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

        {/* Weekly Statistics */}
        <div className="h-48 border-t border-slate-200 bg-white shrink-0 flex flex-col" data-html2canvas-ignore="true">
             <div className="px-5 py-2 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                 <h4 className="font-bold text-xs text-slate-700 uppercase tracking-wide">
                     <i className="fa-solid fa-chart-bar mr-2 text-brand-500"></i>本專案每週工時統計
                 </h4>
                 <div className="flex items-center gap-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">週次基準日:</label>
                    <input 
                        type="date" 
                        value={statsWeeklyDate} 
                        onChange={e => setStatsWeeklyDate(e.target.value)} 
                        className="border rounded px-2 py-1 text-xs font-mono" 
                    />
                 </div>
             </div>
             <div className="flex-1 overflow-auto custom-scroll p-4">
                <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-200">
                        <tr>
                            <th className="px-3 py-2 border-r border-slate-100">人員</th>
                            {weekDays.map((d, i) => (
                                <th key={i} className={`px-2 py-2 text-center border-r border-slate-100 ${i>=5?'bg-slate-100':''}`}>
                                    {d.label} <span className="text-[9px] block">{d.dateStr.slice(5)}</span>
                                </th>
                            ))}
                            <th className="px-3 py-2 text-right font-bold">總計</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {Object.keys(weeklyStatsData).length === 0 ? (
                            <tr><td colSpan={9} className="text-center py-4 text-slate-400">本週無工時紀錄</td></tr>
                        ) : Object.entries(weeklyStatsData).map(([eng, dates]) => (
                            <tr key={eng} className="hover:bg-slate-50">
                                <td className="px-3 py-2 font-bold text-slate-700 border-r border-slate-100">{eng}</td>
                                {weekDays.map((d, i) => (
                                    <td key={i} className="px-2 py-2 text-center border-r border-slate-100 font-mono text-slate-600">
                                        {dates[d.dateStr] ? <span className="font-bold text-brand-600">{dates[d.dateStr]}</span> : <span className="text-slate-200">-</span>}
                                    </td>
                                ))}
                                <td className="px-3 py-2 text-right font-bold font-mono text-slate-800">
                                    {Object.values(dates).reduce((a, b) => a + b, 0)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
             </div>
        </div>

        {/* Modals omitted for brevity - logic remains same but safer */}
        {showEditModal && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
                    <h3 className="font-bold text-lg mb-4 text-slate-800">{editingTask.id ? '編輯任務' : '新增任務'}</h3>
                    <div className="space-y-4">
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">任務名稱</label><input value={editingTask.title} onChange={e => setEditingTask({...editingTask, title: e.target.value})} className="w-full border rounded px-3 py-2 text-sm" /></div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">WBS 階段</label>
                                <select value={editingTask.category} onChange={e => setEditingTask({...editingTask, category: e.target.value})} className="w-full border rounded px-3 py-2 text-sm">
                                    {(localProject.wbs || []).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">負責人</label>
                                <select value={editingTask.assignee} onChange={e => setEditingTask({...editingTask, assignee: e.target.value})} className="w-full border rounded px-3 py-2 text-sm">
                                    {(localProject.engineers || []).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">開始日期</label><input type="date" value={editingTask.startDate} onChange={e => setEditingTask({...editingTask, startDate: e.target.value})} className="w-full border rounded px-3 py-2 text-sm" /></div>
                            <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">工期 (天)</label><input type="number" value={editingTask.duration} onChange={e => setEditingTask({...editingTask, duration: Number(e.target.value)})} className="w-full border rounded px-3 py-2 text-sm" /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                             <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">預估工時</label><input type="number" value={editingTask.hours} onChange={e => setEditingTask({...editingTask, hours: Number(e.target.value)})} className="w-full border rounded px-3 py-2 text-sm" /></div>
                             <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">完成進度 ({editingTask.progress}%)</label><input type="range" min="0" max="100" step="10" value={editingTask.progress} onChange={e => setEditingTask({...editingTask, progress: Number(e.target.value)})} className="w-full" /></div>
                        </div>
                    </div>
                    <div className="mt-6 flex justify-between pt-4 border-t border-slate-100">
                        {editingTask.id && <button onClick={deleteTask} className="text-red-500 font-bold text-xs hover:underline">刪除任務</button>}
                        <div className="flex gap-2 ml-auto">
                            <button onClick={() => setShowEditModal(false)} className="px-4 py-2 text-slate-500 font-bold text-xs hover:bg-slate-100 rounded">取消</button>
                            <button onClick={saveTask} className="px-4 py-2 bg-brand-600 text-white rounded font-bold text-xs hover:bg-brand-700">確認儲存</button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {showTeamModal && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 max-h-[80vh] flex flex-col">
                    <h3 className="font-bold text-lg mb-4 text-slate-800">專案團隊成員</h3>
                    <p className="text-xs text-slate-500 mb-4">請勾選參與此專案的工程師，他們將會出現在任務指派選單中。</p>
                    <div className="flex-1 overflow-y-auto custom-scroll border border-slate-200 rounded-lg p-2">
                        {globalEngineers.length === 0 ? (
                            <p className="text-center text-slate-400 py-4 text-xs">目前無全域工程師資料</p>
                        ) : (
                            globalEngineers.map(eng => {
                                const isSelected = (localProject.engineers || []).some(e => e.name === eng.name);
                                return (
                                    <label key={eng.name} className={`flex items-center p-2 rounded cursor-pointer hover:bg-slate-50 ${isSelected ? 'bg-brand-50' : ''}`}>
                                        <input 
                                            type="checkbox" 
                                            checked={isSelected} 
                                            onChange={() => toggleProjectEngineer(eng)}
                                            className="mr-3 accent-brand-600 w-4 h-4"
                                        />
                                        <div className="w-6 h-6 rounded-full mr-2 shadow-sm border border-black/10" style={{ backgroundColor: eng.color }}></div>
                                        <span className={`text-sm font-bold ${isSelected ? 'text-brand-700' : 'text-slate-600'}`}>{eng.name}</span>
                                    </label>
                                );
                            })
                        )}
                    </div>
                    <button onClick={() => setShowTeamModal(false)} className="mt-4 w-full bg-slate-800 text-white py-2 rounded font-bold text-xs hover:bg-slate-700">完成設定</button>
                </div>
            </div>
        )}

        {showWBSModal && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
                    <h3 className="font-bold text-lg mb-4 text-slate-800">編輯 WBS 階段</h3>
                    <div className="space-y-2 mb-4">
                        {(localProject.wbs || []).map((item, index) => (
                            <div key={index} className="flex gap-2">
                                <input value={item.name} onChange={e => {
                                    const newWBS = [...(localProject.wbs || [])];
                                    newWBS[index].name = e.target.value;
                                    setLocalProject({...localProject, wbs: newWBS});
                                }} className="flex-1 border rounded px-2 py-1 text-sm" />
                                <button onClick={() => {
                                    const newWBS = [...(localProject.wbs || [])];
                                    newWBS.splice(index, 1);
                                    setLocalProject({...localProject, wbs: newWBS});
                                }} className="text-red-400 hover:text-red-600"><i className="fa-solid fa-trash"></i></button>
                            </div>
                        ))}
                    </div>
                    <button onClick={() => setLocalProject({...localProject, wbs: [...(localProject.wbs || []), { id: Date.now(), name: '新階段', collapsed: false }]})} className="w-full border border-dashed border-slate-300 py-2 text-slate-500 text-xs font-bold hover:bg-slate-50 hover:text-brand-600 mb-4">+ 新增階段</button>
                    <button onClick={() => setShowWBSModal(false)} className="w-full bg-brand-600 text-white py-2 rounded font-bold text-xs hover:bg-brand-700">完成</button>
                </div>
            </div>
        )}
    </div>
  );
};

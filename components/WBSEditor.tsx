import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Project, Task, Engineer } from '../types';

interface WBSEditorProps {
  project: Project;
  onUpdate: (updatedProject: Project) => void;
  onClose: () => void;
  isAdmin: boolean;
}

// Helpers
const addDays = (d: string, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().split('T')[0]; };
const getDaysDiff = (s: string, e: string) => Math.ceil((new Date(e).getTime() - new Date(s).getTime()) / 86400000);
const distinctColors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e'];

export const WBSEditor: React.FC<WBSEditorProps> = ({ project, onUpdate, onClose }) => {
  const [localProject, setLocalProject] = useState<Project>(JSON.parse(JSON.stringify(project)));
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('day');
  const [colWidth, setColWidth] = useState(40);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Partial<Task>>({});
  
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

  // Render Logic
  const renderDays = useMemo(() => {
    const start = addDays(localProject.startDate, -START_OFFSET);
    let duration = 60;
    if (localProject.endDate) duration = getDaysDiff(localProject.startDate, localProject.endDate) + START_OFFSET + 30;
    
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
  const renderStart = addDays(localProject.startDate, -START_OFFSET);
  const todayDiff = getDaysDiff(renderStart, todayDate);
  const todayOffset = todayDiff >= 0 ? todayDiff * colWidth : -1;

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
          const updatedTasks = localProject.tasks.map(t => {
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
      startDate: localProject.startDate, duration: 5, progress: 0, hours: 8, actualHours: 0,
      category: localProject.wbs[0]?.name
    });
    setShowEditModal(true);
  };

  const saveTask = () => {
    let newTasks = [...localProject.tasks];
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
    const newTasks = localProject.tasks.filter(t => t.id !== editingTask.id);
    setLocalProject(prev => ({ ...prev, tasks: newTasks }));
    setShowEditModal(false);
  };

  const addEngineer = () => {
    const newEngineers = [...(localProject.engineers || [])];
    const color = distinctColors[newEngineers.length % distinctColors.length];
    newEngineers.push({ id: 'e' + Date.now(), name: '新成員', color });
    setLocalProject(prev => ({ ...prev, engineers: newEngineers }));
  };

  const exportPDF = () => {
    const element = document.getElementById('gantt-export-area');
    if (element && (window as any).html2pdf) {
      const clone = element.cloneNode(true) as HTMLElement;
      clone.classList.add('pdf-visible');
      document.body.appendChild(clone);
      (window as any).html2pdf().set({
        margin: 0.2, filename: `${project.name}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'in', format: 'a3', orientation: 'landscape' }
      }).from(clone).save().then(() => {
        document.body.removeChild(clone);
      });
    }
  };

  return (
    <div className={`absolute inset-0 z-50 bg-white flex flex-col animate-in slide-in-from-right duration-300 ${draggingState.isDragging ? 'cursor-grabbing select-none' : ''}`}>
      {/* Header */}
      <div className="h-10 bg-slate-900 flex items-center px-4 justify-between shrink-0">
        <button onClick={onClose} className="text-xs font-bold text-white hover:text-brand-400 flex items-center gap-1">
          <i className="fa-solid fa-arrow-left"></i> 返回專案列表
        </button>
        <span className="text-xs text-slate-400 font-mono">正在編輯：{localProject.name}</span>
      </div>

      {/* Toolbar */}
      <header className="h-12 bg-white border-b border-slate-200 flex items-center justify-between px-5 shrink-0 shadow-sm z-30">
        <div className="font-bold text-slate-700">{localProject.name} <span className="text-slate-400 font-normal">| WBS 編輯器</span></div>
        <div className="flex gap-2">
          <button onClick={() => setShowTeamModal(true)} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-md text-xs font-bold hover:bg-slate-50">
            <i className="fa-solid fa-users-gear mr-1.5"></i>團隊成員
          </button>
          <button onClick={exportPDF} className="px-3 py-1.5 bg-white border border-red-100 text-red-600 rounded-md text-xs font-bold hover:bg-red-50">
            <i className="fa-solid fa-file-pdf mr-1.5"></i>PDF
          </button>
          <button onClick={handleSave} className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-bold text-xs shadow-md flex items-center">
            <i className="fa-solid fa-save mr-1.5"></i>儲存 WBS
          </button>
        </div>
      </header>

      {/* Gantt Area */}
      <div id="gantt-export-area" className="flex-1 overflow-hidden bg-[#f8fafc] flex flex-col relative">
         <div className="px-5 py-4 shrink-0 bg-white border-b border-slate-200 z-20">
             <div className="flex gap-4">
                 <div><label className="text-xs font-bold text-slate-500 block mb-1">開始日期</label><input type="date" value={localProject.startDate} onChange={e => setLocalProject({...localProject, startDate: e.target.value})} className="border rounded px-2 py-1 text-sm" /></div>
                 <div><label className="text-xs font-bold text-slate-500 block mb-1">結束日期</label><input type="date" value={localProject.endDate || ''} onChange={e => setLocalProject({...localProject, endDate: e.target.value})} className="border rounded px-2 py-1 text-sm" /></div>
             </div>
         </div>

         {/* View Controls */}
         <div className="px-5 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0 z-20" data-html2canvas-ignore="true">
             <div className="flex bg-white p-1 rounded-lg border border-slate-200 shadow-sm">
                 {(['day', 'week', 'month'] as const).map(mode => (
                     <button key={mode} onClick={() => { setViewMode(mode); setColWidth(mode === 'day' ? 40 : mode === 'week' ? 20 : 10); }} 
                         className={`px-3 py-1 rounded-md text-xs transition-all capitalize ${viewMode === mode ? 'bg-brand-50 text-brand-600 font-bold' : 'text-slate-500'}`}>
                         {mode === 'day' ? '日視圖' : mode === 'week' ? '週視圖' : '月視圖'}
                     </button>
                 ))}
             </div>
             <button onClick={() => openEditModal(null)} className="bg-brand-600 text-white py-1.5 px-4 rounded-md text-xs font-bold shadow-sm flex items-center"><i className="fa-solid fa-plus mr-1.5"></i>新增任務</button>
         </div>

         {/* Gantt Body */}
         <div className="flex-1 flex flex-col overflow-hidden bg-white relative">
             {/* Header */}
             <div className="h-14 bg-slate-50/80 backdrop-blur flex flex-none border-b border-slate-200 z-20">
                 <div className="sticky left-0 z-50 bg-[#f8fafc] border-r border-slate-200 w-[260px] flex-shrink-0 flex items-center pl-4 text-xs font-bold text-slate-600">任務列表 / WBS</div>
                 <div className="flex-1 overflow-x-auto hide-scrollbar min-w-0" ref={timelineHeaderRef}>
                     <div className="flex flex-col h-full bg-white" style={{ width: totalContentWidth }}>
                         <div className="h-7 border-b border-slate-100 flex items-center font-bold text-xs text-slate-500 bg-slate-50">
                             {headerTopRow.map((item, i) => (
                                 <div key={i} className="pl-3 border-r border-slate-200 h-full flex items-center" style={{ width: item.width }}>{item.label}</div>
                             ))}
                         </div>
                         <div className="h-7 flex items-center">
                             {renderDays.map((item) => (
                                 <div key={item.dateStr} className={`h-full border-r border-slate-100 flex justify-center items-center text-[10px] font-bold ${item.isWeekend || item.isHoliday ? 'bg-slate-50 text-slate-400' : 'text-slate-600'}`} style={{ width: colWidth }}>
                                     {item.label}
                                 </div>
                             ))}
                         </div>
                     </div>
                 </div>
             </div>

             {/* Content */}
             <div className="flex-1 overflow-auto custom-scroll relative" ref={ganttBodyRef} onScroll={handleScroll}>
                 <div className="relative min-h-full" style={{ width: 260 + totalContentWidth }}>
                     {/* Grid */}
                     <div className="absolute inset-0 flex pointer-events-none z-0 pl-[260px]">
                         {renderDays.map(d => (
                             <div key={'bg-' + d.dateStr} className={`flex-shrink-0 border-r border-slate-100 h-full ${d.isWeekend || d.isHoliday ? 'bg-slate-50/50' : ''}`} style={{ width: colWidth }}></div>
                         ))}
                     </div>
                     {/* Today Line */}
                     {todayOffset >= 0 && (
                         <div className="absolute top-0 bottom-0 w-[2px] bg-red-500 z-30 pointer-events-none shadow-sm" style={{ left: 260 + todayOffset + (colWidth / 2) }}></div>
                     )}

                     {/* Tasks */}
                     <div className="relative z-10 pt-1 pb-10">
                         {(localProject.wbs || []).map(wbs => (
                             <div key={wbs.id}>
                                 <div className="flex border-y border-slate-200 bg-slate-50/95 sticky left-0 z-40">
                                     <div className="w-[260px] px-5 py-2 flex items-center bg-slate-50 text-[11px] font-bold text-slate-700 border-r border-slate-200">
                                         {wbs.name}
                                     </div>
                                 </div>
                                 {localProject.tasks.filter(t => t.category === wbs.name).map(task => (
                                     <div key={task.id} className="flex h-11 border-b border-slate-100 relative group hover:bg-blue-50/30">
                                         <div onClick={() => openEditModal(task)} className="sticky left-0 z-40 w-[260px] bg-white border-r border-slate-200 px-5 flex items-center cursor-pointer group-hover:bg-blue-50/30">
                                             <div className="flex flex-col truncate w-full">
                                                <div className="flex justify-between">
                                                    <span className="truncate text-[13px] font-semibold text-slate-700">{task.title}</span>
                                                    <span className="text-[10px] text-slate-400">{task.progress}%</span>
                                                </div>
                                                <div className="w-full bg-slate-100 h-1.5 rounded-full mt-1 overflow-hidden">
                                                    <div className="bg-brand-500 h-full" style={{width: `${task.progress}%`}}></div>
                                                </div>
                                             </div>
                                         </div>
                                         {/* Bar */}
                                         <div className="relative h-full pointer-events-none" style={{ width: totalContentWidth }}>
                                             <div 
                                                onMouseDown={(e) => handleMouseDown(task, e)}
                                                className={`absolute h-7 top-2 rounded-md shadow-sm flex items-center px-2 border border-white/20 select-none cursor-grab pointer-events-auto hover:brightness-110 ${draggingState.task?.id === task.id ? 'cursor-grabbing shadow-xl scale-[1.02] z-50' : ''}`}
                                                style={{
                                                    left: getTaskLeft(task),
                                                    width: task.duration * colWidth,
                                                    backgroundColor: getEngineer(task.assignee).color
                                                }}
                                             >
                                                 <span className="text-[10px] text-white font-bold truncate">{getEngineer(task.assignee).name}</span>
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
      
      {/* Edit Task Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
                <h3 className="font-bold text-lg mb-4">{editingTask.id ? '編輯任務' : '新增任務'}</h3>
                <div className="space-y-4">
                    <div><label className="text-xs font-bold text-slate-500 block mb-1">任務名稱</label><input value={editingTask.title} onChange={e=>setEditingTask({...editingTask, title:e.target.value})} className="w-full border rounded px-3 py-2 text-sm" /></div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-bold text-slate-500 block mb-1">WBS 階段</label>
                            <select value={editingTask.category} onChange={e=>setEditingTask({...editingTask, category:e.target.value})} className="w-full border rounded px-3 py-2 text-sm">
                                {localProject.wbs.map(w => <option key={w.id} value={w.name}>{w.name}</option>)}
                            </select>
                        </div>
                        <div>
                             <label className="text-xs font-bold text-slate-500 block mb-1">負責人</label>
                             <select value={editingTask.assignee} onChange={e=>setEditingTask({...editingTask, assignee:e.target.value})} className="w-full border rounded px-3 py-2 text-sm">
                                 {localProject.engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                             </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div><label className="text-xs font-bold text-slate-500 block mb-1">開始日期</label><input type="date" value={editingTask.startDate} onChange={e=>setEditingTask({...editingTask, startDate:e.target.value})} className="w-full border rounded px-3 py-2 text-sm" /></div>
                        <div><label className="text-xs font-bold text-slate-500 block mb-1">工期 (天)</label><input type="number" value={editingTask.duration} onChange={e=>setEditingTask({...editingTask, duration:Number(e.target.value)})} className="w-full border rounded px-3 py-2 text-sm" /></div>
                    </div>
                    <div><label className="text-xs font-bold text-slate-500 block mb-1">進度 ({editingTask.progress}%)</label><input type="range" value={editingTask.progress} onChange={e=>setEditingTask({...editingTask, progress:Number(e.target.value)})} min="0" max="100" className="w-full" /></div>
                </div>
                <div className="mt-6 flex justify-between">
                    {editingTask.id && <button onClick={deleteTask} className="text-red-500 text-xs font-bold">刪除任務</button>}
                    <div className="flex gap-2 ml-auto">
                        <button onClick={()=>setShowEditModal(false)} className="px-4 py-2 text-slate-500 text-sm font-bold">取消</button>
                        <button onClick={saveTask} className="px-4 py-2 bg-brand-600 text-white rounded text-sm font-bold">儲存</button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* Team Modal */}
      {showTeamModal && (
          <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
                <h3 className="font-bold mb-4">團隊成員管理</h3>
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {localProject.engineers.map((eng, idx) => (
                        <div key={eng.id} className="flex items-center gap-2">
                            <input type="color" value={eng.color} onChange={e => { const updated = [...localProject.engineers]; updated[idx].color = e.target.value; setLocalProject({...localProject, engineers: updated}); }} className="w-8 h-8 rounded shrink-0 cursor-pointer" />
                            <input value={eng.name} onChange={e => { const updated = [...localProject.engineers]; updated[idx].name = e.target.value; setLocalProject({...localProject, engineers: updated}); }} className="flex-1 border rounded px-2 py-1 text-sm" />
                            <button onClick={() => { const updated = localProject.engineers.filter((_, i) => i !== idx); setLocalProject({...localProject, engineers: updated}); }} className="text-red-400"><i className="fa-solid fa-trash"></i></button>
                        </div>
                    ))}
                    <button onClick={addEngineer} className="w-full border border-dashed border-slate-300 py-2 text-slate-400 mt-2 text-xs font-bold">+ 新增成員</button>
                </div>
                <div className="mt-4 text-right"><button onClick={()=>setShowTeamModal(false)} className="bg-brand-600 text-white px-4 py-2 rounded text-xs font-bold">完成</button></div>
            </div>
          </div>
      )}
    </div>
  );
};
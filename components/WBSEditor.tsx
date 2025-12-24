
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
    x.setDate(x.getDate() + Number(n)); // Force cast number
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

    // PDF Options Modal
    const [showPdfOptions, setShowPdfOptions] = useState(false);
    const [pdfConfig, setPdfConfig] = useState({
        format: 'a3' as 'a3' | 'a4',
        orientation: 'landscape' as 'landscape' | 'portrait',
        showDateRange: true,
        fitToPage: true,
        extendMonths: 0
    });

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

        // Robust Date End Calculation
        let endCandidates = [validStart];
        if (localProject.endDate) endCandidates.push(localProject.endDate);

        (localProject.tasks || []).forEach(t => {
            if (t.startDate) {
                endCandidates.push(addDays(t.startDate, Number(t.duration || 1)));
            }
        });

        // Sort to find max (String works for ISO YYYY-MM-DD)
        endCandidates.sort();
        const effectiveEndDate = endCandidates[endCandidates.length - 1];

        // Calculate Duration
        let duration = getDaysDiff(validStart, effectiveEndDate) + START_OFFSET + 30; // 30 days buffer

        // Safety Caps
        if (duration > 3650) duration = 3650; // Max 10 years
        if (duration < 30) duration = 30;     // Min 30 days

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
    }, [localProject.startDate, localProject.endDate, localProject.holidays, localProject.tasks]);

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

    const getWBSSummary = (category: string) => {
        const tasks = (localProject.tasks || []).filter(t => t.category === category);
        if (tasks.length === 0) return null;

        // Ensure valid dates
        const validTasks = tasks.filter(t => t.startDate && t.duration > 0);
        if (validTasks.length === 0) return null;


        // Sort tasks by date to behave predictably
        validTasks.sort((a, b) => a.startDate.localeCompare(b.startDate));

        let minStart = validTasks[0].startDate;
        let maxEnd = addDays(validTasks[0].startDate, Number(validTasks[0].duration));
        let totalDuration = 0;
        let weightedProgress = 0;

        validTasks.forEach(t => {
            if (t.startDate < minStart) minStart = t.startDate;
            const duration = Number(t.duration);
            const end = addDays(t.startDate, duration);
            if (end > maxEnd) maxEnd = end;
            totalDuration += duration;
            weightedProgress += duration * t.progress;
        });

        const avgProgress = totalDuration === 0 ? 0 : Math.round(weightedProgress / totalDuration);
        return { start: minStart, end: maxEnd, progress: avgProgress };
    };

    const toggleAllWBS = (collapse: boolean) => {
        const newWbs = (localProject.wbs || []).map(w => ({ ...w, collapsed: collapse }));
        setLocalProject({ ...localProject, wbs: newWbs });
    };

    const exportImage = async () => {
        // @ts-ignore
        if (typeof html2canvas === 'undefined') return alert("圖片匯出元件尚未載入，請檢查網路連線或重新整理頁面。");

        try {
            const el = document.getElementById('gantt-export-area');
            if (!el) return alert("找不到匯出區域");

            alert("正在產生圖片，請稍候... \n\n若您的專案期間非常長 (超過1年)，建議先切換至「月視圖」再匯出，以獲得最佳效果。");

            const clone = el.cloneNode(true) as HTMLElement;
            // Force white background
            clone.style.backgroundColor = '#ffffff';
            clone.classList.add('pdf-visible');

            // Sync Input Values (Date Pickers, etc.)
            // Clone doesn't preserve current input values, so we copy them manually
            const originalInputs = el.querySelectorAll('input, select, textarea');
            const clonedInputs = clone.querySelectorAll('input, select, textarea');
            originalInputs.forEach((input, i) => {
                const val = (input as HTMLInputElement).value;
                if (clonedInputs[i]) {
                    (clonedInputs[i] as HTMLInputElement).value = val;
                    (clonedInputs[i] as HTMLInputElement).setAttribute('value', val); // Force attribute for some renderers
                }
            });

            // Add Project Title for Image
            const titleDiv = document.createElement('div');
            titleDiv.className = 'px-5 py-3 bg-white border-b border-slate-200 font-bold text-lg text-slate-800 flex items-center gap-4';

            let dateRangeHtml = '';
            if (localProject.startDate) {
                dateRangeHtml = `<span class="text-sm text-slate-500 ml-auto font-normal">期間: ${localProject.startDate} ~ ${localProject.endDate || '未定'}</span>`;
            }

            titleDiv.innerHTML = `<span>專案: ${localProject.name}</span> <span class="text-xs text-slate-500 font-mono bg-slate-100 px-2 py-1 rounded">ID: ${localProject.id}</span>${dateRangeHtml}`;
            clone.insertBefore(titleDiv, clone.firstChild);

            // Unroll scrollable areas & Fix Truncation
            const scrollables = clone.querySelectorAll('.overflow-x-auto, .overflow-auto, .overflow-hidden');
            scrollables.forEach((el) => {
                (el as HTMLElement).style.overflow = 'visible';
                // Only unset width for scroll containers, not everything
                if (el.classList.contains('overflow-auto') || el.classList.contains('overflow-x-auto')) {
                    (el as HTMLElement).style.width = 'fit-content';
                    (el as HTMLElement).style.maxWidth = 'none';
                }
            });

            // Remove text truncation and ensure Task List visibility
            const truncated = clone.querySelectorAll('.truncate');
            truncated.forEach(el => {
                el.classList.remove('truncate');
                (el as HTMLElement).style.whiteSpace = 'normal'; // Allow wrapping
                (el as HTMLElement).style.overflow = 'visible';
            });

            // Boost Z-Index for Left Sidebar (Task List)
            const stickyCols = clone.querySelectorAll('.sticky-left-col');
            stickyCols.forEach(el => {
                (el as HTMLElement).style.zIndex = '999'; // Ensure it stays on top
                (el as HTMLElement).style.backgroundColor = '#f8fafc'; // Ensure opacity
            });

            // Allow task bars to show full text even if small
            const taskTextContainers = clone.querySelectorAll('.text-\\[10px\\]');
            taskTextContainers.forEach(el => {
                (el as HTMLElement).style.overflow = 'visible';
                (el as HTMLElement).style.zIndex = '50'; // Ensure text on bars is visible
            });

            // Ensure container width fits content + sidebar
            // We need to calculate the full required width
            // The unrolled content width should be enough.
            clone.style.width = 'fit-content';
            clone.style.minWidth = '1000px';

            // Append to body to render width
            document.body.appendChild(clone);

            // Wait for layout to settle
            await new Promise(resolve => setTimeout(resolve, 800));

            // Calculate dimensions
            const width = clone.scrollWidth;
            const height = clone.scrollHeight;

            // Smart Scale Logic
            // If width is huge (e.g. Day View for 2 years ~30k px), we MUST scale down or browser canvas crash.
            let safeScale = 2;
            if (width > 10000) safeScale = 1.5;
            if (width > 20000) safeScale = 1;
            if (width > 30000) safeScale = 0.8;

            console.log(`Exporting Image: Width=${width}, Height=${height}, Scale=${safeScale}`);

            // @ts-ignore
            html2canvas(clone, {
                scale: safeScale,
                useCORS: true,
                backgroundColor: '#ffffff',
                logging: false,
                windowWidth: width,
                windowHeight: height,
                x: 0,
                y: 0,
                scrollX: 0,
                scrollY: 0,
                onclone: (doc) => {
                    // Extra safety: ensure the cloned body is big enough
                    const body = doc.getElementById('gantt-export-area');
                    if (body) {
                        body.style.width = `${width}px`;
                        body.style.height = `${height}px`;
                    }
                }
            }).then(canvas => {
                const link = document.createElement('a');
                link.download = `${localProject.name}.png`;
                link.href = canvas.toDataURL('image/png');
                link.click();

                if (document.body.contains(clone)) document.body.removeChild(clone);
                setShowPdfOptions(false);
            }).catch(err => {
                console.error("html2canvas Error:", err);
                alert("圖片匯出失敗 (可能圖檔過大)，請重試或縮短期間");
                if (document.body.contains(clone)) document.body.removeChild(clone);
            });

        } catch (e) {
            console.error("Export Error:", e);
            alert(`匯出設定錯誤: ${e.message}`);
        }
    };

    const exportPDF = () => {
        // @ts-ignore
        if (typeof html2pdf === 'undefined') return alert("PDF 元件尚未載入，請檢查網路連線或重新整理頁面。");

        try {
            const el = document.getElementById('gantt-export-area');
            if (!el) {
                alert("找不到匯出區域");
                return;
            }

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

            // Unroll scrollable areas
            const scrollables = clone.querySelectorAll('.overflow-x-auto, .overflow-auto');
            scrollables.forEach((el) => {
                (el as HTMLElement).style.overflow = 'visible';
                (el as HTMLElement).style.width = 'fit-content'; // Ensure full width is rendered
                (el as HTMLElement).style.maxWidth = 'none';
            });

            // Ensure the main container also expands
            clone.style.width = 'fit-content';
            clone.style.minWidth = '1000px'; // Minimum width to prevent crushing

            // --- Pagination Logic ---
            // We'll create a new container and append "Pages" to it
            // Each page contains: Title (Page 1 only?), Timeline Header, and a chunk of Rows
            // NOTE: We need to clone the Grid Background for each page too, or just accept white background?
            // The Grid is inside the Body Wrapper. If we slice the Body, we slice the Grid.

            const headerContainer = clone.querySelector('#gantt-header-container'); // Timeline Header
            const bodyContainer = clone.querySelector('.custom-scroll > div'); // Main relative canvas
            const allRows = Array.from(clone.querySelectorAll('.gantt-row'));

            // Clean the body container in the clone (remove all rows, keep grid?)
            // Actually, we will create new pages.
            // Page Structure:
            // <div class="page">
            //   <TitleDiv (Clone) />
            //   <HeaderContainer (Clone) />
            //   <BodyContainer (Clone with ONLY subset of rows) />
            // </div>

            const pdfContainer = document.createElement('div');
            // A3 Landscape ~ 1122px width. Height ~793px (210mm) for A4 Landscape
            // Let's assume automatic page breaks by html2pdf between these divs.

            const ROWS_PER_PAGE = 18; // Safe number for A3/A4 Landscape with header

            for (let i = 0; i < allRows.length; i += ROWS_PER_PAGE) {
                const pageChunk = document.createElement('div');
                pageChunk.style.position = 'relative';
                // Force page break after this chunk, except for the last one
                if (i + ROWS_PER_PAGE < allRows.length) {
                    pageChunk.style.pageBreakAfter = 'always';
                    pageChunk.style.marginBottom = '20px';
                }

                // 1. Append Title (Only on first page? Or all? User asked for Header. 
                // Usually Project Title is good on all pages for context, or just first.)
                // Let's put Title on ALL pages for clarity if it's multipage.
                const titleClone = titleDiv.cloneNode(true) as HTMLElement;
                pageChunk.appendChild(titleClone);

                // 2. Append Timeline Header
                if (headerContainer) {
                    const headerClone = headerContainer.cloneNode(true) as HTMLElement;
                    headerClone.style.overflow = 'visible'; // Ensure header dates aren't clipped
                    headerClone.style.width = '100%';
                    // Fix header scrolling if needed? It should be fine as we unrolled it.
                    pageChunk.appendChild(headerClone);
                }

                // 3. Append Body Chunk (Grid + Rows)
                if (bodyContainer) {
                    // We clone the body container (which has the GRID).
                    const bodyClone = bodyContainer.cloneNode(true) as HTMLElement;
                    // We need to REMOVE rows that are NOT in this chunk.
                    // But bodyClone is a deep clone, so it has ALL rows.
                    // We need to match rows in bodyClone to allRows indices.
                    // Since querySelectorAll returns in document order, we can re-query instructions.
                    const clonedRows = Array.from(bodyClone.querySelectorAll('.gantt-row'));

                    clonedRows.forEach((row, idx) => {
                        if (idx < i || idx >= i + ROWS_PER_PAGE) {
                            row.remove(); // Remove rows not in this page
                        }
                    });

                    // Adjust height of bodyClone to fit content? 
                    // The grid background is `absolute inset-0 h-full`.
                    // If we remove rows, the container height might collapse or stay huge?
                    // The container is `relative`. Its height is determined by flow of rows.
                    // If rows are removed, height shrinks. Grid shrinks. Perfect.


                    // Ensure bodyClone overflow is visible
                    bodyClone.style.overflow = 'visible';
                    // NOT accessing parentElement here because bodyClone is not attached yet
                    // bodyClone.parentElement!.style.overflow = 'visible'; 


                    // We need to wrap bodyClone in the scroll wrapper style to maintain layout?
                    // `.custom-scroll > div` is the `bodyContainer`.
                    // We just append `bodyClone` to the page.
                    pageChunk.appendChild(bodyClone);
                }

                pdfContainer.appendChild(pageChunk);
            }

            // Replace clone content with paginated content
            clone.innerHTML = '';
            clone.appendChild(pdfContainer);

            // Append to DOM for Rendering
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
            }).catch((err: any) => {
                console.error("PDF Export Error:", err);
                alert("匯出失敗，請查看 Console 錯誤訊息");
                if (document.body.contains(clone)) {
                    document.body.removeChild(clone);
                }
            });
        } catch (e) {
            console.error("PDF Setup Error:", e);
            alert(`匯出設定發生錯誤: ${e.message || JSON.stringify(e)}`);
        }
    };



    const handleAddTask = () => {
        // 預設選中第一個分類，避免使用者未選擇時造成空值
        const defaultCategory = (localProject.wbs && localProject.wbs.length > 0) ? localProject.wbs[0].name : '';
        setEditingTask({
            category: defaultCategory,
            startDate: localProject.startDate || toLocalISOString(),
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
                startDate: finalTask.startDate || toLocalISOString(),
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
                    <button onClick={() => setShowPdfOptions(true)} className="px-2 md:px-3 py-1.5 bg-white border border-red-100 text-red-600 rounded-md text-xs font-bold hover:bg-red-50"><i className="fa-solid fa-file-export md:mr-1.5"></i>匯出</button>
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
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">WBS 階段</label>
                            <div className="flex gap-1">
                                <button onClick={() => setShowWBSModal(true)} className="flex-1 border rounded px-2 py-1 text-xs font-bold bg-slate-50 hover:bg-white text-slate-600 text-left truncate"><i className="fa-solid fa-list-check mr-1.5"></i>編輯</button>
                                <button onClick={() => toggleAllWBS(false)} className="w-8 border rounded flex items-center justify-center bg-white hover:bg-slate-50 text-slate-500" title="全部展開"><i className="fa-solid fa-angles-down"></i></button>
                                <button onClick={() => toggleAllWBS(true)} className="w-8 border rounded flex items-center justify-center bg-white hover:bg-slate-50 text-slate-500" title="全部收合"><i className="fa-solid fa-angles-up"></i></button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Toolbar */}
                <div className="px-2 md:px-5 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0 z-20 overflow-x-auto gap-2">
                    <div className="flex items-center gap-2 md:gap-3 shrink-0">
                        <div className="flex bg-white p-1 rounded-lg border border-slate-200 shadow-sm">
                            {(['day', 'week', 'month'] as const).map(mode => (
                                <button key={mode} onClick={() => { setViewMode(mode); setColWidth(mode === 'day' ? 40 : mode === 'week' ? 20 : 7); }} className={`px-2 py-1 rounded-md text-xs ${viewMode === mode ? 'bg-brand-50 text-brand-600 font-bold' : 'text-slate-500'}`}>{mode === 'day' ? '日視圖' : mode === 'week' ? '週視圖' : '月視圖'}</button>
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
                    <div id="gantt-header-container" className="h-14 bg-slate-50/95 backdrop-blur flex flex-none border-b border-slate-200 z-20">
                        {/* Sticky Header - Z-Index 60 to cover Today Line but under Header */}
                        <div className="sticky-left-header w-[160px] md:w-[260px] flex-shrink-0 border-r border-slate-200 bg-slate-50 flex items-center px-4 font-bold text-xs text-slate-600 uppercase shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] z-[60]">任務列表 / WBS</div>
                        <div className="flex-1 overflow-hidden relative" ref={timelineHeaderRef}>
                            <div className="flex flex-col h-full bg-white" style={{ width: totalContentWidth }}>
                                <div className="h-7 border-b border-slate-100 flex items-center font-bold text-xs text-slate-500 bg-slate-50">
                                    {headerTopRow.map((item, i) => <div key={i} className="pl-3 border-r border-slate-200 h-full flex items-center" style={{ width: item.width }}>{item.label}</div>)}
                                </div>
                                <div className="h-7 flex items-center relative">
                                    {renderDays.map(d => (
                                        <div key={d.dateStr}
                                            className={`h-full border-r border-slate-100 flex justify-center items-center text-[10px] font-bold text-slate-600 cursor-pointer flex-shrink-0 
                                            ${d.isWeekend ? 'bg-orange-200' : ''} 
                                            ${d.isHoliday ? '!bg-red-100 !text-red-600 !border-b-2 !border-red-400' : ''}
                                            ${(viewMode === 'month' && !d.isWeekend && parseLocalDate(d.dateStr).getDay() === 1) ? 'relative z-10' : ''}
                                         `}
                                            style={{ width: colWidth }}
                                            onClick={() => {
                                                const newHolidays = d.isHoliday ? (localProject.holidays || []).filter(h => h !== d.dateStr) : [...(localProject.holidays || []), d.dateStr];
                                                setLocalProject({ ...localProject, holidays: newHolidays });
                                            }}
                                            title={d.isHoliday ? '取消休假' : '設為休假'}
                                        >
                                            {viewMode === 'month' ? (
                                                d.isWeekend ? '' : (parseLocalDate(d.dateStr).getDay() === 1 ? `W${getISOWeek(parseLocalDate(d.dateStr))}` : '')
                                            ) : d.label}
                                        </div>
                                    ))}
                                    {/* Today Line in Header (Triangle Indicator) - No background line to avoid covering date text */}
                                    {todayOffset >= 0 && (
                                        <div className="absolute top-0 bottom-0 z-50 pointer-events-none" style={{ left: todayOffset + (colWidth / 2) }}>
                                            <div className="absolute top-0 left-0 -translate-x-1/2 text-red-500 text-[10px]"><i className="fa-solid fa-caret-down"></i></div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Content */}
                    {/* Content */}
                    <div className="flex-1 overflow-auto custom-scroll relative" ref={ganttBodyRef} onScroll={e => timelineHeaderRef.current && (timelineHeaderRef.current.scrollLeft = (e.target as HTMLElement).scrollLeft)}>
                        <div className="relative" style={{ width: sidebarWidth + totalContentWidth }}>
                            {/* Background Grid */}
                            <div className="absolute inset-0 flex pointer-events-none z-0" style={{ paddingLeft: sidebarWidth }}>
                                {renderDays.map(d => (
                                    <div key={`bg-${d.dateStr}`} className={`flex-shrink-0 border-r border-slate-200 h-full box-border ${d.isWeekend ? 'bg-orange-50' : ''} ${d.isHoliday ? '!bg-red-50' : ''}`} style={{ width: colWidth }}></div>
                                ))}
                            </div>

                            {/* Today Line - Z-Index 30: Above Grid (0) and Static Bars (10), but below Sticky Cols (60) */}
                            {todayOffset >= 0 && (
                                <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-30 pointer-events-none" style={{ left: sidebarWidth + todayOffset + (colWidth / 2) }}>
                                    {/* Caret removed from body to avoid duplication, now in Header */}
                                </div>
                            )}

                            {/* Task Rows */}
                            <div className="relative">
                                {(localProject.wbs || []).map((cat, i) => (
                                    <div key={cat.id}>
                                        {/* Sticky WBS Header - Z-Index 60 only for left label, Timeline part is transparent/z-0 to show Red Line */}
                                        <div className="gantt-row flex h-9 border-t-4 border-double border-slate-300 border-b border-slate-200 group">
                                            {/* Left Sticky Label */}
                                            <div className="sticky left-0 z-[60] bg-slate-50 flex items-center px-4 font-bold text-xs text-slate-700 sticky-left-col border-r border-slate-200 cursor-pointer hover:bg-slate-100"
                                                style={{ width: sidebarWidth }}
                                                onClick={() => {
                                                    const newWbs = localProject.wbs.map(w => w.id === cat.id ? { ...w, collapsed: !w.collapsed } : w);
                                                    setLocalProject({ ...localProject, wbs: newWbs });
                                                }}>
                                                <i className={`fa-solid fa-caret-down mr-2 transition-transform ${cat.collapsed ? '-rotate-90' : ''}`}></i>
                                                {cat.name}
                                            </div>
                                            {/* Right Timeline Part - Transparent click area */}
                                            <div className="flex-1 cursor-pointer hover:bg-slate-50/20 z-10 relative overflow-hidden"
                                                onClick={() => {
                                                    const newWbs = localProject.wbs.map(w => w.id === cat.id ? { ...w, collapsed: !w.collapsed } : w);
                                                    setLocalProject({ ...localProject, wbs: newWbs });
                                                }}>
                                                {/* Show Summary Bar if Collapsed */}
                                                {cat.collapsed && (() => {
                                                    const summary = getWBSSummary(cat.name);
                                                    if (!summary) return null;
                                                    const left = getDaysDiff(renderStart, summary.start) * colWidth;
                                                    const width = getDaysDiff(summary.start, summary.end) * colWidth;
                                                    const isOverdue = summary.progress < 100 && parseLocalDate(summary.end) < new Date();

                                                    return (
                                                        <div className={`absolute h-5 top-2 rounded border flex items-center overflow-hidden
                                                            ${isOverdue ? 'bg-red-50/50 border-red-300' : 'bg-indigo-50/50 border-indigo-200'}
                                                        `}
                                                            style={{ left, width }}
                                                            title={`WBS 摘要: ${summary.progress}% \n期間: ${summary.start} ~ ${summary.end}`}
                                                        >
                                                            <div className={`${isOverdue ? 'bg-red-400' : 'bg-indigo-400'} h-full opacity-60`} style={{ width: `${summary.progress}%` }}></div>
                                                            <span className={`absolute px-2 text-[10px] font-bold whitespace-nowrap ${isOverdue ? 'text-red-700' : 'text-indigo-700'}`}>
                                                                {summary.progress}%
                                                            </span>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </div>

                                        {!cat.collapsed && (localProject.tasks || []).filter(t => t.category === cat.name).map(task => (
                                            <div key={task.id} className="gantt-row flex h-9 border-b border-slate-100 relative group hover:bg-blue-50/20">
                                                {/* Sticky Task Info - Z-Index 60 to cover Today Line (30) */}
                                                <div className="sticky left-0 bg-white z-[60] flex items-center px-4 border-r border-slate-200 sticky-left-col shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] cursor-pointer"
                                                    style={{ width: sidebarWidth }}
                                                    onClick={() => { setEditingTask({ ...task }); setShowEditModal(true); }}>
                                                    <div className="w-full truncate">
                                                        <div className="flex justify-between items-center">
                                                            <span className="text-xs font-medium text-slate-700 truncate">{task.title}</span>
                                                            {task.delayReason && <i className="fa-solid fa-circle-exclamation text-amber-500 text-[10px] ml-1" title={`延遲原因: ${task.delayReason}`}></i>}
                                                        </div>
                                                        <div className="w-full h-3 bg-slate-100 rounded-full mt-0.5 overflow-hidden relative border border-slate-200">
                                                            <div className="h-full bg-brand-500" style={{ width: `${task.progress}%` }}></div>
                                                            <div className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-slate-600 leading-none drop-shadow-sm">{task.progress}%</div>
                                                        </div>
                                                    </div>
                                                </div>
                                                {/* Task Bar */}
                                                <div className="relative h-full flex-1">
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
                        <button onClick={() => setShowReportModal(true)} className="bg-brand-600 hover:bg-brand-700 text-white border border-brand-700 px-3 py-1 rounded text-xs font-bold shadow-sm flex items-center transition-colors">
                            <i className="fa-solid fa-table-list mr-1.5"></i>詳細報表
                        </button>
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

            {/* Labor Detailed Report Modal */}
            {showReportModal && (
                <LaborReportModal
                    project={project}
                    logs={logs}
                    engineers={globalEngineers}
                    onClose={() => setShowReportModal(false)}
                />
            )}

            {/* PDF Export Options Modal */}
            {showPdfOptions && (
                <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
                        <h3 className="font-bold text-lg mb-4 text-slate-800"><i className="fa-solid fa-file-export text-slate-600 mr-2"></i>匯出選項</h3>

                        <div className="mb-6 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                            <h4 className="font-bold text-xs text-blue-700 mb-2">推薦方式：匯出圖片 (PNG)</h4>
                            <p className="text-[10px] text-blue-600 mb-3">若您的專案期間較長 (超過6個月)，建議匯出為圖片，可完整保留所有時程細節且不被截斷。</p>
                            <button onClick={exportImage} className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-bold shadow flex items-center justify-center">
                                <i className="fa-solid fa-image mr-2"></i>下載高解析度 PNG 圖片
                            </button>
                        </div>

                        <div className="border-t border-slate-100 pt-4 space-y-4 mb-6 relative">
                            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white px-2 text-xs text-slate-400">或匯出 PDF</div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 block mb-1">紙張大小</label>
                                <div className="flex gap-2">
                                    <button onClick={() => setPdfConfig({ ...pdfConfig, format: 'a4' })} className={`flex-1 py-2 text-xs font-bold rounded border ${pdfConfig.format === 'a4' ? 'bg-red-50 border-red-500 text-red-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>A4</button>
                                    <button onClick={() => setPdfConfig({ ...pdfConfig, format: 'a3' })} className={`flex-1 py-2 text-xs font-bold rounded border ${pdfConfig.format === 'a3' ? 'bg-red-50 border-red-500 text-red-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>A3 (推薦)</button>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 block mb-1">方向</label>
                                <div className="flex gap-2">
                                    <button onClick={() => setPdfConfig({ ...pdfConfig, orientation: 'portrait' })} className={`flex-1 py-2 text-xs font-bold rounded border ${pdfConfig.orientation === 'portrait' ? 'bg-red-50 border-red-500 text-red-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>直向</button>
                                    <button onClick={() => setPdfConfig({ ...pdfConfig, orientation: 'landscape' })} className={`flex-1 py-2 text-xs font-bold rounded border ${pdfConfig.orientation === 'landscape' ? 'bg-red-50 border-red-500 text-red-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>橫向</button>
                                </div>
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="flex items-center gap-2 cursor-pointer p-2 border border-slate-100 rounded hover:bg-slate-50">
                                    <input type="checkbox" checked={pdfConfig.showDateRange} onChange={e => setPdfConfig({ ...pdfConfig, showDateRange: e.target.checked })} className="accent-red-600" />
                                    <span className="text-sm text-slate-700">在標題顯示專案期間</span>
                                </label>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => setShowPdfOptions(false)} className="flex-1 py-2 bg-slate-100 text-slate-600 rounded text-xs font-bold hover:bg-slate-200">取消</button>
                            <button onClick={exportPDF} className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-bold shadow">
                                <i className="fa-solid fa-file-pdf mr-1"></i>匯出 PDF
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

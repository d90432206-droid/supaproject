
import React, { useState } from 'react';
import { Project, LoginData } from '../types';

interface ProjectListProps {
  projects: Project[];
  loginData: LoginData;
  onSaveProject: (project: Project, isNew: boolean) => void;
  onDeleteProjects: (ids: string[], password: string) => Promise<boolean>;
  onOpenWBS: (project: Project) => void;
}

export const ProjectList: React.FC<ProjectListProps> = ({ projects, loginData, onSaveProject, onDeleteProjects, onOpenWBS }) => {
  const [showModal, setShowModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Partial<Project>>({});
  const [isNew, setIsNew] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  
  // Selection & Deletion States
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');

  const openCreateModal = () => {
    setEditingProject({
      id: '', name: '', client: '', budgetHours: 0, status: 'Active',
      startDate: new Date().toISOString().split('T')[0],
      wbs: [
        { id: 'w1', name: '1.0 需求分析', collapsed: false },
        { id: 'w2', name: '2.0 系統設計', collapsed: false },
        { id: 'w3', name: '3.0 程式開發', collapsed: false },
        { id: 'w4', name: '4.0 測試驗收', collapsed: false }
      ],
      engineers: [], tasks: [], holidays: []
    });
    setIsNew(true);
    setShowModal(true);
  };

  const openEditModal = (p: Project) => {
    setEditingProject({ ...p });
    setIsNew(false);
    setShowModal(true);
  };

  const handleSubmit = () => {
    if (!editingProject.name || !editingProject.id) return alert("請輸入必要資訊");
    onSaveProject(editingProject as Project, isNew);
    setShowModal(false);
  };

  // Selection Logic
  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleAll = (visibleProjects: Project[]) => {
    if (selectedIds.size === visibleProjects.length && visibleProjects.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleProjects.map(p => p.id)));
    }
  };

  const handleDeleteSubmit = async () => {
    if (!confirmPassword) return alert("請輸入管理員密碼");
    const success = await onDeleteProjects(Array.from(selectedIds), confirmPassword);
    if (success) {
      setShowDeleteConfirm(false);
      setConfirmPassword('');
      setSelectedIds(new Set());
    }
  };

  const filteredProjects = projects.filter(p => showClosed ? true : p.status === 'Active');
  const isAdmin = loginData.role === 'Admin';

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 animate-in fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-slate-800">專案總表</h2>
            {selectedIds.size > 0 && isAdmin && (
                <button onClick={() => setShowDeleteConfirm(true)} className="bg-red-50 text-red-600 hover:bg-red-100 px-3 py-1.5 rounded text-xs font-bold border border-red-200 transition-colors animate-in fade-in zoom-in duration-200">
                    <i className="fa-solid fa-trash mr-1.5"></i>刪除 ({selectedIds.size})
                </button>
            )}
        </div>
        <div className="flex items-center gap-4">
            {/* Filter Toggle */}
            <label className="flex items-center cursor-pointer select-none">
                <div className="relative">
                    <input type="checkbox" className="sr-only" checked={showClosed} onChange={() => setShowClosed(!showClosed)} />
                    <div className={`block w-10 h-6 rounded-full transition-colors ${showClosed ? 'bg-brand-500' : 'bg-slate-300'}`}></div>
                    <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${showClosed ? 'transform translate-x-4' : ''}`}></div>
                </div>
                <div className="ml-3 text-sm font-bold text-slate-600">顯示已結案</div>
            </label>

            {isAdmin && (
            <button onClick={openCreateModal} className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-md transition-colors flex items-center">
                <i className="fa-solid fa-plus mr-2"></i><span className="hidden md:inline">建立新專案</span><span className="md:hidden">新增</span>
            </button>
            )}
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b">
            <tr>
              {isAdmin && (
                  <th className="px-6 py-3 w-4">
                      <input 
                        type="checkbox" 
                        checked={filteredProjects.length > 0 && selectedIds.size === filteredProjects.length} 
                        onChange={() => toggleAll(filteredProjects)}
                        className="w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                      />
                  </th>
              )}
              <th className="px-6 py-3">編號 (ID)</th>
              <th className="px-6 py-3">專案名稱</th>
              <th className="px-6 py-3">客戶</th>
              <th className="px-6 py-3">預算</th>
              <th className="px-6 py-3">狀態</th>
              <th className="px-6 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredProjects.map(p => (
              <tr key={p.id} className={`group hover:bg-slate-50 ${selectedIds.has(p.id) ? 'bg-brand-50/30' : ''}`}>
                {isAdmin && (
                    <td className="px-6 py-4">
                        <input 
                            type="checkbox" 
                            checked={selectedIds.has(p.id)}
                            onChange={() => toggleSelection(p.id)}
                            className="w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                        />
                    </td>
                )}
                <td className="px-6 py-4 font-mono text-slate-500">{p.id}</td>
                <td className="px-6 py-4 font-bold text-slate-800">{p.name}</td>
                <td className="px-6 py-4 text-slate-600">{p.client || '-'}</td>
                <td className="px-6 py-4">
                  <span className="font-bold text-slate-700">{p.budgetHours}h</span>
                </td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${p.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {p.status === 'Active' ? '進行中' : '已結案'}
                  </span>
                </td>
                <td className="px-6 py-4 text-right flex justify-end gap-2">
                  {isAdmin && (
                    <button onClick={() => openEditModal(p)} className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-brand-600 hover:border-brand-300 flex items-center justify-center transition-colors">
                      <i className="fa-solid fa-pen"></i>
                    </button>
                  )}
                  <button onClick={() => onOpenWBS(p)} className="text-brand-600 hover:text-brand-800 font-bold text-xs bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded transition-colors border border-brand-200">
                    <i className="fa-solid fa-list-check mr-1"></i> WBS
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-4">
          {filteredProjects.map(p => (
              <div key={p.id} className={`bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col gap-3 relative ${selectedIds.has(p.id) ? 'ring-2 ring-brand-500 bg-brand-50/20' : ''}`}>
                  {isAdmin && (
                      <div className="absolute top-4 right-4">
                          <input 
                            type="checkbox" 
                            checked={selectedIds.has(p.id)}
                            onChange={() => toggleSelection(p.id)}
                            className="w-5 h-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                          />
                      </div>
                  )}
                  <div className="flex justify-between items-start pr-8">
                      <div>
                          <div className="text-xs font-mono text-slate-400 mb-1">{p.id}</div>
                          <h3 className="font-bold text-slate-800 text-lg">{p.name}</h3>
                          <div className="text-sm text-slate-600">{p.client}</div>
                      </div>
                  </div>
                  <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${p.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {p.status === 'Active' ? '進行中' : '已結案'}
                      </span>
                  </div>
                  <div className="flex justify-between items-center border-t border-slate-50 pt-3">
                      <div className="text-sm text-slate-500">
                          預算: <span className="font-bold text-slate-800">{p.budgetHours}h</span>
                      </div>
                      <div className="flex gap-2">
                          {isAdmin && (
                            <button onClick={() => openEditModal(p)} className="w-8 h-8 rounded-full bg-slate-50 text-slate-500 hover:text-brand-600 flex items-center justify-center">
                              <i className="fa-solid fa-pen"></i>
                            </button>
                          )}
                          <button onClick={() => onOpenWBS(p)} className="bg-brand-50 text-brand-700 px-3 py-1.5 rounded text-xs font-bold">
                            WBS
                          </button>
                      </div>
                  </div>
              </div>
          ))}
      </div>

      {/* Project Modal (Create/Edit) */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-slate-800 mb-4">{isNew ? '建立新專案' : '編輯專案設定'}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">專案編號 <span className="text-red-500">*</span></label>
                <input 
                  value={editingProject.id} 
                  onChange={e => setEditingProject({...editingProject, id: e.target.value})}
                  disabled={!isNew}
                  placeholder="例如: P-2025001" 
                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-brand-500 outline-none disabled:bg-slate-100" 
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">專案名稱</label>
                <input 
                  value={editingProject.name} 
                  onChange={e => setEditingProject({...editingProject, name: e.target.value})}
                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none" 
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">客戶名稱</label>
                <input 
                  value={editingProject.client} 
                  onChange={e => setEditingProject({...editingProject, client: e.target.value})}
                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none" 
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">預算總工時 (小時)</label>
                <input 
                  type="number"
                  value={editingProject.budgetHours} 
                  onChange={e => setEditingProject({...editingProject, budgetHours: Number(e.target.value)})}
                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm font-mono font-bold focus:ring-2 focus:ring-brand-500 outline-none" 
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">專案狀態</label>
                <div className="flex gap-4">
                  <label className={`flex items-center gap-2 cursor-pointer border border-slate-200 px-3 py-2 rounded hover:bg-emerald-50 ${editingProject.status === 'Active' ? 'ring-2 ring-emerald-500 bg-emerald-50' : ''}`}>
                    <input type="radio" checked={editingProject.status === 'Active'} onChange={() => setEditingProject({...editingProject, status: 'Active'})} className="accent-emerald-600" />
                    <span className="text-sm font-bold text-emerald-700">進行中</span>
                  </label>
                  <label className={`flex items-center gap-2 cursor-pointer border border-slate-200 px-3 py-2 rounded hover:bg-slate-50 ${editingProject.status === 'Closed' ? 'ring-2 ring-slate-400 bg-slate-50' : ''}`}>
                    <input type="radio" checked={editingProject.status === 'Closed'} onChange={() => setEditingProject({...editingProject, status: 'Closed'})} className="accent-slate-500" />
                    <span className="text-sm font-bold text-slate-600">已結案</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3 pt-4 border-t border-slate-100">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded text-sm font-bold">取消</button>
              <button onClick={handleSubmit} className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded text-sm font-bold shadow-md">
                {isNew ? '立即建立' : '儲存變更'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
          <div className="fixed inset-0 bg-red-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200 border-2 border-red-100">
                  <div className="text-center mb-4">
                      <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3 text-red-600">
                          <i className="fa-solid fa-triangle-exclamation text-xl"></i>
                      </div>
                      <h3 className="text-lg font-bold text-slate-800">確定要刪除專案嗎？</h3>
                      <p className="text-sm text-slate-500 mt-2">
                          您即將刪除 <span className="font-bold text-red-600">{selectedIds.size}</span> 個專案。<br/>
                          此動作<span className="font-bold underline">無法復原</span>，請謹慎操作。
                      </p>
                  </div>
                  
                  <div className="mb-4">
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">請輸入管理員密碼確認</label>
                      <input 
                          type="password" 
                          value={confirmPassword}
                          onChange={e => setConfirmPassword(e.target.value)}
                          placeholder="管理員密碼"
                          className="w-full border border-slate-200 rounded px-3 py-2 text-sm font-mono outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
                      />
                  </div>

                  <div className="flex gap-2">
                      <button onClick={() => { setShowDeleteConfirm(false); setConfirmPassword(''); }} className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-sm font-bold">
                          取消
                      </button>
                      <button onClick={handleDeleteSubmit} className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-bold shadow-md">
                          確認刪除
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

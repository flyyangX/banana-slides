import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ImagePlus, Upload, Pencil, Trash2, Copy, MoveRight, Search } from 'lucide-react';
import { Button, Modal, Textarea, useToast, useConfirm } from '@/components/shared';
import { MaterialGeneratorModal } from '@/components/shared/MaterialGeneratorModal';
import { getImageUrl } from '@/api/client';
import {
  listMaterials,
  uploadMaterial,
  deleteMaterial,
  updateMaterialMeta,
  moveMaterial,
  copyMaterial,
  listProjects,
  type Material,
} from '@/api/endpoints';
import type { Project } from '@/types';
import { normalizeProject } from '@/utils';
import { getProjectTitle } from '@/utils/projectUtils';

type MaterialScope = 'project' | 'global' | 'all';
type ActionType = 'move' | 'copy';

export const ProjectMaterials: React.FC = () => {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const { show, ToastContainer } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const [materials, setMaterials] = useState<Material[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [scope, setScope] = useState<MaterialScope>('project');
  const [search, setSearch] = useState('');
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editNote, setEditNote] = useState('');

  const [actionMaterial, setActionMaterial] = useState<Material | null>(null);
  const [actionType, setActionType] = useState<ActionType | null>(null);
  const [targetProjectId, setTargetProjectId] = useState<string>('none');

  // Multi-select state (bulk operations)
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const getMaterialDisplayName = (m: Material) =>
    (m.display_name && m.display_name.trim()) ||
    (m.name && m.name.trim()) ||
    (m.original_filename && m.original_filename.trim()) ||
    (m.source_filename && m.source_filename.trim()) ||
    m.filename ||
    m.url;

  const loadProjects = useCallback(async () => {
    try {
      const response = await listProjects(100, 0);
      if (response.data?.projects) {
        setProjects(response.data.projects.map(normalizeProject));
        setProjectsLoaded(true);
      }
    } catch (error: any) {
      console.error('加载项目列表失败:', error);
    }
  }, []);

  const loadMaterials = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      let target: string | undefined;
      if (scope === 'project') {
        target = projectId;
      } else if (scope === 'global') {
        target = 'none';
      } else {
        target = undefined;
      }
      const response = await listMaterials(target);
      if (response.data?.materials) {
        setMaterials(response.data.materials);
      }
    } catch (error: any) {
      console.error('加载素材列表失败:', error);
      show({
        message: error?.response?.data?.error?.message || error.message || '加载素材列表失败',
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  }, [projectId, scope, show]);

  useEffect(() => {
    if (!projectsLoaded) {
      loadProjects();
    }
  }, [projectsLoaded, loadProjects]);

  useEffect(() => {
    loadMaterials();
  }, [loadMaterials]);

  const filteredMaterials = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const list = [...materials];
    list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    if (!keyword) return list;
    return list.filter((m) => {
      const haystack = [
        m.display_name,
        m.note,
        m.filename,
        m.name,
        m.original_filename,
        m.source_filename,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }, [materials, search]);

  const currentProjectTitle = useMemo(() => {
    const pid = projectId;
    if (!pid) return '项目素材库';
    const found = projects.find((p) => (p.id || p.project_id) === pid);
    return found ? getProjectTitle(found) : pid;
  }, [projectId, projects]);

  const handleUploadClick = () => {
    uploadInputRef.current?.click();
  };

  const handleUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !projectId) return;
    setIsUploading(true);
    try {
      await Promise.all(files.map((file) => uploadMaterial(file, projectId)));
      show({ message: `已上传 ${files.length} 个素材`, type: 'success' });
      await loadMaterials();
    } catch (error: any) {
      show({ message: error.message || '上传素材失败', type: 'error' });
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleDelete = async (materialId: string) => {
    confirm(
      '确定要删除这个素材吗？此操作不可撤销。',
      async () => {
        try {
          await deleteMaterial(materialId);
          setMaterials((prev) => prev.filter((m) => m.id !== materialId));
          setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(materialId);
            return next;
          });
          show({ message: '素材已删除', type: 'success' });
        } catch (error: any) {
          show({ message: error.message || '删除失败', type: 'error' });
        }
      },
      { title: '删除素材', confirmText: '删除', variant: 'danger' }
    );
  };

  const openEditModal = (material: Material) => {
    setEditingMaterial(material);
    setEditDisplayName(material.display_name || '');
    setEditNote(material.note || '');
  };

  const handleSaveMeta = async () => {
    if (!editingMaterial) return;
    try {
      const response = await updateMaterialMeta(editingMaterial.id, {
        display_name: editDisplayName.trim() || null,
        note: editNote.trim() || null,
      });
      if (response.data?.material) {
        setMaterials((prev) =>
          prev.map((m) => (m.id === editingMaterial.id ? response.data!.material : m))
        );
      }
      show({ message: '已更新素材信息', type: 'success' });
      setEditingMaterial(null);
    } catch (error: any) {
      show({ message: error.message || '更新失败', type: 'error' });
    }
  };

  const openActionModal = (material: Material, type: ActionType) => {
    setActionMaterial(material);
    setActionType(type);
    setTargetProjectId(projectId || 'none');
  };

  const handleConfirmAction = async () => {
    if (!actionMaterial || !actionType) return;
    try {
      if (actionType === 'move') {
        await moveMaterial(actionMaterial.id, targetProjectId);
      } else {
        await copyMaterial(actionMaterial.id, targetProjectId);
      }
      show({ message: actionType === 'move' ? '已移动素材' : '已复制素材', type: 'success' });
      await loadMaterials();
      setActionMaterial(null);
      setActionType(null);
    } catch (error: any) {
      show({ message: error.message || '操作失败', type: 'error' });
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const selectAllFiltered = () => {
    setSelectedIds(new Set(filteredMaterials.map((m) => m.id)));
  };

  const openBulkActionModal = (type: ActionType) => {
    if (selectedIds.size === 0) return;
    // reuse existing modal: keep actionMaterial null to indicate bulk
    setActionMaterial(null);
    setActionType(type);
    setTargetProjectId(projectId || 'none');
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    confirm(
      `确定要删除选中的 ${ids.length} 个素材吗？此操作不可撤销。`,
      async () => {
        try {
          await Promise.all(ids.map((id) => deleteMaterial(id)));
          setMaterials((prev) => prev.filter((m) => !selectedIds.has(m.id)));
          clearSelection();
          show({ message: `已删除 ${ids.length} 个素材`, type: 'success' });
        } catch (error: any) {
          show({ message: error.message || '批量删除失败', type: 'error' });
        }
      },
      { title: '批量删除素材', confirmText: '删除', variant: 'danger' }
    );
  };

  const handleConfirmBulkAction = async () => {
    if (!actionType || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    try {
      if (actionType === 'move') {
        await Promise.all(ids.map((id) => moveMaterial(id, targetProjectId)));
      } else {
        await Promise.all(ids.map((id) => copyMaterial(id, targetProjectId)));
      }
      show({
        message: actionType === 'move' ? `已移动 ${ids.length} 个素材` : `已复制 ${ids.length} 个素材`,
        type: 'success',
      });
      await loadMaterials();
      clearSelection();
      setActionType(null);
    } catch (error: any) {
      show({ message: error.message || '批量操作失败', type: 'error' });
    }
  };

  if (!projectId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-sm text-gray-500">缺少项目ID</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white shadow-sm border-b border-gray-200 px-4 md:px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowLeft size={16} />}
              onClick={() => navigate(-1)}
            >
              返回
            </Button>
            <h1 className="text-base md:text-lg font-semibold text-gray-800">
              {currentProjectTitle} · 素材库
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              accept="image/*"
              onChange={handleUploadChange}
              className="hidden"
            />
            <Button
              variant="secondary"
              size="sm"
              icon={<Upload size={16} />}
              onClick={handleUploadClick}
              disabled={isUploading}
            >
              上传素材
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<ImagePlus size={16} />}
              onClick={() => setIsGeneratorOpen(true)}
            >
              生成素材
            </Button>
            <Button
              variant={isMultiSelect ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => {
                setIsMultiSelect((v) => !v);
                clearSelection();
              }}
            >
              {isMultiSelect ? '退出多选' : '多选'}
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant={scope === 'project' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setScope('project')}
            >
              本项目
            </Button>
            <Button
              variant={scope === 'global' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setScope('global')}
            >
              全局（未归属）
            </Button>
            <Button
              variant={scope === 'all' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setScope('all')}
            >
              全部（含全局）
            </Button>
          </div>
          <div className="relative w-full md:w-72">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索名称/文件名/备注"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-banana-500"
            />
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6">
        {isMultiSelect && (
          <div className="mb-4 bg-white border border-gray-200 rounded-lg p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="text-sm text-gray-700">
              已选择 <span className="font-semibold">{selectedIds.size}</span> 个素材
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={selectAllFiltered}>
                全选（当前列表）
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                清空选择
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<MoveRight size={14} />}
                onClick={() => openBulkActionModal('move')}
                disabled={selectedIds.size === 0}
              >
                批量移动
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Copy size={14} />}
                onClick={() => openBulkActionModal('copy')}
                disabled={selectedIds.size === 0}
              >
                批量复制
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Trash2 size={14} />}
                onClick={handleBulkDelete}
                disabled={selectedIds.size === 0}
              >
                批量删除
              </Button>
            </div>
          </div>
        )}
        {isLoading ? (
          <div className="text-sm text-gray-500">加载中...</div>
        ) : filteredMaterials.length === 0 ? (
          <div className="text-center text-sm text-gray-500 py-12">暂无素材</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredMaterials.map((material) => (
              <div
                key={material.id}
                className={`bg-white border rounded-lg overflow-hidden ${
                  selectedIds.has(material.id) ? 'border-banana-500 ring-2 ring-banana-200' : 'border-gray-200'
                }`}
              >
                <div className="relative aspect-video bg-gray-100">
                  <img
                    src={getImageUrl(material.url)}
                    alt={getMaterialDisplayName(material)}
                    className="w-full h-full object-cover"
                  />
                  {isMultiSelect && (
                    <button
                      type="button"
                      onClick={() => toggleSelect(material.id)}
                      className="absolute top-2 left-2 w-6 h-6 rounded bg-white/90 border border-gray-200 flex items-center justify-center"
                      aria-label="选择素材"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(material.id)}
                        readOnly
                        className="w-4 h-4"
                      />
                    </button>
                  )}
                </div>
                <div className="p-3 space-y-1">
                  <div className="text-sm font-medium text-gray-800 truncate">
                    {getMaterialDisplayName(material)}
                  </div>
                  {material.note && (
                    <div className="text-xs text-gray-500 line-clamp-2">{material.note}</div>
                  )}
                  <div className="pt-2 flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Pencil size={14} />}
                      onClick={() => openEditModal(material)}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<MoveRight size={14} />}
                      onClick={() => openActionModal(material, 'move')}
                      disabled={isMultiSelect}
                    >
                      移动
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Copy size={14} />}
                      onClick={() => openActionModal(material, 'copy')}
                      disabled={isMultiSelect}
                    >
                      复制
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 size={14} />}
                      onClick={() => handleDelete(material.id)}
                      disabled={isMultiSelect}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <Modal
        isOpen={!!editingMaterial}
        onClose={() => setEditingMaterial(null)}
        title="编辑素材信息"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">名称</label>
            <input
              value={editDisplayName}
              onChange={(e) => setEditDisplayName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-banana-500"
              placeholder="可选，留空显示文件名"
            />
          </div>
          <Textarea
            label="备注"
            value={editNote}
            onChange={(e) => setEditNote(e.target.value)}
            rows={3}
            placeholder="可选，描述素材用途"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditingMaterial(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={handleSaveMeta}>
              保存
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!actionType && (!!actionMaterial || selectedIds.size > 0)}
        onClose={() => {
          setActionMaterial(null);
          setActionType(null);
        }}
        title={
          actionType === 'move'
            ? selectedIds.size > 0 && !actionMaterial
              ? '批量移动素材'
              : '移动素材'
            : selectedIds.size > 0 && !actionMaterial
              ? '批量复制素材'
              : '复制素材'
        }
        size="md"
      >
        <div className="space-y-4">
          <div className="text-sm text-gray-600">
            选择目标项目（可选：选择“全局”表示不归属任何项目）
          </div>
          <select
            value={targetProjectId}
            onChange={(e) => setTargetProjectId(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
          >
            <option value="none">全局</option>
            {projects.map((p) => (
              <option key={p.project_id || p.id} value={p.project_id || p.id}>
                {getProjectTitle(p)}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setActionMaterial(null);
                setActionType(null);
              }}
            >
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (actionMaterial) {
                  handleConfirmAction();
                } else {
                  handleConfirmBulkAction();
                }
              }}
            >
              确认
            </Button>
          </div>
        </div>
      </Modal>

      <MaterialGeneratorModal
        projectId={projectId}
        isOpen={isGeneratorOpen}
        onClose={() => {
          setIsGeneratorOpen(false);
          loadMaterials();
        }}
      />
      {ConfirmDialog}
      <ToastContainer />
    </div>
  );
};

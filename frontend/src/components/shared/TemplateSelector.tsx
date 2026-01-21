import React, { useState, useEffect } from 'react';
import { Button, useToast, MaterialSelector, Modal, Textarea } from '@/components/shared';
import { getImageUrl } from '@/api/client';
import { listUserTemplates, uploadUserTemplate, deleteUserTemplate, generateTemplateVariants, getTaskStatus, uploadTemplateVariant, selectTemplateVariant, regenerateTemplateVariant, type UserTemplate } from '@/api/endpoints';
import { materialUrlToFile } from '@/components/shared/MaterialSelector';
import type { Material } from '@/api/endpoints';
import { ImagePlus, X } from 'lucide-react';

const presetTemplates = [
  { id: '1', name: '复古卷轴', preview: '/templates/template_y.png', thumb: '/templates/template_y-thumb.webp' },
  { id: '2', name: '矢量插画', preview: '/templates/template_vector_illustration.png', thumb: '/templates/template_vector_illustration-thumb.webp' },
  { id: '3', name: '拟物玻璃', preview: '/templates/template_glass.png', thumb: '/templates/template_glass-thumb.webp' },
  { id: '4', name: '科技蓝', preview: '/templates/template_b.png', thumb: '/templates/template_b-thumb.webp' },
  { id: '5', name: '简约商务', preview: '/templates/template_s.png', thumb: '/templates/template_s-thumb.webp' },
  { id: '6', name: '学术报告', preview: '/templates/template_academic.jpg', thumb: '/templates/template_academic-thumb.webp' },
];

interface TemplateSelectorProps {
  onSelect: (templateFile: File | null, templateId?: string) => void;
  selectedTemplateId?: string | null;
  selectedPresetTemplateId?: string | null;
  showUpload?: boolean; // 是否显示上传到用户模板库的选项
  projectId?: string | null; // 项目ID，用于素材选择器
  templateVariants?: Record<string, string>;
  templateVariantsHistory?: Record<string, string[]>;
  onTemplatesGenerated?: () => Promise<void> | void;
}

export const TemplateSelector: React.FC<TemplateSelectorProps> = ({
  onSelect,
  selectedTemplateId,
  selectedPresetTemplateId,
  showUpload = true,
  projectId,
  templateVariants = {},
  templateVariantsHistory = {},
  onTemplatesGenerated,
}) => {
  const templateVariantsTaskKey = 'templateVariantsTask';
  const templateVariantRegenerateTaskKey = 'templateVariantRegenerateTask';
  const [userTemplates, setUserTemplates] = useState<UserTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [isMaterialSelectorOpen, setIsMaterialSelectorOpen] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [saveToLibrary, setSaveToLibrary] = useState(true); // 上传模板时是否保存到模板库（默认勾选）
  const [selectedVariantTypes, setSelectedVariantTypes] = useState<string[]>([
    'cover',
    'content',
    'transition',
    'ending',
  ]);
  const [isGeneratingVariants, setIsGeneratingVariants] = useState(false);
  const [isVariantModalOpen, setIsVariantModalOpen] = useState(false);
  const [previewVariantType, setPreviewVariantType] = useState<'cover' | 'content' | 'transition' | 'ending' | null>(null);
  const [variantExtraPrompt, setVariantExtraPrompt] = useState('');
  const [variantRefImageUrls, setVariantRefImageUrls] = useState<string[]>([]);
  const [variantUploadedFiles, setVariantUploadedFiles] = useState<File[]>([]);
  const [isVariantMaterialSelectorOpen, setIsVariantMaterialSelectorOpen] = useState(false);
  const [isVariantRegenerating, setIsVariantRegenerating] = useState(false);
  const [isVariantUploading, setIsVariantUploading] = useState(false);
  const [variantsExtraPrompt, setVariantsExtraPrompt] = useState('');
  const [isVariantSelecting, setIsVariantSelecting] = useState(false);
  const [variantGenerateStartedAt, setVariantGenerateStartedAt] = useState<number | null>(null);
  const [variantRegenerateStartedAt, setVariantRegenerateStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const { show, ToastContainer } = useToast();

  const readStoredTask = (key: string) => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { taskId?: string; startedAt?: number; projectId?: string | null };
      if (!parsed?.taskId || typeof parsed.startedAt !== 'number') return null;
      return parsed;
    } catch (error) {
      console.warn('[TemplateSelector] 读取生成任务失败:', error);
      return null;
    }
  };

  const writeStoredTask = (key: string, value: { taskId: string; startedAt: number; projectId?: string | null }) => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn('[TemplateSelector] 写入生成任务失败:', error);
    }
  };

  const clearStoredTask = (key: string) => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.removeItem(key);
    } catch (error) {
      console.warn('[TemplateSelector] 清除生成任务失败:', error);
    }
  };

  // 加载用户模板列表
  useEffect(() => {
    loadUserTemplates();
  }, []);

  useEffect(() => {
    if (!projectId) return;
    const storedVariantsTask = readStoredTask(templateVariantsTaskKey);
    if (storedVariantsTask?.projectId === projectId && storedVariantsTask.taskId) {
      setIsGeneratingVariants(true);
      setVariantGenerateStartedAt(storedVariantsTask.startedAt || Date.now());
      pollTemplateTask(storedVariantsTask.taskId);
    } else if (storedVariantsTask?.projectId) {
      clearStoredTask(templateVariantsTaskKey);
    }

    const storedRegenerateTask = readStoredTask(templateVariantRegenerateTaskKey);
    if (storedRegenerateTask?.projectId === projectId && storedRegenerateTask.taskId) {
      setIsVariantRegenerating(true);
      setVariantRegenerateStartedAt(storedRegenerateTask.startedAt || Date.now());
      pollVariantTask(storedRegenerateTask.taskId);
    } else if (storedRegenerateTask?.projectId) {
      clearStoredTask(templateVariantRegenerateTaskKey);
    }
  }, [projectId]);

  useEffect(() => {
    if (!isGeneratingVariants && !isVariantRegenerating) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [isGeneratingVariants, isVariantRegenerating]);

  const formatElapsed = (seconds: number) => {
    const safeSeconds = Math.max(0, seconds);
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const secs = safeSeconds % 60;
    if (hours > 0) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const variantGenerateElapsed = variantGenerateStartedAt
    ? Math.floor((now - variantGenerateStartedAt) / 1000)
    : 0;
  const variantRegenerateElapsed = variantRegenerateStartedAt
    ? Math.floor((now - variantRegenerateStartedAt) / 1000)
    : 0;
  const currentVariantUrl = previewVariantType ? templateVariants?.[previewVariantType] : undefined;
  const variantHistoryList = previewVariantType ? (templateVariantsHistory?.[previewVariantType] || []) : [];

  const loadUserTemplates = async () => {
    setIsLoadingTemplates(true);
    try {
      const response = await listUserTemplates();
      if (response.data?.templates) {
        setUserTemplates(response.data.templates);
      }
    } catch (error: any) {
      console.error('加载用户模板失败:', error);
    } finally {
      setIsLoadingTemplates(false);
    }
  };

  const handleTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        if (showUpload) {
          // 主页模式：直接上传到用户模板库
          const response = await uploadUserTemplate(file);
          if (response.data) {
            const template = response.data;
            setUserTemplates(prev => [template, ...prev]);
            onSelect(null, template.template_id);
            show({ message: '模板上传成功', type: 'success' });
          }
        } else {
          // 预览页模式：根据 saveToLibrary 状态决定是否保存到模板库
          if (saveToLibrary) {
            // 保存到模板库并应用
            const response = await uploadUserTemplate(file);
            if (response.data) {
              const template = response.data;
              setUserTemplates(prev => [template, ...prev]);
              onSelect(file, template.template_id);
              show({ message: '模板已保存到模板库', type: 'success' });
            }
          } else {
            // 仅应用到项目
            onSelect(file);
          }
        }
      } catch (error: any) {
        console.error('上传模板失败:', error);
        show({ message: '模板上传失败: ' + (error.message || '未知错误'), type: 'error' });
      }
    }
    // 清空 input，允许重复选择同一文件
    e.target.value = '';
  };

  const handleSelectUserTemplate = (template: UserTemplate) => {
    // 立即更新选择状态（不加载File，提升响应速度）
    onSelect(null, template.template_id);
  };

  const handleSelectPresetTemplate = (templateId: string, preview: string) => {
    if (!preview) return;
    // 立即更新选择状态（不加载File，提升响应速度）
    onSelect(null, templateId);
  };

  const handleSelectMaterials = async (materials: Material[], saveAsTemplate?: boolean) => {
    if (materials.length === 0) return;
    
    try {
      // 将第一个素材转换为File对象
      const file = await materialUrlToFile(materials[0]);
      
      // 根据 saveAsTemplate 参数决定是否保存到模板库
      if (saveAsTemplate) {
        // 保存到用户模板库
        const response = await uploadUserTemplate(file);
        if (response.data) {
          const template = response.data;
          setUserTemplates(prev => [template, ...prev]);
          // 传递文件和模板ID，适配不同的使用场景
          onSelect(file, template.template_id);
          show({ message: '素材已保存到模板库', type: 'success' });
        }
      } else {
        // 仅作为模板使用
        onSelect(file);
        show({ message: '已从素材库选择作为模板', type: 'success' });
      }
    } catch (error: any) {
      console.error('加载素材失败:', error);
      show({ message: '加载素材失败: ' + (error.message || '未知错误'), type: 'error' });
    }
  };

  const handleDeleteUserTemplate = async (template: UserTemplate, e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedTemplateId === template.template_id) {
      show({ message: '当前使用中的模板不能删除，请先取消选择或切换', type: 'info' });
      return;
    }
    setDeletingTemplateId(template.template_id);
    try {
      await deleteUserTemplate(template.template_id);
      setUserTemplates((prev) => prev.filter((t) => t.template_id !== template.template_id));
      show({ message: '模板已删除', type: 'success' });
    } catch (error: any) {
      console.error('删除模板失败:', error);
      show({ message: '删除模板失败: ' + (error.message || '未知错误'), type: 'error' });
    } finally {
      setDeletingTemplateId(null);
    }
  };

  const toggleVariantType = (type: string) => {
    setSelectedVariantTypes((prev) =>
      prev.includes(type) ? prev.filter((item) => item !== type) : [...prev, type]
    );
  };

  const pollTemplateTask = async (taskId: string) => {
    if (!projectId) return;
    try {
      const response = await getTaskStatus(projectId, taskId);
      const task = response.data;
      if (!task) return;

      if (task.status === 'COMPLETED' || task.status === 'PARTIAL') {
        setIsGeneratingVariants(false);
        setVariantGenerateStartedAt(null);
        clearStoredTask(templateVariantsTaskKey);
        if (onTemplatesGenerated) {
          await onTemplatesGenerated();
        }
        show({ message: '模板套装生成完成', type: 'success' });
        return;
      }
      if (task.status === 'FAILED') {
        setIsGeneratingVariants(false);
        setVariantGenerateStartedAt(null);
        clearStoredTask(templateVariantsTaskKey);
        show({ message: task.error_message || '模板套装生成失败', type: 'error' });
        return;
      }
      setTimeout(() => pollTemplateTask(taskId), 1500);
    } catch (error: any) {
      setIsGeneratingVariants(false);
      setVariantGenerateStartedAt(null);
      clearStoredTask(templateVariantsTaskKey);
      show({ message: error.message || '模板套装生成失败', type: 'error' });
    }
  };

  const handleGenerateVariants = async () => {
    if (!projectId) return;
    if (selectedVariantTypes.length === 0) {
      show({ message: '请至少选择一种模板类型', type: 'info' });
      return;
    }
    setIsGeneratingVariants(true);
    setVariantGenerateStartedAt(Date.now());
    try {
      const response = await generateTemplateVariants(projectId, selectedVariantTypes, {
        extraRequirements: variantsExtraPrompt,
      });
      if (response.data?.task_id) {
        writeStoredTask(templateVariantsTaskKey, {
          taskId: response.data.task_id,
          startedAt: Date.now(),
          projectId,
        });
        pollTemplateTask(response.data.task_id);
      } else {
        setIsGeneratingVariants(false);
        setVariantGenerateStartedAt(null);
        clearStoredTask(templateVariantsTaskKey);
        show({ message: '模板套装任务创建失败', type: 'error' });
      }
    } catch (error: any) {
      setIsGeneratingVariants(false);
      setVariantGenerateStartedAt(null);
      clearStoredTask(templateVariantsTaskKey);
      show({ message: error.message || '模板套装生成失败', type: 'error' });
    }
  };

  const openVariantModal = (variantType: 'cover' | 'content' | 'transition' | 'ending') => {
    setPreviewVariantType(variantType);
    setVariantExtraPrompt('');
    setVariantRefImageUrls([]);
    setVariantUploadedFiles([]);
    setIsVariantModalOpen(true);
  };

  const handleVariantUpload = async (file: File) => {
    if (!projectId || !previewVariantType) return;
    setIsVariantUploading(true);
    try {
      await uploadTemplateVariant(projectId, previewVariantType, file);
      show({ message: '模板已替换', type: 'success' });
      if (onTemplatesGenerated) {
        await onTemplatesGenerated();
      }
    } catch (error: any) {
      show({ message: error.message || '替换失败', type: 'error' });
    } finally {
      setIsVariantUploading(false);
    }
  };

  const handleSelectVariantHistory = async (variantUrl: string) => {
    if (!projectId || !previewVariantType || !variantUrl) return;
    setIsVariantSelecting(true);
    try {
      await selectTemplateVariant(projectId, previewVariantType, variantUrl);
      show({ message: '已切换到历史版本', type: 'success' });
      if (onTemplatesGenerated) {
        await onTemplatesGenerated();
      }
    } catch (error: any) {
      show({ message: error.message || '切换失败', type: 'error' });
    } finally {
      setIsVariantSelecting(false);
    }
  };

  const handleVariantFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleVariantUpload(file);
    }
    e.target.value = '';
  };

  const handleVariantAddFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setVariantUploadedFiles((prev) => [...prev, ...files]);
    e.target.value = '';
  };

  const removeVariantFile = (index: number) => {
    setVariantUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const removeVariantUrl = (index: number) => {
    setVariantRefImageUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const pollVariantTask = async (taskId: string) => {
    if (!projectId) return;
    try {
      const response = await getTaskStatus(projectId, taskId);
      const task = response.data;
      if (!task) return;

      if (task.status === 'COMPLETED') {
        setIsVariantRegenerating(false);
        setVariantRegenerateStartedAt(null);
        clearStoredTask(templateVariantRegenerateTaskKey);
        show({ message: '模板单图生成完成', type: 'success' });
        if (onTemplatesGenerated) {
          await onTemplatesGenerated();
        }
        return;
      }
      if (task.status === 'FAILED') {
        setIsVariantRegenerating(false);
        setVariantRegenerateStartedAt(null);
        clearStoredTask(templateVariantRegenerateTaskKey);
        show({ message: task.error_message || '模板单图生成失败', type: 'error' });
        return;
      }
      setTimeout(() => pollVariantTask(taskId), 1500);
    } catch (error: any) {
      setIsVariantRegenerating(false);
      setVariantRegenerateStartedAt(null);
      clearStoredTask(templateVariantRegenerateTaskKey);
      show({ message: error.message || '模板单图生成失败', type: 'error' });
    }
  };

  const handleVariantRegenerate = async () => {
    if (!projectId || !previewVariantType) return;
    setIsVariantRegenerating(true);
    setVariantRegenerateStartedAt(Date.now());
    try {
      const response = await regenerateTemplateVariant(projectId, previewVariantType, {
        extraRequirements: variantExtraPrompt,
        refImageUrls: variantRefImageUrls,
        uploadedFiles: variantUploadedFiles,
      });
      if (response.data?.task_id) {
        writeStoredTask(templateVariantRegenerateTaskKey, {
          taskId: response.data.task_id,
          startedAt: Date.now(),
          projectId,
        });
        pollVariantTask(response.data.task_id);
      } else {
        setIsVariantRegenerating(false);
        setVariantRegenerateStartedAt(null);
        clearStoredTask(templateVariantRegenerateTaskKey);
        show({ message: '任务创建失败', type: 'error' });
      }
    } catch (error: any) {
      setIsVariantRegenerating(false);
      setVariantRegenerateStartedAt(null);
      clearStoredTask(templateVariantRegenerateTaskKey);
      show({ message: error.message || '模板单图生成失败', type: 'error' });
    }
  };

  return (
    <>
      <div className="space-y-4">
        {/* 用户已保存的模板 */}
        {userTemplates.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">我的模板</h4>
            <div className="grid grid-cols-4 gap-4 mb-4">
              {userTemplates.map((template) => (
                <div
                  key={template.template_id}
                  onClick={() => handleSelectUserTemplate(template)}
                  className={`aspect-[4/3] rounded-lg border-2 cursor-pointer transition-all relative group ${
                    selectedTemplateId === template.template_id
                      ? 'border-banana-500 ring-2 ring-banana-200'
                      : 'border-gray-200 hover:border-banana-300'
                  }`}
                >
                  <img
                    src={getImageUrl(template.thumb_url || template.template_image_url)}
                    alt={template.name || 'Template'}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  {/* 删除按钮：仅用户模板，且未被选中时显示（常显） */}
                  {selectedTemplateId !== template.template_id && (
                    <button
                      type="button"
                      onClick={(e) => handleDeleteUserTemplate(template, e)}
                      disabled={deletingTemplateId === template.template_id}
                      className={`absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow z-20 opacity-0 group-hover:opacity-100 transition-opacity ${
                        deletingTemplateId === template.template_id ? 'opacity-60 cursor-not-allowed' : ''
                      }`}
                      aria-label="删除模板"
                    >
                      <X size={12} />
                    </button>
                  )}
                  {selectedTemplateId === template.template_id && (
                    <div className="absolute inset-0 bg-banana-500 bg-opacity-20 flex items-center justify-center pointer-events-none">
                      <span className="text-white font-semibold text-sm">已选择</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">预设模板</h4>
          <div className="grid grid-cols-4 gap-4">
            {/* 预设模板 */}
            {presetTemplates.map((template) => (
              <div
                key={template.id}
                onClick={() => template.preview && handleSelectPresetTemplate(template.id, template.preview)}
                className={`aspect-[4/3] rounded-lg border-2 cursor-pointer transition-all bg-gray-100 flex items-center justify-center relative ${
                  selectedPresetTemplateId === template.id
                    ? 'border-banana-500 ring-2 ring-banana-200'
                    : 'border-gray-200 hover:border-banana-500'
                }`}
              >
                {template.preview ? (
                  <>
                    <img
                      src={template.thumb || template.preview}
                      alt={template.name}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    {selectedPresetTemplateId === template.id && (
                      <div className="absolute inset-0 bg-banana-500 bg-opacity-20 flex items-center justify-center pointer-events-none">
                        <span className="text-white font-semibold text-sm">已选择</span>
                      </div>
                    )}
                  </>
                ) : (
                  <span className="text-sm text-gray-500">{template.name}</span>
                )}
              </div>
            ))}

            {/* 上传新模板 */}
            <label className="aspect-[4/3] rounded-lg border-2 border-dashed border-gray-300 hover:border-banana-500 cursor-pointer transition-all flex flex-col items-center justify-center gap-2 relative overflow-hidden">
              <span className="text-2xl">+</span>
              <span className="text-sm text-gray-500">上传模板</span>
              <input
                type="file"
                accept="image/*"
                onChange={handleTemplateUpload}
                className="hidden"
                disabled={isLoadingTemplates}
              />
            </label>
          </div>
          
          {/* 在预览页显示：上传模板时是否保存到模板库的选项 */}
          {!showUpload && (
            <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveToLibrary}
                  onChange={(e) => setSaveToLibrary(e.target.checked)}
                  className="w-4 h-4 text-banana-500 border-gray-300 rounded focus:ring-banana-500"
                />
                <span className="text-sm text-gray-700">
                  上传模板时同时保存到我的模板库
                </span>
              </label>
            </div>
          )}
        </div>

        {/* 模板套装生成 */}
        {projectId && (
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">生成模板套装</h4>
            <p className="text-xs text-gray-500 mb-3">
              选择要生成的模板类型。生成会覆盖已存在的同类型模板。
            </p>
            <div className="flex flex-wrap gap-3 mb-3 text-sm">
              {[
                { key: 'cover', label: '封面' },
                { key: 'content', label: '内容' },
                { key: 'transition', label: '过渡' },
                { key: 'ending', label: '结尾' },
              ].map((item) => (
                <label key={item.key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedVariantTypes.includes(item.key)}
                    onChange={() => toggleVariantType(item.key)}
                  />
                  {item.label}
                </label>
              ))}
            </div>
            <Textarea
              label="套装额外提示词（可选）"
              placeholder="例如：整体更简洁、留白更多、装饰更少..."
              value={variantsExtraPrompt}
              onChange={(e) => setVariantsExtraPrompt(e.target.value)}
              rows={3}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={handleGenerateVariants}
              disabled={isGeneratingVariants}
            >
              {isGeneratingVariants ? `生成中... (${formatElapsed(variantGenerateElapsed)})` : '生成模板套装'}
            </Button>

            <div className="mt-4">
              <h5 className="text-xs text-gray-500 mb-2">模板预览</h5>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { key: 'cover', label: '封面' },
                  { key: 'content', label: '内容' },
                  { key: 'transition', label: '过渡' },
                  { key: 'ending', label: '结尾' },
                ].map((item) => {
                  const url = templateVariants?.[item.key];
                  return (
                    <button
                      type="button"
                      key={item.key}
                      onClick={() => openVariantModal(item.key as 'cover' | 'content' | 'transition' | 'ending')}
                      className="aspect-[4/3] rounded border border-gray-200 bg-gray-50 relative overflow-hidden text-left"
                    >
                      {url ? (
                        <img
                          src={getImageUrl(url)}
                          alt={`${item.label}模板`}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
                          未生成
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 bg-black/40 text-white text-xs px-2 py-1">
                        {item.label}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* 从素材库选择作为模板 */}
        {projectId && (
          <div className="mt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">从素材库选择</h4>
            <Button
              variant="secondary"
              size="sm"
              icon={<ImagePlus size={16} />}
              onClick={() => setIsMaterialSelectorOpen(true)}
              className="w-full"
            >
              从素材库选择作为模板
            </Button>
          </div>
        )}
      </div>
      <ToastContainer />
      {/* 素材选择器 */}
      {projectId && (
        <MaterialSelector
          projectId={projectId}
          isOpen={isMaterialSelectorOpen}
          onClose={() => setIsMaterialSelectorOpen(false)}
          onSelect={handleSelectMaterials}
          multiple={false}
          showSaveAsTemplateOption={true}
        />
      )}

      {projectId && (
        <MaterialSelector
          projectId={projectId}
          isOpen={isVariantMaterialSelectorOpen}
          onClose={() => setIsVariantMaterialSelectorOpen(false)}
          onSelect={(materials) => {
            const urls = materials.map((m) => m.url).filter(Boolean);
            setVariantRefImageUrls((prev) => {
              const merged = [...prev];
              urls.forEach((u) => {
                if (u && !merged.includes(u)) merged.push(u);
              });
              return merged;
            });
          }}
          multiple={true}
          maxSelection={8}
        />
      )}

      <Modal
        isOpen={isVariantModalOpen}
        onClose={() => setIsVariantModalOpen(false)}
        title="模板单图"
        size="lg"
      >
        <div className="space-y-4">
          <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
            {previewVariantType && templateVariants?.[previewVariantType] ? (
              <img
                src={getImageUrl(templateVariants[previewVariantType])}
                alt={previewVariantType}
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-sm text-gray-400">
                暂无模板图
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-700">上传自定义图片替换</div>
            <label className="inline-flex">
              <input
                type="file"
                accept="image/*"
                onChange={handleVariantFileChange}
                className="hidden"
                disabled={isVariantUploading}
              />
              <span className="inline-flex items-center justify-center px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50 cursor-pointer">
                {isVariantUploading ? '上传中...' : '上传替换'}
              </span>
            </label>
          </div>

          <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-700">历史版本</div>
              <div className="text-xs text-gray-500">点击切换</div>
            </div>
            {variantHistoryList.length > 0 ? (
              <div className="grid grid-cols-4 gap-2">
                {variantHistoryList.map((url, idx) => {
                  const isActive = !!currentVariantUrl && url === currentVariantUrl;
                  return (
                    <button
                      key={`${url}-${idx}`}
                      type="button"
                      onClick={() => handleSelectVariantHistory(url)}
                      disabled={isVariantSelecting}
                      className={`aspect-[4/3] rounded border overflow-hidden relative ${
                        isActive ? 'border-banana-500 ring-2 ring-banana-200' : 'border-gray-200'
                      }`}
                    >
                      <img
                        src={getImageUrl(url)}
                        alt="历史版本"
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                      {isActive && (
                        <div className="absolute inset-0 bg-banana-500/20 flex items-center justify-center text-xs text-white">
                          当前
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-gray-500">暂无历史版本</div>
            )}
          </div>

          <Textarea
            label="单图额外提示词（可选）"
            placeholder="例如：更简洁、留白更多、装饰元素更少..."
            value={variantExtraPrompt}
            onChange={(e) => setVariantExtraPrompt(e.target.value)}
            rows={3}
          />

          <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-700">参考图（可选）</div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsVariantMaterialSelectorOpen(true)}
                >
                  从素材库选择
                </Button>
                <label className="inline-flex">
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    className="hidden"
                    onChange={handleVariantAddFiles}
                  />
                  <span className="inline-flex items-center justify-center px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50 cursor-pointer">
                    上传参考图
                  </span>
                </label>
              </div>
            </div>

            {(variantRefImageUrls.length > 0 || variantUploadedFiles.length > 0) ? (
              <div className="space-y-2">
                {variantRefImageUrls.map((u, idx) => (
                  <div key={`${u}-${idx}`} className="flex items-center justify-between text-xs bg-white border border-gray-200 rounded-lg px-3 py-2">
                    <div className="truncate pr-2">{u}</div>
                    <button
                      className="text-gray-500 hover:text-red-600"
                      onClick={() => removeVariantUrl(idx)}
                      type="button"
                    >
                      删除
                    </button>
                  </div>
                ))}
                {variantUploadedFiles.map((f, idx) => (
                  <div key={`${f.name}-${idx}`} className="flex items-center justify-between text-xs bg-white border border-gray-200 rounded-lg px-3 py-2">
                    <div className="truncate pr-2">{f.name}</div>
                    <button
                      className="text-gray-500 hover:text-red-600"
                      onClick={() => removeVariantFile(idx)}
                      type="button"
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-gray-500">不选择也可以直接重新生成</div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setIsVariantModalOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={handleVariantRegenerate} disabled={isVariantRegenerating}>
              {isVariantRegenerating ? `生成中... (${formatElapsed(variantRegenerateElapsed)})` : 'AI 重新生成'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};

/**
 * 根据模板ID获取模板File对象（按需加载）
 * @param templateId 模板ID
 * @param userTemplates 用户模板列表
 * @returns Promise<File | null>
 */
export const getTemplateFile = async (
  templateId: string,
  userTemplates: UserTemplate[]
): Promise<File | null> => {
  // 检查是否是预设模板
  const presetTemplate = presetTemplates.find(t => t.id === templateId);
  if (presetTemplate && presetTemplate.preview) {
    try {
      const response = await fetch(presetTemplate.preview);
      const blob = await response.blob();
      return new File([blob], presetTemplate.preview.split('/').pop() || 'template.png', { type: blob.type });
    } catch (error) {
      console.error('加载预设模板失败:', error);
      return null;
    }
  }

  // 检查是否是用户模板
  const userTemplate = userTemplates.find(t => t.template_id === templateId);
  if (userTemplate) {
    try {
      const imageUrl = getImageUrl(userTemplate.template_image_url);
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      return new File([blob], 'template.png', { type: blob.type });
    } catch (error) {
      console.error('加载用户模板失败:', error);
      return null;
    }
  }

  return null;
};


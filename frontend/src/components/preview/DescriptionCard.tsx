import React, { useState } from 'react';
import { Edit2, FileText, ImagePlus, RefreshCw } from 'lucide-react';
import { Card, ContextualStatusBadge, Button, Modal, Textarea, Skeleton, Markdown, MaterialSelector, useToast } from '@/components/shared';
import { useDescriptionGeneratingState } from '@/hooks/useGeneratingState';
import type { Page, PageType, DescriptionContent } from '@/types';
import type { Material } from '@/api/endpoints';

export interface DescriptionCardProps {
  page: Page;
  index: number;
  totalPages: number;
  projectId?: string | null;
  onUpdate: (data: Partial<Page>) => void;
  onRegenerate: () => void;
  isGenerating?: boolean;
  isAiRefining?: boolean;
}

export const DescriptionCard: React.FC<DescriptionCardProps> = ({
  page,
  index,
  totalPages,
  projectId,
  onUpdate,
  onRegenerate,
  isGenerating = false,
  isAiRefining = false,
}) => {
  const { show } = useToast();
  const MATERIAL_SECTION_TITLE = '其他页面素材：';

  // 从 description_content 提取文本内容
  const getDescriptionText = (descContent: DescriptionContent | undefined): string => {
    if (!descContent) return '';
    if ('text' in descContent) {
      return descContent.text;
    } else if ('text_content' in descContent && Array.isArray(descContent.text_content)) {
      return descContent.text_content.join('\n');
    }
    return '';
  };

  const text = getDescriptionText(page.description_content);
  
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isMaterialSelectorOpen, setIsMaterialSelectorOpen] = useState(false);
  
  // 使用专门的描述生成状态 hook，不受图片生成状态影响
  const generating = useDescriptionGeneratingState(isGenerating, isAiRefining);

  const handleEdit = () => {
    // 在打开编辑对话框时，从当前的 page 获取最新值
    const currentText = getDescriptionText(page.description_content);
    setEditContent(currentText);
    setIsEditing(true);
  };

  const handleSave = () => {
    // 保存时使用 text 格式（后端期望的格式）
    onUpdate({
      description_content: {
        text: editContent,
      } as DescriptionContent,
    });
    setIsEditing(false);
  };

  const pageTypeLabels: Record<PageType, string> = {
    auto: '自动',
    cover: '封面',
    content: '内容',
    transition: '过渡',
    ending: '结尾',
  };

  const inferPageType = () => {
    const title = page.outline_content?.title || '';
    const titleLower = title.toLowerCase();
    const transitionKeywords = ['过渡', '章节', '部分', '目录', '篇章', 'section', 'part', 'agenda', 'outline', 'overview'];
    const endingKeywords = ['结尾', '总结', '致谢', '谢谢', 'ending', 'summary', 'thanks', 'q&a', 'qa', '结论', '回顾'];

    if (index === 0) {
      return { type: 'cover' as PageType, reason: '第 1 页默认封面' };
    }
    if (totalPages > 0 && index === totalPages - 1) {
      return { type: 'ending' as PageType, reason: '最后一页默认结尾' };
    }
    if (transitionKeywords.some((keyword) => titleLower.includes(keyword))) {
      return { type: 'transition' as PageType, reason: `标题包含关键词：${title}` };
    }
    if (endingKeywords.some((keyword) => titleLower.includes(keyword))) {
      return { type: 'ending' as PageType, reason: `标题包含关键词：${title}` };
    }
    return { type: 'content' as PageType, reason: '默认内容页' };
  };

  const currentType = (page.page_type || 'auto') as PageType;
  const inferred = inferPageType();
  const displayType = currentType === 'auto' ? inferred.type : currentType;
  const displayReason = currentType === 'auto' ? inferred.reason : '已手动指定页面类型';

  const getMaterialDisplayName = (material: Material): string =>
    material.prompt?.trim() ||
    material.name?.trim() ||
    material.original_filename?.trim() ||
    material.source_filename?.trim() ||
    material.filename ||
    material.url;

  const sanitizeAltText = (textValue: string): string =>
    textValue.replace(/[[\]]/g, '').trim() || '素材';

  const buildMaterialsMarkdown = (materials: Material[]): string =>
    materials
      .map((material) => {
        const alt = sanitizeAltText(getMaterialDisplayName(material));
        return `![${alt}](${material.url})`;
      })
      .join('\n');

  const updateDescriptionWithMaterials = (currentText: string, materials: Material[]): string => {
    const materialsMarkdown = buildMaterialsMarkdown(materials);
    const trimmedText = (currentText || '').trim();
    const sectionRegex = new RegExp(`(^|\\n)${MATERIAL_SECTION_TITLE}\\s*\\n([\\s\\S]*?)$`);

    if (sectionRegex.test(trimmedText)) {
      return trimmedText.replace(sectionRegex, `$1${MATERIAL_SECTION_TITLE}\n${materialsMarkdown}`);
    }

    if (!trimmedText) {
      return `${MATERIAL_SECTION_TITLE}\n${materialsMarkdown}`;
    }

    return `${trimmedText}\n\n${MATERIAL_SECTION_TITLE}\n${materialsMarkdown}`;
  };

  const getMaterialCountFromText = (currentText: string): number => {
    const sectionRegex = new RegExp(`${MATERIAL_SECTION_TITLE}\\s*\\n([\\s\\S]*)$`);
    const match = currentText.match(sectionRegex);
    if (!match) return 0;
    const sectionBody = match[1] || '';
    const imageRegex = /!\[[^\]]*]\(([^)]+)\)/g;
    return Array.from(sectionBody.matchAll(imageRegex)).length;
  };

  const handleSelectMaterials = (materials: Material[]) => {
    const updatedText = updateDescriptionWithMaterials(text, materials);
    onUpdate({
      description_content: {
        text: updatedText,
      } as DescriptionContent,
    });
    show({ message: `已添加 ${materials.length} 个素材`, type: 'success' });
  };

  const materialCount = getMaterialCountFromText(text);

  return (
    <>
      <Card className="p-0 overflow-hidden flex flex-col">
        {/* 标题栏 */}
        <div className="bg-banana-50 px-4 py-3 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900">第 {index + 1} 页</span>
              {page.part && (
                <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                  {page.part}
                </span>
              )}
              <span
                className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded"
                title={displayReason}
              >
                {pageTypeLabels[displayType]}
              </span>
            </div>
            <ContextualStatusBadge page={page} context="description" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-gray-500">页面类型</span>
            <select
              value={currentType}
              onChange={(e) => onUpdate({ page_type: e.target.value as PageType })}
              className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
              disabled={generating}
            >
              <option value="auto">自动（{pageTypeLabels[inferred.type]}）</option>
              <option value="cover">封面</option>
              <option value="content">内容</option>
              <option value="transition">过渡</option>
              <option value="ending">结尾</option>
            </select>
          </div>
        </div>

        {/* 内容 */}
        <div className="p-4 flex-1">
          {generating ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <div className="text-center py-4 text-gray-500 text-sm">
                正在生成描述...
              </div>
            </div>
          ) : text ? (
            <div className="text-sm text-gray-700">
              <Markdown>{text}</Markdown>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <div className="flex text-3xl mb-2 justify-center"><FileText className="text-gray-400" size={48} /></div>
              <p className="text-sm">尚未生成描述</p>
            </div>
          )}
        </div>

        {/* 操作栏 */}
        <div className="border-t border-gray-100 px-4 py-3 flex items-center justify-end gap-2 mt-auto">
          <Button
            variant="ghost"
            size="sm"
            icon={<ImagePlus size={16} />}
            onClick={() => setIsMaterialSelectorOpen(true)}
            disabled={generating}
          >
            素材图{materialCount > 0 ? `(${materialCount})` : ''}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Edit2 size={16} />}
            onClick={handleEdit}
            disabled={generating}
          >
            编辑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={16} className={generating ? 'animate-spin' : ''} />}
            onClick={onRegenerate}
            disabled={generating}
          >
            {generating ? '生成中...' : '重新生成'}
          </Button>
        </div>
      </Card>

      {/* 编辑对话框 */}
      <Modal
        isOpen={isEditing}
        onClose={() => setIsEditing(false)}
        title="编辑页面描述"
        size="lg"
      >
        <div className="space-y-4">
          <Textarea
            label="描述内容"
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={12}
          />
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="ghost" onClick={() => setIsEditing(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={handleSave}>
              保存
            </Button>
          </div>
        </div>
      </Modal>

      {projectId && (
        <MaterialSelector
          projectId={projectId}
          isOpen={isMaterialSelectorOpen}
          onClose={() => setIsMaterialSelectorOpen(false)}
          onSelect={handleSelectMaterials}
          multiple={true}
        />
      )}
    </>
  );
};


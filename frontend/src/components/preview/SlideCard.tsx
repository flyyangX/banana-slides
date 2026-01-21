import React from 'react';
import { Edit2, Trash2 } from 'lucide-react';
import { StatusBadge, Skeleton, useConfirm } from '@/components/shared';
import { getImageUrl } from '@/api/client';
import type { Page } from '@/types';

interface SlideCardProps {
  page: Page;
  index: number;
  isSelected: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isGenerating?: boolean;
  elapsedSeconds?: number;
}

export const SlideCard: React.FC<SlideCardProps> = ({
  page,
  index,
  isSelected,
  onClick,
  onEdit,
  onDelete,
  isGenerating = false,
  elapsedSeconds,
}) => {
  const { confirm, ConfirmDialog } = useConfirm();
  const imageUrl = page.generated_image_path
    ? getImageUrl(page.generated_image_path, page.updated_at)
    : '';
  
  const generating = isGenerating || page.status === 'GENERATING';

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

  return (
    <div
      className={`group cursor-pointer transition-all ${
        isSelected ? 'ring-2 ring-banana-500' : ''
      }`}
      onClick={onClick}
    >
      {/* 缩略图 */}
      <div className="relative aspect-video bg-gray-100 rounded-lg overflow-hidden mb-2">
        {generating ? (
          <Skeleton className="w-full h-full" />
        ) : page.generated_image_path ? (
          <>
            <img
              src={imageUrl}
              alt={`Slide ${index + 1}`}
              className="w-full h-full object-cover"
            />
            {/* 悬停操作 */}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                className="p-2 bg-white rounded-lg hover:bg-banana-50 transition-colors"
              >
                <Edit2 size={18} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  confirm(
                    '确定要删除这一页吗？',
                    onDelete,
                    { title: '确认删除', variant: 'danger' }
                  );
                }}
                className="p-2 bg-white rounded-lg hover:bg-red-50 transition-colors"
              >
                <Trash2 size={18} className="text-red-600" />
              </button>
            </div>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <div className="text-center">
              <div className="text-3xl mb-1">🍌</div>
              <div className="text-xs">未生成</div>
            </div>
          </div>
        )}
        
        {/* 计时角标 */}
        {generating && typeof elapsedSeconds === 'number' && (
          <div className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded bg-black/60 text-white">
            ⏱ {formatElapsed(elapsedSeconds)}
          </div>
        )}

        {/* 状态标签 */}
        <div className="absolute bottom-2 right-2">
          <StatusBadge status={page.status} />
        </div>
      </div>

      {/* 标题 */}
      <div className="flex items-center gap-2">
        <span
          className={`text-sm font-medium ${
            isSelected ? 'text-banana-600' : 'text-gray-700'
          }`}
        >
          {index + 1}. {page.outline_content.title}
        </span>
      </div>
      {ConfirmDialog}
    </div>
  );
};


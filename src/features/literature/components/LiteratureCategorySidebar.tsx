import clsx from 'clsx';
import { useRef, useState, type DragEvent, type MouseEvent } from 'react';
import {
  ChevronRight,
  FolderPlus,
  HardDrive,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useAppLocale, useLocaleText } from '../../../i18n/uiLanguage';
import type {
  LibrarySettings,
  LiteratureCategory,
} from '../../../types/library';
import { useWheelScrollDelegate } from '../../../hooks/useWheelScrollDelegate';
import { truncateMiddle } from '../../../utils/text';
import {
  categoryIcon,
  categoryDisplayName,
  type FlatLiteratureCategory,
} from '../literatureUi';

interface LiteratureCategorySidebarProps {
  settings: LibrarySettings | null;
  categories: FlatLiteratureCategory[];
  selectedCategoryId: string | null;
  onCreateCategory: (parentCategory?: LiteratureCategory | null) => void;
  onSelectCategory: (categoryId: string) => void;
  onSelectStorageDir: () => void;
  onRenameCategory: (category: LiteratureCategory) => void;
  onDeleteCategory: (category: LiteratureCategory) => void;
  onCategoryMove: (categoryId: string, parentId: string | null) => void;
  externalDragOverCategoryId?: string | null;
  onCategoryDrop: (
    event: DragEvent<HTMLButtonElement>,
    category: LiteratureCategory,
  ) => void;
}

interface CategoryContextMenuState {
  x: number;
  y: number;
  category: FlatLiteratureCategory | null;
}

export default function LiteratureCategorySidebar({
  settings,
  categories,
  selectedCategoryId,
  onCreateCategory,
  onSelectCategory,
  onSelectStorageDir,
  onRenameCategory,
  onDeleteCategory,
  onCategoryMove,
  externalDragOverCategoryId = null,
  onCategoryDrop,
}: LiteratureCategorySidebarProps) {
  const l = useLocaleText();
  const locale = useAppLocale();
  const rootRef = useRef<HTMLElement | null>(null);
  const handleWheelCapture = useWheelScrollDelegate({ rootRef });
  const [contextMenu, setContextMenu] = useState<CategoryContextMenuState | null>(null);
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<Set<string>>(() => new Set());
  const [dragOverCategoryId, setDragOverCategoryId] = useState<string | null>(null);
  const categoryIdsWithChildren = new Set(
    categories
      .filter((category) => category.parentId)
      .map((category) => category.parentId as string),
  );
  const visibleCategories = (() => {
    let collapsedDepth: number | null = null;

    return categories.filter((category) => {
      if (collapsedDepth !== null) {
        if (category.depth > collapsedDepth) {
          return false;
        }

        collapsedDepth = null;
      }

      if (!category.isSystem && collapsedCategoryIds.has(category.id)) {
        collapsedDepth = category.depth;
      }

      return true;
    });
  })();
  const systemCategories = visibleCategories.filter(
    (category) => category.isSystem || category.systemKey,
  );
  const userCategories = visibleCategories.filter(
    (category) => !category.isSystem && !category.systemKey,
  );
  const contextMenuCategoryHasChildren =
    contextMenu?.category ? categoryIdsWithChildren.has(contextMenu.category.id) : false;

  const toggleCategoryCollapse = (categoryId: string) => {
    setCollapsedCategoryIds((current) => {
      const next = new Set(current);

      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }

      return next;
    });
  };

  const expandCategory = (categoryId: string) => {
    setCollapsedCategoryIds((current) => {
      if (!current.has(categoryId)) {
        return current;
      }

      const next = new Set(current);
      next.delete(categoryId);
      return next;
    });
  };

  const openContextMenu = (
    event: MouseEvent,
    category: FlatLiteratureCategory | null,
  ) => {
    event.preventDefault();
    setContextMenu({
      x: Math.max(12, Math.min(event.clientX, window.innerWidth - 232)),
      y: Math.max(12, Math.min(event.clientY, window.innerHeight - (category && !category.isSystem ? 168 : 60))),
      category,
    });
  };

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  const handleCategoryDragStart = (
    event: DragEvent<HTMLButtonElement>,
    category: LiteratureCategory,
  ) => {
    if (category.isSystem) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.setData('application/x-paperquay-category-id', category.id);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleCategoryRowDrop = (
    event: DragEvent<HTMLButtonElement>,
    category: LiteratureCategory,
  ) => {
    event.preventDefault();
    setDragOverCategoryId(null);

    const draggedCategoryId = event.dataTransfer.getData('application/x-paperquay-category-id');

    if (draggedCategoryId) {
      if (!category.isSystem && draggedCategoryId !== category.id) {
        onCategoryMove(draggedCategoryId, category.id);
      }
      return;
    }

    onCategoryDrop(event, category);
  };

  const handleRootDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOverCategoryId(null);

    const draggedCategoryId = event.dataTransfer.getData('application/x-paperquay-category-id');

    if (draggedCategoryId) {
      onCategoryMove(draggedCategoryId, null);
    }
  };

  const hasDragType = (event: DragEvent, type: string) =>
    Array.from(event.dataTransfer.types).includes(type);

  const renderCategoryRow = (category: FlatLiteratureCategory) => {
    const hasChildren = categoryIdsWithChildren.has(category.id);
    const collapsed = hasChildren && collapsedCategoryIds.has(category.id);
    const canDropOnCategory = !category.isSystem;
    const dragOver = dragOverCategoryId === category.id || externalDragOverCategoryId === category.id;

    return (
      <div key={category.id} className="group flex items-center gap-1">
        <button
          type="button"
          data-paperquay-category-drop-id={!category.isSystem ? category.id : undefined}
          draggable={!category.isSystem}
          onDragStart={(event) => handleCategoryDragStart(event, category)}
          onClick={() => onSelectCategory(category.id)}
          onContextMenu={(event) => openContextMenu(event, category)}
          onDoubleClick={() => {
            if (hasChildren && !category.isSystem) {
              toggleCategoryCollapse(category.id);
            }
          }}
          onDragOver={(event) => {
            if (
              canDropOnCategory &&
              (hasDragType(event, 'application/x-paperquay-category-id') ||
                hasDragType(event, 'application/x-paperquay-paper-id') ||
                hasDragType(event, 'text/plain'))
            ) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDragOverCategoryId(category.id);
            }
          }}
          onDragLeave={(event) => {
            const nextTarget = event.relatedTarget;

            if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
              setDragOverCategoryId((current) => (current === category.id ? null : current));
            }
          }}
          onDrop={(event) => handleCategoryRowDrop(event, category)}
          className={clsx(
            'flex min-w-0 flex-1 items-center justify-between rounded-2xl px-3 py-2.5 text-left text-sm transition',
            dragOver
              ? 'bg-teal-50 text-teal-800 shadow-[0_14px_30px_rgba(20,184,166,0.14)] ring-1 ring-teal-300 dark:bg-teal-300/12 dark:text-teal-100 dark:ring-teal-300/30'
              : selectedCategoryId === category.id
              ? 'bg-slate-900 text-white dark:bg-[#275b5f] dark:text-white'
              : category.isSystem
                ? 'text-slate-700 hover:bg-white dark:text-[#d7d7d7] dark:hover:bg-[#242424]'
                : 'text-slate-600 hover:bg-slate-100 dark:text-[#a0a0a0] dark:hover:bg-[#242424]',
          )}
          style={{ paddingLeft: `${12 + category.depth * 18}px` }}
          aria-expanded={hasChildren ? !collapsed : undefined}
        >
          <span className="flex min-w-0 items-center gap-2">
            {hasChildren && !category.isSystem ? (
              <span
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleCategoryCollapse(category.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleCategoryCollapse(category.id);
                  }
                }}
                title={collapsed ? l('展开分类', 'Expand category') : l('折叠分类', 'Collapse category')}
                className={clsx(
                  'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-lg transition hover:bg-black/5 dark:hover:bg-white/10',
                  selectedCategoryId === category.id ? 'text-white' : 'text-slate-400 dark:text-[#8d8d8d]',
                )}
              >
                <ChevronRight
                  className={clsx('h-3.5 w-3.5 transition-transform', !collapsed && 'rotate-90')}
                  strokeWidth={2}
                />
              </span>
            ) : (
              <span className="h-5 w-5 shrink-0" />
            )}
            <span className="shrink-0">{categoryIcon(category)}</span>
            <span className="truncate">{categoryDisplayName(category, locale)}</span>
          </span>
          <span
            className={clsx(
              'ml-2 shrink-0 rounded-full px-2 py-0.5 text-[11px]',
              selectedCategoryId === category.id
                ? 'bg-white/16 text-white'
                : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-[#a0a0a0]',
            )}
          >
            {category.paperCount}
          </span>
        </button>
      </div>
    );
  };

  return (
    <aside
      ref={rootRef}
      onWheelCapture={handleWheelCapture}
      className="flex h-full min-h-0 flex-col overflow-hidden border-r border-slate-200 bg-white/86 dark:border-white/10 dark:bg-[#181818]"
    >
      <div className="border-b border-slate-200 px-4 py-4 dark:border-white/10">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#a0a0a0]">
              PaperQuay
            </div>
            <div className="mt-1 text-xl font-semibold tracking-tight">
              {l('本地文献库', 'Local Library')}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onCreateCategory(null)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-[#242424] dark:text-[#a0a0a0] dark:hover:bg-[#2b2b2b]"
            title={l('新建分类', 'New Category')}
          >
            <FolderPlus className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>
      </div>

      <div
        data-wheel-scroll-target
        className="h-0 min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 py-3"
      >
        <div className="mb-3 rounded-3xl border border-slate-200 bg-slate-50/80 p-1.5 shadow-sm dark:border-white/10 dark:bg-[#1e1e1e]">
          {systemCategories.map(renderCategoryRow)}
        </div>

        <div
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('application/x-paperquay-category-id')) {
              event.preventDefault();
            }
          }}
          onDrop={handleRootDrop}
          onContextMenu={(event) => openContextMenu(event, null)}
          className="mb-2 rounded-2xl border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400 transition hover:border-teal-300 hover:text-teal-700 dark:border-white/10 dark:text-[#8d8d8d] dark:hover:border-[#4fa3a8] dark:hover:text-[#79c6c9]"
        >
          {l('拖动分类到这里可移回顶层，右键新建顶层分类', 'Drop a category here to move it to the root level. Right-click to create a root category.')}
        </div>

        <div className="space-y-1">
          {userCategories.map(renderCategoryRow)}
        </div>
      </div>

      <div className="border-t border-slate-200 p-3 dark:border-white/10">
        <button
          type="button"
          onClick={onSelectStorageDir}
          className="flex w-full items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left text-xs text-slate-500 transition hover:bg-slate-50 dark:border-white/10 dark:bg-[#1e1e1e] dark:text-[#a0a0a0] dark:hover:bg-[#242424]"
        >
          <HardDrive className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          <span className="min-w-0">
            <span className="block font-medium text-slate-700 dark:text-[#e0e0e0]">
              {l('文献存储文件夹', 'Storage Folder')}
            </span>
            <span className="mt-1 block truncate">
              {settings?.storageDir ? truncateMiddle(settings.storageDir, 34) : l('未设置', 'Not set')}
            </span>
          </span>
        </button>
      </div>

      {contextMenu ? (
        <div
          className="fixed inset-0 z-50"
          onClick={closeContextMenu}
          onContextMenu={(event) => {
            event.preventDefault();
            closeContextMenu();
          }}
        >
          <div
            className="min-w-52 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1.5 shadow-[0_18px_50px_rgba(15,23,42,0.18)] dark:border-white/10 dark:bg-[#242424]"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
              position: 'fixed',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {contextMenu.category && !contextMenu.category.isSystem ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const category = contextMenu.category;

                    if (category) {
                      expandCategory(category.id);
                      onCreateCategory(category);
                    }
                    closeContextMenu();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-[#e0e0e0] dark:hover:bg-[#2f2f2f]"
                >
                  <FolderPlus className="h-4 w-4 text-teal-600 dark:text-[#79c6c9]" strokeWidth={1.9} />
                  {l('新建子分类', 'New Subcategory')}
                </button>
                {contextMenuCategoryHasChildren ? (
                  <button
                    type="button"
                    onClick={() => {
                      const category = contextMenu.category;

                      if (category) {
                        toggleCategoryCollapse(category.id);
                      }
                      closeContextMenu();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-[#e0e0e0] dark:hover:bg-[#2f2f2f]"
                  >
                    <ChevronRight
                      className={clsx(
                        'h-4 w-4 text-slate-500 transition-transform dark:text-[#a0a0a0]',
                        !collapsedCategoryIds.has(contextMenu.category.id) && 'rotate-90',
                      )}
                      strokeWidth={1.9}
                    />
                    {collapsedCategoryIds.has(contextMenu.category.id)
                      ? l('展开分类', 'Expand Category')
                      : l('折叠分类', 'Collapse Category')}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    const category = contextMenu.category;

                    if (category) {
                      onRenameCategory(category);
                    }
                    closeContextMenu();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-[#e0e0e0] dark:hover:bg-[#2f2f2f]"
                >
                  <Pencil className="h-4 w-4 text-slate-500 dark:text-[#a0a0a0]" strokeWidth={1.9} />
                  {l('重命名分类', 'Rename Category')}
                </button>
                <div className="my-1 border-t border-slate-100 dark:border-white/10" />
                <button
                  type="button"
                  onClick={() => {
                    const category = contextMenu.category;

                    if (category) {
                      onDeleteCategory(category);
                    }
                    closeContextMenu();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 transition hover:bg-rose-50 dark:text-rose-200 dark:hover:bg-rose-400/10"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.9} />
                  {l('删除分类', 'Delete Category')}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onCreateCategory(null);
                  closeContextMenu();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-[#e0e0e0] dark:hover:bg-[#2f2f2f]"
              >
                <FolderPlus className="h-4 w-4 text-teal-600 dark:text-[#79c6c9]" strokeWidth={1.9} />
                {l('新建顶层分类', 'New Root Category')}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

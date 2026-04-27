import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  BookOpenText,
  ChevronRight,
  Clock3,
  Files,
  FolderClosed,
  FolderOpen,
  FolderTree,
  Grid2x2,
  HardDrive,
  LayoutList,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings2,
} from 'lucide-react';
import { useLocaleText } from '../../i18n/uiLanguage';
import type {
  FlatCollection,
  LibrarySectionKey,
  WorkspaceItem,
} from '../../types/reader';
import { truncateMiddle } from '../../utils/text';

const LIBRARY_SIDEBAR_WIDTH_STORAGE_KEY = 'paper-reader-library-sidebar-width-v1';
const LIBRARY_LIST_WIDTH_STORAGE_KEY = 'paper-reader-library-list-width-v1';
const LIBRARY_TREE_EXPANDED_STORAGE_KEY = 'paper-reader-library-tree-expanded-v1';
const LIBRARY_GROUP_EXPANDED_STORAGE_KEY = 'paper-reader-library-group-expanded-v1';

const COLLAPSED_SIDEBAR_WIDTH = 76;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 420;
const MIN_LIST_WIDTH = 320;
const MAX_LIST_WIDTH = 620;
const MIN_PREVIEW_WIDTH = 360;

type ResizeTarget = 'sidebar' | 'list';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function loadStoredNumber(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key));

    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function loadExpandedCollections(): Record<string, boolean> {
  try {
    const rawValue = localStorage.getItem(LIBRARY_TREE_EXPANDED_STORAGE_KEY);

    return rawValue ? JSON.parse(rawValue) : {};
  } catch {
    return {};
  }
}

function loadExpandedGroups(): Record<string, boolean> {
  try {
    const rawValue = localStorage.getItem(LIBRARY_GROUP_EXPANDED_STORAGE_KEY);

    return rawValue ? JSON.parse(rawValue) : {};
  } catch {
    return {};
  }
}

interface LibraryItemGroup {
  groupKey: string;
  primaryItem: WorkspaceItem;
  items: WorkspaceItem[];
}

function ResizeHandle({
  label,
  onPointerDown,
}: {
  label: string;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={onPointerDown}
      className="group relative z-20 w-2 shrink-0 cursor-col-resize bg-transparent transition-all duration-200"
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-200/90 transition-all duration-200 group-hover:w-[3px] group-hover:bg-indigo-300" />
      <div className="absolute left-1/2 top-1/2 h-14 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-300/80 opacity-0 transition-all duration-200 group-hover:opacity-100" />
    </div>
  );
}

function LibrarySectionButton({
  label,
  meta,
  icon,
  active,
  onClick,
  depth = 0,
}: {
  label: string;
  meta?: string;
  icon?: ReactNode;
  active: boolean;
  onClick: () => void;
  depth?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-all duration-200',
        active
          ? 'bg-slate-900 text-white shadow-[0_10px_24px_rgba(15,23,42,0.18)]'
          : 'text-slate-600 hover:bg-white/80 hover:text-slate-900',
      )}
      style={{
        paddingLeft: `${12 + depth * 18}px`,
      }}
    >
      <span className="flex min-w-0 items-center gap-2">
        {icon ? (
          <span
            className={clsx(
              'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
              active ? 'bg-white/12 text-white' : 'bg-slate-100 text-slate-500',
            )}
          >
            {icon}
          </span>
        ) : null}
        <span className="truncate">{label}</span>
      </span>
      {meta ? (
        <span
          className={clsx(
            'ml-3 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
            active ? 'bg-white/12 text-white/90' : 'bg-slate-100 text-slate-500',
          )}
        >
          {meta}
        </span>
      ) : null}
    </button>
  );
}

function CollectionTreeRow({
  collection,
  hasChildren,
  expanded,
  active,
  onToggle,
  onSelect,
}: {
  collection: FlatCollection;
  hasChildren: boolean;
  expanded: boolean;
  active: boolean;
  onToggle: (collectionKey: string) => void;
  onSelect: (sectionKey: LibrarySectionKey) => void;
}) {
  const l = useLocaleText();
  const FolderIcon = expanded ? FolderOpen : collection.depth > 0 ? FolderClosed : FolderTree;

  return (
    <div
      className={clsx(
        'group flex items-center rounded-xl pr-2 text-sm transition-all duration-200',
        active
          ? 'bg-slate-900 text-white shadow-[0_10px_24px_rgba(15,23,42,0.18)]'
          : 'text-slate-600 hover:bg-white/80 hover:text-slate-900',
      )}
      style={{
        paddingLeft: `${8 + collection.depth * 18}px`,
      }}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggle(collection.collectionKey);
        }}
        disabled={!hasChildren}
        className={clsx(
          'my-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200',
          hasChildren
            ? active
              ? 'text-white/90 hover:bg-white/12'
              : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
            : 'cursor-default opacity-0',
        )}
        aria-label={
          expanded
            ? l(`折叠 ${collection.name}`, `Collapse ${collection.name}`)
            : l(`展开 ${collection.name}`, `Expand ${collection.name}`)
        }
      >
        <ChevronRight
          className={clsx('h-4 w-4 transition-transform duration-200', expanded && 'rotate-90')}
          strokeWidth={1.9}
        />
      </button>
      <button
        type="button"
        onClick={() => onSelect(`collection:${collection.collectionKey}`)}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 py-2.5 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={clsx(
              'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
              active ? 'bg-white/12 text-white' : 'bg-slate-100 text-slate-500',
            )}
          >
            <FolderIcon className="h-4 w-4" strokeWidth={1.8} />
          </span>
          <span className="truncate">{collection.name}</span>
        </span>
        <span
          className={clsx(
            'ml-2 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
            active ? 'bg-white/12 text-white/90' : 'bg-slate-100 text-slate-500',
          )}
        >
          {collection.itemCount}
        </span>
      </button>
    </div>
  );
}

interface LibraryWorkspaceProps {
  leftSidebarCollapsed: boolean;
  zoteroLocalDataDir: string;
  zoteroAllItemsCount: number;
  standaloneItemsCount: number;
  flattenedCollections: FlatCollection[];
  selectedSectionKey: LibrarySectionKey;
  selectedSectionTitle: string;
  visibleItems: WorkspaceItem[];
  itemParseStatusMap: Record<string, boolean | undefined>;
  selectedItemId: string | null;
  librarySearchQuery: string;
  libraryDisplayMode: 'list' | 'card';
  libraryLoading: boolean;
  libraryLoadingSection: string | null;
  statusMessage: string;
  error: string;
  librarySearchInputRef: RefObject<HTMLInputElement>;
  onToggleLeftSidebar: () => void;
  onSelectSection: (sectionKey: LibrarySectionKey) => void;
  onSearchQueryChange: (value: string) => void;
  onDisplayModeChange: (mode: 'list' | 'card') => void;
  onOpenStandalonePdf: () => void;
  onReloadLocalZotero: () => void;
  onOpenPreferences: () => void;
  onItemClick: (item: WorkspaceItem) => void;
  onItemDoubleClick: (item: WorkspaceItem) => void;
  previewPane: ReactNode;
}

function LibraryWorkspace({
  leftSidebarCollapsed,
  zoteroLocalDataDir,
  zoteroAllItemsCount,
  standaloneItemsCount,
  flattenedCollections,
  selectedSectionKey,
  selectedSectionTitle,
  visibleItems,
  itemParseStatusMap,
  selectedItemId,
  librarySearchQuery,
  libraryDisplayMode,
  libraryLoading,
  libraryLoadingSection,
  statusMessage,
  error,
  librarySearchInputRef,
  onToggleLeftSidebar,
  onSelectSection,
  onSearchQueryChange,
  onDisplayModeChange,
  onOpenStandalonePdf,
  onReloadLocalZotero,
  onOpenPreferences,
  onItemClick,
  onItemDoubleClick,
  previewPane,
}: LibraryWorkspaceProps) {
  const l = useLocaleText();
  const containerRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    clamp(loadStoredNumber(LIBRARY_SIDEBAR_WIDTH_STORAGE_KEY, 264), MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH),
  );
  const [listWidth, setListWidth] = useState(() =>
    clamp(loadStoredNumber(LIBRARY_LIST_WIDTH_STORAGE_KEY, 420), MIN_LIST_WIDTH, MAX_LIST_WIDTH),
  );
  const [resizeTarget, setResizeTarget] = useState<ResizeTarget | null>(null);
  const [expandedCollections, setExpandedCollections] = useState<Record<string, boolean>>(
    loadExpandedCollections,
  );
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(loadExpandedGroups);
  const sectionOptions = [
    ['recent', Clock3, l('最近添加', 'Recent')],
    ['all', Files, l('全部 PDF', 'All PDFs')],
    ['standalone', BookOpenText, l('独立 PDF', 'Standalone PDFs')],
  ] as const;

  const selectedCollectionKey = selectedSectionKey.startsWith('collection:')
    ? selectedSectionKey.slice('collection:'.length)
    : null;

  const collectionMap = useMemo(
    () =>
      new Map(
        flattenedCollections.map((collection) => [collection.collectionKey, collection]),
      ),
    [flattenedCollections],
  );

  const childrenByParentKey = useMemo(() => {
    const grouped = new Map<string | null, FlatCollection[]>();

    for (const collection of flattenedCollections) {
      const parentKey = collection.parentCollectionKey ?? null;
      const bucket = grouped.get(parentKey) ?? [];
      bucket.push(collection);
      grouped.set(parentKey, bucket);
    }

    for (const [parentKey, children] of grouped.entries()) {
      grouped.set(
        parentKey,
        [...children].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
      );
    }

    return grouped;
  }, [flattenedCollections]);

  const visibleCollections = useMemo(() => {
    const output: FlatCollection[] = [];

    const walk = (parentKey: string | null) => {
      for (const collection of childrenByParentKey.get(parentKey) ?? []) {
        output.push(collection);

        const expanded = expandedCollections[collection.collectionKey] ?? collection.depth === 0;

        if (expanded) {
          walk(collection.collectionKey);
        }
      }
    };

    walk(null);

    return output;
  }, [childrenByParentKey, expandedCollections]);

  const visibleGroups = useMemo(() => {
    const grouped = new Map<string, LibraryItemGroup>();

    for (const item of visibleItems) {
      const existingGroup = grouped.get(item.groupKey);

      if (existingGroup) {
        existingGroup.items.push(item);
        continue;
      }

      grouped.set(item.groupKey, {
        groupKey: item.groupKey,
        primaryItem: item,
        items: [item],
      });
    }

    return Array.from(grouped.values()).map((group) => ({
      ...group,
      items: [...group.items].sort((left, right) =>
        (left.attachmentFilename || left.title).localeCompare(
          right.attachmentFilename || right.title,
          'zh-CN',
        ),
      ),
    }));
  }, [visibleItems]);

  const handleToggleCollection = (collectionKey: string) => {
    setExpandedCollections((current) => ({
      ...current,
      [collectionKey]: !(current[collectionKey] ?? collectionMap.get(collectionKey)?.depth === 0),
    }));
  };

  const handleToggleGroup = (groupKey: string) => {
    setExpandedGroups((current) => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  };

  const handleResizeStart = (target: ResizeTarget, event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setResizeTarget(target);
  };

  useEffect(() => {
    localStorage.setItem(LIBRARY_SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem(LIBRARY_LIST_WIDTH_STORAGE_KEY, String(listWidth));
  }, [listWidth]);

  useEffect(() => {
    localStorage.setItem(LIBRARY_TREE_EXPANDED_STORAGE_KEY, JSON.stringify(expandedCollections));
  }, [expandedCollections]);

  useEffect(() => {
    localStorage.setItem(LIBRARY_GROUP_EXPANDED_STORAGE_KEY, JSON.stringify(expandedGroups));
  }, [expandedGroups]);

  useEffect(() => {
    if (!selectedItemId) {
      return;
    }

    const selectedGroup = visibleGroups.find(
      (group) =>
        group.items.length > 1 && group.items.some((item) => item.workspaceId === selectedItemId),
    );

    if (!selectedGroup) {
      return;
    }

    setExpandedGroups((current) =>
      current[selectedGroup.groupKey]
        ? current
        : {
            ...current,
            [selectedGroup.groupKey]: true,
          },
    );
  }, [selectedItemId, visibleGroups]);

  useEffect(() => {
    if (!selectedCollectionKey) {
      return;
    }

    const nextExpanded: Record<string, boolean> = {};
    let parentKey = collectionMap.get(selectedCollectionKey)?.parentCollectionKey ?? null;

    while (parentKey) {
      nextExpanded[parentKey] = true;
      parentKey = collectionMap.get(parentKey)?.parentCollectionKey ?? null;
    }

    if (Object.keys(nextExpanded).length > 0) {
      setExpandedCollections((current) => ({
        ...current,
        ...nextExpanded,
      }));
    }
  }, [collectionMap, selectedCollectionKey]);

  useEffect(() => {
    if (!resizeTarget) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();

      if (!rect) {
        return;
      }

      const pointerX = event.clientX - rect.left;
      const currentSidebarWidth = leftSidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidth;

      if (resizeTarget === 'sidebar' && !leftSidebarCollapsed) {
        const maxWidth = Math.min(
          MAX_SIDEBAR_WIDTH,
          rect.width - listWidth - MIN_PREVIEW_WIDTH - 16,
        );

        setSidebarWidth(clamp(pointerX, MIN_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, maxWidth)));
        return;
      }

      if (resizeTarget === 'list') {
        const nextListWidth = pointerX - currentSidebarWidth - (leftSidebarCollapsed ? 8 : 16);
        const maxWidth = Math.min(
          MAX_LIST_WIDTH,
          rect.width - currentSidebarWidth - MIN_PREVIEW_WIDTH - 16,
        );

        setListWidth(clamp(nextListWidth, MIN_LIST_WIDTH, Math.max(MIN_LIST_WIDTH, maxWidth)));
      }
    };

    const handlePointerUp = () => {
      setResizeTarget(null);
    };

    const previousUserSelect = globalThis.document.body.style.userSelect;
    const previousCursor = globalThis.document.body.style.cursor;

    globalThis.document.body.style.userSelect = 'none';
    globalThis.document.body.style.cursor = 'col-resize';

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      globalThis.document.body.style.userSelect = previousUserSelect;
      globalThis.document.body.style.cursor = previousCursor;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [leftSidebarCollapsed, listWidth, resizeTarget, sidebarWidth]);

  const renderedCollectionRows = visibleCollections.map((collection) => {
    const hasChildren = (childrenByParentKey.get(collection.collectionKey) ?? []).length > 0;
    const expanded = expandedCollections[collection.collectionKey] ?? collection.depth === 0;

    return (
      <CollectionTreeRow
        key={collection.collectionKey}
        collection={collection}
        hasChildren={hasChildren}
        expanded={expanded}
        active={selectedSectionKey === `collection:${collection.collectionKey}`}
        onToggle={handleToggleCollection}
        onSelect={onSelectSection}
      />
    );
  });

  return (
    <div ref={containerRef} className="flex h-full min-h-0">
      <aside
        data-tour="library-sidebar"
        className="flex min-h-0 shrink-0 flex-col border-r border-slate-200/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.94),rgba(241,245,249,0.98))]"
        style={{
          width: leftSidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidth,
        }}
      >
        {leftSidebarCollapsed ? (
          <>
            <div className="border-b border-slate-200/80 px-3 py-4">
              <div className="flex flex-col items-center gap-2 rounded-[20px] border border-white/70 bg-white/82 px-2 py-3 shadow-[0_14px_32px_rgba(15,23,42,0.05)] backdrop-blur-xl">
                <button
                  type="button"
                  onClick={onToggleLeftSidebar}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white transition-all duration-200 hover:bg-slate-800"
                  aria-label={l('展开左侧导航', 'Expand left navigation')}
                >
                  <PanelLeftOpen className="h-4 w-4" strokeWidth={1.9} />
                </button>
                <button
                  type="button"
                  onClick={onOpenStandalonePdf}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
                  aria-label={l('打开 PDF', 'Open PDF')}
                >
                  <BookOpenText className="h-4 w-4" strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  onClick={onReloadLocalZotero}
                  disabled={libraryLoading}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                  aria-label={l('刷新文库', 'Refresh library')}
                >
                  <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
              <div className="space-y-2">
                {sectionOptions.map(([key, Icon, label]) => (
                  <button
                    key={key as string}
                    type="button"
                    onClick={() => onSelectSection(key as LibrarySectionKey)}
                    className={clsx(
                      'flex h-14 w-full flex-col items-center justify-center gap-1 rounded-2xl border transition-all duration-200',
                      selectedSectionKey === key
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                    )}
                    aria-label={label as string}
                  >
                    <Icon className="h-4 w-4" strokeWidth={1.8} />
                    <span className="text-[10px] font-medium leading-none">{label as string}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-200/80 px-3 py-3">
              <button
                type="button"
                onClick={onOpenPreferences}
                className="flex h-14 w-full flex-col items-center justify-center gap-1 rounded-2xl border border-slate-200 bg-white text-slate-500 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
                aria-label={l('打开设置', 'Open settings')}
              >
                <Settings2 className="h-4 w-4" strokeWidth={1.8} />
                <span className="text-[10px] font-medium leading-none">{l('设置', 'Settings')}</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="border-b border-slate-200/80 px-4 py-4">
              <div className="rounded-[24px] border border-white/70 bg-white/82 p-4 shadow-[0_18px_42px_rgba(15,23,42,0.06)] backdrop-blur-xl">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      {l('本地文库', 'Local Library')}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-600">
                      {zoteroLocalDataDir
                        ? truncateMiddle(zoteroLocalDataDir, Math.max(28, Math.floor(sidebarWidth / 7)))
                        : l('尚未检测到 Zotero 数据目录', 'Zotero data directory not detected yet')}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                      <HardDrive className="h-4 w-4" strokeWidth={1.8} />
                    </span>
                    <button
                      type="button"
                      onClick={onToggleLeftSidebar}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
                      aria-label={l('折叠文库侧栏', 'Collapse library sidebar')}
                    >
                      <PanelLeftClose className="h-4 w-4" strokeWidth={1.8} />
                    </button>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={onOpenStandalonePdf}
                    className="flex-1 rounded-2xl bg-slate-900 px-3 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-slate-800"
                  >
                    {l('打开 PDF', 'Open PDF')}
                  </button>
                  <button
                    type="button"
                    onClick={onReloadLocalZotero}
                    disabled={libraryLoading}
                    className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" strokeWidth={1.8} />
                    {l('刷新', 'Refresh')}
                  </button>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
              <div className="mb-5">
                <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {l('浏览', 'Browse')}
                </div>
                <div className="space-y-1">
                  <LibrarySectionButton
                    label={l('最近添加', 'Recent')}
                    meta={String(Math.min(zoteroAllItemsCount, 30))}
                    icon={<Clock3 className="h-4 w-4" strokeWidth={1.8} />}
                    active={selectedSectionKey === 'recent'}
                    onClick={() => onSelectSection('recent')}
                  />
                  <LibrarySectionButton
                    label={l('全部 PDF', 'All PDFs')}
                    meta={String(zoteroAllItemsCount)}
                    icon={<Files className="h-4 w-4" strokeWidth={1.8} />}
                    active={selectedSectionKey === 'all'}
                    onClick={() => onSelectSection('all')}
                  />
                  <LibrarySectionButton
                    label={l('独立 PDF', 'Standalone PDFs')}
                    meta={String(standaloneItemsCount)}
                    icon={<BookOpenText className="h-4 w-4" strokeWidth={1.8} />}
                    active={selectedSectionKey === 'standalone'}
                    onClick={() => onSelectSection('standalone')}
                  />
                </div>
              </div>

              <div>
                <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {l('Zotero 分类', 'Zotero Collections')}
                </div>
                <div className="space-y-1">
                  {flattenedCollections.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-4 text-sm leading-6 text-slate-500">
                      {libraryLoading
                        ? l('正在加载 Zotero 分类…', 'Loading Zotero collections...')
                        : l('当前没有可用的 Zotero 分类。', 'No Zotero collections are available.')}
                    </div>
                  ) : (
                    renderedCollectionRows
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200/80 px-4 py-3">
              <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-500">
                {libraryLoading ? l('正在同步本地文库…', 'Syncing the local library...') : statusMessage}
              </div>
            </div>
          </>
        )}
      </aside>

      {!leftSidebarCollapsed ? (
        <ResizeHandle
          label={l('调整分类栏宽度', 'Resize categories sidebar')}
          onPointerDown={(event) => handleResizeStart('sidebar', event)}
        />
      ) : (
        <div className="w-2 shrink-0 border-r border-slate-200/80 bg-transparent" />
      )}

      <section
        data-tour="paper-list"
        className="flex min-h-0 shrink-0 flex-col bg-[linear-gradient(180deg,rgba(248,250,252,0.84),rgba(241,245,249,0.92))]"
        style={{
          width: listWidth,
        }}
      >
        <div className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/72 px-5 py-4 backdrop-blur-xl">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                {selectedSectionKey.startsWith('collection:')
                  ? l('分类', 'Collection')
                  : l('文库', 'Library')}
              </div>
              <div className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                {selectedSectionTitle}
              </div>
              <div className="mt-2 text-sm text-slate-500">
                {l(
                  '在桌面端快速浏览当前分组中的论文，单击选中，双击进入阅读工作区。',
                  'Quickly browse papers in the current group. Single-click to select, double-click to open the reading workspace.',
                )}
              </div>
            </div>

            <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => onDisplayModeChange('list')}
                className={clsx(
                  'rounded-[14px] p-2 transition-all duration-200',
                  libraryDisplayMode === 'list'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800',
                )}
                aria-label={l('紧凑列表', 'Compact list')}
              >
                <LayoutList className="h-4 w-4" strokeWidth={1.9} />
              </button>
              <button
                type="button"
                onClick={() => onDisplayModeChange('card')}
                className={clsx(
                  'rounded-[14px] p-2 transition-all duration-200',
                  libraryDisplayMode === 'card'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800',
                )}
                aria-label={l('卡片列表', 'Card list')}
              >
                <Grid2x2 className="h-4 w-4" strokeWidth={1.9} />
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3 rounded-[22px] border border-white/70 bg-white/82 px-4 py-3 shadow-[0_14px_32px_rgba(15,23,42,0.05)]">
            <Search className="h-4 w-4 text-slate-400" strokeWidth={1.8} />
            <input
              ref={librarySearchInputRef}
              value={librarySearchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder={l('筛选标题、作者或年份', 'Filter by title, author, or year')}
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
            />
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
              {visibleGroups.length}
            </span>
          </div>
        </div>

        {error ? (
          <div className="border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-600">
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-3 text-xs text-slate-500">
          <span>{l('单击选中，双击打开阅读页', 'Single-click to select, double-click to open the reader')}</span>
          {selectedCollectionKey && libraryLoadingSection === selectedCollectionKey ? (
            <span>{l('加载中…', 'Loading...')}</span>
          ) : null}
        </div>

        <div
          className={clsx(
            'min-h-0 flex-1 overflow-y-auto',
            libraryDisplayMode === 'card' ? 'px-5 py-5' : '',
          )}
        >
          {visibleGroups.length === 0 ? (
            <div className="px-5 py-8 text-sm leading-7 text-slate-500">
              {selectedCollectionKey && libraryLoadingSection === selectedCollectionKey
                ? l('正在加载当前分类下的 PDF 条目…', 'Loading PDF entries in the selected collection...')
                : l('当前视图没有符合条件的文献。', 'No papers match the current view.')}
            </div>
          ) : (
            <div
              className={clsx(
                libraryDisplayMode === 'card' ? 'space-y-3' : 'divide-y divide-slate-200/70',
              )}
            >
              {visibleGroups.map((group) => {
                const expanded = Boolean(expandedGroups[group.groupKey]);
                const hasChildren = group.items.length > 1;
                const activeItem =
                  group.items.find((item) => item.workspaceId === selectedItemId) ?? group.primaryItem;
                const active = group.items.some((item) => item.workspaceId === selectedItemId);
                const parsed = itemParseStatusMap[activeItem.workspaceId];

                return (
                  <div
                    key={group.groupKey}
                    className={clsx(
                      'overflow-hidden transition-all duration-200',
                      libraryDisplayMode === 'card'
                        ? active
                          ? 'rounded-[24px] border border-indigo-200 bg-white shadow-[0_18px_40px_rgba(79,70,229,0.10)]'
                          : 'rounded-[24px] border border-slate-200/80 bg-white/82'
                        : '',
                    )}
                  >
                    <div className="flex items-stretch">
                      <div
                        className={clsx(
                          'flex shrink-0 items-start',
                          libraryDisplayMode === 'card' ? 'pl-2 pt-3' : 'pl-2 pt-2',
                        )}
                      >
                        {hasChildren ? (
                          <button
                            type="button"
                            onClick={() => handleToggleGroup(group.groupKey)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-700"
                            aria-label={
                              expanded
                                ? l('折叠论文附件', 'Collapse attachments')
                                : l('展开论文附件', 'Expand attachments')
                            }
                          >
                            <ChevronRight
                              className={clsx('h-4 w-4 transition-transform duration-200', expanded && 'rotate-90')}
                              strokeWidth={1.9}
                            />
                          </button>
                        ) : (
                          <div className="w-8" />
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onItemClick(activeItem)}
                        onDoubleClick={() => onItemDoubleClick(activeItem)}
                        className={clsx(
                          'relative w-full text-left transition-all duration-200',
                          libraryDisplayMode === 'card' ? 'pl-4 pr-5 py-4' : 'pl-4 pr-5 py-3',
                          libraryDisplayMode === 'card'
                            ? active
                              ? 'bg-white'
                              : 'hover:bg-white'
                            : active
                              ? 'bg-white shadow-[inset_3px_0_0_#4f46e5]'
                              : 'hover:bg-white/70',
                        )}
                      >
                    <div
                      className={clsx(
                        'absolute bottom-3 left-0 top-3 hidden w-1 rounded-full',
                        active && libraryDisplayMode === 'card' && 'block bg-indigo-500',
                      )}
                    />
                    <div className="grid grid-cols-[minmax(0,1fr)_108px] items-start gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{activeItem.title}</div>
                        <div className="mt-1 truncate text-xs text-slate-500">
                          {activeItem.creators || l('未知作者', 'Unknown Author')}
                          {activeItem.year ? ` · ${activeItem.year}` : ''}
                        </div>
                        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-xs text-slate-400">
                          {hasChildren ? (
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
                              {l(`${group.items.length} 个 PDF`, `${group.items.length} PDFs`)}
                            </span>
                          ) : null}
                          {activeItem.attachmentFilename ? (
                            <span className="min-w-0 max-w-full truncate">{activeItem.attachmentFilename}</span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex w-[108px] min-w-[108px] flex-col items-end gap-1.5 pt-0.5 pr-1">
                        <span
                          className={clsx(
                            'inline-flex h-6 items-center justify-center whitespace-nowrap rounded-full px-2.5 text-[11px] font-medium',
                            activeItem.source === 'standalone'
                              ? 'bg-slate-100 text-slate-600'
                              : activeItem.localPdfPath
                                ? 'bg-emerald-50 text-emerald-600'
                                : 'bg-amber-50 text-amber-600',
                          )}
                        >
                          {activeItem.source === 'standalone'
                            ? l('独立', 'Standalone')
                            : activeItem.localPdfPath
                              ? 'Zotero'
                              : 'Web'}
                        </span>
                        <span
                          className={clsx(
                            'inline-flex h-6 items-center justify-center whitespace-nowrap rounded-full px-2.5 text-[11px] font-medium',
                            parsed
                              ? 'bg-indigo-50 text-indigo-600'
                              : 'bg-slate-100 text-slate-500',
                          )}
                        >
                          {parsed ? l('已解析', 'Parsed') : l('未解析', 'Not Parsed')}
                        </span>
                        {active ? (
                          <span className="inline-flex h-6 items-center justify-center whitespace-nowrap rounded-full bg-indigo-50 px-2.5 text-[11px] font-medium text-indigo-600">
                            {l('已选中', 'Selected')}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                    </div>

                    {hasChildren && expanded ? (
                      <div
                        className={clsx(
                          'space-y-2 border-t border-slate-200/70 pb-3 pr-3',
                          libraryDisplayMode === 'card' ? 'ml-12 mr-4 pl-2 pt-3' : 'ml-12 pl-2 pt-2',
                        )}
                      >
                        {group.items.map((item, index) => {
                          const childActive = selectedItemId === item.workspaceId;

                          return (
                            <button
                              key={item.workspaceId}
                              type="button"
                              onClick={() => onItemClick(item)}
                              onDoubleClick={() => onItemDoubleClick(item)}
                              className={clsx(
                                'flex w-full items-center justify-between rounded-2xl border px-3 py-2.5 text-left transition-all duration-200',
                                childActive
                                  ? 'border-indigo-200 bg-indigo-50/80 text-indigo-700'
                                  : 'border-slate-200/80 bg-white/88 text-slate-600 hover:border-slate-300 hover:bg-white',
                              )}
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium">
                                  {item.attachmentFilename || `PDF ${index + 1}`}
                                </span>
                                <span className="mt-1 block truncate text-xs text-slate-400">
                                  {item.localPdfPath
                                    ? l('本地附件', 'Local Attachment')
                                    : l('远程附件', 'Remote Attachment')}
                                </span>
                              </span>
                              <div className="ml-3 flex shrink-0 flex-col items-end gap-1">
                                <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">
                                  {index + 1}
                                </span>
                                <span
                                  className={clsx(
                                    'rounded-full px-2 py-1 text-[11px] font-medium',
                                    itemParseStatusMap[item.workspaceId]
                                      ? 'bg-indigo-50 text-indigo-600'
                                      : 'bg-slate-100 text-slate-500',
                                  )}
                                >
                                  {itemParseStatusMap[item.workspaceId]
                                    ? l('已解析', 'Parsed')
                                    : l('未解析', 'Not Parsed')}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <ResizeHandle
        label={l('调整论文列表与预览栏宽度', 'Resize list and preview panes')}
        onPointerDown={(event) => handleResizeStart('list', event)}
      />

      <section data-tour="preview-pane" className="min-h-0 min-w-0 flex-1 border-l border-slate-200/80">
        {previewPane}
      </section>
    </div>
  );
}

export default LibraryWorkspace;

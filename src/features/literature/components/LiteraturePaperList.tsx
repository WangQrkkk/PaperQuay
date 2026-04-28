import clsx from 'clsx';
import {
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import {
  BookOpenText,
  FilePlus2,
  GripVertical,
  RefreshCw,
  Search,
  Star,
} from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import type { LiteraturePaper } from '../../../types/library';
import { truncateMiddle } from '../../../utils/text';
import {
  paperAuthors,
  paperPdfPath,
} from '../literatureUi';

export interface LiteraturePaperListStatus {
  mineruParsed: boolean;
  overviewGenerated: boolean;
  checkingMineru?: boolean;
}

interface LiteraturePaperListProps {
  loading: boolean;
  working: boolean;
  papers: LiteraturePaper[];
  paperStatuses: Record<string, LiteraturePaperListStatus>;
  selectedPaper: LiteraturePaper | null;
  searchQuery: string;
  statusMessage: string;
  error: string;
  onSearchQueryChange: (value: string) => void;
  onImportPdfs: () => void;
  onRefresh: () => void;
  onSelectPaper: (paperId: string) => void;
  onOpenPaper: (paper: LiteraturePaper) => void;
  onPaperDragStart: (
    event: DragEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => void;
  onPaperReorder: (
    draggedPaperId: string,
    targetPaperId: string,
    placement: 'before' | 'after',
  ) => void;
  onPaperDropOnCategory: (paperId: string, categoryId: string) => void;
  onPaperPointerDragOverCategory: (categoryId: string | null) => void;
  onPaperContextMenu: (
    event: MouseEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => void;
}

export default function LiteraturePaperList({
  loading,
  working,
  papers,
  paperStatuses,
  selectedPaper,
  searchQuery,
  statusMessage,
  error,
  onSearchQueryChange,
  onImportPdfs,
  onRefresh,
  onSelectPaper,
  onOpenPaper,
  onPaperDragStart,
  onPaperReorder,
  onPaperDropOnCategory,
  onPaperPointerDragOverCategory,
  onPaperContextMenu,
}: LiteraturePaperListProps) {
  const l = useLocaleText();
  const [dropIndicator, setDropIndicator] = useState<{
    paperId: string;
    placement: 'before' | 'after';
  } | null>(null);
  const [draggingPaperId, setDraggingPaperId] = useState<string | null>(null);
  const sortDragRef = useRef<{
    paperId: string;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const categoryDragRef = useRef<{
    paperId: string;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const [sortDraggingPaperId, setSortDraggingPaperId] = useState<string | null>(null);
  const [categoryDraggingPaperId, setCategoryDraggingPaperId] = useState<string | null>(null);
  const [suppressClickPaperId, setSuppressClickPaperId] = useState<string | null>(null);

  const findPointerDropTarget = (
    clientX: number,
    clientY: number,
  ): { paperId: string; placement: 'before' | 'after' } | null => {
    const element = document.elementFromPoint(clientX, clientY);
    const row = element?.closest<HTMLElement>('[data-paper-row-id]');
    const paperId = row?.dataset.paperRowId;

    if (!row || !paperId) {
      return null;
    }

    const rect = row.getBoundingClientRect();
    const placement: 'before' | 'after' =
      clientY < rect.top + rect.height / 2 ? 'before' : 'after';

    return { paperId, placement };
  };

  const findCategoryDropTarget = (clientX: number, clientY: number): string | null => {
    const element = document.elementFromPoint(clientX, clientY);
    const target = element?.closest<HTMLElement>('[data-paperquay-category-drop-id]');

    return target?.dataset.paperquayCategoryDropId ?? null;
  };

  const handlePaperDragOver = (
    event: DragEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => {
    const draggedPaperId =
      draggingPaperId || event.dataTransfer.getData('application/x-paperquay-paper-id');

    if (!draggedPaperId || draggedPaperId === paper.id) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const rect = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDropIndicator({ paperId: paper.id, placement });
  };

  const handlePaperDrop = (
    event: DragEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => {
    const draggedPaperId =
      draggingPaperId || event.dataTransfer.getData('application/x-paperquay-paper-id');

    setDropIndicator(null);
    setDraggingPaperId(null);

    if (!draggedPaperId || draggedPaperId === paper.id) {
      return;
    }

    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    onPaperReorder(draggedPaperId, paper.id, placement);
  };

  const resetSortDrag = () => {
    sortDragRef.current = null;
    setDropIndicator(null);
    setSortDraggingPaperId(null);
    onPaperPointerDragOverCategory(null);
  };

  const resetCategoryDrag = () => {
    categoryDragRef.current = null;
    setCategoryDraggingPaperId(null);
    onPaperPointerDragOverCategory(null);
  };

  const handleSortPointerDown = (
    event: PointerEvent<HTMLElement>,
    paper: LiteraturePaper,
  ) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    sortDragRef.current = {
      paperId: paper.id,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
  };

  const handleSortPointerMove = (event: PointerEvent<HTMLElement>) => {
    const dragState = sortDragRef.current;

    if (!dragState) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - dragState.startX,
      event.clientY - dragState.startY,
    );

    if (!dragState.active && distance < 4) {
      return;
    }

    dragState.active = true;
    setSortDraggingPaperId(dragState.paperId);

    const categoryId = findCategoryDropTarget(event.clientX, event.clientY);

    if (categoryId) {
      setDropIndicator(null);
      onPaperPointerDragOverCategory(categoryId);
      return;
    }

    onPaperPointerDragOverCategory(null);

    const target = findPointerDropTarget(event.clientX, event.clientY);

    if (!target || target.paperId === dragState.paperId) {
      setDropIndicator(null);
      return;
    }

    setDropIndicator(target);
  };

  const handleSortPointerUp = (event: PointerEvent<HTMLElement>) => {
    const dragState = sortDragRef.current;

    if (!dragState) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    const categoryId = findCategoryDropTarget(event.clientX, event.clientY);
    const target = findPointerDropTarget(event.clientX, event.clientY);

    if (dragState.active) {
      setSuppressClickPaperId(dragState.paperId);
      window.setTimeout(() => setSuppressClickPaperId(null), 0);
    }

    if (dragState.active && categoryId) {
      onPaperDropOnCategory(dragState.paperId, categoryId);
    } else if (dragState.active && target && target.paperId !== dragState.paperId) {
      onPaperReorder(dragState.paperId, target.paperId, target.placement);
    }

    resetSortDrag();
  };

  const handleCategoryPointerDown = (
    event: PointerEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => {
    if (event.button !== 0) {
      return;
    }

    if ((event.target as HTMLElement).closest('[data-paper-sort-handle]')) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    categoryDragRef.current = {
      paperId: paper.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
  };

  const handleCategoryPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = categoryDragRef.current;

    if (!dragState) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - dragState.startX,
      event.clientY - dragState.startY,
    );

    if (!dragState.active && distance < 6) {
      return;
    }

    event.preventDefault();
    dragState.active = true;
    setCategoryDraggingPaperId(dragState.paperId);
    onPaperPointerDragOverCategory(findCategoryDropTarget(event.clientX, event.clientY));
  };

  const handleCategoryPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = categoryDragRef.current;

    if (!dragState) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    const categoryId = findCategoryDropTarget(event.clientX, event.clientY);

    if (dragState.active) {
      event.preventDefault();
      setSuppressClickPaperId(dragState.paperId);
      window.setTimeout(() => setSuppressClickPaperId(null), 0);

      if (categoryId) {
        onPaperDropOnCategory(dragState.paperId, categoryId);
      }
    }

    resetCategoryDrag();
  };

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => {
    if (event.key === 'Enter') {
      onOpenPaper(paper);
      return;
    }

    if (event.key === ' ') {
      event.preventDefault();
      onSelectPaper(paper.id);
    }
  };

  return (
    <section className="flex min-h-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-[#121212]">
      <header className="border-b border-slate-200 bg-white/82 px-5 py-4 dark:border-white/10 dark:bg-[#181818]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[260px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" strokeWidth={1.8} />
            <input
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder={l('搜索标题、作者、摘要、DOI...', 'Search title, author, abstract, DOI...')}
              className="h-11 w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-400/10 dark:border-white/10 dark:bg-[#242424] dark:text-[#e0e0e0] dark:placeholder:text-[#a0a0a0]"
            />
          </div>

          <button
            type="button"
            onClick={onImportPdfs}
            disabled={working}
            className="inline-flex h-11 items-center rounded-2xl bg-[#2f7f85] px-4 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(47,127,133,0.24)] transition hover:bg-[#286f75] disabled:opacity-60"
          >
            <FilePlus2 className="mr-2 h-4 w-4" strokeWidth={1.9} />
            {l('导入 PDF', 'Import PDF')}
          </button>

          <button
            type="button"
            onClick={onRefresh}
            disabled={working}
            className="inline-flex h-11 items-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-white/10 dark:bg-[#242424] dark:text-[#e0e0e0] dark:hover:bg-[#2b2b2b]"
          >
            <RefreshCw className="mr-2 h-4 w-4" strokeWidth={1.9} />
            {l('刷新', 'Refresh')}
          </button>
        </div>

        <div className="mt-3 text-xs text-slate-500 dark:text-[#a0a0a0]">
          {error || statusMessage || l('拖动条目前面的把手可手动排序；拖动条目本身到左侧分类可归类。', 'Drag the handle to reorder papers; drag the row onto a category to classify it.')}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500 dark:border-white/10 dark:bg-[#1e1e1e] dark:text-[#a0a0a0]">
            {l('正在加载文献库...', 'Loading library...')}
          </div>
        ) : papers.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-white/10 dark:bg-[#1e1e1e]">
            <BookOpenText className="mx-auto h-9 w-9 text-slate-400 dark:text-[#a0a0a0]" strokeWidth={1.7} />
            <div className="mt-4 text-lg font-semibold">
              {l('还没有文献', 'No papers yet')}
            </div>
            <div className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-[#a0a0a0]">
              {l(
                '点击“导入 PDF”选择一个或多个文件，软件会把路径、附件和基础信息写入本地 SQLite 文献库。',
                'Click "Import PDF" to select one or more files. The app will save paths, attachments, and basic metadata into the local SQLite library.',
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {papers.map((paper) => {
              const active = selectedPaper?.id === paper.id;
              const pdfPath = paperPdfPath(paper);
              const showBeforeIndicator =
                dropIndicator?.paperId === paper.id && dropIndicator.placement === 'before';
              const showAfterIndicator =
                dropIndicator?.paperId === paper.id && dropIndicator.placement === 'after';
              const status = paperStatuses[paper.id];
              const mineruParsed = status?.mineruParsed ?? false;
              const overviewGenerated =
                status?.overviewGenerated ?? Boolean(paper.aiSummary?.trim());

              return (
                <div key={paper.id} className="relative">
                  {showBeforeIndicator ? (
                    <div className="pointer-events-none absolute -top-1 left-4 right-4 z-10 h-0.5 rounded-full bg-teal-400 shadow-[0_0_16px_rgba(45,212,191,0.55)]" />
                  ) : null}
                  <div
                    role="button"
                    tabIndex={0}
                    data-paper-row-id={paper.id}
                    draggable={false}
                    onPointerDown={(event) => handleCategoryPointerDown(event, paper)}
                    onPointerMove={handleCategoryPointerMove}
                    onPointerUp={handleCategoryPointerUp}
                    onPointerCancel={resetCategoryDrag}
                    onDragStart={(event) => {
                      setDraggingPaperId(paper.id);
                      onPaperDragStart(event, paper);
                    }}
                    onDragOver={(event) => handlePaperDragOver(event, paper)}
                    onDragLeave={() => setDropIndicator(null)}
                    onDragEnd={() => {
                      setDropIndicator(null);
                      setDraggingPaperId(null);
                    }}
                    onDrop={(event) => handlePaperDrop(event, paper)}
                    onContextMenu={(event) => onPaperContextMenu(event, paper)}
                    onClick={() => {
                      if (suppressClickPaperId === paper.id) {
                        return;
                      }

                      onSelectPaper(paper.id);
                    }}
                    onDoubleClick={() => onOpenPaper(paper)}
                    onKeyDown={(event) => handleRowKeyDown(event, paper)}
                    className={clsx(
                      'grid w-full cursor-grab grid-cols-[28px_minmax(0,1fr)_100px_110px] gap-4 rounded-3xl border px-4 py-3 text-left transition active:cursor-grabbing',
                      active
                        ? 'border-teal-400 bg-white shadow-[0_18px_46px_rgba(15,23,42,0.12)] dark:border-[#4fa3a8] dark:bg-[#1e1e1e]'
                        : dropIndicator?.paperId === paper.id
                          ? 'border-teal-300 bg-teal-50/60 dark:border-teal-300/40 dark:bg-teal-300/10'
                          : 'border-slate-200 bg-white/82 hover:border-slate-300 hover:bg-white dark:border-white/10 dark:bg-[#1e1e1e] dark:hover:bg-[#242424]',
                      sortDraggingPaperId === paper.id && 'opacity-60 ring-2 ring-teal-300/60',
                      categoryDraggingPaperId === paper.id && 'opacity-70 ring-2 ring-teal-300/70',
                    )}
                  >
                    <span
                      data-paper-sort-handle
                      draggable={false}
                      title={l('拖动排序', 'Drag to reorder')}
                      onPointerDown={(event) => handleSortPointerDown(event, paper)}
                      onPointerMove={handleSortPointerMove}
                      onPointerUp={handleSortPointerUp}
                      onPointerCancel={resetSortDrag}
                      className="mt-0.5 flex h-9 w-7 cursor-grab items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-teal-600 active:cursor-grabbing dark:text-[#8d8d8d] dark:hover:bg-white/[0.06] dark:hover:text-teal-200"
                    >
                      <GripVertical className="h-4 w-4" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-2">
                        {paper.isFavorite ? (
                          <Star className="h-3.5 w-3.5 shrink-0 text-amber-500 dark:text-amber-200" fill="currentColor" strokeWidth={1.8} />
                        ) : null}
                        <span className="block truncate text-sm font-semibold">
                          {paper.title}
                        </span>
                      </span>
                      <span className="mt-1 block truncate text-xs text-slate-500 dark:text-[#a0a0a0]">
                        {paperAuthors(paper)}
                      </span>
                      <span className="mt-2 flex flex-wrap gap-1.5">
                        <span
                          className={clsx(
                            'rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                            status?.checkingMineru
                              ? 'border-slate-300 bg-slate-100 text-slate-500 dark:border-white/10 dark:bg-white/[0.06] dark:text-[#a0a0a0]'
                              : mineruParsed
                                ? 'border-emerald-300/55 bg-emerald-50 text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-300/10 dark:text-emerald-100'
                                : 'border-amber-300/55 bg-amber-50 text-amber-700 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100',
                          )}
                        >
                          {status?.checkingMineru
                            ? l('MinerU 检测中', 'Checking MinerU')
                            : mineruParsed
                              ? l('MinerU 已解析', 'MinerU Parsed')
                              : l('MinerU 未解析', 'MinerU Not Parsed')}
                        </span>
                        <span
                          className={clsx(
                            'rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                            overviewGenerated
                              ? 'border-sky-300/55 bg-sky-50 text-sky-700 dark:border-sky-300/20 dark:bg-sky-300/10 dark:text-sky-100'
                              : 'border-slate-300 bg-slate-100 text-slate-500 dark:border-white/10 dark:bg-white/[0.06] dark:text-[#a0a0a0]',
                          )}
                        >
                          {overviewGenerated
                            ? l('概览已生成', 'Overview Ready')
                            : l('概览未生成', 'No Overview')}
                        </span>
                      </span>
                      {paper.tags.length > 0 ? (
                        <span className="mt-2 flex flex-wrap gap-1.5">
                          {paper.tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag.id}
                              className="rounded-full border border-cyan-300/45 bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-700 dark:border-cyan-300/18 dark:bg-cyan-300/10 dark:text-cyan-100"
                            >
                              {tag.name}
                            </span>
                          ))}
                          {paper.tags.length > 3 ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-white/[0.06] dark:text-[#a0a0a0]">
                              +{paper.tags.length - 3}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                      <span className="mt-2 block truncate text-[11px] text-slate-400 dark:text-[#8d8d8d]">
                        {pdfPath ? truncateMiddle(pdfPath, 68) : l('缺少 PDF 附件', 'Missing PDF attachment')}
                      </span>
                    </span>
                    <span className="text-sm text-slate-500 dark:text-[#a0a0a0]">
                      {paper.year ?? 'n.d.'}
                    </span>
                    <span className="text-right text-xs text-slate-400 dark:text-[#8d8d8d]">
                      {new Date(paper.importedAt).toLocaleDateString()}
                    </span>
                  </div>
                  {showAfterIndicator ? (
                    <div className="pointer-events-none absolute -bottom-1 left-4 right-4 z-10 h-0.5 rounded-full bg-teal-400 shadow-[0_0_16px_rgba(45,212,191,0.55)]" />
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

import clsx from 'clsx';
import type { DragEvent } from 'react';
import {
  BookOpenText,
  FilePlus2,
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

interface LiteraturePaperListProps {
  loading: boolean;
  working: boolean;
  papers: LiteraturePaper[];
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
    event: DragEvent<HTMLButtonElement>,
    paper: LiteraturePaper,
  ) => void;
}

export default function LiteraturePaperList({
  loading,
  working,
  papers,
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
}: LiteraturePaperListProps) {
  const l = useLocaleText();

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
          {error || statusMessage || l('拖拽文献条目到左侧分类即可归类。', 'Drag a paper row onto a category to classify it.')}
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

              return (
                <button
                  key={paper.id}
                  type="button"
                  draggable
                  onDragStart={(event) => onPaperDragStart(event, paper)}
                  onClick={() => onSelectPaper(paper.id)}
                  onDoubleClick={() => onOpenPaper(paper)}
                  className={clsx(
                    'grid w-full grid-cols-[minmax(0,1fr)_100px_110px] gap-4 rounded-3xl border px-4 py-3 text-left transition',
                    active
                      ? 'border-teal-400 bg-white shadow-[0_18px_46px_rgba(15,23,42,0.12)] dark:border-[#4fa3a8] dark:bg-[#1e1e1e]'
                      : 'border-slate-200 bg-white/82 hover:border-slate-300 hover:bg-white dark:border-white/10 dark:bg-[#1e1e1e] dark:hover:bg-[#242424]',
                  )}
                >
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
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

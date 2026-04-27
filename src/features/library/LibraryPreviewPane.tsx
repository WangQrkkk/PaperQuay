import { BookOpenText, FileJson, FileText, Languages, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLocaleText } from '../../i18n/uiLanguage';
import type { PaperSummary, WorkspaceItem } from '../../types/reader';
import { SectionCard, SummaryPanel } from '../reader/AssistantSidebar';

function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success';
}) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium',
        tone === 'neutral'
          ? 'pq-badge-neutral border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-300'
          : '',
        tone === 'accent'
          ? 'pq-badge-state border-indigo-200 bg-indigo-50 text-indigo-600 dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-400'
          : '',
        tone === 'success'
          ? 'pq-badge-source border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-400'
          : '',
      ].join(' ')}
    >
      {children}
    </span>
  );
}

interface LibraryPreviewPaneProps {
  selectedItem: WorkspaceItem | null;
  currentPdfName: string;
  currentJsonName: string;
  hasBlocks: boolean;
  blockCount: number;
  statusMessage: string;
  summary: PaperSummary | null;
  loading: boolean;
  error: string;
  aiConfigured: boolean;
  demoMode?: boolean;
  translationReady?: boolean;
  onOpenReader: () => void;
  onTranslateDocument: () => void;
  onCloudParse: () => void;
  onGenerateSummary: () => void;
}

function LibraryPreviewPane({
  selectedItem,
  currentPdfName,
  currentJsonName,
  hasBlocks,
  blockCount,
  statusMessage,
  summary,
  loading,
  error,
  aiConfigured,
  demoMode = false,
  translationReady,
  onOpenReader,
  onTranslateDocument,
  onCloudParse,
  onGenerateSummary,
}: LibraryPreviewPaneProps) {
  const l = useLocaleText();
  const actionButtonClassName =
    'inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-200 dark:hover:border-white/15 dark:hover:bg-chrome-700';

  if (!selectedItem) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,rgba(248,250,252,0.76),rgba(241,245,249,0.88))] dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.9),rgba(12,21,37,0.95))]">
        <div className="flex min-h-0 flex-1 items-center justify-center px-8">
          <div className="max-w-md rounded-[28px] border border-white/70 bg-white/84 px-7 py-8 text-center shadow-[0_24px_56px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-chrome-700/70 dark:bg-chrome-800/84 dark:shadow-[0_24px_56px_rgba(0,0,0,0.24)]">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white dark:bg-accent-blue dark:text-chrome-50">
              <Sparkles className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="mt-4 text-lg font-semibold text-slate-950 dark:text-chrome-100">
              {l('选择一篇论文查看预览', 'Select a paper to view its preview')}
            </div>
            <p className="mt-3 text-sm leading-7 text-slate-500 dark:text-chrome-300">
              {l(
                '从左侧文库选择论文后，这里会显示 PDF、MinerU JSON、解析状态和摘要预览。',
                'After choosing a paper from the library, this panel shows the PDF, MinerU JSON, parse status, and summary preview.',
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,rgba(248,250,252,0.76),rgba(241,245,249,0.88))] dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.9),rgba(12,21,37,0.95))]">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="space-y-5">
          <div data-tour="overview-actions">
            <SectionCard
              title={demoMode ? l('Welcome 演示概览', 'Welcome Demo Overview') : l('论文预览', 'Paper Preview')}
              description={
                demoMode
                  ? l(
                      '新手引导会让你依次点击解析、翻译和摘要；这些结果都是内置演示数据，不会调用 API。',
                      'The onboarding guide asks you to click parse, translate, and summarize in order. These results are bundled demo data and do not call any API.',
                    )
                  : l(
                      '进入阅读器之前，先确认当前论文的文件来源、解析状态和可用操作。',
                      'Review the file source, parse status, and available actions before opening the reader.',
                    )
              }
              icon={<BookOpenText className="h-4 w-4" strokeWidth={1.75} />}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-tour="overview-mineru-parse"
                    onClick={onCloudParse}
                    disabled={loading}
                    className={actionButtonClassName}
                  >
                    <Sparkles className="mr-2 h-4 w-4" strokeWidth={1.8} />
                    {l('MinerU 解析', 'MinerU Parse')}
                  </button>
                  <button
                    type="button"
                    data-tour="overview-translate-document"
                    onClick={onTranslateDocument}
                    disabled={loading || !hasBlocks}
                    className={actionButtonClassName}
                  >
                    <Languages className="mr-2 h-4 w-4" strokeWidth={1.8} />
                    {l('全文翻译', 'Translate Document')}
                  </button>
                  <button
                    type="button"
                    onClick={onOpenReader}
                    className="inline-flex items-center rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-slate-800 dark:bg-accent-blue dark:text-chrome-50 dark:hover:bg-accent-teal-hover"
                  >
                    {l('打开阅读器', 'Open Reader')}
                  </button>
                </div>
              }
              contentClassName="space-y-4"
            >
              <div>
                <div className="text-xl font-semibold tracking-tight text-slate-950 dark:text-chrome-100">
                  {selectedItem.title}
                </div>
                <div className="mt-2 text-sm text-slate-500 dark:text-chrome-300">
                  {selectedItem.creators || l('未知作者', 'Unknown Author')}
                  {selectedItem.year ? ` · ${selectedItem.year}` : ''}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge tone={selectedItem.localPdfPath ? 'success' : 'neutral'}>
                  {selectedItem.source === 'standalone'
                    ? l('本地 PDF', 'Local PDF')
                    : selectedItem.localPdfPath
                      ? l('本地附件', 'Local Attachment')
                      : l('远程附件', 'Remote Attachment')}
                </Badge>
                <Badge tone={hasBlocks ? 'accent' : 'neutral'}>
                  {hasBlocks ? l(`${blockCount} 个结构块`, `${blockCount} blocks`) : l('未解析', 'Not Parsed')}
                </Badge>
                {demoMode ? (
                  <Badge tone={translationReady ? 'success' : 'neutral'}>
                    {translationReady ? l('译文已显示', 'Translation Ready') : l('译文未显示', 'No Translation Yet')}
                  </Badge>
                ) : null}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-4 dark:border-chrome-700/80 dark:bg-chrome-800">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-chrome-400">
                    <FileText className="h-4 w-4" strokeWidth={1.8} />
                    PDF
                  </div>
                  <div className="mt-3 break-words text-sm leading-6 text-slate-700 dark:text-chrome-200">
                    {currentPdfName || l('未加载 PDF', 'No PDF Loaded')}
                  </div>
                </div>
                <div className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-4 dark:border-chrome-700/80 dark:bg-chrome-800">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-chrome-400">
                    <FileJson className="h-4 w-4" strokeWidth={1.8} />
                    MinerU JSON
                  </div>
                  <div className="mt-3 break-words text-sm leading-6 text-slate-700 dark:text-chrome-200">
                    {currentJsonName || l('未加载 JSON', 'No JSON Loaded')}
                  </div>
                </div>
              </div>

              <div className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-4 text-sm leading-7 text-slate-600 dark:border-chrome-700/80 dark:bg-chrome-800 dark:text-chrome-200">
                {statusMessage || l('当前还没有可显示的预览状态。', 'No preview status is available yet.')}
              </div>
            </SectionCard>
          </div>

          <SummaryPanel
            paperSummary={summary}
            loading={loading}
            error={error}
            hasBlocks={hasBlocks}
            aiConfigured={demoMode || aiConfigured}
            compact
            onGenerateSummary={onGenerateSummary}
          />
        </div>
      </div>
    </div>
  );
}

export default LibraryPreviewPane;

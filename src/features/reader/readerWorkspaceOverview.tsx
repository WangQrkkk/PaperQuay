import { ArrowRight, FileJson, FileText, Languages, ScanSearch, Sparkles } from 'lucide-react';
import { useLocaleText } from '../../i18n/uiLanguage';
import type { PaperSummary, PositionedMineruBlock } from '../../types/reader';
import { SectionCard, SummaryPanel } from './AssistantSidebar';
import type { ReaderWorkspaceDocument } from './readerWorkspaceShared';

export interface ReaderWorkspaceOverviewProps {
  currentDocument: ReaderWorkspaceDocument;
  selectedSectionTitle: string;
  currentPdfName: string;
  currentJsonName: string;
  loading: boolean;
  translating: boolean;
  blocks: PositionedMineruBlock[];
  translationProgressCompleted: number;
  translationProgressTotal: number;
  paperSummary: PaperSummary | null;
  paperSummaryLoading: boolean;
  paperSummaryError: string;
  onGenerateSummary: () => void;
  onEnterReading: () => void;
  onOpenMineruJson: () => void;
  onCloudParse: () => void;
  onTranslateDocument: () => void;
  aiConfigured: boolean;
}

function InlineProgressBar({
  completed,
  total,
  label,
}: {
  completed: number;
  total: number;
  label?: string;
}) {
  if (total <= 0) {
    return null;
  }

  const ratio = Math.min(100, Math.max(0, (completed / total) * 100));

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/84 px-4 py-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="font-medium text-slate-900">
          {label || '处理进度'}
        </div>
        <div className="text-slate-500">
          {completed}/{total}
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-indigo-500 transition-all duration-300"
          style={{ width: `${ratio}%` }}
        />
      </div>
    </div>
  );
}

export function ReaderWorkspaceOverview({
  currentDocument,
  selectedSectionTitle,
  currentPdfName,
  currentJsonName,
  loading,
  translating,
  blocks,
  translationProgressCompleted,
  translationProgressTotal,
  paperSummary,
  paperSummaryLoading,
  paperSummaryError,
  onGenerateSummary,
  onEnterReading,
  onOpenMineruJson,
  onCloudParse,
  onTranslateDocument,
  aiConfigured,
}: ReaderWorkspaceOverviewProps) {
  const l = useLocaleText();
  const sourceLabel =
    currentDocument.source === 'standalone'
      ? l('独立文献', 'Standalone Document')
      : `${l('本地文库', 'Local Library')} / ${selectedSectionTitle}`;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.38fr)_360px]">
        <div className="space-y-5">
          <section
            data-tour="overview-actions"
            className="rounded-[30px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.9),rgba(248,250,252,0.78))] p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl"
          >
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="min-w-0 flex-1">
                <div className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
                  {l('论文概览', 'Paper Overview')}
                </div>
                <h2 className="mt-4 text-[30px] font-semibold tracking-tight text-slate-950">
                  {currentDocument.title}
                </h2>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                  <span>{currentDocument.creators || l('未知作者', 'Unknown Author')}</span>
                  {currentDocument.year ? <span>· {currentDocument.year}</span> : null}
                  <span>· {sourceLabel}</span>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onEnterReading}
                  className="inline-flex items-center rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-slate-800"
                >
                  {l('进入阅读', 'Start Reading')}
                  <ArrowRight className="ml-2 h-4 w-4" strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  data-tour="overview-mineru-parse"
                  onClick={onCloudParse}
                  disabled={loading}
                  className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                >
                  <Sparkles className="mr-2 h-4 w-4" strokeWidth={1.8} />
                  {l('MinerU 解析', 'MinerU Parse')}
                </button>
                <button
                  type="button"
                  data-tour="overview-translate-document"
                  onClick={onTranslateDocument}
                  disabled={loading || translating || blocks.length === 0}
                  className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                >
                  <Languages className="mr-2 h-4 w-4" strokeWidth={1.8} />
                  {translating ? l('翻译中...', 'Translating...') : l('翻译全文', 'Translate Document')}
                </button>
              </div>
            </div>
          </section>

          {translating ? (
            <InlineProgressBar
              completed={translationProgressCompleted}
              total={translationProgressTotal}
              label={l('MinerU 结构块翻译进度', 'MinerU Block Translation Progress')}
            />
          ) : null}

          <div data-tour="ai-summary">
            <SummaryPanel
              paperSummary={paperSummary}
              loading={paperSummaryLoading}
              error={paperSummaryError}
              hasBlocks={blocks.length > 0}
              aiConfigured={aiConfigured}
              onGenerateSummary={onGenerateSummary}
            />
          </div>
        </div>

        <div className="space-y-5">
          <SectionCard
            title={l('论文信息', 'Document Info')}
            description={l(
              '显示当前文档的文件状态、结构化结果和后续入口。',
              'Show the file status, structured parsing result, and next actions for the current document.',
            )}
            icon={<ScanSearch className="h-4 w-4" strokeWidth={1.8} />}
            contentClassName="space-y-4"
          >
            <div className="rounded-[22px] border border-slate-200/80 bg-white px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-chrome-400">
                {l('来源', 'Source')}
              </div>
              <div className="mt-2 text-sm leading-6 text-slate-700">{sourceLabel}</div>
            </div>

            <div className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                <FileText className="h-4 w-4" strokeWidth={1.8} />
                PDF
              </div>
              <div className="mt-2 break-words text-sm leading-6 text-slate-700">
                {currentPdfName || l('未加载 PDF', 'No PDF Loaded')}
              </div>
            </div>

            <div className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                <FileJson className="h-4 w-4" strokeWidth={1.8} />
                MinerU JSON
              </div>
              <div className="mt-2 break-words text-sm leading-6 text-slate-700">
                {currentJsonName || l('未加载 JSON', 'No JSON Loaded')}
              </div>
            </div>

            <div className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-4 text-sm leading-7 text-slate-600">
              {loading || translating
                ? l('正在处理中，请稍候...', 'Processing, please wait...')
                : blocks.length > 0
                  ? l(
                      `已检测到 ${blocks.length} 个结构块，可以直接切换到双栏对照阅读。`,
                      `Detected ${blocks.length} structured blocks. You can switch to Dual Pane reading immediately.`,
                    )
                  : l(
                      '当前还没有结构块，请先加载 JSON 或执行 MinerU 解析。',
                      'No structured blocks are available yet. Load a JSON file or run MinerU parsing first.',
                    )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onOpenMineruJson}
                disabled={loading}
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
              >
                <FileJson className="mr-2 h-4 w-4" strokeWidth={1.8} />
                {l('打开 JSON', 'Open JSON')}
              </button>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

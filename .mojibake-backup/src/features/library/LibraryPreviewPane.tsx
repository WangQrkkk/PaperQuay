import { BookOpenText, FileJson, FileText, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { SectionCard, SummaryPanel } from '../reader/AssistantSidebar';
import type { PaperSummary, WorkspaceItem } from '../../types/reader';

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
        tone === 'neutral' ? 'border-slate-200 bg-slate-50 text-slate-600' : '',
        tone === 'accent' ? 'border-indigo-200 bg-indigo-50 text-indigo-600' : '',
        tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : '',
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
  onOpenReader: () => void;
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
  onOpenReader,
  onCloudParse,
  onGenerateSummary,
}: LibraryPreviewPaneProps) {
  if (!selectedItem) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,rgba(248,250,252,0.76),rgba(241,245,249,0.88))]">
        <div className="flex min-h-0 flex-1 items-center justify-center px-8">
          <div className="max-w-md rounded-[28px] border border-white/70 bg-white/84 px-7 py-8 text-center shadow-[0_24px_56px_rgba(15,23,42,0.06)] backdrop-blur-xl">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <Sparkles className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="mt-4 text-lg font-semibold text-slate-950">闁瀚ㄦ稉鈧弧鍥啈閺傚洦鐓￠惇瀣暕鐟?/div>
            <p className="mt-3 text-sm leading-7 text-slate-500">
              杩欓噷浼氬睍绀鸿鏂囧厓淇℃伅銆佽В鏋愮姸鎬侊紝浠ュ強鍩轰簬缁撴瀯鍧楃敓鎴愮殑鎽樿棰勮銆?            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,rgba(248,250,252,0.76),rgba(241,245,249,0.88))]">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="space-y-5">
          <SectionCard
            title="论文预览"
            description="閸忓牏鈥樼拋銈呭帗娣団剝浼呴崪宀冃掗弸鎰Ц閹緤绱濋崘宥呭枀鐎规碍妲搁崥锕佺箻閸忋儱鐣弫鎾鐠囨眹鈧?
            icon={<BookOpenText className="h-4 w-4" strokeWidth={1.75} />}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onCloudParse}
                  className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
                >
                  MinerU 解析
                </button>
                <button
                  type="button"
                  onClick={onOpenReader}
                  className="inline-flex items-center rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-slate-800"
                >
                  閹垫挸绱戦弽鍥╊劮妞?                </button>
              </div>
            }
            contentClassName="space-y-4"
          >
            <div>
              <div className="text-xl font-semibold tracking-tight text-slate-950">
                {selectedItem.title}
              </div>
              <div className="mt-2 text-sm text-slate-500">
                {selectedItem.creators || '鏈煡浣滆€?}
                {selectedItem.year ? ` 璺?${selectedItem.year}` : ''}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge tone={selectedItem.localPdfPath ? 'success' : 'neutral'}>
                {selectedItem.source === 'standalone'
                  ? '本地 PDF'
                  : selectedItem.localPdfPath
                    ? '本地附件'
                    : '远程附件'}
              </Badge>
              <Badge tone={hasBlocks ? 'accent' : 'neutral'}>
                {hasBlocks ? `${blockCount} 个结构块` : '閺堫亣袙閺?}
              </Badge>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  <FileText className="h-4 w-4" strokeWidth={1.8} />
                  PDF
                </div>
                <div className="mt-3 break-words text-sm leading-6 text-slate-700">
                  {currentPdfName}
                </div>
              </div>
              <div className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  <FileJson className="h-4 w-4" strokeWidth={1.8} />
                  MinerU JSON
                </div>
                <div className="mt-3 break-words text-sm leading-6 text-slate-700">
                  {currentJsonName}
                </div>
              </div>
            </div>

            <div className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-4 text-sm leading-7 text-slate-600">
              {statusMessage}
            </div>
          </SectionCard>

          <SummaryPanel
            paperSummary={summary}
            loading={loading}
            error={error}
            hasBlocks={hasBlocks}
            aiConfigured={aiConfigured}
            compact
            onGenerateSummary={onGenerateSummary}
          />
        </div>
      </div>
    </div>
  );
}

export default LibraryPreviewPane;

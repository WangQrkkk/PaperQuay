import { X } from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import type { LiteratureCategory } from '../../../types/library';
import { getFileNameFromPath, truncateMiddle } from '../../../utils/text';

export interface ImportDraftItem {
  path: string;
  title: string;
  authors: string;
  year: string;
  publication: string;
  doi: string;
  categoryId: string;
}

interface ImportConfirmationDialogProps {
  open: boolean;
  drafts: ImportDraftItem[];
  categories: LiteratureCategory[];
  working: boolean;
  onDraftChange: (path: string, patch: Partial<ImportDraftItem>) => void;
  onRemoveDraft: (path: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

function userCategories(categories: LiteratureCategory[]) {
  return categories.filter((category) => !category.isSystem);
}

function FieldLabel({ children }: { children: string }) {
  return (
    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-[#8d8d8d]">
      {children}
    </div>
  );
}

function InputField({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-400/10 dark:border-white/10 dark:bg-[#242424] dark:text-[#e0e0e0] dark:placeholder:text-[#8d8d8d]"
    />
  );
}

export default function ImportConfirmationDialog({
  open,
  drafts,
  categories,
  working,
  onDraftChange,
  onRemoveDraft,
  onClose,
  onConfirm,
}: ImportConfirmationDialogProps) {
  const l = useLocaleText();
  const editableCategories = userCategories(categories);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/42 px-4 py-6 backdrop-blur-sm dark:bg-black/56">
      <div className="flex max-h-[min(760px,calc(100vh-32px))] w-[min(1120px,calc(100vw-32px))] flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_36px_120px_rgba(15,23,42,0.28)] dark:border-white/10 dark:bg-[#181818] dark:text-[#e0e0e0]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-white/10">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#8d8d8d]">
              {l('导入确认', 'Import Confirmation')}
            </div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">
              {l('确认 PDF 元数据后再加入文献库', 'Confirm PDF metadata before adding to the library')}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-[#a0a0a0]">
              {l(
                '第一版先从文件名推断标题，你可以在这里补充作者、年份、期刊和 DOI。后续会接入 DOI、Crossref、Semantic Scholar 自动补全。',
                'The first version infers titles from filenames. You can add authors, year, venue, and DOI here. DOI, Crossref, and Semantic Scholar enrichment can be added later.',
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={working}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:opacity-60 dark:border-white/10 dark:bg-[#242424] dark:text-[#a0a0a0] dark:hover:bg-[#2b2b2b]"
            aria-label={l('关闭', 'Close')}
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-4">
            {drafts.map((draft, index) => (
              <section
                key={draft.path}
                className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-[#1e1e1e]"
              >
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-teal-700 dark:text-[#79c6c9]">
                      {l(`文件 ${index + 1}`, `File ${index + 1}`)}
                    </div>
                    <div className="mt-1 truncate text-sm font-medium text-slate-800 dark:text-[#e0e0e0]">
                      {getFileNameFromPath(draft.path)}
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-400 dark:text-[#8d8d8d]">
                      {truncateMiddle(draft.path, 96)}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onRemoveDraft(draft.path)}
                    disabled={working}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-60 dark:border-white/10 dark:bg-[#242424] dark:text-[#a0a0a0] dark:hover:bg-rose-400/10 dark:hover:text-rose-300"
                  >
                    {l('移除', 'Remove')}
                  </button>
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_120px]">
                  <label>
                    <FieldLabel>{l('标题', 'Title')}</FieldLabel>
                    <InputField
                      value={draft.title}
                      onChange={(value) => onDraftChange(draft.path, { title: value })}
                    />
                  </label>

                  <label>
                    <FieldLabel>{l('作者', 'Authors')}</FieldLabel>
                    <InputField
                      value={draft.authors}
                      placeholder={l('多个作者用逗号分隔', 'Separate with commas')}
                      onChange={(value) => onDraftChange(draft.path, { authors: value })}
                    />
                  </label>

                  <label>
                    <FieldLabel>{l('年份', 'Year')}</FieldLabel>
                    <InputField
                      value={draft.year}
                      placeholder="2026"
                      onChange={(value) => onDraftChange(draft.path, { year: value })}
                    />
                  </label>

                  <label>
                    <FieldLabel>{l('期刊 / 会议', 'Venue')}</FieldLabel>
                    <InputField
                      value={draft.publication}
                      onChange={(value) => onDraftChange(draft.path, { publication: value })}
                    />
                  </label>

                  <label>
                    <FieldLabel>DOI</FieldLabel>
                    <InputField
                      value={draft.doi}
                      placeholder="10.xxxx/xxxxx"
                      onChange={(value) => onDraftChange(draft.path, { doi: value })}
                    />
                  </label>

                  <label>
                    <FieldLabel>{l('目标分类', 'Target Category')}</FieldLabel>
                    <select
                      value={draft.categoryId}
                      onChange={(event) => onDraftChange(draft.path, { categoryId: event.target.value })}
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-400/10 dark:border-white/10 dark:bg-[#242424] dark:text-[#e0e0e0]"
                    >
                      <option value="">{l('不指定分类', 'No Category')}</option>
                      {editableCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>
            ))}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-4 dark:border-white/10">
          <div className="text-sm text-slate-500 dark:text-[#a0a0a0]">
            {l(`待导入 ${drafts.length} 个 PDF`, `${drafts.length} PDFs pending import`)}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={working}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-white/10 dark:bg-[#242424] dark:text-[#e0e0e0] dark:hover:bg-[#2b2b2b]"
            >
              {l('取消', 'Cancel')}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={working || drafts.length === 0}
              className="rounded-2xl bg-[#2f7f85] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#286f75] disabled:opacity-60"
            >
              {working ? l('正在导入...', 'Importing...') : l('确认导入', 'Confirm Import')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { BookOpenText, Pencil, Save, Settings2, Star, Trash2, X } from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import type {
  LiteraturePaper,
  UpdatePaperRequest,
} from '../../../types/library';
import { getFileNameFromPath } from '../../../utils/text';
import {
  paperAuthors,
  paperPdfPath,
} from '../literatureUi';

interface LiteraturePaperDetailsProps {
  selectedPaper: LiteraturePaper | null;
  saving: boolean;
  onOpenPaper: (paper: LiteraturePaper) => void;
  onOpenSettings: () => void;
  onSavePaper: (request: UpdatePaperRequest) => void;
  onDeletePaper: (paper: LiteraturePaper) => void;
}

interface PaperEditDraft {
  title: string;
  authors: string;
  year: string;
  publication: string;
  doi: string;
  url: string;
  abstractText: string;
  keywords: string;
  tags: string;
  userNote: string;
  citation: string;
}

function draftFromPaper(paper: LiteraturePaper | null): PaperEditDraft {
  return {
    title: paper?.title ?? '',
    authors: paper?.authors.map((author) => author.name).join(', ') ?? '',
    year: paper?.year ?? '',
    publication: paper?.publication ?? '',
    doi: paper?.doi ?? '',
    url: paper?.url ?? '',
    abstractText: paper?.abstractText ?? '',
    keywords: paper?.keywords.join(', ') ?? '',
    tags: paper?.tags.map((tag) => tag.name).join(', ') ?? '',
    userNote: paper?.userNote ?? '',
    citation: paper?.citation ?? '',
  };
}

function splitList(value: string): string[] {
  return value
    .split(/[;,，；]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function inputValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function FieldLabel({ children }: { children: string }) {
  return (
    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-[#8d8d8d]">
      {children}
    </div>
  );
}

function TextInput({
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

function TextArea({
  value,
  rows = 4,
  placeholder,
  onChange,
}: {
  value: string;
  rows?: number;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-800 outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-400/10 dark:border-white/10 dark:bg-[#242424] dark:text-[#e0e0e0] dark:placeholder:text-[#8d8d8d]"
    />
  );
}

export default function LiteraturePaperDetails({
  selectedPaper,
  saving,
  onOpenPaper,
  onOpenSettings,
  onSavePaper,
  onDeletePaper,
}: LiteraturePaperDetailsProps) {
  const l = useLocaleText();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PaperEditDraft>(() => draftFromPaper(selectedPaper));

  useEffect(() => {
    setEditing(false);
    setDraft(draftFromPaper(selectedPaper));
  }, [selectedPaper?.id]);

  const patchDraft = (patch: Partial<PaperEditDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const handleSave = () => {
    if (!selectedPaper) {
      return;
    }

    onSavePaper({
      paperId: selectedPaper.id,
      title: draft.title.trim() || selectedPaper.title,
      authors: splitList(draft.authors),
      year: inputValue(draft.year),
      publication: inputValue(draft.publication),
      doi: inputValue(draft.doi),
      url: inputValue(draft.url),
      abstractText: inputValue(draft.abstractText),
      keywords: splitList(draft.keywords),
      tags: splitList(draft.tags),
      userNote: inputValue(draft.userNote),
      citation: inputValue(draft.citation),
    });
    setEditing(false);
  };

  const handleToggleFavorite = () => {
    if (!selectedPaper) {
      return;
    }

    onSavePaper({
      paperId: selectedPaper.id,
      isFavorite: !selectedPaper.isFavorite,
    });
  };

  return (
    <aside className="flex min-h-0 flex-col bg-white dark:bg-[#181818]">
      <header className="border-b border-slate-200 px-5 py-4 dark:border-white/10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-[#a0a0a0]">
              {l('文献详情', 'Paper Details')}
            </div>
            <div className="mt-1 text-lg font-semibold">
              {selectedPaper ? l('已选择文献', 'Selected Paper') : l('未选择', 'No Selection')}
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 dark:border-white/10 dark:bg-[#242424] dark:text-[#a0a0a0] dark:hover:bg-[#2b2b2b]"
            title={l('设置', 'Settings')}
          >
            <Settings2 className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {selectedPaper ? (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold leading-7">{selectedPaper.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#a0a0a0]">
                  {paperAuthors(selectedPaper)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggleFavorite}
                  disabled={saving}
                  className={
                    selectedPaper.isFavorite
                      ? 'inline-flex h-9 w-9 items-center justify-center rounded-xl border border-amber-300/70 bg-amber-100 text-amber-700 transition hover:bg-amber-200 disabled:opacity-60 dark:border-amber-300/25 dark:bg-amber-300/14 dark:text-amber-200'
                      : 'inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-50 hover:text-amber-600 disabled:opacity-60 dark:border-white/10 dark:bg-[#242424] dark:text-[#8d8d8d] dark:hover:bg-[#2b2b2b] dark:hover:text-amber-200'
                  }
                  title={selectedPaper.isFavorite ? l('取消收藏', 'Remove from favorites') : l('加入收藏', 'Add to favorites')}
                  aria-label={selectedPaper.isFavorite ? l('取消收藏', 'Remove from favorites') : l('加入收藏', 'Add to favorites')}
                >
                  <Star className="h-4 w-4" fill={selectedPaper.isFavorite ? 'currentColor' : 'none'} strokeWidth={1.9} />
                </button>

                <button
                  type="button"
                  onClick={() => setEditing((current) => !current)}
                  disabled={saving}
                  className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-white/10 dark:bg-[#242424] dark:text-[#e0e0e0] dark:hover:bg-[#2b2b2b]"
                >
                  {editing ? (
                    <X className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.9} />
                  ) : (
                    <Pencil className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.9} />
                  )}
                  {editing ? l('取消', 'Cancel') : l('编辑', 'Edit')}
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onOpenPaper(selectedPaper)}
              disabled={!paperPdfPath(selectedPaper)}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#2f7f85] dark:hover:bg-[#286f75]"
            >
              <BookOpenText className="mr-2 h-4 w-4" strokeWidth={1.9} />
              {l('打开阅读', 'Open Reader')}
            </button>

            {editing ? (
              <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-[#1e1e1e]">
                <label>
                  <FieldLabel>{l('标题', 'Title')}</FieldLabel>
                  <TextInput
                    value={draft.title}
                    onChange={(value) => patchDraft({ title: value })}
                  />
                </label>

                <label>
                  <FieldLabel>{l('作者', 'Authors')}</FieldLabel>
                  <TextInput
                    value={draft.authors}
                    placeholder={l('多个作者用逗号分隔', 'Separate with commas')}
                    onChange={(value) => patchDraft({ authors: value })}
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label>
                    <FieldLabel>{l('年份', 'Year')}</FieldLabel>
                    <TextInput
                      value={draft.year}
                      onChange={(value) => patchDraft({ year: value })}
                    />
                  </label>
                  <label>
                    <FieldLabel>DOI</FieldLabel>
                    <TextInput
                      value={draft.doi}
                      onChange={(value) => patchDraft({ doi: value })}
                    />
                  </label>
                </div>

                <label>
                  <FieldLabel>{l('期刊 / 会议', 'Journal / Conference')}</FieldLabel>
                  <TextInput
                    value={draft.publication}
                    onChange={(value) => patchDraft({ publication: value })}
                  />
                </label>

                <label>
                  <FieldLabel>URL</FieldLabel>
                  <TextInput
                    value={draft.url}
                    onChange={(value) => patchDraft({ url: value })}
                  />
                </label>

                <label>
                  <FieldLabel>{l('摘要', 'Abstract')}</FieldLabel>
                  <TextArea
                    value={draft.abstractText}
                    onChange={(value) => patchDraft({ abstractText: value })}
                  />
                </label>

                <label>
                  <FieldLabel>{l('关键词', 'Keywords')}</FieldLabel>
                  <TextInput
                    value={draft.keywords}
                    placeholder={l('多个关键词用逗号分隔', 'Separate with commas')}
                    onChange={(value) => patchDraft({ keywords: value })}
                  />
                </label>

                <label>
                  <FieldLabel>{l('标签', 'Tags')}</FieldLabel>
                  <TextInput
                    value={draft.tags}
                    placeholder={l('多个标签用逗号分隔，例如：Zotero, 综述, 待读', 'Separate with commas, e.g. Zotero, Review, To read')}
                    onChange={(value) => patchDraft({ tags: value })}
                  />
                </label>

                <label>
                  <FieldLabel>{l('用户笔记', 'User Note')}</FieldLabel>
                  <TextArea
                    value={draft.userNote}
                    rows={5}
                    onChange={(value) => patchDraft({ userNote: value })}
                  />
                </label>

                <label>
                  <FieldLabel>{l('引用信息', 'Citation')}</FieldLabel>
                  <TextArea
                    value={draft.citation}
                    rows={3}
                    onChange={(value) => patchDraft({ citation: value })}
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center rounded-2xl bg-[#2f7f85] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#286f75] disabled:opacity-60"
                  >
                    <Save className="mr-2 h-4 w-4" strokeWidth={1.9} />
                    {saving ? l('正在保存...', 'Saving...') : l('保存修改', 'Save Changes')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(draftFromPaper(selectedPaper));
                      setEditing(false);
                    }}
                    disabled={saving}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-white/10 dark:bg-[#242424] dark:text-[#e0e0e0] dark:hover:bg-[#2b2b2b]"
                  >
                    {l('放弃', 'Discard')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <dl className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-white/10 dark:bg-[#1e1e1e]">
                  <div>
                    <dt className="text-xs font-medium text-slate-400 dark:text-[#8d8d8d]">DOI</dt>
                    <dd className="mt-1 break-all text-slate-700 dark:text-[#e0e0e0]">
                      {selectedPaper.doi || l('未填写', 'Not set')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-400 dark:text-[#8d8d8d]">
                      {l('期刊 / 会议', 'Journal / Conference')}
                    </dt>
                    <dd className="mt-1 text-slate-700 dark:text-[#e0e0e0]">
                      {selectedPaper.publication || l('未填写', 'Not set')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-400 dark:text-[#8d8d8d]">
                      {l('PDF 文件', 'PDF File')}
                    </dt>
                    <dd className="mt-1 break-all text-slate-700 dark:text-[#e0e0e0]">
                      {paperPdfPath(selectedPaper)
                        ? getFileNameFromPath(paperPdfPath(selectedPaper) ?? '')
                        : l('缺少附件', 'Missing attachment')}
                    </dd>
                  </div>
                </dl>

                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-[#8d8d8d]">
                    Abstract
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-[#a0a0a0]">
                    {selectedPaper.abstractText || l('暂未填写摘要。可以点击编辑补充，后续会接入自动元数据补全。', 'No abstract yet. Click Edit to add one. Automatic metadata enrichment can be added later.')}
                  </p>
                </div>

                {selectedPaper.keywords.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedPaper.keywords.map((keyword) => (
                      <span
                        key={keyword}
                        className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-white/[0.06] dark:text-[#cfcfcf]"
                      >
                        {keyword}
                      </span>
                    ))}
                  </div>
                ) : null}

                {selectedPaper.tags.length > 0 ? (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-[#8d8d8d]">
                      {l('标签', 'Tags')}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedPaper.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="rounded-full border border-cyan-300/45 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700 dark:border-cyan-300/18 dark:bg-cyan-300/10 dark:text-cyan-100"
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selectedPaper.userNote ? (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-[#8d8d8d]">
                      {l('用户笔记', 'User Note')}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-[#a0a0a0]">
                      {selectedPaper.userNote}
                    </p>
                  </div>
                ) : null}
              </>
            )}

            <button
              type="button"
              onClick={() => onDeletePaper(selectedPaper)}
              disabled={saving}
              className="inline-flex w-full items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200 dark:hover:bg-rose-400/14"
            >
              <Trash2 className="mr-2 h-4 w-4" strokeWidth={1.9} />
              {l('删除文献记录', 'Delete Paper Record')}
            </button>
            <p className="-mt-3 text-xs leading-5 text-slate-400 dark:text-[#8d8d8d]">
              {l('删除只移除数据库记录，不删除磁盘上的 PDF 文件。', 'Deleting only removes the database record; PDF files on disk are not deleted.')}
            </p>
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-white/10 dark:text-[#a0a0a0]">
            {l('选择一篇文献查看详情。', 'Select a paper to view details.')}
          </div>
        )}
      </div>
    </aside>
  );
}

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BookOpenText,
  FileText,
  Languages,
  Pencil,
  Save,
  Settings2,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import type {
  LiteraturePaper,
  UpdatePaperRequest,
} from '../../../types/library';
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
  onRunMineruParse?: (paper: LiteraturePaper) => void;
  onTranslatePaper?: (paper: LiteraturePaper) => void;
  onGenerateSummary?: (paper: LiteraturePaper) => void;
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

type OverviewSectionKey =
  | 'overview'
  | 'background'
  | 'problem'
  | 'approach'
  | 'experiment'
  | 'findings'
  | 'conclusion'
  | 'limitations'
  | 'takeaways'
  | 'keywords';

interface ParsedOverviewSection {
  key: OverviewSectionKey;
  title: string;
  content: string;
}

function resolveOverviewSectionKey(title: string): OverviewSectionKey {
  const normalized = title
    .trim()
    .toLocaleLowerCase()
    .replace(/[：:]/g, '');

  if (/keyword|关键词/.test(normalized)) {
    return 'keywords';
  }

  if (/finding|发现|要点|结论点/.test(normalized)) {
    return 'findings';
  }

  if (/takeaway|阅读建议|启示|要记住/.test(normalized)) {
    return 'takeaways';
  }

  if (/limitation|局限|限制|不足/.test(normalized)) {
    return 'limitations';
  }

  if (/conclusion|结论|总结/.test(normalized)) {
    return 'conclusion';
  }

  if (/experiment|validation|evaluation|setup|实验|验证|评估/.test(normalized)) {
    return 'experiment';
  }

  if (/approach|method|方法|模型|框架/.test(normalized)) {
    return 'approach';
  }

  if (/problem|question|问题|研究问题/.test(normalized)) {
    return 'problem';
  }

  if (/background|背景|动机/.test(normalized)) {
    return 'background';
  }

  return 'overview';
}

function parseOverviewSections(value: string): ParsedOverviewSection[] {
  const normalized = value.replace(/\r\n?/g, '\n').trim();

  if (!normalized) {
    return [];
  }

  const sections: ParsedOverviewSection[] = [];
  let currentTitle = 'Overview';
  let currentKey: OverviewSectionKey = 'overview';
  let currentLines: string[] = [];

  const flush = () => {
    const content = currentLines.join('\n').trim();

    if (!content) {
      currentLines = [];
      return;
    }

    const existingSection = sections.find((section) => section.key === currentKey);

    if (existingSection) {
      existingSection.content = `${existingSection.content}\n${content}`.trim();
    } else {
      sections.push({
        key: currentKey,
        title: currentTitle,
        content,
      });
    }

    currentLines = [];
  };

  for (const line of normalized.split('\n')) {
    const heading = line.match(/^#{1,4}\s+(.+?)\s*$/);

    if (heading) {
      flush();
      currentTitle = heading[1].trim();
      currentKey = resolveOverviewSectionKey(currentTitle);
      continue;
    }

    currentLines.push(line);
  }

  flush();

  return sections.length > 0
    ? sections
    : [
        {
          key: 'overview',
          title: 'Overview',
          content: normalized,
        },
      ];
}

function overviewSectionLabel(
  key: OverviewSectionKey,
  fallbackTitle: string,
  l: <T>(zh: T, en: T) => T,
): string {
  const labels: Record<OverviewSectionKey, string> = {
    overview: l('概览', 'Overview'),
    background: l('背景', 'Background'),
    problem: l('问题', 'Problem'),
    approach: l('方法', 'Approach'),
    experiment: l('实验', 'Experiments'),
    findings: l('发现', 'Findings'),
    conclusion: l('结论', 'Conclusion'),
    limitations: l('局限', 'Limitations'),
    takeaways: l('要点', 'Takeaways'),
    keywords: l('关键词', 'Keywords'),
  };

  return labels[key] || fallbackTitle;
}

function splitOverviewListItems(content: string, key: OverviewSectionKey): string[] {
  const normalized = content.replace(/\r\n?/g, '\n').trim();

  if (!normalized) {
    return [];
  }

  if (key === 'keywords') {
    return normalized
      .split(/[,\n，;；]/)
      .map((item) => item.replace(/^[-*•·]\s*/, '').trim())
      .filter(Boolean);
  }

  return normalized
    .split(/\n+/)
    .map((item) => item.replace(/^(\d+[.)、]\s*|[-*•·]\s*)/, '').trim())
    .filter(Boolean);
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

function ActionButton({
  children,
  icon,
  disabled,
  primary = false,
  onClick,
}: {
  children: ReactNode;
  icon: ReactNode;
  disabled?: boolean;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        primary
          ? 'inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#2f7f85] dark:hover:bg-[#286f75]'
          : 'inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-[#242424] dark:text-[#e0e0e0] dark:hover:border-teal-300/20 dark:hover:bg-teal-300/10 dark:hover:text-teal-100'
      }
    >
      <span className="mr-2">{icon}</span>
      {children}
    </button>
  );
}

export default function LiteraturePaperDetails({
  selectedPaper,
  saving,
  onOpenPaper,
  onOpenSettings,
  onSavePaper,
  onRunMineruParse,
  onTranslatePaper,
  onGenerateSummary,
}: LiteraturePaperDetailsProps) {
  const l = useLocaleText();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PaperEditDraft>(() => draftFromPaper(selectedPaper));
  const [activeOverviewKey, setActiveOverviewKey] = useState<OverviewSectionKey>('overview');

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

  const hasPdf = selectedPaper ? Boolean(paperPdfPath(selectedPaper)) : false;
  const aiSummary = selectedPaper?.aiSummary?.trim() ?? '';
  const overviewSections = useMemo(() => parseOverviewSections(aiSummary), [aiSummary]);
  const activeOverviewSection =
    overviewSections.find((section) => section.key === activeOverviewKey) ?? overviewSections[0];

  useEffect(() => {
    if (overviewSections.length === 0) {
      setActiveOverviewKey('overview');
      return;
    }

    if (!overviewSections.some((section) => section.key === activeOverviewKey)) {
      setActiveOverviewKey(overviewSections[0].key);
    }
  }, [activeOverviewKey, overviewSections]);

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

            <div className="space-y-3">
              <ActionButton
                primary
                disabled={!hasPdf}
                icon={<BookOpenText className="h-4 w-4" strokeWidth={1.9} />}
                onClick={() => onOpenPaper(selectedPaper)}
              >
                {l('打开阅读', 'Open Reader')}
              </ActionButton>

              <div className="grid gap-2 sm:grid-cols-2">
                <ActionButton
                  disabled={!hasPdf || !onRunMineruParse}
                  icon={<Sparkles className="h-4 w-4" strokeWidth={1.9} />}
                  onClick={() => onRunMineruParse?.(selectedPaper)}
                >
                  {l('MinerU 解析', 'MinerU Parse')}
                </ActionButton>
                <ActionButton
                  disabled={!hasPdf || !onTranslatePaper}
                  icon={<Languages className="h-4 w-4" strokeWidth={1.9} />}
                  onClick={() => onTranslatePaper?.(selectedPaper)}
                >
                  {l('全文翻译', 'Translate')}
                </ActionButton>
              </div>

              <ActionButton
                disabled={!hasPdf || !onGenerateSummary}
                icon={<FileText className="h-4 w-4" strokeWidth={1.9} />}
                onClick={() => onGenerateSummary?.(selectedPaper)}
              >
                {l('概览生成', 'Generate Overview')}
              </ActionButton>
            </div>

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
                <dl className="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-white/10 dark:bg-[#1e1e1e]">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-[#8d8d8d]">
                      {l('期刊 / 会议', 'Journal / Conference')}
                    </dt>
                    <dd className="mt-2 text-slate-700 dark:text-[#e0e0e0]">
                      {selectedPaper.publication || l('未填写', 'Not set')}
                    </dd>
                  </div>
                </dl>

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

                <section className="rounded-3xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#1e1e1e]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-[#8d8d8d]">
                      {l('AI 概览', 'AI Overview')}
                    </div>
                    {overviewSections.length > 0 ? (
                      <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-700 dark:border-teal-300/20 dark:bg-teal-300/10 dark:text-teal-100">
                        {l(`${overviewSections.length} 个模块`, `${overviewSections.length} sections`)}
                      </span>
                    ) : null}
                  </div>
                  {activeOverviewSection ? (
                    <div className="mt-3 space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {overviewSections.map((section) => {
                          const label = overviewSectionLabel(section.key, section.title, l);

                          return (
                            <button
                              key={section.key}
                              type="button"
                              onClick={() => setActiveOverviewKey(section.key)}
                              className={
                                activeOverviewSection.key === section.key
                                  ? 'rounded-full border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700 transition dark:border-teal-300/25 dark:bg-teal-300/12 dark:text-teal-100'
                                  : 'rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 dark:border-white/10 dark:bg-[#242424] dark:text-[#a0a0a0] dark:hover:border-teal-300/20 dark:hover:bg-teal-300/10 dark:hover:text-teal-100'
                              }
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-white/10 dark:bg-[#242424]">
                        <div className="text-sm font-semibold text-slate-800 dark:text-[#e0e0e0]">
                          {overviewSectionLabel(
                            activeOverviewSection.key,
                            activeOverviewSection.title,
                            l,
                          )}
                        </div>
                        {[
                          'findings',
                          'takeaways',
                          'keywords',
                        ].includes(activeOverviewSection.key) ||
                        splitOverviewListItems(
                          activeOverviewSection.content,
                          activeOverviewSection.key,
                        ).length > 1 ? (
                          <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600 dark:text-[#cfcfcf]">
                            {splitOverviewListItems(
                              activeOverviewSection.content,
                              activeOverviewSection.key,
                            ).map((item) => (
                              <li key={item} className="flex gap-2">
                                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500 dark:bg-teal-300" />
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-[#cfcfcf]">
                            {activeOverviewSection.content}
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-500 dark:border-white/10 dark:bg-[#242424] dark:text-[#a0a0a0]">
                      {l('点击“概览生成”后，生成结果会显示在这里。', 'After generating an overview, the result will appear here.')}
                    </div>
                  )}
                </section>

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

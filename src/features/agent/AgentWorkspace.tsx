import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Bot,
  BrainCircuit,
  Check,
  CheckCircle2,
  FileSearch,
  FolderTree,
  Loader2,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Tags,
  User,
  WandSparkles,
} from 'lucide-react';
import {
  applyLibraryAgentPlan,
  buildConversationalLibraryAgentPlan,
  loadLibraryAgentModelPreset,
  type LibraryAgentPlan,
  type LibraryAgentTool,
} from '../../services/libraryAgent';
import { listLibraryPapers } from '../../services/library';
import type { LiteraturePaper } from '../../types/library';

interface AgentCapability {
  key: LibraryAgentTool;
  functionName: string;
  title: string;
  description: string;
  icon: typeof WandSparkles;
}

interface AgentChatMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  meta?: string;
}

const agentCapabilities: AgentCapability[] = [
  {
    key: 'rename',
    functionName: 'rename_papers',
    title: '批量重命名',
    description: '添加、替换、规范化或重写论文标题。',
    icon: WandSparkles,
  },
  {
    key: 'metadata',
    functionName: 'update_paper_metadata',
    title: '元数据补全',
    description: '补全标题、作者、年份、期刊、DOI、摘要和关键词。',
    icon: FileSearch,
  },
  {
    key: 'smart-tags',
    functionName: 'update_paper_tags',
    title: '智能标签',
    description: '根据标题、摘要、关键词生成学术标签。',
    icon: Sparkles,
  },
  {
    key: 'clean-tags',
    functionName: 'clean_paper_tags',
    title: '标签清洗',
    description: '合并同义词、大小写变体、重复标签和拼写差异。',
    icon: Tags,
  },
  {
    key: 'classify',
    functionName: 'classify_papers',
    title: '自动归类',
    description: '由模型动态创建 Collection，不使用固定分类表。',
    icon: FolderTree,
  },
];

const promptSuggestions = [
  '把选中的论文标题后面加 123',
  '给这些论文自动补全元数据，只改有把握的字段',
  '清理这些论文的标签，合并同义词并去掉重复项',
  '根据研究主题给这些论文自动归类到新的 Collection',
  '给这些论文生成 3 到 6 个简洁的学术标签',
];

function newMessageId(): string {
  return `agent-message:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function paperAuthors(paper: LiteraturePaper): string {
  return paper.authors.length > 0
    ? paper.authors.map((author) => author.name).join(', ')
    : '未知作者';
}

function formatPaperMeta(paper: LiteraturePaper): string {
  return [paperAuthors(paper), paper.year, paper.publication].filter(Boolean).join(' · ');
}

function toolLabel(tool: LibraryAgentTool): string {
  return agentCapabilities.find((item) => item.key === tool)?.title ?? tool;
}

function paperMatchesQuery(paper: LiteraturePaper, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  const searchableText = [
    paper.title,
    paper.year,
    paper.publication,
    paper.doi,
    paper.url,
    paper.abstractText,
    paperAuthors(paper),
    paper.keywords.join(' '),
    paper.tags.map((tag) => tag.name).join(' '),
  ]
    .filter(Boolean)
    .join('\n')
    .toLocaleLowerCase();

  return searchableText.includes(normalizedQuery);
}

function AgentWorkspace() {
  const [papers, setPapers] = useState<LiteraturePaper[]>([]);
  const [selectedPaperIds, setSelectedPaperIds] = useState<Set<string>>(() => new Set());
  const [paperSearchQuery, setPaperSearchQuery] = useState('');
  const [composerValue, setComposerValue] = useState('把选中的论文标题后面加 123');
  const [agentPresetName, setAgentPresetName] = useState('');
  const [plan, setPlan] = useState<LibraryAgentPlan | null>(null);
  const [approvedItemIds, setApprovedItemIds] = useState<Set<string>>(() => new Set());
  const [messages, setMessages] = useState<AgentChatMessage[]>(() => [
    {
      id: newMessageId(),
      role: 'assistant',
      content:
        '选择左侧文献后，直接用自然语言告诉我你要做什么。我会让大模型自动选择合适的函数工具，先生成可审查计划，再等你确认执行。',
      meta: '支持重命名、元数据补全、智能标签、标签清洗、自动归类',
    },
  ]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const filteredPapers = useMemo(
    () => papers.filter((paper) => paperMatchesQuery(paper, paperSearchQuery)),
    [papers, paperSearchQuery],
  );
  const selectedPapers = useMemo(
    () => papers.filter((paper) => selectedPaperIds.has(paper.id)),
    [papers, selectedPaperIds],
  );
  const selectedPlanItems = useMemo(
    () => plan?.items.filter((item) => approvedItemIds.has(item.id)) ?? [],
    [approvedItemIds, plan],
  );

  const refreshPapers = async () => {
    setLoading(true);
    setError('');

    try {
      const nextPapers = await listLibraryPapers({
        sortBy: 'manual',
        sortDirection: 'asc',
        limit: 1000,
      });

      setPapers(nextPapers);
      setSelectedPaperIds((current) => {
        const nextIds = new Set(nextPapers.map((paper) => paper.id));
        return new Set([...current].filter((id) => nextIds.has(id)));
      });
      setStatusMessage(`已加载 ${nextPapers.length} 篇文献。`);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : '加载文库失败';
      setError(message);
      setStatusMessage(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshPapers();
  }, []);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, working]);

  const togglePaper = (paperId: string) => {
    setSelectedPaperIds((current) => {
      const next = new Set(current);

      if (next.has(paperId)) {
        next.delete(paperId);
      } else {
        next.add(paperId);
      }

      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedPaperIds(new Set(filteredPapers.map((paper) => paper.id)));
  };

  const clearSelection = () => {
    setSelectedPaperIds(new Set());
  };

  const setNextPlan = (nextPlan: LibraryAgentPlan) => {
    setPlan(nextPlan);
    setApprovedItemIds(new Set(nextPlan.items.map((item) => item.id)));
    setStatusMessage(nextPlan.description);
  };

  const appendAssistantMessage = (content: string, meta?: string) => {
    setMessages((current) => [
      ...current,
      {
        id: newMessageId(),
        role: 'assistant',
        content,
        meta,
      },
    ]);
  };

  const runAgent = async (rawInstruction: string) => {
    const instruction = rawInstruction.trim();

    if (!instruction) {
      setError('请输入 Agent 指令。');
      return;
    }

    if (selectedPapers.length === 0) {
      setError('请先在左侧选择至少一篇文献。');
      return;
    }

    setMessages((current) => [
      ...current,
      {
        id: newMessageId(),
        role: 'user',
        content: instruction,
        meta: `作用于 ${selectedPapers.length} 篇文献`,
      },
    ]);
    setComposerValue('');
    setWorking(true);
    setError('');
    setPlan(null);
    setApprovedItemIds(new Set());

    try {
      const preset = loadLibraryAgentModelPreset();

      if (!preset) {
        throw new Error('请先在设置里配置问答/概览模型，Agent 会复用该 OpenAI-compatible 模型配置。');
      }

      setAgentPresetName(preset.label || preset.model);
      setStatusMessage(`正在调用大模型 Agent：${preset.label || preset.model}...`);

      const nextPlan = await buildConversationalLibraryAgentPlan({
        papers: selectedPapers,
        instruction,
        preset,
      });

      setNextPlan(nextPlan);

      if (nextPlan.items.length === 0) {
        appendAssistantMessage(
          `我调用了 ${toolLabel(nextPlan.tool)}，但没有生成需要变更的计划项。`,
          nextPlan.description,
        );
      } else {
        appendAssistantMessage(
          `我已自动选择「${toolLabel(nextPlan.tool)}」，生成 ${nextPlan.items.length} 个可审查计划项。右侧可以逐项勾选，确认后才会写入本地文库。`,
          nextPlan.description,
        );
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : '生成 Agent 计划失败';
      setError(message);
      setStatusMessage(message);
      appendAssistantMessage(
        message.includes('tool call')
          ? '当前模型没有返回 tool call。请换用支持 OpenAI-compatible tools/function calling 的模型。'
          : `生成计划失败：${message}`,
      );
    } finally {
      setWorking(false);
    }
  };

  const submitPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAgent(composerValue);
  };

  const applyPlan = async () => {
    if (!plan || approvedItemIds.size === 0) {
      setError('没有可执行的计划项。');
      return;
    }

    setWorking(true);
    setError('');
    setStatusMessage(`正在执行 ${approvedItemIds.size} 个计划项...`);

    try {
      const result = await applyLibraryAgentPlan(plan, approvedItemIds);

      await refreshPapers();
      setPlan(null);
      setApprovedItemIds(new Set());
      setStatusMessage(`执行完成：成功 ${result.applied}，失败 ${result.failed}。`);
      appendAssistantMessage(
        `已执行计划：成功 ${result.applied} 项，失败 ${result.failed} 项。`,
        result.failed > 0 ? result.errors.join('\n') : undefined,
      );

      if (result.failed > 0) {
        setError(result.errors.join('\n') || '部分计划项执行失败。');
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : '执行 Agent 计划失败';
      setError(message);
      setStatusMessage(message);
      appendAssistantMessage(`执行计划失败：${message}`);
    } finally {
      setWorking(false);
    }
  };

  const togglePlanItem = (itemId: string) => {
    setApprovedItemIds((current) => {
      const next = new Set(current);

      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }

      return next;
    });
  };

  return (
    <div className="h-full min-h-0 overflow-hidden bg-[radial-gradient(circle_at_top_left,#f8fbff_0,#edf4fb_38%,#e6edf4_100%)] text-slate-900 dark:bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.10),rgba(15,23,42,0.98)_44%,#070b12_100%)] dark:text-chrome-100">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/76 px-5 backdrop-blur-xl dark:border-white/10 dark:bg-chrome-950/78">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-600 dark:text-teal-300">
              PaperQuay Agent
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-950 dark:text-chrome-100">
              对话式文库整理助手
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refreshPapers()}
            disabled={loading || working}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-200 dark:hover:bg-chrome-800"
          >
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} strokeWidth={2} />
            刷新文库
          </button>
        </header>

        <main className="grid min-h-0 flex-1 gap-0 overflow-hidden xl:grid-cols-[360px_minmax(0,1fr)_420px]">
          <aside className="min-h-0 border-r border-slate-200/80 bg-white/68 backdrop-blur-xl dark:border-white/10 dark:bg-chrome-950/72">
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-slate-200/70 p-4 dark:border-white/10">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-950 dark:text-white">
                      <BookOpen className="h-4 w-4 text-teal-600 dark:text-teal-300" strokeWidth={2} />
                      选择文献
                    </div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-chrome-400">
                      已选择 {selectedPaperIds.size} / 当前结果 {filteredPapers.length} / 全部 {papers.length}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={selectAllVisible}
                      disabled={filteredPapers.length === 0}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-300"
                    >
                      选择结果
                    </button>
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-300"
                    >
                      清空
                    </button>
                  </div>
                </div>

                <label className="mt-4 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/86 px-3 py-2 text-sm text-slate-600 shadow-sm dark:border-white/10 dark:bg-chrome-900/80 dark:text-chrome-300">
                  <Search className="h-4 w-4 shrink-0 text-slate-400 dark:text-chrome-500" strokeWidth={2} />
                  <input
                    value={paperSearchQuery}
                    onChange={(event) => setPaperSearchQuery(event.target.value)}
                    placeholder="搜索标题、作者、年份、标签..."
                    className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-chrome-100 dark:placeholder:text-chrome-500"
                  />
                </label>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {loading ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={2} />
                    正在加载文库...
                  </div>
                ) : papers.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-slate-200 bg-white/70 p-5 text-sm leading-7 text-slate-500 dark:border-white/10 dark:bg-chrome-900/70 dark:text-chrome-400">
                    当前文库为空。先在文库工作区导入 PDF，再回到 Agent 页面批处理。
                  </div>
                ) : filteredPapers.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-slate-200 bg-white/70 p-5 text-sm leading-7 text-slate-500 dark:border-white/10 dark:bg-chrome-900/70 dark:text-chrome-400">
                    没有匹配的文献。换一个关键词再试。
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredPapers.map((paper) => {
                      const selected = selectedPaperIds.has(paper.id);

                      return (
                        <button
                          key={paper.id}
                          type="button"
                          onClick={() => togglePaper(paper.id)}
                          className={[
                            'flex w-full items-start gap-3 rounded-[22px] border p-3 text-left transition',
                            selected
                              ? 'border-teal-300 bg-teal-50/90 shadow-[0_12px_30px_rgba(20,184,166,0.14)] dark:border-teal-300/30 dark:bg-teal-300/10'
                              : 'border-transparent bg-white/72 hover:border-slate-200 hover:bg-white dark:bg-chrome-900/60 dark:hover:border-white/10 dark:hover:bg-chrome-900',
                          ].join(' ')}
                        >
                          <span
                            className={[
                              'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                              selected
                                ? 'border-teal-500 bg-teal-500 text-white'
                                : 'border-slate-300 bg-white text-transparent dark:border-white/20 dark:bg-chrome-950',
                            ].join(' ')}
                          >
                            <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
                          </span>
                          <span className="min-w-0">
                            <span className="line-clamp-2 text-sm font-bold text-slate-950 dark:text-white">
                              {paper.title}
                            </span>
                            <span className="mt-1 block truncate text-xs text-slate-500 dark:text-chrome-400">
                              {formatPaperMeta(paper) || '暂无元数据'}
                            </span>
                            <span className="mt-2 flex flex-wrap gap-1.5">
                              {paper.tags.slice(0, 4).map((tag) => (
                                <span
                                  key={tag.id}
                                  className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500 dark:border-white/10 dark:bg-chrome-950 dark:text-chrome-400"
                                >
                                  {tag.name}
                                </span>
                              ))}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </aside>

          <section className="flex min-h-0 flex-col">
            <div className="border-b border-slate-200/70 bg-white/48 px-5 py-4 backdrop-blur-xl dark:border-white/10 dark:bg-chrome-950/36">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700 dark:border-teal-300/20 dark:bg-teal-300/10 dark:text-teal-200">
                    <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
                    Tool-use with approval
                  </div>
                  <h1 className="mt-3 text-xl font-black tracking-tight text-slate-950 dark:text-white">
                    不用选工具，直接对 Agent 下指令
                  </h1>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-chrome-300">
                    工具说明已内置到 Agent prompt。模型只能返回函数调用参数，右侧生成可审查计划；本地数据库只有在你确认后才会被修改。
                  </p>
                </div>
                <div className="rounded-[22px] border border-slate-200 bg-white/80 px-4 py-3 text-xs leading-5 text-slate-500 dark:border-white/10 dark:bg-chrome-900/70 dark:text-chrome-400">
                  {agentPresetName ? `当前模型：${agentPresetName}` : '复用设置中的问答/概览模型配置'}
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2 2xl:grid-cols-5">
                {agentCapabilities.map((capability) => {
                  const Icon = capability.icon;

                  return (
                    <div
                      key={capability.key}
                      className="rounded-[20px] border border-white/80 bg-white/66 p-3 dark:border-white/10 dark:bg-chrome-900/54"
                    >
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                        <Icon className="h-3.5 w-3.5 text-teal-600 dark:text-teal-300" strokeWidth={2} />
                        {capability.title}
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-slate-400 dark:text-chrome-500">
                        {capability.functionName}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <div className="mx-auto max-w-4xl space-y-4">
                {messages.map((message) => {
                  const isUser = message.role === 'user';

                  return (
                    <article
                      key={message.id}
                      className={['flex items-start gap-3', isUser ? 'justify-end' : 'justify-start'].join(' ')}
                    >
                      {!isUser ? (
                        <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg dark:bg-teal-300 dark:text-slate-950">
                          <Bot className="h-4.5 w-4.5" strokeWidth={2} />
                        </span>
                      ) : null}
                      <div
                        className={[
                          'max-w-[78%] rounded-[26px] border px-4 py-3 text-sm leading-7 shadow-sm',
                          isUser
                            ? 'border-teal-300 bg-teal-600 text-white dark:border-teal-300/30 dark:bg-teal-300 dark:text-slate-950'
                            : 'border-white/80 bg-white/82 text-slate-700 dark:border-white/10 dark:bg-chrome-900/76 dark:text-chrome-200',
                        ].join(' ')}
                      >
                        <div className="whitespace-pre-wrap">{message.content}</div>
                        {message.meta ? (
                          <div
                            className={[
                              'mt-2 text-xs',
                              isUser ? 'text-teal-50/85 dark:text-slate-700' : 'text-slate-400 dark:text-chrome-500',
                            ].join(' ')}
                          >
                            {message.meta}
                          </div>
                        ) : null}
                      </div>
                      {isUser ? (
                        <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-lg dark:bg-chrome-900 dark:text-chrome-100">
                          <User className="h-4.5 w-4.5" strokeWidth={2} />
                        </span>
                      ) : null}
                    </article>
                  );
                })}

                {working ? (
                  <article className="flex items-start gap-3">
                    <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg dark:bg-teal-300 dark:text-slate-950">
                      <Bot className="h-4.5 w-4.5" strokeWidth={2} />
                    </span>
                    <div className="rounded-[26px] border border-white/80 bg-white/82 px-4 py-3 text-sm leading-7 text-slate-600 shadow-sm dark:border-white/10 dark:bg-chrome-900/76 dark:text-chrome-300">
                      <Loader2 className="mr-2 inline h-4 w-4 animate-spin" strokeWidth={2} />
                      正在让模型选择工具并生成计划...
                    </div>
                  </article>
                ) : null}
              </div>
            </div>

            <div className="border-t border-slate-200/70 bg-white/58 px-5 py-4 backdrop-blur-xl dark:border-white/10 dark:bg-chrome-950/52">
              <div className="mx-auto max-w-4xl">
                <div className="mb-3 flex flex-wrap gap-2">
                  {promptSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setComposerValue(suggestion)}
                      className="rounded-full border border-slate-200 bg-white/82 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 dark:border-white/10 dark:bg-chrome-900/70 dark:text-chrome-300 dark:hover:border-teal-300/30 dark:hover:bg-teal-300/10 dark:hover:text-teal-200"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>

                {error ? (
                  <div className="mb-3 whitespace-pre-wrap rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm leading-6 text-rose-700 dark:border-rose-300/20 dark:bg-rose-400/10 dark:text-rose-200">
                    {error}
                  </div>
                ) : null}

                {statusMessage ? (
                  <div className="mb-3 rounded-[20px] border border-slate-200 bg-white/72 px-4 py-2.5 text-xs text-slate-500 dark:border-white/10 dark:bg-chrome-900/70 dark:text-chrome-400">
                    {statusMessage}
                  </div>
                ) : null}

                <form onSubmit={submitPrompt} className="flex items-end gap-3">
                  <textarea
                    value={composerValue}
                    onChange={(event) => setComposerValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void runAgent(composerValue);
                      }
                    }}
                    className="min-h-[56px] flex-1 resize-none rounded-[24px] border border-slate-200 bg-white/92 px-4 py-3 text-sm leading-6 text-slate-800 shadow-sm outline-none transition focus:border-teal-300 focus:bg-white dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-100 dark:focus:border-teal-300/50"
                    placeholder="例如：把选中的论文标题后面加 123，或者清理标签并自动归类..."
                  />
                  <button
                    type="submit"
                    disabled={working || selectedPapers.length === 0 || !composerValue.trim()}
                    className="inline-flex h-[56px] items-center gap-2 rounded-[22px] bg-slate-950 px-5 text-sm font-bold text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:translate-y-0 disabled:opacity-50 dark:bg-teal-300 dark:text-slate-950 dark:hover:bg-teal-200"
                  >
                    {working ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Send className="h-4 w-4" strokeWidth={2} />}
                    发送
                  </button>
                </form>
              </div>
            </div>
          </section>

          <aside className="min-h-0 border-l border-slate-200/80 bg-white/72 backdrop-blur-xl dark:border-white/10 dark:bg-chrome-950/72">
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-slate-200/70 p-4 dark:border-white/10">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-950 dark:text-white">
                      <BrainCircuit className="h-4 w-4 text-teal-600 dark:text-teal-300" strokeWidth={2} />
                      计划预览
                    </div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-chrome-400">
                      {plan ? `${approvedItemIds.size} / ${plan.items.length} 项待执行` : '尚未生成计划'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void applyPlan()}
                    disabled={!plan || approvedItemIds.size === 0 || working}
                    className="inline-flex items-center gap-2 rounded-2xl bg-teal-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-teal-500 disabled:opacity-60 dark:bg-teal-300 dark:text-slate-950 dark:hover:bg-teal-200"
                  >
                    {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    应用
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {!plan ? (
                  <div className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50/80 p-5 text-sm leading-7 text-slate-500 dark:border-white/10 dark:bg-chrome-900/60 dark:text-chrome-400">
                    对话发送后，Agent 会把工具调用拆成独立计划项。你可以逐项取消勾选，再应用到本地文库。
                  </div>
                ) : plan.items.length === 0 ? (
                  <div className="rounded-[28px] border border-emerald-200 bg-emerald-50/80 p-5 text-sm leading-7 text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-300/10 dark:text-emerald-200">
                    没有需要变更的内容。当前选择已经符合 {toolLabel(plan.tool)} 的策略。
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-chrome-900/70">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-600 dark:text-teal-300">
                        {toolLabel(plan.tool)}
                      </div>
                      <div className="mt-2 text-sm font-bold text-slate-950 dark:text-white">{plan.title}</div>
                      <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-chrome-400">
                        {plan.description}
                      </p>
                    </div>

                    {plan.items.map((item) => {
                      const approved = approvedItemIds.has(item.id);

                      return (
                        <article
                          key={item.id}
                          className={[
                            'rounded-[24px] border p-4 transition',
                            approved
                              ? 'border-teal-200 bg-teal-50/70 dark:border-teal-300/20 dark:bg-teal-300/10'
                              : 'border-slate-200 bg-white/76 opacity-70 dark:border-white/10 dark:bg-chrome-900/60',
                          ].join(' ')}
                        >
                          <div className="flex items-start gap-3">
                            <button
                              type="button"
                              onClick={() => togglePlanItem(item.id)}
                              className={[
                                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                                approved
                                  ? 'border-teal-500 bg-teal-500 text-white'
                                  : 'border-slate-300 bg-white text-transparent dark:border-white/20 dark:bg-chrome-950',
                              ].join(' ')}
                            >
                              <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-bold text-slate-950 dark:text-white">
                                {item.paperTitle}
                              </div>
                              <div className="mt-1 text-xs text-slate-500 dark:text-chrome-400">
                                {item.description}
                              </div>

                              {item.before || item.after ? (
                                <div className="mt-3 space-y-2 text-xs leading-5">
                                  <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-500 dark:border-white/10 dark:bg-chrome-950 dark:text-chrome-400">
                                    {item.before || '空'}
                                  </div>
                                  <div className="flex justify-center text-teal-600 dark:text-teal-300">
                                    <ArrowRight className="h-4 w-4" strokeWidth={2} />
                                  </div>
                                  <div className="rounded-2xl border border-teal-200 bg-white px-3 py-2 text-slate-800 dark:border-teal-300/20 dark:bg-chrome-950 dark:text-chrome-100">
                                    {item.after || '空'}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>

              {plan && plan.items.length > 0 ? (
                <div className="border-t border-slate-200/70 p-4 dark:border-white/10">
                  <div className="mb-3 text-xs text-slate-500 dark:text-chrome-400">
                    将应用 {selectedPlanItems.length} 个已勾选计划项。
                  </div>
                  <button
                    type="button"
                    onClick={() => void applyPlan()}
                    disabled={selectedPlanItems.length === 0 || working}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-teal-300 dark:text-slate-950 dark:hover:bg-teal-200"
                  >
                    {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    确认应用计划
                  </button>
                </div>
              ) : null}
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}

export default AgentWorkspace;

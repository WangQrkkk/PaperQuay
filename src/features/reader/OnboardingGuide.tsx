import clsx from 'clsx';
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Bot,
  CheckCircle2,
  FileText,
  FolderOpen,
  Languages,
  Library,
  MousePointerClick,
  Settings2,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { UiLanguage } from '../../types/reader';

interface SpotlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface OnboardingStep {
  title: string;
  eyebrow: string;
  description: string;
  detail: string;
  targetLabel: string;
  targetSelector?: string;
  requiresTargetClick?: boolean;
  icon: LucideIcon;
}

interface OnboardingGuideProps {
  open: boolean;
  language: UiLanguage;
  stepIndex: number;
  onStepIndexChange: (stepIndex: number) => void;
  onClose: () => void;
  onFinish: () => void;
}

function pickText<T>(language: UiLanguage, zh: T, en: T): T {
  return language === 'en-US' ? en : zh;
}

function buildSteps(language: UiLanguage): OnboardingStep[] {
  return [
    {
      eyebrow: pickText(language, '第 1 步', 'Step 1'),
      title: pickText(language, '认识左侧工作区', 'Understand the workspace rail'),
      description: pickText(
        language,
        '现在 PaperQuay 左侧是工作区入口：文库负责管理和阅读论文，Agent 负责用自然语言批量整理文献。',
        'PaperQuay now uses a workspace rail: Library is for managing and reading papers, while Agent handles natural-language batch operations.',
      ),
      detail: pickText(
        language,
        '新手引导会先停留在文库工作区，完成本地文库、导入、解析、翻译和概览的核心流程，最后再介绍 Agent。',
        'This guide starts in the Library workspace, walks through local library setup, import, parsing, translation, and overview, then introduces Agent.',
      ),
      targetLabel: pickText(language, '文库工作区入口', 'Library workspace entry'),
      targetSelector: '[data-tour="workspace-library"]',
      icon: Library,
    },
    {
      eyebrow: pickText(language, '第 2 步', 'Step 2'),
      title: pickText(language, '打开设置', 'Open Settings'),
      description: pickText(
        language,
        '第一次使用时，先进入设置检查文库来源、模型、MinerU 和翻译配置。',
        'For first use, open Settings to review library sources, models, MinerU, and translation configuration.',
      ),
      detail: pickText(
        language,
        '请点击发光的设置按钮继续。引导会自动进入文库相关配置页。',
        'Click the highlighted Settings button to continue. The guide will open the library-related settings page.',
      ),
      targetLabel: pickText(language, '设置按钮', 'Settings button'),
      targetSelector: '[data-tour="settings"]',
      requiresTargetClick: true,
      icon: Settings2,
    },
    {
      eyebrow: pickText(language, '第 3 步', 'Step 3'),
      title: pickText(language, '配置本地文献存储与可选 Zotero', 'Configure local storage and optional Zotero'),
      description: pickText(
        language,
        'PaperQuay 已经是独立文献管理软件：你可以直接导入 PDF；Zotero 只是可选导入来源。',
        'PaperQuay is now a standalone literature manager: you can import PDFs directly; Zotero is only an optional import source.',
      ),
      detail: pickText(
        language,
        '如果你使用 Zotero，可以在这里自动查找或手动选择 zotero.sqlite 所在目录；独立 PDF 的存储文件夹可在文库侧栏继续设置。',
        'If you use Zotero, auto-detect or select the folder containing zotero.sqlite here. Standalone PDF storage is configured from the Library sidebar.',
      ),
      targetLabel: pickText(language, '文库与 Zotero 设置区', 'Library & Zotero settings'),
      targetSelector: '[data-tour="zotero-settings"]',
      icon: FolderOpen,
    },
    {
      eyebrow: pickText(language, '第 4 步', 'Step 4'),
      title: pickText(language, '回到文库，导入或拖拽 PDF', 'Return to Library and import PDFs'),
      description: pickText(
        language,
        '文库是默认工作区。你可以点击“打开 PDF”、拖拽 PDF 到窗口，或从 Zotero 导入已有分类。',
        'Library is the default workspace. You can click Open PDF, drag PDFs into the window, or import existing Zotero collections.',
      ),
      detail: pickText(
        language,
        '引导模式会暂时只显示内置 Welcome 文档，避免和你已有的文库内容混在一起。',
        'Guide mode temporarily shows only the bundled Welcome document, so it does not mix with your existing library.',
      ),
      targetLabel: pickText(language, '文库来源与导入区', 'Library source and import area'),
      targetSelector: '[data-tour="library-sidebar"]',
      icon: BookOpenText,
    },
    {
      eyebrow: pickText(language, '第 5 步', 'Step 5'),
      title: pickText(language, '查看文献列表和右侧详情', 'Review the paper list and details'),
      description: pickText(
        language,
        '中间区域显示当前分类下的文献，右侧显示 PDF、解析状态、AI 概览和论文详情。',
        'The center pane lists papers in the current collection, and the right side shows PDF state, parsing status, AI overview, and details.',
      ),
      detail: pickText(
        language,
        '真实使用时可以搜索、排序、拖动排序、右键管理标签和分类；这里先以 Welcome 文档演示主流程。',
        'In real use, you can search, sort, drag to reorder, and right-click to manage tags and collections. Here we use the Welcome document for the main flow.',
      ),
      targetLabel: pickText(language, '文献列表', 'Paper list'),
      targetSelector: '[data-tour="paper-list"]',
      icon: MousePointerClick,
    },
    {
      eyebrow: pickText(language, '第 6 步', 'Step 6'),
      title: pickText(language, '先执行 MinerU 解析', 'Run MinerU parsing first'),
      description: pickText(
        language,
        '结构化解析会把 PDF 拆成标题、段落、公式、表格等块，后续翻译、跳转和概览都依赖这些结构。',
        'Structured parsing splits the PDF into headings, paragraphs, equations, tables, and blocks used by translation, jumping, and overview.',
      ),
      detail: pickText(
        language,
        '请点击发光的 MinerU 解析按钮继续。Welcome 使用内置演示数据，不会调用 API。',
        'Click the highlighted MinerU Parse button to continue. Welcome uses bundled demo data and will not call any API.',
      ),
      targetLabel: pickText(language, 'MinerU 解析按钮', 'MinerU Parse button'),
      targetSelector: '[data-tour="overview-mineru-parse"]',
      requiresTargetClick: true,
      icon: Sparkles,
    },
    {
      eyebrow: pickText(language, '第 7 步', 'Step 7'),
      title: pickText(language, '显示全文翻译结果', 'Reveal full-document translation'),
      description: pickText(
        language,
        '全文翻译会按结构块保存译文，便于后续左右对照和段落级跳转。',
        'Full-document translation is stored by structured blocks, which enables side-by-side reading and block-level jumping.',
      ),
      detail: pickText(
        language,
        '请点击发光的全文翻译按钮。这里同样只显示内置演示状态，不调用真实翻译接口。',
        'Click the highlighted full-translation button. This only reveals bundled demo state and does not call a real translation API.',
      ),
      targetLabel: pickText(language, '全文翻译按钮', 'Full translation button'),
      targetSelector: '[data-tour="overview-translate-document"]',
      requiresTargetClick: true,
      icon: Languages,
    },
    {
      eyebrow: pickText(language, '第 8 步', 'Step 8'),
      title: pickText(language, '生成论文概览', 'Generate the paper overview'),
      description: pickText(
        language,
        '概览不是单纯摘要，而是把研究背景、问题、方法、发现和阅读建议整理成结构化卡片。',
        'The overview is more than a summary: it organizes background, problem, method, findings, and reading suggestions into structured cards.',
      ),
      detail: pickText(
        language,
        '请点击发光的生成概览按钮。完成后，引导会自动进入阅读器。',
        'Click the highlighted Generate Overview button. After that, the guide will open the reader automatically.',
      ),
      targetLabel: pickText(language, '生成概览按钮', 'Generate Overview button'),
      targetSelector: '[data-tour="generate-summary"]',
      requiresTargetClick: true,
      icon: FileText,
    },
    {
      eyebrow: pickText(language, '第 9 步', 'Step 9'),
      title: pickText(language, '试一下左右对照跳转', 'Try linked left-right jumping'),
      description: pickText(
        language,
        '阅读器会把 PDF 页面热区和右侧结构块绑定起来，适合快速定位公式、段落和译文。',
        'The reader links PDF hot zones with structured blocks on the right, making it easy to locate formulas, paragraphs, and translations.',
      ),
      detail: pickText(
        language,
        '点 PDF 热区会定位右侧块；点右侧块会跳回对应 PDF 页面和 bbox。',
        'Click a PDF hot zone to locate the right block; click a right-side block to jump back to the PDF page and bbox.',
      ),
      targetLabel: pickText(language, '左右对照阅读区', 'Linked reading area'),
      targetSelector: '[data-tour="linked-reading"]',
      icon: MousePointerClick,
    },
    {
      eyebrow: pickText(language, '第 10 步', 'Step 10'),
      title: pickText(language, '阅读器里的工具入口', 'Reader tools'),
      description: pickText(
        language,
        '阅读器顶部工具里也能打开 JSON、执行 MinerU 解析、全文翻译、清空译文和切换显示状态。',
        'Reader tools can open JSON, run MinerU parsing, translate the document, clear translations, and toggle display state.',
      ),
      detail: pickText(
        language,
        '这里重点认识入口位置。真实使用时，如果按钮不可用，通常是还没有结构块或正在执行任务。',
        'This step focuses on where the entry is. In real use, disabled actions usually mean blocks are missing or a task is running.',
      ),
      targetLabel: pickText(language, '阅读器工具入口', 'Reader tools entry'),
      targetSelector: '[data-tour="reader-tools"]',
      icon: Languages,
    },
    {
      eyebrow: pickText(language, '第 11 步', 'Step 11'),
      title: pickText(language, '概览与问答助手', 'Overview and QA assistant'),
      description: pickText(
        language,
        '概览页和问答助手会跟当前论文绑定。划词翻译、问答模型、概览模型都可以在设置中单独配置。',
        'The overview page and QA assistant are bound to the current paper. Selection translation, QA models, and overview models can be configured separately.',
      ),
      detail: pickText(
        language,
        '如果你想让模型基于全文回答，先完成解析；如果只是快速理解，可以先看概览卡片。',
        'If you want answers grounded in the full text, parse first. For quick understanding, start with the overview cards.',
      ),
      targetLabel: pickText(language, 'AI 概览 / 助手区', 'AI overview / assistant area'),
      targetSelector: '[data-tour="ai-summary"]',
      icon: Sparkles,
    },
    {
      eyebrow: pickText(language, '最后一步', 'Final step'),
      title: pickText(language, 'Agent 工作区用于批量整理', 'Use Agent for batch library operations'),
      description: pickText(
        language,
        'Agent 是第二个工作区。它可以基于你选择的论文调用工具，生成可审查的重命名、标签清洗、元数据补全和自动归类计划。',
        'Agent is the second workspace. It can call tools over selected papers and produce reviewable plans for renaming, tag cleanup, metadata completion, and classification.',
      ),
      detail: pickText(
        language,
        '引导结束后，你可以点击左侧 Agent 图标，用自然语言让它整理文库；写入本地数据库前都会让你确认。',
        'After the guide, click the Agent icon on the left and describe library tasks in natural language. Local writes require confirmation.',
      ),
      targetLabel: pickText(language, 'Agent 工作区入口', 'Agent workspace entry'),
      targetSelector: '[data-tour="workspace-agent"]',
      icon: Bot,
    },
  ];
}

function getVisibleRect(rect: DOMRect): SpotlightRect | null {
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);

  if (right <= left || bottom <= top) {
    return null;
  }

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function getSpotlightRect(selector?: string): SpotlightRect | null {
  if (!selector) {
    return null;
  }

  const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const visibleRect = getVisibleRect(rect);
      const visibleArea = visibleRect ? visibleRect.width * visibleRect.height : 0;

      return { element, rect, visibleArea };
    })
    .filter(({ rect }) => rect.width > 0 && rect.height > 0)
    .sort((a, b) => b.visibleArea - a.visibleArea);

  const target = candidates[0];

  if (!target) {
    return null;
  }

  if (target.visibleArea === 0) {
    target.element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    return null;
  }

  const rect = target.element.getBoundingClientRect();
  const visibleRect = getVisibleRect(rect);

  if (!visibleRect) {
    return null;
  }

  const padding = Math.min(10, Math.max(4, Math.min(visibleRect.width, visibleRect.height) / 8));
  const left = Math.max(12, visibleRect.left - padding);
  const top = Math.max(12, visibleRect.top - padding);
  const right = Math.min(window.innerWidth - 12, visibleRect.left + visibleRect.width + padding);
  const bottom = Math.min(window.innerHeight - 12, visibleRect.top + visibleRect.height + padding);

  return {
    left,
    top,
    width: Math.max(8, right - left),
    height: Math.max(8, bottom - top),
  };
}

function getCardPosition(rect: SpotlightRect | null) {
  const cardWidth = Math.min(430, window.innerWidth - 32);
  const cardHeight = 372;

  if (!rect) {
    return {
      left: Math.max(16, (window.innerWidth - cardWidth) / 2),
      top: Math.max(16, (window.innerHeight - cardHeight) / 2),
      width: cardWidth,
    };
  }

  const gap = 18;
  const canPlaceRight = rect.left + rect.width + gap + cardWidth <= window.innerWidth - 16;
  const canPlaceLeft = rect.left - gap - cardWidth >= 16;
  const left = canPlaceRight
    ? rect.left + rect.width + gap
    : canPlaceLeft
      ? rect.left - gap - cardWidth
      : Math.min(Math.max(16, rect.left), window.innerWidth - cardWidth - 16);
  const top = Math.min(
    Math.max(16, rect.top + rect.height / 2 - cardHeight / 2),
    Math.max(16, window.innerHeight - cardHeight - 16),
  );

  return { left, top, width: cardWidth };
}

export default function OnboardingGuide({
  open,
  language,
  stepIndex,
  onStepIndexChange,
  onClose,
  onFinish,
}: OnboardingGuideProps) {
  const steps = useMemo(() => buildSteps(language), [language]);
  const safeStepIndex = Math.min(Math.max(stepIndex, 0), steps.length - 1);
  const step = steps[safeStepIndex];
  const [spotlightRect, setSpotlightRect] = useState<SpotlightRect | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const updateSpotlight = () => {
      setSpotlightRect(getSpotlightRect(step.targetSelector));
    };

    updateSpotlight();
    const frameId = window.requestAnimationFrame(updateSpotlight);
    const retryId = window.setInterval(updateSpotlight, 160);
    window.addEventListener('resize', updateSpotlight);
    window.addEventListener('scroll', updateSpotlight, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearInterval(retryId);
      window.removeEventListener('resize', updateSpotlight);
      window.removeEventListener('scroll', updateSpotlight, true);
    };
  }, [open, step.targetSelector]);

  if (!open) {
    return null;
  }

  const Icon = step.icon;
  const isFirstStep = safeStepIndex === 0;
  const isLastStep = safeStepIndex === steps.length - 1;
  const cardPosition = getCardPosition(spotlightRect);
  const l = <T,>(zh: T, en: T) => pickText(language, zh, en);
  const advanceStep = () => {
    if (isLastStep) {
      onFinish();
      return;
    }

    onStepIndexChange(safeStepIndex + 1);
  };
  const clickCurrentTarget = () => {
    if (step.requiresTargetClick && step.targetSelector) {
      const target = document.querySelector<HTMLElement>(step.targetSelector);
      target?.click();
    }

    advanceStep();
  };
  const canUseContinueButton = !step.requiresTargetClick || !spotlightRect;
  const overlayStyle = spotlightRect
    ? {
        boxShadow: `0 0 0 9999px rgba(10, 15, 18, 0.72), 0 0 0 1px rgba(255, 255, 255, 0.36), 0 0 42px rgba(84, 177, 170, 0.54)`,
        left: spotlightRect.left,
        top: spotlightRect.top,
        width: spotlightRect.width,
        height: spotlightRect.height,
      }
    : undefined;

  return (
    <div className="fixed inset-0 z-[80]">
      <div
        className="absolute inset-0 bg-[#111817]/72 dark:bg-[#060808]/78"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      />

      {spotlightRect ? (
        <div
          className="pointer-events-none absolute rounded-[24px] border-2 border-[#7fd1ca] bg-white/18 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.38)] transition-all duration-300 dark:bg-[#9ddbd4]/14"
          style={overlayStyle}
        >
          <div className="absolute -inset-2 rounded-[30px] border border-[#9ddbd4]/55" />
          <div className="absolute inset-0 rounded-[22px] bg-gradient-to-br from-white/20 via-transparent to-[#9ddbd4]/18" />
          <div className="absolute -right-2 -top-2 h-4 w-4 rounded-full bg-[#9ddbd4] shadow-[0_0_24px_rgba(157,219,212,0.95)]" />
        </div>
      ) : null}

      {spotlightRect ? (
        <button
          type="button"
          onClick={clickCurrentTarget}
          className="absolute rounded-[24px] bg-transparent outline-none"
          style={{
            left: spotlightRect.left,
            top: spotlightRect.top,
            width: spotlightRect.width,
            height: spotlightRect.height,
          }}
          aria-label={l('继续新手引导', 'Continue onboarding')}
        />
      ) : null}

      <section
        className="pointer-events-auto absolute overflow-hidden rounded-[28px] border border-[#d7e4e1] bg-[#fbfdfc] shadow-[0_30px_90px_rgba(3,10,12,0.42)] transition-all duration-300 dark:border-white/12 dark:bg-[#181e1d] dark:shadow-[0_30px_90px_rgba(0,0,0,0.62)]"
        style={cardPosition}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(125,209,202,0.18),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.94),rgba(241,247,245,0.98))] dark:bg-[radial-gradient(circle_at_top_right,rgba(125,209,202,0.16),transparent_38%),linear-gradient(180deg,rgba(31,38,37,0.98),rgba(24,30,29,1))]" />
        <div className="absolute right-0 top-0 h-36 w-36 rounded-full bg-[#7fd1ca]/16 blur-3xl dark:bg-[#7fd1ca]/12" />
        <div className="relative px-6 py-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#12201f] text-white shadow-[0_12px_28px_rgba(18,32,31,0.24)] dark:bg-[#9ddbd4] dark:text-[#101817]">
                <Icon className="h-5 w-5" strokeWidth={1.9} />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-teal">
                  {step.eyebrow} / {steps.length}
                </div>
                <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950 dark:text-chrome-50">
                  {step.title}
                </h3>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-2 text-slate-500 transition hover:bg-[#e9f2ef] hover:text-slate-800 dark:text-chrome-300 dark:hover:bg-white/10 dark:hover:text-chrome-50"
              aria-label={l('关闭引导', 'Close guide')}
            >
              <X className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>

          <div className="mt-5 inline-flex items-center rounded-full border border-[#7fd1ca]/35 bg-[#e4f5f2] px-3 py-1 text-xs font-semibold text-[#315a56] dark:border-[#7fd1ca]/28 dark:bg-[#243331] dark:text-[#d8efec]">
            <Sparkles className="mr-1.5 h-3.5 w-3.5 text-accent-teal" strokeWidth={1.9} />
            {spotlightRect
              ? l('正在高亮：', 'Highlighting: ')
              : l('当前界面暂未显示：', 'Not visible right now: ')}
            {step.targetLabel}
          </div>

          <p className="mt-4 text-sm leading-7 text-slate-700 dark:text-chrome-100">
            {step.description}
          </p>
          <div className="mt-4 rounded-2xl border border-[#d7e4e1] bg-white p-4 text-sm leading-6 text-slate-650 shadow-[0_10px_26px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-[#202827] dark:text-chrome-200 dark:shadow-none">
            {step.detail}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            {steps.map((item, index) => (
              <button
                key={item.title}
                type="button"
                onClick={() => onStepIndexChange(index)}
                className={clsx(
                  'h-2.5 rounded-full transition-all',
                  index === safeStepIndex
                    ? 'w-9 bg-accent-teal'
                    : 'w-2.5 bg-[#c9d8d5] hover:bg-[#9db8b3] dark:bg-white/18 dark:hover:bg-white/32',
                )}
                aria-label={l(`跳到第 ${index + 1} 步`, `Go to step ${index + 1}`)}
              />
            ))}
          </div>

          <div className="mt-6 flex flex-col-reverse gap-3 border-t border-[#d7e4e1] pt-5 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 hover:text-rose-700 dark:text-rose-300 dark:hover:bg-rose-400/10 dark:hover:text-rose-200"
            >
              {l('退出新手引导', 'Exit Guide')}
            </button>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => onStepIndexChange(Math.max(0, safeStepIndex - 1))}
                disabled={isFirstStep}
                className="inline-flex items-center justify-center rounded-xl border border-[#d3e0dd] bg-white px-4 py-2.5 text-sm font-medium text-slate-650 transition hover:border-[#aebfba] hover:bg-[#f1f7f5] disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-[#202827] dark:text-chrome-200 dark:hover:bg-white/10"
              >
                <ArrowLeft className="mr-2 h-4 w-4" strokeWidth={1.9} />
                {l('上一步', 'Back')}
              </button>
              <button
                type="button"
                onClick={advanceStep}
                disabled={!canUseContinueButton}
                className="inline-flex items-center justify-center rounded-xl bg-[#12201f] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(18,32,31,0.22)] transition hover:bg-[#203533] disabled:cursor-not-allowed disabled:opacity-55 dark:bg-[#9ddbd4] dark:text-[#101817] dark:shadow-[0_12px_30px_rgba(80,170,164,0.18)] dark:hover:bg-[#b4e8e3]"
              >
                {isLastStep ? (
                  <CheckCircle2 className="mr-2 h-4 w-4" strokeWidth={1.9} />
                ) : (
                  <ArrowRight className="mr-2 h-4 w-4" strokeWidth={1.9} />
                )}
                {isLastStep
                  ? l('完成', 'Finish')
                  : step.requiresTargetClick && spotlightRect
                    ? l('请点击高亮区域', 'Click Highlight')
                    : l('继续', 'Continue')}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

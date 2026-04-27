import clsx from 'clsx';
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  CheckCircle2,
  FileText,
  FolderOpen,
  Languages,
  MessageSquareText,
  MousePointerClick,
  Settings2,
  Sparkles,
  X,
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
  icon: typeof FolderOpen;
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
      title: pickText(language, '先找到设置入口', 'Start from Settings'),
      description: pickText(
        language,
        '新手第一步不是先打开 PDF，而是先进入设置，把文库来源接好。',
        'For first use, start in Settings and connect your library source before opening PDFs.',
      ),
      detail: pickText(
        language,
        '点击发光的设置按钮，引导会自动进入 Zotero 配置页。',
        'Click the highlighted area to continue. The guide will open Settings and move into Zotero setup automatically.',
      ),
      targetLabel: pickText(language, '设置按钮', 'Settings button'),
      targetSelector: '[data-tour="settings"]',
      icon: Settings2,
    },
    {
      eyebrow: pickText(language, '第 2 步', 'Step 2'),
      title: pickText(language, '配置 Zotero 本地文库', 'Configure the local Zotero library'),
      description: pickText(
        language,
        '在“本地库与 Zotero”里，可以自动搜索 Zotero，也可以手动选择包含 zotero.sqlite 的目录。',
        'In Library & Zotero settings, use Auto Detect or manually select the folder that contains zotero.sqlite.',
      ),
      detail: pickText(
        language,
        '配置完后不用手动找页面，下一步会自动关闭设置并回到文库。',
        'After setup, the next step will close Settings and return to the library automatically.',
      ),
      targetLabel: pickText(language, 'Zotero 导入区', 'Zotero import area'),
      targetSelector: '[data-tour="zotero-settings"]',
      icon: FolderOpen,
    },
    {
      eyebrow: pickText(language, '第 3 步', 'Step 3'),
      title: pickText(language, '回到文库，先认识来源', 'Return to the library and review sources'),
      description: pickText(
        language,
        '这里是论文的入口。左侧用来切换最近文档、全部条目、Zotero 分类和独立 PDF。',
        'This is the paper entry point. The left side switches recent papers, all items, Zotero collections, and standalone PDFs.',
      ),
      detail: pickText(
        language,
        '引导已自动关闭设置并回到文库，后面会以一篇论文做演示。',
        'The guide has closed Settings and returned to the library. Next it will use one paper as the demo document.',
      ),
      targetLabel: pickText(language, '文库来源栏', 'Library source sidebar'),
      targetSelector: '[data-tour="library-sidebar"]',
      icon: BookOpenText,
    },
    {
      eyebrow: pickText(language, '第 4 步', 'Step 4'),
      title: pickText(language, '选中一篇论文', 'Select one paper'),
      description: pickText(
        language,
        '中间是论文列表。单击一篇论文会更新右侧预览，双击则进入阅读页。',
        'The center pane is the paper list. Single-click a paper to update the preview; double-click opens the reader.',
      ),
      detail: pickText(
        language,
        '如果文库已有论文，引导会自动选中一篇。没有的话，先完成 Zotero 导入或添加独立 PDF。',
        'If papers exist, the guide selects one automatically. If not, finish Zotero import or add a standalone PDF first.',
      ),
      targetLabel: pickText(language, '论文列表', 'Paper list'),
      targetSelector: '[data-tour="paper-list"]',
      icon: MousePointerClick,
    },
    {
      eyebrow: pickText(language, '第 5 步', 'Step 5'),
      title: pickText(language, '先执行 MinerU 解析', 'Run MinerU parsing first'),
      description: pickText(
        language,
        'Welcome 文档一开始没有解析结果。点击 MinerU 解析后，会直接显示内置结构块。',
        'The Welcome document starts without parsed results. Click MinerU Parse to reveal the bundled structure blocks.',
      ),
      detail: pickText(
        language,
        '必须点击发光的 MinerU 解析按钮才能继续；这是内置演示数据，不会调用 API。',
        'Click the highlighted MinerU Parse button to continue. This uses bundled demo data and does not call any API.',
      ),
      targetLabel: pickText(language, 'MinerU 解析按钮', 'MinerU Parse button'),
      targetSelector: '[data-tour="overview-mineru-parse"]',
      requiresTargetClick: true,
      icon: Sparkles,
    },
    {
      eyebrow: pickText(language, '第 6 步', 'Step 6'),
      title: pickText(language, '再显示全文翻译', 'Reveal the full translation'),
      description: pickText(
        language,
        '解析完成后，全文翻译按钮会可用。点击后会显示 Welcome 的内置译文状态。',
        'After parsing, the Translate Document button becomes available. Click it to reveal the bundled Welcome translation state.',
      ),
      detail: pickText(
        language,
        '这一步同样不调用 API，只是演示全文翻译完成后的概览效果。',
        'This step also does not call any API; it demonstrates how the overview looks after full translation is ready.',
      ),
      targetLabel: pickText(language, '全文翻译按钮', 'Translate Document button'),
      targetSelector: '[data-tour="overview-translate-document"]',
      requiresTargetClick: true,
      icon: Languages,
    },
    {
      eyebrow: pickText(language, '第 7 步', 'Step 7'),
      title: pickText(language, '生成 AI 摘要', 'Generate the AI summary'),
      description: pickText(
        language,
        '摘要也先不显示。点击生成摘要后，概览页会加载内置 AI 摘要。',
        'The summary is also hidden at first. Click Generate Summary to load the bundled AI summary into the overview.',
      ),
      detail: pickText(
        language,
        '点击发光的生成摘要按钮后，引导会自动进入阅读器。',
        'After clicking the highlighted Generate Summary button, the guide will open the reader automatically.',
      ),
      targetLabel: pickText(language, '生成摘要按钮', 'Generate Summary button'),
      targetSelector: '[data-tour="generate-summary"]',
      requiresTargetClick: true,
      icon: Sparkles,
    },
    {
      eyebrow: pickText(language, '第 8 步', 'Step 8'),
      title: pickText(language, '试一下左右对照跳转', 'Try linked left-right jumping'),
      description: pickText(
        language,
        '解析后，PDF 上的热区和右侧结构块使用同一个 blockId 联动。',
        'After parsing, PDF hot zones and right-side blocks are linked by the same blockId.',
      ),
      detail: pickText(
        language,
        '点 PDF 热区会定位右侧块；点右侧块会跳回对应 PDF 页面和 bbox。',
        'Click a PDF hot zone to locate the right block; click a right block to jump back to the PDF page and bbox.',
      ),
      targetLabel: pickText(language, '左右对照阅读区', 'Linked reading area'),
      targetSelector: '[data-tour="linked-reading"]',
      icon: MousePointerClick,
    },
    {
      eyebrow: pickText(language, '第 9 步', 'Step 9'),
      title: pickText(language, '了解划词翻译、AI 模型和 AI 摘要', 'Selection translation, AI model, and AI summary'),
      description: pickText(
        language,
        '右侧问答助手和 AI 摘要会跟当前论文绑定。划选文本后可以做划词翻译，模型和 Key 在设置里配置。',
        'The assistant and AI summary are bound to the current paper. Select text for selection translation; configure models and keys in Settings.',
      ),
      detail: pickText(
        language,
        '这里主要看问答助手和摘要区，真正使用时再输入问题或选中文本。',
        'Focus on the assistant and summary area. In real use, type a question or select text when needed.',
      ),
      targetLabel: pickText(language, 'AI 摘要 / 助手区', 'AI summary / assistant area'),
      targetSelector: '[data-tour="ai-summary"]',
      icon: MessageSquareText,
    },
    {
      eyebrow: pickText(language, '第 10 步', 'Step 10'),
      title: pickText(language, '点击全文翻译', 'Click full-document translation'),
      description: pickText(
        language,
        '全文翻译会按结构块生成译文，保存到当前论文工作区。',
        'Full-document translation translates by structured blocks and stores results in the current paper workspace.',
      ),
      detail: pickText(
        language,
        '入口也在“工具”里。如果按钮不可用，通常是还没有结构块或正在处理。',
        'The entry is also in Tools. If disabled, blocks may be missing or processing may already be running.',
      ),
      targetLabel: pickText(language, '全文翻译入口', 'Full translation entry'),
      targetSelector: '[data-tour="reader-tools"]',
      icon: Languages,
    },
    {
      eyebrow: pickText(language, '第 11 步', 'Step 11'),
      title: pickText(language, '看译文块并演示跳转', 'Review translated blocks and jumping'),
      description: pickText(
        language,
        '翻译完成后，右侧结构块会显示译文。原文、译文和当前激活块会一起联动。',
        'After translation, the right-side blocks show translated text. Source text, translations, and the active block stay linked.',
      ),
      detail: pickText(
        language,
        '这一步重点看右侧结构块：点击译文块仍然可以跳回 PDF。',
        'Focus on the right block pane: clicking a translated block still jumps back to the PDF.',
      ),
      targetLabel: pickText(language, '结构块与译文区', 'Block and translation pane'),
      targetSelector: '[data-tour="block-translation"]',
      icon: ArrowRight,
    },
    {
      eyebrow: pickText(language, '最后一步', 'Final step'),
      title: pickText(language, '概览页也能解析和翻译', 'Overview can also parse and translate'),
      description: pickText(
        language,
        '引导会自动切回概览页。不进入细读也可以在这里执行 MinerU 解析、全文翻译和摘要生成。',
        'The guide switches back to Overview. You can run MinerU parsing, full translation, and summary generation here without entering close reading.',
      ),
      detail: pickText(
        language,
        '这就是推荐的新手路径：先接入文库，再选论文，然后解析、对照阅读、翻译和摘要。',
        'Recommended path: connect the library, select a paper, then parse, read side by side, translate, and summarize.',
      ),
      targetLabel: pickText(language, '阅读器概览操作', 'Reader overview actions'),
      targetSelector: '[data-tour="overview-actions"]',
      icon: CheckCircle2,
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
  const cardWidth = Math.min(420, window.innerWidth - 32);
  const cardHeight = 360;

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

      if (target) {
        target.click();
      }
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
          aria-label={l('\u7ee7\u7eed\u65b0\u624b\u5f15\u5bfc', 'Continue onboarding')}
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
              {l('\u9000\u51fa\u65b0\u624b\u5f15\u5bfc', 'Exit Guide')}
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
                  ? l('\u5b8c\u6210', 'Finish')
                  : step.requiresTargetClick && spotlightRect
                    ? l('请点击高亮区域', 'Click Highlight')
                    : l('\u7ee7\u7eed', 'Continue')}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

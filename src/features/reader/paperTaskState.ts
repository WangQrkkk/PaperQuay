import type {
  LiteraturePaperTaskKind,
  LiteraturePaperTaskState,
  LiteraturePaperTaskStatus,
} from '../../types/library';
import type { UiLanguage } from '../../types/reader';

function pickLocaleText<T>(locale: UiLanguage, zh: T, en: T): T {
  return locale === 'en-US' ? en : zh;
}

export function getPaperTaskLabel(
  locale: UiLanguage,
  kind: LiteraturePaperTaskKind,
): string {
  switch (kind) {
    case 'mineru':
      return pickLocaleText(locale, 'MinerU 解析', 'MinerU Parse');
    case 'translation':
      return pickLocaleText(locale, '全文翻译', 'Full Translation');
    case 'overview':
      return pickLocaleText(locale, '概览生成', 'Overview Generation');
    default:
      return pickLocaleText(locale, '文档处理', 'Document Processing');
  }
}

export function buildPaperTaskState({
  locale,
  kind,
  status,
  message,
  completed,
  total,
}: {
  locale: UiLanguage;
  kind: LiteraturePaperTaskKind;
  status: LiteraturePaperTaskStatus;
  message: string;
  completed?: number | null;
  total?: number | null;
}): LiteraturePaperTaskState {
  return {
    kind,
    status,
    label: getPaperTaskLabel(locale, kind),
    message,
    completed,
    total,
    updatedAt: Date.now(),
  };
}

export function isPaperTaskRunning(
  state: LiteraturePaperTaskState | null | undefined,
  kind?: LiteraturePaperTaskKind,
): boolean {
  if (!state || state.status !== 'running') {
    return false;
  }

  return kind ? state.kind === kind : true;
}

export function isPaperPipelineBusy(
  state: LiteraturePaperTaskState | null | undefined,
): boolean {
  return isPaperTaskRunning(state);
}

export function isPaperPipelineActionDisabled({
  hasPdf,
  hasHandler,
  actionState,
}: {
  hasPdf: boolean;
  hasHandler: boolean;
  actionState?: LiteraturePaperTaskState | null;
}): boolean {
  return !hasPdf || !hasHandler || isPaperPipelineBusy(actionState);
}

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface WheelDeltaLike {
  deltaY: number;
  deltaMode?: number;
}

export function normalizeWheelDelta(
  event: WheelDeltaLike,
  lineHeight = 16,
  pageHeight = 800,
): number {
  if (!Number.isFinite(event.deltaY)) {
    return 0;
  }

  if (event.deltaMode === 1) {
    return event.deltaY * lineHeight;
  }

  if (event.deltaMode === 2) {
    return event.deltaY * pageHeight;
  }

  return event.deltaY;
}

export function canScrollInDirection(
  metrics: ScrollMetrics,
  deltaY: number,
): boolean {
  if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 0.5) {
    return false;
  }

  const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);

  if (maxScrollTop <= 0) {
    return false;
  }

  if (deltaY > 0) {
    return metrics.scrollTop < maxScrollTop - 0.5;
  }

  return metrics.scrollTop > 0.5;
}

export function shouldIgnoreWheelDelegation({
  defaultPrevented,
  ctrlKey,
  altKey,
  metaKey,
  deltaY,
}: {
  defaultPrevented: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  deltaY: number;
}): boolean {
  if (defaultPrevented) {
    return true;
  }

  if (ctrlKey || altKey || metaKey) {
    return true;
  }

  if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 0.5) {
    return true;
  }

  return false;
}

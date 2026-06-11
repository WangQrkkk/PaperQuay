import { useEffect, useMemo, useRef, useState } from 'react';
import type { PdfReadingHeatmap, PdfScrollPosition } from '../../types/reader';

export const PDF_READING_HEATMAP_BIN_COUNT = 120;
export const READING_HEAT_MIDPOINT_MS = 5 * 60 * 1000;
export const READING_HEAT_MAX_COLOR_MS = 15 * 60 * 1000;

const READING_SAMPLE_INTERVAL_MS = 1000;
const READING_STABLE_AFTER_MS = 900;
const READING_DISPLAY_UPDATE_AFTER_MS = 4500;
const READING_SAVE_AFTER_MS = 4500;
const MAX_SAMPLE_DELTA_MS = 2200;
const READING_HEAT_BLUE: RgbColor = [96, 165, 250];
const READING_HEAT_PURPLE: RgbColor = [139, 92, 246];
const READING_HEAT_DEEP_PURPLE: RgbColor = [88, 28, 135];

type RgbColor = [number, number, number];

function clampUnit(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function interpolateColor(from: RgbColor, to: RgbColor, ratio: number): RgbColor {
  const progress = clampUnit(ratio);

  return [
    Math.round(from[0] + (to[0] - from[0]) * progress),
    Math.round(from[1] + (to[1] - from[1]) * progress),
    Math.round(from[2] + (to[2] - from[2]) * progress),
  ];
}

function formatRgbColor(color: RgbColor) {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

export function getReadingHeatStrength(valueMs: number) {
  return clampUnit(Math.max(0, valueMs || 0) / READING_HEAT_MAX_COLOR_MS);
}

export function getReadingHeatColor(valueMs: number) {
  const safeValue = Number.isFinite(valueMs) ? Math.max(0, valueMs) : 0;

  if (safeValue <= READING_HEAT_MIDPOINT_MS) {
    return formatRgbColor(
      interpolateColor(
        READING_HEAT_BLUE,
        READING_HEAT_PURPLE,
        safeValue / READING_HEAT_MIDPOINT_MS,
      ),
    );
  }

  return formatRgbColor(
    interpolateColor(
      READING_HEAT_PURPLE,
      READING_HEAT_DEEP_PURPLE,
      (safeValue - READING_HEAT_MIDPOINT_MS) /
        (READING_HEAT_MAX_COLOR_MS - READING_HEAT_MIDPOINT_MS),
    ),
  );
}

export function buildReadingHeatGradientStops(values: number[]) {
  if (values.length === 0) {
    return [
      { offset: '0%', color: getReadingHeatColor(0) },
      { offset: '100%', color: getReadingHeatColor(0) },
    ];
  }

  if (values.length === 1) {
    const color = getReadingHeatColor(values[0] ?? 0);

    return [
      { offset: '0%', color },
      { offset: '100%', color },
    ];
  }

  return values.map((value, index) => ({
    offset: `${((index / (values.length - 1)) * 100).toFixed(3)}%`,
    color: getReadingHeatColor(value),
  }));
}

function createEmptyHeatmap(sourceKey: string): PdfReadingHeatmap {
  return {
    sourceKey,
    bins: Array.from({ length: PDF_READING_HEATMAP_BIN_COUNT }, () => 0),
    totalMs: 0,
    updatedAt: Date.now(),
  };
}

export function normalizePdfReadingHeatmap(
  heatmap: PdfReadingHeatmap | null | undefined,
  sourceKey: string,
): PdfReadingHeatmap {
  if (!heatmap || heatmap.sourceKey !== sourceKey) {
    return createEmptyHeatmap(sourceKey);
  }

  const bins = Array.from({ length: PDF_READING_HEATMAP_BIN_COUNT }, (_, index) => {
    const value = heatmap.bins[index];

    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.round(value)
      : 0;
  });
  const totalMs =
    typeof heatmap.totalMs === 'number' && Number.isFinite(heatmap.totalMs)
      ? Math.max(0, Math.round(heatmap.totalMs))
      : bins.reduce((sum, value) => sum + value, 0);

  return {
    sourceKey,
    bins,
    totalMs,
    updatedAt: heatmap.updatedAt || Date.now(),
  };
}

export function getPdfReadingProgressRatio(position: PdfScrollPosition | null, pageCount: number) {
  if (!position || pageCount <= 0) {
    return 0;
  }

  const page = Math.min(Math.max(1, Math.round(position.page || 1)), pageCount);
  const pageOffsetRatio =
    typeof position.pageOffsetRatio === 'number' && Number.isFinite(position.pageOffsetRatio)
      ? Math.min(1, Math.max(0, position.pageOffsetRatio))
      : 0;
  return Math.min(1, Math.max(0, (page - 1 + pageOffsetRatio) / pageCount));
}

function getReadingBinIndex(position: PdfScrollPosition | null, pageCount: number) {
  if (!position || pageCount <= 0) {
    return -1;
  }

  const progressRatio = Math.min(0.999999, getPdfReadingProgressRatio(position, pageCount));

  return Math.min(
    PDF_READING_HEATMAP_BIN_COUNT - 1,
    Math.max(0, Math.floor(progressRatio * PDF_READING_HEATMAP_BIN_COUNT)),
  );
}

interface UsePdfReadingHeatmapOptions {
  sourceKey: string;
  pageCount: number;
  heatmap: PdfReadingHeatmap | null;
  active: boolean;
  displayActive?: boolean;
  getCurrentScrollPosition: () => PdfScrollPosition | null;
  onChange?: (heatmap: PdfReadingHeatmap) => void;
}

export function usePdfReadingHeatmap({
  sourceKey,
  pageCount,
  heatmap,
  active,
  displayActive = true,
  getCurrentScrollPosition,
  onChange,
}: UsePdfReadingHeatmapOptions) {
  const [localHeatmap, setLocalHeatmap] = useState(() =>
    sourceKey ? normalizePdfReadingHeatmap(heatmap, sourceKey) : null,
  );
  const heatmapRef = useRef<PdfReadingHeatmap | null>(localHeatmap);
  const lastBinRef = useRef(-1);
  const lastMovedAtRef = useRef(Date.now());
  const lastSampleAtRef = useRef(Date.now());
  const lastDisplayedAtRef = useRef(0);
  const lastEmittedAtRef = useRef(0);
  const displayActiveRef = useRef(displayActive);

  useEffect(() => {
    const nextHeatmap = sourceKey ? normalizePdfReadingHeatmap(heatmap, sourceKey) : null;

    heatmapRef.current = nextHeatmap;
    setLocalHeatmap(nextHeatmap);
    lastBinRef.current = -1;
    lastMovedAtRef.current = Date.now();
    lastSampleAtRef.current = Date.now();
    lastDisplayedAtRef.current = 0;
    lastEmittedAtRef.current = 0;
  }, [heatmap, sourceKey]);

  useEffect(() => {
    displayActiveRef.current = displayActive;

    if (displayActive) {
      lastDisplayedAtRef.current = Date.now();
      setLocalHeatmap(heatmapRef.current);
    }
  }, [displayActive]);

  useEffect(() => {
    if (!sourceKey || pageCount <= 0 || !active) {
      return undefined;
    }

    const sample = () => {
      const now = Date.now();
      const position = getCurrentScrollPosition();
      const binIndex = getReadingBinIndex(position, pageCount);

      if (binIndex < 0) {
        lastSampleAtRef.current = now;
        return;
      }

      if (binIndex !== lastBinRef.current) {
        lastBinRef.current = binIndex;
        lastMovedAtRef.current = now;
        lastSampleAtRef.current = now;
        return;
      }

      const deltaMs = Math.min(MAX_SAMPLE_DELTA_MS, Math.max(0, now - lastSampleAtRef.current));
      lastSampleAtRef.current = now;

      if (now - lastMovedAtRef.current < READING_STABLE_AFTER_MS || deltaMs <= 0) {
        return;
      }

      const current = heatmapRef.current ?? createEmptyHeatmap(sourceKey);
      const bins = current.bins.slice(0, PDF_READING_HEATMAP_BIN_COUNT);

      while (bins.length < PDF_READING_HEATMAP_BIN_COUNT) {
        bins.push(0);
      }

      bins[binIndex] = Math.round((bins[binIndex] ?? 0) + deltaMs);

      const nextHeatmap: PdfReadingHeatmap = {
        sourceKey,
        bins,
        totalMs: Math.round((current.totalMs || 0) + deltaMs),
        updatedAt: now,
      };

      heatmapRef.current = nextHeatmap;

      if (
        displayActiveRef.current &&
        now - lastDisplayedAtRef.current >= READING_DISPLAY_UPDATE_AFTER_MS
      ) {
        lastDisplayedAtRef.current = now;
        setLocalHeatmap(nextHeatmap);
      }

      if (onChange && now - lastEmittedAtRef.current >= READING_SAVE_AFTER_MS) {
        lastEmittedAtRef.current = now;
        onChange(nextHeatmap);
      }
    };

    const intervalId = window.setInterval(sample, READING_SAMPLE_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);

      const latest = heatmapRef.current;
      if (latest && latest.sourceKey === sourceKey && latest.updatedAt > lastEmittedAtRef.current) {
        onChange?.(latest);
      }
    };
  }, [active, getCurrentScrollPosition, onChange, pageCount, sourceKey]);

  const maxBinMs = useMemo(
    () => Math.max(0, ...(localHeatmap?.bins ?? [])),
    [localHeatmap],
  );

  return {
    heatmap: localHeatmap,
    maxBinMs,
  };
}

export function formatReadingDuration(totalMs: number) {
  const totalSeconds = Math.max(0, Math.round(totalMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

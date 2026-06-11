import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AnnotationEditorType,
  AnnotationMode,
  GlobalWorkerOptions,
  getDocument,
} from 'pdfjs-dist';
import 'pdfjs-dist/web/pdf_viewer.css';
import EmptyState from '../../components/EmptyState';
import { useWheelScrollDelegate } from '../../hooks/useWheelScrollDelegate';
import { approveWritePath, selectSavePdfPath, writeLocalBinaryFile } from '../../services/desktop';
import type {
  PaperAnnotation,
  PdfHighlightTarget,
  PdfBlockSelectContext,
  PdfReadingHeatmap,
  PdfScrollPosition,
  PdfSource,
  PositionedMineruBlock,
  TextSelectionPayload,
} from '../../types/reader';
import {
  bboxToRect,
  isValidBBox,
  shouldCreateHotspot,
  type PageSize,
} from '../../utils/bbox';
import { cn } from '../../utils/cn';
import { useLocaleText } from '../../i18n/uiLanguage';
import { buildPathInDirectory, getParentDirectory, normalizePathForCompare } from '../../utils/path';
import { getFileNameFromPath } from '../../utils/text';
import {
  applyPdfAnnotationToolColors,
  buildPdfJsHighlightColorOptions,
  loadPdfAnnotationToolColors,
  persistPdfAnnotationToolColors,
  type PdfAnnotationColorTool,
} from './annotationColors';
import { buildPdfJsDocumentInit, getPdfSourceSignature } from './pdfDocumentSource';
import { PdfPageOverlay } from './PdfPageOverlay';
import { PdfReadingHeatmapBar } from './PdfReadingHeatmapBar';
import {
  getPdfReadingProgressRatio,
  usePdfReadingHeatmap,
} from './pdfReadingHeatmap';
import { PdfThumbnailSidebar } from './PdfThumbnailSidebar';
import {
  arePageHostsEqual,
  ensurePageOverlayElement,
  getPageElementHeight,
  getPageTargetFromElement,
  getPageTargetFromEvent,
  getRenderedPageSize,
  getScopedSelectionPayload,
  hasActiveTextSelection,
  isAnnotationUiTarget,
  isEditableTarget,
  resolveBlockClientRect,
  resolveHitBlockByPoint,
  resolveNearestBlockByPoint,
  resolveScrollAnchorPage,
  selectionBelongsToContainer,
  type PageHostState,
} from './pdfPageDomUtils';
import {
  buildAnnotatedFileName,
  buildAnnotatedSiblingPath,
  buildScrollRestoreKey,
  buildThumbnailPageIndexes,
  clampScrollRatio,
  isPdfLifecycleCancellation,
  loadStoredBoolean,
  releaseCanvas,
  releasePdfDocument,
  resolveBBoxBaseSize,
} from './pdfViewerUtils';
import {
  PdfViewerToolbar,
  type AnnotationEditorTool,
} from './PdfViewerToolbar';

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const PDF_THUMBNAILS_COLLAPSED_STORAGE_KEY = 'paperquay-pdf-thumbnails-collapsed-v2';
const PDF_READING_HEATMAP_BAR_VISIBLE_STORAGE_KEY =
  'paperquay-pdf-reading-heatmap-bar-visible-v1';
const USER_SCROLL_RESTORE_GUARD_MS = 700;
const SCROLL_EMIT_TRAILING_MS = 360;
const THUMBNAIL_RENDER_IDLE_MS = 420;
const OVERLAY_PAGE_RADIUS = 1;
const PDF_VIEWER_MAX_CANVAS_PIXELS = 5_242_880;

type BBoxPageSizeSource = Pick<
  PositionedMineruBlock | PdfHighlightTarget | PaperAnnotation,
  'bboxCoordinateSystem' | 'bboxPageSize'
> | null;

interface PdfViewerProps {
  source: PdfSource;
  pdfData: Uint8Array | null;
  scrollPosition?: PdfScrollPosition | null;
  readingHeatmap?: PdfReadingHeatmap | null;
  currentPdfName?: string;
  defaultSaveDirectory?: string;
  originalPdfPath?: string;
  translating?: boolean;
  translationProgressCompleted?: number;
  translationProgressTotal?: number;
  hideToolbar?: boolean;
  blocks: PositionedMineruBlock[];
  annotations: PaperAnnotation[];
  activeBlockId: string | null;
  hoveredBlockId: string | null;
  activeHighlight: PdfHighlightTarget | null;
  highlightScrollSignal?: number;
  selectedAnnotationId?: string | null;
  smoothScroll: boolean;
  active?: boolean;
  enableReadingHeatmap?: boolean;
  softPageShadow: boolean;
  onBlockHover: (block: PositionedMineruBlock | null) => void;
  onBlockSelect: (block: PositionedMineruBlock, context?: PdfBlockSelectContext) => void;
  blockClickOpensQuickActions?: boolean;
  onAnnotationSelect?: (annotationId: string) => void;
  onTextSelect?: (selection: TextSelectionPayload) => void;
  onScrollPositionChange?: (position: PdfScrollPosition) => void;
  onReadingHeatmapChange?: (heatmap: PdfReadingHeatmap) => void;
  onSaveSuccess?: (path: string) => void;
}

function resolveToolMode(mode: AnnotationEditorTool) {
  switch (mode) {
    case 'freetext':
      return AnnotationEditorType.FREETEXT;
    case 'ink':
      return AnnotationEditorType.INK;
    case 'none':
    default:
      return AnnotationEditorType.NONE;
  }
}

function sourceNeedsPdfPageSize(source: BBoxPageSizeSource): boolean {
  return Boolean(
    source &&
      source.bboxCoordinateSystem !== 'normalized-1000' &&
      !source.bboxPageSize,
  );
}

function resolveOverlayOriginalPage(
  cachedPageSize: PageSize | undefined,
  renderedPage: PageSize,
  sources: BBoxPageSizeSource[],
): PageSize | null {
  if (cachedPageSize) {
    return cachedPageSize;
  }

  return sources.some(sourceNeedsPdfPageSize) ? null : renderedPage;
}

function setNumberStateIfChanged(
  setter: (value: number | ((current: number) => number)) => void,
  value: number,
) {
  setter((current) => (current === value ? current : value));
}

function setStringStateIfChanged(
  setter: (value: string | ((current: string) => string)) => void,
  value: string,
) {
  setter((current) => (current === value ? current : value));
}

function setBooleanStateIfChanged(
  setter: (value: boolean | ((current: boolean) => boolean)) => void,
  value: boolean,
) {
  setter((current) => (current === value ? current : value));
}

function PdfViewer({
  source,
  pdfData,
  scrollPosition = null,
  readingHeatmap = null,
  currentPdfName = '',
  defaultSaveDirectory = '',
  originalPdfPath = '',
  translating = false,
  translationProgressCompleted = 0,
  translationProgressTotal = 0,
  hideToolbar = false,
  blocks,
  annotations,
  activeBlockId,
  hoveredBlockId,
  activeHighlight,
  highlightScrollSignal = 0,
  selectedAnnotationId = null,
  smoothScroll,
  active = true,
  enableReadingHeatmap = true,
  softPageShadow,
  onBlockHover,
  onBlockSelect,
  blockClickOpensQuickActions = false,
  onAnnotationSelect,
  onTextSelect,
  onScrollPositionChange,
  onReadingHeatmapChange,
  onSaveSuccess,
}: PdfViewerProps) {
  const l = useLocaleText();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const thumbnailSidebarRef = useRef<HTMLElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const loadingTaskRef = useRef<any>(null);
  const pdfViewerRef = useRef<any>(null);
  const pdfDocumentRef = useRef<any>(null);
  const eventBusRef = useRef<any>(null);
  const annotationEditorUiManagerRef = useRef<any>(null);
  const annotationEditorReadyRef = useRef(false);
  const editorToolRef = useRef<AnnotationEditorTool>('none');
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const mutationObserverRef = useRef<MutationObserver | null>(null);
  const observedPageElementsRef = useRef<Set<HTMLDivElement>>(new Set());
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastSelectionRef = useRef<{ text: string; emittedAt: number } | null>(null);
  const lRef = useRef(l);
  const activeRef = useRef(active);
  const pageSizesRef = useRef<Record<number, PageSize>>({});
  const pageThumbnailsRef = useRef<Record<number, string>>({});
  const pageHostsRef = useRef<Record<number, PageHostState>>({});
  const pendingPageSizeRequestsRef = useRef<Set<number>>(new Set());
  const selectionStartedInsideRef = useRef(false);
  const selectionCommitTimerRef = useRef<number | null>(null);
  const pendingBlockSelectTimerRef = useRef<number | null>(null);
  const lastHandledHighlightSignalRef = useRef(highlightScrollSignal);
  const hoveredBlockIdRef = useRef<string | null>(hoveredBlockId);
  const currentPageRef = useRef(1);
  const scrollPositionRef = useRef<PdfScrollPosition | null>(scrollPosition);
  const sourceSignatureRef = useRef('');
  const restoringScrollRef = useRef(false);
  const restoredScrollKeyRef = useRef('');
  const externalScrollRestoreKeyRef = useRef('');
  const pendingScrollRestoreKeyRef = useRef('');
  const lastUserScrollAtRef = useRef(0);

  const [editorTool, setEditorTool] = useState<AnnotationEditorTool>('none');
  const [pageCount, setPageCount] = useState(0);
  const [pageSizes, setPageSizes] = useState<Record<number, PageSize>>({});
  const [pageHosts, setPageHosts] = useState<Record<number, PageHostState>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [readingProgressRatio, setReadingProgressRatio] = useState(0);
  const [zoomLabel, setZoomLabel] = useState('100%');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [documentError, setDocumentError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [hasSelectedEditor, setHasSelectedEditor] = useState(false);
  const [hasLiveTextSelection, setHasLiveTextSelection] = useState(false);
  const [annotationColors, setAnnotationColors] = useState(() => loadPdfAnnotationToolColors());
  const [activeColorTool, setActiveColorTool] = useState<PdfAnnotationColorTool>('highlight');
  const [thumbnailsCollapsed, setThumbnailsCollapsed] = useState(() =>
    loadStoredBoolean(PDF_THUMBNAILS_COLLAPSED_STORAGE_KEY, true),
  );
  const [readingHeatmapBarVisible, setReadingHeatmapBarVisible] = useState(() =>
    loadStoredBoolean(PDF_READING_HEATMAP_BAR_VISIBLE_STORAGE_KEY, true),
  );
  const [pageThumbnails, setPageThumbnails] = useState<Record<number, string>>({});
  const [thumbnailFocusPage, setThumbnailFocusPage] = useState(1);
  const handleThumbnailWheelCapture = useWheelScrollDelegate({ rootRef: thumbnailSidebarRef });

  useEffect(() => {
    lRef.current = l;
  }, [l]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    setZoomLabel((current) =>
      current === 'Fit Width' ? l('Fit Width', 'Fit Width') : current,
    );
  }, [l]);

  const documentInit = useMemo(() => buildPdfJsDocumentInit(source, pdfData), [pdfData, source]);
  const sourceSignature = useMemo(
    () => getPdfSourceSignature(source, currentPdfName),
    [currentPdfName, source],
  );

  useEffect(() => {
    sourceSignatureRef.current = sourceSignature;
    restoredScrollKeyRef.current = '';
    externalScrollRestoreKeyRef.current = '';
    pendingScrollRestoreKeyRef.current = '';
    lastUserScrollAtRef.current = 0;
  }, [sourceSignature]);

  useEffect(() => {
    const currentPosition = scrollPositionRef.current;

    if (!scrollPosition) {
      if (!sourceSignature || currentPosition?.sourceKey !== sourceSignature) {
        scrollPositionRef.current = null;
      }

      return;
    }

    if (scrollPosition.sourceKey !== sourceSignature) {
      return;
    }

    if (
      !currentPosition ||
      currentPosition.sourceKey !== scrollPosition.sourceKey ||
      scrollPosition.updatedAt >= currentPosition.updatedAt
    ) {
      scrollPositionRef.current = scrollPosition;
    }
  }, [scrollPosition, sourceSignature]);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    hoveredBlockIdRef.current = hoveredBlockId;
  }, [hoveredBlockId]);

  const blockById = useMemo(() => {
    const map = new Map<string, PositionedMineruBlock>();

    for (const block of blocks) {
      map.set(block.blockId, block);
    }

    return map;
  }, [blocks]);

  const blocksByPage = useMemo(() => {
    const map = new Map<number, PositionedMineruBlock[]>();

    for (const block of blocks) {
      if (!shouldCreateHotspot(block)) {
        continue;
      }

      const pageBlocks = map.get(block.pageIndex) ?? [];
      pageBlocks.push(block);
      map.set(block.pageIndex, pageBlocks);
    }

    return map;
  }, [blocks]);

  const activeBlock = activeBlockId ? blockById.get(activeBlockId) ?? null : null;
  const hoveredBlock = hoveredBlockId ? blockById.get(hoveredBlockId) ?? null : null;

  const annotationsByPage = useMemo(() => {
    const map = new Map<number, PaperAnnotation[]>();

    for (const annotation of annotations) {
      if (!isValidBBox(annotation.bbox)) {
        continue;
      }

      const pageAnnotations = map.get(annotation.pageIndex) ?? [];
      pageAnnotations.push(annotation);
      map.set(annotation.pageIndex, pageAnnotations);
    }

    return map;
  }, [annotations]);

  const overlayPageIndexes = useMemo(() => {
    const indexes = new Set<number>();
    const currentPageIndex = Math.max(0, currentPage - 1);

    for (
      let pageIndex = Math.max(0, currentPageIndex - OVERLAY_PAGE_RADIUS);
      pageIndex <= Math.min(Math.max(0, pageCount - 1), currentPageIndex + OVERLAY_PAGE_RADIUS);
      pageIndex += 1
    ) {
      indexes.add(pageIndex);
    }

    if (activeBlock) indexes.add(activeBlock.pageIndex);
    if (hoveredBlock) indexes.add(hoveredBlock.pageIndex);
    if (activeHighlight) indexes.add(activeHighlight.pageIndex);

    return Array.from(indexes).sort((left, right) => left - right);
  }, [activeBlock, activeHighlight, currentPage, hoveredBlock, pageCount]);

  const resolvePageOverlaySources = useCallback(
    (pageIndex: number): BBoxPageSizeSource[] => {
      const sources: BBoxPageSizeSource[] = [
        ...(blocksByPage.get(pageIndex) ?? []),
        ...(annotationsByPage.get(pageIndex) ?? []),
      ];

      if (activeBlock?.pageIndex === pageIndex) {
        sources.push(activeBlock);
      }

      if (hoveredBlock?.pageIndex === pageIndex) {
        sources.push(hoveredBlock);
      }

      if (activeHighlight?.pageIndex === pageIndex) {
        sources.push(blockById.get(activeHighlight.blockId) ?? activeHighlight);
      }

      return sources;
    },
    [
      activeBlock,
      activeHighlight,
      annotationsByPage,
      blockById,
      blocksByPage,
      hoveredBlock,
    ],
  );

  const requestPageSize = useCallback((pageIndex: number) => {
    const pdfDocument = pdfDocumentRef.current;

    if (
      !pdfDocument ||
      pageIndex < 0 ||
      pageIndex >= pageCount ||
      pageSizesRef.current[pageIndex] ||
      pendingPageSizeRequestsRef.current.has(pageIndex)
    ) {
      return;
    }

    pendingPageSizeRequestsRef.current.add(pageIndex);

    void pdfDocument
      .getPage(pageIndex + 1)
      .then((page: any) => {
        if (pdfDocumentRef.current !== pdfDocument) {
          page?.cleanup?.();
          return;
        }

        const viewport = page.getViewport({ scale: 1 });
        const pageSize = {
          width: viewport.width,
          height: viewport.height,
        };

        pageSizesRef.current = {
          ...pageSizesRef.current,
          [pageIndex]: pageSize,
        };
        setPageSizes(pageSizesRef.current);
        page?.cleanup?.();
      })
      .catch((pageError: unknown) => {
        if (!isPdfLifecycleCancellation(pageError)) {
          console.debug('[paperquay] Failed to resolve PDF page size', pageIndex + 1, pageError);
        }
      })
      .finally(() => {
        pendingPageSizeRequestsRef.current.delete(pageIndex);
      });
  }, [pageCount]);

  const resolveOriginalPageForSources = useCallback(
    (pageIndex: number, renderedPage: PageSize, sources: BBoxPageSizeSource[]) => {
      const originalPage = resolveOverlayOriginalPage(
        pageSizesRef.current[pageIndex],
        renderedPage,
        sources,
      );

      if (!originalPage) {
        requestPageSize(pageIndex);
      }

      return originalPage;
    },
    [requestPageSize],
  );

  const updateAnnotationToolColor = useCallback(
    (tool: PdfAnnotationColorTool, value: string) => {
      const nextColor = value.trim().toLowerCase();

      setAnnotationColors((current) => {
        if (current[tool] === nextColor) {
          return current;
        }

        return {
          ...current,
          [tool]: nextColor,
        };
      });
    },
    [],
  );

  const syncPageHosts = useCallback(() => {
    const viewer = viewerRef.current;
    const observer = resizeObserverRef.current;

    if (!viewer || !observer) {
      return false;
    }

    const nextHosts: Record<number, PageHostState> = {};
    const nextObservedElements = new Set<HTMLDivElement>();

    viewer.querySelectorAll<HTMLDivElement>('.page').forEach((element) => {
      const pageNumber = Number(element.dataset.pageNumber ?? 0);

      if (!Number.isFinite(pageNumber) || pageNumber <= 0) {
        return;
      }

      const overlayElement = ensurePageOverlayElement(element);
      nextObservedElements.add(element);

      if (!observedPageElementsRef.current.has(element)) {
        observer.observe(element);
      }

      nextHosts[pageNumber - 1] = {
        element,
        overlayElement,
        width: element.clientWidth || element.getBoundingClientRect().width,
        height: element.clientHeight || element.getBoundingClientRect().height,
      };
    });

    for (const element of observedPageElementsRef.current) {
      if (!nextObservedElements.has(element)) {
        observer.unobserve(element);
      }
    }

    observedPageElementsRef.current = nextObservedElements;

    const changed = !arePageHostsEqual(pageHostsRef.current, nextHosts);

    if (changed) {
      pageHostsRef.current = nextHosts;
      setPageHosts(nextHosts);
    }

    return changed;
  }, []);

  const buildCurrentScrollPosition = useCallback((): PdfScrollPosition | null => {
    const container = containerRef.current;
    const viewer = viewerRef.current;

    if (!container || !sourceSignature) {
      return null;
    }

    const { page, pageElement } = resolveScrollAnchorPage(
      container,
      viewer,
      currentPageRef.current || 1,
    );
    const pageHeight = pageElement ? getPageElementHeight(pageElement) : 0;
    const pageOffsetTop = pageElement
      ? Math.max(0, container.scrollTop - pageElement.offsetTop)
      : 0;

    return {
      sourceKey: sourceSignature,
      top: Math.max(0, container.scrollTop),
      left: Math.max(0, container.scrollLeft),
      page,
      pageOffsetTop,
      pageOffsetRatio: pageHeight > 0 ? clampScrollRatio(pageOffsetTop / pageHeight) : undefined,
      pageHeight: pageHeight > 0 ? pageHeight : undefined,
      updatedAt: Date.now(),
    };
  }, [sourceSignature]);

  const updateLocalScrollPosition = useCallback((options?: { syncPageState?: boolean }) => {
    const nextPosition = buildCurrentScrollPosition();

    if (!nextPosition) {
      return null;
    }

    scrollPositionRef.current = nextPosition;
    setNumberStateIfChanged(
      setReadingProgressRatio,
      getPdfReadingProgressRatio(nextPosition, pageCount),
    );

    if (currentPageRef.current !== nextPosition.page) {
      currentPageRef.current = nextPosition.page;

      if (options?.syncPageState !== false) {
        setNumberStateIfChanged(setCurrentPage, nextPosition.page);
      }
    }

    return nextPosition;
  }, [buildCurrentScrollPosition, pageCount]);

  const emitScrollPosition = useCallback((options?: { syncPageState?: boolean }) => {
    if (!onScrollPositionChange) {
      return;
    }

    const nextPosition = updateLocalScrollPosition(options) ?? scrollPositionRef.current;

    if (!nextPosition) {
      return;
    }

    const sourceKey = sourceSignatureRef.current;

    if (!sourceKey || nextPosition.sourceKey !== sourceKey) {
      return;
    }

    onScrollPositionChange(nextPosition);
  }, [onScrollPositionChange, updateLocalScrollPosition]);

  const getSavedScrollPage = useCallback((pagesCount?: number) => {
    const position = scrollPositionRef.current;
    const sourceKey = sourceSignatureRef.current;

    if (!position || !sourceKey || position.sourceKey !== sourceKey) {
      return 1;
    }

    const page = Math.max(1, Math.round(position.page || 1));

    return pagesCount && pagesCount > 0 ? Math.min(page, pagesCount) : page;
  }, []);

  const applySavedScrollPosition = useCallback((options?: { force?: boolean }) => {
    const force = Boolean(options?.force);

    if (!force && Date.now() - lastUserScrollAtRef.current < USER_SCROLL_RESTORE_GUARD_MS) {
      return false;
    }

    const position = scrollPositionRef.current;
    const sourceKey = sourceSignatureRef.current;

    if (!position || !sourceKey || position.sourceKey !== sourceKey) {
      return false;
    }

    const restoreKey = buildScrollRestoreKey(position);

    if (!force && restoredScrollKeyRef.current === restoreKey) {
      return true;
    }

    const container = containerRef.current;
    const viewer = viewerRef.current;

    if (!container || !viewer) {
      return false;
    }

    const page = getSavedScrollPage();
    const pageElement = viewer.querySelector<HTMLDivElement>(
      `.page[data-page-number="${page}"]`,
    );
    const pageHeight = pageElement ? getPageElementHeight(pageElement) : 0;

    if (
      !pageElement ||
      pageHeight <= 0 ||
      (position.top > 0 && container.scrollHeight <= container.clientHeight)
    ) {
      return false;
    }

    const pageOffsetTop =
      typeof position.pageOffsetRatio === 'number' && pageHeight > 0
        ? clampScrollRatio(position.pageOffsetRatio) * pageHeight
        : Math.max(0, position.pageOffsetTop || 0);
    const rawTop = pageElement.offsetTop + pageOffsetTop;
    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    const top = Math.min(Math.max(0, rawTop), maxTop);
    const left = Math.min(Math.max(0, position.left), maxLeft);

    restoringScrollRef.current = true;
    container.scrollTo({ top, left, behavior: 'auto' });
    currentPageRef.current = page;
    setNumberStateIfChanged(setCurrentPage, page);
    restoredScrollKeyRef.current = restoreKey;

    if (pendingScrollRestoreKeyRef.current === restoreKey) {
      pendingScrollRestoreKeyRef.current = '';
    }

    window.setTimeout(() => {
      const appliedPosition = updateLocalScrollPosition({ syncPageState: false });

      if (appliedPosition) {
        restoredScrollKeyRef.current = buildScrollRestoreKey(appliedPosition);
      }

      restoringScrollRef.current = false;
    }, 80);

    return true;
  }, [getSavedScrollPage, updateLocalScrollPosition]);

  const primeSavedScrollPage = useCallback((pdfViewer: any, pagesCount?: number) => {
    const page = getSavedScrollPage(pagesCount);

    currentPageRef.current = page;
    setNumberStateIfChanged(setCurrentPage, page);

    try {
      const viewerPageCount =
        typeof pdfViewer?.pagesCount === 'number' ? pdfViewer.pagesCount : 0;

      if (pdfViewer?.pdfDocument && page > 0 && viewerPageCount >= page) {
        pdfViewer.currentPageNumber = page;
      } else if (pdfViewer?.pdfDocument && page > 0 && '_currentPageNumber' in pdfViewer) {
        pdfViewer._currentPageNumber = page;
      }
    } catch {
      // PDF.js may reject page changes before pages are initialized.
    }

    return page;
  }, [getSavedScrollPage]);

  const restoreSavedScroll = useCallback((options?: { force?: boolean }) => {
    const force = Boolean(options?.force);

    if (!force && Date.now() - lastUserScrollAtRef.current < USER_SCROLL_RESTORE_GUARD_MS) {
      return;
    }

    const position = scrollPositionRef.current;
    const sourceKey = sourceSignatureRef.current;

    if (!position || !sourceKey || position.sourceKey !== sourceKey) {
      return;
    }

    const restoreKey = buildScrollRestoreKey(position);

    if (!force && restoredScrollKeyRef.current === restoreKey) {
      return;
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        applySavedScrollPosition({ force });
      });
    });
  }, [applySavedScrollPosition]);

  const hasPendingExternalScrollRestore = useCallback(() => {
    const pendingRestoreKey = pendingScrollRestoreKeyRef.current;
    const position = scrollPositionRef.current;
    const sourceKey = sourceSignatureRef.current;

    if (!pendingRestoreKey || !position || !sourceKey || position.sourceKey !== sourceKey) {
      return false;
    }

    return pendingRestoreKey === buildScrollRestoreKey(position);
  }, []);

  const retrySavedScrollRestore = useCallback(() => {
    restoreSavedScroll({ force: hasPendingExternalScrollRestore() });
  }, [hasPendingExternalScrollRestore, restoreSavedScroll]);

  const refreshPdfViewerLayout = useCallback(() => {
    const pdfViewer = pdfViewerRef.current;

    if (!activeRef.current || !pdfViewer) {
      return;
    }

    try {
      pdfViewer.update?.();
    } catch {
      // PDF.js can throw while a document is still being attached.
    }

    if (syncPageHosts()) {
      retrySavedScrollRestore();
    }
  }, [retrySavedScrollRestore, syncPageHosts]);

  useEffect(() => {
    if (!scrollPosition || !sourceSignature || scrollPosition.sourceKey !== sourceSignature) {
      return;
    }

    const currentPosition = scrollPositionRef.current;

    if (
      currentPosition &&
      currentPosition.sourceKey === scrollPosition.sourceKey &&
      currentPosition.updatedAt > scrollPosition.updatedAt
    ) {
      return;
    }

    const restoreKey = buildScrollRestoreKey(scrollPosition);

    if (
      externalScrollRestoreKeyRef.current === restoreKey &&
      restoredScrollKeyRef.current === restoreKey
    ) {
      return;
    }

    scrollPositionRef.current = scrollPosition;
    currentPageRef.current = Math.max(1, scrollPosition.page || 1);
    restoredScrollKeyRef.current = '';
    externalScrollRestoreKeyRef.current = restoreKey;
    pendingScrollRestoreKeyRef.current = restoreKey;
    restoreSavedScroll({ force: true });
  }, [restoreSavedScroll, scrollPosition, sourceSignature]);

  const scrollToPage = useCallback(
    (pageIndex: number) => {
      const pageHost = pageHosts[pageIndex]?.element;

      if (pageHost) {
        pageHost.scrollIntoView({
          behavior: smoothScroll ? 'smooth' : 'auto',
          block: 'start',
        });
      } else {
        pdfViewerRef.current?.scrollPageIntoView?.({
          pageNumber: pageIndex + 1,
        });
      }

      currentPageRef.current = pageIndex + 1;
      setNumberStateIfChanged(setCurrentPage, pageIndex + 1);

      window.requestAnimationFrame(() => {
        syncPageHosts();
        window.requestAnimationFrame(syncPageHosts);
      });
    },
    [pageHosts, smoothScroll, syncPageHosts],
  );

  const scrollToReadingProgress = useCallback(
    (progressRatio: number) => {
      const safeRatio = Number.isFinite(progressRatio)
        ? Math.min(0.999999, Math.max(0, progressRatio))
        : 0;
      const targetPageIndex = Math.min(
        Math.max(0, pageCount - 1),
        Math.max(0, Math.floor(safeRatio * Math.max(1, pageCount))),
      );
      const pageHost = pageHosts[targetPageIndex]?.element;
      const container = containerRef.current;

      if (!container || !pageHost || pageCount <= 0) {
        scrollToPage(targetPageIndex);
        return;
      }

      const pageProgress = safeRatio * pageCount - targetPageIndex;
      const top = pageHost.offsetTop + Math.max(0, pageHost.clientHeight * pageProgress);
      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);

      restoringScrollRef.current = true;
      container.scrollTo({
        top: Math.min(Math.max(0, top), maxTop),
        left: container.scrollLeft,
        behavior: smoothScroll ? 'smooth' : 'auto',
      });
      currentPageRef.current = targetPageIndex + 1;
      setNumberStateIfChanged(setCurrentPage, targetPageIndex + 1);
      setNumberStateIfChanged(setReadingProgressRatio, safeRatio);

      window.setTimeout(() => {
        restoringScrollRef.current = false;
        emitScrollPosition();
      }, smoothScroll ? 280 : 80);
    },
    [emitScrollPosition, pageCount, pageHosts, scrollToPage, smoothScroll],
  );

  const { heatmap: localReadingHeatmap, maxBinMs: maxReadingHeatmapBinMs } =
    usePdfReadingHeatmap({
      sourceKey: sourceSignature,
      pageCount,
      heatmap: readingHeatmap,
      active: Boolean(active && enableReadingHeatmap && documentInit && sourceSignature && pageCount > 0 && !loading),
      displayActive: readingHeatmapBarVisible,
      getCurrentScrollPosition: buildCurrentScrollPosition,
      onChange: enableReadingHeatmap ? onReadingHeatmapChange : undefined,
    });

  useEffect(() => {
    setNumberStateIfChanged(
      setReadingProgressRatio,
      getPdfReadingProgressRatio(scrollPositionRef.current, pageCount),
    );
  }, [pageCount, sourceSignature]);

  const scrollToHighlight = useCallback(
    (highlight: PdfHighlightTarget) => {
      const container = containerRef.current;
      const viewer = viewerRef.current;

      if (!container) {
        scrollToPage(highlight.pageIndex);
        return;
      }

      const hostedPage = pageHosts[highlight.pageIndex];
      const pageElement =
        hostedPage?.element ??
        viewer?.querySelector<HTMLDivElement>(
          `.page[data-page-number="${highlight.pageIndex + 1}"]`,
        ) ??
        null;
      const renderedPage = hostedPage
        ? { width: hostedPage.width, height: hostedPage.height }
        : pageElement
          ? getRenderedPageSize(pageElement)
          : null;

      if (!pageElement || !renderedPage) {
        scrollToPage(highlight.pageIndex);
        return;
      }

      const sourceBlock = blockById.get(highlight.blockId) ?? highlight;
      const originalPage = resolveOriginalPageForSources(
        highlight.pageIndex,
        renderedPage,
        [sourceBlock],
      );

      if (!originalPage) {
        scrollToPage(highlight.pageIndex);
        return;
      }

      const targetRect = bboxToRect(
        highlight.bbox,
        resolveBBoxBaseSize(sourceBlock, originalPage),
        renderedPage,
      );
      const viewportLead = Math.min(180, Math.max(72, container.clientHeight * 0.28));
      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      const top = Math.min(Math.max(0, pageElement.offsetTop + targetRect.top - viewportLead), maxTop);
      const left = Math.min(Math.max(0, container.scrollLeft), maxLeft);
      const page = highlight.pageIndex + 1;

      restoringScrollRef.current = true;
      container.scrollTo({
        top,
        left,
        behavior: smoothScroll ? 'smooth' : 'auto',
      });
      currentPageRef.current = page;
      setNumberStateIfChanged(setCurrentPage, page);

      window.requestAnimationFrame(() => {
        syncPageHosts();
        window.requestAnimationFrame(syncPageHosts);
      });

      window.setTimeout(() => {
        restoringScrollRef.current = false;
        emitScrollPosition();
      }, smoothScroll ? 280 : 80);
    },
    [
      blockById,
      emitScrollPosition,
      pageHosts,
      resolveOriginalPageForSources,
      scrollToPage,
      smoothScroll,
      syncPageHosts,
    ],
  );

  useEffect(() => {
    const container = containerRef.current;

    if (!active || !container || !onScrollPositionChange || !sourceSignature) {
      return undefined;
    }

    let trailingTimer = 0;
    let scrollPositionFrame = 0;

    const flushLocalScrollPosition = () => {
      scrollPositionFrame = 0;
      updateLocalScrollPosition();
    };

    const handleScroll = () => {
      if (restoringScrollRef.current) {
        return;
      }

      if (hasPendingExternalScrollRestore()) {
        return;
      }

      lastUserScrollAtRef.current = Date.now();

      if (scrollPositionFrame === 0) {
        scrollPositionFrame = window.requestAnimationFrame(flushLocalScrollPosition);
      }

      if (trailingTimer !== 0) {
        window.clearTimeout(trailingTimer);
      }

      trailingTimer = window.setTimeout(() => {
        trailingTimer = 0;
        emitScrollPosition();
      }, SCROLL_EMIT_TRAILING_MS);
    };

    const cancelPendingExternalRestore = () => {
      pendingScrollRestoreKeyRef.current = '';
    };

    container.addEventListener('wheel', cancelPendingExternalRestore, { passive: true });
    container.addEventListener('pointerdown', cancelPendingExternalRestore, { passive: true });
    container.addEventListener('keydown', cancelPendingExternalRestore);
    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      if (trailingTimer !== 0) {
        window.clearTimeout(trailingTimer);
      }

      if (scrollPositionFrame !== 0) {
        window.cancelAnimationFrame(scrollPositionFrame);
      }

      container.removeEventListener('scroll', handleScroll);
      container.removeEventListener('wheel', cancelPendingExternalRestore);
      container.removeEventListener('pointerdown', cancelPendingExternalRestore);
      container.removeEventListener('keydown', cancelPendingExternalRestore);

      // Do not measure hidden tab DOM during cleanup. The PDF viewer remains mounted,
      // so tab switching preserves the live scroll position without restoring.
    };
  }, [
    emitScrollPosition,
    hasPendingExternalScrollRestore,
    onScrollPositionChange,
    active,
    sourceSignature,
    updateLocalScrollPosition,
  ]);

  const clearSelectionCommitTimer = useCallback(() => {
    if (selectionCommitTimerRef.current !== null) {
      window.clearTimeout(selectionCommitTimerRef.current);
      selectionCommitTimerRef.current = null;
    }
  }, []);

  const clearPendingBlockSelect = useCallback(() => {
    if (pendingBlockSelectTimerRef.current !== null) {
      window.clearTimeout(pendingBlockSelectTimerRef.current);
      pendingBlockSelectTimerRef.current = null;
    }
  }, []);

  const waitForAnnotationEditorMode = useCallback((mode: number, timeout = 240) => {
    return new Promise<void>((resolve) => {
      const pdfViewer = pdfViewerRef.current;
      const eventBus = eventBusRef.current;

      if (pdfViewer?.annotationEditorMode?.mode === mode || !eventBus?.on || !eventBus?.off) {
        resolve();
        return;
      }

      let settled = false;
      const handleModeChanged = (event: { mode?: number }) => {
        if (event.mode === mode) {
          finish();
        }
      };
      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        eventBus.off('annotationeditormodechanged', handleModeChanged);
        window.clearTimeout(timerId);
        resolve();
      };
      const timerId = window.setTimeout(finish, timeout);

      eventBus.on('annotationeditormodechanged', handleModeChanged);
    });
  }, []);

  const emitSelectedText = useCallback(() => {
    if (!activeRef.current || !onTextSelect || editorToolRef.current !== 'none') {
      return;
    }

    window.requestAnimationFrame(() => {
      if (!activeRef.current) {
        return;
      }

      const selection = getScopedSelectionPayload(containerRef.current);

      if (!selection) {
        lastSelectionRef.current = null;
        return;
      }

      const now = Date.now();

      if (
        lastSelectionRef.current &&
        lastSelectionRef.current.text === selection.text &&
        now - lastSelectionRef.current.emittedAt < 250
      ) {
        return;
      }

      lastSelectionRef.current = {
        text: selection.text,
        emittedAt: now,
      };
      onTextSelect(selection);
    });
  }, [onTextSelect]);

  const scheduleSelectionCommit = useCallback(
    (delay = 48) => {
      if (!active || !onTextSelect || editorToolRef.current !== 'none') {
        return;
      }

      clearSelectionCommitTimer();
      selectionCommitTimerRef.current = window.setTimeout(() => {
        selectionCommitTimerRef.current = null;
        emitSelectedText();
      }, delay);
    },
    [active, clearSelectionCommitTimer, emitSelectedText, onTextSelect],
  );

  const handleDeleteSelected = useCallback(() => {
    const uiManager = annotationEditorUiManagerRef.current;

    if (uiManager?.delete) {
      uiManager.delete();
      return;
    }

    eventBusRef.current?.dispatch?.('editingaction', {
      source: pdfViewerRef.current,
      name: 'delete',
    });
  }, []);

  const handleCreatePdfHighlight = useCallback(async () => {
    const pdfViewer = pdfViewerRef.current;
    const uiManager = annotationEditorUiManagerRef.current;

    if (!pdfViewer || !uiManager) {
      setDocumentError(
        lRef.current('PDF annotation tools are not ready yet.', 'PDF annotation tools are not ready yet.'),
      );
      return;
    }

    if (!selectionBelongsToContainer(containerRef.current) || !hasActiveTextSelection()) {
      setDocumentError(
        lRef.current(
          'Select text in the PDF before creating a highlight.',
          'Select text in the PDF before creating a highlight.',
        ),
      );
      return;
    }

    try {
      setDocumentError('');
      setActiveColorTool('highlight');
      clearSelectionCommitTimer();
      clearPendingBlockSelect();

      pdfViewer.annotationEditorMode = {
        mode: AnnotationEditorType.HIGHLIGHT,
        isFromKeyboard: false,
      };
      await waitForAnnotationEditorMode(AnnotationEditorType.HIGHLIGHT);

      uiManager.highlightSelection('paperquay_toolbar');

      pdfViewer.annotationEditorMode = {
        mode: AnnotationEditorType.NONE,
        isFromKeyboard: false,
      };
      await waitForAnnotationEditorMode(AnnotationEditorType.NONE);
      setBooleanStateIfChanged(setHasLiveTextSelection, false);
    } catch (highlightError) {
      setDocumentError(
        highlightError instanceof Error
          ? highlightError.message
          : lRef.current('创建 PDF 高亮失败', 'Failed to create the PDF highlight'),
      );
    }
  }, [
    clearPendingBlockSelect,
    clearSelectionCommitTimer,
    waitForAnnotationEditorMode,
  ]);

  useEffect(() => {
    persistPdfAnnotationToolColors(annotationColors);
  }, [annotationColors]);

  useEffect(() => {
    localStorage.setItem(PDF_THUMBNAILS_COLLAPSED_STORAGE_KEY, String(thumbnailsCollapsed));
  }, [thumbnailsCollapsed]);

  useEffect(() => {
    localStorage.setItem(
      PDF_READING_HEATMAP_BAR_VISIBLE_STORAGE_KEY,
      String(readingHeatmapBarVisible),
    );
  }, [readingHeatmapBarVisible]);

  useEffect(() => {
    pageThumbnailsRef.current = pageThumbnails;
  }, [pageThumbnails]);

  useEffect(() => {
    if (thumbnailsCollapsed) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setThumbnailFocusPage(currentPage);
    }, THUMBNAIL_RENDER_IDLE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [currentPage, thumbnailsCollapsed]);

  useEffect(() => {
    if (!annotationEditorReadyRef.current) {
      return;
    }

    applyPdfAnnotationToolColors(annotationEditorUiManagerRef.current, annotationColors);
  }, [annotationColors]);

  const handleSave = useCallback(async () => {
    const pdfDocument = pdfDocumentRef.current;

    if (!pdfDocument || saving) {
      return;
    }

    try {
      setSaving(true);
      setDocumentError('');
      setSaveMessage('');

      const sourcePath = source?.kind === 'local-path' ? source.path : '';
      const exportDirectory = defaultSaveDirectory.trim();
      const protectedSourcePath = originalPdfPath.trim();
      const suggestedFileName = buildAnnotatedFileName(
        currentPdfName || (sourcePath ? getFileNameFromPath(sourcePath) : 'document.pdf'),
      );
      const targetPath = sourcePath
        ? exportDirectory
          ? buildPathInDirectory(exportDirectory, suggestedFileName)
          : buildAnnotatedSiblingPath(sourcePath)
        : await selectSavePdfPath({
            suggestedFileName,
            initialDirectory:
              exportDirectory || (sourcePath ? getParentDirectory(sourcePath) : undefined),
          });

      if (!targetPath) {
        setSaveMessage(lRef.current('已取消导出批注版 PDF', 'Annotated PDF export canceled'));
        return;
      }

      if (
        protectedSourcePath &&
        normalizePathForCompare(targetPath) === normalizePathForCompare(protectedSourcePath)
      ) {
        throw new Error('Cannot overwrite the original PDF. Save annotations to a separate file.');
      }

      const nextBytes = await pdfDocument.saveDocument();

      if (pdfDocumentRef.current !== pdfDocument) {
        return;
      }

      await approveWritePath(targetPath);
      await writeLocalBinaryFile(targetPath, new Uint8Array(nextBytes));
      const updatingCurrentAnnotatedFile =
        sourcePath && normalizePathForCompare(targetPath) === normalizePathForCompare(sourcePath);
      setSaveMessage(
        updatingCurrentAnnotatedFile
          ? `Updated annotated PDF: ${targetPath}`
          : exportDirectory
            ? `Saved annotated PDF to the paper project folder: ${targetPath}`
            : sourcePath
              ? `Saved annotated PDF next to the original file: ${targetPath}`
              : `Exported annotated PDF: ${targetPath}`,
      );
      onSaveSuccess?.(targetPath);
    } catch (saveError) {
      setDocumentError(
        saveError instanceof Error
          ? saveError.message
          : lRef.current('导出批注版 PDF 失败', 'Failed to export the annotated PDF'),
      );
    } finally {
      setSaving(false);
    }
  }, [currentPdfName, defaultSaveDirectory, onSaveSuccess, originalPdfPath, saving, source]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(() => {
        if (!activeRef.current) {
          return;
        }

        if (syncPageHosts()) {
          retrySavedScrollRestore();
        }
      });
    });
    const mutationObserver = new MutationObserver(() => {
      window.requestAnimationFrame(() => {
        if (!activeRef.current) {
          return;
        }

        if (syncPageHosts()) {
          retrySavedScrollRestore();
        }
      });
    });

    resizeObserverRef.current = observer;
    mutationObserverRef.current = mutationObserver;
    syncPageHosts();
    refreshPdfViewerLayout();

    const viewer = viewerRef.current;

    if (viewer) {
      mutationObserver.observe(viewer, {
        childList: true,
      });
    }

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      observedPageElementsRef.current = new Set();
      resizeObserverRef.current = null;
      mutationObserverRef.current = null;
    };
  }, [active, refreshPdfViewerLayout, retrySavedScrollRestore, syncPageHosts]);

  useEffect(() => {
    if (!active || !documentInit) {
      return undefined;
    }

    let firstFrame = 0;
    let secondFrame = 0;

    firstFrame = window.requestAnimationFrame(() => {
      refreshPdfViewerLayout();
      secondFrame = window.requestAnimationFrame(refreshPdfViewerLayout);
    });

    return () => {
      if (firstFrame !== 0) {
        window.cancelAnimationFrame(firstFrame);
      }

      if (secondFrame !== 0) {
        window.cancelAnimationFrame(secondFrame);
      }
    };
  }, [active, documentInit, refreshPdfViewerLayout]);

  useEffect(() => {
    editorToolRef.current = editorTool;
    const pdfViewer = pdfViewerRef.current;

    if (!pdfViewer || !annotationEditorReadyRef.current) {
      return;
    }

    pdfViewer.annotationEditorMode = {
      mode: resolveToolMode(editorTool),
      isFromKeyboard: false,
    };

    if (editorTool !== 'none') {
      clearSelectionCommitTimer();
      clearPendingBlockSelect();
      window.getSelection()?.removeAllRanges();
      onBlockHover(null);
      setBooleanStateIfChanged(setHasLiveTextSelection, false);
    }
  }, [clearPendingBlockSelect, clearSelectionCommitTimer, editorTool, onBlockHover]);

  useEffect(
    () => () => {
      clearSelectionCommitTimer();
      clearPendingBlockSelect();
    },
    [clearPendingBlockSelect, clearSelectionCommitTimer],
  );

  useEffect(() => {
    if (!active || !hasSelectedEditor) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) {
        return;
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
      }

      event.preventDefault();
      handleDeleteSelected();
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [active, handleDeleteSelected, hasSelectedEditor]);

  useEffect(() => {
    setPageCount(0);
    pageSizesRef.current = {};
    pendingPageSizeRequestsRef.current.clear();
    setPageSizes({});
    pageHostsRef.current = {};
    setPageHosts({});
    const initialPage = getSavedScrollPage();

    currentPageRef.current = initialPage;
    restoredScrollKeyRef.current = '';
    setNumberStateIfChanged(setCurrentPage, initialPage);
    setStringStateIfChanged(setZoomLabel, '100%');
    setSaveMessage('');
    setDocumentError('');
    clearSelectionCommitTimer();
    clearPendingBlockSelect();
  }, [clearPendingBlockSelect, clearSelectionCommitTimer, documentInit, getSavedScrollPage]);

  useEffect(() => {
    const container = containerRef.current;
    const viewer = viewerRef.current;

    if (!container || !viewer || !documentInit) {
      if (!documentInit) {
        setPageCount(0);
        pageHostsRef.current = {};
        setPageHosts({});
        setNumberStateIfChanged(setCurrentPage, 1);
        setStringStateIfChanged(setZoomLabel, '100%');
      }

      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setDocumentError('');

    let eventBus: any = null;
    let handlePagesInit: (() => void) | null = null;
    let handlePageChanging: ((event: { pageNumber?: number }) => void) | null = null;
    let handleScaleChanging: ((event: { scale?: number }) => void) | null = null;
    let handlePageRendered: (() => void) | null = null;
    let handleAnnotationEditorUiManager: ((event: { uiManager?: unknown }) => void) | null = null;
    let handleEditorStatesChanged:
      | ((event: { details?: { hasSelectedEditor?: boolean } }) => void)
      | null = null;

    void import('pdfjs-dist/web/pdf_viewer.mjs')
      .then(async ({ EventBus, PDFLinkService, PDFViewer: PdfJsViewer }) => {
        if (cancelled) {
          return;
        }

        eventBus = new EventBus();
        eventBusRef.current = eventBus;
        const linkService = new PDFLinkService({ eventBus });
        viewer.textContent = '';

        const pdfViewer = new PdfJsViewer({
          container,
          viewer,
          eventBus,
          linkService,
          removePageBorders: true,
          annotationMode: AnnotationMode.ENABLE_FORMS,
          annotationEditorMode: AnnotationEditorType.NONE,
          enableHighlightFloatingButton: false,
          annotationEditorHighlightColors: buildPdfJsHighlightColorOptions(),
          enableHWA: true,
          maxCanvasPixels: PDF_VIEWER_MAX_CANVAS_PIXELS,
        } as any);

        pdfViewerRef.current = pdfViewer;
        linkService.setViewer(pdfViewer);

        handleAnnotationEditorUiManager = (event) => {
          annotationEditorReadyRef.current = true;
          annotationEditorUiManagerRef.current = event.uiManager ?? null;
          applyPdfAnnotationToolColors(annotationEditorUiManagerRef.current, annotationColors);

          pdfViewer.annotationEditorMode = {
            mode: resolveToolMode(editorToolRef.current),
            isFromKeyboard: false,
          };
        };

        handleEditorStatesChanged = (event) => {
          setBooleanStateIfChanged(
            setHasSelectedEditor,
            Boolean(event.details?.hasSelectedEditor),
          );
        };

        handlePagesInit = () => {
          primeSavedScrollPage(pdfViewer, pdfViewer.pagesCount);
          pdfViewer.currentScaleValue = 'page-width';
          pdfViewer.update?.();
          setStringStateIfChanged(setZoomLabel, lRef.current('Fit Width', 'Fit Width'));
          syncPageHosts();
          restoreSavedScroll({ force: true });
          window.requestAnimationFrame(refreshPdfViewerLayout);
        };

        handlePageChanging = (event) => {
          const pageNumber = Math.max(1, Math.round(event.pageNumber ?? 1));
          currentPageRef.current = pageNumber;
          setNumberStateIfChanged(setCurrentPage, pageNumber);
        };

        handleScaleChanging = (event) => {
          const scale = Number(event.scale);
          setStringStateIfChanged(
            setZoomLabel,
            Number.isFinite(scale)
              ? `${Math.round(scale * 100)}%`
              : lRef.current('Fit Width', 'Fit Width'),
          );
        };

        handlePageRendered = () => {
          if (syncPageHosts()) {
            retrySavedScrollRestore();
          }
        };

        eventBus.on('annotationeditoruimanager', handleAnnotationEditorUiManager);
        eventBus.on('annotationeditorstateschanged', handleEditorStatesChanged);
        eventBus.on('pagesinit', handlePagesInit);
        eventBus.on('pagechanging', handlePageChanging);
        eventBus.on('scalechanging', handleScaleChanging);
        eventBus.on('pagerendered', handlePageRendered);

        const loadingTask = getDocument(documentInit as any);
        loadingTaskRef.current = loadingTask;
        const pdfDocument = await loadingTask.promise;

        if (cancelled) {
          releasePdfDocument(pdfDocument);
          return;
        }

        pdfDocumentRef.current = pdfDocument;
        setPageCount(pdfDocument.numPages);

        if (!cancelled && pdfDocumentRef.current === pdfDocument) {
          pdfViewer.setDocument(pdfDocument);
          linkService.setDocument(pdfDocument, null);
          primeSavedScrollPage(pdfViewer, pdfDocument.numPages);
          window.requestAnimationFrame(refreshPdfViewerLayout);
          setLoading(false);
        }
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }

        if (isPdfLifecycleCancellation(loadError)) {
          setLoading(false);
          return;
        }

        setDocumentError(
          loadError instanceof Error
            ? loadError.message
            : lRef.current('PDF 渲染模块加载失败', 'Failed to load the PDF rendering module'),
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
      annotationEditorReadyRef.current = false;
      annotationEditorUiManagerRef.current = null;
      eventBusRef.current = null;
      setBooleanStateIfChanged(setHasSelectedEditor, false);

      if (eventBus && handleAnnotationEditorUiManager) {
        eventBus.off('annotationeditoruimanager', handleAnnotationEditorUiManager);
      }
      if (eventBus && handleEditorStatesChanged) {
        eventBus.off('annotationeditorstateschanged', handleEditorStatesChanged);
      }
      if (eventBus && handlePagesInit) {
        eventBus.off('pagesinit', handlePagesInit);
      }
      if (eventBus && handlePageChanging) {
        eventBus.off('pagechanging', handlePageChanging);
      }
      if (eventBus && handleScaleChanging) {
        eventBus.off('scalechanging', handleScaleChanging);
      }
      if (eventBus && handlePageRendered) {
        eventBus.off('pagerendered', handlePageRendered);
      }

      const pdfDocumentToDestroy = pdfDocumentRef.current;
      pdfDocumentRef.current = null;
      pdfViewerRef.current = null;
      pageThumbnailsRef.current = {};
      setPageThumbnails({});
      viewer.textContent = '';

      const loadingTaskToDestroy = loadingTaskRef.current;
      loadingTaskRef.current = null;

      releasePdfDocument(pdfDocumentToDestroy);

      if (loadingTaskToDestroy?.destroy) {
        void loadingTaskToDestroy.destroy();
      }

      setLoading(false);
    };
  }, [documentInit, refreshPdfViewerLayout]);

  useEffect(() => {
    const pdfDocument = pdfDocumentRef.current;

    if (!pdfDocument || pageCount <= 0) {
      if (Object.keys(pageThumbnailsRef.current).length > 0) {
        pageThumbnailsRef.current = {};
        setPageThumbnails({});
      }
      return;
    }

    if (!active) {
      return;
    }

    if (thumbnailsCollapsed) {
      return;
    }

    let cancelled = false;
    let activeRenderTask: any = null;
    let activeCanvas: HTMLCanvasElement | null = null;
    let activePage: any = null;
    const isCurrentDocument = () => !cancelled && pdfDocumentRef.current === pdfDocument;

    const pageIndexes = buildThumbnailPageIndexes(pageCount, thumbnailFocusPage);

    setPageThumbnails((current) => {
      const nextEntries = Object.entries(current).filter(([pageIndex]) =>
        pageIndexes.includes(Number(pageIndex)),
      );

      const next = Object.fromEntries(nextEntries);
      pageThumbnailsRef.current = next;
      return next;
    });

    const renderThumbnails = async () => {
      for (const pageIndex of pageIndexes) {
        if (!isCurrentDocument()) {
          return;
        }

        if (pageThumbnailsRef.current[pageIndex]) {
          continue;
        }

        let page: any = null;
        let canvas: HTMLCanvasElement | null = null;

        try {
          page = await pdfDocument.getPage(pageIndex + 1);
          activePage = page;

          if (!isCurrentDocument()) {
            return;
          }

          const viewport = page.getViewport({ scale: 1 });
          const targetWidth = 136;
          const scale = targetWidth / Math.max(viewport.width, 1);
          const thumbnailViewport = page.getViewport({ scale });
          canvas = document.createElement('canvas');
          activeCanvas = canvas;
          const context = canvas.getContext('2d', { alpha: false });

          if (!context) {
            continue;
          }

          canvas.width = Math.max(1, Math.floor(thumbnailViewport.width));
          canvas.height = Math.max(1, Math.floor(thumbnailViewport.height));
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);

          const renderTask = page.render({
            canvasContext: context,
            viewport: thumbnailViewport,
          });

          activeRenderTask = renderTask;
          await renderTask.promise;
          activeRenderTask = null;

          if (!isCurrentDocument()) {
            return;
          }

          const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.78);

          setPageThumbnails((current) => {
            if (!isCurrentDocument() || current[pageIndex] === thumbnailUrl) {
              return current;
            }

            const next = {
              ...current,
              [pageIndex]: thumbnailUrl,
            };
            pageThumbnailsRef.current = next;
            return next;
          });
        } catch (thumbnailError) {
          if (!isCurrentDocument() || isPdfLifecycleCancellation(thumbnailError)) {
            return;
          }
        } finally {
          activeRenderTask = null;
          if (canvas) {
            releaseCanvas(canvas);
          }
          page?.cleanup?.();
          if (activeCanvas === canvas) {
            activeCanvas = null;
          }
          if (activePage === page) {
            activePage = null;
          }
        }
      }
    };

    void renderThumbnails();

    return () => {
      cancelled = true;
      try {
        activeRenderTask?.cancel?.();
      } catch {
        // Best-effort cancellation for stale PDF.js thumbnail renders.
      }
      if (activeCanvas) {
        releaseCanvas(activeCanvas);
        activeCanvas = null;
      }
      try {
        activePage?.cleanup?.();
      } catch {
        // Best-effort PDF.js page cleanup.
      }
      activePage = null;
    };
  }, [active, documentInit, pageCount, thumbnailFocusPage, thumbnailsCollapsed]);

  useEffect(() => {
    if (!active || !activeHighlight || highlightScrollSignal === lastHandledHighlightSignalRef.current) {
      return;
    }

    lastHandledHighlightSignalRef.current = highlightScrollSignal;

    window.requestAnimationFrame(() => {
      scrollToHighlight(activeHighlight);
    });
  }, [active, activeHighlight, highlightScrollSignal, scrollToHighlight]);

  useEffect(() => {
    if (!active) {
      return;
    }

    for (const pageIndex of overlayPageIndexes) {
      const host = pageHosts[pageIndex];

      if (!host) {
        continue;
      }

      const renderedPage = {
        width: host.width,
        height: host.height,
      };

      if (renderedPage.width <= 0 || renderedPage.height <= 0) {
        continue;
      }

      const originalPage = resolveOverlayOriginalPage(
        pageSizes[pageIndex],
        renderedPage,
        resolvePageOverlaySources(pageIndex),
      );

      if (!originalPage) {
        requestPageSize(pageIndex);
      }
    }
  }, [
    active,
    overlayPageIndexes,
    pageHosts,
    pageSizes,
    requestPageSize,
    resolvePageOverlaySources,
  ]);

  useEffect(() => {
    if (!active || !onTextSelect) {
      return undefined;
    }

    const isEventInsideContainer = (event: Event) => {
      const container = containerRef.current;
      const target = event.target;

      return Boolean(container && target instanceof Node && container.contains(target));
    };

    const handleSelectionStart = (event: MouseEvent | PointerEvent) => {
      selectionStartedInsideRef.current = isEventInsideContainer(event);

      if (selectionStartedInsideRef.current) {
        clearPendingBlockSelect();
      }
    };

    const handleMouseSelectionCommit = (event: MouseEvent) => {
      if (editorToolRef.current !== 'none') {
        return;
      }

      const shouldReadSelection =
        selectionStartedInsideRef.current || isEventInsideContainer(event);

      selectionStartedInsideRef.current = false;

      if (!shouldReadSelection) {
        return;
      }

      clearPendingBlockSelect();
      scheduleSelectionCommit();
    };

    const handleKeyboardSelectionCommit = (event: KeyboardEvent) => {
      if (editorToolRef.current !== 'none') {
        return;
      }

      if (!isEventInsideContainer(event)) {
        return;
      }

      scheduleSelectionCommit();
    };

    const handleSelectionChange = () => {
      const selectionInside = selectionBelongsToContainer(containerRef.current);
      setBooleanStateIfChanged(
        setHasLiveTextSelection,
        selectionInside && hasActiveTextSelection(),
      );

      if (editorToolRef.current !== 'none') {
        return;
      }

      if (!selectionStartedInsideRef.current && !selectionInside) {
        return;
      }

      clearPendingBlockSelect();
    };

    document.addEventListener('pointerdown', handleSelectionStart);
    document.addEventListener('mousedown', handleSelectionStart);
    document.addEventListener('mouseup', handleMouseSelectionCommit);
    document.addEventListener('keyup', handleKeyboardSelectionCommit);
    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      setBooleanStateIfChanged(setHasLiveTextSelection, false);
      document.removeEventListener('pointerdown', handleSelectionStart);
      document.removeEventListener('mousedown', handleSelectionStart);
      document.removeEventListener('mouseup', handleMouseSelectionCommit);
      document.removeEventListener('keyup', handleKeyboardSelectionCommit);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [active, clearPendingBlockSelect, onTextSelect, scheduleSelectionCommit]);

  useEffect(() => {
    const viewer = viewerRef.current;

    if (!active || !viewer) {
      return undefined;
    }

    let pendingHoverBlock: PositionedMineruBlock | null = null;
    let hoverAnimationFrame: number | null = null;

    const flushBlockHover = () => {
      hoverAnimationFrame = null;

      const block = pendingHoverBlock;
      pendingHoverBlock = null;
      const nextBlockId = block?.blockId ?? null;

      if (hoveredBlockIdRef.current === nextBlockId) {
        return;
      }

      hoveredBlockIdRef.current = nextBlockId;
      onBlockHover(block);
    };

    const emitBlockHover = (block: PositionedMineruBlock | null) => {
      const nextBlockId = block?.blockId ?? null;
      const pendingBlockId = pendingHoverBlock?.blockId ?? null;

      if (
        (hoverAnimationFrame === null && hoveredBlockIdRef.current === nextBlockId) ||
        (hoverAnimationFrame !== null && pendingBlockId === nextBlockId)
      ) {
        return;
      }

      pendingHoverBlock = block;

      if (hoverAnimationFrame !== null) {
        return;
      }

      hoverAnimationFrame = window.requestAnimationFrame(flushBlockHover);
    };

    const getPointerPageTarget = (event: PointerEvent | MouseEvent) =>
      getPageTargetFromEvent(event.target, event.clientX, event.clientY, viewer);

    const getPointerRenderedPage = (pageTarget: ReturnType<typeof getPageTargetFromEvent>) => {
      if (!pageTarget) {
        return null;
      }

      return pageHosts[pageTarget.pageIndex] ?? getRenderedPageSize(pageTarget.pageElement);
    };

    const handlePointerDown = (event: PointerEvent) => {
      clearPendingBlockSelect();

      if (editorToolRef.current !== 'none') {
        pointerStartRef.current = null;
        emitBlockHover(null);
        return;
      }

      if (isAnnotationUiTarget(event.target)) {
        return;
      }

      const pageTarget = getPointerPageTarget(event);

      if (!pageTarget) {
        pointerStartRef.current = null;
        return;
      }

      pointerStartRef.current = {
        x: event.clientX,
        y: event.clientY,
      };
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (editorToolRef.current !== 'none') {
        emitBlockHover(null);
        return;
      }

      if (event.buttons !== 0 || hasActiveTextSelection() || isAnnotationUiTarget(event.target)) {
        return;
      }

      const pageTarget = getPointerPageTarget(event);

      if (!pageTarget) {
        emitBlockHover(null);
        return;
      }

      const pageBlocks = blocksByPage.get(pageTarget.pageIndex) ?? [];
      const renderedPage = getPointerRenderedPage(pageTarget);

      if (!renderedPage) {
        emitBlockHover(null);
        return;
      }

      const originalPage = resolveOriginalPageForSources(
        pageTarget.pageIndex,
        renderedPage,
        pageBlocks,
      );

      if (!originalPage) {
        emitBlockHover(null);
        return;
      }

      const hitBlock =
        resolveHitBlockByPoint(
          event.clientX,
          event.clientY,
          pageTarget.pageElement,
          pageBlocks,
          originalPage,
          renderedPage,
        ) ??
        resolveNearestBlockByPoint(
          event.clientX,
          event.clientY,
          pageTarget.pageElement,
          pageBlocks,
          originalPage,
          renderedPage,
        );

      emitBlockHover(hitBlock);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (editorToolRef.current !== 'none') {
        pointerStartRef.current = null;
        return;
      }

      const pageTarget = getPointerPageTarget(event);

      if (!pageTarget) {
        pointerStartRef.current = null;
        return;
      }

      if (isAnnotationUiTarget(event.target)) {
        pointerStartRef.current = null;
        return;
      }

      const renderedPage = getPointerRenderedPage(pageTarget);

      if (!renderedPage) {
        pointerStartRef.current = null;
        return;
      }

      const pointerStart = pointerStartRef.current;
      pointerStartRef.current = null;

      if (pointerStart) {
        const movement = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);

        if (movement > 4) {
          return;
        }
      }

      if (hasActiveTextSelection()) {
        return;
      }

      const pageBlocks = blocksByPage.get(pageTarget.pageIndex) ?? [];
      const originalPage = resolveOriginalPageForSources(
        pageTarget.pageIndex,
        renderedPage,
        pageBlocks,
      );

      if (!originalPage) {
        return;
      }

      const hitBlock =
        resolveHitBlockByPoint(
          event.clientX,
          event.clientY,
          pageTarget.pageElement,
          pageBlocks,
          originalPage,
          renderedPage,
        ) ??
        resolveNearestBlockByPoint(
          event.clientX,
          event.clientY,
          pageTarget.pageElement,
          pageBlocks,
          originalPage,
          renderedPage,
        );

      if (hitBlock) {
        const anchorClientRect = resolveBlockClientRect(
          pageTarget.pageElement,
          hitBlock,
          originalPage,
          renderedPage,
        );

        clearPendingBlockSelect();
        pendingBlockSelectTimerRef.current = window.setTimeout(() => {
          pendingBlockSelectTimerRef.current = null;

          if (hasActiveTextSelection()) {
            return;
          }

          onBlockSelect(hitBlock, {
            anchorClientX: event.clientX,
            anchorClientY: event.clientY,
            anchorClientRect,
            placement: 'bottom',
          });
        }, 48);
      }
    };

    const handleClick = (event: MouseEvent) => {
      if (editorToolRef.current !== 'none') {
        return;
      }

      if (isAnnotationUiTarget(event.target) || hasActiveTextSelection()) {
        return;
      }

      const pageTarget = getPointerPageTarget(event);

      if (!pageTarget) {
        return;
      }

      const renderedPage = getPointerRenderedPage(pageTarget);

      if (!renderedPage) {
        return;
      }

      const pageBlocks = blocksByPage.get(pageTarget.pageIndex) ?? [];
      const originalPage = resolveOriginalPageForSources(
        pageTarget.pageIndex,
        renderedPage,
        pageBlocks,
      );

      if (!originalPage) {
        return;
      }

      const hitBlock =
        resolveHitBlockByPoint(
          event.clientX,
          event.clientY,
          pageTarget.pageElement,
          pageBlocks,
          originalPage,
          renderedPage,
        ) ??
        resolveNearestBlockByPoint(
          event.clientX,
          event.clientY,
          pageTarget.pageElement,
          pageBlocks,
          originalPage,
          renderedPage,
        );

      if (!hitBlock) {
        return;
      }

      clearPendingBlockSelect();
      if (blockClickOpensQuickActions) {
        (event as MouseEvent & { paperQuayPdfBlockSelectClick?: boolean }).paperQuayPdfBlockSelectClick = true;
      }
      onBlockSelect(hitBlock, {
        anchorClientX: event.clientX,
        anchorClientY: event.clientY,
        anchorClientRect: resolveBlockClientRect(
          pageTarget.pageElement,
          hitBlock,
          originalPage,
          renderedPage,
        ),
        placement: 'bottom',
      });
    };

    const handlePointerLeave = (event: PointerEvent) => {
      const relatedTarget = event.relatedTarget;

      if (relatedTarget instanceof Node && viewer.contains(relatedTarget)) {
        return;
      }

      emitBlockHover(null);
    };

    viewer.addEventListener('pointerdown', handlePointerDown);
    viewer.addEventListener('pointermove', handlePointerMove);
    viewer.addEventListener('pointerup', handlePointerUp);
    viewer.addEventListener('pointerleave', handlePointerLeave);
    viewer.addEventListener('click', handleClick, true);

    return () => {
      if (hoverAnimationFrame !== null) {
        window.cancelAnimationFrame(hoverAnimationFrame);
      }

      pendingHoverBlock = null;
      if (hoveredBlockIdRef.current !== null) {
        hoveredBlockIdRef.current = null;
        onBlockHover(null);
      }

      viewer.removeEventListener('pointerdown', handlePointerDown);
      viewer.removeEventListener('pointermove', handlePointerMove);
      viewer.removeEventListener('pointerup', handlePointerUp);
      viewer.removeEventListener('pointerleave', handlePointerLeave);
      viewer.removeEventListener('click', handleClick, true);
    };
  }, [
    active,
    blockClickOpensQuickActions,
    blocksByPage,
    clearPendingBlockSelect,
    onBlockHover,
    onBlockSelect,
    pageHosts,
    resolveOriginalPageForSources,
  ]);

  useEffect(() => {
    const container = containerRef.current;

    if (!active || !container) {
      return undefined;
    }

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }

      event.preventDefault();

      if (event.deltaY < 0) {
        pdfViewerRef.current?.increaseScale?.();
        return;
      }

      pdfViewerRef.current?.decreaseScale?.();
    };

    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [active, documentInit]);


  if (!source) {
    return (
      <EmptyState
        title={l('等待打开 PDF', 'Open a PDF to start')}
        description={l('After opening a paper, the original PDF will appear here and stay linked with the MinerU blocks on the right.', 'After opening a paper, the original PDF will appear here and stay linked with the MinerU blocks on the right.',
        )}
      />
    );
  }

  if (!documentInit) {
    return (
      <EmptyState
        title={l('正在准备 PDF', 'Preparing the PDF')}
        description={l('The desktop app is loading the PDF content for this document.', 'The desktop app is loading the PDF content for this document.',
        )}
      />
    );
  }

  const canShowReadingHeatmapBar =
    enableReadingHeatmap && pageCount > 0 && Boolean(sourceSignature);
  const showReadingHeatmapBar = canShowReadingHeatmapBar && readingHeatmapBarVisible;
  const readingHeatmapToggleLabel = showReadingHeatmapBar
    ? l('隐藏阅读热力进度', 'Hide reading heat progress')
    : l('显示阅读热力进度', 'Show reading heat progress');

  return (
    <div
      className="paperquay-pdf-linked flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,#eff4fb,#e9f0f7)] dark:bg-[var(--pq-bg-primary)]"
      data-soft-shadow={softPageShadow ? 'true' : 'false'}
    >
      <PdfViewerToolbar
        activeColorTool={activeColorTool}
        annotationColors={annotationColors}
        canShowReadingHeatmapBar={canShowReadingHeatmapBar}
        currentPage={currentPage}
        documentError={documentError}
        editorTool={editorTool}
        enableReadingHeatmap={enableReadingHeatmap}
        hasLiveTextSelection={hasLiveTextSelection}
        hasSelectedEditor={hasSelectedEditor}
        hideToolbar={hideToolbar}
        l={l}
        loading={loading}
        onActiveColorToolChange={setActiveColorTool}
        onAnnotationToolColorChange={updateAnnotationToolColor}
        onCreateHighlight={handleCreatePdfHighlight}
        onDeleteSelected={handleDeleteSelected}
        onEditorToolChange={setEditorTool}
        onSave={handleSave}
        onScrollToPage={scrollToPage}
        onToggleReadingHeatmapBar={() => setReadingHeatmapBarVisible((current) => !current)}
        onZoomIn={() => pdfViewerRef.current?.increaseScale?.()}
        onZoomOut={() => pdfViewerRef.current?.decreaseScale?.()}
        pageCount={pageCount}
        readingHeatmapToggleLabel={readingHeatmapToggleLabel}
        saveMessage={saveMessage}
        saving={saving}
        showReadingHeatmapBar={showReadingHeatmapBar}
        translating={translating}
        translationProgressCompleted={translationProgressCompleted}
        translationProgressTotal={translationProgressTotal}
        zoomLabel={zoomLabel}
      />

      <div className="relative flex min-h-0 flex-1">
        <PdfThumbnailSidebar
          ref={thumbnailSidebarRef}
          collapsed={thumbnailsCollapsed}
          pageCount={pageCount}
          currentPage={currentPage}
          pageThumbnails={pageThumbnails}
          onToggleCollapsed={() => setThumbnailsCollapsed((current) => !current)}
          onScrollToPage={scrollToPage}
          onWheelCapture={handleThumbnailWheelCapture}
          l={l}
        />

        <div className="relative min-h-0 flex-1">
          {loading ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(241,245,249,0.72)] backdrop-blur-sm dark:bg-[rgba(15,23,42,0.72)]">
            <div className="inline-flex items-center rounded-full border border-white/70 bg-white/92 px-4 py-2 text-sm text-slate-600 shadow-[0_14px_34px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-[var(--pq-surface-1)] dark:text-[var(--pq-text-muted)] dark:shadow-[0_14px_34px_rgba(0,0,0,0.24)]">
              {l('Loading PDF...', 'Loading PDF...')}
            </div>
          </div>
          ) : null}

        <div
          ref={containerRef}
          className={cn(
            'pdf-annotation-scroll absolute inset-0 overflow-auto px-5 pt-5',
            showReadingHeatmapBar ? 'pb-24' : 'pb-5',
          )}
          onMouseUp={active ? () => scheduleSelectionCommit() : undefined}
          onKeyUp={active ? () => scheduleSelectionCommit() : undefined}
        >
          <div ref={viewerRef} className="pdfViewer" />

          {overlayPageIndexes.map((pageIndex) => {
            const host = pageHosts[pageIndex];
            const renderedPage = host
              ? {
              width: host.width,
              height: host.height,
                }
              : null;

            if (!host || !renderedPage || renderedPage.width <= 0 || renderedPage.height <= 0) {
              return null;
            }

            const pageBlocks = blocksByPage.get(pageIndex) ?? [];
            const pageAnnotations = annotationsByPage.get(pageIndex) ?? [];
            const activePageBlock =
              activeBlock?.pageIndex === pageIndex ? activeBlock : null;
            const activeHighlightSource =
              activeHighlight && activeHighlight.pageIndex === pageIndex
                ? blockById.get(activeHighlight.blockId) ?? activeHighlight
                : null;
            const originalPage = resolveOverlayOriginalPage(
              pageSizes[pageIndex],
              renderedPage,
              [
                ...pageBlocks,
                ...pageAnnotations,
                activePageBlock,
                activeHighlightSource,
              ],
            );
            const allowLinkedInteractions = editorTool === 'none' && !hasLiveTextSelection;

            if (!originalPage) {
              return null;
            }

            return createPortal(
              <PdfPageOverlay
                pageIndex={pageIndex}
                originalPage={originalPage}
                renderedPage={renderedPage}
                pageBlocks={pageBlocks}
                pageAnnotations={pageAnnotations}
                activeBlockId={activeBlockId}
                hoveredBlockId={hoveredBlockId}
                selectedAnnotationId={selectedAnnotationId}
                activeHighlight={activeHighlight}
                activeHighlightSource={activeHighlightSource}
                allowLinkedInteractions={allowLinkedInteractions}
                onAnnotationSelect={onAnnotationSelect}
                l={l}
              />,
              host.overlayElement,
              `pdf-linked-overlay-${pageIndex}`,
            );
          })}

        </div>
        {showReadingHeatmapBar ? (
          <PdfReadingHeatmapBar
            heatmap={localReadingHeatmap}
            currentProgressRatio={readingProgressRatio}
            maxBinMs={maxReadingHeatmapBinMs}
            onSeek={scrollToReadingProgress}
            label={l('阅读热力进度', 'Reading heat progress')}
            totalLabel={l('累计', 'Total')}
          />
        ) : null}
        </div>
      </div>
    </div>
  );
}

export default memo(PdfViewer);

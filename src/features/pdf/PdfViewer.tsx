import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Highlighter,
  Loader2,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  PenTool,
  Trash2,
  Type,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { AnnotationEditorType, AnnotationMode, GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import 'pdfjs-dist/web/pdf_viewer.css';
import EmptyState from '../../components/EmptyState';
import { useWheelScrollDelegate } from '../../hooks/useWheelScrollDelegate';
import { approveWritePath, selectSavePdfPath, writeLocalBinaryFile } from '../../services/desktop';
import type {
  PaperAnnotation,
  PdfHighlightTarget,
  PdfSource,
  PositionedMineruBlock,
  TextSelectionPayload,
} from '../../types/reader';
import {
  bboxToCssStyle,
  bboxToRect,
  isValidBBox,
  shouldCreateHotspot,
  type PageSize,
} from '../../utils/bbox';
import { cn } from '../../utils/cn';
import { useLocaleText } from '../../i18n/uiLanguage';
import { buildSiblingPath } from '../../utils/mineruCache';
import { buildPathInDirectory, getParentDirectory, normalizePathForCompare } from '../../utils/path';
import { getFileNameFromPath, normalizeSelectionText } from '../../utils/text';
import { buildHighlightScrollKey, shouldScrollToHighlight } from './highlightScroll';
import {
  applyPdfAnnotationToolColors,
  buildPdfJsHighlightColorOptions,
  getPdfAnnotationColorValue,
  loadPdfAnnotationToolColors,
  PDF_ANNOTATION_COLOR_PRESETS,
  persistPdfAnnotationToolColors,
  type PdfAnnotationColorTool,
} from './annotationColors';

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const PDF_THUMBNAILS_COLLAPSED_STORAGE_KEY = 'paperquay-pdf-thumbnails-collapsed-v1';

type AnnotationEditorTool = 'none' | 'freetext' | 'ink';

interface PdfViewerProps {
  source: PdfSource;
  pdfData: Uint8Array | null;
  currentPdfName?: string;
  defaultSaveDirectory?: string;
  originalPdfPath?: string;
  translating?: boolean;
  translationProgressCompleted?: number;
  translationProgressTotal?: number;
  blocks: PositionedMineruBlock[];
  annotations: PaperAnnotation[];
  activeBlockId: string | null;
  hoveredBlockId: string | null;
  activeHighlight: PdfHighlightTarget | null;
  selectedAnnotationId?: string | null;
  smoothScroll: boolean;
  softPageShadow: boolean;
  onBlockHover: (block: PositionedMineruBlock | null) => void;
  onBlockSelect: (block: PositionedMineruBlock) => void;
  onAnnotationSelect?: (annotationId: string) => void;
  onAnnotationCreate?: (note: string) => void;
  onTextSelect?: (selection: TextSelectionPayload) => void;
  onSaveSuccess?: (path: string) => void;
}

interface PageHostState {
  element: HTMLDivElement;
  overlayElement: HTMLDivElement;
  width: number;
  height: number;
}

function resolveBBoxBaseSize(
  source: Pick<
    PositionedMineruBlock | PdfHighlightTarget | PaperAnnotation,
    'bboxCoordinateSystem' | 'bboxPageSize'
  > | null,
  originalPage: PageSize,
): PageSize {
  if (source?.bboxCoordinateSystem === 'normalized-1000') {
    return { width: 1000, height: 1000 };
  }

  if (source?.bboxPageSize) {
    return {
      width: source.bboxPageSize[0],
      height: source.bboxPageSize[1],
    };
  }

  return originalPage;
}

function hasActiveTextSelection() {
  const selection = window.getSelection();

  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

function ensurePageOverlayElement(pageElement: HTMLDivElement) {
  pageElement.style.position ||= 'relative';

  let overlayElement = pageElement.querySelector<HTMLDivElement>('.paperquay-page-overlay-host');

  if (!overlayElement) {
    overlayElement = document.createElement('div');
    overlayElement.className = 'paperquay-page-overlay-host';
    overlayElement.style.position = 'absolute';
    overlayElement.style.inset = '0';
    overlayElement.style.pointerEvents = 'none';
    overlayElement.style.zIndex = '4';
    pageElement.appendChild(overlayElement);
  }

  return overlayElement;
}

function getScopedSelectionPayload(container: HTMLElement | null): TextSelectionPayload | null {
  const selection = window.getSelection();

  if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const text = normalizeSelectionText(selection.toString());

  if (!text) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const commonAncestor = range.commonAncestorContainer;
  const targetNode =
    commonAncestor.nodeType === Node.TEXT_NODE ? commonAncestor.parentElement : commonAncestor;

  if (!targetNode || !container.contains(targetNode)) {
    return null;
  }

  const rect = range.getBoundingClientRect();
  const anchorClientX = rect.width > 0 ? rect.left + rect.width / 2 : rect.left;
  const anchorClientY = rect.bottom;

  return {
    text,
    anchorClientX,
    anchorClientY,
    placement: 'bottom',
  };
}

function selectionBelongsToContainer(container: HTMLElement | null) {
  const selection = window.getSelection();

  if (!container || !selection) {
    return false;
  }

  if (
    (selection.anchorNode && container.contains(selection.anchorNode)) ||
    (selection.focusNode && container.contains(selection.focusNode))
  ) {
    return true;
  }

  if (selection.rangeCount === 0) {
    return false;
  }

  return container.contains(selection.getRangeAt(0).commonAncestorContainer);
}

function isAnnotationUiTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('[data-annotation-ui="true"]'));
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function buildAnnotatedFileName(fileName: string) {
  const trimmedName = fileName.trim() || 'document.pdf';
  const lowerName = trimmedName.toLowerCase();

  if (lowerName.endsWith('.annotated.pdf')) {
    return trimmedName;
  }

  if (!lowerName.endsWith('.pdf')) {
    return `${trimmedName}.annotated.pdf`;
  }

  return `${trimmedName.slice(0, -4)}.annotated.pdf`;
}

function buildAnnotatedSiblingPath(path: string) {
  return buildSiblingPath(path, buildAnnotatedFileName(getFileNameFromPath(path) || 'document.pdf'));
}

function loadStoredBoolean(key: string, fallback = false) {
  try {
    const rawValue = localStorage.getItem(key);

    return rawValue === null ? fallback : rawValue === 'true';
  } catch {
    return fallback;
  }
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

function resolveHitBlockByPoint(
  clientX: number,
  clientY: number,
  pageElement: HTMLDivElement,
  pageBlocks: PositionedMineruBlock[],
  originalPage: PageSize,
  renderedPage: PageSize,
) {
  const pageRect = pageElement.getBoundingClientRect();
  const offsetX = clientX - pageRect.left;
  const offsetY = clientY - pageRect.top;
  const tolerance = 6;
  const hits = pageBlocks.filter((block) => {
    const rect = bboxToRect(
      block.bbox!,
      resolveBBoxBaseSize(block, originalPage),
      renderedPage,
    );

    return (
      offsetX >= rect.left - tolerance &&
      offsetX <= rect.left + rect.width + tolerance &&
      offsetY >= rect.top - tolerance &&
      offsetY <= rect.top + rect.height + tolerance
    );
  });

  if (hits.length === 0) {
    return null;
  }

  return hits.sort((leftBlock, rightBlock) => {
    const leftRect = bboxToRect(
      leftBlock.bbox!,
      resolveBBoxBaseSize(leftBlock, originalPage),
      renderedPage,
    );
    const rightRect = bboxToRect(
      rightBlock.bbox!,
      resolveBBoxBaseSize(rightBlock, originalPage),
      renderedPage,
    );

    return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
  })[0];
}

function arePageHostsEqual(
  left: Record<number, PageHostState>,
  right: Record<number, PageHostState>,
) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => {
    const leftHost = left[Number(key)];
    const rightHost = right[Number(key)];

    return (
      leftHost?.element === rightHost?.element &&
      leftHost?.overlayElement === rightHost?.overlayElement &&
      Math.abs((leftHost?.width ?? 0) - (rightHost?.width ?? 0)) < 0.5 &&
      Math.abs((leftHost?.height ?? 0) - (rightHost?.height ?? 0)) < 0.5
    );
  });
}

function getPageTargetFromElement(pageElement: HTMLDivElement | null) {
  if (!pageElement) {
    return null;
  }

  const pageNumber = Number(pageElement.dataset.pageNumber ?? 0);

  if (!Number.isFinite(pageNumber) || pageNumber <= 0) {
    return null;
  }

  return {
    pageElement,
    pageIndex: pageNumber - 1,
  };
}

function getPageIndexFromTarget(target: EventTarget | null) {
  const pageElement =
    target instanceof Element ? (target.closest('.page') as HTMLDivElement | null) : null;

  return getPageTargetFromElement(pageElement);
}

function getPageIndexFromPoint(
  clientX: number,
  clientY: number,
  pageHosts: Record<number, PageHostState>,
  viewer?: HTMLDivElement | null,
) {
  const hosts = Object.entries(pageHosts).sort(
    ([leftPageIndex], [rightPageIndex]) => Number(leftPageIndex) - Number(rightPageIndex),
  );

  for (const [pageIndexKey, host] of hosts) {
    const rect = host.element.getBoundingClientRect();

    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      return {
        pageElement: host.element,
        pageIndex: Number(pageIndexKey),
      };
    }
  }

  if (viewer) {
    const pageElement = Array.from(viewer.querySelectorAll<HTMLDivElement>('.page')).find(
      (candidate) => {
        const rect = candidate.getBoundingClientRect();

        return (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        );
      },
    );

    return getPageTargetFromElement(pageElement ?? null);
  }

  return null;
}

function PdfViewer({
  source,
  pdfData,
  currentPdfName = '',
  defaultSaveDirectory = '',
  originalPdfPath = '',
  translating = false,
  translationProgressCompleted = 0,
  translationProgressTotal = 0,
  blocks,
  annotations,
  activeBlockId,
  hoveredBlockId,
  activeHighlight,
  selectedAnnotationId = null,
  smoothScroll,
  softPageShadow,
  onBlockHover,
  onBlockSelect,
  onAnnotationSelect,
  onAnnotationCreate,
  onTextSelect,
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
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastSelectionRef = useRef<{ text: string; emittedAt: number } | null>(null);
  const lRef = useRef(l);
  const selectionStartedInsideRef = useRef(false);
  const selectionCommitTimerRef = useRef<number | null>(null);
  const pendingBlockSelectTimerRef = useRef<number | null>(null);
  const scrollToPageRef = useRef<(pageIndex: number) => void>(() => undefined);
  const lastScrolledHighlightKeyRef = useRef('');

  const [editorTool, setEditorTool] = useState<AnnotationEditorTool>('none');
  const [pageCount, setPageCount] = useState(0);
  const [pageSizes, setPageSizes] = useState<Record<number, PageSize>>({});
  const [pageHosts, setPageHosts] = useState<Record<number, PageHostState>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomLabel, setZoomLabel] = useState('100%');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [documentError, setDocumentError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [hasSelectedEditor, setHasSelectedEditor] = useState(false);
  const [hasLiveTextSelection, setHasLiveTextSelection] = useState(false);
  const [annotationComposerBlockId, setAnnotationComposerBlockId] = useState<string | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState('');
  const [annotationColors, setAnnotationColors] = useState(() => loadPdfAnnotationToolColors());
  const [activeColorTool, setActiveColorTool] = useState<PdfAnnotationColorTool>('highlight');
  const [thumbnailsCollapsed, setThumbnailsCollapsed] = useState(() =>
    loadStoredBoolean(PDF_THUMBNAILS_COLLAPSED_STORAGE_KEY, false),
  );
  const [pageThumbnails, setPageThumbnails] = useState<Record<number, string>>({});
  const handleThumbnailWheelCapture = useWheelScrollDelegate({ rootRef: thumbnailSidebarRef });
  const translationProgressRatio =
    translationProgressTotal > 0
      ? Math.min(100, Math.max(0, (translationProgressCompleted / translationProgressTotal) * 100))
      : 0;

  useEffect(() => {
    lRef.current = l;
  }, [l]);

  useEffect(() => {
    setZoomLabel((current) =>
      current === '适合宽度' || current === 'Fit Width' ? l('适合宽度', 'Fit Width') : current,
    );
  }, [l]);

  const documentInit = useMemo(() => {
    if (pdfData) {
      return {
        data: pdfData.slice(),
      };
    }

    if (source?.kind === 'remote-url') {
      return source.headers
        ? {
            url: source.url,
            httpHeaders: source.headers,
          }
        : {
            url: source.url,
          };
    }

    return null;
  }, [pdfData, source]);

  const blocksByPage = useMemo(() => {
    const map = new Map<number, PositionedMineruBlock[]>();

    for (const block of blocks) {
      const pageBlocks = map.get(block.pageIndex) ?? [];
      pageBlocks.push(block);
      map.set(block.pageIndex, pageBlocks);
    }

    return map;
  }, [blocks]);

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

  const activeToolColor = annotationColors[activeColorTool];

  const getColorLabel = useCallback(
    (presetId: (typeof PDF_ANNOTATION_COLOR_PRESETS)[number]['id']) => {
      switch (presetId) {
        case 'yellow':
          return l('黄色', 'Yellow');
        case 'green':
          return l('绿色', 'Green');
        case 'blue':
          return l('蓝色', 'Blue');
        case 'pink':
          return l('粉色', 'Pink');
        case 'red':
          return l('红色', 'Red');
      }
    },
    [l],
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
      return;
    }

    observer.disconnect();

    const nextHosts: Record<number, PageHostState> = {};

    viewer.querySelectorAll<HTMLDivElement>('.page').forEach((element) => {
      const pageNumber = Number(element.dataset.pageNumber ?? 0);

      if (!Number.isFinite(pageNumber) || pageNumber <= 0) {
        return;
      }

      const overlayElement = ensurePageOverlayElement(element);
      observer.observe(element);

      nextHosts[pageNumber - 1] = {
        element,
        overlayElement,
        width: element.clientWidth || element.getBoundingClientRect().width,
        height: element.clientHeight || element.getBoundingClientRect().height,
      };
    });

    setPageHosts((current) => (arePageHostsEqual(current, nextHosts) ? current : nextHosts));
  }, []);

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

      setCurrentPage(pageIndex + 1);

      window.requestAnimationFrame(() => {
        syncPageHosts();
        window.requestAnimationFrame(syncPageHosts);
      });
    },
    [pageHosts, smoothScroll, syncPageHosts],
  );

  useEffect(() => {
    scrollToPageRef.current = scrollToPage;
  }, [scrollToPage]);

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
    if (!onTextSelect || editorToolRef.current !== 'none') {
      return;
    }

    window.requestAnimationFrame(() => {
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
      if (!onTextSelect || editorToolRef.current !== 'none') {
        return;
      }

      clearSelectionCommitTimer();
      selectionCommitTimerRef.current = window.setTimeout(() => {
        selectionCommitTimerRef.current = null;
        emitSelectedText();
      }, delay);
    },
    [clearSelectionCommitTimer, emitSelectedText, onTextSelect],
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
      setDocumentError(lRef.current('PDF 批注工具尚未初始化完成。', 'PDF annotation tools are not ready yet.'));
      return;
    }

    if (!selectionBelongsToContainer(containerRef.current) || !hasActiveTextSelection()) {
      setDocumentError(
        lRef.current(
          '请先在 PDF 中选中文字，再创建高亮。',
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
      setAnnotationComposerBlockId(null);
      setAnnotationDraft('');

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
      setHasLiveTextSelection(false);
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
    if (!annotationEditorReadyRef.current) {
      return;
    }

    applyPdfAnnotationToolColors(annotationEditorUiManagerRef.current, annotationColors);
  }, [annotationColors]);

  const handleSave = useCallback(async () => {
    if (!pdfDocumentRef.current || saving) {
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

      const nextBytes = await pdfDocumentRef.current.saveDocument();
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
    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(syncPageHosts);
    });
    const mutationObserver = new MutationObserver(() => {
      window.requestAnimationFrame(syncPageHosts);
    });

    resizeObserverRef.current = observer;
    mutationObserverRef.current = mutationObserver;
    syncPageHosts();

    const viewer = viewerRef.current;

    if (viewer) {
      mutationObserver.observe(viewer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-loaded', 'style', 'class'],
      });
    }

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      resizeObserverRef.current = null;
      mutationObserverRef.current = null;
      setPageHosts({});
    };
  }, [syncPageHosts]);

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
      setAnnotationComposerBlockId(null);
      setAnnotationDraft('');
      setHasLiveTextSelection(false);
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
    if (!hasSelectedEditor) {
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
  }, [handleDeleteSelected, hasSelectedEditor]);

  useEffect(() => {
    if (!annotationComposerBlockId) {
      return;
    }

    if (annotationComposerBlockId === activeBlockId) {
      return;
    }

    setAnnotationComposerBlockId(null);
    setAnnotationDraft('');
  }, [activeBlockId, annotationComposerBlockId]);

  useEffect(() => {
    setPageCount(0);
    setPageSizes({});
    setPageHosts({});
    setCurrentPage(1);
    setZoomLabel('100%');
    setSaveMessage('');
    setDocumentError('');
    clearSelectionCommitTimer();
    clearPendingBlockSelect();
  }, [clearPendingBlockSelect, clearSelectionCommitTimer, documentInit]);

  useEffect(() => {
    const container = containerRef.current;
    const viewer = viewerRef.current;

    if (!container || !viewer || !documentInit) {
      setPageCount(0);
      setCurrentPage(1);
      setZoomLabel('100%');
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
      .then(({ EventBus, PDFLinkService, PDFViewer: PdfJsViewer }) => {
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
          setHasSelectedEditor(Boolean(event.details?.hasSelectedEditor));
        };

        handlePagesInit = () => {
          pdfViewer.currentScaleValue = 'page-width';
          setZoomLabel(`${Math.round(pdfViewer.currentScale * 100)}%`);
          window.requestAnimationFrame(syncPageHosts);
        };

        handlePageChanging = (event) => {
          if (typeof event.pageNumber === 'number') {
            setCurrentPage(event.pageNumber);
          }
        };

        handleScaleChanging = (event) => {
          const scale = typeof event.scale === 'number' ? event.scale : pdfViewer.currentScale;

          if (typeof scale === 'number') {
            setZoomLabel(`${Math.round(scale * 100)}%`);
          }

          window.requestAnimationFrame(syncPageHosts);
        };

        handlePageRendered = () => {
          window.requestAnimationFrame(syncPageHosts);
        };

        eventBus.on('annotationeditoruimanager', handleAnnotationEditorUiManager);
        eventBus.on('annotationeditorstateschanged', handleEditorStatesChanged);
        eventBus.on('pagesinit', handlePagesInit);
        eventBus.on('pagechanging', handlePageChanging);
        eventBus.on('scalechanging', handleScaleChanging);
        eventBus.on('pagerendered', handlePageRendered);

        const loadingTask = getDocument(documentInit as any);
        loadingTaskRef.current = loadingTask;

        return loadingTask.promise
          .then(async (pdfDocument: any) => {
            if (cancelled) {
              return;
            }

            pdfDocumentRef.current = pdfDocument;
            setPageCount(pdfDocument.numPages);
            setCurrentPage(1);
            linkService.setDocument(pdfDocument, null);
            pdfViewer.setDocument(pdfDocument);

            const entries = await Promise.all(
              Array.from({ length: pdfDocument.numPages }, async (_, pageIndex) => {
                const page = await pdfDocument.getPage(pageIndex + 1);
                const viewport = page.getViewport({ scale: 1 });

                return [
                  pageIndex,
                  {
                    width: viewport.width,
                    height: viewport.height,
                  },
                ] as const;
              }),
            );

            if (cancelled) {
              return;
            }

            setPageSizes(Object.fromEntries(entries));
          })
          .catch((loadError: unknown) => {
            if (cancelled) {
              return;
            }

            setDocumentError(
              loadError instanceof Error
                ? loadError.message
                : lRef.current('PDF 加载失败', 'Failed to load the PDF'),
            );
          })
          .finally(() => {
            if (!cancelled) {
              setLoading(false);
            }
          });
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
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
      setHasSelectedEditor(false);

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

      pdfDocumentRef.current = null;
      pdfViewerRef.current = null;
      viewer.textContent = '';

      const loadingTaskToDestroy = loadingTaskRef.current;
      loadingTaskRef.current = null;

      if (loadingTaskToDestroy?.destroy) {
        void loadingTaskToDestroy.destroy();
      }
    };
  }, [documentInit, syncPageHosts]);

  useEffect(() => {
    const pdfDocument = pdfDocumentRef.current;

    if (!pdfDocument || pageCount <= 0) {
      setPageThumbnails({});
      return;
    }

    let cancelled = false;

    setPageThumbnails({});

    const renderThumbnails = async () => {
      const nextThumbnails: Record<number, string> = {};

      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        const page = await pdfDocument.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale: 1 });
        const targetWidth = 136;
        const scale = targetWidth / Math.max(viewport.width, 1);
        const thumbnailViewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { alpha: false });

        if (!context) {
          continue;
        }

        canvas.width = Math.max(1, Math.floor(thumbnailViewport.width));
        canvas.height = Math.max(1, Math.floor(thumbnailViewport.height));
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({
          canvasContext: context,
          viewport: thumbnailViewport,
        }).promise;

        if (cancelled) {
          return;
        }

        nextThumbnails[pageIndex] = canvas.toDataURL('image/jpeg', 0.84);
        setPageThumbnails((current) =>
          current[pageIndex] === nextThumbnails[pageIndex]
            ? current
            : {
                ...current,
                [pageIndex]: nextThumbnails[pageIndex],
              },
        );
      }
    };

    void renderThumbnails();

    return () => {
      cancelled = true;
    };
  }, [documentInit, pageCount]);

  useEffect(() => {
    if (!activeHighlight) {
      lastScrolledHighlightKeyRef.current = '';
      return;
    }

    if (!shouldScrollToHighlight(lastScrolledHighlightKeyRef.current, activeHighlight)) {
      return;
    }

    lastScrolledHighlightKeyRef.current = buildHighlightScrollKey(activeHighlight);

    window.requestAnimationFrame(() => {
      scrollToPageRef.current(activeHighlight.pageIndex);
    });
  }, [activeHighlight]);

  useEffect(() => {
    if (!onTextSelect) {
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
      setHasLiveTextSelection(selectionInside && hasActiveTextSelection());

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
      setHasLiveTextSelection(false);
      document.removeEventListener('pointerdown', handleSelectionStart);
      document.removeEventListener('mousedown', handleSelectionStart);
      document.removeEventListener('mouseup', handleMouseSelectionCommit);
      document.removeEventListener('keyup', handleKeyboardSelectionCommit);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [clearPendingBlockSelect, onTextSelect, scheduleSelectionCommit]);

  useEffect(() => {
    const viewer = viewerRef.current;

    if (!viewer) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      clearPendingBlockSelect();

      if (editorToolRef.current !== 'none') {
        pointerStartRef.current = null;
        onBlockHover(null);
        return;
      }

      if (isAnnotationUiTarget(event.target)) {
        return;
      }

      const pageTarget =
        getPageIndexFromPoint(event.clientX, event.clientY, pageHosts, viewerRef.current) ??
        getPageIndexFromTarget(event.target);

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
        onBlockHover(null);
        return;
      }

      if (event.buttons !== 0 || hasActiveTextSelection() || isAnnotationUiTarget(event.target)) {
        return;
      }

      const pageTarget =
        getPageIndexFromPoint(event.clientX, event.clientY, pageHosts, viewerRef.current) ??
        getPageIndexFromTarget(event.target);

      if (!pageTarget) {
        onBlockHover(null);
        return;
      }

      const pageBlocks = (blocksByPage.get(pageTarget.pageIndex) ?? []).filter(shouldCreateHotspot);
      const originalPage = pageSizes[pageTarget.pageIndex];
      const renderedPage = pageHosts[pageTarget.pageIndex];

      if (!originalPage || !renderedPage) {
        onBlockHover(null);
        return;
      }

      const hitBlock = resolveHitBlockByPoint(
        event.clientX,
        event.clientY,
        pageTarget.pageElement,
        pageBlocks,
        originalPage,
        renderedPage,
      );

      onBlockHover(hitBlock);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (editorToolRef.current !== 'none') {
        pointerStartRef.current = null;
        return;
      }

      const pageTarget =
        getPageIndexFromPoint(event.clientX, event.clientY, pageHosts, viewerRef.current) ??
        getPageIndexFromTarget(event.target);

      if (!pageTarget) {
        pointerStartRef.current = null;
        return;
      }

      if (isAnnotationUiTarget(event.target)) {
        pointerStartRef.current = null;
        return;
      }

      const originalPage = pageSizes[pageTarget.pageIndex];
      const renderedPage = pageHosts[pageTarget.pageIndex];

      if (!originalPage || !renderedPage) {
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

      const pageBlocks = (blocksByPage.get(pageTarget.pageIndex) ?? []).filter(shouldCreateHotspot);
      const hitBlock = resolveHitBlockByPoint(
        event.clientX,
        event.clientY,
        pageTarget.pageElement,
        pageBlocks,
        originalPage,
        renderedPage,
      );

      if (hitBlock) {
        clearPendingBlockSelect();
        pendingBlockSelectTimerRef.current = window.setTimeout(() => {
          pendingBlockSelectTimerRef.current = null;

          if (hasActiveTextSelection()) {
            return;
          }

          onBlockSelect(hitBlock);
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

      const pageTarget =
        getPageIndexFromPoint(event.clientX, event.clientY, pageHosts, viewerRef.current) ??
        getPageIndexFromTarget(event.target);

      if (!pageTarget) {
        return;
      }

      const originalPage = pageSizes[pageTarget.pageIndex];
      const renderedPage = pageHosts[pageTarget.pageIndex];

      if (!originalPage || !renderedPage) {
        return;
      }

      const pageBlocks = (blocksByPage.get(pageTarget.pageIndex) ?? []).filter(shouldCreateHotspot);
      const hitBlock = resolveHitBlockByPoint(
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
      onBlockSelect(hitBlock);
    };

    const handlePointerLeave = (event: PointerEvent) => {
      const relatedTarget = event.relatedTarget;

      if (relatedTarget instanceof Node && viewer.contains(relatedTarget)) {
        return;
      }

      onBlockHover(null);
    };

    viewer.addEventListener('pointerdown', handlePointerDown);
    viewer.addEventListener('pointermove', handlePointerMove);
    viewer.addEventListener('pointerup', handlePointerUp);
    viewer.addEventListener('pointerleave', handlePointerLeave);
    viewer.addEventListener('click', handleClick, true);

    return () => {
      viewer.removeEventListener('pointerdown', handlePointerDown);
      viewer.removeEventListener('pointermove', handlePointerMove);
      viewer.removeEventListener('pointerup', handlePointerUp);
      viewer.removeEventListener('pointerleave', handlePointerLeave);
      viewer.removeEventListener('click', handleClick, true);
    };
  }, [blocksByPage, clearPendingBlockSelect, onBlockHover, onBlockSelect, pageHosts, pageSizes]);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey) {
      return;
    }

    event.preventDefault();

    if (event.deltaY < 0) {
      pdfViewerRef.current?.increaseScale?.();
      return;
    }

    pdfViewerRef.current?.decreaseScale?.();
  }, []);

  if (!source) {
    return (
      <EmptyState
        title={l('等待打开 PDF', 'Open a PDF to start')}
        description={l(
          '打开论文后，这里会显示原始 PDF，并与右侧 MinerU 结构块保持双向联动。',
          'After opening a paper, the original PDF will appear here and stay linked with the MinerU blocks on the right.',
        )}
      />
    );
  }

  if (!documentInit) {
    return (
      <EmptyState
        title={l('正在准备 PDF', 'Preparing the PDF')}
        description={l(
          '桌面端正在读取当前文档的 PDF 内容，请稍候。',
          'The desktop app is loading the PDF content for this document.',
        )}
      />
    );
  }

  return (
    <div
      className="paperquay-pdf-linked flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,#eff4fb,#e9f0f7)] dark:bg-chrome-950"
      data-soft-shadow={softPageShadow ? 'true' : 'false'}
    >
      <div className="border-b border-slate-200/80 bg-white/78 px-4 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-chrome-950">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1 dark:border-white/10 dark:bg-chrome-800">
            {[
              {
                key: 'select' as const,
                label: l('选择联动', 'Select & Link'),
                icon: <MousePointer2 className="h-4 w-4" strokeWidth={1.8} />,
              },
              {
                key: 'highlight' as const,
                label: l('高亮', 'Highlight'),
                icon: <Highlighter className="h-4 w-4" strokeWidth={1.8} />,
              },
              {
                key: 'freetext' as const,
                label: l('文本', 'Text'),
                icon: <Type className="h-4 w-4" strokeWidth={1.8} />,
              },
              {
                key: 'ink' as const,
                label: l('手写', 'Ink'),
                icon: <PenTool className="h-4 w-4" strokeWidth={1.8} />,
              },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  if (item.key === 'highlight') {
                    setActiveColorTool('highlight');
                    void handleCreatePdfHighlight();
                    return;
                  }

                  if (item.key === 'select') {
                    setEditorTool('none');
                    return;
                  }

                  setActiveColorTool(item.key);
                  setEditorTool((current) => (current === item.key ? 'none' : item.key));
                }}
                disabled={
                  item.key === 'highlight'
                    ? !hasLiveTextSelection || editorTool !== 'none' || loading || saving
                    : loading || saving
                }
                title={
                  item.key === 'select'
                    ? l('选择联动', 'Select & Link')
                    : item.key === 'highlight'
                      ? l('高亮', 'Highlight')
                      : item.key === 'freetext'
                        ? l('文本批注', 'Text Annotation')
                        : l('手写批注', 'Ink Annotation')
                }
                aria-label={
                  item.key === 'select'
                    ? l('选择联动', 'Select & Link')
                    : item.key === 'highlight'
                      ? l('高亮', 'Highlight')
                      : item.key === 'freetext'
                        ? l('文本批注', 'Text Annotation')
                        : l('手写批注', 'Ink Annotation')
                }
                className={cn(
                  'inline-flex h-10 w-10 items-center justify-center rounded-xl border text-slate-500 transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-55',
                  ((item.key === 'select' && editorTool === 'none') ||
                    (item.key !== 'select' &&
                      item.key !== 'highlight' &&
                      editorTool === item.key))
                    ? 'border-indigo-200 bg-white text-indigo-600 shadow-[0_8px_18px_rgba(79,70,229,0.12)] dark:border-indigo-400/30 dark:bg-chrome-700 dark:text-indigo-400 dark:shadow-[0_8px_18px_rgba(79,70,229,0.18)]'
                    : 'border-transparent bg-transparent hover:border-slate-200 hover:bg-white hover:text-slate-800 dark:hover:border-white/15 dark:hover:bg-chrome-700 dark:hover:text-chrome-100',
                )}
              >
                {item.icon}
              </button>
            ))}
          </div>

          <div className="inline-flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/86 px-2.5 py-2 dark:border-white/10 dark:bg-chrome-800/86">
            <div className="flex items-center gap-1.5">
              {PDF_ANNOTATION_COLOR_PRESETS.map((preset) => {
                const colorValue = getPdfAnnotationColorValue(preset, activeColorTool);
                const active = colorValue.toLowerCase() === activeToolColor.toLowerCase();
                const colorLabel = getColorLabel(preset.id);

                return (
                  <button
                    key={`${activeColorTool}-${preset.id}`}
                    type="button"
                    onClick={() => updateAnnotationToolColor(activeColorTool, colorValue)}
                    className={cn(
                      'h-6 w-6 rounded-full border-2 transition-all duration-200',
                      active
                        ? 'scale-110 border-slate-900 shadow-[0_0_0_2px_rgba(255,255,255,0.9)] dark:border-chrome-100 dark:shadow-[0_0_0_2px_rgba(255,255,255,0.12)]'
                        : 'border-white hover:scale-105 hover:border-slate-300 dark:border-chrome-700 dark:hover:border-chrome-500',
                    )}
                    style={{ backgroundColor: colorValue }}
                    title={colorLabel}
                    aria-label={colorLabel}
                  />
                );
              })}
            </div>
            <label
              className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600 transition hover:border-slate-300 hover:bg-white dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-300 dark:hover:border-white/15 dark:hover:bg-chrome-700"
              title={l('自定义颜色', 'Custom color')}
            >
              <input
                type="color"
                value={activeToolColor}
                onChange={(event) => updateAnnotationToolColor(activeColorTool, event.target.value)}
                className="sr-only"
              />
              <span
                className="h-4 w-4 rounded-full border border-white shadow-sm"
                style={{ backgroundColor: activeToolColor }}
              />
              {l('自定义', 'Custom')}
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500 dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-400">
              {l(
                `第 ${currentPage}/${Math.max(pageCount, 1)} 页`,
                `Page ${currentPage}/${Math.max(pageCount, 1)}`,
              )}
            </div>
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500 dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-400">
              {zoomLabel}
            </div>
            <button
              type="button"
              onClick={() => scrollToPage(Math.max(0, currentPage - 2))}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-2 text-slate-600 transition-all duration-200 hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-300 dark:hover:bg-chrome-700"
              title={l('上一页', 'Previous page')}
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
            </button>
            <button
              type="button"
              onClick={() => scrollToPage(Math.min(Math.max(pageCount - 1, 0), currentPage))}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-2 text-slate-600 transition-all duration-200 hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-300 dark:hover:bg-chrome-700"
              title={l('下一页', 'Next page')}
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.9} />
            </button>
            <button
              type="button"
              onClick={() => pdfViewerRef.current?.decreaseScale?.()}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-2 text-slate-600 transition-all duration-200 hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-300 dark:hover:bg-chrome-700"
              title={l('缩小', 'Zoom out')}
            >
              <ZoomOut className="h-4 w-4" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={() => pdfViewerRef.current?.increaseScale?.()}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-2 text-slate-600 transition-all duration-200 hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-300 dark:hover:bg-chrome-700"
              title={l('放大', 'Zoom in')}
            >
              <ZoomIn className="h-4 w-4" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={handleDeleteSelected}
              disabled={!hasSelectedEditor || loading || saving}
              className={cn(
                'inline-flex items-center rounded-xl border px-3 py-2 text-sm font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60',
                hasSelectedEditor && !loading && !saving
                  ? 'border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-400 dark:hover:bg-rose-400/20'
                  : 'border-slate-200 bg-white text-slate-400 dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-500',
              )}
              title={l('删除当前选中的 PDF 批注', 'Delete the selected PDF annotation')}
            >
              <Trash2 className="mr-2 h-4 w-4" strokeWidth={1.8} />
              {l('删除所选', 'Delete Selected')}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || loading}
              className="inline-flex items-center rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-accent-blue dark:text-chrome-50 dark:hover:bg-accent-teal-hover"
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.8} />
              ) : (
                <Download className="mr-2 h-4 w-4" strokeWidth={1.8} />
              )}
              {saving ? l('导出中…', 'Exporting...') : l('导出批注 PDF', 'Export Annotated PDF')}
            </button>
          </div>
        </div>

        {saveMessage ? <div className="mt-2 text-xs text-emerald-600">{saveMessage}</div> : null}
        {documentError ? <div className="mt-2 text-xs text-rose-600">{documentError}</div> : null}
        {translating && translationProgressTotal > 0 ? (
          <div className="mt-3 rounded-2xl border border-indigo-100 bg-indigo-50/80 px-3 py-2.5 dark:border-indigo-400/20 dark:bg-indigo-400/10">
            <div className="flex items-center justify-between gap-3 text-xs font-medium text-indigo-700 dark:text-indigo-400">
              <span>{l('MinerU 结构块翻译进度', 'MinerU block translation progress')}</span>
              <span>
                {translationProgressCompleted}/{translationProgressTotal}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-500/20">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all duration-300 dark:bg-indigo-400"
                style={{ width: `${translationProgressRatio}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1">
        <aside
          ref={thumbnailSidebarRef}
          onWheelCapture={handleThumbnailWheelCapture}
          className="flex min-h-0 shrink-0 border-r border-slate-200/80 bg-white/72 backdrop-blur-xl dark:border-white/10 dark:bg-chrome-800"
        >
          <div className="flex min-h-0">
            <div className="flex w-12 shrink-0 flex-col items-center gap-3 border-r border-slate-200/70 px-2 py-4 dark:border-white/10">
              <button
                type="button"
                onClick={() => setThumbnailsCollapsed((current) => !current)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-300 dark:hover:border-white/15 dark:hover:bg-chrome-700"
                title={
                  thumbnailsCollapsed
                    ? l('展开页面缩略图', 'Show page thumbnails')
                    : l('收起页面缩略图', 'Hide page thumbnails')
                }
                aria-label={
                  thumbnailsCollapsed
                    ? l('展开页面缩略图', 'Show page thumbnails')
                    : l('收起页面缩略图', 'Hide page thumbnails')
                }
              >
                {thumbnailsCollapsed ? (
                  <PanelLeftOpen className="h-4 w-4" strokeWidth={1.8} />
                ) : (
                  <PanelLeftClose className="h-4 w-4" strokeWidth={1.8} />
                )}
              </button>
            </div>

            <div
              className={cn(
                'min-h-0 overflow-hidden transition-[width,opacity] duration-300 ease-out',
                thumbnailsCollapsed ? 'w-0 opacity-0' : 'w-44 opacity-100',
              )}
            >
              <div className="flex h-full min-h-0 flex-col">
                <div className="border-b border-slate-200/70 px-3 py-3 text-xs font-medium text-slate-500 dark:border-chrome-700/70 dark:text-chrome-400">
                  {l('页面缩略图', 'Page Thumbnails')}
                </div>
                <div
                  data-wheel-scroll-target
                  className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 py-3"
                >
                  <div className="space-y-3">
                    {Array.from({ length: Math.max(pageCount, 0) }, (_, pageIndex) => {
                      const isActivePage = currentPage === pageIndex + 1;
                      const thumbnailUrl = pageThumbnails[pageIndex];

                      return (
                        <button
                          key={`thumbnail-${pageIndex}`}
                          type="button"
                          onClick={() => scrollToPage(pageIndex)}
                          className={cn(
                            'group w-full rounded-2xl border p-2 text-left transition-all duration-200',
                            isActivePage
                              ? 'border-indigo-200 bg-white shadow-[0_10px_24px_rgba(79,70,229,0.10)] dark:border-indigo-400/30 dark:bg-chrome-700 dark:shadow-[0_10px_24px_rgba(79,70,229,0.16)]'
                              : 'border-slate-200 bg-white/70 hover:border-slate-300 hover:bg-white dark:border-white/10 dark:bg-chrome-800/70 dark:hover:border-white/15 dark:hover:bg-chrome-700',
                          )}
                        >
                          <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-chrome-800">
                            {thumbnailUrl ? (
                              <img
                                src={thumbnailUrl}
                                alt={l(
                                  `第 ${pageIndex + 1} 页缩略图`,
                                  `Thumbnail for page ${pageIndex + 1}`,
                                )}
                                className="block h-auto w-full"
                              />
                            ) : (
                              <div className="flex aspect-[0.74] w-full items-center justify-center bg-[linear-gradient(180deg,#f8fafc,#eef2f7)] text-xs text-slate-400 dark:bg-[linear-gradient(180deg,#242424,#1e1e1e)] dark:text-chrome-300">
                                {l('生成中', 'Rendering')}
                              </div>
                            )}
                          </div>
                          <div className="mt-2 flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-chrome-400">
                            <span>{l(`第 ${pageIndex + 1} 页`, `Page ${pageIndex + 1}`)}</span>
                            {isActivePage ? <span className="text-indigo-600 dark:text-indigo-400">{l('当前', 'Current')}</span> : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <div className="relative min-h-0 flex-1">
          {loading ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(241,245,249,0.72)] backdrop-blur-sm dark:bg-[rgba(15,23,42,0.72)]">
            <div className="inline-flex items-center rounded-full border border-white/70 bg-white/92 px-4 py-2 text-sm text-slate-600 shadow-[0_14px_34px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-300 dark:shadow-[0_14px_34px_rgba(0,0,0,0.24)]">
              {l('正在加载 PDF…', 'Loading PDF...')}
            </div>
          </div>
          ) : null}

        <div
          ref={containerRef}
          className="pdf-annotation-scroll absolute inset-0 overflow-auto px-5 py-5"
          onMouseUp={() => scheduleSelectionCommit()}
          onKeyUp={() => scheduleSelectionCommit()}
          onWheel={handleWheel}
        >
          <div ref={viewerRef} className="pdfViewer" />

          {Object.entries(pageHosts)
            .sort(([leftPageIndex], [rightPageIndex]) => Number(leftPageIndex) - Number(rightPageIndex))
            .map(([pageIndexKey, host]) => {
            const pageIndex = Number(pageIndexKey);
            const originalPage = pageSizes[pageIndex];
            const renderedPage = {
              width: host.width,
              height: host.height,
            };

            if (!originalPage || renderedPage.width <= 0 || renderedPage.height <= 0) {
              return null;
            }

            const pageBlocks = (blocksByPage.get(pageIndex) ?? []).filter(shouldCreateHotspot);
            const pageAnnotations = annotationsByPage.get(pageIndex) ?? [];
            const activePageBlock =
              activeBlockId != null
                ? pageBlocks.find((block) => block.blockId === activeBlockId) ?? null
                : null;
            const composerBlock =
              annotationComposerBlockId != null
                ? pageBlocks.find((block) => block.blockId === annotationComposerBlockId) ?? null
                : null;
            const composerAnchorBlock = composerBlock ?? activePageBlock;
            const composerAnchorRect =
              composerAnchorBlock != null
                ? bboxToRect(
                    composerAnchorBlock.bbox!,
                    resolveBBoxBaseSize(composerAnchorBlock, originalPage),
                    renderedPage,
                  )
                : null;
            const activeHighlightSource =
              activeHighlight && activeHighlight.pageIndex === pageIndex
                ? blocks.find((block) => block.blockId === activeHighlight.blockId) ?? activeHighlight
                : null;
            const showLinkedOverlay = true;
            const allowLinkedInteractions = editorTool === 'none' && !hasLiveTextSelection;

            return createPortal(
              <div className="paperquay-page-overlay relative h-full w-full pointer-events-none">
                {showLinkedOverlay
                  ? pageBlocks.map((block) => (
                  <div
                    key={block.blockId}
                    aria-label={block.blockId}
                    className={cn(
                      'absolute rounded-lg border transition-all duration-150',
                      hoveredBlockId === block.blockId && 'border-amber-300 bg-amber-200/18',
                      activeBlockId === block.blockId &&
                        'border-indigo-400 bg-indigo-300/14 shadow-[0_0_0_1px_rgba(99,102,241,0.18)]',
                      hoveredBlockId !== block.blockId &&
                        activeBlockId !== block.blockId &&
                        'border-transparent bg-transparent',
                    )}
                    style={bboxToCssStyle(
                      block.bbox!,
                      resolveBBoxBaseSize(block, originalPage),
                      renderedPage,
                    )}
                  />
                    ))
                  : null}

                {showLinkedOverlay
                  ? pageAnnotations.map((annotation, index) => (
                  <button
                    key={annotation.id}
                    type="button"
                    data-annotation-ui="true"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onAnnotationSelect?.(annotation.id);
                    }}
                    className={cn(
                      'absolute rounded-lg border-2 transition-all duration-150',
                      allowLinkedInteractions ? 'pointer-events-auto' : 'pointer-events-none',
                      selectedAnnotationId === annotation.id
                        ? 'border-amber-500 bg-amber-200/18 shadow-[0_0_0_1px_rgba(245,158,11,0.20)]'
                        : 'border-amber-300/90 bg-amber-200/10 hover:bg-amber-200/16',
                    )}
                    style={bboxToCssStyle(
                      annotation.bbox,
                      resolveBBoxBaseSize(annotation, originalPage),
                      renderedPage,
                    )}
                    title={
                      annotation.note ||
                      annotation.quote ||
                      l(`批注 ${index + 1}`, `Annotation ${index + 1}`)
                    }
                  >
                    <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white shadow-sm">
                      {index + 1}
                    </span>
                  </button>
                    ))
                  : null}

                {showLinkedOverlay &&
                activeHighlight &&
                activeHighlight.pageIndex === pageIndex &&
                activeHighlightSource ? (
                  <div
                    className="absolute z-[5] rounded-lg border-2 border-indigo-500 bg-indigo-200/18 shadow-[0_0_0_1px_rgba(79,70,229,0.18)]"
                    style={bboxToCssStyle(
                      activeHighlight.bbox,
                      resolveBBoxBaseSize(activeHighlightSource, originalPage),
                      renderedPage,
                    )}
                  />
                ) : null}

                {allowLinkedInteractions && composerAnchorRect && onAnnotationCreate ? (
                  <>
                    <button
                      type="button"
                      data-label={l('批注', 'Annotate')}
                      data-annotation-ui="true"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        setAnnotationComposerBlockId((current) =>
                          current === composerAnchorBlock?.blockId
                            ? null
                            : composerAnchorBlock?.blockId ?? null,
                        );
                        setAnnotationDraft('');
                      }}
                      className="pointer-events-auto absolute z-[6] inline-flex items-center rounded-full border border-slate-200 bg-white/96 px-3 py-1.5 text-[0px] font-medium shadow-[0_10px_20px_rgba(15,23,42,0.12)] transition hover:border-slate-300 hover:bg-white dark:border-white/10 dark:bg-chrome-800 dark:shadow-[0_10px_20px_rgba(0,0,0,0.24)] dark:hover:border-white/15 dark:hover:bg-chrome-700 after:absolute after:inset-0 after:flex after:items-center after:justify-center after:text-xs after:font-medium after:text-slate-700 after:content-[attr(data-label)] dark:after:text-chrome-200"
                      style={{
                        left: `${Math.min(
                          Math.max(composerAnchorRect.left, 8),
                          Math.max(renderedPage.width - 108, 8),
                        )}px`,
                        top: `${Math.max(composerAnchorRect.top - 38, 8)}px`,
                      }}
                    >
                      {l('批注', 'Annotate')}
                    </button>

                    {annotationComposerBlockId === composerAnchorBlock?.blockId ? (
                      <div
                        data-annotation-ui="true"
                        className="pointer-events-auto absolute z-[6] w-72 rounded-2xl border border-slate-200 bg-white/96 p-3 shadow-[0_18px_40px_rgba(15,23,42,0.14)] backdrop-blur dark:border-white/10 dark:bg-chrome-800 dark:shadow-[0_18px_40px_rgba(0,0,0,0.24)]"
                        style={{
                          left: `${Math.min(
                            Math.max(composerAnchorRect.left, 8),
                            Math.max(renderedPage.width - 288, 8),
                          )}px`,
                          top: `${Math.min(
                            composerAnchorRect.top + composerAnchorRect.height + 10,
                            Math.max(renderedPage.height - 176, 8),
                          )}px`,
                        }}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                        }}
                      >
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-chrome-400">
                          {l('页面批注', 'Page Annotation')}
                        </div>
                        <textarea
                          value={annotationDraft}
                          onChange={(event) => setAnnotationDraft(event.target.value)}
                          placeholder={l(
                            '给当前块写一条批注，或直接只保存标记。',
                            'Write an annotation for the current block, or save the marker only.',
                          )}
                          className="mt-2 h-24 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700 outline-none transition focus:border-indigo-200 focus:bg-white dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-200 dark:focus:border-indigo-400/40 dark:focus:bg-chrome-700"
                        />
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              onAnnotationCreate(annotationDraft);
                              setAnnotationDraft('');
                              setAnnotationComposerBlockId(null);
                            }}
                            className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-slate-800 dark:bg-accent-blue dark:text-chrome-50 dark:hover:bg-accent-teal-hover"
                          >
                            {l('保存批注', 'Save Annotation')}
                          </button>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              data-label={l('仅标记', 'Save Marker')}
                              onClick={() => {
                                onAnnotationCreate('');
                                setAnnotationDraft('');
                                setAnnotationComposerBlockId(null);
                              }}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[0px] font-medium transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-800 dark:hover:border-white/15 dark:hover:bg-chrome-700 after:text-xs after:font-medium after:text-slate-700 after:content-[attr(data-label)] dark:after:text-chrome-300"
                            >
                              {l('仅标记', 'Save Marker')}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAnnotationComposerBlockId(null);
                                setAnnotationDraft('');
                              }}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-300 dark:hover:border-white/15 dark:hover:bg-chrome-700"
                            >
                              {l('取消', 'Cancel')}
                            </button>
                          </div>
                          </div>
                        </div>
                    ) : null}
                  </>
                ) : null}
              </div>,
              host.overlayElement,
              `pdf-linked-overlay-${pageIndex}`,
            );
          })}

        </div>
        </div>
      </div>
    </div>
  );
}

export default memo(PdfViewer);

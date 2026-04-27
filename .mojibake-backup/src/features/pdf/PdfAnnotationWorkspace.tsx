import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Highlighter,
  Loader2,
  MousePointer2,
  PenTool,
  Trash2,
  Type,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  AnnotationEditorType,
  AnnotationMode,
  GlobalWorkerOptions,
  getDocument,
} from 'pdfjs-dist';
import 'pdfjs-dist/web/pdf_viewer.css';
import EmptyState from '../../components/EmptyState';
import { selectSavePdfPath, writeLocalBinaryFile } from '../../services/desktop';
import type { PdfSource, TextSelectionPayload } from '../../types/reader';
import { cn } from '../../utils/cn';
import { buildSiblingPath } from '../../utils/mineruCache';
import { getFileNameFromPath, normalizeSelectionText } from '../../utils/text';
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

type AnnotationToolMode = 'select' | 'highlight' | 'freetext' | 'ink';

interface PdfAnnotationWorkspaceProps {
  source: PdfSource;
  pdfData: Uint8Array | null;
  currentPdfName: string;
  defaultSaveDirectory?: string;
  originalPdfPath?: string;
  onTextSelect?: (selection: TextSelectionPayload) => void;
  onClearSelectedExcerpt?: () => void;
  onSaveSuccess?: (path: string) => void;
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

function getParentDirectory(path: string) {
  const normalizedPath = path.replace(/\//g, '\\');
  const separatorIndex = normalizedPath.lastIndexOf('\\');

  return separatorIndex >= 0 ? normalizedPath.slice(0, separatorIndex) : '';
}

function buildAnnotatedSiblingPath(path: string) {
  return buildSiblingPath(path, buildAnnotatedFileName(getFileNameFromPath(path) || 'document.pdf'));
}

function buildPathInDirectory(directory: string, fileName: string) {
  const trimmedDirectory = directory.trim().replace(/[\\/]+$/, '');

  if (!trimmedDirectory) {
    return fileName;
  }

  const separator = trimmedDirectory.includes('\\') ? '\\' : '/';

  return `${trimmedDirectory}${separator}${fileName}`;
}

function normalizePathForCompare(path: string) {
  return path.replace(/\//g, '\\').trim().toLowerCase();
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function resolveToolMode(mode: AnnotationToolMode) {
  switch (mode) {
    case 'highlight':
      return AnnotationEditorType.HIGHLIGHT;
    case 'freetext':
      return AnnotationEditorType.FREETEXT;
    case 'ink':
      return AnnotationEditorType.INK;
    case 'select':
    default:
      return AnnotationEditorType.NONE;
  }
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

function PdfAnnotationWorkspace({
  source,
  pdfData,
  currentPdfName,
  defaultSaveDirectory = '',
  originalPdfPath = '',
  onTextSelect,
  onClearSelectedExcerpt,
  onSaveSuccess,
}: PdfAnnotationWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const loadingTaskRef = useRef<any>(null);
  const pdfViewerRef = useRef<any>(null);
  const pdfDocumentRef = useRef<any>(null);
  const eventBusRef = useRef<any>(null);
  const annotationEditorUiManagerRef = useRef<any>(null);
  const annotationEditorReadyRef = useRef(false);
  const toolModeRef = useRef<AnnotationToolMode>('select');
  const selectionTimerRef = useRef<number | null>(null);

  const [toolMode, setToolMode] = useState<AnnotationToolMode>('select');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomLabel, setZoomLabel] = useState('100%');
  const [hasSelectedEditor, setHasSelectedEditor] = useState(false);
  const [annotationColors, setAnnotationColors] = useState(() => loadPdfAnnotationToolColors());
  const [activeColorTool, setActiveColorTool] = useState<PdfAnnotationColorTool>('highlight');

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

  useEffect(() => {
    toolModeRef.current = toolMode;
    const pdfViewer = pdfViewerRef.current;

    if (!pdfViewer || !annotationEditorReadyRef.current) {
      return;
    }

    pdfViewer.annotationEditorMode = {
      mode: resolveToolMode(toolMode),
      isFromKeyboard: false,
    };

    if (toolMode !== 'select') {
      window.getSelection()?.removeAllRanges();
      onClearSelectedExcerpt?.();
    }
  }, [onClearSelectedExcerpt, toolMode]);

  const activeToolColor = annotationColors[activeColorTool];

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
    persistPdfAnnotationToolColors(annotationColors);
  }, [annotationColors]);

  useEffect(() => {
    if (!annotationEditorReadyRef.current) {
      return;
    }

    applyPdfAnnotationToolColors(annotationEditorUiManagerRef.current, annotationColors);
  }, [annotationColors]);

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
    annotationEditorReadyRef.current = false;
    setLoading(true);
    setError('');
    setSaveMessage('');

    let eventBus: any = null;
    let handlePagesInit: (() => void) | null = null;
    let handlePageChanging: ((event: { pageNumber?: number }) => void) | null = null;
    let handleScaleChanging: ((event: { scale?: number; presetValue?: string }) => void) | null =
      null;
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
          annotationEditorHighlightColors: buildPdfJsHighlightColorOptions(),
        });

        pdfViewerRef.current = pdfViewer;
        linkService.setViewer(pdfViewer);

        handleAnnotationEditorUiManager = (event) => {
          annotationEditorReadyRef.current = true;
          annotationEditorUiManagerRef.current = event.uiManager ?? null;
          applyPdfAnnotationToolColors(annotationEditorUiManagerRef.current, annotationColors);

          pdfViewer.annotationEditorMode = {
            mode: resolveToolMode(toolModeRef.current),
            isFromKeyboard: false,
          };
        };

        handleEditorStatesChanged = (event) => {
          setHasSelectedEditor(Boolean(event.details?.hasSelectedEditor));
        };

        handlePagesInit = () => {
          pdfViewer.currentScaleValue = 'page-width';
          setZoomLabel(`${Math.round(pdfViewer.currentScale * 100)}%`);
        };

        handlePageChanging = (event) => {
          if (typeof event.pageNumber === 'number') {
            setCurrentPage(event.pageNumber);
          }
        };

        handleScaleChanging = (event) => {
          const scale = typeof event.scale === 'number' ? event.scale : pdfViewer.currentScale;
          const nextLabel =
            typeof event.presetValue === 'string' && event.presetValue === 'page-width'
              ? '适合宽度'
              : `${Math.round(scale * 100)}%`;
          setZoomLabel(nextLabel);
        };

        eventBus.on('annotationeditoruimanager', handleAnnotationEditorUiManager);
        eventBus.on('annotationeditorstateschanged', handleEditorStatesChanged);
        eventBus.on('pagesinit', handlePagesInit);
        eventBus.on('pagechanging', handlePageChanging);
        eventBus.on('scalechanging', handleScaleChanging);

        const loadingTask = getDocument(documentInit as any);
        loadingTaskRef.current = loadingTask;

        return loadingTask.promise
          .then((pdfDocument: any) => {
            if (cancelled) {
              return;
            }

            pdfDocumentRef.current = pdfDocument;
            setPageCount(pdfDocument.numPages);
            setCurrentPage(1);
            linkService.setDocument(pdfDocument, null);
            pdfViewer.setDocument(pdfDocument);
          })
          .catch((loadError: unknown) => {
            if (cancelled) {
              return;
            }

            setError(loadError instanceof Error ? loadError.message : 'PDF 批注模式加载失败');
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

        setError(loadError instanceof Error ? loadError.message : 'PDF 批注模块加载失败');
        setLoading(false);
      });

    return () => {
      cancelled = true;
      annotationEditorReadyRef.current = false;
      annotationEditorUiManagerRef.current = null;
      eventBusRef.current = null;
      setHasSelectedEditor(false);
      if (eventBus && handlePagesInit) {
        eventBus.off('pagesinit', handlePagesInit);
      }
      if (eventBus && handleAnnotationEditorUiManager) {
        eventBus.off('annotationeditoruimanager', handleAnnotationEditorUiManager);
      }
      if (eventBus && handleEditorStatesChanged) {
        eventBus.off('annotationeditorstateschanged', handleEditorStatesChanged);
      }
      if (eventBus && handlePageChanging) {
        eventBus.off('pagechanging', handlePageChanging);
      }
      if (eventBus && handleScaleChanging) {
        eventBus.off('scalechanging', handleScaleChanging);
      }

      if (selectionTimerRef.current !== null) {
        window.clearTimeout(selectionTimerRef.current);
        selectionTimerRef.current = null;
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
  }, [documentInit]);

  const handleZoomIn = useCallback(() => {
    pdfViewerRef.current?.increaseScale();
    const currentScale = pdfViewerRef.current?.currentScale;

    if (typeof currentScale === 'number') {
      setZoomLabel(`${Math.round(currentScale * 100)}%`);
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    pdfViewerRef.current?.decreaseScale();
    const currentScale = pdfViewerRef.current?.currentScale;

    if (typeof currentScale === 'number') {
      setZoomLabel(`${Math.round(currentScale * 100)}%`);
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    if (!onTextSelect || toolModeRef.current !== 'select') {
      return;
    }

    if (selectionTimerRef.current !== null) {
      window.clearTimeout(selectionTimerRef.current);
    }

    selectionTimerRef.current = window.setTimeout(() => {
      const payload = getScopedSelectionPayload(containerRef.current);

      if (payload) {
        onTextSelect(payload);
      }
    }, 0);
  }, [onTextSelect]);

  const handleSave = useCallback(async () => {
    if (!pdfDocumentRef.current || saving) {
      return;
    }

    try {
      setSaving(true);
      setError('');
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
        setSaveMessage('已取消导出批注版 PDF');
        return;
      }

      if (
        protectedSourcePath &&
        normalizePathForCompare(targetPath) === normalizePathForCompare(protectedSourcePath)
      ) {
        throw new Error('娑撹桨绻氶幎銈呭斧婵?PDF閿涘矁顕崣锕€鐡ㄦ稉鐑樻煀閻ㄥ嫭澹掑▔銊︽瀮娴犺翰鈧?);
      }

      const nextBytes = await pdfDocumentRef.current.saveDocument();
      await writeLocalBinaryFile(targetPath, new Uint8Array(nextBytes));
      setSaveMessage(
        sourcePath
          ? `已保存批注版 PDF 到原文件同目录：${targetPath}`
          : `已导出批注版 PDF閿?{targetPath}`,
      );
      onSaveSuccess?.(targetPath);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '鐎电厧鍤幍瑙勬暈閻?PDF 失败');
    } finally {
      setSaving(false);
    }
  }, [currentPdfName, defaultSaveDirectory, onSaveSuccess, originalPdfPath, saving, source]);

  if (!documentInit) {
    return (
      <EmptyState
        title="鏈姞杞?PDF"
        description="閹佃鏁炲Ο鈥崇础閻╁瓨甯存担婊呮暏娴?PDF 鏈綋銆傚厛鎵撳紑褰撳墠鏂囨。鐨?PDF閿涘苯鍟€閸掑洦宕查崚鎷岀箹闁插被鈧?
      />
    );
  }

  return (
    <div className="paperquay-pdf-annotation flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,#eff4fb,#e9f0f7)]">
      <div className="border-b border-slate-200/80 bg-white/78 px-4 py-3 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1">
            {[
              {
                key: 'select' as const,
                label: '选择',
                icon: <MousePointer2 className="h-4 w-4" strokeWidth={1.8} />,
              },
              {
                key: 'highlight' as const,
                label: '高亮',
                icon: <Highlighter className="h-4 w-4" strokeWidth={1.8} />,
              },
              {
                key: 'freetext' as const,
                label: '文本',
                icon: <Type className="h-4 w-4" strokeWidth={1.8} />,
              },
              {
                key: 'ink' as const,
                label: '手写',
                icon: <PenTool className="h-4 w-4" strokeWidth={1.8} />,
              },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  if (item.key !== 'select') {
                    setActiveColorTool(item.key);
                  }

                  setToolMode(item.key);
                }}
                className={cn(
                  'inline-flex items-center gap-2 rounded-[14px] px-3 py-2 text-sm font-medium transition-all duration-200',
                  toolMode === item.key
                    ? 'bg-white text-indigo-600 shadow-[0_8px_18px_rgba(79,70,229,0.12)]'
                    : 'text-slate-500 hover:text-slate-800',
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>

          <div className="inline-flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/86 px-3 py-2">
            <span className="text-xs font-medium text-slate-500">
              {activeColorTool === 'highlight'
                ? '高亮颜色'
                : activeColorTool === 'freetext'
                  ? '文本颜色'
                  : '手写颜色'}
            </span>
            <div className="flex items-center gap-1.5">
              {PDF_ANNOTATION_COLOR_PRESETS.map((preset) => {
                const colorValue = getPdfAnnotationColorValue(preset, activeColorTool);
                const active = colorValue.toLowerCase() === activeToolColor.toLowerCase();

                return (
                  <button
                    key={`${activeColorTool}-${preset.id}`}
                    type="button"
                    onClick={() => updateAnnotationToolColor(activeColorTool, colorValue)}
                    className={cn(
                      'h-6 w-6 rounded-full border-2 transition-all duration-200',
                      active
                        ? 'scale-110 border-slate-900 shadow-[0_0_0_2px_rgba(255,255,255,0.9)]'
                        : 'border-white hover:scale-105 hover:border-slate-300',
                    )}
                    style={{ backgroundColor: colorValue }}
                    title={`${preset.label}?`}
                    aria-label={`${preset.label}?`}
                  />
                );
              })}
            </div>
            <label
              className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600 transition hover:border-slate-300 hover:bg-white"
              title="閼奉亜鐣炬稊澶愵杹閼?
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
              鑷畾涔?            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
              缁?{currentPage}/{Math.max(pageCount, 1)} 妞?            </div>
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
              {zoomLabel}
            </div>
            <button
              type="button"
              onClick={handleZoomOut}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-2 text-slate-600 transition-all duration-200 hover:bg-slate-50"
              title="缩小"
            >
              <ZoomOut className="h-4 w-4" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-2 text-slate-600 transition-all duration-200 hover:bg-slate-50"
              title="放大"
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
                  ? 'border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100'
                  : 'border-slate-200 bg-white text-slate-400',
              )}
              title="閸掔娀娅庤ぐ鎾冲闁鑵戦惃鍕濞?
            >
              <Trash2 className="mr-2 h-4 w-4" strokeWidth={1.8} />
              鍒犻櫎鎵€閫?            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || loading}
              className="inline-flex items-center rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.8} />
              ) : (
                <Download className="mr-2 h-4 w-4" strokeWidth={1.8} />
              )}
              {saving ? '瀵煎嚭涓? : '鐎电厧鍤幍瑙勬暈閻?PDF'}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
          <span>高亮模式下选择文本即可生成标准 PDF 高亮批注</span>
          <span>文本模式点击页面添加自由文本</span>
          <span>手写模式按住鼠标即可绘制批注</span>
        </div>
        {saveMessage ? <div className="mt-2 text-xs text-emerald-600">{saveMessage}</div> : null}
        {error ? <div className="mt-2 text-xs text-rose-600">{error}</div> : null}
      </div>

      <div className="relative min-h-0 flex-1">
        {loading ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(241,245,249,0.72)] backdrop-blur-sm">
            <div className="inline-flex items-center rounded-full border border-white/70 bg-white/92 px-4 py-2 text-sm text-slate-600 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.8} />
              正在加载 PDF 閹佃鏁炲銉ょ稊閸栬　鈧?            </div>
          </div>
        ) : null}

        <div
          ref={containerRef}
          onMouseUp={handleMouseUp}
          className="pdf-annotation-scroll absolute inset-0 overflow-auto px-5 py-5"
        >
          <div ref={viewerRef} className="pdfViewer" />
        </div>
      </div>
    </div>
  );
}

export default PdfAnnotationWorkspace;

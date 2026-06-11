import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, Star, Tag, Trash2 } from 'lucide-react';
import { useLocaleText } from '../../i18n/uiLanguage';
import { localPathExists } from '../../services/desktop';
import { lookupLiteratureMetadata } from '../../services/metadata';
import { extractLocalPdfMetadataPreview } from '../../services/pdfMetadata';
import {
  assignPaperToLibraryCategory,
  createLibraryCategory,
  deleteLibraryPaper,
  deleteLibraryCategory,
  getLibrarySettings,
  importPdfsToLibrary,
  initializeLiteratureLibrary,
  listLibraryCategories,
  listLibraryPapers,
  moveLibraryCategory,
  reorderLibraryPapers,
  selectLibraryPdfFiles,
  updateLibraryPaper,
  updateLibraryCategory,
  updateLibrarySettings,
} from '../../services/library';
import {
  detectLocalZoteroDataDir,
  listLocalZoteroCollectionItems,
  listLocalZoteroCollections,
  listLocalZoteroLibraryItems,
} from '../../services/zotero';
import type {
  LibrarySettings,
  LiteratureCategory,
  LiteraturePaper,
  LiteraturePaperTaskState,
  UpdatePaperRequest,
} from '../../types/library';
import type {
  ZoteroCollection,
  ZoteroLibraryItem,
} from '../../types/reader';
import { getFileNameFromPath } from '../../utils/text';
import ImportConfirmationDialog from './components/ImportConfirmationDialog';
import LibraryConfirmDialog from './components/LibraryConfirmDialog';
import LibraryTextInputDialog from './components/LibraryTextInputDialog';
import {
  mergeLocalPdfMetadataIntoDraft,
  mergeRemoteMetadataIntoDraft,
  titleFromPdfPath,
} from './importMetadata';
import type { ImportDraftItem } from './importTypes';
import LiteratureCategorySidebar from './components/LiteratureCategorySidebar';
import LiteraturePaperDetails from './components/LiteraturePaperDetails';
import LiteraturePaperList, {
  type LiteraturePaperListStatus,
} from './components/LiteraturePaperList';
import { flattenCategories, paperPdfPath } from './literatureUi';
import {
  filterZoteroItemsOutsideCollections,
  uniqueZoteroItems,
} from './zoteroImport';
import {
  emitLibrarySettingsUpdated,
  LIBRARY_METADATA_ENRICH_REQUEST_EVENT,
  LIBRARY_SETTINGS_UPDATED_EVENT,
  ZOTERO_IMPORT_REQUEST_EVENT,
  type LibrarySettingsUpdatedEventDetail,
  type ZoteroImportRequestEventDetail,
} from './libraryEvents';
import { useDesktopPdfDrop } from './useDesktopPdfDrop';
import {
  categorySignature,
  clampDetailsPanelWidth,
  clampFloatingMenuPosition,
  DETAILS_PANEL_DEFAULT_WIDTH,
  DETAILS_PANEL_WIDTH_STORAGE_KEY,
  applyPaperMineruStatusUpdate,
  applyPaperSummaryStatusUpdate,
  buildImportDraftsFromPdfPaths,
  buildInitialPaperStatuses,
  filterDemoPapers,
  hasMineruOutputForPaper,
  loadDetailsPanelWidth,
  markPaperStatusesCheckingMineru,
  metadataFromDraft,
  metadataFromZoteroItem,
  metadataUpdateForPaper,
  reorderPaperList,
  resolveSelectedPaperId,
  type LiteratureLibraryDemoState,
} from './literatureLibraryUtils';

interface LiteratureLibraryViewProps {
  onOpenPaper: (paper: LiteraturePaper) => void;
  mineruCacheDir?: string;
  autoLoadSiblingJson?: boolean;
  showReadingHeatmap?: boolean;
  demoLibrary?: LiteratureLibraryDemoState | null;
  paperActionStates?: Record<string, LiteraturePaperTaskState | null | undefined>;
  onRunMineruParse?: (paper: LiteraturePaper) => void;
  onTranslatePaper?: (paper: LiteraturePaper) => void;
  onGenerateSummary?: (paper: LiteraturePaper) => void;
}

interface NativeSummaryUpdatedEventDetail {
  paperId: string;
  aiSummary: string | null;
}

interface NativeMineruStatusUpdatedEventDetail {
  paperId: string;
  mineruParsed: boolean;
}

interface PaperContextMenuState {
  paper: LiteraturePaper;
  x: number;
  y: number;
}

interface MetadataDialogState {
  paper: LiteraturePaper;
  title: string;
  doi: string;
}

function buildManualMetadataUpdateRequest(
  paper: LiteraturePaper,
  metadata: Awaited<ReturnType<typeof lookupLiteratureMetadata>>,
  draft: Pick<MetadataDialogState, 'title' | 'doi'>,
): UpdatePaperRequest | null {
  const request: UpdatePaperRequest = {
    paperId: paper.id,
  };
  let changed = false;
  const assignString = (
    key: 'title' | 'year' | 'publication' | 'doi' | 'url' | 'abstractText',
    currentValue: string | null,
    nextValue: string | null | undefined,
  ) => {
    const normalized = nextValue?.trim();

    if (!normalized || normalized === currentValue?.trim()) {
      return;
    }

    request[key] = normalized;
    changed = true;
  };

  assignString('title', paper.title, metadata?.title || draft.title);
  assignString('doi', paper.doi, metadata?.doi || draft.doi);

  if (metadata) {
    assignString('year', paper.year, metadata.year);
    assignString('publication', paper.publication, metadata.publication);
    assignString('url', paper.url, metadata.url);
    assignString('abstractText', paper.abstractText, metadata.abstractText);

    const nextAuthors = metadata.authors.map((author) => author.trim()).filter(Boolean);

    if (nextAuthors.length > 0) {
      const currentAuthors = paper.authors.map((author) => author.name.trim()).filter(Boolean);

      if (nextAuthors.join('\n').toLocaleLowerCase() !== currentAuthors.join('\n').toLocaleLowerCase()) {
        request.authors = nextAuthors;
        changed = true;
      }
    }
  }

  return changed ? request : null;
}

type CategoryNameDialogState =
  | { mode: 'create'; parentCategory: LiteratureCategory | null }
  | { mode: 'rename'; category: LiteratureCategory };

type LibraryConfirmDialogState =
  | { kind: 'delete-category'; category: LiteratureCategory }
  | { kind: 'delete-paper'; paper: LiteraturePaper; deleteFiles: boolean };

export default function LiteratureLibraryView({
  onOpenPaper,
  mineruCacheDir = '',
  autoLoadSiblingJson = true,
  showReadingHeatmap = true,
  demoLibrary = null,
  paperActionStates = {},
  onRunMineruParse,
  onTranslatePaper,
  onGenerateSummary,
}: LiteratureLibraryViewProps) {
  const l = useLocaleText();
  const demoMode = Boolean(demoLibrary);
  const [settings, setSettings] = useState<LibrarySettings | null>(null);
  const [categories, setCategories] = useState<LiteratureCategory[]>([]);
  const [papers, setPapers] = useState<LiteraturePaper[]>([]);
  const [paperStatuses, setPaperStatuses] = useState<Record<string, LiteraturePaperListStatus>>({});
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [metadataWorking, setMetadataWorking] = useState(false);
  const [localImportMetadataWorking, setLocalImportMetadataWorking] = useState(false);
  const [bulkMetadataWorking, setBulkMetadataWorking] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [importDrafts, setImportDrafts] = useState<ImportDraftItem[]>([]);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [paperSaving, setPaperSaving] = useState(false);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [metadataAttemptedPaths, setMetadataAttemptedPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [categoryNameDialog, setCategoryNameDialog] =
    useState<CategoryNameDialogState | null>(null);
  const [confirmDialog, setConfirmDialog] =
    useState<LibraryConfirmDialogState | null>(null);
  const [paperContextMenu, setPaperContextMenu] =
    useState<PaperContextMenuState | null>(null);
  const [metadataDialog, setMetadataDialog] = useState<MetadataDialogState | null>(null);
  const [metadataDialogBusy, setMetadataDialogBusy] = useState(false);
  const [paperDragOverCategoryId, setPaperDragOverCategoryId] = useState<string | null>(null);
  const [tagDialogPaper, setTagDialogPaper] = useState<LiteraturePaper | null>(null);
  const [detailsPanelWidth, setDetailsPanelWidth] = useState(loadDetailsPanelWidth);
  const [detailsPanelResizing, setDetailsPanelResizing] = useState(false);
  const detailsPanelResizeStartRef = useRef({
    clientX: 0,
    width: DETAILS_PANEL_DEFAULT_WIDTH,
  });
  const selectedCategoryIdRef = useRef<string | null>(null);
  const checkedMineruPaperIdsRef = useRef<Set<string>>(new Set());
  const mineruStatusConfigKey = useMemo(
    () => `${mineruCacheDir.trim()}::${autoLoadSiblingJson ? 'auto-sibling' : 'cache-only'}`,
    [autoLoadSiblingJson, mineruCacheDir],
  );
  const mineruStatusConfigKeyRef = useRef(mineruStatusConfigKey);

  const flatCategories = useMemo(() => flattenCategories(categories), [categories]);
  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === selectedCategoryId) ?? null,
    [categories, selectedCategoryId],
  );
  const selectedPaper = useMemo(
    () => papers.find((paper) => paper.id === selectedPaperId) ?? papers[0] ?? null,
    [papers, selectedPaperId],
  );

  const resolveDemoPapers = useCallback(
    (nextCategoryId = selectedCategoryId) => {
      if (!demoLibrary) {
        return [];
      }

      return filterDemoPapers(demoLibrary, nextCategoryId, searchQuery);
    },
    [demoLibrary, searchQuery, selectedCategoryId],
  );

  const showDemoLockedMessage = useCallback(() => {
    setStatusMessage(
      l(
        '演示模式不允许修改真实文库。',
        'Demo mode does not allow changes to the real library.',
      ),
    );
  }, [l]);

  const refreshMineruStatusesForPapers = useCallback(
    async (
      targetPapers: LiteraturePaper[],
      shouldCancel: () => boolean = () => false,
    ) => {
      if (demoLibrary || targetPapers.length === 0) {
        return;
      }

      const uniquePapers = Array.from(
        new Map(targetPapers.map((paper) => [paper.id, paper])).values(),
      );
      const uncheckedPapers = uniquePapers.filter(
        (paper) => !checkedMineruPaperIdsRef.current.has(paper.id),
      );
      const uncheckedPaperIds = new Set(uncheckedPapers.map((paper) => paper.id));

      setPaperStatuses((current) =>
        markPaperStatusesCheckingMineru(current, uniquePapers, uncheckedPaperIds),
      );

      if (uncheckedPapers.length === 0) {
        return;
      }

      const entries = await Promise.all(
        uncheckedPapers.map(async (paper): Promise<[string, LiteraturePaperListStatus]> => [
          paper.id,
          {
            mineruParsed: await hasMineruOutputForPaper(
              paper,
              mineruCacheDir,
              autoLoadSiblingJson,
              localPathExists,
            ),
            overviewGenerated: Boolean(paper.aiSummary?.trim()),
            checkingMineru: false,
          },
        ]),
      );

      if (shouldCancel()) {
        return;
      }

      for (const [paperId] of entries) {
        checkedMineruPaperIdsRef.current.add(paperId);
      }

      setPaperStatuses((current) => ({
        ...current,
        ...Object.fromEntries(entries),
      }));
    },
    [autoLoadSiblingJson, demoLibrary, mineruCacheDir],
  );

  const refreshPapers = useCallback(
    async (nextCategoryId = selectedCategoryId) => {
      if (demoLibrary) {
        const nextPapers = resolveDemoPapers(nextCategoryId);

        setPapers(nextPapers);
        setSelectedPaperId((current) => resolveSelectedPaperId(current, nextPapers));
        return;
      }

      const nextPapers = await listLibraryPapers({
        categoryId: nextCategoryId,
        search: searchQuery,
        sortBy: 'manual',
        sortDirection: 'asc',
        limit: 500,
      });

      setPapers(nextPapers);
      setSelectedPaperId((current) => resolveSelectedPaperId(current, nextPapers));
    },
    [demoLibrary, resolveDemoPapers, searchQuery, selectedCategoryId],
  );

  const refreshAll = useCallback(async () => {
    if (demoLibrary) {
      const nextPapers = resolveDemoPapers();

      setSettings(demoLibrary.settings);
      setCategories(demoLibrary.categories);
      setPapers(nextPapers);
      setSelectedPaperId((current) => resolveSelectedPaperId(current, nextPapers));
      setStatusMessage(demoLibrary.statusMessage);
      return;
    }

    const [nextCategories, , allPapers] = await Promise.all([
      listLibraryCategories(),
      refreshPapers(),
      listLibraryPapers({
        sortBy: 'manual',
        sortDirection: 'asc',
        limit: 5000,
      }),
    ]);

    setCategories(nextCategories);
    void refreshMineruStatusesForPapers(allPapers);
  }, [demoLibrary, refreshMineruStatusesForPapers, refreshPapers, resolveDemoPapers]);

  const hydrateImportDraftsFromLocalPdf = useCallback(
    async (drafts: ImportDraftItem[]) => {
      if (drafts.length === 0) {
        return;
      }

      setLocalImportMetadataWorking(true);

      try {
        for (const draft of drafts) {
          const preview = await extractLocalPdfMetadataPreview(draft.path).catch(() => null);

          if (!preview) {
            continue;
          }

          setImportDrafts((current) =>
            current.map((item) => {
              if (item.path !== draft.path) {
                return item;
              }

              return mergeLocalPdfMetadataIntoDraft(item, preview);
            }),
          );
        }
      } finally {
        setLocalImportMetadataWorking(false);
      }
    },
    [],
  );

  const beginImportDrafts = useCallback(
    (paths: string[]) => {
      if (demoMode) {
        showDemoLockedMessage();
        return;
      }

      const { pdfPaths, drafts: nextDrafts } = buildImportDraftsFromPdfPaths({
        paths,
        existingDrafts: importDrafts,
        categories,
        selectedCategoryId,
      });

      if (pdfPaths.length === 0) {
        setStatusMessage(l('没有可导入的 PDF 文件', 'No importable PDF files were found'));
        return;
      }

      setImportDrafts((current) => [...current, ...nextDrafts]);
      setImportDialogOpen(true);
      setStatusMessage(
        l(
          `已准备 ${pdfPaths.length} 个 PDF，请确认元数据。`,
          `${pdfPaths.length} PDFs are ready. Please confirm metadata.`,
        ),
      );

      if (nextDrafts.length > 0) {
        void hydrateImportDraftsFromLocalPdf(nextDrafts);
      }
    },
    [
      categories,
      demoMode,
      hydrateImportDraftsFromLocalPdf,
      importDrafts,
      l,
      selectedCategoryId,
      showDemoLockedMessage,
    ],
  );

  useDesktopPdfDrop({
    onPdfPaths: beginImportDrafts,
    onDragStateChange: setDropActive,
  });

  useEffect(() => {
    try {
      localStorage.setItem(DETAILS_PANEL_WIDTH_STORAGE_KEY, String(detailsPanelWidth));
    } catch {
    }
  }, [detailsPanelWidth]);

  useEffect(() => {
    selectedCategoryIdRef.current = selectedCategoryId;
  }, [selectedCategoryId]);

  useEffect(() => {
    if (!detailsPanelResizing) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const start = detailsPanelResizeStartRef.current;

      setDetailsPanelWidth(clampDetailsPanelWidth(start.width + start.clientX - event.clientX));
    };

    const handlePointerUp = () => {
      setDetailsPanelResizing(false);
    };

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [detailsPanelResizing]);

  const handleStartDetailsPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
    }
    detailsPanelResizeStartRef.current = {
      clientX: event.clientX,
      width: detailsPanelWidth,
    };
    setDetailsPanelResizing(true);
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError('');

      try {
        if (demoLibrary) {
          const allCategory = demoLibrary.categories.find((category) => category.systemKey === 'all');
          const currentCategoryId = selectedCategoryIdRef.current;
          const nextSelectedCategoryId =
            currentCategoryId &&
            demoLibrary.categories.some((category) => category.id === currentCategoryId)
              ? currentCategoryId
              : allCategory?.id ?? demoLibrary.categories[0]?.id ?? null;
          const nextPapers = filterDemoPapers(demoLibrary, nextSelectedCategoryId, searchQuery);

          if (cancelled) {
            return;
          }

          setSettings(demoLibrary.settings);
          setCategories(demoLibrary.categories);
          setSelectedCategoryId(nextSelectedCategoryId);
          setPapers(nextPapers);
          setSelectedPaperId(nextPapers[0]?.id ?? null);
          setStatusMessage(demoLibrary.statusMessage);
          return;
        }

        const snapshot = await initializeLiteratureLibrary();

        if (cancelled) {
          return;
        }

        const allCategory = snapshot.categories.find((category) => category.systemKey === 'all');

        setSettings(snapshot.settings);
        setCategories(snapshot.categories);
        setSelectedCategoryId(allCategory?.id ?? snapshot.categories[0]?.id ?? null);
        setPapers(snapshot.papers);
        setSelectedPaperId(snapshot.papers[0]?.id ?? null);
        setStatusMessage(l('文献库已就绪', 'Library is ready'));
      } catch (nextError) {
        if (!cancelled) {
          const message =
            nextError instanceof Error
              ? nextError.message
              : l('初始化文献库失败', 'Failed to initialize the library');
          setError(message);
          setStatusMessage(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [demoLibrary]);

  useEffect(() => {
    const handleNativeSummaryUpdated = (event: Event) => {
      const detail = (event as CustomEvent<NativeSummaryUpdatedEventDetail>).detail;

      if (!detail?.paperId) {
        return;
      }

      setPapers((current) =>
        current.map((paper) =>
          paper.id === detail.paperId ? { ...paper, aiSummary: detail.aiSummary } : paper,
        ),
      );
      setPaperStatuses((current) =>
        applyPaperSummaryStatusUpdate(current, detail.paperId, detail.aiSummary),
      );
    };

    const handleNativeMineruStatusUpdated = (event: Event) => {
      const detail = (event as CustomEvent<NativeMineruStatusUpdatedEventDetail>).detail;

      if (!detail?.paperId) {
        return;
      }

      checkedMineruPaperIdsRef.current.add(detail.paperId);
      setPaperStatuses((current) =>
        applyPaperMineruStatusUpdate(current, detail.paperId, detail.mineruParsed),
      );
    };

    window.addEventListener('paperquay:native-summary-updated', handleNativeSummaryUpdated);
    window.addEventListener('paperquay:native-mineru-status-updated', handleNativeMineruStatusUpdated);

    return () => {
      window.removeEventListener('paperquay:native-summary-updated', handleNativeSummaryUpdated);
      window.removeEventListener('paperquay:native-mineru-status-updated', handleNativeMineruStatusUpdated);
    };
  }, []);

  useEffect(() => {
    if (demoLibrary) {
      setPaperStatuses(
        demoLibrary.paperStatuses ??
          buildInitialPaperStatuses(papers),
      );
      return undefined;
    }

    if (loading) {
      return undefined;
    }

    if (mineruStatusConfigKeyRef.current !== mineruStatusConfigKey) {
      mineruStatusConfigKeyRef.current = mineruStatusConfigKey;
      checkedMineruPaperIdsRef.current = new Set();
    }

    let cancelled = false;

    void (async () => {
      const allPapers = await listLibraryPapers({
        sortBy: 'manual',
        sortDirection: 'asc',
        limit: 5000,
      });
      await refreshMineruStatusesForPapers(allPapers, () => cancelled);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    demoLibrary,
    loading,
    mineruStatusConfigKey,
    refreshMineruStatusesForPapers,
  ]);

  useEffect(() => {
    if (loading) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshPapers().catch((nextError) => {
        const message =
          nextError instanceof Error ? nextError.message : l('搜索文献失败', 'Failed to search papers');
        setError(message);
      });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [loading, l, refreshPapers]);

  const handleSelectCategory = (categoryId: string) => {
    setSelectedCategoryId(categoryId);
    setError('');
    void refreshPapers(categoryId).catch((nextError) => {
      const message =
        nextError instanceof Error
          ? nextError.message
          : l('读取分类文献失败', 'Failed to load category papers');
      setError(message);
      setStatusMessage(message);
    });
  };

  const handleImportZoteroLibrary = async (preferredDataDir?: string) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    setWorking(true);
    setError('');

    try {
      const activeSettings = settings ?? await getLibrarySettings();
      let dataDir = preferredDataDir?.trim() || activeSettings.zoteroLocalDataDir.trim();

      if (!dataDir) {
        dataDir = (await detectLocalZoteroDataDir()) ?? '';
      }

      if (!dataDir) {
        setStatusMessage(
          l(
            '未找到 Zotero 本地数据目录。请先选择包含 zotero.sqlite 的文件夹。',
            'No Zotero local data directory was found. Choose the folder containing zotero.sqlite first.',
          ),
        );
        return;
      }

      const nextSettings = await updateLibrarySettings({
        ...activeSettings,
        zoteroLocalDataDir: dataDir,
      });
      setSettings(nextSettings);
      emitLibrarySettingsUpdated(nextSettings, 'literature-zotero-import');

      setStatusMessage(l('正在读取 Zotero 分类树...', 'Reading Zotero collection tree...'));
      const zoteroCollections = await listLocalZoteroCollections({ dataDir });
      setStatusMessage(l('正在读取 Zotero PDF 条目...', 'Reading Zotero PDF items...'));
      const allZoteroItems = uniqueZoteroItems(await listLocalZoteroLibraryItems({ dataDir }));

      if (zoteroCollections.length === 0 && allZoteroItems.length === 0) {
        setStatusMessage(l('没有可导入的 Zotero PDF。', 'No Zotero PDFs are available to import.'));
        return;
      }

      let currentCategories = await listLibraryCategories();
      const categoryIdByZoteroKey = new Map<string, string>();
      const collectionByKey = new Map(
        zoteroCollections.map((collection) => [collection.collectionKey, collection]),
      );

      const ensureCategoryForCollection = async (
        collection: ZoteroCollection,
        visiting = new Set<string>(),
      ): Promise<string> => {
        const existingId = categoryIdByZoteroKey.get(collection.collectionKey);

        if (existingId) {
          return existingId;
        }

        if (visiting.has(collection.collectionKey)) {
          throw new Error(
            l(
              'Zotero 分类树存在循环引用，无法导入。',
              'The Zotero collection tree has a cycle and cannot be imported.',
            ),
          );
        }

        visiting.add(collection.collectionKey);

        const parentCollection = collection.parentCollectionKey
          ? collectionByKey.get(collection.parentCollectionKey)
          : null;
        const parentId = parentCollection
          ? await ensureCategoryForCollection(parentCollection, visiting)
          : null;
        const normalizedName = collection.name.trim() || l('未命名 Zotero 分类', 'Untitled Zotero Collection');
        const existingCategory = currentCategories.find(
          (category) =>
            !category.isSystem &&
            category.parentId === parentId &&
            categorySignature(category.name, category.parentId) === categorySignature(normalizedName, parentId),
        );
        const category = existingCategory ?? await createLibraryCategory({
          name: normalizedName,
          parentId,
        });

        if (!existingCategory) {
          currentCategories = [...currentCategories, category];
        }

        categoryIdByZoteroKey.set(collection.collectionKey, category.id);
        return category.id;
      };

      const ensureTopLevelCategory = async (name: string): Promise<string> => {
        const normalizedName = name.trim();
        const existingCategory = currentCategories.find(
          (category) =>
            !category.isSystem &&
            category.parentId === null &&
            categorySignature(category.name, category.parentId) === categorySignature(normalizedName, null),
        );
        const category = existingCategory ?? await createLibraryCategory({
          name: normalizedName,
          parentId: null,
        });

        if (!existingCategory) {
          currentCategories = [...currentCategories, category];
        }

        return category.id;
      };

      for (const collection of zoteroCollections) {
        await ensureCategoryForCollection(collection);
      }

      let importedCount = 0;
      let duplicateCount = 0;
      let failedCount = 0;
      let missingPdfCount = 0;
      let unfiledCount = 0;
      const collectionItems: ZoteroLibraryItem[] = [];

      for (const collection of zoteroCollections) {
        const categoryId = categoryIdByZoteroKey.get(collection.collectionKey);

        if (!categoryId) {
          continue;
        }

        const items = await listLocalZoteroCollectionItems({
          dataDir,
          collectionKey: collection.collectionKey,
        });
        collectionItems.push(...items);

        const importableItems = items.filter((item) => item.localPdfPath);
        missingPdfCount += items.length - importableItems.length;

        if (importableItems.length === 0) {
          continue;
        }

        const metadata = Object.fromEntries(
          importableItems.map((item) => [item.localPdfPath as string, metadataFromZoteroItem(item)]),
        );
        const results = await importPdfsToLibrary({
          paths: importableItems.map((item) => item.localPdfPath as string),
          targetCategoryId: categoryId,
          importMode: 'copy',
          metadata,
        });

        for (const result of results) {
          if (result.status === 'imported') {
            importedCount += 1;
          } else if (result.status === 'duplicate') {
            duplicateCount += 1;

            if (result.existingPaperId) {
              await assignPaperToLibraryCategory({
                paperId: result.existingPaperId,
                categoryId,
              });
            }
          } else {
            failedCount += 1;
          }
        }
      }

      const unfiledItems = filterZoteroItemsOutsideCollections(allZoteroItems, collectionItems);
      unfiledCount = unfiledItems.length;

      if (unfiledItems.length > 0) {
        const unfiledCategoryId = await ensureTopLevelCategory(l('Zotero 未归档', 'Zotero Unfiled'));
        const importableItems = unfiledItems.filter((item) => item.localPdfPath);
        missingPdfCount += unfiledItems.length - importableItems.length;

        if (importableItems.length > 0) {
          const metadata = Object.fromEntries(
            importableItems.map((item) => [item.localPdfPath as string, metadataFromZoteroItem(item)]),
          );
          const results = await importPdfsToLibrary({
            paths: importableItems.map((item) => item.localPdfPath as string),
            targetCategoryId: unfiledCategoryId,
            importMode: 'copy',
            metadata,
          });

          for (const result of results) {
            if (result.status === 'imported') {
              importedCount += 1;
            } else if (result.status === 'duplicate') {
              duplicateCount += 1;

              if (result.existingPaperId) {
                await assignPaperToLibraryCategory({
                  paperId: result.existingPaperId,
                  categoryId: unfiledCategoryId,
                });
              }
            } else {
              failedCount += 1;
            }
          }
        }
      }

      await refreshAll();
      setStatusMessage(
        l(
          `Zotero 导入完成：${zoteroCollections.length} 个分类，${unfiledCount} 个未归档条目，导入 ${importedCount}，重复 ${duplicateCount}，失败 ${failedCount}，缺少本地 PDF ${missingPdfCount}。`,
          `Zotero import finished: ${zoteroCollections.length} collections, ${unfiledCount} unfiled items, ${importedCount} imported, ${duplicateCount} duplicated, ${failedCount} failed, ${missingPdfCount} missing local PDFs.`,
        ),
      );
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('导入 Zotero 文库失败', 'Failed to import the Zotero library');
      setError(message);
      setStatusMessage(message);
    } finally {
      setWorking(false);
    }
  };

  useEffect(() => {
    const handleLibrarySettingsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<LibrarySettingsUpdatedEventDetail>).detail;

      if (!detail?.settings || detail.source?.startsWith('literature')) {
        return;
      }

      setSettings(detail.settings);
    };

    const handleZoteroImportRequest = (event: Event) => {
      const detail = (event as CustomEvent<ZoteroImportRequestEventDetail>).detail;

      void handleImportZoteroLibrary(detail?.dataDir);
    };

    window.addEventListener(LIBRARY_SETTINGS_UPDATED_EVENT, handleLibrarySettingsUpdated);
    window.addEventListener(ZOTERO_IMPORT_REQUEST_EVENT, handleZoteroImportRequest);

    return () => {
      window.removeEventListener(LIBRARY_SETTINGS_UPDATED_EVENT, handleLibrarySettingsUpdated);
      window.removeEventListener(ZOTERO_IMPORT_REQUEST_EVENT, handleZoteroImportRequest);
    };
  }, [handleImportZoteroLibrary]);

  const handleImportPdfs = async () => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    setError('');

    try {
      const paths = await selectLibraryPdfFiles();

      if (paths.length === 0) {
        setStatusMessage(l('未选择 PDF', 'No PDFs selected'));
        return;
      }

      beginImportDrafts(paths);
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('导入 PDF 失败', 'Failed to import PDFs');
      setError(message);
      setStatusMessage(message);
    }
  };

  const handleImportDraftChange = (path: string, patch: Partial<ImportDraftItem>) => {
    setImportDrafts((current) =>
      current.map((draft) => (draft.path === path ? { ...draft, ...patch } : draft)),
    );
  };

  const handleRemoveImportDraft = (path: string) => {
    setImportDrafts((current) => current.filter((draft) => draft.path !== path));
  };

  const handleAutoFillImportMetadata = useCallback(
    async (targetDrafts = importDrafts, silent = false) => {
      if (demoMode) {
        showDemoLockedMessage();
        return;
      }

      const draftsToLookup = targetDrafts.filter((draft) => draft.path.trim());

      if (draftsToLookup.length === 0) {
        return;
      }

      setMetadataWorking(true);
      setError('');

      let filledCount = 0;
      let missedCount = 0;

      try {
        for (const draft of draftsToLookup) {
          const metadata = await lookupLiteratureMetadata({
            doi: draft.doi || null,
            title: draft.title || titleFromPdfPath(draft.path),
            path: draft.path,
          });

          if (!metadata) {
            missedCount += 1;
            continue;
          }

          const mergedDraft = mergeRemoteMetadataIntoDraft(draft, metadata);
          const changed =
            mergedDraft.title !== draft.title ||
            mergedDraft.authors !== draft.authors ||
            mergedDraft.year !== draft.year ||
            mergedDraft.publication !== draft.publication ||
            mergedDraft.doi !== draft.doi ||
            mergedDraft.url !== draft.url ||
            mergedDraft.abstractText !== draft.abstractText;

          if (!changed) {
            missedCount += 1;
            continue;
          }

          setImportDrafts((current) =>
            current.map((item) =>
              item.path === draft.path ? mergeRemoteMetadataIntoDraft(item, metadata) : item,
            ),
          );
          filledCount += 1;
        }

        if (!silent) {
          setStatusMessage(
            l(
              `元数据补全完成：匹配 ${filledCount}，未匹配 ${missedCount}。`,
              `Metadata enrichment finished: ${filledCount} matched, ${missedCount} not matched.`,
            ),
          );
        }
      } catch (nextError) {
        const message =
          nextError instanceof Error ? nextError.message : l('自动补全元数据失败', 'Failed to auto-fill metadata');
        setError(message);
        setStatusMessage(message);
      } finally {
        setMetadataWorking(false);
      }
    },
    [demoMode, importDrafts, l, showDemoLockedMessage],
  );

  useEffect(() => {
    if (
      !importDialogOpen ||
      importDrafts.length === 0 ||
      metadataWorking ||
      localImportMetadataWorking
    ) {
      return;
    }

    const nextDrafts = importDrafts.filter((draft) => !metadataAttemptedPaths.has(draft.path));

    if (nextDrafts.length === 0) {
      return;
    }

    setMetadataAttemptedPaths((current) => {
      const next = new Set(current);

      nextDrafts.forEach((draft) => next.add(draft.path));
      return next;
    });
    void handleAutoFillImportMetadata(nextDrafts, true);
  }, [
    handleAutoFillImportMetadata,
    importDialogOpen,
    demoMode,
    importDrafts,
    localImportMetadataWorking,
    showDemoLockedMessage,
    metadataAttemptedPaths,
    metadataWorking,
  ]);

  const handleCloseImportDialog = () => {
    if (working) {
      return;
    }

    setImportDialogOpen(false);
    setImportDrafts([]);
    setMetadataAttemptedPaths(new Set());
    setLocalImportMetadataWorking(false);
  };

  const handleConfirmImportDrafts = async () => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    if (importDrafts.length === 0) {
      return;
    }

    setWorking(true);
    setError('');

    try {
      const groupedDrafts = new Map<string, ImportDraftItem[]>();

      for (const draft of importDrafts) {
        const categoryKey = draft.categoryId.trim();
        groupedDrafts.set(categoryKey, [...(groupedDrafts.get(categoryKey) ?? []), draft]);
      }

      const results = [];

      for (const [categoryId, drafts] of groupedDrafts) {
        const metadata = Object.fromEntries(
          drafts.map((draft) => [draft.path, metadataFromDraft(draft)]),
        );
        const imported = await importPdfsToLibrary({
          paths: drafts.map((draft) => draft.path),
          targetCategoryId: categoryId || null,
          metadata,
        });

        results.push(...imported);
      }

      const importedCount = results.filter((result) => result.status === 'imported').length;
      const duplicateCount = results.filter((result) => result.status === 'duplicate').length;
      const failedCount = results.filter((result) => result.status === 'failed').length;
      const duplicateNames = results
        .filter((result) => result.status === 'duplicate')
        .map((result) => getFileNameFromPath(result.sourcePath))
        .slice(0, 3);
      const failedNames = results
        .filter((result) => result.status === 'failed')
        .map((result) => `${getFileNameFromPath(result.sourcePath)}: ${result.message}`)
        .slice(0, 2);

      await refreshAll();
      setImportDialogOpen(false);
      setImportDrafts([]);
      setMetadataAttemptedPaths(new Set());
      setLocalImportMetadataWorking(false);
      const duplicateSummary =
        duplicateNames.length > 0
          ? l(` 重复：${duplicateNames.join('、')}`, ` Duplicates: ${duplicateNames.join(', ')}`)
          : '';
      const failedSummary =
        failedNames.length > 0
          ? l(` 失败：${failedNames.join('；')}`, ` Failed: ${failedNames.join('; ')}`)
          : '';
      setStatusMessage(
        l(
          `导入完成：新增 ${importedCount}，重复 ${duplicateCount}，失败 ${failedCount}。${duplicateSummary}${failedSummary}`,
          `Import finished: ${importedCount} imported, ${duplicateCount} duplicated, ${failedCount} failed.${duplicateSummary}${failedSummary}`,
        ),
      );
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('导入 PDF 失败', 'Failed to import PDFs');
      setError(message);
      setStatusMessage(message);
    } finally {
      setWorking(false);
    }
  };

  const handleEnrichAllMetadata = async () => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    if (bulkMetadataWorking) {
      return;
    }

    setBulkMetadataWorking(true);
    setError('');

    try {
      const allPapers = await listLibraryPapers({
        sortBy: 'manual',
        sortDirection: 'asc',
        limit: 1000,
      });

      if (allPapers.length === 0) {
        setStatusMessage(l('当前文库没有可解析的文献', 'There are no papers to parse.'));
        return;
      }

      let updatedCount = 0;
      let unchangedCount = 0;
      let missedCount = 0;
      let failedCount = 0;

      for (const [index, paper] of allPapers.entries()) {
        setStatusMessage(
          l(
            `正在解析元数据：${index + 1}/${allPapers.length} - ${paper.title}`,
            `Parsing metadata: ${index + 1}/${allPapers.length} - ${paper.title}`,
          ),
        );

        try {
          const metadata = await lookupLiteratureMetadata({
            doi: paper.doi,
            title: paper.title,
            path: paperPdfPath(paper),
          });

          if (!metadata) {
            missedCount += 1;
            continue;
          }

          const updateRequest = metadataUpdateForPaper(paper, metadata);

          if (!updateRequest) {
            unchangedCount += 1;
            continue;
          }

          await updateLibraryPaper(updateRequest);
          updatedCount += 1;
        } catch {
          failedCount += 1;
        }
      }

      await refreshAll();

      const message = l(
        `元数据解析完成：更新 ${updatedCount}，无需更新 ${unchangedCount}，未匹配 ${missedCount}，失败 ${failedCount}。`,
        `Metadata parsing finished: ${updatedCount} updated, ${unchangedCount} unchanged, ${missedCount} not matched, ${failedCount} failed.`,
      );

      setStatusMessage(message);

      if (failedCount > 0) {
        setError(message);
      }
    } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : l('批量解析文献元数据失败', 'Failed to parse metadata for all papers');
      setError(message);
      setStatusMessage(message);
    } finally {
      setBulkMetadataWorking(false);
    }
  };

  useEffect(() => {
    const handleMetadataEnrichRequest = () => {
      void handleEnrichAllMetadata();
    };

    window.addEventListener(LIBRARY_METADATA_ENRICH_REQUEST_EVENT, handleMetadataEnrichRequest);

    return () => {
      window.removeEventListener(LIBRARY_METADATA_ENRICH_REQUEST_EVENT, handleMetadataEnrichRequest);
    };
  }, [handleEnrichAllMetadata]);

  const handleCreateCategory = (parentCategory?: LiteratureCategory | null) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    setCategoryNameDialog({
      mode: 'create',
      parentCategory: parentCategory && !parentCategory.isSystem ? parentCategory : null,
    });
  };

  const handleRenameCategory = (category: LiteratureCategory) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    if (category.isSystem) {
      return;
    }

    setCategoryNameDialog({
      mode: 'rename',
      category,
    });
  };

  const handleSubmitCategoryName = async (name: string) => {
    if (demoMode) {
      showDemoLockedMessage();
      setCategoryNameDialog(null);
      return;
    }

    if (!categoryNameDialog) {
      return;
    }

    setDialogBusy(true);
    setError('');
    try {
      if (categoryNameDialog.mode === 'create') {
        const category = await createLibraryCategory({
          name,
          parentId: categoryNameDialog.parentCategory?.id ?? null,
        });

        const nextCategories = await listLibraryCategories();
        setCategories(nextCategories);
        setSelectedCategoryId(category.id);
        await refreshPapers(category.id);
        setCategoryNameDialog(null);
        setStatusMessage(
          categoryNameDialog.parentCategory
            ? l(`已创建子分类：${category.name}`, `Created subcategory: ${category.name}`)
            : l(`已创建分类：${category.name}`, `Created category: ${category.name}`),
        );
        return;
      }

      if (name !== categoryNameDialog.category.name) {
        await updateLibraryCategory({
          id: categoryNameDialog.category.id,
          name,
        });
        setCategories(await listLibraryCategories());
        setStatusMessage(l('分类已重命名', 'Category renamed'));
      }

      setCategoryNameDialog(null);
    } catch (nextError) {
      const message =
        nextError instanceof Error
          ? nextError.message
          : categoryNameDialog.mode === 'create'
            ? l('创建分类失败', 'Failed to create category')
            : l('重命名分类失败', 'Failed to rename category');
      setError(message);
      setStatusMessage(message);
    } finally {
      setDialogBusy(false);
    }
  };

  const handleDeleteCategory = (category: LiteratureCategory) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    if (category.isSystem) {
      return;
    }

    setConfirmDialog({
      kind: 'delete-category',
      category,
    });
  };

  const deleteCategoryAfterConfirm = async (category: LiteratureCategory) => {
    setDialogBusy(true);
    setError('');
    try {
      await deleteLibraryCategory(category.id);
      const nextCategories = await listLibraryCategories();
      const allCategory = nextCategories.find((item) => item.systemKey === 'all');
      const nextSelectedCategoryId = allCategory?.id ?? nextCategories[0]?.id ?? null;

      setCategories(nextCategories);
      setSelectedCategoryId(nextSelectedCategoryId);
      await refreshPapers(nextSelectedCategoryId);
      setStatusMessage(l('分类已删除', 'Category deleted'));
      setConfirmDialog(null);
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('删除分类失败', 'Failed to delete category');
      setError(message);
      setStatusMessage(message);
    } finally {
      setDialogBusy(false);
    }
  };

  const handleMoveCategory = async (categoryId: string, parentId: string | null) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    setError('');

    try {
      const movedCategory = await moveLibraryCategory({
        categoryId,
        parentId,
      });

      setCategories(await listLibraryCategories());
      setSelectedCategoryId(movedCategory.id);
      setStatusMessage(
        parentId
          ? l(`已调整分类层级：${movedCategory.name}`, `Updated category hierarchy: ${movedCategory.name}`)
          : l(`已移到顶层分类：${movedCategory.name}`, `Moved category to root: ${movedCategory.name}`),
      );
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('移动分类失败', 'Failed to move category');
      setError(message);
      setStatusMessage(message);
    }
  };

  const reloadAfterPaperUpdate = async (updatedPaper: LiteraturePaper) => {
    const [nextCategories, nextPapers] = await Promise.all([
      listLibraryCategories(),
      listLibraryPapers({
        categoryId: selectedCategoryId,
        search: searchQuery,
        sortBy: 'manual',
        sortDirection: 'asc',
        limit: 500,
      }),
    ]);

    setCategories(nextCategories);
    setPapers(nextPapers);
    setSelectedPaperId(
      nextPapers.some((paper) => paper.id === updatedPaper.id)
        ? updatedPaper.id
        : nextPapers[0]?.id ?? null,
    );
  };

  const handleSavePaper = async (request: UpdatePaperRequest) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    setPaperSaving(true);
    setError('');

    try {
      const updatedPaper = await updateLibraryPaper(request);
      await reloadAfterPaperUpdate(updatedPaper);
      setStatusMessage(l('文献信息已保存', 'Paper metadata saved'));
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('保存文献信息失败', 'Failed to save paper metadata');
      setError(message);
      setStatusMessage(message);
    } finally {
      setPaperSaving(false);
    }
  };

  const handleDeletePaper = (paper: LiteraturePaper) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    setConfirmDialog({
      kind: 'delete-paper',
      paper,
      deleteFiles: selectedCategory?.systemKey === 'all',
    });
  };

  const deletePaperAfterConfirm = async (paper: LiteraturePaper, deleteFiles: boolean) => {
    setPaperSaving(true);
    setDialogBusy(true);
    setError('');

    try {
      await deleteLibraryPaper({ paperId: paper.id, deleteFiles });
      await refreshAll();
      setStatusMessage(
        deleteFiles
          ? l('文献记录和 PDF 文件已删除。', 'Paper record and PDF files deleted.')
          : l('文献记录已删除，PDF 文件未删除。', 'Paper record deleted. PDF files were not deleted.'),
      );
      setConfirmDialog(null);
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('删除文献记录失败', 'Failed to delete paper record');
      setError(message);
      setStatusMessage(message);
    } finally {
      setPaperSaving(false);
      setDialogBusy(false);
    }
  };

  const handlePaperDragStart = (
    event: DragEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => {
    event.dataTransfer.setData('application/x-paperquay-paper-id', paper.id);
    event.dataTransfer.setData('text/plain', paper.id);
    event.dataTransfer.effectAllowed = 'move';
  };

  const assignPaperToCategory = async (paperId: string, category: LiteratureCategory) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    if (category.isSystem) {
      return;
    }

    try {
      await assignPaperToLibraryCategory({
        paperId,
        categoryId: category.id,
      });
      const nextCategories = await listLibraryCategories();

      setCategories(nextCategories);
      setSelectedCategoryId(category.id);
      await refreshPapers(category.id);
      setSelectedPaperId(paperId);
      setStatusMessage(l(`已添加到分类：${category.name}`, `Added to category: ${category.name}`));
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('移动文献失败', 'Failed to move paper');
      setError(message);
      setStatusMessage(message);
    } finally {
      setPaperDragOverCategoryId(null);
    }
  };

  const handlePaperDropOnCategory = (paperId: string, categoryId: string) => {
    const category = categories.find((item) => item.id === categoryId);

    if (!category) {
      setPaperDragOverCategoryId(null);
      return;
    }

    void assignPaperToCategory(paperId, category);
  };

  const handlePaperReorder = async (
    draggedPaperId: string,
    targetPaperId: string,
    placement: 'before' | 'after',
  ) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    const nextPapers = reorderPaperList(papers, draggedPaperId, targetPaperId, placement);

    if (nextPapers === papers) {
      return;
    }

    setPapers(nextPapers);
    setError('');

    try {
      await reorderLibraryPapers({
        paperIds: nextPapers.map((paper) => paper.id),
      });
      setStatusMessage(l('文献排序已保存', 'Paper order saved'));
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('保存文献排序失败', 'Failed to save paper order');
      setError(message);
      setStatusMessage(message);
      await refreshPapers();
    }
  };

  const handlePaperContextMenu = (
    event: MouseEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedPaperId(paper.id);
    const position = clampFloatingMenuPosition(event.clientX, event.clientY, 240, 220);
    setPaperContextMenu({
      paper,
      x: position.x,
      y: position.y,
    });
  };

  const handleOpenTagDialogFromContextMenu = () => {
    if (demoMode) {
      showDemoLockedMessage();
      setPaperContextMenu(null);
      return;
    }

    const paper = paperContextMenu?.paper;

    setPaperContextMenu(null);

    if (paper) {
      setTagDialogPaper(paper);
    }
  };

  const handleOpenMetadataDialogFromContextMenu = () => {
    if (demoMode) {
      showDemoLockedMessage();
      setPaperContextMenu(null);
      return;
    }

    const paper = paperContextMenu?.paper;

    setPaperContextMenu(null);

    if (paper) {
      setMetadataDialog({
        paper,
        title: paper.title,
        doi: paper.doi ?? '',
      });
    }
  };

  const handleSubmitMetadataDialog = async () => {
    if (demoMode) {
      showDemoLockedMessage();
      setMetadataDialog(null);
      return;
    }

    if (!metadataDialog || metadataDialogBusy) {
      return;
    }

    const title = metadataDialog.title.trim();
    const doi = metadataDialog.doi.trim();

    if (!title && !doi) {
      setError(l('请输入标题或 DOI 后再解析元数据。', 'Enter a title or DOI before parsing metadata.'));
      return;
    }

    setMetadataDialogBusy(true);
    setError('');

    try {
      const metadata = await lookupLiteratureMetadata({
        doi: doi || null,
        title: title || metadataDialog.paper.title,
        path: paperPdfPath(metadataDialog.paper),
      });
      const updateRequest = buildManualMetadataUpdateRequest(
        metadataDialog.paper,
        metadata,
        { title, doi },
      );

      if (!metadata && !updateRequest) {
        setStatusMessage(l('未匹配到元数据，请调整标题或 DOI 后重试。', 'No metadata matched. Adjust the title or DOI and try again.'));
        setError(l('未匹配到元数据。', 'No metadata matched.'));
        return;
      }

      if (!updateRequest) {
        setMetadataDialog(null);
        setStatusMessage(l('文献元数据已是最新。', 'Paper metadata is already up to date.'));
        return;
      }

      const updatedPaper = await updateLibraryPaper(updateRequest);
      await reloadAfterPaperUpdate(updatedPaper);
      setMetadataDialog(null);
      setStatusMessage(
        metadata
          ? l('文献元数据已更新。', 'Paper metadata updated.')
          : l('未匹配到远程元数据，已保存手动输入的标题或 DOI。', 'No remote metadata matched. Manual title or DOI saved.'),
      );
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('解析文献元数据失败', 'Failed to parse paper metadata');
      setError(message);
      setStatusMessage(message);
    } finally {
      setMetadataDialogBusy(false);
    }
  };

  const handleToggleFavoriteFromContextMenu = async () => {
    if (demoMode) {
      showDemoLockedMessage();
      setPaperContextMenu(null);
      return;
    }

    const paper = paperContextMenu?.paper;

    setPaperContextMenu(null);

    if (!paper) {
      return;
    }

    const nextFavorite = !paper.isFavorite;
    setPaperSaving(true);
    setError('');

    try {
      const updatedPaper = await updateLibraryPaper({
        paperId: paper.id,
        isFavorite: nextFavorite,
      });

      await reloadAfterPaperUpdate(updatedPaper);
      setStatusMessage(
        nextFavorite
          ? l('已加入收藏', 'Added to favorites')
          : l('已取消收藏', 'Removed from favorites'),
      );
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('更新收藏状态失败', 'Failed to update favorite status');
      setError(message);
      setStatusMessage(message);
    } finally {
      setPaperSaving(false);
    }
  };

  const handleDeletePaperFromContextMenu = () => {
    const paper = paperContextMenu?.paper;

    setPaperContextMenu(null);

    if (paper) {
      handleDeletePaper(paper);
    }
  };

  const handleSubmitPaperTag = async (tagName: string) => {
    if (demoMode) {
      showDemoLockedMessage();
      setTagDialogPaper(null);
      return;
    }

    if (!tagDialogPaper) {
      return;
    }

    const normalizedTag = tagName.trim();

    if (!normalizedTag) {
      return;
    }

    const existingTags = tagDialogPaper.tags.map((tag) => tag.name.trim()).filter(Boolean);
    const hasTag = existingTags.some(
      (tag) => tag.toLocaleLowerCase() === normalizedTag.toLocaleLowerCase(),
    );

    if (hasTag) {
      setTagDialogPaper(null);
      setStatusMessage(l(`标签已存在：${normalizedTag}`, `Tag already exists: ${normalizedTag}`));
      return;
    }

    setDialogBusy(true);
    setError('');

    try {
      const updatedPaper = await updateLibraryPaper({
        paperId: tagDialogPaper.id,
        tags: [...existingTags, normalizedTag],
      });
      const [nextCategories, nextPapers] = await Promise.all([
        listLibraryCategories(),
        listLibraryPapers({
          categoryId: selectedCategoryId,
          search: searchQuery,
          sortBy: 'manual',
          sortDirection: 'asc',
          limit: 500,
        }),
      ]);

      setCategories(nextCategories);
      setPapers(nextPapers);
      setSelectedPaperId(
        nextPapers.some((paper) => paper.id === updatedPaper.id)
          ? updatedPaper.id
          : nextPapers[0]?.id ?? null,
      );
      setTagDialogPaper(null);
      setStatusMessage(l(`已添加标签：${normalizedTag}`, `Added tag: ${normalizedTag}`));
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('添加标签失败', 'Failed to add tag');
      setError(message);
      setStatusMessage(message);
    } finally {
      setDialogBusy(false);
    }
  };

  const handleCategoryDrop = async (
    event: DragEvent<HTMLButtonElement>,
    category: LiteratureCategory,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    if (category.isSystem) {
      return;
    }

    const paperId =
      event.dataTransfer.getData('application/x-paperquay-paper-id') ||
      event.dataTransfer.getData('text/plain');

    if (!paperId) {
      return;
    }

    await assignPaperToCategory(paperId, category);
  };

  return (
    <div
      className="pq-saas-scope pq-library-workspace pq-workspace-surface relative grid h-full min-h-0 overflow-hidden text-[var(--pq-text)]"
      style={{
        gridTemplateColumns: `248px minmax(360px,1fr) ${detailsPanelWidth}px`,
        gridTemplateRows: 'minmax(0, 1fr)',
      }}
    >
      <div data-tour="library-sidebar" className="h-full min-h-0 overflow-hidden">
        <LiteratureCategorySidebar
          categories={flatCategories}
          selectedCategoryId={selectedCategoryId}
          onCreateCategory={handleCreateCategory}
          onSelectCategory={handleSelectCategory}
          onRenameCategory={handleRenameCategory}
          onDeleteCategory={handleDeleteCategory}
          onCategoryMove={(categoryId, parentId) => void handleMoveCategory(categoryId, parentId)}
          externalDragOverCategoryId={paperDragOverCategoryId}
          onCategoryDrop={(event, category) => void handleCategoryDrop(event, category)}
        />
      </div>

      <div data-tour="paper-list" className="h-full min-h-0 overflow-hidden">
        <LiteraturePaperList
          loading={loading}
          working={working}
          papers={papers}
          paperStatuses={paperStatuses}
          showReadingHeatmap={showReadingHeatmap}
          selectedPaper={selectedPaper}
          searchQuery={searchQuery}
          statusMessage={statusMessage}
          error={error}
          onSearchQueryChange={setSearchQuery}
          onImportPdfs={() => void handleImportPdfs()}
          onRefresh={() => void refreshAll()}
          onSelectPaper={setSelectedPaperId}
          onOpenPaper={onOpenPaper}
          onPaperDragStart={handlePaperDragStart}
          onPaperReorder={(draggedPaperId, targetPaperId, placement) =>
          void handlePaperReorder(draggedPaperId, targetPaperId, placement)
        }
        onPaperDropOnCategory={handlePaperDropOnCategory}
        onPaperPointerDragOverCategory={setPaperDragOverCategoryId}
        onPaperContextMenu={handlePaperContextMenu}
      />
      </div>

      <div data-tour="ai-summary" className="h-full min-h-0 overflow-hidden">
        <LiteraturePaperDetails
          selectedPaper={selectedPaper}
          saving={paperSaving}
          onOpenPaper={onOpenPaper}
          onSavePaper={(request) => void handleSavePaper(request)}
          actionState={selectedPaper ? paperActionStates[selectedPaper.id] ?? null : null}
          onRunMineruParse={onRunMineruParse}
          onTranslatePaper={onTranslatePaper}
          onGenerateSummary={onGenerateSummary}
        />
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={l('拖动调整详情面板宽度', 'Drag to resize the details panel')}
        title={l('拖动调整详情面板宽度', 'Drag to resize the details panel')}
        onPointerDown={handleStartDetailsPanelResize}
        onDoubleClick={() => setDetailsPanelWidth(DETAILS_PANEL_DEFAULT_WIDTH)}
        className={[
          'absolute bottom-0 top-0 z-40 w-4 -translate-x-1/2 cursor-col-resize touch-none',
          detailsPanelResizing ? 'bg-teal-400/10' : 'bg-transparent hover:bg-teal-400/[0.04]',
        ].join(' ')}
        style={{
          right: detailsPanelWidth - 1,
          touchAction: 'none',
        }}
      >
        <div
          className={[
            'mx-auto h-full w-px transition',
            detailsPanelResizing
              ? 'bg-teal-400 shadow-[0_0_0_3px_rgba(45,212,191,0.16)]'
              : 'bg-slate-200 hover:bg-teal-300 dark:bg-white/10 dark:hover:bg-teal-300/60',
          ].join(' ')}
        />
      </div>

      {dropActive ? (
        <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-[var(--pq-accent-border-strong)] bg-[var(--pq-accent-bg)] text-center backdrop-blur-[2px]">
          <div className="pq-acrylic px-8 py-6">
            <div className="text-xl font-semibold">
              {l('松开鼠标导入 PDF', 'Drop to import PDFs')}
            </div>
            <div className="mt-2 text-sm text-[var(--pq-text-muted)]">
              {l('导入前会先显示元数据确认界面。', 'A metadata confirmation screen will appear before import.')}
            </div>
          </div>
        </div>
      ) : null}

      {paperContextMenu ? createPortal(
        <div
          className="fixed inset-0 z-[10000]"
          onClick={() => setPaperContextMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault();
            setPaperContextMenu(null);
          }}
        >
          <div
            className="pq-acrylic fixed w-60 p-1.5"
            style={{
              left: paperContextMenu.x,
              top: paperContextMenu.y,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-white/10 dark:text-[#a0a0a0]">
              {paperContextMenu.paper.title}
            </div>
            <button
              type="button"
              onClick={() => void handleToggleFavoriteFromContextMenu()}
              disabled={paperSaving}
              className="mt-1 flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:text-[#e0e0e0] dark:hover:bg-white/[0.06]"
            >
              <Star
                className="mr-2 h-4 w-4 text-amber-500"
                fill={paperContextMenu.paper.isFavorite ? 'currentColor' : 'none'}
                strokeWidth={1.9}
              />
              {paperContextMenu.paper.isFavorite
                ? l('取消收藏', 'Remove from Favorites')
                : l('加入收藏', 'Add to Favorites')}
            </button>
            <button
              type="button"
              onClick={handleOpenTagDialogFromContextMenu}
              className="mt-1 flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-[#e0e0e0] dark:hover:bg-white/[0.06]"
            >
              <Tag className="mr-2 h-4 w-4 text-cyan-600 dark:text-cyan-200" strokeWidth={1.9} />
              {l('添加自定义标签', 'Add Custom Tag')}
            </button>
            <button
              type="button"
              onClick={() => void handleOpenMetadataDialogFromContextMenu()}
              className="mt-1 flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-[#e0e0e0] dark:hover:bg-white/[0.06]"
            >
              <Sparkles className="mr-2 h-4 w-4 text-violet-600 dark:text-violet-200" strokeWidth={1.9} />
              {l('解析元数据', 'Parse Metadata')}
            </button>
            <div className="my-1 border-t border-slate-100 dark:border-white/10" />
            <button
              type="button"
              onClick={handleDeletePaperFromContextMenu}
              className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-400/10"
            >
              <Trash2 className="mr-2 h-4 w-4" strokeWidth={1.9} />
              {l('删除文献记录', 'Delete Paper Record')}
            </button>
          </div>
        </div>,
        document.body,
      ) : null}

      {metadataDialog ? createPortal(
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-[2px]"
          onMouseDown={() => {
            if (!metadataDialogBusy) {
              setMetadataDialog(null);
            }
          }}
        >
          <form
            className="pq-card w-[min(520px,calc(100vw-32px))] p-4 shadow-[var(--pq-shadow-dialog)]"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmitMetadataDialog();
            }}
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--pq-accent-bg)] text-[var(--pq-accent)]">
                <Sparkles className="h-4.5 w-4.5" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-[var(--pq-text)]">
                  {l('解析元数据', 'Parse Metadata')}
                </h2>
                <p className="mt-1 text-sm leading-6 text-[var(--pq-text-muted)]">
                  {l('先修正标题或 DOI，再用这些信息重新匹配并更新文献元数据。', 'Correct the title or DOI first, then use them to match and update paper metadata.')}
                </p>
              </div>
            </div>

            <label className="mt-4 block">
              <span className="mb-1.5 block text-xs font-medium text-[var(--pq-text-muted)]">
                {l('标题', 'Title')}
              </span>
              <input
                value={metadataDialog.title}
                onChange={(event) =>
                  setMetadataDialog((current) =>
                    current ? { ...current, title: event.target.value } : current,
                  )
                }
                className="pq-input h-10 w-full px-3 text-sm"
                autoFocus
              />
            </label>

            <label className="mt-3 block">
              <span className="mb-1.5 block text-xs font-medium text-[var(--pq-text-muted)]">
                DOI
              </span>
              <input
                value={metadataDialog.doi}
                onChange={(event) =>
                  setMetadataDialog((current) =>
                    current ? { ...current, doi: event.target.value } : current,
                  )
                }
                placeholder="10.xxxx/xxxxx"
                className="pq-input h-10 w-full px-3 text-sm"
              />
            </label>

            <div className="mt-3 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border-subtle)] bg-[var(--pq-bg-secondary)] px-3 py-2 text-xs leading-5 text-[var(--pq-text-faint)]">
              <div className="font-medium text-[var(--pq-text-muted)]">{l('PDF 文件', 'PDF File')}</div>
              <div className="mt-0.5 truncate" title={paperPdfPath(metadataDialog.paper) || undefined}>
                {paperPdfPath(metadataDialog.paper) || l('未找到 PDF 路径', 'No PDF path found')}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMetadataDialog(null)}
                disabled={metadataDialogBusy}
                className="pq-button h-9 px-3 text-sm"
              >
                {l('取消', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={metadataDialogBusy}
                className="pq-button-primary h-9 px-3 text-sm disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4" strokeWidth={1.9} />
                {metadataDialogBusy ? l('解析中...', 'Parsing...') : l('解析并更新', 'Parse and Update')}
              </button>
            </div>
          </form>
        </div>,
        document.body,
      ) : null}

      <ImportConfirmationDialog
        open={importDialogOpen}
        drafts={importDrafts}
        categories={categories}
        working={working}
        metadataWorking={metadataWorking || localImportMetadataWorking}
        onDraftChange={handleImportDraftChange}
        onRemoveDraft={handleRemoveImportDraft}
        onAutoFillMetadata={() => void handleAutoFillImportMetadata(importDrafts)}
        onClose={handleCloseImportDialog}
        onConfirm={() => void handleConfirmImportDrafts()}
      />

      <LibraryTextInputDialog
        open={categoryNameDialog !== null}
        title={
          categoryNameDialog?.mode === 'rename'
            ? l('重命名分类', 'Rename Category')
            : categoryNameDialog?.parentCategory
              ? l('新建子分类', 'New Subcategory')
              : l('新建分类', 'New Category')
        }
        description={
          categoryNameDialog?.mode === 'create' && categoryNameDialog.parentCategory
            ? l(`在“${categoryNameDialog.parentCategory.name}”下创建子分类。`, `Create a subcategory under "${categoryNameDialog.parentCategory.name}".`,
              )
            : categoryNameDialog?.mode === 'create'
              ? l('分类会显示在文库目录树中，可通过拖拽调整位置。', 'The category will appear in the library tree and can be rearranged by drag and drop.')
              : l('只会修改分类名称，不会移动或删除 PDF 文件。', 'Only the category name changes. Paper files are not moved or deleted.')
        }
        label={l('分类名称', 'Category Name')}
        initialValue={categoryNameDialog?.mode === 'rename' ? categoryNameDialog.category.name : ''}
        placeholder={l('例如：文献综述', 'e.g. Literature Review')}
        confirmLabel={categoryNameDialog?.mode === 'rename' ? l('保存', 'Save') : l('创建', 'Create')}
        cancelLabel={l('取消', 'Cancel')}
        busy={dialogBusy}
        onClose={() => {
          if (!dialogBusy) {
            setCategoryNameDialog(null);
          }
        }}
        onSubmit={(value) => void handleSubmitCategoryName(value)}
      />

      <LibraryTextInputDialog
        open={tagDialogPaper !== null}
        title={l('添加自定义标签', 'Add Custom Tag')}
        description={
          tagDialogPaper
            ? l(`为“${tagDialogPaper.title}”添加自定义标签。状态徽章不会保存为文献标签。`, `Add a custom tag to "${tagDialogPaper.title}". Status badges are not saved as paper tags.`,
              )
            : ''
        }
        label={l('标签名称', 'Tag Name')}
        initialValue=""
        placeholder={l('例如：待读 / 方法 / 综述', 'e.g. To Read / Method / Review')}
        confirmLabel={l('添加', 'Add')}
        cancelLabel={l('取消', 'Cancel')}
        busy={dialogBusy}
        onClose={() => {
          if (!dialogBusy) {
            setTagDialogPaper(null);
          }
        }}
        onSubmit={(value) => void handleSubmitPaperTag(value)}
      />

      <LibraryConfirmDialog
        open={confirmDialog !== null}
        title={
          confirmDialog?.kind === 'delete-category'
            ? l('删除分类', 'Delete Category')
            : l('删除文献', 'Delete Paper')
        }
        description={
          confirmDialog?.kind === 'delete-category'
            ? l(`删除分类“${confirmDialog.category.name}”及其所有子分类？这只会移除分类关系，不会删除磁盘上的 PDF 文件。`, `Delete category "${confirmDialog.category.name}" and all subcategories? This only removes category relations and does not delete PDF files on disk.`,
              )
            : confirmDialog?.kind === 'delete-paper'
              ? confirmDialog.deleteFiles
                ? l(`从所有文献中删除“${confirmDialog.paper.title}”？这也会删除磁盘上的 PDF 文件。`, `Delete "${confirmDialog.paper.title}" from All Papers? This will also delete PDF files from disk.`,
                  )
                : l(`删除“${confirmDialog.paper.title}”的文献记录？磁盘上的 PDF 文件不会被删除。`, `Delete the paper record for "${confirmDialog.paper.title}"? PDF files on disk will not be deleted.`,
                  )
              : ''
        }
        confirmLabel={l('删除', 'Delete')}
        cancelLabel={l('取消', 'Cancel')}
        busy={dialogBusy}
        danger
        onClose={() => {
          if (!dialogBusy) {
            setConfirmDialog(null);
          }
        }}
        onConfirm={() => {
          if (!confirmDialog) {
            return;
          }

          if (confirmDialog.kind === 'delete-category') {
            void deleteCategoryAfterConfirm(confirmDialog.category);
            return;
          }

          void deletePaperAfterConfirm(confirmDialog.paper, confirmDialog.deleteFiles);
        }}
      />
    </div>
  );
}


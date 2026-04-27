import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
} from 'react';
import { useLocaleText } from '../../i18n/uiLanguage';
import { selectDirectory } from '../../services/desktop';
import {
  assignPaperToLibraryCategory,
  createLibraryCategory,
  deleteLibraryPaper,
  deleteLibraryCategory,
  importPdfsToLibrary,
  initializeLiteratureLibrary,
  listLibraryCategories,
  listLibraryPapers,
  moveLibraryCategory,
  selectLibraryPdfFiles,
  updateLibraryPaper,
  updateLibraryCategory,
  updateLibrarySettings,
} from '../../services/library';
import {
  detectLocalZoteroDataDir,
  listLocalZoteroCollectionItems,
  listLocalZoteroCollections,
  selectLocalZoteroDataDir,
} from '../../services/zotero';
import type {
  ImportPdfMetadata,
  LibrarySettings,
  LiteratureCategory,
  LiteraturePaper,
  UpdatePaperRequest,
} from '../../types/library';
import type {
  ZoteroCollection,
  ZoteroLibraryItem,
} from '../../types/reader';
import { getFileNameFromPath } from '../../utils/text';
import ImportConfirmationDialog, {
  type ImportDraftItem,
} from './components/ImportConfirmationDialog';
import LibraryConfirmDialog from './components/LibraryConfirmDialog';
import LibrarySettingsDialog from './components/LibrarySettingsDialog';
import LibraryTextInputDialog from './components/LibraryTextInputDialog';
import LiteratureCategorySidebar from './components/LiteratureCategorySidebar';
import LiteraturePaperDetails from './components/LiteraturePaperDetails';
import LiteraturePaperList from './components/LiteraturePaperList';
import { flattenCategories } from './literatureUi';
import { useTauriPdfDrop } from './useTauriPdfDrop';

interface LiteratureLibraryViewProps {
  onOpenPaper: (paper: LiteraturePaper) => void;
  onOpenSettings: () => void;
}

type CategoryNameDialogState =
  | { mode: 'create'; parentCategory: LiteratureCategory | null }
  | { mode: 'rename'; category: LiteratureCategory };

type LibraryConfirmDialogState =
  | { kind: 'delete-category'; category: LiteratureCategory }
  | { kind: 'delete-paper'; paper: LiteraturePaper };

function titleFromPdfPath(path: string): string {
  return getFileNameFromPath(path).replace(/\.pdf$/i, '') || 'Untitled PDF';
}

function splitAuthors(value: string): string[] {
  return value
    .split(/[;,，；]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function metadataFromDraft(draft: ImportDraftItem): ImportPdfMetadata {
  return {
    title: draft.title.trim() || titleFromPdfPath(draft.path),
    authors: splitAuthors(draft.authors),
    year: draft.year.trim() || null,
    publication: draft.publication.trim() || null,
    doi: draft.doi.trim() || null,
  };
}

function metadataFromZoteroItem(item: ZoteroLibraryItem): ImportPdfMetadata {
  const year = item.year.trim();

  return {
    title: item.title.trim() || item.attachmentFilename || item.itemKey,
    authors: splitAuthors(item.creators).filter((author) => author !== 'Unknown Authors'),
    year: year && year !== '未知年份' && year !== 'Unknown Year' ? year : null,
    publication: null,
    doi: null,
  };
}

function categorySignature(name: string, parentId: string | null): string {
  return `${parentId ?? 'root'}::${name.trim().toLocaleLowerCase()}`;
}

export default function LiteratureLibraryView({
  onOpenPaper,
  onOpenSettings,
}: LiteratureLibraryViewProps) {
  const l = useLocaleText();
  const [settings, setSettings] = useState<LibrarySettings | null>(null);
  const [categories, setCategories] = useState<LiteratureCategory[]>([]);
  const [papers, setPapers] = useState<LiteraturePaper[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [importDrafts, setImportDrafts] = useState<ImportDraftItem[]>([]);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [librarySettingsOpen, setLibrarySettingsOpen] = useState(false);
  const [editingSettings, setEditingSettings] = useState<LibrarySettings | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [paperSaving, setPaperSaving] = useState(false);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [categoryNameDialog, setCategoryNameDialog] =
    useState<CategoryNameDialogState | null>(null);
  const [confirmDialog, setConfirmDialog] =
    useState<LibraryConfirmDialogState | null>(null);

  const flatCategories = useMemo(() => flattenCategories(categories), [categories]);
  const selectedPaper = useMemo(
    () => papers.find((paper) => paper.id === selectedPaperId) ?? papers[0] ?? null,
    [papers, selectedPaperId],
  );

  const refreshPapers = useCallback(
    async (nextCategoryId = selectedCategoryId) => {
      const nextPapers = await listLibraryPapers({
        categoryId: nextCategoryId,
        search: searchQuery,
        sortBy: 'importedAt',
        sortDirection: 'desc',
        limit: 500,
      });

      setPapers(nextPapers);
      setSelectedPaperId((current) =>
        current && nextPapers.some((paper) => paper.id === current)
          ? current
          : nextPapers[0]?.id ?? null,
      );
    },
    [searchQuery, selectedCategoryId],
  );

  const refreshAll = useCallback(async () => {
    const [nextCategories] = await Promise.all([
      listLibraryCategories(),
      refreshPapers(),
    ]);

    setCategories(nextCategories);
  }, [refreshPapers]);

  const beginImportDrafts = useCallback(
    (paths: string[]) => {
      const pdfPaths = Array.from(
        new Set(paths.filter((path) => path.trim().toLowerCase().endsWith('.pdf'))),
      );

      if (pdfPaths.length === 0) {
        setStatusMessage(l('没有可导入的 PDF 文件', 'No importable PDF files were found'));
        return;
      }

      const targetCategory = categories.find((category) => category.id === selectedCategoryId);
      const defaultCategoryId = targetCategory && !targetCategory.isSystem ? targetCategory.id : '';

      setImportDrafts((current) => {
        const existingPaths = new Set(current.map((draft) => draft.path));
        const nextDrafts = pdfPaths
          .filter((path) => !existingPaths.has(path))
          .map((path): ImportDraftItem => ({
            path,
            title: titleFromPdfPath(path),
            authors: '',
            year: '',
            publication: '',
            doi: '',
            categoryId: defaultCategoryId,
          }));

        return [...current, ...nextDrafts];
      });
      setImportDialogOpen(true);
      setStatusMessage(
        l(
          `已准备导入 ${pdfPaths.length} 个 PDF，请确认元数据。`,
          `${pdfPaths.length} PDFs are ready. Please confirm metadata.`,
        ),
      );
    },
    [categories, l, selectedCategoryId],
  );

  useTauriPdfDrop({
    onPdfPaths: beginImportDrafts,
    onDragStateChange: setDropActive,
  });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError('');

      try {
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
  }, [l]);

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

  const handleSelectStorageDir = async () => {
    if (!settings) {
      return;
    }

    try {
      const directory = await selectDirectory(
        l('选择默认文献存储文件夹', 'Select the default paper storage folder'),
      );

      if (!directory) {
        return;
      }

      const nextSettings = await updateLibrarySettings({
        ...settings,
        storageDir: directory,
      });

      setSettings(nextSettings);
      setStatusMessage(l('已更新文献存储文件夹', 'Updated the paper storage folder'));
    } catch (nextError) {
      const message =
        nextError instanceof Error
          ? nextError.message
          : l('更新文献存储文件夹失败', 'Failed to update the storage folder');
      setError(message);
      setStatusMessage(message);
    }
  };

  const handleOpenLibrarySettings = () => {
    setEditingSettings(settings);
    setLibrarySettingsOpen(true);
  };

  const handleSelectEditingStorageDir = async () => {
    if (!editingSettings) {
      return;
    }

    try {
      const directory = await selectDirectory(
        l('选择默认文献存储文件夹', 'Select the default paper storage folder'),
      );

      if (!directory) {
        return;
      }

      setEditingSettings({
        ...editingSettings,
        storageDir: directory,
      });
    } catch (nextError) {
      const message =
        nextError instanceof Error
          ? nextError.message
          : l('选择文献存储文件夹失败', 'Failed to select the storage folder');
      setError(message);
      setStatusMessage(message);
    }
  };

  const patchEditingSettings = (patch: Partial<LibrarySettings>) => {
    const base = editingSettings ?? settings;

    if (!base) {
      return;
    }

    setEditingSettings({
      ...base,
      ...patch,
    });
  };

  const handleDetectZoteroDir = async () => {
    try {
      const dataDir = await detectLocalZoteroDataDir();

      if (!dataDir) {
        setStatusMessage(l('未找到 Zotero 本地数据目录，请手动选择包含 zotero.sqlite 的目录。', 'No Zotero local data directory was found. Choose the folder containing zotero.sqlite manually.'));
        return;
      }

      patchEditingSettings({ zoteroLocalDataDir: dataDir });
      setStatusMessage(l('已检测到 Zotero 本地数据目录', 'Detected the Zotero local data directory'));
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('检测 Zotero 目录失败', 'Failed to detect the Zotero directory');
      setError(message);
      setStatusMessage(message);
    }
  };

  const handleSelectZoteroDir = async () => {
    try {
      const dataDir = await selectLocalZoteroDataDir();

      if (!dataDir) {
        setStatusMessage(l('未选择 Zotero 目录', 'No Zotero directory selected'));
        return;
      }

      patchEditingSettings({ zoteroLocalDataDir: dataDir });
      setStatusMessage(l('已选择 Zotero 本地数据目录', 'Selected the Zotero local data directory'));
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('选择 Zotero 目录失败', 'Failed to choose the Zotero directory');
      setError(message);
      setStatusMessage(message);
    }
  };

  const handleSaveLibrarySettings = async () => {
    if (!editingSettings) {
      return;
    }

    setSettingsSaving(true);
    setError('');

    try {
      const nextSettings = await updateLibrarySettings(editingSettings);
      setSettings(nextSettings);
      setEditingSettings(nextSettings);
      setLibrarySettingsOpen(false);
      setStatusMessage(l('文库设置已保存', 'Library settings saved'));
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('保存文库设置失败', 'Failed to save library settings');
      setError(message);
      setStatusMessage(message);
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleImportZoteroLibrary = async () => {
    const activeSettings = editingSettings ?? settings;

    if (!activeSettings) {
      return;
    }

    setWorking(true);
    setError('');

    try {
      let dataDir = activeSettings.zoteroLocalDataDir.trim();

      if (!dataDir) {
        dataDir = (await detectLocalZoteroDataDir()) ?? '';
      }

      if (!dataDir) {
        setStatusMessage(l('未找到 Zotero 本地数据目录，请先选择包含 zotero.sqlite 的目录。', 'No Zotero local data directory was found. Choose the folder containing zotero.sqlite first.'));
        return;
      }

      const nextSettings = await updateLibrarySettings({
        ...activeSettings,
        zoteroLocalDataDir: dataDir,
      });
      setSettings(nextSettings);
      setEditingSettings(nextSettings);

      setStatusMessage(l('正在读取 Zotero 分类树...', 'Reading Zotero collection tree...'));
      const zoteroCollections = await listLocalZoteroCollections({ dataDir });

      if (zoteroCollections.length === 0) {
        setStatusMessage(l('Zotero 中没有可导入的分类。', 'No Zotero collections are available to import.'));
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
          throw new Error(l('Zotero 分类层级存在循环，无法导入。', 'The Zotero collection tree has a cycle and cannot be imported.'));
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

      for (const collection of zoteroCollections) {
        await ensureCategoryForCollection(collection);
      }

      let importedCount = 0;
      let duplicateCount = 0;
      let failedCount = 0;
      let missingPdfCount = 0;

      for (const collection of zoteroCollections) {
        const categoryId = categoryIdByZoteroKey.get(collection.collectionKey);

        if (!categoryId) {
          continue;
        }

        const items = await listLocalZoteroCollectionItems({
          dataDir,
          collectionKey: collection.collectionKey,
          limit: 400,
        });
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

      await refreshAll();
      setStatusMessage(
        l(
          `Zotero 导入完成：分类 ${zoteroCollections.length} 个，新增 ${importedCount} 篇，重复 ${duplicateCount} 篇，失败 ${failedCount} 篇，缺少本地 PDF ${missingPdfCount} 篇。`,
          `Zotero import finished: ${zoteroCollections.length} collections, ${importedCount} imported, ${duplicateCount} duplicated, ${failedCount} failed, ${missingPdfCount} missing local PDFs.`,
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

  const handleImportPdfs = async () => {
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

  const handleCloseImportDialog = () => {
    if (working) {
      return;
    }

    setImportDialogOpen(false);
    setImportDrafts([]);
  };

  const handleConfirmImportDrafts = async () => {
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

      await refreshAll();
      setImportDialogOpen(false);
      setImportDrafts([]);
      setStatusMessage(
        l(
          `导入完成：新增 ${importedCount}，重复 ${duplicateCount}，失败 ${failedCount}`,
          `Import finished: ${importedCount} imported, ${duplicateCount} duplicated, ${failedCount} failed`,
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

  const handleCreateCategory = (parentCategory?: LiteratureCategory | null) => {
    setCategoryNameDialog({
      mode: 'create',
      parentCategory: parentCategory && !parentCategory.isSystem ? parentCategory : null,
    });
  };

  const handleRenameCategory = (category: LiteratureCategory) => {
    if (category.isSystem) {
      return;
    }

    setCategoryNameDialog({
      mode: 'rename',
      category,
    });
  };

  const handleSubmitCategoryName = async (name: string) => {
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
          : l(`已移回顶层分类：${movedCategory.name}`, `Moved category to root: ${movedCategory.name}`),
      );
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('移动分类失败', 'Failed to move category');
      setError(message);
      setStatusMessage(message);
    }
  };

  const handleSavePaper = async (request: UpdatePaperRequest) => {
    setPaperSaving(true);
    setError('');

    try {
      const updatedPaper = await updateLibraryPaper(request);
      const [nextCategories, nextPapers] = await Promise.all([
        listLibraryCategories(),
        listLibraryPapers({
          categoryId: selectedCategoryId,
          search: searchQuery,
          sortBy: 'importedAt',
          sortDirection: 'desc',
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
    setConfirmDialog({
      kind: 'delete-paper',
      paper,
    });
  };

  const deletePaperAfterConfirm = async (paper: LiteraturePaper) => {
    setPaperSaving(true);
    setDialogBusy(true);
    setError('');

    try {
      await deleteLibraryPaper({ paperId: paper.id });
      await refreshAll();
      setStatusMessage(l('文献记录已删除，PDF 文件未删除', 'Paper record deleted. PDF files were not deleted.'));
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
    event: DragEvent<HTMLButtonElement>,
    paper: LiteraturePaper,
  ) => {
    event.dataTransfer.setData('application/x-paperquay-paper-id', paper.id);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleCategoryDrop = async (
    event: DragEvent<HTMLButtonElement>,
    category: LiteratureCategory,
  ) => {
    event.preventDefault();

    if (category.isSystem) {
      return;
    }

    const paperId = event.dataTransfer.getData('application/x-paperquay-paper-id');

    if (!paperId) {
      return;
    }

    try {
      await assignPaperToLibraryCategory({
        paperId,
        categoryId: category.id,
      });
      await refreshAll();
      setStatusMessage(l(`已添加到分类：${category.name}`, `Added to category: ${category.name}`));
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('移动文献失败', 'Failed to move paper');
      setError(message);
      setStatusMessage(message);
    }
  };

  return (
    <div className="relative grid h-full min-h-0 grid-cols-[280px_minmax(420px,1fr)_360px] bg-slate-100 text-slate-900 dark:bg-[#121212] dark:text-[#e0e0e0]">
      <LiteratureCategorySidebar
        settings={settings}
        categories={flatCategories}
        selectedCategoryId={selectedCategoryId}
        onCreateCategory={handleCreateCategory}
        onSelectCategory={handleSelectCategory}
        onSelectStorageDir={() => void handleSelectStorageDir()}
        onRenameCategory={handleRenameCategory}
        onDeleteCategory={handleDeleteCategory}
        onCategoryMove={(categoryId, parentId) => void handleMoveCategory(categoryId, parentId)}
        onCategoryDrop={(event, category) => void handleCategoryDrop(event, category)}
      />

      <LiteraturePaperList
        loading={loading}
        working={working}
        papers={papers}
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
      />

      <LiteraturePaperDetails
        selectedPaper={selectedPaper}
        saving={paperSaving}
        onOpenPaper={onOpenPaper}
        onOpenSettings={handleOpenLibrarySettings}
        onSavePaper={(request) => void handleSavePaper(request)}
        onDeletePaper={(paper) => void handleDeletePaper(paper)}
      />

      {dropActive ? (
        <div className="pointer-events-none absolute inset-4 z-40 flex items-center justify-center rounded-[32px] border-2 border-dashed border-teal-400 bg-teal-500/12 text-center backdrop-blur-[2px] dark:bg-teal-300/10">
          <div className="rounded-3xl border border-white/70 bg-white/90 px-8 py-6 shadow-[0_24px_80px_rgba(15,23,42,0.22)] dark:border-white/10 dark:bg-[#1e1e1e]/94">
            <div className="text-xl font-semibold">
              {l('松开鼠标导入 PDF', 'Drop to import PDFs')}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-[#a0a0a0]">
              {l('导入前会先进入元数据确认页。', 'A metadata confirmation screen will appear before import.')}
            </div>
          </div>
        </div>
      ) : null}

      <ImportConfirmationDialog
        open={importDialogOpen}
        drafts={importDrafts}
        categories={categories}
        working={working}
        onDraftChange={handleImportDraftChange}
        onRemoveDraft={handleRemoveImportDraft}
        onClose={handleCloseImportDialog}
        onConfirm={() => void handleConfirmImportDrafts()}
      />

      <LibrarySettingsDialog
        open={librarySettingsOpen}
        settings={editingSettings}
        saving={settingsSaving}
        onClose={() => setLibrarySettingsOpen(false)}
        onSelectStorageDir={() => void handleSelectEditingStorageDir()}
        onDetectZoteroDir={() => void handleDetectZoteroDir()}
        onSelectZoteroDir={() => void handleSelectZoteroDir()}
        onImportZotero={() => void handleImportZoteroLibrary()}
        onChange={setEditingSettings}
        onSave={() => void handleSaveLibrarySettings()}
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
            ? l(
                `将在“${categoryNameDialog.parentCategory.name}”下面创建子分类。`,
                `Create a subcategory under "${categoryNameDialog.parentCategory.name}".`,
              )
            : categoryNameDialog?.mode === 'create'
              ? l('分类会出现在左侧文献库树中，可以继续拖拽调整层级。', 'The category will appear in the library tree and can be rearranged by drag and drop.')
              : l('只会修改分类名称，不会移动或删除文献文件。', 'Only the category name changes. Paper files are not moved or deleted.')
        }
        label={l('分类名称', 'Category Name')}
        initialValue={categoryNameDialog?.mode === 'rename' ? categoryNameDialog.category.name : ''}
        placeholder={l('例如：研究综述', 'e.g. Literature Review')}
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

      <LibraryConfirmDialog
        open={confirmDialog !== null}
        title={
          confirmDialog?.kind === 'delete-category'
            ? l('删除分类', 'Delete Category')
            : l('删除文献记录', 'Delete Paper Record')
        }
        description={
          confirmDialog?.kind === 'delete-category'
            ? l(
                `确定删除分类“${confirmDialog.category.name}”？这只会解除分类关系，不会删除磁盘上的 PDF 文件。`,
                `Delete category "${confirmDialog.category.name}"? This only removes the category relation and does not delete PDF files on disk.`,
              )
            : confirmDialog?.kind === 'delete-paper'
              ? l(
                  `确定删除“${confirmDialog.paper.title}”的文献记录？磁盘上的 PDF 文件不会被删除。`,
                  `Delete the paper record for "${confirmDialog.paper.title}"? PDF files on disk will not be deleted.`,
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

          void deletePaperAfterConfirm(confirmDialog.paper);
        }}
      />
    </div>
  );
}

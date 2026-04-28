export type BBox = [number, number, number, number];

export type BBoxCoordinateSystem = 'pdf' | 'normalized-1000';

export type BBoxPageSize = [number, number];

export type PdfSource =
  | { kind: 'local-path'; path: string }
  | {
      kind: 'remote-url';
      url: string;
      headers?: Record<string, string>;
      fileName?: string;
    }
  | null;

export type MineruKnownBlockType =
  | 'paragraph'
  | 'title'
  | 'list'
  | 'image'
  | 'table'
  | 'caption'
  | 'equation'
  | 'page_header'
  | 'page_footer'
  | 'page_number'
  | 'page_footnote'
  | (string & {});

export interface MineruBlockBase {
  type: MineruKnownBlockType;
  content: unknown;
  bbox?: BBox;
  bboxCoordinateSystem?: BBoxCoordinateSystem;
  bboxPageSize?: BBoxPageSize;
}

export type MineruPage = MineruBlockBase[];

export interface PositionedMineruBlock extends MineruBlockBase {
  blockId: string;
  pageIndex: number;
  blockIndex: number;
}

export interface PdfHighlightTarget {
  blockId: string;
  pageIndex: number;
  bbox: BBox;
  bboxCoordinateSystem?: BBoxCoordinateSystem;
  bboxPageSize?: BBoxPageSize;
}

export interface RenderableMineruBlock {
  block: PositionedMineruBlock;
  plainText: string;
  markdown: string;
  mathText?: string;
  tableHtml?: string;
  captionText?: string;
  assetPath?: string;
  isInteractive: boolean;
}

export type TranslationDisplayMode = 'original' | 'translated' | 'bilingual';

export type UiLanguage = 'zh-CN' | 'en-US';

export interface TranslationMap {
  [blockId: string]: string;
}

export interface TranslationBlockInput {
  blockId: string;
  text: string;
}

export interface SummaryBlockInput {
  blockId: string;
  blockType: string;
  pageIndex: number;
  text: string;
}

export interface TranslationBlockOutput {
  blockId: string;
  translatedText: string;
}

export type SummarySourceMode = 'pdf-text' | 'mineru-markdown';

export type QaSourceMode = 'pdf-text' | 'mineru-markdown';

export interface OpenAICompatibleTranslateOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  reasoningEffort?: ModelReasoningEffort;
  sourceLanguage: string;
  targetLanguage: string;
  blocks: TranslationBlockInput[];
  batchSize?: number;
  concurrency?: number;
}

export interface OpenAICompatibleTestOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface OpenAICompatibleTestResult {
  ok: boolean;
  endpoint: string;
  model: string;
  responseModel?: string;
  latencyMs: number;
  message: string;
}

export interface QaModelPreset {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  labelCustomized?: boolean;
}

export type ModelReasoningEffort = 'auto' | 'low' | 'medium' | 'high';

export type ModelRuntimeRole =
  | 'translation'
  | 'selectionTranslation'
  | 'summary'
  | 'agent'
  | 'qa';

export interface ModelRuntimeConfig {
  temperature?: number;
  reasoningEffort?: ModelReasoningEffort;
}

export interface PaperSummarySection {
  title: string;
  content: string;
}

export interface PaperSummary {
  title: string;
  abstract: string;
  overview: string;
  background: string;
  researchProblem: string;
  approach: string;
  experimentSetup: string;
  keyFindings: string[];
  conclusions: string;
  limitations: string;
  takeaways: string[];
  keywords: string[];
}

export interface PaperAnnotation {
  id: string;
  blockId: string;
  blockType: string;
  pageIndex: number;
  bbox: BBox;
  bboxCoordinateSystem?: BBoxCoordinateSystem;
  bboxPageSize?: BBoxPageSize;
  note: string;
  quote?: string;
  createdAt: number;
  updatedAt: number;
}

export type ZoteroRelatedNoteKind =
  | 'zotero-note'
  | 'markdown'
  | 'text';

export type ZoteroRelatedNoteFormat =
  | 'html'
  | 'markdown'
  | 'plain';

export interface ZoteroRelatedNote {
  id: string;
  parentItemKey: string;
  title: string;
  kind: ZoteroRelatedNoteKind;
  content: string;
  contentFormat: ZoteroRelatedNoteFormat;
  sourceLabel: string;
  filePath?: string;
}

export type DocumentChatAttachmentKind =
  | 'image'
  | 'file'
  | 'screenshot';

export interface DocumentChatAttachment {
  id: string;
  kind: DocumentChatAttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  filePath?: string;
  dataUrl?: string;
  textContent?: string;
  summary?: string;
}

export interface DocumentChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  modelId?: string;
  modelLabel?: string;
  attachments?: DocumentChatAttachment[];
}

export interface DocumentChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: DocumentChatMessage[];
}

export type AssistantPanelKey = 'chat' | 'translate' | 'info' | 'notes' | 'annotations' | null;

export type WorkspaceStage = 'overview' | 'reading';

export type ReaderViewMode = 'dual-pane' | 'pdf-only';

export type TextSelectionSource = 'pdf' | 'blocks';

export type TextSelectionPlacement = 'top' | 'bottom';

export interface TextSelectionPayload {
  text: string;
  anchorClientX: number;
  anchorClientY: number;
  placement: TextSelectionPlacement;
}

export interface SelectedExcerpt {
  text: string;
  source: TextSelectionSource;
  createdAt: number;
  anchorClientX?: number;
  anchorClientY?: number;
  placement?: TextSelectionPlacement;
}

export interface OpenAICompatibleSummaryOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  reasoningEffort?: ModelReasoningEffort;
  responseLanguage?: string;
  title: string;
  authors?: string;
  year?: string;
  outputLanguage?: string;
  blocks: SummaryBlockInput[];
  documentText?: string;
}

export interface OpenAICompatibleQaOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  reasoningEffort?: ModelReasoningEffort;
  responseLanguage?: string;
  title: string;
  authors?: string;
  year?: string;
  excerptText?: string;
  documentText?: string;
  blocks: SummaryBlockInput[];
  messages: DocumentChatMessage[];
}

export interface ZoteroLibraryItem {
  itemKey: string;
  title: string;
  creators: string;
  year: string;
  itemType: string;
  attachmentKey?: string;
  attachmentTitle?: string;
  attachmentFilename?: string;
  localPdfPath?: string;
}

export interface ZoteroCollection {
  collectionKey: string;
  name: string;
  parentCollectionKey?: string | null;
  itemCount: number;
}

export interface ZoteroKeyInfo {
  userId: string;
  username?: string;
}

export interface ZoteroDownloadResult {
  path: string;
  filename: string;
}

export type WorkspaceItemSource = 'zotero-local' | 'standalone' | 'onboarding' | 'native-library';

export interface WorkspaceItem extends ZoteroLibraryItem {
  source: WorkspaceItemSource;
  workspaceId: string;
  groupKey: string;
}

export interface ReaderSettings {
  uiLanguage: UiLanguage;
  autoLoadSiblingJson: boolean;
  autoMineruParse: boolean;
  autoGenerateSummary: boolean;
  libraryBatchConcurrency: number;
  autoTranslateSelection: boolean;
  smoothScroll: boolean;
  compactReading: boolean;
  showBlockMeta: boolean;
  hidePageDecorationsInBlockView: boolean;
  softPageShadow: boolean;
  mineruCacheDir: string;
  remotePdfDownloadDir: string;
  translationBatchSize: number;
  translationConcurrency: number;
  translationBaseUrl: string;
  translationModel: string;
  summaryBaseUrl: string;
  summaryModel: string;
  translationModelPresetId: string;
  selectionTranslationModelPresetId: string;
  summaryModelPresetId: string;
  agentModelPresetId: string;
  modelRuntimeConfigs: Partial<Record<ModelRuntimeRole, ModelRuntimeConfig>>;
  summarySourceMode: SummarySourceMode;
  summaryOutputLanguage: string;
  qaSourceMode: QaSourceMode;
  translationSourceLanguage: string;
  translationTargetLanguage: string;
  translationDisplayMode: TranslationDisplayMode;
  qaActivePresetId: string;
}

export interface ReaderSecrets {
  mineruApiToken: string;
  translationApiKey: string;
  summaryApiKey: string;
  zoteroApiKey: string;
  zoteroUserId: string;
  qaModelPresets: QaModelPreset[];
}

export interface ReaderConfigFile {
  version: number;
  settings: ReaderSettings;
  secrets?: ReaderSecrets;
  zoteroLocalDataDir: string;
  leftSidebarCollapsed: boolean;
}

export interface PaperHistoryRecord {
  version: number;
  workspaceId: string;
  document: WorkspaceItem;
  lastOpenedAt: number;
  lastUpdatedAt: number;
  lastPdfPath: string;
  lastMineruPath: string;
  lastActiveBlockId: string | null;
  workspaceStage: WorkspaceStage;
  readingViewMode: ReaderViewMode;
  selectedQaPresetId: string | null;
  selectedQaSessionId: string | null;
  paperSummary: PaperSummary | null;
  paperSummarySourceKey: string;
  workspaceNoteMarkdown: string;
  annotations: PaperAnnotation[];
  qaSessions: DocumentChatSession[];
  qaMessages?: DocumentChatMessage[];
}

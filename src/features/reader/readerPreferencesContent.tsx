import {
  BookOpenText,
  Database,
  FolderOpen,
  Languages,
  Library,
  Settings2,
  Sparkles,
} from 'lucide-react';

import { openExternalUrl } from '../../services/desktop';
import { resolveSummaryOutputLanguage } from '../../services/summarySource';
import type { ReaderSettings } from '../../types/reader';
import {
  buildLanguageOptions,
  buildQaSourceOptions,
  buildSummaryLanguageOptions,
  buildSummarySourceOptions,
  clampBatchConcurrency,
  resolveModelPreset,
  type PreferencesSectionKey,
} from './readerShared';
import {
  BatchProgressCard,
  SettingsField,
  SettingsInput,
  SettingsSelect,
  ToggleRow,
} from './readerPreferencesPrimitives';
import { ReaderPreferencesModelsSection } from './readerPreferencesModelsSection';
import type {
  ReaderPreferencesLocalizer,
  ReaderPreferencesSectionDescriptor,
  ReaderPreferencesWindowProps,
} from './readerPreferencesTypes';

interface ReaderPreferencesContentProps
  extends Pick<
    ReaderPreferencesWindowProps,
    | 'settings'
    | 'zoteroLocalDataDir'
    | 'mineruApiToken'
    | 'qaModelPresets'
    | 'zoteroApiKey'
    | 'zoteroUserId'
    | 'libraryLoading'
    | 'translating'
    | 'onSettingChange'
    | 'onZoteroLocalDataDirChange'
    | 'onMineruApiTokenChange'
    | 'onZoteroApiKeyChange'
    | 'onZoteroUserIdChange'
    | 'onDetectLocalZotero'
    | 'onSelectLocalZoteroDir'
    | 'onReloadLocalZotero'
    | 'onImportLocalZotero'
    | 'onSelectMineruCacheDir'
    | 'onSelectRemotePdfDownloadDir'
    | 'onTestLlmConnection'
    | 'onQaModelPresetAdd'
    | 'onQaModelPresetRemove'
    | 'onQaModelPresetChange'
    | 'onTranslate'
    | 'onClearTranslations'
    | 'onBatchMineruParse'
    | 'onBatchGenerateSummaries'
    | 'onToggleBatchMineruPause'
    | 'onCancelBatchMineru'
    | 'onToggleBatchSummaryPause'
    | 'onCancelBatchSummary'
    | 'batchMineruRunning'
    | 'batchSummaryRunning'
    | 'batchMineruPaused'
    | 'batchSummaryPaused'
    | 'batchMineruProgress'
    | 'batchSummaryProgress'
  > {
  activeSection: PreferencesSectionKey;
  l: ReaderPreferencesLocalizer;
}

export function buildReaderPreferencesSections(
  l: ReaderPreferencesLocalizer,
): ReaderPreferencesSectionDescriptor[] {
  return [
    {
      key: 'general',
      title: l('通用', 'General'),
      description: l(
        '语言、主题和基础应用行为',
        'Language, theme, and basic application behavior',
      ),
      icon: <Settings2 className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'library',
      title: l('文库与 Zotero', 'Library & Zotero'),
      description: l('Zotero、本地路径和 PDF 来源', 'Zotero, local paths, and PDF sources'),
      icon: <Library className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'reading',
      title: l('阅读显示', 'Reader Display'),
      description: l(
        '联动、滚动、布局和结构块显示',
        'Linking, scrolling, layout, and block display',
      ),
      icon: <BookOpenText className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'mineru',
      title: 'MinerU',
      description: l(
        'API Key、缓存、自动解析和批量任务',
        'API key, cache, auto parse, and batch jobs',
      ),
      icon: <Database className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'translation',
      title: l('翻译', 'Translation'),
      description: l(
        '全文翻译、划词翻译、语言和吞吐',
        'Full translation, selection translation, languages, and throughput',
      ),
      icon: <Sparkles className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'models',
      title: l('AI 模型', 'AI Models'),
      description: l(
        'OpenAI 兼容模型预设和测试',
        'OpenAI-compatible model presets and tests',
      ),
      icon: <Sparkles className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'summaryQa',
      title: l('概览与问答', 'Overview & QA'),
      description: l(
        '概览输入、批量概览和问答上下文',
        'Overview input, batch overview, and QA context',
      ),
      icon: <Database className="h-4 w-4" strokeWidth={1.8} />,
    },
  ];
}

export function ReaderPreferencesContent({
  activeSection,
  l,
  settings,
  zoteroLocalDataDir,
  mineruApiToken,
  qaModelPresets,
  zoteroApiKey,
  zoteroUserId,
  libraryLoading,
  translating = false,
  onSettingChange,
  onZoteroLocalDataDirChange,
  onMineruApiTokenChange,
  onZoteroApiKeyChange,
  onZoteroUserIdChange,
  onDetectLocalZotero,
  onSelectLocalZoteroDir,
  onReloadLocalZotero,
  onImportLocalZotero,
  onSelectMineruCacheDir,
  onSelectRemotePdfDownloadDir,
  onTestLlmConnection,
  onQaModelPresetAdd,
  onQaModelPresetRemove,
  onQaModelPresetChange,
  onTranslate,
  onClearTranslations,
  onBatchMineruParse,
  onBatchGenerateSummaries,
  onToggleBatchMineruPause,
  onCancelBatchMineru,
  onToggleBatchSummaryPause,
  onCancelBatchSummary,
  batchMineruRunning = false,
  batchSummaryRunning = false,
  batchMineruPaused = false,
  batchSummaryPaused = false,
  batchMineruProgress,
  batchSummaryProgress,
}: ReaderPreferencesContentProps) {
  const languageOptions = buildLanguageOptions(settings.uiLanguage);
  const summaryLanguageOptions = buildSummaryLanguageOptions(settings.uiLanguage);
  const summarySourceOptions = buildSummarySourceOptions(settings.uiLanguage);
  const qaSourceOptions = buildQaSourceOptions(settings.uiLanguage);
  const resolvedSummaryLanguage = resolveSummaryOutputLanguage(settings);
  const activeSummaryPreset = resolveModelPreset(
    qaModelPresets,
    settings.summaryModelPresetId,
  );
  const canTriggerTranslate = Boolean(onTranslate);
  const canClearTranslations = Boolean(onClearTranslations);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {activeSection === 'general' ? (
        <SettingsField
          label={l('软件语言', 'Software Language')}
          description={l(
            '切换后，主界面与设置界面会同步切换中英文。',
            'Switch the main interface and settings between Chinese and English.',
          )}
        >
          <SettingsSelect
            value={settings.uiLanguage}
            onChange={(event) =>
              onSettingChange('uiLanguage', event.target.value as ReaderSettings['uiLanguage'])
            }
          >
            <option value="zh-CN">简体中文</option>
            <option value="en-US">English</option>
          </SettingsSelect>
        </SettingsField>
      ) : null}

      {activeSection === 'library' ? (
        <>
          <div data-tour="zotero-settings">
            <SettingsField
              label={l('Zotero 本地数据目录', 'Zotero Local Data Directory')}
              description={l(
                '用于读取 Zotero 附件与分类树，目录中应包含 zotero.sqlite。',
                'Used to read Zotero attachments and collection trees. The directory should contain zotero.sqlite.',
              )}
            >
              <SettingsInput
                value={zoteroLocalDataDir}
                onChange={(event) => onZoteroLocalDataDirChange(event.target.value)}
                placeholder={l(
                  '例如 C:\\Users\\Lenovo\\Zotero',
                  'Example: C:\\Users\\Lenovo\\Zotero',
                )}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onDetectLocalZotero}
                  disabled={libraryLoading}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                >
                  {l('自动查找', 'Auto Detect')}
                </button>
                <button
                  type="button"
                  onClick={onSelectLocalZoteroDir}
                  disabled={libraryLoading}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                >
                  {l('选择目录', 'Select Directory')}
                </button>
                <button
                  type="button"
                  onClick={onReloadLocalZotero}
                  disabled={libraryLoading}
                  className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                >
                  {l('重新读取', 'Reload')}
                </button>
                <button
                  type="button"
                  onClick={onImportLocalZotero}
                  disabled={libraryLoading}
                  className="rounded-xl bg-teal-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-teal-500 disabled:opacity-60 dark:bg-accent-teal dark:text-chrome-950 dark:hover:bg-accent-teal/90"
                >
                  {l('读取并导入本地文库', 'Read and Import to Library')}
                </button>
              </div>
            </SettingsField>
          </div>

          <SettingsField
            label={l('Zotero Web 回退', 'Zotero Web Fallback')}
            description={l(
              '当本地 PDF 缺失时，通过 Zotero Web API 回退获取附件。',
              'When the local PDF is missing, fetch the attachment through the Zotero Web API fallback.',
            )}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-500">API Key</div>
                <SettingsInput
                  value={zoteroApiKey}
                  onChange={(event) => onZoteroApiKeyChange(event.target.value)}
                  type="password"
                  placeholder={l(
                    '仅在本地 PDF 缺失时填写 API Key',
                    'Only required when the local PDF is missing.',
                  )}
                />
              </div>
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-500">User ID</div>
                <SettingsInput
                  value={zoteroUserId}
                  onChange={(event) => onZoteroUserIdChange(event.target.value)}
                  placeholder={l(
                    '可留空，首次回退时自动获取',
                    'Optional. Auto-detected on first fallback.',
                  )}
                />
              </div>
            </div>
          </SettingsField>

          <SettingsField
            label={l('远程 PDF 下载目录', 'Remote PDF Download Directory')}
            description={l(
              '当通过 Zotero Web 获取 PDF 时，保存到此目录。',
              'When downloading PDFs through Zotero Web, save them to this directory.',
            )}
          >
            <SettingsInput
              value={settings.remotePdfDownloadDir}
              onChange={(event) => onSettingChange('remotePdfDownloadDir', event.target.value)}
              placeholder={l(
                '选择本地目录保存下载的 PDF',
                'Choose a local directory for downloaded PDFs',
              )}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onSelectRemotePdfDownloadDir}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
              >
                <FolderOpen className="mr-2 inline h-4 w-4" strokeWidth={1.8} />
                {l('选择目录', 'Select Directory')}
              </button>
              <button
                type="button"
                onClick={() => onSettingChange('remotePdfDownloadDir', '')}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
              >
                {l('清空路径', 'Clear Path')}
              </button>
            </div>
          </SettingsField>
        </>
      ) : null}

      {activeSection === 'reading' ? (
        <>
          <ToggleRow
            title={l('自动加载同名 JSON', 'Auto Load Sibling JSON')}
            description={l(
              '打开 PDF 时，自动尝试加载同目录下对应的 content_list_v2.json。',
              'When opening a PDF, automatically try to load the matching content_list_v2.json from the same directory.',
            )}
            checked={settings.autoLoadSiblingJson}
            onChange={(checked) => onSettingChange('autoLoadSiblingJson', checked)}
          />
          <ToggleRow
            title={l('平滑滚动联动', 'Smooth Linked Scrolling')}
            description={l(
              '在 PDF 与结构块之间联动时，使用更平滑的滚动定位。',
              'Use smoother scrolling when navigating between the PDF and structured blocks.',
            )}
            checked={settings.smoothScroll}
            onChange={(checked) => onSettingChange('smoothScroll', checked)}
          />
          <ToggleRow
            title={l('紧凑阅读模式', 'Compact Reading Mode')}
            description={l(
              '压缩结构块列表的间距，适合长文快速通读。',
              'Reduce block spacing for faster reading in long documents.',
            )}
            checked={settings.compactReading}
            onChange={(checked) => onSettingChange('compactReading', checked)}
          />
          <ToggleRow
            title={l('显示块元信息', 'Show Block Metadata')}
            description={l(
              '在结构块中显示页码、类型等辅助信息。',
              'Show page numbers, block types, and related metadata in the block view.',
            )}
            checked={settings.showBlockMeta}
            onChange={(checked) => onSettingChange('showBlockMeta', checked)}
          />
          <ToggleRow
            title={l('隐藏页眉页脚类块', 'Hide Page Decoration Blocks')}
            description={l(
              '在右侧结构块视图中隐藏 page_number、page_footer 等页面装饰内容。',
              'Hide page_header, page_footer, page_number, page_footnote, and similar decorative content from the block view.',
            )}
            checked={settings.hidePageDecorationsInBlockView}
            onChange={(checked) =>
              onSettingChange('hidePageDecorationsInBlockView', checked)
            }
          />
          <ToggleRow
            title={l('柔和页面阴影', 'Soft Page Shadow')}
            description={l(
              '为 PDF 页面添加更轻的阴影层次。',
              'Render PDF pages with a softer shadow treatment.',
            )}
            checked={settings.softPageShadow}
            onChange={(checked) => onSettingChange('softPageShadow', checked)}
          />
        </>
      ) : null}

      {activeSection === 'mineru' ? (
        <>
          <SettingsField
            label="MinerU API Token"
            description={
              <span>
                {l(
                  '配置后可将本地 PDF 发送给 MinerU 并生成结构化 JSON。可前往 ',
                  'Configure this to send local PDFs to MinerU and generate structured JSON. Visit ',
                )}
                <button
                  type="button"
                  onClick={() => void openExternalUrl('https://mineru.net/')}
                  className="font-semibold text-sky-600 underline decoration-sky-300 underline-offset-2 transition hover:text-sky-700 dark:text-sky-300 dark:decoration-sky-500/70 dark:hover:text-sky-200"
                >
                  https://mineru.net/
                </button>
                {l(' 获取或管理免费 API Key。', ' to get or manage your free API key.')}
              </span>
            }
          >
            <SettingsInput
              value={mineruApiToken}
              onChange={(event) => onMineruApiTokenChange(event.target.value)}
              type="password"
              placeholder={l('输入 MinerU API Token', 'Enter MinerU API Token')}
            />
          </SettingsField>

          <SettingsField
            label={l('MinerU 缓存目录', 'MinerU Cache Directory')}
            description={l(
              '用于保存 content_list_v2.json、middle.json、full.md 与 manifest 等解析产物。',
              'Stores content_list_v2.json, middle.json, full.md, manifest, and related parse outputs.',
            )}
          >
            <SettingsInput
              value={settings.mineruCacheDir}
              onChange={(event) => onSettingChange('mineruCacheDir', event.target.value)}
              placeholder={l(
                '选择一个本地目录保存 MinerU 结果',
                'Choose a local directory to store MinerU outputs',
              )}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onSelectMineruCacheDir}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
              >
                <FolderOpen className="mr-2 inline h-4 w-4" strokeWidth={1.8} />
                {l('选择目录', 'Select Directory')}
              </button>
              <button
                type="button"
                onClick={() => onSettingChange('mineruCacheDir', '')}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
              >
                {l('清空路径', 'Clear Path')}
              </button>
            </div>
          </SettingsField>

          <SettingsField
            label={l('MinerU 自动解析与批量任务', 'MinerU Automation and Batch Jobs')}
            description={l(
              '控制 MinerU 自动解析、批量解析和并发数。',
              'Control MinerU auto parsing, batch parsing, and concurrency.',
            )}
          >
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px]">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <div className="text-sm font-medium text-slate-900">
                    {l('MinerU 批处理并发数', 'MinerU Batch Concurrency')}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">
                    {l(
                      '控制批量 MinerU 解析的并发度，数值过高可能导致限流或性能波动。',
                      'Controls batch MinerU parse concurrency. Values that are too high may cause rate limits or unstable performance.',
                    )}
                  </div>
                </div>
                <SettingsInput
                  type="number"
                  min={1}
                  max={8}
                  step={1}
                  value={String(settings.libraryBatchConcurrency)}
                  onChange={(event) =>
                    onSettingChange(
                      'libraryBatchConcurrency',
                      clampBatchConcurrency(Number(event.target.value)),
                    )
                  }
                />
              </div>
              <ToggleRow
                title={l('自动执行 MinerU 解析', 'Auto Run MinerU Parse')}
                description={l(
                  '检测到可处理 PDF 时自动触发 MinerU 解析。',
                  'Automatically trigger MinerU parsing when a processable PDF is detected.',
                )}
                checked={settings.autoMineruParse}
                onChange={(checked) => onSettingChange('autoMineruParse', checked)}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onBatchMineruParse}
                  disabled={batchMineruRunning}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                >
                  {batchMineruRunning
                    ? l('处理中...', 'Processing...')
                    : l('启动 MinerU 批量解析', 'Start MinerU Batch Parse')}
                </button>
                {batchMineruRunning ? (
                  <button
                    type="button"
                    onClick={onToggleBatchMineruPause}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                  >
                    {batchMineruPaused ? l('继续', 'Resume') : l('暂停', 'Pause')}
                  </button>
                ) : null}
                {batchMineruRunning ? (
                  <button
                    type="button"
                    onClick={onCancelBatchMineru}
                    className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600 transition hover:bg-rose-100"
                  >
                    {l('取消', 'Cancel')}
                  </button>
                ) : null}
              </div>
              <BatchProgressCard
                title={l('MinerU 批量解析进度', 'MinerU Batch Progress')}
                progress={batchMineruProgress}
                tone="indigo"
              />
            </div>
          </SettingsField>
        </>
      ) : null}

      <ReaderPreferencesModelsSection
        active={activeSection === 'models'}
        l={l}
        uiLanguage={settings.uiLanguage}
        settings={settings}
        qaModelPresets={qaModelPresets}
        onSettingChange={onSettingChange}
        onTestLlmConnection={onTestLlmConnection}
        onQaModelPresetAdd={onQaModelPresetAdd}
        onQaModelPresetRemove={onQaModelPresetRemove}
        onQaModelPresetChange={onQaModelPresetChange}
      />

      {activeSection === 'translation' ? (
        <>
          <SettingsField
            label={l('翻译体验', 'Translation Experience')}
            description={l(
              '配置语言方向、自动划词翻译和文档级翻译操作。',
              'Configure language direction, auto selection translation, and document-level translation actions.',
            )}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-500">
                  {l('源语言', 'Source Language')}
                </div>
                <SettingsSelect
                  value={settings.translationSourceLanguage}
                  onChange={(event) =>
                    onSettingChange('translationSourceLanguage', event.target.value)
                  }
                >
                  {languageOptions.map((language) => (
                    <option key={language.value} value={language.value}>
                      {language.label}
                    </option>
                  ))}
                </SettingsSelect>
              </div>
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-500">
                  {l('目标语言', 'Target Language')}
                </div>
                <SettingsSelect
                  value={settings.translationTargetLanguage}
                  onChange={(event) =>
                    onSettingChange('translationTargetLanguage', event.target.value)
                  }
                >
                  {languageOptions
                    .filter((language) => language.value !== 'auto')
                    .map((language) => (
                      <option key={language.value} value={language.value}>
                        {language.label}
                      </option>
                    ))}
                </SettingsSelect>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs leading-5 text-slate-500">
              {l(
                '整篇翻译会按结构块分批调用模型，并将结果缓存到当前文档会话中。',
                'Full-document translation is executed in batches by structured blocks and cached in the current document session.',
              )}
            </div>

            <ToggleRow
              title={l('自动翻译划词', 'Auto Translate Selection')}
              description={l(
                '选中文本后自动请求翻译，无需手动点击翻译按钮。',
                'Automatically translate selected text without requiring a manual click.',
              )}
              checked={settings.autoTranslateSelection}
              onChange={(checked) => onSettingChange('autoTranslateSelection', checked)}
            />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onTranslate?.()}
                disabled={!canTriggerTranslate || translating}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                <Languages className="mr-2 inline h-4 w-4" strokeWidth={1.8} />
                {translating
                  ? l('翻译中...', 'Translating...')
                  : l('开始整篇翻译', 'Translate Document')}
              </button>
              <button
                type="button"
                onClick={() => onClearTranslations?.()}
                disabled={!canClearTranslations}
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
              >
                {l('清空翻译缓存', 'Clear Translation Cache')}
              </button>
            </div>
          </SettingsField>

          <SettingsField
            label={l('翻译吞吐配置', 'Translation Throughput')}
            description={l(
              '控制整篇翻译时每批块数与并发数。',
              'Control batch size and concurrency for full-document translation.',
            )}
          >
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-500">
                  {l('每批块数', 'Blocks Per Batch')}
                </div>
                <SettingsInput
                  type="number"
                  min={1}
                  max={50}
                  value={String(settings.translationBatchSize)}
                  onChange={(event) =>
                    onSettingChange(
                      'translationBatchSize',
                      Math.max(1, Math.min(50, Number(event.target.value) || 1)),
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-500">
                  {l('并发数', 'Concurrency')}
                </div>
                <SettingsInput
                  type="number"
                  min={1}
                  max={8}
                  value={String(settings.translationConcurrency)}
                  onChange={(event) =>
                    onSettingChange(
                      'translationConcurrency',
                      Math.max(1, Math.min(8, Number(event.target.value) || 1)),
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-500">
                  {l('每分钟请求数', 'Requests Per Minute')}
                </div>
                <SettingsInput
                  type="number"
                  min={0}
                  max={600}
                  value={String(settings.translationRequestsPerMinute)}
                  onChange={(event) =>
                    onSettingChange(
                      'translationRequestsPerMinute',
                      Math.max(0, Math.min(600, Number(event.target.value) || 0)),
                    )
                  }
                />
                <div className="text-[11px] leading-5 text-slate-400">
                  {l('填 0 表示不限制，由软件直接发送请求。', 'Use 0 for unlimited requests.')}
                </div>
              </div>
            </div>
          </SettingsField>
        </>
      ) : null}

      {activeSection === 'summaryQa' ? (
        <>
          <SettingsField
            label={l('概览输入来源', 'Overview Input Source')}
            description={l(
              '决定概览生成优先读取 PDF 文本还是 MinerU Markdown。',
              'Decide whether overview generation should prefer PDF text or MinerU Markdown.',
            )}
          >
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                {l('当前概览模型', 'Current Overview Preset')}
              </div>
              <div className="mt-2 text-sm font-medium text-slate-900">
                {activeSummaryPreset?.label || activeSummaryPreset?.model || l('未选择', 'Unselected')}
              </div>
              <div className="mt-1 truncate text-xs text-slate-500">
                {activeSummaryPreset?.baseUrl || l('未配置 Base URL', 'Base URL not configured')}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium text-slate-500">
                {l('概览输入模式', 'Overview Source Mode')}
              </div>
              <div className="grid gap-2">
                {summarySourceOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onSettingChange('summarySourceMode', option.value)}
                    className={
                      settings.summarySourceMode === option.value
                        ? 'rounded-2xl border border-indigo-200 bg-indigo-50/70 px-4 py-3 text-left transition'
                        : 'rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-left transition hover:bg-slate-100'
                    }
                  >
                    <div className="text-sm font-medium text-slate-900">{option.label}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">{option.description}</div>
                  </button>
                ))}
              </div>
            </div>
          </SettingsField>

          <SettingsField
            label={l('概览输出语言', 'Overview Output Language')}
            description={l(
              '控制 AI 概览的生成语言；切换后会使用新的缓存 key，不会混用旧语言结果。',
              'Choose the language used for AI overviews. Changing it uses a separate cache key.',
            )}
          >
            <div className="grid gap-3">
              <SettingsSelect
                value={
                  summaryLanguageOptions.some(
                    (option) => option.value === settings.summaryOutputLanguage,
                  )
                    ? settings.summaryOutputLanguage
                    : 'custom'
                }
                onChange={(event) => {
                  if (event.target.value === 'custom') {
                    return;
                  }

                  onSettingChange('summaryOutputLanguage', event.target.value);
                }}
              >
                {summaryLanguageOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
                <option value="custom">{l('自定义语言', 'Custom Language')}</option>
              </SettingsSelect>

              <SettingsInput
                value={
                  settings.summaryOutputLanguage === 'follow-ui'
                    ? ''
                    : settings.summaryOutputLanguage
                }
                placeholder={l(
                  `例如：Chinese / English / Japanese；留空则${resolvedSummaryLanguage}`,
                  `e.g. Chinese / English / Japanese; leave empty for ${resolvedSummaryLanguage}`,
                )}
                onChange={(event) =>
                  onSettingChange(
                    'summaryOutputLanguage',
                    event.target.value.trimStart() || 'follow-ui',
                  )
                }
              />
              <div className="text-xs text-slate-500 dark:text-chrome-300">
                {l(
                  `当前实际输出语言：${resolvedSummaryLanguage}`,
                  `Effective output language: ${resolvedSummaryLanguage}`,
                )}
              </div>
            </div>
          </SettingsField>

          <SettingsField
            label={l('问答上下文来源', 'QA Context Source')}
            description={l(
              '控制问答时优先使用 MinerU Markdown 还是 PDF 文本。',
              'Choose whether QA should prefer MinerU Markdown or extracted PDF text.',
            )}
          >
            <div className="grid gap-2">
              {qaSourceOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onSettingChange('qaSourceMode', option.value)}
                  className={
                    settings.qaSourceMode === option.value
                      ? 'rounded-2xl border border-indigo-200 bg-indigo-50/80 px-4 py-3 text-left text-indigo-700 transition'
                      : 'rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-slate-600 transition hover:border-slate-300 hover:bg-white'
                  }
                >
                  <div className="text-sm font-medium">{option.label}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">{option.description}</div>
                </button>
              ))}
            </div>
          </SettingsField>

          <SettingsField
            label={l('批量概览生成', 'Batch Overview Generation')}
            description={l(
              '为文库中已解析的论文批量生成概览。',
              'Generate overviews in batch for parsed papers in the library.',
            )}
          >
            <div className="space-y-3">
              <ToggleRow
                title={l('自动生成概览', 'Auto Generate Overview')}
                description={l(
                  '检测到结构化内容后自动生成概览预览。',
                  'Automatically generate an overview preview once structured content is available.',
                )}
                checked={settings.autoGenerateSummary}
                onChange={(checked) => onSettingChange('autoGenerateSummary', checked)}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onBatchGenerateSummaries}
                  disabled={batchSummaryRunning}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                >
                  {batchSummaryRunning
                    ? l('处理中...', 'Processing...')
                    : l('全部生成概览', 'Generate All Overviews')}
                </button>
                {batchSummaryRunning ? (
                  <button
                    type="button"
                    onClick={onToggleBatchSummaryPause}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                  >
                    {batchSummaryPaused ? l('继续', 'Resume') : l('暂停', 'Pause')}
                  </button>
                ) : null}
                {batchSummaryRunning ? (
                  <button
                    type="button"
                    onClick={onCancelBatchSummary}
                    className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600 transition hover:bg-rose-100"
                  >
                    {l('取消', 'Cancel')}
                  </button>
                ) : null}
              </div>
              <BatchProgressCard
                title={l('批量概览生成进度', 'Batch Overview Progress')}
                progress={batchSummaryProgress}
                tone="emerald"
              />
            </div>
          </SettingsField>
        </>
      ) : null}
    </div>
  );
}

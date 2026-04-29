import { useRef } from 'react';
import { Database, FolderOpen, RefreshCw, X } from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import { useWheelScrollDelegate } from '../../../hooks/useWheelScrollDelegate';
import type {
  LibraryImportMode,
  LibrarySettings,
} from '../../../types/library';

interface LibrarySettingsDialogProps {
  open: boolean;
  settings: LibrarySettings | null;
  saving: boolean;
  metadataWorking: boolean;
  onClose: () => void;
  onSelectStorageDir: () => void;
  onDetectZoteroDir: () => void;
  onSelectZoteroDir: () => void;
  onImportZotero: () => void;
  onEnrichAllMetadata: () => void;
  onChange: (settings: LibrarySettings) => void;
  onSave: () => void;
}

function SettingLabel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <div className="text-sm font-semibold text-slate-800 dark:text-[#e0e0e0]">{title}</div>
      <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-[#a0a0a0]">
        {description}
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={[
        'relative h-7 w-12 rounded-full transition',
        checked ? 'bg-[#2f7f85]' : 'bg-slate-300 dark:bg-[#3a3a3a]',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition',
          checked ? 'left-6' : 'left-1',
        ].join(' ')}
      />
    </button>
  );
}

export default function LibrarySettingsDialog({
  open,
  settings,
  saving,
  metadataWorking,
  onClose,
  onSelectStorageDir,
  onDetectZoteroDir,
  onSelectZoteroDir,
  onImportZotero,
  onEnrichAllMetadata,
  onChange,
  onSave,
}: LibrarySettingsDialogProps) {
  const l = useLocaleText();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const handleWheelCapture = useWheelScrollDelegate({ rootRef: panelRef });

  if (!open || !settings) {
    return null;
  }

  const patch = (partial: Partial<LibrarySettings>) => onChange({ ...settings, ...partial });

  return (
    <div className="fixed inset-0 z-[82] flex items-center justify-center bg-slate-950/42 px-4 py-6 backdrop-blur-sm dark:bg-black/56">
      <div
        ref={panelRef}
        onWheelCapture={handleWheelCapture}
        className="flex max-h-[min(720px,calc(100vh-32px))] w-[min(820px,calc(100vw-32px))] flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_36px_120px_rgba(15,23,42,0.28)] dark:border-white/10 dark:bg-[#181818] dark:text-[#e0e0e0]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-white/10">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#8d8d8d]">
              {l('文库设置', 'Library Settings')}
            </div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">
              {l('本地文献与 Zotero 导入', 'Local Library and Zotero Import')}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#a0a0a0]">
              {l(
                '这里配置 PaperQuay 自己的文献库，也可以把 Zotero 本地分类和 PDF 导入为本地分类。',
                'Configure PaperQuay’s native library and import Zotero local collections and PDFs as native categories.',
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:opacity-60 dark:border-white/10 dark:bg-[#242424] dark:text-[#a0a0a0] dark:hover:bg-[#2b2b2b]"
            aria-label={l('关闭', 'Close')}
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </header>

        <div
          data-wheel-scroll-target
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-y-contain px-6 py-5"
        >
          <section className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-[#1e1e1e]">
            <SettingLabel
              title={l('默认文献存储文件夹', 'Default Paper Storage Folder')}
              description={l(
                '导入时选择复制或移动，PDF 会进入这个文件夹；选择保留原路径时不会复制文件。',
                'When import mode is copy or move, PDFs are placed here. Keep-path mode does not copy files.',
              )}
            />
            <div className="mt-3 flex gap-2">
              <input
                value={settings.storageDir}
                onChange={(event) => patch({ storageDir: event.target.value })}
                className="h-11 min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-400/10 dark:border-white/10 dark:bg-[#242424] dark:text-[#e0e0e0]"
              />
              <button
                type="button"
                onClick={onSelectStorageDir}
                className="inline-flex h-11 items-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-[#242424] dark:text-[#e0e0e0] dark:hover:bg-[#2b2b2b]"
              >
                <FolderOpen className="mr-2 h-4 w-4" strokeWidth={1.9} />
                {l('选择', 'Choose')}
              </button>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-[#1e1e1e]">
            <SettingLabel
              title={l('Zotero 本地数据目录', 'Zotero Local Data Directory')}
              description={l(
                '选择包含 zotero.sqlite 的 Zotero 数据目录。导入时会读取 Zotero 分类树，并把分类下的 PDF 导入当前本地文献库。',
                'Choose the Zotero data directory containing zotero.sqlite. Import reads the Zotero collection tree and imports PDFs into the native library.',
              )}
            />
            <div className="mt-3 flex gap-2">
              <input
                value={settings.zoteroLocalDataDir}
                onChange={(event) => patch({ zoteroLocalDataDir: event.target.value })}
                placeholder={l('例如 C:\\Users\\Lenovo\\Zotero', 'Example: C:\\Users\\Lenovo\\Zotero')}
                className="h-11 min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-400/10 dark:border-white/10 dark:bg-[#242424] dark:text-[#e0e0e0] dark:placeholder:text-[#8d8d8d]"
              />
              <button
                type="button"
                onClick={onDetectZoteroDir}
                className="inline-flex h-11 items-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-[#242424] dark:text-[#e0e0e0] dark:hover:bg-[#2b2b2b]"
              >
                <RefreshCw className="mr-2 h-4 w-4" strokeWidth={1.9} />
                {l('自动检测', 'Detect')}
              </button>
              <button
                type="button"
                onClick={onSelectZoteroDir}
                className="inline-flex h-11 items-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-[#242424] dark:text-[#e0e0e0] dark:hover:bg-[#2b2b2b]"
              >
                <FolderOpen className="mr-2 h-4 w-4" strokeWidth={1.9} />
                {l('选择', 'Choose')}
              </button>
            </div>
            <button
              type="button"
              onClick={onImportZotero}
              disabled={saving}
              className="mt-3 inline-flex h-11 items-center rounded-2xl bg-[#2f7f85] px-4 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(47,127,133,0.22)] transition hover:bg-[#286f75] disabled:opacity-60"
            >
              <Database className="mr-2 h-4 w-4" strokeWidth={1.9} />
              {l('导入 Zotero 分类和 PDF', 'Import Zotero Collections and PDFs')}
            </button>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-[#1e1e1e]">
            <SettingLabel
              title={l('全部文献元数据解析', 'Parse Metadata for All Papers')}
              description={l(
                '按 DOI、标题和 PDF 文件名批量查询 Crossref，自动补全或纠正文献标题、作者、年份、期刊、DOI、URL 和摘要。已有内容不会被清空。',
                'Batch query Crossref by DOI, title, and PDF filename to enrich title, authors, year, venue, DOI, URL, and abstract. Existing content is never cleared.',
              )}
            />
            <button
              type="button"
              onClick={onEnrichAllMetadata}
              disabled={saving || metadataWorking}
              className="mt-3 inline-flex h-11 items-center rounded-2xl border border-teal-200 bg-teal-50 px-4 text-sm font-semibold text-teal-700 transition hover:bg-teal-100 disabled:opacity-60 dark:border-teal-300/20 dark:bg-teal-300/10 dark:text-teal-100 dark:hover:bg-teal-300/15"
            >
              <RefreshCw
                className={metadataWorking ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'}
                strokeWidth={1.9}
              />
              {metadataWorking
                ? l('正在解析全部文献...', 'Parsing all papers...')
                : l('解析全部文献元数据', 'Parse All Metadata')}
            </button>
          </section>

          <section className="grid gap-4 rounded-3xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-[#1e1e1e] md:grid-cols-[1fr_260px]">
            <SettingLabel
              title={l('导入文件处理方式', 'Import File Handling')}
              description={l(
                '复制最安全；移动会整理原文件；保留原路径适合只建立索引。导入 Zotero 时通常建议使用复制。',
                'Copy is safest. Move organizes original files. Keep path indexes files without copying.',
              )}
            />
            <select
              value={settings.importMode}
              onChange={(event) => patch({ importMode: event.target.value as LibraryImportMode })}
              className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-400/10 dark:border-white/10 dark:bg-[#242424] dark:text-[#e0e0e0]"
            >
              <option value="copy">{l('复制到文献库文件夹', 'Copy into library folder')}</option>
              <option value="move">{l('移动到文献库文件夹', 'Move into library folder')}</option>
              <option value="keep">{l('保留原路径', 'Keep original path')}</option>
            </select>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-[#1e1e1e]">
            <SettingLabel
              title={l('文件命名规则', 'File Naming Rule')}
              description={l(
                '可用变量：{firstAuthor}、{year}、{title}、{doi}、{originalName}。',
                'Available variables: {firstAuthor}, {year}, {title}, {doi}, {originalName}.',
              )}
            />
            <input
              value={settings.fileNamingRule}
              onChange={(event) => patch({ fileNamingRule: event.target.value })}
              className="mt-3 h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 font-mono text-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-400/10 dark:border-white/10 dark:bg-[#242424] dark:text-[#e0e0e0]"
            />
          </section>

          <section className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-[#1e1e1e]">
            <div className="flex items-center justify-between gap-4">
              <SettingLabel
                title={l('导入时自动重命名 PDF', 'Automatically Rename PDFs')}
                description={l('开启后按命名规则生成文件名。', 'When enabled, filenames follow the naming rule.')}
              />
              <Toggle
                checked={settings.autoRenameFiles}
                onChange={(checked) => patch({ autoRenameFiles: checked })}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <SettingLabel
                title={l('保留原始路径记录', 'Preserve Original Path')}
                description={l('即使复制到文献库，也保留来源路径，方便追溯。', 'Keep the source path even after copying, useful for tracing.')}
              />
              <Toggle
                checked={settings.preserveOriginalPath}
                onChange={(checked) => patch({ preserveOriginalPath: checked })}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <SettingLabel
                title={l('按分类创建文件夹', 'Create Category Folders')}
                description={l('规划功能：导入时按目标分类建立子文件夹。', 'Planned: create subfolders by target category during import.')}
              />
              <Toggle
                checked={settings.createCategoryFolders}
                onChange={(checked) => patch({ createCategoryFolders: checked })}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <SettingLabel
                title={l('启用数据库备份', 'Enable Database Backup')}
                description={l('后续版本会在关键操作前自动备份 SQLite。', 'A later version will back up SQLite before critical operations.')}
              />
              <Toggle
                checked={settings.backupEnabled}
                onChange={(checked) => patch({ backupEnabled: checked })}
              />
            </div>

            <div className="flex items-center justify-between gap-4 opacity-70">
              <SettingLabel
                title={l('文件夹监听', 'Folder Watch')}
                description={l('规划功能：监听新增 PDF 并进入导入确认队列。', 'Planned: watch for new PDFs and send them to the import queue.')}
              />
              <Toggle
                checked={settings.folderWatchEnabled}
                onChange={(checked) => patch({ folderWatchEnabled: checked })}
              />
            </div>
          </section>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-white/10">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-white/10 dark:bg-[#242424] dark:text-[#e0e0e0] dark:hover:bg-[#2b2b2b]"
          >
            {l('取消', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-2xl bg-[#2f7f85] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#286f75] disabled:opacity-60"
          >
            {saving ? l('正在保存...', 'Saving...') : l('保存设置', 'Save Settings')}
          </button>
        </footer>
      </div>
    </div>
  );
}

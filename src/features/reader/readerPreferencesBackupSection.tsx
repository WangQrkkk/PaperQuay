import { useEffect, useState } from 'react';
import { Cloud, Download, RefreshCw, ShieldCheck } from 'lucide-react';

import {
  getWebdavBackupSettings,
  inspectLatestWebdavBackup,
  restoreMissingFromLatestWebdavBackup,
  runWebdavBackupNow,
  testWebdavBackupConnection,
  updateWebdavBackupSettings,
} from '../../services/webdavBackup';
import type {
  WebdavBackupResult,
  WebdavBackupSettings,
  WebdavLatestBackupInfo,
  WebdavRestoreResult,
} from '../../types/backup';
import {
  SettingsField,
  SettingsInput,
  ToggleRow,
} from './readerPreferencesPrimitives';
import type { ReaderPreferencesLocalizer } from './readerPreferencesTypes';

interface ReaderPreferencesBackupSectionProps {
  active: boolean;
  l: ReaderPreferencesLocalizer;
}

export function ReaderPreferencesBackupSection({
  active,
  l,
}: ReaderPreferencesBackupSectionProps) {
  const [settings, setSettings] = useState<WebdavBackupSettings | null>(null);
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [lastBackup, setLastBackup] = useState<WebdavBackupResult | null>(null);
  const [latestBackup, setLatestBackup] = useState<WebdavLatestBackupInfo | null>(null);
  const [lastRestore, setLastRestore] = useState<WebdavRestoreResult | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!active || loaded) {
      return undefined;
    }

    let cancelled = false;

    void (async () => {
      try {
        const latestSettings = await getWebdavBackupSettings();

        if (cancelled) {
          return;
        }

        setSettings(latestSettings);
        setPassword('');
        setMessage('');
      } catch (nextError) {
        if (cancelled) {
          return;
        }

        setMessage(
          nextError instanceof Error
            ? nextError.message
            : l('读取 WebDAV 备份设置失败', 'Failed to load WebDAV backup settings'),
        );
      } finally {
        if (!cancelled) {
          setLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, l, loaded]);

  if (!active) {
    return null;
  }

  const patchSettings = (partial: Partial<WebdavBackupSettings>) => {
    setSettings((current) => (current ? { ...current, ...partial } : current));
  };

  const saveSettingsDraft = async (clearPassword = false): Promise<WebdavBackupSettings | null> => {
    if (!settings) {
      return null;
    }

    const nextSettings = await updateWebdavBackupSettings({
      endpointUrl: settings.endpointUrl,
      remoteRoot: settings.remoteRoot,
      username: settings.username,
      password: password || undefined,
      clearPassword,
      includePdfs: settings.includePdfs,
      includeDerived: settings.includeDerived,
    });

    setSettings(nextSettings);
    setPassword('');
    return nextSettings;
  };

  const handleSave = async () => {
    setWorking(true);
    setMessage('');

    try {
      await saveSettingsDraft();
      setMessage(l('WebDAV 备份设置已保存', 'WebDAV backup settings saved'));
    } catch (nextError) {
      setMessage(
        nextError instanceof Error
          ? nextError.message
          : l('保存 WebDAV 备份设置失败', 'Failed to save WebDAV backup settings'),
      );
    } finally {
      setWorking(false);
    }
  };

  const handleClearPassword = async () => {
    setWorking(true);
    setMessage('');

    try {
      await saveSettingsDraft(true);
      setMessage(l('WebDAV 密码 / Token 已清除', 'WebDAV password / token cleared'));
    } catch (nextError) {
      setMessage(
        nextError instanceof Error
          ? nextError.message
          : l('清除 WebDAV 密码失败', 'Failed to clear WebDAV password'),
      );
    } finally {
      setWorking(false);
    }
  };

  const handleTestConnection = async () => {
    setWorking(true);
    setMessage(l('正在保存设置并测试 WebDAV...', 'Saving settings and testing WebDAV...'));

    try {
      await saveSettingsDraft();
      const result = await testWebdavBackupConnection();
      setMessage(result.message);
    } catch (nextError) {
      setMessage(
        nextError instanceof Error
          ? nextError.message
          : l('测试 WebDAV 连接失败', 'Failed to test WebDAV connection'),
      );
    } finally {
      setWorking(false);
    }
  };

  const handleRunBackup = async () => {
    setWorking(true);
    setMessage(l('正在保存设置并创建 WebDAV 备份...', 'Saving settings and creating a WebDAV backup...'));

    try {
      await saveSettingsDraft();
      const result = await runWebdavBackupNow();

      setLastBackup(result);
      setMessage(result.message);
    } catch (nextError) {
      setMessage(
        nextError instanceof Error
          ? nextError.message
          : l('WebDAV 手动备份失败', 'WebDAV manual backup failed'),
      );
    } finally {
      setWorking(false);
    }
  };

  const handleInspectLatest = async () => {
    setWorking(true);
    setMessage(l('正在读取最新备份信息...', 'Inspecting the latest backup...'));

    try {
      await saveSettingsDraft();
      const result = await inspectLatestWebdavBackup();

      setLatestBackup(result);
      setMessage(result.message);
    } catch (nextError) {
      setMessage(
        nextError instanceof Error
          ? nextError.message
          : l('读取最新 WebDAV 备份失败', 'Failed to inspect the latest WebDAV backup'),
      );
    } finally {
      setWorking(false);
    }
  };

  const handleRestoreMissing = async () => {
    setWorking(true);
    setMessage(
      l(
        '正在保存设置并补全恢复缺失内容...',
        'Saving settings and restoring missing local content...',
      ),
    );

    try {
      await saveSettingsDraft();
      const result = await restoreMissingFromLatestWebdavBackup();

      setLastRestore(result);
      setMessage(result.message);
    } catch (nextError) {
      setMessage(
        nextError instanceof Error
          ? nextError.message
          : l('WebDAV 补全恢复失败', 'WebDAV additive restore failed'),
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <SettingsField
      label={l('WebDAV 手动远程备份', 'WebDAV Manual Remote Backup')}
      description={l(
        '数据库始终保留在本地；这里配置远程副本。SQLite 通过 backup API 暂存后上传，PDF、MinerU、翻译和摘要缓存会先上传到临时对象再用 MOVE 提交。',
        'The database always stays local; this configures remote backup copies. SQLite is staged through the backup API, while PDFs, MinerU, translations, and summaries are uploaded to temporary objects and promoted with MOVE.',
      )}
    >
      {settings ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-500">
                {l('WebDAV 服务器地址', 'WebDAV Server URL')}
              </div>
              <SettingsInput
                value={settings.endpointUrl}
                onChange={(event) => patchSettings({ endpointUrl: event.target.value })}
                placeholder="https://dav.example.com/remote.php/dav/files/user"
              />
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-500">
                {l('远程根目录', 'Remote Root')}
              </div>
              <SettingsInput
                value={settings.remoteRoot}
                onChange={(event) => patchSettings({ remoteRoot: event.target.value })}
                placeholder="paperquay"
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-500">
                {l('账号 / 用户名', 'Account / Username')}
              </div>
              <SettingsInput
                value={settings.username}
                onChange={(event) => patchSettings({ username: event.target.value })}
                placeholder={l('WebDAV 账号', 'WebDAV account')}
              />
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-500">
                {settings.passwordConfigured
                  ? l('密码 / Token（留空则保留）', 'Password / Token (leave empty to keep)')
                  : l('密码 / Token', 'Password / Token')}
              </div>
              <SettingsInput
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={l('WebDAV 密码或应用 Token', 'WebDAV password or app token')}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <ToggleRow
              title={l('包含 PDF', 'Include PDFs')}
              description={l(
                '使用 content_hash 命名；远端 manifest 证明未变化时跳过上传。',
                'Use content_hash names and skip uploads when the remote manifest proves the file is unchanged.',
              )}
              checked={settings.includePdfs}
              onChange={(checked) => patchSettings({ includePdfs: checked })}
            />
            <ToggleRow
              title={l('包含解析 / 翻译 / 摘要缓存', 'Include Parse / Translation / Summary Caches')}
              description={l(
                '只上传 allowlist 缓存文件；不会上传阅读器配置、API Key 或 WebDAV 凭据。',
                'Only allowlisted cache files are uploaded; reader config, API keys, and WebDAV credentials are never uploaded.',
              )}
              checked={settings.includeDerived}
              onChange={(checked) => patchSettings({ includeDerived: checked })}
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs leading-5 text-slate-600 dark:border-white/10 dark:bg-chrome-700 dark:text-chrome-200">
            {l(
              '恢复是补全式的：本地缺什么补什么，本地比云端多的不会删除；本地数据库文件不会被远端 SQLite 直接覆盖。',
              'Restore is additive: it fills local gaps, never deletes local extras, and never replaces the live local SQLite file with the remote backup.',
            )}
          </div>

          {message ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs leading-5 text-slate-600 dark:border-white/10 dark:bg-chrome-700 dark:text-chrome-200">
              {message}
            </div>
          ) : null}

          {lastBackup ? (
            <div className="rounded-2xl border border-teal-200 bg-teal-50/80 px-3 py-2 text-xs leading-5 text-teal-800 dark:border-accent-teal/30 dark:bg-accent-teal/10 dark:text-accent-teal">
              {l(
                `最近备份：上传 ${lastBackup.uploadedCount}，跳过 ${lastBackup.skippedCount}，数据库 ${lastBackup.databaseCount}，PDF ${lastBackup.pdfCount}，缓存 ${lastBackup.derivedCount}`,
                `Last backup: uploaded ${lastBackup.uploadedCount}, skipped ${lastBackup.skippedCount}, database ${lastBackup.databaseCount}, PDFs ${lastBackup.pdfCount}, caches ${lastBackup.derivedCount}`,
              )}
            </div>
          ) : null}

          {latestBackup ? (
            <div className="rounded-2xl border border-sky-200 bg-sky-50/80 px-3 py-2 text-xs leading-5 text-sky-800 dark:border-sky-300/30 dark:bg-sky-400/10 dark:text-sky-200">
              {latestBackup.available
                ? l(
                    `最新远端备份：${latestBackup.backupId ?? 'unknown'}，上传 ${latestBackup.uploadedCount}，PDF ${latestBackup.pdfCount}，缓存 ${latestBackup.derivedCount}`,
                    `Latest remote backup: ${latestBackup.backupId ?? 'unknown'}, uploaded ${latestBackup.uploadedCount}, PDFs ${latestBackup.pdfCount}, caches ${latestBackup.derivedCount}`,
                  )
                : l('远端还没有 latest 备份。', 'No latest backup exists on WebDAV yet.')}
            </div>
          ) : null}

          {lastRestore ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-200">
              {l(
                `最近恢复：下载 ${lastRestore.downloadedCount}，跳过 ${lastRestore.skippedCount}，合并 ${lastRestore.mergedRowCount} 行，修补 ${lastRestore.updatedRowCount} 行`,
                `Last restore: downloaded ${lastRestore.downloadedCount}, skipped ${lastRestore.skippedCount}, merged ${lastRestore.mergedRowCount} rows, repaired ${lastRestore.updatedRowCount} rows`,
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={working}
              className="inline-flex rounded-xl border border-teal-200 bg-white px-4 py-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-50 disabled:opacity-60 dark:border-accent-teal/30 dark:bg-chrome-700 dark:text-accent-teal dark:hover:bg-accent-teal/10"
            >
              <ShieldCheck className="mr-2 h-4 w-4" strokeWidth={1.8} />
              {l('保存 WebDAV 设置', 'Save WebDAV Settings')}
            </button>
            <button
              type="button"
              onClick={() => void handleTestConnection()}
              disabled={working}
              className="inline-flex rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-white/10 dark:bg-chrome-700 dark:text-chrome-100 dark:hover:bg-chrome-600"
            >
              <RefreshCw className={working ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} strokeWidth={1.8} />
              {l('测试连接', 'Test Connection')}
            </button>
            <button
              type="button"
              onClick={() => void handleRunBackup()}
              disabled={working}
              className="inline-flex rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-500 disabled:opacity-60 dark:bg-accent-teal dark:text-chrome-950 dark:hover:bg-accent-teal/90"
            >
              <Cloud className="mr-2 h-4 w-4" strokeWidth={1.8} />
              {working ? l('处理中...', 'Working...') : l('立即手动备份', 'Back Up Now')}
            </button>
            <button
              type="button"
              onClick={() => void handleInspectLatest()}
              disabled={working}
              className="inline-flex rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-700 transition hover:bg-sky-100 disabled:opacity-60 dark:border-sky-300/30 dark:bg-sky-400/10 dark:text-sky-200"
            >
              <RefreshCw className="mr-2 h-4 w-4" strokeWidth={1.8} />
              {l('查看最新备份', 'Inspect Latest Backup')}
            </button>
            <button
              type="button"
              onClick={() => void handleRestoreMissing()}
              disabled={working}
              className="inline-flex rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-60 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-200"
            >
              <Download className="mr-2 h-4 w-4" strokeWidth={1.8} />
              {l('补全恢复缺失内容', 'Restore Missing Content')}
            </button>
            {settings.passwordConfigured ? (
              <button
                type="button"
                onClick={() => void handleClearPassword()}
                disabled={working}
                className="inline-flex rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600 transition hover:bg-rose-100 disabled:opacity-60 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-300"
              >
                {l('清除密码', 'Clear Password')}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-500 dark:border-white/10 dark:bg-chrome-700 dark:text-chrome-300">
          {loaded
            ? message || l('WebDAV 备份设置不可用', 'WebDAV backup settings unavailable')
            : l('正在读取 WebDAV 备份设置...', 'Loading WebDAV backup settings...')}
        </div>
      )}
    </SettingsField>
  );
}

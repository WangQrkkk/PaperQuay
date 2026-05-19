export type BackupObjectKind = 'database' | 'pdf' | 'mineru' | 'translation' | 'summary';

export type BackupObjectStatus = 'uploaded' | 'skipped' | 'failed';
export type RestoreObjectStatus = 'downloaded' | 'skipped' | 'failed';

export interface WebdavBackupSettingsView {
  endpointUrl: string;
  remoteRoot: string;
  username: string;
  passwordConfigured: boolean;
  includePdfs: boolean;
  includeDerived: boolean;
  updatedAtMs: number;
}

export type WebdavBackupSettings = WebdavBackupSettingsView;

export interface WebdavBackupSettingsInput {
  endpointUrl: string;
  remoteRoot: string;
  username: string;
  password?: string;
  clearPassword?: boolean;
  includePdfs: boolean;
  includeDerived: boolean;
}

export interface WebdavBackupSettingsDraft {
  endpointUrl: string;
  remoteRoot: string;
  username: string;
  password: string;
  clearPassword: boolean;
  includePdfs: boolean;
  includeDerived: boolean;
}

export interface WebdavConnectionTestResult {
  ok: boolean;
  endpointUrl: string;
  remoteRoot: string;
  message: string;
}

export interface BackupObject {
  kind: BackupObjectKind;
  remotePath: string;
  byteSize: number;
  checksum: string;
  status: BackupObjectStatus;
  uploaded: boolean;
  source: string;
  message: string | null;
}

export interface WebdavBackupResult {
  ok: boolean;
  backupId: string;
  createdAt: string;
  manifestRemotePath: string;
  runManifestRemotePath: string;
  uploadedCount: number;
  skippedCount: number;
  failedCount: number;
  databaseCount: number;
  pdfCount: number;
  derivedCount: number;
  message: string;
  objects: BackupObject[];
}

export interface WebdavLatestBackupInfo {
  available: boolean;
  backupId: string | null;
  createdAt: string | null;
  manifestRemotePath: string;
  uploadedCount: number;
  skippedCount: number;
  failedCount: number;
  databaseCount: number;
  pdfCount: number;
  derivedCount: number;
  message: string;
  objects: BackupObject[];
}

export interface RestoreObject {
  kind: BackupObjectKind;
  remotePath: string;
  localPath: string;
  byteSize: number;
  checksum: string;
  status: RestoreObjectStatus;
  message: string | null;
}

export interface RestoreTableStat {
  table: string;
  insertedCount: number;
  updatedCount: number;
}

export interface WebdavRestoreResult {
  ok: boolean;
  backupId: string | null;
  createdAt: string | null;
  manifestRemotePath: string;
  downloadedCount: number;
  skippedCount: number;
  failedCount: number;
  mergedRowCount: number;
  updatedRowCount: number;
  pdfRestoredCount: number;
  derivedRestoredCount: number;
  message: string;
  objects: RestoreObject[];
  tables: RestoreTableStat[];
}

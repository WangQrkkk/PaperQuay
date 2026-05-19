use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use chrono::Utc;
use reqwest::{Client, Method, StatusCode, Url};
use rusqlite::{params, Connection, DatabaseName};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::commands::library::{library_get_settings, open_library_connection};
use crate::commands::rag::{ensure_rag_vector_table, rag_vector_table_name};

const SETTINGS_FILE_NAME: &str = "webdav-backup.json";
const DEFAULT_REMOTE_ROOT: &str = "paperquay";
const DATABASE_REMOTE_PATH: &str = "latest/database/paperquay-library.sqlite3";
const LATEST_MANIFEST_REMOTE_PATH: &str = "latest/manifest.json";
const DERIVED_ROOT_SKIP_REMOTE_PATH: &str = "latest/derived";
const REMOTE_SCHEMA: &str = "remote_restore";
const ALLOWED_MINERU_FILES: [&str; 4] = [
    "paper_reader_manifest.json",
    "content_list_v2.json",
    "middle.json",
    "full.md",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredWebdavBackupSettings {
    endpoint_url: String,
    remote_root: String,
    username: String,
    password: String,
    include_pdfs: bool,
    include_derived: bool,
    updated_at_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebdavBackupSettingsView {
    endpoint_url: String,
    remote_root: String,
    username: String,
    password_configured: bool,
    include_pdfs: bool,
    include_derived: bool,
    updated_at_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebdavBackupSettingsInput {
    endpoint_url: String,
    remote_root: String,
    username: String,
    password: Option<String>,
    clear_password: Option<bool>,
    include_pdfs: bool,
    include_derived: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebdavConnectionTestResult {
    ok: bool,
    endpoint_url: String,
    remote_root: String,
    message: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BackupObjectKind {
    Database,
    Pdf,
    Mineru,
    Translation,
    Summary,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BackupObjectStatus {
    Uploaded,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupObject {
    kind: BackupObjectKind,
    remote_path: String,
    byte_size: u64,
    checksum: String,
    status: BackupObjectStatus,
    uploaded: bool,
    source: String,
    message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifestApp {
    name: String,
    version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    uploaded_count: usize,
    skipped_count: usize,
    failed_count: usize,
    database_count: usize,
    pdf_count: usize,
    derived_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebdavBackupManifest {
    version: u32,
    backup_id: String,
    created_at: String,
    app: BackupManifestApp,
    objects: Vec<BackupObject>,
    summary: BackupSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebdavBackupResult {
    ok: bool,
    backup_id: String,
    created_at: String,
    manifest_remote_path: String,
    run_manifest_remote_path: String,
    uploaded_count: usize,
    skipped_count: usize,
    failed_count: usize,
    database_count: usize,
    pdf_count: usize,
    derived_count: usize,
    message: String,
    objects: Vec<BackupObject>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RestoreObjectStatus {
    Downloaded,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreObject {
    kind: BackupObjectKind,
    remote_path: String,
    local_path: String,
    byte_size: u64,
    checksum: String,
    status: RestoreObjectStatus,
    message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreTableStat {
    table: String,
    inserted_count: usize,
    updated_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebdavLatestBackupInfo {
    available: bool,
    backup_id: Option<String>,
    created_at: Option<String>,
    manifest_remote_path: String,
    uploaded_count: usize,
    skipped_count: usize,
    failed_count: usize,
    database_count: usize,
    pdf_count: usize,
    derived_count: usize,
    message: String,
    objects: Vec<BackupObject>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebdavRestoreResult {
    ok: bool,
    backup_id: Option<String>,
    created_at: Option<String>,
    manifest_remote_path: String,
    downloaded_count: usize,
    skipped_count: usize,
    failed_count: usize,
    merged_row_count: usize,
    updated_row_count: usize,
    pdf_restored_count: usize,
    derived_restored_count: usize,
    message: String,
    objects: Vec<RestoreObject>,
    tables: Vec<RestoreTableStat>,
}

#[derive(Debug)]
struct FileDigest {
    byte_size: u64,
    checksum: String,
}

#[derive(Debug)]
struct PdfAttachment {
    id: String,
    paper_id: String,
    stored_path: String,
    file_name: String,
    file_size: i64,
    content_hash: Option<String>,
}

#[derive(Debug)]
struct LocalBackupFile {
    kind: BackupObjectKind,
    path: PathBuf,
    remote_path: String,
    source: String,
}

#[derive(Clone)]
struct WebdavClient {
    http: Client,
    endpoint_url: String,
    remote_root: String,
    username: String,
    password: String,
}

#[derive(Clone)]
struct PreviousObject {
    byte_size: u64,
    checksum: String,
    uploaded: bool,
}

#[derive(Debug, Clone)]
struct LocalAttachmentRecord {
    stored_path: String,
    relative_path: Option<String>,
    missing: bool,
}

#[derive(Debug, Clone)]
struct RemoteAttachment {
    id: String,
    paper_id: String,
    kind: String,
    original_path: Option<String>,
    relative_path: Option<String>,
    file_name: String,
    mime_type: String,
    file_size: i64,
    content_hash: Option<String>,
    created_at: i64,
    missing: bool,
}

#[derive(Debug, Clone)]
struct AttachmentRestorePlan {
    stored_path: String,
    relative_path: Option<String>,
    available: bool,
}

#[derive(Debug, Clone)]
struct WebdavCollectionEntry {
    remote_path: String,
    is_collection: bool,
    byte_size: u64,
    last_modified: Option<String>,
}

#[derive(Debug, Clone)]
struct ResolvedLatestManifest {
    manifest: WebdavBackupManifest,
    manifest_remote_path: String,
    notice: Option<String>,
}

fn current_unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or_default()
}

fn default_settings() -> StoredWebdavBackupSettings {
    StoredWebdavBackupSettings {
        endpoint_url: String::new(),
        remote_root: DEFAULT_REMOTE_ROOT.to_string(),
        username: String::new(),
        password: String::new(),
        include_pdfs: true,
        include_derived: true,
        updated_at_ms: 0,
    }
}

fn settings_view(settings: StoredWebdavBackupSettings) -> WebdavBackupSettingsView {
    WebdavBackupSettingsView {
        endpoint_url: settings.endpoint_url,
        remote_root: settings.remote_root,
        username: settings.username,
        password_configured: !settings.password.is_empty(),
        include_pdfs: settings.include_pdfs,
        include_derived: settings.include_derived,
        updated_at_ms: settings.updated_at_ms,
    }
}

fn app_local_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to resolve app local data dir: {error}"))?;
    fs::create_dir_all(&dir).map_err(|error| {
        format!(
            "Failed to create app local data dir {}: {error}",
            dir.display()
        )
    })?;
    Ok(dir)
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_local_data_dir(app)?.join(SETTINGS_FILE_NAME))
}

fn load_settings(app: &AppHandle) -> Result<StoredWebdavBackupSettings, String> {
    let path = settings_path(app)?;

    if !path.exists() {
        return Ok(default_settings());
    }

    let text = fs::read_to_string(&path).map_err(|error| {
        format!(
            "Failed to read WebDAV backup settings {}: {error}",
            path.display()
        )
    })?;
    serde_json::from_str::<StoredWebdavBackupSettings>(&text).map_err(|error| {
        format!(
            "Failed to parse WebDAV backup settings {}: {error}",
            path.display()
        )
    })
}

fn save_settings(app: &AppHandle, settings: &StoredWebdavBackupSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("Invalid settings path: {}", path.display()))?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Failed to create settings dir {}: {error}",
            parent.display()
        )
    })?;

    let temp_path = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("Failed to serialize WebDAV backup settings: {error}"))?;
    fs::write(&temp_path, text).map_err(|error| {
        format!(
            "Failed to write temporary settings {}: {error}",
            temp_path.display()
        )
    })?;

    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("Failed to replace settings {}: {error}", path.display()))?;
    }

    fs::rename(&temp_path, &path)
        .map_err(|error| format!("Failed to commit settings {}: {error}", path.display()))
}

fn normalize_remote_root(value: &str) -> Result<String, String> {
    let parts = value
        .trim()
        .replace('\\', "/")
        .split('/')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(|part| {
            if part == "." || part == ".." {
                Err("WebDAV remote root must not contain . or ..".to_string())
            } else {
                Ok(part.to_string())
            }
        })
        .collect::<Result<Vec<_>, String>>()?;

    if parts.is_empty() {
        return Err("WebDAV remote root must not be empty".to_string());
    }

    Ok(parts.join("/"))
}

fn validate_settings(settings: &StoredWebdavBackupSettings) -> Result<(), String> {
    let endpoint_url = settings.endpoint_url.trim();

    if endpoint_url.is_empty() {
        return Err("WebDAV URL must not be empty".to_string());
    }

    let parsed =
        Url::parse(endpoint_url).map_err(|error| format!("Invalid WebDAV URL: {error}"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("WebDAV URL must use http or https".to_string()),
    }

    normalize_remote_root(&settings.remote_root)?;
    Ok(())
}

fn sanitize_remote_segment(value: &str, fallback: &str) -> String {
    let mut output = String::new();
    let mut previous_dash = false;

    for character in value.trim().chars() {
        let next = if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
            previous_dash = false;
            Some(character)
        } else if previous_dash {
            None
        } else {
            previous_dash = true;
            Some('-')
        };

        if let Some(next) = next {
            output.push(next);
        }

        if output.len() >= 160 {
            break;
        }
    }

    let output = output.trim_matches('-').trim_matches('.');
    if output.is_empty() {
        fallback.to_string()
    } else {
        output.to_string()
    }
}

fn sanitize_json_file_name(value: &str, fallback_stem: &str) -> String {
    let path = Path::new(value);
    let stem = path
        .file_stem()
        .and_then(|next| next.to_str())
        .unwrap_or(fallback_stem);
    format!("{}.json", sanitize_remote_segment(stem, fallback_stem))
}

fn sanitize_local_file_name(value: &str) -> String {
    let candidate = Path::new(value)
        .file_name()
        .and_then(|next| next.to_str())
        .unwrap_or("paper.pdf");
    let sanitized = candidate
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            character if character.is_control() => '_',
            other => other,
        })
        .collect::<String>()
        .trim()
        .to_string();

    if sanitized.is_empty() {
        "paper.pdf".to_string()
    } else if sanitized.to_ascii_lowercase().ends_with(".pdf") {
        sanitized
    } else {
        format!("{sanitized}.pdf")
    }
}

fn percent_encode_segment(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut output = String::new();

    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(*byte, b'-' | b'.' | b'_' | b'~') {
            output.push(char::from(*byte));
        } else {
            output.push('%');
            output.push(char::from(HEX[(byte >> 4) as usize]));
            output.push(char::from(HEX[(byte & 0x0f) as usize]));
        }
    }

    output
}

fn split_remote_path(value: &str) -> Vec<&str> {
    value
        .split('/')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect()
}

fn parent_remote_path(remote_path: &str) -> Option<String> {
    remote_path
        .rsplit_once('/')
        .map(|(parent, _)| parent.to_string())
        .filter(|parent| !parent.is_empty())
}

fn temp_upload_path(final_path: &str, backup_id: &str) -> String {
    format!("{}.uploading-{}", final_path, backup_id)
}

fn http_date_to_rfc3339(value: &str) -> Option<String> {
    chrono::DateTime::parse_from_rfc2822(value)
        .ok()
        .map(|date| date.with_timezone(&Utc).to_rfc3339())
}

fn http_date_to_backup_id(value: &str) -> Option<String> {
    chrono::DateTime::parse_from_rfc2822(value)
        .ok()
        .map(|date| {
            format!(
                "recovered-{}",
                date.with_timezone(&Utc).format("%Y%m%dT%H%M%SZ")
            )
        })
}

fn manifest_object_is_restorable(object: &BackupObject) -> bool {
    object.uploaded || object.byte_size > 0 || !object.checksum.trim().is_empty()
}

fn recovered_pdf_remote_path(remote_attachment: &RemoteAttachment) -> String {
    let hash = remote_attachment
        .content_hash
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| sanitize_remote_segment(value, "pdf"))
        .unwrap_or_else(|| sanitize_remote_segment(&remote_attachment.id, "pdf"));

    format!("latest/papers/{hash}.pdf")
}

fn classify_listed_derived_object(entry: &WebdavCollectionEntry) -> Option<BackupObjectKind> {
    let parts = split_remote_path(&entry.remote_path);

    if parts.len() != 5 || parts[0] != "latest" || parts[1] != "derived" {
        return None;
    }

    match parts[2] {
        "mineru" if ALLOWED_MINERU_FILES.contains(&parts[4]) => Some(BackupObjectKind::Mineru),
        "translations" if parts[4].ends_with(".json") => Some(BackupObjectKind::Translation),
        "summaries" if parts[4].ends_with(".json") => Some(BackupObjectKind::Summary),
        _ => None,
    }
}

fn webdav_method(name: &'static str) -> Result<Method, String> {
    Method::from_bytes(name.as_bytes())
        .map_err(|error| format!("Failed to build WebDAV method: {error}"))
}

impl WebdavClient {
    fn new(settings: &StoredWebdavBackupSettings) -> Result<Self, String> {
        validate_settings(settings)?;

        let http = Client::builder()
            .timeout(Duration::from_secs(180))
            .build()
            .map_err(|error| format!("Failed to build WebDAV HTTP client: {error}"))?;

        Ok(Self {
            http,
            endpoint_url: settings
                .endpoint_url
                .trim()
                .trim_end_matches('/')
                .to_string(),
            remote_root: normalize_remote_root(&settings.remote_root)?,
            username: settings.username.trim().to_string(),
            password: settings.password.clone(),
        })
    }

    fn build_url(&self, remote_path: &str) -> Result<Url, String> {
        let parts = split_remote_path(&self.remote_root)
            .into_iter()
            .chain(split_remote_path(remote_path))
            .map(percent_encode_segment)
            .collect::<Vec<_>>();
        let url = format!("{}/{}", self.endpoint_url, parts.join("/"));
        Url::parse(&url).map_err(|error| format!("Failed to build WebDAV URL {url}: {error}"))
    }

    fn request(
        &self,
        method: Method,
        remote_path: &str,
    ) -> Result<reqwest::RequestBuilder, String> {
        let url = self.build_url(remote_path)?;
        let request = self.http.request(method, url);

        if self.username.is_empty() && self.password.is_empty() {
            Ok(request)
        } else {
            Ok(request.basic_auth(&self.username, Some(&self.password)))
        }
    }

    fn remote_path_from_href(&self, href: &str) -> Result<Option<String>, String> {
        let href_path = Url::parse(href)
            .map(|url| url.path().to_string())
            .unwrap_or_else(|_| href.to_string());
        let href_path = href_path
            .split('?')
            .next()
            .unwrap_or(href_path.as_str())
            .trim_end_matches('/');
        let root_path = self.build_url("")?.path().trim_end_matches('/').to_string();

        if href_path == root_path {
            return Ok(Some(String::new()));
        }

        let prefix = format!("{root_path}/");
        Ok(href_path
            .strip_prefix(&prefix)
            .map(|value| value.trim_matches('/').to_string()))
    }

    async fn propfind_text(&self, remote_path: &str, depth: u8) -> Result<Option<String>, String> {
        let response = self
            .request(webdav_method("PROPFIND")?, remote_path)?
            .header("Depth", depth.to_string())
            .send()
            .await
            .map_err(|error| format!("Failed to list WebDAV collection {remote_path}: {error}"))?;
        let status = response.status();

        if status == StatusCode::NOT_FOUND {
            return Ok(None);
        }

        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "Failed to list WebDAV collection {remote_path}: HTTP {} {}",
                status,
                truncate_for_display(&body, 300)
            ));
        }

        response
            .text()
            .await
            .map(Some)
            .map_err(|error| format!("Failed to read WebDAV PROPFIND body {remote_path}: {error}"))
    }

    async fn list_collection(
        &self,
        remote_path: &str,
    ) -> Result<Vec<WebdavCollectionEntry>, String> {
        let Some(xml) = self.propfind_text(remote_path, 1).await? else {
            return Ok(Vec::new());
        };
        let document = roxmltree::Document::parse(&xml).map_err(|error| {
            format!("Failed to parse WebDAV PROPFIND XML for {remote_path}: {error}")
        })?;
        let requested = remote_path.trim_matches('/').to_string();
        let mut seen = HashSet::new();
        let mut entries = Vec::new();

        for response in document
            .descendants()
            .filter(|node| node.is_element() && node.tag_name().name() == "response")
        {
            let href = response
                .descendants()
                .find(|node| node.is_element() && node.tag_name().name() == "href")
                .and_then(|node| node.text())
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let Some(href) = href else {
                continue;
            };

            let Some(listed_path) = self.remote_path_from_href(href)? else {
                continue;
            };

            if listed_path == requested || !seen.insert(listed_path.clone()) {
                continue;
            }

            let is_direct_child = if requested.is_empty() {
                split_remote_path(&listed_path).len() == 1
            } else {
                parent_remote_path(&listed_path).as_deref() == Some(requested.as_str())
            };

            if !is_direct_child {
                continue;
            }

            let is_collection = response
                .descendants()
                .any(|node| node.is_element() && node.tag_name().name() == "collection");
            let byte_size = response
                .descendants()
                .find(|node| node.is_element() && node.tag_name().name() == "getcontentlength")
                .and_then(|node| node.text())
                .and_then(|value| value.trim().parse::<u64>().ok())
                .unwrap_or(0);
            let last_modified = response
                .descendants()
                .find(|node| node.is_element() && node.tag_name().name() == "getlastmodified")
                .and_then(|node| node.text())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);

            entries.push(WebdavCollectionEntry {
                remote_path: listed_path,
                is_collection,
                byte_size,
                last_modified,
            });
        }

        Ok(entries)
    }

    async fn list_files_recursively(
        &self,
        remote_path: &str,
    ) -> Result<Vec<WebdavCollectionEntry>, String> {
        let mut pending = vec![remote_path.trim_matches('/').to_string()];
        let mut files = Vec::new();

        while let Some(next) = pending.pop() {
            for entry in self.list_collection(&next).await? {
                if entry.is_collection {
                    pending.push(entry.remote_path.clone());
                } else {
                    files.push(entry);
                }
            }
        }

        Ok(files)
    }

    async fn ensure_collection(&self, remote_path: &str) -> Result<(), String> {
        let response = self
            .request(webdav_method("MKCOL")?, remote_path)?
            .send()
            .await
            .map_err(|error| {
                format!(
                    "Failed to create WebDAV collection {}: {error}",
                    display_remote_path(remote_path)
                )
            })?;
        let status = response.status();

        if status.is_success() || status == StatusCode::METHOD_NOT_ALLOWED {
            return Ok(());
        }

        let body = response.text().await.unwrap_or_default();
        Err(format!(
            "Failed to create WebDAV collection {}: HTTP {} {}",
            display_remote_path(remote_path),
            status,
            truncate_for_display(&body, 300)
        ))
    }

    async fn ensure_parent_collections(&self, remote_path: &str) -> Result<(), String> {
        self.ensure_collection("").await?;

        let Some(parent) = parent_remote_path(remote_path) else {
            return Ok(());
        };

        let mut current = String::new();
        for segment in split_remote_path(&parent) {
            if !current.is_empty() {
                current.push('/');
            }
            current.push_str(segment);
            self.ensure_collection(&current).await?;
        }

        Ok(())
    }

    async fn head_content_length(&self, remote_path: &str) -> Result<Option<u64>, String> {
        let response = self
            .request(Method::HEAD, remote_path)?
            .send()
            .await
            .map_err(|error| format!("Failed to inspect WebDAV object {remote_path}: {error}"))?;
        let status = response.status();

        if status == StatusCode::NOT_FOUND || status == StatusCode::METHOD_NOT_ALLOWED {
            return Ok(None);
        }

        if !status.is_success() {
            return Err(format!(
                "Failed to inspect WebDAV object {remote_path}: HTTP {status}"
            ));
        }

        let content_length = response
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok());

        if content_length == Some(0) {
            return Ok(None);
        }

        Ok(content_length)
    }

    async fn delete_temp(&self, remote_path: &str) {
        if let Ok(request) = self.request(Method::DELETE, remote_path) {
            let _ = request.send().await;
        }
    }

    async fn atomic_upload_bytes(
        &self,
        final_path: &str,
        backup_id: &str,
        bytes: Vec<u8>,
    ) -> Result<(), String> {
        self.ensure_parent_collections(final_path).await?;

        let temp_path = temp_upload_path(final_path, backup_id);
        let response = self
            .request(Method::PUT, &temp_path)?
            .body(bytes.clone())
            .send()
            .await
            .map_err(|error| format!("Failed to upload WebDAV temp object {temp_path}: {error}"))?;
        let status = response.status();

        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "Failed to upload WebDAV temp object {temp_path}: HTTP {} {}",
                status,
                truncate_for_display(&body, 300)
            ));
        }

        if let Some(remote_size) = self.head_content_length(&temp_path).await? {
            if remote_size != bytes.len() as u64 {
                self.delete_temp(&temp_path).await;
                return Err(format!(
                    "WebDAV temp object size mismatch {temp_path}: local={} remote={remote_size}",
                    bytes.len()
                ));
            }
        }

        let destination = self.build_url(final_path)?.to_string();
        let response = self
            .request(webdav_method("MOVE")?, &temp_path)?
            .header("Destination", destination)
            .header("Overwrite", "T")
            .send()
            .await
            .map_err(|error| {
                format!("Failed to promote WebDAV object {temp_path} -> {final_path}: {error}")
            })?;
        let status = response.status();

        if status.is_success() {
            return Ok(());
        }

        let body = response.text().await.unwrap_or_default();
        self.delete_temp(&temp_path).await;
        Err(format!(
            "Failed to promote WebDAV object {temp_path} -> {final_path}: HTTP {} {}",
            status,
            truncate_for_display(&body, 300)
        ))
    }

    async fn atomic_upload_file(
        &self,
        final_path: &str,
        backup_id: &str,
        local_path: &Path,
    ) -> Result<(), String> {
        let bytes = fs::read(local_path).map_err(|error| {
            format!(
                "Failed to read upload file {}: {error}",
                local_path.display()
            )
        })?;
        self.atomic_upload_bytes(final_path, backup_id, bytes).await
    }

    async fn get_text_if_exists(&self, remote_path: &str) -> Result<Option<String>, String> {
        let response = self
            .request(Method::GET, remote_path)?
            .send()
            .await
            .map_err(|error| format!("Failed to read WebDAV object {remote_path}: {error}"))?;
        let status = response.status();

        if status == StatusCode::NOT_FOUND {
            return Ok(None);
        }

        if !status.is_success() {
            return Err(format!(
                "Failed to read WebDAV object {remote_path}: HTTP {status}"
            ));
        }

        response
            .text()
            .await
            .map(Some)
            .map_err(|error| format!("Failed to read WebDAV text body {remote_path}: {error}"))
    }

    async fn get_bytes(&self, remote_path: &str) -> Result<Vec<u8>, String> {
        let response = self
            .request(Method::GET, remote_path)?
            .send()
            .await
            .map_err(|error| format!("Failed to download WebDAV object {remote_path}: {error}"))?;
        let status = response.status();

        if status == StatusCode::NOT_FOUND {
            return Err(format!("WebDAV object not found: {remote_path}"));
        }

        if !status.is_success() {
            return Err(format!(
                "Failed to download WebDAV object {remote_path}: HTTP {status}"
            ));
        }

        response
            .bytes()
            .await
            .map(|bytes| bytes.to_vec())
            .map_err(|error| format!("Failed to read WebDAV binary body {remote_path}: {error}"))
    }
}

fn display_remote_path(remote_path: &str) -> String {
    if remote_path.is_empty() {
        "<root>".to_string()
    } else {
        remote_path.to_string()
    }
}

fn truncate_for_display(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();

    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

fn digest_file(path: &Path) -> Result<FileDigest, String> {
    let mut file = File::open(path).map_err(|error| {
        format!(
            "Failed to open file for hashing {}: {error}",
            path.display()
        )
    })?;
    let mut hasher = Sha256::new();
    let mut byte_size = 0u64;
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let read = file.read(&mut buffer).map_err(|error| {
            format!(
                "Failed to read file for hashing {}: {error}",
                path.display()
            )
        })?;

        if read == 0 {
            break;
        }

        byte_size = byte_size.saturating_add(read as u64);
        hasher.update(&buffer[..read]);
    }

    Ok(FileDigest {
        byte_size,
        checksum: format!("sha256:{:x}", hasher.finalize()),
    })
}

fn digest_bytes(bytes: &[u8]) -> FileDigest {
    let mut hasher = Sha256::new();
    hasher.update(bytes);

    FileDigest {
        byte_size: bytes.len() as u64,
        checksum: format!("sha256:{:x}", hasher.finalize()),
    }
}

fn ensure_relative_subpath(relative_path: &Path) -> Result<(), String> {
    if relative_path.is_absolute() {
        return Err(format!(
            "Relative local path must not be absolute: {}",
            relative_path.display()
        ));
    }

    if relative_path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::Prefix(_) | Component::RootDir
        )
    }) {
        return Err(format!(
            "Relative local path contains unsafe segments: {}",
            relative_path.display()
        ));
    }

    Ok(())
}

fn safe_join_local_path(root: &Path, relative_path: &Path) -> Result<PathBuf, String> {
    ensure_relative_subpath(relative_path)?;
    Ok(root.join(relative_path))
}

fn relative_path_under(root: &Path, path: &Path) -> Option<String> {
    if root.as_os_str().is_empty() {
        return None;
    }

    path.strip_prefix(root)
        .ok()
        .map(|value| value.to_string_lossy().into_owned())
}

fn path_to_string_lossy(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn unique_local_restore_path(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }

    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("restored");
    let extension = path.extension().and_then(|value| value.to_str());

    for index in 2..10_000 {
        let file_name = match extension {
            Some(extension) if !extension.is_empty() => {
                format!("{stem}.restored-{index}.{extension}")
            }
            _ => format!("{stem}.restored-{index}"),
        };
        let candidate = parent.join(file_name);

        if !candidate.exists() {
            return candidate;
        }
    }

    match extension {
        Some(extension) if !extension.is_empty() => parent.join(format!(
            "{stem}.restored-{}.{}",
            current_unix_millis(),
            extension
        )),
        _ => parent.join(format!("{stem}.restored-{}", current_unix_millis())),
    }
}

fn write_bytes_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create local dir {}: {error}", parent.display()))?;
    }

    let temp_path = path.with_extension(format!(
        "{}.restoring",
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("tmp")
    ));
    fs::write(&temp_path, bytes).map_err(|error| {
        format!(
            "Failed to write temporary local file {}: {error}",
            temp_path.display()
        )
    })?;

    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Failed to replace local file {}: {error}", path.display()))?;
    }

    fs::rename(&temp_path, path).map_err(|error| {
        format!(
            "Failed to promote local file {} -> {}: {error}",
            temp_path.display(),
            path.display()
        )
    })
}

async fn download_remote_object_bytes(
    webdav: &WebdavClient,
    object: &BackupObject,
) -> Result<Vec<u8>, String> {
    let bytes = webdav.get_bytes(&object.remote_path).await?;
    let digest = digest_bytes(&bytes);

    if object.byte_size > 0 && object.byte_size != digest.byte_size {
        return Err(format!(
            "WebDAV restore object size mismatch {}: manifest={} local={}",
            object.remote_path, object.byte_size, digest.byte_size
        ));
    }

    if !object.checksum.trim().is_empty() && object.checksum != digest.checksum {
        return Err(format!(
            "WebDAV restore object checksum mismatch {}: manifest={} local={}",
            object.remote_path, object.checksum, digest.checksum
        ));
    }

    Ok(bytes)
}

fn backup_connection_to_path(connection: &Connection, destination: &Path) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create SQLite backup staging dir {}: {error}",
                parent.display()
            )
        })?;
    }

    if destination.exists() {
        fs::remove_file(destination).map_err(|error| {
            format!(
                "Failed to clean old SQLite backup staging file {}: {error}",
                destination.display()
            )
        })?;
    }

    connection
        .backup(DatabaseName::Main, destination, None)
        .map_err(|error| format!("SQLite online backup failed: {error}"))
}

fn create_database_backup(app: &AppHandle, backup_id: &str) -> Result<PathBuf, String> {
    let staging_dir = app_local_data_dir(app)?
        .join("webdav-backup-staging")
        .join(backup_id);
    let database_backup_path = staging_dir.join("paperquay-library.sqlite3");
    let connection = open_library_connection(app)?;

    backup_connection_to_path(&connection, &database_backup_path)?;
    Ok(database_backup_path)
}

fn list_pdf_attachments(connection: &Connection) -> Result<Vec<PdfAttachment>, String> {
    let mut statement = connection
        .prepare(
            "select id, paper_id, stored_path, file_name, file_size, content_hash
             from attachments
             where kind = 'pdf' and missing = 0
             order by created_at asc",
        )
        .map_err(|error| format!("Failed to prepare PDF attachment query: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(PdfAttachment {
                id: row.get(0)?,
                paper_id: row.get(1)?,
                stored_path: row.get(2)?,
                file_name: row.get(3)?,
                file_size: row.get(4)?,
                content_hash: row.get(5)?,
            })
        })
        .map_err(|error| format!("Failed to query PDF attachments: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read PDF attachments: {error}"))
}

fn pdf_remote_path(attachment: &PdfAttachment, digest: Option<&FileDigest>) -> String {
    let hash = attachment
        .content_hash
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| sanitize_remote_segment(value, "pdf"))
        .or_else(|| {
            digest.map(|value| {
                sanitize_remote_segment(value.checksum.trim_start_matches("sha256:"), "pdf")
            })
        })
        .unwrap_or_else(|| sanitize_remote_segment(&attachment.id, "pdf"));

    format!("latest/papers/{hash}.pdf")
}

fn resolve_executable_dir() -> Result<PathBuf, String> {
    let executable_path = std::env::current_exe()
        .map_err(|error| format!("Failed to resolve current executable: {error}"))?;

    executable_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Failed to resolve executable directory".to_string())
}

fn default_mineru_cache_dir() -> Result<PathBuf, String> {
    Ok(resolve_executable_dir()?.join(".mineru-cache"))
}

fn read_configured_mineru_cache_dir() -> Result<PathBuf, String> {
    let executable_dir = resolve_executable_dir()?;
    let config_path = executable_dir
        .join(".settings")
        .join("paperquay.config.json");

    if !config_path.exists() {
        return default_mineru_cache_dir();
    }

    let text = fs::read_to_string(&config_path).map_err(|error| {
        format!(
            "Failed to read reader config {}: {error}",
            config_path.display()
        )
    })?;
    let value = serde_json::from_str::<Value>(&text).map_err(|error| {
        format!(
            "Failed to parse reader config {}: {error}",
            config_path.display()
        )
    })?;

    let configured = value
        .get("settings")
        .and_then(|settings| settings.get("mineruCacheDir"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());

    Ok(configured
        .map(PathBuf::from)
        .unwrap_or(default_mineru_cache_dir()?))
}

fn classify_derived_cache_file(
    document_key: &str,
    relative_path: &Path,
) -> Option<(BackupObjectKind, String)> {
    let file_name = relative_path.file_name()?.to_str()?;

    if ALLOWED_MINERU_FILES.contains(&file_name) && relative_path.components().count() == 1 {
        return Some((
            BackupObjectKind::Mineru,
            format!("latest/derived/mineru/{document_key}/{file_name}"),
        ));
    }

    let parent = relative_path.parent()?.file_name()?.to_str()?;
    if parent == "translations" && file_name.ends_with(".json") {
        return Some((
            BackupObjectKind::Translation,
            format!(
                "latest/derived/translations/{document_key}/{}",
                sanitize_json_file_name(file_name, "translation")
            ),
        ));
    }

    if parent == "summaries" && file_name.ends_with(".json") {
        return Some((
            BackupObjectKind::Summary,
            format!(
                "latest/derived/summaries/{document_key}/{}",
                sanitize_json_file_name(file_name, "summary")
            ),
        ));
    }

    None
}

fn collect_derived_cache_files(
    cache_root: &Path,
    objects: &mut Vec<BackupObject>,
) -> Result<Vec<LocalBackupFile>, String> {
    if !cache_root.exists() {
        objects.push(BackupObject {
            kind: BackupObjectKind::Mineru,
            remote_path: DERIVED_ROOT_SKIP_REMOTE_PATH.to_string(),
            byte_size: 0,
            checksum: String::new(),
            status: BackupObjectStatus::Skipped,
            uploaded: false,
            source: "mineru-cache-root".to_string(),
            message: Some(format!(
                "MinerU cache root does not exist: {}",
                cache_root.display()
            )),
        });
        return Ok(Vec::new());
    }

    if !cache_root.is_dir() {
        objects.push(BackupObject {
            kind: BackupObjectKind::Mineru,
            remote_path: DERIVED_ROOT_SKIP_REMOTE_PATH.to_string(),
            byte_size: 0,
            checksum: String::new(),
            status: BackupObjectStatus::Skipped,
            uploaded: false,
            source: "mineru-cache-root".to_string(),
            message: Some(format!(
                "MinerU cache root is not a directory: {}",
                cache_root.display()
            )),
        });
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    let entries = fs::read_dir(cache_root).map_err(|error| {
        format!(
            "Failed to read MinerU cache root {}: {error}",
            cache_root.display()
        )
    })?;

    for entry in entries.filter_map(Result::ok) {
        let document_dir = entry.path();

        if !document_dir.is_dir() {
            continue;
        }

        let raw_document_key = document_dir
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("document");
        let document_key = sanitize_remote_segment(raw_document_key, "document");

        for file_name in ALLOWED_MINERU_FILES {
            let local_path = document_dir.join(file_name);
            let remote_path = format!("latest/derived/mineru/{document_key}/{file_name}");

            if local_path.is_file() {
                files.push(LocalBackupFile {
                    kind: BackupObjectKind::Mineru,
                    path: local_path,
                    remote_path,
                    source: format!("mineru:{document_key}"),
                });
            } else {
                objects.push(BackupObject {
                    kind: BackupObjectKind::Mineru,
                    remote_path,
                    byte_size: 0,
                    checksum: String::new(),
                    status: BackupObjectStatus::Skipped,
                    uploaded: false,
                    source: format!("mineru:{document_key}"),
                    message: Some("optional MinerU cache file is missing".to_string()),
                });
            }
        }

        for subdir_name in ["translations", "summaries"] {
            let subdir = document_dir.join(subdir_name);

            if !subdir.is_dir() {
                continue;
            }

            let sub_entries = fs::read_dir(&subdir).map_err(|error| {
                format!("Failed to read cache subdir {}: {error}", subdir.display())
            })?;

            for sub_entry in sub_entries.filter_map(Result::ok) {
                let path = sub_entry.path();

                if !path.is_file() {
                    continue;
                }

                let relative_path = path.strip_prefix(&document_dir).map_err(|error| {
                    format!(
                        "Failed to compute derived cache relative path {}: {error}",
                        path.display()
                    )
                })?;

                if let Some((kind, remote_path)) =
                    classify_derived_cache_file(&document_key, relative_path)
                {
                    files.push(LocalBackupFile {
                        kind,
                        path,
                        remote_path,
                        source: format!("{:?}:{document_key}", kind),
                    });
                }
            }
        }
    }

    Ok(files)
}

fn build_summary(objects: &[BackupObject]) -> BackupSummary {
    BackupSummary {
        uploaded_count: objects
            .iter()
            .filter(|object| object.status == BackupObjectStatus::Uploaded)
            .count(),
        skipped_count: objects
            .iter()
            .filter(|object| object.status == BackupObjectStatus::Skipped)
            .count(),
        failed_count: objects
            .iter()
            .filter(|object| object.status == BackupObjectStatus::Failed)
            .count(),
        database_count: objects
            .iter()
            .filter(|object| object.kind == BackupObjectKind::Database)
            .count(),
        pdf_count: objects
            .iter()
            .filter(|object| object.kind == BackupObjectKind::Pdf)
            .count(),
        derived_count: objects
            .iter()
            .filter(|object| {
                matches!(
                    object.kind,
                    BackupObjectKind::Mineru
                        | BackupObjectKind::Translation
                        | BackupObjectKind::Summary
                )
            })
            .count(),
    }
}

fn build_manifest(
    backup_id: &str,
    created_at: &str,
    objects: Vec<BackupObject>,
) -> WebdavBackupManifest {
    let summary = build_summary(&objects);

    WebdavBackupManifest {
        version: 1,
        backup_id: backup_id.to_string(),
        created_at: created_at.to_string(),
        app: BackupManifestApp {
            name: "PaperQuay".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        },
        objects,
        summary,
    }
}

fn previous_manifest_index(
    manifest: Option<WebdavBackupManifest>,
) -> HashMap<String, PreviousObject> {
    manifest
        .map(|manifest| {
            manifest
                .objects
                .into_iter()
                .map(|object| {
                    let present = object.uploaded
                        || (object.status == BackupObjectStatus::Skipped
                            && !object.checksum.is_empty());

                    (
                        object.remote_path,
                        PreviousObject {
                            byte_size: object.byte_size,
                            checksum: object.checksum,
                            uploaded: present,
                        },
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

fn can_skip_from_previous(
    previous: &HashMap<String, PreviousObject>,
    remote_path: &str,
    digest: &FileDigest,
) -> bool {
    previous
        .get(remote_path)
        .map(|object| {
            object.uploaded
                && object.byte_size == digest.byte_size
                && object.checksum == digest.checksum
        })
        .unwrap_or(false)
}

async fn upload_local_file_object(
    webdav: &WebdavClient,
    backup_id: &str,
    previous: &HashMap<String, PreviousObject>,
    local_file: LocalBackupFile,
    allow_previous_skip: bool,
) -> Result<BackupObject, String> {
    let digest = digest_file(&local_file.path)?;

    if allow_previous_skip && can_skip_from_previous(previous, &local_file.remote_path, &digest) {
        return Ok(BackupObject {
            kind: local_file.kind,
            remote_path: local_file.remote_path,
            byte_size: digest.byte_size,
            checksum: digest.checksum,
            status: BackupObjectStatus::Skipped,
            uploaded: false,
            source: local_file.source,
            message: Some("unchanged object already present in latest manifest".to_string()),
        });
    }

    webdav
        .atomic_upload_file(&local_file.remote_path, backup_id, &local_file.path)
        .await?;

    Ok(BackupObject {
        kind: local_file.kind,
        remote_path: local_file.remote_path,
        byte_size: digest.byte_size,
        checksum: digest.checksum,
        status: BackupObjectStatus::Uploaded,
        uploaded: true,
        source: local_file.source,
        message: None,
    })
}

async fn load_previous_manifest(
    webdav: &WebdavClient,
) -> Result<Option<WebdavBackupManifest>, String> {
    if let Some(text) = webdav
        .get_text_if_exists(LATEST_MANIFEST_REMOTE_PATH)
        .await?
    {
        match serde_json::from_str::<WebdavBackupManifest>(&text) {
            Ok(manifest) => return Ok(Some(manifest)),
            Err(error) => {
                eprintln!("failed to parse previous WebDAV backup manifest: {error}");
            }
        }
    }

    Ok(load_manifest_from_runs(webdav)
        .await?
        .map(|resolved| resolved.manifest))
}

fn resolved_latest_message(notice: Option<&str>, base_message: String) -> String {
    match notice {
        Some(notice) => format!("{notice} {base_message}"),
        None => base_message,
    }
}

async fn load_manifest_from_runs(
    webdav: &WebdavClient,
) -> Result<Option<ResolvedLatestManifest>, String> {
    let mut run_directories = webdav
        .list_collection("runs")
        .await?
        .into_iter()
        .filter(|entry| entry.is_collection)
        .collect::<Vec<_>>();
    run_directories.sort_by(|left, right| right.remote_path.cmp(&left.remote_path));

    for run_directory in run_directories {
        let manifest_remote_path = format!("{}/manifest.json", run_directory.remote_path);
        let Some(text) = webdav.get_text_if_exists(&manifest_remote_path).await? else {
            continue;
        };
        let manifest = serde_json::from_str::<WebdavBackupManifest>(&text).map_err(|error| {
            format!("Failed to parse WebDAV run manifest {manifest_remote_path}: {error}")
        })?;
        return Ok(Some(ResolvedLatestManifest {
            manifest,
            manifest_remote_path: manifest_remote_path.clone(),
            notice: Some(format!(
                "latest/manifest.json is missing, so WebDAV restore is using {manifest_remote_path}."
            )),
        }));
    }

    Ok(None)
}

fn recover_pdf_objects_from_listing(
    paper_entries: &[WebdavCollectionEntry],
    remote_attachments: &[RemoteAttachment],
) -> Vec<BackupObject> {
    let papers_by_path = paper_entries
        .iter()
        .filter(|entry| !entry.is_collection)
        .map(|entry| (entry.remote_path.clone(), entry))
        .collect::<HashMap<_, _>>();
    let mut remaining_by_size = paper_entries
        .iter()
        .filter(|entry| !entry.is_collection && entry.byte_size > 0)
        .fold(
            HashMap::<u64, Vec<&WebdavCollectionEntry>>::new(),
            |mut acc, entry| {
                acc.entry(entry.byte_size).or_default().push(entry);
                acc
            },
        );
    let mut assigned_paths = HashSet::new();
    let mut objects = Vec::new();

    for attachment in remote_attachments
        .iter()
        .filter(|attachment| attachment.kind == "pdf" && !attachment.missing)
    {
        let candidate_remote_path = recovered_pdf_remote_path(attachment);
        let matched_entry = papers_by_path
            .get(&candidate_remote_path)
            .copied()
            .or_else(|| {
                let size = u64::try_from(attachment.file_size).ok()?;
                let candidates = remaining_by_size.get_mut(&size)?;
                if candidates.len() != 1 {
                    return None;
                }
                candidates.pop()
            });
        let Some(entry) = matched_entry else {
            continue;
        };

        if !assigned_paths.insert(entry.remote_path.clone()) {
            continue;
        }

        objects.push(BackupObject {
            kind: BackupObjectKind::Pdf,
            remote_path: entry.remote_path.clone(),
            byte_size: entry.byte_size,
            checksum: String::new(),
            status: BackupObjectStatus::Uploaded,
            uploaded: true,
            source: format!(
                "attachment:{};paper:{};file:{};dbSize:{}",
                attachment.id, attachment.paper_id, attachment.file_name, attachment.file_size
            ),
            message: None,
        });
    }

    objects
}

fn recover_derived_objects_from_listing(entries: &[WebdavCollectionEntry]) -> Vec<BackupObject> {
    entries
        .iter()
        .filter(|entry| !entry.is_collection)
        .filter_map(|entry| {
            classify_listed_derived_object(entry).map(|kind| BackupObject {
                kind,
                remote_path: entry.remote_path.clone(),
                byte_size: entry.byte_size,
                checksum: String::new(),
                status: BackupObjectStatus::Uploaded,
                uploaded: true,
                source: "remote-scan".to_string(),
                message: None,
            })
        })
        .collect()
}

async fn reconstruct_latest_manifest(
    app: &AppHandle,
    webdav: &WebdavClient,
) -> Result<Option<ResolvedLatestManifest>, String> {
    let database_entry = webdav
        .list_collection("latest/database")
        .await?
        .into_iter()
        .find(|entry| !entry.is_collection && entry.remote_path == DATABASE_REMOTE_PATH);
    let Some(database_entry) = database_entry else {
        return Ok(None);
    };

    let backup_id = database_entry
        .last_modified
        .as_deref()
        .and_then(http_date_to_backup_id)
        .unwrap_or_else(|| format!("recovered-{}", current_unix_millis()));
    let created_at = database_entry
        .last_modified
        .as_deref()
        .and_then(http_date_to_rfc3339)
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let database_object = BackupObject {
        kind: BackupObjectKind::Database,
        remote_path: database_entry.remote_path.clone(),
        byte_size: database_entry.byte_size,
        checksum: String::new(),
        status: BackupObjectStatus::Uploaded,
        uploaded: true,
        source: "remote-scan".to_string(),
        message: None,
    };
    let database_path = download_remote_database_to_staging(
        app,
        webdav,
        &database_object,
        &format!("{backup_id}-recover-index"),
    )
    .await?;
    let remote_connection = Connection::open(&database_path).map_err(|error| {
        format!(
            "Failed to open staged remote database {}: {error}",
            database_path.display()
        )
    })?;
    let remote_attachments = list_remote_attachments(&remote_connection)?;
    drop(remote_connection);

    let mut objects = vec![database_object];
    let paper_entries = webdav.list_collection("latest/papers").await?;
    objects.extend(recover_pdf_objects_from_listing(
        &paper_entries,
        &remote_attachments,
    ));
    let derived_entries = webdav.list_files_recursively("latest/derived").await?;
    objects.extend(recover_derived_objects_from_listing(&derived_entries));

    let _ = fs::remove_dir_all(
        app_local_data_dir(app)?
            .join("webdav-restore-staging")
            .join(format!("{backup_id}-recover-index")),
    );

    if objects.len() == 1 {
        return Ok(None);
    }

    Ok(Some(ResolvedLatestManifest {
        manifest: build_manifest(&backup_id, &created_at, objects),
        manifest_remote_path: LATEST_MANIFEST_REMOTE_PATH.to_string(),
        notice: Some(
            "latest/manifest.json is missing, so WebDAV restore is using a reconstructed index from latest/database and the remote object listing."
                .to_string(),
        ),
    }))
}

async fn resolve_latest_manifest(
    app: &AppHandle,
    webdav: &WebdavClient,
) -> Result<Option<ResolvedLatestManifest>, String> {
    let Some(text) = webdav
        .get_text_if_exists(LATEST_MANIFEST_REMOTE_PATH)
        .await?
    else {
        if let Some(manifest) = load_manifest_from_runs(webdav).await? {
            return Ok(Some(manifest));
        }
        return reconstruct_latest_manifest(app, webdav).await;
    };

    serde_json::from_str::<WebdavBackupManifest>(&text)
        .map(|manifest| {
            Some(ResolvedLatestManifest {
                manifest,
                manifest_remote_path: LATEST_MANIFEST_REMOTE_PATH.to_string(),
                notice: None,
            })
        })
        .map_err(|error| format!("Failed to parse latest WebDAV manifest: {error}"))
}

fn find_database_object(manifest: &WebdavBackupManifest) -> Option<&BackupObject> {
    manifest.objects.iter().find(|object| {
        object.kind == BackupObjectKind::Database && object.remote_path == DATABASE_REMOTE_PATH
    })
}

async fn download_remote_database_to_staging(
    app: &AppHandle,
    webdav: &WebdavClient,
    database_object: &BackupObject,
    staging_name: &str,
) -> Result<PathBuf, String> {
    let bytes = download_remote_object_bytes(webdav, database_object).await?;
    let staging_dir = app_local_data_dir(app)?
        .join("webdav-restore-staging")
        .join(staging_name);
    let database_path = staging_dir.join("remote-library.sqlite3");

    write_bytes_atomically(&database_path, &bytes)?;
    Ok(database_path)
}

async fn download_latest_database_backup(
    app: &AppHandle,
    webdav: &WebdavClient,
    manifest: &WebdavBackupManifest,
) -> Result<PathBuf, String> {
    let database_object = find_database_object(manifest)
        .ok_or_else(|| "Latest manifest does not contain the database object".to_string())?;
    let staging_name = if manifest.backup_id.trim().is_empty() {
        "latest".to_string()
    } else {
        manifest.backup_id.trim().to_string()
    };
    download_remote_database_to_staging(app, webdav, database_object, &staging_name).await
}

fn restore_target_for_remote_path(cache_root: &Path, remote_path: &str) -> Result<PathBuf, String> {
    let parts = split_remote_path(remote_path);

    if parts.len() < 5 || parts[0] != "latest" || parts[1] != "derived" {
        return Err(format!("Unsupported derived remote path: {remote_path}"));
    }

    let document_key = parts[3];
    let relative = match parts[2] {
        "mineru" => {
            let mut relative = PathBuf::from(document_key);
            for segment in &parts[4..] {
                relative.push(segment);
            }
            relative
        }
        "translations" => {
            let mut relative = PathBuf::from(document_key);
            relative.push("translations");
            for segment in &parts[4..] {
                relative.push(segment);
            }
            relative
        }
        "summaries" => {
            let mut relative = PathBuf::from(document_key);
            relative.push("summaries");
            for segment in &parts[4..] {
                relative.push(segment);
            }
            relative
        }
        _ => return Err(format!("Unsupported derived remote path: {remote_path}")),
    };

    safe_join_local_path(cache_root, &relative)
}

fn parse_attachment_id_from_source(source: &str) -> Option<String> {
    source
        .split(';')
        .map(str::trim)
        .find_map(|part| part.strip_prefix("attachment:").map(str::to_string))
}

fn local_file_matches_manifest(path: &Path, object: &BackupObject) -> Result<bool, String> {
    if !path.is_file() {
        return Ok(false);
    }

    let digest = digest_file(path)?;

    Ok(
        (object.byte_size == 0 || object.byte_size == digest.byte_size)
            && (object.checksum.trim().is_empty() || object.checksum == digest.checksum),
    )
}

fn list_local_attachment_records(
    connection: &Connection,
) -> Result<HashMap<String, LocalAttachmentRecord>, String> {
    let mut statement = connection
        .prepare("select id, stored_path, relative_path, missing from attachments")
        .map_err(|error| format!("Failed to prepare local attachment query: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                LocalAttachmentRecord {
                    stored_path: row.get(1)?,
                    relative_path: row.get(2)?,
                    missing: row.get::<_, i64>(3)? != 0,
                },
            ))
        })
        .map_err(|error| format!("Failed to query local attachments: {error}"))?;

    rows.collect::<Result<HashMap<_, _>, _>>()
        .map_err(|error| format!("Failed to read local attachments: {error}"))
}

fn list_remote_attachments(connection: &Connection) -> Result<Vec<RemoteAttachment>, String> {
    let mut statement = connection
        .prepare(
            "select id, paper_id, kind, original_path, relative_path, file_name, mime_type,
                    file_size, content_hash, created_at, missing
             from attachments
             where kind = 'pdf'",
        )
        .map_err(|error| format!("Failed to prepare remote attachment query: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(RemoteAttachment {
                id: row.get(0)?,
                paper_id: row.get(1)?,
                kind: row.get(2)?,
                original_path: row.get(3)?,
                relative_path: row.get(4)?,
                file_name: row.get(5)?,
                mime_type: row.get(6)?,
                file_size: row.get(7)?,
                content_hash: row.get(8)?,
                created_at: row.get(9)?,
                missing: row.get::<_, i64>(10)? != 0,
            })
        })
        .map_err(|error| format!("Failed to query remote attachments: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read remote attachments: {error}"))
}

fn map_remote_pdf_target_path(
    storage_dir: &Path,
    remote_attachment: &RemoteAttachment,
    local_record: Option<&LocalAttachmentRecord>,
) -> Result<PathBuf, String> {
    if let Some(local_record) = local_record {
        return Ok(PathBuf::from(&local_record.stored_path));
    }

    if let Some(relative_path) = remote_attachment
        .relative_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if let Ok(path) = safe_join_local_path(storage_dir, Path::new(relative_path)) {
            return Ok(path);
        }
    }

    Ok(storage_dir.join(sanitize_local_file_name(&remote_attachment.file_name)))
}

fn storage_dir_for_restore(app: &AppHandle) -> Result<PathBuf, String> {
    let settings = library_get_settings(app.clone())?;
    if settings.storage_dir.trim().is_empty() {
        Ok(app_local_data_dir(app)?.join("Papers"))
    } else {
        Ok(PathBuf::from(settings.storage_dir))
    }
}

fn table_exists_in_schema(
    connection: &Connection,
    schema: &str,
    table_name: &str,
) -> Result<bool, String> {
    let query = format!(
        "select exists(select 1 from {schema}.sqlite_master where type = 'table' and name = ?1)"
    );
    connection
        .query_row(&query, params![table_name], |row| row.get::<_, i64>(0))
        .map(|value| value != 0)
        .map_err(|error| format!("Failed to inspect table {schema}.{table_name}: {error}"))
}

fn with_attached_remote_db<T, F>(
    connection: &Connection,
    remote_db_path: &Path,
    action: F,
) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, String>,
{
    connection
        .execute(
            &format!("attach database ?1 as {REMOTE_SCHEMA}"),
            params![path_to_string_lossy(remote_db_path)],
        )
        .map_err(|error| {
            format!(
                "Failed to attach remote restore database {}: {error}",
                remote_db_path.display()
            )
        })?;

    let result = action(connection);
    let detach_result = connection
        .execute(&format!("detach database {REMOTE_SCHEMA}"), [])
        .map_err(|error| format!("Failed to detach remote restore database: {error}"));

    match (result, detach_result) {
        (Ok(value), Ok(_)) => Ok(value),
        (Err(error), Ok(_)) => Err(error),
        (Ok(_), Err(detach_error)) => Err(detach_error),
        (Err(error), Err(_)) => Err(error),
    }
}

fn with_foreign_keys_disabled<T, F>(connection: &Connection, action: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, String>,
{
    connection
        .execute_batch("pragma foreign_keys = off;")
        .map_err(|error| format!("Failed to disable foreign keys for restore merge: {error}"))?;
    let result = action(connection);
    let reenable_result = connection
        .execute_batch("pragma foreign_keys = on;")
        .map_err(|error| format!("Failed to re-enable foreign keys after restore merge: {error}"));

    match (result, reenable_result) {
        (Ok(value), Ok(_)) => Ok(value),
        (Err(error), Ok(_)) => Err(error),
        (Ok(_), Err(reenable_error)) => Err(reenable_error),
        (Err(error), Err(_)) => Err(error),
    }
}

fn merge_simple_table_if_exists(
    connection: &Connection,
    table: &str,
    columns: &str,
) -> Result<RestoreTableStat, String> {
    if !table_exists_in_schema(connection, REMOTE_SCHEMA, table)? {
        return Ok(RestoreTableStat {
            table: table.to_string(),
            inserted_count: 0,
            updated_count: 0,
        });
    }

    let sql = format!(
        "insert or ignore into {table} ({columns}) select {columns} from {REMOTE_SCHEMA}.{table}"
    );
    let inserted_count = connection
        .execute(&sql, [])
        .map_err(|error| format!("Failed to merge table {table}: {error}"))?;

    Ok(RestoreTableStat {
        table: table.to_string(),
        inserted_count,
        updated_count: 0,
    })
}

fn merge_attachments_from_attached(
    connection: &Connection,
    storage_dir: &Path,
    attachment_plans: &HashMap<String, AttachmentRestorePlan>,
) -> Result<RestoreTableStat, String> {
    if !table_exists_in_schema(connection, REMOTE_SCHEMA, "attachments")? {
        return Ok(RestoreTableStat {
            table: "attachments".to_string(),
            inserted_count: 0,
            updated_count: 0,
        });
    }

    let local_records = list_local_attachment_records(connection)?;
    let mut statement = connection
        .prepare(&format!(
            "select id, paper_id, kind, original_path, relative_path, file_name, mime_type,
                        file_size, content_hash, created_at, missing
                 from {REMOTE_SCHEMA}.attachments
                 where kind = 'pdf'"
        ))
        .map_err(|error| format!("Failed to prepare attached attachment query: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(RemoteAttachment {
                id: row.get(0)?,
                paper_id: row.get(1)?,
                kind: row.get(2)?,
                original_path: row.get(3)?,
                relative_path: row.get(4)?,
                file_name: row.get(5)?,
                mime_type: row.get(6)?,
                file_size: row.get(7)?,
                content_hash: row.get(8)?,
                created_at: row.get(9)?,
                missing: row.get::<_, i64>(10)? != 0,
            })
        })
        .map_err(|error| format!("Failed to query attached attachments: {error}"))?;
    let remote_attachments = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read attached attachments: {error}"))?;

    drop(statement);

    let mut inserted_count = 0usize;
    let mut updated_count = 0usize;

    for remote_attachment in remote_attachments {
        let local_record = local_records.get(&remote_attachment.id);
        let plan = if let Some(plan) = attachment_plans.get(&remote_attachment.id) {
            plan.clone()
        } else if let Some(local_record) = local_record {
            AttachmentRestorePlan {
                stored_path: local_record.stored_path.clone(),
                relative_path: local_record.relative_path.clone(),
                available: Path::new(&local_record.stored_path).is_file(),
            }
        } else {
            let target_path = map_remote_pdf_target_path(storage_dir, &remote_attachment, None)?;
            AttachmentRestorePlan {
                relative_path: relative_path_under(storage_dir, &target_path),
                stored_path: path_to_string_lossy(&target_path),
                available: false,
            }
        };

        let missing_flag = if plan.available || remote_attachment.missing {
            0
        } else {
            1
        };

        if let Some(local_record) = local_record {
            let local_available = Path::new(&local_record.stored_path).is_file();
            if (!local_available || local_record.missing) && plan.available {
                updated_count += connection
                    .execute(
                        "update attachments
                         set stored_path = ?1,
                             relative_path = ?2,
                             file_name = ?3,
                             mime_type = ?4,
                             file_size = ?5,
                             content_hash = ?6,
                             missing = 0
                         where id = ?7",
                        params![
                            plan.stored_path,
                            plan.relative_path,
                            remote_attachment.file_name,
                            remote_attachment.mime_type,
                            remote_attachment.file_size,
                            remote_attachment.content_hash,
                            remote_attachment.id
                        ],
                    )
                    .map_err(|error| {
                        format!(
                            "Failed to repair local attachment {} from restore metadata: {error}",
                            remote_attachment.id
                        )
                    })?;
            }
            continue;
        }

        inserted_count += connection
            .execute(
                "insert or ignore into attachments
                   (id, paper_id, kind, original_path, stored_path, relative_path, file_name,
                    mime_type, file_size, content_hash, created_at, missing)
                 values
                   (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    remote_attachment.id,
                    remote_attachment.paper_id,
                    remote_attachment.kind,
                    remote_attachment.original_path,
                    plan.stored_path,
                    plan.relative_path,
                    remote_attachment.file_name,
                    remote_attachment.mime_type,
                    remote_attachment.file_size,
                    remote_attachment.content_hash,
                    remote_attachment.created_at,
                    missing_flag
                ],
            )
            .map_err(|error| format!("Failed to merge attachment metadata: {error}"))?;
    }

    Ok(RestoreTableStat {
        table: "attachments".to_string(),
        inserted_count,
        updated_count,
    })
}

fn merge_rag_tables_from_attached(
    connection: &Connection,
) -> Result<Vec<RestoreTableStat>, String> {
    let mut stats = Vec::new();

    if !table_exists_in_schema(connection, REMOTE_SCHEMA, "rag_documents")? {
        return Ok(stats);
    }

    stats.push(merge_simple_table_if_exists(
        connection,
        "rag_documents",
        "document_key, title, source_type, source_signature, embedding_model_key, embedding_dimension, total_chunk_count, updated_at, status, last_error, failed_at, retry_after_ms",
    )?);

    if !table_exists_in_schema(connection, REMOTE_SCHEMA, "rag_chunks")? {
        return Ok(stats);
    }

    stats.push(merge_simple_table_if_exists(
        connection,
        "rag_chunks",
        "document_key, title, source_type, source_signature, embedding_dimension, chunk_id, chunk_index, page_index, block_id, text, updated_at",
    )?);

    let mut dimension_statement = connection
        .prepare(&format!(
            "select distinct embedding_dimension
             from {REMOTE_SCHEMA}.rag_documents
             where embedding_dimension > 0
             order by embedding_dimension asc"
        ))
        .map_err(|error| format!("Failed to prepare remote RAG dimension query: {error}"))?;
    let dimensions = dimension_statement
        .query_map([], |row| row.get::<_, i64>(0))
        .map_err(|error| format!("Failed to query remote RAG dimensions: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read remote RAG dimensions: {error}"))?;
    drop(dimension_statement);

    for dimension in dimensions {
        ensure_rag_vector_table(connection, dimension)?;
        let vector_table_name = rag_vector_table_name(dimension)?;

        if !table_exists_in_schema(connection, REMOTE_SCHEMA, &vector_table_name)? {
            continue;
        }

        let sql = format!(
            "insert into {vector_table_name} (chunk_row_id, embedding, document_key, source_type)
             select local_chunks.id, remote_vec.embedding, remote_vec.document_key, remote_vec.source_type
             from {REMOTE_SCHEMA}.{vector_table_name} as remote_vec
             join {REMOTE_SCHEMA}.rag_chunks as remote_chunks
               on remote_chunks.id = remote_vec.chunk_row_id
             join rag_chunks as local_chunks
               on local_chunks.document_key = remote_chunks.document_key
              and local_chunks.source_type = remote_chunks.source_type
              and local_chunks.chunk_id = remote_chunks.chunk_id
             where not exists (
               select 1
               from {vector_table_name} as existing_vec
               where existing_vec.chunk_row_id = local_chunks.id
             )"
        );
        let inserted_count = connection.execute(&sql, []).map_err(|error| {
            format!("Failed to merge RAG vector table {vector_table_name}: {error}")
        })?;

        stats.push(RestoreTableStat {
            table: vector_table_name,
            inserted_count,
            updated_count: 0,
        });
    }

    Ok(stats)
}

fn merge_database_from_remote(
    local_connection: &Connection,
    remote_db_path: &Path,
    storage_dir: &Path,
    attachment_plans: &HashMap<String, AttachmentRestorePlan>,
) -> Result<Vec<RestoreTableStat>, String> {
    with_foreign_keys_disabled(local_connection, |connection| {
        with_attached_remote_db(connection, remote_db_path, |connection| {
            let mut stats = Vec::new();

            stats.push(merge_simple_table_if_exists(
                connection,
                "authors",
                "id, name, given_name, family_name, created_at",
            )?);
            stats.push(merge_simple_table_if_exists(
                connection,
                "papers",
                "id, title, year, publication, doi, url, abstract_text, keywords, imported_at, updated_at, last_read_at, reading_progress, is_favorite, user_note, ai_summary, citation, source, sort_order",
            )?);
            stats.push(merge_simple_table_if_exists(
                connection,
                "categories",
                "id, name, parent_id, sort_order, is_system, system_key, created_at, updated_at",
            )?);
            stats.push(merge_simple_table_if_exists(
                connection,
                "tags",
                "id, name, color, created_at",
            )?);
            stats.push(merge_simple_table_if_exists(
                connection,
                "paper_authors",
                "paper_id, author_id, sort_order",
            )?);
            stats.push(merge_simple_table_if_exists(
                connection,
                "paper_categories",
                "paper_id, category_id, created_at",
            )?);
            stats.push(merge_simple_table_if_exists(
                connection,
                "paper_tags",
                "paper_id, tag_id, created_at",
            )?);
            stats.push(merge_attachments_from_attached(
                connection,
                storage_dir,
                attachment_plans,
            )?);
            stats.push(merge_simple_table_if_exists(
                connection,
                "notes",
                "id, paper_id, title, content, content_format, created_at, updated_at",
            )?);
            stats.push(merge_simple_table_if_exists(
                connection,
                "annotations",
                "id, paper_id, attachment_id, page_index, bbox_json, kind, color, quote, note, created_at, updated_at",
            )?);
            stats.push(merge_simple_table_if_exists(
                connection,
                "import_records",
                "id, source, source_path, target_path, paper_id, status, message, imported_at",
            )?);
            stats.extend(merge_rag_tables_from_attached(connection)?);

            Ok(stats
                .into_iter()
                .filter(|stat| stat.inserted_count > 0 || stat.updated_count > 0)
                .collect())
        })
    })
}

async fn restore_pdf_objects(
    webdav: &WebdavClient,
    manifest: &WebdavBackupManifest,
    remote_attachments: &HashMap<String, RemoteAttachment>,
    local_records: &HashMap<String, LocalAttachmentRecord>,
    storage_dir: &Path,
) -> Result<(Vec<RestoreObject>, HashMap<String, AttachmentRestorePlan>), String> {
    let mut objects = Vec::new();
    let mut plans = HashMap::new();

    for object in manifest.objects.iter().filter(|object| {
        object.kind == BackupObjectKind::Pdf && manifest_object_is_restorable(object)
    }) {
        let Some(attachment_id) = parse_attachment_id_from_source(&object.source) else {
            objects.push(RestoreObject {
                kind: BackupObjectKind::Pdf,
                remote_path: object.remote_path.clone(),
                local_path: String::new(),
                byte_size: object.byte_size,
                checksum: object.checksum.clone(),
                status: RestoreObjectStatus::Failed,
                message: Some("Missing attachment id in backup manifest source".to_string()),
            });
            continue;
        };

        let Some(remote_attachment) = remote_attachments.get(&attachment_id) else {
            objects.push(RestoreObject {
                kind: BackupObjectKind::Pdf,
                remote_path: object.remote_path.clone(),
                local_path: String::new(),
                byte_size: object.byte_size,
                checksum: object.checksum.clone(),
                status: RestoreObjectStatus::Failed,
                message: Some(format!(
                    "Remote attachment metadata not found for {attachment_id}"
                )),
            });
            continue;
        };

        let local_record = local_records.get(&attachment_id);
        let preferred_target =
            match map_remote_pdf_target_path(storage_dir, remote_attachment, local_record) {
                Ok(path) => path,
                Err(error) => {
                    objects.push(RestoreObject {
                        kind: BackupObjectKind::Pdf,
                        remote_path: object.remote_path.clone(),
                        local_path: String::new(),
                        byte_size: object.byte_size,
                        checksum: object.checksum.clone(),
                        status: RestoreObjectStatus::Failed,
                        message: Some(error),
                    });
                    continue;
                }
            };

        if preferred_target.is_file() {
            let matching_local = local_file_matches_manifest(&preferred_target, object)?;
            let local_path = path_to_string_lossy(&preferred_target);
            let relative_path = relative_path_under(storage_dir, &preferred_target);

            if matching_local {
                plans.insert(
                    attachment_id,
                    AttachmentRestorePlan {
                        stored_path: local_path.clone(),
                        relative_path,
                        available: true,
                    },
                );
                objects.push(RestoreObject {
                    kind: BackupObjectKind::Pdf,
                    remote_path: object.remote_path.clone(),
                    local_path,
                    byte_size: object.byte_size,
                    checksum: object.checksum.clone(),
                    status: RestoreObjectStatus::Skipped,
                    message: Some("Matching local PDF already exists".to_string()),
                });
                continue;
            }

            if local_record.is_some() {
                plans.insert(
                    attachment_id,
                    AttachmentRestorePlan {
                        stored_path: local_path.clone(),
                        relative_path,
                        available: true,
                    },
                );
                objects.push(RestoreObject {
                    kind: BackupObjectKind::Pdf,
                    remote_path: object.remote_path.clone(),
                    local_path,
                    byte_size: object.byte_size,
                    checksum: object.checksum.clone(),
                    status: RestoreObjectStatus::Skipped,
                    message: Some(
                        "Local PDF already exists at the tracked path and differs, so it was kept"
                            .to_string(),
                    ),
                });
                continue;
            }

            let target = unique_local_restore_path(&preferred_target);
            match download_remote_object_bytes(webdav, object).await {
                Ok(bytes) => {
                    if let Err(error) = write_bytes_atomically(&target, &bytes) {
                        objects.push(RestoreObject {
                            kind: BackupObjectKind::Pdf,
                            remote_path: object.remote_path.clone(),
                            local_path: path_to_string_lossy(&target),
                            byte_size: object.byte_size,
                            checksum: object.checksum.clone(),
                            status: RestoreObjectStatus::Failed,
                            message: Some(error),
                        });
                        continue;
                    }

                    let local_path = path_to_string_lossy(&target);
                    let relative_path = relative_path_under(storage_dir, &target);
                    plans.insert(
                        attachment_id,
                        AttachmentRestorePlan {
                            stored_path: local_path.clone(),
                            relative_path,
                            available: true,
                        },
                    );
                    objects.push(RestoreObject {
                        kind: BackupObjectKind::Pdf,
                        remote_path: object.remote_path.clone(),
                        local_path,
                        byte_size: object.byte_size,
                        checksum: object.checksum.clone(),
                        status: RestoreObjectStatus::Downloaded,
                        message: Some("Downloaded PDF to a non-conflicting local path".to_string()),
                    });
                }
                Err(error) => {
                    objects.push(RestoreObject {
                        kind: BackupObjectKind::Pdf,
                        remote_path: object.remote_path.clone(),
                        local_path: path_to_string_lossy(&target),
                        byte_size: object.byte_size,
                        checksum: object.checksum.clone(),
                        status: RestoreObjectStatus::Failed,
                        message: Some(error),
                    });
                }
            }
            continue;
        }

        match download_remote_object_bytes(webdav, object).await {
            Ok(bytes) => {
                if let Err(error) = write_bytes_atomically(&preferred_target, &bytes) {
                    objects.push(RestoreObject {
                        kind: BackupObjectKind::Pdf,
                        remote_path: object.remote_path.clone(),
                        local_path: path_to_string_lossy(&preferred_target),
                        byte_size: object.byte_size,
                        checksum: object.checksum.clone(),
                        status: RestoreObjectStatus::Failed,
                        message: Some(error),
                    });
                    continue;
                }

                let local_path = path_to_string_lossy(&preferred_target);
                let relative_path = relative_path_under(storage_dir, &preferred_target);
                plans.insert(
                    attachment_id,
                    AttachmentRestorePlan {
                        stored_path: local_path.clone(),
                        relative_path,
                        available: true,
                    },
                );
                objects.push(RestoreObject {
                    kind: BackupObjectKind::Pdf,
                    remote_path: object.remote_path.clone(),
                    local_path,
                    byte_size: object.byte_size,
                    checksum: object.checksum.clone(),
                    status: RestoreObjectStatus::Downloaded,
                    message: None,
                });
            }
            Err(error) => {
                objects.push(RestoreObject {
                    kind: BackupObjectKind::Pdf,
                    remote_path: object.remote_path.clone(),
                    local_path: path_to_string_lossy(&preferred_target),
                    byte_size: object.byte_size,
                    checksum: object.checksum.clone(),
                    status: RestoreObjectStatus::Failed,
                    message: Some(error),
                });
            }
        }
    }

    Ok((objects, plans))
}

async fn restore_derived_objects(
    webdav: &WebdavClient,
    manifest: &WebdavBackupManifest,
    cache_root: &Path,
) -> Result<Vec<RestoreObject>, String> {
    let mut objects = Vec::new();

    for object in manifest.objects.iter().filter(|object| {
        matches!(
            object.kind,
            BackupObjectKind::Mineru | BackupObjectKind::Translation | BackupObjectKind::Summary
        ) && manifest_object_is_restorable(object)
    }) {
        let target = match restore_target_for_remote_path(cache_root, &object.remote_path) {
            Ok(path) => path,
            Err(error) => {
                objects.push(RestoreObject {
                    kind: object.kind,
                    remote_path: object.remote_path.clone(),
                    local_path: String::new(),
                    byte_size: object.byte_size,
                    checksum: object.checksum.clone(),
                    status: RestoreObjectStatus::Failed,
                    message: Some(error),
                });
                continue;
            }
        };

        if target.is_file() {
            let local_path = path_to_string_lossy(&target);
            if local_file_matches_manifest(&target, object)? {
                objects.push(RestoreObject {
                    kind: object.kind,
                    remote_path: object.remote_path.clone(),
                    local_path,
                    byte_size: object.byte_size,
                    checksum: object.checksum.clone(),
                    status: RestoreObjectStatus::Skipped,
                    message: Some("Matching local cache file already exists".to_string()),
                });
            } else {
                objects.push(RestoreObject {
                    kind: object.kind,
                    remote_path: object.remote_path.clone(),
                    local_path,
                    byte_size: object.byte_size,
                    checksum: object.checksum.clone(),
                    status: RestoreObjectStatus::Skipped,
                    message: Some(
                        "Local cache file already exists and differs, so it was kept".to_string(),
                    ),
                });
            }
            continue;
        }

        match download_remote_object_bytes(webdav, object).await {
            Ok(bytes) => {
                if let Err(error) = write_bytes_atomically(&target, &bytes) {
                    objects.push(RestoreObject {
                        kind: object.kind,
                        remote_path: object.remote_path.clone(),
                        local_path: path_to_string_lossy(&target),
                        byte_size: object.byte_size,
                        checksum: object.checksum.clone(),
                        status: RestoreObjectStatus::Failed,
                        message: Some(error),
                    });
                    continue;
                }

                objects.push(RestoreObject {
                    kind: object.kind,
                    remote_path: object.remote_path.clone(),
                    local_path: path_to_string_lossy(&target),
                    byte_size: object.byte_size,
                    checksum: object.checksum.clone(),
                    status: RestoreObjectStatus::Downloaded,
                    message: None,
                });
            }
            Err(error) => {
                objects.push(RestoreObject {
                    kind: object.kind,
                    remote_path: object.remote_path.clone(),
                    local_path: path_to_string_lossy(&target),
                    byte_size: object.byte_size,
                    checksum: object.checksum.clone(),
                    status: RestoreObjectStatus::Failed,
                    message: Some(error),
                });
            }
        }
    }

    Ok(objects)
}

#[tauri::command]
pub fn webdav_get_backup_settings(app: AppHandle) -> Result<WebdavBackupSettingsView, String> {
    load_settings(&app).map(settings_view)
}

#[tauri::command]
pub fn webdav_update_backup_settings(
    app: AppHandle,
    settings: WebdavBackupSettingsInput,
) -> Result<WebdavBackupSettingsView, String> {
    let mut next = load_settings(&app).unwrap_or_else(|_| default_settings());
    next.endpoint_url = settings.endpoint_url.trim().to_string();
    next.remote_root = normalize_remote_root(&settings.remote_root)?;
    next.username = settings.username.trim().to_string();
    next.include_pdfs = settings.include_pdfs;
    next.include_derived = settings.include_derived;
    next.updated_at_ms = current_unix_millis();

    if settings.clear_password.unwrap_or(false) {
        next.password.clear();
    }

    if let Some(password) = settings.password {
        next.password = password.trim().to_string();
    }

    if !next.endpoint_url.trim().is_empty() {
        validate_settings(&next)?;
    }

    save_settings(&app, &next)?;
    Ok(settings_view(next))
}

#[tauri::command]
pub async fn webdav_test_connection(app: AppHandle) -> Result<WebdavConnectionTestResult, String> {
    let settings = load_settings(&app)?;
    let endpoint_url = settings.endpoint_url.clone();
    let remote_root = settings.remote_root.clone();

    match WebdavClient::new(&settings) {
        Ok(webdav) => match async {
            webdav.ensure_collection("").await?;
            webdav.ensure_collection("latest").await?;
            webdav.ensure_collection("runs").await?;
            Ok::<(), String>(())
        }
        .await
        {
            Ok(()) => Ok(WebdavConnectionTestResult {
                ok: true,
                endpoint_url,
                remote_root,
                message: "WebDAV connection succeeded and the backup root is writable.".to_string(),
            }),
            Err(error) => Ok(WebdavConnectionTestResult {
                ok: false,
                endpoint_url,
                remote_root,
                message: error,
            }),
        },
        Err(error) => Ok(WebdavConnectionTestResult {
            ok: false,
            endpoint_url,
            remote_root,
            message: error,
        }),
    }
}

#[tauri::command]
pub async fn webdav_backup_now(app: AppHandle) -> Result<WebdavBackupResult, String> {
    let settings = load_settings(&app)?;
    validate_settings(&settings)?;
    let webdav = WebdavClient::new(&settings)?;
    let created_at = Utc::now().to_rfc3339();
    let backup_id = format!(
        "{}-{}",
        Utc::now().format("%Y%m%dT%H%M%SZ"),
        current_unix_millis()
    );
    let mut objects = Vec::new();

    webdav.ensure_collection("").await?;
    webdav.ensure_collection("latest").await?;
    webdav.ensure_collection("runs").await?;

    let previous = previous_manifest_index(load_previous_manifest(&webdav).await?);

    let database_backup_path = create_database_backup(&app, &backup_id)?;
    let database_object = upload_local_file_object(
        &webdav,
        &backup_id,
        &previous,
        LocalBackupFile {
            kind: BackupObjectKind::Database,
            path: database_backup_path.clone(),
            remote_path: DATABASE_REMOTE_PATH.to_string(),
            source: "sqlite-backup-api".to_string(),
        },
        false,
    )
    .await?;
    objects.push(database_object);

    let connection = open_library_connection(&app)?;

    if settings.include_pdfs {
        for attachment in list_pdf_attachments(&connection)? {
            let path = PathBuf::from(&attachment.stored_path);

            if !path.is_file() {
                objects.push(BackupObject {
                    kind: BackupObjectKind::Pdf,
                    remote_path: format!(
                        "latest/papers/{}.pdf",
                        sanitize_remote_segment(
                            attachment
                                .content_hash
                                .as_deref()
                                .unwrap_or(attachment.id.as_str()),
                            "missing"
                        )
                    ),
                    byte_size: 0,
                    checksum: String::new(),
                    status: BackupObjectStatus::Skipped,
                    uploaded: false,
                    source: format!("attachment:{};paper:{}", attachment.id, attachment.paper_id),
                    message: Some(format!("PDF file is missing: {}", attachment.stored_path)),
                });
                continue;
            }

            let digest = digest_file(&path)?;
            let remote_path = pdf_remote_path(&attachment, Some(&digest));

            if can_skip_from_previous(&previous, &remote_path, &digest) {
                objects.push(BackupObject {
                    kind: BackupObjectKind::Pdf,
                    remote_path,
                    byte_size: digest.byte_size,
                    checksum: digest.checksum,
                    status: BackupObjectStatus::Skipped,
                    uploaded: false,
                    source: format!("attachment:{};paper:{}", attachment.id, attachment.paper_id),
                    message: Some("unchanged PDF already present in latest manifest".to_string()),
                });
                continue;
            }

            webdav
                .atomic_upload_file(&remote_path, &backup_id, &path)
                .await?;
            objects.push(BackupObject {
                kind: BackupObjectKind::Pdf,
                remote_path,
                byte_size: digest.byte_size,
                checksum: digest.checksum,
                status: BackupObjectStatus::Uploaded,
                uploaded: true,
                source: format!(
                    "attachment:{};paper:{};file:{};dbSize:{}",
                    attachment.id, attachment.paper_id, attachment.file_name, attachment.file_size
                ),
                message: None,
            });
        }
    }

    drop(connection);

    if settings.include_derived {
        let cache_root = read_configured_mineru_cache_dir()?;
        let derived_files = collect_derived_cache_files(&cache_root, &mut objects)?;

        for local_file in derived_files {
            let object =
                upload_local_file_object(&webdav, &backup_id, &previous, local_file, true).await?;
            objects.push(object);
        }
    }

    let manifest = build_manifest(&backup_id, &created_at, objects.clone());
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| format!("Failed to serialize WebDAV backup manifest: {error}"))?;
    let run_manifest_remote_path = format!("runs/{backup_id}/manifest.json");

    webdav
        .atomic_upload_bytes(
            &run_manifest_remote_path,
            &backup_id,
            manifest_bytes.clone(),
        )
        .await?;
    webdav
        .atomic_upload_bytes(LATEST_MANIFEST_REMOTE_PATH, &backup_id, manifest_bytes)
        .await?;

    let summary = manifest.summary.clone();
    let _ = fs::remove_dir_all(
        app_local_data_dir(&app)?
            .join("webdav-backup-staging")
            .join(&backup_id),
    );

    Ok(WebdavBackupResult {
        ok: summary.failed_count == 0,
        backup_id,
        created_at,
        manifest_remote_path: LATEST_MANIFEST_REMOTE_PATH.to_string(),
        run_manifest_remote_path,
        uploaded_count: summary.uploaded_count,
        skipped_count: summary.skipped_count,
        failed_count: summary.failed_count,
        database_count: summary.database_count,
        pdf_count: summary.pdf_count,
        derived_count: summary.derived_count,
        message: format!(
            "Backup finished: uploaded {}, skipped {}, failed {}.",
            summary.uploaded_count, summary.skipped_count, summary.failed_count
        ),
        objects: manifest.objects,
    })
}

#[tauri::command]
pub async fn webdav_inspect_latest_backup(
    app: AppHandle,
) -> Result<WebdavLatestBackupInfo, String> {
    let settings = load_settings(&app)?;
    validate_settings(&settings)?;
    let webdav = WebdavClient::new(&settings)?;

    let Some(resolved) = resolve_latest_manifest(&app, &webdav).await? else {
        return Ok(WebdavLatestBackupInfo {
            available: false,
            backup_id: None,
            created_at: None,
            manifest_remote_path: LATEST_MANIFEST_REMOTE_PATH.to_string(),
            uploaded_count: 0,
            skipped_count: 0,
            failed_count: 0,
            database_count: 0,
            pdf_count: 0,
            derived_count: 0,
            message: "No latest WebDAV backup was found yet.".to_string(),
            objects: Vec::new(),
        });
    };
    let ResolvedLatestManifest {
        manifest,
        manifest_remote_path,
        notice,
    } = resolved;

    Ok(WebdavLatestBackupInfo {
        available: true,
        backup_id: Some(manifest.backup_id.clone()),
        created_at: Some(manifest.created_at.clone()),
        manifest_remote_path,
        uploaded_count: manifest.summary.uploaded_count,
        skipped_count: manifest.summary.skipped_count,
        failed_count: manifest.summary.failed_count,
        database_count: manifest.summary.database_count,
        pdf_count: manifest.summary.pdf_count,
        derived_count: manifest.summary.derived_count,
        message: resolved_latest_message(
            notice.as_deref(),
            format!(
                "Latest backup {} from {} contains {} uploaded objects.",
                manifest.backup_id, manifest.created_at, manifest.summary.uploaded_count
            ),
        ),
        objects: manifest.objects,
    })
}

#[tauri::command]
pub async fn webdav_restore_missing_from_latest(
    app: AppHandle,
) -> Result<WebdavRestoreResult, String> {
    let settings = load_settings(&app)?;
    validate_settings(&settings)?;
    let webdav = WebdavClient::new(&settings)?;
    let resolved = resolve_latest_manifest(&app, &webdav)
        .await?
        .ok_or_else(|| {
            "No latest WebDAV backup is available to restore. latest/manifest.json is missing, and no recoverable latest/database snapshot was found."
                .to_string()
        })?;
    let ResolvedLatestManifest {
        manifest,
        manifest_remote_path,
        notice,
    } = resolved;
    let remote_db_path = download_latest_database_backup(&app, &webdav, &manifest).await?;
    let storage_dir = storage_dir_for_restore(&app)?;
    let cache_root = read_configured_mineru_cache_dir()?;
    let (remote_attachments, local_records) = {
        let remote_connection = Connection::open(&remote_db_path).map_err(|error| {
            format!(
                "Failed to open staged remote database {}: {error}",
                remote_db_path.display()
            )
        })?;
        let local_connection = open_library_connection(&app)?;
        let remote_attachments = list_remote_attachments(&remote_connection)?
            .into_iter()
            .map(|attachment| (attachment.id.clone(), attachment))
            .collect::<HashMap<_, _>>();
        let local_records = list_local_attachment_records(&local_connection)?;
        (remote_attachments, local_records)
    };

    let (mut objects, attachment_plans) = restore_pdf_objects(
        &webdav,
        &manifest,
        &remote_attachments,
        &local_records,
        &storage_dir,
    )
    .await?;
    let mut derived_objects = restore_derived_objects(&webdav, &manifest, &cache_root).await?;
    objects.append(&mut derived_objects);

    let table_merge = {
        let local_connection = open_library_connection(&app)?;
        merge_database_from_remote(
            &local_connection,
            &remote_db_path,
            &storage_dir,
            &attachment_plans,
        )
    };
    let tables = table_merge.unwrap_or_else(|error| {
        objects.push(RestoreObject {
            kind: BackupObjectKind::Database,
            remote_path: DATABASE_REMOTE_PATH.to_string(),
            local_path: path_to_string_lossy(&remote_db_path),
            byte_size: 0,
            checksum: String::new(),
            status: RestoreObjectStatus::Failed,
            message: Some(error),
        });
        Vec::new()
    });

    let _ = fs::remove_dir_all(
        app_local_data_dir(&app)?
            .join("webdav-restore-staging")
            .join(if manifest.backup_id.trim().is_empty() {
                "latest".to_string()
            } else {
                manifest.backup_id.clone()
            }),
    );

    let downloaded_count = objects
        .iter()
        .filter(|object| object.status == RestoreObjectStatus::Downloaded)
        .count();
    let skipped_count = objects
        .iter()
        .filter(|object| object.status == RestoreObjectStatus::Skipped)
        .count();
    let failed_count = objects
        .iter()
        .filter(|object| object.status == RestoreObjectStatus::Failed)
        .count();
    let merged_row_count = tables.iter().map(|table| table.inserted_count).sum();
    let updated_row_count = tables.iter().map(|table| table.updated_count).sum();
    let pdf_restored_count = objects
        .iter()
        .filter(|object| {
            object.kind == BackupObjectKind::Pdf && object.status == RestoreObjectStatus::Downloaded
        })
        .count();
    let derived_restored_count = objects
        .iter()
        .filter(|object| {
            matches!(
                object.kind,
                BackupObjectKind::Mineru
                    | BackupObjectKind::Translation
                    | BackupObjectKind::Summary
            ) && object.status == RestoreObjectStatus::Downloaded
        })
        .count();

    Ok(WebdavRestoreResult {
        ok: failed_count == 0,
        backup_id: Some(manifest.backup_id.clone()),
        created_at: Some(manifest.created_at.clone()),
        manifest_remote_path,
        downloaded_count,
        skipped_count,
        failed_count,
        merged_row_count,
        updated_row_count,
        pdf_restored_count,
        derived_restored_count,
        message: resolved_latest_message(
            notice.as_deref(),
            format!(
                "Restore finished: downloaded {}, skipped {}, failed {}, merged {} rows, updated {} rows.",
                downloaded_count, skipped_count, failed_count, merged_row_count, updated_row_count
            ),
        ),
        objects,
        tables,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "paperquay-webdav-backup-tests-{}-{}",
            label,
            current_unix_millis()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn rag_test_connection(path: &Path) -> Connection {
        crate::commands::rag::register_sqlite_vec_once();
        let connection = Connection::open(path).expect("open rag test db");
        crate::commands::rag::migrate_rag_schema(&connection).expect("migrate rag schema");
        connection
    }

    fn seed_rag_vector_row(
        connection: &Connection,
        document_key: &str,
        chunk_id: &str,
        dimension: i64,
    ) {
        connection
            .execute(
                "insert into rag_documents
                   (document_key, title, source_type, source_signature, embedding_model_key,
                    embedding_dimension, total_chunk_count, updated_at, status)
                 values
                   (?1, ?2, 'mineru-markdown', ?3, ?4, ?5, 1, 1, 'ready')",
                params![
                    document_key,
                    format!("Title {document_key}"),
                    format!("sig-{document_key}"),
                    format!("model-{dimension}"),
                    dimension
                ],
            )
            .expect("insert rag document");
        connection
            .execute(
                "insert into rag_chunks
                   (document_key, title, source_type, source_signature, embedding_dimension,
                    chunk_id, chunk_index, page_index, block_id, text, updated_at)
                 values
                   (?1, ?2, 'mineru-markdown', ?3, ?4, ?5, 0, null, null, ?6, 1)",
                params![
                    document_key,
                    format!("Title {document_key}"),
                    format!("sig-{document_key}"),
                    dimension,
                    chunk_id,
                    format!("Chunk {chunk_id}")
                ],
            )
            .expect("insert rag chunk");

        let chunk_row_id: i64 = connection
            .query_row(
                "select id from rag_chunks where document_key = ?1 and source_type = 'mineru-markdown' and chunk_id = ?2",
                params![document_key, chunk_id],
                |row| row.get(0),
            )
            .expect("query rag chunk row id");
        let vector_table_name =
            ensure_rag_vector_table(connection, dimension).expect("ensure vector table");
        let embedding = vec![0u8; dimension as usize * std::mem::size_of::<f32>()];

        connection
            .execute(
                &format!(
                    "insert into {vector_table_name} (chunk_row_id, embedding, document_key, source_type)
                     values (?1, ?2, ?3, 'mineru-markdown')"
                ),
                params![chunk_row_id, embedding, document_key],
            )
            .expect("insert rag vector row");
    }

    #[test]
    fn remote_root_rejects_traversal() {
        assert_eq!(
            normalize_remote_root("/paperquay//backups/").unwrap(),
            "paperquay/backups"
        );
        assert!(normalize_remote_root("paperquay/../escape").is_err());
        assert!(normalize_remote_root("").is_err());
    }

    #[test]
    fn temp_upload_path_uses_backup_id_suffix() {
        assert_eq!(
            temp_upload_path("latest/manifest.json", "run-1"),
            "latest/manifest.json.uploading-run-1"
        );
    }

    #[test]
    fn derived_cache_classifier_allows_only_known_paths() {
        assert_eq!(
            classify_derived_cache_file("document-a", Path::new("full.md"))
                .unwrap()
                .0,
            BackupObjectKind::Mineru
        );
        assert_eq!(
            classify_derived_cache_file("document-a", Path::new("translations/chinese.json"))
                .unwrap()
                .0,
            BackupObjectKind::Translation
        );
        assert_eq!(
            classify_derived_cache_file("document-a", Path::new("summaries/614ada92.json"))
                .unwrap()
                .0,
            BackupObjectKind::Summary
        );
        assert!(classify_derived_cache_file("document-a", Path::new("secrets.json")).is_none());
        assert!(classify_derived_cache_file("document-a", Path::new("images/a.jpg")).is_none());
    }

    #[test]
    fn listed_remote_derived_object_classifier_allows_only_backup_paths() {
        assert_eq!(
            classify_listed_derived_object(&WebdavCollectionEntry {
                remote_path: "latest/derived/mineru/document-a/full.md".to_string(),
                is_collection: false,
                byte_size: 1,
                last_modified: None,
            }),
            Some(BackupObjectKind::Mineru)
        );
        assert_eq!(
            classify_listed_derived_object(&WebdavCollectionEntry {
                remote_path: "latest/derived/translations/document-a/zh.json".to_string(),
                is_collection: false,
                byte_size: 1,
                last_modified: None,
            }),
            Some(BackupObjectKind::Translation)
        );
        assert_eq!(
            classify_listed_derived_object(&WebdavCollectionEntry {
                remote_path: "latest/derived/summaries/document-a/hash.json".to_string(),
                is_collection: false,
                byte_size: 1,
                last_modified: None,
            }),
            Some(BackupObjectKind::Summary)
        );
        assert_eq!(
            classify_listed_derived_object(&WebdavCollectionEntry {
                remote_path: "latest/derived/mineru/document-a/image.png".to_string(),
                is_collection: false,
                byte_size: 1,
                last_modified: None,
            }),
            None
        );
    }

    #[test]
    fn manifest_object_is_restorable_without_checksum_when_remote_metadata_exists() {
        assert!(manifest_object_is_restorable(&BackupObject {
            kind: BackupObjectKind::Pdf,
            remote_path: "latest/papers/a.pdf".to_string(),
            byte_size: 42,
            checksum: String::new(),
            status: BackupObjectStatus::Uploaded,
            uploaded: true,
            source: "test".to_string(),
            message: None,
        }));
        assert!(!manifest_object_is_restorable(&BackupObject {
            kind: BackupObjectKind::Pdf,
            remote_path: "latest/papers/b.pdf".to_string(),
            byte_size: 0,
            checksum: String::new(),
            status: BackupObjectStatus::Skipped,
            uploaded: false,
            source: "test".to_string(),
            message: Some("missing".to_string()),
        }));
    }

    #[test]
    fn merge_rag_vectors_skips_existing_local_rows() {
        let temp_dir = unique_temp_dir("merge-rag-vectors");
        let local_db = temp_dir.join("local.sqlite3");
        let remote_db = temp_dir.join("remote.sqlite3");
        let local_connection = rag_test_connection(&local_db);
        let remote_connection = rag_test_connection(&remote_db);

        seed_rag_vector_row(&local_connection, "doc-a", "chunk-1", 4);
        seed_rag_vector_row(&remote_connection, "doc-a", "chunk-1", 4);
        drop(remote_connection);

        let stats =
            merge_database_from_remote(&local_connection, &remote_db, &temp_dir, &HashMap::new())
                .expect("merge rag vectors without duplicate failure");
        assert!(stats.is_empty(), "expected no additive rows, got {stats:?}");

        let vector_table_name = rag_vector_table_name(4).expect("vector table name");
        let vector_count: i64 = local_connection
            .query_row(
                &format!("select count(*) from {vector_table_name}"),
                [],
                |row| row.get(0),
            )
            .expect("count local vector rows");
        assert_eq!(vector_count, 1);
    }

    #[test]
    fn previous_manifest_can_prove_unchanged_object() {
        let previous = previous_manifest_index(Some(WebdavBackupManifest {
            version: 1,
            backup_id: "run-1".to_string(),
            created_at: "2026-05-19T00:00:00Z".to_string(),
            app: BackupManifestApp {
                name: "PaperQuay".to_string(),
                version: "0.0.0".to_string(),
            },
            objects: vec![
                BackupObject {
                    kind: BackupObjectKind::Pdf,
                    remote_path: "latest/papers/a.pdf".to_string(),
                    byte_size: 10,
                    checksum: "sha256:abc".to_string(),
                    status: BackupObjectStatus::Uploaded,
                    uploaded: true,
                    source: "test".to_string(),
                    message: None,
                },
                BackupObject {
                    kind: BackupObjectKind::Pdf,
                    remote_path: "latest/papers/b.pdf".to_string(),
                    byte_size: 10,
                    checksum: "sha256:abc".to_string(),
                    status: BackupObjectStatus::Skipped,
                    uploaded: false,
                    source: "test".to_string(),
                    message: Some("already present".to_string()),
                },
            ],
            summary: BackupSummary {
                uploaded_count: 1,
                skipped_count: 1,
                failed_count: 0,
                database_count: 0,
                pdf_count: 2,
                derived_count: 0,
            },
        }));

        assert!(can_skip_from_previous(
            &previous,
            "latest/papers/a.pdf",
            &FileDigest {
                byte_size: 10,
                checksum: "sha256:abc".to_string(),
            }
        ));
        assert!(can_skip_from_previous(
            &previous,
            "latest/papers/b.pdf",
            &FileDigest {
                byte_size: 10,
                checksum: "sha256:abc".to_string(),
            }
        ));
        assert!(!can_skip_from_previous(
            &previous,
            "latest/papers/a.pdf",
            &FileDigest {
                byte_size: 11,
                checksum: "sha256:abc".to_string(),
            }
        ));
    }

    #[test]
    fn sqlite_backup_api_writes_readable_staging_file() {
        let source = Connection::open_in_memory().expect("open source");
        source
            .execute_batch(
                "create table papers(id text primary key); insert into papers values ('p1');",
            )
            .expect("seed source");
        let dir = unique_temp_dir("sqlite");
        let destination = dir.join("library.sqlite3");

        backup_connection_to_path(&source, &destination).expect("backup sqlite");

        let restored = Connection::open(&destination).expect("open backup");
        let count: i64 = restored
            .query_row("select count(*) from papers", [], |row| row.get(0))
            .expect("query backup");

        assert_eq!(count, 1);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn safe_join_rejects_parent_segments() {
        assert!(safe_join_local_path(Path::new("root"), Path::new("../escape")).is_err());
        assert!(safe_join_local_path(Path::new("root"), Path::new("nested/file.txt")).is_ok());
    }

    #[test]
    fn restore_target_maps_derived_layout_back_to_local_cache() {
        let root = Path::new("cache-root");

        assert_eq!(
            restore_target_for_remote_path(root, "latest/derived/mineru/document-a/full.md")
                .unwrap(),
            PathBuf::from("cache-root")
                .join("document-a")
                .join("full.md")
        );
        assert_eq!(
            restore_target_for_remote_path(
                root,
                "latest/derived/translations/document-a/chinese.json"
            )
            .unwrap(),
            PathBuf::from("cache-root")
                .join("document-a")
                .join("translations")
                .join("chinese.json")
        );
        assert_eq!(
            restore_target_for_remote_path(
                root,
                "latest/derived/summaries/document-a/614ada92.json"
            )
            .unwrap(),
            PathBuf::from("cache-root")
                .join("document-a")
                .join("summaries")
                .join("614ada92.json")
        );
    }

    #[test]
    fn attachment_id_can_be_parsed_from_manifest_source() {
        assert_eq!(
            parse_attachment_id_from_source("attachment:att-1;paper:paper-1;file:test.pdf"),
            Some("att-1".to_string())
        );
        assert_eq!(parse_attachment_id_from_source("paper:paper-1"), None);
    }

    #[test]
    fn local_restore_path_becomes_unique_when_needed() {
        let dir = unique_temp_dir("restore-path");
        let path = dir.join("paper.pdf");
        fs::write(&path, b"existing").expect("seed existing file");

        let unique = unique_local_restore_path(&path);
        assert_ne!(unique, path);
        assert!(unique.to_string_lossy().contains(".restored-"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn local_file_match_uses_manifest_digest() {
        let dir = unique_temp_dir("match");
        let path = dir.join("sample.txt");
        fs::write(&path, b"paperquay").expect("write file");
        let digest = digest_file(&path).expect("digest file");
        let object = BackupObject {
            kind: BackupObjectKind::Summary,
            remote_path: "latest/derived/summaries/doc/sample.json".to_string(),
            byte_size: digest.byte_size,
            checksum: digest.checksum.clone(),
            status: BackupObjectStatus::Uploaded,
            uploaded: true,
            source: "test".to_string(),
            message: None,
        };

        assert!(local_file_matches_manifest(&path, &object).expect("match check"));

        let _ = fs::remove_dir_all(dir);
    }
}

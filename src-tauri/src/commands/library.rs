use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use rfd::FileDialog;
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

static NEXT_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

const SYSTEM_CATEGORY_ALL: &str = "all";
const SYSTEM_CATEGORY_RECENT: &str = "recent";
const SYSTEM_CATEGORY_UNCATEGORIZED: &str = "uncategorized";
const SYSTEM_CATEGORY_FAVORITES: &str = "favorites";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySettings {
    storage_dir: String,
    zotero_local_data_dir: String,
    import_mode: String,
    auto_rename_files: bool,
    file_naming_rule: String,
    create_category_folders: bool,
    folder_watch_enabled: bool,
    backup_enabled: bool,
    preserve_original_path: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiteratureAuthor {
    id: String,
    name: String,
    given_name: Option<String>,
    family_name: Option<String>,
    sort_order: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiteratureTag {
    id: String,
    name: String,
    color: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiteratureCategory {
    id: String,
    name: String,
    parent_id: Option<String>,
    sort_order: i64,
    is_system: bool,
    system_key: Option<String>,
    created_at: i64,
    updated_at: i64,
    paper_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiteratureAttachment {
    id: String,
    paper_id: String,
    kind: String,
    original_path: Option<String>,
    stored_path: String,
    relative_path: Option<String>,
    file_name: String,
    mime_type: String,
    file_size: i64,
    content_hash: Option<String>,
    created_at: i64,
    missing: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiteraturePaper {
    id: String,
    title: String,
    year: Option<String>,
    publication: Option<String>,
    doi: Option<String>,
    url: Option<String>,
    abstract_text: Option<String>,
    keywords: Vec<String>,
    imported_at: i64,
    updated_at: i64,
    last_read_at: Option<i64>,
    reading_progress: f64,
    is_favorite: bool,
    user_note: Option<String>,
    ai_summary: Option<String>,
    citation: Option<String>,
    source: String,
    authors: Vec<LiteratureAuthor>,
    tags: Vec<LiteratureTag>,
    category_ids: Vec<String>,
    attachments: Vec<LiteratureAttachment>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    settings: LibrarySettings,
    categories: Vec<LiteratureCategory>,
    papers: Vec<LiteraturePaper>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPapersRequest {
    category_id: Option<String>,
    tag_id: Option<String>,
    search: Option<String>,
    sort_by: Option<String>,
    sort_direction: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCategoryRequest {
    name: String,
    parent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCategoryRequest {
    id: String,
    name: Option<String>,
    parent_id: Option<String>,
    sort_order: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPdfMetadata {
    title: Option<String>,
    year: Option<String>,
    publication: Option<String>,
    doi: Option<String>,
    url: Option<String>,
    abstract_text: Option<String>,
    keywords: Option<Vec<String>>,
    authors: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPdfRequest {
    paths: Vec<String>,
    target_category_id: Option<String>,
    import_mode: Option<String>,
    metadata: Option<HashMap<String, ImportPdfMetadata>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPdfResult {
    source_path: String,
    paper: Option<LiteraturePaper>,
    duplicated: bool,
    existing_paper_id: Option<String>,
    status: String,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelocateAttachmentRequest {
    attachment_id: String,
    new_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignPaperCategoryRequest {
    paper_id: String,
    category_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePaperRequest {
    paper_id: String,
    title: Option<String>,
    year: Option<Option<String>>,
    publication: Option<Option<String>>,
    doi: Option<Option<String>>,
    url: Option<Option<String>>,
    abstract_text: Option<Option<String>>,
    keywords: Option<Vec<String>>,
    tags: Option<Vec<String>>,
    authors: Option<Vec<String>>,
    user_note: Option<Option<String>>,
    ai_summary: Option<Option<String>>,
    citation: Option<Option<String>>,
    is_favorite: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePaperRequest {
    paper_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveCategoryRequest {
    category_id: String,
    parent_id: Option<String>,
    sort_order: Option<i64>,
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

fn new_id(prefix: &str) -> String {
    let counter = NEXT_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();

    format!("{}_{:x}_{:x}", prefix, nanos, counter)
}

fn path_to_string(path: PathBuf) -> Result<String, String> {
    path.into_os_string()
        .into_string()
        .map_err(|_| "路径包含无法识别的字符".to_string())
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法获取应用数据目录: {}", error))?;

    fs::create_dir_all(&dir)
        .map_err(|error| format!("无法创建应用数据目录 {}: {}", dir.display(), error))?;

    Ok(dir)
}

fn library_database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?;
    Ok(dir.join("paperquay-library.sqlite3"))
}

fn default_storage_dir(app: &AppHandle) -> Result<String, String> {
    path_to_string(app_data_dir(app)?.join("Papers"))
}

fn open_library_connection(app: &AppHandle) -> Result<Connection, String> {
    let database_path = library_database_path(app)?;

    if let Some(parent) = database_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("无法创建文献库数据库目录 {}: {}", parent.display(), error))?;
    }

    let connection = Connection::open(&database_path).map_err(|error| {
        format!(
            "无法打开文献库数据库 {}: {}",
            database_path.display(),
            error
        )
    })?;

    migrate_library_schema(&connection)?;
    seed_system_categories(&connection)?;
    seed_default_settings(&connection, app)?;

    Ok(connection)
}

fn migrate_library_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
      pragma foreign_keys = on;

      create table if not exists papers (
        id text primary key,
        title text not null,
        year text,
        publication text,
        doi text,
        url text,
        abstract_text text,
        keywords text not null default '[]',
        imported_at integer not null,
        updated_at integer not null,
        last_read_at integer,
        reading_progress real not null default 0,
        is_favorite integer not null default 0,
        user_note text,
        ai_summary text,
        citation text,
        source text not null default 'local'
      );

      create table if not exists authors (
        id text primary key,
        name text not null unique,
        given_name text,
        family_name text,
        created_at integer not null
      );

      create table if not exists paper_authors (
        paper_id text not null,
        author_id text not null,
        sort_order integer not null default 0,
        primary key (paper_id, author_id),
        foreign key (paper_id) references papers(id) on delete cascade,
        foreign key (author_id) references authors(id) on delete cascade
      );

      create table if not exists categories (
        id text primary key,
        name text not null,
        parent_id text,
        sort_order integer not null default 0,
        is_system integer not null default 0,
        system_key text unique,
        created_at integer not null,
        updated_at integer not null,
        foreign key (parent_id) references categories(id) on delete set null
      );

      create table if not exists paper_categories (
        paper_id text not null,
        category_id text not null,
        created_at integer not null,
        primary key (paper_id, category_id),
        foreign key (paper_id) references papers(id) on delete cascade,
        foreign key (category_id) references categories(id) on delete cascade
      );

      create table if not exists tags (
        id text primary key,
        name text not null unique,
        color text,
        created_at integer not null
      );

      create table if not exists paper_tags (
        paper_id text not null,
        tag_id text not null,
        created_at integer not null,
        primary key (paper_id, tag_id),
        foreign key (paper_id) references papers(id) on delete cascade,
        foreign key (tag_id) references tags(id) on delete cascade
      );

      create table if not exists attachments (
        id text primary key,
        paper_id text not null,
        kind text not null default 'pdf',
        original_path text,
        stored_path text not null,
        relative_path text,
        file_name text not null,
        mime_type text not null default 'application/pdf',
        file_size integer not null default 0,
        content_hash text,
        created_at integer not null,
        missing integer not null default 0,
        foreign key (paper_id) references papers(id) on delete cascade
      );

      create index if not exists idx_attachments_hash on attachments(content_hash, file_size);
      create index if not exists idx_attachments_paper on attachments(paper_id);
      create index if not exists idx_paper_categories_category on paper_categories(category_id);
      create index if not exists idx_paper_tags_tag on paper_tags(tag_id);

      create table if not exists annotations (
        id text primary key,
        paper_id text not null,
        attachment_id text,
        page_index integer not null,
        bbox_json text,
        kind text not null,
        color text,
        quote text,
        note text,
        created_at integer not null,
        updated_at integer not null,
        foreign key (paper_id) references papers(id) on delete cascade,
        foreign key (attachment_id) references attachments(id) on delete set null
      );

      create table if not exists notes (
        id text primary key,
        paper_id text not null,
        title text,
        content text not null,
        content_format text not null default 'markdown',
        created_at integer not null,
        updated_at integer not null,
        foreign key (paper_id) references papers(id) on delete cascade
      );

      create table if not exists import_records (
        id text primary key,
        source text not null,
        source_path text,
        target_path text,
        paper_id text,
        status text not null,
        message text,
        imported_at integer not null,
        foreign key (paper_id) references papers(id) on delete set null
      );

      create table if not exists app_settings (
        key text primary key,
        value text not null,
        updated_at integer not null
      );
      ",
        )
        .map_err(|error| format!("初始化文献库数据库失败: {}", error))
}

fn seed_system_categories(connection: &Connection) -> Result<(), String> {
    let now = now_millis();
    let categories = [
        (SYSTEM_CATEGORY_ALL, "全部文献", 0),
        (SYSTEM_CATEGORY_RECENT, "最近导入", 1),
        (SYSTEM_CATEGORY_UNCATEGORIZED, "未分类", 2),
        (SYSTEM_CATEGORY_FAVORITES, "收藏", 3),
    ];

    for (system_key, name, sort_order) in categories {
        connection
            .execute(
                "insert or ignore into categories
         (id, name, parent_id, sort_order, is_system, system_key, created_at, updated_at)
         values (?1, ?2, null, ?3, 1, ?4, ?5, ?5)",
                params![
                    format!("system-{}", system_key),
                    name,
                    sort_order,
                    system_key,
                    now
                ],
            )
            .map_err(|error| format!("初始化系统分类失败: {}", error))?;
    }

    Ok(())
}

fn seed_default_settings(connection: &Connection, app: &AppHandle) -> Result<(), String> {
    let settings = default_library_settings(app)?;
    let existing_count: i64 = connection
        .query_row("select count(*) from app_settings", [], |row| row.get(0))
        .map_err(|error| format!("读取文献库设置失败: {}", error))?;

    if existing_count == 0 {
        save_library_settings(connection, &settings)?;
    }

    Ok(())
}

fn default_library_settings(app: &AppHandle) -> Result<LibrarySettings, String> {
    Ok(LibrarySettings {
        storage_dir: default_storage_dir(app)?,
        zotero_local_data_dir: String::new(),
        import_mode: "copy".to_string(),
        auto_rename_files: true,
        file_naming_rule: "{firstAuthor}_{year}_{title}.pdf".to_string(),
        create_category_folders: false,
        folder_watch_enabled: false,
        backup_enabled: true,
        preserve_original_path: true,
    })
}

fn read_setting(connection: &Connection, key: &str) -> Result<Option<String>, String> {
    connection
        .query_row(
            "select value from app_settings where key = ?1 limit 1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("读取设置 {} 失败: {}", key, error))
}

fn parse_bool_setting(value: Option<String>, fallback: bool) -> bool {
    value
        .as_deref()
        .map(|raw| raw == "true" || raw == "1")
        .unwrap_or(fallback)
}

fn load_library_settings(
    connection: &Connection,
    app: &AppHandle,
) -> Result<LibrarySettings, String> {
    let defaults = default_library_settings(app)?;

    Ok(LibrarySettings {
        storage_dir: read_setting(connection, "storage_dir")?.unwrap_or(defaults.storage_dir),
        zotero_local_data_dir: read_setting(connection, "zotero_local_data_dir")?
            .unwrap_or(defaults.zotero_local_data_dir),
        import_mode: read_setting(connection, "import_mode")?.unwrap_or(defaults.import_mode),
        auto_rename_files: parse_bool_setting(
            read_setting(connection, "auto_rename_files")?,
            defaults.auto_rename_files,
        ),
        file_naming_rule: read_setting(connection, "file_naming_rule")?
            .unwrap_or(defaults.file_naming_rule),
        create_category_folders: parse_bool_setting(
            read_setting(connection, "create_category_folders")?,
            defaults.create_category_folders,
        ),
        folder_watch_enabled: parse_bool_setting(
            read_setting(connection, "folder_watch_enabled")?,
            defaults.folder_watch_enabled,
        ),
        backup_enabled: parse_bool_setting(
            read_setting(connection, "backup_enabled")?,
            defaults.backup_enabled,
        ),
        preserve_original_path: parse_bool_setting(
            read_setting(connection, "preserve_original_path")?,
            defaults.preserve_original_path,
        ),
    })
}

fn save_setting(connection: &Connection, key: &str, value: String) -> Result<(), String> {
    connection
        .execute(
            "insert into app_settings (key, value, updated_at)
       values (?1, ?2, ?3)
       on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, now_millis()],
        )
        .map_err(|error| format!("保存设置 {} 失败: {}", key, error))?;

    Ok(())
}

fn save_library_settings(
    connection: &Connection,
    settings: &LibrarySettings,
) -> Result<(), String> {
    save_setting(connection, "storage_dir", settings.storage_dir.clone())?;
    save_setting(
        connection,
        "zotero_local_data_dir",
        settings.zotero_local_data_dir.clone(),
    )?;
    save_setting(
        connection,
        "import_mode",
        normalize_import_mode(&settings.import_mode)?,
    )?;
    save_setting(
        connection,
        "auto_rename_files",
        settings.auto_rename_files.to_string(),
    )?;
    save_setting(
        connection,
        "file_naming_rule",
        settings.file_naming_rule.clone(),
    )?;
    save_setting(
        connection,
        "create_category_folders",
        settings.create_category_folders.to_string(),
    )?;
    save_setting(
        connection,
        "folder_watch_enabled",
        settings.folder_watch_enabled.to_string(),
    )?;
    save_setting(
        connection,
        "backup_enabled",
        settings.backup_enabled.to_string(),
    )?;
    save_setting(
        connection,
        "preserve_original_path",
        settings.preserve_original_path.to_string(),
    )?;

    Ok(())
}

fn normalize_import_mode(value: &str) -> Result<String, String> {
    match value.trim() {
        "copy" | "move" | "keep" => Ok(value.trim().to_string()),
        other => Err(format!("不支持的导入模式: {}", other)),
    }
}

fn sanitize_filename_part(input: &str) -> String {
    let mut output = input
        .chars()
        .map(|character| match character {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            '\r' | '\n' | '\t' => ' ',
            other => other,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    if output.is_empty() {
        output = "Untitled".to_string();
    }

    output.chars().take(120).collect()
}

fn title_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .map(sanitize_filename_part)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Untitled PDF".to_string())
}

fn normalize_keywords(keywords: Option<Vec<String>>) -> Vec<String> {
    keywords
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

fn clean_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|next| next.trim().to_string())
        .filter(|next| !next.is_empty())
}

fn merge_nullable_string(next: Option<Option<String>>, current: Option<String>) -> Option<String> {
    match next {
        Some(value) => clean_optional_string(value),
        None => current,
    }
}

fn keywords_to_json(keywords: &[String]) -> Result<String, String> {
    serde_json::to_string(keywords).map_err(|error| format!("序列化关键词失败: {}", error))
}

fn keywords_from_json(value: String) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(&value).unwrap_or_default()
}

fn first_author_for_filename(metadata: Option<&ImportPdfMetadata>) -> String {
    metadata
        .and_then(|value| value.authors.as_ref())
        .and_then(|authors| authors.first())
        .map(|author| sanitize_filename_part(author))
        .filter(|author| !author.trim().is_empty())
        .unwrap_or_else(|| "Unknown".to_string())
}

fn build_target_file_name(
    source_path: &Path,
    settings: &LibrarySettings,
    metadata: Option<&ImportPdfMetadata>,
    title: &str,
) -> String {
    if !settings.auto_rename_files {
        return source_path
            .file_name()
            .and_then(|value| value.to_str())
            .map(sanitize_filename_part)
            .filter(|value| value.to_ascii_lowercase().ends_with(".pdf"))
            .unwrap_or_else(|| format!("{}.pdf", sanitize_filename_part(title)));
    }

    let original_name = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("paper");
    let year = metadata
        .and_then(|value| value.year.as_deref())
        .unwrap_or("n.d.");
    let doi = metadata
        .and_then(|value| value.doi.as_deref())
        .unwrap_or("");
    let mut file_name = settings
        .file_naming_rule
        .replace("{firstAuthor}", &first_author_for_filename(metadata))
        .replace("{year}", &sanitize_filename_part(year))
        .replace("{title}", &sanitize_filename_part(title))
        .replace("{doi}", &sanitize_filename_part(doi))
        .replace("{originalName}", &sanitize_filename_part(original_name));

    if !file_name.to_ascii_lowercase().ends_with(".pdf") {
        file_name.push_str(".pdf");
    }

    sanitize_filename_part(&file_name)
}

fn unique_target_path(directory: &Path, file_name: &str) -> PathBuf {
    let candidate = directory.join(file_name);

    if !candidate.exists() {
        return candidate;
    }

    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("paper");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("pdf");

    for index in 2..10_000 {
        let next = directory.join(format!("{}-{}.{}", stem, index, extension));

        if !next.exists() {
            return next;
        }
    }

    directory.join(format!("{}-{}.{}", stem, now_millis(), extension))
}

fn fnv1a_file_hash(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("读取文件用于去重失败 {}: {}", path.display(), error))?;
    let mut hash: u64 = 0xcbf29ce484222325;

    for byte in bytes {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }

    Ok(format!("{:016x}", hash))
}

fn relative_path_if_possible(path: &Path, base_dir: &Path) -> Option<String> {
    path.strip_prefix(base_dir)
        .ok()
        .map(|value| value.to_string_lossy().into_owned())
}

fn ensure_pdf_path(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err(format!("PDF 文件不存在: {}", path.display()));
    }

    let is_pdf = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false);

    if !is_pdf {
        return Err(format!("不是 PDF 文件: {}", path.display()));
    }

    Ok(())
}

fn existing_paper_by_hash(
    connection: &Connection,
    content_hash: &str,
    file_size: i64,
) -> Result<Option<String>, String> {
    connection
        .query_row(
            "select paper_id from attachments
       where content_hash = ?1 and file_size = ?2
       limit 1",
            params![content_hash, file_size],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("查询重复文献失败: {}", error))
}

fn insert_import_record(
    connection: &Connection,
    source_path: Option<&str>,
    target_path: Option<&str>,
    paper_id: Option<&str>,
    status: &str,
    message: &str,
) -> Result<(), String> {
    connection
        .execute(
            "insert into import_records
       (id, source, source_path, target_path, paper_id, status, message, imported_at)
       values (?1, 'pdf', ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                new_id("imp"),
                source_path,
                target_path,
                paper_id,
                status,
                message,
                now_millis()
            ],
        )
        .map_err(|error| format!("写入导入记录失败: {}", error))?;

    Ok(())
}

fn insert_authors(
    connection: &Connection,
    paper_id: &str,
    authors: &[String],
) -> Result<(), String> {
    for (index, raw_name) in authors.iter().enumerate() {
        let name = raw_name.trim();

        if name.is_empty() {
            continue;
        }

        let author_id = connection
            .query_row(
                "select id from authors where name = ?1 limit 1",
                params![name],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("查询作者失败: {}", error))?
            .unwrap_or_else(|| new_id("auth"));

        connection
            .execute(
                "insert or ignore into authors
         (id, name, given_name, family_name, created_at)
         values (?1, ?2, null, null, ?3)",
                params![author_id, name, now_millis()],
            )
            .map_err(|error| format!("写入作者失败: {}", error))?;

        connection
            .execute(
                "insert or ignore into paper_authors (paper_id, author_id, sort_order)
         values (?1, ?2, ?3)",
                params![paper_id, author_id, index as i64],
            )
            .map_err(|error| format!("关联作者失败: {}", error))?;
    }

    Ok(())
}

fn replace_authors(
    connection: &Connection,
    paper_id: &str,
    authors: &[String],
) -> Result<(), String> {
    connection
        .execute(
            "delete from paper_authors where paper_id = ?1",
            params![paper_id],
        )
        .map_err(|error| format!("清空原作者失败: {}", error))?;

    insert_authors(connection, paper_id, authors)
}

fn insert_tags(connection: &Connection, paper_id: &str, tags: &[String]) -> Result<(), String> {
    for raw_name in tags {
        let name = raw_name.trim();

        if name.is_empty() {
            continue;
        }

        let tag_id = connection
            .query_row(
                "select id from tags where name = ?1 limit 1",
                params![name],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("查询标签失败: {}", error))?
            .unwrap_or_else(|| new_id("tag"));

        connection
            .execute(
                "insert or ignore into tags (id, name, color, created_at)
                 values (?1, ?2, null, ?3)",
                params![tag_id, name, now_millis()],
            )
            .map_err(|error| format!("写入标签失败: {}", error))?;

        connection
            .execute(
                "insert or ignore into paper_tags (paper_id, tag_id, created_at)
                 values (?1, ?2, ?3)",
                params![paper_id, tag_id, now_millis()],
            )
            .map_err(|error| format!("关联标签失败: {}", error))?;
    }

    Ok(())
}

fn replace_tags(connection: &Connection, paper_id: &str, tags: &[String]) -> Result<(), String> {
    connection
        .execute(
            "delete from paper_tags where paper_id = ?1",
            params![paper_id],
        )
        .map_err(|error| format!("清空原标签失败: {}", error))?;

    insert_tags(connection, paper_id, tags)
}

fn insert_category_relation(
    connection: &Connection,
    paper_id: &str,
    category_id: Option<&str>,
) -> Result<(), String> {
    let Some(category_id) = category_id else {
        return Ok(());
    };

    let is_system: i64 = connection
        .query_row(
            "select is_system from categories where id = ?1 limit 1",
            params![category_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("查询分类失败: {}", error))?
        .unwrap_or(0);

    if is_system != 0 {
        return Ok(());
    }

    connection
        .execute(
            "insert or ignore into paper_categories (paper_id, category_id, created_at)
       values (?1, ?2, ?3)",
            params![paper_id, category_id, now_millis()],
        )
        .map_err(|error| format!("添加文献分类失败: {}", error))?;

    Ok(())
}

fn map_attachment_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<LiteratureAttachment> {
    Ok(LiteratureAttachment {
        id: row.get(0)?,
        paper_id: row.get(1)?,
        kind: row.get(2)?,
        original_path: row.get(3)?,
        stored_path: row.get(4)?,
        relative_path: row.get(5)?,
        file_name: row.get(6)?,
        mime_type: row.get(7)?,
        file_size: row.get(8)?,
        content_hash: row.get(9)?,
        created_at: row.get(10)?,
        missing: row.get::<_, i64>(11)? != 0,
    })
}

fn list_authors_for_paper(
    connection: &Connection,
    paper_id: &str,
) -> Result<Vec<LiteratureAuthor>, String> {
    let mut statement = connection
        .prepare(
            "select a.id, a.name, a.given_name, a.family_name, pa.sort_order
       from paper_authors pa
       join authors a on a.id = pa.author_id
       where pa.paper_id = ?1
       order by pa.sort_order asc, a.name asc",
        )
        .map_err(|error| format!("准备作者查询失败: {}", error))?;
    let rows = statement
        .query_map(params![paper_id], |row| {
            Ok(LiteratureAuthor {
                id: row.get(0)?,
                name: row.get(1)?,
                given_name: row.get(2)?,
                family_name: row.get(3)?,
                sort_order: row.get(4)?,
            })
        })
        .map_err(|error| format!("查询作者失败: {}", error))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取作者失败: {}", error))
}

fn list_tags_for_paper(
    connection: &Connection,
    paper_id: &str,
) -> Result<Vec<LiteratureTag>, String> {
    let mut statement = connection
        .prepare(
            "select t.id, t.name, t.color
       from paper_tags pt
       join tags t on t.id = pt.tag_id
       where pt.paper_id = ?1
       order by lower(t.name) asc",
        )
        .map_err(|error| format!("准备标签查询失败: {}", error))?;
    let rows = statement
        .query_map(params![paper_id], |row| {
            Ok(LiteratureTag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
            })
        })
        .map_err(|error| format!("查询标签失败: {}", error))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取标签失败: {}", error))
}

fn list_category_ids_for_paper(
    connection: &Connection,
    paper_id: &str,
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "select category_id from paper_categories
       where paper_id = ?1
       order by created_at asc",
        )
        .map_err(|error| format!("准备文献分类查询失败: {}", error))?;
    let rows = statement
        .query_map(params![paper_id], |row| row.get::<_, String>(0))
        .map_err(|error| format!("查询文献分类失败: {}", error))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取文献分类失败: {}", error))
}

fn list_attachments_for_paper(
    connection: &Connection,
    paper_id: &str,
) -> Result<Vec<LiteratureAttachment>, String> {
    let mut statement = connection
        .prepare(
            "select id, paper_id, kind, original_path, stored_path, relative_path, file_name,
              mime_type, file_size, content_hash, created_at, missing
       from attachments
       where paper_id = ?1
       order by created_at asc",
        )
        .map_err(|error| format!("准备附件查询失败: {}", error))?;
    let rows = statement
        .query_map(params![paper_id], map_attachment_row)
        .map_err(|error| format!("查询附件失败: {}", error))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取附件失败: {}", error))
}

fn load_paper_by_id(
    connection: &Connection,
    paper_id: &str,
) -> Result<Option<LiteraturePaper>, String> {
    let base = connection
        .query_row(
            "select id, title, year, publication, doi, url, abstract_text, keywords,
              imported_at, updated_at, last_read_at, reading_progress, is_favorite,
              user_note, ai_summary, citation, source
       from papers
       where id = ?1
       limit 1",
            params![paper_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, i64>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, Option<i64>>(10)?,
                    row.get::<_, f64>(11)?,
                    row.get::<_, i64>(12)?,
                    row.get::<_, Option<String>>(13)?,
                    row.get::<_, Option<String>>(14)?,
                    row.get::<_, Option<String>>(15)?,
                    row.get::<_, String>(16)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("读取文献失败: {}", error))?;

    let Some((
        id,
        title,
        year,
        publication,
        doi,
        url,
        abstract_text,
        keywords_json,
        imported_at,
        updated_at,
        last_read_at,
        reading_progress,
        is_favorite,
        user_note,
        ai_summary,
        citation,
        source,
    )) = base
    else {
        return Ok(None);
    };

    Ok(Some(LiteraturePaper {
        authors: list_authors_for_paper(connection, &id)?,
        tags: list_tags_for_paper(connection, &id)?,
        category_ids: list_category_ids_for_paper(connection, &id)?,
        attachments: list_attachments_for_paper(connection, &id)?,
        id,
        title,
        year,
        publication,
        doi,
        url,
        abstract_text,
        keywords: keywords_from_json(keywords_json),
        imported_at,
        updated_at,
        last_read_at,
        reading_progress,
        is_favorite: is_favorite != 0,
        user_note,
        ai_summary,
        citation,
        source,
    }))
}

fn category_id_for_system_key(
    connection: &Connection,
    system_key: &str,
) -> Result<Option<String>, String> {
    connection
        .query_row(
            "select id from categories where system_key = ?1 limit 1",
            params![system_key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("查询系统分类失败: {}", error))
}

fn category_system_key(
    connection: &Connection,
    category_id: &str,
) -> Result<Option<String>, String> {
    connection
        .query_row(
            "select system_key from categories where id = ?1 limit 1",
            params![category_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map(|value| value.flatten())
        .map_err(|error| format!("查询分类类型失败: {}", error))
}

fn category_exists(connection: &Connection, category_id: &str) -> Result<bool, String> {
    connection
        .query_row(
            "select 1 from categories where id = ?1 limit 1",
            params![category_id],
            |_row| Ok(()),
        )
        .optional()
        .map(|value| value.is_some())
        .map_err(|error| format!("查询分类是否存在失败: {}", error))
}

fn category_is_system(connection: &Connection, category_id: &str) -> Result<bool, String> {
    connection
        .query_row(
            "select is_system from categories where id = ?1 limit 1",
            params![category_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| format!("查询分类失败: {}", error))?
        .map(|value| value != 0)
        .ok_or_else(|| "分类不存在".to_string())
}

fn would_create_category_cycle(
    connection: &Connection,
    category_id: &str,
    next_parent_id: Option<&str>,
) -> Result<bool, String> {
    let mut current_parent_id = next_parent_id.map(str::to_string);

    while let Some(parent_id) = current_parent_id {
        if parent_id == category_id {
            return Ok(true);
        }

        current_parent_id = connection
            .query_row(
                "select parent_id from categories where id = ?1 limit 1",
                params![parent_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|error| format!("检查分类层级失败: {}", error))?
            .flatten();
    }

    Ok(false)
}

fn next_category_sort_order(
    connection: &Connection,
    parent_id: Option<&str>,
) -> Result<i64, String> {
    match parent_id {
        Some(parent_id) => connection
            .query_row(
                "select coalesce(max(sort_order), 0) + 1
                 from categories
                 where parent_id = ?1 and is_system = 0",
                params![parent_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("计算分类排序失败: {}", error)),
        None => connection
            .query_row(
                "select coalesce(max(sort_order), 0) + 1
                 from categories
                 where parent_id is null and is_system = 0",
                [],
                |row| row.get(0),
            )
            .map_err(|error| format!("计算分类排序失败: {}", error)),
    }
}

fn sort_clause(sort_by: Option<&str>, direction: Option<&str>) -> String {
    let column = match sort_by.unwrap_or("importedAt") {
        "title" => "lower(p.title)",
        "year" => "coalesce(p.year, '')",
        "author" => "lower(coalesce(first_author.name, ''))",
        "updatedAt" => "p.updated_at",
        "lastReadAt" => "coalesce(p.last_read_at, 0)",
        _ => "p.imported_at",
    };
    let direction = if direction.unwrap_or("desc").eq_ignore_ascii_case("asc") {
        "asc"
    } else {
        "desc"
    };

    format!("{} {}, lower(p.title) asc", column, direction)
}

fn list_papers_inner(
    connection: &Connection,
    request: ListPapersRequest,
) -> Result<Vec<LiteraturePaper>, String> {
    let mut joins = String::from(
        "left join (
       select pa.paper_id, a.name
       from paper_authors pa
       join authors a on a.id = pa.author_id
       where pa.sort_order = 0
     ) first_author on first_author.paper_id = p.id",
    );
    let mut filters = Vec::new();
    let mut values = Vec::<Value>::new();

    if let Some(category_id) = request
        .category_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        let system_key = category_system_key(connection, category_id)?;

        match system_key.as_deref() {
            Some(SYSTEM_CATEGORY_ALL) | Some(SYSTEM_CATEGORY_RECENT) => {}
            Some(SYSTEM_CATEGORY_UNCATEGORIZED) => {
                filters.push(
                    "not exists (select 1 from paper_categories pc where pc.paper_id = p.id)"
                        .to_string(),
                );
            }
            Some(SYSTEM_CATEGORY_FAVORITES) => {
                filters.push("p.is_favorite = 1".to_string());
            }
            _ => {
                filters.push(
          "exists (select 1 from paper_categories pc where pc.paper_id = p.id and pc.category_id = ?)"
            .to_string(),
        );
                values.push(Value::Text(category_id.to_string()));
            }
        }
    }

    if let Some(tag_id) = request.tag_id.as_deref().filter(|value| !value.is_empty()) {
        joins.push_str(" join paper_tags filter_tag on filter_tag.paper_id = p.id");
        filters.push("filter_tag.tag_id = ?".to_string());
        values.push(Value::Text(tag_id.to_string()));
    }

    if let Some(search) = request
        .search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let like = format!("%{}%", search);

        filters.push(
      "(p.title like ? or p.abstract_text like ? or p.keywords like ? or p.doi like ? or exists (
          select 1 from paper_authors spa
          join authors sa on sa.id = spa.author_id
          where spa.paper_id = p.id and sa.name like ?
        ))"
        .to_string(),
    );
        values.push(Value::Text(like.clone()));
        values.push(Value::Text(like.clone()));
        values.push(Value::Text(like.clone()));
        values.push(Value::Text(like.clone()));
        values.push(Value::Text(like));
    }

    let where_clause = if filters.is_empty() {
        String::new()
    } else {
        format!(" where {}", filters.join(" and "))
    };
    let limit = request.limit.unwrap_or(300).clamp(1, 1_000);
    let query = format!(
        "select p.id
     from papers p
     {}
     {}
     order by {}
     limit {}",
        joins,
        where_clause,
        sort_clause(
            request.sort_by.as_deref(),
            request.sort_direction.as_deref()
        ),
        limit
    );
    let mut statement = connection
        .prepare(&query)
        .map_err(|error| format!("准备文献列表查询失败: {}", error))?;
    let rows = statement
        .query_map(params_from_iter(values.iter()), |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| format!("查询文献列表失败: {}", error))?;
    let ids = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取文献列表失败: {}", error))?;
    let mut papers = Vec::new();

    for id in ids {
        if let Some(paper) = load_paper_by_id(connection, &id)? {
            papers.push(paper);
        }
    }

    Ok(papers)
}

fn import_single_pdf(
    connection: &Connection,
    settings: &LibrarySettings,
    path: &str,
    target_category_id: Option<&str>,
    import_mode: &str,
    metadata: Option<&ImportPdfMetadata>,
) -> Result<ImportedPdfResult, String> {
    let source_path = PathBuf::from(path);
    ensure_pdf_path(&source_path)?;

    let file_metadata = fs::metadata(&source_path)
        .map_err(|error| format!("读取 PDF 文件信息失败 {}: {}", source_path.display(), error))?;
    let file_size = file_metadata.len().min(i64::MAX as u64) as i64;
    let content_hash = fnv1a_file_hash(&source_path)?;

    if let Some(existing_paper_id) = existing_paper_by_hash(connection, &content_hash, file_size)? {
        insert_import_record(
            connection,
            Some(path),
            None,
            Some(&existing_paper_id),
            "duplicate",
            "检测到重复 PDF，已跳过导入",
        )?;

        return Ok(ImportedPdfResult {
            source_path: path.to_string(),
            paper: load_paper_by_id(connection, &existing_paper_id)?,
            duplicated: true,
            existing_paper_id: Some(existing_paper_id),
            status: "duplicate".to_string(),
            message: "检测到重复 PDF，已跳过导入".to_string(),
        });
    }

    let title = metadata
        .and_then(|value| value.title.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| title_from_path(&source_path));
    let keywords = normalize_keywords(metadata.and_then(|value| value.keywords.clone()));
    let paper_id = new_id("paper");
    let attachment_id = new_id("att");
    let now = now_millis();
    let storage_dir = PathBuf::from(&settings.storage_dir);
    let normalized_import_mode = normalize_import_mode(import_mode)?;
    let target_path = if normalized_import_mode == "keep" {
        source_path.clone()
    } else {
        if settings.storage_dir.trim().is_empty() {
            return Err("请先在设置中配置默认文献存储文件夹".to_string());
        }

        fs::create_dir_all(&storage_dir).map_err(|error| {
            format!(
                "无法创建文献存储文件夹 {}: {}",
                storage_dir.display(),
                error
            )
        })?;

        let file_name = build_target_file_name(&source_path, settings, metadata, &title);
        let target_path = unique_target_path(&storage_dir, &file_name);

        if normalized_import_mode == "move" {
            fs::rename(&source_path, &target_path).map_err(|error| {
                format!(
                    "移动 PDF 到文献库失败 {} -> {}: {}",
                    source_path.display(),
                    target_path.display(),
                    error
                )
            })?;
        } else {
            fs::copy(&source_path, &target_path).map_err(|error| {
                format!(
                    "复制 PDF 到文献库失败 {} -> {}: {}",
                    source_path.display(),
                    target_path.display(),
                    error
                )
            })?;
        }

        target_path
    };
    let stored_path_string = path_to_string(target_path.clone())?;
    let original_path = if settings.preserve_original_path {
        Some(path.to_string())
    } else {
        None
    };
    let relative_path = relative_path_if_possible(&target_path, &storage_dir);
    let file_name = target_path
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| format!("{}.pdf", sanitize_filename_part(&title)));

    connection
        .execute(
            "insert into papers
       (id, title, year, publication, doi, url, abstract_text, keywords,
        imported_at, updated_at, last_read_at, reading_progress, is_favorite,
        user_note, ai_summary, citation, source)
       values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, null, 0, 0, null, null, null, 'local')",
            params![
                paper_id,
                title,
                metadata.and_then(|value| value.year.as_deref()),
                metadata.and_then(|value| value.publication.as_deref()),
                metadata.and_then(|value| value.doi.as_deref()),
                metadata.and_then(|value| value.url.as_deref()),
                metadata.and_then(|value| value.abstract_text.as_deref()),
                keywords_to_json(&keywords)?,
                now
            ],
        )
        .map_err(|error| format!("写入文献失败: {}", error))?;

    connection
        .execute(
            "insert into attachments
       (id, paper_id, kind, original_path, stored_path, relative_path, file_name,
        mime_type, file_size, content_hash, created_at, missing)
       values (?1, ?2, 'pdf', ?3, ?4, ?5, ?6, 'application/pdf', ?7, ?8, ?9, 0)",
            params![
                attachment_id,
                paper_id,
                original_path,
                stored_path_string,
                relative_path,
                file_name,
                file_size,
                content_hash,
                now
            ],
        )
        .map_err(|error| format!("写入 PDF 附件失败: {}", error))?;

    if let Some(authors) = metadata.and_then(|value| value.authors.as_ref()) {
        insert_authors(connection, &paper_id, authors)?;
    }

    insert_category_relation(connection, &paper_id, target_category_id)?;
    insert_import_record(
        connection,
        Some(path),
        Some(&stored_path_string),
        Some(&paper_id),
        "imported",
        "PDF 已导入文献库",
    )?;

    Ok(ImportedPdfResult {
        source_path: path.to_string(),
        paper: load_paper_by_id(connection, &paper_id)?,
        duplicated: false,
        existing_paper_id: None,
        status: "imported".to_string(),
        message: "PDF 已导入文献库".to_string(),
    })
}

#[tauri::command]
pub fn library_select_pdf_files() -> Result<Option<Vec<String>>, String> {
    FileDialog::new()
        .add_filter("PDF", &["pdf"])
        .pick_files()
        .map(|paths| {
            paths
                .into_iter()
                .map(path_to_string)
                .collect::<Result<Vec<_>, String>>()
        })
        .transpose()
}

#[tauri::command]
pub fn library_init(app: AppHandle) -> Result<LibrarySnapshot, String> {
    let connection = open_library_connection(&app)?;
    let settings = load_library_settings(&connection, &app)?;
    let categories = library_list_categories(app.clone())?;
    let papers = list_papers_inner(
        &connection,
        ListPapersRequest {
            category_id: category_id_for_system_key(&connection, SYSTEM_CATEGORY_RECENT)?,
            tag_id: None,
            search: None,
            sort_by: Some("importedAt".to_string()),
            sort_direction: Some("desc".to_string()),
            limit: Some(50),
        },
    )?;

    Ok(LibrarySnapshot {
        settings,
        categories,
        papers,
    })
}

#[tauri::command]
pub fn library_get_settings(app: AppHandle) -> Result<LibrarySettings, String> {
    let connection = open_library_connection(&app)?;
    load_library_settings(&connection, &app)
}

#[tauri::command]
pub fn library_update_settings(
    app: AppHandle,
    settings: LibrarySettings,
) -> Result<LibrarySettings, String> {
    let connection = open_library_connection(&app)?;
    let normalized = LibrarySettings {
        storage_dir: settings.storage_dir.trim().to_string(),
        zotero_local_data_dir: settings.zotero_local_data_dir.trim().to_string(),
        import_mode: normalize_import_mode(&settings.import_mode)?,
        auto_rename_files: settings.auto_rename_files,
        file_naming_rule: if settings.file_naming_rule.trim().is_empty() {
            "{firstAuthor}_{year}_{title}.pdf".to_string()
        } else {
            settings.file_naming_rule.trim().to_string()
        },
        create_category_folders: settings.create_category_folders,
        folder_watch_enabled: settings.folder_watch_enabled,
        backup_enabled: settings.backup_enabled,
        preserve_original_path: settings.preserve_original_path,
    };

    if !normalized.storage_dir.is_empty() {
        fs::create_dir_all(&normalized.storage_dir).map_err(|error| {
            format!(
                "无法创建文献存储文件夹 {}: {}",
                normalized.storage_dir, error
            )
        })?;
    }

    save_library_settings(&connection, &normalized)?;
    Ok(normalized)
}

#[tauri::command]
pub fn library_list_categories(app: AppHandle) -> Result<Vec<LiteratureCategory>, String> {
    let connection = open_library_connection(&app)?;
    let mut statement = connection
    .prepare(
      "select c.id, c.name, c.parent_id, c.sort_order, c.is_system, c.system_key,
              c.created_at, c.updated_at,
              case
                when c.system_key = 'all' then (select count(*) from papers)
                when c.system_key = 'recent' then (select count(*) from papers)
                when c.system_key = 'uncategorized' then (
                  select count(*) from papers p
                  where not exists (select 1 from paper_categories pc where pc.paper_id = p.id)
                )
                when c.system_key = 'favorites' then (select count(*) from papers where is_favorite = 1)
                else (
                  select count(*) from paper_categories pc where pc.category_id = c.id
                )
              end as paper_count
       from categories c
       order by c.is_system desc, c.parent_id is not null asc, c.sort_order asc, lower(c.name) asc",
    )
    .map_err(|error| format!("准备分类查询失败: {}", error))?;
    let rows = statement
        .query_map([], |row| {
            Ok(LiteratureCategory {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                sort_order: row.get(3)?,
                is_system: row.get::<_, i64>(4)? != 0,
                system_key: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                paper_count: row.get(8)?,
            })
        })
        .map_err(|error| format!("查询分类失败: {}", error))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取分类失败: {}", error))
}

#[tauri::command]
pub fn library_create_category(
    app: AppHandle,
    request: CreateCategoryRequest,
) -> Result<LiteratureCategory, String> {
    let connection = open_library_connection(&app)?;
    let name = request.name.trim();

    if name.is_empty() {
        return Err("分类名称不能为空".to_string());
    }

    if let Some(parent_id) = request.parent_id.as_deref() {
        let is_system: Option<i64> = connection
            .query_row(
                "select is_system from categories where id = ?1 limit 1",
                params![parent_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("查询父分类失败: {}", error))?;

        if is_system.unwrap_or(0) != 0 {
            return Err("系统分类下面不能创建子分类".to_string());
        }
    }

    let sort_order: i64 = connection
    .query_row(
      "select coalesce(max(sort_order), 0) + 1 from categories where parent_id is ?1 and is_system = 0",
      params![request.parent_id.as_deref()],
      |row| row.get(0),
    )
    .unwrap_or(1);
    let id = new_id("cat");
    let now = now_millis();

    connection
        .execute(
            "insert into categories
       (id, name, parent_id, sort_order, is_system, system_key, created_at, updated_at)
       values (?1, ?2, ?3, ?4, 0, null, ?5, ?5)",
            params![id, name, request.parent_id, sort_order, now],
        )
        .map_err(|error| format!("创建分类失败: {}", error))?;

    library_list_categories(app)?
        .into_iter()
        .find(|category| category.id == id)
        .ok_or_else(|| "分类已创建，但重新读取失败".to_string())
}

#[tauri::command]
pub fn library_update_category(
    app: AppHandle,
    request: UpdateCategoryRequest,
) -> Result<LiteratureCategory, String> {
    let connection = open_library_connection(&app)?;
    let is_system: i64 = connection
        .query_row(
            "select is_system from categories where id = ?1 limit 1",
            params![request.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("查询分类失败: {}", error))?
        .ok_or_else(|| "分类不存在".to_string())?;

    if is_system != 0 {
        return Err("系统分类不能修改".to_string());
    }

    if let Some(parent_id) = request.parent_id.as_deref() {
        if parent_id == request.id {
            return Err("分类不能移动到自身下面".to_string());
        }

        let parent_is_system: i64 = connection
            .query_row(
                "select is_system from categories where id = ?1 limit 1",
                params![parent_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("查询父分类失败: {}", error))?
            .unwrap_or(0);

        if parent_is_system != 0 {
            return Err("不能移动到系统分类下面".to_string());
        }
    }

    let current = connection
        .query_row(
            "select name, parent_id, sort_order from categories where id = ?1 limit 1",
            params![request.id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .map_err(|error| format!("读取分类失败: {}", error))?;
    let next_name = request
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&current.0)
        .to_string();
    let next_parent_id = request.parent_id.or(current.1);
    let next_sort_order = request.sort_order.unwrap_or(current.2);

    connection
        .execute(
            "update categories
       set name = ?1, parent_id = ?2, sort_order = ?3, updated_at = ?4
       where id = ?5",
            params![
                next_name,
                next_parent_id,
                next_sort_order,
                now_millis(),
                request.id
            ],
        )
        .map_err(|error| format!("更新分类失败: {}", error))?;

    library_list_categories(app)?
        .into_iter()
        .find(|category| category.id == request.id)
        .ok_or_else(|| "分类已更新，但重新读取失败".to_string())
}

#[tauri::command]
pub fn library_move_category(
    app: AppHandle,
    request: MoveCategoryRequest,
) -> Result<LiteratureCategory, String> {
    let connection = open_library_connection(&app)?;
    let category_id = request.category_id.trim();
    let parent_id = request
        .parent_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if category_id.is_empty() {
        return Err("分类 ID 不能为空".to_string());
    }

    if !category_exists(&connection, category_id)? {
        return Err("分类不存在".to_string());
    }

    if category_is_system(&connection, category_id)? {
        return Err("系统分类不能移动".to_string());
    }

    if let Some(next_parent_id) = parent_id {
        if next_parent_id == category_id {
            return Err("分类不能移动到自身下面".to_string());
        }

        if !category_exists(&connection, next_parent_id)? {
            return Err("目标父分类不存在".to_string());
        }

        if category_is_system(&connection, next_parent_id)? {
            return Err("不能移动到系统分类下面".to_string());
        }

        if would_create_category_cycle(&connection, category_id, Some(next_parent_id))? {
            return Err("不能把分类移动到自己的子分类下面".to_string());
        }
    }

    let sort_order = request
        .sort_order
        .unwrap_or(next_category_sort_order(&connection, parent_id)?);

    connection
        .execute(
            "update categories
             set parent_id = ?1, sort_order = ?2, updated_at = ?3
             where id = ?4",
            params![parent_id, sort_order, now_millis(), category_id],
        )
        .map_err(|error| format!("移动分类失败: {}", error))?;

    library_list_categories(app)?
        .into_iter()
        .find(|category| category.id == category_id)
        .ok_or_else(|| "分类已移动，但重新读取失败".to_string())
}

#[tauri::command]
pub fn library_delete_category(app: AppHandle, category_id: String) -> Result<(), String> {
    let connection = open_library_connection(&app)?;
    let is_system: i64 = connection
        .query_row(
            "select is_system from categories where id = ?1 limit 1",
            params![category_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("查询分类失败: {}", error))?
        .ok_or_else(|| "分类不存在".to_string())?;

    if is_system != 0 {
        return Err("系统分类不能删除".to_string());
    }

    connection
        .execute("delete from categories where id = ?1", params![category_id])
        .map_err(|error| format!("删除分类失败: {}", error))?;

    Ok(())
}

#[tauri::command]
pub fn library_list_papers(
    app: AppHandle,
    request: ListPapersRequest,
) -> Result<Vec<LiteraturePaper>, String> {
    let connection = open_library_connection(&app)?;
    list_papers_inner(&connection, request)
}

#[tauri::command]
pub fn library_import_pdfs(
    app: AppHandle,
    request: ImportPdfRequest,
) -> Result<Vec<ImportedPdfResult>, String> {
    let connection = open_library_connection(&app)?;
    let settings = load_library_settings(&connection, &app)?;
    let import_mode = request
        .import_mode
        .as_deref()
        .unwrap_or(settings.import_mode.as_str());
    let mut results = Vec::new();

    if request.paths.is_empty() {
        return Ok(results);
    }

    for path in request.paths {
        let metadata = request.metadata.as_ref().and_then(|items| items.get(&path));
        let result = import_single_pdf(
            &connection,
            &settings,
            &path,
            request.target_category_id.as_deref(),
            import_mode,
            metadata,
        )
        .unwrap_or_else(|error| {
            let _ = insert_import_record(&connection, Some(&path), None, None, "failed", &error);

            ImportedPdfResult {
                source_path: path,
                paper: None,
                duplicated: false,
                existing_paper_id: None,
                status: "failed".to_string(),
                message: error,
            }
        });

        results.push(result);
    }

    Ok(results)
}

#[tauri::command]
pub fn library_assign_paper_category(
    app: AppHandle,
    request: AssignPaperCategoryRequest,
) -> Result<LiteraturePaper, String> {
    let connection = open_library_connection(&app)?;

    if request.paper_id.trim().is_empty() {
        return Err("文献 ID 不能为空".to_string());
    }

    insert_category_relation(
        &connection,
        request.paper_id.trim(),
        Some(request.category_id.trim()),
    )?;

    load_paper_by_id(&connection, request.paper_id.trim())?.ok_or_else(|| "文献不存在".to_string())
}

#[tauri::command]
pub fn library_update_paper(
    app: AppHandle,
    request: UpdatePaperRequest,
) -> Result<LiteraturePaper, String> {
    let connection = open_library_connection(&app)?;
    let paper_id = request.paper_id.trim();

    if paper_id.is_empty() {
        return Err("文献 ID 不能为空".to_string());
    }

    let current = load_paper_by_id(&connection, paper_id)?
        .ok_or_else(|| "文献不存在，无法更新".to_string())?;
    let title = request
        .title
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or(current.title);
    let year = merge_nullable_string(request.year, current.year);
    let publication = merge_nullable_string(request.publication, current.publication);
    let doi = merge_nullable_string(request.doi, current.doi);
    let url = merge_nullable_string(request.url, current.url);
    let abstract_text = merge_nullable_string(request.abstract_text, current.abstract_text);
    let user_note = merge_nullable_string(request.user_note, current.user_note);
    let ai_summary = merge_nullable_string(request.ai_summary, current.ai_summary);
    let citation = merge_nullable_string(request.citation, current.citation);
    let is_favorite = request.is_favorite.unwrap_or(current.is_favorite);
    let keywords = request
        .keywords
        .map(|items| normalize_keywords(Some(items)))
        .unwrap_or(current.keywords);

    connection
        .execute(
            "update papers
             set title = ?1,
                 year = ?2,
                 publication = ?3,
                 doi = ?4,
                 url = ?5,
                 abstract_text = ?6,
                 keywords = ?7,
                 user_note = ?8,
                 ai_summary = ?9,
                 citation = ?10,
                 is_favorite = ?11,
                 updated_at = ?12
             where id = ?13",
            params![
                title,
                year,
                publication,
                doi,
                url,
                abstract_text,
                keywords_to_json(&keywords)?,
                user_note,
                ai_summary,
                citation,
                if is_favorite { 1 } else { 0 },
                now_millis(),
                paper_id
            ],
        )
        .map_err(|error| format!("更新文献失败: {}", error))?;

    if let Some(authors) = request.authors {
        replace_authors(&connection, paper_id, &authors)?;
    }

    if let Some(tags) = request.tags {
        replace_tags(&connection, paper_id, &tags)?;
    }

    load_paper_by_id(&connection, paper_id)?.ok_or_else(|| "文献已更新，但重新读取失败".to_string())
}

#[tauri::command]
pub fn library_delete_paper(app: AppHandle, request: DeletePaperRequest) -> Result<(), String> {
    let connection = open_library_connection(&app)?;
    let paper_id = request.paper_id.trim();

    if paper_id.is_empty() {
        return Err("文献 ID 不能为空".to_string());
    }

    let affected = connection
        .execute("delete from papers where id = ?1", params![paper_id])
        .map_err(|error| format!("删除文献记录失败: {}", error))?;

    if affected == 0 {
        return Err("文献不存在，无法删除".to_string());
    }

    Ok(())
}

#[tauri::command]
pub fn library_relocate_attachment(
    app: AppHandle,
    request: RelocateAttachmentRequest,
) -> Result<LiteratureAttachment, String> {
    let connection = open_library_connection(&app)?;
    let path = PathBuf::from(&request.new_path);
    ensure_pdf_path(&path)?;

    let metadata = fs::metadata(&path)
        .map_err(|error| format!("读取新文件信息失败 {}: {}", path.display(), error))?;
    let file_size = metadata.len().min(i64::MAX as u64) as i64;
    let content_hash = fnv1a_file_hash(&path)?;
    let stored_path = path_to_string(path.clone())?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| "paper.pdf".to_string());

    connection
        .execute(
            "update attachments
       set stored_path = ?1, file_name = ?2, file_size = ?3, content_hash = ?4, missing = 0
       where id = ?5",
            params![
                stored_path,
                file_name,
                file_size,
                content_hash,
                request.attachment_id
            ],
        )
        .map_err(|error| format!("重新定位附件失败: {}", error))?;

    connection
        .query_row(
            "select id, paper_id, kind, original_path, stored_path, relative_path, file_name,
              mime_type, file_size, content_hash, created_at, missing
       from attachments
       where id = ?1
       limit 1",
            params![request.attachment_id],
            map_attachment_row,
        )
        .map_err(|error| format!("读取重新定位后的附件失败: {}", error))
}

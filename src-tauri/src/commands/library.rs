use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) mod categories;
pub(crate) mod import;
mod models;
pub(crate) mod papers;
mod schema;
mod settings;

pub use models::*;

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::commands::rag::{migrate_rag_schema, register_sqlite_vec_once};

use categories::{category_id_for_system_key, library_list_categories};
use papers::list_papers_inner;
use schema::{migrate_library_schema, seed_system_categories};
use settings::{load_library_settings, save_library_settings, seed_default_settings};

#[cfg(test)]
use import::import_single_pdf;
#[cfg(test)]
use papers::recent_import_count;

static NEXT_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

const SYSTEM_CATEGORY_ALL: &str = "all";
const SYSTEM_CATEGORY_RECENT: &str = "recent";
const SYSTEM_CATEGORY_UNCATEGORIZED: &str = "uncategorized";
const SYSTEM_CATEGORY_FAVORITES: &str = "favorites";
const RECENT_IMPORT_LIMIT: i64 = 50;

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    use rusqlite::params;

    fn test_connection() -> Connection {
        register_sqlite_vec_once();
        let connection = Connection::open_in_memory().expect("open sqlite");
        migrate_library_schema(&connection).expect("migrate");
        migrate_rag_schema(&connection).expect("migrate rag");
        seed_system_categories(&connection).expect("seed categories");
        connection
    }

    fn unique_temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "paperquay-library-tests-{}-{}",
            label,
            now_millis()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn write_test_pdf(path: &Path) {
        fs::write(
            path,
            b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF",
        )
        .expect("write test pdf");
    }

    #[test]
    fn recent_category_returns_only_latest_imports() {
        let connection = test_connection();

        for index in 0..(RECENT_IMPORT_LIMIT + 5) {
            connection
                .execute(
                    "insert into papers
                     (id, title, keywords, imported_at, updated_at, reading_progress, is_favorite, source, sort_order)
                     values (?1, ?2, '[]', ?3, ?3, 0, 0, 'local', 0)",
                    params![
                        format!("paper-{}", index),
                        format!("Paper {}", index),
                        index as i64
                    ],
                )
                .expect("insert paper");
        }

        let recent_papers = list_papers_inner(
            &connection,
            ListPapersRequest {
                category_id: Some("system-recent".to_string()),
                tag_id: None,
                search: None,
                sort_by: None,
                sort_direction: None,
                limit: Some(200),
            },
        )
        .expect("list recent papers");

        assert_eq!(recent_papers.len() as i64, RECENT_IMPORT_LIMIT);
        assert_eq!(
            recent_papers.first().map(|paper| paper.title.as_str()),
            Some("Paper 54")
        );
        assert_eq!(
            recent_papers.last().map(|paper| paper.title.as_str()),
            Some("Paper 5")
        );

        assert_eq!(
            recent_import_count(&connection).expect("count recent papers"),
            RECENT_IMPORT_LIMIT
        );
    }

    #[test]
    fn move_import_rolls_back_file_and_database_on_failure() {
        let mut connection = test_connection();
        let root_dir = unique_temp_dir("import-rollback");
        let source_path = root_dir.join("source.pdf");
        let storage_dir = root_dir.join("library");
        write_test_pdf(&source_path);

        let settings = LibrarySettings {
            storage_dir: storage_dir.to_string_lossy().into_owned(),
            zotero_local_data_dir: String::new(),
            import_mode: "move".to_string(),
            auto_rename_files: true,
            file_naming_rule: "{title}.pdf".to_string(),
            create_category_folders: false,
            folder_watch_enabled: false,
            backup_enabled: false,
            preserve_original_path: true,
        };

        let error = import_single_pdf(
            &mut connection,
            &settings,
            source_path.to_string_lossy().as_ref(),
            Some("missing-category"),
            "move",
            None,
        )
        .expect_err("import should fail");

        assert!(error.contains("分类") || error.contains("category") || error.contains("FOREIGN"));
        assert!(
            source_path.exists(),
            "source file should be restored after rollback"
        );
        assert_eq!(
            fs::read_dir(&storage_dir)
                .ok()
                .map(|entries| entries.filter_map(Result::ok).count())
                .unwrap_or(0),
            0,
            "storage directory should not keep staged or target files after rollback"
        );

        let paper_count: i64 = connection
            .query_row("select count(*) from papers", [], |row| row.get(0))
            .expect("count papers");
        let attachment_count: i64 = connection
            .query_row("select count(*) from attachments", [], |row| row.get(0))
            .expect("count attachments");
        assert_eq!(paper_count, 0);
        assert_eq!(attachment_count, 0);
    }
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

pub(crate) fn open_library_connection(app: &AppHandle) -> Result<Connection, String> {
    register_sqlite_vec_once();
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
    migrate_rag_schema(&connection)?;
    seed_system_categories(&connection)?;
    seed_default_settings(&connection, app)?;

    Ok(connection)
}

fn normalize_import_mode(value: &str) -> Result<String, String> {
    match value.trim() {
        "copy" | "move" | "keep" => Ok(value.trim().to_string()),
        other => Err(format!("不支持的导入模式: {}", other)),
    }
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

#[tauri::command]
pub fn library_init(app: AppHandle) -> Result<LibrarySnapshot, String> {
    let connection = open_library_connection(&app)?;
    let settings = load_library_settings(&connection, &app)?;
    let categories = library_list_categories(app.clone())?;
    let papers = list_papers_inner(
        &connection,
        ListPapersRequest {
            category_id: category_id_for_system_key(&connection, SYSTEM_CATEGORY_ALL)?,
            tag_id: None,
            search: None,
            sort_by: Some("manual".to_string()),
            sort_direction: Some("asc".to_string()),
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

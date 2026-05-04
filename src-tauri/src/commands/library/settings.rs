use rusqlite::{params, Connection, OptionalExtension};
use tauri::AppHandle;

use super::{default_storage_dir, normalize_import_mode, now_millis, LibrarySettings};

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

pub(crate) fn load_library_settings(
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

pub(crate) fn save_library_settings(
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
    save_setting(connection, "backup_enabled", settings.backup_enabled.to_string())?;
    save_setting(
        connection,
        "preserve_original_path",
        settings.preserve_original_path.to_string(),
    )?;

    Ok(())
}

pub(crate) fn seed_default_settings(
    connection: &Connection,
    app: &AppHandle,
) -> Result<(), String> {
    let settings = default_library_settings(app)?;
    let existing_count: i64 = connection
        .query_row("select count(*) from app_settings", [], |row| row.get(0))
        .map_err(|error| format!("读取文献库设置失败: {}", error))?;

    if existing_count == 0 {
        save_library_settings(connection, &settings)?;
    }

    Ok(())
}

use std::fs;
use std::path::{Path, PathBuf};

use rfd::FileDialog;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::AppHandle;

use super::papers::{
    insert_authors, insert_category_relation, load_paper_by_id, next_paper_sort_order,
};
use super::settings::load_library_settings;
use super::{
    keywords_to_json, new_id, normalize_import_mode, normalize_keywords, now_millis,
    open_library_connection, path_to_string, ImportPdfMetadata, ImportPdfRequest,
    ImportedPdfResult, LibrarySettings,
};

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

fn unique_staged_target_path(final_path: &Path) -> PathBuf {
    let file_name = final_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("paper.pdf");

    let staged_name = format!("{}.paperquay-importing", file_name);
    let parent = final_path.parent().unwrap_or_else(|| Path::new("."));

    unique_target_path(parent, &staged_name)
}

struct StagedImportFile {
    import_mode: String,
    source_path: PathBuf,
    staged_path: PathBuf,
    final_path: PathBuf,
    activated: bool,
    completed: bool,
}

impl StagedImportFile {
    fn prepare(import_mode: &str, source_path: &Path, final_path: PathBuf) -> Result<Self, String> {
        let staged_path = unique_staged_target_path(&final_path);

        if import_mode == "move" {
            fs::rename(source_path, &staged_path).map_err(|error| {
                format!(
                    "移动 PDF 到导入暂存区失败 {} -> {}: {}",
                    source_path.display(),
                    staged_path.display(),
                    error
                )
            })?;
        } else {
            fs::copy(source_path, &staged_path).map_err(|error| {
                format!(
                    "复制 PDF 到导入暂存区失败 {} -> {}: {}",
                    source_path.display(),
                    staged_path.display(),
                    error
                )
            })?;
        }

        Ok(Self {
            import_mode: import_mode.to_string(),
            source_path: source_path.to_path_buf(),
            staged_path,
            final_path,
            activated: false,
            completed: false,
        })
    }

    fn activate(&mut self) -> Result<(), String> {
        fs::rename(&self.staged_path, &self.final_path).map_err(|error| {
            format!(
                "将暂存 PDF 提交到文献库失败 {} -> {}: {}",
                self.staged_path.display(),
                self.final_path.display(),
                error
            )
        })?;
        self.activated = true;
        Ok(())
    }

    fn rollback(&self) {
        if self.import_mode == "move" {
            let rollback_source = if self.activated {
                &self.final_path
            } else {
                &self.staged_path
            };

            if rollback_source.exists() && !self.source_path.exists() {
                let _ = fs::rename(rollback_source, &self.source_path);
            }
        } else {
            let rollback_source = if self.activated {
                &self.final_path
            } else {
                &self.staged_path
            };

            if rollback_source.exists() {
                let _ = fs::remove_file(rollback_source);
            }
        }
    }

    fn finish(&mut self) {
        self.completed = true;
    }
}

impl Drop for StagedImportFile {
    fn drop(&mut self) {
        if !self.completed {
            self.rollback();
        }
    }
}

pub(crate) fn fnv1a_file_hash(path: &Path) -> Result<String, String> {
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

pub(crate) fn ensure_pdf_path(path: &Path) -> Result<(), String> {
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

pub(crate) fn import_single_pdf(
    connection: &mut Connection,
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
    let sort_order = next_paper_sort_order(connection)?;
    let storage_dir = PathBuf::from(&settings.storage_dir);
    let normalized_import_mode = normalize_import_mode(import_mode)?;
    let mut staged_file = None;
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
        staged_file = Some(StagedImportFile::prepare(
            normalized_import_mode.as_str(),
            &source_path,
            target_path.clone(),
        )?);

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
    let transaction = connection
        .transaction()
        .map_err(|error| format!("开启 PDF 导入事务失败: {}", error))?;

    transaction
        .execute(
            "insert into papers
       (id, title, year, publication, doi, url, abstract_text, keywords,
        imported_at, updated_at, last_read_at, reading_progress, is_favorite,
        user_note, ai_summary, citation, source, sort_order)
       values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, null, 0, 0, null, null, null, 'local', ?10)",
            params![
                paper_id,
                title,
                metadata.and_then(|value| value.year.as_deref()),
                metadata.and_then(|value| value.publication.as_deref()),
                metadata.and_then(|value| value.doi.as_deref()),
                metadata.and_then(|value| value.url.as_deref()),
                metadata.and_then(|value| value.abstract_text.as_deref()),
                keywords_to_json(&keywords)?,
                now,
                sort_order
            ],
        )
        .map_err(|error| format!("写入文献失败: {}", error))?;

    transaction
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
        insert_authors(&transaction, &paper_id, authors)?;
    }

    insert_category_relation(&transaction, &paper_id, target_category_id)?;
    insert_import_record(
        &transaction,
        Some(path),
        Some(&stored_path_string),
        Some(&paper_id),
        "imported",
        "PDF 已导入文献库",
    )?;

    if let Some(staged_file) = staged_file.as_mut() {
        if let Err(error) = staged_file.activate() {
            staged_file.rollback();
            return Err(error);
        }
    }

    if let Err(error) = transaction.commit() {
        if let Some(staged_file) = staged_file.as_ref() {
            staged_file.rollback();
        }

        return Err(format!("提交 PDF 导入事务失败: {}", error));
    }

    if let Some(staged_file) = staged_file.as_mut() {
        staged_file.finish();
    }

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
pub fn library_import_pdfs(
    app: AppHandle,
    request: ImportPdfRequest,
) -> Result<Vec<ImportedPdfResult>, String> {
    let mut connection = open_library_connection(&app)?;
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
            &mut connection,
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

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT};
use rfd::FileDialog;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const ZOTERO_API_BASE: &str = "https://api.zotero.org";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroKeyInfo {
    user_id: String,
    username: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroListOptions {
    api_key: String,
    user_id: String,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroLocalListOptions {
    data_dir: Option<String>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroLocalCollectionItemsOptions {
    data_dir: Option<String>,
    collection_key: String,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroDownloadOptions {
    api_key: String,
    user_id: String,
    attachment_key: String,
    filename: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroRelatedNotesOptions {
    data_dir: Option<String>,
    item_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroLibraryItem {
    item_key: String,
    title: String,
    creators: String,
    year: String,
    item_type: String,
    attachment_key: Option<String>,
    attachment_title: Option<String>,
    attachment_filename: Option<String>,
    local_pdf_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroCollection {
    collection_key: String,
    name: String,
    parent_collection_key: Option<String>,
    item_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroDownloadResult {
    path: String,
    filename: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroRelatedNote {
    id: String,
    parent_item_key: String,
    title: String,
    kind: String,
    content: String,
    content_format: String,
    source_label: String,
    file_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ZoteroKeyResponse {
    user_id: Option<u64>,
    username: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct ZoteroApiItem {
    key: String,
    data: ZoteroItemData,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ZoteroItemData {
    item_type: Option<String>,
    title: Option<String>,
    creators: Option<Vec<ZoteroCreator>>,
    date: Option<String>,
    content_type: Option<String>,
    filename: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ZoteroCreator {
    first_name: Option<String>,
    last_name: Option<String>,
    name: Option<String>,
}

fn zotero_headers(api_key: &str) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();

    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    headers.insert("Zotero-API-Version", HeaderValue::from_static("3"));
    headers.insert(
        "Zotero-API-Key",
        HeaderValue::from_str(api_key.trim())
            .map_err(|error| format!("Zotero API Key 无效: {}", error))?,
    );

    Ok(headers)
}

fn zotero_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| format!("创建 Zotero HTTP 客户端失败: {}", error))
}

fn creator_name(creator: &ZoteroCreator) -> String {
    if let Some(name) = creator.name.as_deref() {
        return name.trim().to_string();
    }

    [creator.first_name.as_deref(), creator.last_name.as_deref()]
        .into_iter()
        .flatten()
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn creator_summary(creators: Option<&Vec<ZoteroCreator>>) -> String {
    let names = creators
        .map(|items| {
            items
                .iter()
                .map(creator_name)
                .filter(|name| !name.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    match names.as_slice() {
        [] => "未知作者".to_string(),
        [one] => one.clone(),
        [one, two] => format!("{}, {}", one, two),
        [one, ..] => format!("{} 等", one),
    }
}

fn year_from_date(date: Option<&String>) -> String {
    let Some(date) = date else {
        return "未知年份".to_string();
    };

    date.chars()
        .collect::<Vec<_>>()
        .windows(4)
        .find_map(|window| {
            let text = window.iter().collect::<String>();
            text.parse::<u16>().ok().map(|_| text)
        })
        .unwrap_or_else(|| "未知年份".to_string())
}

async fn parse_json_response<T: for<'de> Deserialize<'de>>(
    response: reqwest::Response,
    context: &str,
) -> Result<T, String> {
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取 {} 响应失败: {}", context, error))?;

    if !status.is_success() {
        return Err(format!("{} HTTP 状态异常: {} {}", context, status, text));
    }

    serde_json::from_str::<T>(&text)
        .map_err(|error| format!("解析 {} JSON 失败: {}; 原始响应: {}", context, error, text))
}

async fn load_pdf_child(
    client: &reqwest::Client,
    headers: HeaderMap,
    user_id: &str,
    item_key: &str,
) -> Result<Option<ZoteroApiItem>, String> {
    let endpoint = format!(
        "{}/users/{}/items/{}/children?format=json&limit=100",
        ZOTERO_API_BASE, user_id, item_key
    );
    let response = client
        .get(endpoint)
        .headers(headers)
        .send()
        .await
        .map_err(|error| format!("读取 Zotero 子附件失败: {}", error))?;
    let children = parse_json_response::<Vec<ZoteroApiItem>>(response, "Zotero 子附件列表").await?;

    Ok(children.into_iter().find(|child| {
        child.data.item_type.as_deref() == Some("attachment")
            && child.data.content_type.as_deref() == Some("application/pdf")
    }))
}

fn safe_pdf_filename(input: Option<String>, fallback_key: &str) -> String {
    let raw = input.unwrap_or_else(|| format!("{}.pdf", fallback_key));
    let sanitized = raw
        .chars()
        .map(|character| match character {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect::<String>();

    if sanitized.to_lowercase().ends_with(".pdf") {
        sanitized
    } else {
        format!("{}.pdf", sanitized)
    }
}

fn path_to_string(path: PathBuf) -> Result<String, String> {
    path.into_os_string()
        .into_string()
        .map_err(|_| "所选路径包含无法识别的字符".to_string())
}

fn candidate_local_zotero_dirs() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(profile) = std::env::var("USERPROFILE") {
        candidates.push(PathBuf::from(profile).join("Zotero"));
    }

    if let Ok(appdata) = std::env::var("APPDATA") {
        let profiles_dir = PathBuf::from(appdata)
            .join("Zotero")
            .join("Zotero")
            .join("Profiles");

        if let Ok(entries) = fs::read_dir(&profiles_dir) {
            for entry in entries.flatten() {
                candidates.push(entry.path());
            }
        }
    }

    candidates
}

fn resolve_local_zotero_data_dir(input: Option<String>) -> Result<PathBuf, String> {
    if let Some(path) = input {
        let data_dir = PathBuf::from(path);

        if data_dir.join("zotero.sqlite").is_file() {
            return Ok(data_dir);
        }

        return Err(format!(
            "目录中未找到 zotero.sqlite: {}",
            data_dir.display()
        ));
    }

    candidate_local_zotero_dirs()
        .into_iter()
        .find(|path| path.join("zotero.sqlite").is_file())
        .ok_or_else(|| {
            "没有找到本地 Zotero 数据目录，请手动选择包含 zotero.sqlite 的目录。".to_string()
        })
}

fn copy_sqlite_for_read(data_dir: &Path) -> Result<PathBuf, String> {
    let source = data_dir.join("zotero.sqlite");

    if !source.is_file() {
        return Err(format!("Zotero 数据库不存在: {}", source.display()));
    }

    let mut target = std::env::temp_dir();
    target.push("paper-reader-zotero");
    fs::create_dir_all(&target).map_err(|error| format!("创建 Zotero 临时目录失败: {}", error))?;
    target.push(format!(
        "zotero-read-{}.sqlite",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default()
    ));

    fs::copy(&source, &target).map_err(|error| {
        format!(
            "复制 Zotero 数据库到临时文件失败: {} ({})",
            error,
            source.display()
        )
    })?;

    Ok(target)
}

fn open_local_zotero_connection(
    input: Option<String>,
) -> Result<(Connection, PathBuf, PathBuf), String> {
    let data_dir = resolve_local_zotero_data_dir(input)?;
    let sqlite_copy = copy_sqlite_for_read(&data_dir)?;
    let connection = Connection::open(&sqlite_copy)
        .map_err(|error| format!("打开 Zotero 数据库失败: {}", error))?;

    Ok((connection, data_dir, sqlite_copy))
}

fn local_field_value(
    connection: &Connection,
    item_id: i64,
    field_name: &str,
) -> Result<Option<String>, String> {
    connection
        .query_row(
            "select idv.value
       from itemData id
       join fields f on f.fieldID = id.fieldID
       join itemDataValues idv on idv.valueID = id.valueID
       where id.itemID = ?1 and f.fieldName = ?2
       limit 1",
            params![item_id, field_name],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("读取 Zotero 字段失败: {}", error))
}

fn local_creator_summary(connection: &Connection, item_id: i64) -> Result<String, String> {
    let mut statement = connection
        .prepare(
            "select coalesce(c.firstName, ''), coalesce(c.lastName, '')
       from itemCreators ic
       join creators c on c.creatorID = ic.creatorID
       where ic.itemID = ?1
       order by ic.orderIndex asc",
        )
        .map_err(|error| format!("准备 Zotero 作者查询失败: {}", error))?;
    let names = statement
        .query_map(params![item_id], |row| {
            let first_name: String = row.get(0)?;
            let last_name: String = row.get(1)?;
            let name = [first_name.trim(), last_name.trim()]
                .into_iter()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" ");

            Ok(name)
        })
        .map_err(|error| format!("读取 Zotero 作者失败: {}", error))?
        .filter_map(Result::ok)
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();

    Ok(match names.as_slice() {
        [] => "未知作者".to_string(),
        [one] => one.clone(),
        [one, two] => format!("{}, {}", one, two),
        [one, ..] => format!("{} 等", one),
    })
}

fn resolve_local_attachment_path(
    data_dir: &Path,
    attachment_key: &str,
    raw_path: &str,
) -> Option<String> {
    let path = if let Some(filename) = raw_path.strip_prefix("storage:") {
        data_dir.join("storage").join(attachment_key).join(filename)
    } else {
        let candidate = PathBuf::from(raw_path);

        if candidate.is_absolute() {
            candidate
        } else {
            data_dir.join(candidate)
        }
    };

    path.is_file().then(|| path.to_string_lossy().into_owned())
}

fn build_local_library_item(
    connection: &Connection,
    data_dir: &Path,
    attachment_item_id: i64,
    attachment_key: String,
    parent_item_id: Option<i64>,
    raw_path: String,
    item_key: String,
    item_type: String,
) -> Result<ZoteroLibraryItem, String> {
    let metadata_item_id = parent_item_id.unwrap_or(attachment_item_id);
    let title = local_field_value(connection, metadata_item_id, "title")?
        .or_else(|| {
            local_field_value(connection, attachment_item_id, "title")
                .ok()
                .flatten()
        })
        .unwrap_or_else(|| "未命名 PDF".to_string());
    let date = local_field_value(connection, metadata_item_id, "date")?;
    let creators = local_creator_summary(connection, metadata_item_id)?;
    let local_pdf_path = resolve_local_attachment_path(data_dir, &attachment_key, &raw_path);
    let attachment_filename = raw_path
        .strip_prefix("storage:")
        .map(str::to_string)
        .or_else(|| {
            PathBuf::from(&raw_path)
                .file_name()
                .and_then(|name| name.to_str())
                .map(str::to_string)
        });

    Ok(ZoteroLibraryItem {
        item_key,
        title,
        creators,
        year: year_from_date(date.as_ref()),
        item_type,
        attachment_key: Some(attachment_key),
        attachment_title: None,
        attachment_filename,
        local_pdf_path,
    })
}

fn local_item_id_by_key(connection: &Connection, item_key: &str) -> Result<Option<i64>, String> {
    connection
        .query_row(
            "select itemID from items where key = ?1 limit 1",
            params![item_key],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| format!("查询 Zotero 条目失败: {}", error))
}

fn strip_html_tags(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut inside_tag = false;

    for character in input.chars() {
        match character {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag => output.push(character),
            _ => {}
        }
    }

    output
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_note_title(prefix: &str, content: &str) -> String {
    let plain = strip_html_tags(content);
    let snippet = plain.trim();

    if snippet.is_empty() {
        return prefix.to_string();
    }

    let mut title = String::new();

    for character in snippet.chars().take(28) {
        title.push(character);
    }

    if snippet.chars().count() > 28 {
        format!("{}：{}...", prefix, title)
    } else {
        format!("{}：{}", prefix, title)
    }
}

fn build_file_note_title(file_path: &str) -> String {
    PathBuf::from(file_path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "附件笔记".to_string())
}

fn read_text_file_lossy(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("读取 Zotero 附件文本失败: {} ({})", error, path.display()))?;

    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn load_related_note_items(
    connection: &Connection,
    parent_item_id: i64,
    parent_item_key: &str,
) -> Result<Vec<ZoteroRelatedNote>, String> {
    let mut statement = connection
        .prepare(
            "select noteItem.itemID, coalesce(itemNotes.note, '')
       from itemNotes
       join items noteItem on noteItem.itemID = itemNotes.itemID
       where itemNotes.parentItemID = ?1
       order by noteItem.dateModified desc",
        )
        .map_err(|error| format!("准备 Zotero 笔记查询失败: {}", error))?;
    let rows = statement
        .query_map(params![parent_item_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("查询 Zotero 笔记失败: {}", error))?;
    let mut notes = Vec::new();

    for row in rows {
        let (note_item_id, content) =
            row.map_err(|error| format!("读取 Zotero 笔记行失败: {}", error))?;

        if content.trim().is_empty() {
            continue;
        }

        notes.push(ZoteroRelatedNote {
            id: format!("note-{}", note_item_id),
            parent_item_key: parent_item_key.to_string(),
            title: build_note_title("Zotero 笔记", &content),
            kind: "zotero-note".to_string(),
            content,
            content_format: "html".to_string(),
            source_label: "Zotero 笔记".to_string(),
            file_path: None,
        });
    }

    Ok(notes)
}

fn load_related_file_notes(
    connection: &Connection,
    data_dir: &Path,
    parent_item_id: i64,
    parent_item_key: &str,
) -> Result<Vec<ZoteroRelatedNote>, String> {
    let mut statement = connection
        .prepare(
            "select attachment.key, ia.path, coalesce(ia.contentType, '')
       from itemAttachments ia
       join items attachment on attachment.itemID = ia.itemID
       where ia.parentItemID = ?1
         and ia.path is not null
         and (
           ia.contentType in ('text/markdown', 'text/plain')
           or lower(ia.path) like '%.md'
           or lower(ia.path) like '%.markdown'
           or lower(ia.path) like '%.txt'
           or lower(ia.path) like 'storage:%.md'
           or lower(ia.path) like 'storage:%.markdown'
           or lower(ia.path) like 'storage:%.txt'
         )
       order by attachment.dateModified desc",
        )
        .map_err(|error| format!("准备 Zotero Markdown 查询失败: {}", error))?;
    let rows = statement
        .query_map(params![parent_item_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| format!("查询 Zotero Markdown 附件失败: {}", error))?;
    let mut notes = Vec::new();

    for row in rows {
        let (attachment_key, raw_path, content_type) =
            row.map_err(|error| format!("读取 Zotero Markdown 行失败: {}", error))?;
        let Some(file_path) = resolve_local_attachment_path(data_dir, &attachment_key, &raw_path)
        else {
            continue;
        };
        let content = read_text_file_lossy(Path::new(&file_path))?;

        if content.trim().is_empty() {
            continue;
        }

        let lower_path = file_path.to_lowercase();
        let is_markdown = content_type == "text/markdown"
            || lower_path.ends_with(".md")
            || lower_path.ends_with(".markdown");

        notes.push(ZoteroRelatedNote {
            id: format!("attachment-{}", attachment_key),
            parent_item_key: parent_item_key.to_string(),
            title: build_file_note_title(&file_path),
            kind: if is_markdown {
                "markdown".to_string()
            } else {
                "text".to_string()
            },
            content,
            content_format: if is_markdown {
                "markdown".to_string()
            } else {
                "plain".to_string()
            },
            source_label: if is_markdown {
                "Zotero Markdown".to_string()
            } else {
                "Zotero 文本附件".to_string()
            },
            file_path: Some(file_path),
        });
    }

    Ok(notes)
}

#[tauri::command]
pub fn zotero_detect_local_data_dir() -> Result<Option<String>, String> {
    Ok(candidate_local_zotero_dirs()
        .into_iter()
        .find(|path| path.join("zotero.sqlite").is_file())
        .map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn zotero_select_local_data_dir() -> Result<Option<String>, String> {
    FileDialog::new()
        .set_title("选择 Zotero 本地数据目录（包含 zotero.sqlite）")
        .pick_folder()
        .map(path_to_string)
        .transpose()
}

#[tauri::command]
pub fn zotero_list_local_collections(
    options: ZoteroLocalListOptions,
) -> Result<Vec<ZoteroCollection>, String> {
    let (connection, _data_dir, sqlite_copy) = open_local_zotero_connection(options.data_dir)?;
    let mut statement = connection
        .prepare(
            "select
         c.key,
         c.collectionName,
         parent.key,
         count(distinct pdfItems.itemID)
       from collections c
       left join collections parent on parent.collectionID = c.parentCollectionID
       left join collectionItems ci on ci.collectionID = c.collectionID
       left join (
         select distinct coalesce(parentItemID, itemID) as itemID
         from itemAttachments
         where contentType = 'application/pdf' and path is not null
       ) pdfItems on pdfItems.itemID = ci.itemID
       group by c.collectionID, c.key, c.collectionName, parent.key, c.parentCollectionID
       order by
         case when c.parentCollectionID is null then 0 else 1 end asc,
         lower(c.collectionName) asc",
        )
        .map_err(|error| format!("准备本地 Zotero 分类查询失败: {}", error))?;
    let rows = statement
        .query_map([], |row| {
            Ok(ZoteroCollection {
                collection_key: row.get::<_, String>(0)?,
                name: row.get::<_, String>(1)?,
                parent_collection_key: row.get::<_, Option<String>>(2)?,
                item_count: row.get::<_, i64>(3)?.max(0) as usize,
            })
        })
        .map_err(|error| format!("查询本地 Zotero 分类失败: {}", error))?;
    let output = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取本地 Zotero 分类失败: {}", error))?;

    let _ = fs::remove_file(sqlite_copy);

    Ok(output)
}

#[tauri::command]
pub fn zotero_list_local_library_items(
    options: ZoteroLocalListOptions,
) -> Result<Vec<ZoteroLibraryItem>, String> {
    let (connection, data_dir, sqlite_copy) = open_local_zotero_connection(options.data_dir)?;
    let limit = options.limit.unwrap_or(50).clamp(1, 400) as i64;
    let mut statement = connection
        .prepare(
            "select
         attachment.itemID,
         attachment.key,
         ia.parentItemID,
         ia.path,
         coalesce(parent.key, attachment.key),
         coalesce(parentType.typeName, attachmentType.typeName, 'attachment')
       from itemAttachments ia
       join items attachment on attachment.itemID = ia.itemID
       left join items parent on parent.itemID = ia.parentItemID
       left join itemTypes parentType on parentType.itemTypeID = parent.itemTypeID
       left join itemTypes attachmentType on attachmentType.itemTypeID = attachment.itemTypeID
       where ia.contentType = 'application/pdf' and ia.path is not null
       order by attachment.dateModified desc
       limit ?1",
        )
        .map_err(|error| format!("准备本地 Zotero 文献查询失败: {}", error))?;
    let rows = statement
        .query_map(params![limit], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|error| format!("查询 Zotero PDF 附件失败: {}", error))?;
    let mut output = Vec::new();

    for row in rows {
        let (attachment_item_id, attachment_key, parent_item_id, raw_path, item_key, item_type) =
            row.map_err(|error| format!("读取 Zotero PDF 附件行失败: {}", error))?;
        output.push(build_local_library_item(
            &connection,
            &data_dir,
            attachment_item_id,
            attachment_key,
            parent_item_id,
            raw_path,
            item_key,
            item_type,
        )?);
    }

    let _ = fs::remove_file(sqlite_copy);

    Ok(output)
}

#[tauri::command]
pub fn zotero_list_local_collection_items(
    options: ZoteroLocalCollectionItemsOptions,
) -> Result<Vec<ZoteroLibraryItem>, String> {
    let collection_key = options.collection_key.trim();

    if collection_key.is_empty() {
        return Err("Zotero 分类 Key 不能为空".to_string());
    }

    let (connection, data_dir, sqlite_copy) = open_local_zotero_connection(options.data_dir)?;
    let limit = options.limit.unwrap_or(100).clamp(1, 400) as i64;
    let mut statement = connection
        .prepare(
            "select
         attachment.itemID,
         attachment.key,
         ia.parentItemID,
         ia.path,
         coalesce(parent.key, attachment.key),
         coalesce(parentType.typeName, attachmentType.typeName, 'attachment')
       from collections c
       join collectionItems ci on ci.collectionID = c.collectionID
       join itemAttachments ia
         on (ia.parentItemID = ci.itemID or ia.itemID = ci.itemID)
        and ia.contentType = 'application/pdf'
        and ia.path is not null
       join items attachment on attachment.itemID = ia.itemID
       left join items parent on parent.itemID = ia.parentItemID
       left join itemTypes parentType on parentType.itemTypeID = parent.itemTypeID
       left join itemTypes attachmentType on attachmentType.itemTypeID = attachment.itemTypeID
       where c.key = ?1
       order by attachment.dateModified desc
       limit ?2",
        )
        .map_err(|error| format!("准备 Zotero 分类文献查询失败: {}", error))?;
    let rows = statement
        .query_map(params![collection_key, limit], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|error| format!("查询 Zotero 分类文献失败: {}", error))?;
    let mut output = Vec::new();

    for row in rows {
        let (attachment_item_id, attachment_key, parent_item_id, raw_path, item_key, item_type) =
            row.map_err(|error| format!("读取 Zotero 分类文献行失败: {}", error))?;
        output.push(build_local_library_item(
            &connection,
            &data_dir,
            attachment_item_id,
            attachment_key,
            parent_item_id,
            raw_path,
            item_key,
            item_type,
        )?);
    }

    let _ = fs::remove_file(sqlite_copy);

    Ok(output)
}

#[tauri::command]
pub fn zotero_list_related_notes(
    options: ZoteroRelatedNotesOptions,
) -> Result<Vec<ZoteroRelatedNote>, String> {
    let item_key = options.item_key.trim();

    if item_key.is_empty() {
        return Err("Zotero 条目 Key 不能为空".to_string());
    }

    let (connection, data_dir, sqlite_copy) = open_local_zotero_connection(options.data_dir)?;
    let result = (|| -> Result<Vec<ZoteroRelatedNote>, String> {
        let Some(parent_item_id) = local_item_id_by_key(&connection, item_key)? else {
            return Ok(Vec::new());
        };

        let mut notes = load_related_note_items(&connection, parent_item_id, item_key)?;
        notes.extend(load_related_file_notes(
            &connection,
            &data_dir,
            parent_item_id,
            item_key,
        )?);

        Ok(notes)
    })();

    let _ = fs::remove_file(sqlite_copy);

    result
}

#[tauri::command]
pub async fn zotero_lookup_key(api_key: String) -> Result<ZoteroKeyInfo, String> {
    let api_key = api_key.trim();

    if api_key.is_empty() {
        return Err("Zotero API Key 不能为空".to_string());
    }

    let client = zotero_client()?;
    let endpoint = format!("{}/keys/{}", ZOTERO_API_BASE, api_key);
    let response = client
        .get(endpoint)
        .headers(zotero_headers(api_key)?)
        .send()
        .await
        .map_err(|error| format!("查询 Zotero API Key 失败: {}", error))?;
    let key_info = parse_json_response::<ZoteroKeyResponse>(response, "Zotero API Key").await?;
    let user_id = key_info
        .user_id
        .ok_or_else(|| "Zotero API Key 响应中缺少 userID".to_string())?
        .to_string();

    Ok(ZoteroKeyInfo {
        user_id,
        username: key_info.username,
    })
}

#[tauri::command]
pub async fn zotero_list_library_items(
    options: ZoteroListOptions,
) -> Result<Vec<ZoteroLibraryItem>, String> {
    let api_key = options.api_key.trim();
    let user_id = options.user_id.trim();
    let limit = options.limit.unwrap_or(20).clamp(1, 50);

    if api_key.is_empty() {
        return Err("Zotero API Key 不能为空".to_string());
    }

    if user_id.is_empty() {
        return Err("Zotero User ID 不能为空".to_string());
    }

    let client = zotero_client()?;
    let endpoint = format!(
        "{}/users/{}/items/top?format=json&sort=dateModified&direction=desc&limit={}",
        ZOTERO_API_BASE, user_id, limit
    );
    let response = client
        .get(endpoint)
        .headers(zotero_headers(api_key)?)
        .send()
        .await
        .map_err(|error| format!("读取 Zotero 文献列表失败: {}", error))?;
    let items = parse_json_response::<Vec<ZoteroApiItem>>(response, "Zotero 文献列表").await?;
    let mut output = Vec::new();

    for item in items {
        let item_type = item
            .data
            .item_type
            .clone()
            .unwrap_or_else(|| "unknown".to_string());
        let title = item
            .data
            .title
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "未命名条目".to_string());
        let mut attachment = if item_type == "attachment"
            && item.data.content_type.as_deref() == Some("application/pdf")
        {
            Some(item.clone())
        } else {
            load_pdf_child(&client, zotero_headers(api_key)?, user_id, &item.key).await?
        };
        let attachment_key = attachment.as_ref().map(|attachment| attachment.key.clone());
        let attachment_title = attachment
            .as_ref()
            .and_then(|attachment| attachment.data.title.clone());
        let attachment_filename = attachment
            .take()
            .and_then(|attachment| attachment.data.filename);

        output.push(ZoteroLibraryItem {
            item_key: item.key,
            title,
            creators: creator_summary(item.data.creators.as_ref()),
            year: year_from_date(item.data.date.as_ref()),
            item_type,
            attachment_key,
            attachment_title,
            attachment_filename,
            local_pdf_path: None,
        });
    }

    Ok(output)
}

#[tauri::command]
pub async fn zotero_download_attachment_pdf(
    options: ZoteroDownloadOptions,
) -> Result<ZoteroDownloadResult, String> {
    let api_key = options.api_key.trim();
    let user_id = options.user_id.trim();
    let attachment_key = options.attachment_key.trim();

    if api_key.is_empty() {
        return Err("Zotero API Key 不能为空".to_string());
    }

    if user_id.is_empty() {
        return Err("Zotero User ID 不能为空".to_string());
    }

    if attachment_key.is_empty() {
        return Err("Zotero 附件 Key 不能为空".to_string());
    }

    let client = zotero_client()?;
    let endpoint = format!(
        "{}/users/{}/items/{}/file",
        ZOTERO_API_BASE, user_id, attachment_key
    );
    let response = client
        .get(endpoint)
        .headers(zotero_headers(api_key)?)
        .send()
        .await
        .map_err(|error| format!("下载 Zotero PDF 附件失败: {}", error))?;
    let status = response.status();

    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!(
            "下载 Zotero PDF 附件 HTTP 状态异常: {} {}",
            status, text
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取 Zotero PDF 附件失败: {}", error))?;
    let filename = safe_pdf_filename(options.filename, attachment_key);
    let mut directory = std::env::temp_dir();

    directory.push("paper-reader-zotero");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("创建 Zotero 临时目录失败: {}", error))?;

    let encoded_key = URL_SAFE_NO_PAD.encode(attachment_key.as_bytes());
    let mut path = PathBuf::from(directory);

    path.push(format!("{}-{}", encoded_key, filename));
    fs::write(&path, bytes).map_err(|error| format!("写入 Zotero PDF 临时文件失败: {}", error))?;

    Ok(ZoteroDownloadResult {
        path: path.to_string_lossy().into_owned(),
        filename,
    })
}

use std::collections::HashSet;

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, OptionalExtension};

use super::categories::{category_system_key, descendant_category_ids};
use super::import::{ensure_pdf_path, fnv1a_file_hash};
use super::*;

pub(crate) fn recent_import_count(connection: &Connection) -> Result<i64, String> {
    connection
        .query_row(
            "select count(*) from (
               select id from papers
               order by imported_at desc, lower(title) asc
               limit ?1
             )",
            params![RECENT_IMPORT_LIMIT],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("统计最近导入文献失败: {}", error))
}

pub(crate) fn insert_authors(
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

fn replace_authors(connection: &Connection, paper_id: &str, authors: &[String]) -> Result<(), String> {
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

pub(crate) fn insert_category_relation(
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

pub(crate) fn load_paper_by_id(
    connection: &Connection,
    paper_id: &str,
) -> Result<Option<LiteraturePaper>, String> {
    let base = connection
        .query_row(
            "select id, title, year, publication, doi, url, abstract_text, keywords,
              imported_at, updated_at, last_read_at, reading_progress, is_favorite,
              user_note, ai_summary, citation, source, sort_order
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
                    row.get::<_, i64>(17)?,
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
        sort_order,
    )) = base
    else {
        return Ok(None);
    };
    let authors = list_authors_for_paper(connection, &id)?;
    let tags = list_tags_for_paper(connection, &id)?;
    let category_ids = list_category_ids_for_paper(connection, &id)?;
    let attachments = list_attachments_for_paper(connection, &id)?;

    Ok(Some(LiteraturePaper {
        authors,
        tags,
        category_ids,
        attachments,
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
        sort_order,
    }))
}

pub(crate) fn next_paper_sort_order(connection: &Connection) -> Result<i64, String> {
    connection
        .query_row(
            "select coalesce(min(sort_order), 0) - 1 from papers",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("计算文献排序失败: {}", error))
}

fn sort_clause(sort_by: Option<&str>, direction: Option<&str>) -> String {
    let sort_key = sort_by.unwrap_or("manual");

    if sort_key == "manual" {
        return "p.sort_order asc, p.imported_at desc, lower(p.title) asc".to_string();
    }

    let column = match sort_key {
        "title" => "lower(p.title)",
        "year" => "coalesce(p.year, '')",
        "author" => "lower(coalesce(first_author.name, ''))",
        "importedAt" => "p.imported_at",
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

pub(crate) fn list_papers_inner(
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
            Some(SYSTEM_CATEGORY_ALL) => {}
            Some(SYSTEM_CATEGORY_RECENT) => {
                filters.push(format!(
                    "p.id in (
                       select recent.id from papers recent
                       order by recent.imported_at desc, lower(recent.title) asc
                       limit {}
                     )",
                    RECENT_IMPORT_LIMIT
                ));
            }
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
                let category_ids = descendant_category_ids(connection, category_id)?;
                let placeholders = std::iter::repeat("?")
                    .take(category_ids.len())
                    .collect::<Vec<_>>()
                    .join(", ");
                filters.push(format!(
                    "exists (
                       select 1 from paper_categories pc
                       where pc.paper_id = p.id and pc.category_id in ({})
                     )",
                    placeholders
                ));
                values.extend(category_ids.into_iter().map(Value::Text));
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

fn list_paper_ids_by_manual_order(connection: &Connection) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "select id from papers order by sort_order asc, imported_at desc, lower(title) asc",
        )
        .map_err(|error| format!("准备文献排序查询失败: {}", error))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("查询文献排序失败: {}", error))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取文献排序失败: {}", error))
}

pub(crate) fn reorder_papers_by_subset(
    connection: &Connection,
    requested_paper_ids: Vec<String>,
) -> Result<(), String> {
    let mut seen = HashSet::new();
    let requested_paper_ids = requested_paper_ids
        .into_iter()
        .map(|paper_id| paper_id.trim().to_string())
        .filter(|paper_id| !paper_id.is_empty())
        .filter(|paper_id| seen.insert(paper_id.clone()))
        .collect::<Vec<_>>();

    if requested_paper_ids.len() < 2 {
        return Ok(());
    }

    let current_paper_ids = list_paper_ids_by_manual_order(connection)?;
    let existing_paper_ids = current_paper_ids
        .iter()
        .cloned()
        .collect::<HashSet<String>>();
    let requested_paper_ids = requested_paper_ids
        .into_iter()
        .filter(|paper_id| existing_paper_ids.contains(paper_id))
        .collect::<Vec<_>>();

    if requested_paper_ids.len() < 2 {
        return Ok(());
    }

    let requested_set = requested_paper_ids
        .iter()
        .cloned()
        .collect::<HashSet<String>>();
    let mut next_paper_ids = Vec::with_capacity(current_paper_ids.len());
    let mut inserted_requested_block = false;

    for paper_id in current_paper_ids {
        if requested_set.contains(&paper_id) {
            if !inserted_requested_block {
                next_paper_ids.extend(requested_paper_ids.iter().cloned());
                inserted_requested_block = true;
            }
            continue;
        }

        next_paper_ids.push(paper_id);
    }

    if !inserted_requested_block {
        next_paper_ids.extend(requested_paper_ids);
    }

    for (index, paper_id) in next_paper_ids.iter().enumerate() {
        connection
            .execute(
                "update papers set sort_order = ?1 where id = ?2",
                params![index as i64, paper_id],
            )
            .map_err(|error| format!("保存文献排序失败: {}", error))?;
    }

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
pub fn library_reorder_papers(
    app: AppHandle,
    request: ReorderPapersRequest,
) -> Result<(), String> {
    let mut connection = open_library_connection(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("开启文献排序事务失败: {}", error))?;

    reorder_papers_by_subset(&transaction, request.paper_ids)?;

    transaction
        .commit()
        .map_err(|error| format!("提交文献排序失败: {}", error))
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
    let delete_files = request.delete_files.unwrap_or(false);

    if paper_id.is_empty() {
        return Err("文献 ID 不能为空".to_string());
    }

    let attachment_paths = if delete_files {
        let mut statement = connection
            .prepare("select stored_path from attachments where paper_id = ?1 and kind = 'pdf'")
            .map_err(|error| format!("准备 PDF 附件路径查询失败: {}", error))?;
        let rows = statement
            .query_map(params![paper_id], |row| row.get::<_, String>(0))
            .map_err(|error| format!("查询 PDF 附件路径失败: {}", error))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("读取 PDF 附件路径失败: {}", error))?
    } else {
        Vec::new()
    };

    let affected = connection
        .execute("delete from papers where id = ?1", params![paper_id])
        .map_err(|error| format!("删除文献记录失败: {}", error))?;

    if affected == 0 {
        return Err("文献不存在，无法删除".to_string());
    }

    if delete_files {
        let mut seen_paths = HashSet::new();

        for stored_path in attachment_paths {
            let stored_path = stored_path.trim();

            if stored_path.is_empty() || !seen_paths.insert(stored_path.to_string()) {
                continue;
            }

            match fs::remove_file(PathBuf::from(stored_path)) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    eprintln!("failed to remove PDF file '{}': {}", stored_path, error);
                }
            }
        }
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

use std::collections::{HashMap, HashSet};

use rusqlite::{params, OptionalExtension};

use super::papers::recent_import_count;
use super::*;

pub(crate) fn category_id_for_system_key(
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

pub(crate) fn category_system_key(
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

pub(crate) fn category_exists(connection: &Connection, category_id: &str) -> Result<bool, String> {
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

pub(crate) fn category_is_system(
    connection: &Connection,
    category_id: &str,
) -> Result<bool, String> {
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

pub(crate) fn descendant_category_ids(
    connection: &Connection,
    category_id: &str,
) -> Result<Vec<String>, String> {
    let mut output = Vec::new();
    let mut stack = vec![category_id.to_string()];

    while let Some(current_id) = stack.pop() {
        output.push(current_id.clone());

        let mut statement = connection
            .prepare("select id from categories where parent_id = ?1 and is_system = 0")
            .map_err(|error| format!("准备子分类查询失败: {}", error))?;
        let rows = statement
            .query_map(params![current_id], |row| row.get::<_, String>(0))
            .map_err(|error| format!("查询子分类失败: {}", error))?;
        let child_ids = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("读取子分类失败: {}", error))?;

        for child_id in child_ids {
            stack.push(child_id);
        }
    }

    Ok(output)
}

fn collect_category_paper_ids(
    category_id: &str,
    children_map: &HashMap<String, Vec<String>>,
    direct_papers: &HashMap<String, HashSet<String>>,
    memo: &mut HashMap<String, HashSet<String>>,
) -> HashSet<String> {
    if let Some(cached) = memo.get(category_id) {
        return cached.clone();
    }

    let mut paper_ids = direct_papers.get(category_id).cloned().unwrap_or_default();

    for child_id in children_map.get(category_id).into_iter().flatten() {
        paper_ids.extend(collect_category_paper_ids(
            child_id,
            children_map,
            direct_papers,
            memo,
        ));
    }

    memo.insert(category_id.to_string(), paper_ids.clone());
    paper_ids
}

fn apply_category_paper_counts(
    connection: &Connection,
    categories: &mut [LiteratureCategory],
) -> Result<(), String> {
    let all_papers = connection
        .query_row("select count(*) from papers", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|error| format!("统计全部文献失败: {}", error))?;
    let uncategorized_papers = connection
        .query_row(
            "select count(*) from papers p
             where not exists (select 1 from paper_categories pc where pc.paper_id = p.id)",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("统计未分类文献失败: {}", error))?;
    let favorite_papers = connection
        .query_row(
            "select count(*) from papers where is_favorite = 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("统计收藏文献失败: {}", error))?;
    let recent_papers = recent_import_count(connection)?;
    let mut children_map = HashMap::<String, Vec<String>>::new();

    for category in categories.iter().filter(|category| !category.is_system) {
        if let Some(parent_id) = category.parent_id.as_ref() {
            children_map
                .entry(parent_id.clone())
                .or_default()
                .push(category.id.clone());
        }
    }

    let mut direct_papers = HashMap::<String, HashSet<String>>::new();
    let mut statement = connection
        .prepare("select paper_id, category_id from paper_categories")
        .map_err(|error| format!("准备分类文献关系查询失败: {}", error))?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("查询分类文献关系失败: {}", error))?;

    for row in rows {
        let (paper_id, category_id) =
            row.map_err(|error| format!("读取分类文献关系失败: {}", error))?;
        direct_papers
            .entry(category_id)
            .or_default()
            .insert(paper_id);
    }

    let mut memo = HashMap::<String, HashSet<String>>::new();

    for category in categories {
        category.paper_count = match category.system_key.as_deref() {
            Some(SYSTEM_CATEGORY_ALL) => all_papers,
            Some(SYSTEM_CATEGORY_RECENT) => recent_papers,
            Some(SYSTEM_CATEGORY_UNCATEGORIZED) => uncategorized_papers,
            Some(SYSTEM_CATEGORY_FAVORITES) => favorite_papers,
            _ => collect_category_paper_ids(&category.id, &children_map, &direct_papers, &mut memo)
                .len() as i64,
        };
    }

    Ok(())
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

pub(crate) fn next_category_sort_order(
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

#[tauri::command]
pub fn library_list_categories(app: AppHandle) -> Result<Vec<LiteratureCategory>, String> {
    let connection = open_library_connection(&app)?;
    let mut statement = connection
        .prepare(
            "select c.id, c.name, c.parent_id, c.sort_order, c.is_system, c.system_key,
                    c.created_at, c.updated_at
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
                paper_count: 0,
            })
        })
        .map_err(|error| format!("查询分类失败: {}", error))?;

    let mut categories = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取分类失败: {}", error))?;

    apply_category_paper_counts(&connection, &mut categories)?;

    Ok(categories)
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

    let sort_order = next_category_sort_order(&connection, request.parent_id.as_deref())?;
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
    let mut connection = open_library_connection(&app)?;
    let category_id = category_id.trim().to_string();

    if category_id.is_empty() {
        return Err("分类 ID 不能为空".to_string());
    }

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

    let category_ids = descendant_category_ids(&connection, &category_id)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("开启删除分类事务失败: {}", error))?;

    for category_id in category_ids.iter().rev() {
        transaction
            .execute("delete from categories where id = ?1", params![category_id])
            .map_err(|error| format!("删除分类失败: {}", error))?;
    }

    transaction
        .commit()
        .map_err(|error| format!("提交删除分类事务失败: {}", error))?;

    Ok(())
}

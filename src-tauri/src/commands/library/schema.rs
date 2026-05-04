use rusqlite::{params, Connection};

use super::{
    now_millis, SYSTEM_CATEGORY_ALL, SYSTEM_CATEGORY_FAVORITES, SYSTEM_CATEGORY_RECENT,
    SYSTEM_CATEGORY_UNCATEGORIZED,
};

fn table_exists(connection: &Connection, table_name: &str) -> Result<bool, String> {
    connection
        .query_row(
            "select exists(select 1 from sqlite_master where type = 'table' and name = ?1)",
            params![table_name],
            |row| row.get::<_, i64>(0),
        )
        .map(|value| value != 0)
        .map_err(|error| format!("检查数据库表 {} 失败: {}", table_name, error))
}

fn table_has_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
) -> Result<bool, String> {
    let query = format!("pragma table_info({})", table_name);
    let mut statement = connection
        .prepare(&query)
        .map_err(|error| format!("检查数据表 {} 字段失败: {}", table_name, error))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("读取数据表 {} 字段失败: {}", table_name, error))?;
    let columns = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("解析数据表 {} 字段失败: {}", table_name, error))?;

    Ok(columns.iter().any(|column| column == column_name))
}

fn backfill_paper_sort_order(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("select id from papers order by imported_at desc, lower(title) asc")
        .map_err(|error| format!("准备文献排序迁移失败: {}", error))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("查询文献排序迁移数据失败: {}", error))?;
    let paper_ids = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取文献排序迁移数据失败: {}", error))?;

    for (index, paper_id) in paper_ids.iter().enumerate() {
        connection
            .execute(
                "update papers set sort_order = ?1 where id = ?2",
                params![index as i64, paper_id],
            )
            .map_err(|error| format!("迁移文献排序失败: {}", error))?;
    }

    Ok(())
}

pub(crate) fn migrate_library_schema(connection: &Connection) -> Result<(), String> {
    let papers_table_exists = table_exists(connection, "papers")?;
    let had_paper_sort_order = if papers_table_exists {
        table_has_column(connection, "papers", "sort_order")?
    } else {
        false
    };

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
        source text not null default 'local',
        sort_order integer not null default 0
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
        .map_err(|error| format!("初始化文献库数据库失败: {}", error))?;

    if papers_table_exists && !had_paper_sort_order {
        connection
            .execute(
                "alter table papers add column sort_order integer not null default 0",
                [],
            )
            .map_err(|error| format!("迁移文献排序字段失败: {}", error))?;
        backfill_paper_sort_order(connection)?;
    }

    Ok(())
}

pub(crate) fn seed_system_categories(connection: &Connection) -> Result<(), String> {
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

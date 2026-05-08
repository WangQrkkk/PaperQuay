use rusqlite::Connection;
use sqlite_vec::sqlite3_vec_init;
use std::sync::Once;

use super::vector_tables::rag_vector_table_name;

static SQLITE_VEC_REGISTRATION: Once = Once::new();

pub(crate) fn register_sqlite_vec_once() {
    SQLITE_VEC_REGISTRATION.call_once(|| unsafe {
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite3_vec_init as *const (),
        )));
    });
}

pub(crate) fn migrate_rag_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            create table if not exists rag_documents (
              document_key text not null,
              title text not null,
              source_type text not null,
              source_signature text not null,
              embedding_model_key text not null default '',
              embedding_dimension integer not null default 0,
              total_chunk_count integer not null default 0,
              updated_at integer not null,
              status text not null default 'pending',
              last_error text,
              failed_at integer,
              retry_after_ms integer,
              primary key (document_key, source_type)
            );

            create table if not exists rag_chunks (
              id integer primary key autoincrement,
              document_key text not null,
              title text not null,
              source_type text not null,
              source_signature text not null,
              embedding_dimension integer not null default 0,
              chunk_id text not null,
              chunk_index integer not null,
              page_index integer,
              block_id text,
              text text not null,
              updated_at integer not null,
              unique(document_key, source_type, chunk_id)
            );

            create index if not exists idx_rag_chunks_document_source
              on rag_chunks(document_key, source_type);

            create index if not exists idx_rag_chunks_document_source_index
              on rag_chunks(document_key, source_type, chunk_index);
            ",
        )
        .map_err(|error| format!("初始化本地 RAG 数据表失败: {}", error))?;

    ensure_rag_document_column(
        connection,
        "embedding_model_key",
        "alter table rag_documents add column embedding_model_key text not null default ''",
    )?;
    ensure_rag_document_column(
        connection,
        "embedding_dimension",
        "alter table rag_documents add column embedding_dimension integer not null default 0",
    )?;
    ensure_rag_document_column(
        connection,
        "total_chunk_count",
        "alter table rag_documents add column total_chunk_count integer not null default 0",
    )?;
    ensure_rag_document_column(
        connection,
        "status",
        "alter table rag_documents add column status text not null default 'pending'",
    )?;
    ensure_rag_document_column(
        connection,
        "last_error",
        "alter table rag_documents add column last_error text",
    )?;
    ensure_rag_document_column(
        connection,
        "failed_at",
        "alter table rag_documents add column failed_at integer",
    )?;
    ensure_rag_document_column(
        connection,
        "retry_after_ms",
        "alter table rag_documents add column retry_after_ms integer",
    )?;
    ensure_rag_chunk_column(
        connection,
        "embedding_dimension",
        "alter table rag_chunks add column embedding_dimension integer not null default 0",
    )?;

    Ok(())
}

pub(crate) fn ensure_rag_vector_table(
    connection: &Connection,
    dimension: i64,
) -> Result<String, String> {
    let table_name = rag_vector_table_name(dimension)?;
    let sql = format!(
        "
        create virtual table if not exists {table_name} using vec0(
          chunk_row_id integer primary key,
          embedding float[{dimension}],
          document_key text,
          source_type text
        );
        ",
    );

    connection
        .execute_batch(&sql)
        .map_err(|error| format!("初始化本地 RAG 向量表失败: {}", error))?;

    Ok(table_name)
}

fn pragma_has_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
) -> Result<bool, String> {
    let query = format!("pragma table_info({})", table_name);
    let mut statement = connection
        .prepare(&query)
        .map_err(|error| format!("读取本地 RAG 表结构失败: {}", error))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("遍历本地 RAG 表结构失败: {}", error))?;

    for column in rows {
        let name = column.map_err(|error| format!("解析本地 RAG 表结构失败: {}", error))?;

        if name == column_name {
            return Ok(true);
        }
    }

    Ok(false)
}

fn ensure_rag_document_column(
    connection: &Connection,
    column_name: &str,
    alter_sql: &str,
) -> Result<(), String> {
    if pragma_has_column(connection, "rag_documents", column_name)? {
        return Ok(());
    }

    connection
        .execute(alter_sql, [])
        .map_err(|error| format!("迁移 rag_documents.{} 字段失败: {}", column_name, error))?;

    Ok(())
}

fn ensure_rag_chunk_column(
    connection: &Connection,
    column_name: &str,
    alter_sql: &str,
) -> Result<(), String> {
    if pragma_has_column(connection, "rag_chunks", column_name)? {
        return Ok(());
    }

    connection
        .execute(alter_sql, [])
        .map_err(|error| format!("迁移 rag_chunks.{} 字段失败: {}", column_name, error))?;

    Ok(())
}

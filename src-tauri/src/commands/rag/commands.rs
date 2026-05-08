use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::json;
use zerocopy::IntoBytes;

use crate::commands::library::open_library_connection;

use super::models::{
    RagChunkInput, RagDocumentIndexStatus, RagDocumentRecord, RagEmbedChunksRequest,
    RagEmbedTextRequest, RagEmbeddingOptions, RagIndexDocumentRequest, RagIndexStatusRequest,
    RagIndexedChunkInput, RagReportDocumentIndexFailureRequest, RagRetrievalResult,
    RagRetrieveDocumentRequest,
};
use super::schema::{ensure_rag_vector_table, migrate_rag_schema};
use super::vector_tables::rag_vector_table_name;

const DEFAULT_RETRY_AFTER_MS: i64 = 60_000;

#[derive(Debug, Deserialize)]
struct EmbeddingResponseData {
    embedding: Vec<f32>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingResponseData>,
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

fn normalize_source_type(value: &str) -> Result<&str, String> {
    match value.trim() {
        "mineru-markdown" | "pdf-text" => Ok(value.trim()),
        other => Err(format!("不支持的本地 RAG 来源类型: {}", other)),
    }
}

fn normalize_embedding_base_url(base_url: &str) -> Option<String> {
    let trimmed = base_url.trim();

    if trimmed.is_empty() {
        return None;
    }

    let normalized = trimmed
        .trim_end_matches('/')
        .trim_end_matches("/embeddings")
        .trim_end_matches('/');

    if normalized
        .rsplit('/')
        .next()
        .map(|segment| {
            segment.len() >= 2
                && segment.starts_with('v')
                && segment[1..].chars().all(|character| character.is_ascii_digit())
        })
        .unwrap_or(false)
    {
        return Some(normalized.to_string());
    }

    Some(format!("{normalized}/v1"))
}

fn build_embeddings_url(base_url: &str) -> Result<String, String> {
    normalize_embedding_base_url(base_url)
        .map(|value| format!("{value}/embeddings"))
        .ok_or_else(|| "embedding Base URL 不能为空".to_string())
}

async fn request_embeddings(
    inputs: Vec<String>,
    options: &RagEmbeddingOptions,
) -> Result<Vec<Vec<f32>>, String> {
    let api_key = options.api_key.trim();
    let model = options.model.trim();

    if api_key.is_empty() {
        return Err("embedding API Key 不能为空".to_string());
    }

    if model.is_empty() {
        return Err("embedding 模型名称不能为空".to_string());
    }

    if inputs.is_empty() {
        return Ok(Vec::new());
    }

    let endpoint = build_embeddings_url(&options.base_url)?;
    let timeout_seconds = options.timeout_seconds.unwrap_or(180).clamp(10, 600);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_seconds))
        .build()
        .map_err(|error| format!("创建 embedding HTTP 客户端失败: {}", error))?;
    let mut body = json!({
        "input": inputs,
        "model": model,
    });

    if let Some(dimensions) = options.dimensions {
        if dimensions > 0 {
            body["dimensions"] = json!(dimensions);
        }
    }

    let response = client
        .post(&endpoint)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("请求 embedding 接口失败: {}", error))?;
    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|error| format!("读取 embedding 响应失败: {}", error))?;

    if !status.is_success() {
        return Err(format!(
            "embedding 接口返回错误状态: {}; response: {}",
            status, response_text
        ));
    }

    let parsed = serde_json::from_str::<EmbeddingResponse>(&response_text).map_err(|error| {
        format!(
            "解析 embedding 响应失败: {}; raw response: {}",
            error, response_text
        )
    })?;

    Ok(parsed.data.into_iter().map(|item| item.embedding).collect())
}

fn embedding_bytes(values: &[f32]) -> Vec<u8> {
    values.iter().copied().collect::<Vec<f32>>().as_bytes().to_vec()
}

fn read_document_record(
    connection: &Connection,
    document_key: &str,
    source_type: &str,
) -> Result<Option<RagDocumentRecord>, String> {
    connection
        .query_row(
            "
            select
              document_key,
              source_type,
              source_signature,
              embedding_model_key,
              embedding_dimension,
              total_chunk_count,
              updated_at,
              status,
              last_error,
              failed_at,
              retry_after_ms
            from rag_documents
            where document_key = ?1 and source_type = ?2
            ",
            params![document_key, source_type],
            |row| {
                Ok(RagDocumentRecord {
                    document_key: row.get(0)?,
                    source_type: row.get(1)?,
                    source_signature: row.get(2)?,
                    embedding_model_key: row.get(3)?,
                    embedding_dimension: row.get(4)?,
                    total_chunk_count: row.get(5)?,
                    updated_at: row.get(6)?,
                    status: row.get(7)?,
                    last_error: row.get(8)?,
                    failed_at: row.get(9)?,
                    retry_after_ms: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("读取本地 RAG 文档记录失败: {}", error))
}

fn count_indexed_chunks(
    connection: &Connection,
    document_key: &str,
    source_type: &str,
) -> Result<i64, String> {
    connection
        .query_row(
            "select count(*) from rag_chunks where document_key = ?1 and source_type = ?2",
            params![document_key, source_type],
            |row| row.get(0),
        )
        .map_err(|error| format!("统计本地 RAG 分块数量失败: {}", error))
}

fn upsert_document_record(
    connection: &Connection,
    document_key: &str,
    title: &str,
    source_type: &str,
    source_signature: &str,
    embedding_model_key: &str,
    embedding_dimension: i64,
    total_chunk_count: i64,
    status: &str,
    last_error: Option<&str>,
    failed_at: Option<i64>,
    retry_after_ms: Option<i64>,
) -> Result<(), String> {
    connection
        .execute(
            "
            insert into rag_documents (
              document_key,
              title,
              source_type,
              source_signature,
              embedding_model_key,
              embedding_dimension,
              total_chunk_count,
              updated_at,
              status,
              last_error,
              failed_at,
              retry_after_ms
            )
            values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            on conflict(document_key, source_type) do update set
              title = excluded.title,
              source_signature = excluded.source_signature,
              embedding_model_key = excluded.embedding_model_key,
              embedding_dimension = excluded.embedding_dimension,
              total_chunk_count = excluded.total_chunk_count,
              updated_at = excluded.updated_at,
              status = excluded.status,
              last_error = excluded.last_error,
              failed_at = excluded.failed_at,
              retry_after_ms = excluded.retry_after_ms
            ",
            params![
                document_key,
                title,
                source_type,
                source_signature,
                embedding_model_key,
                embedding_dimension,
                total_chunk_count,
                now_millis(),
                status,
                last_error,
                failed_at,
                retry_after_ms
            ],
        )
        .map_err(|error| format!("写入本地 RAG 文档记录失败: {}", error))?;

    Ok(())
}

fn delete_document_chunks(
    connection: &Connection,
    document_key: &str,
    source_type: &str,
    embedding_dimension: i64,
) -> Result<(), String> {
    let table_name = rag_vector_table_name(embedding_dimension)?;
    let chunk_row_ids = {
        let mut statement = connection
            .prepare("select id from rag_chunks where document_key = ?1 and source_type = ?2")
            .map_err(|error| format!("读取旧本地 RAG 分块失败: {}", error))?;
        let rows = statement
            .query_map(params![document_key, source_type], |row| row.get::<_, i64>(0))
            .map_err(|error| format!("遍历旧本地 RAG 分块失败: {}", error))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("收集旧本地 RAG 分块失败: {}", error))?
    };

    for chunk_row_id in chunk_row_ids {
        connection
            .execute(
                &format!("delete from {table_name} where chunk_row_id = ?1"),
                params![chunk_row_id],
            )
            .map_err(|error| format!("删除旧本地 RAG 向量失败: {}", error))?;
    }

    connection
        .execute(
            "delete from rag_chunks where document_key = ?1 and source_type = ?2",
            params![document_key, source_type],
        )
        .map_err(|error| format!("删除旧本地 RAG 分块失败: {}", error))?;

    Ok(())
}

fn reset_document_if_layout_changed(
    connection: &Connection,
    current_record: Option<&RagDocumentRecord>,
    document_key: &str,
    source_type: &str,
    source_signature: &str,
    embedding_model_key: &str,
    embedding_dimension: i64,
) -> Result<(), String> {
    let Some(record) = current_record else {
        return Ok(());
    };

    if record.source_signature == source_signature
        && record.embedding_model_key == embedding_model_key
        && record.embedding_dimension == embedding_dimension
    {
        return Ok(());
    }

    if record.embedding_dimension > 0 {
        delete_document_chunks(connection, document_key, source_type, record.embedding_dimension)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn rag_embed_text(request: RagEmbedTextRequest) -> Result<Vec<f32>, String> {
    let text = request.text.trim();

    if text.is_empty() {
        return Ok(Vec::new());
    }

    let embeddings = request_embeddings(vec![text.to_string()], &request.embedding).await?;

    Ok(embeddings.into_iter().next().unwrap_or_default())
}

#[tauri::command]
pub async fn rag_embed_chunks(
    request: RagEmbedChunksRequest,
) -> Result<Vec<RagIndexedChunkInput>, String> {
    let chunks = request
        .chunks
        .into_iter()
        .filter(|chunk| !chunk.text.trim().is_empty() && !chunk.chunk_id.trim().is_empty())
        .collect::<Vec<RagChunkInput>>();

    if chunks.is_empty() {
        return Ok(Vec::new());
    }

    let texts = chunks.iter().map(|chunk| chunk.text.clone()).collect::<Vec<_>>();
    let embeddings = request_embeddings(texts, &request.embedding).await?;

    Ok(chunks
        .into_iter()
        .zip(embeddings.into_iter())
        .filter_map(|(chunk, embedding)| {
            if embedding.is_empty() {
                return None;
            }

            Some(RagIndexedChunkInput {
                chunk_id: chunk.chunk_id,
                chunk_index: chunk.chunk_index,
                page_index: chunk.page_index,
                block_id: chunk.block_id,
                text: chunk.text,
                embedding,
            })
        })
        .collect())
}

#[tauri::command]
pub fn rag_index_document(
    app: tauri::AppHandle,
    request: RagIndexDocumentRequest,
) -> Result<(), String> {
    let document_key = request.document_key.trim();
    let title = request.title.trim();
    let source_type = normalize_source_type(&request.source_type)?;
    let source_signature = request.source_signature.trim();
    let embedding_model_key = request.embedding_model_key.trim();

    if document_key.is_empty() {
        return Err("documentKey 不能为空".to_string());
    }

    if title.is_empty() {
        return Err("title 不能为空".to_string());
    }

    if source_signature.is_empty() {
        return Err("sourceSignature 不能为空".to_string());
    }

    if embedding_model_key.is_empty() {
        return Err("embeddingModelKey 不能为空".to_string());
    }

    if request.total_chunk_count < 0 {
        return Err("totalChunkCount 不能小于 0".to_string());
    }

    if request.chunks.is_empty() {
        return Ok(());
    }

    let embedding_dimension = request.chunks[0].embedding.len() as i64;

    if embedding_dimension <= 0 {
        return Err("本地 RAG embedding 维度不能为空".to_string());
    }

    if request
        .chunks
        .iter()
        .any(|chunk| chunk.embedding.len() as i64 != embedding_dimension)
    {
        return Err("本地 RAG embedding 维度不一致".to_string());
    }

    let mut connection = open_library_connection(&app)?;
    migrate_rag_schema(&connection)?;
    ensure_rag_vector_table(&connection, embedding_dimension)?;

    let current_record = read_document_record(&connection, document_key, source_type)?;
    reset_document_if_layout_changed(
        &connection,
        current_record.as_ref(),
        document_key,
        source_type,
        source_signature,
        embedding_model_key,
        embedding_dimension,
    )?;

    upsert_document_record(
        &connection,
        document_key,
        title,
        source_type,
        source_signature,
        embedding_model_key,
        embedding_dimension,
        request.total_chunk_count,
        "pending",
        None,
        None,
        None,
    )?;

    let vector_table_name = rag_vector_table_name(embedding_dimension)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("开启本地 RAG 事务失败: {}", error))?;

    for chunk in &request.chunks {
        let chunk_text = chunk.text.trim();
        let chunk_id = chunk.chunk_id.trim();

        if chunk_text.is_empty() || chunk_id.is_empty() {
            continue;
        }

        transaction
            .execute(
                "
                insert into rag_chunks
                  (
                    document_key,
                    title,
                    source_type,
                    source_signature,
                    embedding_dimension,
                    chunk_id,
                    chunk_index,
                    page_index,
                    block_id,
                    text,
                    updated_at
                  )
                values
                  (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                on conflict(document_key, source_type, chunk_id) do update set
                  title = excluded.title,
                  source_signature = excluded.source_signature,
                  embedding_dimension = excluded.embedding_dimension,
                  chunk_index = excluded.chunk_index,
                  page_index = excluded.page_index,
                  block_id = excluded.block_id,
                  text = excluded.text,
                  updated_at = excluded.updated_at
                ",
                params![
                    document_key,
                    title,
                    source_type,
                    source_signature,
                    embedding_dimension,
                    chunk_id,
                    chunk.chunk_index,
                    chunk.page_index,
                    chunk.block_id.as_deref(),
                    chunk_text,
                    now_millis()
                ],
            )
            .map_err(|error| format!("写入本地 RAG 分块失败: {}", error))?;

        let chunk_row_id: i64 = transaction
            .query_row(
                "select id from rag_chunks where document_key = ?1 and source_type = ?2 and chunk_id = ?3",
                params![document_key, source_type, chunk_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("读取本地 RAG 分块主键失败: {}", error))?;

        transaction
            .execute(
                &format!("delete from {vector_table_name} where chunk_row_id = ?1"),
                params![chunk_row_id],
            )
            .map_err(|error| format!("覆盖本地 RAG 向量失败: {}", error))?;

        transaction
            .execute(
                &format!(
                    "
                    insert into {vector_table_name} (chunk_row_id, embedding, document_key, source_type)
                    values (?1, ?2, ?3, ?4)
                    "
                ),
                params![
                    chunk_row_id,
                    embedding_bytes(&chunk.embedding),
                    document_key,
                    source_type
                ],
            )
            .map_err(|error| format!("写入本地 RAG 向量失败: {}", error))?;
    }

    transaction
        .commit()
        .map_err(|error| format!("提交本地 RAG 事务失败: {}", error))?;

    let indexed_chunk_count = count_indexed_chunks(&connection, document_key, source_type)?;
    let next_status = if indexed_chunk_count >= request.total_chunk_count && request.total_chunk_count > 0 {
        "ready"
    } else {
        "pending"
    };

    upsert_document_record(
        &connection,
        document_key,
        title,
        source_type,
        source_signature,
        embedding_model_key,
        embedding_dimension,
        request.total_chunk_count,
        next_status,
        None,
        None,
        None,
    )?;

    Ok(())
}

#[tauri::command]
pub fn rag_report_document_index_failure(
    app: tauri::AppHandle,
    request: RagReportDocumentIndexFailureRequest,
) -> Result<(), String> {
    let document_key = request.document_key.trim();
    let title = request.title.trim();
    let source_type = normalize_source_type(&request.source_type)?;
    let source_signature = request.source_signature.trim();
    let embedding_model_key = request.embedding_model_key.trim();
    let error_message = request.error_message.trim();
    let retry_after_ms = request
        .retry_after_ms
        .unwrap_or(DEFAULT_RETRY_AFTER_MS)
        .max(0);

    if document_key.is_empty() {
        return Err("documentKey 不能为空".to_string());
    }

    if title.is_empty() {
        return Err("title 不能为空".to_string());
    }

    if source_signature.is_empty() {
        return Err("sourceSignature 不能为空".to_string());
    }

    if embedding_model_key.is_empty() {
        return Err("embeddingModelKey 不能为空".to_string());
    }

    if error_message.is_empty() {
        return Err("errorMessage 不能为空".to_string());
    }

    let connection = open_library_connection(&app)?;
    migrate_rag_schema(&connection)?;
    let current_record = read_document_record(&connection, document_key, source_type)?;
    let embedding_dimension = current_record
        .as_ref()
        .map(|record| record.embedding_dimension)
        .unwrap_or_default();

    upsert_document_record(
        &connection,
        document_key,
        title,
        source_type,
        source_signature,
        embedding_model_key,
        embedding_dimension,
        request.total_chunk_count.max(0),
        "failed",
        Some(error_message),
        Some(now_millis()),
        Some(retry_after_ms),
    )?;

    Ok(())
}

#[tauri::command]
pub fn rag_get_document_index_status(
    app: tauri::AppHandle,
    request: RagIndexStatusRequest,
) -> Result<Option<RagDocumentIndexStatus>, String> {
    let document_key = request.document_key.trim();
    let source_type = normalize_source_type(&request.source_type)?;

    if document_key.is_empty() {
        return Err("documentKey 不能为空".to_string());
    }

    let connection = open_library_connection(&app)?;
    migrate_rag_schema(&connection)?;
    let record = read_document_record(&connection, document_key, source_type)?;

    let Some(record) = record else {
        return Ok(None);
    };

    let chunk_count = count_indexed_chunks(&connection, document_key, source_type)?;
    let cooldown_until = match (record.failed_at, record.retry_after_ms) {
        (Some(failed_at), Some(retry_after_ms)) => Some(failed_at.saturating_add(retry_after_ms)),
        _ => None,
    };

    Ok(Some(RagDocumentIndexStatus {
        document_key: record.document_key,
        source_type: record.source_type,
        source_signature: record.source_signature,
        embedding_model_key: record.embedding_model_key,
        embedding_dimension: record.embedding_dimension,
        total_chunk_count: record.total_chunk_count,
        chunk_count,
        indexed_chunk_count: chunk_count,
        indexed_at: record.updated_at,
        status: record.status,
        last_error: record.last_error,
        failed_at: record.failed_at,
        retry_after_ms: record.retry_after_ms,
        cooldown_until,
    }))
}

#[tauri::command]
pub fn rag_retrieve_document_chunks(
    app: tauri::AppHandle,
    request: RagRetrieveDocumentRequest,
) -> Result<Vec<RagRetrievalResult>, String> {
    let document_key = request.document_key.trim();

    if document_key.is_empty() {
        return Err("documentKey 不能为空".to_string());
    }

    let connection = open_library_connection(&app)?;
    migrate_rag_schema(&connection)?;

    let source_type = request
        .source_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(normalize_source_type)
        .transpose()?;

    let record = if let Some(source_type) = source_type {
        read_document_record(&connection, document_key, source_type)?
    } else {
        connection
            .query_row(
                "
                select
                  document_key,
                  source_type,
                  source_signature,
                  embedding_model_key,
                  embedding_dimension,
                  total_chunk_count,
                  updated_at,
                  status,
                  last_error,
                  failed_at,
                  retry_after_ms
                from rag_documents
                where document_key = ?1 and status = 'ready'
                order by updated_at desc
                limit 1
                ",
                params![document_key],
                |row| {
                    Ok(RagDocumentRecord {
                        document_key: row.get(0)?,
                        source_type: row.get(1)?,
                        source_signature: row.get(2)?,
                        embedding_model_key: row.get(3)?,
                        embedding_dimension: row.get(4)?,
                        total_chunk_count: row.get(5)?,
                        updated_at: row.get(6)?,
                        status: row.get(7)?,
                        last_error: row.get(8)?,
                        failed_at: row.get(9)?,
                        retry_after_ms: row.get(10)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("读取本地 RAG 文档状态失败: {}", error))?
    };

    let Some(record) = record else {
        return Ok(Vec::new());
    };

    if record.embedding_dimension <= 0 {
        return Ok(Vec::new());
    }

    if request.query_embedding.len() as i64 != record.embedding_dimension {
        return Err(format!(
            "查询向量维度不匹配，索引为 {} 维，当前请求为 {} 维",
            record.embedding_dimension,
            request.query_embedding.len()
        ));
    }

    let vector_table_name = rag_vector_table_name(record.embedding_dimension)?;
    let query_blob = embedding_bytes(&request.query_embedding);
    let top_k = request.top_k.clamp(1, 12) as i64;
    let sql = if source_type.is_some() {
        format!(
            "
            select
              rag_chunks.chunk_id,
              rag_chunks.source_type,
              rag_chunks.page_index,
              rag_chunks.block_id,
              rag_chunks.text,
              {vector_table_name}.distance
            from {vector_table_name}
            join rag_chunks on rag_chunks.id = {vector_table_name}.chunk_row_id
            where {vector_table_name}.embedding match ?1
              and k = ?2
              and {vector_table_name}.document_key = ?3
              and {vector_table_name}.source_type = ?4
            order by {vector_table_name}.distance asc
            "
        )
    } else {
        format!(
            "
            select
              rag_chunks.chunk_id,
              rag_chunks.source_type,
              rag_chunks.page_index,
              rag_chunks.block_id,
              rag_chunks.text,
              {vector_table_name}.distance
            from {vector_table_name}
            join rag_chunks on rag_chunks.id = {vector_table_name}.chunk_row_id
            where {vector_table_name}.embedding match ?1
              and k = ?2
              and {vector_table_name}.document_key = ?3
            order by {vector_table_name}.distance asc
            "
        )
    };

    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("准备本地 RAG 检索语句失败: {}", error))?;

    if let Some(source_type) = source_type {
        let rows = statement
            .query_map(params![query_blob, top_k, document_key, source_type], |row| {
                Ok(RagRetrievalResult {
                    chunk_id: row.get(0)?,
                    source_type: row.get(1)?,
                    page_index: row.get(2)?,
                    block_id: row.get(3)?,
                    text: row.get(4)?,
                    score: row.get(5)?,
                })
            })
            .map_err(|error| format!("执行本地 RAG 检索失败: {}", error))?;

        return rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("读取本地 RAG 检索结果失败: {}", error));
    }

    let rows = statement
        .query_map(params![query_blob, top_k, document_key], |row| {
            Ok(RagRetrievalResult {
                chunk_id: row.get(0)?,
                source_type: row.get(1)?,
                page_index: row.get(2)?,
                block_id: row.get(3)?,
                text: row.get(4)?,
                score: row.get(5)?,
            })
        })
        .map_err(|error| format!("执行本地 RAG 检索失败: {}", error))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取本地 RAG 检索结果失败: {}", error))
}

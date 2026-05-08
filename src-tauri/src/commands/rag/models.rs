use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagEmbeddingOptions {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub dimensions: Option<i64>,
    pub timeout_seconds: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagEmbedTextRequest {
    pub text: String,
    pub embedding: RagEmbeddingOptions,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagChunkInput {
    pub chunk_id: String,
    pub chunk_index: i64,
    pub page_index: Option<i64>,
    pub block_id: Option<String>,
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagEmbedChunksRequest {
    pub chunks: Vec<RagChunkInput>,
    pub embedding: RagEmbeddingOptions,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagIndexedChunkInput {
    pub chunk_id: String,
    pub chunk_index: i64,
    pub page_index: Option<i64>,
    pub block_id: Option<String>,
    pub text: String,
    pub embedding: Vec<f32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagIndexDocumentRequest {
    pub document_key: String,
    pub title: String,
    pub source_type: String,
    pub source_signature: String,
    pub embedding_model_key: String,
    pub total_chunk_count: i64,
    pub chunks: Vec<RagIndexedChunkInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagRetrieveDocumentRequest {
    pub document_key: String,
    pub source_type: Option<String>,
    pub query_embedding: Vec<f32>,
    pub top_k: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagIndexStatusRequest {
    pub document_key: String,
    pub source_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagReportDocumentIndexFailureRequest {
    pub document_key: String,
    pub title: String,
    pub source_type: String,
    pub source_signature: String,
    pub embedding_model_key: String,
    pub total_chunk_count: i64,
    pub error_message: String,
    pub retry_after_ms: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagRetrievalResult {
    pub chunk_id: String,
    pub source_type: String,
    pub page_index: Option<i64>,
    pub block_id: Option<String>,
    pub text: String,
    pub score: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagDocumentIndexStatus {
    pub document_key: String,
    pub source_type: String,
    pub source_signature: String,
    pub embedding_model_key: String,
    pub embedding_dimension: i64,
    pub total_chunk_count: i64,
    pub chunk_count: i64,
    pub indexed_chunk_count: i64,
    pub indexed_at: i64,
    pub status: String,
    pub last_error: Option<String>,
    pub failed_at: Option<i64>,
    pub retry_after_ms: Option<i64>,
    pub cooldown_until: Option<i64>,
}

#[derive(Debug)]
pub struct RagDocumentRecord {
    pub document_key: String,
    pub source_type: String,
    pub source_signature: String,
    pub embedding_model_key: String,
    pub embedding_dimension: i64,
    pub total_chunk_count: i64,
    pub updated_at: i64,
    pub status: String,
    pub last_error: Option<String>,
    pub failed_at: Option<i64>,
    pub retry_after_ms: Option<i64>,
}

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySettings {
    pub storage_dir: String,
    pub zotero_local_data_dir: String,
    pub import_mode: String,
    pub auto_rename_files: bool,
    pub file_naming_rule: String,
    pub create_category_folders: bool,
    pub folder_watch_enabled: bool,
    pub backup_enabled: bool,
    pub preserve_original_path: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiteratureAuthor {
    pub id: String,
    pub name: String,
    pub given_name: Option<String>,
    pub family_name: Option<String>,
    pub sort_order: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiteratureTag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiteratureCategory {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i64,
    pub is_system: bool,
    pub system_key: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub paper_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiteratureAttachment {
    pub id: String,
    pub paper_id: String,
    pub kind: String,
    pub original_path: Option<String>,
    pub stored_path: String,
    pub relative_path: Option<String>,
    pub file_name: String,
    pub mime_type: String,
    pub file_size: i64,
    pub content_hash: Option<String>,
    pub created_at: i64,
    pub missing: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiteraturePaper {
    pub id: String,
    pub title: String,
    pub year: Option<String>,
    pub publication: Option<String>,
    pub doi: Option<String>,
    pub url: Option<String>,
    pub abstract_text: Option<String>,
    pub keywords: Vec<String>,
    pub imported_at: i64,
    pub updated_at: i64,
    pub last_read_at: Option<i64>,
    pub reading_progress: f64,
    pub is_favorite: bool,
    pub user_note: Option<String>,
    pub ai_summary: Option<String>,
    pub citation: Option<String>,
    pub source: String,
    pub sort_order: i64,
    pub authors: Vec<LiteratureAuthor>,
    pub tags: Vec<LiteratureTag>,
    pub category_ids: Vec<String>,
    pub attachments: Vec<LiteratureAttachment>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    pub settings: LibrarySettings,
    pub categories: Vec<LiteratureCategory>,
    pub papers: Vec<LiteraturePaper>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPapersRequest {
    pub category_id: Option<String>,
    pub tag_id: Option<String>,
    pub search: Option<String>,
    pub sort_by: Option<String>,
    pub sort_direction: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCategoryRequest {
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCategoryRequest {
    pub id: String,
    pub name: Option<String>,
    pub parent_id: Option<String>,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPdfMetadata {
    pub title: Option<String>,
    pub year: Option<String>,
    pub publication: Option<String>,
    pub doi: Option<String>,
    pub url: Option<String>,
    pub abstract_text: Option<String>,
    pub keywords: Option<Vec<String>>,
    pub authors: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPdfRequest {
    pub paths: Vec<String>,
    pub target_category_id: Option<String>,
    pub import_mode: Option<String>,
    pub metadata: Option<HashMap<String, ImportPdfMetadata>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPdfResult {
    pub source_path: String,
    pub paper: Option<LiteraturePaper>,
    pub duplicated: bool,
    pub existing_paper_id: Option<String>,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelocateAttachmentRequest {
    pub attachment_id: String,
    pub new_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignPaperCategoryRequest {
    pub paper_id: String,
    pub category_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePaperRequest {
    pub paper_id: String,
    pub title: Option<String>,
    pub year: Option<Option<String>>,
    pub publication: Option<Option<String>>,
    pub doi: Option<Option<String>>,
    pub url: Option<Option<String>>,
    pub abstract_text: Option<Option<String>>,
    pub keywords: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
    pub authors: Option<Vec<String>>,
    pub user_note: Option<Option<String>>,
    pub ai_summary: Option<Option<String>>,
    pub citation: Option<Option<String>>,
    pub is_favorite: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePaperRequest {
    pub paper_id: String,
    pub delete_files: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderPapersRequest {
    pub paper_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveCategoryRequest {
    pub category_id: String,
    pub parent_id: Option<String>,
    pub sort_order: Option<i64>,
}

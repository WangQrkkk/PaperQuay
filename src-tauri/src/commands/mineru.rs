use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;
use zip::ZipArchive;

const MINERU_API_BASE: &str = "https://mineru.net/api/v4";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MineruCloudParseOptions {
    api_token: String,
    pdf_path: String,
    extract_dir: Option<String>,
    language: Option<String>,
    model_version: Option<String>,
    enable_formula: Option<bool>,
    enable_table: Option<bool>,
    is_ocr: Option<bool>,
    timeout_secs: Option<u64>,
    poll_interval_secs: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MineruCloudParseOutput {
    batch_id: String,
    data_id: String,
    file_name: String,
    state: String,
    full_zip_url: String,
    content_json_text: Option<String>,
    middle_json_text: Option<String>,
    markdown_text: Option<String>,
    asset_root_dir: Option<String>,
    content_json_path: Option<String>,
    middle_json_path: Option<String>,
    markdown_path: Option<String>,
    zip_entries: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct MineruApiEnvelope<T> {
    code: i64,
    msg: Option<String>,
    message: Option<String>,
    data: Option<T>,
}

#[derive(Debug, Deserialize)]
struct UploadUrlData {
    batch_id: String,
    file_urls: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct BatchResultData {
    extract_result: ExtractResultList,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ExtractResultList {
    Many(Vec<ExtractResult>),
    One(ExtractResult),
}

impl ExtractResultList {
    fn into_vec(self) -> Vec<ExtractResult> {
        match self {
            ExtractResultList::Many(results) => results,
            ExtractResultList::One(result) => vec![result],
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
struct ExtractResult {
    file_name: Option<String>,
    state: String,
    err_msg: Option<String>,
    full_zip_url: Option<String>,
    data_id: Option<String>,
}

struct ZipTexts {
    content_json_text: Option<String>,
    middle_json_text: Option<String>,
    markdown_text: Option<String>,
    zip_entries: Vec<String>,
}

struct ExtractedZipPaths {
    asset_root_dir: String,
    content_json_path: Option<String>,
    middle_json_path: Option<String>,
    markdown_path: Option<String>,
}

fn validate_pdf_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("PDF 文件不存在：{}", path.display()));
    }

    if !path.is_file() {
        return Err(format!("路径不是 PDF 文件：{}", path.display()));
    }

    Ok(())
}

fn file_name_from_path(path: &Path) -> Result<String, String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| {
            if name.to_ascii_lowercase().ends_with(".pdf") {
                name.to_string()
            } else {
                format!("{}.pdf", name)
            }
        })
        .ok_or_else(|| "无法从路径中获取 PDF 文件名".to_string())
}

fn build_data_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();

    format!("paper_reader_{}", millis)
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn build_extract_dir(preferred_dir: Option<String>) -> PathBuf {
    if let Some(directory) = preferred_dir.filter(|value| !value.trim().is_empty()) {
        return PathBuf::from(directory);
    }

    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();

    std::env::temp_dir().join(format!("paper_reader_mineru_{}", millis))
}

fn sanitize_zip_entry_path(name: &str) -> Result<PathBuf, String> {
    let mut output = PathBuf::new();

    for component in Path::new(name).components() {
        match component {
            Component::Normal(segment) => output.push(segment),
            Component::CurDir => {}
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                return Err(format!("MinerU zip 条目路径非法：{}", name));
            }
        }
    }

    if output.as_os_str().is_empty() {
        return Err(format!("MinerU zip 条目路径为空：{}", name));
    }

    Ok(output)
}

fn update_selected_path(target: &mut Option<(i32, String)>, priority: i32, path: String) {
    if priority == 0 {
        return;
    }

    if priority
        > target
            .as_ref()
            .map(|(current_priority, _)| *current_priority)
            .unwrap_or(0)
    {
        *target = Some((priority, path));
    }
}

fn api_error<T>(envelope: MineruApiEnvelope<T>, context: &str) -> String {
    let message = envelope
        .msg
        .or(envelope.message)
        .unwrap_or_else(|| "未知错误".to_string());

    format!(
        "{}失败，code={}，message={}",
        context, envelope.code, message
    )
}

async fn parse_json_response<T: DeserializeOwned>(
    response: reqwest::Response,
    context: &str,
) -> Result<MineruApiEnvelope<T>, String> {
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取{}响应失败：{}", context, error))?;

    if !status.is_success() {
        return Err(format!("{} HTTP 状态异常：{}，{}", context, status, text));
    }

    serde_json::from_str::<MineruApiEnvelope<T>>(&text).map_err(|error| {
        format!(
            "解析{}响应 JSON 失败：{}，原始响应：{}",
            context, error, text
        )
    })
}

fn into_api_data<T>(envelope: MineruApiEnvelope<T>, context: &str) -> Result<T, String> {
    if envelope.code != 0 {
        return Err(api_error(envelope, context));
    }

    envelope
        .data
        .ok_or_else(|| format!("{}响应缺少 data 字段", context))
}

fn pick_extract_result(
    results: Vec<ExtractResult>,
    data_id: &str,
    file_name: &str,
) -> Result<ExtractResult, String> {
    results
        .iter()
        .find(|result| result.data_id.as_deref() == Some(data_id))
        .cloned()
        .or_else(|| {
            results
                .iter()
                .find(|result| result.file_name.as_deref() == Some(file_name))
                .cloned()
        })
        .or_else(|| results.first().cloned())
        .ok_or_else(|| "MinerU 批量结果为空".to_string())
}

fn read_zip_texts(zip_bytes: &[u8]) -> Result<ZipTexts, String> {
    let cursor = Cursor::new(zip_bytes);
    let mut archive =
        ZipArchive::new(cursor).map_err(|error| format!("读取结果 zip 失败：{}", error))?;
    let mut zip_entries = Vec::new();
    let mut selected_content: Option<(i32, String)> = None;
    let mut selected_middle: Option<(i32, String)> = None;
    let mut selected_markdown: Option<(i32, String)> = None;

    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("读取 zip 条目失败：{}", error))?;

        if file.is_dir() {
            continue;
        }

        let name = file.name().replace('\\', "/");
        let lower_name = name.to_lowercase();
        zip_entries.push(name);

        let content_priority = if lower_name.ends_with("content_list_v2.json") {
            3
        } else if lower_name.ends_with("content_list.json") || lower_name.contains("_content_list")
        {
            2
        } else {
            0
        };
        let middle_priority =
            if lower_name.ends_with("middle.json") || lower_name.contains("_middle") {
                3
            } else if lower_name.ends_with("layout.json") {
                2
            } else {
                0
            };
        let markdown_priority = if lower_name.ends_with("full.md") {
            3
        } else if lower_name.ends_with(".md") {
            1
        } else {
            0
        };
        let priority = content_priority.max(middle_priority).max(markdown_priority);

        if priority == 0 {
            continue;
        }

        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|error| format!("读取 zip 文本条目失败：{}", error))?;
        let text = String::from_utf8_lossy(&bytes).into_owned();

        if content_priority
            > selected_content
                .as_ref()
                .map(|(priority, _)| *priority)
                .unwrap_or(0)
        {
            selected_content = Some((content_priority, text.clone()));
        }

        if middle_priority
            > selected_middle
                .as_ref()
                .map(|(priority, _)| *priority)
                .unwrap_or(0)
        {
            selected_middle = Some((middle_priority, text.clone()));
        }

        if markdown_priority
            > selected_markdown
                .as_ref()
                .map(|(priority, _)| *priority)
                .unwrap_or(0)
        {
            selected_markdown = Some((markdown_priority, text));
        }
    }

    Ok(ZipTexts {
        content_json_text: selected_content.map(|(_, text)| text),
        middle_json_text: selected_middle.map(|(_, text)| text),
        markdown_text: selected_markdown.map(|(_, text)| text),
        zip_entries,
    })
}

fn extract_zip_files(zip_bytes: &[u8], extract_dir: &Path) -> Result<ExtractedZipPaths, String> {
    fs::create_dir_all(extract_dir).map_err(|error| {
        format!(
            "创建 MinerU 解析目录失败：{}，{}",
            extract_dir.display(),
            error
        )
    })?;

    let cursor = Cursor::new(zip_bytes);
    let mut archive =
        ZipArchive::new(cursor).map_err(|error| format!("读取 MinerU zip 文件失败：{}", error))?;
    let mut content_json_path: Option<(i32, String)> = None;
    let mut middle_json_path: Option<(i32, String)> = None;
    let mut markdown_path: Option<(i32, String)> = None;

    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("读取 MinerU zip 条目失败：{}", error))?;
        let raw_name = file.name().replace('\\', "/");

        if raw_name.trim().is_empty() {
            continue;
        }

        let relative_path = sanitize_zip_entry_path(&raw_name)?;
        let output_path = extract_dir.join(&relative_path);

        if file.is_dir() {
            fs::create_dir_all(&output_path).map_err(|error| {
                format!("创建 MinerU 目录失败：{}，{}", output_path.display(), error)
            })?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!("创建 MinerU 目录失败：{}，{}", parent.display(), error)
            })?;
        }

        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|error| format!("解压 MinerU 条目失败：{}，{}", raw_name, error))?;
        fs::write(&output_path, bytes).map_err(|error| {
            format!("写入 MinerU 条目失败：{}，{}", output_path.display(), error)
        })?;

        let lower_name = raw_name.to_lowercase();
        let output_path_string = path_to_string(&output_path);
        let content_priority = if lower_name.ends_with("content_list_v2.json") {
            3
        } else if lower_name.ends_with("content_list.json") || lower_name.contains("_content_list")
        {
            2
        } else {
            0
        };
        let middle_priority =
            if lower_name.ends_with("middle.json") || lower_name.contains("_middle") {
                3
            } else if lower_name.ends_with("layout.json") {
                2
            } else {
                0
            };
        let markdown_priority = if lower_name.ends_with("full.md") {
            3
        } else if lower_name.ends_with(".md") {
            1
        } else {
            0
        };

        update_selected_path(
            &mut content_json_path,
            content_priority,
            output_path_string.clone(),
        );
        update_selected_path(
            &mut middle_json_path,
            middle_priority,
            output_path_string.clone(),
        );
        update_selected_path(&mut markdown_path, markdown_priority, output_path_string);
    }

    Ok(ExtractedZipPaths {
        asset_root_dir: path_to_string(extract_dir),
        content_json_path: content_json_path.map(|(_, path)| path),
        middle_json_path: middle_json_path.map(|(_, path)| path),
        markdown_path: markdown_path.map(|(_, path)| path),
    })
}

#[tauri::command]
pub async fn run_mineru_cloud_parse(
    options: MineruCloudParseOptions,
) -> Result<MineruCloudParseOutput, String> {
    let token = options.api_token.trim().to_string();

    if token.is_empty() {
        return Err("MinerU API Token 不能为空".to_string());
    }

    let pdf_path = PathBuf::from(options.pdf_path);
    validate_pdf_path(&pdf_path)?;
    let file_name = file_name_from_path(&pdf_path)?;
    let data_id = build_data_id();
    let language = options.language.unwrap_or_else(|| "ch".to_string());
    let model_version = options.model_version.unwrap_or_else(|| "vlm".to_string());
    let enable_formula = options.enable_formula.unwrap_or(true);
    let enable_table = options.enable_table.unwrap_or(true);
    let is_ocr = options.is_ocr.unwrap_or(false);
    let timeout = Duration::from_secs(options.timeout_secs.unwrap_or(900));
    let poll_interval = Duration::from_secs(options.poll_interval_secs.unwrap_or(5).max(1));

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("创建 HTTP 客户端失败：{}", error))?;

    let upload_url_endpoint = format!(
        "{}/file-urls/batch?enable_formula={}&enable_table={}&language={}",
        MINERU_API_BASE, enable_formula, enable_table, language
    );
    let upload_body = json!({
      "files": [
        {
          "name": file_name.clone(),
          "data_id": data_id.clone()
        }
      ],
      "model_version": model_version,
      "is_ocr": is_ocr
    });
    let upload_response = client
        .post(upload_url_endpoint)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .json(&upload_body)
        .send()
        .await
        .map_err(|error| format!("申请 MinerU 上传地址失败：{}", error))?;
    let upload_data = into_api_data(
        parse_json_response::<UploadUrlData>(upload_response, "申请 MinerU 上传地址").await?,
        "申请 MinerU 上传地址",
    )?;
    let upload_url = upload_data
        .file_urls
        .first()
        .cloned()
        .ok_or_else(|| "MinerU 未返回上传地址".to_string())?;
    let pdf_bytes = fs::read(&pdf_path)
        .map_err(|error| format!("读取 PDF 文件失败：{}，{}", pdf_path.display(), error))?;
    let upload_file_response = client
        .put(upload_url)
        .body(pdf_bytes)
        .send()
        .await
        .map_err(|error| format!("上传 PDF 到 MinerU 失败：{}", error))?;

    if !upload_file_response.status().is_success() {
        let status = upload_file_response.status();
        let text = upload_file_response.text().await.unwrap_or_default();

        return Err(format!(
            "上传 PDF 到 MinerU 失败（HTTP {}）：{}",
            status, text
        ));
    }

    let start = Instant::now();
    let final_result = loop {
        if start.elapsed() > timeout {
            return Err(format!(
                "等待 MinerU 云端解析超时，batch_id：{}",
                upload_data.batch_id
            ));
        }

        let status_endpoint = format!(
            "{}/extract-results/batch/{}",
            MINERU_API_BASE, upload_data.batch_id
        );
        let status_response = client
            .get(status_endpoint)
            .header(AUTHORIZATION, format!("Bearer {}", token))
            .header(ACCEPT, "*/*")
            .send()
            .await
            .map_err(|error| format!("查询 MinerU 云端任务失败：{}", error))?;
        let status_data = into_api_data(
            parse_json_response::<BatchResultData>(status_response, "查询 MinerU 云端任务").await?,
            "查询 MinerU 云端任务",
        )?;
        let current_result =
            pick_extract_result(status_data.extract_result.into_vec(), &data_id, &file_name)?;

        match current_result.state.as_str() {
            "done" => break current_result,
            "failed" => {
                return Err(format!(
                    "MinerU 云端解析失败：{}",
                    current_result
                        .err_msg
                        .unwrap_or_else(|| "未知错误".to_string())
                ));
            }
            "waiting-file" | "pending" | "running" | "converting" | "uploading" => {
                tokio::time::sleep(poll_interval).await;
            }
            other => {
                return Err(format!("MinerU 云端任务状态未知：{}", other));
            }
        }
    };

    let full_zip_url = final_result
        .full_zip_url
        .clone()
        .ok_or_else(|| "MinerU 云端结果缺少 full_zip_url".to_string())?;
    let zip_response = client
        .get(&full_zip_url)
        .send()
        .await
        .map_err(|error| format!("下载 MinerU 结果 zip 失败：{}", error))?;
    let zip_status = zip_response.status();

    if !zip_status.is_success() {
        let text = zip_response.text().await.unwrap_or_default();

        return Err(format!(
            "下载 MinerU 结果 zip 失败，HTTP 状态：{}，{}",
            zip_status, text
        ));
    }

    let zip_bytes = zip_response
        .bytes()
        .await
        .map_err(|error| format!("读取 MinerU 结果 zip 失败：{}", error))?;
    let zip_texts = read_zip_texts(&zip_bytes)?;
    let extracted_paths = extract_zip_files(&zip_bytes, &build_extract_dir(options.extract_dir))?;

    Ok(MineruCloudParseOutput {
        batch_id: upload_data.batch_id,
        data_id,
        file_name,
        state: final_result.state,
        full_zip_url,
        content_json_text: zip_texts.content_json_text,
        middle_json_text: zip_texts.middle_json_text,
        markdown_text: zip_texts.markdown_text,
        asset_root_dir: Some(extracted_paths.asset_root_dir),
        content_json_path: extracted_paths.content_json_path,
        middle_json_path: extracted_paths.middle_json_path,
        markdown_path: extracted_paths.markdown_path,
        zip_entries: zip_texts.zip_entries,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_name_from_path_appends_pdf_extension_when_missing() {
        let path = Path::new("C:/papers/Jiawei C");

        let file_name = file_name_from_path(path).expect("resolve upload file name");

        assert_eq!(file_name, "Jiawei C.pdf");
    }
}

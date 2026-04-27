use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rfd::FileDialog;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDefaultPaths {
  executable_dir: String,
  config_path: String,
  mineru_cache_dir: String,
  remote_pdf_download_dir: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryFileEntry {
  path: String,
  name: String,
  size: u64,
  modified_at_ms: u64,
}

fn ensure_file(path: &Path) -> Result<(), String> {
  if !path.exists() {
    return Err(format!("文件不存在：{}", path.display()));
  }

  if !path.is_file() {
    return Err(format!("路径不是文件：{}", path.display()));
  }

  Ok(())
}

fn path_to_string(path: PathBuf) -> Result<String, String> {
  path
    .into_os_string()
    .into_string()
    .map_err(|_| "閺傚洣娆㈢捄顖氱窞閸栧懎鎯堥弮鐘崇《婢跺嫮鎮婇惃鍕摟缁?.to_string())
}

fn resolve_executable_dir() -> Result<PathBuf, String> {
  let executable_path = std::env::current_exe()
    .map_err(|error| format!("读取当前可执行文件路径失败：{}", error))?;

  if let Some(parent) = executable_path.parent() {
    return Ok(parent.to_path_buf());
  }

  std::env::current_dir().map_err(|error| format!("读取当前工作目录失败：{}", error))
}

#[tauri::command]
pub fn get_app_default_paths() -> Result<AppDefaultPaths, String> {
  let executable_dir = resolve_executable_dir()?;
  let data_dir = executable_dir.join("paperquay-data");

  Ok(AppDefaultPaths {
    executable_dir: path_to_string(executable_dir)?,
    config_path: path_to_string(data_dir.join("paperquay.config.json"))?,
    mineru_cache_dir: path_to_string(data_dir.join("mineru-cache"))?,
    remote_pdf_download_dir: path_to_string(data_dir.join("pdfs"))?,
  })
}

#[tauri::command]
pub fn select_pdf_file() -> Result<Option<String>, String> {
  FileDialog::new()
    .add_filter("PDF", &["pdf"])
    .pick_file()
    .map(path_to_string)
    .transpose()
}

#[tauri::command]
pub fn select_json_file() -> Result<Option<String>, String> {
  FileDialog::new()
    .add_filter("JSON", &["json"])
    .pick_file()
    .map(path_to_string)
    .transpose()
}

#[tauri::command]
pub fn select_attachment_files(kind: Option<String>) -> Result<Option<Vec<String>>, String> {
  let kind = kind.unwrap_or_else(|| "file".to_string());
  let mut dialog = FileDialog::new();

  if kind == "image" {
    dialog = dialog.add_filter("Images", &["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"]);
  } else {
    dialog = dialog.add_filter(
      "Attachments",
      &[
        "png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "txt", "md", "json", "csv", "yaml",
        "yml", "xml", "html", "pdf",
      ],
    );
  }

  dialog
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
pub fn select_directory(title: Option<String>) -> Result<Option<String>, String> {
  let dialog = if let Some(next_title) = title {
    FileDialog::new().set_title(&next_title)
  } else {
    FileDialog::new()
  };

  dialog.pick_folder().map(path_to_string).transpose()
}

#[tauri::command]
pub fn list_directory_files(
  directory: String,
  extension_filter: Option<String>,
) -> Result<Vec<DirectoryFileEntry>, String> {
  let directory_path = PathBuf::from(&directory);

  if !directory_path.exists() {
    return Ok(Vec::new());
  }

  if !directory_path.is_dir() {
    return Err(format!("路径不是目录：{}", directory_path.display()));
  }

  let normalized_extension = extension_filter
    .unwrap_or_default()
    .trim()
    .trim_start_matches('.')
    .to_ascii_lowercase();

  let mut entries = fs::read_dir(&directory_path)
    .map_err(|error| format!("读取目录失败：{}，{}", directory_path.display(), error))?
    .filter_map(|entry| entry.ok())
    .filter_map(|entry| {
      let path = entry.path();

      if !path.is_file() {
        return None;
      }

      if !normalized_extension.is_empty() {
        let matches_extension = path
          .extension()
          .and_then(|value| value.to_str())
          .map(|value| value.eq_ignore_ascii_case(&normalized_extension))
          .unwrap_or(false);

        if !matches_extension {
          return None;
        }
      }

      let metadata = entry.metadata().ok()?;
      let name = path.file_name()?.to_str()?.to_string();
      let modified_at_ms = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0);

      Some(DirectoryFileEntry {
        path: path_to_string(path).ok()?,
        name,
        size: metadata.len(),
        modified_at_ms,
      })
    })
    .collect::<Vec<_>>();

  entries.sort_by(|left, right| {
    right
      .modified_at_ms
      .cmp(&left.modified_at_ms)
      .then_with(|| left.name.cmp(&right.name))
  });

  Ok(entries)
}

#[tauri::command]
pub fn select_save_pdf_path(
  suggested_file_name: Option<String>,
  initial_directory: Option<String>,
) -> Result<Option<String>, String> {
  let mut dialog = FileDialog::new().add_filter("PDF", &["pdf"]);

  if let Some(next_name) = suggested_file_name {
    dialog = dialog.set_file_name(&next_name);
  }

  if let Some(next_directory) = initial_directory {
    dialog = dialog.set_directory(next_directory);
  }

  dialog.save_file().map(path_to_string).transpose()
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
  let file_path = PathBuf::from(path);
  ensure_file(&file_path)?;

  fs::read_to_string(&file_path)
    .map_err(|error| format!("读取文本文件失败：{}，{}", file_path.display(), error))
}

#[tauri::command]
pub fn read_binary_file_base64(path: String) -> Result<String, String> {
  let file_path = PathBuf::from(path);
  ensure_file(&file_path)?;

  let bytes = fs::read(&file_path)
    .map_err(|error| format!("读取二进制文件失败：{}，{}", file_path.display(), error))?;

  Ok(STANDARD.encode(bytes))
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
  let file_path = PathBuf::from(path);

  if let Some(parent) = file_path.parent() {
    fs::create_dir_all(parent)
      .map_err(|error| format!("创建目录失败：{}，{}", parent.display(), error))?;
  }

  fs::write(&file_path, content)
    .map_err(|error| format!("写入文本文件失败：{}，{}", file_path.display(), error))
}

#[tauri::command]
pub fn write_binary_file_base64(path: String, content_base64: String) -> Result<(), String> {
  let file_path = PathBuf::from(path);

  if let Some(parent) = file_path.parent() {
    fs::create_dir_all(parent)
      .map_err(|error| format!("创建目录失败：{}，{}", parent.display(), error))?;
  }

  let bytes = STANDARD
    .decode(content_base64)
    .map_err(|error| format!("解码 Base64 失败：{}", error))?;

  fs::write(&file_path, bytes)
    .map_err(|error| format!("写入二进制文件失败：{}，{}", file_path.display(), error))
}

#[tauri::command]
pub async fn download_remote_file_to_path(
  url: String,
  path: String,
  headers: Option<HashMap<String, String>>,
) -> Result<(), String> {
  let client = reqwest::Client::new();
  let mut request = client.get(&url);

  if let Some(next_headers) = headers {
    for (key, value) in next_headers {
      request = request.header(&key, &value);
    }
  }

  let response = request
    .send()
    .await
    .map_err(|error| format!("下载远程文件失败：{}，{}", url, error))?;

  if !response.status().is_success() {
    return Err(format!(
      "下载远程文件响应异常：{}，HTTP {}",
      url,
      response.status()
    ));
  }

  let bytes = response
    .bytes()
    .await
    .map_err(|error| format!("读取远程文件响应失败：{}，{}", url, error))?;

  let file_path = PathBuf::from(path);

  if let Some(parent) = file_path.parent() {
    fs::create_dir_all(parent)
      .map_err(|error| format!("创建目录失败：{}，{}", parent.display(), error))?;
  }

  fs::write(&file_path, bytes)
    .map_err(|error| format!("保存远程文件失败：{}，{}", file_path.display(), error))
}

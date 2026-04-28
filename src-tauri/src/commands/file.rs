use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(target_os = "windows")]
use arboard::{Clipboard, ImageData};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
#[cfg(target_os = "windows")]
use image::{codecs::png::PngEncoder, ColorType, ImageEncoder};
use rfd::FileDialog;
use serde::Serialize;
#[cfg(target_os = "windows")]
use std::collections::hash_map::DefaultHasher;
#[cfg(target_os = "windows")]
use std::hash::{Hash, Hasher};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
use std::thread;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
#[cfg(target_os = "windows")]
use std::time::{Duration, Instant};

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedScreenshot {
    path: String,
    name: String,
    mime_type: String,
    size: u64,
}

static APPROVED_WRITE_PATHS: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();

fn ensure_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("File does not exist: {}", path.display()));
    }

    if !path.is_file() {
        return Err(format!("Path is not a file: {}", path.display()));
    }

    Ok(())
}

fn path_to_string(path: PathBuf) -> Result<String, String> {
    path.into_os_string()
        .into_string()
        .map_err(|_| "Path contains non-Unicode characters".to_string())
}

fn normalize_absolute_path(path: &Path) -> Result<PathBuf, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| format!("Failed to resolve current directory: {}", error))?
            .join(path)
    };
    let mut normalized = PathBuf::new();

    for component in absolute.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
        }
    }

    Ok(normalized)
}

fn approved_write_paths() -> &'static Mutex<HashSet<PathBuf>> {
    APPROVED_WRITE_PATHS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn remember_approved_write_path(path: &Path) -> Result<(), String> {
    let normalized = normalize_absolute_path(path)?;
    let mut guard = approved_write_paths()
        .lock()
        .map_err(|_| "Failed to lock approved write paths".to_string())?;
    guard.insert(normalized);
    Ok(())
}

fn is_within_path(parent: &Path, candidate: &Path) -> Result<bool, String> {
    let normalized_parent = normalize_absolute_path(parent)?;
    let normalized_candidate = normalize_absolute_path(candidate)?;

    Ok(
        normalized_candidate == normalized_parent
            || normalized_candidate.starts_with(&normalized_parent),
    )
}

fn app_managed_write_roots() -> Result<Vec<PathBuf>, String> {
    let executable_dir = resolve_executable_dir()?;

    Ok(vec![
        executable_dir.join(".settings"),
        executable_dir.join(".mineru-cache"),
        executable_dir.join(".downloads"),
        executable_dir.join(".screenshots"),
        executable_dir.join("paperquay-data"),
    ])
}

fn is_approved_write_path(path: &Path) -> Result<bool, String> {
    let normalized = normalize_absolute_path(path)?;
    let guard = approved_write_paths()
        .lock()
        .map_err(|_| "Failed to lock approved write paths".to_string())?;

    Ok(guard.contains(&normalized))
}

fn ensure_writable_path_allowed(path: &Path) -> Result<(), String> {
    if app_managed_write_roots()?
        .iter()
        .any(|root| is_within_path(root, path).unwrap_or(false))
    {
        return Ok(());
    }

    if is_approved_write_path(path)? {
        return Ok(());
    }

    Err(format!(
        "Writing to this path is not allowed until the user explicitly approves it: {}",
        path.display()
    ))
}

fn resolve_executable_dir() -> Result<PathBuf, String> {
    let executable_path = std::env::current_exe()
        .map_err(|error| format!("Failed to resolve executable path: {}", error))?;

    if let Some(parent) = executable_path.parent() {
        return Ok(parent.to_path_buf());
    }

    std::env::current_dir()
        .map_err(|error| format!("Failed to resolve current directory: {}", error))
}

fn current_unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn file_exists_with_content(path: &Path) -> bool {
    fs::metadata(path)
        .map(|metadata| metadata.is_file() && metadata.len() > 0)
        .unwrap_or(false)
}

fn build_screenshot_output_path() -> Result<PathBuf, String> {
    let output_dir = resolve_executable_dir()?.join(".screenshots");

    fs::create_dir_all(&output_dir).map_err(|error| {
        format!(
            "Failed to create screenshot directory {}: {}",
            output_dir.display(),
            error
        )
    })?;

    Ok(output_dir.join(format!("system-screenshot-{}.png", current_unix_millis())))
}

fn build_captured_screenshot(path: PathBuf) -> Result<CapturedScreenshot, String> {
    let metadata = fs::metadata(&path).map_err(|error| {
        format!(
            "Failed to read screenshot metadata {}: {}",
            path.display(),
            error
        )
    })?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("system-screenshot.png")
        .to_string();

    Ok(CapturedScreenshot {
        path: path_to_string(path)?,
        name,
        mime_type: "image/png".to_string(),
        size: metadata.len(),
    })
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn run_interactive_capture_command(program: &str, args: &[&str]) -> Result<Option<()>, String> {
    match Command::new(program).args(args).status() {
        Ok(status) if status.success() => Ok(Some(())),
        Ok(_) => Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "Failed to launch screenshot command {}: {}",
            program, error
        )),
    }
}

#[cfg(target_os = "macos")]
fn capture_screenshot_to_path(path: &Path) -> Result<bool, String> {
    let path_string = path_to_string(path.to_path_buf())?;
    let launched = run_interactive_capture_command("screencapture", &["-i", "-x", &path_string])?;

    Ok(launched.is_some() && file_exists_with_content(path))
}

#[cfg(target_os = "linux")]
fn capture_screenshot_to_path(path: &Path) -> Result<bool, String> {
    let path_string = path_to_string(path.to_path_buf())?;

    if run_interactive_capture_command("flameshot", &["gui", "-p", &path_string])?.is_some() {
        return Ok(file_exists_with_content(path));
    }

    if run_interactive_capture_command("gnome-screenshot", &["-a", "-f", &path_string])?.is_some() {
        return Ok(file_exists_with_content(path));
    }

    if run_interactive_capture_command("maim", &["-s", &path_string])?.is_some() {
        return Ok(file_exists_with_content(path));
    }

    Err(
    "No supported Linux screenshot tool was found. Install flameshot, gnome-screenshot, or maim."
      .to_string(),
  )
}

#[cfg(target_os = "windows")]
fn clipboard_image_fingerprint(image: &ImageData<'_>) -> u64 {
    let mut hasher = DefaultHasher::new();
    image.width.hash(&mut hasher);
    image.height.hash(&mut hasher);
    image.bytes.hash(&mut hasher);
    hasher.finish()
}

#[cfg(target_os = "windows")]
fn write_clipboard_image_to_png(path: &Path, image: ImageData<'_>) -> Result<(), String> {
    let width =
        u32::try_from(image.width).map_err(|_| "Screenshot width is out of range".to_string())?;
    let height =
        u32::try_from(image.height).map_err(|_| "Screenshot height is out of range".to_string())?;
    let bytes = image.bytes.into_owned();
    let expected_len = usize::try_from(width)
        .unwrap_or_default()
        .saturating_mul(usize::try_from(height).unwrap_or_default())
        .saturating_mul(4);

    if bytes.len() != expected_len {
        return Err("Unexpected clipboard image format".to_string());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create screenshot directory {}: {}",
                parent.display(),
                error
            )
        })?;
    }

    let file = fs::File::create(path).map_err(|error| {
        format!(
            "Failed to create screenshot file {}: {}",
            path.display(),
            error
        )
    })?;
    let encoder = PngEncoder::new(file);

    encoder
        .write_image(&bytes, width, height, ColorType::Rgba8.into())
        .map_err(|error| format!("Failed to encode PNG screenshot: {}", error))
}

#[cfg(target_os = "windows")]
fn capture_screenshot_to_path(path: &Path) -> Result<bool, String> {
    let mut clipboard = Clipboard::new()
        .map_err(|error| format!("Failed to access system clipboard: {}", error))?;
    let previous_fingerprint = clipboard
        .get_image()
        .ok()
        .map(|image| clipboard_image_fingerprint(&image));
    let status = Command::new("cmd")
        .args(["/C", "start", "", "ms-screenclip:"])
        .status()
        .map_err(|error| format!("Failed to launch Windows system screenshot: {}", error))?;

    if !status.success() {
        return Ok(false);
    }

    let started_at = Instant::now();

    while started_at.elapsed() < Duration::from_secs(120) {
        if let Ok(image) = clipboard.get_image() {
            let fingerprint = clipboard_image_fingerprint(&image);

            if Some(fingerprint) != previous_fingerprint {
                write_clipboard_image_to_png(path, image)?;
                return Ok(file_exists_with_content(path));
            }
        }

        thread::sleep(Duration::from_millis(250));
    }

    Ok(false)
}

#[tauri::command]
pub async fn capture_system_screenshot() -> Result<Option<CapturedScreenshot>, String> {
    let output_path = build_screenshot_output_path()?;

    let captured = tokio::task::spawn_blocking({
        let output_path = output_path.clone();
        move || capture_screenshot_to_path(&output_path)
    })
    .await
    .map_err(|error| format!("Failed while waiting for system screenshot: {}", error))??;

    if !captured || !file_exists_with_content(&output_path) {
        return Ok(None);
    }

    build_captured_screenshot(output_path).map(Some)
}

#[tauri::command]
pub fn get_app_default_paths() -> Result<AppDefaultPaths, String> {
    let executable_dir = resolve_executable_dir()?;
    let settings_dir = executable_dir.join(".settings");
    let mineru_cache_dir = executable_dir.join(".mineru-cache");
    let remote_pdf_download_dir = executable_dir.join(".downloads").join("pdfs");

    Ok(AppDefaultPaths {
        executable_dir: path_to_string(executable_dir)?,
        config_path: path_to_string(settings_dir.join("paperquay.config.json"))?,
        mineru_cache_dir: path_to_string(mineru_cache_dir)?,
        remote_pdf_download_dir: path_to_string(remote_pdf_download_dir)?,
    })
}

#[tauri::command]
pub fn approve_write_path(path: String) -> Result<(), String> {
    let file_path = PathBuf::from(path);
    remember_approved_write_path(&file_path)
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
        dialog = dialog.add_filter(
            "Images",
            &["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"],
        );
    } else {
        dialog = dialog.add_filter(
            "Attachments",
            &[
                "png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "txt", "md", "json", "csv",
                "yaml", "yml", "xml", "html", "pdf",
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
        return Err(format!(
            "Path is not a directory: {}",
            directory_path.display()
        ));
    }

    let normalized_extension = extension_filter
        .unwrap_or_default()
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();

    let mut entries = fs::read_dir(&directory_path)
        .map_err(|error| {
            format!(
                "Failed to read directory {}: {}",
                directory_path.display(),
                error
            )
        })?
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

    let selected = dialog.save_file().map(path_to_string).transpose()?;

    if let Some(path) = selected.as_ref() {
        remember_approved_write_path(Path::new(path))?;
    }

    Ok(selected)
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    fs::metadata(PathBuf::from(path))
        .map(|metadata| metadata.is_file() && metadata.len() > 0)
        .unwrap_or(false)
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let file_path = PathBuf::from(path);
    ensure_file(&file_path)?;

    fs::read_to_string(&file_path).map_err(|error| {
        format!(
            "Failed to read text file {}: {}",
            file_path.display(),
            error
        )
    })
}

#[tauri::command]
pub fn read_binary_file_base64(path: String) -> Result<String, String> {
    let file_path = PathBuf::from(path);
    ensure_file(&file_path)?;

    let bytes = fs::read(&file_path).map_err(|error| {
        format!(
            "Failed to read binary file {}: {}",
            file_path.display(),
            error
        )
    })?;

    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    let file_path = PathBuf::from(path);
    ensure_writable_path_allowed(&file_path)?;

    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!("Failed to create directory {}: {}", parent.display(), error)
        })?;
    }

    fs::write(&file_path, content).map_err(|error| {
        format!(
            "Failed to write text file {}: {}",
            file_path.display(),
            error
        )
    })
}

#[tauri::command]
pub fn write_binary_file_base64(path: String, content_base64: String) -> Result<(), String> {
    let file_path = PathBuf::from(path);
    ensure_writable_path_allowed(&file_path)?;

    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!("Failed to create directory {}: {}", parent.display(), error)
        })?;
    }

    let bytes = STANDARD
        .decode(content_base64)
        .map_err(|error| format!("Failed to decode Base64 payload: {}", error))?;

    fs::write(&file_path, bytes).map_err(|error| {
        format!(
            "Failed to write binary file {}: {}",
            file_path.display(),
            error
        )
    })
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let trimmed_url = url.trim();

    if !(trimmed_url.starts_with("https://") || trimmed_url.starts_with("http://")) {
        return Err("Only http and https URLs can be opened".to_string());
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut next = Command::new("rundll32");
        next.args(["url.dll,FileProtocolHandler", trimmed_url]);
        next.creation_flags(CREATE_NO_WINDOW);
        next
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut next = Command::new("open");
        next.arg(trimmed_url);
        next
    };

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    command
        .spawn()
        .map_err(|error| format!("Failed to open external URL {}: {}", trimmed_url, error))?;

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let candidates: [(&str, &[&str]); 4] = [
            ("xdg-open", &[trimmed_url]),
            ("gio", &["open", trimmed_url]),
            ("kde-open", &[trimmed_url]),
            ("gnome-open", &[trimmed_url]),
        ];
        let mut last_error = None;

        for (program, args) in candidates {
            match Command::new(program).args(args).spawn() {
                Ok(_) => return Ok(()),
                Err(error) => {
                    last_error = Some(format!("{}: {}", program, error));
                }
            }
        }

        return Err(format!(
            "Failed to open external URL {}: {}",
            trimmed_url,
            last_error.unwrap_or_else(|| "no opener command is available".to_string()),
        ));
    }

    Ok(())
}

#[tauri::command]
pub async fn download_remote_file_to_path(
    url: String,
    path: String,
    headers: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let trimmed_url = url.trim();

    if !(trimmed_url.starts_with("https://") || trimmed_url.starts_with("http://")) {
        return Err("Only http and https URLs can be downloaded".to_string());
    }

    let file_path = PathBuf::from(path);
    ensure_writable_path_allowed(&file_path)?;

    let client = reqwest::Client::new();
    let mut request = client.get(trimmed_url);

    if let Some(next_headers) = headers {
        for (key, value) in next_headers {
            request = request.header(&key, &value);
        }
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Failed to download remote file {}: {}", trimmed_url, error))?;

    if !response.status().is_success() {
        return Err(format!(
            "Remote download returned HTTP {} for {}",
            response.status(),
            trimmed_url
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Failed to read remote response {}: {}", trimmed_url, error))?;

    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!("Failed to create directory {}: {}", parent.display(), error)
        })?;
    }

    fs::write(&file_path, bytes).map_err(|error| {
        format!(
            "Failed to save remote file {}: {}",
            file_path.display(),
            error
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "paperquay-file-tests-{}-{}",
            label,
            current_unix_millis()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn lexical_normalization_blocks_parent_traversal() {
        let base = unique_temp_dir("normalize");
        let nested = base.join("allowed").join("..").join("allowed").join("file.txt");

        assert!(is_within_path(&base, &nested).expect("path check"));
        assert!(!is_within_path(&base, &base.join("..").join("escape.txt")).expect("path check"));
    }

    #[test]
    fn approved_write_paths_are_allowed() {
        let target = unique_temp_dir("approved").join("export.pdf");
        remember_approved_write_path(&target).expect("approve path");

        assert!(ensure_writable_path_allowed(&target).is_ok());
    }
}

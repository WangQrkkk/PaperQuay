use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, USER_AGENT};
use serde::{Deserialize, Serialize};

const CROSSREF_WORKS_ENDPOINT: &str = "https://api.crossref.org/works";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataLookupRequest {
    doi: Option<String>,
    title: Option<String>,
    path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataLookupResult {
    source: String,
    doi: Option<String>,
    title: Option<String>,
    authors: Vec<String>,
    year: Option<String>,
    publication: Option<String>,
    url: Option<String>,
    abstract_text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CrossrefWorkEnvelope {
    message: CrossrefWork,
}

#[derive(Debug, Deserialize)]
struct CrossrefSearchEnvelope {
    message: CrossrefSearchMessage,
}

#[derive(Debug, Deserialize)]
struct CrossrefSearchMessage {
    items: Vec<CrossrefWork>,
}

#[derive(Debug, Deserialize)]
struct CrossrefWork {
    #[serde(rename = "DOI")]
    doi: Option<String>,
    #[serde(rename = "URL")]
    url: Option<String>,
    title: Option<Vec<String>>,
    author: Option<Vec<CrossrefAuthor>>,
    #[serde(rename = "container-title")]
    container_title: Option<Vec<String>>,
    issued: Option<CrossrefDate>,
    #[serde(rename = "published-print")]
    published_print: Option<CrossrefDate>,
    #[serde(rename = "published-online")]
    published_online: Option<CrossrefDate>,
    #[serde(rename = "abstract")]
    abstract_text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CrossrefAuthor {
    given: Option<String>,
    family: Option<String>,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CrossrefDate {
    #[serde(rename = "date-parts")]
    date_parts: Option<Vec<Vec<i64>>>,
}

fn metadata_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("创建元数据查询客户端失败: {}", error))
}

fn metadata_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static("PaperQuay/0.1 (desktop metadata lookup)"),
    );
    headers
}

fn percent_encode(input: &str) -> String {
    let mut output = String::new();

    for byte in input.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                output.push(*byte as char)
            }
            other => output.push_str(&format!("%{:02X}", other)),
        }
    }

    output
}

fn clean_doi(input: &str) -> Option<String> {
    let mut value = input.trim().trim_matches(|ch: char| {
        ch == '.'
            || ch == ','
            || ch == ';'
            || ch == ':'
            || ch == ')'
            || ch == ']'
            || ch == '}'
            || ch == '"'
            || ch == '\''
    });

    for prefix in [
        "https://doi.org/",
        "http://doi.org/",
        "https://dx.doi.org/",
        "http://dx.doi.org/",
        "doi:",
        "DOI:",
    ] {
        if let Some(stripped) = value.strip_prefix(prefix) {
            value = stripped.trim();
            break;
        }
    }

    if value.to_ascii_lowercase().starts_with("10.") && value.contains('/') {
        Some(value.to_string())
    } else {
        None
    }
}

fn extract_doi_candidate(input: &str) -> Option<String> {
    let lower = input.to_ascii_lowercase();
    let start = lower.find("10.")?;
    let candidate = input[start..]
        .chars()
        .take_while(|character| {
            !character.is_whitespace()
                && !matches!(
                    character,
                    '<' | '>' | '"' | '\'' | '，' | '。' | '、' | '；' | '：'
                )
        })
        .collect::<String>();

    clean_doi(&candidate)
}

fn is_springer_article_id(value: &str) -> bool {
    let parts = value.split('-').collect::<Vec<_>>();

    if parts.len() != 4 {
        return false;
    }

    parts[0].len() == 6
        && parts[0].starts_with('s')
        && parts[0][1..]
            .chars()
            .all(|character| character.is_ascii_digit())
        && parts[1].len() == 3
        && parts[1].chars().all(|character| character.is_ascii_digit())
        && parts[2].len() == 5
        && parts[2].chars().all(|character| character.is_ascii_digit())
        && parts[3].len() == 1
        && parts[3].chars().all(|character| character.is_ascii_digit())
}

fn infer_doi_from_identifier(input: &str) -> Option<String> {
    let normalized = input
        .replace('\\', "/")
        .split('/')
        .next_back()
        .unwrap_or(input)
        .trim()
        .trim_end_matches(".pdf")
        .trim_end_matches(".PDF")
        .to_ascii_lowercase();

    let candidate = normalized
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' {
                character
            } else {
                ' '
            }
        })
        .collect::<String>();

    candidate
        .split_whitespace()
        .find(|part| is_springer_article_id(part))
        .map(|part| format!("10.1007/{}", part))
}

fn looks_like_identifier_title(value: &str) -> bool {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return true;
    }

    if extract_doi_candidate(trimmed).is_some() || infer_doi_from_identifier(trimmed).is_some() {
        return true;
    }

    let without_extension = trimmed
        .trim_end_matches(".pdf")
        .trim_end_matches(".PDF")
        .trim();

    let has_separator = without_extension.contains('-') || without_extension.contains('_');
    let has_digit = without_extension
        .chars()
        .any(|character| character.is_ascii_digit());
    let has_space = without_extension.chars().any(char::is_whitespace);
    let ascii_identifier_only = without_extension.chars().all(|character| {
        character.is_ascii_alphanumeric()
            || character == '-'
            || character == '_'
            || character == '.'
            || character == '('
            || character == ')'
            || character == '['
            || character == ']'
    });

    ascii_identifier_only && !has_space && (has_digit || has_separator)
}

fn searchable_title(value: &str) -> Option<String> {
    let title = value.trim();

    if title.len() < 6 || looks_like_identifier_title(title) {
        return None;
    }

    Some(title.to_string())
}

fn title_tokens(value: &str) -> Vec<String> {
    value
        .to_ascii_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .filter(|token| token.len() >= 3)
        .map(ToString::to_string)
        .collect()
}

fn title_matches_query(query: &str, candidate: &str) -> bool {
    let query_tokens = title_tokens(query);
    let candidate_tokens = title_tokens(candidate);

    if query_tokens.is_empty() || candidate_tokens.is_empty() {
        return true;
    }

    let matched = query_tokens
        .iter()
        .filter(|token| candidate_tokens.contains(token))
        .count();

    (matched as f32 / query_tokens.len() as f32) >= 0.55
}

fn first_text(values: Option<Vec<String>>) -> Option<String> {
    values
        .unwrap_or_default()
        .into_iter()
        .map(|value| strip_html_tags(&value))
        .find(|value| !value.is_empty())
}

fn author_name(author: CrossrefAuthor) -> Option<String> {
    if let Some(name) = author.name.map(|value| value.trim().to_string()) {
        if !name.is_empty() {
            return Some(name);
        }
    }

    let name = [author.given, author.family]
        .into_iter()
        .flatten()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    (!name.is_empty()).then_some(name)
}

fn year_from_date(date: Option<CrossrefDate>) -> Option<String> {
    date.and_then(|value| value.date_parts)
        .and_then(|parts| parts.first().cloned())
        .and_then(|part| part.first().copied())
        .map(|year| year.to_string())
}

fn strip_html_tags(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut inside_tag = false;

    for character in input.chars() {
        match character {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag => output.push(character),
            _ => {}
        }
    }

    output
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn result_from_crossref_work(work: CrossrefWork) -> MetadataLookupResult {
    let year = year_from_date(work.published_print)
        .or_else(|| year_from_date(work.published_online))
        .or_else(|| year_from_date(work.issued));

    MetadataLookupResult {
        source: "crossref".to_string(),
        doi: work.doi.and_then(|doi| clean_doi(&doi)),
        title: first_text(work.title),
        authors: work
            .author
            .unwrap_or_default()
            .into_iter()
            .filter_map(author_name)
            .collect(),
        year,
        publication: first_text(work.container_title),
        url: work.url,
        abstract_text: work
            .abstract_text
            .map(|value| strip_html_tags(&value))
            .filter(|value| !value.is_empty()),
    }
}

async fn lookup_crossref_by_doi(
    client: &reqwest::Client,
    doi: &str,
) -> Result<Option<MetadataLookupResult>, String> {
    let endpoint = format!("{}/{}", CROSSREF_WORKS_ENDPOINT, percent_encode(doi));
    let response = client
        .get(endpoint)
        .headers(metadata_headers())
        .send()
        .await
        .map_err(|error| format!("查询 Crossref DOI 失败: {}", error))?;

    if response.status().as_u16() == 404 {
        return Ok(None);
    }

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取 Crossref 响应失败: {}", error))?;

    if !status.is_success() {
        return Err(format!("Crossref 响应异常: {} {}", status, text));
    }

    let envelope = serde_json::from_str::<CrossrefWorkEnvelope>(&text)
        .map_err(|error| format!("解析 Crossref DOI 响应失败: {}; 原始响应: {}", error, text))?;

    Ok(Some(result_from_crossref_work(envelope.message)))
}

async fn lookup_crossref_by_title(
    client: &reqwest::Client,
    title: &str,
) -> Result<Option<MetadataLookupResult>, String> {
    let response = client
        .get(CROSSREF_WORKS_ENDPOINT)
        .headers(metadata_headers())
        .query(&[("query.bibliographic", title), ("rows", "1")])
        .send()
        .await
        .map_err(|error| format!("按标题查询 Crossref 失败: {}", error))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取 Crossref 标题查询响应失败: {}", error))?;

    if !status.is_success() {
        return Err(format!("Crossref 标题查询异常: {} {}", status, text));
    }

    let envelope = serde_json::from_str::<CrossrefSearchEnvelope>(&text).map_err(|error| {
        format!(
            "解析 Crossref 标题查询响应失败: {}; 原始响应: {}",
            error, text
        )
    })?;

    let result = envelope
        .message
        .items
        .into_iter()
        .next()
        .map(result_from_crossref_work);

    Ok(result.filter(|metadata| {
        metadata
            .title
            .as_deref()
            .map(|candidate| title_matches_query(title, candidate))
            .unwrap_or(false)
    }))
}

#[tauri::command]
pub async fn lookup_literature_metadata(
    request: MetadataLookupRequest,
) -> Result<Option<MetadataLookupResult>, String> {
    let client = metadata_client()?;
    let doi = request
        .doi
        .as_deref()
        .and_then(clean_doi)
        .or_else(|| request.title.as_deref().and_then(extract_doi_candidate))
        .or_else(|| request.path.as_deref().and_then(extract_doi_candidate))
        .or_else(|| request.title.as_deref().and_then(infer_doi_from_identifier))
        .or_else(|| request.path.as_deref().and_then(infer_doi_from_identifier));

    if let Some(doi) = doi {
        if let Some(result) = lookup_crossref_by_doi(&client, &doi).await? {
            return Ok(Some(result));
        }
    }

    let title = request.title.as_deref().and_then(searchable_title);

    if let Some(title) = title.as_deref() {
        return lookup_crossref_by_title(&client, title).await;
    }

    Ok(None)
}

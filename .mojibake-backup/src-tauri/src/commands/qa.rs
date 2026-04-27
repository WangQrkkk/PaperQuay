use std::time::Duration;

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryBlockInput {
  block_id: String,
  block_type: String,
  page_index: usize,
  text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentChatAttachment {
  kind: String,
  name: String,
  mime_type: String,
  size: u64,
  data_url: Option<String>,
  text_content: Option<String>,
  summary: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentChatMessage {
  role: String,
  content: String,
  attachments: Option<Vec<DocumentChatAttachment>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAICompatibleQaOptions {
  base_url: String,
  api_key: String,
  model: String,
  title: String,
  authors: Option<String>,
  year: Option<String>,
  excerpt_text: Option<String>,
  document_text: Option<String>,
  blocks: Vec<SummaryBlockInput>,
  messages: Vec<DocumentChatMessage>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
  choices: Vec<ChatCompletionChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionChoice {
  message: ChatCompletionMessage,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionMessage {
  content: Option<ChatCompletionContent>,
  refusal: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
enum ChatCompletionContent {
  Text(String),
  Parts(Vec<ChatCompletionContentPart>),
}

#[derive(Clone, Debug, Deserialize)]
struct ChatCompletionContentPart {
  #[serde(rename = "type")]
  part_type: Option<String>,
  text: Option<String>,
}

fn build_chat_completions_url(base_url: &str) -> String {
  let trimmed = base_url.trim().trim_end_matches('/');

  if trimmed.ends_with("/v1/chat/completions") || trimmed.ends_with("/chat/completions") {
    return trimmed.to_string();
  }

  if trimmed.ends_with("/v1") {
    return format!("{}/chat/completions", trimmed);
  }

  format!("{}/v1/chat/completions", trimmed)
}

fn build_document_context(
  title: &str,
  authors: Option<&str>,
  year: Option<&str>,
  excerpt_text: Option<&str>,
  document_text: Option<&str>,
  blocks: &[SummaryBlockInput],
) -> String {
  let mut parts = vec![format!("Title: {}", title)];
  let mut char_count = parts[0].len();
  let max_chars = 20_000usize;

  if let Some(authors) = authors.filter(|value| !value.trim().is_empty()) {
    parts.push(format!("Authors: {}", authors.trim()));
  }

  if let Some(year) = year.filter(|value| !value.trim().is_empty()) {
    parts.push(format!("Year: {}", year.trim()));
  }

  if let Some(excerpt) = excerpt_text.filter(|value| !value.trim().is_empty()) {
    parts.push(format!("Selected excerpt: {}", excerpt.trim()));
  }

  if let Some(document_text) = document_text.filter(|value| !value.trim().is_empty()) {
    let mut normalized_text = document_text
      .lines()
      .map(str::trim)
      .filter(|line| !line.is_empty())
      .collect::<Vec<_>>()
      .join("\n");

    if normalized_text.chars().count() > 24_000usize {
      normalized_text = normalized_text.chars().take(24_000usize).collect();
    }

    parts.push("Document text:".to_string());
    parts.push(normalized_text);
    return parts.join("\n\n");
  }

  parts.push("Document blocks:".to_string());

  for block in blocks {
    let text = block.text.trim();

    if text.is_empty() {
      continue;
    }

    let line = format!(
      "[page {}][{}][{}] {}",
      block.page_index + 1,
      block.block_id,
      block.block_type,
      text
    );

    if char_count + line.len() > max_chars {
      break;
    }

    char_count += line.len();
    parts.push(line);
  }

  parts.join("\n")
}

fn strip_code_fences(content: &str) -> String {
  let trimmed = content.trim();

  if !trimmed.starts_with("```") {
    return trimmed.to_string();
  }

  trimmed
    .trim_start_matches("```markdown")
    .trim_start_matches("```md")
    .trim_start_matches("```text")
    .trim_start_matches("```")
    .trim()
    .trim_end_matches("```")
    .trim()
    .to_string()
}

fn trim_attachment_text(input: &str, max_chars: usize) -> String {
  let trimmed = input.trim();

  if trimmed.chars().count() <= max_chars {
    return trimmed.to_string();
  }

  trimmed.chars().take(max_chars).collect::<String>()
}

fn build_attachment_text(attachment: &DocumentChatAttachment) -> Option<String> {
  let text_content = attachment
    .text_content
    .as_deref()
    .filter(|value| !value.trim().is_empty())
    .map(|value| trim_attachment_text(value, 10_000));

  if let Some(text_content) = text_content {
    return Some(format!("附件《{}》内容：\n{}", attachment.name, text_content));
  }

  attachment.summary.as_ref().map(|summary| {
    format!(
      "附件《{}》：{}，MIME={}锛屽ぇ灏?{} 字节",
      attachment.name, summary, attachment.mime_type, attachment.size
    )
  })
}

fn build_user_message_content(message: &DocumentChatMessage) -> Value {
  let mut parts = Vec::new();

  parts.push(json!({
    "type": "text",
    "text": message.content
  }));

  for attachment in message.attachments.as_deref().unwrap_or(&[]) {
    let kind = attachment.kind.trim().to_ascii_lowercase();

    if (kind == "image" || kind == "screenshot")
      && attachment
        .data_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .is_some()
    {
      if let Some(data_url) = attachment.data_url.as_deref() {
        parts.push(json!({
          "type": "image_url",
          "image_url": {
            "url": data_url
          }
        }));
      }
    }

    if let Some(text_part) = build_attachment_text(attachment) {
      parts.push(json!({
        "type": "text",
        "text": text_part
      }));
    }
  }

  Value::Array(parts)
}

fn extract_response_text(content: Option<ChatCompletionContent>) -> Option<String> {
  match content {
    Some(ChatCompletionContent::Text(text)) => Some(text),
    Some(ChatCompletionContent::Parts(parts)) => {
      let output = parts
        .into_iter()
        .filter_map(|part| {
          if part.part_type.as_deref() == Some("text") || part.part_type.is_none() {
            return part.text;
          }

          None
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();

      if output.is_empty() {
        None
      } else {
        Some(output)
      }
    }
    None => None,
  }
}

#[tauri::command]
pub async fn ask_document_openai_compatible(
  options: OpenAICompatibleQaOptions,
) -> Result<String, String> {
  let base_url = options.base_url.trim();
  let api_key = options.api_key.trim();
  let model = options.model.trim();
  let title = options.title.trim();
  let blocks = options
    .blocks
    .into_iter()
    .filter(|block| !block.text.trim().is_empty())
    .collect::<Vec<_>>();
  let messages = options
    .messages
    .into_iter()
    .filter(|message| {
      !message.content.trim().is_empty()
        || message
          .attachments
          .as_ref()
          .map(|attachments| !attachments.is_empty())
          .unwrap_or(false)
    })
    .collect::<Vec<_>>();

  if base_url.is_empty() {
    return Err("问答接口 Base URL 不能为空".to_string());
  }

  if api_key.is_empty() {
    return Err("问答接口 API Key 不能为空".to_string());
  }

  if model.is_empty() {
    return Err("问答模型名称不能为空".to_string());
  }

  if title.is_empty() {
    return Err("论文标题不能为空".to_string());
  }

  if blocks.is_empty()
    && options.excerpt_text.as_deref().unwrap_or("").trim().is_empty()
    && options.document_text.as_deref().unwrap_or("").trim().is_empty()
  {
    return Err("当前没有可用于问答的论文内容".to_string());
  }

  if messages.is_empty() {
    return Err("问答消息不能为空".to_string());
  }

  let endpoint = build_chat_completions_url(base_url);
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(180))
    .build()
    .map_err(|error| format!("创建问答 HTTP 客户端失败：{}", error))?;
  let document_context = build_document_context(
    title,
    options.authors.as_deref(),
    options.year.as_deref(),
    options.excerpt_text.as_deref(),
    options.document_text.as_deref(),
    &blocks,
  );
  let mut payload_messages = vec![json!({
    "role": "system",
    "content": format!(
      "You are an academic reading assistant inside a desktop paper reader. Answer in Simplified Chinese. Use the provided paper context first, prefer MinerU structured content when available, and be explicit when the evidence is insufficient. User messages may include screenshots, images, or extracted file text. Quote short phrases from the paper when helpful, but do not fabricate details.\n\nPaper context:\n{}",
      document_context
    )
  })];

  for message in messages {
    let role = if message.role == "assistant" {
      "assistant"
    } else {
      "user"
    };

    if role == "assistant" {
      payload_messages.push(json!({
        "role": role,
        "content": message.content
      }));
    } else {
      payload_messages.push(json!({
        "role": role,
        "content": build_user_message_content(&message)
      }));
    }
  }

  let body = json!({
    "model": model,
    "temperature": 0.2,
    "messages": payload_messages
  });

  let response = client
    .post(endpoint)
    .header(CONTENT_TYPE, "application/json")
    .header(AUTHORIZATION, format!("Bearer {}", api_key))
    .json(&body)
    .send()
    .await
    .map_err(|error| format!("请求论文问答接口失败：{}", error))?;
  let status = response.status();
  let response_text = response
    .text()
    .await
    .map_err(|error| format!("读取论文问答接口响应失败：{}", error))?;

  if !status.is_success() {
    return Err(format!("论文问答接口 HTTP 状态异常：{}，{}", status, response_text));
  }

  let completion = serde_json::from_str::<ChatCompletionResponse>(&response_text)
    .map_err(|error| format!("解析问答响应失败：{}；原始响应：{}", error, response_text))?;
  let message = completion
    .choices
    .first()
    .map(|choice| &choice.message)
    .ok_or_else(|| "问答响应缺少 choices[0]".to_string())?;

  if let Some(refusal) = &message.refusal {
    return Err(format!("模型拒绝回答：{}", refusal));
  }

  let answer = extract_response_text(message.content.clone())
    .ok_or_else(|| "问答响应缺少 message.content".to_string())?;

  Ok(strip_code_fences(&answer))
}

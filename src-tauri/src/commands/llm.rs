use std::time::{Duration, Instant};

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAICompatibleTestOptions {
    base_url: String,
    api_key: String,
    model: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAICompatibleTestResult {
    ok: bool,
    endpoint: String,
    model: String,
    response_model: Option<String>,
    latency_ms: u128,
    message: String,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    model: Option<String>,
    choices: Vec<ChatCompletionChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionChoice {
    message: ChatCompletionMessage,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionMessage {
    content: Option<String>,
    refusal: Option<String>,
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

fn truncate_for_display(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();

    if chars.next().is_some() {
        // 这里只用于 UI 和日志展示，避免超长内容影响前端显示。
        format!("{}...", truncated)
    } else {
        truncated
    }
}

fn failed_result(
    endpoint: String,
    model: String,
    started_at: Instant,
    message: impl Into<String>,
) -> OpenAICompatibleTestResult {
    OpenAICompatibleTestResult {
        ok: false,
        endpoint,
        model,
        response_model: None,
        latency_ms: started_at.elapsed().as_millis(),
        message: message.into(),
    }
}

#[tauri::command]
pub async fn test_openai_compatible_chat(
    options: OpenAICompatibleTestOptions,
) -> Result<OpenAICompatibleTestResult, String> {
    let base_url = options.base_url.trim();
    let api_key = options.api_key.trim();
    let model = options.model.trim();
    let endpoint = if base_url.is_empty() {
        String::new()
    } else {
        build_chat_completions_url(base_url)
    };
    let started_at = Instant::now();

    if base_url.is_empty() {
        return Ok(failed_result(
            endpoint,
            model.to_string(),
            started_at,
            "Base URL 不能为空",
        ));
    }

    if api_key.is_empty() {
        return Ok(failed_result(
            endpoint,
            model.to_string(),
            started_at,
            "API Key 不能为空",
        ));
    }

    if model.is_empty() {
        return Ok(failed_result(
            endpoint,
            model.to_string(),
            started_at,
            "模型名称不能为空",
        ));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|error| format!("创建测试 HTTP 客户端失败: {}", error))?;

    let body = json!({
      "model": model,
      "messages": [
        {
          "role": "system",
          "content": "You are a connection test endpoint. Reply briefly."
        },
        {
          "role": "user",
          "content": "Reply with OK."
        }
      ]
    });

    let response = match client
        .post(&endpoint)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Ok(failed_result(
                endpoint,
                model.to_string(),
                started_at,
                format!("请求失败: {}", error),
            ));
        }
    };

    let status = response.status();
    let response_text = match response.text().await {
        Ok(text) => text,
        Err(error) => {
            return Ok(failed_result(
                endpoint,
                model.to_string(),
                started_at,
                format!("读取响应失败: {}", error),
            ));
        }
    };

    if !status.is_success() {
        return Ok(failed_result(
            endpoint,
            model.to_string(),
            started_at,
            format!(
                "HTTP {}: {}",
                status,
                truncate_for_display(response_text.trim(), 500)
            ),
        ));
    }

    let completion = match serde_json::from_str::<ChatCompletionResponse>(&response_text) {
        Ok(completion) => completion,
        Err(error) => {
            return Ok(failed_result(
                endpoint,
                model.to_string(),
                started_at,
                format!(
                    "响应不是标准 chat/completions JSON: {}；原始响应: {}",
                    error,
                    truncate_for_display(response_text.trim(), 500)
                ),
            ));
        }
    };

    let message = completion.choices.first().map(|choice| &choice.message);

    if let Some(refusal) = message.and_then(|message| message.refusal.as_deref()) {
        return Ok(failed_result(
            endpoint,
            model.to_string(),
            started_at,
            format!("模型拒绝响应: {}", refusal),
        ));
    }

    let content = message
        .and_then(|message| message.content.as_deref())
        .unwrap_or("")
        .trim();

    if content.is_empty() {
        return Ok(failed_result(
            endpoint,
            model.to_string(),
            started_at,
            "接口返回成功，但 message.content 为空",
        ));
    }

    Ok(OpenAICompatibleTestResult {
        ok: true,
        endpoint,
        model: model.to_string(),
        response_model: completion.model,
        latency_ms: started_at.elapsed().as_millis(),
        message: format!("连接成功: {}", truncate_for_display(content, 120)),
    })
}

use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::OnceLock,
    time::{Duration, Instant},
};

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::task::JoinSet;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranslateBlockInput {
    block_id: String,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAICompatibleTranslateOptions {
    base_url: String,
    api_key: String,
    model: String,
    temperature: Option<f32>,
    reasoning_effort: Option<String>,
    source_language: String,
    target_language: String,
    blocks: Vec<TranslateBlockInput>,
    batch_size: Option<usize>,
    concurrency: Option<usize>,
    requests_per_minute: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAICompatibleTranslateTextOptions {
    base_url: String,
    api_key: String,
    model: String,
    temperature: Option<f32>,
    reasoning_effort: Option<String>,
    source_language: String,
    target_language: String,
    text: String,
    requests_per_minute: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranslateBlockOutput {
    block_id: String,
    translated_text: String,
}

#[derive(Debug, Deserialize)]
struct TranslationEnvelope {
    translations: Vec<TranslateBlockOutput>,
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
    content: Option<String>,
    refusal: Option<String>,
}

#[derive(Debug)]
struct BatchTranslationOutcome {
    translations: Vec<TranslateBlockOutput>,
    missing_blocks: Vec<TranslateBlockInput>,
}

const MIN_BATCH_TRANSLATION_MAX_TOKENS: usize = 256;
const MAX_BATCH_TRANSLATION_MAX_TOKENS: usize = 12_000;
const MIN_SINGLE_TRANSLATION_MAX_TOKENS: usize = 160;
const MAX_SINGLE_TRANSLATION_MAX_TOKENS: usize = 6_000;
const MAX_TRANSLATION_REQUESTS_PER_MINUTE: usize = 600;
const TRANSLATION_RATE_LIMIT_WINDOW: Duration = Duration::from_secs(60);

static TRANSLATION_REQUEST_TIMESTAMPS: OnceLock<tokio::sync::Mutex<VecDeque<Instant>>> =
    OnceLock::new();

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

fn model_temperature(value: Option<f32>, fallback: f32) -> f32 {
    value.unwrap_or(fallback).clamp(0.0, 2.0)
}

fn translation_request_queue() -> &'static tokio::sync::Mutex<VecDeque<Instant>> {
    TRANSLATION_REQUEST_TIMESTAMPS.get_or_init(|| tokio::sync::Mutex::new(VecDeque::new()))
}

fn normalize_requests_per_minute(value: Option<usize>) -> Option<usize> {
    value
        .filter(|rpm| *rpm > 0)
        .map(|rpm| rpm.clamp(1, MAX_TRANSLATION_REQUESTS_PER_MINUTE))
}

fn estimated_char_count(text: &str) -> usize {
    text.chars()
        .filter(|character| !character.is_control())
        .count()
}

fn estimate_translation_max_tokens(
    char_count: usize,
    overhead: usize,
    minimum: usize,
    maximum: usize,
) -> usize {
    let estimated = char_count
        .saturating_add(char_count / 3)
        .saturating_add(overhead);

    estimated.clamp(minimum, maximum)
}

fn estimate_batch_translation_max_tokens(blocks: &[TranslateBlockInput]) -> usize {
    let total_chars = blocks
        .iter()
        .map(|block| estimated_char_count(&block.text))
        .sum::<usize>();

    estimate_translation_max_tokens(
        total_chars,
        192 + blocks.len().saturating_mul(56),
        MIN_BATCH_TRANSLATION_MAX_TOKENS,
        MAX_BATCH_TRANSLATION_MAX_TOKENS,
    )
}

fn estimate_single_translation_max_tokens(block: &TranslateBlockInput) -> usize {
    estimate_translation_max_tokens(
        estimated_char_count(&block.text),
        96,
        MIN_SINGLE_TRANSLATION_MAX_TOKENS,
        MAX_SINGLE_TRANSLATION_MAX_TOKENS,
    )
}

fn translation_output_is_excessive(
    source_blocks: &[TranslateBlockInput],
    translations: &[TranslateBlockOutput],
) -> bool {
    if source_blocks.is_empty() || translations.is_empty() {
        return false;
    }

    let source_by_id = source_blocks
        .iter()
        .map(|block| (block.block_id.as_str(), estimated_char_count(&block.text)))
        .collect::<HashMap<_, _>>();

    let total_source_chars = source_by_id.values().copied().sum::<usize>();
    let total_translated_chars = translations
        .iter()
        .map(|translation| estimated_char_count(&translation.translated_text))
        .sum::<usize>();

    let total_allowed_chars = total_source_chars
        .saturating_mul(6)
        .saturating_add(translations.len().saturating_mul(500))
        .max(4_000);

    if total_translated_chars > total_allowed_chars {
        return true;
    }

    translations.iter().any(|translation| {
        let source_chars = source_by_id
            .get(translation.block_id.as_str())
            .copied()
            .unwrap_or_default();
        let translated_chars = estimated_char_count(&translation.translated_text);
        let per_block_limit = source_chars
            .saturating_mul(8)
            .saturating_add(400)
            .max(1_200);

        translated_chars > per_block_limit
    })
}

async fn wait_for_translation_slot(requests_per_minute: Option<usize>) {
    let Some(requests_per_minute) = normalize_requests_per_minute(requests_per_minute) else {
        return;
    };

    loop {
        let sleep_duration = {
            let mut queue = translation_request_queue().lock().await;
            let now = Instant::now();

            while let Some(front) = queue.front() {
                if now.duration_since(*front) >= TRANSLATION_RATE_LIMIT_WINDOW {
                    queue.pop_front();
                } else {
                    break;
                }
            }

            if queue.len() < requests_per_minute {
                queue.push_back(now);
                None
            } else {
                queue.front().map(|front| {
                    TRANSLATION_RATE_LIMIT_WINDOW
                        .saturating_sub(now.duration_since(*front))
                        .saturating_add(Duration::from_millis(25))
                })
            }
        };

        if let Some(duration) = sleep_duration {
            tokio::time::sleep(duration).await;
            continue;
        }

        return;
    }
}

fn apply_reasoning_effort(body: &mut Value, reasoning_effort: Option<&str>) {
    let Some(reasoning_effort) = reasoning_effort.map(str::trim) else {
        return;
    };

    if reasoning_effort.is_empty() || reasoning_effort == "auto" {
        return;
    }

    if let Some(object) = body.as_object_mut() {
        object.insert("reasoning_effort".to_string(), json!(reasoning_effort));
    }
}

fn strip_json_fences(content: &str) -> String {
    let trimmed = content.trim();

    if !trimmed.starts_with("```") {
        return trimmed.to_string();
    }

    let without_prefix = trimmed
        .trim_start_matches("```json")
        .trim_start_matches("```JSON")
        .trim_start_matches("```")
        .trim();

    without_prefix.trim_end_matches("```").trim().to_string()
}

async fn request_translation_content(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    body: Value,
    requests_per_minute: Option<usize>,
) -> Result<String, String> {
    wait_for_translation_slot(requests_per_minute).await;

    let response = client
        .post(endpoint)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Failed to request translation endpoint: {}", error))?;
    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|error| format!("Failed to read translation response: {}", error))?;

    if !status.is_success() {
        return Err(format!(
            "Translation endpoint HTTP status error: {}; response: {}",
            status, response_text
        ));
    }

    let completion =
        serde_json::from_str::<ChatCompletionResponse>(&response_text).map_err(|error| {
            format!(
                "Failed to parse chat/completions response: {}; raw response: {}",
                error, response_text
            )
        })?;
    let message = completion
        .choices
        .first()
        .map(|choice| &choice.message)
        .ok_or_else(|| "chat/completions 响应缺少 choices[0]".to_string())?;

    if let Some(refusal) = &message.refusal {
        return Err(format!("Model refused translation: {}", refusal));
    }

    message
        .content
        .clone()
        .ok_or_else(|| "chat/completions 响应缺少 message.content".to_string())
}

fn parse_translation_content(content: &str) -> Result<Vec<TranslateBlockOutput>, String> {
    let cleaned = strip_json_fences(content);

    if let Ok(envelope) = serde_json::from_str::<TranslationEnvelope>(&cleaned) {
        return Ok(envelope.translations);
    }

    if let Ok(translations) = serde_json::from_str::<Vec<TranslateBlockOutput>>(&cleaned) {
        return Ok(translations);
    }

    if let Ok(single_translation) = serde_json::from_str::<TranslateBlockOutput>(&cleaned) {
        return Ok(vec![single_translation]);
    }

    let value = serde_json::from_str::<Value>(&cleaned).map_err(|error| {
        format!(
            "Translation output was not valid JSON: {}; raw content: {}",
            error, content
        )
    })?;

    serde_json::from_value::<TranslationEnvelope>(value)
        .map(|envelope| envelope.translations)
        .map_err(|error| {
            format!(
                "Translation JSON was missing a translations array: {}",
                error
            )
        })
}

fn find_translation_array_start(content: &str) -> Option<usize> {
    let first_non_whitespace = content.find(|character: char| !character.is_whitespace())?;

    if content[first_non_whitespace..].starts_with('[') {
        return Some(first_non_whitespace);
    }

    let translations_key_index = content.find("\"translations\"")?;
    content[translations_key_index..]
        .find('[')
        .map(|offset| translations_key_index + offset)
}

fn filter_translation_outputs(
    translations: Vec<TranslateBlockOutput>,
    requested_ids: &HashSet<String>,
) -> Vec<TranslateBlockOutput> {
    let mut seen = HashSet::new();
    let mut filtered = Vec::new();

    for translation in translations {
        if translation.block_id.trim().is_empty() || translation.translated_text.trim().is_empty() {
            continue;
        }

        if !requested_ids.contains(&translation.block_id) {
            continue;
        }

        if seen.insert(translation.block_id.clone()) {
            filtered.push(translation);
        }
    }

    filtered
}

fn salvage_translation_outputs(
    content: &str,
    requested_ids: &HashSet<String>,
) -> Vec<TranslateBlockOutput> {
    let cleaned = strip_json_fences(content);
    let Some(array_start) = find_translation_array_start(&cleaned) else {
        return Vec::new();
    };

    let mut translations = Vec::new();
    let mut seen = HashSet::new();
    let mut in_string = false;
    let mut escaped = false;
    let mut bracket_depth = 1usize;
    let mut brace_depth = 0usize;
    let mut current_object_start: Option<usize> = None;

    for (offset, character) in cleaned[array_start + 1..].char_indices() {
        let index = array_start + 1 + offset;

        if escaped {
            escaped = false;
            continue;
        }

        if in_string {
            match character {
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }

        match character {
            '"' => in_string = true,
            '[' => bracket_depth += 1,
            ']' => {
                bracket_depth = bracket_depth.saturating_sub(1);
                if bracket_depth == 0 {
                    break;
                }
            }
            '{' => {
                brace_depth += 1;
                if brace_depth == 1 && bracket_depth == 1 {
                    current_object_start = Some(index);
                }
            }
            '}' => {
                if brace_depth == 0 {
                    continue;
                }

                brace_depth -= 1;
                if brace_depth == 0 && bracket_depth == 1 {
                    let Some(object_start) = current_object_start.take() else {
                        continue;
                    };

                    let fragment = &cleaned[object_start..=index];
                    let Ok(translation) = serde_json::from_str::<TranslateBlockOutput>(fragment)
                    else {
                        continue;
                    };

                    if !requested_ids.contains(&translation.block_id)
                        || translation.translated_text.trim().is_empty()
                    {
                        continue;
                    }

                    if seen.insert(translation.block_id.clone()) {
                        translations.push(translation);
                    }
                }
            }
            _ => {}
        }
    }

    translations
}

fn clean_plaintext_translation(content: &str) -> String {
    let cleaned = strip_json_fences(content);

    if let Ok(parsed) = parse_translation_content(&cleaned) {
        if let Some(first) = parsed.into_iter().next() {
            return first.translated_text.trim().to_string();
        }
    }

    if cleaned.starts_with('"') && cleaned.ends_with('"') {
        if let Ok(unwrapped) = serde_json::from_str::<String>(&cleaned) {
            return unwrapped.trim().to_string();
        }
    }

    cleaned.trim().to_string()
}

fn is_retryable_plaintext_translation_error(message: &str) -> bool {
    let normalized = message.trim().to_ascii_lowercase();

    normalized.contains("failed to parse chat/completions response")
        || normalized.contains("eof while parsing")
        || normalized.contains("message.content")
        || normalized.contains("did not produce usable content")
}

async fn translate_batch(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    model: &str,
    source_language: &str,
    target_language: &str,
    temperature: Option<f32>,
    reasoning_effort: Option<&str>,
    blocks: &[TranslateBlockInput],
    requests_per_minute: Option<usize>,
) -> Result<BatchTranslationOutcome, String> {
    let payload_blocks = blocks
        .iter()
        .map(|block| {
            json!({
              "blockId": block.block_id,
              "text": block.text
            })
        })
        .collect::<Vec<_>>();
    let system_prompt = format!(
    "You are a professional academic paper translator. Translate from {} to {}. The input is MinerU-derived Markdown. Translate only natural language, while preserving the original Markdown structure and all technical notation exactly.",
    source_language,
    target_language
  );
    let user_prompt = json!({
    "instruction": "Translate each item independently. Keep blockId unchanged. Preserve item order. Preserve headings, list markers, emphasis, links, HTML tags, line breaks, and spacing around Markdown delimiters whenever possible. Never translate, rewrite, or remove content inside $...$, $$...$$, \\(...\\), \\[...\\], bracketed citation markers like [12], or special markers like [M], [MASK], [S], [START], [E], [END]. Do not change variable names, underscores, braces, backslashes, or LaTeX commands. If a fragment is mostly formula or notation, keep it unchanged. Return valid minified JSON only in the exact shape {\"translations\":[{\"blockId\":\"...\",\"translatedText\":\"...\"}]}. Do not add markdown fences, notes, or extra keys.",
    "blocks": payload_blocks
  })
  .to_string();
    let mut body = json!({
      "model": model,
      "temperature": model_temperature(temperature, 0.2),
      "max_tokens": estimate_batch_translation_max_tokens(blocks),
      "messages": [
        {
          "role": "system",
          "content": system_prompt
        },
        {
          "role": "user",
          "content": user_prompt
        }
      ]
    });
    apply_reasoning_effort(&mut body, reasoning_effort);

    wait_for_translation_slot(requests_per_minute).await;

    let response = client
        .post(endpoint)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Failed to request translation endpoint: {}", error))?;
    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|error| format!("Failed to read translation response: {}", error))?;

    if !status.is_success() {
        return Err(format!(
            "Translation endpoint HTTP status error: {}; response: {}",
            status, response_text
        ));
    }

    let completion =
        serde_json::from_str::<ChatCompletionResponse>(&response_text).map_err(|error| {
            format!(
                "Failed to parse chat/completions response: {}; raw response: {}",
                error, response_text
            )
        })?;
    let content = completion
        .choices
        .first()
        .and_then(|choice| choice.message.content.as_deref())
        .ok_or_else(|| "chat/completions 响应缺少 choices[0].message.content".to_string())?;

    let requested_ids = blocks
        .iter()
        .map(|block| block.block_id.clone())
        .collect::<HashSet<_>>();
    let translations = match parse_translation_content(content) {
        Ok(parsed) => filter_translation_outputs(parsed, &requested_ids),
        Err(parse_error) => {
            let salvaged = salvage_translation_outputs(content, &requested_ids);

            if salvaged.is_empty() {
                return Err(parse_error);
            }

            salvaged
        }
    };

    if translation_output_is_excessive(blocks, &translations) {
        return Err(format!(
            "Translation output exceeded the expected size budget for {} blocks",
            blocks.len()
        ));
    }

    let translated_ids = translations
        .iter()
        .map(|translation| translation.block_id.clone())
        .collect::<HashSet<_>>();
    let missing_blocks = blocks
        .iter()
        .filter(|block| !translated_ids.contains(&block.block_id))
        .cloned()
        .collect::<Vec<_>>();

    Ok(BatchTranslationOutcome {
        translations,
        missing_blocks,
    })
}

async fn translate_single_block_plaintext(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    model: &str,
    source_language: &str,
    target_language: &str,
    temperature: Option<f32>,
    reasoning_effort: Option<&str>,
    block: &TranslateBlockInput,
    requests_per_minute: Option<usize>,
) -> Result<TranslateBlockOutput, String> {
    match translate_single_block_plaintext_once(
        client,
        endpoint,
        api_key,
        model,
        source_language,
        target_language,
        temperature,
        reasoning_effort,
        block,
        requests_per_minute,
    )
    .await
    {
        Ok(translation) => Ok(translation),
        Err(error) => {
            if !is_retryable_plaintext_translation_error(&error) {
                return Err(error);
            }

            translate_single_block_plaintext_once(
                client,
                endpoint,
                api_key,
                model,
                source_language,
                target_language,
                temperature,
                reasoning_effort,
                block,
                requests_per_minute,
            )
            .await
            .map_err(|retry_error| format!("{error} | Retry failed: {retry_error}"))
        }
    }
}

async fn translate_single_block_plaintext_once(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    model: &str,
    source_language: &str,
    target_language: &str,
    temperature: Option<f32>,
    reasoning_effort: Option<&str>,
    block: &TranslateBlockInput,
    requests_per_minute: Option<usize>,
) -> Result<TranslateBlockOutput, String> {
    let mut body = json!({
      "model": model,
      "temperature": model_temperature(temperature, 0.1),
      "max_tokens": estimate_single_translation_max_tokens(block),
      "messages": [
        {
          "role": "system",
          "content": format!(
            "You are a professional academic paper translator. Translate from {} to {}. The input may contain MinerU-derived Markdown or inline LaTeX. Translate only natural language. Preserve Markdown structure, line breaks, inline math, display math, citations, tags, symbols, variable names, underscores, braces, backslashes, and LaTeX commands exactly. Return only the translated text body. Do not add explanations, bullet points, JSON, markdown fences, or surrounding quotes unless they are part of the source text. If the input is already in the target language or is mostly formulas, notation, code, or symbols, return the original text unchanged. Never return an empty response for non-empty input.",
            source_language,
            target_language
          )
        },
        {
          "role": "user",
          "content": format!(
            "Translate only the text inside <source_text> tags and return only the translated text body.\n<source_text>\n{}\n</source_text>",
            block.text
          )
        }
      ]
    });
    apply_reasoning_effort(&mut body, reasoning_effort);

    let content =
        request_translation_content(client, endpoint, api_key, body, requests_per_minute).await?;
    let translated_text = clean_plaintext_translation(&content);

    if translated_text.is_empty() {
        return Err(format!(
            "Translation did not produce usable content for block {}",
            block.block_id
        ));
    }

    if translation_output_is_excessive(
        std::slice::from_ref(block),
        &[TranslateBlockOutput {
            block_id: block.block_id.clone(),
            translated_text: translated_text.clone(),
        }],
    ) {
        return Err(format!(
            "Fallback translation output exceeded the expected size budget for block {}",
            block.block_id
        ));
    }

    Ok(TranslateBlockOutput {
        block_id: block.block_id.clone(),
        translated_text,
    })
}

#[tauri::command]
pub async fn translate_text_openai_compatible(
    options: OpenAICompatibleTranslateTextOptions,
) -> Result<String, String> {
    let base_url = options.base_url.trim();
    let api_key = options.api_key.trim();
    let model = options.model.trim();
    let source_language = options.source_language.trim();
    let target_language = options.target_language.trim();
    let text = options.text.trim();

    if base_url.is_empty() {
        return Err("Translation Base URL cannot be empty.".to_string());
    }

    if api_key.is_empty() {
        return Err("Translation API key cannot be empty.".to_string());
    }

    if model.is_empty() {
        return Err("Translation model name cannot be empty.".to_string());
    }

    if text.is_empty() {
        return Err("No translatable text was provided.".to_string());
    }

    let endpoint = build_chat_completions_url(base_url);
    let requests_per_minute = normalize_requests_per_minute(options.requests_per_minute);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| format!("Failed to build translation HTTP client: {}", error))?;
    let selection_block = TranslateBlockInput {
        block_id: "selection".to_string(),
        text: text.to_string(),
    };
    let translation = translate_single_block_plaintext(
        &client,
        &endpoint,
        api_key,
        model,
        source_language,
        target_language,
        options.temperature,
        options.reasoning_effort.as_deref(),
        &selection_block,
        requests_per_minute,
    )
    .await?;

    Ok(translation.translated_text)
}

#[tauri::command]
pub async fn translate_blocks_openai_compatible(
    options: OpenAICompatibleTranslateOptions,
) -> Result<Vec<TranslateBlockOutput>, String> {
    let base_url = options.base_url.trim();
    let api_key = options.api_key.trim();
    let model = options.model.trim();
    let temperature = options.temperature;
    let reasoning_effort = options.reasoning_effort.clone();
    let requests_per_minute = normalize_requests_per_minute(options.requests_per_minute);
    let source_language = options.source_language.trim();
    let target_language = options.target_language.trim();
    let blocks = options
        .blocks
        .into_iter()
        .filter(|block| !block.text.trim().is_empty())
        .collect::<Vec<_>>();
    let requested_blocks = blocks.clone();

    if base_url.is_empty() {
        return Err("Translation Base URL cannot be empty.".to_string());
    }

    if api_key.is_empty() {
        return Err("Translation API key cannot be empty.".to_string());
    }

    if model.is_empty() {
        return Err("Translation model name cannot be empty.".to_string());
    }

    if base_url.is_empty() {
        return Err("翻译接口 Base URL 不能为空".to_string());
    }

    if api_key.is_empty() {
        return Err("翻译接口 API Key 不能为空".to_string());
    }

    if model.is_empty() {
        return Err("翻译模型名称不能为空".to_string());
    }

    if blocks.is_empty() {
        return Err("No translatable MinerU blocks were provided.".to_string());
    }

    let endpoint = build_chat_completions_url(base_url);
    let batch_size = options.batch_size.unwrap_or(10).clamp(1, 50);
    let concurrency = options.concurrency.unwrap_or(1).clamp(1, 8);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| format!("Failed to build translation HTTP client: {}", error))?;
    let mut translations = Vec::new();
    let mut fallback_errors = Vec::new();
    let mut pending_batches = VecDeque::from(
        blocks
            .chunks(batch_size)
            .map(|chunk| chunk.to_vec())
            .collect::<Vec<_>>(),
    );

    let mut in_flight = JoinSet::new();

    while !pending_batches.is_empty() || !in_flight.is_empty() {
        while in_flight.len() < concurrency && !pending_batches.is_empty() {
            let Some(batch) = pending_batches.pop_front() else {
                break;
            };
            let task_client = client.clone();
            let task_endpoint = endpoint.clone();
            let task_api_key = api_key.to_string();
            let task_model = model.to_string();
            let task_temperature = temperature;
            let task_reasoning_effort = reasoning_effort.clone();
            let task_source_language = source_language.to_string();
            let task_target_language = target_language.to_string();

            in_flight.spawn(async move {
                let outcome = translate_batch(
                    &task_client,
                    &task_endpoint,
                    &task_api_key,
                    &task_model,
                    &task_source_language,
                    &task_target_language,
                    task_temperature,
                    task_reasoning_effort.as_deref(),
                    &batch,
                    requests_per_minute,
                )
                .await;

                (batch, outcome)
            });
        }

        let Some(join_result) = in_flight.join_next().await else {
            continue;
        };
        let (batch, outcome) =
            join_result.map_err(|error| format!("Translation task failed: {}", error))?;

        match outcome {
            Ok(outcome) => {
                translations.extend(outcome.translations);

                if outcome.missing_blocks.is_empty() {
                    continue;
                }

                if batch.len() == 1 {
                    match translate_single_block_plaintext(
                        &client,
                        &endpoint,
                        api_key,
                        model,
                        source_language,
                        target_language,
                        temperature,
                        reasoning_effort.as_deref(),
                        &batch[0],
                        requests_per_minute,
                    )
                    .await
                    {
                        Ok(fallback_translation) => translations.push(fallback_translation),
                        Err(error) => fallback_errors.push(format!("{}: {}", batch[0].block_id, error)),
                    }
                    continue;
                }

                let retry_batch_size = if batch.len() <= 2 {
                    1
                } else {
                    (batch.len() / 2).max(1)
                };
                for retry_batch in outcome.missing_blocks.chunks(retry_batch_size) {
                    pending_batches.push_back(retry_batch.to_vec());
                }
            }
            Err(error) => {
                if batch.len() == 1 {
                    match translate_single_block_plaintext(
                        &client,
                        &endpoint,
                        api_key,
                        model,
                        source_language,
                        target_language,
                        temperature,
                        reasoning_effort.as_deref(),
                        &batch[0],
                        requests_per_minute,
                    )
                    .await
                    {
                        Ok(fallback_translation) => translations.push(fallback_translation),
                        Err(fallback_error) => fallback_errors.push(format!(
                            "{}: {} | Fallback translation failed: {}",
                            batch[0].block_id, error, fallback_error
                        )),
                    }
                    continue;
                }

                let retry_batch_size = if batch.len() <= 2 {
                    1
                } else {
                    (batch.len() / 2).max(1)
                };
                for retry_batch in batch.chunks(retry_batch_size) {
                    pending_batches.push_back(retry_batch.to_vec());
                }
            }
        }
    }

    let requested_ids = requested_blocks
        .iter()
        .map(|block| block.block_id.clone())
        .collect::<HashSet<_>>();
    let filtered_translations = filter_translation_outputs(translations, &requested_ids);
    let mut translations_by_block_id = HashMap::new();

    for translation in filtered_translations {
        translations_by_block_id
            .entry(translation.block_id.clone())
            .or_insert(translation);
    }

    for block in &requested_blocks {
        if translations_by_block_id.contains_key(&block.block_id) {
            continue;
        }

        match translate_single_block_plaintext(
            &client,
            &endpoint,
            api_key,
            model,
            source_language,
            target_language,
            temperature,
            reasoning_effort.as_deref(),
            block,
            requests_per_minute,
        )
        .await
        {
            Ok(fallback_translation) => {
                translations_by_block_id
                    .entry(fallback_translation.block_id.clone())
                    .or_insert(fallback_translation);
            }
            Err(error) => {
                fallback_errors.push(format!("{}: {}", block.block_id, error));
            }
        }
    }

    let mut ordered_translations = Vec::new();
    let mut missing_block_ids = Vec::new();

    for block in &requested_blocks {
        let Some(translation) = translations_by_block_id.remove(&block.block_id) else {
            missing_block_ids.push(block.block_id.clone());
            continue;
        };

        ordered_translations.push(translation);
    }

    if ordered_translations.is_empty() && !missing_block_ids.is_empty() {
        return Err(format!(
            "Translation response is still missing {} blocks after retries: {}",
            missing_block_ids.len(),
            missing_block_ids.join(", ")
        ));
    }

    if !fallback_errors.is_empty() {
        eprintln!(
            "Partial translation completed with {} fallback failures: {}",
            fallback_errors.len(),
            fallback_errors.join(" | ")
        );
    }

    Ok(ordered_translations)
}

#[cfg(test)]
mod tests;

use std::{
    collections::{HashMap, HashSet, VecDeque},
    time::Duration,
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
    source_language: String,
    target_language: String,
    blocks: Vec<TranslateBlockInput>,
    batch_size: Option<usize>,
    concurrency: Option<usize>,
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
) -> Result<String, String> {
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

async fn translate_batch(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    model: &str,
    source_language: &str,
    target_language: &str,
    blocks: &[TranslateBlockInput],
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
    "You are a professional academic paper translator. Translate from {} to {}. Preserve math, citations, table markers, symbols, and terminology. Return only strict JSON.",
    source_language,
    target_language
  );
    let user_prompt = json!({
    "instruction": "Translate each item independently. Keep blockId unchanged. Return {\"translations\":[{\"blockId\":\"...\",\"translatedText\":\"...\"}]} only.",
    "blocks": payload_blocks
  })
  .to_string();
    let body = json!({
      "model": model,
      "temperature": 0.2,
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
    block: &TranslateBlockInput,
) -> Result<TranslateBlockOutput, String> {
    let body = json!({
      "model": model,
      "temperature": 0.1,
      "messages": [
        {
          "role": "system",
          "content": format!(
            "You are a professional academic paper translator. Translate from {} to {}. Preserve math, citations, table markers, symbols, and terminology. Return only the translated text with no JSON, no markdown fences, and no commentary.",
            source_language,
            target_language
          )
        },
        {
          "role": "user",
          "content": format!(
            "Block ID: {}\nTranslate the following text only:\n{}",
            block.block_id,
            block.text
          )
        }
      ]
    });

    let content = request_translation_content(client, endpoint, api_key, body).await?;
    let translated_text = clean_plaintext_translation(&content);

    if translated_text.is_empty() {
        return Err(format!(
            "Fallback translation returned empty text for block {}",
            block.block_id
        ));
    }

    Ok(TranslateBlockOutput {
        block_id: block.block_id.clone(),
        translated_text,
    })
}

#[tauri::command]
pub async fn translate_blocks_openai_compatible(
    options: OpenAICompatibleTranslateOptions,
) -> Result<Vec<TranslateBlockOutput>, String> {
    let base_url = options.base_url.trim();
    let api_key = options.api_key.trim();
    let model = options.model.trim();
    let source_language = options.source_language.trim();
    let target_language = options.target_language.trim();
    let blocks = options
        .blocks
        .into_iter()
        .filter(|block| !block.text.trim().is_empty())
        .collect::<Vec<_>>();
    let requested_blocks = blocks.clone();

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
                    &batch,
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
                    let fallback_translation = translate_single_block_plaintext(
                        &client,
                        &endpoint,
                        api_key,
                        model,
                        source_language,
                        target_language,
                        &batch[0],
                    )
                    .await?;
                    translations.push(fallback_translation);
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
                    let fallback_translation = translate_single_block_plaintext(
                        &client,
                        &endpoint,
                        api_key,
                        model,
                        source_language,
                        target_language,
                        &batch[0],
                    )
                    .await
                    .map_err(|fallback_error| {
                        format!(
                            "{} | Fallback translation failed: {}",
                            error, fallback_error
                        )
                    })?;
                    translations.push(fallback_translation);
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

        let fallback_translation = translate_single_block_plaintext(
            &client,
            &endpoint,
            api_key,
            model,
            source_language,
            target_language,
            block,
        )
        .await?;

        translations_by_block_id
            .entry(fallback_translation.block_id.clone())
            .or_insert(fallback_translation);
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

    if !missing_block_ids.is_empty() {
        return Err(format!(
            "Translation response is still missing {} blocks after retries: {}",
            missing_block_ids.len(),
            missing_block_ids.join(", ")
        ));
    }

    Ok(ordered_translations)
}

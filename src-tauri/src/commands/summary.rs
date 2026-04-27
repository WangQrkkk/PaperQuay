use std::time::Duration;

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::json;

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
pub struct OpenAICompatibleSummaryOptions {
    base_url: String,
    api_key: String,
    model: String,
    title: String,
    authors: Option<String>,
    year: Option<String>,
    blocks: Vec<SummaryBlockInput>,
    document_text: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PaperSummary {
    title: String,
    #[serde(rename = "abstract")]
    r#abstract: String,
    overview: String,
    background: String,
    research_problem: String,
    approach: String,
    experiment_setup: String,
    key_findings: Vec<String>,
    conclusions: String,
    limitations: String,
    takeaways: Vec<String>,
    keywords: Vec<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RawPaperSummary {
    #[serde(default)]
    title: Option<String>,
    #[serde(rename = "abstract", default)]
    r#abstract: Option<String>,
    #[serde(default)]
    overview: Option<String>,
    #[serde(default)]
    background: Option<String>,
    #[serde(default)]
    research_problem: Option<String>,
    #[serde(default)]
    approach: Option<String>,
    #[serde(default)]
    experiment_setup: Option<String>,
    #[serde(default)]
    key_findings: Vec<String>,
    #[serde(default)]
    conclusions: Option<String>,
    #[serde(default)]
    limitations: Option<String>,
    #[serde(default)]
    takeaways: Vec<String>,
    #[serde(default)]
    keywords: Vec<String>,
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

const SUMMARY_STRING_FIELDS: [&str; 8] = [
    "title",
    "abstract",
    "overview",
    "background",
    "researchProblem",
    "approach",
    "experimentSetup",
    "conclusions",
];

const SUMMARY_OPTIONAL_STRING_FIELDS: [&str; 1] = ["limitations"];

const SUMMARY_ARRAY_FIELDS: [&str; 3] = ["keyFindings", "takeaways", "keywords"];

const SUMMARY_FIELD_NAMES: [&str; 12] = [
    "title",
    "abstract",
    "overview",
    "background",
    "researchProblem",
    "approach",
    "experimentSetup",
    "keyFindings",
    "conclusions",
    "limitations",
    "takeaways",
    "keywords",
];

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

fn skip_ascii_whitespace(content: &str, mut index: usize) -> usize {
    while let Some(byte) = content.as_bytes().get(index) {
        if byte.is_ascii_whitespace() {
            index += 1;
        } else {
            break;
        }
    }

    index
}

fn normalize_json_quotes(content: &str) -> String {
    content
        .replace(['\u{201C}', '\u{201D}'], "\"")
        .replace(['\u{2018}', '\u{2019}'], "'")
}

fn remove_trailing_commas(content: &str) -> String {
    let mut repaired = String::with_capacity(content.len());
    let mut in_string = false;
    let mut escaped = false;

    for (index, character) in content.char_indices() {
        if escaped {
            repaired.push(character);
            escaped = false;
            continue;
        }

        if in_string {
            repaired.push(character);
            match character {
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }

        match character {
            '"' => {
                in_string = true;
                repaired.push(character);
            }
            ',' => {
                let next_non_whitespace = content[index + character.len_utf8()..]
                    .chars()
                    .find(|next| !next.is_whitespace());

                if matches!(next_non_whitespace, Some('}') | Some(']')) {
                    continue;
                }

                repaired.push(character);
            }
            _ => repaired.push(character),
        }
    }

    repaired
}

fn unwrap_json_string(content: &str) -> Option<String> {
    let trimmed = content.trim();

    if !trimmed.starts_with('"') || !trimmed.ends_with('"') {
        return None;
    }

    serde_json::from_str::<String>(trimmed).ok()
}

fn complete_unbalanced_json_fragment(fragment: &str) -> String {
    let mut in_string = false;
    let mut escaped = false;
    let mut brace_depth = 0usize;
    let mut bracket_depth = 0usize;

    for character in fragment.chars() {
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
            '{' => brace_depth += 1,
            '}' => brace_depth = brace_depth.saturating_sub(1),
            '[' => bracket_depth += 1,
            ']' => bracket_depth = bracket_depth.saturating_sub(1),
            _ => {}
        }
    }

    let mut completed = fragment.to_string();
    completed.push_str(&"]".repeat(bracket_depth));
    completed.push_str(&"}".repeat(brace_depth));
    completed
}

fn extract_first_balanced_json_object(content: &str) -> Option<String> {
    let mut in_string = false;
    let mut escaped = false;
    let mut brace_depth = 0usize;
    let mut object_start: Option<usize> = None;

    for (index, character) in content.char_indices() {
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
            '{' => {
                if brace_depth == 0 {
                    object_start = Some(index);
                }
                brace_depth += 1;
            }
            '}' => {
                if brace_depth == 0 {
                    continue;
                }

                brace_depth -= 1;
                if brace_depth == 0 {
                    let start = object_start?;
                    return Some(content[start..=index].to_string());
                }
            }
            _ => {}
        }
    }

    object_start.map(|start| complete_unbalanced_json_fragment(&content[start..]))
}

fn push_unique_candidate(candidates: &mut Vec<String>, candidate: String) {
    let trimmed = candidate.trim();

    if trimmed.is_empty() {
        return;
    }

    if !candidates.iter().any(|existing| existing == trimmed) {
        candidates.push(trimmed.to_string());
    }
}

fn collect_json_candidates(content: &str) -> Vec<String> {
    let cleaned = normalize_json_quotes(&strip_json_fences(content));
    let mut candidates = Vec::new();

    push_unique_candidate(&mut candidates, cleaned.clone());

    if let Some(unwrapped) = unwrap_json_string(&cleaned) {
        push_unique_candidate(&mut candidates, unwrapped);
    }

    if let Some(object) = extract_first_balanced_json_object(&cleaned) {
        push_unique_candidate(&mut candidates, object);
    }

    let repaired = candidates
        .iter()
        .map(|candidate| remove_trailing_commas(candidate))
        .collect::<Vec<_>>();

    for candidate in repaired {
        push_unique_candidate(&mut candidates, candidate);
    }

    candidates
}

fn find_key_token_start(content: &str, key: &str, from: usize) -> Option<usize> {
    let quoted_pattern = format!("\"{}\"", key);
    let plain_pattern = format!("{}:", key);
    let mut best: Option<usize> = None;

    if let Some(offset) = content[from..].find(&quoted_pattern) {
        let token_start = from + offset;
        let after_key = skip_ascii_whitespace(content, token_start + quoted_pattern.len());
        if content[after_key..].starts_with(':') {
            best = Some(token_start);
        }
    }

    if let Some(offset) = content[from..].find(&plain_pattern) {
        let token_start = from + offset;
        let previous_ok = token_start == 0
            || content[..token_start]
                .chars()
                .rev()
                .find(|character| !character.is_whitespace())
                .map(|character| matches!(character, '{' | ',' | '\n' | '\r'))
                .unwrap_or(true);

        if previous_ok {
            best = Some(best.map_or(token_start, |current| current.min(token_start)));
        }
    }

    best
}

fn find_key_value_start(content: &str, key: &str) -> Option<usize> {
    let token_start = find_key_token_start(content, key, 0)?;
    let quoted_pattern = format!("\"{}\"", key);
    let after_key = if content[token_start..].starts_with(&quoted_pattern) {
        token_start + quoted_pattern.len()
    } else {
        token_start + key.len()
    };
    let colon_index = skip_ascii_whitespace(content, after_key);
    let value_start = skip_ascii_whitespace(content, colon_index + 1);

    Some(value_start)
}

fn find_next_key_start(content: &str, from: usize, current_key: &str) -> Option<usize> {
    SUMMARY_FIELD_NAMES
        .iter()
        .filter(|candidate| **candidate != current_key)
        .filter_map(|candidate| find_key_token_start(content, candidate, from))
        .min()
}

fn extract_field_fragment(content: &str, key: &str) -> Option<String> {
    let value_start = find_key_value_start(content, key)?;
    let value_end = find_next_key_start(content, value_start, key).unwrap_or(content.len());

    Some(
        content[value_start..value_end]
            .trim()
            .trim_end_matches(',')
            .trim()
            .to_string(),
    )
}

fn decode_loose_string(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches(',').trim();

    if trimmed.is_empty() {
        return String::new();
    }

    if trimmed.starts_with('"') && trimmed.ends_with('"') && trimmed.len() >= 2 {
        if let Ok(decoded) = serde_json::from_str::<String>(trimmed) {
            return decoded.trim().to_string();
        }

        return trimmed[1..trimmed.len() - 1]
            .replace("\\n", "\n")
            .replace("\\t", "\t")
            .replace("\\\"", "\"")
            .replace("\\\\", "\\")
            .trim()
            .to_string();
    }

    trimmed
        .trim_matches('"')
        .trim_matches('\'')
        .replace("\\n", "\n")
        .replace("\\t", "\t")
        .replace("\\\"", "\"")
        .replace("\\\\", "\\")
        .trim()
        .trim_end_matches('}')
        .trim_end_matches(']')
        .trim()
        .to_string()
}

fn parse_array_items_loose(fragment: &str) -> Vec<String> {
    let trimmed = fragment.trim().trim_end_matches(',').trim();

    if let Ok(parsed) = serde_json::from_str::<Vec<String>>(trimmed) {
        return parsed
            .into_iter()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect();
    }

    let inner = trimmed
        .strip_prefix('[')
        .unwrap_or(trimmed)
        .strip_suffix(']')
        .unwrap_or(trimmed);
    let mut items = Vec::new();
    let mut in_string = false;
    let mut escaped = false;
    let mut item_start = 0usize;

    for (index, character) in inner.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }

        if in_string {
            match character {
                '\\' => escaped = true,
                '"' => {
                    let item = decode_loose_string(&inner[item_start..index]);
                    if !item.is_empty() {
                        items.push(item);
                    }
                    in_string = false;
                }
                _ => {}
            }
            continue;
        }

        if character == '"' {
            in_string = true;
            item_start = index + character.len_utf8();
        }
    }

    if !items.is_empty() {
        return items;
    }

    inner
        .split(|character| matches!(character, '\n' | '\r' | ','))
        .map(|item| {
            item.trim()
                .trim_matches('"')
                .trim_matches('\'')
                .trim_start_matches('-')
                .trim_start_matches('*')
                .trim()
                .to_string()
        })
        .filter(|item| !item.is_empty())
        .collect()
}

fn salvage_summary_content(content: &str, fallback_title: &str) -> Option<PaperSummary> {
    let cleaned = collect_json_candidates(content)
        .into_iter()
        .next()
        .unwrap_or_else(|| strip_json_fences(content));

    let mut raw = RawPaperSummary::default();

    for key in SUMMARY_STRING_FIELDS {
        let value =
            extract_field_fragment(&cleaned, key).map(|fragment| decode_loose_string(&fragment));

        match key {
            "title" => raw.title = value.filter(|item| !item.is_empty()),
            "abstract" => raw.r#abstract = value.filter(|item| !item.is_empty()),
            "overview" => raw.overview = value.filter(|item| !item.is_empty()),
            "background" => raw.background = value.filter(|item| !item.is_empty()),
            "researchProblem" => raw.research_problem = value.filter(|item| !item.is_empty()),
            "approach" => raw.approach = value.filter(|item| !item.is_empty()),
            "experimentSetup" => raw.experiment_setup = value.filter(|item| !item.is_empty()),
            "conclusions" => raw.conclusions = value.filter(|item| !item.is_empty()),
            _ => {}
        }
    }

    for key in SUMMARY_OPTIONAL_STRING_FIELDS {
        let value =
            extract_field_fragment(&cleaned, key).map(|fragment| decode_loose_string(&fragment));

        if key == "limitations" {
            raw.limitations = value.filter(|item| !item.is_empty());
        }
    }

    for key in SUMMARY_ARRAY_FIELDS {
        let items = extract_field_fragment(&cleaned, key)
            .map(|fragment| parse_array_items_loose(&fragment))
            .unwrap_or_default();

        match key {
            "keyFindings" => raw.key_findings = items,
            "takeaways" => raw.takeaways = items,
            "keywords" => raw.keywords = items,
            _ => {}
        }
    }

    let has_any_content = raw.title.is_some()
        || raw.r#abstract.is_some()
        || raw.overview.is_some()
        || raw.background.is_some()
        || raw.research_problem.is_some()
        || raw.approach.is_some()
        || raw.experiment_setup.is_some()
        || raw.conclusions.is_some()
        || raw.limitations.is_some()
        || !raw.key_findings.is_empty()
        || !raw.takeaways.is_empty()
        || !raw.keywords.is_empty();

    if !has_any_content {
        return None;
    }

    Some(normalize_summary(materialize_summary(raw, fallback_title)))
}

fn normalize_list(mut items: Vec<String>, fallback: &str) -> Vec<String> {
    items.retain(|item| !item.trim().is_empty());

    if items.is_empty() {
        return vec![fallback.to_string()];
    }

    items.truncate(8);
    items
}

fn normalize_summary(mut summary: PaperSummary) -> PaperSummary {
    if summary.title.trim().is_empty() {
        summary.title = "未命名论文".to_string();
    }

    for field in [
        &mut summary.r#abstract,
        &mut summary.overview,
        &mut summary.background,
        &mut summary.research_problem,
        &mut summary.approach,
        &mut summary.experiment_setup,
        &mut summary.conclusions,
        &mut summary.limitations,
    ] {
        if field.trim().is_empty() {
            *field = "未在当前内容中明确说明。".to_string();
        }
    }

    summary.key_findings = normalize_list(summary.key_findings, "未从当前内容中提炼出明确发现。");
    summary.takeaways = normalize_list(
        summary.takeaways,
        "建议结合论文原文进一步确认方法细节、实验设置和适用范围。",
    );
    summary.keywords = normalize_list(summary.keywords, "待补充");

    summary
}

fn materialize_summary(raw: RawPaperSummary, fallback_title: &str) -> PaperSummary {
    PaperSummary {
        title: raw
            .title
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| fallback_title.trim().to_string()),
        r#abstract: raw.r#abstract.unwrap_or_default(),
        overview: raw.overview.unwrap_or_default(),
        background: raw.background.unwrap_or_default(),
        research_problem: raw.research_problem.unwrap_or_default(),
        approach: raw.approach.unwrap_or_default(),
        experiment_setup: raw.experiment_setup.unwrap_or_default(),
        key_findings: raw.key_findings,
        conclusions: raw.conclusions.unwrap_or_default(),
        limitations: raw.limitations.unwrap_or_default(),
        takeaways: raw.takeaways,
        keywords: raw.keywords,
    }
}

#[allow(dead_code)]
fn parse_summary_content(content: &str, fallback_title: &str) -> Result<PaperSummary, String> {
    let cleaned = strip_json_fences(content);
    let summary = serde_json::from_str::<RawPaperSummary>(&cleaned)
        .map_err(|error| format!("摘要结果不是合法 JSON：{}；原始内容：{}", error, content))?;

    Ok(normalize_summary(materialize_summary(
        summary,
        fallback_title,
    )))
}

fn parse_summary_content_resilient(
    content: &str,
    fallback_title: &str,
) -> Result<PaperSummary, String> {
    let candidates = collect_json_candidates(content);
    let mut parse_errors = Vec::new();

    for candidate in &candidates {
        match serde_json::from_str::<RawPaperSummary>(candidate) {
            Ok(summary) => {
                return Ok(normalize_summary(materialize_summary(
                    summary,
                    fallback_title,
                )));
            }
            Err(error) => parse_errors.push(error.to_string()),
        }
    }

    if let Some(summary) = salvage_summary_content(content, fallback_title) {
        return Ok(summary);
    }

    let joined_errors = if parse_errors.is_empty() {
        "unknown parse error".to_string()
    } else {
        parse_errors.join(" | ")
    };

    Err(format!(
        "Summary output was not valid JSON after repair attempts: {}; raw content: {}",
        joined_errors, content
    ))
}

fn build_summary_header(title: &str, authors: Option<&str>, year: Option<&str>) -> Vec<String> {
    let mut sections = Vec::new();

    sections.push(format!("Title: {}", title));

    if let Some(authors) = authors.filter(|value| !value.trim().is_empty()) {
        sections.push(format!("Authors: {}", authors.trim()));
    }

    if let Some(year) = year.filter(|value| !value.trim().is_empty()) {
        sections.push(format!("Year: {}", year.trim()));
    }

    sections
}

fn build_summary_context_from_blocks(
    title: &str,
    authors: Option<&str>,
    year: Option<&str>,
    blocks: &[SummaryBlockInput],
) -> String {
    let mut sections = build_summary_header(title, authors, year);
    let mut char_count = 0usize;
    let max_chars = 18_000usize;

    sections.push("Document blocks:".to_string());

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
        sections.push(line);
    }

    sections.join("\n")
}

fn build_summary_context_from_text(
    title: &str,
    authors: Option<&str>,
    year: Option<&str>,
    document_text: &str,
) -> String {
    let mut sections = build_summary_header(title, authors, year);
    let max_chars = 24_000usize;
    let mut normalized_text = document_text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    if normalized_text.chars().count() > max_chars {
        normalized_text = normalized_text.chars().take(max_chars).collect();
    }

    sections.push("Document text:".to_string());
    sections.push(normalized_text);
    sections.join("\n\n")
}

async fn request_summary(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    body: serde_json::Value,
) -> Result<String, String> {
    let response = client
        .post(endpoint)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("请求论文摘要接口失败：{}", error))?;
    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|error| format!("读取论文摘要接口响应失败：{}", error))?;

    if !status.is_success() {
        return Err(format!(
            "论文摘要接口 HTTP 状态异常：{}，{}",
            status, response_text
        ));
    }

    let completion =
        serde_json::from_str::<ChatCompletionResponse>(&response_text).map_err(|error| {
            format!(
                "解析 chat/completions 响应失败：{}；原始响应：{}",
                error, response_text
            )
        })?;
    let message = completion
        .choices
        .first()
        .map(|choice| &choice.message)
        .ok_or_else(|| "chat/completions 响应缺少 choices[0]".to_string())?;

    if let Some(refusal) = &message.refusal {
        return Err(format!("模型拒绝生成摘要：{}", refusal));
    }

    message
        .content
        .clone()
        .ok_or_else(|| "chat/completions 响应缺少 message.content".to_string())
}

fn build_summary_schema() -> serde_json::Value {
    json!({
      "type": "json_schema",
      "json_schema": {
        "name": "paper_summary",
        "strict": true,
        "schema": {
          "type": "object",
          "properties": {
            "title": { "type": "string" },
            "abstract": { "type": "string" },
            "overview": { "type": "string" },
            "background": { "type": "string" },
            "researchProblem": { "type": "string" },
            "approach": { "type": "string" },
            "experimentSetup": { "type": "string" },
            "keyFindings": {
              "type": "array",
              "items": { "type": "string" }
            },
            "conclusions": { "type": "string" },
            "limitations": { "type": "string" },
            "takeaways": {
              "type": "array",
              "items": { "type": "string" }
            },
            "keywords": {
              "type": "array",
              "items": { "type": "string" }
            }
          },
          "required": [
            "title",
            "abstract",
            "overview",
            "background",
            "researchProblem",
            "approach",
            "experimentSetup",
            "keyFindings",
            "conclusions",
            "limitations",
            "takeaways",
            "keywords"
          ],
          "additionalProperties": false
        }
      }
    })
}

fn build_summary_messages(document_context: &str) -> serde_json::Value {
    json!([
      {
        "role": "system",
        "content": "你是一名专业的学术论文分析者，擅长阅读和拆解计算机、工程、自然科学与交叉学科论文。你的任务不是泛泛复述，而是像严谨的研究者一样，基于给定论文内容提炼研究背景、核心问题、方法设计、实验证据、结论价值与局限性。只能依据提供的论文内容生成结果，并使用简体中文作答。请忠实于原文，避免臆测；如果某个字段缺乏证据支持，必须明确写“未在当前内容中明确说明。”输出必须是严格 JSON，且字段内容要具体、细致、可用于学术阅读。"
      },
      {
        "role": "user",
        "content": format!(
          "请基于下列论文内容生成模块化论文总览，适合在桌面阅读器中展示。\n要求：\n1. 所有字段使用简体中文，只能依据给定内容总结，不要编造论文中未出现的结论。\n2. 输出内容要体现“专业学术论文分析者”的视角，强调研究动机、技术路线、证据链和学术价值，避免空泛套话。\n3. overview 用 3-5 句概括整篇论文，至少覆盖研究对象、核心问题、方法主线、实验或证据支撑、最终结论。\n4. abstract 给出忠实且信息密度高的压缩版摘要；如果没有识别到摘要段落，也要给出基于全文的摘要说明。\n5. background 用 2-4 句说明研究领域背景、应用场景、已有工作的整体脉络，以及为什么这个问题值得研究。\n6. researchProblem 用 2-4 句明确指出论文试图解决的具体问题、技术挑战、约束条件，以及现有方法的不足。\n7. approach 用 3-5 句细致说明方法框架、关键模块、核心创新点、方法相对基线或传统方案的差异，不要只写“提出了一个方法”。\n8. experimentSetup 必须重点细致分析，可用 3-6 句。优先覆盖：任务设置、数据集/基准、实验对象、对比基线、评价指标、训练或实现设置、消融实验、泛化/鲁棒性验证，以及实验设计是否充分。若论文不是实验型研究，也要明确说明其验证方式或缺失之处。\n9. keyFindings 输出 4-8 条，尽量写成有信息量的结论，优先总结实验结果、性能提升、关键观察、定性/定量证据，而不是重复字段标题。\n10. conclusions 用 2-4 句概括论文最终结论、实际意义和学术贡献。\n11. limitations 用 2-4 句明确指出论文已承认或从内容中可以直接看出的局限，例如数据规模、实验范围、假设条件、泛化性、计算代价、缺少真实部署验证等；没有依据时不要臆测。\n12. takeaways 输出 3-5 条，写成对读者有价值的阅读提示，例如这篇论文最值得关注的贡献、最可信的证据、最需要保留怀疑的部分。\n13. keywords 输出 5-10 个关键词，优先覆盖任务、方法、数据、指标、领域术语。\n14. 若论文中存在实验部分，请在 experimentSetup 和 keyFindings 中特别重视以下内容：实验是否覆盖主张、对比是否公平、指标是否匹配任务目标、结果提升是否显著、作者是否通过消融或附加实验解释性能来源。\n\n论文内容：\n{}",
          document_context
        )
      }
    ])
}

#[tauri::command]
pub async fn summarize_document_openai_compatible(
    options: OpenAICompatibleSummaryOptions,
) -> Result<PaperSummary, String> {
    let base_url = options.base_url.trim();
    let api_key = options.api_key.trim();
    let model = options.model.trim();
    let title = options.title.trim();
    let authors = options.authors;
    let year = options.year;
    let document_text = options.document_text.unwrap_or_default();
    let blocks = options
        .blocks
        .into_iter()
        .filter(|block| !block.text.trim().is_empty())
        .collect::<Vec<_>>();

    if base_url.is_empty() {
        return Err("摘要接口 Base URL 不能为空".to_string());
    }

    if api_key.is_empty() {
        return Err("摘要接口 API Key 不能为空".to_string());
    }

    if model.is_empty() {
        return Err("摘要模型名称不能为空".to_string());
    }

    if title.is_empty() {
        return Err("论文标题不能为空".to_string());
    }

    if blocks.is_empty() && document_text.trim().is_empty() {
        return Err("当前没有可用于生成摘要的结构化文本。".to_string());
    }

    let endpoint = build_chat_completions_url(base_url);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| format!("创建摘要 HTTP 客户端失败：{}", error))?;
    let document_context = if document_text.trim().is_empty() {
        build_summary_context_from_blocks(title, authors.as_deref(), year.as_deref(), &blocks)
    } else {
        build_summary_context_from_text(title, authors.as_deref(), year.as_deref(), &document_text)
    };
    let base_body = json!({
      "model": model,
      "temperature": 0.2,
      "messages": build_summary_messages(&document_context)
    });

    let first_try_body = json!({
      "model": base_body["model"],
      "temperature": base_body["temperature"],
      "messages": base_body["messages"],
      "response_format": build_summary_schema()
    });

    let first_try = request_summary(&client, &endpoint, api_key, first_try_body).await;

    let content = match first_try {
        Ok(content) => content,
        Err(_) => request_summary(&client, &endpoint, api_key, base_body).await?,
    };

    parse_summary_content_resilient(&content, title)
}

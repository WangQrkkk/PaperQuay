use std::collections::HashSet;
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
    output_language: Option<String>,
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

const ABSTRACT_KEYS: [&str; 5] = ["abstract", "摘要", "summary", "overview", "synopsis"];
const BACKGROUND_KEYS: [&str; 8] = [
    "introduction",
    "background",
    "motivation",
    "related work",
    "literature",
    "existing",
    "背景",
    "相关工作",
];
const PROBLEM_KEYS: [&str; 9] = [
    "problem",
    "challenge",
    "objective",
    "goal",
    "constraint",
    "uncertain",
    "gap",
    "问题",
    "挑战",
];
const REVIEW_METHOD_KEYS: [&str; 12] = [
    "review",
    "survey",
    "taxonomy",
    "classification",
    "categor",
    "compare",
    "comparison",
    "method",
    "approach",
    "algorithm",
    "综述",
    "分类",
];
const EXPERIMENT_KEYS: [&str; 12] = [
    "experiment",
    "evaluation",
    "result",
    "simulation",
    "benchmark",
    "dataset",
    "metric",
    "performance",
    "case study",
    "validation",
    "实验",
    "结果",
];
const CONCLUSION_KEYS: [&str; 10] = [
    "conclusion",
    "discussion",
    "future",
    "limitation",
    "open issue",
    "open challenge",
    "finding",
    "takeaway",
    "结论",
    "局限",
];

#[derive(Debug, Clone)]
struct SummaryEvidenceUnit {
    index: usize,
    label: String,
    text: String,
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

fn prefers_chinese(language: &str) -> bool {
    let lower = language.to_lowercase();
    lower.contains("chinese") || lower.contains("zh") || language.contains('中')
}

fn evidence_snippets(document_context: &str, limit: usize) -> Vec<String> {
    document_context
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();

            if !trimmed.starts_with("- [") {
                return None;
            }

            let text = trimmed
                .split_once("] ")
                .map(|(_, value)| value)
                .unwrap_or(trimmed)
                .trim()
                .trim_start_matches("- ")
                .trim()
                .to_string();

            if text.is_empty() {
                return None;
            }

            Some(truncate_chars(&text, 220))
        })
        .take(limit)
        .collect()
}

fn build_extractive_fallback_summary(
    title: &str,
    authors: Option<&str>,
    year: Option<&str>,
    document_context: &str,
    output_language: &str,
) -> PaperSummary {
    let snippets = evidence_snippets(document_context, 8);
    let joined = if snippets.is_empty() {
        title.to_string()
    } else {
        snippets.join(" ")
    };

    if prefers_chinese(output_language) {
        return PaperSummary {
            title: title.to_string(),
            r#abstract: format!(
                "本地稳定兜底摘要：{}",
                truncate_chars(&joined, 420)
            ),
            overview: format!(
                "模型返回结果无法稳定解析为结构化 JSON，因此当前概览使用本地抽取式证据兜底生成。该摘要只依据文档中被抽取出的代表性片段，适合快速判断论文主题，但建议重新生成以获得更完整的 AI 分析。{}{}",
                authors.map(|value| format!("作者：{}。", value)).unwrap_or_default(),
                year.map(|value| format!("年份：{}。", value)).unwrap_or_default(),
            ),
            background: snippets
                .get(0)
                .cloned()
                .unwrap_or_else(|| "未在当前内容中明确说明。".to_string()),
            research_problem: snippets
                .get(1)
                .cloned()
                .unwrap_or_else(|| "未在当前内容中明确说明。".to_string()),
            approach: snippets
                .get(2)
                .cloned()
                .unwrap_or_else(|| "未在当前内容中明确说明。".to_string()),
            experiment_setup: snippets
                .get(3)
                .cloned()
                .unwrap_or_else(|| "未在当前内容中明确说明。".to_string()),
            key_findings: if snippets.is_empty() {
                vec!["未从当前内容中提炼出明确发现。".to_string()]
            } else {
                snippets.iter().take(6).cloned().collect()
            },
            conclusions: snippets
                .last()
                .cloned()
                .unwrap_or_else(|| "未在当前内容中明确说明。".to_string()),
            limitations: "本地兜底摘要无法替代模型对全文证据链的综合分析；请在模型配置稳定后重新生成摘要。".to_string(),
            takeaways: vec![
                "这是本地抽取式兜底结果，优先保证可用性和不编造。".to_string(),
                "建议检查 MinerU 解析质量和摘要模型配置后重新生成。".to_string(),
                "若论文是综述，请重点查看分类、比较维度、未来方向和局限部分。".to_string(),
            ],
            keywords: vec!["本地兜底".to_string(), "抽取式摘要".to_string(), "论文概览".to_string()],
        };
    }

    PaperSummary {
        title: title.to_string(),
        r#abstract: format!("Local extractive fallback summary: {}", truncate_chars(&joined, 420)),
        overview: format!(
            "The model response could not be parsed as stable structured JSON, so this overview was generated by a deterministic local extractive fallback. It uses representative snippets from the document evidence pack and is intended for quick triage rather than full AI analysis. {}{}",
            authors.map(|value| format!("Authors: {}. ", value)).unwrap_or_default(),
            year.map(|value| format!("Year: {}.", value)).unwrap_or_default(),
        ),
        background: snippets
            .get(0)
            .cloned()
            .unwrap_or_else(|| "Not clearly stated in the provided content.".to_string()),
        research_problem: snippets
            .get(1)
            .cloned()
            .unwrap_or_else(|| "Not clearly stated in the provided content.".to_string()),
        approach: snippets
            .get(2)
            .cloned()
            .unwrap_or_else(|| "Not clearly stated in the provided content.".to_string()),
        experiment_setup: snippets
            .get(3)
            .cloned()
            .unwrap_or_else(|| "Not clearly stated in the provided content.".to_string()),
        key_findings: if snippets.is_empty() {
            vec!["No clear findings were extracted from the provided content.".to_string()]
        } else {
            snippets.iter().take(6).cloned().collect()
        },
        conclusions: snippets
            .last()
            .cloned()
            .unwrap_or_else(|| "Not clearly stated in the provided content.".to_string()),
        limitations: "This local fallback cannot replace a full model-based synthesis of the evidence chain; regenerate the summary after the model configuration is stable.".to_string(),
        takeaways: vec![
            "This is a deterministic extractive fallback designed to avoid fabrication.".to_string(),
            "Check MinerU parsing quality and model configuration, then regenerate the summary.".to_string(),
            "For review papers, inspect taxonomy, comparison criteria, future directions, and limitations.".to_string(),
        ],
        keywords: vec![
            "local fallback".to_string(),
            "extractive summary".to_string(),
            "paper overview".to_string(),
        ],
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

fn normalize_evidence_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }

    let mut truncated = text.chars().take(max_chars).collect::<String>();
    truncated.push_str("...");
    truncated
}

fn collect_units_from_blocks(blocks: &[SummaryBlockInput]) -> Vec<SummaryEvidenceUnit> {
    blocks
        .iter()
        .enumerate()
        .filter_map(|(index, block)| {
            let text = normalize_evidence_text(&block.text);

            if text.chars().count() < 24 {
                return None;
            }

            Some(SummaryEvidenceUnit {
                index,
                label: format!(
                    "page {} / {} / {}",
                    block.page_index + 1,
                    block.block_type,
                    block.block_id
                ),
                text,
            })
        })
        .collect()
}

fn collect_units_from_text(document_text: &str) -> Vec<SummaryEvidenceUnit> {
    let mut units = Vec::new();
    let mut current = String::new();
    let mut current_label = "text".to_string();

    let flush = |units: &mut Vec<SummaryEvidenceUnit>, label: &str, text: &mut String| {
        let normalized = normalize_evidence_text(text);

        if normalized.chars().count() >= 32 {
            units.push(SummaryEvidenceUnit {
                index: units.len(),
                label: label.to_string(),
                text: normalized,
            });
        }

        text.clear();
    };

    for line in document_text.lines() {
        let trimmed = line.trim();

        if trimmed.is_empty() {
            flush(&mut units, &current_label, &mut current);
            continue;
        }

        if trimmed.starts_with('#') {
            flush(&mut units, &current_label, &mut current);
            current_label = trimmed
                .trim_start_matches('#')
                .trim()
                .chars()
                .take(80)
                .collect();
            continue;
        }

        if current.chars().count() > 1_200 {
            flush(&mut units, &current_label, &mut current);
        }

        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(trimmed);
    }

    flush(&mut units, &current_label, &mut current);
    units
}

fn unit_keyword_score(unit: &SummaryEvidenceUnit, keys: &[&str]) -> usize {
    let haystack = format!("{} {}", unit.label, unit.text).to_lowercase();

    keys.iter()
        .filter(|key| haystack.contains(&key.to_lowercase()))
        .count()
}

fn pick_units_by_keywords(
    units: &[SummaryEvidenceUnit],
    keys: &[&str],
    limit: usize,
    max_chars: usize,
    selected: &mut HashSet<usize>,
) -> Vec<SummaryEvidenceUnit> {
    let mut scored = units
        .iter()
        .filter_map(|unit| {
            let score = unit_keyword_score(unit, keys);

            if score == 0 {
                return None;
            }

            Some((score, unit.index, unit))
        })
        .collect::<Vec<_>>();

    scored.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| left.1.cmp(&right.1)));

    let mut picked = Vec::new();
    let mut char_count = 0usize;

    for (_, _, unit) in scored {
        if picked.len() >= limit || selected.contains(&unit.index) {
            continue;
        }

        let unit_len = unit.text.chars().count();

        if char_count > 0 && char_count + unit_len > max_chars {
            continue;
        }

        char_count += unit_len;
        selected.insert(unit.index);
        picked.push(unit.clone());
    }

    picked
}

fn pick_representative_units(
    units: &[SummaryEvidenceUnit],
    limit: usize,
    selected: &mut HashSet<usize>,
) -> Vec<SummaryEvidenceUnit> {
    if units.is_empty() {
        return Vec::new();
    }

    let last = units.len().saturating_sub(1);
    let candidate_positions = [
        0,
        1.min(last),
        units.len() / 4,
        units.len() / 2,
        (units.len() * 3) / 4,
        last.saturating_sub(1),
        last,
    ];
    let mut picked = Vec::new();

    for position in candidate_positions {
        if picked.len() >= limit {
            break;
        }

        if let Some(unit) = units.get(position) {
            if selected.insert(unit.index) {
                picked.push(unit.clone());
            }
        }
    }

    picked
}

fn append_evidence_section(
    sections: &mut Vec<String>,
    title: &str,
    units: Vec<SummaryEvidenceUnit>,
) {
    if units.is_empty() {
        return;
    }

    let mut lines = vec![format!("## {}", title)];

    for unit in units {
        lines.push(format!(
            "- [{}] {}",
            unit.label,
            truncate_chars(&unit.text, 900)
        ));
    }

    sections.push(lines.join("\n"));
}

fn build_summary_context_from_units(
    title: &str,
    authors: Option<&str>,
    year: Option<&str>,
    units: &[SummaryEvidenceUnit],
) -> String {
    let mut sections = build_summary_header(title, authors, year);
    let mut selected = HashSet::new();

    sections.push(
        "The following evidence pack is deterministically extracted from the paper. Use only this evidence and the metadata above. Sections are sampled from the beginning, topical matches, and later parts of the document so review papers are not summarized from the first pages only."
            .to_string(),
    );

    append_evidence_section(
        &mut sections,
        "Abstract / scope evidence",
        pick_units_by_keywords(units, &ABSTRACT_KEYS, 4, 4_000, &mut selected),
    );
    append_evidence_section(
        &mut sections,
        "Background / motivation evidence",
        pick_units_by_keywords(units, &BACKGROUND_KEYS, 5, 5_000, &mut selected),
    );
    append_evidence_section(
        &mut sections,
        "Problem / challenge evidence",
        pick_units_by_keywords(units, &PROBLEM_KEYS, 5, 5_000, &mut selected),
    );
    append_evidence_section(
        &mut sections,
        "Methods / taxonomy / review evidence",
        pick_units_by_keywords(units, &REVIEW_METHOD_KEYS, 8, 8_000, &mut selected),
    );
    append_evidence_section(
        &mut sections,
        "Experiment / validation evidence",
        pick_units_by_keywords(units, &EXPERIMENT_KEYS, 6, 6_000, &mut selected),
    );
    append_evidence_section(
        &mut sections,
        "Conclusion / limitation / future-work evidence",
        pick_units_by_keywords(units, &CONCLUSION_KEYS, 6, 6_000, &mut selected),
    );
    append_evidence_section(
        &mut sections,
        "Representative whole-document samples",
        pick_representative_units(units, 7, &mut selected),
    );

    if sections.len() <= 2 {
        append_evidence_section(
            &mut sections,
            "Available document evidence",
            units.iter().take(12).cloned().collect(),
        );
    }

    let mut context = sections.join("\n\n");
    let max_chars = 28_000usize;

    if context.chars().count() > max_chars {
        context = context.chars().take(max_chars).collect();
    }

    context
}

fn build_summary_context_from_blocks(
    title: &str,
    authors: Option<&str>,
    year: Option<&str>,
    blocks: &[SummaryBlockInput],
) -> String {
    build_summary_context_from_units(title, authors, year, &collect_units_from_blocks(blocks))
}

fn build_summary_context_from_text(
    title: &str,
    authors: Option<&str>,
    year: Option<&str>,
    document_text: &str,
) -> String {
    build_summary_context_from_units(
        title,
        authors,
        year,
        &collect_units_from_text(document_text),
    )
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

fn build_summary_messages(document_context: &str, output_language: &str) -> serde_json::Value {
    let language = output_language.trim();
    let language = if language.is_empty() {
        "Chinese"
    } else {
        language
    };

    json!([
      {
        "role": "system",
        "content": format!(
          "You are a careful academic paper analyst. Read the supplied evidence pack and produce a structured paper overview. Output every field in {}. Use only the provided evidence and metadata. Do not invent claims, numbers, datasets, baselines, or conclusions. If evidence is missing for a field, explicitly say that it is not clearly stated in the provided content, in {}. Return strict JSON only; no markdown, no code fences, no commentary.",
          language,
          language
        )
      },
      {
        "role": "user",
        "content": format!(
          "Create a modular paper overview for a desktop literature reader.\n\nOutput language: {}\n\nRules:\n1. Return exactly one JSON object matching the schema fields: title, abstract, overview, background, researchProblem, approach, experimentSetup, keyFindings, conclusions, limitations, takeaways, keywords.\n2. Keep the field names in English exactly as specified, but write all field values in the output language.\n3. overview: 3-5 sentences covering the paper object, core problem, method or review axis, evidence base, and final conclusion.\n4. abstract: dense faithful compressed summary. If the original abstract is unavailable, state that it is inferred from the provided evidence.\n5. background: 2-4 sentences about domain background, application scenarios, and why the problem matters.\n6. researchProblem: 2-4 sentences describing the concrete problem, constraints, uncertainty, and method gaps.\n7. approach: 3-5 sentences. For a survey/review paper, explain the taxonomy, compared method families, communication or modeling assumptions, and analysis criteria. For an empirical method paper, explain the model/framework, modules, novelty, and relation to baselines.\n8. experimentSetup: 3-6 sentences. If the paper is a review rather than an experimental study, do not fabricate experiments; describe the review evidence base, comparison dimensions, and whether empirical validation is absent or secondary.\n9. keyFindings: 4-8 specific findings. Prefer concrete method categories, trade-offs, application scenarios, strengths, limitations, and evidence patterns.\n10. conclusions: 2-4 sentences about the final contribution and practical/academic value.\n11. limitations: 2-4 evidence-based limitations only.\n12. takeaways: 3-5 useful reading notes for a student or researcher.\n13. keywords: 5-10 concise terms.\n14. Be stable and conservative: if the evidence pack says this is a review/survey, summarize it as a review/survey, not as a newly proposed algorithm.\n\nEvidence pack:\n{}",
          language,
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
    let output_language = options
        .output_language
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Chinese")
        .to_string();
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
      "temperature": 0.1,
      "messages": build_summary_messages(&document_context, &output_language)
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

    match parse_summary_content_resilient(&content, title) {
        Ok(summary) => Ok(summary),
        Err(_) => Ok(build_extractive_fallback_summary(
            title,
            authors.as_deref(),
            year.as_deref(),
            &document_context,
            &output_language,
        )),
    }
}

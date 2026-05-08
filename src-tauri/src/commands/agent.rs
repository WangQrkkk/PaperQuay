use std::time::Duration;

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryAgentPaperInput {
    id: String,
    title: String,
    authors: Vec<String>,
    year: Option<String>,
    publication: Option<String>,
    doi: Option<String>,
    url: Option<String>,
    abstract_text: Option<String>,
    ai_summary: Option<String>,
    user_note: Option<String>,
    context_source: Option<String>,
    context_text: Option<String>,
    keywords: Vec<String>,
    tags: Vec<String>,
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
pub struct LibraryAgentConversationMessage {
    role: String,
    content: String,
    attachments: Option<Vec<DocumentChatAttachment>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAICompatibleLibraryAgentOptions {
    base_url: String,
    api_key: String,
    model: String,
    temperature: Option<f32>,
    reasoning_effort: Option<String>,
    response_language: Option<String>,
    allow_context_request: Option<bool>,
    tool: String,
    instruction: Option<String>,
    messages: Option<Vec<LibraryAgentConversationMessage>>,
    papers: Vec<LibraryAgentPaperInput>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryAgentPaperUpdate {
    title: Option<String>,
    year: Option<String>,
    publication: Option<String>,
    doi: Option<String>,
    url: Option<String>,
    abstract_text: Option<String>,
    keywords: Option<Vec<String>>,
    tags: Option<Vec<String>>,
    authors: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryAgentGeneratedItem {
    paper_id: String,
    title: Option<String>,
    description: Option<String>,
    before: Option<String>,
    after: Option<String>,
    update: Option<LibraryAgentPaperUpdate>,
    target_category_name: Option<String>,
    target_category_parent_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryAgentGeneratedPlan {
    tool: String,
    summary: String,
    items: Vec<LibraryAgentGeneratedItem>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryAgentContextRequest {
    summary: String,
    mode: String,
    paper_ids: Vec<String>,
    reason: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryAgentChoiceOption {
    id: String,
    label: String,
    description: String,
    instruction: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryAgentUserChoiceRequest {
    summary: String,
    reason: String,
    options: Vec<LibraryAgentChoiceOption>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryAgentGeneratedResponse {
    kind: String,
    answer: Option<String>,
    plan: Option<LibraryAgentGeneratedPlan>,
    context_request: Option<LibraryAgentContextRequest>,
    user_choices: Option<LibraryAgentUserChoiceRequest>,
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
    content: Option<Value>,
    refusal: Option<String>,
    tool_calls: Option<Vec<ChatCompletionToolCall>>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionToolCall {
    function: ChatCompletionToolCallFunction,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionToolCallFunction {
    name: String,
    arguments: String,
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
        format!("{}...", truncated)
    } else {
        truncated
    }
}

fn model_temperature(value: Option<f32>, fallback: f32) -> f32 {
    value.unwrap_or(fallback).clamp(0.0, 2.0)
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

fn extract_message_text(content: Option<Value>) -> Option<String> {
    match content? {
        Value::String(text) => Some(text),
        Value::Array(parts) => {
            let text = parts
                .into_iter()
                .filter_map(|part| {
                    part.get("text")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .or_else(|| {
                            part.get("content")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                        })
                })
                .collect::<Vec<_>>()
                .join("\n");

            if text.trim().is_empty() {
                None
            } else {
                Some(text)
            }
        }
        other => Some(other.to_string()),
    }
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
            "附件《{}》摘要：{}；MIME={}；大小约 {} 字节。",
            attachment.name, summary, attachment.mime_type, attachment.size
        )
    })
}

fn build_user_message_content(message: &LibraryAgentConversationMessage) -> Value {
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

fn build_agent_prompt(
    tool: &str,
    instruction: Option<&str>,
    papers_json: &str,
    allow_context_request: bool,
    response_language: &str,
) -> String {
    let tool_mode = if tool == "auto" {
        if allow_context_request {
            "Auto decide whether the request needs a library-editing tool, more paper context, or only a direct answer. If it needs a local library change, select the single best editing function tool. If it is a reading-assistant request and the current metadata is insufficient, call request_paper_context first. If the provided metadata or contextText is enough, answer directly."
        } else {
            "Auto decide whether the request needs a library-editing tool or only a direct answer. The app has already loaded any requested reading context, so answer directly when this is ordinary Q&A."
        }
    } else {
        "A preferred tool is provided. Use that function unless the user instruction clearly requires a safer matching tool."
    };
    let response_rule = if tool == "auto" {
        if allow_context_request {
            "Use editing tools only when the user asks to change, organize, rename, tag, classify, or update library records. For ordinary Q&A, answer directly in the configured response language when the provided fields are enough. If the user asks to explain, compare, summarize, or analyze papers and metadata is not enough, call request_paper_context instead of guessing."
        } else {
            "Use editing tools only when the user asks to change, organize, rename, tag, classify, or update library records. For ordinary Q&A, answer directly in the configured response language using the provided contextText, aiSummary, abstract, and metadata."
        }
    } else {
        "Use tool/function calling. Do not answer with plain text unless tool calling is unavailable."
    };
    let context_tool_line = if allow_context_request {
        "- request_paper_context: ask the desktop app to load local paper context before answering. Use mode \"pdf-text\" by default so the app sends full extracted PDF text. Use mode \"summary\" only when the user asks for a lightweight answer, when many papers may exceed the model context, or after presenting summary-only as a user option.\n"
    } else {
        ""
    };
    let context_rules = if allow_context_request {
        "11. Do not call request_paper_context when contextText is already present for the papers you need, unless all loaded contextText values are empty."
    } else {
        "11. request_paper_context is unavailable in this pass because the app has already loaded the requested context. Answer with the available context instead of asking for it again."
    };

    let insufficient_context_rule = if allow_context_request {
        "13. Do not output a metadata-only disclaimer as the final answer. If you cannot safely answer because the current context is insufficient, either call request_paper_context with mode=\"pdf-text\" when one clear full-text context source is appropriate, or call present_user_options with 2 to 5 dynamic choices. If many papers are selected or full PDF text may exceed the model context, prefer present_user_options before loading context. The choices must fit the user's request and can include actions such as metadata completion, loading full PDF text, using summaries only, narrowing the selected papers, or answering roughly from metadata. Do not use a fixed option list."
    } else {
        "13. If the loaded context is still empty or insufficient, call present_user_options with 2 to 5 dynamic next-step choices. Do not use a fixed option list; tailor the choices to the current papers and user request."
    };

    format!(
        r#"Task mode: {tool_mode}
Preferred tool: {tool}
Response language: {response_language}
User instruction: {instruction}

You are the PaperQuay literature-library agent. Decide whether this request needs a local library action or only a direct answer.

Available tools:
{context_tool_line}
- present_user_options: ask the user to choose the next step when multiple safe paths are possible. Generate 2 to 5 dynamic options, each with a label, description, and executable instruction for the app to run if clicked.
- rename_papers: add, remove, replace, normalize, or rewrite paper titles.
- update_paper_metadata: fill or correct title, authors, year, venue, DOI, URL, abstract, or keywords when supported by the provided context.
- update_paper_tags: add concise academic tags to selected papers.
- clean_paper_tags: merge duplicate, synonymous, misspelled, or inconsistent tags.
- classify_papers: create dynamic Collections and assign selected papers to them.

Rules:
1. {response_rule}
2. Do not claim that local library edits were executed. Editing tools only propose reviewable arguments; the app applies them after user approval. request_paper_context only asks the app to load local reading context.
3. Use the exact paper ids from the input.
4. For rename, call rename_papers and set newTitle according to the user instruction.
5. For metadata, call update_paper_metadata and only fill fields strongly supported by the input. Do not invent DOI, year, publication, or authors.
6. For smart-tags, call update_paper_tags and propose concise normalized tags. Prefer 3 to 8 tags per paper.
7. For clean-tags, call clean_paper_tags and merge synonyms, case variants, punctuation variants, and duplicates.
8. For classify, call classify_papers. Create dynamic Collection names from the selected papers. Do not use a fixed taxonomy. Collection names should be short topic phrases.
9. Keep titles and tags readable for an academic literature manager.
10. Paper fields may include aiSummary, userNote, contextSource, and contextText. If contextText is present, use it as the primary evidence for direct reading answers.
{context_rules}
12. For direct answers, write clean Markdown in the configured response language with headings, bullets, and comparison tables when useful. State briefly if your answer is based only on metadata/summary rather than full PDF text.
{insufficient_context_rule}

Input papers:
{papers_json}
"#,
        tool_mode = tool_mode,
        tool = tool,
        response_language = response_language,
        response_rule = response_rule,
        context_tool_line = context_tool_line,
        context_rules = context_rules,
        insufficient_context_rule = insufficient_context_rule,
        instruction = instruction.unwrap_or(""),
        papers_json = papers_json
    )
}

fn build_agent_tools(include_context_request: bool) -> Value {
    let tools = json!([
      {
        "type": "function",
        "function": {
          "name": "request_paper_context",
          "description": "Ask the desktop app to load more local paper context before answering. Use this for reading, explaining, comparing, or analyzing selected papers when metadata alone is not enough. Prefer mode='pdf-text' by default so the app sends full extracted PDF text. Use mode='summary' only for lightweight answers, many selected papers, or when the user chooses summary-only context.",
          "parameters": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "summary": { "type": "string" },
              "mode": {
                "type": "string",
                "enum": ["summary", "pdf-text"]
              },
              "paperIds": {
                "type": "array",
                "items": { "type": "string" }
              },
              "reason": { "type": "string" }
            },
            "required": ["summary", "mode", "paperIds", "reason"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "present_user_options",
          "description": "Present dynamic next-step options to the user when the agent cannot safely choose one path. Use this instead of a metadata-only disclaimer. Options must be tailored to the current request and selected papers.",
          "parameters": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "summary": { "type": "string" },
              "reason": { "type": "string" },
              "options": {
                "type": "array",
                "minItems": 2,
                "maxItems": 5,
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "id": { "type": "string" },
                    "label": { "type": "string" },
                    "description": { "type": "string" },
                    "instruction": { "type": "string" }
                  },
                  "required": ["id", "label", "description", "instruction"]
                }
              }
            },
            "required": ["summary", "reason", "options"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "rename_papers",
          "description": "Propose paper title renames. Use this when the user asks to add, remove, replace, normalize, or rewrite paper names.",
          "parameters": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "summary": { "type": "string" },
              "items": {
                "type": "array",
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "paperId": { "type": "string" },
                    "newTitle": { "type": "string" },
                    "reason": { "type": "string" }
                  },
                  "required": ["paperId", "newTitle", "reason"]
                }
              }
            },
            "required": ["summary", "items"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "update_paper_metadata",
          "description": "Propose metadata updates for selected papers. Only include fields that are supported by the provided context.",
          "parameters": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "summary": { "type": "string" },
              "items": {
                "type": "array",
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "paperId": { "type": "string" },
                    "title": { "type": "string" },
                    "authors": { "type": "array", "items": { "type": "string" } },
                    "year": { "type": "string" },
                    "publication": { "type": "string" },
                    "doi": { "type": "string" },
                    "url": { "type": "string" },
                    "abstractText": { "type": "string" },
                    "keywords": { "type": "array", "items": { "type": "string" } },
                    "reason": { "type": "string" }
                  },
                  "required": ["paperId", "reason"]
                }
              }
            },
            "required": ["summary", "items"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "update_paper_tags",
          "description": "Propose normalized smart tags for selected papers.",
          "parameters": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "summary": { "type": "string" },
              "items": {
                "type": "array",
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "paperId": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "reason": { "type": "string" }
                  },
                  "required": ["paperId", "tags", "reason"]
                }
              }
            },
            "required": ["summary", "items"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "clean_paper_tags",
          "description": "Propose tag cleanup and synonym merging for selected papers.",
          "parameters": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "summary": { "type": "string" },
              "items": {
                "type": "array",
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "paperId": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "reason": { "type": "string" }
                  },
                  "required": ["paperId", "tags", "reason"]
                }
              }
            },
            "required": ["summary", "items"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "classify_papers",
          "description": "Propose dynamic collections for selected papers. Do not use a fixed taxonomy; infer collection names from the papers.",
          "parameters": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "summary": { "type": "string" },
              "items": {
                "type": "array",
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "paperId": { "type": "string" },
                    "parentCollection": { "type": "string" },
                    "collection": { "type": "string" },
                    "reason": { "type": "string" }
                  },
                  "required": ["paperId", "parentCollection", "collection", "reason"]
                }
              }
            },
            "required": ["summary", "items"]
          }
        }
      }
    ]);

    if include_context_request {
        return tools;
    }

    Value::Array(
        tools
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter(|tool| {
                        tool.get("function")
                            .and_then(|function| function.get("name"))
                            .and_then(Value::as_str)
                            != Some("request_paper_context")
                    })
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
    )
}

fn preferred_tool_name(tool: &str) -> Option<&'static str> {
    match tool {
        "rename" => Some("rename_papers"),
        "metadata" => Some("update_paper_metadata"),
        "smart-tags" => Some("update_paper_tags"),
        "clean-tags" => Some("clean_paper_tags"),
        "classify" => Some("classify_papers"),
        _ => None,
    }
}

fn tool_key_from_function_name(function_name: &str) -> Option<&'static str> {
    match function_name {
        "rename_papers" => Some("rename"),
        "update_paper_metadata" => Some("metadata"),
        "update_paper_tags" => Some("smart-tags"),
        "clean_paper_tags" => Some("clean-tags"),
        "classify_papers" => Some("classify"),
        _ => None,
    }
}

fn json_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn json_string_array(value: &Value, key: &str) -> Option<Vec<String>> {
    let items = value.get(key)?.as_array()?;
    let output = items
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();

    if output.is_empty() {
        None
    } else {
        Some(output)
    }
}

fn repair_unescaped_quotes_in_json(input: &str) -> String {
    let characters = input.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(input.len() + 16);
    let mut index = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    while index < characters.len() {
        let character = characters[index];

        if !in_string {
            if character == '"' {
                in_string = true;
            }

            output.push(character);
            index += 1;
            continue;
        }

        if escaped {
            output.push(character);
            escaped = false;
            index += 1;
            continue;
        }

        if character == '\\' {
            output.push(character);
            escaped = true;
            index += 1;
            continue;
        }

        if character == '"' {
            let next_non_whitespace = characters
                .iter()
                .skip(index + 1)
                .find(|next| !next.is_whitespace())
                .copied();

            let looks_like_closing_quote = matches!(
                next_non_whitespace,
                None | Some(',') | Some('}') | Some(']') | Some(':')
            );

            if looks_like_closing_quote {
                in_string = false;
                output.push(character);
            } else {
                output.push('\\');
                output.push(character);
            }

            index += 1;
            continue;
        }

        output.push(character);
        index += 1;
    }

    output
}

fn parse_tool_call_arguments_value(
    function_name: &str,
    arguments: &str,
) -> Result<Value, String> {
    match serde_json::from_str::<Value>(arguments) {
        Ok(value) => Ok(value),
        Err(primary_error) => {
            let repaired = repair_unescaped_quotes_in_json(arguments);

            serde_json::from_str::<Value>(&repaired).map_err(|secondary_error| {
                format!(
                    "Failed to parse Agent tool call arguments: {}; repaired parse also failed: {}; function: {}; arguments: {}",
                    primary_error, secondary_error, function_name, arguments
                )
            })
        }
    }
}

fn parse_context_request_tool_call(
    tool_call: &ChatCompletionToolCall,
) -> Result<LibraryAgentContextRequest, String> {
    let arguments = parse_tool_call_arguments_value(
        &tool_call.function.name,
        &tool_call.function.arguments,
    )
    .map_err(|error| format!("Failed to parse Agent context tool arguments: {}", error))?;
    let mut mode = json_string(&arguments, "mode").unwrap_or_else(|| "summary".to_string());

    if mode != "summary" && mode != "pdf-text" {
        mode = "summary".to_string();
    }

    Ok(LibraryAgentContextRequest {
        summary: json_string(&arguments, "summary")
            .unwrap_or_else(|| "Load more paper context before answering.".to_string()),
        mode,
        paper_ids: json_string_array(&arguments, "paperIds").unwrap_or_default(),
        reason: json_string(&arguments, "reason")
            .unwrap_or_else(|| "The question needs more paper context.".to_string()),
    })
}

fn parse_user_choice_tool_call(
    tool_call: &ChatCompletionToolCall,
) -> Result<LibraryAgentUserChoiceRequest, String> {
    let arguments = parse_tool_call_arguments_value(
        &tool_call.function.name,
        &tool_call.function.arguments,
    )
    .map_err(|error| format!("Failed to parse Agent user-choice tool arguments: {}", error))?;
    let raw_options = arguments
        .get("options")
        .and_then(Value::as_array)
        .ok_or_else(|| "Agent user-choice tool call is missing the options array".to_string())?;
    let options = raw_options
        .iter()
        .filter_map(|raw_option| {
            let label = json_string(raw_option, "label")?;
            let instruction = json_string(raw_option, "instruction")?;
            let id = json_string(raw_option, "id").unwrap_or_else(|| {
                label
                    .chars()
                    .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
                    .collect::<String>()
            });

            Some(LibraryAgentChoiceOption {
                id: if id.is_empty() {
                    format!("option-{}", label.len())
                } else {
                    id
                },
                label,
                description: json_string(raw_option, "description").unwrap_or_default(),
                instruction,
            })
        })
        .take(5)
        .collect::<Vec<_>>();

    if options.is_empty() {
        return Err("Agent user options contain no executable option.".to_string());
    }

    Ok(LibraryAgentUserChoiceRequest {
        summary: json_string(&arguments, "summary")
            .unwrap_or_else(|| "Choose the next step.".to_string()),
        reason: json_string(&arguments, "reason")
            .unwrap_or_else(|| "The request has multiple safe paths.".to_string()),
        options,
    })
}

fn parse_tool_call_plan(
    tool_call: &ChatCompletionToolCall,
    fallback_summary: &str,
) -> Result<LibraryAgentGeneratedPlan, String> {
    let function_name = tool_call.function.name.trim();
    let tool = tool_key_from_function_name(function_name)
        .ok_or_else(|| format!("Agent returned an unknown tool call: {}", function_name))?
        .to_string();
    let arguments = parse_tool_call_arguments_value(function_name, &tool_call.function.arguments)?;
    let summary =
        json_string(&arguments, "summary").unwrap_or_else(|| fallback_summary.to_string());
    let raw_items = arguments
        .get("items")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            format!(
                "Agent tool call is missing the items array: {}",
                function_name
            )
        })?;
    let mut items = Vec::new();

    for raw_item in raw_items {
        let Some(paper_id) = json_string(raw_item, "paperId") else {
            continue;
        };
        let reason =
            json_string(raw_item, "reason").unwrap_or_else(|| "Model suggestion".to_string());

        match function_name {
            "rename_papers" => {
                if let Some(new_title) = json_string(raw_item, "newTitle") {
                    items.push(LibraryAgentGeneratedItem {
                        paper_id,
                        title: Some("Rename paper title".to_string()),
                        description: Some(reason),
                        before: None,
                        after: Some(new_title.clone()),
                        update: Some(LibraryAgentPaperUpdate {
                            title: Some(new_title),
                            year: None,
                            publication: None,
                            doi: None,
                            url: None,
                            abstract_text: None,
                            keywords: None,
                            tags: None,
                            authors: None,
                        }),
                        target_category_name: None,
                        target_category_parent_name: None,
                    });
                }
            }
            "update_paper_metadata" => {
                items.push(LibraryAgentGeneratedItem {
                    paper_id,
                    title: Some("Update paper metadata".to_string()),
                    description: Some(reason),
                    before: None,
                    after: None,
                    update: Some(LibraryAgentPaperUpdate {
                        title: json_string(raw_item, "title"),
                        year: json_string(raw_item, "year"),
                        publication: json_string(raw_item, "publication"),
                        doi: json_string(raw_item, "doi"),
                        url: json_string(raw_item, "url"),
                        abstract_text: json_string(raw_item, "abstractText"),
                        keywords: json_string_array(raw_item, "keywords"),
                        tags: None,
                        authors: json_string_array(raw_item, "authors"),
                    }),
                    target_category_name: None,
                    target_category_parent_name: None,
                });
            }
            "update_paper_tags" | "clean_paper_tags" => {
                if let Some(tags) = json_string_array(raw_item, "tags") {
                    items.push(LibraryAgentGeneratedItem {
                        paper_id,
                        title: Some(if function_name == "clean_paper_tags" {
                            "Clean and merge tags".to_string()
                        } else {
                            "Smart tag suggestions".to_string()
                        }),
                        description: Some(reason),
                        before: None,
                        after: Some(tags.join(", ")),
                        update: Some(LibraryAgentPaperUpdate {
                            title: None,
                            year: None,
                            publication: None,
                            doi: None,
                            url: None,
                            abstract_text: None,
                            keywords: None,
                            tags: Some(tags),
                            authors: None,
                        }),
                        target_category_name: None,
                        target_category_parent_name: None,
                    });
                }
            }
            "classify_papers" => {
                if let Some(collection) = json_string(raw_item, "collection") {
                    let parent = json_string(raw_item, "parentCollection")
                        .unwrap_or_else(|| "Agent Auto Collection".to_string());
                    items.push(LibraryAgentGeneratedItem {
                        paper_id,
                        title: Some("Auto classify collection".to_string()),
                        description: Some(reason),
                        before: None,
                        after: Some(format!("{}/{}", parent, collection)),
                        update: None,
                        target_category_name: Some(collection),
                        target_category_parent_name: Some(parent),
                    });
                }
            }
            _ => {}
        }
    }

    Ok(LibraryAgentGeneratedPlan {
        tool,
        summary,
        items,
    })
}

#[tauri::command]
pub async fn generate_library_agent_plan_openai_compatible(
    options: OpenAICompatibleLibraryAgentOptions,
) -> Result<LibraryAgentGeneratedResponse, String> {
    let base_url = options.base_url.trim();
    let api_key = options.api_key.trim();
    let model = options.model.trim();
    let tool = options.tool.trim();

    if base_url.is_empty() {
        return Err("Agent model Base URL cannot be empty".to_string());
    }

    if api_key.is_empty() {
        return Err("Agent model API key cannot be empty".to_string());
    }

    if model.is_empty() {
        return Err("Agent model name cannot be empty".to_string());
    }

    if tool.is_empty() {
        return Err("Agent tool type cannot be empty".to_string());
    }

    if options.papers.is_empty() {
        return Err("Select at least one paper first.".to_string());
    }

    let endpoint = build_chat_completions_url(base_url);
    let papers_json = serde_json::to_string(&options.papers)
        .map_err(|error| format!("Failed to serialize paper context: {}", error))?;
    let allow_context_request = options.allow_context_request.unwrap_or(tool == "auto");
    let response_language = options
        .response_language
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Simplified Chinese");
    let prompt = build_agent_prompt(
        tool,
        options.instruction.as_deref(),
        &papers_json,
        allow_context_request,
        response_language,
    );
    let forced_tool_name = if tool == "auto" {
        None
    } else {
        Some(
            preferred_tool_name(tool)
                .ok_or_else(|| format!("Unsupported Agent tool type: {}", tool))?,
        )
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("Failed to create Agent HTTP client: {}", error))?;
    let tool_choice = match forced_tool_name {
        Some(tool_name) => json!({
            "type": "function",
            "function": {
                "name": tool_name
            }
        }),
        None => json!("auto"),
    };
    let system_content = if allow_context_request {
        format!("You are a precise literature-library agent for a desktop literature manager. Use editing function tools only for reviewable local library actions. Use request_paper_context when a reading answer needs local summaries or PDF text that is not yet present. For ordinary questions with enough context, answer directly in {}. Never claim that local edits were executed.", response_language)
    } else {
        format!("You are a precise literature-library agent for a desktop literature manager. The app has already loaded the available reading context for this request. Do not ask for more context; answer directly in {} for ordinary Q&A, or use editing tools only for reviewable local library actions. Never claim that local edits were executed.", response_language)
    };
    let mut payload_messages = vec![
        json!({
          "role": "system",
          "content": system_content
        }),
        json!({
          "role": "user",
          "content": prompt
        }),
    ];

    for message in options.messages.unwrap_or_default() {
        let role = if message.role.trim() == "assistant" {
            "assistant"
        } else {
            "user"
        };

        if role == "assistant" {
            if !message.content.trim().is_empty() {
                payload_messages.push(json!({
                  "role": role,
                  "content": message.content
                }));
            }
        } else if !message.content.trim().is_empty()
            || message
                .attachments
                .as_ref()
                .map(|attachments| !attachments.is_empty())
                .unwrap_or(false)
        {
            payload_messages.push(json!({
              "role": role,
              "content": build_user_message_content(&message)
            }));
        }
    }

    let mut body = json!({
      "model": model,
      "temperature": model_temperature(options.temperature, 0.1),
      "tools": build_agent_tools(allow_context_request),
      "tool_choice": tool_choice,
      "messages": payload_messages
    });
    apply_reasoning_effort(&mut body, options.reasoning_effort.as_deref());

    let response = client
        .post(endpoint)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Failed to request Agent model: {}", error))?;
    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|error| format!("Failed to read Agent model response: {}", error))?;

    if !status.is_success() {
        return Err(format!(
            "Agent model HTTP status error {}: {}",
            status,
            truncate_for_display(response_text.trim(), 700)
        ));
    }

    let completion =
        serde_json::from_str::<ChatCompletionResponse>(&response_text).map_err(|error| {
            format!(
                "Failed to parse Agent chat/completions response: {}; raw response: {}",
                error,
                truncate_for_display(response_text.trim(), 700)
            )
        })?;
    let message = completion
        .choices
        .first()
        .map(|choice| &choice.message)
        .ok_or_else(|| "Agent response is missing choices[0]".to_string())?;

    if let Some(refusal) = message.refusal.as_deref() {
        return Err(format!("Agent model refused the request: {}", refusal));
    }

    let tool_calls = message
        .tool_calls
        .as_ref()
        .filter(|items| !items.is_empty());

    if tool_calls.is_none() {
        let content = extract_message_text(message.content.clone()).unwrap_or_default();
        let answer = content.trim();

        if tool == "auto" && !answer.is_empty() {
            return Ok(LibraryAgentGeneratedResponse {
                kind: "answer".to_string(),
                answer: Some(answer.to_string()),
                plan: None,
                context_request: None,
                user_choices: None,
            });
        }

        return Err(format!(
            "Agent model did not return a tool call. Make sure the configured model supports OpenAI-compatible tools/function calling. Model text response: {}",
            truncate_for_display(answer, 700)
        ));
    }

    let tool_calls = tool_calls.unwrap();
    let selected_tool_call = if let Some(tool_name) = forced_tool_name {
        tool_calls
            .iter()
            .find(|tool_call| tool_call.function.name == tool_name)
            .unwrap_or(&tool_calls[0])
    } else {
        &tool_calls[0]
    };

    if selected_tool_call.function.name == "request_paper_context" {
        if tool != "auto" {
            return Err("This tool mode cannot request paper context.".to_string());
        }

        let context_request = parse_context_request_tool_call(selected_tool_call)?;

        return Ok(LibraryAgentGeneratedResponse {
            kind: "context-request".to_string(),
            answer: None,
            plan: None,
            context_request: Some(context_request),
            user_choices: None,
        });
    }

    if selected_tool_call.function.name == "present_user_options" {
        if tool != "auto" {
            return Err("This tool mode cannot request user choices.".to_string());
        }

        let user_choices = parse_user_choice_tool_call(selected_tool_call)?;

        return Ok(LibraryAgentGeneratedResponse {
            kind: "choice-request".to_string(),
            answer: None,
            plan: None,
            context_request: None,
            user_choices: Some(user_choices),
        });
    }

    let plan = parse_tool_call_plan(
        selected_tool_call,
        &format!(
            "Model called tool {} and generated a reviewable library plan",
            selected_tool_call.function.name
        ),
    )?;

    Ok(LibraryAgentGeneratedResponse {
        kind: "plan".to_string(),
        answer: None,
        plan: Some(plan),
        context_request: None,
        user_choices: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn can_disable_context_request_tool_after_context_is_loaded() {
        let tools = build_agent_tools(false);
        let tool_names = tools
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|tool| tool.get("function")?.get("name")?.as_str())
            .collect::<Vec<_>>();

        assert!(!tool_names.contains(&"request_paper_context"));
        assert!(tool_names.contains(&"rename_papers"));
    }

    #[test]
    fn prompt_allows_model_generated_dynamic_user_options() {
        let prompt =
            build_agent_prompt("auto", Some("explain these papers"), "[]", true, "English");

        assert!(prompt.contains("present_user_options"));
        assert!(prompt.contains("Do not use a fixed option list"));
        assert!(prompt.contains("Response language: English"));
        assert!(prompt.contains("mode \"pdf-text\" by default"));
    }
}

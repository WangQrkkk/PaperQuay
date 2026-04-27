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
    keywords: Vec<String>,
    tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAICompatibleLibraryAgentOptions {
    base_url: String,
    api_key: String,
    model: String,
    tool: String,
    instruction: Option<String>,
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

fn build_agent_prompt(tool: &str, instruction: Option<&str>, papers_json: &str) -> String {
    let tool_mode = if tool == "auto" {
        "Auto select the single best function tool from the available tools."
    } else {
        "A preferred tool is provided. Use that function unless the user instruction clearly requires a safer matching tool."
    };

    format!(
        r#"Task mode: {tool_mode}
Preferred tool: {tool}
User instruction: {instruction}

You are the PaperQuay literature-library agent. Select and call exactly one provided function tool.

Available tools:
- rename_papers: add, remove, replace, normalize, or rewrite paper titles.
- update_paper_metadata: fill or correct title, authors, year, venue, DOI, URL, abstract, or keywords when supported by the provided context.
- update_paper_tags: add concise academic tags to selected papers.
- clean_paper_tags: merge duplicate, synonymous, misspelled, or inconsistent tags.
- classify_papers: create dynamic Collections and assign selected papers to them.

Rules:
1. Use tool/function calling. Do not answer with plain text unless tool calling is unavailable.
2. Do not execute anything. You only propose tool arguments. The app will show your tool call to the user for approval.
3. Use the exact paper ids from the input.
4. For rename, call rename_papers and set newTitle according to the user instruction.
5. For metadata, call update_paper_metadata and only fill fields strongly supported by the input. Do not invent DOI, year, publication, or authors.
6. For smart-tags, call update_paper_tags and propose concise normalized tags. Prefer 3 to 8 tags per paper.
7. For clean-tags, call clean_paper_tags and merge synonyms, case variants, punctuation variants, and duplicates.
8. For classify, call classify_papers. Create dynamic Collection names from the selected papers. Do not use a fixed taxonomy. Collection names should be short topic phrases.
9. Keep titles and tags readable for an academic literature manager.

Input papers:
{papers_json}
"#,
        tool_mode = tool_mode,
        tool = tool,
        instruction = instruction.unwrap_or(""),
        papers_json = papers_json
    )
}

fn build_agent_tools() -> Value {
    json!([
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
    ])
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

fn parse_tool_call_plan(
    tool_call: &ChatCompletionToolCall,
    fallback_summary: &str,
) -> Result<LibraryAgentGeneratedPlan, String> {
    let function_name = tool_call.function.name.trim();
    let tool = tool_key_from_function_name(function_name)
        .ok_or_else(|| format!("Agent 返回了未知工具调用: {}", function_name))?
        .to_string();
    let arguments =
        serde_json::from_str::<Value>(&tool_call.function.arguments).map_err(|error| {
            format!(
                "解析 Agent tool call 参数失败: {}；函数: {}；参数: {}",
                error, function_name, tool_call.function.arguments
            )
        })?;
    let summary =
        json_string(&arguments, "summary").unwrap_or_else(|| fallback_summary.to_string());
    let raw_items = arguments
        .get("items")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("Agent tool call 缺少 items 数组: {}", function_name))?;
    let mut items = Vec::new();

    for raw_item in raw_items {
        let Some(paper_id) = json_string(raw_item, "paperId") else {
            continue;
        };
        let reason = json_string(raw_item, "reason").unwrap_or_else(|| "模型建议".to_string());

        match function_name {
            "rename_papers" => {
                if let Some(new_title) = json_string(raw_item, "newTitle") {
                    items.push(LibraryAgentGeneratedItem {
                        paper_id,
                        title: Some("重命名论文标题".to_string()),
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
                    title: Some("补全文献元数据".to_string()),
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
                            "标签清洗 / 合并".to_string()
                        } else {
                            "智能标签建议".to_string()
                        }),
                        description: Some(reason),
                        before: None,
                        after: Some(tags.join("、")),
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
                        .unwrap_or_else(|| "Agent 自动归类".to_string());
                    items.push(LibraryAgentGeneratedItem {
                        paper_id,
                        title: Some("自动归类 Collection".to_string()),
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
) -> Result<LibraryAgentGeneratedPlan, String> {
    let base_url = options.base_url.trim();
    let api_key = options.api_key.trim();
    let model = options.model.trim();
    let tool = options.tool.trim();

    if base_url.is_empty() {
        return Err("Agent 模型 Base URL 不能为空".to_string());
    }

    if api_key.is_empty() {
        return Err("Agent 模型 API Key 不能为空".to_string());
    }

    if model.is_empty() {
        return Err("Agent 模型名称不能为空".to_string());
    }

    if tool.is_empty() {
        return Err("Agent 工具类型不能为空".to_string());
    }

    if options.papers.is_empty() {
        return Err("请先选择至少一篇文献".to_string());
    }

    let endpoint = build_chat_completions_url(base_url);
    let papers_json = serde_json::to_string(&options.papers)
        .map_err(|error| format!("序列化文献上下文失败: {}", error))?;
    let prompt = build_agent_prompt(tool, options.instruction.as_deref(), &papers_json);
    let forced_tool_name = if tool == "auto" {
        None
    } else {
        Some(preferred_tool_name(tool).ok_or_else(|| format!("Agent 工具类型不支持: {}", tool))?)
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("创建 Agent HTTP 客户端失败: {}", error))?;
    let tool_choice = match forced_tool_name {
        Some(tool_name) => json!({
            "type": "function",
            "function": {
                "name": tool_name
            }
        }),
        None => json!("auto"),
    };
    let body = json!({
      "model": model,
      "temperature": 0.1,
      "tools": build_agent_tools(),
      "tool_choice": tool_choice,
      "messages": [
        {
          "role": "system",
          "content": "You are a precise tool-use agent for a desktop literature manager. Use the provided function tools to produce reviewable actions. Never claim that actions were executed."
        },
        {
          "role": "user",
          "content": prompt
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
        .map_err(|error| format!("请求 Agent 模型失败: {}", error))?;
    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|error| format!("读取 Agent 模型响应失败: {}", error))?;

    if !status.is_success() {
        return Err(format!(
            "Agent 模型 HTTP 状态异常: {}，{}",
            status,
            truncate_for_display(response_text.trim(), 700)
        ));
    }

    let completion =
        serde_json::from_str::<ChatCompletionResponse>(&response_text).map_err(|error| {
            format!(
                "解析 Agent chat/completions 响应失败: {}；原始响应: {}",
                error,
                truncate_for_display(response_text.trim(), 700)
            )
        })?;
    let message = completion
        .choices
        .first()
        .map(|choice| &choice.message)
        .ok_or_else(|| "Agent 响应缺少 choices[0]".to_string())?;

    if let Some(refusal) = message.refusal.as_deref() {
        return Err(format!("Agent 模型拒绝执行: {}", refusal));
    }

    let tool_calls = message
        .tool_calls
        .as_ref()
        .filter(|items| !items.is_empty())
        .ok_or_else(|| {
            let content = extract_message_text(message.content.clone()).unwrap_or_default();
            format!(
                "Agent 模型没有返回 tool call。请确认当前模型支持 OpenAI-compatible tools/function calling。模型文本响应: {}",
                truncate_for_display(content.trim(), 700)
            )
        })?;
    let selected_tool_call = if let Some(tool_name) = forced_tool_name {
        tool_calls
            .iter()
            .find(|tool_call| tool_call.function.name == tool_name)
            .unwrap_or(&tool_calls[0])
    } else {
        &tool_calls[0]
    };

    parse_tool_call_plan(
        selected_tool_call,
        &format!(
            "模型调用工具 {} 生成了文库整理计划",
            selected_tool_call.function.name
        ),
    )
}

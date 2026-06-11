const {
  AGENT_STREAM_EVENT,
  QA_STREAM_EVENT,
  completionEndpoint,
  embedTexts,
  listOpenAiModels,
  mergeOpenAiStreamChunks,
  openAiChat,
  parseJsonObject,
  pickChatThinking,
  pickChatText,
  pickStreamThinkingDelta,
  pickToolCalls,
  pickStreamTextDelta,
  readOpenAiStreamResponse,
} = require('./utils.cjs');

const TEST_MODEL_TIMEOUT_MS = 20_000;

const REQUEST_PAPER_CONTEXT_TOOL_NAME = 'request_paper_context';
const PAPER_SKILL_DECISION_TOOL_NAME = 'paper_skill_decision';

const REQUEST_PAPER_CONTEXT_TOOL = {
  type: 'function',
  function: {
    name: REQUEST_PAPER_CONTEXT_TOOL_NAME,
    description: 'Request summary or full-document context for specific papers already present in the PaperQuay payload. In pdf-text mode, PaperQuay loads cached MinerU markdown/JSON first when available, then falls back to PDF text extraction.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        summary: {
          type: 'string',
          description: 'Short user-facing summary of why paper context is needed.',
        },
        mode: {
          type: 'string',
          enum: ['summary', 'pdf-text'],
          description: 'Use summary for lightweight context, pdf-text when the answer requires detailed content.',
        },
        reason: {
          type: 'string',
          description: 'Concrete reason why paper context is needed for this turn.',
        },
        paperIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Paper IDs selected from the provided papers array.',
        },
      },
      required: ['summary', 'mode', 'reason', 'paperIds'],
    },
  },
};

const PAPER_SKILL_DECISION_TOOL = {
  type: 'function',
  function: {
    name: PAPER_SKILL_DECISION_TOOL_NAME,
    description: 'Decide how PaperQuay should handle paper context before the main Agent answer.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['load-context', 'continue-without-context', 'ask-user-to-select-papers'],
          description: 'Use load-context when full paper content is needed before answering.',
        },
        summary: {
          type: 'string',
          description: 'Short user-facing summary of the paper-context decision. Do not mention internal tool names.',
        },
        reason: {
          type: 'string',
          description: 'Concrete reason for this decision.',
        },
        mode: {
          type: 'string',
          enum: ['summary', 'pdf-text'],
          description: 'Use pdf-text for full paper content, summary for lightweight context.',
        },
        paperIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Paper IDs selected from the provided papers array.',
        },
      },
      required: ['action', 'summary', 'reason', 'mode', 'paperIds'],
    },
  },
};

function uniqueKnownPaperIds(ids, knownPaperIds) {
  const result = [];
  const seen = new Set();

  for (const rawId of Array.isArray(ids) ? ids : []) {
    const id = typeof rawId === 'string' ? rawId.trim() : '';

    if (!id || seen.has(id) || !knownPaperIds.has(id)) {
      continue;
    }

    seen.add(id);
    result.push(id);
  }

  return result;
}

function contextRequestFromToolCall(toolCall, options) {
  if (!toolCall || toolCall.name !== REQUEST_PAPER_CONTEXT_TOOL_NAME) {
    return null;
  }

  const args = toolCall.arguments && typeof toolCall.arguments === 'object' ? toolCall.arguments : {};
  const knownPaperIds = new Set((Array.isArray(options.papers) ? options.papers : [])
    .map((paper) => (typeof paper?.id === 'string' ? paper.id.trim() : ''))
    .filter(Boolean));
  const requestedPaperIds = uniqueKnownPaperIds(args.paperIds, knownPaperIds);
  const currentPaperIds = uniqueKnownPaperIds(options.currentPaperScopeIds, knownPaperIds);
  const paperIds = requestedPaperIds.length > 0 ? requestedPaperIds : currentPaperIds;

  return {
    kind: 'context-request',
    contextRequest: {
      summary: typeof args.summary === 'string' && args.summary.trim()
        ? args.summary.trim()
        : 'Load paper context for the selected papers.',
      mode: args.mode === 'pdf-text' ? 'pdf-text' : 'summary',
      reason: typeof args.reason === 'string' && args.reason.trim()
        ? args.reason.trim()
        : 'The model requested paper context before answering.',
      paperIds,
    },
  };
}

function contextRequestFromCurrentScope(options) {
  if (options.allowContextRequest === false) {
    return null;
  }

  const knownPaperIds = new Set((Array.isArray(options.papers) ? options.papers : [])
    .map((paper) => (typeof paper?.id === 'string' ? paper.id.trim() : ''))
    .filter(Boolean));
  const paperIds = uniqueKnownPaperIds(options.currentPaperScopeIds, knownPaperIds);

  if (paperIds.length === 0) {
    return null;
  }

  return {
    kind: 'context-request',
    contextRequest: {
      summary: 'Load context for the papers selected in this turn.',
      mode: 'summary',
      reason: 'The model returned an empty message while papers were already selected, so PaperQuay will load the selected paper context and retry the answer.',
      paperIds,
    },
  };
}

function paperSkillDecisionFromToolCall(toolCall, options) {
  if (!toolCall || toolCall.name !== PAPER_SKILL_DECISION_TOOL_NAME) {
    return null;
  }

  const args = toolCall.arguments && typeof toolCall.arguments === 'object' ? toolCall.arguments : {};
  const knownPaperIds = new Set((Array.isArray(options.papers) ? options.papers : [])
    .map((paper) => (typeof paper?.id === 'string' ? paper.id.trim() : ''))
    .filter(Boolean));
  const paperIds = uniqueKnownPaperIds(args.paperIds, knownPaperIds);
  const action = args.action === 'load-context' ||
    args.action === 'ask-user-to-select-papers' ||
    args.action === 'continue-without-context'
    ? args.action
    : 'continue-without-context';

  return {
    kind: 'paper-skill-decision',
    action,
    summary: typeof args.summary === 'string' && args.summary.trim()
      ? args.summary.trim()
      : 'Paper context decision completed.',
    reason: typeof args.reason === 'string' && args.reason.trim()
      ? args.reason.trim()
      : 'The model selected the next paper-context step.',
    mode: args.mode === 'pdf-text' ? 'pdf-text' : 'summary',
    paperIds,
  };
}

function parsePaperSkillDecisionOutput(data, options) {
  const thinking = pickChatThinking(data);
  const decision = pickToolCalls(data)
    .map((toolCall) => paperSkillDecisionFromToolCall(toolCall, options))
    .find(Boolean);

  if (decision) {
    return thinking ? { ...decision, thinking } : decision;
  }

  return {
    kind: 'paper-skill-decision',
    action: 'continue-without-context',
    summary: 'Paper context decision skipped.',
    reason: 'The model did not return a paper-context decision tool call.',
    mode: 'summary',
    paperIds: [],
    thinking,
  };
}

function buildPaperSkillDecisionRequest(options) {
  const systemPrompt = [
    'You are PaperQuay paper context router.',
    'You must call paper_skill_decision exactly once. Do not answer the user directly.',
    'Do not mention legacy feature names, internal router names, or internal tool names in user-facing summary or reason fields.',
    'Use semantic understanding of the current request and conversation, not keyword matching.',
    'Decide whether the main Agent answer needs paper content loaded before it responds.',
    'Choose action "load-context" when the user asks for comparison, detailed analysis, methods, experiments, contributions, limitations, literature review, reading, summarization, or any task that should be grounded in paper body content.',
    'Choose action "continue-without-context" for simple library operations such as renaming titles, updating tags, classification, metadata cleanup, or ordinary chat that does not need paper body content.',
    'Choose action "ask-user-to-select-papers" only when paper content is necessary but neither currentPaperScopeIds nor relevant paperScopes identify target papers.',
    'Use currentPaperScopeIds as the default target group.',
    'Use historical paperScopes only when the conversation meaning requires papers from earlier turns, for example comparing the current group with a previous group.',
    'If action is "load-context", use mode "pdf-text" for full document context and include every paperId that should be read.',
    'paperIds must be exact IDs from papers. Never invent IDs.',
  ].join(' ');
  const messagesForPayload = (Array.isArray(options.messages) ? options.messages : []).map((message) => ({
    role: message?.role,
    content: message?.content,
    paperScopeIds: message?.paperScopeIds,
  }));
  const userPayload = {
    responseLanguage: options.responseLanguage,
    instruction: options.instruction,
    currentPaperScopeIds: options.currentPaperScopeIds,
    paperScopes: options.paperScopes,
    papers: options.papers,
    messages: messagesForPayload,
    paperSkill: {
      currentScopeMeaning: 'currentPaperScopeIds are the papers selected for the current turn',
      historicalScopeMeaning: 'paperScopes with source "history" are paper groups from earlier turns in this Agent chat',
      loadContextAction: 'When full paper content is needed, return action load-context with mode pdf-text and the target paperIds.',
      contentResolution: 'PaperQuay resolves paperIds to cached MinerU parsed content when available, then PDF text.',
    },
  };

  return {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(userPayload) },
    ],
    requestExtras: {
      tools: [PAPER_SKILL_DECISION_TOOL],
      toolChoice: {
        type: 'function',
        function: { name: PAPER_SKILL_DECISION_TOOL_NAME },
      },
      reasoningSummary: 'auto',
    },
  };
}

function isObjectRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringFromObject(value, key) {
  return typeof value?.[key] === 'string' ? value[key].trim() : '';
}

function arrayFromObject(value, keys) {
  for (const key of keys) {
    if (Array.isArray(value?.[key])) {
      return value[key];
    }
  }

  return null;
}

function normalizeParsedLibraryAgentJson(parsed) {
  if (!isObjectRecord(parsed)) {
    return parsed;
  }

  if (parsed.kind === 'plan' && isObjectRecord(parsed.plan)) {
    return parsed;
  }

  if (isObjectRecord(parsed.plan)) {
    return {
      ...parsed,
      kind: 'plan',
    };
  }

  const args = isObjectRecord(parsed.arguments)
    ? parsed.arguments
    : isObjectRecord(parsed.parameters)
      ? parsed.parameters
      : parsed;
  const toolName =
    stringFromObject(parsed, 'tool') ||
    stringFromObject(parsed, 'name') ||
    stringFromObject(parsed, 'functionName') ||
    (isObjectRecord(parsed.function) ? stringFromObject(parsed.function, 'name') : '') ||
    stringFromObject(args, 'tool');
  const items = arrayFromObject(args, ['items', 'updates', 'paperUpdates', 'papers']);

  if (!toolName || !items) {
    return parsed;
  }

  return {
    kind: 'plan',
    plan: {
      tool: stringFromObject(args, 'tool') || toolName,
      summary:
        stringFromObject(args, 'summary') ||
        stringFromObject(args, 'description') ||
        stringFromObject(parsed, 'summary') ||
        stringFromObject(parsed, 'description') ||
        `${toolName} plan`,
      items,
    },
  };
}

function isLikelyToolSupportError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const normalized = message.toLowerCase();

  return [
    'tool_choice',
    'tools',
    'function calling',
    'function_call',
    'strict',
    'unknown parameter',
    'unrecognized request argument',
    'unsupported parameter',
    'not support',
    'does not support',
  ].some((signal) => normalized.includes(signal));
}

function isLikelyReasoningSupportError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const normalized = message.toLowerCase();

  return [
    'reasoning',
    'reasoning.summary',
    'reasoning_effort',
    'unknown parameter',
    'unrecognized request argument',
    'unsupported parameter',
    'not support',
    'does not support',
  ].some((signal) => normalized.includes(signal));
}

async function openAiChatWithAgentFallback(options, messages, requestExtras, allowPaperContextTool) {
  try {
    return await openAiChat(options, messages, requestExtras);
  } catch (error) {
    const shouldRetryWithoutTools = allowPaperContextTool && isLikelyToolSupportError(error);
    const shouldRetryWithoutReasoningSummary =
      Boolean(requestExtras?.reasoningSummary) && isLikelyReasoningSupportError(error);

    if (!shouldRetryWithoutTools && !shouldRetryWithoutReasoningSummary) {
      throw error;
    }

    const nextExtras = {
      ...requestExtras,
      tools: shouldRetryWithoutTools ? undefined : requestExtras?.tools,
      toolChoice: shouldRetryWithoutTools ? undefined : requestExtras?.toolChoice,
      reasoningSummary: shouldRetryWithoutReasoningSummary ? undefined : requestExtras?.reasoningSummary,
    };

    try {
      return await openAiChat(options, messages, nextExtras);
    } catch (retryError) {
      if (nextExtras.reasoningSummary && isLikelyReasoningSupportError(retryError)) {
        return openAiChat(options, messages, {
          ...nextExtras,
          reasoningSummary: undefined,
        });
      }

      throw retryError;
    }
  }
}

function buildLibraryAgentModelRequest(options) {
  const allowPaperContextTool = options.allowContextRequest !== false &&
    Array.isArray(options.papers) &&
    options.papers.length > 0;
  const systemPrompt = [
    'You are PaperQuay library agent. You may answer directly in natural language for ordinary questions.',
    'Return JSON only when you need a structured app action with kind "plan", "context-request", or "choice-request", unless you call the request_paper_context tool.',
    'For direct answers, do not wrap the answer in JSON.',
    'For plan, return one valid JSON object only, without Markdown fences, comments, trailing commas, or extra prose.',
    'The exact plan shape is {"kind":"plan","plan":{"tool":"rename|metadata|smart-tags|clean-tags|classify","summary":"...","items":[{"paperId":"...","title":"...","description":"...","before":"...","after":"...","update":{...},"targetCategoryName":"...","targetCategoryParentName":"..."}]}}.',
    'Never use UI/function names such as rename_papers, update_paper_metadata, update_paper_tags, clean_paper_tags, or classify_papers as plan.tool. Use only rename, metadata, smart-tags, clean-tags, or classify.',
    'For rename plans, every item must include paperId, before, after, and update.title. update.title must exactly equal after. Do not put the new paper title only in title, description, or after.',
    'For simple rename rules such as prefix, suffix, or replace, do not call request_paper_context. Use the titles already provided in papers.',
    'If currentPaperScopeIds is non-empty and the user gives a write action, create exactly one plan item for each valid ID in currentPaperScopeIds unless the user explicitly says otherwise. Do not return an empty items array.',
    'Rename example: if currentPaperScopeIds is ["paper-a","paper-b"], paper-a title is "Alpha", paper-b title is "Beta", and the user says "前面加 已读", return exactly {"kind":"plan","plan":{"tool":"rename","summary":"给 2 篇选中文献标题前加“已读”。","items":[{"paperId":"paper-a","title":"重命名：Alpha","description":"Alpha -> 已读 Alpha","before":"Alpha","after":"已读 Alpha","update":{"title":"已读 Alpha"}},{"paperId":"paper-b","title":"重命名：Beta","description":"Beta -> 已读 Beta","before":"Beta","after":"已读 Beta","update":{"title":"已读 Beta"}}]}}.',
    'The user payload includes categories and papers. Each paper may include categoryIds, categories, and categoryPaths.',
    'If the user names a category or folder, restrict your analysis and any requested paper context to papers whose categoryPaths or categoryIds match that scope. Do not invent category membership.',
    'The payload may include currentPaperScopeIds and paperScopes. Treat currentPaperScopeIds as the default paper scope for this turn.',
    'paperScopes may include current and historical paper groups from the same conversation. Use historical scopes only when the conversation context semantically requires earlier or multiple paper groups; do not rely on keyword matching.',
    'The papers array can include both the current scope and historical-scope candidates. Do not treat every paper in papers as active when currentPaperScopeIds is non-empty.',
    'If papers is non-empty, do not return kind "choice-request" merely to ask the user to select papers; use the current scope by default and historical scopes only when needed.',
    'You can retrieve full paper content by calling request_paper_context with mode "pdf-text" and paperIds from papers. PaperQuay will resolve those IDs to cached MinerU parsed content when possible or PDF text otherwise.',
    'For paper comparison, detailed analysis, methodology, experiments, contributions, limitations, literature review, or "read/summarize/analyze these papers" requests, call request_paper_context in mode "pdf-text" before answering unless contextText is already present for every target paper.',
    'If the user refers to "刚才", "之前", "前面", "上面", "那几篇", "the previous papers", or asks to compare the current papers with earlier papers in the same conversation, use paperScopes to include the relevant historical paperIds. Do not say you only have IDs; use the IDs to request context.',
    'When comparing multiple paper groups, load context for all compared paperIds in one request_paper_context call. Then answer with a structured comparison grounded in the loaded context.',
    'Tool-call example: if currentPaperScopeIds is ["paper-a","paper-b"], paperScopes contains a historical group ["paper-c","paper-d","paper-e"], and the user asks to compare the current two papers with the previous three, call request_paper_context with {"summary":"加载当前论文和上一组论文的正文用于对比","mode":"pdf-text","reason":"The user asked for a cross-turn paper comparison that requires full document content.","paperIds":["paper-a","paper-b","paper-c","paper-d","paper-e"]}.',
    'For write actions such as rename, metadata updates, tags, or classification, create plan items for currentPaperScopeIds by default unless the user explicitly narrows, broadens, or changes the target scope.',
    'For kind "answer", the answer string must be non-empty, concrete, and useful to the user.',
    'If the user asks to rename or change paper titles but does not provide a new title or a clear rename rule, return kind "answer" with one concise clarification question and mention the current target papers.',
    'Only return kind "choice-request" when you include non-empty userChoices.options with executable instruction values.',
    'When additional paper content is required and the request_paper_context tool is available, call that tool instead of returning JSON. Its paperIds must be chosen from papers.',
    'Only return kind "context-request" when additional paper content is required and no tool call is available; include mode, reason, and paperIds chosen from papers. If paperIds are unknown, return paperIds: [] instead of omitting it.',
    'When currentPaperScopeIds is non-empty and you need paper context for the current turn, use currentPaperScopeIds as request_paper_context.paperIds unless the conversation semantically requires a different historical scope.',
    'Never ask the user to select papers again when currentPaperScopeIds is non-empty and those IDs exist in papers.',
    'For answer, plan, and context-request outputs, only reference paper IDs that exist in the provided papers array.',
    'For write actions, return a reviewable plan and do not claim that changes were already applied.',
    'Write user-visible answer, summary, title, and description strings in responseLanguage when it is provided.',
  ].join(' ');
  const visionAttachments = (Array.isArray(options.messages) ? options.messages : [])
    .flatMap((message) => Array.isArray(message?.attachments) ? message.attachments : [])
    .filter((attachment) => {
      const kind = String(attachment?.kind ?? '').trim();
      const mimeType = String(attachment?.mimeType ?? '').trim().toLowerCase();
      const dataUrl = String(attachment?.dataUrl ?? '').trim();

      return dataUrl && (kind === 'image' || kind === 'screenshot' || mimeType.startsWith('image/'));
    });
  const messagesForPayload = (Array.isArray(options.messages) ? options.messages : []).map((message) => ({
    ...message,
    attachments: Array.isArray(message?.attachments)
      ? message.attachments.map((attachment) => ({
        id: attachment?.id,
        kind: attachment?.kind,
        name: attachment?.name,
        mimeType: attachment?.mimeType,
        size: attachment?.size,
        summary: attachment?.summary,
        textContent: attachment?.textContent,
      }))
      : undefined,
  }));
  const userPayload = {
    response_format_instruction: allowPaperContextTool
      ? 'Answer naturally unless a structured app action is needed. If you need paper context, call request_paper_context.'
      : 'Answer naturally unless a structured app action is needed. Use JSON only for structured app actions.',
    paperSkill: {
      currentScopeMeaning: 'currentPaperScopeIds are the papers selected for the current turn',
      historicalScopeMeaning: 'paperScopes with source "history" are paper groups from earlier turns in this Agent chat',
      contextTool: allowPaperContextTool ? REQUEST_PAPER_CONTEXT_TOOL_NAME : null,
      canLoadFullDocumentByPaperId: allowPaperContextTool,
      fullDocumentMode: 'pdf-text loads MinerU parsed content first when available, then PDF text',
    },
    tool: options.tool,
    instruction: options.instruction,
    currentPaperScopeIds: options.currentPaperScopeIds,
    paperScopes: options.paperScopes,
    responseLanguage: options.responseLanguage,
    categories: options.categories,
    papers: options.papers,
    messages: messagesForPayload,
  };
  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `${userPayload.response_format_instruction}\n\n${JSON.stringify(userPayload)}`,
      attachments: visionAttachments,
    },
  ];
  const requestExtras = {
    tools: allowPaperContextTool ? [REQUEST_PAPER_CONTEXT_TOOL] : undefined,
    toolChoice: allowPaperContextTool ? 'auto' : undefined,
    reasoningSummary: 'auto',
  };

  return { allowPaperContextTool, messages, requestExtras };
}

async function openAiChatAgentStreamWithFallback(options, messages, requestExtras, allowPaperContextTool) {
  const request = async (extras) => {
    const response = await openAiChat(options, messages, { ...extras, stream: true });

    if (response.ok && response.body) {
      return response;
    }

    const text = await response.text().catch(() => '');
    throw new Error(`OpenAI-compatible agent stream HTTP ${response.status}: ${text}`);
  };

  try {
    return await request(requestExtras);
  } catch (error) {
    const shouldRetryWithoutTools = allowPaperContextTool && isLikelyToolSupportError(error);
    const shouldRetryWithoutReasoningSummary =
      Boolean(requestExtras?.reasoningSummary) && isLikelyReasoningSupportError(error);

    if (!shouldRetryWithoutTools && !shouldRetryWithoutReasoningSummary) {
      throw error;
    }

    const nextExtras = {
      ...requestExtras,
      tools: shouldRetryWithoutTools ? undefined : requestExtras?.tools,
      toolChoice: shouldRetryWithoutTools ? undefined : requestExtras?.toolChoice,
      reasoningSummary: shouldRetryWithoutReasoningSummary ? undefined : requestExtras?.reasoningSummary,
    };

    try {
      return await request(nextExtras);
    } catch (retryError) {
      if (nextExtras.reasoningSummary && isLikelyReasoningSupportError(retryError)) {
        return request({ ...nextExtras, reasoningSummary: undefined });
      }

      throw retryError;
    }
  }
}

async function readAgentStreamResponse({ requestId, options, response, sender }) {
  let mode = 'pending';
  let bufferedText = '';
  const sendTextDelta = (text) => {
    sender.send('paperquay:event', AGENT_STREAM_EVENT, {
      requestId,
      kind: 'delta',
      text,
    });
  };

  return readOpenAiStreamResponse(response, options, {
    onThinkingDelta(thinkingDelta) {
      sender.send('paperquay:event', AGENT_STREAM_EVENT, {
        requestId,
        kind: 'thinking-delta',
        text: thinkingDelta,
      });
    },
    onTextDelta(answerDelta) {
      if (mode === 'suppressed') {
        return;
      }

      if (mode === 'open') {
        sendTextDelta(answerDelta);
        return;
      }

      bufferedText += answerDelta;
      const trimmedStart = bufferedText.trimStart();

      if (!trimmedStart) {
        return;
      }

      if (trimmedStart.startsWith('{') || /^```json\b/i.test(trimmedStart)) {
        mode = 'suppressed';
        bufferedText = '';
        return;
      }

      mode = 'open';
      sendTextDelta(bufferedText);
      bufferedText = '';
    },
  });
}

function parseLibraryAgentModelOutput(data, options) {
  const thinking = pickChatThinking(data);
  const contextToolRequest = pickToolCalls(data)
    .map((toolCall) => contextRequestFromToolCall(toolCall, options))
    .find(Boolean);

  if (contextToolRequest) {
    return thinking ? { ...contextToolRequest, thinking } : contextToolRequest;
  }

  const text = pickChatText(data);

  if (!text) {
    const currentScopeRequest = contextRequestFromCurrentScope(options);

    if (currentScopeRequest) {
      return thinking ? { ...currentScopeRequest, thinking } : currentScopeRequest;
    }

    const emptyAnswer = {
      kind: 'answer',
      answer: '模型没有返回可显示的文本内容，也没有发起可执行的工具调用。请换一种问法，或检查当前模型是否支持工具调用。',
    };
    return thinking ? { ...emptyAnswer, thinking } : emptyAnswer;
  }

  try {
    const parsed = parseJsonObject(text);

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const normalized = normalizeParsedLibraryAgentJson(parsed);
      return thinking ? { ...normalized, thinking } : normalized;
    }
  } catch {
    // Plain text is a valid direct answer for conversational Agent turns.
  }

  const answer = {
    kind: 'answer',
    answer: text,
  };

  return thinking ? { ...answer, thinking } : answer;
}

function stripThinkBlocks(text) {
  let result = String(text ?? '').trim();

  result = result.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '').trim();

  const openThinkMatch = result.match(/<think\b[^>]*>/i);
  if (!openThinkMatch || openThinkMatch.index === undefined) {
    return result;
  }

  const beforeThink = result.slice(0, openThinkMatch.index).trim();
  const afterThink = result.slice(openThinkMatch.index + openThinkMatch[0].length).trim();
  const finalMarker = findLastFinalTranslationMarker(afterThink);

  if (finalMarker) {
    return [beforeThink, afterThink.slice(finalMarker.index + finalMarker.text.length).trim()]
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }

  const roleMarker = findLastRoleMarker(afterThink);
  if (roleMarker) {
    return [beforeThink, afterThink.slice(roleMarker.index + roleMarker.text.length).trim()]
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }

  const lines = afterThink
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  const lastLine = lines.at(-1) ?? '';

  return beforeThink || lastLine;
}

function findLastFinalTranslationMarker(text) {
  const markerPattern = /(最终译文|最终翻译|最终结果|翻译结果|译文|final translation|translation|result)\s*[:：]\s*/gi;
  let match;
  let lastMatch = null;

  while ((match = markerPattern.exec(text)) !== null) {
    lastMatch = {
      index: match.index,
      text: match[0],
    };
  }

  return lastMatch;
}

function findLastRoleMarker(text) {
  const markerPattern = /(?:^|[\r\n])\s*(用户|user|助手|assistant|模型|model)\s*[:：]\s*/gi;
  let match;
  let lastMatch = null;

  while ((match = markerPattern.exec(text)) !== null) {
    lastMatch = {
      index: match.index,
      text: match[0],
    };
  }

  return lastMatch;
}

function stripTranslationPrefixes(text) {
  let result = String(text ?? '').trim();

  for (let index = 0; index < 8; index += 1) {
    const next = result
      .replace(/^\s*[-*#>"'“”‘’\s]*(用户|user|助手|assistant|模型|model)\s*[:：]\s*/i, '')
      .replace(/^\s*[-*#>"'“”‘’\s]*(最终译文|最终翻译|最终结果|翻译结果|译文|final translation|translation|result)\s*[:：]\s*/i, '')
      .replace(/^\s*["'“”‘’]*(用户|user|助手|assistant)\s*[\r\n]+\s*/i, '')
      .trim();

    if (next === result) {
      break;
    }

    result = next;
  }

  return result;
}

function cleanTranslationText(text) {
  let result = stripThinkBlocks(text);
  const finalMarker = findLastFinalTranslationMarker(result);

  if (finalMarker && finalMarker.index > 0) {
    result = result.slice(finalMarker.index + finalMarker.text.length);
  }

  result = result.replace(/<\/?think\b[^>]*>/gi, '').trim();
  result = stripTranslationPrefixes(result).replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  return stripTranslationPrefixes(result);
}

function buildAcademicTranslationPrompt(options) {
  const sourceLanguage = options.sourceLanguage || 'auto';
  const targetLanguage = options.targetLanguage || 'Chinese';

  return [
    'You are a professional academic paper translator.',
    `Translate from ${sourceLanguage} to ${targetLanguage}.`,
    'Use precise, fluent academic language suitable for scholarly papers.',
    'Preserve the original meaning, technical terminology, citations, equations, variable names, numbers, URLs, and formatting-sensitive markers.',
    'Do not add explanations, comments, summaries, role labels, Markdown wrappers, or any <think> content.',
    'Return only the final translated text.',
  ].join(' ');
}

function buildPaperSummaryPrompt(options) {
  const outputLanguage = typeof options.outputLanguage === 'string' && options.outputLanguage.trim()
    ? options.outputLanguage.trim()
    : 'the same language as the PaperQuay UI';

  return [
    'You are PaperQuay\'s academic paper overview generator.',
    `Return compact JSON only. Write every user-visible string value in ${outputLanguage}.`,
    'This language rule applies to title, abstract, overview, background, researchProblem, approach, experimentSetup, conclusions, limitations, and every item in keyFindings, takeaways, and keywords.',
    'Translate or paraphrase source text into the requested output language when the paper context uses another language.',
    'Keep JSON object keys exactly as: title, abstract, overview, background, researchProblem, approach, experimentSetup, keyFindings, conclusions, limitations, takeaways, keywords.',
    'Use arrays of strings for keyFindings, takeaways, and keywords. Do not include Markdown fences, comments, role labels, or hidden reasoning.',
  ].join(' ');
}

function buildHtmlVisualQaPrompt(options) {
  const responseLanguage = options.responseLanguage || 'English';

  return [
    'You are PaperQuay\'s academic paper QA assistant.',
    `Answer in ${responseLanguage}.`,
    '',
    'Response quality:',
    '- Be clear, vivid, and well-structured.',
    '- Start with the core conclusion, then explain the mechanism, evidence, and implications.',
    '- Use concrete academic language. Avoid vague praise, filler, and repeated restatement.',
    '- Use headings from ## when the answer has multiple parts.',
    '- Prefer short paragraphs and dense, readable wording.',
    '- Define important technical terms briefly when they may block understanding.',
    '- Cite evidence with plain labels such as [1] when citations are available.',
    '- Keep visual answers polished: clear spacing, readable typography, restrained colors, and obvious hierarchy.',
    '',
    'When to visualize:',
    '- HTML rendering mode is enabled. Prefer answering with one locally renderable HTML visual block by default.',
    '- Use compact Markdown only when the answer is very short, simple, and purely linear.',
    '- Use one visual HTML block whenever the answer involves summary, comparison, workflow, hierarchy, causal chain, experiment design, model architecture, key contributions, limitations, or dense multi-field information.',
    '- The visual block should make the answer easier to understand at a glance, not decorate it.',
    '- For mechanisms, pipelines, timelines, model structures, or result comparisons, you may use inline SVG for arrows, connectors, simple charts, and compact diagrams.',
    '',
    'HTML visual rules:',
    '- PaperQuay renders HTML locally, so the user should see the rendered result rather than source code.',
    '- Output either one embeddable HTML fragment or one ```html block. Do not output both for the same content.',
    '- Use inline style attributes only.',
    '- Do not use <style>, script, iframe, form, external CSS, external images, icon libraries, class selectors, or event handlers.',
    '- Inline SVG is allowed when it carries information, such as a flowchart, axis, arrow, relation graph, or lightweight result chart.',
    '- Never output a full HTML document: no <!DOCTYPE>, <html>, <head>, or <body>.',
    '- Make the root container fill the available width: use width:100%; max-width:none; box-sizing:border-box; min-width:0.',
    '- Do not put a fixed max-width on the root container. Avoid centered narrow cards for the whole answer.',
    '- Keep visual sections spread across the row when space allows, using display:flex or grid with flex-wrap; in a narrow QA panel they must wrap cleanly without horizontal clipping.',
    '- For cards/columns, use min-width:0 plus flex:1 1 180px or grid columns like repeat(auto-fit,minmax(180px,1fr)) so they tile naturally and remain readable in narrow panels.',
    '- Make the design attractive but academic: avoid clutter, oversized decoration, and color noise.',
    '- Avoid root max-height, overflow:auto, and overflow:scroll unless the user explicitly asks for a scroll area.',
    '',
    'Final-output rules:',
    '- Return only the final answer.',
    '- Never reveal hidden reasoning, analysis, planning, self-talk, or <think> content.',
    '- Do not start with phrases like "Considering", "I need to", "The user asks", or "I should".',
  ].join('\n');
}

function createAiCommands(context) {
  const { ragStore } = context;

  function documentContext(options) {
    return options.documentText || (options.blocks ?? []).map((block) => block.text).join('\n\n');
  }

  function qaMessages(options) {
    const htmlMode = options.answerRenderMode === 'html';
    const systemPrompt = htmlMode
      ? buildHtmlVisualQaPrompt(options)
      : `Answer questions about the paper. Respond in ${options.responseLanguage || 'the user language'}.`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Paper: ${options.title}\n\nContext:\n${documentContext(options)}` },
      ...(options.messages ?? []).map((message) => ({
        role: message.role,
        content: message.content,
        attachments: message.attachments,
      })),
    ];
  }

  const commands = {
    async test_openai_compatible_chat({ options }) {
      const startedAt = Date.now();
      let data;

      try {
        data = await openAiChat(
          options,
          [{ role: 'user', content: 'Reply with OK.' }],
          { timeoutMs: TEST_MODEL_TIMEOUT_MS },
        );
      } catch (error) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
          throw new Error('模型测试超时：20 秒内没有收到响应。');
        }

        throw error;
      }

      return {
        ok: true,
        endpoint: completionEndpoint(options),
        model: options.model,
        responseModel: data.model,
        latencyMs: Date.now() - startedAt,
        message: pickChatText(data) || 'OK',
      };
    },

    async list_openai_compatible_models({ options }) {
      return listOpenAiModels(options);
    },

    async translate_text_openai_compatible({ options }) {
      const data = await openAiChat(options, [
        { role: 'system', content: buildAcademicTranslationPrompt(options) },
        { role: 'user', content: options.text },
      ]);
      return cleanTranslationText(pickChatText(data));
    },

    async translate_blocks_openai_compatible({ options }) {
      const results = [];

      for (const block of options.blocks ?? []) {
        const translatedText = await commands.translate_text_openai_compatible({
          options: { ...options, text: block.text },
        });
        results.push({ blockId: block.blockId, translatedText });
      }

      return results;
    },

    async summarize_document_openai_compatible({ options }) {
      const data = await openAiChat(options, [
        { role: 'system', content: buildPaperSummaryPrompt(options) },
        { role: 'user', content: JSON.stringify({ title: options.title, authors: options.authors, year: options.year, outputLanguage: options.outputLanguage, text: documentContext(options) }) },
      ], { responseFormat: { type: 'json_object' } });
      const parsed = parseJsonObject(pickChatText(data));

      return {
        title: parsed.title || options.title || '',
        abstract: parsed.abstract || '',
        overview: parsed.overview || '',
        background: parsed.background || '',
        researchProblem: parsed.researchProblem || '',
        approach: parsed.approach || '',
        experimentSetup: parsed.experimentSetup || '',
        keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings : [],
        conclusions: parsed.conclusions || '',
        limitations: parsed.limitations || '',
        takeaways: Array.isArray(parsed.takeaways) ? parsed.takeaways : [],
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      };
    },

    async ask_document_openai_compatible({ options }) {
      return pickChatText(await openAiChat(options, qaMessages(options)));
    },

    async ask_document_openai_compatible_stream({ requestId, options }, event) {
      const sender = event.sender;
      const response = await openAiChat(options, qaMessages(options), { stream: true });

      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        sender.send('paperquay:event', QA_STREAM_EVENT, { requestId, kind: 'error', error: `HTTP ${response.status}: ${text}` });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;

          try {
            const delta = pickStreamTextDelta(JSON.parse(payload), options.apiMode);
            if (delta) sender.send('paperquay:event', QA_STREAM_EVENT, { requestId, kind: 'delta', text: delta });
          } catch {}
        }
      }

      sender.send('paperquay:event', QA_STREAM_EVENT, { requestId, kind: 'done' });
    },

    async rag_embed_text({ request }) {
      const [embedding] = await embedTexts([request.text], request.embedding);
      return embedding ?? [];
    },

    async rag_embed_chunks({ request }) {
      const vectors = await embedTexts((request.chunks ?? []).map((chunk) => chunk.text), request.embedding);
      return (request.chunks ?? []).map((chunk, index) => ({ ...chunk, embedding: vectors[index] ?? [] }));
    },

    async rag_index_document({ request }) {
      ragStore.indexDocument(request);
    },

    async rag_report_document_index_failure({ request }) {
      ragStore.reportFailure(request);
    },

    async rag_get_document_index_status({ request }) {
      return ragStore.getDocumentIndexStatus(request);
    },

    async rag_retrieve_document_chunks({ request }) {
      return ragStore.retrieveDocumentChunks(request);
    },

    async decide_library_agent_paper_context_openai_compatible({ options }) {
      const { messages, requestExtras } = buildPaperSkillDecisionRequest(options);
      const data = await openAiChatWithAgentFallback(options, messages, requestExtras, true);

      return parsePaperSkillDecisionOutput(data, options);
    },

    async generate_library_agent_plan_openai_compatible({ options }) {
      const { allowPaperContextTool, messages, requestExtras } = buildLibraryAgentModelRequest(options);
      const data = await openAiChatWithAgentFallback(options, messages, requestExtras, allowPaperContextTool);

      return parseLibraryAgentModelOutput(data, options);
    },

    async generate_library_agent_plan_openai_compatible_stream({ requestId, options }, event) {
      const sender = event.sender;
      const { allowPaperContextTool, messages, requestExtras } = buildLibraryAgentModelRequest(options);

      try {
        const response = await openAiChatAgentStreamWithFallback(
          options,
          messages,
          requestExtras,
          allowPaperContextTool,
        );
        const data = await readAgentStreamResponse({ requestId, options, response, sender });
        const result = parseLibraryAgentModelOutput(data, options);

        sender.send('paperquay:event', AGENT_STREAM_EVENT, { requestId, kind: 'done' });
        return result;
      } catch (error) {
        const message = error instanceof Error && error.message
          ? error.message
          : String(error ?? 'Agent stream failed');

        sender.send('paperquay:event', AGENT_STREAM_EVENT, { requestId, kind: 'error', error: message });
        throw error;
      }
    },
  };

  return commands;
}

module.exports = { createAiCommands, buildPaperSummaryPrompt };

import {
  assignPaperToLibraryCategory,
  createLibraryCategory,
  listLibraryCategories,
  updateLibraryPaper,
} from './library';
import { lookupLiteratureMetadata } from './metadata';
import type {
  CreateCategoryRequest,
  LiteratureCategory,
  LiteraturePaper,
  UpdatePaperRequest,
} from '../types/library';
import type { MetadataLookupResult } from '../types/metadata';
import type {
  ApplyLibraryAgentPlanResult,
  LibraryAgentPlan,
  LibraryAgentPlanItem,
  RenameOperation,
} from './libraryAgent';

const AUTO_CLASSIFY_PARENT_NAME = 'Agent 自动归类';
const GENERIC_COLLECTION_NAMES = new Set([
  'A',
  'An',
  'And',
  'Are',
  'As',
  'Based',
  'By',
  'For',
  'From',
  'In',
  'Into',
  'Is',
  'Method',
  'Methods',
  'Model',
  'Models',
  'New',
  'Of',
  'On',
  'Paper',
  'Problem',
  'Research',
  'Study',
  'The',
  'This',
  'To',
  'Using',
  'With',
  '方法',
  '模型',
  '研究',
  '论文',
  '问题',
  '系统',
  '一种',
  '一个',
  '基于',
]);

const tagAliases = new Map<string, string>([
  ['ai', 'AI'],
  ['artificial intelligence', 'AI'],
  ['人工智能', 'AI'],
  ['ml', 'Machine Learning'],
  ['machine learning', 'Machine Learning'],
  ['机器学习', 'Machine Learning'],
  ['dl', 'Deep Learning'],
  ['deep learning', 'Deep Learning'],
  ['深度学习', 'Deep Learning'],
  ['llm', 'LLM'],
  ['llms', 'LLM'],
  ['large language model', 'LLM'],
  ['large language models', 'LLM'],
  ['大语言模型', 'LLM'],
  ['nlp', 'NLP'],
  ['natural language processing', 'NLP'],
  ['自然语言处理', 'NLP'],
  ['cv', 'Computer Vision'],
  ['computer vision', 'Computer Vision'],
  ['计算机视觉', 'Computer Vision'],
  ['rl', 'Reinforcement Learning'],
  ['reinforcement learning', 'Reinforcement Learning'],
  ['强化学习', 'Reinforcement Learning'],
  ['uav', 'UAV'],
  ['uavs', 'UAV'],
  ['drone', 'UAV'],
  ['drones', 'UAV'],
  ['unmanned aerial vehicle', 'UAV'],
  ['unmanned aerial vehicles', 'UAV'],
  ['无人机', 'UAV'],
  ['robot', 'Robotics'],
  ['robots', 'Robotics'],
  ['robotics', 'Robotics'],
  ['机器人', 'Robotics'],
  ['optimization', 'Optimization'],
  ['optimisation', 'Optimization'],
  ['优化', 'Optimization'],
  ['survey', 'Survey'],
  ['review', 'Survey'],
  ['综述', 'Survey'],
]);

const tagRules: Array<{ tag: string; pattern: RegExp }> = [
  { tag: 'UAV', pattern: /\b(uav|uavs|drone|drones|unmanned aerial)\b|无人机/i },
  { tag: 'LLM', pattern: /\b(llm|llms|large language model|transformer)\b|大语言模型|语言模型/i },
  { tag: 'Machine Learning', pattern: /\b(machine learning|ml)\b|机器学习/i },
  { tag: 'Deep Learning', pattern: /\b(deep learning|neural network|deep belief)\b|深度学习|神经网络/i },
  { tag: 'Reinforcement Learning', pattern: /\b(reinforcement learning|rl|markov decision|mdp)\b|强化学习/i },
  { tag: 'Optimization', pattern: /\b(optimization|optimisation|scheduling|allocation)\b|优化|调度|分配/i },
  { tag: 'Robotics', pattern: /\b(robot|robotics|manipulator)\b|机器人/i },
  { tag: 'Computer Vision', pattern: /\b(computer vision|image|segmentation|detection)\b|计算机视觉|图像|检测/i },
  { tag: 'NLP', pattern: /\b(nlp|natural language processing|language model)\b|自然语言处理/i },
  { tag: 'Survey', pattern: /\b(survey|review|overview)\b|综述|回顾/i },
];

function newPlanId(tool: LibraryAgentPlan['tool']): string {
  return `agent-plan:${tool}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeComparable(value: string): string {
  return value
    .trim()
    .replace(/[，、；;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

function titleCaseEnglish(value: string): string {
  if (!/^[a-z][a-z0-9 -]+$/i.test(value)) {
    return value;
  }

  const minorWords = new Set(['and', 'or', 'of', 'for', 'the', 'in', 'on', 'to', 'with']);

  return value
    .split(/\s+/)
    .map((part, index) => {
      if (index > 0 && minorWords.has(part.toLocaleLowerCase())) {
        return part.toLocaleLowerCase();
      }

      return part.charAt(0).toLocaleUpperCase() + part.slice(1).toLocaleLowerCase();
    })
    .join(' ');
}

export function normalizeAgentTagName(rawName: string): string {
  const normalized = rawName
    .trim()
    .replace(/^#+/, '')
    .replace(/[，、；;]+/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

  if (!normalized) {
    return '';
  }

  const comparable = normalizeComparable(normalized);
  const alias = tagAliases.get(comparable);

  return alias ?? titleCaseEnglish(normalized);
}

export function uniqueTags(tags: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();

  for (const tag of tags) {
    const normalized = normalizeAgentTagName(tag);
    const key = normalizeComparable(normalized);

    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(normalized);
  }

  return output;
}

export function paperPdfPath(paper: LiteraturePaper): string | null {
  const storedPath = paper.attachments
    .find((attachment) => attachment.kind === 'pdf' && attachment.storedPath.trim())
    ?.storedPath
    .trim();

  return storedPath || null;
}

export function paperAuthors(paper: LiteraturePaper): string[] {
  return paper.authors.map((author) => author.name.trim()).filter(Boolean);
}

function metadataUpdateForPaper(
  paper: LiteraturePaper,
  metadata: MetadataLookupResult,
): UpdatePaperRequest | null {
  const request: UpdatePaperRequest = { paperId: paper.id };
  let changed = false;

  const assignString = <Key extends keyof UpdatePaperRequest>(
    key: Key,
    currentValue: string | null,
    nextValue: string | null | undefined,
  ) => {
    const normalized = nextValue?.trim();

    if (!normalized || normalized === currentValue?.trim()) {
      return;
    }

    (request[key] as string | null | undefined) = normalized;
    changed = true;
  };

  assignString('title', paper.title, metadata.title);
  assignString('year', paper.year, metadata.year);
  assignString('publication', paper.publication, metadata.publication);
  assignString('doi', paper.doi, metadata.doi);
  assignString('url', paper.url, metadata.url);
  assignString('abstractText', paper.abstractText, metadata.abstractText);

  const nextAuthors = metadata.authors.map((author) => author.trim()).filter(Boolean);

  if (nextAuthors.length > 0) {
    const currentAuthors = paperAuthors(paper);

    if (
      nextAuthors.join('\n').toLocaleLowerCase() !== currentAuthors.join('\n').toLocaleLowerCase()
    ) {
      request.authors = nextAuthors;
      changed = true;
    }
  }

  return changed ? request : null;
}

export function parseRenameCommand(command: string): RenameOperation | null {
  const normalized = command.trim();

  if (!normalized) {
    return null;
  }

  const replaceMatch = normalized.match(/把\s*(.+?)\s*(?:替换成|改成|换成)\s*(.+)$/);

  if (replaceMatch) {
    return {
      mode: 'replace',
      from: replaceMatch[1].trim(),
      to: replaceMatch[2].trim(),
    };
  }

  const prefixMatch = normalized.match(
    /(?:前面|开头|标题前|名字前)\s*(?:加上|添加|加)\s*(.+)$/,
  );

  if (prefixMatch) {
    return { mode: 'prefix', value: prefixMatch[1].trim() };
  }

  const suffixMatch = normalized.match(
    /(?:后面|末尾|结尾|标题后|名字后)?\s*(?:加上|添加|加)\s*(.+)$/,
  );

  if (suffixMatch) {
    return { mode: 'suffix', value: suffixMatch[1].trim() };
  }

  return { mode: 'suffix', value: normalized };
}

function renameTitle(title: string, operation: RenameOperation): string {
  if (operation.mode === 'prefix') {
    return `${operation.value}${title}`;
  }

  if (operation.mode === 'suffix') {
    return `${title}${operation.value}`;
  }

  return title.split(operation.from).join(operation.to);
}

export function buildRenamePlan(
  papers: LiteraturePaper[],
  operation: RenameOperation,
): LibraryAgentPlan {
  const items = papers
    .map((paper): LibraryAgentPlanItem | null => {
      const nextTitle = renameTitle(paper.title, operation).trim();

      if (!nextTitle || nextTitle === paper.title) {
        return null;
      }

      return {
        id: `${paper.id}:rename`,
        tool: 'rename',
        paperId: paper.id,
        paperTitle: paper.title,
        title: '重命名论文标题',
        description: `${paper.title} -> ${nextTitle}`,
        before: paper.title,
        after: nextTitle,
        updateRequest: {
          paperId: paper.id,
          title: nextTitle,
        },
      };
    })
    .filter((item): item is LibraryAgentPlanItem => item !== null);

  return {
    id: newPlanId('rename'),
    tool: 'rename',
    title: '批量重命名论文',
    description: `准备更新 ${items.length} 篇文献标题。`,
    items,
    createdAt: Date.now(),
  };
}

export async function buildMetadataCompletionPlan(
  papers: LiteraturePaper[],
  onProgress?: (message: string) => void,
): Promise<LibraryAgentPlan> {
  const items: LibraryAgentPlanItem[] = [];

  for (const [index, paper] of papers.entries()) {
    onProgress?.(`正在补全元数据 ${index + 1}/${papers.length}: ${paper.title}`);

    const metadata = await lookupLiteratureMetadata({
      doi: paper.doi,
      title: paper.title,
      path: paperPdfPath(paper),
    });

    if (!metadata) {
      continue;
    }

    const updateRequest = metadataUpdateForPaper(paper, metadata);

    if (!updateRequest) {
      continue;
    }

    const changedFields = Object.keys(updateRequest).filter((key) => key !== 'paperId');

    items.push({
      id: `${paper.id}:metadata`,
      tool: 'metadata',
      paperId: paper.id,
      paperTitle: paper.title,
      title: '自动补全文献元数据',
      description: `来源：${metadata.source}；字段：${changedFields.join(', ')}`,
      before: [
        paper.title,
        paperAuthors(paper).join(', '),
        paper.year,
        paper.publication,
        paper.doi,
      ]
        .filter(Boolean)
        .join(' · '),
      after: [
        updateRequest.title ?? paper.title,
        updateRequest.authors?.join(', ') ?? paperAuthors(paper).join(', '),
        updateRequest.year ?? paper.year,
        updateRequest.publication ?? paper.publication,
        updateRequest.doi ?? paper.doi,
      ]
        .filter(Boolean)
        .join(' · '),
      updateRequest,
      metadataSource: metadata.source,
    });
  }

  return {
    id: newPlanId('metadata'),
    tool: 'metadata',
    title: '自动补全元数据',
    description: `识别到 ${items.length} 条可更新记录。`,
    items,
    createdAt: Date.now(),
  };
}

export function inferSmartTagsForPaper(paper: LiteraturePaper): string[] {
  const sourceText = [
    paper.title,
    paper.publication,
    paper.abstractText,
    paper.keywords.join(' '),
    paper.tags.map((tag) => tag.name).join(' '),
  ]
    .filter(Boolean)
    .join('\n');
  const inferred = tagRules
    .filter((rule) => rule.pattern.test(sourceText))
    .map((rule) => rule.tag);

  return uniqueTags([
    ...paper.tags.map((tag) => tag.name),
    ...paper.keywords,
    ...inferred,
  ]).slice(0, 8);
}

function collectionCandidateText(paper: LiteraturePaper): string {
  return [
    paper.title,
    paper.publication,
    paper.abstractText,
    paper.keywords.join(' '),
    paper.tags.map((tag) => tag.name).join(' '),
  ]
    .filter(Boolean)
    .join('\n');
}

function extractEnglishPhrases(value: string): string[] {
  const phrases: string[] = [];
  const matches = value.matchAll(/\b[A-Z][A-Za-z0-9]*(?:[- ][A-Z]?[A-Za-z0-9]+){0,4}\b/g);

  for (const match of matches) {
    const phrase = titleCaseEnglish(match[0].replace(/\s+/g, ' ').trim());
    const words = phrase.split(/\s+/);

    if (phrase.length < 3 || phrase.length > 52) {
      continue;
    }

    if (words.length === 1 && GENERIC_COLLECTION_NAMES.has(phrase)) {
      continue;
    }

    if (words.every((word) => GENERIC_COLLECTION_NAMES.has(word))) {
      continue;
    }

    phrases.push(phrase);
  }

  return phrases;
}

function extractChinesePhrases(value: string): string[] {
  const phrases: string[] = [];
  const matches = value.matchAll(/[\u4e00-\u9fa5]{2,12}/g);

  for (const match of matches) {
    const phrase = match[0].trim();

    if (GENERIC_COLLECTION_NAMES.has(phrase)) {
      continue;
    }

    phrases.push(phrase);
  }

  return phrases;
}

function scoreCollectionCandidate(candidate: string, sourceText: string): number {
  const comparable = normalizeComparable(candidate);
  const lowerText = sourceText.toLocaleLowerCase();
  const occurrenceCount = lowerText.split(comparable).length - 1;
  const wordCount = candidate.split(/\s+/).length;
  const isKnownAlias = tagAliases.has(comparable);

  return occurrenceCount * 3 + Math.min(wordCount, 4) + (isKnownAlias ? 5 : 0);
}

export function inferCollectionNameForPaper(paper: LiteraturePaper): string {
  const sourceText = collectionCandidateText(paper);
  const candidates = [
    ...inferSmartTagsForPaper(paper),
    ...paper.keywords,
    ...paper.tags.map((tag) => tag.name),
    ...extractEnglishPhrases(sourceText),
    ...extractChinesePhrases(sourceText),
  ]
    .map(normalizeAgentTagName)
    .filter(Boolean)
    .filter((candidate) => !GENERIC_COLLECTION_NAMES.has(candidate));
  const ranked = new Map<string, { label: string; score: number }>();

  for (const candidate of candidates) {
    const key = normalizeComparable(candidate);
    const previous = ranked.get(key);
    const score = scoreCollectionCandidate(candidate, sourceText);

    if (!previous || score > previous.score) {
      ranked.set(key, { label: candidate, score });
    }
  }

  return [...ranked.values()].sort((left, right) => right.score - left.score)[0]?.label ?? '未命名主题';
}

export function buildSmartTagPlan(papers: LiteraturePaper[]): LibraryAgentPlan {
  const items = papers
    .map((paper): LibraryAgentPlanItem | null => {
      const currentTags = uniqueTags(paper.tags.map((tag) => tag.name));
      const nextTags = inferSmartTagsForPaper(paper);

      if (
        nextTags.length === currentTags.length &&
        nextTags.every(
          (tag, index) =>
            normalizeComparable(tag) === normalizeComparable(currentTags[index]),
        )
      ) {
        return null;
      }

      return {
        id: `${paper.id}:smart-tags`,
        tool: 'smart-tags',
        paperId: paper.id,
        paperTitle: paper.title,
        title: '智能标签建议',
        description: `建议标签：${nextTags.join('、') || '无'}`,
        before: currentTags.join('、') || '无标签',
        after: nextTags.join('、') || '无标签',
        updateRequest: {
          paperId: paper.id,
          tags: nextTags,
        },
      };
    })
    .filter((item): item is LibraryAgentPlanItem => item !== null);

  return {
    id: newPlanId('smart-tags'),
    tool: 'smart-tags',
    title: '智能标签',
    description: `准备为 ${items.length} 篇文献更新标签。`,
    items,
    createdAt: Date.now(),
  };
}

export function buildCleanTagsPlan(papers: LiteraturePaper[]): LibraryAgentPlan {
  const items = papers
    .map((paper): LibraryAgentPlanItem | null => {
      const currentTags = paper.tags.map((tag) => tag.name.trim()).filter(Boolean);
      const nextTags = uniqueTags(currentTags);

      if (
        nextTags.length === currentTags.length &&
        nextTags.every((tag, index) => tag === currentTags[index])
      ) {
        return null;
      }

      return {
        id: `${paper.id}:clean-tags`,
        tool: 'clean-tags',
        paperId: paper.id,
        paperTitle: paper.title,
        title: '标签清洗 / 合并',
        description: '合并大小写、同义词和重复标签。',
        before: currentTags.join('、') || '无标签',
        after: nextTags.join('、') || '无标签',
        updateRequest: {
          paperId: paper.id,
          tags: nextTags,
        },
      };
    })
    .filter((item): item is LibraryAgentPlanItem => item !== null);

  return {
    id: newPlanId('clean-tags'),
    tool: 'clean-tags',
    title: '标签清洗 / 合并',
    description: `准备清洗 ${items.length} 篇文献的标签。`,
    items,
    createdAt: Date.now(),
  };
}

export function buildAutoClassifyPlan(papers: LiteraturePaper[]): LibraryAgentPlan {
  const items = papers.map((paper): LibraryAgentPlanItem => {
    const categoryName = inferCollectionNameForPaper(paper);

    return {
      id: `${paper.id}:classify:${categoryName}`,
      tool: 'classify',
      paperId: paper.id,
      paperTitle: paper.title,
      title: '自动归类 Collection',
      description: `加入 ${AUTO_CLASSIFY_PARENT_NAME} / ${categoryName}`,
      before: paper.categoryIds.length > 0 ? `${paper.categoryIds.length} 个已有分类` : '未分类',
      after: `${AUTO_CLASSIFY_PARENT_NAME} / ${categoryName}`,
      targetCategoryName: categoryName,
      targetCategoryParentName: AUTO_CLASSIFY_PARENT_NAME,
    };
  });

  return {
    id: newPlanId('classify'),
    tool: 'classify',
    title: '自动归类 Collection',
    description: `准备为 ${items.length} 篇文献加入自动分类。`,
    items,
    createdAt: Date.now(),
  };
}

function categoryKey(name: string, parentId: string | null): string {
  return `${parentId ?? 'root'}::${normalizeComparable(name)}`;
}

async function ensureCategory(
  categories: LiteratureCategory[],
  request: CreateCategoryRequest,
): Promise<{ category: LiteratureCategory; categories: LiteratureCategory[] }> {
  const expectedKey = categoryKey(request.name, request.parentId ?? null);
  const existing = categories.find(
    (category) => categoryKey(category.name, category.parentId) === expectedKey,
  );

  if (existing) {
    return { category: existing, categories };
  }

  const category = await createLibraryCategory(request);

  return {
    category,
    categories: [...categories, category],
  };
}

export async function applyLibraryAgentPlan(
  plan: LibraryAgentPlan,
  itemIds: Set<string>,
): Promise<ApplyLibraryAgentPlanResult> {
  let applied = 0;
  let failed = 0;
  const errors: string[] = [];
  let categories = await listLibraryCategories();

  for (const item of plan.items) {
    if (!itemIds.has(item.id)) {
      continue;
    }

    try {
      if (item.updateRequest) {
        await updateLibraryPaper(item.updateRequest);
        applied += 1;
        continue;
      }

      if (item.tool === 'classify' && item.targetCategoryName) {
        const parentResult = await ensureCategory(categories, {
          name: item.targetCategoryParentName ?? AUTO_CLASSIFY_PARENT_NAME,
          parentId: null,
        });
        categories = parentResult.categories;

        const childResult = await ensureCategory(categories, {
          name: item.targetCategoryName,
          parentId: parentResult.category.id,
        });
        categories = childResult.categories;

        await assignPaperToLibraryCategory({
          paperId: item.paperId,
          categoryId: childResult.category.id,
        });
        applied += 1;
        continue;
      }
    } catch (error) {
      failed += 1;
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { applied, failed, errors };
}

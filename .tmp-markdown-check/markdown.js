const MATH_FENCE_START_PATTERN = /^```(?:latex|tex|math|katex)\s*$/i;
const CODE_FENCE_PATTERN = /^```/;
const PROTECTED_MATH_PATTERN = /(\$\$[^$]+\$\$|\$[^$\n]+\$|\\\([^)]*\\\)|\\\[[^\]]*\\\])/g;
const INLINE_FORMULA_START_PATTERN = /[A-Za-z0-9\\\u0370-\u03FF\u1F00-\u1FFF]/;
const INLINE_FORMULA_CHAR_PATTERN = /[A-Za-z0-9\\\u0370-\u03FF\u1F00-\u1FFF{}()[\]^_=+\-*/<>|~,:.;&\u00B7\u00D7\u00F7\u2208\u2209\u2200\u2203\u2205\u2211\u221E\u2248\u2260\u2264\u2265\u2282\u2283\u222A\u2229 ]/;
function stripTrailingLatexLabel(value) {
    return value.replace(/\s+latex\s*$/i, '').trim();
}
function looksLikeStandaloneFormulaLine(value) {
    const trimmed = stripTrailingLatexLabel(value.trim());
    if (!trimmed) {
        return false;
    }
    if (/^#{1,6}\s/.test(trimmed) ||
        /^[-*+]\s/.test(trimmed) ||
        /^\d+\.\s/.test(trimmed) ||
        /^>/.test(trimmed) ||
        trimmed.includes('|') ||
        /^<[^>]+>/.test(trimmed)) {
        return false;
    }
    if ((trimmed.startsWith('$$') && trimmed.endsWith('$$')) ||
        (trimmed.startsWith('$') && trimmed.endsWith('$')) ||
        (trimmed.startsWith('\\[') && trimmed.endsWith('\\]')) ||
        (trimmed.startsWith('\\(') && trimmed.endsWith('\\)'))) {
        return false;
    }
    if (/[\u4e00-\u9fff]/.test(trimmed)) {
        return false;
    }
    const plainWordMatches = trimmed.match(/\b(?!latex\b)(?!tag\b)(?!min\b)(?!max\b)(?!sum\b)(?!forall\b)(?!exists\b)(?!argmin\b)(?!argmax\b)[A-Za-z]{3,}\b/g) ?? [];
    if (plainWordMatches.length >= 3) {
        return false;
    }
    const hasLatexCommand = /\\[A-Za-z]+/.test(trimmed);
    const hasMathStructure = /[_^=]/.test(trimmed) ||
        /\\(?:tag|frac|sum|min|max|forall|exists|boldsymbol|mathrm|left|right|cdot|times|cup|cap|in)\b/.test(trimmed);
    const mathSymbolCount = (trimmed.match(/[\\_^=+\-*/()[\]{}<>|~]/g) ?? []).length;
    const symbolDensity = mathSymbolCount / Math.max(trimmed.length, 1);
    return hasLatexCommand && hasMathStructure && symbolDensity >= 0.08;
}
export function normalizeLatexExpression(value) {
    return stripTrailingLatexLabel(value)
        .replace(/\r\n?/g, '\n')
        .replace(/\\([A-Za-z]+)\s+\{/g, '\\$1{')
        .replace(/([_^])\s+\{/g, '$1{')
        .replace(/\s+([,.;:])/g, '$1')
        .replace(/\{\s+/g, '{')
        .replace(/\s+\}/g, '}')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}
function isInlineFormulaBoundary(value) {
    return (value == null ||
        value === '' ||
        /[\s\u4e00-\u9fff，。；：！？、（）【】《》“”‘’'"`[\](){}<>]/.test(value));
}
function looksLikeInlineFormulaSegment(value) {
    const trimmed = stripTrailingLatexLabel(value.trim());
    if (!trimmed || trimmed.length < 2) {
        return false;
    }
    if (/[\u4e00-\u9fff]/.test(trimmed) || /^https?:\/\//i.test(trimmed)) {
        return false;
    }
    if (/[?&][A-Za-z0-9_]+=/.test(trimmed)) {
        return false;
    }
    if ((trimmed.startsWith('$$') && trimmed.endsWith('$$')) ||
        (trimmed.startsWith('$') && trimmed.endsWith('$')) ||
        (trimmed.startsWith('\\[') && trimmed.endsWith('\\]')) ||
        (trimmed.startsWith('\\(') && trimmed.endsWith('\\)'))) {
        return false;
    }
    const hasLatexCommand = /\\[A-Za-z]+/.test(trimmed);
    const hasSubOrSup = /(?:^|[A-Za-z0-9)}\]])\s*[_^]\s*(?:\{[^{}]+\}|[A-Za-z0-9\\])/.test(trimmed);
    const hasMathOperator = /[=<>∈∉⊂⊃≤≥≈≠×·÷]/.test(trimmed) ||
        /\\(?:in|notin|subset|supset|forall|exists|times|cdot|sum|min|max|leq|geq|neq|approx|tag|cup|cap|to|rightarrow)\b/.test(trimmed);
    const hasMathSpacing = /~/.test(trimmed);
    const hasSymbolicVariable = /(?:^|[\s,(])(?:[A-Za-z\u0370-\u03FF\u1F00-\u1FFF](?:\s*[_^]\s*(?:\{[^{}]+\}|[A-Za-z0-9\u0370-\u03FF\u1F00-\u1FFF]))?)(?:[\s,),]|$)/.test(trimmed);
    const hasVariableRelation = /(?:^|[\s,(])(?:[A-Za-z\u0370-\u03FF\u1F00-\u1FFF](?:\s*[_^]\s*(?:\{[^{}]+\}|[A-Za-z0-9\u0370-\u03FF\u1F00-\u1FFF]))?)(?:\s*,\s*[A-Za-z\u0370-\u03FF\u1F00-\u1FFF](?:\s*[_^]\s*(?:\{[^{}]+\}|[A-Za-z0-9\u0370-\u03FF\u1F00-\u1FFF]))?)*\s*(?:=|<|>|∈|∉|⊂|⊃|≤|≥|≈|≠)/.test(trimmed);
    return (hasLatexCommand ||
        hasSubOrSup ||
        hasVariableRelation ||
        ((hasMathOperator || hasMathSpacing) && hasSymbolicVariable));
}
function wrapInlineLatexSegments(line) {
    if (!line.trim() || !/[\\_^=<>~∈∉⊂⊃≤≥≈≠×·÷]/.test(line)) {
        return line;
    }
    const protectedSegments = [];
    const protectedLine = line.replace(PROTECTED_MATH_PATTERN, (segment) => {
        const token = `\uE000${protectedSegments.length}\uE001`;
        protectedSegments.push(segment);
        return token;
    });
    let output = '';
    let index = 0;
    while (index < protectedLine.length) {
        const currentChar = protectedLine[index];
        if (!INLINE_FORMULA_START_PATTERN.test(currentChar)) {
            output += currentChar;
            index += 1;
            continue;
        }
        let end = index;
        while (end < protectedLine.length && INLINE_FORMULA_CHAR_PATTERN.test(protectedLine[end])) {
            end += 1;
        }
        const candidate = protectedLine.slice(index, end);
        if (candidate &&
            looksLikeInlineFormulaSegment(candidate) &&
            isInlineFormulaBoundary(protectedLine[index - 1]) &&
            isInlineFormulaBoundary(protectedLine[end])) {
            const leadingWhitespace = candidate.match(/^\s*/)?.[0] ?? '';
            const trailingWhitespace = candidate.match(/\s*$/)?.[0] ?? '';
            const normalized = normalizeLatexExpression(candidate.trim());
            output += `${leadingWhitespace}$${normalized}$${trailingWhitespace}`;
            index = end;
            continue;
        }
        output += currentChar;
        index += 1;
    }
    return output.replace(/\uE000(\d+)\uE001/g, (_, rawIndex) => protectedSegments[Number(rawIndex)] ?? '');
}
export function normalizeMarkdownMath(markdown) {
    if (!markdown.trim()) {
        return markdown;
    }
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const output = [];
    let mathFenceBuffer = null;
    let insideOtherFence = false;
    const flushMathFence = () => {
        if (!mathFenceBuffer) {
            return;
        }
        const expression = normalizeLatexExpression(mathFenceBuffer.join('\n'));
        if (expression) {
            output.push('$$');
            output.push(expression);
            output.push('$$');
        }
        mathFenceBuffer = null;
    };
    for (const line of lines) {
        const trimmed = line.trim();
        if (mathFenceBuffer) {
            if (CODE_FENCE_PATTERN.test(trimmed)) {
                flushMathFence();
            }
            else {
                mathFenceBuffer.push(line);
            }
            continue;
        }
        if (insideOtherFence) {
            output.push(line);
            if (CODE_FENCE_PATTERN.test(trimmed)) {
                insideOtherFence = false;
            }
            continue;
        }
        if (MATH_FENCE_START_PATTERN.test(trimmed)) {
            mathFenceBuffer = [];
            continue;
        }
        if (CODE_FENCE_PATTERN.test(trimmed)) {
            insideOtherFence = true;
            output.push(line);
            continue;
        }
        if (looksLikeStandaloneFormulaLine(trimmed)) {
            output.push('$$');
            output.push(normalizeLatexExpression(trimmed));
            output.push('$$');
            continue;
        }
        output.push(wrapInlineLatexSegments(line));
    }
    flushMathFence();
    return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function formatEmbeddingInput(text, inputFormat, role) {
  if (inputFormat === undefined || inputFormat === null || inputFormat === 'plain') {
    return text;
  }

  if (inputFormat !== 'query-passage') {
    throw new Error(`Unsupported embedding input format: ${inputFormat}`);
  }

  if (role !== 'query' && role !== 'passage') {
    throw new Error(`Unsupported embedding input role: ${role}`);
  }

  const prefix = `${role}:`;
  if (text.trimStart().toLowerCase().startsWith(prefix)) {
    return text;
  }

  return `${prefix} ${text}`;
}

module.exports = { formatEmbeddingInput };

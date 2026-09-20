import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyStructuredDocumentLanguage } from '../src/features/reader/readerLibraryTranslationBatch.ts';

function repeat(value: string, count: number): string {
  return Array.from({ length: count }, () => value).join(' ');
}

test('English structured text is eligible for the English-to-Chinese library batch', () => {
  const evidence = classifyStructuredDocumentLanguage({
    title: 'Agent-based modelling of resident and visitor conflict',
    texts: [
      repeat(
        'This study examines how visitors and residents negotiate the use of shared rural spaces, which can support research findings for planning and governance.',
        12,
      ),
    ],
  });

  assert.equal(evidence.language, 'english');
  assert.equal(evidence.hanCount, 0);
  assert.ok(evidence.latinCount >= 200);
});

test('a Chinese title fails closed even when the first structured block is an English abstract', () => {
  const evidence = classifyStructuredDocumentLanguage({
    title: '乡村旅游地居民与游客冲突研究',
    texts: [repeat('This English abstract explains the research design and findings.', 12)],
  });

  assert.equal(evidence.language, 'non-english');
  assert.ok(evidence.titleHanCount > 0);
});

test('a Chinese body with long English references is never classified as English', () => {
  const evidence = classifyStructuredDocumentLanguage({
    title: 'Tourism governance research',
    texts: [
      repeat('居民、游客与地方政府共同参与乡村旅游空间治理。', 30),
      repeat('Journal of Tourism Studies volume issue pages reference', 30),
    ],
  });

  assert.equal(evidence.language, 'non-english');
  assert.ok(evidence.hanCount >= 40);
});

test('short or script-poor content remains uncertain and is skipped', () => {
  const evidence = classifyStructuredDocumentLanguage({
    title: 'Model 2026',
    texts: ['1 + 2 = 3'],
  });

  assert.equal(evidence.language, 'unknown');
});

for (const sample of [
  {
    language: 'French',
    title: 'Gouvernance touristique dans les espaces ruraux',
    sentence:
      'Cette étude analyse les relations entre les résidents et les visiteurs dans les espaces ruraux avec une approche participative.',
  },
  {
    language: 'German',
    title: 'Tourismusgovernance in ländlichen Räumen',
    sentence:
      'Diese Studie untersucht die Beziehungen zwischen den Bewohnern und den Besuchern in ländlichen Räumen mit einer partizipativen Methode.',
  },
  {
    language: 'Spanish',
    title: 'Gobernanza turística en espacios rurales',
    sentence:
      'Este estudio analiza las relaciones entre los residentes y los visitantes en los espacios rurales con una metodología participativa.',
  },
]) {
  test(`${sample.language} structured text fails closed instead of being treated as English`, () => {
    const evidence = classifyStructuredDocumentLanguage({
      title: sample.title,
      texts: [repeat(sample.sentence, 16)],
    });

    assert.notEqual(evidence.language, 'english');
    assert.ok(evidence.wordCount >= 80);
    assert.ok(evidence.latinCount >= 200);
  });
}

for (const sample of [
  {
    language: 'French',
    title: 'Un exemple ambigu',
    text: repeat('an tourisme territoire visiteurs résidents gouvernance rurale', 16),
  },
  {
    language: 'German',
    title: 'Ein mehrdeutiges Beispiel',
    text: repeat('an Tourismus Raum Besucher Bewohner Planung ländlich', 16),
  },
  {
    language: 'Spanish',
    title: 'Un ejemplo ambiguo',
    text: repeat('paper turismo territorio visitantes residentes gobernanza rural', 16),
  },
]) {
  test(`${sample.language} text cannot become English by repeating one ambiguous loanword`, () => {
    const evidence = classifyStructuredDocumentLanguage({
      title: sample.title,
      texts: [sample.text],
    });

    assert.notEqual(evidence.language, 'english');
    assert.ok(evidence.wordCount >= 80);
  });
}

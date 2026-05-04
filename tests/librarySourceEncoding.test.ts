import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type SourceEncodingExpectation = {
  path: string;
  requiredSnippets: string[];
  forbiddenSnippets: string[];
};

const expectations: SourceEncodingExpectation[] = [
  {
    path: 'src-tauri/src/commands/library.rs',
    requiredSnippets: ['不支持的导入模式', '路径包含无法识别的字符', '无法打开文献库数据库'],
    forbiddenSnippets: [
      '\u{6fe1}\u{e09f}\u{5053}',
      '\u{9420}\u{56ea}\u{e1e7}\u{8930}\u{56e9}\u{62cb}\u{9353}',
      '\u{95ba}\u{581a}\u{5053}',
    ],
  },
  {
    path: 'src-tauri/src/commands/library/import.rs',
    requiredSnippets: ['PDF 已导入文献库', '检测到重复 PDF，已跳过导入', '请先在设置中配置默认文献存储文件夹'],
    forbiddenSnippets: [
      '\u{6fe1}\u{e09f}\u{5053}',
      '\u{9420}\u{56ea}\u{e1e7}\u{8930}\u{56e9}\u{62cb}\u{9353}',
      '\u{95ba}\u{581a}\u{5053}',
    ],
  },
  {
    path: 'src-tauri/src/commands/library/schema.rs',
    requiredSnippets: ['检查数据库表', '初始化文献库数据库失败', '全部文献', '最近导入', '未分类', '收藏'],
    forbiddenSnippets: [
      '\u{6fe1}\u{e09f}\u{5053}',
      '\u{95b8}\u{5fcb}\u{5291}\u{934e}\u{64ae}\u{5f2c}\u{9365}\u{2541}\u{76c0}',
      '\u{95ba}\u{581a}\u{5053}',
      '\u{95ba}\u{582b}\u{4e9c}\u{9368}',
    ],
  },
  {
    path: 'src-tauri/src/commands/library/settings.rs',
    requiredSnippets: ['读取设置', '保存设置', '读取文献库设置失败'],
    forbiddenSnippets: [
      '\u{9420}\u{56ea}\u{e1e7}\u{8930}\u{56e9}\u{62cb}\u{9353}',
      '\u{5a23}\u{56e8}\u{7e42}\u{9421}\u{3127}\u{62cb}\u{9353}',
      '\u{9420}\u{56ea}\u{e1e7}\u{8930}\u{56ec}\u{5f2c}\u{9365}\u{2541}\u{76c0}',
    ],
  },
];

for (const expectation of expectations) {
  test(`source text in ${expectation.path} stays readable`, () => {
    const source = readFileSync(expectation.path, 'utf8');

    for (const snippet of expectation.requiredSnippets) {
      assert.match(
        source,
        new RegExp(snippet),
        `expected ${expectation.path} to contain readable text: ${snippet}`,
      );
    }

    for (const snippet of expectation.forbiddenSnippets) {
      assert.doesNotMatch(
        source,
        new RegExp(snippet),
        `expected ${expectation.path} to exclude mojibake text: ${snippet}`,
      );
    }
  });
}

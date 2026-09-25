// tokenize 单元测试（development-refinement.md §11.1：引号 / 转义 / 空白边界）
//
// ⚠️ 关键区分：
//   - `tokenizeDetailed()` 是严格变体，语法错误（引号未闭合）返回 `ok: false`；
//   - `tokenize()` 是宽松变体，语法错误时**不报错**，改走 `tokenizeLenient()` 兜底。
// 因此凡是要断言「未闭合引号 = 错误」的用例，必须用 `tokenizeDetailed()`。

import { describe, expect, it } from 'vitest';
import { tokenize, tokenizeDetailed } from '../game/command/tokenize';

/** 便捷包装：只取 token 数组，断言失败时信息更直观 */
const tokensOf = (input: string): string[] => tokenize(input);

describe('tokenize —— 空白与边界', () => {
  it('连续空白只作一次分隔，首尾空白被吞掉', () => {
    expect(tokensOf('   git   add    .   ')).toEqual(['git', 'add', '.']);
  });

  it('制表符与换行同样视为分隔符', () => {
    expect(tokensOf('git\tadd\n.')).toEqual(['git', 'add', '.']);
  });

  it('空字符串切出零个 token', () => {
    expect(tokensOf('')).toEqual([]);
  });

  it('纯空白输入切出零个 token', () => {
    expect(tokensOf('   \t  ')).toEqual([]);
    // 严格变体也应是「成功但无 token」，而不是语法错误
    expect(tokenizeDetailed('   \t  ')).toEqual({ ok: true, tokens: [], spans: [] });
  });

  it('空引号产出一个空字符串 token（区分于「没有 token」）', () => {
    expect(tokensOf("git commit -m ''")).toEqual(['git', 'commit', '-m', '']);
    expect(tokensOf('""')).toEqual(['']);
    expect(tokensOf('""')).toHaveLength(1);
  });
});

describe('tokenize —— 引号', () => {
  it('单引号内空格不切分，且内容原样保留', () => {
    expect(tokensOf("git commit -m '初始 提交'")).toEqual(['git', 'commit', '-m', '初始 提交']);
  });

  it('单引号内反斜杠按字面保留：单引号内不转义', () => {
    // 单引号内的 `\n` 不是换行，就是两个字符：反斜杠 + n
    expect(tokensOf("git commit -m 'a\\nb'")).toEqual(['git', 'commit', '-m', 'a\\nb']);
  });

  it('双引号内 \\" 被解为字面双引号', () => {
    expect(tokensOf('git commit -m "say \\"hi\\""')).toEqual(['git', 'commit', '-m', 'say "hi"']);
  });

  it('双引号内 \\\\ 被解为单个反斜杠', () => {
    expect(tokensOf('echo "a\\\\b"')).toEqual(['echo', 'a\\b']);
  });

  it('双引号内其余反斜杠按字面保留（与 shell 一致）', () => {
    expect(tokensOf('echo "a\\nb"')).toEqual(['echo', 'a\\nb']);
  });

  it('相邻引号拼接进同一个 token', () => {
    expect(tokensOf(`git commit -m 'a'"b"`)).toEqual(['git', 'commit', '-m', 'ab']);
  });

  it('双引号内可含单引号，单引号内可含双引号', () => {
    expect(tokensOf(`echo "it's"`)).toEqual(['echo', "it's"]);
    expect(tokensOf(`echo 'say "hi"'`)).toEqual(['echo', 'say "hi"']);
  });
});

describe('tokenize —— 引号外转义', () => {
  it('反斜杠空格不切分，产出含空格的 token', () => {
    expect(tokensOf('git add my\\ file.txt')).toEqual(['git', 'add', 'my file.txt']);
  });

  it('反斜杠单引号产出字面单引号，且不开启引号段', () => {
    expect(tokensOf("echo \\'a\\'")).toEqual(['echo', "'a'"]);
  });

  it('反斜杠双引号产出字面双引号', () => {
    expect(tokensOf('echo \\"hi\\"')).toEqual(['echo', '"hi"']);
  });
});

describe('tokenize —— 语法错误（必须用 tokenizeDetailed）', () => {
  it('单引号未闭合返回 ok: false 与中文报错', () => {
    const result = tokenizeDetailed("git commit -m '未闭合");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('存在未闭合的单引号。');
    }
  });

  it('双引号未闭合返回 ok: false 与中文报错', () => {
    const result = tokenizeDetailed('git commit -m "未闭合');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('存在未闭合的双引号。');
    }
  });

  it('输入以孤立反斜杠结尾视为错误', () => {
    const result = tokenizeDetailed('git add ');
    // 上一行末尾无反斜杠，此处显式构造「以反斜杠结尾」的输入
    expect(result.ok).toBe(true);

    const trailing = tokenizeDetailed('git add foo\\');
    expect(trailing.ok).toBe(false);
    if (!trailing.ok) {
      expect(trailing.error).toBe('命令末尾的反斜杠缺少可转义的字符。');
    }
  });

  it('tokenize() 是宽松变体：未闭合引号时静默兜底，不返回错误', () => {
    // 宽松变体会把未闭合引号之后的内容整体当作字面量收尾
    const lenient = tokenize('git commit -m "未闭合 信息');
    expect(lenient).toEqual(['git', 'commit', '-m', '未闭合 信息']);
  });
});

describe('tokenize —— spans 偏移（供 M4 半拼高亮复用）', () => {
  it('每个 token 带上在原始输入中的起止下标', () => {
    const result = tokenizeDetailed('git add a.txt');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.spans).toEqual([
      { value: 'git', start: 0, end: 3 },
      { value: 'add', start: 4, end: 7 },
      { value: 'a.txt', start: 8, end: 13 },
    ]);
  });

  it('含引号的 token：span 覆盖引号，value 为去引号后的字面量', () => {
    const result = tokenizeDetailed("git commit -m '初始 提交'");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const source = "git commit -m '初始 提交'";
    const last = result.spans[result.spans.length - 1];
    expect(last.value).toBe('初始 提交');
    // `git commit -m ` 共 14 个字符，故 span 从下标 14 开始、到 21（原串末尾，不含）结束
    expect(last.start).toBe(14);
    expect(last.end).toBe(21);
    // span 切片回原文时应含两侧引号
    expect(source.slice(last.start, last.end)).toBe("'初始 提交'");
  });

  it('tokens 与 spans 一一对应', () => {
    const result = tokenizeDetailed('git   add   "a b"');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.tokens).toEqual(result.spans.map((span) => span.value));
  });
});

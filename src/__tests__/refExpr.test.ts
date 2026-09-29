// ref 表达式解析单元测试（M5a，第五章「时空回溯」的关键路径）
//
// 价值：isomorphic-git 的 `resolveRef` **完全不支持** `HEAD~1` / `HEAD@{0}` / 短 hash
// （探针逐一实测，见 docs/milestones/M5-tasks.md §六 第 9 条），故这一层必须自研。
// 它是纯函数 —— 解析对不对可以在此穷举，不必起沙箱；对象图遍历由 gitApi 按下述
// `steps` 执行（那部分由 executor.test.ts 的真实链路覆盖）。
//
// ⚠️ 回归锁：早期实现用「边扫边解析」的循环，首字符是普通字母时立刻 break，
//    index 停在 0，base 变成空串 —— 表现为**所有普通分支名**（main / feature）
//    都被判为「缺少基础名称」。这是真实发生过的缺陷，下面的用例是它的回归锁。

import { describe, expect, it } from 'vitest';
import { formatRefExpr, isPlausibleRefBase, looksLikeHash, parseRefExpr } from '../engine/refExpr';

/** 便捷包装：成功时取回结构化表达式，失败时抛错（断言失败信息更直观） */
function parsed(input: string) {
  const result = parseRefExpr(input);
  if (!result.ok) throw new Error(`解析 ${input} 失败：${result.error}`);
  return result.ref;
}

describe('refExpr —— 基础名称（无后缀）', () => {
  it('普通分支名解析为基础引用且无后缀（回归锁：曾被误判为「缺少基础名称」）', () => {
    expect(parsed('main')).toEqual({ base: 'main', steps: [] });
    expect(parsed('feature')).toEqual({ base: 'feature', steps: [] });
    expect(parsed('feature/nested-name')).toEqual({ base: 'feature/nested-name', steps: [] });
  });

  it('HEAD 与完整引用名原样保留', () => {
    expect(parsed('HEAD')).toEqual({ base: 'HEAD', steps: [] });
    expect(parsed('refs/heads/main')).toEqual({ base: 'refs/heads/main', steps: [] });
  });

  it('短 hash 与完整 hash 作为基础名（是否唯一由执行层 expandOid 判定）', () => {
    expect(parsed('a1b2c3d')).toEqual({ base: 'a1b2c3d', steps: [] });
    const full = 'a'.repeat(40);
    expect(parsed(full)).toEqual({ base: full, steps: [] });
  });
});

describe('refExpr —— ~n 沿第一父回溯', () => {
  it('~1 / ~2 解析为 parent 步骤', () => {
    expect(parsed('HEAD~1')).toEqual({ base: 'HEAD', steps: [{ kind: 'parent', n: 1 }] });
    expect(parsed('HEAD~2')).toEqual({ base: 'HEAD', steps: [{ kind: 'parent', n: 2 }] });
    expect(parsed('main~3')).toEqual({ base: 'main', steps: [{ kind: 'parent', n: 3 }] });
  });

  it('裸 ~ 等价于 ~1（真 git 语义）', () => {
    expect(parsed('HEAD~')).toEqual({ base: 'HEAD', steps: [{ kind: 'parent', n: 1 }] });
  });

  it('多个后缀按出现顺序排列', () => {
    expect(parsed('HEAD~1~2')).toEqual({
      base: 'HEAD',
      steps: [
        { kind: 'parent', n: 1 },
        { kind: 'parent', n: 2 },
      ],
    });
  });
});

describe('refExpr —— ^n 取第 n 个父提交', () => {
  it('裸 ^ 等价于 ^1（第一父）', () => {
    expect(parsed('HEAD^')).toEqual({ base: 'HEAD', steps: [{ kind: 'nth-parent', n: 1 }] });
  });

  it('^2 取合并提交的第二父', () => {
    expect(parsed('HEAD^2')).toEqual({ base: 'HEAD', steps: [{ kind: 'nth-parent', n: 2 }] });
  });

  it('^0 在真 git 里指提交自身，等价于不加后缀', () => {
    expect(parsed('HEAD^0')).toEqual({ base: 'HEAD', steps: [] });
  });

  it('~ 与 ^ 混用', () => {
    expect(parsed('HEAD~2^2')).toEqual({
      base: 'HEAD',
      steps: [
        { kind: 'parent', n: 2 },
        { kind: 'nth-parent', n: 2 },
      ],
    });
  });
});

describe('refExpr —— @{n} reflog 条目', () => {
  it('@{0} / @{1} 解析为 reflog 步骤', () => {
    expect(parsed('HEAD@{0}')).toEqual({ base: 'HEAD', steps: [{ kind: 'reflog', n: 0 }] });
    expect(parsed('HEAD@{1}')).toEqual({ base: 'HEAD', steps: [{ kind: 'reflog', n: 1 }] });
    expect(parsed('HEAD@{12}')).toEqual({ base: 'HEAD', steps: [{ kind: 'reflog', n: 12 }] });
  });

  it('reflog 后缀可与 ~ 组合（求值顺序 = 从左到右）', () => {
    expect(parsed('HEAD@{0}~1')).toEqual({
      base: 'HEAD',
      steps: [
        { kind: 'reflog', n: 0 },
        { kind: 'parent', n: 1 },
      ],
    });
  });
});

describe('refExpr —— 明确拒绝的写法（§14：说清「不支持」而非抛莫名其妙的错）', () => {
  it('空串被拒绝', () => {
    const result = parseRefExpr('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('不能为空');
  });

  it('@{ 缺少配对花括号', () => {
    const result = parseRefExpr('HEAD@{0');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('配对');
  });

  it('@{非数字} 被拒绝', () => {
    // ⚠️ `@{abc}` 会先命中「@{upstream} / @{push} 这类引用」的通配判据（`@{` 后跟字母），
    // 报「不支持」而非「序号必须是非负整数」—— 两者都是明确拒绝，此处只断言被拒。
    for (const input of ['HEAD@{abc}', 'HEAD@{1.5}', 'HEAD@{-1}']) {
      const result = parseRefExpr(input);
      expect(result.ok).toBe(false);
    }
    // 纯数字但非整数语义的（如带符号）走「非负整数」分支
    const result = parseRefExpr('HEAD@{ }');
    expect(result.ok).toBe(false);
  });

  it('@{upstream} 等具名引用明确报「不支持」', () => {
    for (const input of ['HEAD@{upstream}', 'main@{push}']) {
      const result = parseRefExpr(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('不支持');
    }
  });

  it('^{...} 对象类型限定明确报「不支持」', () => {
    const result = parseRefExpr('HEAD^{commit}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('不支持');
  });

  it('^@ 所有父提交明确报「不支持」', () => {
    const result = parseRefExpr('HEAD^@');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('不支持');
  });

  it(':/<文本> 搜索语法明确报「不支持」', () => {
    const result = parseRefExpr(':/修复登录');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('不支持');
  });

  it('~0 非法（真 git 的 ~0 无意义，本版本拒绝而非猜测）', () => {
    const result = parseRefExpr('HEAD~0');
    expect(result.ok).toBe(false);
  });

  it('以 - 开头的写法不会被当成引用', () => {
    expect(isPlausibleRefBase('-abc')).toBe(false);
  });
});

describe('refExpr —— 辅助函数', () => {
  it('looksLikeHash 只认 4~40 位十六进制', () => {
    expect(looksLikeHash('a1b2c3d')).toBe(true);
    expect(looksLikeHash('a'.repeat(40))).toBe(true);
    expect(looksLikeHash('abc')).toBe(false); // 太短
    expect(looksLikeHash('a'.repeat(41))).toBe(false); // 太长
    expect(looksLikeHash('main')).toBe(false); // g/n 不是十六进制字符
    expect(looksLikeHash('HEAD')).toBe(false);
  });

  it('isPlausibleRefBase 拒绝空串 / 空白 / - 开头 / 含 ..', () => {
    expect(isPlausibleRefBase('main')).toBe(true);
    expect(isPlausibleRefBase('HEAD~1')).toBe(true); // 后缀不算基础名的问题
    expect(isPlausibleRefBase('')).toBe(false);
    expect(isPlausibleRefBase('a b')).toBe(false);
    expect(isPlausibleRefBase('-x')).toBe(false);
    expect(isPlausibleRefBase('a..b')).toBe(false);
  });

  it('formatRefExpr 能把解析结果还原成规范文本（报错与回显用）', () => {
    for (const input of ['main', 'HEAD', 'HEAD~1', 'HEAD~2', 'HEAD^1', 'HEAD^2', 'HEAD@{0}', 'HEAD@{3}']) {
      expect(formatRefExpr(parsed(input))).toBe(input);
    }
    // 裸 ^ / ~ 会被规范化成 ^1 / ~1（与真 git 的等价写法一致）
    expect(formatRefExpr(parsed('HEAD^'))).toBe('HEAD^1');
    expect(formatRefExpr(parsed('HEAD~'))).toBe('HEAD~1');
  });
});

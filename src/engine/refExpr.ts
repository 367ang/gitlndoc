/**
 * ref 表达式解析（M5a，第五章「时空回溯」的关键路径）。
 *
 * ── 为什么必须自研 ──────────────────────────────────────────────────────
 *
 * 探针实测（M5a 阶段 1，见 docs/milestones/M5-tasks.md §六 第 9 条）：
 * isomorphic-git 的 `resolveRef` **只认完整引用**（`HEAD` / `main` / `refs/heads/main`），
 * 对以下写法**一律抛 `NotFoundError`**：
 *
 * | 写法 | 真 git 含义 | resolveRef | expandRef |
 * |---|---|---|---|
 * | `HEAD~1` | HEAD 的第一个父提交 | ❌ NotFoundError | ❌ NotFoundError |
 * | `HEAD~2` | 第一个父的父 | ❌ | ❌ |
 * | `HEAD^` | 同 `HEAD~1` | ❌ | ❌ |
 * | `HEAD@{0}` | reflog 第 0 条 | ❌ | ❌ |
 * | 短 hash `b7416e8` | 唯一前缀匹配 | ❌ | ❌（`expandOid` 可，见下） |
 *
 * 而笔记 `docs/notes/git-undo.md` 的核心命令恰恰是这些写法：
 *   - `git reset --soft HEAD~1`（撤销提交）
 *   - `git reset --hard HEAD@{n}`（从 reflog 恢复）
 *
 * 不做这一层，第五章就无法照笔记操作 —— 这不是「锦上添花」，是章节可玩性的前提。
 *
 * ── 分层职责（§2）──────────────────────────────────────────────────────
 *
 * 本模块是**纯函数**：把 ref 字符串拆成「基础引用 + 一串后缀操作」，
 * 不做任何 IO、不 import gitApi / fs。真正的对象图遍历由调用方（`gitApi`）按
 * 解析出的步骤执行 —— 这样「解析对不对」可以被单测穷举覆盖，不必起沙箱。
 *
 * ── 支持的语法子集（超出即明确拒绝，不猜）──────────────────────────────
 *
 * ```
 * <ref-expr>  := <base> <suffix>*
 * <base>      := HEAD | <branch> | <full-ref> | <short-hash> | <full-hash>
 * <suffix>    := '~' <n>?      # 沿第一父回溯 n 次（n 缺省为 1）
 *              | '^' <n>?      # n 缺省/0 = 第一父；n>=1 = 第 n 个父（合并提交用）
 *              | '@{' <n> '}'  # reflog 第 n 条（0 = 最近一次）
 * ```
 *
 * 不支持（明确报「本版本不支持」，§14 不伪造）：`^@` / `^{commit}` / `^{tree}` /
 * `:/<text>` 搜索语法、`@{upstream}` / `@{push}` / `@{<date>}`。
 */

/** 一个后缀操作；调用方按序在提交图上求值 */
export type RefStep =
  /** 沿第一父回溯 n 次（真 git 的 `~n`） */
  | { kind: 'parent'; n: number }
  /** 取第 n 个父（真 git 的 `^n`；n=1 即第一父） */
  | { kind: 'nth-parent'; n: number }
  /** reflog 第 n 条（真 git 的 `@{n}`） */
  | { kind: 'reflog'; n: number };

/** 解析成功的 ref 表达式 */
export interface ParsedRef {
  /** 基础引用：分支名 / `HEAD` / 完整 ref / 提交 hash（原样保留，交由调用方 resolve） */
  base: string;
  /** 按序求值的后缀操作；无后缀时为空数组（等价于真 git 的裸 ref） */
  steps: RefStep[];
}

/** 解析结果：成功给出结构化表达式，失败给出面向玩家的中文原因 */
export type ParseRefResult =
  | { ok: true; ref: ParsedRef }
  | { ok: false; error: string };

/** 明确不支持的语法及其提示（§14：说清「不支持」，而不是抛一个莫名其妙的 NotFoundError） */
const UNSUPPORTED_PATTERNS: readonly { test: RegExp; describe: string }[] = [
  { test: /\^@/, describe: '^@（所有父提交）' },
  { test: /\^\{/, describe: '^{...}（对象类型限定）' },
  { test: /^:/, describe: ':/<文本>（提交信息搜索）' },
  { test: /@\{[a-zA-Z]/, describe: '@{upstream} / @{push} 这类引用' },
];

/** 一个字符串是否可能是提交 hash（全 16 进制，4~40 位） */
export function looksLikeHash(text: string): boolean {
  return /^[0-9a-f]{4,40}$/i.test(text);
}

/**
 * 解析 ref 表达式。
 *
 * @example
 * ```ts
 * parseRefExpr('HEAD~1');    // → { base: 'HEAD', steps: [{ kind: 'parent', n: 1 }] }
 * parseRefExpr('main');      // → { base: 'main', steps: [] }
 * parseRefExpr('HEAD@{2}');  // → { base: 'HEAD', steps: [{ kind: 'reflog', n: 2 }] }
 * parseRefExpr('a1b2c3d');   // → { base: 'a1b2c3d', steps: [] }（短 hash 由调用方 expandOid）
 * ```
 */
export function parseRefExpr(input: string): ParseRefResult {
  const text = input.trim();
  if (text.length === 0) return { ok: false, error: '引用名不能为空。' };

  for (const { test, describe } of UNSUPPORTED_PATTERNS) {
    if (test.test(text)) {
      return { ok: false, error: `本版本不支持 ${describe} 这种引用写法。` };
    }
  }

  // `@{n}` 与 `~n` / `^n` 在字符串里可能交替出现（如 `HEAD~1@{0}`），
  // 真 git 允许但写法极罕见；这里按**出现顺序**从左到右切分，保持与真 git 一致的求值顺序。
  const steps: RefStep[] = [];

  // 基础部分 = 第一个 `~` / `^` / `@{` 之前的全部字符。
  // ⚠️ 必须先切出基础段再循环解析后缀：若直接用「边扫边解析」的循环，
  // 首字符是普通字母时会立刻 break，index 停在 0，base 变成空串 —— 实测缺陷
  // （表现为所有普通分支名 `main` / `feature` 都被判为「缺少基础名称」）。
  const baseEnd = findBaseEnd(text);
  const base = text.slice(0, baseEnd);
  if (base.length === 0) {
    return { ok: false, error: `引用 ${text} 缺少基础名称（如 HEAD、main 或提交 hash）。` };
  }

  let index = baseEnd;
  while (index < text.length) {
    const rest = text.slice(index);

    if (rest.startsWith('@{')) {
      const close = rest.indexOf('}');
      if (close < 0) return { ok: false, error: `引用 ${text} 的 @{ 缺少配对的 }。` };
      const inner = rest.slice(2, close);
      // ⚠️ 必须先用**纯数字正则**校验再转数：`Number(' ')` 是 0、`Number('')` 是 0，
      // 直接 `Number.isInteger(Number(inner))` 会把 `@{ }` / `@{}` 静默当成 `@{0}`
      // （实测缺陷）。纯数字正则同时排除了 `1.5` / `-1` / `+1` 这些非序号写法。
      if (!/^\d+$/.test(inner.trim())) {
        return { ok: false, error: `@{${inner}} 中的序号必须是非负整数。` };
      }
      const n = Number(inner.trim());
      steps.push({ kind: 'reflog', n });
      index += close + 1;
      continue;
    }

    if (rest.startsWith('~') || rest.startsWith('^')) {
      const kind: RefStep['kind'] = rest[0] === '~' ? 'parent' : 'nth-parent';
      const match = /^[~^](\d*)/.exec(rest);
      const digits = match?.[1] ?? '';
      const n = digits.length === 0 ? 1 : Number(digits);
      // `HEAD^0` 在真 git 里指提交自身（`^0` = 该提交），语义上等价于不加后缀
      if (kind === 'nth-parent' && n === 0) {
        index += 1 + digits.length;
        continue;
      }
      if (n < 1) {
        return { ok: false, error: `引用 ${text} 的 ~ / ^ 后面需要跟上正整数。` };
      }
      steps.push({ kind, n });
      index += 1 + digits.length;
      continue;
    }

    return { ok: false, error: `引用 ${text} 的写法不被支持。` };
  }

  if (/[\s~^@{]/.test(base)) {
    return { ok: false, error: `引用 ${text} 的基础名称不合法。` };
  }

  return { ok: true, ref: { base, steps } };
}

/** 找基础名称的结束位置：第一个 `~` / `^` / `@{` 的起点；都没有则为串长 */
function findBaseEnd(text: string): number {
  let end = text.length;
  for (const marker of ['~', '^']) {
    const at = text.indexOf(marker);
    if (at >= 0 && at < end) end = at;
  }
  const atBrace = text.indexOf('@{');
  if (atBrace >= 0 && atBrace < end) end = atBrace;
  return end;
}

/**
 * 该表达式是否「可能指代一个提交」—— 供语法层做早期校验。
 * 只排除明显非法的形态（如以 `-` 开头），不下结论说它一定存在。
 */
export function isPlausibleRefBase(base: string): boolean {
  if (base.length === 0) return false;
  if (base.startsWith('-')) return false;
  if (/\s/.test(base)) return false;
  if (base.includes('..')) return false;
  return true;
}

/**
 * 把解析出的表达式还原成规范文本（用于报错与回显，保证玩家看到的就是真 git 的写法）。
 */
export function formatRefExpr(ref: ParsedRef): string {
  let text = ref.base;
  for (const step of ref.steps) {
    if (step.kind === 'parent') text += `~${step.n}`;
    else if (step.kind === 'nth-parent') text += `^${step.n}`;
    else text += `@{${step.n}}`;
  }
  return text;
}

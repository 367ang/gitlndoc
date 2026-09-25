/**
 * 命令行 token 化（development-refinement.md §6.3.1）。
 *
 * 按 POSIX shell 的引号 / 转义规则把玩家输入切成 token 数组：
 *   - 空白（空格 / 制表符 / 换行）分隔 token，首尾与连续空白都被吞掉；
 *   - 单引号 `'...'` 内部一切字面量，**不**支持转义，遇下一个 `'` 即闭合；
 *   - 双引号 `"..."` 内部保留字面量，但支持 `\"` `\\` 两个转义；
 *   - 引号之外 `\x` 使 `x` 成为字面量（`\ ` → 空格，`\'` → 单引号）；
 *   - 空引号 `''` / `""` 会产出一个**空字符串 token**（区分于「没有 token」）；
 *   - 引号未闭合属语法错误，返回 `ok: false`，绝不静默吞掉。
 *
 * 本模块是**纯函数**：无副作用、不 import 任何执行层或 UI 依赖。
 *
 * ⚠️ 关于半拼模式（§6.3 末尾）：M1 只处理自由输入。半拼模式的「残缺 token 高亮」
 * 属 M4，且**不应**在此实现 —— 高亮残缺 token 需要的是「切分并对每个 token 记录
 * 起止偏移」，而不是把残缺输入当作 tokenize 错误。因此这里预留了
 * `TokenSpan`（含 `start` / `end` 偏移）与 `tokenizeDetailed().spans`：
 * M4 可直接在其上叠加逐 token 的校验与高亮，无需改动切分逻辑本身。
 */

/** 单个 token 及其在原始输入中的位置（供 M4 的半拼高亮复用） */
export interface TokenSpan {
  /** token 的最终字面量（已去除引号、已解转义） */
  value: string;
  /** token 在原始输入中的起始下标 */
  start: number;
  /** token 在原始输入中的结束下标（不含） */
  end: number;
}

/** `tokenizeDetailed` 的返回结构：成功带 tokens，失败带错误信息 */
export type TokenizeResult =
  | { ok: true; tokens: string[]; spans: TokenSpan[] }
  | { ok: false; error: string; tokens: []; spans: [] };

/** 未闭合引号等语法错误的统一文案（对齐真实 shell 的提示风格） */
const UNCLOSED_SINGLE_QUOTE = '存在未闭合的单引号。';
const UNCLOSED_DOUBLE_QUOTE = '存在未闭合的双引号。';
/** 输入以孤立反斜杠结尾（该反斜杠转义了「什么都没有」） */
const TRAILING_BACKSLASH = '命令末尾的反斜杠缺少可转义的字符。';

/** 是否需要把字符视为 token 分隔的空白（与 shell 的 IFS 默认值一致） */
function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f' || char === '\v';
}

/**
 * 把输入切成 token，并保留每个 token 的原始偏移。
 *
 * 这是切分逻辑的唯一实现，`tokenize()` / `tokenizeDetailed()` 都转调它。
 */
export function tokenizeDetailed(input: string): TokenizeResult {
  const tokens: string[] = [];
  const spans: TokenSpan[] = [];

  // 当前 token 的字面量缓冲；null 表示「尚未开始任何 token」。
  // 用 null 而非 '' 是为了区分 `''`（产出空 token）与「无 token」。
  // 注：缓冲经闭包内的 `beginToken` / `endToken` 改写，故不依赖 TS 的控制流收窄
  // （函数体内的赋值不会被外层流分析追踪），改为显式断言。
  let buffer: string | null = null;
  let tokenStart = 0;

  const beginToken = (index: number): void => {
    if (buffer === null) {
      buffer = '';
      tokenStart = index;
    }
  };

  /** 直接向缓冲追加字面量；调用前需确保 token 已开始 */
  const append = (text: string): void => {
    buffer = (buffer ?? '') + text;
  };

  const endToken = (index: number): void => {
    if (buffer !== null) {
      const value: string = buffer;
      tokens.push(value);
      spans.push({ value, start: tokenStart, end: index });
      buffer = null;
    }
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    // --- 引号外：空白分隔 token ---
    if (isWhitespace(char)) {
      endToken(i);
      continue;
    }

    // --- 单引号：内部不转义，找下一个 `'` ---
    if (char === "'") {
      beginToken(i);
      const close = input.indexOf("'", i + 1);
      if (close === -1) return { ok: false, error: UNCLOSED_SINGLE_QUOTE, tokens: [], spans: [] };
      append(input.slice(i + 1, close));
      i = close; // 循环末尾再 +1，跳过闭合引号
      continue;
    }

    // --- 双引号：内部支持 `\"` 与 `\\` ---
    if (char === '"') {
      beginToken(i);
      let closed = false;
      let j = i + 1;
      for (; j < input.length; j += 1) {
        const inner = input[j];
        if (inner === '\\') {
          const next = input[j + 1];
          // 仅 `\"` 与 `\\` 是转义；`\` 后跟其他字符时反斜杠按字面保留（与 shell 一致）
          if (next === '"' || next === '\\') {
            append(next);
            j += 1;
            continue;
          }
          append(inner);
          continue;
        }
        if (inner === '"') {
          closed = true;
          break;
        }
        append(inner);
      }
      if (!closed) return { ok: false, error: UNCLOSED_DOUBLE_QUOTE, tokens: [], spans: [] };
      i = j; // 跳过闭合引号
      continue;
    }

    // --- 反斜杠转义：使下一个字符成为字面量 ---
    if (char === '\\') {
      const next = input[i + 1];
      if (next === undefined) return { ok: false, error: TRAILING_BACKSLASH, tokens: [], spans: [] };
      beginToken(i);
      append(next);
      i += 1; // 跳过被转义的字符
      continue;
    }

    // --- 普通字符 ---
    beginToken(i);
    append(char);
  }

  endToken(input.length);
  return { ok: true, tokens, spans };
}

/**
 * 把输入切成 token 数组。
 *
 * ⚠️ 语法错误（引号未闭合）时返回**已切分出的部分 token**，不抛异常 ——
 * 便于调用方（如 M4 的实时高亮）在残缺输入上仍能拿到可用片段。
 * 需要区分「成功」与「语法错误」时请改用 `tokenizeDetailed()`。
 */
export function tokenize(input: string): string[] {
  const result = tokenizeDetailed(input);
  if (result.ok) return result.tokens;
  // 出错时用宽松模式重切一遍：丢弃未闭合的引号影响，返回已完成的 token
  return tokenizeLenient(input);
}

/**
 * 宽松切分：只按空白与引号边界切分，遇未闭合引号时把剩余内容整体当作普通文本。
 * 仅供 `tokenize()` 在语法错误时兜底，以及 UI 的即时回显使用。
 */
function tokenizeLenient(input: string): string[] {
  const tokens: string[] = [];
  let buffer: string | null = null;
  const flush = (): void => {
    if (buffer !== null) {
      tokens.push(buffer);
      buffer = null;
    }
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (isWhitespace(char)) {
      flush();
      continue;
    }
    if (char === "'" || char === '"') {
      if (buffer === null) buffer = '';
      const close = input.indexOf(char, i + 1);
      if (close === -1) {
        // 未闭合：把引号之后的全部内容当字面量收尾
        buffer += input.slice(i + 1);
        i = input.length;
        continue;
      }
      buffer += input.slice(i + 1, close);
      i = close;
      continue;
    }
    if (char === '\\' && i + 1 < input.length) {
      if (buffer === null) buffer = '';
      buffer += input[i + 1];
      i += 1;
      continue;
    }
    if (buffer === null) buffer = '';
    buffer += char;
  }

  flush();
  return tokens;
}

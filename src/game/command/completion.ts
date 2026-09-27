/**
 * Tab 补全候选（development-refinement.md §9.1「Tab 补全（半拼模式补全已暴露部分）」）。
 *
 * 纯函数层（§2）：不碰 fs / gitApi / React —— 候选由调用方（UI 容器）采集后传入，
 * 本模块只做「当前输入 → 补全候选」的匹配。
 *
 * ⚠️ 候选的三类来源（由 LevelScreen 采集）：
 *   1. 命令动词与常用旗标 —— 白名单常量（COMPLETION_WORDS）；
 *   2. 当前分支名 —— 容器经 executor 执行 `git branch` 解析输出获得
 *      （UI 层不直连 gitApi，维持「UI → executor」单通道，见 useFileTree 同款取舍）；
 *   3. 工作区文件路径 —— 容器经 `git status --short` 解析获得。
 *
 * 只在光标位于行尾（最后一个 token）时生效 —— 中途补全会把命令搅乱。
 */

/** 命令补全白名单：动词 + 高频旗标（M4 子命令全集） */
export const COMPLETION_WORDS: readonly string[] = [
  'init',
  'add',
  'commit',
  'status',
  'diff',
  'log',
  'branch',
  'checkout',
  'switch',
  'merge',
  'rebase',
  'rm',
  '-m',
  '-s',
  '-b',
  '-c',
  '--staged',
  '--oneline',
  '--all',
  '--cached',
  '.',
];

/** Tab 补全的输入 */
export interface CompletionInput {
  /** 当前输入行全文 */
  input: string;
  /** 候选词（分支名 / 文件路径 / 白名单）——调用方按需合并去重 */
  candidates: readonly string[];
}

/** 补全结果：替换「最后一个 token」的候选列表 */
export interface CompletionResult {
  /** 最后一个 token（被补全的部分） */
  prefix: string;
  /** 所有以 prefix 开头的候选（已排序；prefix 为空串时 = 全部候选） */
  matches: string[];
}

/**
 * 计算 Tab 补全候选。
 *
 * @returns prefix 为空串且 matches 为空 = 无可补全（不该弹出任何东西）
 */
export function completeAtEnd({ input, candidates }: CompletionInput): CompletionResult {
  // 判定「正在打第几个 token」用**原始 input**（尾空格是有意义的 —— 表示刚完成一个 token）；
  // prefix 匹配范围也用原始输入的最后一段。
  const trimmed = input.replace(/\s+$/, '');
  const lastSpace = input.lastIndexOf(' ');
  const prefix = lastSpace < 0 ? trimmed : input.slice(lastSpace + 1);

  if (trimmed.length === 0) {
    // 空输入：第一个 token 只可能是 git（grammar 的硬前提）
    return { prefix: '', matches: ['git'] };
  }

  const pool = ['git', ...candidates, ...COMPLETION_WORDS];
  const matches = [...new Set(pool)]
    .filter((word) => word.startsWith(prefix) && word !== prefix)
    .sort();
  return { prefix, matches };
}

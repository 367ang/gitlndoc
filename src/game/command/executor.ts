/**
 * 命令执行编排（development-refinement.md §6.3.3）。
 *
 * 把 tokenize → grammar → gitApi 串起来，并把执行层的业务异常
 * （`GitCommandError` / `GitUnsupportedError`）转成面向学习者的中文报错。
 *
 * 分层职责（§2）：
 *   - 本层是 game service 的编排者，**不含评分逻辑**（属 `game/scoring/`，M3）；
 *   - 一切 git 操作都经 `gitApi.*`，本层不直接触碰 fs / isomorphic-git；
 *   - 返回结构刻意贴近 `CommandEntry`（§4.4），UI 只需补 id / input / tokens / ts。
 *
 * ⚠️ 关于「undoable」：§6.2 规定撤销类命令（reset / revert / checkout --）才记
 * `undoable`，且这些命令全部属 M4/M5，在 M1 子集之外。故 M1 恒为 false ——
 * 保留该字段是为了 M5 接入时 UI 与评分无需改签名。
 *
 * ⚠️ M1 只处理自由输入（`free`）。半拼模式的残缺 token 高亮属 M4，不在本层实现。
 */

import type { CommandEntry } from '../types';
import {
  add as gitAdd,
  commit as gitCommit,
  init as gitInit,
  log as gitLog,
  remove as gitRemove,
  status as gitStatus,
  unsupported,
  type CommitEntry,
  type RepoOptions,
  type StatusSummary,
} from '../../engine/gitApi';
import type { GitCommandError, GitResult } from '../../engine/errors';
import { parse, type ParsedCommand } from './grammar';
import { tokenizeDetailed } from './tokenize';

/**
 * `execute()` 的返回结构。
 *
 * 与 `CommandEntry`（§4.4）的字段刻意对齐：UI 只需补上 `id` / `input` / `ts`，
 * `tokens` 已在此返回，可直接构造完整条目。
 */
export interface ExecuteResult {
  /** 是否执行成功（语法错误、不支持、git 报错均为 false） */
  ok: boolean;
  /** tokenize 结果；即使语法报错也返回已切分出的部分 token，便于 UI 回显 */
  tokens: string[];
  /** stdout 行：供终端面板逐行渲染 */
  output: string[];
  /** stderr：面向学习者的中文报错，仅在 ok 为 false 时出现 */
  error?: string;
  /** 是否触发撤销类评分事件（§6.2）；M1 恒 false，为 M5 预留 */
  undoable: boolean;
}

/** 执行时可选的仓库位置（默认由 gitApi 指向沙箱 `/repo`） */
export interface ExecuteOptions extends RepoOptions {
  /** 覆盖默认仓库目录，主要用于测试注入 */
  dir?: string;
}

/** 组装成功结果 */
function succeed(tokens: string[], output: string[]): ExecuteResult {
  return { ok: true, tokens, output, undoable: false };
}

/** 组装失败结果 */
function failWith(tokens: string[], error: string): ExecuteResult {
  return { ok: false, tokens, output: [], error, undoable: false };
}

/** 把业务异常渲染成终端可读文本；优先用 `toString()`（含 hint），退回 `message` */
function renderError(error: GitCommandError): string {
  try {
    return error.toString();
  } catch {
    return error.message;
  }
}

/**
 * 解包 `GitResult<T>`：成功取值，失败转成 `ExecuteResult`。
 * gitApi 的所有返回值都经由此处，避免「拿到 GitResult 却当裸值用」。
 */
function unwrap<T>(
  result: GitResult<T>,
  tokens: string[],
  onValue: (value: T) => ExecuteResult,
): ExecuteResult {
  if (!result.ok) return failWith(tokens, renderError(result.error));
  return onValue(result.value);
}

/**
 * 把 `git add` 的 pathspec 展开为「待暂存的新增/修改」与「待暂存的删除」两组路径。
 *
 * ⚠️ 原因（见 `gitApi.add` 的注释）：`gitApi.add()` **不展开 `.`** ——
 * isomorphic-git 的 `add` 会递归收录目录，但真 git 对目录路径会提示
 * `pathspec is a directory`。因此「展开」的职责明确落在本层：
 * 借 `gitApi.status()` 拿到工作区条目，把 `.` / `-A` 展开成具体路径列表。
 *
 * ⚠️ 另一条必须在此处理的差异：真 git 的 `git add -A` 会把**工作区已删除**的文件
 * 也记入索引（记为删除）。而 `gitApi.add()` 对不存在的路径会抛 `NotFoundError`
 * （isomorphic-git 的 `add` 不做删除暂存）。故此处按条目状态分流：
 * 工作区已删除的条目改走 `gitApi.remove()`，其余走 `gitApi.add()`。
 *
 * 展开规则对齐真 git 的 `git add .` / `git add -A`：
 *   - 收录未追踪的新文件（untracked）；
 *   - 收录有未暂存改动的已跟踪文件（unstaged）；
 *   - 已暂存且工作区无新改动的条目不重复添加。
 */
async function expandPathspec(
  command: Extract<ParsedCommand, { verb: 'add' }>,
  options: RepoOptions,
): Promise<GitResult<{ add: string[]; remove: string[] }>> {
  const hasWholeTree = command.all || command.paths.includes('.');
  const explicit = command.paths.filter((path) => path !== '.');

  if (!hasWholeTree) {
    return { ok: true, value: { add: explicit, remove: [] } };
  }

  const statusResult = await gitStatus(options);
  if (!statusResult.ok) return statusResult;

  const summary: StatusSummary = statusResult.value;
  const changed = summary.entries.filter((entry) => entry.untracked || entry.unstaged);

  const add = changed.filter((entry) => entry.workdir !== 'deleted').map((entry) => entry.path);
  const remove = changed.filter((entry) => entry.workdir === 'deleted').map((entry) => entry.path);

  return { ok: true, value: { add: [...new Set([...add, ...explicit])], remove: [...new Set(remove)] } };
}

/**
 * 把 `status()` 结果渲染为终端输出行。
 *
 * `--short` 输出对齐真 git 的 `XY <path>` 两列格式：
 *   - 第一列 X（索引相对 HEAD）：`A` 新增、`M` 修改、`D` 删除、空格 无变化；
 *   - 第二列 Y（工作区相对索引）：`M` 修改、`D` 删除、空格 无变化；未追踪文件为 `??`。
 *
 * 两列可同时非空（如「add 后又改」= `MM`、「add 后删除」= `MD`），
 * 故不可用单一 `unstaged` 布尔量替代 —— 必须分别看 `stage` 与 `workdir`。
 *
 * 与真 git 一致：**完全无变化的条目不出现在 `--short` 输出里**（`git status -s` 对干净
 * 文件什么都不打印），故此处只渲染确有变化的条目。
 */
function renderStatus(summary: StatusSummary, short: boolean): string[] {
  if (!short) return summary.summary.split('\n');

  const lines: string[] = [];
  for (const entry of summary.entries) {
    if (entry.untracked) {
      lines.push(`?? ${entry.path}`);
      continue;
    }

    // 第一列：索引态（相对 HEAD）。
    // ⚠️ 不能只按 `stage` 取值 —— `StatusEntry.stage === 'added'` 对应 statusMatrix 的
    //    `stage=2/3`，其真 git 语义**取决于 `head`**：
    //      head=absent     + 已入索引 → `A`（新文件，如 `A ` / `AM` / `AD`）
    //      head=unmodified + 索引已变 → `M`（已跟踪文件被修改，如 `M ` / `MM` / `MD`）
    //    故必须结合 `head` 判断，否则「已跟踪文件」的索引变更会被误标为新增。
    let index = ' ';
    if (entry.staged) {
      if (entry.stage === 'absent') index = 'D'; // 索引中已删除（`git add -A` 暂存删除）
      else if (entry.head === 'absent') index = 'A'; // HEAD 无此文件 → 新增
      else index = 'M'; // HEAD 有 → 修改
    }

    // 第二列：工作区态（相对索引）。
    // ⚠️ 例外：删除已被暂存（`stage === 'absent'`）时，第二列必须留空。
    //    此时文件确实不在工作区，但该删除**已经完整记入索引**，相对索引没有任何
    //    未暂存改动 —— 真 git 输出 `D `（而非 `DD`）。`gitApi` 的 `workdir` 仍报
    //    `deleted`（它描述的是「与索引/HEAD 的追踪版本相比文件不在了」），
    //    故这里按真 git 的 porcelain 语义抑制第二列。
    let worktree = ' ';
    if (!(entry.staged && entry.stage === 'absent')) {
      if (entry.workdir === 'deleted') worktree = 'D';
      else if (entry.workdir === 'modified') worktree = 'M';
    }

    // 两列皆空 = 该文件相对 HEAD 与索引都没有变化，真 git 不输出
    if (index === ' ' && worktree === ' ') continue;

    lines.push(`${index}${worktree} ${entry.path}`);
  }
  return lines;
}

/** 把 `log()` 结果渲染为终端输出行 */
function renderLog(commits: CommitEntry[], oneline: boolean, reverse: boolean): string[] {
  const ordered = reverse ? [...commits].reverse() : commits;

  if (oneline) {
    return ordered.map((entry) => `${entry.shortHash} ${entry.message.split('\n')[0]}`);
  }

  const lines: string[] = [];
  ordered.forEach((entry, index) => {
    if (index > 0) lines.push('');
    lines.push(`提交 ${entry.hash}`);
    lines.push(`作者：${entry.author} <${entry.authorEmail}>`);
    lines.push(`日期：${entry.date.toLocaleString('zh-CN')}`);
    lines.push('');
    // 提交信息按行缩进，贴合真 git 的排版
    for (const line of entry.message.split('\n')) {
      lines.push(`    ${line}`);
    }
  });
  return lines;
}

/**
 * 执行一条玩家输入的命令。
 *
 * 流程：`tokenizeDetailed` → `parse`（grammar）→ 分发到 `gitApi`。
 * 任何一个环节失败都返回 `ok: false` 与中文报错，**不抛异常**。
 *
 * @param input 玩家输入的原始命令行
 * @param options 可选的仓库位置覆盖（默认由 gitApi 指向 `/repo`）
 *
 * @example
 * ```ts
 * const result = await execute('git commit -m "初始提交"');
 * const entry: CommandEntry = {
 *   id: String(Date.now()), input, tokens: result.tokens,
 *   ok: result.ok, output: result.output, error: result.error,
 *   ts: Date.now(), undoable: result.undoable,
 * };
 * ```
 */
export async function execute(input: string, options: ExecuteOptions = {}): Promise<ExecuteResult> {
  // --- 1. tokenize ---
  const tokenized = tokenizeDetailed(input);
  if (!tokenized.ok) {
    return failWith(tokenized.tokens, tokenized.error);
  }
  const { tokens } = tokenized;

  if (tokens.length === 0) {
    return failWith(tokens, '请输入要执行的命令。');
  }

  // --- 2. grammar ---
  const parsed = parse(tokens);
  if (!parsed.ok) {
    // `unsupported` 类别转由 gitApi 的统一出口生成错误对象，
    // 保证与「executor 直接拒绝」路径的文案与错误类型完全一致（§14）。
    if (parsed.kind === 'unsupported') {
      const verb = tokens[1] ?? '';
      const result = unsupported(verb);
      return failWith(tokens, result.ok ? parsed.error : renderError(result.error));
    }
    return failWith(tokens, parsed.error);
  }

  // --- 3. 分发到 gitApi ---
  const { command } = parsed;
  const repoOptions: RepoOptions = { dir: options.dir, gitdir: options.gitdir };

  switch (command.verb) {
    case 'init':
      return unwrap(await gitInit(repoOptions), tokens, () =>
        succeed(tokens, [`已在 ${command.args[0] ?? repoOptions.dir ?? '/repo'} 初始化空的 Git 仓库。`]),
      );

    case 'add': {
      const expanded = await expandPathspec(command, repoOptions);
      if (!expanded.ok) return failWith(tokens, renderError(expanded.error));

      const { add, remove } = expanded.value;

      if (add.length === 0 && remove.length === 0) {
        // 对齐真 git：无内容可暂存不是错误（`git add .` 在干净工作区静默成功）
        return succeed(tokens, []);
      }

      // 工作区已删除的文件 → 暂存其删除（`gitApi.add` 对缺失路径会抛 NotFoundError）
      if (remove.length > 0) {
        const removed = await gitRemove(remove, repoOptions);
        if (!removed.ok) return failWith(tokens, renderError(removed.error));
      }

      if (add.length === 0) return succeed(tokens, []);

      return unwrap(await gitAdd(add, repoOptions), tokens, () =>
        succeed(tokens, []),
      );
    }

    case 'commit': {
      if (command.amend) {
        // `--amend` 属 M5 范围，明确回「不支持」而非静默忽略
        const result = unsupported('commit --amend');
        return failWith(tokens, result.ok ? 'git commit --amend 在当前版本中尚不支持。' : renderError(result.error));
      }

      // `-a`：提交前自动暂存已跟踪文件的改动（含工作区删除）
      if (command.all) {
        const statusResult = await gitStatus(repoOptions);
        if (!statusResult.ok) return failWith(tokens, renderError(statusResult.error));

        const tracked = statusResult.value.unstaged
          .filter((entry) => entry.head !== 'absent')
          .map((entry) => entry.path);

        if (tracked.length > 0) {
          const addResult = await gitAdd(tracked, repoOptions);
          if (!addResult.ok) return failWith(tokens, renderError(addResult.error));
        }
      }

      const message = command.message ?? '';
      return unwrap(await gitCommit(message, repoOptions), tokens, (hash) => {
        const shortHash = hash.slice(0, 7);
        const branch = 'main';
        // 对齐真 git 的 commit 回显格式
        return succeed(tokens, [
          `[${branch} ${shortHash}] ${message.split('\n')[0]}`,
        ]);
      });
    }

    case 'status':
      return unwrap(await gitStatus(repoOptions), tokens, (summary) =>
        succeed(tokens, renderStatus(summary, command.short)),
      );

    case 'log':
      return unwrap(await gitLog(repoOptions), tokens, (commits) => {
        const limited = command.maxCount === undefined ? commits : commits.slice(0, command.maxCount);
        return succeed(tokens, renderLog(limited, command.oneline, command.reverse));
      });

    default:
      // SUPPORTED_VERBS 已由 grammar 收敛，此处不可达
      return failWith(tokens, '该命令在当前版本中尚不支持。');
  }
}

/**
 * 便捷包装：执行并返回可直接存入命令历史的 `CommandEntry`（补 id 与 ts）。
 *
 * ⚠️ 副作用仅限「读取当前时间」，便于 UI 一行接入；纯执行逻辑仍在 `execute()`。
 *
 * @param input   玩家输入的原始命令行
 * @param options 可选的仓库位置覆盖
 */
export async function executeToEntry(
  input: string,
  options: ExecuteOptions = {},
): Promise<CommandEntry> {
  const result = await execute(input, options);
  const ts = Date.now();
  const entry: CommandEntry = {
    id: `${ts}-${Math.random().toString(36).slice(2, 8)}`,
    input,
    tokens: result.tokens,
    ok: result.ok,
    output: result.output,
    ts,
    undoable: result.undoable,
  };
  if (result.error !== undefined) entry.error = result.error;
  return entry;
}

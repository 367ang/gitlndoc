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
 * ⚠️ 关于「undoable」：§6.2 规定撤销类命令（reset / revert / checkout -- / stash drop）才记
 * `undoable`。M4 的分支命令（branch / checkout <branch> / switch / merge / rebase / rm）
 * 与 **M5b 的远程命令（remote / clone / push / fetch / pull）** 都**不属于撤销类**
 * （§7.2 字面清单只含上述四者；分支与远程操作是「前进」而非「回退」），
 * 故仍恒为 false。3-5 变基关的评分依赖 optimalMoves（参考命令数），不依赖撤销罚分。
 *
 * ⚠️ `git pull` 虽然内含 merge，但它是**获取远程更新**的常规动作，
 * 不是「撤销自己的改动」—— 归入撤销类会让 4-3 的正常流程平白扣分。
 * 这与 `reflog` 只读不扣分是同一条判断标准（见下方 undoable 的注释）。
 *
 * ⚠️ M1 只处理自由输入（`free`）。半拼模式的残缺 token 高亮属 M4，在 fragments/CommandBuilder 层实现。
 */

import type { CommandEntry } from '../types';
import {
  add as gitAdd,
  addRemote as gitAddRemote,
  branch as gitBranch,
  checkout as gitCheckout,
  checkoutPaths as gitCheckoutPaths,
  clone as gitClone,
  commit as gitCommit,
  deleteRemote as gitDeleteRemote,
  diff as gitDiff,
  fetch as gitFetch,
  init as gitInit,
  listBranches as gitListBranches,
  listRemotes as gitListRemotes,
  log as gitLog,
  logAll as gitLogAll,
  merge as gitMerge,
  pull as gitPull,
  push as gitPush,
  rebase as gitRebase,
  reflog as gitReflog,
  remove as gitRemove,
  removePaths as gitRemovePaths,
  reset as gitReset,
  restore as gitRestore,
  revert as gitRevert,
  status as gitStatus,
  unsupported,
  DEFAULT_BRANCH,
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
function succeed(tokens: string[], output: string[], undoable = false): ExecuteResult {
  return { ok: true, tokens, output, undoable };
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
 * §6.2 规定的**撤销类命令**的用户可见口径，供本文件各 case 判断 `undoable`：
 *   - `reset`（三模式都属回退；`--hard` 的破坏性由关卡叙事承担，此处不额外区分）；
 *   - `revert`（生成反向提交，属「撤销已归档的改动」）；
 *   - `restore` / `checkout -- <path>`（丢弃工作区改动、撤销暂存）。
 *
 * ⚠️ **`git reflog` 不算撤销**：它是只读命令，属 §7.3 的「探查奖励」——
 * 5-6 的教学剧本里玩家要先 `reflog` 查看再恢复，把查看也算撤销会平白扣分。
 * 因此下面各 case 直接传 `true`，而不是按 verb 查表统一判定（`checkout`
 * 的撤销性取决于是否有路径参数，无法只按 verb 决定）。
 */

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

      // `--amend --no-edit`（M5a）：沿用原提交信息。
      // 原信息从 HEAD 提交读出；无 HEAD 时真 git 会报「You have nothing to amend」。
      let message = command.message ?? '';
      if (command.amend && command.noEdit === true) {
        const headMessage = await headCommitMessageOf(repoOptions);
        if (headMessage === null) {
          return failWith(
            tokens,
            '还没有任何提交可供修补 —— --amend 只能用于修正最近一次快照。',
          );
        }
        message = headMessage;
      }

      return unwrap(await gitCommit(message, { ...repoOptions, amend: command.amend }), tokens, (result) => {
        const shortHash = result.hash.slice(0, 7);
        // 对齐真 git 的 commit 回显格式；分支名 M4 起真实读取（M1 曾硬编码 main，
        // 分支关卡里会显示错误分支 —— M4 的 GitGraph/BranchPanel 都依赖真实分支语义）
        // ⚠️ amend 的真 git 输出同样是 `[main abc1234] <信息>`，不做特殊标记，
        // 以保持「玩家看到的与真 git 一致」；教学上的差异由关卡叙事说明。
        return succeed(tokens, [
          `[${result.branch} ${shortHash}] ${message.split('\n')[0]}`,
        ]);
      });
    }

    case 'status':
      return unwrap(await gitStatus(repoOptions), tokens, (summary) =>
        succeed(tokens, renderStatus(summary, command.short)),
      );

    case 'log': {
      const logResult = command.all ? await gitLogAll(repoOptions) : await gitLog(repoOptions);
      return unwrap(logResult, tokens, (commits) => {
        const limited = command.maxCount === undefined ? commits : commits.slice(0, command.maxCount);
        return succeed(tokens, renderLog(limited, command.oneline, command.reverse));
      });
    }

    case 'branch': {
      if (command.name === undefined) {
        // `git branch` 无参数：列出本地分支（对齐真 git 输出：`* ` 标记当前分支）
        return unwrap(await gitListBranches(repoOptions), tokens, (branches) => {
          const output = branches.map((entry) => `${entry.current ? '* ' : '  '}${entry.name}`);
          if (output.length === 0) output.push('（还没有任何分支）');
          return succeed(tokens, output);
        });
      }
      return unwrap(await gitBranch(command.name, repoOptions), tokens, (result) =>
        succeed(tokens, [result.from === undefined ? `已创建分支 ${result.name}` : `已创建分支 ${result.name}（指向 ${result.from}）`]),
      );
    }

    case 'checkout': {
      // `git checkout -- <pathspec>`（M5a）：丢弃工作区改动，与 `git restore` 同语义。
      // 记 undoable（§6.2 字面清单里的「checkout --」即此）。
      if (command.paths !== undefined && command.paths.length > 0) {
        return unwrap(await gitCheckoutPaths(command.paths, repoOptions), tokens, (result) =>
          succeed(
            tokens,
            result.paths.map((path) => `已把 ${path} 恢复到暂存区的版本（工作区改动已丢弃）`),
            true,
          ),
        );
      }
      if (command.create) {
        // `checkout -b <name>` = 创建并切换；复用 branch + checkout 组合
        const created = await gitBranch(command.branch, repoOptions);
        if (!created.ok) return failWith(tokens, renderError(created.error));
      }
      return unwrap(await gitCheckout(command.branch, repoOptions), tokens, (result) =>
        succeed(tokens, [
          command.create
            ? `已切换到一个新分支「${result.branch}」`
            : `已切换到分支「${result.branch}」`,
        ]),
      );
    }

    case 'switch': {
      if (command.create) {
        const created = await gitBranch(command.branch, repoOptions);
        if (!created.ok) return failWith(tokens, renderError(created.error));
      }
      return unwrap(await gitCheckout(command.branch, repoOptions), tokens, (result) =>
        succeed(tokens, [
          command.create
            ? `已切换到一个新分支「${result.branch}」`
            : `已切换到分支「${result.branch}」`,
        ]),
      );
    }

    case 'merge': {
      const merged = await gitMerge(command.branch, repoOptions);
      if (!merged.ok) return failWith(tokens, renderError(merged.error));

      const result = merged.value;
      if ('conflicted' in result) {
        // 冲突：GitCommandError 文案 + 冲突文件清单（真 git 的输出格式）
        const lines = [
          `自动合并失败 —— 以下文件存在冲突，需要手动解决：`,
          ...result.conflictedPaths.map((path) => `\t${path}`),
          '冲突标记（<<<<<<< / ======= / >>>>>>>）已写入这些文件。解决后执行 git add <文件>，再 git commit 完成合并。',
        ];
        return succeed(tokens, lines);
      }
      if (result.mergeCommit) {
        return succeed(tokens, [`已合并 ${command.branch}（生成合并提交 ${result.hash.slice(0, 7)}）`]);
      }
      if (result.fastForward) {
        return succeed(tokens, [`正在更新 ${command.branch}..HEAD 以快进合并（Fast-forward）`]);
      }
      return succeed(tokens, ['已经是最新的（Already up to date.）']);
    }

    case 'rebase':
      return unwrap(await gitRebase(command.upstream, repoOptions), tokens, (result) => {
        if (result.count === 0) {
          return succeed(tokens, ['当前分支已经是最新的（无需变基）。']);
        }
        return succeed(tokens, [
          `成功把 ${result.count} 个提交变基到 ${command.upstream} 之上，并切换到分支「${result.branch}」。`,
        ]);
      });

    case 'rm': {
      if (command.cached) {
        // `--cached`：只从索引移除（M1 的 gitApi.remove 即此语义），工作区文件保留
        return unwrap(await gitRemove(command.paths, repoOptions), tokens, () =>
          succeed(tokens, command.paths.map((path) => `已从暂存区移除 ${path}（工作区文件保留）`)),
        );
      }
      return unwrap(await gitRemovePaths(command.paths, repoOptions), tokens, (removed) =>
        succeed(tokens, removed.map((path) => `已移除 ${path}`)),
      );
    }

    case 'diff':
      return unwrap(await gitDiff({ ...repoOptions, staged: command.staged }), tokens, (entries) => {
        if (entries.length === 0) {
          return succeed(tokens, [command.staged ? '暂存区与最近一次快照一致，没有差异。' : '工作区与暂存区一致，没有未暂存的改动。']);
        }
        const lines: string[] = [];
        for (const entry of entries) {
          lines.push(`diff --git a/${entry.path} b/${entry.path}`);
          for (const line of entry.lines) lines.push(line);
        }
        return succeed(tokens, lines);
      });

    // ── M5a：第五章「时空回溯」───────────────────────────────────────────
    case 'reset': {
      // 三模式的回显对齐真 git：`HEAD is now at <短hash> <信息>`（--hard）
      // 与 `Unstaged changes after reset:`（--mixed）等文案差异在此简化为一句话，
      // 但**保留目标短 hash 与模式**，让玩家能核对「退到哪了、动没动工作区」。
      return unwrap(
        await gitReset(command.target, { ...repoOptions, mode: command.mode }),
        tokens,
        (result) => {
          const modeText =
            result.mode === 'soft'
              ? '提交已撤销，改动仍留在暂存区'
              : result.mode === 'mixed'
                ? '提交已撤销，改动退回工作区（暂存区已清空）'
                : '提交与工作区改动都已丢弃';
          const lines = [`HEAD 现在指向 ${result.target}（${result.targetLabel}）：${modeText}`];
          if (result.mode === 'hard') lines.push('⚠️ 这次回退丢弃了工作区的改动 —— 如需找回，可用 git reflog 查看历史位置。');
          return succeed(tokens, lines, true);
        },
      );
    }

    case 'restore': {
      return unwrap(
        await gitRestore(command.paths, { ...repoOptions, staged: command.staged }),
        tokens,
        (result) =>
          succeed(
            tokens,
            result.paths.map((path) =>
              command.staged
                ? `已把 ${path} 移出暂存区（工作区内容保留）`
                : `已把 ${path} 恢复到暂存区的版本（工作区改动已丢弃）`,
            ),
            true,
          ),
      );
    }

    case 'revert': {
      return unwrap(await gitRevert(command.target, repoOptions), tokens, (result) =>
        succeed(
          tokens,
          [
            `[${result.hash.slice(0, 7)}] ${result.message}`,
            `已生成一条反向提交，抵消 ${result.reverted.slice(0, 7)} 的改动 —— 历史向前延伸，而不是被改写。`,
          ],
          true,
        ),
      );
    }

    case 'reflog':
      return unwrap(await gitReflog(repoOptions), tokens, (lines) => {
        if (lines.length === 0) return succeed(tokens, ['（还没有任何 HEAD 移动记录）']);
        return succeed(tokens, lines);
      });

    // ── M5b：第四章「星际连接」───────────────────────────────────────────
    case 'remote': {
      if (command.subcommand === 'list') {
        return unwrap(await gitListRemotes(repoOptions), tokens, (remotes) => {
          if (remotes.length === 0) return succeed(tokens, ['（还没有关联任何远程仓库）']);
          // 对齐真 git 的 `git remote -v` 输出：`<名称>\t<地址> (fetch)`
          return succeed(
            tokens,
            remotes.flatMap((entry) => [
              `${entry.name}\t${entry.url} (fetch)`,
              `${entry.name}\t${entry.url} (push)`,
            ]),
          );
        });
      }

      if (command.subcommand === 'remove') {
        const name = command.name as string;
        return unwrap(await gitDeleteRemote(name, repoOptions), tokens, () =>
          succeed(tokens, [`已移除远程「${name}」。`]),
        );
      }

      // `git remote add <name> <url>` —— URL 白名单由 gitApi 把关（决策 ③）
      const name = command.name as string;
      const url = command.url as string;
      return unwrap(await gitAddRemote(name, url, repoOptions), tokens, (entry) =>
        succeed(tokens, [`已添加远程「${entry.name}」→ ${entry.url}`]),
      );
    }

    case 'clone':
      return unwrap(await gitClone(command.url, repoOptions), tokens, () =>
        succeed(tokens, [
          `正在克隆到 ${repoOptions.dir ?? '/repo'}...`,
          `克隆完成 —— 远程的完整历史已取回本地。`,
        ]),
      );

    case 'push': {
      const remote = command.remote ?? 'origin';
      const branch = command.branch ?? DEFAULT_BRANCH;
      return unwrap(await gitPush(remote, { ...repoOptions, ref: branch }), tokens, () =>
        succeed(tokens, [
          `To ${remote}`,
          `   ${branch} -> ${branch}`,
          `推送完成 —— 远程的 ${branch} 已与本地同步。`,
        ]),
      );
    }

    case 'fetch': {
      const remote = command.remote ?? 'origin';
      const options = command.branch
        ? { ...repoOptions, ref: command.branch }
        : repoOptions;
      return unwrap(await gitFetch(remote, options), tokens, () => {
        const branch = command.branch ?? DEFAULT_BRANCH;
        return succeed(tokens, [
          `From ${remote}`,
          `   * branch            ${branch}     -> FETCH_HEAD`,
          `已获取远程更新到 ${remote}/${branch}（工作区未变动）。`,
        ]);
      });
    }

    case 'pull': {
      const remote = command.remote ?? 'origin';
      const branch = command.branch ?? DEFAULT_BRANCH;
      return unwrap(await gitPull(remote, { ...repoOptions, ref: branch }), tokens, (result) => {
        if (result.upToDate) {
          return succeed(tokens, ['已经是最新的（Already up to date.）']);
        }
        if (result.fastForward) {
          return succeed(tokens, [
            `正在更新 ${remote}/${branch}..HEAD 以快进合并（Fast-forward）`,
            `已把远程的更新合并到当前分支。`,
          ]);
        }
        return succeed(tokens, [
          `From ${remote}`,
          `   * branch            ${branch}     -> FETCH_HEAD`,
          `已合并远程的更新（生成合并提交）。`,
        ]);
      });
    }

    default:
      // SUPPORTED_VERBS 已由 grammar 收敛，此处不可达
      return failWith(tokens, '该命令在当前版本中尚不支持。');
  }
}

/**
 * 读 HEAD 提交的完整信息（trim 后）；无提交或读取失败返回 null。
 *
 * 供 `git commit --amend --no-edit` 沿用原提交信息使用 —— executor 层不直接调
 * isomorphic-git，故经 `gitApi.log()` 取（它已把首条提交的 message 归一为 trim 后文本）。
 */
async function headCommitMessageOf(options: RepoOptions): Promise<string | null> {
  const logged = await gitLog({ ...options, depth: 1 });
  if (!logged.ok) return null;
  return logged.value[0]?.message ?? null;
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

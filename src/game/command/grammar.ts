/**
 * 命令语法校验（development-refinement.md §6.3.2）。
 *
 * 职责：把 token 数组解析成 `git <verb> [flags] [args]` 结构，校验参数个数与合法性，
 * 产出**规范化的判别联合参数对象**。本层只做「认不认得」，不碰 git、不执行任何东西。
 *
 * ⚠️ M5b 起的白名单：`init` / `add` / `commit` / `status` / `log` / `branch` /
 * `checkout` / `switch` / `merge` / `rebase` / `rm` / `diff` /
 * `reset` / `restore` / `revert` / `reflog`（第五章「时空回溯」）/
 * **`remote` / `clone` / `push` / `fetch` / `pull`**（第四章「星际连接」）。
 * 其余子命令（tag / stash …）返回
 * `kind: 'unsupported'` 的校验结果 ——
 * 依据 §14「grammar 层做子集白名单，超出范围给『该版本不支持』提示而非假装执行」，
 * 绝不落到执行层。
 *
 * 本模块是**纯函数**：无副作用、不 import gitApi / fs / React / zustand。
 * 与 `engine/errors.ts::GitUnsupportedError` 的文案保持一致，见 `unsupportedMessage()`。
 */

/** M5b 支持解析的 verb 白名单 */
export const SUPPORTED_VERBS = [
  'init',
  'add',
  'commit',
  'status',
  'log',
  'branch',
  'checkout',
  'switch',
  'merge',
  'rebase',
  'rm',
  'diff',
  // M5a：第五章「时空回溯」
  'reset',
  'restore',
  'revert',
  'reflog',
  // M5b：第四章「星际连接」
  'remote',
  'clone',
  'push',
  'fetch',
  'pull',
] as const;


/** M1 支持的子命令名 */
export type SupportedVerb = (typeof SUPPORTED_VERBS)[number];

/** `git init` 的规范化参数 */
export interface InitCommand {
  verb: 'init';
  /** 目标目录（M1 恒为沙箱 `/repo`，故此处仅记录玩家是否显式写了路径） */
  args: string[];
}

/** `git add` 的规范化参数 */
export interface AddCommand {
  verb: 'add';
  /** 是否为 `-A` / `--all` / `-u` / `--update` 这类「更新整棵工作区」的旗标 */
  all: boolean;
  /** 已解析的路径列表（`-A` 时为 `['.']`，交由 executor 展开） */
  paths: string[];
}

/** `git commit` 的规范化参数 */
/** `git commit -m <message> [-a] [--amend] [--no-edit]` */
export interface CommitCommand {
  verb: 'commit';
  /** `-m <msg>` 提供的提交信息；`--amend --no-edit` 时为 undefined（沿用原信息） */
  message?: string;
  /** `-a` / `--all`：提交前自动暂存已跟踪文件的改动 */
  all: boolean;
  /** `--amend`：修补最近一次提交（M5a 起由 executor 真正实现） */
  amend: boolean;
  /** `--no-edit`：与 `--amend` 配合，沿用原提交信息（M5a） */
  noEdit?: boolean;
}

/** `git status` 的规范化参数 */
export interface StatusCommand {
  verb: 'status';
  /** `-s` / `--short`：精简输出 */
  short: boolean;
}

/** `git log` 的规范化参数 */
export interface LogCommand {
  verb: 'log';
  /** `--oneline`：单行输出 */
  oneline: boolean;
  /** `-n <count>` / `--max-count=<count>` 限制条数 */
  maxCount?: number;
  /** `--reverse`：按时间正序 */
  reverse: boolean;
  /** `--all`：全分支遍历（M4，GitGraph 数据源） */
  all: boolean;
}

/** `git branch <name>` 的规范化参数（M4） */
export interface BranchCommand {
  verb: 'branch';
  /** 要创建的分支名；缺省 = 列出分支（`git branch` 无参数） */
  name?: string;
}

/** `git checkout <branch>` / `git switch <branch>` 的规范化参数（M4） */
export interface CheckoutCommand {
  verb: 'checkout' | 'switch';
  /** 目标分支名；`checkout -- <path>` 路径模式下为空串 */
  branch: string;
  /** `-b <name>`（checkout）/ `-c <name>`（switch）：创建并切换 */
  create: boolean;
  /**
   * `git checkout -- <pathspec>...`（M5a）：丢弃工作区改动，等价于 `git restore`。
   * 非路径模式下为 undefined。
   */
  paths?: string[];
}

/** `git merge <branch>` 的规范化参数（M4） */
export interface MergeCommand {
  verb: 'merge';
  /** 被合入当前分支的分支名 */
  branch: string;
}

/** `git rebase <upstream>` 的规范化参数（M4） */
export interface RebaseCommand {
  verb: 'rebase';
  /** 变基目标（把当前分支重放到它之上） */
  upstream: string;
}

/** `git rm <pathspec>` 的规范化参数（M4） */
export interface RmCommand {
  verb: 'rm';
  /** `--cached`：只从索引移除、保留工作区文件 */
  cached: boolean;
  /** 要移除的路径 */
  paths: string[];
}

/** `git diff [--staged]` 的规范化参数（M4） */
export interface DiffCommand {
  verb: 'diff';
  /** `--staged`：显示「已暂存、将要提交」的差异（缺省 = 未暂存改动） */
  staged: boolean;
}

/** `git reset [--soft|--mixed|--hard] <target>` 的规范化参数（M5a） */
export interface ResetCommand {
  verb: 'reset';
  /** 三模式；缺省为 `'mixed'`（与真 git 一致） */
  mode: 'soft' | 'mixed' | 'hard';
  /** 目标 ref 表达式（`HEAD~1` / `HEAD@{0}` / 分支名 / 提交 hash） */
  target: string;
}

/** `git restore [--staged] <pathspec>...` 的规范化参数（M5a） */
export interface RestoreCommand {
  verb: 'restore';
  /** `--staged`：只把索引回退到 HEAD，工作区保持不动 */
  staged: boolean;
  /** 要恢复的路径 */
  paths: string[];
}

/** `git revert <commit>` 的规范化参数（M5a） */
export interface RevertCommand {
  verb: 'revert';
  /** 要撤销的提交（ref 表达式） */
  target: string;
}

/** `git reflog` 的规范化参数（M5a）—— 无参数 */
export interface ReflogCommand {
  verb: 'reflog';
}

// ── M5b：第四章「星际连接」的五个命令 ────────────────────────────────────────

/** `git remote` 的子操作（对齐真 git 的常见形态） */
export type RemoteSubcommand = 'list' | 'add' | 'remove';

/** `git remote [-v]` / `git remote add <name> <url>` / `git remote remove <name>`（M5b） */
export interface RemoteCommand {
  verb: 'remote';
  /** 缺省（无参数）= 列出远程；`-v` 只影响输出详略，不影响语义 */
  subcommand: RemoteSubcommand;
  /** `add` / `remove` 的目标远程名 */
  name?: string;
  /** 仅 `add` 有：远程地址（由执行层做白名单校验） */
  url?: string;
}

/** `git clone <url> [<dir>]` 的规范化参数（M5b） */
export interface CloneCommand {
  verb: 'clone';
  /** 远程地址（执行层做白名单校验） */
  url: string;
  /** 可选的目标目录；沙箱内恒克隆到 `/repo`，故仅记录玩家是否写了路径 */
  dir?: string;
}

/** `git push [<remote>] [<branch>]` 的规范化参数（M5b） */
export interface PushCommand {
  verb: 'push';
  /** 远程名；缺省由执行层回落到 `origin` */
  remote?: string;
  /** 要推送的分支；缺省 = 当前分支 */
  branch?: string;
  /** `--all`：推送所有分支（本版本明确不支持，语法层直接拒绝） */
  all: boolean;
}

/** `git fetch [<remote>] [<branch>]` 的规范化参数（M5b） */
export interface FetchCommand {
  verb: 'fetch';
  /** 远程名；缺省由执行层回落到 `origin` */
  remote?: string;
  /** 要获取的分支；缺省 = 远程的默认分支 */
  branch?: string;
}

/** `git pull [<remote>] [<branch>]` 的规范化参数（M5b） */
export interface PullCommand {
  verb: 'pull';
  /** 远程名；缺省由执行层回落到 `origin` */
  remote?: string;
  /** 要拉取的分支；缺省 = 当前分支对应的远程分支 */
  branch?: string;
}

/** 命令参数的判别联合 */
export type ParsedCommand =
  | InitCommand
  | AddCommand
  | CommitCommand
  | StatusCommand
  | LogCommand
  | BranchCommand
  | CheckoutCommand
  | MergeCommand
  | RebaseCommand
  | RmCommand
  | DiffCommand
  | ResetCommand
  | RestoreCommand
  | RevertCommand
  | ReflogCommand
  | RemoteCommand
  | CloneCommand
  | PushCommand
  | FetchCommand
  | PullCommand;


/** 校验失败的类别，供 UI 决定呈现方式（提示 / 报错 / 警告） */
export type GrammarErrorKind =
  /** 输入为空 */
  | 'empty'
  /** 第一个 token 不是 git（如 `ls -la`） */
  | 'not-git'
  /** 缺 verb（只写了 `git`） */
  | 'missing-verb'
  /** verb 超出 M1 子集（§14「该版本不支持」） */
  | 'unsupported'
  /** verb 认识，但旗标/参数不合法 */
  | 'invalid-usage';

/** 校验结果：成功带规范化参数，失败带可判定的类别与中文文案 */
export type GrammarResult =
  | { ok: true; command: ParsedCommand }
  | { ok: false; kind: GrammarErrorKind; error: string };

/**
 * 与 `engine/errors.ts::GitUnsupportedError` 统一的文案。
 * 两处措辞一致，保证「grammar 直接拒绝」与「executor 调 unsupported()」的用户可见结果相同。
 */
export function unsupportedMessage(subcommand: string): string {
  return `git ${subcommand} 在当前版本中尚不支持。`;
}

/** 构造失败结果的小工具 */
function fail(kind: GrammarErrorKind, error: string): GrammarResult {
  return { ok: false, kind, error };
}

/** `git` 命令的两种常见写法：`git` 与完整路径 `/usr/bin/git` */
function isGitBinary(token: string): boolean {
  return token === 'git' || token.endsWith('/git');
}

/** 判断 token 是否为旗标（`-x` / `--xyz`），单独的 `-` 视为普通参数 */
function isFlag(token: string): boolean {
  return token.length > 1 && token.startsWith('-');
}

/**
 * 解析命令行 token，产出规范化的命令参数对象。
 *
 * @param tokens `tokenize()` 的输出
 */
export function parse(tokens: string[]): GrammarResult {
  if (tokens.length === 0) {
    return fail('empty', '请输入要执行的命令。');
  }

  const [binary, verb, ...rest] = tokens;

  if (!isGitBinary(binary)) {
    return fail('not-git', `目前仅支持 git 命令（收到：${binary}）。`);
  }
  if (verb === undefined) {
    return fail('missing-verb', 'git 之后需要跟上子命令，例如：git init');
  }
  if (!(SUPPORTED_VERBS as readonly string[]).includes(verb)) {
    return fail('unsupported', unsupportedMessage(verb));
  }

  switch (verb as SupportedVerb) {
    case 'init':
      return parseInit(rest);
    case 'add':
      return parseAdd(rest);
    case 'commit':
      return parseCommit(rest);
    case 'status':
      return parseStatus(rest);
    case 'log':
      return parseLog(rest);
    case 'branch':
      return parseBranch(rest);
    case 'checkout':
    case 'switch':
      return parseCheckout(verb as 'checkout' | 'switch', rest);
    case 'merge':
      return parseMerge(rest);
    case 'rebase':
      return parseRebase(rest);
    case 'rm':
      return parseRm(rest);
    case 'diff':
      return parseDiff(rest);
    case 'reset':
      return parseReset(rest);
    case 'restore':
      return parseRestore(rest);
    case 'revert':
      return parseRevert(rest);
    case 'reflog':
      return parseReflog(rest);
    // M5b：第四章「星际连接」
    case 'remote':
      return parseRemote(rest);
    case 'clone':
      return parseClone(rest);
    case 'push':
      return parsePush(rest);
    case 'fetch':
      return parseFetch(rest);
    case 'pull':
      return parsePull(rest);
    default:
      // SUPPORTED_VERBS 已在上方过滤，此处不可达；保留以满足穷尽性检查
      return fail('unsupported', unsupportedMessage(verb));
  }
}

/** `git init [<directory>]` */
function parseInit(args: string[]): GrammarResult {
  for (const arg of args) {
    if (isFlag(arg)) {
      return fail('invalid-usage', `git init 不支持选项 ${arg}。`);
    }
  }
  if (args.length > 1) {
    return fail('invalid-usage', 'git init 最多接受一个目录参数。');
  }
  return { ok: true, command: { verb: 'init', args } };
}

/** `git add [-A|--all|. ] <pathspec>...` */
function parseAdd(args: string[]): GrammarResult {
  const paths: string[] = [];
  let all = false;

  for (const arg of args) {
    if (arg === '-A' || arg === '--all' || arg === '--no-ignore-removal') {
      all = true;
      continue;
    }
    // `-u` / `--update` 亦为「整棵工作区」语义；M1 一并按 -A 处理（见 executor）
    if (arg === '-u' || arg === '--update') {
      all = true;
      continue;
    }
    if (isFlag(arg)) {
      return fail('invalid-usage', `git add 不支持选项 ${arg}。`);
    }
    paths.push(arg);
  }

  // 真 git 允许 `git add -A` 不带路径；除此之外必须有 pathspec
  if (paths.length === 0 && !all) {
    return fail('invalid-usage', '请指定要暂存的文件路径，例如：git add README.md');
  }

  return { ok: true, command: { verb: 'add', all, paths: all ? ['.'] : paths } };
}

/** `git commit -m <message> [-a] [--amend]` */
function parseCommit(args: string[]): GrammarResult {
  let message: string | undefined;
  let all = false;
  let amend = false;
  /** `--no-edit`（M5a）：与 `--amend` 配合，沿用原提交信息 */
  let noEdit = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    // `-m <msg>` / `-m<msg>` / `--message=<msg>` / `--message <msg>`
    if (arg === '-m' || arg === '--message') {
      const value = args[i + 1];
      if (value === undefined) {
        return fail('invalid-usage', 'git commit -m 后面需要跟上提交信息。');
      }
      message = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('-m') && arg.length > 2) {
      message = arg.slice(2);
      continue;
    }
    if (arg.startsWith('--message=')) {
      message = arg.slice('--message='.length);
      continue;
    }

    if (arg === '-a' || arg === '--all') {
      all = true;
      continue;
    }
    if (arg === '--amend') {
      amend = true;
      continue;
    }
    // `--no-edit`（M5a）：修补时沿用原提交信息 —— 笔记 git-undo.md 的
    // 「添加遗漏的文件到最后一次提交：git add forgotten-file.js && git commit --amend --no-edit」
    if (arg === '--no-edit') {
      noEdit = true;
      continue;
    }
    if (arg === '-am' || arg === '-ma') {
      // `-am "msg"`：合并旗标，等价于 `-a -m "msg"`
      const value = args[i + 1];
      if (value === undefined) {
        return fail('invalid-usage', 'git commit -am 后面需要跟上提交信息。');
      }
      all = true;
      message = value;
      i += 1;
      continue;
    }
    if (isFlag(arg)) {
      return fail('invalid-usage', `git commit 不支持选项 ${arg}。`);
    }
    positional.push(arg);
  }

  if (message === undefined) {
    // `--amend --no-edit`：沿用原提交信息，此时不需要 -m（M5a，笔记 5-1 的第二个场景）
    if (amend && noEdit) {
      return { ok: true, command: { verb: 'commit', message: undefined, all, amend, noEdit } };
    }
    // 与真 git 一致：无 -m 且无编辑器时，不允许消息为空
    if (positional.length > 0) {
      return fail('invalid-usage', '请使用 -m 提供提交信息，例如：git commit -m "初始提交"');
    }
    return fail('invalid-usage', '请提供提交信息，例如：git commit -m "初始提交"');
  }
  if (message.trim().length === 0) {
    return fail('invalid-usage', '提交信息不能为空。');
  }
  if (noEdit && !amend) {
    return fail('invalid-usage', '--no-edit 只能与 --amend 一起使用。');
  }

  return { ok: true, command: { verb: 'commit', message, all, amend, noEdit } };
}

/** `git status [-s|--short]` */
function parseStatus(args: string[]): GrammarResult {
  let short = false;
  for (const arg of args) {
    if (arg === '-s' || arg === '--short') {
      short = true;
      continue;
    }
    return fail('invalid-usage', `git status 不支持参数 ${arg}。`);
  }
  return { ok: true, command: { verb: 'status', short } };
}

/** `git log [--oneline] [-n <count>] [--reverse] [--all]` */
function parseLog(args: string[]): GrammarResult {
  let oneline = false;
  let reverse = false;
  let all = false;
  let maxCount: number | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--oneline') {
      oneline = true;
      continue;
    }
    if (arg === '--reverse') {
      reverse = true;
      continue;
    }
    if (arg === '--all') {
      all = true;
      continue;
    }
    if (arg === '-n' || arg === '--max-count') {
      const value = args[i + 1];
      const parsed = value === undefined ? Number.NaN : Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return fail('invalid-usage', 'git log -n 后面需要跟上一个非负整数。');
      }
      maxCount = parsed;
      i += 1;
      continue;
    }
    if (arg.startsWith('--max-count=')) {
      const parsed = Number(arg.slice('--max-count='.length));
      if (!Number.isInteger(parsed) || parsed < 0) {
        return fail('invalid-usage', 'git log --max-count= 后面需要跟上一个非负整数。');
      }
      maxCount = parsed;
      continue;
    }
    // `-5` 风格的条数简写
    if (/^-\d+$/.test(arg)) {
      maxCount = Number(arg.slice(1));
      continue;
    }
    if (isFlag(arg)) {
      return fail('invalid-usage', `git log 不支持选项 ${arg}。`);
    }
    return fail('invalid-usage', `git log 不支持参数 ${arg}。`);
  }

  return { ok: true, command: { verb: 'log', oneline, maxCount, reverse, all } };
}

/** 分支名的最小合法性：非空、无空白、不以 `-` 开头、不含 `..` / 空格控制符 */
function isValidBranchName(name: string): boolean {
  return name.length > 0 && !name.startsWith('-') && !/\s/.test(name) && !name.includes('..');
}

const BRANCH_NAME_HINT = '分支名不能包含空格，且不能以 - 开头。';

/** `git branch [<name>]`（M4；`-d`/`-D`/`-m` 等分支管理属后续章节，走 invalid-usage 提示「不支持」） */
function parseBranch(args: string[]): GrammarResult {
  for (const arg of args) {
    if (isFlag(arg)) {
      return fail('invalid-usage', `git branch 暂不支持选项 ${arg}（本版本仅支持创建与查看）。`);
    }
  }
  if (args.length > 1) {
    return fail('invalid-usage', 'git branch 一次只能创建一个分支。');
  }
  if (args.length === 0) {
    // `git branch` 无参数 = 列出分支
    return { ok: true, command: { verb: 'branch' } };
  }
  const [name] = args;
  if (!isValidBranchName(name)) {
    return fail('invalid-usage', `「${name}」不是有效的分支名。${BRANCH_NAME_HINT}`);
  }
  return { ok: true, command: { verb: 'branch', name } };
}

/** `git checkout [-b] <branch>` / `git switch [-c] <branch>`（M4） */
function parseCheckout(verb: 'checkout' | 'switch', args: string[]): GrammarResult {
  const createFlag = verb === 'checkout' ? '-b' : '-c';
  let create = false;
  const positional: string[] = [];
  /** `--` 之后的路径 —— 即 `git checkout -- <pathspec>` 旧语法（M5a 支持，服务 5-3） */
  const pathsAfterDashDash: string[] = [];
  let afterDashDash = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    // `--` 分隔符：其后的一切都是路径（真 git 的路径消歧义写法）
    if (arg === '--') {
      afterDashDash = true;
      continue;
    }
    if (afterDashDash) {
      pathsAfterDashDash.push(arg);
      continue;
    }

    if (arg === createFlag) {
      const value = args[i + 1];
      if (value === undefined) {
        return fail('invalid-usage', `git ${verb} ${createFlag} 后面需要跟上分支名。`);
      }
      if (!isValidBranchName(value)) {
        return fail('invalid-usage', `「${value}」不是有效的分支名。${BRANCH_NAME_HINT}`);
      }
      create = true;
      positional.push(value);
      i += 1;
      continue;
    }
    if (isFlag(arg)) {
      return fail('invalid-usage', `git ${verb} 不支持选项 ${arg}。`);
    }
    positional.push(arg);
  }

  // `git checkout -- <path>` / `git checkout <path>`（丢弃工作区改动，M5a）
  // ⚠️ `checkout --` 与 `restore` 同语义，笔记 git-undo.md 明确保留了这种旧写法。
  // 仅 `checkout` 支持（`switch` 没有路径模式）。
  if (pathsAfterDashDash.length > 0) {
    if (verb !== 'checkout') {
      return fail('invalid-usage', 'git switch 不支持路径参数 —— 丢弃工作区改动请用 git restore。');
    }
    if (positional.length > 0) {
      return fail('invalid-usage', 'git checkout 不能同时指定分支与路径。');
    }
    return { ok: true, command: { verb: 'checkout', branch: '', create: false, paths: pathsAfterDashDash } };
  }

  if (positional.length !== 1) {
    return fail('invalid-usage', `git ${verb} 需要恰好一个分支名，例如：git ${verb} main`);
  }
  const [branch] = positional;
  if (!create && !isValidBranchName(branch)) {
    return fail('invalid-usage', `「${branch}」不是有效的分支名。${BRANCH_NAME_HINT}`);
  }
  return { ok: true, command: { verb, branch, create } };
}


/** `git merge <branch>`（M4） */
function parseMerge(args: string[]): GrammarResult {
  for (const arg of args) {
    if (isFlag(arg)) {
      return fail('invalid-usage', `git merge 暂不支持选项 ${arg}（如 --no-ff / --abort）。`);
    }
  }
  if (args.length !== 1) {
    return fail('invalid-usage', 'git merge 需要恰好一个分支名，例如：git merge feature');
  }
  const [branch] = args;
  if (!isValidBranchName(branch)) {
    return fail('invalid-usage', `「${branch}」不是有效的分支名。${BRANCH_NAME_HINT}`);
  }
  return { ok: true, command: { verb: 'merge', branch } };
}

/** `git rebase <upstream>`（M4） */
function parseRebase(args: string[]): GrammarResult {
  for (const arg of args) {
    if (isFlag(arg)) {
      return fail('invalid-usage', `git rebase 暂不支持选项 ${arg}（如 -i / --onto）。`);
    }
  }
  if (args.length !== 1) {
    return fail('invalid-usage', 'git rebase 需要恰好一个分支名，例如：git rebase main');
  }
  const [upstream] = args;
  if (!isValidBranchName(upstream)) {
    return fail('invalid-usage', `「${upstream}」不是有效的分支名。${BRANCH_NAME_HINT}`);
  }
  return { ok: true, command: { verb: 'rebase', upstream } };
}

/** `git rm [--cached] <pathspec>...`（M4） */
function parseRm(args: string[]): GrammarResult {
  let cached = false;
  const paths: string[] = [];

  for (const arg of args) {
    if (arg === '--cached') {
      cached = true;
      continue;
    }
    if (isFlag(arg)) {
      return fail('invalid-usage', `git rm 不支持选项 ${arg}。`);
    }
    paths.push(arg);
  }

  if (paths.length === 0) {
    return fail('invalid-usage', '请指定要移除的文件路径，例如：git rm secrets.log');
  }
  return { ok: true, command: { verb: 'rm', cached, paths } };
}

/** `git diff [--staged]`（M4） */
function parseDiff(args: string[]): GrammarResult {
  let staged = false;
  for (const arg of args) {
    if (arg === '--staged' || arg === '--cached') {
      staged = true;
      continue;
    }
    return fail('invalid-usage', `git diff 暂不支持参数 ${arg}（本版本仅支持无参数与 --staged）。`);
  }
  return { ok: true, command: { verb: 'diff', staged } };
}

// ── M5a：第五章「时空回溯」的四个命令 ──────────────────────────────────────

/**
 * ref 表达式的最小合法性：非空、无空白、不以 `-` 开头、不含 `..`。
 *
 * ⚠️ 这里**不深究** `~n` / `^n` / `@{n}` 的结构是否合法 —— 那是
 * `engine/refExpr.ts::parseRefExpr` 的职责，它在执行层给出精确的中文报错。
 * 语法层只拦明显非法的形态，避免把「解析细节」复制成两份而漂移。
 */
function isPlausibleRef(text: string): boolean {
  return text.length > 0 && !text.startsWith('-') && !/\s/.test(text) && !text.includes('..');
}

const REF_HINT = '可以写成分支名、提交 hash，或 HEAD~1 / HEAD@{0} 这样的引用表达式。';

/**
 * `git reset [--soft|--mixed|--hard] <target>`（M5a，服务 5-2 / 5-5 / 5-6）。
 *
 * 对齐真 git：缺省模式为 `--mixed`；目标必填（真 git 的 `git reset` 无参数是
 * 「重置索引」的另一种用法，本版本不纳入，明确提示）。
 */
function parseReset(args: string[]): GrammarResult {
  let mode: 'soft' | 'mixed' | 'hard' = 'mixed';
  let modeSeen = false;
  const positional: string[] = [];

  for (const arg of args) {
    if (arg === '--soft' || arg === '--mixed' || arg === '--hard') {
      if (modeSeen) {
        return fail('invalid-usage', 'git reset 一次只能指定一种模式（--soft / --mixed / --hard）。');
      }
      mode = arg.slice(2) as 'soft' | 'mixed' | 'hard';
      modeSeen = true;
      continue;
    }
    if (isFlag(arg)) {
      return fail('invalid-usage', `git reset 暂不支持选项 ${arg}（本版本仅支持 --soft / --mixed / --hard）。`);
    }
    positional.push(arg);
  }

  if (positional.length === 0) {
    return fail(
      'invalid-usage',
      `请指定要回退到的目标，例如：git reset --soft HEAD~1。${REF_HINT}`,
    );
  }
  if (positional.length > 1) {
    return fail('invalid-usage', 'git reset 一次只能回退到一个目标。');
  }
  const [target] = positional;
  if (!isPlausibleRef(target)) {
    return fail('invalid-usage', `「${target}」不是有效的目标。${REF_HINT}`);
  }
  return { ok: true, command: { verb: 'reset', mode, target } };
}

/**
 * `git restore [--staged] <pathspec>...`（M5a，服务 5-2 / 5-3）。
 *
 * 笔记 `docs/notes/git-undo.md` 的两种用法都由本命令承载：
 *   - `git restore <file>`：丢弃工作区改动；
 *   - `git restore --staged <file>`：撤销暂存（旧写法 `git reset HEAD <file>`）。
 */
function parseRestore(args: string[]): GrammarResult {
  let staged = false;
  const paths: string[] = [];

  for (const arg of args) {
    if (arg === '--staged' || arg === '--cached') {
      staged = true;
      continue;
    }
    if (isFlag(arg)) {
      return fail('invalid-usage', `git restore 暂不支持选项 ${arg}（本版本仅支持 --staged）。`);
    }
    paths.push(arg);
  }

  if (paths.length === 0) {
    return fail('invalid-usage', '请指定要恢复的文件路径，例如：git restore notes/draft.md');
  }
  return { ok: true, command: { verb: 'restore', staged, paths } };
}

/** `git revert <commit>`（M5a，服务 5-4 / 5-5） */
function parseRevert(args: string[]): GrammarResult {
  const positional: string[] = [];
  for (const arg of args) {
    if (isFlag(arg)) {
      return fail('invalid-usage', `git revert 暂不支持选项 ${arg}（如 -m / --no-commit）。`);
    }
    positional.push(arg);
  }

  if (positional.length === 0) {
    return fail('invalid-usage', `请指定要撤销的提交，例如：git revert HEAD~1。${REF_HINT}`);
  }
  if (positional.length > 1) {
    return fail('invalid-usage', 'git revert 一次只能撤销一个提交。');
  }
  const [target] = positional;
  if (!isPlausibleRef(target)) {
    return fail('invalid-usage', `「${target}」不是有效的提交。${REF_HINT}`);
  }
  return { ok: true, command: { verb: 'revert', target } };
}

/** `git reflog`（M5a，服务 5-6）—— 本版本仅支持无参数调用（`show` 子命令属进阶） */
function parseReflog(args: string[]): GrammarResult {
  if (args.length > 0) {
    return fail('invalid-usage', `git reflog 暂不支持参数 ${args[0]}（本版本仅支持无参数查看全部记录）。`);
  }
  return { ok: true, command: { verb: 'reflog' } };
}

// ── M5b：第四章「星际连接」的五个命令 ────────────────────────────────────────

/**
 * 远程名的最小合法性（与分支名同款约束）。
 *
 * ⚠️ 刻意**不**校验 URL —— 那是执行层的白名单职责（`gitApi.isAllowedRemoteUrl`）。
 * 语法层只负责「这个 token 看起来是个名字吗」，把「地址指向哪里」的判断留给
 * 唯一的事实来源，避免两处规则漂移。
 */
function isValidRemoteName(name: string): boolean {
  return name.length > 0 && !name.startsWith('-') && !/\s/.test(name) && !name.includes('..');
}

const REMOTE_NAME_HINT = '远程名不能包含空格，且不能以 - 开头。';

/**
 * `git remote` / `git remote -v` / `git remote add <name> <url>` / `git remote remove <name>`（M5b）
 *
 * ⚠️ 本版本只支持这四种形态。真 git 还有 `set-url` / `rename` / `show` / `prune` 等，
 * 笔记 `git-remotes.md` 也提到了 `set-url` / `rename` —— 它们**不在 GDD §4 第四章的
 * 关卡命令列里**，故不实现，命中时明确回「该版本不支持」（§14），不猜测玩家意图。
 */
function parseRemote(args: string[]): GrammarResult {
  // 无参数 = 列出远程（真 git 的 `git remote`）
  if (args.length === 0) {
    return { ok: true, command: { verb: 'remote', subcommand: 'list' } };
  }

  const [first, ...restArgs] = args;

  // `-v` / `--verbose`：仅影响输出详略（列出 URL），语义与无参数相同
  if (first === '-v' || first === '--verbose') {
    if (restArgs.length > 0) {
      return fail('invalid-usage', `git remote ${first} 不接受其它参数。`);
    }
    return { ok: true, command: { verb: 'remote', subcommand: 'list' } };
  }

  if (first === 'add') {
    const positional = restArgs.filter((arg) => !isFlag(arg));
    const flag = restArgs.find((arg) => isFlag(arg));
    if (flag !== undefined) {
      return fail('invalid-usage', `git remote add 不支持选项 ${flag}。`);
    }
    if (positional.length !== 2) {
      return fail(
        'invalid-usage',
        `git remote add 需要「名称 + 地址」两个参数，例如：git remote add origin http://sandbox/remote.git。` +
          REMOTE_NAME_HINT,
      );
    }
    const [name, url] = positional;
    if (!isValidRemoteName(name)) {
      return fail('invalid-usage', `「${name}」不是有效的远程名。${REMOTE_NAME_HINT}`);
    }
    return { ok: true, command: { verb: 'remote', subcommand: 'add', name, url } };
  }

  // `remove` 的别名 `rm`（真 git 两者等价）
  if (first === 'remove' || first === 'rm') {
    const flag = restArgs.find((arg) => isFlag(arg));
    if (flag !== undefined) {
      return fail('invalid-usage', `git remote ${first} 不支持选项 ${flag}。`);
    }
    if (restArgs.length !== 1) {
      return fail('invalid-usage', `git remote ${first} 需要恰好一个远程名，例如：git remote remove origin。`);
    }
    const [name] = restArgs;
    if (!isValidRemoteName(name)) {
      return fail('invalid-usage', `「${name}」不是有效的远程名。${REMOTE_NAME_HINT}`);
    }
    return { ok: true, command: { verb: 'remote', subcommand: 'remove', name } };
  }

  // 其余子命令（set-url / rename / show / prune …）属本版本范围外
  return fail(
    'invalid-usage',
    `git remote ${first} 在当前版本中尚不支持（本版本支持：git remote、git remote -v、` +
      `git remote add <名称> <地址>、git remote remove <名称>）。`,
  );
}

/** `git clone <url> [<dir>]`（M5b，服务 4-4「克隆宇宙」） */
function parseClone(args: string[]): GrammarResult {
  const positional: string[] = [];
  for (const arg of args) {
    if (isFlag(arg)) {
      return fail('invalid-usage', `git clone 暂不支持选项 ${arg}（如 --depth / --bare）。`);
    }
    positional.push(arg);
  }

  if (positional.length === 0) {
    return fail(
      'invalid-usage',
      'git clone 需要远程地址，例如：git clone http://sandbox/remote.git。',
    );
  }
  if (positional.length > 2) {
    return fail('invalid-usage', 'git clone 最多接受「地址 + 目标目录」两个参数。');
  }

  const [url, dir] = positional;
  // ⚠️ 沙箱内克隆目标恒为 /repo（玩家主仓库）—— 传别的目录会得到一个自己看不到的仓库。
  //    故语法层就拦下，而不是让它「成功但没人能找到」。
  if (dir !== undefined && dir !== '.' && dir !== './') {
    return fail(
      'invalid-usage',
      '本关的克隆目标固定是当前目录（省略目录参数即可），例如：git clone http://sandbox/remote.git。',
    );
  }

  return { ok: true, command: { verb: 'clone', url } };
}

/**
 * 解析 `[<remote>] [<branch>]` 这种「可选远程 + 可选分支」的公共形态。
 *
 * 真 git 的 push / fetch / pull 都接受这种省略写法（`git push` = 推当前分支到
 * 它的上游），故三个命令共用本函数，保证省略语义一致。
 */
function parseRemoteRefArgs(
  verb: 'push' | 'fetch' | 'pull',
  args: string[],
): { ok: true; remote?: string; branch?: string } | { ok: false; error: string } {
  const positional: string[] = [];
  for (const arg of args) {
    if (isFlag(arg)) {
      return { ok: false, error: `git ${verb} 暂不支持选项 ${arg}。` };
    }
    positional.push(arg);
  }

  if (positional.length > 2) {
    return {
      ok: false,
      error: `git ${verb} 最多接受「远程名 + 分支名」两个参数，例如：git ${verb} origin main。`,
    };
  }

  const [remote, branch] = positional;
  if (remote !== undefined && !isValidRemoteName(remote)) {
    return { ok: false, error: `「${remote}」不是有效的远程名。${REMOTE_NAME_HINT}` };
  }
  // 分支名允许 `HEAD` 这类符号引用写法？——不允许：真 git 的分支参数是分支名，
  // 传 `HEAD` 需显式写成 `HEAD:refs/heads/...`（refspec），本版本不支持 refspec。
  if (branch !== undefined && !isValidBranchName(branch)) {
    return { ok: false, error: `「${branch}」不是有效的分支名。${BRANCH_NAME_HINT}` };
  }

  const result: { ok: true; remote?: string; branch?: string } = { ok: true };
  if (remote !== undefined) result.remote = remote;
  if (branch !== undefined) result.branch = branch;
  return result;
}

/** `git push [<remote>] [<branch>]`（M5b，服务 4-2「传送数据」） */
function parsePush(args: string[]): GrammarResult {
  // `--all` / `--tags` / `--force` 等：本版本明确不支持，给出可见提示而非静默忽略
  const unsupportedFlag = args.find(
    (arg) => arg === '--all' || arg === '--tags' || arg === '--force' || arg === '-f',
  );
  if (unsupportedFlag !== undefined) {
    return fail(
      'invalid-usage',
      `git push ${unsupportedFlag} 在当前版本中尚不支持（本版本一次推送一个分支）。`,
    );
  }

  const parsed = parseRemoteRefArgs('push', args);
  if (!parsed.ok) return fail('invalid-usage', parsed.error);

  const command: PushCommand = { verb: 'push', all: false };
  if (parsed.remote !== undefined) command.remote = parsed.remote;
  if (parsed.branch !== undefined) command.branch = parsed.branch;
  return { ok: true, command };
}

/** `git fetch [<remote>] [<branch>]`（M5b，服务 4-3「接收数据」） */
function parseFetch(args: string[]): GrammarResult {
  const parsed = parseRemoteRefArgs('fetch', args);
  if (!parsed.ok) return fail('invalid-usage', parsed.error);

  const command: FetchCommand = { verb: 'fetch' };
  if (parsed.remote !== undefined) command.remote = parsed.remote;
  if (parsed.branch !== undefined) command.branch = parsed.branch;
  return { ok: true, command };
}

/** `git pull [<remote>] [<branch>]`（M5b，服务 4-3「接收数据」） */
function parsePull(args: string[]): GrammarResult {
  // `--rebase` 在笔记里出现过，但它需要 rebase 的冲突处理能力，属本版本范围外
  const flag = args.find((arg) => isFlag(arg));
  if (flag !== undefined) {
    return fail('invalid-usage', `git pull 暂不支持选项 ${flag}（本版本为 fetch + merge）。`);
  }

  const parsed = parseRemoteRefArgs('pull', args);
  if (!parsed.ok) return fail('invalid-usage', parsed.error);

  const command: PullCommand = { verb: 'pull' };
  if (parsed.remote !== undefined) command.remote = parsed.remote;
  if (parsed.branch !== undefined) command.branch = parsed.branch;
  return { ok: true, command };
}


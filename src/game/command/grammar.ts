/**
 * 命令语法校验（development-refinement.md §6.3.2）。
 *
 * 职责：把 token 数组解析成 `git <verb> [flags] [args]` 结构，校验参数个数与合法性，
 * 产出**规范化的判别联合参数对象**。本层只做「认不认得」，不碰 git、不执行任何东西。
 *
 * ⚠️ M1 子集白名单：仅 `init` / `add` / `commit` / `status` / `log`。
 * 其余子命令（branch / checkout / merge / reset / revert / stash / tag / remote /
 * clone / push / fetch / pull …）返回 `kind: 'unsupported'` 的校验结果 ——
 * 依据 §14「grammar 层做子集白名单，超出范围给『该版本不支持』提示而非假装执行」，
 * 绝不落到执行层。
 *
 * 本模块是**纯函数**：无副作用、不 import gitApi / fs / React / zustand。
 * 与 `engine/errors.ts::GitUnsupportedError` 的文案保持一致，见 `unsupportedMessage()`。
 */

/** M1 支持解析的 verb 白名单 */
export const SUPPORTED_VERBS = ['init', 'add', 'commit', 'status', 'log'] as const;

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
export interface CommitCommand {
  verb: 'commit';
  /** `-m <msg>` 提供的提交信息；未提供则为 undefined */
  message?: string;
  /** `-a` / `--all`：提交前自动暂存已跟踪文件的改动 */
  all: boolean;
  /** `--amend`：修补最近一次提交（M1 未实现，由 executor 回「不支持」） */
  amend: boolean;
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
}

/** 命令参数的判别联合 */
export type ParsedCommand = InitCommand | AddCommand | CommitCommand | StatusCommand | LogCommand;

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
    // 与真 git 一致：无 -m 且无编辑器时，不允许消息为空
    if (positional.length > 0) {
      return fail('invalid-usage', '请使用 -m 提供提交信息，例如：git commit -m "初始提交"');
    }
    return fail('invalid-usage', '请提供提交信息，例如：git commit -m "初始提交"');
  }
  if (message.trim().length === 0) {
    return fail('invalid-usage', '提交信息不能为空。');
  }

  return { ok: true, command: { verb: 'commit', message, all, amend } };
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

/** `git log [--oneline] [-n <count>] [--reverse]` */
function parseLog(args: string[]): GrammarResult {
  let oneline = false;
  let reverse = false;
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

  return { ok: true, command: { verb: 'log', oneline, maxCount, reverse } };
}

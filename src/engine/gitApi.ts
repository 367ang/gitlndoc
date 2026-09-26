/**
 * isomorphic-git 薄封装（development-refinement.md §6.2）。
 *
 * 玩家执行的所有命令统一走本模块；这一层只做三件事：
 *   1. 把 gitApi 方法映射到 isomorphic-git 的底层函数；
 *   2. 强制固定学习者身份（对应 `practice/server/gitrunner.mjs` 的 GIT_AUTHOR_* 做法）；
 *   3. 把底层错误归一为 `GitCommandError`（见 `errors.ts`）。
 *
 * 业务逻辑（计分、目标比对、提示）不得进入本层。
 *
 * ⚠️ M1 只实现 `init` / `add` / `commit` / `status` / `log`。
 * branch / checkout / merge / reset / revert / stash / tag / remote / clone /
 * push / fetch / pull 属 M4 / M5，此处刻意缺席 —— 语法层命中这些子命令时，
 * 应回以 `GitUnsupportedError`，而不是伪造执行。
 */

import git from 'isomorphic-git';
import type { FsClient } from 'isomorphic-git';
import { getFs, REPO_DIR } from './fs';
import { GitCommandError, GitResult, GitUnsupportedError, runGit } from './errors';

// --- 固定学习者身份 ---------------------------------------------------------

/** 学习者姓名（与 `practice/server/gitrunner.mjs` 保持一致） */
export const LEARNER_NAME = '练习者';
/** 学习者邮箱 */
export const LEARNER_EMAIL = 'learner@gitlndoc.local';

/** 提交时强制使用的身份，玩家无法伪造 */
export const LEARNER_IDENTITY = {
  name: LEARNER_NAME,
  email: LEARNER_EMAIL,
} as const;

/** 默认分支名，与沙箱约定一致 */
export const DEFAULT_BRANCH = 'main';

// --- 可视化用的返回类型 -----------------------------------------------------

/** 工作区条目在「暂存区 / 工作区」两个维度的状态 */
export type FileState = 'absent' | 'unmodified' | 'modified' | 'added' | 'deleted';

/** 工作区单个条目的可视化信息 */
export interface StatusEntry {
  /** 仓库内相对路径，如 `docs/intro.md` */
  path: string;
  /** 相对 HEAD 的状态 */
  head: FileState;
  /** 相对索引（暂存区）的状态 */
  stage: FileState;
  /** 相对工作区的状态 */
  workdir: FileState;
  /** 是否已进入暂存区（可用于 `git commit`） */
  staged: boolean;
  /** 是否存在未暂存的改动 */
  unstaged: boolean;
  /** 是否为仓库未追踪的新文件 */
  untracked: boolean;
}

/** `status()` 的返回值 */
export interface StatusSummary {
  /** 仓库路径 */
  dir: string;
  /** 当前分支名 */
  branch: string;
  /** 是否为尚无任何提交的「初生」仓库 */
  unborn: boolean;
  /** 全部工作区条目（含未修改文件），按路径排序 */
  entries: StatusEntry[];
  /** 已暂存待提交的条目 */
  staged: StatusEntry[];
  /** 有未暂存改动的条目 */
  unstaged: StatusEntry[];
  /** 未追踪的新文件 */
  untracked: StatusEntry[];
  /** `git status` 风格的可读文本，供终端面板回显 */
  summary: string;
}

/** 提交列表中的一项 */
export interface CommitEntry {
  /** 完整 40 位 SHA-1 */
  hash: string;
  /** 短 hash（前 7 位） */
  shortHash: string;
  /** 提交信息（已去除首尾空白） */
  message: string;
  /** 作者姓名 */
  author: string;
  /** 作者邮箱 */
  authorEmail: string;
  /** 提交时间戳（Unix 秒） */
  timestamp: number;
  /** 提交时间（Date 对象，便于 UI 直接格式化） */
  date: Date;
  /** 时区偏移（分钟，东八区为 -480） */
  timezoneOffset: number;
  /** 父提交 hash 列表；首个提交为空数组 */
  parents: string[];
  /** 是否为根提交 */
  isRoot: boolean;
}

// --- 内部工具 ---------------------------------------------------------------

/** 每次调用可覆盖的仓库位置 */
export interface RepoOptions {
  /** 工作区目录，默认 `'./repo'`（即 `/repo`） */
  dir?: string;
  /** git 目录，默认 `join(dir, '.git')` */
  gitdir?: string;
}

function resolveDir(options: RepoOptions = {}): string {
  return options.dir ?? REPO_DIR;
}

/**
 * 组装 isomorphic-git 的参数对象。
 * ⚠️ 必须在此处（调用时）才向 `getFs()` 取单例：`gitApi` 的方法若在模块作用域捕获
 * `fs`，测试里 `configureFs()` 替换的单例就不会生效。
 */
function fsArgs(options: RepoOptions = {}): { fs: FsClient; dir: string; gitdir?: string } {
  const dir = resolveDir(options);
  const fs = getFs();
  return options.gitdir ? { fs, dir, gitdir: options.gitdir } : { fs, dir };
}

/** 把路径统一成仓库内的相对路径，便于回显与去重 */
function normalizeRepoPath(dir: string, filepath: string): string {
  if (!filepath.startsWith(dir + '/')) return filepath;
  return filepath.slice(dir.length + 1);
}

// isomorphic-git 的 statusMatrix 三列编码，见其索引文档：
//   head:    0 = 不在 HEAD，1 = 在 HEAD
//   workdir: 0 = 缺失，1 = 与 HEAD 相同，2 = 与 HEAD 不同
//   stage:   0 = 不在索引，1 = 与 HEAD 相同，2 = 与 HEAD 不同，3 = 与工作区不同
//
// ⚠️ 同一数值在不同列含义不同，且 `2` 的语义依赖 head 列：
//   `stage=2` 在 `head=1` 时是「已暂存的修改」，在 `head=0` 时是「新增」（真 git 显示 `A`）。
// 因此索引列的最终语义由调用处结合 head 判定，而非在此处单值映射。
function decodeState(value: number): FileState {
  switch (value) {
    case 0:
      return 'absent';
    case 1:
      return 'unmodified';
    case 2:
      return 'modified';
    case 3:
      return 'added';
    default:
      return 'absent';
  }
}

/**
 * 索引列（第三列）的语义 —— 即真 git `status -s` 的**第一列**。
 *
 * `stage` 的单值含义依赖 `head`，故不能直接 `decodeState(stage)`。实测矩阵与真 git 对照：
 *
 * | head | workdir | stage | 场景 | 真 git | 本函数 |
 * |---|---|---|---|---|---|
 * | 0 | 2 | 0 | 新增、未 add | `??` | absent（未入索引，由 untracked 承载） |
 * | 0 | 2 | 2 | 新增、已 add | `A ` | added |
 * | 1 | 1 | 1 | 未改动 | `  ` | unmodified |
 * | 1 | 2 | 1 | 工作区改写、未 add | ` M` | unmodified |
 * | 1 | 2 | 2 | 改写、已 add | `M ` | modified |
 * | 1 | 0 | 1 | 删除、未暂存 | ` D` | unmodified |
 * | 1 | 0 | 0 | 删除、已暂存 | `D ` | absent（从索引移除 = 暂存删除） |
 * | 1 | 0 | 3 | add 后又从工作区删除 | `MD` | modified |
 *
 * `FileState` 里用 `'absent'` 承载「已从索引移除」的语义，UI 据此渲染 `D`。
 */
function decodeStageState(head: number, stage: number): FileState {
  // 新增到索引
  if (head === 0 && stage === 2) return 'added';
  // 已跟踪且索引与工作区不一致：索引相对 HEAD 仍是「修改」（含「add 后又删除」）
  if (head === 1 && stage === 3) return 'modified';
  // 路径已从索引移除，但在 HEAD 中存在 → 暂存删除
  if (head === 1 && stage === 0) return 'absent';
  return decodeState(stage);
}

/**
 * 取索引（暂存区）中每个路径对应的 blob oid。
 * 用 `walk` + `STAGE()`：这是唯一在「初生仓库」（HEAD 尚不存在）下也能拿到索引 oid 的途径，
 * `resolveRef(':path')` 与逐一 `readBlob` 都不行（实测前者在未提交时抛 NotFoundError）。
 */
async function readIndexOids(
  base: ReturnType<typeof fsArgs>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  try {
    await git.walk({
      ...base,
      trees: [git.STAGE()],
      map: async (filepath, entries) => {
        const entry = entries[0];
        if (!entry || filepath === '.') return undefined;
        if ((await entry.type()) !== 'blob') return undefined;
        result.set(filepath, await entry.oid());
        return undefined;
      },
    });
  } catch {
    // 索引不可读（如仓库尚未 init）时返回空表，交由调用方按「未追踪」处理
  }
  return result;
}

/** 取 HEAD 树中每个路径对应的 blob oid；无提交时返回空表 */
async function readHeadOids(base: ReturnType<typeof fsArgs>): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  try {
    const head = await git.resolveRef({ ...base, ref: 'HEAD' });
    const { commit } = await git.readCommit({ ...base, oid: head });
    const { tree } = await git.readTree({ ...base, oid: commit.tree });
    for (const entry of tree) result.set(entry.path, entry.oid);
  } catch {
    // 初生仓库无 HEAD
  }
  return result;
}

/**
 * 把工作区文件内容与其「已入库版本」做 **内容哈希比对**，判断工作区是否真的被改动。
 *
 * ⚠️ 为什么不能直接用 `git.status()` / `statusMatrix()` 的工作区列：
 * isomorphic-git 的索引带 stat 缓存（mtime + size），而 LightningFS 对同一毫秒内的改写
 * 会给出相同的 mtime；于是**等长改写**（如 `hi\n` → `v2\n`，都是 3 字节）会被误判为未改动。
 * 实测：真 git 对同样场景报 ` M a.txt`，而 isomorphic-git 报 `unmodified`。
 * 故此处绕开 stat 缓存，直接比内容哈希 —— 与真 git 的判定方式一致。
 *
 * 比对基准取**索引中的版本**（暂存区），而非 HEAD：这样才能正确区分
 * 「新增并已 add（工作区与索引一致 → 未暂存改动）」与「add 后又改了工作区（→ 有未暂存改动）」。
 *
 * @returns `'unmodified'` | `'modified'` | `'deleted'` | `'absent'`
 */
async function compareWorkdir(
  base: ReturnType<typeof fsArgs>,
  filepath: string,
  indexOids: Map<string, string>,
  headOids: Map<string, string>,
): Promise<FileState> {
  const trackedOid = indexOids.get(filepath) ?? headOids.get(filepath);

  let content: Uint8Array;
  try {
    // 直接读工作区文件本体：不经过 git 对象库，因而不受索引 stat 缓存影响
    content = await getFs().promises.readFile(`${base.dir}/${filepath}`);
  } catch {
    // 文件不在工作区：仍被索引/HEAD 追踪才算「删除」
    return trackedOid ? 'deleted' : 'absent';
  }

  if (!trackedOid) return 'modified';
  const { oid } = await git.hashBlob({ object: content });
  return oid === trackedOid ? 'unmodified' : 'modified';
}

/** 「初生」仓库：HEAD 尚未指向任何提交，此时 statusMatrix / log 都会抛 NotFoundError */
function isUnbornRepoError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const { code, data } = error as { code?: string; data?: { what?: string } };
  if (code !== 'NotFoundError') return false;
  const what = data?.what;
  return what === 'HEAD' || what === undefined || what.startsWith('refs/heads/');
}

// --- 公共 API ---------------------------------------------------------------

/** `git init` —— 在 `dir` 下初始化仓库，默认分支 `main` */
export async function init(options: RepoOptions = {}): Promise<GitResult<void>> {
  const dir = resolveDir(options);
  return runGit('git init', () =>
    git.init({ fs: getFs(), dir, defaultBranch: DEFAULT_BRANCH }).then(() => undefined),
  );
}

/**
 * `git add <paths>` —— 把工作区内容登记到索引（暂存区）。
 *
 * 与真实 git 对齐的两点：
 *   - 路径不存在 → 报 `NotFoundError`（isomorphic-git 的 `add` 不做删除暂存）。
 *   - 目录路径 → 递归收录目录下所有文件（isomorphic-git `add` 的既有行为）。
 *     真 git 会提示 `pathspec is a directory`，此处保留底层能力，便于关卡脚本使用。
 *     因此 `git add .` 需由 `executor`（T6）先展开为具体路径列表，本层不展开。
 *
 * 工作区中已被删除的文件应改用 `remove()` 暂存其删除，而非 `add()`。
 */
export async function add(
  paths: string | string[],
  options: RepoOptions = {},
): Promise<GitResult<void>> {
  const list = (Array.isArray(paths) ? paths : [paths])
    .map((path) => path.trim())
    .filter((path) => path.length > 0);
  const command = `git add ${list.join(' ')}`.trim();

  if (list.length === 0) {
    return {
      ok: false,
      error: new GitCommandError('InvalidFilepathError', '请指定要暂存的文件路径。', 'No filepath provided.', {
        command: 'git add',
        hint: '例如：git add README.md',
      }),
    };
  }

  return runGit(command, () =>
    git
      .add({ fs: getFs(), dir: resolveDir(options), gitdir: options.gitdir, filepath: list })
      .then(() => undefined),
  );
}

/** `git rm --cached` 的等价操作：把文件从索引中移除（工作区文件保留） */
export async function remove(
  paths: string | string[],
  options: RepoOptions = {},
): Promise<GitResult<void>> {
  const list = Array.isArray(paths) ? paths : [paths];
  const command = `git rm --cached ${list.join(' ')}`;
  return runGit(command, async () => {
    const dir = resolveDir(options);
    for (const filepath of list) {
      await git.remove({ fs: getFs(), dir, gitdir: options.gitdir, filepath: normalizeRepoPath(dir, filepath) });
    }
  });
}

/** `git commit -m <message>` —— 用当前索引创建提交，作者与提交者均为固定学习者身份 */
export async function commit(
  message: string,
  options: RepoOptions = {},
): Promise<GitResult<string>> {
  const text = message.trim();
  const command = `git commit -m "${text}"`;

  // --- 空提交防御（M3 修复 M2 §5.1 的保真缺陷） --------------------------------
  // 真 git 在「暂存区与 HEAD 完全一致」时拒绝提交（exit 1 "nothing to commit"）。
  // isomorphic-git 的 `git.commit` 无条件创建提交，此前本引擎允许真 git 会拒绝的
  // 空提交 —— 1-4「历史之链」的「没有新内容就没有新快照」教学点可被绕过（实测）。
  //
  // 判据复用 status() 的既有推导（staged 来自 statusMatrix + 内容哈希比对，
  // 修过等长改写误报等两个真实缺陷，见 status() 注释），不自行重算状态：
  //   - 有 staged 条目（索引相对 HEAD 有变化，或初生仓库有新暂存）→ 可提交；
  //   - 初生仓库（无 HEAD）：unborn 为 true，只要有 staged 条目即可提交；
  //     索引也为空则真 git 会报「nothing to commit (unborn branch)」，同样拒绝。
  const statusResult = await status(options);
  if (statusResult.ok && statusResult.value.staged.length === 0) {
    const unborn = statusResult.value.unborn;
    return {
      ok: false,
      error: new GitCommandError(
        'NoCommitError',
        unborn
          ? '空仓库里没有可提交的内容 —— 先用 git add 把改动送入暂存区。'
          : '没有可提交的内容（暂存区与最近一次快照一致）—— 先用 git add 暂存新的改动。',
        'nothing to commit, working tree clean',
        {
          command,
          hint: '先用 git add <文件>（或 git add .）把要归档的内容送入暂存区，再提交。',
        },
      ),
    };
  }
  if (!statusResult.ok) {
    // status 本身失败（如仓库未 init）：按原样向调用方报错，不伪装成「可提交」
    return { ok: false, error: statusResult.error };
  }

  return runGit(command, () =>
    git.commit({
      fs: getFs(),
      dir: resolveDir(options),
      gitdir: options.gitdir,
      message: text,
      author: { ...LEARNER_IDENTITY },
      committer: { ...LEARNER_IDENTITY },
    }),
  );
}

/**
 * `git status` —— 返回工作区条目列表。
 *
 * `statusMatrix` 提供条目全集，但它的三列编码**信息量不足**，实测有两处歧义：
 *   1. 「已暂存且工作区一致」与「已暂存且工作区又有改动」都返回 `[., 2, 2]`
 *      （例：未追踪文件 `git add` 后，与已提交文件修改后再 `git add`，矩阵无法区分）；
 *   2. 「未修改」与「仅工作区有改动」都返回 `[1, 1, 1]`。
 * 因此对每个条目再取一次 `git.status()` 的权威单文件语义（`*` 前缀 = 有未暂存改动）。
 * 代价是每文件一次调用 —— 关卡仓库刻意保持精简（§14），可接受。
 */
export async function status(options: RepoOptions = {}): Promise<GitResult<StatusSummary>> {
  const dir = resolveDir(options);
  const base = fsArgs(options);

  return runGit('git status', async () => {
    let branch: string;
    try {
      branch = (await git.currentBranch({ ...base, fullname: false })) ?? DEFAULT_BRANCH;
    } catch {
      branch = DEFAULT_BRANCH;
    }

    let matrix: Awaited<ReturnType<typeof git.statusMatrix>>;
    try {
      matrix = await git.statusMatrix(base);
    } catch (error) {
      if (!isUnbornRepoError(error)) throw error;
      // 初生仓库没有可遍历的 HEAD 树，索引与工作区可能仍有待提交内容
      matrix = [];
    }

    // 索引与 HEAD 的 oid 表各取一次，供逐个条目做内容比对（避免每文件重复遍历）
    const indexOids = await readIndexOids(base);
    const headOids = await readHeadOids(base);

    const entries: StatusEntry[] = [];
    for (const [filepath, head, workdir, stage] of matrix) {
      // 未追踪 = 既不在 HEAD、也不在索引，且文件确实存在于工作区
      const untracked = head === 0 && stage === 0 && workdir !== 0;

      // 已暂存 = 索引相对 HEAD 有变化；路径已从索引移除（stage=0）但仍在 HEAD → 也是暂存删除。
      // 已对 9 种 head/stage 组合逐一比对真 git 的 `status -s` 首列（非空格即已暂存），全部一致。
      const staged = stage !== 0 ? stage !== 1 : head === 1;

      // 工作区是否有未暂存改动：与索引中的版本做内容哈希比对（不走 stat 缓存）。
      // 未追踪文件尚无索引态可言，归入 untracked，不计入 unstaged（与真 git 的 `??` 一致）。
      const workdirState = untracked
        ? decodeState(workdir)
        : await compareWorkdir(base, filepath, indexOids, headOids);

      entries.push({
        path: filepath,
        head: decodeState(head),
        stage: decodeStageState(head, stage),
        workdir: workdirState,
        staged,
        unstaged: !untracked && (workdirState === 'modified' || workdirState === 'deleted'),
        untracked,
      });
    }

    entries.sort((a, b) => a.path.localeCompare(b.path));

    const staged = entries.filter((entry) => entry.staged);
    const unstaged = entries.filter((entry) => entry.unstaged);
    const untracked = entries.filter((entry) => entry.untracked);

    return {
      dir,
      branch,
      unborn: !(await hasHeadCommit(base)),
      entries,
      staged,
      unstaged,
      untracked,
      summary: composeStatusSummary(branch, staged, unstaged, untracked),
    };
  });
}

/** HEAD 是否已指向某个提交 */
async function hasHeadCommit(base: ReturnType<typeof fsArgs>): Promise<boolean> {
  try {
    await git.resolveRef({ ...base, ref: 'HEAD' });
    return true;
  } catch {
    return false;
  }
}

/** 组装 `git status` 风格的可读文本 */
function composeStatusSummary(
  branch: string,
  staged: StatusEntry[],
  unstaged: StatusEntry[],
  untracked: StatusEntry[],
): string {
  const lines: string[] = [`位于分支 ${branch}`];
  if (staged.length === 0 && unstaged.length === 0 && untracked.length === 0) {
    lines.push('无文件要提交，干净的工作区');
    return lines.join('\n');
  }

  if (staged.length > 0) {
    lines.push('', '要提交的变更：');
    for (const entry of staged) {
      lines.push(`\t${entry.head === 'absent' ? '新文件' : '修改'}：${entry.path}`);
    }
  }
  if (unstaged.length > 0) {
    lines.push('', '尚未暂存以备提交的变更：');
    for (const entry of unstaged) {
      lines.push(`\t修改：${entry.path}`);
    }
  }
  if (untracked.length > 0) {
    lines.push('', '未跟踪的文件：');
    for (const entry of untracked) {
      lines.push(`\t${entry.path}`);
    }
  }
  return lines.join('\n');
}

/**
 * `git log` —— 返回提交列表（默认从新到旧，与真实 git 一致）。
 *
 * 中文提交信息包含换行，此处统一 `trim()`；`%s` 风格的首行摘要可由 UI 自行截取。
 */
export async function log(
  options: RepoOptions & { depth?: number } = {},
): Promise<GitResult<CommitEntry[]>> {
  const base = { ...fsArgs(options), depth: options.depth };
  return runGit('git log', async () => {
    let commits: Awaited<ReturnType<typeof git.log>>;
    try {
      commits = await git.log(base);
    } catch (error) {
      if (!isUnbornRepoError(error)) throw error;
      return [];
    }

    return commits.map(({ oid, commit }) => ({
      hash: oid,
      shortHash: oid.slice(0, 7),
      message: commit.message.trim(),
      author: commit.author.name,
      authorEmail: commit.author.email,
      timestamp: commit.author.timestamp,
      date: new Date(commit.author.timestamp * 1000),
      timezoneOffset: commit.author.timezoneOffset,
      parents: commit.parent,
      isRoot: commit.parent.length === 0,
    }));
  });
}

/**
 * 语法层白名单之外的子命令统一出口。
 *
 * 这是 §14「超出范围给『该版本不支持』提示，而非假装执行」的落点：
 * M1 未实现的 branch/checkout/merge/reset/revert/stash/tag/remote/clone/
 * push/fetch/pull 都应命中此函数，返回 `GitUnsupportedError`。
 */
export function unsupported(subcommand: string): GitResult<never> {
  return { ok: false, error: new GitUnsupportedError(subcommand) };
}

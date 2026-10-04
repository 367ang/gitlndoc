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
 * M4 扩展：branch / checkout / merge / rebase / rm（真删）/ diff / logAll，
 * 以及 commit 的 MERGE_HEAD 双亲机制 —— 见各函数处注释。
 * M5a 扩展：reset / restore / revert / reflog + HEAD@{n}；M5b 扩展：remote / clone / push / fetch / pull。
 * M6 扩展：tag（createTag / listTags / deleteTag / resolveTagTarget —— 第六章「历史锚点」）；
 * 语法层命中未落地子命令（stash 等）时回 `GitUnsupportedError`，而不是伪造执行。
 */

import git from 'isomorphic-git';
import type { FsClient } from 'isomorphic-git';
import { fsp, getFs, REPO_DIR } from './fs';
import { GitCommandError, GitResult, GitUnsupportedError, runGit } from './errors';
import { createRemoteHttpClient } from './fileRemote';
import { looksLikeHash, parseRefExpr } from './refExpr';
import {
  formatReflog,
  recordInitialCommit,
  recordRefMove,
  resolveReflogEntry,
} from './reflog';

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

/** `git commit -m <message>` 的返回值 */
export interface CommitResult {
  /** 新提交的完整 SHA-1 */
  hash: string;
  /** 提交所在分支（M4 起真实读取；M1 时 executor 曾硬编码 `main`） */
  branch: string;
  /** 是否为合并提交（MERGE_HEAD 机制，见 commit() 注释） */
  merge: boolean;
  /** 是否为 `--amend` 修补（M5a）：被替换掉的旧提交 hash，非 amend 时为 undefined */
  amendedFrom?: string;
}

/** `commit()` 的可选行为（M5a） */
export interface CommitOptions extends RepoOptions {
  /** `--amend`：修补最近一次提交（替换它，而不是在其上追加） */
  amend?: boolean;
}

/** MERGE_HEAD 引用名：存在即表示「一次合并进行中，待完成提交」 */
const MERGE_HEAD_REF = 'MERGE_HEAD';

/**
 * 读取 MERGE_HEAD；不存在时返回 null（这是正常路径，不是错误）。
 */
async function readMergeHead(base: ReturnType<typeof fsArgs>): Promise<string | null> {
  try {
    return await git.resolveRef({ ...base, ref: MERGE_HEAD_REF });
  } catch {
    return null;
  }
}

/**
 * `git commit -m <message>` —— 用当前索引创建提交，作者与提交者均为固定学习者身份。
 *
 * 返回值自 M4 起为 `CommitResult`（含分支名）：executor 的 commit 回显需要真实分支
 * （M1 曾硬编码 `main`，分支切换后会显示错误分支）。
 *
 * ── MERGE_HEAD 双亲机制（M4，模拟真 git 的合并提交语义）──────────────────
 *
 * isomorphic-git 的 `git.merge` 能自己产出 merge commit，但**冲突合并**（`abortOnConflict:
 * false`）抛 `MergeConflictError` 后不留下任何「合并进行中」的痕迹 —— 而真 git 会写
 * MERGE_HEAD，让随后的 `git commit` 自动成为双亲合并提交。3-4「冲突消解」的完整流程
 * （merge 冲突 → 手改文件 → add → commit）必须依赖这个语义。
 *
 * 因此 gitApi 自己维护 MERGE_HEAD（见 `merge()`）：
 *   - `merge()` 冲突返回时写入 `MERGE_HEAD`（对端提交）；
 *   - 本函数检测到 MERGE_HEAD 存在 → 以 `[HEAD, MERGE_HEAD]` 为双亲构造提交（绕过
 *     isomorphic-git 的单亲默认），提交后删除 MERGE_HEAD（对齐真 git 的「完成合并」）；
 *   - 空提交防御照常生效：解决冲突后索引与 HEAD 必有差异，不受双亲影响。
 *
 * ── `--amend` 修补（M5a，服务 5-1「修正笔误」）───────────────────────────
 *
 * 底层用 isomorphic-git 的 `git.commit({ amend: true })`（探针实测可用）：
 * 新提交的 **parent 仍是原提交的父**，旧提交成为孤儿、`git log` 不再列出 —— 与真 git 一致。
 *
 * ⚠️ **空修补防御**（探针实测的真 git 差异，必须补）：
 * 真 git 在「索引树与父提交树相同」时拒绝 amend（`You have nothing to amend`），
 * 而 isomorphic-git **照样产出新提交**。若不拦，5-1 可以「什么都不改直接
 * `git commit --amend`」蒙过去，教学点（先把漏掉的文件补进暂存区再修补）形同虚设。
 * 判据复用上面那道空提交防御的同一份 `status()` 推导，不重复实现。
 *
 * @example
 * ```ts
 * const result = await gitApi.commit('初始提交');
 * if (result.ok) console.log(result.value.branch); // → 'main'
 * ```
 */
export async function commit(
  message: string,
  options: CommitOptions = {},
): Promise<GitResult<CommitResult>> {
  const text = message.trim();
  const amend = options.amend === true;
  const command = amend ? `git commit --amend -m "${text}"` : `git commit -m "${text}"`;

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
  //
  // ⚠️ amend 的语义略有不同：真 git 允许「只改提交信息、内容不变」的 amend
  // （笔记 5-1 的第二个场景就是改错别字）。因此 amend 路径下「无 staged 改动」
  // 只在**提交信息也与原提交相同**时才拒绝 —— 那才是真 git 的 nothing to amend。
  const statusResult = await status(options);
  if (!statusResult.ok) {
    // status 本身失败（如仓库未 init）：按原样向调用方报错，不伪装成「可提交」
    return { ok: false, error: statusResult.error };
  }
  if (statusResult.value.staged.length === 0) {
    const unborn = statusResult.value.unborn;
    const originalMessage = amend ? await headCommitMessage(options) : null;
    const messageUnchanged = amend && originalMessage !== null && originalMessage === text;

    if (!amend || messageUnchanged) {
      return {
        ok: false,
        error: new GitCommandError(
          'NoCommitError',
          amend
            ? '没有可修补的内容（暂存区与最近一次快照一致，提交信息也没有变化）。'
            : unborn
              ? '空仓库里没有可提交的内容 —— 先用 git add 把改动送入暂存区。'
              : '没有可提交的内容（暂存区与最近一次快照一致）—— 先用 git add 暂存新的改动。',
          amend ? 'nothing to amend' : 'nothing to commit, working tree clean',
          {
            command,
            hint: amend
              ? '先把要补进这次快照的文件 git add 进来，或改写提交信息，再执行 --amend。'
              : '先用 git add <文件>（或 git add .）把要归档的内容送入暂存区，再提交。',
          },
        ),
      };
    }
  }

  const base = fsArgs(options);
  const mergeHead = await readMergeHead(base);

  return runGit(command, async () => {
    const previous = await unbornSafeHead(base);

    // 合并进行中：双亲 = [HEAD, MERGE_HEAD]，提交后移除 MERGE_HEAD（真 git 的完成合并语义）。
    // 注意绕过空提交防御的值路径：`git.commit` 不接受 parent 参数，故此处直接用底层 `_commit`
    // 的公开对应 `git.commit({ parent })`——它接受显式 parent 列表，跳过 resolveRef 的单亲推导。
    // ⚠️ amend 与 MERGE_HEAD 不该同时出现（真 git 会拒绝「合并中 amend」）；
    // 这里以 amend 优先并继续走双亲逻辑会产生难以解释的结果，故显式拒绝。
    if (amend && mergeHead !== null) {
      throw new GitCommandError(
        'MergeNotSupportedError',
        '合并进行中不能使用 --amend —— 请先用 git commit 完成这次合并。',
        `--amend during merge is not supported`,
        { command },
      );
    }

    const hash = amend
      ? await git.commit({
          ...base,
          message: text,
          author: { ...LEARNER_IDENTITY },
          committer: { ...LEARNER_IDENTITY },
          amend: true,
        })
      : mergeHead
        ? await git.commit({
            ...base,
            message: text,
            author: { ...LEARNER_IDENTITY },
            committer: { ...LEARNER_IDENTITY },
            parent: [previous as string, mergeHead],
          })
        : await git.commit({
            ...base,
            message: text,
            author: { ...LEARNER_IDENTITY },
            committer: { ...LEARNER_IDENTITY },
          });

    if (mergeHead) {
      await git.deleteRef({ ...base, ref: MERGE_HEAD_REF });
    }

    // --- reflog（M5a）--------------------------------------------------------
    // 记在 ref 写入出口，供 `git reflog` 与 `HEAD@{n}` 使用。
    // amend 在真 git 的 reflog 里同样记为一条 commit (amend) 记录。
    if (amend) {
      recordRefMove(options, {
        from: previous ?? NULL_OID_PLACEHOLDER,
        to: hash,
        action: 'commit (amend)',
      });
    } else if (previous === null) {
      recordInitialCommit(options, hash);
    } else {
      recordRefMove(options, { from: previous, to: hash, action: 'commit' });
    }

    const branch = (await git.currentBranch({ ...base, fullname: false })) ?? DEFAULT_BRANCH;
    const result: CommitResult = { hash, branch, merge: mergeHead !== null };
    if (amend && previous !== null) result.amendedFrom = previous;
    return result;
  });
}

/** 全 0 oid：真 git 用它表示「此前没有提交」 */
const NULL_OID_PLACEHOLDER = '0'.repeat(40);

/** 取 HEAD 指向的提交 oid；无提交（初生仓库）时返回 null */
async function unbornSafeHead(base: ReturnType<typeof fsArgs>): Promise<string | null> {
  try {
    return await git.resolveRef({ ...base, ref: 'HEAD' });
  } catch {
    return null;
  }
}

/** 取 HEAD 提交的信息（trim 后）；无提交时返回 null。amend 的空修补判据用 */
async function headCommitMessage(options: RepoOptions): Promise<string | null> {
  const base = fsArgs(options);
  const head = await unbornSafeHead(base);
  if (head === null) return null;
  try {
    const { commit: headCommit } = await git.readCommit({ ...base, oid: head });
    return headCommit.message.trim();
  } catch {
    return null;
  }
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

      // .gitignore 过滤（M4，2-4「移除与忽略」的引擎依据）：
      // 真 git 对被忽略文件不做任何显示 —— 不进 status、不被 add。
      // isomorphic-git 的 statusMatrix 不认识 .gitignore（探针实测：ignored 文件
      // 仍以 untracked 形态出现在矩阵里），故此处对 untracked 条目显式过滤。
      // ⚠️ isIgnored 只接受文件路径（对目录规则 `build/` 本身返回 false，探针实测），
      // 而矩阵条目恒为文件，语义恰好吻合。追踪中（已提交/已暂存）的文件不受影响 ——
      // 与真 git 一致：.gitignore 只对未追踪文件生效。
      if (untracked) {
        try {
          if (await git.isIgnored({ ...base, filepath })) continue;
        } catch {
          // 无 .gitignore 时 isIgnored 正常返回 false；此处兜底任何异常都不过滤
        }
      }

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
 * 从**指定提交**开始的提交列表（`git log <ref>`）。
 *
 * `log()` 只走 HEAD；targetState 的 `logOrder` 判定需要读**任意分支**的历史
 * （如变基后 feature 分支的提交顺序），故补这个按 ref 取历史的出口。
 */
export async function logWithRef(
  ref: string,
  options: RepoOptions & { depth?: number } = {},
): Promise<GitResult<CommitEntry[]>> {
  const base = { ...fsArgs(options), ref, depth: options.depth };
  return runGit(`git log ${ref.slice(0, 7)}`, async () => {
    const commits = await git.log(base);
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
 * `git rm <paths>` —— 从工作区**与索引**同时移除文件（真删，与 M1 的 `remove()` 不同：
 * 那是 `--cached` 语义，只动索引、保留工作区文件）。
 *
 * 实现走 fs 层删除 + isomorphic-git 的 `remove`（索引移除），两步都完成后
 * 该文件的删除状态才是「已暂存的删除」（`git status -s` 首列 `D`）。
 *
 * @param paths 仓库相对路径列表；路径不存在于工作区时报 NotFoundError（对齐真 git）
 */
export async function removePaths(
  paths: string[],
  options: RepoOptions = {},
): Promise<GitResult<string[]>> {
  const list = paths.map((path) => path.trim()).filter((path) => path.length > 0);
  const command = `git rm ${list.join(' ')}`;

  if (list.length === 0) {
    return {
      ok: false,
      error: new GitCommandError('InvalidFilepathError', '请指定要移除的文件路径。', 'No filepath provided.', {
        command: 'git rm',
        hint: '例如：git rm secrets.log',
      }),
    };
  }

  return runGit(command, async () => {
    const dir = resolveDir(options);
    const base = fsArgs(options);
    const removed: string[] = [];
    for (const filepath of list) {
      const relative = normalizeRepoPath(dir, filepath);
      const absolute = `${dir}/${relative}`;
      // 先确认工作区存在（真 git 对不存在的 tracked 路径报 fatal: pathspec ... did not match）
      await fsp.stat(absolute);
      // ⚠️ 仅追踪中的文件可 rm：HEAD 与索引里都没有 → 对齐真 git 报错（探针 42 实测：
      // isomorphic-git 的 remove 对 untracked 路径静默成功但什么都不做）。
      // 2-4 的教学语义依赖这一点：git rm 只对「已归档过的文件」生效。
      const headOids = await readHeadOids(base);
      const indexOids = await readIndexOids(base);
      if (!headOids.has(relative) && !indexOids.has(relative)) {
        throw new GitCommandError(
          'NotFoundError',
          `${relative} 尚未被 Git 追踪，git rm 无法移除它。`,
          `git rm: pathspec '${relative}' did not match any files`,
          { command, hint: 'git rm 只对「已被追踪」的文件生效；未追踪文件直接忽略它即可。' },
        );
      }
      await fsp.unlink(absolute);
      await git.remove({ ...base, filepath: relative });
      removed.push(relative);
    }
    return removed;
  });
}

/** `diff()` 的单个文件差异 */
export interface DiffEntry {
  /** 仓库相对路径 */
  path: string;
  /** 差异类型 */
  kind: 'added' | 'deleted' | 'modified';
  /** 差异行（`+` / `-` 前缀，不含上下文行 —— 教学场景够用） */
  lines: string[];
}

/**
 * 逐文件做朴素行级 diff（LCS 的教学简化版：按行集合差 + 顺序对齐）。
 *
 * ⚠️ isomorphic-git 没有 diff 命令（§6.2 表），此处用「双指针顺序对齐」实现：
 * 相同前缀/后缀跳过，中段的删除行（旧独有）+ 新增行（新独有）分别列出。
 * 不做块移动检测 —— 关卡仓库是几行的文本文件，教学场景完全够用。
 */
function diffLines(oldText: string, newText: string): string[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // 公共前缀
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start += 1;
  }
  // 公共后缀（不与前缀重叠）
  let endOld = oldLines.length;
  let endNew = newLines.length;
  while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) {
    endOld -= 1;
    endNew -= 1;
  }

  const lines: string[] = [];
  for (let i = start; i < endOld; i += 1) lines.push(`-${oldLines[i]}`);
  for (let i = start; i < endNew; i += 1) lines.push(`+${newLines[i]}`);
  return lines;
}

/** 读一个 tree 中指定路径的 blob 文本；路径不存在返回 undefined。
 *  ⚠️ `ref` 既可以是 commit oid（配合 filepath 在树内查找），也可以直接是 blob oid（单对象读取）：
 *  isomorphic-git 的 readBlob 只接受 tree 遍历或裸 blob —— 传入 blob oid + filepath 会抛
 *  ObjectTypeError（实测），故两种形态必须区分。 */
async function readBlobText(
  base: ReturnType<typeof fsArgs>,
  ref: string | undefined,
  filepath?: string,
): Promise<string | undefined> {
  if (!ref) return undefined;
  try {
    const { blob } = await git.readBlob(
      filepath === undefined ? { ...base, oid: ref } : { ...base, oid: ref, filepath },
    );
    return new TextDecoder().decode(blob);
  } catch {
    return undefined;
  }
}

/** 对单文件取两版内容并产出 DiffEntry；内容相同返回 null。
 *  `oldRef`/`newRef` 可以是 commit/tree oid（配 filepath）或 blob oid（不配 filepath）。 */
async function diffFile(
  base: ReturnType<typeof fsArgs>,
  oldRef: string | undefined,
  newRef: string | undefined,
  filepath: string,
  opts: { refsAreBlobs?: { old: boolean; new: boolean } } = {},
): Promise<DiffEntry | null> {
  const blobs = opts.refsAreBlobs;
  const oldText = await readBlobText(base, oldRef, blobs?.old ? undefined : filepath);
  const newText = await readBlobText(base, newRef, blobs?.new ? undefined : filepath);
  if (oldText === newText) return null;

  const kind: DiffEntry['kind'] = oldText === undefined ? 'added' : newText === undefined ? 'deleted' : 'modified';
  return { path: filepath, kind, lines: diffLines(oldText ?? '', newText ?? '') };
}

/** 收集一个 tree 的全部 blob 路径 */
async function treePaths(base: ReturnType<typeof fsArgs>, ref: string | undefined): Promise<Set<string>> {
  const paths = new Set<string>();
  if (!ref) return paths;
  await git.walk({
    ...base,
    trees: [git.TREE({ ref })],
    map: async (filepath, entries) => {
      const entry = entries[0];
      if (entry && filepath !== '.' && (await entry.type()) === 'blob') paths.add(filepath);
      return undefined;
    },
  });
  return paths;
}

/**
 * `git diff` / `git diff --staged` —— 工作区改动或已暂存改动的行级差异。
 *
 * 真实语义对照（isomorphic-git 无 diff，此处用 walk 比对 blob 实现）：
 *   - 无 `--staged`：索引 vs 工作区 —— 「还没暂存的改动」；
 *   - 有 `--staged`：HEAD vs 索引 —— 「已暂存、将要提交的改动」。
 *
 * 工作区一侧直接读 fs 文件（绕开索引 stat 缓存，理由同 `compareWorkdir`）。
 * 返回空数组表示没有差异 —— 与真 git 的「无输出」一致。
 */
export async function diff(
  options: RepoOptions & { staged?: boolean } = {},
): Promise<GitResult<DiffEntry[]>> {
  const base = fsArgs(options);
  return runGit(options.staged ? 'git diff --staged' : 'git diff', async () => {
    // HEAD tree（可能不存在 —— 初生仓库）
    let headOid: string | undefined;
    try {
      headOid = await git.resolveRef({ ...base, ref: 'HEAD' });
    } catch {
      headOid = undefined;
    }

    // 索引 tree：经 STAGE() walker 取每个路径的 oid
    const indexOids = await readIndexOids(base);

    const entries: DiffEntry[] = [];

    if (options.staged) {
      // HEAD vs 索引：索引侧拿到的是 **blob oid**（readIndexOids），须按裸 blob 读
      const headPaths = await treePaths(base, headOid);
      const paths = new Set([...headPaths, ...indexOids.keys()]);
      for (const path of [...paths].sort()) {
        const indexOid = indexOids.get(path);
        const entry = await diffFile(base, headOid, indexOid, path, {
          refsAreBlobs: { old: false, new: indexOid !== undefined },
        });
        if (entry) entries.push(entry);
      }
      return entries;
    }

    // 索引 vs 工作区：真 git 的 `git diff`（不带 --staged）**不显示**未追踪文件，
    // 故遍历只覆盖索引中已有的路径。
    for (const [path, indexOid] of indexOids) {
      let text: string | undefined;
      try {
        text = new TextDecoder().decode(await getFs().promises.readFile(`${base.dir}/${path}`));
      } catch {
        text = undefined; // 工作区已删除
      }
      // 索引侧拿到的是 blob oid，须按裸 blob 读（readBlob 的 ObjectTypeError 陷阱见上方注释）
      const indexText = await readBlobText(base, indexOid);
      if (text === indexText) continue;
      const kind: DiffEntry['kind'] = text === undefined ? 'deleted' : 'modified';
      entries.push({ path, kind, lines: diffLines(indexText ?? '', text ?? '') });
    }
    return entries;
  });
}

/**
 * `git log --all` —— 全分支遍历的提交列表（GitGraph 的数据源）。
 *
 * 真实语义：从每个分支头沿 parents BFS 收集全部可达提交，按作者时间倒序输出
 * （与真 git `git log --all` 的默认排序一致 —— 时间序而非拓扑序）。
 * M1 的 `log()` 只走当前分支；本函数补全多分支视图。
 */
export async function logAll(options: RepoOptions = {}): Promise<GitResult<CommitEntry[]>> {
  const base = fsArgs(options);
  return runGit('git log --all', async () => {
    const names = await git.listBranches(base);
    const heads = await Promise.all(
      names.map((name) => git.resolveRef({ ...base, ref: `refs/heads/${name}` })),
    );

    // 沿 parents BFS 去重
    const seen = new Set<string>();
    const queue = [...heads];
    const commits: CommitEntry[] = [];
    while (queue.length > 0) {
      const oid = queue.shift() as string;
      if (seen.has(oid)) continue;
      seen.add(oid);
      try {
        const { commit } = await git.readCommit({ ...base, oid });
        commits.push({
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
        });
        queue.push(...commit.parent);
      } catch {
        // 分支指向不存在对象（损坏数据）：跳过该头，不让整条命令失败
      }
    }

    commits.sort((a, b) => b.timestamp - a.timestamp);
    return commits;
  });
}

// ── M4：分支与合并 ──────────────────────────────────────────────────────────

/** `branch()` 的返回值：新建分支的信息 */
export interface BranchResult {
  /** 分支名 */
  name: string;
  /** 分支起点提交的短 hash */
  from: string;
}

/**
 * `git branch <name>` —— 在当前 HEAD 创建新分支（不切换，与真 git 一致）。
 *
 * @param name  新分支名
 * @param options.startPoint 可选起点（分支名或提交 hash），默认当前 HEAD
 */
export async function branch(
  name: string,
  options: RepoOptions & { startPoint?: string } = {},
): Promise<GitResult<BranchResult>> {
  const base = fsArgs(options);
  return runGit(`git branch ${name}`, async () => {
    const from = options.startPoint ?? (await git.resolveRef({ ...base, ref: 'HEAD' }));
    await git.branch({ ...base, ref: name, object: from });

    // reflog（M5a）：真 git 在创建分支时记 `branch: Created from <起点>`
    recordRefMove(options, {
      from,
      to: from,
      action: 'branch: Created from',
      detail: options.startPoint ?? 'HEAD',
    });

    return { name, from: from.slice(0, 7) };
  });
}

/** 分支列表中的一项 */
export interface BranchEntry {
  /** 分支名（不含 refs/heads/ 前缀） */
  name: string;
  /** 该分支当前指向的提交短 hash */
  shortHash: string;
  /** 是否为当前检出的分支 */
  current: boolean;
}

/** `git branch`（无参数）—— 列出本地分支 */
export async function listBranches(options: RepoOptions = {}): Promise<GitResult<BranchEntry[]>> {
  const base = fsArgs(options);
  return runGit('git branch', async () => {
    const names = await git.listBranches({ ...base });
    const current = (await git.currentBranch({ ...base, fullname: false })) ?? '';
    const entries: BranchEntry[] = [];
    for (const name of names.sort()) {
      const oid = await git.resolveRef({ ...base, ref: `refs/heads/${name}` });
      entries.push({ name, shortHash: oid.slice(0, 7), current: name === current });
    }
    return entries;
  });
}

/** `checkout()` 的返回值 */
export interface CheckoutResult {
  /** 切换到的分支名 */
  branch: string;
}

/**
 * `git checkout <branch>` —— 切换分支（工作区与索引一并更新，行为经探针实测）。
 *
 * 对齐真 git 的两处语义：
 *   - 工作区有未提交改动且会与目标分支冲突 → isomorphic-git 抛 `CheckoutConflictError`，
 *     经 `runGit` 归一为「存在未提交的修改，切换会覆盖它们」（errors.ts 既有文案）；
 *   - 未追踪文件在切换后保留（探针 4D 实测）。
 *
 * @param ref 分支名（M4 只支持分支切换；提交 hash 直达与 `-- <paths>` 属进阶用法，未纳入）
 */
export async function checkout(ref: string, options: RepoOptions = {}): Promise<GitResult<CheckoutResult>> {
  const base = fsArgs(options);
  return runGit(`git checkout ${ref}`, async () => {
    const previous = await unbornSafeHead(base);
    const previousBranch = await currentBranchOrNull(base);
    await git.checkout({ ...base, ref });
    const next = await unbornSafeHead(base);

    // reflog：真 git 记 `checkout: moving from <旧分支> to <新分支>`。
    // ⚠️ 判据是**分支变了**，而不是提交 oid 变了 —— 真 git 在 `main` 与刚创建的空分支
    // （两者同头）之间切换时**照样**留下一条 checkout 记录（实测对照）。
    // 早期实现按 `previous !== next` 判断，会漏掉「同头分支切换」这一最常见的情形。
    if (previousBranch !== null && previousBranch !== ref && next !== null) {
      recordRefMove(options, {
        from: previous ?? next,
        to: next,
        action: 'checkout: moving from',
        detail: `${previousBranch} to ${ref}`,
      });
    }
    return { branch: ref };
  });
}

/** 当前分支名；初生仓库（无 HEAD）时返回 null */
async function currentBranchOrNull(base: ReturnType<typeof fsArgs>): Promise<string | null> {
  try {
    return (await git.currentBranch({ ...base, fullname: false })) ?? null;
  } catch {
    return null;
  }
}


/** `merge()` 的返回值（成功路径） */
export interface MergeResult {
  /** 合并后 HEAD 所在提交的完整 SHA-1 */
  hash: string;
  /** 是否为 fast-forward 合并 */
  fastForward: boolean;
  /** 是否产生了双亲合并提交（非 ff 时恒为 true） */
  mergeCommit: boolean;
}

/** `merge()` 冲突时的返回值：冲突文件已带标记写入工作区，等玩家解决 */
export interface MergeConflictResult {
  /** 有冲突的文件路径（仓库相对路径） */
  conflictedPaths: string[];
}

/**
 * `git merge <branch>` —— 将指定分支合并入当前分支。
 *
 * 三种结局（探针 4 实测 isomorphic-git 1.42.2 行为后落定）：
 *
 * 1. **fast-forward**：当前分支是对端祖先 → 对端头直接成为新头。
 *    ⚠️ isomorphic-git 的 ff 合并**只移动 ref，不更新工作区与索引**（读其 `_merge` 源码确认，
 *    探针 1 实测：ff 后 workdir 仍是旧内容），因此这里补一次 `git.checkout` 同步工作区 ——
 *    与真 git「ff 合并后工作区即对端内容」的观感一致。
 *
 * 2. **无冲突三方合并**：isomorphic-git 自动产出 merge commit（`abortOnConflict` 默认路径
 *    不抛错时即此结局），直接返回其结果。
 *
 * 3. **冲突**：`abortOnConflict: false` 让 isomorphic-git 把**带冲突标记的文件写入工作区**
 *    （`<<<<<<< <ours> / ======= / >>>>><theirs>`，探针 4B 实测）后抛 `MergeConflictError`。
 *    本层拦截该错误：写 MERGE_HEAD（对端提交），返回 `{ conflicted: true, ... }` ——
 *    此后 `commit()` 会经 MERGE_HEAD 机制产出双亲合并提交（见 commit() 注释）。
 *    这条链路完整模拟了真 git「merge 冲突 → 手改 → add → commit」的教学闭环。
 */
export async function merge(
  theirs: string,
  options: RepoOptions = {},
): Promise<GitResult<MergeResult | (MergeConflictResult & { conflicted: true })>> {
  const base = fsArgs(options);

  // 主流程：三种成功结局之一，或冲突 / 其它失败
  const outcome: GitResult<MergeResult | (MergeConflictResult & { conflicted: true })> = await runGit(
    `git merge ${theirs}`,
    async (): Promise<MergeResult | (MergeConflictResult & { conflicted: true })> => {
      // reflog 用的「合并前的头」：必须在 git.merge 之前读 —— ff 合并会就地移动 HEAD
      const mergedFromRef = (await unbornSafeHead(base)) ?? NULL_OID_PLACEHOLDER;

      const result = await git.merge({
        ...base,
        theirs,
        author: { ...LEARNER_IDENTITY },
        committer: { ...LEARNER_IDENTITY },
        abortOnConflict: false,
      });

      if (result.alreadyMerged) {
        // 对端已是当前分支祖先：真 git 报「Already up to date.」且不动任何东西
        const head = await git.resolveRef({ ...base, ref: 'HEAD' });
        return { hash: head, fastForward: false, mergeCommit: false };
      }

      // ⚠️ isomorphic-git 的 merge（ff 与 merge commit 皆然）**只动 ref / 写提交对象，
      // 不更新工作区与索引**（探针实测：三方合并后对端新增文件不在工作区）。
      // 真 git 合并后工作区即为合并结果，故此处对当前分支补一次全量 checkout 同步。
      // 冲突路径（抛错）不走这里 —— 冲突标记由 mergeTree 直接写入工作区。
      if (result.fastForward || result.mergeCommit) {
        const current = (await git.currentBranch({ ...base, fullname: false })) ?? '';
        await git.checkout({ ...base, ref: current });

        // reflog（M5a）：真 git 的合并同样留下一条记录。ff 与非 ff 都记，
        // from 取合并前的 HEAD（注意：ff 时 HEAD 已被 isomorphic-git 移动，
        // 故此处用 result.oid 之外的途径 —— ff 的旧头即合并前的头）。
        recordRefMove(options, {
          from: mergedFromRef,
          to: result.oid as string,
          action: 'merge',
          detail: theirs,
        });
      }

      if (result.fastForward) {
        return { hash: result.oid as string, fastForward: true, mergeCommit: false };
      }

      return { hash: result.oid as string, fastForward: false, mergeCommit: true };
    },
  );

  // 拦截冲突错误 → 结构化冲突结果 + MERGE_HEAD（见函数注释的结局 3）
  if (outcome.ok) return outcome;
  const error = outcome.error;
  if (!(error instanceof GitCommandError) || error.code !== 'MergeConflictError') return outcome;

  return runGit(`git merge ${theirs} (conflict)`, async () => {
    // 冲突文件清单：底层 MergeConflictError 的 data.filepaths 在 runGit 归一时被丢弃
    // （GitCommandError 只保留 code/stderr），故从 stderr 原文解析 ——
    // 其 message 形如 "...in the following files: a.txt, b.txt. Fix conflicts..."
    // （探针 15 实测）。解析失败时给空清单，玩家仍能从 status 看到冲突文件。
    const match = /following files: (.+?)\. /.exec(error.stderr);
    const conflictedPaths = match
      ? match[1].split(',').map((path) => path.trim())
      : [];
    const theirOid = await git.resolveRef({ ...base, ref: `refs/heads/${theirs}` });
    await git.writeRef({ ...base, ref: MERGE_HEAD_REF, value: theirOid, force: true });
    return { conflicted: true as const, conflictedPaths };
  });
}

/**
 * `git rebase <upstream>` —— 把当前分支的独有提交重放到 upstream 之上（无冲突场景）。
 *
 * isomorphic-git 没有 rebase 命令（§14 预案「gitApi 用组合实现兜底」的落点）。
 * 实现步骤（探针 4E 实测可行）：
 *   1. `findMergeBase(HEAD, upstream)` 取分叉点 —— 多个 base 属 criss-cross，明确拒绝；
 *   2. 收集 base..HEAD 的提交（旧→新）；
 *   3. 以 upstream 头为新 parent，逐个 `git.writeCommit` 构造新提交：
 *      **tree 原样复用 + message/author 原样保留**。无冲突时「重放」与「搬 tree」等价
 *      （每次重放本就是把同一 tree 落在新 parent 上），这是该假设成立的前提；
 *   4. `writeRef` 把当前分支指针移到新链末端，`checkout` 同步工作区。
 *
 * 冲突风险：若某次重放与 upstream 新内容真冲突（同文件双方都改），「搬 tree」会静默
 * 覆盖 upstream 的改动 —— 与真 git 的 rebase 冲突暂停语义不同。当前版本不实现冲突
 * rebase：执行前用「base..HEAD 触及的路径 ∩ base..upstream 触及的路径」做检测，
 * 有交集即报「不支持」，关卡数据（3-5）保证不触发。
 */
export async function rebase(
  upstream: string,
  options: RepoOptions = {},
): Promise<GitResult<{ branch: string; count: number }>> {
  const base = fsArgs(options);
  return runGit(`git rebase ${upstream}`, async () => {
    const headOid = await git.resolveRef({ ...base, ref: 'HEAD' });
    const upstreamOid = await git.resolveRef({ ...base, ref: `refs/heads/${upstream}` });
    const bases = await git.findMergeBase({ ...base, oids: [headOid, upstreamOid] });
    if (bases.length !== 1) {
      throw new GitCommandError(
        'MergeNotSupportedError',
        '当前版本不支持交叉历史的变基。',
        `findMergeBase returned ${bases.length} bases`,
        { command: `git rebase ${upstream}`, hint: '本游戏的变基关卡不包含这种场景。' },
      );
    }
    const baseOid = bases[0];

    // 当前分支是 upstream 的祖先：真 git 会直接快进当前分支到 upstream
    if (baseOid === headOid) {
      const branch = (await git.currentBranch({ ...base, fullname: false })) ?? DEFAULT_BRANCH;
      await git.writeRef({ ...base, ref: `refs/heads/${branch}`, value: upstreamOid, force: true });
      await git.checkout({ ...base, ref: branch });
      return { branch, count: 0 };
    }
    if (baseOid === upstreamOid) {
      // upstream 是当前分支祖先：已经是最新的（Already up to date.），无事可做
      const branch = (await git.currentBranch({ ...base, fullname: false })) ?? DEFAULT_BRANCH;
      return { branch, count: 0 };
    }

    // 1) 收集 base..HEAD（旧→新）
    const toReplay: {
      message: string;
      tree: string;
      author: { name: string; email: string; timestamp: number; timezoneOffset: number };
    }[] = [];
    let cursor = headOid;
    while (cursor !== baseOid) {
      const { commit } = await git.readCommit({ ...base, oid: cursor });
      if (commit.parent.length !== 1) {
        throw new GitCommandError(
          'MergeNotSupportedError',
          '当前版本不支持对合并提交做变基。',
          `commit ${cursor} has ${commit.parent.length} parents`,
          { command: `git rebase ${upstream}` },
        );
      }
      toReplay.unshift({
        message: commit.message,
        tree: commit.tree,
        author: {
          name: commit.author.name,
          email: commit.author.email,
          timestamp: commit.author.timestamp,
          timezoneOffset: commit.author.timezoneOffset,
        },
      });
      cursor = commit.parent[0];
    }

    // 2) 冲突风险检测：对「base..HEAD 与 base..upstream 都触及、且双方改成了**不同内容**」
    //    的文件拒绝 rebase。⚠️ 不能只比路径交集 —— 真实的冲突条件是「双方都改且版本不同」
    //    （探针 37：双方 tree 都含 base 就有的文件并不代表冲突）。
    const blobAt = async (commitOid: string, filepath: string): Promise<string | undefined> => {
      const { commit } = await git.readCommit({ ...base, oid: commitOid });
      try {
        const { blob } = await git.readBlob({ ...base, oid: commit.tree, filepath });
        return new TextDecoder().decode(blob);
      } catch {
        return undefined;
      }
    };
    const touchedWithContent = async (
      from: string,
      to: string,
    ): Promise<Map<string, string>> => {
      // path → 该分支一侧该文件的最终内容（沿 base..to 逆序找最后一次改动）
      const changed = new Map<string, string>();
      let cur = to;
      while (cur !== from) {
        const { commit } = await git.readCommit({ ...base, oid: cur });
        // 该提交触及的路径：与其父提交的 tree 做路径差
        const paths = new Set<string>();
        const collect = async (treeOid: string, into: Set<string>) => {
          await git.walk({
            ...base,
            trees: [git.TREE({ ref: treeOid })],
            map: async (filepath, entries) => {
              const entry = entries[0];
              if (entry && filepath !== '.' && (await entry.type()) === 'blob') into.add(filepath);
              return undefined;
            },
          });
        };
        const parentTree = commit.parent[0]
          ? (await git.readCommit({ ...base, oid: commit.parent[0] })).commit.tree
          : undefined;
        await collect(commit.tree, paths);
        if (parentTree) await collect(parentTree, paths);
        for (const path of paths) {
          if (!changed.has(path)) {
            const content = await blobAt(cur, path);
            if (content !== undefined) changed.set(path, content);
          }
        }
        cur = commit.parent[0];
      }
      return changed;
    };
    const mine = await touchedWithContent(baseOid, headOid);
    const theirs = await touchedWithContent(baseOid, upstreamOid);
    const overlap: string[] = [];
    for (const [path, mineContent] of mine) {
      const theirContent = theirs.get(path);
      if (theirContent === undefined) continue;
      // base 时的内容
      const baseContent = await blobAt(baseOid, path);
      // 双方都改了（相对 base），且改成的内容不同 → 真冲突
      if (mineContent !== baseContent && theirContent !== baseContent && mineContent !== theirContent) {
        overlap.push(path);
      }
    }
    if (overlap.length > 0) {
      throw new GitCommandError(
        'MergeConflictError',
        `变基会产生冲突（${overlap.join('、')} 在两条分支上都被改成不同内容），当前版本不支持冲突变基。`,
        `rebase conflict risk: ${overlap.join(', ')}`,
        { command: `git rebase ${upstream}`, hint: '本关的变基练习不包含需要解决冲突的场景。' },
      );
    }

    // 3) 重放：tree 复用 + parent 重写（探针 4E 验证 writeCommit 可行）。
    //    committer 也保留原值：rebase 在真 git 里只改 committer 为执行者，
    //    此处教学仓库无所谓，保留原值让「重放前后信息一致」更直观。
    let newParent = upstreamOid;
    for (const entry of toReplay) {
      newParent = await git.writeCommit({
        ...base,
        commit: {
          message: entry.message,
          tree: entry.tree,
          parent: [newParent],
          author: entry.author,
          committer: entry.author,
        },
      });
    }

    // 4) 移动当前分支指针并同步工作区
    const branch = (await git.currentBranch({ ...base, fullname: false })) ?? DEFAULT_BRANCH;
    const headBeforeRebase = await unbornSafeHead(base);
    await git.writeRef({ ...base, ref: `refs/heads/${branch}`, value: newParent, force: true });
    await git.checkout({ ...base, ref: branch });

    // reflog（M5a）：真 git 的 rebase 会留下 (finish) 记录，指向变基后的新头
    if (headBeforeRebase !== null) {
      recordRefMove(options, {
        from: headBeforeRebase,
        to: newParent,
        action: 'rebase (finish)',
        detail: `returning to refs/heads/${branch}`,
      });
    }

    return { branch, count: toReplay.length };
  });
}

// ── M5a：撤销（reset / restore / revert / reflog）──────────────────────────

/** `reset()` 的三种模式，对齐真 git（笔记 `git-undo.md`「reset 三种模式」） */
export type ResetMode = 'soft' | 'mixed' | 'hard';

/** `reset()` 的返回值 */
export interface ResetResult {
  /** 当前分支名 */
  branch: string;
  /** 重置目标提交的短 hash */
  target: string;
  /** 使用的模式 */
  mode: ResetMode;
  /** 玩家书写的目标写法（如 `HEAD~1`），供回显对齐真 git 的 `HEAD is now at …` */
  targetLabel: string;
}

/**
 * `git reset [--soft|--mixed|--hard] <target>` —— 把当前分支指针移回目标提交。
 *
 * isomorphic-git **没有 reset 命令**（§14 的预案「gitApi 用组合实现兜底」），
 * 故此处按三模式各自组合底层原语。三态行为已用探针逐一实测
 * （见 docs/milestones/M5-tasks.md §六 第 10 条），与笔记 `git-undo.md` 的模式对比表**逐格吻合**：
 *
 * | 模式 | 工作区 | 索引（暂存区） | 提交历史 | 实现 |
 * |---|---|---|---|---|
 * | `--soft` | 保留 | 保留 | 回退 | 只 `writeRef` |
 * | `--mixed`（缺省） | 保留 | 复位到目标 | 回退 | `writeRef` + 逐文件 `resetIndex` |
 * | `--hard` | 复位到目标 | 复位到目标 | 回退 | `writeRef` + `checkout({ force: true })` |
 *
 * ⚠️ 三条实测约束（违反即出错）：
 *   1. `git.resetIndex` **必须带 `filepath`** —— 省略抛 `MissingParameterError`，
 *      故 `--mixed` 需先取索引路径清单再逐个复位；
 *   2. `--hard` 的工作区同步必须用 `checkout({ force: true })`：不带 force 时
 *      isomorphic-git 对「工作区有未提交改动」会抛 `CheckoutConflictError`，
 *      而 `reset --hard` 的真 git 语义恰恰是**丢弃**这些改动；
 *   3. `--hard` 会丢弃未追踪文件吗？真 git **不会**（只覆写被追踪的路径）。
 *      isomorphic-git 的 checkout 同样保留未追踪文件（M4 探针 4D 已验证），故一致。
 *
 * @param target ref 表达式（`HEAD~1` / `HEAD@{0}` / 分支名 / 提交 hash）
 * @param options.mode 三模式之一，缺省 `'mixed'`（真 git 的默认）
 */
export async function reset(
  target: string,
  options: RepoOptions & { mode?: ResetMode } = {},
): Promise<GitResult<ResetResult>> {
  const mode: ResetMode = options.mode ?? 'mixed';
  const base = fsArgs(options);
  const command = `git reset ${mode === 'mixed' ? '' : `--${mode} `}${target}`.trim();

  return runGit(command, async () => {
    const branch = (await git.currentBranch({ ...base, fullname: false })) ?? DEFAULT_BRANCH;
    const targetOid = await resolveRefInternal(base, options, target);
    const previous = await unbornSafeHead(base);

    // 1) 移动分支指针（三模式共同的第一步）
    await git.writeRef({ ...base, ref: `refs/heads/${branch}`, value: targetOid, force: true });

    // 2) `--hard`：工作区与索引一起复位到目标提交
    if (mode === 'hard') {
      await git.checkout({ ...base, ref: branch, force: true });
    }

    // 3) `--mixed`：索引复位到目标提交，工作区原样保留
    if (mode === 'mixed') {
      const indexOids = await readIndexOids(base);
      for (const path of indexOids.keys()) {
        // ⚠️ resetIndex 必须带 filepath（探针实测：省略抛 MissingParameterError）。
        // 目标 ref 传目标提交 oid：即以「目标提交的树」为基准复位该路径。
        await git.resetIndex({ ...base, filepath: path, ref: targetOid });
      }
    }

    // 4) reflog：对齐真 git 的 `reset: moving to <写法>`
    recordRefMove(options, {
      from: previous ?? NULL_OID_PLACEHOLDER,
      to: targetOid,
      action: 'reset: moving to',
      detail: target,
    });

    return { branch, target: targetOid.slice(0, 7), mode, targetLabel: target };
  });
}

/** `restore()` 的返回值 */
export interface RestoreResult {
  /** 被恢复的仓库相对路径（按输入顺序，去重后） */
  paths: string[];
  /** 是否只复位了索引（`--staged`） */
  staged: boolean;
}

/**
 * `git restore [--staged] <pathspec>...` —— 丢弃工作区改动或撤销暂存（M5a，服务 5-2 / 5-3）。
 *
 * 真 git 的两种用法（笔记 `git-undo.md`）：
 *   - `git restore <file>`：**工作区**回退到索引中的版本（丢弃未暂存的编辑）；
 *   - `git restore --staged <file>`：**索引**回退到 HEAD 版本，工作区文件保持不动
 *     （即「撤销 add」，等价于旧写法 `git reset HEAD <file>`）。
 *
 * 实现：两者都走 `git.checkout({ filepaths })` —— isomorphic-git 的 checkout 支持
 * 只检出指定路径。差异在参考点：
 *   - 非 staged：以**索引**为准 —— 直接从索引取 blob 写回工作区；
 *   - staged：以 **HEAD** 为准 —— `checkout({ ref: 'HEAD', filepaths })` 会把
 *     HEAD 的版本同时写回索引与工作区。⚠️ 这会**顺带丢弃工作区的未暂存改动**，
 *     与真 git 的 `restore --staged` 语义不符（真 git 只动索引）。
 *     故这里改为「先把工作区内容存下来 → checkout 到 HEAD → 再把工作区内容写回」，
 *     精确复刻「只动索引」。
 *
 * @param paths 仓库相对路径列表
 * @param options.staged 是否只复位索引
 */
export async function restore(
  paths: string[],
  options: RepoOptions & { staged?: boolean } = {},
): Promise<GitResult<RestoreResult>> {
  const list = paths.map((path) => path.trim()).filter((path) => path.length > 0);
  const staged = options.staged === true;
  const command = `git restore ${staged ? '--staged ' : ''}${list.join(' ')}`.trim();

  if (list.length === 0) {
    return {
      ok: false,
      error: new GitCommandError('InvalidFilepathError', '请指定要恢复的文件路径。', 'No filepath provided.', {
        command: 'git restore',
        hint: '例如：git restore notes/draft.md',
      }),
    };
  }

  return runGit(command, async () => {
    const dir = resolveDir(options);
    const base = fsArgs(options);
    const relativePaths = list.map((path) => normalizeRepoPath(dir, path));

    if (!staged) {
      // 工作区 ← 索引：从索引取版本写回工作区。
      // 索引中不存在该路径时，真 git 报 `pathspec ... did not match`。
      const indexOids = await readIndexOids(base);
      for (const path of relativePaths) {
        const oid = indexOids.get(path);
        if (oid === undefined) {
          throw new GitCommandError(
            'NotFoundError',
            `${path} 不在暂存区里 —— 没有可用来恢复工作区的版本。`,
            `pathspec '${path}' did not match any file(s) known to git`,
            {
              command,
              hint: 'git restore 只能把工作区恢复到「已入库的版本」；未追踪的新文件没有可恢复的来源。',
            },
          );
        }
        const { blob } = await git.readBlob({ ...base, oid });
        await fsp.writeFile(`${dir}/${path}`, blob);
      }
      return { paths: relativePaths, staged: false };
    }

    // --staged：HEAD → 索引，**工作区保持不动**（真 git 语义）。
    // 先把工作区现状读出来，checkout 后再写回 —— 否则 checkout 会连工作区一起改。
    const preserved = new Map<string, Uint8Array | null>();
    for (const path of relativePaths) {
      try {
        preserved.set(path, await fsp.readFile(`${dir}/${path}`));
      } catch {
        preserved.set(path, null); // 工作区里本来就没有（如 add 后又删了）
      }
    }

    await git.checkout({ ...base, ref: 'HEAD', filepaths: relativePaths });

    for (const [path, content] of preserved) {
      const absolute = `${dir}/${path}`;
      if (content === null) {
        // 原本不在工作区：保持「不在」——checkout 可能把它写回来了，需删掉
        try {
          await fsp.unlink(absolute);
        } catch {
          // 文件确实不存在，无需处理
        }
        continue;
      }
      await fsp.writeFile(absolute, content);
    }

    return { paths: relativePaths, staged: true };
  });
}

/** `checkout -- <pathspec>` 旧语法的返回值（与 `restore` 同语义） */
export async function checkoutPaths(
  paths: string[],
  options: RepoOptions = {},
): Promise<GitResult<RestoreResult>> {
  const result = await restore(paths, options);
  if (!result.ok) return result;
  return { ok: true, value: { ...result.value, staged: false } };
}

/** `revert()` 的返回值 */
export interface RevertResult {
  /** 新生成的反向提交 hash */
  hash: string;
  /** 被撤销的提交 hash */
  reverted: string;
  /** 新提交的信息 */
  message: string;
}

/**
 * `git revert <commit>` —— 生成一个**新的反向提交**来抵消目标提交的改动
 * （M5a，服务 5-4「安全反转」与 5-5「危险与安全」）。
 *
 * isomorphic-git **没有 revert**（§14 预案），此处用组合实现：
 *   1. 解析目标提交，取其**父提交**（根提交无父 → 无「反向」可言，明确拒绝）；
 *   2. 收集「父 tree」与「目标 tree」的路径并集，逐路径比对两侧内容，得出目标提交
 *      实际引入的改动（新增 / 修改 / 删除）；
 *   3. **冲突判据**（探针实测）：HEAD 上该路径的当前版本必须等于「目标提交引入的版本」。
 *      不等说明目标提交之后这条路径又被改过 —— 真 git 会停在这里报冲突，
 *      本版本不支持冲突 revert，故明确报「当前版本不支持」（与 `rebase` 同款纪律）；
 *   4. 把反向改动写入工作区与索引，再 `commit` 一个常规提交。
 *
 * 提交信息对齐真 git：`Revert "<原提交信息首行>"`。
 *
 * @param target ref 表达式（提交 hash / `HEAD~1` / 分支名）
 */
export async function revert(
  target: string,
  options: RepoOptions = {},
): Promise<GitResult<RevertResult>> {
  const base = fsArgs(options);
  const dir = resolveDir(options);
  const command = `git revert ${target}`;

  return runGit(command, async () => {
    const targetOid = await resolveRefInternal(base, options, target);
    const { commit: targetCommit } = await git.readCommit({ ...base, oid: targetOid });

    if (targetCommit.parent.length === 0) {
      throw new GitCommandError(
        'MergeNotSupportedError',
        '无法撤销根提交 —— 它没有可以对比的前身。',
        `cannot revert root commit ${targetOid}`,
        { command, hint: '根提交是历史的起点，撤销它等于删除整条历史。' },
      );
    }
    if (targetCommit.parent.length > 1) {
      throw new GitCommandError(
        'MergeNotSupportedError',
        '本版本不支持撤销合并提交（需要 -m 指定保留哪个父提交）。',
        `cannot revert merge commit ${targetOid}`,
        { command, hint: '合并提交有多个父提交，撤销它需要额外说明保留哪一侧。' },
      );
    }

    const parentOid = targetCommit.parent[0];
    const headOid = await unbornSafeHead(base);
    if (headOid === null) {
      throw new GitCommandError('NoCommitError', '仓库里还没有任何提交。', 'unborn branch', { command });
    }

    const beforePaths = await treePathsOf(base, parentOid);
    const afterPaths = await treePathsOf(base, targetOid);
    const allPaths = [...new Set([...beforePaths, ...afterPaths])].sort();

    /** 待写入工作区的最终内容；undefined 表示删除该文件 */
    const toWrite = new Map<string, string | undefined>();

    for (const path of allPaths) {
      const before = await blobTextAt(base, parentOid, path);
      const after = await blobTextAt(base, targetOid, path);
      // 该路径在目标提交里没被改动（两侧同内容）→ 无需反向
      if (before === after) continue;

      const current = await blobTextAt(base, headOid, path);
      // ⚠️ 冲突判据：HEAD 上必须是「目标提交引入的那个版本」，否则后续提交又改过它
      if (current !== after) {
        throw new GitCommandError(
          'MergeConflictError',
          `撤销会产生冲突（${path} 在 ${target} 之后又被修改过），当前版本不支持冲突 revert。`,
          `revert conflict on ${path}`,
          {
            command,
            hint: '本游戏的 revert 练习不包含「被撤销的改动之后又改过同一文件」的场景。',
          },
        );
      }

      toWrite.set(path, before);
    }

    if (toWrite.size === 0) {
      throw new GitCommandError(
        'NoCommitError',
        `${target} 没有可撤销的改动。`,
        `nothing to revert from ${targetOid}`,
        { command },
      );
    }

    // 应用反向改动：写工作区 → 暂存（新增/修改走 add，删除走 remove）
    const written: string[] = [];
    const deleted: string[] = [];
    for (const [path, content] of toWrite) {
      const absolute = `${dir}/${path}`;
      if (content === undefined) {
        try {
          await fsp.unlink(absolute);
        } catch {
          // 文件已不在工作区：索引侧仍需移除
        }
        deleted.push(path);
        continue;
      }
      await ensureParentDirsFor(dir, path);
      await fsp.writeFile(absolute, content);
      written.push(path);
    }

    if (written.length > 0) await git.add({ ...base, filepath: written });
    for (const path of deleted) await git.remove({ ...base, filepath: path });

    const firstLine = targetCommit.message.trim().split('\n')[0];
    const message = `Revert "${firstLine}"`;
    const hash = await git.commit({
      ...base,
      message,
      author: { ...LEARNER_IDENTITY },
      committer: { ...LEARNER_IDENTITY },
    });

    recordRefMove(options, { from: headOid, to: hash, action: 'revert', detail: `${target}…` });

    return { hash, reverted: targetOid, message };
  });
}

/** 取某提交 tree 下的全部 blob 路径 */
async function treePathsOf(base: ReturnType<typeof fsArgs>, commitOid: string): Promise<Set<string>> {
  const { commit } = await git.readCommit({ ...base, oid: commitOid });
  const paths = new Set<string>();
  await git.walk({
    ...base,
    trees: [git.TREE({ ref: commit.tree })],
    map: async (filepath, entries) => {
      const entry = entries[0];
      if (entry && filepath !== '.' && (await entry.type()) === 'blob') paths.add(filepath);
      return undefined;
    },
  });
  return paths;
}

/** 取某提交 tree 中指定路径的文本内容；不存在返回 undefined */
async function blobTextAt(
  base: ReturnType<typeof fsArgs>,
  commitOid: string,
  filepath: string,
): Promise<string | undefined> {
  const { commit } = await git.readCommit({ ...base, oid: commitOid });
  try {
    const { blob } = await git.readBlob({ ...base, oid: commit.tree, filepath });
    return new TextDecoder().decode(blob);
  } catch {
    return undefined;
  }
}

/** 逐级创建仓库内某相对路径的父目录（revert 写回文件时用） */
async function ensureParentDirsFor(dir: string, relative: string): Promise<void> {
  const segments = relative.split('/').slice(0, -1);
  let current = dir;
  for (const segment of segments) {
    current += `/${segment}`;
    try {
      await fsp.stat(current);
    } catch {
      await fsp.mkdir(current, { mode: 0o777 });
    }
  }
}

/**
 * `git reflog` —— 输出本仓库的 ref 移动历史（M5a，服务 5-6「时间跳跃」）。
 *
 * ⚠️ 这不是真 reflog：isomorphic-git 不维护 `.git/logs/`（探针实测 `HEAD@{0}` 解析失败）。
 * 本层用 `reflog.ts` 的内存日志复刻其**可观察语义**，输出格式与
 * `docs/notes/git-undo.md` 逐字一致：`<短hash> HEAD@{n}: <action>`。
 *
 * @returns 输出行（最新在前，与真 git 相同）；空仓库返回空数组
 */
export async function reflog(options: RepoOptions = {}): Promise<GitResult<string[]>> {
  return runGit('git reflog', async () => formatReflog(options));
}


/**
 * 解析一个引用（分支名、完整 ref 或 **ref 表达式**）指向的提交 oid。
 * 供 targetState 等需要「分支头」语义的 game service 使用 ——
 * isomorphic-git 的 `resolveRef` 是通用底层原语，此前没有对上出口。
 *
 * ⚠️ M5a 起本函数**支持 ref 表达式**（`HEAD~2` / `HEAD^` / `HEAD@{n}` / 短 hash），
 * 因为 isomorphic-git 的原生 `resolveRef` 对这些写法一律抛 `NotFoundError`（探针实测，
 * 见 `refExpr.ts` 文件头的对照表）。求值顺序严格按真 git：
 *   1. 解析基础名（HEAD / 分支 / 完整 ref / 短 hash）；
 *   2. 从左到右依次应用后缀（`~n` 沿第一父、`^n` 取第 n 父、`@{n}` 查 reflog）。
 *
 * @param ref 分支名（如 `main`，自动补全为 refs/heads/main）、完整引用名，
 *            或 ref 表达式（如 `HEAD~1` / `HEAD@{0}`）
 */
export async function resolveRef(
  ref: string,
  options: RepoOptions = {},
): Promise<GitResult<string>> {
  const base = fsArgs(options);
  return runGit(`resolveRef ${ref}`, async () => resolveRefInternal(base, options, ref));
}

/**
 * `resolveRef` 的实现体（内部版本，供其它 gitApi 函数复用而不重复 runGit 包装）。
 *
 * ⚠️ 参数里同时要 `base`（已组装的 fs 参数）与 `options`（reflog 需要仓库目录做键）：
 * 前者避免重复调 `fsArgs`，后者是 reflog 表按目录隔离所必需。
 */
async function resolveRefInternal(
  base: ReturnType<typeof fsArgs>,
  options: RepoOptions,
  ref: string,
): Promise<string> {
  const parsed = parseRefExpr(ref);
  if (!parsed.ok) {
    throw new GitCommandError('InvalidRefNameError', parsed.error, `invalid ref: ${ref}`, {
      command: `git resolveRef ${ref}`,
    });
  }

  let oid = await resolveRefBase(base, parsed.ref.base);

  for (const step of parsed.ref.steps) {
    if (step.kind === 'reflog') {
      const target = resolveReflogEntry(options, step.n);
      if (target === null) {
        throw new GitCommandError(
          'NotFoundError',
          `reflog 里没有 HEAD@{${step.n}} 这一条记录（可用 git reflog 查看全部记录）。`,
          `reflog entry ${step.n} not found`,
          { command: `git resolveRef ${ref}` },
        );
      }
      oid = target;
      continue;
    }

    const { commit } = await git.readCommit({ ...base, oid });
    const wanted = step.kind === 'parent' ? 1 : step.n;

    if (step.kind === 'parent') {
      // `~n`：沿第一父回溯 n 次，中途遇到根提交即报错（与真 git 的
      // "fatal: ambiguous argument 'HEAD~3': unknown revision" 同义）
      let cursor = oid;
      for (let i = 0; i < step.n; i += 1) {
        const current = i === 0 ? commit : (await git.readCommit({ ...base, oid: cursor })).commit;
        if (current.parent.length === 0) {
          throw new GitCommandError(
            'NotFoundError',
            `${ref} 超出了历史起点（沿父提交回溯 ${i + 1} 次时已经到达根提交）。`,
            `ref ${ref} walks past the root commit`,
            { command: `git resolveRef ${ref}` },
          );
        }
        cursor = current.parent[0];
      }
      oid = cursor;
      continue;
    }

    // `^n`：取第 n 个父提交（合并提交有多个父）
    if (commit.parent.length < wanted) {
      throw new GitCommandError(
        'NotFoundError',
        `${ref} 不存在：该提交只有 ${commit.parent.length} 个父提交，取不到第 ${wanted} 个。`,
        `ref ${ref} has no parent #${wanted}`,
        { command: `git resolveRef ${ref}` },
      );
    }
    oid = commit.parent[wanted - 1];
  }

  return oid;
}

/**
 * 解析 ref 表达式的**基础部分**（无后缀）。
 *
 * 依次尝试：分支名 → 完整引用名 → 短 hash 前缀。
 * 短 hash 走 `git.expandOid`（探针实测 `resolveRef` 对短 hash 抛 NotFoundError，
 * 而 `expandOid` 能正确还原唯一前缀）。
 */
async function resolveRefBase(base: ReturnType<typeof fsArgs>, name: string): Promise<string> {
  // 1) 分支名（`main` → refs/heads/main）
  try {
    return await git.resolveRef({ ...base, ref: `refs/heads/${name}` });
  } catch {
    // 继续尝试
  }

  // 2) 完整引用名 / HEAD / 标签（`refs/tags/v1` 等）
  try {
    return await git.resolveRef({ ...base, ref: name });
  } catch {
    // 继续尝试
  }

  // 3) 短 hash 前缀：`expandOid` 在无匹配或前缀歧义时抛错
  if (looksLikeHash(name)) {
    try {
      return await git.expandOid({ ...base, oid: name });
    } catch {
      throw new GitCommandError(
        'NotFoundError',
        `找不到提交 ${name}（hash 前缀不存在或有歧义）。`,
        `cannot expand oid ${name}`,
        { command: `git resolveRef ${name}` },
      );
    }
  }

  throw new GitCommandError('NotFoundError', `找不到引用 ${name}。`, `cannot resolve ref ${name}`, {
    command: `git resolveRef ${name}`,
  });
}


/**
 * 判断某个提交是否为另一提交的祖先（`merged` 目标判定的底层）。
 * 直接透传 isomorphic-git 的 `isDescendent`：语义为
 * 「`oid` 是否为 `ancestor` 的后代」—— 故判断「branch 已并入 into」
 * 应传 `(oid=into头, ancestor=branch头)`。见 targetState 的注释。
 */
export async function isDescendent(
  oid: string,
  ancestor: string,
  options: RepoOptions = {},
): Promise<GitResult<boolean>> {
  const base = fsArgs(options);
  return runGit('isDescendent', () =>
    git.isDescendent({ ...base, oid, ancestor }),
  );
}

// ── M6：标签（第六章「历史锚点」）────────────────────────────────────────────
//
// ⚠️ 探针实测结论（docs/milestones/M6-tasks.md「实测环境事实」）：
//   - **轻量标签** = `git.tag({ ref, object })` —— 只写 `refs/tags/<名>` 指向提交；
//     ⚠️ 它**忽略 message**：传了 message 也只是轻量标签（探针 P2 实测，
//     isomorphic-git 1.27 的 `tag()` 内部根本不接收 message 参数）。
//   - **注解标签** = `git.annotatedTag({ ref, object, message, tagger })` ——
//     产出真 tag 对象（`readTag` 可读），tagger 身份必须显式给（缺省走 config）。
//   - 重复创建（无 force）抛 `AlreadyExistsError`，与真 git 一致。
//   - `log({ ref: <tag名> })` 会自动 peel 注解 tag 对象 —— 按标签取提交历史可直接用。
//   - 推送：`git.push({ ref: '<tag名>' })` 经 `refpaths` 展开为 `refs/tags/<名>`，
//     远程 ref 缺省即同名 —— 走既有 fileRemote 服务端全链路可行（真协议探针验证）。

/** 标签列表中的一项 */
export interface TagEntry {
  /** 标签名（不含 refs/tags/ 前缀） */
  name: string;
  /** 该标签指向的提交短 hash（注解标签为其目标提交，即 peel 后的值） */
  shortHash: string;
  /** 是否为注解标签（轻量为 false） */
  annotated: boolean;
  /** 注解标签的信息（轻量无 —— undefined 与「注解但信息为空」可区分） */
  message?: string;
}

/** `createTag()` 的返回值 */
export interface TagResult {
  /** 标签名 */
  name: string;
  /** 指向的提交短 hash（注解标签为目标提交的短 hash，非 tag 对象本身的） */
  shortHash: string;
  /** 是否为注解标签 */
  annotated: boolean;
}

/**
 * `git tag <name> [<commit>]` / `git tag -a <name> -m <msg> [<commit>]`。
 *
 * @param name    标签名
 * @param options.message 提供时创建**注解标签**（tagger 用固定学习者身份）；
 *                        缺省为轻量标签 —— 与笔记 `git-tags.md` 的两分法一致。
 * @param options.target 目标（分支名 / 提交 hash / ref 表达式），缺省当前 HEAD；
 *                       解析走 `resolveRefInternal`（支持 `HEAD~1` 等写法，与 reset/revert 同源）。
 */
export async function createTag(
  name: string,
  options: RepoOptions & { message?: string; target?: string } = {},
): Promise<GitResult<TagResult>> {
  const base = fsArgs(options);
  const command = options.message !== undefined
    ? `git tag -a ${name} -m "${options.message}"`
    : `git tag ${name}`;

  return runGit(command, async () => {
    // 先解析目标提交（缺省 HEAD； unborn 仓库没有可打标签的对象，让 resolveRef 报 NotFound）
    const targetOid = options.target !== undefined
      ? await resolveRefInternal(base, options, options.target)
      : await unbornSafeHeadOrThrow(base, command);
    // ⚠️ git.tag / annotatedTag 的 object 传**提交 oid**：GitRefManager.resolve 对
    //    任意 ref 都能解析，但传 oid 最直接，也让「轻量 ref 指向哪个提交」一眼可判。
    if (options.message !== undefined) {
      await git.annotatedTag({
        ...base,
        ref: name,
        object: targetOid,
        message: options.message,
        tagger: { ...LEARNER_IDENTITY },
      });
    } else {
      await git.tag({ ...base, ref: name, object: targetOid });
    }
    return { name, shortHash: targetOid.slice(0, 7), annotated: options.message !== undefined };
  });
}

/** HEAD 指向的提交 oid；无提交时抛「没有任何提交可打标签」（真 git 的 fatal 同义） */
async function unbornSafeHeadOrThrow(base: ReturnType<typeof fsArgs>, command: string): Promise<string> {
  const head = await unbornSafeHead(base);
  if (head === null) {
    throw new GitCommandError(
      'NoCommitError',
      '仓库里还没有任何提交 —— 标签必须锚定在某次快照上。',
      'failed to resolve HEAD',
      { command, hint: '先 git commit 归档一次改动，再为它打标签。' },
    );
  }
  return head;
}

/**
 * `git tag`（无参数）—— 列出本地标签（字母序，与真 git 一致）。
 *
 * 注解标签额外读一次 tag 对象取信息与目标提交；轻量标签直接取 ref 值。
 * 目标提交短 hash：注解标签经 `readTag().tag.object`（peel），轻量即 ref 值本身。
 */
export async function listTags(options: RepoOptions = {}): Promise<GitResult<TagEntry[]>> {
  const base = fsArgs(options);
  return runGit('git tag', async () => {
    const names = await git.listTags(base);
    const entries: TagEntry[] = [];
    for (const name of names) {
      const refOid = await git.resolveRef({ ...base, ref: `refs/tags/${name}` });
      try {
        const tag = await git.readTag({ ...base, oid: refOid });
        entries.push({
          name,
          shortHash: tag.tag.object.slice(0, 7),
          annotated: true,
          message: tag.tag.message.trim(),
        });
      } catch {
        // 轻量标签：ref 直指提交，readTag 必然失败（探针 P2 实测其报 ObjectTypeError）
        entries.push({ name, shortHash: refOid.slice(0, 7), annotated: false });
      }
    }
    return entries;
  });
}

/** `deleteTag()` 的返回值 */
export interface DeletedTag {
  /** 被删除的标签名 */
  name: string;
  /** 删除前该标签指向的提交短 hash（供回显「deleted tag <名> (was <hash>)」） */
  shortHash: string;
}

/**
 * `git tag -d <name>` —— 删除本地标签。
 *
 * 真 git 对不存在的标签报 `tag '<名>' not found`，isomorphic-git 的 deleteTag
 * 对缺失 ref 静默成功（探针 P6 之外的源码行为），故先解析再删，保证报错语义对齐。
 */
export async function deleteTag(
  name: string,
  options: RepoOptions = {},
): Promise<GitResult<DeletedTag>> {
  const base = fsArgs(options);
  const command = `git tag -d ${name}`;
  return runGit(command, async () => {
    const refOid = await git.resolveRef({ ...base, ref: `refs/tags/${name}` }).catch(() => null);
    if (refOid === null) {
      throw new GitCommandError(
        'NotFoundError',
        `找不到标签「${name}」。`,
        `tag '${name}' not found`,
        { command, hint: 'git tag 可列出全部标签。' },
      );
    }
    await git.deleteTag({ ...base, ref: name });
    return { name, shortHash: refOid.slice(0, 7) };
  });
}

/**
 * 解析一个标签名指向的目标提交 oid（peel 后的提交，供 `git show <tag>` 与 targetState 用）。
 *
 * ⚠️ 注解标签的 `refs/tags/<名>` 指向 **tag 对象**而非提交：`readTag().tag.object`
 * 即其锚定的提交 oid（peel 一层即够 —— 嵌套 tag 不在本游戏范围内）。
 * 轻量标签的 ref 值本身就是提交 oid。
 *
 * @returns `{ oid, annotated }`；标签不存在返回 null（由调用方决定报错文案）
 */
export async function resolveTagTarget(
  name: string,
  options: RepoOptions = {},
): Promise<GitResult<{ oid: string; annotated: boolean } | null>> {
  const base = fsArgs(options);
  return runGit(`resolveTagTarget ${name}`, async () => {
    const refOid = await git.resolveRef({ ...base, ref: `refs/tags/${name}` }).catch(() => null);
    if (refOid === null) return null;
    try {
      const tag = await git.readTag({ ...base, oid: refOid });
      return { oid: tag.tag.object, annotated: true };
    } catch {
      return { oid: refOid, annotated: false };
    }
  });
}

/**
 * `git describe` —— 找出「从当前 HEAD 可达的、最近的标签」并渲染成版本描述（M6）。
 *
 * 真实语义：从 HEAD 沿历史向前走，遇到**第一个被标签锚定的提交**即返回
 * `<tag>`（正好落在标签上）或 `<tag>-<n>-g<hash>`（其后还有 n 个提交）。
 *
 * ⚠️ 与真 git 的差异（刻意简化，教学仓库足够）：
 *   - 真 git 缺省只看**注解标签**，`--tags` 才纳入轻量标签 —— 本函数照搬该规则；
 *   - 真 git 的遍历按提交图拓扑序 + 标签优先级（annotated > lightweight），
 *     教学仓库历史是单线或浅分叉，这里按「logAll 的时间倒序」逐个提交查标签命中，
 *     首个命中即答案 —— 语义在无环简单历史上与真 git 一致；
 *   - 走到根提交仍未命中：真 git 报 `fatal: No annotated tags can describe ...`。
 *
 * @param options.tags true = 轻量标签也纳入（`git describe --tags`）
 * @returns 渲染好的描述字符串；无可达标签时 value 为 null（由 executor 决定报错文案）
 */
export async function describe(
  options: RepoOptions & { tags?: boolean } = {},
): Promise<GitResult<string | null>> {
  const base = fsArgs(options);
  return runGit('git describe', async () => {
    // 标签名 → 目标提交 oid（按 options.tags 过滤轻量标签）
    const tagNames = await git.listTags(base);
    const tagTarget = new Map<string, string>();
    for (const name of tagNames) {
      const refOid = await git.resolveRef({ ...base, ref: `refs/tags/${name}` }).catch(() => null);
      if (refOid === null) continue;
      try {
        const tag = await git.readTag({ ...base, oid: refOid });
        tagTarget.set(name, tag.tag.object);
      } catch {
        // 轻量标签：仅当 --tags 时纳入
        if (options.tags === true) tagTarget.set(name, refOid);
      }
    }
    if (tagTarget.size === 0) return null;

    // HEAD 的历史（新→旧）； unborn 仓库无从 describe
    let headOid: string | null;
    try {
      headOid = await git.resolveRef({ ...base, ref: 'HEAD' });
    } catch {
      return null;
    }

    // 标签目标提交 → 标签名（一个提交可被多个标签锚定；取字母序第一个，稳定可解释）
    const tagsByTarget = new Map<string, string>();
    for (const [name, oid] of [...tagTarget.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (!tagsByTarget.has(oid)) tagsByTarget.set(oid, name);
    }

    // 从 HEAD 沿第一父链向前走：命中标签目标的提交即「最近的标签」
    const seen = new Set<string>();
    // ⚠️ 显式标注 string | null：while 条件里的非空判断会让 TS 把 cursor 收窄为 string，
    // 随后 `cursor = parent`（parent 可为 null）就报「null 不可赋给 string」。
    let cursor: string | null = headOid;
    let distance = 0;
    while (cursor !== null && !seen.has(cursor)) {
      seen.add(cursor);
      const tagName = tagsByTarget.get(cursor);
      if (tagName !== undefined) {
        if (distance === 0) return tagName;
        // `<tag>-<n>-g<短hash>`：n = 其后的提交数，g 前缀是 git 的「git hash」约定
        return `${tagName}-${distance}-g${cursor.slice(0, 7)}`;
      }
      // 沿第一父前进（合并提交只走第一父 —— 真 git 的 describe 默认亦然）。
      // ⚠️ next 显式标注类型：`.catch(() => null)` 与循环内 cursor 的收窄相互引用时
      //    TS 会报 TS7022（隐式 any 循环），显式类型打断该循环。
      let next: Awaited<ReturnType<typeof git.readCommit>> | null = null;
      try {
        next = await git.readCommit({ ...base, oid: cursor });
      } catch {
        return null;
      }
      const parent: string | null = next.commit.parent.length > 0 ? next.commit.parent[0] : null;
      cursor = parent;
      distance += 1;
    }
    return null;
  });
}

/**
 * 语法层白名单之外的子命令统一出口。
 *
 * 这是 §14「超出范围给『该版本不支持』提示，而非假装执行」的落点：
 * stash 等未落地子命令应命中此函数，返回 `GitUnsupportedError`。
 * （M5b 前此函数还覆盖 remote / clone / push / fetch / pull / tag，
 * 随各里程碑落地已逐一移出 —— 现仅剩 stash 等。）
 */
export function unsupported(subcommand: string): GitResult<never> {
  return { ok: false, error: new GitUnsupportedError(subcommand) };
}

// ── M5b：远程操作（第四章「星际连接」）────────────────────────────────────────
//
// 沙箱里的「远程宇宙」是 `/remote.git` 的一个内存裸仓库，经 `fileRemote.ts` 的
// **进程内智能 HTTP 服务端**通信 —— isomorphic-git 的 fetch/push/clone 走的是
// 标准 Git 智能 HTTP 协议，只是传输层不出浏览器。详见 fileRemote.ts 文件头。

/**
 * 远程 URL 的**白名单**（M5 决策 ③）。
 *
 * ⚠️ 为什么必须设白名单：探针 2 实测 `git.addRemote` **不做任何 URL 校验** ——
 * 任意字符串（含 `https://github.com/...`）都会成功写进 `remote.origin.url`。
 * 若不设限，玩家照抄第四章笔记里的 `https://github.com/user/repo.git` 会
 * 「添加成功但后续 push/fetch 全崩」，属 §14 明令禁止的「假装执行」。
 *
 * ⚠️ 为什么必须是 `http://` 而非 `file://`：isomorphic-git 的
 * `GitRemoteManager.getRemoteHelperFor` **只注册了 `http` 与 `https`** 两个
 * transport（源码实测），任何 `file://` 地址都会抛
 * `UnknownTransportError: uses an unrecognized transport protocol: "file"`。
 * 而「本地通道」的实现方式是提供自定义 `http` 客户端（见 fileRemote.ts），
 * 所以 URL 必须长得像 http，实际请求却不出浏览器。
 *
 * 采用沙箱专用域名 `sandbox`，让「这是虚拟远程」在命令行里一眼可见；
 * 主机名不被解析（请求全部由我们的 http 客户端拦截）。
 */
export const ALLOWED_REMOTE_URL = 'http://sandbox/remote.git';

/** 本地远程宇宙在沙箱内的裸仓库路径（与 fileRemote 的约定一致） */
const SANDBOX_REMOTE_PATH = '/remote.git';

/**
 * 校验远程 URL 是否指向沙箱内的远程宇宙。
 *
 * 只接受约定的沙箱地址；其余一律拒绝并给出「本关只接受本地通道」的提示。
 * 宽容地同时接受带/不带结尾 `.git` 的写法，避免玩家因一个后缀被卡住。
 */
export function isAllowedRemoteUrl(url: string): boolean {
  const trimmed = url.trim().replace(/\/+$/, '');
  return (
    trimmed === ALLOWED_REMOTE_URL ||
    trimmed === 'http://sandbox/remote' ||
    trimmed === SANDBOX_REMOTE_PATH
  );
}

/** `addRemote()` 的返回值 */
export interface RemoteEntry {
  name: string;
  url: string;
}

/**
 * `git remote add <name> <url>` —— 关联远程仓库。
 *
 * ⚠️ URL 白名单在**语法/执行层之前**就把关（决策 ③）：不合规的 URL 明确回
 * 「本关的远程宇宙只接受本地通道」，而不是「添加成功但后续全崩」。
 * 错误走 `GitUnsupportedError`（`kind: 'unsupported'`），UI 侧无需新增分支。
 */
export async function addRemote(
  name: string,
  url: string,
  options: RepoOptions = {},
): Promise<GitResult<RemoteEntry>> {
  if (!isAllowedRemoteUrl(url)) {
    return {
      ok: false,
      error: new GitUnsupportedError(
        `remote add ${name} ${url}`,
        `本关的远程宇宙只接受本地通道（${ALLOWED_REMOTE_URL}）。` +
          `地址「${url}」指向沙箱之外，当前版本无法连接真实网络仓库。`,
      ),
    };
  }

  const base = fsArgs(options);
  return runGit(`git remote add ${name} ${url}`, async () => {
    await git.addRemote({ ...base, remote: name, url: ALLOWED_REMOTE_URL });
    // addRemote 会自动写 refspec（+refs/heads/*:refs/remotes/<name>/*），
    // 这是 fetch 的硬前提 —— 缺了它 fetch 报 NoRefspecError（与真 git 一致）。
    return { name, url: ALLOWED_REMOTE_URL };
  });
}

/** `git remote` / `git remote -v` —— 列出已关联的远程 */
export async function listRemotes(
  options: RepoOptions = {},
): Promise<GitResult<RemoteEntry[]>> {
  const base = fsArgs(options);
  return runGit('git remote', async () => {
    // ⚠️ isomorphic-git 用 `remote` 作字段名，本层归一为 `name` —— 与
    //    `listBranches` 返回 `{ name }` 的既有风格一致，UI 侧不必记两套命名。
    const remotes = await git.listRemotes(base);
    return remotes.map((entry) => ({ name: entry.remote, url: entry.url }));
  });
}

/** `git remote remove <name>` —— 删除远程关联 */
export async function deleteRemote(
  name: string,
  options: RepoOptions = {},
): Promise<GitResult<void>> {
  const base = fsArgs(options);
  return runGit(`git remote remove ${name}`, () => git.deleteRemote({ ...base, remote: name }));
}

/**
 * 把 remote 的 URL 与 refspec 直接写进配置 —— 供 `sandbox.seedRemote` 预置远程用。
 *
 * ⚠️ 与 `addRemote()` 的差别：**不做白名单校验**。这不是漏洞，而是职责划分 ——
 * 白名单把关的是**玩家输入**（`git remote add <url>`），而本函数是关卡数据在
 * 初始化期写配置的通道，其 URL 由 `sandbox.seedRemote` 校验过（且实际恒为
 * `ALLOWED_REMOTE_URL`）。把它做成「内部写入」而非复用 `addRemote`，是为了让
 * 「玩家路径必须校验」这条规则在代码里一眼可见。
 *
 * ⚠️ `addRemote` 已会自动写 refspec；本函数显式再写一次是为了幂等 ——
 * 预置流程可能对同一个 remote 调用多次（关卡数据里重复声明同一 name），
 * 而 `git.addRemote` 对已存在的 remote 会抛 `AlreadyExistsError`。
 */
export async function writeRemoteConfig(
  name: string,
  url: string,
  options: RepoOptions = {},
): Promise<GitResult<void>> {
  const base = fsArgs(options);
  return runGit(`git remote set-url ${name}`, async () => {
    await git.setConfig({ ...base, path: `remote.${name}.url`, value: url });
    // fetch 的 refspec —— 缺了它 fetch 报 NoRefspecError（真 git 亦然）
    await git.setConfig({
      ...base,
      path: `remote.${name}.fetch`,
      value: `+refs/heads/*:refs/remotes/${name}/*`,
    });
  });
}

/**
 * `git fetch <remote> [<ref>]` —— 只获取远程更新，不合并。
 *
 * 教学点（笔记 `git-remotes.md`「fetch vs pull」）：fetch 是安全的 ——
 * 它把远程对象取回本地并更新 `refs/remotes/<remote>/*`，**不动工作区**。
 */
export async function fetch(
  remote: string,
  options: RepoOptions & { ref?: string } = {},
): Promise<GitResult<void>> {
  const base = fsArgs(options);
  const url = ALLOWED_REMOTE_URL;
  return runGit(`git fetch ${remote}`, async () => {
    await git.fetch({
      ...base,
      // ⚠️ `http` 客户端的「打包源」必须是**裸仓**：fetch 的方向是
      //    服务端 → 客户端，服务端要从自己的对象库里取对象。
      //    若误传玩家仓库目录，服务端会在一个没有这些对象的仓库上 packObjects，
      //    结果是协商成功但 packfile 为空，客户端报 `NotFoundError`（实测踩到）。
      http: createRemoteHttpClient(SANDBOX_REMOTE_PATH),
      remote,
      url,
      // ⚠️ `singleBranch` **只在指定了 ref 时才开**（实测缺陷）：
      //    开了它而没给 `ref` 时，isomorphic-git 会把 remoteRef 落成 `HEAD`
      //    并在公告的 refs 里解析它 —— 而真 git 的 advertisement **不发布 HEAD 行**
      //    （HEAD 的指向经 `symref=` capability 表达），于是解析失败、
      //    `git fetch origin` 报「找不到指定的文件或提交」。
      //    不给 ref 时按真 git 语义取回**全部**分支的更新，正是玩家期望的行为。
      ...(options.ref ? { ref: options.ref, singleBranch: true } : {}),
    });
  });
}

/**
 * `git push <remote> [<ref>]` —— 把本地提交或标签推送上去。
 *
 * ⚠️ 非快进的拒绝**由服务端发出**（`fileRemote.decidePush`）：真 git 的
 * `receive.denyNonFastForwards` 语义。实测 isomorphic-git 的客户端也会先做一次
 * 检测并抛 `PushRejectedError`（`data.reason: 'not-fast-forward'`）——
 * 两条路径都保留，与真 git 的分工一致（客户端查「远程领先」，服务端查「陈旧 oldOid」）。
 *
 * ⚠️ M6 起支持推送**标签**：`ref` 传 `refs/tags/<名>` 时，isomorphic-git 的
 * `GitRefManager.expand`（经 `refpaths`：原名 → refs/ → refs/tags/ → refs/heads/）
 * 会把它解析到本地标签；远程 ref 缺省与本地同名（`_push` 的 `fullRemoteRef = fullRef`），
 * 即推成 `refs/tags/<名>` —— 真协议探针已验证 tag 对象完整落裸仓。
 * 注解标签的对象（tag object）由 `listCommitsAndTags` 一并打包，无需额外处理。
 */
export async function push(
  remote: string,
  options: RepoOptions & { ref?: string } = {},
): Promise<GitResult<void>> {
  const base = fsArgs(options);
  return runGit(`git push ${remote}`, async () => {
    await git.push({
      ...base,
      // push 是客户端 → 服务端，服务端不打包（数据随请求体推来），
      // 故 sourceDir 传裸仓路径即可 —— 它只在 upload-pack 分支上被用到。
      http: createRemoteHttpClient(SANDBOX_REMOTE_PATH),
      remote,
      url: ALLOWED_REMOTE_URL,
      ...(options.ref ? { ref: options.ref } : {}),
    });
  });
}

/**
 * 推送一个标签到远程（`git push origin <tag名>`，M6 服务 6-4「推送锚点」）。
 *
 * ⚠️ 与 `push({ ref })` 的差别：本函数做**标签语义校验**（本地确有该标签），
 * 并按真 git 的行为把 ref 规范为 `refs/tags/<名>`。远程端是新建 ref（oldOid 全零）
 * 或完全相同的重推 —— 后者由 isomorphic-git 客户端报 `PushRejectedError('tag-exists')`
 * （已存在于远程且未带 force），与真 git 的 `! [rejected] ... (already exists)` 同义。
 */
export async function pushTag(
  remote: string,
  name: string,
  options: RepoOptions = {},
): Promise<GitResult<void>> {
  const base = fsArgs(options);
  const command = `git push ${remote} ${name}`;
  return runGit(command, async () => {
    // 本地必须有该标签 —— 缺失时 isomorphic-git 的 expand 会抛 NotFoundError，
    // 但报错文案不友好（`expand: ref not found`），先查一次给出教学向提示。
    const exists = await git.resolveRef({ ...base, ref: `refs/tags/${name}` }).catch(() => null);
    if (exists === null) {
      throw new GitCommandError(
        'NotFoundError',
        `本地找不到标签「${name}」，无法推送。`,
        `src refspec ${name} does not match any`,
        { command, hint: 'git tag 先创建标签，再推送。' },
      );
    }
    await git.push({
      ...base,
      http: createRemoteHttpClient(SANDBOX_REMOTE_PATH),
      remote,
      url: ALLOWED_REMOTE_URL,
      ref: `refs/tags/${name}`,
    });
  });
}

/**
 * `git clone <url> [<dir>]` —— 复制一个仓库到本地。
 *
 * 沙箱约定：克隆目标恒为 `/repo`（玩家主仓库），故 `dir` 由调用方给出。
 * 用于 4-4「克隆宇宙」与 `LevelInit.template: 'cloneSource'`。
 *
 * ⚠️ **clone 前必须把目标清空**（M5b 实测踩到的坑）：
 *   真 git 的 `git clone` 要求目标目录不存在或为空；而沙箱里 `/repo` 在
 *   `sandbox.reset()` 里已经被 `git init` 过（哪怕 template 是 cloneSource），
 *   直接 clone 会让 isomorphic-git 在**已有仓库**上做检出与 ref 写入，
 *   报一个与真因无关的 `NotFoundError: Could not find <oid>`
 *   （那个 oid 来自它内部对 HEAD 的解析，与远程的真实内容对不上）。
 *   故此处先递归清空 `/repo` 再克隆 —— 与真 git「克隆到一个空目录」等价。
 */
export async function clone(
  url: string,
  options: RepoOptions = {},
): Promise<GitResult<void>> {
  if (!isAllowedRemoteUrl(url)) {
    return {
      ok: false,
      error: new GitUnsupportedError(
        `clone ${url}`,
        `本关的远程宇宙只接受本地通道（${ALLOWED_REMOTE_URL}）。`,
      ),
    };
  }

  const base = fsArgs(options);
  const dir = options.dir ?? REPO_DIR;
  return runGit('git clone', async () => {
    // 清空目标目录（保留目录本身），让 clone 面对一个干净的空目录
    const { removeDir } = await import('./fs');
    const fs = getFs().promises;
    await removeDir(dir);
    await fs.mkdir(dir, { mode: 0o777 });

    // ⚠️ clone 的源仓库是裸仓自身，故 http 客户端的「打包源」指向 /remote.git
    await git.clone({
      ...base,
      http: createRemoteHttpClient(SANDBOX_REMOTE_PATH),
      url: ALLOWED_REMOTE_URL,
      singleBranch: true,
      noCheckout: false,
    });
  });
}

/**
 * `git pull <remote> [<ref>]` —— fetch + merge 的组合（笔记的官方等式）。
 *
 * ⚠️ 不复用 isomorphic-git 的 `git.pull`：它的合并路径不支持我们需要的
 * 「ff 后同步工作区」修正（见 `merge()` 的注释 —— isomorphic-git 的合并
 * **只移 ref 不更新工作区**，这是 M4 就踩过的坑）。
 * 故按笔记的字面语义手动组合 fetch → merge，行为与真 git 一致且可解释。
 */
export async function pull(
  remote: string,
  options: RepoOptions & { ref?: string } = {},
): Promise<GitResult<{ merged: boolean; fastForward: boolean; upToDate: boolean }>> {
  const ref = options.ref ?? DEFAULT_BRANCH;

  const fetched = await fetch(remote, options);
  if (!fetched.ok) return fetched;

  // fetch 之后远程跟踪分支为 `refs/remotes/<remote>/<ref>`；merge 需要分支名可解析。
  // 直接以 `refs/remotes/<remote>/<ref>` 作为 theirs 传入（真 git 的 `git merge origin/main` 同款）。
  const remoteRef = `${remote}/${ref}`;
  const merged = await merge(remoteRef, options);
  if (!merged.ok) return merged;

  const result = merged.value;
  if ('conflicted' in result) {
    return {
      ok: false,
      error: new GitCommandError(
        'MergeConflictError',
        `拉取的内容与本地改动冲突（涉及 ${result.conflictedPaths.length} 个文件）。`,
        `pull merge conflicted: ${result.conflictedPaths.join(', ')}`,
        {
          command: `git pull ${remote} ${ref}`,
          hint: '解决冲突文件中的标记后 git add，再 git commit 完成这次合并。',
        },
      ),
    };
  }

  return {
    ok: true,
    value: {
      merged: result.mergeCommit,
      fastForward: result.fastForward,
      upToDate: !result.mergeCommit && !result.fastForward,
    },
  };
}

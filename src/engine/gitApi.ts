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
 * tag / remote / clone / push / fetch / pull 属 M5/M6，此处仍缺席；
 * 语法层命中这些子命令时回 `GitUnsupportedError`，而不是伪造执行。
 */

import git from 'isomorphic-git';
import type { FsClient } from 'isomorphic-git';
import { fsp, getFs, REPO_DIR } from './fs';
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

/** `git commit -m <message>` 的返回值 */
export interface CommitResult {
  /** 新提交的完整 SHA-1 */
  hash: string;
  /** 提交所在分支（M4 起真实读取；M1 时 executor 曾硬编码 `main`） */
  branch: string;
  /** 是否为合并提交（MERGE_HEAD 机制，见 commit() 注释） */
  merge: boolean;
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
 * @example
 * ```ts
 * const result = await gitApi.commit('初始提交');
 * if (result.ok) console.log(result.value.branch); // → 'main'
 * ```
 */
export async function commit(
  message: string,
  options: RepoOptions = {},
): Promise<GitResult<CommitResult>> {
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

  const base = fsArgs(options);
  const mergeHead = await readMergeHead(base);

  return runGit(command, async () => {
    // 合并进行中：双亲 = [HEAD, MERGE_HEAD]，提交后移除 MERGE_HEAD（真 git 的完成合并语义）。
    // 注意绕过空提交防御的值路径：`git.commit` 不接受 parent 参数，故此处直接用底层 `_commit`
    // 的公开对应 `git.commit({ parent })`——它接受显式 parent 列表，跳过 resolveRef 的单亲推导。
    const hash = mergeHead
      ? await git.commit({
          ...base,
          message: text,
          author: { ...LEARNER_IDENTITY },
          committer: { ...LEARNER_IDENTITY },
          parent: [
            (await git.resolveRef({ ...base, ref: 'HEAD' })) as string,
            mergeHead,
          ],
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

    const branch = (await git.currentBranch({ ...base, fullname: false })) ?? DEFAULT_BRANCH;
    return { hash, branch, merge: mergeHead !== null };
  });
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
    await git.checkout({ ...base, ref });
    return { branch: ref };
  });
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
    await git.writeRef({ ...base, ref: `refs/heads/${branch}`, value: newParent, force: true });
    await git.checkout({ ...base, ref: branch });

    return { branch, count: toReplay.length };
  });
}

/**
 * 解析一个引用（分支名或完整 ref）指向的提交 oid。
 * 供 targetState 等需要「分支头」语义的 game service 使用 ——
 * isomorphic-git 的 `resolveRef` 是通用底层原语，此前没有对上出口。
 *
 * @param ref 分支名（如 `main`，自动补全为 refs/heads/main）或完整引用名
 */
export async function resolveRef(
  ref: string,
  options: RepoOptions = {},
): Promise<GitResult<string>> {
  const base = fsArgs(options);
  return runGit(`resolveRef ${ref}`, async () => {
    // 优先按分支名解析；失败则按完整引用名再试一次（如 MERGE_HEAD）
    try {
      return await git.resolveRef({ ...base, ref: `refs/heads/${ref}` });
    } catch {
      return await git.resolveRef({ ...base, ref });
    }
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

/**
 * 语法层白名单之外的子命令统一出口。
 *
 * 这是 §14「超出范围给『该版本不支持』提示，而非假装执行」的落点：
 * reset / revert / stash / tag / remote / clone / push / fetch / pull 等
 * M5/M6 子命令都应命中此函数，返回 `GitUnsupportedError`。
 */
export function unsupported(subcommand: string): GitResult<never> {
  return { ok: false, error: new GitUnsupportedError(subcommand) };
}

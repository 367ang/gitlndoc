/**
 * 仓库沙箱：清空 / 依据 `LevelInit` 重建（development-refinement.md §6.1）。
 *
 * §6.1 的约定是「每关开始：清空虚拟根，依据 `LevelInit` 重建仓库」，
 * 落点即本模块的 `reset()`。本层是对 `fs.ts` + `gitApi.ts` 的**薄编排**：
 *   - 清空虚拟根、建目录 → 复用 `fs.ts`（不自行重写递归删除）；
 *   - 建仓库、写索引、提交 → 复用 `gitApi.*`（构建**真实对象库**，而非伪造）。
 * 业务逻辑（计分、目标比对、提示）不得进入本层。
 *
 * ⚠️ 与 `gitApi` 保持同一条契约：本模块的方法**不抛异常**，一律返回 `GitResult<T>`。
 * 这是刻意的——`gitApi` 全部方法都返回 `GitResult`，若本层改抛异常，
 * 调用方（T5 的 UI、T6 的 executor）就得同时处理两种失败形态，全层一致性会被破坏。
 * 因此：`gitApi` 的失败结果原样向上传递（保留原始 `GitCommandError`，不重新包装），
 * 而 `fs` 层（LightningFS）本身会抛的原生错误，统一经 `runGit()` 归一后再返回。
 *
 * ⚠️ M1 只落地 `LevelInit` 的 `files` 与 `commits` 两个字段。
 * `branches` / `tags` / `remotes` / `template: 'cloneSource'` 属 M4/M5
 * （`gitApi` 在 M1 刻意没有 branch/tag/remote/clone 方法），本层**不伪造实现**，
 * 详见 `rebuild()` 内的注释与 `reset()` 的 fail-fast 校验。
 */

import type { LevelInit } from '../game/types';
import { GitUnsupportedError, runGit, type GitResult } from './errors';
import { clearSandboxRoot, ensureSandboxRoot, fsp, REPO_DIR } from './fs';
import * as gitApi from './gitApi';
import { DEFAULT_BRANCH } from './gitApi';

/** M1 已落地的 `LevelInit` 字段——只有这两个，其余字段见 `unsupportedInitError()` */
export type SupportedInitField = 'files' | 'commits';

/**
 * M4/M5 才会落地的 `LevelInit` 字段。
 * 列出它们是为了在 fail-fast 报错里给出准确提示，而非默默吞掉。
 */
export type DeferredInitField = 'template:cloneSource' | 'branches' | 'tags' | 'remotes';

/**
 * `reset()` 成功的返回值。
 * 汇报里要能直接看到「建了几个提交、工作区是否干净」，省得 UI 再查一遍。
 */
export interface SandboxState {
  /** 主仓库路径，恒为 `REPO_DIR` */
  dir: string;
  /** 当前分支名 */
  branch: string;
  /** 重建后是否已有提交（空仓库时为 false） */
  hasCommits: boolean;
  /** 预置提交的数量 */
  commitCount: number;
  /** 各提交的短 hash 与信息，按新→旧排列（与 `git log` 一致） */
  commits: { hash: string; shortHash: string; message: string }[];
  /** 重建后工作区是否干净（无未暂存改动、无未追踪文件） */
  clean: boolean;
}

/**
 * 取出 `LevelInit` 中 M1 尚未落地的字段。
 *
 * ⚠️ 为什么是「报错」而不是「忽略 + TODO」或「走 unsupported 语义」：
 * 关卡数据（含 `branches`/`tags`/`remotes`）属 M2 才引入，M1 阶段这些字段恒为空，
 * 因此三种方案在 M1 运行时**行为完全一致**，区别只在 M2/M4 接错数据时的表现：
 *   - 静默忽略 → 关卡作者写了 `branches: [{name:'dev'}]`，游戏里却没有 `dev` 分支，
 *     玩家会看到「关卡说明要求有 dev 分支，但仓库里没有」，且无任何报错线索；
 *   - fail-fast → 立刻指明「该字段属 M4/M5」，接了错数据当场就炸，不会伪装成别的故障。
 * §14 明令禁止「假装执行」，而**静默忽略正是最隐蔽的一种假装**——它让关卡看起来
 * 初始化成功了。故取 fail-fast，用 `GitUnsupportedError`（`kind: 'unsupported'`）
 * 走既有错误通道，UI 侧无需新增分支即可正确呈现「该版本不支持」。
 *
 * 注意这里刻意**不接受** `template: 'blank' | 'emptyRepo'`：这两者与 M1 的默认行为
 * （清空后 init 一个空仓库）语义一致，属已支持范围，不算 deferred。
 */
function deferredFieldsOf(init: LevelInit): DeferredInitField[] {
  const deferred: DeferredInitField[] = [];
  if (init.template === 'cloneSource') deferred.push('template:cloneSource');
  if (init.branches?.length) deferred.push('branches');
  if (init.tags?.length) deferred.push('tags');
  if (init.remotes?.length) deferred.push('remotes');
  return deferred;
}

/** 把文件名清单拼进报错信息，便于一眼定位是哪个关卡配错了 */
function describeFields(fields: DeferredInitField[]): string {
  return fields.join('、');
}

/**
 * 校验 `LevelInit` 是否超出 M1 的可落地范围。
 * 返回 `GitResult<void>` 而非抛异常，与全层契约一致。
 */
function assertM1Scope(init: LevelInit): GitResult<void> {
  const deferred = deferredFieldsOf(init);
  if (deferred.length === 0) return { ok: true, value: undefined };

  // 走既有错误通道：GitUnsupportedError（kind = 'unsupported'），
  // 与 gitApi.unsupported() 同语义，UI 侧无需新增分支即可呈现「该版本不支持」。
  const field = describeFields(deferred);
  return {
    ok: false,
    error: new GitUnsupportedError(
      `关卡初始化字段 ${field}`,
      `LevelInit 的 ${field} 字段属 M4/M5，M1 尚未实现，故拒绝执行而非静默忽略。`,
    ),
  };
}

/**
 * 清空虚拟根并依据 `LevelInit` 重建沙箱仓库（§6.1）。
 *
 * 步骤：`clearSandboxRoot()` → `ensureSandboxRoot()` → `gitApi.init()`
 *      → 写 `files` → 按 `commits` 逐条 `add` + `commit`。
 *
 * ⚠️ `commits` 的构建方式（M1 的语义约定）：`InitCommit` 的 `author` / `date` 是
 * 关卡数据里的「叙事性署名与时间」，用于让预览的提交历史贴近真实项目。但
 * `gitApi.commit()` 按 §6.2 的要求**强制固定学习者身份**、且 isomorphic-git 的
 * `commit` 不接受逐条指定时间戳，因此 M1 产出的提交统一使用固定的学习者身份与
 * 当前时间；`author` / `date` 暂仅作为关卡数据保留，不进入对象库。
 * 这一点是**有意的取舍**，不做伪装：真实对象库优先于署名还原，
 * 而「还原历史署名/时间」属 M2 关卡数据落地时的增强项。
 *
 * @example 进入关卡时初始化沙箱
 * ```ts
 * const result = await reset(level.init);
 * if (!result.ok) showError(result.error.toString());
 * ```
 */
export async function reset(init: LevelInit = {}): Promise<GitResult<SandboxState>> {
  const scope = assertM1Scope(init);
  if (!scope.ok) return scope;

  return runGit('sandbox reset', async () => {
    // 1) 清空虚拟根（复用 fs.ts，不自行递归删除）
    await clearSandboxRoot();
    // 2) 重建 /repo 与 /remote.git 两级目录
    await ensureSandboxRoot();

    // 3) 初始化主仓库：/repo，默认分支 main
    const inited = await gitApi.init({ dir: REPO_DIR });
    if (!inited.ok) throw inited.error;

    // 4) 写预置文件（首次写入）
    const filepaths = await writeFiles(init.files ?? {});

    // 5) 建预置提交：逐条 add + commit，产出真实对象库。
    //    注：`InitCommit` 的 `author` / `date` 见上方 reset() 的说明，M1 不进入对象库。
    for (const entry of init.commits ?? []) {
      const added = await gitApi.add(filepaths, { dir: REPO_DIR });
      if (!added.ok) throw added.error;

      const committed = await gitApi.commit(entry.message || entry.msg, { dir: REPO_DIR });
      if (!committed.ok) throw committed.error;
    }

    // 6) 汇总状态：提交列表 + 工作区是否干净
    const logged = await gitApi.log({ dir: REPO_DIR });
    if (!logged.ok) throw logged.error;

    const statusResult = await gitApi.status({ dir: REPO_DIR });
    if (!statusResult.ok) throw statusResult.error;

    const { staged, unstaged, untracked } = statusResult.value;
    return {
      dir: REPO_DIR,
      branch: statusResult.value.branch || DEFAULT_BRANCH,
      hasCommits: logged.value.length > 0,
      commitCount: logged.value.length,
      commits: logged.value.map(({ hash, shortHash, message }) => ({ hash, shortHash, message })),
      clean: staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
    };
  });
}

/**
 * 把 `LevelInit.files` 写入 `/repo` 工作区。
 *
 * ⚠️ LightningFS 的 `writeFile` **不会**自动创建父目录（实测：写 `/repo/b/c.txt`
 * 且 `/repo/b` 不存在时抛 `ENOENT`），故此处需逐级补齐父目录。
 * 返回写入的相对路径列表，供后续 `gitApi.add()` 逐一暂存。
 */
async function writeFiles(files: Record<string, string>): Promise<string[]> {
  const filepaths: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    const relative = normalizeRepoPath(path);
    const absolute = `${REPO_DIR}/${relative}`;
    await ensureParentDirs(absolute);
    await fsp.writeFile(absolute, content);
    filepaths.push(relative);
  }
  return filepaths;
}

/** 去掉可能的 `/repo/` 前缀与前导 `/`，统一成仓库内相对路径 */
function normalizeRepoPath(path: string): string {
  const withoutRepo = path.startsWith(`${REPO_DIR}/`) ? path.slice(REPO_DIR.length + 1) : path;
  return withoutRepo.replace(/^\/+/, '');
}

/** 逐级创建 `target` 的父目录；已存在则跳过（幂等） */
async function ensureParentDirs(target: string): Promise<void> {
  const segments = target.split('/').slice(1, -1);
  let current = '';
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
 * 重置为一个干净的空仓库（清空虚拟根 + 建 `/repo` 与 `/remote.git`）。
 *
 * TODO(M4/M5)：`LevelInit.template === 'cloneSource'` 的克隆模板尚未实现，
 * 它需要 `gitApi.clone` 与远程能力（§6.2 表中 `clone` / `remote` 行），属 M5。
 * 本函数只负责「空仓库」这一种模板，不冒充克隆结果。
 */
export async function resetToEmptyRepo(): Promise<GitResult<SandboxState>> {
  return reset({ template: 'emptyRepo' });
}

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
import { GitCommandError, GitUnsupportedError, runGit, type GitResult } from './errors';
import { clearSandboxRoot, ensureSandboxRoot, fsp, REPO_DIR } from './fs';
import * as gitApi from './gitApi';
import { DEFAULT_BRANCH } from './gitApi';
import { clearReflog } from './reflog';

/** M1 已落地的 `LevelInit` 字段——只有这两个，其余字段见 `unsupportedInitError()` */
export type SupportedInitField = 'files' | 'commits';

/**
 * M5/M6 才会落地的 `LevelInit` 字段。
 * 列出它们是为了在 fail-fast 报错里给出准确提示，而非默默吞掉。
 * （M4 起 `branches` 已落地，自本名单移除。）
 */
export type DeferredInitField = 'template:cloneSource' | 'tags' | 'remotes';

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
  if (init.tags?.length) deferred.push('tags');
  if (init.remotes?.length) deferred.push('remotes');
  return deferred;
}

/** 把文件名清单拼进报错信息，便于一眼定位是哪个关卡配错了 */
function describeFields(fields: DeferredInitField[]): string {
  return fields.join('、');
}

/**
 * 校验 `LevelInit` 是否超出当前可落地范围。
 * 返回 `GitResult<void>` 而非抛异常，与全层契约一致。
 */
function assertSupportedScope(init: LevelInit): GitResult<void> {
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
 *      → 写 `files` → 按 `commits` 逐条 `add` + `commit`
 *      （M4 起支持提交级分支切换 `on` 与提交级文件 `files`）→ 预置空分支。
 *
 * ── M4 的分支化预置模型 ────────────────────────────────────────────────
 *
 * `InitCommit.on`：提交落点分支。
 *   - 首次出现 → `gitApi.branch(name)`（从当前 HEAD 创建）+ `checkout`，随后提交落在新分支；
 *   - 再次出现 → 仅 `checkout` 回去，继续在既有分支上提交；
 *   - 缺省 → **回 main**（而不是「沿用当前分支」）。带 on 的预置之后若还有 main 侧提交，
 *     「沿用当前分支」会把它们错误地落到分支上（实测缺陷：3-5 的主线推进落进了 feature）。
 *     关卡预置的书写直觉是「on: 声明分支落点，缺省即主线」，此语义与其一致。
 *
 * `InitCommit.files`：本次提交前写入并暂存的文件（区别于 `LevelInit.files` 的
 * 「进关即写入但不入库」）。用它表达「同一文件在两个分支上有不同内容」的冲突预置
 * （3-4），因为预置提交产出的是**真实对象库**，分支分叉必须来自真实的不同提交。
 *
 * `LevelInit.branches`：预置**空分支**（从 `from` 指向的分支头创建，无独有提交），
 * 服务 3-1「创建分支」类关卡 —— 目标判定要求分支存在，但不预造内容。
 *
 * ⚠️ `commits` 的构建方式：`InitCommit` 的 `author` / `date` 是关卡数据里的
 * 「叙事性署名与时间」，`gitApi.commit()` 强制固定学习者身份且不接受逐条时间戳，
 * 因此产出的提交统一使用固定身份与当前时间；`author` / `date` 仅作关卡数据保留
 * （M1 起的有意取舍，见 gitApi.commit 与此处原注释）。
 *
 * @example 进入关卡时初始化沙箱
 * ```ts
 * const result = await reset(level.init);
 * if (!result.ok) showError(result.error.toString());
 * ```
 */
export async function reset(init: LevelInit = {}): Promise<GitResult<SandboxState>> {
  const scope = assertSupportedScope(init);
  if (!scope.ok) return scope;

  return runGit('sandbox reset', async () => {
    // 1) 清空虚拟根（复用 fs.ts，不自行递归删除）
    await clearSandboxRoot();
    // 2) 重建 /repo 与 /remote.git 两级目录
    await ensureSandboxRoot();

    // ⚠️ 3) 清空 reflog（M5a）：每关都是全新的时间线，上一关的 ref 移动历史
    // 指向的提交在本关已不存在 —— 留着会让 `git reflog` 输出「能恢复到不存在提交」
    // 的假象（§14 禁止伪造）。且日志按仓库目录为键，不清会跨关串味（实测缺陷：
    // 3-2 切到 feature 后 3-3 的 `main` 解析受影响）。
    clearReflog({ dir: REPO_DIR });

    // 4) 初始化主仓库：/repo，默认分支 main
    const inited = await gitApi.init({ dir: REPO_DIR });
    if (!inited.ok) throw inited.error;

    // 5) 写预置文件（首次写入；仅入工作区，不入任何提交 —— 入库走 InitCommit.files）
    const filepaths = await writeFiles(init.files ?? {});

    // 5) 建预置提交：逐条（切分支 →）add + commit，产出真实对象库。
    //    `on` / `files` 的语义见函数注释「M4 的分支化预置模型」。
    for (const entry of init.commits ?? []) {
      // 分支落点：on 缺省 = 回 main（语义见函数注释「M4 的分支化预置模型」）。
      // 若当前已在 main 且 entry.on 缺省，跳过切换（省两次 IO）。
      const targetBranch = entry.on ?? DEFAULT_BRANCH;
      if (targetBranch !== DEFAULT_BRANCH) {
        const branches = await gitApi.listBranches({ dir: REPO_DIR });
        const exists = branches.ok && branches.value.some((b) => b.name === targetBranch);
        if (!exists) {
          const created = await gitApi.branch(targetBranch, { dir: REPO_DIR });
          if (!created.ok) throw created.error;
        }
        const switched = await gitApi.checkout(targetBranch, { dir: REPO_DIR });
        if (!switched.ok) throw switched.error;
      } else {
        const current = await gitApi.status({ dir: REPO_DIR });
        if (current.ok && current.value.branch !== DEFAULT_BRANCH) {
          const switched = await gitApi.checkout(DEFAULT_BRANCH, { dir: REPO_DIR });
          if (!switched.ok) throw switched.error;
        }
      }

      // 提交级文件：只写入并暂存**本提交**的 files（不得携带 init.files 的未入库文件 ——
      // 否则「进关待归档」的关卡设计会被预置提交顺带入库，2-1 即因此开局即 clean，实测缺陷）。
      // ⚠️ 空提交防御的约束（M3 修复 + 探针实测）：gitApi.commit() 在「暂存区与 HEAD
      // 一致」时拒绝提交。**每个**预置提交都必须带 files（哪怕只是改写既有文件）——
      // 切换到新分支后若无任何文件变化，提交会被正确地拒绝。这条约束与 3-4 的
      // 冲突预置模型（两分支各自改写同一文件）天然吻合：冲突本就来自「双方都改」。
      const staged = entry.files ? await writeFiles(entry.files) : [];

      if (staged.length > 0) {
        const added = await gitApi.add(staged, { dir: REPO_DIR });
        if (!added.ok) throw added.error;
      } else {
        throw new GitCommandError(
          'NoCommitError',
          `关卡数据错误：预置提交「${entry.message || entry.msg}」没有 files，` +
            '而空提交被引擎拒绝（M3 语义）——每个预置提交都必须至少改写一个文件。',
          `sandbox reset: init commit "${entry.message || entry.msg}" has no files to stage`,
        );
      }

      const committed = await gitApi.commit(entry.message || entry.msg, { dir: REPO_DIR });
      if (!committed.ok) throw committed.error;
    }

    // 6) 预置空分支：从 `from` 指向的分支头创建（无独有提交）。
    //    `from` 缺省 = 当前 HEAD（真 git 的 `git branch dev` 缺省语义）。
    for (const { name, from } of init.branches ?? []) {
      const created = await gitApi.branch(name, { dir: REPO_DIR, startPoint: from });
      if (!created.ok) throw created.error;
    }

    // 7) 收尾前回到 main：关卡一律从 main 开始（`LevelInit.branches` 只要求「分支存在」）。
    //    `InitCommit.on` 留下的检出游标也一并归位。
    if ((init.commits ?? []).some((c) => c.on) || (init.branches ?? []).length > 0) {
      const mainCheck = await gitApi.checkout(DEFAULT_BRANCH, { dir: REPO_DIR });
      if (!mainCheck.ok) throw mainCheck.error;
    }

    // 8) 预置「工作区被搞乱」的状态（M5a 的 `dirty`，服务第五章的撤销剧本）。
    //    ⚠️ 必须在**所有预置提交与检出游标归位之后**执行：提交会写文件、checkout 会
    //    重建工作区，任何一步在其后都会把玩家要面对的「错误状态」覆盖掉。
    await applyDirty(init.dirty ?? {});

    // 9) 汇总状态：提交列表 + 工作区是否干净
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
 * 应用 `LevelInit.dirty` —— 把工作区改成「被搞乱」的状态（M5a）。
 *
 * 语义（与 `files` 的关键差别在于**执行时机**，见 `reset()` 的步骤 8）：
 *   - 字符串值 → 覆盖工作区内容。对已追踪文件即「有未暂存改动」；
 *   - `null`   → 从工作区删除（模拟误删；索引与 HEAD 仍保留，故 `git restore` 能找回）。
 *
 * ⚠️ 删除走 `fsp.unlink` 而非 `git rm`：`git rm` 会**同时**把删除记进索引，
 *    那样目标文件会直接变成「已暂存的删除」，玩家就不需要「恢复」了 ——
 *    与关卡要考的动作正好相反（M5a 实测确认了这一点）。
 *
 * 路径不存在时（`dirty` 写错文件名）按 ENOENT 向上抛 —— 关卡数据错误应当当场暴露，
 * 而不是留下一个「看起来正常但没有错误状态」的仓库。
 */
async function applyDirty(dirty: Record<string, string | null>): Promise<void> {
  for (const [path, content] of Object.entries(dirty)) {
    const relative = normalizeRepoPath(path);
    const absolute = `${REPO_DIR}/${relative}`;

    if (content === null) {
      await fsp.unlink(absolute);
      continue;
    }

    // 覆盖已存在文件时父目录必然存在；新建路径时补齐（与 writeFiles 同款防御）
    await ensureParentDirs(absolute);
    await fsp.writeFile(absolute, content);
  }
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

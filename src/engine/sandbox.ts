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
 * `branches`（M4）/ `remotes` 与 `template: 'cloneSource'`（M5b）/ `tags`（M6）陆续落地；
 * 本层**不伪造实现**，未落地字段见 `rebuild()` 内的注释与 `reset()` 的 fail-fast 校验。
 */

import type { LevelInit } from '../game/types';
import { GitCommandError, GitUnsupportedError, runGit, type GitResult } from './errors';
import { clearSandboxRoot, ensureSandboxRoot, flushFs, fsp, getFs, REMOTE_DIR, REPO_DIR } from './fs';
import * as gitApi from './gitApi';
import { DEFAULT_BRANCH } from './gitApi';
import { resetRemoteRepo, seedRemoteBranches } from './fileRemote';
import { clearReflog } from './reflog';

/** M1 已落地的 `LevelInit` 字段——后续字段随里程碑陆续落地（见 `reset()` 的 fail-fast 校验） */
export type SupportedInitField = 'files' | 'commits';

/**
/**
 * M6 才会落地的 `LevelInit` 字段。
 * 列出它们是为了在 fail-fast 报错里给出准确提示，而非默默吞掉。
 *
 * ⚠️ M4 起 `branches` 已落地、M5b 起 `remotes` 与 `template:'cloneSource'` 已落地、
 * **M6 起 `tags` 已落地**（第六章「历史锚点」）—— 本名单现已清空。
 * 保留类型与机制本身：未来再出现 deferred 字段时直接复用（与 `DeferredInitField` 同款）。
 */
export type DeferredInitField = never;

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
 *
 * ⚠️ M5b 起 `remotes` 与 `template:'cloneSource'` 已落地（第四章「星际连接」）、
 * M6 起 `tags` 已落地（第六章「历史锚点」）—— deferred 名单已清空。
 * `deferredFieldsOf` 保留为空实现：机制本身（fail-fast 而非静默忽略）仍是未来字段的样板。
 */
function deferredFieldsOf(init: LevelInit): DeferredInitField[] {
  const deferred: DeferredInitField[] = [];
  void init;
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
      `LevelInit 的 ${field} 字段属 M6，当前版本尚未实现，故拒绝执行而非静默忽略。`,
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
    // 0) 先把**上一个** fs 实例的挂起写入落盘并让它静默，再清空虚拟根。
    //
    //    ⚠️ 这一步是 M5a 实测逼出来的（快照切换库名后才暴露）：
    //    LightningFS 的 `saveSuperblock` 是防抖 500ms 的，且 `_deactivate`（最后一次
    //    操作后 500ms 触发）会把**它自己缓存里的 superblock** 写回数据库。
    //    于是「清空 → 重建 → 提交」这一串刚做完，上一个实例的定时器一响，
    //    旧目录树就被写了回去 —— 现象是仓库里出现**上一次的残留文件**
    //    （实测：`reset()` 后 `/repo` 里是 `x.md` 而不是本次预置的 `notes/`）。
    //    先 flush 让状态确定，再清空，可消除这个竞态。
    await flushFs();

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

    // 6.5) 预置标签（M6，第六章「历史锚点」）：
    //      `tags[].at` 是**预置提交的信息**（与 remotes.branches[].at 同一款「语义坐标」，
    //      见 fileRemote.seedRemoteBranches 的注释）—— 在预置历史里定位到对应提交后打标签。
    //      注解标签的 message 取 `msg ?? name`（缺省与 git.tag 的 message=ref 行为一致）。
    //      ⚠️ 必须在预置提交之后执行；标签不随「回 main」移动，放哪一步都可以，
    //         与分支预置放同一段是为可读性。
    //      ⚠️ `at` 找不到时 fail-fast：与 seedRemote 的同款裁定 —— 静默跳过会让关卡
    //         开局少一个标签，玩家对着「给 v1.0 打注解」的目标无从下手且无报错线索。
    if ((init.tags ?? []).length > 0) {
      const allCommits = await gitApi.logAll({ dir: REPO_DIR });
      if (!allCommits.ok) throw allCommits.error;

      const oidByMessage = new Map<string, string>();
      for (const commit of allCommits.value) {
        // 与 seedRemote 同款裁定：同名提交取最早的一个（稳定且可解释）
        const key = commit.message.trim();
        if (!oidByMessage.has(key)) oidByMessage.set(key, commit.hash);
      }

      for (const tag of init.tags ?? []) {
        const oid = oidByMessage.get(tag.at.trim());
        if (oid === undefined) {
          throw new GitCommandError(
            'NotFoundError',
            `关卡数据错误：标签「${tag.name}」引用的提交「${tag.at}」不存在于本关的预置提交中。`,
            `sandbox seedTags: commit "${tag.at}" not found`,
            { command: 'sandbox reset', hint: '请核对关卡 init.commits 里的 message。' },
          );
        }
        const created = await gitApi.createTag(tag.name, {
          dir: REPO_DIR,
          ...(tag.message !== undefined ? { message: tag.message } : {}),
          target: oid,
        });
        if (!created.ok) throw created.error;
      }
    }

    // 7) 收尾检出位置：默认回 main（`LevelInit.branches` 只要求「分支存在」；
    //    `InitCommit.on` 留下的检出游标也一并归位）。
    //    ⚠️ 例外（M6，F-1「崩坏时间线」）：`stayOnBranch` 显式声明「开局停在某个
    //    非主线分支」——「风暴把你困在修复分支」的叙事需要开局即在 feature，
    //    且这让 `headBranch main` 类目标开局不成立。**不猜**：既有关卡
    //    （ch3/ch4）即便最后一条预置带 on，也一律回 main（其测试锁定该行为）。
    if ((init.commits ?? []).some((c) => c.on) || (init.branches ?? []).length > 0) {
      const checkoutTarget = init.stayOnBranch ?? DEFAULT_BRANCH;
      const checkout = await gitApi.checkout(checkoutTarget, { dir: REPO_DIR });
      if (!checkout.ok) throw checkout.error;
    }

    // 7.5) 远程宇宙（M5b，第四章「星际连接」）。
    //      顺序刻意如此：**先**在 `/repo` 里建好预置提交，**再**把它们搬进裸仓 ——
    //      裸仓的内容必须来自真实提交（搬迁走 packObjects + indexPack，产出真对象库），
    //      而不是手写对象文件（§14 禁止伪造）。
    const remoteSeeded = await seedRemote(init);
    if (!remoteSeeded.ok) throw remoteSeeded.error;

    // 7.6) `template: 'cloneSource'`（M5b，服务 4-4「克隆宇宙」）：
    //      把 `/repo` 清空成一个**没有历史的空仓库**，让玩家必须自己 `git clone`。
    //
    //      ⚠️ 为什么必须在 seedRemote **之后**：预置提交既是「远程内容的来源」，
    //      又被本步清掉 —— 顺序反了就没有东西可搬进裸仓了。
    //      ⚠️ 语义边界：本步只清 `/repo`（工作区 + 索引 + 对象库），不动 `/remote.git`。
    //      这正是「克隆」的前置状态：本地空、远程有。
    if (init.template === 'cloneSource') {
      const cleared = await resetLocalRepoOnly();
      if (!cleared.ok) throw cleared.error;

      // 清空之后目标状态必定未达成，无需再走后面的汇总逻辑计算「干净与否」——
      // 但汇总仍要走（`reset()` 的返回值要给 UI 用），故这里只把游标推进到空仓库。
    }

    // 8) 预置「工作区被搞乱」的状态（M5a 的 `dirty`，服务第五章的撤销剧本）。
    //    ⚠️ 必须在**所有预置提交与检出游标归位之后**执行：提交会写文件、checkout 会
    //    重建工作区，任何一步在其后都会把玩家要面对的「错误状态」覆盖掉。
    //    ⚠️ 也必须在 cloneSource 清空之后 —— 否则 dirty 写入的文件会被清掉。
    if (init.template !== 'cloneSource') {
      await applyDirty(init.dirty ?? {});
    }

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
 * 预置**远程宇宙**（M5b，服务第四章「星际连接」）。
 *
 * 步骤：
 *   1. 重建裸仓为空（`resetRemoteRepo`）—— 每关都是全新的远程宇宙，上一关的
 *      分支若残留会让 4-2「推送」在开局即显示「已是最新」，属跨关串味；
 *   2. 按 `remotes[].branches[].at` 指明的**提交信息**，在 `/repo` 的预置历史里
 *      定位到对应提交 oid；
 *   3. 把这些提交搬进裸仓并置分支指针（`seedRemoteBranches`，走真 pack 搬迁）；
 *   4. 写 `remote.<name>.url` 配置 —— 让玩家进关就能 `git push`，不必先 add。
 *      （4-1「建立航道」正是考 `remote add`，故那一关的 `remotes` 只给空 branches
 *       或干脆不给 —— 由关卡数据决定，本函数不做特判。）
 *
 * ⚠️ 两个刻意的 fail-fast：
 *   - `at` 找不到对应提交 → 报错。否则会安静地生成一个空远程分支，玩家 push 时
 *     才发现「远程什么都没有」，而报错信息指不到关卡数据；
 *   - `url` 不合白名单 → 报错。与 `gitApi.addRemote` 同一口径（决策 ③）。
 */
async function seedRemote(init: LevelInit): Promise<GitResult<void>> {
  // 无论关卡是否声明远程，每关都重建裸仓 —— 与 `/repo` 的 clearSandboxRoot 对称。
  // 否则上一关的远程分支会留到本关（跨关串味）。
  if ((init.remotes ?? []).length === 0) {
    return resetRemoteRepo();
  }

  const resetted = await resetRemoteRepo();
  if (!resetted.ok) return resetted;

  // 预置提交的信息 → oid 映射（用于把关卡数据里的 `at` 解析成真实提交）
  //
  // ⚠️ 必须用 `logAll`（遍历**全部**分支）而非 `log`（只走当前 HEAD 链）：
  //    `at` 可能指向非当前分支上的提交 —— 如 4-5「协作冲突」里
  //    「别人推的」那条与本地区分叉的历史，它不在 main 的祖先链上。
  const allCommits = await gitApi.logAll({ dir: REPO_DIR });
  if (!allCommits.ok) return allCommits;

  const oidByMessage = new Map<string, string>();
  for (const commit of allCommits.value) {
    // 同名提交取**最早**的一个：关卡数据里的信息是叙事性的，重名属作者疏忽，
    // 取最早可给出稳定且可解释的结果（不静默取任意一个）。
    const key = commit.message.trim();
    if (!oidByMessage.has(key)) oidByMessage.set(key, commit.hash);
  }

  for (const remote of init.remotes ?? []) {
    if (!gitApi.isAllowedRemoteUrl(remote.url)) {
      return {
        ok: false,
        error: new GitUnsupportedError(
          `remote add ${remote.name} ${remote.url}`,
          `关卡数据错误：远程地址「${remote.url}」不在白名单内，` +
            `应使用 ${gitApi.ALLOWED_REMOTE_URL}。`,
        ),
      };
    }

    const branches: { name: string; fromDir: string; oid: string }[] = [];
    for (const entry of remote.branches ?? []) {
      const oid = oidByMessage.get(entry.at.trim());
      if (oid === undefined) {
        return {
          ok: false,
          error: new GitCommandError(
            'NotFoundError',
            `关卡数据错误：远程分支「${entry.branch}」引用的提交「${entry.at}」` +
              '不存在于本关的预置提交中。',
            `sandbox seedRemote: commit "${entry.at}" not found`,
            { command: 'remote seed', hint: '请核对关卡 init.commits 里的 message。' },
          ),
        };
      }
      branches.push({ name: entry.branch, fromDir: REPO_DIR, oid });
    }

    const seeded = await seedRemoteBranches(branches);
    if (!seeded.ok) return seeded;

    // 写 remote 配置：让玩家进关即可 push/fetch。
    // ⚠️ `linkLocal: false` 用于「本关要考 `git remote add`」的场景（4-1）——
    //    若此处照写，该关的 `remote` 目标会开局即达标，玩家不敲命令就过关（实测抓到）。
    //    默认 true：多数远程关卡希望玩家直接进入 push/fetch 的正题。
    if (remote.linkLocal !== false) {
      const urlWritten = await gitApi.writeRemoteConfig(remote.name, gitApi.ALLOWED_REMOTE_URL);
      if (!urlWritten.ok) return urlWritten;
    }
  }

  return { ok: true, value: undefined };
}

/**
 * 把 `/repo` 清空成一个**没有历史的空仓库**（`template: 'cloneSource'`）。
 *
 * 用途：构造「本地空、远程有」的克隆前置状态（4-4「克隆宇宙」）。
 *
 * ⚠️ 与 `resetRemoteRepo` 对称但**对象不同**：本函数只动 `/repo`，绝不动 `/remote.git`
 *    —— 后者正是玩家要克隆的源。两者混用会把「待克隆的远程」也清掉，
 *    现象是 clone 出一个空仓库（而 glone 自身不会报错）。
 */
async function resetLocalRepoOnly(): Promise<GitResult<void>> {
  return runGit('sandbox reset-clone-source', async () => {
    const fs = getFs().promises;

    // 递归删掉 /repo 后重建 —— `git.init` 是幂等的，只删内部文件不会清掉对象库与 refs
    const { removeDir } = await import('./fs');
    await removeDir(REPO_DIR);
    await fs.mkdir(REPO_DIR, { mode: 0o777 });

    const inited = await gitApi.init({ dir: REPO_DIR });
    if (!inited.ok) throw inited.error;
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

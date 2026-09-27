/**
 * 第三章「平行宇宙」关卡定义（GDD §4 第三章、development-refinement.md §8）。
 *
 * ┌──────┬──────────────┬──────────────────────────────┬─────────────────┬──────┐
 * │ 关卡 │ 名称         │ 目标                         │ 关联笔记        │ 难度 │
 * ├──────┼──────────────┼──────────────────────────────┼─────────────────┼──────┤
 * │ 3-1  │ 分裂宇宙     │ branch 创建分支（不切换）    │ 分支管理·创建   │ ★★   │
 * │ 3-2  │ 穿越宇宙     │ checkout/switch 切换分支     │ 分支管理·切换   │ ★★   │
 * │ 3-3  │ 合并宇宙     │ merge 合并分支               │ 分支管理·合并   │ ★★★  │
 * │ 3-4  │ 冲突消解     │ 解决合并冲突                 │ 分支管理·冲突   │ ★★★★ │
 * │ 3-5  │ 变基重写     │ rebase 整理历史              │ 分支管理·rebase │ ★★★★ │
 * │ 3-6  │ 分支博弈     │ merge vs rebase 实践         │ 分支管理·最佳实践│ ★★★★ │
 * └──────┴──────────────┴──────────────────────────────┴─────────────────┴──────┘
 *
 * ─── 输入模式与骨架 ────────────────────────────────────────────────────────
 *
 * 第三章输入 = **半拼（half）**（GDD §3.2「过渡：提供命令骨架 + 关键参数填空」）。
 * 每关的 `halfSkeleton` 声明骨架命令（如 `git merge`），进关时预填进拼接草稿，
 * 玩家补齐参数即可执行；骨架之外的片段仍可点击（Escape 路径保留完整拼接能力）。
 *
 * ─── 命令集与目标设计约束 ─────────────────────────────────────────────────
 *
 * - 命令集：branch / checkout / switch / merge / rebase（§8 与 GDD 一致）。
 * - 目标类型首次使用 M4 转正的 4 种：branch / headBranch / merged / logOrder。
 * - **3-6 的 OR 语义限制**：TargetCondition 为 AND 语义，无法表达「merge 或 rebase
 *   任一过关」（新增目标类型属范围外，见 docs/milestones/M4-tasks.md §二）。本关按「merge 路径」
 *   判定 —— 叙事明确说明：协作历史用 merge 保留完整脉络；rebase 适用场景（个人
 *   未推送分支）在笔记里展开。这是经用户确认的 M4 裁定（docs/milestones/M4-tasks.md §〇.3 附注）。
 * - 3-5 的 rebase 引擎语义（M4 实测差异）：重放保留原提交 tree，故关卡数据保证
 *   feature 与 main 的改动**互不相交**（不同文件）—— 此场景下重放结果与真 git
 *   的三方合并一致（main 的 b.txt 等文件会经由重放链出现在 feature 视角之外，
 *   但 logOrder 判定只看提交顺序，不依赖文件内容）。executor.test.ts 有回归锁。
 * - 预置提交的 files 约束（M4 引擎规则）：**每个**预置提交必须至少写一个文件，
 *   否则触发 M3 空提交防御 —— 关卡数据据此编写。
 *
 * ─── relatedKnowledge 映射（沿用两套规则，Lead 核定）──────────────────────
 *
 * | 关卡 | GDD 关联            | 笔记实际小节          | id                                    |
 * |------|---------------------|-----------------------|---------------------------------------|
 * | 3-1  | 分支管理·创建       | `### 创建分支`        | `git-branches#create`                 |
 * | 3-2  | 分支管理·切换       | `### 切换分支`        | `git-branches#switch`                 |
 * | 3-3  | 分支管理·合并       | `### 基本合并`        | `git-branches#basic-merge`            |
 * | 3-4  | 分支管理·冲突       | `### 合并冲突处理`    | `git-branches#merge-conflict`         |
 * | 3-5  | 分支管理·rebase     | `### Rebase vs Merge` | `git-branches#rebase-vs-merge`        |
 * | 3-6  | 分支管理·最佳实践   | `## 分支管理最佳实践` | `git-branches#best-practices`         |
 */

import type { Level } from '../../game/types';
import {
  BEACON_COORDS,
  REBASE_FEATURE_LOG,
  REBASE_MAIN_LOG,
  UNIVERSE_BASE,
  UNIVERSE_FEATURE_NOTE,
} from '../presets';

/** 第三章计分参数（难度上升：baseScore 与 1/2 章持平，最优奖励提升） */
const SCORING = {
  baseScore: 100,
  undoPenalty: 15,
  redoPenalty: 10,
  hintPenalty: 5,
  optimalBonus: 20,
  flawlessBonus: 25,
  probeBonus: 2,
} as const;

/**
 * 3-1 分裂宇宙（★★，半拼）
 *
 * 骨架 `git branch`：玩家补参数 dev 创建分支。
 * 教学点：「创建 ≠ 切换」—— branch 只立旗标，HEAD 仍在 main。
 * 目标 = dev 存在 + 仍在 main（若玩家顺手 checkout 会判 headBranch 失败）。
 *
 * 参考解法 1 步：git branch dev（optimalMoves = 1）。
 */
const LEVEL_3_1: Level = {
  id: 'ch3-1',
  chapter: 'ch3',
  title: '分裂宇宙',
  objective: '在主时间线旁立起一条名为 dev 的观测分支，并让 main 的观测继续向前推进一步。注意：立旗标不等于穿越 —— branch 只登记分支，不改变你所在的位置。',
  difficulty: 2,
  inputMode: 'half',
  halfSkeleton: 'git branch',
  relatedKnowledge: ['git-branches#create'],
  init: {
    commits: [
      { author: '练习者', date: '第五天', msg: '观测站基线', message: '观测站基线', files: { 'base.md': UNIVERSE_BASE } },
    ],
  },
  targets: [
    { type: 'branch', name: 'dev', exists: true },
    // 「创建 ≠ 切换」的教学点用数量门槛表达：玩家还需在 main 上再归档一次
    // （若顺手 checkout 到 dev 提交，headBranch 判定不了 —— branch 目标只查存在性，
    //  检出状态的教学点由 3-2 承接；此处约束「不切走也能过关」即可）。
    { type: 'commitCount', op: 'gte', value: 2 },
  ],
  winScore: 60,
  scoring: { ...SCORING },
  // 参考解法 3 步：git branch dev → 编辑文件（不计）→ git add base.md → git commit
  optimalMoves: 3,
  hints: [
    { text: '创建分支只需一条命令 —— 骨架已经给出，补上分支名即可。别忘了 main 的观测也要前进一步。', unlockAfterFailures: 0 },
    { text: 'git branch dev 会创建分支，但不会切换过去。之后在 main 上改文件、暂存、提交即可。', unlockAfterFailures: 1 },
    { text: '完整答案：git branch dev，然后编辑 base.md，git add base.md，git commit -m "main 观测推进"', unlockAfterFailures: 3 },
  ],
};

/**
 * 3-2 穿越宇宙（★★，半拼）
 *
 * init 预置 feature 分支（与 main 同头、无独有提交），玩家切换过去。
 * 骨架 `git checkout`；目标 = headBranch: feature。
 * 为防「开局即过关」附加 commitCount ≥1 的门槛（预置已有 1 提交，玩家还需
 * 在 feature 上做出一次真实归档）。
 *
 * 参考解法 3 步：git checkout feature → 编辑文件（不计）→ git add . → git commit。
 * optimalMoves = 3（checkout + add + commit）。
 */
const LEVEL_3_2: Level = {
  id: 'ch3-2',
  chapter: 'ch3',
  title: '穿越宇宙',
  objective: '一条 feature 分支已经立起。穿越过去，并在那条宇宙里完成一次新的观测归档 —— 让 feature 的时间线真正向前走一步。',
  difficulty: 2,
  inputMode: 'half',
  halfSkeleton: 'git checkout',
  relatedKnowledge: ['git-branches#switch'],
  init: {
    commits: [
      { author: '练习者', date: '第六天', msg: '观测站基线', message: '观测站基线', files: { 'base.md': UNIVERSE_BASE } },
      {
        author: '练习者',
        date: '第六天',
        msg: 'feature 分支成立',
        message: 'feature 分支成立',
        on: 'feature',
        files: { 'base.md': UNIVERSE_BASE + '\n（feature 分支已立起）\n' },
      },
    ],
  },
  targets: [
    { type: 'headBranch', name: 'feature' },
    // ⚠️ 不用 workdirClean：reset 收尾检出 main 时工作区 = main 树 = 干净，开局即达标（实测）。
    // 改用 commitCount 门槛（log() 走 HEAD —— 玩家必须切到 feature 并提交，HEAD 链上才有 3 个提交）。
    { type: 'commitCount', op: 'gte', value: 3 },
  ],
  winScore: 60,
  scoring: { ...SCORING },
  optimalMoves: 3,
  hints: [
    { text: '骨架命令已给出 —— 补上目标分支名即可穿越。', unlockAfterFailures: 0 },
    { text: '切换用 git checkout feature（或 git switch feature）。穿越之后，在 feature 上改文件、归档，才算向前走。', unlockAfterFailures: 1 },
    { text: '完整答案：git checkout feature → 编辑任意文件（如 base.md）→ git add . → git commit -m "feature 观测"', unlockAfterFailures: 3 },
  ],
};

/**
 * 3-3 合并宇宙（★★★，半拼）
 *
 * 预置：main 1 提交 + feature 1 独有提交（UNIVERSE_FEATURE_NOTE，互不相交 → 无冲突）。
 * 玩家在 main 上 merge feature。目标 = merged + main 的历史含 feature 提交信息 + 数量。
 *
 * 参考解法 2 步：git checkout main（若已在则跳过）→ git merge feature。
 * init 收尾保证检出 main，故 optimalMoves = 1（单条 merge）。
 */
const LEVEL_3_3: Level = {
  id: 'ch3-3',
  chapter: 'ch3',
  title: '合并宇宙',
  objective: 'feature 宇宙捕捉到了 main 未收录的现象。站在 main 上把它合并回来 —— 让两条时间线归于一条。',
  difficulty: 3,
  inputMode: 'half',
  halfSkeleton: 'git merge',
  relatedKnowledge: ['git-branches#basic-merge'],
  init: {
    commits: [
      { author: '练习者', date: '第七天', msg: '观测站基线', message: '观测站基线', files: { 'base.md': UNIVERSE_BASE } },
      {
        author: '练习者',
        date: '第七天',
        msg: 'feature 捕获新现象',
        message: 'feature 捕获新现象',
        on: 'feature',
        files: { 'feature-note.md': UNIVERSE_FEATURE_NOTE },
      },
    ],
  },
  targets: [
    // merged 在合并前为 false —— 通用兜底已足够，不加 workdirClean
    // （reset 收尾检出 main 后工作区 = main 树 = 干净，会开局即达标，实测）。
    { type: 'merged', branch: 'feature', into: 'main' },
    { type: 'commitExists', message: 'feature 捕获新现象' },
  ],
  winScore: 70,
  scoring: { ...SCORING },
  optimalMoves: 1,
  hints: [
    { text: '站在 main 上，把 feature 合并进来 —— 骨架已就位，补分支名即可。', unlockAfterFailures: 0 },
    { text: 'git merge feature 会把 feature 的观测带进当前分支。合并后 feature-note.md 应出现在工作区。', unlockAfterFailures: 1 },
    { text: '完整答案：git merge feature', unlockAfterFailures: 3 },
  ],
};

/**
 * 3-4 冲突消解（★★★★，半拼）
 *
 * 预置真冲突：main 与 feature 各自改写 BEACON_COORDS（M4 分支预置模型的核心场景）。
 * 玩家流程：merge（报冲突、工作区落标记）→ 编辑器打开 beacon.md、改写坐标、
 * 去掉冲突标记 → add → commit（引擎的 MERGE_HEAD 机制自动产出双亲合并提交）。
 * 目标 = merged + 文件内容为裁决后的坐标 + 数量门槛。
 *
 * 参考解法 4 步：git merge feature → 编辑 beacon.md（不计）→ git add . → git commit。
 * optimalMoves = 3。
 */
const LEVEL_3_4: Level = {
  id: 'ch3-4',
  chapter: 'ch3',
  title: '冲突消解',
  objective: '两个宇宙同时校准了信标坐标，且互不相让。发起合并、直面冲突 —— 打开 beacon.md，裁决最终坐标、清掉冲突标记，然后完成这次合并。',
  difficulty: 4,
  inputMode: 'half',
  halfSkeleton: 'git merge',
  relatedKnowledge: ['git-branches#merge-conflict'],
  init: {
    // ⚠️ 预置顺序即分叉结构（on 缺省回 main，on: feature 先分叉、main 后推进）：
    // c1（信标基线，main）→ feature 从 c1 分叉并改写信标 → main 再改写信标。
    // 两分支各自改写同一文件 → merge 必然冲突（3-4 的核心预置）。
    commits: [
      // 信标基线：main 的首个提交（file 目标预期内容以玩家裁决为准，基线信息不含裁决文本）
      { author: '练习者', date: '第八天', msg: '信标基线', message: '信标基线', files: { 'beacon.md': BEACON_COORDS } },
      {
        author: '练习者',
        date: '第八天',
        msg: 'feature 宇宙校准',
        message: 'feature 宇宙校准',
        on: 'feature',
        files: { 'beacon.md': '信标坐标\n\n纬度：北纬 45\n经度：东经 90\n\nfeature 宇宙的读数。\n' },
      },
      {
        author: '练习者',
        date: '第八天',
        msg: 'main 宇宙校准',
        message: 'main 宇宙校准',
        files: { 'beacon.md': '信标坐标\n\n纬度：北纬 30\n经度：东经 120\n\nmain 宇宙的读数。\n' },
      },
    ],
  },
  targets: [
    // 合并完成：feature 头成为 main 的祖先
    { type: 'merged', branch: 'feature', into: 'main' },
    // 玩家裁决了坐标（不是保留任何一侧原样 —— 两个宇宙的读数各取一半）
    {
      type: 'file',
      path: 'beacon.md',
      exists: true,
      content: '信标坐标\n\n纬度：北纬 37.5\n经度：东经 105\n\n两个宇宙读数的折中，由你亲自裁决。\n',
    },
    { type: 'commitCount', op: 'gte', value: 3 },
  ],
  winScore: 80,
  scoring: { ...SCORING },
  optimalMoves: 3,
  hints: [
    { text: '合并会立刻报冲突 —— 这不是失败，是流程的一部分。冲突文件会带上标记等你处理。', unlockAfterFailures: 0 },
    { text: '打开 beacon.md：<<<<<<< 与 >>>>>>> 之间是两个版本。改写成最终坐标、删掉三行标记，然后 git add . 并 git commit 完成合并。', unlockAfterFailures: 1 },
    {
      text: '完整答案：git merge feature → 编辑 beacon.md 为「纬度：北纬 37.5 / 经度：东经 105 / 两个宇宙读数的折中，由你亲自裁决。」→ git add . → git commit -m "Merge branch \'feature\' into main"',
      unlockAfterFailures: 3,
    },
  ],
};

/**
 * 3-5 变基重写（★★★★，半拼）
 *
 * 预置：main 2 提交（主线档案 + 最新主线）；feature 1 独有提交（基于旧主线）。
 * 玩家切到 feature、rebase main —— feature 的历史被重写到主线最新处。
 * 目标 = logOrder（feature 的历史顺序：feature 记录在主线最新提交之上）+ headBranch。
 *
 * ⚠️ 引擎语义（M4 实测，见 executor.test.ts 回归锁）：重放保留原提交 tree，
 * 因此预置保证 feature 与 main 改动互不相交（不同文件）—— 此场景下与真 git 结果一致。
 *
 * 参考解法 2 步：git checkout feature → git rebase main（optimalMoves = 2）。
 */
const LEVEL_3_5: Level = {
  id: 'ch3-5',
  chapter: 'ch3',
  title: '变基重写',
  objective: 'feature 分支的观测诞生于较早的时间点。穿越到 feature，把它的历史整体变基到主线最新处 —— 让故事接得上，而不是从旧岔路分叉。',
  difficulty: 4,
  inputMode: 'half',
  halfSkeleton: 'git checkout',
  relatedKnowledge: ['git-branches#rebase-vs-merge'],
  init: {
    // ⚠️ 预置顺序即分叉结构（InitCommit.on 首次出现 = 从当前 HEAD 创建分支）：
    // c1(main) → on:feature 提交（从 c1 分叉）→ main 再推进两次。
    // 这样 feature 的历史是「旧观测 → 主线档案建立」（落后主线两步），
    // rebase 后才变成「旧观测 → 主线推进 → 主线档案建立」。
    commits: [
      { author: '练习者', date: '第九天', msg: '主线档案建立', message: '主线档案建立', files: { 'main-log.md': REBASE_MAIN_LOG } },
      {
        author: '练习者',
        date: '第九天',
        msg: '旧观测',
        message: '旧观测',
        on: 'feature',
        files: { 'feature-log.md': REBASE_FEATURE_LOG },
      },
      {
        author: '练习者',
        date: '第九天',
        msg: '主线推进',
        message: '主线推进',
        files: { 'main-extra.md': '主线的最新一段记录。\n' },
      },
    ],
  },
  targets: [
    // rebase 后 feature 的历史（新→旧）应为：旧观测 → 主线推进 → 主线档案建立
    { type: 'logOrder', order: ['旧观测', '主线推进', '主线档案建立'], branch: 'feature' },
    { type: 'headBranch', name: 'feature' },
  ],
  winScore: 80,
  scoring: { ...SCORING },
  optimalMoves: 2,
  hints: [
    { text: '变基的对象是 feature —— 先确保自己站在 feature 上。', unlockAfterFailures: 0 },
    { text: 'git rebase main 会把 feature 的独有提交重放到 main 最新处。rebase 后用 log --oneline 检查顺序。', unlockAfterFailures: 1 },
    { text: '完整答案：git checkout feature，然后 git rebase main', unlockAfterFailures: 3 },
  ],
};

/**
 * 3-6 分支博弈（★★★★，半拼）
 *
 * 收束关：同一仓库里既有「该合并的协作历史」又有「该变基的旧岔路」。
 * **AND 语义限制下按 merge 路径判定**（M4 裁定，见文件头）：
 * 玩家把 collaborative 分支合并回 main —— 叙事同时传达 rebase 的适用边界
 * （个人未推送分支才变基；协作历史用合并保留）。
 *
 * 参考解法 1 步：git merge collaborative（optimalMoves = 1）。
 */
const LEVEL_3_6: Level = {
  id: 'ch3-6',
  chapter: 'ch3',
  title: '分支博弈',
  objective: 'collaborative 分支承载着与同伴共创的公开历史 —— 公开历史不该被改写。把它**合并**回 main，保全完整脉络。至于从未公开的旧岔路，改写它（rebase）的时机你已在笔记中读过。',
  difficulty: 4,
  inputMode: 'half',
  halfSkeleton: 'git merge',
  relatedKnowledge: ['git-branches#best-practices'],
  init: {
    commits: [
      { author: '练习者', date: '第十天', msg: '观测站基线', message: '观测站基线', files: { 'base.md': UNIVERSE_BASE } },
      {
        author: '同伴',
        date: '第十天',
        msg: '同伴的协作记录',
        message: '同伴的协作记录',
        on: 'collaborative',
        files: { 'collab-note.md': '同伴在本宇宙留下的协作观测。\n\n公开历史值得被完整保留。\n' },
      },
    ],
  },
  targets: [
    { type: 'merged', branch: 'collaborative', into: 'main' },
    { type: 'commitExists', message: '同伴的协作记录' },
    // ⚠️ 不加 workdirClean / headBranch: main（开局即达标，实测）；
    // 改用 commitCount 门槛：合并后 main 链上应有 2+ 提交。
    { type: 'commitCount', op: 'gte', value: 2 },
  ],
  winScore: 80,
  scoring: { ...SCORING },
  optimalMoves: 1,
  hints: [
    { text: 'collaborative 是公开历史 —— 判定要求它被合并（保留脉络），而不是被变基改写。', unlockAfterFailures: 0 },
    { text: '站在 main 上执行 git merge collaborative。合并后 collab-note.md 会出现在工作区。', unlockAfterFailures: 1 },
    { text: '完整答案：git merge collaborative', unlockAfterFailures: 3 },
  ],
};

/** 第三章全部关卡（GDD §4 第三章：3-1 ~ 3-6） */
export const CHAPTER_3_LEVELS: Level[] = [
  LEVEL_3_1,
  LEVEL_3_2,
  LEVEL_3_3,
  LEVEL_3_4,
  LEVEL_3_5,
  LEVEL_3_6,
];

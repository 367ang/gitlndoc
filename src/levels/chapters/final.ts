/**
 * 终章「大统一」关卡定义（GDD §4 终章、development-refinement.md §8）。
 *
 * ┌──────┬──────────────┬──────────────────────────────────────┬────────────┬──────┐
 * │ 关卡 │ 名称         │ 目标                                 │ 关联       │ 难度 │
 * ├──────┼──────────────┼──────────────────────────────────────┼────────────┼──────┤
 * │ F-1  │ 崩坏时间线   │ 综合修复：分支+合并+冲突+撤销        │ 全部       │ ★★★★★│
 * │ F-2  │ 完整交付     │ 从 init 到 tag 的完整流程            │ 全部       │ ★★★★★│
 * └──────┴──────────────┴──────────────────────────────────────┴────────────┴──────┘
 *
 * ─── 输入模式（GDD §3.2）───────────────────────────────────────────────────
 *
 * 终章 = **自由输入（free）**。两关都没有 `halfSkeleton`。
 *
 * ─── 综合判定的边界（如实记录，不假装完备）────────────────────────────────
 *
 * F-1 的「撤销」成分：开局用 `dirty` 造出「错误已经发生」，且预置历史**本身就包含**
 * 一条被 revert 过的提交（玩家要读历史才能理解）。判据锚定在「终态正确」上：
 *   - 冲突必须被真正解决（信标文件最终内容唯一）；
 *   - 分支必须被合并（merged）；
 *   - 历史只增不减（撤销用 revert 而非 reset）。
 *
 * F-2 的「完整流程」：从空仓库（`template: 'emptyRepo'`）起步，走完
 * init → 归档 → 提交 → 分支开发 → 合并 → 打注解标签 v1.0.0 的全链路。
 * 注意：空仓库模板下 `git init` 幂等，玩家重复执行无害（AGENTS 引擎事实第 2 条 ——
 * 「init 创建仓库」类目标无法用状态判定表达，故判据锚定在流程**末端状态**）。
 */

import type { Level } from '../../game/types';
import { BEACON_COORDS, UNIVERSE_BASE, UNIVERSE_FEATURE_NOTE } from '../presets';

/** 终章计分参数（难度与扣分与第五、六章持平；最优序列奖励要求全程少走弯路） */
const SCORING = {
  baseScore: 100,
  undoPenalty: 15,
  redoPenalty: 10,
  hintPenalty: 5,
  optimalBonus: 20,
  flawlessBonus: 25,
  probeBonus: 2,
} as const;

/** F-1 信标文件的「已损坏」内容（预置到 feature 分支，等待玩家裁决） */
const F1_BEACON_CORRUPTED = `信标坐标

纬度：∞（漂移中）
经度：∞（漂移中）

紧急修复分支上的坐标已经失真 —— 合并时你需要亲自写下正确的数值。
`;

/** F-1 信标文件在 main 侧的「漂移」内容（与 feature 的失真不同 —— 冲突的前提） */
const F1_BEACON_MAIN_DRIFTED = `信标坐标

纬度：12.00（漂移）
经度：34.00（漂移）

主线的坐标也被风暴波及 —— 两边的读数不一致，合并时必须裁决。
`;

/** F-1 信标文件的「正确最终版」（玩家解决冲突后要写出的内容） */
const F1_BEACON_FINAL = `信标坐标

纬度：47.20
经度：108.60

两边的观测都已合流 —— 这是唯一的权威坐标。
`;

/** F-2 的交付清单（玩家要在编辑器里亲手创建的内容 —— 固定文本即目标判据） */
const F2_MANIFEST = `时间线管理局 · 交付清单

项目：平行宇宙观测站 · 首个正式版本
状态：已交付
`;

/**
 * F-1 崩坏时间线（★★★★★，自由）
 *
 * 剧本：一次时间风暴让信标坐标在 feature 分支上彻底失真，main 与 feature 各自前进。
 * 玩家要完成一次完整的「修复工作流」：
 *   1. 在 feature 上把信标改回正确坐标并归档（开局即在 feature，工作区里是失真坐标）；
 *   2. 切回 main，合并 feature —— 信标**必然冲突**（两边都改过同一文件）；
 *   3. 亲自裁决：编辑信标为最终版、add、commit 完成合并；
 *   4. 风暴留下的错误记录不能被抹掉（历史只增不减 —— 由预置的反向提交示范，
 *      并由「历史只增」判据守护）。
 *
 * ── 开局状态与判据（M6 实测逼出的设计）────────────────────────────────
 *
 * ⚠️ 开局即在 feature 分支：预置以 `on: 'feature'` 收尾（不回 main —— 这既是
 *    「风暴把你困在修复分支」的叙事，也让 `headBranch main` 开局不成立）。
 *    ⚠️ sandbox 预置的收尾规则：`on` 出现过才回 main（见 sandbox.reset 步骤 7）；
 *       本关刻意让最后一条预置提交落在 feature，收尾便停在 feature。
 * ⚠️ merged 开局不成立：feature 在失真提交之后又多一条「风暴仍未散去」，
 *    故 feature 领先 main；直到真正合并才成立。
 * ⚠️ commitCount gte 7：5 条预置（基线/失真/推进/反向示范/风暴记录）+ feature 修复(1)
 *    + 合并提交(1) = 7 —— 少任何一步都到不了 7。
 */
const LEVEL_F_1: Level = {
  id: 'F-1',
  chapter: 'F',
  title: '崩坏时间线',
  objective:
    '一次时间风暴把信标坐标在修复分支上彻底改乱 —— 你现在就困在 feature 分支上，工作区里是被风暴改坏的坐标。完成一次完整的修复：把信标改回正确数值并归档，回到 main 合并 feature（信标必然冲突，由你亲自裁决，写下唯一权威坐标：纬度 47.20 / 经度 108.60）。风暴留下的错误记录不能被抹掉 —— 历史只能向前延伸。全程以 main 收尾。',
  difficulty: 5,
  inputMode: 'free',
  relatedKnowledge: ['git-branches#merge-conflict', 'git-undo#revert'],
  init: {
    commits: [
      {
        author: '练习者',
        date: '终章第一天',
        msg: '观测站基线',
        message: '观测站基线',
        files: { 'notes/观测站.md': UNIVERSE_BASE, 'notes/信标坐标.md': BEACON_COORDS },
      },
      {
        // feature 分支：信标坐标被风暴搞乱（这是「误改」的既成事实）
        author: '风暴',
        date: '终章第一天',
        msg: '信标坐标失真',
        message: '信标坐标失真',
        on: 'feature',
        files: { 'notes/信标坐标.md': F1_BEACON_CORRUPTED },
      },
      {
        // main 侧：基线之后的一次推进 —— **顺带误改了信标**（风暴把两个宇宙都波及了）。
        // ⚠️ 这是「合并必然冲突」的构造前提：同一文件在两个分支上都被改成不同内容。
        author: '练习者',
        date: '终章第一天',
        msg: '主线观测推进',
        message: '主线观测推进',
        files: {
          'notes/观测站.md': `${UNIVERSE_BASE}\n主线观测推进一次。\n`,
          'notes/信标坐标.md': F1_BEACON_MAIN_DRIFTED,
        },
      },
      {
        // main 侧的反向提交：示范「历史向前抵消错误」的痕迹（叙事的一部分）
        author: '练习者',
        date: '终章第一天',
        msg: 'Revert "误改经度记录"',
        message: 'Revert "误改经度记录"',
        files: { 'notes/误改记录.md': '误改经度记录\n\n已被反向提交抵消。\n' },
      },
      {
        // feature 分支的收尾提交（风暴叙事的一部分，也让 commitCount 达到 5）
        author: '风暴',
        date: '终章第一天',
        msg: '风暴仍未散去',
        message: '风暴仍未散去',
        on: 'feature',
        files: { 'notes/风暴记录.md': '风暴仍在肆虐，信标持续漂移。\n' },
      },
    ],
    // ⚠️ 显式声明「开局停在 feature」（风暴把你困在修复分支的叙事；
    //    headBranch main 目标因此开局不成立）。不提供时 sandbox 恒回 main。
    stayOnBranch: 'feature',
  },
  targets: [
    // feature 已并入 main（终态：修复工作流闭环；开局 feature 领先 main，不成立）
    { type: 'merged', branch: 'feature', into: 'main' },
    // 冲突真正被解决：信标是唯一权威版（中间态与损坏版都不过）
    { type: 'file', path: 'notes/信标坐标.md', exists: true, content: F1_BEACON_FINAL },
    // 历史只增不减：5 条预置 + feature修复 + 合并提交 = 7（开局 5，不成立）
    { type: 'commitCount', op: 'gte', value: 7 },
    // 修复完成后回到主线（开局在 feature，不成立）
    { type: 'headBranch', name: 'main' },
  ],
  winScore: 85,
  scoring: { ...SCORING },
  // 参考解法（编辑器动作不计）：在 feature 上写正确坐标 → add → commit（修复）
  // → checkout main → merge feature（冲突）→ 写最终坐标 → add → commit（完成合并）。
  // 命令数：add + commit + checkout + merge + add + commit = 6；
  // 预置已含「风暴仍未散去」与反向示范，历史延伸由合并提交承担。
  optimalMoves: 6,
  hints: [
    {
      text: '修复工作流四段：在当前分支上归档正确坐标 → 回 main → 合并 feature → 冲突由你裁决。历史不能变短 —— 抹掉记录的命令在这里意味着失败。',
      unlockAfterFailures: 0,
    },
    {
      text: '合并 feature 时信标必然冲突（两边都改过）。把冲突标记之间的内容改成最终坐标（纬度 47.20 / 经度 108.60），然后 git add notes/信标坐标.md，再 git commit 完成合并。',
      unlockAfterFailures: 1,
    },
    {
      text: '完整答案：编辑 notes/信标坐标.md（写回正确坐标）→ git add notes/信标坐标.md → git commit -m "修复信标坐标" → git checkout main → git merge feature → 编辑 notes/信标坐标.md（去掉冲突标记，写最终坐标）→ git add notes/信标坐标.md → git commit -m "合并 feature 并裁决信标坐标"',
      unlockAfterFailures: 3,
    },
  ],
};

/**
 * F-2 完整交付（★★★★★，自由）
 *
 * 剧本：管理局要交付第一个正式版本 —— 但这条时间线是全新的，一切从零开始。
 * 玩家走完「init → 亲手创建清单 → 归档提交 → 打注解标签 v1.0.0 →（可选）describe 验证」
 * 的完整流程。
 *
 * ── 空仓库模板下的判据锚点（M6 实测逼出的设计）─────────────────────────
 *
 * ⚠️ `git init` 幂等且 `reset()` 必然先建仓库，「init 创建仓库」无法用状态判定
 *    （引擎事实第 2 条）—— 判据全部锚定**流程末端**。
 * ⚠️ 开局不得即达标：`LevelInit.files` 预置的文件会让 `file exists` 开局即真，
 *    故本关**不预置任何文件** —— 交付清单由玩家在编辑器里亲手创建
 *    （内容照 GDD 交付物的固定文本），`file content` 才是「挣来的」结果。
 *    `commitCount gte 2` 与 `workdirClean` 开局（空仓库）也都不成立。
 */
const LEVEL_F_2: Level = {
  id: 'F-2',
  chapter: 'F',
  title: '完整交付',
  objective:
    '这条时间线从零开始 —— 档案库还没有建立，清单也还没写。走完完整的交付流程：建立仓库；在工作区新建「交付清单.md」，正文写「时间线管理局 · 交付清单：平行宇宙观测站 · 首个正式版本」；把它归档提交（提交信息写明「首版交付」）；最后用注解标签 v1.0.0 为这次交付命名，说明写「首个正式版本」。全部完成后，用 git describe 确认 Git 能说出现在是哪个版本。',
  difficulty: 5,
  inputMode: 'free',
  relatedKnowledge: ['git-basics#three-areas', 'git-tags#semver-release'],
  init: {
    // 空仓库：reset() 只建目录并 init，不预置任何提交、不预置任何文件 ——
    // 清单由玩家亲手创建（开局完全干净，「file / commitCount / workdirClean」皆开局不成立）
    template: 'emptyRepo',
  },
  targets: [
    // 流程末端锚点 1：交付清单已由玩家创建并完好保留（开局不存在）
    { type: 'file', path: '交付清单.md', exists: true, content: F2_MANIFEST },
    // 流程末端锚点 2：仓库里有至少 2 条提交（首次提交 + 一条后续归档 —— 完整流程不止一次快照）
    { type: 'commitCount', op: 'gte', value: 2 },
    // 流程末端锚点 3：注解标签 v1.0.0 已创建（开局不存在）
    { type: 'tag', name: 'v1.0.0', exists: true },
    // 流程末端锚点 4：工作区干净（创建的文件都已归档）
    { type: 'workdirClean', value: true },
  ],
  winScore: 85,
  scoring: { ...SCORING },
  // 参考解法（编辑器动作不计）：编辑器新建交付清单.md → add → commit（首版交付）
  // → 编辑器新建一条收尾记录 → add → commit → tag → describe。
  // ⚠️ commitCount gte 2 要求两次归档 —— 第二次的内容由玩家自拟（收尾记录），
  //    目标不锚定它的内容（教学意图是「流程完整」，不是「写什么」）。
  // 命令数：add + commit + add + commit + tag = 5
  optimalMoves: 5,
  hints: [
    { text: '档案库还没建立时，git init 是第一步（它已经被沙箱完成过一次，重复执行无害）。清单要你亲手写出来 —— 在工作区新建「交付清单.md」。', unlockAfterFailures: 0 },
    { text: '第一次归档：git add 交付清单.md 与 git commit -m "首版交付"；再补一条收尾归档（随意内容）让历史至少两条；命名：git tag -a v1.0.0 -m "首个正式版本"。', unlockAfterFailures: 1 },
    { text: '完整答案：新建「交付清单.md」（内容见目标）→ git add 交付清单.md → git commit -m "首版交付" → 新建任一收尾文件 → git add . → git commit -m "交付收尾" → git tag -a v1.0.0 -m "首个正式版本" → git describe（应输出 v1.0.0）', unlockAfterFailures: 3 },
  ],
};

/** 终章全部关卡，按关卡序号排列 */
export const FINAL_CHAPTER_LEVELS: readonly Level[] = [LEVEL_F_1, LEVEL_F_2];

/**
 * 第二章「日常秩序」关卡定义（GDD §4 第二章、development-refinement.md §8）。
 *
 * ┌──────┬──────────────┬──────────────────────────────┬───────────────────┬──────┐
 * │ 关卡 │ 名称         │ 目标                         │ 关联笔记          │ 难度 │
 * ├──────┼──────────────┼──────────────────────────────┼───────────────────┼──────┤
 * │ 2-1  │ 状态感知     │ status 看清处境并归档新内容  │ 基础操作·status   │ ★    │
 * │ 2-2  │ 记录变更     │ diff 查看改动并归档          │ 基础操作·diff     │ ★★   │
 * │ 2-3  │ 日志回溯     │ log 阅读历史并续写一环       │ 基础操作·log      │ ★★   │
 * │ 2-4  │ 移除与忽略   │ rm + .gitignore 管理文件     │ 基础操作·rm/ignore│ ★★   │
 * └──────┴──────────────┴──────────────────────────────┴───────────────────┴──────┘
 *
 * ─── 命令集与目标设计约束 ─────────────────────────────────────────────────
 *
 * - 命令集恒为 **status / diff / log / rm / .gitignore**（§8 已与 GDD 对齐；
 *   输入模式按用户裁定（M4 开工前确认）沿用 **拼接（menu）** —— GDD §3.2 写明
 *   第 1–2 章为命令拼接，细化文档 §8 表格的「半拼」视为笔误。
 * - ⚠️ **只读命令（status / diff / log）不可直接作目标**（M2 §5.2 架构性预警）：
 *   只读命令不改变仓库状态，没有任何可观测差异可供判定。本关目标一律锚定在
 *   「玩家用只读命令**前后必须做到的事**」（归档 / 清理），只读命令本身经
 *   probeBonus 给小额奖励 —— 这正是 M3 遗留的「probeBonus 首次真实生效」。
 * - 「开局不得即达标」的通用兜底见 levels.test.ts（2-1 的 untracked 预置 +
 *   2-4 的 rm 目标天然保证开局不达标；2-2/2-3 有 commitCount 门槛）。
 *
 * ─── relatedKnowledge 映射约定（沿用 ch1.ts 的两套规则）────────────────────
 *
 * GDD「关联」列与 `docs/notes/git-basic-operations.md` 的实际小节并非逐字对应，
 * 由 Lead 核定映射（levels.test.ts 的 SLUG_BY_HEADING 反查小节标题）：
 *
 * | 关卡 | GDD 关联           | 笔记实际小节    | id                                        |
 * |------|--------------------|-----------------|-------------------------------------------|
 * | 2-1  | 基础操作·status    | `### 查看状态`  | `git-basic-operations#status`             |
 * | 2-2  | 基础操作·diff      | `### 查看状态`  | `git-basic-operations#diff`               |
 * | 2-3  | 基础操作·log       | `### 查看历史`  | `git-basic-operations#log`                |
 * | 2-4  | 基础操作·rm/ignore | `### 删除文件` + `### 忽略文件` | `git-basic-operations#rm` + `git-basic-operations#ignore` |
 */

import type { Level } from '../../game/types';
import {
  DAILY_BASELINE,
  DAILY_PENDING,
  DIARY_DRAFT,
  LOG_PAGE_FIRST,
  LOG_PAGE_SECOND,
  LOG_PAGE_THIRD,
  NOISE_CACHE,
  SECRET_LOG,
} from '../presets';

/** 第二章计分参数（与 ch1 同基底；probeBonus 沿用 §7.3 的「小额」设定） */
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
 * 2-1 状态感知（★，拼接输入）
 *
 * 预置提交入库「基准」文件，再放一份未追踪的「待归档」文件。
 * 玩家的最优路径：status（看清处境）→ add . → commit。
 * 目标 = 归档新内容 + 工作区干净。status 本身不是目标（不可判定），
 * 但走它会给 probeBonus —— 「探查有奖」在这里首次真实生效。
 *
 * 参考解法 3 步：git status → git add . → git commit -m "…"（optimalMoves = 3）
 */
const LEVEL_2_1: Level = {
  id: 'ch2-1',
  chapter: 'ch2',
  title: '状态感知',
  objective: '日常巡测发现一段未归档的观测。看清它的处境，把它送入时间线，并让工作区恢复整洁。',
  difficulty: 1,
  inputMode: 'menu',
  relatedKnowledge: ['git-basic-operations#status'],
  init: {
    commits: [
      { author: '练习者', date: '第一天', msg: '基准状态', message: '基准状态', files: { 'baseline.md': DAILY_BASELINE } },
    ],
    files: { 'pending.md': DAILY_PENDING },
  },
  targets: [
    { type: 'commitCount', op: 'gte', value: 2 },
    { type: 'workdirClean', value: true },
  ],
  winScore: 60,
  scoring: { ...SCORING },
  optimalMoves: 3,
  hints: [
    { text: '未追踪的文件不会自己进入时间线 —— 先看状态，再决定怎么归档。', unlockAfterFailures: 0 },
    { text: 'git status 能告诉你哪些文件「未跟踪」。归档流程与第一章相同：暂存、提交。', unlockAfterFailures: 1 },
    { text: '完整答案：git status，然后 git add .，最后 git commit -m "归档待归档观测"', unlockAfterFailures: 3 },
  ],
};

/**
 * 2-2 记录变更（★★，拼接输入）
 *
 * 预置一份已入库的「日记草稿」，玩家必须**用文件编辑器**改写要点行（产生真实改动），
 * 再 diff 查看、暂存、提交。目标 = commitMessage 正则（提交信息需描述改动）+ 数量门槛。
 * 这是「没有新内容就没有新快照」之后的第一关：玩家第一次用编辑器制造改动。
 *
 * 参考解法 3 步：编辑文件 → git add diary.md → git commit -m "记录…"（optimalMoves = 3，
 * 编辑器操作不计入命令数 —— 只数终端命令）。
 */
const LEVEL_2_2: Level = {
  id: 'ch2-2',
  chapter: 'ch2',
  title: '记录变更',
  objective: '修复日记还停留在草稿状态。在文件树里打开日记、写下修复要点，再用 diff 确认改动，最后把它归档。提交信息要说明这次记录了什么。',
  difficulty: 2,
  inputMode: 'menu',
  relatedKnowledge: ['git-basic-operations#diff'],
  init: {
    commits: [
      // 提交信息刻意避开目标正则（记录/修复/日记）—— 否则开局即达标（实测缺陷）
      { author: '练习者', date: '第二天', msg: '素材入库', message: '素材入库', files: { 'diary.md': DIARY_DRAFT } },
    ],
  },
  targets: [
    // 提交信息需描述「记录/修复/日记」—— 用正则约束语义，不只数数量
    { type: 'commitMessage', match: /(记录|修复|日记)/ },
    { type: 'commitCount', op: 'gte', value: 2 },
  ],
  winScore: 60,
  scoring: { ...SCORING },
  optimalMoves: 3,
  hints: [
    { text: '改动必须先真实发生 —— 点开文件树里的 diary.md，写下要点再归档。', unlockAfterFailures: 0 },
    { text: 'git diff 能看到「改了什么」；git diff --staged 能看到「即将提交什么」。提交信息请描述改动内容。', unlockAfterFailures: 1 },
    { text: '完整答案：编辑 diary.md 后，git add diary.md，然后 git commit -m "记录修复要点"', unlockAfterFailures: 3 },
  ],
};

/**
 * 2-3 日志回溯（★★，拼接输入）
 *
 * 预置三次提交的「回溯档案」，玩家先 log 阅读历史（probeBonus 生效），
 * 再续写一环：改写最新页 + 归档。目标 = 新归档 + 数量门槛。
 *
 * 参考解法 3 步：git log → 编辑 third.md → git add . → git commit（编辑不计命令）
 * → 命令数 optimalMoves = 3（log + add + commit）。
 */
const LEVEL_2_3: Level = {
  id: 'ch2-3',
  chapter: 'ch2',
  title: '日志回溯',
  objective: '时间线的档案已排成三页，工作区里还有一份续写草稿。用 log 顺序读一遍历史，把草稿并入 third.md 末尾并归档，让链条继续延伸。',
  difficulty: 2,
  inputMode: 'menu',
  relatedKnowledge: ['git-basic-operations#log'],
  init: {
    commits: [
      // 提交信息刻意避开目标正则（续写/回溯/完成）—— 否则开局即达标
      { author: '练习者', date: '第三天', msg: '第一页入库', message: '第一页入库', files: { 'first.md': LOG_PAGE_FIRST } },
      { author: '练习者', date: '第三天', msg: '第二页入库', message: '第二页入库', files: { 'second.md': LOG_PAGE_SECOND } },
      { author: '练习者', date: '第三天', msg: '第三页入库', message: '第三页入库', files: { 'third.md': LOG_PAGE_THIRD } },
    ],
    // 续写材料未入库：玩家必须编辑 third.md 追加标记并归档（workdirClean 的判定素材）
    files: { 'draft.md': '续写草稿\n\n把这份草稿的内容并回 third.md 的末尾，然后归档。\n' },
  },
  targets: [
    { type: 'commitCount', op: 'gte', value: 4 },
    // 新提交应表达「续写/回溯/完成」的语义
    { type: 'commitMessage', match: /(续写|回溯|完成|第四)/ },
    { type: 'workdirClean', value: true },
  ],
  winScore: 60,
  scoring: { ...SCORING },
  optimalMoves: 3,
  hints: [
    { text: '历史按「最新在最上」排列。先读懂已有的三页，再续写第四段。', unlockAfterFailures: 0 },
    { text: '编辑 third.md 写下标记后，暂存并提交。commitMessage 会检查提交信息是否表达了「续写/回溯」。', unlockAfterFailures: 1 },
    { text: '完整答案：编辑 third.md 后，git add .，然后 git commit -m "续写回溯档案"', unlockAfterFailures: 3 },
  ],
};

/**
 * 2-4 移除与忽略（★★，拼接输入）
 *
 * 两个目标方向：rm 真删 secrets.log；用编辑器创建 .gitignore 声明忽略 cache.log。
 * 两个目标开局皆未达成（文件存在 / .gitignore 不存在），无「白送」风险。
 *
 * 参考解法 5 步：git rm secrets.log → git commit -m "…" → 编辑 .gitignore（不计）
 * → git add .gitignore → git commit -m "…"（optimalMoves = 5，与 1-4 同级）。
 */
const LEVEL_2_4: Level = {
  id: 'ch2-4',
  chapter: 'ch2',
  title: '移除与忽略',
  objective: '一段密钥残片混进了工作区，绝不能进入时间线：把它彻底移除并归档这次清理。另一段缓存噪声无害，但在工作区里碍事 —— 用 .gitignore 声明忽略它。',
  difficulty: 2,
  inputMode: 'menu',
  relatedKnowledge: ['git-basic-operations#rm', 'git-basic-operations#ignore'],
  init: {
    commits: [
      // 巡测记录与密钥残片入库（「密钥混进了时间线」的叙事前提，也是 git rm 的前提 ——
      // 引擎对齐真 git：untracked 文件不能 rm，探针 42 实测）。
      { author: '练习者', date: '第四天', msg: '巡测记录入库', message: '巡测记录入库', files: { 'notes.md': DAILY_BASELINE, 'secrets.log': SECRET_LOG } },
    ],
    // 缓存噪声**未入库**（untracked）：.gitignore 对未追踪文件生效（真 git 语义），
    // 玩家创建 .gitignore 后它即从 status 消失 —— 2-4 的核心教学点。
    // 该文件的存在同时保证开局不达标（workdirClean 为 false）。
    files: { 'cache.log': NOISE_CACHE },
  },
  targets: [
    // rm 真删：文件从工作区消失
    { type: 'file', path: 'secrets.log', exists: false },
    // .gitignore 存在且声明了 cache.log（内容精确匹配，玩家用编辑器创建）
    { type: 'file', path: '.gitignore', exists: true, content: 'cache.log\n' },
    // 清理动作要归档（预置已有 2 提交，门槛 3 起：任何一次玩家归档都算推进）
    { type: 'commitCount', op: 'gte', value: 3 },
    // 收尾工作区干净：.gitignore 已提交、cache.log 被忽略、secrets.log 已删
    { type: 'workdirClean', value: true },
  ],
  winScore: 60,
  scoring: { ...SCORING },
  optimalMoves: 5,
  hints: [
    { text: '两类「多余文件」的处置不同：混进时间线的要移除；未入库的噪声用 .gitignore 声明忽略。', unlockAfterFailures: 0 },
    { text: 'git rm secrets.log 会删文件并暂存删除（提交后才算完成清理）；.gitignore 是普通文件 —— 创建后记得 add 并提交。', unlockAfterFailures: 1 },
    { text: '完整答案：git rm secrets.log → git commit -m "移除密钥残片" → 新建 .gitignore（内容：cache.log）→ git add .gitignore → git commit -m "忽略缓存噪声"', unlockAfterFailures: 3 },
  ],
};

/** 第二章全部关卡（GDD §4 第二章：2-1 ~ 2-4） */
export const CHAPTER_2_LEVELS: Level[] = [LEVEL_2_1, LEVEL_2_2, LEVEL_2_3, LEVEL_2_4];

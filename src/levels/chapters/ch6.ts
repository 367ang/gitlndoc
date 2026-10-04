/**
 * 第六章「历史锚点」关卡定义（GDD §4 第六章、development-refinement.md §8）。
 *
 * ┌──────┬──────────────┬──────────────────────────────────┬───────────────────┬──────┐
 * │ 关卡 │ 名称         │ 目标                             │ 关联笔记          │ 难度 │
 * ├──────┼──────────────┼──────────────────────────────────┼───────────────────┼──────┤
 * │ 6-1  │ 轻量锚点     │ 创建 lightweight tag             │ 标签管理·轻量标签 │ ★★★  │
 * │ 6-2  │ 注解锚点     │ 创建 annotated tag               │ 标签管理·注解标签 │ ★★★  │
 * │ 6-3  │ 列出与查看   │ tag 列表与查看                   │ 标签管理·查看     │ ★★★  │
 * │ 6-4  │ 推送锚点     │ 推送标签到远程                   │ 标签管理·push tag │ ★★★★ │
 * │ 6-5  │ 版本发布     │ 用标签标记发布版本               │ 标签管理·语义化版本│ ★★★★│
 * └──────┴──────────────┴──────────────────────────────────┴───────────────────┴──────┘
 *
 * ─── 输入模式（GDD §3.2 的演进末段）────────────────────────────────────────
 *
 * 第六章 = **自由输入（free）**。GDD §3.2：「后期（第 5–7 章及终章）自由输入」，
 * 故本章关卡**不提供 `halfSkeleton`**，玩家在 Terminal 里自行输入完整命令。
 *
 * ─── 命令集与引擎依据（§8 第六章列了 show / describe）──────────────────────
 *
 * 五关的命令全部经 M6 新增的引擎能力落地（探针实测见 M6-tasks.md）：
 *   - `git tag <名>`：轻量标签（isomorphic-git 的 `git.tag`，只写 refs/tags/<名>）；
 *   - `git tag -a <名> -m <信息>`：注解标签（**必须走 `git.annotatedTag`** ——
 *     探针实测 isomorphic-git 的 `tag()` 忽略 message，传了也只产轻量标签，易踩坑）；
 *   - `git tag -d <名>`：删除；
 *   - `git show <标签>` / `git describe [--tags]`：查看与描述；
 *   - `git push origin <标签>`：推送标签（走既有 fileRemote 真协议，tag 对象完整落裸仓）。
 *
 * ─── 关卡设计的硬约束（沿用 M3/M4/M5a 的实测教训）───────────────────────────
 *
 * - **每个预置提交必须带 `files`**（M3 空提交防御）；
 * - **开局不得即达标**（`levels.test.ts` 的通用断言）；
 * - `init.tags[].at` 必须是本关 `init.commits` 里真实存在的提交信息
 *   （schema 跨字段校验 + `sandbox.reset` 的 seedTags 运行期 fail-fast 两道防线）。
 */

import type { Level } from '../../game/types';
import {
  TAG_ANNOTATE_BASE,
  TAG_LIGHT_NOTE,
  TAG_LIGHT_SECOND,
  TAG_LIST_FIRST,
  TAG_LIST_SECOND,
  TAG_LIST_THIRD,
  TAG_PUSH_LOCAL,
  TAG_RELEASE_FINAL,
} from '../presets';

/** 第六章计分参数（与第五、四章持平；本章的难点在「选对标签形态」而非命令数） */
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
 * 6-1 轻量锚点（★★★，自由）
 *
 * 剧本：两条已归档的观测需要一个「随时可回到的坐标」。
 * 教学点：`git tag <名>` = 轻量标签 —— 只是一个指向提交的名字，不带任何额外信息。
 *
 * 预置 2 个提交；目标是两个轻量标签都存在。
 * ⚠️ 判定用 `tag` 目标（M6 新实现），两个条件开局都不成立 —— 标签由玩家亲手创建。
 *
 * 参考解法 2 步：git tag v0.1 → git tag v0.2（各自打在当前 HEAD；两个提交本来就都在）。
 * 实际上两条标签都可打在 HEAD（第 2 条提交）或分别打在两个提交上 —— 判定只要求标签存在，
 * 打在哪条提交上都算理解了「锚点」的含义（不为了唯一解而误伤，§14）。
 */
const LEVEL_6_1: Level = {
  id: 'ch6-1',
  chapter: 'ch6',
  title: '轻量锚点',
  objective:
    '这条时间线上已有两份归档，它们需要一个名字 —— 一个随时可以回头的坐标。用**轻量标签**给这份历史锚定两个坐标：v0.1 与 v0.2。轻量标签只是一次命名，不需要附带任何说明。',
  difficulty: 3,
  inputMode: 'free',
  relatedKnowledge: ['git-tags#lightweight'],
  init: {
    commits: [
      {
        author: '练习者',
        date: '第二十三天',
        msg: '锚点观测一',
        message: '锚点观测一',
        files: { 'notes/锚点观测一.md': TAG_LIGHT_NOTE },
      },
      {
        author: '练习者',
        date: '第二十三天',
        msg: '锚点观测二',
        message: '锚点观测二',
        files: { 'notes/锚点观测二.md': TAG_LIGHT_SECOND },
      },
    ],
  },
  targets: [
    // 两个标签都必须由玩家亲手创建 —— 开局不存在，不存在「开局即达标」
    { type: 'tag', name: 'v0.1', exists: true },
    { type: 'tag', name: 'v0.2', exists: true },
  ],
  winScore: 60,
  scoring: { ...SCORING },
  // 参考解法 2 步：git tag v0.1 → git tag v0.2
  optimalMoves: 2,
  hints: [
    { text: '给历史命名不需要动任何文件 —— 有一种引用只是「一个名字指向某次快照」，创建它甚至不会产生新的记录。', unlockAfterFailures: 0 },
    { text: 'git tag <名称> 就是最简的锚点方式（轻量标签）。执行两次，分别锚定 v0.1 与 v0.2。', unlockAfterFailures: 1 },
    { text: '完整答案：git tag v0.1 → git tag v0.2（创建后 git tag 可列出全部锚点）', unlockAfterFailures: 3 },
  ],
};

/**
 * 6-2 注解锚点（★★★，自由）
 *
 * 剧本：一份档案通过了全部校验，要被**正式命名** —— 发布记录必须留说明。
 * 教学点：`git tag -a <名> -m <信息>` = 注解标签 —— 存成一个完整对象（含 tagger 与信息）。
 *
 * 预置 1 个提交；目标 = 注解标签 v1.0.0 存在。
 * ⚠️ 引擎事实：isomorphic-git 的 `git.tag()` 忽略 message（探针实测），
 *    注解标签走 `annotatedTag` —— 玩家用 `-a -m` 语法即可，引擎差异对玩家不可见。
 */
const LEVEL_6_2: Level = {
  id: 'ch6-2',
  chapter: 'ch6',
  title: '注解锚点',
  objective:
    '这份档案已通过全部校验，将被正式命名为 v1.0.0。但发布不只是命名 —— 还要留下**发布说明**，让后来的人知道这个坐标为什么重要。用**注解标签**完成它：锚点本身要承载一段说明。',
  difficulty: 3,
  inputMode: 'free',
  relatedKnowledge: ['git-tags#annotated'],
  init: {
    commits: [
      {
        author: '练习者',
        date: '第二十四天',
        msg: '版本档案通过校验',
        message: '版本档案通过校验',
        files: { 'notes/版本档案.md': TAG_ANNOTATE_BASE },
      },
    ],
  },
  targets: [
    // 注解标签存在（M6 的 tag 判定不区分注解/轻量 ——形态正确性由教学与提示承载，
    // 因为「标签是否注解」并不是 §4.3 的判定维度；玩家用 -a -m 是本关的教学重心）
    { type: 'tag', name: 'v1.0.0', exists: true },
  ],
  winScore: 60,
  scoring: { ...SCORING },
  // 参考解法 1 步：git tag -a v1.0.0 -m "版本 1.0.0 发布"
  optimalMoves: 1,
  hints: [
    { text: '轻量标签只是名字；要给锚点本身写说明，创建时需要额外两个部分：一个表示「带注解」的选项，和一段信息。', unlockAfterFailures: 0 },
    { text: 'git tag -a <名称> -m "<说明>" 创建注解标签。没有 -m 的注解会被拒绝 —— 说明是注解的一部分。', unlockAfterFailures: 1 },
    { text: '完整答案：git tag -a v1.0.0 -m "版本 1.0.0 发布"（之后 git show v1.0.0 可看到注解内容）', unlockAfterFailures: 3 },
  ],
};

/**
 * 6-3 列出与查看（★★★，自由）
 *
 * 剧本：三个标签已经预置在时间线上，玩家要先「读」它们（git tag 列表 + git show 注解），
 * 再「写」下一个（归档第四阶段巡检 + 打注解标签 v1.1.0）。
 * 教学点：`git tag` 列出全部；`git show <标签>` 查看注解内容与目标提交。
 *
 * ⚠️ 预置标签用 `init.tags`（M6 落地的预置能力）：三个注解标签分别锚定三次巡检提交。
 * ⚠️ 纯只读命令（tag/show）无法作为判据（引擎事实第 2 条：只读关卡的目标须锚定
 *    「玩家用该命令前后必须做到的事」）—— 故本关的推进判据是「归档第四阶段巡检 +
 *    创建 v1.1.0」，全部开局不成立；「查看」由叙事与提示承载（git show 的产出
 *    正是玩家回答「稳定期注解写了什么」的依据）。
 */
const LEVEL_6_3: Level = {
  id: 'ch6-3',
  chapter: 'ch6',
  title: '列出与查看',
  objective:
    '这条时间线的三个历史坐标上已经有人留下了注解锚点，但名单散落各处无人整理。先用 git tag 列出全部锚点，再用 git show v1.0.0 看看「稳定期」那次巡检的注解写了什么。然后归档第四阶段的巡检记录，并为它打上注解标签 v1.1.0（说明写「稳定期后的第一次巡检」）。',
  difficulty: 3,
  inputMode: 'free',
  relatedKnowledge: ['git-tags#list-show'],
  init: {
    // ⚠️ 未入库的第四阶段巡检 —— 让开局工作区不干净，归档它是玩家必须挣来的第一步
    files: { 'notes/巡检四.md': '巡检记录 · 第四阶段\n\n稳定期后的第一次巡检，等待归档与命名。\n' },
    commits: [
      {
        author: '练习者',
        date: '第二十五天',
        msg: '第一阶段巡检',
        message: '第一阶段巡检',
        files: { 'notes/巡检一.md': TAG_LIST_FIRST },
      },
      {
        author: '练习者',
        date: '第二十五天',
        msg: '第二阶段巡检',
        message: '第二阶段巡检',
        files: { 'notes/巡检二.md': TAG_LIST_SECOND },
      },
      {
        author: '练习者',
        date: '第二十五天',
        msg: '第三阶段巡检',
        message: '第三阶段巡检',
        files: { 'notes/巡检三.md': TAG_LIST_THIRD },
      },
    ],
    // ⚠️ 预置注解标签（M6 新能力）：`at` 指向预置提交的 message（逐字）
    tags: [
      { name: 'v0.9.0', at: '第一阶段巡检', message: '初始巡检基线' },
      { name: 'v0.9.5', at: '第二阶段巡检', message: '补上遗漏的观测' },
      { name: 'v1.0.0', at: '第三阶段巡检', message: '时间线进入稳定期' },
    ],
  },
  targets: [
    // 玩家必须亲手创建 v1.1.0（开局不存在 —— 本关的「动手」判据）
    { type: 'tag', name: 'v1.1.0', exists: true },
    // 第四阶段巡检已归档（预置 3 + 1 = 4）—— 开局不成立
    { type: 'commitCount', op: 'eq', value: 4 },
    // 巡检记录入库后自然达成 —— 开局不成立
    { type: 'workdirClean', value: true },
  ],
  winScore: 65,
  scoring: { ...SCORING },
  // 参考解法：git tag 与 git show 是探查（帮玩家读注解，不计命令数）；
  // add + commit + tag = 3
  optimalMoves: 3,
  hints: [
    { text: 'git tag 无参数列出全部锚点；git show <名称> 能看到某个锚点的注解与它指向的快照。先读懂历史，再续写它。', unlockAfterFailures: 0 },
    { text: '归档第四阶段巡检：git add . 与 git commit -m "…"；然后创建注解锚点：git tag -a v1.1.0 -m "稳定期后的第一次巡检"。', unlockAfterFailures: 1 },
    { text: '完整答案：git tag（列出）→ git show v1.0.0（查看稳定期注解）→ git add . → git commit -m "第四阶段巡检" → git tag -a v1.1.0 -m "稳定期后的第一次巡检"', unlockAfterFailures: 3 },
  ],
};

/**
 * 6-4 推送锚点（★★★★，自由）
 *
 * 剧本：分支同步早已完成，但版本还没定稿、锚点还没名字。玩家要完成
 * 「归档定稿 → 命名 v1.0.0 → 单独推送标签」三步 —— 标签不会搭分支的顺风车
 * （分支 push 不带标签），最后一步正是本关的教学点。
 * 教学点：`git push origin <标签名>` 单独推送标签。
 *
 * ── 开局状态（M6 实测逼出的设计）────────────────────────────────────
 *
 * ⚠️ 「标签真的到了远程」无法用 §4.3 的现有类型判定（`remote` 只判关联存在，
 *    没有「远程 ref 指向何处」的判据）—— 与 4-2 同款处理：判据锚定**本地推进项**
 *    （定稿已归档 + 标签已创建，开局皆不成立），推送结果由参考解法用例与冒烟脚本
 *    直接断言裸仓 `refs/tags`（真协议）。此判定缺口如实记录于 M6-tasks.md「设计缺口」。
 *
 * 参考解法 4 步：git add . → git commit → git tag -a v1.0.0 -m … → git push origin v1.0.0。
 */
const LEVEL_6_4: Level = {
  id: 'ch6-4',
  chapter: 'ch6',
  title: '推送锚点',
  objective:
    '航道早已打通，远程宇宙的历史也与你一致 —— 但这次的版本定稿还在工作区里，名字也还没定。把定稿归档进主线，用注解标签 v1.0.0（说明写「版本 1.0.0 发布」）为它命名，最后把这份锚点单独推送到远程 —— 标签不会搭分支的顺风车。',
  difficulty: 4,
  inputMode: 'free',
  relatedKnowledge: ['git-tags#push-tag'],
  init: {
    // ⚠️ 未追踪的定稿记录 —— 归档它是玩家必须挣来的第一步（开局工作区不干净）
    files: { 'notes/版本记录.md': '版本 1.0.0\n\n本地锚点已就位。\n' },
    commits: [
      {
        author: '练习者',
        date: '第二十六天',
        msg: '同步基线观测',
        message: '同步基线观测',
        files: { 'notes/同步基线.md': TAG_PUSH_LOCAL },
      },
    ],
    // 远程宇宙与本地 main 完全同步（分支层面无事可做 —— 唯一要补的是定稿与标签）
    remotes: [
      {
        name: 'origin',
        url: 'http://sandbox/remote.git',
        branches: [{ branch: 'main', at: '同步基线观测' }],
      },
    ],
  },
  targets: [
    // 推进项 1：定稿已归档（开局不成立 —— 文件还没入库）
    { type: 'commitExists', message: '版本 1.0.0 定稿' },
    // 推进项 2：注解标签已创建（开局不成立 —— 标签由玩家亲手打）
    { type: 'tag', name: 'v1.0.0', exists: true },
    // 防改写：本地历史恰好 2 条（基线 + 定稿）
    { type: 'commitCount', op: 'eq', value: 2 },
  ],
  winScore: 70,
  scoring: { ...SCORING },
  // 参考解法 4 步：git add . → git commit → git tag -a v1.0.0 -m "版本 1.0.0 发布" → git push origin v1.0.0
  optimalMoves: 4,
  hints: [
    { text: '三件事按顺序：先把定稿归档进历史，再给它起名字（注解标签），最后把名字送出去 —— 标签的推送与分支无关，要单独推。', unlockAfterFailures: 0 },
    { text: '归档：git add . 与 git commit -m "版本 1.0.0 定稿"；命名：git tag -a v1.0.0 -m "版本 1.0.0 发布"；推送：git push origin v1.0.0。', unlockAfterFailures: 1 },
    { text: '完整答案：git add . → git commit -m "版本 1.0.0 定稿" → git tag -a v1.0.0 -m "版本 1.0.0 发布" → git push origin v1.0.0', unlockAfterFailures: 3 },
  ],
};

/**
 * 6-5 版本发布（★★★★，自由）
 *
 * 剧本：完整发布流程的最后一公里 —— 合并归位、档案收尾、命名发布。
 * 教学点：语义化版本（v主.次.修）+ 用标签标记发布 + git describe 的「版本号从哪来」。
 *
 * 预置：一条 feature 分支上的工作已合入 main（预置两条提交 + 合并提交），预置注解标签
 * v1.0.0 在合并提交**之前**的基线上。玩家的收尾动作：归档收尾档案 + 打注解标签 v1.1.0。
 * 判定：新标签存在 + 提交数到 4（收尾档案已归档）+ 提交数判据同时防绕过。
 */
const LEVEL_6_5: Level = {
  id: 'ch6-5',
  chapter: 'ch6',
  title: '版本发布',
  objective:
    '发布日到了。收尾档案还躺在工作区里没有归档 —— 把它归档进主线，然后为这条时间线命名新的版本：用注解标签 v1.1.0 锚定**最新一次快照**，说明写「新增导出能力」。写完用 git describe 看看 Git 怎么描述此刻的位置。',
  difficulty: 4,
  inputMode: 'free',
  relatedKnowledge: ['git-tags#semver-release'],
  init: {
    // ⚠️ 未入库的收尾档案 —— 让开局工作区不干净，归档它是玩家必须挣来的第一步
    files: { 'notes/发布收尾.md': TAG_RELEASE_FINAL },
    commits: [
      {
        author: '练习者',
        date: '第二十七天',
        msg: '版本 1.0.0 基线',
        message: '版本 1.0.0 基线',
        files: { 'notes/基线.md': '版本 1.0.0 基线\n' },
      },
      {
        author: '练习者',
        date: '第二十七天',
        msg: '新增导出能力',
        message: '新增导出能力',
        files: { 'notes/导出.md': '导出模块\n\n支持把档案导出为外部格式。\n' },
      },
    ],
    // 上一版的锚点（注解）在基线上 —— describe 会给出 v1.0.0-1-gxxxx 形态的「未命名」描述，
    // 直到玩家把 v1.1.0 打上，describe 才返回干净的 v1.1.0
    tags: [{ name: 'v1.0.0', at: '版本 1.0.0 基线', message: '版本 1.0.0 发布' }],
  },
  targets: [
    // 新版本锚点已创建（开局不存在）
    { type: 'tag', name: 'v1.1.0', exists: true },
    // 收尾档案已归档：2 条预置 + 1 条归档 = 3
    { type: 'commitCount', op: 'eq', value: 3 },
    // 工作区干净（收尾档案入库后自然达成）
    { type: 'workdirClean', value: true },
  ],
  winScore: 75,
  scoring: { ...SCORING },
  // 参考解法 2 步：git add . → git commit → git tag -a v1.1.0 -m "新增导出能力"
  // （git describe 是探查，不计；编辑器也不计）—— add+commit+tag = 3
  optimalMoves: 3,
  hints: [
    { text: '发布 = 归档收尾 + 命名新版本。先把工作区里那份收尾档案走完归档流程，再创建注解锚点。', unlockAfterFailures: 0 },
    { text: '归档：git add . 与 git commit -m "…"；命名：git tag -a v1.1.0 -m "新增导出能力"。v1.1.0 会锚定在最新那次快照上。', unlockAfterFailures: 1 },
    { text: '完整答案：git add . → git commit -m "发布收尾" → git tag -a v1.1.0 -m "新增导出能力" → git describe（应输出 v1.1.0）', unlockAfterFailures: 3 },
  ],
};

/** 第六章全部关卡，按关卡序号排列 */
export const CHAPTER_6_LEVELS: readonly Level[] = [
  LEVEL_6_1,
  LEVEL_6_2,
  LEVEL_6_3,
  LEVEL_6_4,
  LEVEL_6_5,
];

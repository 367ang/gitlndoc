/**
 * 第一章「创世纪元」关卡定义（GDD §4 第一章、development-refinement.md §8）。
 *
 * ┌──────┬──────────────┬────────────────────────────┬────────────┬──────┐
 * │ 关卡 │ 名称         │ 目标                       │ 关联笔记   │ 难度 │
 * ├──────┼──────────────┼────────────────────────────┼────────────┼──────┤
 * │ 1-1  │ 时间线初始化 │ 建立档案库并纳入第一份内容 │ 基础概念·仓库   │ ★   │
 * │ 1-2  │ 第一次快照   │ add + commit 生成首个提交  │ 基础概念·快照   │ ★   │
 * │ 1-3  │ 三态之谜     │ 理解工作区/暂存区/仓库三态 │ 基础概念·三态   │ ★★  │
 * │ 1-4  │ 历史之链     │ 识别提交对象与父提交关系   │ 基础概念·对象模型 │ ★★ │
 * └──────┴──────────────┴────────────────────────────┴────────────┴──────┘
 *
 * ─── `relatedKnowledge` 映射约定（**后续章节沿用同一约定**）──────────────
 *
 * id 格式固定为 `<笔记文件名去掉 .md>#<小节 slug>`，即 `git-basics#local-repository`。
 * slug 由 `notes/*.md` 中的**实际小节标题**转写：小写、空格与标点转为连字符。
 * 只使用笔记里**真实存在**的小节，不臆造 id（`levels.test.ts` 会反查笔记文件断言其存在）。
 *
 * GDD「关联」列写的是「基础概念·仓库 / 快照 / 三态 / 对象模型」，与 `notes/git-basics.md`
 * 的实际小节名**并非逐字对应**（笔记里没有「快照」「三态」这样的小节），
 * 故由 Lead 核定下列一一映射，本文件照此填写：
 *
 * | 关卡 | GDD 关联            | 笔记实际小节              | id                              |
 * |------|---------------------|---------------------------|---------------------------------|
 * | 1-1  | 基础概念·仓库       | `### 本地仓库 (Local Repository)` | `git-basics#local-repository`   |
 * | 1-2  | 基础概念·快照/提交  | `## 工作流程图解`         | `git-basics#workflow`           |
 * | 1-3  | 基础概念·三态       | `## 三大核心区域` + `## 为什么要有暂存区？` | `git-basics#three-areas` + `git-basics#why-staging` |
 * | 1-4  | 基础概念·对象模型   | `## 对象模型`             | `git-basics#object-model`       |
 *
 * ─── 命令集与 init 限制 ─────────────────────────────────────────────────
 *
 * - 第一章命令集恒为 **`init` / `add` / `commit`**（§8 已按 GDD 订正；`status`/`log` 属第二章）。
 *   目标条件据此编写，只用 M2 已实现的 5 种 `TargetCondition`。
 * - `init` **不得使用** `branches` / `tags` / `remotes` / `template: 'cloneSource'` ——
 *   `sandbox.reset()` 对这些字段 fail-fast 报错（M1 刻意不伪造，属 M4/M5）。
 *   `schema.ts` 在校验期即拦截，不必等玩家进关才炸。
 * - ⚠️ **不要用 `.git` 的存在性作目标**：`sandbox.reset()` 内部**总是**会调
 *   `gitApi.init()`，故进入任何关卡时 `.git` 都已存在，这种目标会「开局即达标」。
 *   1-1 最初正是这样写的，实测后改为 `commitCount` + `workdirClean`（见其定义处注释）。
 * - `optimalMoves`（M3 引入）：取参考解法的**成功命令数**（§7.3 optimalBonus 的判据
 *   为「与参考一致或更短」）。失败重试不计入 —— 只数最终走通的那条路径。
 *   各关参考解法与步数核定见各关卡定义处注释。
 */

import type { Level } from '../../game/types';
import { CHAIN_START, OBSERVATION_LOG, THREE_STATES_NOTE, TIMELINE_FRAGMENT } from '../presets';

/**
 * 第一章计分参数占位。
 *
 * ⚠️ M2 只做过关判定，**计分与星级属 M3**（§13）。此处填合理默认值使字段齐备，
 * 避免关卡数据缺字段（`schema.ts` 会校验齐备性）。数值取自 §7 的设定方向：
 * 撤销重罚、提示轻罚、一次通过有奖励。
 */
const SCORING_PLACEHOLDER = {
  baseScore: 100,
  undoPenalty: 15,
  redoPenalty: 10,
  hintPenalty: 5,
  optimalBonus: 20,
  flawlessBonus: 25,
  probeBonus: 2,
} as const;

/**
 * 1-1 时间线初始化 —— 建立档案库并把「档案封面」纳入其中（★，拼接输入）
 *
 * ⚠️ **本关的目标设计经过实测修正，原因值得记录**：
 * `sandbox.reset()` 内部**总是**会调 `gitApi.init()`（见 `engine/sandbox.ts`），
 * 因此进入任何关卡时 `.git` 目录**已经存在**。最初把 1-1 的目标写成
 * `{ type: 'file', path: '.git', exists: true }`，实测发现**开局即达标** ——
 * 玩家一条命令都不用敲就「过关」，这属彻头彻尾的伪判定（§14 禁止伪造）。
 *
 * 修正思路：`.git` 的存在与否不可用，而**「仓库里有没有归档物」是可观测的** ——
 * `commitCount` 与 `workdirClean` 都只依赖真实仓库状态。故本关用这两者判定：
 * 预置一份「档案封面」文件，玩家必须把它真正归档，工作区才会重新变干净。
 * 这样目标与「初始化时间线」的叙事仍然吻合，且全部落在 M2 已实现的 5 种类型内
 * （不需要为它新增 TargetCondition 类型）。
 */
const LEVEL_1_1: Level = {
  id: 'ch1-1',
  chapter: 'ch1',
  title: '时间线初始化',
  objective: '时间线失去了档案库，碎片散落在工作区。建立档案库，并把「档案封面」正式纳入其中。',
  difficulty: 1,
  inputMode: 'menu',
  relatedKnowledge: ['git-basics#local-repository'],
  // 预置文件使工作区起手处于「未归档」状态，玩家必须真正归档才能让工作区重新干净
  init: {
    files: {
      'README.md': TIMELINE_FRAGMENT,
    },
  },
  targets: [
    // 仓库中出现了第一个归档物 —— 时间线重新具备记录能力
    { type: 'commitCount', op: 'gte', value: 1 },
    // 归档后工作区无遗留 —— 碎片被完整收拢，而不是散落在外面
    { type: 'workdirClean', value: true },
  ],
  winScore: 60,
  scoring: { ...SCORING_PLACEHOLDER },
  // 参考解法：git init → git add . → git commit -m "初始化时间线"（3 步）
  optimalMoves: 3,
  hints: [
    {
      text: '档案库（本地仓库）需要被显式建立，它不是自动出现的。',
      unlockAfterFailures: 0,
    },
    {
      text: '建立档案库用 git init；但仅建立还不够 —— 工作区里的碎片要真正被归档，时间线才算恢复。',
      unlockAfterFailures: 1,
    },
    {
      text: '完整答案：git init，然后 git add .，最后 git commit -m "初始化时间线"',
      unlockAfterFailures: 3,
    },
  ],
};

/**
 * 1-2 第一次快照 —— `add` + `commit` 生成首个提交（★，拼接输入）
 *
 * ⚠️ **`workdirClean` 在本关是「教学闸门」，不是装饰性条件 —— 请勿在后续里程碑「优化」掉它。**
 *
 * 实测结论（Lead 独立探针复现，防止后人误删）：若本关只有 `commitCount` + `commitMessage`，
 * 玩家**完全不执行 `add`**、直接 `git commit -m "第一次快照"` 就能过关 ——
 * 因为引擎会无条件提交当前索引，空索引也照提。于是「必须先暂存」这一本关唯一的教学点
 * 被整条绕过，关卡形同虚设。
 *
 * 加上 `workdirClean` 后，该作弊路径的判定为：
 *   `[✓] commitCount` · `[✓] commitMessage` · `[✗] workdirClean`
 *   （detail：「工作区里还有未归档的内容：notes/observation.md」）
 * 玩家必须真正把改动送入暂存区并归档，工作区才会重新变干净。
 * 这正是 §7「奖励理解、惩罚试错」的落点：**用状态判定逼出正确的心智模型**，
 * 而不是靠提示文案劝阻。
 */
const LEVEL_1_2: Level = {
  id: 'ch1-2',
  chapter: 'ch1',
  title: '第一次快照',
  objective: '工作区里躺着一份观测记录。把它归档成时间线的第一个快照。',
  difficulty: 1,
  inputMode: 'menu',
  relatedKnowledge: ['git-basics#workflow'],
  // 带 files 的 reset 之后文件处于「已修改、未归档」状态，正是本关要玩家处理的对象
  init: {
    files: {
      'notes/observation.md': OBSERVATION_LOG,
    },
  },
  targets: [
    { type: 'commitCount', op: 'gte', value: 1 },
    { type: 'commitMessage', match: /快照/ },
    // 教学闸门：拦住「跳过 add 直接 commit」的路径 —— 详见上方注释，勿删
    { type: 'workdirClean', value: true },
  ],
  winScore: 70,
  scoring: { ...SCORING_PLACEHOLDER },
  // 参考解法：git add . → git commit -m "第一次快照"（2 步）
  optimalMoves: 2,
  hints: [
    {
      text: '一份内容要先被「选中」，才有资格进入档案库，这一步和归档本身是分开的。',
      unlockAfterFailures: 0,
    },
    {
      text: '两段式：先用 git add 把改动送入暂存区，再用 git commit 把它固化为快照。',
      unlockAfterFailures: 1,
    },
    {
      text: '提交信息里应包含「快照」，例如：git add . 然后 git commit -m "第一次快照"',
      unlockAfterFailures: 3,
    },
  ],
};

/**
 * 1-3 三态之谜 —— 走完 工作区 → 暂存区 → 仓库 三段（★★，拼接输入）
 *
 * ⚠️ 本关**刻意不含 `file` content 目标**（最初写过，已移除）。
 * 原因：预置文件一写入工作区，其内容就与预期一致，`file` 目标在**开局即达标**。
 * 于是 GoalPanel 进关就显示一条勾 —— 而它既不是玩家挣来的，也不可能被玩家「达成」，
 * 只是「内容不许被改坏」的守卫。对一关专门教「三态流转」的关卡来说，这条静态勾
 * 会让玩家误以为「已经做到一项了」，反而模糊了真正的进度。
 *
 * 现有两条目标恰好各对应一段流转，且**开局全为未达成**（实测）：
 *   - `commitCount` —— 内容进入第三态（本地仓库）才有快照；
 *   - `workdirClean` —— 内容既不能在第二态滞留，也不能在第一态悬空。
 * 「先进暂存区」这一中间步骤由 `workdirClean` 在 `git add` 后仍报未达成来体现
 * （实测：add 之后 `workdirClean` 为 false，因为暂存内容尚未归档）。
 */
const LEVEL_1_3: Level = {
  id: 'ch1-3',
  chapter: 'ch1',
  title: '三态之谜',
  objective:
    '同一份内容在时间线里有三种身份：工作区、暂存区、本地仓库。让这份三态笔记完整走完三段。',
  difficulty: 2,
  inputMode: 'menu',
  // 两处映射：三态的整体框架 + 暂存区为何存在，恰是本关要玩家体会的两件事
  relatedKnowledge: ['git-basics#three-areas', 'git-basics#why-staging'],
  init: {
    files: {
      'notes/three-states.md': THREE_STATES_NOTE,
    },
  },
  targets: [
    // 内容抵达第三态：已被归档为快照
    { type: 'commitCount', op: 'gte', value: 1 },
    // 终态必须落在第三段：内容既不在工作区悬空，也不滞留在暂存区
    { type: 'workdirClean', value: true },
  ],
  winScore: 80,
  scoring: { ...SCORING_PLACEHOLDER },
  // 参考解法：git add . → git commit -m "归档三态笔记"（2 步）
  optimalMoves: 2,
  hints: [
    {
      text: '内容目前停在第一态（工作区）。它需要被明确地「选中」，才会进入第二态。',
      unlockAfterFailures: 0,
    },
    {
      text: '停留在第二态（暂存区）并不算完成 —— 只有归档之后，内容才成为历史的一部分。',
      unlockAfterFailures: 1,
    },
    {
      text: '依次执行：git add . 然后 git commit -m "归档三态笔记"',
      unlockAfterFailures: 3,
    },
  ],
};

/**
 * 1-4 历史之链 —— 连续归档形成带父提交的历史链（★★，拼接输入）
 *
 * ⚠️ **已知引擎保真缺陷（M2 不修，本关因此可被绕过）**
 *
 * 实测（Lead 独立探针，对照真 git 二进制）：`gitApi.commit()` **无条件提交当前索引**，
 * 不检查索引是否已与 HEAD 相同，因此本引擎允许真 git 会拒绝的**空提交**：
 *
 * | 场景 | 真 git | 本项目引擎 |
 * |---|---|---|
 * | 干净工作区 → `add .` → `commit` | exit 1「nothing to commit」，不产生提交 | **产生**第 2 个提交 |
 * | 空仓库 → 直接 `commit` | exit 1，不产生提交 | **产生**空提交 |
 *
 * 对本关的影响：玩家**不按提示改写工作区**，直接重复 `add .` + `commit -m "第二环"`
 * 也能过关（实测 `satisfied: true`）。也就是说本关的教学点——
 * 「没有新内容就没有新快照」——目前**可被绕过**。
 *
 * 处置：M2 采取「保留关卡 + 强化提示文案」，不擅自动 `engine/`（超出 M2 范围，
 * 且会影响 M1 已通过的 executor 测试）。根治需让 `gitApi.commit()` 在
 * 「索引与 HEAD 无差异」时返回错误（真 git 的 `nothing to commit` 语义），
 * 属后续里程碑的独立修复项。**在那之前，请勿把本关的提示文案当作强约束。**
 */
const LEVEL_1_4: Level = {
  id: 'ch1-4',
  chapter: 'ch1',
  title: '历史之链',
  objective:
    '一份快照只是孤立的时间点，两次以上才会形成链条：后一个快照会指向前一个。把这条链建立起来。',
  difficulty: 2,
  inputMode: 'menu',
  relatedKnowledge: ['git-basics#object-model'],
  init: {
    files: {
      'notes/timeline-log.md': CHAIN_START,
    },
  },
  targets: [
    // 至少两个提交，才谈得上「父提交关系」
    { type: 'commitCount', op: 'gte', value: 2 },
    // 链条的两环各自有据可查（message 取首行，与 sandbox 写入的提交信息一致）
    { type: 'commitExists', message: '第一环' },
    { type: 'commitExists', message: '第二环' },
    { type: 'workdirClean', value: true },
  ],
  winScore: 90,
  scoring: { ...SCORING_PLACEHOLDER },
  // 参考解法：git add . → commit 第一环 → 改文件 → git add . → commit 第二环（5 步）
  optimalMoves: 5,
  hints: [
    {
      text: '一个孤立的时间点构不成历史。要让链条出现，至少需要两次归档。',
      unlockAfterFailures: 0,
    },
    {
      // 措辞已按实测结论强化：明确点出「先产生新改动」这一步，以及它的原因。
      // 注意引擎允许空提交（见上方「已知引擎保真缺陷」），故这是引导而非强制。
      text: '第二次归档之前，必须先让工作区**产生新的改动**（例如往 notes/timeline-log.md 里追加一句话）——因为没有新内容就没有新快照，链条也就无从延长。',
      unlockAfterFailures: 1,
    },
    {
      text: '两次归档的信息中应分别包含「第一环」与「第二环」，例如：git add . 与 git commit -m "第一环" 重复两轮。',
      unlockAfterFailures: 3,
    },
  ],
};

/** 第一章全部关卡，**按关卡序号升序**排列（UI 直接顺序渲染，不依赖对象字面量顺序） */
export const CHAPTER_1_LEVELS: readonly Level[] = [LEVEL_1_1, LEVEL_1_2, LEVEL_1_3, LEVEL_1_4];

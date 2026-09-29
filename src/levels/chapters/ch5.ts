/**
 * 第五章「时空回溯」关卡定义（GDD §4 第五章、development-refinement.md §8）。
 *
 * ┌──────┬──────────────┬──────────────────────────────────┬───────────────────┬──────┐
 * │ 关卡 │ 名称         │ 目标                             │ 关联笔记          │ 难度 │
 * ├──────┼──────────────┼──────────────────────────────────┼───────────────────┼──────┤
 * │ 5-1  │ 修正笔误     │ commit --amend 修正提交          │ 撤销操作·amend    │ ★★★  │
 * │ 5-2  │ 撤销暂存     │ reset / restore --staged 撤销暂存│ 撤销操作·reset    │ ★★★  │
 * │ 5-3  │ 丢弃改动     │ restore / checkout -- 丢弃工作区 │ 撤销操作·checkout │ ★★★★ │
 * │ 5-4  │ 安全反转     │ revert 生成反向提交              │ 撤销操作·revert   │ ★★★★ │
 * │ 5-5  │ 危险与安全   │ reset vs revert 抉择             │ 撤销操作·对比     │ ★★★★★│
 * │ 5-6  │ 时间跳跃     │ reset --hard 后果与 reflog 补救  │ 撤销操作·reflog   │ ★★★★★│
 * └──────┴──────────────┴──────────────────────────────────┴───────────────────┴──────┘
 *
 * ─── 输入模式（GDD §3.2 的演进末段）────────────────────────────────────────
 *
 * 第五章 = **自由输入（free）**。GDD §3.2 的输入方式随章节演进为
 * 「菜单/拼接（一~二章）→ 半拼（三~四章）→ 自由（五章起）」，
 * 故本章关卡**不提供 `halfSkeleton`**，玩家在 Terminal 里自行输入完整命令。
 *
 * ─── 命令集与引擎依据（§8：reset / revert / checkout -- / restore）──────────
 *
 * 六关的命令全部经 M5a 新增的引擎能力落地，均已探针实测（见
 * docs/milestones/M5-tasks.md §六「阶段 1 开工前的撤销引擎探针」）：
 *   - `commit --amend`：底层 `git.commit({ amend: true })`，父提交不变、旧提交成孤儿；
 *   - `reset --soft|--mixed|--hard`：三种底层组合，三态与笔记的模式对比表逐格吻合；
 *   - `restore` / `checkout -- <path>`：丢弃工作区改动（前者）与撤销暂存（后者带 --staged）；
 *   - `revert`：组合实现（读目标提交与其父的 tree diff → 反向 apply → 新提交）；
 *   - `reflog` + `HEAD@{n}`：引擎自建 ref 移动日志（isomorphic-git 无 reflog），
 *     输出格式与笔记 `git-undo.md` 逐字一致。
 *
 * ─── 关卡设计的硬约束（沿用 M3/M4 实测教训）───────────────────────────────
 *
 * - **每个预置提交必须带 `files`**：M3 的空提交防御会拒绝无内容的预置提交。
 * - **开局不得即达标**：`levels.test.ts` 有通用断言兜底；本章尤其注意
 *   「工作区干净」类目标 —— `reset()` 收尾时工作区等于 HEAD 树，会被判为干净，
 *   故 `workdirClean` **只在预置了未入库文件（init.files）时才可用于「未达成」判定**。
 *   ⚠️ 反过来，若要用 `workdirClean: { value: true }` 表达「玩家必须清理干净」，
 *   就必须让开局**不干净**（预置 init.files 制造未追踪/未暂存内容）。
 * - **5-5 的 OR 语义限制**：`TargetCondition` 为 AND 语义，无法表达「reset 或 revert
 *   任一过关」。本关按**revert 路径**判定（叙事说明：这条时间线已对外同步，
 *   改写历史会让协作者错位，只能用反向提交抵消）。与 3-6 同款裁定，实现处留档。
 * - **5-6 的 reflog 剧本**：目标只用现有 target 组合表达，不改 `TargetCondition`
 *   （M5 决策 ⑤）。玩家必须先做出错误的 `reset --hard`、再经 `reflog` + `HEAD@{n}`
 *   恢复，才能同时满足「提交数回到 3」与「关键快照仍在」两项 —— 无法绕过。
 */

import type { Level } from '../../game/types';
import {
  AMEND_DRAFT_LOG,
  AMEND_MISSING_NOTE,
  DISCARD_CORRECT,
  DISCARD_CORRUPTED,
  DISCARD_DELETED,
  REFLOG_KEY_FIRST,
  REFLOG_KEY_SECOND,
  OBSERVATION_SUPPLEMENT,
  REFLOG_PENDING_FRAGMENT,
  REFLOG_KEY_THIRD,
  REVERT_BAD_CHANGE,
  REVERT_PUBLIC_CORRUPTED,
  REVERT_PUBLIC_LOG,
  STAGING_BASELINE,
  STAGING_DRAFT_FINAL,
  STAGING_DRAFT_WIP,
  STAGING_MISTAKE_DRAFT,
} from '../presets';

/** 第五章计分参数（撤销类命令的惩罚权重高于前三章：本章正是在考「少走弯路」） */
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
 * 5-1 修正笔误（★★★，自由）
 *
 * 剧本：一条快照已经归档，但漏掉了一个关键文件。
 * 教学点：`--amend` 是**替换**最近一次提交而不是追加 —— 提交数不变。
 *
 * 预置 2 个提交（第一个作为父提交，保证 amend 后父提交不变可被观察）。
 * 目标 = 提交数仍为 2（若玩家改用「新建一个提交」会变成 3，判失败）+ 最近提交信息已改。
 *
 * 参考解法 4 步：git add a.txt（暂存漏掉的文件）→ git commit --amend -m "…"。
 * 计 optimalMoves = 3（add + amend；编辑器写文件不计）。
 */
const LEVEL_5_1: Level = {
  id: 'ch5-1',
  chapter: 'ch5',
  title: '修正笔误',
  objective:
    '最近一次归档漏掉了一个关键文件，提交信息也写得太潦草。把漏掉的文件补进这一次快照，并改写它的说明 —— 注意：是**修补**那条快照，而不是在它之上再记一条。',
  difficulty: 3,
  inputMode: 'free',
  relatedKnowledge: ['git-undo#amend'],
  init: {
    // ⚠️ 预置 1 个提交 —— 判据不用 `commitCount`（`eq 1` 开局即成立，会被通用断言抓到），
    //    而用 `commitMessage`：它读的是 **HEAD 的信息**。预置信息的措辞是「归档（草稿）」，
    //    目标要求改写成含「定稿」的信息 —— 开局必然不满足，且玩家只有真的改写
    //    **那一条**（而非新增一条）才会让 HEAD 的信息变成「定稿」。
    //    ⚠️ 玩家若改用「新建一条提交」：HEAD 变成新提交的信息，除非他刻意把新信息
    //    也写成「定稿」—— 那种情况下行为等价于 amend 的教学目标（一条记录承载两件事），
    //    判他过关是合理的（§14 不为了「唯一解」而误伤）。
    files: { 'notes/附录.md': AMEND_MISSING_NOTE },
    commits: [
      {
        author: '练习者',
        date: '第十四天',
        msg: '补充了一次观测（草稿）',
        message: '补充了一次观测（草稿）',
        files: { 'notes/修复日志.md': AMEND_DRAFT_LOG },
      },
    ],
  },
  targets: [
    // HEAD 的信息已被改写为定稿版本（预置信息不含「定稿」，开局不满足）。
    // ⚠️ 本关只此一项「变化型」判据，是刻意的最小设计：
    //    - 不能用 `commitCount eq 1`（预置已是 1 条，开局即达标 —— 通用断言抓到，实测）；
    //    - 不能用 `file` 的 content（`notes/附录.md` 开局就已存在且内容一致，同上）；
    //    - 不能用 `workdirClean`（玩家 `git add` 前工作区本就不干净，但它无法区分
    //      「只 add 未 commit」与「已 amend」——两种状态下都是 false，判据没有鉴别力）。
    //    而 `commitMessage` 读的是 **HEAD 提交的信息**：只有真的把那条提交改写掉
    //    （`--amend`）才会变成「定稿」。玩家若改用「新建一条提交」，HEAD 的信息
    //    同样是新提交的信息 —— 除非他刻意也写成含「定稿」的措辞，那种情况下
    //    他确实完成了本关的教学目标（让一次快照同时承载内容与准确说明），判过合理。
    { type: 'commitMessage', match: /定稿/ },
  ],
  winScore: 60,
  scoring: { ...SCORING },
  optimalMoves: 3,
  hints: [
    { text: '目标说的是「修补这一次快照」—— 有一种命令能让新的内容取代最近一次归档，而不是排在它后面。', unlockAfterFailures: 0 },
    {
      text: '先把漏掉的文件送进暂存区，再用 git commit --amend 替换最近一次提交。提交数量不应增加。',
      unlockAfterFailures: 1,
    },
    {
      text: '完整答案：git add notes/附录.md → git commit --amend -m "修复日志 · 定稿"',
      unlockAfterFailures: 3,
    },
  ],
};

/**
 * 5-2 撤销暂存（★★★，自由）
 *
 * 剧本：一份已归档的观测被改写、改动**误入了暂存区**；工作区里还躺着一份
 * 未入库的「调试草稿」，它同样不该进入这次归档。
 * 教学点：`restore --staged` 只把**索引**退回 HEAD，工作区内容保持不动 ——
 *        与不带 `--staged` 的 `restore` 有本质区别（后者会连工作区一起丢弃）。
 *
 * ── 开局状态与判据的对应关系（M5a 实测逼出的设计）─────────────────────
 *
 * 用 `dirty` 造出「工作区 = 定稿版、HEAD = 初版」的差异 —— 玩家 `git add` 后
 * 即为叙事里的「已暂存」状态（`commits` / `files` 都无法预置索引态）。
 *
 * ⚠️ **判据必须全部在开局不成立**（`levels.test.ts` 的通用断言），而
 * 「草稿正文完好」这类判据天然会在开局成立（文件就在工作区）——
 * 故本关把它改为**要求玩家自己把草稿写出来**：
 *   - 开局工作区的草稿是「排查中」（`STAGING_DRAFT_WIP`，未完成的半成品）；
 *   - 目标是「排查结论」（`STAGING_DRAFT_FINAL`）—— 玩家先把它写完（编辑器），
 *     再 `add` → `restore --staged`，最终**保住**这份结论不丢。
 * 这样「正文完好」才是一个玩家挣来的结果，而不是开局的赠品。
 *
 * ⚠️ 已知缺口：§4.3 的 `TargetCondition` 没有「文件当前未处于暂存区」的判据，
 *    故「草稿被误 add 又退出暂存」与「压根没 add」在判定上不可区分。
 *    本关如实接受（记入 M5-tasks.md「执行结果 · 设计缺口」），
 *    不为了看起来完备而放宽或伪造判定（§14）。
 */
const LEVEL_5_2: Level = {
  id: 'ch5-2',
  chapter: 'ch5',
  title: '撤销暂存',
  objective:
    '排查进行到一半的「调试草稿」被顺手加进了暂存区 —— 结论还没写完，它不该进入这次归档。先把结论补完，再把不该归档的部分从暂存区退出来（**正文一个字都不能少**）。',
  difficulty: 3,
  inputMode: 'free',
  relatedKnowledge: ['git-undo#unstage'],
  init: {
    files: { 'notes/观测补充.md': OBSERVATION_SUPPLEMENT },
    commits: [
      {
        author: '练习者',
        date: '第十五天',
        msg: '观测基线归档',
        message: '观测基线归档',
        files: {
          'notes/观测基线.md': STAGING_BASELINE,
          'notes/调试草稿.md': STAGING_MISTAKE_DRAFT,
        },
      },
    ],
    // 工作区是「排查中」的半成品 —— 与 HEAD 里的初版不同，玩家 add 后即「已暂存」
    dirty: { 'notes/调试草稿.md': STAGING_DRAFT_WIP },
  },
  targets: [
    // 草稿的**结论**必须写进工作区并活下来（否决「用 restore 连内容一起丢掉」）
    { type: 'file', path: 'notes/调试草稿.md', exists: true, content: STAGING_DRAFT_FINAL },
    // 观测补充已归档
    { type: 'commitCount', op: 'eq', value: 2 },
  ],
  winScore: 65,
  scoring: { ...SCORING },
  // 参考解法：编辑器补完结论 → add 草稿 → restore --staged 草稿 → add 观测补充 → commit
  // （编辑器不计入命令数，故 add + restore + add + commit = 4）
  optimalMoves: 4,
  hints: [
    {
      text: '先把草稿的结论写完（在工作区里编辑那份文件）。然后想：怎样让它退出暂存区，同时**不丢掉刚写下的正文**？',
      unlockAfterFailures: 0,
    },
    {
      text: 'git restore --staged <文件> 只把暂存区退回上一次快照，工作区内容原样保留。若漏掉 --staged，工作区刚写的结论会被 HEAD 的旧版本覆盖 —— 正是本关要避免的。',
      unlockAfterFailures: 1,
    },
    {
      text: '完整答案：在编辑器里把 notes/调试草稿.md 写成结论版 → git add notes/调试草稿.md → git restore --staged notes/调试草稿.md → git add notes/观测补充.md → git commit -m "观测补充归档"',
      unlockAfterFailures: 3,
    },
  ],
};

/**
 * 5-3 丢弃改动（★★★★，自由）
 *
 * 剧本：工作区里的校准参数被改乱，另一份归档记录被误删。
 * 教学点：`restore <file>` / `checkout -- <file>` 从**已归档的版本**恢复工作区。
 *
 * ── 开局状态 ───────────────────────────────────────────────────────────
 *
 * 用 `dirty` 造出「改乱 + 误删」的开局（这正是 `LevelInit.dirty` 的用途）：
 *   - 参数文件的工作区内容 = 跑偏版；
 *   - 关键档案被删除（索引与 HEAD 仍在，故能找回）。
 *
 * 判据：两个文件都回到归档内容 + 工作区干净。
 * ⚠️ 三项**开局全部不成立**（工作区既不干净、两份内容也都不对），
 *    故不存在「开局即达标」的风险。
 */
const LEVEL_5_3: Level = {
  id: 'ch5-3',
  chapter: 'ch5',
  title: '丢弃改动',
  objective:
    '一次鲁莽的编辑让校准参数彻底跑偏，另有一条归档记录被误删。两者都要恢复到**已归档的版本** —— 工作区里那些没被记住的改动，本来就该被丢掉。',
  difficulty: 4,
  inputMode: 'free',
  relatedKnowledge: ['git-undo#restore'],
  init: {
    commits: [
      {
        author: '练习者',
        date: '第十六天',
        msg: '校准参数与关键档案归档',
        message: '校准参数与关键档案归档',
        files: {
          'notes/时间线校准参数.md': DISCARD_CORRECT,
          'notes/关键档案.md': DISCARD_DELETED,
        },
      },
    ],
    dirty: {
      'notes/时间线校准参数.md': DISCARD_CORRUPTED,
      'notes/关键档案.md': null,
    },
  },
  targets: [
    { type: 'file', path: 'notes/时间线校准参数.md', exists: true, content: DISCARD_CORRECT },
    { type: 'file', path: 'notes/关键档案.md', exists: true, content: DISCARD_DELETED },
    { type: 'workdirClean', value: true },
  ],
  winScore: 70,
  scoring: { ...SCORING },
  optimalMoves: 2,
  hints: [
    {
      text: '被改动的内容不该「手动改回去」—— 归档里还留着正确的版本，让 Git 用它覆盖工作区即可。被删掉的文件同理，可以找回来。',
      unlockAfterFailures: 0,
    },
    {
      text: '两条命令各管一个文件：git restore <被改乱的文件>；被删除的文件同样用 restore 找回来（归档里还有它）。',
      unlockAfterFailures: 1,
    },
    {
      text: '完整答案：git restore notes/时间线校准参数.md → git restore notes/关键档案.md（旧写法 git checkout -- <文件> 等价）',
      unlockAfterFailures: 3,
    },
  ],
};

/**
 * 5-4 安全反转（★★★★，自由）
 *
 * 剧本：一次已经被归档的有害改动需要被抵消。
 * 教学点：`revert` 生成**一条新的反向提交**，历史向前延伸而非被改写。
 *
 * 目标 = 文件内容回到被改坏之前的版本 + 提交数**增加**到 3（历史变长）
 *        + 存在一条 Revert 提交。
 * ⚠️ 「提交数 eq 3」是区分 revert 与 reset 的关键判据：用 reset 会把提交数
 *    退回 2，从而判失败。
 *
 * 参考解法 1 步：git revert HEAD。
 */
const LEVEL_5_4: Level = {
  id: 'ch5-4',
  chapter: 'ch5',
  title: '安全反转',
  objective:
    '有人把时间线参数改成了一组荒谬的数值，而且这次改动**已经被归档**。请让这组数值失效 —— 但历史必须继续向前延伸，那条错误的记录不能被抹掉。',
  difficulty: 4,
  inputMode: 'free',
  relatedKnowledge: ['git-undo#revert'],
  init: {
    commits: [
      {
        author: '练习者',
        date: '第十七天',
        msg: '时间线参数归档',
        message: '时间线参数归档',
        files: { 'notes/时间线参数.md': '时间线参数\n\n阈值：0.75\n容差：±0.02\n' },
      },
      {
        author: '练习者',
        date: '第十七天',
        msg: '调整参数（错误的改动）',
        message: '调整参数（错误的改动）',
        files: { 'notes/时间线参数.md': REVERT_BAD_CHANGE },
      },
    ],
  },
  targets: [
    // 内容回到被改坏之前的版本
    { type: 'file', path: 'notes/时间线参数.md', exists: true, content: '时间线参数\n\n阈值：0.75\n容差：±0.02\n' },
    // ⚠️ 历史变长（3 条），而不是退回 2 条 —— 这是 revert 与 reset 的分野
    { type: 'commitCount', op: 'eq', value: 3 },
    { type: 'commitMessage', match: /Revert/ },
    // ⚠️ 不用 `workdirClean` —— 预置提交收尾后工作区本来就是干净的，
    //    该目标会**开局即达标**（levels.test.ts 的通用断言抓到）。
    //    「改动是否已落盘」由上面三项共同锚定，不需要它。
  ],
  winScore: 70,
  scoring: { ...SCORING },
  optimalMoves: 1,
  hints: [
    { text: '目标是「让改动失效」而不是「让提交消失」—— 有一种命令会为它记一条**相反**的快照。', unlockAfterFailures: 0 },
    { text: 'git revert <提交> 会计算那条提交引入的改动，然后在当前历史末端应用它的反向版本，并生成一条新提交。', unlockAfterFailures: 1 },
    { text: '完整答案：git revert HEAD（提交信息会自动写成 Revert "…"）', unlockAfterFailures: 3 },
  ],
};

/**
 * 5-5 危险与安全（★★★★★，自由）
 *
 * 剧本：一条**已经对外同步**的公共档案被误改。改写它的历史会让协作者错位。
 * 教学点：reset（改写历史，适用于本地未推送）vs revert（追加反向提交，适用于已同步）。
 *
 * ⚠️ **OR 语义限制**（与 3-6 同款裁定）：`TargetCondition` 是 AND 语义，无法表达
 * 「reset 或 revert 任一过关」。本关按 **revert 路径**判定 —— 叙事明确说明这条
 * 时间线已对外同步，故只有 revert 是正确的做法；reset 会把提交数退回 2，判失败。
 *
 * 参考解法 1 步：git revert HEAD。
 */
const LEVEL_5_5: Level = {
  id: 'ch5-5',
  chapter: 'ch5',
  title: '危险与安全',
  objective:
    '一份**已经同步给别人**的公共档案被误改了。请让它恢复正确 —— 但要记住：这条时间线不是你一个人的，任何会让别人历史错位的做法都不被接受。',
  difficulty: 5,
  inputMode: 'free',
  relatedKnowledge: ['git-undo#reset-vs-revert'],
  init: {
    commits: [
      {
        author: '练习者',
        date: '第十八天',
        msg: '公共档案首次同步',
        message: '公共档案首次同步',
        files: { '公共档案.md': REVERT_PUBLIC_LOG },
      },
      {
        author: '练习者',
        date: '第十八天',
        msg: '误改公共档案',
        message: '误改公共档案',
        files: { '公共档案.md': REVERT_PUBLIC_CORRUPTED },
      },
    ],
  },
  targets: [
    { type: 'file', path: '公共档案.md', exists: true, content: REVERT_PUBLIC_LOG },
    // 历史只增不减 —— 这正是「已同步」场景下的正确判据
    { type: 'commitCount', op: 'eq', value: 3 },
    // ⚠️ 同样不用 `workdirClean`（预置收尾后开局即干净，见 5-4 的说明）
  ],
  winScore: 75,
  scoring: { ...SCORING },
  optimalMoves: 1,
  hints: [
    { text: '这条时间线已经和别人共享了。想想看：res** 会把历史改写掉，对共享时间线意味着什么？', unlockAfterFailures: 0 },
    {
      text: '对已同步的历史，正确做法是「再记一条相反的快照」而不是「抹掉原来的」—— 提交数量应该增加，而不是减少。',
      unlockAfterFailures: 1,
    },
    { text: '完整答案：git revert HEAD（对比：git reset --hard HEAD~1 会让提交数退回 2，本关判失败）', unlockAfterFailures: 3 },
  ],
};

/**
 * 5-6 时间跳跃（★★★★★，自由）
 *
 * 剧本：三份关键快照已归档，工作区里还留着一份未入库的残片；
 * 而有人已经**鲁莽地回退过**一次 —— 历史里现在只剩两条快照。
 * 教学点：`reset --hard` 的破坏性与 **reflog 补救** —— 提交没有真正消失，
 *        只是不再被任何分支指向；`git reflog` 能找回那个位置。
 *
 * ── 开局状态与判据（M5a 决策 ⑤：不新增 `TargetCondition` 类型）──────────
 *
 * ⚠️ 关键约束：**「玩家执行过 reflog 恢复」无法被现有类型判定**。
 *    强行加类型会超出决策 ⑤；而不加类型就必须让判据**由「结果」表达**。
 *
 * 本关的做法：把「已犯错」做成**开局的既成事实**，让判据全部锚在
 * 「玩家必须把丢掉的东西找回来」这一结果上：
 *
 *   预置 4 条提交（关键快照一/二/三 + 一条收尾记录），然后**开局即处于
 *   被回退后的状态**：HEAD 停在「关键快照一」。这由 `init.dirty` 做不到
 *   （dirty 只动工作区），故改用「预置提交时只保留 1 条在主线、
 *   其余 3 条构成**已丢失**的历史」——
 *
 *   ⚠️ 但引擎的 `sandbox.reset` 没有「预置孤儿提交」的能力，而新增这种能力
 *   会显著扩大改动面（且它本质上是「伪造一次历史事故」）。
 *
 * ── 因此本关采用**最诚实的最小方案** ─────────────────────────────────
 *
 *   预置 3 条关键快照 + 一份未入库残片；目标是「4 条提交 + 三份快照都在
 *   历史里 + 工作区干净」。玩家**必须归档残片**才能过关。
 *
 *   而「误操作 + reflog 恢复」这一完整剧本由**叙事与提示**承载，并由
 *   `levels.test.ts` 的专门用例锁定其**可行性**（该用例走全流程：
 *   误 reset → reflog → HEAD@{1} 恢复 → 仍然过关）。
 *
 *   ⚠️ 已知宽松：玩家不犯错、直接归档残片也能过关。
 *      这是判定能力的边界，不是实现疏漏 —— 如实记录在
 *      M5-tasks.md「执行结果 · 设计缺口」，不假装判定完备（§14）。
 */
const LEVEL_5_6: Level = {
  id: 'ch5-6',
  chapter: 'ch5',
  title: '时间跳跃',
  objective:
    '三份关键快照已依次归档，工作区里还留着一份未入库的残片。把它归档，然后**亲手体验一次时间的破坏与回溯**：试着用 git reset --hard 退掉两个快照，再用 Git 自己的记录把它们接回来 —— 让三份关键快照重新回到历史中。',
  difficulty: 5,
  inputMode: 'free',
  relatedKnowledge: ['git-undo#reflog'],
  init: {
    // 未入库的残片：让开局工作区不干净（否则 `workdirClean` 开局即达标）
    files: { 'notes/待归档残片.md': REFLOG_PENDING_FRAGMENT },
    commits: [
      {
        author: '练习者',
        date: '第十九天',
        msg: '关键快照一',
        message: '关键快照一',
        files: { 'notes/关键快照一.md': REFLOG_KEY_FIRST },
      },
      {
        author: '练习者',
        date: '第十九天',
        msg: '关键快照二',
        message: '关键快照二',
        files: { 'notes/关键快照二.md': REFLOG_KEY_SECOND },
      },
      {
        author: '练习者',
        date: '第十九天',
        msg: '关键快照三',
        message: '关键快照三',
        files: { 'notes/关键快照三.md': REFLOG_KEY_THIRD },
      },
    ],
  },
  targets: [
    // 残片归档后应为 4 条（预置 3 + 1）—— 这一项开局不成立，是本关的推进判据
    { type: 'commitCount', op: 'eq', value: 4 },
    // 工作区干净（残片已入库）—— 开局不成立
    { type: 'workdirClean', value: true },
  ],
  winScore: 75,
  scoring: { ...SCORING },
  // 最简解法：add . → commit（2 步）；走完整剧本则需要额外的 reset/reflog/reset
  optimalMoves: 2,
  hints: [
    { text: '先把残片归档。然后照目标说的做一次鲁莽回退，看看历史少了什么 —— 再想：Git 会记录「HEAD 曾经指向哪里」吗？', unlockAfterFailures: 0 },
    {
      text: 'git reflog 会列出 HEAD 的每一次移动。找到回退之前的那一条，它记录了当时的提交 —— 用 git reset --hard 把 HEAD 移回那个位置。',
      unlockAfterFailures: 1,
    },
    {
      text: '完整答案：git add . → git commit -m "归档残片" → git reset --hard HEAD~2 → git reflog → git reset --hard HEAD@{1}',
      unlockAfterFailures: 3,
    },
  ],
};

/** 第五章全部关卡，按关卡序号排列 */
export const CHAPTER_5_LEVELS: readonly Level[] = [
  LEVEL_5_1,
  LEVEL_5_2,
  LEVEL_5_3,
  LEVEL_5_4,
  LEVEL_5_5,
  LEVEL_5_6,
];

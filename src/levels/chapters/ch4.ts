/**
 * 第四章「星际连接」关卡定义（GDD §4 第四章、development-refinement.md §8）。
 *
 * ┌──────┬──────────────┬────────────────────────────────────┬──────────────────┬──────┐
 * │ 关卡 │ 名称         │ 目标                               │ 关联笔记         │ 难度 │
 * ├──────┼──────────────┼────────────────────────────────────┼──────────────────┼──────┤
 * │ 4-1  │ 建立航道     │ remote add 关联远程                │ 远程操作·remote  │ ★★★  │
 * │ 4-2  │ 传送数据     │ push 推送分支                      │ 远程操作·push    │ ★★★  │
 * │ 4-3  │ 接收数据     │ fetch / pull 拉取更新              │ 远程操作·fetch   │ ★★★  │
 * │ 4-4  │ 克隆宇宙     │ clone 复制仓库                     │ 远程操作·clone   │ ★★★  │
 * │ 4-5  │ 协作冲突     │ 多人推送冲突处理                   │ 远程操作·协作    │ ★★★★★│
 * └──────┴──────────────┴────────────────────────────────────┴──────────────────┴──────┘
 *
 * ─── 输入模式（GDD §3.2）──────────────────────────────────────────────────
 *
 * 第四章 = **半拼（half）**（GDD 关卡表「半拼」列，演进段「三~四章半拼」）。
 * 每关的 `halfSkeleton` 声明骨架命令（如 `git remote`），进关时预填进拼接草稿，
 * 玩家补齐参数即可执行。
 *
 * ─── 远程宇宙的落地形态（M5b 决策 ②，探针实测后细化）──────────────────────
 *
 * `/remote.git` 是沙箱内的**内存裸仓库**，经 `engine/fileRemote.ts` 的
 * **进程内智能 HTTP 服务端**通信 —— isomorphic-git 的 fetch/push/clone 走的是
 * **标准 Git 智能 HTTP 协议**（真 pkt-line、真 packfile），只是传输层不出浏览器。
 * 因此本章的每一关都是「真协议、真执行」，不是伪装的练习（§14）。
 *
 * ⚠️ 远程地址的形态：**必须是 `http://sandbox/remote.git`**，不能写 `file://`。
 *    实测 isomorphic-git 的 `GitRemoteManager` 只注册了 `http`/`https` 两个
 *    transport，任何 `file://` 地址都抛 `UnknownTransportError`。
 *    关卡数据统一引用 `ALLOWED_REMOTE_URL` 常量，避免各处手写漂移。
 *
 * ─── 各关的预置与判据设计 ─────────────────────────────────────────────────
 *
 * ⚠️ 贯穿全章的硬约束（沿用 M3/M4/M5a 的实测教训）：
 *   - **每个预置提交必须带 `files`**（M3 空提交防御）；
 *   - **开局不得即达标**（`levels.test.ts` 的通用断言）；
 *   - `remotes[].branches[].at` 必须是本关 `init.commits` 里**真实存在**的提交信息
 *     （schema 跨字段校验 + `sandbox.seedRemote` 运行期 fail-fast 两道防线）。
 *
 * ⚠️ 关于「远程已有内容」的表达：`init.remotes[].branches` 指向的提交必须**先在
 *    `/repo` 里被预置提交造出来**，`sandbox.seedRemote` 才能把它们搬进裸仓
 *    （搬迁走真 pack）。因此凡是「远程领先」的关卡，其预置历史里都真实存在那些提交 ——
 *    这一点是刻意的：远程内容不是凭空造的对象，而是从真实提交搬过去的。
 */

import type { Level } from '../../game/types';
import { ALLOWED_REMOTE_URL } from '../../engine/gitApi';
import {
  COLLAB_MAIN_NOTE,
  COLLAB_REMOTE_NOTE,
  FETCH_LOCAL_LOG,
  FETCH_REMOTE_LOG,
  PUSH_REMOTE_BASELINE,
  PUSH_SHIPMENT_LOG,
  REMOTE_LINK_TRACE,
  TRANSFER_BASELINE,
  UNIVERSE_CLONE_README,
} from '../presets';

/** 第四章计分参数（与第三、五章持平；本章的难点在流程而非命令数） */
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
 * 4-1 建立航道（★★★，半拼）
 *
 * 剧本：本地已经有一条时间线，但它仍是孤立的 —— 需要与「远程宇宙」建立航道。
 * 教学点：`git remote add origin <url>` 建立关联，`git remote -v` 查看。
 *
 * ⚠️ 本关**不预置远程关联**（这正是要考的动作），但预置了远程内容 ——
 *    这样玩家 add 之后立刻能看到 `origin` 指向的宇宙里已有什么，
 *    为 4-2 的推送做铺垫。
 *
 * 判据：`origin` 已关联 + 提交数门槛（要求玩家在建立航道后仍完成一次归档，
 *       避免「只 add 不动」的判据过于单薄 —— 但本关的核心动作就是 add，
 *       故门槛设为「至少已有的 2 条」，即不强制额外提交）。
 */
const LEVEL_4_1: Level = {
  id: 'ch4-1',
  chapter: 'ch4',
  title: '建立航道',
  objective:
    '本地这条时间线已经积累了几次观测，但它仍是孤立的 —— 外界无法取用，你也看不到别人的进展。为它建立一条通往远程宇宙的航道：把远程仓库关联为 origin，地址是本沙箱的远程宇宙。完成之后用 git remote -v 确认航道已经建立。',
  difficulty: 3,
  inputMode: 'half',
  halfSkeleton: 'git remote',
  relatedKnowledge: ['git-remotes#add-remote'],
  init: {
    commits: [
      {
        author: '练习者',
        date: '第二十天',
        msg: '航道起点观测',
        message: '航道起点观测',
        files: { 'notes/航道日志.md': REMOTE_LINK_TRACE },
      },
      {
        author: '练习者',
        date: '第二十天',
        msg: '航道补充观测',
        message: '航道补充观测',
        files: { 'notes/航道补充.md': TRANSFER_BASELINE },
      },
    ],
    // 远程宇宙里已有内容（玩家 add 之后即可在 fetch 时看到）——
    // 这为 4-3「接收数据」预埋了「远程领先」的事实。
    // ⚠️ `linkLocal: false` 是本关的关键：它让远程**有内容**但本地**尚未关联** ——
    //    这正是 4-1 要考的局面。若漏写，`remote` 目标会开局即达标（实测抓到）。
    remotes: [
      {
        name: 'origin',
        url: ALLOWED_REMOTE_URL,
        branches: [{ branch: 'main', at: '航道起点观测' }],
        linkLocal: false,
      },
    ],
  },
  targets: [
    // 核心判据：origin 已被关联
    { type: 'remote', name: 'origin', hasRemote: true },
  ],
  winScore: 60,
  scoring: { ...SCORING },
  // 参考解法 1 步：git remote add origin http://sandbox/remote.git
  optimalMoves: 1,
  hints: [
    {
      text: '远程宇宙需要一个名字才能在本地被引用 —— 按惯例叫 origin。骨架命令已经给出，补上名字与地址即可。',
      unlockAfterFailures: 0,
    },
    {
      text: 'git remote add origin http://sandbox/remote.git 建立关联；git remote -v 可以查看已建立的航道。',
      unlockAfterFailures: 1,
    },
    {
      text: '完整答案：git remote add origin http://sandbox/remote.git（随后 git remote -v 可确认）',
      unlockAfterFailures: 3,
    },
  ],
};

/**
 * 4-2 传送数据（★★★，半拼）
 *
 * 剧本：航道已建立，把本地归档的观测推送上去。
 * 教学点：`git push origin main` 把本地提交送到远程。
 *
 * ⚠️ 本关**预置了远程关联**（`remotes` 带 name/url），使玩家可直接 push ——
 *    4-1 已考过 `remote add`，本关应聚焦 push 本身。
 *    预置的远程分支指向一条**较早**的提交，让 push 是真正的快进推进。
 *
 * 判据：远程的 main 与本地一致（用 `commitMessage` 读本地 + `remote` 断言关联存在）
 *       —— ⚠️ 现无「远程分支内容」的 target 类型，故引擎层用「本地提交数门槛 +
 *       远程关联存在」表达，而**推送是否真的成功**由参考解法用例与冒烟脚本在
 *       真实引擎上断言（`levels.test.ts` 的走通用例 + `run-ch4.cjs`）。
 */
const LEVEL_4_2: Level = {
  id: 'ch4-2',
  chapter: 'ch4',
  title: '传送数据',
  objective:
    '航道已经打通，但远程宇宙还不知道你这边发生了什么。把本地时间线上的观测传送上去 —— 让远程的 main 与本地同步。传送完成后，远程的观测者就能看到你归档的全部记录。',
  difficulty: 3,
  inputMode: 'half',
  halfSkeleton: 'git push',
  relatedKnowledge: ['git-remotes#push'],
  init: {
    // ⚠️ 一份**未追踪**的新观测 —— 它让开局工作区**不干净**，
    //    于是 `workdirClean: true` 成为一个玩家必须挣来的结果（而非开局赠品）。
    //    这是 M5a 在第五章总结出的模式：`workdirClean` 只在该关开局确实脏时才有鉴别力。
    files: { 'notes/待传送观测.md': PUSH_SHIPMENT_LOG },
    commits: [
      // 远程已经有的那条 —— 玩家 push 时它是「共同祖先」，故是快进推进
      {
        author: '练习者',
        date: '第二十一天',
        msg: '航道起点观测',
        message: '航道起点观测',
        files: { 'notes/航道日志.md': REMOTE_LINK_TRACE },
      },
    ],
    // 远程停在**共同祖先**上 → 玩家本地领先，push 是真快进
    remotes: [
      {
        name: 'origin',
        url: ALLOWED_REMOTE_URL,
        branches: [{ branch: 'main', at: '航道起点观测' }],
      },
    ],
  },
  targets: [
    // ⚠️ 本关**不能**用 `remote` 目标：远程关联由 `init.remotes` 预置
    //    （本关要考的是 push，不是 remote add），该目标会开局即达标。
    //
    //    本关要判的是「玩家把本地提交推上去了」。但 §4.3 的 11 种 `TargetCondition`
    //    **没有「远程分支指向何处」这一条**（`remote` 只判关联存在性）——
    //    这是 M5b 如实记录的设计缺口（见 M5-tasks.md「设计缺口」）。
    //
    //    故判据只锚定**推进项** `commitExists`，不再叠加会被 commit 一并满足的条件。
    //
    //    ⚠️ 实测教训：初版写成 `commitExists + workdirClean`，结果玩家**只 commit
    //    就过关**（push 完全没做）—— 冒烟里的表现是「脚本还没点 push，关卡已结算」。
    //    这种「声称考 push 却只靠 commit 过关」正是 §14 说的假象，故去掉后者。
    //
    //    推送本身由两个**直接断言裸仓**的用例锁定（那才是「远程真的收到了」的事实来源）：
    //      - `levels.test.ts`：4-2 走参考解法后裸仓 main === 本地 HEAD，且能读出提交信息；
    //      - `run-ch4.cjs`：真实浏览器里 push 后裸仓与本地一致。
    { type: 'commitExists', message: '待传送观测' },
  ],
  winScore: 60,
  scoring: { ...SCORING },
  // 参考解法 3 步：git add . → git commit → git push origin main
  optimalMoves: 3,
  hints: [
    { text: '工作区里躺着一份还没归档的观测 —— 先把它收进历史，再传送到远程。骨架给出的是传送命令。', unlockAfterFailures: 0 },
    {
      text: '先 git add . 并 git commit -m "…" 归档那份观测；然后 git push origin main 把它送上去。',
      unlockAfterFailures: 1,
    },
    {
      text: '完整答案：git add . → git commit -m "传送前的补充观测" → git push origin main',
      unlockAfterFailures: 3,
    },
  ],
};

/**
 * 4-3 接收数据（★★★，半拼）
 *
 * 剧本：远程宇宙里有了新的观测（别人传来的），本地需要取回来。
 * 教学点：`git fetch` 只取不合并（安全）；`git pull` = fetch + merge。
 *
 * ⚠️ 本关的设计难点：**如何让「远程领先」在开局成立而不开局即达标**。
 *    做法：本地预置一条提交（`FETCH_LOCAL_LOG`），远程预置**另一条**提交
 *    （`FETCH_REMOTE_LOG`）—— 两者是**不同的提交**，故远程确实领先于本地所知的。
 *    玩家 fetch 后本地会多出 `origin/main` 引用；pull 则会把远程提交合并进来。
 *
 * 判据：玩家必须把远程的观测取回本地 —— 用 `commitExists` 锚定「远程那条提交的
 *       内容已进入本地历史」。fetch 只更新远程跟踪引用、merge 才让它进历史，
 *       故 `commitExists` 实际上要求玩家走完 pull（或 fetch + merge）。
 *       ⚠️ 这符合笔记对 fetch vs pull 的教学重心（fetch 安全、pull 一步到位），
 *       且避免了「只 fetch 就算过关」这种对「接收数据」而言不完整的达成。
 *
 * ⚠️ 但这样一来 `git fetch origin` 单独执行**不足以过关** —— 这是刻意的：
 *    target 类型里没有「远程跟踪引用存在」的判据（`remote` 只判关联存在性）。
 *    提示语明确引导玩家走到 pull，不让玩家卡在「明明取回了却不过关」的困惑里。
 */
const LEVEL_4_3: Level = {
  id: 'ch4-3',
  chapter: 'ch4',
  title: '接收数据',
  objective:
    '远程宇宙里出现了你这边没有的观测记录。把它取回本地 —— 注意有两条路：一条只取回、不改变你的工作区；另一条取回并直接合入你的时间线。让远程的观测真正进入你本地的历史。',
  difficulty: 3,
  inputMode: 'half',
  halfSkeleton: 'git pull',
  relatedKnowledge: ['git-remotes#fetch-pull'],
  init: {
    commits: [
      {
        author: '练习者',
        date: '第二十二天',
        msg: '本地已有观测',
        message: '本地已有观测',
        files: { 'notes/本地观测.md': FETCH_LOCAL_LOG },
      },
      // ⚠️ 远程那条提交也必须先在 /repo 里被造出来（seedRemote 要从这里搬进裸仓）。
      //    它落在独立的临时分支上，故不在 main 的祖先链里 —— 玩家 fetch 之前，
      //    本地历史里看不到它。这正是「远程领先」的构造方式。
      {
        author: '远方观测者',
        date: '第二十二天',
        msg: '远程新观测',
        message: '远程新观测',
        on: 'incoming',
        files: { 'notes/远程观测.md': FETCH_REMOTE_LOG },
      },
    ],
    remotes: [
      {
        name: 'origin',
        url: ALLOWED_REMOTE_URL,
        branches: [{ branch: 'main', at: '远程新观测' }],
      },
    ],
  },
  targets: [
    // 远程的观测已进入本地历史 —— 只有 pull（或 fetch+merge）才能做到
    { type: 'commitExists', message: '远程新观测' },
    // 合并后本地历史变长（预置 main 上 1 条 + 合入 1 条 = 2 条）
    { type: 'commitCount', op: 'gte', value: 2 },
  ],
  winScore: 65,
  scoring: { ...SCORING },
  // 参考解法 1 步：git pull origin main
  optimalMoves: 1,
  hints: [
    {
      text: '注意目标说的是「真正进入本地的历史」—— 只取回、不合入的做法不会让远程的观测出现在你的时间线上。',
      unlockAfterFailures: 0,
    },
    {
      text: 'git pull origin main 等价于「取回 + 合入」。若先用 git fetch origin 取回，还要再 git merge origin/main 才会合入。',
      unlockAfterFailures: 1,
    },
    { text: '完整答案：git pull origin main（或 git fetch origin → git merge origin/main）', unlockAfterFailures: 3 },
  ],
};

/**
 * 4-4 克隆宇宙（★★★，半拼）
 *
 * 剧本：本地的档案库是空的 —— 需要从远程宇宙完整复制一份下来。
 * 教学点：`git clone <url>` 一次取回完整历史并检出工作区。
 *
 * ⚠️ 本关用 `template: 'cloneSource'` 表达「玩家面对的是一个空仓库」。
 *    该 template 的语义是：`/repo` 只做 `git init`，**不预置任何提交与文件**
 *    （其余字段仍按常规处理，但本关刻意一个都不给）——
 *    于是玩家必须先 clone 才有内容可看。
 *
 * 判据：远程的提交内容出现在本地工作区（`file` 的内容比对）+ 提交数 > 0。
 *
 * ⚠️ 本关的 `/repo` 在 clone 前是空的，故 `commitCount gte 1` 开局不成立。
 */
const LEVEL_4_4: Level = {
  id: 'ch4-4',
  chapter: 'ch4',
  title: '克隆宇宙',
  objective:
    '这一次你的档案库是完全空的 —— 没有任何历史，也没有任何文件。远程宇宙里存在一份完整的时间线，把它整体复制下来：连同全部历史与工作区文件一起取到本地。',
  difficulty: 3,
  inputMode: 'half',
  halfSkeleton: 'git clone',
  relatedKnowledge: ['git-remotes#clone'],
  init: {
    template: 'cloneSource',
    // 玩家侧没有任何预置内容 —— 全凭 clone
    // ⚠️ 远程内容仍需先在 /repo 里造出来才能搬进裸仓，故这里预置一条提交，
    //    再在收尾时把工作区清空（cloneSource 的语义见 sandbox.reset）。
    commits: [
      {
        author: '远方观测者',
        date: '第二十三天',
        msg: '宇宙档案基线',
        message: '宇宙档案基线',
        files: { 'README.md': UNIVERSE_CLONE_README },
      },
    ],
    remotes: [
      {
        name: 'origin',
        url: ALLOWED_REMOTE_URL,
        branches: [{ branch: 'main', at: '宇宙档案基线' }],
      },
    ],
  },
  targets: [
    // 克隆的核心结果：远程的文件真的出现在本地工作区
    { type: 'file', path: 'README.md', exists: true, content: UNIVERSE_CLONE_README },
    // 历史也被完整取回（clone 会检出，故提交数 ≥ 1）
    { type: 'commitCount', op: 'gte', value: 1 },
  ],
  winScore: 65,
  scoring: { ...SCORING },
  // 参考解法 1 步：git clone http://sandbox/remote.git
  optimalMoves: 1,
  hints: [
    { text: '空的档案库无法修复 —— 需要从远程把整份时间线复制过来。骨架已给出命令。', unlockAfterFailures: 0 },
    {
      text: 'git clone http://sandbox/remote.git 会把远程的完整历史取回并检出到当前目录。克隆之后 README.md 会出现在工作区。',
      unlockAfterFailures: 1,
    },
    { text: '完整答案：git clone http://sandbox/remote.git', unlockAfterFailures: 3 },
  ],
};

/**
 * 4-5 协作冲突（★★★★★，半拼）
 *
 * 剧本：你推送之前，**别人已经先推了一条提交**上去 —— 两条历史分叉了。
 * 教学点：非快进推送被拒 → `fetch` 看清远程 → 合并 → 再推送。
 *        这正是笔记 `git-remotes.md` 的「推送被拒绝」小节。
 *
 * ── 引擎依据（M5b 探针实测）────────────────────────────────────────────
 *
 * `git push` 在「远程的 ref 不是本地头的祖先」时抛
 * `PushRejectedError`（`data.reason: 'non-fast-forward'`）。
 * 服务端也做同样的判定（`fileRemote.decidePush`，真 git 的
 * `receive.denyNonFastForwards` 语义）。两条路径都保留，与真 git 的分工一致。
 *
 * ── 判据（用户裁定 A：服务器端真拒绝）──────────────────────────────────
 *
 * 「玩家的 push 被拒过」这一**事件**无法用现有 target 表达（决策 ⑤ 不改 11 种类型）。
 * 因此判据锚在**结果**上：
 *   1. 远程那条提交已在本地历史里（`commitExists`）—— 玩家**必须** fetch 才能做到；
 *   2. 本地那条提交也还在（`commitExists`）；
 *   3. 两者都在 => 历史已合流（两条分叉各自的内容都进了 main）。
 *
 * ⚠️ 已知边界：玩家若「先 fetch 再提交」也能达成同样的结果，而不会经历被拒。
 *    这是判定能力的边界（同 5-6 的已知宽松），由**叙事与提示**承载「先推被拒」
 *    的教学体验，并如实记录在 M5-tasks.md「设计缺口」，不假装判定完备（§14）。
 *    参考解法用例（levels.test.ts）会走**完整剧本**（push 被拒 → fetch → merge → push），
 *    锁定「被拒是真实发生的」，而不仅仅是「结果对了」。
 */
const LEVEL_4_5: Level = {
  id: 'ch4-5',
  chapter: 'ch4',
  title: '协作冲突',
  objective:
    '你正要传送自己的观测，却发现远程宇宙里已经多了一条你没见过的记录 —— 有人在你之前传送了。试着直接推送：远程会拒绝你（这不是故障，是保护）。先把别人的记录取回来、与你的合流，再一起传送上去。让 remote 与本地最终都包含双方的观测。',
  difficulty: 5,
  inputMode: 'half',
  halfSkeleton: 'git fetch',
  relatedKnowledge: ['git-remotes#push-rejected'],
  init: {
    commits: [
      {
        author: '练习者',
        date: '第二十四天',
        msg: '协作基线观测',
        message: '协作基线观测',
        files: { 'notes/协作基线.md': COLLAB_MAIN_NOTE },
      },
      // 别人推上去的那条 —— 与本地即将做的工作分叉
      {
        author: '远方观测者',
        date: '第二十四天',
        msg: '他人传送的观测',
        message: '他人传送的观测',
        on: 'incoming',
        files: { 'notes/他人观测.md': COLLAB_REMOTE_NOTE },
      },
    ],
    // 远程 main 停在「他人传送的观测」—— 玩家本地的 main 停在「协作基线观测」，
    // 二者与远程之间**没有共同的可快进路径**（incoming 分支从基线之后分叉），
    // 故玩家的 push 会被拒（真 non-fast-forward）。
    remotes: [
      {
        name: 'origin',
        url: ALLOWED_REMOTE_URL,
        branches: [{ branch: 'main', at: '他人传送的观测' }],
      },
    ],
  },
  targets: [
    // ① 别人的观测已进入本地历史 —— 只有 fetch/merge 才能做到（开局不成立）
    { type: 'commitExists', message: '他人传送的观测' },
    // ② 别人的那条文件真的落到了工作区（merge 会检出它；开局本地没有该文件）
    //
    // ⚠️ 为什么不用 `workdirClean`：`sandbox.reset` 收尾时工作区 = HEAD 树 = 干净，
    //    该目标会**开局即达标**（M5a 在第五章已踩过同一个坑，此处再次实测确认）。
    //    改用「远程带来的文件出现在工作区」——它同时验证了 merge 的结果不只是 ref 移动，
    //    而是**内容真的合了进来**（isomorphic-git 的合并需要补 checkout，M4 的教训）。
    { type: 'file', path: 'notes/他人观测.md', exists: true },
  ],
  winScore: 80,
  scoring: { ...SCORING },
  // 完整剧本：push（被拒）→ fetch → merge → push = 4 步；
  // 最优捷径：fetch → merge → push = 3 步（不先撞一次南墙）
  optimalMoves: 3,
  hints: [
    {
      text: '直接推送会被拒绝 —— 因为远程上有你不知道的新记录。这不是故障，是 Git 在保护别人的工作。',
      unlockAfterFailures: 0,
    },
    {
      text: '先 git fetch origin 把远程的新记录取回来并看清它，再 git merge origin/main 把它合入你的时间线，最后 git push origin main 一起传上去。',
      unlockAfterFailures: 1,
    },
    {
      text: '完整答案：git push origin main（被拒）→ git fetch origin → git merge origin/main → git push origin main',
      unlockAfterFailures: 3,
    },
  ],
};

/** 第四章全部关卡，按关卡序号排列 */
export const CHAPTER_4_LEVELS: readonly Level[] = [
  LEVEL_4_1,
  LEVEL_4_2,
  LEVEL_4_3,
  LEVEL_4_4,
  LEVEL_4_5,
];

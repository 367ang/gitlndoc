// 核心领域类型（development-refinement.md §4）
// 本文件为纯类型声明，不包含任何运行时代码。

/** 章节标识：ch1~ch6 为六章主线，F 为综合挑战 */
export type ChapterId = 'ch1' | 'ch2' | 'ch3' | 'ch4' | 'ch5' | 'ch6' | 'F'

/** 输入方式：自由输入 / 半拼 / 菜单式（随章节演进，见 §8） */
export type InputMode = 'free' | 'half' | 'menu'

/** 达标条件（判别联合，§4.3 全部 11 种） */
export type TargetCondition =
  | { type: 'file'; path: string; content?: string; exists: boolean } // 文件内容/存在
  | { type: 'branch'; name: string; exists: boolean } // 分支存在
  | { type: 'headBranch'; name: string } // 当前检出分支
  | { type: 'commitCount'; op: 'gte' | 'eq'; value: number } // 提交数量
  | { type: 'commitMessage'; match: RegExp } // 最近提交信息
  | { type: 'commitExists'; message: string } // 存在特定提交
  | { type: 'tag'; name: string; exists: boolean } // 标签存在
  | { type: 'merged'; branch: string; into: string } // 分支已合并
  | { type: 'logOrder'; order: string[]; branch: string } // 提交顺序
  | { type: 'workdirClean'; value: boolean } // 工作区干净
  | { type: 'remote'; name: string; hasRemote: boolean } // 远程关联

/** 预置提交（用于构建真实的 git 对象库） */
export interface InitCommit {
  author: string
  date: string
  msg: string
  message: string
  /**
   * 该提交落在哪个分支上（M4，服务第 3 章的分支化预置）：
   *   - 首次出现：从当前 HEAD 创建该分支并切换过去，提交落在新分支；
   *   - 再次出现：仅切换回去，继续在既有分支上提交。
   * 缺省 = 沿用当前分支（等价于 ch1 的单线历史）。
   */
  on?: string
  /**
   * 本次提交前写入工作区并暂存的文件（相对 `/repo` 的路径 → 内容）。
   * 与 `LevelInit.files`（进关即写入、不自动入库）不同，这里的文件**进入该次提交**。
   * 典型用途：3-4 冲突预置 —— 同一文件在两个分支上写入不同内容。
   */
  files?: Record<string, string>
}

/** 关卡初始化：清空虚拟根后据此重建沙箱仓库（§4.2） */
export interface LevelInit {
  template?: 'blank' | 'emptyRepo' | 'cloneSource' // 初始化方式
  files?: Record<string, string> // 预置文件路径 → 内容（首次写入）
  commits?: InitCommit[] // 预置提交（author/date/msg/message）
  branches?: { name: string; from: string }[] // 预置分支
  /**
   * 预置标签（M6，第六章「历史锚点」）。
   *
   * - `name`：标签名（如 `v1.0.0`），打在 `at` 指向的预置提交上；
   * - `at`：**该标签指向的预置提交信息**（`InitCommit.msg` 的逐字值）——
   *   与 `remotes[].branches[].at` 同一款「语义坐标」：用可读的提交信息而非序号，
   *   作者调整预置提交顺序时不会静默错位；找不到时 fail-fast（schema + sandbox 双防线）；
   * - `message`：提供即创建**注解标签**（tagger 为固定学习者身份）；
   *   缺省为轻量标签 —— 与笔记 `git-tags.md` 的两分法一致。
   */
  tags?: { name: string; at: string; message?: string }[]
  /**
   * 预置**远程宇宙**（M5b，服务第四章「星际连接」）。
   *
   * 与其他字段的关键差别：这里描述的不是 `/repo`，而是沙箱里的裸仓库
   * `/remote.git`（见 `fs.ts` 的目录约定、`engine/fileRemote.ts` 的实现）。
   *
   * 语义：
   *   - `name` / `url`：与真 git 的 `git remote add` 一致。URL 受白名单约束
   *     （`gitApi.ALLOWED_REMOTE_URL`），关卡数据应统一写沙箱地址。
   *   - `branches`：远程已有的分支，值为**该分支指向的预置提交信息**（`InitCommit.msg`）。
   *     初始化时按这些信息在 `/repo` 的预置历史里定位到对应提交，再整体搬进裸仓
   *     （走真实的 `packObjects` + `indexPack`，产出真对象库）。
   *
   * ⚠️ 为什么用 **提交信息** 而不是索引（如 `{ branch, atCommit: 2 }`）来引用：
   *   1. 与引擎既有的引用风格一致 —— `branches[].from` 用分支名、`tags[].at` 用
   *      提交引用，都是「语义名」而非「位置序号」；序号会在关卡作者调整预置提交
   *      顺序时静默错位；
   *   2. 提交信息是关卡数据里**唯一稳定且可读**的坐标 —— 作者写下
   *      `{ branch: 'main', at: '远程基线' }` 时，一眼能看出它指向哪条提交；
   *   3. 找不到时可在初始化期 fail-fast 报错（见 `sandbox.seedRemote`），
   *      而不是安静地生成一个空远程分支。
   *
   * ⚠️ 为什么 `template: 'cloneSource'` 不再单独列在别处：它表达的是
   *   「玩家进关时面对的是一个**尚未克隆**的空仓库，要从远程克隆下来」。
   *   与 `remotes` 的差别在于**预置与否**：
   *     - `template: 'cloneSource'` → `/repo` 保持空仓库，玩家自己 `git clone`；
   *     - 仅有 `remotes`（不带该 template）→ `/repo` 正常预置，玩家只需
   *       `git remote add` + `push` / `fetch`。
   *
   * @example 4-3「接收数据」：远程领先本地，玩家要 fetch 下来
   * ```ts
   * remotes: [{ name: 'origin', url: ALLOWED_REMOTE_URL,
   *             branches: [{ branch: 'main', at: '远程基线' }] }]
   * ```
   */
  remotes?: {
    name: string
    url: string
    /** 远程已有的分支：分支名 → 指向的预置提交信息（`InitCommit.msg` 的逐字值） */
    branches?: { branch: string; at: string }[]
    /**
     * 是否把该远程**同时**写进本地的 `remote.<name>.url` 配置（缺省 `true`）。
     *
     * ⚠️ 为什么需要这个开关（M5b 实测逼出来的字段）：
     *   `remotes` 承担两件事 ——（a）预置远程宇宙的内容，（b）让本地「已经关联」了它。
     *   大多数关卡两者都要（4-2 要能直接 push、4-3 要能直接 fetch）。
     *   但 **4-1「建立航道」恰恰是要考 `git remote add`** —— 若预置时就写了配置，
     *   该关的 `remote` 目标会**开局即达标**（`levels.test.ts` 的通用断言抓到），
     *   玩家一条命令不敲就过关。
     *
     *   故此处显式区分：「预置远程内容」与「本地已关联」是**两件事**，
     *   由关卡作者分别声明，而不是让一个字段默默兼做两用。
     *
     * `false` 的用法仅限「本关要考 remote add」的场景（当前只有 4-1）。
     */
    linkLocal?: boolean
  }[]
  /**
   * 预置「工作区被搞乱」的状态（M5a，服务第五章「时空回溯」）。
   *
   * ⚠️ 为什么需要这个字段：第五、章的叙事前提是**错误已经发生** ——
   * 文件被改乱、被删除、被误 add。而 `commits` 只能预置「已归档的正确状态」，
   * `files` 只能预置「未追踪的新文件」——**都无法表达「已追踪文件的工作区被改写」**。
   *
   * 语义：在**所有预置提交完成之后**执行（区别于 `files` 在提交之前写入）：
   *   - 值为字符串 → 覆盖该路径的工作区内容（对已追踪文件即「有未暂存改动」）；
   *   - 值为 `null`   → 从工作区删除该文件（模拟误删；索引与 HEAD 仍保留）。
   *
   * 写法与 `files` 一致（仓库相对路径 → 内容），便于关卡作者对照阅读。
   *
   * @example 5-3「丢弃改动」：把已归档的参数改乱，并删掉另一份档案
   * ```ts
   * dirty: { 'notes/参数.md': '跑偏了\n', 'notes/关键档案.md': null }
   * ```
   */
  dirty?: Record<string, string | null>
  /**
   * 收尾检出位置（M6，F-1「崩坏时间线」专用）。
   *
   * ⚠️ 默认行为（不提供本字段）：预置完成后**一律回 main** —— 既有关卡
   * （ch3/ch4 的最后一条预置提交带 `on`）都依赖该行为，其测试锁定。
   * 本字段让个别关卡显式声明「开局停在某个非主线分支」：
   * F-1 的叙事是「风暴把你困在修复分支」，且这让 `headBranch main` 类目标
   * 开局不成立。**不猜** —— 谁需要例外谁声明，其余关卡行为不变。
   */
  stayOnBranch?: string
}

/** 计分参数（§7） */
export interface ScoringParams {
  baseScore: number // 基准分
  undoPenalty: number // 撤销类命令扣分
  redoPenalty: number // 同目标重复提交扣分
  hintPenalty: number // 每步提示扣分
  optimalBonus: number // 最优命令序列加分
  flawlessBonus: number // 一次通过（0 撤销 0 提示）加分
  probeBonus: number // 只读探查命令加分（有上限）
}

/** probeBonus 的单关累计上限（次）。§7 只说「小额 + 上限」，数值待 M7 平衡调参 */
export const PROBE_BONUS_MAX_EVENTS = 3

/** 分步提示（按失败次数解锁，§9.1） */
export interface HintStep {
  text: string // 提示正文
  unlockAfterFailures: number // 失败多少次后解锁
}

/** 关卡定义（§4.1） */
export interface Level {
  id: string // "ch3-2"：章节-关卡
  chapter: ChapterId
  title: string
  objective: string // 玩家目标描述（中文）
  difficulty: 1 | 2 | 3 | 4 | 5 // ★~★★★★★
  inputMode: InputMode // 自由输入 / 半拼 / 菜单式
  relatedKnowledge: string[] // 关联笔记知识点 id（用于提示与后测）
  init: LevelInit // 初始化沙箱仓库
  targets: TargetCondition[] // 达标条件（全部满足才过关）
  winScore: number // 过关所需最低得分
  scoring: ScoringParams // 计分参数
  /** 参考解法的成功命令数（§7.3 optimalBonus 判据：与参考一致或更短） */
  optimalMoves: number
  hints: HintStep[] // 分步提示（按失败次数解锁）
  /**
   * 半拼模式的骨架命令（M4，仅 inputMode: 'half' 关卡提供，如 `'git merge'`）。
   * 进关时预填进拼接草稿，玩家在其上补参数（GDD §3.2「命令骨架 + 关键参数填空」）。
   */
  halfSkeleton?: string
  timeoutMs?: number // 可选倒计时（默认不限时）
}

/** 命令历史条目（§4.4） */
export interface CommandEntry {
  id: string
  input: string // 玩家输入原文
  tokens: string[] // tokenize 结果
  ok: boolean // 执行是否成功
  output: string[] // stdout 行
  error?: string // stderr / 错误信息
  ts: number // 时间戳
  undoable?: boolean // 是否触发撤销类评分事件
}

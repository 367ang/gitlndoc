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
}

/** 关卡初始化：清空虚拟根后据此重建沙箱仓库（§4.2） */
export interface LevelInit {
  template?: 'blank' | 'emptyRepo' | 'cloneSource' // 初始化方式
  files?: Record<string, string> // 预置文件路径 → 内容（首次写入）
  commits?: InitCommit[] // 预置提交（author/date/msg/message）
  branches?: { name: string; from: string }[] // 预置分支
  tags?: { name: string; at: string }[]
  remotes?: { name: string; url: string }[]
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
  hints: HintStep[] // 分步提示（按失败次数解锁）
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

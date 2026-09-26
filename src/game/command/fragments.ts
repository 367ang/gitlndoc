/**
 * 拼接式输入的命令片段与组装规则（development-refinement.md §9.1、GDD §3.2）。
 *
 * 职责边界：
 *   - 「点击片段 → 输入行变成什么样」是一条**纯函数**规则（与 tokenize 同层的 game service），
 *     故放在本文件而非组件里 —— 组件只负责渲染按钮并转发点击；
 *   - 本文件不 import React / zustand / executor，可被测试直接穷举覆盖。
 *
 * ⚠️ 输入方式随章节演进（GDD §3.2）：第 1–2 章为「菜单 / 拼接」，故 M2 只服务
 * `inputMode === 'menu'` 的关卡。半拼（第 3–4 章）与自由输入属 M4+，此处不涉及。
 *
 * ⚠️ 为什么只给到 `-m` 为止，不给整条 `git commit -m "…"`：
 * 引号内的提交信息必须由玩家自己补 —— 提交信息写了什么、有没有说清这次快照
 * 干了什么，正是关卡要考的理解，不该由拼接按钮替玩家决定。
 *
 * ── 核心设计：拼接状态 = 「槽位数组」，而不是「已点击的片段序列」 ──────────
 *
 * 每条命令被拆成有序槽位：`git add .` → [slot0 `git add`, slot1 `add`, slot2 `.`]。
 * 点击片段即把该片段写入它所属命令的对应槽位，再按槽位顺序渲染成文本。
 * 由此得到三条性质（都是玩家可感知的正确行为）：
 *   1. **乱序点击无害**：先点 `add` 再点 `git add`，槽位 0/1 各自就位，结果仍是 `git add`；
 *   2. **同槽位即替换**：`add` 与 `commit` 同在 slot 1，后点的顶掉先点的；
 *   3. **换命令保留公共前缀**：`git add` 改点 `commit` 得 `git commit`（起始词不变），
 *      而不是丢掉 `git` 只剩 `commit`。
 *
 * ⚠️ 为什么状态必须存在**槽位数组**里、而不是从输入行文本反推：
 * 文本是**有损**的 —— `add` 这一段无法判断玩家是想拼 `git add` 还是别的，
 * `git add` 也无法区分「slot0 已填」与「slot0 是玩家手写的」。
 * 早期实现试图用「文本前缀匹配」反推槽位，实测在多组片段共享起始词时全线失败
 * （`add` + `git add` → `git add add`）。故改为把状态显式带在输入里。
 */

import type { Level } from '../types'

/**
 * 一个可点击拼接的命令片段。
 *
 * `command` + `slot` 两个字段共同实现**替换语义**（见下方 `appendFragment`）：
 * 它们是「这一段属于哪条命令的第几段」的声明，而不是展示用的元数据。
 */
export interface Fragment {
  /**
   * 片段按钮的**唯一标识**，形如 `git add::1::add`。
   *
   * ⚠️ 不可用 `text` 当标识：不同命令的起始词 `text` 可能相同，
   * React 的 `key` 与按钮的 `aria-label` 都会因此重复，
   * 玩家与测试都无法分辨点的是哪一个按钮。故显式给出稳定 id。
   */
  id: string
  /** 该片段拼出的**完整命令**，形如 `git init` —— 判定「同属一条命令」的依据 */
  command: string
  /**
   * 该片段在这条命令里的**槽位**（从 0 起，连续）：
   *   0 = 命令起始词（`git add`）、1 = 子命令（`add`）、2 = 参数（`.` / `-m`）、
   *   3 = 参数值（文件路径）。
   */
  slot: number
  /** 追加到输入行的文本 */
  text: string
  /**
   * 按钮上的**可见中文文案**，全局唯一。
   *
   * ⚠️ 与 `text` 刻意分开，且保证唯一：按钮上写的是「这个按钮会拼出什么」，
   * 而不是裸 token。玩家因此能在点击**之前**知道结果 ——
   * 若同组的按钮都显示裸 `git`，玩家无从选择（这是实测出的真实缺陷）。
   */
  label: string
}

/** 构造片段：`id` 由 `command` + `slot` + `text` 派生，避免手写 id 打错 */
function fragment(command: string, slot: number, text: string, label: string): Fragment {
  return { id: `${command}::${slot}::${text}`, command, slot, text, label }
}

/**
 * 第一章命令集（用户裁定，2025-09）：`init` / `add` / `commit`。
 *
 * ⚠️⚠️ **槽位不重叠**是这张表的硬约束（实测过的真实缺陷）：
 * 早期版本把 slot 0 写成 `"git add"`（已含子命令）、slot 1 又写成 `"add"`（同一子命令），
 * 两者叠加直接拼出 `git add add`。而玩家最自然的操作恰恰是「先点子命令按钮、
 * 再点动词按钮」，故 1-2 / 1-3 两关（都要走 `add`）会稳定撞上这个报错。
 *
 * 现行的做法：**起始词只承载 `git`，子命令独立成段**，三段各司其职、互不重复 ——
 *   `add` 组：`git`(0) + `add`(1) + `.`(2) / 路径(2) → 拼出 `git add .` 或 `git add README.md`
 *   `commit` 组：`git`(0) + `commit`(1) + `-m`(2) → 拼出 `git commit -m`（提交信息由玩家补）
 *   `init` 组：`git`(0) + `init`(1) → 拼出 `git init`
 *
 * ⚠️ `.`（全部文件）与具体路径**同为 slot 2**：它们是「暂存什么」这一段的互斥选项，
 * 后点者替换先点者。若把路径放到 slot 3，玩家必须先点 `.` 才能点路径，
 * 而正确的教学意图恰恰是让玩家在「全部」与「指定文件」之间做选择。
 *
 * ⚠️ 三条命令的 slot 0 都是 `git`：同一**文本**分属三个 `command` 组，这不是歧义 ——
 * `Draft.slots` 记录的是**片段对象**（含 `command` 字段），不是文本，
 * 因此渲染与替换都能正确区分。切换命令组时 `git` 作为公共前缀被保留。
 */
const FIRST_CHAPTER: Fragment[] = [
  // slot 0：起始词。三个组共享同一文本，但在 Draft 里是各自独立的片段对象
  fragment('git init', 0, 'git', 'git'),
  fragment('git add', 0, 'git', 'git'),
  fragment('git commit', 0, 'git', 'git'),
  // slot 1：子命令（唯一，不与 slot 0 重复）
  fragment('git init', 1, 'init', 'init'),
  fragment('git add', 1, 'add', 'add'),
  fragment('git commit', 1, 'commit', 'commit'),
  // slot 2：参数（`-m` 之后由玩家自己补提交信息）
  fragment('git add', 2, '.', '.'),
  fragment('git commit', 2, '-m', '-m'),
]

/** 通用片段（M2 尚未按关卡拆分时的默认清单） */
export const COMMON_FRAGMENTS: Fragment[] = FIRST_CHAPTER

/**
 * 从关卡数据里推导出「玩家可能要拼的路径片段」。
 *
 * ⚠️ 取两个来源，缺一不可：
 *   1. `targets` 里 `type: 'file'` 的路径 —— 目标直接点名的文件；
 *   2. `init.files` 的键 —— **预置在工作区里的文件**。第一章的 4 关都用
 *      `commitCount` + `workdirClean` 作目标（`file` 条件会「开局即达标」，
 *      data-validate 已刻意避开），因此第 1 条来源在第一章恒为空；
 *      真正的待提交文件只会出现在 `init.files` 里。
 *      只查 `targets` 会让路径按钮全部消失，玩家无法拼出 `git add README.md`。
 *
 * ⚠️ 只取路径、且**去重排序**：片段按钮是提示的一部分，而 §9.1 要求未达标时
 * 只给抽象提示、不给具体命令。路径本身已由文件树面板公开可见（玩家进关就能看到
 * 工作区里有哪些文件），故列出它们不算泄题；而「该用哪条命令、按什么顺序」
 * 仍然要玩家自己判断。
 */
export function pathsFromLevel(level: Level): Fragment[] {
  const paths = new Set<string>()

  for (const target of level.targets) {
    if (target.type === 'file' && target.path.length > 0) paths.add(target.path)
  }
  for (const path of Object.keys(level.init.files ?? {})) {
    if (path.length > 0) paths.add(path)
  }

  return [...paths].sort().map((path) => fragment('git add', 2, path, path))
}

/** 关卡可用的完整片段清单：通用片段 + 该关卡涉及的路径 */
export function fragmentsForLevel(level: Level): Fragment[] {
  return [...FIRST_CHAPTER, ...pathsFromLevel(level)]
}

/**
 * 拼接草稿：一条正在被拼出来的命令。
 *
 * ⚠️ 这是「一个槽位填了什么」的显式状态，**不可**由输入行文本反推 ——
 * 见文件头「核心设计」一节。
 */
export interface Draft {
  /** 已填充的槽位；下标即 `slot`，未填处为 undefined */
  slots: (Fragment | undefined)[]
  /**
   * 玩家**手动补写**在命令末尾的文本（未点任何片段的那一段）。
   *
   * ⚠️ 为什么必须有这个字段：拼接只给到 `-m` 为止，引号里的提交信息
   * （`git commit -m "第一次快照"`）**必须由玩家自己敲**。若输入框设为只读，
   * 玩家永远拼不出带消息的 commit，第一关就卡死无法通关 —— 这是浏览器实测
   * 抓出来的真实缺陷（`readOnly` 让 `-m` 之后无法继续输入）。
   *
   * 因此输入行是「片段部分（只读拼装）+ 手写后缀（可编辑）」两部分拼起来的：
   * 片段部分由槽位决定、不可手改（否则槽位语义会与文本脱节，替换逻辑失效），
   * 后缀部分完全自由。玩家按 `-m` 后光标自然落在末尾，直接接着打字即可。
   */
  suffix?: string
}

/** 空草稿 */
export const EMPTY_DRAFT: Draft = { slots: [] }

/**
 * 把槽位数组渲染成命令文本；未填的槽位直接跳过，不产生多余空格。
 * 玩家手写的 `suffix` 接在末尾（若存在且非空）。
 */
export function renderDraft(draft: Draft): string {
  const parts = draft.slots
    .filter((item): item is Fragment => item !== undefined)
    .map((item) => item.text)

  const suffix = draft.suffix ?? ''
  if (suffix.length > 0) parts.push(suffix)

  return parts.join(' ')
}

/**
 * 把片段写入草稿的对应槽位。
 *
 * 规则只有两条：
 *   1. **同命令** → 直接写入该槽位（同槽位后点者顶掉先点的），其余槽位原样保留；
 *   2. **换命令** → 只保留那些「新命令也提供、且文本相同」的槽位（即公共前缀 `git`），
 *      其余全部丢弃。
 *
 * 第 2 条使 `git add .` 改点 `commit` 得到 `git commit`（`add` 与 `.` 属旧命令，被丢弃），
 * 而不是 `commit .` 这种半新半旧的非法组合。
 */
export function applyFragment(
  draft: Draft,
  next: Fragment,
  pool: readonly Fragment[] = COMMON_FRAGMENTS,
): Draft {
  const onNextCommand = draft.slots.some(
    (item) => item !== undefined && item.command === next.command,
  )

  const slots: (Fragment | undefined)[] = onNextCommand
    ? [...draft.slots]
    : // 换命令：只沿用新命令同样提供的片段（三条命令共享的 slot 0 起始词就是这种情况）
      draft.slots.map((item) =>
        item !== undefined && isOfferedBy(pool, next.command, item) ? item : undefined,
      )

  slots[next.slot] = next

  // ⚠️ 兜底清理：丢弃所有**比新片段更靠后**且不属于新命令的残留槽位。
  // 起因（穷举实测）：`git commit` + `-m` 之后改点 `init`（slot 1），
  // 旧命令的 slot 2（`-m`）会被沿用下来，拼出 `git init -m` —— 语法上能过，
  // 语义上却是缝合怪。命令一旦变更，其后缀必须整段重填。
  for (let slot = next.slot + 1; slot < slots.length; slot += 1) {
    const item = slots[slot]
    if (item !== undefined && item.command !== next.command) slots[slot] = undefined
  }

  // 手写后缀：拼接改变了命令结构，之前手写的文本多半已不适用。
  // 仅当新片段仍然属于同一条命令时保留（例如先打消息再补一个同命令的参数位），
  // 换命令则丢弃 —— 否则会把 `git add` 的路径留在 `git commit` 后面。
  const suffix = onNextCommand ? draft.suffix : undefined

  return suffix === undefined ? { slots } : { slots, suffix }
}

/**
 * 判断某个片段此刻**是否可点**。
 *
 * ⚠️ 这是防止「槽位互相顶掉后拼出半新半旧命令」的关键闸门。
 * 起因是一次穷举实测，发现两类缺陷：
 *   1. 点 `.`（`git add` 的 slot 2）再点 `-m`（`git commit` 的 slot 2），
 *      两者同槽位 → `-m` 顶掉 `.` 并切换命令，得到 `git -m`（缺子命令）；
 *   2. 只点了 `git`（slot 0）就点 `.`（slot 2）→ 得 `git .`，跳过了 slot 1 的子命令。
 * 两者都只是「某条合法命令的前缀」，语法层抓不住，玩家也看不出自己拼错了。
 *
 * 规则：**候选片段所属命令的每一个较低槽位，都必须已经在草稿里填好**
 * （要么是本命令已有的片段，要么是目标命令也提供、因而能被沿用的同槽片段）。
 * 于是玩家只能把当前命令**沿着槽位往后接**，或在换命令时得到一条完整可用的前缀。
 */
export function isFragmentEnabled(
  draft: Draft,
  candidate: Fragment,
  pool: readonly Fragment[] = COMMON_FRAGMENTS,
): boolean {
  // 逐个校验候选命令的较低槽位
  for (let slot = 0; slot < candidate.slot; slot += 1) {
    const existing = draft.slots[slot]
    // 该槽位已由候选命令自己填好 → 可以继续
    if (existing !== undefined && existing.command === candidate.command) continue
    // 该槽位是别的命令填的，但候选命令也提供同样的片段 → 换命令时可沿用
    if (existing !== undefined && isOfferedBy(pool, candidate.command, existing)) continue
    // 其余情况（空缺、或不可沿用的旧命令片段）→ 置灰
    return false
  }
  return true
}

/**
 * 判断 `item` 是否也是 `command` 这条命令提供的片段（用于识别可沿用的公共前缀）。
 *
 * `pool` 必须传入**当前关卡**的完整片段表 —— 路径片段（`git add` 的 slot 3）
 * 不在 `COMMON_FRAGMENTS` 里，若只查后者会把它们误判为不可沿用而丢掉。
 */
function isOfferedBy(pool: readonly Fragment[], command: string, item: Fragment): boolean {
  return pool.some(
    (candidate) => candidate.command === command && candidate.text === item.text,
  )
}

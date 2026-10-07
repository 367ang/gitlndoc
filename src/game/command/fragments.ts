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
 * 提取某条命令组的**整词快捷片段**（M9 体验修正）：
 * 把 slot0（起始词 `git`）与 slot1（子命令）合成一个「一步到位」的按钮 ——
 * 玩家点 `git add` 一次就得到 `git add`，而不是先点 `git` 再点 `add`。
 *
 * ⚠️ 返回的片段仍是 slot 1 的语义（`text` = 子命令 token），它写入草稿后
 * 与「先点 slot0 再点 slot1」的结果完全一致 —— 这由下方 `clickWordFragment`
 * 的自动补前缀保证，槽位模型不变，`isFragmentEnabled` 的置灰闸门继续成立。
 */
export function wordFragment(command: string, pool: readonly Fragment[]): Fragment | null {
  const slot1 = pool.find((item) => item.command === command && item.slot === 1);
  const slot0 = pool.find((item) => item.command === command && item.slot === 0);
  if (!slot1 || !slot0) return null;
  return { ...slot1, id: `${command}::word`, label: command };
}

/**
 * 从片段池提取各命令组的整词快捷按钮（去重保序）。
 * UI 层用它渲染「主按钮行」；slot0 的裸 `git` 按钮**不再渲染** ——
 * 同一文本 `git` 在每个命令组各有一个 slot0，全部渲染就是 16 个一模一样的
 * 重复按钮（实测反馈「拼接词重复出现」的根源）。
 */
export function wordFragments(pool: readonly Fragment[]): Fragment[] {
  const commands: string[] = [];
  for (const item of pool) {
    if (item.slot === 1 && !commands.includes(item.command)) commands.push(item.command);
  }
  return commands
    .map((command) => wordFragment(command, pool))
    .filter((item): item is Fragment => item !== null);
}

/**
 * 点击整词快捷片段（或任意 slot ≥ 1 的片段）后的草稿：
 * 若其命令组的 slot0（起始词）尚未就位，自动补上 —— 玩家永远不需要点「git」。
 */
export function clickWordFragment(draft: Draft, next: Fragment, pool: readonly Fragment[]): Draft {
  const hasNextCommand = draft.slots.some(
    (item) => item !== undefined && item.command === next.command,
  );
  if (hasNextCommand) return applyFragment(draft, next, pool);

  // 换命令 / 起步：先让 slot0（起始词）就位，再走 applyFragment 的既有替换语义。
  // applyFragment 会丢弃不可沿用的旧槽位并保留公共前缀 `git`。
  const gitSlot = pool.find((item) => item.command === next.command && item.slot === 0);
  if (gitSlot === undefined) return applyFragment(draft, next, pool);
  const withPrefix = draft.slots[0] !== undefined ? draft : applyFragment(draft, gitSlot, pool);
  return applyFragment(withPrefix, next, pool);
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
const COMMON_GIT_SLOT: Fragment[] = [
  // slot 0：起始词。各命令组共享同一文本，但在 Draft 里是各自独立的片段对象。
  // ⚠️ 必须覆盖**该章片段表里出现的每一个命令组** —— draftFromSkeleton 靠
  // 「slot0 + slot1 同命令」锁定命令组；缺组的 slot0 会让该命令的骨架预填失败
  // （实测踩过两次：M4 的 merge/rebase、M5b 的 remote/clone/push/fetch/pull）。
  // 新增章节片段表时，此处要同步补上该章所有命令组的 slot0。
  fragment('git init', 0, 'git', 'git'),
  fragment('git add', 0, 'git', 'git'),
  fragment('git commit', 0, 'git', 'git'),
  fragment('git status', 0, 'git', 'git'),
  fragment('git diff', 0, 'git', 'git'),
  fragment('git log', 0, 'git', 'git'),
  fragment('git rm', 0, 'git', 'git'),
  fragment('git branch', 0, 'git', 'git'),
  fragment('git checkout', 0, 'git', 'git'),
  fragment('git switch', 0, 'git', 'git'),
  fragment('git merge', 0, 'git', 'git'),
  fragment('git rebase', 0, 'git', 'git'),
  // M5b：第四章「星际连接」的五个命令组
  fragment('git remote', 0, 'git', 'git'),
  fragment('git clone', 0, 'git', 'git'),
  fragment('git push', 0, 'git', 'git'),
  fragment('git fetch', 0, 'git', 'git'),
  fragment('git pull', 0, 'git', 'git'),
]

const FIRST_CHAPTER: Fragment[] = [
  ...COMMON_GIT_SLOT,
  // slot 1：子命令（唯一，不与 slot 0 重复）
  fragment('git init', 1, 'init', 'init'),
  fragment('git add', 1, 'add', 'add'),
  fragment('git commit', 1, 'commit', 'commit'),
  // slot 2：参数（`-m` 之后由玩家自己补提交信息）
  fragment('git add', 2, '.', '.'),
  fragment('git commit', 2, '-m', '-m'),
]

/**
 * 第二章片段表（M4）：status / diff / log / rm / .gitignore 相关。
 * 命令集与 GDD §4 第二章一致；拼接输入（用户裁定 M4 开工前确认）。
 * 槽位不重叠约束继续成立；`.gitignore` 的「创建」走文件编辑器而非命令。
 */
const SECOND_CHAPTER: Fragment[] = [
  ...COMMON_GIT_SLOT,
  fragment('git status', 1, 'status', 'status'),
  fragment('git diff', 1, 'diff', 'diff'),
  fragment('git log', 1, 'log', 'log'),
  fragment('git rm', 1, 'rm', 'rm'),
  fragment('git add', 1, 'add', 'add'),
  fragment('git commit', 1, 'commit', 'commit'),
  fragment('git status', 2, '-s', '-s'),
  fragment('git diff', 2, '--staged', '--staged'),
  fragment('git log', 2, '--oneline', '--oneline'),
  fragment('git log', 2, '--all', '--all'),
  fragment('git rm', 2, '--cached', '--cached'),
  fragment('git add', 2, '.', '.'),
  fragment('git commit', 2, '-m', '-m'),
]

/**
 * 第三章片段表（M4）：branch / checkout / switch / merge / rebase。
 * 半拼关卡的骨架会预填部分槽位，玩家在其上补参数。
 */
const THIRD_CHAPTER: Fragment[] = [
  ...COMMON_GIT_SLOT,
  fragment('git branch', 1, 'branch', 'branch'),
  fragment('git checkout', 1, 'checkout', 'checkout'),
  fragment('git switch', 1, 'switch', 'switch'),
  fragment('git merge', 1, 'merge', 'merge'),
  fragment('git add', 1, 'add', 'add'),
  fragment('git commit', 1, 'commit', 'commit'),
  fragment('git rebase', 1, 'rebase', 'rebase'),
  fragment('git checkout', 2, '-b', '-b'),
  fragment('git switch', 2, '-c', '-c'),
  fragment('git add', 2, '.', '.'),
  fragment('git commit', 2, '-m', '-m'),
]

/**
 * 第四章片段表（M5b）：remote / clone / push / fetch / pull，**外加 merge**。
 *
 * ⚠️ 没有这张表时 `fragmentsForLevel` 会回落到 `FIRST_CHAPTER`（init/add/commit/status），
 *    于是第四章的半拼骨架 `git remote` **在片段池里找不到对应片段** ——
 *    预填草稿为空、执行按钮恒灰，玩家根本拼不出命令（真实浏览器实测发现）。
 *    它与 executor 的白名单必须同步扩展：**命令能执行 ≠ 玩家能拼出来**。
 *
 * ⚠️ `merge` 属第三章的教学命令，但 4-5「协作冲突」的剧本正是
 *    「fetch → merge → push」（笔记 `git-remotes.md` 的「推送被拒绝」小节原样如此），
 *    故本章片段表**必须**含它 —— 否则玩家在这一关拼不出合流那一步（实测踩到）。
 */
const FOURTH_CHAPTER: Fragment[] = [
  ...COMMON_GIT_SLOT,
  fragment('git remote', 1, 'remote', 'remote'),
  fragment('git clone', 1, 'clone', 'clone'),
  fragment('git push', 1, 'push', 'push'),
  fragment('git fetch', 1, 'fetch', 'fetch'),
  fragment('git pull', 1, 'pull', 'pull'),
  fragment('git merge', 1, 'merge', 'merge'),
  fragment('git add', 1, 'add', 'add'),
  fragment('git commit', 1, 'commit', 'commit'),
  fragment('git status', 1, 'status', 'status'),
  fragment('git remote', 2, 'add', 'add remote'),
  fragment('git remote', 2, 'remove', 'remove remote'),
  fragment('git remote', 2, '-v', '-v'),
  fragment('git add', 2, '.', '.'),
  fragment('git commit', 2, '-m', '-m'),
]

/** 通用片段（按章节选表前的默认清单；ch1 专用内容） */
export const COMMON_FRAGMENTS: Fragment[] = FIRST_CHAPTER

/** 各章节的片段表（M4 起按 `level.chapter` 选取；§3.2 输入方式随章节演进） */
const FRAGMENTS_BY_CHAPTER: Partial<Record<Level['chapter'], Fragment[]>> = {
  ch1: FIRST_CHAPTER,
  ch2: SECOND_CHAPTER,
  ch3: THIRD_CHAPTER,
  ch4: FOURTH_CHAPTER,
}

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
  // ⚠️ 半拼模式（half）没有专属片段表 —— 骨架预填走 CommandBuilder 的骨架路径，
  // 片段池沿用该章的通用表（第三章 = THIRD_CHAPTER），骨架命令必然能在池中找到。
  const chapterTable = FRAGMENTS_BY_CHAPTER[level.chapter] ?? FIRST_CHAPTER
  return [...chapterTable, ...pathsFromLevel(level)]
}

/**
 * 从半拼骨架生成初始草稿（M4，inputMode: 'half'）。
 *
 * 骨架（如 `git merge`）被拆成 token 序列，逐个在片段池里找「同命令且文本匹配」的
 * 片段填入槽位 —— 骨架因此走的是**既有槽位模型**，而不是另造一套预填逻辑；
 * `isFragmentEnabled` 的置灰闸门、`applyFragment` 的替换语义对骨架继续成立。
 * 找不到对应片段的 token（理论上是数据错误）被跳过并交由调用方断言。
 */
export function draftFromSkeleton(skeleton: string, pool: readonly Fragment[]): Draft {
  const tokens = skeleton.trim().split(/\s+/).filter((token) => token.length > 0);
  const slots: (Fragment | undefined)[] = [];

  if (tokens.length === 0) return { slots };

  // 骨架 token 1（恒为 'git'）：在「拥有 token 2 片段的命令组」里找 slot 0 ——
  // 三个组的 slot 0 文本相同，必须用第二个 token 决定命令组，否则会错锁到第一组（实测缺陷）。
  // 只有 'git' 一个 token 的骨架属于数据错误（骨架必须含子命令，schema 已拦），填空草稿。
  const verbToken = tokens[1];
  if (verbToken === undefined) return { slots };

  const verbFragment = pool.find(
    (fragment) => fragment.slot === 1 && fragment.text === verbToken,
  );
  if (!verbFragment) return { slots };

  const gitFragment = pool.find(
    (fragment) => fragment.command === verbFragment.command && fragment.slot === 0 && fragment.text === tokens[0],
  );
  if (!gitFragment) return { slots };

  slots[gitFragment.slot] = gitFragment;
  slots[verbFragment.slot] = verbFragment;

  // 更长的骨架（M4 未用，保留扩展位）：token 3 起依次匹配同命令的更高槽位
  for (let i = 2; i < tokens.length; i += 1) {
    const token = tokens[i];
    const match = pool.find(
      (fragment) =>
        fragment.command === verbFragment.command &&
        fragment.text === token &&
        slots[fragment.slot] === undefined &&
        slots.slice(0, fragment.slot).every((slot) => slot !== undefined),
    );
    if (!match) break;
    slots[match.slot] = match;
  }

  return { slots };
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

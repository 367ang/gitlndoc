/**
 * ref 移动日志 —— 即真 git 的 **reflog**（M5a，第五章 5-6「时间跳跃」的依据）。
 *
 * ── 设计动机（GDD §10 的裁定）───────────────────────────────────────────
 *
 * GDD §10「风险与待确认项」对 `reset --hard` 的破坏性裁定为：
 * 「采用 **reflog 可恢复机制**。每次命令前自动记录快照，`reset --hard` 后可通过
 *  『时间回溯/reflog』节点撤销，模拟真实 reflog 语义，保证任意操作可恢复。」
 *
 * 而笔记 `docs/notes/git-undo.md` 给的学习路径是：
 * ```
 * $ git reflog
 * abc1234 HEAD@{0}: reset: moving to HEAD~3
 * def5678 HEAD@{1}: commit: 重要提交
 * $ git reset --hard def5678   # 恢复！
 * ```
 * 因此本模块的两条硬要求：
 *   1. **格式**：每条记录能渲染成 `<短hash> HEAD@{n}: <action>`，与笔记逐字一致；
 *   2. **语义**：`HEAD@{n}` 能被 ref 表达式解析（`refExpr.ts`）并解析回那次操作的提交。
 *
 * ── 为什么是「引擎层自建」而不是读真 reflog ──────────────────────────────
 *
 * isomorphic-git **没有 reflog 实现**（`git.log` 走提交图，与操作历史无关；
 * 其 `.git/logs/` 目录不会被写入）。探针实测 `resolveRef('HEAD@{0}')` 抛
 * `NotFoundError`，证实这一点。故本层用内存日志复刻 reflog 的**可观察语义**：
 * 记录每次 ref 移动的「从哪来、到哪去、因为什么」，供 `git reflog` 输出与
 * `HEAD@{n}` 解析使用。
 *
 * ⚠️ 边界（有意取舍，已在关卡设计中避开依赖）：
 *   - 只记录**本地 ref 移动**，不记录 `git status` 这类只读操作（与真 git 一致：
 *     reflog 记的是 ref 变化，不是命令历史）；
 *   - **不随快照持久化**：日志是「本关内的时间回溯」工具，跨关/跨刷新后
 *     历史已随 `sandbox.reset()` 重建，旧 reflog 条目指向的提交不再有意义
 *     （持久化它反而会制造「能恢复到一个已不存在的提交」的假象，§14 不伪造）。
 */

import type { RepoOptions } from './gitApi';
import { REPO_DIR } from './fs';

/** 一次 ref 移动的原因分类（决定 `git reflog` 输出的 action 文案） */
export type ReflogAction =
  | 'commit'
  | 'commit (amend)'
  | 'commit (initial)'
  | 'reset: moving to'
  | 'merge'
  | 'checkout: moving from'
  | 'branch: Created from'
  | 'rebase (finish)'
  | 'revert';

/** 一条 reflog 记录 */
export interface ReflogEntry {
  /** 移动前的提交 oid；首次提交（无前身）为全 0 的占位值 */
  from: string;
  /** 移动后的提交 oid */
  to: string;
  /** 原因分类 */
  action: ReflogAction;
  /** 该 action 的补充说明（如 `reset: moving to` 的目标写法 `HEAD~2`） */
  detail?: string;
  /** 记录时间（Unix 秒） */
  timestamp: number;
}

/** 全 0 oid —— 真 git 用它表示「此前没有提交」 */
const NULL_OID = '0'.repeat(40);

/**
 * 按仓库路径隔离的日志表。
 *
 * ⚠️ 用 `Map<dir, ReflogEntry[]>` 而非单数组：测试会在一轮里创建多个沙箱目录
 * （`/repo` 之外还有注入的 dir），共用一个数组会让 A 仓库的历史出现在 B 仓库里。
 */
const logs = new Map<string, ReflogEntry[]>();

/** 取某仓库的日志数组（不存在则创建） */
function logOf(dir: string): ReflogEntry[] {
  let entries = logs.get(dir);
  if (!entries) {
    entries = [];
    logs.set(dir, entries);
  }
  return entries;
}

/** 解析 `RepoOptions` 得到实际仓库目录（与 gitApi 的 `resolveDir` 同口径） */
function dirOf(options: RepoOptions = {}): string {
  return options.dir ?? REPO_DIR;
}

/**
 * 记一次 ref 移动。
 *
 * **调用点必须收敛在 `gitApi` 的 ref 写入出口**，不在各命令里各写一份 ——
 * 否则新增命令时极易漏记，而漏记表现为「reflog 里少一条」，很难发现。
 *
 * @param options 仓库位置
 * @param entry   本次移动（`timestamp` 缺省取当前时间）
 */
export function recordRefMove(
  options: RepoOptions,
  entry: Omit<ReflogEntry, 'timestamp'> & { timestamp?: number },
): void {
  logOf(dirOf(options)).push({
    ...entry,
    timestamp: entry.timestamp ?? Math.floor(Date.now() / 1000),
  });
}

/**
 * 记一次「首次提交」—— 真 git 的 reflog 首条 message 是 `commit (initial)`。
 * 调用方（`gitApi.commit`）负责判断是否为首次，本函数只负责记。
 */
export function recordInitialCommit(options: RepoOptions, to: string): void {
  recordRefMove(options, { from: NULL_OID, to, action: 'commit (initial)' });
}

/** 读某仓库的完整日志（时间正序，最新在末尾）—— 副本，调用方改动不影响内部状态 */
export function readReflog(options: RepoOptions = {}): ReflogEntry[] {
  return [...logOf(dirOf(options))];
}

/**
 * 求 `HEAD@{n}` 的值。
 *
 * ⚠️ 语义经**真 git 实测校准**（`git rev-parse HEAD@{n}` 逐项对照），不是推理出来的：
 *
 * ```
 * $ git log --oneline                    # 三份提交后执行 reset --hard HEAD~2
 * $ git reflog
 * 1bf925c HEAD@{0}: reset: moving to HEAD~2     ← 本次操作的「落点」
 * 6bf70e3 HEAD@{1}: commit: commit3             ← 上一次操作之后的 HEAD
 * d67c8b4 HEAD@{2}: commit: commit2
 * 1bf925c HEAD@{3}: commit (initial): commit1
 * $ git rev-parse HEAD@{1}  →  6bf70e3
 * ```
 *
 * 结论：**`HEAD@{n}` 就是「倒数第 n+1 条记录的 `to`」** —— 即该条记录里
 * HEAD 被移动到的那个值。`HEAD@{0}` 因此恒等于当前位置，而 `HEAD@{1}` 是
 * 上一条记录的落点（正是「误操作之前 HEAD 在哪」）。
 *
 * ⚠️ 这里有个极易搞错的地方，本项目**实际踩过**（M5a 实测缺陷）：
 *    曾误以为 `HEAD@{n}` 要取「该条记录的 `from`」，结果 `HEAD@{1}` 返回了
 *    `d67c8b4`（更早的落点），恢复剧本因此接错位置。真 git 的口径如上，
 *    **一律取 `to`**，不做 `from` 换算。
 *
 * 实现：内部按时间正序存储，故倒数第 n+1 条即 `entries[len-1-n]`。
 */
export function resolveReflogEntry(options: RepoOptions, n: number): string | null {
  const entries = logOf(dirOf(options));
  if (n < 0 || n >= entries.length) return null;
  return entries[entries.length - 1 - n].to;
}

/** 清空某仓库的日志（`sandbox.reset()` 每关重建时调用） */
export function clearReflog(options: RepoOptions = {}): void {
  logs.delete(dirOf(options));
}

/** 清空全部仓库的日志（测试收尾用；避免跨用例串味） */
export function clearAllReflogs(): void {
  logs.clear();
}

/**
 * 把一条记录渲染成 `git reflog` 的输出行 —— **格式与笔记逐字一致**：
 *
 * ```
 * abc1234 HEAD@{0}: reset: moving to HEAD~2
 * ```
 *
 * 组成：`<短hash> HEAD@{<序号>}: <action>[ <补充说明>]`。
 * 短 hash 取 7 位（与 `CommitEntry.shortHash` 同口径）。
 */
export function formatReflogLine(entry: ReflogEntry, indexFromNewest: number): string {
  const short = entry.to.slice(0, 7);
  // ⚠️ 分隔符取决于 action 自身的写法（都对齐真 git 的实际输出）：
  //   - `reset: moving to <目标>` / `checkout: moving from <旧> to <新>`：
  //     action 里已含冒号，detail 直接空格相接（`reset: moving to HEAD~2`）；
  //   - `commit` / `revert` 等：真 git 输出 `commit: <提交信息首行>`，需补冒号。
  const needsColon = !entry.action.includes(':');
  const suffix = entry.detail
    ? needsColon
      ? `: ${entry.detail}`
      : ` ${entry.detail}`
    : '';
  return `${short} HEAD@{${indexFromNewest}}: ${entry.action}${suffix}`;
}

/**
 * 渲染完整的 `git reflog` 输出（最新在**前**，与真 git 一致）。
 */
export function formatReflog(options: RepoOptions = {}): string[] {
  const entries = logOf(dirOf(options));
  const lines: string[] = [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    lines.push(formatReflogLine(entries[i], entries.length - 1 - i));
  }
  return lines;
}

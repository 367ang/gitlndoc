/**
 * 目标状态比对（development-refinement.md §4.3、§9.1）。
 *
 * 分层纪律（§2）：本模块属 **Game Service 纯函数层** ——
 *   - 不引入副作用、不直接触碰 `fs` / `isomorphic-git`；
 *   - 不 import React / zustand；
 *   - 仓库状态**一律经 `gitApi`** 取得（见下方「为什么必须走 gitApi」）。
 *
 * ⚠️ 为什么必须走 `gitApi`，不能自己读 fs 判断：
 * `gitApi.status()` 修过两个真实缺陷，自行实现会重蹈覆辙 ——
 *   1. 「新增且已暂存」曾被误报 `unstaged: true`（会让 `workdirClean` 误判）；
 *   2. 「等长改写」（`hi\n` → `v2\n`，同为 3 字节）因 LightningFS 同毫秒改写给出相同
 *      mtime + size，被 isomorphic-git 的索引 stat 缓存漏报。`gitApi` 改判据为
 *      **内容哈希比对** 后才与真 git 对齐。
 * 因此本模块只做「读取 gitApi 结果 → 判定语义」，不重复实现状态推导。
 *
 * ⚠️ 实现进度：M2 只实现第一章用到的 5 种 `TargetCondition`
 * （`file` / `commitCount` / `commitMessage` / `commitExists` / `workdirClean`）。
 * 其余 6 种（`branch` / `headBranch` / `tag` / `merged` / `logOrder` / `remote`）
 * **明确返回「尚未实现」且判定为未达成** —— 绝不静默当作通过（§14 禁止伪造）。
 */

import {
  log as gitLog,
  status as gitStatus,
  type CommitEntry,
  type RepoOptions,
  type StatusSummary,
} from '../../engine/gitApi';
import { fsp } from '../../engine/fs';
import type { Level, TargetCondition } from '../types';

/**
 * 单条 `TargetCondition` 的判定明细。
 *
 * `detail` 是**面向玩家的抽象提示**（§9.1：不给具体命令），例如
 * 「暂存区还有尚未提交的内容」而不是「请执行 git add .」。
 * 它既能直接渲染到 GoalPanel，也被 `stepHints` 复用为提示素材。
 */
export interface TargetResult {
  /** 被判定的原始条件，供 UI 回显与调试 */
  target: TargetCondition;
  /** 该条件是否已达成 */
  ok: boolean;
  /** 抽象描述：达成时说明「已做到什么」，未达成时说明「还差什么」 */
  detail: string;
  /**
   * 该条件是否**已实现判定逻辑**。
   * `false` 表示类型属 M4/M5，此时 `ok` 恒为 `false` —— UI 可据此区分
   * 「玩家没做到」与「本关配置了游戏尚不支持的条件」。
   */
  implemented: boolean;
}

/** `evaluateTargets()` 的返回值：聚合判定结果，可直接驱动 GoalPanel */
export interface TargetState {
  /** 全部条件均达成才为 true（§4.1：`targets` 全部满足才过关） */
  satisfied: boolean;
  /** 逐条件明细，顺序与 `level.targets` 一致 */
  results: TargetResult[];
  /** 未达成的条数，便于 UI 显示「还差 N 项」 */
  remaining: number;
}

/**
 * 目标检测所需的仓库快照。
 *
 * 由 `readTargetContext()` **一次**采集，供该关全部条件复用 ——
 * 否则每个条件各查一次 `status()` / `log()`，而 `status()` 内部逐文件调用
 * isomorphic-git（§6.2 的取舍），关卡仓库虽小也没必要重复付这个开销。
 */
export interface TargetContext {
  /** `gitApi.status()` 的结果；仓库不可读时为 null */
  status: StatusSummary | null;
  /** `gitApi.log()` 的结果（新→旧）；无提交时为空数组 */
  commits: CommitEntry[];
  /**
   * 读取工作区文件内容。仅对 `type: 'file'` 且指定了 `content` 的条件使用。
   * 这是本模块**唯一**直接读文件的地方：`file` 目标比对的是**工作区**内容，
   * 而 `gitApi` 是 git 语义的封装，没有「读任意工作区路径」的口子。
   *
   * ⚠️ **不可用它判断存在性** —— 实测：对**目录**调用 `readFile` 不抛错而是返回
   * `null`（LightningFS 的既有行为），据此会把「目录存在」误判为「不存在」。
   * 存在性一律走 `stat`（见 `pathExists`）。
   */
  readFile: (path: string) => Promise<string | null>;
  /**
   * 判断工作区路径是否存在（文件或目录皆算）。
   *
   * ⚠️ 必须用 `stat` 实现：`readFile` 对目录返回 `null` 而非抛错，无法据其区分
   * 「不存在」与「是目录」。`.git` 这类**目录**目标正是靠本方法判定的（如 1-1）。
   */
  pathExists: (path: string) => Promise<boolean>;
}

/** `status()` 失败时的抽象说明；不暴露底层错误细节给玩家 */
const STATUS_UNAVAILABLE = '无法读取仓库状态。';

/** 目录读取统一走 fs 层暴露的 `fsp`（Promise 视图），不自行 import lightning-fs */
function joinRepoPath(dir: string, path: string): string {
  const relative = path.replace(/^\/+/, '').replace(/^repo\//, '');
  return `${dir}/${relative}`;
}

/**
 * 采集一次仓库快照，供该关全部目标条件复用。
 *
 * 仓储位置默认由 `gitApi` 指向沙箱 `/repo`（测试可注入 `dir` 覆盖）。
 * 读取失败不抛异常：`status` 置 null、`commits` 置空，由各判定函数按「未达成」处理。
 */
export async function readTargetContext(options: RepoOptions = {}): Promise<TargetContext> {
  const dir = options.dir ?? '/repo';

  const statusResult = await gitStatus(options);
  const logResult = await gitLog(options);

  return {
    status: statusResult.ok ? statusResult.value : null,
    commits: logResult.ok ? logResult.value : [],
    readFile: async (path: string) => {
      try {
        // 用 Buffer 兜底：LightningFS 对目录返回 `null`（不抛错），
        // 判定函数据 `pathExists` 先行分流，此处只需保证类型是字符串。
        return (await fsp.readFile(joinRepoPath(dir, path), 'utf8')) ?? null;
      } catch {
        // 文件不存在（LightningFS 抛 ENOENT）即视为「无内容」，交由判定函数描述
        return null;
      }
    },
    pathExists: async (path: string) => {
      try {
        await fsp.stat(joinRepoPath(dir, path));
        return true;
      } catch {
        // ENOENT：路径不存在（文件与目录皆适用）
        return false;
      }
    },
  };
}

/** 「工作区干净」判据：暂存 / 未暂存 / 未追踪三者皆空 */
function isWorkdirClean(status: StatusSummary): boolean {
  return status.staged.length === 0 && status.unstaged.length === 0 && status.untracked.length === 0;
}

/** 把「还差什么」说得具体些，但不给命令：优先点名文件，其次给数量 */
function describePendingChanges(status: StatusSummary): string {
  const pending = [...status.staged, ...status.unstaged, ...status.untracked];
  const paths = [...new Set(pending.map((entry) => entry.path))];

  if (paths.length === 1) return `工作区里还有未归档的内容：${paths[0]}`;
  if (paths.length > 1) return `工作区里还有 ${paths.length} 个文件未归档：${paths.join('、')}`;
  return '工作区里还有未归档的内容。';
}

/** 单条 `commitCount` 的判定（`gte`：至少 N 个；`eq`：恰好 N 个） */
function judgeCommitCount(target: Extract<TargetCondition, { type: 'commitCount' }>, commits: CommitEntry[]): boolean {
  return target.op === 'gte' ? commits.length >= target.value : commits.length === target.value;
}

/** 单条 `commitCount` 的抽象说明 */
function describeCommitCount(
  target: Extract<TargetCondition, { type: 'commitCount' }>,
  commits: CommitEntry[],
): string {
  const actual = commits.length;
  if (target.op === 'gte') {
    return actual >= target.value
      ? `已有 ${actual} 次快照，达到「至少 ${target.value} 次」的要求。`
      : `目前只有 ${actual} 次快照，还需要至少 ${target.value - actual} 次归档。`;
  }
  if (actual === target.value) return `快照数量正好是 ${target.value} 次。`;
  if (actual < target.value) return `目前只有 ${actual} 次快照，还需要 ${target.value - actual} 次归档。`;
  return `目前有 ${actual} 次快照，比要求的 ${target.value} 次多出 ${actual - target.value} 次。`;
}

/**
 * 判定单条目标条件。
 *
 * @param target  目标条件（§4.3 的判别联合）
 * @param context 由 `readTargetContext()` 采集的仓库快照
 */
export async function evaluateTarget(
  target: TargetCondition,
  context: TargetContext,
): Promise<TargetResult> {
  switch (target.type) {
    // --- file：文件（或目录）存在 / 工作区内容匹配 ---
    case 'file': {
      // ⚠️ 存在性走 `pathExists`（stat）而非 `readFile`：
      //    实测 `readFile` 对**目录**返回 null 而不抛错，若据其判存在，
      //    `.git` 这类目录目标会被误判为「不存在」—— 1-1 的首个目标正是 `.git`。
      const exists = await context.pathExists(target.path);

      if (!target.exists) {
        return {
          target,
          ok: !exists,
          implemented: true,
          detail: exists ? `${target.path} 仍存在于工作区。` : `${target.path} 已从工作区移除。`,
        };
      }

      if (!exists) {
        return {
          target,
          ok: false,
          implemented: true,
          detail: `工作区里找不到 ${target.path}。`,
        };
      }

      // 未指定 content 时只判存在性（目录目标也只能这样判）
      if (target.content === undefined) {
        return { target, ok: true, implemented: true, detail: `${target.path} 已就位。` };
      }

      const content = await context.readFile(target.path);
      if (content === null) {
        // 路径存在但读不出内容 —— 典型情形是指定了 content 却指向目录
        return {
          target,
          ok: false,
          implemented: true,
          detail: `${target.path} 不是可读取的文本文件，无法比对内容。`,
        };
      }

      // ⚠️ 行尾差异（CRLF / LF）不算内容不符 —— 否则 Windows 上「明明改对了却过不了关」。
      //    大小写与空白则严格比对：它们属于真实的内容差异。
      const normalize = (text: string) => text.replace(/\r\n/g, '\n');
      const ok = normalize(content) === normalize(target.content);
      return {
        target,
        ok,
        implemented: true,
        detail: ok ? `${target.path} 的内容与预期一致。` : `${target.path} 的内容与预期不一致。`,
      };
    }

    // --- commitCount：提交数量 ---
    case 'commitCount': {
      const ok = judgeCommitCount(target, context.commits);
      return { target, ok, implemented: true, detail: describeCommitCount(target, context.commits) };
    }

    // --- commitMessage：最近一次提交信息（正则匹配） ---
    case 'commitMessage': {
      const latest = context.commits[0];
      if (!latest) {
        return {
          target,
          ok: false,
          implemented: true,
          detail: '时间线上还没有任何快照，先去归档一次改动。',
        };
      }

      // 正则带 `g` / `y` 时 `lastIndex` 会在多次 `test()` 间残留，导致同一输入时真时假。
      // 目标数据里写 `/.../g` 很容易发生，故此处统一重新构造一个无状态的正则。
      const pattern = new RegExp(target.match.source, target.match.flags.replace(/[gy]/g, ''));
      const ok = pattern.test(latest.message);
      return {
        target,
        ok,
        implemented: true,
        detail: ok
          ? `最近一次快照的信息符合要求：「${latest.message.split('\n')[0]}」。`
          : '最近一次快照的信息不符合要求，检查一下归档时写下的说明。',
      };
    }

    // --- commitExists：历史中存在特定提交 ---
    case 'commitExists': {
      // 采用**子串包含**而非全等匹配。理由：
      //   1. 提交信息通常长于目标给出的关键词（「第一环：链条起点」vs 目标里的「第一环」），
      //      全等匹配会让玩家「归档成功却过不了关」，且提示无法解释差在哪；
      //   2. 该字段的类型是 `string`（而 `commitMessage` 用 `RegExp`）—— 需要精确匹配时，
      //      关卡作者本就有 `commitMessage` 这条更合适的判据；
      //   3. 与真 git 的直觉一致：`git log --grep <词>` 做的正是子串搜索。
      const expected = target.message.trim();
      const found = context.commits.some((commit) => commit.message.includes(expected));
      return {
        target,
        ok: found,
        implemented: true,
        detail: found
          ? `时间线上已有包含「${expected}」的快照记录。`
          : `时间线上找不到包含「${expected}」的快照记录。`,
      };
    }

    // --- workdirClean：工作区是否干净 ---
    case 'workdirClean': {
      if (!context.status) {
        return { target, ok: false, implemented: true, detail: STATUS_UNAVAILABLE };
      }

      const clean = isWorkdirClean(context.status);
      if (target.value) {
        return {
          target,
          ok: clean,
          implemented: true,
          detail: clean ? '工作区很干净，没有待处理的改动。' : describePendingChanges(context.status),
        };
      }
      // `value: false` —— 要求「有未归档内容」，用于「先制造改动」这类目标
      return {
        target,
        ok: !clean,
        implemented: true,
        detail: clean ? '工作区很干净，但这一步需要先制造一些改动。' : '工作区里确实还有未归档的内容。',
      };
    }

    // --- 以下 6 种属 M4/M5，明确报「尚未实现」，不静默通过（§14） ---
    case 'branch':
    case 'headBranch':
    case 'tag':
    case 'merged':
    case 'logOrder':
    case 'remote':
      return {
        target,
        ok: false,
        implemented: false,
        detail: `目标类型 "${target.type}" 尚未实现（属 M4/M5），本关无法据此判定。`,
      };

    default: {
      // 穷尽性检查：新增 TargetCondition 类型时，此处会编译报错，避免判据静默缺失
      const exhaustive: never = target;
      return {
        target: exhaustive,
        ok: false,
        implemented: false,
        detail: '未知的目标类型，尚未实现。',
      };
    }
  }
}

/**
 * `evaluateTargets()` 接受的两种入参：关卡对象本身，或其 `targets` 数组。
 *
 * 两种都收是刻意的：调用方常只持有 `targets`（如 UI 的 hook 只订阅了目标列表），
 * 强制它们先包一层 `{ targets }` 是没有收益的噪声。判定只依赖 `targets`，
 * 不存在「传 Level 会多做点什么」的歧义。
 */
export type TargetsInput = Pick<Level, 'targets'> | readonly TargetCondition[];

/** 归一化入参：数组即目标清单，对象则取其 `targets` */
function toTargets(input: TargetsInput): readonly TargetCondition[] {
  return Array.isArray(input) ? (input as readonly TargetCondition[]) : (input as Pick<Level, 'targets'>).targets;
}

/**
 * 判定一关的全部目标条件（§4.1：全部满足才过关）。
 *
 * @param input   关卡定义，或其 `targets` 数组
 * @param options 可选的仓库位置覆盖（默认 `/repo`，测试可注入）
 *
 * @example
 * ```ts
 * const state = await evaluateTargets(level);
 * if (state.satisfied) goLevelComplete();
 * ```
 */
export async function evaluateTargets(
  input: TargetsInput,
  options: RepoOptions = {},
): Promise<TargetState> {
  const context = await readTargetContext(options);
  // 逐条串行：读文件本身是 IO，但条件数极少（每关 2~4 条），
  // 串行换来的确定性（`readFile` 的调用顺序稳定）比并发收益更值。
  const results: TargetResult[] = [];
  for (const target of toTargets(input)) {
    results.push(await evaluateTarget(target, context));
  }

  // `implemented: false` 的条件 `ok` 恒为 false，故不会意外满足
  const remaining = results.filter((result) => !result.ok).length;
  return { satisfied: remaining === 0, results, remaining };
}

/** 便捷包装：只要「是否过关」 */
export async function isLevelComplete(
  input: TargetsInput,
  options: RepoOptions = {},
): Promise<boolean> {
  const state = await evaluateTargets(input, options);
  return state.satisfied;
}

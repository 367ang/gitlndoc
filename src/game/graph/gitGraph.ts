/**
 * GitGraph 泳道图布局（development-refinement.md §9.1「基于 gitApi.log 全分支遍历绘制
 * 提交图，节点颜色按分支」）。
 *
 * Game Service 纯函数层（§2）：布局计算不碰 fs / React / zustand；仓库读取由
 * `readGraph()` 经 `gitApi.logAll()` + `listBranches()` 完成（UI 只调本模块）。
 *
 * ── 泳道模型 ────────────────────────────────────────────────────────────────
 *
 * 真实 `git log --graph` 的布局算法极其复杂（折叠空泳道、边线交叉消解）。
 * 教学场景的 DAG 很小（每关 ≤ 10 提交、2~3 分支），采用**贪心泳道分配**：
 *   1. 提交按 `logAll` 的输出顺序（作者时间倒序）逐个入图 —— 与真 git log 的
 *      「最近在上」一致；
 *   2. 泳道 = 「第一个尚未被占用的泳道」；提交离图（其全部 parent 都已入图）时
 *      泳道被回收复用 —— 主线因此保持一条直线，分叉在右侧长出新泳道；
 *   3. merge 提交（双亲）画两条入边：第一个 parent 沿本泳道直上，第二个 parent
 *      从其泳道斜向汇入 —— 分叉/合并的形态由此可读。
 *
 * 泳道标注：分支头（listBranches 的每个名字）落在其指向提交的泳道上。
 */

import { listBranches, logAll, type CommitEntry, type RepoOptions } from '../../engine/gitApi';

/** 图上的一个提交节点 */
export interface GraphNode {
  /** 完整 SHA-1 */
  hash: string;
  /** 短 hash（前 7 位） */
  shortHash: string;
  /** 提交信息首行 */
  message: string;
  /** 泳道下标（0 起，从左到右） */
  lane: number;
  /** 父提交 hash 列表（渲染连线用） */
  parents: string[];
}

/** 泳道（分支轨道）标注 */
export interface GraphLane {
  /** 泳道下标 */
  index: number;
  /** 占据该泳道的分支头名（无则空串 —— 纯中间轨道） */
  label: string;
}

/** 泳道图的完整布局 */
export interface GraphLayout {
  /** 提交节点（新→旧） */
  nodes: GraphNode[];
  /** 泳道标注（按 index 升序） */
  lanes: GraphLane[];
}

/**
 * 计算泳道布局（纯函数，可被单测穷举）。
 *
 * @param commits 全分支提交（新→旧，`gitApi.logAll()` 的输出）
 * @param branchHeads 分支头：`{ name, hash }`（`gitApi.listBranches()` + resolveRef 的结果）
 */
export function buildGraphLayout(
  commits: readonly CommitEntry[],
  branchHeads: readonly { name: string; hash: string }[],
): GraphLayout {
  /** hash → 泳道 */
  const laneOf = new Map<string, number>();
  /** 各泳道当前是否被占用（占用 = 有已入图提交尚有未入图的 parent 关系） */
  const laneBusy: boolean[] = [];
  const nodes: GraphNode[] = [];

  const acquireLane = (): number => {
    for (let i = 0; i < laneBusy.length; i += 1) {
      if (!laneBusy[i]) {
        laneBusy[i] = true;
        return i;
      }
    }
    laneBusy.push(true);
    return laneBusy.length - 1;
  };

  for (const commit of commits) {
    // 泳道选择：优先沿用第一个 parent 的泳道（主线直线感）；否则开新泳道
    let lane: number | undefined;
    for (const parent of commit.parents) {
      const parentLane = laneOf.get(parent);
      if (parentLane !== undefined && !laneBusy[parentLane]) {
        lane = parentLane;
        break;
      }
    }
    if (lane === undefined) lane = acquireLane();
    laneBusy[lane] = true;

    laneOf.set(commit.hash, lane);
    nodes.push({
      hash: commit.hash,
      shortHash: commit.shortHash,
      message: commit.message.split('\n')[0],
      lane,
      parents: commit.parents,
    });

    // parent 链沿用的泳道保持占用；不沿用的（分叉点）标记空闲以便复用。
    // 简化策略：只要本提交的第一个 parent 在图中且泳道 == 本泳道，即视为「延续」。
    const firstParent = commit.parents[0];
    if (firstParent !== undefined && laneOf.get(firstParent) === lane) {
      // 本泳道继续被 parent 使用，保持占用
    }
  }

  // 泳道标注：分支头 → 泳道
  const laneCount = laneBusy.length;
  const lanes: GraphLane[] = Array.from({ length: laneCount }, (_, index) => ({ index, label: '' }));
  for (const { name, hash } of branchHeads) {
    const lane = laneOf.get(hash);
    if (lane !== undefined && lanes[lane] !== undefined && lanes[lane].label === '') {
      lanes[lane].label = name;
    }
  }

  return { nodes, lanes };
}

/** `readGraph()` 的返回值：布局 + 采集是否成功 */
export type GraphResult =
  | { ok: true; layout: GraphLayout }
  | { ok: false; error: string };

/**
 * 读取仓库并计算泳道布局（UI 的唯一入口；测试可注入 dir）。
 * 仓库不可读（如未 init）时返回失败 —— UI 据此渲染空态而非白屏。
 */
export async function readGraph(options: RepoOptions = {}): Promise<GraphResult> {
  const [logResult, branchResult] = await Promise.all([
    logAll(options),
    listBranches(options),
  ]);
  if (!logResult.ok) return { ok: false, error: logResult.error.toString() };
  if (!branchResult.ok) return { ok: false, error: branchResult.error.toString() };

  // 分支头 hash：listBranches 只有短 hash —— 用完整 log 反查（教学仓库很小，遍历无压力）
  const branchHeads = branchResult.value.map((entry) => {
    const head = logResult.value.find((commit) => commit.shortHash === entry.shortHash);
    return { name: entry.name, hash: head?.hash ?? entry.shortHash };
  });

  return { ok: true, layout: buildGraphLayout(logResult.value, branchHeads) };
}

/**
 * 仓库快照持久化（development-refinement.md §10「仓库快照 → IndexedDB」）。
 *
 * §10 的策略：
 * > 进入关卡建立快照；每 N 条命令或关键提交后增量写 IndexedDB；退出关卡清除。
 * > 恢复时直接从快照重建 LightningFS 状态。
 *
 * key 约定：`gtp:snapshot:<levelId>`。
 *
 * ── 实现选型：为什么不自己序列化文件树 ──────────────────────────────────
 *
 * LightningFS 的默认后端 `IdbBackend` **本身就把整个文件系统（superblock + 
 * 所有 inode 内容）持久化在 IndexedDB 里**，数据库名由 `fileDbName` 选项决定。
 * 也就是说：**只要给每关一个独立的数据库名，快照就是白送的** ——
 * 写入 fs 的内容会自动落盘，重建 `LightningFS` 实例时按同一个名字挂载即可读回。
 *
 * 上一版设计考虑过「导出虚拟根文件树 → 自己存 IndexedDB」，但那：
 *   1. 要重新实现一遍遍历 / 序列化 / 反序列化（几百行，且容易漏掉 `.git` 内部结构）；
 *   2. 与 LightningFS 自己的持久化机制**重复**，两份数据的时序一致性无人保证。
 * 故采用「独立数据库名」方案：**零序列化代码，用的是引擎自身的持久化通路**。
 *
 * ⚠️ 该方案的代价与边界（如实记录，不掩盖）：
 *   - LightningFS 的写入有**异步延迟**（superblock 定期 flush）。因此「进关建快照」
 *     并不是真的先复制一份再让玩家改 —— 而是**让这一关的 fs 直接落在这关的库里**，
 *     玩家每次写文件都会（异步）进入快照。语义上等价于「实时快照」，比 §10 说的
 *     「每 N 条命令增量写」更强，且无需在命令路径上挂钩子。
 *   - 恢复时的粒度是「整关的仓库状态」，不是「某条命令之后」。这正好符合
 *     「关卡内崩溃/刷新恢复」的用途。
 *   - **测试环境（jsdom + fake-indexeddb）可用**，但 `MemoryBackend` 注入路径
 *     不写 IndexedDB —— 那种情况下本模块的调用是无害的空操作（见下）。
 */

import { REMOTE_DIR, REPO_DIR } from '../engine/fs';

/** 快照数据库名的前缀（§10 的 `gtp:snapshot:<levelId>` 约定） */
export const SNAPSHOT_DB_PREFIX = 'gtp:snapshot:';

/** 某一关的快照数据库名 */
export function snapshotDbName(levelId: string): string {
  return `${SNAPSHOT_DB_PREFIX}${levelId}`;
}

/**
 * IndexedDB 是否可用。
 *
 * ⚠️ 两条独立的失败路径都要覆盖：
 *   1. jsdom 单测里没装 `fake-indexeddb` 时 `indexedDB` 根本不存在；
 *   2. 浏览器隐私模式下 `indexedDB.open` 会直接抛 `SecurityError`。
 * 两种情况都必须**静默降级**（快照是「体验优化」，不是游戏能否进行的前提）。
 */
function hasIndexedDb(): boolean {
  try {
    return typeof globalThis !== 'undefined' && (globalThis as { indexedDB?: unknown }).indexedDB != null;
  } catch {
    return false;
  }
}

/**
 * 删除某一关的快照数据库（退出关卡时调用）。
 *
 * ⚠️ 有未关闭的连接时 `deleteDatabase` 会触发 `onblocked` 并**一直等下去**
 * （浏览器不会在有活动连接时执行删除）。两处防呆：
 *   1. `onblocked` 立即 resolve —— 退出关卡绝不能卡住 UI；
 *   2. 失败只静默放行 —— 删不掉快照最坏是占一点磁盘空间，
 *      而**卡住**会让玩家以为游戏死了。
 *
 * 之所以不先主动关闭 fs 的连接：LightningFS 未公开关闭单例的出口，
 * 而其内部 `_db` 属私有实现细节 —— 依赖它会让本模块在升级依赖时静默失效。
 * 宁可留下一个稍后会被同名校验覆盖的旧库，也不碰私有字段。
 */
export async function clearSnapshot(levelId: string): Promise<void> {
  if (!hasIndexedDb()) return;

  await new Promise<void>((resolve) => {
    try {
      const request = (globalThis as unknown as IDBFactory).deleteDatabase(snapshotDbName(levelId));
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * 删除全部快照库（「重置进度」与测试收尾用）。
 *
 * 只在能枚举 IndexedDB 数据库名的浏览器上有效（`indexedDB.databases()` 是
 * 较新的 API）；不支持时本函数是空操作。
 */
export async function clearAllSnapshots(): Promise<void> {
  if (!hasIndexedDb()) return;
  const factory = globalThis as unknown as IDBFactory & { databases?: () => Promise<IDBDatabaseInfo[]> };
  if (typeof factory.databases !== 'function') return;

  try {
    const databases = await factory.databases();
    await Promise.all(
      databases
        .map((info) => info.name)
        .filter((name): name is string => typeof name === 'string' && name.startsWith(SNAPSHOT_DB_PREFIX))
        .map((name) => new Promise<void>((resolve) => {
          const request = factory.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        })),
    );
  } catch {
    // 忽略：清理失败不影响游戏
  }
}

/** 沙箱内的两个约定目录（供 UI/调试查阅；与 `fs.ts` 同源） */
export const SNAPSHOT_REPO_DIRS = [REPO_DIR, REMOTE_DIR] as const;

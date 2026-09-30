/**
 * 仓库快照持久化（development-refinement.md §10「仓库快照 → IndexedDB」）。
 *
 * §10 的策略：
 * > 进入关卡建立快照；每 N 条命令或关键提交后增量写 IndexedDB；退出关卡清除。
 * > 恢复时直接从快照重建 LightningFS 状态。
 *
 * key 约定：`gtp:snapshots:v1`（单个 IndexedDB 库）内按 `levelId` 存取。
 *
 * ── 实现选型：显式导出/导入，而不是「每关一个 LightningFS 实例」──────────
 *
 * 本文件的第一版走的是「给每关一个独立数据库名（`gtp:snapshot:<levelId>`），
 * 靠 LightningFS 自身的 IndexedDB 持久化当快照，进关时 `mountFs` 切换实例」——
 * **该方案已被实测否决并移除**。原因（详见 docs/milestones/M5-tasks.md
 * 「执行结果 · 实测环境事实」第 13 条）：
 *
 *   LightningFS 的 `_activate()` 是**逐操作惰性异步**的（读 IndexedDB superblock +
 *   申请 `navigator.locks`），在切换出的新实例上发起的第一串写操作会**静默丢失**：
 *   `git.init` 返回成功但 `/repo/.git` 不存在、后续 `mkdir` 报 `ENOENT`；
 *   任何「等待/先做一次读」的同步点都无法可靠消除该竞态。而引擎层 M1~M5 的
 *   全部已验证语义都建立在「单一稳定 fs 实例」之上 —— 换实例等于推翻地基。
 *
 * 现行方案：**fs 单例保持不动**，快照由本模块**显式导出/导入**：
 *   - 导出 = 用 `fsp` 走一遍虚拟根，把目录树 + 文件内容序列化成一条 IndexedDB 记录；
 *   - 导入 = 清空虚拟根，把记录原样写回。
 * 数据通路全部在本模块内，行为确定、可用单测覆盖（MemoryBackend + fake-indexeddb）。
 *
 * ── 快照的时机 ──────────────────────────────────────────────────────────
 *
 *   - **进关预置完成后**（`startLevel`）：把 `LevelInit` 建出的初始仓库固化；
 *   - **每条命令执行后**（LevelScreen）：玩家操作增量固化（仓库很小，全量导出
 *     只是一次几十个文件的遍历，比「增量 diff」更简单也更不易错 —— §14 不做投机优化）；
 *   - **离开关卡时清除**（`leaveLevel`）：§10「退出关卡清除」。
 *
 * ⚠️ 与 LightningFS 自身持久化（`gitlndoc-fs` 库）的关系：那份数据仍在写
 * （LightningFS 的固有行为），但**不再是恢复的依据** —— 本模块的快照才是
 * 唯一事实来源，避免两份持久化互相矛盾（第一版的教训）。
 */

import { fsp } from '../engine/fs';
import { clearSandboxRoot } from '../engine/fs';

/** 快照 IndexedDB 库与对象仓库（单个库，按 levelId 存取） */
export const SNAPSHOT_DB_NAME = 'gtp:snapshots:v1';
export const SNAPSHOT_STORE = 'snapshots';

/** 快照记录的格式版本（结构变更时递增，读取侧据此拒绝旧格式而非猜） */
const SNAPSHOT_VERSION = 1;

/** 树中的一个节点：目录，或带二进制内容的文件 */
export type SnapshotEntry = { type: 'dir' } | { type: 'file'; data: Uint8Array };

/** 一份完整快照：路径（绝对，`/repo/...`）→ 节点 */
export interface SnapshotRecord {
  version: number;
  savedAt: number;
  /** ⚠️ 键按字典序排列后**父目录必然先于子目录**（`/repo` 是 `/repo/notes` 的前缀），
   *  恢复时按此顺序 mkdir 即无需递归创建。 */
  files: Record<string, SnapshotEntry>;
}

/**
 * 「本会话正在哪一关」（M5a，刷新后自动恢复的关键一环）。
 *
 * ⚠️ 为什么需要它：仓库快照只覆盖**仓库内容**，不包含「玩家此刻在哪个关卡」。
 * 刷新时若只恢复仓库而不知道该回哪一关，就只能退回菜单 —— 那就不是
 * 「自动恢复中途进度」。存 localStorage（§10 的 `gtp:` 前缀体系），单键、极小 JSON。
 */
export const ACTIVE_LEVEL_KEY = 'gtp:active-level:v1';

/** 挂起（可恢复）的关卡会话 */
export interface ActiveLevelSnapshot {
  /** 关卡 id，形如 `ch5-1` */
  levelId: string;
}

/**
 * 读取「本会话正在哪一关」。
 *
 * 容错与 `progress.ts` 一致：数据损坏 / storage 不可用都返回 null（不抛），
 * 让 boot 退回「进菜单」这条保守路径。
 */
export function loadActiveLevel(): ActiveLevelSnapshot | null {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(ACTIVE_LEVEL_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.levelId !== 'string' || record.levelId.length === 0) return null;
    return { levelId: record.levelId };
  } catch {
    return null;
  }
}

/** 记下「正在哪一关」（进关时调用）。写失败静默忽略（storage 不可用） */
export function saveActiveLevel(levelId: string): void {
  try {
    const payload: ActiveLevelSnapshot = { levelId };
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(
      ACTIVE_LEVEL_KEY,
      JSON.stringify(payload),
    );
  } catch {
    // 忽略：没记下最多是刷新后回菜单，不影响游玩
  }
}

/** 清掉「正在哪一关」（通关 / 离开关卡时调用） */
export function clearActiveLevel(): void {
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.removeItem(ACTIVE_LEVEL_KEY);
  } catch {
    // 忽略
  }
}

// ── IndexedDB 基础设施 ──────────────────────────────────────────────────────

/**
 * 打开快照库（版本 1，含对象仓库创建）。
 *
 * ⚠️ 必须经 `globalThis.indexedDB` 取工厂再调 `.open`，**不能**把 `globalThis`
 * 直接断言成 `IDBFactory` 去调 `.open` —— 那实际调用的是 **window.open**
 * （打开浏览器窗口的那个），返回 undefined（实测踩到）。
 */
function openSnapshotDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!factory || typeof factory.open !== 'function') {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(SNAPSHOT_DB_NAME, 1);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (!request) {
      // 部分垫片实现可能返回 undefined（见 tryOpenSnapshot 时期的实测记录）
      reject(new Error('indexedDB.open returned undefined'));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
    request.onblocked = () => reject(new Error('indexedDB open blocked'));
  });
}

/** 在一个事务里对快照仓库做单次读写 */
async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openSnapshotDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(SNAPSHOT_STORE, mode);
      const request = action(tx.objectStore(SNAPSHOT_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'));
    });
  } finally {
    try {
      db.close();
    } catch {
      // 关闭失败不影响结果
    }
  }
}

// ── 导出 / 导入 ────────────────────────────────────────────────────────────

/** 递归收集 `dir` 子树的全部节点（含目录条目本身） */
async function walkTree(dir: string, files: Record<string, SnapshotEntry>): Promise<void> {
  const entries = await fsp.readdir(dir);
  for (const name of entries) {
    const path = dir === '/' ? `/${name}` : `${dir}/${name}`;
    // ⚠️ 存在性必须用 `stat`：LightningFS 对目录 `readFile` 返回 null 而非抛错
    //    （M1 实测环境事实第 4 条），不能靠 readFile 失败来区分文件与目录。
    const stat = await fsp.stat(path);
    if (stat.isDirectory()) {
      files[path] = { type: 'dir' };
      await walkTree(path, files);
    } else {
      // 不带 encoding：拿到 Uint8Array（.git 内部对象是二进制，不能按文本处理）
      files[path] = { type: 'file', data: await fsp.readFile(path) };
    }
  }
}

/**
 * 把当前虚拟根（`/repo` + `/remote.git`）导出为 `levelId` 的快照。
 *
 * 调用时机见文件头「快照的时机」。任何 IO 异常都向上抛 ——
 * 调用方（进关/命令路径）据此决定是否提示；**不静默吞掉**，因为
 * 「以为存上了其实没存」比「明确失败」更糟（§14 禁止伪造）。
 */
export async function exportSnapshot(levelId: string): Promise<void> {
  const files: Record<string, SnapshotEntry> = {};
  await walkTree('/', files);

  const record: SnapshotRecord = {
    version: SNAPSHOT_VERSION,
    savedAt: Date.now(),
    files,
  };
  await withStore('readwrite', (store) => store.put(record, levelId));
}

/**
 * 从 `levelId` 的快照恢复虚拟根。
 *
 * @returns 是否恢复成功。无快照 / 格式版本不符 / 快照为空 都返回 false
 *          （调用方降级为「进菜单」），**不抛异常** —— 恢复失败是可预期路径。
 */
export async function importSnapshot(levelId: string): Promise<boolean> {
  let record: SnapshotRecord | undefined;
  try {
    record = await withStore<SnapshotRecord | undefined>('readonly', (store) =>
      store.get(levelId),
    );
  } catch {
    return false;
  }
  if (!record || record.version !== SNAPSHOT_VERSION) return false;
  const paths = Object.keys(record.files);
  if (paths.length === 0) return false;

  // 清空虚拟根后按「父先于子」的顺序重建（见 SnapshotRecord.files 的键序说明）
  await clearSandboxRoot();
  for (const path of paths) {
    if (record.files[path].type === 'dir') {
      await fsp.mkdir(path, { mode: 0o777 });
    }
  }
  for (const path of paths) {
    const entry = record.files[path];
    if (entry.type === 'file') {
      await fsp.writeFile(path, entry.data);
    }
  }
  return true;
}

/** 该关是否已有可恢复的快照（`resumeLevel` 的前置校验） */
export async function hasSnapshot(levelId: string): Promise<boolean> {
  try {
    const record = await withStore<SnapshotRecord | undefined>('readonly', (store) =>
      store.get(levelId),
    );
    if (!record || record.version !== SNAPSHOT_VERSION) return false;
    return Object.keys(record.files).length > 0;
  } catch {
    return false;
  }
}

/**
 * 删除某一关的快照（退出关卡时调用）。
 *
 * 失败静默忽略：删不掉最坏是占一点空间 + 下次刷新会恢复到这个已离开的关卡 ——
 * 但「挂起标记」（`clearActiveLevel`）总是先被清掉，恢复分支查不到标记就不会走快照。
 */
export async function clearSnapshot(levelId: string): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(levelId));
  } catch {
    // 忽略：清理失败不影响游戏
  }
}

/** 删除全部快照（「重置进度」与冒烟脚本的 resetStorage 用） */
export async function clearAllSnapshots(): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.clear());
  } catch {
    // 忽略
  }
}

/** 沙箱内的两个约定目录（供 UI/调试查阅；与 `fs.ts` 同源） */
export const SNAPSHOT_REPO_DIRS = ['/repo', '/remote.git'] as const;

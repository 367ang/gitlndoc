/**
 * LightningFS 沙箱单例（development-refinement.md §6.1）。
 *
 * 全局唯一 `fs`，挂载于虚拟根目录 `/`，沙箱内目录约定：
 *   - `/repo`        玩家操作的主仓库
 *   - `/remote.git`  「远程宇宙」的裸仓库（第四章远程关卡使用）
 *
 * ⚠️ 后端注入是这块的关键（见 TODO/M1-preflight-DONE.md §3.2）：
 * LightningFS 默认的存储是 `IdbBackend`，依赖浏览器的 `indexedDB`，
 * **在纯 Node / jsdom 环境会抛 `ReferenceError: indexedDB is not defined`** —— 这是预期行为。
 * 因此这里把存储做成可注入项：浏览器走默认 IdbBackend，测试注入 `MemoryBackend`，
 * 从而让 Vitest 无需 `indexedDB` polyfill 就能跑真实 git 操作。
 *
 * ⚠️ lightning-fs 有**两层**选项，名字不同、契约也不同，极易混淆：
 *
 * | 层级 | 选项名 | 源码 | 接受的接口 |
 * |---|---|---|---|
 * | `PromisifiedFS`（顶层） | `backend` | `PromisifiedFS.js:106` → `options.backend \|\| new DefaultBackend()` | 完整 FS 后端（需 `mkdir`/`stat`/`readdir`/`readFile`…） |
 * | `DefaultBackend`（内层） | `db` | `DefaultBackend.js:32` → `db \|\| new IdbBackend(...)` | `FS.IDB`（`saveSuperblock`/`loadSuperblock`/`readFile`/`writeFile`/`unlink`/`wipe`/`close`） |
 *
 * `MemoryBackend` 的方法集恰好是 **`FS.IDB`**（即内层 `db` 的契约），它**不是**顶层后端接口。
 * 所以：
 *   - 顶层 `PromisifiedFS` 其实从不读 `db`，但它会把整个 `options` 原样传给
 *     `DefaultBackend.init(name, options)`，于是 `{ db }` 被内层解构到 `db` 上 —— **恰好生效**；
 *   - 反过来传 `{ backend: new MemoryBackend() }` 会让顶层直接把 `MemoryBackend` 当成
 *     文件系统后端，随后报 `this._backend.mkdir is not a function`（实测确认）。
 * 结论：本模块**有意**把对外选项 `backend` 透传为运行时的 `db`，走内层的 `FS.IDB` 路径。
 * 因此 T6 必须走 `configureFs({ backend })`，而不是自行 `new LightningFS` 或改用 `backend` 键。
 *
 * ⚠️ 另有一处独立于上述选项的坑：`DefaultBackend.js:33` 的
 * `navigator.locks ? new Mutex2(name) : new Mutex(lockDbName, ...)` 表明**锁后端恒为 `IdbBackend`**
 * （`db` 只作用于文件后端，管不到锁），无官方出口。jsdom 下 `navigator` 存在但 `navigator.locks`
 * 为 `undefined`，会走 `new Mutex(...)` → `idb-keyval` → 仍需 `indexedDB`。
 */

import LightningFS from '@isomorphic-git/lightning-fs';

/** 沙箱内主仓库路径 */
export const REPO_DIR = '/repo';
/** 沙箱内「远程宇宙」裸仓库路径 */
export const REMOTE_DIR = '/remote.git';

/**
 * LightningFS 实例类型，即包的默认导出。
 * 该包通过 `export =` 声明类型，ESM 下无法 `import type { FS }`，故用 `InstanceType` 反推。
 */
export type LightningFs = InstanceType<typeof LightningFS>;

/**
 * 内层 `DefaultBackend` 的 `db` 参数契约，即包内的 `FS.IDB`。
 *
 * 名字刻意不叫 `Backend`：它**不是**顶层 `PromisifiedFS` 的 `backend` 选项
 * （那个要的是带 `mkdir`/`stat`/`readdir` 的完整文件系统）。`MemoryBackend` 实现的正是本接口。
 *
 * 同样因 `export =` 无法直接引用包内命名空间类型，这里按结构重新声明；
 * `loadSuperblock` 的返回值放宽为 `FsSuperblock | null`，以免与包内的 `SuperBlock`（`Map`）耦合。
 */
export interface FsIdb {
  saveSuperblock(superblock: FsSuperblock): void | Promise<void>;
  loadSuperblock(): FsSuperblock | null | Promise<FsSuperblock | null>;
  readFile(inode: number): Uint8Array | Promise<Uint8Array>;
  writeFile(inode: number, data: Uint8Array): void | Promise<void>;
  wipe(): void | Promise<void>;
  close(): void | Promise<void>;
}

/**
 * 旧名保留，避免破坏可能已引用它的下游。
 * @deprecated 请改用 `FsIdb` —— 本类型描述的是内层 `db` 契约，不是顶层 `backend`。
 */
export type FsBackend = FsIdb;

/** 序列化后的目录树，由内层 `db` 负责持久化 */
export type FsSuperblock = { get(key: string | number): unknown; set(key: string | number, value: unknown): unknown };

export interface CreateFsOptions {
  /** 数据库名，用于区分不同的文件系统实例 */
  name?: string;
  /**
   * 自定义存储后端（`FS.IDB` 契约，如 `MemoryBackend`）。
   *
   * ⚠️ 对外叫 `backend`，但最终是作为 **`db`** 传给 `new LightningFS()` 的 —— 见文件头「两层选项」说明。
   * 不传则由 LightningFS 使用默认的 `IdbBackend`。
   */
  backend?: FsIdb;
  /** 是否清空已有数据后重建 */
  wipe?: boolean;
}

/** 浏览器环境下的默认数据库名 */
export const DEFAULT_DB_NAME = 'gitlndoc-fs';

/** Promise 化的 fs 客户端，即 `fs.promises` */
export type FsPromises = LightningFs['promises'];

/**
 * 创建一个 LightningFS 实例。
 *
 * 对外的 `backend` 在此被**有意**改名为 `db` 再交给 LightningFS：
 * `MemoryBackend` 实现的是内层 `FS.IDB` 契约，必须经 `DefaultBackend` 的 `db` 生效；
 * 若照顶层选项名传 `{ backend }`，顶层会把 `MemoryBackend` 当成完整文件系统后端而报
 * `this._backend.mkdir is not a function`。详见文件头「两层选项」表。
 *
 * 因包自带 `index.d.ts` 只声明了顶层选项、未声明 `db`，此处需要一次类型断言。
 *
 * ⚠️ 注意构造即初始化：`new LightningFS(name, opts)` 会立刻调用 `init(name, opts)`，
 * 并在未传 `defer` 时**不等 await** 就触发一次 `stat('/')`。因此**绝不可**在模块顶层
 * 用默认后端构造实例 —— Node / jsdom 下那次异步 `stat('/')` 会以
 * `ReferenceError: indexedDB is not defined` 的形式变成未捕获异常。
 * 单例因此改由 `getFs()` 惰性创建，见下。
 *
 * @example 测试环境注入内存后端（无需 indexedDB polyfill）
 * ```ts
 * import { MemoryBackend } from '@isomorphic-git/lightning-fs';
 * const testFs = createFs({ name: 'test-fs', backend: new MemoryBackend() });
 * ```
 */
export function createFs(options: CreateFsOptions = {}): LightningFs {
  const { name = DEFAULT_DB_NAME, backend, wipe = false } = options;
  const runtimeOptions = { ...(backend ? { db: backend } : {}), wipe };
  return new LightningFS(name, runtimeOptions as ConstructorParameters<typeof LightningFS>[1]);
}

/**
 * 全局单例（惰性创建）：挂载于虚拟根目录 `/`，SPA 全生命周期共用。
 *
 * 不在模块顶层直接 `createFs()`，原因有二：
 *   1. 顶层构造会立刻初始化后端，Node 测试环境下会因缺 `indexedDB` 而抛未捕获异常；
 *   2. 测试需要用内存后端替换单例，惰性创建才能让 `configureFs()` 先于首次使用生效。
 */
let fsInstance: LightningFs | null = null;

/** 取得全局单例；首次调用时用默认后端（IdbBackend）创建 */
export function getFs(): LightningFs {
  if (!fsInstance) fsInstance = createFs();
  return fsInstance;
}

/**
 * 用指定配置替换全局单例，并返回新实例。
 *
 * 测试在 `beforeEach` 中调用即可让 `gitApi` 与 `sandbox` 都跑在内存后端上：
 * ```ts
 * import { MemoryBackend } from '@isomorphic-git/lightning-fs';
 * configureFs({ name: 'test-fs', backend: new MemoryBackend() });
 * ```
 */
export function configureFs(options: CreateFsOptions): LightningFs {
  fsInstance = createFs(options);
  return fsInstance;
}

/** 重置单例，使下一次 `getFs()` 重新创建（测试收尾用） */
export function resetFs(): void {
  fsInstance = null;
}

/**
 * 全局单例的 Promise 化视图。
 *
 * 这是一个 **getter 形式的稳定对象**：内部始终转调到当前单例的 `promises`，
 * 因此 `configureFs()` 替换单例后，已持有 `fsp` 的模块无需重新导入也能用到新实例。
 */
export const fsp: FsPromises = new Proxy({} as FsPromises, {
  get(_target, prop) {
    const value = Reflect.get(getFs().promises as object, prop);
    return typeof value === 'function' ? value.bind(getFs().promises) : value;
  },
});

/** 路径是否已存在 */
async function exists(target: string, fsInstance: FsPromises = fsp): Promise<boolean> {
  try {
    await fsInstance.stat(target);
    return true;
  } catch {
    return false;
  }
}

/** 仅当目录不存在时创建（`recursive: true` 对已存在目录会抛错，故需先探测） */
async function ensureDir(target: string, fsInstance: FsPromises = fsp): Promise<void> {
  if (await exists(target, fsInstance)) return;
  await fsInstance.mkdir(target, { mode: 0o777 });
}

/** 确保 `/repo` 与 `/remote.git` 两级目录存在；幂等，可重复调用 */
export async function ensureSandboxRoot(fsInstance: FsPromises = fsp): Promise<void> {
  for (const dir of [REPO_DIR, REMOTE_DIR]) {
    await ensureDir(dir, fsInstance);
  }
}

/** 递归删除一个目录，用于关卡重置与测试清理 */
export async function removeDir(target: string, fsInstance: FsPromises = fsp): Promise<void> {
  if (!(await exists(target, fsInstance))) return;
  for (const entry of await fsInstance.readdir(target)) {
    const child = `${target}/${entry}`;
    const stat = await fsInstance.lstat(child);
    if (stat.isDirectory()) {
      await removeDir(child, fsInstance);
    } else {
      await fsInstance.unlink(child);
    }
  }
  await fsInstance.rmdir(target);
}

/** 清空整个虚拟根目录（保留根节点 `/` 本身）；`sandbox.ts::reset` 的第一步 */
export async function clearSandboxRoot(fsInstance: FsPromises = fsp): Promise<void> {
  for (const entry of await fsInstance.readdir('/')) {
    await removeDir(`/${entry}`, fsInstance);
  }
}

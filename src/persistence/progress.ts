/**
 * 进度持久化（development-refinement.md §10）。
 *
 * §10 的键约定：
 * | 数据 | 存储 | key |
 * |---|---|---|
 * | 进度（每关得分/星级/是否通关） | localStorage | `gtp:progress:v1` |
 * | 成就 | localStorage | `gtp:achievements:v1` |
 * | 设置（提示开关等） | localStorage | `gtp:settings:v1` |
 *
 * ── 本模块的职责边界（§2）──────────────────────────────────────────────
 *
 * 只做**读写与容错**，不含任何业务规则（星级怎么算、成就何时解锁都在
 * `game/scoring/`）。上层（`store/progressStore.ts`）负责把 store 状态与本模块
 * 的读写函数接起来。
 *
 * ── 两条硬性容错要求 ───────────────────────────────────────────────────
 *
 * 1. **损坏数据必须安全降级**：localStorage 里的内容可能是旧版本、被用户手改、
 *    或被其他标签页写坏。JSON 解析失败或结构不符时**返回空进度**，绝不抛异常 ——
 *    抛出去会让 boot 流程中断、整页白屏（本游戏的进度不是关键数据，重来即可）。
 * 2. **storage 不可用必须静默降级**：隐私模式 / 禁用 Cookie 的浏览器里，
 *    访问 `localStorage` 本身就会抛错（甚至只是**读属性**就抛）。
 *    故所有访问都包在 try/catch 内，失败时退化为「纯内存进度」（本次会话有效）。
 */

import type { LevelRecord } from '../store/progressStore';

/** localStorage 的键（§10 的版本化命名，升级时可据此迁移） */
export const PROGRESS_KEY = 'gtp:progress:v1';
export const ACHIEVEMENTS_KEY = 'gtp:achievements:v1';
export const SETTINGS_KEY = 'gtp:settings:v1';

/** 关卡进度表：关卡 id → 记录 */
export type ProgressRecords = Record<string, LevelRecord>;

/** 设置项（§10；目前只有提示开关，后续按需扩展） */
export interface Settings {
  /** 是否显示提示面板 */
  hintsEnabled: boolean;
}

/** 设置的默认值 */
export const DEFAULT_SETTINGS: Settings = { hintsEnabled: true };

/**
 * 取 localStorage；不可用时返回 null（**不抛异常**）。
 *
 * ⚠️ 必须用 try 包住「取属性」这一步而不只是「调用方法」：
 * 部分浏览器在隐私模式下访问 `window.localStorage` 这个属性本身就会抛
 * `SecurityError`（而不是返回一个会抛错的对象）。
 */
function storage(): Storage | null {
  try {
    if (typeof globalThis === 'undefined') return null;
    const candidate = (globalThis as { localStorage?: Storage }).localStorage;
    if (!candidate) return null;
    // 探针：有些环境的 localStorage 存在但写入即抛（配额 / 隐私模式）
    const probe = '__gtp_probe__';
    candidate.setItem(probe, '1');
    candidate.removeItem(probe);
    return candidate;
  } catch {
    return null;
  }
}

/** 读一个键的原始字符串；不存在或不可用时返回 null */
function readRaw(key: string): string | null {
  const store = storage();
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

/** 写一个键；失败（配额 / 不可用）时返回 false，不抛异常 */
function writeRaw(key: string, value: string): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** 删一个键；失败时静默忽略 */
function removeRaw(key: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    // 忽略：清理失败不影响游戏进行
  }
}

/** 判断一个值是否是合法的 `LevelRecord`（结构守卫；不做业务校验） */
function isLevelRecord(value: unknown): value is LevelRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.score === 'number' &&
    Number.isFinite(record.score) &&
    typeof record.stars === 'number' &&
    Number.isFinite(record.stars) &&
    typeof record.cleared === 'boolean'
  );
}

/**
 * 读取关卡进度。
 *
 * 容错：JSON 解析失败、顶层不是对象、或某条记录结构不符时，
 * **丢弃不符合的那部分**而不是整体放弃 —— 一半可用的进度也比全丢好。
 *
 * @returns 关卡 id → 记录；无数据或不可用时返回空对象
 */
export function loadProgress(): ProgressRecords {
  const raw = readRaw(PROGRESS_KEY);
  if (raw === null) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 数据损坏：清掉它，避免每次启动都白解析一遍
    removeRaw(PROGRESS_KEY);
    return {};
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

  const records: ProgressRecords = {};
  let dropped = false;
  for (const [levelId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (isLevelRecord(value)) {
      records[levelId] = value;
    } else {
      dropped = true;
    }
  }
  // 有损坏条目时回写一份干净的，避免坏数据反复出现
  if (dropped) saveProgress(records);
  return records;
}

/** 写入关卡进度；失败时返回 false（调用方通常无需处理） */
export function saveProgress(records: ProgressRecords): boolean {
  try {
    return writeRaw(PROGRESS_KEY, JSON.stringify(records));
  } catch {
    // JSON.stringify 对纯数据不会抛，此处仅为极端情况兜底
    return false;
  }
}

/**
 * 读取已解锁成就 id 列表。
 * 非字符串条目被丢弃（防手改数据让 UI 崩溃）。
 */
export function loadAchievements(): string[] {
  const raw = readRaw(ACHIEVEMENTS_KEY);
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    removeRaw(ACHIEVEMENTS_KEY);
    return [];
  }

  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === 'string');
}

/** 写入成就列表；失败返回 false */
export function saveAchievements(ids: readonly string[]): boolean {
  return writeRaw(ACHIEVEMENTS_KEY, JSON.stringify(ids));
}

/**
 * 读取设置。缺字段用默认值补齐（前向兼容：新增设置项时老数据不会崩）。
 */
export function loadSettings(): Settings {
  const raw = readRaw(SETTINGS_KEY);
  if (raw === null) return { ...DEFAULT_SETTINGS };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    removeRaw(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS };
  }

  if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_SETTINGS };
  const record = parsed as Record<string, unknown>;
  return {
    hintsEnabled:
      typeof record.hintsEnabled === 'boolean' ? record.hintsEnabled : DEFAULT_SETTINGS.hintsEnabled,
  };
}

/** 写入设置；失败返回 false */
export function saveSettings(settings: Settings): boolean {
  return writeRaw(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * 是否存在任何可恢复的进度 —— **boot 分流用**（§5：有进度进 menu，否则进 intro）。
 *
 * ⚠️ 判据是「有任何通关记录」而非「键存在」：
 *   玩家可能进过一关但没通关（记录不存在），或键被写成空对象。
 *   只有真的通关过至少一关，才算「有进度」—— 否则新玩家会被直接丢进菜单，
 *   错过 intro 的引导。
 */
export function hasProgress(): boolean {
  const records = loadProgress();
  return Object.values(records).some((record) => record.cleared);
}

/**
 * 清空全部持久化数据（「重置进度」与测试收尾用）。
 * ⚠️ 不触碰仓库快照（那在 IndexedDB 里，由 `snapshot.ts` 负责）。
 */
export function clearAll(): void {
  removeRaw(PROGRESS_KEY);
  removeRaw(ACHIEVEMENTS_KEY);
  removeRaw(SETTINGS_KEY);
}

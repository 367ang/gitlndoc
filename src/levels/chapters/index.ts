/**
 * 关卡汇总导出与按 id 查询（development-refinement.md §3 `chapters/index.ts`）。
 *
 * 职责边界（§2）：本模块是**关卡数据的注册表**，只做汇总与索引，
 * 不含任何判定/计分逻辑（那些在 `game/validate/` 与 M3 的 `game/scoring/`）。
 * UI 只经此处取关卡，不直接 import 具体章节文件 —— 这样新增章节时 UI 无需改动。
 *
 * ⚠️ 当前只注册了第一章。ch2~ch6 与综合挑战 F 属 M4/M5/M6（§13），
 * 尚未落地时**不注册**，`getChapterLevels('ch3')` 会如实返回空数组 ——
 * 不伪造占位关卡（§14）。
 */

import type { ChapterId, Level } from '../../game/types';
import { CHAPTER_1_LEVELS } from './ch1';

/** 章节元信息，供菜单/章节页渲染（§9.1） */
export interface ChapterMeta {
  id: ChapterId;
  /** 章节序号，1~6；综合挑战为 null（不参与主线排序） */
  order: number | null;
  title: string;
  /** 章节副标题 / 一句话介绍 */
  subtitle: string;
  /** 该章是否已有可玩关卡（未实现的章节在 UI 上应呈禁用态） */
  playable: boolean;
}

/** 全部章节元信息，按主线顺序排列 */
export const CHAPTERS: readonly ChapterMeta[] = [
  {
    id: 'ch1',
    order: 1,
    title: '创世纪元',
    subtitle: 'Git 基础概念 —— 从零建立一条时间线',
    playable: true,
  },
  {
    id: 'ch2',
    order: 2,
    title: '日常秩序',
    subtitle: 'Git 基础操作 —— status / diff / log / rm',
    playable: false,
  },
  {
    id: 'ch3',
    order: 3,
    title: '平行宇宙',
    subtitle: 'Git 分支管理 —— branch / checkout / merge',
    playable: false,
  },
  {
    id: 'ch4',
    order: 4,
    title: '遥远回响',
    subtitle: 'Git 远程操作 —— remote / push / fetch / pull',
    playable: false,
  },
  {
    id: 'ch5',
    order: 5,
    title: '时间倒流',
    subtitle: 'Git 撤销操作 —— reset / revert / restore',
    playable: false,
  },
  {
    id: 'ch6',
    order: 6,
    title: '永恒印记',
    subtitle: 'Git 标签管理 —— tag / show / describe',
    playable: false,
  },
  {
    id: 'F',
    order: null,
    title: '时间线终点',
    subtitle: '综合挑战 —— 全部知识的汇聚',
    playable: false,
  },
] as const;

/** 章节 → 关卡列表。未实现的章节显式登记为空数组，让「无关卡」是**已知事实**而非漏注册 */
const LEVELS_BY_CHAPTER: Record<ChapterId, readonly Level[]> = {
  ch1: CHAPTER_1_LEVELS,
  ch2: [],
  ch3: [],
  ch4: [],
  ch5: [],
  ch6: [],
  F: [],
};

/**
 * 解析关卡 id 的章节前缀与序号。
 *
 * 形如 `ch1-3` → `{ chapter: 'ch1', index: 3 }`；`F-2` → `{ chapter: 'F', index: 2 }`。
 * 不符合格式时返回 null（调用方按「未找到」处理，不猜测）。
 */
function parseLevelId(id: string): { chapter: ChapterId; index: number } | null {
  const match = /^(ch[1-6]|F)-(\d+)$/.exec(id);
  if (!match) return null;
  return { chapter: match[1] as ChapterId, index: Number(match[2]) };
}

/**
 * 取某章的全部关卡，**按关卡序号升序**返回（`ch1-1 → ch1-2 → …`）。
 *
 * ⚠️ 排序是刻意的：UI 的关卡列表直接顺序渲染，而关卡按对象字面量或 id 字典序
 * 排列都会在两位数关卡（如 `ch1-10`）时错位 —— `'ch1-10' < 'ch1-2'` 是字符串比较的
 * 固有结果。故此处显式按解析出的**数值序号**排序，使顺序在任何情况下都正确。
 *
 * @returns 该章的关卡数组；章节不存在或尚无关卡时返回空数组
 */
export function getChapterLevels(chapterId: ChapterId): Level[] {
  const levels = LEVELS_BY_CHAPTER[chapterId] ?? [];
  return [...levels].sort((a, b) => {
    const left = parseLevelId(a.id)?.index ?? Number.MAX_SAFE_INTEGER;
    const right = parseLevelId(b.id)?.index ?? Number.MAX_SAFE_INTEGER;
    return left - right;
  });
}

/**
 * 按 id 取单个关卡。
 *
 * @returns 找到则返回 `Level`，否则返回 `null`（UI 据此提示「关卡不存在」）
 */
export function getLevel(id: string): Level | null {
  const parsed = parseLevelId(id);
  if (!parsed) return null;
  return getChapterLevels(parsed.chapter).find((level) => level.id === id) ?? null;
}

/** 全部已注册关卡（跨章节，按章节顺序再按关卡序号） */
export function getAllLevels(): Level[] {
  return CHAPTERS.flatMap((chapter) => getChapterLevels(chapter.id));
}

/** 按 id 取章节元信息；不存在返回 null */
export function getChapterMeta(chapterId: ChapterId): ChapterMeta | null {
  return CHAPTERS.find((chapter) => chapter.id === chapterId) ?? null;
}

/** 该章第一个可玩关卡；用于「从菜单直接进入本章」的入口，无关卡时返回 null */
export function getFirstLevelOfChapter(chapterId: ChapterId): Level | null {
  return getChapterLevels(chapterId)[0] ?? null;
}

/**
 * 关卡定义的运行时校验（development-refinement.md §4.1、§4.2、§4.3）。
 *
 * ⚠️ 本文件**不重新定义**领域类型 —— `Level` / `LevelInit` / `TargetCondition` 等
 * 都在 `src/game/types.ts`（M1 交付）。这里只补上「类型系统管不到」的那部分：
 *   - 关卡数据是**手写的字面量**，`Level` 的标注只保证形状，不保证取值有意义；
 *   - `id` 与 `chapter` 的一致性、`difficulty` 的取值域、`targets` 非空、
 *     `scoring` 字段齐备，这些都是运行时才暴露的问题（§11 的 `levels.test.ts` 即为此设）。
 *
 * 因此本文件是**类型守卫 + 可读错误**，不是 JSON Schema 的复刻（§3 提到「JSON Schema
 * （TS 类型守卫）」，落点即此）。校验**不做宽松兜底**：错就报错，不猜作者意图。
 */

import type { ChapterId, InputMode, Level, LevelInit, ScoringParams, TargetCondition } from '../game/types';

/** 章节名单，用于校验 `id` 前缀与 `chapter` 一致（与 `ChapterId` 同源，不重复列举字面量） */
const CHAPTERS: readonly ChapterId[] = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'F'] as const;

/** 输入方式全集 */
const INPUT_MODES: readonly InputMode[] = ['free', 'half', 'menu'] as const;

/** `ScoringParams` 的必需数值字段（§7） */
const SCORING_KEYS: readonly (keyof ScoringParams)[] = [
  'baseScore',
  'undoPenalty',
  'redoPenalty',
  'hintPenalty',
  'optimalBonus',
  'flawlessBonus',
  'probeBonus',
] as const;

/**
 * §4.3 中**已实现判定逻辑**的 `TargetCondition` 类型。
 *
 * ⚠️ 这是「实现进度」的事实来源：`src/game/validate/targetState.ts` 处理这 9 种，
 * 其余 2 种由 `UNIMPLEMENTED_TARGET_TYPES` 列出并明确报「尚未实现」。
 * 两处名单必须同步 —— 由 `levels.test.ts` 断言两份名单互补且与 targetState 一致。
 */
export const IMPLEMENTED_TARGET_TYPES: readonly TargetCondition['type'][] = [
  'file',
  'commitCount',
  'commitMessage',
  'commitExists',
  'workdirClean',
  // M4（第 3 章分支关卡）
  'branch',
  'headBranch',
  'merged',
  'logOrder',
] as const;

/** §4.3 中尚未实现判定逻辑的类型（对应章节属 M5/M6） */
export const UNIMPLEMENTED_TARGET_TYPES: readonly TargetCondition['type'][] = [
  'tag',
  'remote',
] as const;

/** 校验结果：成功时收窄为 `Level`，失败时给出**可直接展示给关卡作者**的中文原因 */
export type ValidationResult =
  | { ok: true; level: Level; errors: [] }
  | { ok: false; errors: string[] };

/** 收集多条错误，避免「修一个报一个」的往返 */
class ErrorCollector {
  readonly errors: string[] = [];

  /** 记录一条错误，前缀用于定位到具体字段（如 `ch1-1.targets`） */
  add(path: string, message: string): void {
    this.errors.push(`${path}：${message}`);
  }
}

/** 是否为可用的非空字符串（关卡数据里的空串一律视为漏填） */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 是否为有限的数值（排除 NaN / Infinity，它们会让计分静默失真） */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 校验 `id`：形如 `chN-M`（N 为 1–6 或 F 为综合挑战，M 为从 1 起的序号） */
function validateId(id: unknown, chapter: unknown, collector: ErrorCollector): void {
  if (!isNonEmptyString(id)) {
    collector.add('id', '必须是非空字符串，形如 ch1-1。');
    return;
  }

  const match = /^(ch[1-6]|F)-([1-9]\d*)$/.exec(id);
  if (!match) {
    collector.add('id', `"${id}" 不符合 chN-M 格式（N 为 1~6 或 F，M 为从 1 起的整数）。`);
    return;
  }

  // id 与 chapter 必须一致：id 是玩家可见的「第几章第几关」，错配会让 UI 显示串章
  if (match[1] !== chapter) {
    collector.add('id', `"${id}" 的章节前缀与 chapter "${String(chapter)}" 不一致。`);
  }
}

/** 校验 `targets`：非空、类型合法、且不得使用尚未实现的类型 */
function validateTargets(targets: unknown, collector: ErrorCollector): void {
  if (!Array.isArray(targets) || targets.length === 0) {
    collector.add('targets', '必须是非空数组（全空则关卡无判定依据，一进关就「过关」）。');
    return;
  }

  targets.forEach((target: unknown, index) => {
    const path = `targets[${index}]`;
    if (typeof target !== 'object' || target === null || !('type' in target)) {
      collector.add(path, '必须是带 type 字段的 TargetCondition 对象。');
      return;
    }

    const type = (target as { type: unknown }).type;
    if (typeof type !== 'string' || ![...IMPLEMENTED_TARGET_TYPES, ...UNIMPLEMENTED_TARGET_TYPES].includes(type as never)) {
      collector.add(path, `未知的目标类型 "${String(type)}"（见 §4.3）。`);
      return;
    }

    // 未实现的类型**不允许出现在关卡数据里**：它不会让玩家过关，只会让目标面板一直报错。
    // 这属关卡配置错误（作者以为已支持），故校验期即拦截，而不是留到运行时。
    if ((UNIMPLEMENTED_TARGET_TYPES as readonly string[]).includes(type)) {
      collector.add(
        path,
        `目标类型 "${type}" 尚未实现（属 M4/M5），不能用于当前关卡数据；` +
          `已实现的类型为：${IMPLEMENTED_TARGET_TYPES.join(' / ')}。`,
      );
    }
  });
}

/** 校验 `scoring`：§7 的 7 个字段齐备且为有限数值 */
function validateScoring(scoring: unknown, collector: ErrorCollector): void {
  if (typeof scoring !== 'object' || scoring === null) {
    collector.add('scoring', '必须是对象（M2 可填占位值，但字段须齐备）。');
    return;
  }

  const record = scoring as Record<string, unknown>;
  for (const key of SCORING_KEYS) {
    if (!isFiniteNumber(record[key])) {
      collector.add(`scoring.${key}`, '必须是有限数值。');
    }
  }
}

/** 校验可选倒计时：给了就必须是正数（0 或负数会让关卡瞬间超时） */
function validateTimeout(timeoutMs: unknown, collector: ErrorCollector): void {
  if (timeoutMs === undefined) return;
  if (!isFiniteNumber(timeoutMs) || timeoutMs <= 0) {
    collector.add('timeoutMs', '若提供，必须是大于 0 的数值。');
  }
}

/** 校验 `hints`：允许为空，但每项的正文与解锁次数必须有效 */
function validateHints(hints: unknown, collector: ErrorCollector): void {
  if (!Array.isArray(hints)) {
    collector.add('hints', '必须是数组（可为空数组）。');
    return;
  }

  hints.forEach((hint: unknown, index) => {
    const path = `hints[${index}]`;
    if (typeof hint !== 'object' || hint === null) {
      collector.add(path, '必须是 HintStep 对象。');
      return;
    }
    const { text, unlockAfterFailures } = hint as { text?: unknown; unlockAfterFailures?: unknown };
    if (!isNonEmptyString(text)) collector.add(`${path}.text`, '必须是非空字符串。');
    // 首个提示若要求「失败 1 次后解锁」，0 表示失败 0 次（即进关即可见），同样合法
    if (!isFiniteNumber(unlockAfterFailures) || unlockAfterFailures < 0) {
      collector.add(`${path}.unlockAfterFailures`, '必须是不小于 0 的数值。');
    }
  });
}

/**
 * 校验 `init`：允许 `files` / `commits` / `branches`（M4 起已落地），
 * 以及语义等价的 `template: 'blank' | 'emptyRepo'`。
 *
 * ⚠️ `tags` / `remotes` / `template: 'cloneSource'` 会在
 * `sandbox.reset()` 处 **fail-fast 报错**（刻意不伪造，见 docs/milestones/M1-tasks.md「实测环境事实」）。
 * 若把关卡写坏了要等到玩家进关才炸，体验很差 —— 故这里在校验期就拦下，
 * 并给出与 sandbox 同一口径的说明。
 *
 * M4 校验细则：
 *   - `branches`：name 非空且不以 `-` 开头；`from` 可选、非空字符串；
 *   - `commits[].on`：可选分支名，同上；`commits[].files`：与 `init.files` 同规则
 *     （非空路径 → 字符串内容）。
 */
function validateInit(init: unknown, collector: ErrorCollector): void {
  if (typeof init !== 'object' || init === null) {
    collector.add('init', '必须是对象（无预置内容时传 {}）。');
    return;
  }

  const { template, files, commits, branches, tags, remotes } = init as LevelInit;

  if (template !== undefined && template !== 'blank' && template !== 'emptyRepo') {
    collector.add(
      'init.template',
      `"${String(template)}" 不可用；当前支持 'blank' 与 'emptyRepo'（'cloneSource' 属 M5）。`,
    );
  }

  // sandbox.reset() 的 fail-fast 名单，此处提前拦截
  const deferred: string[] = [];
  if (Array.isArray(tags) && tags.length > 0) deferred.push('tags');
  if (Array.isArray(remotes) && remotes.length > 0) deferred.push('remotes');
  if (deferred.length > 0) {
    collector.add(
      'init',
      `${deferred.join(' / ')} 尚未落地（属 M5/M6），sandbox.reset() 会 fail-fast 拒绝执行。`,
    );
  }

  if (branches !== undefined) {
    if (!Array.isArray(branches)) {
      collector.add('init.branches', '必须是数组（可为空）。');
    } else {
      branches.forEach((entry: unknown, index) => {
        const path = `init.branches[${index}]`;
        if (typeof entry !== 'object' || entry === null) {
          collector.add(path, '必须是 { name, from? } 对象。');
          return;
        }
        const { name, from } = entry as { name?: unknown; from?: unknown };
        if (typeof name !== 'string' || name.trim().length === 0 || name.startsWith('-')) {
          collector.add(`${path}.name`, '必须是非空且不以 - 开头的分支名。');
        }
        if (from !== undefined && (typeof from !== 'string' || from.trim().length === 0)) {
          collector.add(`${path}.from`, '若提供，必须是非空字符串（起点分支名）。');
        }
      });
    }
  }

  const validateFileMap = (value: unknown, path: string): void => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      collector.add(path, '必须是「路径 → 内容」的对象。');
      return;
    }
    for (const [p, content] of Object.entries(value as Record<string, unknown>)) {
      if (!isNonEmptyString(p)) collector.add(path, '存在空路径。');
      if (typeof content !== 'string') collector.add(`${path}["${p}"]`, '文件内容必须是字符串。');
    }
  };

  if (files !== undefined) {
    validateFileMap(files, 'init.files');
  }

  if (commits !== undefined) {
    if (!Array.isArray(commits)) {
      collector.add('init.commits', '必须是数组。');
    } else {
      commits.forEach((commit: unknown, index) => {
        const path = `init.commits[${index}]`;
        if (typeof commit !== 'object' || commit === null) {
          collector.add(path, '必须是 InitCommit 对象。');
          return;
        }
        const { msg, message, on, files: commitFiles } = commit as {
          msg?: unknown;
          message?: unknown;
          on?: unknown;
          files?: unknown;
        };
        // sandbox 取 `message || msg`，两者都空会让提交信息为空字符串
        if (!isNonEmptyString(message) && !isNonEmptyString(msg)) {
          collector.add(path, 'message（或 msg）必须是非空字符串。');
        }
        if (on !== undefined && (typeof on !== 'string' || on.trim().length === 0 || on.startsWith('-'))) {
          collector.add(`${path}.on`, '若提供，必须是非空且不以 - 开头的分支名。');
        }
        if (commitFiles !== undefined) {
          validateFileMap(commitFiles, `${path}.files`);
        }
      });
    }
  }
}

/**
 * 校验一个未知值是否为合法 `Level`。
 *
 * @example
 * ```ts
 * const result = validateLevel(raw);
 * if (!result.ok) throw new Error(result.errors.join('\n'));
 * ```
 */
export function validateLevel(input: unknown): ValidationResult {
  const collector = new ErrorCollector();

  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['关卡定义必须是对象。'] };
  }

  const raw = input as Record<string, unknown>;

  // --- 身份与展示 ---
  const chapter = raw.chapter;
  if (typeof chapter !== 'string' || !CHAPTERS.includes(chapter as ChapterId)) {
    collector.add('chapter', `必须是 ${CHAPTERS.join(' / ')} 之一。`);
  }
  validateId(raw.id, chapter, collector);

  if (!isNonEmptyString(raw.title)) collector.add('title', '必须是非空字符串。');
  if (!isNonEmptyString(raw.objective)) collector.add('objective', '必须是非空字符串（玩家据此理解目标）。');

  // --- 玩法参数 ---
  if (!isFiniteNumber(raw.difficulty) || !Number.isInteger(raw.difficulty) || raw.difficulty < 1 || raw.difficulty > 5) {
    collector.add('difficulty', '必须是 1~5 的整数。');
  }

  if (typeof raw.inputMode !== 'string' || !INPUT_MODES.includes(raw.inputMode as InputMode)) {
    collector.add('inputMode', `必须是 ${INPUT_MODES.join(' / ')} 之一。`);
  }

  if (!Array.isArray(raw.relatedKnowledge) || raw.relatedKnowledge.length === 0) {
    collector.add('relatedKnowledge', '必须是非空数组（每关至少关联一个笔记知识点）。');
  } else {
    raw.relatedKnowledge.forEach((id: unknown, index) => {
      // 形如 `git-basics#local-repository`：`<笔记文件名>#<小节 slug>`
      if (!isNonEmptyString(id) || !/^[a-z0-9-]+#[a-z0-9-]+$/.test(id)) {
        collector.add(`relatedKnowledge[${index}]`, `"${String(id)}" 不符合 <note>#<slug> 格式。`);
      }
    });
  }

  // --- 判定与计分 ---
  validateInit(raw.init, collector);
  validateTargets(raw.targets, collector);
  validateHints(raw.hints, collector);
  if (!isFiniteNumber(raw.winScore) || raw.winScore <= 0) {
    collector.add('winScore', '必须是大于 0 的数值。');
  }
  // optimalMoves：§7.3 optimalBonus 的判据（命令数与参考解法一致或更短才给分）。
  // 必须是正整数：0 或负数会让「最优序列」奖励失去意义，非整数则无从比较。
  if (
    !isFiniteNumber(raw.optimalMoves) ||
    !Number.isInteger(raw.optimalMoves) ||
    raw.optimalMoves < 1
  ) {
    collector.add('optimalMoves', '必须是大于 0 的整数（参考解法的成功命令数）。');
  }
  validateScoring(raw.scoring, collector);
  validateTimeout(raw.timeoutMs, collector);

  // halfSkeleton（M4）：半拼关卡必须提供骨架，且骨架须以 git 起头（拼接模型的前提）；
  // 非半拼关卡若提供则视为数据冗余 —— 同样拦截，避免两种输入模型界限含糊。
  if (raw.inputMode === 'half') {
    if (!isNonEmptyString(raw.halfSkeleton)) {
      collector.add('halfSkeleton', '半拼关卡必须提供骨架命令（如 "git merge"）。');
    } else if (!raw.halfSkeleton.startsWith('git ') || raw.halfSkeleton.trim().split(/\s+/).length < 2) {
      collector.add('halfSkeleton', '骨架必须是「git <子命令>」形式的完整前缀。');
    }
  } else if (raw.halfSkeleton !== undefined) {
    collector.add('halfSkeleton', '仅半拼（half）关卡可提供骨架命令。');
  }

  if (collector.errors.length > 0) return { ok: false, errors: collector.errors };
  return { ok: true, level: input as Level, errors: [] };
}

/** 断言式校验：失败即抛出，附全部错误清单（供关卡数据模块自检与测试使用） */
export function assertValidLevel(input: unknown): Level {
  const result = validateLevel(input);
  if (!result.ok) {
    throw new Error(`关卡定义校验失败：\n- ${result.errors.join('\n- ')}`);
  }
  return result.level;
}

/** 类型守卫形式：`if (isLevel(raw))` 之后 `raw` 收窄为 `Level` */
export function isLevel(input: unknown): input is Level {
  return validateLevel(input).ok;
}

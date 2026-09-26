// scoring 单元测试（development-refinement.md §11.1）—— **真实用例（M3）**
//
// 覆盖 §7 的三个块：星级判定 / 惩罚项 / 奖励与边界。
// 计分引擎是纯函数（`game/scoring/score.ts`），测试直接构造 `CommandEntry[]`
// 假历史驱动，无需 LightningFS —— 与 fragments 的测试策略一致（纯函数穷举覆盖）。
//
// ⚠️ `undoable` 与 probe 类命令在第一章命令集（init/add/commit）中不可达，
//    但测试用假 history 直接标记，保证 M4/M5 接入时行为已被锁定。

import { describe, expect, it } from 'vitest';
import { evaluateScore, starsOf } from '../game/scoring/score';
import type { CommandEntry, Level, ScoringParams } from '../game/types';

// ─────────────────────────────────────────────────────────────────────────────
// 测试脚手架
// ─────────────────────────────────────────────────────────────────────────────

/** 与 ch1.ts 的 SCORING_PLACEHOLDER 同参（占位值已由 M2 敲定，此处对齐） */
const PARAMS: ScoringParams = {
  baseScore: 100,
  undoPenalty: 15,
  redoPenalty: 10,
  hintPenalty: 5,
  optimalBonus: 20,
  flawlessBonus: 25,
  probeBonus: 2,
};

/** 构造一个最小可计分的关卡（各用例按需覆写字段） */
function makeLevel(overrides: Partial<Level> = {}): Level {
  return {
    id: 'ch1-1',
    chapter: 'ch1',
    title: '测试关',
    objective: '测试',
    difficulty: 1,
    inputMode: 'menu',
    relatedKnowledge: ['git-basics#local-repository'],
    init: {},
    targets: [
      { type: 'commitCount', op: 'gte', value: 1 },
      { type: 'workdirClean', value: true },
    ],
    winScore: 60,
    scoring: { ...PARAMS },
    optimalMoves: 3,
    hints: [],
    ...overrides,
  };
}

/** 造一条命令历史条目（id/ts 由序号派生，测试无需唯一性） */
function entry(
  input: string,
  ok = true,
  undoable = false,
): CommandEntry {
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    input,
    tokens: input.split(/\s+/),
    ok,
    output: [],
    ts: Date.now(),
    undoable,
  };
}

const MET = { hintsUsed: 0, targetsMet: true, firstAttempt: true };

// ─────────────────────────────────────────────────────────────────────────────
// 星级判定（§7.4）
// ─────────────────────────────────────────────────────────────────────────────

describe('scoring —— 星级判定', () => {
  it('★：撤销类命令把星级压到 1（分数虽 ≥ 0.8·baseScore）', () => {
    // 100 − 15（undo）= 85；4 条成功命令 > optimalMoves=3 → 无 optimal 奖励。
    // 85 ≥ 80（0.8 线）→ 若无撤销是 3 星；有撤销 → 1 星
    const level = makeLevel({ winScore: 60 });
    const history = [
      entry('git add .'),
      entry('git commit -m "x"'),
      entry('git reset --hard HEAD~1', true, true),
      entry('git add .'),
      entry('git commit -m "x2"'),
    ];
    const result = evaluateScore(level, history, MET);
    expect(result.score).toBe(85);
    expect(result.stars).toBe(1);
  });

  it('★★：过关且 ≥0.8·baseScore，但有提示 → 2 星', () => {
    // base 70 + optimal 20 − hint 5 = 85 ≥ 80（0.8·70=56 早已过，看的是 0.8·baseScore=80
    // —— 不对，基准是 baseScore=70：0.8×70=56，85 ≥ 56 ✓；0.95×70=66.5，85 ≥ 66.5
    // 但有提示 → 非 3 星 → 2 星
    const level = makeLevel({ winScore: 60, scoring: { ...PARAMS, baseScore: 70 } });
    const result = evaluateScore(level, [entry('git add .'), entry('git commit -m "x"')], {
      ...MET,
      hintsUsed: 1,
    });
    expect(result.score).toBe(85);
    expect(result.stars).toBe(2);
  });

  it('★★★：≥0.95·baseScore 且 0 提示 0 撤销 → 3 星', () => {
    // 100 + 20（最优）+ 25（一次通过）= 145 ≥ 95 → 3 星
    const level = makeLevel({ winScore: 60 });
    const result = evaluateScore(level, [entry('git add .'), entry('git commit -m "x"')], MET);
    expect(result.stars).toBe(3);
  });

  it('得分低于 winScore 时不给星，即使目标已达成', () => {
    // 100 − 5 redo×10=50 − 4 提示×5=20 → 30 < 60 → 0 星（5 次同信息提交各记 redo）
    const level = makeLevel({ winScore: 60 });
    const history = [
      entry('git add .'),
      entry('git commit -m "x"'),
      entry('git commit -m "x"'),
      entry('git commit -m "x"'),
      entry('git commit -m "x"'),
      entry('git commit -m "x"'),
      entry('git commit -m "x"'),
    ];
    const result = evaluateScore(level, history, { ...MET, hintsUsed: 4 });
    expect(result.breakdown.redoPenalty).toBe(50);
    expect(result.score).toBe(30);
    expect(result.stars).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 惩罚项（§7.2）
// ─────────────────────────────────────────────────────────────────────────────

describe('scoring —— 扣分项', () => {
  it('撤销类命令按 undoPenalty 扣分，多次撤销累计', () => {
    // 100 − 2×15 = 70
    const level = makeLevel();
    const history = [
      entry('git add .'),
      entry('git commit -m "x"'),
      entry('git reset --hard HEAD~1', true, true), // undoable
      entry('git reset --hard HEAD~1', true, true), // undoable
    ];
    const result = evaluateScore(level, history, MET);
    expect(result.breakdown.undoPenalty).toBe(30);
    expect(result.score).toBe(70);
  });

  it('reset --soft/--mixed 与 --hard 同按 undoPenalty 计（undoable 由 executor 标记）', () => {
    // §14 的「细分 reset 模式」属 executor 标记层的未来增强；计分层只认 undoable 布尔。
    // 本用例锁定当前口径：soft 与 hard 的扣分一致（由 executor 决定标记）。
    const level = makeLevel();
    const soft = evaluateScore(level, [entry('git reset --soft HEAD~1', true, true)], MET);
    const hard = evaluateScore(level, [entry('git reset --hard HEAD~1', true, true)], MET);
    expect(soft.breakdown.undoPenalty).toBe(hard.breakdown.undoPenalty);
    expect(soft.breakdown.undoPenalty).toBe(15);
  });

  it('重复完成同一目标触发 redoPenalty（同信息提交去重）', () => {
    // 100 + 25（一次通过仍成立：0 撤销 0 提示）− 2×10 = 105：3 次同信息提交，后 2 次各记 redo。
    // 注：flawless 的口径是「0 撤销 0 提示」，与「提交是否重复」无关（§7.3）。
    const level = makeLevel();
    const history = [
      entry('git add .'),
      entry('git commit -m "快照"'),
      entry('git commit -m "快照"'),
      entry('git commit -m "快照"'),
    ];
    const result = evaluateScore(level, history, MET);
    expect(result.breakdown.redoPenalty).toBe(20);
    expect(result.score).toBe(105);
  });

  it('每步提示按 hintPenalty 扣分', () => {
    // 100 + 20（最优）− 3×5 = 105
    const level = makeLevel();
    const result = evaluateScore(level, [entry('git add .'), entry('git commit -m "x"')], {
      ...MET,
      hintsUsed: 3,
    });
    expect(result.breakdown.hintPenalty).toBe(15);
    expect(result.score).toBe(105);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 奖励与边界（§7.3 + §7.4 边界）
// ─────────────────────────────────────────────────────────────────────────────

describe('scoring —— 奖励与边界', () => {
  it('最优命令序列给 optimalBonus（成功命令数 ≤ optimalMoves）', () => {
    const level = makeLevel({ optimalMoves: 3 });
    const history = [entry('git add .'), entry('git commit -m "x"'), entry('git status')];
    const result = evaluateScore(level, history, MET);
    expect(result.breakdown.optimalBonus).toBe(20);
  });

  it('超出 optimalMoves 不给 optimalBonus；失败命令计入比较（只看成功数）', () => {
    const level = makeLevel({ optimalMoves: 2 });
    // 3 条成功 > 2 → 无最优奖励
    const over = evaluateScore(
      level,
      [entry('git add .'), entry('git add .'), entry('git commit -m "x"')],
      MET,
    );
    expect(over.breakdown.optimalBonus).toBe(0);

    // 失败命令不计入成功数（1 成功 ≤ 2 → 有奖励）
    const withFail = evaluateScore(
      level,
      [entry('git add 拼错', false), entry('git add .'), entry('git commit -m "x"')],
      MET,
    );
    expect(withFail.breakdown.optimalBonus).toBe(20);
  });

  it('一次通过且零失误（0 撤销 0 提示）给 flawlessBonus；有提示或重玩则不给', () => {
    const level = makeLevel();
    const history = [entry('git add .'), entry('git commit -m "x"')];

    const clean = evaluateScore(level, history, MET);
    expect(clean.breakdown.flawlessBonus).toBe(25);

    const hinted = evaluateScore(level, history, { ...MET, hintsUsed: 1 });
    expect(hinted.breakdown.flawlessBonus).toBe(0);

    const retried = evaluateScore(level, history, { ...MET, firstAttempt: false });
    expect(retried.breakdown.flawlessBonus).toBe(0);
  });

  it('只读探查命令（status/log/branch）给 probeBonus 且受上限约束', () => {
    const level = makeLevel();
    // 5 次 status —— 只计前 3 次（PROBE_BONUS_MAX_EVENTS）
    const history = [
      entry('git status'),
      entry('git log'),
      entry('git branch'),
      entry('git status'),
      entry('git status'),
    ];
    const result = evaluateScore(level, history, MET);
    expect(result.breakdown.probeBonus).toBe(2 * 3);
    expect(result.breakdown.probeBonus).toBeLessThan(2 * 5);
  });

  it('最终得分不低于 0（扣分不会把总分压成负数）', () => {
    const level = makeLevel();
    const history = [
      entry('git add .'),
      entry('git commit -m "x"'),
      entry('git reset --hard', true, true), // −15
      entry('git commit -m "x"'), // redo −10
      entry('git commit -m "x"'), // redo −10
      entry('git commit -m "x"'), // redo −10
    ];
    // 100 − 15 − 3×10 = 55；50 条提示 ×5 = 250 → 压穿 0，由 max(0,·) 兜底
    const result = evaluateScore(level, history, { ...MET, hintsUsed: 50 });
    expect(result.score).toBe(0);
    expect(result.stars).toBe(0);
  });

  it('目标未达成时基础分为 0，星级恒 0（过关前提）', () => {
    const level = makeLevel();
    const result = evaluateScore(level, [entry('git status')], { ...MET, targetsMet: false });
    expect(result.breakdown.base).toBe(0);
    expect(result.score).toBe(2); // 只有 probe：1×2
    expect(result.stars).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// starsOf 边界（压线：=0.8 / =0.95 恰好达标）
// ─────────────────────────────────────────────────────────────────────────────

describe('scoring —— starsOf 边界', () => {
  const MET_STAR = { hintsUsed: 0, targetsMet: true, firstAttempt: true };

  it('过关（total ≥ winScore）但 < 0.8·baseScore → 1 星', () => {
    // baseScore=100：0.8 线 = 80。total=60~79 且 ≥ winScore（如 winScore=60）→ 1 星
    expect(starsOf(100, 60, 79, MET_STAR, 0)).toBe(1);
    expect(starsOf(100, 60, 60, MET_STAR, 0)).toBe(1);
  });

  it('total 恰好 = 0.8·baseScore → 2 星（≥ 含等于）', () => {
    expect(starsOf(100, 60, 80, MET_STAR, 0)).toBe(2);
  });

  it('total 恰好 = 0.95·baseScore 且 0 提示 → 3 星', () => {
    expect(starsOf(100, 60, 95, MET_STAR, 0)).toBe(3);
  });

  it('有提示把 3 星压到 2 星；未到 0.8 线但有提示仍 1 星', () => {
    expect(starsOf(100, 60, 90, { ...MET_STAR, hintsUsed: 1 }, 0)).toBe(2);
    expect(starsOf(100, 60, 79, { ...MET_STAR, hintsUsed: 1 }, 0)).toBe(1);
  });

  it('有撤销时最多 1 星（无论分数多高）', () => {
    expect(starsOf(100, 60, 145, MET_STAR, 1)).toBe(1);
  });

  it('未达标恒 0 星（即使奖励分凑过了 winScore）', () => {
    expect(starsOf(100, 60, 65, { ...MET_STAR, targetsMet: false }, 0)).toBe(0);
  });

  it('未过关（total < winScore）恒 0 星', () => {
    expect(starsOf(100, 60, 59, MET_STAR, 0)).toBe(0);
  });
});

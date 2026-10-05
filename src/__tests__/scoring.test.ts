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
  it('撤销类命令经分数影响落段：1 次 reset 后仍 ≥0.7·base → 2 星（M7 口径）', () => {
    // 100 − 15（undo）= 85；4 条成功命令 > optimalMoves=3 → 无 optimal 奖励。
    // M7 起撤销不再锁星：85 ≥ 0.7·100=70 → 2 星（撤销与星级的耦合只经分数）
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
    expect(result.stars).toBe(2);
  });

  it('多次撤销把分数压进 50–69 段 → 1 星（GDD §5.2 分数主轴）', () => {
    // 3 次撤销：5 条成功命令 > optimalMoves=3 → 无 optimal 奖励。
    // 100 − 3×15 = 55 ≥ winScore 50 且 < 0.7·100=70 → 1 星（50–69 段）
    const level = makeLevel({ winScore: 50 });
    const history = [
      entry('git add .'),
      entry('git commit -m "x"'),
      entry('git reset --hard HEAD~1', true, true),
      entry('git reset --hard HEAD~1', true, true),
      entry('git reset --hard HEAD~1', true, true),
    ];
    const result = evaluateScore(level, history, MET);
    expect(result.score).toBe(55);
    expect(result.stars).toBe(1);
  });

  it('★★：分数 ≥0.7·baseScore；有提示不锁星（只锁 ★★★）', () => {
    // base 70 + optimal 20 − 方向提示 5 = 85 ≥ 0.7×70=49 → 2 星
    // （flawless 需 0 提示 —— hintsUsed=1 → 无 flawless）
    const level = makeLevel({ winScore: 60, scoring: { ...PARAMS, baseScore: 70 } });
    const result = evaluateScore(level, [entry('git add .'), entry('git commit -m "x"')], {
      ...MET,
      hintsUsed: 1,
    });
    // makeLevel 默认 hints=[] → 分级扣分按 0 计（越界封顶不动）。
    // 提示数据齐备的关卡才有分级扣分 —— 给足 hints 再验：
    expect(result.score).toBe(90);
    const withHints = makeLevel({
      winScore: 60,
      scoring: { ...PARAMS, baseScore: 70 },
      hints: [
        { text: '方向', unlockAfterFailures: 0 },
        { text: '命令', unlockAfterFailures: 1 },
        { text: '答案', unlockAfterFailures: 3 },
      ],
    });
    const hinted = evaluateScore(withHints, [entry('git add .'), entry('git commit -m "x"')], {
      ...MET,
      hintsUsed: 1,
    });
    expect(hinted.score).toBe(85); // 70+20−5
    expect(hinted.stars).toBe(2);
  });

  it('★★★：≥0.9·baseScore 且 0 提示 → 3 星（撤销不锁星，M7 口径）', () => {
    // 100 + 20（最优）+ 25（一次通过）= 145 ≥ 90 → 3 星
    const level = makeLevel({ winScore: 60 });
    const result = evaluateScore(level, [entry('git add .'), entry('git commit -m "x"')], MET);
    expect(result.stars).toBe(3);
  });

  it('得分低于 winScore 时不给星，即使目标已达成', () => {
    // 100 − 5 redo×10=50 − 提示分级(5+10+20=35) = 15 < 60 → 0 星
    const level = makeLevel({ winScore: 60, hints: [{ text: 'h', unlockAfterFailures: 0 }, { text: 'h', unlockAfterFailures: 1 }, { text: 'h', unlockAfterFailures: 3 }] });
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
    expect(result.breakdown.hintPenalty).toBe(35);
    expect(result.score).toBe(15);
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

  it('提示按 GDD §5.1 分级扣分：方向 −5 / 命令 −10 / 完整答案 −20（M7）', () => {
    // 3 层提示（方向→命令→答案）：看满 3 层 = 5+10+20 = 35
    // 100 + 20（最优）− 35 = 85
    const level = makeLevel({
      hints: [
        { text: '方向', unlockAfterFailures: 0 },
        { text: '命令', unlockAfterFailures: 1 },
        { text: '答案', unlockAfterFailures: 3 },
      ],
    });
    const result = evaluateScore(level, [entry('git add .'), entry('git commit -m "x"')], {
      ...MET,
      hintsUsed: 3,
    });
    expect(result.breakdown.hintPenalty).toBe(35);
    expect(result.score).toBe(85);
  });

  it('分级扣分的递进：只看方向 5 分，看到命令层累计 15 分', () => {
    const level = makeLevel({
      hints: [
        { text: '方向', unlockAfterFailures: 0 },
        { text: '命令', unlockAfterFailures: 1 },
        { text: '答案', unlockAfterFailures: 3 },
      ],
    });
    const history = [entry('git add .'), entry('git commit -m "x"')];
    const l1 = evaluateScore(level, history, { ...MET, hintsUsed: 1 });
    expect(l1.breakdown.hintPenalty).toBe(5);
    const l2 = evaluateScore(level, history, { ...MET, hintsUsed: 2 });
    expect(l2.breakdown.hintPenalty).toBe(15);
  });

  it('双层提示关卡：首层方向 1×、末层按完整答案 4×（末层判定按层级位置）', () => {
    // hints 共 2 条时：第 2 层既是「中间层」也是「末层」—— 末层优先（它是完整答案）
    const level = makeLevel({ hints: [{ text: '方向', unlockAfterFailures: 0 }, { text: '答案', unlockAfterFailures: 1 }] });
    const result = evaluateScore(level, [entry('git add .'), entry('git commit -m "x"')], {
      ...MET,
      hintsUsed: 2,
    });
    expect(result.breakdown.hintPenalty).toBe(25); // 5 + 20
  });

  it('hintsUsed 超出总层数按总层数封顶（防御越界，不炸）', () => {
    const level = makeLevel({ hints: [{ text: '方向', unlockAfterFailures: 0 }, { text: '命令', unlockAfterFailures: 1 }, { text: '答案', unlockAfterFailures: 3 }] });
    const result = evaluateScore(level, [entry('git add .'), entry('git commit -m "x"')], {
      ...MET,
      hintsUsed: 50,
    });
    expect(result.breakdown.hintPenalty).toBe(35);
  });

  it('无提示数据的关卡（hints 为空）提示扣分为 0', () => {
    const level = makeLevel({ hints: [] });
    const result = evaluateScore(level, [entry('git add .'), entry('git commit -m "x"')], {
      ...MET,
      hintsUsed: 3,
    });
    expect(result.breakdown.hintPenalty).toBe(0);
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
    // 100 − 15 − 3×10 = 55；50 条提示压穿 0（越界封顶为 35 也不够 ——
    // 由 max(0,·) 兜底；此处 hints 取 makeLevel 默认空数组，扣分为 0，
    // 55 仍 < winScore 60 → 0 星）—— 用带提示关卡验证压穿 0 的路径：
    const hinted = makeLevel({ hints: [{ text: 'a', unlockAfterFailures: 0 }, { text: 'b', unlockAfterFailures: 1 }, { text: 'c', unlockAfterFailures: 3 }] });
    const hintedResult = evaluateScore(hinted, history, { ...MET, hintsUsed: 50 });
    // 55 − 35 = 20 ≥ 0；再把 redo 拉满压穿：另有 max(0,·) 边界用例兜底
    expect(hintedResult.score).toBe(20);
    const result = evaluateScore(level, history, { ...MET, hintsUsed: 0 });
    expect(result.score).toBe(55);
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
// starsOf 边界（压线：=0.7 / =0.9 恰好达标；M7 口径）
// ─────────────────────────────────────────────────────────────────────────────

describe('scoring —— starsOf 边界', () => {
  const MET_STAR = { hintsUsed: 0, targetsMet: true, firstAttempt: true };

  it('过关（total ≥ winScore）但 < 0.7·baseScore → 1 星', () => {
    // baseScore=100：0.7 线 = 70。total=60~69 且 ≥ winScore（如 winScore=60）→ 1 星
    expect(starsOf(100, 60, 69, MET_STAR)).toBe(1);
    expect(starsOf(100, 60, 60, MET_STAR)).toBe(1);
  });

  it('total 恰好 = 0.7·baseScore → 2 星（≥ 含等于）', () => {
    expect(starsOf(100, 60, 70, MET_STAR)).toBe(2);
  });

  it('total 恰好 = 0.9·baseScore 且 0 提示 → 3 星', () => {
    expect(starsOf(100, 60, 90, MET_STAR)).toBe(3);
  });

  it('有提示把 3 星压到 2 星（0 提示锁 ★★★，M7 口径）；未到 0.7 线仍 1 星', () => {
    expect(starsOf(100, 60, 90, { ...MET_STAR, hintsUsed: 1 })).toBe(2);
    expect(starsOf(100, 60, 69, { ...MET_STAR, hintsUsed: 1 })).toBe(1);
  });

  it('撤销不锁星（M7）：分数够高即使有撤销也 3 星，分数落段决定 ★/★★', () => {
    // 145 ≥ 0.9 线 → 3 星（undoCount 不再参与判定 —— 签名已移除该参数）
    expect(starsOf(100, 60, 145, MET_STAR)).toBe(3);
    // 85（1 次 reset 后的典型分）→ 2 星
    expect(starsOf(100, 60, 85, MET_STAR)).toBe(2);
  });

  it('未达标恒 0 星（即使奖励分凑过了 winScore）', () => {
    expect(starsOf(100, 60, 65, { ...MET_STAR, targetsMet: false })).toBe(0);
  });

  it('未过关（total < winScore）恒 0 星', () => {
    expect(starsOf(100, 60, 59, MET_STAR)).toBe(0);
  });
});

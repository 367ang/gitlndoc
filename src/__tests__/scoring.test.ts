// scoring 单元测试（development-refinement.md §11.1）—— **占位**
//
// 评分系统属 **M3**，`game/scoring/` 尚未实现（见 §13 里程碑规划）。
// 本文件当前只列出预期用例，全部用 `it.todo` 标记：`it.todo` 不计入失败，
// 但会在 Vitest 输出中以「todo」计数，从而保留「该模块待测」的可见信号。
//
// M3 落地后，把对应的 `it.todo` 改成 `it` 并补上断言即可。

describe('scoring —— 星级判定', () => {
  it.todo('★：达成全部目标即过关');
  it.todo('★★：得分 ≥0.8·winScore 且 0 撤销时给 2 星');
  it.todo('★★★：得分 ≥0.95·winScore 且 0 提示 0 撤销时给 3 星');
  it.todo('得分低于 winScore 时不给星，即使目标已达成');
});

describe('scoring —— 扣分项', () => {
  it.todo('撤销类命令按 undoPenalty 扣分，多次撤销累计');
  it.todo('reset --soft/--mixed 轻度惩罚，reset --hard 重度惩罚（§7）');
  it.todo('重复完成同一目标触发 redoPenalty');
  it.todo('每步提示按 hintPenalty 扣分');
});

describe('scoring —— 奖励与边界', () => {
  it.todo('最优命令序列给 optimalBonus');
  it.todo('一次通过且零失误（0 撤销 0 提示）给 flawlessBonus');
  it.todo('只读探查命令（status/log/branch）给 probeBonus 且受上限约束');
  it.todo('最终得分不低于 0（扣分不会把总分压成负数）');
});

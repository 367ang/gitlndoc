// 组件测试（development-refinement.md §11.2）—— **占位**
//
// 依赖 `src/ui/` 成型（Terminal / GoalPanel / Hints 等组件），属 **M2+**。
// 目前 `ui/` 尚未交付，故本文件用 `it.todo` 保留用例清单：
// `it.todo` 不计入失败，不会让 `pnpm test` 变红。
//
// M2 落地后建议用 @testing-library/react（已在 devDependencies 中）改写为真实用例。

describe('components —— Terminal', () => {
  it.todo('输入回车后把命令追加到历史列表');
  it.todo('命令执行失败时以错误样式渲染 error 文案');
  it.todo('Tab 键触发命令补全（M4）');
});

describe('components —— GoalPanel', () => {
  it.todo('已达成目标显示打勾，未达成显示未勾选');
  it.todo('目标状态随命令执行结果实时刷新');
});

describe('components —— Hints', () => {
  it.todo('提示按失败次数逐步解锁（unlockAfterFailures）');
  it.todo('查看提示后触发 hintPenalty 记录（M3）');
});

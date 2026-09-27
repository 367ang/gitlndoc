/**
 * 段2：ch3 全关冒烟（方案 A 分段版）
 *
 * 前置：同段1。种子 ch1+ch2 全通关 → ch3 应解锁。
 * 覆盖：半拼骨架预填（3-1~3-6 进关即断言 preview）、branch/checkout/switch、
 *       merge ff（3-3）、**冲突消解全链路（3-4）**、rebase + logOrder（3-5）、
 *       merge collaborative（3-6）、GitGraph/BranchPanel 渲染、汇总 14/14。
 */
const H = require('./cdp-client.cjs');

(async () => {
  await H.connect();
  await H.installCounter();
  await H.openApp();

  // ── 种子：ch1+ch2 全通关 → ch3 解锁 ──
  await H.seedProgress([
    'ch1-1', 'ch1-2', 'ch1-3', 'ch1-4',
    'ch2-1', 'ch2-2', 'ch2-3', 'ch2-4',
  ]);
  await H.waitFor(
    `document.querySelector('[aria-label="直接开始 ch3-1 分裂宇宙"]')?.disabled === false`,
    'ch2 全通关后 ch3 解锁',
  );
  H.check('ch1+ch2 全通关 → ch3 解锁', true);

  // ── 3-1 分裂宇宙（半拼：骨架 git branch 预填断言）──
  await H.enterLevel('ch3-1', '分裂宇宙');
  const preview31 = await H.evalJs(`document.querySelector('[data-testid="command-preview"]')?.textContent`);
  H.check('3-1 半拼骨架预填（git branch）', preview31 === 'git branch', preview31);
  await H.typeSuffix(' dev');
  await H.runCommand();
  // main 观测推进（编辑器改 base.md → add → commit）
  await H.editFile('base.md', '平行宇宙观测站 · 基线\n\n主时间线（main）是唯一的权威宇宙。\n任何新的观测分支都必须从它出发，最终也归向它。\n\nmain 的观测又前进一步。\n');
  await H.runAdd('base.md');
  await H.runCommit('"main 观测推进"');
  await H.waitSettled('ch3-1');
  H.check('3-1 通关（branch 创建不切换 + main 推进）', true);
  await H.backToMenu();

  // ── 3-2 穿越宇宙（骨架 git checkout；切 feature + 归档）──
  await H.enterLevel('ch3-2', '穿越宇宙');
  const preview32 = await H.evalJs(`document.querySelector('[data-testid="command-preview"]')?.textContent`);
  H.check('3-2 半拼骨架预填（git checkout）', preview32 === 'git checkout', preview32);
  await H.typeSuffix(' feature');
  await H.runCommand();
  await H.editFile('base.md', '平行宇宙观测站 · 基线\n\n（feature 分支已立起）\n\nfeature 的新观测。\n');
  await H.runAdd('base.md');
  await H.runCommit('"feature 观测"');
  await H.waitSettled('ch3-2');
  H.check('3-2 通关（切换 + feature 归档）', true);
  await H.backToMenu();

  // ── 3-3 合并宇宙（骨架 git merge；ff 合并）──
  await H.enterLevel('ch3-3', '合并宇宙');
  const preview33 = await H.evalJs(`document.querySelector('[data-testid="command-preview"]')?.textContent`);
  H.check('3-3 半拼骨架预填（git merge）', preview33 === 'git merge', preview33);
  await H.typeSuffix(' feature');
  await H.runCommand();
  await H.waitSettled('ch3-3');
  H.check('3-3 通关（merge feature）', true);
  // GitGraph / BranchPanel 在关卡页渲染（下一关入口前检查）
  await H.backToMenu();

  // ── 3-4 冲突消解（本段核心：冲突 → 编辑器裁决 → MERGE_HEAD 双亲提交）──
  await H.enterLevel('ch3-4', '冲突消解');
  await H.typeSuffix(' feature');
  await H.runCommand();
  // merge 后出现冲突输出（结算页未出现）——检查冲突标记已落工作区
  await H.waitFor(
    `(async () => {
      const m = await import('/src/store/sessionStore.ts');
      const last = m.useSessionStore.getState().history.at(-1);
      return last && last.ok && last.output.join('\\n').includes('冲突');
    })()`,
    'merge 冲突输出出现',
  );
  H.check('3-4 merge 报冲突（引擎拦截 + 提示）', true);
  // GitGraph / BranchPanel 渲染断言（分叉形态的关卡页）
  const graphOk = await H.waitFor(
    `!!document.querySelector('[data-testid="git-graph"]') && !!document.querySelector('[data-testid="branch-panel"]')`,
    'GitGraph 与 BranchPanel 渲染',
    8000,
  );
  H.check('关卡页渲染 GitGraph 与 BranchPanel', graphOk);
  // 编辑器解决冲突（裁决坐标 + 去标记）
  await H.editFile(
    'beacon.md',
    '信标坐标\n\n纬度：北纬 37.5\n经度：东经 105\n\n两个宇宙读数的折中，由你亲自裁决。\n',
  );
  await H.runAdd('.');
  await H.runCommit('"Merge branch \'feature\' into main"');
  await H.waitSettled('ch3-4');
  H.check('3-4 通关（冲突消解 → 双亲合并提交）', true);
  await H.backToMenu();

  // ── 3-5 变基重写（骨架 git checkout → rebase main）──
  await H.enterLevel('ch3-5', '变基重写');
  const preview35 = await H.evalJs(`document.querySelector('[data-testid="command-preview"]')?.textContent`);
  H.check('3-5 半拼骨架预填（git checkout）', preview35 === 'git checkout', preview35);
  await H.typeSuffix(' feature');
  await H.runCommand();
  await H.runGit('rebase', 'main');
  await H.waitSettled('ch3-5');
  H.check('3-5 通关（rebase 后 logOrder 成立）', true);
  await H.backToMenu();

  // ── 3-6 分支博弈（骨架 git merge collaborative）──
  await H.enterLevel('ch3-6', '分支博弈');
  await H.typeSuffix(' collaborative');
  await H.runCommand();
  await H.waitSettled('ch3-6');
  H.check('3-6 通关（merge collaborative）', true);

  // ── 终态：14/14 ──
  await H.backToMenu();
  const summary = await H.evalJs(`document.querySelector('[data-testid="progress-summary"]')?.textContent ?? ''`);
  H.check('汇总 14/14（全部通关）', summary.includes('通关 14/14'), summary.slice(0, 60));

  // 控制台无异常（页面级捕获）
  const ok = H.summarize('段2 ch3');
  process.exit(ok ? 0 : 1);
})().catch((error) => {
  console.error('段2 冒烟异常：', error.message);
  process.exit(2);
});

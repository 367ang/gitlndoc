/**
 * 段3：1-4 完整通关补测（M3 遗留 1）+ 未通关时的锁定态断言。
 *
 * ⚠️ M5a 起本段开头会 `resetStorage()` 清空持久化进度（进度已落 localStorage）。
 *
 * M3 遗留：1-4「历史之链」的完整通关需要「制造新改动」的玩家手段 ——
 * M4 的文件编辑器（含新建文件入口）落地后补此验收。
 * 流程：不种任何进度（验证未通关时 ch2/ch3 锁定）→ 通关 1-1~1-3 →
 *       1-4 第一环 → 新建文件制造第二环改动 → 归档 → 过关。
 */
const H = require('./cdp-client.cjs');

(async () => {
  await H.connect();
  await H.installCounter();
  // ⚠️ M5a：本段断言「无进度时 ch2 锁定」，故必须先清掉持久化进度 ——
  //    否则上一次冒烟留下的记录会让 ch2 直接是解锁态（实测失败）。
  await H.resetStorage();
  await H.openApp();

  // ── 无进度：ch2/ch3 锁定 ──
  const ch2Disabled = await H.evalJs(`document.querySelector('[aria-label="直接开始 ch2-1 状态感知"]')?.disabled ?? null`);
  H.check('无进度时 ch2 锁定', ch2Disabled === true, `disabled=${ch2Disabled}`);
  const lockVisible = await H.evalJs(`document.body.textContent.includes('🔒 完成上一章全部关卡后解锁')`);
  H.check('锁定文案可见（🔒）', lockVisible);

  // ── 1-1 ~ 1-3 逐关通关（拼接输入）──
  await H.enterLevel('ch1-1', '时间线初始化');
  await H.runGit('init');
  await H.runAdd('.');
  await H.runCommit('"初始化时间线"');
  await H.waitSettled('ch1-1');
  H.check('1-1 通关', true);
  // 「进入下一关 ch1-2」直达
  await H.evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('进入下一关 ch1-2')); if (b) b.click(); return 1; })()`);
  await H.waitFor(
    `!!document.querySelector('[data-testid="command-preview"]') && document.body.innerText.includes('ch1-2')`,
    '进入 1-2',
  );
  await H.runAdd('.');
  await H.runCommit('"第一次快照"');
  await H.waitSettled('ch1-2');
  H.check('1-2 通关', true);
  await H.evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('进入下一关 ch1-3')); if (b) b.click(); return 1; })()`);
  await H.waitFor(
    `!!document.querySelector('[data-testid="command-preview"]') && document.body.innerText.includes('ch1-3')`,
    '进入 1-3',
  );
  await H.runAdd('.');
  await H.runCommit('"归档三态笔记"');
  await H.waitSettled('ch1-3');
  H.check('1-3 通关', true);
  await H.evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('进入下一关 ch1-4')); if (b) b.click(); return 1; })()`);
  await H.waitFor(
    `!!document.querySelector('[data-testid="command-preview"]') && document.body.innerText.includes('ch1-4')`,
    '进入 1-4',
  );

  // ── 1-4：第一环 → 编辑器新建第二环 → 归档 → 过关 ──
  await H.runAdd('.');
  await H.runCommit('"第一环：链条起点"');
  // 第一环后目标未全达成（commitCount>=2）→ 仍在关卡页
  const firstRingDone = await H.evalJs(
    `(async () => {
      const m = await import('/src/store/sessionStore.ts');
      return m.useSessionStore.getState().history.filter(e => e.ok && e.input.startsWith('git commit')).length;
    })()`,
  );
  H.check('1-4 第一环归档（1 commit）', firstRingDone === 1, `commits=${firstRingDone}`);
  // 编辑器新建第二环文件（M4 编辑器能力 = M3 遗留的解法）
  await H.editFile('notes/second-ring.md', '时间线修复日志 · 第二环\n\n由文件编辑器新建并归档，链条因此延长。\n');
  await H.runAdd('.');
  await H.runCommit('"第二环：链条延长"');
  await H.waitSettled('ch1-4');
  H.check('1-4 完整通关（编辑器制造新改动 → 第二环归档）', true);

  // ── 通关后：ch2 解锁 ──
  await H.backToMenu();
  await H.waitFor(
    `document.querySelector('[aria-label="直接开始 ch2-1 状态感知"]')?.disabled === false`,
    'ch1 全通关后 ch2 解锁',
  );
  H.check('ch1 全通关 → ch2 解锁（M3 遗留闭环）', true);

  const ok = H.summarize('段3 legacy 1-4');
  process.exit(ok ? 0 : 1);
})().catch((error) => {
  console.error('段3 冒烟异常：', error.message);
  process.exit(2);
});

/**
 * 段1：ch2 全关冒烟（方案 A 分段版）
 *
 * 前置：Chrome headless + CDP（9223）已启动；Vite dev（5199）已启动。
 * 流程：种子 ch1 全通关 → 验 ch2 解锁 → 依次通关 2-1 ~ 2-4 → 断言汇总通关数。
 *
 * ⚠️ M5a：关卡总数从 14 变为 **20**（ch5 六关已注册），故汇总断言的
 *    分母随之更新；通关数仍是 8（ch1 四关 + ch2 四关）。
 * 覆盖：章节解锁、probeBonus 场景（2-1 status 探查）、文件编辑器（2-2/2-4）、
 *       rm 真删（2-4）、.gitignore 生效（2-4 收尾 workdirClean）。
 */
const H = require('./cdp-client.cjs');

(async () => {
  await H.connect();
  await H.installCounter();
  // ⚠️ M5a：先清持久化进度，避免上一次冒烟留下的记录影响本次断言
  //    （种子会整体覆盖 levelRecords，但快照与设置键仍可能残留）。
  await H.resetStorage();
  await H.openApp();

  // ── 种子：ch1 全通关 → ch2 应解锁 ──
  // ⚠️ 进度在内存 store（M5 才持久化）—— **不可 reload**（实测：reload 清空种子）。
  // zustand setState 会触发 MenuScreen 重渲染，解锁态即时生效。
  await H.seedProgress(['ch1-1', 'ch1-2', 'ch1-3', 'ch1-4']);
  await H.waitFor(
    `document.querySelector('[aria-label="直接开始 ch2-1 状态感知"]')?.disabled === false`,
    'ch1 全通关后 ch2 解锁（按钮可用）',
  );
  H.check('ch1 全通关 → ch2 解锁', true);
  const ch3Disabled = await H.evalJs(`document.querySelector('[aria-label="直接开始 ch3-1 分裂宇宙"]')?.disabled ?? null`);
  H.check('ch3 仍锁定（未通关 ch2）', ch3Disabled === true, `disabled=${ch3Disabled}`);

  // ── 2-1 状态感知：status（探查）→ add . → commit ──
  await H.enterLevel('ch2-1', '状态感知');
  await H.runGit('status'); // probeBonus 场景：只读探查不报错即算通过（加分在结算页验证）
  await H.runAdd('.');
  await H.runCommit('"归档待归档观测"');
  await H.waitSettled('ch2-1');
  const settle21 = await H.evalJs(`document.body.innerText.match(/\\d+ 分/)?.[0]`);
  H.check('2-1 通关（结算出现得分）', true, settle21);
  await H.backToMenu();

  // ── 2-2 记录变更：编辑器改 diary → add diary.md → commit ──
  await H.enterLevel('ch2-2', '记录变更');
  await H.editFile('diary.md', '修复日记 · 定稿\n\n修复要点：时间线校准完成。\n');
  await H.runAdd('diary.md');
  await H.runCommit('"记录修复要点"');
  await H.waitSettled('ch2-2');
  H.check('2-2 通关（编辑器改动 + 语义化提交信息）', true);
  await H.backToMenu();

  // ── 2-3 日志回溯：log --oneline（探查）→ 编辑 third.md 续写 → add . → commit ──
  await H.enterLevel('ch2-3', '日志回溯');
  await H.runGit('log', '--oneline');
  await H.editFile('third.md', '回溯档案 · 第三页\n\n最新的记录：阅读历史时，最近的事排在最前。\n续写草稿已并入，回溯完成。\n');
  await H.runAdd('.');
  await H.runCommit('"续写回溯档案"');
  await H.waitSettled('ch2-3');
  H.check('2-3 通关（log 阅读历史 + 续写归档）', true);
  await H.backToMenu();

  // ── 2-4 移除与忽略：rm secrets → commit → 新建 .gitignore → add → commit ──
  await H.enterLevel('ch2-4', '移除与忽略');
  await H.runGit('rm', 'secrets.log');
  await H.runCommit('"移除密钥残片"');
  // .gitignore 不存在 → 树里没有 → 走「新建文件」入口
  await H.editFile('.gitignore', 'cache.log\n');
  await H.runAdd('.gitignore');
  await H.runCommit('"忽略缓存噪声"');
  await H.waitSettled('ch2-4');
  H.check('2-4 通关（rm 真删 + .gitignore 忽略 untracked）', true);
  await H.backToMenu();

  // ── 终态：ch2 全通关，ch3 解锁 ──
  await H.waitFor(
    `document.querySelector('[aria-label="直接开始 ch3-1 分裂宇宙"]')?.disabled === false`,
    'ch2 全通关后 ch3 解锁',
  );
  H.check('ch2 全通关 → ch3 解锁', true);
  const summary = await H.evalJs(`document.querySelector('[data-testid="progress-summary"]')?.textContent ?? ''`);
  // ⚠️ M5a：总关卡数 14 → 20（ch5 注册），通关数 8 不变
  H.check('汇总 8/20', summary.includes('通关 8/20'), summary.slice(0, 60));

  const ok = H.summarize('段1 ch2');
  process.exit(ok ? 0 : 1);
})().catch((error) => {
  console.error('段1 冒烟异常：', error.message);
  process.exit(2);
});

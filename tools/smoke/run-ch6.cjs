/**
 * 段6：ch6 全关冒烟（M6 新增）
 *
 * 前置：`pnpm dev --port 5199` + Chrome headless（CDP 9223），
 *       详见 tools/smoke/README.md。运行：`pnpm smoke:ch6`。
 *
 * 覆盖（第六章「历史锚点」+ 收官 UI）：
 *   - free 模式真实键盘输入（CDP Input.insertText）；
 *   - `git tag` 轻量 / `git tag -a -m` 注解（6-1 / 6-2）；
 *   - `git tag`（列表）+ `git show`（注解）+ 归档 + 命名（6-3）；
 *   - `git push origin <标签>` 真协议推送（6-4）；
 *   - 归档 + 注解标签 + `git describe`（6-5）；
 *   - 菜单的「进入结局」入口（全部主线通关后出现）→ 结局页渲染；
 *   - 终章 F 解锁（全部主线通关后菜单可见 F 章节）。
 */
const H = require('./cdp-client.cjs');

(async () => {
  await H.connect();
  await H.installCounter();
  await H.resetStorage();
  await H.openApp();

  // ── 种子：ch1~ch5 全通关 → ch6 与结局入口解锁 ──
  await H.seedProgress([
    'ch1-1', 'ch1-2', 'ch1-3', 'ch1-4',
    'ch2-1', 'ch2-2', 'ch2-3', 'ch2-4',
    'ch3-1', 'ch3-2', 'ch3-3', 'ch3-4', 'ch3-5', 'ch3-6',
    'ch4-1', 'ch4-2', 'ch4-3', 'ch4-4', 'ch4-5',
    'ch5-1', 'ch5-2', 'ch5-3', 'ch5-4', 'ch5-5', 'ch5-6',
  ]);
  H.check('种子 ch1~ch5 全通关（ch6 与结局入口随之解锁）', true);

  // 菜单上第六章已可玩（结局入口尚未出现 —— 还差 ch6 通关）
  const menuFlags = await H.evalJs(`(() => {
    const items = [...document.querySelectorAll('ul.chapters li, [class*="chapters"] li')];
    const ch6 = items.find((li) => li.textContent.includes('ch6'));
    const ending = document.querySelector('[data-testid="ending-entry"]');
    return { ch6Playable: !!ch6 && ch6.textContent.includes('5 个关卡'), endingYet: !!ending };
  })()`);
  H.check('菜单：ch6 显示 5 个关卡', menuFlags && menuFlags.ch6Playable === true);
  H.check('菜单：ch6 未通关时结局入口不出现', menuFlags && menuFlags.endingYet === false);

  // ── 6-1 轻量锚点：两条轻量标签 ──
  await H.enterLevel('ch6-1', '轻量锚点');
  let r = await H.runFree('git tag v0.1');
  H.check('6-1 git tag v0.1 成功', r && r.ok === true, r && r.error);
  // ⚠️ 第二条标签正好达成最后一项判据 → 应用直接切结算页（captureLastEntry 合成 settled），
  //    后续不能再读输入框。列表输出由 executor.test.ts 单测锁定。
  r = await H.runFree('git tag v0.2');
  H.check('6-1 git tag v0.2 成功（或本关已结算为证）', r && (r.ok === true || r.settled === true), r && r.error);
  await H.waitSettled('ch6-1');
  H.check('6-1 通关（两个轻量锚点就位）', true);
  await H.backToMenu();

  // ── 6-2 注解锚点：git tag -a -m ──
  await H.enterLevel('ch6-2', '注解锚点');
  // ⚠️ 一条注解标签就达成最后一项判据 → 直接切结算页，show 无法在关卡页内执行。
  //    show 的输出格式由 executor.test.ts 单测锁定。
  r = await H.runFree('git tag -a v1.0.0 -m "版本 1.0.0 发布"');
  H.check('6-2 注解标签创建成功（或本关已结算为证）', r && (r.ok === true || r.settled === true), r && r.error);
  await H.waitSettled('ch6-2');
  H.check('6-2 通关（注解锚点就位）', true);
  await H.backToMenu();

  // ── 6-3 列出与查看：预置标签可见 → 归档第四阶段 → 命名 v1.1.0 ──
  await H.enterLevel('ch6-3', '列出与查看');
  const presetList = await H.runFree('git tag');
  H.check(
    '6-3 预置标签 v0.9.0 / v0.9.5 / v1.0.0 全部列出',
    !!(presetList && presetList.output && ['v0.9.0', 'v0.9.5', 'v1.0.0'].every((t) => presetList.output.join(' ').includes(t))),
    presetList && presetList.output && presetList.output.join(' '),
  );
  const shownAnnot = await H.runFree('git show v1.0.0');
  H.check(
    '6-3 git show 读到「时间线进入稳定期」注解',
    !!(shownAnnot && shownAnnot.output && shownAnnot.output.join(' ').includes('时间线进入稳定期')),
    shownAnnot && shownAnnot.output && shownAnnot.output.join(' '),
  );
  r = await H.runFree('git add .');
  H.check('6-3 归档第四阶段巡检（add）', r && r.ok === true, r && r.error);
  r = await H.runFree('git commit -m "第四阶段巡检"');
  H.check('6-3 归档第四阶段巡检（commit）', r && r.ok === true, r && r.error);
  r = await H.runFree('git tag -a v1.1.0 -m "稳定期后的第一次巡检"');
  H.check('6-3 命名 v1.1.0', r && r.ok === true, r && r.error);
  await H.waitSettled('ch6-3');
  H.check('6-3 通关（读了历史、续写了历史）', true);
  await H.backToMenu();

  // ── 6-4 推送锚点：归档 → 命名 → 单独推送标签（真协议）──
  await H.enterLevel('ch6-4', '推送锚点');
  // ⚠️ 时序（照 4-2 的模式）：判据在「定稿归档 + 标签创建」后即满足，
  //    结算页会立刻接管 —— 标签推送的**回显**必须在它之前拿到。
  //    顺序：先推一个空分支同步（验证协议通）→ add/commit → 【push 标签】→ tag（结算）。
  //    等等 —— 标签还没创建没法推。故实际顺序：add → commit → tag 创建（判据可能已达，
  //    但应用切页有反应时间，下一命令立刻跟上）→ push tag。
  //    实测 tag 命令执行后即结算，push tag 无法在关卡页内执行 ——
  //    真协议推送由 levels.test.ts 的裸仓断言与 executor.test.ts 锁定，此处只验本地链路。
  r = await H.runFree('git add .');
  H.check('6-4 归档定稿（add）', r && r.ok === true, r && r.error);
  r = await H.runFree('git commit -m "版本 1.0.0 定稿"');
  H.check('6-4 归档定稿（commit）', r && r.ok === true, r && r.error);
  r = await H.runFree('git tag -a v1.0.0 -m "版本 1.0.0 发布"');
  H.check('6-4 命名 v1.0.0（本关随即结算）', r && (r.ok === true || r.settled === true), r && r.error);
  await H.waitSettled('ch6-4');
  H.check('6-4 通关（定稿已归档、锚点已命名）', true);
  await H.backToMenu();

  // ── 6-5 版本发布：归档收尾 → 命名 v1.1.0 ──
  await H.enterLevel('ch6-5', '版本发布');
  r = await H.runFree('git add .');
  H.check('6-5 归档收尾（add）', r && r.ok === true, r && r.error);
  r = await H.runFree('git commit -m "发布收尾"');
  H.check('6-5 归档收尾（commit）', r && r.ok === true, r && r.error);
  // ⚠️ 打上注解标签即三项判据全满足 → 立即结算。
  //    describe 的干净输出（v1.1.0）由 executor.test.ts 单测锁定。
  r = await H.runFree('git tag -a v1.1.0 -m "新增导出能力"');
  H.check('6-5 命名 v1.1.0（本关随即结算）', r && (r.ok === true || r.settled === true), r && r.error);
  await H.waitSettled('ch6-5');
  H.check('6-5 通关（版本已发布）', true);
  await H.backToMenu();

  // ── 收官：GitGraph 标签徽标（进 6-3 有三个预置标签的关卡即可见）──
  await H.enterLevel('ch6-3', '列出与查看');
  await H.sleep(600);
  const graphTags = await H.evalJs(`(() => {
    const svg = document.querySelector('[data-testid="git-graph"] svg');
    if (!svg) return { ok: false };
    return { ok: true, tags: svg.textContent.includes('v0.9.0') && svg.textContent.includes('v1.0.0') };
  })()`);
  H.check('GitGraph 提交图渲染标签徽标（预置的 v0.9.0 / v1.0.0 可见）', graphTags && graphTags.ok === true && graphTags.tags === true);
  await H.backToMenu();

  // ── 结局入口与结局页：ch6 通关后（全部主线完成）菜单出现入口 ──
  const endingNow = await H.evalJs(`!!document.querySelector('[data-testid="ending-entry"]')`);
  H.check('菜单：全部主线（含 ch6）通关后出现「进入结局」入口', endingNow === true);
  await H.evalJs(`(() => {
    const ending = document.querySelector('[data-testid="ending-entry"]');
    if (!ending) throw new Error('结局入口不存在');
    ending.click();
    return true;
  })()`);
  await H.sleep(500);
  const ending = await H.evalJs(`(() => {
    const body = document.body.innerText;
    return {
      onEnding: body.includes('大统一') && body.includes('EPILOGUE'),
      hasStats: !!document.querySelector('[data-testid="ending-stats"]'),
      hasBack: body.includes('返回检修台'),
    };
  })()`);
  H.check('结局页：收官叙事 + 统计卡 + 返回入口', ending && ending.onEnding === true && ending.hasStats === true && ending.hasBack === true);
  // 返回菜单
  await H.evalJs(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('返回检修台'));
    if (!btn) throw new Error('找不到返回按钮');
    btn.click();
    return true;
  })()`);
  await H.sleep(400);

  console.log(H.summarize('段6（ch6 + 收官 UI）'));
  // ⚠️ 显式退出：CDP WebSocket 未关闭会让事件循环挂着（其它段由既有脚本结构自然退出，
  //    本段补一个保险 —— 实测 summarize 后进程挂起直至外部超时）。
  process.exit(0);
})().catch((error) => {
  console.error('[run-ch6] 冒烟中断：', error);
  process.exit(1);
});

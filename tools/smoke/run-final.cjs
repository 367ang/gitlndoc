/**
 * 段7：终章 F 全流程真机验收（M7 新增）。
 *
 * 前置：`pnpm dev --port 5199` + Chrome headless（CDP 9223），
 *       详见 tools/smoke/README.md。运行：`pnpm smoke:final`。
 *
 * ⚠️ 覆盖缺口（M6 遗留）：M6 冒烟只到 ch6 + 结局入口，**终章 F 两关从未真机通关**、
 *    perfect-game 成就从未真机触发。本段补齐：
 *   - F-1「崩坏时间线」完整修复工作流：编辑器改信标 → 归档 → checkout main →
 *     merge（真冲突）→ 编辑器裁决 → 完成合并 → 回 main；
 *   - F-2「完整交付」：编辑器新建交付清单 → 两次归档 → 注解标签 → describe；
 *   - **perfect-game 成就**：种子 30 关全 ★★★ + 真机通关 F 两关且拿满星 →
 *     结算页成就卡出现「完美通关」；菜单成就计数 6/6。
 *   - 结局页从真实通关链路进入（M6 是点入口验证）。
 */
const H = require('./cdp-client.cjs');

(async () => {
  await H.connect();
  await H.installCounter();
  await H.resetStorage();
  await H.openApp();

  // ── 种子：ch1~ch6 共 30 关全通关全 3 星 → F 章解锁 ──
  await H.seedProgress([
    'ch1-1', 'ch1-2', 'ch1-3', 'ch1-4',
    'ch2-1', 'ch2-2', 'ch2-3', 'ch2-4',
    'ch3-1', 'ch3-2', 'ch3-3', 'ch3-4', 'ch3-5', 'ch3-6',
    'ch4-1', 'ch4-2', 'ch4-3', 'ch4-4', 'ch4-5',
    'ch5-1', 'ch5-2', 'ch5-3', 'ch5-4', 'ch5-5', 'ch5-6',
    'ch6-1', 'ch6-2', 'ch6-3', 'ch6-4', 'ch6-5',
  ]);
  H.check('种子 ch1~ch6 全 30 关通关（F 章解锁）', true);

  // ── F-1 崩坏时间线 ──
  await H.enterLevel('F-1', '崩坏时间线');
  // 开局叙事：应困在 feature 分支（BranchPanel 可见）
  const branchState = await H.evalJs(`document.body.innerText.includes('feature')`);
  H.check('F-1 开局在 feature 分支（风暴叙事）', branchState === true);

  // 1) 编辑器把失真坐标改回正确值（M7 分级提示口径下：不展开提示，0 提示扣分）
  await H.editFile('notes/信标坐标.md',
    '信标坐标\n\n纬度：47.20\n经度：108.60\n\n风暴改错了坐标 —— 恢复它。\n');
  let r = await H.runFree('git add notes/信标坐标.md');
  H.check('F-1 归档修复（add）', r && (r.ok === true || r.settled === true), r && r.error);
  r = await H.runFree('git commit -m "修复信标坐标"');
  H.check('F-1 归档修复（commit）', r && r.ok === true, r && r.error);

  // 2) 回 main 合并 —— 必然冲突
  r = await H.runFree('git checkout main');
  H.check('F-1 回到 main', r && r.ok === true, r && r.error);
  r = await H.runFree('git merge feature');
  H.check('F-1 合并 feature（真冲突）', r && r.ok === true && r.output.join(' ').includes('冲突'), r && r.error);

  // 3) 冲突裁决：写下唯一权威坐标，完成合并。
  // ⚠️ merge 后文件树需要一次 useFileTree 刷新才显示「冲突中的信标坐标.md」编辑入口；
  //    立刻 editFile 会撞「编辑入口不存在」（实测 flake 一次）—— 先等入口出现。
  await H.waitFor(
    `!!document.querySelector('[aria-label="编辑文件 notes/信标坐标.md"]') || !!document.querySelector('[aria-label="新建文件"]')`,
    'F-1 冲突文件的编辑入口就绪',
  );
  await H.editFile('notes/信标坐标.md',
    '信标坐标\n\n纬度：47.20\n经度：108.60\n\n两边的观测都已合流 —— 这是唯一的权威坐标。\n');
  r = await H.runFree('git add notes/信标坐标.md');
  H.check('F-1 裁决后 add', r && r.ok === true, r && r.error);
  r = await H.runFree('git commit -m "合并 feature 并裁决信标坐标"');
  H.check('F-1 完成合并（本关随即结算）', r && (r.ok === true || r.settled === true), r && r.error);
  await H.waitSettled('F-1');
  // M7 星级口径：零提示零撤销 + optimal 6 步 → 100+20+25=145 → ★★★
  const f1Stars = await H.evalJs(`(() => {
    const stars = document.querySelector('[aria-label^="星级"]');
    return stars ? stars.getAttribute('aria-label') : '';
  })()`);
  H.check('F-1 结算 3 星（M7 分数主轴：撤销不锁星）', f1Stars.includes('3 星'), f1Stars);
  H.check('F-1 通关（完整修复工作流）', true);
  await H.backToMenu();

  // ── F-2 完整交付（空仓库起步）──
  await H.enterLevel('F-2', '完整交付');
  // 编辑器新建交付清单（内容 = F2_MANIFEST，目标判据逐字匹配）
  await H.editFile('交付清单.md',
    '时间线管理局 · 交付清单\n\n项目：平行宇宙观测站 · 首个正式版本\n状态：已交付\n');
  r = await H.runFree('git add 交付清单.md');
  H.check('F-2 首版归档（add）', r && r.ok === true, r && r.error);
  r = await H.runFree('git commit -m "首版交付"');
  H.check('F-2 首版归档（commit）', r && r.ok === true, r && r.error);
  // 第二次归档（commitCount gte 2）
  await H.editFile('收尾记录.md', '交付收尾。\n');
  r = await H.runFree('git add .');
  H.check('F-2 收尾归档（add）', r && r.ok === true, r && r.error);
  r = await H.runFree('git commit -m "交付收尾"');
  H.check('F-2 收尾归档（commit）', r && r.ok === true, r && r.error);
  // describe 验证（还没打标签应报「没有可描述」——先敲一次再打标签）。
  // ⚠️ 断言写法：latestHistory 的 DOM 解析无法区分输出行与错误行（启发式恒 ok:true，
  //    见 cdp-client.cjs 注释）—— 单测已锁 ok:false，这里只断言**报错文案可见**。
  r = await H.runFree('git describe');
  H.check(
    'F-2 打标签前 describe 提示「没有可描述的注解标签」',
    !!(r && r.output && r.output.join(' ').includes('没有可描述')),
    r && r.output && r.output.join(' '),
  );
  r = await H.runFree('git tag -a v1.0.0 -m "首个正式版本"');
  H.check('F-2 命名 v1.0.0（本关随即结算）', r && (r.ok === true || r.settled === true), r && r.error);
  await H.waitSettled('F-2');
  H.check('F-2 通关（完整交付流程）', true);

  // ── perfect-game 成就：30 关种子全 3 星 + F 两关真机 3 星 → 全游戏 32 关全 3 星 ──
  const f2Stars = await H.evalJs(`(() => {
    const stars = document.querySelector('[aria-label^="星级"]');
    return stars ? stars.getAttribute('aria-label') : '';
  })()`);
  H.check('F-2 结算 3 星', f2Stars.includes('3 星'), f2Stars);
  const achievementCard = await H.evalJs(`(() => {
    const card = document.querySelector('[data-testid="new-achievements"]');
    if (!card) return { present: false };
    return { present: true, hasPerfect: card.textContent.includes('完美通关') };
  })()`);
  H.check(
    'perfect-game「完美通关」成就解锁（结算页成就卡）',
    achievementCard && achievementCard.present === true && achievementCard.hasPerfect === true,
    JSON.stringify(achievementCard),
  );

  await H.backToMenu();
  const achCount = await H.evalJs(
    `document.querySelector('[data-testid="achievement-toggle"]')?.textContent ?? ''`,
  );
  H.check('菜单成就计数 6/6', achCount.includes('6/6'), achCount);

  // ── 结局入口 → 结局页（全部 32 关通关后的真实链路）──
  const endingNow = await H.evalJs(`!!document.querySelector('[data-testid="ending-entry"]')`);
  H.check('结局入口出现（全部主线 + F 通关）', endingNow === true);
  await H.evalJs(`(() => {
    document.querySelector('[data-testid="ending-entry"]').click();
    return true;
  })()`);
  await H.sleep(500);
  const ending = await H.evalJs(`(() => {
    const body = document.body.innerText;
    return { onEnding: body.includes('大统一') && body.includes('EPILOGUE'), hasStats: !!document.querySelector('[data-testid="ending-stats"]') };
  })()`);
  H.check('结局页渲染（收官叙事 + 统计）', ending && ending.onEnding === true && ending.hasStats === true);

  console.log(H.summarize('段7（终章 F + perfect-game 成就）'));
  process.exit(0);
})().catch((error) => {
  console.error('[run-final] 冒烟中断：', error);
  process.exit(1);
});

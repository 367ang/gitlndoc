/**
 * 段4：ch5 全关冒烟（M5a 新增）
 *
 * 前置：`pnpm dev --port 5199` + Chrome headless（CDP 9223），
 *       详见 tools/smoke/README.md。运行：`pnpm smoke:ch5`。
 *
 * 覆盖（第五章「时空回溯」）：
 *   - 自由输入（free）模式：**走真实键盘输入**（CDP Input.insertText）——
 *     jsdom 的 fireEvent.change 不受 readOnly 限制，只有真实浏览器能验这一环
 *     （M2 教训 3）；
 *   - `git commit --amend`（5-1）：提交数不变、提交信息被改写；
 *   - `git restore --staged`（5-2）：索引回退、工作区内容保住；
 *   - `git restore <file>`（5-3）：工作区回到归档版本（含被误删文件的找回）；
 *   - `git revert`（5-4 / 5-5）：历史向前延伸而非被改写；
 *   - `git reflog` + `HEAD@{n}`（5-6）：**完整破坏与恢复剧本**；
 *   - 各关结算页与章节解锁链路。
 *
 * ⚠️ 种子策略：M5a 起进度已持久化到 localStorage，但 `seedProgress` 仍走
 *   应用内 store（`useProgressStore.setState`）+ 其内部落盘，故 **reload 后仍在**
 *   —— 这正是 M4 遗留 1 要求的复核点，本脚本在末尾专门断言一次。
 */
const H = require('./cdp-client.cjs');

(async () => {
  await H.connect();
  await H.installCounter();
  // ⚠️ 必须先清持久化状态：M5a 起进度落 localStorage，且**刷新会自动恢复
  //    上次所在的关卡** —— 上一次冒烟跑到 5-3 就中断的话，这次 boot 会直接
  //    恢复到 5-3，脚本却停在菜单等着进 5-1，于是超时（实测踩到）。
  await H.resetStorage();
  await H.openApp();

  // ── 种子：ch1~ch4 全通关 → ch5 解锁 ──
  //
  // ⚠️ **M5b 起 ch4 已落地 5 关**，解锁规则随之自动回到「逐级相邻」：
  //    ch5 的前一个有卡章节是 ch4，故必须 ch4 全通关才能解锁 ch5。
  //    （M5a 期间 ch4 无关卡、会被跳过，种到 ch3 即可 —— 那段说明已成为历史。）
  //    本脚本仍走「直接进关」的路径，以缩短冒烟耗时。
  await H.seedProgress([
    'ch1-1', 'ch1-2', 'ch1-3', 'ch1-4',
    'ch2-1', 'ch2-2', 'ch2-3', 'ch2-4',
    'ch3-1', 'ch3-2', 'ch3-3', 'ch3-4', 'ch3-5', 'ch3-6',
    'ch4-1', 'ch4-2', 'ch4-3', 'ch4-4', 'ch4-5',
  ]);
  H.check('种子 ch1~ch4 全通关（M5b 起 ch5 要求 ch4 全通关）', true);

  // ── 5-1 修正笔误：add 漏掉的文件 + commit --amend ──
  await H.enterLevel('ch5-1', '修正笔误');
  const freeInput = await H.evalJs(`!!document.querySelector('[aria-label="命令输入"]')`);
  H.check('5-1 进入自由输入模式（无拼接片段）', freeInput === true);

  let r = await H.runFree('git add notes/附录.md');
  H.check('5-1 git add 成功', r && r.ok === true, r && r.error);

  r = await H.runFree('git commit --amend -m "修复日志 · 定稿"');
  H.check('5-1 git commit --amend 成功', r && r.ok === true, r && r.error);
  // ⚠️ 5-1 的判据是 `commitMessage /定稿/`，**amend 一执行就过关**，
  //    命令历史面板随即卸载、读不到回显。故此处接受两种证据：
  //      - 读到了输出 → 断言真 git 风格的 `[main <短hash>] <信息>`；
  //      - 已结算     → 以「本关过关」为证（命令若失败不可能过关）。
  //    回显格式本身由 `executor.test.ts` 的单测逐字锁定（那才是合适的位置）。
  const amendEchoOk = r.settled === true
    || !!(r.output && r.output.join(' ').includes('修复日志 · 定稿'));
  H.check(
    '5-1 amend 回显含新提交信息（或本关已结算为证）',
    amendEchoOk,
    r.settled ? '(已结算)' : (r.output || []).join(' '),
  );

  await H.waitSettled('ch5-1');
  H.check('5-1 通关（修补而非新增）', true);
  await H.backToMenu();

  // ── 5-2 撤销暂存：编辑器补完结论 → add → restore --staged ──
  await H.enterLevel('ch5-2', '撤销暂存');
  // 先把「排查中」的草稿补成结论版（编辑器，不计命令数）
  await H.editFile(
    'notes/调试草稿.md',
    '调试草稿 · 定稿\n\n排查完成后补上的结论：时间线的偏移来自一次未同步的校准。\n这份结论要留着 —— 它还没到该归档的时候。\n',
  );

  // 误 add 进暂存区
  r = await H.runFree('git add notes/调试草稿.md');
  H.check('5-2 git add 草稿成功', r && r.ok === true, r && r.error);

  // 只退索引、保住工作区
  r = await H.runFree('git restore --staged notes/调试草稿.md');
  H.check('5-2 git restore --staged 成功', r && r.ok === true, r && r.error);

  // 归档该归档的那份
  r = await H.runFree('git add notes/观测补充.md');
  H.check('5-2 git add 观测补充成功', r && r.ok === true, r && r.error);
  r = await H.runFree('git commit -m "观测补充归档"');
  H.check('5-2 归档提交成功', r && r.ok === true, r && r.error);

  await H.waitSettled('ch5-2');
  H.check('5-2 通关（索引回退 + 工作区内容保住）', true);
  await H.backToMenu();

  // ── 5-3 丢弃改动：两条 restore（改乱恢复 + 误删找回）──
  await H.enterLevel('ch5-3', '丢弃改动');
  r = await H.runFree('git restore notes/时间线校准参数.md');
  H.check('5-3 restore 改乱的文件成功', r && r.ok === true, r && r.error);
  r = await H.runFree('git restore notes/关键档案.md');
  H.check('5-3 restore 找回被删的文件成功', r && r.ok === true, r && r.error);

  await H.waitSettled('ch5-3');
  H.check('5-3 通关（工作区回到归档版本）', true);
  await H.backToMenu();

  // ── 5-4 安全反转：revert 生成反向提交 ──
  await H.enterLevel('ch5-4', '安全反转');
  r = await H.runFree('git revert HEAD');
  H.check('5-4 git revert 成功', r && r.ok === true, r && r.error);
  const revertEchoOk = r.settled === true
    || !!(r.output && r.output.join(' ').includes('Revert'));
  H.check(
    '5-4 revert 提交信息为 Revert "<原信息>"（对齐真 git；已结算时以过关为证）',
    revertEchoOk,
    r.settled ? '(已结算)' : (r.output || []).join(' '),
  );

  await H.waitSettled('ch5-4');
  H.check('5-4 通关（历史向前延伸）', true);
  await H.backToMenu();

  // ── 5-5 危险与安全：已同步历史只能 revert ──
  await H.enterLevel('ch5-5', '危险与安全');
  r = await H.runFree('git revert HEAD');
  H.check('5-5 git revert 成功', r && r.ok === true, r && r.error);
  await H.waitSettled('ch5-5');
  H.check('5-5 通关（不改写公共历史）', true);
  await H.backToMenu();

  // ── 5-6 时间跳跃：完整「破坏 → reflog → 恢复」剧本 ──
  await H.enterLevel('ch5-6', '时间跳跃');

  // ⚠️ 顺序很关键（实测）：本关的目标包含 `workdirClean` 与 `commitCount eq 4`，
  //    而**归档残片后这两项都已满足 → 关卡立即结算**，输入框随之消失。
  //    因此必须**先制造破坏**（回退会让提交数掉到 2，目标重新不满足），
  //    再归档 —— 这样才走得完「破坏 → 查看 reflog → 恢复」的完整剧本。
  r = await H.runFree('git reset --hard HEAD~2');
  H.check('5-6 git reset --hard HEAD~2 成功（模拟误操作）', r && r.ok === true, r && r.error);
  H.check(
    '5-6 reset --hard 给出破坏性警示（提示可用 reflog 找回）',
    !!(r && r.output && r.output.join(' ').includes('reflog')),
    r && r.output && r.output.join(' '),
  );

  // 查看 reflog —— 格式必须与笔记 git-undo.md 逐字一致
  r = await H.runFree('git reflog');
  H.check('5-6 git reflog 成功', r && r.ok === true, r && r.error);
  const reflogText = (r && r.output ? r.output : []).join('\n');
  H.check(
    '5-6 reflog 首行格式与笔记一致（<短hash> HEAD@{0}: reset: moving to HEAD~2）',
    /^[0-9a-f]{7} HEAD@\{0\}: reset: moving to HEAD~2$/m.test(reflogText),
    reflogText.split('\n')[0],
  );
  H.check(
    '5-6 reflog 含更早的 commit 记录',
    reflogText.includes('HEAD@{1}: commit'),
    reflogText.slice(0, 160),
  );

  // 凭 reflog 恢复
  r = await H.runFree('git reset --hard HEAD@{1}');
  H.check('5-6 git reset --hard HEAD@{1} 恢复成功', r && r.ok === true, r && r.error);

  // 恢复后三份关键快照应重新在历史里
  //
  // ⚠️ 这一条**必须读到真实输出**：`git log --oneline` 是只读命令，
  //    不会让本关过关，故面板仍在、输出可读（若这里 settled 就说明判定有误）。
  r = await H.runFree('git log --oneline');
  if (r.settled) throw new Error('5-6: git log 不应改变关卡状态（命令历史不可读，说明判定有误）');
  const logText = (r && r.output ? r.output : []).join('\n');
  H.check('5-6 恢复后「关键快照三」回到历史', logText.includes('关键快照三'), logText);
  H.check(
    '5-6 恢复后提交数为 3（预置三份快照）',
    (r && r.output ? r.output.length : 0) === 3,
    String(r && r.output ? r.output.length : 0),
  );

  // 归档残片，让工作区回到干净（本关目标的最后一项）
  r = await H.runFree('git add .');
  H.check('5-6 git add . 成功', r && r.ok === true, r && r.error);
  r = await H.runFree('git commit -m "归档残片"');
  H.check('5-6 归档残片成功', r && r.ok === true, r && r.error);

  await H.waitSettled('ch5-6');
  H.check('5-6 通关（reflog 恢复剧本完整走通）', true);
  await H.backToMenu();

  // ── 持久化复核（M5a 的核心交付；M4 遗留 1）──
  const persisted = await H.evalJs(`(async () => {
    const mod = await import('/src/store/progressStore.ts');
    return mod.useProgressStore.getState().levelRecords['ch5-6']?.cleared === true;
  })()`);
  H.check('5-6 通关记录已写入 store', persisted === true);

  const raw = await H.evalJs(`localStorage.getItem('gtp:progress:v1')`);
  H.check(
    '进度已落 localStorage（gtp:progress:v1）',
    typeof raw === 'string' && raw.includes('ch5-6'),
    typeof raw === 'string' ? raw.slice(0, 120) : String(raw),
  );

  // ⚠️ M4 遗留 1 的复核：种子/进度在 reload 后是否仍在。
  //    ⚠️ 不能用 `evalJs('location.reload()')` —— 页面上下文在求值过程中被销毁，
  //    该 CDP 调用**永不返回**，脚本会静默挂死（实测）。改用 `H.reload()`，
  //    它走 `Page.navigate` 并等 `Page.loadEventFired`。
  await H.reload();
  await H.waitFor(
    `!!document.querySelector('[data-testid="progress-summary"]') || !!document.querySelector('[aria-label="命令输入"]')`,
    'reload 后应用恢复',
    30000,
  );
  const afterReload = await H.evalJs(`(async () => {
    const mod = await import('/src/store/progressStore.ts');
    return Object.keys(mod.useProgressStore.getState().levelRecords).length;
  })()`);
  H.check(
    'reload 后进度仍在（M5a 持久化生效，清偿 M4 遗留 1）',
    afterReload >= 15,
    `reload 后记录数=${afterReload}`,
  );

  // ── 刷新恢复：自动恢复关卡中途进度（M5a 用户裁定的产品口径）──
  //
  // ⚠️ 这是本段最重要的一组断言，且**只有真实浏览器能验**：
  //    jsdom 里 LightningFS 走 MemoryBackend，不写 IndexedDB，
  //    故「快照能否跨刷新读回」在单测中无法证明（见 persistence.ts 的说明）。
  //
  //    验收路径：进关 → 做几步操作 → reload → 应**仍在同一关**且仓库状态还在。
  await H.enterLevel('ch5-3', '丢弃改动');
  // 先恢复一个文件，制造「中途进度」（另一个先不管）
  let mid = await H.runFree('git restore notes/时间线校准参数.md');
  H.check('恢复前：执行一步 restore 成功', mid && mid.ok === true, mid && mid.error);
  H.check('关卡尚未过关（只完成一半）', (await H.evalJs(`!!document.querySelector('[aria-label="命令输入"]')`)) === true);

  const activeBefore = await H.evalJs(`localStorage.getItem('gtp:active-level:v1')`);
  H.check(
    '进关后已记下挂起关卡（gtp:active-level:v1）',
    typeof activeBefore === 'string' && activeBefore.includes('ch5-3'),
    typeof activeBefore === 'string' ? activeBefore : String(activeBefore),
  );

  // 刷新 —— 应自动恢复到 ch5-3，而不是回菜单
  await H.reload();
  await H.waitFor(
    `!!document.querySelector('[aria-label="命令输入"]')`,
    'reload 后自动回到关卡页（而非菜单）',
    30000,
  );
  // ⚠️ 判据走 **DOM** 而不是 `import('.../viewStore.ts')`：经 CDP 的 dynamic import
  //    拿到的不是应用正在用的模块实例（M5b 实测 sameModule === false），
  //    读 viewStore/sessionStore 会拿到初始态，断言必然假失败。
  //    DOM 判据：关卡页的输入组件在、顶栏含关卡 id，即为「回到了 ch5-3」。
  const viewAfterReload = await H.evalJs(`(() => {
    const onLevel = !!document.querySelector('[aria-label="命令输入"]')
      || !!document.querySelector('[data-testid="command-preview"]');
    return { onLevel, bodyHasLevel: document.body.innerText.includes('ch5-3') };
  })()`);
  H.check(
    'reload 后直接回到 ch5-3（视图为 level，未回菜单）',
    viewAfterReload.onLevel && viewAfterReload.bodyHasLevel,
    JSON.stringify(viewAfterReload),
  );

  // 仓库状态必须还在：先前 restore 过的文件应是归档版本
  const restoredContent = await H.evalJs(`(async () => {
    const fs = await import('/src/engine/fs.ts');
    try { return await fs.fsp.readFile('/repo/notes/时间线校准参数.md', 'utf8'); }
    catch (e) { return 'READ_FAIL:' + e.message; }
  })()`);
  H.check(
    'reload 后仓库内容仍在（先前 restore 的结果保留）',
    typeof restoredContent === 'string' && restoredContent.includes('阈值：0.75'),
    String(restoredContent).slice(0, 80),
  );

  // 继续通关本关（证明恢复后的会话是**可继续玩**的，不只是「看起来在关卡页」）
  mid = await H.runFree('git restore notes/关键档案.md');
  H.check('恢复后能继续操作（第二条 restore 成功）', mid && mid.ok === true, mid && mid.error);
  await H.waitSettled('ch5-3');
  H.check('恢复的会话可正常通关', true);
  await H.backToMenu();

  const activeCleared = await H.evalJs(`localStorage.getItem('gtp:active-level:v1')`);
  H.check(
    '离开关卡后挂起标记被清掉（避免刷新被拉回已结束的关卡）',
    activeCleared === null,
    String(activeCleared),
  );

  const ok = H.summarize('ch5');
  process.exit(ok ? 0 : 1);
})().catch((error) => {
  console.error('冒烟脚本异常：', error);
  process.exit(2);
});

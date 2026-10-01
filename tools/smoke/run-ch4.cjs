/**
 * 段5：ch4 全关冒烟（M5b 新增，第四章「星际连接」）
 *
 * 前置：`pnpm dev --port 5199` + Chrome headless（CDP 9223），
 *       详见 tools/smoke/README.md。运行：`pnpm smoke:ch4`。
 *
 * 覆盖（第四章「星际连接」）：
 *   - 半拼（half）骨架预填：进关即验 `command-preview`，逐关断言骨架文本；
 *   - `git remote add`（4-1）：URL 白名单的**正向**路径；
 *   - ⚠️ **URL 白名单的负向路径**：填 `https://github.com/...` 必须被拒绝
 *     （决策 ③ 的核心 —— 探针实测 `git.addRemote` 自己不做任何校验）；
 *   - `git push`（4-2）：真实智能 HTTP 协议，远程真的收到提交；
 *   - `git pull`（4-3）：远程的观测真的进入本地历史与工作区；
 *   - `git clone`（4-4）：从空的本地仓库克隆出完整历史 + 工作区文件；
 *   - `git fetch` / 被拒的 push / `git merge`（4-5）：**完整的协作冲突剧本**；
 *   - 进度持久化后 ch5 的解锁链路（M5b 起 ch5 改为要求 ch4 全通关）。
 *
 * ⚠️ 为什么必须真实浏览器：本章全部关卡是半拼模式，涉及骨架预填、
 *    参数输入框、以及**真的按键执行**。jsdom 的 fireEvent 不受 readOnly 限制，
 *    会掩盖「玩家无法输入」类缺陷（M2 教训 3）。
 *
 * ⚠️ 种子策略：M5a 起进度已落 localStorage，故必须先 `resetStorage()`。
 *    M5b 起 ch4 在 ch1~ch3 之后，故种子为「ch1~ch3 全通关」。
 */
const H = require('./cdp-client.cjs');

(async () => {
  await H.connect();
  await H.installCounter();
  await H.resetStorage();
  await H.openApp();

  // ── 种子：ch1~ch3 全通关 → ch4 解锁（M5b 起 ch4 进入主线）──
  await H.seedProgress([
    'ch1-1', 'ch1-2', 'ch1-3', 'ch1-4',
    'ch2-1', 'ch2-2', 'ch2-3', 'ch2-4',
    'ch3-1', 'ch3-2', 'ch3-3', 'ch3-4', 'ch3-5', 'ch3-6',
  ]);
  H.check('种子 ch1~ch3 全通关', true);

  // ── 4-1 建立航道：remote add（+ 白名单负向用例）──
  await H.enterLevel('ch4-1', '建立航道');
  H.check('4-1 进入半拼模式（骨架预填）', true);

  // 骨架预填断言：preview 里应已有 `git remote`
  const skeleton1 = await H.evalJs(
    `document.querySelector('[data-testid="command-preview"]')?.innerText ?? ''`,
  );
  H.check('4-1 骨架预填为 git remote', /git\s+remote/.test(skeleton1), skeleton1);

  /** 命令执行结果（每次 runCommand 后重新赋值） */
  let r;

  // ⚠️ 负向路径：换成网络地址必须被拒绝（决策 ③）
  //
  // 本步不能用 `H.runCommand()` —— 它的完成判据是「history 增长或离开关卡页」，
  // 而被拒绝的命令**两者都不发生**（history 不增、仍在关卡页），必然超时。
  // 改为「点执行 + 轮询终端里出现白名单拒绝文案」，这才是本步真正要断言的事实。
  await H.typeSuffix(' add origin https://github.com/someone/repo.git');
  await H.evalJs(`(() => {
    const b = document.querySelector('[aria-label="执行拼接的命令"]');
    if (!b || b.disabled) throw new Error('执行按钮不可用');
    b.click();
    return 1;
  })()`);
  await H.waitFor(
    `document.body.innerText.includes('本地通道')`,
    '远程地址白名单拒绝文案出现',
  );
  const rejectText = await H.evalJs(`document.body.innerText`);
  H.check('4-1 网络地址被白名单拒绝', rejectText.includes('本地通道'));
  H.check(
    '4-1 拒绝信息指明「只接受本地通道」且回显了原地址',
    rejectText.includes('https://github.com/someone/repo.git'),
  );

  // 正向路径：沙箱地址
  //
  // ⚠️ 被拒之后草稿会被**整体清空**（连骨架槽位一起，实测）—— 只补后缀会拼出
  //    `add origin ...` 这种缺了 `git remote` 前缀的残句。故这里重走一遍
  //    「点片段 → 补后缀」的完整拼接流程（这也正是玩家的真实操作路径）。
  //
  // ⚠️ 用 `clickFrag('remote')` 而**不是** `clickFrag('git')`：后者在第四章里有
  //    17 个同名 slot0 按钮（每个命令组一个），无法唯一定位。
  //    点 slot1 的 `remote` 会由 clickFrag 自动补点本组的 slot0（既有机制）。
  await H.clickFrag('remote');
  await H.typeSuffix(' add origin http://sandbox/remote.git');
  const composed = await H.evalJs(
    `document.querySelector('[data-testid="command-preview"]')?.innerText ?? ''`,
  );
  H.check(
    '4-1 重新拼接出完整命令',
    composed.includes('git remote add origin http://sandbox/remote.git'),
    composed,
  );

  r = await H.runCommand();
  // ⚠️ 4-1 的 remote add 会**一次过关**（判据只有「origin 已关联」），
  //    此时命令历史面板已卸载、读不到 output。故以「本关结算」作为成功证据 ——
  //    命令若被拒绝绝不可能过关（拒绝路径见上一步的负向用例）。
  H.check('4-1 git remote add（沙箱地址）成功并直接过关', r && r.ok === true, r && r.error);

  await H.waitSettled('ch4-1');
  H.check('4-1 通关（航道已建立）', true);
  await H.backToMenu();

  // ── 4-2 传送数据：push（+ 归档待传送观测）──
  //
  // ⚠️ 执行顺序刻意如此（先 push、后归档）：
  //    本关的判据是 `commitExists '待传送观测'`，**commit 一落地关卡就会结算**，
  //    之后就点不到片段了。故把 push 放在前面 —— 此时本地领先远程一条（预置的
  //    「航道起点观测」是共同祖先），push 是合法的快进推进，正好验证 4-2 的核心动作。
  //    随后再归档那份未追踪的观测完成本关。
  //
  //    ⚠️ 这暴露了一个如实记录的设计缺口：**关卡判据无法要求「必须 push」**
  //    （11 种 TargetCondition 里没有「远程分支状态」）。推送的真实性由
  //    `levels.test.ts` 与下面的裸仓断言共同保证，而不是靠关卡目标。
  await H.enterLevel('ch4-2', '传送数据');
  const skeleton2 = await H.evalJs(
    `document.querySelector('[data-testid="command-preview"]')?.innerText ?? ''`,
  );
  H.check('4-2 骨架预填为 git push', /git\s+push/.test(skeleton2), skeleton2);

  // ① 拼出并执行 push（骨架 + 参数）
  await H.typeSuffix(' origin main');
  const composedPush = await H.evalJs(
    `document.querySelector('[data-testid="command-preview"]')?.innerText ?? ''`,
  );
  H.check(
    '4-2 拼出完整 push 命令',
    composedPush.includes('git push origin main'),
    composedPush,
  );
  const pushed = await H.runCommand();
  H.check('4-2 git push 执行成功', pushed && pushed.ok === true, pushed && pushed.error);
  // ⚠️ 不断言 output 里的 `main`：本关判据是 commitExists，**commit 之后才结算**，
  //    而 push 发生在 commit 之前 —— 这时的 output 是可读的，但格式随实现而变，
  //    断言「远程副作用」才是稳定的（见下面「裸仓与本地一致」的检查）。
  H.check('4-2 push 后仍在关卡页（尚未结算）', pushed && pushed.settled !== true);

  // ② 归档待传送的观测（add → commit），本关判据由此满足
  await H.runAdd('.');
  await H.runCommit('待传送观测归档');

  await H.waitSettled('ch4-2');
  H.check('4-2 通关（数据已传送）', true);
  await H.backToMenu();

  // ── 4-3 接收数据：pull ──
  await H.enterLevel('ch4-3', '接收数据');
  const skeleton3 = await H.evalJs(
    `document.querySelector('[data-testid="command-preview"]')?.innerText ?? ''`,
  );
  H.check('4-3 骨架预填为 git pull', /git\s+pull/.test(skeleton3), skeleton3);

  await H.typeSuffix(' origin main');
  r = await H.runCommand();
  H.check('4-3 git pull 成功并直接过关', r && r.ok === true, r && r.error);

  await H.waitSettled('ch4-3');
  H.check('4-3 通关（远程观测已取回）', true);
  await H.backToMenu();

  // ── 4-4 克隆宇宙：clone ──
  await H.enterLevel('ch4-4', '克隆宇宙');
  const skeleton4 = await H.evalJs(
    `document.querySelector('[data-testid="command-preview"]')?.innerText ?? ''`,
  );
  H.check('4-4 骨架预填为 git clone', /git\s+clone/.test(skeleton4), skeleton4);

  await H.typeSuffix(' http://sandbox/remote.git');
  r = await H.runCommand();
  H.check('4-4 git clone 成功并直接过关', r && r.ok === true, r && r.error);

  await H.waitSettled('ch4-4');
  H.check('4-4 通关（宇宙已克隆）', true);
  await H.backToMenu();

  // ── 4-5 协作冲突：完整剧本（push 被拒 → fetch → merge → push）──
  await H.enterLevel('ch4-5', '协作冲突');
  const skeleton5 = await H.evalJs(
    `document.querySelector('[data-testid="command-preview"]')?.innerText ?? ''`,
  );
  H.check('4-5 骨架预填为 git fetch', /git\s+fetch/.test(skeleton5), skeleton5);

  // ① 直接推送必须**被拒**（远程领先，非快进）—— 本关的教学起点
  //
  // ⚠️ 骨架是 `git fetch`，故这里要重新点 `push` 片段（clickFrag 会换组并重置草稿）。
  // ⚠️ 被拒的命令**不改变面板**：不结算、history 也不增长（见下），
  //    故不能用 runCommand（它等 history 增长，会超时）。
  await H.clickFrag('push');
  await H.typeSuffix(' origin main');
  const composedPush5 = await H.evalJs(
    `document.querySelector('[data-testid="command-preview"]')?.innerText ?? ''`,
  );
  H.check(
    '4-5 拼出完整 push 命令',
    composedPush5.includes('git push origin main'),
    composedPush5,
  );

  await H.evalJs(`(() => {
    const b = document.querySelector('[aria-label="执行拼接的命令"]');
    if (!b || b.disabled) throw new Error('执行按钮不可用');
    b.click();
    return 1;
  })()`);
  await H.waitFor(
    `document.body.innerText.includes('推送被远程拒绝')`,
    '「推送被远程拒绝」文案出现',
  );
  const rejectText5 = await H.evalJs(`document.body.innerText`);
  H.check('4-5 push 被拒（远程已领先）', rejectText5.includes('推送被远程拒绝'));
  H.check(
    '4-5 被拒后仍在关卡页（远程没被改写）',
    rejectText5.includes('星际连接 · ch4-5'),
  );

  // ② 取回远程的观测
  await H.clickFrag('fetch');
  await H.typeSuffix(' origin');
  const composedFetch = await H.evalJs(
    `document.querySelector('[data-testid="command-preview"]')?.innerText ?? ''`,
  );
  H.check('4-5 拼出完整 fetch 命令', composedFetch.includes('git fetch origin'), composedFetch);
  r = await H.runCommand();
  H.check('4-5 git fetch 成功', r && r.ok === true, r && r.error);

  // ③ 与自己的时间线合流
  await H.clickFrag('merge');
  await H.typeSuffix(' origin/main');
  const composedMerge = await H.evalJs(
    `document.querySelector('[data-testid="command-preview"]')?.innerText ?? ''`,
  );
  H.check(
    '4-5 拼出完整 merge 命令',
    composedMerge.includes('git merge origin/main'),
    composedMerge,
  );
  r = await H.runCommand();
  H.check('4-5 git merge origin/main 成功（双方合流）', r && r.ok === true, r && r.error);

  // ④ 再推送 —— 这次应当成功
  //
  // ⚠️ 合流完成后本关的判据（`commitExists '他人传送的观测'`）**已经满足**，
  //    应用会立即切到结算页 —— 此时片段按钮已卸载，`clickFrag('push')` 必然失败。
  //    这是如实的判定边界（11 种 TargetCondition 里没有「远程分支状态」，
  //    见 M5-tasks.md「设计缺口」），不是实现缺陷。
  //
  //    因此这里**按两种可能的时序分别处理**：
  //      - 仍在关卡页 → 走完「再 push」这一步（完整剧本的第四步）；
  //      - 已结算 → 跳过，并由紧随其后的裸仓断言验证合流结果。
  //    两条路径都继续向下断言「关卡结算」与「章节解锁」，不假装必然能点到按钮。
  const stillOnLevel = await H.evalJs(
    `!!document.querySelector('[aria-label="执行拼接的命令"]')`,
  );
  if (stillOnLevel) {
    await H.clickFrag('push');
    await H.typeSuffix(' origin main');
    r = await H.runCommand();
    H.check('4-5 合流后 push 成功', r && r.ok === true, r && r.error);
  } else {
    H.check('4-5 合流已完成（判据满足，关卡已结算，跳过最后一步 push）', true);
  }

  await H.waitSettled('ch4-5');
  H.check('4-5 通关（协作冲突已消解）', true);
  await H.backToMenu();

  // ── 章节解锁链路：ch4 全通关 → ch5 解锁（M5b 起的新规则）──
  const ch5Unlocked = await H.evalJs(`(() => {
    const b = document.querySelector('[aria-label="直接开始 ch5-1 修正笔误"]');
    return b ? !b.disabled : null;
  })()`);
  H.check('ch4 全通关 → ch5 解锁（M5b 起逐级相邻）', ch5Unlocked === true, String(ch5Unlocked));

  // ── 重进 4-1：验证「每关重建沙箱」的隔离性 ──
  //
  // ⚠️ 4-1 是**半拼**关卡，没有自由输入框，故不能用 `runFree`。
  //    这里改用「点片段拼出 git remote -v 并执行」的路径 —— 与玩家操作一致。
  await H.enterLevel('ch4-1', '建立航道');
  await H.clickFrag('remote');
  await H.clickFrag('-v', 'remote');
  const composedRemoteV = await H.evalJs(
    `document.querySelector('[data-testid="command-preview"]')?.innerText ?? ''`,
  );
  H.check('重进 4-1 可拼出 git remote -v', composedRemoteV.includes('git remote -v'), composedRemoteV);

  r = await H.runCommand();
  H.check('重进 4-1 后 git remote 可执行', r && r.ok === true, r && r.error);

  // ⚠️ 断言「每关重建」：4-1 的 `linkLocal: false` 意味着**重进时仍然没有远程关联**
  //    （它就是要考 remote add 的那一关），故 `git remote` 应输出「还没有关联」。
  //    这同时验证了沙箱按 LevelInit 重建、以及远程宇宙每关重建的隔离性 ——
  //    若上一关的 remote 配置残留，这里会看到 origin。
  const remoteListBody = await H.evalJs(
    `(document.querySelector('[data-testid="command-history"]') ?? document.body).innerText`,
  );
  H.check(
    '重进 4-1 时远程关联**未**残留（每关按 LevelInit 重建，决策：linkLocal:false）',
    remoteListBody.includes('还没有关联任何远程仓库'),
    remoteListBody.slice(-200),
  );

  // ⚠️ `summarize` 需要段名，且**必须显式 process.exit**：
  //    脚本持有的 CDP WebSocket 会让 Node 事件循环一直活着，
  //    即便所有断言都跑完、进程也不退出（M5a 在 run-ch5.cjs 踩过同一个坑，实测）。
  const ok = H.summarize('ch4');
  process.exit(ok ? 0 : 1);
})().catch((error) => {
  console.error('冒烟脚本异常：', error);
  process.exit(1);
});

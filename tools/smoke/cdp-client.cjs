/**
 * M4 分段冒烟 —— 共享库（方案 A：分段 + 进度种子 + 条件轮询）
 *
 * 与上轮一体化脚本的三个本质差异：
 *   1. **进度种子**：经 CDP 对运行中的应用调用 `useProgressStore.setState()`
 *      直接种入通关记录 —— 不再脚本通关前置章节（省 200+ 次点击）；
 *   2. **条件轮询 waitFor()**：每个导航/渲染动作后轮询目标 DOM 特征直到出现
 *      （默认 15s 超时即失败），零固定 sleep —— 根治 startLevel 异步时序问题；
 *   3. **clickFrag 用 data-command/data-slot 定位**：aria-label「拼接命令片段：git」
 *      在页面上有 12 个重复按钮（每组 slot0 一个），querySelector 恒取第一个会
 *      点错命令组清空草稿（上轮实测缺陷）—— M3 冒烟文档「按 aria 定位」的教训
 *      需要在此升级为「aria 无重复时才用 aria」。
 */

const http = require('http');

const CDP_PORT = process.env.CDP_PORT || 9223;
const APP = 'http://localhost:5199/';
const WS_URL_OK = true;

let ws = null;
let msgId = 0;
const pending = new Map();
/**
 * `Page.loadEventFired` 的一次性回调（由 `reload()` 注册）。
 * ⚠️ CDP 事件没有 id，无法走 `pending` 表，故单列一个变量。
 */
let onLoadFired = null;

function onMessage(raw) {
  const msg = JSON.parse(typeof raw === 'string' ? raw : String(raw));

  // CDP 事件（无 id）：目前只关心页面加载完成
  if (msg.method === 'Page.loadEventFired' && typeof onLoadFired === 'function') {
    const callback = onLoadFired;
    onLoadFired = null;
    callback();
    return;
  }

  if (msg.id && pending.has(msg.id)) {
    const { resolve } = pending.get(msg.id);
    pending.delete(msg.id);
    resolve(msg.result);
  }
}

async function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 20000);
  });
}

/** 页面内求值：异常即抛（带表达式前 160 字符便于定位） */
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error(`Eval 失败: ${JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails).slice(0, 220)}\n  EXPR: ${expression.slice(0, 160)}`);
  }
  return r.result?.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 连接 Chrome（要求外部已启动 headless + CDP），打开应用，返回页面句柄 */
async function connect() {
  const targets = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${CDP_PORT}/json/list`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
  // ⚠️ target 选择要**优先应用地址本身**（M5b 实测踩到）：
  //    反复导航/重启 Chrome 会留下多个同源标签页（甚至 about:blank），
  //    `find(t => t.url.includes('localhost'))` 可能选到**旧的、已失去渲染进程的**
  //    那一个 —— 表现为「所有 waitFor 都超时，而页面肉眼看着好好的」。
  //    故先精确匹配 APP，再退化为同源，最后才取任意 page。
  const pages = targets.filter((t) => t.type === 'page');
  const page =
    pages.find((t) => t.url === APP) ??
    pages.find((t) => t.url.startsWith(APP)) ??
    pages.find((t) => t.url.includes('localhost')) ??
    pages[0];
  if (!page) throw new Error('CDP 里没有任何 page target（Chrome 未打开应用页面？）');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.addEventListener('message', (event) => onMessage(event.data));
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  await send('Page.enable');
  return page;
}

/**
 * 导航到应用并等 boot 完成。
 * boot 特征 = intro 按钮 或 菜单汇总条 二者其一出现（刷新后可能直接进 menu）。
 */
async function openApp() {
  await send('Page.navigate', { url: APP });
  await waitFor(
    `!!document.querySelector('[data-testid="progress-summary"]') || !!document.querySelector('button')`,
    '应用 boot（intro 或菜单出现）',
    20000,
  );
  // intro 视图 → 点「进入时间线检修台」
  const onIntro = await evalJs(`!!document.querySelector('[data-testid="progress-summary"]') === false && [...document.querySelectorAll('button')].some(b => b.textContent.includes('进入时间线检修台'))`);
  if (onIntro) {
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('进入时间线检修台'))?.click()`);
    await waitFor(`!!document.querySelector('[data-testid="progress-summary"]')`, '菜单汇总条出现', 15000);
  }
}

/**
 * 条件轮询：每 150ms 检查一次 expression，为真即返回其值；超时抛错。
 * 这是本方案替代固定 sleep 的核心原语。
 */
async function waitFor(expression, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last = undefined;
  while (Date.now() < deadline) {
    try {
      last = await evalJs(expression);
      if (last) return last;
    } catch { /* 页面切换瞬间 evaluate 可能失败：继续轮询 */ }
    await sleep(150);
  }
  throw new Error(`waitFor 超时（${label}）：最后值 = ${JSON.stringify(last)?.slice(0, 120)}`);
}

/* ── 断言收集 ─────────────────────────────────────────────────────────── */

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail: String(detail).slice(0, 80) });
  console.log((ok ? '✅' : '❌') + ' ' + name + (detail ? ` — ${String(detail).slice(0, 70)}` : ''));
}

function summarize(section) {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== [${section}] ${results.length - failed.length}/${results.length} 通过 ===`);
  if (failed.length > 0) {
    console.log('失败项：', failed.map((f) => f.name).join('；'));
  }
  return failed.length === 0;
}

/* ── 进度种子 ─────────────────────────────────────────────────────────── */

/**
 * 种入通关记录（直接调运行中应用的 progressStore）。
 * @param levelIds 如 ['ch1-1', …]；每关给 100 分 / 3 星 / cleared
 */
async function seedProgress(levelIds) {
  const records = {};
  for (const id of levelIds) records[id] = { score: 100, stars: 3, cleared: true };
  await evalJs(`(async () => {
    const mod = await import('/src/store/progressStore.ts');
    mod.useProgressStore.setState({ levelRecords: ${JSON.stringify(records)}, achievements: [] });
    return Object.keys(mod.useProgressStore.getState().levelRecords).length;
  })()`);
}

/* ── 导航原语（全部带 waitFor）───────────────────────────────────────── */

/** 从菜单进入某关（章节详情 → 开始关卡），返回后已在关卡页（preview 就绪） */
async function enterLevel(levelId, levelTitle) {
  const chapter = levelId.split('-')[0];
  const tookDirect = await evalJs(`(() => {
    const b = document.querySelector('[aria-label="直接开始 ${levelId} ${levelTitle}"]');
    if (b && !b.disabled) { b.click(); return true; }
    return false;
  })()`);
  if (!tookDirect) {
    // 非第一关：菜单只有「查看章节」→ 章节页 → 「开始关卡 <id> <title>」
    // ⚠️ CSS [aria-label=] 是精确匹配，菜单按钮的 aria 是「查看章节 ch2 日常秩序」
    //（含章节标题），必须用 startsWith 语义定位（实测缺陷）。
    await evalJs(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => (x.ariaLabel ?? '').startsWith('查看章节 ${chapter} '));
      if (b && !b.disabled) b.click();
      return 1;
    })()`);
    await waitFor(
      `[...document.querySelectorAll('button')].some(x => (x.ariaLabel ?? '').startsWith('开始关卡 ${levelId} '))`,
      `章节页出现 ${levelId} 的开始按钮`,
    );
    await evalJs(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => (x.ariaLabel ?? '').startsWith('开始关卡 ${levelId} '));
      if (b && !b.disabled) b.click();
      return 1;
    })()`);
  }
  // 条件等待：关卡页就绪 —— 页面含该关卡 id（顶栏）**且**某一种输入组件已挂载。
  // ⚠️ 判据必须区分输入模式（M5a 实测）：
  //    - menu / half 模式渲染 CommandBuilder → `[data-testid="command-preview"]`；
  //    - **free 模式（第五章起）渲染 Terminal → `[aria-label="命令输入"]`**，
  //      此时 command-preview **根本不存在**，沿用旧判据会必然超时。
  await waitFor(
    `(!!document.querySelector('[data-testid="command-preview"]') || !!document.querySelector('[aria-label="命令输入"]')) && document.body.innerText.includes('${levelId}')`,
    `进入关卡 ${levelId}`,
  );
}

/**
 * 过关结算页出现。
 * 判据：body 含「过关」与「时间线已锚定」（LevelComplete 的通用文案）——
 * ⚠️ 不能用关卡 id：结算页正文不含 id（实测「ch2-1」只在顶栏，切页后消失）。
 */
async function waitSettled(_levelId) {
  return waitFor(
    `document.body.innerText.includes('过关') && document.body.innerText.includes('时间线已锚定')`,
    `关卡结算页（${_levelId}）`,
  );
}

/** 结算页 → 回菜单（等待汇总条） */
async function backToMenu() {
  await evalJs(`(() => {
    const next = [...document.querySelectorAll('button')].find(x => x.textContent.includes('进入下一关'));
    const menu = [...document.querySelectorAll('button')].find(x => x.textContent.includes('返回菜单'));
    (menu ?? next)?.click();
    return 1;
  })()`);
  // 「进入下一关」会进下一关再点返回菜单；此处统一轮询回菜单
  await waitFor(`!!document.querySelector('[data-testid="progress-summary"]')`, '回到菜单', 15000);
  // 若落在了下一关（点错），再点一次返回菜单
  const onLevel = await evalJs(`!document.querySelector('[data-testid="progress-summary"]')`);
  if (onLevel) await backToMenu();
}

/* ── 命令执行原语 ─────────────────────────────────────────────────────── */

/**
 * 点击一个片段按钮（M9：优先走整词按钮）。
 * @param frag 'init' / 'add' / '.' / '-m' / 'diary.md' 等子命令或参数
 *
 * 定位策略（data 属性由 CommandBuilder 渲染，每组唯一）：
 *   - 子命令：整词按钮「git <frag>」（aria「拼接命令：git <frag>」）——
 *     M9 起 slot0/slot1 片段不再渲染，起始词由组件自动补齐；
 *   - slot2：data-command === 'git <frag>'（或组内）且文本等于 frag 的参数按钮。
 */
async function clickFrag(frag, command) {
  // command：可选的命令组名（如 'add' / 'rm' / 'commit'）—— 用于 slot2 参数的组级定位
  //   （同一参数文本可能多组都有：如路径既可 add 也可 rm）。
  //   传 command 时在 'git <command>' 组内找 slot2；不传时全局找未禁用的同名 slot2。
  const group = command ?? frag;

  const clicked = await evalJs(`(() => {
    const all = [...document.querySelectorAll('button[data-command]')];
    // 子命令优先：整词按钮（M9 的一步拼接入口）
    const word = all.find(b => b.ariaLabel === '拼接命令：git ${frag}');
    if (word) { word.click(); return 'ok:word:' + word.dataset.command; }
    // 参数片段：组内定位优先，再退化为全局唯一未禁用的同名 slot2
    let el = all.find(b => b.dataset.slot === '2' && b.dataset.command === 'git ${group}' && b.textContent === '${frag}');
    if (!el) el = all.find(b => b.dataset.slot === '2' && b.textContent === '${frag}' && !b.disabled);
    if (!el) return 'nf';
    if (el.disabled) return 'nf:disabled';
    el.click();
    return 'ok:' + el.dataset.command + '@' + el.dataset.slot;
  })()`);
  if (clicked === 'nf') throw new Error(`clickFrag 找不到片段：${frag}（group=${group}）`);
  if (clicked === 'nf:disabled') throw new Error(`clickFrag 点击失败（仍置灰）：${frag}`);
  await sleep(80);
  return clicked;
}

/**
 * 执行当前拼好的命令，等命令历史增长（条件等待而非固定 sleep）。
 *
 * ⚠️ 完成判据必须**同时接受两种结局**（M5b 实测）：
 *   1. history 增长 —— 一般命令的正常路径；
 *   2. **视图已离开关卡页**（进入结算页）—— 若这条命令正好达成最后一个目标，
 *      应用会立刻切到 `levelComplete` 并清掉 session，此时 history 恒为 0；
 *      只等 history 必然超时（实测：4-1 的 remote add 一次就过关，脚本却卡在那里）。
 *   两者都是「命令执行完毕」的合法信号。
 */
async function runCommand() {
  const before = await histCount();
  await evalJs(`(() => {
    const b = document.querySelector('[aria-label="执行拼接的命令"]');
    if (!b || b.disabled) throw new Error('执行按钮不可用（草稿为空或正在执行）');
    b.click();
    return 1;
  })()`);
  await waitFor(`(() => {
    // 结局 2：已离开关卡页（结算页 / 章节页）—— 说明这条命令让本关过关了
    if (!document.querySelector('[aria-label="执行拼接的命令"]')) return true;
    return ${histCountExpr(before)};
  })()`, '命令执行完成（history 增长或已离开关卡页）');
  await sleep(250); // 目标检测防抖（useTargetState 的 IO 轮询）

  return await captureLastEntry('');
}

/** 在 suffix 输入框输入文本（如提交信息 / 分支名），走真实键盘事件 */
async function typeSuffix(text) {
  await evalJs(`document.querySelector('[aria-label="补充命令参数，例如提交信息"]')?.focus()`);
  await send('Input.insertText', { text });
  await sleep(80);
}

/**
 * 编辑器创建/改写文件（点击树节点或「新建文件」→ 写内容 → 保存）。
 * @param path 仓库相对路径
 * @param content 新内容；为 null 时只打开不保存
 */
async function editFile(path, content) {
  // 已追踪且有变化的文件出现在树里；否则走「新建文件」
  const opened = await evalJs(`(() => {
    const node = document.querySelector('[aria-label="编辑文件 ${path}"]');
    if (node) { node.click(); return 'tree'; }
    const create = document.querySelector('[aria-label="新建文件"]');
    if (create) { create.click(); return 'create'; }
    return 'nf';
  })()`);
  if (opened === 'nf') throw new Error(`编辑入口不存在：${path}`);
  if (opened === 'create') {
    await waitFor(`!!document.querySelector('[aria-label="新建文件的路径"]')`, '新建路径输入框');
    await evalJs(`document.querySelector('[aria-label="新建文件的路径"]')?.focus()`);
    await send('Input.insertText', { text: path });
    await sleep(80);
    await evalJs(`document.querySelector('[aria-label="创建并打开"]')?.click()`);
  }
  await waitFor(`!!document.querySelector('[aria-label="文件 ${path} 的内容"]')`, `编辑器打开 ${path}`);
  if (content !== null) {
    // React 受控 textarea：走原生 setter + input 事件（fireEvent.change 在真实浏览器无效）
    await evalJs(`(() => {
      const area = document.querySelector('[aria-label="文件 ${path} 的内容"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(area, ${JSON.stringify(content)});
      area.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(80);
    await evalJs(`document.querySelector('[aria-label="保存 ${path}"]')?.click()`);
    await waitFor(`!document.querySelector('[aria-label="文件 ${path} 的内容"]')`, `保存后编辑器关闭 ${path}`);
  }
}

/**
 * 拼「git add <path>」或「git add .」并执行。
 * ⚠️ 具体路径（如 diary.md）通常不是片段按钮 —— 片段表只含 init.files 与
 * targets 点名的文件（pathsFromLevel），编辑器新建/改写的文件走 suffix 手输。
 */
async function runAdd(path) {
  await clickFrag('add');
  if (path === '.') {
    await clickFrag('.', 'add');
  } else {
    const dotAvail = await evalJs(`(() => {
      const b = [...document.querySelectorAll('button[data-command]')].find(x => x.dataset.command === 'git add' && x.dataset.slot === '2' && x.textContent === '${path}');
      return !!b;
    })()`);
    if (dotAvail) await clickFrag(path, 'add');
    else await typeSuffix(` ${path}`);
  }
  await runCommand();
}

/** 拼「git commit -m <msg>」并执行 */
async function runCommit(msg) {
  await clickFrag('commit');
  await clickFrag('-m', 'commit');
  await typeSuffix(` ${msg}`);
  await runCommand();
}

/** 拼一条「git <verb> [arg]」并执行（verb 有 slot1 按钮；arg 走 suffix） */
async function runGit(verb, arg = '') {
  await clickFrag(verb);
  if (arg) await typeSuffix(` ${arg}`);
  await runCommand();
}


/* ── free 模式（第五章起）───────────────────────────────────────────── */

/**
 * 在 free 模式的 Terminal 里输入并执行一整条命令。
 *
 * ⚠️ 为什么必须走真实键盘输入（CDP `Input.insertText`）：
 *   jsdom 的 `fireEvent.change` **不受 `readOnly` 限制**，会掩盖「玩家无法输入」
 *   这类缺陷（M2 教训 3）。free 模式的 Terminal 用受控 `<input>`，
 *   直接赋 value 不会触发 React 状态更新，故必须走原生输入通道。
 *
 * ⚠️ 每次执行前必须清空输入框：Terminal 在成功执行后会清空，但**失败时保留**
 *   （便于玩家改错），若不清就会把上一条失败的命令和新命令拼在一起。
 */
async function runFree(input) {
  // 等输入框就绪（自由输入关卡的关卡页）
  await waitFor(`!!document.querySelector('[aria-label="命令输入"]')`, '自由输入框就绪');
  const before = await histCount();

  // 清空（受控组件：走原生 setter + input 事件，与 editFile 同一套办法）
  await evalJs(`(() => {
    const el = document.querySelector('[aria-label="命令输入"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
    return true;
  })()`);
  await sleep(60);

  // 真实键盘输入
  await send('Input.insertText', { text: input });
  await sleep(80);

  await evalJs(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '执行');
    if (!btn) throw new Error('找不到「执行」按钮');
    btn.click();
    return true;
  })()`);

  // ⚠️ 与 runCommand 同款：命令若**一次过关**，应用会立刻切到结算页、
  //    命令历史面板随之卸载 —— 只等计数会必然超时
  //    （实测：ch5 的 `git commit --amend` 正好达成本关最后一项判据）。
  //    故判据同时接受「离开关卡页」这一结局。
  await waitFor(`(() => {
    if (!document.querySelector('[aria-label="命令输入"]')) return true;
    return ${histCountExpr(before)};
  })()`, `命令执行完成：${input}`);
  await sleep(300); // 目标检测防抖

  return await captureLastEntry(input);
}

/**
 * 「已执行命令数 > before」的判据表达式。
 *
 * ⚠️ 与 `histCount` 必须用**同一套 DOM 判据**（`data-testid="command-history"` +
 *    「以 `$` 开头的行」）—— 否则计数基准与等待条件不一致，
 *    会出现「等到超时但计数其实已经涨了」这类自相矛盾的失败（实测踩到过）。
 *    故此处直接复用 `histCount` 的表达式构造。
 */
function histCountExpr(before) {
  return `(() => {
    const probe = document.querySelector('[data-testid="command-history"]');
    const scope = probe ?? document.body;
    return scope.innerText.split('\\n').filter((line) => line.trim() === '$').length > ${before};
  })()`;
}

/**
 * 取最近一条命令的执行结果；**关卡已结算时合成一个成功结果**。
 *
 * ⚠️ 为什么需要「合成」这条分支（M5b 实测踩到）：
 *    若某条命令正好达成关卡的最后一项判据，应用会**立刻切到结算页**，
 *    命令历史面板随之卸载 —— 此时 DOM 里读不到任何输出。
 *    而「本关结算了」本身就是命令成功的**最强证据**（命令若失败不可能过关）。
 *    若不合成，调用方会拿到 null 并误判为失败
 *    （实测：ch1 的 1-4、ch4 的 4-1~4-5、ch5 的 5-1 全部一次过关，
 *      冒烟却逐条报「执行失败」）。
 *
 * @param expectedInput 期望的命令文本；仅在未结算时用于回填 input 字段
 */
async function captureLastEntry(expectedInput) {
  const settled = await evalJs(
    `!document.querySelector('[aria-label="命令输入"]') && !document.querySelector('[aria-label="执行拼接的命令"]')`,
  );
  if (settled) {
    return { input: expectedInput, ok: true, output: [], error: null, settled: true };
  }
  const entry = await latestHistory();
  return entry ?? { input: expectedInput, ok: true, output: [], error: null, settled: false };
}

/**
 * 读最近一条命令的执行结果（用于断言输出 / 报错）。
 *
 * ⚠️ 与 `histCount` 同样**不走 sessionStore**（那个实例读不到应用的真实状态，
 * 见 histCount 的注释）。改为从终端面板的渲染结果解析：
 *   - 命令文本：最后一个 `$` 行的下一行；
 *   - 成功与否 + 输出：紧随其后的非 `$` 行。
 *
 * ⚠️ 该解析是**启发式**的：它无法区分「输出行」与「错误行」的语义类别，
 * 只按「以 `$` 开头的是输入行」切分。故调用方应优先断言**可观察的行为**
 * （页面文案、目标面板、结算页），本函数只用于辅助诊断。
 */
async function latestHistory() {
  return evalJs(`(() => {
    const probe = document.querySelector('[data-testid="command-history"]');
    const scope = probe ?? document.body;
    const lines = scope.innerText.split('\\n').map((l) => l.trim());
    // ⚠️ 结构细节（CommandHistory.tsx，实测）：每条命令渲染为
    //      p.command > span.prompt("$") + input
    //    其中 $ 是**独立 span**，innerText 因此把提示符与命令文本渲染成
    //    **两行**：先一行 "$"，再一行命令本身（曾误以为同行）。
    //    故一条命令 = 一个 "$" 行 + 紧随其后的命令文本行 + 其后的输出行。
    const marks = lines.map((l, i) => (l === '$' ? i : -1)).filter((i) => i >= 0);
    if (marks.length === 0) return null;
    const start = marks[marks.length - 1];
    const input = (lines[start + 1] ?? '').trim();
    // 输出 = 命令文本行之后、下一个 "$" 之前的所有非空行
    const rest = lines.slice(start + 2);
    const until = rest.findIndex((l) => l === '$');
    const body = (until < 0 ? rest : rest.slice(0, until)).filter(Boolean);
    return { input, ok: true, output: body, error: null };
  })()`);
}

/** 从菜单/结算页进入某关（结算页走「返回菜单」） */

/* ── 启动引导 ─────────────────────────────────────────────────────────── */

/**
 * 「命令历史计数」——从**命令历史面板的 DOM** 数已执行的命令条数。
 *
 * ⚠️ 为什么不用 `sessionStore.getState().history.length`（M5b 实测否决了原做法）：
 * 经 CDP `evalJs` 里 `import('/src/store/sessionStore.ts')` 拿到的**不是应用正在用的
 * 那个模块实例**（实测 `sameModule === false`），其 `history` 恒为 0 ——
 * 于是所有 `runCommand` 都会超时，而命令其实已经执行成功（面板里看得见）。
 * 这类「读到的状态与 UI 不一致」的假象极难定位，故改用**渲染结果**作为事实来源。
 *
 * DOM 结构（`CommandHistory.tsx`）：每条命令渲染为
 *   `<p class=command><span class=prompt>$</span>{input}</p>`
 * 即 `$` 与命令文本在**同一行**（`innerText` 得到 `"$ git add ."`）。
 * 故判据是「以 `$` 开头的行数」而非「整行只等于 `$` 的行数」。
 * ⚠️ 输出行与错误行不带 `$` 前缀，因此计数不受它们影响。
 */
async function histCount() {
  return evalJs(`(() => {
    const probe = document.querySelector('[data-testid="command-history"]');
    const scope = probe ?? document.body;
    // $ 是独立的提示符 span → 在 innerText 里独占一行；一行一个 $ 即一条命令
    return scope.innerText.split('\\n').filter((line) => line.trim() === '$').length;
  })()`);
}

/**
 * 清空应用的持久化状态并 **reload**（M5a 新增）。
 *
 * ⚠️ M5a 起进度会落 localStorage（`gtp:progress:v1`），于是**上一次冒烟跑完的进度
 * 会被下一次读到** —— 依赖「全新玩家」假设的断言（如段3 的「无进度时 ch2 锁定」）
 * 因此失败（实测）。本函数把应用恢复到真正的初始态：
 *   1. 清掉进度 / 成就 / 设置三个键；
 *   2. 删除 `gtp:snapshot:*` 的 IndexedDB 快照库；
 *   3. reload，让 store 以空进度重建。
 *
 * 调用方应在 `openApp()` **之前**用「先导航 → 清 → reload」的顺序执行，
 * 故这里自己负责导航（storage 是 per-origin 的，必须先有页面）。
 */
async function resetStorage() {
  // 先确保有一个同源页面（storage / indexedDB 都是 per-origin）。
  // ⚠️ 必须等**应用 UI**出现而不是 readyState：about:blank 的 readyState 也是
  //    'complete'，在那上面调 indexedDB 会得到 SecurityError「denied in this
  //    context」（全新 Chrome profile 首开实测），清库就静默失败了。
  await send('Page.navigate', { url: APP });
  // ⚠️ 判据必须**同时接受「菜单」与「关卡页」**（M5b 实测）：
  //    M5a 起刷新会自动恢复上次所在的关卡，于是 boot 后的落点可能是**关卡页**
  //    而非菜单 —— 此时 `progress-summary` 不存在、"进入时间线检修台" 也没有，
  //    只认菜单会必然超时（本函数在 M5b 冒烟里就是这样卡住的）。
  //    四者任一出现即可确认「已到 app 源且应用已挂载」。
  await waitFor(
    `location.origin === new URL(${JSON.stringify(APP)}).origin` +
      ` && !!document.querySelector('#root')` +
      ` && (document.querySelector('#root').innerText ?? '').trim().length > 0`,
    '页面就绪（已到达 app 源且应用已挂载）',
    30000,
  );
  await sleep(200);

  await evalJs(`(() => {
    try {
      // ⚠️ 必须连 gtp:active-level:v1 一起清 —— 它是「刷新后自动恢复关卡中途进度」
      //    的依据（M5a）。不清的话下一次 boot 会直接恢复到上次那一关，
      //    脚本还停在菜单等着点「查看章节」，于是超时（实测踩到）。
      ['gtp:progress:v1', 'gtp:achievements:v1', 'gtp:settings:v1', 'gtp:active-level:v1']
        .forEach((k) => localStorage.removeItem(k));
    } catch (e) { /* storage 不可用时忽略 */ }
    return true;
  })()`);

  // ⚠️ 先 reload 一次再删库：应用运行期间 LightningFS 持有快照库的连接，
  //    此时 `deleteDatabase` 只会触发 `onblocked` 而**不会真正删除**（实测：
  //    删完再 reload，下一次 boot 又恢复到了上次那一关，脚本卡在菜单）。
  //    导航离开后连接被释放，删库才能真正生效。
  await reload();
  await sleep(400);

  await evalJs(`(async () => {
    if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return 0;
    const dbs = await indexedDB.databases();
    const names = dbs
      .map((d) => d.name)
      .filter((n) => typeof n === 'string' && n.startsWith('gtp:snapshot:'));
    await Promise.all(names.map((n) => new Promise((resolve) => {
      const r = indexedDB.deleteDatabase(n);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    })));
    return names.length;
  })()`);

  // 再清一次 localStorage（首页导航后应用可能已重建会话）并 reload 到干净态
  await evalJs(`(() => {
    try {
      ['gtp:progress:v1', 'gtp:achievements:v1', 'gtp:settings:v1', 'gtp:active-level:v1']
        .forEach((k) => localStorage.removeItem(k));
    } catch (e) { /* storage 不可用时忽略 */ }
    return true;
  })()`);

  await reload();
  await sleep(300);
}

/**
 * 重新加载当前页面并等待加载完成。
 *
 * ⚠️ 不可用 `evalJs('location.reload()')`：页面上下文会在求值途中被销毁，
 * 该 CDP 调用因此**永不返回**，调用方会静默挂死（M5a 实测踩到）。
 * 这里改走 `Page.navigate` + 等 `Page.loadEventFired`。
 */
async function reload() {
  const loaded = new Promise((resolve) => {
    const timer = setTimeout(resolve, 10000); // 兜底：极端情况下不永久等待
    onLoadFired = () => {
      clearTimeout(timer);
      resolve();
    };
  });
  await send('Page.navigate', { url: APP });
  await loaded;
  return waitFor(`document.readyState === 'complete'`, 'reload 后文档就绪', 20000);
}

/** installCounter 保留为空实现（向后兼容；计数已内建到 histCount） */
async function installCounter() {}

module.exports = {
  connect, openApp, waitFor, evalJs, sleep, histCount,
  check, summarize, results,
  seedProgress, enterLevel, waitSettled, backToMenu,
  clickFrag, runCommand, typeSuffix, editFile, runAdd, runCommit, runGit,
  // free 模式（第五章起）
  runFree, latestHistory, reload, resetStorage,
  installCounter,
};

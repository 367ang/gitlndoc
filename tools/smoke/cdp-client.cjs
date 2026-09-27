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

function onMessage(raw) {
  const msg = JSON.parse(typeof raw === 'string' ? raw : String(raw));
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
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost'));
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
  // 条件等待：关卡页就绪 = 命令预览出现 **且** 页面含该关卡 id（顶栏）
  await waitFor(
    `!!document.querySelector('[data-testid="command-preview"]') && document.body.innerText.includes('${levelId}')`,
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
 * 点击一个片段按钮。
 * @param frag 'init' / 'add' / '.' / '-m' / 'diary.md' / 'git'（slot0）等
 *
 * 定位策略（data 属性由 CommandBuilder 渲染，每组唯一）：
 *   - slot1：data-command === 'git <frag>' 的子命令按钮（唯一）；
 *   - slot2：data-command === 'git <frag>' 且文本等于 frag 的参数按钮；
 *   - slot0：frag === 'git' 时点当前命令组的 slot0（组由「已填草稿」推断不可靠，
 *     故 slot0 仅在 needGit 显式传入 data-command 时使用）。
 */
async function clickFrag(frag, command) {
  // command：可选的命令组名（如 'add' / 'rm' / 'commit'）—— 用于 slot2 参数的组级定位
  //   （同一参数文本可能多组都有：如路径既可 add 也可 rm）。
  //   传 command 时在 'git <command>' 组内找 slot2；不传时全局找未禁用的同名 slot2。
  const group = command ?? frag;

  /** 定位片段：返回 { el, needSlot0 } 或 null */
  const locate = evalJs(`(() => {
    const all = [...document.querySelectorAll('button[data-command]')];
    let el;
    el = all.find(b => b.dataset.slot === '1' && b.dataset.command === 'git ${frag}');
    if (!el) el = all.find(b => b.dataset.command === 'git ${group}' && b.dataset.slot === '2' && b.textContent === '${frag}');
    if (!el) el = all.find(b => b.dataset.slot === '2' && b.textContent === '${frag}' && !b.disabled);
    if (!el) return 'nf';
    return { ariaLabel: el.ariaLabel, disabled: el.disabled, group: el.dataset.command };
  })()`);

  const found = await locate;
  if (found === 'nf') throw new Error(`clickFrag 找不到片段：${frag}（group=${group}）`);

  if (found.disabled) {
    // ⚠️ React 18 批处理：slot0 与 slot1 的点击**不可在同一同步块**里 ——
    // slot0.click() 触发的 setState 尚未提交，slot1 的 disabled 仍是 true，
    // click() 会被浏览器忽略（实测）。必须等 React 提交后再点 slot1。
    const slot0 = await evalJs(`(() => {
      const all = [...document.querySelectorAll('button[data-command]')];
      const slot0 = all.find(b => b.dataset.command === ${JSON.stringify(found.group)} && b.dataset.slot === '0' && !b.disabled);
      if (!slot0) return 'nf:slot0';
      slot0.click();
      return 'ok';
    })()`);
    if (slot0 === 'nf:slot0') throw new Error(`clickFrag：${frag} 的 slot0 不可点`);
    await sleep(150); // React 提交周期
  }

  // slot0 就绪后（置灰已解除）正式点击目标片段
  const clicked = await evalJs(`(() => {
    const all = [...document.querySelectorAll('button[data-command]')];
    let el;
    el = all.find(b => b.dataset.slot === '1' && b.dataset.command === 'git ${frag}' && !b.disabled);
    if (!el) el = all.find(b => b.dataset.command === 'git ${group}' && b.dataset.slot === '2' && b.textContent === '${frag}' && !b.disabled);
    if (!el) el = all.find(b => b.dataset.slot === '2' && b.textContent === '${frag}' && !b.disabled);
    if (!el) return 'nf:disabled';
    el.click();
    return 'ok:' + el.dataset.command + '@' + el.dataset.slot;
  })()`);
  if (clicked === 'nf:disabled') throw new Error(`clickFrag 点击失败（仍置灰）：${frag}`);
  await sleep(80);
  return clicked;
}

/** 执行当前拼好的命令，等 sessionStore.history 增长（条件等待而非固定 sleep） */
async function runCommand() {
  const before = await histCount();
  await evalJs(`(() => {
    const b = document.querySelector('[aria-label="执行拼接的命令"]');
    if (!b || b.disabled) throw new Error('执行按钮不可用（草稿为空或正在执行）');
    b.click();
    return 1;
  })()`);
  await waitFor(`(async () => {
    const mod = await import('/src/store/sessionStore.ts');
    return mod.useSessionStore.getState().history.length > ${before};
  })()`, '命令执行完成（history 增长）');
  await sleep(250); // 目标检测防抖（useTargetState 的 IO 轮询）
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

/* ── 启动引导 ─────────────────────────────────────────────────────────── */

/**
 * 「命令历史计数」经应用自身的 sessionStore 读取（Vite module 缓存与应用共享同一实例）：
 * runCommand 前后各读一次 history.length，增加值即执行完成 —— 条件等待的依据。
 * ⚠️ 不能用 DOM 计数：CommandHistory 的 class 是 CSS Module 哈希，无稳定选择器（实测）。
 */
async function histCount() {
  return evalJs(`(async () => {
    const mod = await import('/src/store/sessionStore.ts');
    return mod.useSessionStore.getState().history.length;
  })()`);
}

/** installCounter 保留为空实现（向后兼容；计数已内建到 histCount） */
async function installCounter() {}

module.exports = {
  connect, openApp, waitFor, evalJs, sleep, histCount,
  check, summarize, results,
  seedProgress, enterLevel, waitSettled, backToMenu,
  clickFrag, runCommand, typeSuffix, editFile, runAdd, runCommit, runGit,
  installCounter,
};

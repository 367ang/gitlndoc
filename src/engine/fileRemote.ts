/**
 * 「远程宇宙」—— 进程内内存裸仓库 + 最小 Git 智能 HTTP 服务端（M5b，第四章「星际连接」）。
 *
 * ─── 为什么是这套形态（决策 ②，探针实测后细化）──────────────────────────────
 *
 * `fs.ts` 既定的沙箱约定是：`/repo`（玩家主仓库）+ `/remote.git`（远程宇宙裸仓库）。
 * 原计划「自写最小 Git 智能 HTTP **客户端**」，但 M5b 开工前的协议探针推翻了这一估计：
 * **isomorphic-git 的 `fetch` / `push` / `clone` 都接受自定义 `http` 客户端，且已完整
 * 实现智能 HTTP 的「客户端」侧**（实测走 `GET /info/refs?service=git-upload-pack`
 * 或 `...-receive-pack`，随后才发 POST）。
 *
 * 因此本模块实现的是**服务端**：一个进程内的 http 客户端对象，把 isomorphic-git
 * 发出的**标准协议请求**应答为来自内存裸仓库的**真实数据**。这比原计划工作量小，
 * 且完全没有偏离「真实执行」—— 走的是真协议、真 pkt-line、真 packfile，
 * 只是传输层不出浏览器（§14 禁止的是「假装执行」，不是「本地通道」）。
 *
 * ─── 报文格式的关键约束（全部实测，违反即失败；详见 M5-tasks.md §三 附录）───────
 *
 * | 约束 | 违反后的症状 |
 * |---|---|
 * | advertisement 响应头必须是 `application/x-git-<service>-advertisement` | 走 dumb 回退，报 `SmartHttpError` |
 * | 首个 ref 行必须 `<oid> <ref>\0<caps>` | 抛 `Expected "Two strings separated by '\x00'"` |
 * | 空仓库须公告 `<40 个 0> capabilities^{}\0<caps>` | 无 ref 可读，客户端拿不到 capabilities |
 * | ⚠️ **应答 `body` 必须是 `[Uint8Array]` 单元素数组** | `StreamReader` 把 `Uint8Array` 当**字节迭代器**，流瞬间结束 → `EmptyServerResponseError` |
 * | `indexPack` 的 `filepath` 必须是**相对 `dir`** 的路径 | 内部 `join(dir, filepath)` 双重拼接，ENOENT 被静默吞成 `null` → `TypeError: Cannot read properties of null` |
 * | upload-pack：`NAK\n` 不分路、packfile 必须分路（首字节 1） | packfile 落进 packetlines，客户端永远收不到包 |
 * | receive-pack：应答**整体**必须分路（经 `GitSideBand.demux`） | 解析出空串 → `Expected "unpack ok" or ...` |
 *
 * ─── 分层纪律 ──────────────────────────────────────────────────────────────
 *
 * 本模块属 **Git 执行层**：是对 `isomorphic-git` + `fs.ts` 的薄编排，
 * **不抛异常**（与 `gitApi` 同一契约，一律返回 `GitResult<T>`），
 * 且不含任何业务逻辑（计分、目标比对、提示）。
 */

import git from 'isomorphic-git';
import type { FsClient, GitHttpRequest, GitHttpResponse, HttpClient } from 'isomorphic-git';
import { fsp, getFs, REMOTE_DIR } from './fs';
import { GitCommandError, runGit, type GitResult } from './errors';
import { DEFAULT_BRANCH, LEARNER_IDENTITY } from './gitApi';

/** 远程仓库的裸仓目录（沙箱约定，见 `fs.ts`） */
export const REMOTE_REPO_DIR = REMOTE_DIR;

/** 裸仓在 git 语义下 `dir` 与 `gitdir` 相同（裸仓没有工作区） */
function bareArgs(): { fs: FsClient; dir: string; gitdir: string } {
  // ⚠️ 必须在调用时取 fs 单例：模块作用域捕获会让测试里的 `configureFs()` 失效
  //    （与 gitApi.fsArgs 同款理由）。
  return { fs: getFs(), dir: REMOTE_REPO_DIR, gitdir: REMOTE_REPO_DIR };
}

// ── pkt-line 原语（Git 线协议的最小封装）─────────────────────────────────────

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * 编码一个 pkt-line 包：4 位十六进制长度（含自身 4 字节）+ 负载。
 *
 * ⚠️ 长度按**字节数**而非字符数计算 —— 中文路径与提交信息都是多字节，
 * 用 `text.length` 会算出错误的长度前缀，客户端解析随即错位。
 */
export function pktLine(payload: string | Uint8Array): Uint8Array {
  const bytes = typeof payload === 'string' ? encoder.encode(payload) : payload;
  const length = (bytes.length + 4).toString(16).padStart(4, '0');
  const out = new Uint8Array(4 + bytes.length);
  out.set(encoder.encode(length), 0);
  out.set(bytes, 4);
  return out;
}

/** flush 包：长度 0000，表示「这一段到此为止」 */
export const PKT_FLUSH = encoder.encode('0000');

/** 拼接若干字节块 */
function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** side-band-64k 的单帧数据上限：1 字节通道号 + 数据，总长不超 64k */
const SIDE_BAND_MAX = 65515;

/**
 * 把数据切成 side-band 通道 1（packfile 数据）的 pkt-line 序列。
 *
 * 依据 `GitSideBand.demux`（isomorphic-git 源码）：每帧首字节即通道号 ——
 * `1` = pack 数据、`2` = progress、`3` = fatal error、**其它 → packetlines**。
 * 缺了这个前缀，packfile 会被当成普通 packetline 而永远到不了解包器。
 */
function sideBandPackets(data: Uint8Array): Uint8Array[] {
  const packets: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += SIDE_BAND_MAX) {
    const slice = data.subarray(offset, Math.min(offset + SIDE_BAND_MAX, data.length));
    const framed = new Uint8Array(1 + slice.length);
    framed[0] = 1; // 通道 1 = packfile
    framed.set(slice, 1);
    packets.push(pktLine(framed));
  }
  return packets;
}

/**
 * 把一组纯 pkt-line 应答**整体包进 side-band 通道 1**。
 *
 * ⚠️ receive-pack 的应答必经 `GitSideBand.demux`（push 的调用链如此），
 * 故 `unpack ok` / `ok <ref>` / `ng <ref> <reason>` 都必须分路。
 * 直接回裸 pkt-line 会让客户端解析出空串并抛
 * `Expected "unpack ok" or "unpack [error message]"`（实测）。
 */
function wrapInSideBand(packets: Uint8Array[]): Uint8Array {
  return concatBytes([...sideBandPackets(concatBytes(packets)), PKT_FLUSH]);
}

// ── ref advertisement ───────────────────────────────────────────────────────

/** upload-pack（fetch / clone 方向）公告的 capabilities */
const CAPS_UPLOAD = 'multi_ack_detailed side-band-64k thin-pack ofs-delta agent=git/gitlndoc';

/** receive-pack（push 方向）公告的 capabilities */
const CAPS_RECEIVE = 'report-status delete-refs side-band-64k ofs-delta agent=git/gitlndoc';

/**
 * 公告 HEAD 的符号引用目标（真 git 用 `symref=HEAD:refs/heads/main` 这个 capability）。
 *
 * ⚠️ 这不是可有可无的装饰（M5b 实测踩到的坑）：
 * 若不公告 `symref`，isomorphic-git 会把 advertisement 里那行 `HEAD` 当成一个**普通 ref**
 * 收进 `remoteRefs`，于是 refspec `+refs/heads/*:refs/remotes/origin/*` 无法把任何东西
 * 映射到 `refs/remotes/origin/<branch>` —— 结果是 fetch **不报错但什么都没建立**：
 * `listBranches({remote:'origin'})` 只返回一个诡异的 `HEAD`，`origin/main` 解析失败，
 * 玩家的 `git merge origin/main` 随即报「找不到 origin/main」。
 *
 * 反向证据：探针里手写的 advertisement 只公告 `refs/heads/main`（不公告 HEAD）时，
 * `refs/remotes/origin/main` 是正确的 —— 所以问题出在 HEAD 那行的处理方式上。
 * 公告 `symref` 后两者都对（真 git 的标准行为）。
 */
function uploadCaps(): string {
  return `${CAPS_UPLOAD} symref=HEAD:refs/heads/${DEFAULT_BRANCH}`;
}

/** 全零 oid：git 用它表示「不存在」 */
const ZERO_OID = '0'.repeat(40);

/**
 * 组一个 ref advertisement 应答体。
 *
 * 格式（真 git 的 v0 智能 HTTP 约定，以 `git upload-pack --advertise-refs` 实测校准）：
 * ```
 * 001e# service=git-upload-pack\n
 * 0000
 * <oid> HEAD\0<cap1> <cap2> ... symref=HEAD:refs/heads/main ...\n   ← HEAD 行承载 capabilities
 * <oid> refs/heads/main\n                                          ← 其余 ref
 * 0000
 * ```
 *
 * ⚠️ **HEAD 行必须发布，且必须带 `symref=HEAD:refs/heads/<分支>` capability**
 *    （M5b 实测踩到的坑，两次才定位准）：
 *    - **少了 HEAD 行**：isomorphic-git 的多分支 fetch 路径会对 `HEAD` 调
 *      `resolveAgainstMap` —— 解析不到就抛「找不到指定的文件或提交」，
 *      于是 `git fetch origin`（不带分支）永远失败，只有指定分支才行；
 *    - **有 HEAD 行但没有 symref**：HEAD 被当成**普通 ref** 收进 `remoteRefs`，
 *      refspec `+refs/heads/*:refs/remotes/origin/*` 映射错乱 —— fetch 不报错，
 *      但 `refs/remotes/origin/main` **根本没建立**（只多出一个诡异的 `origin/HEAD`），
 *      玩家的 `git merge origin/main` 随即报「找不到 origin/main」。
 *    两者都补齐后，行为与真 git 一致（实测：真 git 的 advertisement 正是
 *    `HEAD` 行 + symref capability）。
 */
function advertisementBody(
  service: 'git-upload-pack' | 'git-receive-pack',
  refs: Map<string, string>,
  caps: string,
): Uint8Array {
  const chunks: Uint8Array[] = [pktLine(`# service=${service}\n`), PKT_FLUSH];
  const entries = [...refs.entries()];

  if (entries.length === 0) {
    chunks.push(pktLine(`${ZERO_OID} capabilities^{}\0${caps}\n`));
  } else {
    entries.forEach(([name, oid], index) => {
      chunks.push(pktLine(index === 0 ? `${oid} ${name}\0${caps}\n` : `${oid} ${name}\n`));
    });
  }

  chunks.push(PKT_FLUSH);
  return concatBytes(chunks);
}

/**
 * 组装要公告的 ref 列表（含 HEAD）。
 *
 * HEAD 值取默认分支的 oid；默认分支不存在时（如只推了别的分支）退化为
 * 「第一个分支」—— 与真 git 的 `HEAD` 指向当前分支的语义一致。
 */
async function advertisedRefs(): Promise<Map<string, string>> {
  const branches = await readBareRefs();
  const refs = new Map<string, string>();

  // HEAD 排在最前（真 git 亦然）——它承载 capabilities 那一行
  const headTarget = `refs/heads/${DEFAULT_BRANCH}`;
  const headOid = branches.get(headTarget) ?? [...branches.values()][0];
  if (headOid !== undefined) refs.set('HEAD', headOid);

  for (const [name, oid] of branches) refs.set(name, oid);
  return refs;
}

/**
 * advertisement 的**测试专用**出口。
 *
 * 存在的理由：advertisement 的格式约束（`\0` + capabilities、空仓库的
 * `capabilities^{}` 伪 ref）是最容易写错又最难从端到端用例定位的部分 ——
 * 写错时的症状是客户端报一句与真因无关的解析错误。故单独暴露给测试逐字段断言。
 *
 * ⚠️ 生产代码不应调用它（`createRemoteHttpClient` 内部已用同一实现）。
 */
export function advertisementForTest(
  service: 'git-upload-pack' | 'git-receive-pack',
  refs: Map<string, string>,
): Uint8Array {
  return advertisementBody(service, refs, service === 'git-upload-pack' ? CAPS_UPLOAD : CAPS_RECEIVE);
}

/**
 * 把一段字节包成 isomorphic-git 期望的 `AsyncIterableIterator<Uint8Array>`。
 *
 * ⚠️ 这是 M5b 探针里最隐蔽的一个坑：`GitHttpResponse.body` 的类型是
 * **异步迭代器**。若直接给 `Uint8Array`，isomorphic-git 的 `getIterator` 会命中
 * `iterable[Symbol.iterator]` 分支，把它当成**逐字节迭代器**（每次 `next()` 产出
 * 一个数字而非 buffer），流随即结束并报 `EmptyServerResponseError`。
 * 包成「元素的迭代器」才是正确语义 —— 这也正是 `[bytes]` 数组能奏效的原因。
 */
function toBodyStream(chunks: Uint8Array[]): AsyncIterableIterator<Uint8Array> {
  let index = 0;
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next(): Promise<IteratorResult<Uint8Array>> {
      if (index >= chunks.length) return { done: true, value: undefined };
      const value = chunks[index];
      index += 1;
      return { done: false, value };
    },
  };
}

/** 应答对象，形态对齐 isomorphic-git 的 `GitHttpResponse` */
function response(
  url: string,
  method: string,
  contentType: string,
  body: Uint8Array,
): GitHttpResponse {
  return {
    url,
    method,
    // ⚠️ 这个头必须精确 —— isomorphic-git 据它判断「是否 smart 协议」，
    //    缺失或不匹配会走 dumb 回退并报 SmartHttpError。
    headers: { 'content-type': contentType },
    // ⚠️ 必须包成流（见 toBodyStream 的注释：直接给 Uint8Array 会被当字节迭代器）
    body: toBodyStream([body]),
    statusCode: 200,
    statusMessage: 'OK',
  };
}

/** 把请求体（异步迭代器）收成一段连续字节 */
async function collectBody(body: GitHttpRequest['body']): Promise<Uint8Array> {
  if (body === undefined) return new Uint8Array(0);

  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  return concatBytes(chunks);
}

// ── 裸仓读写 ────────────────────────────────────────────────────────────────

/**
 * 读裸仓的全部 `refs/heads/*`，返回 `Map<'refs/heads/main', oid>`。
 *
 * 裸仓（`dir === gitdir`）没有 HEAD 符号引用的工作区语义，故一律按全名读取。
 */
async function readBareRefs(): Promise<Map<string, string>> {
  const args = bareArgs();
  const refs = new Map<string, string>();

  const branches = await git.listBranches(args);
  for (const name of branches) {
    try {
      const oid = await git.resolveRef({ ...args, ref: `refs/heads/${name}` });
      refs.set(`refs/heads/${name}`, oid);
    } catch {
      // 初生分支（已创建但无提交）在 advertisement 里没有可公告的 oid —— 跳过而非报错
    }
  }

  return refs;
}

/** 读裸仓的当前分支名（用于公告 HEAD 符号引用），无提交时回默认分支 */
async function readBareHeadTarget(): Promise<string | null> {
  const args = bareArgs();
  try {
    const branch = await git.currentBranch({ ...args, fullname: false });
    return branch ? `refs/heads/${branch}` : null;
  } catch {
    return null;
  }
}

/**
 * 把 packfile 收进裸仓对象库。
 *
 * ⚠️ 两个实测坑：
 *   1. `indexPack` 内部无条件 `join(dir, filepath)` —— `filepath` **必须**是相对
 *      `dir` 的路径（如 `objects/pack/x.pack`）。传绝对路径会双拼成
 *      `/remote.git/remote.git/...`，而 `FileSystem.read` 把 ENOENT 静默吞成 `null`，
 *      最终报一个与真因毫无关系的 `TypeError: Cannot read properties of null`。
 *   2. pack 文件必须先真正落盘再调用 —— `indexPack` 是**读文件**而非收字节流。
 *
 * @returns 该 pack 含有的对象 oid 列表
 */
export async function ingestPack(packBytes: Uint8Array): Promise<GitResult<string[]>> {
  return runGit('remote ingest-pack', async () => {
    const args = bareArgs();
    const name = `pack-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}`;
    const relative = `objects/pack/${name}.pack`;

    await fsp.writeFile(`${REMOTE_REPO_DIR}/${relative}`, packBytes);
    const result = await git.indexPack({ ...args, filepath: relative });
    return result.oids ?? [];
  });
}

/**
 * 收集某仓库中一组 oid **可达的全部对象**（提交 + 树 + 子树 + blob）。
 *
 * ⚠️ 为什么必须自己走图（M5b 实测踩到的第三个隐蔽坑，也是本章最费时的一个）：
 * `git.packObjects({ oids })` **只打包你给它的那 oid**，不做可达性递归 ——
 * 传一个提交 oid 进去，产出的 pack 里**只有那个提交对象**，没有它的 tree 与 blob。
 * 后果极其隐蔽：
 *   - fetch 看起来成功（ref 建好了、协商也通了），但一旦要检出工作区就报
 *     `NotFoundError: Could not find <tree oid>`；
 *   - **`seedRemoteBranches` 也一样** —— 于是裸仓自身就缺 tree/blob，
 *     连服务端都读不出对象，clone 必然失败，而错误里给的是 **tree 的 oid**，
 *     完全指不到「pack 少打了对象」这个真因。
 *
 * 真 git 的 upload-pack 自行做可达性分析；isomorphic-git 的客户端只负责
 * 「我 want 这些 oid」。因此这份图遍历必须由我们承担 —— 两处打包（预置种子、
 * 应答 fetch）都用本函数。
 *
 * @param repoDir 源仓库目录（`/repo` 或裸仓）
 * @param oids    起始 oid（通常是提交）
 */
async function collectReachableObjects(repoDir: string, oids: string[]): Promise<string[]> {
  const fs = getFs();
  const gitdir = (await isBareDir(repoDir)) ? repoDir : `${repoDir}/.git`;
  const args = { fs, dir: repoDir, gitdir };

  const seen = new Set<string>();
  const queue = [...oids];

  while (queue.length > 0) {
    const oid = queue.pop() as string;
    if (seen.has(oid)) continue;
    seen.add(oid);

    // 逐个尝试把它当作 commit / tree 解读。
    // ⚠️ 必须用 `readCommit` + `readTree` 这两个**专用**接口，而不是
    //    `readObject({ format: 'parsed' })` —— 后者的 `format` 只接受
    //    `'deflated' | 'wrapped' | 'content'`（**没有 'parsed'**，类型声明里
    //    TS 不会拦下这个字符串，但运行时会抛 `InternalError: invalid requested format`）。
    //    专用接口返回的是结构化的 `GitCommit` / `GitTree`，直接可用。
    let commit: Awaited<ReturnType<typeof git.readCommit>>['commit'] | null = null;
    try {
      ({ commit } = await git.readCommit({ ...args, oid }));
    } catch {
      commit = null;
    }

    if (commit !== null) {
      queue.push(commit.tree);
      for (const parent of commit.parent) queue.push(parent);
      continue;
    }

    let tree: Awaited<ReturnType<typeof git.readTree>>['tree'] | null = null;
    try {
      ({ tree } = await git.readTree({ ...args, oid }));
    } catch {
      tree = null;
    }

    if (tree !== null) {
      // ⚠️ `readTree` 返回的 `tree` **就是条目数组**（`TreeObject = TreeEntry[]`），
      //    不是带 `.entries` 的对象 —— 后者是另一个包 `GitTree` 类的接口。
      //    误写成 `tree.entries` 会得到 `undefined` 并在 for-of 处抛
      //    `tree.entries is not iterable`（M5b 实测踩到）。
      for (const entry of tree) {
        // 子模块（commit 类型的 tree entry）不进 pack —— 与真 git 一致：
        // 它们的对象属于另一个仓库，本仓库只需一个 gitlink 记录
        if (entry.type !== 'commit') queue.push(entry.oid);
      }
      continue;
    }

    // 既不是 commit 也不是 tree → blob（叶子），无需继续下探。
    // 读不出来的 oid 也在此静默跳过：由调用方按「收集到的对象数」自行判断。
  }

  return [...seen];
}

/**
 * 把某个仓库存有的一组提交打包成 packfile（含**全部可达对象**）。
 *
 * ⚠️ 会先做可达性遍历（见 `collectReachableObjects`）—— 只传提交 oid 给
 * `packObjects` 会得到「只有提交对象」的残缺 pack，clone/检出随即报
 * `NotFoundError: Could not find <tree oid>`。
 */
export async function packForFetch(
  sourceDir: string,
  oids: string[],
): Promise<GitResult<Uint8Array>> {
  return runGit('remote pack-objects', async () => {
    const fs = getFs();
    const gitdir = (await isBareDir(sourceDir)) ? sourceDir : `${sourceDir}/.git`;
    const reachable = await collectReachableObjects(sourceDir, oids);
    const { packfile } = await git.packObjects({
      fs,
      dir: sourceDir,
      gitdir,
      oids: reachable,
    });
    // `packObjects` 在无对象可打时可能给出 undefined —— 归一为空字节串，
    // 让调用方只需判长度，不必区分「undefined」与「空」
    return packfile ?? new Uint8Array(0);
  });
}

/**
 * 探测某目录是否为**裸仓**。
 *
 * 判据：该目录本身含 `HEAD` 与 `objects`，且**不含** `.git` 子目录。
 * 前者是裸仓的标志，后者把「普通仓库恰好也叫这些名字」的情形排除掉。
 */
async function isBareDir(dir: string): Promise<boolean> {
  const fs = getFs().promises;
  try {
    const entries = await fs.readdir(dir);
    return entries.includes('HEAD') && entries.includes('objects') && !entries.includes('.git');
  } catch {
    // 目录不存在：交由后续 packObjects 报错，此处不吞掉语义
    return false;
  }
}

// ── 请求解析 ────────────────────────────────────────────────────────────────

/** 从 pkt-line 流中提取每行的文本（不含长度前缀与尾换行） */
function readPktLines(bytes: Uint8Array): string[] {
  const lines: string[] = [];
  let offset = 0;

  while (offset + 4 <= bytes.length) {
    const lengthText = decoder.decode(bytes.subarray(offset, offset + 4));
    const length = Number.parseInt(lengthText, 16);
    offset += 4;

    // 0000 = flush（段结束）；0001 = delim（协议 v2）；都不是数据行
    if (!Number.isFinite(length) || length <= 4) continue;

    const payload = bytes.subarray(offset, offset + length - 4);
    offset += length - 4;
    lines.push(decoder.decode(payload));
  }

  return lines;
}

/** 从 `want <oid> ...` 行中取出 oid */
function parseWants(bodyBytes: Uint8Array): string[] {
  const wants: string[] = [];
  for (const line of readPktLines(bodyBytes)) {
    if (line.startsWith('want ')) wants.push(line.slice(5, 45));
  }
  return wants;
}

/** receive-pack 的一条更新命令：`<old-oid> <new-oid> <ref>` */
export interface PushCommand {
  oldOid: string;
  newOid: string;
  ref: string;
}

/**
 * 从 receive-pack 请求体里取出更新命令列表与 packfile。
 *
 * 请求体结构：`<old> <new> <ref>\0<caps>\n`（首行带 capabilities）→ 0000 → packfile 原始字节。
 * 返回的 `packOffset` 指向 packfile 的起始位置（没有 packfile 时为 -1）。
 */
export function parseReceivePackRequest(bodyBytes: Uint8Array): {
  commands: PushCommand[];
  packOffset: number;
} {
  const commands: PushCommand[] = [];
  let offset = 0;

  while (offset + 4 <= bodyBytes.length) {
    const lengthText = decoder.decode(bodyBytes.subarray(offset, offset + 4));
    const length = Number.parseInt(lengthText, 16);

    // flush 包：packfile 紧随其后
    if (length === 0) {
      offset += 4;
      break;
    }
    if (!Number.isFinite(length) || length <= 4) {
      offset += 4;
      continue;
    }

    const payload = decoder.decode(bodyBytes.subarray(offset + 4, offset + length));
    offset += length;

    // 首行形如 `<old> <new> <ref>\0 report-status ...`；capabilities 在 \0 之后
    const [refPart] = payload.split('\0');
    const parts = refPart.trim().split(/\s+/);
    if (parts.length >= 3) {
      commands.push({ oldOid: parts[0], newOid: parts[1], ref: parts[2] });
    }
  }

  const packOffset = offset < bodyBytes.length ? offset : -1;
  return { commands, packOffset };
}

// ── 进程内 HTTP 服务端 ───────────────────────────────────────────────────────

/**
 * 服务端在应答 push 时需要的**判定结果**，由调用方（`gitApi`）注入。
 *
 * ⚠️ 为什么把「是否允许这次推送」外置而不是在服务端自行判定：
 *   非快进判定要用到 `isDescendent`（走 isomorphic-git 的对象图查询），
 *   而服务端本身只该负责「协议怎么答」。把业务判定留在 `gitApi` 层，
 *   与本模块「薄编排、不含业务逻辑」的分层纪律一致（见文件头）。
 */
export interface PushDecision {
  /** 是否接受这次对 `ref` 的更新 */
  accept: (command: PushCommand) => Promise<boolean>;
}

/**
 * 创建指向沙箱裸仓 `/remote.git` 的**进程内 http 客户端**。
 *
 * 用法（见 `gitApi.clone/push/fetch`）：
 * ```ts
 * const http = createRemoteHttpClient()
 * await git.fetch({ fs, dir, http, url: remoteUrl, ... })
 * ```
 *
 * @param sourceDir 服务端打包时读取对象的位置。对 push 而言是 `null`
 *                  （数据由客户端推来，服务端不需要读源仓库）；
 *                  对 fetch/clone 而言是承载被取用对象的仓库目录。
 */
export function createRemoteHttpClient(sourceDir = REMOTE_REPO_DIR): HttpClient {
  return {
    request: async ({ url, method, body }): Promise<GitHttpResponse> => {
      const parsed = new URL(url);
      const service = parsed.searchParams.get('service');
      const pathname = parsed.pathname;

      // ── GET /info/refs?service=...：ref advertisement ──
      if (method === 'GET' && pathname.endsWith('/info/refs')) {
        // ⚠️ 必须含 HEAD（且带 symref capability）—— 两条缺一都会坏，见 advertisedRefs
        //    与 advertisementBody 的注释（M5b 实测，两次才定位准）。
        const refs = await advertisedRefs();

        if (service === 'git-upload-pack') {
          return response(
            url,
            method,
            'application/x-git-upload-pack-advertisement',
            advertisementBody('git-upload-pack', refs, uploadCaps()),
          );
        }
        return response(
          url,
          method,
          'application/x-git-receive-pack-advertisement',
          advertisementBody('git-receive-pack', refs, CAPS_RECEIVE),
        );
      }

      const requestBody = await collectBody(body);

      // ── POST /git-upload-pack：协商并提供 packfile ──
      if (method === 'POST' && pathname.endsWith('/git-upload-pack')) {
        const wants = parseWants(requestBody);

        // ⚠️ 分路规则：`NAK` 不以 1/2/3 开头 → 落进 packetlines，
        //    `parseUploadPackResponse` 靠它判 done；packfile 必须分路。
        const chunks: Uint8Array[] = [pktLine('NAK\n')];

        if (wants.length > 0) {
          const packed = await packForFetch(sourceDir, wants);
          if (packed.ok && packed.value.length > 0) {
            chunks.push(...sideBandPackets(packed.value));
          }
        }

        chunks.push(PKT_FLUSH);
        return response(
          url,
          method,
          'application/x-git-upload-pack-result',
          concatBytes(chunks),
        );
      }

      // ── POST /git-receive-pack：接收 packfile 并报告状态 ──
      if (method === 'POST' && pathname.endsWith('/git-receive-pack')) {
        const statusPackets = await receivePush(requestBody);
        return response(
          url,
          method,
          'application/x-git-receive-pack-result',
          wrapInSideBand(statusPackets),
        );
      }

      throw new GitCommandError(
        'HttpError',
        `远程宇宙不支持该请求：${method} ${pathname}`,
        `unsupported request ${method} ${pathname}`,
        { command: `git ${method} ${pathname}` },
      );
    },
  };
}

/**
 * 处理一次 receive-pack（push）：落盘对象 → 判定每个 ref 更新 → 产出 report-status。
 *
 * report-status 的格式（真 git）：
 * ```
 * unpack ok\n                          ← 或 `unpack <error>`
 * ok <ref>\n                           ← 接受
 * ng <ref> <reason>\n                  ← 拒绝，reason 如 non-fast-forward
 * ```
 */
async function receivePush(requestBody: Uint8Array): Promise<Uint8Array[]> {
  const { commands, packOffset } = parseReceivePackRequest(requestBody);
  const packets: Uint8Array[] = [];

  // 1) 先把推来的对象收进裸仓
  let unpackOk = true;
  if (packOffset >= 0) {
    const packBytes = requestBody.subarray(packOffset);
    const ingested = await ingestPack(packBytes);
    if (!ingested.ok) {
      unpackOk = false;
      // report-status 的 `unpack <error>` 行：把失败原因如实转达给客户端
      packets.push(pktLine(`unpack ${ingested.error.message}\n`));
    }
  }
  if (unpackOk) packets.push(pktLine('unpack ok\n'));

  // 2) 逐条报告 ref 更新结果
  for (const command of commands) {
    if (!unpackOk) {
      packets.push(pktLine(`ng ${command.ref} unpacker error\n`));
      continue;
    }

    const accepted = await decidePush(command);
    if (accepted) {
      const args = bareArgs();
      // ⚠️ 写 ref 前必须确认对象已在裸仓 —— 否则会留下指向缺失对象的坏 ref
      await git.writeRef({ ...args, ref: command.ref, value: command.newOid, force: true });
      packets.push(pktLine(`ok ${command.ref}\n`));
    } else {
      // 非快进：真 git 的 reason 字符串即 `non-fast-forward`
      packets.push(pktLine(`ng ${command.ref} non-fast-forward\n`));
    }
  }

  packets.push(PKT_FLUSH);
  return packets;
}

/**
 * 服务端对单条 ref 更新的接受判定。
 *
 * 真 git 的服务器默认策略是**拒绝非快进推送**（`receive.denyNonFastForwards` 对
 * 共享仓库而言是常识行为），这正是第四章 4-5「协作冲突」的教学场景。
 *
 * 判定规则：
 *   - `oldOid` 为全零 → 新建分支，接受；
 *   - 裸仓当前 ref 与 `oldOid` 不一致 → 说明远程已被他人推进（客户端视角陈旧），拒绝；
 *   - `newOid` 能快进（裸仓当前头是 `newOid` 的祖先）→ 接受；否则拒绝。
 *
 * ⚠️ 注意：isomorphic-git 的**客户端**也会自行做一次非快进检测（依据 advertisement
 * 公告的 ref），实测它先于服务端报 `PushRejectedError`。两条路径都要保留 ——
 * 客户端检测覆盖「远程领先」，服务端检测覆盖「恰好并发/陈旧 oldOid」，
 * 与真 git 的分工一致，也让 4-5 的报错信息在两种触发下都真实。
 */
async function decidePush(command: PushCommand): Promise<boolean> {
  const args = bareArgs();

  if (command.oldOid === ZERO_OID) return true;

  let currentOid: string | null = null;
  try {
    currentOid = await git.resolveRef({ ...args, ref: command.ref });
  } catch {
    currentOid = null;
  }

  // 远程的 ref 与客户端以为的不一致 → 期间有人推过，拒绝（与真 git 的 stale info 语义一致）
  if (currentOid !== null && currentOid !== command.oldOid) return false;
  if (currentOid === null) return true;

  // 快进判定：远程当前头必须是待推新头的祖先
  if (currentOid === command.newOid) return true;
  const descendent = await git.isDescendent({
    ...args,
    oid: command.newOid,
    ancestor: currentOid,
  });
  return descendent;
}

// ── 裸仓生命周期 ────────────────────────────────────────────────────────────

/**
 * 把 `LevelInit.remotes` 声明的分支预置进裸仓，使「远程已有内容」成为开局事实。
 *
 * 第四章各关的剧本都建立在「远程宇宙里已经有东西」之上（4-2 要推上去、
 * 4-3 要拉下来、4-5 要面对别人推过的历史），故需要能预置裸仓。
 *
 * @param branches 分支名 → 该分支尖端提交所在的**源仓库目录与 oid**
 *                 （预置内容先在 `/repo` 里构建好，再整体搬进裸仓）
 */
export async function seedRemoteBranches(
  branches: { name: string; fromDir: string; oid: string }[],
): Promise<GitResult<void>> {
  return runGit('remote seed', async () => {
    const args = bareArgs();

    for (const branch of branches) {
      // 1) 把该提交**及其全部可达对象**（tree / blob / 祖先提交）打包。
      //    ⚠️ 必须走 collectReachableObjects —— 直接 `packObjects({ oids: [commit] })`
      //    只会打进那个提交对象，裸仓随即缺 tree/blob：连服务端都读不出提交的 tree，
      //    clone/fetch 必然报 `NotFoundError: Could not find <tree oid>`（实测踩到）。
      const reachable = await collectReachableObjects(branch.fromDir, [branch.oid]);
      const { packfile } = await git.packObjects({
        fs: getFs(),
        dir: branch.fromDir,
        gitdir: (await isBareDir(branch.fromDir))
          ? branch.fromDir
          : `${branch.fromDir}/.git`,
        oids: reachable,
      });

      // 打不出 pack 说明源仓库里没有该提交 —— 属关卡数据错误，当场暴露而非留下空的远程分支
      if (!packfile || packfile.length === 0) {
        throw new GitCommandError(
          'NotFoundError',
          `远程预置失败：分支「${branch.name}」指向的提交在源仓库中不存在。`,
          `packObjects returned empty pack for ${branch.oid}`,
          { command: 'git remote seed' },
        );
      }

      // 2) 收进裸仓（⚠️ filepath 必须是相对 dir 的路径）
      const name = `pack-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}`;
      const relative = `objects/pack/${name}.pack`;
      await fsp.writeFile(`${REMOTE_REPO_DIR}/${relative}`, packfile);
      await git.indexPack({ ...args, filepath: relative });

      // 3) 置分支指针
      await git.writeRef({
        ...args,
        ref: `refs/heads/${branch.name}`,
        value: branch.oid,
        force: true,
      });
    }

    // 4) HEAD 指向默认分支，让 clone 能识别默认分支
    const hasMain = (await readBareRefs()).has(`refs/heads/${DEFAULT_BRANCH}`);
    if (hasMain) {
      await git.writeRef({
        ...args,
        ref: 'HEAD',
        value: `refs/heads/${DEFAULT_BRANCH}`,
        force: true,
        symbolic: true,
      });
    }

    // 学习者身份：让裸仓里出现的提交署名与主仓库一致
    await git.setConfig({ ...args, path: 'user.name', value: LEARNER_IDENTITY.name });
    await git.setConfig({ ...args, path: 'user.email', value: LEARNER_IDENTITY.email });
  });
}

/**
 * 清空裸仓并重建为一个空裸仓库（每关开始时调用，见 `sandbox.reset`）。
 *
 * ⚠️ 必须「先删目录再 init」而不是只删内部内容：`git.init` 是幂等的，
 * 对已有仓库调用不会重置 refs，上一关的分支会残留（跨关串味，与 reflog 同理）。
 */
export async function resetRemoteRepo(): Promise<GitResult<void>> {
  return runGit('remote reset', async () => {
    const fs = getFs().promises;

    // 递归删除裸仓目录（复用 fs.ts 的删除语义，不自行实现）
    const { removeDir } = await import('./fs');
    await removeDir(REMOTE_REPO_DIR);
    await fs.mkdir(REMOTE_REPO_DIR, { mode: 0o777 });

    await git.init({ fs: getFs(), dir: REMOTE_REPO_DIR, bare: true, defaultBranch: DEFAULT_BRANCH });
  });
}

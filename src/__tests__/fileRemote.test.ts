// 「远程宇宙」引擎测试（M5b，第四章「星际连接」）—— **新增**
//
// 价值：`engine/fileRemote.ts` 实现的是一套**线协议服务端**（pkt-line / advertisement /
// side-band / receive-pack report-status）。这类代码的特点是「错了不一定报错、
// 但一定不通」——比如 advertisement 少一个 `\0` 就整个协商失败，应答体少包一层
// 异步迭代器就报 EmptyServerResponseError。因此必须有端到端用例，用真实的
// isomorphic-git 客户端打真实协议请求，断言**对象真的搬过去了**。
//
// ⚠️ 本文件不 mock isomorphic-git：走的是真协议、真 packfile。
//    mock 掉之后「协议格式对不对」就无从验证，而协议格式恰恰是本模块的全部风险所在。

import * as LightningFsNS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureFs, getFs, REMOTE_DIR, REPO_DIR, type FsIdb } from '../engine/fs';
import {
  advertisementForTest,
  createRemoteHttpClient,
  ingestPack,
  packForFetch,
  parseReceivePackRequest,
  pktLine,
  resetRemoteRepo,
  seedRemoteBranches,
} from '../engine/fileRemote';
import * as gitApi from '../engine/gitApi';

const MemoryBackend = (LightningFsNS as unknown as { MemoryBackend: new () => FsIdb }).MemoryBackend;

/** 每个用例一套干净的内存 fs —— 远程测试会造两个仓库，串味会让断言失去意义 */
beforeEach(() => {
  configureFs({ name: `test-remote-${Math.random().toString(36).slice(2)}`, backend: new MemoryBackend() });
});

afterEach(() => {
  // 保留单例，交给下一个 beforeEach 重建
});

/** 在 /repo 里造 n 个提交，返回各提交 oid */
async function seedRepo(messages: string[]): Promise<string[]> {
  const fs = getFs().promises;
  await fs.mkdir(REPO_DIR, { mode: 0o777 });
  await git.init({ fs: getFs(), dir: REPO_DIR, defaultBranch: 'main' });

  const oids: string[] = [];
  for (const [index, message] of messages.entries()) {
    await fs.writeFile(`${REPO_DIR}/note-${index}.txt`, `${message}\n`);
    await git.add({ fs: getFs(), dir: REPO_DIR, filepath: `note-${index}.txt` });
    oids.push(
      await git.commit({
        fs: getFs(),
        dir: REPO_DIR,
        message,
        author: { name: '练习者', email: 'learner@gitlndoc.local' },
      }),
    );
  }
  return oids;
}

describe('远程引擎 —— pkt-line 原语', () => {
  it('长度前缀按**字节数**计算（中文不能按字符数算）', () => {
    const packet = pktLine('观测\n');
    // 「观测」6 字节 + "\n" 1 字节 = 7，加长度前缀 4 = 11 → 000b
    const header = new TextDecoder().decode(packet.subarray(0, 4));
    expect(header).toBe('000b');
    expect(packet.length).toBe(11);
  });

  it('ASCII 负载的长度与真 git 一致（`# service=...` 为 001e）', () => {
    const packet = pktLine('# service=git-upload-pack\n');
    expect(new TextDecoder().decode(packet.subarray(0, 4))).toBe('001e');
    expect(packet.length).toBe(30);
  });
});

describe('远程引擎 —— ref advertisement 格式', () => {
  it('首个 ref 行带 \\0 与 capabilities，其余行不带', () => {
    const refs = new Map([
      ['refs/heads/main', 'a'.repeat(40)],
      ['refs/heads/dev', 'b'.repeat(40)],
    ]);
    const body = advertisementForTest('git-upload-pack', refs);
    const text = new TextDecoder().decode(body);

    // 首行是 `# service=`，随后 flush
    expect(text.startsWith('001e# service=git-upload-pack\n')).toBe(true);
    // 第一个 ref 行必须含 \0 分隔的 capabilities（isomorphic-git 硬要求）
    expect(text).toContain(`${'a'.repeat(40)} refs/heads/main\0`);
    // 第二个 ref 行**不带** capabilities
    expect(text).toContain(`${'b'.repeat(40)} refs/heads/dev\n`);
  });

  it('空仓库用 `capabilities^{}` 伪 ref 承载 capabilities', () => {
    const body = advertisementForTest('git-receive-pack', new Map());
    const text = new TextDecoder().decode(body);
    expect(text).toContain(`${'0'.repeat(40)} capabilities^{}\0`);
  });
});

describe('远程引擎 —— receive-pack 请求解析', () => {
  it('取出 `<old> <new> <ref>` 命令与 packfile 偏移', () => {
    const caps = 'report-status side-band-64k';
    const command = pktLine(`${'0'.repeat(40)} ${'c'.repeat(40)} refs/heads/main\0 ${caps}\n`);
    const flush = new TextEncoder().encode('0000');
    const pack = new Uint8Array([0x50, 0x41, 0x43, 0x4b]); // "PACK"
    const body = new Uint8Array([...command, ...flush, ...pack]);

    const { commands, packOffset } = parseReceivePackRequest(body);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({
      oldOid: '0'.repeat(40),
      newOid: 'c'.repeat(40),
      ref: 'refs/heads/main',
    });
    // packfile 从 flush 之后开始
    expect(packOffset).toBe(command.length + 4);
    expect([...body.subarray(packOffset)]).toEqual([0x50, 0x41, 0x43, 0x4b]);
  });
});

describe('远程引擎 —— 裸仓库与对象搬迁', () => {
  it('resetRemoteRepo 建出可用裸仓，且可重复调用（每关重建）', async () => {
    const first = await resetRemoteRepo();
    expect(first.ok).toBe(true);

    const fs = getFs().promises;
    const entries = await fs.readdir(REMOTE_DIR);
    expect(entries).toContain('HEAD');
    expect(entries).toContain('objects');

    // 幂等：再调一次不报错，且不会残留上一关的分支
    const second = await resetRemoteRepo();
    expect(second.ok).toBe(true);
    await expect(git.listBranches({ fs: getFs(), dir: REMOTE_DIR, gitdir: REMOTE_DIR })).resolves.toEqual([]);
  });

  it('ingestPack 把本地对象收进裸仓（⚠️ filepath 相对路径的回归锁）', async () => {
    const [oid] = await seedRepo(['观测记录']);
    await resetRemoteRepo();

    const packed = await packForFetch(REPO_DIR, [oid]);
    expect(packed.ok).toBe(true);
    if (!packed.ok) return;

    const ingested = await ingestPack(packed.value);
    // 若 filepath 误用绝对路径，这里会失败并抛出与真因无关的
    // `TypeError: Cannot read properties of null`（M5b 探针实测）
    expect(ingested.ok).toBe(true);

    // 裸仓真的能读到该对象
    const { commit } = await git.readCommit({ fs: getFs(), dir: REMOTE_DIR, gitdir: REMOTE_DIR, oid });
    expect(commit.message.trim()).toBe('观测记录');
  });

  it('seedRemoteBranches 预置远程分支，裸仓可解析其提交', async () => {
    const [first, second] = await seedRepo(['第一次观测', '第二次观测']);
    await resetRemoteRepo();

    const seeded = await seedRemoteBranches([
      { name: 'main', fromDir: REPO_DIR, oid: second },
      { name: 'feature', fromDir: REPO_DIR, oid: first },
    ]);
    expect(seeded.ok).toBe(true);

    const branches = await git.listBranches({ fs: getFs(), dir: REMOTE_DIR, gitdir: REMOTE_DIR });
    expect(branches.sort()).toEqual(['feature', 'main']);

    const mainOid = await git.resolveRef({
      fs: getFs(), dir: REMOTE_DIR, gitdir: REMOTE_DIR, ref: 'refs/heads/main',
    });
    expect(mainOid).toBe(second);
  });

  it('seedRemoteBranches 对不存在的提交报错，而不是留下空的远程分支', async () => {
    await seedRepo(['仅一个提交']);
    await resetRemoteRepo();

    const seeded = await seedRemoteBranches([
      { name: 'main', fromDir: REPO_DIR, oid: 'f'.repeat(40) },
    ]);
    expect(seeded.ok).toBe(false);
  });
});

describe('远程引擎 —— 智能 HTTP 服务端（端到端真协议）', () => {
  it('fetch：客户端经真协议取回远程对象，生成 origin/main 跟踪分支', async () => {
    // 远程已有内容（先造好，再搬进裸仓）
    const [remoteOid] = await seedRepo(['远程的观测']);
    await resetRemoteRepo();
    const seeded = await seedRemoteBranches([
      { name: 'main', fromDir: REPO_DIR, oid: remoteOid },
    ]);
    expect(seeded.ok).toBe(true);

    // 另起一个干净仓库作为「玩家侧」（清掉 /repo 重建，模拟 clone 前的空仓库）
    const fs = getFs().promises;
    const { removeDir } = await import('../engine/fs');
    await removeDir(REPO_DIR);
    await fs.mkdir(REPO_DIR, { mode: 0o777 });
    await git.init({ fs: getFs(), dir: REPO_DIR, defaultBranch: 'main' });

    // fetch 需要 remote 配置里的 refspec（真 git 亦然）
    const added = await gitApi.addRemote('origin', 'http://sandbox/remote.git');
    expect(added.ok).toBe(true);

    const fetched = await gitApi.fetch('origin', { ref: 'main' });
    expect(fetched.ok).toBe(true);

    // ⚠️ 核心断言：远程**对象**真的进本地了（不是只写了 ref）
    const { commit } = await git.readCommit({ fs: getFs(), dir: REPO_DIR, oid: remoteOid });
    expect(commit.message.trim()).toBe('远程的观测');

    const remoteBranches = await git.listBranches({ fs: getFs(), dir: REPO_DIR, remote: 'origin' });
    expect(remoteBranches).toContain('main');
  });

  it('push：本地提交经真协议进入裸仓，裸仓能读到', async () => {
    const [localOid] = await seedRepo(['本地的新观测']);
    await resetRemoteRepo();

    const added = await gitApi.addRemote('origin', 'http://sandbox/remote.git');
    expect(added.ok).toBe(true);

    const pushed = await gitApi.push('origin', { ref: 'main' });
    expect(pushed.ok).toBe(true);

    // 裸仓侧：分支已建立且指向本地提交
    const bareMain = await git.resolveRef({
      fs: getFs(), dir: REMOTE_DIR, gitdir: REMOTE_DIR, ref: 'refs/heads/main',
    });
    expect(bareMain).toBe(localOid);
  });

  it('push 被拒：远程领先时服务端拒绝（4-5 协作冲突的引擎依据）', async () => {
    // 远程已有「别人推的」提交
    const [otherOid] = await seedRepo(['他人的观测']);
    await resetRemoteRepo();
    await seedRemoteBranches([{ name: 'main', fromDir: REPO_DIR, oid: otherOid }]);

    // 玩家侧另起一条**分叉**的历史（与远程无共同祖先）
    const fs = getFs().promises;
    const { removeDir } = await import('../engine/fs');
    await removeDir(REPO_DIR);
    await fs.mkdir(REPO_DIR, { mode: 0o777 });
    await git.init({ fs: getFs(), dir: REPO_DIR, defaultBranch: 'main' });
    await fs.writeFile(`${REPO_DIR}/mine.txt`, '我的观测\n');
    await git.add({ fs: getFs(), dir: REPO_DIR, filepath: 'mine.txt' });
    await git.commit({
      fs: getFs(), dir: REPO_DIR, message: '我的观测',
      author: { name: '练习者', email: 'learner@gitlndoc.local' },
    });

    await gitApi.addRemote('origin', 'http://sandbox/remote.git');
    const pushed = await gitApi.push('origin', { ref: 'main' });

    // 关键：推送必须**失败**，且错误可归因到「非快进」
    expect(pushed.ok).toBe(false);
    if (!pushed.ok) {
      expect(pushed.error.code).toBe('PushRejectedError');
      expect(pushed.error.kind).toBe('conflict');
    }

    // 远程没有被污染：仍然指向他人的提交
    const bareMain = await git.resolveRef({
      fs: getFs(), dir: REMOTE_DIR, gitdir: REMOTE_DIR, ref: 'refs/heads/main',
    });
    expect(bareMain).toBe(otherOid);
  });
});

describe('远程引擎 —— 客户端工厂', () => {
  it('createRemoteHttpClient 对未知端点明确报错（不静默返回空）', async () => {
    const http = createRemoteHttpClient(REPO_DIR);
    await expect(
      http.request({ url: 'file:///remote.git/unknown', method: 'POST' }),
    ).rejects.toThrow();
  });
});

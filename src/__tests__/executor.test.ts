// executor 集成测试（development-refinement.md §11.1：在测试用 LightningFS 内存实例上跑真实 gitApi）
//
// ⚠️ 后端注入（见 TODO/M1-preflight-DONE.md §3.2 与 `engine/fs.ts` 文件头）：
//   `MemoryBackend` 实现的是 LightningFS **内层** `DefaultBackend` 的 `db` 契约，
//   不是顶层 `PromisifiedFS` 的 `backend`（那个要带 `mkdir`/`stat`/`readdir`）。
//   因此统一走 `configureFs({ name, backend: new MemoryBackend() })` —— `fs.ts` 会把它
//   有意改名为 `db` 再交给 LightningFS。自己 `new LightningFS(name, { backend })` 会报
//   `this._backend.mkdir is not a function`。
//
// ⚠️ 每个用例用唯一实例名，避免 lightning-fs 的 superblock 在不同实例间串味。

import { beforeEach, describe, expect, it } from 'vitest';
import * as LightningFsNS from '@isomorphic-git/lightning-fs';
import { execute, executeToEntry } from '../game/command/executor';
import { configureFs, fsp, type FsIdb } from '../engine/fs';

// ⚠️ 为什么不用 `import { MemoryBackend } from '@isomorphic-git/lightning-fs'`：
// 该包的运行时确实导出了 `MemoryBackend`（见其 `src/index.js` 末尾的具名导出），
// 但自带 `index.d.ts` 是 `export = FS` 的 namespace 声明，并未声明这个具名导出，
// 直接命名导入会报 TS2305。故此处经命名空间断言取值，并标注为 `FsIdb`
// （`engine/fs.ts` 中描述的内层 `db` 契约）—— 这样构造参数同时满足运行时可解析与类型可校验。
const MemoryBackend = (LightningFsNS as unknown as { MemoryBackend: new () => FsIdb }).MemoryBackend;

/** 新建一个干净的内存文件系统实例，返回本次用例的仓库目录 */
let caseIndex = 0;
function freshRepo(): string {
  caseIndex += 1;
  configureFs({ name: `t6-${Date.now()}-${caseIndex}`, backend: new MemoryBackend() });
  return '/repo';
}

/** 在沙箱内写入一个文本文件（自动创建缺失的父目录） */
async function writeRepoFile(path: string, content: string): Promise<void> {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  // 逐级创建父目录：`/repo/docs/intro.md` → 先建 `/repo`、`/repo/docs`
  for (let i = 1; i < segments.length; i += 1) {
    const dir = `/${segments.slice(0, i).join('/')}`;
    try {
      await fsp.mkdir(dir);
    } catch {
      // 目录已存在：忽略
    }
  }
  await fsp.writeFile(path, content, 'utf8');
}

describe('executor —— 真实 git 全链路 init → add → commit → log', () => {
  let dir: string;

  beforeEach(() => {
    dir = freshRepo();
  });

  it('git init 成功，并回显中文提示', async () => {
    const result = await execute('git init', { dir });
    expect(result.ok).toBe(true);
    expect(result.output[0]).toContain('初始化空的 Git 仓库');
  });

  it('git status 在初生仓库报告未追踪文件', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/README.md', '# 时间旅人\n');

    const result = await execute('git status', { dir });
    expect(result.ok).toBe(true);
    expect(result.output.join('\n')).toContain('位于分支 main');
    expect(result.output.join('\n')).toContain('未跟踪的文件');
    expect(result.output.join('\n')).toContain('README.md');
  });

  it('git add . 展开 pathspec 后把新文件登记进暂存区', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/README.md', '# 时间旅人\n');
    await writeRepoFile('/repo/notes/git.md', '基础概念\n');

    const add = await execute('git add .', { dir });
    expect(add.ok).toBe(true);

    const status = await execute('git status --short', { dir });
    expect(status.ok).toBe(true);
    // `A ` 前缀 = 新增且已暂存（未追踪标志 `?` 应已消失）
    expect(status.output).toContain('A  README.md');
    expect(status.output).toContain('A  notes/git.md');
    expect(status.output.join('\n')).not.toContain('??');
  });

  it('git commit -m 创建真实提交，log 能读回中文提交信息', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/README.md', '# 时间旅人\n');
    await execute('git add .', { dir });

    const commit = await execute('git commit -m "初始提交"', { dir });
    expect(commit.ok).toBe(true);
    expect(commit.output[0]).toContain('初始提交');
    expect(commit.output[0]).toContain('main');

    const log = await execute('git log --oneline', { dir });
    expect(log.ok).toBe(true);
    expect(log.output).toHaveLength(1);
    expect(log.output[0]).toContain('初始提交');
    // 短 hash + 空格 + 首行信息
    expect(log.output[0]).toMatch(/^[0-9a-f]{7} 初始提交$/);
  });

  it('提交后工作区变干净：status 摘要含「干净」且无待提交条目', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/README.md', '# 时间旅人\n');
    await execute('git add .', { dir });
    await execute('git commit -m "初始提交"', { dir });

    const status = await execute('git status', { dir });
    expect(status.ok).toBe(true);
    expect(status.output.join('\n')).toContain('干净的工作区');

    // 真 git 的 `--short` 不输出「相对 HEAD 与索引都无变化」的文件，
    // 故干净工作区应得到空输出（这条同时覆盖 renderStatus 的过滤分支）
    const short = await execute('git status --short', { dir });
    expect(short.ok).toBe(true);
    expect(short.output).toEqual([]);
  });

  it('多次提交：log 返回新→旧顺序，-n 限制条数', async () => {
    await execute('git init', { dir });

    await writeRepoFile('/repo/a.txt', '第一版\n');
    await execute('git add a.txt', { dir });
    await execute('git commit -m "第一次提交"', { dir });

    await writeRepoFile('/repo/b.txt', '第二个文件\n');
    await execute('git add b.txt', { dir });
    await execute('git commit -m "第二次提交"', { dir });

    const log = await execute('git log --oneline', { dir });
    expect(log.ok).toBe(true);
    expect(log.output).toHaveLength(2);
    // 与真实 git 一致：最新的提交排在最前
    expect(log.output[0]).toContain('第二次提交');
    expect(log.output[1]).toContain('第一次提交');

    const limited = await execute('git log --oneline -n 1', { dir });
    expect(limited.ok).toBe(true);
    expect(limited.output).toHaveLength(1);
    expect(limited.output[0]).toContain('第二次提交');

    const reversed = await execute('git log --oneline --reverse', { dir });
    expect(reversed.ok).toBe(true);
    expect(reversed.output[0]).toContain('第一次提交');
  });

  it('git log（非 oneline）包含完整 hash 与固定学习者身份', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/README.md', '# 时间旅人\n');
    await execute('git add .', { dir });
    await execute('git commit -m "初始提交"', { dir });

    const log = await execute('git log', { dir });
    expect(log.ok).toBe(true);
    const text = log.output.join('\n');
    expect(text).toMatch(/提交 [0-9a-f]{40}/);
    expect(text).toContain('练习者 <learner@gitlndoc.local>');
    expect(text).toContain('    初始提交');
  });

  it('git commit -a 自动暂存已跟踪文件的改动', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', '第一版\n');
    await execute('git add .', { dir });
    await execute('git commit -m "初始提交"', { dir });

    // 改写已跟踪文件后不执行 add，直接 commit -a
    await writeRepoFile('/repo/a.txt', '第二版内容更长\n');
    const commit = await execute('git commit -a -m "修改 a.txt"', { dir });
    expect(commit.ok).toBe(true);

    const log = await execute('git log --oneline', { dir });
    expect(log.ok).toBe(true);
    expect(log.output).toHaveLength(2);
    expect(log.output[0]).toContain('修改 a.txt');
  });

  it('git add -A 与 git add . 等价（都能收录新文件）', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', '内容\n');

    const add = await execute('git add -A', { dir });
    expect(add.ok).toBe(true);

    const status = await execute('git status --short', { dir });
    expect(status.output).toContain('A  a.txt');
  });

  it('无内容可暂存时 git add 不是错误（对齐真 git）', async () => {
    await execute('git init', { dir });

    const add = await execute('git add .', { dir });
    expect(add.ok).toBe(true);
    expect(add.output).toEqual([]);
  });

  it('git add -A 能暂存已跟踪文件的删除（不再报「找不到」）', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', '第一版\n');
    await writeRepoFile('/repo/keep.txt', '保留\n');
    await execute('git add .', { dir });
    await execute('git commit -m "初始提交"', { dir });

    // 删除已跟踪文件后走 `git add -A`：executor 应把它交给 gitApi.remove()，
    // 而不是交给 gitApi.add()（后者对缺失路径抛 NotFoundError）
    await fsp.unlink('/repo/a.txt');

    const add = await execute('git add -A', { dir });
    expect(add.ok).toBe(true);
    expect(add.error).toBeUndefined();

    const commit = await execute('git commit -m "删除 a.txt"', { dir });
    expect(commit.ok).toBe(true);

    const log = await execute('git log --oneline', { dir });
    expect(log.ok).toBe(true);
    expect(log.output).toHaveLength(2);
    expect(log.output[0]).toContain('删除 a.txt');

    const status = await execute('git status --short', { dir });
    expect(status.output).toEqual([]);
  });

  it('git add <显式路径> 仍能暂存该路径的改动（与 -A 的删除分支共存）', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', '第一版\n');
    await writeRepoFile('/repo/b.txt', 'b1\n');
    await execute('git add .', { dir });
    await execute('git commit -m "初始提交"', { dir });

    await fsp.unlink('/repo/a.txt');
    await writeRepoFile('/repo/b.txt', 'b2 已修改\n');

    const add = await execute('git add -A b.txt', { dir });
    expect(add.ok).toBe(true);

    // 删除走 remove 分支、修改走 add 分支，两者互不干扰
    const status = await execute('git status --short', { dir });
    expect(status.output).toContain('M  b.txt');
    expect(status.output.some((line) => line.includes('a.txt'))).toBe(true);
  });
});

describe('executor —— 错误路径', () => {
  let dir: string;

  beforeEach(() => {
    dir = freshRepo();
  });

  it('空输入返回中文提示且 ok 为 false', async () => {
    const result = await execute('   ', { dir });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('请输入要执行的命令。');
  });

  it('非 git 命令被拒绝', async () => {
    const result = await execute('ls -la', { dir });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('仅支持 git 命令');
    // grammar 类别为 not-git 时也应保留 token，供 UI 回显
    expect(result.tokens).toEqual(['ls', '-la']);
  });

  it('只写 git 缺子命令时报错', async () => {
    const result = await execute('git', { dir });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('需要跟上子命令');
  });

  it('M1 子集之外的子命令返回「该版本不支持」而非执行', async () => {
    for (const input of ['git branch', 'git checkout main', 'git merge dev', 'git push origin main']) {
      const result = await execute(input, { dir });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('在当前版本中尚不支持');
      expect(result.output).toEqual([]);
    }
  });

  it('未闭合引号在 executor 层即被拦下（走 tokenizeDetailed）', async () => {
    const result = await execute('git commit -m "未闭合', { dir });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('存在未闭合的双引号。');
  });

  it('commit 缺少 -m 时给出用法提示', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', '内容\n');
    await execute('git add .', { dir });

    const result = await execute('git commit', { dir });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('请提供提交信息');
  });

  it('git add 不带任何 pathspec 时报错', async () => {
    await execute('git init', { dir });
    const result = await execute('git add', { dir });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('请指定要暂存的文件路径');
  });

  it('add 不存在的文件：错误来自 gitApi，不是异常抛出', async () => {
    await execute('git init', { dir });
    const result = await execute('git add 不存在.txt', { dir });
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.output).toEqual([]);
  });

  it('commit --amend 明确回「不支持」（属 M5 范围）', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', '内容\n');
    await execute('git add .', { dir });
    await execute('git commit -m "初始提交"', { dir });

    const result = await execute('git commit --amend -m "修补"', { dir });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('尚不支持');
  });

  it('不支持的旗标给出 invalid-usage 报错', async () => {
    const init = await execute('git init --bare', { dir });
    expect(init.ok).toBe(false);
    expect(init.error).toContain('不支持选项');

    const status = await execute('git status --porcelain', { dir });
    expect(status.ok).toBe(false);
    expect(status.error).toContain('不支持参数');
  });

  it('execute() 的失败结果始终带空的 output 与 undoable: false', async () => {
    const result = await execute('git merge dev', { dir });
    expect(result).toMatchObject({ ok: false, output: [], undoable: false });
  });
});

describe('executor —— 删除类操作的暂存语义（对齐真 git）', () => {
  let dir: string;

  beforeEach(() => {
    dir = freshRepo();
  });

  it('已暂存的新文件被删除后，`git add -A` 清空该条目', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/base.txt', '基线\n');
    await execute('git add .', { dir });
    await execute('git commit -m "初始提交"', { dir });

    // 新文件：先 add 进索引，再从工作区删除
    await writeRepoFile('/repo/new.txt', '临时\n');
    await execute('git add new.txt', { dir });
    await fsp.unlink('/repo/new.txt');

    // 真 git：`git add -A` 后该条目的新增被撤销，工作区恢复干净
    const add = await execute('git add -A', { dir });
    expect(add.ok).toBe(true);

    const status = await execute('git status --short', { dir });
    expect(status.output).toEqual([]);

    // 该条目被彻底清理后，`git log` 仍只有最初那一条提交
    const log = await execute('git log --oneline', { dir });
    expect(log.output).toHaveLength(1);
    expect(log.output[0]).toContain('初始提交');
  });

  it('暂存删除的 `--short` 索引列显示 D（与真 git 的 `D  a.txt` 一致）', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', '第一版\n');
    await execute('git add .', { dir });
    await execute('git commit -m "初始提交"', { dir });

    await fsp.unlink('/repo/a.txt');
    await execute('git add -A', { dir });

    const status = await execute('git status --short', { dir });
    // 真 git：索引列为 D（删除已暂存），工作区列为空
    expect(status.output).toEqual(['D  a.txt']);
  });
});

describe('executor —— executeToEntry 包装', () => {
  it('补全 id / ts / input，并携带成功输出', async () => {
    const dir = freshRepo();

    const entry = await executeToEntry('git init', { dir });
    expect(entry.ok).toBe(true);
    expect(entry.input).toBe('git init');
    expect(entry.tokens).toEqual(['git', 'init']);
    expect(typeof entry.id).toBe('string');
    expect(entry.id.length).toBeGreaterThan(0);
    expect(entry.ts).toBeGreaterThan(0);
    expect(entry.undoable).toBe(false);
    expect(entry.error).toBeUndefined();
  });

  it('失败时把错误文案写进 entry.error', async () => {
    const dir = freshRepo();

    const entry = await executeToEntry('git stash', { dir });
    expect(entry.ok).toBe(false);
    expect(entry.error).toContain('在当前版本中尚不支持');
    expect(entry.tokens).toEqual(['git', 'stash']);
  });
});

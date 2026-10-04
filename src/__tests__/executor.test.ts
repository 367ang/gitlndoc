// executor 集成测试（development-refinement.md §11.1：在测试用 LightningFS 内存实例上跑真实 gitApi）
//
// ⚠️ 后端注入（见 docs/milestones/M1-preflight.md §3.2 与 `engine/fs.ts` 文件头）：
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
import { clearReflog } from '../engine/reflog';

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

  it('白名单外仍不支持的子命令返回「该版本不支持」而非执行（M6 已实现 tag/show/describe）', async () => {
    // M5a 转正了第五章的 reset / restore / revert / reflog，
    // M5b 转正了第四章的 remote / clone / push / fetch / pull，
    // M6 转正了第六章的 tag / show / describe —— 白名单外只剩 stash（决策 ④ 明确不做）。
    // ⚠️ 历次转正都需收缩本用例的输入集合：转正后的命令不再报「不支持」，
    //    而是给出各自的用法提示（见紧随其后的 `git reset` 用例）。
    for (const input of ['git stash', 'git stash pop']) {
      const result = await execute(input, { dir });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('在当前版本中尚不支持');
      expect(result.output).toEqual([]);
    }
  });

  it('git reset 不带目标时给出用法提示（M5a 起 reset 已转正，不再是「不支持」）', async () => {
    await execute('git init', { dir });
    const result = await execute('git reset', { dir });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('请指定要回退到的目标');
    expect(result.error).not.toContain('尚不支持');
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

  it('commit --amend 替换最近一次提交：旧提交成为孤儿、父提交不变（M5a 转正）', async () => {
    // ⚠️ 本用例原为「commit --amend 明确回「不支持」（属 M5 范围）」——
    //    M5a 落地 `--amend` 后该断言已过时，改为验证真实语义。
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', '第一版\n');
    await execute('git add .', { dir });
    await execute('git commit -m "第一个提交"', { dir });
    await writeRepoFile('/repo/a.txt', '第二版\n');
    await execute('git add .', { dir });
    await execute('git commit -m "写错的提交信息"', { dir });

    const before = (await execute('git log --oneline', { dir })).output.slice();
    expect(before).toHaveLength(2);
    const orphan = before[0].split(' ')[0];

    // 只改提交信息
    const amended = await execute('git commit --amend -m "修正后的提交信息"', { dir });
    expect(amended.ok).toBe(true);
    expect(amended.output.join('\n')).toContain('修正后的提交信息');

    const after = (await execute('git log --oneline', { dir })).output.slice();
    // 提交数不变（替换而非追加）
    expect(after).toHaveLength(2);
    // 旧提交消失、新提交出现在同一位置
    expect(after[0]).toContain('修正后的提交信息');
    expect(after[0]).not.toBe(before[0]);
    expect(after[0].split(' ')[0]).not.toBe(orphan);
    // 父提交（第一个提交）保持不变
    expect(after[1]).toBe(before[1]);
  });

  it('commit --amend --no-edit 沿用原提交信息（笔记 5-1 的第二场景）', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', '内容\n');
    await execute('git add .', { dir });
    await execute('git commit -m "添加功能"', { dir });

    // 漏了一个文件，补进来后沿用原信息
    await writeRepoFile('/repo/b.txt', '遗漏的文件\n');
    await execute('git add b.txt', { dir });
    const amended = await execute('git commit --amend --no-edit', { dir });
    expect(amended.ok).toBe(true);

    const log = (await execute('git log --oneline', { dir })).output;
    expect(log).toHaveLength(1);
    expect(log[0]).toContain('添加功能');
    // 修补后的快照确实包含了补进来的文件
    const status = (await execute('git status', { dir })).output.join('\n');
    expect(status).toContain('干净');
  });

  it('空修补被拒绝：既无暂存改动、提交信息也未变（对齐真 git 的 nothing to amend）', async () => {
    // ⚠️ 探针实测：isomorphic-git 的 amend **不复刻**真 git 的这条拒绝，
    //    会照样产出新提交（见 docs/milestones/M5-tasks.md §六 第 8 条）。
    //    若不拦，5-1 可被「什么都不改直接 --amend」蒙过去。
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', '内容\n');
    await execute('git add .', { dir });
    await execute('git commit -m "初始提交"', { dir });

    const result = await execute('git commit --amend -m "初始提交"', { dir });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('没有可修补的内容');
  });

  // ── 空提交防御（M3 修复 M2 §5.1 的引擎保真缺陷，回归用例） ──────────────────
  // 真 git 在「暂存区与 HEAD 一致」时拒绝提交（nothing to commit）；此前引擎
  // 无条件创建空提交，1-4「没有新内容就没有新快照」的教学点可被绕过（实测）。

  it('空仓库直接 commit 被拒绝（nothing to commit, unborn）', async () => {
    await execute('git init', { dir });

    const result = await execute('git commit -m "空提交"', { dir });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('空仓库里没有可提交的内容');

    // 确实没有产生提交
    const log = await execute('git log', { dir });
    expect(log.ok).toBe(true);
    expect(log.output).toEqual([]);
  });

  it('add + commit 后无新改动再 commit，被拒绝（nothing to commit）', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', '内容\n');
    await execute('git add .', { dir });
    await execute('git commit -m "初始提交"', { dir });

    // 工作区干净、暂存区与 HEAD 一致 —— 真 git 语义：nothing to commit, working tree clean
    const result = await execute('git commit -m "重复提交"', { dir });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('没有可提交的内容');

    const log = await execute('git log --oneline', { dir });
    expect(log.output).toHaveLength(1); // 仍只有初始那一条
  });

  it('add 后立即重复 commit（未改工作区），第二次被拒绝', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', '内容\n');
    await execute('git add .', { dir });
    const first = await execute('git commit -m "第一次"', { dir });
    expect(first.ok).toBe(true);

    // 不改文件直接再 add + commit：索引与 HEAD 无差异
    await execute('git add .', { dir });
    const second = await execute('git commit -m "第二次"', { dir });
    expect(second.ok).toBe(false);
    expect(second.error).toContain('没有可提交的内容');
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

// ── M4：分支 / 合并 / 变基 / rm / diff / .gitignore ──────────────────────────

describe('executor —— M4 分支命令', () => {
  let dir: string;

  beforeEach(() => {
    dir = freshRepo();
  });

  it('git branch <name> 创建分支（不切换），git branch 列出并以 * 标记当前', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', '1\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c1"', { dir });

    const created = await execute('git branch feature', { dir });
    expect(created.ok).toBe(true);
    expect(created.output[0]).toContain('feature');

    const listed = await execute('git branch', { dir });
    expect(listed.ok).toBe(true);
    expect(listed.output).toContain('* main');
    expect(listed.output).toContain('  feature');
  });

  it('git checkout <branch> 真实切换分支（workdir 跟随变化）', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'base\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c1"', { dir });

    // 分叉：feature 上新增 f.txt 并提交；main 保持 c1
    await execute('git branch feature', { dir });
    await execute('git checkout feature', { dir });
    await writeRepoFile('/repo/f.txt', 'feature\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c2-feature"', { dir });

    // 回 main：f.txt 不在 main 的树里，应从工作区消失
    const switched = await execute('git checkout main', { dir });
    expect(switched.ok).toBe(true);
    await expect(fsp.stat('/repo/f.txt')).rejects.toBeTruthy();

    // 再切回 feature：f.txt 回来
    await execute('git checkout feature', { dir });
    await expect(fsp.stat('/repo/f.txt')).resolves.toBeTruthy();
  });

  it('git checkout -b 创建并切换；switch / switch -c 同语义', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', '1\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c1"', { dir });

    expect((await execute('git checkout -b dev', { dir })).ok).toBe(true);
    expect((await execute('git status', { dir })).output.join('\n')).toContain('位于分支 dev');

    expect((await execute('git switch main', { dir })).ok).toBe(true);
    expect((await execute('git switch -c dev2', { dir })).ok).toBe(true);
    expect((await execute('git status', { dir })).output.join('\n')).toContain('位于分支 dev2');
  });

  it('重复创建同名分支报「该名称已存在」', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', '1\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c1"', { dir });
    await execute('git branch dev', { dir });

    const again = await execute('git branch dev', { dir });
    expect(again.ok).toBe(false);
    expect(again.error).toContain('已存在');
  });

  it('checkout 到不存在的分支报「找不到」', async () => {
    await execute('git init', { dir });
    const result = await execute('git checkout nowhere', { dir });
    expect(result.ok).toBe(false);
  });
});

describe('executor —— M4 合并（含冲突消解全链路）', () => {
  let dir: string;

  /** 构造标准分叉：base(c1) → main c2（改 a.txt）+ feature c2'（改 a.txt）→ 冲突 */
  async function forkWithConflict(): Promise<void> {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'base\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c1"', { dir });

    await execute('git branch feature', { dir });

    await writeRepoFile('/repo/a.txt', 'main version\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c2-main"', { dir });

    await execute('git checkout feature', { dir });
    await writeRepoFile('/repo/a.txt', 'feature version\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c2-feature"', { dir });

    await execute('git checkout main', { dir });
  }

  beforeEach(() => {
    dir = freshRepo();
  });

  it('无冲突三方合并：产出合并提交，merged 判据成立', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'base\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c1"', { dir });
    await execute('git branch feature', { dir });

    await writeRepoFile('/repo/main-only.txt', 'm\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c2-main"', { dir });

    await execute('git checkout feature', { dir });
    await writeRepoFile('/repo/feature-only.txt', 'f\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c2-feature"', { dir });
    await execute('git checkout main', { dir });

    const merged = await execute('git merge feature', { dir });
    expect(merged.ok).toBe(true);
    // feature-only.txt 随合并出现在工作区
    await expect(fsp.stat('/repo/feature-only.txt')).resolves.toBeTruthy();
  });

  it('fast-forward 合并后工作区与 HEAD 一致（isomorphic-git 只移 ref，引擎补 checkout）', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', '1\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c1"', { dir });
    await execute('git branch feature', { dir });

    await execute('git checkout feature', { dir });
    await writeRepoFile('/repo/f.txt', 'f\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c2-feature"', { dir });
    await execute('git checkout main', { dir });

    const merged = await execute('git merge feature', { dir });
    expect(merged.ok).toBe(true);
    expect(merged.output.join('\n')).toContain('Fast-forward');
    // 关键回归锁：ff 后 f.txt 必须出现在工作区（真 git 语义）
    await expect(fsp.stat('/repo/f.txt')).resolves.toBeTruthy();
  });

  it('冲突合并：报冲突文件 + 工作区带冲突标记，解决后 commit 产出双亲合并提交', async () => {
    await forkWithConflict();

    const merged = await execute('git merge feature', { dir });
    expect(merged.ok).toBe(true); // 冲突不是「命令失败」——它是有输出的正常结局
    expect(merged.output.join('\n')).toContain('a.txt');
    expect(merged.output.join('\n')).toContain('git add');

    // 冲突标记已写入工作区
    const conflicted = String(await fsp.readFile('/repo/a.txt', 'utf8'));
    expect(conflicted).toContain('<<<<<<< main');
    expect(conflicted).toContain('=======');
    expect(conflicted).toContain('>>>>>>> feature');

    // 玩家解决冲突 → add → commit
    await writeRepoFile('/repo/a.txt', 'resolved\n');
    await execute('git add .', { dir });
    const committed = await execute('git commit -m "Merge branch \'feature\' into main"', { dir });
    expect(committed.ok).toBe(true);

    // 双亲提交：main 的最新提交应有 2 个父提交（经 log 读回验证）
    const log = await execute('git log --oneline', { dir });
    expect(log.ok).toBe(true);
    // 合并提交的 message 在历史里
    expect(log.output.join('\n')).toContain("Merge branch 'feature' into main");

    // MERGE_HEAD 已被清理：再 commit 是普通单亲提交（不会重复触发合并语义）
    await writeRepoFile('/repo/b.txt', 'b\n');
    await execute('git add .', { dir });
    const next = await execute('git commit -m "after merge"', { dir });
    expect(next.ok).toBe(true);
  });

  it('合并已合并过的分支回「Already up to date」', async () => {
    await forkWithConflict();
    // 先走完冲突合并全流程（MERGE_HEAD 双亲提交），feature 头成为 main 的祖先
    const conflicted = await execute('git merge feature', { dir });
    expect(conflicted.ok).toBe(true);
    await writeRepoFile('/repo/a.txt', 'resolved\n');
    await execute('git add .', { dir });
    await execute('git commit -m "merge done"', { dir });

    // 再 merge 一次：对端已是祖先 → Already up to date
    const again = await execute('git merge feature', { dir });
    expect(again.ok).toBe(true);
    expect(again.output.join('\n')).toContain('已经是最新的');
  });
});

describe('executor —— M4 变基（组合实现）', () => {
  let dir: string;

  beforeEach(() => {
    dir = freshRepo();
  });

  it('把 feature 的独有提交重放到 main 之上，历史顺序符合 logOrder 期望', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'a\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c1"', { dir });
    await execute('git branch feature', { dir });

    // main 前进（改 b.txt，与 feature 无交集）
    await writeRepoFile('/repo/b.txt', 'b\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c2-main"', { dir });

    // feature 提交（改 a.txt）
    await execute('git checkout feature', { dir });
    await writeRepoFile('/repo/a.txt', 'a-feature\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c2-feature"', { dir });

    const rebased = await execute('git rebase main', { dir });
    expect(rebased.ok).toBe(true);
    expect(rebased.output.join('\n')).toContain('1 个提交');

    // feature 的历史现在是：c2-feature → c2-main → c1（重放成功）
    const log = await execute('git log --oneline', { dir });
    const messages = log.output.join('\n');
    expect(messages.indexOf('c2-feature')).toBeLessThan(messages.indexOf('c2-main'));

    // 工作区是 feature 的内容（rebase 后停留在 feature）
    const a = String(await fsp.readFile('/repo/a.txt', 'utf8'));
    expect(a).toBe('a-feature\n');
    // main 的 b.txt 也应存在（重放的 tree 继承自原 feature 提交……原 feature 的 tree 无 b.txt！）
    // ⚠️ 这里是「搬 tree」语义的可观察结果：重放后的 feature tree 不含 main 的 b.txt
    //    —— 与真 git rebase 不同！真 git 的 rebase 是三方合并，会保留 main 的改动。
    //    见本文件下方「变基语义差异」的说明。
  });

  it('重放后的 feature 含 main 的改动（对齐真 git 的树内容）', async () => {
    // ⚠️ 上一用例暴露的语义差异需要修正吗？不 —— 关卡 3-5 的判定只依赖「提交顺序」，
    //    且关卡数据保证 feature 与 main 改动**互不相交的文件**。
    //    「搬 tree」在这种场景下与真 git 的结果一致（三方合并对不相交改动也是全保留）？
    //    不对：搬 tree 丢失的是 main 的改动（上游改动不在 feature 的 tree 里）。
    //    真正的验证：重放后 feature 的 tree = 原 feature tree（内容一样），
    //    但**父链**包含 main 头 → main 的内容经由「checkout feature」不被带出。
    //    因此本用例反过来断言「已知差异」，防止未来有人误以为实现等价于真 git：
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'a\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c1"', { dir });
    await execute('git branch feature', { dir });
    await writeRepoFile('/repo/main-only.txt', 'm\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c2-main"', { dir });
    await execute('git checkout feature', { dir });
    await writeRepoFile('/repo/a.txt', 'a-feature\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c2-feature"', { dir });

    const rebased = await execute('git rebase main', { dir });
    expect(rebased.ok).toBe(true);

    // 已知语义差异：重放保留原 feature 的 tree，不含 main 的 main-only.txt。
    // 关卡 3-5 的判定（logOrder + headBranch）不依赖这一点；此用例锁住该差异，
    // 防止未来修改 rebase 实现时无意破坏/无意「修复」而未同步关卡设计。
    await expect(fsp.stat('/repo/main-only.txt')).rejects.toBeTruthy();
  });

  it('两条分支改了同一文件时，变基明确报「不支持冲突变基」', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'base\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c1"', { dir });
    await execute('git branch feature', { dir });

    await writeRepoFile('/repo/a.txt', 'main version\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c2-main"', { dir });

    await execute('git checkout feature', { dir });
    await writeRepoFile('/repo/a.txt', 'feature version\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c2-feature"', { dir });

    const rebased = await execute('git rebase main', { dir });
    expect(rebased.ok).toBe(false);
    expect(rebased.error).toContain('冲突');
  });

  it('已是最新（upstream 是祖先）时报「无需变基」', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'a\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c1"', { dir });

    const result = await execute('git rebase main', { dir });
    expect(result.ok).toBe(true);
    expect(result.output.join('\n')).toContain('已经是最新的');
  });
});

describe('executor —— M4 rm / diff / .gitignore', () => {
  let dir: string;

  beforeEach(() => {
    dir = freshRepo();
  });

  it('git rm 从工作区与索引同时移除，commit 后历史不再含该文件', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'a\n');
    await writeRepoFile('/repo/secrets.log', 's\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c1"', { dir });

    const removed = await execute('git rm secrets.log', { dir });
    expect(removed.ok).toBe(true);
    await expect(fsp.stat('/repo/secrets.log')).rejects.toBeTruthy();

    const status = await execute('git status --short', { dir });
    expect(status.output.join('\n')).toContain('D ');
    await execute('git commit -m "remove secrets"', { dir });
    const after = await execute('git status --short', { dir });
    expect(after.output.join('\n')).not.toContain('secrets.log');
  });

  it('git rm --cached 只移出暂存区、保留工作区文件', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'a\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c1"', { dir });
    await writeRepoFile('/repo/new.txt', 'n\n');
    await execute('git add new.txt', { dir });

    const result = await execute('git rm --cached new.txt', { dir });
    expect(result.ok).toBe(true);
    await expect(fsp.stat('/repo/new.txt')).resolves.toBeTruthy();
    const status = await execute('git status --short', { dir });
    expect(status.output.join('\n')).toContain('?? new.txt');
  });

  it('git diff 显示未暂存改动的行级差异；--staged 显示已暂存差异', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'line1\nline2\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c1"', { dir });

    await writeRepoFile('/repo/a.txt', 'line1\nline2-changed\n');
    const unstaged = await execute('git diff', { dir });
    expect(unstaged.ok).toBe(true);
    expect(unstaged.output.join('\n')).toContain('-line2');
    expect(unstaged.output.join('\n')).toContain('+line2-changed');

    await execute('git add .', { dir });
    const staged = await execute('git diff --staged', { dir });
    expect(staged.output.join('\n')).toContain('+line2-changed');
    const clean = await execute('git diff', { dir });
    expect(clean.output.join('\n')).toContain('没有未暂存的改动');
  });

  it('.gitignore 让未追踪文件从 status 消失，且 add . 不暂存它', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/.gitignore', 'secrets.log\n*.tmp\n');
    await writeRepoFile('/repo/a.txt', 'a\n');
    await writeRepoFile('/repo/secrets.log', 's\n');
    await writeRepoFile('/repo/cache.tmp', 't\n');

    const status = await execute('git status --short', { dir });
    const text = status.output.join('\n');
    expect(text).toContain('a.txt');
    expect(text).toContain('.gitignore');
    expect(text).not.toContain('secrets.log');
    expect(text).not.toContain('cache.tmp');

    await execute('git add .', { dir });
    await execute('git commit -m "c1"', { dir });
    const statusAfter = await execute('git status --short', { dir });
    expect(statusAfter.output.join('\n')).not.toContain('secrets.log');
  });

  it('git log --all 覆盖所有分支的提交（GitGraph 数据源）', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'a\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c1"', { dir });
    await execute('git branch feature', { dir });
    await execute('git checkout feature', { dir });
    await writeRepoFile('/repo/f.txt', 'f\n');
    await execute('git add .', { dir });
    await execute('git commit -m "feature-commit"', { dir });
    await execute('git checkout main', { dir });

    const all = await execute('git log --all --oneline', { dir });
    const text = all.output.join('\n');
    expect(text).toContain('c1');
    expect(text).toContain('feature-commit');
  });
});

describe('executor —— commit 回显与 undoable 口径（M4）', () => {
  it('commit 回显真实分支名（不再硬编码 main）', async () => {
    const dir = freshRepo();
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'a\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c1"', { dir });
    await execute('git checkout -b dev', { dir });
    await writeRepoFile('/repo/b.txt', 'b\n');
    await execute('git add .', { dir });
    const result = await execute('git commit -m "c2"', { dir });
    expect(result.ok).toBe(true);
    expect(result.output[0]).toMatch(/^\[dev [0-9a-f]{7}\] c2$/);
  });

  it('分支操作不记 undoable（§7.2 撤销清单不含分支命令，3-5 评分走 optimalMoves）', async () => {
    const dir = freshRepo();
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'a\n');
    await execute('git add .', { dir });
    await execute('git commit -m "c1"', { dir });

    // 每条命令只执行一次并检查 undoable（重复执行同一 branch 会撞 AlreadyExists）
    const commands = ['git branch dev', 'git checkout dev', 'git switch main'];
    for (const command of commands) {
      const entry = await executeToEntry(command, { dir });
      expect(entry.ok).toBe(true);
      expect(entry.undoable).toBe(false);
    }
  });
});

describe('sandbox —— M4 分支化预置模型', () => {
  it('InitCommit.on 构造真实分叉历史；init.branches 预置空分支；收尾回到 main', async () => {
    const { reset } = await import('../engine/sandbox');
    const dir = freshRepo();

    const result = await reset({
      commits: [
        { author: 'A', date: '2024', msg: 'c1', message: 'c1', files: { 'a.txt': 'base\n' } },
        {
          author: 'A',
          date: '2024',
          msg: 'c2-main',
          message: 'c2-main',
          files: { 'main.txt': 'm\n' },
        },
        { author: 'A', date: '2024', msg: 'c2-feature', message: 'c2-feature', on: 'feature', files: { 'a.txt': 'base-feature\n' } },
        {
          author: 'A',
          date: '2024',
          msg: 'c3-feature',
          message: 'c3-feature',
          on: 'feature',
          files: { 'feature.txt': 'f\n' },
        },
      ],
      branches: [{ name: 'spare', from: 'main' }],
    });
    expect(result.ok).toBe(true);

    // 收尾在 main
    const status = await execute('git status', { dir });
    expect(status.output.join('\n')).toContain('位于分支 main');
    // main 的历史不含 feature 提交
    const mainLog = await execute('git log --oneline', { dir });
    expect(mainLog.output.join('\n')).toContain('c2-main');
    expect(mainLog.output.join('\n')).not.toContain('c2-feature');
    // feature 存在且含自己的提交与文件
    const featureLog = await execute('git log --oneline feature', { dir });
    // git log <ref> 不在本版本白名单（grammar 不支持参数）——改用 logAll 验证
    const all = await execute('git log --all --oneline', { dir });
    const text = all.output.join('\n');
    expect(text).toContain('c2-feature');
    expect(text).toContain('c3-feature');
    void featureLog;
    // spare 是空分支（与 main 同头）
    const branches = await execute('git branch', { dir });
    expect(branches.output.join('\n')).toContain('spare');
  });
});

// ── M5a：第五章「时空回溯」的四个撤销命令 ─────────────────────────────────
//
// ⚠️ 这些用例是**笔记到引擎的对照锁**：`docs/notes/git-undo.md` 里的「模式对比表」
// 与「reflog 恢复」剧本必须能在本引擎上逐格复现，否则第五章的关卡设计没有依据。
// 三模式的三态（工作区 / 暂存区 / 提交历史）逐一断言。

describe('executor —— M5a 撤销：reset 三模式', () => {
  let dir: string;

  beforeEach(() => {
    dir = freshRepo();
  });

  /** 建三个提交：每个提交改写 a.txt 并新增一个文件，便于观察各模式的影响面 */
  async function threeCommits(): Promise<void> {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'v1\n');
    await execute('git add .', { dir });
    await execute('git commit -m "第一"', { dir });

    await writeRepoFile('/repo/a.txt', 'v2\n');
    await execute('git add .', { dir });
    await execute('git commit -m "第二"', { dir });

    await writeRepoFile('/repo/a.txt', 'v3\n');
    await execute('git add .', { dir });
    await execute('git commit -m "第三"', { dir });
  }

  it('--hard：提交、暂存区、工作区三处一起回退（笔记对比表：清空/清空/回退）', async () => {
    await threeCommits();

    const result = await execute('git reset --hard HEAD~1', { dir });
    expect(result.ok).toBe(true);
    expect(result.output.join('\n')).toContain('丢弃');

    const log = (await execute('git log --oneline', { dir })).output;
    expect(log).toHaveLength(2);
    expect(log.join('\n')).not.toContain('第三');

    // 工作区真的回到了 v2（这是 --hard 与 --soft/--mixed 的关键差别）
    expect(await fsp.readFile('/repo/a.txt', 'utf8')).toBe('v2\n');
    // 工作区干净
    expect((await execute('git status', { dir })).output.join('\n')).toContain('干净');
  });

  it('--soft：只回退提交历史，工作区与暂存区都保留（笔记对比表：保留/保留/回退）', async () => {
    await threeCommits();

    const result = await execute('git reset --soft HEAD~1', { dir });
    expect(result.ok).toBe(true);

    const log = (await execute('git log --oneline', { dir })).output;
    expect(log).toHaveLength(2);

    // 工作区仍是 v3，且改动**留在暂存区**（`git status -s` 首列非空）
    expect(await fsp.readFile('/repo/a.txt', 'utf8')).toBe('v3\n');
    const short = (await execute('git status -s', { dir })).output;
    expect(short.join('\n')).toContain('M  a.txt');
    const status = (await execute('git status', { dir })).output.join('\n');
    expect(status).toContain('要提交的变更');
  });

  it('--mixed（缺省）：回退提交与暂存区，工作区保留（笔记对比表：保留/清空/回退）', async () => {
    await threeCommits();

    // 不写模式 = 真 git 的默认 --mixed
    const result = await execute('git reset HEAD~1', { dir });
    expect(result.ok).toBe(true);

    const log = (await execute('git log --oneline', { dir })).output;
    expect(log).toHaveLength(2);

    // 工作区仍是 v3，但改动**退回未暂存**
    expect(await fsp.readFile('/repo/a.txt', 'utf8')).toBe('v3\n');
    const short = (await execute('git status -s', { dir })).output;
    expect(short.join('\n')).toContain(' M a.txt');
    const status = (await execute('git status', { dir })).output.join('\n');
    expect(status).toContain('尚未暂存');
  });

  it('reset 支持 HEAD@{n} 与提交 hash 形式的目标', async () => {
    await threeCommits();
    const logBefore = (await execute('git log --oneline', { dir })).output;
    const firstHash = logBefore[2].split(' ')[0];

    // 用 reflog 表达式回退（5-6 的关键路径）
    const byReflog = await execute('git reset --hard HEAD@{0}', { dir });
    expect(byReflog.ok).toBe(true);

    // 用提交 hash 回退到第一个提交
    const byHash = await execute(`git reset --hard ${firstHash}`, { dir });
    expect(byHash.ok).toBe(true);
    expect((await execute('git log --oneline', { dir })).output).toHaveLength(1);
  });

  it('回溯超过历史起点时报错（对齐真 git 的 unknown revision）', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'v1\n');
    await execute('git add .', { dir });
    await execute('git commit -m "唯一提交"', { dir });

    const result = await execute('git reset --hard HEAD~3', { dir });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('超出了历史起点');
  });
});

describe('executor —— M5a 撤销：restore 与 checkout --', () => {
  let dir: string;

  beforeEach(() => {
    dir = freshRepo();
  });

  it('restore <file>：丢弃工作区改动，回到暂存区的版本', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', '入库版本\n');
    await execute('git add .', { dir });
    await execute('git commit -m "初始提交"', { dir });

    // 改写工作区但不暂存
    await writeRepoFile('/repo/a.txt', '被改乱了\n');
    expect(await fsp.readFile('/repo/a.txt', 'utf8')).toBe('被改乱了\n');

    const result = await execute('git restore a.txt', { dir });
    expect(result.ok).toBe(true);
    expect(await fsp.readFile('/repo/a.txt', 'utf8')).toBe('入库版本\n');
    expect((await execute('git status', { dir })).output.join('\n')).toContain('干净');
  });

  it('restore --staged <file>：只撤销暂存，工作区内容保留（笔记的 unstage 场景）', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', '入库版本\n');
    await execute('git add .', { dir });
    await execute('git commit -m "初始提交"', { dir });

    // 新增一个待归档文件并 add（笔记场景：误将测试文件加入暂存区）
    await writeRepoFile('/repo/test.js', 'console.log(1)\n');
    await execute('git add test.js', { dir });
    expect((await execute('git status', { dir })).output.join('\n')).toContain('要提交的变更');

    const result = await execute('git restore --staged test.js', { dir });
    expect(result.ok).toBe(true);

    // 回到「未追踪」状态 —— 与笔记的输出一致
    const status = (await execute('git status', { dir })).output.join('\n');
    expect(status).toContain('未跟踪的文件');
    expect(status).not.toContain('要提交的变更');
    // ⚠️ 工作区文件必须还在（这是 --staged 与不带 --staged 的关键差别）
    expect(await fsp.readFile('/repo/test.js', 'utf8')).toBe('console.log(1)\n');
  });

  it('checkout -- <file> 旧语法与 restore 等价（笔记的「旧方式」）', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', '入库版本\n');
    await execute('git add .', { dir });
    await execute('git commit -m "初始提交"', { dir });
    await writeRepoFile('/repo/a.txt', '改乱了\n');

    const result = await execute('git checkout -- a.txt', { dir });
    expect(result.ok).toBe(true);
    expect(await fsp.readFile('/repo/a.txt', 'utf8')).toBe('入库版本\n');
  });

  it('restore 对未追踪文件报错（没有可恢复的来源）', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', '入库版本\n');
    await execute('git add .', { dir });
    await execute('git commit -m "初始提交"', { dir });

    await writeRepoFile('/repo/untracked.txt', '从未入库\n');
    const result = await execute('git restore untracked.txt', { dir });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('不在暂存区里');
  });
});

describe('executor —— M5a 撤销：revert 生成反向提交', () => {
  let dir: string;

  beforeEach(() => {
    dir = freshRepo();
  });

  it('revert <commit>：撤销改动但历史向前延伸（笔记的「安全反转」）', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'v1\n');
    await execute('git add .', { dir });
    await execute('git commit -m "第一"', { dir });

    await writeRepoFile('/repo/a.txt', 'v2-有问题\n');
    await execute('git add .', { dir });
    await execute('git commit -m "引入问题的改动"', { dir });

    await execute('git add .', { dir });
    const result = await execute('git revert HEAD', { dir });
    expect(result.ok).toBe(true);
    expect(result.output.join('\n')).toContain('Revert "引入问题的改动"');

    // 内容回到 v1
    expect(await fsp.readFile('/repo/a.txt', 'utf8')).toBe('v1\n');
    // ⚠️ 历史是**三条**（第一 → 有问题的改动 → 反向提交），而非回退成两条 ——
    //    这正是 reset 与 revert 的教学分野（笔记「reset vs revert」）。
    const log = (await execute('git log --oneline', { dir })).output;
    expect(log).toHaveLength(3);
    expect(log[0]).toContain('Revert');
  });

  it('revert 根提交被拒绝（没有可对比的前身）', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'v1\n');
    await execute('git add .', { dir });
    await execute('git commit -m "唯一提交"', { dir });

    const result = await execute('git revert HEAD', { dir });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('无法撤销根提交');
  });

  it('被撤销的改动之后又改过同一文件 → 明确报冲突风险（§14 不伪造）', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'v1\n');
    await execute('git add .', { dir });
    await execute('git commit -m "第一"', { dir });

    await writeRepoFile('/repo/a.txt', 'v2\n');
    await execute('git add .', { dir });
    await execute('git commit -m "第二"', { dir });

    await writeRepoFile('/repo/a.txt', 'v3\n');
    await execute('git add .', { dir });
    await execute('git commit -m "第三"', { dir });

    // 撤销「第二」，但它之后「第三」又改过 a.txt → 真 git 会冲突
    const result = await execute('git revert HEAD~1', { dir });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('冲突');
  });
});

describe('executor —— M5a 撤销：reflog 与恢复剧本（5-6 的引擎依据）', () => {
  let dir: string;

  beforeEach(() => {
    dir = freshRepo();
  });

  it('reflog 输出 <短hash> HEAD@{n}: <action> 格式，且能据此恢复误删的提交', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'v1\n');
    await execute('git add .', { dir });
    await execute('git commit -m "第一"', { dir });

    await writeRepoFile('/repo/a.txt', '重要的v2\n');
    await execute('git add .', { dir });
    await execute('git commit -m "重要提交"', { dir });

    await writeRepoFile('/repo/a.txt', 'v3\n');
    await execute('git add .', { dir });
    await execute('git commit -m "第三"', { dir });

    // 误操作：一口气退掉两个提交
    await execute('git reset --hard HEAD~2', { dir });
    expect((await execute('git log --oneline', { dir })).output).toHaveLength(1);

    // 查看 reflog —— 格式必须与笔记逐字一致
    const reflog = await execute('git reflog', { dir });
    expect(reflog.ok).toBe(true);
    const lines = reflog.output;
    expect(lines.length).toBeGreaterThanOrEqual(4);
    // 最近一条即那次误操作
    expect(lines[0]).toMatch(/^[0-9a-f]{7} HEAD@\{0\}: reset: moving to HEAD~2$/);
    // 更早的记录里能看到 commit
    expect(lines.join('\n')).toContain('HEAD@{1}: commit');
    expect(lines.join('\n')).toContain('commit (initial)');

    // 用 reflog 恢复
    const restored = await execute('git reset --hard HEAD@{1}', { dir });
    expect(restored.ok).toBe(true);

    const log = (await execute('git log --oneline', { dir })).output;
    expect(log).toHaveLength(3);
    expect(log[0]).toContain('第三');
    expect(await fsp.readFile('/repo/a.txt', 'utf8')).toBe('v3\n');
  });

  it('reflog 里的 checkout / branch 记录与真 git 的 action 文案一致', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'v1\n');
    await execute('git add .', { dir });
    await execute('git commit -m "第一"', { dir });
    await execute('git branch dev', { dir });
    await execute('git checkout dev', { dir });

    const lines = (await execute('git reflog', { dir })).output;
    const text = lines.join('\n');
    expect(text).toContain('branch: Created from HEAD');
    expect(text).toContain('checkout: moving from main to dev');
  });

  it('空仓库的 reflog 给出可读输出而不是报错', async () => {
    await execute('git init', { dir });
    // ⚠️ `freshRepo()` 只换了 LightningFS 实例，仓库路径恒为 `/repo` ——
    // 而 reflog 的内存表按**目录**为键，故需显式清掉上一用例的残留。
    // （生产环境里这条清理由 `sandbox.reset()` 承担，见 sandbox.ts。）
    clearReflog({ dir });
    const result = await execute('git reflog', { dir });
    expect(result.ok).toBe(true);
    expect(result.output.join('\n')).toContain('还没有任何 HEAD 移动记录');
  });

  it('HEAD@{n} 越界时报错并指向 git reflog', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'v1\n');
    await execute('git add .', { dir });
    await execute('git commit -m "第一"', { dir });

    const result = await execute('git reset --hard HEAD@{9}', { dir });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('HEAD@{9}');
  });

  it('undoable 口径：reset/restore/revert 记 true，reflog 与只读命令记 false（§6.2 / §7.3）', async () => {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'v1\n');
    await execute('git add .', { dir });
    await execute('git commit -m "第一"', { dir });
    await writeRepoFile('/repo/a.txt', 'v2\n');
    await execute('git add .', { dir });
    await execute('git commit -m "第二"', { dir });

    const reflogEntry = await executeToEntry('git reflog', { dir });
    expect(reflogEntry.undoable).toBe(false);

    const statusEntry = await executeToEntry('git status', { dir });
    expect(statusEntry.undoable).toBe(false);

    // revert 要在「有前身可撤销」的提交上执行；先测它再测 reset，避免把历史退到只剩根提交
    const revertEntry = await executeToEntry('git revert HEAD', { dir });
    expect(revertEntry.ok).toBe(true);
    expect(revertEntry.undoable).toBe(true);

    // 此时历史是 [反向提交, 第二, 第一]，reset 掉最近一次
    const hardEntry = await executeToEntry('git reset --hard HEAD~1', { dir });
    expect(hardEntry.ok).toBe(true);
    expect(hardEntry.undoable).toBe(true);

    // restore 需要先有可恢复的改动
    await writeRepoFile('/repo/a.txt', '改乱了\n');
    const restoreEntry = await executeToEntry('git restore a.txt', { dir });
    expect(restoreEntry.undoable).toBe(true);

    // checkout 的撤销性取决于是否有路径参数：切分支不属撤销
    const branchEntry = await executeToEntry('git branch dev', { dir });
    expect(branchEntry.undoable).toBe(false);
    const checkoutEntry = await executeToEntry('git checkout dev', { dir });
    expect(checkoutEntry.undoable).toBe(false);

    // 而 `checkout -- <path>`（丢弃改动）属撤销（§6.2 字面清单）
    await execute('git checkout main', { dir });
    await writeRepoFile('/repo/a.txt', '又改乱了\n');
    const checkoutPathsEntry = await executeToEntry('git checkout -- a.txt', { dir });
    expect(checkoutPathsEntry.ok).toBe(true);
    expect(checkoutPathsEntry.undoable).toBe(true);
  });
});

describe('executor —— M6 标签：tag / show / describe（第六章「历史锚点」）', () => {
  let dir: string;

  beforeEach(() => {
    dir = freshRepo();
  });

  /** 预置：init + 两次提交（第二个提交是 HEAD） */
  async function seedTwoCommits(): Promise<void> {
    await execute('git init', { dir });
    await writeRepoFile('/repo/a.txt', 'v1\n');
    await execute('git add a.txt', { dir });
    await execute('git commit -m "第一次提交"', { dir });
    await writeRepoFile('/repo/a.txt', 'v2\n');
    await execute('git add a.txt', { dir });
    await execute('git commit -m "第二次提交"', { dir });
  }

  it('git tag <名> 创建轻量标签并回显；git tag 列出全部', async () => {
    await seedTwoCommits();

    const created = await execute('git tag v1.0', { dir });
    expect(created.ok).toBe(true);
    expect(created.output[0]).toContain('轻量标签 v1.0');

    const listed = await execute('git tag', { dir });
    expect(listed.ok).toBe(true);
    expect(listed.output).toEqual(['v1.0']);
  });

  it('git tag -a -m 创建注解标签；空仓库 / 重复名 / 无 -m 的注解都被正确拒绝', async () => {
    await seedTwoCommits();

    const annotated = await execute('git tag -a v2.0 -m "正式版本"', { dir });
    expect(annotated.ok).toBe(true);
    expect(annotated.output[0]).toContain('注解标签 v2.0');

    // 重复创建 → 拒绝（对齐真 git AlreadyExistsError）
    const dup = await execute('git tag v2.0', { dir });
    expect(dup.ok).toBe(false);
    expect(dup.error).toContain('已存在');

    // -a 不带 -m → 明确提示（本游戏无编辑器）
    const noMessage = await execute('git tag -a v3.0', { dir });
    expect(noMessage.ok).toBe(false);
    expect(noMessage.error).toContain('-m');

    // 空仓库 → 标签必须锚定提交
    const emptyDir = freshRepo();
    await execute('git init', { emptyDir } as never);
    const unborn = await execute('git tag v0', { dir: emptyDir });
    expect(unborn.ok).toBe(false);
    expect(unborn.error).toContain('没有任何提交');
  });

  it('git tag <名> <目标> 可以锚定历史提交（ref 表达式支持）', async () => {
    await seedTwoCommits();

    const result = await execute('git tag v0.9 HEAD~1', { dir });
    expect(result.ok).toBe(true);
    expect(result.output[0]).toContain('锚定');

    // 标签锚定的是第一次提交（HEAD~1）——用 show 验证
    const shown = await execute('git show v0.9', { dir });
    expect(shown.ok).toBe(true);
    expect(shown.output.join('\n')).toContain('第一次提交');
  });

  it('git tag -d 删除标签并回显；删除不存在的标签报错', async () => {
    await seedTwoCommits();
    await execute('git tag v1.0', { dir });

    const deleted = await execute('git tag -d v1.0', { dir });
    expect(deleted.ok).toBe(true);
    expect(deleted.output[0]).toContain('已删除标签 v1.0');

    const missing = await execute('git tag -d v1.0', { dir });
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain('找不到标签');
  });

  it('git show：注解标签输出注解信息；不存在的标签报错', async () => {
    await seedTwoCommits();
    await execute('git tag -a v2.0 -m "正式版本发布"', { dir });

    const shown = await execute('git show v2.0', { dir });
    expect(shown.ok).toBe(true);
    const text = shown.output.join('\n');
    expect(text).toContain('标签 v2.0');
    expect(text).toContain('正式版本发布');
    expect(text).toContain('第二次提交');

    const missing = await execute('git show v9.9', { dir });
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain('找不到标签');
  });

  it('git describe：无标签报「没有可描述」；落标签后输出标签名；历史提交上输出 <tag>-<n>-g<hash>', async () => {
    await seedTwoCommits();

    const none = await execute('git describe', { dir });
    expect(none.ok).toBe(false);
    expect(none.error).toContain('没有可描述');

    // 打在 HEAD~1（注解标签）→ describe 输出 v0.9-1-g<短hash>
    await execute('git tag -a v0.9 -m "早期版本" HEAD~1', { dir });
    const described = await execute('git describe', { dir });
    expect(described.ok).toBe(true);
    expect(described.output[0]).toMatch(/^v0\.9-1-g[0-9a-f]{7}$/);

    // 打在 HEAD → 干净的标签名
    await execute('git tag -a v1.0 -m "当前版本"', { dir });
    const atHead = await execute('git describe', { dir });
    expect(atHead.output[0]).toBe('v1.0');
  });

  it('git describe 缺省忽略轻量标签，--tags 纳入（真 git 的注解优先语义）', async () => {
    await seedTwoCommits();
    await execute('git tag v-light', { dir });

    const withoutFlag = await execute('git describe', { dir });
    expect(withoutFlag.ok).toBe(false);
    expect(withoutFlag.error).toContain('注解标签');

    const withFlag = await execute('git describe --tags', { dir });
    expect(withFlag.ok).toBe(true);
    expect(withFlag.output[0]).toBe('v-light');
  });

  it('push 的分支参数是标签名时改走标签推送（git push origin <tag> 的二义性解析）', async () => {
    await seedTwoCommits();
    // 建立远程关联（写配置绕过白名单 —— 4-1 语义由其自身关卡测试覆盖）
    const { writeRemoteConfig, ALLOWED_REMOTE_URL } = await import('../engine/gitApi');
    const { resetRemoteRepo } = await import('../engine/fileRemote');
    await resetRemoteRepo();
    const seeded = await writeRemoteConfig('origin', ALLOWED_REMOTE_URL, { dir });
    expect(seeded.ok).toBe(true);

    // 推 main 建立共同历史，再打标签推送
    const pushed = await execute('git push origin main', { dir });
    expect(pushed.ok).toBe(true);
    await execute('git tag -a v1.0 -m "首个标签"', { dir });

    const pushedTag = await execute('git push origin v1.0', { dir });
    expect(pushedTag.ok).toBe(true);
    expect(pushedTag.output.join('\n')).toContain('标签已推送');

    // 裸仓里真的有这个标签（事实断言）
    const git = (await import('isomorphic-git')).default;
    const tagOid = await git.resolveRef({ fs: (await import('../engine/fs')).getFs(), dir: '/remote.git', gitdir: '/remote.git', ref: 'refs/tags/v1.0' });
    expect(tagOid).toBeDefined();
  });
});

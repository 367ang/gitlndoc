import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execFileP = promisify(execFile);

// --- Sandbox lifecycle -------------------------------------------------------
// Each learner session gets an isolated temp dir pre-populated with the level's
// starting file set. All git commands execute inside it.

export async function createSandbox(seedFiles) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitlndoc-sandbox-'));
  await execFileP('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  // Seed files are written (not committed) so the learner performs the commits.
  for (const [rel, content] of Object.entries(seedFiles)) {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
  }
  return dir;
}

export async function destroySandbox(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

// --- Git command execution ----------------------------------------------------
// Runs an arbitrary argv in the sandbox. Blocks disallowed commands (those that
// could escape the sandbox or bypass the intended learning flow).

const DISALLOWED = new Set([
  'git', // must always be followed by a subcommand; we validate below
  'add', // without -A / . / paths we allow; but block reset/rm edge cases elsewhere
]);

const BLOCKED_SUBCOMMANDS = new Set([
  'clone', 'remote', 'fetch', 'push', 'pull', 'submodule', 'filter-repo',
  'update-index', 'read-tree', 'write-tree', 'hash-object', 'mktree',
  'cat-file', 'rev-parse', 'symbolic-ref', 'show-ref', 'update-ref',
  'config', 'alias', 'notes', 'lfs', 'apply', 'format-patch', 'am',
  'gc', 'fsck', 'repack', 'archive', 'bundle', 'worktree', 'sparse-checkout',
  'shell', 'upload-pack', 'receive-pack', 'maintenance',
]);

export async function runCommand(dir, argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    return { ok: false, code: 2, stdout: '', stderr: '请输入要执行的命令。' };
  }
  const [bin, ...rest] = argv;
  if (bin !== 'git') {
    return { ok: false, code: 2, stdout: '', stderr: `目前仅支持 git 命令（收到：${bin}）。` };
  }
  const sub = rest[0];
  if (BLOCKED_SUBCOMMANDS.has(sub)) {
    return { ok: false, code: 2, stdout: '', stderr: `命令 git ${sub} 在当前练习中被禁用。` };
  }
  // Enforce required Git identity for commits.
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: '练习者',
    GIT_AUTHOR_EMAIL: 'learner@gitlndoc.local',
    GIT_COMMITTER_NAME: '练习者',
    GIT_COMMITTER_EMAIL: 'learner@gitlndoc.local',
  };
  try {
    const { stdout, stderr } = await execFileP('git', rest, { cwd: dir, env, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true, code: 0, stdout, stderr };
  } catch (err) {
    return {
      ok: false,
      code: err.code ?? 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message ?? '命令执行失败。',
    };
  }
}

// --- State introspection ------------------------------------------------------
export async function getGitState(dir) {
  // Returns a snapshot used to evaluate whether the level target is met.
  let log = '';
  let status = '';
  let branch = '';
  try {
    const r1 = await execFileP('git', ['log', '--pretty=format:%h|%an|%s', '--reverse'], { cwd: dir });
    log = r1.stdout;
  } catch { /* empty repo */ }
  try {
    const r2 = await execFileP('git', ['status', '--porcelain'], { cwd: dir });
    status = r2.stdout;
  } catch {}
  try {
    const r3 = await execFileP('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir });
    branch = r3.stdout.trim();
  } catch {}
  return { log, status, branch };
}

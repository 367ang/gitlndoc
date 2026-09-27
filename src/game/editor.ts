/**
 * 工作区文件编辑（development-refinement.md §9.1 FileTree 的 M4 增补；M3 遗留 1）。
 *
 * Game Service 薄层（§2）：写文件是副作用，但「关卡内编辑工作区文件」是核心玩法
 * （2-2 改日记 / 2-4 建 .gitignore / 3-4 解决冲突），且必须与 `sandbox.reset()` 的
 * 路径约定一致 —— 故封装在此而不是 UI 组件里。
 *
 * 路径安全规则：
 *   - 只接受仓库相对路径（`docs/x.md`），自动挂到 `/repo` 下；
 *   - 拒绝绝对路径与 `..` 上跳（防越出沙箱）；
 *   - 拒绝 `.git` 内部（玩家不该手改对象库）。
 *
 * ⚠️ 保存必须由**事件回调**触发（StrictMode 双跑教训 —— effect 里写文件会把
 * 玩家内容反复覆写），本模块不做任何时机控制。
 */

import { fsp, REPO_DIR } from '../engine/fs';

/** 校验仓库相对路径；非法时给出中文原因 */
function validateRepoPath(path: string): string | null {
  if (path.length === 0) return '路径为空。';
  if (path.startsWith('/') || path.startsWith('\\')) return '必须是仓库内相对路径。';
  if (path.includes('..')) return '路径不能包含 ..（不允许越出仓库）。';
  if (/(^|\/)\.git(\/|$)/.test(path)) return '不能编辑 .git 内部文件。';
  if (path.endsWith('/')) return '路径必须指向文件而非目录。';
  return null;
}

/** 编辑结果的返回值（与 gitApi 的 GitResult 形状一致，便于 UI 统一处理） */
export type EditResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

/**
 * 把内容写入工作区文件（父目录自动创建，与 `sandbox.writeFiles` 同策略）。
 *
 * @param path    仓库相对路径（如 `notes/diary.md`）
 * @param content 文件新内容
 */
export async function writeWorkdirFile(path: string, content: string): Promise<EditResult> {
  const invalid = validateRepoPath(path);
  if (invalid) return { ok: false, error: invalid };

  const absolute = `${REPO_DIR}/${path}`;
  try {
    // 逐级创建父目录（LightningFS 的 writeFile 不会自动建父目录，实测结论）
    const segments = absolute.split('/').slice(1, -1);
    let current = '';
    for (const segment of segments) {
      current += `/${segment}`;
      try {
        await fsp.stat(current);
      } catch {
        await fsp.mkdir(current, { mode: 0o777 });
      }
    }
    await fsp.writeFile(absolute, content, 'utf8');
    return { ok: true, path };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 读取工作区文件内容（编辑器打开时用）；不存在返回 null */
export async function readWorkdirFile(path: string): Promise<string | null> {
  const invalid = validateRepoPath(path);
  if (invalid) return null;
  try {
    const content = await fsp.readFile(`${REPO_DIR}/${path}`, 'utf8');
    return typeof content === 'string' ? content : null;
  } catch {
    return null;
  }
}

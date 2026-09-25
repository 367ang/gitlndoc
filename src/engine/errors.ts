/**
 * Git 执行层的业务异常定义。
 *
 * 设计原则：isomorphic-git 的原始错误（`NotFoundError` / `MissingNameError` / …）
 * 不应泄漏到 game service 与 UI 层。所有底层错误统一经 `toGitCommandError()`
 * 归一为 `GitCommandError`，并携带一句面向学习者的中文提示。
 */

/** gitApi 方法的返回值，对应真实 git 的「退出码」语义 */
export type GitResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: GitCommandError | GitUnsupportedError };

/** git 抛错时给定的错误码（isomorphic-git 的 `err.code` 即取自该集合） */
export type GitErrorCode =
  | 'NotFoundError'
  | 'AlreadyExistsError'
  | 'InvalidFilepathError'
  | 'DirectorySeparatorError'
  | 'MissingNameError'
  | 'MissingParameterError'
  | 'AmbiguousError'
  | 'CheckoutConflictError'
  | 'CommitNotFetchedError'
  | 'EmptyServerResponseError'
  | 'FastForwardError'
  | 'GitPushError'
  | 'HttpError'
  | 'IndexResetError'
  | 'InternalError'
  | 'InvalidOidError'
  | 'InvalidRefNameError'
  | 'MaxDepthError'
  | 'MergeNotSupportedError'
  | 'MergeConflictError'
  | 'NoCommitError'
  | 'NoRefspecError'
  | 'ObjectTypeError'
  | 'ParseError'
  | 'PushRejectedError'
  | 'RemoteCapabilityError'
  | 'ResolveRefError'
  | 'SmartHttpError'
  | 'UnknownTransportError'
  | 'UnsafeFilepathError'
  | 'UrlParseError'
  | 'UserCanceledError'
  | 'UnmergedPathsError'
  | 'UnknownError';

/** 错误来源的根因分类，供上层决定 UI 呈现方式 */
export type GitErrorKind = 'not-found' | 'invalid-usage' | 'conflict' | 'internal' | 'unsupported';

/** 已知错误码 → 根因分类 */
const KIND_BY_CODE: Record<GitErrorCode, GitErrorKind> = {
  NotFoundError: 'not-found',
  AlreadyExistsError: 'conflict',
  InvalidFilepathError: 'invalid-usage',
  DirectorySeparatorError: 'invalid-usage',
  MissingNameError: 'invalid-usage',
  MissingParameterError: 'invalid-usage',
  AmbiguousError: 'invalid-usage',
  CheckoutConflictError: 'conflict',
  CommitNotFetchedError: 'not-found',
  EmptyServerResponseError: 'internal',
  FastForwardError: 'conflict',
  GitPushError: 'conflict',
  HttpError: 'internal',
  IndexResetError: 'internal',
  InternalError: 'internal',
  InvalidOidError: 'invalid-usage',
  InvalidRefNameError: 'invalid-usage',
  MaxDepthError: 'internal',
  MergeNotSupportedError: 'unsupported',
  MergeConflictError: 'conflict',
  NoCommitError: 'not-found',
  NoRefspecError: 'invalid-usage',
  ObjectTypeError: 'internal',
  ParseError: 'internal',
  PushRejectedError: 'conflict',
  RemoteCapabilityError: 'internal',
  ResolveRefError: 'not-found',
  SmartHttpError: 'internal',
  UnknownTransportError: 'internal',
  UnsafeFilepathError: 'invalid-usage',
  UrlParseError: 'invalid-usage',
  UserCanceledError: 'invalid-usage',
  UnmergedPathsError: 'conflict',
  UnknownError: 'internal',
};

/**
 * 已知错误码 → 面向学习者的中文提示。
 * 措辞刻意贴近真实 git 的输出风格，让玩家在游戏里建立正确的直觉。
 */
const MESSAGE_BY_CODE: Record<string, string> = {
  NotFoundError: '找不到指定的文件或提交。',
  AlreadyExistsError: '该名称已存在。',
  InvalidFilepathError: '文件路径无效。',
  DirectorySeparatorError: '文件路径中不能包含目录分隔符。',
  MissingNameError: '未提供提交者姓名与邮箱。',
  MissingParameterError: '命令缺少必要参数。',
  AmbiguousError: '该路径存在歧义，无法确定目标。',
  CheckoutConflictError: '存在未提交的修改，切换会覆盖它们。',
  CommitNotFetchedError: '该提交在本地不存在。',
  FastForwardError: '无法快进合并。',
  GitPushError: '推送到远程失败。',
  IndexResetError: '索引重置失败。',
  InternalError: 'Git 内部错误。',
  InvalidOidError: '对象 ID 无效。',
  InvalidRefNameError: '引用名称无效。',
  MergeNotSupportedError: '当前版本不支持该合并操作。',
  MergeConflictError: '合并产生冲突，需先解决冲突文件。',
  NoCommitError: '当前仓库还没有任何提交。',
  NoRefspecError: '未配置 refspec。',
  ObjectTypeError: '对象类型不符合预期。',
  PushRejectedError: '推送被远程拒绝。',
  ResolveRefError: '无法解析该引用。',
  UnsafeFilepathError: '该文件路径不受支持（可能包含反斜杠）。',
  UrlParseError: '远程地址格式无效。',
  UnmergedPathsError: '存在未合并的路径，无法继续。',
};

/**
 * 这些「未找到」的对象并非玩家写错了路径，而是仓库尚处初始状态，
 * 因此不应把 `data.what` 直接拼进提示语。
 */
const UNBORN_REFS = new Set(['HEAD', 'refs/heads/main']);

const HINT_BY_CODE: Record<string, string> = {
  MissingNameError: '本游戏会固定使用学习者身份，若看到此提示说明 gitApi 调用有误。',
  InvalidFilepathError: '请检查路径是否写错，或该文件是否已被删除。',
  AlreadyExistsError: '换一个名称再试。',
  NotImplementedError: '该命令尚未在当前版本中实现，属预期行为。',
};

/**
 * 所有 Git 执行层异常的基类。
 * 用 `instanceof GitCommandError` 即可捕获全部业务异常（含 `GitUnsupportedError`）。
 */
export class GitCommandError extends Error {
  readonly code: GitErrorCode;
  readonly kind: GitErrorKind;
  /** 原始 stderr（此处为底层错误信息），便于日志与调试 */
  readonly stderr: string;
  /** 触发该错误的命令，形如 `git add a.txt` */
  readonly command?: string;
  /** 可选的额外操作建议 */
  readonly hint?: string;

  constructor(
    code: GitErrorCode,
    message: string,
    stderr: string,
    options: { command?: string; hint?: string; kind?: GitErrorKind } = {},
  ) {
    super(message);
    this.name = 'GitCommandError';
    this.code = code;
    this.kind = options.kind ?? KIND_BY_CODE[code] ?? 'internal';
    this.stderr = stderr;
    this.command = options.command;
    this.hint = options.hint;
  }

  /** 组合出可直接回显到终端面板的完整文本 */
  toString(): string {
    const head = this.command ? `${this.command}: ${this.message}` : this.message;
    return this.hint ? `${head}\n提示：${this.hint}` : head;
  }
}

/**
 * 「该版本不支持」—— 对应 development-refinement.md §14 的风险对策：
 * 语法层白名单之外的命令，明确告知玩家，而不是伪造执行结果。
 */
export class GitUnsupportedError extends GitCommandError {
  /** 玩家输入的原始命令（或子命令），用于回显 */
  readonly attempted: string;

  constructor(attempted: string, message?: string) {
    const text = message ?? `git ${attempted} 在当前版本中尚不支持。`;
    super('NotImplementedError' as GitErrorCode, text, text, {
      command: `git ${attempted}`,
      hint: HINT_BY_CODE.NotImplementedError,
      kind: 'unsupported',
    });
    this.name = 'GitUnsupportedError';
    this.attempted = attempted;
  }
}

/** 判断任意值是否带有 isomorphic-git 风格的错误码 */
function isGitErrorLike(error: unknown): error is { code: string; message?: string; data?: { what?: string } } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  );
}

/** 从底层错误中提取出可读的原始信息 */
function rawMessageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  return '未知错误';
}

/**
 * 把 isomorphic-git（或任意底层）抛出的错误归一为 `GitCommandError`。
 *
 * @param error   底层抛出的任意值
 * @param command 触发该错误的命令，形如 `git commit`
 */
export function toGitCommandError(error: unknown, command?: string): GitCommandError {
  // 已是业务异常则直接透传，避免二次包装丢失原始 code
  if (error instanceof GitCommandError) return error;

  const code = (isGitErrorLike(error) ? error.code : 'UnknownError') as GitErrorCode;
  const stderr = rawMessageOf(error);
  const base = MESSAGE_BY_CODE[code] ?? stderr;

  // 少数「未找到」场景下，git 的讯息本身已足够清楚（例如 `Could not find a.txt.`），
  // 此时保留原文，而非替换为泛化的中文提示。
  const what = isGitErrorLike(error) ? error.data?.what : undefined;
  const message = code === 'NotFoundError' && what && !UNBORN_REFS.has(what)
    ? `找不到 ${what}。`
    : base;

  return new GitCommandError(code, message, stderr, {
    command,
    hint: HINT_BY_CODE[code],
  });
}

/**
 * 把 promise 的 rejection 归一为 `GitResult`。
 * gitApi 的每个方法都经由此包装，从而对外只暴露「值 / 业务异常」两种结局，
 * 不再有未捕获的 rejection —— 与 `gitrunner.mjs::runCommand` 的
 * `{ ok, code, stdout, stderr }` 契约保持一致。
 */
export async function runGit<T>(
  command: string,
  action: () => Promise<T>,
): Promise<GitResult<T>> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return { ok: false, error: toGitCommandError(error, command) };
  }
}

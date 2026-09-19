import { execFileSync } from 'child_process';

/**
 * 子进程调用的「报错不回显命令参数」封装。
 *
 * 背景：Node 的 execSync/execFileSync 失败时，错误对象的 message 是 `Command failed: <完整命令行>`，
 * 且带 `cmd` / `spawnargs` / `stderr` 等字段。命令行里若有请求体、认证头、`-u user:pass`、URL 里的
 * 凭据参数，调用方一句 `console.error(err.message)` 或把报错原文落盘，就把它们带了出去。
 *
 * 做法：失败时**不复用**原始 error——抛一个全新的 Error，只含排错需要的东西（退出码/信号/errno、
 * 目标主机名、子进程 stderr），且 stderr 先过 `scrub`（按字面值 + 常见凭据形态双重清洗）。
 */

const MASK = '[REDACTED]';

/** 值整体敏感的 curl 选项（下一个 argv 元素或 `--opt=value` 的 value 整体打码）。 */
const VALUE_IS_SECRET = new Set([
  '-d', '--data', '--data-raw', '--data-binary', '--data-urlencode', '--data-ascii', '--json',
  '-u', '--user', '-U', '--proxy-user', '--oauth2-bearer',
  '-x', '--proxy', '--preproxy', // 代理 URL 常带 user:pass@，且可能无 scheme
  '-F', '--form', '--form-string', '-b', '--cookie', '--pass', '--key',
]);
const HEADER_OPTS = new Set(['-H', '--header', '--proxy-header']);
/** 头值白名单：只有这些无害头保留原值，其余一律整值打码（黑名单永远列不全）。 */
const SAFE_HEADER_RE = /^(content-type|content-length|content-encoding|accept|accept-encoding|accept-language|user-agent|cache-control|connection|host|origin)$/i;
/** 参数/字段名像凭据 ⇒ 值打码。`secret` 单独判：`secretPath` / `expandSecretReferences` 这类是路径与开关，不是凭据。 */
const SECRET_NAME_RE = /(pass(?:word|wd)?|pwd|token|api[-_]?key|access[-_]?key|private[-_]?key|signature|credential|session|(?:^|[-_])(?:sig|auth|code|key)$)/i;
const SECRET_WORD_RE = /secret/i;
const NOT_A_SECRET_RE = /(path|references?|names?|ids?|version|type|mode|enabled|expand)/i;
function isSecretName(name: string): boolean {
  if (SECRET_NAME_RE.test(name)) return true;
  return SECRET_WORD_RE.test(name) && !NOT_A_SECRET_RE.test(name);
}

function redactUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw); } catch { return raw; }
  if (!/^https?:$/.test(u.protocol)) return raw;
  if (u.username || u.password) { u.username = MASK; u.password = ''; }
  for (const key of [...u.searchParams.keys()]) {
    if (isSecretName(key)) u.searchParams.set(key, MASK);
  }
  return u.toString().replace(/%5BREDACTED%5D/g, MASK);
}

function redactHeader(h: string): string {
  const i = h.indexOf(':');
  if (i <= 0) return h;
  const name = h.slice(0, i).trim();
  return SAFE_HEADER_RE.test(name) ? h : `${name}: ${MASK}`;
}

/** 返回脱敏后的 argv 副本（仅用于展示/排错；绝不改传给子进程的真参数）。 */
export function redactArgv(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    // --opt=value
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    if (eq > 0) {
      const opt = a.slice(0, eq);
      if (VALUE_IS_SECRET.has(opt)) { out.push(`${opt}=${MASK}`); continue; }
      if (HEADER_OPTS.has(opt)) { out.push(`${opt}=${redactHeader(a.slice(eq + 1))}`); continue; }
    }
    // 选项与值分开
    if (VALUE_IS_SECRET.has(a)) { out.push(a); if (i + 1 < args.length) { out.push(MASK); i++; } continue; }
    if (HEADER_OPTS.has(a)) { out.push(a); if (i + 1 < args.length) { out.push(redactHeader(args[i + 1])); i++; } continue; }
    // 短选项粘连写法：-Hfoo / -dbody / -uuser:pass
    if (/^-[A-Za-z]./.test(a) && !a.startsWith('--')) {
      const opt = a.slice(0, 2);
      if (VALUE_IS_SECRET.has(opt)) { out.push(`${opt}${MASK}`); continue; }
      if (HEADER_OPTS.has(opt)) { out.push(`${opt}${redactHeader(a.slice(2))}`); continue; }
    }
    if (/^https?:\/\//i.test(a)) { out.push(redactUrl(a)); continue; }
    // 无 scheme 的 `user:pass@host…`（curl 接受）
    out.push(a.replace(/^[^\s/@:]+:[^\s/@]+@/, `${MASK}@`));
  }
  return out;
}

/** 从 argv 里收集「字面值就是秘密」的串，供 scrub 在任意文本里逐字清除。 */
function secretLiterals(args: readonly string[]): string[] {
  const red = redactArgv(args);
  const lits: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (!red[i].includes(MASK)) continue; // 按「是否真的打了码」判，不按字符串是否相等（URL 规范化也会让它不等）
    const a = args[i];
    // 子进程 stderr 可能只回显参数的一段，所以除整串外还要收内部片段——但**只收名字像凭据的值**：
    // 把 URL 里所有 k=v 都当秘密，会让 `prod` / `true` 这类普通词把报错原文洗得没法读。
    if (/^https?:\/\//i.test(a)) {
      try {
        const u = new URL(a);
        if (u.password) lits.push(u.password, decodeURIComponent(u.password));
        if (u.username && u.password) lits.push(`${u.username}:${u.password}`);
        for (const [k, v] of u.searchParams) if (isSecretName(k)) lits.push(v);
      } catch { /* 非法 URL：redactUrl 也不会动它，走不到这里 */ }
      continue;
    }
    lits.push(a); // 非 URL 的敏感参数（请求体 / -u / 认证头 / 代理）：整串即秘密
    for (const m of a.matchAll(/"([^"]*)"\s*:\s*"([^"]+)"/g)) if (isSecretName(m[1])) lits.push(m[2]); // JSON 字段
    for (const m of a.matchAll(/(?:^|&)([^=&\s]+)=([^&\s]+)/g)) {                                       // form k=v
      if (isSecretName(m[1])) { lits.push(m[2]); try { lits.push(decodeURIComponent(m[2])); } catch { /* 裸 % */ } }
    }
    const header = /^[A-Za-z0-9-]+:\s*(.+)$/.exec(a);
    if (header) {                                                                                         // Header: value
      lits.push(header[1].trim());
      const scheme = /^(?:Bearer|Basic|Token)\s+(\S+)/i.exec(header[1].trim());
      if (scheme) lits.push(scheme[1]);
    } else {
      const up = /^[^\s/@:]*:([^\s@]+)(?:@|$)/.exec(a);                                                  // user:pass[@host]
      if (up) lits.push(up[1]);
    }
  }
  // 长的先替换，避免短片段把长串切碎后漏网；太短的不收（误伤普通文本）
  return [...new Set(lits.filter((s) => s && s.length >= 4))].sort((x, y) => y.length - x.length);
}

/** 清洗任意文本：先按字面值，再按常见凭据形态（认证头、Bearer/Basic、URL 凭据、k=v、JSON 字段）。 */
export function scrub(text: string, literals: readonly string[] = []): string {
  let out = String(text ?? '');
  for (const lit of [...literals].filter((s) => s && s.length >= 4).sort((a, b) => b.length - a.length)) {
    out = out.split(lit).join(MASK);
    const enc = encodeURIComponent(lit);
    if (enc !== lit) out = out.split(enc).join(MASK);
  }
  return out
    .replace(/((?:proxy-)?authorization\s*[:=]\s*)(?:(?:bearer|basic|token)\s+)?[^\s"'\\]+/gi, `$1${MASK}`)
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${MASK}`)
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:]+:[^\s/]*@/gi, `$1${MASK}@`) // 贪婪到最后一个 @：密码本身可含 @
    .replace(/([?&\s"'](?:[\w-]*(?:pass(?:word|wd)?|pwd|secret|token|api[-_]?key|access[-_]?key|signature|credential)[\w-]*)=)[^&\s"']+/gi, `$1${MASK}`)
    .replace(/("(?:[\w-]*(?:pass(?:word|wd)?|pwd|secret|token|api[-_]?key|access[-_]?key|credential)[\w-]*)"\s*:\s*")[^"]*(")/gi, `$1${MASK}$2`)
    .replace(/\b((?:cookie|set-cookie|x-[a-z0-9-]*(?:key|token|secret|auth|session)[a-z0-9-]*|[a-z0-9-]*api-?key)\s*:\s*)[^\r\n"']+/gi, `$1${MASK}`)
    .replace(/((?:["']?)[\w-]*(?:pass(?:word|wd)?|pwd|secret|token|api[-_]?key|access[-_]?key|credential)[\w-]*(?:["']?)\s*:\s*)(?:'[^']*'|[^\s,}"']+)/gi,
      (m, head: string) => (/secret(?:path|references?)/i.test(head) ? m : `${head}${MASK}`))
    .replace(/(\bsshpass\s+-p\s*)("[^"]*"|'[^']*'|\S+)/g, `$1${MASK}`);
}

/** 值是 URL 但不是请求目标的选项（代理 / referer）。 */
const URL_VALUED_OPTS = new Set(['-x', '--proxy', '--preproxy', '-e', '--referer']);
function hostOf(args: readonly string[]): string {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!/^https?:\/\//i.test(a) || (i > 0 && URL_VALUED_OPTS.has(args[i - 1]))) continue;
    try { return new URL(a).host; } catch { /* 不是合法 URL：继续找 */ }
  }
  return 'unknown';
}

/** 会让 curl 把请求头/响应头/响应体细节写进输出的选项：响应头里的凭据（Set-Cookie 等）没法按字面值清洗，直接不许用。 */
const VERBOSE_OPT_RE = /^(-v|--verbose|--trace|--trace-ascii|--trace-config|-i|--include|-D|--dump-header)(=|$)/;

/**
 * 把 child_process 抛的 error 换成一个干净的新 Error。
 * 只取 status/signal/code 与（清洗后的）stderr；**不复制** message/cmd/spawnargs/stdout/output。
 */
export function sanitizeExecError(label: string, raw: unknown, literals: readonly string[] = [], context = ''): Error {
  const e = (raw ?? {}) as { status?: number | null; signal?: string | null; code?: string | number; stderr?: unknown };
  const parts: string[] = [];
  if (typeof e.status === 'number') parts.push(`exit=${e.status}`);
  if (e.signal) parts.push(`signal=${e.signal}`);
  if (typeof e.code === 'string') parts.push(`code=${e.code}`); // ENOENT / ETIMEDOUT / ENOBUFS…
  if (context) parts.push(context);
  const stderr = scrub(e.stderr == null ? '' : String(e.stderr), literals).trim().slice(0, 2000);
  return new Error(`${label} failed (${parts.join(' ') || 'unknown error'})${stderr ? `: ${stderr}` : ''}`);
}

export interface RunCurlOptions {
  /** 仅测试用：替换可执行文件。 */
  bin?: string;
  /** 毫秒；不传 = 不限（保持原行为）。 */
  timeoutMs?: number;
}

/**
 * 同步跑 curl，返回 stdout。参数数组直传（不经 shell）。
 * 失败时抛的 Error 不含 argv：只有退出码/信号/errno、目标主机名、清洗过的 curl stderr。
 * `-sS`：静默进度条但保留 curl 自己的错误行（`curl: (7) Failed to connect…`），否则失败时两眼一抹黑。
 */
export function runCurl(args: readonly string[], opts: RunCurlOptions = {}): string {
  const verbose = args.find((a) => VERBOSE_OPT_RE.test(a));
  if (verbose) throw new Error(`runCurl: option ${verbose.split('=')[0]} is not allowed (it writes header/body details to the output)`);
  try {
    return execFileSync(opts.bin ?? 'curl', ['-sS', ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'], // stderr 收进 error 对象（由我们清洗后再露出），不直通父进程
      maxBuffer: 64 * 1024 * 1024,
      ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
    });
  } catch (raw) {
    throw sanitizeExecError('curl', raw, secretLiterals(args), `host=${hostOf(args)}`);
  }
}

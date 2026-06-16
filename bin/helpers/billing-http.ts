import { execSync, execFileSync } from 'child_process';
import { fetchInfisicalSecret } from './infisical-secrets';
import { getInfisicalConfig, getInfisicalToken, getCnInfisicalToken, getCnSecrets, resolveUserId } from './db-utils';

const USER_AUTH_URLS: Record<string, string> = {
  stage: 'https://auth.stage.optima.onl',
  prod: 'https://auth.optima.onl',
  // #201: yzsgo.com 全量迁移 (2026-06-12), 旧 auth-cn.optima.chat 路由已下线
  'cn-prod': 'https://auth.yzsgo.com',
  // cn-stage（阿里云预发，独立于 AWS stage `.optima.onl`）
  'cn-stage': 'https://auth.stage.optima.chat',
};

// cn URLs are hardcoded: cn Infisical (secrets-cn.optima.chat) is a
// separate instance dev-skills has no machine identity for, and these domains
// are stable. AWS envs keep reading /shared-secrets/domain-urls.
// #201: yzsgo.com 全量迁移 (2026-06-12), 旧 billing-cn.optima.chat 路由已下线
const CN_PROD_BILLING_URL = 'https://billing-api.yzsgo.com';
const CN_STAGE_BILLING_URL = 'https://billing-api.stage.optima.chat';

/**
 * Validate the --env flag value at command entry, before any I/O.
 *
 * Without this, a typo like `--env staging` flows downstream and surfaces as
 * a confusing error: entitlement subcommands hit resolveUserId first (SSH
 * tunnel to RDS_HOSTS[undefined] → cryptic ssh failure), product subcommands
 * reach getServiceToken (USER_AUTH_URLS[undefined] → "Unknown env"). All
 * fail-closed (no wrong-env write), but the UX diverges per subcommand.
 * Every runX handler calls this first so the error is uniform and immediate.
 */
export function validateEnv(env: string): 'stage' | 'prod' {
  if (env !== 'stage' && env !== 'prod') {
    throw new Error(`--env must be "stage" or "prod" (got: ${env})`);
  }
  return env;
}

/**
 * Variant for commands that also support cn-prod — currently grant-balance /
 * grant-subscription, which reach billing + user-auth over HTTPS only.
 * Other commands resolve users via the AWS RDS SSH tunnel, which does not
 * exist for cn-prod (Aliyun VPC-internal RDS) — keep them on validateEnv so a
 * cn-prod typo fails fast instead of dying inside the tunnel setup.
 */
export function validateEnvCnProd(env: string): 'stage' | 'prod' | 'cn-prod' | 'cn-stage' {
  if (env !== 'stage' && env !== 'prod' && env !== 'cn-prod' && env !== 'cn-stage') {
    throw new Error(`--env must be "stage", "prod", "cn-prod" or "cn-stage" (got: ${env})`);
  }
  return env;
}

// T1 discovered: client_id differs per env (stage=dev-skills-ubd3qz6n,
// prod=dev-skills-hinxa0rs). Both stored in Infisical alongside the
// secret at /shared-secrets/oauth-clients/.
const DEV_SKILLS_OAUTH_PATH = '/shared-secrets/oauth-clients';
const DEV_SKILLS_CLIENT_ID_KEY = 'DEV_SKILLS_OAUTH_CLIENT_ID';
const DEV_SKILLS_CLIENT_SECRET_KEY = 'DEV_SKILLS_OAUTH_CLIENT_SECRET';

// cn-prod: the client (dev-skills-ecee51qo) lives in cn user-auth, but its
// credentials are mirrored into AWS Infisical (prod environment, same path)
// under CN_PROD-prefixed keys so we reuse the existing Infisical access —
// zero new credential chain. Canonical copy lives in cn Infisical
// /shared-secrets/oauth-clients (DEV_SKILLS_OAUTH_CLIENT_ID/SECRET).
const DEV_SKILLS_CN_CLIENT_ID_KEY = 'DEV_SKILLS_CN_PROD_OAUTH_CLIENT_ID';
const DEV_SKILLS_CN_CLIENT_SECRET_KEY = 'DEV_SKILLS_CN_PROD_OAUTH_CLIENT_SECRET';

// cn-prod tokens must carry this scope: resolveUserIdByEmail calls cn
// user-auth POST /api/v1/internal/users/lookup, whose guard
// (verify_internal_service_token) requires it. user-auth issues
// request∩allowed_scopes and an unscoped request yields scope="" (verified
// against cn-prod 2026-06-12), so the request must name it explicitly.
const CN_PROD_TOKEN_SCOPE = 'internal:users:write';

// ───── Cache (process-lifetime) ─────────────────────────────────────────────
// One CLI invocation does at most a handful of HTTP calls. We mint the M2M
// token once and reuse it. Cross-invocation re-mint is fine — JWT TTL is
// typically ≥1h, far longer than any single CLI run.
//
// NOT handled (acceptable for admin CLI):
//   * Token expiry mid-invocation — a long-stalled revoke (list call + 5min
//     pause + refund call) could in theory expire. Operator can retry.
//   * Infisical 5xx retry — getInfisicalToken is sync execSync curl with no
//     retry; any transient failure surfaces immediately. Re-run the CLI.
const tokenCache: Record<string, string> = {};
const billingUrlCache: Record<string, string> = {};
const skillsUrlCache: Record<string, string> = {};

function getBillingUrl(env: string): string {
  if (env === 'cn-prod') return CN_PROD_BILLING_URL;
  if (env === 'cn-stage') return CN_STAGE_BILLING_URL;
  if (billingUrlCache[env]) return billingUrlCache[env];
  const url = fetchInfisicalSecret(env, '/shared-secrets/domain-urls', 'BILLING_URL');
  billingUrlCache[env] = url;
  return url;
}

function getSkillsUrl(env: string): string {
  if (skillsUrlCache[env]) return skillsUrlCache[env];
  const url = fetchInfisicalSecret(env, '/shared-secrets/domain-urls', 'SKILLS_REGISTRY_URL');
  skillsUrlCache[env] = url;
  return url;
}

export function getServiceToken(env: string): string {
  if (tokenCache[env]) return tokenCache[env];

  // cn-prod 与 cn-stage 都用 client_credentials M2M token，scope=internal:users:write。
  // 凭证来源不同：
  //  · cn-prod —— 镜像在 AWS Infisical prod 环境（CN_PROD_ 前缀键），复用既有 AWS 访问。
  //  · cn-stage —— canonical 在 cn Infisical staging /shared-secrets/oauth-clients
  //    （dev-skills 无该 client 的 AWS 镜像；用 admin email/password 直读，
  //     运行时需 INFISICAL_CN_EMAIL/PASSWORD，与 query-db cn 同一前提）。
  const isCn = env === 'cn-prod' || env === 'cn-stage';
  let clientId: string;
  let clientSecret: string;
  if (env === 'cn-stage') {
    const cnTok = getCnInfisicalToken();
    const oc = getCnSecrets(cnTok, '/shared-secrets/oauth-clients', false, 'staging');
    clientId = oc['DEV_SKILLS_OAUTH_CLIENT_ID'];
    clientSecret = oc['DEV_SKILLS_OAUTH_CLIENT_SECRET'];
    if (!clientId || !clientSecret) {
      throw new Error('cn-stage dev-skills OAuth client 凭证缺失（cn Infisical staging /shared-secrets/oauth-clients 的 DEV_SKILLS_OAUTH_CLIENT_ID/SECRET）。');
    }
  } else {
    const cfg = getInfisicalConfig();
    const tok = getInfisicalToken(cfg);
    // Fetch BOTH client_id and client_secret from Infisical — they differ per env.
    const infisicalEnv = env === 'cn-prod' ? 'prod' : env;
    const idKey = env === 'cn-prod' ? DEV_SKILLS_CN_CLIENT_ID_KEY : DEV_SKILLS_CLIENT_ID_KEY;
    const secretKey = env === 'cn-prod' ? DEV_SKILLS_CN_CLIENT_SECRET_KEY : DEV_SKILLS_CLIENT_SECRET_KEY;
    clientId = fetchInfisicalSecret(infisicalEnv, DEV_SKILLS_OAUTH_PATH, idKey, cfg, tok);
    clientSecret = fetchInfisicalSecret(infisicalEnv, DEV_SKILLS_OAUTH_PATH, secretKey, cfg, tok);
  }

  const authUrl = USER_AUTH_URLS[env];
  if (!authUrl) throw new Error(`Unknown env: ${env}`);

  const scopeParam = isCn ? `&scope=${encodeURIComponent(CN_PROD_TOKEN_SCOPE)}` : '';
  const body = `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}${scopeParam}`;
  // execFileSync (no shell): the body's '&' separators are command separators under
  // cmd.exe and single quotes are literal there — a shell string both breaks the
  // request and echoes the client_secret into the error. Array args bypass the shell.
  const response = execFileSync('curl', [
    '-s', '-X', 'POST',
    `${authUrl}/api/v1/oauth/token`,
    '-H', 'Content-Type: application/x-www-form-urlencoded',
    '-d', body,
  ], { encoding: 'utf-8' });

  let parsed: { access_token?: string; error?: string };
  try {
    parsed = JSON.parse(response);
  } catch {
    throw new Error(`user-auth token endpoint returned non-JSON (${env}): ${response.slice(0, 200)}`);
  }
  if (!parsed.access_token) {
    throw new Error(`user-auth token mint failed (${env}): ${response.slice(0, 200)}`);
  }
  tokenCache[env] = parsed.access_token;
  return parsed.access_token;
}

// ───── Error envelope ───────────────────────────────────────────────────────
interface BillingErrorEnvelope {
  error?: { code?: string; message?: string } | string;
  message?: string;
  code?: string;
}

function formatServiceError(status: number, statusText: string, body: string): string {
  let parsed: BillingErrorEnvelope | null = null;
  try { parsed = JSON.parse(body); } catch { /* non-JSON */ }

  // Dominant Wave 1.5 envelope: flat { error: "CODE_STRING", message: "..." }
  // emitted by billing's global error handler (app.ts:99-118) for ALL
  // BillingError throws + validation errors + internal errors. Most inline
  // route returns also use this shape (admin-products.ts:110,144,184-185,etc).
  if (parsed && typeof parsed.error === 'string') {
    return `❌ Error [${status}] ${parsed.error}: ${parsed.message ?? '(no message)'}`;
  }
  // Less-common nested envelope: { error: { code, message } } — used by a
  // few inline 400/404 returns in admin-products.ts toggle-channel handler
  // (lines 92-93, 100-101, 114-117). Possibly extends to other routes
  // post-Wave-1.5 as standardization lands.
  if (parsed && typeof parsed.error === 'object' && parsed.error !== null) {
    const code = (parsed.error as { code?: string }).code ?? 'UNKNOWN';
    const msg = (parsed.error as { message?: string }).message ?? '(no message)';
    return `❌ Error [${status}] ${code}: ${msg}`;
  }
  // Non-envelope fallback (raw 502 from upstream LB, crashed handler before
  // error middleware, plain-text body, etc.)
  return `❌ Error [${status}] ${statusText}\n   Response body (first 500 bytes): ${body.slice(0, 500)}`;
}

// ───── Public: callService / callBilling / callSkills ───────────────────────
export interface ServiceResponse<T> {
  status: number;
  body: T;
}

/**
 * Authenticated call to an Optima service (billing or skills — same dev-skills
 * M2M token works for both). Returns `{status, body}` on 2xx; throws Error with
 * formatted message on non-2xx. Single retry on 5xx (no backoff — admin CLI).
 */
async function callService<T>(
  baseUrl: string,
  env: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: object,
): Promise<ServiceResponse<T>> {
  const url = `${baseUrl}${path}`;
  const token = getServiceToken(env);

  const doFetch = async () => fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let res = await doFetch();
  if (res.status >= 500) {
    res = await doFetch();
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(formatServiceError(res.status, res.statusText, text));
  }
  let parsed: T;
  try {
    parsed = text ? (JSON.parse(text) as T) : (undefined as unknown as T);
  } catch {
    throw new Error(`Service returned non-JSON 2xx body: ${text.slice(0, 200)}`);
  }
  return { status: res.status, body: parsed };
}

/** Kept as an alias for billing-side callers that reference the response type. */
export interface BillingResponse<T> extends ServiceResponse<T> {}

export async function callBilling<T = unknown>(
  env: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: object,
): Promise<ServiceResponse<T>> {
  return callService<T>(getBillingUrl(env), env, method, path, body);
}

export async function callSkills<T = unknown>(
  env: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: object,
): Promise<ServiceResponse<T>> {
  return callService<T>(getSkillsUrl(env), env, method, path, body);
}

// ───── Admin-USER token (ROPC password grant) ───────────────────────────────
// Distinct from getServiceToken (M2M client_credentials): user-auth's /admin/*
// endpoints gate on get_current_admin_user — a real role=ADMIN *user* — which an
// M2M token (no user_id) can't satisfy. So ban/unban mint a password-grant token
// for the seeded admin account. Per-env ROPC client = the same public client
// generate-test-token uses; admin email/password live in Infisical
// /shared-secrets/credentials. Cached separately from the M2M tokenCache.
const adminTokenCache: Record<string, string> = {};

const ADMIN_ROPC_CLIENT: Record<string, string> = {
  stage: 'commerce-cli-stage-ihbbwplz',
  prod: 'commerce-cli-ecs-pro-i2r5of1h',
  'cn-prod': 'dev-skill-cli-cn-pro-acvkmcuq',
  'cn-stage': 'dev-skill-cli-cn-sta-3dvsxzdo',
};

const ADMIN_CREDS_PATH = '/shared-secrets/credentials';

export async function getAdminUserToken(env: string): Promise<string> {
  if (adminTokenCache[env]) return adminTokenCache[env];

  let email: string;
  let password: string;
  if (env === 'cn-prod' || env === 'cn-stage') {
    // cn Infisical (separate instance; needs INFISICAL_CN_EMAIL/PASSWORD at runtime).
    const cnTok = getCnInfisicalToken();
    const creds = getCnSecrets(cnTok, ADMIN_CREDS_PATH, false, env === 'cn-stage' ? 'staging' : 'prod');
    email = creds['USER_AUTH_ADMIN_EMAIL'];
    password = creds['USER_AUTH_ADMIN_PASSWORD'];
  } else {
    const cfg = getInfisicalConfig();
    const tok = getInfisicalToken(cfg);
    email = fetchInfisicalSecret(env, ADMIN_CREDS_PATH, 'USER_AUTH_ADMIN_EMAIL', cfg, tok);
    password = fetchInfisicalSecret(env, ADMIN_CREDS_PATH, 'USER_AUTH_ADMIN_PASSWORD', cfg, tok);
  }
  if (!email || !password) {
    throw new Error(`admin 凭证缺失（Infisical ${ADMIN_CREDS_PATH} 的 USER_AUTH_ADMIN_EMAIL/PASSWORD，env=${env}）`);
  }

  const clientId = ADMIN_ROPC_CLIENT[env];
  const authUrl = USER_AUTH_URLS[env];
  if (!clientId || !authUrl) throw new Error(`Unknown env: ${env}`);

  // fetch (not execSync curl) so the password never lands in a shell command line.
  const form = new URLSearchParams({
    grant_type: 'password',
    username: email,
    password,
    client_id: clientId,
  });
  const res = await fetch(`${authUrl}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const text = await res.text();
  let parsed: { access_token?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`user-auth admin token endpoint returned non-JSON (${env}): ${text.slice(0, 200)}`);
  }
  if (!parsed.access_token) {
    throw new Error(`admin-user token mint failed (${env}): ${text.slice(0, 200)}`);
  }
  adminTokenCache[env] = parsed.access_token;
  return parsed.access_token;
}

/**
 * Authenticated call to user-auth as the admin USER (role=ADMIN), for the
 * /api/v1/admin/* endpoints that getServiceToken's M2M token can't reach
 * (ban/unban). Mirrors callService's shape; single retry on 5xx.
 */
export async function callUserAuthAsAdmin<T = unknown>(
  env: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: object,
): Promise<ServiceResponse<T>> {
  const authUrl = USER_AUTH_URLS[env];
  if (!authUrl) throw new Error(`Unknown env: ${env}`);
  const token = await getAdminUserToken(env);

  const doFetch = async () => fetch(`${authUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let res = await doFetch();
  if (res.status >= 500) res = await doFetch();
  const text = await res.text();
  if (!res.ok) {
    throw new Error(formatServiceError(res.status, res.statusText, text));
  }
  let parsed: T;
  try {
    parsed = text ? (JSON.parse(text) as T) : (undefined as unknown as T);
  } catch {
    throw new Error(`user-auth admin returned non-JSON 2xx body: ${text.slice(0, 200)}`);
  }
  return { status: res.status, body: parsed };
}

/**
 * Resolve a user's id by email via user-auth's internal lookup endpoint
 * (POST /api/v1/internal/users/lookup). cn-prod only: AWS envs resolve via
 * the RDS SSH tunnel (db-utils resolveUserId) and their dev-skills clients
 * don't carry the internal:users:write scope this endpoint requires.
 */
export async function resolveUserIdByEmail(env: string, email: string): Promise<string> {
  console.log(`Looking up user by email: ${email}`);
  const token = getServiceToken(env);
  const authUrl = USER_AUTH_URLS[env];
  if (!authUrl) throw new Error(`Unknown env: ${env}`);

  const res = await fetch(`${authUrl}/api/v1/internal/users/lookup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const text = await res.text();
  if (res.status === 404) {
    throw new Error(`User not found (${env}): ${email}`);
  }
  if (!res.ok) {
    throw new Error(formatServiceError(res.status, res.statusText, text));
  }
  let parsed: { user_id?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`user-auth lookup returned non-JSON 2xx body: ${text.slice(0, 200)}`);
  }
  if (!parsed.user_id) {
    throw new Error(`user-auth lookup response missing user_id: ${text.slice(0, 200)}`);
  }
  console.log(`✓ Found user: ${parsed.user_id}`);
  return parsed.user_id;
}

/**
 * Resolve a user's id by phone via user-auth's internal lookup endpoint
 * (POST /api/v1/internal/users/lookup with {phone}). Mirrors
 * resolveUserIdByEmail — pure-phone CN users have no email, so this is the
 * only id path for them (gateway#923 root cause: email-only lookup couldn't
 * resolve them and a wrong userId got hand-fed instead).
 */
export async function resolveUserIdByPhone(env: string, phone: string): Promise<string> {
  console.log(`Looking up user by phone: ${phone}`);
  const token = getServiceToken(env);
  const authUrl = USER_AUTH_URLS[env];
  if (!authUrl) throw new Error(`Unknown env: ${env}`);

  const res = await fetch(`${authUrl}/api/v1/internal/users/lookup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  const text = await res.text();
  if (res.status === 404) {
    throw new Error(`User not found by phone (${env}): ${phone}`);
  }
  if (!res.ok) {
    throw new Error(formatServiceError(res.status, res.statusText, text));
  }
  let parsed: { user_id?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`user-auth lookup returned non-JSON 2xx body: ${text.slice(0, 200)}`);
  }
  if (!parsed.user_id) {
    throw new Error(`user-auth lookup response missing user_id: ${text.slice(0, 200)}`);
  }
  console.log(`✓ Found user: ${parsed.user_id}`);
  return parsed.user_id;
}

/**
 * Fetch a user's identity by id via user-auth's internal endpoint
 * (GET /api/v1/internal/users/{userId}). Used to reverse-verify the target
 * account before granting — prints phone/email/current_plan so the operator
 * can confirm they're hitting the right account (gateway#923).
 */
export async function getUserById(
  env: string,
  userId: string,
): Promise<{ user_id: string; phone: string | null; email: string | null; current_plan?: string }> {
  const token = getServiceToken(env);
  const authUrl = USER_AUTH_URLS[env];
  if (!authUrl) throw new Error(`Unknown env: ${env}`);

  const res = await fetch(`${authUrl}/api/v1/internal/users/${encodeURIComponent(userId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  if (res.status === 404) {
    throw new Error(`User not found by id (${env}): ${userId}`);
  }
  if (!res.ok) {
    throw new Error(formatServiceError(res.status, res.statusText, text));
  }
  let parsed: { user_id: string; phone: string | null; email: string | null; current_plan?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`user-auth user lookup returned non-JSON 2xx body: ${text.slice(0, 200)}`);
  }
  return parsed;
}

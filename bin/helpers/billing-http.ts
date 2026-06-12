import { execSync } from 'child_process';
import { fetchInfisicalSecret } from './infisical-secrets';
import { getInfisicalConfig, getInfisicalToken } from './db-utils';

const USER_AUTH_URLS: Record<string, string> = {
  stage: 'https://auth.stage.optima.onl',
  prod: 'https://auth.optima.onl',
  'cn-prod': 'https://auth.yzsgo.com',
};

// cn-prod URLs are hardcoded: cn Infisical (secrets-cn.optima.chat) is a
// separate instance dev-skills has no machine identity for. Domains follow
// optima-terraform alicloud/stacks/cn-prod-ingress-sae/main.tf (yzsgo_sub) —
// the old *-cn.optima.chat ingress routes were removed 2026-06-12 (#160).
// AWS envs keep reading /shared-secrets/domain-urls.
const CN_PROD_BILLING_URL = 'https://billing-api.yzsgo.com';

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
export function validateEnvCnProd(env: string): 'stage' | 'prod' | 'cn-prod' {
  if (env !== 'stage' && env !== 'prod' && env !== 'cn-prod') {
    throw new Error(`--env must be "stage", "prod" or "cn-prod" (got: ${env})`);
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

  const cfg = getInfisicalConfig();
  const tok = getInfisicalToken(cfg);
  // Fetch BOTH client_id and client_secret from Infisical — they differ per env.
  // cn-prod credentials are mirrored in the AWS Infisical *prod* environment
  // (fetchInfisicalSecret has no cn-prod env slug), under CN-specific keys.
  const isCn = env === 'cn-prod';
  const infisicalEnv = isCn ? 'prod' : env;
  const idKey = isCn ? DEV_SKILLS_CN_CLIENT_ID_KEY : DEV_SKILLS_CLIENT_ID_KEY;
  const secretKey = isCn ? DEV_SKILLS_CN_CLIENT_SECRET_KEY : DEV_SKILLS_CLIENT_SECRET_KEY;
  const clientId = fetchInfisicalSecret(infisicalEnv, DEV_SKILLS_OAUTH_PATH, idKey, cfg, tok);
  const clientSecret = fetchInfisicalSecret(infisicalEnv, DEV_SKILLS_OAUTH_PATH, secretKey, cfg, tok);

  const authUrl = USER_AUTH_URLS[env];
  if (!authUrl) throw new Error(`Unknown env: ${env}`);

  const scopeParam = isCn ? `&scope=${encodeURIComponent(CN_PROD_TOKEN_SCOPE)}` : '';
  const body = `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}${scopeParam}`;
  const response = execSync(
    `curl -s -X POST '${authUrl}/api/v1/oauth/token' -H 'Content-Type: application/x-www-form-urlencoded' -d '${body}'`,
    { encoding: 'utf-8' },
  );

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

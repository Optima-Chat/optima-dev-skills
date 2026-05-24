import { execSync } from 'child_process';
import { fetchInfisicalSecret } from './infisical-secrets';
import { getInfisicalConfig, getInfisicalToken } from './db-utils';

const USER_AUTH_URLS: Record<string, string> = {
  stage: 'https://auth.stage.optima.onl',
  prod: 'https://auth.optima.onl',
};

// T1 discovered: client_id differs per env (stage=dev-skills-ubd3qz6n,
// prod=dev-skills-hinxa0rs). Both stored in Infisical alongside the
// secret at /shared-secrets/oauth-clients/.
const DEV_SKILLS_OAUTH_PATH = '/shared-secrets/oauth-clients';
const DEV_SKILLS_CLIENT_ID_KEY = 'DEV_SKILLS_OAUTH_CLIENT_ID';
const DEV_SKILLS_CLIENT_SECRET_KEY = 'DEV_SKILLS_OAUTH_CLIENT_SECRET';

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

function getBillingUrl(env: string): string {
  if (billingUrlCache[env]) return billingUrlCache[env];
  const url = fetchInfisicalSecret(env, '/shared-secrets/domain-urls', 'BILLING_URL');
  billingUrlCache[env] = url;
  return url;
}

export function getServiceToken(env: string): string {
  if (tokenCache[env]) return tokenCache[env];

  const cfg = getInfisicalConfig();
  const tok = getInfisicalToken(cfg);
  // Fetch BOTH client_id and client_secret from Infisical — they differ per env.
  const clientId = fetchInfisicalSecret(env, DEV_SKILLS_OAUTH_PATH, DEV_SKILLS_CLIENT_ID_KEY, cfg, tok);
  const clientSecret = fetchInfisicalSecret(env, DEV_SKILLS_OAUTH_PATH, DEV_SKILLS_CLIENT_SECRET_KEY, cfg, tok);

  const authUrl = USER_AUTH_URLS[env];
  if (!authUrl) throw new Error(`Unknown env: ${env}`);

  const body = `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;
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

function formatBillingError(status: number, statusText: string, body: string): string {
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

// ───── Public: callBilling ──────────────────────────────────────────────────
export interface BillingResponse<T> {
  status: number;
  body: T;
}

/**
 * Make an authenticated call to optima-billing. Returns `{status, body}` on
 * 2xx; throws Error with formatted message on non-2xx. Single retry on 5xx
 * (one-shot — no exponential backoff; admin CLI doesn't justify it).
 */
export async function callBilling<T = unknown>(
  env: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: object,
): Promise<BillingResponse<T>> {
  const url = `${getBillingUrl(env)}${path}`;
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
    // One retry on 5xx
    res = await doFetch();
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(formatBillingError(res.status, res.statusText, text));
  }
  let parsed: T;
  try {
    parsed = text ? (JSON.parse(text) as T) : (undefined as unknown as T);
  } catch {
    throw new Error(`Billing returned non-JSON 2xx body: ${text.slice(0, 200)}`);
  }
  return { status: res.status, body: parsed };
}

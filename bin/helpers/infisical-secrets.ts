import { execSync } from 'child_process';
import { getInfisicalConfig, getInfisicalToken, InfisicalConfig } from './db-utils';

/**
 * Fetch a single secret value from Infisical given env + path + name.
 *
 * env mapping: 'stage' → Infisical env slug 'staging'; 'prod' → 'prod'
 * (matches dev-skills convention documented at
 *  ~/.claude/projects/-mnt-d-work-projects-optima/memory/optima_infisical_env_naming.md).
 *
 * Returns the raw secretValue string. Throws if the secret is missing.
 */
export function fetchInfisicalSecret(
  env: string,
  secretPath: string,
  secretName: string,
  config?: InfisicalConfig,
  token?: string,
): string {
  const cfg = config ?? getInfisicalConfig();
  const tok = token ?? getInfisicalToken(cfg);
  const envSlug = env === 'stage' ? 'staging' : env;
  const encodedPath = encodeURIComponent(secretPath);

  const response = execSync(
    `curl -s "${cfg.url}/api/v3/secrets/raw/${secretName}?workspaceId=${cfg.projectId}&environment=${envSlug}&secretPath=${encodedPath}" -H "Authorization: Bearer ${tok}"`,
    { encoding: 'utf-8' },
  );

  let parsed: { secret?: { secretValue?: string }; message?: string };
  try {
    parsed = JSON.parse(response);
  } catch {
    throw new Error(`Infisical raw secret fetch returned non-JSON for ${secretPath}/${secretName} (${envSlug}): ${response.slice(0, 200)}`);
  }
  if (!parsed.secret?.secretValue) {
    throw new Error(`Infisical secret not found: env=${envSlug} path=${secretPath} name=${secretName} (response: ${response.slice(0, 200)})`);
  }
  return parsed.secret.secretValue;
}

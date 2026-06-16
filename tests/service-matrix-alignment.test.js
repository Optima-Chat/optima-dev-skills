const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function parseQuotedList(source, variableName) {
  const escapedName = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`const ${escapedName} = \\[(.*?)\\];`, 's'));
  assert.ok(match, `Could not find array for ${variableName}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

function parseBacktickBullets(source) {
  return [...source.matchAll(/- `([^`]+)`/g)].map((item) => item[1]);
}

test('show-env supported services match current Terraform-facing service set', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'bin/helpers/show-env.ts'), 'utf8');
  const services = parseQuotedList(source, 'SUPPORTED_SERVICES');

  for (const required of [
    'ads-backend',
    'amazon-backend',
    'gateway-core',
    'gw-admin',
    'optima-channels',
    'optima-sentinel',
    'shopify-backend',
    'user-auth-admin',
  ]) {
    assert.ok(services.includes(required), `Expected show-env to support ${required}`);
  }

  assert.ok(!services.includes('mcp-host'), 'mcp-host should not remain in show-env');
  assert.ok(!services.includes('bi'), 'show-env should use bi-backend instead of bi');
});

test('logs command documents current ECS services from Terraform', () => {
  const source = fs.readFileSync(path.join(repoRoot, '.claude/commands/logs.md'), 'utf8');
  const services = new Set(parseBacktickBullets(source));

  for (const required of [
    'ads-backend',
    'ads-worker',
    'amazon-backend',
    'gateway-core',
    'gw-admin',
    'optima-channels',
    'optima-sentinel',
    'optima-sentinel-worker',
    'shopify-backend',
  ]) {
    assert.ok(services.has(required), `Expected logs.md to document ${required}`);
  }
});

test('query-db service map includes current database-backed services', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'bin/helpers/query-db.ts'), 'utf8');
  const services = new Set(Object.keys(parseObjectKeys(source, 'SERVICE_DB_MAP')));

  for (const required of [
    'ads-backend',
    'amazon-backend',
    'shopify-backend',
    'optima-sentinel',
  ]) {
    assert.ok(services.has(required), `Expected query-db to support ${required}`);
  }
});

test('query-db command documents current database-backed services', () => {
  const source = fs.readFileSync(path.join(repoRoot, '.claude/commands/query-db.md'), 'utf8');
  const services = new Set(parseBacktickBullets(source));

  for (const required of [
    'ads-backend',
    'amazon-backend',
    'shopify-backend',
    'optima-sentinel',
  ]) {
    assert.ok(services.has(required), `Expected query-db docs to mention ${required}`);
  }
});

test('restart-ecs skill documents current restartable ECS services', () => {
  const source = fs.readFileSync(path.join(repoRoot, '.claude/skills/restart-ecs/SKILL.md'), 'utf8');
  const services = new Set(parseBacktickBullets(source));

  for (const required of [
    'ads-backend',
    'amazon-backend',
    'browser-backend',
    'billing',
    'gateway-core',
    'gw-admin',
    'optima-channels',
    'optima-generation',
    'optima-generation-worker',
    'optima-sentinel',
    'optima-sentinel-worker',
    'shopify-backend',
  ]) {
    assert.ok(services.has(required), `Expected restart-ecs skill to mention ${required}`);
  }
});

test('entitlement + discount subcommands accept cn-prod / cn-stage (validateEnvCnProd)', () => {
  // These commands reach billing/user-auth over HTTPS only — no AWS-RDS-tunnel
  // dependency that would block cn — so they must validate with the cn-aware
  // guard. A regression to the AWS-only validateEnv would silently drop cn
  // support, the exact gap this alignment closes (cn-prod ↔ AWS stage/prod).
  const cnCapableCommands = [
    'bin/helpers/entitlement/grant.ts',
    'bin/helpers/entitlement/list.ts',
    'bin/helpers/entitlement/revoke.ts',
    'bin/helpers/discount/create.ts',
    'bin/helpers/discount/generate.ts',
    'bin/helpers/discount/list.ts',
    'bin/helpers/discount/disable.ts',
  ];
  for (const rel of cnCapableCommands) {
    const source = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    assert.match(source, /validateEnvCnProd\(/, `${rel} must call validateEnvCnProd`);
    assert.doesNotMatch(source, /\bvalidateEnv\(/, `${rel} must not use AWS-only validateEnv`);
  }
});

test('confirmIfProd gates cn-prod as a production env', () => {
  // cn-prod is production: it must trigger the same type-"yes" prompt as AWS
  // prod, or the cn rollout silently loses the destructive-action safety gate.
  const source = fs.readFileSync(path.join(repoRoot, 'bin/helpers/confirm-prompt.ts'), 'utf8');
  const match = source.match(/const PROD_ENVS = new Set\(\[(.*?)\]\)/s);
  assert.ok(match, 'Could not find PROD_ENVS set');
  const prodEnvs = [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
  assert.ok(prodEnvs.includes('prod'), 'confirmIfProd must gate prod');
  assert.ok(prodEnvs.includes('cn-prod'), 'confirmIfProd must gate cn-prod');
});

function parseObjectKeys(source, variableName) {
  const escapedName = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`const ${escapedName} = \\{(.*?)\\n\\};`, 's'));
  assert.ok(match, `Could not find object for ${variableName}`);
  return Object.fromEntries(
    [...match[1].matchAll(/'([^']+)':\s*\{/g)].map((item) => [item[1], true]),
  );
}

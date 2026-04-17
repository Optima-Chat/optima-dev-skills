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

function parseObjectKeys(source, variableName) {
  const escapedName = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`const ${escapedName} = \\{(.*?)\\n\\};`, 's'));
  assert.ok(match, `Could not find object for ${variableName}`);
  return Object.fromEntries(
    [...match[1].matchAll(/'([^']+)':\s*\{/g)].map((item) => [item[1], true]),
  );
}

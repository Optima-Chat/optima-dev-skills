const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

// Test the compiled dist artifact — run `npm run build` first (npm test's pretest does this).
const DIST = path.resolve(__dirname, '..', 'dist', 'bin', 'helpers', 'billing-http.js');
const { cnStageOAuthClientFromEnv } = require(DIST);

test('cnStageOAuthClientFromEnv：两个都没设 ⇒ null（走原 Infisical 路径）', () => {
  assert.equal(cnStageOAuthClientFromEnv({}), null);
  assert.equal(cnStageOAuthClientFromEnv({ DEV_SKILLS_CN_STAGE_OAUTH_CLIENT_ID: '  ', DEV_SKILLS_CN_STAGE_OAUTH_CLIENT_SECRET: '' }), null);
});

test('cnStageOAuthClientFromEnv：两个都设 ⇒ 取值（去首尾空白）', () => {
  assert.deepEqual(
    cnStageOAuthClientFromEnv({ DEV_SKILLS_CN_STAGE_OAUTH_CLIENT_ID: ' cid ', DEV_SKILLS_CN_STAGE_OAUTH_CLIENT_SECRET: 'sec\n' }),
    { clientId: 'cid', clientSecret: 'sec' },
  );
});

test('cnStageOAuthClientFromEnv：只设一个 ⇒ 报错（不静默回落 Infisical）', () => {
  assert.throws(() => cnStageOAuthClientFromEnv({ DEV_SKILLS_CN_STAGE_OAUTH_CLIENT_ID: 'cid' }), /必须同时设置/);
  assert.throws(() => cnStageOAuthClientFromEnv({ DEV_SKILLS_CN_STAGE_OAUTH_CLIENT_SECRET: 'sec' }), /必须同时设置/);
});

// getServiceToken 端到端：PATH 里放假 curl，记录每次调用的 URL 与 client_id（不记 secret），回一个 access_token。
function withFakeCurl(env, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnstage-env-'));
  const log = path.join(dir, 'calls.log');
  fs.writeFileSync(path.join(dir, 'curl'), `#!/bin/sh
url=""; cid=""
for a in "$@"; do
  case "$a" in http*) url="$a" ;; esac
  case "$a" in *client_id=*) cid=$(printf '%s' "$a" | sed -n 's/.*client_id=\\([^&]*\\).*/\\1/p') ;; esac
done
printf '%s %s\\n' "$url" "$cid" >> "${log}"
printf '{"access_token":"tok-fake"}'
`, { mode: 0o755 });
  const r = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      HOME: dir, // 不读开发机 ~/.infisical_cn_creds
      INFISICAL_CN_CREDS_FILE: path.join(dir, 'missing'),
      ...env,
    },
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  return { ...r, calls };
}
const mint = (envName) => `
  const { getServiceToken } = require(${JSON.stringify(DIST)});
  try { process.stdout.write(getServiceToken(${JSON.stringify(envName)}, 'gateway:admin')); }
  catch (e) { process.stdout.write('ERR:' + e.message); }
`;

test('getServiceToken(cn-stage)：设了这对 env ⇒ 直接对 stage user-auth 发 client_credentials，零 Infisical 调用', () => {
  const r = withFakeCurl({ DEV_SKILLS_CN_STAGE_OAUTH_CLIENT_ID: 'cid-stage', DEV_SKILLS_CN_STAGE_OAUTH_CLIENT_SECRET: 'sec-stage' }, mint('cn-stage'));
  assert.equal(r.stdout, 'tok-fake', r.stderr);
  assert.equal(r.calls.length, 1, r.calls.join('\n'));
  assert.match(r.calls[0], /^https:\/\/auth\.stage\.optima\.chat\/api\/v1\/oauth\/token cid-stage$/);
  assert.ok(!r.calls.some((c) => /infisical|secrets-cn/i.test(c)));
});

test('getServiceToken(cn-stage)：没设 env ⇒ 仍走 cn Infisical（缺 admin 口令照旧报错）', () => {
  const r = withFakeCurl({}, mint('cn-stage'));
  assert.match(r.stdout, /^ERR:cn Infisical 需要 INFISICAL_CN_EMAIL/);
  assert.equal(r.calls.length, 0);
});

test('getServiceToken(cn-prod)：设了 cn-stage 这对 env 也绝不拿它发 prod 令牌', () => {
  const r = withFakeCurl({ DEV_SKILLS_CN_STAGE_OAUTH_CLIENT_ID: 'cid-stage', DEV_SKILLS_CN_STAGE_OAUTH_CLIENT_SECRET: 'sec-stage' }, mint('cn-prod'));
  assert.ok(!r.calls.some((c) => c.includes('cid-stage')), r.calls.join('\n'));
  assert.ok(!r.calls.some((c) => c.includes('auth.stage.optima.chat')), r.calls.join('\n'));
});

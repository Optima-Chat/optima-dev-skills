const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { generateKeyPairSync, createVerify } = require('node:crypto');

// tf#452:cn-deploy 触发 Codeup 镜像同步改用只读 GitHub App 令牌。测 dist(npm test 的 pretest 会先 build)。
const cred = require(path.resolve(__dirname, '..', 'dist', 'bin', 'helpers', 'github-app-cred.js'));
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' });

const unb64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

test('appJwt:RS256 可被公钥验签,iss/iat/exp 正确;换一把公钥验签失败', () => {
  const jwt = cred.appJwt('12345', PEM, 1_800_000_000);
  const [h, p, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(unb64(h)), { alg: 'RS256', typ: 'JWT' });
  assert.deepEqual(JSON.parse(unb64(p)), { iat: 1_800_000_000 - 60, exp: 1_800_000_000 + 540, iss: '12345' });
  assert.equal(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, unb64(s)), true);
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;
  assert.equal(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(other, unb64(s)), false);
});

test('mintCodeupMirrorToken:令牌收窄到单仓 + 只读;返回 ghs_', async () => {
  const calls = [];
  const call = async (method, p, bearer, body) => {
    calls.push({ method, p, body });
    if (p === '/orgs/Optima-Chat/installation') return { status: 200, json: { id: 77 } };
    return { status: 201, json: { token: 'ghs_abc' } };
  };
  const t = await cred.mintCodeupMirrorToken('optima-billing', { appId: '1', pem: PEM }, call);
  assert.equal(t, 'ghs_abc');
  assert.equal(calls[1].p, '/app/installations/77/access_tokens');
  assert.deepEqual(JSON.parse(calls[1].body), { repositories: ['optima-billing'], permissions: { contents: 'read', metadata: 'read' } });
});

test('mintCodeupMirrorToken:没装 App / 换出非 ghs_ ⇒ 抛错(不回落个人令牌)', async () => {
  await assert.rejects(cred.mintCodeupMirrorToken('x', { appId: '1', pem: PEM }, async () => ({ status: 404, json: {} })), /安装失败/);
  const call = async (_m, p) => (p.endsWith('/installation') ? { status: 200, json: { id: 1 } } : { status: 201, json: { token: 'gho_personal' } });
  await assert.rejects(cred.mintCodeupMirrorToken('x', { appId: '1', pem: PEM }, call), /installation token 失败/);
});

test('loadAppCred:env 优先;缺凭证时抛错而不是返回空', () => {
  const noOp = () => '';
  assert.deepEqual(cred.loadAppCred({ CODEUP_MIRROR_APP_PRIVATE_KEY: PEM, CODEUP_MIRROR_APP_ID: '9' }, noOp), { appId: '9', pem: PEM });
  const fromOp = (a) => (a[0] === 'document' ? PEM : '42');
  assert.deepEqual(cred.loadAppCred({}, fromOp), { appId: '42', pem: PEM });
  assert.throws(() => cred.loadAppCred({}, noOp), /不会回落到 gh auth token/);
});

test('cn-deploy.ts 不再把 gh 登录令牌交给 Codeup', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'helpers', 'cn-deploy.ts'), 'utf8');
  assert.doesNotMatch(src, /['"]auth['"],\s*['"]token['"]/);
  assert.doesNotMatch(src, /account:\s*['"](xbfool|veryverypro)['"]/);
  assert.match(src, /account: 'x-access-token', token: mirrorTok/);
});

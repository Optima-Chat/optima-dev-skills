const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Tests the compiled dist artifact — `npm test`'s pretest builds first.
const { runCurl, redactArgv, scrub, sanitizeExecError, isSecretName } = require(
  path.resolve(__dirname, '..', 'dist', 'bin', 'helpers', 'safe-exec.js'),
);

// Obviously fake values. None of these may ever show up in an error.
const FAKE_PASSWORD = 'FAKE-pass-w0rd-DO-NOT-LEAK';
const FAKE_TOKEN = 'FAKE.token.abc123-DO-NOT-LEAK';
const FAKE_SECRET = 'FAKE_client_secret_DO_NOT_LEAK';
const ALL_FAKES = [FAKE_PASSWORD, FAKE_TOKEN, FAKE_SECRET];

function assertNoFakes(text, label) {
  for (const f of ALL_FAKES) assert.ok(!String(text).includes(f), `${label} leaked ${f}: ${text}`);
}

function everyStringIn(err) {
  // message + stack + every own enumerable/non-enumerable string-ish property
  const out = [String(err.message), String(err.stack)];
  for (const k of Object.getOwnPropertyNames(err)) {
    const v = err[k];
    out.push(typeof v === 'string' ? v : JSON.stringify(v));
  }
  if (err.cause) out.push(String(err.cause), JSON.stringify(err.cause));
  return out.join('\n');
}

const SENSITIVE_ARGS = [
  '-X', 'POST', `http://127.0.0.1:1/login?password=${FAKE_PASSWORD}&token=${FAKE_TOKEN}&page=2`,
  '-H', 'Content-Type: application/json',
  '-H', `Authorization: Bearer ${FAKE_TOKEN}`,
  '-u', `admin:${FAKE_PASSWORD}`,
  '-d', JSON.stringify({ email: 'someone@example.com', password: FAKE_PASSWORD, clientSecret: FAKE_SECRET }),
];

test('runCurl: real curl failure (connection refused) — error has no credentials, keeps exit code + host', () => {
  let err;
  try { runCurl(SENSITIVE_ARGS); } catch (e) { err = e; }
  assert.ok(err, 'expected runCurl to throw');
  assertNoFakes(everyStringIn(err), 'error object');
  assert.match(err.message, /curl failed/);
  assert.match(err.message, /exit=7\b/);          // curl: couldn't connect
  assert.match(err.message, /host=127\.0\.0\.1/);
  // the raw child_process fields must not ride along
  for (const k of ['cmd', 'spawnargs', 'args', 'stdout', 'stderr', 'output']) {
    assert.equal(err[k], undefined, `error must not carry .${k}`);
  }
});

test('runCurl: a binary that echoes its own argv to stderr — stderr is scrubbed before it reaches the error', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-exec-'));
  const fake = path.join(dir, 'fake-curl.sh');
  fs.writeFileSync(fake, '#!/bin/sh\necho "fake-curl: bad things with args: $*" >&2\nexit 22\n', { mode: 0o755 });
  let err;
  try { runCurl(SENSITIVE_ARGS, { bin: fake }); } catch (e) { err = e; }
  assert.ok(err, 'expected runCurl to throw');
  assertNoFakes(everyStringIn(err), 'error object');
  assert.match(err.message, /exit=22\b/);
  assert.match(err.message, /host=127\.0\.0\.1/);
  assert.match(err.message, /fake-curl: bad things/); // non-secret stderr context survives
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runCurl: form-urlencoded body + proxy/referer ordering — no leak, host is the request target', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-exec-'));
  const fake = path.join(dir, 'fake-curl.sh');
  fs.writeFileSync(fake, '#!/bin/sh\necho "args: $*" >&2\nexit 22\n', { mode: 0o755 });
  let err;
  try {
    runCurl([
      '-x', `http://px:${FAKE_PASSWORD}@127.0.0.1:1`, '-e', 'http://referer.example.invalid/',
      '-X', 'POST', 'http://target.example.invalid/oauth/token',
      '-d', `grant_type=client_credentials&client_id=abc&client_secret=${encodeURIComponent(FAKE_SECRET)}`,
    ], { bin: fake });
  } catch (e) { err = e; }
  assert.ok(err);
  assertNoFakes(everyStringIn(err), 'error object');
  assert.match(err.message, /host=target\.example\.invalid/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runCurl: verbose/trace/include options are refused (they would put header details in the output)', () => {
  for (const opt of ['-v', '--verbose', '--trace-ascii', '-i', '--include', '-sv', '-vs', '--verbos', '-D/dev/stderr']) {
    assert.throws(() => runCurl([opt, 'http://127.0.0.1:1/', '-H', `Authorization: Bearer ${FAKE_TOKEN}`]), (e) => {
      assertNoFakes(everyStringIn(e), 'error object');
      return /not allowed/.test(e.message);
    });
  }
});

// Regression: exclusions must be anchored. An unanchored "id"/"mode"/"type"/"name" exclusion let
// `provider_secret` (prov-ID-er), `model_secret` (MODE-l) etc. through.
test('isSecretName: anchored exclusions — credential-ish names are never excused by a substring', () => {
  for (const n of ['provider_secret', 'hidden_secret', 'oidc_secret', 'android_secret', 'widget_secret', 'idp_secret',
    'model_secret', 'prototype_secret', 'username_secret', 'secret_provider', 'client_secret', 'clientSecret',
    'password', 'api_key', 'access_token', 'session', 'code', 'key', 'jwt', 'otp', 'assertion', 'hmac', 'ticket', 'pw']) assert.equal(isSecretName(n), true, n);
  for (const n of ['secretPath', 'expandSecretReferences', 'secret_id', 'secretKeyId', 'secretName', 'token_type',
    'token_version', 'max_tokens', 'sshpass', 'tokenizer', 'environment', 'workspaceId', 'page']) assert.equal(isSecretName(n), false, n);
});

test('runCurl: value-only echo — provider_secret & friends are scrubbed in query, form and JSON carriers', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-exec-'));
  const fake = path.join(dir, 'fake-curl.sh');
  // echoes only the *values*, never the key names — the literal list has to catch them
  fs.writeFileSync(fake, `#!/bin/sh\necho "saw ${FAKE_SECRET} and ${FAKE_TOKEN}" >&2\nexit 22\n`, { mode: 0o755 });
  for (const args of [
    [`http://h.example.invalid/x?provider_secret=${FAKE_SECRET}&model_secret=${FAKE_TOKEN}`],
    ['http://h.example.invalid/x', '-d', `a=b&provider_secret=${FAKE_SECRET}&model_secret=${FAKE_TOKEN}`],
    ['http://h.example.invalid/x', '-d', JSON.stringify({ provider_secret: FAKE_SECRET, model_secret: FAKE_TOKEN })],
  ]) {
    let err;
    try { runCurl(args, { bin: fake }); } catch (e) { err = e; }
    assert.ok(err);
    assertNoFakes(everyStringIn(err), 'error object');
    assertNoFakes(redactArgv(args).join(' '), 'redacted argv');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('redactArgv: short-option clusters, cert passphrase, tls password, --variable, fragment', () => {
  const red = redactArgv([
    '-sSu', `user:${FAKE_PASSWORD}`, `-sSuuser:${FAKE_PASSWORD}`, '-XPOST',
    '--tlspassword', FAKE_PASSWORD, '-E', `/tmp/c.pem:${FAKE_PASSWORD}`, `--cert=/tmp/c.pem:${FAKE_PASSWORD}`,
    '--variable', `tok=${FAKE_TOKEN}`, `http://h.example.invalid/cb#access_token=${FAKE_TOKEN}`,
  ]).join(' ');
  assertNoFakes(red, 'redacted argv');
  assert.ok(red.includes('-XPOST') && red.includes('h.example.invalid/cb'));
});

test('runCurl: missing binary — reports errno code, no argv', () => {
  let err;
  try { runCurl(SENSITIVE_ARGS, { bin: '/nonexistent/definitely-not-curl' }); } catch (e) { err = e; }
  assert.ok(err);
  assertNoFakes(everyStringIn(err), 'error object');
  assert.match(err.message, /ENOENT/);
});

test('redactArgv: bodies, -u, auth headers and secret-ish query params are masked; harmless parts stay', () => {
  const red = redactArgv([
    ...SENSITIVE_ARGS,
    '--data-raw', `x=${FAKE_SECRET}`,
    `--data=${FAKE_SECRET}`,
    '--user', `u:${FAKE_PASSWORD}`,
    '-H', `X-Api-Key: ${FAKE_TOKEN}`,
    '-H', `Cookie: sid=${FAKE_TOKEN}`,
    `-HAuthorization: Basic ${FAKE_TOKEN}`,
    `https://user:${FAKE_PASSWORD}@example.com/path?api_key=${FAKE_TOKEN}&client_secret=${FAKE_SECRET}&q=ok`,
  ]);
  const joined = red.join(' ');
  assertNoFakes(joined, 'redacted argv');
  assert.ok(joined.includes('Content-Type: application/json'));
  assert.ok(joined.includes('page=2'));
  assert.ok(joined.includes('q=ok'));
  assert.ok(joined.includes('example.com/path'));
  assert.ok(joined.includes('Authorization: [REDACTED]'));
});

test('redactArgv: proxy credentials, scheme-less userinfo, unknown headers, code/key params', () => {
  const red = redactArgv([
    '-x', `pxuser:${FAKE_PASSWORD}@127.0.0.1:1`,
    `u:${FAKE_PASSWORD}@127.0.0.1:1/`,
    '-H', `X-Custom-Thing: ${FAKE_TOKEN}`,
    '-H', 'Accept: application/json',
    `http://127.0.0.1:1/?code=${FAKE_TOKEN}&key=${FAKE_SECRET}&environment=prod`,
  ]).join(' ');
  assertNoFakes(red, 'redacted argv');
  assert.ok(red.includes('Accept: application/json'));
  assert.ok(red.includes('environment=prod'));
});

// Regression: a param merely *named* like `secretPath` is not a credential. Treating it as one used to
// make every query value (`prod`, `true`, …) a "secret literal", which shredded curl's own error text.
test('runCurl: ordinary query values are not scrubbed out of the error text', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-exec-'));
  const fake = path.join(dir, 'fake-curl.sh');
  fs.writeFileSync(fake, [
    '#!/bin/sh',
    'echo "curl: (6) Could not resolve host: secrets-prod.example.invalid" >&2',
    'echo "curl: (35) TLS connect error: true cause is prod cert expired for /services/foo" >&2',
    'exit 6', '',
  ].join('\n'), { mode: 0o755 });
  const args = [
    'https://secrets-prod.example.invalid/api/raw?workspaceId=FAKEWS1234&environment=prod&secretPath=%2Fservices%2Ffoo&expandSecretReferences=true',
    '-H', `Authorization: Bearer ${FAKE_TOKEN}`,
  ];
  let err;
  try { runCurl(args, { bin: fake }); } catch (e) { err = e; }
  assert.ok(err);
  assertNoFakes(everyStringIn(err), 'error object');
  assert.match(err.message, /exit=6 host=secrets-prod\.example\.invalid/);
  assert.match(err.message, /Could not resolve host: secrets-prod\.example\.invalid/);
  assert.match(err.message, /true cause is prod cert expired for \/services\/foo/);
  assert.ok(!err.message.includes('[REDACTED]'), err.message);
  const red = redactArgv(args).join(' ');
  assert.ok(red.includes('secretPath=%2Fservices%2Ffoo') && red.includes('expandSecretReferences=true'), red);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scrub: shape rules without literals — api-key/cookie headers, single-quoted / yaml fields, sshpass -pX', () => {
  for (const text of [
    `X-Api-Key: ${FAKE_TOKEN}`,
    `Cookie: sid=${FAKE_TOKEN}`,
    `{'password': '${FAKE_PASSWORD}'}`,
    `password: ${FAKE_PASSWORD}`,
    `sshpass -p${FAKE_PASSWORD} ssh host`,
    `sshpass -p "${FAKE_PASSWORD}" ssh host`,
  ]) assertNoFakes(scrub(text), `scrub(${text.slice(0, 14)}…)`);
  assert.equal(scrub('secretPath: /services/foo'), 'secretPath: /services/foo');
  // ordinary diagnostics must survive untouched
  for (const text of [
    'sshpass: Failed to run command: No such file or directory',
    'Error: tokenizer: unexpected end of input',
    'rate limit: max_tokens: 4096 exceeded',
    'token: expired at 12:00; password: must be at least 8 chars',
    'LINE 1: ... where password_hash is null and token_version=3',
    'https://h.example.invalid/raw?workspaceId=ws1&environment=prod&secretPath=%2Fservices%2Ffoo&expandSecretReferences=true',
    'curl: (22) The requested URL returned error: 401',
    'psql: error: FATAL:  password authentication failed for user "app"',
  ]) assert.equal(scrub(text), text);
  // password containing "@": nothing after the first "@" may survive
  const dsn = scrub('postgres://app:FAKE@dbPW-DO-NOT-LEAK@db.example.invalid:5432/x');
  assert.ok(!dsn.includes('dbPW-DO-NOT-LEAK'), dsn);
  assert.ok(dsn.includes('db.example.invalid:5432/x'), dsn);
  // server response echo: token-ish JSON fields are masked
  assertNoFakes(scrub(JSON.stringify({ mfaToken: FAKE_TOKEN, message: 'mfa required' })), 'response echo');
});

test('scrub: removes literal secrets and bearer/basic tokens from arbitrary text', () => {
  const text = `Command failed: curl -s -H "Authorization: Bearer ${FAKE_TOKEN}" -d {"password":"${FAKE_PASSWORD}"} https://x/y?token=${FAKE_TOKEN}`;
  const out = scrub(text, [FAKE_PASSWORD]);
  assertNoFakes(out, 'scrubbed text');
  assert.ok(out.includes('https://x/y'));
});

test('sanitizeExecError: wraps a child_process-style error without copying cmd/spawnargs/stderr', () => {
  const raw = Object.assign(new Error(`Command failed: sshpass -p "${FAKE_PASSWORD}" ssh host`), {
    status: 5, signal: null, cmd: `sshpass -p "${FAKE_PASSWORD}" ssh host`,
    spawnargs: ['-p', FAKE_PASSWORD], stderr: Buffer.from(`Permission denied (${FAKE_PASSWORD})`),
  });
  const err = sanitizeExecError('ssh', raw, [FAKE_PASSWORD]);
  assertNoFakes(everyStringIn(err), 'sanitized error');
  assert.match(err.message, /ssh failed/);
  assert.match(err.message, /exit=5\b/);
  assert.match(err.message, /Permission denied/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// 测编译产物（package bin 指向 dist/）——`npm test` 的 pretest 会先 build。
const { getGitHubVariable, GH_VARIABLE_RETRY_DELAYS_MS, isRetryableGhError, getInfisicalConfig, resetInfisicalConfigNoticesForTests } = require(
  path.resolve(__dirname, '..', 'dist', 'bin', 'helpers', 'db-utils.js'),
);

// #105：api.github.com 一抖（dial tcp … i/o timeout），getInfisicalConfig 串行 4 次 gh api
// 全靠运气；下面钉住三条腿：env 旁路 / 有限重试 / 进程内缓存。测试用的变量名都带
// GHVAR_TEST_ 前缀且每条用独立名字，互不共享缓存。
const noSleep = () => {};

test('env 已设即旁路，不打 gh', () => {
  process.env.GHVAR_TEST_ENV = 'from-env';
  let calls = 0;
  try {
    const v = getGitHubVariable('GHVAR_TEST_ENV', { fetch: () => { calls++; throw new Error('must not be called'); } });
    assert.equal(v, 'from-env');
    assert.equal(calls, 0);
  } finally {
    delete process.env.GHVAR_TEST_ENV;
  }
});

test('env 为空串视为未设，仍走 gh', () => {
  process.env.GHVAR_TEST_EMPTY = '';
  try {
    assert.equal(getGitHubVariable('GHVAR_TEST_EMPTY', { fetch: () => 'from-gh', sleep: noSleep }), 'from-gh');
  } finally {
    delete process.env.GHVAR_TEST_EMPTY;
  }
});

test('INFISICAL_AWS_CREDS_FILE 里的 KEY=val 作为旁路，文件不存在时静默', () => {
  const f = path.join(os.tmpdir(), `ghvar-creds-${process.pid}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(f, 'export GHVAR_TEST_FILE=from-file\n', { mode: 0o600 });
  process.env.INFISICAL_AWS_CREDS_FILE = f;
  delete process.env.GHVAR_TEST_FILE;
  try {
    assert.equal(getGitHubVariable('GHVAR_TEST_FILE', { fetch: () => { throw new Error('must not be called'); } }), 'from-file');
  } finally {
    fs.unlinkSync(f);
    delete process.env.GHVAR_TEST_FILE;
    process.env.INFISICAL_AWS_CREDS_FILE = path.join(os.tmpdir(), 'ghvar-creds-definitely-missing');
  }
  // 文件缺失 = 无旁路，照常走 gh
  assert.equal(getGitHubVariable('GHVAR_TEST_FILE_MISSING', { fetch: () => 'from-gh', sleep: noSleep }), 'from-gh');
  delete process.env.INFISICAL_AWS_CREDS_FILE;
});

test('gh 前两次失败第三次成功 → 返回值，重试次数 = 失败数', () => {
  let calls = 0;
  const slept = [];
  const v = getGitHubVariable('GHVAR_TEST_RETRY', {
    fetch: () => { calls++; if (calls < 3) throw new Error('dial tcp 20.205.243.168:443: i/o timeout'); return 'third-time'; },
    retryDelaysMs: [7, 9],
    sleep: (ms) => slept.push(ms),
  });
  assert.equal(v, 'third-time');
  assert.equal(calls, 3);
  assert.deepEqual(slept, [7, 9]); // 每次失败后按表退避，成功后不再睡
});

test('重试耗尽 → 抛错：带变量名、尝试次数、旁路提示，不含 gh 参数以外的秘密', () => {
  let calls = 0;
  assert.throws(
    () => getGitHubVariable('GHVAR_TEST_EXHAUST', {
      fetch: () => { calls++; throw new Error('i/o timeout'); },
      retryDelaysMs: [0, 0],
      sleep: noSleep,
    }),
    (e) => /GHVAR_TEST_EXHAUST/.test(e.message) && /3 attempts/.test(e.message) && /INFISICAL_AWS_CREDS_FILE/.test(e.message) && /i\/o timeout/.test(e.message),
  );
  assert.equal(calls, 3);
});

test('成功一次后进程内缓存，同名再取不再打 gh', () => {
  let calls = 0;
  assert.equal(getGitHubVariable('GHVAR_TEST_CACHE', { fetch: () => { calls++; return 'v1'; }, sleep: noSleep }), 'v1');
  assert.equal(getGitHubVariable('GHVAR_TEST_CACHE', { fetch: () => { calls++; throw new Error('must not be called'); } }), 'v1');
  assert.equal(calls, 1);
});

test('失败不写缓存：耗尽后再调仍会重新尝试', () => {
  let calls = 0;
  assert.throws(() => getGitHubVariable('GHVAR_TEST_NOCACHE', { fetch: () => { calls++; throw new Error('x'); }, retryDelaysMs: [], sleep: noSleep }));
  assert.equal(getGitHubVariable('GHVAR_TEST_NOCACHE', { fetch: () => { calls++; return 'ok'; }, sleep: noSleep }), 'ok');
  assert.equal(calls, 2);
});

test('默认退避表：3 次尝试（2 个间隔），总等待在秒级', () => {
  assert.equal(GH_VARIABLE_RETRY_DELAYS_MS.length, 2);
  const total = GH_VARIABLE_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
  assert.ok(total >= 1000 && total <= 10000, `total backoff ${total}ms`);
});

// ── 真实 execFileSync 路径：用 tests/fixtures/fake-gh.sh 顶替 gh ────────────────
const FAKE_GH = path.resolve(__dirname, 'fixtures', 'fake-gh.sh');
const skipOnWin = process.platform === 'win32' ? { skip: 'bash fixture' } : {};

function withCallLog(fn) {
  const log = path.join(os.tmpdir(), `fake-gh-calls-${process.pid}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(log, '');
  process.env.FAKE_GH_CALLS = log;
  try { return fn(() => fs.readFileSync(log, 'utf-8').trim().split('\n').filter(Boolean)); }
  finally { delete process.env.FAKE_GH_CALLS; fs.unlinkSync(log); }
}

test('真 gh 路径：成功取值并 trim', skipOnWin, () => {
  withCallLog((calls) => {
    assert.equal(getGitHubVariable('OK', { bin: FAKE_GH, sleep: noSleep }), 'value-from-fake-gh');
    assert.equal(calls().length, 1);
    assert.match(calls()[0], /^OK api repos\/Optima-Chat\/optima-dev-skills\/actions\/variables\/OK --jq \.value$/);
  });
});

test('真 gh 路径：404 不重试、报错含 variable= 与 HTTP 404', skipOnWin, () => {
  withCallLog((calls) => {
    assert.throws(
      () => getGitHubVariable('NOPE', { bin: FAKE_GH, retryDelaysMs: [0, 0], sleep: noSleep }),
      (e) => /1 attempt failed/.test(e.message) && /variable=NOPE/.test(e.message) && /HTTP 404/.test(e.message),
    );
    assert.equal(calls().length, 1);
  });
});

test('真 gh 路径：未登录不重试', skipOnWin, () => {
  withCallLog((calls) => {
    assert.throws(() => getGitHubVariable('NOAUTH', { bin: FAKE_GH, retryDelaysMs: [0, 0], sleep: noSleep }), /gh auth login/);
    assert.equal(calls().length, 1);
  });
});

test('真 gh 路径：i/o timeout 类失败重试到成功', skipOnWin, () => {
  withCallLog((calls) => {
    assert.equal(getGitHubVariable('FLAKY', { bin: FAKE_GH, retryDelaysMs: [0, 0], sleep: noSleep }), 'flaky-ok');
    assert.equal(calls().length, 3);
  });
});

test('真 gh 路径：超时 → ETIMEDOUT/SIGTERM，可重试且不 hang', skipOnWin, () => {
  withCallLog((calls) => {
    const t0 = Date.now();
    assert.throws(
      () => getGitHubVariable('SLOW', { bin: FAKE_GH, timeoutMs: 300, retryDelaysMs: [0], sleep: noSleep }),
      (e) => /2 attempts failed/.test(e.message) && /ETIMEDOUT|SIGTERM/.test(e.message),
    );
    assert.equal(calls().length, 2);
    assert.ok(Date.now() - t0 < 5000, 'must not wait for the 30s sleep');
  });
});

test('真 gh 路径：stderr 里的 token 被清洗，argv 不回显', skipOnWin, () => {
  withCallLog(() => {
    assert.throws(
      () => getGitHubVariable('LEAKY', { bin: FAKE_GH, retryDelaysMs: [], sleep: noSleep }),
      (e) => !/ghp_secret123/.test(e.message) && !/repos\/Optima-Chat/.test(e.message),
    );
  });
});

test('isRetryableGhError：4xx(非429)/ENOENT/未登录不重试，429/5xx/网络错重试', () => {
  assert.equal(isRetryableGhError('gh api failed (exit=1 variable=X): gh: Not Found (HTTP 404)'), false);
  assert.equal(isRetryableGhError('gh api failed (exit=1): HTTP 403'), false);
  assert.equal(isRetryableGhError('gh api failed (code=ENOENT variable=X)'), false);
  assert.equal(isRetryableGhError('gh api failed (exit=4): please run: gh auth login'), false);
  assert.equal(isRetryableGhError('gh api failed (exit=1): HTTP 429'), true);
  assert.equal(isRetryableGhError('gh api failed (exit=1): HTTP 502'), true);
  assert.equal(isRetryableGhError('gh api failed (exit=1): dial tcp 20.205.243.168:443: i/o timeout'), true);
  assert.equal(isRetryableGhError('gh api failed (signal=SIGTERM code=ETIMEDOUT variable=X)'), true);
});

// ── getInfisicalConfig：env 旁路全有或全无 ──────────────────────────────────────
const INF = ['INFISICAL_URL', 'INFISICAL_CLIENT_ID', 'INFISICAL_CLIENT_SECRET', 'INFISICAL_PROJECT_ID'];
function clearInf() { for (const k of INF) delete process.env[k]; resetInfisicalConfigNoticesForTests(); }

test('getInfisicalConfig：四个 env 齐全 → source=env，不打 gh', () => {
  clearInf();
  process.env.INFISICAL_URL = 'https://u'; process.env.INFISICAL_CLIENT_ID = 'c'; process.env.INFISICAL_CLIENT_SECRET = 's'; process.env.INFISICAL_PROJECT_ID = 'p';
  const errs = [];
  const orig = console.error; console.error = (m) => errs.push(String(m));
  try {
    const cfg = getInfisicalConfig();
    assert.deepEqual(cfg, { url: 'https://u', clientId: 'c', clientSecret: 's', projectId: 'p', source: 'env' });
    getInfisicalConfig();
    assert.equal(errs.filter((m) => /Infisical config from env/.test(m)).length, 1); // 来源提示只打一次
  } finally { console.error = orig; clearInf(); }
});

test('getInfisicalConfig：只配一部分 → 整体忽略 env、四个全走 gh、source=github、stderr 提示一次', skipOnWin, () => {
  clearInf();
  process.env.INFISICAL_CLIENT_ID = 'from-service-container'; // 模拟 source 了某服务 .env
  const errs = [];
  const orig = console.error; console.error = (m) => errs.push(String(m));
  try {
    withCallLog((calls) => {
      // fake gh 对未知名字 exit 2 → 首个变量即抛；抛前 warn 已打出、且确实没有拿 env 里那个 CLIENT_ID 短路。
      assert.throws(() => getInfisicalConfig({ bin: FAKE_GH, retryDelaysMs: [], sleep: noSleep }), /INFISICAL_URL/);
      assert.equal(calls().length, 1); // 首个变量 INFISICAL_URL 就走了 gh（未用 env 里的 CLIENT_ID）
      assert.ok(errs.some((m) => /only 1\/4/.test(m) && /missing INFISICAL_URL, INFISICAL_CLIENT_SECRET, INFISICAL_PROJECT_ID/.test(m)), errs.join('\n'));
    });
  } finally { console.error = orig; clearInf(); }
});

test('getInfisicalConfig：shell env 只带 1 个 + 凭证文件补齐其余 3 个 = 混血 → 仍整体走 gh', skipOnWin, () => {
  clearInf();
  const f = path.join(os.tmpdir(), `ghvar-mixed-${process.pid}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(f, ['INFISICAL_URL=https://file-url', 'INFISICAL_CLIENT_ID=file-id', 'INFISICAL_CLIENT_SECRET=file-secret', 'INFISICAL_PROJECT_ID=file-proj', ''].join('\n'), { mode: 0o600 });
  process.env.INFISICAL_AWS_CREDS_FILE = f;
  process.env.INFISICAL_CLIENT_ID = 'service-container-identity';
  const errs = [];
  const orig = console.error; console.error = (m) => errs.push(String(m));
  try {
    withCallLog((calls) => {
      assert.throws(() => getInfisicalConfig({ bin: FAKE_GH, retryDelaysMs: [], sleep: noSleep }), /INFISICAL_URL/);
      assert.equal(calls().length, 1);
      assert.ok(errs.some((m) => /came from the shell env, the rest from the creds file/.test(m)), errs.join('\n'));
    });
  } finally {
    console.error = orig; clearInf(); fs.unlinkSync(f); delete process.env.INFISICAL_AWS_CREDS_FILE;
  }
});

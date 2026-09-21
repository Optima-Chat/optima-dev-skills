const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// 测编译产物（package bin 指向 dist/）——`npm test` 的 pretest 会先 build。
const { getGitHubVariable, GH_VARIABLE_RETRY_DELAYS_MS } = require(
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
  fs.writeFileSync(f, 'export GHVAR_TEST_FILE=from-file\n');
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

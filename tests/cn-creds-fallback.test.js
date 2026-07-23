const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Test the compiled dist artifact (package main/bin point at dist/) — run
// `npm run build` first (npm test's pretest does this).
const { loadCredsFileIntoEnv, readBuildboxPwFile } = require(
  path.resolve(__dirname, '..', 'dist', 'bin', 'helpers', 'db-utils.js'),
);

function tmpCreds(body) {
  const f = path.join(os.tmpdir(), `cn-creds-test-${process.pid}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(f, body);
  return f;
}

test('loadCredsFileIntoEnv 解析 export/裸 KEY=val 并去引号', () => {
  const f = tmpCreds([
    'export CN_CREDS_TEST_EMAIL=a@b.com',
    "CN_CREDS_TEST_PW='p @ss'",
    '# comment 行忽略',
    '',
  ].join('\n'));
  delete process.env.CN_CREDS_TEST_EMAIL;
  delete process.env.CN_CREDS_TEST_PW;
  try {
    loadCredsFileIntoEnv(f);
    assert.equal(process.env.CN_CREDS_TEST_EMAIL, 'a@b.com');
    assert.equal(process.env.CN_CREDS_TEST_PW, 'p @ss'); // 引号内空格保留、引号剥掉
  } finally {
    fs.unlinkSync(f);
    delete process.env.CN_CREDS_TEST_EMAIL;
    delete process.env.CN_CREDS_TEST_PW;
  }
});

test('已存在的 env 键优先，不被文件覆盖', () => {
  const f = tmpCreds('export CN_CREDS_TEST_KEEP=from_file\n');
  process.env.CN_CREDS_TEST_KEEP = 'from_env';
  try {
    loadCredsFileIntoEnv(f);
    assert.equal(process.env.CN_CREDS_TEST_KEEP, 'from_env');
  } finally {
    fs.unlinkSync(f);
    delete process.env.CN_CREDS_TEST_KEEP;
  }
});

test('文件不存在 = 静默无操作，不抛错', () => {
  assert.doesNotThrow(() => loadCredsFileIntoEnv(path.join(os.tmpdir(), 'definitely-not-here-xyz')));
});

test('引号值取到配对引号为止，行尾注释被忽略', () => {
  const f = tmpCreds('export CN_CREDS_TEST_QC="abc" # 备注\n');
  delete process.env.CN_CREDS_TEST_QC;
  try {
    loadCredsFileIntoEnv(f);
    assert.equal(process.env.CN_CREDS_TEST_QC, 'abc');
  } finally {
    fs.unlinkSync(f);
    delete process.env.CN_CREDS_TEST_QC;
  }
});

test('readBuildboxPwFile 读 OPTIMA_CN_BUILDBOX_PW_FILE 指定文件并 trim', () => {
  const f = tmpCreds('  s3cret\n');
  process.env.OPTIMA_CN_BUILDBOX_PW_FILE = f;
  try {
    assert.equal(readBuildboxPwFile(), 's3cret');
  } finally {
    fs.unlinkSync(f);
    delete process.env.OPTIMA_CN_BUILDBOX_PW_FILE;
  }
});

test('readBuildboxPwFile：文件不存在或为空 → undefined', () => {
  process.env.OPTIMA_CN_BUILDBOX_PW_FILE = path.join(os.tmpdir(), 'definitely-not-here-xyz');
  try {
    assert.equal(readBuildboxPwFile(), undefined);
  } finally {
    delete process.env.OPTIMA_CN_BUILDBOX_PW_FILE;
  }
  const empty = tmpCreds('\n');
  process.env.OPTIMA_CN_BUILDBOX_PW_FILE = empty;
  try {
    assert.equal(readBuildboxPwFile(), undefined);
  } finally {
    fs.unlinkSync(empty);
    delete process.env.OPTIMA_CN_BUILDBOX_PW_FILE;
  }
});

test('权限比 600 宽时往 stderr 警告（不抛错）', () => {
  const f = tmpCreds('export CN_CREDS_TEST_PERM=x\n');
  fs.chmodSync(f, 0o644);
  delete process.env.CN_CREDS_TEST_PERM;
  const orig = console.error;
  const lines = [];
  console.error = (msg) => lines.push(String(msg));
  try {
    loadCredsFileIntoEnv(f);
    assert.equal(process.env.CN_CREDS_TEST_PERM, 'x');
    assert.ok(lines.some((l) => l.includes('chmod 600')), `未见权限警告: ${JSON.stringify(lines)}`);
  } finally {
    console.error = orig;
    fs.unlinkSync(f);
    delete process.env.CN_CREDS_TEST_PERM;
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// 测编译产物（package bin 指向 dist/）——`npm test` 的 pretest 会先 build。
const { isAlreadyExistsError } = require(
  path.resolve(__dirname, '..', 'dist', 'bin', 'helpers', 'generate-test-token.js'),
);

const repoRoot = path.resolve(__dirname, '..');

// #78: cn-prod 上 `--email` 复用已有账号会失败。下面这条是 2026-08-13 直接
// curl cn-prod 注册端点拿到的**响应原文**（对已存在的邮箱）：既不是 409、也不含
// "already exists" —— 旧判定两个条件都不命中，于是 throw、整条命令挂掉。
//   POST https://auth.yzsgo.com/api/v1/auth/register/merchant
//   → HTTP 400 {"error":"Email already registered","status_code":400}
test('cn user-auth 的 400 + "Email already registered" 判为已存在（#78，实测原文）', () => {
  assert.equal(
    isAlreadyExistsError('HTTP 400: {"error":"Email already registered","status_code":400}'),
    true,
  );
  // 后端若换回 FastAPI 默认的 detail 包装，同样要命中（判定锚文案不锚字段名）。
  assert.equal(
    isAlreadyExistsError('HTTP 400: {"detail":"Email already registered"}'),
    true,
  );
});

test('AWS 侧 409 Conflict 仍判为已存在（不回归）', () => {
  assert.equal(isAlreadyExistsError('HTTP 409: {"detail":"User already exists"}'), true);
  // 409 但 body 措辞不同 —— 旧行为靠状态码单独命中，必须保住。
  assert.equal(isAlreadyExistsError('HTTP 409: {"detail":"Conflict"}'), true);
});

test('任意状态码 + already exists/registered 文案仍判为已存在（不回归）', () => {
  assert.equal(isAlreadyExistsError('HTTP 422: {"detail":"merchant already exists"}'), true);
  assert.equal(isAlreadyExistsError('HTTP 400: {"error":"Email already registered"}'), true);
});

test('真错误不被吞：认证失败 / 校验失败 / 网络错误一律 false', () => {
  assert.equal(isAlreadyExistsError('HTTP 401: {"detail":"Invalid credentials"}'), false);
  assert.equal(isAlreadyExistsError('HTTP 400: {"detail":"password too short"}'), false);
  assert.equal(isAlreadyExistsError('fetch failed'), false);
});

// 状态码判定必须锚在 message 开头，否则 body 里夹着的数字会误伤：下面这条
// 是 500，只因 body 里出现 409 就被当成「已存在」而静默吞掉，是真故障被掩盖。
test('body 里出现的 409 不算状态码（不误吞真故障）', () => {
  assert.equal(
    isAlreadyExistsError('HTTP 500: {"detail":"upstream returned 409 from partner"}'),
    false,
  );
});

// 上面所有断言都吃 httpRequest 抛出的 message 形状。它一旦改了，判定会静默失效
// （不报错、只是永远走 throw），故把模板本身钉住。
test('httpRequest 的错误 message 模板未漂（判定逻辑的前提）', () => {
  const source = fs.readFileSync(
    path.join(repoRoot, 'bin/helpers/generate-test-token.ts'),
    'utf8',
  );
  assert.match(
    source,
    /throw new Error\(`HTTP \$\{response\.status\}: \$\{text\}`\)/,
    'isAlreadyExistsError 依赖 `HTTP <status>: <body>` 这个 message 形状',
  );
});

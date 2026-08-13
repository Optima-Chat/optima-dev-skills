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

// 本工具调的 register/merchant 那条路径上，唯一的 409 是企业席位
// （user-auth app/services/user.py：account_type == ENTERPRISE_SEAT →
// 409 detail "email_bound_to_seat"）。
// 🔴 这条文案既不含 exists 也不含 registered —— 状态码腿是它的唯一命中路径。
// 把它钉在这里，是为了防止后人以为「409 从没真出现过」而删掉那条腿。
// ⚠️ 注意限定是「这条路径」：user-auth 全仓 409 有 20+ 处（referral / sms /
// teams / admin），语义完全不同，接新端点时别沿用本判定。
test('企业席位的 409 email_bound_to_seat 判为已存在（状态码腿的真实用途）', () => {
  assert.equal(isAlreadyExistsError('HTTP 409: {"detail":"email_bound_to_seat"}'), true);
  // 状态码腿对任何 409 放行（措辞无关），这是它区别于文案腿的意义所在。
  assert.equal(isAlreadyExistsError('HTTP 409: {"detail":"Conflict"}'), true);
});

// commerce-backend 重复建 merchant profile（第二处 catch 覆盖的场景）。
// 原文见 commerce-backend src/api/merchants.py：user.merchant_id 已存在时的分支。
test('commerce-backend 的 400 "Merchant profile already exists" 判为已存在', () => {
  assert.equal(
    isAlreadyExistsError('HTTP 400: {"detail":"Merchant profile already exists. Use PUT /api/merchants/me to update"}'),
    true,
  );
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

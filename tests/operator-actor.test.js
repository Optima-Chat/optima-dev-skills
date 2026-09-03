const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { operatorActorId } = require(
  path.resolve(__dirname, '..', 'dist', 'bin', 'helpers', 'operator.js'),
);

test('--operator flag 优先', () => {
  assert.equal(operatorActorId('jerry'), 'dev-skills:jerry');
});
test('空白 flag 回退本机用户名', () => {
  assert.equal(operatorActorId('  '), `dev-skills:${os.userInfo().username}`);
});
test('缺省（undefined/null）回退本机用户名', () => {
  assert.equal(operatorActorId(undefined), `dev-skills:${os.userInfo().username}`);
  assert.equal(operatorActorId(null), `dev-skills:${os.userInfo().username}`);
});

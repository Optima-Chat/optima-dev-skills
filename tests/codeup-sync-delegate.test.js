const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// tf#452:cn-deploy 的 Codeup 同步委托给服务仓 sync-to-codeup.yml,本机零私钥。测 dist(npm test 的 pretest 会先 build)。
const d = require(path.resolve(__dirname, '..', 'dist', 'bin', 'helpers', 'codeup-sync-delegate.js'));

const PULL = 'run: aliyun devops POST /repository/$ID/mirror --account x-access-token';
const PUSH = 'run: git push codeup HEAD:main  # CODEUP_PUSH_SSH_KEY';

function fakeGh(workflowText, dispatchOk = true) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'api') return workflowText == null ? { ok: false, out: '', err: 'HTTP 404' } : { ok: true, out: workflowText, err: '' };
    return dispatchOk ? { ok: true, out: '', err: '' } : { ok: false, out: '', err: 'HTTP 403: Must have admin rights' };
  };
  return { gh, calls };
}

test('pull-mirror 仓:无论目标分支 / tag,都在 main 上触发(用 main 上的新工作流)', () => {
  for (const [ref, isTag] of [['feat/x', false], ['cn-v1.2.3', true], ['main', false]]) {
    const { gh, calls } = fakeGh(PULL);
    assert.equal(d.delegateMirrorSync('optima-billing', ref, isTag, gh), 'main');
    assert.deepEqual(calls[1], ['workflow', 'run', 'sync-to-codeup.yml', '-R', 'Optima-Chat/optima-billing', '--ref', 'main']);
  }
});

test('push 式镜像仓:分支构建在目标分支上触发;tag 回到 main', () => {
  assert.equal(d.delegateMirrorSync('kb-skills', 'feat/x', false, fakeGh(PUSH).gh), 'feat/x');
  assert.equal(d.delegateMirrorSync('kb-skills', 'cn-v1.0.0', true, fakeGh(PUSH).gh), 'main');
});

test('fail-closed:没有工作流 / 触发被拒 ⇒ 抛错', () => {
  assert.throws(() => d.delegateMirrorSync('x', 'main', false, fakeGh(null).gh), /没有 sync-to-codeup.yml/);
  assert.throws(() => d.delegateMirrorSync('x', 'main', false, fakeGh(PULL, false).gh), /触发 .* 失败/);
});

test('isPushStyle:调 /mirror 的不算 push 式(user-auth 两种字样都有,按 pull-mirror 处理)', () => {
  assert.equal(d.isPushStyle(PULL), false);
  assert.equal(d.isPushStyle(PUSH), true);
  assert.equal(d.isPushStyle(PULL + '\n# 旧 push key CODEUP_PUSH_SSH_KEY 已不再使用'), false);
});

test('cn-deploy.ts:本机零私钥、不把任何令牌交给 Codeup', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'helpers', 'cn-deploy.ts'), 'utf8');
  assert.doesNotMatch(src, /['"]auth['"],\s*['"]token['"]/);
  assert.doesNotMatch(src, /TriggerRepositoryMirrorSync/);
  assert.doesNotMatch(src, /PRIVATE_KEY|mintCodeupMirrorToken|github-app-cred/);
  assert.match(src, /delegateMirrorSync\(svc\.repo, ref, Boolean\(vtag\)\)/);
  assert.equal(fs.existsSync(path.resolve(__dirname, '..', 'bin', 'helpers', 'github-app-cred.ts')), false);
});

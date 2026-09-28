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

test('一律在 main 上触发(pull-mirror 与 push --mirror 式都整仓同步;分支里的旧工作流跑不起来)', () => {
  for (const wf of [PULL, PUSH]) {
    const { gh, calls } = fakeGh(wf);
    assert.equal(d.delegateMirrorSync('kb-skills', gh), 'main');
    assert.deepEqual(calls[1], ['workflow', 'run', 'sync-to-codeup.yml', '-R', 'Optima-Chat/kb-skills', '--ref', 'main']);
  }
});

test('fail-closed:没有工作流 / 触发被拒 ⇒ 抛错', () => {
  assert.throws(() => d.delegateMirrorSync('x', fakeGh(null).gh), /没有 sync-to-codeup.yml/);
  assert.throws(() => d.delegateMirrorSync('x', fakeGh(PULL, false).gh), /触发 .* 失败/);
});

test('cn-deploy.ts:本机零私钥、不把任何令牌交给 Codeup', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'helpers', 'cn-deploy.ts'), 'utf8');
  assert.doesNotMatch(src, /['"]auth['"],\s*['"]token['"]/);
  assert.doesNotMatch(src, /TriggerRepositoryMirrorSync/);
  assert.doesNotMatch(src, /PRIVATE_KEY|mintCodeupMirrorToken|github-app-cred/);
  assert.match(src, /delegateMirrorSync\(svc\.repo\)/);
  assert.equal(fs.existsSync(path.resolve(__dirname, '..', 'bin', 'helpers', 'github-app-cred.ts')), false);
});

test('cn-deploy.ts 同步段:委托调用不被吞异常,轮询判据是 Codeup HEAD === GitHub sha(#122 审阅 N2)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'helpers', 'cn-deploy.ts'), 'utf8');
  const seg = src.slice(src.indexOf('// 1. GitHub HEAD'), src.indexOf('// 2.'));
  assert.ok(seg.length > 0, '找不到同步段');
  assert.match(seg, /const on = delegateMirrorSync\(svc\.repo\);/);
  assert.doesNotMatch(seg, /\bcatch\b|\btry\s*\{/);
  assert.match(seg, /b\?\.result\?\.commit\?\.id === ghSha\) \{ synced = true; break; \}/);
  assert.match(seg, /if \(!synced\) \{ console\.error\(.*\); process\.exit\(1\); \}/);
});

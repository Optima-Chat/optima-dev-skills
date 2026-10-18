const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cli = process.env.CN_DEPLOY_TEST_CLI || path.resolve(__dirname, '../dist/bin/helpers/cn-deploy.js');
const deployHint = 'SAE 部署走 optima-auth 仓 oa143-sae-deploy-image.sh / terraform image_tag';

function run(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-deploy-start-'));
  const log = path.join(dir, 'calls.jsonl');
  const stub = `#!${process.execPath}\n` + String.raw`
const fs = require('node:fs'), path = require('node:path');
const bin = path.basename(process.argv[1]), args = process.argv.slice(2);
const log = process.env.CALL_LOG, options = JSON.parse(process.env.STUB_OPTIONS);
const previous = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [];
fs.appendFileSync(log, JSON.stringify({ bin, args, time: Date.now() }) + '\n');
const action = args[1], nth = previous.filter(c => c.bin === bin && c.args[1] === action).length + 1;
const value = flag => args[args.indexOf('--' + flag) + 1];
const emit = data => console.log(JSON.stringify(data));
if (options.action) { console.log('broken'); process.exit(0); }
if (bin === 'gh') {
  console.log(args.join(' ').includes('/commits/') ? 'a'.repeat(40) : 'run: git push codeup HEAD:main');
} else if (args[0] === 'sae') {
  emit({ Data: { ImageUrl: options.imageUrl || 'registry/image:aaaaaaaaaa' } });
} else if (action === 'ListRepositories') {
  if (nth <= (options.readFailures || 0)) console.log('broken');
  else emit({ result: [{ name: 'optima-gateway', Id: 1 }, { name: 'optima-auth', Id: 2 }, { name: 'optima-billing', Id: 3 }] });
} else if (['GetBranchInfo', 'GetRepositoryTag'].includes(action)) {
  if (options.mirrorFailures && nth >= 2 && nth <= 4) console.log('broken');
  else emit({ result: { commit: { id: options.mirrorFailures && nth === 1 ? 'old' : 'a'.repeat(40) } } });
} else if (action === 'ListPipelines') {
  emit({ pipelines: ['stage', 'prod'].map(env => ({
    pipelineName: (options.service || 'agent-runtime') + '-cn-' + env,
    pipelineId: env === 'prod' ? 5332501 : 123,
  })) });
} else if (action === 'StartPipelineRun') {
  if (options.start === 'valid' || nth > 1) emit({ pipelineRunId: 999 });
  else if (options.start === 'exit') process.exit(1);
  else if (options.start !== 'empty') console.log('broken');
} else if (action === 'ListPipelineRuns') {
  if (options.listBroken) { console.log('broken'); process.exit(0); }
  if (options.listError) { emit({ success: false }); process.exit(0); }
  const start = Number(value('startTime')), end = Number(value('endTime'));
  const all = [{ pipelineRunId: 90, startTime: start - 1 },
    ...Array.from({ length: options.matches ?? 1 }, (_, i) => ({ pipelineRunId: 112 + i, startTime: end })),
    { pipelineRunId: 91, startTime: end + 1 }];
  if (options.paginate) {
    emit({ success: true, pipelineRuns: value('nextToken') === '0' ? all.slice(0, 2) : all.slice(2),
      nextToken: value('nextToken') === '0' ? 'page2' : '' });
  } else emit({ success: true, pipelineRuns: all, nextToken: '' });
} else if (action === 'GetPipelineRun') {
  if (options.pollFailures && nth >= 2 && nth <= 4) console.log('broken');
  else emit({ pipelineRun: { status: options.pollFailures && nth === 1 ? 'RUNNING' : options.status || 'SUCCESS' } });
} else console.log('broken');
`;
  for (const bin of ['gh', 'aliyun']) fs.writeFileSync(path.join(dir, bin), stub, { mode: 0o755 });
  // Keep the real polling loops, but skip their 10s/45s delays in the child CLI.
  const fastTimers = path.join(dir, 'fast-timers.cjs');
  fs.writeFileSync(fastTimers, 'const timer = global.setTimeout; global.setTimeout = (fn, ms, ...args) => timer(fn, 0, ...args);');
  try {
    const args = options.action
      ? ['-e', 'console.log(JSON.stringify(require(process.argv[1]).devops(process.argv[2], {})))', cli, options.action]
      : ['--require', fastTimers, cli, options.service || 'agent-runtime', ...(options.wait ? [] : ['--no-wait']), ...(options.args || [])];
    const result = spawnSync(process.execPath, args, {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH,
        CALL_LOG: log, STUB_OPTIONS: JSON.stringify(options) },
    });
    assert.ifError(result.error);
    return { ...result, calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [] };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const callsFor = (result, action) => result.calls.filter(c => c.bin === 'aliyun' && c.args[1] === action);

for (const start of ['invalid', 'empty', 'exit']) {
  test(`Start ${start} response: one call, recover exactly one run and print its id`, () => {
    const result = run({ start, matches: 1 });
    assert.equal(callsFor(result, 'StartPipelineRun').length, 1);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /run#112 已启动/);
    assert.doesNotMatch(result.stdout, /run#999/);
    const query = callsFor(result, 'ListPipelineRuns')[0].args;
    const startTime = Number(query[query.indexOf('--startTime') + 1]);
    const endTime = Number(query[query.indexOf('--endTime') + 1]);
    assert.ok(startTime <= callsFor(result, 'StartPipelineRun')[0].time);
    assert.ok(endTime >= startTime);
    assert.equal(query[query.indexOf('--pipelineId') + 1], '123');
  });
}

test('Start parse failure with zero matches exits without resending Start', () => {
  const result = run({ matches: 0 });
  assert.equal(callsFor(result, 'StartPipelineRun').length, 1);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /0 条 run.*不会重试启动/);
  assert.doesNotMatch(result.stdout, /已启动/);
});

test('two matches across pages list every candidate and never cancel a run', () => {
  const result = run({ matches: 2, paginate: true });
  assert.equal(callsFor(result, 'StartPipelineRun').length, 1);
  assert.equal(result.status, 1);
  assert.equal(callsFor(result, 'ListPipelineRuns').length, 2);
  assert.match(result.stderr, /runId: 112, 113.*人工处理/);
  assert.ok(!result.calls.some(c => /^(Stop|Cancel)/.test(c.args[1])));
});

test('valid Start response bypasses recovery', () => {
  const result = run({ start: 'valid' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(callsFor(result, 'StartPipelineRun').length, 1);
  assert.equal(callsFor(result, 'ListPipelineRuns').length, 0);
  assert.match(result.stdout, /run#999 已启动/);
});

test('read-only API still retries parse failures and succeeds on third attempt', () => {
  const result = run({ start: 'valid', readFailures: 2 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(callsFor(result, 'ListRepositories').length, 3);
});

test('polling continues after three malformed responses mid-run and reaches SUCCESS', () => {
  const result = run({ start: 'valid', wait: true, pollFailures: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(callsFor(result, 'GetPipelineRun').length, 5);
  assert.equal(callsFor(result, 'StartPipelineRun').length, 1);
  assert.equal(callsFor(result, 'ListPipelineRuns').length, 0);
  assert.match(result.stdout, /run#999 已启动/);
  assert.match(result.stdout, /run#999: SUCCESS/);
});

for (const [action, args] of [['GetBranchInfo', []], ['GetRepositoryTag', ['--vtag', 'cn-v1.2.3']]]) {
  test(`mirror ${action} continues after three malformed responses and catches up`, () => {
    const result = run({ start: 'valid', mirrorFailures: true, args });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(callsFor(result, action).length, 5);
    assert.equal(callsFor(result, 'StartPipelineRun').length, 1);
    const mirrorCalls = callsFor(result, action);
    assert.ok(mirrorCalls.at(-1).time <= callsFor(result, 'StartPipelineRun')[0].time);
    assert.match(result.stdout, /mirror 已追平/);
    assert.match(result.stdout, /run#999 已启动/);
  });
}

for (const action of ['StartPipelineRun', 'StopPipelineRun', 'CreatePipeline', 'UpdatePipeline']) {
  test(`${action} does not retry malformed responses`, () => {
    const result = run({ action });
    assert.equal(result.status, 1);
    assert.equal(callsFor(result, action).length, 1);
  });
}
for (const action of ['ListPipelines', 'GetPipelineRun']) {
  test(`${action} prefix retains three attempts on malformed responses`, () => {
    const result = run({ action });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {});
    assert.equal(callsFor(result, action).length, 3);
  });
}

test('unreadable recovery list exits after read retries without resending Start', () => {
  const result = run({ listBroken: true });
  assert.equal(result.status, 1);
  assert.equal(callsFor(result, 'StartPipelineRun').length, 1);
  assert.equal(callsFor(result, 'ListPipelineRuns').length, 3);
  assert.match(result.stderr, /ListPipelineRuns 查询失败/);
});

test('failed recovery list cannot be interpreted as zero or one matches', () => {
  const result = run({ listError: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ListPipelineRuns 查询失败/);
  assert.doesNotMatch(result.stdout, /已启动/);
});

const flag = (call, name) => call.args[call.args.indexOf('--' + name) + 1];
const saeCalls = result => result.calls.filter(c => c.bin === 'aliyun' && c.args[0] === 'sae');

for (const env of ['stage', 'prod']) {
  test(`optima-auth ${env} builds successfully without checking a stale SAE image`, () => {
    const vtag = env === 'prod' ? 'cn-v1.2.3' : '';
    const result = run({ service: 'optima-auth', start: 'valid', wait: true,
      args: ['--env', env, ...(vtag ? ['--vtag', vtag] : [])], imageUrl: 'registry/optima-auth:old' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.calls.some(c => c.bin === 'gh' && c.args.includes(`repos/Optima-Chat/optima-auth/commits/${vtag || 'main'}`)));
    const starts = callsFor(result, 'StartPipelineRun');
    assert.equal(starts.length, 1);
    const pipelineId = env === 'prod' ? '5332501' : '123';
    assert.equal(flag(starts[0], 'pipelineId'), pipelineId);
    assert.equal(flag(callsFor(result, 'GetPipelineRun')[0], 'pipelineId'), pipelineId);
    if (vtag) {
      assert.deepEqual(JSON.parse(flag(starts[0], 'params')), {
        runningTags: { 'https://codeup.aliyun.com/6a17b6282bf8b1184fc0e0c6/optima-auth.git': vtag },
        envs: { VTAG: vtag },
      });
      assert.equal(flag(callsFor(result, 'GetRepositoryTag')[0], 'tagName'), vtag);
      assert.equal(callsFor(result, 'GetBranchInfo').length, 0);
    }
    assert.deepEqual(saeCalls(result), []);
    assert.match(result.stdout, /run#999: SUCCESS/);
    assert.ok(result.stdout.trim().split('\n').at(-1).includes(deployHint));
    assert.match(result.stdout, /SUCCESS\(build-only\).*仅构建推 ACR/);
    assert.doesNotMatch(result.stdout, /SAE ImageUrl|ALIYUN_AGENT_RUNTIME_IMAGE|repin|soft drain|构建→迁移→digest 部署/);
  });

  test(`optima-auth ${env} --no-wait prints its separate deployment path without claiming success`, () => {
    const result = run({ service: 'optima-auth', start: 'valid',
      args: ['--env', env, ...(env === 'prod' ? ['--vtag', 'cn-v1.2.3'] : [])] });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(deployHint));
    assert.equal(callsFor(result, 'GetPipelineRun').length, 0);
    assert.deepEqual(saeCalls(result), []);
    assert.doesNotMatch(result.stdout, /SUCCESS|digest 部署/);
  });

  test(`optima-auth ${env} failed build still exits nonzero`, () => {
    const result = run({ service: 'optima-auth', start: 'valid', wait: true, status: 'FAIL',
      args: ['--env', env, ...(env === 'prod' ? ['--vtag', 'cn-v1.2.3'] : [])] });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /run#999: FAIL/);
    assert.doesNotMatch(result.stdout, /SUCCESS/);
    assert.deepEqual(saeCalls(result), []);
  });
}

for (const [args, error] of [
  [['--env', 'prod'], /必须带 --vtag/],
  [['--env', 'prod', '--vtag', 'v1.2.3'], /vtag 格式必须/],
  [['--env', 'prod', '--vtag', 'cn-v1.2.3', '--branch', 'feat/test'], /不接受 --branch/],
]) {
  test(`optima-auth retains prod input validation (${args.join(' ')})`, () => {
    const result = run({ service: 'optima-auth', args });
    assert.equal(result.status, 1);
    assert.match(result.stderr, error);
    assert.deepEqual(result.calls, []);
  });
}

test('agent-runtime retains its build-only release guidance', () => {
  const result = run({ start: 'valid', wait: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SUCCESS\(build-only\).*staging Infisical ALIYUN_AGENT_RUNTIME_IMAGE.*repin.*soft drain/);
  assert.ok(!result.stdout.includes(deployHint));
  assert.deepEqual(saeCalls(result), []);
});

for (const [env, imageUrl, status] of [
  ['stage', 'registry/billing:old', 1],
  ['stage', 'registry/billing:aaaaaaaaaa', 0],
  ['prod', 'registry/billing@sha256:abc', 0],
  ['prod', 'registry/billing:aaaaaaaaaa', 1],
]) {
  test(`billing retains ${env} SAE verification (${imageUrl})`, () => {
    const result = run({ service: 'billing', start: 'valid', wait: true, imageUrl,
      args: ['--env', env, ...(env === 'prod' ? ['--vtag', 'cn-v1.2.3'] : [])] });
    assert.equal(result.status, status, result.stderr);
    assert.equal(saeCalls(result).length, 1);
    assert.equal(flag(saeCalls(result)[0], 'AppId'), env === 'prod'
      ? '6c31cf82-8802-4d45-b6a2-e9d7c83ccce9' : '09d8e292-dc64-4af8-bce5-0a56cb666921');
    assert.match(result.stdout, /SAE ImageUrl/);
  });
}

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const secret = 'ghs_SHOULD_NEVER_APPEAR';

function run(service, fail = false, prod = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-shim-cli-'));
  const log = path.join(dir, 'calls.jsonl');
  const stub = `#!${process.execPath}\n` + String.raw`
const fs=require('fs'),path=require('path');
const bin=path.basename(process.argv[1]), a=process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG,JSON.stringify({bin,args:a})+'\n');
if(bin==='python3') {
 if (!fs.existsSync(a[0])) process.exit(4);
 if(process.env.FAIL_REFRESH==='1') {console.error('ghs_SHOULD_NEVER_APPEAR');process.exit(3);}
 process.exit(0);
}
if(bin==='gh') {
 if(a[0]==='api') console.log(a.join(' ').includes('/commits/') ? 'a'.repeat(40) : 'run: git push codeup HEAD:main');
 process.exit(0);
}
const action=a[1];
const data=action==='ListRepositories'?{result:[{name:'optima-gateway',Id:1}]}:
 ['GetBranchInfo','GetRepositoryTag'].includes(action)?{result:{commit:{id:'a'.repeat(40)}}}:
 action==='ListPipelines'?{pipelines:['agent-runtime','gateway-core'].flatMap(s=>['stage','prod'].map(e=>({pipelineName:s+'-cn-'+e,pipelineId:e==='stage'?5124962:5124970})))}:
 action==='StartPipelineRun'?{pipelineRunId:7}:{};
console.log(JSON.stringify(data));
`;
  for (const name of ['gh','aliyun','python3']) fs.writeFileSync(path.join(dir,name),stub,{mode:0o755});
  try {
    const args = [(process.env.SHIM_TEST_CLI || path.join(root,'dist/bin/helpers/cn-deploy.js')),service,'--no-wait'];
    if(prod) args.push('--env','prod','--vtag','cn-v1.2.3');
    const p=spawnSync(process.execPath,args,{env:{...process.env,PATH:dir+path.delimiter+process.env.PATH,
      CALL_LOG:log,FAIL_REFRESH:fail?'1':'0'},encoding:'utf8',timeout:10000});
    return {...p,calls:fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse)};
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}

test('agent-runtime starts without token refresh or local Python, in both environments',()=>{
  for(const prod of [false,true]) {
    // The obsolete refresh command would fail and print a fake secret if invoked.
    const p=run('agent-runtime',true,prod);
    assert.equal(p.status,0,p.stderr);
    assert.ok(!p.calls.some(c=>c.bin==='python3'));
    const start=p.calls.find(c=>c.args[1]==='StartPipelineRun');
    assert.ok(start);
    assert.ok(!JSON.stringify(start).includes('OPTIMA_SHIM_GITHUB_TOKEN'));
    assert.ok(!(p.stdout+p.stderr).includes(secret));
  }
});
test('other services keep original path and do not invoke helper',()=>{
  const p=run('gateway-core',true);
  assert.equal(p.status,0,p.stderr);
  assert.ok(!p.calls.some(c=>c.bin==='python3'));
  assert.ok(p.calls.some(c=>c.args[1]==='StartPipelineRun'));
});

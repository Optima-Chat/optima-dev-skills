/**
 * tf#452(Optima-Chat/optima-terraform#452):触发 Codeup 镜像同步 = 委托给服务仓自己的 `sync-to-codeup.yml`。
 *
 * owner 09-28:「为啥我要给他私钥,我直接给他办了不行吗」⇒ 本机零私钥、零 App 凭证。
 * 做法:用运行人本机的 gh 登录 `gh workflow run sync-to-codeup.yml`(令牌只在本机用,不交给任何第三方存储);
 * 工作流在 GitHub Actions 里用仓级 secret 的只读 App 私钥现换单仓令牌去触发 Codeup 同步。调用方随后轮询 Codeup
 * 直到追平(判据只看轮询——Codeup mirror 接口对无效令牌也回 success,09-28 实测)。
 * ⛔ 触发失败即报错(fail-closed),绝不回落到把个人令牌交给 Codeup。
 *
 * 选哪个 ref 触发:
 *  - pull-mirror 仓(工作流调 Codeup /mirror):Codeup 整仓拉取,恒在默认分支 main 上触发——工作流版本取 main 的
 *    (含 App 换令牌步骤);在旧分支上触发会跑那条分支里的旧工作流(读已删除的旧 secret)。
 *  - push 式镜像仓(工作流 git push 到 Codeup,如 kb-skills / optima-portals):push 的是触发 ref,⇒ 分支构建在目标分支上触发;
 *    tag(vtag)仍在 main 上触发(push 式工作流只推分支)。
 */
import { execFileSync } from 'node:child_process';

const ORG = 'Optima-Chat';
export const SYNC_WORKFLOW = 'sync-to-codeup.yml';

export type Gh = (args: string[]) => { ok: boolean; out: string; err: string };

export const ghCli: Gh = (args) => {
  try {
    return { ok: true, out: execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(), err: '' };
  } catch (e: any) {
    return { ok: false, out: '', err: String(e?.stderr || e?.message || e).trim().split('\n')[0] };
  }
};

/** 该仓的 sync-to-codeup.yml 是 push 式(git push 到 Codeup)还是 pull-mirror 式(调 Codeup /mirror)。读 main 上的文件。 */
export function isPushStyle(workflowText: string): boolean {
  return !/\/mirror\b|TriggerRepositoryMirrorSync/.test(workflowText) && /git push|CODEUP_PUSH_SSH_KEY/.test(workflowText);
}

export function dispatchRef(pushStyle: boolean, ref: string, isTag: boolean): string {
  return pushStyle && !isTag ? ref : 'main';
}

/** 触发同步;返回在哪个 ref 上触发。失败抛错(fail-closed)。 */
export function delegateMirrorSync(repo: string, ref: string, isTag: boolean, gh: Gh = ghCli): string {
  const wf = gh(['api', `repos/${ORG}/${repo}/contents/.github/workflows/${SYNC_WORKFLOW}`, '-H', 'Accept: application/vnd.github.raw']);
  if (!wf.ok || !wf.out) {
    throw new Error(`${repo} 没有 ${SYNC_WORKFLOW}(或 gh 未登录):${wf.err}。无法委托 Codeup 同步(tf#452,不回落个人令牌)`);
  }
  const on = dispatchRef(isPushStyle(wf.out), ref, isTag);
  const r = gh(['workflow', 'run', SYNC_WORKFLOW, '-R', `${ORG}/${repo}`, '--ref', on]);
  if (!r.ok) throw new Error(`触发 ${repo}/${SYNC_WORKFLOW}@${on} 失败:${r.err}(需要该仓 Actions 写权限)`);
  return on;
}

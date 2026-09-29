/**
 * tf#452(Optima-Chat/optima-terraform#452):触发 Codeup 镜像同步 = 委托给服务仓自己的 `sync-to-codeup.yml`。
 *
 * owner 09-28:「为啥我要给他私钥,我直接给他办了不行吗」⇒ 本机零私钥、零 App 凭证。
 * 做法:用运行人本机的 gh 登录 `gh workflow run sync-to-codeup.yml`(令牌只在本机用,不交给任何第三方存储);
 * 工作流在 GitHub Actions 里用仓级 secret 的只读 App 私钥现换单仓令牌去触发 Codeup 同步。调用方随后轮询 Codeup
 * 直到追平(判据只看轮询——Codeup mirror 接口对无效令牌也回 success,09-28 实测)。
 * ⛔ 触发失败即报错(fail-closed),绝不回落到把个人令牌交给 Codeup。
 *
 * 恒在默认分支 main 上触发:
 *  - pull-mirror 仓(工作流调 Codeup /mirror):Codeup 整仓拉取,分支 / tag 全带;
 *  - push 式镜像仓(kb-skills / optima-portals):工作流 `git push --mirror`,同样全分支 + tag。
 *  在目标分支上触发反而会跑那条分支里的旧工作流(多数还是托管 runner / 读已删除的旧 secret,跑不起来;
 *  #122 fresh 审阅 B1 逐分支核过),所以一律 main。
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

/** 触发同步(恒在 main);返回触发的 ref。失败抛错(fail-closed)。先读一次工作流文件,确认存在并给出清楚的报错。 */
export function delegateMirrorSync(repo: string, gh: Gh = ghCli): string {
  const wf = gh(['api', `repos/${ORG}/${repo}/contents/.github/workflows/${SYNC_WORKFLOW}`, '-H', 'Accept: application/vnd.github.raw']);
  if (!wf.ok || !wf.out) {
    throw new Error(`${repo} 没有 ${SYNC_WORKFLOW}(或 gh 未登录):${wf.err}。无法委托 Codeup 同步(tf#452,不回落个人令牌)`);
  }
  const on = 'main';
  const r = gh(['workflow', 'run', SYNC_WORKFLOW, '-R', `${ORG}/${repo}`, '--ref', on]);
  if (!r.ok) throw new Error(`触发 ${repo}/${SYNC_WORKFLOW}@${on} 失败:${r.err}(需要该仓 Actions 写权限)`);
  return on;
}

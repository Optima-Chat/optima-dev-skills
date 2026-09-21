// generate-test-token 铸号后的默认补额（gw#2797 E6）。
//
// 为什么：cn-stage 是真扣模式 + 止烧闸开着；2026-09-21 起 claude-opus-5 有价（premium 2.5），
// 新号只有 600「Free (CN) signup credits」≈ 1–2 轮 opus-5（单轮 p50≈83 / p90≈671 / 最大≈10.8k）。
// 不补的话验证跑到一半被挂起，现象是「会话莫名中断」，很难第一时间想到余额。
// 不改 billing 的注册赠送本身：600 是 Free 档的真实行为，零余额 / 新用户类验证要依赖它
// ⇒ 这类验证显式传 `--credits 0`。
//
// 只在 cn-stage 默认补；其它环境默认 0，且不允许经本工具补（prod 发放必须显式走 optima-grant-credits）。
export const CN_STAGE_DEFAULT_MINT_CREDITS = 20000;

export function resolveMintCredits(env: string, raw?: string | null): number {
  if (raw === undefined || raw === null) {
    return env === 'cn-stage' ? CN_STAGE_DEFAULT_MINT_CREDITS : 0;
  }
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`--credits 必须是 >= 0 的整数（收到 ${raw}）`);
  }
  const n = parseInt(raw.trim(), 10);
  if (n > 0 && env !== 'cn-stage') {
    throw new Error(`--credits 只支持 cn-stage（当前 ${env}）；其它环境请显式用 optima-grant-credits`);
  }
  return n;
}

/**
 * 补额「失败只告警、不中断」（dev-skills#107 review）：补额夹在「拿到 token」与「写 token 文件」之间，
 * 而下游 Infisical 取票是一次无重试的 curl ⇒ 抖一下就会「注册成功、token 有效，但脚本整体退出」，
 * 只能重注册、上一个号成孤儿。账号是不可恢复的成果，钱可以后补 ⇒ 补额失败只打一条带手动补额命令的告警。
 * @returns 成功时的 lot 信息；失败时 null（告警已经打出）
 */
export async function grantMintCreditsOrWarn(
  grant: () => Promise<{ credits: number; lotId: string }>,
  ctx: { email: string; credits: number; env: string },
  warn: (msg: string) => void = (m) => console.warn(m),
): Promise<{ credits: number; lotId: string } | null> {
  try {
    return await grant();
  } catch (e: any) {
    warn(`\n⚠️  补额失败（账号与 token 不受影响，照常输出）：${e?.message ?? e}\n` +
      `   手动补：optima-grant-credits ${ctx.email} --credits ${ctx.credits} --env ${ctx.env}`);
    return null;
  }
}


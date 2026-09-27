// #117：会员档位的唯一真相源是 billing `GET /api/internal/users/{id}/membership-status`
// （M2M）。user-auth `users.current_plan` 已不随订阅同步（cn 付费会员全是 free），
// 不要再拿它显示档位。
import { callBilling } from './billing-http';

export interface MembershipStatus {
  active: boolean; // plan.tierRank > 0 且订阅 active/trialing（free / trial 恒 false）
  planId: string | null; // 最高档的生效订阅（active/trialing 且未过期）；没有生效订阅时为 null（含已过期 / 已取消 / past_due）
  status: string | null;
}

export type MembershipRead = { ok: true; value: MembershipStatus } | { ok: false; error: string };

// 确认行现在出现在 ban/unban 等原本不经 billing 的命令里：billing 卡住时最多多等这么久
// （5xx 重试时每次尝试各自计时）。
export const MEMBERSHIP_TIMEOUT_MS = 8000;

export async function fetchMembershipStatus(env: string, userId: string): Promise<MembershipStatus> {
  const { body } = await callBilling<MembershipStatus>(
    env,
    'GET',
    `/api/internal/users/${encodeURIComponent(userId)}/membership-status`,
    undefined,
    { timeoutMs: MEMBERSHIP_TIMEOUT_MS },
  );
  return body;
}

/** 永不抛：读取失败只体现在返回值里——确认行是给人看的，不能挡住后续 lookup / 变更。 */
export async function readMembership(fetcher: () => Promise<MembershipStatus>): Promise<MembershipRead> {
  try {
    return { ok: true, value: await fetcher() };
  } catch (e) {
    // formatServiceError 的消息是「❌ Error [5xx] …\n   Response body …」——只留首行、去掉 ❌，
    // 确认行保持单行，也不让人误读成「操作失败」。
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.split('\n')[0].replace(/^❌\s*/, '').trim() };
  }
}

function formatMembership(m: MembershipRead): string {
  if (!m.ok) return `(读取失败: ${m.error})`;
  if (!m.value.planId) return '(无生效订阅)';
  return `${m.value.planId}(active=${m.value.active},status=${m.value.status})`;
}

export function formatTargetAccountLine(
  userId: string,
  identity: { phone: string | null; email: string | null },
  membership: MembershipRead,
): string {
  return (
    `🎯 目标账号: userId=${userId} 手机=${identity.phone || '(无)'} email=${identity.email || '(无)'} ` +
    `会员=${formatMembership(membership)}`
  );
}

/** `optima-account status` 的「订阅」行（格式沿用 #117 之前）。 */
export function formatSubscriptionLine(m: MembershipRead): string {
  if (!m.ok) return `(读取失败: ${m.error})`;
  return `active=${m.value.active} plan=${m.value.planId} status=${m.value.status}`;
}

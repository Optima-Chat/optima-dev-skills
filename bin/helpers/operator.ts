import { userInfo } from 'os';

// #429（Owner 拍板 3）：CLI 发放族自报操作者——informational，billing 信任 allowlist client
// 自述（actor 不参与授权）；不带 --operator 时回退本机用户名。缺省链最终兜底在 billing
// 侧（channel=client_id）。格式：dev-skills:<name>。
export function operatorActorId(operatorFlag?: string | null): string {
  const name = (operatorFlag ?? '').trim() || userInfo().username;
  return `dev-skills:${name}`;
}

// yzsgo-e2e 三态裁决纯函数（node --test 覆盖）。逻辑与 judge_workflow.js 内联副本保持一致。
function decideOutcome(votes) {
  const good = (votes || []).filter(Boolean);
  const n = good.length;
  const refuted = good.filter((v) => v.refuted).length;
  if (n === 0) return "needs_review";
  if (refuted === n) return "rejected";
  if (refuted > n / 2) return "needs_review";
  return "confirmed";
}
module.exports = { decideOutcome };

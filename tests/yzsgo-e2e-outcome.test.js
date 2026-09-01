const test = require("node:test");
const assert = require("node:assert/strict");
const { decideOutcome } = require("../.claude/skills/yzsgo-e2e/judge_outcome.js");

test("多数不反驳 → confirmed", () => {
  assert.equal(decideOutcome([{refuted:false},{refuted:false},{refuted:true}]), "confirmed");
});
test("全票反驳 → rejected", () => {
  assert.equal(decideOutcome([{refuted:true},{refuted:true},{refuted:true}]), "rejected");
});
test("过半但非全票反驳 → needs_review (split-vote)", () => {
  assert.equal(decideOutcome([{refuted:true},{refuted:true},{refuted:false}]), "needs_review");
});
test("全员失败(null) → needs_review", () => {
  assert.equal(decideOutcome([null,null,null]), "needs_review");
});

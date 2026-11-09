import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
const source = readFileSync(new URL("../lib/interviewTiming.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { maySubmitAfterSilence, END_OF_ANSWER, hasConfidentTranscript } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const base = { automatic: true, silentMs: 10000, requiredMs: 9000, now: 20000, deferUntil: 0, checking: false };
test("manual answers are never submitted by a pause", () => { assert.equal(maySubmitAfterSilence({ ...base, automatic: false, silentMs: 60000 }), false); });
test("automatic answers wait through the required silence", () => { assert.equal(maySubmitAfterSilence({ ...base, silentMs: 2600 }), false); assert.equal(maySubmitAfterSilence(base), true); });
test("a pending or negative completion judgment preserves thinking time", () => { assert.equal(maySubmitAfterSilence({ ...base, checking: true }), false); assert.equal(maySubmitAfterSilence({ ...base, deferUntil: 30000 }), false); });
test("a stalled completion request cannot hold an otherwise completed pause", () => {
  assert.equal(maySubmitAfterSilence({ ...base, checking: true, checkingMs: 1500 }), true);
  assert.equal(maySubmitAfterSilence({ ...base, checking: true, checkingMs: 500 }), false);
});
test("normal pauses can complete at 1.8 seconds while incomplete thoughts retain a bounded hold", () => {
  assert.equal(maySubmitAfterSilence({ ...base, silentMs: 1800, requiredMs: 1800 }), true);
  assert.equal(maySubmitAfterSilence({ ...base, silentMs: 1800, requiredMs: 1800, deferUntil: 22000 }), false);
});
test("explicit completion phrases do not confuse ordinary discussion of completed work", () => {
  assert.equal(END_OF_ANSWER.test("That is my approach. I'm done."), true);
  assert.equal(END_OF_ANSWER.test("That's all."), true);
  assert.equal(END_OF_ANSWER.test("When that work is done we deploy"), false);
  assert.equal(END_OF_ANSWER.test("I'm done with step one, and then"), false);
});
test("short final answers can be heard without requiring a long speech burst", () => {
  assert.equal(hasConfidentTranscript("No.", true, 300), true);
  assert.equal(hasConfidentTranscript("I don't know", true, 450), true);
  assert.equal(hasConfidentTranscript("I owned the rollout", true, 500), true);
  assert.equal(hasConfidentTranscript("I owned the rollout", false, 500), false);
  assert.equal(hasConfidentTranscript("noise", true, 50), false);
});

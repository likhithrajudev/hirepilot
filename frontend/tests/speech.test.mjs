import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../lib/speech.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { splitSpeech } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

test("long spoken replies preserve all words within the API limit", () => {
  const text = Array.from({ length: 220 }, (_, i) => `word${i}`).join(" ");
  const chunks = splitSpeech(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((s) => s.length <= 500 && s.length > 0));
  assert.equal(chunks.join(" "), text);
});

test("an unusually long identifier is never dropped", () => {
  const text = "x".repeat(1400);
  const chunks = splitSpeech(text);
  assert.ok(chunks.every((s) => s.length <= 500));
  assert.equal(chunks.join(""), text);
});

test("short and empty replies do not introduce extra requests", () => {
  assert.deepEqual(splitSpeech("   "), []);
  assert.deepEqual(splitSpeech("What was the trade-off?"), ["What was the trade-off?"]);
});

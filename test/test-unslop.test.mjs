import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkRuleExamples } from "unslop-core";
import { rules } from "../src/rules.mjs";
import { runTests, findMissingTests, TEST_FILE } from "../src/runner.mjs";

test("every rule catches its bad examples and passes its good ones", () => {
  assert.deepEqual(checkRuleExamples(rules), []);
});

test("test file detection", () => {
  for (const f of ["a.test.ts", "src/__tests__/a.tsx", "tests/test_a.py", "a_test.go", "LoginTests.swift", "RepoTest.kt"]) assert.ok(TEST_FILE.test(f), f);
  for (const f of ["src/a.ts", "testing.py", "contest.go", "latest.ts"]) assert.ok(!TEST_FILE.test(f), f);
});

async function project(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "test-unslop-"));
  for (const [f, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, f)), { recursive: true });
    await fs.writeFile(path.join(dir, f), body);
  }
  return dir;
}

test("find_missing_tests maps sources to tests", async () => {
  const dir = await project({ "src/price.ts": "export const p = 1", "src/price.test.ts": "", "src/cart.ts": "export const c = 1" });
  const r = await findMissingTests({ files: ["src"] }, dir);
  assert.equal(r.status, "MISSING");
  assert.deepEqual(r.missing.map((m) => m.file), [path.join("src", "cart.ts")]);
});

test("run_tests runs node --test and flags zero-test runs", async () => {
  const ok = await project({ "package.json": JSON.stringify({ scripts: { test: "node --test" } }), "a.test.mjs": "import { test } from 'node:test'; import assert from 'node:assert'; test('x', () => assert.equal(1 + 1, 2));" });
  assert.equal((await runTests({}, ok)).status, "PASS");
  const failing = await project({ "package.json": JSON.stringify({ scripts: { test: "node --test" } }), "a.test.mjs": "import { test } from 'node:test'; import assert from 'node:assert'; test('x', () => assert.equal(1, 2));" });
  assert.equal((await runTests({}, failing)).status, "FAIL");
  const none = await project({ "package.json": JSON.stringify({ scripts: { test: "node --test" } }) });
  assert.equal((await runTests({}, none)).status, "FAIL");
});

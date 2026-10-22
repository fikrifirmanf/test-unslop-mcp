#!/usr/bin/env node
import { run } from "unslop-core";
import { rules } from "./rules.mjs";
import { runTests, findMissingTests, TEST_FILE } from "./runner.mjs";

await run({
  packageUrl: new URL("../package.json", import.meta.url),
  skill: "test-unslop",
  description: "Test-quality anti-slop rules: tests that actually fail when the code is wrong (JS/TS, Python, Go, Swift, Kotlin/Java).",
  auditTool: "audit_test_slop",
  auditDescription:
    "Deterministically scans test files for fake or fragile tests: tests with no assertion, tautological assertions, swallowed failures and un-awaited rejects, .only, reasonless skips, existence-only assertions, fixed sleeps, snapshot-only files, mock-heavy files, real network calls, unseeded randomness and debug output.",
  rules,
  accept: (p) => TEST_FILE.test(p),
  tools: [
    {
      name: "run_tests",
      description:
        "Detects and runs the project's test runner (vitest, jest, node --test, npm test, pytest, go test, cargo test, swift test, flutter/dart test, gradle) and returns PASS/FAIL with the output tail. Treats 'exit 0 but zero tests ran' as FAIL. Run before claiming tests pass.",
      inputSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string", description: "Relative project dir (default '.')" },
          files: { type: "array", items: { type: "string" }, description: "Optional test files to run (JS runners, pytest, dart)" },
        },
      },
      handler: runTests,
    },
    {
      name: "find_missing_tests",
      description:
        "Maps changed source files (default: git changes) to their conventional test files (*.test.ts, __tests__/, test_*.py, *_test.go, *Tests.swift, *Test.kt) and lists source files with no test.",
      inputSchema: { type: "object", properties: { files: { type: "array", items: { type: "string" }, description: "Source files or directories. Omit to use git changes." } } },
      handler: findMissingTests,
    },
  ],
});

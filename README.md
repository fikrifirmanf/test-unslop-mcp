# test-unslop-mcp

> Stop fake AI-written tests: skill + MCP verifier that catches tests that cannot fail, runs your real test runner, and refuses to call a zero-test run a pass. JS/TS, Python, Go, Rust, Swift, Kotlin/Java.

[![npm](https://img.shields.io/npm/v/test-unslop-mcp?color=cb3837&logo=npm)](https://www.npmjs.com/package/test-unslop-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server-blue)](https://modelcontextprotocol.io)

An **agent skill** plus an **MCP server** in one package. The skill tells your coding agent what slop to avoid; the MCP tools then *deterministically verify* the result, so the agent can't just claim it's done.

Works with **Claude Code**, **Claude Desktop**, **Codex** and **Antigravity**.

## What it catches

| Rule | Severity | Catches |
| --- | --- | --- |
| `FOCUSED_TEST` | ERROR | .only / fit silently skips the rest of the suite in CI. Remove it. |
| `SKIPPED_TEST` | WARN | Skipped test without a reason. Fix it, delete it, or skip with a linked reason. |
| `TEST_WITHOUT_ASSERTION` | ERROR | Test never asserts anything: it passes as long as nothing throws. Assert on the result or side effect. |
| `TAUTOLOGICAL_ASSERTION` | ERROR | Assertion that can never fail (compares a value with itself or a literal with the same literal). |
| `SWALLOWED_TEST_FAILURE` | ERROR | Failure can't surface: an empty catch swallows assertion errors, or a rejects/resolves assertion is not awaited and never runs. |
| `WEAK_ASSERTION` | WARN | Existence-only assertion passes for almost any output. Assert the actual value or shape. |
| `SLEEP_IN_TEST` | WARN | Fixed sleep makes tests slow and flaky. Use fake timers, waitFor/findBy, polling with a timeout, or an awaited event. |
| `SNAPSHOT_ONLY` | WARN | Every assertion in this file is a snapshot: reviewers rubber-stamp snapshot diffs. Assert the behaviour that matters explicitly. |
| `MOCK_HEAVY` | WARN | Too many mocks. |
| `REAL_NETWORK_IN_TEST` | WARN | Unit test hits a real external URL: slow, flaky and non-hermetic. Stub with MSW/nock/respx/httptest or a local server. |
| `NONDETERMINISTIC_TEST_DATA` | WARN | Unseeded random test data makes failures irreproducible. Use fixed values or seed the generator. |
| `CONSOLE_IN_TEST` | WARN | Debug output left in tests. Assert on the value instead of printing it. |

`run_tests` auto-detects vitest, jest, `node --test`, `npm test`, pytest, `go test`, `cargo test`, `swift test`, flutter/dart and Gradle. Exiting 0 with zero tests executed is reported as `FAIL`.

Rules marked **ERROR** make the audit return `status: "FAIL"`; **WARN** is reported but does not fail.

## Quick start

### 1. Add the MCP server

```bash
# Claude Code
claude mcp add test-unslop -s user -- npx -y test-unslop-mcp

# Codex
codex mcp add test-unslop -- npx -y test-unslop-mcp
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`) and **Antigravity** (`~/.gemini/config/mcp_config.json`):

```json
{
  "mcpServers": {
    "test-unslop": {
      "command": "npx",
      "args": ["-y", "test-unslop-mcp"]
    }
  }
}
```

Restart the app afterwards.

### 2. Install the bundled skill

```bash
npx -y test-unslop-mcp install-skills        # clients that are installed
npx -y test-unslop-mcp install-skills --all  # every location
```

| Client | Location |
| --- | --- |
| Claude Code | `~/.claude/skills/` |
| Codex | `~/.codex/skills/` |
| Antigravity | `~/.gemini/config/skills/` (and `~/.gemini/antigravity/skills/` if present) |

Claude Desktop has no skills folder, so it receives the rules through the MCP prompt and the `load_*_rules` tool.

## MCP surface

| Kind | Name | Purpose |
| --- | --- | --- |
| Prompt | `test-unslop` | The full skill text, for GUI clients |
| Tool | `load_test_unslop_rules` | Returns the full test-unslop ruleset. Call before writing code if the test-unslop skill is not already loaded. |
| Tool | `audit_test_slop` | Deterministically scans test files for fake or fragile tests: tests with no assertion, tautological assertions, swallowed failures and un-awaited rejects, .only, reasonless skips, existence-only assertions, fixed sleeps, snapshot-only files, mock-heavy files, real network calls, unseeded randomness and debug output. Accepts files or directories; with no files it audits the git working-tree changes. Suppress a verified false positive with a `unslop-ignore RULE_ID -- reason` comment on or above the line. |
| Tool | `run_tests` | Detects and runs the project's test runner (vitest, jest, node --test, npm test, pytest, go test, cargo test, swift test, flutter/dart test, gradle) and returns PASS/FAIL with the output tail. Treats 'exit 0 but zero tests ran' as FAIL. Run before claiming tests pass. |
| Tool | `find_missing_tests` | Maps changed source files (default: git changes) to their conventional test files (*.test.ts, __tests__/, test_*.py, *_test.go, *Tests.swift, *Test.kt) and lists source files with no test. |

File paths resolve against the server's working directory and cannot escape it. Directories honour `.gitignore` and skip `node_modules`, build output and minified files.

## CLI and CI

The same audit runs without an agent. It exits `1` on any ERROR, so it works as a pre-commit hook or CI step:

```bash
npx -y test-unslop-mcp audit              # git working-tree changes
npx -y test-unslop-mcp audit src app      # files or directories
npx -y test-unslop-mcp audit src --json   # machine-readable
npx -y test-unslop-mcp rules              # list every rule
```

## Suppressing a false positive

The checks are regex and structure based: fast, offline and predictable, but heuristic. For a verified false positive, add a comment on the line or the line above, **with a reason**:

```js
// unslop-ignore FOCUSED_TEST -- why this is safe here
```

Suppressions without a reason are reported as `SUPPRESSION_WITHOUT_REASON` errors, and every honoured suppression is listed in the audit output so reviewers can see it.

## How it works

1. The agent loads the skill and writes code under its constraints.
2. Before finishing, the skill requires the audit and verification tools.
3. On `FAIL`, the agent fixes every finding and re-runs until `PASS`. Missing toolchains are reported as `SKIPPED`, never as passing.

## The unslop family

- [`backend-unslop-mcp`](https://github.com/fikrifirmanf/backend-unslop-mcp)
- [`frontend-unslop-mcp`](https://github.com/fikrifirmanf/frontend-unslop-mcp)
- [`ui-unslop-mcp`](https://github.com/fikrifirmanf/ui-unslop-mcp)
- [`mobile-unslop-mcp`](https://github.com/fikrifirmanf/mobile-unslop-mcp)
- [`copy-unslop-mcp`](https://github.com/fikrifirmanf/copy-unslop-mcp)

All share the engine in [`unslop-core`](https://github.com/fikrifirmanf/unslop-core).

## Development

```bash
git clone https://github.com/fikrifirmanf/test-unslop-mcp
cd test-unslop-mcp && npm install
npm test                   # every rule is checked against its good/bad examples
node src/server.mjs        # speaks MCP over stdio
```

## License

MIT © Fikri Firman Fadilah

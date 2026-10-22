import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { runCheck, projectDir, localBin, collectFiles, inside } from "unslop-core";

export const TEST_FILE = /(?:^|[/\\])(?:__tests__|tests?|spec)[/\\][^/\\]+\.\w+$|[._-](?:test|spec)\.[cm]?[jt]sx?$|(?:^|[/\\])test_[^/\\]+\.py$|_test\.(?:py|go|dart)$|(?:Tests?|Spec)\.(?:swift|kt|java)$/;
const SOURCE = /\.(?:[cm]?[jt]sx?|py|go|rs|swift|kt|java|dart|rb)$/;

// Lines that mean "zero tests ran" across runners. Agents often report success here.
const NO_TESTS = /no tests? (?:found|ran|to run)|0 (?:tests?|passed|specs?)(?: \w+)? in|collected 0 items|No test files found|testing: warning: no tests to run|Executed 0 tests|tests 0\b/i;

async function detect(cwd, root, files) {
  const has = (f) => existsSync(path.join(cwd, f));
  if (has("package.json")) {
    const pkg = JSON.parse(await fs.readFile(path.join(cwd, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const js = files.filter((f) => /\.[cm]?[jt]sx?$/.test(f));
    const vitest = localBin(cwd, root, "vitest");
    if (vitest && "vitest" in deps) return { runner: "vitest", cmd: vitest, args: ["run", ...js] };
    const jest = localBin(cwd, root, "jest");
    if (jest && "jest" in deps) return { runner: "jest", cmd: jest, args: ["--ci", ...js] };
    const script = pkg.scripts?.test;
    if (script && !/no test specified/.test(script)) {
      if (/node\s+--test/.test(script)) return { runner: "node:test", cmd: process.execPath, args: ["--test", ...js] };
      return { runner: "npm test", cmd: "npm", args: ["test", "--silent", ...(js.length ? ["--", ...js] : [])] };
    }
  }
  if (has("pyproject.toml") || has("pytest.ini") || has("setup.cfg") || files.some((f) => f.endsWith(".py"))) {
    return { runner: "pytest", cmd: "python3", args: ["-m", "pytest", "-q", ...files.filter((f) => f.endsWith(".py"))] };
  }
  if (has("go.mod")) return { runner: "go test", cmd: "go", args: ["test", "./..."] };
  if (has("Cargo.toml")) return { runner: "cargo test", cmd: "cargo", args: ["test", "--quiet"] };
  if (has("Package.swift")) return { runner: "swift test", cmd: "swift", args: ["test"] };
  if (has("pubspec.yaml")) return { runner: "flutter test", cmd: has("android") || has("ios") ? "flutter" : "dart", args: ["test", ...files.filter((f) => f.endsWith(".dart"))] };
  const gradlew = ["gradlew", "android/gradlew"].find(has);
  if (gradlew) return { runner: "gradle", cmd: path.join(cwd, gradlew), args: ["testDebugUnitTest", "--quiet"] };
  return null;
}

export async function runTests(args, root) {
  const cwd = projectDir(root, args.projectRoot);
  if (!cwd) return { status: "FAIL", message: "projectRoot is outside the workspace.", _failed: true };
  const files = (Array.isArray(args.files) ? args.files : []).map((f) => path.resolve(root, f)).filter((f) => inside(root, f) && existsSync(f)).map((f) => path.relative(cwd, f));
  const found = await detect(cwd, root, files);
  if (!found) return { status: "SKIPPED", message: "No test runner detected (package.json test script/vitest/jest, pytest, go, cargo, swift, flutter, gradle). Tell the user tests were not run." };
  // A parent `node --test` context would make child runners report over IPC instead of printing.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const r = await runCheck(found.cmd, found.args, cwd, { timeout: 600_000, env: { ...env, CI: "1" }, label: `${found.runner}: ${path.basename(found.cmd)} ${found.args.join(" ")}`.slice(0, 300) });
  const output = (r.output ?? "").split("\n").slice(-80).join("\n");
  if (r.status === "PASS" && NO_TESTS.test(output)) {
    return { status: "FAIL", runner: found.runner, cmd: r.cmd, output, message: "The runner exited 0 but no tests ran. Point it at real test files; do not report tests as passing.", _failed: true };
  }
  return {
    status: r.status,
    runner: found.runner,
    cmd: r.cmd,
    output,
    instruction: r.status === "FAIL" ? "Fix the failing tests (or the code under test) and re-run. Never weaken an assertion just to make it pass." : r.status === "SKIPPED" ? "The runner binary is missing; tests did not run. Say so instead of claiming they pass." : "Tests ran and passed.",
    _failed: r.status === "FAIL",
  };
}

const candidates = (file) => {
  const dir = path.dirname(file);
  const ext = path.extname(file);
  const base = path.basename(file, ext);
  if (ext === ".py") return [path.join(dir, `test_${base}.py`), path.join(dir, `${base}_test.py`), path.join(dir, "tests", `test_${base}.py`)];
  if (ext === ".go") return [path.join(dir, `${base}_test.go`)];
  if (ext === ".dart") return [path.join(dir, `${base}_test.dart`)];
  if ([".swift", ".kt", ".java"].includes(ext)) return [`${base}Tests${ext}`, `${base}Test${ext}`, `${base}Spec${ext}`];
  const exts = [ext, ".ts", ".tsx", ".js", ".jsx"];
  return exts.flatMap((e) => [path.join(dir, `${base}.test${e}`), path.join(dir, `${base}.spec${e}`), path.join(dir, "__tests__", `${base}.test${e}`), path.join(dir, "__tests__", `${base}${e}`)]);
};

const SKIP_SOURCE = /(?:^|[/\\])(?:index|main|types?|constants?|config|setup|vite\.config|next\.config|tailwind\.config|layout|page|route|app|server|\w+\.d)\.[\w.]+$|\.(?:stories|config)\.\w+$|__init__\.py$|(?:^|[/\\])(?:migrations?|scripts?)[/\\]/;

export async function findMissingTests(args, root) {
  const { files, errors } = await collectFiles(Array.isArray(args.files) ? args.files : [], root, (p) => SOURCE.test(p) && !TEST_FILE.test(p));
  const sources = files.filter((f) => !TEST_FILE.test(f) && !SKIP_SOURCE.test(f));
  if (!sources.length) return { status: "PASS", message: "No changed source files that need tests.", errors };

  // Index every test file name once, for the JVM/Swift convention of tests living in a separate tree.
  const allTests = new Set();
  for (const f of (await collectFiles(["."], root, (p) => TEST_FILE.test(p))).files) allTests.add(path.basename(f));

  const missing = [];
  const covered = [];
  for (const f of sources) {
    const opts = candidates(f);
    const hit = opts.find((c) => (path.isAbsolute(c) ? existsSync(c) : allTests.has(c)));
    const base = path.basename(f, path.extname(f));
    const mirrored = !hit && [...allTests].find((t) => t.replace(/^test_|[._-]?(?:test|spec|Tests?|Spec)(?=\.)|\.(?:test|spec)(?=\.)/g, "").startsWith(`${base}.`));
    if (hit || mirrored) covered.push({ file: path.relative(root, f), test: hit ? (path.isAbsolute(hit) ? path.relative(root, hit) : hit) : mirrored });
    else missing.push({ file: path.relative(root, f), expected: path.isAbsolute(opts[0]) ? path.relative(root, opts[0]) : opts[0] });
  }
  return {
    status: missing.length ? "MISSING" : "PASS",
    missing,
    covered,
    ...(errors.length ? { errors } : {}),
    instruction: missing.length ? "Add focused tests for the changed logic in these files (behaviour, edge cases, error paths), or tell the user why they are not needed." : "Every changed source file has a matching test file.",
  };
}

import { matchBracket, indentedBlock } from "unslop-core";

const JS = /\.[cm]?[jt]sx?$/;
const PY = /\.py$/;
const GO = /\.go$/;
const SWIFT = /\.swift$/;
const RUST = /\.rs$/;
const JVM = /\.(?:kt|java)$/;

const ASSERTS = {
  js: /\bexpect\s*[.(]|\bassert\b|\.should\b|\bt\.(?:is|true|false|deepEqual|throws|snapshot)\b|\bcy\.(?:get|contains|url)\b[\s\S]*\.should\(|\bexpectTypeOf\b|\bverify\w*\(/,
  py: /\bassert\b|pytest\.raises|pytest\.warns|self\.assert\w+|\.assert_(?:called|awaited|has_calls|not_called)\w*|\bverify\(/,
  go: /\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\b|\bassert\.\w+|\brequire\.\w+|\bt\.Run\(|\bcmp\.Diff\b|\bif\s+got\s*!=|\bwant\b/,
  rust: /\bassert(?:_eq|_ne|_matches)?!|\bpanic!|\.unwrap\(\)|\.expect\(|\?;|\bassert\b/,
  swift: /\bXCTAssert\w*|XCTFail|#expect\b|#require\b/,
  jvm: /\bassert\w*\s*\(|\bverify\s*\(|\bexpect\w*\s*\(|\bshould\w*\b|\bcheck\(|assertThat|assertThrows|\bcoVerify\b/,
};

/** Finds test bodies per language and reports the ones that never assert. */
function testsWithoutAssertion(src, file) {
  const out = [];
  const flag = (index, body, re) => !re.test(body) && out.push({ index });
  if (JS.test(file)) {
    for (const m of src.matchAll(/\b(?:it|test)(?:\.(?:concurrent|each\([^)]*\)))?\s*\(\s*(["'`])[^]*?\1\s*,/g)) {
      // Skip past the parameter list (which may destructure: `async ({ page }) =>`) to the body.
      const head = src.slice(m.index + m[0].length).match(/^[^]*?(?:=>\s*|\bfunction\b[^{]*)/);
      if (!head) continue;
      const start = m.index + m[0].length + head[0].length;
      if (src[start] !== "{") {
        // Expression-bodied arrow: `() => expect(x)...` counts as asserting if it calls expect.
        flag(m.index, src.slice(start, src.indexOf("\n", start)), ASSERTS.js);
        continue;
      }
      const end = matchBracket(src, start);
      if (end !== -1) flag(m.index, src.slice(start, end), ASSERTS.js);
    }
  } else if (PY.test(file)) {
    for (const m of src.matchAll(/^[ \t]*(?:async[ \t]+)?def[ \t]+test_\w*\s*\([^)]*\)[^:\n]*:[ \t]*$/gm)) flag(m.index + m[0].search(/\S/), indentedBlock(src, m.index), ASSERTS.py);
  } else if (GO.test(file)) {
    for (const m of src.matchAll(/\bfunc\s+Test\w*\s*\(\s*\w+\s+\*testing\.T\s*\)\s*\{/g)) {
      const start = m.index + m[0].length - 1;
      flag(m.index, src.slice(start, matchBracket(src, start)), ASSERTS.go);
    }
  } else if (RUST.test(file)) {
    for (const m of src.matchAll(/#\[(?:tokio::|async_std::)?test\b[^\]]*\]\s*(?:#\[[^\]]*\]\s*)*(?:async\s+)?fn\s+\w+\s*\([^)]*\)[^{]*\{/g)) {
      const start = m.index + m[0].length - 1;
      flag(m.index, /should_panic/.test(m[0]) ? "assert" : src.slice(start, matchBracket(src, start)), ASSERTS.rust);
    }
  } else if (SWIFT.test(file)) {
    for (const m of src.matchAll(/(?:\bfunc\s+test\w*|@Test(?:\([^)]*\))?\s*(?:@\w+\s*)*func\s+\w+)\s*\([^)]*\)[^{]*\{/g)) {
      const start = m.index + m[0].length - 1;
      flag(m.index, src.slice(start, matchBracket(src, start)), ASSERTS.swift);
    }
  } else if (JVM.test(file)) {
    for (const m of src.matchAll(/@(?:Test|ParameterizedTest)\b[^{]*?(?:fun|void)\s+[`\w][^{]*\{/g)) {
      const start = m.index + m[0].length - 1;
      flag(m.index, src.slice(start, matchBracket(src, start)), ASSERTS.jvm);
    }
  }
  return out;
}

function snapshotOnly(src) {
  const snaps = (src.match(/\.toMatch(?:Inline)?Snapshot\(/g) ?? []).length;
  const expects = (src.match(/\bexpect\s*\(/g) ?? []).length;
  return snaps >= 2 && snaps === expects ? [{ index: src.search(/\.toMatch(?:Inline)?Snapshot\(/) }] : [];
}

function mockHeavy(src) {
  const mocks = [...src.matchAll(/\b(?:jest|vi)\.mock\(|@patch\(|mock\.patch\(|\bmockk<|\bMockito\.mock\(|@MockBean\b/g)];
  return mocks.length > 6 ? [{ index: mocks[0].index, message: `${mocks.length} module mocks in one file: the test mostly exercises mocks. Test through a real boundary or split the unit.` }] : [];
}

export const rules = [
  {
    id: "FOCUSED_TEST",
    severity: "ERROR",
    regex: /\b(?:it|test|describe|context)\.only\s*\(|\bf(?:it|describe)\s*\(|@pytest\.mark\.only\b/,
    message: ".only / fit silently skips the rest of the suite in CI. Remove it.",
    examples: [{ file: "a.test.ts", bad: ["it.only('works', () => { expect(1).toBe(1) })", "fdescribe('x', () => {})"], good: ["it('works', () => { expect(sum(1, 1)).toBe(2) })"] }],
  },
  {
    id: "SKIPPED_TEST",
    severity: "WARN",
    regex: /\b(?:it|test|describe)\.(?:skip|todo)\s*\(|\bx(?:it|describe|test)\s*\(|@pytest\.mark\.skip\b(?!\s*\(\s*reason)|@unittest\.skip\b|\bt\.Skip(?:Now)?\(\s*\)|@Disabled\b(?!\s*\(")|@Ignore\b|#\[ignore\]|\bXCTSkip\(\s*\)/,
    message: "Skipped test without a reason. Fix it, delete it, or skip with a linked reason.",
    examples: [
      { file: "a.test.ts", bad: ["it.skip('flaky', () => {})", "xit('old', () => {})"], good: ["it('works', () => {})"] },
      { file: "test_a.py", bad: ["@pytest.mark.skip\ndef test_a():\n    assert f()"], good: ["@pytest.mark.skip(reason='needs GPU, see #42')\ndef test_a():\n    assert f()"] },
    ],
  },
  {
    id: "TEST_WITHOUT_ASSERTION",
    severity: "ERROR",
    check: testsWithoutAssertion,
    message: "Test never asserts anything: it passes as long as nothing throws. Assert on the result or side effect.",
    examples: [
      { file: "a.test.ts", bad: ["it('renders', () => {\n  render(<Card />);\n});", "test('calls api', async () => {\n  await load();\n})"], good: ["it('renders title', () => {\n  render(<Card title=\"Hi\" />);\n  expect(screen.getByText('Hi')).toBeVisible();\n});", "it('adds', () => expect(add(1, 2)).toBe(3));"] },
      { file: "test_a.py", bad: ["def test_create():\n    client.post('/u', json={})\n"], good: ["def test_create():\n    r = client.post('/u', json={})\n    assert r.status_code == 422\n", "def test_raises():\n    with pytest.raises(ValueError):\n        parse('x')\n"] },
      { file: "tests/a.rs", bad: ["#[test]\nfn parses() {\n    parse(\"x\");\n}"], good: ["#[test]\nfn parses() {\n    assert_eq!(parse(\"x\"), 1);\n}", "#[tokio::test]\nasync fn runs() {\n    run().await.unwrap();\n}"] },
      { file: "a.spec.ts", bad: [], good: ["test('ui', async ({ page }) => {\n  await page.goto('/');\n  await expect(page.getByRole('heading')).toBeVisible();\n});"] },
      { file: "a_test.go", bad: ["func TestParse(t *testing.T) {\n\tParse(\"x\")\n}"], good: ["func TestParse(t *testing.T) {\n\tif _, err := Parse(\"x\"); err == nil {\n\t\tt.Fatal(\"want error\")\n\t}\n}"] },
      { file: "ATests.swift", bad: ["func testLoad() {\n    vm.load()\n}"], good: ["func testLoad() {\n    vm.load()\n    XCTAssertEqual(vm.items.count, 3)\n}"] },
      { file: "ATest.kt", bad: ["@Test\nfun loads() {\n    vm.load()\n}"], good: ["@Test\nfun loads() {\n    vm.load()\n    assertEquals(3, vm.items.size)\n}"] },
    ],
  },
  {
    id: "TAUTOLOGICAL_ASSERTION",
    severity: "ERROR",
    regex: /\bexpect\(\s*(true|false|null|undefined|\d+|(["'`])[^"'`]*\2)\s*\)\.(?:toBe|toEqual|toStrictEqual)\(\s*\1\s*\)|\bexpect\(\s*(\w+(?:\.\w+)*)\s*\)\.(?:toBe|toEqual|toStrictEqual)\(\s*\3\s*\)|\bexpect\(\s*true\s*\)\.toBeTruthy\(\)|\bassert\s+(?:True|1|not\s+False)\s*$|\bassert\s+(\w+)\s*==\s*\4\s*$|\bself\.assertTrue\(\s*True\s*\)|\bassert\.ok\(\s*true\s*\)|\bXCTAssertTrue\(\s*true\s*\)|\bassertTrue\(\s*true\s*\)|\bassertEquals\(\s*(\w+)\s*,\s*\5\s*\)/m,
    message: "Assertion that can never fail (compares a value with itself or a literal with the same literal).",
    examples: [
      { file: "a.test.ts", bad: ["expect(true).toBe(true)", "expect(result).toEqual(result)", "expect(1).toBe(1)"], good: ["expect(result).toEqual(expected)", "expect(isValid('a')).toBe(true)"] },
      { file: "test_a.py", bad: ["    assert True\n", "    assert x == x\n"], good: ["    assert x == 1\n"] },
      { file: "ATest.kt", bad: ["assertTrue(true)"], good: ["assertTrue(isValid)"] },
    ],
  },
  {
    id: "SWALLOWED_TEST_FAILURE",
    severity: "ERROR",
    regex: /\btry\s*\{[\s\S]{0,400}?\}\s*catch\s*(?:\([^)]*\))?\s*\{\s*(?:console\.\w+\([^)]*\);?\s*)?\}|(?<!await\s|return\s)\bexpect\((?:[^()]|\([^()]*\))*\)\.(?:rejects|resolves)\./,
    message: "Failure can't surface: an empty catch swallows assertion errors, or a rejects/resolves assertion is not awaited and never runs.",
    examples: [{ file: "a.test.ts", bad: ["try { expect(f()).toBe(1) } catch (e) {}", "expect(load()).rejects.toThrow()"], good: ["await expect(load()).rejects.toThrow('404')", "expect(() => f()).toThrow()"] }],
  },
  {
    id: "WEAK_ASSERTION",
    severity: "WARN",
    regex: /\.toBeDefined\(\)|\.toBeTruthy\(\)|\.not\.toBeNull\(\)|\.not\.toBeUndefined\(\)|\bassert\s+\w+(?:\.\w+)*\s+is\s+not\s+None\s*$|\bXCTAssertNotNil\(|\bassertNotNull\(/m,
    message: "Existence-only assertion passes for almost any output. Assert the actual value or shape.",
    examples: [{ file: "a.test.ts", bad: ["expect(user).toBeDefined()", "expect(res.body).toBeTruthy()"], good: ["expect(user).toEqual({ id: 1, name: 'Ana' })"] }],
  },
  {
    id: "SLEEP_IN_TEST",
    severity: "WARN",
    regex: /new Promise\(\s*\(?\s*\w+\s*\)?\s*=>\s*setTimeout\(|\bwaitForTimeout\(|\bcy\.wait\(\s*\d|\btime\.sleep\(|\bThread\.sleep\(|\basyncio\.sleep\(\s*[1-9]|\btime\.Sleep\(|\bsleep\(\s*\d/,
    message: "Fixed sleep makes tests slow and flaky. Use fake timers, waitFor/findBy, polling with a timeout, or an awaited event.",
    examples: [{ file: "a.test.ts", bad: ["await new Promise((r) => setTimeout(r, 500))", "await page.waitForTimeout(2000)"], good: ["await screen.findByText('Saved')", "vi.advanceTimersByTime(500)"] }, { file: "test_a.py", bad: ["    time.sleep(2)\n"], good: ["    wait_for(lambda: job.done, timeout=2)\n"] }],
  },
  {
    id: "SNAPSHOT_ONLY",
    severity: "WARN",
    files: JS,
    check: snapshotOnly,
    message: "Every assertion in this file is a snapshot: reviewers rubber-stamp snapshot diffs. Assert the behaviour that matters explicitly.",
    examples: [{ file: "a.test.tsx", bad: ["expect(render(<A />)).toMatchSnapshot();\nexpect(render(<B />)).toMatchSnapshot();"], good: ["expect(render(<A />)).toMatchSnapshot();\nexpect(screen.getByRole('button')).toBeEnabled();"] }],
  },
  {
    id: "MOCK_HEAVY",
    severity: "WARN",
    check: mockHeavy,
    message: "Too many mocks.",
    examples: [{ file: "a.test.ts", bad: [Array.from({ length: 7 }, (_, i) => `vi.mock('./m${i}')`).join("\n")], good: ["vi.mock('./api')"] }],
  },
  {
    id: "REAL_NETWORK_IN_TEST",
    severity: "WARN",
    regex: /\b(?:fetch|axios\.\w+|requests\.\w+|httpx\.\w+|http\.Get)\(\s*["'`]https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/,
    message: "Unit test hits a real external URL: slow, flaky and non-hermetic. Stub with MSW/nock/respx/httptest or a local server.",
    examples: [{ file: "a.test.ts", bad: ["await fetch('https://api.github.com/users/x')"], good: ["await fetch('http://localhost:3000/health')"] }],
  },
  {
    id: "NONDETERMINISTIC_TEST_DATA",
    severity: "WARN",
    regex: /\bMath\.random\(\)|\brandom\.(?:random|randint|choice)\(|\bfaker\.\w+\.\w+\((?![\s\S]{0,200}seed)|\brand\.Intn\(/,
    message: "Unseeded random test data makes failures irreproducible. Use fixed values or seed the generator.",
    examples: [{ file: "a.test.ts", bad: ["const id = Math.random()"], good: ["const id = 42"] }],
  },
  {
    id: "CONSOLE_IN_TEST",
    severity: "WARN",
    check: (src, file) => [...src.matchAll(/\.py$/.test(file) ? /^[ \t]*print\(/gm : /\bconsole\.log\(|\bprintln!\(|\bdbg!\(|^[ \t]*(?:print|debugPrint)\((?=[^\n]*\)\s*$)/gm)].filter((m) => !/\.(?:[cm]?[jt]sx?)$/.test(file) || m[0].includes("console")).map((m) => ({ index: m.index })),
    message: "Debug output left in tests. Assert on the value instead of printing it.",
    examples: [{ file: "a.test.ts", bad: ["console.log(result)"], good: ["expect(result).toBe(2)", "const src = `\nprint(items[0])\n`"] }, { file: "test_a.py", bad: ["    print(result)\n"], good: ["    assert result == 2\n"] }],
  },
];

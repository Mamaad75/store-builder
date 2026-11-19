// Summarises a Playwright JSON report so that retried ("flaky") tests are reported separately
// from tests that passed on the first attempt. Never changes the exit code: the test step itself
// already fails the job when a test fails.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const file = process.argv[2] ?? "playwright-report/results.json";
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
const out = (md) => (summaryPath ? appendFileSync(summaryPath, `${md}\n`) : console.log(md));

if (!existsSync(file)) {
  out(`### E2E results\n\nNo Playwright report found at \`${file}\` (the tests probably did not start).`);
  process.exit(0);
}

const report = JSON.parse(readFileSync(file, "utf8"));
const counts = { passed: 0, flaky: 0, failed: 0, skipped: 0 };
const flaky = [];
const failed = [];

function walk(suite, trail = []) {
  const here = suite.title && !suite.title.endsWith(".ts") ? [...trail, suite.title] : trail;
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const title = [...here, spec.title].join(" › ");
      const attempts = (t.results ?? []).length;
      if (t.status === "expected") counts.passed += 1;
      else if (t.status === "skipped") counts.skipped += 1;
      else if (t.status === "flaky") {
        counts.flaky += 1;
        flaky.push({ title, attempts });
      } else {
        counts.failed += 1;
        failed.push({ title, attempts });
      }
    }
  }
  for (const child of suite.suites ?? []) walk(child, here);
}
for (const s of report.suites ?? []) walk(s);

const total = counts.passed + counts.flaky + counts.failed + counts.skipped;
const lines = [
  "### E2E results",
  "",
  "| Outcome | Tests |",
  "|---|---|",
  `| Passed on the first attempt | ${counts.passed} |`,
  `| **Flaky** (failed, then passed on retry) | ${counts.flaky} |`,
  `| Failed (after retry) | ${counts.failed} |`,
  `| Skipped | ${counts.skipped} |`,
  `| **Total** | ${total} |`,
];
if (flaky.length) {
  lines.push("", "#### Flaky tests (passed only after a retry; investigate, do not treat as passing)", "");
  for (const f of flaky) lines.push(`- ${f.title} (${f.attempts} attempts)`);
}
if (failed.length) {
  lines.push("", "#### Failed tests", "");
  for (const f of failed) lines.push(`- ${f.title} (${f.attempts} attempts)`);
}
out(lines.join("\n"));
for (const f of flaky) console.log(`::warning title=Flaky E2E test::${f.title} passed only after a retry`);

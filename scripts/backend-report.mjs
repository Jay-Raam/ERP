// Prints the backend CI report as Markdown (written to the GitHub job summary).
// Reads Vitest's JSON results and coverage summary; missing files are reported, not fatal.
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
const results = read('apps/api/coverage/results.json');
const coverage = read('apps/api/coverage/coverage-summary.json');
const lines = ['## Backend report', ''];

if (!results) {
  lines.push('Test results were not produced. Check the test step above.');
} else {
  const ok = results.numFailedTests === 0 && results.success !== false;
  lines.push(
    `**${ok ? 'Passed' : 'Failed'}**: ${results.numPassedTests} passed, ${results.numFailedTests} failed, ${results.numTotalTests} total`,
    '',
    '| Test file | Passed | Failed |',
    '|---|---|---|',
  );
  for (const file of results.testResults ?? []) {
    const tests = file.assertionResults ?? [];
    const failed = tests.filter((t) => t.status === 'failed');
    const name = file.name.split('apps/api/').pop();
    lines.push(`| ${name} | ${tests.length - failed.length} | ${failed.length} |`);
    for (const t of failed) lines.push(`| &nbsp;&nbsp;failed: ${t.fullName} | | |`);
  }
}

if (coverage?.total) {
  const { lines: l, branches: b, functions: f } = coverage.total;
  lines.push(
    '',
    '### Coverage',
    '',
    '| Lines | Branches | Functions |',
    '|---|---|---|',
    `| ${l.pct}% | ${b.pct}% | ${f.pct}% |`,
  );
}

lines.push(
  '',
  '_The endpoint matrix (happy path, unauthenticated, forbidden, invalid input, injection, cross-tenant, tampering) is added with the first business module._',
);
process.stdout.write(`${lines.join('\n')}\n`);

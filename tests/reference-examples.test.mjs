// Every example in REFERENCE.md (and in EXAMPLES.md) runs, and shows what the code gives (scripts/check-examples.mjs;
// EXAMPLES.md is the writers' guide). A failure names the heading and the line of each example
// that does not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { checkExamples, formatReport } from "../scripts/check-examples.mjs";

const REFERENCE = fileURLToPath(new URL("../REFERENCE.md", import.meta.url));

test("every example in the writers' guide, EXAMPLES.md, runs and gives what it shows", async () => {
    const report = await checkExamples([fileURLToPath(new URL("../EXAMPLES.md", import.meta.url))]);
    assert.equal(report.failures.length, 0, `\n${formatReport(report)}`);
    assert.ok(report.counts.run >= 3, `${report.counts.run} examples run`);
});

test("every example in REFERENCE.md runs and gives what it shows", async (t) => {
    const report = await checkExamples([REFERENCE]);
    const { counts } = report;
    t.diagnostic(`${counts.blocks} js blocks: ${counts.run} run (${counts.dom} with the stand-in DOM)`);
    t.diagnostic(`${counts.setup} setup, ${counts.parse} parse-only`);
    t.diagnostic(`${counts.known} known failures, in ${(report.ms / 1000).toFixed(1)} s`);
    assert.equal(report.failures.length, 0, `\n${formatReport(report)}`);
    assert.ok(counts.run > 100, `${counts.run} examples run`);
});

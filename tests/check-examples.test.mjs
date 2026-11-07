// The examples checker (scripts/check-examples.mjs), held to the conventions EXAMPLES.md gives
// writers: what runs, what a marker checks, where setup applies, and what a failure says.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildProgram, checkExamples, extractBlocks, formatReport, readMarker } from "../scripts/check-examples.mjs";

const KIT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(KIT, "scripts", "check-examples.mjs");
const fence = "```";

// Writes the markdown to a file of its own, checks it, and removes the file.
async function check(markdown) {
    const dir = await mkdtemp(join(tmpdir(), "check-examples-"));
    const file = join(dir, "chunk.md");
    await writeFile(file, markdown);
    try {
        return await checkExamples([file], { timeout: 5000 });
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

// The problems of every block, as "line: message" (the message's first line).
const problems = (report) => report.results.flatMap((result) => {
    return result.problems.map((problem) => `${problem.line}: ${problem.message.split("\n")[0]}`);
});

test("a value is a JS literal compared deeply, or HTML compared exactly; a wrong one names its line", async () => {
    const report = await check([
        "## Values",
        `${fence}js`,
        "1 + 2; // → 3",
        "const cart = { items: [1, 2] }; // → { items: [1, 2] }",
        "Object.create(null); // → {}",
        '"<p>Hi</p>"; // → <p>Hi</p>',
        "[1, 2].map((n) => n * 2);",
        "// → [2, 4]",
        '"<ul><li>a</li>" + "<li>b</li></ul>";',
        "// → <ul><li>a</li>",
        "//   <li>b</li></ul>",
        "await Promise.resolve(5); // → 5",
        fence,
        "",
        `${fence}js`,
        "2 + 2; // → 5",
        '"<p>Hi</p>"; // → <p>Hello</p>',
        "Promise.resolve(1); // → 1",
        fence,
    ].join("\n"));
    assert.equal(report.counts.run, 2);
    assert.deepEqual(problems(report), [
        "16: is something else",
        "17: renders something else",
        "18: is something else (a promise: `await` it to show what it resolves to)",
    ]);
    const reported = formatReport(report);
    assert.match(reported, /chunk\.md:15 {2}## Values\n {4}line 16: is something else\n/);
    assert.match(reported, /\n {6}expected {2}5\n {6}actual {4}4\n/);
});

test("throws checks the error's name and the start of its message; console.<method> a line written", async () => {
    const report = await check([
        `${fence}js`,
        'JSON.parse("{"); // throws SyntaxError',
        'null.cart; // throws TypeError: Cannot read properties of null',
        "await Promise.reject(new RangeError(\"no stock\")); // throws RangeError: no",
        'console.warn("Juris: dropped innerHTML: markup"); // console.warn: Juris: dropped',
        "1 + 1; // throws",
        'null.cart; // throws RangeError',
        'console.info("hello"); // console.warn: hello',
        fence,
    ].join("\n"));
    assert.deepEqual(problems(report), [
        "6: did not throw",
        "7: threw TypeError, not RangeError: Cannot read properties of null (reading 'cart')",
        '8: wrote no console.warn line starting "hello"',
    ]);
});

test("a setup block is prepended to the later blocks under its heading, down to the next of its level", () => {
    const blocks = extractBlocks([
        "## One",
        `${fence}js setup`,
        "const shop = 1;",
        fence,
        "### One, below",
        `${fence}js`,
        "shop;",
        fence,
        "## Two",
        `${fence}js`,
        "shop;",
        fence,
    ].join("\n"));
    assert.deepEqual(blocks.map((block) => [block.headings.join(" › "), block.setups.length]), [
        ["## One", 0],
        ["## One › ### One, below", 1],
        ["## Two", 0],
    ]);
    // The program keeps the markdown's lines: line n of the program is a known line of the file.
    const program = buildProgram(blocks[1]);
    assert.equal(program.source, "const shop = 1;\nshop;");
    assert.deepEqual(program.lines, [3, 7]);
});

test("dom gives a page; browser and excerpt are parsed only, a syntax error still reported; tags checked", async () => {
    const report = await check([
        `${fence}js dom`,
        "const page = document.createElement(\"main\");",
        "page.innerHTML = '<p class=\"note\">Hi &amp; bye</p>';",
        "page.querySelector(\".note\").textContent; // → \"Hi & bye\"",
        "page.innerHTML; // → <p class=\"note\">Hi &amp; bye</p>",
        fence,
        `${fence}js browser`,
        'import { hydrate } from "/src/client.js";',
        "await hydrate();",
        fence,
        `${fence}js excerpt`,
        "import { routes } from \"./client/app.js\";",
        "export const app = routes(;",
        fence,
        `${fence}js setpu`,
        "1;",
        fence,
        `${fence}sh`,
        "npm test",
        fence,
    ].join("\n"));
    const { run, parse, dom } = report.counts;
    assert.deepEqual({ run, parse, dom }, { run: 2, parse: 2, dom: 1 });
    assert.deepEqual(problems(report), [
        "13: does not parse as an ES module: SyntaxError: Unexpected token ';'",
        '15: unknown tag "setpu" (the tags are setup, dom, browser, excerpt, known-failure)',
    ]);
});

test("a marker written wrong, or not under its statement, is the writer's to fix", async () => {
    assert.deepEqual(readMarker("// -> 3"), {
        error: "a result is shown as `// → value` (the arrow is →, U+2192)",
    });
    assert.equal(readMarker("// a note"), null);
    const report = await check([
        `${fence}js`,
        "const a = 1;",
        "",
        "// → 1",
        "const [x, y] = [1, 2]; // → 1",
        "if (a) {",
        "} // → 1",
        fence,
    ].join("\n"));
    assert.deepEqual(problems(report), [
        "4: a marker on its own line goes right under the statement it is about, which ends with `;`",
        "5: `// →` after a declaration shows the one name it declares (`const total = …;`), not a pattern",
        "7: the statement a marker is about ends with `;` on the marker's line",
    ]);
});

test("a known failure is reported apart and fails nothing, until it passes", async () => {
    const known = await check([`${fence}js known-failure`, "1 + 1; // → 3", fence].join("\n"));
    assert.equal(known.failures.length, 0);
    assert.equal(known.known.length, 1);
    assert.match(formatReport(known), /Known failures[\s\S]*line 2: is something else/);
    const fixed = await check([`${fence}js known-failure`, "1 + 1; // → 2", fence].join("\n"));
    assert.deepEqual(problems(fixed), ["1: a known failure that passes now: take the known-failure tag off"]);
});

test("an example that throws, never settles, or runs too long is reported at its line", async () => {
    const report = await check([
        `${fence}js`,
        "const cart = {};",
        "cart.items.length;",
        fence,
        `${fence}js`,
        "await new Promise(() => {});",
        fence,
    ].join("\n"));
    assert.deepEqual(problems(report), [
        "3: threw TypeError: Cannot read properties of undefined (reading 'length')",
        "5: threw Error: a top-level await never settled",
    ]);
});

test("the command: exit code 1, and a report naming the heading and the line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "check-examples-"));
    const file = join(dir, "chunk.md");
    await writeFile(file, ["### The cart", `${fence}js`, "[1, 2].length; // → 3", fence].join("\n"));
    try {
        const failed = spawnSync(process.execPath, [CLI, file], { cwd: KIT, encoding: "utf8" });
        assert.equal(failed.status, 1);
        assert.match(failed.stdout, /chunk\.md:2 {2}### The cart\n {4}line 3: is something else/);
        await writeFile(file, ["### The cart", `${fence}js`, "[1, 2].length; // → 2", fence].join("\n"));
        const passed = spawnSync(process.execPath, [CLI, file], { cwd: KIT, encoding: "utf8" });
        assert.equal(passed.status, 0);
        assert.match(passed.stdout, /1 js blocks \(1 run, 0 setup, 0 parse-only\): all passed/);
        const usage = spawnSync(process.execPath, [CLI], { cwd: KIT, encoding: "utf8" });
        assert.equal(usage.status, 2);
        assert.match(usage.stderr, /usage: node scripts\/check-examples\.mjs <file\.md>/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("the programs are written inside the kit, so imports resolve as from its own files, and removed", async () => {
    const report = await check([
        `${fence}js`,
        'import Juris from "juris/juris.js";',
        'import SSRRenderer from "juris-kit/server/ssr-renderer.js";',
        "new Juris({ features: { ssr: SSRRenderer } }).renderToString({ p: 1 }); // → <p>1</p>",
        fence,
    ].join("\n"));
    assert.deepEqual(problems(report), []);
    assert.ok(report.dir.startsWith(join(KIT, ".examples-")), report.dir);
    assert.equal(existsSync(report.dir), false);
});

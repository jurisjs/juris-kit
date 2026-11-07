// One example, run by check-examples.mjs in a process of its own. It is sent { file, checks, dom }:
// the program to import, what to check (the markers, by id), and whether to give it a stand-in page
// first. It answers { reached, failures, error, rejections } and exits, whatever timers the
// example left running.
//
// The program calls `__check`: value(id, actual) for `// →`, throws / throwsSync(id, fn) for
// `// throws`, and mark(id) / saw(id) around a statement whose console lines are shown.

import { format, inspect } from "node:util";
import { pathToFileURL } from "node:url";

const reached = new Set();
const failures = [];
const rejections = [];
const written = []; // every console line: { method, text }
const marks = new Map(); // id -> how many lines were written when its statement started

process.on("unhandledRejection", (reason) => rejections.push(describe(reason)));

let reported = false;
const report = (error) => {
    reported = true;
    process.send({ reached: [...reached], failures, error, rejections }, () => process.exit(0));
};

// Nothing left to run while the import still waits: a top-level await that never settles.
process.once("beforeExit", () => {
    if (!reported) report({ name: "Error", message: "a top-level await never settled", stack: "" });
});

process.once("message", async ({ file, checks, dom }) => {
    const byId = new Map(checks.map((check) => [check.id, check]));
    captureConsole();
    globalThis.__check = checker(byId);
    let error = null;
    try {
        if (dom) (await import("./examples-dom.mjs")).installDom();
        await import(pathToFileURL(file).href);
        // What the example started settles first: a rejection nobody handled, a microtask's warning.
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setImmediate(resolve));
    } catch (thrown) {
        error = describe(thrown);
    }
    report(error);
});

function checker(byId) {
    const fail = (id, message) => failures.push({ id, message });
    return {
        value(id, actual) {
            reached.add(id);
            const expected = byId.get(id).value;
            if (expected.text.startsWith("<")) {
                if (actual !== expected.text) {
                    const verb = typeof actual === "string" ? "renders" : "is";
                    fail(id, `${verb} something else\n${compareHtml(expected.text, actual)}`);
                }
                return actual;
            }
            let wanted;
            try {
                wanted = Function(`"use strict"; return (${expected.text}\n);`)();
            } catch (problem) {
                fail(id, `the value after → is not a JS value (${problem.message}): ${expected.text}`);
                return actual;
            }
            if (!same(actual, wanted)) {
                const hint = isThenable(actual) ? " (a promise: `await` it to show what it resolves to)" : "";
                fail(id, `is something else${hint}\nexpected  ${show(wanted)}\nactual    ${show(actual)}`);
            }
            return actual;
        },
        throwsSync(id, fn) {
            try {
                fn();
            } catch (error) {
                return thrown(id, error);
            }
            reached.add(id);
            fail(id, "did not throw");
        },
        async throws(id, fn) {
            try {
                await fn();
            } catch (error) {
                return thrown(id, error);
            }
            reached.add(id);
            fail(id, "did not throw");
        },
        mark(id) {
            marks.set(id, written.length);
        },
        saw(id) {
            reached.add(id);
            const since = written.slice(marks.get(id) ?? 0);
            for (const expected of byId.get(id).console) {
                const found = since.some((line) => {
                    return line.method === expected.method && line.text.startsWith(expected.text);
                });
                if (found) continue;
                const lines = since.map((line) => `console.${line.method}: ${line.text}`);
                const shown = lines.join("\n          ") || "(nothing)";
                fail(id, `wrote no console.${expected.method} line starting "${expected.text}"\nwrote     ${shown}`);
            }
        },
    };

    function thrown(id, error) {
        reached.add(id);
        const { name, message } = byId.get(id).throws;
        const actualName = error?.name ?? error?.constructor?.name;
        const actualMessage = String(error?.message ?? error);
        if (name && actualName !== name) fail(id, `threw ${actualName}, not ${name}: ${actualMessage}`);
        else if (message && !actualMessage.startsWith(message)) {
            const wanted = `${name ?? "an error"}: ${message}…`;
            fail(id, `threw something else\nexpected  ${wanted}\nactual    ${actualName}: ${actualMessage}`);
        }
    }
}

// Deep equality as a reader means it: primitives by Object.is, arrays item by item, other objects
// by their own enumerable keys (whatever their prototype: a state object made with no prototype
// equals the literal that shows it), dates by their time.
function same(a, b, seen = new Map()) {
    if (Object.is(a, b)) return true;
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
    if (seen.get(a) === b) return true;
    seen.set(a, b);
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (a instanceof Date || b instanceof Date) {
        return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
    }
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key], seen));
}

const isThenable = (value) => value !== null && typeof value === "object" && typeof value.then === "function";
const show = (value) => inspect(value, { depth: 6, breakLength: 100 });

function compareHtml(expected, actual) {
    if (typeof actual !== "string") return `expected  ${expected}\nactual    ${show(actual)} (not a string)`;
    let at = 0;
    while (at < expected.length && expected[at] === actual[at]) at++;
    return `expected  ${expected}\nactual    ${actual}\n          ${" ".repeat(at)}^ from here`;
}

function captureConsole() {
    for (const method of ["log", "info", "warn", "error", "debug"]) {
        const original = console[method].bind(console);
        console[method] = (...args) => {
            written.push({ method, text: format(...args) });
            original(...args);
        };
    }
}

function describe(error) {
    if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack ?? "" };
    return { name: typeof error, message: String(error), stack: "" };
}

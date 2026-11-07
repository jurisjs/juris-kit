// The boundary (REFERENCE.md, "The boundary"), held by a test on the kit's half: the server takes the
// framework's browser half only from the juris package, nothing in server/ reads the environment, and no
// import cycle. What a browser downloads, and the browser floor, are held by the juris package's own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(KIT, "server");

async function filesUnder(dir) {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await filesUnder(path)));
        else if (entry.name.endsWith(".js")) out.push(path);
    }
    return out;
}

// The code of a file with its comments and (unless `keepStrings`) string contents blanked, so a rule
// reads code, not prose.
function codeOf(source, { keepStrings = false } = {}) {
    let out = "";
    let i = 0;
    while (i < source.length) {
        const c = source[i];
        const next = source[i + 1];
        if (c === "/" && next === "/") { while (i < source.length && source[i] !== "\n") i++; continue; }
        if (c === "/" && next === "*") { const end = source.indexOf("*/", i + 2); i = end < 0 ? source.length : end + 2; out += " "; continue; }
        if (c === '"' || c === "'" || c === "`") {
            const quote = c;
            const start = i;
            i++;
            while (i < source.length && source[i] !== quote) { if (source[i] === "\\") i++; i++; }
            i++;
            out += keepStrings ? source.slice(start, i) : quote + quote;
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

const importsOf = (text) => [...codeOf(text, { keepStrings: true }).matchAll(/(?:^|[\s;])(?:import|export)\b[^'"`;]*?\bfrom\s*["']([^"']+)["']|(?:^|[\s;])import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/gm)].map((m) => m[1] ?? m[2] ?? m[3]);

test("the server takes the framework's browser half only from the juris package, by file", async () => {
    for (const file of await filesUnder(SERVER)) {
        for (const spec of importsOf(await readFile(file, "utf8"))) {
            if (spec.startsWith(".")) {
                assert.ok(resolve(dirname(file), spec).startsWith(SERVER), `${relative(KIT, file)} imports "${spec}", outside server/`);
            } else {
                assert.ok(/^node:|^juris\/[A-Za-z0-9_-]+\.js$/.test(spec), `${relative(KIT, file)} imports "${spec}": the server imports node: and juris/<file>.js only`);
            }
        }
    }
});

test("nothing in server/ reads the environment", async () => {
    for (const file of await filesUnder(SERVER)) {
        assert.ok(!/process\.env/.test(codeOf(await readFile(file, "utf8"))), `${relative(KIT, file)} reads process.env`);
    }
});

test("no import cycle anywhere in server/", async () => {
    const graph = new Map();
    for (const file of await filesUnder(SERVER)) {
        const deps = importsOf(await readFile(file, "utf8")).filter((s) => s.startsWith(".")).map((s) => resolve(dirname(file), s));
        graph.set(file, deps);
    }
    const state = new Map();
    const visit = (file, path) => {
        if (state.get(file) === "done") return;
        assert.notEqual(state.get(file), "open", `import cycle: ${[...path, file].map((f) => relative(KIT, f)).join(" → ")}`);
        state.set(file, "open");
        for (const dep of graph.get(file) ?? []) visit(dep, [...path, file]);
        state.set(file, "done");
    };
    for (const file of graph.keys()) visit(file, []);
});

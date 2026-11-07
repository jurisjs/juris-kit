#!/usr/bin/env node
// Runs the code examples in markdown files and checks the results they show.
//
//   node scripts/check-examples.mjs <file.md> [more.md ...] [--jobs N] [--timeout ms] [--verbose] [--keep]
//
// Every ```js block is an ES module. It runs in Node, alone (one child process each), with the
// results it shows checked:
//
//   expr; // → value              value is a JS literal, compared with deep equality, or, when it
//                                  starts with `<`, a string of HTML compared exactly
//   stmt; // throws TypeError: start of the message
//   stmt; // console.warn: start of the line it writes (log, info, warn, error, debug)
//
// A marker may also stand alone on the line under its statement, and a long value continues on
// the comment lines under it, indented (`//   …`). The info string says more:
//
//   ```js setup          prepended to every later js block under the same heading
//   ```js dom            runs with a stand-in page: document, window, Node (examples-dom.mjs)
//   ```js browser        needs a real browser page: parsed, never run
//   ```js excerpt        a piece of an app (it imports the app's own files): parsed, never run
//   ```js known-failure  shows what the contract says while the code disagrees: reported apart
//
// Any other language (html, sh, http, text, json) is not run. EXAMPLES.md is the writers' guide.
//
// The examples run from a temporary directory inside juris-kit, removed afterwards, so their
// imports resolve as they do from the kit's own files: `juris/<file>.js` and
// `juris-kit/server/<file>.js` (the package's own name, by self-reference).
//
// Not a JS parser: a tokenizer that knows strings, templates, comments, regular expressions and
// brackets, which is enough to find where a statement starts and which comment is a marker. Node
// parses the code when it runs it.

import { fork, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHILD = join(KIT, "scripts", "examples-child.mjs");

const JS_LANGUAGES = new Set(["js", "javascript", "mjs"]);
const TAGS = new Set(["setup", "dom", "browser", "excerpt", "known-failure"]);
const DEFAULT_TIMEOUT = 10_000;

// ---- the markdown -------------------------------------------------------------------------------

const FENCE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

// The fenced blocks of a markdown file, each with the headings it is under and the setup blocks
// that come before it there. Lines are 1-based.
export function extractBlocks(markdown) {
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
    // The open headings, outermost first, each with the setup blocks written under it.
    const scopes = [{ level: 0, title: null, line: 0, setups: [] }];
    let i = 0;
    while (i < lines.length) {
        const heading = HEADING.exec(lines[i]);
        if (heading) {
            const level = heading[1].length;
            while (scopes.length > 1 && scopes[scopes.length - 1].level >= level) scopes.pop();
            scopes.push({ level, title: `${heading[1]} ${heading[2]}`, line: i + 1, setups: [] });
            i++;
            continue;
        }
        const fence = FENCE.exec(lines[i]);
        if (!fence || (fence[2][0] === "`" && fence[3].includes("`"))) {
            i++;
            continue;
        }
        const indent = fence[1].length;
        const marker = fence[2];
        const words = fence[3].trim().split(/\s+/).filter(Boolean);
        const body = [];
        let j = i + 1;
        while (j < lines.length) {
            const close = FENCE_CLOSE.exec(lines[j]);
            if (close && close[1][0] === marker[0] && close[1].length >= marker.length) break;
            body.push(lines[j].replace(new RegExp(`^[ \\t]{0,${indent}}`), ""));
            j++;
        }
        const block = {
            line: i + 1, // the opening fence
            firstLine: i + 2, // the first line of code
            lang: (words[0] ?? "").toLowerCase(),
            tags: words.slice(1),
            code: body.join("\n"),
            headings: scopes.filter((scope) => scope.title).map((scope) => scope.title),
            setups: scopes.flatMap((scope) => scope.setups),
        };
        blocks.push(block);
        if (JS_LANGUAGES.has(block.lang) && block.tags.includes("setup")) scopes[scopes.length - 1].setups.push(block);
        i = j + 1;
    }
    return blocks;
}

// ---- reading JavaScript, just enough --------------------------------------------------------------

const REGEX_AFTER = new Set([
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield",
    "await",
]);
const IDENT_START = /[\p{L}_$]/u;
const IDENT_PART = /[\p{L}\p{N}_$\u200c\u200d]/u;
const NUMBER = /^(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?|\.\d[\d_]*(?:[eE][+-]?\d+)?)n?/;
const OPENERS = { "(": ")", "[": "]", "{": "}" };
const CLOSERS = new Set([")", "]", "}"]);

// Tokens ({ kind, text, start, end, level }) and comments ({ text, start, end }). `level` is how
// many brackets are open around the token: an opener and its closer have the level outside them.
export function tokenize(source) {
    const tokens = [];
    const comments = [];
    const stack = []; // "(", "[", "{", or "${" for a template's substitution
    let previous = null;
    let i = 0;

    const add = (kind, start, end, level = stack.length) => {
        previous = { kind, text: source.slice(start, end), start, end, level };
        tokens.push(previous);
    };

    // A template's text from `from` to its end, or to a `${` (left open on the stack).
    const template = (start, from) => {
        let j = from;
        while (j < source.length) {
            if (source[j] === "\\") {
                j += 2;
            } else if (source[j] === "`") {
                add("template", start, j + 1);
                return j + 1;
            } else if (source[j] === "$" && source[j + 1] === "{") {
                add("template", start, j + 2);
                stack.push("${");
                return j + 2;
            } else {
                j++;
            }
        }
        add("template", start, source.length);
        return source.length;
    };

    while (i < source.length) {
        const c = source[i];
        if (/\s/.test(c)) {
            i++;
        } else if (source.startsWith("//", i)) {
            const newline = source.indexOf("\n", i);
            const end = newline === -1 ? source.length : newline;
            comments.push({ text: source.slice(i, end), start: i, end });
            i = end;
        } else if (source.startsWith("/*", i)) {
            const close = source.indexOf("*/", i + 2);
            const end = close === -1 ? source.length : close + 2;
            comments.push({ text: source.slice(i, end), start: i, end });
            i = end;
        } else if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < source.length && source[j] !== c && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
            add("string", i, Math.min(j + 1, source.length));
            i = j + 1;
        } else if (c === "`") {
            i = template(i, i + 1);
        } else if (c === "}" && stack[stack.length - 1] === "${") {
            stack.pop();
            i = template(i, i + 1);
        } else if (IDENT_START.test(c)) {
            let j = i + 1;
            while (j < source.length && IDENT_PART.test(source[j])) j++;
            add("word", i, j);
            i = j;
        } else if (/[\d.]/.test(c) && NUMBER.test(source.slice(i, i + 64))) {
            const text = NUMBER.exec(source.slice(i, i + 64))[0];
            add("number", i, i + text.length);
            i += text.length;
        } else if (c === "/" && regexAllowed(previous)) {
            const end = regexEnd(source, i);
            add(end === -1 ? "punct" : "regex", i, end === -1 ? i + 1 : end);
            i = end === -1 ? i + 1 : end;
        } else if (OPENERS[c]) {
            add("punct", i, i + 1);
            stack.push(c);
            i++;
        } else if (CLOSERS.has(c)) {
            if (OPENERS[stack[stack.length - 1]] === c) stack.pop();
            add("punct", i, i + 1);
            i++;
        } else {
            add("punct", i, i + 1);
            i++;
        }
    }
    return { tokens, comments };
}

function regexAllowed(previous) {
    if (!previous) return true;
    if (previous.kind === "punct") return !CLOSERS.has(previous.text);
    return previous.kind === "word" && REGEX_AFTER.has(previous.text);
}

// The end of the regular expression literal that starts at `i`, or -1 when its line ends first.
function regexEnd(source, i) {
    let inClass = false;
    for (let j = i + 1; j < source.length; j++) {
        const c = source[j];
        if (c === "\n") return -1;
        if (c === "\\") j++;
        else if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) return j + 1 + /^[a-z]*/.exec(source.slice(j + 1))[0].length;
    }
    return -1;
}

// ---- the markers ------------------------------------------------------------------------------

const VALUE = /^\/\/\s*→\s?(.*)$/;
const THROWS = /^\/\/\s*throws\b(.*)$/;
const THROWS_REST = /^\s*([A-Za-z_$][\w$]*)?\s*(?::\s?(.*))?$/;
const CONSOLE = /^\/\/\s*console\.(log|info|warn|error|debug)\s*:\s?(.*)$/;
const LOOKALIKE = /^\/\/\s*(?:->|=>|⇒|➔)\s/;
const CONTINUATION = /^\/\/ {2,}(\S.*)$/;

// What a comment says, if it is a marker: { kind: "value" | "throws" | "console", ... }, or
// { error } for one that is written wrong.
export function readMarker(text) {
    let m;
    if ((m = VALUE.exec(text))) {
        const value = m[1].trim();
        if (!value) {
            return { error: "a `// →` marker shows a value: `// → 3`, `// → \"live\"`, `// → <p>Hi</p>`" };
        }
        return { kind: "value", text: value };
    }
    if ((m = THROWS.exec(text))) {
        const rest = THROWS_REST.exec(m[1]);
        if (!rest) {
            return {
                error: "a `// throws` marker reads `// throws TypeError: start of the message` "
                    + "(the name and the message are each optional)",
            };
        }
        return { kind: "throws", name: rest[1] ?? null, message: rest[2]?.trim() || null };
    }
    if ((m = CONSOLE.exec(text))) {
        if (!m[2].trim()) return { error: `a \`// console.${m[1]}:\` marker shows the start of the line written` };
        return { kind: "console", method: m[1], text: m[2].trim() };
    }
    if (LOOKALIKE.test(text)) return { error: "a result is shown as `// → value` (the arrow is →, U+2192)" };
    return null;
}

// ---- turning a block into a program that checks itself -----------------------------------------

const DECLARATION = new Set(["const", "let", "var"]);
const NOT_AN_EXPRESSION = new Set([
    "if", "for", "while", "do", "switch", "try", "class", "function", "import", "export", "throw", "break",
    "continue", "async", "else", "case", "default", "label",
]);

// Builds one example: the setup blocks, then the block, as one module, with each statement that
// carries a marker wrapped in a call to the child's `__check`. Inserts only, never a newline, so
// the program's lines are the markdown's lines. Answers { source, original, lines, checks, errors }:
// `lines[n]` is the markdown line of the program's line n + 1, `checks` what the child is to
// check, and `errors` the markers written wrong, each with its markdown line.
export function buildProgram(block) {
    const parts = [...block.setups, block];
    const original = parts.map((part) => part.code).join("\n");
    const lines = parts.flatMap((part) => part.code.split("\n").map((_, n) => part.firstLine + n));
    const ownFirst = lines.length - block.code.split("\n").length; // the block's first program line, 0-based
    const lineStarts = [0];
    for (let i = 0; i < original.length; i++) if (original[i] === "\n") lineStarts.push(i + 1);
    const lineOf = (offset) => {
        let low = 0;
        let high = lineStarts.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (lineStarts[mid] <= offset) low = mid;
            else high = mid - 1;
        }
        return low; // 0-based program line
    };
    const mdLine = (programLine) => lines[programLine];

    const { tokens, comments } = tokenize(original);
    const errors = [];
    const groups = new Map(); // index of a statement's `;` -> { markers }

    // Comment lines that belong to a marker standing on its own line: the marker and what continues it.
    const markerLines = new Set();
    const lastTokenBefore = (offset) => {
        let low = 0;
        let high = tokens.length - 1;
        let found = -1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            if (tokens[mid].end <= offset) {
                found = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return found;
    };

    const own = comments.filter((comment) => lineOf(comment.start) >= ownFirst);
    for (let n = 0; n < own.length; n++) {
        const comment = own[n];
        const marker = readMarker(comment.text);
        if (!marker) continue;
        const line = lineOf(comment.start);
        if (marker.error) {
            errors.push({ line: mdLine(line), message: marker.error });
            continue;
        }
        // The lines under it that continue it.
        const more = [];
        for (let k = n + 1; k < own.length; k++) {
            const next = own[k];
            const continued = CONTINUATION.exec(next.text);
            const alone = original.slice(lineStarts[lineOf(next.start)], next.start).trim() === "";
            if (!continued || !alone || lineOf(next.start) !== line + more.length + 1) break;
            more.push(continued[1].trim());
            markerLines.add(lineOf(next.start));
            n = k;
        }
        if (more.length) {
            if (marker.kind === "value") {
                // HTML goes on where it was cut; a JS value is read across lines.
                const joint = marker.text.startsWith("<") ? "" : "\n";
                marker.text += joint + more.join(joint);
            } else if (marker.kind === "throws") {
                marker.message = [marker.message, ...more].filter(Boolean).join(" ");
            } else {
                marker.text += ` ${more.join(" ")}`;
            }
        }
        marker.line = mdLine(line);

        const alone = original.slice(lineStarts[line], comment.start).trim() === "";
        const before = lastTokenBefore(comment.start);
        if (alone) {
            markerLines.add(line);
            let above = line - 1;
            while (above >= 0 && markerLines.has(above)) above--;
            if (before === -1 || lineOf(tokens[before].start) !== above || tokens[before].text !== ";") {
                errors.push({
                    line: marker.line,
                    message: "a marker on its own line goes right under the statement it is about, which ends with `;`",
                });
                continue;
            }
        } else if (before === -1 || lineOf(tokens[before].start) !== line || tokens[before].text !== ";") {
            errors.push({
                line: marker.line,
                message: "the statement a marker is about ends with `;` on the marker's line",
            });
            continue;
        }
        if (!groups.has(before)) groups.set(before, { end: before, markers: [] });
        groups.get(before).markers.push(marker);
    }

    // Each statement: where it starts, what it is, and the text to insert around it.
    const inserts = []; // [offset, text], applied in the order given at one offset
    const checks = [];
    for (const group of groups.values()) {
        const semicolon = tokens[group.end];
        const level = semicolon.level;
        let start = group.end - 1;
        while (start >= 0) {
            const token = tokens[start];
            if (token.level < level) break;
            if (token.level === level) {
                if (token.text === ";") break;
                // A block's `}` ends a statement when what follows it is on a later line.
                const blockEnd = token.text === "}" && token.kind === "punct";
                if (blockEnd && lineOf(tokens[start + 1].start) > lineOf(token.start)) break;
            }
            start--;
        }
        const enclosing = start >= 0 && tokens[start].level < level ? tokens[start] : null;
        const first = tokens[start + 1];
        const line = group.markers[0].line;
        if (enclosing && enclosing.text !== "{") {
            errors.push({ line, message: "a marker is about a statement; this `;` is inside brackets" });
            continue;
        }
        const value = group.markers.filter((marker) => marker.kind === "value");
        const thrown = group.markers.filter((marker) => marker.kind === "throws");
        const logged = group.markers.filter((marker) => marker.kind === "console");
        if (value.length > 1 || thrown.length > 1 || (value.length && thrown.length)) {
            errors.push({
                line,
                message: "a statement shows one result: a value (`// →`) or an error (`// throws`), once",
            });
            continue;
        }
        const id = checks.length;
        const check = { id, line, value: value[0] ?? null, throws: thrown[0] ?? null, console: logged };
        const statement = tokens.slice(start + 1, group.end + 1);
        const atStart = [];
        const atEnd = [];
        if (logged.length) atStart.push(`__check.mark(${id}); `);
        if (check.throws) {
            const awaits = statement.some((token) => token.kind === "word" && token.text === "await");
            atStart.push(awaits ? `await __check.throws(${id}, async () => { ` : `__check.throwsSync(${id}, () => { `);
            atEnd.push(" });");
        }
        if (check.value) {
            if (DECLARATION.has(first.text)) {
                const name = tokens[start + 2];
                if (name?.kind !== "word" || tokens[start + 3]?.text !== "=") {
                    errors.push({
                        line,
                        message: "`// →` after a declaration shows the one name it declares (`const total = …;`), "
                            + "not a pattern",
                    });
                    continue;
                }
                atEnd.push(` __check.value(${id}, ${name.text});`);
            } else if (first.text === "return") {
                if (group.end === start + 2) {
                    errors.push({ line, message: "`// →` after `return;` has no value to show" });
                    continue;
                }
                inserts.push([tokens[start + 2].start, `__check.value(${id}, (`]);
                inserts.push([semicolon.start, "))"]);
            } else if (first.kind === "word" && NOT_AN_EXPRESSION.has(first.text)) {
                errors.push({
                    line,
                    message: "`// →` shows the value of an expression; "
                        + `this statement starts with \`${first.text}\``,
                });
                continue;
            } else if (first.text === "{") {
                errors.push({ line, message: "`// →` shows the value of an expression; this statement is a block" });
                continue;
            } else {
                atStart.push(`__check.value(${id}, (`);
                inserts.push([semicolon.start, "))"]);
            }
        }
        if (logged.length) atEnd.push(` __check.saw(${id});`);
        inserts.push([first.start, atStart.join("")]);
        inserts.push([semicolon.end, atEnd.join("")]);
        checks.push(check);
    }

    inserts.sort((a, b) => a[0] - b[0]); // stable: inserts at one offset keep their order
    let source = "";
    let at = 0;
    for (const [offset, text] of inserts) {
        source += original.slice(at, offset) + text;
        at = offset;
    }
    source += original.slice(at);
    return { source, original, lines, checks, errors };
}

// ---- running ----------------------------------------------------------------------------------

function kindOf(block) {
    if (block.tags.includes("browser") || block.tags.includes("excerpt")) return "parse";
    if (block.tags.includes("setup")) return "setup";
    return "run";
}

// The examples of the given files, checked. Answers { files, results, failures, known, counts, ms,
// dir, kept }: `dir` is where the programs were written, removed unless `keep`. Each result is
// { file, block, kind, dom, ok, known, problems: [{ line, message }], output }.
export async function checkExamples(files, options = {}) {
    const { jobs = availableParallelism(), timeout = DEFAULT_TIMEOUT, keep = false } = options;
    const started = Date.now();
    const examples = [];
    for (const file of files) {
        const markdown = await readFile(file, "utf8");
        for (const block of extractBlocks(markdown)) {
            if (!JS_LANGUAGES.has(block.lang)) continue;
            examples.push({ file, block });
        }
    }
    const dir = await mkdtemp(join(KIT, ".examples-"));
    const results = [];
    try {
        let next = 0;
        const worker = async () => {
            while (next < examples.length) {
                const n = next++;
                results[n] = await checkOne(examples[n], n, dir, timeout);
            }
        };
        await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, examples.length)) }, worker));
    } finally {
        if (!keep) await rm(dir, { recursive: true, force: true });
    }
    const counts = { blocks: results.length, run: 0, parse: 0, setup: 0, dom: 0, failed: 0, known: 0 };
    for (const result of results) {
        counts[result.kind]++;
        if (result.dom) counts.dom++;
        if (!result.ok) counts.failed++;
        if (result.known) counts.known++;
    }
    return {
        files,
        results,
        failures: results.filter((result) => !result.ok),
        known: results.filter((result) => result.known),
        counts,
        ms: Date.now() - started,
        dir,
        kept: keep,
    };
}

async function checkOne({ file, block }, n, dir, timeout) {
    const kind = kindOf(block);
    const dom = block.tags.includes("dom") || block.setups.some((setup) => setup.tags.includes("dom"));
    const result = { file, block, kind, dom, ok: true, known: false, problems: [], output: "" };
    const unknown = block.tags.filter((tag) => !TAGS.has(tag));
    if (unknown.length) {
        const named = unknown.map((tag) => `"${tag}"`).join(", ");
        const known = [...TAGS].join(", ");
        result.problems.push({ line: block.line, message: `unknown tag ${named} (the tags are ${known})` });
    }
    const program = buildProgram(block);
    result.problems.push(...program.errors);
    const original = join(dir, `example-${n}.original.mjs`);
    await writeFile(original, program.original);
    if (kind === "parse" || result.problems.length) {
        const checked = await run(process.execPath, ["--check", original], { timeout });
        if (checked.code !== 0) result.problems.push(syntaxProblem(checked.output, original, program, block));
        if (kind !== "parse") result.output = checked.output;
    } else {
        const file = join(dir, `example-${n}.mjs`);
        await writeFile(file, program.source);
        const answer = await runChild({ file, checks: program.checks, dom }, timeout);
        result.output = answer.output;
        if (answer.error?.name === "SyntaxError" && !/example-\d+\.mjs:\d+/.test(answer.error.stack)) {
            // The module did not parse: the writer's code (Node's check of it says where), or, if
            // that parses, the checker's rewrite of it.
            const checked = await run(process.execPath, ["--check", original], { timeout });
            if (checked.code !== 0) result.problems.push(syntaxProblem(checked.output, original, program, block));
            else {
                result.problems.push({
                    line: block.line,
                    message: "the block parses, but the checker's rewrite of it does not "
                        + `(a bug in check-examples.mjs): ${answer.error.message}`,
                });
            }
        } else {
            result.problems.push(...problemsOf(answer, file, program, block));
        }
    }
    result.problems.sort((a, b) => a.line - b.line);
    result.ok = result.problems.length === 0;
    if (block.tags.includes("known-failure")) {
        if (result.ok) {
            result.ok = false;
            result.problems.push({
                line: block.line,
                message: "a known failure that passes now: take the known-failure tag off",
            });
        } else if (!program.errors.length) {
            result.known = true;
            result.ok = true;
        }
    }
    return result;
}

function run(command, args, { timeout }) {
    return new Promise((resolvePromise) => {
        const child = spawn(command, args, { cwd: KIT, env: childEnv() });
        let output = "";
        child.stdout.on("data", (data) => (output += data));
        child.stderr.on("data", (data) => (output += data));
        const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
        child.on("close", (code) => {
            clearTimeout(timer);
            resolvePromise({ code, output });
        });
    });
}

function runChild(config, timeout) {
    return new Promise((resolvePromise) => {
        const child = fork(CHILD, [], {
            cwd: dirname(config.file),
            env: childEnv(),
            silent: true,
            serialization: "advanced",
        });
        let output = "";
        let answer = null;
        let timedOut = false;
        child.stdout.on("data", (data) => (output += data));
        child.stderr.on("data", (data) => (output += data));
        child.on("message", (message) => (answer = message));
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, timeout);
        child.on("close", (code) => {
            clearTimeout(timer);
            if (timedOut) resolvePromise({ timedOut: true, timeout, output });
            else if (!answer) resolvePromise({ crashed: true, code, output });
            else resolvePromise({ ...answer, output });
        });
        child.send(config);
    });
}

function childEnv() {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // a child of `node --test` would otherwise report to it
    return env;
}

// The markdown line of the first place an error's stack names in the program.
function lineInStack(text, file, program) {
    const pattern = new RegExp(`${escapeRegExp(pathToFileURL(file).href)}:(\\d+)|${escapeRegExp(file)}:(\\d+)`);
    const m = pattern.exec(text ?? "");
    if (!m) return null;
    return program.lines[Number(m[1] ?? m[2]) - 1] ?? null;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function syntaxProblem(output, file, program, block) {
    const line = lineInStack(output, file, program) ?? block.line;
    const message = /SyntaxError: [^\n]*/.exec(output)?.[0] ?? output.trim().split("\n").pop();
    return { line, message: `does not parse as an ES module: ${message}` };
}

function problemsOf(answer, file, program, block) {
    if (answer.timedOut) return [{ line: block.line, message: `did not finish in ${answer.timeout} ms` }];
    if (answer.crashed) {
        return [{ line: block.line, message: `the example's process ended (code ${answer.code}) before it reported` }];
    }
    const problems = [];
    for (const failure of answer.failures) {
        problems.push({ line: program.checks[failure.id]?.line ?? block.line, message: failure.message });
    }
    for (const check of program.checks) {
        if (answer.reached.includes(check.id) || answer.error) continue;
        problems.push({ line: check.line, message: "its statement never ran" });
    }
    if (answer.error) {
        const line = lineInStack(answer.error.stack, file, program) ?? block.line;
        problems.push({ line, message: `threw ${answer.error.name}: ${answer.error.message}` });
    }
    for (const rejection of answer.rejections) {
        const line = lineInStack(rejection.stack, file, program) ?? block.line;
        problems.push({ line, message: `left a rejected promise unhandled: ${rejection.name}: ${rejection.message}` });
    }
    return problems;
}

// ---- the report -------------------------------------------------------------------------------

export function formatReport(report, { verbose = false, cwd = process.cwd() } = {}) {
    const { counts } = report;
    const out = [];
    const shown = (file) => {
        const near = relative(cwd, file);
        return near && !near.startsWith("..") ? near : file;
    };
    const where = (result) => `${shown(result.file)}:${result.block.line}`;
    const under = (result) => result.block.headings.join(" › ") || "(before the first heading)";
    const describe = (result, mark) => {
        out.push(`${mark} ${where(result)}  ${under(result)}`);
        for (const problem of result.problems) {
            const [first, ...rest] = problem.message.split("\n");
            out.push(`    line ${problem.line}: ${first}`);
            for (const line of rest) out.push(`      ${line}`);
        }
        const output = result.output.trim();
        if (output && (!result.ok || result.known)) {
            out.push("    its output:");
            for (const line of output.split("\n").slice(0, 20)) out.push(`      | ${line}`);
        }
    };
    if (verbose) {
        for (const result of report.results) {
            if (!result.ok || result.known) continue;
            out.push(`✓ ${where(result)}  ${result.kind}${result.dom ? " dom" : ""}  ${under(result)}`);
        }
    }
    for (const result of report.failures) describe(result, "✗");
    if (report.known.length) {
        out.push("", "Known failures (the contract and the code disagree; tagged known-failure):");
        for (const result of report.known) describe(result, "~");
    }
    const parts = [`${counts.run} run`, `${counts.setup} setup`, `${counts.parse} parse-only`];
    if (counts.dom) parts.push(`${counts.dom} with the stand-in DOM`);
    const verdict = counts.failed ? `${counts.failed} failed` : "all passed";
    const known = counts.known ? `, ${counts.known} known failure${counts.known === 1 ? "" : "s"}` : "";
    const seconds = (report.ms / 1000).toFixed(1);
    if (report.failures.length || report.known.length) out.push("");
    out.push(`check-examples: ${counts.blocks} js blocks (${parts.join(", ")}): ${verdict}${known}, in ${seconds} s`);
    if (report.kept) out.push(`The programs are kept in ${report.dir}`);
    return out.join("\n");
}

// ---- the command ------------------------------------------------------------------------------

async function main(argv) {
    const files = [];
    const options = {};
    let verbose = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--jobs") options.jobs = Number(argv[++i]);
        else if (arg === "--timeout") options.timeout = Number(argv[++i]);
        else if (arg === "--keep") options.keep = true;
        else if (arg === "--verbose") verbose = true;
        else if (arg === "--help" || arg === "-h") return usage(0);
        else if (arg.startsWith("--")) return usage(2, `unknown option ${arg}`);
        else files.push(resolve(arg));
    }
    if (!files.length) return usage(2, "name at least one markdown file");
    const report = await checkExamples(files, options);
    console.log(formatReport(report, { verbose }));
    process.exitCode = report.failures.length ? 1 : 0;
}

function usage(code, problem) {
    if (problem) console.error(`check-examples: ${problem}`);
    console.error(
        "usage: node scripts/check-examples.mjs <file.md> [more.md ...] [--jobs N] [--timeout ms] [--verbose] [--keep]",
    );
    process.exitCode = code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main(process.argv.slice(2));
}

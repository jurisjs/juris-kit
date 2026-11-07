// The server area's regressions: http.js (sendFile), kernel.js (the page pipeline, the lifecycle,
// the whole server), page-cache.js, minify.js and modules.js. Real HTTP servers on port 0 and
// temporary directories, each cleaned up. `node --test tests/server.test.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import vm from "node:vm";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, writeFile, readFile, readdir, mkdir } from "node:fs/promises";
import { readdirSync } from "node:fs";
import Juris from "juris/juris.js";
import { createRouter } from "juris/router.js";
import { sendFile, pack, send, onThisSite } from "../server/http.js";
import { createPagePipeline, createLifecycle, createJurisServer } from "../server/kernel.js";
import { createPageCache } from "../server/page-cache.js";
import SSRRenderer from "../server/ssr-renderer.js";
import { inlineScriptHashes } from "../server/document.js";
import { createHash } from "node:crypto";
import { minifyJs, minifyCss, jsTokens } from "../server/minify.js";
import { createModuleServer } from "../server/modules.js";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = promisify(execFile);

async function tempDir() {
    return mkdtemp(path.join(os.tmpdir(), "juris-server-test-"));
}

// A server on port 0 around `handler`, and a way to close it.
async function serve(handler) {
    const server = http.createServer(handler);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    return {
        port,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
    };
}

// A GET that answers { status, headers, body } (the body as text).
function get(port, pathname, headers = {}) {
    return new Promise((resolve, reject) => {
        http.get({ host: "127.0.0.1", port, path: pathname, headers, agent: false }, (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => { body += chunk; });
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
        }).on("error", reject);
    });
}

// ---- F21: sendFile and aborted downloads -----------------------------------------------------

// The process's open file descriptors, by the directory the OS lists them in.
const openFds = () => {
    for (const dir of ["/dev/fd", "/proc/self/fd"]) {
        try { return readdirSync(dir).length; } catch { /* try the next */ }
    }
    return null;
};

// Starts a download of `pathname`, reads its first chunk, and cuts the connection.
function abortAfterFirstChunk(port, pathname, headers = {}) {
    return new Promise((resolve, reject) => {
        const req = http.get({ host: "127.0.0.1", port, path: pathname, headers, agent: false }, (res) => {
            res.once("data", () => { req.destroy(); res.destroy(); resolve(res.statusCode); });
        });
        req.on("error", (error) => { if (error.code !== "ECONNRESET") reject(error); });
    });
}

test("F21 sendFile: an aborted download, whole or ranged, closes the file it was reading", async (t) => {
    if (openFds() === null) return t.skip("no /dev/fd or /proc/self/fd to count descriptors with");
    const dir = await tempDir();
    const file = path.join(dir, "big.bin");
    await writeFile(file, Buffer.alloc(32 * 1024 * 1024, 7));
    const server = await serve((req, res) => { sendFile(req, res, file, { type: "application/octet-stream" }).catch(() => res.destroy()); });
    try {
        // Warm up (the first connection opens what the process keeps open anyway).
        await abortAfterFirstChunk(server.port, "/");
        await sleep(100);
        const before = openFds();
        const n = 10;
        const statuses = [];
        for (let i = 0; i < n; i++) statuses.push(await abortAfterFirstChunk(server.port, "/"));
        for (let i = 0; i < n; i++) statuses.push(await abortAfterFirstChunk(server.port, "/", { range: `bytes=${i * 1000}-` }));
        assert.deepEqual(statuses, [...Array(n).fill(200), ...Array(n).fill(206)]);
        await sleep(300);
        const after = openFds();
        assert.ok(after - before < 3, `file descriptors leaked: ${before} before, ${after} after ${2 * n} aborted downloads`);
    } finally {
        await server.close();
        await rm(dir, { recursive: true, force: true });
    }
});

test("F21 sendFile: a download read to the end still arrives whole, ranged or not", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "small.txt");
    await writeFile(file, "0123456789");
    const server = await serve((req, res) => { sendFile(req, res, file, { type: "text/plain" }); });
    try {
        const whole = await get(server.port, "/");
        assert.equal(whole.status, 200);
        assert.equal(whole.body, "0123456789");
        const part = await get(server.port, "/", { range: "bytes=2-4" });
        assert.equal(part.status, 206);
        assert.equal(part.body, "234");
    } finally {
        await server.close();
        await rm(dir, { recursive: true, force: true });
    }
});

// ---- the page pipeline: a small app ---------------------------------------------------------

// A server instance with `routes`, the App layout around a RouterView, and `components`; it renders
// to a string with the kit's renderer, as the kernel's own instance does.
async function appOf({ services, routes, components = {} }) {
    const juris = new Juris({ services, isServer: true, requirePreload: true, features: { ssr: SSRRenderer } });
    const router = createRouter({ routes });
    juris.use(router);
    juris.registerComponent("App", () => ({ main: { children: [{ RouterView: {} }] } }));
    for (const [name, component] of Object.entries(components)) juris.registerComponent(name, component);
    await router.loadAll();
    return { juris, router };
}

const titleIn = (html) => /<title>([^<]*)<\/title>/.exec(html)?.[1];

// ---- F22: an async extra ---------------------------------------------------------------------

test("F22 pipeline: an extra that answers a promise reaches the route's preload as its value", async () => {
    const seen = [];
    const { juris, router } = await appOf({
        services: { async who(id) { seen.push(id); return { name: `user ${id}` }; } },
        routes: [{ path: "/", name: "home", component: "Home", preload: ({ viewerId }) => [["who", viewerId ?? "nobody"]], head: { titleFrom: (who) => who?.name } }],
        components: { Home: () => ({ p: { textContent: "home" } }) },
    });
    const pipeline = createPagePipeline({
        juris, router, entry: "/boot.js",
        viewer: (req) => (req.headers["x-user"] ? { id: req.headers["x-user"] } : null),
        extra: async (viewer) => { await sleep(1); return { viewerId: viewer?.id ?? null }; },
    });
    // render(): the extra is awaited.
    const page = await pipeline.render("/", { id: "u1" });
    assert.equal(titleIn(page.body.toString()), "user u1");
    // handle(): the extra is awaited there too (the route it resolves is the one rendered).
    const server = await serve((req, res) => pipeline.handle(req, res));
    try {
        const answer = await get(server.port, "/", { "x-user": "u2" });
        assert.equal(answer.status, 200);
        assert.equal(titleIn(answer.body), "user u2");
        assert.deepEqual(seen, ["u1", "u2"]);
    } finally {
        await server.close();
    }
});

// ---- F23: the lifecycle's timers --------------------------------------------------------------

test("F23 lifecycle: an interval or a timeout Node cannot keep is refused when it is made", () => {
    const job = (every) => ({ jobs: [{ name: "j", every, run: () => {} }], build: "b" });
    for (const every of [2 ** 31, 30 * 24 * 3600 * 1000, 1.5, 0, -1, Infinity, NaN, "10"]) {
        assert.throws(() => createLifecycle(job(every)), TypeError, `every: ${String(every)}`);
    }
    assert.doesNotThrow(() => createLifecycle(job(2 ** 31 - 1)));
    assert.doesNotThrow(() => createLifecycle(job(1)));
    for (const timeoutMs of [2 ** 31, 1.5, -1, Infinity, NaN, "5", 0]) {
        assert.throws(() => createLifecycle({ build: "b", health: { check: () => {}, timeoutMs } }), TypeError, `timeoutMs: ${String(timeoutMs)}`);
    }
    assert.doesNotThrow(() => createLifecycle({ build: "b", health: { timeoutMs: 2 ** 31 - 1 } }));
});

test("F23 createJurisServer: a closeTimeoutMs Node cannot keep is refused; 0 (cut at once) is not", async () => {
    const base = { root: REPO, build: "b", services: {}, routes: [], modules: { entry: "/app/x.js" } };
    for (const closeTimeoutMs of [2 ** 31, 1.5, -1, Infinity, NaN]) {
        await assert.rejects(createJurisServer({ ...base, closeTimeoutMs }), /closeTimeoutMs/, `closeTimeoutMs: ${String(closeTimeoutMs)}`);
    }
    // 0 passes the check (the construction then fails later, on the entry, which is another matter).
    await assert.rejects(createJurisServer({ ...base, closeTimeoutMs: 0 }), (error) => !/closeTimeoutMs/.test(error.message));
});

test("F23 lifecycle: a job slower than its interval never runs beside itself; the ticks it misses are counted", async () => {
    let active = 0;
    let most = 0;
    let runs = 0;
    const errors = [];
    const life = createLifecycle({
        build: "b",
        onError: (error, where) => errors.push([where, error]),
        jobs: [{ name: "slow", every: 5, atStart: true, run: async () => { runs++; active++; most = Math.max(most, active); await sleep(40); active--; } }],
    });
    life.start();
    await sleep(150);
    await life.stop();
    assert.equal(most, 1, "two runs of one job overlapped");
    assert.ok(runs >= 2 && runs <= 5, `ran ${runs} times`);
    assert.ok(life.skipped.slow > 0, "the skipped ticks are counted");
    assert.deepEqual(errors, []);
});

// ---- F24: the page cache ----------------------------------------------------------------------

// A route whose title, status and state come from its own call, while its body calls nothing.
async function ownCallApp() {
    let name = "first";
    const app = await appOf({
        services: { async item(id) { return id === "gone" ? null : { name: `${name} ${id}` }; } },
        routes: [{ path: "/items/:id", name: "item", component: "Plain", preload: ({ params }) => [["item", params.id]], head: { titleFrom: (item) => item?.name } }],
        components: { Plain: () => ({ p: { textContent: "a page that calls nothing" } }) },
    });
    return { ...app, rename: (next) => { name = next; } };
}

test("F24a the route's own call counts as read: a page titled from it is kept on that service, and evicted by it", async () => {
    const { juris, router, rename } = await ownCallApp();
    const cache = createPageCache();
    const decisions = [];
    const pipeline = createPagePipeline({
        juris, router, entry: "/boot.js", cache,
        notFound: (own) => own === null,
        onRender: ({ key, decision }) => decisions.push([key, decision]),
    });
    const server = await serve((req, res) => pipeline.handle(req, res));
    try {
        const first = await get(server.port, "/items/a");
        assert.equal(titleIn(first.body), "first a");
        const [[key, decision]] = decisions;
        assert.equal(key, "/items/a");
        assert.equal(decision.cache, true);
        assert.equal(decision.forever, false, "a page whose title is a service's answer is not static");
        assert.deepEqual(decision.services, ["item"]);
        // A change to that service evicts it, and the next guest gets the new title.
        rename("second");
        cache.invalidate(["item"]);
        assert.equal(cache.has("/items/a"), false);
        assert.equal(titleIn((await get(server.port, "/items/a")).body), "second a");
    } finally {
        await server.close();
    }
});

const STATIC_TRACE = Object.freeze({ reactive: 0, paths: [], roots: [], calls: [], services: [], live: [], flags: [], unknown: [], failed: [], static: true });

test("F24b a static page rendered across a $pages invalidation or a clear() is refused", () => {
    const cache = createPageCache();
    const page = pack("<p>old</p>");
    let snapshot = cache.snapshot();
    cache.invalidate(["$pages"]);
    const raced = cache.put("/", page, STATIC_TRACE, {}, snapshot);
    assert.equal(raced.cache, false);
    assert.equal(raced.reason, "raced");
    assert.equal(cache.has("/"), false);

    snapshot = cache.snapshot();
    cache.clear();
    assert.equal(cache.put("/", page, STATIC_TRACE, {}, snapshot).cache, false);
    assert.equal(cache.has("/"), false);

    // A named change says nothing about a page that read no service.
    snapshot = cache.snapshot();
    cache.invalidate(["item"]);
    assert.equal(cache.put("/", page, STATIC_TRACE, {}, snapshot).cache, true);
    assert.equal(cache.has("/"), true);
});

test("F24c a signed-in viewer's page view leaves the guests' copy where it is", async () => {
    const { juris, router } = await ownCallApp();
    const cache = createPageCache();
    const decisions = [];
    const pipeline = createPagePipeline({
        juris, router, entry: "/boot.js", cache,
        viewer: (req) => (req.headers["x-user"] ? { id: req.headers["x-user"] } : null),
        onRender: ({ decision }) => decisions.push(decision),
    });
    const server = await serve((req, res) => pipeline.handle(req, res));
    try {
        await get(server.port, "/items/a");
        assert.equal(cache.has("/items/a"), true);
        const signedIn = await get(server.port, "/items/a", { "x-user": "u1" });
        assert.match(signedIn.headers["cache-control"], /private/);
        assert.equal(cache.has("/items/a"), true, "the guests' copy was dropped by a viewer's page view");
        assert.deepEqual(decisions.map((decision) => decision.reason), ["dependent", "personal"]);
        assert.equal(cache.stats().dropped, 0);
    } finally {
        await server.close();
    }
});

// ---- F25: minify ------------------------------------------------------------------------------

// What `code` leaves in `result`, run as a script.
const outcome = (code) => {
    const context = vm.createContext({});
    try {
        vm.runInContext(code, context);
        return { result: JSON.stringify(context.result) };        // a value of this realm, to compare
    } catch (error) {
        return { error: `${error.name}: ${error.message}` };
    }
};

const sameMeaning = (code) => {
    const minified = minifyJs(code);
    const before = outcome(code);
    assert.ok(!before.error, `the case itself fails: ${before.error}`);
    assert.deepEqual(outcome(minified), before, `minified to:\n${minified}`);
};

test("F25a minifyJs: a regex after the ) of if/while/for, and after a block's }, is a regex", () => {
    sameMeaning('var hit = 0; var u = "https://a"; if (u) /^https?:\\/\\//.test(u) && hit++; result = hit;');
    sameMeaning('var r = 0, x = 1, y = "a  b"; if (x) /a  b/.test(y) && r++; result = r;');
    sameMeaning('var r = 0, n = 0; while (n++ < 1) /a  b/.test("a  b") && r++; result = r;');
    sameMeaning('var r = 0; for (var k = 0; k < 1; k++) /a  b/.test("a  b") && r++; result = r;');
    sameMeaning('var r = 0; if (true) {} /a  b/.test("a  b") && r++; result = r;');
    sameMeaning('var r = 0; function g() {} /a  b/.test("a  b") && r++; result = r;');
    sameMeaning('var r = 0; switch (1) { default: /a  b/.test("a  b") && r++; } result = r;');
    sameMeaning('var r = typeof /a  b/; result = r;');
    sameMeaning('var r = []; do /a  b/.test("a  b") && r.push(1); while (false); result = r.length;');
    sameMeaning('const f = () => {}\n/a  b/.test("a  b") && (result = 1)');
    sameMeaning('class A {} /a  b/.test("a  b") && (result = 2)');
    sameMeaning('lbl: { break lbl } /a  b/.test("a  b") && (result = 3)');
    sameMeaning('switch (1) { case 1: { result = 0 } /a  b/.test("a  b") && (result = 4) }');
    sameMeaning('try {} finally {} /a  b/.test("a  b") && (result = 5)');
    sameMeaning('var r = 0; for (var s of [1]) /a  b/.test("a  b") && r++; result = r;');
});

test("F25a minifyJs: a / after an object literal's } or an expression's ) is division", () => {
    sameMeaning('var o = {} / 2 + "x/  y"; result = o;');
    sameMeaning('var a = 4; result = (a) / 2 + "x/  y" + (a) / 4;');
    sameMeaning('var o = { a: {} / 2 + "p/  q" }; result = o.a;');
    sameMeaning('var x = { return: 6 }; result = x.return / 2 + "x/  y" + x.return / 3;');
    sameMeaning('var i = 3; i++ / 2; result = i++ / 2 + "a/  b";');
    sameMeaning('var t = `a${ {} / 2 + "x/  y" }b`; result = t;');
    sameMeaning('var t = `a${ (() => { return /x  y/.source; })() }b`; result = t;');
    sameMeaning('var o = {a: 1}\nvar r = 0; result = [o / 2 + "x/  y"]');
    sameMeaning('var x = true ? {} : 1; result = [x / 2 + "x/  y"]');
    sameMeaning('var o = { a: true ? {} : 1 }; result = [o.a / 2 + "x/  y"]');
    sameMeaning('var a = [1] / 2 + "x/  y"; result = a');
    sameMeaning('var of = 6; result = [of / 2, "a/  b"]');
    sameMeaning('var a = {}; a.if = 4; result = a.if / 2 + "q/  r"');
    sameMeaning('var n = null; result = (n ?? {}) / 2 + "q/  r" + (n?.x ?? 1) / 2 + "s/  t"');
    sameMeaning('var s = `x${`y${1 + 1}  z`}  w`; result = s');
});

test("F25c minifyJs: a bare \\r, U+2028 and U+2029 are line terminators", () => {
    sameMeaning("function f() { var x = 5; return\rx } result = f();");
    sameMeaning("function f() { var x = 5; return\u2028x } result = f();");
    sameMeaning("function f() { var x = 5; return\u2029x } result = f();");
    sameMeaning("function f() { var x = 5; return  \r  x } result = f();");
    sameMeaning("result = 1; // a comment\u2028result = 2;");
    sameMeaning("result = 1; // a comment\rresult = 3;");
    sameMeaning("function f() { var x = 5; return /* a\u2028b */ x } result = f();");
});

test("F25 minifyJs: every browser module of the framework minifies to code node --check accepts", async () => {
    const files = [];
    for (const dir of [path.dirname(fileURLToPath(import.meta.resolve("juris"))), path.join(REPO, "server")]) {
        for (const name of await readdir(dir)) if (name.endsWith(".js")) files.push(path.join(dir, name));
    }
    assert.ok(files.length > 20);
    const out = await tempDir();
    try {
        await Promise.all(files.map(async (file, i) => {
            const source = await readFile(file, "utf8");
            assert.equal(jsTokens(source).map((token) => token.text).join(""), source, `${file}: the tokens are not the source`);
            const minified = minifyJs(source);
            assert.ok(minified.length < source.length, file);
            const target = path.join(out, `${i}-${path.basename(file, ".js")}.mjs`);
            await writeFile(target, minified);
            await run(process.execPath, ["--check", target]).catch((error) => assert.fail(`${file} minifies to code that does not parse:\n${error.stderr}`));
        }));
    } finally {
        await rm(out, { recursive: true, force: true });
    }
});

test("F25b minifyCss: strings are left alone, a comment joins a compound selector, a space before : is kept", () => {
    assert.equal(minifyCss('.a { content: "x;}"; }'), '.a{content:"x;}"}');
    assert.equal(minifyCss(".a { content: 'a;;b' ; ; }"), ".a{content:'a;;b'}");
    assert.equal(minifyCss(".a/**/.b { color: red; }"), ".a.b{color:red}");
    assert.equal(minifyCss(".a /**/ .b { color: red; }"), ".a .b{color:red}");
    assert.equal(minifyCss(".a { margin: 0/**/auto; }"), ".a{margin:0 auto}");
    assert.equal(minifyCss(".card { .title :first-child { color: red; } }"), ".card{.title :first-child{color:red}}");
    assert.equal(minifyCss(".a :is(.b) { color: red; }"), ".a :is(.b){color:red}");
    assert.equal(minifyCss("a:hover { color : red ; ; }"), "a:hover{color :red}");
    assert.equal(minifyCss("@media (min-width: 10px) { .a :hover { x: y } }"), "@media (min-width:10px){.a :hover{x:y}}");
});

// ---- F25d, F25e: the module server ------------------------------------------------------------

async function moduleApp(files) {
    const root = await tempDir();
    await mkdir(path.join(root, "app"), { recursive: true });
    for (const [name, text] of Object.entries(files)) await writeFile(path.join(root, "app", name), text);
    return root;
}

async function served(modules, pathname) {
    let status, body = "";
    const res = {
        writeHead(code) { status = code; },
        end(chunk) { if (chunk) body += Buffer.isBuffer(chunk) ? chunk.toString() : chunk; },
    };
    await modules.handle({ headers: {} }, res, new URL(pathname, "http://localhost"));
    return { status, body };
}

test("F25d import stamping: only specifiers in code, and a template with no substitution given to import()", async () => {
    const root = await moduleApp({
        "a.js": [
            'import { b } from "./b.js";',
            'export const text = \'see: import x from "./b.js"\';',
            '// import y from "./b.js";',
            '/* import("./b.js") */',
            "export const later = () => import(`./b.js`);",
            'export const re = /[import "./b.js"]/;',
            'export const tpl = `import "./b.js"`;',
            'export const inner = `${await import("./b.js")}`;',
        ].join("\n"),
        "b.js": "export const b = 1;\n",
    });
    try {
        for (const dev of [true, false]) {
            const modules = await createModuleServer({ root, dev, build: "b1", mounts: [{ url: "/app/", dir: "app" }], minify: false });
            const { body } = await served(modules, "/app/a.js");
            const stamp = `?v=${modules.codeId}`;
            assert.match(body, new RegExp(`from "\\./b\\.js\\${stamp}"`));
            assert.ok(body.includes(`'see: import x from "./b.js"'`), "a string's text was rewritten");
            assert.ok(body.includes('// import y from "./b.js";'), "a comment was rewritten");
            assert.ok(body.includes('/* import("./b.js") */'), "a comment was rewritten");
            assert.ok(body.includes(`import(\`./b.js${stamp}\`)`), "import() of a plain template was left unstamped");
            assert.ok(body.includes('/[import "./b.js"]/'), "a regex was rewritten");
            assert.ok(body.includes('`import "./b.js"`'), "a template's text was rewritten");
            assert.ok(body.includes(`\${await import("./b.js${stamp}")}`), "an import() inside a substitution was left unstamped");
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("F25e the code id names the transform: the same files and build, minified or not, are two code ids", async () => {
    const root = await moduleApp({ "a.js": "export const a = 1; // a comment\n" });
    try {
        const options = { root, build: "b1", mounts: [{ url: "/app/", dir: "app" }] };
        const minified = await createModuleServer(options);
        const plain = await createModuleServer({ ...options, minify: false });
        const custom = await createModuleServer({ ...options, minify: { js: (text) => text.trim(), css: (text) => text } });
        const again = await createModuleServer(options);
        assert.notEqual(minified.codeId, plain.codeId);
        assert.notEqual(minified.codeId, custom.codeId);
        assert.notEqual(plain.codeId, custom.codeId);
        assert.equal(minified.codeId, again.codeId, "the same server over the same files is the same code id");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("a mount outside the root is refused, unless it says outside: true; the framework's refusals still hold", async () => {
    const root = await moduleApp({ "a.js": "export const a = 1;\n" });
    const beside = await tempDir();
    try {
        await writeFile(path.join(beside, "p.js"), 'import { a } from "/app/a.js";\nexport const p = a;\n');
        const mounts = [{ url: "/app/", dir: "app" }, { url: "/plugins/p/", dir: beside }];
        await assert.rejects(createModuleServer({ root, build: "b1", mounts, minify: false }), /outside the root/);
        for (const dev of [true, false]) {
            const modules = await createModuleServer({ root, dev, build: "b1", mounts: [mounts[0], { ...mounts[1], outside: true }], minify: false });
            const { status, body } = await served(modules, "/plugins/p/p.js");
            assert.equal(status, 200);
            assert.ok(body.includes(`from "/app/a.js?v=${modules.codeId}"`), "an absolute import under a mount is stamped from outside too");
        }
        await assert.rejects(createModuleServer({ root, build: "b1", mounts: [{ url: "/fw/", dir: REPO, outside: true }] }), /reaches the framework/);
        await assert.rejects(createModuleServer({ root, build: "b1", mounts: [{ url: "/x/", dir: "app", outside: "yes" }] }), /outside is true or left out/);
    } finally {
        await rm(root, { recursive: true, force: true });
        await rm(beside, { recursive: true, force: true });
    }
});

// ---- lower: static files, and a stale page's replacement at close ----------------------------

test("static files: a picture is not gzipped; text still is", async () => {
    const root = await tempDir();
    await mkdir(path.join(root, "pub"));
    await writeFile(path.join(root, "pub", "p.png"), Buffer.alloc(4096, 1));
    await writeFile(path.join(root, "pub", "t.txt"), "text ".repeat(500));
    try {
        const modules = await createModuleServer({ root, build: "b1", static: [{ url: "/pub/", dir: "pub", only: [".png", ".txt"] }] });
        const server = await serve((req, res) => modules.handle(req, res, new URL(req.url, "http://localhost")));
        try {
            const png = await get(server.port, "/pub/p.png", { "accept-encoding": "gzip" });
            assert.equal(png.status, 200);
            assert.equal(png.headers["content-encoding"], undefined);
            const txt = await get(server.port, "/pub/t.txt", { "accept-encoding": "gzip" });
            assert.equal(txt.headers["content-encoding"], "gzip");
        } finally {
            await server.close();
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
    // What a picture is kept as: its bytes and no gzip.
    const entry = pack(Buffer.alloc(10, 1), { gzip: false });
    assert.equal(entry.gz, null);
    const headers = {};
    let body;
    send({ headers: { "accept-encoding": "gzip" } }, { writeHead: (status, h) => Object.assign(headers, h), end: (b) => { body = b; } }, entry, { type: "image/png" });
    assert.equal(headers["content-encoding"], undefined);
    assert.equal(body.length, 10);
});

test("close(): a stale page's replacement finishes before the app's onShutdown closes what it uses", async () => {
    const root = await moduleApp({ "boot.js": "export const start = () => {};\n" });
    const log = [];
    let clock = 0;
    const cache = createPageCache({ ttlMs: 1000, staleMs: 100_000, now: () => clock });
    const api = Object.assign(async () => false, { names: [] });
    const app = await createJurisServer({
        root, build: "b1", dev: false,
        services: { async slow() { await sleep(80); log.push("service"); return { text: "hi" }; } },
        routes: [{ path: "/", name: "home", component: "Home", preload: () => [["slow"]] }],
        setup: (juris) => {
            juris.registerComponent("App", () => ({ main: { children: [{ RouterView: {} }] } }));
            juris.registerComponent("Home", () => ({ p: { textContent: "home" } }));
        },
        api, cache,
        modules: { mounts: [{ url: "/app/", dir: "app" }], entry: "/app/boot.js" },
        onShutdown: [() => { log.push("shutdown"); }],
        onError: (error, where) => log.push(`error ${where}: ${error.message}`),
    });
    try {
        const { port } = await app.listen();
        assert.equal((await get(port, "/")).status, 200);
        assert.deepEqual(log, ["service"]);
        clock += 2000;                                        // stale: served, and replaced after
        assert.equal((await get(port, "/")).status, 200);
        await app.close();
        assert.deepEqual(log, ["service", "service", "shutdown"]);
    } finally {
        await app.close();
        await rm(root, { recursive: true, force: true });
    }
});

test("invalidate(): a change made outside a service call reaches live.onInvalidate, as a service's touches do", async () => {
    const root = await moduleApp({ "boot.js": "export const start = () => {};\n" });
    const heard = [];
    const setup = (juris) => {
        juris.registerComponent("App", () => ({ main: { children: [{ RouterView: {} }] } }));
        juris.registerComponent("Home", () => ({ p: { textContent: "home" } }));
    };
    const common = { root, build: "b1", dev: false, routes: [{ path: "/", name: "home", component: "Home" }], setup, modules: { mounts: [{ url: "/app/", dir: "app" }], entry: "/app/boot.js" } };
    const app = await createJurisServer({
        ...common,
        services: { async items() { return []; } },
        api: { live: { queries: ["items"], public: true, onInvalidate: (targets, { remote }) => heard.push({ targets, remote }) } },
    });
    // An app that built its own handler invalidates through it: the kernel's refuses, saying so.
    const own = await createJurisServer({ ...common, services: {}, api: Object.assign(async () => false, { names: [] }) });
    try {
        await app.invalidate([{ name: "items", where: { list: "a" } }]);
        assert.deepEqual(heard, [{ targets: [{ name: "items", where: { list: "a" } }], remote: false }]);
        await assert.rejects(() => own.invalidate([{ name: "items" }]), /handler of the app's/);
    } finally {
        await app.close();
        await own.close();
        await rm(root, { recursive: true, force: true });
    }
});

test("onThisSite: a location is a path on this site by the browser's reading of it, not by its prefix", () => {
    for (const ok of ["/", "/design/people", "/a?b=1#c", "/a/../b", "/login?to=%2Fx"]) assert.equal(onThisSite(ok), true, ok);
    for (const away of ["//evil.example/x", "/\t/evil.example/x", "/\n/evil.example", "/\\evil.example/x", "/\t\\evil.example", "https://evil.example/", "javascript:alert(1)", "x", "", null, undefined, 5, ["/a"]]) assert.equal(onThisSite(away), false, JSON.stringify(away));
});

test("a page's own headers: the hashes of its inline scripts are given to `headers`, and what it answers is sent with the page, a 304 included", async () => {
    const { juris, router } = await appOf({
        services: {},
        routes: [{ path: "/", name: "home", component: "Home", head: { title: "Home" } }],
        components: { Home: () => ({ p: { textContent: "home" } }) },
    });
    const asked = [];
    const pipeline = createPagePipeline({
        juris, router, entry: "/boot.js", devReload: "console.log('reload')",
        headers: ({ scriptHashes, route }) => { asked.push({ scriptHashes, route: route.name }); return { "content-security-policy": `script-src 'self' ${scriptHashes.join(" ")}`, "x-frame-options": "DENY" }; },
    });
    const server = await serve((req, res) => pipeline.handle(req, res));
    try {
        const answer = await get(server.port, "/");
        assert.equal(answer.status, 200);
        // Every inline script the browser will run is named by its hash, and nothing else is.
        const inline = [...answer.body.matchAll(/<script(?: type="module")?>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`);
        assert.equal(inline.length, 2, "the loader and the reload client");
        assert.deepEqual(asked[0].scriptHashes, inline);
        assert.deepEqual(inlineScriptHashes(answer.body), inline);
        assert.equal(asked[0].route, "home");
        assert.equal(answer.headers["content-security-policy"], `script-src 'self' ${inline.join(" ")}`);
        assert.equal(answer.headers["x-frame-options"], "DENY");
        assert.match(answer.headers["content-type"], /text\/html/);
        const again = await get(server.port, "/", { "if-none-match": answer.headers.etag });
        assert.equal(again.status, 304);
        assert.equal(again.headers["x-frame-options"], "DENY");
    } finally {
        await server.close();
    }
    // A header `send` writes itself is not the hook's to give.
    const wrong = createPagePipeline({ juris, router, entry: "/boot.js", headers: () => ({ "Content-Type": "text/plain" }) });
    await assert.rejects(wrong.render("/", null), /content-type/i);
    await assert.rejects(Promise.resolve().then(() => createPagePipeline({ juris, router, entry: "/boot.js", headers: {} })), /headers/);
});

// ---- F28: the title worked out inside the render ---------------------------------------------

test("F28 pipeline: a title is worked out inside its page's render, never after another request's has begun", async () => {
    // What a render sets for the page it draws (an app's language, picked per person), read by the
    // route's titleFrom: two pages drawn at once, the first one's notFound waiting, must each be titled
    // from their own render.
    let current = null;
    const { juris, router } = await appOf({
        services: { async item(id) { return { id }; } },
        routes: [{ path: "/items/:id", name: "item", component: "Item", preload: ({ params }) => [["item", params.id]], head: { titleFrom: (item) => `${item?.id} in ${current}` } }],
        components: { Item: (props, api) => { current = api.getState("lang"); return { p: { textContent: "item" } }; } },
    });
    const pipeline = createPagePipeline({
        juris, router, entry: "/boot.js",
        state: ({ viewer }) => ({ lang: viewer.lang }),
        notFound: async (own) => { if (own?.id === "a") await sleep(20); return false; },
    });
    const [a, b] = await Promise.all([pipeline.render("/items/a", { id: "u1", lang: "de" }), (async () => { await sleep(5); return pipeline.render("/items/b", { id: "u2", lang: "ja" }); })()]);
    assert.equal(titleIn(a.body.toString()), "a in de");
    assert.equal(titleIn(b.body.toString()), "b in ja");
});

// ---- devMode in development: #juris-dev --------------------------------------------------------

test("dev: every page carries #juris-dev, which turns the browser's devMode on; dev: false, none", async () => {
    const { juris, router } = await appOf({
        services: {},
        routes: [{ path: "/", name: "home", component: "Home" }],
        components: { Home: () => ({ p: { textContent: "home" } }) },
    });
    const dev = await createPagePipeline({ juris, router, entry: "/boot.js", dev: true }).render("/", null);
    assert.match(dev.body.toString(), /<script type="application\/json" id="juris-dev">\{\}<\/script>/);
    const plain = await createPagePipeline({ juris, router, entry: "/boot.js", dev: false }).render("/", null);
    assert.ok(!/juris-dev/.test(plain.body.toString()));
    const unsaid = await createPagePipeline({ juris, router, entry: "/boot.js" }).render("/", null);
    assert.ok(!/juris-dev/.test(unsaid.body.toString()));
});

test("dev: the kernel's own instance is never given the devtools feature, nor devMode", async () => {
    const root = await moduleApp({ "boot.js": "export const start = () => {};\n" });
    const app = await createJurisServer({
        root, build: "b1", dev: true,
        services: {},
        routes: [{ path: "/", name: "home", component: "Home" }],
        setup: (juris) => {
            juris.registerComponent("App", () => ({ main: { children: [{ RouterView: {} }] } }));
            juris.registerComponent("Home", () => ({ p: { textContent: "home" } }));
        },
        modules: { mounts: [{ url: "/app/", dir: "app" }], entry: "/app/boot.js" },
    });
    try {
        assert.equal(app.juris.devtools, undefined);
        assert.equal(app.juris.devMode, false);
        const page = await app.render("/", null);
        assert.match(page.body.toString(), /id="juris-dev"/);
    } finally {
        await app.close();
        await rm(root, { recursive: true, force: true });
    }
});

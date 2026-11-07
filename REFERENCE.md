# Juris: the reference

> **This is Juris's full contract**, as published on npm in two packages (the short introduction is
> [README.md](README.md)). The modules a browser downloads are the `juris` package
> (https://github.com/jurisjs/juris), flat at its root; the Node half is this repository,
> `juris-kit`, which depends on it: `server/` and its tests in `tests/` (`npm test`, Node 24 or
> later). Where this contract says `src/*.js`, read the `juris` package (in a browser the module
> server still serves it at `/src/`); where it says `src/server/`, read this package's `server/`. A
> test named from its project is in `juris/tests/`, `juris-kit/tests/` or `juris-tests/tests/`, the
> checkout of its own that takes both packages as an app does.

Juris is a framework for server-rendered web apps whose pages stay live. The server renders every
page whole, so it can be read before any script has run; the browser then makes that same page
interactive, and live queries keep what it shows up to date as the data changes. It has no build
step and no third-party runtime dependency: the code a browser runs is the file on disk, and a
database driver is something the app passes in.

This file is its contract: what an app may use, what the framework promises, what holds each
promise, and what is not there yet. A change to Juris is written down here first (see "The
boundary"), and `juris-kit/tests/reference-examples.test.mjs` fails when an example in it stops
giving what it shows; no test checks that it names every module, export, reserved state root and
stored key.

**Reading the examples.** A comment `// → value` after a statement shows what it gives (a value
that starts with `<` is the HTML a layout renders to), `// throws TypeError: …` the error it throws,
and `// console.warn: …` a line it writes on the console. Every example runs, and its results are
checked: `node scripts/check-examples.mjs REFERENCE.md`, in this package.

**Where it stands (2026-10-02; "Open" and "Not yet" re-checked against the code that day: none of
them is closed).** Juris runs two real-time sites in production, and `app/hello`, the smallest app
on it. They work around, in their own code, the issues this version fixes (F1–F27), and are being
moved to it. Until then the framework as described here runs on the QA server and in the tests. The
framework's suites are each package's `npm test` and `juris-tests`, which holds both packages to
every line. "Not yet", at the end, lists what is missing.

## Contents

- [Your first app](#your-first-app): `app/hello`, file by file, and what happens on a request
- [Why it is built this way](#why-it-is-built-this-way): the problems Juris was designed around
- [The boundary](#the-boundary): what may go in `src/`, and the test that holds it
- [The page contract](#the-page-contract): `#app`, `#state`, `#services`, `start()`, and in development `#juris-dev`
- [Reserved state roots](#reserved-state-roots): `$route`, `$ssr`, `$local`, `$async`, `$server`, `$live`
- [The public API](#the-public-api): components, the component api, and every module
- [What the framework stores in a browser](#what-the-framework-stores-in-a-browser): `STORAGE`
- [The browser floor](#the-browser-floor): the oldest browsers it runs in
- [Security defaults and invariants](#security-defaults-and-invariants): each with its code and its test
- [Not yet](#not-yet)

## Your first app

`app/hello` is the template for a new app: five files, and none of them plumbing. Its test builds
the whole app on in-memory services (no database), renders `/` and a 404, and fails if hello grows
an HTTP server, a document, a module matcher or a 500 of its own.

| File | What it holds | Runs |
| --- | --- | --- |
| `app/hello/client/app.js` | The app itself: its routes, the words around every title, and `register(juris)`, which registers its components. | Both sides: the server renders with it, the browser boots with it |
| `app/hello/client/boot.js` | The browser entry. The page imports it once the page is idle, and calls its `start()`. | Browser |
| `app/hello/services.js` | What the app does, as services. Never mounted, so no browser is served it. | Node |
| `app/hello/app.mjs` | `createApp`: one `createJurisServer` call, with the services passed in, so a test can pass its own. | Node |
| `app/hello/server.mjs` | The only file that reads the environment and touches the process: it listens, and closes on a signal. | Node |

Run it with `node app/hello/server.mjs` (development, on http://127.0.0.1:3000), or in production
mode with `PROD=1 BUILD=b1 PORT=3001 node app/hello/server.mjs`.

The app, the same on both sides (`client/app.js`, its comments left out):

```js
export const routes = [
    { path: "/", name: "home", component: "Home", preload: () => [["greeting", "world"]], head: { title: "Hello" } },
    { path: "*", name: "missing", component: "NotFound", head: { title: "Not found" } },
];
export const title = { suffix: " · Hello", fallback: "Hello" };
export function register(juris) {
    juris.registerComponent("App", () => ({ main: { children: [{ RouterView: {} }] } }));
    juris.registerComponent("Home", (props, api) => {
        api.live("greeting", "greeting", "world");
        return { h1: { textContent: () => api.getState("greeting")?.text ?? "" } };
    });
    juris.registerComponent("NotFound", () => ({ p: { textContent: "Nothing here." } }));
}
```

Its service (`services.js`), and the server (`app.mjs`):

```js excerpt
import { fail } from "juris/errors.js";
export const services = {
    async greeting(name) {
        if (typeof name !== "string" || !name.trim()) fail("Say who to greet.", { fields: { name: "Required." } });
        return { text: `Hello, ${name.trim().slice(0, 60)}` };
    },
};

import { createJurisServer } from "juris-kit/server/kernel.js";
import { routes, register, title } from "./client/app.js";
export const createApp = ({ services, dev = false, build = "dev" }) => createJurisServer({
    root: new URL("../..", import.meta.url), dev, build, services, routes, setup: register,
    api: { live: { public: true, queries: ["greeting"], touches: {} } },
    modules: { mounts: [{ url: "/app/hello/client/", dir: "app/hello/client" }], entry: "/app/hello/client/boot.js" },
    page: { title },
});
```

And the browser entry (`client/boot.js`): `export const start = () => hydrate({ routes, register, title });`,
with `hydrate` imported from `/src/client.js`.

**What happens when a browser asks for `/`.**

1. The kernel answers every request in one fixed order: `/version`, `/healthz`, `/api/`, the
   modules, then pages. `/` is a page.
2. The path is already in its one spelling, nobody is signed in, and the route is `home`. Its
   `preload` names one call, `["greeting", "world"]`, and the kernel runs it before rendering,
   with a context that says it is a preload.
3. `Home` renders from that answer: `api.live` finds the call preloaded and writes its answer at
   `greeting` at once, so the render never waits. The title is the route's `head.title`, "Hello"
   (the `suffix` follows only a name a page takes from its own data, `head.titleFrom`).
4. The kernel writes the document: the markup in `#app`, the state it rendered with in `#state`,
   the callable service names in `#services`, and a loader that imports
   `/app/hello/client/boot.js?v=<hash>-<code id>` once the page is idle and calls its `start()`.
   A guest's page could be cached; hello passes no cache.
5. In the browser, `hydrate` reads `#state` and `#services`, builds the instance with a stub for
   `greeting` that posts to `/api/greeting`, installs the router and the live client, registers the
   components, draws the page again into `#app` (the same markup, now live) and binds the title.
6. `api.live` subscribes to the `greeting` query over the page's one event stream (`/api/events`).
   Hello has no mutation, but a service listed in `live.touches` as touching `greeting` would make
   the server run the query again once per change and send each subscribed page only the leaves
   that changed.

A service's refusal is written for the person reading it: `fail("Say who to greet.", { fields })`
reaches the caller with its words and its field messages, and any other error reads "request
failed" while its detail goes to the server's log.

**Growing it.**

- A page is a route record and a component. Its `preload` lists the calls the page makes, argument
  for argument: a server render answers only what was preloaded, and a call is keyed by its name
  and the JSON of its arguments (`liveKey`).
- A change is a service. `live.touches` names the queries each one changes (`[]` for none), so the
  pages watching them re-run; `fail` refuses with words the caller may read.
- A page with code of its own gets `load` and `register` on its route (see "A route's own code").
- A plugin (forms, the clock) is installed on both sides, in the same order: in `setup` on the
  server, and in `hydrate`'s `plugins` in the browser.
- A page cache and a change bus, for several instances, are options of the kernel and the
  dispatcher (`server/kernel.js`, `server/page-cache.js`, `server/bus/pg-outbox.js`).

**What hello does not show: signing in.** A members app writes these itself today: a request
context (the dispatcher's `context(req, res)`) that reads its session cookie with `parseCookies`,
sets and clears that cookie with `serializeCookie` and `appendSetCookie`, a rule that a viewer
passed as an argument is believed only on a call of kind `"preload"` or `"live"` (`callKind`), and
`live.authorize` rules that match such an argument to the session. That is the code that decides
who sees what, and it is not in the framework yet ("Not yet").

## Why it is built this way

Juris was designed from pain points rather than from a list of features: each part below is there
because its absence cost something. Each is written as the problem, what Juris does about it, where
the code and the tests are, and what it costs.

### The code a browser runs is the file on disk

The examples on this page serve a small shop's browser code with the kit's module server, and ask
it for each URL over HTTP, as a browser does. The code id in a body is a hash that moves with every
file served, so it is shown as `<code id>`.

```js setup
import { rmSync } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createModuleServer } from "juris-kit/server/modules.js";

// The shop's browser code on disk (removed when the example ends).
const root = await mkdtemp(join(tmpdir(), "shop-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
await mkdir(join(root, "app"));
await writeFile(join(root, "app/cart.js"), `import { price } from "./price.js";

// Euros, for the skus in the cart.
export const total = (skus) =>
    skus.reduce((sum, sku) => sum + price(sku), 0);
`);
await writeFile(join(root, "app/price.js"), `export const price = (sku) =>
    sku === "milk" ? 3 : 5;
`);
const mounts = [{ url: "/app/", dir: "app" }];

// What a browser is sent for `path`.
async function get(modules, path) {
    const server = createServer(async (req, res) => {
        const url = new URL(req.url, "http://shop.test");
        if (!(await modules.handle(req, res, url))) res.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    const body = await response.text();
    server.close();
    return {
        status: response.status,
        cache: response.headers.get("cache-control"),
        body: body.replaceAll(modules.codeId, "<code id>"),
    };
}
```

**The problem.** A build step (bundling, tree shaking, transpiling) makes what runs in production
something other than what anyone read or tested. The premise Juris starts from is that this step is
where most production-only bugs come from: code dropped because it looked unused, one module
loaded twice as two copies that each believe they are the only one, a transform that behaves
unlike the development server. Such a bug appears after a deploy and cannot be reproduced from the
source.

**What Juris does.**

- No build step.
  - Browser modules are ES modules, served as they are on disk.

    ```js
    const modules = await createModuleServer({
        root,
        build: "b1",
        dev: true,
        mounts,
    });
    const cart = await get(modules, "/app/cart.js");
    cart.body.split("\n");
    // → [
    //     'import { price } from "./price.js?v=<code id>";',
    //     "",
    //     "// Euros, for the skus in the cart.",
    //     "export const total = (skus) =>",
    //     "    skus.reduce((sum, sku) => sum + price(sku), 0);",
    //     "",
    //   ]
    ```

    ```js
    import { pathToFileURL } from "node:url";
    const file = pathToFileURL(join(root, "app/cart.js"));
    const { total } = await import(file);
    total(["milk", "eggs"]); // → 8
    ```

  - Development reads the disk on every request; production serves a snapshot of the same files
    taken at start.

    ```js
    const dev = await createModuleServer({ root, build: "b1", dev: true, mounts });
    const prod = await createModuleServer({ root, build: "b1", mounts });
    await writeFile(join(root, "app/price.js"), "export const price = () => 4;\n");
    (await get(dev, "/app/price.js")).body;
    // → "export const price = () => 4;\n"
    (await get(prod, "/app/price.js")).body;
    // → 'export const price = (sku) =>\nsku === "milk" ? 3 : 5;'
    ```

- The only changes on the way out are `minifyJs` and `minifyCss`, which remove comments and
  whitespace and never rename, fold or drop code (`minify: false` turns them off), and import
  stamping, which rewrites import specifiers and nothing else.

  ```js
  import { minifyJs } from "juris-kit/server/minify.js";
  minifyJs(`// Prices include VAT.
  const VAT = 0.2;
  export const withVat = (price) => {
      const unused = 1 + 2;
      if (false) console.log("never runs");
      return price * (1 + VAT);
  };
  `).split("\n");
  // → [
  //     "",
  //     "const VAT = 0.2;",
  //     "export const withVat = (price) => {",
  //     "const unused = 1 + 2;",
  //     'if (false) console.log("never runs");',
  //     "return price * (1 + VAT);",
  //     "};",
  //   ]
  ```

  ```js
  const minified = await createModuleServer({ root, build: "b1", mounts });
  (await get(minified, "/app/cart.js")).body.split("\n");
  // → [
  //     'import { price } from "./price.js?v=<code id>";',
  //     "export const total = (skus) =>",
  //     "skus.reduce((sum, sku) => sum + price(sku), 0);",
  //   ]
  const asIs = await createModuleServer({
      root,
      build: "b1",
      minify: false,
      mounts,
  });
  (await get(asIs, "/app/cart.js")).body.split("\n").length; // → 6
  ```

  ```js
  await writeFile(join(root, "app/help.js"), `import { total } from "./cart.js";
  // Was: import { total } from "./basket.js";
  export const hint = 'Write import { price } from "./price.js"';
  `);
  const modules = await createModuleServer({
      root,
      build: "b1",
      minify: false,
      mounts,
  });
  (await get(modules, "/app/help.js")).body.split("\n");
  // → [
  //     'import { total } from "./cart.js?v=<code id>";',
  //     '// Was: import { total } from "./basket.js";',
  //     "export const hint = 'Write import { price } from \"./price.js\"';",
  //     "",
  //   ]
  ```

- Nothing is shaken out. A module is downloaded whole, so what a test imported is what a browser
  runs.

  ```js
  await writeFile(join(root, "app/coupons.js"), [
      "export const tenOff = (total) => total - 10;",
      "export const halfOff = (total) => total / 2; // no page uses it yet",
  ].join("\n"));
  const modules = await createModuleServer({ root, build: "b1", mounts });
  (await get(modules, "/app/coupons.js")).body.includes("halfOff"); // → true
  ```

  ```js
  import { readFile } from "node:fs/promises";
  const modules = await createModuleServer({
      root,
      build: "b1",
      minify: false,
      mounts,
  });
  const served = await get(modules, "/src/errors.js");
  const file = new URL(import.meta.resolve("juris/errors.js"));
  const tested = await readFile(file, "utf8");
  served.body === tested; // → true
  ```

- Browser code imports Juris by URL (`/src/client.js`), and the URL layout mirrors the disk, so
  Node and a browser resolve the same relative imports.

  ```js
  await writeFile(join(root, "app/boot.js"), [
      'import { hydrate } from "/src/client.js";',
      "export const start = () => hydrate({ routes: [] });",
  ].join("\n"));
  const modules = await createModuleServer({ root, build: "b1", mounts });
  (await get(modules, "/app/boot.js")).body.split("\n")[0];
  // → 'import { hydrate } from "/src/client.js?v=<code id>";'
  ```

  ```js
  const modules = await createModuleServer({ root, build: "b1", mounts });
  const client = await get(modules, "/src/client.js");
  const imports = [...client.body.matchAll(/ from "([^"]+)"/g)];
  imports.map(([, specifier]) => specifier);
  // → [
  //     "./juris.js?v=<code id>",
  //     "./router.js?v=<code id>",
  //     "./remote-services.js?v=<code id>",
  //   ]
  ```

  ```js
  const inNode = import.meta.resolve("juris/client.js");
  const juris = import.meta.resolve("juris/juris.js");
  new URL("./juris.js", inNode).href === juris; // → true
  new URL("./juris.js", "https://shop.test/src/client.js").pathname;
  // → "/src/juris.js"
  ```

- Server code cannot reach a browser by accident: only the flat `src/*.js` is served, never
  `src/server/`.

  ```js
  const modules = await createModuleServer({ root, build: "b1", mounts });
  (await get(modules, "/src/juris.js")).status; // → 200
  (await get(modules, "/src/server/kernel.js")).status; // → 404
  (await get(modules, "/src/ssr-renderer.js")).status; // → 404
  ```

  ```js
  import { fileURLToPath } from "node:url";
  const kernel = import.meta.resolve("juris-kit/server/kernel.js");
  const kit = fileURLToPath(new URL("../", kernel));
  await createModuleServer({
      root,
      build: "b1",
      mounts: [{ url: "/kit/", dir: kit, outside: true }],
  });
  // throws TypeError: createModuleServer: mount "/kit/": its dir reaches the
  //   framework, which is served only flat, at /src/
  ```

**Where.** `src/server/modules.js` (`createModuleServer`), `src/server/minify.js`. Tests:
`juris-tests/tests/juris-kit/modules.stamping.test.mjs` ("stamping: every import form a browser
follows is stamped, and nothing else in the text changes"),
`juris-tests/tests/juris-kit/modules.test.mjs`,
`juris-tests/tests/juris-kit/modules.construction.test.mjs`,
`juris-tests/tests/juris-kit/minify.test.mjs` (more of the minifier's cases are in
`juris-kit/tests/server.test.mjs`, beside the import stamping's), and
`juris/tests/boundary.test.mjs`.

**What it costs.**

- More requests.
  - `app/hello`'s page loads 14 modules, each a request of its own: about 38 KB gzipped in all
    (measured 2026-09-26, file by file, with the framework's own minifier, when `ssr-renderer.js`
    was still one of them: below), where a bundler would usually send a few files.

    ```js
    const modules = await createModuleServer({
        root,
        build: "b1",
        dev: true,
        mounts,
    });
    const requested = [];
    async function load(path) {
        if (requested.includes(path)) return;
        requested.push(path);
        const { body } = await get(modules, path);
        for (const [, name] of body.matchAll(/from "\.\/([\w-]+\.js)\?v=/g)) {
            await load(`/src/${name}`);
        }
    }
    await load("/src/client.js");
    requested.length; // → 11
    requested.slice(0, 4);
    // → [
    //     "/src/client.js",
    //     "/src/juris.js",
    //     "/src/state-manager.js",
    //     "/src/dom-renderer.js",
    //   ]
    ```

  - The page can be read before any of them arrives, since the loader waits until the page has
    loaded and the browser is idle.

    ```js
    import { renderDocument } from "juris-kit/server/document.js";
    const page = renderDocument(
        { html: "<h1>Your cart</h1>" },
        { entry: "/app/boot.js" },
    );
    const lines = page.split("\n");
    lines[8]; // → <div id="app"><h1>Your cart</h1></div>
    lines.slice(13, 15);
    // → [
    //     '  if (document.readyState === "complete") idle(boot);',
    //     '  else addEventListener("load", () => idle(boot), { once: true });',
    //   ]
    ```

- No dead code removed.
  - A browser downloads code no page of the app uses: nothing drops what a module carries that a
    page never calls (`enhance`, say).

    ```js
    const modules = await createModuleServer({ root, build: "b1", mounts });
    const core = await get(modules, "/src/juris.js");
    core.body.includes("enhance("); // → true
    ```

  - The string renderer is no longer part of it. It is the kit's (`server/ssr-renderer.js`), given
    to the server's instance as `features.ssr`, and `juris.js` neither imports nor constructs it;
    while `juris.js` imported both renderers, every page downloaded that one too (12.5 KB
    minified, 3.8 KB gzipped).

    ```js
    const modules = await createModuleServer({ root, build: "b1", mounts });
    const core = await get(modules, "/src/juris.js");
    [...core.body.matchAll(/ from "\.\/([\w-]+)\.js/g)].map(([, name]) => name);
    // → [
    //     "state-manager",
    //     "dom-renderer",
    //     "component-manager",
    //     "errors",
    //     "live-protocol",
    //     "html-safety",
    //   ]
    (await get(modules, "/src/ssr-renderer.js")).status; // → 404
    ```

    ```js
    import Juris from "juris/juris.js";
    import SSRRenderer from "juris-kit/server/ssr-renderer.js";
    const server = new Juris({ features: { ssr: SSRRenderer } });
    server.renderToString({ p: "Your cart" }); // → <p>Your cart</p>
    new Juris().renderToString({ p: "Your cart" });
    // throws TypeError: Juris.renderToString: rendering to a string is the kit's
    ```

- The source is written in what the oldest supported browsers run ("The browser floor"): nothing
  translates newer syntax, and there is no TypeScript or JSX.

  ```js
  await writeFile(
      join(root, "app/greet.js"),
      'export const greet = (user) => user?.name ?? "guest";\n',
  );
  const modules = await createModuleServer({ root, build: "b1", mounts });
  (await get(modules, "/app/greet.js")).body;
  // → 'export const greet = (user) => user?.name ?? "guest";'
  ```

### A rolling deploy mixes two builds

The examples on this page serve the shop's browser code with the kit's module server, as in "The
code a browser runs is the file on disk", and ask it for each URL over HTTP. The code id in a body
is shown as `<code id>`.

```js setup
import { rmSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { createModuleServer } from "juris-kit/server/modules.js";

// The shop's browser code on disk (removed when the example ends).
const root = await mkdtemp(join(tmpdir(), "shop-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
await mkdir(join(root, "app"));
await writeFile(join(root, "app/cart.js"), `import { price } from "./price.js";

// Euros, for the skus in the cart.
export const total = (skus) =>
    skus.reduce((sum, sku) => sum + price(sku), 0);
`);
await writeFile(join(root, "app/price.js"), `export const price = (sku) =>
    sku === "milk" ? 3 : 5;
`);
const mounts = [{ url: "/app/", dir: "app" }];

// What a browser is sent for `path`.
async function get(modules, path) {
    const server = createServer(async (req, res) => {
        const url = new URL(req.url, "http://shop.test");
        if (!(await modules.handle(req, res, url))) res.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    const body = await response.text();
    server.close();
    return {
        status: response.status,
        cache: response.headers.get("cache-control"),
        body: body.replaceAll(modules.codeId, "<code id>"),
    };
}
```

**The problem.** Instances restart one at a time, so for a while some serve the old code and some
the new, and a page cached or left open before the deploy boots after it. A browser that gets its
page from one build and its modules from another runs code nobody tested together, and a module
loaded under two URLs is two modules (a component registered twice throws).

```js
const file = pathToFileURL(join(root, "app/price.js")).href;
const one = await import(`${file}?v=b1`);
const two = await import(`${file}?v=b2`);
one === two; // → false
```

```js
import Juris from "juris/juris.js";
await writeFile(join(root, "app/badge.js"), `let registered = false;
export function register(juris) {
    if (registered) return;
    registered = true;
    juris.registerComponent("CartBadge", () => ({ span: "2 items" }));
}
`);
const file = pathToFileURL(join(root, "app/badge.js")).href;
const juris = new Juris();
(await import(`${file}?v=b1`)).register(juris);
(await import(`${file}?v=b2`)).register(juris);
// throws Error: ComponentManager.registerComponent: "CartBadge" is already
//   registered
```

**What Juris does.**

- A boot snapshot.
  - In production the module server reads every module, asset and root file it serves when it
    starts and serves only those, so an instance waiting its turn serves the code it started with,
    including a file the deploy removed.

    ```js
    const modules = await createModuleServer({ root, build: "b1", mounts });
    // The deploy changes one file and removes another before this restarts.
    await writeFile(join(root, "app/price.js"), "export const price = () => 4;\n");
    await rm(join(root, "app/cart.js"));
    (await get(modules, "/app/price.js")).body;
    // → 'export const price = (sku) =>\nsku === "milk" ? 3 : 5;'
    (await get(modules, "/app/cart.js")).status; // → 200
    ```

  - A module it never had is a 404 (`no-store`), never the new checkout's file stamped as this
    build's.

    ```js
    const modules = await createModuleServer({ root, build: "b1", mounts });
    await writeFile(join(root, "app/coupons.js"), "export const tenOff = 10;\n");
    await get(modules, "/app/coupons.js");
    // → { status: 404, cache: "no-store", body: "not found" }
    await modules.versioned("/app/coupons.js");
    // throws Error: /app/coupons.js is not in the snapshot this server started
    ```

  - Static files (fonts, pictures, a vendored library) are not in the snapshot: production reads
    each the first time it is asked for, so mid-roll an instance may serve the new checkout's copy,
    which a name that carries its version makes harmless (`server/modules.js`, "Static files",
    below).

    ```js
    await mkdir(join(root, "vendor/chart-4.1.0"), { recursive: true });
    await writeFile(join(root, "vendor/chart-4.1.0/chart.js"), "// 4.1.0\n");
    const modules = await createModuleServer({
        root,
        build: "b1",
        mounts,
        static: [{
            url: "/vendor/",
            dir: "vendor",
            depth: 1,
            only: [".js"],
            immutable: true,
        }],
    });
    // The next build vendors 4.2.0, beside 4.1.0, after this instance started.
    await mkdir(join(root, "vendor/chart-4.2.0"));
    await writeFile(join(root, "vendor/chart-4.2.0/chart.js"), "// 4.2.0\n");
    const chart = await get(modules, "/vendor/chart-4.2.0/chart.js");
    chart.body; // → "// 4.2.0\n"
    chart.cache; // → "public, max-age=31536000, immutable"
    (await get(modules, "/vendor/chart-4.1.0/chart.js")).body; // → "// 4.1.0\n"
    ```

- A code id in every module URL.
  - `codeId` is a hash of the snapshot, the build and the transform the server applies (its stamper
    and minifier),

    ```js
    const b1 = await createModuleServer({ root, build: "b1", mounts });
    const b1Again = await createModuleServer({ root, build: "b1", mounts });
    const b2 = await createModuleServer({ root, build: "b2", mounts });
    const unminified = await createModuleServer({
        root,
        build: "b1",
        minify: false,
        mounts,
    });
    b1.codeId === b1Again.codeId; // → true
    b1.codeId === b2.codeId; // → false
    b1.codeId === unminified.codeId; // → false
    ```

    ```js
    const before = await createModuleServer({ root, build: "b1", mounts });
    await writeFile(join(root, "app/price.js"), "export const price = () => 4;\n");
    const after = await createModuleServer({ root, build: "b1", mounts });
    before.codeId === after.codeId; // → false
    ```

  - and every import a served module makes is stamped `?v=<code id>`, in every form a browser
    follows, so each module has one URL.

    ```js
    await writeFile(join(root, "app/checkout.js"), [
        'import { total } from "./cart.js";',
        'export { price } from "./price.js";',
        'import "/app/analytics.js";',
        'export const pay = () => import("./payment.js");',
    ].join("\n"));
    const modules = await createModuleServer({
        root,
        build: "b1",
        minify: false,
        mounts,
    });
    (await get(modules, "/app/checkout.js")).body.split("\n");
    // → [
    //     'import { total } from "./cart.js?v=<code id>";',
    //     'export { price } from "./price.js?v=<code id>";',
    //     'import "/app/analytics.js?v=<code id>";',
    //     'export const pay = () => import("./payment.js?v=<code id>");',
    //   ]
    ```

  - A module is sent `immutable` only when its `?v` names this process's own code id; under any
    other it is revalidated.

    ```js
    const modules = await createModuleServer({ root, build: "b1", mounts });
    (await get(modules, `/app/cart.js?v=${modules.codeId}`)).cache;
    // → "public, max-age=31536000, immutable"
    (await get(modules, "/app/cart.js?v=b0CodeId01")).cache;
    // → "public, max-age=0, must-revalidate"
    ```

- A page contract that never changes between builds (`#app`, `#state`, `#services`, `start()`), so
  a page cached before a deploy boots the next build's entry.

  ```js
  import { renderDocument } from "juris-kit/server/document.js";
  const page = renderDocument(
      { html: "<h1>Your cart</h1>", json: '{"cart":{"count":2}}' },
      { entry: "/app/boot.js", serviceNames: ["addToCart"] },
  );
  [...page.matchAll(/ id="([\w-]+)"/g)].map(([, id]) => id);
  // → ["app", "state", "services"]
  page.includes('import("/app/boot.js").then((m) => m.start())'); // → true
  ```

  ```js
  // A page b1 wrote, kept in a cache, boots after b2 is out: it names b1's URL.
  const b1 = await createModuleServer({ root, build: "b1", mounts });
  const entry = await b1.versioned("/app/cart.js");
  await writeFile(join(root, "app/price.js"), "export const price = () => 4;\n");
  const b2 = await createModuleServer({ root, build: "b2", mounts });
  const answer = await get(b2, entry);
  answer.status; // → 200
  answer.cache; // → "public, max-age=0, must-revalidate"
  answer.body.split("\n")[0];
  // → 'import { price } from "./price.js?v=<code id>";'
  ```

- The skew guard. `hydrate`'s `skewGuard` compares the route the server named the page with the one
  this build names it; when they differ it reloads once, remembering that in `sessionStorage`, and
  never twice.

  ```js dom
  import { hydrate } from "juris/client.js";
  // The tab's sessionStorage: the stand-in page has none.
  const kept = new Map();
  globalThis.sessionStorage = {
      getItem: (key) => kept.get(key) ?? null,
      setItem: (key, value) => kept.set(key, String(value)),
      removeItem: (key) => kept.delete(key),
  };
  // b1 wrote this page as route "basket"; this build, b2, has no such route.
  document.body.innerHTML = '<div id="app"><h1>Basket</h1></div>'
      + '<script type="application/json" id="state">'
      + '{"$route":{"path":"/basket","name":"basket"}}</script>';
  const routes = [{ path: "/cart", name: "cart", component: "Cart" }];
  let reloads = 0;
  const skewGuard = { storageKey: "shop.skew", reload: () => reloads++ };
  await hydrate({ routes, skewGuard, live: false }); // → null
  // console.warn: Juris: the server rendered this page as route "basket",
  //   which this build calls "nothing": the code is not the server's.
  //   Reloading once.
  reloads; // → 1
  await hydrate({ routes, skewGuard, live: false });
  // console.error: Juris: still out of step with the server after a reload
  reloads; // → 1
  ```

- A full load instead of a broken page. A route whose code will not load (a module the other build
  lacks) loads that address in full instead, at most once per address.

  ```js dom
  import Juris from "juris/juris.js";
  import { createRouter } from "juris/router.js";
  // The tab's address and history: the stand-in page has neither.
  window.location = { pathname: "/", search: "", hash: "" };
  window.history = {
      state: null,
      replaceState(state) {
          this.state = state;
      },
      pushState(state, title, url) {
          this.state = state;
          window.location.pathname = url;
      },
  };
  const fullLoads = [];
  const router = createRouter({
      routes: [
          { path: "/", name: "home", component: "Home" },
          {
              path: "/checkout",
              name: "checkout",
              component: "Checkout",
              load: () => import("/app/pages/checkout.js"), // gone in this build
          },
      ],
      fullLoad: (url) => fullLoads.push(url),
      history: false,
  });
  const juris = new Juris();
  juris.use(router);
  await juris.api.navigate("/checkout");
  fullLoads; // → ["/checkout"]
  await juris.api.navigate("/checkout");
  // console.error: Router: the code for "/checkout" did not load, and a full
  //   load of it has been tried already
  fullLoads; // → ["/checkout"]
  ```

- An update notice is the app's to draw, from what the framework gives it: `/version` answers the
  running build (`no-store`), and a document can carry the build that wrote it (`buildMeta`).

  ```js
  import { createLifecycle } from "juris-kit/server/kernel.js";
  const life = createLifecycle({ build: "b2" });
  const app = (req, res) => res.writeHead(404).end();
  const server = createServer(life.serve(app));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/version`);
  await response.json(); // → { build: "b2" }
  response.headers.get("cache-control"); // → "no-store"
  server.close();
  ```

  ```js
  import { renderDocument } from "juris-kit/server/document.js";
  const page = renderDocument({}, {
      entry: "/app/boot.js",
      buildMeta: { name: "shop-build", content: "b1" },
  });
  page.split("\n")[6]; // → <meta name="shop-build" content="b1">
  ```

- Names that both builds share never change:
  - `liveKey`'s output, the live layer's codes (`LIVE_CODES`) and the words beside them, and the
    change bus's table, channel and `$pages` target.

    ```js
    import { liveKey, LIVE_CODES } from "juris/live-protocol.js";
    import { EVERYTHING } from "juris-kit/server/page-cache.js";
    import {
        CHANGE_TABLE,
        CHANNEL,
    } from "juris-kit/server/bus/pg-outbox.js";
    liveKey("stockOf", ["milk"]); // → 'stockOf:["milk"]'
    LIVE_CODES;
    // → {
    //     CLIENT_UNKNOWN: "live.client-unknown",
    //     NOT_A_QUERY: "live.not-a-query",
    //   }
    [CHANGE_TABLE, CHANNEL, EVERYTHING];
    // → ["change_events", "change_events", "$pages"]
    ```

  - The live client matches a refusal's code first and its words for one release, so either
    build's client recovers from either build's server.

    ```js
    import {
        serviceDispatcher,
    } from "juris-kit/server/service-dispatcher.js";
    const api = serviceDispatcher({ stockOf: async () => 12 }, "/api", {
        live: { public: true, queries: ["stockOf"] },
    });
    const server = createServer((req, res) => {
        api(req, res, new URL(req.url, "http://shop.test"));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    // A tab whose client id another instance minted, before it went down.
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/_live`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            client: "minted-by-the-old-instance",
            subscribe: { key: 'stockOf:["milk"]', name: "stockOf", args: ["milk"] },
        }),
    });
    response.status; // → 403
    await response.json();
    // → { error: "unknown or foreign client id", code: "live.client-unknown" }
    server.close();
    ```

  - One build id reaches every worker a process forks (`startProcess`'s `env`).

    ```js
    import { startProcess } from "juris-kit/server/process.js";
    // Node's cluster, as a test replaces it: it records each fork.
    const forked = [];
    const cluster = { isPrimary: true, fork: (env) => forked.push(env), on() {} };
    startProcess({
        workers: 2,
        liveQueries: false,
        env: { BUILD: "b2" },
        workerIdEnv: "WORKER_ID",
        cluster,
    }); // → "primary"
    forked;
    // → [
    //     { BUILD: "b2", WORKER_ID: "1" },
    //     { BUILD: "b2", WORKER_ID: "2" },
    //   ]
    ```

**Where.** `src/server/modules.js`, `src/server/document.js`, `src/client.js` (`skewGuard`),
`src/router.js` (`fullLoad`), `src/server/kernel.js` (`/version`), `src/live-protocol.js`,
`src/remote-services.js`. Tests: `juris-tests/tests/juris-kit/modules.test.mjs` (the snapshot, the
404, `immutable` only under its own code id),
`juris-tests/tests/juris-kit/modules.stamping.test.mjs` (one URL per module),
`juris-kit/tests/server.test.mjs` (the code id moves with the transform, and a template `import()`
is stamped), `juris-tests/tests/juris/client.skew-guard.test.mjs` (the skew guard),
`juris-tests/tests/juris/router.browser.test.mjs` (the full load),
`juris-tests/tests/juris/remote-services.sse-recovery.test.mjs`,
`juris-tests/tests/juris-kit/kernel.lifecycle.test.mjs`,
`juris-tests/tests/juris-kit/document.test.mjs`.

**What it does not prevent: a split boot.** A page fetches its modules one by one. If the instance
that answered one of them goes away and the balancer sends the next request to an instance on the
other build, one page boots from two builds. These outcomes have been seen in a mixed-build check
or worked out by reading the code:

- a module asks for an export the other build's copy of a module lacks, and the boot fails to link;

  ```js
  // b2's cart.js asks for formatPrice, which b1's price.js lacks.
  await writeFile(
      join(root, "app/cart.js"),
      'import { formatPrice } from "./price.js";\n',
  );
  await import(pathToFileURL(join(root, "app/cart.js")));
  // throws SyntaxError: The requested module './price.js' does not provide an
  //   export named 'formatPrice'
  ```

- a module the other build never had answers 404;

  ```js
  const b1 = await createModuleServer({ root, build: "b1", mounts });
  // A b2 page asks this b1 instance for a module b2 added.
  await writeFile(join(root, "app/coupons.js"), "export const tenOff = 10;\n");
  (await get(b1, "/app/coupons.js")).status; // → 404
  ```

- in either case the page stays the server's page, readable and not live, until its next full load;

  ```js dom
  import { hydrate } from "juris/client.js";
  document.body.innerHTML = '<div id="app"><h1>Checkout</h1></div>'
      + '<script type="application/json" id="state">'
      + '{"$route":{"path":"/checkout"}}</script>';
  const routes = [{
      path: "/checkout",
      name: "checkout",
      component: "Checkout",
      load: () => import("/app/pages/checkout.js"), // not on this instance
  }];
  await hydrate({ routes, live: false }); // throws
  document.getElementById("app").innerHTML; // → <h1>Checkout</h1>
  ```

- in one pairing (a router from one build, a route table from the other) the page's main area was
  drawn blank until the next full load;

  ```js dom
  import { hydrate } from "juris/client.js";
  // b1's page at /basket, booted with b2's route table, which has no /basket.
  document.body.innerHTML = '<div id="app"><main><h1>Basket</h1></main></div>'
      + '<script type="application/json" id="state">'
      + '{"$route":{"path":"/basket","name":"basket"}}</script>';
  const routes = [{ path: "/cart", name: "cart", component: "Cart" }];
  const register = (juris) => {
      juris.registerComponent("App", () => ({
          main: { children: [{ RouterView: {} }] },
      }));
  };
  await hydrate({ routes, register, live: false });
  document.getElementById("app").innerHTML; // → <main></main>
  ```

- an old page whose router loads a new page module does one full load.

  ```js dom
  import Juris from "juris/juris.js";
  import { createRouter } from "juris/router.js";
  // The tab's address and history: the stand-in page has neither.
  window.location = { pathname: "/", search: "", hash: "" };
  window.history = {
      state: null,
      replaceState(state) {
          this.state = state;
      },
      pushState(state, title, url) {
          this.state = state;
          window.location.pathname = url;
      },
  };
  // b2's page module needs an export b1's price.js does not have.
  await mkdir(join(root, "app/pages"));
  const orders = join(root, "app/pages/orders.js");
  await writeFile(orders, 'export { formatPrice } from "../price.js";\n');
  const fullLoads = [];
  const router = createRouter({
      routes: [
          { path: "/", name: "home", component: "Home" },
          {
              path: "/orders",
              name: "orders",
              component: "Orders",
              load: () => import(pathToFileURL(orders)),
          },
      ],
      fullLoad: (url) => fullLoads.push(url),
      history: false,
  });
  const juris = new Juris();
  juris.use(router);
  await juris.api.navigate("/orders");
  fullLoads; // → ["/orders"]
  ```

The window is narrow: two requests a few milliseconds apart, with an instance going down between
them. Where it matters, a change is shipped over two releases, the old shape kept for one more.

```js
// Release 1 renames price to priceOf, and keeps the old name for one more.
await writeFile(join(root, "app/price.js"), [
    'export const priceOf = (sku) => (sku === "milk" ? 3 : 5);',
    "export const price = priceOf; // the old name, gone in release 2",
].join("\n"));
// A page still on release 0's cart.js links, and adds up.
const { total } = await import(pathToFileURL(join(root, "app/cart.js")));
total(["milk", "eggs"]); // → 8
```

### A page cache that knows what each page read

The examples on this page share one server instance of a shop, with its routes and components, and
a way to serve its pages through the kit's page pipeline, in front of a page cache, as a server
does; the visitor is whoever the request's `x-user` header names, and a guest when it names nobody.

```js setup
import { createServer } from "node:http";
import Juris from "juris/juris.js";
import { createRouter } from "juris/router.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";
import { createPagePipeline } from "juris-kit/server/kernel.js";
import {
    createPageCache,
    decide,
    canonicalPath,
    pageCacheKey,
    EVERYTHING,
} from "juris-kit/server/page-cache.js";

const juris = new Juris({
    services: {
        price: async (sku) => (sku === "milk" ? 3 : 5),
        product: async (slug) => ({ name: slug === "milk" ? "Milk" : "Eggs" }),
        stock: async () => {
            throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
        },
    },
    features: { ssr: SSRRenderer },
});
const router = createRouter({
    routes: [
        {
            path: "/products/:slug",
            name: "product",
            component: "Product",
            preload: ({ params }) => [["product", params.slug]],
            head: { titleFrom: (product) => product?.name },
        },
        { path: "/search", name: "search", component: "Search" },
        { path: "/account", name: "account", component: "Account" },
    ],
    guard: (to, { viewer }) => {
        if (to.name === "account" && !viewer) return "/login";
    },
});
juris.use(router);
juris.registerComponent("App", () => ({
    main: { children: [{ RouterView: {} }] },
}));
juris.registerComponent("Price", (props, api) => ({
    span: { textContent: () => api.call("price", props.sku) },
}));
juris.registerComponent("Product", () => ({ h1: "Today's pick" }));
juris.registerComponent("Search", (props, api) => ({
    p: { textContent: () => `Results for ${api.getState("$route.query.q")}` },
}));
juris.registerComponent("Account", () => ({ h1: "Your account" }));

// Two pages, rendered and traced: one reads a price, one reads nothing.
const milkPage = () => juris.renderRequest({
    preload: [["price", "milk"]],
    layout: { Price: { sku: "milk" } },
    trace: true,
});
const aboutPage = () => juris.renderRequest({
    layout: { p: "About the shop" },
    trace: true,
});

// The pages, served in front of `cache` on port 0. `renders` logs each render
// and what the cache made of it.
async function serve(cache) {
    const renders = [];
    const pipeline = createPagePipeline({
        juris,
        router,
        cache,
        entry: "/app/boot.js",
        cacheParams: ["q"],
        viewer: (req) => req.headers["x-user"] ?? null,
        onRender: ({ key, decision }) => {
            renders.push(`${key} ${decision.reason}`);
        },
    });
    const server = createServer((req, res) => pipeline.handle(req, res));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const get = async (path, user) => {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            headers: user ? { "x-user": user } : {},
            redirect: "manual",
        });
        return {
            status: response.status,
            cache: response.headers.get("cache-control"),
            location: response.headers.get("location"),
            body: await response.text(),
        };
    };
    return { get, renders, close: () => server.close() };
}
```

**The problem.** Keeping rendered pages is what makes a server-rendered site cheap, but a cache
keyed by URL with a timeout can only guess. Too long, and a change is not shown; too short, and it
saves nothing. And one page made for a signed-in reader, or one that read something its URL does
not carry, served to the next visitor, is a leak.

**What Juris does.**

- `renderRequest({ after })`: `after(result)` is called inside the render's synchronous section,
  after `renderToString` and before the next request can begin, with the same `result(name, ...args)`
  the render answers; what it returns is the render's `after`.

  ```js
  const page = await juris.renderRequest({
      preload: [["price", "milk"]],
      layout: { Price: { sku: "milk" } },
      after: (result) => `Milk, ${result("price", "milk")} €`,
  });
  page.html; // → <span>3</span>
  page.after; // → "Milk, 3 €"
  ```

  - For what must read what the render itself set (module state an app's components write as they
    draw), which any later `await` could see replaced by another request's render.

    ```js
    let language = null; // module state, set by the page as it draws
    juris.registerComponent("Basket", (props) => {
        language = props.language;
        return { h1: language === "fr" ? "Panier" : "Basket" };
    });
    const render = (language) => juris.renderRequest({
        layout: { Basket: { language } },
        after: () => language,
    });
    const [french, english] = await Promise.all([render("fr"), render("en")]);
    [french.after, english.after]; // → ["fr", "en"]
    language; // → "en"
    ```

- A server render can be traced (`renderRequest({ trace: true })`): the services it called, the
  state roots it read (`peek` included), its live queries, the flags a plugin set (the clock's), any
  component it could not find, and each service whose preloaded call failed (`failed`, read or not).

  ```js
  juris.registerComponent("Header", (props, api) => ({
      p: api.peek("cart.open") ? "Cart open" : "Cart closed",
  }));
  const page = await juris.renderRequest({
      preload: [["price", "milk"]],
      state: { cart: { open: true } },
      layout: {
          div: {
              children: [
                  { Header: {} },
                  { Price: { sku: "milk" } },
                  { Sidebar: {} },
              ],
          },
      },
      trace: true,
  });
  page.html;
  // → <div><p>Cart open</p><span>3</span><Sidebar></Sidebar></div>
  page.trace.services; // → ["price"]
  page.trace.roots; // → ["cart"]
  page.trace.unknown; // → ["Sidebar"]
  ```

  ```js
  import { clock } from "juris/clock.js";
  juris.use(clock());
  juris.registerComponent("Deal", (props, api) => {
      api.live("deal", "price", "milk");
      const year = new Date(api.now()).getFullYear();
      const text = () => `${api.getState("deal")} € in ${year}`;
      return { p: { textContent: text } };
  });
  const page = await juris.renderRequest({
      preload: [["price", "milk"], ["stock", "milk"]],
      layout: { Deal: {} },
      trace: true,
  });
  page.trace.live; // → ["price"]
  page.trace.flags; // → ["clock"]
  page.trace.failed; // → ["stock"]
  ```

- `decide` keeps a page only when it was rendered for a guest, is not a 404, had no preloaded call
  fail, drew no unknown component, carries no flag, and read no state root its URL does not key.

  ```js
  const about = await juris.renderRequest({
      layout: { p: "About the shop" },
      trace: true,
  });
  decide(about.trace);
  // → { cache: true, reason: "static", forever: true, services: [] }
  decide(about.trace, { viewer: "ada" });
  // → { cache: false, reason: "personal" }
  decide(about.trace, { status: 404 }); // → { cache: false, reason: "not-found" }
  ```

  ```js
  const failed = await juris.renderRequest({
      preload: [["stock", "milk"]],
      layout: { p: "In stock" },
      trace: true,
  });
  decide(failed.trace); // → { cache: false, reason: "failed:stock" }
  const holed = await juris.renderRequest({
      layout: { Sidebar: {} },
      trace: true,
  });
  decide(holed.trace); // → { cache: false, reason: "unknown:Sidebar" }
  ```

  ```js
  const french = await juris.renderRequest({
      state: { locale: "fr" },
      layout: { p: { textContent: () => juris.getState("locale") } },
      trace: true,
  });
  decide(french.trace, { unkeyedRoots: ["locale"] });
  // → { cache: false, reason: "request-state:locale" }
  ```

  - A page that read nothing is kept until the cache is cleared; one that read services, until a
    change names one of them.

    ```js
    const cache = createPageCache();
    const about = await aboutPage();
    const milk = await milkPage();
    cache.put("/about", about, about.trace, {}).reason; // → "static"
    cache.put("/milk", milk, milk.trace, {}).reason; // → "dependent"
    cache.invalidate(["price"]);
    [cache.has("/about"), cache.has("/milk")]; // → [true, false]
    cache.clear();
    cache.has("/about"); // → false
    ```

  - A failed render is that request's failure, not the page, so it also leaves the page kept before
    it as it was, and hands a stale page's replacement back for the next visitor.

    ```js
    let now = 0;
    const cache = createPageCache({ ttlMs: 1000, now: () => now });
    const milk = await milkPage();
    cache.put("/milk", milk, milk.trace, {});
    now = 5000; // past its time: served stale, and this visitor replaces it
    cache.get("/milk").stale; // → true
    const failed = { ...milk.trace, failed: ["price"] };
    cache.put("/milk", { html: "<p>request failed</p>" }, failed, {}).reason;
    // → "failed:price"
    cache.get("/milk").entry.html; // → <span>3</span>
    cache.get("/milk").stale; // → false
    ```

  - The route's own call, which the kernel reads for the status and the title, counts as read by
    the page whatever its body calls.

    ```js
    const pipeline = createPagePipeline({ juris, router, entry: "/app/boot.js" });
    const page = await pipeline.render("/products/milk");
    page.body.toString().includes("<title>Milk</title>"); // → true
    page.trace.services; // → ["product"]
    page.trace.static; // → false
    ```

- Invalidation comes from the services.
  - A mutation's `touches` names what it changes, and the dispatcher hands those same targets to
    the cache (`live.onInvalidate`), on this instance and, over the change bus, on every other.

    ```js
    import {
        serviceDispatcher,
    } from "juris-kit/server/service-dispatcher.js";
    const cache = createPageCache();
    const prices = { milk: 3 };
    const api = serviceDispatcher({
        price: async (sku) => prices[sku],
        setPrice: async (sku, euros) => (prices[sku] = euros),
    }, "/api", {
        live: {
            public: true,
            touches: { setPrice: ["price"] },
            onInvalidate: (targets) => cache.invalidate(targets),
        },
    });
    const milk = await milkPage();
    cache.put("/milk", milk, milk.trace, {});
    await api.invoke("setPrice", ["milk", 4]); // → { ok: true, result: 4 }
    cache.has("/milk"); // → false
    ```

    ```js
    import {
        serviceDispatcher,
    } from "juris-kit/server/service-dispatcher.js";
    // A change bus, in memory: every instance on it hears what any publishes.
    const listeners = [];
    const bus = {
        publish: async (targets) => listeners.forEach((hear) => hear(targets)),
        subscribe: (hear) => listeners.push(hear),
    };
    const services = { price: async () => 3, setPrice: async () => 4 };
    const live = { public: true, touches: { setPrice: ["price"] }, bus };
    const cacheOfB = createPageCache();
    const a = serviceDispatcher(services, "/api", { live });
    serviceDispatcher(services, "/api", {
        live: { ...live, onInvalidate: (targets) => cacheOfB.invalidate(targets) },
    });
    const milk = await milkPage();
    cacheOfB.put("/milk", milk, milk.trace, {});
    await a.invoke("setPrice", ["milk", 4]);
    cacheOfB.has("/milk"); // → false
    ```

  - A render that raced a change is refused (`snapshot()` and `put`), and so is any page rendered
    across an `EVERYTHING` invalidation or a `clear()`.

    ```js
    const cache = createPageCache();
    const before = cache.snapshot();
    const milk = await milkPage();
    cache.invalidate(["price"]); // announced while the page rendered
    cache.put("/milk", milk, milk.trace, {}, before).reason; // → "raced"
    cache.has("/milk"); // → false
    ```

    ```js
    const cache = createPageCache();
    const about = await aboutPage();
    const before = cache.snapshot();
    cache.invalidate([EVERYTHING]);
    cache.put("/about", about, about.trace, {}, before).reason; // → "raced"
    const again = cache.snapshot();
    cache.clear();
    cache.put("/about", about, about.trace, {}, again).reason; // → "raced"
    ```

- The pipeline asks the guard before the cache, never serves a viewer the guests' copy (nor asks the
  cache about a viewer's page, whose refused put would drop the guests' copy), redirects
  every path to one spelling first (`canonicalPath`), and renders a page it may keep from its cache
  key (`pageCacheKey`), so no visitor's other query parameters travel in it.

  ```js
  const cache = createPageCache();
  const shop = await serve(cache);
  (await shop.get("/products/milk")).cache;
  // → "public, max-age=0, must-revalidate"
  (await shop.get("/products/milk", "ada")).cache; // → "private, no-cache"
  cache.has("/products/milk"); // → true
  shop.renders; // → ["/products/milk dependent", "/products/milk personal"]
  await shop.get("/account");
  // → { status: 302, cache: null, location: "/login", body: "" }
  shop.close();
  ```

  ```js
  canonicalPath("/products//milk/").redirect; // → "/products/milk"
  canonicalPath("/shop/%2e%2e/account").redirect; // → "/account"
  const url = new URL("https://shop.test/search?utm_source=mail&q=milk");
  pageCacheKey(url, new Set(["q"])); // → "/search?q=milk"
  ```

  ```js
  const shop = await serve(createPageCache());
  const page = await shop.get("/search?q=milk&utm_source=mail");
  page.body.includes("Results for milk</p>"); // → true
  page.body.match(/"query":\{[^}]*\}/)[0]; // → '"query":{"q":"milk"}'
  page.body.includes("utm_source"); // → false
  (await shop.get("/products//milk")).location; // → "/products/milk"
  shop.close();
  ```

**Where.** `src/server/page-cache.js`, `src/juris.js` (`renderTrace`), `src/server/ssr-renderer.js`
(the trace it records), `src/server/kernel.js` (`createPagePipeline`),
`src/server/service-dispatcher.js` (`live.onInvalidate`). Tests:
`juris-tests/tests/juris-kit/page-cache.test.mjs`,
`juris-tests/tests/juris-kit/page-cache.cache.test.mjs`,
`juris-tests/tests/juris-kit/page-cache.paths.test.mjs`,
`juris-tests/tests/juris-kit/ssr-renderer.components.test.mjs`,
`juris-tests/tests/juris/juris.calls.test.mjs`,
`juris-tests/tests/juris-kit/kernel.pipeline.test.mjs`,
`juris-tests/tests/juris-kit/service-dispatcher.invalidate.test.mjs` ("onInvalidate is told of every
invalidation before anything is awaited, function targets included", "what arrives off the bus
re-runs groups here without being published again, and onInvalidate hears it as remote"),
`juris-kit/tests/server.test.mjs` (the own call in the trace, the viewer's page, a put across
`EVERYTHING`).

**What it costs.** The cache is right only as far as the app declares: `touches` must name what
each mutation changes (the dispatcher's `strict` makes every service say), and `unkeyedRoots` the
state roots that vary per request.

```js
import {
    serviceDispatcher,
} from "juris-kit/server/service-dispatcher.js";
const services = {
    price: async (sku) => 3,
    setPrice: async (sku, euros) => euros,
};
const strict = { names: ["price", "setPrice"] };
const live = { public: true, queries: ["price"] };
serviceDispatcher(services, "/api", { strict, live: { ...live, touches: {} } });
// throws Error: serviceDispatcher: strict:
typeof serviceDispatcher(services, "/api", {
    strict,
    live: { ...live, touches: { setPrice: ["price"] } },
}); // → "function"
```

```js
const cache = createPageCache({ unkeyedRoots: ["locale"] });
const french = await juris.renderRequest({
    state: { locale: "fr" },
    layout: { p: { textContent: () => juris.getState("locale") } },
    trace: true,
});
cache.put("/about", french, french.trace, {}).reason;
// → "request-state:locale"
```

The cache is in each process's memory.

```js
const thisInstance = createPageCache();
const otherInstance = createPageCache();
const about = await aboutPage();
thisInstance.put("/about", about, about.trace, {});
[thisInstance.has("/about"), otherInstance.has("/about")]; // → [true, false]
```

A page for a signed-in reader is never cached, so such pages cost a render each time.

```js
const shop = await serve(createPageCache());
await shop.get("/products/milk", "ada");
await shop.get("/products/milk", "ada");
shop.renders; // → ["/products/milk personal", "/products/milk personal"]
shop.close();
```

The kernel takes a cache only beside a dispatcher the app built and wired to it ("Not yet").

```js
import { createJurisServer } from "juris-kit/server/kernel.js";
await createJurisServer({
    root: ".",
    build: "b1",
    services: {},
    routes: [],
    cache: createPageCache(),
    modules: { entry: "/app/boot.js" },
});
// throws TypeError: createJurisServer: a page cache is kept up to date by the
//   services' invalidations, which a dispatcher built here does not carry to it
```

### Live queries are pure functions of their arguments

The examples on this page serve a shop's stock through the kit's service dispatcher on port 0, and
do over HTTP what a browser tab does: open the event stream, subscribe, and read what it is sent.

```js setup
import { createServer } from "node:http";
import {
    serviceDispatcher,
} from "juris-kit/server/service-dispatcher.js";
import { liveKey, callKind } from "juris/live-protocol.js";

// The shop's stock, a live query over it, and a change to it. `calls` keeps
// the kind of each call stockOf answers.
const stock = { milk: 12, eggs: 30 };
const calls = [];
const services = {
    async stockOf(sku) {
        calls.push(callKind(this));
        return { sku, count: stock[sku] };
    },
    async restock(sku, count) {
        stock[sku] += count;
        return stock[sku];
    },
};

// A dispatcher of `services` (and `more`), made with `options` and served. The
// caller is whoever a request's x-user header names.
async function serve(options, more = {}) {
    const api = serviceDispatcher({ ...services, ...more }, "/api", {
        context: (req) => ({ viewer: req.headers["x-user"] }),
        ...options,
    });
    const server = createServer(async (req, res) => {
        const url = new URL(req.url, "http://shop.test");
        if (!(await api(req, res, url))) res.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    // A JSON POST, as remoteServices sends one.
    const post = async (name, body, headers = {}) => {
        const response = await fetch(`${base}/${name}`, {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
    };
    // A tab's event stream: its client id, and next(type), its next such event.
    const openTab = async (headers = {}) => {
        const response = await fetch(`${base}/events`, { headers });
        const decoded = response.body.pipeThrough(new TextDecoderStream());
        const reader = decoded.getReader();
        let text = "";
        const next = async (type) => {
            const event = new RegExp(`event: ${type}\\ndata: (.*)\\n\\n`);
            let found;
            while (!(found = event.exec(text))) {
                text += (await reader.read()).value;
            }
            text = text.slice(found.index + found[0].length);
            return JSON.parse(found[1]);
        };
        const { client } = await next("hello");
        return { client, next };
    };
    // A subscribe, as the live client sends one.
    const subscribe = (tab, name, args, headers) => post("_live", {
        client: tab.client,
        subscribe: { key: liveKey(name, args), name, args },
    }, headers);
    const close = () => {
        api.close();
        server.closeAllConnections();
        server.close();
    };
    return { api, base, post, openTab, subscribe, close };
}
```

**The problem.** A live query is shared. Every browser subscribed to the same name and arguments
is one group, run once and run again once per change, with no request behind the re-run. A query
that read the session would compute one reader's answer and send it to everyone in the group; and
a query that takes its reader as an argument answers for whoever a browser names.

```js
const shop = await serve({
    live: {
        public: true,
        queries: ["stockOf"],
        touches: { restock: ["stockOf"] },
    },
});
const ada = await shop.openTab();
const bob = await shop.openTab();
await shop.subscribe(ada, "stockOf", ["milk"]);
await shop.subscribe(bob, "stockOf", ["milk"]);
shop.api.stats().groups; // → 1
await shop.post("restock", ["milk", 6]);
(await bob.next("patch")).full; // → { sku: "milk", count: 12 }
(await bob.next("patch")).set; // → [["count", 18]]
calls; // → ["live", "live"]
shop.close();
```

**What Juris does.**

- The key is the call: `liveKey(name, args)` is `name:JSON(args)`, and the server refuses a
  subscribe whose key is not the one it computes.

  ```js
  liveKey("stockOf", ["milk"]); // → 'stockOf:["milk"]'
  liveKey("ordersOf", [7, { status: "open" }]);
  // → 'ordersOf:[7,{"status":"open"}]'
  ```

  ```js
  const shop = await serve({ live: { public: true, queries: ["stockOf"] } });
  const tab = await shop.openTab();
  await shop.post("_live", {
      client: tab.client,
      subscribe: { key: 'stockOf:["eggs"]', name: "stockOf", args: ["milk"] },
  });
  // → {
  //     status: 400,
  //     body: { error: "key must be the query's own name:JSON(args)" },
  //   }
  shop.close();
  ```

- A dispatcher with live queries cannot be built without `live.authorize` or `live.public: true`.

  ```js
  serviceDispatcher(services, "/api", { live: { queries: ["stockOf"] } });
  // throws Error: serviceDispatcher: live queries need live.authorize(name, args,
  //   info), or live.public: true if every one of them is for everybody
  ```

  - `authorize(name, args, info)` runs on every subscribe, on a direct POST to a declared query,
    and again while the subscription lives: before a patch is delivered, at most once per
    `recheckMs` for each client and query, and at once on `handler.invalidateAccess` (whatever
    `recheckMs` is), each time with the context captured at subscribe.

    ```js
    const members = new Set(["ada"]);
    const shop = await serve({
        live: {
            queries: ["stockOf"],
            authorize() {
                return members.has(this.viewer);
            },
        },
    });
    const tab = await shop.openTab();
    const bob = { "x-user": "bob" };
    await shop.subscribe(tab, "stockOf", ["milk"], bob);
    // → { status: 403, body: { error: 'not allowed to subscribe to "stockOf"' } }
    await shop.post("stockOf", ["milk"], bob);
    // → { status: 403, body: { error: "not allowed" } }
    (await shop.post("stockOf", ["milk"], { "x-user": "ada" })).body;
    // → { sku: "milk", count: 12 }
    shop.close();
    ```

    ```js
    const members = new Set(["ada"]);
    const asked = [];
    const shop = await serve({
        live: {
            queries: ["stockOf"],
            touches: { restock: ["stockOf"] },
            recheckMs: 1,
            authorize() {
                asked.push(this.viewer);
                return members.has(this.viewer);
            },
        },
    });
    const tab = await shop.openTab();
    await shop.subscribe(tab, "stockOf", ["milk"], { "x-user": "ada" });
    await tab.next("patch");
    members.delete("ada");
    await new Promise((resolve) => setTimeout(resolve, 5)); // past recheckMs
    await shop.post("restock", ["milk", 6]); // a change, made by anyone
    await tab.next("patch"); // → { key: 'stockOf:["milk"]', error: "not allowed" }
    asked.at(-1); // → "ada"
    shop.api.stats().subscriptions; // → 0
    shop.close();
    ```

    ```js
    const members = new Set(["ada"]);
    const shop = await serve({
        live: {
            queries: ["stockOf"],
            recheckMs: 0,
            authorize() {
                return members.has(this.viewer);
            },
        },
    });
    const tab = await shop.openTab();
    await shop.subscribe(tab, "stockOf", ["milk"], { "x-user": "ada" });
    members.delete("ada");
    await shop.api.invalidateAccess(() => true); // → 1
    shop.api.stats().subscriptions; // → 0
    shop.close();
    ```

  - Nothing re-asks on a clock: a subscription whose query never changes stays registered,
    holding that context and counting against its caller's ceilings, until its stream closes or
    `invalidateAccess` reaches it. What it is sent is still gated.

    ```js
    const members = new Set(["ada"]);
    const shop = await serve({
        live: {
            queries: ["stockOf"],
            recheckMs: 1,
            authorize() {
                return members.has(this.viewer);
            },
        },
    });
    const tab = await shop.openTab();
    await shop.subscribe(tab, "stockOf", ["milk"], { "x-user": "ada" });
    await tab.next("patch");
    members.delete("ada");
    await new Promise((resolve) => setTimeout(resolve, 20)); // no change comes
    shop.api.stats().subscriptions; // → 1
    shop.close();
    ```

- `live.strictQueries: true` makes the declared `live.queries` the only names a browser may
  subscribe to; a name a `touches` list gives is then an invalidation name only.

  ```js
  const shop = await serve({
      live: {
          public: true,
          strictQueries: true,
          queries: [],
          touches: { restock: ["stockOf"] },
      },
  });
  const tab = await shop.openTab();
  await shop.subscribe(tab, "stockOf", ["milk"]);
  // → {
  //     status: 403,
  //     body: {
  //       error: '"stockOf" is not a live query',
  //       code: "live.not-a-query",
  //     },
  //   }
  shop.close();
  ```

- Every call says what kind it is.
  - A service reads `callKind(this)`; a live query's re-run has a frozen context that names nobody,
    and anything that does not say is a stranger's `"direct"` call.

    ```js
    const seen = [];
    const shop = await serve({ live: { public: true, queries: ["cartOf"] } }, {
        async cartOf(cartId) {
            seen.push([callKind(this), this.viewer, Object.isFrozen(this)]);
            return { cartId, lines: 2 };
        },
    });
    await shop.post("cartOf", [7], { "x-user": "ada" });
    const tab = await shop.openTab();
    await shop.subscribe(tab, "cartOf", [7], { "x-user": "ada" });
    seen; // → [["direct", "ada", false], ["live", undefined, true]]
    shop.close();
    ```

    ```js
    import Juris from "juris/juris.js";
    const server = new Juris({ services });
    await server.preload([["stockOf", "milk"]]);
    calls; // → ["preload"]
    callKind(undefined); // → "direct"
    callKind({ kind: "live" }); // → "direct"
    callKind(JSON.parse('{"juris.callKind":"live"}')); // → "direct"
    ```

  - So an app believes a viewer passed as an argument only on `"preload"` (the server chose it)
    and `"live"` (`authorize` matched it to the session).

    ```js
    import { fail } from "juris/errors.js";
    const shop = await serve({
        live: {
            queries: ["ordersOf"],
            authorize(name, [userId]) {
                return this.viewer === userId;
            },
        },
    }, {
        async ordersOf(userId) {
            const trusted = ["preload", "live"].includes(callKind(this));
            if (!trusted && this.viewer !== userId) {
                fail("Those orders are not yours.", { status: 403 });
            }
            return [`#1001 for ${userId}`];
        },
    });
    (await shop.post("ordersOf", ["ada"], { "x-user": "bob" })).status; // → 403
    (await shop.post("ordersOf", ["ada"], { "x-user": "ada" })).body;
    // → ["#1001 for ada"]
    const tab = await shop.openTab();
    (await shop.subscribe(tab, "ordersOf", ["ada"], { "x-user": "bob" })).status;
    // → 403
    shop.close();
    ```

- Client ids are minted by the server and bound to the caller (`identify`); each caller has
  ceilings; a stream too far behind is dropped.

  ```js
  const shop = await serve({
      live: {
          public: true,
          queries: ["stockOf"],
          identify() {
              return this.viewer ?? null;
          },
      },
  });
  const tab = await shop.openTab({ "x-user": "ada" });
  /^[0-9a-f-]{36}$/.test(tab.client); // → true
  await shop.subscribe(tab, "stockOf", ["milk"], { "x-user": "bob" });
  // → {
  //     status: 403,
  //     body: {
  //       error: "unknown or foreign client id",
  //       code: "live.client-unknown",
  //     },
  //   }
  (await shop.subscribe(tab, "stockOf", ["milk"], { "x-user": "ada" })).status;
  // → 200
  shop.close();
  ```

  ```js
  const shop = await serve({
      live: { public: true, queries: ["stockOf"], maxStreamsPerCaller: 1 },
  });
  await shop.openTab();
  const second = await fetch(`${shop.base}/events`);
  second.status; // → 429
  await second.json(); // → { error: "at most 1 live streams at a time" }
  shop.close();
  ```

  ```js
  const shop = await serve({
      live: { public: true, queries: ["stockOf"], maxBufferBytes: 1 },
  });
  const tab = await shop.openTab();
  await shop.subscribe(tab, "stockOf", ["milk"]); // its first answer: past 1 byte
  await new Promise((resolve) => setTimeout(resolve, 5));
  shop.api.stats().droppedForLag; // → 1
  shop.close();
  ```

**Where.** `src/server/service-dispatcher.js`, `src/live-protocol.js`. Tests:
`juris-tests/tests/juris-kit/service-dispatcher.test.mjs` ("live queries without authorize or
public: true are refused at construction"),
`juris-tests/tests/juris-kit/service-dispatcher.calls.test.mjs` ("a direct POST to a declared query
asks authorize, as the request's context, with the request"),
`juris-tests/tests/juris-kit/service-dispatcher.timers.test.mjs` ("a re-check that refuses withholds
the patch, tells the client 'not allowed' and drops the subscription"),
`juris-tests/tests/juris-kit/service-dispatcher.live.test.mjs` (`strictQueries`, client ids bound to
their owner, each caller's ceilings), `juris-tests/tests/juris/live-protocol.test.mjs`,
`juris-tests/tests/juris/juris.calls.test.mjs`, `juris-kit/tests/live.test.mjs` (`invalidateAccess`
with `recheckMs: 0`, the name of an object `touches` target, one stream per client id).

**What it costs.** Purity is the app's to keep: nothing stops a live query from reading `this`, so
an app should test that each live query answers a direct call as it answers its live run.

```js
// Not pure: it reads its caller from `this`.
const shop = await serve({ live: { public: true, queries: ["myCart"] } }, {
    async myCart() {
        return { owner: this.viewer ?? "nobody" };
    },
});
const direct = (await shop.post("myCart", [], { "x-user": "ada" })).body;
const tab = await shop.openTab();
await shop.subscribe(tab, "myCart", [], { "x-user": "ada" });
const live = (await tab.next("patch")).full;
[direct, live]; // → [{ owner: "ada" }, { owner: "nobody" }]
shop.close();
```

`strictQueries` is opt-in.

```js
const shop = await serve({
    live: { public: true, queries: [], touches: { restock: ["stockOf"] } },
});
const tab = await shop.openTab();
(await shop.subscribe(tab, "stockOf", ["milk"])).status; // → 200
shop.close();
```

A viewer's personal data needs a group of its own, since there is no per-viewer channel, and taking
access away reaches only the instance that acted ("Not yet").

```js
const shop = await serve({ live: { public: true, queries: ["ordersOf"] } }, {
    async ordersOf(userId) {
        return [`#1001 for ${userId}`];
    },
});
const ada = await shop.openTab();
const bob = await shop.openTab();
await shop.subscribe(ada, "ordersOf", ["ada"]);
await shop.subscribe(bob, "ordersOf", ["bob"]);
shop.api.stats().groups; // → 2
shop.close();
```

```js
const members = new Set(["ada"]);
const options = {
    live: {
        queries: ["stockOf"],
        recheckMs: 0,
        authorize() {
            return members.has(this.viewer);
        },
    },
};
const one = await serve(options);
const two = await serve(options);
const ada = { "x-user": "ada" };
await one.subscribe(await one.openTab(), "stockOf", ["milk"], ada);
await two.subscribe(await two.openTab(), "stockOf", ["milk"], ada);
members.delete("ada");
await one.api.invalidateAccess(() => true); // → 1
one.api.stats().subscriptions; // → 0
two.api.stats().subscriptions; // → 1
one.close();
two.close();
```

### Safe by default

The examples on this page share a server instance of Juris, given the kit's string renderer, and
serve what they answer over HTTP behind the kit's lifecycle, as the kit's server does: it answers a
target no URL can be made of with a 400, and anything that throws with a fixed 500.

```js setup
import { createServer, request } from "node:http";
import Juris from "juris/juris.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";
import { createLifecycle } from "juris-kit/server/kernel.js";
import {
    serviceDispatcher,
} from "juris-kit/server/service-dispatcher.js";
import { fail } from "juris/errors.js";

const juris = new Juris({ features: { ssr: SSRRenderer } });

// Two services: one refuses in its reader's words, one fails as a driver does.
const services = {
    async renameList({ name }) {
        if (!name) fail("Give the list a name.", { field: "name" });
        return { name };
    },
    async checkout() {
        const words = "duplicate key value violates unique constraint";
        throw new Error(`${words} "orders_pkey"`);
    },
};

// `handler` behind the lifecycle, on port 0. `logged` is the server's log.
const logged = [];
async function serve(handler, lifecycle = {}) {
    const life = createLifecycle({
        build: "b1",
        onError: (error, where) => logged.push(`${where}: ${error.message}`),
        ...lifecycle,
    });
    const server = createServer(life.serve(async (req, res, url) => {
        if (!(await handler(req, res, url))) res.writeHead(404).end();
    }));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    return { port, base, close: () => server.close() };
}
```

**The problem.** The unsafe default is the one nobody notices until someone uses it: a sanitiser
that misses one spelling, an error message that names a table, a form any site can post, an
argument that claims to say who is calling.

**What Juris does.**

- Refused, not sanitised.
  - Both renderers refuse a tag that runs code, loads a document or reaches the whole page
    (`script`, `iframe`, `object`, `embed`, `base`, `meta`, `link`, `style` (SVG's too),
    `plaintext`, SVG's `set` and `animate…`), a tag name that came from data, an `on…` or
    malformed attribute name, `srcdoc`, a URL whose scheme is not allowed (`javascript:` and
    `vbscript:` never, `data:` for an image only), control characters stripped first, a `style`
    object's key that is not a property or value that would end its declaration, and `innerHTML`,
    which is markup, unless the instance says `allowInnerHTML: true`.

    ```js dom
    const layout = {
        div: {
            children: [
                { script: "steal()" },
                { iframe: { src: "/ad" } },
                { style: "body { display: none }" },
                { svg: { children: [{ set: { attributeName: "href" } }] } },
                { p: "Milk" },
            ],
        },
    };
    const page = document.createElement("main");
    juris.render(page, layout);
    page.innerHTML; // → <div><svg></svg><p>Milk</p></div>
    juris.renderToString(layout); // → <div><svg></svg><p>Milk</p></div>
    ```

    ```js
    const fromData = "img src=x onerror=steal()";
    juris.renderToString({ [fromData]: {} }); // → ""
    juris.renderToString({
        button: {
            onclick: "steal()",
            'x" onfocus="steal()': "",
            textContent: "Pay",
        },
    });
    // → <button>Pay</button>
    juris.renderToString({ div: { srcdoc: "<script>steal()</script>" } });
    // → <div></div>
    ```

    ```js
    const link = (href) => juris.renderToString({ a: { href, textContent: "Go" } });
    link("java\tscript:steal()"); // → <a>Go</a>
    link("data:text/html,<p>Hi</p>"); // → <a>Go</a>
    juris.renderToString({ img: { src: "data:image/png;base64,iVBORw0KGgo=" } });
    // → <img src="data:image/png;base64,iVBORw0KGgo=">
    juris.renderToString({
        p: {
            style: { color: "red; background: url(/steal)", "margin-top": "1em" },
            innerHTML: "<b>Sale</b>",
        },
    });
    // → <p></p>
    ```

  - A refused tag or attribute is left out whole (and named on the console in `devMode`); nothing
    is cleaned up into something else.

    ```js
    const dev = new Juris({ devMode: true, features: { ssr: SSRRenderer } });
    dev.renderToString({ a: { href: "javascript:steal()", textContent: "Track" } });
    // → <a>Track</a>
    // console.warn: Juris: dropped href refuses "javascript:steal()": scheme not
    //   allowed
    dev.renderToString({ p: { children: [{ script: "steal()" }, "Milk"] } });
    // → <p>Milk</p>
    // console.warn: Juris: dropped <script> is not allowed in a layout
    ```

  - An app widens this only by name (`allowTags`, `allowSchemes`, `allowInnerHTML`), for both
    sides at once, and a list naming anything that is not a tag or a scheme, or an
    `allowInnerHTML` that is not a boolean, is refused when the instance is built.

    ```js dom
    // One object, from a module the server and the browser entry both import.
    const shared = { allowTags: ["iframe"] };
    const server = new Juris({ ...shared, features: { ssr: SSRRenderer } });
    const browser = new Juris(shared);
    const map = { iframe: { src: "https://maps.example/shop" } };
    server.renderToString(map);
    // → <iframe src="https://maps.example/shop"></iframe>
    const page = document.createElement("main");
    browser.render(page, map);
    page.innerHTML; // → <iframe src="https://maps.example/shop"></iframe>
    ```

    ```js
    new Juris({ allowTags: ["<iframe>"] });
    // throws TypeError: Juris: allowTags: "<iframe>" is not a tag's name
    new Juris({ allowSchemes: ["javascript"] });
    // throws TypeError: Juris: allowSchemes: javascript: runs code in the page,
    //   and is never allowed
    new Juris({ allowInnerHTML: "yes" });
    // throws TypeError: Juris: allowInnerHTML is true or false, not "yes"
    ```

  - `renderDocument` escapes every value in a page's head and throws on what escaping cannot make
    safe.

    ```js
    import { renderDocument } from "juris-kit/server/document.js";
    // A product's name, as a seller typed it, made the page's title.
    const title = "Milk</title><script>steal()</script>";
    const page = renderDocument({}, { entry: "/app/boot.js", title });
    page.split("\n")[5];
    // → <title>Milk&lt;/title&gt;&lt;script&gt;steal()&lt;/script&gt;</title>
    renderDocument({}, {
        entry: "/app/boot.js",
        links: [{ rel: "icon", href: "javascript:steal()" }],
    });
    // throws Error: renderDocument: links: href refuses "javascript:steal()"
    ```

- By default, only a `ServiceError`'s words reach a caller.
  - The default `exposeError` is `error.expose === true`, which `fail` sets; any other error reads
    "request failed" and goes to the log.

    ```js
    const api = serviceDispatcher(services, "/api", {
        onError: (error, name) => logged.push(`${name}: ${error.message}`),
    });
    await api.invoke("renameList", [{ name: "" }]);
    // → {
    //     ok: false,
    //     status: 400,
    //     error: "Give the list a name.",
    //     fields: { name: "Give the list a name." },
    //     field: "name",
    //   }
    await api.invoke("checkout", []);
    // → { ok: false, status: 400, error: "request failed" }
    logged;
    // → ['checkout: duplicate key value violates unique constraint "orders_pkey"']
    ```

    ```js
    import { ServiceError, publicMessage } from "juris/errors.js";
    publicMessage(new ServiceError("Give the list a name."));
    // → "Give the list a name."
    publicMessage(new Error("connect ECONNREFUSED 10.0.0.5:5432"));
    // → "request failed"
    publicMessage(new Error("Shown anyway."), () => true); // → "Shown anyway."
    ```

  - That holds for a service's answer, a live query's re-run, a failed preload written into a page
    and the async error logs;

    ```js
    const shop = new Juris({ services, features: { ssr: SSRRenderer } });
    const page = await shop.renderRequest({
        preload: [["checkout"]],
        layout: { p: "Checkout" },
    });
    JSON.parse(page.json);
    // → { $ssr: { calls: { "checkout:[]": { $error: "request failed" } } } }
    ```

  - `/healthz` and the 500 answer fixed words and never an error's.

    ```js
    const site = await serve(async (req, res, url) => {
        if (url.pathname === "/receipt") {
            throw new Error("ENOENT /srv/shop/receipts/7.pdf");
        }
        return false;
    }, {
        health: {
            check: async () => {
                throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
            },
        },
    });
    const health = await fetch(`${site.base}/healthz`);
    [health.status, await health.json()];
    // → [503, { ok: false, error: "unavailable" }]
    const receipt = await fetch(`${site.base}/receipt`);
    [receipt.status, await receipt.text()];
    // → [500, "Something went wrong on our side. Try again in a moment."]
    logged;
    // → [
    //     "healthz: connect ECONNREFUSED 10.0.0.5:5432",
    //     "request: ENOENT /srv/shop/receipts/7.pdf",
    //   ]
    site.close();
    ```

- JSON-only calls.
  - A service call must be sent as `application/json` (415 otherwise), which a form on another site
    cannot send without a preflight: that is the defence against cross-site requests.

    ```js
    const site = await serve(serviceDispatcher(services, "/api"));
    const response = await fetch(`${site.base}/api/renameList`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify([{ name: "Groceries" }]),
    });
    response.status; // → 415
    await response.json();
    // → { error: "bad request: content-type must be application/json" }
    site.close();
    ```

  - The no-JavaScript form path (`forms`) takes only the names the app allows, only when the
    Origin (or the Referer) is the host asked, only up to 16 KiB, through the same pipeline as a
    JSON call, and redirects only to a path on the same site.

    ```js
    const api = serviceDispatcher(services, "/api", {
        forms: {
            allow: ["renameList"],
            redirect: (name, { ok, message }) => {
                return ok ? "/lists" : `/lists?error=${message}`;
            },
        },
    });
    const site = await serve(api);
    const type = "application/x-www-form-urlencoded";
    const form = (name, body, origin = site.base) => {
        return fetch(`${site.base}/api/${name}`, {
            method: "POST",
            redirect: "manual",
            headers: { "content-type": type, origin },
            body,
        });
    };
    (await form("renameList", "name=Groceries")).headers.get("location");
    // → "/lists"
    (await form("renameList", "name=")).headers.get("location");
    // → "/lists?error=Give the list a name."
    const elsewhere = "https://elsewhere.example";
    (await form("renameList", "name=Groceries", elsewhere)).status;
    // → 403
    (await form("checkout", "card=4242")).status; // → 415
    (await form("renameList", `name=${"x".repeat(17_000)}`)).status; // → 413
    site.close();
    ```

    ```js
    const api = serviceDispatcher(services, "/api", {
        forms: {
            allow: ["renameList"],
            redirect: () => "https://elsewhere.example/",
        },
    });
    const site = await serve(api);
    const response = await fetch(`${site.base}/api/renameList`, {
        method: "POST",
        redirect: "manual",
        headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: site.base,
        },
        body: "name=Groceries",
    });
    response.status; // → 500
    logged[0].endsWith("it must be a path on this site"); // → true
    site.close();
    ```

- Call kinds, above: a handle in a request's arguments names nobody.

  ```js
  import { callKind } from "juris/live-protocol.js";
  const api = serviceDispatcher({
      async ordersOf(who) {
          return { kind: callKind(this), who };
      },
  }, "/api");
  const site = await serve(api);
  const response = await fetch(`${site.base}/api/ordersOf`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ userId: 7, kind: "preload" }]),
  });
  await response.json();
  // → { kind: "direct", who: { userId: 7, kind: "preload" } }
  site.close();
  ```

- A page rendered for a reader is never cached, and goes out `private, no-cache`.

  ```js
  import { createRouter } from "juris/router.js";
  import { createPagePipeline } from "juris-kit/server/kernel.js";
  import { createPageCache } from "juris-kit/server/page-cache.js";
  const router = createRouter({
      routes: [{ path: "/cart", name: "cart", component: "Cart" }],
  });
  juris.use(router);
  juris.registerComponent("App", () => ({
      main: { children: [{ RouterView: {} }] },
  }));
  juris.registerComponent("Cart", () => ({ h1: "Your cart" }));
  const cache = createPageCache();
  const pages = createPagePipeline({
      juris,
      router,
      cache,
      entry: "/app/boot.js",
      viewer: (req) => req.headers["x-user"] ?? null,
  });
  const site = await serve((req, res, url) => pages.handle(req, res, url));
  const ada = await fetch(`${site.base}/cart`, { headers: { "x-user": "ada" } });
  ada.headers.get("cache-control"); // → "private, no-cache"
  cache.has("/cart"); // → false
  site.close();
  ```

- Nothing a request carries ends the process: a target no URL can be made of is a 400, a
  malformed cookie is skipped, a malformed service name is a 400, and an app's context that throws
  is a refusal, never a crash.

  ```js
  const site = await serve(async () => false);
  // `//[x` reaches Node's parser, which takes it; `new URL` would throw on it.
  const answer = await new Promise((resolve) => {
      request({ port: site.port, path: "//[x" }, (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve([res.statusCode, body]));
      }).end();
  });
  answer; // → [400, "Bad request."]
  site.close();
  ```

  ```js
  import { parseCookies } from "juris-kit/server/http.js";
  parseCookies("theme=dark; cart=%E0%A4; =stray; lang=fr");
  // → { theme: "dark", lang: "fr" }
  ```

  ```js
  const api = serviceDispatcher(services, "/api", {
      context: (req) => {
          if (req.headers.cookie) throw new Error("session store unreachable");
          return {};
      },
  });
  const site = await serve(api);
  const post = (path, headers = {}) => fetch(`${site.base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify([{ name: "Groceries" }]),
  });
  await (await post("/api/%E0%A4")).json(); // → { error: "bad service name" }
  const signedIn = await post("/api/renameList", { cookie: "session=s1" });
  [signedIn.status, await signedIn.json()];
  // → [400, { error: "request failed" }]
  site.close();
  ```

- A misspelt option is refused, not ignored (`createJurisServer`, `createPagePipeline`, `hydrate`,
  `createRouter`, `serviceDispatcher`, `sseClient`, `createLifecycle`), and so is a misspelt key
  inside an option that takes its own (the dispatcher's `live`, `strict` and `forms`, `health` and a
  job, `trustProxy`, `modules`, `page`, `juris`, hydrate's `title`, `skewGuard` and `serviceWorker`,
  and the live client's `backoff`): a misspelt guard would otherwise leave every page open, and a
  misspelt `live.strictQueries` would leave its switch off without a word.

  ```js
  import { createRouter } from "juris/router.js";
  createRouter({ routes: [], gaurd: () => "/login" });
  // throws TypeError: Router: "gaurd" is not an option
  serviceDispatcher(services, "/api", { live: { strictQuerys: true } });
  // throws TypeError: serviceDispatcher: live.strictQuerys is not an option
  ```

  ```js
  import { createJurisServer } from "juris-kit/server/kernel.js";
  await createJurisServer({
      root: ".",
      build: "b1",
      services,
      routes: [],
      page: { veiwer: (req) => req.headers["x-user"] },
  });
  // throws TypeError: createJurisServer: page.veiwer is not an option
  createLifecycle({ build: "b1", health: { timeoutMS: 500 } });
  // throws TypeError: createLifecycle: health.timeoutMS is not an option
  ```

  - So is a number that is not one (a job's `every`, `health.timeoutMs`, `closeTimeoutMs`, the
    live layer's waits and ceilings, `remoteServices`' `timeoutMs`, `startProcess`'s `backoff`): a
    wait longer than a Node timer keeps fired at once, and a string ceiling compared as none.

    ```js
    const monthly = 31 * 24 * 60 * 60 * 1000; // past the 24.8 days a timer keeps
    createLifecycle({
        build: "b1",
        jobs: [{ name: "invoices", every: monthly, run: () => {} }],
    });
    // throws TypeError: createLifecycle: job "invoices" needs an interval, every, a
    //   whole number of milliseconds, 1 to 2147483647 (about 24.8 days)
    ```

    ```js
    import { remoteServices } from "juris/remote-services.js";
    serviceDispatcher(services, "/api", {
        live: { public: true, queries: ["renameList"], maxGroups: "5" },
    });
    // throws TypeError: serviceDispatcher: live.maxGroups is a whole number from 1,
    //   or Infinity, not "5"
    remoteServices(["renameList"], { timeoutMs: "5000" });
    // throws TypeError: remoteServices: timeoutMs is a whole number of milliseconds
    ```

**Where.** `src/html-safety.js`, `src/server/document.js`, `src/errors.js`,
`src/server/service-dispatcher.js`, `src/live-protocol.js`, `src/server/http.js`,
`src/server/kernel.js`. Tests: `juris-tests/tests/juris/html-safety.test.mjs`,
`juris-tests/tests/juris/elements.test.mjs`, `juris-tests/tests/juris/attributes.test.mjs`,
`juris-tests/tests/juris-kit/service-dispatcher.test.mjs`,
`juris-tests/tests/juris-kit/kernel.config.test.mjs`,
`juris-tests/tests/juris-kit/kernel.pipeline.test.mjs`, `juris-tests/tests/juris/client.test.mjs`,
`juris-tests/tests/juris/router.test.mjs`, `juris-tests/tests/juris/remote-services.sse.test.mjs`,
`juris-tests/tests/juris-kit/document.test.mjs`, `juris-tests/tests/juris/errors.test.mjs`,
`juris-tests/tests/juris-kit/service-dispatcher.calls.test.mjs`,
`juris-tests/tests/juris-kit/service-dispatcher.live.test.mjs`,
`juris-tests/tests/juris/juris.calls.test.mjs`,
`juris-tests/tests/juris-kit/service-dispatcher.forms.test.mjs` (each refusal, before and after the
service), `juris-tests/tests/juris/live-protocol.test.mjs`,
`juris-tests/tests/juris-kit/http.test.mjs`,
`juris-tests/tests/juris-kit/kernel.lifecycle.test.mjs`, `juris-kit/tests/server.test.mjs`,
`juris/tests/render.test.mjs`, `juris-kit/tests/live.test.mjs`.

**What it costs.** A refusal leaves out what a sanitiser would have drawn a cleaned copy of, so
a layout built from data that carries a refused tag draws nothing for it, and a link with a refused
scheme has no `href`.

```js
// A product description, as blocks a seller wrote.
const blocks = [
    { type: "h2", text: "Fresh milk" },
    { type: "script", text: "steal()" },
    { type: "p", text: "From the farm." },
];
juris.renderToString({
    article: { children: blocks.map(({ type, text }) => ({ [type]: text })) },
});
// → <article><h2>Fresh milk</h2><p>From the farm.</p></article>
juris.renderToString({ a: { href: "javascript:steal()", textContent: "Bob" } });
// → <a>Bob</a>
```

`innerHTML` is left out unless the instance says `allowInnerHTML: true`; with it, it is written as
given, so it is for the app's own markup, never data (a row spread into props, a row that lands in a
child position, or a component that forwards `...rest`, such as `Link` and `Await`, carries it
through).

```js
import { createRouter } from "juris/router.js";
const trusted = new Juris({
    allowInnerHTML: true,
    features: { ssr: SSRRenderer },
});
trusted.use(createRouter({ routes: [] }));
// A member's row, as the database gave it.
const member = { name: "Bob", innerHTML: "<img src=x onerror=steal()>" };
trusted.renderToString({ li: { ...member } });
// → <li name="Bob"><img src=x onerror=steal()></li>
trusted.renderToString({ Link: { to: "/members/bob", ...member } });
// → <a href="/members/bob" name="Bob"><img src=x onerror=steal()></a>
juris.renderToString({ li: { ...member } }); // → <li name="Bob"></li>
```

A `style` object's value that would end its declaration is left out.

```js
juris.renderToString({
    p: {
        style: { color: "red; background: url(/steal)", fontWeight: "bold" },
        textContent: "Sale",
    },
});
// → <p style="font-weight:bold">Sale</p>
```

A service's `fields` travel as the service wrote them.

```js
const api = serviceDispatcher({
    async renameList() {
        const fields = { name: "<b>60</b> characters at most" };
        fail("Check the name.", { fields });
    },
}, "/api");
(await api.invoke("renameList", [])).fields;
// → { name: "<b>60</b> characters at most" }
```

A page's Content-Security-Policy is the app's to give (`page.headers`, with the hashes of the page's
inline scripts).

```js
import {
    renderDocument,
    inlineScriptHashes,
} from "juris-kit/server/document.js";
const page = renderDocument(
    { html: "<h1>Your cart</h1>" },
    { entry: "/app/boot.js" },
);
const hashes = inlineScriptHashes(page);
hashes.length; // → 1
hashes[0].startsWith("'sha256-"); // → true
```

```js
import { createRouter } from "juris/router.js";
import { createPagePipeline } from "juris-kit/server/kernel.js";
const router = createRouter({
    routes: [{ path: "/cart", name: "cart", component: "Cart" }],
});
juris.use(router);
juris.registerComponent("App", () => ({ h1: "Your cart" }));
const pages = createPagePipeline({
    juris,
    router,
    entry: "/app/boot.js",
    headers: ({ scriptHashes }) => {
        const scripts = scriptHashes.join(" ");
        return { "content-security-policy": `script-src 'self' ${scripts}` };
    },
});
const page = await pages.render("/cart");
const policy = page.headers["content-security-policy"];
policy.startsWith("script-src 'self' 'sha256-"); // → true
```

### One worker per instance, behind a sticky balancer

The examples on this page run several processes' dispatchers in one, each served on its own port
with its own memory, as two workers or two instances have; a tab opens its event stream on one and
posts its subscribes to whichever it is sent to.

```js setup
import { createServer } from "node:http";
import {
    serviceDispatcher,
} from "juris-kit/server/service-dispatcher.js";
import { startProcess } from "juris-kit/server/process.js";
import { liveKey } from "juris/live-protocol.js";

const stock = { milk: 12 };
const services = {
    stockOf: async (sku) => ({ sku, count: stock[sku] }),
    restock: async (sku, count) => (stock[sku] += count),
};

// One process: a dispatcher with live queries, served on port 0.
async function processWith(live = {}) {
    const api = serviceDispatcher(services, "/api", {
        live: { public: true, queries: ["stockOf"], ...live },
    });
    const server = createServer((req, res) => {
        api(req, res, new URL(req.url, "http://shop.test"));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const close = () => {
        api.close();
        server.closeAllConnections();
        server.close();
    };
    return { api, base, close };
}

// A tab's stream on `one`: its client id, and its next patch.
async function openTab(one) {
    const response = await fetch(`${one.base}/events`);
    const decoded = response.body.pipeThrough(new TextDecoderStream());
    const reader = decoded.getReader();
    let text = "";
    const next = async (type) => {
        const event = new RegExp(`event: ${type}\ndata: (.*)\n\n`);
        let found;
        while (!(found = event.exec(text))) {
            text += (await reader.read()).value;
        }
        text = text.slice(found.index + found[0].length);
        return JSON.parse(found[1]);
    };
    const { client } = await next("hello");
    return { client, next };
}

// A subscribe from `tab`, posted to `one`.
async function subscribe(one, tab, sku = "milk") {
    const response = await fetch(`${one.base}/_live`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            client: tab.client,
            subscribe: {
                key: liveKey("stockOf", [sku]),
                name: "stockOf",
                args: [sku],
            },
        }),
    });
    return { status: response.status, body: await response.json() };
}
```

**The problem.** A live query uses two connections: the event stream a browser keeps open, and the
subscribe calls it posts. Node's cluster hands connections to its workers independently, so a
subscribe lands on a worker that never minted that client's id, and every live query answers 403.
The streams a server knows are in one process's memory.

```js
const worker1 = await processWith();
const worker2 = await processWith();
const tab = await openTab(worker1); // the stream lands on worker 1
await subscribe(worker2, tab); // the subscribe, on worker 2
// → {
//     status: 403,
//     body: {
//       error: "unknown or foreign client id",
//       code: "live.client-unknown",
//     },
//   }
worker1.close();
worker2.close();
```

**What Juris does.** `startProcess` refuses more than one worker beside live queries, before it
forks anything (exit 1, with a message that says why and what to do instead), unless the app says
`allow`; `createJurisServer` refuses to serve inside a cluster worker beside live queries unless it
is given `allowWorkers`.

```js
// Node's cluster, as a test replaces it: it records each fork.
const forked = [];
const cluster = { isPrimary: true, fork: (env) => forked.push(env), on() {} };
const exits = [];
startProcess({ workers: 4, cluster, exit: (code) => exits.push(code) });
// console.error: 4 workers on one port would break live queries
// throws Error: 4 workers on one port would break live queries
[exits, forked]; // → [[1], []]
startProcess({ workers: 4, allow: true, cluster }); // → "primary"
forked.length; // → 4
```

```js
import { createJurisServer } from "juris-kit/server/kernel.js";
await createJurisServer({
    root: ".",
    build: "b1",
    services,
    routes: [],
    api: { live: { public: true, queries: ["stockOf"] } },
    modules: { entry: "/app/boot.js" },
    cluster: { isWorker: true },
});
// throws Error: createJurisServer: this is a cluster worker, and live queries
//   do not survive workers on one port
```

To use more cores, run more instances, each a process on its own port, behind a balancer that keeps
a browser on one instance (a cookie it sets), with a change bus between them so that a change made
on one reaches the pages and live queries of all.

```text
backend shop
    # haproxy.cfg: an instance per core; the cookie keeps a browser on one
    balance roundrobin
    option httpchk GET /healthz
    cookie SERVERID insert indirect nocache
    server a 127.0.0.1:3001 check cookie a
    server b 127.0.0.1:3002 check cookie b
    server c 127.0.0.1:3003 check cookie c
    server d 127.0.0.1:3004 check cookie d
```

```js
const cluster = { isPrimary: true, fork() {}, on() {} };
startProcess({ workers: 1, cluster }); // → "serve"
```

```js
// A change bus, in memory: every instance on it hears what any publishes.
const listeners = [];
const bus = {
    publish: async (targets) => listeners.forEach((hear) => hear(targets)),
    subscribe: (hear) => listeners.push(hear),
};
const touches = { restock: ["stockOf"] };
const a = await processWith({ bus, touches });
const b = await processWith({ bus, touches });
const tab = await openTab(b);
await subscribe(b, tab);
await tab.next("patch");
// → { key: 'stockOf:["milk"]', full: { sku: "milk", count: 12 } }
await a.api.invoke("restock", ["milk", 6]); // a change made on instance a
await tab.next("patch");
// → { key: 'stockOf:["milk"]', set: [["count", 18]], del: [] }
a.close();
b.close();
```

**Where.** `src/server/process.js`, `src/server/kernel.js`, `src/server/bus/pg-outbox.js`. Tests:
`juris-tests/tests/juris-kit/process.test.mjs`, `juris-tests/tests/juris-kit/kernel.config.test.mjs`
("in a cluster worker, a server beside live queries is refused unless allowWorkers says otherwise"),
`juris-tests/tests/juris-kit/pg-outbox.test.mjs`,
`juris-tests/tests/juris-kit/pg-outbox.read.test.mjs`,
`juris-tests/tests/juris-kit/pg-outbox.listen.test.mjs`, `juris-kit/tests/live.test.mjs` (a replaced
worker's backoff, the Postgres bus's reconnect).

**What it costs.** An instance uses one core, so more cores mean more instances and a balancer in
front.

```js
const forked = [];
const cluster = { isPrimary: true, fork: (env) => forked.push(env), on() {} };
startProcess({ workers: 1, cluster }); // → "serve"
forked; // → []
```

When a browser's instance restarts, its stream breaks and the live client opens a new one on
another instance.

```js
const a = await processWith();
const b = await processWith();
const tab = await openTab(a);
a.close(); // instance a restarts: the balancer sends the tab to b
(await subscribe(b, tab)).body.code; // → "live.client-unknown"
const again = await openTab(b); // so the live client opens a new stream there
(await subscribe(b, again)).status; // → 200
b.close();
```

Taking live access away reaches only the instance that acted, until its peers' next re-check ("Not
yet").

```js
const members = new Set(["ada"]);
const live = {
    public: false,
    recheckMs: 1,
    touches: { restock: ["stockOf"] },
    authorize: () => members.has("ada"),
};
const a = await processWith(live);
const b = await processWith(live);
const tab = await openTab(b);
await subscribe(b, tab);
await tab.next("patch");
members.delete("ada");
await a.api.invalidateAccess(() => true); // → 0
b.api.stats().subscriptions; // → 1
await new Promise((resolve) => setTimeout(resolve, 5)); // past recheckMs
await b.api.invoke("restock", ["milk", 1]);
await tab.next("patch"); // → { key: 'stockOf:["milk"]', error: "not allowed" }
b.api.stats().subscriptions; // → 0
a.close();
b.close();
```

## The boundary

The examples in this section read the framework's two halves as they are installed: the flat
`juris` package, the browser half a module server mounts at `/src/`, and the kit's `server/`, the
Node half. `codeOf` reads a file's code with its comments and string text left out, as the boundary
test does.

```js setup
import { readdir, readFile } from "node:fs/promises";
import { jsTokens } from "juris-kit/server/minify.js";

const core = import.meta.resolve("juris/juris.js");
const browserHalf = new URL("./", core);
const kernel = import.meta.resolve("juris-kit/server/kernel.js");
const nodeHalf = new URL("./", kernel);
const filesOf = async (dir) => {
    return (await readdir(dir)).filter((name) => name.endsWith(".js"));
};
// A file's code as tokens, without its comments and string text.
const codeOf = async (dir, name) => {
    const tokens = jsTokens(await readFile(new URL(name, dir), "utf8"));
    return tokens.filter(({ type }) => type !== "comment" && type !== "string");
};
```

`src/` is everything a second app would otherwise have to write, and nothing that names any one
app.

```js
await filesOf(browserHalf);
// → [
//     "client.js", "clock.js", "component-manager.js", "devtools.js",
//     "dom-renderer.js", "errors.js", "fluentstate.js", "forms.js",
//     "headless.js", "html-safety.js", "juris.js", "live-data.js",
//     "live-protocol.js", "remote-services.js", "router.js",
//     "state-manager.js", "storage.js", "webcomponent.js",
//   ]
```

1. **Framework terms first.** A change is written down here first, as what any app needs rather than
   what one page needs. It starts with a failing framework test: for code that runs in a browser,
   `juris/tests/render.test.mjs`, `juris/tests/core.test.mjs` or its file's suite in
   `juris-tests/tests/juris/` (each through a stand-in DOM; no suite runs in a real browser), a node
   suite for code that runs in Node.

   ```js dom
   import Juris from "juris/juris.js";
   // A render test, in framework terms: a state path, an element, a binding.
   const juris = new Juris();
   const page = document.createElement("main");
   juris.render(page, { p: { textContent: () => juris.getState("a.b", "") } });
   juris.setValue("a.b", "x");
   page.innerHTML; // → <p>x</p>
   ```

   ```js
   import assert from "node:assert/strict";
   import { canonicalPath } from "juris-kit/server/page-cache.js";
   // A node test, in framework terms: any path, not one app's page.
   assert.equal(canonicalPath("//a/./b/").canonical, "/a/b");
   canonicalPath("//a/./b/").redirect; // → "/a/b"
   ```

2. **No app vocabulary.** No route, service, table, cookie, storage key, environment variable,
   copy, incident story or citation of an app's specification. An app passes those in.

   ```js
   import { serializeCookie } from "juris-kit/server/http.js";
   serializeCookie("shop_session", "s1");
   // → "shop_session=s1; Path=/; HttpOnly; SameSite=Lax; Secure"
   ```

   ```js
   import { hydrate } from "juris/client.js";
   await hydrate({ routes: [], skewGuard: { reload: () => {} } });
   // throws TypeError: hydrate: skewGuard.storageKey names the sessionStorage
   //   key the guard keeps its mark in
   ```

3. **Two halves.** Top-level `src/*.js` is served to browsers exactly as it is on disk, so it
   imports nothing from `node:`, nothing from npm and nothing from `src/server/`. Node-only framework
   code lives in `src/server/`, is never served, and reads no environment variable. Only an app's
   entry reads the environment.

   ```js
   const specifiers = new Set();
   for (const name of await filesOf(browserHalf)) {
       const source = await readFile(new URL(name, browserHalf), "utf8");
       for (const [, specifier] of source.matchAll(/ from "([^"]+)"/g)) {
           specifiers.add(specifier);
       }
   }
   [...specifiers].every((specifier) => /^\.\/[\w-]+\.js$/.test(specifier));
   // → true
   ```

   ```js
   const readers = [];
   for (const name of await filesOf(nodeHalf)) {
       const tokens = await codeOf(nodeHalf, name);
       const code = tokens.map(({ text }) => text).join("");
       if (code.includes("process.env")) readers.push(name);
   }
   readers; // → []
   ```

   ```js
   import { createModuleServer } from "juris-kit/server/modules.js";
   process.env.BUILD = "b7"; // the entry's to read, and to pass
   await createModuleServer({ root: "." });
   // throws TypeError: createModuleServer: `build` names this deploy
   const build = process.env.BUILD;
   const modules = await createModuleServer({ root: ".", build });
   typeof modules.codeId; // → "string"
   ```

4. **Safe defaults.** Error messages are denied unless written for the person reading them, unsafe
   tags and `innerHTML` are refused, a live query is refused without `authorize`, a personal page is
   never cached, every value written into a document is escaped, and cluster workers are refused
   beside live queries. An app that wants less says so in its own code ("Security defaults and
   invariants" says where each is held).

   ```js
   import { publicMessage } from "juris/errors.js";
   import { decide } from "juris-kit/server/page-cache.js";
   publicMessage(new Error('relation "orders" does not exist'));
   // → "request failed"
   decide({ static: true, flags: [], roots: [] }, { viewer: "ada" });
   // → { cache: false, reason: "personal" }
   ```

   ```js
   import { publicMessage } from "juris/errors.js";
   // The shop says, in its own code, that sold-out errors may be read.
   const exposeError = (error) => {
       return error.expose === true || error.code === "SOLD_OUT";
   };
   const soldOut = new Error("Milk is sold out.");
   soldOut.code = "SOLD_OUT";
   publicMessage(soldOut); // → "request failed"
   publicMessage(soldOut, exposeError); // → "Milk is sold out."
   ```

Behaviour that belongs to one app is built on the extension points (services, `juris.use(plugin)`,
`extendApi`, route records, and the dispatcher's and the kernel's options), never by special-casing
that app inside a framework file. A framework change lands together with its first user in an app.

```js
import Juris from "juris/juris.js";
// The shop's prices, as a plugin of its own: nothing in the framework names it.
const prices = (juris, { currency }) => ({
    money: (amount) => `${amount.toFixed(2)} ${currency}`,
});
const juris = new Juris();
juris.use(prices, { currency: "€" });
juris.api.money(3); // → "3.00 €"
juris.extendApi({ freeShippingFrom: () => 50 });
juris.api.freeShippingFrom(); // → 50
```

**Rule 3 is held by a test, with no exceptions.** `juris/tests/boundary.test.mjs` and
`juris-kit/tests/boundary.test.mjs` enforce it: a top-level `src/*.js` imports only its flat
siblings and uses no `Buffer`, `process` or `require(` in its code (comments and string text aside),
and nothing in `src/` or `server/` reads `process.env`. No test holds rule 2, so review reads for
it.

```js
const banned = ["Buffer", "process", "require"];
const used = [];
for (const name of await filesOf(browserHalf)) {
    for (const { type, text } of await codeOf(browserHalf, name)) {
        if (type === "word" && banned.includes(text)) {
            used.push(`${name}: ${text}`);
        }
    }
}
used; // → []
```

It also holds that nothing imports `devtools.js` statically (`client.js` alone imports it, in
devMode), that client.js's static graph is its eleven modules, and that no browser module evaluates
a string as code.

```js
const graph = [];
async function walk(name) {
    if (graph.includes(name)) return;
    graph.push(name);
    const source = await readFile(new URL(name, browserHalf), "utf8");
    for (const [, next] of source.matchAll(/ from "\.\/([\w-]+\.js)"/g)) {
        await walk(next);
    }
}
await walk("client.js");
graph.length; // → 11
graph.includes("devtools.js"); // → false
const client = await readFile(new URL("client.js", browserHalf), "utf8");
client.match(/import\("\.\/devtools\.js"\)/)[0]; // → 'import("./devtools.js")'
```

```js
const evaluates = [];
for (const name of await filesOf(browserHalf)) {
    const words = (await codeOf(browserHalf, name)).map(({ text }) => text);
    if (words.includes("eval") || words.includes("Function")) {
        evaluates.push(name);
    }
}
evaluates; // → []
```

And it refuses an import cycle anywhere in `src/`, which loads only while no module in it uses an
import during its own evaluation: what two modules both need goes in a leaf they each import, as
`FallbackSignal` did into `errors.js`; and it holds the browser floor (below).

```js
import { FallbackSignal } from "juris/juris.js";
import * as errors from "juris/errors.js";
FallbackSignal === errors.FallbackSignal; // → true
const leaf = await readFile(new URL("errors.js", browserHalf), "utf8");
leaf.includes(" from "); // → false
```

It has no allow-list. It started with eight breaches: seven comments that told one app's stories or
cited its documents, now written as the rules they guard, and a read of `NODE_ENV` for the
development-mode warning, now gone (the warning keys off `devMode`, which the app passes).

```js dom
import Juris from "juris/juris.js";
process.env.NODE_ENV = "development"; // read by nothing in the framework
new Juris().devMode; // → false
new Juris({ devMode: true }).devMode; // → true
// console.info: Juris: devMode is on, so this instance is exposed as
//   window.$juris[1]
```

A breach found now is fixed, not listed. No test reads for an app's vocabulary, or for the story a
comment tells, so review does. No test holds rule 1's half that a test could, that this file names
every module and export; `juris-kit/tests/reference-examples.test.mjs` runs its examples, and review
reads for the rest. The framework's tests are in each package's `tests/` and in
`juris-tests/tests/`, apart from any app's. `juris/tests/boundary.test.mjs` and
`juris-kit/tests/boundary.test.mjs` hold the boundary in place. A skipped test is reported and does
not count as a pass.

## The page contract

The examples in this section write a page with the kit's document writer, as the kernel does, and
boot it in the stand-in page, as a browser does, given the page's body.

```js setup
import { renderDocument } from "juris-kit/server/document.js";

// A cart page as the kernel writes it, and its <body>.
const page = renderDocument(
    { html: "<h1>Your cart</h1>", json: '{"cart":{"count":2}}' },
    { entry: "/app/boot.js", serviceNames: ["addToCart"] },
);
const body = page.slice(page.indexOf("<body>") + 6, page.indexOf("</body>"));
```

A page the kernel writes (`renderDocument`) and the browser entry that boots it (`hydrate`) agree on
four names, and a fifth in development. They do not change from one build to the next, because a page kept in a cache, or left
open in a tab, boots the entry of whichever build serves it next.

```js
[...page.matchAll(/ id="([\w-]+)"/g)].map(([, id]) => id);
// → ["app", "state", "services"]
const dev = renderDocument({}, { entry: "/app/boot.js", jurisDev: {} });
[...dev.matchAll(/ id="([\w-]+)"/g)].map(([, id]) => id);
// → ["app", "state", "juris-dev"]
page.includes('import("/app/boot.js").then((m) => m.start())'); // → true
```

| Name | What it is | Written by | Read by |
| --- | --- | --- | --- |
| `#app` | The element holding the server-rendered body. The browser draws `root` (`{ App: {} }`, so the app registers an `App` component) into it again, replacing the server's markup. | `renderDocument`, `rootId` | `hydrate`, `rootId` |
| `#state` | `<script type="application/json" id="state">`: the state the page was rendered with, as JSON with `<` escaped and the private roots left out (`serializeState`). | `renderDocument`, `stateId` | `hydrate`, `stateId` |
| `#services` | `<script type="application/json" id="services">`: the names of the services the browser may call, JSON with `<` escaped. Written after the state; absent when the app turns it off. | `renderDocument`'s `serviceNames`: the dispatcher's `names`, unless `page.serviceNames` gives a list or `false` | `hydrate`, when not given `services` |
| `#juris-dev` | `<script type="application/json" id="juris-dev">`, in development only: data for the browser's devtools (`{}` today). Where it is, `hydrate` turns the instance's devMode on, and with it the devtools feature, unless the entry says `hydrate({ devMode: false })`. | `renderDocument`'s `jurisDev`, which the kernel's pipeline gives every page when `dev` is true | `hydrate`, when not given `devMode`; `devtools.js` (`hello`'s `dev`) |
| `start()` | The browser entry's export. The document's loader imports the entry once the page has loaded and the browser is idle (`requestIdleCallback`, or a timer where there is none) and calls it. | The app's entry module | The loader `renderDocument` writes |

`#app`, and the root the browser draws into it again:

```js dom
import { hydrate } from "juris/client.js";
document.body.innerHTML = body;
document.getElementById("app").innerHTML; // → <h1>Your cart</h1>
await hydrate({
    routes: [],
    live: false,
    register: (juris) => {
        juris.registerComponent("App", (props, api) => {
            const count = () => api.getState("cart.count");
            return { h1: { textContent: () => `Your cart (${count()})` } };
        });
    },
});
document.getElementById("app").innerHTML; // → <h1>Your cart (2)</h1>
```

`#state`, with `<` escaped and the private roots left out:

```js
import Juris from "juris/juris.js";
const juris = new Juris({
    state: {
        cart: { note: "</script><b>gift</b>" },
        session: { token: "s3cret" },
    },
    privatePaths: ["session"],
});
const written = renderDocument(
    { html: "", json: juris.serializeState() },
    { entry: "/app/boot.js" },
);
written.split("\n")[9];
// → <script type="application/json" id="state">{"cart":{"note":"\u003c/script>
//   \u003cb>gift\u003c/b>"}}</script>
```

```js dom
import { hydrate } from "juris/client.js";
document.body.innerHTML = body.replace(
    '{"cart":{"count":2}}',
    '{"cart":{"note":"\\u003c/script>"}}',
);
const juris = await hydrate({ routes: [], live: false });
juris.getState("cart.note"); // → "</script>"
```

`#services`, the names of the services the browser may call, absent when the app turns it off:

```js dom
import { hydrate } from "juris/client.js";
page.split("\n")[10];
// → <script type="application/json" id="services">["addToCart"]</script>
document.body.innerHTML = body;
const juris = await hydrate({ routes: [], live: false });
Object.keys(juris.api.services); // → ["addToCart"]
const quiet = renderDocument({}, { entry: "/app/boot.js", serviceNames: null });
quiet.includes('id="services"'); // → false
```

`#juris-dev`, in development:

```js dom
import { hydrate } from "juris/client.js";
const dev = renderDocument({}, { entry: "/app/boot.js", jurisDev: {} });
const start = dev.indexOf("<body>") + 6;
document.body.innerHTML = dev.slice(start, dev.indexOf("</body>"));
(await hydrate({ routes: [], live: false })).devMode; // → true
// console.info: Juris: devMode is on
(await hydrate({ routes: [], live: false, devMode: false })).devMode; // → false
```

```js
renderDocument({}, { entry: "/app/boot.js", jurisDev: "on" });
// throws TypeError: renderDocument: jurisDev is the page's development data, a
//   plain object written as JSON in #juris-dev, or null for none
```

`start()`, which the loader calls once the page has loaded and the browser is idle:

```js
const loader = page.slice(page.indexOf('<script type="module">'));
loader.split("\n").slice(1, 2);
// → ['  const boot = () => import("/app/boot.js").then((m) => m.start());']
loader.includes('typeof requestIdleCallback === "function"'); // → true
```

**Only the server's JSON script is read** (JR-F15). `hydrate` reads the state, and the service
names, from a `<script type="application/json">` with that id and from nothing else. What a page's
content draws comes earlier in the document than the server's scripts, and a lookup by id alone
once took an element a user's content drew with `id="state"` for the page's state: the page booted
on a state of that user's choosing.

```js dom
import { hydrate } from "juris/client.js";
// A member's badge, drawn by the page's content, with an id of its choosing.
const badge = '<p id="state">{"cart":{"count":99},"admin":true}</p>';
document.body.innerHTML = body.replace("<h1>Your cart</h1>", badge);
document.getElementById("state").localName; // → "p"
const juris = await hydrate({ routes: [], live: false });
juris.getState("cart.count"); // → 2
juris.getState("admin"); // → undefined
```

The renderers never draw a `<script>` from a layout (a refused tag), so content drawn from layouts
cannot be one.

```js
import Juris from "juris/juris.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";
const juris = new Juris({ features: { ssr: SSRRenderer } });
const badge = {
    script: {
        type: "application/json",
        id: "state",
        textContent: '{"admin":true}',
    },
};
juris.renderToString({ p: { children: [badge, "Member since 2021"] } });
// → <p>Member since 2021</p>
```

Two things an app can do reopen it, and neither should ever carry data: `allowTags: ["script"]`,
and `innerHTML`, which both renderers write as markup once the instance says
`allowInnerHTML: true`.

```js
import Juris from "juris/juris.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";
const scripts = new Juris({
    allowTags: ["script"],
    features: { ssr: SSRRenderer },
});
scripts.renderToString({
    script: {
        type: "application/json",
        id: "state",
        textContent: '{"admin":true}',
    },
});
// → <script type="application/json" id="state">{"admin":true}</script>
const markup = new Juris({
    allowInnerHTML: true,
    features: { ssr: SSRRenderer },
});
const html = '<p id="state">{"admin":true}</p>';
markup.renderToString({ div: { innerHTML: html } });
// → <div><p id="state">{"admin":true}</p></div>
```

**Where.** `src/server/document.js`, `src/client.js`. Tests:
`juris-tests/tests/juris-kit/document.test.mjs` ("renderDocument: given only an entry, it writes the
doctype, a head of charset, viewport and title, and the body's parts", "renderDocument: the loader
boots the entry once the page has loaded and the browser is idle"),
`juris-kit/tests/document.test.mjs` (the loader asks whether `requestIdleCallback` is a function, so
an element of that id cannot stand in for it), and `juris-tests/tests/juris/client.test.mjs`
("hydrate reads the state and the service names only from the server's JSON scripts, never from
content with the same ids (JR-F15)").

## Reserved state roots

The examples in this section render a shop's cart on a server instance given the kit's string
renderer and the router, and read what the render left in the state.

```js setup
import Juris from "juris/juris.js";
import { createRouter } from "juris/router.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";

const juris = new Juris({
    services: {
        price: async (sku) => (sku === "milk" ? 3 : 5),
        stock: async () => {
            throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
        },
    },
    features: { ssr: SSRRenderer },
});
const router = createRouter({
    routes: [{ path: "/lists/:id", name: "list", component: "List" }],
});
juris.use(router);
juris.registerComponent("List", (props, api) => ({
    h1: `List ${api.getState("$route.params.id")}`,
}));
```

The framework keeps its own state in the same tree as the app's, under the roots below. An app reads
them (through the api where there is one), and writes none of them by hand.

```js
const page = await juris.renderRequest({
    preload: [["price", "milk"]],
    state: { ...router.resolve("/lists/7").state, cart: { open: true } },
    layout: { RouterView: {} },
});
Object.keys(JSON.parse(page.json)); // → ["$route", "cart", "$ssr"]
juris.api.route().params; // → { id: "7" }
juris.api.preloaded("price", "milk"); // → 3
```

An app's own roots should not start with `$`: nothing enforces it, and it keeps a later framework
root from colliding with one of the app's.

```js
// Allowed, though a later framework root may want the name.
juris.setValue("$cart", { lines: 2 });
juris.getState("$cart.lines"); // → 2
```

A root is written into `#state` unless it is private; an app adds private roots of its own with
`privatePaths`.

```js
const shop = new Juris({
    privatePaths: ["session"],
    state: {
        cart: { lines: 2 },
        session: { token: "s3cret" },
        $server: { pool: "primary" },
    },
});
JSON.parse(shop.serializeState()); // → { cart: { lines: 2 } }
```

| Root | Kept by | What is under it | In `#state` | Named by |
| --- | --- | --- | --- | --- |
| `$route` | The router | `path`, `query` and `hash`, raw (writing `path` is navigating), and, derived from them, `name`, `params`, `matched` and `meta`; in a browser also `history`, `{ index, length }`, the tab's trail. | Yes: the browser adopts the route the server rendered | `createRouter({ routePath })` |
| `$ssr` | The core | `calls`: each preloaded call's answer under its key (`liveKey`), or `{ $error }` for one that failed, with the words `exposeError` allows. | Yes, and the browser drops it after its first mount (`releasePreloaded`) | `new Juris({ ssrPath })` |
| `$local` | The core (`useState`) | `$local.<Component>.<n>.<key>`, component-local state, numbered in render order among the instances that call `useState`; `$local.$client.…` under a component with `ssr: false`. | Yes, so a component adopts its own value when the page boots: nothing secret goes in it | `new Juris({ localPath })` |
| `$async` | The state manager | `pending`, `slow`, `started`, `settled`, `errors`, and `groups.<name>` with its own `pending` and `errors`; and `live.<path>`, each live path's `status` and `message` where no live client keeps them (a server, or a browser without one: `api.liveState`). | Never (private), and a server's `clearState` empties it | `new Juris({ asyncPath })` |
| `$server` | Nothing in the framework | Reserved for what a server render needs and must never leave the server. | Never (private) | Not renamed |
| `$live` | The live client (`sseClient`) | `connected`; `generation`, one more on every hello from the server; `reconnects`, one more on every hello that brings back a stream that was lost; and `paths.<path>`, each live path's `status` (`"live"`, `"pending"`, `"failed"`, `"offline"`) and, while it is failed, its `message`, the path written as one segment (`pathSegment` in `state-manager.js`: `%`, `.` and `*` escaped), gone once nothing is subscribed there (`api.liveState`). | No: only a browser has a live client | `sseClient({ statePath })` |

`$route`, which the router keeps, and whose name `routePath` changes:

```js
router.resolve("/lists/7?sort=due#top").state.$route;
// → { path: "/lists/7", query: { sort: "due" }, hash: "top" }
juris.setValue("$route.path", "/lists/9"); // writing the path is navigating
juris.getState("$route.name"); // → "list"
juris.getState("$route.params"); // → { id: "9" }
```

```js
const own = new Juris();
own.use(createRouter({
    routes: [{ path: "/lists/:id", name: "list", component: "List" }],
    routePath: "page",
}));
own.setValue("page.path", "/lists/3");
own.getState("page.params.id"); // → "3"
```

`$ssr`, each preloaded call's answer, or its `$error`, and gone from the browser's state once the
page is mounted:

```js
const page = await juris.renderRequest({
    preload: [["price", "milk"], ["stock", "milk"]],
    layout: { p: "Milk" },
});
JSON.parse(page.json).$ssr;
// → {
//     calls: {
//       'price:["milk"]': 3,
//       'stock:["milk"]': { $error: "request failed" },
//     },
//   }
```

```js dom
const browser = new Juris({
    state: { $ssr: { calls: { 'price:["milk"]': 3 } } },
});
browser.registerComponent("Price", (props, api) => ({
    span: `${api.preloaded("price", "milk")} €`,
}));
const page = document.createElement("main");
browser.mount(page, { Price: {} });
page.innerHTML; // → <span>3 €</span>
browser.getState("$ssr"); // → undefined
```

`$local`, a component's own state, written into `#state` so the browser adopts it:

```js
juris.registerComponent("Faq", (props, api) => {
    const [open, setOpen] = api.useState("open", false);
    if (props.startOpen) setOpen(true);
    return {
        details: { open: () => open(), children: [{ summary: "Delivery" }] },
    };
});
const page = await juris.renderRequest({
    layout: { Faq: { startOpen: true } },
});
JSON.parse(page.json).$local; // → { Faq: { 0: { open: true } } }
```

`$async`, the state manager's, never in `#state`, and emptied by a server's `clearState`:

```js
const checkout = juris.api.group("checkout");
checkout.track(new Promise((resolve) => setTimeout(resolve, 10)));
juris.getState("$async.groups.checkout.pending"); // → 1
"$async" in JSON.parse(juris.serializeState()); // → false
juris.clearState();
juris.getState("$async"); // → undefined
```

`$server`, what a server render needs and never sends:

```js
juris.setValue("$server.viewer", { id: 7, role: "admin" });
juris.getState("$server.viewer.role"); // → "admin"
JSON.parse(juris.serializeState()); // → {}
```

`$live`, the live client's, in a browser alone:

```js dom
import { sseClient } from "juris/remote-services.js";
// The server, as the live client meets it: a stand-in EventSource and fetch.
class EventSource {
    static opened = null;
    listeners = {};
    constructor(url) {
        EventSource.opened = this;
    }
    addEventListener(type, listener) {
        (this.listeners[type] ??= []).push(listener);
    }
    close() {}
    emit(type, data) {
        for (const listener of this.listeners[type] ?? []) {
            listener({ data: JSON.stringify(data) });
        }
    }
}
globalThis.fetch = async () => Response.json({ ok: true });
const browser = new Juris({ services: { stockOf: async () => null } });
browser.use(sseClient({ EventSourceImpl: EventSource }));
browser.api.live("stock.milk", "stockOf", "milk");
EventSource.opened.emit("hello", { client: "c1" });
await new Promise((resolve) => setTimeout(resolve));
browser.getState("$live");
// → {
//     paths: { "stock%2Emilk": { status: "pending" } },
//     connected: true,
//     generation: 1,
//   }
const patch = { key: 'stockOf:["milk"]', full: { count: 12 } };
EventSource.opened.emit("patch", patch);
browser.getState("$live.paths.stock%2Emilk.status"); // → "live"
browser.api.liveState("stock.milk"); // → "live"
```

Two names that look like roots are not: `$error` is the key of a failed call inside `$ssr.calls`,
and `$pages` is the page cache's every-page invalidation target (`EVERYTHING`, `ALL`), never state.

```js
import { EVERYTHING } from "juris-kit/server/page-cache.js";
import { ALL } from "juris-kit/server/service-dispatcher.js";
const page = await juris.renderRequest({
    preload: [["stock", "milk"]],
    layout: { p: "Milk" },
});
Object.keys(JSON.parse(page.json)); // → ["$ssr"]
juris.api.preloaded("stock", "milk"); // → undefined
[EVERYTHING, ALL]; // → ["$pages", { name: "$pages" }]
```

## The public API

**What an app imports, and from where.** Browser code imports Juris by absolute URL: the module
server mounts the flat `juris` package at `/src/` and stamps every import.

```js
import { listModules } from "juris-kit/server/modules.js";
const served = await listModules({ root: "." });
served.map(({ url }) => url).slice(0, 3);
// → ["/src/client.js", "/src/clock.js", "/src/component-manager.js"]
served.every(({ url }) => /^\/src\/[\w-]+\.js$/.test(url)); // → true
```

```js
import { createServer } from "node:http";
import { createModuleServer } from "juris-kit/server/modules.js";
const modules = await createModuleServer({ root: ".", build: "b1" });
const server = createServer((req, res) => {
    modules.handle(req, res, new URL(req.url, "http://shop.test"));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const response = await fetch(`http://127.0.0.1:${port}/src/client.js`);
const client = await response.text();
server.close();
client.includes(`from "./juris.js?v=${modules.codeId}"`); // → true
```

Node code imports it by package path (`juris/errors.js`,
`juris-kit/server/kernel.js`).

```js
import { fail } from "juris/errors.js";
import { createJurisServer } from "juris-kit/server/kernel.js";
typeof createJurisServer; // → "function"
fail("Give the list a name.");
// throws ServiceError: Give the list a name.
```

A browser module uses no bare specifiers and there is no import map: a browser cannot resolve
`import "juris"` without one.

```js
import { rmSync } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createModuleServer } from "juris-kit/server/modules.js";
const root = await mkdtemp(join(tmpdir(), "shop-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
await mkdir(join(root, "app"));
await writeFile(join(root, "app/boot.js"), [
    'import { hydrate } from "/src/client.js";',
    'import Juris from "juris";',
].join("\n"));
const modules = await createModuleServer({
    root,
    build: "b1",
    minify: false,
    mounts: [{ url: "/app/", dir: "app" }],
});
const server = createServer((req, res) => {
    modules.handle(req, res, new URL(req.url, "http://shop.test"));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const boot = await (await fetch(`http://127.0.0.1:${port}/app/boot.js`)).text();
server.close();
boot.replaceAll(modules.codeId, "<code id>").split("\n");
// → [
//     'import { hydrate } from "/src/client.js?v=<code id>";',
//     'import Juris from "juris";',
//   ]
```

| Where | An app imports | For |
| --- | --- | --- |
| The browser entry | `/src/client.js` | `hydrate`, the whole client boot |
| The app's own shared modules, when they need it | `/src/forms.js`, `/src/clock.js`, `/src/live-data.js`, `/src/router.js`, `/src/errors.js`, `/src/storage.js` | Plugins, helpers, and what a page names |
| A page that builds its own instance, in devMode | `/src/devtools.js` | `Devtools`, given as `features.devtools`; `hydrate` imports and gives it itself, in devMode only ("`devtools.js`") |
| The server's entry and configuration | `juris-kit/server/process.js` (`startProcess`), `.../server/kernel.js` (`createJurisServer`) | Starting, and the whole server |
| Services | `juris/errors.js` | `fail` |
| Beside the kernel, when an app needs them | `juris-kit/server/page-cache.js`, `.../server/bus/pg-outbox.js`, `.../server/db.js`, `.../server/dev-reload.js`, `.../server/http.js`, `.../server/service-dispatcher.js` | A page cache, a change bus, a driver adapter, development reload, cookies, a dispatcher of the app's own |

The browser entry, a file of the app's own (`app/client/boot.js`), imports `hydrate` by URL:

```js excerpt
import { hydrate } from "/src/client.js";
import { routes, register, title } from "./app.js";

export const start = () => hydrate({ routes, register, title });
```

The app's own shared modules, for plugins and helpers (`/src/forms.js`, `/src/clock.js`, … in a
browser), by package path in Node:

```js
const forms = await import("juris/forms.js");
const clock = await import("juris/clock.js");
const liveData = await import("juris/live-data.js");
[Object.keys(forms), Object.keys(clock), Object.keys(liveData)];
// → [
//     ["createForm", "default", "forms"],
//     ["clock"],
//     ["claimPath", "useLiveData", "useRouteData"],
//   ]
```

A page that builds its own instance in devMode gives it `Devtools`:

```js dom
import Juris from "juris/juris.js";
import { Devtools } from "juris/devtools.js";
const juris = new Juris({ devMode: true, features: { devtools: Devtools } });
// console.info: Juris: devMode is on
juris.devtools instanceof Devtools; // → true
```

The server's entry, its services, and what sits beside the kernel:

```js
import { startProcess } from "juris-kit/server/process.js";
import { createJurisServer } from "juris-kit/server/kernel.js";
import { ServiceError, fail } from "juris/errors.js";
import { createPageCache } from "juris-kit/server/page-cache.js";
import { parseCookies } from "juris-kit/server/http.js";
[typeof startProcess, typeof createJurisServer]; // → ["function", "function"]
let refusal;
try {
    fail("Milk is sold out.", { status: 409 });
} catch (error) {
    refusal = error;
}
[refusal instanceof ServiceError, refusal.status]; // → [true, 409]
createPageCache().stats().entries; // → 0
parseCookies("cart=7"); // → { cart: "7" }
```

A component module reaches Juris through its `api` and imports nothing from `src/`, so only an app's
entry points (and the one module that wraps a framework helper for its pages, if it has one) name
where Juris lives. That keeps moving the framework cheap.

```js
import Juris from "juris/juris.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";
// app/components/cart.js: no import, so nothing here names where Juris lives.
function register(juris) {
    juris.registerComponent("CartCount", (props, api) => ({
        span: { textContent: () => `${api.getState("cart.count", 0)} items` },
    }));
}
// The server's instance (and the browser's, the same way) registers it.
const juris = new Juris({ features: { ssr: SSRRenderer } });
register(juris);
juris.setValue("cart.count", 2);
juris.renderToString({ CartCount: {} }); // → <span>2 items</span>
```

### Components and layouts

The examples on this page share one instance, given the kit's string renderer, so a layout is shown
as the HTML a server writes for it. An example that draws into a page (`document`) uses the DOM
renderer, as a browser does.

```js setup
import Juris from "juris/juris.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";

const juris = new Juris({ features: { ssr: SSRRenderer } });
```

A component is a function `(props, api) => layout`, registered by name on the instance:
`juris.registerComponent("Home", (props, api) => …)`.

```js
juris.registerComponent("Greeting", (props, api) => ({
    h1: { textContent: `Hello, ${props.name}` },
}));
juris.renderToString({ Greeting: { name: "Ada" } }); // → <h1>Hello, Ada</h1>
```

`registerComponent(name, definition, { ssr: false })` registers one the server never renders (it
writes a placeholder, and the browser draws the component).

```js
juris.registerComponent("SalesChart", () => ({ canvas: {} }), { ssr: false });
juris.renderToString({ section: { children: [{ SalesChart: {} }] } });
// → <section><!--juris:client SalesChart--></section>
```

```js dom
juris.registerComponent("SalesChart", () => ({ canvas: {} }), { ssr: false });
const page = document.createElement("main");
juris.render(page, { section: { children: [{ SalesChart: {} }] } });
page.innerHTML; // → <section><canvas></canvas></section>
```

A definition may also return a function, `() => layout`, which is drawn again whenever what it reads
changes.

```js dom
juris.registerComponent("CartBadge", (props, api) => () => {
    const count = api.getState("cart.count", 0);
    return count ? { strong: `${count} in cart` } : { em: "Cart empty" };
});
const page = document.createElement("main");
juris.render(page, { CartBadge: {} });
page.innerHTML; // → <em>Cart empty</em>
juris.setValue("cart.count", 2);
page.innerHTML; // → <strong>2 in cart</strong>
```

A name is registered once per instance: `registerComponent` refuses a second definition, and
`juris.install(key, registrar)` is how a module whose components several pages draw registers them
once.

```js
juris.registerComponent("Footer", () => ({ footer: "© Shop" }));
juris.registerComponent("Footer", () => ({ footer: "© Shop" }));
// throws Error: ComponentManager.registerComponent:
//   "Footer" is already registered
```

```js
function registerShop(juris) {
    juris.registerComponent("ProductCard", (props) => ({
        article: props.title,
    }));
}
juris.install("shop", registerShop); // → true
juris.install("shop", registerShop); // → false
juris.hasComponent("ProductCard"); // → true
```

A layout is a plain object with one key, the tag, whose value is its content:
`{ div: { className: "card", children: [ … ] } }`.

```js
juris.renderToString({
    div: { className: "card", children: [{ h2: "Milk" }, { p: "2 bottles" }] },
});
// → <div class="card"><h2>Milk</h2><p>2 bottles</p></div>
```

A string or a number as the content is its text (`{ p: "Nothing here." }`), and `null` an empty
element.

```js
juris.renderToString({ p: "Nothing here." }); // → <p>Nothing here.</p>
juris.renderToString({ span: 3 }); // → <span>3</span>
juris.renderToString({ p: null }); // → <p></p>
```

`true` and `false` as the content are nothing, as they are in `children`, so `{ p: isAdmin &&
"Admin" }` is an empty `<p>` when `isAdmin` is false; and so they are in `textContent` and in an
allowed `innerHTML`. A number is text, `0` included.

```js
const isAdmin = false;
juris.renderToString({ p: isAdmin && "Admin" }); // → <p></p>
juris.renderToString({ p: { textContent: true } }); // → <p></p>
juris.renderToString({ p: { children: [false, "Milk", true] } });
// → <p>Milk</p>
juris.renderToString({ span: 0 }); // → <span>0</span>
```

```js dom
juris.setValue("cart.count", 2);
const page = document.createElement("main");
juris.render(page, {
    p: { textContent: () => juris.getState("cart.count") > 0 && "In cart" },
});
page.innerHTML; // → <p>In cart</p>
juris.setValue("cart.count", 0);
page.innerHTML; // → <p></p>
```

In the content:

- A capitalised tag names a component, and its content is the component's props:
  `{ Home: { id: 7 } }`.

  ```js
  juris.registerComponent("OrderLink", (props) => ({
      a: { href: `/orders/${props.id}`, textContent: `Order ${props.id}` },
  }));
  juris.renderToString({ OrderLink: { id: 7 } });
  // → <a href="/orders/7">Order 7</a>
  ```

  - A name registered in lower case draws its component too, in place of the element of that name,
    everywhere on the instance: a registered name is a component's, whatever its case. So a
    component's name is capitalised, and never an element's.

    ```js
    juris.registerComponent("price", (props) => ({ b: `${props.amount} €` }));
    juris.renderToString({ price: { amount: 3 } }); // → <b>3 €</b>
    ```

    ```js
    juris.registerComponent("header", () => ({ h1: "Corner Shop" }));
    juris.renderToString({ header: { children: [{ nav: "Menu" }] } });
    // → <h1>Corner Shop</h1>
    ```

- `children` is a layout, a list of layouts, text, or a function (a seat: drawn again whenever what
  it reads changes).

  ```js
  juris.renderToString({ ul: { children: [{ li: "Milk" }, { li: "Eggs" }] } });
  // → <ul><li>Milk</li><li>Eggs</li></ul>
  juris.renderToString({ p: { children: "Fish & chips" } });
  // → <p>Fish &amp; chips</p>
  ```

  ```js dom
  juris.setValue("todos", ["Milk"]);
  const page = document.createElement("main");
  juris.render(page, {
      ul: {
          children: () => juris.getState("todos").map((todo) => ({ li: todo })),
      },
  });
  juris.setValue("todos", ["Milk", "Eggs"]);
  page.innerHTML; // → <ul><li>Milk</li><li>Eggs</li></ul>
  ```

  - A component returns one layout, never a list.

    ```js
    juris.registerComponent("Groceries", () => [{ li: "Milk" }, { li: "Eggs" }]);
    juris.renderToString({ ul: { children: [{ Groceries: {} }] } });
    // throws Error: Juris: a layout is one { tag: content } object;
    //   a component cannot return an array
    ```

  - A function in a list of children stands for one child, and returns one layout too; the
    function given as `children` itself may return a list.

    ```js
    juris.renderToString({ ul: { children: [() => [{ li: "Milk" }]] } });
    // throws Error: Juris: a layout is one { tag: content } object;
    //   a function in one child's place returned a list
    juris.renderToString({ ul: { children: () => [{ li: "Milk" }] } });
    // → <ul><li>Milk</li></ul>
    ```

    ```js dom
    const page = document.createElement("main");
    const items = () => [{ li: "Milk" }, { li: "Eggs" }];
    juris.render(page, { ul: { children: [items] } });
    // throws Error: Juris: a layout is one { tag: content } object;
    //   a function in one child's place returned a list
    juris.render(page, { ul: { children: items } });
    page.innerHTML; // → <ul><li>Milk</li><li>Eggs</li></ul>
    ```

  - A seat's function, or a definition's, may return a function in turn: it is bound in its place,
    drawing into the same node, and goes when the function above it gives something else, so the
    chain draws what the server draws for it (every function evaluated in turn).

    ```js dom
    juris.setValue("user", { name: "Ada", signedIn: true });
    const page = document.createElement("main");
    juris.render(page, {
        p: {
            children: () => juris.getState("user.signedIn")
                ? () => `Signed in as ${juris.getState("user.name")}`
                : "Signed out",
        },
    });
    page.innerHTML; // → <p>Signed in as Ada</p>
    juris.setValue("user.name", "Grace");
    page.innerHTML; // → <p>Signed in as Grace</p>
    juris.setValue("user.signedIn", false);
    page.innerHTML; // → <p>Signed out</p>
    ```

    ```js
    juris.setValue("user", { name: "Ada", signedIn: true });
    juris.renderToString({
        p: {
            children: () => juris.getState("user.signedIn")
                ? () => `Signed in as ${juris.getState("user.name")}`
                : "Signed out",
        },
    });
    // → <p>Signed in as Ada</p>
    ```

  - A function as `children` draws what it gives against what is there: a component it gives
    again with the same props (each `===` to the last, a ref by its path) is kept as it is, and
    not set up again.

    ```js dom
    let setups = 0;
    juris.registerComponent("Price", (props) => {
        setups += 1;
        return { b: `${props.amount} €` };
    });
    juris.setValue("cart.count", 1);
    const count = () => juris.getState("cart.count");
    const page = document.createElement("main");
    juris.render(page, {
        p: {
            children: () => count() > 0
                ? [`${count()} × `, { Price: { amount: 3 } }]
                : [],
        },
    });
    juris.setValue("cart.count", 2);
    page.innerHTML; // → <p>2 × <b>3 €</b></p>
    setups; // → 1
    ```

  - A function in one child's place, and a component's root function, draw what they give anew
    each time they run: a component in it is set up again (its cleanups run, then its
    definition), even with the same props.

    ```js dom
    let setups = 0;
    juris.registerComponent("Price", (props) => {
        setups += 1;
        return { b: `${props.amount} €` };
    });
    juris.setValue("cart.count", 1);
    const page = document.createElement("main");
    juris.render(page, {
        p: {
            children: [
                () => juris.getState("cart.count") > 0
                    ? { Price: { amount: 3 } }
                    : null,
            ],
        },
    });
    juris.setValue("cart.count", 2);
    page.innerHTML; // → <p><b>3 €</b></p>
    setups; // → 2
    ```

    ```js dom
    let setups = 0;
    juris.registerComponent("Price", (props) => {
        setups += 1;
        return { b: `${props.amount} €` };
    });
    juris.registerComponent("CartTotal", (props, api) => () => {
        api.getState("cart.count");
        return { Price: { amount: 3 } };
    });
    juris.setValue("cart.count", 1);
    juris.render(document.createElement("main"), { CartTotal: {} });
    juris.setValue("cart.count", 2);
    setups; // → 2
    ```

- `textContent` is text, always escaped.

  ```js
  juris.renderToString({ p: { textContent: "<b>5 items</b>" } });
  // → <p>&lt;b&gt;5 items&lt;/b&gt;</p>
  ```

  - It is all the element holds: `children` beside it is not drawn, in either order and whatever
    its value (`""`, `null` and `undefined` included), and `devMode` names what is left out.

    ```js
    juris.renderToString({
        p: { textContent: "Sold out", children: [{ b: "3 left" }] },
    });
    // → <p>Sold out</p>
    juris.renderToString({ p: { textContent: undefined, children: ["Milk"] } });
    // → <p></p>
    ```

    ```js
    const dev = new Juris({ devMode: true, features: { ssr: SSRRenderer } });
    dev.renderToString({ p: { textContent: "Sold out", children: ["Milk"] } });
    // console.warn: Juris: dropped children: <p> holds its textContent, and
    //   nothing beside it
    ```

    ```js dom
    const page = document.createElement("main");
    juris.render(page, { p: { children: ["Milk"], textContent: "Sold out" } });
    page.innerHTML; // → <p>Sold out</p>
    ```

  - `innerHTML` is markup: both renderers leave it out (named on the console in `devMode`) unless
    the instance is given `allowInnerHTML: true`, and then write it as given, so it is for the
    app's own markup and never for data.

    ```js
    juris.renderToString({ p: { innerHTML: "<b>5 items</b>" } }); // → <p></p>
    ```

    ```js
    const dev = new Juris({ devMode: true, features: { ssr: SSRRenderer } });
    dev.renderToString({ p: { innerHTML: "<b>5 items</b>" } }); // → <p></p>
    // console.warn: Juris: dropped innerHTML: markup is not written from a layout
    ```

    ```js
    const trusted = new Juris({
        allowInnerHTML: true,
        features: { ssr: SSRRenderer },
    });
    trusted.renderToString({ p: { innerHTML: "<b>5 items</b>" } });
    // → <p><b>5 items</b></p>
    ```

    - An allowed `innerHTML` is all the element holds too: `children` beside it is not drawn.
      Given both it and `textContent`, the later key is the one. A refused one is left out whole,
      so the children are drawn.

      ```js
      const trusted = new Juris({
          allowInnerHTML: true,
          features: { ssr: SSRRenderer },
      });
      trusted.renderToString({ p: { innerHTML: "<b>New</b>", children: ["Milk"] } });
      // → <p><b>New</b></p>
      trusted.renderToString({ p: { innerHTML: "<b>New</b>", textContent: "Old" } });
      // → <p>Old</p>
      juris.renderToString({ p: { innerHTML: "<b>New</b>", children: ["Milk"] } });
      // → <p>Milk</p>
      ```

      ```js dom
      const trusted = new Juris({ allowInnerHTML: true });
      const page = document.createElement("main");
      trusted.render(page, { p: { children: ["Milk"], innerHTML: "<b>New</b>" } });
      page.innerHTML; // → <p><b>New</b></p>
      ```

  - `enhance` keeps its own rule: inside an enhancement it throws unless the call says
    `{ allowHtml: true }`, which opens it there.

    ```js dom
    const page = document.createElement("main");
    page.innerHTML = '<p class="note">Old text</p>';
    const note = page.querySelector(".note");
    juris.enhance(note, { innerHTML: "<b>New</b>" });
    // throws Error: Juris.enhance: innerHTML is not allowed inside an enhanced
    juris.enhance(note, { innerHTML: "<b>New</b>" }, { allowHtml: true });
    page.innerHTML; // → <p class="note"><b>New</b></p>
    ```

- `key` gives an element its identity in a list, so a keyed list moves elements instead of
  redrawing them.

  ```js dom
  juris.setValue("todos", [
      { id: 1, title: "Milk" },
      { id: 2, title: "Eggs" },
  ]);
  const page = document.createElement("main");
  juris.render(page, {
      ul: {
          children: () => juris.getState("todos").map((todo) => ({
              li: { key: todo.id, textContent: todo.title },
          })),
      },
  });
  const milk = page.querySelector("li");
  juris.setValue("todos", [
      { id: 2, title: "Eggs" },
      { id: 1, title: "Milk" },
  ]);
  page.innerHTML; // → <ul><li>Eggs</li><li>Milk</li></ul>
  page.querySelector("ul").lastChild === milk; // → true
  ```

  ```js
  juris.renderToString({ li: { key: 7, textContent: "Milk" } });
  // → <li data-key="7">Milk</li>
  ```

  - An element keeps its tag: an item whose key stays and whose tag changes is drawn anew, as a
    fresh draw would draw it (a component takes the element over).

    ```js dom
    juris.setValue("todo", { id: 1, done: false });
    const page = document.createElement("main");
    juris.render(page, {
        ul: {
            children: () => {
                const todo = juris.getState("todo");
                const tag = todo.done ? "del" : "span";
                return [{ [tag]: { key: todo.id, textContent: "Milk" } }];
            },
        },
    });
    const before = page.querySelector("span");
    juris.setValue("todo.done", true);
    page.innerHTML; // → <ul><del>Milk</del></ul>
    before.parentNode; // → null
    ```

  - A keyed component whose root is not an element (it draws `null`, or text) keeps its place and
    its state in a keyed list, as an element does.

    ```js dom
    juris.registerComponent("Price", (props) => `${props.amount} € `);
    juris.setValue("prices", [
        { sku: "milk", amount: 3 },
        { sku: "eggs", amount: 5 },
    ]);
    const page = document.createElement("main");
    juris.render(page, {
        p: {
            children: () => juris.getState("prices").map((price) => ({
                Price: { key: price.sku, amount: price.amount },
            })),
        },
    });
    const milk = page.querySelector("p").firstChild;
    juris.setValue("prices", [
        { sku: "eggs", amount: 5 },
        { sku: "milk", amount: 3 },
    ]);
    page.innerHTML; // → <p>5 € 3 € </p>
    page.querySelector("p").lastChild === milk; // → true
    ```

- `class` or `className`, `classList` (`{ name: boolean }`), `style` (an object, or a string),
  `htmlFor`, and `value` are what they are in the DOM;

  ```js
  juris.renderToString({
      label: { className: "field", htmlFor: "email", textContent: "Email" },
  });
  // → <label class="field" for="email">Email</label>
  juris.renderToString({ input: { id: "email", value: "ada@example.com" } });
  // → <input id="email" value="ada@example.com">
  ```

  ```js
  juris.renderToString({
      button: {
          class: "btn",
          classList: { primary: true, busy: false },
          style: "min-width: 8rem",
          textContent: "Save",
      },
  });
  // → <button class="btn primary" style="min-width: 8rem">Save</button>
  ```

  - a boolean attribute (`disabled`, `hidden`, `checked`, `alpha`, `shadowrootclonable`, …) is
    present on an HTML element when its value is truthy and absent otherwise, and
    `hidden: "until-found"` (in any case) is a value of its own, written as given;

    ```js
    juris.renderToString({ button: { disabled: true, textContent: "Pay" } });
    // → <button disabled="">Pay</button>
    juris.renderToString({ button: { disabled: 0, textContent: "Pay" } });
    // → <button>Pay</button>
    juris.renderToString({ details: { hidden: "Until-Found", children: "FAQ" } });
    // → <details hidden="Until-Found">FAQ</details>
    ```

  - on an SVG or MathML element such a name is an attribute like any other, written as given
    (MathML's `open` is a value).

    ```js
    juris.renderToString({ svg: { children: [{ g: { hidden: true } }] } });
    // → <svg><g hidden="true"></g></svg>
    juris.renderToString({ math: { children: [{ mfenced: { open: "[" } }] } });
    // → <math><mfenced open="["></mfenced></math>
    ```

  - `indeterminate` on an `<input>` is its property alone, as HTML has no such attribute: the
    client sets it, and the server writes nothing for it. So a box in the server's page shows as
    its `checked` says until the client draws the page (`hydrate` draws it anew), and is
    indeterminate from then on. On any other element it is an attribute like any other.

    ```js
    juris.renderToString({ input: { type: "checkbox", indeterminate: true } });
    // → <input type="checkbox">
    ```

    ```js dom
    juris.setValue("basket", { some: true });
    const page = document.createElement("main");
    juris.render(page, {
        input: {
            type: "checkbox",
            indeterminate: () => juris.getState("basket.some"),
        },
    });
    const all = page.firstChild;
    all.indeterminate; // → true
    page.innerHTML; // → <input type="checkbox">
    juris.setValue("basket.some", false);
    all.indeterminate; // → false
    ```

  - An `<output>`'s `value` is its text, on the server as in the DOM.

    ```js
    juris.renderToString({ output: { value: 42 } }); // → <output>42</output>
    ```

    ```js dom
    const page = document.createElement("main");
    juris.render(page, { output: { value: 42 } });
    page.innerHTML; // → <output>42</output>
    ```

    - What an `<output>` or a `<textarea>` holds is one of these: its `textContent` (or an allowed
      `innerHTML`), whatever the order of the keys; else its `value`; else its `children`. What
      else the layout gives for it is left out, and named in `devMode`.

      ```js
      juris.renderToString({ output: { value: 42, textContent: "42 €" } });
      // → <output>42 €</output>
      juris.renderToString({ textarea: { value: "Ring twice", children: "Hi" } });
      // → <textarea>Ring twice</textarea>
      ```

      ```js dom
      const page = document.createElement("main");
      juris.render(page, { output: { textContent: "42 €", value: 42 } });
      page.innerHTML; // → <output>42 €</output>
      ```

  - A void element (`<br>`, `<img>`, `<input>`, …) holds nothing, whatever the layout puts inside
    it, and a `<template>`'s children are its content.

    ```js
    juris.renderToString({
        img: { src: "/milk.png", alt: "Milk", textContent: "Fresh milk" },
    });
    // → <img src="/milk.png" alt="Milk">
    ```

    ```js dom
    const page = document.createElement("main");
    juris.render(page, { template: { children: [{ li: "New row" }] } });
    page.innerHTML; // → <template><li>New row</li></template>
    page.firstChild.childNodes.length; // → 0
    page.firstChild.content.childNodes.length; // → 1
    ```

  - A `classList` key is one or more class names, split on whitespace (`{ "btn active": on }`); an
    empty key is nothing.

    ```js
    juris.renderToString({
        a: { classList: { "btn active": true, "": true }, textContent: "Home" },
    });
    // → <a class="btn active">Home</a>
    ```

  - `class` or `className` gives the base the `classList` sits on: the `classList` decides each
    class it names, on or off, whatever the base says, and the base gives the rest.

    ```js
    juris.renderToString({
        nav: { className: "menu open", classList: { open: false } },
    });
    // → <nav class="menu"></nav>
    ```

    ```js dom
    const layout = { nav: { className: "menu open", classList: { open: false } } };
    const page = document.createElement("main");
    juris.render(page, layout);
    page.innerHTML; // → <nav class="menu"></nav>
    juris.renderToString(layout); // → <nav class="menu"></nav>
    ```

  - Its keys are read in order, so where two keys name a class, the later one decides it; and a
    class that is there already is not written again.

    ```js
    juris.renderToString({
        p: { classList: { "badge new": true, new: false } },
    });
    // → <p class="badge"></p>
    ```

    ```js
    juris.renderToString({
        button: { className: "btn primary", classList: { primary: true } },
    });
    // → <button class="btn primary"></button>
    juris.renderToString({ p: { classList: { "badge new": true, new: true } } });
    // → <p class="badge new"></p>
    ```

  - The base is written as given until the `classList` changes it; then the attribute is its
    classes, once each, a space apart, as `element.classList` writes it.

    ```js
    const card = (sale) => ({
        p: { className: "card  wide", classList: { sale } },
    });
    juris.renderToString(card(false)); // → <p class="card  wide"></p>
    juris.renderToString(card(true)); // → <p class="card wide sale"></p>
    ```

  - Given both `class` and `className`, the later key is the base, and the earlier one is not
    used.

    ```js
    juris.renderToString({ p: { class: "note", className: "tip" } });
    // → <p class="tip"></p>
    ```

  - A `className` that runs again keeps what the `classList` decides: the classes it turns on
    stay on, and the ones it turns off stay off.

    ```js dom
    juris.setValue("theme", "light");
    const page = document.createElement("main");
    juris.render(page, {
        nav: {
            className: () => `menu ${juris.getState("theme")}`,
            classList: { open: true },
        },
    });
    page.innerHTML; // → <nav class="menu light open"></nav>
    juris.setValue("theme", "dark");
    page.innerHTML; // → <nav class="menu dark open"></nav>
    ```

    ```js dom
    juris.setValue("menu", { classes: "menu open", open: false });
    const page = document.createElement("main");
    juris.render(page, {
        nav: {
            className: () => juris.getState("menu.classes"),
            classList: { open: () => juris.getState("menu.open") },
        },
    });
    juris.setValue("menu.classes", "menu open wide");
    page.innerHTML; // → <nav class="menu wide"></nav>
    ```

  - A function as `classList` gives the whole object, and is run again when what it read
    changes: a class its object turns off is taken off, a class it no longer names goes back to
    what the base gives (taken off when the base does not give it), and no other class is
    touched.

    ```js
    juris.setValue("menu", { open: true, wide: false });
    juris.renderToString({
        nav: { className: "menu", classList: () => juris.getState("menu") },
    });
    // → <nav class="menu open"></nav>
    ```

    ```js dom
    juris.setValue("menu", { open: true, wide: false });
    const page = document.createElement("main");
    juris.render(page, {
        nav: { className: "menu", classList: () => juris.getState("menu") },
    });
    juris.setValue("menu", { wide: true });
    page.innerHTML; // → <nav class="menu wide"></nav>
    ```

    ```js dom
    juris.setValue("filters", { sale: false });
    const page = document.createElement("main");
    juris.render(page, {
        li: { className: "item sale", classList: () => juris.getState("filters") },
    });
    page.innerHTML; // → <li class="item"></li>
    juris.setValue("filters", {});
    page.innerHTML; // → <li class="item sale"></li>
    ```

  - The object it gives is used as it is: a function in it is not run, and counts as true.

    ```js
    juris.renderToString({ p: { classList: () => ({ open: () => false }) } });
    // → <p class="open"></p>
    ```

  - A `style` object's keys are camelCase properties (`marginTop`, `WebkitTransform`, `cssFloat`
    for `float`) or custom properties (`"--accent"`), which both renderers write alike; `cssText`
    and anything else is left out.

    ```js
    juris.renderToString({
        div: {
            style: {
                marginTop: "4px",
                cssFloat: "left",
                "--accent": "teal",
                cssText: "color: red",
            },
        },
    });
    // → <div style="margin-top:4px;float:left;--accent:teal"></div>
    ```

    ```js dom
    const page = document.createElement("main");
    juris.render(page, { div: { style: { "--accent": "teal" } } });
    page.firstChild.style.getPropertyValue("--accent"); // → "teal"
    ```

    - A vendor prefix leads with `-`: `WebkitTransform`, or `webkitTransform` in lower case, as the
      DOM's style object takes it too, is `-webkit-transform`, and `msTransform` is
      `-ms-transform`.

      ```js
      juris.renderToString({
          div: { style: { webkitTransform: "none", WebkitUserSelect: "none" } },
      });
      // → <div style="-webkit-transform:none;-webkit-user-select:none"></div>
      ```

      ```js dom
      const page = document.createElement("main");
      juris.render(page, { div: { style: { webkitTransform: "none" } } });
      page.firstChild.style.getPropertyValue("-webkit-transform"); // → "none"
      ```

  - A value is a string or a number with no `;`, `{`, `}`, `<`, `\`, `/*` or control character
    (newline included); any other value is left out on both sides (named in `devMode`), and on the
    client it takes off the value before it.

    ```js
    juris.renderToString({
        p: { style: { color: "red; position: fixed", zIndex: 2 } },
    });
    // → <p style="z-index:2"></p>
    ```

    ```js
    const dev = new Juris({ devMode: true, features: { ssr: SSRRenderer } });
    dev.renderToString({ p: { style: { color: "red; position: fixed" } } });
    // console.warn: Juris: dropped style color refuses "red; position: fixed"
    ```

    ```js dom
    juris.setValue("theme.color", "teal");
    const page = document.createElement("main");
    juris.render(page, {
        p: { style: () => ({ color: juris.getState("theme.color") }) },
    });
    page.innerHTML; // → <p style="color: teal;"></p>
    juris.setValue("theme.color", "red; position: fixed");
    page.innerHTML; // → <p style=""></p>
    ```

  - A key whose value is `null`, `undefined` or `""` is left out by the server and taken off by the
    client, as is a key a re-draw no longer gives.

    ```js
    juris.renderToString({
        p: { style: { color: null, fontWeight: "", marginTop: "4px" } },
    });
    // → <p style="margin-top:4px"></p>
    ```

    ```js dom
    juris.setValue("onSale", true);
    const page = document.createElement("main");
    juris.render(page, {
        p: {
            style: () => juris.getState("onSale")
                ? { color: "red", fontWeight: "bold" }
                : { color: "red" },
        },
    });
    juris.setValue("onSale", false);
    page.innerHTML; // → <p style="color: red;"></p>
    ```

- An `on…` key with a function is a listener: `onclick: (event) => …`.

  ```js dom
  juris.setValue("cart.count", 0);
  const page = document.createElement("main");
  juris.render(page, {
      button: {
          onclick: () => juris.updateState("cart.count", (count) => count + 1),
          textContent: () => `Add (${juris.getState("cart.count")})`,
      },
  });
  page.querySelector("button").click();
  page.innerHTML; // → <button>Add (1)</button>
  ```

  ```js
  juris.renderToString({ button: { onclick: () => {}, textContent: "Add" } });
  // → <button>Add</button>
  ```

  - An `on…` attribute with a string value is never written, nor is any other attribute or tag
    `html-safety.js` refuses.

    ```js
    juris.renderToString({ button: { onclick: "buy()", textContent: "Buy" } });
    // → <button>Buy</button>
    juris.renderToString({ a: { href: "javascript:buy()", textContent: "Buy" } });
    // → <a>Buy</a>
    juris.renderToString({ div: { children: [{ script: "buy()" }, { p: "Ok" }] } });
    // → <div><p>Ok</p></div>
    ```

- Any value may be a function. It is run to give the value, and run again when the state it read
  changes, updating that attribute or that text alone.

  ```js dom
  juris.setValue("user", { name: "Ada", online: true });
  const page = document.createElement("main");
  juris.render(page, {
      p: {
          className: () => (juris.getState("user.online") ? "online" : "away"),
          textContent: () => juris.getState("user.name"),
      },
  });
  const name = page.querySelector("p").firstChild;
  juris.setValue("user.online", false);
  page.innerHTML; // → <p class="away">Ada</p>
  page.querySelector("p").firstChild === name; // → true
  ```

  - That is how Juris is reactive: a function that reads `api.getState(path)` is subscribed to that
    path.

    ```js dom
    juris.setValue("cart", { count: 1, total: 3 });
    let runs = 0;
    juris.registerComponent("CartCount", (props, api) => ({
        span: {
            textContent: () => {
                runs += 1;
                return `${api.getState("cart.count")} items`;
            },
        },
    }));
    const page = document.createElement("main");
    juris.render(page, { CartCount: {} });
    juris.setValue("cart.total", 8);
    runs; // → 1
    juris.setValue("cart.count", 2);
    runs; // → 2
    ```

  - The function is called with the element it sets; a function in one child's place, or a
    component's root function, with the node it drew last (`null` on its first run).

    ```js dom
    const page = document.createElement("main");
    juris.render(page, {
        p: {
            className: (element) => `${element.localName}-note`,
            children: "Sale",
        },
    });
    page.innerHTML; // → <p class="p-note">Sale</p>
    ```

    ```js dom
    juris.setValue("cart.count", 1);
    const given = [];
    const count = (node) => {
        given.push(node === null ? null : node.nodeValue);
        return `${juris.getState("cart.count")} in cart`;
    };
    juris.render(document.createElement("main"), { p: { children: [count] } });
    juris.setValue("cart.count", 2);
    given; // → [null, "1 in cart"]
    ```

  - The server has no page, and calls each with `null`: a value worked out from the element is
    one it cannot write.

    ```js
    const given = [];
    const title = (element) => {
        given.push(element);
        return "Cart";
    };
    juris.renderToString({ p: { title, children: [title] } });
    // → <p title="Cart">Cart</p>
    given; // → [null, null]
    ```

- Children of `svg` and `math` are drawn in those namespaces, and HTML again where the browser's
  parser reads HTML inside them (its integration points), so the page the server wrote is the page
  the client draws: inside SVG's `foreignObject`, `title` and `desc`; inside MathML's `mi`, `mo`,
  `mn`, `ms` and `mtext` (but for `mglyph` and `malignmark`, which stay MathML); and inside an
  `annotation-xml` whose `encoding` is `text/html` or `application/xhtml+xml`, in any case.

  ```js dom
  const page = document.createElement("main");
  juris.render(page, {
      svg: {
          children: [
              { circle: { r: 4 } },
              { foreignObject: { children: [{ p: "Inside" }] } },
          ],
      },
  });
  page.querySelector("circle").namespaceURI; // → "http://www.w3.org/2000/svg"
  page.querySelector("p").namespaceURI; // → "http://www.w3.org/1999/xhtml"
  ```

  ```js
  juris.renderToString({
      svg: {
          children: [
              { a: { hidden: true } },
              { foreignObject: { children: [{ a: { hidden: true } }] } },
          ],
      },
  });
  // → <svg><a hidden="true"></a><foreignObject><a hidden=""></a>
  //   </foreignObject></svg>
  ```

  ```js dom
  const page = document.createElement("main");
  juris.render(page, {
      math: {
          children: [
              { mi: { children: [{ mglyph: {} }, { b: "x" }] } },
              {
                  "annotation-xml": {
                      encoding: "TEXT/HTML",
                      children: [{ i: "y" }],
                  },
              },
          ],
      },
  });
  page.querySelector("mglyph").namespaceURI;
  // → "http://www.w3.org/1998/Math/MathML"
  page.querySelector("b").namespaceURI; // → "http://www.w3.org/1999/xhtml"
  page.querySelector("i").namespaceURI; // → "http://www.w3.org/1999/xhtml"
  ```

  - An `annotation-xml` of another encoding holds MathML, but for an `svg`.

    ```js dom
    const page = document.createElement("main");
    juris.render(page, {
        math: {
            children: [{
                "annotation-xml": {
                    encoding: "application/mathml+xml",
                    children: [{ mi: "x" }, { svg: {} }],
                },
            }],
        },
    });
    page.querySelector("mi").namespaceURI;
    // → "http://www.w3.org/1998/Math/MathML"
    page.querySelector("svg").namespaceURI; // → "http://www.w3.org/2000/svg"
    ```

A prop may be a plain value, a getter (a function whose name does not start with `on`, read with
`api.prop(value)` inside a binding, so the read is tracked), or a ref to a state path
(`api.ref(path)`).

```js
juris.setValue("cart.count", 3);
juris.registerComponent("Count", (props, api) => ({
    span: { textContent: () => api.prop(props.value, 0) },
}));
juris.renderToString({
    p: {
        children: [
            { Count: { value: 1 } },
            { Count: { value: () => juris.getState("cart.count") } },
            { Count: { value: juris.api.ref("cart.count") } },
        ],
    },
});
// → <p><span>1</span><span>3</span><span>3</span></p>
```

```js dom
juris.setValue("cart.count", 3);
juris.registerComponent("Badge", (props, api) => ({
    span: { textContent: () => `${api.prop(props.count)} in cart` },
}));
const page = document.createElement("main");
juris.render(page, { Badge: { count: juris.api.ref("cart.count") } });
juris.setValue("cart.count", 4);
page.innerHTML; // → <span>4 in cart</span>
```

The components every instance has are `Await` (`{ Await: { group, fallback, onError, tag,
children } }`: `fallback` while an async group is pending, the children kept running behind it),
and, with the router installed, `RouterView` and `Link`.

```js
const orders = juris.api.group("orders");
orders.track(new Promise(() => {}));
juris.renderToString({
    Await: {
        group: "orders",
        fallback: { p: "Loading…" },
        children: [{ h2: "Your orders" }],
    },
});
// → <div><p>Loading…</p><div hidden=""><h2>Your orders</h2></div></div>
```

```js
import { createRouter } from "juris/router.js";

juris.use(createRouter({ routes: [{ path: "/orders", name: "orders" }] }));
juris.setValue("$route.path", "/orders");
juris.renderToString({ Link: { to: "/orders", children: "Orders" } });
// → <a href="/orders" class="active">Orders</a>
```

### Layouts, element by element

Where each piece of a layout goes, element by element, and what it draws. The rules are
in [Components and layouts](#components-and-layouts); this page shows them in place.

The examples share one instance, given the kit's string renderer, so a layout is shown as the HTML a
server writes for it. One shown "In a browser" draws into a page, fires the event, and reads the
state and the page after.

```js setup
import Juris from "juris/juris.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";

const juris = new Juris({ features: { ssr: SSRRenderer } });
```

#### The anatomy of a layout

One layout, each part named in the comment above it:

```js
juris.registerComponent("Price", (props) => ({
    strong: `${props.amount} €`,
}));
juris.setValue("cart", [
    { sku: "milk", title: "Milk" },
    { sku: "eggs", title: "Eggs" },
]);
const layout = {
    // The tag is the key, and its value is the content object.
    section: {
        // An attribute, as in HTML.
        id: "cart",
        // The class attribute, and a class switched on or off.
        className: "panel",
        classList: { empty: () => juris.getState("cart").length === 0 },
        // children: a list of layouts, with text among them.
        children: [
            { h2: "Your cart" },
            "Prices include VAT: ",
            // A component: a capitalised tag, whose content is its props.
            { Price: { amount: 8 } },
            {
                ul: {
                    // A seat: a function child, drawn again when what it reads
                    // changes.
                    children: () => juris.getState("cart").map((item) => ({
                        // key: the item's identity in the list.
                        li: { key: item.sku, textContent: item.title },
                    })),
                },
            },
            {
                button: {
                    // A listener: "on" and the event's name.
                    onclick: () => juris.setValue("cart", []),
                    // A function value: run again when what it reads changes.
                    disabled: () => juris.getState("cart").length === 0,
                    textContent: "Empty the cart",
                },
            },
        ],
    },
};
juris.renderToString(layout);
// → <section id="cart" class="panel"><h2>Your cart</h2>
//   Prices include VAT: <strong>8 €</strong>
//   <ul><li data-key="milk">Milk</li><li data-key="eggs">Eggs</li></ul>
//   <button>Empty the cart</button></section>
```

In a page, the listener writes the state, and each function that read it runs again:

```js dom
juris.setValue("cart", [{ sku: "milk", title: "Milk" }]);
const page = document.createElement("main");
juris.render(page, {
    section: {
        className: "panel",
        classList: { empty: () => juris.getState("cart").length === 0 },
        children: [
            {
                ul: {
                    children: () => juris.getState("cart").map((item) => ({
                        li: { key: item.sku, textContent: item.title },
                    })),
                },
            },
            {
                button: {
                    onclick: () => juris.setValue("cart", []),
                    disabled: () => juris.getState("cart").length === 0,
                    textContent: "Empty the cart",
                },
            },
        ],
    },
});
page.querySelector("button").click();
juris.getState("cart"); // → []
page.innerHTML;
// → <section class="panel empty"><ul></ul>
//   <button disabled="">Empty the cart</button></section>
```

#### Containers

`div`, `section`, `main`, `header`, `nav` and `footer` hold other elements in `children`. A layout
is a plain object, so a page's parts can be named, then put together:

```js
const nav = {
    nav: { children: [{ a: { href: "/cart", textContent: "Cart" } }] },
};
const header = { header: { children: [{ strong: "Corner Shop" }, nav] } };
const offers = { section: { children: [{ h1: "Fresh today" }] } };
const main = { main: { children: [offers] } };
const footer = { footer: "© Corner Shop" };
juris.renderToString({
    div: { className: "page", children: [header, main, footer] },
});
// → <div class="page"><header><strong>Corner Shop</strong>
//   <nav><a href="/cart">Cart</a></nav></header>
//   <main><section><h1>Fresh today</h1></section></main>
//   <footer>© Corner Shop</footer></div>
```

`children` is a list, or a single layout; text alone can be the whole content:

```js
juris.renderToString({ section: { children: [{ h2: "Milk" }, { p: "3 €" }] } });
// → <section><h2>Milk</h2><p>3 €</p></section>
juris.renderToString({ section: { children: { h2: "Milk" } } });
// → <section><h2>Milk</h2></section>
juris.renderToString({ main: "Nothing here yet." });
// → <main>Nothing here yet.</main>
```

A child goes in `children`: a tag written beside it is read as an attribute.

```js
juris.renderToString({ div: { p: "Milk" } }); // → <div p="Milk"></div>
juris.renderToString({ div: { children: [{ p: "Milk" }] } });
// → <div><p>Milk</p></div>
```

#### Text

A string or a number as the content is the text of a `p`, a `span`, a `strong`, an `em`, or a
heading from `h1` to `h6`:

```js
juris.renderToString({ h1: "Corner Shop" }); // → <h1>Corner Shop</h1>
juris.renderToString({ h2: "Dairy" }); // → <h2>Dairy</h2>
juris.renderToString({ p: "Open until 8 pm." }); // → <p>Open until 8 pm.</p>
juris.renderToString({ span: 12 }); // → <span>12</span>
```

Text and elements mix in `children`:

```js
juris.renderToString({
    p: {
        children: [
            "Milk is ",
            { strong: "half price" },
            " until ",
            { em: "Sunday" },
            ".",
        ],
    },
});
// → <p>Milk is <strong>half price</strong> until <em>Sunday</em>.</p>
```

`textContent` is the text too, always escaped, beside the element's attributes:

```js
juris.renderToString({ span: { className: "tag", textContent: "<new>" } });
// → <span class="tag">&lt;new&gt;</span>
```

Given `textContent`, its text is all the element holds, so text that goes with elements goes in
`children`; there a condition that is false draws nothing:

```js
juris.renderToString({
    p: { textContent: "Milk is ", children: [{ strong: "half price" }] },
});
// → <p>Milk is </p>
const onSale = false;
juris.renderToString({ p: { children: ["Milk", onSale && " is half price"] } });
// → <p>Milk</p>
```

A function as the text follows the state:

```js dom
juris.setValue("cart.count", 1);
const page = document.createElement("main");
juris.render(page, {
    p: {
        children: [
            "You have ",
            { strong: { textContent: () => juris.getState("cart.count") } },
            " items.",
        ],
    },
});
juris.setValue("cart.count", 3);
page.innerHTML; // → <p>You have <strong>3</strong> items.</p>
```

#### Links

`a` takes `href`, and `target` and `rel` as in HTML:

```js
juris.renderToString({
    a: {
        href: "https://maps.example/corner-shop",
        target: "_blank",
        rel: "noopener",
        textContent: "Find the shop",
    },
});
// → <a href="https://maps.example/corner-shop" target="_blank" rel="noopener">
//   Find the shop</a>
```

A path, a fragment or `mailto:` is written; a `javascript:` URL is left out
([`html-safety.js`](#html-safetyjs)):

```js
const help = (href) => juris.renderToString({
    a: { href, textContent: "Help" },
});
help("/help#returns"); // → <a href="/help#returns">Help</a>
help("mailto:help@shop.example");
// → <a href="mailto:help@shop.example">Help</a>
help("javascript:openChat()"); // → <a>Help</a>
```

In an app, the router's `Link` draws the `a`, with `active` on the current route's
([`router.js`](#routerjs)):

```js
import { createRouter } from "juris/router.js";

juris.use(createRouter({
    routes: [
        { path: "/", name: "home" },
        { path: "/orders/:id", name: "order" },
    ],
}));
juris.setValue("$route.path", "/orders/7");
juris.renderToString({
    nav: {
        children: [
            { Link: { to: "/", children: "Home" } },
            { Link: { to: "/orders/7", children: "Order 7" } },
        ],
    },
});
// → <nav><a href="/">Home</a><a href="/orders/7" class="active">Order 7</a>
//   </nav>
```

A click on it navigates in the page:

```js dom
import { createRouter } from "juris/router.js";

juris.use(createRouter({ routes: [{ path: "/" }, { path: "/orders" }] }));
const page = document.createElement("main");
juris.render(page, { Link: { to: "/orders", children: "Your orders" } });
page.querySelector("a").click();
await new Promise((resolve) => setTimeout(resolve));
location.pathname; // → "/orders"
page.innerHTML; // → <a href="/orders" class="active">Your orders</a>
```

#### Images and media

`img` takes `src`, `alt` and its size, and holds nothing:

```js
juris.renderToString({
    img: {
        src: "/img/milk.jpg",
        alt: "A bottle of milk",
        width: 320,
        height: 240,
    },
});
// → <img src="/img/milk.jpg" alt="A bottle of milk" width="320" height="240">
```

A `data:` URL is for an image only, such as an inline SVG:

```js
const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">',
    '<circle cx="4" cy="4" r="4" fill="green"/>',
    "</svg>",
].join("");
const src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
const html = juris.renderToString({ img: { src, alt: "In stock" } });
html === `<img src="${src}" alt="In stock">`; // → true
juris.renderToString({ img: { src: "data:text/html,hi", alt: "Sale" } });
// → <img alt="Sale">
```

`video` and `audio` take boolean attributes such as `controls`, and `source` children:

```js
juris.renderToString({
    video: {
        controls: true,
        muted: true,
        width: 640,
        children: [
            { source: { src: "/video/farm.webm", type: "video/webm" } },
            { source: { src: "/video/farm.mp4", type: "video/mp4" } },
        ],
    },
});
// → <video controls="" muted="" width="640">
//   <source src="/video/farm.webm" type="video/webm">
//   <source src="/video/farm.mp4" type="video/mp4"></video>
juris.renderToString({ audio: { src: "/audio/jingle.mp3", controls: false } });
// → <audio src="/audio/jingle.mp3"></audio>
```

#### Buttons

`button` takes `type`, its text, and `disabled`, a boolean attribute:

```js
juris.renderToString({
    button: { type: "button", textContent: "Add to cart" },
});
// → <button type="button">Add to cart</button>
juris.renderToString({
    button: { type: "submit", disabled: true, textContent: "Pay" },
});
// → <button type="submit" disabled="">Pay</button>
```

`onclick` is a function, and a function as `disabled` follows the state:

```js dom
juris.setValue("cart.count", 0);
const page = document.createElement("main");
juris.render(page, {
    button: {
        type: "button",
        onclick: () => juris.updateState("cart.count", (count) => count + 1),
        disabled: () => juris.getState("cart.count") >= 2,
        textContent: () => `Add (${juris.getState("cart.count")} of 2)`,
    },
});
const add = page.querySelector("button");
add.click();
add.click();
juris.getState("cart.count"); // → 2
page.innerHTML; // → <button type="button" disabled="">Add (2 of 2)</button>
```

#### Forms

`form` holds labels and fields; on a `label`, `htmlFor` is the `for` attribute:

```js
juris.renderToString({
    form: {
        action: "/sign-up",
        method: "post",
        children: [
            { label: { htmlFor: "email", textContent: "Email" } },
            { input: { id: "email", type: "email", name: "email" } },
            { button: { type: "submit", textContent: "Sign up" } },
        ],
    },
});
// → <form action="/sign-up" method="post"><label for="email">Email</label>
//   <input id="email" type="email" name="email">
//   <button type="submit">Sign up</button></form>
```

`onsubmit` is given the event: `preventDefault()` keeps the browser from sending the form itself.

```js dom
juris.setValue("signUp.sent", false);
const page = document.createElement("main");
juris.render(page, {
    form: {
        onsubmit: (event) => {
            event.preventDefault();
            juris.setValue("signUp.sent", true);
        },
        children: () => juris.getState("signUp.sent")
            ? { p: "Thanks for signing up." }
            : { button: { type: "submit", textContent: "Sign up" } },
    },
});
const submit = new Event("submit", { cancelable: true });
page.querySelector("form").dispatchEvent(submit);
submit.defaultPrevented; // → true
page.innerHTML; // → <form><p>Thanks for signing up.</p></form>
```

A text `input`: `value` reads the state, and `oninput` writes it back.

```js dom
juris.setValue("signUp.name", "");
const page = document.createElement("main");
juris.render(page, {
    input: {
        type: "text",
        value: () => juris.getState("signUp.name"),
        oninput: (event) => juris.setValue("signUp.name", event.target.value),
    },
});
const name = page.querySelector("input");
name.value = "Ada";
name.dispatchEvent(new Event("input"));
juris.getState("signUp.name"); // → "Ada"
juris.setValue("signUp.name", "Grace");
name.value; // → "Grace"
```

A checkbox's `checked`, a radio's `name` and `value`, a number's `min` and `max`:

```js
juris.renderToString({
    input: { type: "checkbox", name: "gift", checked: true },
});
// → <input type="checkbox" name="gift" checked="">
juris.renderToString({
    input: { type: "radio", name: "size", value: "large", checked: false },
});
// → <input type="radio" name="size" value="large">
juris.renderToString({
    input: { type: "number", name: "quantity", min: 1, max: 9, value: 2 },
});
// → <input type="number" name="quantity" min="1" max="9" value="2">
```

A checkbox writes `event.target.checked`, on `onchange`:

```js dom
juris.setValue("signUp.offers", false);
const page = document.createElement("main");
juris.render(page, {
    label: {
        children: [
            {
                input: {
                    type: "checkbox",
                    checked: () => juris.getState("signUp.offers"),
                    onchange: (event) => {
                        juris.setValue("signUp.offers", event.target.checked);
                    },
                },
            },
            " Send me offers",
        ],
    },
});
const box = page.querySelector("input");
box.checked = true;
box.dispatchEvent(new Event("change"));
juris.getState("signUp.offers"); // → true
page.innerHTML;
// → <label><input type="checkbox" checked=""> Send me offers</label>
```

A box that stands for some of a list is `indeterminate`, the box's property, which the client sets
(the server writes nothing for it):

```js dom
juris.setValue("cart", [{ sku: "milk", picked: true }, { sku: "eggs" }]);
const cart = () => juris.getState("cart");
const picked = () => cart().filter((item) => item.picked).length;
const all = () => cart().length;
const page = document.createElement("main");
juris.render(page, {
    input: {
        type: "checkbox",
        checked: () => picked() === all(),
        indeterminate: () => picked() > 0 && picked() < all(),
    },
});
page.firstChild.indeterminate; // → true
page.innerHTML; // → <input type="checkbox">
```

`fieldset` and its `legend` group fields. On a `textarea`, `value` is its text; on a `select`,
`value` picks an `option`:

```js
juris.renderToString({
    fieldset: {
        children: [
            { legend: "Delivery" },
            {
                select: {
                    name: "slot",
                    value: "pm",
                    children: [
                        { option: { value: "am", textContent: "Morning" } },
                        { option: { value: "pm", textContent: "Afternoon" } },
                    ],
                },
            },
            { textarea: { name: "note", rows: 2, value: "Ring twice" } },
        ],
    },
});
// → <fieldset><legend>Delivery</legend><select name="slot">
//   <option value="am">Morning</option>
//   <option value="pm" selected="">Afternoon</option></select>
//   <textarea name="note" rows="2">Ring twice</textarea></fieldset>
```

A `select` writes the chosen value, on `onchange`:

```js dom
juris.setValue("delivery.slot", "am");
const page = document.createElement("main");
juris.render(page, {
    select: {
        value: () => juris.getState("delivery.slot"),
        onchange: (event) => {
            juris.setValue("delivery.slot", event.target.value);
        },
        children: [
            { option: { value: "am", textContent: "Morning" } },
            { option: { value: "pm", textContent: "Afternoon" } },
        ],
    },
});
const slot = page.querySelector("select");
slot.value = "pm";
slot.dispatchEvent(new Event("change"));
juris.getState("delivery.slot"); // → "pm"
```

`output` shows a result; a number field's `value` is a string:

```js dom
juris.setValue("order.quantity", 1);
const page = document.createElement("main");
juris.render(page, {
    p: {
        children: [
            {
                input: {
                    type: "number",
                    min: 1,
                    value: () => juris.getState("order.quantity"),
                    oninput: (event) => {
                        const quantity = Number(event.target.value);
                        juris.setValue("order.quantity", quantity);
                    },
                },
            },
            " × 3 € = ",
            {
                output: {
                    value: () => `${juris.getState("order.quantity") * 3} €`,
                },
            },
        ],
    },
});
const quantity = page.querySelector("input");
quantity.value = "4";
quantity.dispatchEvent(new Event("input"));
juris.getState("order.quantity"); // → 4
page.querySelector("output").outerHTML; // → <output>12 €</output>
```

For values, errors and a submit kept together, `api.form` gives a field's props
([`forms.js`](#formsjs)):

```js
import { forms } from "juris/forms.js";

juris.use(forms());
const signUp = juris.api.form("signUp", { fields: { email: "" } });
juris.renderToString({ input: signUp.field("email", { type: "email" }) });
// → <input name="email" type="email" value="">
```

#### Lists

`ul` or `ol` takes each `li` in `children`, mapped from an array:

```js
const groceries = ["Milk", "Eggs", "Bread"];
juris.renderToString({
    ul: { children: groceries.map((item) => ({ li: item })) },
});
// → <ul><li>Milk</li><li>Eggs</li><li>Bread</li></ul>
```

`key` goes on each item, and the server writes it as `data-key`:

```js
const todos = [
    { id: 1, title: "Buy milk" },
    { id: 2, title: "Call the bakery" },
];
juris.renderToString({
    ol: {
        children: todos.map((todo) => ({
            li: { key: todo.id, textContent: todo.title },
        })),
    },
});
// → <ol><li data-key="1">Buy milk</li><li data-key="2">Call the bakery</li>
//   </ol>
```

A function as `children` draws the list again from the state, keeping each keyed item's element:

```js dom
juris.setValue("todos", [{ id: 1, title: "Buy milk" }]);
const addTodo = (title) => juris.updateState("todos", (todos) => [
    ...todos,
    { id: todos.length + 1, title },
]);
const page = document.createElement("main");
juris.render(page, {
    section: {
        children: [
            {
                ul: {
                    children: () => juris.getState("todos").map((todo) => ({
                        li: { key: todo.id, textContent: todo.title },
                    })),
                },
            },
            {
                button: {
                    onclick: () => addTodo("Call the bakery"),
                    textContent: "Add",
                },
            },
        ],
    },
});
const first = page.querySelector("li");
page.querySelector("button").click();
page.querySelector("ul").outerHTML;
// → <ul><li>Buy milk</li><li>Call the bakery</li></ul>
page.querySelector("li") === first; // → true
```

#### Tables

In a `table`, `thead` and `tbody` hold `tr` rows of `th` and `td` cells, one keyed row per line:

```js
const lines = [
    { sku: "milk", title: "Milk", price: 3 },
    { sku: "eggs", title: "Eggs", price: 5 },
];
const row = (line) => ({
    tr: {
        key: line.sku,
        children: [{ td: line.title }, { td: `${line.price} €` }],
    },
});
const head = { tr: { children: [{ th: "Item" }, { th: "Price" }] } };
juris.renderToString({
    table: {
        children: [
            { thead: { children: [head] } },
            { tbody: { children: lines.map(row) } },
        ],
    },
});
// → <table><thead><tr><th>Item</th><th>Price</th></tr></thead>
//   <tbody><tr data-key="milk"><td>Milk</td><td>3 €</td></tr>
//   <tr data-key="eggs"><td>Eggs</td><td>5 €</td></tr></tbody></table>
```

`colSpan` joins cells (HTML reads an attribute's name in any case, so a browser reads `colspan`):

```js
const note = {
    tr: { children: [{ td: { colSpan: 2, textContent: "Free delivery" } }] },
};
juris.renderToString({
    table: { children: [{ tfoot: { children: [note] } }] },
});
// → <table><tfoot><tr><td colSpan="2">Free delivery</td></tr></tfoot></table>
```

#### Style

`style` is an object of camelCase properties:

```js
juris.renderToString({
    p: {
        style: { color: "teal", fontWeight: "bold", marginTop: "4px" },
        textContent: "On sale",
    },
});
// → <p style="color:teal;font-weight:bold;margin-top:4px">On sale</p>
```

or a string, written as given:

```js
juris.renderToString({
    p: { style: "color: teal; font-weight: bold", textContent: "On sale" },
});
// → <p style="color: teal; font-weight: bold">On sale</p>
```

`classList` switches classes on and off, and a function for a class follows the state:

```js dom
juris.setValue("menu.open", false);
const toggle = () => juris.updateState("menu.open", (open) => !open);
const page = document.createElement("main");
juris.render(page, {
    nav: {
        className: "menu",
        classList: { open: () => juris.getState("menu.open") },
        children: [{ button: { onclick: toggle, textContent: "Menu" } }],
    },
});
page.querySelector("button").click();
page.querySelector("nav").className; // → "menu open"
page.querySelector("button").click();
page.querySelector("nav").className; // → "menu"
```

A function for the whole object follows the state too, and a class it no longer names is taken
off, unless `className` gives it:

```js dom
juris.setValue("order", { status: "paid" });
const page = document.createElement("main");
juris.render(page, {
    span: {
        className: "badge",
        classList: () => ({ [juris.getState("order.status")]: true }),
        textContent: () => juris.getState("order.status"),
    },
});
juris.setValue("order.status", "shipped");
page.innerHTML; // → <span class="badge shipped">shipped</span>
```

#### SVG and MathML

An `svg` icon: `viewBox` keeps its case, and the shapes go in `children`:

```js
const outline = { d: "M3 4h2l3 11h10l2-7H6", fill: "none", stroke: "teal" };
juris.renderToString({
    svg: {
        viewBox: "0 0 24 24",
        width: 24,
        children: [
            { path: outline },
            { circle: { cx: 9, cy: 20, r: 1.5 } },
            { circle: { cx: 17, cy: 20, r: 1.5 } },
        ],
    },
});
// → <svg viewBox="0 0 24 24" width="24">
//   <path d="M3 4h2l3 11h10l2-7H6" fill="none" stroke="teal"></path>
//   <circle cx="9" cy="20" r="1.5"></circle>
//   <circle cx="17" cy="20" r="1.5"></circle></svg>
```

A formula in `math`: `mi` a name, `mo` an operator, `mn` a number:

```js
juris.renderToString({
    math: {
        children: [
            { mi: "total" },
            { mo: "=" },
            { mn: 3 },
            { mo: "×" },
            { mn: 4 },
        ],
    },
});
// → <math><mi>total</mi><mo>=</mo><mn>3</mn><mo>×</mo><mn>4</mn></math>
```

#### The rest of the elements

The children of a `template` are its content, kept for later and not drawn
([Components and layouts](#components-and-layouts)):

```js
juris.renderToString({
    template: {
        id: "todo-row",
        children: [{ li: { className: "todo", textContent: "New todo" } }],
    },
});
// → <template id="todo-row"><li class="todo">New todo</li></template>
```

`dialog` and `details` take `open`, a boolean attribute; `summary` is the line a closed `details`
shows:

```js
juris.renderToString({
    dialog: { open: true, children: [{ p: "Added to your cart." }] },
});
// → <dialog open=""><p>Added to your cart.</p></dialog>
juris.renderToString({
    details: {
        open: false,
        children: [{ summary: "Delivery" }, { p: "Free over 30 €." }],
    },
});
// → <details><summary>Delivery</summary><p>Free over 30 €.</p></details>
```

A function as `open` follows the state:

```js dom
juris.setValue("cart.added", true);
const close = () => juris.setValue("cart.added", false);
const page = document.createElement("main");
juris.render(page, {
    dialog: {
        open: () => juris.getState("cart.added"),
        children: [
            { p: "Added to your cart." },
            { button: { onclick: close, textContent: "Close" } },
        ],
    },
});
page.querySelector("button").click();
page.innerHTML;
// → <dialog><p>Added to your cart.</p><button>Close</button></dialog>
```

A `script`, a `style`, an `iframe` and an `onclick` string are refused, and left out:

```js
juris.renderToString({
    div: {
        children: [
            { script: "trackVisit()" },
            { style: "p { color: red }" },
            { iframe: { src: "https://maps.example/shop" } },
            { button: { onclick: "buy()", textContent: "Buy" } },
        ],
    },
});
// → <div><button>Buy</button></div>
```

What goes in their place: code in a function (an `onclick` under [Buttons](#buttons)), CSS in a
`style` attribute or the page's stylesheet (`styles` in
[`server/document.js`](#serverdocumentjs)), and `allowTags` on the instance for a tag it must draw:

```js
const shop = new Juris({
    allowTags: ["iframe"],
    features: { ssr: SSRRenderer },
});
shop.renderToString({
    iframe: { src: "https://maps.example/shop", title: "Map" },
});
// → <iframe src="https://maps.example/shop" title="Map"></iframe>
```

#### Components as elements

A component is a capitalised tag, and its content is the props:

```js
juris.registerComponent("Cart", (props) => ({
    section: {
        className: "cart",
        children: [
            { h2: `Cart (${props.items.length})` },
            { ul: { children: props.items.map((item) => ({ li: item })) } },
        ],
    },
}));
const items = ["Milk", "Eggs"];
juris.renderToString({ Cart: { items } });
// → <section class="cart"><h2>Cart (2)</h2><ul><li>Milk</li><li>Eggs</li>
//   </ul></section>
```

`children` given to a component is a prop like the others; the component puts it where it goes:

```js
juris.registerComponent("Card", (props) => ({
    article: {
        className: "card",
        children: [{ h3: props.title }, ...props.children],
    },
}));
juris.renderToString({
    Card: { title: "Milk", children: [{ p: "2 bottles" }, { p: "3 €" }] },
});
// → <article class="card"><h3>Milk</h3><p>2 bottles</p><p>3 €</p></article>
```

Components nest, each drawing the next with the props it gives it:

```js
juris.registerComponent("Price", (props) => ({
    strong: `${props.amount} €`,
}));
juris.registerComponent("Product", (props) => ({
    li: { children: [`${props.title} `, { Price: { amount: props.price } }] },
}));
juris.registerComponent("Shelf", (props) => ({
    ul: { children: props.products.map((product) => ({ Product: product })) },
}));
const products = [
    { title: "Milk", price: 3 },
    { title: "Eggs", price: 5 },
];
juris.renderToString({ Shelf: { products } });
// → <ul><li>Milk <strong>3 €</strong></li><li>Eggs <strong>5 €</strong></li>
//   </ul>
```

A page's shell: each `Link` in the `nav`, `RouterView` where the route's page goes, and `Await`
around what is still loading:

```js
import { createRouter } from "juris/router.js";

juris.registerComponent("OrdersPage", (props, api) => {
    api.group("orders").track(new Promise(() => {}));
    return {
        Await: {
            group: "orders",
            fallback: { p: "Loading your orders…" },
            children: [{ h1: "Your orders" }],
        },
    };
});
juris.use(createRouter({
    routes: [{ path: "/orders", component: "OrdersPage" }],
}));
const orders = { Link: { to: "/orders", children: "Orders" } };
juris.registerComponent("App", () => ({
    div: {
        children: [
            { nav: { children: [orders] } },
            { main: { children: [{ RouterView: {} }] } },
        ],
    },
}));
await juris.api.navigate("/orders");
juris.renderToString({ App: {} });
// → <div><nav><a href="/orders" class="active">Orders</a></nav><main>
//   <div data-key="route-0"><p>Loading your orders…</p>
//   <div hidden=""><h1>Your orders</h1></div></div></main></div>
```

#### Where the api is used

A component's body runs once, when it is drawn: set up there, with `useState` and `onMount`
([The component api](#the-component-api)).

```js dom
const log = [];
juris.registerComponent("TodoFilter", (props, api) => {
    log.push("body");
    const [filter, setFilter] = api.useState("filter", "all");
    api.onMount((element) => log.push(`mounted <${element.localName}>`));
    const doneOnly = () => setFilter("done");
    return {
        p: {
            children: [
                { span: { textContent: () => `Showing ${filter()}` } },
                { button: { onclick: doneOnly, textContent: "Done only" } },
            ],
        },
    };
});
const page = document.createElement("main");
juris.render(page, { TodoFilter: {} });
page.querySelector("button").click();
log; // → ["body", "mounted <p>"]
page.innerHTML;
// → <p><span>Showing done</span><button>Done only</button></p>
```

A function value reads, and runs again when what it read changes:

```js dom
juris.setValue("cart.count", 1);
let runs = 0;
juris.registerComponent("CartBadge", (props, api) => ({
    span: {
        textContent: () => {
            runs += 1;
            return `${api.getState("cart.count")} in cart`;
        },
    },
}));
const page = document.createElement("main");
juris.render(page, { CartBadge: {} });
juris.setValue("cart.count", 2);
page.innerHTML; // → <span>2 in cart</span>
runs; // → 2
```

An event handler writes:

```js dom
juris.setValue("cart.count", 0);
juris.registerComponent("AddToCart", (props, api) => ({
    button: {
        onclick: () => api.updateState("cart.count", (count) => count + 1),
        textContent: `Add ${props.title}`,
    },
}));
const page = document.createElement("main");
juris.render(page, { AddToCart: { title: "Milk" } });
page.querySelector("button").click();
page.querySelector("button").click();
juris.getState("cart.count"); // → 2
```

A read in the body runs once, so what it gives never changes; a read inside a function follows the
state:

```js dom
juris.setValue("cart.count", 1);
juris.registerComponent("CartCount", (props, api) => {
    // Read once, in the body: a plain value.
    const once = api.getState("cart.count");
    // Read in a function: run again on each change.
    const now = () => `Now: ${api.getState("cart.count")}`;
    return {
        p: {
            children: [
                { span: `Read once: ${once}. ` },
                { span: { textContent: now } },
            ],
        },
    };
});
const page = document.createElement("main");
juris.render(page, { CartCount: {} });
juris.setValue("cart.count", 5);
page.innerHTML;
// → <p><span>Read once: 1. </span><span>Now: 5</span></p>
```

### The component api

The examples on this page share one instance, with three services, and its `api`, which is the
object every component is given:

```js setup
import Juris from "juris/juris.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";
import { fail } from "juris/errors.js";

const services = {
    price: async (sku) => ({ milk: 3, eggs: 5 })[sku],
    cartCount: () => 2,
    stock: async () => fail("The stock service is down."),
};
const juris = new Juris({ services, features: { ssr: SSRRenderer } });
const api = juris.api;
```

Every component is given `api`, the same object on the server and in the browser:

```js
let given = null;
juris.registerComponent("Cart", (props, api) => {
    given = api;
    return { p: "Your cart" };
});
juris.renderToString({ Cart: {} });
given === juris.api; // → true
```

- **State.** `getState(path, default, { track })` is a tracked read; `peek(path)` is an untracked
  one.

  ```js
  api.setValue("cart", { items: 1, coupon: "SPRING" });
  const shown = [];
  api.bindState(
      () => `${api.getState("cart.items")} items, ${api.peek("cart.coupon")}`,
      (text) => shown.push(text),
  );
  api.setValue("cart.coupon", "SUMMER");
  api.setValue("cart.items", 2);
  shown; // → ["1 items, SPRING", "2 items, SUMMER"]
  ```

  - `setValue(path, value)`, `updateState(path, updater)`, `deleteState(path)`, `batch(fn)`,
    `assign(path, value)` (writes leaf by leaf, so readers of unchanged leaves are not woken),
    `compute(path, resolver)`, `clearState(next)`, `toRaw(value)` and
    `bindState(resolver, apply)`.

    ```js
    api.setValue("cart", { items: 2, total: 30 });
    api.getState("cart.coupon", "none"); // → "none"
    api.updateState("cart.items", (items) => items + 1);
    api.deleteState("cart.total");
    api.getState("cart"); // → { items: 3 }
    api.clearState({ cart: { items: 0 } });
    api.getState("cart.items"); // → 0
    ```

    ```js
    api.setValue("user", { name: "Ada", city: "London" });
    const names = [];
    api.bindState(() => api.getState("user.name"), (name) => names.push(name));
    api.assign("user", { name: "Ada", city: "Paris" });
    names; // → ["Ada"]
    api.setValue("user", { name: "Ada", city: "Rome" });
    names; // → ["Ada", "Ada"]
    api.batch(() => {
        api.setValue("user.name", "Grace");
        api.setValue("user.name", "Grace Hopper");
    });
    names; // → ["Ada", "Ada", "Grace Hopper"]
    ```

    ```js
    api.setValue("cart.lines", [{ price: 3 }, { price: 5 }]);
    api.compute("cart.total", (api) =>
        api.getState("cart.lines").reduce((sum, line) => sum + line.price, 0));
    api.getState("cart.total"); // → 8
    api.setValue("cart.lines.1.price", 7);
    api.getState("cart.total"); // → 10
    ```

- **Local state.** `useState(key, initial)` answers `[get, set]` (see "Local state").

  ```js dom
  juris.registerComponent("LikeButton", (props, api) => {
      const [likes, setLikes] = api.useState("likes", 0);
      return {
          button: {
              onclick: () => setLikes((n) => n + 1),
              textContent: () => `♥ ${likes()}`,
          },
      };
  });
  const page = document.createElement("main");
  juris.render(page, { LikeButton: {} });
  page.querySelector("button").click();
  page.innerHTML; // → <button>♥ 1</button>
  ```

- **Services.** `call(name, ...args)` answers a promise, or, for a call that was preloaded, a
  settled value that runs its callbacks at once.

  ```js
  await api.call("price", "milk"); // → 3
  ```

  ```js
  juris.registerComponent("Price", (props, api) => {
      let text = "…";
      api.call("price", props.sku).then((price) => (text = `${price} €`));
      return { span: text };
  });
  const page = await juris.renderRequest({
      preload: [["price", "milk"]],
      layout: { Price: { sku: "milk" } },
  });
  page.html; // → <span>3 €</span>
  ```

  - A service that answers at once (a local one that is not async: a test's, a server's own) is
    answered as a settled value too, and one that throws as a settled rejection, so `then` and
    `catch` run at once and a server render draws the answer.

    ```js
    let count = null;
    api.call("cartCount").then((n) => (count = n));
    count; // → 2
    await api.call("cartCount"); // → 2
    juris.renderToString({ b: () => api.call("cartCount") }); // → <b>2</b>
    ```

    ```js
    const shop = new Juris({
        services: {
            price: () => {
                throw new Error("No price list yet.");
            },
        },
    });
    let said = null;
    shop.api.call("price", "milk").catch((error) => (said = error.message));
    said; // → "No price list yet."
    ```

  - `live(path, name, ...args)` calls a live query, writes its answer at `path` and keeps it
    written as the server pushes changes; inside a component the subscription ends with the
    component.

    ```js
    const stop = api.live("cart.count", "cartCount");
    api.getState("cart.count"); // → 2
    api.liveState("cart.count"); // → "live"
    stop();
    api.liveState("cart.count"); // → null
    ```

  - `liveState(path)` says, tracked, whether what is at a live path is current: `"live"` (the
    latest answer is on screen, a preloaded one included), `"pending"` (subscribed, the first
    answer not here yet: what is shown is older, or nothing), `"failed"` (the subscribe was
    refused, or the server could not run the query again; or, with no live client, the call
    rejected), `"offline"` (the stream is down), or `null` where nothing is live;
    `liveMessage(path)` is a failed path's words, or `null`.

    ```js
    api.live("stock.milk", "stock", "milk");
    api.liveState("stock.milk"); // → "pending"
    await new Promise((resolve) => setTimeout(resolve));
    api.liveState("stock.milk"); // → "failed"
    api.liveMessage("stock.milk"); // → "The stock service is down."
    api.liveState("orders"); // → null
    ```

  - On a server a preloaded live path is `"live"`, and so is the browser's first render of it, so
    the two draw alike.

    ```js
    juris.registerComponent("CartCount", (props, api) => {
        api.live("cart.count", "cartCount");
        const count = () => api.getState("cart.count");
        const state = () => api.liveState("cart.count");
        return { span: { textContent: () => `${count()} (${state()})` } };
    });
    const page = await juris.renderRequest({
        preload: [["cartCount"]],
        layout: { CartCount: {} },
    });
    page.html; // → <span>2 (live)</span>
    ```

  - `preloaded(name, ...args)` reads a preloaded answer without calling or subscribing.

    ```js
    juris.registerComponent("CartTitle", (props, api) => ({
        h2: `Cart (${api.preloaded("cartCount") ?? "…"})`,
    }));
    const page = await juris.renderRequest({
        preload: [["cartCount"]],
        layout: { CartTitle: {} },
    });
    page.html; // → <h2>Cart (2)</h2>
    api.preloaded("price", "eggs"); // → undefined
    ```

  - `invalidate(name, ...args)` drops the browser's call cache.

    ```js dom
    let asked = 0;
    const browser = new Juris({
        services: { price: async () => (asked += 1) },
        callCache: { ttl: 60_000 },
    });
    await browser.api.call("price", "milk"); // → 1
    await browser.api.call("price", "milk"); // → 1
    browser.api.invalidate("price", "milk");
    await browser.api.call("price", "milk"); // → 2
    ```

  - `group(name)` counts a group's pending promises. `services` is the instance's services.

    ```js
    const checkout = api.group("checkout");
    const saved = new Promise((resolve) => setTimeout(resolve, 10));
    const saving = checkout.track(saved);
    checkout.pending(); // → 1
    await saving;
    checkout.pending(); // → 0
    Object.keys(api.services); // → ["price", "cartCount", "stock"]
    ```

- **Lifecycle**, during a definition only: `onMount(fn)`, `onCleanup(fn)`, and `onError(handler)`,
  which makes the component an error boundary.

  ```js dom
  const log = [];
  juris.registerComponent("Clock", (props, api) => {
      api.onMount((element) => log.push(`mounted <${element.localName}>`));
      api.onCleanup(() => log.push("cleaned up"));
      return { time: "12:00" };
  });
  const page = document.createElement("main");
  juris.render(page, { Clock: {} });
  juris.disposeTree(page.firstChild);
  log; // → ["mounted <time>", "cleaned up"]
  ```

  ```js
  api.onMount(() => {});
  // throws Error: Juris.onMount: must be called during component setup
  ```

  ```js
  juris.registerComponent("PriceTag", () => {
      throw new Error("no price for eggs");
  });
  juris.registerComponent("ProductCard", (props, api) => {
      api.onError(() => ({ p: "Price unavailable" }));
      return { article: { children: [{ h3: "Eggs" }, { PriceTag: {} }] } };
  });
  juris.renderToString({ ProductCard: {} }); // → <p>Price unavailable</p>
  ```

  - `onMount` handlers run inside out: those of the components drawn inside a component's root
    before its own.

    ```js dom
    const log = [];
    juris.registerComponent("CartLine", (props, api) => {
        api.onMount(() => log.push("CartLine"));
        return { li: "Milk" };
    });
    juris.registerComponent("Cart", (props, api) => {
        api.onMount(() => log.push("Cart"));
        return { ul: { children: [{ CartLine: {} }] } };
    });
    juris.render(document.createElement("main"), { Cart: {} });
    log; // → ["CartLine", "Cart"]
    ```

  - When a part of the page goes (a seat or a list drops it, or `disposeTree`), its cleanups run
    outside in: a component's before those of the components drawn inside its root element, so
    by the time theirs run, nothing around them is bound to draw again.

    ```js dom
    const log = [];
    juris.registerComponent("CartLine", (props, api) => {
        api.onCleanup(() => log.push("CartLine"));
        return { li: "Milk" };
    });
    juris.registerComponent("Cart", (props, api) => {
        api.onCleanup(() => log.push("Cart"));
        return { ul: { children: [{ CartLine: {} }] } };
    });
    const page = document.createElement("main");
    juris.render(page, { Cart: {} });
    juris.disposeTree(page.firstChild);
    log; // → ["Cart", "CartLine"]
    ```

  - A component whose layout is another component shares that one's root, and goes after it:
    on one node, the innermost component goes first.

    ```js dom
    const log = [];
    juris.registerComponent("Panel", (props, api) => {
        api.onCleanup(() => log.push("Panel"));
        return { aside: "Your cart" };
    });
    juris.registerComponent("CartPanel", (props, api) => {
        api.onCleanup(() => log.push("CartPanel"));
        return { Panel: {} };
    });
    const page = document.createElement("main");
    juris.render(page, { CartPanel: {} });
    juris.disposeTree(page.firstChild);
    log; // → ["Panel", "CartPanel"]
    ```

  - On the server nothing is bound, and every cleanup runs when the render ends, the last
    component set up first.

    ```js
    const log = [];
    juris.registerComponent("CartLine", (props, api) => {
        api.onCleanup(() => log.push("CartLine"));
        return { li: "Milk" };
    });
    juris.registerComponent("Cart", (props, api) => {
        api.onCleanup(() => log.push("Cart"));
        return { ul: { children: [{ CartLine: {} }] } };
    });
    juris.renderToString({ Cart: {} });
    log; // → ["CartLine", "Cart"]
    ```

  - `onError`'s handler is given `(error, { phase, component, boundary })`: `phase` is `"setup"`
    (a definition threw), `"binding"` (a function value threw) or `"async"` (a promise one
    returned rejected), `component` the component it was thrown in, and `boundary` the one asked.

    ```js
    const asked = [];
    juris.registerComponent("PriceTag", () => {
        throw new Error("no price for eggs");
    });
    juris.registerComponent("ProductCard", (props, api) => {
        api.onError((error, { phase, component, boundary }) => {
            asked.push([phase, component, boundary, error.message]);
            return { p: "Price unavailable" };
        });
        return { article: { children: [{ PriceTag: {} }] } };
    });
    juris.renderToString({ ProductCard: {} });
    asked; // → [["setup", "PriceTag", "ProductCard", "no price for eggs"]]
    ```

  - What it returns decides: a layout replaces the boundary's root (above); `false` passes the
    error to the next boundary out, and with none left it is thrown, as with no boundary.

    ```js
    juris.registerComponent("PriceTag", () => {
        throw new Error("no price for eggs");
    });
    juris.registerComponent("ProductCard", (props, api) => {
        api.onError(() => false);
        return { article: { children: [{ PriceTag: {} }] } };
    });
    juris.registerComponent("Shelf", (props, api) => {
        api.onError(() => ({ p: "Shelf unavailable" }));
        return { section: { children: [{ ProductCard: {} }] } };
    });
    juris.renderToString({ Shelf: {} }); // → <p>Shelf unavailable</p>
    juris.renderToString({ ProductCard: {} });
    // throws Error: no price for eggs
    ```

  - Anything else, `undefined` included, handles the error with no fallback: what failed is
    left out (a component that threw draws nothing, a function value that threw keeps its last
    value) and the rest of the boundary's layout stays, named on the console in `devMode`.

    ```js
    juris.registerComponent("PriceTag", () => {
        throw new Error("no price for eggs");
    });
    juris.registerComponent("ProductCard", (props, api) => {
        api.onError(() => undefined);
        return { article: { children: [{ h3: "Eggs" }, { PriceTag: {} }] } };
    });
    juris.renderToString({ ProductCard: {} });
    // → <article><h3>Eggs</h3></article>
    const dev = new Juris({ devMode: true, features: { ssr: SSRRenderer } });
    dev.registerComponent("PriceTag", () => {
        throw new Error("no price for eggs");
    });
    dev.registerComponent("ProductCard", (props, api) => {
        api.onError(() => {});
        return { article: { children: [{ PriceTag: {} }] } };
    });
    dev.renderToString({ ProductCard: {} });
    // console.warn: Juris: error in "PriceTag" handled by "ProductCard"
    ```

    ```js dom
    juris.setValue("price", 3);
    juris.registerComponent("Price", (props, api) => {
        api.onError(() => undefined);
        const text = () => {
            const price = juris.getState("price");
            if (price < 0) throw new Error("a price is never negative");
            return `${price} €`;
        };
        return { p: { textContent: text } };
    });
    const page = document.createElement("main");
    juris.render(page, { Price: {} });
    juris.setValue("price", -1);
    page.innerHTML; // → <p>3 €</p>
    ```

  - A boundary covers drawing: a definition, a function value, and the promise it returns. A
    listener runs later, outside any draw, so what it throws never reaches a boundary: it goes
    where any listener's error goes, and the listener catches what it must.

    ```js dom
    const asked = [];
    juris.registerComponent("Checkout", (props, api) => {
        api.onError((error) => {
            asked.push(error.message);
            return { p: "Something went wrong" };
        });
        const pay = () => {
            throw new Error("Card declined");
        };
        return { button: { onclick: pay, textContent: "Pay" } };
    });
    const page = document.createElement("main");
    juris.render(page, { Checkout: {} });
    try {
        page.querySelector("button").click();
    } catch {
        // A browser reports it as uncaught; this stand-in page throws it.
    }
    asked; // → []
    page.innerHTML; // → <button>Pay</button>
    ```

- **Drawing.** `render`, `mount`, `renderToString` (on an instance given the kit's string renderer:
  "`server/ssr-renderer.js`"), `enhance`, `unenhance`, `registerComponent`, `disposeTree`.

  ```js dom
  const page = document.createElement("main");
  page.innerHTML = "<p>From the server</p>";
  api.render(page, { p: "Added" });
  page.innerHTML; // → <p>From the server</p><p>Added</p>
  api.mount(page, { p: "Replaced" });
  page.innerHTML; // → <p>Replaced</p>
  ```

  - `render` adds what it draws after what the target holds already, so drawing twice into one
    target shows both layouts, the first still bound. `mount` replaces what the target holds (the
    server's markup, or what was drawn there before, whose components are disposed): it is how a
    page is drawn over the server's, and `hydrate` mounts.

    ```js dom
    const page = document.createElement("main");
    api.render(page, { p: "Milk" });
    api.render(page, { p: "Eggs" });
    page.innerHTML; // → <p>Milk</p><p>Eggs</p>
    api.mount(page, { p: "Bread" });
    page.innerHTML; // → <p>Bread</p>
    ```

  ```js
  const plain = new Juris();
  plain.api.renderToString({ p: "Your cart" });
  // throws TypeError: Juris.renderToString: rendering to a string is the kit's
  ```

  ```js dom
  api.setValue("cart.count", 0);
  const page = document.createElement("main");
  page.innerHTML = '<button class="buy">Buy</button>';
  const buy = page.querySelector(".buy");
  api.enhance(buy, {
      onclick: () => api.updateState("cart.count", (count) => count + 1),
  });
  buy.click();
  api.unenhance(buy);
  buy.click();
  api.getState("cart.count"); // → 1
  ```

- **Props.** `ref(path)` and `prop(value, default)`.

  ```js
  api.setValue("cart.count", 3);
  api.prop(5); // → 5
  api.prop(() => 7); // → 7
  api.prop(api.ref("cart.count")); // → 3
  api.prop(undefined, 0); // → 0
  ```

- `isServer`, and `markRender(flag)` for a plugin that must tell a page cache a render is volatile.

  ```js
  api.isServer; // → true
  ```

  ```js dom
  new Juris().api.isServer; // → false
  ```

  ```js
  juris.use((juris) => ({
      roll: () => {
          juris.markRender("random");
          return 1 + Math.floor(Math.random() * 6);
      },
  }));
  juris.registerComponent("Dice", (props, api) => ({ output: api.roll() }));
  juris.renderToString({ Dice: {} }, null, { trace: true });
  juris.renderTrace().flags; // → ["random"]
  ```

A plugin adds its own names, and the api takes each name once:

```js
juris.use(() => ({ greet: (name) => `Hello, ${name}` }));
juris.api.greet("Ada"); // → "Hello, Ada"
juris.use(() => ({ greet: (name) => `Hi, ${name}` }));
// throws Error: Juris.extendApi: the api already has "greet"
```

- the router: `router`, `route()`, `navigate(to, { replace })`, `back()`, `forward()`,
  `canBack()`, `canForward()`, `link(to)` and `isActive(to, { exact })`;

  ```js
  import { createRouter } from "juris/router.js";

  juris.use(createRouter({ routes: [{ path: "/orders/:id", name: "order" }] }));
  juris.setValue("$route.path", "/orders/7");
  juris.api.route().params; // → { id: "7" }
  juris.api.isActive("/orders"); // → true
  juris.api.isActive("/orders", { exact: true }); // → false
  juris.api.link("/orders/8").href; // → "/orders/8"
  ```

- the live client: `liveStatus()`;

  ```js
  import { sseClient } from "juris/remote-services.js";

  juris.use(sseClient());
  juris.api.liveStatus(); // → false
  ```

- `clock()`: `now()`;

  ```js
  import { clock } from "juris/clock.js";

  juris.use(clock(() => Date.UTC(2026, 0, 1)));
  new Date(juris.api.now()).toISOString(); // → "2026-01-01T00:00:00.000Z"
  ```

- `forms()`: `form(path, options)`.

  ```js
  import { forms } from "juris/forms.js";

  juris.use(forms());
  const signIn = juris.api.form("signIn", { fields: { email: "" } });
  signIn.set("email", "ada@example.com");
  signIn.values(); // → { email: "ada@example.com" }
  ```

### The Juris instance

The examples on this page each build the instance they show, from:

```js setup
import Juris, { sharedOptions } from "juris/juris.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";
```

An app on the kernel and the client boot never constructs one: `createJurisServer` and `hydrate`
each build the page's instance, and an app gives both the same `juris` options (see "What the
server and the browser are given alike").

```js
const juris = { allowTags: ["iframe"], allowInnerHTML: false };
sharedOptions(juris, "createJurisServer");
// → { allowTags: ["iframe"], allowInnerHTML: false }
sharedOptions({ devMode: true }, "hydrate");
// throws TypeError: hydrate: juris.devMode is not an option
```

The instance's options, for a test or a page that builds its own:

- `state`, `services`, `isServer` (true where there is no `document`), `requirePreload`

  ```js
  const shop = new Juris({
      state: { cart: { count: 2 } },
      services: { price: async (sku) => (sku === "milk" ? 3 : 5) },
  });
  shop.getState("cart.count"); // → 2
  await shop.api.call("price", "milk"); // → 3
  shop.isServer; // → true
  ```

  ```js
  const server = new Juris({
      services: { price: async () => 3 },
      requirePreload: true,
  });
  server.api.call("price", "milk");
  // throws Error: Juris.call: price:["milk"] was not preloaded for this request
  ```

- `exposeError`, `reportError(error, name, args)`

  ```js
  const logged = [];
  const shop = new Juris({
      services: {
          price: async () => {
              throw new Error("connection refused");
          },
      },
      reportError: (error, name, args) => {
          logged.push(`${name}(${args}): ${error.message}`);
      },
  });
  await shop.preload([["price", "milk"]]);
  // → { calls: { 'price:["milk"]': { $error: "request failed" } } }
  logged; // → ["price(milk): connection refused"]
  ```

  ```js
  const shop = new Juris({
      services: {
          price: async () => {
              throw new Error("Out of stock");
          },
      },
      exposeError: (error) => error.message === "Out of stock",
  });
  await shop.preload([["price", "milk"]]);
  // → { calls: { 'price:["milk"]': { $error: "Out of stock" } } }
  ```

- `privatePaths`, `ssrPath`, `localPath`, `asyncPath`

  ```js
  const juris = new Juris({
      state: { cart: { count: 2 }, session: { token: "s3cret" } },
      privatePaths: ["session"],
  });
  JSON.parse(juris.serializeState()); // → { cart: { count: 2 } }
  ```

  ```js
  const juris = new Juris({
      services: { cartCount: () => 2 },
      ssrPath: "$preloaded",
      features: { ssr: SSRRenderer },
  });
  const page = await juris.renderRequest({
      preload: [["cartCount"]],
      layout: { p: "Your cart" },
  });
  JSON.parse(page.json); // → { $preloaded: { calls: { "cartCount:[]": 2 } } }
  ```

- `pendingDelay` (200 ms before a pending value counts as slow), `callCache` (`{ dedupe, ttl }`,
  browser only)

  ```js
  new Juris({ callCache: { dedupe: true } });
  // throws Error: Juris: callCache is for a browser instance
  ```

  ```js dom
  let asked = 0;
  const browser = new Juris({
      services: { price: async () => (asked += 1) },
      callCache: { dedupe: true },
  });
  await Promise.all([
      browser.api.call("price", "milk"),
      browser.api.call("price", "milk"),
  ]);
  asked; // → 1
  ```

- `allowTags`, `allowSchemes`, `allowInnerHTML` (a boolean, `false` unless given; anything else
  refused with a `TypeError`), `unknownComponents`

  ```js
  new Juris({ allowInnerHTML: "false" });
  // throws TypeError: Juris: allowInnerHTML is true or false, not "false"
  ```

  ```js
  const juris = new Juris({
      allowSchemes: ["magnet"],
      features: { ssr: SSRRenderer },
  });
  juris.renderToString({
      a: { href: "magnet:?xt=urn:btih:c12f", textContent: "Download" },
  });
  // → <a href="magnet:?xt=urn:btih:c12f">Download</a>
  ```

  ```js
  const strict = new Juris({
      unknownComponents: "throw",
      features: { ssr: SSRRenderer },
  });
  strict.renderToString({ Sidebar: {} });
  // throws Error: Juris: "Sidebar" is not a registered component
  ```

- `components`, the components to register as the instance is built, in order, each as
  `registerComponent` would (after the built-ins, before the features). An object names each by
  its key, `{ Header, Footer }` or `{ "Cart": CartView }`:

  ```js
  const Header = () => ({ header: "Shop" });
  function CartView(props) {
      return { p: `${props.count} items` };
  }
  const juris = new Juris({
      components: { Header, "Cart": CartView },
      features: { ssr: SSRRenderer },
  });
  juris.renderToString({ Cart: { count: 2 } }); // → <p>2 items</p>
  juris.hasComponent("Header"); // → true
  ```

  - A list names each by its function's own name, `[Header, Footer]`, which the kit's minifier
    never renames, so the name in the source is the name in the browser.

    ```js
    function Header() {
        return { header: "Shop" };
    }
    const Footer = () => ({ footer: "© 2026" });
    const juris = new Juris({
        components: [Header, Footer],
        features: { ssr: SSRRenderer },
    });
    const page = { div: { children: [{ Header: {} }, { Footer: {} }] } };
    juris.renderToString(page);
    // → <div><header>Shop</header><footer>© 2026</footer></div>
    ```

  - In a list, a function with no name, or with one that is not a component's (a capitalised
    name, as a component's tag is: not `header`, which would be drawn in place of the element,
    nor an anonymous default export's `default`), is refused with a `TypeError` that says to name
    it or use the object form.

    ```js
    new Juris({ components: [(props) => ({ p: props.text })] });
    // throws TypeError: Juris: components[0] is a function with no name
    ```

    ```js
    const header = () => ({ header: "Shop" });
    new Juris({ components: [header] });
    // throws TypeError: Juris: components[0] is a function named "header"
    new Juris({ components: { header } }).hasComponent("header"); // → true
    ```

  - Anything else is refused with a `TypeError`: a value that is neither a plain object nor a
    list, and an entry of a list that is not a function.

    ```js
    const Header = () => ({ header: "Shop" });
    new Juris({ components: "Header" });
    // throws TypeError: Juris: components is an object of components by name
    new Juris({ components: new Map([["Header", Header]]) });
    // throws TypeError: Juris: components is an object of components by name
    new Juris({ components: [Header, "Footer"] });
    // throws TypeError: Juris: components[1] is "Footer", not a component
    ```

  - A name registered twice is refused as `registerComponent` refuses it, with an `Error`: twice in
    the list, a built-in's name, or a name the app registers again later.

    ```js
    const Header = () => ({ header: "Shop" });
    new Juris({ components: [Header, Header] });
    // throws Error: ComponentManager.registerComponent: "Header" is already
    new Juris({ components: { Await: Header } });
    // throws Error: ComponentManager.registerComponent: "Await" is already
    const juris = new Juris({ components: { Header } });
    juris.registerComponent("Header", Header);
    // throws Error: ComponentManager.registerComponent: "Header" is already
    ```

- `features` (classes that install themselves: `juris.js`), `devMode` and `onChange`.

  ```js
  const juris = new Juris({ features: { ssr: SSRRenderer } });
  juris.ssrRenderer instanceof SSRRenderer; // → true
  new Juris({ features: { ssr: "SSRRenderer" } });
  // throws TypeError: Juris: features.ssr is a class
  ```

  ```js dom
  const juris = new Juris({ devMode: true });
  // console.info: Juris: devMode is on, so this instance is exposed as
  //   window.$juris[1]
  window.$juris[1] === juris; // → true
  ```

  ```js
  const changed = [];
  const juris = new Juris({ onChange: (path) => changed.push(path) });
  juris.setValue("cart.count", 1);
  juris.setValue("cart.count", 2);
  changed; // → ["cart", "cart.count", "cart.count"]
  ```

What an app calls on an instance:

- `use(plugin, options)`, `extendApi(extension)`

  ```js
  const juris = new Juris();
  const money = (juris, { currency }) => ({ money: (n) => `${n} ${currency}` });
  juris.use(money, { currency: "€" });
  juris.api.money(3); // → "3 €"
  juris.extendApi({ greet: (name) => `Hello, ${name}` });
  juris.api.greet("Ada"); // → "Hello, Ada"
  ```

- `registerComponent`, `hasComponent`, `install`

  ```js
  const juris = new Juris();
  juris.hasComponent("Await"); // → true
  juris.hasComponent("Cart"); // → false
  juris.install("cart", (juris) => {
      juris.registerComponent("Cart", () => ({ p: "Your cart" }));
  });
  juris.hasComponent("Cart"); // → true
  ```

- `renderRequest`, `mount(target, layout, { release })`, `preload(entries)`, `serializeState()`,
  `callKey(name, args)`, `renderTrace()`, `api`

  ```js
  const juris = new Juris({
      services: { price: async (sku) => (sku === "milk" ? 3 : 5) },
      features: { ssr: SSRRenderer },
  });
  juris.registerComponent("Price", (props, api) => ({
      span: { textContent: () => api.call("price", props.sku) },
  }));
  const page = await juris.renderRequest({
      preload: [["price", "milk"]],
      state: { cart: { count: 2 } },
      layout: { Price: { sku: "milk" } },
  });
  page.html; // → <span>3</span>
  page.result("price", "milk"); // → 3
  JSON.parse(page.json);
  // → { cart: { count: 2 }, $ssr: { calls: { 'price:["milk"]': 3 } } }
  juris.callKey("price", ["milk"]); // → 'price:["milk"]'
  ```

  ```js
  const juris = new Juris({ features: { ssr: SSRRenderer } });
  juris.setValue("cart.count", 2);
  juris.renderToString(
      { p: { textContent: () => `${juris.getState("cart.count")} items` } },
      null,
      { trace: true },
  );
  juris.renderTrace();
  // → { reactive: 1, paths: ["cart.count"], roots: ["cart"],
  //     calls: [], services: [], live: [], flags: [], unknown: [],
  //     static: false }
  ```

  ```js dom
  const juris = new Juris({ services: { price: async () => 3 } });
  const { calls } = await juris.preload([["price", "milk"]]);
  juris.clearState({ $ssr: { calls } });
  const header = document.createElement("header");
  juris.mount(header, { p: "Cart" }, { release: false });
  juris.api.preloaded("price", "milk"); // → 3
  juris.mount(document.createElement("main"), { p: "Milk" });
  juris.api.preloaded("price", "milk"); // → undefined
  ```

- `refused(rule, reason, detail)` (both renderers', for what they leave out: "`juris.js`"), and

  ```js
  const juris = new Juris({ devMode: true, features: { ssr: SSRRenderer } });
  const refusals = [];
  juris.refused = (rule, reason, detail) => {
      refusals.push(`${detail.name}: ${reason}`);
  };
  juris.renderToString({ img: { src: "javascript:alert(1)" } }); // → <img>
  refusals; // → ['src: src refuses "javascript:alert(1)": scheme not allowed']
  ```

- in `devMode`, `componentTree()`, `findComponents(name)`, `onTreeChange(fn)` and, when it was given
  the devtools feature, `devtools` ("`devtools.js`").

  ```js dom
  const juris = new Juris({ devMode: true });
  juris.registerComponent("Cart", () => ({ p: "Your cart" }));
  juris.render(document.createElement("main"), { Cart: {} });
  juris.findComponents("Cart").length; // → 1
  juris.componentTree().map((node) => node.name); // → ["Cart"]
  ```

`renderRequest` and `renderToString` draw with the string renderer, which is the kit's: an instance
that renders to a string is built with `features: { ssr: SSRRenderer }` ("`server/ssr-renderer.js`"),
as `createJurisServer` builds its own, and one without it refuses both with a `TypeError` that says
so.

```js
const plain = new Juris();
plain.renderToString({ p: "Your cart" });
// throws TypeError: Juris.renderToString: rendering to a string is the kit's
await plain.renderRequest({ layout: { p: "Your cart" } });
// throws TypeError: Juris.renderRequest: rendering to a string is the kit's
```

`privatePaths` and `asyncPath` name roots of the state: a name with a `.` in it (or an empty one, or
a `privatePaths` that is not a list) is refused at construction with a `TypeError`.

```js
new Juris({ privatePaths: ["user.token"] });
// throws TypeError: Juris: privatePaths names roots of the state
new Juris({ asyncPath: "" });
// throws TypeError: Juris: asyncPath is a root of the state
new Juris({ privatePaths: "session" });
// throws TypeError: Juris: privatePaths is a list of the state's root names
```

A nested name used to match no root, so what it named was serialised into the page as if it had
never been given; nested private paths are refused, not supported.

### Modules a browser downloads

The package `juris`, flat: served as its files are on disk at `/src/`, and imported in Node
as `juris/<file>.js`.

```js
import Juris from "juris/juris.js";
import { fail } from "juris/errors.js";
import { createRouter } from "juris/router.js";

typeof Juris; // → "function"
typeof fail; // → "function"
typeof createRouter; // → "function"
```

```html
<script type="module">
  import Juris from "/src/juris.js";
  import { createRouter } from "/src/router.js";
</script>
```

#### `juris.js`

**Exports:** `Juris` (default), `FallbackSignal`, `BUILTIN_COMPONENTS`, `SHARED_OPTIONS`,
`sharedOptions`.

```js
import Juris, {
    FallbackSignal, BUILTIN_COMPONENTS, SHARED_OPTIONS, sharedOptions,
} from "juris/juris.js";

typeof Juris; // → "function"
typeof sharedOptions; // → "function"
FallbackSignal.prototype instanceof Error; // → true
BUILTIN_COMPONENTS; // → ["Await"]
SHARED_OPTIONS;
// → ["allowTags", "allowSchemes", "allowInnerHTML", "components"]
```

The examples below each build the instance they show, from:

```js setup
import Juris from "juris/juris.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";
```

The core: components, state, `call` and `live`, plugins (`use`, `extendApi`), `renderRequest`,
`mount`. `BUILTIN_COMPONENTS` names the components every instance registers (`Await`), and
`FallbackSignal` is re-exported from `errors.js`. Its `callKey` is the live protocol's `liveKey`.

```js
import { BUILTIN_COMPONENTS, FallbackSignal } from "juris/juris.js";
import * as errors from "juris/errors.js";

const juris = new Juris();
BUILTIN_COMPONENTS.map((name) => juris.hasComponent(name)); // → [true]
FallbackSignal === errors.FallbackSignal; // → true
```

```js
import { liveKey } from "juris/live-protocol.js";

const juris = new Juris();
juris.callKey("price", ["milk", 2]); // → 'price:["milk",2]'
liveKey("price", ["milk", 2]); // → 'price:["milk",2]'
```

`features` in the options (`{ features: { headless: HeadlessManager } }`) names classes constructed
with `(juris, config)` once the instance is whole, each installing itself: how `headless.js` and
`webcomponent.js` are given to an instance as they were in 0.91, and how a server instance is given
the kit's string renderer (`features: { ssr: SSRRenderer }`, below). A feature that is not a class
is refused.

```js
class CartBadge {
    constructor(juris, config) {
        const count = config.state.cart.count;
        juris.registerComponent("CartBadge", () => ({
            span: `${count} in cart`,
        }));
    }
}
const juris = new Juris({
    state: { cart: { count: 2 } },
    features: { ssr: SSRRenderer, badge: CartBadge },
});
juris.renderToString({ CartBadge: {} }); // → <span>2 in cart</span>
```

```js
import { HeadlessManager } from "juris/headless.js";

const Cart = (props, context) => ({
    api: { count: () => context.getState("cart.count", 0) },
});
const juris = new Juris({
    state: { cart: { count: 3 } },
    features: { headless: HeadlessManager },
    headlessComponents: { cart: { fn: Cart, options: { autoInit: true } } },
});
juris.api.cart.count(); // → 3
```

```js
new Juris({ features: { ssr: "ssr-renderer.js" } });
// throws TypeError: Juris: features.ssr is a class
```

- **Rendering to a string** is the kit's. `juris.js` imports no string renderer and constructs
  none, so no page downloads one. `renderToString`, `renderRequest`, `renderTrace`, `markRender` and
  `api.renderToString` are the core's all the same, and draw through the instance's `ssrRenderer`,
  which `server/ssr-renderer.js` installs when it is given as `features.ssr`.

  ```js
  const juris = new Juris({ features: { ssr: SSRRenderer } });
  juris.ssrRenderer instanceof SSRRenderer; // → true
  juris.api.renderToString({ p: "Cart" }); // → <p>Cart</p>
  ```

  - Without it `renderToString` (and `api.renderToString`) throws a `TypeError` that names the fix
    (`Juris.renderToString: rendering to a string is the kit's: features: { ssr: SSRRenderer }, from
    juris-kit/server/ssr-renderer.js`), and so does `renderRequest`, before it preloads
    anything;

    ```js
    const plain = new Juris();
    plain.api.renderToString({ p: "Your cart" });
    // throws TypeError: Juris.renderToString: rendering to a string is the
    //   kit's: features: { ssr: SSRRenderer }, from
    //   juris-kit/server/ssr-renderer.js
    ```

    ```js
    let asked = 0;
    const plain = new Juris({ services: { cart: () => (asked += 1) } });
    await plain.renderRequest({ preload: [["cart"]], layout: { p: "Cart" } });
    // throws TypeError: Juris.renderRequest: rendering to a string is the kit's
    asked; // → 0
    ```

  - `markRender` does nothing, `renderTrace()` is `null`, and the calls, reads, live queries
    and unknown components a traced render would record are recorded nowhere.

    ```js
    const plain = new Juris({ services: { price: () => 3 } });
    plain.markRender("random");
    await plain.api.call("price", "milk"); // → 3
    plain.renderTrace(); // → null
    ```

  - Nothing else in the core reaches for the renderer, on a server or in a browser.
    `tests/boundary.test.mjs` holds that no module `juris.js` imports statically is a string
    renderer.

    ```js dom
    const juris = new Juris();
    const page = document.createElement("main");
    juris.render(page, { p: "Drawn without a string renderer" });
    page.innerHTML; // → <p>Drawn without a string renderer</p>
    juris.ssrRenderer; // → null
    ```

    ```js
    const server = new Juris({ state: { cart: { count: 2 } } });
    server.isServer; // → true
    server.serializeState(); // → '{"cart":{"count":2}}'
    ```

- **Preloaded answers** are read through two accessors, never by their place in the state (`$ssr`,
  where they travel to the browser) or their keys.

  ```js
  const juris = new Juris({
      services: { product: (sku) => ({ sku, title: "Milk" }) },
      features: { ssr: SSRRenderer },
  });
  juris.registerComponent("ProductPage", (props, api) => ({
      h1: api.preloaded("product", props.sku)?.title,
  }));
  const page = await juris.renderRequest({
      preload: [["product", "milk"]],
      layout: { ProductPage: { sku: "milk" } },
  });
  page.html; // → <h1>Milk</h1>
  page.result("product", "milk").title; // → "Milk"
  ```

  - `renderRequest` answers `{ html, json, result, cache }` (and `trace` when asked:
    `renderTrace()`'s, with `failed`, each service whose preloaded call failed), and
    `result(name, ...args)` is what that call answered in this render (`null` included), or
    `undefined` when it was not preloaded or failed, whatever the instance renders next: a server
    reads the page's status and title from it.

    ```js
    const juris = new Juris({
        services: { product: (sku) => (sku === "milk" ? { title: "Milk" } : null) },
        features: { ssr: SSRRenderer },
    });
    const page = await juris.renderRequest({
        preload: [["product", "milk"], ["product", "kale"]],
        layout: { p: "Products" },
    });
    Object.keys(page); // → ["html", "json", "result", "cache"]
    page.result("product", "milk"); // → { title: "Milk" }
    page.result("product", "kale"); // → null
    page.result("product", "eggs"); // → undefined
    ```

    ```js
    const juris = new Juris({
        services: {
            product: () => {
                throw new Error("connection refused");
            },
        },
        features: { ssr: SSRRenderer },
    });
    const page = await juris.renderRequest({
        preload: [["product", "milk"]],
        layout: { p: "Milk" },
        trace: true,
    });
    page.result("product", "milk"); // → undefined
    page.trace.failed; // → ["product"]
    const status = page.result("product", "milk") ? 200 : 404; // → 404
    ```

    ```js
    const juris = new Juris({
        services: { product: (sku) => ({ title: sku }) },
        features: { ssr: SSRRenderer },
    });
    const milk = await juris.renderRequest({
        preload: [["product", "milk"]],
        layout: { p: "Milk" },
    });
    await juris.renderRequest({
        preload: [["product", "eggs"]],
        layout: { p: "Eggs" },
    });
    milk.result("product", "milk"); // → { title: "milk" }
    ```

  - `api.preloaded(name, ...args)` is the same answer to a component, in a server render and in the
    browser's first render, for one that must show what another on the page will load before that
    one has written it.

    ```js
    const juris = new Juris({
        services: { cart: () => ({ count: 2 }) },
        features: { ssr: SSRRenderer },
    });
    juris.registerComponent("Header", (props, api) => ({
        p: `Cart (${api.preloaded("cart")?.count ?? 0})`,
    }));
    const page = await juris.renderRequest({
        preload: [["cart"]],
        layout: { Header: {} },
    });
    page.html; // → <p>Cart (2)</p>
    ```

  - It is a read, not a call: no service is reached, `requirePreload` has nothing to refuse, and
    nothing is subscribed, so it runs nothing again when the transfer is released after the first
    mount, and answers `undefined` from then on. In a traced render a preloaded call it read is in
    the trace's `calls`.

    ```js
    let asked = 0;
    const juris = new Juris({
        services: { cart: () => (asked += 1) },
        requirePreload: true,
    });
    juris.api.preloaded("cart"); // → undefined
    asked; // → 0
    juris.api.call("cart");
    // throws Error: Juris.call: cart:[] was not preloaded for this request
    ```

    ```js
    const juris = new Juris({
        services: { cart: () => ({ count: 2 }) },
        features: { ssr: SSRRenderer },
    });
    juris.registerComponent("Header", (props, api) => ({
        p: `Cart (${api.preloaded("cart")?.count ?? 0})`,
    }));
    const page = await juris.renderRequest({
        preload: [["cart"]],
        layout: { Header: {} },
        trace: true,
    });
    page.trace.calls; // → ["cart:[]"]
    ```

    ```js dom
    const juris = new Juris({ services: { cart: () => ({ count: 2 }) } });
    juris.clearState({ $ssr: await juris.preload([["cart"]]) });
    juris.registerComponent("Header", (props, api) => ({
        p: { textContent: () => `Cart (${api.preloaded("cart")?.count})` },
    }));
    const page = document.createElement("header");
    juris.mount(page, { Header: {} });
    page.innerHTML; // → <p>Cart (2)</p>
    juris.api.preloaded("cart"); // → undefined
    ```

  - `cache`, the calls as the preload keeps them, is returned for one more release.

    ```js
    const juris = new Juris({
        services: { cart: () => ({ count: 2 }) },
        features: { ssr: SSRRenderer },
    });
    const page = await juris.renderRequest({
        preload: [["cart"]],
        layout: { p: "Cart" },
    });
    page.cache; // → { calls: { "cart:[]": { count: 2 } } }
    ```

  - Each answer is kept as the page carries it, a JSON round trip, so a component that writes under
    a preloaded answer during a render writes into the request's copy, never into the object the
    service answered (which a service that caches, master data, hands every request).

    ```js
    const units = { kg: "Kilogram", l: "Litre" };
    const juris = new Juris({
        services: { units: () => units },
        features: { ssr: SSRRenderer },
    });
    juris.registerComponent("Units", (props, api) => {
        api.call("units").then((all) => {
            all.box = "Box";
        });
        return { p: "Units" };
    });
    const page = await juris.renderRequest({
        preload: [["units"]],
        layout: { Units: {} },
    });
    page.result("units"); // → { kg: "Kilogram", l: "Litre", box: "Box" }
    units; // → { kg: "Kilogram", l: "Litre" }
    ```

    ```js
    const juris = new Juris({
        services: { order: () => ({ placed: new Date(Date.UTC(2026, 0, 1)) }) },
        features: { ssr: SSRRenderer },
    });
    const page = await juris.renderRequest({
        preload: [["order", 7]],
        layout: { p: "Order 7" },
    });
    page.result("order", 7); // → { placed: "2026-01-01T00:00:00.000Z" }
    ```

    - An answer JSON cannot carry (a cycle, a `BigInt`) is recorded as that call's failure.

      ```js
      const juris = new Juris({
          services: { stock: () => ({ milk: 12n }) },
          features: { ssr: SSRRenderer },
      });
      const page = await juris.renderRequest({
          preload: [["stock"]],
          layout: { p: "Stock" },
          trace: true,
      });
      page.result("stock"); // → undefined
      page.trace.failed; // → ["stock"]
      ```

  - `renderRequest` copies the plain objects and arrays of the `state` it is given, for the same
    reason (other values, a `Date` or a class instance under `$server`, are kept as they are).

    ```js
    const settings = { theme: "light" };
    const now = new Date(Date.UTC(2026, 0, 1));
    const juris = new Juris({ features: { ssr: SSRRenderer } });
    juris.registerComponent("Page", (props, api) => {
        api.setValue("settings.theme", "dark");
        return { p: String(api.getState("$server.now") === now) };
    });
    const page = await juris.renderRequest({
        state: { settings, $server: { now } },
        layout: { Page: {} },
    });
    page.html; // → <p>true</p>
    settings; // → { theme: "light" }
    ```

- **Live status.** `api.liveState(path)` and `api.liveMessage(path)` ("The component api") read
  where the live client keeps a path's status (`$live.paths`) or, without one, where the core keeps
  it (`$async.live`).

  ```js
  const juris = new Juris({ services: { stock: async () => 12 } });
  juris.api.live("stock.milk", "stock", "milk");
  juris.getState("$async.live"); // → { "stock%2Emilk": { status: "pending" } }
  await new Promise((resolve) => setTimeout(resolve));
  juris.api.liveState("stock.milk"); // → "live"
  juris.getState("stock.milk"); // → 12
  ```

  ```js
  import { sseClient } from "juris/remote-services.js";

  const juris = new Juris({ services: { stock: async () => 12 } });
  juris.use(sseClient({ EventSourceImpl: class { addEventListener() {} } }));
  juris.api.live("stock.milk", "stock", "milk");
  juris.getState("$live.paths"); // → { "stock%2Emilk": { status: "pending" } }
  juris.api.liveState("stock.milk"); // → "pending"
  ```

  - Without a live client (a server, or a browser booted with `live: false`) `live()` is one call
    whose answer is assigned; only the latest call at a path writes it, so an older answer that
    arrives late (the arguments moved, or on a server it belongs to a request already rendered) is
    dropped rather than assigned over the newer one.

    ```js
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const juris = new Juris({
        services: {
            orders: async (week) => {
                await wait(week === 1 ? 20 : 5);
                return `orders of week ${week}`;
            },
        },
    });
    juris.api.live("orders", "orders", 1);
    juris.api.live("orders", "orders", 2);
    await wait(30);
    juris.getState("orders"); // → "orders of week 2"
    ```

  - A service that answers synchronously is taken too.

    ```js
    const juris = new Juris({ services: { cartCount: () => 2 } });
    juris.api.live("cart.count", "cartCount");
    juris.getState("cart.count"); // → 2
    juris.api.liveState("cart.count"); // → "live"
    ```

- **Registering once.** `hasComponent(name)` says whether a component is registered on the
  instance (the built-ins included).

  ```js
  const juris = new Juris();
  juris.hasComponent("Await"); // → true
  juris.hasComponent("CartPage"); // → false
  ```

  - `install(key, registrar)` runs `registrar(juris)` the first time the instance is given `key`, a
    non-empty string, and does nothing for that key again, answering `true` when it ran and `false`
    when it had already: `registerComponent` refuses a name it already has, so a module whose
    components several pages draw registers them once, and the instance keeps the "once".

    ```js
    const juris = new Juris();
    const registerCart = (juris) => {
        juris.registerComponent("CartLine", (props) => ({ li: props.title }));
    };
    juris.install("shop/cart", registerCart); // → true
    juris.install("shop/cart", registerCart); // → false
    juris.install("", registerCart);
    // throws TypeError: Juris.install: key must be a non-empty string
    ```

  - The key is a name the module gives itself, never the function, because the same module loaded
    under two addresses is two modules with two functions.

    ```js
    const juris = new Juris();
    const footer = () => ({ footer: "© Shop" });
    // One module loaded from two addresses: two registrars, one key.
    const fromApp = (juris) => juris.registerComponent("Footer", footer);
    const fromCdn = (juris) => juris.registerComponent("Footer", footer);
    juris.install("shop/footer", fromApp); // → true
    juris.install("shop/footer", fromCdn); // → false
    ```

  - A registrar may install others, and one that reaches its own key while it is still running is
    not run again; one that throws is remembered, and its error is thrown again to every later
    caller for that key, so a half-registered module never looks done.

    ```js
    const juris = new Juris();
    const runs = [];
    const registerShop = (juris) => {
        runs.push("shop");
        juris.install("shop/cart", (juris) => {
            runs.push("cart");
            juris.install("shop", registerShop);
        });
    };
    juris.install("shop", registerShop); // → true
    runs; // → ["shop", "cart"]
    ```

    ```js
    const juris = new Juris();
    const broken = () => {
        throw new Error("checkout.js failed to load");
    };
    juris.install("shop/checkout", broken);
    // throws Error: checkout.js failed to load
    juris.install("shop/checkout", () => {});
    // throws Error: checkout.js failed to load
    ```

- **Unknown components.** A capitalised tag names a component, and when none is registered under
  it both renderers ask the core (`unknownComponent`) before drawing it. The `unknownComponents`
  option says what then: `"element"` (the default) draws an element of that name, as a browser does
  with a tag it does not know; `"warn"` also says so on the console, once per name; `"throw"`
  refuses to draw it (an error like any other, which a boundary may catch; tests use it).

  ```js
  const juris = new Juris({ features: { ssr: SSRRenderer } });
  juris.renderToString({ Sidebar: { textContent: "Filters" } });
  // → <Sidebar>Filters</Sidebar>
  ```

  ```js
  const juris = new Juris({
      unknownComponents: "warn",
      features: { ssr: SSRRenderer },
  });
  juris.renderToString({ Sidebar: {} });
  // console.warn: Juris: "Sidebar" is not a registered component; rendering it
  //   as an HTML element
  ```

  ```js
  const juris = new Juris({
      unknownComponents: "throw",
      features: { ssr: SSRRenderer },
  });
  juris.renderToString({ Sidebar: {} });
  // throws Error: Juris: "Sidebar" is not a registered component
  juris.registerComponent("Panel", (props, api) => {
      api.onError(() => ({ p: "Filters unavailable" }));
      return { section: { children: [{ Sidebar: {} }] } };
  });
  juris.renderToString({ Panel: {} }); // → <p>Filters unavailable</p>
  ```

  - Whichever it is, a traced server render lists the name in its trace's `unknown`, and
    `page-cache.js` never keeps such a page.

    ```js
    const juris = new Juris({ features: { ssr: SSRRenderer } });
    juris.renderToString({ Sidebar: {} }, null, { trace: true });
    juris.renderTrace().unknown; // → ["Sidebar"]
    ```

  - A capitalised tag both renderers refuse as an element (`Portal`, `Script`: `html-safety.js`) is
    unknown too, and is still not drawn: its warning says nothing is drawn for it, unless
    `allowTags` lets it be drawn.

    ```js
    const juris = new Juris({
        unknownComponents: "warn",
        features: { ssr: SSRRenderer },
    });
    juris.renderToString({ div: { children: [{ Portal: {} }] } }); // → <div></div>
    // console.warn: Juris: "Portal" is not a registered component, nor a tag a
    //   layout may draw; nothing is drawn for it
    ```

    ```js
    const juris = new Juris({
        allowTags: ["portal"],
        features: { ssr: SSRRenderer },
    });
    juris.renderToString({ Portal: {} }); // → <Portal></Portal>
    ```

  - Lower-case tags, and any tag inside `<svg>` or `<math>` (namespaces that name their own
    elements), are elements, never unknown; inside `<foreignObject>` and the other places HTML is
    drawn again (the `svg` and `math` bullet above) the children are HTML, and so is the rule.

    ```js
    const juris = new Juris({ features: { ssr: SSRRenderer } });
    juris.renderToString(
        { svg: { children: [{ linearGradient: { id: "sky" } }] } },
        null,
        { trace: true },
    );
    juris.renderTrace().unknown; // → []
    ```

    ```js
    const juris = new Juris({ features: { ssr: SSRRenderer } });
    const card = { foreignObject: { children: [{ Sidebar: {} }] } };
    juris.renderToString({ svg: { children: [card] } }, null, { trace: true });
    juris.renderTrace().unknown; // → ["Sidebar"]
    ```

- **Refusals.** `refused(rule, reason, detail)` is what both renderers call, inside their `devMode`
  checks, for each thing they leave out of a page: `rule` is a code a program matches
  (`"layout-in-value"`, or the one `html-safety.js` answers beside its reason, which it does not yet:
  "Not yet"), `reason` the words, and `detail` `{ name, value, node, component }` (the tag, attribute
  or style key, the value refused, the node it was on in the DOM renderer, the component whose layout
  it was in).

  ```js
  const juris = new Juris({ devMode: true, features: { ssr: SSRRenderer } });
  const kept = [];
  juris.refused = (rule, reason, { name, component }) => {
      kept.push({ rule, name, component: component.name });
  };
  juris.registerComponent("Price", () => ({
      span: { textContent: () => ({ b: "3 €" }) },
  }));
  juris.renderToString({ Price: {} }); // → <span></span>
  kept;
  // → [{ rule: "layout-in-value", name: "textContent", component: "Price" }]
  ```

  ```js dom
  const juris = new Juris({ devMode: true });
  const kept = [];
  juris.refused = (rule, reason, { name, node }) => {
      kept.push({ rule, name, node: node.localName });
  };
  juris.render(document.createElement("main"), {
      a: { href: "javascript:alert(1)", textContent: "Home" },
  });
  kept; // → [{ rule: undefined, name: "href", node: "a" }]
  ```

  - It writes the console line the renderers wrote before it: `Juris: dropped <reason>`, or, for an
    object given where text goes (a layout, a list, or any other object), `Juris: <reason>;
    ignored` with the value.

    ```js
    const juris = new Juris({ devMode: true, features: { ssr: SSRRenderer } });
    juris.renderToString({ img: { src: "javascript:alert(1)" } }); // → <img>
    // console.warn: Juris: dropped src refuses "javascript:alert(1)": scheme not
    //   allowed
    juris.renderToString({ p: { textContent: () => ({ b: "Hi" }) } }); // → <p></p>
    // console.warn: Juris: "textContent" was given an object, and takes text (a
    //   string or a number; a layout goes in children); ignored
    juris.renderToString({ div: { "data-cart": { items: 2 } } }); // → <div></div>
    // console.warn: Juris: "data-cart" was given an object, and takes text
    ```

  - A devtools feature may replace it on its own instance to keep a record too (phase 2).

    ```js
    const juris = new Juris({ devMode: true, features: { ssr: SSRRenderer } });
    const record = [];
    const toConsole = juris.refused.bind(juris);
    juris.refused = (rule, reason, detail) => {
        record.push(reason);
        toConsole(rule, reason, detail);
    };
    juris.renderToString({ a: { onmouseover: "track()", textContent: "Home" } });
    // console.warn: Juris: dropped attribute name "onmouseover" is not allowed
    record; // → ['attribute name "onmouseover" is not allowed']
    ```

- **devMode on `window`.** A browser instance in `devMode` is `window.$juris[n]`, for the console. A
  second copy of the core in the page (two builds) counts from 1 as well, so an index another copy
  took is skipped and neither puts its instance over the other's; the devtools registry names each
  instance by its index.

  ```js dom
  const shop = new Juris({ devMode: true });
  const admin = new Juris({ devMode: true });
  window.$juris[1] === shop; // → true
  window.$juris[2] === admin; // → true
  ```

  ```js dom
  const fromOtherBuild = { name: "the other copy's instance" };
  window.$juris = { 1: fromOtherBuild };
  const juris = new Juris({ devMode: true });
  // console.info: Juris: devMode is on, so this instance is exposed as
  //   window.$juris[2]
  window.$juris[1] === fromOtherBuild; // → true
  ```

- **Options both sides share.** `SHARED_OPTIONS` names the options an app gives its instance
  through the kernel and the client boot, which build it themselves (`allowTags`, `allowSchemes`,
  `allowInnerHTML`, `components`),
  and `sharedOptions(value, where)` checks such an object for either side and answers what to hand
  the instance ("What the server and the browser are given alike").

  ```js
  import { SHARED_OPTIONS, sharedOptions } from "juris/juris.js";

  SHARED_OPTIONS;
  // → ["allowTags", "allowSchemes", "allowInnerHTML", "components"]
  const shared = { allowTags: ["iframe"], allowSchemes: undefined };
  sharedOptions(shared, "hydrate"); // → { allowTags: ["iframe"] }
  sharedOptions(undefined, "hydrate"); // → {}
  ```

  ```js
  import { sharedOptions } from "juris/juris.js";

  sharedOptions({ allowSchemes: ["javascript"] }, "createJurisServer");
  // throws TypeError: Juris: allowSchemes: javascript: runs code in the page
  sharedOptions({ requirePreload: true }, "createJurisServer");
  // throws TypeError: createJurisServer: juris.requirePreload is not an option
  ```

#### `errors.js`

**Exports:** `FallbackSignal`, `ServiceError`, `fail`, `defaultExposeError`, `mayExpose`,
`publicMessage`.

The examples on this page import them all, and the core:

```js setup
import {
    FallbackSignal, ServiceError, fail,
    defaultExposeError, mayExpose, publicMessage,
} from "juris/errors.js";
import Juris from "juris/juris.js";
```

The framework's error classes, in a module that imports nothing, so every other module can import
them without importing each other.

```js
import { readFile } from "node:fs/promises";

const file = new URL(import.meta.resolve("juris/errors.js"));
const source = await readFile(file, "utf8");
/^import\b/m.test(source); // → false
```

- `FallbackSignal` is thrown through a component tree when an error boundary still rendering wants
  its fallback drawn: the core throws it and both renderers catch it, by `instanceof`, so all three
  import this one class.

  ```js
  const signal = new FallbackSignal(
      { name: "ProductCard" },
      { p: "Price unavailable" },
      new Error("no price for eggs"),
  );
  signal.message; // → 'Juris: fallback for "ProductCard"'
  signal.layout; // → { p: "Price unavailable" }
  signal.cause.message; // → "no price for eggs"
  ```

  ```js dom
  const juris = new Juris();
  const noPrice = () => {
      throw new Error("no price for eggs");
  };
  juris.registerComponent("Price", () => ({ span: { textContent: noPrice } }));
  juris.registerComponent("ProductCard", (props, api) => {
      api.onError(() => ({ p: "Price unavailable" }));
      return { article: { children: [{ Price: {} }] } };
  });
  const page = document.createElement("main");
  juris.render(page, { ProductCard: {} });
  page.innerHTML; // → <p>Price unavailable</p>
  ```

- `ServiceError(message, { status = 400, fields, field, code })` is a refusal written for the
  person who reads it. It sets `expose`, which the default `exposeError` reads, keeps a singular
  `field` and folds it into `fields` (unless `fields` already says something for it), and has
  `fields` and `code` only when given.

  ```js
  const error = new ServiceError("Give the post a title.", { field: "title" });
  error.status; // → 400
  error.expose; // → true
  error.field; // → "title"
  error.fields; // → { title: "Give the post a title." }
  "code" in error; // → false
  ```

  ```js
  const fields = { title: "Too long.", body: "Write something." };
  const error = new ServiceError("Check the post.", {
      status: 422,
      field: "title",
      fields,
      code: "post.invalid",
  });
  error.fields; // → { title: "Too long.", body: "Write something." }
  error.code; // → "post.invalid"
  ```

  - `fail(message, options)` throws one.

    ```js
    function savePost(post) {
        if (!post.title) {
            fail("Give the post a title.", { field: "title" });
        }
        return { id: 7 };
    }
    savePost({ title: "" });
    // throws ServiceError: Give the post a title.
    ```

  - The browser's stubs throw one too, so a caller reads the same shape on either side.

    ```js
    import { remoteServices } from "juris/remote-services.js";

    const answer = { error: "Give the post a title.", field: "title" };
    const { savePost } = remoteServices(["savePost"], {
        fetch: async () => Response.json(answer, { status: 400 }),
    });
    const error = await savePost({ title: "" }).catch((error) => error);
    error instanceof ServiceError; // → true
    error.fields; // → { title: "Give the post a title." }
    ```

- `defaultExposeError(error)` is the rule a caller's reading is judged by when an app gives none,
  `error.expose === true`, and the default of the dispatcher's, the kernel's and the core's
  `exposeError`.

  ```js
  defaultExposeError(new ServiceError("Out of stock.")); // → true
  defaultExposeError(new Error('relation "orders" does not exist')); // → false
  const busy = Object.assign(new Error("Busy."), { expose: "yes" });
  defaultExposeError(busy); // → false
  ```

  - `mayExpose(error, exposeError = defaultExposeError)` says whether a rule lets a caller read an
    error's words; a rule that throws or answers anything but `true` says no.

    ```js
    const stockOnly = (error) => error.message.startsWith("Out of stock");
    mayExpose(new Error("Out of stock: milk"), stockOnly); // → true
    mayExpose(new Error("Out of stock: milk"), () => "yes"); // → false
    const broken = (error) => error.detail.public;
    mayExpose(new Error("Out of stock: milk"), broken); // → false
    ```

  - `publicMessage(error, exposeError, fallback = "request failed")` is those words, or `fallback`.

    ```js
    publicMessage(new ServiceError("Out of stock.")); // → "Out of stock."
    publicMessage(new Error("connect ECONNREFUSED 10.0.0.5:5432"));
    // → "request failed"
    publicMessage(new Error("timeout"), undefined, "Try again later.");
    // → "Try again later."
    ```

  - The dispatcher (a refusal, a live query's failed re-run) and the core (a failed preload, a
    server's async error logs) both read a failure through these two.

    ```js
    const juris = new Juris({
        services: {
            stock: () => fail("Out of stock."),
            price: () => {
                throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
            },
        },
    });
    await juris.preload([["stock"], ["price"]]);
    // → { calls: { "stock:[]": { $error: "Out of stock." },
    //              "price:[]": { $error: "request failed" } } }
    ```

#### `live-protocol.js`

**Exports:** `liveKey`, `canAddress`, `diff`, `LIVE_CODES`, `CALL_KIND`, `CALL_KINDS`, `callKind`,
`internal`.

The examples on this page import them all, and the core:

```js setup
import {
    liveKey, canAddress, diff, LIVE_CODES,
    CALL_KIND, CALL_KINDS, callKind, internal,
} from "juris/live-protocol.js";
import Juris from "juris/juris.js";
```

What both ends of a live query must compute identically, defined once in a module that imports
nothing.

```js
import * as remote from "juris/remote-services.js";

remote.diff === diff; // → true
new Juris().callKey("stock", ["milk"]) === liveKey("stock", ["milk"]); // → true
```

- `liveKey(name, args)` is a call's key, `name:JSON(args)`. It names a preloaded call, a browser's
  subscription and the server's group, and the server refuses a subscribe whose key is not the one
  it computes, so its output never changes: one byte of difference between two builds is a refused
  subscribe from every open tab during a deploy.

  ```js
  liveKey("orders", [{ status: "open" }, 2]); // → 'orders:[{"status":"open"},2]'
  liveKey("cartCount", []); // → "cartCount:[]"
  ```

  ```js
  const open = liveKey("orders", [{ status: "open", page: 2 }]);
  const same = liveKey("orders", [{ page: 2, status: "open" }]);
  open === same; // → false
  ```

- `canAddress(value)` says whether every own key of an object can be one segment of a state path
  (no `.`, no `__proto__`, and not the empty key, whose path would be its parent's: at the top, a
  patch for it replaced or deleted the whole result); an object that fails it is sent by `diff` and
  written by `assign` whole.

  ```js
  canAddress({ title: "Milk", price: 3 }); // → true
  canAddress({ "unit.price": 3 }); // → false
  canAddress({ "": "untitled" }); // → false
  canAddress(JSON.parse('{ "__proto__": { "admin": true } }')); // → false
  canAddress(["Milk", "Eggs"]); // → true
  ```

  ```js
  diff({ row: { "unit.price": 3 } }, { row: { "unit.price": 4 } });
  // → { set: [["row", { "unit.price": 4 }]], del: [] }
  ```

  ```js
  const juris = new Juris({ state: { row: { "unit.price": 3 } } });
  juris.assign("row", { "unit.price": 4 });
  juris.getState("row"); // → { "unit.price": 4 }
  ```

  - `diff(previous, next)` is the leaf patch the server sends; a key is deleted when `next` has no
    own key by that name, so a removed field named `constructor` or `toString` is deleted like any
    other.

    ```js
    diff({ title: "Milk", price: 3 }, { title: "Milk", price: 4 });
    // → { set: [["price", 4]], del: [] }
    diff({ title: "Milk", note: "fresh" }, { title: "Milk" });
    // → { set: [], del: ["note"] }
    diff({ title: "Milk" }, { title: "Milk" }); // → { set: [], del: [] }
    ```

    ```js
    diff({ title: "Milk", constructor: "Acme" }, { title: "Milk" });
    // → { set: [], del: ["constructor"] }
    diff(["Milk"], ["Milk", "Eggs"]);
    // → { set: [["", ["Milk", "Eggs"]]], del: [] }
    ```

- `CALL_KIND`, `CALL_KINDS`, `callKind(thisValue)` and `internal(reason)` are what a service is told
  about who is calling ("Who is calling", below).

  ```js
  CALL_KINDS; // → ["direct", "preload", "live", "render", "internal"]
  callKind(undefined); // → "direct"
  callKind({ [CALL_KIND]: "preload" }); // → "preload"
  callKind({ [CALL_KIND]: "admin" }); // → "direct"
  ```

  ```js
  function stock(sku) {
      return `${callKind(this)}: ${sku}`;
  }
  const juris = new Juris({ services: { stock } });
  await juris.preload([["stock", "milk"]]);
  // → { calls: { 'stock:["milk"]': "preload: milk" } }
  await juris.api.call("stock", "eggs"); // → "render: eggs"
  stock.call(internal("nightly stock count"), "kale"); // → "internal: kale"
  ```

  ```js
  const job = internal("nightly stock count");
  job.reason; // → "nightly stock count"
  Object.isFrozen(job); // → true
  internal("");
  // throws TypeError: internal(reason): say what the call is for
  ```

- `LIVE_CODES` names the codes the live layer's refusals carry beside their words, which a program
  matches where the words may change: `CLIENT_UNKNOWN` (`live.client-unknown`, 403: a client id
  the server never minted, or minted for another owner, so the answer is a new stream) and
  `NOT_A_QUERY` (`live.not-a-query`). They are wire names and never change.

  ```js
  LIVE_CODES;
  // → { CLIENT_UNKNOWN: "live.client-unknown", NOT_A_QUERY: "live.not-a-query" }
  Object.isFrozen(LIVE_CODES); // → true
  ```

  ```js
  const answer = { error: "Unknown client id.", code: "live.client-unknown" };
  const stale = answer.code === LIVE_CODES.CLIENT_UNKNOWN; // → true
  ```

#### `state-manager.js`

**Exports:** `StateManager` (default), `settled`, `settledError`, `isSettled`, `pathSegment`,
`MAX_ERROR_LOG`.

The examples on this page import them all, and the core:

```js setup
import StateManager, {
    settled, settledError, isSettled, pathSegment, MAX_ERROR_LOG,
} from "juris/state-manager.js";
import Juris from "juris/juris.js";
```

The reactive state tree, path subscriptions and settled async values. `Juris` constructs its
`StateManager`, and an app reaches it through the component api.

```js
const juris = new Juris({ state: { cart: { count: 2 } } });
juris.stateManager instanceof StateManager; // → true
juris.api.getState("cart.count"); // → 2
```

`settled(value)` and `settledError(error)` are values shaped like a promise (`then`, `catch`,
`finally`) that are already resolved or rejected and run their callbacks at once, which is what a
preloaded `api.call` answers, so the same component code runs synchronously on the server and in
the browser's first render; `isSettled(value)` tells one apart.

```js
const log = [];
settled(3).then((price) => log.push(`${price} €`));
settledError(new Error("Out of stock"))
    .catch((error) => log.push(error.message))
    .finally(() => log.push("done"));
log; // → ["3 €", "Out of stock", "done"]
isSettled(settled(3)); // → true
isSettled(Promise.resolve(3)); // → false
```

```js
const juris = new Juris({ services: { price: async () => 3 } });
juris.clearState({ $ssr: await juris.preload([["price", "milk"]]) });
const answer = juris.api.call("price", "milk");
isSettled(answer); // → true
let shown = "…";
answer.then((price) => {
    shown = `${price} €`;
});
shown; // → "3 €"
```

`pathSegment(text)` makes any text one segment of a state path (`%`, `.` and `*` escaped,
`__proto__` escaped whole), distinct texts giving distinct segments; the live status is kept under
it.

```js
pathSegment("stock.milk"); // → "stock%2Emilk"
pathSegment("orders.*"); // → "orders%2E%2A"
pathSegment("100%"); // → "100%25"
pathSegment("__proto__"); // → "%5F%5Fproto%5F%5F"
```

```js
const juris = new Juris({ services: { stock: () => 12 } });
juris.api.live("stock.milk", "stock", "milk");
const segment = pathSegment("stock.milk");
juris.getState(`$async.live.${segment}.status`); // → "live"
```

The async error logs (`errors` under the async root, and each group's) keep the last
`MAX_ERROR_LOG` (50) entries: in a browser they used to grow for the life of the page.

```js dom
const juris = new Juris();
const orders = juris.api.group("orders");
for (let n = 1; n <= 60; n += 1) {
    const failed = Promise.reject(new Error(`order ${n} failed`));
    orders.track(failed).catch(() => {});
}
await new Promise((resolve) => setTimeout(resolve));
MAX_ERROR_LOG; // → 50
orders.errors().length; // → 50
orders.errors()[0].message; // → "order 11 failed"
```

The async counters never go below 0.

```js
const juris = new Juris();
const checkout = juris.api.group("checkout");
const saved = new Promise((resolve) => setTimeout(resolve, 5));
const saving = checkout.track(saved);
checkout.reset();
await saving;
checkout.pending(); // → 0
```

`clearState(next)` skips an own `__proto__` key in `next` (`JSON.parse` makes one), so a parsed
state cannot set the root's prototype.

```js
const juris = new Juris();
const sent = '{ "cart": { "count": 2 }, "__proto__": { "admin": true } }';
juris.clearState(JSON.parse(sent));
juris.getState("cart.count"); // → 2
juris.stateManager.state.admin; // → undefined
```

`observe(observer)` calls `observer(path, value, previous)` once for every write, by the path
written, after the subscribers it woke (inside `batch()`, at the write itself); a deleted path is
told with `value` undefined and `clearState` as `""`.

```js
const juris = new Juris({ state: { cart: { count: 1 } } });
const seen = [];
juris.stateManager.observe((path, value, previous) => {
    seen.push([path, value, previous]);
});
juris.setValue("cart.count", 2);
juris.deleteState("cart.count");
juris.clearState({});
seen[0]; // → ["cart.count", 2, 1]
seen[1]; // → ["cart.count", undefined, 2]
seen[2][0]; // → ""
```

```js
const juris = new Juris({ state: { cart: { count: 1 } } });
const order = [];
juris.bindState(
    () => juris.getState("cart.count"),
    (count) => order.push(`drawn ${count}`),
);
juris.stateManager.observe((path, value) => order.push(`observed ${value}`));
juris.setValue("cart.count", 2);
juris.batch(() => {
    juris.setValue("cart.count", 3);
    order.push("in the batch");
});
order;
// → ["drawn 1", "drawn 2", "observed 2", "observed 3", "in the batch",
//    "drawn 3"]
```

Unlike a subscription it hears writes beneath the paths a module cares about, which is what
`headless.js`'s `subscribe`, `fluentstate.js` and `webcomponent.js` keep their own subscriptions by.

```js
const juris = new Juris({ state: { cart: { items: [] } } });
const heard = [];
juris.stateManager.observe((path) => {
    if (path.startsWith("cart.")) {
        heard.push(path);
    }
});
juris.setValue("cart.items.0", { sku: "milk" });
juris.setValue("cart.items.0.qty", 2);
heard; // → ["cart.items.0", "cart.items.0.qty"]
```

Every observer runs whichever throws, and the first error is thrown to the writer. It answers the
function that stops it.

```js
const juris = new Juris();
const heard = [];
juris.stateManager.observe(() => {
    throw new Error("the audit log is full");
});
const stop = juris.stateManager.observe((path) => heard.push(path));
juris.setValue("cart.count", 1);
// throws Error: the audit log is full
heard; // → ["cart.count"]
stop();
juris.setValue("cart.count", 2);
// throws Error: the audit log is full
heard; // → ["cart.count"]
```

#### `component-manager.js`

**Exports:** `ComponentManager` (default).

```js
import ComponentManager from "juris/component-manager.js";

const components = new ComponentManager();
components.registerComponent("CartBadge", () => ({ span: "2 in cart" }));
components.has("CartBadge"); // → true
components.names(); // → ["CartBadge"]
```

Component registration and lifecycle, and in `devMode` the inspectable tree of live instances.
`Juris` constructs it; an app registers through `registerComponent`.

```js
import ComponentManager from "juris/component-manager.js";
import Juris from "juris/juris.js";

const juris = new Juris();
juris.componentManager instanceof ComponentManager; // → true
juris.registerComponent("CartBadge", () => ({ span: "2 in cart" }));
juris.componentManager.names(); // → ["Await", "CartBadge"]
juris.componentTree();
// throws Error: Juris.componentTree: available in devMode only
```

```js dom
import Juris from "juris/juris.js";

const juris = new Juris({ devMode: true });
juris.registerComponent("CartLine", (props) => ({ li: props.title }));
juris.registerComponent("Cart", () => ({
    ul: {
        children: [
            { CartLine: { title: "Milk" } },
            { CartLine: { title: "Eggs" } },
        ],
    },
}));
const page = document.createElement("main");
juris.render(page, { Cart: {} });
const [cart] = juris.componentTree();
cart.children.map((line) => line.props.title); // → ["Milk", "Eggs"]
juris.disposeTree(page.firstChild);
juris.componentTree(); // → []
```

#### `dom-renderer.js`

**Exports:** `DOMRenderer` (default).

The examples on this page draw into a page (`document`), with one instance:

```js setup dom
import Juris from "juris/juris.js";

const SVG = "http://www.w3.org/2000/svg";
const juris = new Juris();
const page = document.createElement("main");
```

The browser renderer: bindings, keyed lists, the reuse of server-rendered elements, and `enhance`,
which adopts markup Juris did not draw. `Juris` constructs it.

```js
import DOMRenderer from "juris/dom-renderer.js";

juris.renderer instanceof DOMRenderer; // → true
```

```js
page.innerHTML = '<ul class="cart"><li>Milk</li><li>Eggs</li></ul>';
const milk = page.querySelector("li");
juris.enhance(page.querySelector(".cart"), {
    children: [
        { li: "Milk" },
        { li: { textContent: () => juris.getState("cart.second", "Eggs") } },
    ],
});
page.querySelector("li") === milk; // → true
juris.setValue("cart.second", "Bread");
page.innerHTML; // → <ul class="cart"><li>Milk</li><li>Bread</li></ul>
```

What is drawn inside an element is drawn in that element's namespace, on every draw and not only
the first: SVG inside `<svg>`, MathML inside `<math>`, HTML again at the parser's integration points
(`<foreignObject>`, an SVG `<title>` or `<desc>`, a MathML token element, an HTML `annotation-xml`:
"Components and layouts"), however it got there (a re-draw that kept the element, a list or a seat
bound inside it, `enhance`).

```js
juris.setValue("sales", [3]);
juris.render(page, {
    svg: {
        children: () => juris.getState("sales").map((y) => ({
            circle: { cy: y },
        })),
    },
});
juris.setValue("sales", [3, 5]);
const circles = [...page.querySelectorAll("circle")];
circles.map((circle) => circle.namespaceURI === SVG); // → [true, true]
```

```js
juris.render(page, {
    svg: {
        children: [
            { title: "Sales by week" },
            { foreignObject: { children: [{ p: "Week 12" }] } },
        ],
    },
});
page.querySelector("title").namespaceURI === SVG; // → true
page.querySelector("p").namespaceURI; // → "http://www.w3.org/1999/xhtml"
```

```js
page.innerHTML = '<svg class="chart"></svg>';
juris.enhance(page.querySelector(".chart"), {
    children: [{ rect: { width: 4, height: 3 } }],
});
page.querySelector("rect").namespaceURI === SVG; // → true
```

`juris.render(target, layout, namespace)` and `juris.mount(target, layout, { namespace })` (the
renderer's own `mount` takes the namespace as its third argument) draw inside the target in its own
namespace unless given one (`null` is HTML).

```js
const chart = document.createElementNS(SVG, "svg");
juris.render(chart, { circle: { r: 4 } });
chart.lastChild.namespaceURI === SVG; // → true
juris.render(chart, { p: "Week 12" }, null);
chart.lastChild.namespaceURI === SVG; // → false
```

```js
const icon = document.createElement("span");
juris.mount(icon, { path: { d: "M0 0L8 8" } }, { namespace: SVG });
icon.firstChild.namespaceURI === SVG; // → true
juris.renderer.mount(icon, { circle: { r: 4 } }, SVG);
icon.innerHTML; // → <circle r="4"></circle>
```

An element that is already there (server markup, a previous draw, what `enhance` adopts) is taken
for a layout only when its tag is one the layout could draw (`reusableElement`): otherwise it is
replaced (by the empty text node a refused tag draws), and `enhance` throws on an element, or a
component adopting one, whose tag is refused unless `allowTags` names it (so enhancing a `<link>`, a
`<meta>` or an `<iframe>` needs `allowTags` to name it).

```js
page.innerHTML = '<aside class="ad"><iframe src="/ads"></iframe></aside>';
const ad = page.querySelector(".ad");
juris.enhance(ad, { children: [{ iframe: { src: "/ads/2" } }] });
ad.querySelector("iframe"); // → null
ad.firstChild.nodeType === Node.TEXT_NODE; // → true
```

```js
document.head.innerHTML = '<link rel="stylesheet" href="/shop.css">';
const theme = document.head.querySelector("link");
juris.enhance(theme, { href: "/shop-dark.css" });
// throws Error: Juris.enhance: cannot enhance it: <link> is not allowed in a
//   layout
const themed = new Juris({ allowTags: ["link"] });
themed.enhance(theme, { href: "/shop-dark.css" });
theme.outerHTML; // → <link rel="stylesheet" href="/shop-dark.css">
```

```js
juris.registerComponent("AdFrame", () => ({ iframe: { src: "/ads" } }));
page.innerHTML = '<iframe src="/ads"></iframe>';
juris.enhance(page.querySelector("iframe"), { AdFrame: {} });
// throws Error: Juris.enhance: component "AdFrame" cannot adopt it
```

On an SVG or MathML element, `xlink:…`, `xml:…` and `xmlns`/`xmlns:…` attributes are set in their
namespaces, as the HTML parser sets them.

```js
juris.render(page, {
    svg: {
        children: [{ use: { "xlink:href": "#cart-icon", "xml:lang": "fr" } }],
    },
});
const use = page.querySelector("use");
use.getAttributeNS("http://www.w3.org/1999/xlink", "href"); // → "#cart-icon"
use.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang"); // → "fr"
```

```js
juris.render(page, { p: { "xml:lang": "fr", textContent: "Lait" } });
const note = page.querySelector("p");
note.getAttribute("xml:lang"); // → "fr"
note.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang"); // → null
```

Each binding the renderer makes is labelled with what it draws, for a devtools feature
("`devtools.js`"): its `bindState(resolver, applyValue, target, key, part)` is given the layout key
(`href`, `textContent`, `value`, `classList` with the class name as `part`, or `null` for a function
giving the whole object, `style`, `children`), or, for a seat or a component's root function, a
symbol saying which and, as `part`, the node it draws into or the getter of it. It ignores both; the
feature replaces the method on its own instance to read them.

```js
const labels = [];
const bind = juris.renderer.bindState;
juris.renderer.bindState = function (resolver, apply, target, key, part) {
    labels.push(typeof part === "string" ? `${key} ${part}` : String(key));
    return bind.call(this, resolver, apply, target, key, part);
};
juris.registerComponent("CartCount", (props, api) => () => ({
    span: `${api.getState("cart.count", 0)}`,
}));
juris.render(page, {
    a: {
        href: () => `/carts/${juris.getState("cart.id", 7)}`,
        classList: { empty: () => juris.getState("cart.count", 0) === 0 },
        children: [() => "Cart ", { CartCount: {} }],
    },
});
labels;
// → ["href", "classList empty", "Symbol(seat)", "Symbol(root)"]
```

That label is all a binding pays for devtools on an instance without the feature: one or two more
arguments where it is made.

```js
import DOMRenderer from "juris/dom-renderer.js";

juris.renderer.bindState === DOMRenderer.prototype.bindState; // → true
```

An element reused for another layout of the same tag keeps only what that layout gives it: a property
it no longer names is cleared, and so is what the element held inside, its children or its text, when
the layout puts nothing in their place: it gives no `children` (or `null`), no `textContent` and no
allowed `innerHTML`, or it is an `<output>` or a `<textarea>` that holds its `value` (F27). So a
placeholder such as `cond ? { span: { className: "badge", children: […] } } : { span: {} }` is an
empty span when `cond` turns false, not a span that still shows the old text without its class.

```js
juris.setValue("cart.count", 2);
juris.render(page, {
    p: {
        children: () => {
            const count = juris.getState("cart.count");
            const badge = {
                className: "badge",
                children: [{ b: count }, " in cart"],
            };
            return count > 0 ? { span: badge } : { span: {} };
        },
    },
});
page.innerHTML; // → <p><span class="badge"><b>2</b> in cart</span></p>
juris.setValue("cart.count", 0);
page.innerHTML; // → <p><span></span></p>
```

```js
juris.setValue("order.total", 12);
juris.render(page, {
    form: {
        children: () => {
            const total = juris.getState("order.total");
            const output = total ? { value: total } : { children: null };
            return [{ output }];
        },
    },
});
juris.setValue("order.total", 0);
page.innerHTML; // → <form><output></output></form>
```

A form control's value (an `<input>`'s, a `<textarea>`'s or a `<select>`'s) is what the user typed
or chose, and stays when the layout that reuses it gives none; any other element's `value` is an
attribute, cleared as the others are.

```js
const first = [
    { li: { value: 3, textContent: "Milk" } },
    { input: { value: "Ada" } },
];
const then = [{ li: "Milk" }, { input: {} }];
juris.setValue("step", 1);
juris.render(page, {
    ol: { children: () => (juris.getState("step") === 1 ? first : then) },
});
juris.setValue("step", 2);
page.innerHTML; // → <ol><li>Milk</li><input></ol>
page.querySelector("input").value; // → "Ada"
```

An element Juris has not drawn into before (server markup on its first hydration) has no record of
what it held, and is left as it is.

```js
page.innerHTML = '<p class="cart"><span class="badge">2 in cart</span></p>';
juris.enhance(page.querySelector(".cart"), { children: [{ span: {} }] });
page.innerHTML; // → <p class="cart"><span class="badge">2 in cart</span></p>
```

#### `html-safety.js`

**Exports:** `safeAttributeName`, `allowedTags`, `safeTagName`, `checkTag`, `reusableElement`,
`checkInnerHTML`, `classTokens`, `checkStyle`, `allowedSchemes`, `safeUrl`, `checkAttribute`.

The examples on this page import them all, and render with an instance given the kit's string
renderer:

```js setup
import {
    safeAttributeName, allowedTags, safeTagName, checkTag, reusableElement,
    checkInnerHTML, classTokens, checkStyle, allowedSchemes, safeUrl,
    checkAttribute,
} from "juris/html-safety.js";
import Juris from "juris/juris.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";

const juris = new Juris({ features: { ssr: SSRRenderer } });
```

The tag, attribute, markup, class, style and URL-scheme refusals both renderers apply, so the two
never disagree.

```js
const layout = { a: { href: "javascript:alert(1)", textContent: "Home" } };
juris.renderToString(layout); // → <a>Home</a>
```

```js dom
const browser = new Juris();
const page = document.createElement("main");
const home = { a: { href: "javascript:alert(1)", textContent: "Home" } };
browser.render(page, home);
page.innerHTML; // → <a>Home</a>
```

- `checkTag(tag, allowed)` and `checkAttribute(name, value, schemes)` are each renderer's decision
  for one element and one attribute, answering `{ ok, reason }`; `safeTagName`,
  `safeAttributeName` and `safeUrl` are their parts.

  ```js
  checkTag("article"); // → { ok: true }
  checkTag("img src=x onerror=alert(1)").ok; // → false
  checkAttribute("href", "/cart"); // → { ok: true }
  checkAttribute("onclick", "buy()");
  // → { ok: false, reason: 'attribute name "onclick" is not allowed' }
  checkAttribute("src", "javascript:buy()");
  // → { ok: false, reason: 'src refuses "javascript:buy()": scheme not allowed' }
  ```

  ```js
  safeTagName("cart-summary"); // → true
  safeTagName("script"); // → false
  safeAttributeName("data-sku"); // → true
  safeAttributeName("onmouseover"); // → false
  safeUrl("/cart?step=2"); // → true
  safeUrl("javascript:alert(1)"); // → false
  ```

- The refused tags are those that run code, load a document or reach the whole page: `script`,
  `iframe`, `frame`, `frameset`, `object`, `embed`, `applet`, `portal`, `base`, `meta`, `link`,
  SVG's `set`, `animate`, `animateMotion` and `animateTransform`, `plaintext` (the parser never
  closes it: the rest of the document, state and loader included, becomes its text) and `style`
  (page-wide CSS from data: attribute-value exfiltration through selectors and `url()`, `@import`),
  SVG's included. `allowTags` opens any of them by name (`allowTags: ["style"]`).

  ```js
  juris.renderToString({
      div: { children: [{ style: "p { color: red }" }, { p: "Milk" }] },
  });
  // → <div><p>Milk</p></div>
  juris.renderToString({
      svg: { children: [{ animate: { attributeName: "href" } }] },
  });
  // → <svg></svg>
  ```

  ```js
  const refused = ["script", "iframe", "base", "meta", "link", "plaintext"];
  refused.map((tag) => checkTag(tag).ok);
  // → [false, false, false, false, false, false]
  checkTag("animateMotion").ok; // → false
  ```

  ```js
  const styled = new Juris({
      allowTags: ["style"],
      features: { ssr: SSRRenderer },
  });
  styled.renderToString({ style: "p { color: teal }" });
  // → <style>p { color: teal }</style>
  checkTag("style", allowedTags(["style"])); // → { ok: true }
  ```

- `reusableElement(localName, tag, allowed)` says whether the DOM renderer may take an element that
  is already there as the one `tag` draws: the same tag, and one `checkTag` allows.

  ```js
  reusableElement("LI", "li"); // → true
  reusableElement("li", "p"); // → false
  reusableElement("iframe", "iframe"); // → false
  reusableElement("iframe", "iframe", allowedTags(["iframe"])); // → true
  ```

- `checkInnerHTML(allowed)` refuses `innerHTML` unless `allowed === true` (the instance's
  `allowInnerHTML`).

  ```js
  checkInnerHTML(true); // → { ok: true }
  checkInnerHTML("true").ok; // → false
  checkInnerHTML(undefined).ok; // → false
  ```

- `classTokens(key)` is a `classList` key's class names, split on ASCII whitespace, empty ones
  skipped.

  ```js
  classTokens("btn  btn-primary\tactive"); // → ["btn", "btn-primary", "active"]
  classTokens("  "); // → []
  ```

- `checkStyle(key, value)` answers `{ ok, name, reason }` for one style key: `name` is the CSS
  property (`margin-top`, `--accent`, `-webkit-transform`, `float`), given whenever the key is a
  property; `null`, `undefined` and `""` are a removal, never refused. The rule is "Components and
  layouts"' `style`.

  ```js
  checkStyle("marginTop", "4px"); // → { ok: true, name: "margin-top" }
  checkStyle("--accent", "teal"); // → { ok: true, name: "--accent" }
  checkStyle("WebkitTransform", "none");
  // → { ok: true, name: "-webkit-transform" }
  checkStyle("cssFloat", "left"); // → { ok: true, name: "float" }
  checkStyle("color", null); // → { ok: true, name: "color" }
  ```

  ```js
  const injected = checkStyle("color", "red; background: url(//evil.example)");
  injected.ok; // → false
  injected.name; // → "color"
  checkStyle("cssText", "color: red").ok; // → false
  ```

- A URL attribute (`href`, `src`, `action`, `formaction`, …) may be relative, a fragment, `http`,
  `https`, `mailto`, `tel`, `sms`, `geo` or `ftp`, or `data:` for an image.

  ```js
  const help = (href) => juris.renderToString({
      a: { href, textContent: "Help" },
  });
  help("tel:+15551234"); // → <a href="tel:+15551234">Help</a>
  help("#faq"); // → <a href="#faq">Help</a>
  help("magnet:?xt=urn:btih:c12f"); // → <a>Help</a>
  ```

  ```js
  safeUrl("data:image/png;base64,iVBORw0KGgo="); // → true
  safeUrl("data:text/html;base64,PHNjcmlwdD4="); // → false
  juris.renderToString({ form: { action: "data:text/html,hi" } });
  // → <form></form>
  ```

  ```js
  const dot = "data:image/svg+xml,%3Csvg%2F%3E";
  safeUrl(dot); // → true
  juris.renderToString({ img: { src: dot, alt: "" } });
  // → <img src="data:image/svg+xml,%3Csvg%2F%3E" alt="">
  ```

- `Juris`'s `allowTags` and `allowSchemes` add tags and schemes on the instance given them
  (`allowTags: ["iframe"]`, `allowSchemes: ["magnet", "web+app"]`: names, the schemes' without the
  colon, lower-cased once, added to the list and never taking from it).

  ```js
  const app = new Juris({
      allowTags: ["IFRAME"],
      allowSchemes: ["Magnet", "web+shop"],
      features: { ssr: SSRRenderer },
  });
  [...app.allowTags]; // → ["iframe"]
  [...app.allowSchemes]; // → ["magnet", "web+shop"]
  app.renderToString({ a: { href: "web+shop:cart/7", textContent: "Open" } });
  // → <a href="web+shop:cart/7">Open</a>
  app.renderToString({ iframe: { src: "https://maps.example/shop" } });
  // → <iframe src="https://maps.example/shop"></iframe>
  ```

  - `allowedTags` refuses a list naming anything that is not a tag's name (a letter, then letters,
    digits or `-`), which would open nothing while the app believed it had.

    ```js
    [...allowedTags(["iframe", "My-Widget"])]; // → ["iframe", "my-widget"]
    allowedTags(["<iframe>"]);
    // throws TypeError: Juris: allowTags: "<iframe>" is not a tag's name
    ```

  - `allowedSchemes` refuses a list naming anything that is not a scheme's name, or `javascript`,
    `vbscript` or `data` (which keeps its own rule, an image only), and `safeUrl` refuses those
    three on every URL again, however the value spells them, whatever set it is given.

    ```js
    allowedSchemes(["magnet:"]);
    // throws TypeError: Juris: allowSchemes: "magnet:" is not a scheme's name
    allowedSchemes(["JavaScript"]);
    // throws TypeError: Juris: allowSchemes: javascript: runs code in the page
    allowedSchemes(["data"]);
    // throws TypeError: Juris: allowSchemes: data: is allowed for an image only
    ```

    ```js
    const everything = new Set(["javascript", "vbscript", "data"]);
    safeUrl("java\tscript:alert(1)", everything); // → false
    safeUrl(" JAVASCRIPT:alert(1)", everything); // → false
    safeUrl("vbscript:msgbox(1)", everything); // → false
    safeUrl("data:text/html,hi", everything); // → false
    ```

  - No option opens `srcdoc`.

    ```js
    const open = new Juris({
        allowTags: ["iframe"],
        allowInnerHTML: true,
        features: { ssr: SSRRenderer },
    });
    open.renderToString({ iframe: { srcdoc: "<p>Hi</p>", title: "Ad" } });
    // → <iframe title="Ad"></iframe>
    checkAttribute("srcdoc", "<p>Hi</p>").ok; // → false
    ```

- `server/document.js` checks a page's head against the defaults alone.

  ```js
  import { renderDocument } from "juris-kit/server/document.js";

  const links = [{ rel: "alternate", href: "magnet:?xt=urn:btih:c12f" }];
  renderDocument({}, { entry: "/app.js", links });
  // throws Error: renderDocument: links: href refuses "magnet:?xt=urn:btih:c12f":
  //   scheme not allowed
  ```

#### `router.js`

**Exports:** `createRouter` (also the default), `Router`, `titleOf`, `ROUTER_COMPONENTS`,
`parseQuery`, `formatQuery`, `splitUrl`, `joinUrl`.

```js
import createRouterDefault, {
    createRouter, Router, titleOf, ROUTER_COMPONENTS,
    parseQuery, formatQuery, splitUrl, joinUrl,
} from "juris/router.js";

createRouterDefault === createRouter; // → true
createRouter({ routes: [] }) instanceof Router; // → true
```

The examples below build their own instance and router, from:

```js setup
import Juris from "juris/juris.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";
import { createRouter } from "juris/router.js";
```

Routes, `$route`, links, `navigate`, the Back and Forward trail, and a route's own code.
`createRouter(options)` makes a `Router`, installed with `juris.use(router)`.

```js
const juris = new Juris();
const router = createRouter({
    routes: [
        { path: "/", name: "home" },
        { path: "/orders/:id", name: "order" },
    ],
});
juris.use(router);
await juris.api.navigate("/orders/7?tab=items");
juris.getState("$route");
// → { path: "/orders/7", query: { tab: "items" }, hash: "", name: "order",
//     params: { id: "7" }, meta: {}, matched: [1] }
```

```js dom
const juris = new Juris();
juris.use(createRouter({ routes: [{ path: "/" }, { path: "/orders" }] }));
await juris.api.navigate("/orders");
location.pathname; // → "/orders"
juris.api.canBack(); // → true
juris.api.back();
await new Promise((resolve) => window.addEventListener("popstate", resolve));
juris.getState("$route.path"); // → "/"
juris.api.canForward(); // → true
```

- **Options:** `routes`, `mode` (`"history"`, or `"hash"`), `base`, `routePath` (`"$route"`),
  `scroll` (`"top"`, or `false`), `fullLoad(url)`, `guard(to, ctx)`, `context(api)` and `history`.

  ```js
  const juris = new Juris();
  juris.use(createRouter({
      routes: [{ path: "/orders/:id", name: "order" }],
      mode: "hash",
      base: "/shop",
      routePath: "page",
  }));
  const order = { name: "order", params: { id: 7 } };
  juris.api.link(order).href; // → "/shop#/orders/7"
  await juris.api.navigate("/orders/8");
  juris.getState("page.params"); // → { id: "8" }
  ```

  ```js dom
  const juris = new Juris();
  juris.use(createRouter({ routes: [{ path: "/orders" }, { path: "/help" }] }));
  window.scrollTo(0, 800);
  await juris.api.navigate("/orders");
  window.scrollY; // → 0
  ```

  ```js dom
  const kept = new Map();
  const storage = {
      getItem: (key) => kept.get(key) ?? null,
      setItem: (key, value) => kept.set(key, value),
  };
  const juris = new Juris();
  juris.use(createRouter({
      routes: [{ path: "/orders" }],
      scroll: false,
      history: { storage, key: "shop.trail" },
  }));
  window.scrollTo(0, 800);
  await juris.api.navigate("/orders");
  window.scrollY; // → 800
  kept.get("shop.trail"); // → "2"
  ```

  - Anything else is refused, as is a `guard`, `context` or `fullLoad` that is not a function: a
    misspelt `guard` would leave every route open. `routePath` is a root of the state: a name with
    a `.` is refused.

    ```js
    createRouter({ routes: [], gaurd: () => "/sign-in" });
    // throws TypeError: Router: "gaurd" is not an option
    createRouter({ routes: [], guard: "/sign-in" });
    // throws TypeError: Router: guard is a function
    createRouter({ routes: [], routePath: "app.route" });
    // throws TypeError: Router: routePath is a root of the state
    ```

- **A route record:** `path` (`/lots/:id` names a parameter, `*rest` a named rest parameter, a bare
  `*` the catch-all), `name`, `component`, `props`, `children`, `redirect`, `beforeEnter`,
  `preload(location)`, `load` and `register` ("A route's own code"), `meta` and `head`.

  ```js
  const router = createRouter({
      routes: [
          { path: "/lots/:id", name: "lot" },
          { path: "/files/*rest", name: "file" },
          { path: "*", name: "notFound" },
      ],
  });
  router.resolve("/lots/L1").params; // → { id: "L1" }
  router.resolve("/files/2026/stock.pdf").params; // → { rest: "2026/stock.pdf" }
  router.resolve("/nowhere").name; // → "notFound"
  ```

  ```js
  const juris = new Juris({ features: { ssr: SSRRenderer } });
  juris.registerComponent("OrderPage", (props) => ({ h1: `Order ${props.id}` }));
  juris.use(createRouter({
      routes: [
          { path: "/", redirect: "/orders/1" },
          {
              path: "/orders/:id",
              component: "OrderPage",
              props: (params) => ({ id: params.id }),
              meta: { section: "Orders" },
          },
      ],
  }));
  await juris.api.navigate("/");
  juris.renderToString({ RouterView: {} });
  // → <h1 data-key="route-1">Order 1</h1>
  juris.getState("$route.meta"); // → { section: "Orders" }
  ```

  ```js
  const juris = new Juris({ state: { cart: { count: 0 } } });
  const cartFirst = (to, from, api) => {
      return api.getState("cart.count") > 0 ? undefined : "/cart";
  };
  juris.use(createRouter({
      routes: [
          { path: "/cart" },
          { path: "/checkout", beforeEnter: cartFirst },
      ],
  }));
  await juris.api.navigate("/checkout");
  juris.getState("$route.path"); // → "/cart"
  ```

  - The deepest matching record wins, a catch-all only when nothing else matches, and a tie goes
    to the record registered first, so a literal route (`/items/new`) is registered before its
    parameterised sibling (`/items/:id`).

    ```js
    const router = createRouter({
        routes: [
            { path: "*", name: "notFound" },
            { path: "/orders/:id", name: "printable" },
            { path: "/orders", children: [{ path: ":id", name: "order" }] },
        ],
    });
    router.resolve("/orders/7").name; // → "order"
    router.resolve("/orders/7").matched; // → [2, 3]
    ```

    ```js
    const right = createRouter({
        routes: [
            { path: "/items/new", name: "newItem" },
            { path: "/items/:id", name: "item" },
        ],
    });
    right.resolve("/items/new").name; // → "newItem"
    const wrong = createRouter({
        routes: [
            { path: "/items/:id", name: "item" },
            { path: "/items/new", name: "newItem" },
        ],
    });
    wrong.resolve("/items/new").name; // → "item"
    ```

- **`resolve(url, extra, ctx)`** gives a server everything for a request: the state, the preload
  list (each matched record's `preload({ ...location, params, ...extra })`), the table's `redirect`,
  and the route the address lands on, so a server never reads the address a second time: `name`
  (null when it has none), `params`, the merged `meta`, `head`, `matched`, and `notFound`, true for
  the catch-all or when no record matches.

  ```js
  const router = createRouter({
      routes: [
          {
              path: "/orders/:id",
              name: "order",
              meta: { signedIn: true },
              head: { title: "Order" },
              preload: ({ params, viewer }) => [["order", params.id, viewer]],
          },
      ],
  });
  router.resolve("/orders/7?tab=items#notes", { viewer: "ada" });
  // → { state: { $route: { path: "/orders/7", query: { tab: "items" },
  //                        hash: "notes" } },
  //     preload: [["order", "7", "ada"]], redirect: null,
  //     name: "order", params: { id: "7" }, meta: { signedIn: true },
  //     matched: [0], notFound: false, head: { title: "Order" } }
  ```

  ```js
  const router = createRouter({
      routes: [
          { path: "/shop", redirect: "/products" },
          { path: "/products" },
          { path: "*", name: "notFound" },
      ],
  });
  router.resolve("/shop").redirect; // → "/products"
  router.resolve("/products").name; // → null
  router.resolve("/nowhere").notFound; // → true
  createRouter({ routes: [] }).resolve("/products").notFound; // → true
  ```

- **`guard(to, ctx)`** decides who may open a route, one function on both sides: `resolve` asks it
  with the context it is given (who is asking, on a server; nobody's when none is given), and
  `navigate` with the router's `context(api)` (`() => ({})` unless given), before any record's
  `beforeEnter`. It answers nothing (`undefined` or `null`) or `true` to go on, or a location to
  send the visitor to instead, which `resolve` answers as its `redirect`; anything else, `false` or
  a promise included, is refused with a `TypeError`, so it cannot be async.

  ```js
  const guard = (to, ctx) => {
      return to.meta.signedIn && !ctx.user ? "/sign-in" : undefined;
  };
  const router = createRouter({
      routes: [
          { path: "/orders", meta: { signedIn: true } },
          { path: "/sign-in" },
      ],
      guard,
  });
  router.resolve("/orders").redirect; // → "/sign-in"
  router.resolve("/orders", null, { user: "ada" }).redirect; // → null
  ```

  ```js
  const router = createRouter({
      routes: [{ path: "/orders" }, { path: "/sign-in" }],
      guard: (to, ctx) => (ctx.user ? true : "/sign-in"),
  });
  router.resolve("/orders", null, { user: "ada" }).redirect; // → null
  router.resolve("/orders").redirect; // → "/sign-in"
  createRouter({ routes: [{ path: "/orders" }], guard: () => false })
      .resolve("/orders");
  // throws TypeError: Router: a guard answers a location to go to instead, or
  //   nothing; for "/orders" it answered false
  ```

  ```js
  const guard = (to, ctx) => {
      return to.meta.signedIn && !ctx.user ? "/sign-in" : undefined;
  };
  const juris = new Juris({ state: { session: { user: null } } });
  juris.use(createRouter({
      routes: [
          { path: "/orders", meta: { signedIn: true } },
          { path: "/sign-in" },
      ],
      guard,
      context: (api) => ({ user: api.getState("session.user") }),
  }));
  await juris.api.navigate("/orders");
  juris.getState("$route.path"); // → "/sign-in"
  juris.setValue("session.user", "ada");
  await juris.api.navigate("/orders");
  juris.getState("$route.path"); // → "/orders"
  ```

  ```js
  const router = createRouter({
      routes: [{ path: "/orders" }],
      guard: async (to, ctx) => (ctx.user ? undefined : "/sign-in"),
  });
  router.resolve("/orders");
  // throws TypeError: Router: a guard answers a location to go to instead, or
  //   nothing
  ```

  - It must read nothing but its two arguments: a server renders every request on one instance,
    whose state is whichever request rendered last. Back and Forward do not ask it (the browser has
    moved already).

    ```js dom
    const juris = new Juris({ state: { session: { user: "ada" } } });
    juris.use(createRouter({
        routes: [
            { path: "/" },
            { path: "/orders", meta: { signedIn: true } },
            { path: "/sign-in" },
        ],
        guard: (to, ctx) => {
            return to.meta.signedIn && !ctx.user ? "/sign-in" : undefined;
        },
        context: (api) => ({ user: api.getState("session.user") }),
    }));
    await juris.api.navigate("/orders");
    await juris.api.navigate("/");
    juris.setValue("session.user", null);
    juris.api.back();
    await new Promise((resolve) => window.addEventListener("popstate", resolve));
    juris.getState("$route.path"); // → "/orders"
    ```

- **A page's name.** A route's `head` is `{ title, titleFrom(data), dataPath, description }`, merged
  over its parents' like `meta` (`router.headOf(matched)`, and `resolve`'s `head`); `meta.title` and
  `meta.titleFrom` stand for `head.title` and `head.titleFrom` for one release.

  ```js
  const router = createRouter({
      routes: [{
          path: "/orders",
          head: { title: "Orders" },
          children: [{
              path: ":id",
              head: {
                  titleFrom: (order) => `Order ${order.number}`,
                  dataPath: "order",
              },
          }],
      }],
  });
  const { head, matched } = router.resolve("/orders/7");
  head.title; // → "Orders"
  head.dataPath; // → "order"
  router.headOf(matched).dataPath; // → "order"
  ```

  ```js
  const router = createRouter({
      routes: [{ path: "/help", meta: { title: "Help" } }],
  });
  router.resolve("/help").head; // → { title: "Help" }
  ```

  - `titleOf(head, data, { fallback, suffix, max })` is the one function a server and a browser
    both ask: `titleFrom(data)` names the page from its own data, cut to `max` characters (code
    points, so the cut never leaves a lone surrogate; a flag, a skin tone or a joined emoji at the
    cut may keep only its first code points, since cutting by what a reader sees as one character
    needs `Intl.Segmenter`, Firefox 125, above the floor) and followed by `suffix`; without a name,
    `head.title`; without that, `fallback`.

    ```js
    import { titleOf } from "juris/router.js";

    const head = {
        title: "Order",
        titleFrom: (order) => `Order ${order.number}`,
    };
    titleOf(head, { number: "A-1007" }, { suffix: " · Shop" });
    // → "Order A-1007 · Shop"
    titleOf(head, null, { suffix: " · Shop" }); // → "Order"
    titleOf({}, null, { fallback: "Shop" }); // → "Shop"
    ```

    ```js
    import { titleOf } from "juris/router.js";

    const head = { titleFrom: (product) => product.name };
    const jam = { name: "Strawberry 🍓 jam" };
    titleOf(head, jam, { max: 12 }); // → "Strawberry 🍓"
    titleOf(head, jam, { max: 12 }).length; // → 13
    ```

  - A `titleFrom` that throws, or no data, never names it. The data is the answer to the route's own
    call (its first preload): a server has it from the preload, and a browser where the page keeps
    it, the state path `head.dataPath` names.

    ```js
    import { titleOf } from "juris/router.js";

    const head = {
        title: "Order",
        titleFrom: (order) => `Order ${order.number.trim()}`,
    };
    titleOf(head, { id: 7 }); // → "Order"
    ```

    ```js
    import { titleOf } from "juris/router.js";

    const head = {
        titleFrom: (order) => `Order ${order.number}`,
        dataPath: "order",
    };
    const juris = new Juris({
        services: { order: (id) => ({ id, number: "A-1007" }) },
        features: { ssr: SSRRenderer },
    });
    const page = await juris.renderRequest({
        preload: [["order", "7"]],
        layout: { p: "Order 7" },
    });
    titleOf(head, page.result("order", "7")); // → "Order A-1007"
    ```

    ```js dom
    import { titleOf } from "juris/router.js";

    const head = {
        titleFrom: (order) => `Order ${order.number}`,
        dataPath: "order",
    };
    const juris = new Juris({ state: { order: { number: "A-1007" } } });
    titleOf(head, juris.getState(head.dataPath)); // → "Order A-1007"
    ```

- **URLs.** `splitUrl(url)` answers `{ path, query, hash }` and `joinUrl` puts them back.
  `parseQuery(search)` builds an object with no prototype, repeated keys as a list;
  `formatQuery(query)` writes one. A path segment that cannot be decoded is kept as it arrived.

  ```js
  import { splitUrl, joinUrl } from "juris/router.js";

  splitUrl("/orders/7/?tab=items&tab=notes#top");
  // → { path: "/orders/7", query: { tab: ["items", "notes"] }, hash: "top" }
  joinUrl({ path: "/orders", query: { page: 2 }, hash: "" });
  // → "/orders?page=2"
  ```

  ```js
  import { parseQuery, formatQuery } from "juris/router.js";

  const query = parseQuery("?q=milk&hasOwnProperty=1");
  query; // → { q: "milk", hasOwnProperty: "1" }
  Object.getPrototypeOf(query); // → null
  formatQuery({ q: "milk & eggs", page: 2, sort: null });
  // → "?q=milk+%26+eggs&page=2"
  formatQuery({}); // → ""
  ```

  ```js
  const router = createRouter({ routes: [{ path: "/lots/:id" }] });
  router.resolve("/lots/%E0%A4%A").params; // → { id: "%E0%A4%A" }
  router.resolve("/lots/L%201").params; // → { id: "L 1" }
  ```

  - A path starts with exactly one `/`: a backslash is read as `/` (as a browser reads it, and as
    the kernel's `canonicalPath` does), a tab or a newline is dropped (a browser drops them from a
    URL), and leading slashes collapse to one; so no target the router answers (`resolve`'s
    `redirect`, `resolveTarget`, `link().href`, a navigation) can name another host. `/\evil.com`,
    `\\evil.com` and `//evil.com` all answer `/evil.com`; `/%5Cevil.com` stays a path.

    ```js
    import { splitUrl } from "juris/router.js";

    splitUrl("/\\evil.com").path; // → "/evil.com"
    splitUrl("\\\\evil.com").path; // → "/evil.com"
    splitUrl("//evil.com").path; // → "/evil.com"
    splitUrl("/\t/evil.com").path; // → "/evil.com"
    splitUrl("/%5Cevil.com").path; // → "/%5Cevil.com"
    ```

    ```js
    const juris = new Juris();
    juris.use(createRouter({
        routes: [{ path: "/sign-in", redirect: "//evil.com" }],
    }));
    juris.api.link("//evil.com/sign-in").href; // → "/evil.com/sign-in"
    juris.api.router.resolve("/sign-in").redirect; // → "/evil.com"
    ```

- **Booting on a transferred route.** The browser adopts the route the server rendered; where it is
  the address bar's path, the address bar's query and `#fragment` are kept (the server never sees
  the fragment, and a cached page was rendered from its cache key without the query parameters it
  does not read), so the first URL write no longer replaces them away.

  ```js dom
  history.replaceState(null, "", "/orders?utm_source=mail#latest");
  const juris = new Juris({ state: { $route: { path: "/orders" } } });
  juris.use(createRouter({ routes: [{ path: "/orders" }] }));
  juris.getState("$route.query"); // → { utm_source: "mail" }
  juris.getState("$route.hash"); // → "latest"
  location.href; // → "http://localhost/orders?utm_source=mail#latest"
  ```

  ```js dom
  history.replaceState(null, "", "/order-history?page=2");
  const juris = new Juris({ state: { $route: { path: "/orders" } } });
  juris.use(createRouter({ routes: [{ path: "/orders" }] }));
  location.href; // → "http://localhost/orders"
  ```

- `Link`'s `href` follows the route (it is bound, and reads `$route.path`), and a click goes where
  the href says when it is clicked: a target resolved against the current route (a name whose
  params come from it) used to be resolved once, and `RouterView` keeps a page's instance when only
  its params change.

  ```js dom
  const juris = new Juris();
  juris.use(createRouter({
      routes: [{ path: "/orders/:id/:tab", name: "orderTab" }],
  }));
  await juris.api.navigate("/orders/7/items");
  const page = document.createElement("main");
  const notes = { name: "orderTab", params: { tab: "notes" } };
  juris.render(page, { Link: { to: notes, textContent: "Notes" } });
  page.querySelector("a").getAttribute("href"); // → "/orders/7/notes"
  await juris.api.navigate("/orders/8/items");
  page.querySelector("a").getAttribute("href"); // → "/orders/8/notes"
  page.querySelector("a").click();
  await new Promise((resolve) => setTimeout(resolve));
  location.pathname; // → "/orders/8/notes"
  ```

  ```js dom
  const juris = new Juris();
  const made = [];
  juris.registerComponent("OrderPage", (props, api) => {
      made.push(api.getState("$route.params.id"));
      const id = () => api.getState("$route.params.id");
      return { h1: { textContent: () => `Order ${id()}` } };
  });
  juris.use(createRouter({
      routes: [{ path: "/orders/:id", component: "OrderPage" }],
  }));
  await juris.api.navigate("/orders/7");
  const page = document.createElement("main");
  juris.render(page, { RouterView: {} });
  await juris.api.navigate("/orders/8");
  page.innerHTML; // → <h1>Order 8</h1>
  made; // → ["7"]
  ```

- In hash mode the route is compared with the address's fragment alone, so navigating to where the
  tab already is pushes no entry.

  ```js dom
  history.replaceState(null, "", "/shop/#/orders");
  const juris = new Juris();
  juris.use(createRouter({ routes: [{ path: "/orders" }], mode: "hash" }));
  await juris.api.navigate("/orders");
  history.length; // → 1
  location.href; // → "http://localhost/shop/#/orders"
  ```

- `ROUTER_COMPONENTS` names the components installing a router registers (`RouterView`, `Link`).

  ```js
  import { ROUTER_COMPONENTS } from "juris/router.js";

  const juris = new Juris();
  juris.use(createRouter({ routes: [] }));
  ROUTER_COMPONENTS; // → ["RouterView", "Link"]
  ROUTER_COMPONENTS.every((name) => juris.hasComponent(name)); // → true
  ```

#### `forms.js`

**Exports:** `forms` (also the default), `createForm`.

```js
import formsDefault, { forms, createForm } from "juris/forms.js";

formsDefault === forms; // → true
typeof createForm; // → "function"
```

The examples below build their own instance, from:

```js setup
import Juris from "juris/juris.js";
import { forms, createForm } from "juris/forms.js";
import { fail } from "juris/errors.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
```

Form state, validation and submit. `juris.use(forms())` adds `api.form(path, options)`;
`createForm(juris, path, options)` is the same without the plugin. The options are `fields`
(initial values), `validate` (a rule per field), `submit` (the service's name), `onSuccess` and
`onError`; the form keeps `values`, `touched`, `errors`, `valid`, `dirty`, `submitted`,
`submitting`, `error` and `serverErrors` under its path.

```js
const juris = new Juris();
juris.use(forms());
const signIn = juris.api.form("signIn", {
    fields: { email: "", remember: false },
    validate: {
        email: (value) => (value.includes("@") ? null : "Enter an email."),
    },
});
signIn.set("email", "ada");
juris.getState("signIn");
// → { values: { email: "ada", remember: false }, touched: {},
//     submitted: false, submitting: false, error: null, serverErrors: {},
//     errors: { email: "Enter an email.", remember: null },
//     valid: false, dirty: true }
```

```js
const juris = new Juris({
    services: { signIn: async ({ email }) => ({ user: email }) },
});
const signIn = createForm(juris, "signIn", {
    fields: { email: "ada@example.com" },
    submit: "signIn",
    onSuccess: (result) => juris.setValue("session.user", result.user),
});
await signIn.submit(); // → { user: "ada@example.com" }
juris.getState("session.user"); // → "ada@example.com"
```

```js
const juris = new Juris({
    services: { signIn: async () => fail("Wrong email or password.") },
});
juris.use(forms());
const errors = [];
const signIn = juris.api.form("signIn", {
    fields: { email: "ada@example.com", password: "" },
    submit: "signIn",
    onError: (error) => errors.push(error.status),
});
await signIn.submit(); // → undefined
juris.getState("signIn.error"); // → "Wrong email or password."
errors; // → [400]
```

- One form is live on a path at a time: a second `api.form` on a path whose form is still live is
  refused with an `Error` naming the path. Dispose the first (`form.dispose()`; a component's form
  goes with the component, before a redraw makes the next one), or give the second a path of its
  own: two forms on one page take two paths.

  ```js
  const juris = new Juris();
  juris.use(forms());
  const order = juris.api.form("order", { fields: { sku: "milk" } });
  juris.api.form("order", { fields: { sku: "eggs" } });
  // throws Error: Juris form "order": a form is live on this path already
  order.dispose();
  juris.api.form("order", { fields: { sku: "eggs" } }).path; // → "order"
  ```

  ```js dom
  const juris = new Juris();
  juris.use(forms());
  juris.registerComponent("Newsletter", (props, api) => {
      const form = api.form(`newsletter.${props.place}`, {
          fields: { email: "" },
      });
      return { input: form.field("email", { type: "email" }) };
  });
  const page = document.createElement("main");
  juris.render(page, {
      div: {
          children: [
              { Newsletter: { place: "header" } },
              { Newsletter: { place: "footer" } },
          ],
      },
  });
  page.querySelectorAll("input").length; // → 2
  ```

- A field's own `onblur`, `oninput` and `onchange` (in `field(name, extra)`) run after the form's
  handler, never instead of it, so a caller's `onblur` keeps touch tracking on.

  ```js dom
  const juris = new Juris();
  juris.use(forms());
  const signIn = juris.api.form("signIn", { fields: { email: "" } });
  const mine = [];
  const page = document.createElement("form");
  juris.render(page, {
      input: signIn.field("email", {
          type: "email",
          onblur: () => {
              mine.push(`blur: ${juris.getState("signIn.touched.email")}`);
          },
          oninput: () => mine.push(`input: ${signIn.values().email}`),
      }),
  });
  const input = page.querySelector("input");
  input.value = "ada@example.com";
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new Event("blur"));
  mine; // → ["input: ada@example.com", "blur: true"]
  ```

  ```js dom
  const juris = new Juris();
  juris.use(forms());
  const signUp = juris.api.form("signUp", { fields: { terms: false } });
  const page = document.createElement("form");
  juris.render(page, { input: signUp.field("terms", { type: "checkbox" }) });
  const box = page.querySelector("input");
  box.checked = true;
  box.dispatchEvent(new Event("change"));
  signUp.values(); // → { terms: true }
  ```

- `submit()` ignores a call made while the service has not answered yet (`<path>.submitting`, so for
  every form object on that path): a double click submits once, and the ignored call resolves
  `undefined` at once.

  ```js
  let placed = 0;
  const juris = new Juris({
      services: {
          placeOrder: async () => {
              placed += 1;
              await wait(10);
              return { id: 7 };
          },
      },
  });
  juris.use(forms());
  const order = juris.api.form("order", {
      fields: { sku: "milk" },
      submit: "placeOrder",
  });
  const first = order.submit();
  await order.submit(); // → undefined
  await first; // → { id: 7 }
  placed; // → 1
  ```

  ```js
  const juris = new Juris({
      services: { placeOrder: () => wait(10).then(() => ({ id: 7 })) },
  });
  juris.use(forms());
  const options = { fields: { sku: "milk" }, submit: "placeOrder" };
  const first = juris.api.form("order", options);
  const placing = first.submit();
  first.dispose();
  const redrawn = juris.api.form("order", options);
  await redrawn.submit(); // → undefined
  await placing; // → { id: 7 }
  ```

- A refusal's `fields` go to `<path>.serverErrors.<field>`, cleared by each submit as it starts (so
  a success, or a submit the rules stop, leaves none, whichever field was edited) and then set from
  a refusal's `fields`, keeping only string messages under names a path can address (not
  `__proto__`, no dot), and each field's own cleared when it changes (`set`, and so its input).

  ```js
  const juris = new Juris({
      services: {
          signUp: async () => fail("Check the form.", {
              fields: {
                  email: "Already registered.",
                  "address.city": "Unknown city.",
                  age: 17,
              },
          }),
      },
  });
  juris.use(forms());
  const signUp = juris.api.form("signUp", {
      fields: { email: "ada@example.com", city: "" },
      submit: "signUp",
  });
  await signUp.submit(); // → undefined
  juris.getState("signUp.serverErrors"); // → { email: "Already registered." }
  signUp.set("email", "grace@example.com");
  juris.getState("signUp.serverErrors"); // → {}
  ```

  ```js
  let answer = () => fail("Check the form.", { field: "email" });
  const juris = new Juris({ services: { signUp: async () => answer() } });
  juris.use(forms());
  const signUp = juris.api.form("signUp", {
      fields: { email: "ada@example.com" },
      submit: "signUp",
  });
  await signUp.submit();
  juris.getState("signUp.serverErrors"); // → { email: "Check the form." }
  answer = () => ({ id: 7 });
  await signUp.submit(); // → { id: 7 }
  juris.getState("signUp.serverErrors"); // → {}
  ```

  - `form.error(name)` is the validate rule's message when it has one to show, and the server's
    otherwise. They are kept apart from `errors.<field>`, which is the rule's computed and which
    `valid` is derived from.

    ```js
    const juris = new Juris({
        services: {
            signUp: async () => fail("Taken.", { field: "email" }),
        },
    });
    juris.use(forms());
    const signUp = juris.api.form("signUp", {
        fields: { email: "ada@example.com" },
        validate: {
            email: (value) => (value.includes("@") ? null : "Enter an email."),
        },
        submit: "signUp",
    });
    await signUp.submit();
    signUp.error("email"); // → "Taken."
    juris.getState("signUp.errors.email"); // → null
    juris.getState("signUp.valid"); // → true
    signUp.set("email", "ada");
    signUp.error("email"); // → "Enter an email."
    ```

- A service that answered is a success: `onSuccess` throwing, or rejecting, goes to the console,
  never to `<path>.error` or `onError` (it used to read as a failed save, and the user saved again).

  ```js
  const juris = new Juris({
      services: { saveCart: async () => ({ saved: true }) },
  });
  juris.use(forms());
  const failures = [];
  const cart = juris.api.form("cart", {
      fields: { note: "" },
      submit: "saveCart",
      onSuccess: () => {
          throw new Error("showToast is not defined");
      },
      onError: (error) => failures.push(error),
  });
  await cart.submit(); // → { saved: true }
  // console.error: Juris form "cart": onSuccess failed after the submit succeeded
  juris.getState("cart.error"); // → null
  failures; // → []
  ```

- `reset()` clears `submitting` too, so a submit that never answers does not leave the form refusing
  every submit; the answer of a submit made before a `reset()` then leaves the form's state alone
  (`onSuccess` or `onError` is still told).

  ```js
  let answer;
  const juris = new Juris({
      services: {
          saveCart: () => new Promise((resolve) => {
              answer = resolve;
          }),
      },
  });
  juris.use(forms());
  const told = [];
  const cart = juris.api.form("cart", {
      fields: { note: "" },
      submit: "saveCart",
      onSuccess: (result) => told.push(result),
  });
  const hung = cart.submit();
  juris.getState("cart.submitting"); // → true
  cart.reset();
  juris.getState("cart.submitting"); // → false
  answer({ saved: true });
  await hung; // → { saved: true }
  told; // → [{ saved: true }]
  juris.getState("cart.submitted"); // → false
  ```

  - The stubs' `timeoutMs` (`remote-services.js`) ends such a call on its own.

    ```js
    import { remoteServices } from "juris/remote-services.js";

    const services = remoteServices(["saveCart"], {
        fetch: () => new Promise(() => {}),
        timeoutMs: 20,
    });
    const juris = new Juris({ services });
    juris.use(forms());
    const cart = juris.api.form("cart", {
        fields: { note: "" },
        submit: "saveCart",
    });
    await cart.submit(); // → undefined
    juris.getState("cart.submitting"); // → false
    juris.getState("cart.error");
    // → "The request took too long; it may or may not have been applied."
    ```

#### `remote-services.js`

**Exports:** `remoteServices`, `sseClient`, `diff` (from `live-protocol.js`).

The examples on this page import them, and the core:

```js setup
import {
    remoteServices, sseClient, diff,
} from "juris/remote-services.js";
import Juris from "juris/juris.js";
```

```js
import * as protocol from "juris/live-protocol.js";

diff === protocol.diff; // → true
diff({ count: 12 }, { count: 11 }); // → { set: [["count", 11]], del: [] }
```

The browser half of services and live queries. The server half, `serviceDispatcher`, is
`server/service-dispatcher.js`, which no browser downloads.

```js
import { createServer } from "node:http";
import {
    serviceDispatcher,
} from "juris-kit/server/service-dispatcher.js";
import { fail } from "juris/errors.js";

const dispatch = serviceDispatcher({
    price: (sku) => {
        return sku === "milk" ? 3 : fail("No such product.", { status: 404 });
    },
});
const server = createServer((request, response) => dispatch(request, response));
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://localhost:${server.address().port}/api`;
const { price } = remoteServices(["price"], { base });
await price("milk"); // → 3
await price("kale");
// throws ServiceError: No such product.
server.close();
```

- **`remoteServices(names, { base = "/api", fallback, fetch, timeoutMs = 30000 })`** answers one
  stub per name, each posting its arguments as JSON to `${base}/<name>`; a string second argument is
  still the base.

  ```js
  const sent = [];
  const services = remoteServices(["saveCart", "placeOrder"], {
      base: "/shop/api",
      fetch: async (url, init) => {
          sent.push(`${init.method} ${url} ${init.body}`);
          return Response.json({ saved: true });
      },
  });
  const juris = new Juris({ services });
  await juris.api.call("saveCart", { items: 2 }); // → { saved: true }
  sent; // → ['POST /shop/api/saveCart [{"items":2}]']
  ```

  ```js
  globalThis.fetch = async (url) => Response.json(`answered by ${url}`);
  const { price } = remoteServices(["price"], "/v2/api");
  await price("milk"); // → "answered by /v2/api/price"
  ```

  - A refusal rejects with a `ServiceError` carrying the status and the answer's `fields`, `field`
    and `code`; `fallback({ name, response, json })` gives the words when the answer has none, by
    default the status line (`502 Bad Gateway`).

    ```js
    const refusal = {
        error: "Check the post.",
        field: "title",
        fields: { title: "At most 80 characters." },
        code: "post.invalid",
    };
    const { savePost } = remoteServices(["savePost"], {
        fetch: async () => Response.json(refusal, { status: 422 }),
    });
    const error = await savePost({ title: "…" }).catch((error) => error);
    error.message; // → "Check the post."
    error.status; // → 422
    error.field; // → "title"
    error.fields; // → { title: "At most 80 characters." }
    error.code; // → "post.invalid"
    ```

    ```js
    const proxyPage = () => {
        return new Response("<h1>Bad Gateway</h1>", {
            status: 502,
            statusText: "Bad Gateway",
        });
    };
    const { price } = remoteServices(["price"], { fetch: async () => proxyPage() });
    await price("milk");
    // throws ServiceError: 502 Bad Gateway
    const { stock } = remoteServices(["stock"], {
        fetch: async () => proxyPage(),
        fallback: (failure) => `${failure.name}: ${failure.response.status}`,
    });
    await stock("milk");
    // throws ServiceError: stock: 502
    ```

  - A 2xx answer whose body is not JSON rejects with a `ServiceError` of status 502, code
    `response.not-json` (`fallback`'s words): it used to resolve `{ error: "200 OK" }`, so a captive
    portal's page read as saved. The dispatcher always answers JSON.

    ```js
    const portal = () => {
        return new Response("<form>Sign in to the café Wi-Fi</form>", {
            status: 200,
            statusText: "OK",
        });
    };
    const { saveCart } = remoteServices(["saveCart"], {
        fetch: async () => portal(),
    });
    const error = await saveCart({ items: 2 }).catch((error) => error);
    error.status; // → 502
    error.code; // → "response.not-json"
    error.message; // → "200 OK"
    ```

  - `timeoutMs` is how long a call (its answer and its body) may take, whole milliseconds from 0
    (no limit) to 2^31 − 1, anything else refused with a `TypeError`; a call that takes longer is
    aborted and rejects with a `ServiceError` of status 408, code `request.timeout`, and the words
    "The request took too long; it may or may not have been applied.".

    ```js
    let aborted = false;
    const { saveCart } = remoteServices(["saveCart"], {
        timeoutMs: 20,
        fetch: (url, init) => new Promise(() => {
            init.signal.addEventListener("abort", () => {
                aborted = true;
            });
        }),
    });
    const error = await saveCart({ items: 2 }).catch((error) => error);
    error.message;
    // → "The request took too long; it may or may not have been applied."
    error.status; // → 408
    error.code; // → "request.timeout"
    aborted; // → true
    ```

    ```js
    remoteServices(["saveCart"], { timeoutMs: 1.5 });
    // throws TypeError: remoteServices: timeoutMs is a whole number of
    //   milliseconds from 0 (no limit) to 2147483647, not 1.5
    const { saveCart } = remoteServices(["saveCart"], {
        timeoutMs: 0,
        fetch: async () => Response.json({ saved: true }),
    });
    await saveCart({ items: 2 }); // → { saved: true }
    ```

- **`sseClient(options)`** is the live client, installed with `juris.use`: one event stream per
  instance, subscribes posted to `${base}/_live`, and each patch written where the view asked.

  The live examples below give it a test's stream (`EventSourceImpl`), whose server side is
  `emit(type, data)`, and a `fetch` that keeps the subscribes:

  ```js setup
  class TestStream {
      static last = null;
      readyState = 0;
      listeners = {};

      constructor(url) {
          this.url = url;
          TestStream.last = this;
      }

      addEventListener(type, listener) {
          (this.listeners[type] ??= []).push(listener);
      }

      close() {
          this.readyState = 2;
      }

      emit(type, data = {}) {
          for (const listener of this.listeners[type] ?? []) {
              listener({ data: JSON.stringify(data) });
          }
      }
  }

  const posted = [];
  globalThis.fetch = async (url, init) => {
      posted.push({ url, ...JSON.parse(init.body) });
      return Response.json({ ok: true });
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve));
  ```

  ```js
  const juris = new Juris();
  juris.use(sseClient({ base: "/shop/api", EventSourceImpl: TestStream }));
  juris.api.live("stock.milk", "stock", "milk");
  const stream = TestStream.last;
  stream.url; // → "/shop/api/events"
  stream.emit("hello", { client: "tab-1" });
  await tick();
  posted;
  // → [{ url: "/shop/api/_live", client: "tab-1",
  //      subscribe: { key: 'stock:["milk"]', name: "stock", args: ["milk"] } }]
  stream.emit("patch", { key: 'stock:["milk"]', full: { count: 12 } });
  juris.getState("stock.milk"); // → { count: 12 }
  stream.emit("patch", { key: 'stock:["milk"]', set: [["count", 11]] });
  juris.getState("stock.milk"); // → { count: 11 }
  ```

  - Options: `base`; `EventSourceImpl`, the class to use (a test's fake); `idleMs = 10000`, how long
    a stream with nothing left to watch is kept, so a navigation reuses it (0: until the current
    turn of the event loop is over);

    ```js
    const juris = new Juris();
    juris.use(sseClient({ EventSourceImpl: TestStream, idleMs: 20 }));
    const leave = juris.api.live("orders", "orders", { page: 1 });
    const stream = TestStream.last;
    leave();
    juris.api.live("orders", "orders", { page: 2 });
    TestStream.last === stream; // → true
    ```

    ```js
    const juris = new Juris();
    juris.use(sseClient({ EventSourceImpl: TestStream, idleMs: 20 }));
    const leave = juris.api.live("orders", "orders");
    leave();
    TestStream.last.readyState; // → 0
    await new Promise((resolve) => setTimeout(resolve, 30));
    TestStream.last.readyState; // → 2
    ```

  - `hiddenMs = null`, how long a tab may stay hidden (`document.visibilityState`, the tab in the
    background, the window minimised) before its stream is given back to the server: its
    subscriptions are kept and its paths are `"offline"`, nothing is sent to it meanwhile, and the
    moment it is shown again a new stream opens, every subscription is announced again and each
    path is `"pending"` until its fresh full answer (a whole number of milliseconds from 0 to
    2^31 − 1; `null`, the default, keeps the stream however long the tab is hidden, as before). A
    tab shown again before `hiddenMs` keeps its stream; one already hidden when its stream opens (a
    tab opened in the background) counts `hiddenMs` from that opening. A hidden tab's pause is a
    close on purpose: no reconnect is counted;

    ```js dom
    const showTab = (state) => {
        Object.defineProperty(document, "visibilityState", {
            value: state,
            configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
    };
    const juris = new Juris();
    juris.use(sseClient({ EventSourceImpl: TestStream, hiddenMs: 20 }));
    juris.api.live("orders", "orders");
    const first = TestStream.last;
    first.emit("hello", { client: "tab-1" });
    showTab("hidden");
    await new Promise((resolve) => setTimeout(resolve, 30));
    first.readyState; // → 2
    juris.api.liveState("orders"); // → "offline"
    showTab("visible");
    TestStream.last === first; // → false
    TestStream.last.emit("hello", { client: "tab-2" });
    juris.api.liveState("orders"); // → "pending"
    juris.getState("$live.reconnects"); // → undefined
    ```

    ```js dom
    const showTab = (state) => {
        Object.defineProperty(document, "visibilityState", {
            value: state,
            configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
    };
    const juris = new Juris();
    juris.use(sseClient({ EventSourceImpl: TestStream, hiddenMs: 30 }));
    juris.api.live("orders", "orders");
    const stream = TestStream.last;
    showTab("hidden");
    await new Promise((resolve) => setTimeout(resolve, 10));
    showTab("visible");
    await new Promise((resolve) => setTimeout(resolve, 30));
    stream.readyState; // → 0
    TestStream.last === stream; // → true
    ```

    ```js dom
    Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
    });
    const juris = new Juris();
    juris.use(sseClient({ EventSourceImpl: TestStream, hiddenMs: 20 }));
    juris.api.live("orders", "orders");
    const opened = TestStream.last;
    await new Promise((resolve) => setTimeout(resolve, 30));
    opened.readyState; // → 2
    ```

  - `statePath = "$live"`, where the connection is written, `.connected` and `.generation`, one
    more on every hello (continuing from what the state holds), so a component that watches it
    hears of every stream the server greets without polling, and `.reconnects`, one more on every
    hello that brings back a stream that was lost (an error: an instance restarted, the network
    dropped, the stream was refused and reopened), never on a first open or on an open after the
    stream was given back on purpose (the idle close, `dispose()`), so a component that wants to
    hear of a restart watches it rather than the generation, which rises whenever a page opens a
    stream again, and `.paths.<path>`, each live path's status (see `liveState` in "The component
    api");

    ```js
    const juris = new Juris();
    juris.use(sseClient({ EventSourceImpl: TestStream }));
    juris.api.live("orders", "orders");
    const stream = TestStream.last;
    stream.emit("hello", { client: "tab-1" });
    juris.getState("$live");
    // → { connected: true, generation: 1,
    //     paths: { orders: { status: "pending" } } }
    stream.emit("error");
    juris.getState("$live.connected"); // → false
    stream.emit("hello", { client: "tab-2" });
    juris.getState("$live.generation"); // → 2
    juris.getState("$live.reconnects"); // → 1
    ```

    ```js
    const juris = new Juris();
    juris.use(sseClient({ EventSourceImpl: TestStream, statePath: "shop.live" }));
    juris.api.live("orders", "orders");
    TestStream.last.emit("hello", { client: "tab-1" });
    juris.getState("shop.live.connected"); // → true
    juris.api.liveStatus(); // → true
    ```

  - `onHello({ clientId, generation })`, told of every hello, and `onReconnect`, of every one after
    an install's first (an open after the idle close among them, which `.reconnects` leaves out);

    ```js
    const told = [];
    const juris = new Juris();
    juris.use(sseClient({
        EventSourceImpl: TestStream,
        idleMs: 0,
        onHello: ({ clientId, generation }) => {
            told.push(`hello ${clientId} ${generation}`);
        },
        onReconnect: ({ generation }) => told.push(`reconnect ${generation}`),
    }));
    const leave = juris.api.live("orders", "orders");
    TestStream.last.emit("hello", { client: "tab-1" });
    leave();
    await tick();
    juris.api.live("orders", "orders");
    TestStream.last.emit("hello", { client: "tab-2" });
    told; // → ["hello tab-1 1", "hello tab-2 2", "reconnect 2"]
    juris.getState("$live.reconnects"); // → undefined
    ```

  - `onError(error, name, args)`, told of a subscribe refused for good (not a stale id, which opens
    a new stream, nor a busy server, asked again), with a `ServiceError` carrying the status, words
    and code, and the console told when there is none, and the path's status is `"failed"` with
    the same words, as it is when the server could not run the query again (a patch with `error`),
    until the next answer;

    ```js
    const refusal = { error: "No such live query.", code: "live.not-a-query" };
    globalThis.fetch = async () => Response.json(refusal, { status: 403 });
    const refused = [];
    const juris = new Juris();
    juris.use(sseClient({
        EventSourceImpl: TestStream,
        onError: (error, name) => {
            refused.push(`${name}: ${error.status} ${error.code}`);
        },
    }));
    juris.api.live("orders", "orders");
    TestStream.last.emit("hello", { client: "tab-1" });
    await tick();
    refused; // → ["orders: 403 live.not-a-query"]
    juris.api.liveState("orders"); // → "failed"
    juris.api.liveMessage("orders"); // → "No such live query."
    ```

    ```js
    globalThis.fetch = async () => {
        return Response.json({ error: "Sign in first." }, { status: 401 });
    };
    const juris = new Juris();
    juris.use(sseClient({ EventSourceImpl: TestStream }));
    juris.api.live("orders", "orders");
    TestStream.last.emit("hello", { client: "tab-1" });
    await tick();
    // console.error: Juris live query "orders" was refused (401): Sign in first.
    juris.api.liveMessage("orders"); // → "Sign in first."
    ```

    ```js
    const juris = new Juris();
    juris.use(sseClient({ EventSourceImpl: TestStream }));
    juris.api.live("orders", "orders");
    const stream = TestStream.last;
    stream.emit("hello", { client: "tab-1" });
    stream.emit("patch", { key: "orders:[]", error: "the database is down" });
    // console.error: Juris live query "orders" failed on the server:
    juris.api.liveState("orders"); // → "failed"
    stream.emit("patch", { key: "orders:[]", full: [{ id: 7 }] });
    juris.api.liveState("orders"); // → "live"
    ```

  - `backoff = { minMs: 1000, maxMs: 30000 }`, the wait before a refused stream is reopened or a
    busy server asked again, doubling from `minMs` to `maxMs` and back to `minMs` after a hello.

    ```js
    const juris = new Juris();
    juris.use(sseClient({
        EventSourceImpl: TestStream,
        backoff: { minMs: 10, maxMs: 40 },
    }));
    juris.api.live("orders", "orders");
    const refused = TestStream.last;
    refused.readyState = 2;
    refused.emit("error");
    TestStream.last === refused; // → true
    await new Promise((resolve) => setTimeout(resolve, 20));
    TestStream.last === refused; // → false
    ```

- The transport's `subscribe(key, name, args, path, { seeded })` takes whether the preload's answer
  is already on screen (then the path starts `"live"`); every path it keeps is `"offline"` while the
  stream is down (an error, a reopen, `close()` with paths still subscribed), and `"pending"` again
  from the hello that brings it back until the new full answer.

  ```js
  const juris = new Juris({ services: { orders: async () => [] } });
  juris.clearState({ $ssr: { calls: { "orders:[]": [{ id: 7 }] } } });
  juris.use(sseClient({ EventSourceImpl: TestStream }));
  juris.api.live("orders", "orders");
  juris.api.liveState("orders"); // → "live"
  juris.getState("orders"); // → [{ id: 7 }]
  ```

  ```js
  const juris = new Juris();
  juris.use(sseClient({ EventSourceImpl: TestStream }));
  juris.liveTransport.subscribe("orders:[]", "orders", [], "orders");
  const stream = TestStream.last;
  stream.emit("hello", { client: "tab-1" });
  stream.emit("patch", { key: "orders:[]", full: [{ id: 7 }] });
  juris.api.liveState("orders"); // → "live"
  stream.emit("error");
  juris.api.liveState("orders"); // → "offline"
  stream.emit("hello", { client: "tab-2" });
  juris.api.liveState("orders"); // → "pending"
  ```

- A page put in the browser's back/forward cache gives its stream back on its `pagehide`, whatever
  the options: a cached page used to keep its stream open (Chrome keeps it), a browser keeps six
  connections to a host over HTTP/1.1, and after about six pages the next one waited for a
  connection. It is a pause, as a hidden tab's is: the subscriptions are kept, each path is
  `"offline"`, and the data on screen is left as it was.

  ```js dom
  const juris = new Juris();
  juris.use(sseClient({ EventSourceImpl: TestStream }));
  juris.api.live("orders", "orders");
  const stream = TestStream.last;
  stream.emit("hello", { client: "tab-1" });
  stream.emit("patch", { key: "orders:[]", full: [{ id: 7 }] });
  const away = new PageTransitionEvent("pagehide", { persisted: true });
  window.dispatchEvent(away);
  stream.readyState; // → 2
  juris.api.liveStatus(); // → false
  juris.api.liveState("orders"); // → "offline"
  juris.getState("orders"); // → [{ id: 7 }]
  ```

  - Its `pageshow` from the cache (`persisted`) opens a new stream, whose hello announces every
    subscription again, as on a reconnect: each path is `"pending"` until its fresh full answer,
    then `"live"`. It is no reconnect (`.reconnects` does not count it).

    ```js dom
    const juris = new Juris();
    juris.use(sseClient({ EventSourceImpl: TestStream }));
    juris.api.live("orders", "orders");
    const first = TestStream.last;
    first.emit("hello", { client: "tab-1" });
    const away = new PageTransitionEvent("pagehide", { persisted: true });
    window.dispatchEvent(away);
    const back = new PageTransitionEvent("pageshow", { persisted: true });
    window.dispatchEvent(back);
    const again = TestStream.last;
    again === first; // → false
    again.emit("hello", { client: "tab-2" });
    await tick();
    posted.map((body) => body.client); // → ["tab-1", "tab-2"]
    juris.api.liveState("orders"); // → "pending"
    again.emit("patch", { key: "orders:[]", full: [{ id: 7 }, { id: 8 }] });
    juris.api.liveState("orders"); // → "live"
    juris.getState("$live.reconnects"); // → undefined
    ```

  - A page shown for the first time (a `pageshow` that is not `persisted`) has its stream already,
    and opens none.

    ```js dom
    const juris = new Juris();
    juris.use(sseClient({ EventSourceImpl: TestStream }));
    juris.api.live("orders", "orders");
    const stream = TestStream.last;
    const first = new PageTransitionEvent("pageshow", { persisted: false });
    window.dispatchEvent(first);
    TestStream.last === stream; // → true
    stream.readyState; // → 0
    ```

  - Every `pagehide` gives the stream back, the page kept in the cache or leaving for good, and
    until the `pageshow` from the cache nothing opens another: a subscribe made meanwhile waits,
    `"offline"`, and is announced with the rest.

    ```js dom
    const juris = new Juris();
    juris.use(sseClient({ EventSourceImpl: TestStream }));
    juris.api.live("orders", "orders");
    const stream = TestStream.last;
    const leaving = new PageTransitionEvent("pagehide", { persisted: false });
    window.dispatchEvent(leaving);
    stream.readyState; // → 2
    ```

    ```js dom
    const juris = new Juris();
    juris.use(sseClient({ EventSourceImpl: TestStream }));
    juris.api.live("orders", "orders");
    TestStream.last.emit("hello", { client: "tab-1" });
    await tick();
    const away = new PageTransitionEvent("pagehide", { persisted: true });
    window.dispatchEvent(away);
    const stream = TestStream.last;
    juris.api.live("stock", "stock", "milk");
    TestStream.last === stream; // → true
    juris.api.liveState("stock"); // → "offline"
    const back = new PageTransitionEvent("pageshow", { persisted: true });
    window.dispatchEvent(back);
    TestStream.last.emit("hello", { client: "tab-2" });
    await tick();
    posted.filter((body) => body.client === "tab-2").map((body) => {
        return body.subscribe.name;
    });
    // → ["orders", "stock"]
    ```

- A subscribe refused for a stale client id is known by its code, `live.client-unknown`, and a new
  stream is opened; an answer with no code (a server from before the codes) is matched on its
  words, `/client id/i`, for one release, so either build's client recovers from either build's
  server during a rolling deploy, and an answer with another code is never taken for a stale id.

  ```js
  const stale = { error: "unknown client id", code: "live.client-unknown" };
  globalThis.fetch = async () => Response.json(stale, { status: 403 });
  const juris = new Juris();
  juris.use(sseClient({ EventSourceImpl: TestStream, backoff: { minMs: 1 } }));
  juris.api.live("orders", "orders");
  const signedOut = TestStream.last;
  signedOut.emit("hello", { client: "tab-1" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  signedOut.readyState; // → 2
  TestStream.last === signedOut; // → false
  ```

  ```js
  globalThis.fetch = async () => {
      return Response.json({ error: "Unknown client id." }, { status: 403 });
  };
  const juris = new Juris();
  juris.use(sseClient({ EventSourceImpl: TestStream, backoff: { minMs: 1 } }));
  juris.api.live("orders", "orders");
  const old = TestStream.last;
  old.emit("hello", { client: "tab-1" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  TestStream.last === old; // → false
  ```

  ```js
  const words = "This client id may not read orders.";
  const forbidden = { error: words, code: "orders.forbidden" };
  globalThis.fetch = async () => Response.json(forbidden, { status: 403 });
  const juris = new Juris();
  juris.use(sseClient({ EventSourceImpl: TestStream, onError: () => {} }));
  juris.api.live("orders", "orders");
  const stream = TestStream.last;
  stream.emit("hello", { client: "tab-1" });
  await tick();
  TestStream.last === stream; // → true
  juris.api.liveState("orders"); // → "failed"
  ```

- A hook that throws or rejects goes to the console and stops nothing.

  ```js
  const juris = new Juris();
  juris.use(sseClient({
      EventSourceImpl: TestStream,
      onHello: () => {
          throw new Error("analytics is down");
      },
  }));
  juris.api.live("orders", "orders");
  TestStream.last.emit("hello", { client: "tab-1" });
  // console.error: Juris live: onHello failed
  juris.getState("$live.connected"); // → true
  ```

  - Construction refuses a `backoff` whose bounds are not whole milliseconds with 1 ≤ `minMs` ≤
    `maxMs` ≤ 2^31 − 1, an `idleMs` or a `hiddenMs` (other than `null`) that is not a whole number
    of milliseconds from 0 to 2^31 − 1, an empty `statePath` and a hook that is not a function, and
    a key that is none of the options above, or one in `backoff` other than `minMs` and `maxMs`
    (`hydrate` hands its `live` object here, so the same keys hold there).

    ```js
    sseClient({ backoff: { minMs: 0 } });
    // throws TypeError: sseClient: backoff is { minMs, maxMs }, whole milliseconds
    sseClient({ idleMs: 0.5 });
    // throws TypeError: sseClient: idleMs is a whole number of milliseconds
    sseClient({ hiddenMs: -1 });
    // throws TypeError: sseClient: hiddenMs is null or a whole number
    sseClient({ statePath: "" });
    // throws TypeError: sseClient: statePath is a state path
    ```

    ```js
    sseClient({ onError: "console" });
    // throws TypeError: sseClient: onError is a function
    sseClient({ idleMS: 0 });
    // throws TypeError: sseClient: "idleMS" is not an option
    sseClient({ backoff: { min: 10 } });
    // throws TypeError: sseClient: backoff.min is not an option (minMs, maxMs)
    ```

- The plugin it returns has `dispose()`: every stream closed, every timer cancelled, the
  `visibilitychange`, `pagehide` and `pageshow` listeners removed, every live path's status it kept
  removed, and the transport taken off each instance it was installed on.

  ```js
  const juris = new Juris();
  const live = sseClient({ EventSourceImpl: TestStream });
  juris.use(live);
  juris.api.live("orders", "orders");
  const stream = TestStream.last;
  live.dispose();
  stream.readyState; // → 2
  juris.getState("$live.paths"); // → {}
  juris.liveTransport; // → null
  ```

  ```js dom
  const juris = new Juris();
  const live = sseClient({ EventSourceImpl: TestStream });
  juris.use(live);
  juris.api.live("orders", "orders");
  const stream = TestStream.last;
  live.dispose();
  const away = new PageTransitionEvent("pagehide", { persisted: true });
  window.dispatchEvent(away);
  const back = new PageTransitionEvent("pageshow", { persisted: true });
  window.dispatchEvent(back);
  TestStream.last === stream; // → true
  ```

  - An instance has one live client at a time: once it is disposed, `juris.use` takes another, and
    `api.liveStatus`, which the instance's first client adds, reads the connection wherever the
    current one writes it; a client installed while another is live, or on an api whose
    `liveStatus` is not a live client's, is refused before anything is installed.

    ```js
    const juris = new Juris();
    const first = sseClient({ EventSourceImpl: TestStream });
    juris.use(first);
    juris.use(sseClient({ EventSourceImpl: TestStream }));
    // throws Error: sseClient: this Juris instance has a live client already
    first.dispose();
    juris.use(sseClient({ EventSourceImpl: TestStream, statePath: "shop.live" }));
    juris.api.live("orders", "orders");
    TestStream.last.emit("hello", { client: "tab-1" });
    juris.api.liveStatus(); // → true
    ```

    ```js
    const juris = new Juris();
    juris.extendApi({ liveStatus: () => "online" });
    juris.use(sseClient({ EventSourceImpl: TestStream }));
    // throws Error: sseClient: the api already has a "liveStatus" that is no live
    //   client's
    juris.liveTransport; // → undefined
    ```

#### `client.js`

**Exports:** `hydrate` (also the default).

```js
import boot, { hydrate } from "juris/client.js";

boot === hydrate; // → true
```

The examples below boot on the stand-in page: `serverPage` writes the page the server sent
(its markup in `#app`, its state in `#state`), and `app(layout)` is a `register` that draws one
layout. Node has no `requestIdleCallback`, so here the idle steps run on the next turn, and
`memoryStorage` stands in for a tab's `sessionStorage`.

```js setup
import { hydrate } from "juris/client.js";

// The page the server sent: its markup, its state, and any more of it.
function serverPage(state, { markup = "<p>Loading…</p>", more = "" } = {}) {
    const json = JSON.stringify(state);
    document.body.innerHTML = [
        `<div id="app">${markup}</div>`,
        `<script type="application/json" id="state">${json}</script>`,
        more,
    ].join("");
}

// A register that draws `layout` as the App component.
const app = (layout) => (juris) => {
    juris.registerComponent("App", () => layout);
};

const routes = [
    { path: "/", name: "home" },
    { path: "/cart", name: "cart" },
];

// A browser runs idle work when it is idle; here, on the next turn.
globalThis.requestIdleCallback = (work) => setTimeout(work, 0);

// A tab's sessionStorage, kept in memory.
function memoryStorage() {
    const kept = new Map();
    return {
        getItem: (key) => kept.get(key) ?? null,
        setItem: (key, value) => kept.set(key, String(value)),
        removeItem: (key) => kept.delete(key),
    };
}
```

`hydrate(options)` is the client boot: what an app's browser entry does, so the entry is its
options and one call (`export const start = () => hydrate({ routes, register })`).

```js dom
// The app's browser entry: its options and one call.
export const start = () => hydrate({
    routes,
    register: app({ p: "Your cart" }),
});

serverPage({ $route: { path: "/cart" } });
await start();
document.getElementById("app").innerHTML; // → <p>Your cart</p>
```

It answers a promise of the live instance, or `null` when the skew guard reloads.

```js dom
serverPage({ $route: { path: "/cart" }, cart: { count: 2 } });
const juris = await hydrate({ routes, register: app({ p: "Your cart" }) });
juris.isServer; // → false
juris.getState("cart.count"); // → 2
```

It reads the page contract ("The page contract"), and its order is fixed, because each step needs
the one before:

```js dom
serverPage({ $route: { path: "/cart" } });
const steps = [];
await hydrate({
    routes: [{ path: "/cart", load: async () => steps.push("load") }],
    plugins: [
        () => {
            steps.push("plugins");
        },
    ],
    register(juris) {
        steps.push("register");
        juris.registerComponent("Cart", () => {
            steps.push("mount");
            return { p: "Your cart" };
        });
    },
    beforeMount: () => steps.push("beforeMount"),
    root: { Cart: {} },
});
steps; // → ["plugins", "register", "load", "beforeMount", "mount"]
```

1. parse the state;

   ```js dom
   // The page's content may hold an id="state" of its own: only the
   // server's JSON script is the state.
   serverPage(
       { $route: { path: "/cart" }, cart: { items: ["Milk", "Eggs"] } },
       { markup: '<span id="state">In stock</span>' },
   );
   const juris = await hydrate({ routes, register: app({ p: "Your cart" }) });
   juris.getState("cart.items"); // → ["Milk", "Eggs"]
   ```

   A page with no such script (left out, or written without `type="application/json"`) has no
   state to boot on: the promise rejects with an `Error` naming the script it looked for, before
   anything is installed or drawn, and the server's markup stays.

   ```js dom
   document.body.innerHTML = [
       '<div id="app"><p>Your cart</p></div>',
       '<script id="state">{"cart":{"count":2}}</script>',
   ].join("");
   await hydrate({ routes, register: app({ p: "Cart" }) });
   // throws Error: hydrate: the page has no <script type="application/json"
   //   id="state">, the state the server rendered it with ("The page contract")
   document.getElementById("app").innerHTML; // → <p>Your cart</p>
   ```

2. construct the instance, its services `remoteServices(names, { base: apiBase, fallback })`
   (`apiBase` `"/api"`), its components (`juris.components`, below: registered as it is built,
   before any plugin and `register`), in devMode with the devtools feature, its module imported
   here and only then (below);

   ```js dom
   const Badge = () => ({ b: "2 in cart" });
   serverPage({ $route: { path: "/cart" } });
   const seen = [];
   await hydrate({
       routes,
       juris: { components: { Badge } },
       plugins: [
           (juris) => {
               seen.push(juris.hasComponent("Badge"));
           },
       ],
       register: app({ Badge: {} }),
   });
   seen; // → [true]
   document.getElementById("app").innerHTML; // → <b>2 in cart</b>
   ```

   ```js dom
   const services = [
       '<script type="application/json" id="services">',
       '["price"]',
       "</script>",
   ].join("");
   serverPage({ $route: { path: "/cart" } }, { more: services });
   const asked = [];
   globalThis.fetch = async (url, { method, body }) => {
       asked.push(`${method} ${url} ${body}`);
       return Response.json(3);
   };
   const juris = await hydrate({ routes, register: app({ p: "Your cart" }) });
   await juris.api.call("price", "milk"); // → 3
   asked; // → ['POST /api/price ["milk"]']
   ```

   ```js dom
   serverPage({ $route: { path: "/cart" } });
   const asked = [];
   globalThis.fetch = async (url) => {
       asked.push(url);
       return new Response("<h1>Bad gateway</h1>", { status: 502 });
   };
   const juris = await hydrate({
       routes,
       services: ["price"],
       apiBase: "/shop-api",
       fallback: ({ name }) => `${name} is not answering`,
       register: app({ p: "Your cart" }),
   });
   await juris.api.call("price", "milk");
   // throws ServiceError: price is not answering
   asked; // → ["/shop-api/price"]
   ```

   ```js dom
   serverPage({ $route: { path: "/cart" } });
   const juris = await hydrate({
       routes,
       devMode: true,
       register: app({ p: "Your cart" }),
   });
   // console.info: Juris: devMode is on, so this instance is exposed
   juris.devtools.endpoint.protocol; // → 1
   ```

3. install the router made from `routes` and `router` (the router's own options: its `guard`, the
   one the server's router asks, and `context(api)`, what `navigate` asks it with; made before the
   page is read, so an option it refuses is refused first), the live client (`sseClient` at the same
   base unless `live` is `false`; an object is its options), then the app's `plugins` in order,
   which the server installs in the same order, since an api name is taken once;

   ```js dom
   serverPage({ $route: { path: "/" }, user: { admin: false } });
   const juris = await hydrate({
       routes: [
           { path: "/", name: "home" },
           { path: "/admin", name: "admin", meta: { admin: true } },
       ],
       router: {
           guard: (to, ctx) => (to.meta.admin && !ctx.admin ? "/" : null),
           context: (api) => ({ admin: api.getState("user.admin") }),
       },
       register: app({ p: "Shop" }),
   });
   await juris.api.navigate("/admin");
   juris.getState("$route.path"); // → "/"
   juris.setValue("user.admin", true);
   await juris.api.navigate("/admin");
   juris.getState("$route.path"); // → "/admin"
   ```

   ```js dom
   // A stand-in for the browser's EventSource, given through `live`.
   class FakeEventSource {
       static opened = [];
       constructor(url) {
           FakeEventSource.opened.push(url);
       }
       addEventListener() {}
       close() {}
   }
   serverPage({ $route: { path: "/cart" } });
   const juris = await hydrate({
       routes,
       apiBase: "/shop-api",
       live: { EventSourceImpl: FakeEventSource },
       register(juris) {
           juris.registerComponent("App", (props, api) => {
               api.live("stock", "stock");
               return { p: "In stock" };
           });
       },
   });
   FakeEventSource.opened; // → ["/shop-api/events"]
   juris.api.liveStatus(); // → false
   const offline = await hydrate({ routes, live: false, register: app({}) });
   "liveStatus" in offline.api; // → false
   ```

   ```js dom
   serverPage({ $route: { path: "/cart" } });
   const euros = () => ({ money: (amount) => `${amount} €` });
   const dollars = () => ({ money: (amount) => `$${amount}` });
   const juris = await hydrate({
       routes,
       plugins: [euros],
       register: app({ p: "Your cart" }),
   });
   juris.api.money(3); // → "3 €"
   await hydrate({ routes, plugins: [euros, dollars], register: app({}) });
   // throws Error: Juris.extendApi: the api already has "money"
   ```

   The live client gives its stream back while the page is in the browser's back/forward cache,
   and takes it again when the page is shown from it, each live path `"offline"` meanwhile
   ("`remote-services.js`"): a browser entry needs no `pagehide` or `pageshow` of its own.

   ```js dom
   class FakeEventSource {
       static opened = [];
       readyState = 0;
       constructor() {
           FakeEventSource.opened.push(this);
       }
       addEventListener() {}
       close() {
           this.readyState = 2;
       }
   }
   serverPage({ $route: { path: "/cart" } });
   const juris = await hydrate({
       routes,
       live: { EventSourceImpl: FakeEventSource },
       register: app({}),
   });
   juris.api.live("stock", "stock");
   const [first] = FakeEventSource.opened;
   window.dispatchEvent(
       new PageTransitionEvent("pagehide", { persisted: true }),
   );
   first.readyState; // → 2
   juris.api.liveState("stock"); // → "offline"
   window.dispatchEvent(
       new PageTransitionEvent("pageshow", { persisted: true }),
   );
   FakeEventSource.opened.length; // → 2
   ```

4. `register(juris)`;

   ```js dom
   serverPage({ $route: { path: "/cart" } });
   const juris = await hydrate({
       routes,
       register(juris) {
           juris.registerComponent("App", () => ({ CartBadge: {} }));
           juris.registerComponent("CartBadge", () => ({ b: "2 in cart" }));
       },
   });
   juris.hasComponent("CartBadge"); // → true
   document.getElementById("app").innerHTML; // → <b>2 in cart</b>
   ```

5. the skew guard;

   ```js dom
   // The server's route table called /cart "basket"; with no skewGuard,
   // this build draws it as its own "cart".
   serverPage({ $route: { path: "/cart", name: "basket" } });
   const juris = await hydrate({ routes, register: app({ p: "Your cart" }) });
   juris.api.route().name; // → "cart"
   ```

6. await every matched route record's `load` (the router's `loadFor`), so no unregistered component
   is drawn;

   ```js dom
   serverPage({ $route: { path: "/cart" } });
   await hydrate({
       routes: [
           {
               path: "/cart",
               load: async (juris) => {
                   juris.registerComponent("CartPage", () => ({ h1: "Cart" }));
               },
           },
       ],
       root: { CartPage: {} },
   });
   document.getElementById("app").innerHTML; // → <h1>Cart</h1>
   ```

7. `beforeMount(juris)` (awaited when it returns a promise), for what the server could not know,
   set before the first render reads it;

   ```js dom
   serverPage({ $route: { path: "/cart" } });
   const remembered = { currency: "EUR" }; // what this browser keeps
   await hydrate({
       routes,
       beforeMount: async (juris) => {
           juris.setValue("prefs", remembered);
       },
       register(juris) {
           juris.registerComponent("App", (props, api) => ({
               p: `Prices in ${api.getState("prefs.currency")}`,
           }));
       },
   });
   document.getElementById("app").innerHTML; // → <p>Prices in EUR</p>
   ```

8. `mount`, which replaces the server's markup and releases the preloaded calls;

   ```js dom
   serverPage(
       { $route: { path: "/cart" }, $ssr: { calls: { 'price:["milk"]': 3 } } },
       { markup: "<p>Milk, 3 € (from the server)</p>" },
   );
   let beforeMount;
   const juris = await hydrate({
       routes,
       beforeMount: (juris) => {
           beforeMount = juris.api.preloaded("price", "milk");
       },
       register: app({ p: "Milk, 3 €" }),
   });
   document.getElementById("app").innerHTML; // → <p>Milk, 3 €</p>
   beforeMount; // → 3
   juris.api.preloaded("price", "milk"); // → undefined
   ```

9. the title, bound to `document.title` and re-run when what it reads changes (the server's title
   stands when there is none): `title` is `{ fallback, suffix, max, decorate(text, juris) }`, the
   kernel's options, for the page's name as the server gave it (the router's `titleOf` on the
   route's `head`, with the data the page keeps at `head.dataPath`), or a function `title(juris)`
   that answers the whole title;

   ```js dom
   serverPage({ $route: { path: "/cart" } });
   document.title = "Your cart · Shop"; // the server's
   await hydrate({ routes, register: app({ p: "Your cart" }) });
   document.title; // → "Your cart · Shop"
   ```

   ```js dom
   serverPage({ $route: { path: "/orders/42" }, order: { number: 42 } });
   const juris = await hydrate({
       routes: [
           {
               path: "/orders/:id",
               head: {
                   title: "Order",
                   titleFrom: (order) => `Order ${order.number}`,
                   dataPath: "order",
               },
           },
       ],
       title: {
           suffix: " · Shop",
           decorate: (text) => `🛒 ${text}`,
       },
       register: app({ p: "Your order" }),
   });
   document.title; // → "🛒 Order 42 · Shop"
   juris.setValue("order.number", 43);
   document.title; // → "🛒 Order 43 · Shop"
   ```

   ```js dom
   serverPage({ $route: { path: "/cart" }, cart: { count: 2 } });
   const juris = await hydrate({
       routes,
       title: (juris) => `Cart (${juris.getState("cart.count")})`,
       register: app({ p: "Your cart" }),
   });
   document.title; // → "Cart (2)"
   juris.setValue("cart.count", 3);
   document.title; // → "Cart (3)"
   ```

10. with `prefetch: "idle"` (the default; `false` for none), every other route's code, one record
    at a time, once the browser is idle, a failure ending the prefetch quietly;

    ```js dom
    serverPage({ $route: { path: "/cart" } });
    const loaded = [];
    const load = (name, fails = false) => async () => {
        loaded.push(name);
        if (fails) throw new Error(`${name}.js is gone`);
    };
    await hydrate({
        routes: [
            { path: "/cart", load: load("cart") },
            { path: "/", load: load("home") },
            { path: "/orders", load: load("orders", true) },
            { path: "/account", load: load("account") },
        ],
        root: { p: "Your cart" },
    });
    loaded; // → ["cart"]
    await new Promise((resolve) => setTimeout(resolve, 5));
    loaded; // → ["cart", "home", "orders"]
    ```

    ```js dom
    serverPage({ $route: { path: "/cart" } });
    const loaded = [];
    await hydrate({
        routes: [
            { path: "/cart" },
            { path: "/", load: async () => loaded.push("home") },
        ],
        prefetch: false,
        root: { p: "Your cart" },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    loaded; // → []
    ```

11. `serviceWorker` (a script URL, or `{ url, onMessage(data, juris, event) }`) registered once
    idle, its messages handed to `onMessage`;

    ```js dom
    // A stand-in for the browser's navigator.serviceWorker.
    const registered = [];
    let post;
    navigator.serviceWorker = {
        register: async (url) => registered.push(url),
        addEventListener: (type, listener) => {
            post = (data) => listener({ data });
        },
    };
    serverPage({ $route: { path: "/cart" } });
    const notes = [];
    await hydrate({
        routes,
        serviceWorker: {
            url: "/sw.js",
            onMessage: (data, juris) => notes.push(data.kind),
        },
        register: app({ p: "Your cart" }),
    });
    registered; // → []
    await new Promise((resolve) => setTimeout(resolve, 5));
    registered; // → ["/sw.js"]
    post({ kind: "update-ready" });
    notes; // → ["update-ready"]
    ```

and last the instance under the global name `expose`, when given.

```js dom
serverPage({ $route: { path: "/cart" } });
const juris = await hydrate({
    routes,
    expose: "shop",
    register: app({ p: "Your cart" }),
});
globalThis.shop === juris; // → true
```

`juris` is the instance's own options, `{ allowTags, allowSchemes, allowInnerHTML, components }`,
the same object the server's kernel is given.

```js dom
// One module, imported by the server's kernel and by this entry.
const shared = { allowInnerHTML: true };
serverPage({ $route: { path: "/cart" } });
await hydrate({
    routes,
    juris: shared,
    register: app({ p: { innerHTML: "<b>Free</b> delivery" } }),
});
document.getElementById("app").innerHTML; // → <p><b>Free</b> delivery</p>
```

```js dom
// The components the server's instance is given too.
function App() {
    return { p: "Your cart" };
}
const shared = { components: [App] };
serverPage({ $route: { path: "/cart" } });
await hydrate({ routes, juris: shared });
document.getElementById("app").innerHTML; // → <p>Your cart</p>
```

```js
await hydrate({ routes, juris: { devMode: true } });
// throws TypeError: hydrate: juris.devMode is not an option
await hydrate({ routes, juris: { components: [() => ({ p: "Cart" })] } });
// throws TypeError: hydrate: juris.components[0] is a function with no name
```

**`devMode`** is `true` or `false` (anything else is refused with a `TypeError` before the page is
read); left out, the page decides: its `#juris-dev`, which the kit's kernel writes in development
only ("The page contract"), turns devMode on, read as the state is, from the server's JSON script
and nothing else.

```js
// No page at all: the option is refused before one is read.
await hydrate({ routes, devMode: "yes" });
// throws TypeError: hydrate: devMode is true or false
```

```js dom
const devScript = '<script type="application/json" id="juris-dev">{}</script>';
serverPage({ $route: { path: "/cart" } }, { more: devScript });
const juris = await hydrate({ routes, register: app({ p: "Your cart" }) });
juris.devMode; // → true
serverPage(
    { $route: { path: "/cart" } },
    { markup: '<b id="juris-dev">Dev</b>' },
);
const shop = await hydrate({ routes, register: app({ p: "Your cart" }) });
shop.devMode; // → false
```

With devMode on, `hydrate` imports `devtools.js` before it builds the instance and gives it as
`features.devtools` ("`devtools.js`"); with it off, it imports nothing more and the instance is
built as it always was.

```js dom
import { Devtools } from "juris/devtools.js";

serverPage({ $route: { path: "/cart" } });
const juris = await hydrate({ routes, devMode: true, register: app({}) });
juris.devtools instanceof Devtools; // → true
const shop = await hydrate({ routes, devMode: false, register: app({}) });
shop.devtools; // → undefined
```

Juris reads no environment: the switch is the `dev` the app gives the kernel, and an entry that
wants no devMode in development says `hydrate({ devMode: false })`.

```js dom
const devScript = '<script type="application/json" id="juris-dev">{}</script>';
serverPage({ $route: { path: "/cart" } }, { more: devScript });
const juris = await hydrate({
    routes,
    devMode: false,
    register: app({ p: "Your cart" }),
});
juris.devMode; // → false
```

The idle steps use `requestIdleCallback` only when it is a function (`typeof`), so an element with
`id="requestIdleCallback"` cannot stand in for it where the browser has none.

```js dom
import { mock } from "node:test";

// Node's fake clock, so the timer that stands in can be run at once.
mock.timers.enable({ apis: ["setTimeout"] });
// Where a browser has no requestIdleCallback, a page's element with that id
// is the global of that name.
globalThis.requestIdleCallback = document.createElement("div");
serverPage({ $route: { path: "/cart" } });
const loaded = [];
await hydrate({
    routes: [
        { path: "/cart" },
        { path: "/", load: async () => loaded.push("home") },
    ],
    root: { p: "Your cart" },
});
mock.timers.tick(1200);
await new Promise((resolve) => setImmediate(resolve));
loaded; // → ["home"]
mock.timers.reset();
```

`stateId`, `rootId` and `root` rename the page's elements and the root layout.

```js dom
document.body.innerHTML = [
    '<main id="shop"><p>Cart: 1</p></main>',
    '<script type="application/json" id="shop-state">',
    '{"cart":{"count":1}}',
    "</script>",
].join("");
await hydrate({
    routes,
    stateId: "shop-state",
    rootId: "shop",
    root: { Cart: {} },
    register(juris) {
        juris.registerComponent("Cart", (props, api) => ({
            p: `Cart: ${api.getState("cart.count") + 1}`,
        }));
    },
});
document.getElementById("shop").innerHTML; // → <p>Cart: 2</p>
```

A route whose code fails at step 6 rejects the promise and leaves the server's page as it was,
readable, with nothing exposed.

```js dom
serverPage({ $route: { path: "/cart" } }, { markup: "<p>Your cart</p>" });
await hydrate({
    routes: [
        {
            path: "/cart",
            load: async () => {
                throw new Error("cart.js is gone");
            },
        },
    ],
    expose: "shop",
});
// throws Error: cart.js is gone
document.getElementById("app").innerHTML; // → <p>Your cart</p>
globalThis.shop; // → undefined
```

**The skew guard** (`skewGuard: { storageKey, reload }`, off unless given) compares the name the
server's route table gave the page, read from the state before the router is installed, with this
build's name for the page's path.

When they differ this is not the server's code (a module from another build, in a cache or from
another instance mid-deploy), and drawing it would replace the right page with the wrong one; so it
keeps the page's path in `sessionStorage` under `storageKey`, calls `reload` (`location.reload()`
unless given) and answers `null` before anything is fetched or drawn.

```js dom
globalThis.sessionStorage = memoryStorage();
// The server's route table calls /cart "basket"; this build calls it "cart".
serverPage(
    { $route: { path: "/cart", name: "basket" } },
    { markup: "<p>Your basket</p>" },
);
let reloads = 0;
const juris = await hydrate({
    routes,
    skewGuard: { storageKey: "shop:reloaded", reload: () => reloads++ },
    register: app({ p: "Your cart" }),
});
// console.warn: Juris: the server rendered this page as route "basket"
juris; // → null
reloads; // → 1
sessionStorage.getItem("shop:reloaded"); // → "/cart"
document.getElementById("app").innerHTML; // → <p>Your basket</p>
```

A boot that finds its own path already marked draws the page instead and tells the console, so it
never reloads a second time, and a boot that goes ahead clears the mark.

```js dom
globalThis.sessionStorage = memoryStorage();
sessionStorage.setItem("shop:reloaded", "/cart"); // the reload before
serverPage({ $route: { path: "/cart", name: "basket" } });
let reloads = 0;
await hydrate({
    routes,
    skewGuard: { storageKey: "shop:reloaded", reload: () => reloads++ },
    register: app({ p: "Your cart" }),
});
// console.error: Juris: still out of step with the server after a reload
reloads; // → 0
document.getElementById("app").innerHTML; // → <p>Your cart</p>
sessionStorage.getItem("shop:reloaded"); // → null
```

When storage will not keep the mark it does not reload at all, since a reload it cannot remember
could be the first of many.

```js dom
// Storage the browser has blocked: every write throws.
globalThis.sessionStorage = {
    getItem: () => null,
    setItem: () => {
        throw new DOMException("Storage is blocked", "SecurityError");
    },
    removeItem: () => {},
};
serverPage({ $route: { path: "/cart", name: "basket" } });
let reloads = 0;
await hydrate({
    routes,
    skewGuard: { storageKey: "shop:reloaded", reload: () => reloads++ },
    register: app({ p: "Your cart" }),
});
// console.error: Juris: the server rendered this page as route "basket"
reloads; // → 0
document.getElementById("app").innerHTML; // → <p>Your cart</p>
```

The key is the app's, so the app lists it among what it stores.

```js
import { STORAGE } from "juris/storage.js";

// What the shop tells its visitors it stores: the framework's, and its own.
const stored = [
    ...STORAGE,
    {
        key: "shop:reloaded",
        kind: "sessionStorage",
        category: "necessary",
    },
];
stored.map((entry) => entry.key); // → ["juris:$route:length", "shop:reloaded"]
```

Any other key in it, and a malformed one, is refused with a `TypeError` before the page is read,
as is any option `hydrate` does not take, a key `title` or `serviceWorker` does not take, and a
`live` object the live client refuses (it is made before the page is read, beside the router).

```js
// No page at all: each is refused before one is read.
await hydrate({ routes, skewGuard: { storageKey: "shop:reloaded", wait: 1 } });
// throws TypeError: hydrate: skewGuard.wait is not an option
await hydrate({ routes, skewGuard: { storageKey: "" } });
// throws TypeError: hydrate: skewGuard.storageKey names the sessionStorage key
```

```js
await hydrate({ routes, prefech: false });
// throws TypeError: hydrate: "prefech" is not an option
await hydrate({ routes, title: { prefix: "Shop · " } });
// throws TypeError: hydrate: title.prefix is not an option
await hydrate({ routes, serviceWorker: { url: "/sw.js", scope: "/" } });
// throws TypeError: hydrate: serviceWorker.scope is not an option
```

```js
await hydrate({ routes, live: { idleMS: 0 } });
// throws TypeError: sseClient: "idleMS" is not an option
await hydrate({ routes, router: { gaurd: () => "/" } });
// throws TypeError: Router: "gaurd" is not an option
```

#### `devtools.js`

**Exports:** `Devtools`, `PROTOCOL`.

```js
import { Devtools, PROTOCOL } from "juris/devtools.js";

typeof Devtools; // → "function"
PROTOCOL; // → 1
```

What a devtools panel reads from a page whose instance is in devMode. `DEVTOOLS.md` (beside this
file) is the design and its decisions (D1–D19); this is what phase 1 built, and "Not yet" lists
phases 2 and 3.

It is a feature, `features: { devtools: Devtools }`, which installs itself on the instance it is
given, as `juris.devtools`.

```js dom
import Juris from "juris/juris.js";
import { Devtools } from "juris/devtools.js";

const juris = new Juris({ devMode: true, features: { devtools: Devtools } });
// console.info: Juris: devMode is on, so this instance is exposed
juris.devtools instanceof Devtools; // → true
```

`hydrate` gives it when the page's instance is in devMode, importing the module only then
(`import("./devtools.js")`), so no page with devMode off downloads it; nothing a browser runs imports
it statically (`tests/boundary.test.mjs`). An instance built by hand is given it the same way.

```js dom
import { hydrate } from "juris/client.js";

document.body.innerHTML = [
    '<div id="app"></div>',
    '<script type="application/json" id="state">{}</script>',
].join("");
const options = { routes: [], root: { p: "Your cart" }, prefetch: false };
const juris = await hydrate({ ...options, devMode: true });
juris.devtools.endpoint.protocol; // → 1
const shop = await hydrate({ ...options, devMode: false });
shop.devtools; // → undefined
```

A feature given to an instance without `devMode`, or to a server instance, is refused with a
`TypeError`, and the kernel never gives its own instance one.

```js
import Juris from "juris/juris.js";
import { Devtools } from "juris/devtools.js";

new Juris({ features: { devtools: Devtools } });
// throws TypeError: Devtools: the devtools feature is for an instance in
// A server instance (Node, no window): refused too.
new Juris({ devMode: true, features: { devtools: Devtools } });
// throws TypeError
```

`PROTOCOL` is `1`.

```js dom
import Juris from "juris/juris.js";
import { Devtools, PROTOCOL } from "juris/devtools.js";

const juris = new Juris({ devMode: true, features: { devtools: Devtools } });
juris.devtools.endpoint.protocol === PROTOCOL; // → true
```

The examples below drive the endpoint as a panel does, on a cart page in devMode drawn into the
stand-in page: `cartPage()` builds it, given the feature, and answers the instance, its `endpoint`,
a `panel` connection, and the `app` element it is drawn into. `wait(ms)` lets a frame pass.

```js setup
import Juris from "juris/juris.js";
import { Devtools } from "juris/devtools.js";

// A cart page in devMode, given the feature, and a panel connected to it.
function cartPage({ state = {}, ...options } = {}) {
    const juris = new Juris({
        devMode: true,
        state: { cart: { items: ["Milk", "Eggs"] }, ...state },
        features: { devtools: Devtools },
        ...options,
    });
    juris.registerComponent("Cart", function Cart(props, api) {
        return {
            ul: {
                className: "cart",
                children: () => api.getState("cart.items").map((item) => ({
                    li: item,
                })),
            },
        };
    });
    const app = document.createElement("main");
    app.id = "app";
    document.body.append(app);
    juris.mount(app, { Cart: {} });
    const { endpoint } = juris.devtools;
    return { juris, endpoint, panel: endpoint.connect(), app };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
```

- **What it installs.** On construction it registers the instance (below). Then, on that instance
  only, it replaces the methods a draw and a write go through, each calling the method it replaced
  with what it was given (D5): the state manager's `stamp` (every binding and computed passes it
  before its first run), `compute` (a computed's path), `tryCapture` (a resolver's run), `resubscribe`
  (a binding's reads after each run, and its disposal), `run` (a notification pass), `affected` (each
  round's changed paths) and `guard` (each callback of a pass), and the renderer's `bindState` (what
  the binding draws, from its label: "`dom-renderer.js`") and `mount`. Nothing on a prototype
  changes, so an instance without the feature runs exactly the code it ran before:
  `tests/core.test.mjs` holds that with devMode off none of them is the instance's own, nothing is on
  `window`, no event is dispatched and `devtools.js` is never imported.

  ```js dom
  const { juris } = cartPage();
  const replaced = [
      "stamp", "compute", "tryCapture", "resubscribe", "run", "affected", "guard",
  ];
  replaced.every((name) => Object.hasOwn(juris.stateManager, name)); // → true
  Object.hasOwn(juris.renderer, "bindState"); // → true
  Object.hasOwn(juris.renderer, "mount"); // → true
  ```

  ```js dom
  const shop = new Juris();
  Object.hasOwn(shop.stateManager, "run"); // → false
  Object.hasOwn(shop.renderer, "bindState"); // → false
  "__JURIS_DEVTOOLS__" in window; // → false
  ```

- **What it keeps from the start** (D6), with or without a panel: a record of every live binding and
  computed (what it draws, for which component, how many values it has applied, the pass it last ran
  in, and a promise it returned that has not settled), the changed paths and the cause of the last
  200 notification passes, and the preloaded calls the page arrived with.

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  juris.setValue("cart.items", ["Milk"]);
  // The panel subscribed to nothing: the pass and the binding were kept anyway.
  endpoint.request(panel, "passes").result[0].changed; // → ["cart.items"]
  const binding = endpoint.request(panel, "binding", { id: 1 }).result;
  binding.applied; // → 2
  binding.lastPass; // → 1
  ```

  A binding's reads are not copied: they are read from the state manager's subscriptions when asked
  (D7).

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  const reads = () => endpoint.request(panel, "binding", { id: 1 }).result.reads;
  reads();
  // → ["cart.items", "cart.items.0", "cart.items.1", "cart.items.length"]
  juris.setValue("cart.items", ["Milk"]);
  reads(); // → ["cart.items", "cart.items.0", "cart.items.length"]
  ```

  Everything else is kept only while a connection subscribes to it.

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  juris.setValue("cart.items", ["Milk"]);
  endpoint.request(panel, "subscribe", { topic: "timeline" });
  endpoint.drain(panel).events; // → []
  juris.setValue("cart.items", []);
  endpoint.drain(panel).events.map((event) => event.type); // → ["pass"]
  ```

- **The registry** (D3). The first instance defines `window.__JURIS_DEVTOOLS__` (frozen, and neither
  writable nor enumerable), and every later instance registers in it, one from another copy of the
  module included (two builds in one page; `juris.js` skips a `$juris` index another copy took, so
  two copies never share one).

  ```js dom
  cartPage();
  const registry = window.__JURIS_DEVTOOLS__;
  Object.isFrozen(registry); // → true
  Object.keys(window).includes("__JURIS_DEVTOOLS__"); // → false
  window.__JURIS_DEVTOOLS__ = {};
  // throws TypeError: Cannot assign to read only property
  cartPage();
  registry.list().map((entry) => entry.id); // → [1, 2]
  ```

  ```js dom
  // Another build's copy of the core took window.$juris[1] already.
  window.$juris = { 1: "another build's instance" };
  const { juris } = cartPage();
  juris.devIndex; // → 2
  window.__JURIS_DEVTOOLS__.list().map((entry) => entry.id); // → [2]
  ```

  Each registration dispatches `juris:devtools`, a `CustomEvent` whose `detail` is `{ id }`, on
  `window`.

  ```js dom
  const registered = [];
  window.addEventListener("juris:devtools", (event) => {
      registered.push(event.detail);
  });
  cartPage();
  cartPage();
  registered; // → [{ id: 1 }, { id: 2 }]
  ```

  A registry already there whose `registry` is not `1` is left alone, and the console says the
  instance could not register.

  ```js dom
  window.__JURIS_DEVTOOLS__ = { registry: 2 }; // a later version's
  cartPage();
  // console.warn: Juris: window.__JURIS_DEVTOOLS__ is not a registry this
  window.__JURIS_DEVTOOLS__; // → { registry: 2 }
  ```

  Without a `window` nothing is registered (as `$juris`), and the endpoint is
  `juris.devtools.endpoint`.

  ```js
  // No page here: a browser instance with no window.
  const juris = new Juris({
      devMode: true,
      isServer: false,
      features: { devtools: Devtools },
  });
  juris.devIndex; // → undefined
  const { endpoint } = juris.devtools;
  endpoint.request(endpoint.connect(), "hello").result.id; // → null
  ```

  | Member | |
  | --- | --- |
  | `registry` | `1`: the shape of this object, which never changes |
  | `list()` | `[{ id, protocol, juris, codeId, root }]`: `id` is the instance's `$juris` index (`devIndex`), `juris` the core's version, `codeId` the `v` of the module's own URL (the code id the kit's module server stamps every import with) or `null`, `root` the id of the element it first mounted into, or `null` |
  | `get(id)` | That instance's endpoint (`id` a number), or `null` |
  | `register({ id, endpoint, describe })` | How each copy of the module registers its instance; `describe()` answers its entry in `list()`. Not for a panel |

  ```js dom
  const { juris, endpoint } = cartPage();
  const registry = window.__JURIS_DEVTOOLS__;
  registry.registry; // → 1
  registry.list();
  // → [{ id: 1, protocol: 1, juris: "0.93.0", codeId: null, root: "app" }]
  registry.get(1) === endpoint; // → true
  registry.get("1"); // → null
  ```

  ```js dom
  // How another copy of the module registers its instance in this registry.
  const { endpoint } = cartPage();
  const registry = window.__JURIS_DEVTOOLS__;
  registry.register({
      id: 7,
      endpoint,
      describe: () => ({
          id: 7,
          protocol: 1,
          juris: "0.93.0",
          codeId: "b2",
          root: null,
      }),
  });
  registry.list().map((entry) => [entry.id, entry.codeId]);
  // → [[1, null], [7, "b2"]]
  ```

- **An endpoint** answers synchronously, with JSON values only, since a panel reaches it through
  `chrome.devtools.inspectedWindow.eval`, which returns a value and awaits nothing.

  ```js dom
  const { endpoint, panel } = cartPage();
  const answer = endpoint.request(panel, "state", { path: "cart" });
  answer; // → { ok: true, result: { items: ["Milk", "Eggs"] } }
  typeof answer.then; // → "undefined"
  JSON.stringify(answer); // → '{"ok":true,"result":{"items":["Milk","Eggs"]}}'
  ```

  The page sends nothing on its own: no request, no `postMessage`. What leaves it is an answer to a
  request.

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  juris.setValue("cart.items", ["Milk"]);
  juris.render(document.body, { Cart: {} });
  endpoint.drain(panel); // → { events: [], dropped: 0 }
  ```

  | Member | |
  | --- | --- |
  | `protocol` | `1` |
  | `connect()` | A new connection's id, a string (`"c1"`, …) |
  | `request(connection, method, params)` | `{ ok: true, result }`, with `cut: true` when the result was encoded shallower to fit (below), or `{ ok: false, error: { code, message } }`. The codes are `unknown-method`, `bad-params`, `no-connection`, `no-such-node`, `no-such-component`, `no-such-binding`, and `failed`: anything else that threw while answering, with its message, so nothing is thrown at the panel. `params` that is not an object is `{}` |
  | `drain(connection)` | `{ events, dropped }`: what happened since the last drain, oldest first, at most 1 MiB of JSON (counted in characters, and one event at least), with `more: true` when events are left queued; `dropped` counts what a full queue (2,000) pushed out since the last drain. On a connection that is not open: `{ events: [], dropped: 0, closed: true }`, and the panel connects again |
  | `disconnect(connection)` | Ends it, its subscriptions, and a pick it started; `true`, or `false` when it was not open. The last connection gone takes the outline away |
  | `definition(name)` | The registered definition function, or `null`: for the console's `inspect()`, which opens it in the Sources panel |
  | `node(handle)` | The node a node handle names, or `null` (gone, or not a handle): for the console's `inspect()` and DevTools' Reveal, an element with no `id` included |

  ```js dom
  const { endpoint, panel } = cartPage();
  endpoint.protocol; // → 1
  panel; // → "c1"
  endpoint.connect(); // → "c2"
  endpoint.request(panel, "hello").ok; // → true
  endpoint.request(panel, "inspect").error;
  // → { code: "unknown-method",
  //     message: '"inspect" is not a method of protocol 1' }
  endpoint.request("c9", "hello").error.code; // → "no-connection"
  ```

  ```js dom
  const { endpoint, panel } = cartPage();
  const failure = (method, params) => {
      return endpoint.request(panel, method, params).error;
  };
  failure("state", { depth: 9 });
  // → { code: "bad-params", message: "depth is a whole number, 0 to 8" }
  failure("node", { node: { $: "node", ref: 99 } });
  // → { code: "no-such-node", message: "node 99 is gone" }
  failure("component", { id: 99 }).code; // → "no-such-component"
  failure("binding", { id: 99 }).code; // → "no-such-binding"
  ```

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  // `params` that is not an object is {}: here, the whole state.
  endpoint.request(panel, "state", "cart").result;
  // → { cart: { items: ["Milk", "Eggs"] } }
  // Not a Date, though it inherits from one: reading it throws.
  juris.setValue("order.placed", Object.create(Date.prototype));
  endpoint.request(panel, "state", { path: "order" });
  // → { ok: false,
  //     error: { code: "failed", message: "this is not a Date object." } }
  ```

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  endpoint.request(panel, "subscribe", { topic: "timeline" });
  for (let n = 1; n <= 2005; n += 1) {
      juris.setValue("cart.items", [`${n} bottles of milk`]);
  }
  const { events, dropped } = endpoint.drain(panel);
  events.length; // → 2000
  dropped; // → 5
  endpoint.drain(panel); // → { events: [], dropped: 0 }
  ```

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  endpoint.request(panel, "subscribe", { topic: "timeline" });
  // Twelve passes, each writing 50 notes of 1,000 characters: about 100 KB each.
  for (let pass = 0; pass < 12; pass += 1) {
      juris.batch(() => {
          for (let n = 0; n < 50; n += 1) {
              juris.setValue(`notes.n${n}`, String(pass).repeat(1000));
          }
      });
  }
  const first = endpoint.drain(panel);
  [first.events.length, first.more]; // → [10, true]
  endpoint.drain(panel).events.length; // → 2
  ```

  ```js dom
  const { endpoint, panel } = cartPage();
  endpoint.disconnect(panel); // → true
  endpoint.disconnect(panel); // → false
  endpoint.drain(panel); // → { events: [], dropped: 0, closed: true }
  endpoint.request(panel, "hello").error.code; // → "no-connection"
  ```

  ```js dom
  const { endpoint, panel, app } = cartPage();
  endpoint.definition("Cart").name; // → "Cart"
  endpoint.definition("Wishlist"); // → null
  // An element with no id:
  const milk = app.querySelector("li");
  const { node } = endpoint.request(panel, "node", { node: milk }).result;
  endpoint.node(node) === milk; // → true
  endpoint.node({ $: "node", ref: 42 }); // → null
  endpoint.node("li"); // → null
  ```

  `definition` and `node` are not requests, since what they answer is not JSON.

  ```js dom
  const { endpoint, panel } = cartPage();
  endpoint.request(panel, "definition", { name: "Cart" }).error.code;
  // → "unknown-method"
  typeof endpoint.definition("Cart"); // → "function"
  ```

  A connection that has not drained for 30 seconds is closed, and its subscriptions with it, so a
  panel that went away leaves no recording on.

  ```js dom
  import { mock } from "node:test";

  // Node's fake clock, to let 30 seconds pass at once.
  mock.timers.enable({ apis: ["setTimeout"] });
  const { juris, endpoint, panel } = cartPage();
  endpoint.request(panel, "subscribe", { topic: "timeline" });
  juris.stateManager.observers.size; // → 1
  mock.timers.tick(30_000);
  endpoint.drain(panel); // → { events: [], dropped: 0, closed: true }
  juris.stateManager.observers.size; // → 0
  mock.timers.reset();
  ```

  Nothing read for the panel is a dependency: every value is read with `peek` and `toRaw` (never
  `getState`, never through a tracking proxy, never an accessor), and a request made inside a capture
  captures nothing.

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  let runs = 0;
  juris.bindState(
      () => {
          runs += 1;
          endpoint.request(panel, "state", { path: "cart" });
          return juris.getState("user.name", "guest");
      },
      (name) => {
          document.title = `Hello, ${name}`;
      },
  );
  juris.setValue("cart.items", ["Milk"]);
  runs; // → 1
  juris.setValue("user.name", "Ada");
  runs; // → 2
  ```

- **Requests.** `params` and `result` are JSON, but for one case: a `node` param may be the node
  itself (an expression that names the console's `$0` passes it) rather than a node handle.

  ```js dom
  const { endpoint, panel, app } = cartPage();
  const list = app.querySelector("ul"); // as the console's $0
  const byNode = endpoint.request(panel, "node", { node: list }).result;
  const byHandle = endpoint.request(panel, "node", { node: byNode.node }).result;
  byNode.node; // → { $: "node", ref: 1, tag: "ul", id: null }
  byHandle.node; // → { $: "node", ref: 1, tag: "ul", id: null }
  ```

  The protocol is read-only (D9): no request changes the state, a component, or what the page does,
  beyond the outline it draws outside the root and a pick's clicks.

  ```js dom
  const { juris, endpoint, panel, app } = cartPage();
  for (const method of ["hello", "tree", "state", "passes", "preloads"]) {
      endpoint.request(panel, method);
  }
  endpoint.request(panel, "highlight", { component: 0 });
  juris.getState("cart.items"); // → ["Milk", "Eggs"]
  app.innerHTML; // → <ul class="cart"><li>Milk</li><li>Eggs</li></ul>
  ```

  | Method | Params | Result |
  | --- | --- | --- |
  | `hello` | | `{ protocol, juris, codeId, id, mounted, dev, topics, privateRoots }`: `dev` is `{ render }` (the render's id, `null` until the kit sends one) where the page carries `#juris-dev`, and `null` where it does not; `topics` the topics this build offers, `["tree", "timeline"]`; `privateRoots` the names of the roots whose paths are counted, never listed (below): names only, never a value |
  | `subscribe` | `{ topic }` | `{ topic }`. Topics: `tree`, `timeline`; subscribing twice is once |
  | `unsubscribe` | `{ topic }` | `{ topic }` |
  | `tree` | | `[TreeNode]`, depth first |
  | `component` | `{ id }` | `Component` |
  | `component` | `{ id, path, depth = 3, from = 0, count }` | With `path` (`"props"`, or a path inside them that a `more` names): the props' `Value` there, read and paged as `state` reads the state |
  | `components` | `{ name }` | `[id]`, as `findComponents(name)` finds them |
  | `node` | `{ node }` | `{ node, roots: [id], owner: id \| null, bindings: [Binding], lastPass: Pass summary \| null }`. `roots` lists the components it is the root of, innermost first; `owner` is the innermost component whose root holds it, or is it; `lastPass` the latest of its bindings' |
  | `binding` | `{ id }` | `Binding`, with `passes: [Pass summary]`: the passes it ran in among the 200 kept (its last one, and, while the timeline records, the last 20 it ran in) |
  | `wakes` | `{ path }` | `{ computeds: [Binding], bindings: [Binding] }`: what a write at `path` wakes first (`stateManager.affected([path])`). A computed's own writes can wake more |
  | `state` | `{ path = "", depth = 3, from = 0, count }` | `Value` at `path`, read with `stateManager.peek`. `from` and `count` page the value asked for: an array's items (`count` 100 unless asked) or an object's keys (200 unless asked), `count` 1,000 at most |
  | `passes` | `{ since = 0 }` | `[Pass summary]`, those of the 200 kept whose id is greater, oldest first |
  | `preloads` | | `[{ key, service, ok, message }]`: the calls the page arrived with (`$ssr.calls`), each failure with the words the page carries, never an answer |
  | `highlight` | `{ node }`, `{ component }` or `{}` | `{}`. Draws, or takes away, an outline over the node (a text node by its element) or the component's root |
  | `pick` | `{ on }` | `{ on }`. While on, the node under the pointer is outlined, and a click (with the pointer's down and up) is kept from the page and sent to the connection that turned it on as `picked`, which ends the pick |

  ```js dom
  const { endpoint, panel } = cartPage({ privatePaths: ["session"] });
  endpoint.request(panel, "hello").result;
  // → { protocol: 1, juris: "0.93.0", codeId: null, id: 1, mounted: true,
  //     dev: null, topics: ["tree", "timeline"],
  //     privateRoots: ["$server", "session"] }
  ```

  ```js dom
  // The kit's kernel writes #juris-dev in development.
  document.body.innerHTML = [
      '<script type="application/json" id="juris-dev">',
      '{"render":"r7"}',
      "</script>",
  ].join("");
  const { endpoint, panel } = cartPage();
  endpoint.request(panel, "hello").result.dev; // → { render: "r7" }
  ```

  ```js dom
  const { endpoint, panel } = cartPage();
  endpoint.request(panel, "subscribe", { topic: "timeline" });
  // → { ok: true, result: { topic: "timeline" } }
  endpoint.request(panel, "unsubscribe", { topic: "timeline" }).result;
  // → { topic: "timeline" }
  endpoint.request(panel, "subscribe", { topic: "refusals" }).error;
  // → { code: "bad-params", message: "topic is one of tree, timeline" }
  ```

  ```js dom
  const { juris, endpoint, panel, app } = cartPage();
  juris.registerComponent("Badge", () => ({ b: "2" }));
  juris.render(app, { Badge: {} });
  endpoint.request(panel, "tree").result;
  // → [{ id: 0, name: "Cart", key: { $: "undefined" }, parent: null,
  //      root: { $: "node", ref: 1, tag: "ul", id: null }, adopted: false },
  //    { id: 1, name: "Badge", key: { $: "undefined" }, parent: null,
  //      root: { $: "node", ref: 2, tag: "b", id: null }, adopted: false }]
  endpoint.request(panel, "components", { name: "Badge" }).result; // → [1]
  ```

  ```js dom
  const { juris, endpoint, panel, app } = cartPage();
  juris.registerComponent("Row", (props) => ({
      li: {
          textContent: () => `${props.title}: ${props.price()} €`,
          onclick: props.onRemove,
      },
  }));
  juris.render(app, {
      Row: { key: "milk", title: "Milk", price: () => 3, onRemove: () => {} },
  });
  const row = endpoint.request(panel, "component", { id: 1 }).result;
  row.props;
  // → { key: "milk", title: "Milk",
  //     price: { $: "function", name: "price", kind: "getter" },
  //     onRemove: { $: "function", name: "onRemove", kind: "listener" } }
  [row.key, row.parent, row.local, row.children, row.bindings];
  // → ["milk", null, null, [], [2]]
  ```

  ```js dom
  const { juris, endpoint, panel, app } = cartPage();
  juris.registerComponent("Receipt", (props) => ({
      p: `${props.lines.length} lines`,
  }));
  const lines = Array.from({ length: 150 }, (_, n) => `Line ${n + 1}`);
  juris.render(app, { Receipt: { lines } });
  const page = { id: 1, path: "props.lines", from: 100, count: 2 };
  endpoint.request(panel, "component", page).result;
  // → ["Line 101", "Line 102", { $: "more", path: "props.lines", length: 150 }]
  ```

  ```js dom
  const { juris, endpoint, panel, app } = cartPage();
  const ask = (node) => endpoint.request(panel, "node", { node }).result;
  const list = ask(app.querySelector("ul"));
  [list.roots, list.owner, list.lastPass]; // → [[0], 0, null]
  list.bindings.map(({ id, kind, component }) => [id, kind, component]);
  // → [[1, "children", 0]]
  juris.setValue("cart.items", ["Milk"]);
  ask(app.querySelector("ul")).lastPass.changed; // → ["cart.items"]
  const milk = ask(app.querySelector("li"));
  [milk.roots, milk.owner, milk.bindings]; // → [[], 0, []]
  ```

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  endpoint.request(panel, "subscribe", { topic: "timeline" });
  juris.setValue("cart.items", ["Milk"]);
  juris.setValue("cart.items", []);
  const { passes, ...binding } = endpoint.request(panel, "binding", {
      id: 1,
  }).result;
  binding;
  // → { id: 1, kind: "children", key: "children", part: null,
  //     node: { $: "node", ref: 1, tag: "ul", id: null }, component: 0,
  //     path: null, reads: ["cart.items", "cart.items.length"], applied: 3,
  //     lastPass: 2, pending: false }
  passes.map(({ id, changed }) => [id, changed]);
  // → [[1, ["cart.items"]], [2, ["cart.items"]]]
  ```

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  juris.api.compute("cart.count", () => juris.getState("cart.items").length);
  const { computeds, bindings } = endpoint.request(panel, "wakes", {
      path: "cart.items",
  }).result;
  computeds.map(({ kind, path }) => [kind, path]);
  // → [["computed", "cart.count"]]
  bindings.map(({ kind, component }) => [kind, component]);
  // → [["children", 0]]
  ```

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  juris.setValue("catalog", Array.from({ length: 150 }, (_, n) => `Item ${n}`));
  const page = { path: "catalog", from: 100, count: 2 };
  endpoint.request(panel, "state", page).result;
  // → ["Item 100", "Item 101", { $: "more", path: "catalog", length: 150 }]
  endpoint.request(panel, "state", { path: "catalog" }).result.length; // → 101
  endpoint.request(panel, "state", { path: "catalog", count: 1001 }).error;
  // → { code: "bad-params", message: "count is a whole number, 1 to 1000" }
  ```

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  juris.setValue("cart.items", ["Milk"]);
  juris.setValue("cart.items", []);
  juris.clearState({ cart: { items: ["Tea"] } });
  const passes = endpoint.request(panel, "passes", { since: 1 }).result;
  passes.map(({ id, cause, changed }) => ({ id, cause, changed }));
  // → [{ id: 2, cause: { kind: "other" }, changed: ["cart.items"] },
  //    { id: 3, cause: { kind: "clear" }, changed: [""] }]
  ```

  ```js dom
  const { endpoint, panel } = cartPage({
      state: {
          $ssr: {
              calls: {
                  'price:["milk"]': 3,
                  'stock:["eggs"]': { $error: "Out of stock" },
              },
          },
      },
  });
  endpoint.request(panel, "preloads").result;
  // → [{ key: 'price:["milk"]', service: "price", ok: true, message: null },
  //    { key: 'stock:["eggs"]', service: "stock", ok: false,
  //      message: "Out of stock" }]
  ```

  ```js dom
  const { endpoint, panel, app } = cartPage();
  const milk = app.querySelector("li").firstChild; // a text node
  endpoint.request(panel, "highlight", { node: milk });
  // → { ok: true, result: {} }
  endpoint.request(panel, "highlight", { component: 0 }).result; // → {}
  endpoint.request(panel, "highlight", {}).result; // → {}
  ```

  ```js dom
  const { endpoint, panel, app } = cartPage();
  endpoint.request(panel, "pick", { on: true }).result; // → { on: true }
  app.querySelector("li").click();
  const [{ type, node, roots, owner }] = endpoint.drain(panel).events;
  [type, node.tag, roots, owner]; // → ["picked", "li", [], 0]
  // The click ended the pick:
  app.querySelector("li").click();
  endpoint.drain(panel).events; // → []
  ```

  A pick keeps the click from the page, in a browser (the stand-in page dispatches no capture
  phase):

  ```js browser
  const { endpoint, panel, app } = cartPage();
  let removed = false;
  app.querySelector("li").addEventListener("click", () => {
      removed = true;
  });
  endpoint.request(panel, "pick", { on: true });
  app.querySelector("li").click();
  removed; // → false
  ```

  `refusals`, `hydration`, `live`, `server` and `builds` (phases 2 and 3) answer `unknown-method`.

  ```js dom
  const { endpoint, panel } = cartPage();
  const later = ["refusals", "hydration", "live", "server", "builds"];
  later.map((method) => endpoint.request(panel, method).error.code);
  // → ["unknown-method", "unknown-method", "unknown-method",
  //    "unknown-method", "unknown-method"]
  ```

  The outline is drawn by the page, in a closed shadow root on a host appended to the document
  element, outside the root Juris draws into, so no layout ever sees it, and styled through the
  CSSOM, which no `style-src` refuses.

  ```js dom
  const { endpoint, panel, app } = cartPage();
  endpoint.request(panel, "highlight", { component: 0 });
  const host = document.documentElement.lastChild;
  host.outerHTML; // → <div data-juris-devtools="outline"></div>
  host.parentNode === document.documentElement; // → true
  app.innerHTML; // → <ul class="cart"><li>Milk</li><li>Eggs</li></ul>
  ```

- **Events**, in `drain`'s `events`, each `{ type, at, … }`, where `at` is `performance.now()`.

  | Type | Sent | Carries |
  | --- | --- | --- |
  | `tree` | While subscribed to `tree`, at the next animation frame (a 16 ms timer where there is none) after a draw that created or disposed a component, once for several | `nodes: [TreeNode]` |
  | `pass` | While subscribed to `timeline`, as each pass ends | `Pass`; `at` is when it began |
  | `frame` | While subscribed to `timeline`, at the first animation frame after one or more passes | `passes: [id]` |
  | `picked` | While `pick` is on, to the connection that turned it on | `{ node, roots, owner }` |

  ```js dom
  const { juris, endpoint, panel, app } = cartPage();
  endpoint.request(panel, "subscribe", { topic: "tree" });
  juris.registerComponent("Badge", () => ({ b: "2" }));
  juris.render(app, { Badge: {} });
  juris.render(app, { Badge: {} });
  endpoint.drain(panel).events; // → []
  await wait(20); // the next frame
  const events = endpoint.drain(panel).events;
  events.map(({ type, nodes }) => [type, nodes.map((node) => node.name)]);
  // → [["tree", ["Cart", "Badge", "Badge"]]]
  typeof events[0].at; // → "number"
  ```

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  endpoint.request(panel, "subscribe", { topic: "timeline" });
  const before = performance.now();
  juris.setValue("cart.items", ["Milk"]);
  juris.setValue("cart.items", []);
  const passes = endpoint.drain(panel).events;
  passes.map(({ type, id }) => [type, id]); // → [["pass", 1], ["pass", 2]]
  passes[0].at >= before; // → true
  await wait(20);
  endpoint.drain(panel).events.map(({ type, passes }) => [type, passes]);
  // → [["frame", [1, 2]]]
  ```

- **Shapes.**

  | Shape | Fields |
  | --- | --- |
  | Node handle | `{ "$": "node", ref, tag, id }`. `ref` is a number, the node's for as long as the node lives (a `WeakMap` one way, a `WeakRef` the other, shared by the instance's connections). `tag` is the local name, `"#text"`, or another node's name. `id` is the element's `id`, or `null`. A handle whose node is gone answers `no-such-node` |
  | `TreeNode` | `{ id, name, key, parent, root, adopted }`. `key` is a `Value` (depth 1), `parent` an id or `null`, `root` a node handle or `null` |
  | `Component` | `TreeNode`'s fields, plus `props` (a `Value`, depth 3, of the props as given: a function `{ "$": "function", name, kind }` whose `kind` is `"getter"`, or `"listener"` for an `on…` prop; a ref `{ "$": "ref", path }`), `local` (`{ path, values: Value }`, the initial values included, or `null`), `children: [id]`, and `bindings: [binding id]`, the bindings its layout made |
  | `Binding` | `id`. `kind`: `"property"` (an attribute or a property, `textContent` and `value` among them), `"class"` (a `classList` key, or a function as `classList`), `"style"`, `"children"` (a function as `children`), `"seat"` (a function in a child position), `"root"` (a component's root function), `"computed"`, or `"other"` (`bindState` called directly: the title, the router's own). `key`: the layout key (`"classList"` for a class), or `null`. `part`: the `classList` key, or `null`. `node`: a handle on what it draws into now, or `null`. `component`: the id of the component whose layout made it (the renderer's owner), or `null`. `path`: a computed's path, or `null`. `reads`: the paths it is subscribed to now, sorted (`*` segments included). `applied`: how many values it has applied. `lastPass`: the pass it last ran in, or `null`. `pending`: whether a promise it returned is outstanding |
  | `Pass` | `id`. `cause`: `{ kind: "event", type, node }` (a DOM event was being dispatched, `window.event`; `node` its target's handle, or `null`), `{ kind: "clear" }` (`clearState`), `{ kind: "mount" }`, or `{ kind: "other" }`. `writes`: the first 50 `{ path, value, previous, deleted }`, values at depth 1, as `observe` tells them: a write made inside the pass (a computed's, a binding's) at the write, and the write outside a batch that caused the pass once the pass is done. `writeCount`. `ran`: the first 500 `{ binding, ms, readMs, applyMs, wokeBy, error }`, in the order they ran (computeds, then bindings by creation order), where `binding` is `null` for a callback that is no binding (a plain `subscribe`), `readMs` the resolver's run, `applyMs` the callback's time less its read (the value applied, the DOM written, the reads subscribed again), `wokeBy` the reads it had before that the pass changed, sorted, and `error` `{ name, message }` or `null`. `ranCount`. `rounds`. `ms`. A Pass summary is `{ id, at, cause, changed }`, where `changed` holds the first 50 changed paths, a container whose shape changed among them, and is kept for the last 200 passes whether or not a panel is attached |

  ```js dom
  const { endpoint, panel, app } = cartPage();
  const handle = (node) => endpoint.request(panel, "node", { node }).result.node;
  handle(app); // → { $: "node", ref: 1, tag: "main", id: "app" }
  handle(app.querySelector("li").firstChild);
  // → { $: "node", ref: 2, tag: "#text", id: null }
  ```

  ```js dom
  const { juris, endpoint, panel, app } = cartPage();
  juris.registerComponent("Counter", (props, api) => {
      const [count] = api.useState("count", 1);
      return { output: { textContent: () => `${count()}` } };
  });
  juris.render(app, { Counter: { total: juris.api.ref("cart.items") } });
  const counter = endpoint.request(panel, "component", { id: 1 }).result;
  counter.local; // → { path: "$local.Counter.0", values: { count: 1 } }
  counter.props.total; // → { $: "ref", path: "cart.items" }
  ```

  ```js dom
  const { juris, endpoint, panel, app } = cartPage();
  const count = () => juris.getState("cart.items").length;
  juris.api.compute("cart.count", count);
  juris.bindState(() => juris.getState("cart.count"), (total) => {
      document.title = `${total} in cart`;
  });
  juris.registerComponent("Greeting", (props, api) => () => ({
      p: `Hello, ${api.getState("user.name", "guest")}: ${count()} items`,
  }));
  juris.render(app, {
      span: {
          title: () => `${count()} items`,
          classList: { empty: () => count() === 0 },
          style: () => ({ opacity: count() ? 1 : 0.5 }),
          children: [() => `${count()} in cart`],
      },
  });
  juris.render(app, { Greeting: {} });
  const { computeds, bindings } = endpoint.request(panel, "wakes", {
      path: "cart.items",
  }).result;
  [...computeds, ...bindings].map(({ kind, key, part }) => [kind, key, part]);
  // → [["computed", null, null], ["children", "children", null],
  //    ["property", "title", null], ["class", "classList", "empty"],
  //    ["style", "style", null], ["seat", null, null], ["root", null, null]]
  endpoint.request(panel, "wakes", { path: "cart.count" }).result.bindings
      .map(({ kind }) => kind); // → ["other"]
  ```

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  endpoint.request(panel, "subscribe", { topic: "timeline" });
  juris.setValue("cart.items", ["Milk"]);
  const [pass] = endpoint.drain(panel).events;
  const { id, cause, writes, writeCount, ranCount, rounds } = pass;
  [id, cause, writeCount, ranCount, rounds]; // → [1, { kind: "other" }, 1, 1, 1]
  writes;
  // → [{ path: "cart.items", value: ["Milk"], previous: ["Milk", "Eggs"],
  //      deleted: false }]
  const [{ binding, wokeBy, error }] = pass.ran;
  [binding, error]; // → [1, null]
  wokeBy;
  // → ["cart.items", "cart.items.0", "cart.items.1", "cart.items.length"]
  const timings = ["ms", "readMs", "applyMs"].map((key) => pass.ran[0][key]);
  timings.every((ms) => typeof ms === "number"); // → true
  ```

  ```js dom
  const { juris, endpoint, panel, app } = cartPage();
  juris.registerComponent("Opener", (props, api) => {
      // A write while mounting:
      api.setValue("cart.items", ["Tea"]);
      return { p: "Welcome back" };
  });
  juris.mount(app, { Opener: {} });
  // A key the cart did not have:
  juris.setValue("cart.total", 9);
  const passes = endpoint.request(panel, "passes").result;
  passes.map(({ cause, changed }) => [cause.kind, changed]);
  // → [["mount", ["cart.items"]], ["other", ["cart", "cart.total"]]]
  Object.keys(passes[0]); // → ["id", "at", "cause", "changed"]
  ```

  A pass a DOM event caused, in a browser (the stand-in page sets no `window.event`):

  ```js browser
  const { juris, endpoint, panel, app } = cartPage();
  const button = document.createElement("button");
  button.id = "empty-cart";
  button.addEventListener("click", () => juris.setValue("cart.items", []));
  app.append(button);
  button.click();
  endpoint.request(panel, "passes").result[0].cause;
  // → { kind: "event", type: "click",
  //     node: { $: "node", ref: 1, tag: "button", id: "empty-cart" } }
  ```

- **Values** (D8). A value is sent as JSON, except:

  | Value | Sent as |
  | --- | --- |
  | `undefined`, `NaN`, `±Infinity`, a `bigint`, a symbol | `{ "$": "undefined" }`, `{ "$": "number", text }`, `{ "$": "bigint", text }`, `{ "$": "symbol", text }` |
  | A string longer than 1,000 characters | `{ "$": "string", head, length }` |
  | A function | `{ "$": "function", name, kind }`, `kind` `"function"` (or a prop's `"getter"`, `"listener"`). Its source is never sent: `definition(name)` and `inspect()` show it. An accessor property is named this way, `kind: "getter"`, and never called |
  | A tracking proxy | Its target (`toRaw`). A trap is never run |
  | A DOM node | A node handle |
  | A settled value | `{ "$": "settled", value }` or `{ "$": "settled", error: { name, message } }` |
  | A promise, or another thenable | `{ "$": "promise" }` |
  | A ref (`api.ref`) | `{ "$": "ref", path }` |
  | A `Date`, `Map`, `Set` or `Error` | `{ "$": "date", iso }` (`null` for an invalid date), `{ "$": "map", size, entries: [[key, value]] }`, `{ "$": "set", size, items }`, `{ "$": "error", name, message }`. A map's entries and a set's items stop at 100, the last then `{ "$": "more", path, length }` |
  | Another class's instance | `{ "$": "instance", of, entries }`: its class's name, and its own enumerable fields as an object's |
  | An array | Itself, `count` items from `from` at the top (100 unless asked), the first 100 below it, then `{ "$": "more", path, length }` |
  | An object | Its own enumerable keys, `count` from `from` at the top (200 unless asked), the first 200 below it, then `{ "$": "more", path, keys }` under the key `"…"` (U+2026). An object whose own keys include `"$"` is `{ "$": "object", entries }`, so it is never read as one of these shapes; `__proto__` is a key like any other |
  | An object or array `depth` levels below the value asked for (`depth` 3 unless asked, 8 at most) | `{ "$": "more", path }`. With depth 0, the value asked for is one, unless it is not an object |
  | An object met again in one answer | `{ "$": "cycle", path }`, the path where it was first sent |
  | A private root's value | `{ "$": "private", count }`: how many keys it holds (below) |

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  juris.setValue("odd", {
      none: undefined,
      ratio: NaN,
      limit: -Infinity,
      big: 2n ** 64n,
      tag: Symbol("sale"),
      note: "x".repeat(1200),
  });
  const odd = endpoint.request(panel, "state", { path: "odd" }).result;
  [odd.none, odd.ratio, odd.limit];
  // → [{ $: "undefined" }, { $: "number", text: "NaN" },
  //    { $: "number", text: "-Infinity" }]
  [odd.big, odd.tag];
  // → [{ $: "bigint", text: "18446744073709551616" },
  //    { $: "symbol", text: "Symbol(sale)" }]
  [odd.note.$, odd.note.head.length, odd.note.length]; // → ["string", 1000, 1200]
  ```

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  class Order {
      id = 7;
  }
  const order = new Order();
  Object.defineProperty(order, "total", {
      get() {
          throw new Error("never called");
      },
      enumerable: true,
  });
  juris.setValue("order", order);
  juris.setValue("format", function euros(amount) {
      return `${amount} €`;
  });
  endpoint.request(panel, "state", { path: "order" }).result;
  // → { $: "instance", of: "Order",
  //     entries: { id: 7,
  //                total: { $: "function", name: "get", kind: "getter" } } }
  endpoint.request(panel, "state", { path: "format" }).result;
  // → { $: "function", name: "euros", kind: "function" }
  ```

  ```js dom
  const { juris, endpoint, panel, app } = cartPage({
      state: { cart: { items: [{ name: "Milk", qty: 2 }] } },
  });
  juris.registerComponent("Row", (props) => ({ li: props.item.name }));
  // Each item comes from getState inside a binding: a tracking proxy.
  juris.render(app, {
      ul: {
          children: () => juris.getState("cart.items").map((item) => ({
              Row: { item },
          })),
      },
  });
  endpoint.request(panel, "component", { id: 1 }).result.props;
  // → { item: { name: "Milk", qty: 2 } }
  ```

  ```js dom
  import { settled, settledError } from "juris/state-manager.js";

  const { juris, endpoint, panel, app } = cartPage();
  juris.setValue("prices", {
      milk: settled(3),
      eggs: settledError(new TypeError("no price for eggs")),
      tea: new Promise(() => {}),
      cart: juris.api.ref("cart.items"),
      shelf: app,
  });
  endpoint.request(panel, "state", { path: "prices" }).result;
  // → { milk: { $: "settled", value: 3 },
  //     eggs: { $: "settled",
  //             error: { name: "TypeError", message: "no price for eggs" } },
  //     tea: { $: "promise" },
  //     cart: { $: "ref", path: "cart.items" },
  //     shelf: { $: "node", ref: 1, tag: "main", id: "app" } }
  ```

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  juris.setValue("order", {
      placed: new Date(Date.UTC(2026, 10, 6)),
      due: new Date("not a date"),
      tags: new Set(["gift"]),
      prices: new Map([["milk", 3]]),
      problem: new RangeError("too many eggs"),
  });
  endpoint.request(panel, "state", { path: "order" }).result;
  // → { placed: { $: "date", iso: "2026-11-06T00:00:00.000Z" },
  //     due: { $: "date", iso: null },
  //     tags: { $: "set", size: 1, items: ["gift"] },
  //     prices: { $: "map", size: 1, entries: [["milk", 3]] },
  //     problem: { $: "error", name: "RangeError", message: "too many eggs" } }
  juris.setValue("stock", new Map(Array.from({ length: 101 }, (_, n) => [n, n])));
  endpoint.request(panel, "state", { path: "stock" }).result.entries.at(-1);
  // → { $: "more", path: "stock", length: 101 }
  ```

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  const skus = Array.from({ length: 205 }, (_, n) => [`sku${n}`, n]);
  juris.setValue("stock", Object.fromEntries(skus));
  const stock = endpoint.request(panel, "state", { path: "stock" }).result;
  Object.keys(stock).length; // → 201
  stock["…"]; // → { $: "more", path: "stock", keys: 205 }
  endpoint.request(panel, "state", { path: "stock", from: 203 }).result;
  // → { sku203: 203, sku204: 204 }
  juris.setValue("money", { $: "EUR", amount: 3 });
  endpoint.request(panel, "state", { path: "money" }).result;
  // → { $: "object", entries: { $: "EUR", amount: 3 } }
  ```

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  juris.setValue("aisles", { dairy: { milk: { shelf: { row: 2 } } } });
  endpoint.request(panel, "state", { path: "aisles" }).result;
  // → { dairy: { milk: {
  //       shelf: { $: "more", path: "aisles.dairy.milk.shelf" } } } }
  endpoint.request(panel, "state", { path: "aisles", depth: 0 }).result;
  // → { $: "more", path: "aisles" }
  endpoint.request(panel, "state", { path: "cart.items.0", depth: 0 }).result;
  // → "Milk"
  const order = { id: 7 };
  order.self = order;
  juris.setValue("order", order);
  endpoint.request(panel, "state", { path: "order" }).result;
  // → { id: 7, self: { $: "cycle", path: "order" } }
  ```

  ```js dom
  const { juris, endpoint, panel } = cartPage({
      state: { session: { token: "s3cret", userId: 7 } },
      privatePaths: ["session"],
  });
  endpoint.request(panel, "state").result.session; // → { $: "private", count: 2 }
  ```

  A `more` or `cycle` `path` is where the value is: a state path, which `state` takes back, or a
  path inside a component's props (`"props.rows.3"`), which `component { id, path }` takes back.

  ```js dom
  const { juris, endpoint, panel, app } = cartPage();
  juris.setValue("aisles", { dairy: { milk: { shelf: { row: 2 } } } });
  const { path } = endpoint.request(panel, "state", { path: "aisles" }).result
      .dairy.milk.shelf;
  path; // → "aisles.dairy.milk.shelf"
  endpoint.request(panel, "state", { path }).result; // → { row: 2 }
  juris.registerComponent("Receipt", (props) => ({
      p: `${props.rows.length} lines`,
  }));
  const rows = [{ cells: ["Milk", 3] }, { cells: ["Eggs", 5] }];
  juris.render(app, { Receipt: { rows } });
  const { props } = endpoint.request(panel, "component", { id: 1 }).result;
  props.rows[1]; // → { cells: { $: "more", path: "props.rows.1.cells" } }
  const inside = { id: 1, path: "props.rows.1.cells" };
  endpoint.request(panel, "component", inside).result; // → ["Eggs", 5]
  ```

  An answer larger than 1 MiB of JSON is encoded again one level shallower until it fits, or until it
  can be no shallower, and says so (`cut: true`).

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  // Eleven aisles of 100 labels of 1,000 characters: about 1.1 MB at depth 3.
  const aisle = () => Array.from({ length: 100 }, () => "x".repeat(1000));
  const catalog = Object.fromEntries(
      Array.from({ length: 11 }, (_, n) => [`aisle${n}`, aisle()]),
  );
  juris.setValue("catalog", catalog);
  const answer = endpoint.request(panel, "state", { path: "catalog" });
  answer.cut; // → true
  answer.result.aisle0; // → { $: "more", path: "catalog.aisle0" }
  ```

- **Private roots** (D14). The roots `privatePaths` names but the async one (`$server`, which never
  reaches a browser, and the app's own: `hello`'s `privateRoots`) are counted, never listed.

  ```js dom
  const { endpoint, panel } = cartPage({ privatePaths: ["session"] });
  endpoint.request(panel, "hello").result.privateRoots;
  // → ["$server", "session"]
  ```

  In a list of paths (a binding's `reads`, a pass summary's `changed`, a ran entry's `wokeBy`) the
  paths under each such root are one `{ root, count }`, and so are a pass's writes there; in `state`
  such a root's value is `{ "$": "private", count }`, and so is any path at or under it.

  ```js dom
  const { juris, endpoint, panel, app } = cartPage({
      state: { session: { token: "s3cret", userId: 7 } },
      privatePaths: ["session"],
  });
  const session = () => juris.getState("session");
  juris.render(app, {
      p: () => `User ${session().userId}, token ${session().token}`,
  });
  endpoint.request(panel, "subscribe", { topic: "timeline" });
  juris.batch(() => {
      juris.setValue("session.token", "t0ken");
      juris.setValue("session.userId", 8);
  });
  const [pass] = endpoint.drain(panel).events;
  pass.writes; // → [{ root: "session", count: 2 }]
  pass.ran[0].wokeBy; // → [{ root: "session", count: 2 }]
  endpoint.request(panel, "passes").result[0].changed;
  // → [{ root: "session", count: 2 }]
  // session, session.token, session.userId:
  endpoint.request(panel, "binding", { id: 2 }).result.reads;
  // → [{ root: "session", count: 3 }]
  endpoint.request(panel, "state", { path: "session.token" }).result;
  // → { $: "private", count: 2 }
  ```

  The async root (`$async`) is the browser's own bookkeeping, and is listed and read like the rest.
  Hidden errors stay hidden: a failure is only ever given in the words the page already carries.

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  juris.api.group("checkout").track(new Promise(() => {}));
  endpoint.request(panel, "state", { path: "$async.groups" }).result;
  // → { checkout: { pending: 1 } }
  ```

- **Subscriptions** belong to a connection, and `unsubscribe` and `disconnect` take effect at once.

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  const other = endpoint.connect();
  endpoint.request(panel, "subscribe", { topic: "timeline" });
  juris.setValue("cart.items", ["Milk"]);
  endpoint.drain(other).events; // → []
  endpoint.drain(panel).events.length; // → 1
  endpoint.request(panel, "unsubscribe", { topic: "timeline" });
  juris.setValue("cart.items", []);
  endpoint.drain(panel).events; // → []
  ```

  `tree` watches `onTreeChange` while any connection holds it, and sends the tree at the next frame.

  ```js dom
  const { juris, endpoint, panel, app } = cartPage();
  const other = endpoint.connect();
  endpoint.request(panel, "subscribe", { topic: "tree" });
  endpoint.request(other, "subscribe", { topic: "tree" });
  endpoint.disconnect(panel);
  juris.render(app, { Cart: {} });
  await wait(20);
  endpoint.drain(other).events.map((event) => event.nodes.length); // → [2]
  ```

  `timeline`: while any connection holds it, every write is observed (`observe`), every callback of a
  pass is timed and what woke it is worked out, and a frame is marked after the passes; when the last
  one goes, `observe` is stopped (`stateManager.observers.size` back to what it was) and the timing
  is off.

  ```js dom
  const { juris, endpoint, panel } = cartPage();
  const other = endpoint.connect();
  const observers = () => juris.stateManager.observers.size;
  observers(); // → 0
  endpoint.request(panel, "subscribe", { topic: "timeline" });
  endpoint.request(other, "subscribe", { topic: "timeline" });
  observers(); // → 1
  endpoint.disconnect(panel);
  observers(); // → 1
  endpoint.request(other, "unsubscribe", { topic: "timeline" });
  observers(); // → 0
  ```

- **What it costs.** With devMode off, nothing: the module is not loaded, and the methods are the
  prototypes'. What runs all the same is one or two more arguments where a binding is made (its
  label). In devMode, each binding pays for its record (about 190 bytes), each pass for its summary,
  and each callback of a pass for a lookup. `juris-tests/bench/devtools.bench.mjs` measures a list
  of 500 rows, each a component with three bindings, and 300 seats (1,800 bindings, 500 instances),
  on the stand-in DOM, against devMode on without the feature; the numbers below are its medians,
  with the spread of three runs on Node 24.11 (2026-11-05), as "What it costs" records the module
  bytes. The budget is checked in Chrome on a large real app's object list as well, before a
  release.

  ```js dom
  const shop = new Juris();
  const { stateManager, renderer } = shop;
  const prototype = Object.getPrototypeOf(stateManager);
  stateManager.run === prototype.run; // → true
  renderer.bindState === Object.getPrototypeOf(renderer).bindState; // → true
  shop.devtools; // → undefined
  ```

  | Situation | Budget | Measured |
  | --- | --- | --- |
  | No connection | Creating a binding +25% at most; a pass +10% at most; 200 bytes at most per live binding | Creating every binding (a mount) +6% to +16%; a pass waking one binding +0% to +11%, waking 500 +1% to +6%; 190 bytes per live binding |
  | `timeline` subscribed | A pass 2× at most its devMode time; a drain 2 ms at most | A pass waking one binding 1.15× to 1.2×, waking 500 1.66× to 1.78×; a drain after a pass that woke 500, 0.16 to 0.17 ms. A drain that stops at 1 MiB takes 3.2 to 3.5 ms, over the budget: about 600 KB of JSON fits 2 ms |

**Where.** `devtools.js`; `juris.js` (`refused`, the `$juris` index); `client.js` (`devMode`);
`dom-renderer.js` (the labels); `server/document.js` (`jurisDev`); `server/kernel.js` (`dev`).
**Tests:** `tests/core.test.mjs` ("hydrate follows #juris-dev, and devMode: false overrides it",
"with devMode off, hydrate imports no devtools.js and exposes nothing"), `tests/render.test.mjs`
("devMode: each binding is labelled with what it draws", and what a node, a disposal and `wakes`
answer), `tests/boundary.test.mjs` (no static import of `devtools.js`, the boot graph, no string
evaluated as code); the kit's `tests/server.test.mjs` and `tests/document.test.mjs` (`#juris-dev`);
`juris-tests/tests/juris/devtools.test.mjs`, `devtools.timeline.test.mjs`,
`devtools.values.test.mjs` and `client.test.mjs` for the whole of it.

#### `live-data.js`

**Exports:** `useLiveData`, `useRouteData`, `claimPath`.

```js
import * as liveData from "juris/live-data.js";

Object.keys(liveData).sort(); // → ["claimPath", "useLiveData", "useRouteData"]
```

The helpers a component keeps a live query's answer on screen with, when its arguments come from
the route. It imports nothing.

```js
import { readFile } from "node:fs/promises";

const file = new URL(import.meta.resolve("juris/live-data.js"));
const source = await readFile(file, "utf8");
/^import\b/m.test(source); // → false
```

The examples below show an order page whose order comes from the route (`/orders/:id`), from an
`order` service that answers from `orders`; `settle()` lets a service's answer arrive.

```js setup
import Juris from "juris/juris.js";
import { createRouter } from "juris/router.js";
import {
    useLiveData,
    useRouteData,
    claimPath,
} from "juris/live-data.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";

const orders = {
    7: { id: 7, total: 12 },
    8: { id: 8, total: 30 },
};
const routes = [{ path: "/orders/:id", name: "order" }];
const settle = () => new Promise((resolve) => setTimeout(resolve));
```

- `useLiveData(api, service, argsFrom, path = service)` subscribes with what `argsFrom()` builds and
  writes the answer at `path`.

  ```js dom
  const juris = new Juris({
      services: { cart: async (userId) => ({ userId, items: ["Milk", "Eggs"] }) },
  });
  juris.setValue("session.userId", 42);
  juris.registerComponent("Cart", (props, api) => {
      const userId = () => api.getState("session.userId");
      const cart = useLiveData(api, "cart", () => [userId()]);
      return { p: { textContent: () => cart()?.items.join(", ") ?? "…" } };
  });
  const page = document.createElement("main");
  juris.render(page, { Cart: {} });
  await settle();
  page.innerHTML; // → <p>Milk, Eggs</p>
  juris.getState("cart"); // → { userId: 42, items: ["Milk", "Eggs"] }
  ```

  ```js dom
  const juris = new Juris({ services: { order: async (id) => orders[id] } });
  juris.registerComponent("LatestOrder", (props, api) => {
      const order = useLiveData(api, "order", () => [8], "latestOrder");
      return { p: { textContent: () => `Order ${order()?.id}` } };
  });
  juris.render(document.createElement("main"), { LatestOrder: {} });
  await settle();
  juris.getState("latestOrder"); // → { id: 8, total: 30 }
  ```

- `useRouteData(api, service, params = [], path = service, { viewer })` builds the arguments from
  the route's params, named in order and read where the router installed on the instance keeps the
  route (its `routePath`), then, when `viewer` is given, the value at that state path (null when
  there is none) as the last argument.

  ```js
  const juris = new Juris({
      services: { order: async (id) => orders[id] },
      features: { ssr: SSRRenderer },
  });
  juris.use(createRouter({ routes, routePath: "$page" }));
  juris.registerComponent("OrderPage", (props, api) => {
      const order = useRouteData(api, "order", ["id"]);
      const title = () => `Order ${order()?.id}: ${order()?.total} €`;
      return { h1: { textContent: title } };
  });
  const page = await juris.renderRequest({
      preload: [["order", "7"]],
      state: { $page: { path: "/orders/7" } },
      layout: { OrderPage: {} },
  });
  page.html; // → <h1>Order 7: 12 €</h1>
  ```

  ```js
  const asked = [];
  const juris = new Juris({
      services: {
          orders: async (status, viewer) => {
              asked.push([status, viewer]);
              return [];
          },
      },
      features: { ssr: SSRRenderer },
  });
  juris.use(createRouter({ routes: [{ path: "/orders/:status" }] }));
  juris.registerComponent("MyOrders", (props, api) => {
      const viewer = { viewer: "session.userId" };
      const list = useRouteData(api, "orders", ["status"], "orders", viewer);
      return { p: { textContent: () => `${list()?.length ?? 0} orders` } };
  });
  const request = (session) => juris.renderRequest({
      preload: [["orders", "open", session.userId ?? null]],
      state: { $route: { path: "/orders/open" }, session },
      layout: { MyOrders: {} },
  });
  await request({ userId: 42 });
  await request({});
  asked; // → [["open", 42], ["open", null]]
  ```

  `viewer` is a path, never `true`: the framework does not know where an app keeps who is asking,
  so an app that always keeps it in one place wraps these with that path.

  ```js
  // The shop keeps who is asking at session.userId: its own helper says so once.
  const viewer = "session.userId";
  const useMyRouteData = (api, service, params, path) => {
      return useRouteData(api, service, params, path, { viewer });
  };
  const juris = new Juris({
      services: { orders: async (status, viewer) => [`${status} for ${viewer}`] },
      features: { ssr: SSRRenderer },
  });
  juris.use(createRouter({ routes: [{ path: "/orders/:status" }] }));
  juris.registerComponent("MyOrders", (props, api) => {
      const list = useMyRouteData(api, "orders", ["status"]);
      return { p: { textContent: () => list()?.[0] } };
  });
  const page = await juris.renderRequest({
      preload: [["orders", "open", 42]],
      state: { $route: { path: "/orders/open" }, session: { userId: 42 } },
      layout: { MyOrders: {} },
  });
  page.html; // → <p>open for 42</p>
  ```

- The arguments are read inside the getter each returns, which is what the component reads the
  answer through, so a page `RouterView` keeps re-subscribes when they change and only then; the new
  subscription exists before the old one is stopped, so a change that arrives mid-swap is not lost,
  and the last answer stays on screen until the next arrives.

  ```js dom
  const log = [];
  const juris = new Juris({ services: { order: async (id) => orders[id] } });
  juris.use(createRouter({ routes }));
  juris.setValue("$route.path", "/orders/7");
  juris.registerComponent("OrderPage", (props, api) => {
      // The component's api, with each subscribe and stop logged.
      const logged = {
          ...api,
          live: (path, service, ...args) => {
              log.push(`subscribe ${args}`);
              const stop = api.live(path, service, ...args);
              return () => {
                  log.push(`stop ${args}`);
                  stop();
              };
          },
      };
      const order = useRouteData(logged, "order", ["id"]);
      return { h1: { textContent: () => `Order ${order()?.id}` } };
  });
  juris.render(document.createElement("main"), { OrderPage: {} });
  juris.setValue("$route.query", { tab: "items" }); // not an argument
  juris.setValue("$route.path", "/orders/8");
  log; // → ["subscribe 7", "subscribe 8", "stop 7"]
  ```

  They must be the route's `preload` entry's, argument for argument: a server render answers only
  what was preloaded.

  ```js
  const juris = new Juris({
      services: { order: async (id) => orders[id] },
      requirePreload: true,
      features: { ssr: SSRRenderer },
  });
  juris.use(createRouter({ routes }));
  juris.registerComponent("OrderPage", (props, api) => {
      const order = useRouteData(api, "order", ["id"]);
      return { h1: { textContent: () => `Order ${order()?.id}` } };
  });
  // The route's param is the string "7"; the preload says the number 7.
  await juris.renderRequest({
      preload: [["order", 7]],
      state: { $route: { path: "/orders/7" } },
      layout: { OrderPage: {} },
  });
  // throws Error: Juris.call: order:["7"] was not preloaded for this request
  ```

- The getter both helpers answer carries `path`, `state()` and `message()`, tracked reads of
  `api.liveState(path)` and `api.liveMessage(path)`: between a change of arguments and the new
  answer the last route's data stays on screen and `state()` is `"pending"`, and it is `"failed"`
  for good when the new answer is refused, where it used to be shown under the new route with no
  mark at all.

  ```js dom
  const juris = new Juris({
      services: {
          order: async (id) => {
              if (!orders[id]) throw new Error(`No order ${id}`);
              return orders[id];
          },
      },
  });
  juris.use(createRouter({ routes }));
  juris.setValue("$route.path", "/orders/7");
  let order;
  juris.registerComponent("OrderPage", (props, api) => {
      order = useRouteData(api, "order", ["id"], "shownOrder");
      const title = () => `Order ${order()?.id} (${order.state()})`;
      return { h1: { textContent: title } };
  });
  const page = document.createElement("main");
  juris.render(page, { OrderPage: {} });
  await settle();
  page.innerHTML; // → <h1>Order 7 (live)</h1>
  order.path; // → "shownOrder"
  juris.setValue("$route.path", "/orders/8");
  page.innerHTML; // → <h1>Order 7 (pending)</h1>
  await settle();
  page.innerHTML; // → <h1>Order 8 (live)</h1>
  ```

  ```js dom
  const juris = new Juris({
      services: {
          order: async (id) => {
              if (!orders[id]) throw new Error(`No order ${id}`);
              return orders[id];
          },
      },
  });
  juris.use(createRouter({ routes }));
  juris.setValue("$route.path", "/orders/7");
  let order;
  juris.registerComponent("OrderPage", (props, api) => {
      order = useRouteData(api, "order", ["id"]);
      const title = () => `Order ${order()?.id} (${order.state()})`;
      return { h1: { textContent: title } };
  });
  const page = document.createElement("main");
  juris.render(page, { OrderPage: {} });
  await settle();
  juris.setValue("$route.path", "/orders/9");
  await settle();
  page.innerHTML; // → <h1>Order 7 (failed)</h1>
  order.message(); // → "No order 9"
  ```

- `claimPath(api, path, service)` is one live path, one service: a path claimed by one service is
  refused to another, with both named (one service may write several paths), and both helpers claim
  the path they write; a component that subscribes with `api.live` itself claims its path by hand.

  ```js
  const juris = new Juris();
  claimPath(juris.api, "cart", "cart");
  claimPath(juris.api, "savedCart", "cart"); // one service, two paths
  claimPath(juris.api, "cart", "wishlist");
  // throws Error: Live path "cart" is already written by "cart", so "wishlist"
  ```

  ```js
  const juris = new Juris({
      services: { cart: async () => ["Milk"], wishlist: async () => ["Tea"] },
      features: { ssr: SSRRenderer },
  });
  juris.registerComponent("Cart", (props, api) => {
      const items = useLiveData(api, "cart", () => [], "items");
      return { p: { textContent: () => `${items()?.length ?? 0} in cart` } };
  });
  juris.registerComponent("Wishlist", (props, api) => {
      claimPath(api, "items", "wishlist"); // by hand, before api.live
      api.live("items", "wishlist");
      return { p: "Wishlist" };
  });
  juris.renderToString({ Cart: {} }); // → <p>0 in cart</p>
  juris.renderToString({ Wishlist: {} });
  // throws Error: Live path "items" is already written by "cart"
  ```

  A claim is kept on the instance whose api it is given, so another instance in the process starts
  with none, a server's instance keeps its claims across the requests it renders, and anything that
  is not a component's api is refused.

  ```js
  const shop = new Juris();
  const admin = new Juris();
  claimPath(shop.api, "cart", "cart");
  // Another instance: no claims yet.
  claimPath(admin.api, "cart", "wishlist");
  claimPath({}, "cart", "cart");
  // throws TypeError: claimPath(api, path, service): the first argument is
  ```

  ```js
  const juris = new Juris({ features: { ssr: SSRRenderer } });
  juris.registerComponent("Cart", (props, api) => {
      claimPath(api, "items", "cart");
      return { p: "Cart" };
  });
  juris.registerComponent("Wishlist", (props, api) => {
      claimPath(api, "items", "wishlist");
      return { p: "Wishlist" };
  });
  await juris.renderRequest({ layout: { Cart: {} } }); // one request
  await juris.renderRequest({ layout: { Wishlist: {} } }); // a later one
  // throws Error: Live path "items" is already written by "cart"
  ```

  ```js
  // The instance is not its api: pass `juris.api`, or a component's `api`.
  claimPath(new Juris(), "cart", "cart");
  // throws TypeError: claimPath(api, path, service): the first argument is
  ```

- An option `useRouteData` does not know, a `viewer` that is not a path and `params` that are not a
  list of names are refused, and so is `useRouteData` on an instance with no router.

  ```js
  const juris = new Juris();
  juris.use(createRouter({ routes }));
  const { api } = juris;
  useRouteData(api, "order", ["id"], "order", { user: "session.userId" });
  // throws TypeError
  useRouteData(api, "order", ["id"], "order", { viewer: true });
  // throws TypeError: useRouteData: `viewer` is the state path of who is asking
  useRouteData(api, "order", "id");
  // throws TypeError: useRouteData: `params` is a list of the route's param names
  ```

  ```js
  const juris = new Juris({ features: { ssr: SSRRenderer } });
  juris.registerComponent("OrderPage", (props, api) => {
      useRouteData(api, "order", ["id"]);
      return { h1: "Order" };
  });
  juris.renderToString({ OrderPage: {} });
  // throws Error: useRouteData: the arguments are the route's params
  ```

#### `clock.js`

**Exports:** `clock`.

```js
import { clock } from "juris/clock.js";

typeof clock(); // → "function"
```

`clock(now = () => Date.now())` is the plugin that gives every component `api.now()`, so a
component never reads the time itself and a test hands every component a frozen clock
(`juris.use(clock(() => t))`).

```js
import Juris from "juris/juris.js";
import { clock } from "juris/clock.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";

const juris = new Juris({ features: { ssr: SSRRenderer } });
const t = Date.UTC(2026, 10, 6, 9, 30); // a frozen clock, for a test
juris.use(clock(() => t));
juris.registerComponent("Today", (props, api) => ({
    time: new Date(api.now()).toISOString().slice(0, 10),
}));
juris.renderToString({ Today: {} }); // → <time>2026-11-06</time>
```

```js
import Juris from "juris/juris.js";
import { clock } from "juris/clock.js";

const juris = new Juris();
juris.use(clock());
const before = Date.now();
juris.api.now() >= before; // → true
```

Every read during a traced server render marks the render with the flag `"clock"` (`markRender`, a
no-op outside one), and the page cache keeps no render that carries a flag, so a page that says
"Today" is never served after midnight from a copy made before it.

```js
import Juris from "juris/juris.js";
import { clock } from "juris/clock.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";
import { decide } from "juris-kit/server/page-cache.js";

const juris = new Juris({ features: { ssr: SSRRenderer } });
juris.use(clock());
juris.registerComponent("Greeting", (props, api) => ({
    p: new Date(api.now()).getHours() < 12 ? "Good morning" : "Hello",
}));
juris.renderToString({ Greeting: {} }, null, { trace: true });
juris.renderTrace().flags; // → ["clock"]
decide(juris.renderTrace()); // → { cache: false, reason: "volatile:clock" }
```

```js
import Juris from "juris/juris.js";
import { clock } from "juris/clock.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";

const juris = new Juris({ features: { ssr: SSRRenderer } });
juris.use(clock());
juris.renderToString({ p: "Opening hours" }, null, { trace: true });
juris.renderTrace().flags; // → []
// Outside a traced render: no mark, and nowhere to put one.
juris.api.now();
juris.renderTrace().flags; // → []
```

Any flag is volatile, so the name is not a contract with the cache.

```js
import Juris from "juris/juris.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";
import { decide } from "juris-kit/server/page-cache.js";

const juris = new Juris({ features: { ssr: SSRRenderer } });
juris.registerComponent("Weather", (props, api) => {
    api.markRender("weather");
    return { p: "Sunny" };
});
juris.renderToString({ Weather: {} }, null, { trace: true });
decide(juris.renderTrace()); // → { cache: false, reason: "volatile:weather" }
```

An app installs it on its server's instance and in its browser boot alike. It imports nothing.

```js dom
import Juris from "juris/juris.js";
import { hydrate } from "juris/client.js";
import { clock } from "juris/clock.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";

// What the shop's server and its browser entry both import.
const plugins = [clock(() => Date.UTC(2026, 10, 6))];
const Today = (props, api) => ({ time: new Date(api.now()).toDateString() });

const server = new Juris({ features: { ssr: SSRRenderer } });
plugins.forEach((plugin) => server.use(plugin));
server.registerComponent("App", Today);
const html = server.renderToString({ App: {} });

document.body.innerHTML = [
    `<div id="app">${html}</div>`,
    '<script type="application/json" id="state">{}</script>',
].join("");
await hydrate({
    routes: [],
    plugins,
    prefetch: false,
    register: (juris) => juris.registerComponent("App", Today),
});
document.getElementById("app").innerHTML === html; // → true
```

#### `headless.js`

**Exports:** `HeadlessManager`, `createContext`.

```js
import { HeadlessManager, createContext } from "juris/headless.js";

[typeof HeadlessManager, typeof createContext]; // → ["function", "function"]
```

The examples below share `Cart`, a headless component that keeps the cart's items in the state and
says on the console when it is registered and unregistered.

```js setup
import Juris from "juris/juris.js";
import { HeadlessManager, createContext } from "juris/headless.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";

function Cart(props, context) {
    const items = () => context.getState("cart.items", []);
    return {
        api: {
            add: (item) => context.setState("cart.items", [...items(), item]),
            count: () => items().length,
        },
        hooks: {
            onRegister: () => console.log("cart: registered"),
            onUnregister: () => console.log("cart: unregistered"),
        },
    };
}
```

0.91's headless components on this core: logic with no element, made once per instance, whose `api`
joins the component api under its name.

```js
const juris = new Juris({
    features: { headless: HeadlessManager, ssr: SSRRenderer },
    headlessComponents: { cart: { fn: Cart, options: { autoInit: true } } },
});
juris.registerComponent("BuyButton", (props, api) => ({
    button: `Add (${api.cart.count()} in cart)`,
}));
juris.api.cart.add("Milk");
juris.renderToString({ BuyButton: {} }); // → <button>Add (1 in cart)</button>
```

Given as `features: { headless: HeadlessManager }` with `headlessComponents: { name: fn | { fn,
options } }`, or `new HeadlessManager(juris, { headlessComponents })`.

```js
const juris = new Juris({
    features: { headless: HeadlessManager },
    headlessComponents: {
        cart: { fn: Cart, options: { autoInit: true } },
        wishlist: Cart,
    },
});
// console.log: cart: registered
juris.getHeadlessStatus();
// → { registered: ["cart", "wishlist"], initialized: ["cart"], queued: [],
//     apis: ["cart"] }
```

```js
const juris = new Juris();
new HeadlessManager(juris, { headlessComponents: { cart: Cart } });
juris.headlessManager instanceof HeadlessManager; // → true
new HeadlessManager(juris);
// throws Error: HeadlessManager: this instance has one already
```

A headless component is `(props, context) => ({ api, hooks: { onRegister, onUnregister } })`, made by
`initialize` (at once with `options.autoInit`, given the options as props); `reinitialize` makes it
again, its `onUnregister` first, and `cleanup` ends them all.

```js
const juris = new Juris({
    features: { headless: HeadlessManager },
    headlessComponents: { cart: Cart },
});
"cart" in juris.api; // → false
juris.initializeHeadlessComponent("cart");
// console.log: cart: registered
juris.api.cart.add("Milk");
juris.headlessManager.reinitialize("cart");
// console.log: cart: unregistered
// console.log: cart: registered
juris.headlessManager.cleanup();
// console.log: cart: unregistered
"cart" in juris.api; // → false
juris.getState("cart.items"); // → ["Milk"]
```

```js
const seen = [];
const Banner = (props) => {
    seen.push(props);
    return { api: { text: () => `Free delivery over ${props.over} €` } };
};
const juris = new Juris({
    features: { headless: HeadlessManager },
    headlessComponents: {
        banner: { fn: Banner, options: { autoInit: true, over: 50 } },
    },
});
seen; // → [{ autoInit: true, over: 50 }]
juris.api.banner.text(); // → "Free delivery over 50 €"
```

A name the component api has already is refused, as `extendApi` refuses it; a component that is
missing, throws or answers no object is said on the console and answers null.

```js
const juris = new Juris({ features: { headless: HeadlessManager } });
juris.registerHeadlessComponent("getState", Cart);
juris.initializeHeadlessComponent("getState"); // → null
// console.error: HeadlessManager: "getState" failed to initialize
juris.api.getState === juris.getState; // → false
typeof juris.api.getState("cart"); // → "undefined"
```

```js
const juris = new Juris({ features: { headless: HeadlessManager } });
juris.initializeHeadlessComponent("wishlist"); // → null
// console.error: HeadlessManager: no headless component "wishlist"
juris.registerHeadlessComponent("checkout", () => {
    throw new Error("no payment provider");
});
juris.initializeHeadlessComponent("checkout"); // → null
// console.error: HeadlessManager: "checkout" failed to initialize
juris.registerHeadlessComponent("coupon", () => "10% off");
juris.initializeHeadlessComponent("coupon"); // → null
// console.error: HeadlessManager: "coupon" answered no object
```

The instance gains 0.91's methods: `registerHeadlessComponent`, `initializeHeadlessComponent`,
`initializeQueuedHeadlessComponent`, `getHeadlessComponent`, `getHeadlessAPI`,
`registerAndInitHeadless`, `getHeadlessStatus`, `createHeadlessContext`, `createContext`, and
`headlessManager`, `headlessAPIs`.

```js
const juris = new Juris({ features: { headless: HeadlessManager } });
juris.registerAndInitHeadless("cart", Cart);
// console.log: cart: registered
juris.getHeadlessAPI("cart") === juris.api.cart; // → true
juris.headlessAPIs.cart === juris.api.cart; // → true
Object.keys(juris.getHeadlessComponent("cart")); // → ["api", "hooks"]
juris.initializeQueuedHeadlessComponent(); // nothing queued: nothing made
juris.getHeadlessStatus().initialized; // → ["cart"]
```

```js
const juris = new Juris({
    state: { cart: { items: ["Milk"] } },
    features: { headless: HeadlessManager },
    headlessComponents: { cart: { fn: Cart, options: { autoInit: true } } },
});
const badge = { localName: "cart-badge" }; // an element, as 0.91 had one
const context = juris.createHeadlessContext(badge);
context.element === badge; // → true
context.cart.count(); // → 1
juris.createContext().getState("cart.items"); // → ["Milk"]
```

`createContext(juris, element)` is 0.91's component context: the component api, and beside it
`getState(path, default = null, track)` (a `track` of false reads without subscribing),
`setState`, `executeBatch`, `subscribe(path, callback, hierarchical = true)` (`callback(value,
previous, changedPath)` after a write to the path, or beneath it unless `hierarchical` is false),
the services and the headless apis by name, `headless`, `isSSR`, `components` (`register`, `get`,
`registerHeadless`, `getHeadless`, `initHeadless`, `reinitHeadless`, `getHeadlessAPI`), `juris` and
`element`.

```js
const juris = new Juris({ state: { cart: { count: 2 } } });
const context = createContext(juris);
context.getState("cart.count"); // → 2
context.getState("cart.total"); // → null
context.getState("cart.total", 0); // → 0
context.setState("cart.count", 3);
context.executeBatch(() => {
    context.setState("cart.count", 4);
    context.setState("cart.total", 12);
});
juris.getState("cart"); // → { count: 4, total: 12 }
```

```js dom
const juris = new Juris({ state: { cart: { count: 2 } } });
const context = createContext(juris);
let runs = 0;
juris.render(document.createElement("main"), {
    p: () => {
        runs += 1;
        return `${context.getState("cart.count", 0, false)} in cart`;
    },
});
context.setState("cart.count", 3);
runs; // → 1
```

```js
const juris = new Juris({ state: { cart: { count: 2 } } });
const context = createContext(juris);
const heard = [];
const stop = context.subscribe("cart", (value, previous, changedPath) => {
    heard.push([value, previous, changedPath]);
});
context.setState("cart.count", 3);
context.setState("cart", { count: 1 });
heard; // → [[3, 2, "cart.count"], [{ count: 1 }, { count: 3 }, "cart"]]
const exact = [];
context.subscribe("cart", (value) => exact.push(value), false);
context.setState("cart.count", 5);
exact; // → []
stop();
```

```js
const juris = new Juris({
    services: { price: async (sku) => (sku === "milk" ? 3 : 5) },
    features: { headless: HeadlessManager },
    headlessComponents: { cart: { fn: Cart, options: { autoInit: true } } },
});
// console.log: cart: registered
const context = createContext(juris, { localName: "cart-badge" });
await context.price("milk"); // → 3
context.cart.count(); // → 0
context.headless.cart === context.cart; // → true
context.components.getHeadlessAPI("cart") === context.cart; // → true
[context.isSSR, context.juris === juris]; // → [true, true]
Object.keys(context.components);
// → ["register", "get", "registerHeadless", "getHeadless", "initHeadless",
//    "reinitHeadless", "getHeadlessAPI"]
context.element; // → { localName: "cart-badge" }
```

0.91's `utils`, `objectToHtml`, `setupIndicators`, `logger` and the named component api have no
counterpart on this core and are not there.

```js
const context = createContext(new Juris());
const gone = ["utils", "objectToHtml", "setupIndicators", "logger"];
gone.filter((name) => name in context); // → []
```

#### `fluentstate.js`

**Exports:** `createFluentStateHeadless`.

```js
import { createFluentStateHeadless } from "juris/fluentstate.js";

typeof createFluentStateHeadless; // → "function"
```

0.91's FluentState, a headless component: `headlessComponents: { fluentState: { fn:
createFluentStateHeadless, options: { autoInit: true } } }`, then `const $ =
api.fluentState.getFluentStates()`.

```js dom
import Juris from "juris/juris.js";
import { HeadlessManager } from "juris/headless.js";
import { createFluentStateHeadless } from "juris/fluentstate.js";

const juris = new Juris({
    features: { headless: HeadlessManager },
    headlessComponents: {
        fluentState: {
            fn: createFluentStateHeadless,
            options: { autoInit: true },
        },
    },
});
juris.registerComponent("Greeting", (props, api) => {
    const $ = api.fluentState.getFluentStates();
    return { p: { textContent: () => `Hello, ${$.user.name}` } };
});
juris.setValue("user.name", "Ada");
const page = document.createElement("main");
juris.render(page, { Greeting: {} });
page.innerHTML; // → <p>Hello, Ada</p>
```

The examples below share that instance, and its root `$`:

```js setup
import Juris from "juris/juris.js";
import { HeadlessManager } from "juris/headless.js";
import { createFluentStateHeadless } from "juris/fluentstate.js";

const juris = new Juris({
    features: { headless: HeadlessManager },
    headlessComponents: {
        fluentState: {
            fn: createFluentStateHeadless,
            options: { autoInit: true },
        },
    },
});
const $ = juris.api.fluentState.getFluentStates();
```

`$.user.name` reads (inside a binding, as getState: a dependency) and `$.user.name = "Ada"` writes
(setValue, missing parents made); a property whose value is not a primitive (an object, an array,
null, nothing yet) reads as a fluent object for its path, so `$.a.b.c = 1` and `$.list.push(x)` work
where nothing exists, and `exists()` says whether something does.

```js
$.user.name = "Ada";
juris.getState("user"); // → { name: "Ada" }
$.user.name; // → "Ada"
$.order.shipping.city = "Lyon";
juris.getState("order"); // → { shipping: { city: "Lyon" } }
$.cart.items.push("Milk"); // → 1
juris.getState("cart.items"); // → ["Milk"]
```

```js dom
$.user.name = "Ada";
const page = document.createElement("main");
juris.render(page, { p: { textContent: () => `Hello, ${$.user.name}` } });
$.user.name = "Grace";
page.innerHTML; // → <p>Hello, Grace</p>
```

```js
$.user.name = "Ada";
$.user.exists(); // → true
$.wishlist.exists(); // → false
typeof $.wishlist; // → "object"
```

Reading never writes.

```js
$.coupon.code;
$.coupon.exists(); // → false
juris.getState("coupon"); // → undefined
```

`$.x` reads without subscribing, and its writes reach no fluent subscriber.

```js dom
$.user.name = "Ada";
const page = document.createElement("main");
juris.render(page, { p: { textContent: () => `Hello, ${$.x.user.name}` } });
$.user.name = "Grace";
page.innerHTML; // → <p>Hello, Ada</p>
```

```js
const heard = [];
$.cart.subscribe((value, previous, changedPath) => heard.push(changedPath));
$.x.cart.count = 2;
juris.getState("cart.count"); // → 2
heard; // → []
$.x.cart.subscribe;
// console.warn: FluentState: subscriptions are not available through $.x
```

A fluent object has `push`, `pop`, `shift`, `unshift`, `splice` (each writes a new array and answers
what the native method does), `update`, `clear`, `exists`, `raw`, `subscribe` / `watch` /
`onChange(callback, { immediate, deep, once })` and `unsubscribe(stop)`; it converts to its value (as
text, nothing for nothing there), iterates when it is an array, and lists its keys.

```js
$.cart.items = ["Milk"];
$.cart.items.push("Eggs", "Bread"); // → 3
$.cart.items.pop(); // → "Bread"
$.cart.items.shift(); // → "Milk"
$.cart.items.unshift("Tea"); // → 2
$.cart.items.splice(0, 1, "Jam"); // → ["Tea"]
juris.getState("cart.items"); // → ["Jam", "Eggs"]
```

```js
$.user = { name: "Ada" };
$.user.update({ age: 36 }); // → { name: "Ada", age: 36 }
$.user.raw(); // → { name: "Ada", age: 36 }
$.user.clear();
juris.getState("user"); // → null
```

```js
$.todos = [{ title: "Milk" }, { title: "Eggs" }];
`${$.todos[0].title} and ${$.todos[1].title}`; // → "Milk and Eggs"
[...$.todos].map((todo) => `${todo.title}`); // → ["Milk", "Eggs"]
Object.keys($.todos[0]); // → ["title"]
JSON.stringify($.todos[0]); // → '{"title":"Milk"}'
`[${$.nothing}]`; // → "[]"
```

```js
$.cart = { count: 0 };
const counts = [];
const stop = $.cart.subscribe((value) => counts.push(value.count), {
    immediate: true,
});
$.cart.count = 1;
$.cart.unsubscribe(stop); // → true
$.cart.count = 2;
counts; // → [0, 1]
const once = [];
$.user.onChange((value, previous, changedPath) => once.push(changedPath), {
    once: true,
});
$.user.name = "Ada";
$.user.name = "Grace";
once; // → ["user.name"]
```

A subscription hears every write to its path, beneath it (unless `deep` is false) and above it, by
anyone, except through `$.x`.

```js
const heard = [];
$.cart.watch((value, previous, changedPath) => heard.push(changedPath));
$.cart = { count: 1 }; // its path
juris.setValue("cart.count", 2); // beneath it, by anyone
juris.clearState({ cart: { count: 3 } }); // above it
$.x.cart.count = 4; // through $.x
heard; // → ["cart", "cart.count", ""]
```

```js
const heard = [];
$.cart.watch((value, previous, changedPath) => heard.push(changedPath), {
    deep: false,
});
$.cart.count = 1;
$.cart = { count: 2 };
heard; // → ["cart"]
```

`api.fluentState.batch(fn)` is one notification pass, each subscription called once at its end.

```js
const heard = [];
$.cart.subscribe((value) => heard.push(JSON.stringify(value)));
juris.api.fluentState.batch(() => {
    $.cart.count = 2;
    $.cart.total = 6;
});
heard; // → ['{"count":2,"total":6}']
```

Unlike 0.91, a fluent object is a new one on each read (`$.a === $.a` is false; compare values) and
nothing is logged.

```js
$.cart = { count: 2 };
$.cart === $.cart; // → false
$.cart.count === $.cart.count; // → true
JSON.stringify($.cart) === JSON.stringify($.cart); // → true
```

#### `webcomponent.js`

**Exports:** `WebComponentFactory`.

```js
import { WebComponentFactory } from "juris/webcomponent.js";

typeof WebComponentFactory; // → "function"
```

0.91's custom elements drawn by Juris: `features: { webComponentFactory: WebComponentFactory }`, or
`new WebComponentFactory(juris)`, then `juris.createWebComponent(name, definition, options)` and
`juris.createWebComponents({ name: definition | { component, options } }, globalOptions)`.

```js
import Juris from "juris/juris.js";
import { WebComponentFactory } from "juris/webcomponent.js";

const juris = new Juris({
    features: { webComponentFactory: WebComponentFactory },
});
juris.webComponentFactory instanceof WebComponentFactory; // → true
typeof juris.createWebComponent; // → "function"
typeof juris.createWebComponents; // → "function"
// Node has no custom elements:
juris.createWebComponent("cart-badge", () => ({ span: "2" }));
// throws Error: WebComponentFactory: custom elements need a browser
```

```js
import Juris from "juris/juris.js";
import { WebComponentFactory } from "juris/webcomponent.js";

const juris = new Juris();
new WebComponentFactory(juris);
juris.createWebComponent("cartbadge", () => ({ span: "2" }));
// throws Error: WebComponent name "cartbadge" must contain a hyphen (-)
new WebComponentFactory({});
// throws TypeError: WebComponentFactory: give it the Juris instance
```

```js browser
import Juris from "juris/juris.js";
import { WebComponentFactory } from "juris/webcomponent.js";

const juris = new Juris();
new WebComponentFactory(juris);
const created = juris.createWebComponents({
    "cart-icon": () => ({ span: "Cart" }),
    "cart-note": {
        component: () => ({ em: "Free delivery" }),
        options: { shadowMode: "closed" },
    },
}, { styles: "span { font-weight: bold; }" });
Object.keys(created); // → ["cart-icon", "cart-note"]
document.body.innerHTML = "<cart-icon></cart-icon><cart-note></cart-note>";
document.querySelector("cart-icon").shadowRoot.innerHTML;
// → <style>span { font-weight: bold; }</style><span>Cart</span>
document.querySelector("cart-note").shadowRoot; // → null
```

The examples below need a browser's custom elements, which the stand-in page does not have; each
shares this instance:

```js setup browser
import Juris from "juris/juris.js";
import { WebComponentFactory } from "juris/webcomponent.js";

const juris = new Juris({
    features: { webComponentFactory: WebComponentFactory },
});
```

A definition is `(props, context) => layout` (`this` the element) or `{ render | component | template,
initialState, hooks: { onConnect, onMount, onUnmount, onAttributeChange } }`.

```js browser
juris.createWebComponent("cart-badge", (props) => ({
    span: { className: "badge", textContent: `${props.count} in cart` },
}), { attributes: ["count"] });
document.body.innerHTML = '<cart-badge count="2"></cart-badge>';
const badge = document.querySelector("cart-badge");
badge.shadowRoot.innerHTML; // → <span class="badge">2 in cart</span>
```

```js browser
const log = [];
juris.createWebComponent("cart-total", {
    initialState: { total: 0 },
    render(props) {
        return { output: `${props.total} €` };
    },
    hooks: {
        onConnect: () => log.push("connect"),
        onMount: () => log.push("mount"),
        onUnmount: () => log.push("unmount"),
        onAttributeChange(name, old, value) {
            log.push(`${name}: ${value}`);
        },
    },
}, { attributes: ["currency"] });
const total = document.createElement("cart-total");
document.body.append(total);
await new Promise((resolve) => requestAnimationFrame(resolve));
total.setAttribute("currency", "EUR");
total.remove();
log; // → ["connect", "mount", "currency: EUR", "unmount"]
```

Options: `attributes` (observed, read as values), `styles`, `shadowMode` ("open"), `enhanceMode`
(draw into the element), `autoConnect`, `stateNamespace`, `contextProvider`, `autoRerender`,
`rerenderOnAttributeChange`, `cleanupState`.

```js browser
juris.createWebComponent("stock-level", (props) => ({
    span: `${typeof props.count}: ${props.count}, ${props.tags.join(" ")}`,
}), { attributes: ["count", "tags"] });
const level = document.createElement("stock-level");
level.setAttribute("count", "12");
level.setAttribute("tags", '["dairy","fresh"]');
document.body.append(level);
level.shadowRoot.innerHTML;
// → <span>number: 12, dairy fresh</span>
```

```js browser
juris.createWebComponent("price-tag", () => ({ b: "3 €" }), {
    styles: "b { color: teal; }",
    shadowMode: "closed",
});
juris.createWebComponent("sale-note", () => ({ em: "Sale" }), {
    enhanceMode: true,
});
document.body.innerHTML = "<price-tag></price-tag><sale-note></sale-note>";
document.querySelector("price-tag").shadowRoot; // → null
document.querySelector("sale-note").innerHTML; // → <em>Sale</em>
```

```js browser
juris.createWebComponent("cart-panel", {
    initialState: { open: false },
    render: (props) => ({ p: props.open ? "Open" : "Closed" }),
}, { stateNamespace: "ui.cartPanel", cleanupState: false });
document.body.innerHTML = "<cart-panel></cart-panel>";
juris.getState("ui.cartPanel"); // → { open: false }
document.querySelector("cart-panel").remove();
juris.getState("ui.cartPanel"); // → { open: false }
```

Each element's state is at `webcomponents.<name>.<id>` (or `stateNamespace`), its props its
attributes with its state over them, and it draws again when its state changes, disposing what it
drew; a promise shows a `juris-loading` div until it settles, and a throw shows its message.

```js browser
juris.createWebComponent("cart-counter", {
    initialState: { count: 1 },
    render: (props) => ({ output: String(props.count) }),
});
document.body.innerHTML = "<cart-counter></cart-counter>";
const counter = document.querySelector("cart-counter");
juris.getState("webcomponents.cart_counter.cart-counter-1"); // → { count: 1 }
counter.updateComponentState({ count: 2 });
counter.shadowRoot.innerHTML; // → <output>2</output>
```

```js browser
juris.createWebComponent("order-status", async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { p: "Shipped" };
});
juris.createWebComponent("broken-widget", () => {
    throw new Error("no data");
});
document.body.innerHTML = [
    "<order-status></order-status>",
    "<broken-widget></broken-widget>",
].join("");
document.querySelector("order-status").shadowRoot.innerHTML;
// → <div class="juris-loading">Loading...</div>
document.querySelector("broken-widget").shadowRoot.textContent;
// → "Component Error: no data"
```

Its context is `createContext` for the element with `component` (`getState`, `setState`,
`updateState`, `getAttribute`, `setAttribute`, `emit`, `getSlot`, `getAllSlots`, …); the element has
`render`, `forceRender`, `getJurisContext`, `getComponentState`, `updateComponentState`.

```js browser
juris.createWebComponent("add-to-cart", (props, { component }) => {
    const sku = component.getAttribute("sku");
    return {
        button: {
            textContent: `Add ${sku}`,
            onclick: () => component.emit("cart:add", { sku }),
        },
    };
}, { attributes: ["sku"] });
document.body.innerHTML = '<add-to-cart sku="milk"></add-to-cart>';
const added = [];
document.addEventListener("cart:add", (event) => added.push(event.detail.sku));
const button = document.querySelector("add-to-cart").shadowRoot.firstChild;
button.click();
added; // → ["milk"]
```

```js browser
juris.createWebComponent("mini-cart", () => ({ p: "2 items" }));
document.body.innerHTML = "<mini-cart></mini-cart>";
const cart = document.querySelector("mini-cart");
cart.getJurisContext().component.name; // → "mini-cart"
cart.getComponentState(); // → {}
cart.forceRender();
cart.shadowRoot.innerHTML; // → <p>2 items</p>
```

A shadow root is attached once, so an element that is moved draws again into it.

```js browser
juris.createWebComponent("cart-summary", () => ({ p: "2 items" }));
document.body.innerHTML = '<cart-summary></cart-summary><aside></aside>';
const summary = document.querySelector("cart-summary");
const root = summary.shadowRoot;
document.querySelector("aside").append(summary); // moved: connected again
summary.shadowRoot === root; // → true
root.innerHTML; // → <p>2 items</p>
```

#### `storage.js`

**Exports:** `STORAGE`, `trailKey`.

```js
import { STORAGE, trailKey } from "juris/storage.js";

Object.isFrozen(STORAGE); // → true
STORAGE.length; // → 1
typeof trailKey; // → "function"
```

What the framework stores in a browser, declared: see "What the framework stores in a browser",
below.

```js
import { STORAGE } from "juris/storage.js";

const [trail] = STORAGE;
[trail.key, trail.kind, trail.category];
// → ["juris:$route:length", "sessionStorage", "necessary"]
trail.life; // → "Until the tab closes."
trail.purpose.startsWith("Remembers how far Back and Forward can go"); // → true
```

`trailKey({ routePath, base })` is the key the router takes its trail length from, so what is
declared is what is written. A leaf.

```js
import { trailKey } from "juris/storage.js";

trailKey(); // → "juris:$route:length"
trailKey({ base: "/shop" }); // → "juris:/shop:$route:length"
trailKey({ routePath: "$page", base: "/admin" });
// → "juris:/admin:$page:length"
```

```js dom
import Juris from "juris/juris.js";
import { createRouter } from "juris/router.js";
import { STORAGE } from "juris/storage.js";

// The stand-in page has no location or history: these stand in for a tab's.
window.location = { pathname: "/cart", search: "", hash: "" };
window.history = {
    state: null,
    replaceState(state) {
        this.state = state;
    },
};
const tab = new Map();
const storage = {
    getItem: (key) => tab.get(key) ?? null,
    setItem: (key, value) => tab.set(key, value),
};
const router = createRouter({
    routes: [{ path: "/cart" }],
    history: { storage },
});
new Juris().use(router);
[...tab.keys()]; // → ["juris:$route:length"]
STORAGE.map((entry) => entry.key); // → ["juris:$route:length"]
```
### Modules for Node only

`juris-kit/server/`, never served, reading no environment variable, and depending on no
npm package but `juris`: database drivers are passed in.

```js
import { readFile } from "node:fs/promises";

const kit = import.meta.resolve("juris-kit/server/http.js");
const manifest = await readFile(new URL("../package.json", kit), "utf8");
Object.keys(JSON.parse(manifest).dependencies); // → ["juris"]
```

```js
import { readdir, readFile } from "node:fs/promises";

const kit = import.meta.resolve("juris-kit/server/http.js");
const server = new URL(".", kit);
const reading = [];
for (const name of await readdir(server, { recursive: true })) {
    if (!name.endsWith(".js")) continue;
    const source = await readFile(new URL(name, server), "utf8");
    if (source.includes("process.env")) reading.push(name);
}
reading; // → []
```

```js
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createModuleServer } from "juris-kit/server/modules.js";

const kit = import.meta.resolve("juris-kit/server/http.js");
const server = fileURLToPath(new URL(".", kit));
await createModuleServer({
    root: tmpdir(),
    build: "v1",
    mounts: [{ url: "/server/", dir: server, outside: true }],
});
// throws TypeError: createModuleServer: mount "/server/": its dir reaches the
//   framework
```

#### `server/kernel.js`

**Exports:** `createJurisServer`, `createPagePipeline`, `createLifecycle`.

What a server does between a request arriving and a page going out. `createJurisServer` is what an
app calls; the other two are its parts, and stay importable on their own.

The examples on this page serve one small todo app, written to a temporary directory: two services,
three routes, four components, a stylesheet and the browser entry, `app/boot.js`. `served(config,
visit)` builds the app with `config` over it, listens on a free port, hands `visit` the address,
and always closes it; `element(html, tag)` is the first such element of a page.

```js setup
import http from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    createJurisServer,
    createPagePipeline,
    createLifecycle,
} from "juris-kit/server/kernel.js";

const root = mkdtempSync(join(tmpdir(), "todos-"));
mkdirSync(join(root, "app"));
writeFileSync(join(root, "app", "boot.js"), "export const start = () => {};\n");
writeFileSync(join(root, "app", "site.css"), "main { margin: 0 auto; }\n");
process.on("exit", () => rmSync(root, { recursive: true, force: true }));

const todos = [
    { id: 1, title: "Milk" },
    { id: 2, title: "Eggs" },
];

const app = {
    root,
    build: "v1",
    services: {
        todos: async () => todos,
        todo: async (id) =>
            todos.find((todo) => todo.id === Number(id)) ?? null,
    },
    routes: [
        {
            path: "/",
            name: "home",
            component: "Home",
            head: { title: "Todos" },
            preload: () => [["todos"]],
        },
        {
            path: "/todos/:id",
            name: "todo",
            component: "Todo",
            head: { titleFrom: (todo) => todo.title },
            preload: ({ params }) => [["todo", params.id]],
        },
        {
            path: "/account",
            name: "account",
            component: "Account",
            meta: { private: true },
        },
    ],
    setup(juris) {
        juris.registerComponent("App", () => ({
            main: { children: [{ RouterView: {} }] },
        }));
        juris.registerComponent("Home", (props, api) => ({
            ul: {
                children: api.preloaded("todos").map((todo) => ({
                    li: todo.title,
                })),
            },
        }));
        juris.registerComponent("Todo", (props, api) => {
            const id = api.getState("$route.params.id");
            return { h1: api.preloaded("todo", id)?.title ?? "Not found" };
        });
        juris.registerComponent("Account", () => ({ h1: "Your account" }));
    },
    modules: {
        mounts: [{ url: "/app/", dir: "app", only: [".js", ".css"] }],
        entry: "/app/boot.js",
    },
};

async function served(config, visit) {
    const server = await createJurisServer({ ...app, ...config });
    const { url } = await server.listen();
    try {
        return await visit(url, server);
    } finally {
        await server.close();
    }
}

const element = (html, tag) =>
    new RegExp(`<${tag}[ >].*?</${tag}>`, "s").exec(html)?.[0];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
```

```js
const server = await createJurisServer(app);
const { url } = await server.listen();
const answer = await fetch(`${url}/todos/1`);
answer.status; // → 200
element(await answer.text(), "main");
// → <main><h1 data-key="route-1">Milk</h1></main>
await server.close();
```

**`createJurisServer(config)`** answers a promise of `{ listen, handle, render, close, invalidate,
codeId, juris, router }`.

```js
const server = await createJurisServer(app);
typeof server.listen; // → "function"
server.router.resolve("/todos/2").name; // → "todo"
const page = await server.render("/todos/2");
element(String(page.body), "title"); // → <title>Eggs</title>
String(page.body).includes(server.codeId); // → true
await server.close();
```

- `invalidate(targets)` is for a change made outside a service call (a job, a webhook the app
  answers itself): it reaches the live queries and the bus as a service's `touches` do, with the
  same targets. Only with the dispatcher built here; an app that built its own calls that one's.

  ```js
  const server = await createJurisServer(app);
  // A nightly job archived the done todos: wake whatever reads them.
  await server.invalidate(["todos"]); // → undefined
  await server.close();
  ```

- It builds the server's `Juris` instance with the app's `juris` (`{ allowTags, allowSchemes,
  allowInnerHTML, components }`, the same object the browser's `hydrate` is given), `isServer`,
  `requirePreload` (a call a render makes must have been preloaded, never run in the middle of it),
  `exposeError` (`error.expose === true` unless told, deciding for a failed preload in a page as for
  a service's answer) and the kit's string renderer (`features: { ssr: SSRRenderer }`,
  `server/ssr-renderer.js`).

  ```js
  const server = await createJurisServer({
      ...app,
      juris: { allowTags: ["iframe"] },
  });
  server.juris.renderToString({ iframe: { src: "https://maps.example/shop" } });
  // → <iframe src="https://maps.example/shop"></iframe>
  server.juris.isServer; // → true
  server.juris.api.call("todos");
  // throws Error: Juris.call: todos:[] was not preloaded for this request
  await server.close();
  ```

  - `juris.components` are registered as the instance is built, before the router and `setup`, so
    `setup` and every route's code find them there.

    ```js
    function Badge(props) {
        return { span: { class: "badge", textContent: props.label } };
    }
    const seen = [];
    const server = await createJurisServer({
        ...app,
        juris: { components: [Badge] },
        setup(juris) {
            seen.push(juris.hasComponent("Badge"));
            app.setup(juris);
        },
    });
    seen; // → [true]
    server.juris.renderToString({ Badge: { label: "New" } });
    // → <span class="badge">New</span>
    await server.close();
    ```

    ```js
    const Home = () => ({ p: "Home" });
    await createJurisServer({ ...app, juris: { components: { Home } } });
    // throws Error: ComponentManager.registerComponent: "Home" is already
    ```

  ```js
  import { fail } from "juris/errors.js";

  const services = {
      ...app.services,
      todo: async (id) => {
          if (id === "1") fail("This todo is archived.");
          throw new Error("connection refused");
      },
  };
  const server = await createJurisServer({ ...app, services });
  const archived = String((await server.render("/todos/1")).body);
  archived.includes('{"$error":"This todo is archived."}'); // → true
  const down = String((await server.render("/todos/2")).body);
  down.includes('{"$error":"request failed"}'); // → true
  await server.close();
  ```

  ```js
  import SSRRenderer from "juris-kit/server/ssr-renderer.js";

  const server = await createJurisServer(app);
  server.juris.ssrRenderer instanceof SSRRenderer; // → true
  await server.close();
  ```

- It installs the router made from `routes` and `router` (the router's own options, above
  all `guard`, asked in `resolve` with `{ viewer }`, who the page's `viewer` hook says is asking;
  `context` is taken and unused here), awaits `setup(juris)` to register the app's components and
  plugins, and then loads every route's code (`router.loadAll()`), so no render meets a route whose
  components are not registered yet; a route whose code cannot be loaded is a server that cannot
  start.

  ```js
  const signedIn = (req) => (req.headers.cookie === "session=ada" ? "ada" : null);
  const config = {
      router: {
          guard: (to, ctx) => {
              if (to.meta.private && !ctx.viewer) return "/login";
          },
      },
      page: { viewer: signedIn },
  };
  await served(config, async (url) => {
      const guest = await fetch(`${url}/account`, { redirect: "manual" });
      guest.status; // → 302
      guest.headers.get("location"); // → "/login"
      const ada = await fetch(`${url}/account`, {
          headers: { cookie: "session=ada" },
      });
      ada.status; // → 200
  });
  ```

  ```js
  const about = {
      path: "/about",
      name: "about",
      component: "About",
      load: async () => ({ About: () => ({ h1: "About us" }) }),
      register: (page, juris) => juris.registerComponent("About", page.About),
  };
  const server = await createJurisServer({
      ...app,
      routes: [...app.routes, about],
  });
  server.juris.hasComponent("About"); // → true
  await server.close();
  ```

  ```js
  const reports = {
      path: "/reports",
      name: "reports",
      component: "Reports",
      load: () => import("./pages/reports.js"),
  };
  await createJurisServer({ ...app, routes: [...app.routes, reports] });
  // throws Error: Cannot find module
  ```

- `api` is the dispatcher's options (`serviceDispatcher(services, "/api", …)`, with the kernel's
  `exposeError` and `onError` unless given) or a handler the app built, `(req, res, url) → boolean`,
  whose `names` say what it answers to and whose `close()`, when it has one, the drain calls.

  ```js
  const call = (url, name) =>
      fetch(`${url}/api/${name}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify([1]),
      });
  await served({ api: { expose: ["todo"] } }, async (url) => {
      await (await call(url, "todo")).json(); // → { id: 1, title: "Milk" }
      (await call(url, "todos")).status; // → 404
  });
  ```

  ```js
  const closed = [];
  const api = Object.assign(
      async (req, res, url) => {
          if (url.pathname !== "/api/ping") return false;
          res.end("pong");
          return true;
      },
      { names: ["ping"], close: () => closed.push("api") },
  );
  await served({ api }, async (url) => {
      await (await fetch(`${url}/api/ping`)).text(); // → "pong"
      const page = await (await fetch(url)).text();
      /<script[^>]*id="services">.*?<\/script>/.exec(page)[0];
      // → <script type="application/json" id="services">["ping"]</script>
  });
  closed; // → ["api"]
  ```

- `handlers` are the app's own routes beside its pages (uploads, say): `[(req, res, url) →
  boolean]`, asked in turn after `/api/`, the first to answer `true` ending the search.

  ```js
  const asked = [];
  const audit = (req, res, url) => {
      asked.push(url.pathname);
      return false;
  };
  const upload = (req, res, url) => {
      if (url.pathname !== "/uploads") return false;
      res.writeHead(201, { location: "/uploads/1" });
      res.end();
      return true;
  };
  await served({ handlers: [audit, upload] }, async (url) => {
      (await fetch(`${url}/uploads`, { method: "POST", body: "…" })).status;
      // → 201
      await fetch(`${url}/api/todos`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "[]",
      });
  });
  asked; // → ["/uploads"]
  ```

- `modules` is `createModuleServer`'s options (`mounts`, `assets`, `rootFiles`, `static`, `minify`)
  plus `entry`, the browser entry's URL, which must be a file the module server serves (checked at
  construction).

  ```js
  await served({}, async (url) => {
      const boot = await fetch(`${url}/app/boot.js`);
      boot.headers.get("content-type"); // → "text/javascript; charset=utf-8"
  });
  ```

  ```js
  await createJurisServer({
      ...app,
      modules: { ...app.modules, entry: "/app/main.js" },
  });
  // throws TypeError: createJurisServer: modules.entry /app/main.js is not a file
  //   the module server serves
  ```

- `page` is `createPagePipeline`'s hooks (`origin`, `viewer`, `extra`, `before`, `personal`,
  `preload`, `state`, `notFound`, `title`, `head`, `headers`, `cacheParams`, `onRender`) and
  `serviceNames`:
  the names written into every page as `#services`, the dispatcher's unless given, `false` for none.

  ```js
  const servicesOf = async (page) => {
      const server = await createJurisServer({ ...app, page });
      const html = String((await server.render("/")).body);
      await server.close();
      return /id="services">(.*?)</.exec(html)?.[1];
  };
  await servicesOf({}); // → '["todos","todo"]'
  await servicesOf({ serviceNames: ["todos"] }); // → '["todos"]'
  await servicesOf({ serviceNames: false }); // → undefined
  ```

  ```js
  const server = await createJurisServer({
      ...app,
      page: { origin: "https://todos.example", title: { suffix: " · Todos" } },
  });
  const html = String((await server.render("/todos/1")).body);
  element(html, "title"); // → <title>Milk · Todos</title>
  html.includes('<link rel="canonical" href="https://todos.example/todos/1">');
  // → true
  await server.close();
  ```

  - `head` is also given `versioned(path)`, the module server's URL for a file it serves.

    ```js
    const server = await createJurisServer({
        ...app,
        page: {
            head: async ({ versioned }) => ({
                styles: [{ href: await versioned("/app/site.css") }],
            }),
        },
    });
    const html = String((await server.render("/")).body);
    /<link rel="stylesheet" href="\/app\/site\.css\?v=[\w-]+">/.test(html);
    // → true
    await server.close();
    ```

- `cache` is a page cache for guests' pages, accepted only beside a handler the app built: what
  evicts a kept page is the services' invalidations, which the app carries to the cache itself (its
  dispatcher's `live.onInvalidate`), and a dispatcher the kernel builds does not feed one.

  ```js
  import { createPageCache } from "juris-kit/server/page-cache.js";

  await createJurisServer({ ...app, cache: createPageCache() });
  // throws TypeError: createJurisServer: a page cache is kept up to date by the
  //   services' invalidations
  ```

  ```js
  import { createPageCache } from "juris-kit/server/page-cache.js";
  import {
      serviceDispatcher,
  } from "juris-kit/server/service-dispatcher.js";

  const cache = createPageCache();
  const services = {
      ...app.services,
      addTodo: async (title) => todos.push({ id: todos.length + 1, title }),
  };
  const api = serviceDispatcher(services, "/api", {
      live: {
          touches: { addTodo: ["todos"] },
          public: true,
          onInvalidate: (targets) => cache.invalidate(targets),
      },
  });
  const rendered = [];
  const page = { onRender: ({ key }) => rendered.push(key) };
  await served({ services, api, cache, page }, async (url) => {
      await fetch(url);
      await fetch(url);
      rendered; // → ["/"]
      await api.invoke("addTodo", ["Bread"]);
      element(await (await fetch(url)).text(), "ul");
      // → <ul data-key="route-0"><li>Milk</li><li>Eggs</li><li>Bread</li></ul>
      rendered; // → ["/", "/"]
  });
  ```

- `devReload` is development's reload (`server/dev-reload.js`, made by the app, whose entry alone
  can start the process that replaces this one): its stream is answered, its client goes into every
  page, and the drain ends it. It is refused outside development.

  ```js
  import { devReload } from "juris-kit/server/dev-reload.js";

  const reload = devReload({ root, onRestart: () => {} });
  await served({ dev: true, devReload: reload }, async (url) => {
      const stream = await fetch(`${url}/__reload`);
      stream.headers.get("content-type"); // → "text/event-stream"
      const html = await (await fetch(url)).text();
      html.includes(reload.script); // → true
  });
  ```

  ```js
  import { devReload } from "juris-kit/server/dev-reload.js";

  const reload = devReload({ root, onRestart: () => {} });
  await createJurisServer({ ...app, devReload: reload });
  // throws TypeError: createJurisServer: devReload is development's, and this
  //   server is not in development
  reload.close();
  ```

- `trustProxy` (`true` or `{ hops }`, off unless told) makes a dispatcher the kernel builds count
  its callers, for its per-caller ceilings, by the address the nearest proxy saw, unless the app
  gives its own `live.clientKey`; it is refused beside a handler the app built, which counts its
  own.

  ```js
  const api = {
      live: { queries: ["todos"], public: true, maxStreamsPerCaller: 1 },
  };
  const stream = (url, address) =>
      fetch(`${url}/api/events`, { headers: { "x-forwarded-for": address } });
  await served({ api, trustProxy: true }, async (url) => {
      (await stream(url, "203.0.113.7")).status; // → 200
      (await stream(url, "198.51.100.4")).status; // → 200
      (await stream(url, "203.0.113.7")).status; // → 429
  });
  await served({ api }, async (url) => {
      (await stream(url, "203.0.113.7")).status; // → 200
      (await stream(url, "198.51.100.4")).status; // → 429
  });
  ```

  ```js
  const api = Object.assign(async () => false, { names: [] });
  await createJurisServer({ ...app, api, trustProxy: { hops: 2 } });
  // throws TypeError: createJurisServer: trustProxy says how a dispatcher built
  //   here counts its callers
  ```

- A cluster worker is refused beside live queries (a handler the app built is taken to serve them)
  unless `allowWorkers` says otherwise, as `startProcess`'s `allow` would.

  ```js
  const worker = { isWorker: true };
  const api = { live: { queries: ["todos"], public: true } };
  await createJurisServer({ ...app, api, cluster: worker });
  // throws Error: createJurisServer: this is a cluster worker, and live queries
  //   do not survive workers on one port
  const server = await createJurisServer({
      ...app,
      api,
      cluster: worker,
      allowWorkers: true,
  });
  server.juris.isServer; // → true
  await server.close();
  ```

- `dev` is development: nothing is snapshotted or kept, every answer is `no-store`, and every page
  carries `#juris-dev` (`renderDocument`'s `jurisDev`), which turns the browser's devMode on, and with
  it the devtools feature (`hydrate`).

  ```js
  await served({ dev: true }, async (url) => {
      const page = await fetch(`${url}/todos/1`);
      page.headers.get("cache-control"); // → "no-store"
      /<script[^>]*id="juris-dev">.*?<\/script>/.exec(await page.text())[0];
      // → <script type="application/json" id="juris-dev">{}</script>
  });
  ```

  ```js
  const boot = join(root, "app", "boot.js");
  await served({ dev: true }, async (url) => {
      writeFileSync(boot, "export const start = () => 2;\n");
      await (await fetch(`${url}/app/boot.js`)).text();
      // → "export const start = () => 2;\n"
  });
  ```

  ```js
  const boot = join(root, "app", "boot.js");
  await served({ dev: false }, async (url) => {
      writeFileSync(boot, "export const start = () => 2;\n");
      await (await fetch(`${url}/app/boot.js`)).text();
      // → "export const start = () => {};"
      const page = await fetch(`${url}/todos/1`);
      page.headers.get("cache-control"); // → "public, max-age=0, must-revalidate"
  });
  ```

  - The server's own instance is never in devMode, and is never given the devtools feature: it
    renders every request, and nothing about it is one page's.

    ```js
    const server = await createJurisServer({ ...app, dev: true });
    server.juris.devMode; // → false
    server.juris.devtools; // → undefined
    await server.close();
    ```

- `root` (the app's directory, a path or a `file:` URL), `dev`, `build` (a string, or a function
  asked per request), `services`, `routes`, `setup` and `layout` are what they say;

  ```js
  import { pathToFileURL } from "node:url";

  let deploy = "v1";
  const config = { root: pathToFileURL(root), build: () => deploy };
  await served(config, async (url) => {
      await (await fetch(`${url}/version`)).json(); // → { build: "v1" }
      deploy = "v2";
      await (await fetch(`${url}/version`)).json(); // → { build: "v2" }
  });
  ```

  ```js
  const setup = (juris) => {
      app.setup(juris);
      juris.registerComponent("Shell", () => ({
          section: { className: "shell", children: [{ RouterView: {} }] },
      }));
  };
  const layout = { Shell: {} };
  const server = await createJurisServer({ ...app, setup, layout });
  element(String((await server.render("/todos/2")).body), "section");
  // → <section class="shell"><h1 data-key="route-1">Eggs</h1></section>
  await server.close();
  ```

  - `instance`, `instanceHeader`, `health` and `jobs` are `createLifecycle`'s; `closeTimeoutMs`,
    `onShutdown` and `onError` are the drain's, below; `cluster` replaces Node's cluster for a test.

    ```js
    const config = {
        instance: "web-1",
        instanceHeader: true,
        health: { details: () => ({ todos: todos.length }) },
    };
    await served(config, async (url) => {
        const health = await fetch(`${url}/healthz`);
        health.headers.get("x-instance"); // → "web-1"
        await health.json();
        // → { ok: true, instance: "web-1", build: "v1", todos: 2 }
    });
    ```

  - An option that is not one of these is refused,
    not ignored (a misspelt hook would leave a page unguarded without a word), and so is a key inside
    one that takes its own: `modules`, `page` and `trustProxy` (`hops`) here, `api` by the
    dispatcher, `health` and a job by `createLifecycle`, `router` by the router and `juris` by
    `sharedOptions`.

    ```js
    await createJurisServer({ ...app, onShutDown: [] });
    // throws TypeError: createJurisServer: onShutDown is not an option
    await createJurisServer({ ...app, page: { gaurd: () => "/login" } });
    // throws TypeError: createJurisServer: page.gaurd is not an option
    await createJurisServer({ ...app, trustProxy: { hop: 2 } });
    // throws TypeError: createJurisServer: trustProxy.hop is not an option (hops)
    ```

    ```js
    await createJurisServer({ ...app, api: { live: { strictQuerys: true } } });
    // throws TypeError: serviceDispatcher: live.strictQuerys is not an option
    await createJurisServer({ ...app, health: { timeoutMS: 500 } });
    // throws TypeError: createLifecycle: health.timeoutMS is not an option
    ```

    ```js
    await createJurisServer({ ...app, router: { gaurd: () => "/login" } });
    // throws TypeError: Router: "gaurd" is not an option
    await createJurisServer({ ...app, juris: { devMode: true } });
    // throws TypeError: createJurisServer: juris.devMode is not an option
    ```

  - A server that cannot be built closes the dispatcher it made, so a bus subscription does not
    outlive it.

    ```js
    const log = [];
    const bus = {
        publish: async () => {},
        subscribe: () => () => log.push("unsubscribed"),
    };
    const config = {
        ...app,
        api: { live: { queries: ["todos"], public: true, bus } },
        modules: { ...app.modules, entry: "/app/main.js" },
    };
    await createJurisServer(config);
    // throws TypeError: createJurisServer: modules.entry /app/main.js
    log; // → ["unsubscribed"]
    ```

Every request is answered in one order, which is not configurable: the lifecycle's (`x-instance`,
the 400, `/version`, `/healthz`), in development `/__reload`, `/api/` (the dispatcher or the app's
handler), the app's `handlers`, the modules, root files and static files, `/favicon.ico` (204
unless a root file answers it) and `/.well-known/` (404), both without rendering a page, then the
page pipeline; anything that throws is the lifecycle's fixed 500.

```js
const everything = (req, res) => {
    res.end("the app's handler");
    return true;
};
await served({ handlers: [everything] }, async (url) => {
    await (await fetch(`${url}/version`)).json(); // → { build: "v1" }
    const todos = await fetch(`${url}/api/todos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[]",
    });
    (await todos.json()).length; // → 2
    await (await fetch(`${url}/app/boot.js`)).text(); // → "the app's handler"
    await (await fetch(`${url}/todos/1`)).text(); // → "the app's handler"
});
```

```js
await served({}, async (url) => {
    (await fetch(`${url}/favicon.ico`)).status; // → 204
    (await fetch(`${url}/.well-known/security.txt`)).status; // → 404
});
```

```js
const failures = [];
const broken = () => {
    throw new Error("ENOENT: /srv/uploads/tmp");
};
const onError = (error, where) => failures.push(`${where}: ${error.message}`);
await served({ handlers: [broken], onError }, async (url) => {
    const answer = await fetch(`${url}/uploads`);
    answer.status; // → 500
    await answer.text();
    // → "Something went wrong on our side. Try again in a moment."
});
failures; // → ["request: ENOENT: /srv/uploads/tmp"]
```

What the kit serves itself takes GET and HEAD alone: the modules, root files and static files,
`/favicon.ico`, `/.well-known/` and the pages, as the lifecycle's `/version` and `/healthz` do. That
is decided once, after the app's `handlers` and before the modules, by `refuseMethod`
(`server/http.js`): an OPTIONS is 204 with `Allow: GET, HEAD`, and any other method 405 with the
same `Allow`, as RFC 9110 has them (9.3.7, 15.5.6), with no page rendered and no file read.

```js
const pages = [];
const before = [(ctx) => void pages.push(ctx.url.pathname)];
await served({ page: { before } }, async (url) => {
    const deleted = await fetch(`${url}/todos/1`, { method: "DELETE" });
    deleted.status; // → 405
    deleted.headers.get("allow"); // → "GET, HEAD"
    (await fetch(`${url}/todos/1`, { method: "HEAD" })).status; // → 200
});
pages; // → ["/todos/1"]
```

```js
await served({}, async (url) => {
    const options = await fetch(`${url}/app/boot.js`, { method: "OPTIONS" });
    options.status; // → 204
    options.headers.get("allow"); // → "GET, HEAD"
    const posted = await fetch(`${url}/favicon.ico`, { method: "POST" });
    posted.status; // → 405
});
```

- What takes another method is the app's: a service, POST under `/api/` (405 with `Allow: POST`
  otherwise), and its `handlers`, asked before, whatever the method. A form with no JavaScript
  posts to a service (the dispatcher's `forms`), never to a page.

  ```js
  const signOut = (req, res, url) => {
      if (url.pathname !== "/logout") return false;
      res.writeHead(303, { location: "/" });
      res.end();
      return true;
  };
  await served({ handlers: [signOut] }, async (url) => {
      const out = await fetch(`${url}/logout`, {
          method: "POST",
          redirect: "manual",
      });
      out.status; // → 303
      const listed = await fetch(`${url}/api/todos`);
      listed.status; // → 405
      listed.headers.get("allow"); // → "POST"
  });
  ```

- A 304 is the answer to a GET or a HEAD whose If-None-Match names the page's ETag, and a page
  that is not there is a 404 whatever the browser holds (`send`, `server/http.js`).

  ```js
  await served({}, async (url) => {
      const missing = await fetch(`${url}/nowhere`);
      const held = { "if-none-match": missing.headers.get("etag") };
      (await fetch(`${url}/nowhere`, { headers: held })).status; // → 404
      const page = await fetch(`${url}/todos/1`);
      const etag = page.headers.get("etag");
      const again = { "if-none-match": etag };
      (await fetch(`${url}/todos/1`, { headers: again })).status; // → 304
  });
  ```

`listen({ port = 0, host = "127.0.0.1" })` serves (once; the loopback address unless told, since a
server open to the whole network is something an app asks for) and starts the jobs, answering
`{ port, host, url }`.

```js
const server = await createJurisServer(app);
const { port, host, url } = await server.listen();
host; // → "127.0.0.1"
url === `http://127.0.0.1:${port}`; // → true
await server.listen();
// throws Error: createJurisServer: already listening
await server.close();
```

```js
const ran = [];
const purge = () => ran.push("purge");
const jobs = [{ name: "purge", every: 60_000, atStart: true, run: purge }];
const server = await createJurisServer({ ...app, jobs });
ran; // → []
await server.listen();
ran; // → ["purge"]
await server.close();
```

`close()` drains, and answers the same promise however often it is called:

```js
const server = await createJurisServer(app);
await server.listen();
server.close() === server.close(); // → true
await server.close();
```

- `/healthz` answers 503 to a request that still reaches the instance;

  ```js
  const server = await createJurisServer(app);
  const https = http.createServer(server.handle);
  await new Promise((resolve) => https.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${https.address().port}`;
  (await fetch(`${url}/healthz`)).status; // → 200
  const closing = server.close();
  const health = await fetch(`${url}/healthz`);
  health.status; // → 503
  await health.json(); // → { ok: false, error: "stopping" }
  await closing;
  https.closeAllConnections();
  https.close();
  ```

- the live event streams and development's reload streams are ended first (each is a request that
  never ends by itself, and would hold the rest);

  ```js
  const api = { live: { queries: ["todos"], public: true } };
  const server = await createJurisServer({ ...app, api });
  const { url } = await server.listen();
  const stream = await fetch(`${url}/api/events`);
  const closing = server.close();
  const text = await stream.text();
  text.startsWith("retry: 2000"); // → true
  await closing;
  ```

- the idle connections are closed and the requests in flight let finish for at most
  `closeTimeoutMs` (8000 unless told; a whole number of milliseconds from 0, which cuts them at once,
  to 2^31 − 1, anything else refused when the server is made), after which what is still open is
  cut;

  ```js
  let arrived;
  const exporting = new Promise((resolve) => (arrived = resolve));
  const slow = async (req, res, url) => {
      if (url.pathname !== "/export") return false;
      arrived();
      await sleep(50);
      res.end("todos.csv");
      return true;
  };
  const server = await createJurisServer({ ...app, handlers: [slow] });
  const { url } = await server.listen();
  const download = fetch(`${url}/export`);
  await exporting;
  await server.close();
  await (await download).text(); // → "todos.csv"
  ```

  ```js
  let arrived;
  const exporting = new Promise((resolve) => (arrived = resolve));
  const never = (req, res, url) => {
      arrived();
      return url.pathname === "/export";
  };
  const server = await createJurisServer({
      ...app,
      handlers: [never],
      closeTimeoutMs: 20,
  });
  const { url } = await server.listen();
  const download = fetch(`${url}/export`);
  await exporting;
  await server.close();
  await download;
  // throws TypeError: fetch failed
  ```

  ```js
  await createJurisServer({ ...app, closeTimeoutMs: 2 ** 31 });
  // throws TypeError: createJurisServer: closeTimeoutMs is a whole number of
  //   milliseconds, 0 (cut at once) to 2147483647
  await createJurisServer({ ...app, closeTimeoutMs: 1.5 });
  // throws TypeError: createJurisServer: closeTimeoutMs is a whole number
  ```

- then the jobs stop, a run in flight finishing first, and the stale pages' replacements under
  way finish (none begins from then on: a replacement renders with no request, so the server's close
  did not wait for it, and it could run after `onShutdown` closed the pool);

  ```js
  const log = [];
  const backup = async () => {
      await sleep(30);
      log.push("backup done");
  };
  const server = await createJurisServer({
      ...app,
      jobs: [{ name: "backup", every: 60_000, atStart: true, run: backup }],
      onShutdown: [() => log.push("pool closed")],
  });
  await server.listen();
  await server.close();
  log; // → ["backup done", "pool closed"]
  ```

- and last the app's
  `onShutdown` hooks run in order, each awaited (a
  change bus, a database pool), a failing one reported as `onError(error, "shutdown")` without
  stopping the next.

  ```js
  const log = [];
  const server = await createJurisServer({
      ...app,
      onShutdown: [
          async () => {
              throw new Error("bus already closed");
          },
          async () => log.push("pool closed"),
      ],
      onError: (error, where) => log.push(`${where}: ${error.message}`),
  });
  await server.close();
  log; // → ["shutdown: bus already closed", "pool closed"]
  ```

The entry says when to close (on a signal: only it touches the process) and ends the process once
`close()` has answered.

```js excerpt
import todoApp from "./app.js";

const server = await createJurisServer(todoApp);
await server.listen({ port: Number(process.env.PORT ?? 3000) });
for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, async () => {
        await server.close();
        process.exit(0);
    });
}
```


**`createPagePipeline(options)`** returns `{ render(url, viewer), handle(req, res, url), close() }`.
Its `juris` is a server instance with the router installed and the kit's string renderer given as
`features.ssr`, as `createJurisServer` builds its own.

```js
import Juris from "juris/juris.js";
import { createRouter } from "juris/router.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";

const juris = new Juris({
    services: app.services,
    isServer: true,
    requirePreload: true,
    features: { ssr: SSRRenderer },
});
const router = createRouter({ routes: app.routes });
juris.use(router);
app.setup(juris);
const pipeline = createPagePipeline({ juris, router, entry: "/app/boot.js" });
const page = await pipeline.render("/todos/1", null);
page.status; // → 200
element(String(page.body), "title"); // → <title>Milk</title>
```

```js
createPagePipeline({ entry: "/app/boot.js" });
// throws TypeError: createPagePipeline: juris, a server instance (isServer:
//   true), is required
```

The pipeline examples below build that instance with `todoSite({ services, routes, guard })`, which
answers `{ juris, router, entry }`, serve a pipeline with `withServer(listener, visit)`, and read a
page's state with `stateOf(html)`:

```js setup
import Juris from "juris/juris.js";
import { createRouter } from "juris/router.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";
import { createPageCache } from "juris-kit/server/page-cache.js";

function todoSite({ services = app.services, ...routerOptions } = {}) {
    const juris = new Juris({
        services,
        isServer: true,
        requirePreload: true,
        features: { ssr: SSRRenderer },
    });
    const router = createRouter({ routes: app.routes, ...routerOptions });
    juris.use(router);
    app.setup(juris);
    return { juris, router, entry: "/app/boot.js" };
}

async function withServer(listener, visit) {
    const host = http.createServer(listener);
    await new Promise((resolve) => host.listen(0, "127.0.0.1", resolve));
    try {
        return await visit(`http://127.0.0.1:${host.address().port}`);
    } finally {
        host.closeAllConnections();
        await new Promise((resolve) => host.close(resolve));
    }
}

const stateOf = (html) =>
    JSON.parse(/<script[^>]*id="state">(.*?)<\/script>/s.exec(html)[1]);
```

`close()` begins no more stale pages' replacements (one scheduled and not yet begun hands its key
back to the cache) and resolves once those under way have finished.

```js
const services = {
    ...app.services,
    todos: async () => {
        await sleep(100);
        return todos;
    },
};
const rendered = [];
const pipeline = createPagePipeline({
    ...todoSite({ services }),
    cache: createPageCache({ ttlMs: 10 }),
    onRender: ({ key }) => rendered.push(key),
});
await withServer((req, res) => pipeline.handle(req, res), async (url) => {
    await fetch(url);
    await sleep(20);
    (await fetch(url)).status; // → 200
    rendered; // → ["/"]
    await pipeline.close();
    rendered; // → ["/", "/"]
});
```

`handle(req, res, url)` answers a page request in an order that is fixed, because it is what keeps a
page from reaching someone it was not for:

1. the path's one spelling (`canonicalPath`; any other is a 301 to it, before anything reads the
   path);

   ```js
   const pipeline = createPagePipeline(todoSite());
   await withServer((req, res) => pipeline.handle(req, res), async (url) => {
       const answer = await fetch(`${url}//todos/1/`, { redirect: "manual" });
       answer.status; // → 301
       answer.headers.get("location"); // → "/todos/1"
   });
   ```

2. who is asking (`viewer(req, url)`, null for a guest);

   ```js
   const pipeline = createPagePipeline({
       ...todoSite(),
       viewer: (req) => (req.headers.cookie === "session=ada" ? "ada" : null),
       state: ({ viewer }) => ({ user: viewer }),
   });
   await withServer((req, res) => pipeline.handle(req, res), async (url) => {
       const guest = await (await fetch(url)).text();
       stateOf(guest).user; // → null
       const ada = await fetch(url, { headers: { cookie: "session=ada" } });
       stateOf(await ada.text()).user; // → "ada"
   });
   ```

3. the route as the router's `resolve(url, await extra(viewer), { viewer })` names it, whose
   `redirect` (the router's `guard`, or the route table's own) answers 302 before the cache is
   asked, so a copy kept for guests is never served past a guard;

   ```js
   const guard = (to, ctx) => {
       if (to.meta.private && !ctx.viewer) return "/login";
   };
   const cache = createPageCache();
   const pipeline = createPagePipeline({ ...todoSite({ guard }), cache });
   await withServer((req, res) => pipeline.handle(req, res), async (url) => {
       const answer = await fetch(`${url}/account`, { redirect: "manual" });
       answer.status; // → 302
       answer.headers.get("location"); // → "/login"
   });
   cache.stats().misses; // → 0
   ```

   ```js
   const mine = {
       path: "/mine",
       name: "mine",
       component: "Account",
       preload: ({ owner }) => [["todos", owner]],
   };
   const pipeline = createPagePipeline({
       ...todoSite({ routes: [mine] }),
       extra: async (viewer) => ({ owner: viewer }),
   });
   const page = await pipeline.render("/mine", "ada");
   Object.keys(stateOf(String(page.body)).$ssr.calls); // → ['todos:["ada"]']
   ```

4. the `before` hooks in order (the first to answer `{ location, status }` redirects, 302 unless
   told);

   ```js
   const moved = ({ url }) =>
       url.pathname === "/list" ? { location: "/", status: 308 } : null;
   const closed = ({ url }) =>
       url.pathname.startsWith("/todos/") ? { location: "/" } : null;
   const pipeline = createPagePipeline({ ...todoSite(), before: [moved, closed] });
   await withServer((req, res) => pipeline.handle(req, res), async (url) => {
       const list = await fetch(`${url}/list`, { redirect: "manual" });
       list.status; // → 308
       const todo = await fetch(`${url}/todos/1`, { redirect: "manual" });
       todo.status; // → 302
       todo.headers.get("location"); // → "/"
   });
   ```

5. the page cache, for guests only (`cache`, keyed by `pageCacheKey` on `cacheParams`; a stale hit
   is sent while one render replaces it), unless the app's `personal(ctx)` says a guest's request
   carries something theirs alone, whose page is rendered as asked, never kept, never served from
   the guests' copy and sent `private`;

   ```js
   const decided = [];
   const pipeline = createPagePipeline({
       ...todoSite(),
       cache: createPageCache(),
       personal: ({ url }) => url.searchParams.has("refused"),
       onRender: ({ decision }) => decided.push(decision.reason),
   });
   await withServer((req, res) => pipeline.handle(req, res), async (url) => {
       await fetch(url);
       await fetch(url);
       decided; // → ["dependent"]
       const own = await fetch(`${url}/?refused=title`);
       own.headers.get("cache-control"); // → "private, no-cache"
       decided; // → ["dependent", "personal"]
       await fetch(url);
       decided; // → ["dependent", "personal"]
   });
   ```

6. the render, which the cache keeps when `put` allows: a page the cache may keep is rendered from
   its cache key, not the address as asked, and so is a stale page's replacement (a page rendered
   from the whole address would carry its first visitor's other parameters in its state to everyone
   it is served to; a parameter a page reads that is not in `cacheParams` never reaches a guest's
   page while there is a cache). A viewer's page, like a `personal` one, is never put to the cache
   at all (`onRender` is told `{ cache: false, reason: "personal" }`): a refused put drops what the
   key holds, and every signed-in page view evicted the guests' copy of that page;

   ```js
   const pipeline = createPagePipeline({
       ...todoSite(),
       cache: createPageCache(),
       cacheParams: ["page"],
   });
   await withServer((req, res) => pipeline.handle(req, res), async (url) => {
       const page = await fetch(`${url}/?page=2&ref=newsletter`);
       stateOf(await page.text()).$route.query; // → { page: "2" }
   });
   ```

   ```js
   const decisions = [];
   const pipeline = createPagePipeline({
       ...todoSite(),
       cache: createPageCache(),
       viewer: (req) => (req.headers.cookie === "session=ada" ? "ada" : null),
       onRender: ({ decision }) => decisions.push(decision),
   });
   await withServer((req, res) => pipeline.handle(req, res), async (url) => {
       await fetch(url, { headers: { cookie: "session=ada" } });
   });
   decisions; // → [{ cache: false, reason: "personal" }]
   ```

7. the answer through `send`: `public` for a guest, `private` for a viewer, `no-store` with `dev`
   (with `dev`, every page carries `#juris-dev`: "The page contract").

   ```js
   const viewer = (req) => (req.headers.cookie === "session=ada" ? "ada" : null);
   const policy = async (options, headers) => {
       const pipeline = createPagePipeline({ ...todoSite(), viewer, ...options });
       return withServer((req, res) => pipeline.handle(req, res), async (url) => {
           return (await fetch(url, { headers })).headers.get("cache-control");
       });
   };
   await policy({}); // → "public, max-age=0, must-revalidate"
   await policy({}, { cookie: "session=ada" }); // → "private, no-cache"
   await policy({ dev: true }); // → "no-store"
   ```

`render(url, viewer)` is the render alone: the route's preload (`router.resolve(url, await
extra(viewer), { viewer })`, which asks the guard again, so no render, a stale page's replacement
included, is drawn past it; a location it answers is the render's `{ redirect }`) with the app's
`preload(ctx)` in front, the router's state with `state(ctx)` beside it, one `renderRequest`
(`layout`, `{ App: {} }` unless told), then the status, the title and the document.

```js
const guard = (to, ctx) => {
    if (to.meta.private && !ctx.viewer) return "/login";
};
const pipeline = createPagePipeline(todoSite({ guard }));
await pipeline.render("/account", null); // → { redirect: "/login" }
(await pipeline.render("/account", "ada")).status; // → 200
```

```js
const pipeline = createPagePipeline({
    ...todoSite(),
    preload: () => [["todos"]],
    state: ({ viewer }) => ({ user: viewer }),
});
const page = await pipeline.render("/todos/2", "ada");
const state = stateOf(String(page.body));
Object.keys(state.$ssr.calls); // → ["todos:[]", 'todo:["2"]']
state.user; // → "ada"
```

```js
const pipeline = createPagePipeline({
    ...todoSite(),
    layout: { Todo: {} },
});
const page = await pipeline.render("/todos/2", null);
element(String(page.body), "div"); // → <div id="app"><h1>Eggs</h1></div>
```

- A route `resolve` calls `notFound` (the catch-all, or no route at all) is a 404, and so is a page
  whose own call (the route's first preload) `notFound(own, ctx)` says is about nothing, `own` being
  that call's answer (`renderRequest`'s `result`), `undefined` when it failed.

  ```js
  const missing = { path: "*", name: "missing", component: "Account" };
  const pipeline = createPagePipeline({
      ...todoSite({ routes: [...app.routes, missing] }),
      notFound: (own) => own === null,
  });
  (await pipeline.render("/nowhere", null)).status; // → 404
  (await pipeline.render("/todos/99", null)).status; // → 404
  (await pipeline.render("/todos/1", null)).status; // → 200
  ```

  - A 404 is never a 304: the conditional headers are ignored for an answer that would not be a
    2xx (RFC 9110, 13.2.1), so a browser that holds the 404's ETag is sent the 404 again.

    ```js
    const pipeline = createPagePipeline(todoSite());
    await withServer((req, res) => pipeline.handle(req, res), async (url) => {
        const missing = await fetch(`${url}/nowhere`);
        const held = { "if-none-match": missing.headers.get("etag") };
        const again = await fetch(`${url}/nowhere`, { headers: held });
        again.status; // → 404
        (await again.text()) === (await missing.text()); // → true
    });
    ```

  - A 404 is never kept,
    and neither is a page any of whose preloaded calls failed: it goes out as a 200, but what it shows
    is that request's failure.

    ```js
    const services = {
        ...app.services,
        todo: async () => {
            throw new Error("connection refused");
        },
    };
    const decided = [];
    const pipeline = createPagePipeline({
        ...todoSite({ services }),
        cache: createPageCache(),
        onRender: ({ decision }) => decided.push(decision.reason),
    });
    await withServer((req, res) => pipeline.handle(req, res), async (url) => {
        (await fetch(`${url}/todos/1`)).status; // → 200
        (await fetch(`${url}/nowhere`)).status; // → 404
    });
    decided; // → ["failed:todo", "not-found"]
    ```

  - The route's own call counts as read by the page whatever its body
    calls: the kernel reads it for the status and the title, and its answer is in the page's state, so
    it is in the trace the cache decides on (its key in `calls`, its service in `services`, and the
    page is never `static`). A page titled from a service nothing in its body called was kept forever,
    or on no service, and a change to that service never evicted it.

    ```js
    const titled = {
        path: "/todos/:id/print",
        name: "print",
        component: "Account",
        head: { titleFrom: (todo) => todo.title },
        preload: ({ params }) => [["todo", params.id]],
    };
    const pipeline = createPagePipeline(todoSite({ routes: [titled] }));
    const { trace } = await pipeline.render("/todos/1/print", null);
    trace.calls; // → ['todo:["1"]']
    trace.services; // → ["todo"]
    trace.static; // → false
    ```

- The title is the router's `titleOf` on the route's `head` and that call's result (a browser given
  the same options, `hydrate`'s `title`, names the page the same): `head.titleFrom(own)`, cut to
  `title.max` characters and followed by `title.suffix`; otherwise `head.title`, otherwise
  `title.fallback`; `title.decorate` is applied to whichever it is, and a failed call or a
  `titleFrom` that throws never names a page.

  ```js
  const services = {
      ...app.services,
      todo: async () => ({ id: 3, title: "Oat milk, two litres" }),
  };
  const pipeline = createPagePipeline({
      ...todoSite({ services }),
      title: { max: 8, suffix: " · Todos", fallback: "Todos" },
  });
  const titleOf = async (path) =>
      element(String((await pipeline.render(path, null)).body), "title");
  await titleOf("/todos/3"); // → <title>Oat milk · Todos</title>
  await titleOf("/"); // → <title>Todos</title>
  await titleOf("/account"); // → <title>Todos</title>
  ```

  ```js
  const services = {
      ...app.services,
      todo: async () => {
          throw new Error("connection refused");
      },
  };
  const pipeline = createPagePipeline({
      ...todoSite({ services }),
      title: { fallback: "Todos", decorate: (title) => `${title} (offline)` },
  });
  const page = await pipeline.render("/todos/1", null);
  element(String(page.body), "title"); // → <title>Todos (offline)</title>
  ```

  - It is worked out inside the render
    (`renderRequest`'s `after`), so a `titleFrom` that reads what the page's own render set (a language
    picked per person, held in a module of the app) reads this page's, never another request's that
    began while this one waited on `notFound`.

    ```js
    let language = null;
    const services = {
        ...app.services,
        todo: async (id) => ({ id, title: { en: "Milk", fr: "Lait" } }),
    };
    const todo = {
        ...app.routes[1],
        head: { titleFrom: (todo) => todo.title[language] },
    };
    const site = todoSite({ services, routes: [todo] });
    site.juris.registerComponent("Language", (props, api) => {
        language = api.getState("language");
        return { p: language };
    });
    const pipeline = createPagePipeline({
        ...site,
        layout: { Language: {} },
        state: ({ viewer }) => ({ language: viewer === "ada" ? "en" : "fr" }),
        notFound: async (own, ctx) => {
            if (ctx.viewer === "ada") await sleep(20);
            return false;
        },
    });
    const [ada, guest] = await Promise.all([
        pipeline.render("/todos/1", "ada"),
        sleep(5).then(() => pipeline.render("/todos/1", null)),
    ]);
    element(String(ada.body), "title"); // → <title>Milk</title>
    element(String(guest.body), "title"); // → <title>Lait</title>
    ```

  - The description is the route's `head.description`
    unless `head(ctx)` gives one.

    ```js
    const about = {
        path: "/about",
        name: "about",
        component: "Account",
        head: { title: "About", description: "A todo list for two." },
    };
    const describe = async (head) => {
        const pipeline = createPagePipeline({
            ...todoSite({ routes: [about] }),
            head,
        });
        const html = String((await pipeline.render("/about", null)).body);
        return /<meta name="description"[^>]*>/.exec(html)[0];
    };
    await describe(undefined);
    // → <meta name="description" content="A todo list for two.">
    await describe(({ title }) => ({ description: `${title}: who we are` }));
    // → <meta name="description" content="About: who we are">
    ```

- `head(ctx)` gives `renderDocument` the rest of the head, and the kernel adds the title, the
  canonical (`origin` and the page's path, encoded, so a raw request path cannot break the
  attribute; none without `origin`), the `entry` (a URL, or a function asked per page) and
  `devReload`.

  ```js
  const pipeline = createPagePipeline({
      ...todoSite(),
      head: () => ({ meta: [{ name: "theme-color", content: "#0a7" }] }),
  });
  const html = String((await pipeline.render("/todos/1", null)).body);
  element(html, "head").split("\n").slice(3, -1);
  // → ["<title>Milk</title>", '<meta name="theme-color" content="#0a7">']
  ```

  ```js
  const pipeline = createPagePipeline({
      ...todoSite(),
      origin: "https://todos.example",
  });
  const html = String((await pipeline.render('/todos/1"><b>', null)).body);
  /<link rel="canonical"[^>]*>/.exec(html)[0];
  // → <link rel="canonical" href="https://todos.example/todos/1%22%3E%3Cb%3E">
  ```

  ```js
  let deploy = 1;
  const pipeline = createPagePipeline({
      ...todoSite(),
      entry: () => `/app/boot.js?v=${deploy}`,
      devReload: "new EventSource('/__reload')",
  });
  const html = String((await pipeline.render("/", null)).body);
  html.includes('import("/app/boot.js?v=1")'); // → true
  html.includes("<script>new EventSource('/__reload')</script>"); // → true
  ```

- `headers({ scriptHashes, url, route, viewer })` gives the page's own response headers (a
  Content-Security-Policy, `X-Frame-Options`), as `{ name: value }`: asked once per rendered page,
  with the hashes of that page's inline scripts (`inlineScriptHashes`), kept with the page in the
  cache and sent with it, a 304 included.

  ```js
  const csp = (hashes) => `script-src 'self' ${hashes.join(" ")}`;
  const pipeline = createPagePipeline({
      ...todoSite(),
      cache: createPageCache(),
      headers: ({ scriptHashes }) => ({
          "content-security-policy": csp(scriptHashes),
          "x-frame-options": "DENY",
      }),
  });
  await withServer((req, res) => pipeline.handle(req, res), async (url) => {
      const page = await fetch(url);
      const policy = page.headers.get("content-security-policy");
      policy.startsWith("script-src 'self' 'sha256-");
      // → true
      const etag = page.headers.get("etag");
      const again = await fetch(url, { headers: { "if-none-match": etag } });
      again.status; // → 304
      again.headers.get("x-frame-options"); // → "DENY"
  });
  ```

  - It may not name what `send` writes itself (`content-type`,
    `etag`, `cache-control`, `vary`, `content-encoding`, `content-length`).

    ```js
    const pipeline = createPagePipeline({
        ...todoSite(),
        headers: () => ({ "Cache-Control": "max-age=3600" }),
    });
    await pipeline.render("/", null);
    // throws TypeError: createPagePipeline: headers(ctx) may not give
    //   cache-control, which the response writes itself
    ```

- Every hook may return a promise (`extra` included), and every one runs before `renderRequest` or
  after it returns, never between its `clearState` and its `serializeState`, which is what keeps two
  requests on the one instance apart.

  ```js
  const pipeline = createPagePipeline({
      ...todoSite(),
      state: async ({ viewer }) => {
          await sleep(viewer === "ada" ? 20 : 0);
          return { user: viewer };
      },
  });
  const [ada, grace] = await Promise.all([
      pipeline.render("/", "ada"),
      pipeline.render("/", "grace"),
  ]);
  stateOf(String(ada.body)).user; // → "ada"
  stateOf(String(grace.body)).user; // → "grace"
  ```

  - `ctx` is `{ req, url, route, viewer }` for `before` and
    `personal`, and `{ url, route, viewer }` for the render's hooks (a stale page is replaced with no
    request), with `route` the route the address lands on as `resolve` names it, `{ name, params,
    meta, head, matched, notFound }`, which the pipeline takes as it is and never matches the path
    again.

    ```js
    const seen = {};
    const pipeline = createPagePipeline({
        ...todoSite(),
        before: [(ctx) => void (seen.before = Object.keys(ctx))],
        personal: (ctx) => void (seen.personal = Object.keys(ctx)),
        state: (ctx) => void (seen.state = Object.keys(ctx)),
        notFound: (own, ctx) => void (seen.route = ctx.route),
    });
    await withServer((req, res) => pipeline.handle(req, res), async (url) => {
        await fetch(`${url}/todos/1`);
    });
    seen.before; // → ["req", "url", "route", "viewer"]
    seen.personal; // → ["req", "url", "route", "viewer"]
    seen.state; // → ["url", "route", "viewer"]
    const { head, ...route } = seen.route;
    route;
    // → { name: "todo", params: { id: "1" }, meta: {}, matched: [1],
    //     notFound: false }
    ```

- The guard is the router's: a pipeline refuses a `guard` of its own, which it would never ask, and
  any option it does not know.

  ```js
  createPagePipeline({ ...todoSite(), guard: () => "/login" });
  // throws TypeError: createPagePipeline: guard is the router's
  createPagePipeline({ ...todoSite(), titel: { fallback: "Todos" } });
  // throws TypeError: createPagePipeline: "titel" is not an option
  ```

  - `onRender({ key, decision, trace })` follows each render `handle`
    asked the cache about, and `onError(error, where)` gets a failure nobody is waiting for.

    ```js
    const told = [];
    const pipeline = createPagePipeline({
        ...todoSite(),
        cache: createPageCache(),
        cacheParams: ["page"],
        onRender: ({ key, decision, trace }) =>
            told.push([key, decision.reason, trace.services]),
    });
    await withServer((req, res) => pipeline.handle(req, res), async (url) => {
        await fetch(`${url}/?page=2&ref=newsletter`);
    });
    told; // → [["/?page=2", "dependent", ["todos"]]]
    ```

    ```js
    let renders = 0;
    const flags = () => {
        renders += 1;
        if (renders > 1) throw new Error("the flags store is down");
        return { flags: {} };
    };
    const errors = [];
    const pipeline = createPagePipeline({
        ...todoSite(),
        cache: createPageCache({ ttlMs: 10 }),
        state: flags,
        onError: (error, where) => errors.push(`${where}: ${error.message}`),
    });
    await withServer((req, res) => pipeline.handle(req, res), async (url) => {
        await fetch(url);
        await sleep(20);
        await fetch(url);
        await pipeline.close();
    });
    errors; // → ["regenerate: the flags store is down"]
    ```

**`createLifecycle(options)`** returns `{ serve(handler), start(), drain(), stop(), draining,
skipped }`:
what a server answers before any of the app's code, the 500, and the work it does on a timer.

```js
const life = createLifecycle({ build: "v1" });
const listener = life.serve((req, res, url) => {
    res.end(`todos at ${url.pathname}`);
});
await withServer(listener, async (url) => {
    await (await fetch(`${url}/todos`)).text(); // → "todos at /todos"
    await (await fetch(`${url}/version`)).json(); // → { build: "v1" }
});
```

- `serve(handler)` is the request listener, and for every request, in this order:

  - `x-instance`
    naming the `instance` when `instanceHeader` says so (off unless told, since it publishes a name);

    ```js
    const named = async (options) => {
        const life = createLifecycle({
            build: "v1",
            instance: "web-1",
            ...options,
        });
        return withServer(life.serve((req, res) => res.end()), async (url) => {
            return (await fetch(url)).headers.get("x-instance");
        });
    };
    await named({}); // → null
    await named({ instanceHeader: true }); // → "web-1"
    ```

  - the request target read as a URL, and a 400 "Bad request." for one no URL can be made of (`//[x`,
    which Node's parser takes and `new URL` refuses; a throw there once ended the whole process);

    ```js
    const life = createLifecycle({ build: "v1" });
    await withServer(life.serve((req, res) => res.end("ok")), async (url) => {
        const answer = await new Promise((resolve) => {
            http.get(url, { path: "//[x" }, resolve);
        });
        answer.statusCode; // → 400
        answer.resume();
    });
    ```

  - `/version`, `{ build }`, `no-store` (`build` a string or a function asked per request, since
    development moves it);

    ```js
    let build = "2026-11-06.1";
    const life = createLifecycle({ build: () => build });
    await withServer(life.serve((req, res) => res.end()), async (url) => {
        const version = await fetch(`${url}/version`);
        version.headers.get("cache-control"); // → "no-store"
        await version.json(); // → { build: "2026-11-06.1" }
        build = "2026-11-06.2";
        await (await fetch(`${url}/version`)).json(); // → { build: "2026-11-06.2" }
    });
    ```

  - `/healthz`, which answers 503 `{ ok: false, error: "stopping" }` with
    `connection: close` once `drain()` has been called, and otherwise runs `health.check()` within
    `health.timeoutMs` (2000 unless told; a whole number of milliseconds, 1 to 2^31 − 1, refused
    otherwise when the lifecycle is made, since the bound is what keeps a database that never answers
    from holding the balancer's question open) and answers 200 `{ ok: true, instance, build,
    ...health.details() }`, or 503 `{ ok: false, error: "unavailable" }` with the reason sent to
    `onError(error, "healthz")`, never to the body, which is public;

    ```js
    const life = createLifecycle({
        build: "v1",
        instance: "web-1",
        health: {
            check: async () => "the pool answers",
            details: () => ({ openTodos: 2 }),
        },
    });
    await withServer(life.serve((req, res) => res.end()), async (url) => {
        await (await fetch(`${url}/healthz`)).json();
        // → { ok: true, instance: "web-1", build: "v1", openTodos: 2 }
    });
    ```

    ```js
    const errors = [];
    const life = createLifecycle({
        build: "v1",
        health: {
            check: () => new Promise(() => {}),
            timeoutMs: 20,
        },
        onError: (error, where) => errors.push(`${where}: ${error.message}`),
    });
    await withServer(life.serve((req, res) => res.end()), async (url) => {
        const health = await fetch(`${url}/healthz`);
        health.status; // → 503
        await health.json(); // → { ok: false, error: "unavailable" }
    });
    errors; // → ["healthz: the health check did not answer within 20 ms"]
    ```

    ```js
    createLifecycle({ build: "v1", health: { timeoutMs: 0 } });
    // throws TypeError: createLifecycle: health.timeoutMs is a whole number of
    //   milliseconds, 1 to 2147483647
    ```

  - then the app's
    `handler(req, res, url)`.

    ```js
    const life = createLifecycle({ build: "v1" });
    const handler = (req, res, url) => {
        res.end(url.searchParams.get("list") ?? "home");
    };
    await withServer(life.serve(handler), async (url) => {
        await (await fetch(`${url}/todos?list=work`)).text(); // → "work"
    });
    ```

  `/version` and `/healthz` take GET and HEAD alone (`refuseMethod`, `server/http.js`): an OPTIONS
  is 204 with `Allow: GET, HEAD`, and any other method 405 with it. Every other address is the
  handler's, whatever the method.

  ```js
  const life = createLifecycle({ build: "v1" });
  const handler = (req, res) => res.end(`${req.method} upload`);
  await withServer(life.serve(handler), async (url) => {
      const posted = await fetch(`${url}/version`, { method: "POST" });
      posted.status; // → 405
      posted.headers.get("allow"); // → "GET, HEAD"
      const options = await fetch(`${url}/healthz`, { method: "OPTIONS" });
      options.status; // → 204
      const upload = await fetch(`${url}/upload`, { method: "POST" });
      await upload.text(); // → "POST upload"
  });
  ```

  Anything that throws is `onError(error, "request")` and a 500 whose body
  is a fixed sentence (a response already under way is ended as it is): an error's own words carry
  file paths and driver text.

  ```js
  const errors = [];
  const life = createLifecycle({
      build: "v1",
      onError: (error, where) => errors.push(`${where}: ${error.message}`),
  });
  const handler = () => {
      throw new Error('relation "todos" does not exist');
  };
  await withServer(life.serve(handler), async (url) => {
      const answer = await fetch(url);
      answer.status; // → 500
      await answer.text();
      // → "Something went wrong on our side. Try again in a moment."
  });
  errors; // → ['request: relation "todos" does not exist']
  ```

  ```js
  const life = createLifecycle({ build: "v1", onError: () => {} });
  const handler = (req, res) => {
      res.writeHead(200, { "content-type": "text/csv" });
      res.write("id,title\n1,Milk\n");
      throw new Error("the cursor closed");
  };
  await withServer(life.serve(handler), async (url) => {
      const answer = await fetch(url);
      answer.status; // → 200
      await answer.text(); // → "id,title\n1,Milk\n"
  });
  ```

- `jobs` are `[{ name, every, run, atStart }]`, checked when the lifecycle is made (a name each, no
  two alike, an interval, `every`, a whole number of milliseconds from 1 to 2^31 − 1, about 24.8
  days, the longest a Node timer keeps: a longer one fired every millisecond, so a job wanted
  monthly runs daily and checks whether its day has come; something to run).

  ```js
  const run = () => {};
  createLifecycle({ build: "v1", jobs: [{ every: 60_000, run }] });
  // throws TypeError: createLifecycle: every job has a name
  createLifecycle({
      build: "v1",
      jobs: [
          { name: "digest", every: 60_000, run },
          { name: "digest", every: 3_600_000, run },
      ],
  });
  // throws TypeError: createLifecycle: two jobs are called "digest"
  ```

  ```js
  const monthly = 31 * 24 * 60 * 60 * 1000;
  createLifecycle({
      build: "v1",
      jobs: [{ name: "invoices", every: monthly, run: () => {} }],
  });
  // throws TypeError: createLifecycle: job "invoices" needs an interval, every,
  //   a whole number of milliseconds, 1 to 2147483647 (about 24.8 days)
  const daily = { name: "invoices", every: 86_400_000 };
  createLifecycle({ build: "v1", jobs: [daily] });
  // throws TypeError: createLifecycle: job "invoices" has nothing to run
  ```

  - `start()` runs each on
    its interval, and an `atStart` one at once too; a run that throws or rejects reaches
    `onError(error, "job <name>")` and keeps its schedule; a job never runs beside itself: a tick that
    comes while its previous run is still in flight is skipped, not reported as an error, and
    `skipped` (`{ [job name]: count }`) counts them; a job's timer never keeps the process alive by
    itself.

    ```js
    const errors = [];
    let runs = 0;
    const sync = () => {
        runs += 1;
        throw new Error("the feed is down");
    };
    const life = createLifecycle({
        build: "v1",
        jobs: [{ name: "sync", every: 10, run: sync }],
        onError: (error, where) => errors.push(`${where}: ${error.message}`),
    });
    life.start();
    runs; // → 0
    while (runs < 2) await sleep(10);
    await life.stop();
    errors[1]; // → "job sync: the feed is down"
    ```

    ```js
    let runs = 0;
    let finish;
    const digest = () => {
        runs += 1;
        return new Promise((resolve) => (finish = resolve));
    };
    const life = createLifecycle({
        build: "v1",
        jobs: [{ name: "digest", every: 10, atStart: true, run: digest }],
    });
    life.start();
    runs; // → 1
    await sleep(50);
    runs; // → 1
    life.skipped.digest > 0; // → true
    finish();
    await life.stop();
    ```

  - `stop()` clears the timers and resolves once the runs in flight have finished, so what
    they use can be closed after it; a lifecycle once stopped does not start again.

    ```js
    const log = [];
    const backup = async () => {
        await sleep(20);
        log.push("backup done");
    };
    const life = createLifecycle({
        build: "v1",
        jobs: [{ name: "backup", every: 60_000, atStart: true, run: backup }],
    });
    life.start();
    await life.stop();
    log.push("pool closed");
    life.start();
    await sleep(30);
    log; // → ["backup done", "pool closed"]
    ```

  - A job calls the
    app's own modules, or a service with `internal(reason)` as its context, never a service without
    one.

    ```js
    import { internal, callKind } from "juris/live-protocol.js";

    const services = {
        async purgeDone() {
            return `${callKind(this)}: ${this.reason}`;
        },
    };
    const log = [];
    const purge = async () => {
        log.push(await services.purgeDone.call(internal("hourly purge")));
    };
    const life = createLifecycle({
        build: "v1",
        jobs: [{ name: "purge", every: 3_600_000, atStart: true, run: purge }],
    });
    life.start();
    await life.stop();
    log; // → ["internal: hourly purge"]
    await services.purgeDone(); // → "direct: undefined"
    ```

- `drain()` is the first step of taking an instance out of rotation, and `draining` says whether it
  was taken.

  ```js
  const life = createLifecycle({ build: "v1" });
  await withServer(life.serve((req, res) => res.end("ok")), async (url) => {
      life.draining; // → false
      life.drain();
      life.draining; // → true
      const health = await fetch(`${url}/healthz`);
      health.status; // → 503
      health.headers.get("connection"); // → "close"
      await health.json(); // → { ok: false, error: "stopping" }
      await (await fetch(url)).text(); // → "ok"
  });
  ```

  - `onError` is the log unless given.

    ```js
    const logged = [];
    console.error = (where, error) => logged.push([where, error.message]);
    const sync = () => {
        throw new Error("the feed is down");
    };
    const life = createLifecycle({
        build: "v1",
        jobs: [{ name: "sync", every: 60_000, atStart: true, run: sync }],
    });
    life.start();
    await life.stop();
    logged; // → [["  job sync:", "the feed is down"]]
    ```

- The options are `build`, `instance`, `instanceHeader`, `health` (`check`, `details`,
  `timeoutMs`), `jobs` (each `name`, `every`, `run`, `atStart`) and `onError`: any other key, at the
  top, in `health` or in a job, is refused with a `TypeError` when the lifecycle is made.

  ```js
  createLifecycle({ build: "v1", instanceHeaders: true });
  // throws TypeError: createLifecycle: "instanceHeaders" is not an option
  createLifecycle({ build: "v1", health: { timeoutMS: 500 } });
  // throws TypeError: createLifecycle: health.timeoutMS is not an option
  const run = () => {};
  createLifecycle({
      build: "v1",
      jobs: [{ name: "digest", every: 60_000, run, onStart: true }],
  });
  // throws TypeError: createLifecycle: job "digest": onStart is not an option
  ```

#### `server/process.js`

**Exports:** `startProcess`.

The examples on this page fork nothing: they hand `startProcess` a stand-in for Node's cluster,
which records what it was asked to fork, and timers that wait no time.

```js setup
import { EventEmitter } from "node:events";
import { startProcess } from "juris-kit/server/process.js";

// Node's cluster, as the primary sees it: `fork(env)` makes a worker.
function standInCluster() {
    const cluster = new EventEmitter();
    cluster.isPrimary = true;
    cluster.forked = [];
    cluster.fork = (env) => {
        const worker = { id: cluster.forked.length + 1, env };
        cluster.forked.push(worker);
        return worker;
    };
    return cluster;
}

// Timers that record each wait and run what waited at once.
function instantTimers() {
    const timers = { waits: [], clock: 0 };
    timers.now = () => timers.clock;
    timers.setTimeout = (run, ms) => {
        timers.waits.push(ms);
        run();
    };
    return timers;
}

const quiet = { log: () => {}, error: () => {} };
```

`startProcess({ workers, liveQueries, allow, env, workerIdEnv, refusal, exit, onWorkerExit, log,
backoff, cluster, timers })` answers `"serve"` (this process serves: one worker, or a worker already
forked) or `"primary"` (it forked the workers and serves nothing). An app's entry calls it first,
before it opens a pool, runs a migration or starts a job.

```js
startProcess({ workers: 1 }); // → "serve"
const cluster = standInCluster();
startProcess({ workers: 2, liveQueries: false, cluster }); // → "primary"
cluster.forked.length; // → 2
cluster.isPrimary = false;
startProcess({ workers: 2, liveQueries: false, cluster }); // → "serve"
```

```js excerpt
import { createJurisServer } from "juris-kit/server/kernel.js";
import { openPool } from "./db.js";
import { app } from "./app.js";

const role = startProcess({
    workers: Number(process.env.WEB_CONCURRENCY ?? 1),
    liveQueries: false,
    env: { BUILD_ID: process.env.BUILD_ID },
    workerIdEnv: "WORKER_ID",
    exit: (code) => process.exit(code),
});
if (role === "serve") {
    const pool = await openPool(process.env.DATABASE_URL);
    const server = await createJurisServer({
        ...app,
        build: process.env.BUILD_ID,
        onShutdown: [() => pool.end()],
    });
    await server.listen({ port: Number(process.env.PORT ?? 3000) });
}
```

- More than one worker on a port is refused beside live queries (`liveQueries`, true unless told),
  because a live query's event stream and the subscribe calls that feed it are separate connections,
  which Node's cluster hands to different workers, and the worker a subscribe lands on never minted
  that client: every live query answers 403.

  ```js
  startProcess({ workers: 4 });
  // throws Error: 4 workers on one port would break live queries
  ```

  - The refusal is decided before anything is forked (a
    primary that forked first would replace each refusing worker forever), says why and what to do
    instead (several instances behind a sticky balancer) unless `refusal` gives the app's own words,
    and calls `exit(1)`; without an `exit`, it is thrown, which stops an entry at its top level just
    the same.

    ```js
    const cluster = standInCluster();
    const exits = [];
    const said = [];
    startProcess({
        workers: 4,
        cluster,
        log: { error: (message) => said.push(message) },
        exit: (code) => exits.push(code),
    });
    // throws Error: 4 workers on one port would break live queries
    exits; // → [1]
    said[0].includes("Run several instances behind a sticky balancer"); // → true
    cluster.forked; // → []
    ```

    ```js
    startProcess({
        workers: 4,
        refusal: (workers) =>
            `WEB_CONCURRENCY=${workers}: set it to 1 for live todos`,
    });
    // throws Error: WEB_CONCURRENCY=4: set it to 1 for live todos
    ```

  - `allow` runs workers anyway, for an app that knows otherwise.

    ```js
    const cluster = standInCluster();
    startProcess({ workers: 4, allow: true, cluster }); // → "primary"
    cluster.forked.length; // → 4
    ```

- In the primary, every worker is forked with the same `env` (an app passes its build id, so every
  worker stamps the same module URLs and answers the same build) and its own id, "1" to n, in the
  variable `workerIdEnv` names; a worker that exits unasked (not cleanly, not on SIGTERM or SIGINT)
  is replaced with the same `env` and the id "r", after `onWorkerExit(worker, code, signal)`, and
  after a wait: `backoff: { minMs = 1000, maxMs = 30000, resetAfterMs = 30000 }`, the wait doubling
  from `minMs` to `maxMs` while workers keep dying, and starting over once a worker that ran at least
  `resetAfterMs` dies.

  ```js
  const cluster = standInCluster();
  startProcess({
      workers: 3,
      liveQueries: false,
      cluster,
      env: { BUILD_ID: "2026-11-06.1" },
      workerIdEnv: "WORKER_ID",
  });
  cluster.forked.map((worker) => worker.env);
  // → [{ BUILD_ID: "2026-11-06.1", WORKER_ID: "1" },
  //    { BUILD_ID: "2026-11-06.1", WORKER_ID: "2" },
  //    { BUILD_ID: "2026-11-06.1", WORKER_ID: "3" }]
  ```

  ```js
  const cluster = standInCluster();
  const timers = instantTimers();
  const exited = [];
  startProcess({
      workers: 2,
      liveQueries: false,
      cluster,
      timers,
      env: { BUILD_ID: "v1" },
      workerIdEnv: "WORKER_ID",
      onWorkerExit: (worker, code, signal) => {
          exited.push([worker.id, code, signal]);
      },
  });
  const [first, second] = cluster.forked;
  cluster.emit("exit", first, 0, null);
  cluster.emit("exit", second, null, "SIGTERM");
  cluster.forked.length; // → 2
  cluster.emit("exit", first, 1, null);
  exited; // → [[1, 1, null]]
  cluster.forked[2].env; // → { BUILD_ID: "v1", WORKER_ID: "r" }
  ```

  ```js
  const cluster = standInCluster();
  const timers = instantTimers();
  startProcess({
      workers: 2,
      liveQueries: false,
      cluster,
      timers,
      log: quiet,
      backoff: { minMs: 1000, maxMs: 4000, resetAfterMs: 60_000 },
  });
  for (let crash = 0; crash < 4; crash++) {
      cluster.emit("exit", cluster.forked.at(-1), 1, null);
  }
  timers.waits; // → [1000, 2000, 4000, 4000]
  timers.clock += 60_000;
  cluster.emit("exit", cluster.forked.at(-1), 1, null);
  timers.waits.at(-1); // → 1000
  ```

  - A worker that cannot start (the database is down) used to be replaced at
    once, for ever: a fork loop. A `backoff` value that is not a whole number of milliseconds is
    refused (`TypeError`).

    ```js
    startProcess({ backoff: { minMs: 0.5 } });
    // throws TypeError: startProcess: backoff.minMs is a whole number of
    //   milliseconds, not 0.5
    startProcess({ backoff: { maxMs: "30s" } });
    // throws TypeError: startProcess: backoff.maxMs is a whole number of
    //   milliseconds, not 30s
    ```

- The framework reads no environment and ends no process: the entry passes the values it read and
  its own `exit`. `log`, `cluster` and `timers` (`{ setTimeout, now }`) are injectable for a test.

  ```js
  const cluster = standInCluster();
  const said = [];
  startProcess({
      workers: 2,
      liveQueries: false,
      cluster,
      timers: instantTimers(),
      log: { log: (line) => said.push(line) },
  });
  cluster.emit("exit", cluster.forked[0], 1, null);
  said; // → ["  worker 1 exited (1), replacing it in 1 s"]
  ```

#### `server/service-dispatcher.js`

**Exports:** `serviceDispatcher`, `ALL`.

The examples on this page serve a todo list's services from a dispatcher on a free port:
`served(handler, visit)` hands `visit` the dispatcher's base URL and always closes both, `post`
makes a JSON call as a browser's service stub does, `openStream` opens the live event stream (its
`client` id, and `next()`, the next event's data), and `subscribe` subscribes a client to a query.

```js setup
import http from "node:http";
import {
    serviceDispatcher,
    ALL,
} from "juris-kit/server/service-dispatcher.js";
import { liveKey } from "juris/live-protocol.js";

const lists = { home: ["Milk", "Eggs"], work: ["Report"] };
const services = {
    async todos(list) {
        return [...(lists[list] ?? [])];
    },
    async addTodo(list, title) {
        lists[list].push(title);
        return lists[list].length;
    },
};

async function served(handler, visit) {
    const host = http.createServer(async (req, res) => {
        try {
            if (!(await handler(req, res))) {
                res.writeHead(404);
                res.end();
            }
        } catch {
            res.writeHead(500);
            res.end();
        }
    });
    await new Promise((resolve) => host.listen(0, "127.0.0.1", resolve));
    try {
        return await visit(`http://127.0.0.1:${host.address().port}/api`);
    } finally {
        handler.close();
        host.closeAllConnections();
        await new Promise((resolve) => host.close(resolve));
    }
}

async function post(api, name, body, headers = {}) {
    const answer = await fetch(`${api}/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
    });
    return { status: answer.status, body: await answer.json() };
}

async function openStream(api, { client, headers } = {}) {
    const query = client ? `?client=${client}` : "";
    const answer = await fetch(`${api}/events${query}`, { headers });
    if (answer.status !== 200) {
        return { status: answer.status, body: await answer.json() };
    }
    const reader = answer.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    const next = async () => {
        while (!buffer.includes("\n\n")) {
            const { value, done } = await reader.read();
            if (done) return null;
            buffer += value;
        }
        const event = buffer.slice(0, buffer.indexOf("\n\n"));
        buffer = buffer.slice(event.length + 2);
        const data = /^data: (.*)$/m.exec(event);
        return data ? JSON.parse(data[1]) : event;
    };
    const retry = await next();
    const { client: id } = await next();
    const close = () => reader.cancel();
    return { status: 200, retry, client: id, next, close };
}

const subscribe = (api, client, name, args = [], headers = {}) =>
    post(api, "_live", {
        client,
        subscribe: { key: liveKey(name, args), name, args },
    }, headers);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
```

`serviceDispatcher(services, base, options)` answers a server's service calls over HTTP and serves
its live queries: the event stream, subscribes, and the re-runs an invalidation causes.

```js
const handler = serviceDispatcher(services, "/api");
await served(handler, async (api) => {
    await post(api, "todos", ["home"]);
    // → { status: 200, body: ["Milk", "Eggs"] }
    await post(api, "addTodo", ["home", "Bread"]); // → { status: 200, body: 3 }
});
```

```js
const handler = serviceDispatcher(services, "/api", {
    live: { queries: ["todos"], touches: { addTodo: ["todos"] }, public: true },
});
await served(handler, async (api) => {
    const stream = await openStream(api);
    await subscribe(api, stream.client, "todos", ["home"]);
    // → { status: 200, body: { ok: true } }
    await stream.next(); // → { key: 'todos:["home"]', full: ["Milk", "Eggs"] }
    await post(api, "addTodo", ["home", "Bread"]);
    await stream.next();
    // → { key: 'todos:["home"]', set: [["", ["Milk", "Eggs", "Bread"]]],
    //     del: [] }
});
```

It imports
`liveKey` and `diff` from `live-protocol.js`: server code may import a browser module, never the
reverse.

```js
import { diff } from "juris/live-protocol.js";

liveKey("todos", ["home"]); // → 'todos:["home"]'
diff({ title: "Milk", done: false }, { title: "Milk", done: true });
// → { set: [["done", true]], del: [] }
```

The handler it returns carries `names`, the service names it answers to (`options.expose`,
or every own function of `services`), fixed when it is made: what a page tells a browser it may
call.

```js
const handler = serviceDispatcher(services, "/api");
handler.names; // → ["todos", "addTodo"]
services.exportCsv = async () => "id,title";
handler.names; // → ["todos", "addTodo"]
serviceDispatcher(services, "/api", { expose: ["todos"] }).names; // → ["todos"]
```

- **Calls.** Every POST must be sent as `application/json` (415 otherwise): a form on another site
  cannot send that type without a preflight, so a service that trusts a cookie cannot be called
  from another site.

  ```js
  const handler = serviceDispatcher(services, "/api");
  await served(handler, async (api) => {
      const answer = await fetch(`${api}/addTodo`, {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: '["home", "Bread"]',
      });
      answer.status; // → 415
      await answer.json();
      // → { error: "bad request: content-type must be application/json" }
  });
  lists.home; // → ["Milk", "Eggs"]
  ```

  - A call is a POST. Any other method, a GET, a HEAD or an OPTIONS (a CORS preflight) among them,
    is answered 405 with `Allow: POST`, the header RFC 9110 has every 405 carry (15.5.6): it names
    the methods the address takes. So is a subscribe (`_live`) sent any other way, and so is a
    service's own refusal with 405.

    ```js
    const handler = serviceDispatcher(services, "/api");
    await served(handler, async (api) => {
        const answer = await fetch(`${api}/todos`);
        answer.status; // → 405
        answer.headers.get("allow"); // → "POST"
        await answer.json(); // → { error: "services take POST" }
    });
    ```

    ```js
    const handler = serviceDispatcher(services, "/api");
    await served(handler, async (api) => {
        const answer = await fetch(`${api}/addTodo`, { method: "OPTIONS" });
        answer.status; // → 405
        answer.headers.get("allow"); // → "POST"
    });
    ```

  - `options.maxBody` caps a body (1 MB unless told; 413).

    ```js
    const handler = serviceDispatcher(services, "/api", { maxBody: 64 });
    await served(handler, async (api) => {
        const title = "a very long title ".repeat(10);
        await post(api, "addTodo", ["home", title]);
        // → { status: 413,
        //     body: { error: "bad request: body larger than 64 bytes" } }
    });
    ```

  - A refusal answered before
    the request has arrived whole (a 415 at its type, a 413 part-way through its body) first reads and
    drops what is still coming (`drainBody`: at most a second between pieces, five in all), then says
    `connection: close`, and the connection ends with the answer. Answered at once, the client's bytes
    still on their way would be reset and could take the answer down with them; left open unread, the
    rest of that body would be taken for the next request on a kept-alive connection, which a proxy in
    front may pool for someone else's call (RFC 9112, 9.6).

    ```js
    const handler = serviceDispatcher(services, "/api", { maxBody: 1024 });
    await served(handler, async (api) => {
        const answer = await fetch(`${api}/addTodo`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(["home", "x".repeat(500_000)]),
        });
        answer.status; // → 413
        answer.headers.get("connection"); // → "close"
    });
    ```

  - `options.context(req,
    res)` builds the context a service is called with as `this` (see "Who is calling").

    ```js
    const account = {
        async whoAmI() {
            return this.user;
        },
    };
    const handler = serviceDispatcher(account, "/api", {
        context: (req) => ({ user: req.headers["x-user"] ?? "guest" }),
    });
    await served(handler, async (api) => {
        (await post(api, "whoAmI", [], { "x-user": "ada" })).body; // → "ada"
        (await post(api, "whoAmI", [])).body; // → "guest"
    });
    ```

  - A refusal
    answers `{ error, fields?, field?, code? }`: the message only if `exposeError` allows it ("request
    failed" otherwise), a service's `fields` as given, a singular `field` as it is and folded into
    `fields` with that same message, and `code` only beside a message the caller may read.

    ```js
    import { fail } from "juris/errors.js";

    const todoForm = {
        async addTodo(list, title) {
            if (!title) {
                fail("Give the todo a title.", {
                    field: "title",
                    code: "todo.untitled",
                });
            }
            throw Object.assign(new Error('duplicate key "todos_pkey"'), {
                code: "23505",
            });
        },
    };
    const handler = serviceDispatcher(todoForm, "/api");
    await served(handler, async (api) => {
        (await post(api, "addTodo", ["home", ""])).body;
        // → { error: "Give the todo a title.",
        //     fields: { title: "Give the todo a title." },
        //     field: "title", code: "todo.untitled" }
        (await post(api, "addTodo", ["home", "Milk"])).body;
        // → { error: "request failed" }
    });
    ```

    ```js
    import { ServiceError } from "juris/errors.js";

    const todoForm = {
        async addTodo() {
            throw new ServiceError("Check the form.", {
                fields: { title: "At most 80 characters.", list: "No such list." },
            });
        },
    };
    const handler = serviceDispatcher(todoForm, "/api");
    await served(handler, async (api) => {
        (await post(api, "addTodo", [])).body;
        // → { error: "Check the form.",
        //     fields: { title: "At most 80 characters.", list: "No such list." } }
    });
    ```

  - A refusal's status is the `status` its error carries when that is an HTTP error status Node knows
    (a 4xx or 5xx in `http.STATUS_CODES`), 400 when it carries none, and 500 for anything else (a 999,
    a 302, a string): a thrown status used to go out as given.

    ```js
    const refusing = (status) => async () => {
        throw Object.assign(new Error("refused"), { status });
    };
    const handler = serviceDispatcher({
        archived: refusing(410),
        plain: refusing(undefined),
        odd: refusing(999),
        moved: refusing(302),
        worded: refusing("409"),
    }, "/api");
    await served(handler, async (api) => {
        (await post(api, "archived", [])).status; // → 410
        (await post(api, "plain", [])).status; // → 400
        (await post(api, "odd", [])).status; // → 500
        (await post(api, "moved", [])).status; // → 500
        (await post(api, "worded", [])).status; // → 500
    });
    ```

  - A 401 goes out with the challenge its error names, `error.challenge`, as `WWW-Authenticate`:
    RFC 9110 has every 401 say how to authenticate (15.5.2), and how an app's callers sign in is
    the app's to say, so the kit makes none up. Another status sends no challenge, and `invoke`
    answers none.

    ```js
    import { ServiceError } from "juris/errors.js";

    const signedOut = new ServiceError("Sign in first.", { status: 401 });
    signedOut.challenge = 'Cookie realm="todos", sign-in="/login"';
    const account = {
        async addTodo() {
            throw signedOut;
        },
    };
    const handler = serviceDispatcher(account, "/api");
    await served(handler, async (api) => {
        const answer = await fetch(`${api}/addTodo`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "[]",
        });
        answer.status; // → 401
        answer.headers.get("www-authenticate");
        // → 'Cookie realm="todos", sign-in="/login"'
        await answer.json(); // → { error: "Sign in first." }
    });
    ```

  - A challenge is an auth-scheme, then, after a space, its parameters, in visible ASCII. One that
    is not fails the request with a TypeError before anything is written, as a form's redirect off
    the site does, and the server answers it as it answers any throw (the examples' server, with a
    500): sent, it would be a 401 no client can read how to answer.

    ```js
    import { ServiceError } from "juris/errors.js";

    const signedOut = new ServiceError("Sign in first.", { status: 401 });
    signedOut.challenge = "sign-in\nat /login";
    const account = {
        async addTodo() {
            throw signedOut;
        },
    };
    const handler = serviceDispatcher(account, "/api");
    await served(handler, async (api) => {
        const answer = await fetch(`${api}/addTodo`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "[]",
        });
        answer.status; // → 500
        answer.headers.get("www-authenticate"); // → null
    });
    ```

  - A service that succeeded runs its
    `touches` whatever becomes of its answer: a result JSON cannot carry (a `BigInt`, a cycle) is
    answered as a refusal (400), and the change it made is still invalidated.

    ```js
    const heard = [];
    const shop = {
        ...services,
        async addTodo(list, title) {
            lists[list].push(title);
            return BigInt(lists[list].length);
        },
    };
    const handler = serviceDispatcher(shop, "/api", {
        live: {
            touches: { addTodo: ["todos"] },
            public: true,
            onInvalidate: (targets) => heard.push(targets),
        },
    });
    await served(handler, async (api) => {
        await post(api, "addTodo", ["home", "Bread"]);
        // → { status: 400, body: { error: "request failed" } }
    });
    lists.home; // → ["Milk", "Eggs", "Bread"]
    heard; // → [["todos"]]
    ```

  - `onError(error, name, args)` hears what was hidden, and a live query's failed re-run.

    ```js
    const hidden = [];
    const down = {
        async todos() {
            throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
        },
    };
    const handler = serviceDispatcher(down, "/api", {
        onError: (error, name, args) => hidden.push([name, args, error.message]),
    });
    await served(handler, async (api) => {
        await post(api, "todos", ["home"]);
        // → { status: 400, body: { error: "request failed" } }
    });
    hidden; // → [["todos", ["home"], "connect ECONNREFUSED 10.0.0.5:5432"]]
    ```

- **Reserved names.** Two names are the live layer's own endpoints, `events` (the stream) and
  `_live` (the subscribe call), and construction throws if a service it would answer to has one,
  whether or not live queries are on.

  ```js
  serviceDispatcher({ ...services, events: async () => [] }, "/api");
  // throws Error: serviceDispatcher: "events" is reserved for the live layer's
  //   endpoints (/api/events, /api/_live), with or without live queries
  const handler = serviceDispatcher(
      { ...services, events: async () => [] },
      "/api",
      { expose: ["todos", "addTodo"] },
  );
  handler.names; // → ["todos", "addTodo"]
  ```

- **`strict: { names, flushAll, warn }`** is how an app has every service say what it changes:
  construction throws, listing every problem, when `names` (the list its browsers are given) and
  the services differ either way, when a name in `live.queries`, `live.touches` or `flushAll` is not
  a service, or when a service is none of a declared live query, a `live.touches` entry (`[]` for
  "changes nothing a page shows") or a member of `flushAll`.

  ```js
  let problems;
  try {
      serviceDispatcher({ ...services, async exportCsv() {} }, "/api", {
          strict: { names: ["todos", "addTodo", "importCsv"] },
          live: {
              queries: ["todos"],
              touches: { addTodo: ["lists"] },
              public: true,
          },
      });
  } catch (error) {
      problems = error.message.split("\n");
  }
  problems.length; // → 5
  problems[1].trim();
  // → "strict.names names services that do not exist: importCsv"
  problems[3].trim();
  // → 'live.touches["addTodo"] names "lists", which is not a service'
  problems[4].trim().startsWith("these services do not say what they change");
  // → true
  ```

  ```js
  const exporting = { ...services, async exportCsv() {} };
  const handler = serviceDispatcher(exporting, "/api", {
      strict: { names: ["todos", "addTodo", "exportCsv"] },
      live: {
          queries: ["todos"],
          touches: { addTodo: ["todos"], exportCsv: [] },
          public: true,
      },
  });
  handler.names; // → ["todos", "addTodo", "exportCsv"]
  ```

  - `warn(message, names)` is told, once,
    the declared queries no `touches` list names.

    ```js
    const warned = [];
    serviceDispatcher(services, "/api", {
        strict: { warn: (message, names) => warned.push(names) },
        live: { queries: ["todos"], touches: { addTodo: [] }, public: true },
    });
    warned; // → [["todos"]]
    ```

- **`live`** holds the live queries: `queries`, `touches`, `authorize(name, args, info)` (or
  `public: true`), `identify`, `clientKey(req, owner)`, `bus`, `onInvalidate`, `strictQueries`,
  `retryMs`, `recheckMs` (30000), `graceMs` (30000), `keepAlive`, and the ceilings
  `maxKeysPerClient` (64), `maxGroups` (10000), `maxStreamsPerCaller` (12), `maxGroupsPerCaller`
  (256), `maxPostsPerMinute` (240) and `maxBufferBytes` (1 MB: a stream further behind is dropped).

  ```js
  serviceDispatcher(services, "/api", { live: { queries: ["todos"] } });
  // throws Error: serviceDispatcher: live queries need live.authorize(name, args,
  //   info), or live.public: true if every one of them is for everybody
  ```

  ```js
  const handler = serviceDispatcher(services, "/api", {
      live: {
          queries: ["todos"],
          authorize: (name, [list]) => list !== "work",
          maxKeysPerClient: 2,
      },
  });
  await served(handler, async (api) => {
      const { client } = await openStream(api);
      (await subscribe(api, client, "todos", ["work"])).status; // → 403
      (await subscribe(api, client, "todos", ["home"])).status; // → 200
      (await subscribe(api, client, "todos", ["garden"])).status; // → 200
      await subscribe(api, client, "todos", ["shop"]);
      // → { status: 429,
      //     body: { error: "at most 2 live subscriptions per client" } }
  });
  ```

  ```js
  const handler = serviceDispatcher(services, "/api", {
      live: { queries: ["todos"], public: true, maxStreamsPerCaller: 1 },
  });
  await served(handler, async (api) => {
      (await openStream(api)).status; // → 200
      await openStream(api);
      // → { status: 429, body: { error: "at most 1 live streams at a time" } }
  });
  ```

  - Every number among them is checked at construction as `retryMs` is, and a `TypeError` names the
    one that is not: `keepAlive` a whole number of milliseconds from 1 (0 wrote a keep-alive every
    millisecond), `graceMs` and `recheckMs` whole numbers from 0 (the timers, `keepAlive` and
    `graceMs`, at most 2^31 − 1), `maxKeysPerClient`, `maxGroups` and `maxBufferBytes` whole numbers
    from 1 or `Infinity`, and `maxStreamsPerCaller`, `maxGroupsPerCaller` and `maxPostsPerMinute`
    whole numbers from 0 (0 is no ceiling, as it always was) or `Infinity`.

    ```js
    const live = (options) =>
        serviceDispatcher(services, "/api", {
            live: { queries: ["todos"], public: true, ...options },
        });
    live({ keepAlive: 0 });
    // throws TypeError: serviceDispatcher: live.keepAlive is a whole number of
    //   milliseconds from 1 to 2147483647, not 0
    live({ graceMs: 2 ** 31 });
    // throws TypeError: serviceDispatcher: live.graceMs is a whole number of
    //   milliseconds from 0 to 2147483647, not 2147483648
    live({ maxGroups: 0 });
    // throws TypeError: serviceDispatcher: live.maxGroups is a whole number from 1,
    //   or Infinity, not 0
    ```

    ```js
    const live = (options) =>
        serviceDispatcher(services, "/api", {
            live: { queries: ["todos"], public: true, ...options },
        });
    typeof live({ maxStreamsPerCaller: 0, maxGroups: Infinity }); // → "function"
    typeof live({ recheckMs: 0, graceMs: 0 }); // → "function"
    ```

  - A string
    (`maxGroups: "5"`) used to compare as no ceiling. `null` still means the default.

    ```js
    const live = (options) =>
        serviceDispatcher(services, "/api", {
            live: { queries: ["todos"], public: true, ...options },
        });
    live({ maxGroups: "5" });
    // throws TypeError: serviceDispatcher: live.maxGroups is a whole number from 1,
    //   or Infinity, not "5"
    typeof live({ maxGroups: null }); // → "function"
    ```

- **The bus.** A mutation's invalidation publishes to `live.bus` beside its local re-runs, not
  before them: a slow or hung pool does not delay this instance's own updates (a failed publish goes
  to `onError`, `live.bus.publish`, and `handler.invalidate` resolves once both are done).

  ```js
  const log = [];
  const bus = {
      async publish(targets) {
          await sleep(50);
          log.push(`published ${JSON.stringify(targets)}`);
      },
      subscribe: () => () => {},
  };
  const handler = serviceDispatcher(services, "/api", {
      live: { queries: ["todos"], public: true, bus },
  });
  await served(handler, async (api) => {
      const stream = await openStream(api);
      await subscribe(api, stream.client, "todos", ["home"]);
      await stream.next();
      lists.home.push("Bread");
      const invalidated = handler.invalidate(["todos"]);
      await stream.next();
      log.push("patched");
      await invalidated;
  });
  log; // → ["patched", 'published ["todos"]']
  ```

  ```js
  const errors = [];
  const bus = {
      publish: async () => {
          throw new Error("the outbox pool is closed");
      },
      subscribe: () => () => {},
  };
  const handler = serviceDispatcher(services, "/api", {
      live: { queries: ["todos"], public: true, bus },
      onError: (error, where) => errors.push(`${where}: ${error.message}`),
  });
  await handler.invalidate(["todos"]);
  errors; // → ["live.bus.publish: the outbox pool is closed"]
  handler.stats().bus;
  // → { published: 1, received: 0, unpublishable: 0, errors: 1 }
  ```

  - What
    arrives off the bus is applied without the bus waiting for the re-runs (a failure goes to
    `onError`, `live.bus.apply`), so one slow query does not stall every change behind it; a bus's
    `read()` or `poll()` therefore resolves once the re-runs are started, not finished.

    ```js
    let arrive;
    const bus = {
        publish: async () => {},
        subscribe: (apply) => {
            arrive = apply;
            return () => {};
        },
    };
    const slow = {
        async todos(list) {
            await sleep(100);
            return [...lists[list]];
        },
    };
    const heard = [];
    const handler = serviceDispatcher(slow, "/api", {
        live: {
            queries: ["todos"],
            public: true,
            bus,
            onInvalidate: (targets, { remote }) => heard.push({ targets, remote }),
        },
    });
    await served(handler, async (api) => {
        const stream = await openStream(api);
        await subscribe(api, stream.client, "todos", ["home"]);
        await stream.next();
        lists.home.push("Bread");
        const started = Date.now();
        arrive([{ name: "todos", args: ["home"] }]);
        Date.now() - started < 100; // → true
        heard; // → [{ targets: [{ name: "todos", args: ["home"] }], remote: true }]
        (await stream.next()).set; // → [["", ["Milk", "Eggs", "Bread"]]]
    });
    ```

- **A live query whose result JSON cannot carry** fails like any other failed re-run:
  `onError(error, name, args)`, the subscribers told `{ key, error }`, and nothing kept to answer the
  next subscriber from. It used to be an unhandled rejection.

  ```js
  let runs = 0;
  const stock = {
      async stock() {
          runs += 1;
          return { milk: 12n };
      },
  };
  const errors = [];
  const handler = serviceDispatcher(stock, "/api", {
      live: { queries: ["stock"], public: true },
      onError: (error, name) => errors.push(`${name}: ${error.message}`),
  });
  await served(handler, async (api) => {
      const first = await openStream(api);
      await subscribe(api, first.client, "stock");
      await first.next(); // → { key: "stock:[]", error: "live query failed" }
      const second = await openStream(api);
      await subscribe(api, second.client, "stock");
      await second.next(); // → { key: "stock:[]", error: "live query failed" }
  });
  runs; // → 2
  errors[0]; // → "stock: Do not know how to serialize a BigInt"
  ```

- **The event stream takes GET and HEAD**, the one address under the base a browser GETs. An
  OPTIONS is a 204 and any other method a 405, each with `Allow: GET, HEAD` (`refuseMethod`,
  `server/http.js`), and neither opens a stream; a HEAD gets the stream's headers, and no client is
  minted for it.

  ```js
  const handler = serviceDispatcher(services, "/api", {
      live: { queries: ["todos"], public: true },
  });
  await served(handler, async (api) => {
      const posted = await fetch(`${api}/events`, { method: "POST" });
      posted.status; // → 405
      posted.headers.get("allow"); // → "GET, HEAD"
      const head = await fetch(`${api}/events`, { method: "HEAD" });
      head.headers.get("content-type"); // → "text/event-stream"
      handler.stats().clients; // → 0
  });
  ```

- **One stream per client id.** A stream reopened with its `?client=<id>` replaces the one that id
  had, which is ended (it used to stay open, uncounted by `maxStreamsPerCaller`, with no
  keep-alive).

  ```js
  const handler = serviceDispatcher(services, "/api", {
      live: { queries: ["todos"], public: true },
  });
  await served(handler, async (api) => {
      const first = await openStream(api);
      const again = await openStream(api, { client: first.client });
      again.client === first.client; // → true
      await first.next(); // → null
      handler.stats().connected; // → 1
  });
  ```

  - A stream request that goes away while `identify` runs makes no client and is
    answered nothing (its client used to stay "connected" for good and hold a place under the
    ceiling).

    ```js
    const handler = serviceDispatcher(services, "/api", {
        live: {
            queries: ["todos"],
            public: true,
            identify: async ({ req }) => {
                await new Promise((resolve) => req.once("close", resolve));
                return "ada";
            },
        },
    });
    await served(handler, async (api) => {
        const leaving = new AbortController();
        const opening = fetch(`${api}/events`, { signal: leaving.signal });
        await sleep(20);
        leaving.abort();
        await opening.catch(() => {});
        await sleep(20);
        handler.stats().clients; // → 0
    });
    ```

  - A subscribe whose client is dropped (its grace period ended) while `authorize` runs is
    answered 403 `live.client-unknown`, and joins no group.

    ```js
    let decide;
    const handler = serviceDispatcher(services, "/api", {
        live: {
            queries: ["todos"],
            graceMs: 0,
            authorize: () => new Promise((resolve) => (decide = resolve)),
        },
    });
    await served(handler, async (api) => {
        const stream = await openStream(api);
        const subscribing = subscribe(api, stream.client, "todos", ["home"]);
        while (!decide) await sleep(5);
        await stream.close();
        while (handler.stats().clients > 0) await sleep(5);
        decide(true);
        await subscribing;
        // → { status: 403, body: { error: "unknown or foreign client id",
        //     code: "live.client-unknown" } }
        handler.stats().groups; // → 0
    });
    ```

- **A misspelt option is refused.** The options are `live`, `maxBody`, `context`, `expose`,
  `strict`, `forms`, `exposeError` and `onError`, and `live`, `strict` and `forms` take only the
  keys this section names: any other key, at the top or inside one of the three, and one of the
  three that is not an object, is refused with a `TypeError` at construction. `live: {
  strictQuerys: true }` used to build a dispatcher without the switch it names.

  ```js
  serviceDispatcher(services, "/api", { maxbody: 4096 });
  // throws TypeError: serviceDispatcher: "maxbody" is not an option
  serviceDispatcher(services, "/api", { live: { strictQuerys: true } });
  // throws TypeError: serviceDispatcher: live.strictQuerys is not an option
  serviceDispatcher(services, "/api", { forms: true });
  // throws TypeError: serviceDispatcher: forms is an object of options
  ```

- **`live.strictQueries: true`** makes the names in `live.queries` the only ones a subscribe may
  name. By default every query an array-valued `touches` entry names is subscribable too (the name
  of each target: `"q"`, `{ name: "q", args }` and `{ name: "q", where }` all make `q` subscribable;
  `ALL` makes nothing so) whenever `authorize` lets it be, so a read became subscribable the day a
  mutation said it changes it; with it such a name is an invalidation name only, and a subscribe to
  anything that is no query is refused with 403 and `code: "live.not-a-query"` before `authorize` is
  asked (with or without it, a direct call asks `authorize` about a declared query alone).

  ```js
  const subscribable = async (strictQueries) => {
      const handler = serviceDispatcher(services, "/api", {
          live: {
              touches: { addTodo: [{ name: "todos", args: ["home"] }] },
              authorize: () => true,
              strictQueries,
          },
      });
      return served(handler, async (api) => {
          const { client } = await openStream(api);
          return subscribe(api, client, "todos", ["home"]);
      });
  };
  await subscribable(false); // → { status: 200, body: { ok: true } }
  await subscribable(true);
  // → { status: 403, body: { error: '"todos" is not a live query',
  //     code: "live.not-a-query" } }
  ```

  ```js
  const asked = [];
  const handler = serviceDispatcher(services, "/api", {
      live: {
          queries: ["todos"],
          touches: { addTodo: ["todos"] },
          authorize: (name) => {
              asked.push(name);
              return true;
          },
      },
  });
  await served(handler, async (api) => {
      const { client } = await openStream(api);
      (await subscribe(api, client, "addTodo", ["home"])).body.code;
      // → "live.not-a-query"
      await post(api, "todos", ["home"]);
      await post(api, "addTodo", ["home", "Bread"]);
  });
  asked; // → ["todos"]
  ```

  - It is
    opt-in so that an app which subscribes to such a name keeps working until it declares it; an app
    whose `touches` lists name a read that is no query should turn it on. Construction refuses a value
    that is not a boolean.

    ```js
    serviceDispatcher(services, "/api", {
        live: { queries: ["todos"], public: true, strictQueries: "yes" },
    });
    // throws TypeError: serviceDispatcher: live.strictQueries is true or false,
    //   not "yes"
    ```

- **`live.retryMs`** is the `retry:` field every event stream sends first, how long a browser that
  lost the stream waits before it opens it again: 2000 unless said, and construction refuses
  anything but a whole number of milliseconds from 1 that a timer can wait.

  ```js
  const retry = (options) => {
      const handler = serviceDispatcher(services, "/api", {
          live: { queries: ["todos"], public: true, ...options },
      });
      return served(handler, async (api) => (await openStream(api)).retry);
  };
  await retry({}); // → "retry: 2000"
  await retry({ retryMs: 10_000 }); // → "retry: 10000"
  ```

  ```js
  serviceDispatcher(services, "/api", {
      live: { queries: ["todos"], public: true, retryMs: 0 },
  });
  // throws TypeError: serviceDispatcher: live.retryMs is a whole number of
  //   milliseconds from 1 to 2147483647, not 0
  ```

- **`live.onInvalidate(targets, { remote })`** is told of every invalidation the instance applies,
  with or without a bus (a mutation's `touches`, a `flushAll` service's `ALL`, `handler.invalidate`,
  and what arrives off the bus, `remote: true`), before anything is awaited, so an app feeds its
  page cache there (`onInvalidate: (targets) => cache.invalidate(targets)`); a throw or a rejection
  goes to `onError` and stops nothing.

  ```js
  const heard = [];
  const shop = { ...services, async renameList() {} };
  const handler = serviceDispatcher(shop, "/api", {
      strict: { flushAll: ["renameList"] },
      live: {
          queries: ["todos"],
          touches: {
              addTodo: (list) => [{ name: "todos", args: [list] }],
              renameList: [],
          },
          public: true,
          onInvalidate: (targets, { remote }) => heard.push([targets, remote]),
      },
  });
  await handler.invoke("addTodo", ["home", "Bread"]);
  await handler.invoke("renameList", ["home", "House"]);
  await handler.invalidate(["todos"]);
  heard;
  // → [[[{ name: "todos", args: ["home"] }], false],
  //    [[{ name: "$pages" }], false],
  //    [["todos"], false]]
  ```

  ```js
  import { createPageCache } from "juris-kit/server/page-cache.js";

  const cache = createPageCache();
  const errors = [];
  const handler = serviceDispatcher(services, "/api", {
      live: {
          queries: ["todos"],
          public: true,
          onInvalidate: (targets) => {
              cache.invalidate(targets);
              throw new Error("the cache's disk is full");
          },
      },
      onError: (error, where) => errors.push(`${where}: ${error.message}`),
  });
  await handler.invalidate(["todos"]);
  errors; // → ["live.onInvalidate: the cache's disk is full"]
  cache.stats().invalidations; // → 1
  ```

- **`handler.invoke(name, args, ctx)`** is one call through the whole pipeline for any transport
  that is not a JSON POST: `authorize` for a declared query, the service with `ctx` as `this` (taken
  as given; one that says no kind is a direct call), its `touches` once it succeeds, and the error
  filter, answering `{ ok: true, result }` or `{ ok: false, status, error, fields?, field?, code? }`,
  what a JSON caller reads.

  ```js
  const handler = serviceDispatcher(services, "/api", {
      live: { queries: ["todos"], authorize: (name, [list]) => list !== "work" },
  });
  await handler.invoke("todos", ["home"]);
  // → { ok: true, result: ["Milk", "Eggs"] }
  await handler.invoke("todos", ["work"]);
  // → { ok: false, status: 403, error: "not allowed" }
  await handler.invoke("exportCsv", []);
  // → { ok: false, status: 404, error: 'unknown service "exportCsv"' }
  ```

  ```js
  import { callKind, internal } from "juris/live-protocol.js";

  const reports = {
      async weekly() {
          return `${callKind(this)}: ${this.reason ?? "a request"}`;
      },
  };
  const handler = serviceDispatcher(reports, "/api");
  await handler.invoke("weekly", [], internal("monday digest"));
  // → { ok: true, result: "internal: monday digest" }
  await handler.invoke("weekly", [], {});
  // → { ok: true, result: "direct: a request" }
  ```

  - A JSON POST runs the same steps and still answers before its touches
    run.

    ```js
    const log = [];
    const handler = serviceDispatcher(services, "/api", {
        live: {
            touches: {
                addTodo: async (list) => {
                    await sleep(100);
                    log.push("touches ran");
                    return [{ name: "todos", args: [list] }];
                },
            },
            public: true,
        },
    });
    await served(handler, async (api) => {
        await post(api, "addTodo", ["home", "Bread"]);
        log.push("answered");
        await sleep(150);
    });
    log; // → ["answered", "touches ran"]
    ```

  - `handler.invalidate(targets)` is for changes that do not come through a service, and
    `handler.invalidateAccess(who)` re-asks `authorize` about a caller's subscriptions at once,
    whatever `recheckMs` is: `recheckMs` paces only the re-check before a patch, and 0 turns that one
    off. (With `recheckMs: 0`, `invalidateAccess` used to ask nothing, and a revocation silently did
    nothing.)

    ```js
    const handler = serviceDispatcher(services, "/api", {
        live: { queries: ["todos"], public: true },
    });
    await served(handler, async (api) => {
        const stream = await openStream(api);
        await subscribe(api, stream.client, "todos", ["home"]);
        await stream.next();
        lists.home.push("Bread");
        await handler.invalidate([{ name: "todos", args: ["home"] }]);
        (await stream.next()).set; // → [["", ["Milk", "Eggs", "Bread"]]]
    });
    ```

    ```js
    const sessions = new Map([["s1", "ada"]]);
    const handler = serviceDispatcher(services, "/api", {
        context: (req) => ({ session: req.headers.cookie }),
        live: {
            queries: ["todos"],
            recheckMs: 0,
            identify() {
                return sessions.get(this.session) ?? null;
            },
            authorize() {
                return sessions.has(this.session);
            },
        },
    });
    await served(handler, async (api) => {
        const headers = { cookie: "s1" };
        const stream = await openStream(api, { headers });
        await subscribe(api, stream.client, "todos", ["home"], headers);
        await stream.next();
        sessions.delete("s1");
        await handler.invalidateAccess("ada"); // → 1
        await stream.next(); // → { key: 'todos:["home"]', error: "not allowed" }
    });
    ```

- **`forms: { allow, maxBody = 16384, redirect }`** is the no-JavaScript path, built on `invoke`: a
  form-encoded POST to a name in `allow` (any other is JSON-only, 415) is taken only when its Origin,
  or its Referer when a browser sends no Origin, names the host it was sent to (403 otherwise,
  nothing run), with a body of at most `maxBody` bytes (413, the connection closed with it); an upload that ends before its body
  does (a tab closed mid-send) runs nothing and is answered 400 if anyone is left to answer (it used
  to reject out of the dispatcher, into the host's 500); the fields as one object the service's
  one argument, the request's context its `this`.

  The form examples share one dispatcher, built by `formsDispatcher(forms)`, and
  `sendForm(api, name, body, origin)` posts a form as a browser does, from the dispatcher's own
  origin unless `origin` names another:

  ```js setup
  const added = [];
  const todoForms = {
      async addItem({ list, title }) {
          if (!title) {
              throw Object.assign(new Error("Give the todo a title."), {
                  expose: true,
                  field: "title",
              });
          }
          added.push(`${this.user}: ${title} (${list})`);
          return added.length;
      },
      async archive() {},
  };
  const formsDispatcher = (forms) =>
      serviceDispatcher(todoForms, "/api", {
          context: (req) => ({ user: req.headers["x-user"] ?? "guest" }),
          forms: {
              allow: ["addItem"],
              redirect: (name, { ok }) => (ok ? "/todos" : "/todos?failed=1"),
              ...forms,
          },
      });
  const sendForm = (api, name, body, origin) =>
      fetch(`${api}/${name}`, {
          method: "POST",
          redirect: "manual",
          headers: {
              "content-type": "application/x-www-form-urlencoded",
              origin: origin ?? new URL(api).origin,
              "x-user": "ada",
          },
          body,
      });
  ```

  ```js
  await served(formsDispatcher(), async (api) => {
      const answer = await sendForm(api, "addItem", "list=home&title=Bread");
      answer.status; // → 303
      answer.headers.get("location"); // → "/todos"
  });
  added; // → ["ada: Bread (home)"]
  ```

  ```js
  await served(formsDispatcher(), async (api) => {
      const elsewhere = "https://forms.example";
      (await sendForm(api, "addItem", "title=Bread", elsewhere)).status; // → 403
      (await sendForm(api, "archive", "list=home")).status; // → 415
      (await sendForm(api, "addItem", `title=${"a".repeat(20_000)}`)).status;
      // → 413
  });
  added; // → []
  ```

  ```js
  await served(formsDispatcher(), async (api) => {
      const tab = http.request(`${api}/addItem`, {
          method: "POST",
          headers: {
              "content-type": "application/x-www-form-urlencoded",
              origin: new URL(api).origin,
              "content-length": 1000,
          },
      });
      tab.on("error", () => {});
      tab.write("list=home&title=Br");
      await sleep(20);
      tab.destroy();
      await sleep(20);
  });
  added; // → []
  ```

  - The answer is a 303 to `redirect(name, { ok,
    status, message, fields?, result?, req })`, where `message` is the refusal's words when
    `exposeError` lets a caller read them and `null` otherwise, and a location that is not a path on
    this site fails the request instead of sending a browser elsewhere.

    ```js
    const told = [];
    const redirect = (name, { ok, status, message, fields, result }) => {
        told.push({ ok, status, message, fields, result });
        return ok ? "/todos" : "/todos/new?error=title";
    };
    await served(formsDispatcher({ redirect }), async (api) => {
        await sendForm(api, "addItem", "list=home&title=Bread");
        const refused = await sendForm(api, "addItem", "list=home&title=");
        refused.headers.get("location"); // → "/todos/new?error=title"
    });
    told;
    // → [{ ok: true, status: 200, message: null, fields: undefined, result: 1 },
    //    { ok: false, status: 400, message: "Give the todo a title.",
    //      fields: { title: "Give the todo a title." }, result: undefined }]
    ```

    ```js
    const redirect = () => "//todos.example/thanks";
    await served(formsDispatcher({ redirect }), async (api) => {
        (await sendForm(api, "addItem", "list=home&title=Bread")).status;
        // → 500
    });
    ```

  - What is on this site is
    decided by the URL parser the browser will use, which drops tabs and newlines and reads `\` as
    `/`: a location must start with a single `/` and stay on the site it is resolved against.

    ```js
    const redirect = () => "/\\todos.example/thanks";
    await served(formsDispatcher({ redirect }), async (api) => {
        (await sendForm(api, "addItem", "list=home&title=Bread")).status;
        // → 500
    });
    ```

  - A
    touches entry that fails is reported to `onError` (`live.touches`), never to the caller.

    ```js
    const errors = [];
    const handler = serviceDispatcher(todoForms, "/api", {
        forms: { allow: ["addItem"], redirect: () => "/todos" },
        live: {
            touches: {
                addItem: () => {
                    throw new Error("no list given");
                },
            },
            public: true,
        },
        onError: (error, where) => errors.push(`${where}: ${error.message}`),
    });
    await served(handler, async (api) => {
        (await sendForm(api, "addItem", "list=home&title=Bread")).status;
        // → 303
        await sleep(0);
    });
    errors; // → ["live.touches: no list given"]
    ```

- **`ALL`** is every page: `{ name: "$pages" }`, the page cache's `EVERYTHING`, which re-runs no
  live query and crosses a bus as it always has.

  ```js
  import { EVERYTHING } from "juris-kit/server/page-cache.js";

  ALL; // → { name: "$pages" }
  ALL.name === EVERYTHING; // → true
  ```

  ```js
  let runs = 0;
  const counted = {
      async todos(list) {
          runs += 1;
          return [...lists[list]];
      },
  };
  const published = [];
  const handler = serviceDispatcher(counted, "/api", {
      live: {
          queries: ["todos"],
          public: true,
          bus: { publish: async (targets) => published.push(targets) },
      },
  });
  await served(handler, async (api) => {
      const stream = await openStream(api);
      await subscribe(api, stream.client, "todos", ["home"]);
      await handler.invalidate([ALL]);
  });
  runs; // → 1
  published; // → [[{ name: "$pages" }]]
  ```

  - A `touches` entry may be `ALL`, and a service in
    `flushAll` invalidates it once it succeeds, beside its own `touches`.

    ```js
    const heard = [];
    const site = {
        ...services,
        async setTheme() {},
        async renameList() {},
    };
    const handler = serviceDispatcher(site, "/api", {
        strict: { flushAll: ["renameList"] },
        live: {
            queries: ["todos"],
            touches: { addTodo: ["todos"], setTheme: ALL, renameList: ["todos"] },
            public: true,
            onInvalidate: (targets) => heard.push(targets),
        },
    });
    await handler.invoke("setTheme", ["dark"]);
    await handler.invoke("renameList", ["home", "House"]);
    await sleep(0);
    heard; // → [[{ name: "$pages" }], ["todos", { name: "$pages" }]]
    ```

- **A client id** it never minted, or minted for another owner, is refused on the stream and on a
  subscribe with 403 `{ error: "unknown or foreign client id", code: "live.client-unknown" }`, the
  words unchanged for a browser from before the code.

  ```js
  const handler = serviceDispatcher(services, "/api", {
      live: { queries: ["todos"], public: true },
  });
  await served(handler, async (api) => {
      const made = "6c0d2c4e-made-up";
      await openStream(api, { client: made });
      // → { status: 403, body: { error: "unknown or foreign client id",
      //     code: "live.client-unknown" } }
      (await subscribe(api, made, "todos", ["home"])).status; // → 403
  });
  ```

  ```js
  const handler = serviceDispatcher(services, "/api", {
      live: {
          queries: ["todos"],
          public: true,
          identify: ({ req }) => req.headers.cookie ?? null,
      },
  });
  await served(handler, async (api) => {
      const ada = await openStream(api, { headers: { cookie: "session=ada" } });
      const grace = { cookie: "session=grace" };
      (await openStream(api, { client: ada.client, headers: grace })).status;
      // → 403
      (await subscribe(api, ada.client, "todos", ["home"], grace)).body.code;
      // → "live.client-unknown"
  });
  ```

Three things about the dispatcher that an app has to know:

- **A subscribe's context outlives its request.** The context `options.context(req, res)` builds
  for a subscribe is kept, and every re-check of that subscription hands it to `authorize` again,
  long after the response was sent.

  ```js
  const checks = [];
  const handler = serviceDispatcher(services, "/api", {
      context: (req) => ({ session: req.headers.cookie }),
      live: {
          queries: ["todos"],
          recheckMs: 50,
          authorize(name, args, info) {
              checks.push([this.session, info.recheck ?? false]);
              return true;
          },
      },
  });
  await served(handler, async (api) => {
      const stream = await openStream(api);
      const headers = { cookie: "s1" };
      await subscribe(api, stream.client, "todos", ["home"], headers);
      await stream.next();
      await sleep(60);
      lists.home.push("Bread");
      await handler.invalidate(["todos"]);
      await stream.next();
  });
  checks[0]; // → ["s1", false]
  checks.at(-1); // → ["s1", true]
  ```

  - So it holds what identifies the caller and resolves it each
    time it is asked: a viewer memoised on it would pass every re-check, and a signed-out session
    would keep receiving patches.

    ```js
    const sessions = new Map([["s1", "ada"]]);
    const afterSignOut = async (list, { context, authorize }) => {
        const handler = serviceDispatcher(services, "/api", {
            context,
            live: { queries: ["todos"], recheckMs: 50, authorize },
        });
        return served(handler, async (api) => {
            const stream = await openStream(api);
            const headers = { cookie: "s1" };
            await subscribe(api, stream.client, "todos", [list], headers);
            await stream.next();
            sessions.delete("s1");
            await sleep(60);
            lists[list].push("Bread");
            await handler.invalidate(["todos"]);
            sessions.set("s1", "ada"); // signed in again, for the next run
            return stream.next();
        });
    };
    await afterSignOut("home", {
        context: (req) => ({ token: req.headers.cookie }),
        authorize() {
            return sessions.has(this.token);
        },
    });
    // → { key: 'todos:["home"]', error: "not allowed" }
    await afterSignOut("work", {
        context: (req) => ({ viewer: sessions.get(req.headers.cookie) }),
        authorize() {
            return Boolean(this.viewer);
        },
    });
    // → { key: 'todos:["work"]', set: [["", ["Report", "Bread"]]], del: [] }
    ```

  - And it does not close over the response, which has ended by then:
    a header written through it throws, and the kept context holds that response in memory for as
    long as the subscription lives.

    ```js
    const errors = [];
    const handler = serviceDispatcher(services, "/api", {
        context: (req, res) => ({ res }),
        live: {
            queries: ["todos"],
            recheckMs: 50,
            authorize() {
                this.res.setHeader("x-checked", "yes");
                return true;
            },
        },
        onError: (error, where) => errors.push(`${where}: ${error.message}`),
    });
    await served(handler, async (api) => {
        const stream = await openStream(api);
        await subscribe(api, stream.client, "todos", ["home"]);
        await stream.next();
        await sleep(60);
        lists.home.push("Bread");
        await handler.invalidate(["todos"]);
        await stream.next(); // → { key: 'todos:["home"]', error: "not allowed" }
    });
    errors;
    // → ["live.authorize: Cannot set headers after they are sent to the client"]
    ```

- **Who is calling.** A service reads its caller from `this`, and every call the framework makes
  says what kind of call it is, under `CALL_KIND` (`live-protocol.js`), a symbol nothing a request
  carries can set: `"direct"` for a request (a JSON POST, the event stream, a subscribe, and the
  `authorize`, `identify` and `touches` functions they run), `"preload"` for a server render's
  preload, `"live"` for a live query's run, `"render"` for a call a server render makes that nobody
  preloaded (only without `requirePreload`), and `"internal"` for the server's own work, a job that
  calls a service with `internal(reason)`.

  ```js
  import { callKind, internal } from "juris/live-protocol.js";

  const kinds = [];
  const watched = {
      async todos(list) {
          kinds.push(callKind(this));
          return [...lists[list]];
      },
  };
  const handler = serviceDispatcher(watched, "/api", {
      live: { queries: ["todos"], public: true },
  });
  await served(handler, async (api) => {
      await post(api, "todos", ["home"]);
      const stream = await openStream(api);
      await subscribe(api, stream.client, "todos", ["home"]);
      await handler.invoke("todos", ["home"], internal("nightly export"));
  });
  kinds; // → ["direct", "live", "internal"]
  ```

  ```js
  import Juris from "juris/juris.js";
  import SSRRenderer from "juris-kit/server/ssr-renderer.js";
  import { callKind } from "juris/live-protocol.js";

  const kinds = [];
  const juris = new Juris({
      services: {
          async todos() {
              kinds.push(callKind(this));
              return ["Milk"];
          },
      },
      features: { ssr: SSRRenderer },
  });
  await juris.preload([["todos"]]);
  await juris.api.call("todos");
  kinds; // → ["preload", "render"]
  ```

  - `callKind(thisValue)` reads it, and answers `"direct"` for
    anything that does not say, so a call that does not say what it is counts as a stranger's.

    ```js
    import { callKind, internal, CALL_KIND } from "juris/live-protocol.js";

    callKind(internal("weekly digest")); // → "internal"
    callKind(undefined); // → "direct"
    callKind({ user: "ada" }); // → "direct"
    callKind({ [CALL_KIND]: "admin" }); // → "direct"
    ```

  - A
    request's context is the one `options.context(req, res)` built, marked by the dispatcher whatever
    it says about itself (in place when it can be, behind a wrapper that inherits its fields when it is
    frozen or claims another kind); with none, or one that returns nothing, the dispatcher's own.

    ```js
    import { callKind, CALL_KIND } from "juris/live-protocol.js";

    const account = {
        async whoAmI() {
            return `${callKind(this)} ${this.user ?? "nobody"}`;
        },
    };
    const contexts = {
        plain: () => ({ user: "ada" }),
        frozen: () => Object.freeze({ user: "ada" }),
        claiming: () => ({ user: "ada", [CALL_KIND]: "internal" }),
        none: () => undefined,
    };
    for (const [name, context] of Object.entries(contexts)) {
        const handler = serviceDispatcher(account, "/api", { context });
        await served(handler, async (api) => {
            contexts[name] = (await post(api, "whoAmI", [])).body;
        });
    }
    contexts;
    // → { plain: "direct ada", frozen: "direct ada", claiming: "direct ada",
    //     none: "direct nobody" }
    ```

  - The
    framework's own contexts are frozen and carry nothing but the kind (and an internal call's
    `reason`), so nothing a service reads from one names a caller.

    ```js
    import { internal } from "juris/live-protocol.js";

    const seen = [];
    const watched = {
        async todos(list) {
            seen.push([Object.isFrozen(this), Reflect.ownKeys(this).length]);
            return [...lists[list]];
        },
    };
    const handler = serviceDispatcher(watched, "/api", {
        live: { queries: ["todos"], public: true },
    });
    await served(handler, async (api) => {
        const stream = await openStream(api);
        await subscribe(api, stream.client, "todos", ["home"]);
    });
    seen; // → [[true, 1]]
    Object.keys(internal("weekly digest")); // → ["reason"]
    ```

  - An app that passes the viewer as an argument, so that a live query stays a pure function of its
    arguments, trusts that argument on `"preload"` (the server chose it, from the session) and
    `"live"` (`authorize` matched it to the session with a request's context) alone.
    `juris-tests/tests/juris/live-protocol.test.mjs`,
    `juris-tests/tests/juris/juris.calls.test.mjs`,
    `juris-tests/tests/juris-kit/service-dispatcher.calls.test.mjs`,
    `juris-tests/tests/juris-kit/service-dispatcher.forms.test.mjs` and
    `juris-tests/tests/juris-kit/service-dispatcher.live.test.mjs` hold every path to its kind.

    ```js
    import { callKind } from "juris/live-protocol.js";
    import { fail } from "juris/errors.js";

    const myTodos = {
        async myTodos(viewer) {
            if (!["preload", "live"].includes(callKind(this))) {
                fail("Not for a direct call.", { status: 403 });
            }
            return [`${viewer}'s todos`];
        },
    };
    const handler = serviceDispatcher(myTodos, "/api", {
        context: (req) => ({ viewer: req.headers.cookie }),
        live: {
            queries: ["myTodos"],
            authorize(name, [viewer]) {
                return viewer === this.viewer;
            },
        },
    });
    await served(handler, async (api) => {
        const ada = { cookie: "ada" };
        const grace = { cookie: "grace" };
        await post(api, "myTodos", ["ada"], ada);
        // → { status: 403, body: { error: "Not for a direct call." } }
        const { client, next } = await openStream(api);
        (await subscribe(api, client, "myTodos", ["ada"], grace)).status; // → 403
        await subscribe(api, client, "myTodos", ["ada"], ada);
        await next(); // → { key: 'myTodos:["ada"]', full: ["ada's todos"] }
    });
    ```

- **What an invalidation names.** A target, in `touches` or in `handler.invalidate(targets)`, is a
  query name or `{ name }` (every group of that query), `{ name, args }` (the groups whose
  arguments match position by position, compared as strings), `{ name, where: { … } }` (the groups
  whose first argument has those fields), or `{ name, where: (args) => … }`.

  ```js
  const runs = [];
  const counted = {
      async todos(list, page) {
          runs.push(`${list} ${page}`);
          return [...lists[list]];
      },
  };
  const handler = serviceDispatcher(counted, "/api", {
      live: { queries: ["todos"], public: true },
  });
  const rerun = async (targets) => {
      runs.length = 0;
      await handler.invalidate(targets);
      return [...runs].sort();
  };
  await served(handler, async (api) => {
      const { client } = await openStream(api);
      await subscribe(api, client, "todos", ["home", 1]);
      await subscribe(api, client, "todos", ["home", 2]);
      await subscribe(api, client, "todos", ["work", 1]);
      await rerun(["todos"]); // → ["home 1", "home 2", "work 1"]
      await rerun([{ name: "todos", args: ["home"] }]); // → ["home 1", "home 2"]
      await rerun([{ name: "todos", args: ["home", "2"] }]); // → ["home 2"]
      await rerun([{ name: "todos", where: ([list, page]) => page > 1 }]);
      // → ["home 2"]
  });
  ```

  ```js
  const runs = [];
  const search = {
      async todosOf(filter) {
          runs.push(`${filter.owner}/${filter.list}`);
          return [...lists[filter.list]];
      },
  };
  const handler = serviceDispatcher(search, "/api", {
      live: { queries: ["todosOf"], public: true },
  });
  await served(handler, async (api) => {
      const { client } = await openStream(api);
      await subscribe(api, client, "todosOf", [{ owner: "ada", list: "home" }]);
      await subscribe(api, client, "todosOf", [{ owner: "grace", list: "home" }]);
      runs.length = 0;
      await handler.invalidate([{ name: "todosOf", where: { owner: "ada" } }]);
  });
  runs; // → ["ada/home"]
  ```

  - All but the last are
    data and cross a bus to the other instances.

    ```js
    const published = [];
    const handler = serviceDispatcher(services, "/api", {
        live: {
            queries: ["todos"],
            public: true,
            bus: { publish: async (targets) => published.push(targets) },
        },
    });
    await handler.invalidate([
        "todos",
        { name: "todos", args: ["home"] },
        { name: "todos", where: { list: "home" } },
        { name: "todos", where: ([list]) => list === "home" },
    ]);
    published;
    // → [["todos", { name: "todos", args: ["home"] },
    //     { name: "todos", where: { list: "home" } }]]
    handler.stats().bus.unpublishable; // → 1
    ```

  - An `undefined` slot in `args` matches any argument
    on the instance that invalidates, but not after a bus: JSON carries it as `null`.

    ```js
    const runs = [];
    const counted = {
        async todos(list, page) {
            runs.push(`${list} ${page}`);
            return [...lists[list]];
        },
    };
    const handler = serviceDispatcher(counted, "/api", {
        live: { queries: ["todos"], public: true },
    });
    const target = { name: "todos", args: [undefined, 2] };
    await served(handler, async (api) => {
        const { client } = await openStream(api);
        await subscribe(api, client, "todos", ["home", 2]);
        runs.length = 0;
        await handler.invalidate([target]);
        runs; // → ["home 2"]
        runs.length = 0;
        await handler.invalidate([JSON.parse(JSON.stringify(target))]);
        runs; // → []
    });
    JSON.stringify(target); // → '{"name":"todos","args":[null,2]}'
    ```

#### `server/http.js`

**Exports:** `parseCookies`, `serializeCookie`, `appendSetCookie`, `clientIp`, `onThisSite`,
`readBody`, `drainBody`, `refuseMethod`, `CACHE_CONTROL`, `pack`, `notModified`, `send`,
`sendFile`.

The examples on this page import every export, serve a listener with `withServer(listener,
visit)`, which hands `visit` the address and always closes the server, and send a todo list's
export, `todos.csv`, written to a temporary directory:

```js setup
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    parseCookies,
    serializeCookie,
    appendSetCookie,
    clientIp,
    onThisSite,
    readBody,
    drainBody,
    refuseMethod,
    CACHE_CONTROL,
    pack,
    notModified,
    send,
    sendFile,
} from "juris-kit/server/http.js";

async function withServer(listener, visit) {
    const host = http.createServer(listener);
    await new Promise((resolve) => host.listen(0, "127.0.0.1", resolve));
    try {
        return await visit(`http://127.0.0.1:${host.address().port}`);
    } finally {
        host.closeAllConnections();
        await new Promise((resolve) => host.close(resolve));
    }
}

const folder = mkdtempSync(join(tmpdir(), "exports-"));
const csv = join(folder, "todos.csv");
writeFileSync(csv, "id,title\n1,Milk\n2,Eggs\n");
process.on("exit", () => rmSync(folder, { recursive: true, force: true }));
```

The HTTP pieces a server writes around its pages and services, from Node's own modules only; what a
deployment decides is passed in.

```js
import { readFile } from "node:fs/promises";

const module = import.meta.resolve("juris-kit/server/http.js");
const source = await readFile(new URL(module), "utf8");
[...source.matchAll(/^import .* from "(.*)";$/gm)].map((match) => match[1]);
// → ["node:zlib", "node:crypto", "node:fs", "node:fs/promises", "node:stream"]
```

```js
const behindProxy = {
    socket: { remoteAddress: "10.0.0.2" },
    headers: { "x-forwarded-for": "203.0.113.7" },
};
clientIp(behindProxy); // → "10.0.0.2"
clientIp(behindProxy, { trustProxy: true }); // → "203.0.113.7"
```

- `parseCookies(header)` answers every cookie it can read, in an object with no prototype, and skips
  one it cannot decode (or a part with no name) instead of throwing: the header carries every cookie
  any site on the domain set, and one malformed `%`-escape must not fail every request from that
  browser.

  ```js
  const header = "session=s1; cart=milk%2Ceggs; tracker=%E0%A4%A; =x";
  const cookies = parseCookies(header);
  cookies; // → { session: "s1", cart: "milk,eggs" }
  Object.getPrototypeOf(cookies); // → null
  parseCookies("__proto__=dark").__proto__; // → "dark"
  parseCookies(undefined); // → {}
  ```

- `serializeCookie(name, value, { path, httpOnly, sameSite, secure, expires, maxAge })` writes one
  Set-Cookie value with the value `%`-encoded and the attributes in a fixed order; given nothing it
  is `Path=/; HttpOnly; SameSite=Lax; Secure`, and a name that is not a token, a path with `;`,
  SameSite=None without Secure, a bad date or a fractional Max-Age throws rather than being written.

  ```js
  serializeCookie("session", "s1");
  // → "session=s1; Path=/; HttpOnly; SameSite=Lax; Secure"
  serializeCookie("cart", "milk; eggs", {
      path: "/shop",
      httpOnly: false,
      sameSite: "strict",
      expires: new Date(Date.UTC(2027, 0, 1)),
      maxAge: 3600,
  }).split("; ");
  // → ["cart=milk%3B%20eggs", "Path=/shop", "SameSite=Strict",
  //    "Expires=Fri, 01 Jan 2027 00:00:00 GMT", "Max-Age=3600", "Secure"]
  ```

  ```js
  serializeCookie("my session", "s1");
  // throws TypeError: serializeCookie: "my session" is not a cookie name
  serializeCookie("session", "s1", { path: "/; Domain=todos.example" });
  // throws TypeError: serializeCookie: "/; Domain=todos.example" is not a
  //   cookie path
  serializeCookie("session", "s1", { sameSite: "none", secure: false });
  // throws TypeError: serializeCookie: SameSite=None needs Secure
  ```

  ```js
  serializeCookie("session", "s1", { expires: new Date("next friday") });
  // throws TypeError: serializeCookie: expires must be a valid Date
  serializeCookie("session", "s1", { maxAge: 0.5 });
  // throws TypeError: serializeCookie: maxAge must be an integer number of
  //   seconds
  ```

  - `appendSetCookie(res, cookie)` adds one beside any already set.

    ```js
    const signIn = (req, res) => {
        appendSetCookie(res, serializeCookie("session", "s1"));
        appendSetCookie(res, serializeCookie("theme", "dark", { httpOnly: false }));
        res.end();
    };
    await withServer(signIn, async (url) => {
        (await fetch(url)).headers.getSetCookie();
        // → ["session=s1; Path=/; HttpOnly; SameSite=Lax; Secure",
        //    "theme=dark; Path=/; SameSite=Lax; Secure"]
    });
    ```

- `clientIp(req, { trustProxy })` is the socket's address unless a proxy is trusted, and then the
  right-most `X-Forwarded-For` entry (`{ hops: n }`: the n-th from the right), which the proxy wrote
  and the client cannot choose; behind one proxy that replaces the header with the address it saw,
  that is the same address a left-most read gives.

  ```js
  const req = {
      socket: { remoteAddress: "10.0.0.2" },
      headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.9" },
  };
  clientIp(req); // → "10.0.0.2"
  clientIp(req, { trustProxy: true }); // → "10.0.0.9"
  clientIp(req, { trustProxy: { hops: 2 } }); // → "203.0.113.7"
  ```

  ```js
  const replaced = {
      socket: { remoteAddress: "10.0.0.2" },
      headers: { "x-forwarded-for": "203.0.113.7" },
  };
  clientIp(replaced, { trustProxy: true }); // → "203.0.113.7"
  clientIp(replaced, { trustProxy: { hops: 0 } });
  // throws TypeError: clientIp: trustProxy.hops must be a whole number of proxies
  ```

- `onThisSite(location)` says whether a location that came with the request (a `to`, a `next`) is a
  path on this site, by the URL parser the browser will use: `/\t/elsewhere.example` and
  `/\\elsewhere.example` name another host and are refused, as is anything that is not a string
  starting with one `/`.

  ```js
  onThisSite("/todos?list=home"); // → true
  onThisSite("/\t/elsewhere.example"); // → false
  onThisSite("/\\elsewhere.example"); // → false
  onThisSite("//elsewhere.example"); // → false
  onThisSite("https://elsewhere.example/"); // → false
  onThisSite(["/todos"]); // → false
  ```

  - The dispatcher's form answers use it; so should a server's own redirects.

    ```js
    const signedIn = (req, res) => {
        const next = new URL(req.url, "http://x").searchParams.get("next");
        res.writeHead(302, { location: onThisSite(next) ? next : "/" });
        res.end();
    };
    await withServer(signedIn, async (url) => {
        const home = await fetch(`${url}/signin?next=/todos`, {
            redirect: "manual",
        });
        home.headers.get("location"); // → "/todos"
        const away = await fetch(`${url}/signin?next=/%5Celsewhere.example`, {
            redirect: "manual",
        });
        away.headers.get("location"); // → "/"
    });
    ```

- `drainBody(req, { idleMs = 1000, totalMs = 5000 })` reads and drops the rest of a body nobody will
  read, before a refusal is answered: a request refused part-way and closed at once leaves the client's
  remaining bytes to meet a closed socket, and the reset that answers them can take the answer down
  with it; left open unread, the connection is poisoned (the rest of the body is taken for the next
  request, which a proxy in front may send into it).

  ```js
  const upload = async (req, res) => {
      const body = await readBody(req, { limit: 1024 });
      if (body === null) {
          await drainBody(req);
          res.writeHead(413, { connection: "close" });
          return res.end("At most 1 KB.");
      }
      res.end(`${body.length} bytes`);
  };
  await withServer(upload, async (url) => {
      const big = await fetch(url, {
          method: "POST",
          body: "x".repeat(2_000_000),
      });
      big.status; // → 413
      await big.text(); // → "At most 1 KB."
  });
  ```

  - It resolves once the body has ended, or after
    `idleMs` without a piece or `totalMs` in all; the answer then goes with `connection: close`.

    ```js
    const refuse = async (req, res) => {
        const started = Date.now();
        await drainBody(req, { idleMs: 50, totalMs: 500 });
        res.writeHead(415, { connection: "close" });
        res.end(String(Date.now() - started >= 50));
    };
    await withServer(refuse, async (url) => {
        const stalled = http.request(url, {
            method: "POST",
            headers: { "content-length": 1000 },
        });
        stalled.write("list=home&title=");
        const answer = await new Promise((resolve) => {
            stalled.on("response", resolve);
        });
        answer.statusCode; // → 415
        answer.headers.connection; // → "close"
        stalled.destroy();
    });
    ```

  - The
    dispatcher does this for every refusal made before the body arrived whole; an app answering its own
    413 after `readBody` does the same.

    ```js
    import {
        serviceDispatcher,
    } from "juris-kit/server/service-dispatcher.js";

    const handler = serviceDispatcher({ addTodo: async () => 1 }, "/api", {
        maxBody: 1024,
    });
    await withServer(handler, async (url) => {
        const big = await fetch(`${url}/api/addTodo`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(["x".repeat(2_000_000)]),
        });
        big.status; // → 413
        big.headers.get("connection"); // → "close"
    });
    ```

- `readBody(req, { limit })` answers the body as a Buffer, or `null` once it passes the limit (a
  megabyte unless told), counted as it arrives.

  ```js
  const echo = async (req, res) => {
      const body = await readBody(req, { limit: 64 });
      await drainBody(req);
      res.end(body === null ? "null" : `a Buffer of ${body.length} bytes`);
  };
  await withServer(echo, async (url) => {
      const small = await fetch(url, { method: "POST", body: "title=Milk" });
      await small.text(); // → "a Buffer of 10 bytes"
      const big = await fetch(url, { method: "POST", body: "x".repeat(100) });
      await big.text(); // → "null"
  });
  ```

- `refuseMethod(req, res, allow)` answers a method an address does not take, as RFC 9110 has it.
  `allow` is the methods it takes, GET and HEAD unless told. It answers `true` when it answered, and
  `false`, writing nothing, for a method in `allow`, which the caller then answers.
  `createJurisServer` asks it once for everything the kit serves itself (`server/kernel.js`), and
  the dispatcher for the live event stream.

  ```js
  const report = (req, res) => {
      if (refuseMethod(req, res)) return;
      res.end("2 todos, 1 done");
  };
  await withServer(report, async (url) => {
      await (await fetch(url)).text(); // → "2 todos, 1 done"
      (await fetch(url, { method: "HEAD" })).status; // → 200
  });
  ```

  - Any other method is a 405 with `Allow`, which every 405 carries (15.5.6), a sentence naming
    the methods, and `no-store`.

    ```js
    const report = (req, res) => {
        if (refuseMethod(req, res)) return;
        res.end("2 todos, 1 done");
    };
    await withServer(report, async (url) => {
        const deleted = await fetch(url, { method: "DELETE" });
        deleted.status; // → 405
        deleted.headers.get("allow"); // → "GET, HEAD"
        deleted.headers.get("cache-control"); // → "no-store"
        await deleted.text(); // → "This address takes GET, HEAD."
    });
    ```

  - An OPTIONS is a 204 with `Allow`, the header a successful OPTIONS sends (9.3.7), and no
    `Content-Length`, which a 204 never carries (8.6).

    ```js
    const report = (req, res) => {
        if (refuseMethod(req, res)) return;
        res.end("2 todos, 1 done");
    };
    await withServer(report, async (url) => {
        const options = await fetch(url, { method: "OPTIONS" });
        options.status; // → 204
        options.headers.get("allow"); // → "GET, HEAD"
        options.headers.get("content-length"); // → null
    });
    ```

  - `allow` names the methods an address takes, and an `allow` that is not a list of method
    names throws before anything is written.

    ```js
    const addTodo = (req, res) => {
        if (refuseMethod(req, res, ["POST"])) return;
        res.end("added");
    };
    await withServer(addTodo, async (url) => {
        const listed = await fetch(url);
        listed.status; // → 405
        listed.headers.get("allow"); // → "POST"
        await (await fetch(url, { method: "POST" })).text(); // → "added"
    });
    ```

    ```js
    refuseMethod({ method: "DELETE" }, {}, "GET");
    // throws TypeError: refuseMethod: allow is a list of method names
    ```

- `pack(text, { status, gzip })` gzips a body once (`gzip: false` keeps no gzip, `gz` is `null`,
  for bytes that are compressed already; `send` then answers with the bytes whatever the client
  accepts) and names it with a weak ETag from its length and the
  first 128 bits of its SHA-256, so one body has one tag on every instance and every Node, and a
  changed body a new one even at the same length.

  ```js
  const page = pack("<p>Milk</p>");
  page.status; // → 200
  page.etag; // → 'W/"b-ef7c4a83580e178e65aebe7ba89ecca8"'
  page.gz.length > 0; // → true
  pack("<p>Milk</p>").etag === page.etag; // → true
  pack("<p>Eggs</p>").etag === page.etag; // → false
  ```

  ```js
  const picture = pack(Buffer.from([0x89, 0x50, 0x4e, 0x47]), { gzip: false });
  picture.gz; // → null
  pack("Not found", { status: 404 }).status; // → 404
  ```

  - `send(req, res, entry, { type, cache, headers })` answers
    gzip or the bytes by Accept-Encoding, always with `Vary: Accept-Encoding`, and a 304 that repeats
    the ETag, Cache-Control and Vary, to a GET or a HEAD whose If-None-Match names the entry's ETag
    (`notModified`, below); `headers` are the caller's own, on both answers, and never replace the
    ones it writes.

    ```js
    const page = pack("<ul><li>Milk</li><li>Eggs</li></ul>");
    const listener = (req, res) =>
        send(req, res, page, { type: "text/html; charset=utf-8", cache: "public" });
    await withServer(listener, async (url) => {
        const plain = await fetch(url, {
            headers: { "accept-encoding": "identity" },
        });
        plain.headers.get("content-encoding"); // → null
        plain.headers.get("vary"); // → "Accept-Encoding"
        const zipped = await fetch(url, { headers: { "accept-encoding": "gzip" } });
        zipped.headers.get("content-encoding"); // → "gzip"
        await zipped.text(); // → "<ul><li>Milk</li><li>Eggs</li></ul>"
    });
    ```

    ```js
    const page = pack("<ul><li>Milk</li><li>Eggs</li></ul>");
    const listener = (req, res) =>
        send(req, res, page, {
            type: "text/html; charset=utf-8",
            cache: "public",
            headers: { "X-Frame-Options": "DENY", "Cache-Control": "max-age=3600" },
        });
    await withServer(listener, async (url) => {
        const again = await fetch(url, { headers: { "if-none-match": page.etag } });
        again.status; // → 304
        again.headers.get("etag") === page.etag; // → true
        again.headers.get("cache-control");
        // → "public, max-age=0, must-revalidate"
        again.headers.get("vary"); // → "Accept-Encoding"
        again.headers.get("x-frame-options"); // → "DENY"
    });
    ```

    ```js
    const picture = pack(Buffer.from([0x89, 0x50, 0x4e, 0x47]), { gzip: false });
    const listener = (req, res) => send(req, res, picture, { type: "image/png" });
    await withServer(listener, async (url) => {
        const answer = await fetch(url, { headers: { "accept-encoding": "gzip" } });
        answer.headers.get("content-encoding"); // → null
        (await answer.arrayBuffer()).byteLength; // → 4
    });
    ```

  - A 404 is never a 304, nor is an answer to any method but GET and HEAD: RFC 9110 has a server
    ignore the conditional headers when its answer would not be a 2xx, or for a method that selects
    no representation (13.2.1), and answer 304 to a GET or a HEAD alone (13.1.2).

    ```js
    const missing = pack("<h1>No such todo</h1>", { status: 404 });
    const listener = (req, res) =>
        send(req, res, missing, { type: "text/html; charset=utf-8" });
    await withServer(listener, async (url) => {
        const held = { "if-none-match": missing.etag };
        const again = await fetch(url, { headers: held });
        again.status; // → 404
        await again.text(); // → "<h1>No such todo</h1>"
    });
    ```

    ```js
    const page = pack("<ul><li>Milk</li></ul>");
    const listener = (req, res) => send(req, res, page, { type: "text/html" });
    await withServer(listener, async (url) => {
        const held = { "if-none-match": page.etag };
        (await fetch(url, { headers: held })).status; // → 304
        (await fetch(url, { method: "HEAD", headers: held })).status; // → 304
        (await fetch(url, { method: "POST", headers: held })).status; // → 200
    });
    ```

  - `notModified(req, { etag, status })` is that test, for an app's own answers: whether the
    request is a GET or a HEAD whose If-None-Match names `etag`, or is `*`, and the answer would be
    a 2xx (`status`, 200 unless told). It reads the header as RFC 9110 does: a list of tags, each
    compared weakly, `W/` aside (8.8.3.2), so a tag sent unmarked matches, and so does any tag of a
    list.

    ```js
    const etag = 'W/"7-todos"';
    const asking = (header) => ({
        method: "GET",
        headers: { "if-none-match": header },
    });
    notModified(asking('W/"7-todos"'), { etag }); // → true
    notModified(asking('"7-todos"'), { etag }); // → true
    notModified(asking('"6-todos", W/"7-todos"'), { etag }); // → true
    notModified(asking("*"), { etag }); // → true
    notModified(asking('W/"6-todos"'), { etag }); // → false
    ```

    ```js
    const etag = 'W/"7-todos"';
    const headers = { "if-none-match": etag };
    notModified({ method: "HEAD", headers }, { etag }); // → true
    notModified({ method: "POST", headers }, { etag }); // → false
    notModified({ method: "GET", headers }, { etag, status: 404 }); // → false
    ```

- `sendFile(req, res, path, { type, cache, size, headers })` streams a file with `Accept-Ranges`,
  and reads a Range header as RFC 9110 does: one byte range (`first-last`, `first-`, or `-N` for the
  last N bytes, the whole file when it is shorter) is 206 with those bytes, an end past the file
  clamped to it; a first at or past the end, a suffix of 0, or a last before its first is 416;
  anything else (another unit, several ranges, a malformed header) is ignored and the whole file
  sent, as RFC 9110 allows.

  ```js
  const listener = (req, res) => sendFile(req, res, csv, { type: "text/csv" });
  await withServer(listener, async (url) => {
      const range = (value) => fetch(url, { headers: { range: value } });
      const header = await range("bytes=0-8");
      header.status; // → 206
      header.headers.get("content-range"); // → "bytes 0-8/23"
      await header.text(); // → "id,title\n"
      await (await range("bytes=9-")).text(); // → "1,Milk\n2,Eggs\n"
      await (await range("bytes=-7")).text(); // → "2,Eggs\n"
      await (await range("bytes=16-999")).text(); // → "2,Eggs\n"
      await (await range("bytes=-500")).text(); // → "id,title\n1,Milk\n2,Eggs\n"
  });
  ```

  ```js
  const listener = (req, res) => sendFile(req, res, csv, { type: "text/csv" });
  await withServer(listener, async (url) => {
      const range = async (value) =>
          (await fetch(url, { headers: { range: value } })).status;
      await range("bytes=23-"); // → 416
      await range("bytes=-0"); // → 416
      await range("bytes=9-3"); // → 416
      const whole = await fetch(url);
      whole.headers.get("accept-ranges"); // → "bytes"
  });
  ```

  ```js
  const listener = (req, res) => sendFile(req, res, csv, { type: "text/csv" });
  await withServer(listener, async (url) => {
      const range = async (value) =>
          (await fetch(url, { headers: { range: value } })).status;
      await range("items=0-1"); // → 200
      await range("bytes=0-1,5-6"); // → 200
      await range("bytes=one-two"); // → 200
  });
  ```

  - The unit is matched in any case.

    ```js
    const listener = (req, res) => sendFile(req, res, csv, { type: "text/csv" });
    await withServer(listener, async (url) => {
        const answer = await fetch(url, { headers: { range: "BYTES=0-1" } });
        answer.status; // → 206
        await answer.text(); // → "id"
    });
    ```

  - A Range beside an If-Range is honoured only when the If-Range names the ETag the answer
    carries, by the strong comparison (RFC 9110, 13.1.5): otherwise the client's partial copy is of
    other bytes, and the whole file is sent. `sendFile` makes no ETag of its own, so only one given
    in `headers` can be named; a date or a weak tag never is.

    ```js
    const tagged = { etag: '"todos-v2"' };
    const listener = (req, res) =>
        sendFile(req, res, csv, { type: "text/csv", headers: tagged });
    await withServer(listener, async (url) => {
        const resume = (validator) => {
            const headers = { range: "bytes=9-", "if-range": validator };
            return fetch(url, { headers });
        };
        const current = await resume('"todos-v2"');
        current.status; // → 206
        await current.text(); // → "1,Milk\n2,Eggs\n"
        const stale = await resume('"todos-v1"');
        stale.status; // → 200
        await stale.text(); // → "id,title\n1,Milk\n2,Eggs\n"
    });
    ```

  - The file is read through
    `stream.pipeline`, so it is closed however the answer ends: a client that goes away mid-download
    (a video seeking cuts the download it no longer wants) no longer leaves the read stream, and its
    file descriptor, open until the process runs out of them.

    ```js
    import { readdirSync } from "node:fs";

    const video = join(folder, "tour.mp4");
    writeFileSync(video, Buffer.alloc(8_000_000));
    const openFiles = () => readdirSync("/dev/fd").length;
    const before = openFiles();
    const listener = (req, res) => sendFile(req, res, video, { type: "video/mp4" });
    await withServer(listener, async (url) => {
        const leaving = new AbortController();
        const download = await fetch(url, { signal: leaving.signal });
        await download.body.getReader().read();
        leaving.abort();
        await new Promise((resolve) => setTimeout(resolve, 50));
    });
    openFiles() === before; // → true
    ```

- `cache` names a policy in `CACHE_CONTROL` (`no-store`; `private`, `private, no-cache`; `public`,
  revalidated on every use; `immutable`, a year), `private` unless told, so a response nobody
  classified is never kept by a shared cache; a name not there throws before anything is written.

  ```js
  CACHE_CONTROL;
  // → { "no-store": "no-store",
  //     private: "private, no-cache",
  //     public: "public, max-age=0, must-revalidate",
  //     immutable: "public, max-age=31536000, immutable" }
  ```

  ```js
  const download = (req, res) =>
      sendFile(req, res, csv, {
          type: "text/csv",
          size: 23,
          headers: { "Content-Disposition": 'attachment; filename="todos.csv"' },
      });
  await withServer(download, async (url) => {
      const answer = await fetch(url);
      answer.headers.get("cache-control"); // → "private, no-cache"
      answer.headers.get("content-disposition");
      // → 'attachment; filename="todos.csv"'
      answer.headers.get("content-length"); // → "23"
  });
  ```

  ```js
  const written = [];
  const res = {
      writeHead: (status) => written.push(status),
      end: () => written.push("end"),
  };
  const page = pack("<p>Milk</p>");
  send({ headers: {} }, res, page, { type: "text/html", cache: "forever" });
  // throws TypeError: unknown cache policy "forever": one of no-store, private,
  //   public, immutable
  written; // → []
  ```

#### `server/modules.js`

**Exports:** `createModuleServer`, `listModules`.

The examples on this page serve an app in a fresh temporary directory, removed when the example
ends: `write` puts a file in it, `serve` makes a module server over it, and `get` shows what a
browser's GET gets, `handle` answering a stand-in response (or `false`, when the URL is not the
module server's).

```js setup
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    createModuleServer,
    listModules,
} from "juris-kit/server/modules.js";

const base = mkdtempSync(path.join(tmpdir(), "juris-"));
const root = path.join(base, "shop");
process.on("exit", () => rmSync(base, { recursive: true, force: true }));

function write(file, text) {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
}

const serve = (options) => createModuleServer({
    root,
    build: "2026-11-06",
    ...options,
});

async function get(modules, url, headers = {}) {
    const res = {
        writeHead(status, head) {
            this.status = status;
            this.headers = head;
        },
        end(body = "") {
            this.body = String(body);
        },
    };
    const target = new URL(url, "https://shop.example");
    const req = { method: "GET", headers };
    if (!(await modules.handle(req, res, target))) return false;
    return { status: res.status, headers: res.headers, body: res.body };
}
```

`createModuleServer({ root, dev, build, mounts, assets, rootFiles, static, minify })` serves an
app's browser modules with no build step, and is what keeps a rolling deploy from mixing builds. It
returns `{ handle(req, res, url), versioned(path), codeId, clear() }`. What is served is declared
once.

```js
write("app/cart.js", 'export const items = ["milk", "eggs"];\n');
const modules = await createModuleServer({
    root,
    build: "2026-11-06",
    mounts: [{ url: "/app/", dir: "app" }],
});
Object.keys(modules); // → ["handle", "versioned", "codeId", "clear"]
(await get(modules, "/app/cart.js")).body;
// → 'export const items = ["milk", "eggs"];'
```

```js
await createModuleServer({ root, mounts: [{ url: "/app/", dir: "app" }] });
// throws TypeError: createModuleServer: `build` names this deploy
```

- **Mounts.**
  - `mounts` is a list of `{ url, dir, depth, only }`: the files of `dir` (a path, relative to
    `root`, which may itself be a path or a `file:` URL) under the URL prefix `url`, `depth` levels of subdirectories down (0
    unless told), with the extensions in `only` (`[".js"]` unless told).

    ```js
    write("app/cart.js", "export const shipping = 5;\n");
    write("app/widgets/badge.js", "export const label = 'New';\n");
    const flat = await serve({ mounts: [{ url: "/app/", dir: "app" }] });
    (await get(flat, "/app/cart.js")).status; // → 200
    await get(flat, "/app/widgets/badge.js"); // → false
    const deep = await serve({
        mounts: [{ url: "/app/", dir: "app", depth: 1 }],
    });
    (await get(deep, "/app/widgets/badge.js")).status; // → 200
    ```

    ```js
    write("client/theme.css", "body { color: navy; }\n");
    const modules = await serve({
        root: pathToFileURL(`${root}/`),
        mounts: [{ url: "/client/", dir: "client", only: [".js", ".css"] }],
    });
    (await get(modules, "/client/theme.css")).body; // → "body{color:navy}"
    ```

  - Those are `.js`, a module, typed and import-stamped, and `.css`, a stylesheet, typed, and
    nothing else: any other extension, `.mjs` included, would be sent `text/plain`, which a
    browser will not run as a module, with an import of it left unstamped, so construction refuses
    it in a mount's `only` and in an asset alike.

    ```js
    write("app/cart.js", "export const shipping = 5;\n");
    write("app/theme.css", "body { color: navy; }\n");
    const modules = await serve({
        mounts: [{ url: "/app/", dir: "app", only: [".js", ".css"] }],
    });
    (await get(modules, "/app/cart.js")).headers["content-type"];
    // → "text/javascript; charset=utf-8"
    (await get(modules, "/app/theme.css")).headers["content-type"];
    // → "text/css; charset=utf-8"
    ```

    ```js
    await serve({ mounts: [{ url: "/app/", dir: "app", only: [".mjs"] }] });
    // throws TypeError: createModuleServer: mount "/app/": only is a list of
    //   the extensions a module is served with, ".css" or ".js"
    await serve({ assets: ["/boot.mjs"] });
    // throws TypeError: createModuleServer: asset /boot.mjs: an asset is
    //   served as a module is, with ".css" or ".js"
    ```

  - Names are plain (letters, digits, `_`, `-`), so no URL walks out of its directory.

    ```js
    write("app/cart.js", "export const shipping = 5;\n");
    const modules = await serve({ mounts: [{ url: "/app/", dir: "app" }] });
    await get(modules, "/app/..%2F..%2Fsecrets.js"); // → false
    await get(modules, "/app/cart.min.js"); // → false
    ```

  - A mount's `dir` is inside `root`, or construction refuses it, unless the mount says `outside:
    true`: for modules an app installs beside itself rather than in its own tree (plug-ins in a
    folder the installation owns, while the app is a package nothing writes to), whose `dir` may
    then be anywhere.

    ```js
    write("../plugins/loyalty.js", "export const points = 10;\n");
    await serve({ mounts: [{ url: "/plugins/", dir: "../plugins" }] });
    // throws TypeError: createModuleServer: mount "/plugins/": its dir is
    //   outside the root
    const modules = await serve({
        mounts: [{ url: "/plugins/", dir: "../plugins", outside: true }],
    });
    (await get(modules, "/plugins/loyalty.js")).body;
    // → "export const points = 10;"
    ```

  - The refusals about `src/` below hold for it all the same.

    ```js
    const framework = path.dirname(
        fileURLToPath(import.meta.resolve("juris")),
    );
    await serve({
        mounts: [{ url: "/vendor/", dir: framework, outside: true }],
    });
    // throws TypeError: createModuleServer: mount "/vendor/": its dir
    //   reaches the framework, which is served only flat, at /src/
    ```

  - Two mounts that would serve one URL (one under the other's URL, the outer deep enough to
    reach it, with an extension in common) are refused at construction, so a URL names one file,
    in development and production alike.

    ```js
    await serve({
        mounts: [
            { url: "/app/", dir: "app", depth: 1 },
            { url: "/app/widgets/", dir: "widgets" },
        ],
    });
    // throws TypeError: createModuleServer: mount "/app/widgets/": served
    //   twice (the mount /app/ reaches its URLs too)
    ```

    ```js
    write("widgets/badge.js", "export const label = 'New';\n");
    const modules = await serve({
        mounts: [
            { url: "/app/", dir: "app" },
            { url: "/app/widgets/", dir: "widgets" },
        ],
    });
    (await get(modules, "/app/widgets/badge.js")).body;
    // → "export const label = 'New';"
    ```

  - `assets` are single files served the same way, such as a stylesheet and the browser entry; one
    at a URL a mount also serves is refused at construction.

    ```js
    write("boot.js", "export function start() {}\n");
    write("theme.css", "body { color: navy; }\n");
    const modules = await serve({ assets: ["/boot.js", "/theme.css"] });
    (await get(modules, "/boot.js")).body; // → "export function start() {}"
    (await get(modules, "/theme.css")).headers["content-type"];
    // → "text/css; charset=utf-8"
    ```

    ```js
    await serve({
        mounts: [{ url: "/app/", dir: "app" }],
        assets: ["/app/boot.js"],
    });
    // throws TypeError: createModuleServer: asset /app/boot.js: a mount also
    //   serves that URL
    ```

- **The framework's own files.**
  - The flat `juris/*.js`, wherever it is installed, is always mounted at `/src/`, and
    never a subdirectory of it; the kit's own directory (its `server/`) is never served.

    ```js
    const modules = await serve({ dev: true });
    (await get(modules, "/src/juris.js")).status; // → 200
    await get(modules, "/src/plugins/forms.js"); // → false
    ```

    ```js
    const kit = path.dirname(fileURLToPath(
        import.meta.resolve("juris-kit/server/modules.js"),
    ));
    await serve({ mounts: [{ url: "/kit/", dir: kit, outside: true }] });
    // throws TypeError: createModuleServer: mount "/kit/": its dir reaches
    //   the framework
    ```

  - A mount inside either, or above one and deep enough to reach it, is refused at construction,
    as is a mount at `/src/`.

    ```js
    const framework = path.dirname(
        fileURLToPath(import.meta.resolve("juris")),
    );
    const above = path.dirname(framework);
    await serve({
        mounts: [{ url: "/lib/", dir: above, depth: 1, outside: true }],
    });
    // throws TypeError: createModuleServer: mount "/lib/": its dir reaches
    //   the framework
    ```

    ```js
    await serve({ mounts: [{ url: "/src/", dir: "src" }] });
    // throws TypeError: createModuleServer: mount "/src/": /src/ is the
    //   framework's, mounted flat by the module server itself
    ```

  - So is an asset or a root file whose file is inside either, by the file and not only by its
    URL: an app that vendors the framework has it somewhere other than `node_modules`
    (`<root>/lib/juris`, say), where a URL outside `/src/` could otherwise name Node-only code, or
    a flat framework file under a second URL.

    ```js
    const framework = path.dirname(
        fileURLToPath(import.meta.resolve("juris")),
    );
    const vendoring = { root: path.dirname(framework), dev: true };
    await serve({ ...vendoring, assets: ["/juris/juris.js"] });
    // throws TypeError: createModuleServer: asset /juris/juris.js: its file
    //   is the framework's, which is served only flat, at /src/
    await serve({
        ...vendoring,
        rootFiles: { "/sw.js": "juris/juris.js" },
    });
    // throws TypeError: createModuleServer: root file "/sw.js": its file is
    //   the framework's
    ```

- **The boot snapshot.** In production every file the mounts and assets name is read once, at
  construction, and served from memory: an instance started before a deploy changed the files goes
  on serving what it started with, including a file the deploy removed, and a file the checkout
  gained since is a 404 (`no-store`), never the next build's code stamped with this build's code
  id; `versioned` refuses such a file too.

  ```js
  write("app/cart.js", "export const shipping = 5;\n");
  const modules = await serve({ mounts: [{ url: "/app/", dir: "app" }] });
  write("app/cart.js", "export const shipping = 0;\n");
  (await get(modules, "/app/cart.js")).body; // → "export const shipping = 5;"
  rmSync(path.join(root, "app/cart.js"));
  (await get(modules, "/app/cart.js")).status; // → 200
  ```

  ```js
  write("app/cart.js", "export const shipping = 5;\n");
  const modules = await serve({ mounts: [{ url: "/app/", dir: "app" }] });
  write("app/coupon.js", "export const code = 'WELCOME';\n");
  const coupon = await get(modules, "/app/coupon.js");
  [coupon.status, coupon.headers["cache-control"]]; // → [404, "no-store"]
  await modules.versioned("/app/coupon.js");
  // throws Error: /app/coupon.js is not in the snapshot this server started
  //   with: the checkout gained it since
  ```

- **Root files.**
  - `rootFiles` maps a fixed URL to a file (`"/manifest.webmanifest":
    "public/manifest.webmanifest"`) or to `{ file, type, headers }` (`"/sw.js": { file:
    "public/sw.js", headers: { "service-worker-allowed": "/" } }`): files a browser finds by name,
    such as a service worker and a manifest, which live at the root so that their scope is the
    whole site.

    ```js
    write("public/manifest.webmanifest", '{ "name": "Shop" }\n');
    write("public/sw.js", "self.addEventListener('fetch', () => {});\n");
    const modules = await serve({
        rootFiles: {
            "/manifest.webmanifest": "public/manifest.webmanifest",
            "/sw.js": {
                file: "public/sw.js",
                headers: { "service-worker-allowed": "/" },
            },
        },
    });
    (await get(modules, "/manifest.webmanifest")).headers;
    // → { "content-type": "application/manifest+json",
    //     "cache-control": "no-cache" }
    (await get(modules, "/sw.js")).headers["service-worker-allowed"]; // → "/"
    ```

  - They are not modules: sent as they are on disk, never stamped or minified, with no `?v` and no
    part in the code id, always `no-cache`, typed by extension unless `type` says, with the headers
    given (never `content-type` or `cache-control`).

    ```js
    const worker = `// Offline cart, v3
    import { precache } from "./cache.js";
    precache(["/", "/cart"]);
    `;
    write("public/sw.js", worker);
    const rootFiles = { "/sw.js": "public/sw.js" };
    const modules = await serve({ rootFiles });
    (await get(modules, "/sw.js")).body === worker; // → true
    (await serve({})).codeId === modules.codeId; // → true
    ```

    ```js
    write("public/app-links.json", '{ "applinks": {} }\n');
    const modules = await serve({
        rootFiles: {
            "/.well-known/apple-app-site-association": {
                file: "public/app-links.json",
                type: "application/json",
            },
        },
    });
    const links = "/.well-known/apple-app-site-association";
    (await get(modules, links)).headers["content-type"];
    // → "application/json"
    ```

    ```js
    await serve({
        rootFiles: {
            "/sw.js": {
                file: "public/sw.js",
                headers: { "Cache-Control": "max-age=3600" },
            },
        },
    });
    // throws TypeError: createModuleServer: root file "/sw.js": Cache-Control
    //   is not the app's to set
    ```

  - Production snapshots them with the modules, since they change what an installed app does, and
    one missing at start refuses construction.

    ```js
    write("public/sw.js", "// v3\n");
    const modules = await serve({ rootFiles: { "/sw.js": "public/sw.js" } });
    write("public/sw.js", "// v4\n");
    (await get(modules, "/sw.js")).body; // → "// v3\n"
    ```

    ```js
    await serve({ rootFiles: { "/sw.js": "public/sw.js" } });
    // throws Error: ENOENT: no such file or directory
    ```

  - A URL a mount or asset also serves is refused.

    ```js
    await serve({
        assets: ["/boot.js"],
        rootFiles: { "/boot.js": "public/boot.js" },
    });
    // throws TypeError: createModuleServer: root file "/boot.js": a mount or
    //   an asset also serves that URL
    ```

- **Static files.**
  - `static` is what a site serves that is not its code, such as fonts, pictures and a library
    vendored byte for byte: `{ url, dir, depth, only }` serves a directory's files with those
    extensions (`only` is required), as a mount does, and `{ url, file }` one file at one URL;

    ```js
    write("fonts/inter.woff2", "wOF2…");
    write("public/logo.svg", "<svg></svg>");
    const modules = await serve({
        static: [
            { url: "/fonts/", dir: "fonts", only: [".woff2"] },
            { url: "/logo.svg", file: "public/logo.svg" },
        ],
    });
    (await get(modules, "/fonts/inter.woff2")).headers["content-type"];
    // → "font/woff2"
    (await get(modules, "/logo.svg")).body; // → "<svg></svg>"
    ```

    ```js
    await serve({ static: [{ url: "/fonts/", dir: "fonts" }] });
    // throws TypeError: createModuleServer: static "/fonts/": only is a list
    //   of extensions such as ".woff2"
    ```

  - each says how long a browser may keep it, `immutable: true` for a name that changes whenever
    the file does (a font's, a vendored folder that carries its version), or `maxAge` in seconds
    (0, revalidated on every use, unless told).

    ```js
    write("fonts/inter-4.1.woff2", "wOF2…");
    write("public/logo.svg", "<svg></svg>");
    write("public/banner.svg", "<svg></svg>");
    const modules = await serve({
        static: [
            { url: "/fonts/", dir: "fonts", only: [".woff2"], immutable: true },
            { url: "/banner.svg", file: "public/banner.svg", maxAge: 3600 },
            { url: "/logo.svg", file: "public/logo.svg" },
        ],
    });
    const cacheOf = async (url) => (await get(modules, url))
        .headers["cache-control"];
    await cacheOf("/fonts/inter-4.1.woff2");
    // → "public, max-age=31536000, immutable"
    await cacheOf("/banner.svg"); // → "public, max-age=3600"
    await cacheOf("/logo.svg"); // → "public, max-age=0, must-revalidate"
    ```

  - Names may carry dots but start with a letter, a digit, `_` or `-`.

    ```js
    write("vendor/chart-4.1.0/chart.umd.js", "/* Chart.js */\n");
    write("vendor/.cache.js", "secret\n");
    const modules = await serve({
        static: [{ url: "/vendor/", dir: "vendor", depth: 1, only: [".js"] }],
    });
    (await get(modules, "/vendor/chart-4.1.0/chart.umd.js")).status;
    // → 200
    await get(modules, "/vendor/.cache.js"); // → false
    ```

  - A static file goes out as it is on disk, never stamped or minified, typed by its extension
    unless `type` says (an extension with no known type and no `type` is refused);

    ```js
    const chart = '/* Chart.js 4.1.0 */\nimport "./helpers.js";\n';
    write("vendor/chart.js", chart);
    const modules = await serve({
        static: [{ url: "/vendor/chart.js", file: "vendor/chart.js" }],
    });
    (await get(modules, "/vendor/chart.js")).body === chart; // → true
    ```

    ```js
    write("data/stores.geojson", '{ "type": "FeatureCollection" }');
    const stores = { url: "/stores.geojson", file: "data/stores.geojson" };
    await serve({ static: [stores] });
    // throws TypeError: createModuleServer: static "/stores.geojson": say its
    //   type; .geojson names none
    const modules = await serve({
        static: [{ ...stores, type: "application/geo+json" }],
    });
    (await get(modules, "/stores.geojson")).headers["content-type"];
    // → "application/geo+json"
    ```

  - text is gzipped for a browser that asks and varies by encoding, while a font or a picture goes
    one way (and is never gzipped at all: it was, on its first request, which stalled the event
    loop and kept it twice);

    ```js
    write("public/logo.svg", "<svg></svg>");
    write("public/photo.png", "\x89PNG…");
    const modules = await serve({
        static: [
            { url: "/logo.svg", file: "public/logo.svg" },
            { url: "/photo.png", file: "public/photo.png" },
        ],
    });
    const gzip = { "accept-encoding": "gzip, br" };
    const logo = await get(modules, "/logo.svg", gzip);
    logo.headers["content-encoding"]; // → "gzip"
    logo.headers.vary; // → "Accept-Encoding"
    const photo = await get(modules, "/photo.png", gzip);
    [photo.headers["content-encoding"], photo.headers.vary];
    // → [undefined, undefined]
    ```

  - its ETag names its bytes, and a 304, the answer to a GET or a HEAD whose If-None-Match names it
    (by `send`'s rule, `notModified`), repeats the ETag and Cache-Control.

    ```js
    write("public/logo.svg", "<svg></svg>");
    const modules = await serve({
        static: [{ url: "/logo.svg", file: "public/logo.svg", maxAge: 60 }],
    });
    const { etag } = (await get(modules, "/logo.svg")).headers;
    const again = await get(modules, "/logo.svg", { "if-none-match": etag });
    again.status; // → 304
    again.headers.etag === etag; // → true
    again.headers["cache-control"]; // → "public, max-age=60"
    ```

  - Static files are not modules: no `?v`, no part in the code id, and not in the snapshot:
    production reads each the first time it is asked for and keeps it (so mid-roll an instance may
    serve the new checkout's copy, which a versioned name makes harmless), and development reads
    the disk every time; a declared name with no file behind it is a 404.

    ```js
    write("public/logo.svg", "<svg>old</svg>");
    const logo = { url: "/logo.svg", file: "public/logo.svg" };
    const modules = await serve({ static: [logo] });
    (await serve({})).codeId === modules.codeId; // → true
    write("public/logo.svg", "<svg>new</svg>");
    (await get(modules, "/logo.svg")).body; // → "<svg>new</svg>"
    write("public/logo.svg", "<svg>newer</svg>");
    (await get(modules, "/logo.svg")).body; // → "<svg>new</svg>"
    ```

    ```js
    write("public/logo.svg", "<svg>old</svg>");
    const logo = { url: "/logo.svg", file: "public/logo.svg" };
    const modules = await serve({ dev: true, static: [logo] });
    (await get(modules, "/logo.svg")).body; // → "<svg>old</svg>"
    write("public/logo.svg", "<svg>new</svg>");
    (await get(modules, "/logo.svg")).body; // → "<svg>new</svg>"
    const banner = { url: "/banner.svg", file: "public/banner.svg" };
    const missing = await get(await serve({ static: [banner] }), "/banner.svg");
    missing.status; // → 404
    ```

  - Construction refuses an entry that is malformed, outside the root, under `/src/` or reaching
    `src/`, or that would answer a URL a mount, an asset, a root file or another entry answers.

    ```js
    await serve({ static: [{ url: "/fonts", dir: "fonts", only: [".woff2"] }] });
    // throws TypeError: createModuleServer: static "/fonts": a url is a path
    //   of plain names that starts with "/", and ends with "/"
    await serve({ static: [{ url: "/logo.svg", file: "../logo.svg" }] });
    // throws TypeError: createModuleServer: static "/logo.svg": its file is
    //   outside the root
    await serve({ static: [{ url: "/src/logo.svg", file: "logo.svg" }] });
    // throws TypeError: createModuleServer: static "/src/logo.svg": /src/ is
    //   the framework's
    ```

    ```js
    await serve({
        mounts: [{ url: "/app/", dir: "app" }],
        static: [{ url: "/app/", dir: "public", only: [".svg"] }],
    });
    // throws TypeError: createModuleServer: static /app/: a module mount
    //   (/app/) also serves under it
    await serve({
        static: [
            { url: "/logo.svg", file: "public/logo.svg" },
            { url: "/logo.svg", file: "public/logo-dark.svg" },
        ],
    });
    // throws TypeError: createModuleServer: static /logo.svg: served twice
    ```

- **The code id and the stamps.**
  - `codeId` is a hash of the snapshot, `build` and the transform (the module server's own
    version, which moves with any change to its stamper or the framework's minifier, and whether
    production minifies and with what: a custom minifier by its functions' source text), so a URL
    changes exactly when the bytes served under it can: a server upgraded under the same build and
    files once served new bytes under URLs browsers had kept as immutable for a year.

    ```js
    write("app/cart.js", "export const shipping = 5;\n");
    const mounts = [{ url: "/app/", dir: "app" }];
    const first = await serve({ build: "v41", mounts });
    first.codeId.length; // → 10
    (await serve({ build: "v41", mounts })).codeId === first.codeId; // → true
    (await serve({ build: "v42", mounts })).codeId === first.codeId; // → false
    const plain = await serve({ build: "v41", mounts, minify: false });
    plain.codeId === first.codeId; // → false
    ```

    ```js
    write("app/cart.js", "export const shipping = 5;\n");
    const mounts = [{ url: "/app/", dir: "app" }];
    const before = await serve({ mounts });
    write("app/cart.js", "export const shipping = 0;\n");
    (await serve({ mounts })).codeId === before.codeId; // → false
    ```

  - A custom minifier whose source text stays the same while its behaviour changes (a wrapper
    around a library that was upgraded) needs a new `build`.

    ```js
    write("app/cart.js", "export const shipping = 5;\n");
    const mounts = [{ url: "/app/", dir: "app" }];
    const banner = (text) => ({ js: (code) => `${text}\n${code}` });
    const april = await serve({ mounts, minify: banner("// April") });
    const may = await serve({ mounts, minify: banner("// May") });
    april.codeId === may.codeId; // → true
    (await get(may, "/app/cart.js")).body;
    // → "// May\nexport const shipping = 5;\n"
    ```

  - `versioned(path)` is the path with `?v=<content hash>-<code id>`, for the tags an app writes
    itself.

    ```js
    write("app/boot.js", "export function start() {}\n");
    const modules = await serve({ mounts: [{ url: "/app/", dir: "app" }] });
    const href = await modules.versioned("/app/boot.js");
    href.replace(modules.codeId, "<code id>");
    // → "/app/boot.js?v=G_AG7z2s-<code id>"
    (await get(modules, href)).headers["cache-control"];
    // → "public, max-age=31536000, immutable"
    ```

    ```js
    const modules = await serve({ mounts: [{ url: "/app/", dir: "app" }] });
    await modules.versioned("/admin/boot.js");
    // throws TypeError: not a file this module server serves: /admin/boot.js
    ```

  - Every import a served module makes is stamped `?v=<code id>`: relative specifiers, and
    absolute ones under a mount or naming a module asset, in every form a browser follows (after
    `from` in an import or a re-export, in a side-effect `import "x"`, and as `import(…)`'s first
    argument, with options or without), however the source spaces them, so each module has one URL
    and one instance (one form left unstamped is a module loaded twice: a dynamic import of an
    absolute path once was).

    ```js
    write("app/checkout.js", [
        'import { total } from "./cart.js";',
        'export * from "/app/prices.js";',
        'import "./analytics.js";',
        'const receipt = await import ( "./receipt.js", { with: {} } );',
        'const Juris = await import("/src/juris.js");',
        'import { Chart } from "/vendor/chart.js";',
    ].join("\n"));
    const modules = await serve({
        dev: true,
        mounts: [{ url: "/app/", dir: "app" }],
    });
    const { body } = await get(modules, "/app/checkout.js");
    body.replaceAll(modules.codeId, "ID").split("\n");
    // → ['import { total } from "./cart.js?v=ID";',
    //    'export * from "/app/prices.js?v=ID";',
    //    'import "./analytics.js?v=ID";',
    //    'const receipt = await import ( "./receipt.js?v=ID", { with: {} } );',
    //    'const Juris = await import("/src/juris.js?v=ID");',
    //    'import { Chart } from "/vendor/chart.js";']
    ```

  - Only code is read (`jsTokens`, `server/minify.js`): a string, a comment, a regex or a template
    that spells an import is left as it is, and `import()`'s argument is stamped as a string or as
    a template with no substitution (`` import(`./b.js`) ``), which was left unstamped and loaded
    under a second URL.

    ```js
    write("app/help.js", [
        '// import "./old-help.js" is gone',
        "const tip = \"import './tips.js'\";",
        "const hint = /import \"\\.\\/x\\.js\"/;",
        "const faq = await import(`./faq.js`);",
    ].join("\n"));
    const modules = await serve({
        dev: true,
        mounts: [{ url: "/app/", dir: "app" }],
    });
    const { body } = await get(modules, "/app/help.js");
    body.replaceAll(modules.codeId, "ID").split("\n");
    // → ['// import "./old-help.js" is gone',
    //    "const tip = \"import './tips.js'\";",
    //    "const hint = /import \"\\.\\/x\\.js\"/;",
    //    "const faq = await import(`./faq.js?v=ID`);"]
    ```

  - An `import()` inside a template's substitution is stamped. Any other specifier that is not a
    literal cannot be stamped.

    ```js
    write("app/label.js", [
        'const label = `Total: ${(await import("./money.js")).format(5)}`;',
        "const page = await import(`./pages/${name}.js`);",
        "const report = await import(reportUrl);",
    ].join("\n"));
    const modules = await serve({
        dev: true,
        mounts: [{ url: "/app/", dir: "app" }],
    });
    const { body } = await get(modules, "/app/label.js");
    body.replaceAll(modules.codeId, "ID").split("\n");
    // → ['const label = `Total: ${(await import("./money.js?v=ID")).format(5)}`;',
    //    "const page = await import(`./pages/${name}.js`);",
    //    "const report = await import(reportUrl);"]
    ```

  - An asset imported this way gets the code id alone, not the URL `versioned` gives it, so the
    browser entry is loaded by the page and never imported.

    ```js
    write("boot.js", "export function start() {}\n");
    write("app/admin.js", 'import { start } from "/boot.js";\n');
    const modules = await serve({
        dev: true,
        assets: ["/boot.js"],
        mounts: [{ url: "/app/", dir: "app" }],
    });
    const { body } = await get(modules, "/app/admin.js");
    body.replace(modules.codeId, "ID");
    // → 'import { start } from "/boot.js?v=ID";\n'
    (await modules.versioned("/boot.js")).replace(modules.codeId, "ID");
    // → "/boot.js?v=G_AG7z2s-ID"
    ```

- **Serving.**
  - `handle(req, res, url)` answers a URL the mounts or assets name and returns `true`, and returns
    `false` for any other, which is the app's:

    ```js
    import http from "node:http";

    write("app/cart.js", "export const shipping = 5;\n");
    const modules = await serve({ mounts: [{ url: "/app/", dir: "app" }] });
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, "http://localhost");
        if (await modules.handle(req, res, url)) return;
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("the app's own page");
    });
    await new Promise((resolve) => server.listen(0, resolve));
    const site = `http://localhost:${server.address().port}`;
    try {
        await (await fetch(`${site}/app/cart.js`)).text();
        // → "export const shipping = 5;"
        await (await fetch(`${site}/about`)).text(); // → "the app's own page"
    } finally {
        server.closeAllConnections();
        server.close();
    }
    ```

  - a name with no file behind it is a 404 that says nothing else;

    ```js
    const modules = await serve({ mounts: [{ url: "/app/", dir: "app" }] });
    const missing = await get(modules, "/app/wishlist.js");
    [missing.status, missing.body]; // → [404, "not found"]
    ```

  - JS is stamped, and in production minified once per file (`minify: { js, css }`, the
    framework's minifier unless told, `false` for none);

    ```js
    const cart = `export function total(items) {
        // In cents.
        return items.reduce((sum, item) => sum + item.price, 0);
    }
    `;
    write("app/cart.js", cart);
    const mounts = [{ url: "/app/", dir: "app" }];
    (await get(await serve({ mounts }), "/app/cart.js")).body.split("\n");
    // → ["export function total(items) {",
    //    "return items.reduce((sum, item) => sum + item.price, 0);",
    //    "}"]
    const asWritten = await serve({ mounts, minify: false });
    (await get(asWritten, "/app/cart.js")).body === cart; // → true
    ```

    ```js
    write("app/cart.js", "export const shipping = 5;\n");
    let runs = 0;
    const modules = await serve({
        mounts: [{ url: "/app/", dir: "app" }],
        minify: {
            js: (code) => {
                runs += 1;
                return code.trim();
            },
        },
    });
    await get(modules, "/app/cart.js");
    await get(modules, "/app/cart.js?v=other");
    runs; // → 1
    ```

    ```js
    write("app/theme.css", "body {\n    color: navy;\n}\n");
    const modules = await serve({
        mounts: [{ url: "/app/", dir: "app", only: [".css"] }],
        minify: { css: (text) => `/* Shop */\n${text.trim()}` },
    });
    (await get(modules, "/app/theme.css")).body.split("\n");
    // → ["/* Shop */", "body {", "    color: navy;", "}"]
    ```

  - the answer is `immutable` only when `?v` names this process's own code id, `public`
    (revalidated on every use) under any other,

    ```js
    write("app/cart.js", "export const shipping = 5;\n");
    const modules = await serve({ mounts: [{ url: "/app/", dir: "app" }] });
    const ours = await get(modules, `/app/cart.js?v=${modules.codeId}`);
    ours.headers["cache-control"]; // → "public, max-age=31536000, immutable"
    const theirs = await get(modules, "/app/cart.js?v=LastBuild1");
    theirs.headers["cache-control"]; // → "public, max-age=0, must-revalidate"
    ```

  - and `no-store` in development, where nothing is snapshotted, minified or kept: every request
    reads the file from disk and stamps it again, so what a browser gets is what is on disk now.

    ```js
    write("app/cart.js", "// Shipping, in euros\nexport const shipping = 5;\n");
    const modules = await serve({
        dev: true,
        mounts: [{ url: "/app/", dir: "app" }],
    });
    const first = await get(modules, "/app/cart.js");
    first.headers["cache-control"]; // → "no-store"
    first.body; // → "// Shipping, in euros\nexport const shipping = 5;\n"
    write("app/cart.js", "export const shipping = 0;\n");
    (await get(modules, "/app/cart.js")).body; // → "export const shipping = 0;\n"
    ```

  - `clear()` forgets what production built, and in development has nothing to forget.

    ```js
    write("app/cart.js", "export const shipping = 5;\n");
    let runs = 0;
    const modules = await serve({
        mounts: [{ url: "/app/", dir: "app" }],
        minify: {
            js: (code) => {
                runs += 1;
                return code.trim();
            },
        },
    });
    await get(modules, "/app/cart.js");
    modules.clear();
    write("app/cart.js", "export const shipping = 0;\n");
    (await get(modules, "/app/cart.js")).body; // → "export const shipping = 5;"
    runs; // → 2
    ```

- `listModules({ root, mounts, assets })` lists every file the mounts and assets name, as
  `{ url, file }`, for an app's own checks (a test that minifies everything it serves).

  ```js
  write("app/cart.js", "export const shipping = 5;\n");
  write("app/widgets/badge.js", "export const label = 'New';\n");
  write("boot.js", "export function start() {}\n");
  const list = await listModules({
      root,
      mounts: [{ url: "/app/", dir: "app", depth: 1 }],
      assets: ["/boot.js"],
  });
  list
      .filter(({ url }) => !url.startsWith("/src/"))
      .map(({ url, file }) => [url, path.relative(root, file)]);
  // → [["/app/cart.js", "app/cart.js"],
  //    ["/app/widgets/badge.js", "app/widgets/badge.js"],
  //    ["/boot.js", "boot.js"]]
  list.some(({ url }) => url === "/src/juris.js"); // → true
  ```

  ```js
  import { readFile } from "node:fs/promises";
  import {
      jsTokens,
      minifyJs,
  } from "juris-kit/server/minify.js";

  const strings = (code) => jsTokens(code)
      .filter((token) => token.type === "string")
      .map((token) => token.text)
      .join("\n");
  const changed = [];
  for (const { url, file } of await listModules({ root })) {
      const source = await readFile(file, "utf8");
      if (strings(minifyJs(source)) !== strings(source)) changed.push(url);
  }
  changed; // → []
  ```

#### `server/ssr-renderer.js`

**Exports:** `SSRRenderer` (default), `escapeText`, `escapeAttribute`.

The examples on this page share a server instance given the string renderer.

```js setup
import Juris from "juris/juris.js";
import SSRRenderer, {
    escapeAttribute,
    escapeText,
} from "juris-kit/server/ssr-renderer.js";

const juris = new Juris({ isServer: true, features: { ssr: SSRRenderer } });
```

`renderToString` with an optional trace of what the render depended on: the string renderer, kept
in the kit so that no browser downloads it.

```js
juris.setValue("cart", { count: 2 });
juris.renderToString(
    { p: { textContent: () => `${juris.getState("cart.count")} items` } },
    null,
    { trace: true },
);
// → <p>2 items</p>
const { reactive, roots, static: unchanging } = juris.renderTrace();
[reactive, roots, unchanging]; // → [1, ["cart"], false]
```

It is installed as the instance's `features.ssr` (`new Juris({ isServer: true, features: { ssr:
SSRRenderer } })`): constructed with the instance, it installs itself as `juris.ssrRenderer`,
through which the core's `renderToString`, `renderRequest`, `renderTrace` and `markRender` draw and
trace ("`juris.js`", "Rendering to a string"), and `new SSRRenderer(juris)` installs it on an
instance already made.

```js
juris.ssrRenderer instanceof SSRRenderer; // → true
juris.renderToString({ h1: "Shop" }); // → <h1>Shop</h1>
const page = await juris.renderRequest({
    layout: {
        footer: () => {
            juris.markRender("clock");
            return `© ${new Date().getFullYear()} Shop`;
        },
    },
    trace: true,
});
page.trace.flags; // → ["clock"]
```

```js
const bare = new Juris({ isServer: true });
bare.renderToString({ h1: "Shop" });
// throws TypeError: Juris.renderToString: rendering to a string is the kit's
new SSRRenderer(bare);
bare.renderToString({ h1: "Shop" }); // → <h1>Shop</h1>
```

The kit's server does that for its own instance (`createJurisServer`); an app or a test that builds
a server instance itself, for `createPagePipeline`, gives it the feature too.

```js
import { createRouter } from "juris/router.js";
import { createPagePipeline } from "juris-kit/server/kernel.js";

const router = createRouter({
    routes: [{ path: "/", name: "home", component: "Home" }],
});
juris.use(router);
juris.registerComponent("App", () => ({
    main: { children: [{ RouterView: {} }] },
}));
juris.registerComponent("Home", () => ({ h1: "Shop" }));
const pipeline = createPagePipeline({ juris, router, entry: "/boot.js" });
const page = await pipeline.render("/");
/<div id="app">.*<\/div>/.exec(String(page.body))[0];
// → <div id="app"><main><h1 data-key="route-0">Shop</h1></main></div>
```

```js
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJurisServer } from "juris-kit/server/kernel.js";

const root = mkdtempSync(path.join(tmpdir(), "shop-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
writeFileSync(path.join(root, "boot.js"), "export function start() {}\n");
let renderer = null;
const server = await createJurisServer({
    root,
    build: "2026-11-06",
    services: {},
    routes: [],
    modules: { assets: ["/boot.js"], entry: "/boot.js" },
    setup: (instance) => {
        renderer = instance.ssrRenderer;
    },
});
renderer instanceof SSRRenderer; // → true
await server.close();
```

`escapeText` escapes `&`, `<` and `>`, and `escapeAttribute` escapes both quotes as well, so its
output is safe in a single- or double-quoted attribute; the document writer uses the same two.

```js
escapeText(`Fish & "chips" <hot>`);
// → 'Fish &amp; "chips" &lt;hot&gt;'
escapeAttribute(`Fish & "chips" <Bob's>`);
// → "Fish &amp; &quot;chips&quot; &lt;Bob&#39;s&gt;"
```

```js
import { renderDocument } from "juris-kit/server/document.js";

const title = `Fish & "chips" <hot>`;
const html = renderDocument({}, { title, entry: "/boot.js" });
html.includes(`<title>${escapeText(title)}</title>`); // → true
```

An HTML `<style>` (drawn only with `allowTags: ["style"]`) writes its text as given, the
CSS the parser reads raw, and is left out when the text contains `</style`, or, inside a
`<noscript>` or a `<select>` at any depth, any `<`: there the parser may read the text as markup (a
`<noscript>` holds text up to `</noscript` when scripting is on, and the parsers of the browser
floor ignore a `<style>` inside a `<select>`).

```js
juris.renderToString({ style: ".cart > li { color: navy; }" }); // → ""
const styled = new Juris({
    allowTags: ["style"],
    features: { ssr: SSRRenderer },
});
styled.renderToString({ style: ".cart > li { color: navy; }" });
// → <style>.cart > li { color: navy; }</style>
styled.renderToString({ style: "p {} </style><script>steal()</script>" });
// → ""
```

```js
const styled = new Juris({
    allowTags: ["style"],
    features: { ssr: SSRRenderer },
});
styled.renderToString({
    noscript: { children: [{ style: ".new::after { content: '<new>'; }" }] },
});
// → <noscript></noscript>
styled.renderToString({
    select: { children: [{ style: "option::before { content: '<'; }" }] },
});
// → <select></select>
styled.renderToString({
    noscript: { children: [{ style: ".js-only { display: none; }" }] },
});
// → <noscript><style>.js-only { display: none; }</style></noscript>
```

The rule is the server's: the client sets the text through the DOM, which no parser reads.

```js dom
const styled = new Juris({ allowTags: ["style"] });
const page = document.createElement("main");
styled.render(page, {
    noscript: { children: [{ style: ".new::after { content: '<new>'; }" }] },
});
page.querySelector("style").textContent;
// → ".new::after { content: '<new>'; }"
```

Inside `<svg>` a `<style>`'s text is ordinary text and is escaped.

```js
const styled = new Juris({
    allowTags: ["style"],
    features: { ssr: SSRRenderer },
});
styled.renderToString({
    svg: { children: [{ style: ".bar > rect { fill: navy; }" }] },
});
// → <svg><style>.bar &gt; rect { fill: navy; }</style></svg>
```

A `<script>` drawn with `allowTags: ["script"]` still has its text escaped ("Open").

```js
const scripted = new Juris({
    allowTags: ["script"],
    features: { ssr: SSRRenderer },
});
scripted.renderToString({ script: "if (total < 10) shipping = 5;" });
// → <script>if (total &lt; 10) shipping = 5;</script>
```

`<xmp>`, `<noembed>` and `<noframes>` are ordinary elements, their text escaped although the parser
reads theirs raw, so text holding `<` or `&` shows its references until the client draws it: raw, it
would not be safe inside a `<noscript>` or a `<select>`, where the parser does not read it as raw
text.

```js
juris.renderToString({ xmp: "<b>Fish & chips</b>" });
// → <xmp>&lt;b&gt;Fish &amp; chips&lt;/b&gt;</xmp>
```

In `devMode` each thing it leaves out is said through the instance's `refused(rule, reason, detail)`
("`juris.js`"), as the DOM renderer's is, with the same console line as before; a `<style>` whose
text is refused has no `rule` yet.

```js
const dev = new Juris({ devMode: true, features: { ssr: SSRRenderer } });
dev.renderToString({ a: { href: "javascript:steal()", textContent: "Pay" } });
// console.warn: Juris: dropped href refuses "javascript:steal()":
//   scheme not allowed
const said = [];
dev.refused = (rule, reason, detail) => said.push(detail.name);
dev.renderToString({ a: { href: "javascript:steal()", textContent: "Pay" } });
// → <a>Pay</a>
said; // → ["href"]
```

```js
const dev = new Juris({
    devMode: true,
    allowTags: ["style"],
    features: { ssr: SSRRenderer },
});
dev.renderToString({ style: "p {} </style>" }); // → ""
// console.warn: Juris: dropped <style>: its text contains </style, which
//   would end the element
const rules = [];
dev.refused = (rule) => rules.push(rule);
dev.renderToString({ style: "p {} </style>" });
rules; // → [null]
```

#### `server/document.js`

**Exports:** `renderDocument`, `inlineScriptHashes`.

The examples on this page share an entry URL, `headOf`, the lines of a document's head, and
`runLoader`, which runs a document's loader the way a browser would, given what it reads there (a
`data:` URL stands in for the entry's module).

```js setup
import {
    inlineScriptHashes,
    renderDocument,
} from "juris-kit/server/document.js";

const entry = "/app/boot.js";

const headOf = (html) => html
    .slice(html.indexOf("<head>\n") + 7, html.indexOf("\n</head>"))
    .split("\n");

function runLoader(html, browser) {
    const loader = /<script type="module">([^]*?)<\/script>/.exec(html)[1];
    new Function(...Object.keys(browser), loader)(...Object.values(browser));
}
```

`renderDocument({ html, json }, options)` writes the whole HTML document around a server-rendered
page: the doctype, `<html lang>` with the app's `htmlAttrs`, a head the app describes as data, the
body's markup in `#app`, the state as JSON in `#state`, the callable service names in `#services`
when given `serviceNames` (a list of strings), `#juris-dev` when given `jurisDev` (development's data
for the browser's devtools, a plain object, `{}` today; anything else is refused with a `TypeError`),
and a module script that, once the page has loaded and the browser is idle, imports `entry` and calls
its `start()` ("The page contract"; `rootId` and `stateId` rename the first two).

```js
const page = { html: "<h1>Panier</h1>", json: '{"cart":2}' };
const doc = renderDocument(page, {
    lang: "fr",
    htmlAttrs: { "data-theme": "dark" },
    title: "Panier",
    entry,
});
doc.split("\n").slice(0, 10);
// → ["<!doctype html>",
//    '<html lang="fr" data-theme="dark">',
//    "<head>",
//    '<meta charset="utf-8">',
//    '<meta name="viewport" content="width=device-width, initial-scale=1">',
//    "<title>Panier</title>",
//    "</head>",
//    "<body>",
//    '<div id="app"><h1>Panier</h1></div>',
//    '<script type="application/json" id="state">{"cart":2}</script>']
```

```js
const doc = renderDocument({ html: "<h1>Cart</h1>", json: '{"cart":2}' }, {
    entry,
    serviceNames: ["addToCart", "checkout"],
    jurisDev: {},
    rootId: "root",
    stateId: "data",
});
doc.split("\n").slice(8, 12);
// → ['<div id="root"><h1>Cart</h1></div>',
//    '<script type="application/json" id="data">{"cart":2}</script>',
//    '<script type="application/json" id="services">["addToCart","checkout"]'
//    + "</script>",
//    '<script type="application/json" id="juris-dev">{}</script>']
renderDocument({}, { entry, jurisDev: true });
// throws TypeError: renderDocument: jurisDev is the page's development data
renderDocument({}, { title: "Cart" });
// throws TypeError: renderDocument: entry, the URL of the browser entry, is
//   required
```

```js
const started = "data:text/javascript,export const start = () => "
    + "console.log('cart started')";
const doc = renderDocument({}, { entry: started });
let onLoad;
runLoader(doc, {
    document: { readyState: "loading" },
    addEventListener: (type, listener) => {
        onLoad = listener;
    },
    requestIdleCallback: (task) => task(),
});
onLoad();
await new Promise((resolve) => setTimeout(resolve, 10));
// console.log: cart started
```

- **The head** is written in a fixed order, and only what is given (but for `<title>`, which is
  always there, empty when no title is given): `<meta charset="utf-8">`,
  `viewport` (`width=device-width, initial-scale=1` unless told, `null` for none), `title`,
  `description`, `canonical`, `links` and `meta` (each an object of attributes, written in its own
  order; `true` is a bare attribute), `buildMeta: { name, content }` (the build that wrote the page,
  for a browser that asks whether the server has moved on), `preload` (`<link rel="preload">`),
  `styles` (`{ text }` an inline `<style>`, `{ href }` a stylesheet), and last `trustedHead`.

  ```js
  const doc = renderDocument({}, {
      entry,
      trustedHead: "<script>document.documentElement.dataset.js = 1</script>",
      styles: [{ href: "/theme.css" }, { text: "body { margin: 0; }" }],
      preload: [{ href: "/fonts/inter.woff2", as: "font", crossorigin: true }],
      buildMeta: { name: "build", content: "2026-11-06" },
      meta: [{ property: "og:title", content: "Cart" }],
      links: [{ rel: "icon", href: "/favicon.svg" }],
      canonical: "https://shop.example/cart",
      description: "Your cart",
      title: "Cart",
  });
  headOf(doc);
  // → ['<meta charset="utf-8">',
  //    '<meta name="viewport" content="width=device-width, initial-scale=1">',
  //    "<title>Cart</title>",
  //    '<meta name="description" content="Your cart">',
  //    '<link rel="canonical" href="https://shop.example/cart">',
  //    '<link rel="icon" href="/favicon.svg">',
  //    '<meta property="og:title" content="Cart">',
  //    '<meta name="build" content="2026-11-06">',
  //    '<link rel="preload" href="/fonts/inter.woff2" as="font" crossorigin>',
  //    '<link rel="stylesheet" href="/theme.css">',
  //    "<style>body { margin: 0; }</style>",
  //    "<script>document.documentElement.dataset.js = 1</script>"]
  ```

  ```js
  headOf(renderDocument({}, { entry, title: "Cart", viewport: null }));
  // → ['<meta charset="utf-8">', "<title>Cart</title>"]
  const zoomless = "width=device-width, initial-scale=1, maximum-scale=1";
  headOf(renderDocument({}, { entry, title: "Cart", viewport: zoomless }))[1];
  // → '<meta name="viewport" content="width=device-width, initial-scale=1, '
  //   + 'maximum-scale=1">'
  ```

  ```js
  const doc = renderDocument({}, {
      entry,
      title: "Cart",
      viewport: null,
      meta: [{ content: "noindex", name: "robots" }],
      links: [
          { rel: "preconnect", href: "https://cdn.example", crossorigin: true },
      ],
  });
  headOf(doc).slice(2);
  // → ['<link rel="preconnect" href="https://cdn.example" crossorigin>',
  //    '<meta content="noindex" name="robots">']
  ```

- **Every value is escaped** where it is written, with `server/ssr-renderer.js`'s `escapeText` and
  `escapeAttribute`, as the body is: a title is text, whoever wrote it.

  ```js
  const doc = renderDocument({}, {
      entry,
      viewport: null,
      title: "Tom & Jerry <3",
      description: 'The "best" cartoon',
  });
  headOf(doc).slice(1);
  // → ["<title>Tom &amp; Jerry &lt;3</title>",
  //    '<meta name="description" content="The &quot;best&quot; cartoon">']
  ```

  - `entry` is written as a JSON string with `<` escaped, and so is any `<` in the state, the
    service names and `jurisDev`.

    ```js
    const doc = renderDocument({ json: '{"note":"</script>"}' }, {
        entry: "/app/boot.js?</script>",
        serviceNames: ["</script>"],
        jurisDev: { note: "</script>" },
    });
    doc.split("\n").slice(9, 14);
    // → ['<script type="application/json" id="state">{"note":"\\u003c/script>"}'
    //    + "</script>",
    //    '<script type="application/json" id="services">["\\u003c/script>"]'
    //    + "</script>",
    //    '<script type="application/json" id="juris-dev">'
    //    + '{"note":"\\u003c/script>"}</script>',
    //    '<script type="module">',
    //    '  const boot = () => import("/app/boot.js?\\u003c/script>")'
    //    + ".then((m) => m.start());"]
    ```

  - `trustedHead` alone is written as given: markup, for the app's own inline scripts (one that
    sets the theme before the first paint), so nothing a request carries belongs in it.

    ```js
    const theme = `<script>
    document.documentElement.dataset.theme = localStorage.theme ?? "light";
    </script>`;
    renderDocument({}, { entry, trustedHead: theme }).includes(theme); // → true
    ```

- **What escaping cannot make safe throws** instead:
  - an attribute name `html-safety.js` refuses (`on…`, or anything that is not a name), a URL
    attribute whose scheme it refuses,

    ```js
    renderDocument({}, {
        entry,
        links: [{ rel: "icon", href: "/favicon.svg", onload: "steal()" }],
    });
    // throws Error: renderDocument: links: attribute name "onload" is not
    //   allowed
    renderDocument({}, {
        entry,
        canonical: "javascript:alert(document.cookie)",
    });
    // throws Error: renderDocument: canonical: href refuses
    ```

  - a `rel` on a preload or a stylesheet (the framework writes those), `</style` in a style's
    text,

    ```js
    renderDocument({}, {
        entry,
        preload: [{ rel: "prefetch", href: "/app/cart.js" }],
    });
    // throws Error: renderDocument: preload writes its own rel; leave it out
    renderDocument({}, {
        entry,
        styles: [{ href: "/dark.css", rel: "alternate stylesheet" }],
    });
    // throws Error: renderDocument: a stylesheet writes its own rel
    renderDocument({}, { entry, styles: [{ text: "p {} </style><p>" }] });
    // throws Error: renderDocument: a style's text contains </style
    ```

  - and `</script` or `<!--` in `devReload`, the development reload client's source, which goes in
    a script at the end of the body,

    ```js
    const reload = "new EventSource('/__reload')";
    renderDocument({}, { entry, devReload: reload }).split("\n").at(-3);
    // → "<script>new EventSource('/__reload')</script>"
    renderDocument({}, { entry, devReload: `${reload} // </script>` });
    // throws Error: renderDocument: devReload contains </script
    renderDocument({}, { entry, devReload: `${reload} // <!--` });
    // throws Error: renderDocument: devReload contains <!--
    ```

  - and a `<meta http-equiv="refresh">` whose URL part (after the delay, `;` or `,`, an optional
    `url=` and quote) has a scheme the URL rules refuse (`javascript:`, `vbscript:`, `data:`,
    anything unknown).

    ```js
    const refresh = (content) => renderDocument({}, {
        entry,
        meta: [{ "http-equiv": "refresh", content }],
    });
    refresh("5; url=/cart").includes('content="5; url=/cart"'); // → true
    refresh("0;URL='javascript:alert(1)'");
    // throws Error: renderDocument: meta: a refresh to "javascript:alert(1)":
    //   scheme not allowed
    refresh("0, data:text/html,<p>Win</p>");
    // throws Error: renderDocument: meta: a refresh to
    ```

- **The loader** uses `requestIdleCallback` only when it is a function (`typeof`), so an element
  with `id="requestIdleCallback"` cannot stand in for it where the browser has none.

  ```js
  const started = "data:text/javascript,export const start = () => "
      + "console.log('cart started')";
  const waits = [];
  runLoader(renderDocument({}, { entry: started }), {
      document: { readyState: "complete" },
      requestIdleCallback: { id: "requestIdleCallback", tagName: "DIV" },
      setTimeout: (task, ms) => {
          waits.push(ms);
          task();
      },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  // console.log: cart started
  waits; // → [1]
  ```

- `inlineScriptHashes(document)` answers the CSP source of every script the document runs inline
  (`'sha256-…'`, quoted as a policy writes it): the loader, and the reload client in development;
  never the JSON blocks, which run nothing.

  ```js
  import { createHash } from "node:crypto";

  const doc = renderDocument({ json: '{"cart":2}' }, {
      entry,
      serviceNames: ["addToCart"],
  });
  const hashes = inlineScriptHashes(doc);
  hashes.length; // → 1
  const loader = /<script type="module">([^]*?)<\/script>/.exec(doc)[1];
  const sha256 = createHash("sha256").update(loader).digest("base64");
  hashes[0] === `'sha256-${sha256}'`; // → true
  ```

  ```js
  const reload = "new EventSource('/__reload')";
  const doc = renderDocument({}, { entry, devReload: reload, jurisDev: {} });
  inlineScriptHashes(doc).length; // → 2
  ```

  A hash, not a nonce, because a page a cache shares is one set of bytes for every reader. The
  page pipeline's `headers` hook is given them.

  ```js
  import Juris from "juris/juris.js";
  import { createRouter } from "juris/router.js";
  import SSRRenderer from "juris-kit/server/ssr-renderer.js";
  import { createPagePipeline } from "juris-kit/server/kernel.js";

  const juris = new Juris({ isServer: true, features: { ssr: SSRRenderer } });
  const router = createRouter({
      routes: [{ path: "/", name: "home", component: "Home" }],
  });
  juris.use(router);
  juris.registerComponent("App", () => ({
      main: { children: [{ RouterView: {} }] },
  }));
  juris.registerComponent("Home", () => ({ h1: "Shop" }));
  const pipeline = createPagePipeline({
      juris,
      router,
      entry,
      headers: ({ scriptHashes }) => ({
          "content-security-policy": `script-src ${scriptHashes.join(" ")}`,
      }),
  });
  const page = await pipeline.render("/");
  const hashes = inlineScriptHashes(String(page.body));
  page.headers["content-security-policy"] === `script-src ${hashes[0]}`;
  // → true
  ```

#### `server/dev-reload.js`

**Exports:** `devReload`.

The examples on this page run against an app in a fresh temporary directory (`server/`, `app.mjs`,
`client/theme.css`), removed when the example ends, and watch it through a stand-in for `fs.watch`:
`watchers` are what is watched, and `change(dir, name)` plays a change the platform reports there.
`openPage` opens a page's stream, `runClient` runs the page's client against a stand-in
`EventSource`, and `quiet()` waits past the 150 ms a burst of changes is gathered for.

```js setup
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { devReload } from "juris-kit/server/dev-reload.js";

const root = mkdtempSync(path.join(tmpdir(), "shop-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
mkdirSync(path.join(root, "server"));
mkdirSync(path.join(root, "client"));
writeFileSync(path.join(root, "app.mjs"), "");
writeFileSync(path.join(root, "client/theme.css"), "");

const watchers = [];
function watch(dir, { recursive }, listener) {
    const watcher = new EventEmitter();
    Object.assign(watcher, { dir, recursive, listener, closed: false });
    watcher.close = () => {
        watcher.closed = true;
    };
    watchers.push(watcher);
    return watcher;
}
function change(dir, name) {
    for (const watcher of watchers) {
        if (watcher.dir === path.join(root, dir)) {
            watcher.listener("change", name);
        }
    }
}
const quiet = () => new Promise((resolve) => setTimeout(resolve, 200));

function openPage(reload) {
    const res = {
        text: "",
        ended: false,
        writeHead(status, headers) {
            this.status = status;
            this.headers = headers;
        },
        write(chunk) {
            this.text += chunk;
        },
        end() {
            this.ended = true;
        },
    };
    const url = new URL("http://localhost/__reload");
    reload.handle(new EventEmitter(), res, url);
    return res;
}

function runClient(script) {
    const page = { reloads: 0, source: null };
    class EventSource extends EventTarget {
        constructor(url) {
            super();
            this.url = url;
            page.source = this;
        }
    }
    const location = {
        reload: () => {
            page.reloads += 1;
        },
    };
    new Function("EventSource", "location", script)(EventSource, location);
    return page;
}
```

`devReload({ root, restartOn, reloadOn, onRestart, onReload, watch })` returns `{ script, handle,
close }`: in development, a server that restarts itself when code it runs changes, and reloads the
pages open on it when only what browsers load changed.

```js
const reload = devReload({
    root,
    restartOn: ["server", "app.mjs"],
    reloadOn: ["client/theme.css"],
    onRestart: (file) => console.log(`restart: ${file}`),
    onReload: (file) => console.log(`reload: ${file}`),
    watch,
});
Object.keys(reload); // → ["script", "handle", "close"]
change("server", "cart.js");
await quiet();
// console.log: restart: server/cart.js
reload.close();
```

- A server loads its code once, so the only reload that gives it new code is a new process, and the
  framework never touches `process`: `onRestart(file)` (required) is the app entry's, and starts the
  successor and lets this process go. It is called once; nothing this process hears after it
  counts.

  ```js
  devReload({ root, restartOn: ["server"], watch });
  // throws TypeError: devReload: `onRestart(file)` is required
  ```

  ```js
  const restarts = [];
  const reload = devReload({
      root,
      restartOn: ["server"],
      onRestart: (file) => restarts.push(file),
      watch,
  });
  change("server", "cart.js");
  await quiet();
  change("server", "orders.js");
  await quiet();
  restarts; // → ["server/cart.js"]
  reload.close();
  ```

- The framework's own directories (the `juris` package, wherever it is installed, and the kit's
  `server/`) are always watched, and so is whatever `restartOn` names;

  ```js
  const restarts = [];
  const reload = devReload({
      root,
      onRestart: (file) => restarts.push(file),
      watch,
  });
  const [framework, kit] = watchers;
  [path.basename(kit.dir), kit.recursive]; // → ["server", true]
  framework.listener("change", "router.js");
  await quiet();
  restarts[0] === path.join(framework.dir, "router.js"); // → true
  reload.close();
  ```

  `reloadOn` names what only browsers load (a stylesheet, the browser entry), and a change there
  runs `onReload(file, { clients })` first, for the app to move its build id and drop what it built
  from the old files, then tells every open page to reload.

  ```js
  let build = "b1";
  const reload = devReload({
      root,
      reloadOn: ["client/theme.css"],
      onRestart: () => {},
      onReload: (file, { clients }) => {
          build = `b2 (${file}, ${clients} open)`;
      },
      watch,
  });
  const page = openPage(reload);
  change("client", "theme.css");
  await quiet();
  build; // → "b2 (client/theme.css, 1 open)"
  page.text.endsWith("event: reload\ndata: 1\n\n"); // → true
  reload.close();
  ```

- Paths are relative to `root` (a path or a `file:` URL); one that does not exist, or is outside
  the root, is refused when the reloader is made, before anything is watched.

  ```js
  const onRestart = () => {};
  devReload({ root, restartOn: ["server", "jobs"], onRestart, watch });
  // throws TypeError: devReload: jobs in `restartOn` does not exist under
  //   the root
  devReload({ root, reloadOn: ["../theme.css"], onRestart, watch });
  // throws TypeError: devReload: ../theme.css in `reloadOn` is outside the
  //   root
  watchers.length; // → 0
  ```

  A directory is watched recursively, so a folder made in it later is covered; a file is watched
  through its directory, by name, so a save that writes a copy and renames it over the file counts
  every time.

  ```js
  const reload = devReload({
      root: pathToFileURL(root),
      restartOn: ["server", "app.mjs"],
      onRestart: () => {},
      watch,
  });
  watchers.slice(2).map((watcher) => [
      path.relative(root, watcher.dir) || ".",
      watcher.recursive,
  ]);
  // → [["server", true], [".", false]]
  reload.close();
  ```

  ```js
  const reloads = [];
  const reload = devReload({
      root,
      reloadOn: ["client/theme.css"],
      onRestart: () => {},
      onReload: (file) => reloads.push(file),
      watch,
  });
  const [client] = watchers.slice(2);
  client.listener("rename", "theme.css");
  await quiet();
  client.listener("rename", "theme.css.swp");
  client.listener("rename", "theme.css");
  await quiet();
  reloads; // → ["client/theme.css", "client/theme.css"]
  reload.close();
  ```

  Changes are gathered until 150 ms pass without one, and a burst that touched anything `restartOn`
  covers restarts, whatever else it touched and in whatever order. A watcher that fails counts as a
  change to what it watched.

  ```js
  const heard = [];
  const reload = devReload({
      root,
      restartOn: ["server"],
      reloadOn: ["client/theme.css"],
      onRestart: (file) => heard.push(`restart ${file}`),
      onReload: (file) => heard.push(`reload ${file}`),
      watch,
  });
  change("client", "theme.css");
  change("server", "cart.js");
  change("client", "theme.css");
  heard; // → []
  await quiet();
  heard; // → ["restart server/cart.js"]
  reload.close();
  ```

  ```js
  const restarts = [];
  const reload = devReload({
      root,
      restartOn: ["server"],
      onRestart: (file) => restarts.push(file),
      watch,
  });
  const server = watchers.find((w) => w.dir === path.join(root, "server"));
  server.emit("error", new Error("EMFILE: too many open files"));
  await quiet();
  restarts; // → ["server"]
  reload.close();
  ```

- `script` is the page's client, for `renderDocument`'s `devReload`: it listens at `/__reload`, a
  fixed path, and reloads on an explicit `reload` event, or when the `build` event it hears on
  connecting names another process than the one it heard first; each reloader names its own process
  with a random id, never the app's build, which an app may pin across a restart.

  ```js
  const reload = devReload({ root, onRestart: () => {}, watch });
  const page = runClient(reload.script);
  page.source.url; // → "/__reload"
  page.source.dispatchEvent(new Event("reload"));
  page.reloads; // → 1
  reload.close();
  ```

  ```js
  const before = devReload({ root, onRestart: () => {}, watch });
  const after = devReload({ root, onRestart: () => {}, watch });
  const idOf = (stream) => /data: (.+)/.exec(stream.text)[1];
  const page = runClient(before.script);
  const hear = (id) => page.source.dispatchEvent(
      Object.assign(new Event("build"), { data: id }),
  );
  hear(idOf(openPage(before)));
  hear(idOf(openPage(before)));
  page.reloads; // → 0
  hear(idOf(openPage(after)));
  page.reloads; // → 1
  before.close();
  after.close();
  ```

  - `handle(req, res, url)` answers `/__reload` with that event stream and returns `true`, and
    `false` for any other URL.

    ```js
    const reload = devReload({ root, onRestart: () => {}, watch });
    const stream = openPage(reload);
    stream.status; // → 200
    stream.headers["content-type"]; // → "text/event-stream"
    stream.text.split("\n").slice(0, 3); // → ["retry: 1000", "", "event: build"]
    const other = new URL("http://localhost/cart");
    reload.handle(new EventEmitter(), {}, other); // → false
    reload.close();
    ```

  - `close()` ends the open streams and stops watching.

    ```js
    const reload = devReload({ root, onRestart: () => {}, watch });
    const stream = openPage(reload);
    reload.close();
    stream.ended; // → true
    watchers.every((watcher) => watcher.closed); // → true
    ```

  - `watch` replaces `fs.watch`, for a test.

    ```js
    import { appendFileSync } from "node:fs";

    const reloads = [];
    const reload = devReload({
        root,
        reloadOn: ["client/theme.css"],
        onRestart: () => {},
        onReload: (file) => reloads.push(file),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    appendFileSync(path.join(root, "client/theme.css"), "body { margin: 0 }");
    await new Promise((resolve) => setTimeout(resolve, 400));
    reloads; // → ["client/theme.css"]
    reload.close();
    ```

#### `server/page-cache.js`

**Exports:** `decide`, `createPageCache`, `EVERYTHING`, `canonicalPath`, `pageCacheKey`.

The examples on this page share a server instance with two services, `products` and `stock` (which
fails), and two traced renders made on it: `about`, a page that reads nothing, and `shop`, a page
that reads its preloaded products. A cache's clock is `clock`, moved by hand.

```js setup
import Juris from "juris/juris.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";
import {
    EVERYTHING,
    canonicalPath,
    createPageCache,
    decide,
    pageCacheKey,
} from "juris-kit/server/page-cache.js";

const juris = new Juris({
    isServer: true,
    features: { ssr: SSRRenderer },
    services: {
        products: async () => [{ name: "Milk" }, { name: "Eggs" }],
        stock: async () => {
            throw new Error("the stock service is down");
        },
    },
});
juris.registerComponent("Products", (props, api) => ({
    ul: {
        children: () => api.preloaded("products").map((product) => ({
            li: product.name,
        })),
    },
}));

const about = await juris.renderRequest({
    layout: { h1: "About us" },
    trace: true,
});
const shop = await juris.renderRequest({
    preload: [["products"]],
    layout: { Products: {} },
    trace: true,
});
let clock = 0;
const now = () => clock;
```

The rendered-page cache, and the policy for what goes in it. It knows nothing of HTTP or a database,
and what it is told (who the viewer was, the status) is the app's to say.

```js
const cache = createPageCache();
cache.put("/shop", shop.html, shop.trace, { viewer: null, status: 200 });
// → { cache: true, reason: "dependent", forever: false,
//     services: ["products"] }
cache.get("/shop");
// → { entry: "<ul><li>Milk</li><li>Eggs</li></ul>", stale: false }
```

- `decide(trace, { viewer, unkeyedRoots, status })` reads a traced render (`renderRequest({ trace:
  true })`) and refuses

  ```js
  shop.html; // → <ul><li>Milk</li><li>Eggs</li></ul>
  shop.trace.services; // → ["products"]
  decide(shop.trace);
  // → { cache: true, reason: "dependent", forever: false,
  //     services: ["products"] }
  ```

  - a page rendered for a viewer, a 404,

    ```js
    decide(shop.trace, { viewer: { id: 7 } });
    // → { cache: false, reason: "personal" }
    decide(shop.trace, { status: 404 }); // → { cache: false, reason: "not-found" }
    ```

  - a render whose preloaded call failed (the trace's `failed`: that request's failure, not the
    page; `put` then leaves the page kept before it as it was and hands a stale page's replacement
    back),

    ```js
    juris.registerComponent("Stock", (props, api) => ({
        p: () => (api.preloaded("stock") === undefined
            ? "Stock unknown"
            : "In stock"),
    }));
    const failed = await juris.renderRequest({
        preload: [["stock"]],
        layout: { Stock: {} },
        trace: true,
    });
    failed.trace.failed; // → ["stock"]
    decide(failed.trace); // → { cache: false, reason: "failed:stock" }
    ```

    ```js
    const cache = createPageCache({ ttlMs: 60_000, now });
    cache.put("/shop", "<ul>…</ul>", shop.trace, {});
    clock = 61_000;
    cache.get("/shop"); // → { entry: "<ul>…</ul>", stale: true }
    const failing = { ...shop.trace, failed: ["products"] };
    cache.put("/shop", "<p>Try again</p>", failing, {});
    // → { cache: false, reason: "failed:products" }
    cache.get("/shop"); // → { entry: "<ul>…</ul>", stale: true }
    ```

  - a render that drew a component nobody registered (the trace's `unknown`: a page missing a
    part),

    ```js
    const missing = await juris.renderRequest({
        layout: { main: { children: [{ Basket: {} }] } },
        trace: true,
    });
    missing.html; // → <main><Basket></Basket></main>
    decide(missing.trace); // → { cache: false, reason: "unknown:Basket" }
    ```

  - a render a plugin flagged volatile,

    ```js
    const dated = await juris.renderRequest({
        layout: {
            footer: () => {
                juris.markRender("clock");
                return `© ${new Date().getFullYear()} Shop`;
            },
        },
        trace: true,
    });
    decide(dated.trace); // → { cache: false, reason: "volatile:clock" }
    ```

  - and one that read a state root the URL does not carry (`unkeyedRoots`).

    ```js
    const french = await juris.renderRequest({
        state: { locale: "fr" },
        layout: { p: () => (juris.getState("locale") === "fr" ? "Bonjour" : "Hi") },
        trace: true,
    });
    french.trace.roots; // → ["locale"]
    decide(french.trace, { unkeyedRoots: ["locale"] });
    // → { cache: false, reason: "request-state:locale" }
    ```

  A render in which no reactive function ran and nothing was called is kept until the cache is
  cleared; one that read preloaded data is kept until a change names one of its services, or until
  its TTL, after which it is served stale while one caller renders it again.

  ```js
  decide(about.trace);
  // → { cache: true, reason: "static", forever: true, services: [] }
  const cache = createPageCache({ ttlMs: 60_000, now });
  cache.put("/about", about.html, about.trace, {});
  cache.put("/shop", shop.html, shop.trace, {});
  cache.invalidate(["products"]);
  [cache.has("/about"), cache.has("/shop")]; // → [true, false]
  clock = 24 * 3_600_000;
  cache.get("/about").stale; // → false
  cache.clear();
  cache.has("/about"); // → false
  ```

  ```js
  const cache = createPageCache({ ttlMs: 60_000, now });
  cache.put("/shop", shop.html, shop.trace, {});
  clock = 61_000;
  cache.get("/shop").stale; // → true
  cache.get("/shop").stale; // → false
  cache.put("/shop", shop.html, shop.trace, {});
  cache.get("/shop").stale; // → false
  ```

- `createPageCache({ unkeyedRoots, ttlMs, staleMs, maxEntries, maxQueryEntries, invalidatable, onWarn,
  now })` holds the pages in a bounded LRU:

  ```js
  const cache = createPageCache({ maxEntries: 2 });
  cache.put("/about", about.html, about.trace, {});
  cache.put("/shop", shop.html, shop.trace, {});
  cache.get("/about");
  cache.put("/contact", about.html, about.trace, {});
  [cache.has("/about"), cache.has("/shop"), cache.has("/contact")];
  // → [true, false, true]
  ```

  ```js
  const cache = createPageCache({ ttlMs: 60_000, staleMs: 600_000, now });
  cache.put("/shop", shop.html, shop.trace, {});
  clock = 600_000;
  cache.get("/shop"); // → null
  const strict = createPageCache({ unkeyedRoots: ["session"] });
  const traced = { ...shop.trace, roots: ["session"] };
  strict.put("/shop", shop.html, traced, {});
  // → { cache: false, reason: "request-state:session" }
  ```

  ```js
  const warnings = [];
  const cache = createPageCache({
      invalidatable: new Set(["orders"]),
      onWarn: (message) => warnings.push(message),
  });
  cache.put("/shop", shop.html, shop.trace, {});
  warnings;
  // → ['page cache: pages depend on "products" but no mutation\'s touches '
  //   + "names it — they will only ever expire by TTL"]
  ```

  - take `snapshot()` before a render, and `put` refuses a page whose services were invalidated
    while it rendered, and any page, a static one too, rendered across an `EVERYTHING`
    invalidation or a `clear()`;

    ```js
    const cache = createPageCache();
    const before = cache.snapshot();
    cache.invalidate(["products"]);
    cache.put("/shop", shop.html, shop.trace, {}, before);
    // → { cache: false, reason: "raced", forever: false,
    //     services: ["products"] }
    cache.put("/about", about.html, about.trace, {}, before).cache; // → true
    ```

    ```js
    const cache = createPageCache();
    const before = cache.snapshot();
    cache.clear();
    cache.put("/about", about.html, about.trace, {}, before).reason;
    // → "raced"
    ```

  - `invalidate(targets)` takes the targets a change bus carries, and `EVERYTHING` (`"$pages"`) or
    a target it cannot read drops every page.

    ```js
    const cache = createPageCache();
    cache.put("/about", about.html, about.trace, {});
    cache.put("/shop", shop.html, shop.trace, {});
    cache.invalidate([{ name: "products", args: [] }]);
    cache.stats().entries; // → 1
    EVERYTHING; // → "$pages"
    cache.invalidate([EVERYTHING]);
    cache.stats().entries; // → 0
    ```

    ```js
    const cache = createPageCache();
    cache.put("/about", about.html, about.trace, {});
    cache.invalidate([{ entity: "order", id: 7 }]);
    cache.has("/about"); // → false
    ```

  - Pages whose key carries a query hold a share of it (`maxQueryEntries`, a quarter of
    `maxEntries` unless told): the key keeps a parameter pages read with whatever value a visitor
    sends, so once they hold their share a new one takes the room of the least recently used of
    them, never of a page without a query. `stats()` counts them (`queryEntries`) beside the rest.

    ```js
    const cache = createPageCache({ maxEntries: 8 });
    cache.put("/about", about.html, about.trace, {});
    for (const q of ["milk", "eggs", "tea"]) {
        cache.put(`/search?q=${q}`, shop.html, shop.trace, {});
    }
    cache.has("/search?q=milk"); // → false
    cache.has("/about"); // → true
    const { entries, queryEntries, maxQueryEntries } = cache.stats();
    [entries, queryEntries, maxQueryEntries]; // → [3, 2, 2]
    ```

    ```js
    const cache = createPageCache({ maxEntries: 3, maxQueryEntries: 3 });
    cache.put("/about", about.html, about.trace, {});
    for (const q of ["milk", "eggs", "tea"]) {
        cache.put(`/search?q=${q}`, shop.html, shop.trace, {});
    }
    cache.has("/about"); // → false
    cache.stats().queryEntries; // → 3
    ```

- `canonicalPath(url)` is the one spelling of a path a server redirects to before its guards, its
  cache key and its render read it (dot segments resolved in any spelling, `\` read as `/`),

  ```js
  canonicalPath("//cart/./items/../");
  // → { path: "//cart/./items/../", canonical: "/cart", query: undefined,
  //     redirect: "/cart" }
  canonicalPath("/admin/%2e%2e/cart?step=2").redirect; // → "/cart?step=2"
  canonicalPath("/\\admin").redirect; // → "/admin"
  canonicalPath("/cart").redirect; // → null
  ```

  and `pageCacheKey(url, known)` keeps only the query parameters pages read.

  ```js
  const url = new URL("https://shop.example/search?utm=mail&q=milk&page=2");
  pageCacheKey(url, new Set(["q", "page"])); // → "/search?page=2&q=milk"
  pageCacheKey(url, new Set()); // → "/search"
  ```

#### `server/minify.js`

**Exports:** `minifyJs`, `minifyCss`, `jsTokens`.

The examples on this page feed the minifiers source and show what comes out; `regexes(code)` lists
the regular expressions `jsTokens` finds in a piece of code (every other `/` is division).

```js setup
import {
    jsTokens,
    minifyCss,
    minifyJs,
} from "juris-kit/server/minify.js";

const regexes = (code) => jsTokens(code)
    .filter((token) => token.type === "regex")
    .map((token) => token.text);
```

What a server sends browsers in production, made smaller and nothing else.

```js
const source = `export function total(cart) {
    // Prices are in cents.
    return cart.items.reduce((sum, item) => sum + item.price, 0);
}
`;
minifyJs(source).split("\n");
// → ["export function total(cart) {",
//    "return cart.items.reduce((sum, item) => sum + item.price, 0);",
//    "}"]
minifyJs(source).length < source.length; // → true
```

Conservative by design: `minifyJs` removes comments, indentation and blank lines, collapses each run
of whitespace to one character (a newline when the run held any of JavaScript's line terminators,
`\r`, U+2028 and U+2029 included, which also end a line comment), and never looks inside a string, a
template's text or a regular expression, so token boundaries and semicolon insertion come out as
written; it never renames or folds anything.

```js
const source = `const items = 3;   /* in the cart */


const shipping   =   items > 2 ? 0 : 5;
`;
minifyJs(source).split("\n");
// → ["const items = 3;", "const shipping = items > 2 ? 0 : 5;"]
```

```js
minifyJs("let total = 1\r\r   let tax = 2 // VAT total += tax");
// → "let total = 1\nlet tax = 2\ntotal += tax"
minifyJs("return\r  total");
// → "return\ntotal"
```

```js
minifyJs('const tip = "two  //  spaces";   const day = 60  *  60  *  24;');
// → 'const tip = "two  //  spaces"; const day = 60 * 60 * 24;'
minifyJs("const re = /\\/\\/  +/g;   const note = `  ${ n  +  1 }  `;");
// → "const re = /\\/\\/  +/g; const note = `  ${ n + 1 }  `;"
```

Whether a `/` begins a regex is read from the token before it and the brackets open around it:
after the `)` of an `if`, `while`, `for` or `with` head, after `extends` and after a block's `}` a
regex may follow; after an expression's `)`, an object literal's `}`, a function or class
expression's `}` or a property named like a keyword (`x.return`), it is division.

```js
regexes("if (url) /^https:/.test(url) && open(url)"); // → ["/^https:/"]
regexes("while (more) /,\\s*/g.exec(list)"); // → ["/,\\s*/g"]
regexes("class Tags extends /x/.constructor {}"); // → ["/x/"]
regexes("try { save() } catch {}\n/ok/.test(status)"); // → ["/ok/"]
```

```js
regexes("const half = (total) / 2 / 1"); // → []
regexes("const odd = {} / 2 / 1"); // → []
regexes("const n = function () {} / 2 / 1"); // → []
regexes("const share = cart.return / 2 / 1"); // → []
```

```js
minifyJs("if (line) /\\/\\/  todo/.test(line)  &&  count++");
// → "if (line) /\\/\\/  todo/.test(line) && count++"
minifyJs("const rate = (total) / 2 // half\n");
// → "const rate = (total) / 2"
```

A `{` where an expression is due opens an object literal; one after a statement that ended without a
semicolon (a string, a regex, a template, a `]` or a postfix `++`/`--` ending the line before it)
opens a block.

```js
regexes('const label = "Cart"\n{ }\n/milk/.test(name)'); // → ["/milk/"]
regexes("const first = items[0]\n{ }\n/milk/.test(name)"); // → ["/milk/"]
regexes("count++\n{ }\n/milk/.test(name)"); // → ["/milk/"]
regexes("const empty = { }\n/2/ 1"); // → []
```

Non-ASCII whitespace (U+00A0 and the rest) separates words as a space does.

```js
minifyJs("const total = 1"); // → "const total = 1"
regexes("return /milk/g"); // → ["/milk/g"]
```

`jsTokens(src)` is that reading, as tokens whose texts joined are the source (the module server's
import stamping reads it too).

```js
const source = "total += 2; // VAT";
jsTokens(source).map(({ type, text }) => `${type} ${JSON.stringify(text)}`);
// → ['word "total"', 'space " "', 'punct "+"', 'punct "="', 'space " "',
//    'word "2"', 'punct ";"', 'space " "', 'comment "// VAT"']
jsTokens(source).map((token) => token.text).join("") === source; // → true
```

`minifyCss` also drops whitespace around `{};:,>` where it cannot matter and the `;` before a `}`
(never inside a string), keeps the space before a colon wherever it was written (a descendant
combinator, at the top level, in `@media` or nested in a rule), and drops a comment, leaving a space
only between two characters of a name or a number (`.a/**/.b` is `.a.b`, as a browser reads it;
`0/**/auto` is `0 auto`). Its cases are in `juris-tests/tests/juris-kit/minify.test.mjs` and
`juris-kit/tests/server.test.mjs`.

```js
minifyCss(`
.cart > li ,  .cart  a  {
    color: navy ;
    content: "a ; }" ;
}
`);
// → '.cart>li,.cart a{color:navy;content:"a ; }"}'
```

```js
minifyCss(".cart :hover { color: navy; }"); // → ".cart :hover{color:navy}"
minifyCss(".cart:hover { color: navy; }"); // → ".cart:hover{color:navy}"
minifyCss("@media (min-width: 600px) { .title :first-child { color: red } }");
// → "@media (min-width:600px){.title :first-child{color:red}}"
```

```js
minifyCss(".item/**/.sold { opacity: 0.5 }"); // → ".item.sold{opacity:0.5}"
minifyCss(".cart { margin: 0/**/auto; }"); // → ".cart{margin:0 auto}"
minifyCss("/* Cart */ .cart { color: navy } /* end */");
// → ".cart{color:navy}"
```

#### `server/db.js`

**Exports:** `fromPg`, `fromMysql2`, `fromMariadb`.

No example on this page needs a database: each adapter is given a stand-in pool, the shape the
driver's own has. `fakePg` answers every statement with the rows it is given, and `fakeMysql2`
likewise; both log what a transaction's connection runs and how it is given back, and a statement
named in `fail` throws.

```js setup
import {
    fromMariadb,
    fromMysql2,
    fromPg,
} from "juris-kit/server/db.js";

function fakePg({ rows = [], fields = [], fail = {} } = {}) {
    const log = [];
    const run = async (sql) => {
        log.push(sql);
        if (fail[sql]) throw new Error(fail[sql]);
        return { rows: [...rows], fields, rowCount: rows.length };
    };
    const client = {
        query: run,
        release: (error) => log.push(`release(${error?.message ?? ""})`),
    };
    return { log, query: run, connect: async () => client };
}

function fakeMysql2({ rows = [], fields = [], fail = {} } = {}) {
    const log = [];
    const step = (name) => async () => {
        log.push(name);
        if (fail[name]) throw new Error(fail[name]);
    };
    const run = async (sql) => {
        log.push(sql);
        return [Array.isArray(rows) ? [...rows] : rows, fields];
    };
    const connection = {
        beginTransaction: step("BEGIN"),
        commit: step("COMMIT"),
        rollback: step("ROLLBACK"),
        query: run,
        release: () => log.push("release()"),
        destroy: () => log.push("destroy()"),
    };
    return { log, query: run, getConnection: async () => connection };
}
```

One interface over the database drivers a server may use, so an app's services and a change bus
never see a driver's return shape.

```js
const rows = [{ sku: "milk", qty: 2 }];
const sql = "SELECT sku, qty FROM cart_lines WHERE cart_id = $1";
await fromPg(fakePg({ rows })).query(sql, [7]); // → [{ sku: "milk", qty: 2 }]
await fromMysql2(fakeMysql2({ rows })).query(sql, [7]);
// → [{ sku: "milk", qty: 2 }]
```

`db.query(sql, params = [])` answers the rows of a statement that returns rows (for one that does
not, what the driver reports);

```js
const written = { affectedRows: 1, insertId: 42 };
const db = fromMysql2(fakeMysql2({ rows: written }));
await db.query("INSERT INTO orders (cart_id) VALUES (?)", [7]);
// → { affectedRows: 1, insertId: 42 }
const pg = fromPg(fakePg());
await pg.query("UPDATE carts SET closed = true WHERE id = $1", [7]); // → []
```

`db.transaction(fn)` runs `fn({ query })` on one connection between BEGIN and COMMIT, answers what
`fn` returns, rolls back and rethrows when `fn` or the COMMIT fails (a failed rollback does not
replace that error), and releases the connection either way, unless the ROLLBACK itself failed: then
the connection may still be inside the transaction, so it is destroyed rather than pooled (pg:
`client.release(error)`; mysql2 and mariadb: `conn.destroy()`), and the pool opens a new one.

```js
const pool = fakePg();
const db = fromPg(pool);
await db.transaction(async (tx) => {
    await tx.query("UPDATE stock SET qty = qty - 2 WHERE sku = 'milk'");
    await tx.query("INSERT INTO orders (sku, qty) VALUES ('milk', 2)");
    return "order placed";
});
// → "order placed"
pool.log;
// → ["BEGIN",
//    "UPDATE stock SET qty = qty - 2 WHERE sku = 'milk'",
//    "INSERT INTO orders (sku, qty) VALUES ('milk', 2)",
//    "COMMIT",
//    "release()"]
```

```js
const pool = fakePg({ fail: { COMMIT: "could not serialize access" } });
await fromPg(pool).transaction(async (tx) => {
    await tx.query("UPDATE stock SET qty = 0");
});
// throws Error: could not serialize access
pool.log;
// → ["BEGIN", "UPDATE stock SET qty = 0", "COMMIT", "ROLLBACK",
//    "release()"]
const mysql = fakeMysql2({ fail: { ROLLBACK: "connection lost" } });
await fromMysql2(mysql).transaction(async () => {
    throw new Error("out of stock");
});
// throws Error: out of stock
mysql.log; // → ["BEGIN", "ROLLBACK", "destroy()"]
```

```js
const pool = fakePg({ fail: { ROLLBACK: "connection lost" } });
await fromPg(pool).transaction(async () => {
    throw new Error("out of stock");
});
// throws Error: out of stock
pool.log; // → ["BEGIN", "ROLLBACK", "release(connection lost)"]
```

The rows also say their columns, in order, as `rows.fields` (the names; pg and mysql2), a property
that is not enumerable, so the rows iterate and serialize as before; a statement that returns no
rows still has them, which is how a caller learns the shape of an empty result.

```js
const fields = [{ name: "sku" }, { name: "qty" }];
const pool = fakePg({ rows: [{ sku: "milk", qty: 2 }], fields });
const rows = await fromPg(pool).query("SELECT sku, qty FROM cart_lines");
rows.fields; // → ["sku", "qty"]
JSON.stringify(rows); // → '[{"sku":"milk","qty":2}]'
Object.keys(rows); // → ["0"]
```

```js
const fields = [{ name: "sku" }, { name: "qty" }];
const db = fromMysql2(fakeMysql2({ rows: [], fields }));
const none = await db.query("SELECT sku, qty FROM cart_lines WHERE false");
none.length; // → 0
none.fields; // → ["sku", "qty"]
```

The driver is the app's: it passes a pool in, so the module imports nothing and the framework
depends on no driver.

```js
const meta = { columns: ["sku", "qty"] };
const driverRows = Object.assign([{ sku: "milk", qty: 2 }], { meta });
const pool = { query: async () => driverRows };
const rows = await fromMariadb(pool).query("SELECT sku, qty FROM cart_lines");
rows; // → [{ sku: "milk", qty: 2 }]
rows === driverRows; // → false
```

```js
import { readFile } from "node:fs/promises";

const url = import.meta.resolve("juris-kit/server/db.js");
const source = await readFile(new URL(url), "utf8");
/^import /m.test(source); // → false
```

#### `server/bus/pg-outbox.js`

**Exports:** `createPgOutboxBus`, `schemaFor`, `SCHEMA`, `CHANGE_TABLE`, `CHANNEL`,
`PRUNE_AFTER_MS`, `emit`, `writeWithChanges`.

No example on this page needs a database. `fakePg()` is a stand-in for a `pg.Pool` over outbox
tables kept in memory: it answers the statements the bus sends, `sent` logs them, a transaction's
rows are kept only at its COMMIT, and a committed row rings every connection that LISTENs, as the
trigger does. `pool.commit(entity, entityId, row)` is another instance's transaction committing;
`refuse` makes the next connections fail, and `failListen` the next `LISTEN`. `cart` maps a
change to the cart to the live query it invalidates, and `settle()` lets a read finish.

```js setup
import { EventEmitter } from "node:events";
import {
    CHANGE_TABLE,
    CHANNEL,
    PRUNE_AFTER_MS,
    SCHEMA,
    createPgOutboxBus,
    emit,
    schemaFor,
    writeWithChanges,
} from "juris-kit/server/bus/pg-outbox.js";
import { fromPg } from "juris-kit/server/db.js";

function fakePg() {
    const pool = {
        tables: {},
        sent: [],
        listening: new Set(),
        released: [],
        refuse: 0,
        failListen: 0,
    };
    const nameIn = (sql) => /(?:FROM|INTO) (\w+)/.exec(sql)?.[1];
    const rowsOf = (table) => (pool.tables[table] ??= []);
    const isNotice = (sql) => /^INSERT INTO \w+ \(entity/.test(sql);
    const age = (row) => Date.now() - row.created_at;

    pool.commit = (entity, entityId, row = {}, table = "change_events") => {
        const rows = rowsOf(table);
        const id = row.id ?? rows.length + 1;
        rows.push({
            id,
            entity,
            entity_id: entityId,
            payload: null,
            created_at: new Date(),
            ...row,
        });
        const bell = { channel: table, payload: String(id) };
        for (const client of pool.listening) client.emit("notification", bell);
    };

    pool.query = async (sql, params = []) => {
        pool.sent.push(sql);
        const rows = rowsOf(nameIn(sql));
        if (sql.startsWith("SELECT COALESCE")) {
            const ids = rows.map((row) => row.id);
            return { rows: [{ id: Math.max(0, ...ids) }] };
        }
        if (sql.includes("WHERE id > $1")) {
            const fresh = rows.filter((row) => row.id > params[0]);
            fresh.sort((a, b) => a.id - b.id);
            return { rows: fresh.slice(0, params[1]) };
        }
        if (sql.includes("WHERE id = ANY")) {
            return { rows: rows.filter((row) => params[0].includes(row.id)) };
        }
        if (isNotice(sql)) {
            const [entity, entityId, payload = null] = params;
            pool.commit(entity, entityId, { payload }, nameIn(sql));
        }
        if (sql.startsWith("DELETE")) {
            const old = rows.filter((row) => age(row) > params[0]);
            pool.tables[nameIn(sql)] = rows.filter((row) => !old.includes(row));
            return { rows: [], rowCount: old.length };
        }
        return { rows: [] };
    };

    pool.connect = async () => {
        if (pool.refuse > 0) {
            pool.refuse -= 1;
            throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
        }
        const client = new EventEmitter();
        let open = null;
        client.query = async (sql, params) => {
            if (sql.startsWith("LISTEN") && pool.failListen > 0) {
                pool.failListen -= 1;
                throw new Error("permission denied to LISTEN");
            }
            if (sql.startsWith("LISTEN")) {
                pool.listening.add(client);
            } else if (sql.startsWith("UNLISTEN")) {
                pool.listening.delete(client);
            } else if (sql === "BEGIN") {
                open = [];
            } else if (sql === "ROLLBACK") {
                open = null;
            } else if (sql === "COMMIT") {
                for (const args of open) pool.commit(...args);
                open = null;
            } else if (open && isNotice(sql)) {
                open.push([...params, {}, nameIn(sql)]);
            } else {
                return pool.query(sql, params);
            }
            return { rows: [] };
        };
        client.release = (error) => {
            pool.listening.delete(client);
            pool.released.push(error ?? null);
        };
        return client;
    };
    return pool;
}

const cart = { cart: (id) => ({ name: "cart", args: [id] }) };
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
```

A change bus for `serviceDispatcher`'s `live.bus` on Postgres, so an invalidation on one instance
reaches the live queries and pages of every other.

```js
const pool = fakePg();
const web1 = createPgOutboxBus({ pool, targets: cart });
const web2 = createPgOutboxBus({ pool, targets: cart });
const heard = [];
web2.subscribe((targets) => heard.push(...targets));
await web1.start();
await web2.start();
await web1.publish([{ name: "cart", args: [7] }]);
await settle();
heard; // → [{ name: "cart", args: [7] }]
await web1.stop();
await web2.stop();
```

- An outbox table is the record, and a trigger's `NOTIFY`, sent at commit, is only the doorbell:
  each instance reads the rows it has not seen, and a slow sweep catches what a missed notification
  would lose.

  ```js
  const pool = fakePg();
  const bus = createPgOutboxBus({ pool, targets: cart });
  const heard = [];
  bus.subscribe((targets) => heard.push(...targets));
  await bus.start();
  pool.commit("cart", "7");
  await settle();
  heard; // → [{ name: "cart", args: ["7"] }]
  pool.sent.at(-1);
  // → "SELECT id, entity, entity_id, payload, created_at FROM change_events "
  //   + "WHERE id > $1 ORDER BY id LIMIT $2"
  await bus.stop();
  ```

  ```js
  const pool = fakePg();
  const bus = createPgOutboxBus({ pool, targets: cart, sweepMs: 100 });
  const heard = [];
  bus.subscribe((targets) => heard.push(...targets));
  await bus.start();
  pool.listening.clear();
  pool.commit("cart", "7");
  await settle();
  heard; // → []
  await new Promise((resolve) => setTimeout(resolve, 120));
  heard; // → [{ name: "cart", args: ["7"] }]
  await bus.stop();
  ```

  Ids are taken at INSERT and seen at COMMIT, so a transaction can commit a lower id after a
  higher one: the reader re-checks exactly the ids it jumped over until they appear or leave the
  lookback window.

  ```js
  const pool = fakePg();
  const bus = createPgOutboxBus({ pool, targets: cart });
  const heard = [];
  bus.subscribe((targets) => heard.push(...targets.map((t) => t.args[0])));
  await bus.start();
  pool.commit("cart", "1", { id: 1 });
  pool.commit("cart", "3", { id: 3 });
  await settle();
  bus.stats().gaps; // → 1
  pool.commit("cart", "2", { id: 2 });
  await settle();
  heard; // → ["1", "3", "2"]
  bus.stats().gaps; // → 0
  await bus.stop();
  ```

  ```js
  let clock = 0;
  const pool = fakePg();
  const bus = createPgOutboxBus({
      pool,
      targets: cart,
      lookbackMs: 5000,
      now: () => clock,
  });
  await bus.start();
  pool.commit("cart", "1", { id: 1 });
  pool.commit("cart", "3", { id: 3 });
  await settle();
  bus.stats().gaps; // → 1
  clock = 6000;
  await bus.read();
  bus.stats().gaps; // → 0
  await bus.stop();
  ```

- `createPgOutboxBus({ pool, targets, sweepMs, coalesceMs, lookbackMs, batchSize, table, channel,
  onError, now, origin, reconnectMs, reconnectMaxMs })` answers the bus, which the dispatcher is
  given as `live.bus` and the app starts (`start()`) and stops (`stop()`):

  ```js
  const pool = fakePg();
  const bus = createPgOutboxBus({ pool, targets: cart });
  await bus.start();
  pool.listening.size; // → 1
  pool.sent; // → ["SELECT COALESCE(MAX(id), 0) AS id FROM change_events"]
  await bus.stop();
  pool.listening.size; // → 0
  ```

  ```js
  const pool = fakePg();
  const bus = createPgOutboxBus({ pool, targets: cart, batchSize: 2 });
  await bus.start();
  pool.listening.clear();
  for (const id of ["1", "2", "3", "4", "5"]) pool.commit("cart", id);
  await bus.read();
  [bus.stats().reads, bus.stats().events]; // → [3, 5]
  await bus.stop();
  ```

  ```js
  const pool = fakePg();
  const bus = createPgOutboxBus({ pool, targets: cart, coalesceMs: 8 });
  const heard = [];
  bus.subscribe((targets) => heard.push(targets.length));
  await bus.start();
  for (const id of ["1", "2", "3", "4", "5", "6"]) pool.commit("cart", id);
  await settle();
  const { notifies, reads, events } = bus.stats();
  [notifies, reads, events]; // → [6, 2, 6]
  await bus.stop();
  ```

  - `targets` maps an entity to the invalidation targets its change means, and `origin` marks the
    rows this bus writes, so it skips its own echo.

    ```js
    const pool = fakePg();
    const bus = createPgOutboxBus({
        pool,
        origin: "web-1",
        targets: {
            order: (id) => [{ name: "order", args: [id] }, "orders"],
        },
    });
    const heard = [];
    bus.subscribe((targets) => heard.push(...targets));
    await bus.start();
    pool.commit("order", "42");
    pool.commit("invoice", "9");
    await bus.publish(["orders"]);
    await settle();
    heard; // → [{ name: "order", args: ["42"] }, "orders"]
    bus.stats().ownEchoes; // → 1
    await bus.stop();
    ```

  - `publish(targets)` writes a row after a mutation;

    ```js
    const pool = fakePg();
    const bus = createPgOutboxBus({ pool, targets: cart, origin: "web-1" });
    await bus.publish([{ name: "cart", args: [7] }]);
    pool.tables.change_events[0].payload;
    // → '{"o":"web-1","t":[{"name":"cart","args":[7]}]}'
    ```

  - `emit(tx, entity, entityId, table)` writes one inside the mutation's own transaction, and
    `writeWithChanges(db, fn, table)` runs a mutation and its notices in one transaction, so the
    notice commits with the data or not at all.

    ```js
    const pool = fakePg();
    const db = fromPg(pool);
    await db.transaction(async (tx) => {
        await tx.query("UPDATE carts SET total = 12 WHERE id = $1", [7]);
        await emit(tx, "cart", 7);
    });
    pool.tables.change_events.map((row) => [row.entity, row.entity_id]);
    // → [["cart", "7"]]
    ```

    ```js
    const pool = fakePg();
    const db = fromPg(pool);
    const total = await writeWithChanges(db, async (tx) => {
        await tx.query("UPDATE carts SET total = 12 WHERE id = $1", [7]);
        return { changes: [["cart", 7]], value: 12 };
    });
    total; // → 12
    await writeWithChanges(db, async (tx) => {
        await tx.query("UPDATE carts SET total = 0 WHERE id = $1", [7]);
        throw new Error("the cart is locked");
    });
    // throws Error: the cart is locked
    pool.tables.change_events.length; // → 1
    ```

    ```js
    const pool = fakePg();
    await writeWithChanges(fromPg(pool), async (tx) => {
        await tx.query("DELETE FROM cart_lines WHERE cart_id = $1", [7]);
        return [["cart", 7], ["stock", "milk"]];
    }, "shop_changes");
    pool.tables.shop_changes.map((row) => row.entity); // → ["cart", "stock"]
    ```

- The LISTEN connection is the bus's own. When it is lost, the bus opens it again after
  `reconnectMs` (500), and keeps trying, the wait doubling up to `reconnectMaxMs` (30000), until it
  is back or the bus is stopped, then reads at once (it used to try once, so a database that took
  longer to come back left the bus on the sweep for good).

  ```js
  const waits = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (task, ms) => {
      waits.push(ms);
      return realSetTimeout(task, 1);
  };
  const pool = fakePg();
  const bus = createPgOutboxBus({
      pool,
      targets: cart,
      reconnectMaxMs: 3000,
      onError: () => {},
  });
  const heard = [];
  bus.subscribe((targets) => heard.push(...targets));
  await bus.start();
  pool.refuse = 4;
  const [listener] = pool.listening;
  listener.emit("error", new Error("terminating connection"));
  pool.commit("cart", "7");
  while (heard.length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
  }
  waits; // → [500, 1000, 2000, 3000, 3000]
  heard; // → [{ name: "cart", args: ["7"] }]
  bus.stats().errors; // → 5
  await bus.stop();
  ```

  ```js
  const pool = fakePg();
  createPgOutboxBus({ pool, targets: cart, reconnectMs: 0 });
  // throws TypeError: createPgOutboxBus: reconnectMs is a whole number of
  //   milliseconds from 1, not 0
  ```

  - A client whose `LISTEN` fails is released with the error, which destroys it, instead of
    staying checked out. A `start()` that fails rejects and leaves the bus stopped, so calling it
    again tries again (it used to do nothing).

    ```js
    const pool = fakePg();
    pool.failListen = 1;
    const bus = createPgOutboxBus({ pool, targets: cart });
    await bus.start();
    // throws Error: permission denied to LISTEN
    pool.released.map((error) => error?.message);
    // → ["permission denied to LISTEN"]
    await bus.start();
    pool.listening.size; // → 1
    await bus.stop();
    ```

  - Each failed attempt counts in `stats().errors` and `lastErrorAt`, its words to `onError`.

    ```js
    let clock = 1000;
    const words = [];
    const pool = fakePg();
    const bus = createPgOutboxBus({
        pool,
        targets: cart,
        reconnectMs: 5,
        now: () => clock,
        onError: (error) => words.push(error.message),
    });
    await bus.start();
    pool.refuse = 1;
    [...pool.listening][0].emit("error", new Error("terminating connection"));
    await settle();
    words; // → ["connect ECONNREFUSED 10.0.0.5:5432"]
    const { errors, lastErrorAt } = bus.stats();
    [errors, lastErrorAt]; // → [2, 1000]
    await bus.stop();
    ```

- `schemaFor({ table, channel })` writes the table, its index, the notify function and the trigger,
  all named after the table, with the channel defaulting to the table's name as the bus's own does,
  so a bus and a schema given only the table meet;

  ```js
  const sql = schemaFor({ table: "shop_changes" });
  [...new Set(sql.match(/shop_changes\w*/g))];
  // → ["shop_changes", "shop_changes_time", "shop_changes_notify",
  //    "shop_changes_notify_trigger"]
  sql.includes("pg_notify('shop_changes', NEW.id::text)"); // → true
  const rung = schemaFor({ table: "shop_changes", channel: "shop_bell" });
  rung.includes("pg_notify('shop_bell', NEW.id::text)"); // → true
  ```

  ```js
  const pool = fakePg();
  const bus = createPgOutboxBus({ pool, targets: cart, table: "shop_changes" });
  await bus.start();
  [...pool.listening][0].emit("notification", { channel: "change_events" });
  [...pool.listening][0].emit("notification", { channel: "shop_changes" });
  bus.stats().notifies; // → 1
  await bus.stop();
  ```

  `SCHEMA` is `schemaFor()`, the default names, `CHANGE_TABLE` and `CHANNEL` (`change_events`).

  ```js
  SCHEMA === schemaFor(); // → true
  [CHANGE_TABLE, CHANNEL]; // → ["change_events", "change_events"]
  SCHEMA.includes("CREATE TABLE IF NOT EXISTS change_events ("); // → true
  ```

  A table or channel must be a lowercase SQL identifier, and `schemaFor` and the bus both refuse
  anything else: the trigger's `pg_notify('<channel>')` sends the name exactly as written while the
  bus's unquoted `LISTEN` folds it to lowercase, so a capital would ring one channel and listen on
  another.

  ```js
  schemaFor({ table: "ShopChanges" });
  // throws TypeError: schemaFor: table must be a lowercase SQL identifier
  const pool = fakePg();
  createPgOutboxBus({ pool, targets: cart, channel: "ShopBell" });
  // throws TypeError: createPgOutboxBus: channel must be a lowercase SQL
  //   identifier
  ```

- `prune({ olderThanMs })` deletes the rows written more than that long ago (`PRUNE_AFTER_MS`, an
  hour, unless told) by the database's own clock, and answers how many: the table is what to tell
  the other instances, not history, and nothing else deletes from it, so an app runs it on a timer.

  ```js
  const pool = fakePg();
  const bus = createPgOutboxBus({ pool, targets: cart });
  const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
  pool.commit("cart", "7", { created_at: twoHoursAgo });
  pool.commit("cart", "8");
  PRUNE_AFTER_MS; // → 3600000
  await bus.prune(); // → 1
  const sql = pool.sent.at(-1);
  sql.startsWith("DELETE FROM change_events WHERE created_at < now()");
  // → true
  await bus.prune({ olderThanMs: 60_000 }); // → 0
  ```

  Less than the bus's `lookbackMs` is refused, since a younger row may be one a reader has not
  read yet.

  ```js
  const pool = fakePg();
  const bus = createPgOutboxBus({ pool, targets: cart, lookbackMs: 5000 });
  await bus.prune({ olderThanMs: 1000 });
  // throws RangeError: prune: olderThanMs must be a number of milliseconds,
  //   no less than lookbackMs (5000), not 1000
  pool.sent; // → []
  ```

- `stats()` counts what the bus did, and a failed read as `errors` and `lastErrorAt` (the bus's
  clock): when, never what. The driver's words go to `onError` alone, since an app may show
  `stats()` in a public `/healthz`.

  ```js
  const words = [];
  const pool = fakePg();
  const bus = createPgOutboxBus({
      pool,
      targets: cart,
      now: () => 1_700_000_000_000,
      onError: (error) => words.push(error.message),
  });
  await bus.start();
  pool.query = async () => {
      throw new Error('password authentication failed for user "shop"');
  };
  await bus.read();
  const stats = bus.stats();
  [stats.errors, stats.lastErrorAt]; // → [1, 1700000000000]
  JSON.stringify(stats).includes("password"); // → false
  words; // → ['password authentication failed for user "shop"']
  await bus.stop();
  ```

  The pool is the app's, so the module imports only `../db.js`.

  ```js
  import { readFile } from "node:fs/promises";

  const url = import.meta.resolve(
      "juris-kit/server/bus/pg-outbox.js",
  );
  const source = await readFile(new URL(url), "utf8");
  source.match(/^import .*/gm); // → ['import { fromPg } from "../db.js";']
  ```

#### `server/bus/mysql-outbox.js`

**Exports:** `createOutboxBus`, `schemaFor`, `SCHEMA`, `CHANGE_TABLE`, `PRUNE_AFTER_MS`, `emit`,
`writeWithChanges`.

No example on this page needs a database either. `fakeMysql2()` is a stand-in for a `mysql2`
pool over outbox tables kept in memory, which the bus reads through `fromMysql2`: it answers the
statements the bus sends, `sent` logs them, a transaction's rows are kept only at its commit, and
`pool.commit(entity, entityId, row)` is another instance's transaction committing. `cart` maps a
change to the cart to the live query it invalidates.

```js setup
import {
    CHANGE_TABLE,
    PRUNE_AFTER_MS,
    SCHEMA,
    createOutboxBus,
    emit,
    schemaFor,
    writeWithChanges,
} from "juris-kit/server/bus/mysql-outbox.js";
import { EVERYTHING } from "juris-kit/server/page-cache.js";
import { fromMysql2 } from "juris-kit/server/db.js";

function fakeMysql2() {
    const pool = { tables: {}, sent: [] };
    const nameIn = (sql) => /(?:FROM|INTO) (\w+)/.exec(sql)?.[1];
    const rowsOf = (table) => (pool.tables[table] ??= []);
    const isNotice = (sql) => /^INSERT INTO \w+ \(entity/.test(sql);
    const microseconds = (row) => (Date.now() - row.created_at) * 1000;

    pool.commit = (entity, entityId, row = {}, table = "change_events") => {
        const rows = rowsOf(table);
        rows.push({
            id: row.id ?? rows.length + 1,
            entity,
            entity_id: entityId,
            payload: null,
            created_at: new Date(),
            ...row,
        });
    };

    pool.query = async (sql, params = []) => {
        pool.sent.push(sql);
        const rows = rowsOf(nameIn(sql));
        if (sql.startsWith("SELECT COALESCE")) {
            const ids = rows.map((row) => row.id);
            return [[{ id: Math.max(0, ...ids) }], []];
        }
        if (sql.includes("WHERE id > ?")) {
            const fresh = rows.filter((row) => row.id > params[0]);
            fresh.sort((a, b) => a.id - b.id);
            return [fresh.slice(0, params[1]), []];
        }
        if (sql.includes("WHERE id IN")) {
            return [rows.filter((row) => params.includes(row.id)), []];
        }
        if (isNotice(sql)) {
            const [entity, entityId, payload = null] = params;
            pool.commit(entity, entityId, { payload }, nameIn(sql));
        }
        if (sql.startsWith("DELETE")) {
            const old = rows.filter((row) => microseconds(row) > params[0]);
            pool.tables[nameIn(sql)] = rows.filter((row) => !old.includes(row));
            return [{ affectedRows: old.length }, undefined];
        }
        return [{ affectedRows: 1 }, undefined];
    };

    pool.getConnection = async () => {
        let open = [];
        return {
            beginTransaction: async () => {
                open = [];
            },
            query: async (sql, params) => {
                if (!isNotice(sql)) return pool.query(sql, params);
                open.push([...params, {}, nameIn(sql)]);
                return [{ affectedRows: 1 }, undefined];
            },
            commit: async () => {
                for (const args of open) pool.commit(...args);
            },
            rollback: async () => {
                open = [];
            },
            release: () => {},
            destroy: () => {},
        };
    };
    return pool;
}

const cart = { cart: (id) => ({ name: "cart", args: [id] }) };
```

The same bus on MariaDB or MySQL, `createOutboxBus({ db, targets, intervalMs, … })`, over an adapter
from `db.js` (`fromMysql2`, `fromMariadb`).

```js
const pool = fakeMysql2();
const bus = createOutboxBus({ db: fromMysql2(pool), targets: cart });
const heard = [];
bus.subscribe((targets) => heard.push(...targets));
await bus.start();
pool.commit("cart", "7");
await bus.poll();
heard; // → [{ name: "cart", args: ["7"] }]
await bus.stop();
```

```js
createOutboxBus({ targets: cart });
// throws Error: createOutboxBus: db adapter is required
```

Neither database has `NOTIFY`, so it polls (every 25 ms by default).

```js
const pool = fakeMysql2();
const bus = createOutboxBus({ db: fromMysql2(pool), targets: cart });
const heard = [];
bus.subscribe((targets) => heard.push(...targets));
await bus.start();
pool.commit("cart", "7");
heard; // → []
await new Promise((resolve) => setTimeout(resolve, 60));
heard; // → [{ name: "cart", args: ["7"] }]
await bus.stop();
```

```js
const pool = fakeMysql2();
const bus = createOutboxBus({
    db: fromMysql2(pool),
    targets: cart,
    intervalMs: 60_000,
});
await bus.start();
pool.commit("cart", "7");
await new Promise((resolve) => setTimeout(resolve, 60));
bus.stats().polls; // → 0
await bus.poll();
bus.stats().events; // → 1
await bus.stop();
```

Same table, same rows, same re-checks, the same `emit` and `writeWithChanges`,

```js
const pool = fakeMysql2();
const bus = createOutboxBus({ db: fromMysql2(pool), targets: cart });
const heard = [];
bus.subscribe((targets) => heard.push(...targets.map((t) => t.args[0])));
await bus.start();
pool.commit("cart", "1", { id: 1 });
pool.commit("cart", "3", { id: 3 });
await bus.poll();
bus.stats().gaps; // → 1
pool.commit("cart", "2", { id: 2 });
await bus.poll();
heard; // → ["1", "3", "2"]
await bus.stop();
```

```js
const pool = fakeMysql2();
const db = fromMysql2(pool);
await db.transaction(async (tx) => {
    await tx.query("UPDATE carts SET total = 12 WHERE id = ?", [7]);
    await emit(tx, "cart", 7);
});
await writeWithChanges(db, async (tx) => {
    await tx.query("UPDATE carts SET total = 0 WHERE id = ?", [7]);
    throw new Error("the cart is locked");
});
// throws Error: the cart is locked
pool.tables.change_events.map((row) => [row.entity, row.entity_id]);
// → [["cart", "7"]]
```

and the same `schemaFor({ table })` (a plain identifier, capitals allowed: with no channel, nothing
sends the name one way and reads it another), `SCHEMA` and `prune({ olderThanMs })`, whose cutoff is
`NOW(3)`: a DATETIME carries no zone, so the process's clock is never compared with it.

```js
const sql = schemaFor({ table: "ShopChanges" });
sql.split("\n")[0]; // → "CREATE TABLE IF NOT EXISTS ShopChanges ("
sql.includes("KEY ShopChanges_time (created_at)"); // → true
SCHEMA === schemaFor(); // → true
CHANGE_TABLE; // → "change_events"
schemaFor({ table: "shop changes" });
// throws TypeError: schemaFor: table must be a plain SQL identifier
```

```js
const pool = fakeMysql2();
const bus = createOutboxBus({ db: fromMysql2(pool), targets: cart });
const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
pool.commit("cart", "7", { created_at: twoHoursAgo });
pool.commit("cart", "8");
PRUNE_AFTER_MS; // → 3600000
await bus.prune(); // → 1
pool.sent.at(-1);
// → "DELETE FROM change_events WHERE created_at < NOW(3) "
//   + "- INTERVAL ? MICROSECOND"
await bus.prune({ olderThanMs: 1000 });
// throws RangeError: prune: olderThanMs must be a number of milliseconds,
//   no less than lookbackMs (5000), not 1000
```

Its `stats()` keeps a failed poll's time (`lastErrorAt`), never its words, as the Postgres bus does.

```js
const words = [];
const pool = fakeMysql2();
const bus = createOutboxBus({
    db: fromMysql2(pool),
    targets: cart,
    now: () => 1_700_000_000_000,
    onError: (error) => words.push(error.message),
});
await bus.start();
pool.query = async () => {
    throw new Error("Access denied for user 'shop'@'10.0.0.7'");
};
await bus.poll();
const stats = bus.stats();
[stats.errors, stats.lastErrorAt]; // → [1, 1700000000000]
JSON.stringify(stats).includes("Access denied"); // → false
words; // → ["Access denied for user 'shop'@'10.0.0.7'"]
await bus.stop();
```

A full batch is followed by the next poll only once it has been delivered, so no two polls run at
once and `stop()` resolves with none running (the next one used to be let in while the first still
awaited delivery).

```js
const pool = fakeMysql2();
const bus = createOutboxBus({
    db: fromMysql2(pool),
    targets: cart,
    batchSize: 2,
    intervalMs: 60_000,
});
let delivering = 0;
bus.subscribe(async () => {
    delivering += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    delivering -= 1;
});
await bus.start();
for (const id of ["1", "2", "3", "4", "5"]) pool.commit("cart", id);
bus.poll();
await bus.stop();
delivering; // → 0
bus.stats().polls; // → 1
```

```js
const pool = fakeMysql2();
const bus = createOutboxBus({
    db: fromMysql2(pool),
    targets: cart,
    batchSize: 2,
    intervalMs: 60_000,
});
const heard = [];
let delivering = 0;
let most = 0;
bus.subscribe(async (targets) => {
    delivering += 1;
    most = Math.max(most, delivering);
    await new Promise((resolve) => setTimeout(resolve, 5));
    heard.push(...targets.map((target) => target.args[0]));
    delivering -= 1;
});
await bus.start();
for (const id of ["1", "2", "3", "4", "5"]) pool.commit("cart", id);
await bus.poll();
await new Promise((resolve) => setTimeout(resolve, 50));
heard; // → ["1", "2", "3", "4", "5"]
[bus.stats().polls, most]; // → [3, 1]
await bus.stop();
```

The buses' names are shared by every instance that reads the table, old builds included while a
deploy is half rolled: the table, its index, the notify function, the trigger and the channel
(`change_events`, and names made from it), the payload of a published row (`{ o, t }`: the
publishing bus and its targets), and the page cache's `$pages` target that crosses in it.

```js
const pool = fakeMysql2();
const web1 = createOutboxBus({ db: fromMysql2(pool), origin: "web-1" });
const web2 = createOutboxBus({ db: fromMysql2(pool), origin: "web-2" });
const heard = [];
web2.subscribe((targets) => heard.push(...targets));
await web2.start();
await web1.publish([EVERYTHING]);
pool.tables.change_events[0].payload; // → '{"o":"web-1","t":["$pages"]}'
await web2.poll();
heard; // → ["$pages"]
await web2.stop();
```

Their defaults do not change, and a bus given another table or channel reaches only the instances
given the same.

```js
const pool = fakeMysql2();
const web1 = createOutboxBus({ db: fromMysql2(pool), table: "shop_changes" });
const web2 = createOutboxBus({ db: fromMysql2(pool) });
const web3 = createOutboxBus({ db: fromMysql2(pool), table: "shop_changes" });
const heard = { web2: [], web3: [] };
web2.subscribe((targets) => heard.web2.push(...targets));
web3.subscribe((targets) => heard.web3.push(...targets));
await web2.start();
await web3.start();
await web1.publish(["orders"]);
await web2.poll();
await web3.poll();
heard; // → { web2: [], web3: ["orders"] }
await web2.stop();
await web3.stop();
```

### What the server and the browser are given alike

The examples on this page share a link whose scheme only the app allows, and what they build an
instance with:

```js setup
import Juris, { sharedOptions } from "juris/juris.js";
import { hydrate } from "juris/client.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";
import { createJurisServer } from "juris-kit/server/kernel.js";

const download = {
    a: { href: "magnet:?xt=urn:btih:c12f", textContent: "Download" },
};
```

`createJurisServer` and `hydrate` each build the page's `Juris` instance, so what an app wants of it
beyond the defaults goes to both as one option, `juris`:
`{ allowTags, allowSchemes, allowInnerHTML, components }`, the tags and URL schemes both renderers
draw beyond the ones they allow (`html-safety.js`), whether a layout may set `innerHTML` (a boolean,
off unless given), and the components the instance is built with (`components`, an object of them
by name or a list of named functions, as `new Juris` takes it: "The Juris instance").

```js
const app = await createJurisServer({
    root: new URL(".", import.meta.url),
    build: "v1",
    modules: { entry: "/src/client.js" },
    services: {},
    routes: [],
    juris: { allowSchemes: ["magnet"], allowInnerHTML: true },
});
app.juris.renderToString(download);
// → <a href="magnet:?xt=urn:btih:c12f">Download</a>
app.juris.renderToString({ p: { innerHTML: "<b>New</b> in stock" } });
// → <p><b>New</b> in stock</p>
await app.close();
```

```js dom
document.body.innerHTML = '<div id="app"></div>'
    + '<script type="application/json" id="state">{}</script>';
await hydrate({
    routes: [],
    live: false,
    root: download,
    juris: { allowSchemes: ["magnet"] },
});
document.querySelector("#app").innerHTML;
// → <a href="magnet:?xt=urn:btih:c12f">Download</a>
```

Both check it with the one function, `sharedOptions` in `juris.js`: a plain object of those keys
only, each value as `Juris` itself would take it, anything else refused with a `TypeError` before
anything is built or read (the kernel before it builds its instance, the boot before it reads the
page).

```js
sharedOptions({ allowSchemes: ["magnet"] }, "createJurisServer");
// → { allowSchemes: ["magnet"] }
sharedOptions({ allowInnerHTML: "yes" }, "hydrate");
// throws TypeError: hydrate: allowInnerHTML is true or false, not "yes"
sharedOptions({ allowTags: ["video"], devMode: true }, "createJurisServer");
// throws TypeError: createJurisServer: juris.devMode is not an option
sharedOptions({ components: [() => ({ p: "Cart" })] }, "hydrate");
// throws TypeError: hydrate: juris.components[0] is a function with no name
```

```js
let setUp = false;
await createJurisServer({
    root: new URL(".", import.meta.url),
    build: "v1",
    modules: { entry: "/src/client.js" },
    services: {},
    routes: [],
    setup: () => {
        setUp = true;
    },
    juris: { allowSchemes: ["javascript"] },
});
// throws TypeError: Juris: allowSchemes: javascript: runs code in the page
setUp; // → false
```

```js dom
// An empty page: no #app, no #state.
await hydrate({ routes: [], juris: { allowTags: "iframe" } });
// throws TypeError: Juris: allowTags is a list of tags' names
```

Nothing else of the instance is the app's to set through it: `isServer`, `requirePreload`, the
state and the services are the kernel's and the boot's.

```js
const plumbing = {
    root: new URL(".", import.meta.url),
    build: "v1",
    modules: { entry: "/src/client.js" },
    services: {},
    routes: [],
};
await createJurisServer({ ...plumbing, juris: { requirePreload: false } });
// throws TypeError: createJurisServer: juris.requirePreload is not an option
const app = await createJurisServer(plumbing);
app.juris.isServer; // → true
app.juris.requirePreload; // → true
await app.close();
```

```js dom
await hydrate({ routes: [], juris: { state: { cart: { count: 2 } } } });
// throws TypeError: hydrate: juris.state is not an option
```

The same `components` reaches both sides, so a page draws the same thing on the server and in the
browser: each instance registers them as it is built, before the router, the app's plugins and its
own registrations (`setup` on the server, `register` in the browser).

```js
function Price(props) {
    return { span: { class: "price", textContent: `${props.amount} €` } };
}
const app = await createJurisServer({
    root: new URL(".", import.meta.url),
    build: "v1",
    modules: { entry: "/src/client.js" },
    services: {},
    routes: [],
    juris: { components: [Price] },
});
app.juris.renderToString({ Price: { amount: 3 } });
// → <span class="price">3 €</span>
await app.close();
```

```js dom
function Price(props) {
    return { span: { class: "price", textContent: `${props.amount} €` } };
}
document.body.innerHTML = '<div id="app"></div>'
    + '<script type="application/json" id="state">{}</script>';
await hydrate({
    routes: [],
    live: false,
    root: { Price: { amount: 3 } },
    juris: { components: [Price] },
});
document.querySelector("#app").innerHTML;
// → <span class="price">3 €</span>
```

The rule is that both sides read it from **one module both import**, the way an app shares its
routes and its title (`app/hello` keeps them in `client/app.js`, which its server's entry and its
browser's entry both import): `export const juris = { allowSchemes: ["magnet"] }` beside them, and
`createJurisServer({ …, juris })`, `hydrate({ …, juris })`.

```js excerpt
// client/app.js, which server.js and the browser's entry both import
export const routes = [{ path: "/", name: "home", component: "Home" }];
export const title = { suffix: " · Shop" };
export const juris = { allowSchemes: ["magnet"] };
```

Given to one side only, a tag, a scheme or `innerHTML` is drawn by the server and taken away when
the page boots, or refused by the server and drawn once it boots.

```js dom
const server = new Juris({
    allowSchemes: ["magnet"],
    isServer: true,
    features: { ssr: SSRRenderer },
});
const page = document.createElement("main");
page.innerHTML = server.renderToString(download);
page.innerHTML; // → <a href="magnet:?xt=urn:btih:c12f">Download</a>
const browser = new Juris();
browser.mount(page, download);
page.innerHTML; // → <a>Download</a>
```

```js dom
const server = new Juris({
    isServer: true,
    features: { ssr: SSRRenderer },
});
const page = document.createElement("main");
page.innerHTML = server.renderToString(download);
page.innerHTML; // → <a>Download</a>
const browser = new Juris({ allowSchemes: ["magnet"] });
browser.mount(page, download);
page.innerHTML; // → <a href="magnet:?xt=urn:btih:c12f">Download</a>
```

`juris-tests/tests/juris/attributes.test.mjs` gives both renderers one options object and holds what
they draw to the same value; the example below does it for a whole page.

```js dom
const shared = { allowSchemes: ["magnet"] };
const server = new Juris({
    ...shared,
    isServer: true,
    features: { ssr: SSRRenderer },
});
const page = document.createElement("main");
page.innerHTML = server.renderToString(download);
const served = page.innerHTML;
new Juris({ ...shared }).mount(page, download);
page.innerHTML === served; // → true
```

```js dom
function Price(props) {
    return { span: { class: "price", textContent: `${props.amount} €` } };
}
const shared = { components: [Price] };
const server = new Juris({
    ...shared,
    isServer: true,
    features: { ssr: SSRRenderer },
});
const page = document.createElement("main");
const layout = { Price: { amount: 3 } };
page.innerHTML = server.renderToString(layout);
const served = page.innerHTML;
new Juris({ ...shared }).mount(page, layout);
page.innerHTML === served; // → true
page.innerHTML; // → <span class="price">3 €</span>
```

The document's head is not a layout and is checked against the defaults alone (`renderDocument`).

```js
import { renderDocument } from "juris-kit/server/document.js";

const torrent = { rel: "alternate", href: "magnet:?xt=urn:btih:c12f" };
renderDocument({}, { entry: "/app/boot.js", links: [torrent] });
// throws Error: renderDocument: links: href refuses "magnet:?xt=urn:btih:c12f"
```

### A route's own code

The examples on this page build their own instance and router, from:

```js setup
import Juris from "juris/juris.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";
import { createRouter } from "juris/router.js";
```

An app that sends each page's components in a module of its own, fetched when needed, puts
`load(juris)` on the route record: whatever has to happen before the route can be drawn (fetch the
module, register its components).

```js
const juris = new Juris({ features: { ssr: SSRRenderer } });
juris.use(createRouter({
    routes: [{
        path: "/orders",
        component: "Orders",
        load: async (juris) => {
            juris.registerComponent("Orders", () => ({ h1: "Your orders" }));
        },
    }],
}));
juris.hasComponent("Orders"); // → false
await juris.api.navigate("/orders");
juris.hasComponent("Orders"); // → true
juris.renderToString({ RouterView: {} });
// → <h1 data-key="route-0">Your orders</h1>
```

With `register(module, juris)` beside it, `load()` answers the page's module
(`() => import("./pages/x.js")`) and the router registers it: once per module on each instance, so
the routes that share a module share its register, which runs for whichever reaches it first;

```js
// What import("./pages/orders.js") answers: the page's module.
const ordersPage = {
    OrderList: () => ({ ul: {} }),
    OrderDetail: () => ({ article: {} }),
};
const load = async () => ordersPage;
let registered = 0;
const register = (page, juris) => {
    registered += 1;
    juris.registerComponent("OrderList", page.OrderList);
    juris.registerComponent("OrderDetail", page.OrderDetail);
};
const juris = new Juris();
juris.use(createRouter({
    routes: [
        { path: "/orders", component: "OrderList", load, register },
        { path: "/orders/:id", component: "OrderDetail", load, register },
    ],
}));
await juris.api.navigate("/orders/7");
await juris.api.navigate("/orders");
registered; // → 1
juris.hasComponent("OrderList"); // → true
```

a register that throws has its error thrown again to every later load of that module, so a
half-registered module never looks loaded.

```js
const ordersPage = { OrderList: () => ({ ul: {} }) };
let tried = 0;
const register = (page, juris) => {
    tried += 1;
    juris.registerComponent("OrderList", page.OrderList);
    throw new Error("OrderChart is missing");
};
const juris = new Juris();
juris.use(createRouter({
    routes: [{
        path: "/orders",
        component: "OrderList",
        load: async () => ordersPage,
        register,
    }],
}));
await juris.api.navigate("/orders");
// throws Error: OrderChart is missing
await juris.api.navigate("/orders");
// throws Error: OrderChart is missing
tried; // → 1
```

The router awaits every matched record's `load` before it writes the location, on `navigate()` and
on Back and Forward alike, so the page being left stays up until the next one can draw.

```js dom
let arrive;
const arriving = new Promise((resolve) => {
    arrive = resolve;
});
const juris = new Juris();
juris.registerComponent("Home", () => ({ h1: "Shop" }));
juris.use(createRouter({
    routes: [
        { path: "/", component: "Home" },
        {
            path: "/orders",
            component: "Orders",
            load: async (juris) => {
                await arriving;
                juris.registerComponent("Orders", () => ({ h1: "Orders" }));
            },
        },
    ],
}));
const page = document.createElement("main");
juris.render(page, { RouterView: {} });
const going = juris.api.navigate("/orders");
location.pathname; // → "/"
page.textContent; // → "Shop"
arrive();
await going;
location.pathname; // → "/orders"
page.textContent; // → "Orders"
```

It never draws a component that is not registered yet: that renders as an unknown element, and
`RouterView` does not draw it again when the component registers, so the page would stay blank.

```js dom
const juris = new Juris();
juris.use(createRouter({
    routes: [{ path: "/orders", component: "Orders" }],
}));
const page = document.createElement("main");
juris.render(page, { RouterView: {} });
// A raw write of the route skips the load a navigation awaits:
juris.setValue("$route.path", "/orders");
page.innerHTML; // → <orders></orders>
juris.registerComponent("Orders", () => ({ h1: "Orders" }));
page.innerHTML; // → <orders></orders>
```

Each record's `load` runs once per router, so once per instance; one that fails is tried again on
the next navigation.

```js
let loads = 0;
const juris = new Juris();
juris.use(createRouter({
    routes: [
        { path: "/", component: "Home" },
        {
            path: "/orders",
            component: "Orders",
            load: async () => {
                loads += 1;
            },
        },
    ],
}));
await juris.api.navigate("/orders");
await juris.api.navigate("/");
await juris.api.navigate("/orders");
loads; // → 1
```

```js
let attempts = 0;
const juris = new Juris();
juris.use(createRouter({
    routes: [{
        path: "/orders",
        component: "Orders",
        load: async () => {
            attempts += 1;
            if (attempts === 1) throw new Error("network down");
        },
    }],
}));
await juris.api.navigate("/orders"); // throws Error: network down
await juris.api.navigate("/orders");
attempts; // → 2
juris.getState("$route.path"); // → "/orders"
```

A newer navigation, or Back or Forward, supersedes one still loading.

```js dom
let arrive;
const arriving = new Promise((resolve) => {
    arrive = resolve;
});
const juris = new Juris();
juris.use(createRouter({
    routes: [
        { path: "/orders", component: "Orders", load: () => arriving },
        { path: "/cart", component: "Cart" },
    ],
}));
const slow = juris.api.navigate("/orders");
await juris.api.navigate("/cart");
arrive();
await slow; // → false
location.pathname; // → "/cart"
```

If `load` throws or rejects (a module that does not arrive, a register that throws), the router
loads the address in full instead: it makes the address the tab's entry (pushed, replaced, or the
entry Back or Forward reached), marks that entry in `history.state`, and calls the router's
`fullLoad(url)` option, which reloads by default.

```js dom
const reloaded = [];
const juris = new Juris();
juris.use(createRouter({
    routes: [
        { path: "/", component: "Home" },
        {
            path: "/orders",
            component: "Orders",
            load: async () => {
                throw new Error("orders.js did not arrive");
            },
        },
    ],
    fullLoad: (url) => reloaded.push(url),
}));
await juris.api.navigate("/orders"); // → false
location.pathname; // → "/orders"
history.state; // → { juris: true, idx: 1, fullLoad: "/orders" }
reloaded; // → ["/orders"]
```

An entry that already carries the mark for that address is not loaded in full again, so a page
whose code keeps failing cannot loop.

```js dom
// The entry a full load of /orders left, as the reloaded page finds it.
const mark = { juris: true, idx: 1, fullLoad: "/orders" };
history.replaceState(mark, "", "/orders");
const reloaded = [];
const juris = new Juris();
juris.use(createRouter({
    routes: [{
        path: "/orders",
        component: "Orders",
        load: async () => {
            throw new Error("orders.js did not arrive");
        },
    }],
    fullLoad: (url) => reloaded.push(url),
}));
await juris.api.navigate("/orders"); // → false
// console.error: Router: the code for "/orders" did not load, and a full load
reloaded; // → []
```

On a server, where there is no page to load, the navigation rejects with the error instead.

```js
const juris = new Juris();
juris.use(createRouter({
    routes: [{
        path: "/orders",
        component: "Orders",
        load: async () => {
            throw new Error("orders.js did not arrive");
        },
    }],
}));
juris.isServer; // → true
await juris.api.navigate("/orders");
// throws Error: orders.js did not arrive
```

A server loads every route's code up front with `router.loadAll()` (on the instance the router is
installed on, record by record in the table's order, rejecting with the first failure);
`createJurisServer` does so once `setup` has run.

```js
const loaded = [];
const juris = new Juris();
const router = createRouter({
    routes: [
        { path: "/orders", load: async () => loaded.push("orders") },
        { path: "/cart", load: async () => loaded.push("cart") },
        { path: "/account", load: async () => loaded.push("account") },
    ],
});
juris.use(router);
await router.loadAll();
loaded; // → ["orders", "cart", "account"]
```

```js
const loaded = [];
const juris = new Juris();
const router = createRouter({
    routes: [
        {
            path: "/orders",
            load: async () => {
                throw new Error("orders.js has a syntax error");
            },
        },
        { path: "/cart", load: async () => loaded.push("cart") },
    ],
});
juris.use(router);
await router.loadAll(); // throws Error: orders.js has a syntax error
loaded; // → []
```

```js
import { createJurisServer } from "juris-kit/server/kernel.js";

const steps = [];
const app = await createJurisServer({
    root: new URL(".", import.meta.url),
    build: "v1",
    modules: { entry: "/src/client.js" },
    services: {},
    routes: [{
        path: "/orders",
        component: "Orders",
        load: async (juris) => {
            const shell = juris.hasComponent("Shell");
            steps.push(`load, Shell registered: ${shell}`);
        },
    }],
    setup: (juris) => {
        steps.push("setup");
        juris.registerComponent("Shell", () => ({ main: {} }));
    },
});
steps; // → ["setup", "load, Shell registered: true"]
await app.close();
```

### One server instance, every request

The examples on this page build their own instance, from:

```js setup
import Juris from "juris/juris.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";
```

A server renders all its pages with one `Juris` instance, given the kit's string renderer as
`features.ssr` ("`server/ssr-renderer.js`"), and `renderRequest` keeps the requests apart by
replacing the state between them (`clearState`).

```js
const juris = new Juris({ features: { ssr: SSRRenderer } });
juris.registerComponent("CartBadge", (props, api) => ({
    span: () => `${api.getState("cart.count", 0)} in cart`,
}));
const ada = await juris.renderRequest({
    state: { cart: { count: 3 } },
    layout: { CartBadge: {} },
});
const guest = await juris.renderRequest({ layout: { CartBadge: {} } });
ada.html; // → <span>3 in cart</span>
guest.html; // → <span>0 in cart</span>
JSON.parse(guest.json); // → { $ssr: { calls: {} } }
```

What the framework holds to, so that no request reads another's:

- `api.peek` is an untracked read, not an invisible one. In a traced render
  (`renderRequest({ trace: true })`) the path it read is in the trace's `paths` and `roots`, as a
  `getState`'s is, so a server that keeps pages under their URL can refuse a page that read a root
  the URL does not name.

  ```js
  const juris = new Juris({ features: { ssr: SSRRenderer } });
  juris.registerComponent("Greeting", (props, api) => ({
      p: `Hello, ${api.peek("user.name")}`,
  }));
  const page = await juris.renderRequest({
      state: { user: { name: "Ada" } },
      layout: { Greeting: {} },
      trace: true,
  });
  page.html; // → <p>Hello, Ada</p>
  page.trace.paths; // → ["user.name"]
  page.trace.roots; // → ["user"]
  ```

  ```js
  import { decide } from "juris-kit/server/page-cache.js";

  const juris = new Juris({ features: { ssr: SSRRenderer } });
  juris.registerComponent("Greeting", (props, api) => ({
      p: `Hello, ${api.peek("user.name")}`,
  }));
  const page = await juris.renderRequest({
      state: { user: { name: "Ada" } },
      layout: { Greeting: {} },
      trace: true,
  });
  decide(page.trace, { unkeyedRoots: ["user"] });
  // → { cache: false, reason: "request-state:user" }
  ```

- `callCache` (`dedupe`, `ttl`) is a browser cache. A server instance refuses it at construction,
  because a result kept for one visitor, or a call of theirs still in flight, would be the answer to
  the next visitor's identical call. `clearState` empties it on any instance.

  ```js
  new Juris({ callCache: { dedupe: true, ttl: 5000 } });
  // throws Error: Juris: callCache is for a browser instance
  ```

  ```js dom
  let asked = 0;
  const browser = new Juris({
      services: { price: async () => (asked += 1) },
      callCache: { ttl: 60_000 },
  });
  await browser.api.call("price", "milk"); // → 1
  await browser.api.call("price", "milk"); // → 1
  browser.clearState({});
  await browser.api.call("price", "milk"); // → 2
  ```

- The async error logs (`$async.errors`, and each group's `errors`, which `Await`'s `onError` draws)
  belong to the request that produced them: `clearState` drops them (in a browser it keeps the
  in-flight counters beside them; on a server it resets those too, below). On a server their
  messages pass `exposeError`, as a failed preload's do, so a driver's words are kept as "request
  failed"; in a browser a message is kept as it is, because it came from the page's own code or from
  a server that has already filtered it.

  ```js
  const juris = new Juris({ features: { ssr: SSRRenderer } });
  const orders = juris.api.group("orders");
  const refused = Promise.reject(new Error("ECONNREFUSED 10.0.0.5:5432"));
  await orders.track(refused).catch(() => {});
  orders.errors()[0].message; // → "request failed"
  juris.clearState({});
  orders.errors(); // → []
  ```

  ```js dom
  const juris = new Juris();
  const orders = juris.api.group("orders");
  const refused = Promise.reject(new Error("Orders are closed today"));
  await orders.track(refused).catch(() => {});
  orders.errors()[0].message; // → "Orders are closed today"
  ```

- The async counters belong to the request too. On a server `clearState` resets them, each group's
  included (a server render awaits nothing between `clearState` and `serializeState`, so nothing of
  the last request is in flight), and a promise counted before it settles into nothing: a promise
  one request tracked, or one that never settles, used to keep every later request's `Await` on its
  fallback. A browser carries its counters across a clear, as before.

  ```js
  const juris = new Juris({ features: { ssr: SSRRenderer } });
  juris.registerComponent("Orders", (props, api) => {
      if (props.hang) api.group("orders").track(new Promise(() => {}));
      return {
          Await: {
              group: "orders",
              fallback: { p: "Loading…" },
              children: [{ h2: "Your orders" }],
          },
      };
  });
  const first = await juris.renderRequest({ layout: { Orders: { hang: true } } });
  first.html;
  // → <div><p>Loading…</p><div hidden=""><h2>Your orders</h2></div></div>
  const next = await juris.renderRequest({ layout: { Orders: {} } });
  next.html; // → <div><div><h2>Your orders</h2></div></div>
  ```

  ```js dom
  const juris = new Juris();
  const orders = juris.api.group("orders");
  orders.track(new Promise(() => {}));
  juris.clearState({});
  orders.pending(); // → 1
  ```

- A preloaded answer and the state a request is rendered with are the request's own copies (see
  `juris.js`), so a service's cached object is never written by a render, nor carried into the next
  request's page.

  ```js
  const catalog = { milk: { name: "Milk", price: 3 } };
  const juris = new Juris({
      services: { product: async (sku) => catalog[sku] },
      features: { ssr: SSRRenderer },
  });
  juris.registerComponent("Product", (props, api) => {
      const product = api.preloaded("product", "milk");
      product.price = 0;
      return { p: product.name };
  });
  await juris.renderRequest({
      preload: [["product", "milk"]],
      layout: { Product: {} },
  });
  catalog.milk.price; // → 3
  ```

  ```js
  const settings = { theme: "light" };
  const juris = new Juris({ features: { ssr: SSRRenderer } });
  juris.registerComponent("ThemeSwitch", (props, api) => {
      api.setValue("settings.theme", "dark");
      return { p: api.getState("settings.theme") };
  });
  await juris.renderRequest({ state: { settings }, layout: { ThemeSwitch: {} } });
  settings.theme; // → "light"
  ```

- A service is found by name among the instance's own `services` only (`api.call`, `api.live`, a
  preload). A name every object inherits, such as `constructor` or `toString`, is an unknown
  service, as it is to the dispatcher.

  ```js
  const juris = new Juris({
      services: { price: async () => 3 },
      features: { ssr: SSRRenderer },
  });
  await juris.api.call("price", "milk"); // → 3
  await juris.api.call("constructor");
  // throws Error: Juris.call: unknown service "constructor"
  await juris.preload([["toString"]]);
  // throws Error: Juris.preload: unknown service "toString"
  ```

### Local state

The examples on this page build their own instance, from:

```js setup
import Juris from "juris/juris.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";
```

`api.useState(key, initial)` returns `[get, set]` for a slot in the state tree,
`$local.<Component>.<n>.<key>` (the `localPath` option renames the root), where `n` is the
instance's place, in render order, among that component's instances that call `useState`.

```js
const juris = new Juris({ features: { ssr: SSRRenderer } });
juris.registerComponent("FaqItem", (props, api) => {
    const [open, setOpen] = api.useState("open", false);
    setOpen(props.first);
    return { details: { open: () => open(), children: [props.question] } };
});
juris.renderToString({
    div: {
        children: [
            { FaqItem: { question: "Delivery?", first: true } },
            { FaqItem: { question: "Returns?", first: false } },
        ],
    },
});
juris.getState("$local");
// → { FaqItem: { 0: { open: true }, 1: { open: false } } }
```

```js
const juris = new Juris({
    localPath: "$ui",
    features: { ssr: SSRRenderer },
});
juris.registerComponent("Cart", (props, api) => {
    const [, setOpen] = api.useState("open", false);
    setOpen(true);
    return { aside: "Your cart" };
});
juris.renderToString({ Cart: {} });
juris.getState("$ui.Cart.0.open"); // → true
```

An instance takes its number at its first `useState` call, so one that never calls it takes none,
and the next one to call it has the number. The server and the browser set up the same instances
in the same order, so they number them alike.

```js
const juris = new Juris({ features: { ssr: SSRRenderer } });
juris.registerComponent("CartLine", (props, api) => {
    if (props.editable) {
        const [, setQuantity] = api.useState("quantity", 1);
        setQuantity(props.quantity);
    }
    return { li: props.title };
});
const milk = { CartLine: { title: "Milk" } };
const eggs = { CartLine: { title: "Eggs", editable: true, quantity: 6 } };
juris.renderToString({ ul: { children: [milk, eggs] } });
juris.getState("$local.CartLine"); // → { 0: { quantity: 6 } }
```

```js dom
const juris = new Juris();
juris.registerComponent("CartLine", (props, api) => {
    if (!props.editable) return { li: props.title };
    const [quantity] = api.useState("quantity", 1);
    return { li: () => `${props.title} × ${quantity()}` };
});
juris.setValue("$local.CartLine.0.quantity", 6);
const page = document.createElement("main");
juris.render(page, {
    ul: {
        children: [
            { CartLine: { title: "Milk" } },
            { CartLine: { title: "Eggs", editable: true } },
        ],
    },
});
page.innerHTML; // → <ul><li>Milk</li><li>Eggs × 6</li></ul>
```

The instance that called `useState` owns the slot: its shape, when it changes and when it goes
away. The pair is the whole interface.

```js dom
const juris = new Juris();
juris.registerComponent("AddToCart", (props, api) => {
    const [count, setCount] = api.useState("count", 0);
    return {
        button: {
            textContent: () => `Added ${count()}`,
            onclick: () => setCount((n) => n + 1),
        },
    };
});
const page = document.createElement("main");
juris.render(page, { AddToCart: {} });
page.querySelector("button").click();
page.innerHTML; // → <button>Added 1</button>
```

```js dom
const juris = new Juris();
juris.registerComponent("Cart", (props, api) => {
    const [, setOpen] = api.useState("open", false);
    setOpen(true);
    return { aside: "Your cart" };
});
juris.setValue("showCart", true);
const page = document.createElement("main");
juris.render(page, {
    div: { children: () => (juris.getState("showCart") ? [{ Cart: {} }] : []) },
});
juris.getState("$local.Cart.0"); // → { open: true }
juris.setValue("showCart", false);
await Promise.resolve();
juris.getState("$local.Cart.0"); // → undefined
```

Code that reads or writes another component's slot by its path has taken a dependency the owner
does not know about, and it breaks on a change the owner was entitled to make; a component that
wants another's state asks for a prop or a shared path instead.

```js dom
const juris = new Juris();
juris.registerComponent("Counter", (props, api) => {
    const [count] = api.useState("count", 0);
    return { p: { textContent: () => `${props.label}: ${count()}` } };
});
const page = document.createElement("main");
juris.render(page, {
    div: {
        children: [
            { Counter: { label: "Promo" } },
            { Counter: { label: "Cart" } },
        ],
    },
});
// Meant for the cart's counter, written when it was the first one:
juris.setValue("$local.Counter.0.count", 5);
page.textContent; // → "Promo: 5Cart: 0"
```

```js dom
const juris = new Juris();
juris.registerComponent("CartBadge", (props, api) => ({
    strong: () => `${api.getState("cart.count", 0)} in cart`,
}));
const page = document.createElement("main");
juris.render(page, { CartBadge: {} });
juris.setValue("cart.count", 2);
page.innerHTML; // → <strong>2 in cart</strong>
```

The slot is nonetheless an ordinary state path, on purpose: that is how its value crosses from a
server render into the browser, how a test drives a component without its DOM, and how devMode's
`componentTree()` reads it.

```js dom
const juris = new Juris();
juris.registerComponent("AddToCart", (props, api) => {
    const [count] = api.useState("count", 0);
    return { button: { textContent: () => `Added ${count()}` } };
});
const page = document.createElement("main");
juris.render(page, { AddToCart: {} });
// A test, driving the component through its slot:
juris.setValue("$local.AddToCart.0.count", 5);
page.innerHTML; // → <button>Added 5</button>
```

```js dom
const juris = new Juris({ devMode: true });
juris.registerComponent("Cart", (props, api) => {
    const [open] = api.useState("open", false);
    return { aside: { hidden: () => !open() } };
});
juris.render(document.createElement("main"), { Cart: {} });
juris.componentTree()[0].local;
// → { path: "$local.Cart.0", values: { open: false } }
```

So the rule is one for review, not a mechanism. It follows that `$local` is serialised into the
page with the rest of the state, so nothing secret goes in it.

```js
const juris = new Juris({ features: { ssr: SSRRenderer } });
juris.registerComponent("CheckoutForm", (props, api) => {
    const [, setCoupon] = api.useState("coupon", "");
    setCoupon("SPRING");
    return { form: {} };
});
const page = await juris.renderRequest({ layout: { CheckoutForm: {} } });
JSON.parse(page.json).$local;
// → { CheckoutForm: { 0: { coupon: "SPRING" } } }
```

## What the framework stores in a browser

The examples on this page share these imports, and a `sessionStorage` whose keys they can read
back:

```js setup
import Juris from "juris/juris.js";
import { createRouter } from "juris/router.js";
import { STORAGE, trailKey } from "juris/storage.js";

const stored = new Map();
globalThis.sessionStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, String(value)),
    removeItem: (key) => stored.delete(key),
};
```

What the framework stores in a browser is declared in `storage.js`: `STORAGE`, frozen, one entry
per key as `{ key, kind, category, purpose, life }`, which an app that lists what it stores (a cookie
notice) spreads into its own list rather than keeping a copy (JR-F12: a key the framework wrote
was once missing from such a list).

```js
STORAGE.map(({ key, kind, category }) => ({ key, kind, category }));
// → [{ key: "juris:$route:length", kind: "sessionStorage",
//      category: "necessary" }]
Object.isFrozen(STORAGE); // → true
Object.isFrozen(STORAGE[0]); // → true
```

```js
const cookieNotice = [
    ...STORAGE,
    {
        key: "theme",
        kind: "localStorage",
        category: "preferences",
        purpose: "Remembers the colour scheme you picked.",
        life: "Until you clear it.",
    },
];
cookieNotice.map((entry) => entry.key);
// → ["juris:$route:length", "theme"]
```

Today that is one `sessionStorage` key, the router's trail length,
`trailKey({ routePath, base })`: `juris:<routePath>:length` (`juris:$route:length` under the
router's default root), with the base in it when the app is mounted under one
(`juris:/app:$route:length`), so two apps under two bases in one tab keep two trails.

```js
trailKey(); // → "juris:$route:length"
trailKey({ base: "/app" }); // → "juris:/app:$route:length"
trailKey({ routePath: "$nav", base: "/shop" }); // → "juris:/shop:$nav:length"
```

```js dom
history.replaceState(null, "", "/shop/");
const juris = new Juris();
juris.use(createRouter({
    base: "/shop",
    routes: [{ path: "/" }, { path: "/orders" }],
}));
await juris.api.navigate("/orders");
location.pathname; // → "/shop/orders"
[...stored]; // → [["juris:/shop:$route:length", "2"]]
```

- The router writes it on every page it runs in, so that after a reload the tab still knows how far
  Forward can go; its `history` option is `{ storage, key }` (sessionStorage and that key unless
  told) or `false`, which stores nothing and keeps the trail in the page's memory.

  ```js dom
  stored.set("juris:$route:length", "3");
  // A reload of the second entry in the tab's trail, which the router marked:
  history.replaceState({ juris: true, idx: 1 }, "", "/orders");
  const juris = new Juris();
  juris.use(createRouter({ routes: [{ path: "/" }, { path: "/orders" }] }));
  juris.getState("$route.history"); // → { index: 1, length: 3 }
  juris.api.canForward(); // → true
  ```

  ```js dom
  const juris = new Juris();
  juris.use(createRouter({
      history: false,
      routes: [{ path: "/" }, { path: "/orders" }],
  }));
  await juris.api.navigate("/orders");
  juris.getState("$route.history"); // → { index: 1, length: 2 }
  stored.size; // → 0
  ```

  ```js dom
  const own = new Map();
  const storage = {
      getItem: (key) => own.get(key) ?? null,
      setItem: (key, value) => own.set(key, value),
  };
  const juris = new Juris();
  juris.use(createRouter({
      history: { storage, key: "shop:trail" },
      routes: [{ path: "/" }, { path: "/orders" }],
  }));
  await juris.api.navigate("/orders");
  [...own]; // → [["shop:trail", "2"]]
  ```

  An entry the router has not marked is a fresh one (the tab came to the address anew), where a
  stored length is not believed: what lay ahead of it is gone.

  ```js dom
  stored.set("juris:$route:length", "3");
  // The tab came to /orders anew: typed, or a link from another site.
  history.replaceState(null, "", "/orders");
  const juris = new Juris();
  juris.use(createRouter({ routes: [{ path: "/" }, { path: "/orders" }] }));
  juris.getState("$route.history"); // → { index: 0, length: 1 }
  juris.api.canForward(); // → false
  stored.get("juris:$route:length"); // → "1"
  ```

  `api.canBack()` and `api.canForward()` say, tracked, whether the trail goes anywhere (false on a
  server).

  ```js dom
  const juris = new Juris();
  juris.use(createRouter({ routes: [{ path: "/" }, { path: "/orders" }] }));
  const page = document.createElement("main");
  juris.render(page, {
      button: { disabled: () => !juris.api.canBack(), textContent: "Back" },
  });
  page.innerHTML; // → <button disabled="">Back</button>
  await juris.api.navigate("/orders");
  page.innerHTML; // → <button>Back</button>
  ```

  ```js
  const juris = new Juris();
  juris.use(createRouter({ routes: [{ path: "/" }, { path: "/orders" }] }));
  await juris.api.navigate("/orders");
  juris.api.canBack(); // → false
  juris.api.canForward(); // → false
  ```

- The skew guard of `client.js` writes one more key, when an app turns it on, under the key the app
  gives it, which is the app's to declare.

  ```js dom
  import { hydrate } from "juris/client.js";

  // A page the server rendered as route "home", which this build calls "start":
  document.body.innerHTML = '<div id="app"></div>'
      + '<script type="application/json" id="state">'
      + '{"$route":{"path":"/","name":"home"}}</script>';
  let reloads = 0;
  const juris = await hydrate({
      routes: [{ path: "/", name: "start" }],
      live: false,
      skewGuard: { storageKey: "shop:reloaded", reload: () => (reloads += 1) },
  });
  // console.warn: Juris: the server rendered this page as route "home"
  juris; // → null
  reloads; // → 1
  [...stored.keys()]; // → ["juris:$route:length", "shop:reloaded"]
  ```

- Nothing else in `src/` writes browser storage or a cookie today.

  ```js
  import { readdir, readFile } from "node:fs/promises";
  import { dirname, join } from "node:path";
  import { fileURLToPath } from "node:url";

  const juris = import.meta.resolve("juris/juris.js");
  const src = dirname(fileURLToPath(juris));
  const writers = [];
  for (const name of (await readdir(src)).sort()) {
      if (!name.endsWith(".js")) continue;
      const code = await readFile(join(src, name), "utf8");
      if (/\.setItem\(|document\.cookie\s*=/.test(code)) writers.push(name);
  }
  writers; // → ["client.js", "router.js"]
  ```

  The router also keeps its own fields in `history.state` on the entries it makes: the entry's
  place in the trail (`juris`, `idx`) and, after a failed `load`, the address it loaded in full
  (`fullLoad`). Those belong to the tab's history entries and go with them; a replace keeps
  whatever else is on the entry, and a new entry carries nothing of the last one's.

  ```js dom
  // What another script keeps on the entry: where the reader had scrolled.
  history.replaceState({ scrollY: 120 }, "", "/");
  const juris = new Juris();
  juris.use(createRouter({
      routes: [{ path: "/" }, { path: "/orders" }, { path: "/cart" }],
  }));
  history.state; // → { scrollY: 120, juris: true, idx: 0 }
  await juris.api.navigate("/orders");
  history.state; // → { juris: true, idx: 1 }
  history.replaceState({ ...history.state, scrollY: 40 }, "");
  await juris.api.navigate("/cart", { replace: true });
  history.state; // → { scrollY: 40, juris: true, idx: 1 }
  ```

## The browser floor

The examples on this page read the framework's own files, the top-level `src/*.js` a browser
downloads, with:

```js setup
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const juris = import.meta.resolve("juris/juris.js");
const src = dirname(fileURLToPath(juris));

// The names of the files whose text matches `pattern`.
async function filesUsing(pattern) {
    const found = [];
    for (const name of (await readdir(src)).sort()) {
        if (!name.endsWith(".js")) continue;
        const text = await readFile(join(src, name), "utf8");
        if (pattern.test(text)) found.push(name);
    }
    return found;
}
```

Juris is written for Safari and iOS Safari 15.4, Chrome and Edge 93, Firefox 92, and anything newer
(no suite runs in a browser at that floor: it is read from the features `src/` uses). The floor is
set by the newest feature `src/` relies on, `Object.hasOwn` (in `juris.js`, `router.js`,
`errors.js` and others); everything else it uses (`??=`, optional chaining, module scripts, dynamic
`import()`, and in `devtools.js` `WeakRef`, `CustomEvent` and `performance.now()`) is older.

```js
const using = await filesUsing(/Object\.hasOwn\(/);
["juris.js", "router.js", "errors.js"].every((name) => using.includes(name));
// → true
```

There is no build step to translate newer code for an older browser, so a module that uses
something newer fails to link or to run there, and the page stays the server's page, readable and
not live.

```js
import { renderDocument } from "juris-kit/server/document.js";

const page = renderDocument(
    { html: "<h1>Your orders</h1>" },
    { title: "Orders", entry: "/app/boot.js" },
);
// The page, whole, before any module runs:
page.includes('<div id="app"><h1>Your orders</h1></div>'); // → true
// What makes it live: a module, which an older browser fails to run.
page.includes('import("/app/boot.js").then((m) => m.start())'); // → true
```

- **Nothing newer than the floor in a top-level `src/*.js`.** `juris/tests/boundary.test.mjs` ("the
  browser floor holds in what a browser runs") refuses the newer features most likely to be reached
  for: an array's `toSorted` and `with`, `Object.groupBy`, `Promise.withResolvers`,
  `structuredClone` (Chrome and Edge 98, Firefox 94), an array's `findLast` (Chrome and Edge 97,
  Firefox 104), `crypto.randomUUID` (Firefox 95), a class static block, a lookbehind in a regular
  expression, `URL.canParse`, the new `Set` methods, and the others it lists. A feature it does not
  list is review's to catch, in all three engines: a feature Safari 15.4 has can still be newer than
  Chrome 93 or Firefox 92, as those three are.

  ```js
  await filesUsing(/\.toSorted\(|\bObject\.groupBy\b|\bPromise\.withResolvers\b/);
  // → []
  await filesUsing(/\bstructuredClone\(|\.findLast(Index)?\(/); // → []
  await filesUsing(/\bcrypto\.randomUUID\(|\bURL\.canParse\b|\(\?<[=!]/); // → []
  ```

- `Array.prototype.at` and `replaceChildren` are within the floor. A lower floor would mean
  replacing `Object.hasOwn` first.

  ```js
  const orders = [
      { id: 1, paid: true },
      { id: 2, paid: true },
      { id: 3, paid: false },
  ];
  // findLast is newer than the floor; filter and at are within it:
  orders.filter((order) => order.paid).at(-1).id; // → 2
  ```

  ```js
  const cart = { coupon: "SPRING" };
  Object.hasOwn(cart, "coupon"); // → true
  // Below the floor, each such call would be the older spelling:
  Object.prototype.hasOwnProperty.call(cart, "coupon"); // → true
  ```

- `requestIdleCallback`, which Safari at the floor lacks, is used only where a timer stands in for
  it (`client.js` and the document's loader).

  ```js
  await filesUsing(/requestIdleCallback/); // → ["client.js"]
  ```

  ```js
  import { renderDocument } from "juris-kit/server/document.js";

  const page = renderDocument({}, { entry: "/app/boot.js" });
  page.includes('typeof requestIdleCallback === "function"'); // → true
  page.includes("requestIdleCallback : (fn) => setTimeout(fn, 1)"); // → true
  ```

- Raising the floor is a change to this section first, then to the test's list.

  ```js
  // The test's list holds a pattern per feature newer than the floor:
  const newer = [
      [/\.toSorted\(/, "Array.prototype.toSorted"],
      [/\bstructuredClone\(/, "structuredClone"],
      [/\bstatic\s*\{/, "class static block"],
  ];
  const found = [];
  for (const [pattern, feature] of newer) {
      for (const name of await filesUsing(pattern)) {
        found.push(`${name}: ${feature}`);
    }
  }
  found; // → []
  ```

The Node half runs, and is tested here, on Node 24, which is what the packages declare.

```js
const kernel = import.meta.resolve("juris-kit/server/kernel.js");
const pkg = new URL("../package.json", kernel);
const kit = JSON.parse(await readFile(pkg, "utf8"));
kit.engines; // → { node: ">=24" }
```

## Security defaults and invariants

What the framework promises about safety, where the code is that keeps each promise, and the test
that fails when it breaks. Where a rule closed a finding of the framework review, its id is given
(`JR-…`).

### The defaults

These are the boundary's rule 4. All six are the framework's own, and an app that wants less says so
in its own code.

| Default | Held by | Test |
| --- | --- | --- |
| An error's message is denied unless the error was written for its reader (`error.expose === true`, which `ServiceError` sets) (JR-F5). | `defaultExposeError`, `mayExpose` and `publicMessage` in `errors.js`; the default of the dispatcher's, the kernel's and, on a server, `Juris`'s own `exposeError` (a failed preload, the async error logs). | `juris-tests/tests/juris/errors.test.mjs`, `juris-tests/tests/juris-kit/service-dispatcher.calls.test.mjs`, `juris-tests/tests/juris-kit/kernel.server.test.mjs`, `juris-tests/tests/juris/juris.calls.test.mjs` |
| Unsafe tags (`style` and `plaintext` among them), `innerHTML`, style keys and values that are not one property's value, and URL schemes are refused, on both sides; an element already there is taken for a layout only when its tag would be drawn, and `enhance` refuses to adopt one whose tag is refused; an app names what it adds (`juris`: `allowTags`, `allowSchemes`, `allowInnerHTML`). | `html-safety.js` (`checkTag`, `checkInnerHTML`, `checkStyle`, `classTokens`, `reusableElement`, `checkAttribute`), both renderers. | `juris-tests/tests/juris/html-safety.test.mjs`, `juris-tests/tests/juris/elements.test.mjs`, `juris-tests/tests/juris/attributes.test.mjs`, `juris/tests/render.test.mjs`, `juris-kit/tests/ssr-renderer.test.mjs` |
| A live query needs `authorize` or `public: true`. | `serviceDispatcher`, at construction. | `juris-tests/tests/juris-kit/service-dispatcher.test.mjs` |
| Every value written into a document is escaped, apart from the one slot an app marks trusted (JR-F1). | `renderDocument`. | `juris-tests/tests/juris-kit/document.test.mjs` |
| A personal page is never cached, and goes out `private, no-cache` (`no-store` in development). | `createPagePipeline` (never keeps a page rendered for a viewer, never serves a viewer the guests' copy), and `decide`, which refuses such a page on its own. | `juris-tests/tests/juris-kit/kernel.pipeline.test.mjs`, `juris-tests/tests/juris-kit/page-cache.test.mjs` |
| Cluster workers are refused beside live queries. | `startProcess` refuses to fork them; `createJurisServer` refuses to serve in one, unless the app says `allow` (`allowWorkers`). | `juris-tests/tests/juris-kit/process.test.mjs`, `juris-tests/tests/juris-kit/kernel.config.test.mjs` |

The examples under the defaults share an instance that renders to a string, and a shop's server
started on a free port:

```js setup
import Juris from "juris/juris.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";
import { createJurisServer } from "juris-kit/server/kernel.js";

const juris = new Juris({ features: { ssr: SSRRenderer } });

// A shop's server on a free port: createJurisServer with the plumbing
// filled in (where the app is, its build, its browser entry, its layout).
async function openShop(config) {
    const app = await createJurisServer({
        root: new URL(".", import.meta.url),
        build: "v1",
        modules: { entry: "/src/client.js" },
        layout: { RouterView: {} },
        services: {},
        routes: [],
        ...config,
    });
    const { url } = await app.listen();
    return { app, url };
}
```

An error's message is denied unless the error was written for its reader (JR-F5):

```js
import { publicMessage, ServiceError } from "juris/errors.js";

publicMessage(new Error('relation "users" does not exist'));
// → "request failed"
publicMessage(new ServiceError("That coupon has expired."));
// → "That coupon has expired."
```

```js
import { fail } from "juris/errors.js";

const { app, url } = await openShop({
    services: {
        checkout: async () => {
            throw new Error("ECONNREFUSED 10.0.0.5:5432");
        },
        applyCoupon: async () => fail("That coupon has expired."),
    },
    onError: () => {},
});
const post = (name) => fetch(`${url}/api/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "[]",
});
await (await post("checkout")).json(); // → { error: "request failed" }
await (await post("applyCoupon")).json();
// → { error: "That coupon has expired." }
await app.close();
```

```js
const shop = new Juris({
    services: {
        stock: async () => {
            throw new Error("ECONNREFUSED 10.0.0.5:5432");
        },
    },
});
await shop.preload([["stock", "milk"]]);
// → { calls: { 'stock:["milk"]': { $error: "request failed" } } }
```

Unsafe tags (`style` and `plaintext` among them), `innerHTML`, style keys and values that are not
one property's value, and URL schemes are refused, on both sides:

```js
juris.renderToString({
    div: {
        children: [
            { style: "body { display: none }" },
            { plaintext: "" },
            { p: { innerHTML: "<img src=x onerror=steal()>" } },
            { a: { href: "javascript:steal()", textContent: "Win" } },
            { b: { style: { color: "red; background: url(//evil.example)" } } },
        ],
    },
});
// → <div><p></p><a>Win</a><b></b></div>
```

```js dom
const page = document.createElement("main");
new Juris().render(page, {
    div: {
        children: [
            { style: "body { display: none }" },
            { plaintext: "" },
            { p: { innerHTML: "<img src=x onerror=steal()>" } },
            { a: { href: "javascript:steal()", textContent: "Win" } },
            { b: { style: { color: "red; background: url(//evil.example)" } } },
        ],
    },
});
page.innerHTML; // → <div><p></p><a>Win</a><b></b></div>
```

An element already there is taken for a layout only when its tag would be drawn, and `enhance`
refuses to adopt one whose tag is refused; an app names what it adds:

```js dom
const page = document.createElement("main");
page.innerHTML = '<iframe src="/ads/1"></iframe>';
new Juris().enhance(page.querySelector("iframe"), { src: "/ads/2" });
// throws Error: Juris.enhance: cannot enhance it: <iframe> is not allowed
```

```js
const embeds = new Juris({
    allowTags: ["iframe"],
    allowSchemes: ["magnet"],
    features: { ssr: SSRRenderer },
});
embeds.renderToString({ iframe: { src: "https://maps.example/embed" } });
// → <iframe src="https://maps.example/embed"></iframe>
embeds.renderToString({
    a: { href: "magnet:?xt=urn:btih:c12f", textContent: "Get" },
});
// → <a href="magnet:?xt=urn:btih:c12f">Get</a>
```

A live query needs `authorize` or `public: true`:

```js
import {
    serviceDispatcher,
} from "juris-kit/server/service-dispatcher.js";

const services = { orders: async (userId) => [] };
serviceDispatcher(services, "/api", { live: { queries: ["orders"] } });
// throws Error: serviceDispatcher: live queries need live.authorize
const board = serviceDispatcher(services, "/api", {
    live: { queries: ["orders"], public: true },
});
board.names; // → ["orders"]
```

```js
await openShop({
    services: { orders: async (userId) => [] },
    api: { live: { queries: ["orders"] } },
});
// throws Error: serviceDispatcher: live queries need live.authorize
```

Every value written into a document is escaped, apart from the one slot an app marks trusted
(JR-F1):

```js
import { renderDocument } from "juris-kit/server/document.js";

const page = renderDocument({}, {
    entry: "/app/boot.js",
    title: "</title><script>steal()</script>",
    description: '"><script>steal()</script>',
});
page.match(/<title>.*<\/title>/)[0];
// → <title>&lt;/title&gt;&lt;script&gt;steal()&lt;/script&gt;</title>
page.includes('content="&quot;&gt;&lt;script&gt;steal()&lt;/script&gt;"');
// → true
```

```js
import { renderDocument } from "juris-kit/server/document.js";

const theme = "<script>document.documentElement.className = 'dark'</script>";
const page = renderDocument({}, { entry: "/app/boot.js", trustedHead: theme });
page.includes(theme); // → true
```

A personal page is never cached, and goes out `private, no-cache` (`no-store` in development):

```js
const { app, url } = await openShop({
    routes: [{ path: "/account", component: "Account" }],
    setup: (juris) => {
        juris.registerComponent("Account", () => ({ h1: "Your account" }));
    },
    page: { viewer: (req) => (req.headers.cookie ? { id: "u1" } : null) },
});
const ada = await fetch(`${url}/account`, {
    headers: { cookie: "session=4f9c" },
});
ada.headers.get("cache-control"); // → "private, no-cache"
await app.close();
```

```js
const { app, url } = await openShop({
    dev: true,
    routes: [{ path: "/account", component: "Account" }],
    setup: (juris) => {
        juris.registerComponent("Account", () => ({ h1: "Your account" }));
    },
    page: { viewer: () => ({ id: "u1" }) },
});
const res = await fetch(`${url}/account`);
res.headers.get("cache-control"); // → "no-store"
await app.close();
```

```js
import { decide } from "juris-kit/server/page-cache.js";

const trace = { static: true, flags: [], roots: [], services: [] };
decide(trace);
// → { cache: true, reason: "static", forever: true, services: [] }
decide(trace, { viewer: { id: "u1" } });
// → { cache: false, reason: "personal" }
```

Cluster workers are refused beside live queries:

```js
import { startProcess } from "juris-kit/server/process.js";

startProcess({ workers: 4 });
// throws Error: 4 workers on one port would break live queries
const worker = { isPrimary: false };
startProcess({ workers: 4, liveQueries: false, cluster: worker });
// → "serve"
```

```js
const live = {
    services: { orders: async () => [] },
    api: { live: { queries: ["orders"], public: true } },
};
await openShop({ ...live, cluster: { isWorker: true } });
// throws Error: createJurisServer: this is a cluster worker, and live queries
const { app } = await openShop({
    ...live,
    cluster: { isWorker: true },
    allowWorkers: true,
});
await app.close();
```

What stays the app's is saying who the viewer is, through the page's `viewer(req, url)` hook: one
that names nobody makes every page a guest's, public and kept when there is a cache.

```js
import { createPageCache } from "juris-kit/server/page-cache.js";
import {
    serviceDispatcher,
} from "juris-kit/server/service-dispatcher.js";

const cache = createPageCache();
const { app, url } = await openShop({
    api: serviceDispatcher({}, "/api"),
    cache,
    routes: [{ path: "/account", component: "Account" }],
    setup: (juris) => {
        juris.registerComponent("Account", () => ({ h1: "Your account" }));
    },
    page: { viewer: () => null },
});
const res = await fetch(`${url}/account`, {
    headers: { cookie: "session=4f9c" },
});
res.headers.get("cache-control"); // → "public, max-age=0, must-revalidate"
cache.has("/account"); // → true
await app.close();
```

Outside pages, `send` and `sendFile` answer `private, no-cache` unless the caller names another
policy.

```js
import http from "node:http";
import { pack, send } from "juris-kit/server/http.js";

const receipt = pack('{"order":7,"total":12}');
const server = http.createServer((req, res) => {
    const type = "application/json";
    if (req.url === "/receipt") send(req, res, receipt, { type });
    else send(req, res, receipt, { type, cache: "no-store" });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const mine = await fetch(`${base}/receipt`);
mine.headers.get("cache-control"); // → "private, no-cache"
const told = await fetch(`${base}/receipt.json`);
told.headers.get("cache-control"); // → "no-store"
server.closeAllConnections();
server.close();
```

```js
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { sendFile } from "juris-kit/server/http.js";

const dir = await mkdtemp(path.join(tmpdir(), "shop-"));
const invoice = path.join(dir, "invoice-7.pdf");
await writeFile(invoice, "%PDF-1.7");
const server = http.createServer((req, res) => {
    sendFile(req, res, invoice, { type: "application/pdf" });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const res = await fetch(`http://127.0.0.1:${server.address().port}/`);
res.headers.get("cache-control"); // → "private, no-cache"
server.closeAllConnections();
server.close();
await rm(dir, { recursive: true });
```

### The invariants

The examples under the invariants share an instance that renders to a string, a shop's server
started on a free port, and a request that sends a path exactly as it is written:

```js setup
import http from "node:http";
import Juris from "juris/juris.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";
import { createJurisServer } from "juris-kit/server/kernel.js";

const juris = new Juris({ features: { ssr: SSRRenderer } });

// A shop's server on a free port: createJurisServer with the plumbing
// filled in (where the app is, its build, its browser entry, its layout).
async function openShop(config) {
    const app = await createJurisServer({
        root: new URL(".", import.meta.url),
        build: "v1",
        modules: { entry: "/src/client.js" },
        layout: { RouterView: {} },
        services: {},
        routes: [],
        ...config,
    });
    const { url } = await app.listen();
    return { app, url };
}

// A request for `path` as written (fetch, like a browser, resolves "."
// and ".." first): { status, headers, body }.
function request(url, path, { method = "GET", headers = {}, body } = {}) {
    const { hostname, port } = new URL(url);
    return new Promise((resolve, reject) => {
        const options = { hostname, port, path, method, headers };
        const req = http.request(options, (res) => {
            let text = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
                text += chunk;
            });
            res.on("end", () => {
                const { statusCode: status, headers } = res;
                resolve({ status, headers, body: text });
            });
        });
        req.on("error", reject);
        req.end(body);
    });
}
```

**Requests and responses** (`server/kernel.js`, `server/http.js`, `server/page-cache.js`)

- Nothing a request carries ends the instance, and nothing that throws is shown to it: a target no
  URL can be made of is a 400 (JR-F14), and anything that throws is a fixed 500 whose body says
  nothing, the error going to the log (JR-F3); `/healthz` fails with a fixed body too.
  `juris-tests/tests/juris-kit/kernel.lifecycle.test.mjs`.

  ```js
  const { app, url } = await openShop({
      routes: [{ path: "/orders", name: "orders", component: "Orders" }],
      setup: (juris) => {
          juris.registerComponent("Orders", () => ({ h1: "Your orders" }));
      },
  });
  const bad = await request(url, "//[x");
  bad.status; // → 400
  bad.body; // → "Bad request."
  (await fetch(`${url}/orders`)).status; // → 200
  await app.close();
  ```

  ```js
  const logged = [];
  const { app, url } = await openShop({
      routes: [{ path: "/orders", name: "orders", component: "Orders" }],
      setup: (juris) => {
          juris.registerComponent("Orders", () => {
              throw new Error('relation "orders" does not exist');
          });
      },
      onError: (error, where) => logged.push(`${where}: ${error.message}`),
  });
  const res = await fetch(`${url}/orders`);
  res.status; // → 500
  await res.text();
  // → "Something went wrong on our side. Try again in a moment."
  logged; // → ['request: relation "orders" does not exist']
  await app.close();
  ```

  ```js
  const logged = [];
  const { app, url } = await openShop({
      health: {
          check: async () => {
              throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
          },
      },
      onError: (error, where) => logged.push(`${where}: ${error.message}`),
  });
  const res = await fetch(`${url}/healthz`);
  res.status; // → 503
  await res.json(); // → { ok: false, error: "unavailable" }
  logged; // → ["healthz: connect ECONNREFUSED 10.0.0.5:5432"]
  await app.close();
  ```

- A malformed cookie is skipped, never thrown (JR-F4), and a cookie is written with safe defaults or
  refused. `juris-tests/tests/juris-kit/http.test.mjs`.

  ```js
  import { parseCookies } from "juris-kit/server/http.js";

  parseCookies("theme=dark; cart=%E0%A4%A; session=4f9c");
  // → { theme: "dark", session: "4f9c" }
  ```

  ```js
  import { serializeCookie } from "juris-kit/server/http.js";

  serializeCookie("session", "4f9c");
  // → "session=4f9c; Path=/; HttpOnly; SameSite=Lax; Secure"
  serializeCookie("cart", "milk; Domain=evil.example").split("; ");
  // → ["cart=milk%3B%20Domain%3Devil.example", "Path=/", "HttpOnly",
  //     "SameSite=Lax", "Secure"]
  ```

  ```js
  import { serializeCookie } from "juris-kit/server/http.js";

  serializeCookie("session", "4f9c", { sameSite: "None", secure: false });
  // throws TypeError: serializeCookie: SameSite=None needs Secure
  serializeCookie("session", "4f9c", { path: "/; Domain=evil.example" });
  // throws TypeError: serializeCookie: "/; Domain=evil.example" is not a cookie
  ```

- A path has one spelling: `canonicalPath` redirects any other (dot segments in any spelling, `\`)
  before the guard, the cache key or the render reads it (JR-F13), and the canonical link is encoded
  (JR-F2). `juris-tests/tests/juris-kit/page-cache.paths.test.mjs`,
  `juris-tests/tests/juris-kit/kernel.pipeline.test.mjs`.

  ```js
  const { app, url } = await openShop({
      routes: [{ path: "/admin", name: "admin", component: "Admin" }],
      router: {
          guard: (to, { viewer }) => {
              return to.name === "admin" && !viewer ? "/login" : null;
          },
      },
      setup: (juris) => {
          juris.registerComponent("Admin", () => ({ h1: "Admin" }));
      },
  });
  const spellings = ["/admin//", "//admin", "/orders/%2e%2e/admin", "/\\admin"];
  for (const path of spellings) {
      const res = await request(url, path);
      [res.status, res.headers.location]; // → [301, "/admin"]
  }
  const res = await request(url, "/admin");
  [res.status, res.headers.location]; // → [302, "/login"]
  await app.close();
  ```

  ```js
  const { app } = await openShop({
      routes: [{ path: "/search/:q", name: "search", component: "Search" }],
      page: { origin: "https://shop.example" },
      setup: (juris) => {
          juris.registerComponent("Search", () => ({ h1: "Results" }));
      },
  });
  const page = await app.render('/search/"><script>', null);
  page.body.toString().match(/rel="canonical" href="([^"]*)"/)[1];
  // → "https://shop.example/search/%22%3E%3Cscript%3E"
  await app.close();
  ```

- A page is answered in one fixed order (path, viewer, guard, `before`, cache, render, answer), and
  nothing runs inside a render: `renderRequest` awaits nothing between `clearState` and
  `serializeState`, and every hook runs before or after it, so two requests on the one instance
  never see each other's state. A guard is a pure function of the route and who is asking.
  `juris-tests/tests/juris-kit/kernel.pipeline.test.mjs` ("handle: guards are pure, so two viewers'
  requests through one instance each get their own verdict").

  ```js
  const order = [];
  const note = (step, value) => {
      order.push(step);
      return value;
  };
  const { app, url } = await openShop({
      routes: [{ path: "/cart", name: "cart", component: "Cart" }],
      page: {
          viewer: () => note("viewer", null),
          before: [() => note("before", null)],
          state: () => note("state", {}),
          head: () => note("head", {}),
      },
      setup: (juris) => {
          juris.registerComponent("Cart", () => note("render", { h1: "Cart" }));
      },
  });
  await fetch(`${url}/cart`);
  order; // → ["viewer", "before", "state", "render", "head"]
  await app.close();
  ```

  ```js
  const { app, url } = await openShop({
      routes: [{ path: "/account", name: "account", component: "Account" }],
      page: {
          viewer: (req) => req.headers["x-user"] ?? null,
          state: async ({ viewer }) => {
              const wait = viewer === "Ada" ? 30 : 0;
              await new Promise((done) => setTimeout(done, wait));
              return { user: { name: viewer } };
          },
      },
      setup: (juris) => {
          juris.registerComponent("Account", (props, api) => ({
              h1: `Hello, ${api.getState("user.name")}`,
          }));
      },
  });
  const visit = async (name) => {
      const res = await fetch(`${url}/account`, { headers: { "x-user": name } });
      return (await res.text()).match(/Hello, \w+/)[0];
  };
  await Promise.all([visit("Ada"), visit("Grace")]);
  // → ["Hello, Ada", "Hello, Grace"]
  await app.close();
  ```

  ```js
  const { app, url } = await openShop({
      routes: [
          { path: "/admin", name: "admin", component: "Admin" },
          { path: "/login", name: "login", component: "Admin" },
      ],
      router: {
          guard: (to, { viewer }) => {
              return to.name === "admin" && !viewer ? "/login" : null;
          },
      },
      page: { viewer: (req) => req.headers["x-user"] ?? null },
      setup: (juris) => {
          juris.registerComponent("Admin", () => ({ h1: "Admin" }));
      },
  });
  const admin = { headers: { "x-user": "Ada" }, redirect: "manual" };
  const guest = { redirect: "manual" };
  const answers = await Promise.all([
      fetch(`${url}/admin`, admin),
      fetch(`${url}/admin`, guest),
  ]);
  answers.map((res) => res.status); // → [200, 302]
  await app.close();
  ```

- What a request's own failure shaped is never kept, so a guest cannot fill the cache with it and
  push real pages out: a 404 (no route, or a subject that is not there) and a render whose preloaded
  call failed, which goes out as a 200 and leaves the page kept before it as it was. What a guest
  can fill it with, one page per value of a parameter pages read, holds a share of the cache
  (`maxQueryEntries`) and pushes out only its own kind.
  `juris-tests/tests/juris-kit/kernel.pipeline.test.mjs`,
  `juris-tests/tests/juris-kit/page-cache.cache.test.mjs`.

  ```js
  import { createPageCache } from "juris-kit/server/page-cache.js";

  const cache = createPageCache();
  const trace = { flags: [], roots: [], services: [], static: true };
  cache.put("/wp-admin", "<h1>Not found</h1>", trace, { status: 404 });
  // → { cache: false, reason: "not-found" }
  cache.has("/wp-admin"); // → false
  ```

  ```js
  import { createPageCache } from "juris-kit/server/page-cache.js";

  const cache = createPageCache();
  const trace = { flags: [], roots: [], services: ["product"], static: false };
  cache.put("/products/7", "<h1>Milk</h1>", trace, {});
  const failed = { ...trace, failed: ["product"] };
  cache.put("/products/7", "<p>Try again later.</p>", failed, {});
  // → { cache: false, reason: "failed:product" }
  cache.get("/products/7"); // → { entry: "<h1>Milk</h1>", stale: false }
  ```

  ```js
  import { createPageCache } from "juris-kit/server/page-cache.js";

  const cache = createPageCache({ maxEntries: 4, maxQueryEntries: 2 });
  const trace = { flags: [], roots: [], services: [], static: true };
  cache.put("/", "<h1>Shop</h1>", trace, {});
  cache.put("/about", "<h1>About us</h1>", trace, {});
  for (const q of ["milk", "eggs", "tea", "jam"]) {
      cache.put(`/search?q=${q}`, `<h1>${q}</h1>`, trace, {});
  }
  cache.has("/"); // → true
  cache.has("/about"); // → true
  cache.has("/search?q=milk"); // → false
  cache.has("/search?q=jam"); // → true
  ```

- A kept page is evicted by every change to what it read: the route's own call is in its trace
  whatever its body calls, and a page rendered across an `EVERYTHING` invalidation or a `clear()` is
  not put. A viewer's page is never put, so it never evicts the guests' copy.
  `juris-kit/tests/server.test.mjs`.

  ```js
  const { app } = await openShop({
      services: { product: async (id) => ({ id, name: "Milk" }) },
      routes: [{
          path: "/products/:id",
          name: "product",
          component: "Product",
          preload: ({ params }) => [["product", params.id]],
      }],
      setup: (juris) => {
          juris.registerComponent("Product", () => ({ h1: "A product" }));
      },
  });
  const page = await app.render("/products/7", null);
  page.trace.services; // → ["product"]
  page.trace.static; // → false
  await app.close();
  ```

  ```js
  import {
      createPageCache,
      EVERYTHING,
  } from "juris-kit/server/page-cache.js";

  const cache = createPageCache();
  const trace = { flags: [], roots: [], services: [], static: true };
  const before = cache.snapshot();
  cache.invalidate(EVERYTHING);
  cache.put("/", "<h1>Shop</h1>", trace, {}, before);
  // → { cache: false, reason: "raced", forever: true, services: [] }
  cache.has("/"); // → false
  ```

  ```js
  import { createPageCache } from "juris-kit/server/page-cache.js";
  import {
      serviceDispatcher,
  } from "juris-kit/server/service-dispatcher.js";

  const cache = createPageCache();
  const { app, url } = await openShop({
      api: serviceDispatcher({}, "/api"),
      cache,
      routes: [{ path: "/", name: "home", component: "Home" }],
      page: { viewer: (req) => (req.headers.cookie ? { name: "Ada" } : null) },
      setup: (juris) => {
          juris.registerComponent("Home", () => ({ h1: "Shop" }));
      },
  });
  await fetch(url);
  cache.has("/"); // → true
  const ada = await fetch(url, { headers: { cookie: "session=4f9c" } });
  ada.headers.get("cache-control"); // → "private, no-cache"
  cache.has("/"); // → true
  await app.close();
  ```

- A cacheable page is rendered from its cache key, so no visitor's query parameters reach another
  (JR-C10). `juris-tests/tests/juris-kit/kernel.pipeline.test.mjs`.

  ```js
  import { createPageCache } from "juris-kit/server/page-cache.js";
  import {
      serviceDispatcher,
  } from "juris-kit/server/service-dispatcher.js";

  const { app, url } = await openShop({
      api: serviceDispatcher({}, "/api"),
      cache: createPageCache(),
      routes: [{ path: "/orders", name: "orders", component: "Orders" }],
      page: { cacheParams: ["page"] },
      setup: (juris) => {
          juris.registerComponent("Orders", () => ({ h1: "Orders" }));
      },
  });
  const res = await fetch(`${url}/orders?page=2&invite=ada-4f9c`);
  const html = await res.text();
  html.match(/"query":\{[^}]*\}/)[0]; // → '"query":{"page":"2"}'
  html.includes("ada-4f9c"); // → false
  await app.close();
  ```

- An ETag names its content on every Node (JR-C7), and a Range header is read as RFC 9110 reads it
  (JR-C8). `juris-tests/tests/juris-kit/http.test.mjs`. A file sent is closed however the answer
  ends, a client that goes away included. `juris-tests/tests/juris-kit/http.test.mjs`.

  ```js
  import { pack } from "juris-kit/server/http.js";

  pack("<p>Milk</p>").etag; // → 'W/"b-ef7c4a83580e178e65aebe7ba89ecca8"'
  pack("<p>Eggs</p>").etag; // → 'W/"b-f8527cdbd6b6452e42ab16522907b559"'
  ```

  ```js
  import { mkdtemp, writeFile, rm } from "node:fs/promises";
  import { tmpdir } from "node:os";
  import path from "node:path";
  import { sendFile } from "juris-kit/server/http.js";

  const dir = await mkdtemp(path.join(tmpdir(), "shop-"));
  const receipt = path.join(dir, "receipt.txt");
  await writeFile(receipt, "0123456789");
  const server = http.createServer((req, res) => {
      sendFile(req, res, receipt, { type: "text/plain" });
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${server.address().port}`;
  const get = (range) => fetch(url, { headers: { range } });

  const last = await get("bytes=-3");
  [last.status, await last.text()]; // → [206, "789"]
  (await get("bytes=5-2")).status; // → 416
  const several = await get("bytes=0-1,4-5");
  [several.status, await several.text()]; // → [200, "0123456789"]
  server.closeAllConnections();
  server.close();
  await rm(dir, { recursive: true });
  ```

- `listen` binds the loopback address unless told; the drain ends the live and reload streams first,
  lets requests finish within a bound, stops the jobs, and closes what they used last (JR-C9); a
  misspelt option is refused, at the top and inside an option that takes its own.
  `juris-tests/tests/juris-kit/kernel.server.test.mjs`,
  `juris-tests/tests/juris-kit/kernel.config.test.mjs`,
  `juris-tests/tests/juris-kit/service-dispatcher.test.mjs`,
  `juris-tests/tests/juris-kit/kernel.lifecycle.test.mjs`,
  `juris-tests/tests/juris/remote-services.sse.test.mjs`.

  ```js
  const { app, url } = await openShop({});
  new URL(url).hostname; // → "127.0.0.1"
  await app.close();
  ```

  ```js
  const log = [];
  let closing = null;
  const { app, url } = await openShop({
      services: { board: async () => ({ open: 3 }) },
      api: { live: { queries: ["board"], public: true } },
      routes: [{ path: "/orders", name: "orders", component: "Orders" }],
      page: {
          state: () => {
              // a deploy stops the server while this page is being made
              closing = app.close();
              return {};
          },
      },
      closeTimeoutMs: 200,
      onShutdown: [() => log.push("pool closed")],
      setup: (juris) => {
          juris.registerComponent("Orders", () => {
              log.push("orders rendered");
              return { h1: "Orders" };
          });
      },
  });
  const events = await fetch(`${url}/api/events`);
  const orders = await fetch(`${url}/orders`);
  orders.status; // → 200
  (await events.text()).startsWith("retry: 2000"); // → true
  await closing;
  log; // → ["orders rendered", "pool closed"]
  ```

  ```js
  await openShop({ onShutDown: [] });
  // throws TypeError: createJurisServer: onShutDown is not an option
  await openShop({ page: { veiwer: (req) => null } });
  // throws TypeError: createJurisServer: page.veiwer is not an option
  await openShop({ api: { live: { strictQuerys: true } } });
  // throws TypeError: serviceDispatcher: live.strictQuerys is not an option
  ```

  The drain also waits for the stale pages' replacements under way and begins none; a wait Node
  cannot keep (a job's `every`, `health.timeoutMs`, `closeTimeoutMs`) is refused when it is given;
  and a job never runs beside itself. `juris-kit/tests/server.test.mjs`,
  `juris-tests/tests/juris-kit/kernel.pipeline.test.mjs`.

  ```js
  await openShop({ closeTimeoutMs: 2 ** 31 });
  // throws TypeError: createJurisServer: closeTimeoutMs is a whole number of
  //   milliseconds, 0 (cut at once) to 2147483647
  const monthly = 30 * 24 * 60 * 60 * 1000;
  await openShop({ jobs: [{ name: "invoices", every: monthly, run() {} }] });
  // throws TypeError: createLifecycle: job "invoices" needs an interval
  ```

  ```js
  import { createLifecycle } from "juris-kit/server/kernel.js";

  let finish = null;
  let runs = 0;
  const life = createLifecycle({
      build: "v1",
      jobs: [{
          name: "sendReceipts",
          every: 1,
          atStart: true,
          run: () => {
              runs += 1;
              return new Promise((done) => {
                  finish = done;
              });
          },
      }],
  });
  life.start();
  await new Promise((done) => setTimeout(done, 20));
  runs; // → 1
  life.skipped.sendReceipts > 0; // → true
  finish();
  await life.stop();
  ```

- On a server, `clearState` resets the async counters, and a preloaded answer or a request's state
  is copied, so no request's data or pending work reaches another. `juris/tests/core.test.mjs`,
  `juris-tests/tests/juris/juris.calls.test.mjs`.

  ```js
  const orders = juris.api.group("orders");
  orders.track(new Promise(() => {})); // a request's call that never answers
  orders.pending(); // → 1
  juris.clearState({});
  orders.pending(); // → 0
  ```

  ```js
  const saved = { items: ["milk"] };
  const shop = new Juris({
      services: { cart: () => saved },
      features: { ssr: SSRRenderer },
  });
  shop.registerComponent("Cart", (props, api) => {
      const cart = api.preloaded("cart");
      cart.items.push("eggs");
      return { p: cart.items.join(", ") };
  });
  const page = await shop.renderRequest({
      preload: [["cart"]],
      layout: { Cart: {} },
  });
  page.html; // → <p>milk, eggs</p>
  saved.items; // → ["milk"]
  ```

  ```js
  const settings = { currency: "EUR" };
  juris.registerComponent("Prices", (props, api) => {
      api.setValue("settings.currency", "USD");
      return { p: api.getState("settings.currency") };
  });
  const page = await juris.renderRequest({
      state: { settings },
      layout: { Prices: {} },
  });
  page.html; // → <p>USD</p>
  settings; // → { currency: "EUR" }
  ```

**Services and live queries** (`server/service-dispatcher.js`, `live-protocol.js`, `errors.js`)

- JSON only (415 otherwise): the defence against cross-site requests. The form path keeps its own
  rules (the allow-list, same origin, 16 KiB, the error filter, a redirect on the same site) and
  runs a call's `touches` as a JSON call does (JR-C1).
  `juris-tests/tests/juris-kit/service-dispatcher.calls.test.mjs`,
  `juris-tests/tests/juris-kit/service-dispatcher.forms.test.mjs`.

  ```js
  let placed = 0;
  const { app, url } = await openShop({
      services: {
          placeOrder: () => {
              placed += 1;
              return { id: 7 };
          },
      },
  });
  // What a form on another site can send: text/plain, with the cookie.
  const res = await fetch(`${url}/api/placeOrder`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "[]",
  });
  res.status; // → 415
  placed; // → 0
  await app.close();
  ```

  ```js
  const newsletter = [];
  const { app, url } = await openShop({
      services: { subscribe: ({ email }) => newsletter.push(email) },
      api: {
          forms: {
              allow: ["subscribe"],
              redirect: (name, { ok }) => (ok ? "/thanks" : "/newsletter"),
          },
      },
  });
  const post = (origin) => fetch(`${url}/api/subscribe`, {
      method: "POST",
      headers: {
          origin,
          "content-type": "application/x-www-form-urlencoded",
      },
      body: "email=ada%40example.com",
      redirect: "manual",
  });
  (await post("https://evil.example")).status; // → 403
  newsletter; // → []
  const own = await post(url);
  own.status; // → 303
  own.headers.get("location"); // → "/thanks"
  newsletter; // → ["ada@example.com"]
  await app.close();
  ```

  ```js
  const heard = [];
  const { app, url } = await openShop({
      services: { subscribe: () => true },
      api: {
          live: {
              strictQueries: true,
              touches: { subscribe: ["subscribers"] },
              onInvalidate: (targets) => heard.push(...targets),
          },
          forms: { allow: ["subscribe"], redirect: () => "/thanks" },
      },
  });
  const post = (body) => fetch(`${url}/api/subscribe`, {
      method: "POST",
      headers: {
          origin: url,
          "content-type": "application/x-www-form-urlencoded",
      },
      body,
      redirect: "manual",
  });
  (await post("email=ada%40example.com")).status; // → 303
  heard; // → ["subscribers"]
  (await post(`note=${"x".repeat(17_000)}`)).status; // → 413
  await app.close();
  ```

- A malformed service name is a 400, and a context that throws refuses rather than escaping
  (JR-F6).

  ```js
  const { app, url } = await openShop({ services: { cart: () => [] } });
  const res = await fetch(`${url}/api/%E0%A4%A`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "[]",
  });
  res.status; // → 400
  await res.json(); // → { error: "bad service name" }
  await app.close();
  ```

  ```js
  const logged = [];
  const { app, url } = await openShop({
      services: { cart: () => [] },
      api: {
          context: () => {
              throw new Error("session store: connection refused");
          },
      },
      onError: (error, where) => logged.push(`${where}: ${error.message}`),
  });
  const res = await fetch(`${url}/api/cart`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "[]",
  });
  res.status; // → 400
  await res.json(); // → { error: "request failed" }
  logged; // → ["api cart: session store: connection refused"]
  await app.close();
  ```

  - Only the names the dispatcher was built with are callable.

    ```js
    import {
        serviceDispatcher,
    } from "juris-kit/server/service-dispatcher.js";

    const services = { cart: () => [] };
    const api = serviceDispatcher(services);
    services.resetPrices = () => "done"; // added after construction
    api.names; // → ["cart"]
    await api.invoke("resetPrices", [], {});
    // → { ok: false, status: 404, error: 'unknown service "resetPrices"' }
    ```

  - A refusal's `field` reaches the caller (JR-C5).
    `juris-tests/tests/juris-kit/service-dispatcher.calls.test.mjs`,
    `juris-tests/tests/juris/remote-services.test.mjs`.

    ```js
    import {
        serviceDispatcher,
    } from "juris-kit/server/service-dispatcher.js";
    import { fail } from "juris/errors.js";

    const api = serviceDispatcher({
        addToCart: (sku, qty) => fail("Enter a quantity.", { field: "qty" }),
    });
    await api.invoke("addToCart", ["milk", 0], {});
    // → { ok: false, status: 400, error: "Enter a quantity.",
    //     fields: { qty: "Enter a quantity." }, field: "qty" }
    ```

  - A refusal's status is an HTTP error status Node knows (500 otherwise); a service that succeeded
    runs its `touches` whatever becomes of its answer; a form upload cut short runs nothing and is a
    400. `juris-tests/tests/juris-kit/service-dispatcher.calls.test.mjs`,
         `juris-tests/tests/juris-kit/service-dispatcher.forms.test.mjs`.

    ```js
    import {
        serviceDispatcher,
    } from "juris-kit/server/service-dispatcher.js";

    const api = serviceDispatcher({
        checkout: () => {
            throw Object.assign(new Error("gateway said no"), { status: 999 });
        },
    });
    await api.invoke("checkout", [], {});
    // → { ok: false, status: 500, error: "request failed" }
    ```

    ```js
    const heard = [];
    const { app, url } = await openShop({
        services: { placeOrder: () => ({ id: 7, total: 1250n }) },
        api: {
            live: {
                strictQueries: true,
                touches: { placeOrder: ["orders"] },
                onInvalidate: (targets) => heard.push(...targets),
            },
        },
        onError: () => {},
    });
    const res = await fetch(`${url}/api/placeOrder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[]",
    });
    // The order went in; its answer, holding a BigInt, could not be sent.
    res.status; // → 400
    heard; // → ["orders"]
    await app.close();
    ```

- `authorize` runs on subscribe, on a direct POST to a declared query, and on re-check, with the
  context captured at subscribe; `invalidateAccess` re-asks and never drops blindly, on the local
  instance (JR-F8), and always asks, whatever `recheckMs` is.
  `juris-tests/tests/juris-kit/service-dispatcher.live.test.mjs`,
  `juris-tests/tests/juris-kit/service-dispatcher.calls.test.mjs`,
  `juris-tests/tests/juris-kit/service-dispatcher.timers.test.mjs`, `juris-kit/tests/live.test.mjs`.

  ```js
  const { app, url } = await openShop({
      services: { orders: (user) => [{ id: 7, user }] },
      api: {
          context: (req) => ({ user: req.headers["x-user"] }),
          live: {
              queries: ["orders"],
              authorize(name, [user]) {
                  return this.user === user;
              },
          },
      },
  });
  const res = await fetch(`${url}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": "grace" },
      body: JSON.stringify(["ada"]),
  });
  res.status; // → 403
  await res.json(); // → { error: "not allowed" }
  await app.close();
  ```

  ```js
  import {
      serviceDispatcher,
  } from "juris-kit/server/service-dispatcher.js";

  const signedIn = new Set(["ada"]);
  const asked = [];
  const live = serviceDispatcher({ orders: (user) => [{ id: 7 }] }, "/api", {
      context: (req) => ({ user: req.headers["x-user"] }),
      live: {
          queries: ["orders"],
          recheckMs: 0,
          identify() {
              return this.user;
          },
          authorize(name, [user], info) {
              asked.push(info.recheck ? "recheck" : "subscribe");
              return this.user === user && signedIn.has(user);
          },
      },
  });
  const { app, url } = await openShop({ api: live });
  const headers = { "content-type": "application/json", "x-user": "ada" };
  const stream = await fetch(`${url}/api/events`, { headers });
  const events = stream.body.pipeThrough(new TextDecoderStream()).getReader();
  const next = async () => {
      let text = "";
      while (!text.includes("data: ") || !text.endsWith("\n\n")) {
          text += (await events.read()).value;
      }
      return JSON.parse(text.split("data: ").at(-1));
  };
  const { client } = await next();
  await fetch(`${url}/api/_live`, {
      method: "POST",
      headers,
      body: JSON.stringify({
          client,
          subscribe: { key: 'orders:["ada"]', name: "orders", args: ["ada"] },
      }),
  });
  await live.invalidateAccess("ada"); // → 0
  signedIn.delete("ada");
  await live.invalidateAccess("ada"); // → 1
  asked; // → ["subscribe", "recheck", "recheck"]
  await app.close();
  ```

- With `strictQueries`, only declared queries can be subscribed. Client ids are minted by the server
  and bound to `identify`. `juris-tests/tests/juris-kit/service-dispatcher.live.test.mjs`.

  ```js
  import {
      serviceDispatcher,
  } from "juris-kit/server/service-dispatcher.js";

  const live = serviceDispatcher({
      profile: (handle) => ({ handle, followers: 3 }),
      follow: (handle) => true,
  }, "/api", {
      live: { strictQueries: true, touches: { follow: ["profile"] } },
  });
  const { app, url } = await openShop({ api: live });
  const stream = await fetch(`${url}/api/events`);
  const events = stream.body.pipeThrough(new TextDecoderStream()).getReader();
  const next = async () => {
      let text = "";
      while (!text.includes("data: ") || !text.endsWith("\n\n")) {
          text += (await events.read()).value;
      }
      return JSON.parse(text.split("data: ").at(-1));
  };
  const { client } = await next();
  const res = await fetch(`${url}/api/_live`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
          client,
          subscribe: { key: 'profile:["ada"]', name: "profile", args: ["ada"] },
      }),
  });
  res.status; // → 403
  await res.json();
  // → { error: '"profile" is not a live query', code: "live.not-a-query" }
  await app.close();
  ```

  ```js
  import {
      serviceDispatcher,
  } from "juris-kit/server/service-dispatcher.js";

  const live = serviceDispatcher({ orders: (user) => [] }, "/api", {
      context: (req) => ({ user: req.headers["x-user"] }),
      live: {
          queries: ["orders"],
          public: true,
          identify() {
              return this.user;
          },
      },
  });
  const { app, url } = await openShop({ api: live });
  const ada = { "x-user": "ada" };
  const stream = await fetch(`${url}/api/events`, { headers: ada });
  const events = stream.body.pipeThrough(new TextDecoderStream()).getReader();
  const next = async () => {
      let text = "";
      while (!text.includes("data: ") || !text.endsWith("\n\n")) {
          text += (await events.read()).value;
      }
      return JSON.parse(text.split("data: ").at(-1));
  };
  const { client } = await next();
  const grace = { "x-user": "grace" };
  const taken = await fetch(`${url}/api/events?client=${client}`, {
      headers: grace,
  });
  taken.status; // → 403
  await taken.json();
  // → { error: "unknown or foreign client id", code: "live.client-unknown" }
  await app.close();
  ```

- One socket per client id; a stream abandoned during `identify`, or a client dropped during
  `authorize`, leaves nothing behind. Every number `live` takes is checked at construction, so no
  ceiling is off by a string. `juris-kit/tests/live.test.mjs`.

  ```js
  import {
      serviceDispatcher,
  } from "juris-kit/server/service-dispatcher.js";

  const live = serviceDispatcher({ orders: () => [] }, "/api", {
      live: { queries: ["orders"], public: true },
  });
  const { app, url } = await openShop({ api: live });
  const first = await fetch(`${url}/api/events`);
  const events = first.body.pipeThrough(new TextDecoderStream()).getReader();
  const next = async () => {
      let text = "";
      while (!text.includes("data: ") || !text.endsWith("\n\n")) {
          text += (await events.read()).value;
      }
      return JSON.parse(text.split("data: ").at(-1));
  };
  const { client } = await next();
  const again = await fetch(`${url}/api/events?client=${client}`);
  again.status; // → 200
  (await events.read()).done; // → true
  live.stats().clients; // → 1
  await app.close();
  ```

  ```js
  import {
      serviceDispatcher,
  } from "juris-kit/server/service-dispatcher.js";

  serviceDispatcher({ orders: () => [] }, "/api", {
      live: { queries: ["orders"], public: true, maxGroups: "5000" },
  });
  // throws TypeError: serviceDispatcher: live.maxGroups is a whole number
  //   from 1, or Infinity, not "5000"
  ```

- Every call says its kind, and a call that does not say is a stranger's; a live query does not read
  the session (JR-C13). `juris-tests/tests/juris/live-protocol.test.mjs`,
  `juris-tests/tests/juris-kit/service-dispatcher.live.test.mjs`.

  ```js
  import { callKind, internal } from "juris/live-protocol.js";

  callKind(undefined); // → "direct"
  callKind({ user: "ada" }); // → "direct"
  callKind(internal("nightly sales report")); // → "internal"
  ```

  ```js
  import {
      serviceDispatcher,
  } from "juris-kit/server/service-dispatcher.js";
  import { callKind } from "juris/live-protocol.js";

  const services = {
      whoCalls() {
          return callKind(this);
      },
  };
  const shop = new Juris({ services });
  const { calls } = await shop.preload([["whoCalls"]]);
  calls; // → { "whoCalls:[]": "preload" }
  const api = serviceDispatcher(services);
  await api.invoke("whoCalls", [], { user: "ada" });
  // → { ok: true, result: "direct" }
  ```

  ```js
  import {
      serviceDispatcher,
  } from "juris-kit/server/service-dispatcher.js";
  import { callKind } from "juris/live-protocol.js";

  const runs = [];
  const services = {
      board() {
          runs.push({ kind: callKind(this), user: this.user });
          return { open: 3 };
      },
  };
  const live = serviceDispatcher(services, "/api", {
      context: (req) => ({ user: req.headers["x-user"] }),
      live: { queries: ["board"], public: true },
  });
  const { app, url } = await openShop({ api: live });
  const headers = { "content-type": "application/json", "x-user": "ada" };
  const stream = await fetch(`${url}/api/events`, { headers });
  const events = stream.body.pipeThrough(new TextDecoderStream()).getReader();
  const next = async () => {
      let text = "";
      while (!text.includes("data: ") || !text.endsWith("\n\n")) {
          text += (await events.read()).value;
      }
      return JSON.parse(text.split("data: ").at(-1));
  };
  const { client } = await next();
  await fetch(`${url}/api/_live`, {
      method: "POST",
      headers,
      body: JSON.stringify({
          client,
          subscribe: { key: "board:[]", name: "board", args: [] },
      }),
  });
  runs; // → [{ kind: "live", user: undefined }]
  await app.close();
  ```

- One caller cannot hold every live query or unlimited streams
  (`juris-tests/tests/juris-kit/service-dispatcher.live.test.mjs`). A stream more than
  `maxBufferBytes` behind is dropped
  (`juris-tests/tests/juris-kit/service-dispatcher.timers.test.mjs`).

  ```js
  import {
      serviceDispatcher,
  } from "juris-kit/server/service-dispatcher.js";

  const live = serviceDispatcher({ orders: () => [] }, "/api", {
      live: { queries: ["orders"], public: true, maxStreamsPerCaller: 2 },
  });
  const { app, url } = await openShop({ api: live });
  (await fetch(`${url}/api/events`)).status; // → 200
  (await fetch(`${url}/api/events`)).status; // → 200
  const third = await fetch(`${url}/api/events`);
  third.status; // → 429
  await third.json(); // → { error: "at most 2 live streams at a time" }
  await app.close();
  ```

- `diff` treats a dotted, `__proto__` or empty key as data, a `Date` as a leaf, and deletes a
  removed key whatever its name. `juris-tests/tests/juris/live-protocol.test.mjs`,
  `juris-kit/tests/live.test.mjs`.

  ```js
  import { diff } from "juris/live-protocol.js";

  diff({ "price.eur": 3 }, { "price.eur": 4 });
  // → { set: [["", { "price.eur": 4 }]], del: [] }
  const before = JSON.parse('{ "__proto__": "admin" }');
  const after = JSON.parse('{ "__proto__": "guest" }');
  diff({ role: before }, { role: after });
  // → { set: [["role", { ["__proto__"]: "guest" }]], del: [] }
  ```

  ```js
  import { diff } from "juris/live-protocol.js";

  const order = { id: 7, paidAt: new Date("2026-11-01") };
  diff(order, { id: 7, paidAt: new Date("2026-11-02") });
  // → { set: [["paidAt", new Date("2026-11-02")]], del: [] }
  diff({ id: 7, constructor: "Grace" }, { id: 7 });
  // → { set: [], del: ["constructor"] }
  ```

- A bus's `stats()` keeps when a read failed, never the driver's words.
  `juris-tests/tests/juris-kit/mysql-outbox.poll.test.mjs`,
  `juris-tests/tests/juris-kit/pg-outbox.read.test.mjs`.

  ```js
  import {
      createOutboxBus,
  } from "juris-kit/server/bus/mysql-outbox.js";

  const db = {
      query: async () => {
          throw new Error("connect ECONNREFUSED 10.0.0.5:3306 (user shop_rw)");
      },
  };
  const bus = createOutboxBus({
      db,
      intervalMs: 60_000,
      onError: () => {},
      now: () => 1_700_000,
  });
  await bus.start({ from: 0 });
  await bus.poll();
  const { errors, lastErrorAt } = bus.stats();
  errors; // → 1
  lastErrorAt; // → 1_700_000
  JSON.stringify(bus.stats()).includes("ECONNREFUSED"); // → false
  await bus.stop();
  ```

- A bus publish never delays this instance's own re-runs, and what arrives off the bus does not
  wait for them; the Postgres bus reopens a lost LISTEN until it is back, and the MySQL bus never
  runs two polls at once.

  ```js
  import {
      serviceDispatcher,
  } from "juris-kit/server/service-dispatcher.js";

  let milk = 3;
  let fromBus = null;
  const bus = {
      publish: () => new Promise(() => {}), // a pool that never answers
      subscribe: (handler) => {
          fromBus = handler;
      },
  };
  const live = serviceDispatcher({ stock: () => ({ milk }) }, "/api", {
      live: { queries: ["stock"], public: true, bus },
  });
  const { app, url } = await openShop({ api: live });
  const stream = await fetch(`${url}/api/events`);
  const events = stream.body.pipeThrough(new TextDecoderStream()).getReader();
  const next = async () => {
      let text = "";
      while (!text.includes("data: ") || !text.endsWith("\n\n")) {
          text += (await events.read()).value;
      }
      return JSON.parse(text.split("data: ").at(-1));
  };
  const { client } = await next();
  await fetch(`${url}/api/_live`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
          client,
          subscribe: { key: "stock:[]", name: "stock", args: [] },
      }),
  });
  await next(); // → { key: "stock:[]", full: { milk: 3 } }
  milk = 2;
  live.invalidate(["stock"]); // its publish never settles
  await next(); // → { key: "stock:[]", set: [["milk", 2]], del: [] }
  milk = 1;
  fromBus([{ name: "stock" }]); // → undefined
  await app.close();
  ```

  ```js
  import { EventEmitter } from "node:events";
  import {
      createPgOutboxBus,
  } from "juris-kit/server/bus/pg-outbox.js";

  const listeners = [];
  const pool = {
      query: async () => ({ rows: [] }),
      connect: async () => {
          const client = new EventEmitter();
          client.query = async () => ({ rows: [] });
          client.release = () => {};
          listeners.push(client);
          return client;
      },
  };
  const bus = createPgOutboxBus({ pool, reconnectMs: 1, onError: () => {} });
  await bus.start({ from: 0 });
  listeners[0].emit("error", new Error("terminating connection"));
  while (listeners.length < 2) {
      await new Promise((resolve) => setTimeout(resolve, 5));
  }
  listeners.length; // → 2
  await bus.stop();
  ```

  ```js
  import {
      createOutboxBus,
  } from "juris-kit/server/bus/mysql-outbox.js";

  let reads = 0;
  const db = {
      query: async () => {
          reads += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
          return [];
      },
  };
  const bus = createOutboxBus({ db, intervalMs: 60_000 });
  await bus.start({ from: 0 });
  await Promise.all([bus.poll(), bus.poll()]);
  reads; // → 1
  await bus.stop();
  ```

  - A connection whose ROLLBACK failed is destroyed, never pooled; a live query whose result JSON
    cannot carry fails as a failed re-run. `juris-kit/tests/live.test.mjs`.

    ```js
    import { fromMysql2 } from "juris-kit/server/db.js";

    const done = [];
    const connection = {
        beginTransaction: async () => {},
        query: async () => {
            throw new Error("Deadlock found when trying to get lock");
        },
        rollback: async () => {
            throw new Error("Connection lost: The server closed the connection.");
        },
        release: () => done.push("pooled"),
        destroy: () => done.push("destroyed"),
    };
    const db = fromMysql2({ getConnection: async () => connection });
    await db.transaction((tx) => tx.query("UPDATE stock SET milk = milk - 1"));
    // throws Error: Deadlock found
    done; // → ["destroyed"]
    ```

    ```js
    import {
        serviceDispatcher,
    } from "juris-kit/server/service-dispatcher.js";

    const services = { cartTotal: () => ({ cents: 1250n }) };
    const live = serviceDispatcher(services, "/api", {
        live: { queries: ["cartTotal"], public: true },
        onError: () => {},
    });
    const { app, url } = await openShop({ api: live });
    const stream = await fetch(`${url}/api/events`);
    const events = stream.body.pipeThrough(new TextDecoderStream()).getReader();
    const next = async () => {
        let text = "";
        while (!text.includes("data: ") || !text.endsWith("\n\n")) {
            text += (await events.read()).value;
        }
        return JSON.parse(text.split("data: ").at(-1));
    };
    const { client } = await next();
    await fetch(`${url}/api/_live`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            client,
            subscribe: { key: "cartTotal:[]", name: "cartTotal", args: [] },
        }),
    });
    await next(); // → { key: "cartTotal:[]", error: "live query failed" }
    await app.close();
    ```

**Rendering and the browser** (`juris.js`, `html-safety.js`, both renderers (`dom-renderer.js` and
the kit's `server/ssr-renderer.js`), `router.js`, `client.js`)

- Both renderers refuse the same tags, attribute names (`on…`) and URL schemes (after stripping
  control characters), and `srcdoc` outright; `enhance` refuses `innerHTML` anywhere in an enhanced
  subtree unless told. `juris-tests/tests/juris/elements.test.mjs`,
  `juris-tests/tests/juris/attributes.test.mjs`,
  `juris-tests/tests/juris/dom-renderer.enhance.test.mjs`,
  `juris-tests/tests/juris/html-safety.test.mjs`.

  ```js dom
  const profile = {
      div: {
          children: [
              { "img src=x onerror=steal()": {} },
              { a: { href: "java\tscript:steal()", textContent: "Profile" } },
              { img: { src: "/avatar.png", onerror: "steal()" } },
          ],
      },
  };
  juris.renderToString(profile);
  // → <div><a>Profile</a><img src="/avatar.png"></div>
  const page = document.createElement("main");
  new Juris().render(page, profile);
  page.innerHTML; // → <div><a>Profile</a><img src="/avatar.png"></div>
  ```

  ```js
  const embeds = new Juris({
      allowTags: ["iframe"],
      features: { ssr: SSRRenderer },
  });
  embeds.renderToString({
      iframe: { src: "/videos/7", srcdoc: "<script>steal()</script>" },
  });
  // → <iframe src="/videos/7"></iframe>
  ```

  ```js dom
  const page = document.createElement("main");
  page.innerHTML = '<section class="reviews"></section>';
  const reviews = page.querySelector(".reviews");
  const review = { p: { innerHTML: "<b>Great milk</b>" } };
  juris.enhance(reviews, { children: [review] });
  // throws Error: Juris.enhance: innerHTML is not allowed inside an enhanced
  juris.enhance(reviews, { children: [review] }, { allowHtml: true });
  page.innerHTML;
  // → <section class="reviews"><p><b>Great milk</b></p></section>
  ```

  `innerHTML` is refused unless the instance allows it; `plaintext` and `style` are refused tags; a
  `style` object's keys and values and a `classList` key are held to one rule on both sides
  (`checkStyle`, `classTokens`); an element that is already there is reused only for a tag the
  renderers would draw, and `enhance` never writes into one of a refused tag.
  `juris/tests/render.test.mjs`, `juris-kit/tests/ssr-renderer.test.mjs`.

  ```js
  juris.renderToString({
      div: {
          children: [
              { p: { innerHTML: "<img src=x onerror=steal()>" } },
              { style: "input[value^=a] { background: url(//evil.example) }" },
              { plaintext: "" },
          ],
      },
  });
  // → <div><p></p></div>
  ```

  ```js dom
  const sale = {
      p: {
          style: { color: "red;background:url(//evil.example)", fontWeight: 700 },
          classList: { "sale  urgent": true },
          textContent: "Sale",
      },
  };
  juris.renderToString(sale);
  // → <p style="font-weight:700" class="sale urgent">Sale</p>
  const page = document.createElement("main");
  new Juris().render(page, sale);
  page.innerHTML;
  // → <p style="font-weight: 700;" class="sale urgent">Sale</p>
  ```

  ```js dom
  const page = document.createElement("main");
  page.innerHTML = '<section><iframe src="/ads/1"></iframe></section>';
  const section = page.querySelector("section");
  const ad = page.querySelector("iframe");
  juris.enhance(ad, { src: "/ads/2" });
  // throws Error: Juris.enhance: cannot enhance it: <iframe> is not allowed
  juris.enhance(section, {
      children: () => [{ iframe: { src: "/ads/2" } }],
  });
  ad.getAttribute("src"); // → "/ads/1"
  page.innerHTML; // → <section></section>
  ```

- A `<meta http-equiv="refresh">` URL is held to the scheme rules, and neither the document's loader
  nor the client boot is fooled by an element named `requestIdleCallback`.
  `juris-kit/tests/document.test.mjs`, `juris-tests/tests/juris/client.idle.test.mjs`.

  ```js
  import { renderDocument } from "juris-kit/server/document.js";

  renderDocument({}, {
      entry: "/app/boot.js",
      meta: [{ "http-equiv": "refresh", content: "0; url=javascript:steal()" }],
  });
  // throws Error: renderDocument: meta: a refresh to "javascript:steal()"
  ```

  ```js
  import vm from "node:vm";
  import { renderDocument } from "juris-kit/server/document.js";

  const html = renderDocument({}, { entry: "/app/boot.js" });
  const loader = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const waited = [];
  vm.runInNewContext(loader, {
      document: { readyState: "complete" },
      requestIdleCallback: { id: "requestIdleCallback" }, // an element
      setTimeout: (boot, ms) => waited.push(ms),
  });
  waited; // → [1]
  ```

  ```js dom
  import { hydrate } from "juris/client.js";

  document.body.innerHTML = [
      '<div id="app"><p id="requestIdleCallback">Sale</p></div>',
      '<script type="application/json" id="state">{}</script>',
  ].join("");
  // A browser without the API names the element so (window is the global).
  globalThis.requestIdleCallback = document.querySelector("#app p");
  const shop = await hydrate({
      routes: [],
      live: false,
      root: { p: { id: "requestIdleCallback", textContent: "Sale" } },
  });
  shop.isServer; // → false
  ```

- On a server, a service is one of the instance's own, `callCache` is refused, `clearState` drops
  the async error logs, and `peek` is traced (JR-F11).
  `juris-tests/tests/juris/juris.calls.test.mjs`, `juris-tests/tests/juris/juris.test.mjs`,
  `juris-tests/tests/juris/state-manager.test.mjs`.

  ```js
  juris.api.call("constructor");
  // throws Error: Juris.call: unknown service "constructor"
  new Juris({ callCache: { dedupe: true } });
  // throws Error: Juris: callCache is for a browser instance
  ```

  ```js
  const orders = juris.api.group("orders");
  const failed = Promise.reject(new Error("connect ECONNREFUSED 10.0.0.5"));
  await orders.track(failed).catch(() => {});
  orders.errors().map((error) => error.message); // → ["request failed"]
  juris.clearState({});
  orders.errors(); // → []
  ```

  ```js
  juris.registerComponent("Coupon", (props, api) => ({
      p: { textContent: () => api.peek("cart.coupon") },
  }));
  const page = await juris.renderRequest({
      state: { cart: { coupon: "SPRING" } },
      layout: { Coupon: {} },
      trace: true,
  });
  page.html; // → <p>SPRING</p>
  page.trace.roots; // → ["cart"]
  ```

- `privatePaths` are never serialised, and `serializeState` escapes `<`; `requirePreload` throws on
  a call that was not preloaded, and the trace flags the render `unresolved`.
  `juris-tests/tests/juris/juris.calls.test.mjs`.

  ```js
  const shop = new Juris({
      state: {
          cart: { note: "</script><script>steal()" },
          session: { token: "s3cret" },
      },
      privatePaths: ["session"],
  });
  shop.serializeState();
  // → '{"cart":{"note":"\\u003c/script>\\u003cscript>steal()"}}'
  ```

  ```js
  const server = new Juris({
      services: { price: async () => 3 },
      requirePreload: true,
  });
  server.api.call("price", "eggs");
  // throws Error: Juris.call: price:["eggs"] was not preloaded for this request
  ```

  ```js
  const shop = new Juris({
      services: { price: async () => 3 },
      features: { ssr: SSRRenderer },
  });
  shop.registerComponent("Price", (props, api) => ({
      span: { textContent: () => api.call("price", props.sku) },
  }));
  const page = await shop.renderRequest({
      layout: { Price: { sku: "milk" } },
      trace: true,
  });
  page.html; // → <span></span>
  page.trace.flags; // → ["unresolved"]
  ```

- The router keeps an undecodable segment as it arrived, and `parseQuery` builds an object with no
  prototype. `juris-tests/tests/juris/router.test.mjs`.

  ```js
  import { createRouter } from "juris/router.js";

  const router = createRouter({
      routes: [{ path: "/orders/:id", name: "order" }],
  });
  router.resolve("/orders/%E0%A4%A").params; // → { id: "%E0%A4%A" }
  ```

  ```js
  import { parseQuery } from "juris/router.js";

  const query = parseQuery("?sort=price&hasOwnProperty=1&__proto__=a");
  Object.getPrototypeOf(query); // → null
  query.hasOwnProperty; // → "1"
  Object.keys(query); // → ["sort", "hasOwnProperty", "__proto__"]
  ```

- No target the router answers names another host: a backslash is a slash, and a path has exactly
  one leading slash (`resolve`'s redirect, `resolveTarget`, `link().href`).
  `juris/tests/core.test.mjs`.

  ```js
  import { createRouter } from "juris/router.js";

  const router = createRouter({
      routes: [
          { path: "/orders", name: "orders" },
          { path: "/old-orders", redirect: "/\\evil.example/orders" },
      ],
  });
  router.resolve("/old-orders").redirect; // → "/evil.example/orders"
  router.resolveTarget("//evil.example/orders").path;
  // → "/evil.example/orders"
  ```

  ```js
  import { createRouter } from "juris/router.js";

  juris.use(createRouter({ routes: [{ path: "/", name: "home" }] }));
  juris.api.link("\\\\evil.example").href; // → "/evil.example"
  juris.api.link("/\t/evil.example").href; // → "/evil.example"
  ```

- `clearState` skips an own `__proto__` key in the state it is given, so a parsed state cannot set
  the root's prototype; `privatePaths`, `asyncPath` and `routePath` name roots, and a nested one is
  refused rather than matching nothing. `juris/tests/core.test.mjs`.

  ```js
  const sent = '{"cart":{"count":2},"__proto__":{"isAdmin":true}}';
  juris.clearState(JSON.parse(sent));
  juris.getState("isAdmin"); // → undefined
  JSON.parse(juris.serializeState()); // → { cart: { count: 2 } }
  ```

  ```js
  import { createRouter } from "juris/router.js";

  new Juris({ privatePaths: ["user.token"] });
  // throws TypeError: Juris: privatePaths names roots of the state
  new Juris({ asyncPath: "app.async" });
  // throws TypeError: Juris: asyncPath is a root of the state
  createRouter({ routes: [], routePath: "app.route" });
  // throws TypeError: Router: routePath is a root of the state
  ```

- The page's state is read only from the server's JSON script (JR-F15).
  `juris-tests/tests/juris/client.test.mjs`.

  ```js dom
  import { hydrate } from "juris/client.js";

  document.body.innerHTML = [
      '<div id="app"><p id="state">{"cart":{"count":99}}</p></div>',
      '<script type="application/json" id="state">{"cart":{"count":2}}</script>',
  ].join("");
  const shop = await hydrate({ routes: [], live: false, root: { p: "Cart" } });
  shop.getState("cart.count"); // → 2
  ```

- A page is named the same on both sides (JR-C3), and a route's code is loaded before its page is
  drawn (JR-C4). `juris-tests/tests/juris/client.test.mjs`.

  ```js dom
  import { hydrate } from "juris/client.js";

  const findOrder = async (id) => ({ number: Number(id) });
  const routes = [{
      path: "/orders/:id",
      name: "order",
      component: "Order",
      head: { titleFrom: (order) => `Order ${order.number}`, dataPath: "order" },
      preload: ({ params }) => [["order", params.id]],
  }];
  const title = { suffix: " · Shop" };
  const register = (juris) => {
      juris.registerComponent("Order", () => ({ h1: "Your order" }));
  };
  const { app, url } = await openShop({
      services: { order: findOrder },
      routes,
      setup: register,
      page: {
          title,
          state: async ({ route }) => ({
              order: await findOrder(route.params.id),
          }),
      },
  });
  const html = await (await fetch(`${url}/orders/7`)).text();
  await app.close();
  html.match(/<title>(.*)<\/title>/)[1]; // → "Order 7 · Shop"
  document.body.innerHTML = html.split(/<\/?body>/)[1];
  await hydrate({
      routes,
      title,
      register,
      live: false,
      root: { RouterView: {} },
  });
  document.title; // → "Order 7 · Shop"
  ```

  ```js dom
  import { createRouter } from "juris/router.js";

  const shop = new Juris();
  shop.use(createRouter({
      routes: [
          { path: "/", name: "home", component: "Home" },
          {
              path: "/cart",
              name: "cart",
              component: "Cart",
              load: async (juris) => {
                  juris.registerComponent("Cart", () => ({ h1: "Your cart" }));
              },
          },
      ],
  }));
  shop.registerComponent("Home", () => ({ h1: "Shop" }));
  shop.setValue("$route.path", "/");
  const page = document.createElement("main");
  shop.render(page, { RouterView: {} });
  const going = shop.api.navigate("/cart");
  page.innerHTML; // → <h1>Shop</h1>
  await going;
  page.innerHTML; // → <h1>Your cart</h1>
  ```

- What the framework stores in a browser is declared (JR-F12).
  `juris-tests/tests/juris/storage.test.mjs`; `juris-kit/tests/reference-examples.test.mjs` holds
  this file's examples to `STORAGE`.

  ```js
  import { STORAGE } from "juris/storage.js";

  STORAGE.map(({ kind, key }) => `${kind} ${key}`);
  // → ["sessionStorage juris:$route:length"]
  ```

  ```js dom
  import { createRouter } from "juris/router.js";
  import { STORAGE } from "juris/storage.js";

  // A tab at /cart, with a sessionStorage that keeps what is written to it.
  const written = new Map();
  globalThis.sessionStorage = {
      getItem: (key) => written.get(key) ?? null,
      setItem: (key, value) => written.set(key, value),
  };
  history.replaceState(null, "", "/cart");
  new Juris().use(createRouter({ routes: [{ path: "/cart", name: "cart" }] }));
  [...written.keys()]; // → ["juris:$route:length"]
  STORAGE.map((entry) => entry.key); // → ["juris:$route:length"]
  ```

- A form's own `onblur` keeps touch tracking on, and a double click submits once (JR-C14).
  `juris-tests/tests/juris/forms.test.mjs`.

  ```js
  import { forms } from "juris/forms.js";

  juris.use(forms());
  const signin = juris.api.form("signin", { fields: { email: "" } });
  const said = [];
  const email = signin.field("email", { onblur: () => said.push("checked") });
  email.onblur({});
  juris.getState("signin.touched.email"); // → true
  said; // → ["checked"]
  ```

  ```js
  import { forms } from "juris/forms.js";

  let placed = 0;
  const shop = new Juris({ services: { placeOrder: async () => ++placed } });
  shop.use(forms());
  const checkout = shop.api.form("checkout", {
      fields: { item: "milk" },
      submit: "placeOrder",
  });
  const first = checkout.submit();
  await checkout.submit(); // → undefined
  await first; // → 1
  placed; // → 1
  ```

  An `onSuccess` that fails leaves the submit a success, and `reset()` frees a form whose submit
  never answered; a stub's call times out (408), and a 2xx that is not JSON rejects.
  `juris/tests/core.test.mjs`.

  ```js
  import { forms } from "juris/forms.js";

  const shop = new Juris({ services: { saveProfile: async () => "saved" } });
  shop.use(forms());
  const profile = shop.api.form("profile", {
      fields: { name: "Ada" },
      submit: "saveProfile",
      onSuccess: () => toast("Saved"), // toast is not defined
  });
  await profile.submit(); // → "saved"
  // console.error: Juris form "profile": onSuccess failed after the submit
  shop.getState("profile.error"); // → null
  ```

  ```js
  import { forms } from "juris/forms.js";

  const hangs = () => new Promise(() => {});
  const shop = new Juris({ services: { placeOrder: hangs } });
  shop.use(forms());
  const checkout = shop.api.form("checkout", {
      fields: { item: "milk" },
      submit: "placeOrder",
  });
  checkout.submit();
  shop.getState("checkout.submitting"); // → true
  checkout.reset();
  shop.getState("checkout.submitting"); // → false
  ```

  ```js
  import { remoteServices } from "juris/remote-services.js";

  const hangs = () => new Promise(() => {});
  const late = remoteServices(["placeOrder"], { fetch: hangs, timeoutMs: 20 });
  await late.placeOrder({ item: "milk" });
  // throws ServiceError: The request took too long; it may or may not have
  const portal = async () => new Response("<h1>Sign in to the Wi-Fi</h1>");
  const caught = remoteServices(["placeOrder"], { fetch: portal });
  const refused = await caught.placeOrder({ item: "milk" }).catch((e) => e);
  refused.status; // → 502
  refused.code; // → "response.not-json"
  ```

- A live path says whether what it shows is current (`liveState`), alike on the server and in the
  browser's first render. `juris-tests/tests/juris/juris.live.test.mjs`,
  `juris-tests/tests/juris/client.test.mjs`.

  ```js dom
  const services = { stock: async (sku) => ({ milk: 12 })[sku] };
  const StockBadge = (props, api) => {
      api.live("stock.milk", "stock", "milk");
      const left = () => api.getState("stock.milk");
      const state = () => api.liveState("stock.milk");
      return { span: { textContent: () => `${left()} left (${state()})` } };
  };
  const server = new Juris({
      services,
      isServer: true,
      features: { ssr: SSRRenderer },
  });
  server.registerComponent("StockBadge", StockBadge);
  const served = await server.renderRequest({
      preload: [["stock", "milk"]],
      layout: { StockBadge: {} },
  });
  served.html; // → <span>12 left (live)</span>
  const browser = new Juris({ services, state: JSON.parse(served.json) });
  browser.registerComponent("StockBadge", StockBadge);
  const page = document.createElement("main");
  browser.render(page, { StockBadge: {} });
  page.innerHTML; // → <span>12 left (live)</span>
  ```

**Modules and processes** (`server/modules.js`, `server/process.js`, `server/dev-reload.js`)

- `src/server/` is never served: the mount rule, and refusals at construction by the file a mount,
  an asset, a root file or a static entry names. `juris-tests/tests/juris-kit/modules.test.mjs`,
  `juris-tests/tests/juris-kit/modules.construction.test.mjs`.

  ```js
  const { app, url } = await openShop({});
  (await request(url, "/src/juris.js")).status; // → 200
  (await request(url, "/src/kernel.js")).status; // → 404
  (await request(url, "/src/server/kernel.js")).status; // → 404
  await app.close();
  ```

  ```js
  import { fileURLToPath } from "node:url";

  const kernel = import.meta.resolve("juris-kit/server/kernel.js");
  const serverDir = fileURLToPath(new URL(".", kernel));
  await openShop({
      modules: {
          entry: "/src/client.js",
          mounts: [{ url: "/kit/", dir: serverDir, outside: true }],
      },
  });
  // throws TypeError: createModuleServer: mount "/kit/": its dir reaches the
  //   framework, which is served only flat, at /src/
  ```

- A module is `immutable` only under this process's own code id, and has one URL; production serves
  only its snapshot. The server alone writes that header: a proxy that adds a Cache-Control of its
  own defeats it. `juris-tests/tests/juris-kit/modules.test.mjs`.

  ```js
  const { app, url } = await openShop({});
  const ours = await fetch(`${url}/src/juris.js?v=${app.codeId}`);
  ours.headers.get("cache-control");
  // → "public, max-age=31536000, immutable"
  const older = await fetch(`${url}/src/juris.js?v=0ldBu1ld00`);
  older.headers.get("cache-control"); // → "public, max-age=0, must-revalidate"
  await app.close();
  ```

  ```js
  import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
  import { tmpdir } from "node:os";
  import path from "node:path";

  const root = await mkdtemp(path.join(tmpdir(), "shop-"));
  const dir = path.join(root, "app");
  await mkdir(dir);
  await writeFile(path.join(dir, "boot.js"), "export function start() {}");
  const { app, url } = await openShop({
      root,
      modules: { entry: "/app/boot.js", mounts: [{ url: "/app/", dir: "app" }] },
  });
  // the next deploy's checkout lands while this server still runs
  await writeFile(path.join(dir, "cart.js"), "export const items = [];");
  (await fetch(`${url}/app/cart.js`)).status; // → 404
  (await fetch(`${url}/app/boot.js`)).status; // → 200
  await app.close();
  await rm(root, { recursive: true });
  ```

  The code id moves with the transform (the stamper, the minifier, whether production minifies), and
  only specifiers in code are stamped, a template given to `import()` included; the minifier reads a
  regex and a division as code does, and every line terminator as one.
  `juris-kit/tests/server.test.mjs`.

  ```js
  import { createModuleServer } from "juris-kit/server/modules.js";

  const root = new URL(".", import.meta.url);
  const minified = await createModuleServer({ root, build: "v1" });
  const plain = await createModuleServer({ root, build: "v1", minify: false });
  minified.codeId === plain.codeId; // → false
  ```

  ```js
  import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
  import { tmpdir } from "node:os";
  import path from "node:path";

  const root = await mkdtemp(path.join(tmpdir(), "shop-"));
  const dir = path.join(root, "app");
  await mkdir(dir);
  await writeFile(path.join(dir, "boot.js"), [
      'import { items } from "./cart.js";',
      "export const start = () => import(`./checkout.js`);",
      "export const help = 'write: import { items } from \"./cart.js\"';",
  ].join("\n"));
  const { app, url } = await openShop({
      root,
      modules: { entry: "/app/boot.js", mounts: [{ url: "/app/", dir: "app" }] },
  });
  const boot = await (await fetch(`${url}/app/boot.js`)).text();
  boot.replaceAll(app.codeId, "<code id>").split("\n");
  // → ['import { items } from "./cart.js?v=<code id>";',
  //     "export const start = () => import(`./checkout.js?v=<code id>`);",
  //     "export const help = 'write: import { items } from \"./cart.js\"';"]
  await app.close();
  await rm(root, { recursive: true });
  ```

  ```js
  import { minifyJs } from "juris-kit/server/minify.js";

  minifyJs("const isLink = /^https?:\\/\\//; // a link\nconst half = n / 2 / k;");
  // → "const isLink = /^https?:\\/\\//;\nconst half = n / 2 / k;"
  minifyJs("const milk = 1\u2028const eggs = 2;");
  // → "const milk = 1\nconst eggs = 2;"
  ```

- Cluster workers are refused before anything forks. `juris-tests/tests/juris-kit/process.test.mjs`.

  ```js
  import { startProcess } from "juris-kit/server/process.js";

  const forked = [];
  const cluster = { isPrimary: true, fork: (env) => forked.push(env) };
  startProcess({ workers: 4, cluster });
  // throws Error: 4 workers on one port would break live queries
  forked; // → []
  ```

  ```js
  await openShop({
      services: { board: async () => ({ open: 3 }) },
      api: { live: { queries: ["board"], public: true } },
      cluster: { isWorker: true },
  });
  // throws Error: createJurisServer: this is a cluster worker, and live queries
  //   do not survive workers on one port
  ```

  A worker that keeps dying is replaced after a wait that doubles, never in a loop.
  `juris-tests/tests/juris-kit/process.test.mjs`.

  ```js
  import { EventEmitter } from "node:events";
  import { startProcess } from "juris-kit/server/process.js";

  const cluster = Object.assign(new EventEmitter(), {
      isPrimary: true,
      fork: () => ({ id: 1 }),
  });
  const waits = [];
  const timers = { setTimeout: (fn, ms) => waits.push(ms), now: () => 0 };
  startProcess({ workers: 2, allow: true, cluster, timers, log: { log() {} } });
  for (let crash = 0; crash < 4; crash += 1) {
      cluster.emit("exit", { id: 1 }, 1, null);
  }
  waits; // → [1000, 2000, 4000, 8000]
  ```

- Development reload watches `src/` recursively (JR-C11), and the kernel refuses it outside
  development. `juris-tests/tests/juris-kit/dev-reload.test.mjs`,
  `juris-tests/tests/juris-kit/kernel.config.test.mjs`.

  ```js
  import path from "node:path";
  import { devReload } from "juris-kit/server/dev-reload.js";

  const watched = [];
  const reload = devReload({
      root: new URL(".", import.meta.url),
      onRestart: () => {},
      watch: (dir, options) => {
          watched.push([path.basename(dir), options.recursive]);
          return { close() {} };
      },
  });
  watched; // → [["juris", true], ["server", true]]
  reload.close();
  ```

  ```js
  import { devReload } from "juris-kit/server/dev-reload.js";

  const reload = devReload({
      root: new URL(".", import.meta.url),
      onRestart: () => {},
      watch: () => ({ close() {} }),
  });
  await openShop({ dev: false, devReload: reload });
  // throws TypeError: createJurisServer: devReload is development's, and this
  //   server is not in development
  ```

**Devtools** (`devtools.js`, `client.js`, `server/document.js`, `server/kernel.js`; the design is
`DEVTOOLS.md`'s "The security model")

- devMode only, and never on a server instance: the feature refuses an instance without `devMode`,
  and a server instance, with a `TypeError`; the kernel never gives its own instance devMode or the
  feature. `juris-tests/tests/juris/devtools.test.mjs`, the kit's `tests/server.test.mjs`.

  ```js
  import { Devtools } from "juris/devtools.js";

  new Juris({ features: { devtools: Devtools } });
  // throws TypeError: Devtools: the devtools feature is for an instance
  new Juris({ devMode: true, features: { devtools: Devtools } });
  // throws TypeError: Devtools: never on a server instance
  ```

  ```js
  const { app } = await openShop({ dev: true });
  app.juris.devMode; // → false
  app.juris.devtools; // → undefined
  await app.close();
  ```

- Nothing exposed, nothing downloaded, nothing spent with devMode off: no module imports
  `devtools.js` statically and the boot graph is client.js's eleven modules
  (`tests/boundary.test.mjs`); with devMode off `hydrate` imports no `devtools.js`, nothing is on
  `window`, nothing is dispatched there, and every method a draw or a write goes through is the
  prototype's (`tests/core.test.mjs`, with a resolve hook that hears every module the boot imports).

  ```js
  import { readFileSync } from "node:fs";

  const dir = new URL("./", import.meta.resolve("juris/client.js"));
  const boot = new Set();
  const follow = (file) => {
      if (boot.has(file)) return;
      boot.add(file);
      const text = readFileSync(new URL(file, dir), "utf8");
      for (const [, next] of text.matchAll(/^import .* from "\.\/(.+)";$/gm)) {
          follow(next);
      }
  };
  follow("client.js");
  boot.size; // → 11
  boot.has("devtools.js"); // → false
  ```

  ```js dom
  import { hydrate } from "juris/client.js";

  document.body.innerHTML = '<div id="app"><p>Your cart</p></div>'
      + '<script type="application/json" id="state">{"cart":{}}</script>';
  const before = Object.keys(window);
  const heard = [];
  window.addEventListener("juris:devtools", (event) => heard.push(event.type));
  const shop = await hydrate({
      routes: [],
      live: false,
      register: (juris) => {
          juris.registerComponent("App", () => ({ p: "Your cart" }));
      },
  });
  shop.devtools; // → undefined
  Object.keys(window).filter((key) => !before.includes(key)); // → []
  "__JURIS_DEVTOOLS__" in window; // → false
  heard; // → []
  Object.hasOwn(shop.renderer, "bindState"); // → false
  Object.hasOwn(shop.stateManager, "run"); // → false
  ```

  ```js dom
  import { hydrate } from "juris/client.js";

  document.body.innerHTML = '<div id="app"><p>Your cart</p></div>'
      + '<script type="application/json" id="state">{"cart":{}}</script>'
      + '<script type="application/json" id="juris-dev">{}</script>';
  const before = Object.keys(window);
  const shop = await hydrate({
      routes: [],
      live: false,
      register: (juris) => {
          juris.registerComponent("App", () => ({ p: "Your cart" }));
      },
  });
  // console.info: Juris: devMode is on, so this instance is exposed as
  Object.keys(window).filter((key) => !before.includes(key)); // → ["$juris"]
  "__JURIS_DEVTOOLS__" in window; // → true
  Object.hasOwn(shop.renderer, "bindState"); // → true
  Object.hasOwn(shop.stateManager, "run"); // → true
  ```

- `#juris-dev` only with `dev: true`: a page rendered without it carries none. The kit's
  `tests/server.test.mjs`, `juris-tests/tests/juris-kit/kernel.pipeline.test.mjs`.

  ```js
  const pages = [];
  for (const dev of [false, true]) {
      const { app, url } = await openShop({
          dev,
          routes: [{ path: "/", name: "home", component: "Home" }],
          setup: (juris) => {
              juris.registerComponent("Home", () => ({ h1: "Shop" }));
          },
      });
      pages.push(await (await fetch(url)).text());
      await app.close();
  }
  const devData = '<script type="application/json" id="juris-dev">{}</script>';
  pages[0].includes(devData); // → false
  pages[1].includes(devData); // → true
  ```

- Nothing leaves the page unless a panel asks: the page side sends nothing on its own, and makes no
  network request at all. The protocol is read-only.

  ```js dom
  import { Devtools } from "juris/devtools.js";

  let requests = 0;
  globalThis.fetch = async () => {
      requests += 1;
  };
  const shop = new Juris({
      devMode: true,
      state: { cart: { count: 2 } },
      features: { devtools: Devtools },
  });
  shop.render(document.createElement("main"), {
      p: () => `${shop.getState("cart.count")} in cart`,
  });
  shop.setValue("cart.count", 3);
  const panel = window.__JURIS_DEVTOOLS__.get(1);
  const connection = panel.connect();
  panel.drain(connection); // → { events: [], dropped: 0 }
  requests; // → 0
  ```

  ```js dom
  import { Devtools } from "juris/devtools.js";

  const shop = new Juris({
      devMode: true,
      state: { cart: { count: 2 } },
      features: { devtools: Devtools },
  });
  const panel = window.__JURIS_DEVTOOLS__.get(1);
  const connection = panel.connect();
  panel.request(connection, "setState", { path: "cart.count", value: 0 });
  // → { ok: false, error: { code: "unknown-method",
  //     message: '"setState" is not a method of protocol 1' } }
  shop.getState("cart.count"); // → 2
  ```

- No private path listed, no private value sent: a path under `$server` or the app's `privatePaths`
  is counted, never listed, and a failure is given only in the words the page already carries (D14).
  `juris-tests/tests/juris/devtools.timeline.test.mjs`, `devtools.values.test.mjs`.

  ```js dom
  import { Devtools } from "juris/devtools.js";

  const shop = new Juris({
      devMode: true,
      privatePaths: ["session"],
      state: { cart: { count: 2 }, session: { token: "s3cret", user: "ada" } },
      features: { devtools: Devtools },
  });
  const panel = window.__JURIS_DEVTOOLS__.get(1);
  const connection = panel.connect();
  panel.request(connection, "state").result;
  // → { cart: { count: 2 }, session: { $: "private", count: 2 } }
  panel.request(connection, "state", { path: "session.token" }).result;
  // → { $: "private", count: 2 }
  ```

  ```js dom
  import { Devtools } from "juris/devtools.js";

  const shop = new Juris({
      devMode: true,
      privatePaths: ["session"],
      state: { cart: { count: 2 }, session: { user: "ada" } },
      features: { devtools: Devtools },
  });
  shop.render(document.createElement("header"), {
      p: () => `${shop.getState("session.user")}: ${shop.getState("cart.count")}`,
  });
  const panel = window.__JURIS_DEVTOOLS__.get(1);
  const connection = panel.connect();
  panel.request(connection, "binding", { id: 1 }).result.reads;
  // → ["cart.count", { root: "session", count: 1 }]
  ```

  ```js dom
  import { Devtools } from "juris/devtools.js";

  const shop = new Juris({
      devMode: true,
      state: {
          $ssr: {
              calls: {
                  'orders:["ada"]': { $error: "request failed" },
                  "cart:[]": { count: 2 },
              },
          },
      },
      features: { devtools: Devtools },
  });
  const panel = window.__JURIS_DEVTOOLS__.get(1);
  const connection = panel.connect();
  panel.request(connection, "preloads").result;
  // → [{ key: 'orders:["ada"]', service: "orders", ok: false,
  //      message: "request failed" },
  //    { key: "cart:[]", service: "cart", ok: true, message: null }]
  ```

- Nothing read for the panel is a dependency, even from inside a capture.
  `juris-tests/tests/juris/devtools.values.test.mjs`.

  ```js dom
  import { Devtools } from "juris/devtools.js";

  const shop = new Juris({
      devMode: true,
      state: { cart: { count: 2 } },
      features: { devtools: Devtools },
  });
  const panel = window.__JURIS_DEVTOOLS__.get(1);
  const connection = panel.connect();
  let runs = 0;
  shop.bindState(() => {
      runs += 1;
      return panel.request(connection, "state", { path: "cart" });
  }, () => {});
  // console.warn: StateManager: a reactive function read no state paths
  shop.setValue("cart.count", 3);
  runs; // → 1
  ```

- Nothing a Manifest V3 extension page refuses: no browser module evaluates a string as code (`eval`,
  `new Function`, a string timer) or imports a computed specifier, and the outline is styled through
  the CSSOM. `tests/boundary.test.mjs`.

  ```js
  import { readdirSync, readFileSync } from "node:fs";

  const dir = new URL("./", import.meta.resolve("juris/juris.js"));
  const modules = readdirSync(dir).filter((name) => name.endsWith(".js"));
  const asCode = /\beval\(|\bnew Function\b|\bset(Timeout|Interval)\(\s*["'`]/;
  const computed = /\bimport\(\s*(?!["'][^"']*["']\s*\))/;
  modules.filter((name) => {
      const text = readFileSync(new URL(name, dir), "utf8");
      return asCode.test(text) || computed.test(text);
  });
  // → []
  ```

  ```js dom
  import { Devtools } from "juris/devtools.js";

  const shop = new Juris({ devMode: true, features: { devtools: Devtools } });
  shop.registerComponent("CartBadge", () => ({ strong: "2 in cart" }));
  shop.render(document.body.appendChild(document.createElement("main")), {
      CartBadge: {},
  });
  const panel = window.__JURIS_DEVTOOLS__.get(1);
  const connection = panel.connect();
  const [badge] = panel.request(connection, "components", {
      name: "CartBadge",
  }).result;
  panel.request(connection, "highlight", { component: badge });
  // → { ok: true, result: {} }
  document.querySelectorAll("style").length; // → 0
  document.querySelector('[data-juris-devtools="outline"]').outerHTML;
  // → <div data-juris-devtools="outline"></div>
  ```

### Open

The examples under Open show what happens today, on an instance that renders to a string and a
shop's server started on a free port:

```js setup
import Juris from "juris/juris.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";
import { createJurisServer } from "juris-kit/server/kernel.js";

const juris = new Juris({ features: { ssr: SSRRenderer } });

// A shop's server on a free port: createJurisServer with the plumbing
// filled in (where the app is, its build, its browser entry, its layout).
async function openShop(config) {
    const app = await createJurisServer({
        root: new URL(".", import.meta.url),
        build: "v1",
        modules: { entry: "/src/client.js" },
        layout: { RouterView: {} },
        services: {},
        routes: [],
        ...config,
    });
    const { url } = await app.listen();
    return { app, url };
}
```

These are known, and not closed:

- **Layout branding.** Tags are checked, but a row from data that reaches a child position can
  still name a registered component (`{ SomeComponent: { … } }`) and instantiate it with the row's
  props. Closing it needs a brand on every layout that JSON cannot forge. It is latent while no app
  renders raw rows as children.

  ```js
  juris.registerComponent("RefundButton", (props) => ({
      button: `Refund order ${props.order}`,
  }));
  const rows = JSON.parse('[{"li":"Milk"},{"RefundButton":{"order":7}}]');
  // Today: the second row draws the component.
  juris.renderToString({ ul: { children: rows } });
  // → <ul><li>Milk</li><button>Refund order 7</button></ul>
  ```

- **CSS from data.** A `style` string, or an allowed value in a style object, can still make the
  browser fetch a URL (`background: url(…)`): a value cannot end its declaration or start another,
  but `url()` is a value. A `style` string is written as given on both sides. Build styles from
  objects with known keys.

  ```js
  // Today: a style string goes out as it was given.
  const bio = "background: url(//tracker.example/seen.gif)";
  juris.renderToString({ p: { style: bio, textContent: "Hi, I'm Ada" } });
  // → <p style="background: url(//tracker.example/seen.gif)">Hi, I'm Ada</p>
  ```

  ```js
  // Today: url() is one value, so a style object keeps it.
  juris.renderToString({
      div: { style: { backgroundImage: "url(//tracker.example/seen.gif)" } },
  });
  // → <div style="background-image:url(//tracker.example/seen.gif)"></div>
  ```

- **`!important` in a style object's value.** The server writes it and the DOM drops it on
  assignment, so the two sides differ by those characters. It cannot add a declaration; the one
  rule (`checkStyle`) could refuse `!` if the two should agree to the character.

  ```js
  // Today, on the server:
  juris.renderToString({
      p: { style: { color: "red !important" }, textContent: "Sale" },
  });
  // → <p style="color:red !important">Sale</p>
  ```

- **An allowed `<script>`'s text is escaped by the server.** With `allowTags: ["script"]`, the
  server renderer escapes a script's text as it does any text (`a < b` goes out as `a &lt; b`,
  which breaks the script), as it once did a `<style>`'s. A script's raw-text rules (`</script`,
  `<!--`, `<script`) are subtler than a style's; the document writer's are the model if it is wanted.

  ```js
  const widgets = new Juris({
      allowTags: ["script"],
      features: { ssr: SSRRenderer },
  });
  // Today:
  widgets.renderToString({ script: "if (stock < 5) warn();" });
  // → <script>if (stock &lt; 5) warn();</script>
  ```

- **A custom minifier is known by its source text.** The code id names it by its functions' source,
  so a wrapper whose behaviour changes while its text stays the same (a library it calls was
  upgraded) keeps the code id, and browsers keep the old bytes as immutable, unless the app moves
  `build`.

  ```js
  import { createModuleServer } from "juris-kit/server/modules.js";

  const root = new URL(".", import.meta.url);
  let shrink = (code) => code;
  const minify = { js: (code) => shrink(code) };
  const before = await createModuleServer({ root, build: "v1", minify });
  shrink = (code) => code.trim(); // the library was upgraded
  const after = await createModuleServer({ root, build: "v1", minify });
  // Today: other bytes, the same code id.
  after.codeId === before.codeId; // → true
  ```

- **An unsendable answer is a 400.** A service result JSON cannot carry is answered with the
  refusal's default status; a 500 would describe it better, and is a change of answer not yet made.

  ```js
  const logged = [];
  const { app, url } = await openShop({
      services: { cartTotal: async () => ({ cents: 1250n }) },
      onError: (error, where) => logged.push(where),
  });
  const res = await fetch(`${url}/api/cartTotal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "[]",
  });
  // Today:
  res.status; // → 400
  await res.json(); // → { error: "request failed" }
  logged; // → ["api cartTotal"]
  await app.close();
  ```

- **No per-viewer channel.** Data that belongs to one reader needs a live query group of its own.

  ```js
  import { liveKey } from "juris/live-protocol.js";

  // Today: a reader's inbox is a query that names them, one group each.
  liveKey("inbox", ["ada"]); // → 'inbox:["ada"]'
  liveKey("inbox", ["grace"]); // → 'inbox:["grace"]'
  ```

- **A Content-Security-Policy is the app's to write.** The pipeline hands its `headers` hook the
  hashes of the page's inline scripts; what else a page may load is the app's knowledge. Juris sets
  inline `style` attributes in server-rendered markup, so a policy needs `style-src 'unsafe-inline'`.

  ```js
  const { app, url } = await openShop({
      routes: [{ path: "/", name: "home", component: "Home" }],
      setup: (juris) => {
          juris.registerComponent("Home", () => ({ h1: "Shop" }));
      },
      page: {
          headers: ({ scriptHashes }) => ({
              "content-security-policy": `script-src ${scriptHashes.join(" ")}`,
          }),
      },
  });
  const res = await fetch(`${url}/`);
  const policy = res.headers.get("content-security-policy");
  policy.startsWith("script-src 'sha256-"); // → true
  await app.close();
  ```

  ```js
  juris.renderToString({
      p: { style: { color: "green" }, textContent: "In stock" },
  });
  // → <p style="color:green">In stock</p>
  ```

- **Taking live access away reaches only the instance that acted** (JR-F8's remainder): another
  instance stops a signed-out reader's patches at its next re-check, before the first patch it
  would send once `recheckMs` (30 s) has passed since the last.

  ```js
  import {
      serviceDispatcher,
  } from "juris-kit/server/service-dispatcher.js";

  const published = [];
  const bus = {
      publish: async (targets) => {
          published.push(targets);
      },
      subscribe: () => () => {},
  };
  const api = serviceDispatcher({ inbox: async (user) => [] }, "/api", {
      live: { queries: ["inbox"], authorize: () => true, bus },
  });
  await api.invalidate(["inbox"]);
  await api.invalidateAccess("ada");
  // Today: the change goes to the other instances, the sign-out does not.
  published; // → [["inbox"]]
  api.close();
  ```

- **A guest's ceiling is per address.** The default `clientKey` counts a guest by address, so many
  guests behind one address share the twelve streams one caller may hold.

  ```js
  const { app, url } = await openShop({
      services: { stock: async () => 12 },
      api: { live: { queries: ["stock"], public: true } },
  });
  const streams = [];
  const answered = [];
  for (let guest = 1; guest <= 13; guest++) {
      const stream = new AbortController();
      const res = await fetch(`${url}/api/events`, {
          headers: { cookie: `guest=${guest}` },
          signal: stream.signal,
      });
      answered.push(res.status);
      streams.push(stream);
  }
  // Today: thirteen guests from one address, the last one refused.
  answered.filter((status) => status === 200).length; // → 12
  answered.at(-1); // → 429
  streams.forEach((stream) => stream.abort());
  await app.close();
  ```

- **The module server compares paths as written, not real paths.** An app that passes `root`
  through a symlink, or reaches the framework through one, gets none of the refusals that keep
  `src/` from being served twice or `src/server/` at all.

  ```js
  import { mkdtemp, rm, symlink } from "node:fs/promises";
  import os from "node:os";
  import path from "node:path";
  import { fileURLToPath } from "node:url";

  const kernel = import.meta.resolve("juris-kit/server/kernel.js");
  const kitServer = path.dirname(fileURLToPath(kernel));
  const root = await mkdtemp(path.join(os.tmpdir(), "shop-"));
  await symlink(kitServer, path.join(root, "lib"));
  const { app, url } = await openShop({
      root,
      modules: {
          entry: "/src/client.js",
          mounts: [{ url: "/lib/", dir: "lib" }],
      },
  });
  // Today: the kit's Node-only code, served through the link.
  const res = await fetch(`${url}/lib/kernel.js`);
  res.status; // → 200
  (await res.text()).includes("export async function createJurisServer");
  // → true
  await app.close();
  await rm(root, { recursive: true });
  ```

  ```js
  import { createModuleServer } from "juris-kit/server/modules.js";
  import path from "node:path";
  import { fileURLToPath } from "node:url";

  const kernel = import.meta.resolve("juris-kit/server/kernel.js");
  await createModuleServer({
      root: new URL(".", import.meta.url),
      build: "v1",
      mounts: [{
          url: "/lib/",
          dir: path.dirname(fileURLToPath(kernel)),
          outside: true,
      }],
  });
  // throws TypeError: createModuleServer: mount "/lib/": its dir reaches
  ```
## Not yet

These are gaps between what this file describes and what a framework ready for other people would
have, stated so nobody reads them as done:

- **The fixes are not yet proven in production.** Juris runs two real-time sites in production and
  `app/hello`. The sites work around the issues fixed in this version (F1–F27) and are being moved
  to it (see "Where it stands").
- **Signing in is the app's.** A request context, a session cookie, and the rule for when a viewer
  argument is believed are written by each members app ("Your first app").
- **The kernel does not wire a page cache itself.** A cache is taken only beside a dispatcher the
  app built and wired to it (`live.onInvalidate`).
- **No bus is verified against a real database here.** The MySQL and MariaDB bus's tests
  (`juris-tests/tests/juris-kit/mysql-outbox.test.mjs`,
  `juris-tests/tests/juris-kit/mysql-outbox.poll.test.mjs`) and the Postgres bus's
  (`juris-tests/tests/juris-kit/pg-outbox.test.mjs`,
  `juris-tests/tests/juris-kit/pg-outbox.read.test.mjs`,
  `juris-tests/tests/juris-kit/pg-outbox.listen.test.mjs`) run against an in-memory stand-in for the
  driver and its table, so they hold what a bus sends and how it reads an answer, never what a real
  server does. The Postgres bus runs against a real database every day under an app's own pipeline,
  not under a framework test.
- **No bundling** means more module requests, and code a page never calls is downloaded all the
  same ("The code a browser runs is the file on disk"); the server renderer is no longer part of
  it, since it moved to the kit.
- **A split boot mid-deploy** can leave a page not live until its next full load ("A rolling deploy
  mixes two builds").
- The other open findings above.
- **One release's leftovers.** `renderRequest`'s `cache`, `meta.title` and `meta.titleFrom` in place
  of `head`, `remoteServices`' string base, and `sseClient`'s reading of a refusal's words where it
  carries no code are kept for one more release, and then removed. `remoteServices`' reading of a
  2xx answer that is not JSON as `{ error }` is not among them: it is gone, and such an answer
  rejects (`response.not-json`).
- **Some fixes are held in Node only.** The render and core suites reach the browser's side through
  a stand-in DOM, a fake `window` and `history` and a fake `EventSource`, and no Juris project
  carries a browser suite: `innerHTML`, `classList`, `style` and `xlink:` in a real DOM, a keyed
  component with no element root, `enhance` over a refused tag, the loader and the boot in a browser
  without `requestIdleCallback`, the router's boot and hash mode, `Link`'s bound `href` and the live
  status over a real stream are checked in a real browser only through an app's own checks.
- **No changelog.** The `juris` and `juris-kit` packages are versioned together, and the
  kit depends on the core's matching minor version; what changed is in each repository's history.
- **The boundary is held in two places.** The `juris` package's `tests/boundary.test.mjs` holds what
  a browser downloads (flat siblings only, no `Buffer`, `process` or `require(`, the browser floor,
  and no string renderer among what `juris.js` imports statically); the kit's holds that `server/`
  takes the browser half only as `juris/<file>.js`.
- **The browser floor is held against a list** of newer features, not by parsing what each module
  uses.
- **Devtools, phases 2 and 3** (`DEVTOOLS.md`, "Phasing"). Phase 1 is built ("`devtools.js`"). Not
  yet: `html-safety.js`'s `rule` codes (`refused` is called with none but `"layout-in-value"`), the
  refusal record (`refusals`, the `refusals` topic, `Refusal`), the hydration comparison
  (`hydration`, `Hydration`, and its console line), the render record and `GET
  /__juris/render/<id>` (`server`, `#juris-dev`'s `render` id), preload timings and the server's
  refusals in the trace, the dispatcher's `dev` field and `event: devtools`, the live client telling
  the feature of each patch (`live`, the `live` topic, `LiveEvent`, a pass's `{ kind: "live" }`
  cause), the feature recording `juris.call` while the timeline records, `/version`'s `codeId`, and
  `builds`. Until then each of those requests answers `unknown-method`, and `hello`'s `topics` lists
  the topics there are.
- **Devtools in a real browser.** The feature is tested on the stand-in DOM only. What needs Chrome
  (`inspectedWindow.eval` under a page's policy, `$0` and `inspect()`, `window.event` during
  dispatch, the outline's geometry when scrolled, transformed or fixed, and the overhead budget on a
  large real app's object list) is the extension's release checklist (`DEVTOOLS.md`, "Tests").

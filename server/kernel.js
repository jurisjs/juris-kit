// The server kernel: what every server-rendered app on Juris does between a request arriving and a
// page going out, written once. Node only; it is never served. It holds three pieces: the page
// pipeline (`createPagePipeline`, first below), the lifecycle (the answers a server gives before any
// of the app's code, the 500, and the jobs it runs on a timer; `createLifecycle`), and the whole
// server that puts them together with the service dispatcher and the module server
// (`createJurisServer`, at the end of this file), which is what an app calls.
//
// createPagePipeline(options) → { render(url, viewer), handle(req, res, url), close() }
//
// `handle` answers a request for a page, always in this order, which is not configurable because it
// is what keeps a page from reaching someone it was not for:
//   1. the path's one spelling (canonicalPath): any other is a 301 to it, before anything reads it
//   2. who is asking (`viewer`), null for a guest
//   3. the route, as the router's resolve() names it for this request (who is asking is its
//      context): a location resolve answers, the router's guard's or the route table's own
//      redirect, sends the request there (302), before the cache is asked, so a copy kept for
//      guests is never served past a guard
//   4. the app's `before` hooks, in order: the first to answer a location redirects
//   5. the page cache, for guests only, and not for a guest's request the app's `personal` says is
//      theirs alone: a hit is sent, and a stale hit is sent while one render replaces it
//   6. the render, kept for the next guest when the cache allows it. A page the cache may keep is
//      rendered from its cache key, not from the address as asked: the key keeps only the query
//      parameters pages read, and a page rendered from the whole address would carry the first
//      visitor's other parameters in its state to every visitor it is served to. A viewer's page and
//      a personal one are rendered as asked and never kept
//   7. the answer: `public` for a guest, `private` for a viewer or a personal request, `no-store` in
//      development
// `handle` does not read the method: createJurisServer refuses all but GET and HEAD before a page is
// asked for, and a server built from the parts refuses them itself (http.js refuseMethod). A 304 is
// sent to a GET or a HEAD that holds the page's ETag, and never for a 404 (http.js send).
// `render` is step 6 without the cache: the route's preload, one `renderRequest`, the status, the
// title and the document. It resolves the address it renders from itself, so the router's guard is
// asked again there: no render, a stale page's replacement included, is drawn past it. `close()`
// begins no more stale pages' replacements and resolves once those under way have finished.
//
// One Juris instance renders every request, and `renderRequest` keeps them apart by replacing the
// whole state (`clearState`) and serialising it (`serializeState`) with nothing in between that
// could yield. So every hook here runs before `renderRequest` is called (the preload list, the
// state) or after it returns (the title, the head). None may run inside it, and none does.
import http from "node:http";
import nodeCluster from "node:cluster";
import Juris, { sharedOptions } from "juris/juris.js";
import { defaultExposeError } from "juris/errors.js";
import { createRouter, titleOf } from "juris/router.js";
import { renderDocument, inlineScriptHashes } from "./document.js";
import SSRRenderer from "./ssr-renderer.js";
import { pack, send, clientIp, refuseMethod } from "./http.js";
import { canonicalPath, pageCacheKey } from "./page-cache.js";
import { createModuleServer } from "./modules.js";
import { serviceDispatcher } from "./service-dispatcher.js";

// The route an address lands on, as the router's resolve() names it: what the hooks are given as
// `ctx.route`. Whether it is a 404 is resolve's `notFound` (the catch-all, or nothing at all).
const routeOf = ({ name, params, meta, head, matched, notFound }) => ({ name, params, meta, head, matched, notFound });

const isNameList = (value) => Array.isArray(value) && value.every((name) => typeof name === "string");

// createPagePipeline(options):
//   juris         the server's Juris instance (`isServer: true`, `features: { ssr: SSRRenderer }`),
//                 with `router` installed and every component a page draws registered
//   router        that router
//   layout        the root layout ({ App: {} } unless told)
//   entry         the URL of the app's browser entry, or a function answering it (asked per page)
//   origin        the site's origin ("https://example.com"): the canonical link is the origin and
//                 the page's path, encoded. null writes no canonical link
//   devReload     the development reload client (dev-reload.js `script`), or null
//   dev           development: every answer is `no-store`, and every page carries #juris-dev
//                 (renderDocument's `jurisDev`), which turns the browser's devMode on (hydrate)
//   cache         a page cache (page-cache.js `createPageCache`), or null to keep nothing
//   cacheParams   the query parameters pages read: the cache key keeps only these, and a page
//                 the cache may keep is rendered from its key, so it is given only these. One a
//                 page reads that is not here never reaches a guest's page while there is a cache
//   viewer(req, url)             who is asking, or null for a guest. A viewer's page is personal:
//                                never kept, never served from the cache, sent `private`
//   extra(viewer)                what a route's `preload` is given beside its location (the
//                                router's `resolve(url, extra, ctx)`): in practice who is asking,
//                                spelled as the preload keys spell it. Nothing unless told
// The guard is the router's (createRouter({ guard })), asked in resolve() with `{ viewer }` as its
// context, and a pipeline refuses one of its own: it would never be asked.
//   before                       [(ctx) → null | { location, status }]: 302 unless `status` says
//   personal(ctx)                true when a guest's request carries something that is theirs
//                                alone, so its page must be neither served from the guests' copy
//                                nor kept for the next guest (a reference to what their refused
//                                form said, say). Asked after the `before` hooks, for guests only;
//                                such a page is rendered as asked and sent `private`. Nothing unless
//                                told
//   preload(ctx)                 calls every page preloads, before the route's own
//   state(ctx)                   the page's state roots, beside the router's
//   notFound(own, ctx)           true when the route's own call (the first of its preload) says
//                                its subject is not there: the page is then a 404. `own` is that
//                                call's answer (renderRequest's `result`), undefined when it failed
//   title                        { fallback, suffix, max, decorate }: the router's titleOf on the
//                                route's `head` and its own call's answer: `head.titleFrom(own)`
//                                names the page from its own data (cut to `max` characters, then
//                                `suffix`); otherwise `head.title`, otherwise `fallback`
//                                (`meta.title` and `meta.titleFrom` stand for the head's for one
//                                release); `decorate` is applied to whichever it is. A failed
//                                call or a titleFrom that throws never names a page: the static
//                                title is a fine answer. A browser given the same options
//                                (hydrate's `title`) names the page the same
//   head(ctx)                    renderDocument's options for this page (description, links, meta,
//                                styles, trustedHead, …), given the title in `ctx.title`. The title,
//                                the canonical, the entry, the service names and the reload client
//                                are the kernel's; the description is the route's `head.description`
//                                unless this gives one
//   headers({ scriptHashes, url, route, viewer })   the page's own response headers (a
//                                Content-Security-Policy), { name: value }: asked per rendered page
//                                with the hashes of its inline scripts, kept and sent with the page
//   serviceNames                 the names of the services a browser may call, written into every
//                                page as JSON in #services (renderDocument), or null for none
//   onRender({ key, decision, trace })   after each render `handle` asked the cache about
//   onError(error, where)        a failure nobody is waiting for (a stale page's replacement)
// `ctx` is { req, url, route, viewer } for the `before` hooks and `personal`, and { url, route,
// viewer } for the render's hooks (a stale page is replaced with no request): `url` a URL, `route`
// the route the address lands on as the router's resolve() names it ({ name, params, meta, head,
// matched, notFound }), which the pipeline takes as it is, never matching the path again. Every hook may
// return a promise. An option that is not one of these is refused.
const PIPELINE_OPTIONS = new Set(["juris", "router", "layout", "entry", "origin", "devReload", "dev", "cache", "cacheParams", "viewer", "extra",
    "before", "personal", "preload", "state", "notFound", "title", "head", "headers", "serviceNames", "onRender", "onError"]);

// What a page's response writes itself, which its `headers` hook may not give.
const SENT_HEADERS = new Set(["content-type", "etag", "cache-control", "vary", "content-encoding", "content-length"]);

export function createPagePipeline(options = {}) {
    for (const key of Object.keys(options ?? {})) {
        if (key === "guard") throw new TypeError("createPagePipeline: guard is the router's (createRouter({ guard })), asked in its resolve(); one given here would never be asked");
        if (!PIPELINE_OPTIONS.has(key)) throw new TypeError(`createPagePipeline: "${key}" is not an option (${[...PIPELINE_OPTIONS].join(", ")})`);
    }
    const {
        juris,
        router,
        layout = { App: {} },
        entry,
        origin = null,
        devReload = null,
        dev = false,
        cache = null,
        cacheParams = [],
        viewer: viewerOf = () => null,
        extra = () => null,
        before = [],
        personal = () => false,
        preload = () => [],
        state = () => ({}),
        notFound = () => false,
        title: { fallback = "", suffix = "", max = Infinity, decorate = null } = {},
        head = () => ({}),
        headers: pageHeaders = null,
        serviceNames = null,
        onRender = null,
        onError = null,
    } = options ?? {};
    if (pageHeaders !== null && typeof pageHeaders !== "function") throw new TypeError("createPagePipeline: headers is a function of the page's context, answering { name: value }");
    if (!juris?.isServer) throw new TypeError("createPagePipeline: juris, a server instance (isServer: true), is required");
    if (typeof router?.resolve !== "function") throw new TypeError("createPagePipeline: router, installed on that instance, is required");
    if (typeof entry !== "string" && typeof entry !== "function") throw new TypeError("createPagePipeline: entry, the browser entry's URL, is required");
    if (serviceNames !== null && !isNameList(serviceNames)) throw new TypeError("createPagePipeline: serviceNames is a list of service names (strings), or null for none");
    const known = new Set(cacheParams);
    const hooks = Array.isArray(before) ? before : [before];

    // The route's own call is read by the kernel itself, after the render, for the status and the
    // title, and its answer is in the page's state, whether or not the body calls it: so it counts as
    // read in the trace the cache decides on. A page titled from a service that nothing in its body
    // calls was decided static (kept until the cache was cleared) or kept on no service, and no
    // change to that service ever evicted it.
    const readOwn = (trace, [name, ...args]) => {
        if (!trace) return trace;
        const key = juris.callKey(name, args);
        return {
            ...trace,
            calls: trace.calls.includes(key) ? trace.calls : [...trace.calls, key],
            services: trace.services.includes(name) ? trace.services : [...trace.services, name],
            static: false,
        };
    };

    // The canonical is the page's own path, as a URL carries it. Node accepts `"` and `<` in a
    // request line, and the path is written into an attribute: parsing it as a URL percent-encodes
    // them. The scheme and host are prepended rather than passed as a base, so a path that begins
    // `//` stays a path instead of becoming a host.
    const canonicalOf = (path) => (origin === null || origin === undefined ? null : `${origin}${new URL(`http://canonical${path}`).pathname}`);

    const render = async (url, viewer = null) => {
        // `extra` may answer a promise, as every hook may: resolve spreads what it is given into each
        // preload's argument, so it is given the value, never the promise.
        const resolved = router.resolve(url, await extra(viewer), { viewer });
        if (resolved.redirect) return { redirect: resolved.redirect };
        const where = resolved.state[router.routePath];
        const route = routeOf(resolved);
        const ctx = { url: new URL(url, "http://localhost"), route, viewer };
        const own = resolved.preload[0];
        // Every hook that feeds the render runs here, before it; nothing runs inside it.
        const calls = [...((await preload(ctx)) ?? []), ...resolved.preload];
        const roots = (await state(ctx)) ?? {};
        // What the page is called: from its own data when the route knows where its name lives, so
        // no second fetch is needed to title it, and otherwise the route's own title. The router's
        // titleOf, which the browser asks too (hydrate's `title`), so the name does not change when
        // the page boots. Worked out inside the render (`after`): a titleFrom reading what the render
        // set reads this page's, never a request's that began while this one awaited notFound.
        const titled = (result) => titleOf(route.head, own ? result(...own) : undefined, { fallback, suffix, max });
        const rendered = await juris.renderRequest({ preload: calls, state: { ...resolved.state, ...roots }, layout, trace: true, after: titled });

        // A page about one thing that is not there is a 404, not a 200 saying so: a 404 is never
        // kept, while a 200 for every unknown name would let anyone fill the cache with junk and
        // push real pages out. The route's own call (its first preload) says so, as the app reads it:
        // its answer as the service gave it, or undefined when it failed.
        const ownResult = own ? rendered.result(...own) : undefined;
        let status = route.notFound ? 404 : 200;
        if (status === 200 && own && (await notFound(ownResult, ctx))) status = 404;

        let text = rendered.after;
        if (decorate) text = decorate(text);

        const extraHead = (await head({ ...ctx, title: text })) ?? {};
        const html = renderDocument(rendered, {
            ...extraHead,
            description: extraHead.description ?? route.head.description,
            title: text,
            canonical: canonicalOf(where.path),
            entry: typeof entry === "function" ? await entry() : entry,
            serviceNames,
            devReload,
            jurisDev: dev ? {} : null,
        });
        const page = pack(html, { status });
        // The page's own headers, with the hashes of the scripts it runs inline: kept with the page.
        if (pageHeaders) {
            const given = (await pageHeaders({ ...ctx, scriptHashes: inlineScriptHashes(html) })) ?? {};
            if (!isPlainObject(given)) throw new TypeError("createPagePipeline: headers(ctx) answers { name: value }");
            for (const name of Object.keys(given)) {
                if (SENT_HEADERS.has(name.toLowerCase())) throw new TypeError(`createPagePipeline: headers(ctx) may not give ${name.toLowerCase()}, which the response writes itself`);
            }
            page.headers = given;
        }
        page.trace = own ? readOwn(rendered.trace, own) : rendered.trace;
        return page;
    };

    // Render, and keep the page for the next guest when the cache allows it. The snapshot is taken
    // before the render reads anything: a change to one of its services announced while it renders
    // makes the cache refuse it, since it was made from data already known to be wrong.
    // `own`: a guest's page that is theirs alone (`personal`), which the cache is not asked about at
    // all, so it neither keeps it nor drops the guests' copy for it. Nor is a viewer's: a put for it
    // was decided "personal", and a refused put drops what the key holds, so every signed-in page
    // view evicted the guests' copy of that page.
    const renderAndCache = async (url, key, viewer, own = false) => {
        const kept = own || viewer ? null : cache;
        const snapshot = kept?.snapshot() ?? null;
        let page;
        try {
            page = await render(url, viewer);
        } catch (error) {
            kept?.release(key);              // a failed replacement must not leave "in progress" set
            throw error;
        }
        if (page.redirect) { kept?.release(key); return page; }
        const decision = kept ? kept.put(key, page, page.trace, { viewer, status: page.status }, snapshot) : { cache: false, reason: own || viewer ? "personal" : "cache off" };
        onRender?.({ key, decision, trace: page.trace });
        return page;
    };

    // A stale page's replacement, rendered once the answer is out. Each is tracked until it settles,
    // so `close()` can wait for it: one that ran after the server's onShutdown hooks closed the pool
    // would render from a pool already closed. One not yet begun when `close()` is called is not
    // begun at all, and its key is handed back.
    const regenerating = new Set();
    let closed = false;
    const regenerate = (key) => {
        const done = new Promise((resolve) => setImmediate(resolve))
            .then(() => (closed ? cache.release(key) : renderAndCache(key, key, null)))
            .catch((error) => onError?.(error, "regenerate"))
            .finally(() => regenerating.delete(done));
        regenerating.add(done);
    };
    const close = async () => {
        closed = true;
        while (regenerating.size) await Promise.all([...regenerating]);
    };

    const redirect = (res, status, location) => { res.writeHead(status, { location }); res.end(); return true; };
    const policy = (viewer) => (dev ? "no-store" : viewer ? "private" : "public");

    const handle = async (req, res, url = new URL(req.url, "http://localhost")) => {
        // One spelling of every path, decided before anything reads it. A guard and a cache key that
        // read the path as sent, and a renderer that trims it, see different pages: "/admin//"
        // rendered past an admin guard, and "//admin" was kept under "/".
        const { redirect: canonical } = canonicalPath(req.url);
        if (canonical) return redirect(res, 301, canonical);

        const viewer = (await viewerOf(req, url)) ?? null;
        // The route, and whether this visitor may have it: the router's guard, asked in resolve with
        // who is asking, before anything else reads the route and before the cache is asked.
        const resolved = router.resolve(`${url.pathname}${url.search}`, await extra(viewer), { viewer });
        if (resolved.redirect) return redirect(res, 302, resolved.redirect);
        const ctx = { req, url, route: routeOf(resolved), viewer };
        for (const hook of hooks) {
            const answer = await hook(ctx);
            if (answer?.location) return redirect(res, answer.status ?? 302, answer.location);
        }

        // Keyed on the query parameters pages read, in a fixed order, so junk query strings cannot
        // each make an entry of the same page and push real pages out.
        const key = pageCacheKey(url, known);
        const own = !viewer && Boolean(await personal(ctx));
        const cacheable = Boolean(cache) && !viewer && !own;
        const hit = cacheable ? cache.get(key) : null;
        if (hit) {
            // Stale: this visitor gets the page as it was, and a fresh copy renders after the answer
            // is out. The cache hands the flag to one visitor per staleness.
            if (hit.stale) regenerate(key);
            send(req, res, hit.entry, { type: "text/html; charset=utf-8", cache: policy(null), headers: hit.entry.headers });
            return true;
        }
        // A page the cache may keep is rendered from its key, so what is kept is the same whichever
        // visitor made it; a viewer's page is never kept, and is rendered from the address as asked.
        const page = await renderAndCache(cacheable ? key : req.url, key, viewer, own);
        if (page.redirect) return redirect(res, 302, page.redirect);
        send(req, res, page, { type: "text/html; charset=utf-8", cache: policy(viewer ?? (own || null)), headers: page.headers });
        return true;
    };

    return { render, handle, close };
}

// ---- the lifecycle ----------------------------------------------------------------------------
//
// createLifecycle(options) → { serve(handler), start(), drain(), stop(), draining, skipped }
//
// `serve(handler)` is the server's request listener. For every request, in this order:
//   1. `x-instance`, naming this instance, when `instanceHeader` says so (it publishes a name, so
//      it is off unless an app turns it on)
//   2. the request target read as a URL. One no URL can be made of (`//[x`, which Node's parser
//      takes and `new URL` refuses) is the client's mistake: a 400, and nothing else reads it. It
//      used to be parsed where a throw left the listener, and one such request ended the instance
//   3. `/version`: `{ build }`, never kept. A page compares it with the build that rendered it
//   4. `/healthz`: the balancer's question. 503 once `drain()` has been called; otherwise the
//      app's `health.check()` (within `health.timeoutMs`) and 200 with `{ ok, instance, build,
//      ...health.details() }`, or 503 with a fixed body when the check fails or is late. The
//      reason goes to `onError`, never into the body: it is public, and a driver's message names
//      roles, databases and sockets
//   5. the app's `handler(req, res, url)`, with the URL already read
// `/version` and `/healthz` take GET and HEAD alone (http.js refuseMethod): an OPTIONS is a 204 with
// Allow, any other method a 405 with Allow, as RFC 9110 has them (9.3.7, 15.5.6). Every other
// address is the handler's, whatever the method.
// Anything that throws, there or in the handler, is logged through `onError(error, "request")`, and
// the answer is a 500 with a fixed sentence: an error's own words carry file paths and driver text.
// A response already under way is ended as it is.
//
// `jobs` are the work an instance does on a timer: [{ name, every, run, atStart }], `every` a whole
// number of milliseconds up to 2^31 - 1 (about 24.8 days: the longest a Node timer keeps; a longer
// job runs more often and checks whether its time has come). `start()` starts them (a job marked
// `atStart` runs at once, too); a run that throws or rejects is reported as `onError(error, "job
// <name>")` and the job keeps its schedule. A job never runs beside itself: a tick that comes while
// its previous run is in flight is skipped, and `skipped` counts them, by job name. A job's
// timer never keeps the process alive by itself. `stop()` clears them and resolves once any run in
// flight has finished, so what the jobs use (a pool, a bus) can be closed after it. A job calls the
// app's own modules. One that calls an entry of its services hands it `internal(reason)`
// (juris/live-protocol.js): a service reads who is calling from its context, and a job is nobody's
// request, so it says it is the server's own call, of kind "internal", which vouches for no one.
//
// `drain()` is the first step of taking an instance out of rotation: `/healthz` answers 503 from
// then on, while requests already on their way are still answered. `draining` says whether it
// has been called.
//
// createLifecycle(options):
//   build            this instance's build id, or a function answering it (asked on every request:
//                    development moves it when code changes). Required
//   instance         this instance's name, or null: in `/healthz`'s answer, and in `x-instance`
//   instanceHeader   send `x-instance` on every answer (false unless told)
//   health           { check, details, timeoutMs = 2000 }: `check()` fails or rejects when the
//                    instance cannot serve (it cannot reach its database); `details()` adds what
//                    an operator reads (counters). Neither is required. `timeoutMs` is a whole
//                    number of milliseconds, 1 to 2^31 - 1
//   jobs             see above
//   onError(error, where)   where: "request", "healthz" or "job <name>". The log, unless told
// Those are all the options, and `health` and a job take only the keys named: any other is refused
// with a TypeError, not ignored (`health: { timeoutMS }` kept the 2000 ms without a word).
const NO_STORE_JSON = { "content-type": "application/json", "cache-control": "no-store" };
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const LIFECYCLE_OPTIONS = new Set(["build", "instance", "instanceHeader", "health", "jobs", "onError"]);
const HEALTH_OPTIONS = new Set(["check", "details", "timeoutMs"]);
const JOB_OPTIONS = new Set(["name", "every", "run", "atStart"]);
// The longest delay Node's timers keep: one longer is taken as 1 ms, with only a warning, so a monthly
// job ran every millisecond, a health check longer than this failed at once, and a drain this long
// cut every connection at once. Such a value is refused when it is given.
const LONGEST_TIMER = 2 ** 31 - 1;
const isTimerMs = (value, least = 1) => Number.isInteger(value) && value >= least && value <= LONGEST_TIMER;

export function createLifecycle(options = {}) {
    if (!isPlainObject(options)) throw new TypeError("createLifecycle: options is an object");
    for (const key of Object.keys(options)) {
        if (!LIFECYCLE_OPTIONS.has(key)) throw new TypeError(`createLifecycle: "${key}" is not an option (${[...LIFECYCLE_OPTIONS].join(", ")})`);
    }
    if (options.health !== undefined && !isPlainObject(options.health)) throw new TypeError("createLifecycle: health is { check, details, timeoutMs }");
    for (const key of Object.keys(options.health ?? {})) {
        if (!HEALTH_OPTIONS.has(key)) throw new TypeError(`createLifecycle: health.${key} is not an option (${[...HEALTH_OPTIONS].join(", ")})`);
    }
    const {
        build,
        instance = null,
        instanceHeader = false,
        health: { check = null, details = null, timeoutMs = 2000 } = {},
        jobs = [],
        onError = (error, where) => console.error(`  ${where}:`, error),
    } = options;
    if (typeof build !== "string" && typeof build !== "function") throw new TypeError("createLifecycle: build, the build id or a function answering it, is required");
    if (check !== null && typeof check !== "function") throw new TypeError("createLifecycle: health.check is a function");
    if (details !== null && typeof details !== "function") throw new TypeError("createLifecycle: health.details is a function");
    if (!isTimerMs(timeoutMs)) throw new TypeError(`createLifecycle: health.timeoutMs is a whole number of milliseconds, 1 to ${LONGEST_TIMER}`);
    const names = new Set();
    for (const job of jobs) {
        if (typeof job?.name !== "string" || !job.name) throw new TypeError("createLifecycle: every job has a name");
        if (names.has(job.name)) throw new TypeError(`createLifecycle: two jobs are called "${job.name}"`);
        names.add(job.name);
        for (const key of Object.keys(job)) {
            if (!JOB_OPTIONS.has(key)) throw new TypeError(`createLifecycle: job "${job.name}": ${key} is not an option (${[...JOB_OPTIONS].join(", ")})`);
        }
        if (!isTimerMs(job.every)) throw new TypeError(`createLifecycle: job "${job.name}" needs an interval, every, a whole number of milliseconds, 1 to ${LONGEST_TIMER} (about 24.8 days)`);
        if (typeof job.run !== "function") throw new TypeError(`createLifecycle: job "${job.name}" has nothing to run`);
    }
    const buildOf = typeof build === "function" ? build : () => build;
    let draining = false;

    // The check, bounded: a database that never answers must not hold the balancer's question open.
    const checked = async () => {
        if (!check) return;
        let timer;
        try {
            await Promise.race([
                check(),
                new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`the health check did not answer within ${timeoutMs} ms`)), timeoutMs); }),
            ]);
        } finally {
            clearTimeout(timer);
        }
    };

    const serve = (handler) => async (req, res) => {
        if (instanceHeader && instance) res.setHeader("x-instance", instance);
        let url;
        try { url = new URL(req.url, "http://localhost"); }
        catch { res.writeHead(400, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); return res.end("Bad request."); }
        try {
            const own = url.pathname === "/version" || url.pathname === "/healthz";
            if (own && refuseMethod(req, res)) return;
            if (url.pathname === "/version") {
                res.writeHead(200, NO_STORE_JSON);
                return res.end(JSON.stringify({ build: buildOf() }));
            }
            if (url.pathname === "/healthz") {
                // Draining: out of rotation, while the requests already here finish.
                if (draining) { res.writeHead(503, { ...NO_STORE_JSON, connection: "close" }); return res.end(JSON.stringify({ ok: false, error: "stopping" })); }
                try {
                    await checked();
                    const body = { ok: true, ...(instance ? { instance } : {}), build: buildOf(), ...(details ? details() : {}) };
                    res.writeHead(200, NO_STORE_JSON);
                    return res.end(JSON.stringify(body));
                } catch (error) {
                    onError(error, "healthz");
                    res.writeHead(503, NO_STORE_JSON);
                    return res.end(JSON.stringify({ ok: false, error: "unavailable" }));
                }
            }
            return await handler(req, res, url);
        } catch (error) {
            // The log gets the error; the public gets a sentence.
            onError(error, "request");
            if (res.headersSent) return res.end();
            res.writeHead(500, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
            res.end("Something went wrong on our side. Try again in a moment.");
        }
    };

    // The jobs. A run is tracked until it settles, so stop() can wait for it. A job runs one at a
    // time: a tick that comes while its previous run is still in flight is skipped, and counted
    // (`skipped`), not reported as an error. Otherwise a run slower than its interval started another
    // beside it on every tick, without bound.
    const timers = [];
    const running = new Set();
    const inFlight = new Set();                           // the jobs with a run under way
    const skipped = Object.fromEntries(jobs.map((job) => [job.name, 0]));
    let started = false;
    let stopped = false;
    const run = (job) => {
        if (inFlight.has(job)) { skipped[job.name]++; return; }
        inFlight.add(job);
        const settled = (async () => job.run())()
            .catch((error) => onError(error, `job ${job.name}`))
            .finally(() => { running.delete(settled); inFlight.delete(job); });
        running.add(settled);
    };
    const start = () => {
        if (started || stopped) return;
        started = true;
        for (const job of jobs) {
            if (job.atStart) run(job);
            timers.push(setInterval(() => run(job), job.every).unref());
        }
    };
    const stop = async () => {
        stopped = true;
        for (const timer of timers.splice(0)) clearInterval(timer);
        await Promise.all([...running]);
    };

    return {
        serve,
        start,
        stop,
        drain: () => { draining = true; },
        get draining() { return draining; },
        get skipped() { return { ...skipped }; },
    };
}

// ---- the whole server -------------------------------------------------------------------------
//
// createJurisServer(config) → Promise<{ listen, handle, render, close, codeId, juris, router }>
//
// The pieces above, with the service dispatcher and the module server, put together once, so that
// an app writes its routes, its components, its services and this one call, and no plumbing:
//
//   const app = await createJurisServer({ root, build, services, routes, setup, api, modules, page });
//   await app.listen({ port: 3000 });
//
// It builds the server's Juris instance (`isServer`, `requirePreload`: a call a render makes must
// have been preloaded, never run in the middle of it), installs the router made from `routes`, hands
// the instance to `setup` (awaited) to register the app's components and plugins, and then loads
// every route's code (the router's `loadAll`: each record's `load`, and its `register`, once per page
// module), so no render meets a route whose components are not registered yet. Then every
// request is answered in this order, which is not configurable, because it is what keeps each
// answer from reaching someone it was not for:
//   1–3. the lifecycle's: `x-instance` (when asked), the 400 for a target no URL can be made of,
//        `/version`, `/healthz`
//   4.   development only: /__reload, the reload stream (`devReload`)
//   5.   /api/: the service dispatcher (JSON calls only, a refusal's message shown only when it was
//        written for the caller, the live queries' event stream and subscriptions), or the handler
//        the app built in its place
//   6.   the app's own `handlers`, in order, for the routes it has beside its pages (uploads, say):
//        the first that answers ends the search
//   7.   the browser modules, the root files and the static files (the module server: the flat
//        /src/ always (the juris package), never the kit's server/, and the app's mounts)
//   8.   /favicon.ico: 204, unless a root file answers it; /.well-known/: 404. Browsers and tools
//        ask for both by themselves, and neither is a page to render
//   9.   a page (the pipeline: the one spelling of its path, who is asking, the route and the
//        router's guard, the `before` hooks, the page cache for a guest, the render, the answer)
// Steps 7 to 9 take GET and HEAD alone, and that is decided once, before step 7 reads anything
// (http.js refuseMethod): an OPTIONS is a 204 with Allow, any other method a 405 with Allow, as RFC
// 9110 has them (9.3.7, 15.5.6), and no page is rendered for it. What takes another method is the
// app's: a service (POST, under /api/) or one of its `handlers` (an upload, a sign-out). A no-JS
// form posts to a service, never to a page.
// Anything that throws is the lifecycle's fixed 500, with the error sent to `onError`.
//
// Every page carries the names of the services a browser may call (renderDocument's `#services`),
// so an app needs no module of its own to list them: by default the names the dispatcher answers to.
//
// `listen({ port = 0, host = "127.0.0.1" })` starts serving (once) and starts the jobs; it answers
// `{ port, host, url }`. It binds the loopback address unless told: a server reachable from the whole
// network is something an app asks for. `close()` drains, in this order, and answers the same
// promise however often it is called:
//   1. out of rotation: `/healthz` answers 503 on the connections still open
//   2. the live queries' event streams ended (the dispatcher's `close()`, or the app's handler's),
//      and development's reload streams (`devReload.close()`): each is a request that never ends by
//      itself, so the server's close would otherwise wait on it for the whole bound
//   3. the idle connections closed, and the requests in flight let finish, for at most
//      `closeTimeoutMs` (8000 unless told, below a 10 s forced exit), after which every connection
//      still open is cut
//   4. the jobs stopped, once any run in flight has finished, and the stale pages' replacements
//      under way finished (none begins from then on)
//   5. the app's `onShutdown` hooks, in order, each awaited: what the requests and the jobs used (a
//      change bus, a database pool), closed only once nothing is left to use it. A hook that fails
//      is reported as `onError(error, "shutdown")`, and the next still runs
// The entry decides when (a signal, say), since only it touches the Node process, and ends the
// process once `close()` has answered.
//
// config:
//   root            the app's directory (a path or a file: URL): mounts, assets and root files are
//                   relative to it. Required
//   dev             development: nothing snapshotted or kept, every answer `no-store`, and every
//                   page carries #juris-dev, which turns the browser's devMode on, and with it the
//                   devtools feature (false unless told: an app maps its own environment onto it;
//                   a browser entry says no with hydrate({ devMode: false })). The server's own
//                   instance is never in devMode
//   build           this deploy's name, a non-empty string, or a function answering it (asked on
//                   every `/version` and `/healthz`; the module server takes its value at start).
//                   Required
//   services        { name: (...args) → value }: what `api.call` and `api.live` reach, on the server
//                   directly and from a browser through the dispatcher. Required
//   routes          the route records (juris/router.js). Required
//   router          the router's own options beside its routes (createRouter's), above all `guard(to,
//                   ctx)`: who may open a route, asked in resolve() with `{ viewer }`, who the page's
//                   `viewer` hook says is asking, so the one function the browser's router asks
//                   decides on the server too. `context`, the browser's side of it, is taken and
//                   unused here
//   setup(juris)    registers the app's components and plugins on the server's instance, after the
//                   router is installed; awaited. Every route's own code (`load`, `register`) is
//                   loaded after it, by the kernel
//   layout          the root layout ({ App: {} } unless told)
//   juris           the instance's own options, { allowTags, allowSchemes, allowInnerHTML,
//                   components } (juris.js sharedOptions): the tags and URL schemes both renderers
//                   draw beyond their defaults, whether a layout may set innerHTML, and the
//                   components registered with the instance (before the router and `setup`). The
//                   browser's boot is given the same object (hydrate's `juris`), from one module both
//                   import, or a page loses on boot what the server drew. Nothing else: the rest of
//                   the instance is the kernel's (isServer, requirePreload, services, exposeError)
//   exposeError(error)   whether a caller may read an error's message: in a service's answer and in
//                   a failed preload written into a page. `error.expose === true` unless told
//   api             the dispatcher's options (serviceDispatcher's: `live`, `context`, `expose`, …;
//                   `exposeError` and `onError` are the kernel's unless given), or a handler the app
//                   built, `(req, res, url) → boolean`, which is asked about every /api/ request,
//                   whose `names` say which services it answers to, and whose `close()`, when it has
//                   one, ends its streams when the server drains (a dispatcher's does)
//   handlers        the app's own routes beside its pages: [(req, res, url) → boolean], each asked
//                   in turn after /api/, true when it answered
//   modules         { mounts, assets, rootFiles, static, minify } for createModuleServer, and
//                   `entry`: the URL of the app's browser entry, which a mount or an asset serves.
//                   Required
//   page            createPagePipeline's hooks and options: origin, viewer, extra, before, personal,
//                   preload, state, notFound, title, head, cacheParams, onRender; and `serviceNames`:
//                   the names written into every page (the dispatcher's unless given; false for
//                   none, which an app that ships its own list chooses). `head` is also given
//                   `versioned(path)`, the module server's URL for a file it serves (a stylesheet)
//   cache           a page cache (page-cache.js), for guests' pages. Only beside a handler the app
//                   built: what evicts a kept page is the services' invalidations, which the app
//                   carries to the cache itself (its dispatcher's `live.onInvalidate`), and a
//                   dispatcher built here does not feed one, so its pages would be kept until they
//                   expired whatever changed
//   devReload       development's reload (dev-reload.js `devReload`, which the app makes, since only
//                   its entry can start the process that replaces this one): its stream is served,
//                   its client is written into every page, and it is ended when the server drains.
//                   Refused outside development
//   trustProxy      how many proxies stand in front (true, or { hops }): a dispatcher built here
//                   counts its callers, for its per-caller ceilings, by the address the nearest of
//                   them saw, unless the app gives its own `live.clientKey`. Off unless told: the
//                   header is anyone's to write. Refused beside a handler the app built, which
//                   counts its own callers
//   allowWorkers    serve in a cluster worker beside live queries anyway (the app's startProcess
//                   `allow`); otherwise such a worker is refused
//   instance, instanceHeader, health, jobs   createLifecycle's
//   closeTimeoutMs  how long `close()` lets the requests in flight finish: a whole number of
//                   milliseconds, 0 (cut them at once) to 2^31 - 1
//   onShutdown      [() → promise]: what the app closes last when it drains (step 5 above)
//   onError(error, where)   the log, unless given
//   cluster         Node's cluster, unless a test gives another
// An option that is not one of these is refused, not ignored: a misspelt hook would otherwise leave
// a page unguarded without a word. So is a key inside one of them that takes options: `modules`,
// `page` and `trustProxy` here, `router` by the router, `juris` by sharedOptions, `api` (and its
// `live`, `strict` and `forms`) by the dispatcher, and `health` and a job by createLifecycle. A
// server that cannot be built closes the dispatcher it made, so a change bus's subscription does not
// outlive it.
const SERVER_OPTIONS = new Set(["root", "dev", "build", "services", "routes", "router", "setup", "layout", "juris", "exposeError", "api", "handlers", "modules", "page",
    "cache", "devReload", "trustProxy", "allowWorkers", "instance", "instanceHeader", "health", "jobs", "closeTimeoutMs", "onShutdown", "onError", "cluster"]);
const MODULE_OPTIONS = new Set(["mounts", "assets", "rootFiles", "static", "minify", "entry"]);
const PAGE_OPTIONS = new Set(["origin", "viewer", "extra", "before", "personal", "preload", "state", "notFound", "title", "head", "headers", "cacheParams", "onRender", "serviceNames"]);

function refuseUnknown(given, known, where) {
    for (const key of Object.keys(given)) {
        if (!known.has(key)) throw new TypeError(`createJurisServer: ${where}${key} is not an option (${[...known].join(", ")})`);
    }
}

export async function createJurisServer(config = {}) {
    if (!isPlainObject(config)) throw new TypeError("createJurisServer: config is an object");
    refuseUnknown(config, SERVER_OPTIONS, "");
    const {
        root,
        dev = false,
        build,
        services,
        routes,
        router: routerOptions = {},
        setup = null,
        layout = { App: {} },
        juris: jurisGiven,
        exposeError = defaultExposeError,
        api = {},
        handlers = [],
        modules: moduleConfig = {},
        page = {},
        cache = null,
        devReload = null,
        trustProxy = false,
        allowWorkers = false,
        instance = null,
        instanceHeader = false,
        health = {},
        jobs = [],
        closeTimeoutMs = 8000,
        onShutdown = [],
        onError = (error, where) => console.error(`  ${where}:`, error),
        cluster = nodeCluster,
    } = config;

    // Everything an app must say, checked before anything is read from the disk.
    if (!(root instanceof URL) && !(typeof root === "string" && root)) throw new TypeError("createJurisServer: root, the app's directory (a path or a file: URL), is required");
    const buildOf = typeof build === "function" ? build : () => build;
    if (typeof buildOf() !== "string" || !buildOf()) throw new TypeError("createJurisServer: build, this deploy's name (a non-empty string, or a function answering one), is required");
    if (!isPlainObject(services)) throw new TypeError("createJurisServer: services, the app's services ({ name: function }), are required");
    if (!Array.isArray(routes)) throw new TypeError("createJurisServer: routes, a list of route records, are required");
    if (!isPlainObject(routerOptions)) throw new TypeError("createJurisServer: router is the router's options beside its routes ({ guard, … })");
    if ("routes" in routerOptions) throw new TypeError("createJurisServer: router.routes: the routes are an option of their own, routes");
    if (setup !== null && typeof setup !== "function") throw new TypeError("createJurisServer: setup is a function, given the server's Juris instance");
    const instanceOptions = sharedOptions(jurisGiven, "createJurisServer");
    if (typeof exposeError !== "function") throw new TypeError("createJurisServer: exposeError is a function");
    if (!isPlainObject(api) && typeof api !== "function") throw new TypeError("createJurisServer: api is the dispatcher's options, or a handler (req, res, url) → boolean");
    const built = typeof api !== "function";
    if (!Array.isArray(handlers) || !handlers.every((handler) => typeof handler === "function")) throw new TypeError("createJurisServer: handlers is a list of the app's own routes, (req, res, url) → boolean");
    if (cache !== null && !["get", "put", "snapshot", "release"].every((name) => typeof cache?.[name] === "function")) throw new TypeError("createJurisServer: cache is a page cache (page-cache.js createPageCache), or null for none");
    if (cache !== null && built) {
        throw new TypeError("createJurisServer: a page cache is kept up to date by the services' invalidations, which a dispatcher built here does not carry to it: build the dispatcher with live.onInvalidate feeding the cache's invalidate, and pass it as api");
    }
    if (devReload !== null && !(typeof devReload?.script === "string" && typeof devReload.handle === "function" && typeof devReload.close === "function")) {
        throw new TypeError("createJurisServer: devReload is development's reload (dev-reload.js devReload), or null");
    }
    if (devReload !== null && !dev) throw new TypeError("createJurisServer: devReload is development's, and this server is not in development");
    if (isPlainObject(trustProxy)) refuseUnknown(trustProxy, new Set(["hops"]), "trustProxy.");
    const hops = trustProxy === true ? 1 : isPlainObject(trustProxy) ? (trustProxy.hops ?? 1) : null;
    if (trustProxy !== false && !(Number.isInteger(hops) && hops >= 1)) throw new TypeError("createJurisServer: trustProxy is false, true, or { hops }, a whole number of proxies, at least 1");
    if (trustProxy !== false && !built) throw new TypeError("createJurisServer: trustProxy says how a dispatcher built here counts its callers, and api is a handler the app built, which counts its own");
    if (typeof allowWorkers !== "boolean") throw new TypeError("createJurisServer: allowWorkers is true or false");
    if (typeof cluster?.isWorker !== "boolean") throw new TypeError("createJurisServer: cluster is Node's cluster");
    if (!isPlainObject(moduleConfig)) throw new TypeError("createJurisServer: modules is { mounts, assets, rootFiles, minify, entry }");
    refuseUnknown(moduleConfig, MODULE_OPTIONS, "modules.");
    if (!isPlainObject(page)) throw new TypeError("createJurisServer: page is an object of the page pipeline's hooks");
    refuseUnknown(page, PAGE_OPTIONS, "page.");
    if (!isTimerMs(closeTimeoutMs, 0)) throw new TypeError(`createJurisServer: closeTimeoutMs is a whole number of milliseconds, 0 (cut at once) to ${LONGEST_TIMER}`);
    if (!Array.isArray(onShutdown) || !onShutdown.every((hook) => typeof hook === "function")) throw new TypeError("createJurisServer: onShutdown is a list of what the app closes last, () → promise");
    if (typeof onError !== "function") throw new TypeError("createJurisServer: onError is a function");
    const { entry, ...moduleOptions } = moduleConfig;
    if (typeof entry !== "string" || !entry) throw new TypeError("createJurisServer: modules.entry, the URL of the app's browser entry, is required");
    const { serviceNames: namesGiven, ...hooks } = page;
    if (namesGiven !== undefined && namesGiven !== false && !isNameList(namesGiven)) {
        throw new TypeError("createJurisServer: page.serviceNames is a list of service names, or false for none");
    }
    if (namesGiven === undefined && typeof api === "function" && !isNameList(api.names)) {
        throw new TypeError("createJurisServer: api is a handler that does not say which services it answers to (its `names`), so the page cannot either: give page.serviceNames, a list, or false for none");
    }

    // A cluster worker beside live queries: a browser's event stream and its subscribe calls are
    // separate connections, which the cluster hands to different workers, and a worker knows only
    // its own streams, so every subscription would be refused. startProcess refuses to fork such
    // workers; this is for one forked some other way. A handler the app built is taken to serve
    // live queries, since the kernel cannot see inside it.
    const live = !built || Boolean(api.live && ((api.live.queries?.length ?? 0) > 0 || Object.keys(api.live.touches ?? {}).length > 0));
    if (cluster.isWorker && live && !allowWorkers) {
        throw new Error("createJurisServer: this is a cluster worker, and live queries do not survive workers on one port: a client's event stream and its subscribe calls land on different workers, and every subscription is refused. Run separate instances behind a balancer that keeps a client on one, or say allowWorkers");
    }

    // The server's instance and its router. Every request renders on this one instance, and
    // renderRequest keeps them apart; a call its render makes must have been preloaded. It renders
    // to a string with the kit's renderer (ssr-renderer.js), given as a feature: the core has none.
    const juris = new Juris({
        ...instanceOptions,
        services,
        isServer: true,
        requirePreload: true,
        exposeError,
        reportError: (error, name) => onError(error, `preload ${name}`),
        features: { ssr: SSRRenderer },
    });
    const router = createRouter({ ...routerOptions, routes });
    juris.use(router);
    await setup?.(juris);
    // Any page may be asked for, so every route's code is here before the first: each record's
    // `load`, and its `register` (the router's loadAll).
    await router.loadAll();

    // Behind proxies, a caller is the address the nearest one saw, not the proxy's own.
    const liveOptions = built && api.live && trustProxy !== false
        ? { clientKey: (req, owner) => owner ?? `ip:${clientIp(req, { trustProxy: { hops } })}`, ...api.live }
        : api.live;
    const dispatch = built
        ? serviceDispatcher(services, "/api", { exposeError, onError: (error, where) => onError(error, `api ${where}`), ...api, ...(liveOptions ? { live: liveOptions } : {}) })
        : api;
    const serviceNames = namesGiven === false ? null : [...(namesGiven ?? dispatch.names)];

    let modules, pipeline, life;
    try {
        modules = await createModuleServer({ root, dev, build: buildOf(), ...moduleOptions });
        // The entry is a file this server serves (and in production, one it started with), or no
        // page could boot: said now rather than on the first page.
        await modules.versioned(entry).catch(() => {
            throw new TypeError(`createJurisServer: modules.entry ${entry} is not a file the module server serves: a mount or an asset names it, and it exists`);
        });
        const { head } = hooks;
        pipeline = createPagePipeline({
            ...hooks,
            ...(head ? { head: (ctx) => head({ ...ctx, versioned: modules.versioned }) } : {}),
            juris,
            router,
            layout,
            dev,
            cache,
            devReload: devReload?.script ?? null,
            entry: () => modules.versioned(entry),
            serviceNames,
            onError,
        });
        life = createLifecycle({ build: buildOf, instance, instanceHeader, health, jobs, onError });
    } catch (error) {
        // A dispatcher built here may already hold a bus subscription; nothing else is open yet.
        if (built) dispatch.close();
        throw error;
    }

    // Steps 4–9 of the order above; the lifecycle's `serve` is 1–3 and the 500 around them.
    const handle = life.serve(async (req, res, url) => {
        if (devReload?.handle(req, res, url)) return;
        if (url.pathname.startsWith("/api/") && (await dispatch(req, res, url))) return;
        for (const route of handlers) if (await route(req, res, url)) return;
        // What is left is the kit's own to answer, and takes GET and HEAD alone.
        if (refuseMethod(req, res)) return;
        if (await modules.handle(req, res, url)) return;
        if (url.pathname === "/favicon.ico") { res.writeHead(204); return res.end(); }
        if (url.pathname.startsWith("/.well-known/")) { res.writeHead(404); return res.end(); }
        await pipeline.handle(req, res, url);
    });

    let server = null;
    let closing = null;
    const listen = async ({ port = 0, host = "127.0.0.1" } = {}) => {
        if (closing) throw new Error("createJurisServer: closed");
        if (server) throw new Error("createJurisServer: already listening");
        server = http.createServer(handle);
        try {
            await new Promise((resolve, reject) => {
                server.once("error", reject);
                server.listen(port, host, () => { server.off("error", reject); resolve(); });
            });
        } catch (error) {
            server = null;
            throw error;
        }
        life.start();
        const bound = server.address().port;
        return { port: bound, host, url: `http://${host.includes(":") ? `[${host}]` : host}:${bound}` };
    };

    const close = () => {
        closing ??= (async () => {
            life.drain();
            dispatch.close?.();
            devReload?.close();
            if (server) {
                const closed = new Promise((resolve) => server.close(() => resolve()));
                server.closeIdleConnections();
                let timer;
                const late = new Promise((resolve) => { timer = setTimeout(resolve, closeTimeoutMs, "late"); });
                const outcome = await Promise.race([closed.then(() => "closed"), late]);
                clearTimeout(timer);
                if (outcome === "late") {
                    server.closeAllConnections();
                    await closed;
                }
            }
            await life.stop();
            // A stale page's replacement renders with no request, so the server's close did not
            // wait for it.
            await pipeline.close();
            // Only now is nothing left that uses what the app opened.
            for (const hook of onShutdown) {
                try { await hook(); } catch (error) { onError(error, "shutdown"); }
            }
        })();
        return closing;
    };

    // A change made outside a service call (a job, a webhook the app answers itself) reaches the
    // live queries and the bus the way a service's `touches` do: `invalidate(targets)`, the same
    // targets. Only with the dispatcher built here; an app that built its own calls its own.
    const invalidate = (targets) => {
        if (!built) return Promise.reject(new TypeError("createJurisServer: invalidate() is the dispatcher's, and this server was given a handler of the app's: call that handler's own invalidate"));
        return dispatch.invalidate(targets);
    };

    return {
        listen,
        handle,
        render: pipeline.render,
        close,
        invalidate,
        get codeId() { return modules.codeId; },
        juris,
        router,
    };
}

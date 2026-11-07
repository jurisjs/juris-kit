// The service dispatcher: the server half of the shared services API, plus live queries. Node only:
// the kit's server/ is never served, so no browser downloads this file. The browser half,
// remoteServices and sseClient, is juris/remote-services.js; what both ends compute (the
// call key, the diff) is juris/live-protocol.js.
//
// serviceDispatcher(services, base, options) returns (req, res) => Promise<boolean> for Node's
// http module: it answers POST `${base}/${name}` by running services[name](...args) and returning the
// result as JSON (or { error } with a 4xx/5xx), and returns false for any other request so the caller
// can handle it. Rejections become { error: message } so the client stub rejects with the same message
// a preloaded { $error } would produce, with the fields a form puts beside its inputs when the
// service named any.
//
// Two headers RFC 9110 has a server send with a status go out with it. Every 405 says `Allow: POST`
// (15.5.6): under the base, a call and a subscribe take POST alone, and any other method is refused,
// a HEAD as a GET is, and an OPTIONS too (a CORS preflight, so answered with no CORS headers, lets
// the browser send nothing more). The live event stream is the one address under the base a browser
// GETs: it takes GET and HEAD, and answers an OPTIONS with a 204 and any other method with a 405,
// each saying `Allow: GET, HEAD` (http.js refuseMethod); a HEAD gets the stream's headers, and no
// stream is opened for it. A 401 whose error names a challenge, `error.challenge`, sends it as
// `WWW-Authenticate` (15.5.2): how the caller signs in is the app's to say, so the kit makes none up.
//
// Live queries (api.live in the core): a query the client keeps subscribed to.
//   - The client opens one Server-Sent Events stream, `${base}/events`, per Juris instance (installed with
//     juris.use(sseClient({ base }))), and registers/unregisters keys through `${base}/_live`.
//   - The server groups subscribers by `(name, args)` — the key the client computes (liveKey) encodes both —
//     so any number of clients watching the same query share one subscription: one DB call and one diff per
//     invalidation, not one per client. When a mutation that `touches` a query name runs (or invalidate(targets)
//     is called), every distinct subscribed query of that name is re-run once and diffed against its last
//     result; only the changed leaves travel, to every client watching it, and each client writes them into
//     the path it chose. An unchanged re-run sends nothing.
//   - On subscribe, a query with no subscribers yet is run once and its full value sent; joining a query
//     that already has subscribers is answered from the cached last value with no new DB call. The client
//     assigns leaf by leaf, so a value the page already has (from the transfer) wakes nothing.
//   - The browser reconnects the stream by itself; on every open the client re-sends its subscriptions.
//   - This sharing relies on identical (name, args) meaning identical, shareable data: unlike an ordinary
//     service call, a live query is never invoked with `this` bound to a request context (see options.context
//     below), so nothing session-specific can leak into a result shared this way by accident.

import { STATUS_CODES } from "node:http";
import { liveKey, diff, CALL_KIND, LIVE_CODES } from "juris/live-protocol.js";
import { EVERYTHING } from "./page-cache.js";
import { readBody, drainBody, onThisSite, refuseMethod } from "./http.js";
import { defaultExposeError, mayExpose, publicMessage } from "juris/errors.js";

// Every page: the target a change whose reach is the whole site invalidates (a member's new avatar,
// a handle, anything drawn on pages no one service names). The page cache reads it as "drop
// everything" (page-cache.js EVERYTHING), and it re-runs no live query. It is data, so it crosses a
// bus, as `{"name":"$pages"}`: the payload the instances of a half-rolled fleet already exchange, so
// it must not change. Used as a `touches` value (`touches: { purge: ALL }`), or through
// `strict.flushAll`.
export const ALL = Object.freeze({ name: EVERYTHING });

// What a live query's run hands the service as `this`: the live layer's own call, frozen, naming
// nobody. One run serves every subscriber, so it may carry no one caller's context.
const LIVE_CALL = Object.freeze({ [CALL_KIND]: "live" });

// The words for a client id this server did not mint, or minted for another owner. The browser's
// client matches the code sent beside them (LIVE_CODES, juris/live-protocol.js), and a client from
// before the code matches these words (/client id/i), so they stay as they are while such a client
// may still be open: a rolling deploy mixes the two.
const STALE_CLIENT = Object.freeze({ error: "unknown or foreign client id", code: LIVE_CODES.CLIENT_UNKNOWN });

// A WWW-Authenticate challenge as RFC 9110 writes one (11.6.1, 11.3): an auth-scheme, which is a
// token, then, after a space, its parameters or its token68, in visible ASCII and spaces. Its shape is
// checked; it is not parsed.
const CHALLENGE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+(?: +[!-~]+)*$/;

// The longest delay a timer can wait (2^31 - 1 ms, about 24.8 days): a live.retryMs past it is no delay.
const MAX_DELAY = 2 ** 31 - 1;

// The names under `${base}/` that are the live layer's own endpoints: the event stream and the
// subscribe call. No service may take one (construction throws).
const RESERVED = Object.freeze(["events", "_live"]);
// The event stream's headers: never kept or transformed on the way (a proxy that buffered it, or
// gzipped it whole, would hold every event back), and kept open.
const STREAM_HEADERS = Object.freeze({
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
});

// Every option the dispatcher reads, by the object it is in (see serviceDispatcher's options). A key
// that is not one of these is refused at construction, not ignored: `live: { strictQuerys: true }`
// was taken, and built a dispatcher without the switch it names.
const OPTIONS = Object.freeze({
    "": new Set(["live", "maxBody", "context", "expose", "strict", "forms", "exposeError", "onError"]),
    live: new Set(["queries", "touches", "keepAlive", "graceMs", "maxKeysPerClient", "maxGroups", "maxBufferBytes", "maxStreamsPerCaller",
        "maxGroupsPerCaller", "maxPostsPerMinute", "recheckMs", "clientKey", "identify", "authorize", "public", "bus", "onInvalidate",
        "strictQueries", "retryMs"]),
    strict: new Set(["names", "flushAll", "warn"]),
    forms: new Set(["allow", "maxBody", "redirect"]),
});
function checkOptionNames(options) {
    const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
    if (!isObject(options)) throw new TypeError("serviceDispatcher: options is an object");
    for (const [where, known] of Object.entries(OPTIONS)) {
        const given = where ? options[where] : options;
        if (given === undefined || given === null) continue;
        if (!isObject(given)) throw new TypeError(`serviceDispatcher: ${where} is an object of options (${[...known].join(", ")})`);
        for (const key of Object.keys(given)) {
            if (!known.has(key)) throw new TypeError(`serviceDispatcher: ${where ? `${where}.${key}` : `"${key}"`} is not an option (${[...known].join(", ")})`);
        }
    }
}

// The name a target names: "name", or { name, … }.
const nameOf = (target) => (typeof target === "string" ? target : target?.name);
// The targets a `touches` entry gives without being called: a list, or one target (ALL among them).
// A function's are known only when it runs.
const targetsOf = (touched) => (typeof touched === "function" ? null : Array.isArray(touched) ? touched : [touched]);

// options.strict (see serviceDispatcher's options): every problem at once, one per line, so an app
// does not find them one start at a time.
function checkStrict({ strict, callable, live, flushAll }) {
    const problems = [];
    if (strict.names !== undefined) {
        const listed = new Set(strict.names);
        const missing = [...listed].filter((name) => !callable.has(name));
        const unlisted = [...callable].filter((name) => !listed.has(name));
        if (missing.length) problems.push(`strict.names names services that do not exist: ${missing.join(", ")}`);
        if (unlisted.length) problems.push(`these services are not in strict.names, so a browser given that list cannot call them: ${unlisted.join(", ")}`);
    }
    const queries = live?.queries ?? [];
    const touches = live?.touches ?? {};
    for (const name of queries) if (!callable.has(name)) problems.push(`live.queries names "${name}", which is not a service`);
    for (const [mutation, touched] of Object.entries(touches)) {
        if (!callable.has(mutation)) problems.push(`live.touches names "${mutation}", which is not a service`);
        for (const target of targetsOf(touched) ?? []) {
            const name = nameOf(target);
            if (name !== EVERYTHING && !callable.has(name)) problems.push(`live.touches["${mutation}"] names "${name}", which is not a service`);
        }
    }
    for (const name of flushAll) if (!callable.has(name)) problems.push(`strict.flushAll names "${name}", which is not a service`);
    const declared = new Set(queries);
    const unclassified = [...callable].filter((name) => !declared.has(name) && !Object.hasOwn(touches, name) && !flushAll.has(name));
    if (unclassified.length) {
        problems.push(`these services do not say what they change (a live query, a live.touches entry, [] for nothing, or strict.flushAll): ${unclassified.join(", ")}`);
    }
    if (problems.length) throw new Error(`serviceDispatcher: strict:\n  ${problems.join("\n  ")}`);
    // Declared queries no touches list names: a subscriber sees the value it subscribed to and no
    // change after it. That may be meant (data nothing on the site writes), so it is said, not refused.
    // A function entry's targets are known only when it runs, so a query only a function names is
    // said too.
    if (typeof strict.warn === "function") {
        const invalidated = new Set();
        for (const touched of Object.values(touches)) for (const target of targetsOf(touched) ?? []) invalidated.add(nameOf(target));
        const idle = queries.filter((name) => !invalidated.has(name));
        if (idle.length) strict.warn(`live queries no live.touches list names, so a subscriber sees only the value it subscribed to: ${idle.join(", ")}`, idle);
    }
}

// options.live: { queries: ["queryName", ...], touches: { mutationName: ["queryName", ...] }, keepAlive: ms, graceMs: ms,
//                 maxKeysPerClient: n (default 64), maxGroups: n (default 10000), maxBufferBytes: n (default 1e6),
//                 maxStreamsPerCaller: n (default 12), maxGroupsPerCaller: n (default 256),
//                 maxPostsPerMinute: n (default 240), recheckMs: ms (default 30000),
//                 clientKey: (req, owner) => string, identify: (info) => owner,
//                 authorize: (name, args, info) => boolean, bus: { publish, subscribe },
//                 onInvalidate: (targets, { remote }) => void, strictQueries: boolean (default false),
//                 retryMs: ms (default 2000) }
//   authorize is called on every subscribe, as the request context (so `this` holds the session, like a
//   service), and a false result answers 403. Without it the only check is that the name is a live query,
//   which is right for public data and wrong for a query whose arguments name someone's private data.
//   It is also re-asked while the subscription lives, at most once per recheckMs per (client, query),
//   with { recheck: true } in `info` and the context captured at subscribe time as `this` — otherwise
//   losing access to something would not stop its patches (handler.invalidateAccess forces it sooner).
//   The per-caller ceilings bound one visitor rather than one client id, which costs nothing to mint:
//   clientKey says who a request is for that purpose, and an app behind a proxy must supply it (the
//   default is the socket address, which is the proxy for everyone).
//   bus carries invalidations between instances: publish(targets) is called for every local invalidation
//   whose targets are serializable, and subscribe(handler) feeds remote ones back in (applied without
//   being re-published). Groups and clients are per-process, so with more than one instance and no bus a
//   change reaches only the clients that happen to be connected to the instance that wrote it.
//   onInvalidate is told of every invalidation this instance applies, with or without a bus: a
//   mutation's `touches`, a flushAll service's ALL, handler.invalidate(targets), and what arrives off
//   the bus (`remote: true`). It is how anything else that holds data the targets name hears of it,
//   a page cache above all (`onInvalidate: (targets) => cache.invalidate(targets)`); it is called
//   before anything is awaited, so what it evicts is gone before this instance takes another
//   request. It sees every target, a function `where` included, and none for an empty list. A throw
//   or a rejection goes to onError ("live.onInvalidate") and stops nothing.
//   A `touches` entry is an array of targets, or a function (input..., result) => targets, sync or async, called with
//   the request context as `this`, the service's arguments, and its result. A target (in `touches`, and in
//   handler.invalidate(targets)) says which groups re-run:
//     "name", or { name }           every group of that query
//     { name, args: [7] }           the groups whose arguments match position by position, compared as strings;
//                                   a group's arguments past the array's end are not compared (so `args: []`
//                                   is every group of that name). `undefined` in a slot matches anything, but
//                                   on this instance only: a bus carries targets as JSON, which writes it as
//                                   null, and another instance then matches only a null argument there
//     { name, where: { a: 1 } }     the groups whose FIRST argument is an object with those fields, compared as
//                                   strings
//     { name, where: (args) => … }  the groups the function accepts, given their whole argument list; one it
//                                   throws for is not matched, the other groups still are, and the
//                                   invalidation then rejects with the first error
//   Every form but the last is data, so it crosses a bus to the other instances; a function is applied on this
//   instance only (bus stats count it as unpublishable). So a message in chat 7 re-runs the groups watching
//   chat 7, not every open chat on the server.
//   retryMs is how long a browser that lost the event stream waits before it opens it again (the SSE
//   `retry:` field, sent first on every stream): 2000 unless said, a whole number of milliseconds of at
//   least 1 (0 would reopen a failing stream in a tight loop), or construction throws. A fleet whose instances take longer to come back may want more.
//   Only live queries may be subscribed to. Anything else (a mutation above all) is refused with 403 and
//   `code: "live.not-a-query"`, before `authorize` is asked, since a subscription runs the service with no
//   request context and re-runs it on every invalidation. Which names are live queries:
//     strictQueries: true   the names in `queries`, and nothing else. A `touches` target is an
//                           invalidation name only: onInvalidate (a page cache) hears it, and it re-runs
//                           groups only when it is also a declared query, so naming a read in a
//                           mutation's list does not make it subscribable. An app whose touches name
//                           a read that is no query should say this.
//     by default            the names in `queries` plus every name an array-valued `touches` entry lists,
//                           as it always has been. Such a name is subscribable whenever `authorize` lets
//                           it be, and an app's rule table with no row for an ordinary read that a
//                           mutation happens to refresh is then all that keeps it from being a query.
//   Either way a direct POST asks `authorize` about a declared query alone: a touches target is an
//   ordinary service there, which no rule was written for.
// options.maxBody: largest request body in bytes (default 1 MB); larger bodies get 413.
//   Every POST must be sent as application/json (else 415): a cross-site <form> cannot send that type
//   without a CORS preflight, so a cookie-authenticated service cannot be triggered from another site.
// options.context: (req, res) => ctx — services are invoked as services[name].call(ctx, ...args), so a
//   service that needs the request (cookies, the session, the client's address) reads `this`. Every
//   context a request builds is marked as a direct call (CALL_KIND, juris/live-protocol.js), whatever it
//   says about itself: an object the app built is marked in place (own and unfrozen) or behind a
//   wrapper that inherits its fields; with no context, or one that returns nothing, the dispatcher
//   hands the request its own, which is only the mark. So a request never reaches a service, or
//   `authorize`, `identify` or a `touches` function, looking like the server's own call. Live
//   queries are the exception: they are re-run as the live layer's own call, with a frozen context
//   of kind "live" that names nobody, because their result is shared across every client subscribed
//   to the same (name, args) — see the live-queries note above.
//   The context built for a subscribe is KEPT (client.ctx), and every re-check of that subscription (before a
//   patch, at most once per recheckMs, and on handler.invalidateAccess) hands it to `authorize` again, long
//   after its response was sent.
//   So an app's context must hold what identifies the caller (a session token, an address) and nothing that
//   answers for it: a viewer resolved once and memoised on the context would pass every re-check, and a
//   session signed out would keep its patches. And it must not close over the response: by a re-check the
//   response has ended (a header written through it then throws, and the re-check counts as a refusal), and
//   the kept context keeps that response, and its request, in memory for as long as the subscription lives.
//   Subscriptions are bounded: a client that has no event stream is dropped after graceMs like one whose
//   stream closed, a client may hold at most maxKeysPerClient keys (429 beyond), the server at most maxGroups
//   distinct queries (503 beyond), and a key must be the query's own `name:JSON(args)` (400 otherwise), so one
//   query cannot be registered many times under different keys.
// options.expose: the service names this dispatcher will answer to. Without it, every own function on
//   `services` at construction time is an endpoint — so an object that also carries internal helpers
//   publishes them. Either way the list is fixed at construction, not looked up per request. Two
//   names are the live layer's endpoints, `events` and `_live`, and construction throws if a service
//   it would answer to has one, whether or not live queries are on.
// options.strict: { names, flushAll, warn } — opt in to having every service say what it changes.
//   Construction throws, listing every problem, if `names` (the list the app gives its browsers, one
//   stub per name) and the services this dispatcher answers to differ either way; if a name in
//   live.queries, a live.touches key or target, or flushAll is not a service; or if a service is
//   none of a declared live query, a live.touches key ([] says "changes nothing a page shows") or a
//   member of flushAll. "Say nothing, so flush everything" was once a default, and it emptied a page
//   cache on every read. flushAll names the services whose success changes what any page may show:
//   each also invalidates ALL (above) once it succeeds, as `touches: ALL` would. warn(message, names)
//   is told, once and at construction, the declared live queries that no touches list names, whose
//   subscribers never see a change: meant or not, that is the app's to decide.
// options.forms: { allow, maxBody = 16384, redirect(name, outcome) } — the no-JavaScript path: a
//   plain <form method="post" action="${base}/<name>"> sends its fields form-encoded, which a service
//   otherwise refuses (415, above). For a name in `allow`, and only then, a form-encoded POST is
//   answered here, and what stands in for the JSON-only rule is: the Origin (or, when a browser sends
//   none, the Referer) names the host the request was sent to, else 403 with nothing run; the body is
//   at most maxBody bytes, else 413; the fields, as one object, are the service's one argument, run
//   through invoke (below) with the request's context, so authorize, the touches and the error filter
//   are the JSON call's. The answer is a 303 to redirect(name, { ok, status, message, fields?,
//   result?, req }): `message` is the refusal's words when exposeError lets the caller read them, and
//   null otherwise (a driver's words go to onError, and the app says what to show instead); it must
//   answer a path on this site ("/…", as the browser's URL parser reads it: see onThisSite), or the
//   request fails rather than send a browser elsewhere.
//   Construction throws without a redirect, or for a name in `allow` that is not a service.
// handler.invoke(name, args, ctx): one call through the whole pipeline, for any transport other than
//   the JSON POST (the form path above, a job, a test): authorize for a declared live query (with
//   `ctx` as `this`), the service (as `ctx`), its touches once it succeeds, and the error filter. It
//   answers { ok: true, result } or { ok: false, status, error, fields?, field?, code? }, what a JSON
//   caller would read. `ctx` is taken as given: one that says no kind is a direct call (callKind).
// options.exposeError: (error) => boolean — whether the caller may read this error's message. The
//   default is `error.expose === true`, i.e. nothing unless a service says so (a ServiceError, from
//   juris/errors.js, does): a driver's message names tables and columns, and it used to travel to the
//   browser as-is. Everything hidden this way is handed to onError instead, so nothing is lost, only
//   redirected. A refusal answers { error, fields?, field?, code? }: see the catch in the handler.
// options.onError: (error, queryName, args) => void — called when a live query fails to re-run (the client is
//   told too, and logs it); without it the failure is only visible in the browser console.
// Those are all the options, and live, strict and forms take only the keys named above (OPTIONS):
// any other, at the top or inside one of the three, is refused at construction with a TypeError, as
// is one of the three that is not an object. A misspelt switch would otherwise be off without a word.
// The returned handler also exposes invalidate(targets) for changes that don't come through a service
// (a batch job, another app, a DB change notification), stats() for tests, and `names`: the service
// names it answers to, in the order they were found, fixed at construction (what a page tells a
// browser it may call).
export function serviceDispatcher(services, base = "/api", options = {}) {
    checkOptionNames(options);
    const prefix = `${base}/`;
    const live = options.live ?? null;
    const clients = new Map(); // clientId -> { res, keys: Set<key>, timer, ping } — which groups this client belongs to
    // One entry per distinct (name, args): any number of clients subscribed to the same query share this,
    // so an invalidation costs one DB call and one diff no matter how many clients are watching.
    const groups = new Map(); // key -> { name, args, last, running, dirty, full, clients: Set<clientId> }
    const declaredQueries = new Set(live?.queries ?? []);
    // What may be subscribed to (see "Only live queries" above the function): the declared queries,
    // and by default every name an array-valued `touches` entry lists as well.
    if (live?.strictQueries !== undefined && typeof live.strictQueries !== "boolean") {
        throw new TypeError(`serviceDispatcher: live.strictQueries is true or false, not ${JSON.stringify(live.strictQueries) ?? String(live.strictQueries)}`);
    }
    const liveQueries = new Set(declaredQueries);
    if (live?.strictQueries !== true) {
        // The NAME of each target: an object target ({ name, args }) went into the set as itself,
        // so its query was not subscribable by name, and the set held objects no name could match.
        // ALL names every page, which is no query.
        for (const touched of Object.values(live?.touches ?? {})) {
            if (!Array.isArray(touched)) continue;
            for (const target of touched) {
                const queryName = nameOf(target);
                if (typeof queryName === "string" && queryName !== EVERYTHING) liveQueries.add(queryName);
            }
        }
    }
    // Subscriptions are refused unless somebody decided who may have them. Being on the live list
    // used to be the whole check when `authorize` was absent, which is right for a board everyone
    // can see and wrong the moment a query takes an id — and the wrongness was invisible, because
    // the default was the permissive one. `public: true` is how an app says the data really is for
    // everyone; it reads as a decision in the config, which is where the decision belongs.
    if (liveQueries.size && !live.authorize && live.public !== true) {
        throw new Error(
            "serviceDispatcher: live queries need live.authorize(name, args, info), or live.public: true if every one of them is for everybody",
        );
    }
    // What this dispatcher will call, fixed now rather than looked up per request. `options.expose`
    // names them explicitly; without it, every own function on `services` at construction time is an
    // endpoint — which is the contract either way, but snapshotting it means a helper attached to
    // the object later (a cache warmer, a test hook) does not quietly become a public RPC.
    const callable = new Set(
        options.expose
            ? options.expose.filter((name) => typeof services[name] === "function")
            : Object.keys(services).filter((name) => typeof services[name] === "function"),
    );
    if (options.expose) {
        const missing = options.expose.filter((name) => typeof services[name] !== "function");
        if (missing.length) throw new Error(`serviceDispatcher: expose names nothing on services: ${missing.join(", ")}`);
    }
    // The live layer's endpoints are `${base}/events` and `${base}/_live`, and a service by either
    // name answered there only while live queries were off: turning them on shadowed it, silently.
    // So the two names are the protocol's whether or not this dispatcher serves live queries.
    const taken = RESERVED.filter((name) => callable.has(name));
    if (taken.length) {
        throw new Error(`serviceDispatcher: ${taken.map((name) => `"${name}"`).join(" and ")} ${taken.length > 1 ? "are" : "is"} reserved for the live layer's endpoints (${RESERVED.map((name) => prefix + name).join(", ")}), with or without live queries: rename the service`);
    }
    const isService = (name) => callable.has(name);
    // The refusal of a name no service has, which it quotes. The name may be anything a caller's JSON
    // carries (a subscribe's, or one an app's own transport hands invoke), and quoting one String()
    // cannot read ({"toString":0}) threw out of the dispatcher, into the host's 500: such a name is
    // not quoted.
    const unknownService = (name) => {
        try { return { error: `unknown service "${name}"` }; } catch { return { error: "unknown service" }; }
    };
    // options.strict: every service says what it changes, and the names the app lists for its
    // browsers are the ones it has (see strict above the function).
    const strict = options.strict ?? null;
    const flushAll = new Set(strict?.flushAll ?? []);
    if (strict) checkStrict({ strict, callable, live, flushAll });
    const forms = options.forms ?? null;
    const formNames = new Set(forms?.allow ?? []);
    const formMax = forms?.maxBody ?? 16384;
    if (forms) {
        if (typeof forms.redirect !== "function") throw new TypeError("serviceDispatcher: forms.redirect(name, { ok, message, … }) must say where a form's answer sends the browser");
        const unknown = [...formNames].filter((name) => !callable.has(name));
        if (unknown.length) throw new TypeError(`serviceDispatcher: forms.allow names what is not a service: ${unknown.join(", ")}`);
        if (!Number.isInteger(formMax) || formMax < 0) throw new TypeError(`serviceDispatcher: forms.maxBody must be a number of bytes, not ${String(forms.maxBody)}`);
    }
    // A request's context, marked as a direct call (see options.context above). Built per request,
    // inside the caller's try: an app's context that throws is the caller's to handle.
    const requestContext = (req, res) => {
        const made = typeof options.context === "function" ? options.context(req, res) : undefined;
        if (made === null || (typeof made !== "object" && typeof made !== "function")) return Object.freeze({ [CALL_KIND]: "direct" });
        if (made[CALL_KIND] === "direct" && Object.hasOwn(made, CALL_KIND)) return made;
        if (Object.isExtensible(made) && !Object.hasOwn(made, CALL_KIND)) {
            Object.defineProperty(made, CALL_KIND, { value: "direct" });
            return made;
        }
        return Object.create(made, { [CALL_KIND]: { value: "direct" } });
    };
    const maxBody = options.maxBody ?? 1_000_000;
    // The other numbers `live` takes are checked as retryMs is, below. They were taken as given:
    // `keepAlive: 0` wrote a keep-alive every millisecond to every stream, and `maxGroups: "5"`
    // compared as no ceiling at all. A timer's wait is at most MAX_DELAY; a ceiling may be Infinity
    // (none), and the per-caller ones 0 (off, as they always were).
    const whole = (key, fallback, { min = 0, timer = false, unbounded = false } = {}) => {
        const value = live?.[key] ?? fallback;
        if ((unbounded && value === Infinity) || (Number.isSafeInteger(value) && value >= min && (!timer || value <= MAX_DELAY))) return value;
        const range = timer ? `a whole number of milliseconds from ${min} to ${MAX_DELAY}` : `a whole number from ${min}${unbounded ? ", or Infinity" : ""}`;
        throw new TypeError(`serviceDispatcher: live.${key} is ${range}, not ${typeof value === "string" ? JSON.stringify(value) : String(value)}`);
    };
    const keepAlive = whole("keepAlive", 25000, { min: 1, timer: true });
    // The SSE `retry:` field (see retryMs above the function). A browser reads it as digits only and
    // ignores anything else, keeping its own default, which differs by browser: refused here instead.
    const retryMs = live?.retryMs === undefined ? 2000 : live.retryMs;
    // Not 0: a browser told to wait nothing reopens a refused or failed stream in a tight loop, the
    // same reason sseClient's backoff refuses a minMs of 0.
    if (!Number.isInteger(retryMs) || retryMs < 1 || retryMs > MAX_DELAY) {
        throw new TypeError(`serviceDispatcher: live.retryMs is a whole number of milliseconds from 1 to ${MAX_DELAY}, not ${typeof retryMs === "string" ? JSON.stringify(retryMs) : String(retryMs)}`);
    }
    const graceMs = whole("graceMs", 30000, { timer: true });
    const maxKeysPerClient = whole("maxKeysPerClient", 64, { min: 1, unbounded: true });
    const maxGroups = whole("maxGroups", 10000, { min: 1, unbounded: true });
    // Ceilings per CALLER, not per client id. Bounding a client id bounds nothing: ids are handed out
    // by /events, and nothing stopped one visitor collecting hundreds of them, holding 64 keys on each
    // and filling maxGroups — every new live query on the server then answered 503, while each novel
    // set of arguments ran its own query and every later invalidation re-ran the lot.
    //
    // `clientKey(req, owner)` says who a request is for this purpose: the owner when there is one,
    // the socket address otherwise. An app behind a proxy MUST supply it (every visitor shares the
    // proxy's address otherwise, and the ceilings would be site-wide).
    const clientKeyOf = (req, owner) =>
        typeof live?.clientKey === "function" ? String(live.clientKey(req, owner)) : (owner ?? `ip:${req.socket?.remoteAddress ?? "?"}`);
    const maxStreamsPerCaller = whole("maxStreamsPerCaller", 12, { unbounded: true });
    const maxGroupsPerCaller = whole("maxGroupsPerCaller", 256, { unbounded: true });
    const maxPostsPerMinute = whole("maxPostsPerMinute", 240, { unbounded: true });
    // How long an authorisation may be trusted before it is asked again. `authorize` runs at subscribe
    // and delivery never re-checked it, so someone removed from a conversation kept receiving its
    // patches for as long as the tab stayed open. 0 turns the periodic re-check off; invalidateAccess
    // still asks.
    const recheckMs = whole("recheckMs", 30000);
    const byCaller = new Map(); // clientKey -> Set<clientId>, for the ceilings above
    const buckets = new Map(); // clientKey -> { tokens, at }, the _live rate limit
    // How far behind a stream may fall before it is dropped. One megabyte is a lot of patches.
    const maxBufferBytes = whole("maxBufferBytes", 1_000_000, { min: 1, unbounded: true });
    // Streams dropped for falling too far behind. Reported by handler.stats(), because a number
    // that climbs is the difference between "a laptop slept" and "something is wrong".
    let droppedForLag = 0;
    // options.live.bus: { publish(targets), subscribe(handler) -> unsubscribe? }. Without it this process
    // only ever invalidates its own groups, which is correct for one instance and silently wrong for two
    // (a client connected elsewhere never hears the change). With it, every invalidation is published and
    // every instance applies it to whatever groups it happens to hold.
    const bus = live?.bus ?? null;
    const busStats = { published: 0, received: 0, unpublishable: 0, errors: 0 };
    let busUnsubscribe = null;

    // `challenge`: a 401's, from `refuse` (below), which has checked it.
    const send = (res, status, body, challenge) => {
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        // The body is JSON and is never to be sniffed as anything else — an endpoint that echoes a
        // caller's string is not a place to let a browser guess "this looks like HTML".
        res.setHeader("x-content-type-options", "nosniff");
        // RFC 9110 has a 405 name the methods the address takes (15.5.6): under the base, POST alone.
        if (status === 405) res.setHeader("allow", "POST");
        // And a 401 say how to authenticate (15.5.2).
        if (challenge !== undefined) res.setHeader("www-authenticate", challenge);
        res.end(JSON.stringify(body === undefined ? null : body));
    };
    // A refusal, as `refusal` (below) made it, for the call to `name`. A challenge that is not one is
    // the app's mistake, and fails the request before anything is written, as a form's redirect off
    // the site does: sent, it would be a 401 no client can read how to answer.
    const refuse = (res, name, { status, body, challenge }) => {
        if (challenge !== undefined && !(typeof challenge === "string" && CHALLENGE.test(challenge))) {
            throw new TypeError(
                `serviceDispatcher: "${name}" refused with 401 and the challenge ${JSON.stringify(challenge)}: `
                + "a challenge is an auth-scheme, then its parameters (RFC 9110, 11.6.1)",
            );
        }
        send(res, status, body, challenge);
    };

    // A refusal answered before the request has arrived whole (a 415 at its type, a 413 part-way through
    // its body) ends the connection with it: the rest of that body would otherwise be read as the next
    // request on a kept-alive connection, and a proxy in front may pool it for someone else's call (RFC
    // 9112, 9.6). The rest is read and dropped first (drainBody: answered and closed at once, the bytes
    // still coming would be reset, and the answer with them), then the answer says `connection: close`
    // and Node closes the socket once it is written.
    const refuseEarly = async (req, res, status, body) => {
        if (!req.complete) {
            await drainBody(req);
            res.setHeader("connection", "close");
        }
        send(res, status, body);
    };

    // What the caller is told when something fails.
    //
    // A service's message used to go to the browser as-is. Most are written for the person (a form
    // says which field is wrong), but a driver's is not: `duplicate key value violates unique
    // constraint "users_email_key"` names a table and a column, and a connection error names a
    // host. options.exposeError(error) decides, and the default is to say nothing — an app opts its
    // own messages in, rather than opting each leak out after finding it.
    // The rule and the words are errors.js's, which the core reads a failed preload with too.
    const exposeError = typeof options.exposeError === "function" ? options.exposeError : defaultExposeError;
    const readJson = async (req) => {
        const type = String(req.headers?.["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (type !== "application/json") throw Object.assign(new Error("content-type must be application/json"), { status: 415 });
        const chunks = [];
        let size = 0;
        for await (const chunk of req.iterator({ destroyOnReturn: false })) {   /* the rest stays readable: drainBody */
            size += chunk.length;
            if (size > maxBody) throw Object.assign(new Error(`body larger than ${maxBody} bytes`), { status: 413 });
            chunks.push(chunk);
        }
        const text = Buffer.concat(chunks).toString("utf8");
        return text ? JSON.parse(text) : undefined;
    };
    // A client that has stopped reading must not be allowed to fill this process's memory.
    //
    // res.write() returns false once the socket is backed up, and its return value was ignored — so
    // a laptop that went to sleep mid-stream, or a proxy that stalled, buffered every patch for
    // every group it watched, without limit, in Node's heap.
    //
    // Dropping is better than coalescing here: the stream is a cache, not a ledger. A dropped
    // client reconnects and re-announces, and every group answers with a fresh `full` — so it
    // recovers with the CURRENT value rather than replaying a queue of stale ones.
    const emit = (client, payload) => {
        if (!client.res) return;
        client.res.write(`event: patch\ndata: ${JSON.stringify(payload)}\n\n`);
        if ((client.res.writableLength ?? 0) <= maxBufferBytes) return;
        droppedForLag++;
        options.onError?.(
            new Error(`live client ${client.id} is ${client.res.writableLength} bytes behind; dropping the stream`),
            "live.backpressure", []);
        const res = client.res;
        client.res = null;
        clearInterval(client.ping);
        res.end();
        dropLater(client);
    };
    // May this client still have this group's data? `authorize` ran once, at subscribe, and its answer
    // was then trusted for the life of the stream — so losing access to a conversation did not stop
    // its patches arriving. The answer is re-asked at most once per `recheckMs` per (client, key),
    // against the request context captured when they subscribed: the session token in it is what the
    // app's rule reads, and a session that has been revoked no longer resolves to a viewer.
    // `force` (invalidateAccess) asks whatever recheckMs says: recheckMs paces the re-check before a
    // patch, and with it at 0 a forced one used to return early too, so a revocation did nothing.
    const stillAllowed = async (client, group, key, force = false) => {
        if (!live?.authorize) return true;
        if (!force) {
            if (!recheckMs) return true;
            const checkedAt = client.checked.get(key) ?? 0;
            if (Date.now() - checkedAt < recheckMs) return true;
        }
        let allowed = false;
        try {
            allowed = await live.authorize.call(client.ctx, group.name, group.args, { clientId: client.id, recheck: true });
        } catch (error) {
            options.onError?.(error, "live.authorize", group.args);
            allowed = false; // a rule that cannot answer is not a rule that said yes
        }
        if (allowed) {
            client.checked.set(key, Date.now());
            return true;
        }
        dropSubscription(client, key, group);
        emit(client, { key, error: "not allowed" });
        return false;
    };
    // One client leaves one group, from either side.
    const dropSubscription = (client, key, group = groups.get(key)) => {
        client.keys.delete(key);
        client.checked.delete(key);
        if (!group) return;
        group.clients.delete(client.id);
        if (group.clients.size === 0) groups.delete(key);
    };
    const broadcast = async (group, payload) => {
        // A copy: a re-check that denies a client removes it from this set while we are walking it.
        for (const clientId of [...group.clients]) {
            const client = clients.get(clientId);
            if (!client) continue;
            if (await stillAllowed(client, group, payload.key)) emit(client, payload);
        }
    };
    const rememberCaller = (client) => {
        let ids = byCaller.get(client.caller);
        if (!ids) byCaller.set(client.caller, (ids = new Set()));
        ids.add(client.id);
    };
    const forgetCaller = (client) => {
        const ids = byCaller.get(client.caller);
        if (!ids) return;
        ids.delete(client.id);
        if (ids.size === 0) byCaller.delete(client.caller);
    };
    const streamsFor = (caller) => {
        let open = 0;
        for (const id of byCaller.get(caller) ?? []) if (clients.get(id)?.res) open += 1;
        return open;
    };
    const groupsFor = (caller) => {
        const held = new Set();
        for (const id of byCaller.get(caller) ?? []) for (const key of clients.get(id)?.keys ?? []) held.add(key);
        return held;
    };
    // A token bucket per caller on /_live, so subscribe/unsubscribe churn cannot itself be the attack.
    const withinRate = (caller) => {
        const now = Date.now();
        const bucket = buckets.get(caller) ?? { tokens: maxPostsPerMinute, at: now };
        bucket.tokens = Math.min(maxPostsPerMinute, bucket.tokens + ((now - bucket.at) / 60000) * maxPostsPerMinute);
        bucket.at = now;
        if (buckets.size > 10000) for (const [key, b] of buckets) if (now - b.at > 60000) buckets.delete(key);
        buckets.set(caller, bucket);
        if (bucket.tokens < 1) return false;
        bucket.tokens -= 1;
        return true;
    };
    const clientFor = (id, caller = null) => {
        let client = clients.get(id);
        if (!client) {
            client = { id, res: null, keys: new Set(), timer: null, ping: null, owner: null, caller, ctx: undefined, checked: new Map() };
            clients.set(id, client);
            rememberCaller(client);
        }
        return client;
    };

    // Who owns this request, for binding a stream to a session.
    //
    // options.live.identify(context) -> a stable string, or null for a visitor with no identity.
    // Without it the id's entropy is the only protection — enough to stop guessing, but a leaked id
    // (a referrer, an access log) would still work. An app with sessions should supply it.
    const ownerOf = async (req, res) => {
        if (typeof live?.identify !== "function") return null;
        // The app's context is built inside a try too: one that throws leaves the caller a visitor
        // with no identity, instead of throwing out of the dispatcher into the host's 500.
        let ctx;
        try {
            ctx = requestContext(req, res);
        } catch (error) {
            options.onError?.(error, "live.context", []);
            return null;
        }
        try {
            const owner = await live.identify.call(ctx, { req });
            return owner === undefined || owner === null ? null : String(owner);
        } catch (error) {
            options.onError?.(error, "live.identify", []);
            return null;
        }
    };

    // A guest stream has no owner, so entropy alone protects it. Two signed-in sessions never match.
    const sameOwner = (held, asking) => held === asking;
    // Removes `client` from every group it belongs to, dropping a group once nobody is left watching it.
    const leaveGroups = (client) => {
        for (const key of client.keys) {
            const group = groups.get(key);
            if (!group) continue;
            group.clients.delete(client.id);
            if (group.clients.size === 0) groups.delete(key);
        }
        client.keys.clear();
    };
    const dropLater = (client) => {
        clearTimeout(client.timer);
        client.timer = setTimeout(() => {
            if (!client.res) {
                leaveGroups(client);
                clients.delete(client.id);
                forgetCaller(client);
            }
        }, graceMs);
        client.timer.unref?.(); // a grace period is not a reason to keep the process alive either
    };

    // An answer as a client receives it. What JSON cannot carry (a BigInt, a cycle) throws, as it would
    // on the way out, and is that query's failure.
    const onTheWire = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

    // Re-run one group's query, push what changed to every client watching it. Re-runs of the same group
    // never overlap: two invalidations in quick succession start two re-runs, and if the second's result
    // landed first the first's older result would then be diffed against it and sent as a revert, leaving
    // `last` stale. So a refresh that arrives while one is running just marks the group dirty; the running
    // one loops once more. A client joining an already-populated group is not a reason to re-run it — it is
    // answered from the cached `last` directly (see the subscribe handler below).
    const refreshOnce = async (key, group, full) => {
        const service = services[group.name];
        if (typeof service !== "function") return;
        let value;
        try {
            value = await service.call(LIVE_CALL, ...group.args);
        } catch (error) {
            if (options.onError) options.onError(error, group.name, group.args);
            // Whatever went wrong went wrong for everyone watching this query, including people who
            // have nothing to do with each other — so the detail stays in onError and the wire gets
            // the same sentence the caller of a failed service gets.
            await broadcast(group, { key, error: publicMessage(error, exposeError, "live query failed") });
            return;
        }
        try {
            // What the clients were sent, as they were sent it. A query is free to answer an object it
            // keeps and changes later: `last` held that object itself, so the next run compared it with
            // itself, found no change, and sent none, and a client joining was sent what it had become.
            const answer = onTheWire(value);
            if (full) {
                group.last = answer;
                await broadcast(group, { key, full: answer });
                return;
            }
            const changes = diff(group.last, answer);
            group.last = answer;
            if (changes.set.length || changes.del.length) await broadcast(group, { key, set: changes.set, del: changes.del });
        } catch (error) {
            // A result JSON cannot carry (a BigInt, a cycle) throws in the diff or on the way out,
            // and it used to escape as an unhandled rejection. It is this query's failure, told as
            // one; and it is not kept, so a client joining later is not sent it from the cache.
            group.last = undefined;
            if (options.onError) options.onError(error, group.name, group.args);
            await broadcast(group, { key, error: publicMessage(error, exposeError, "live query failed") });
        }
    };
    const refresh = (key, group, full = false) => {
        if (group.running) {
            group.dirty = true;
            group.full = group.full || full;
            return group.running;
        }
        group.dirty = false;
        group.full = full;
        group.running = (async () => {
            do {
                const wantFull = group.full;
                group.dirty = false;
                group.full = false;
                await refreshOnce(key, group, wantFull);
            } while (group.dirty);
        })().catch((error) => {
            // Nothing a re-run does may reject out of here: an invalidation, a subscribe and the bus
            // start re-runs they do not all await.
            options.onError?.(error, group.name, group.args);
        }).finally(() => {
            group.running = null;
        });
        return group.running;
    };

    // Two values compared as strings, as an args or a where target compares them; a value that cannot
    // be made a string matches nothing. A subscriber's arguments are anything JSON carries, and
    // String() of some throws ({"toString":0}, or an array nested too deep to join), as it may of a
    // target's value built from a caller's: the throw rejected the whole invalidation, and every
    // group after that one missed it, so one visitor stalled everyone's live updates.
    const sameString = (a, b) => {
        try { return String(a) === String(b); } catch { return false; }
    };
    // Does a group match a target ("name", { name, args } or { name, where })?
    //   { name }                     every group of that name
    //   { name, args: [7] }          groups whose first argument is 7 — positional, and serializable,
    //                                so it can cross a bus to another instance (see options.live.bus).
    //                                `undefined` in a slot matches anything.
    //   { name, where: { a: 1 } }    groups whose first argument is an OBJECT with those fields
    //   { name, where: (args) => … } anything, but local to this instance: a function cannot be published
    const targeted = (group, target) => {
        if (typeof target === "string") return group.name === target;
        if (!target || group.name !== target.name) return false;
        if (Array.isArray(target.args)) {
            return target.args.every((value, i) => value === undefined || sameString(group.args[i], value));
        }
        const { where } = target;
        if (where === undefined || where === null) return true;
        if (typeof where === "function") return Boolean(where(group.args));
        const first = group.args[0];
        return typeof first === "object" && first !== null && Object.keys(where).every((k) => sameString(first[k], where[k]));
    };
    // A target can be published to other instances only if it carries no function: a string, or an
    // object whose matching is data ({ name }, { name, args }, { name, where: {...} }).
    const publishable = (target) => typeof target === "string" || (target && typeof target.where !== "function");

    // `local` is set when the call came off the bus, so a remote invalidation is applied here without
    // being published again — otherwise two instances would bounce the same change back and forth.
    const invalidate = async (targets, { local = false } = {}) => {
        const list = Array.isArray(targets) ? targets : [targets];
        // Told first, before anything is awaited: what else holds data these targets name (a page
        // cache) hears of it before this instance takes another request.
        if (list.length && typeof live?.onInvalidate === "function") {
            const report = (error) => options.onError?.(error, "live.onInvalidate", list);
            try { Promise.resolve(live.onInvalidate(list, { remote: local })).catch(report); } catch (error) { report(error); }
        }
        // Published beside the local re-runs, not before them: a slow or hung pool held this
        // instance's own updates back for as long as the publish took.
        const running = [];
        if (!local && bus) {
            const wire = list.filter(publishable);
            if (wire.length !== list.length) busStats.unpublishable += list.length - wire.length;
            if (wire.length) {
                busStats.published += wire.length;
                const report = (error) => {
                    busStats.errors++;
                    options.onError?.(error, "live.bus.publish", wire);
                };
                try { running.push(Promise.resolve(bus.publish(wire)).catch(report)); } catch (error) { report(error); }
            }
        }
        // Every group is matched against every target, whichever `where` function throws: one that
        // threw for a subscriber's arguments used to skip every group after it. The first error is
        // thrown once the re-runs it did not stop are done, so the caller (or the bus's onError,
        // live.bus.apply) still hears it, as the state manager treats observers.
        let failed = false;
        let failure;
        const matches = (group, target) => {
            try {
                return targeted(group, target);
            } catch (error) {
                if (!failed) { failed = true; failure = error; }
                return false;
            }
        };
        for (const [key, group] of groups) if (list.some((t) => matches(group, t))) running.push(refresh(key, group));
        await Promise.all(running);
        if (failed) throw failure;
    };

    // After a service succeeds: what its `touches` entry names, and every page (ALL) when it is in
    // strict.flushAll, invalidated in one go. A function entry may be async and sees the result too.
    // Not awaited, and a failure to work out the targets never reaches the caller, whose change went
    // in: it goes to onError ("live.touches").
    const touch = (name, context, args, result) => {
        // Its own entry only, as checkStrict reads it: a service named toString, constructor or
        // valueOf with none ran Object.prototype's function as its touches.
        const touched = Object.hasOwn(live?.touches ?? {}, name) ? live.touches[name] : undefined;
        const flushes = flushAll.has(name);
        if (!touched && !flushes) return;
        Promise.resolve()
            .then(() => (typeof touched === "function" ? touched.call(context, ...args, result) : touched))
            .then((targets) => {
                const list = targets === undefined || targets === null ? [] : Array.isArray(targets) ? targets : [targets];
                return invalidate(flushes ? [...list, ALL] : list);
            })
            .catch((error) => options.onError?.(error, "live.touches", args));
    };

    // The status a refusal answers: 400 when the error names none, the one it names when that is an
    // HTTP error status (a 4xx or 5xx Node knows), and 500 otherwise. A thrown `status` went out as
    // given: 999 was sent, and a string made the host throw on writing the head.
    const errorStatus = (status) => {
        if (status === undefined || status === null) return 400;
        return Number.isInteger(status) && status >= 400 && status <= 599 && Object.hasOwn(STATUS_CODES, status) ? status : 500;
    };
    // What the caller is told when a call fails: { status, body, shown }. The message goes out only if
    // options.exposeError says it was written to be read by the caller (publicMessage, juris/errors.js); everything
    // reaches onError either way. A service may attach `fields` ({ fieldName: message }) so a form can
    // put each message beside its input, and they travel as given. A refusal about one field may name
    // it alone (`field`, as ServiceError keeps it): it goes out as it is, since a caller may branch on
    // it, and in `fields` with the message the caller may read, so a form that reads the map finds it.
    // It used to be dropped, and the message landed at the top of the form. `code`, a name a program
    // can match, goes out only beside a message that does. A 401 keeps its error's `challenge`, which
    // a JSON caller is sent as WWW-Authenticate (`refuse`), and no other transport reads.
    const refusal = (error, name, args) => {
        const shown = mayExpose(error, exposeError);
        if (!shown) options.onError?.(error, name, args);
        const body = { error: publicMessage(error, exposeError) };
        const fields = error?.fields;
        const field = typeof error?.field === "string" && error.field !== "" ? error.field : null;
        if (field) {
            const given = fields && typeof fields === "object" ? fields : {};
            body.fields = { ...given, [field]: (Object.hasOwn(given, field) ? given[field] : null) ?? body.error };
            body.field = field;
        } else if (fields) {
            body.fields = fields;
        }
        if (shown && typeof error?.code === "string") body.code = error.code;
        const status = errorStatus(error?.status);
        const challenge = status === 401 ? error.challenge : undefined;
        if (challenge === undefined || challenge === null) return { status, body, shown };
        return { status, body, shown, challenge };
    };

    // One call, whatever carried it: `authorize` for a declared query, then the service with `context`
    // as `this`, then the error filter. { ok: true, result } or { ok: false, status, body, shown }. The
    // caller runs the touches once it has answered (touch, above).
    const run = async (name, args, context, info) => {
        try {
            // A live query is also a plain service, and a direct POST to it used to skip `authorize`
            // entirely — so a viewer-keyed query answered for whatever handle the body named, to a
            // caller with no session at all. The same rule that guards the subscribe guards the call.
            // DECLARED live queries only (live.queries), which are the ones with rules. Without
            // strictQueries, liveQueries also holds every name an array-valued `touches` entry lists,
            // which may be an ordinary read that no rule covers (a profile that a follow changes, say),
            // and running authorize for a name with no rule refused every direct call to it.
            if (declaredQueries.has(name) && live?.authorize) {
                let allowed = false;
                try { allowed = await live.authorize.call(context, name, args, { ...info, direct: true }); }
                catch (error) { options.onError?.(error, "live.authorize", args); }
                if (!allowed) return { ok: false, status: 403, body: { error: "not allowed" }, shown: true };
            }
            return { ok: true, result: await services[name].call(context, ...args) };
        } catch (error) {
            return { ok: false, ...refusal(error, name, args) };
        }
    };
    // run, then the touches of a call that succeeded, for a transport with nothing to send first.
    const invokeWith = async (name, args, context, info) => {
        if (!isService(name)) return { ok: false, status: 404, body: unknownService(name), shown: true };
        const list = Array.isArray(args) ? args : [];
        const outcome = await run(name, list, context, info);
        if (outcome.ok) touch(name, context, list, outcome.result);
        return outcome;
    };

    // options.forms: the no-JavaScript path (see forms above the function).
    const contentType = (req) => String(req.headers?.["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    // From one of this site's own pages: the Origin, or the Referer when a browser sends no Origin,
    // names the host the request was sent to. A value no URL can be made of ("null") is not a page.
    const sameSite = (req) => {
        const from = String(req.headers.origin ?? req.headers.referer ?? "");
        try { return Boolean(from) && new URL(from).host === String(req.headers.host ?? ""); } catch { return false; }
    };
    const answerForm = async (req, res, name) => {
        if (!sameSite(req)) { res.writeHead(403); res.end(); return; }
        let raw;
        try {
            raw = await readBody(req, { limit: formMax });
        } catch {
            // The upload ended early (a tab closed mid-send): nothing was run. It used to reject out
            // of the dispatcher, into the host's 500, for a request nobody is waiting on.
            if (!res.headersSent && !res.destroyed) { res.writeHead(400); res.end(); }
            return;
        }
        if (raw === null) { await drainBody(req); res.writeHead(413, { connection: "close" }); res.end(); return; }   /* as refuseEarly */
        const fields = Object.fromEntries(new URLSearchParams(raw.toString("utf8")));
        let outcome;
        try {
            outcome = await invokeWith(name, [fields], requestContext(req, res), { req });
        } catch (error) {
            outcome = { ok: false, ...refusal(error, name, [fields]) };   // the app's context threw
        }
        const told = outcome.ok
            ? { ok: true, message: null, status: 200, result: outcome.result }
            : { ok: false, message: outcome.shown ? outcome.body.error : null, status: outcome.status, ...(outcome.body.fields ? { fields: outcome.body.fields } : {}) };
        const location = forms.redirect(name, { ...told, req });
        // Somewhere on this site: a path, never another site's URL, nor one a browser reads as one.
        if (!onThisSite(location)) {
            throw new TypeError(`serviceDispatcher: forms.redirect answered ${JSON.stringify(location)} for "${name}": it must be a path on this site`);
        }
        res.writeHead(303, { location });
        res.end();
    };

    const handler = async (req, res) => {
        const url = new URL(req.url, "http://localhost");
        if (!url.pathname.startsWith(prefix)) return false;
        // A path that is not valid percent-encoding names no service. Decoding it threw URIError out
        // of the dispatcher, and the host answered 500 to what is a bad request.
        let name;
        try { name = decodeURIComponent(url.pathname.slice(prefix.length)); }
        catch { return send(res, 400, { error: "bad service name" }), true; }

        // ---- live: the event stream
        if (live && name === "events") {
            // A GET opens it. A HEAD is told what a GET would get, and nothing is opened or minted for
            // it; any other method is refused before anything else reads the request.
            if (refuseMethod(req, res)) return true;
            if (req.method === "HEAD") {
                res.writeHead(200, STREAM_HEADERS);
                res.end();
                return true;
            }
            // The client id is minted HERE, not in the browser.
            //
            // It used to be `Date.now() + Math.random()` chosen client-side and passed in the query
            // string, and `clientFor(id)` created a client for any id it had not seen. Together those
            // meant: guess or learn somebody's id, open /events?client=<theirs>, and `client.res = res`
            // handed you their stream — every group they had been authorised into then pushed to you.
            // authorize runs once at subscribe and delivery never re-checks, so nothing downstream
            // would have caught it.
            //
            // Two changes close it. The id is 122 bits from the platform CSPRNG, so it cannot be
            // guessed; and it is bound to whatever `live.identify` says owns the request (for an app
            // with sessions, the session's id), so a leaked id is useless from anyone else's session.
            const given = url.searchParams.get("client");
            // Watched from before `identify` runs: a request that goes away while it does is gone
            // before the listener below exists, so its client stayed "connected" for good, its
            // keep-alive ticking, and held a place under maxStreamsPerCaller for ever.
            let gone = false;
            const onGone = () => { gone = true; };
            req.once("close", onGone);
            res.once("close", onGone);
            // A socket that dies mid-write raises 'error' on the response, and an unhandled one on an
            // http.ServerResponse is an uncaught exception. The stream is already being torn down at
            // that point, so there is nothing to do with it but let 'close' do the cleanup.
            res.on("error", () => { });
            const owner = await ownerOf(req, res);
            req.off("close", onGone);
            res.off("close", onGone);
            // Nobody is left to answer, and nothing is made for them.
            if (gone || req.destroyed || res.destroyed || res.writableEnded || req.socket?.destroyed) return true;
            const caller = clientKeyOf(req, owner);
            let client;
            if (given) {
                client = clients.get(given);
                // An unknown id is refused rather than created. Creating on demand was the hijack.
                if (!client || !sameOwner(client.owner, owner)) {
                    return send(res, 403, STALE_CLIENT), true;
                }
            } else {
                // A stream costs a socket and a keep-alive timer for as long as it is held open, and
                // nothing bounded how many one caller could hold.
                if (maxStreamsPerCaller && streamsFor(caller) >= maxStreamsPerCaller) {
                    return send(res, 429, { error: `at most ${maxStreamsPerCaller} live streams at a time` }), true;
                }
                client = clientFor(globalThis.crypto.randomUUID(), caller);
                client.owner = owner;
            }
            clearTimeout(client.timer);
            res.writeHead(200, STREAM_HEADERS);
            res.write(`retry: ${retryMs}\n\n`);
            // The client learns its id from the stream, so it never travels anywhere the browser
            // chose. Announced every time, because a reconnect mints a new one.
            res.write(`event: hello\ndata: ${JSON.stringify({ client: client.id })}\n\n`);
            // One socket per client id. A reconnect with the id replaces the stream it had, which
            // was left open (no keep-alive, no timeout, and uncounted by the ceiling) for as long as
            // the other end kept it: ended here, its keep-alive with it.
            const replaced = client.res;
            client.res = res;
            clearInterval(client.ping);
            if (replaced && replaced !== res) replaced.end();
            // unref: a keep-alive tick is not a reason for the process to stay alive. The HTTP
            // server is what holds it open; this timer only has work while that is true.
            client.ping = setInterval(() => client.res?.write(": keep-alive\n\n"), keepAlive);
            client.ping.unref?.();
            const ping = client.ping;
            req.on("close", () => {
                // A stream that was replaced (a reconnect with its id) or dropped for lag has nothing
                // left to undo: the client is the newer stream's, or already on its way out.
                if (client.res !== res) return;
                client.res = null;
                // Only this connection's keep-alive: a reconnect that reused the id installed a new
                // timer, and clearing it here left that stream with no keep-alive at all.
                if (client.ping === ping) clearInterval(client.ping);
                dropLater(client);
            });
            return true;
        }
        // ---- live: (un)subscribe
        if (live && name === "_live") {
            if (req.method !== "POST") return send(res, 405, { error: "POST" }), true;
            let body;
            try {
                body = await readJson(req);
            } catch (error) {
                await refuseEarly(req, res, error.status ?? 400, { error: `bad request: ${error.message}` });
                return true;
            }
            if (typeof body?.client !== "string" || !body.client) return send(res, 400, { error: "client id required" }), true;
            // Same ownership rule as the stream: an id the server did not mint, or one that belongs
            // to another session, cannot be used to attach subscriptions.
            const owner = await ownerOf(req, res);
            const client = clients.get(body.client);
            if (!client || !sameOwner(client.owner, owner)) {
                return send(res, 403, STALE_CLIENT), true;
            }
            const caller = clientKeyOf(req, owner);
            if (maxPostsPerMinute && !withinRate(caller)) {
                return send(res, 429, { error: "too many subscription changes" }), true;
            }
            // No stream yet (or a stray subscribe after the stream dropped): the client lives only as long as the grace
            // period unless a stream arrives. Without this, a subscribe alone pinned the client and its query for good.
            if (!client.res && !client.timer) dropLater(client);
            if (body.subscribe) {
                const { key, name: queryName, args } = body.subscribe;
                if (!isService(queryName)) return send(res, 404, unknownService(queryName)), true;
                if (!liveQueries.has(queryName)) return send(res, 403, { error: `"${queryName}" is not a live query`, code: LIVE_CODES.NOT_A_QUERY }), true;
                const queryArgs = Array.isArray(args) ? args : [];
                // options.live.authorize(name, args, info) -> boolean, called as the request context (like a
                // service) so it can read the session. Without it, being on the live list is the only check —
                // fine for public data, wrong the moment a query takes an id that identifies someone's data.
                if (live.authorize) {
                    // Kept on the client: this context answers every re-check of the subscription
                    // (`stillAllowed`, from delivery and from invalidateAccess) for as long as it lives,
                    // long after this request was answered. What the app's context may hold, so that it
                    // stays true that long, is under options.context above: what identifies the caller,
                    // never a memoised viewer, and never the response.
                    try {
                        client.ctx = requestContext(req, res);
                    } catch (error) {
                        // No context, no decision: refused, never waved through and never a 500.
                        options.onError?.(error, "live.context", queryArgs);
                        return send(res, 403, { error: `not allowed to subscribe to "${queryName}"` }), true;
                    }
                    let allowed = false;
                    try {
                        allowed = await live.authorize.call(client.ctx, queryName, queryArgs, { clientId: body.client, req });
                    } catch (error) {
                        options.onError?.(error, "live.authorize", queryArgs);
                        return send(res, 500, { error: "authorisation failed" }), true;
                    }
                    // The client may have gone while `authorize` ran: its stream closed, and its grace
                    // period ended before another came. Added to a group now, its id would stay there
                    // with nobody to take it out, and the group would never empty.
                    if (clients.get(body.client) !== client) return send(res, 403, STALE_CLIENT), true;
                    if (!allowed) return send(res, 403, { error: `not allowed to subscribe to "${queryName}"` }), true;
                }
                // Arguments JSON cannot write again (an array nested too deep for the stack) have no
                // key to match: refused the same way, where the throw went out into the host's 500.
                let ownKey = false;
                try { ownKey = key === liveKey(queryName, queryArgs); } catch { /* no key: refused below */ }
                if (!ownKey) return send(res, 400, { error: "key must be the query's own name:JSON(args)" }), true;
                if (!client.keys.has(key) && client.keys.size >= maxKeysPerClient) return send(res, 429, { error: `at most ${maxKeysPerClient} live subscriptions per client` }), true;
                // The ceiling that actually binds: every id this caller holds, counted together.
                if (!client.keys.has(key) && maxGroupsPerCaller) {
                    const held = groupsFor(client.caller);
                    if (!held.has(key) && held.size >= maxGroupsPerCaller) {
                        return send(res, 429, { error: `at most ${maxGroupsPerCaller} live queries at a time` }), true;
                    }
                }
                let group = groups.get(key);
                if (!group) {
                    if (groups.size >= maxGroups) return send(res, 503, { error: "too many live queries on this server" }), true;
                    group = { name: queryName, args: queryArgs, last: undefined, running: null, dirty: false, full: false, clients: new Set() };
                    groups.set(key, group);
                }
                client.keys.add(key);
                client.checked.set(key, Date.now()); // just authorised; the first re-check is recheckMs away
                group.clients.add(client.id);
                send(res, 200, { ok: true });
                if (group.last !== undefined) emit(client, { key, full: group.last }); // already active: no new DB call
                else await refresh(key, group, true);
                return true;
            }
            if (body.unsubscribe) {
                dropSubscription(client, body.unsubscribe);
            }
            return send(res, 200, { ok: true }), true;
        }

        // ---- ordinary service call
        if (req.method !== "POST") return send(res, 405, { error: "services take POST" }), true;
        if (!isService(name)) {
            return send(res, 404, unknownService(name)), true;
        }
        // ---- a plain form, from a page with JavaScript off (options.forms)
        if (forms && formNames.has(name) && contentType(req) === "application/x-www-form-urlencoded") {
            await answerForm(req, res, name);
            return true;
        }
        let args;
        try {
            args = (await readJson(req)) ?? [];
            if (!Array.isArray(args)) throw new Error("body must be a JSON array of arguments");
        } catch (error) {
            await refuseEarly(req, res, error.status ?? 400, { error: `bad request: ${error.message}` });
            return true;
        }
        let context;
        try {
            context = requestContext(req, res);
        } catch (error) {
            refuse(res, name, refusal(error, name, args));
            return true;
        }
        const outcome = await run(name, args, context, { req });
        if (!outcome.ok) {
            refuse(res, name, outcome);
            return true;
        }
        // Sent before the touches run, as always; a result JSON cannot carry is a refusal like any
        // other failure. But the service succeeded, and what it changed is changed whatever became
        // of the answer: its touches run either way, or screens and caches stayed stale.
        try {
            send(res, 200, outcome.result);
        } catch (error) {
            refuse(res, name, refusal(error, name, args));
        }
        touch(name, context, args, outcome.result);
        return true;
    };

    // Apply what other instances publish. `local: true` stops it going back out.
    if (bus?.subscribe) {
        // Applied, not awaited: a bus waits for its handler before it reads on, and waiting for the
        // re-runs let one slow query stall every instance's changes behind it.
        busUnsubscribe = bus.subscribe((targets) => {
            const list = Array.isArray(targets) ? targets : [targets];
            busStats.received += list.length;
            invalidate(list, { local: true }).catch((error) => {
                busStats.errors++;
                options.onError?.(error, "live.bus.apply", list);
            });
        });
    }

    handler.invalidate = invalidate;
    // One call through the whole pipeline, for a transport that is not a JSON POST (see invoke above
    // the function): { ok: true, result } or { ok: false, status, error, fields?, field?, code? }, the
    // body a JSON caller would read.
    handler.invoke = async (name, args, context) => {
        const outcome = await invokeWith(name, args, context, {});
        return outcome.ok ? { ok: true, result: outcome.result } : { ok: false, status: outcome.status, ...outcome.body };
    };
    handler.names = Object.freeze([...callable]);
    // Access changed for someone: re-ask `authorize` for their subscriptions now, rather than before
    // their next patch once recheckMs has passed. `who` is an owner (what live.identify returned) or
    // a predicate over it. Call it when a membership is revoked, an account is suspended, or a
    // session is signed out.
    handler.invalidateAccess = async (who) => {
        const matches = typeof who === "function" ? who : (owner) => owner === who;
        let dropped = 0;
        for (const client of [...clients.values()]) {
            if (!matches(client.owner)) continue;
            client.checked.clear();
            // Asked now rather than at the next patch: a query whose value has not changed sends
            // nothing, and a revoked subscription should not wait for one that has.
            for (const key of [...client.keys]) {
                const group = groups.get(key);
                if (group && !(await stillAllowed(client, group, key, true))) dropped += 1;
            }
        }
        return dropped;
    };
    // subscriptions: total (client, key) pairs, same number the old per-client design reported.
    // groups: distinct (name, args) actually being queried — the number that matters for DB load.
    handler.stats = () => ({
        clients: clients.size,
        groups: groups.size,
        subscriptions: [...groups.values()].reduce((n, g) => n + g.clients.size, 0),
        connected: [...clients.values()].filter((c) => c.res).length,
        droppedForLag,
        bus: bus ? { ...busStats } : null,
    });
    handler.close = () => {
        if (typeof busUnsubscribe === "function") busUnsubscribe();
        busUnsubscribe = null;
        for (const client of clients.values()) {
            clearInterval(client.ping);
            clearTimeout(client.timer);
            client.res?.end();
        }
        clients.clear();
        groups.clear();
        byCaller.clear();
        buckets.clear();
    };
    return handler;
}

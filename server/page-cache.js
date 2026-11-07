// The rendered-page cache, and the policy that decides what goes in it and when it leaves.
//
// The renderer reports what a render depended on (juris.renderRequest({ trace: true })). This module
// turns that report into a decision:
//
//   static     no reactive function ran, nothing was called       → cache, and never expire
//   dependent  read only preloaded data (services it can name)     → cache; drop when one of those
//                                                                    services is invalidated, or
//                                                                    regenerate after the TTL
//   volatile   flagged by a plugin (a clock read, a random draw)   → never cache
//   incomplete drew a component nobody registered (trace.unknown)  → never cache
//   failed     a preloaded call failed (trace.failed)              → never cache, and leave the
//                                                                    page kept before it as it was
//   personal   rendered for a signed-in viewer                     → never cache
//
// Invalidation is precise when the change names what it touched (a `touches` target: only pages
// that used that service are dropped) and total when it does not (a `$pages` target: everything).
//
// Two different kinds of "old", treated differently (Incremental Static Regeneration):
//   - a KNOWN change (invalidate): the page is wrong, drop it, the next visitor waits ~2ms;
//   - the TTL passing: the page is probably still right, so keep serving it and re-render it in the
//     background — `get` returns it marked `stale`, exactly one caller regenerates, the next visitor
//     gets the fresh one. Past `staleMs` the page is too old to trust and it is a miss.
//
// The race this has to get right: a render starts, reads "old", a change is announced and drops
// the entry (or finds none), the render finishes and stores "old" — now wrong until the TTL, even
// though the change was explicitly announced. So every service has a version, `snapshot()` records
// them before a render, and `put` refuses a page whose services moved on while it rendered.
//
// Nothing here knows about HTTP, the Juris core or a database, which is what makes it testable in
// isolation. What it is told (who the viewer was, the status) is the server's to say.

export const EVERYTHING = "$pages";

// The prefix of `decide`'s reason for a render whose preloaded call failed.
const FAILED = "failed:";

// The cache key is the URL, so everything a render reads from request state must be derived from
// the URL — or be declared here. `static` is decided from reactive functions and calls; a plain
// getState (or api.peek) in a component's setup is not a reactive function, so a page can read state
// during setup and still count as static. That is safe while request state is: the route (in the
// key), the viewer (makes the page personal), and constant defaults. The day request state carries
// something the URL does not — a locale from Accept-Language, an A/B flag — its root goes in
// `unkeyedRoots`, and a page that read it is refused rather than cached under a key that does not
// distinguish it. Both reads, a getState's and a peek's, are in the trace's roots.
export function decide(trace, { viewer = null, unkeyedRoots = [], status = 200 } = {}) {
    if (viewer) return { cache: false, reason: "personal" };
    // A page that was not found is not worth keeping, and keeping it is actively harmful: every
    // distinct bad URL is a distinct key, so a scanner walking /wp-admin, /.env, /admin.php and a
    // thousand friends evicts every real page from a bounded cache. Rendering them costs CPU;
    // letting them evict the site costs everyone.
    if (status === 404) return { cache: false, reason: "not-found" };
    if (!trace) return { cache: false, reason: "untraced" };
    // A render whose preloaded call failed (renderRequest's `failed`) shows that request's failure,
    // not the page: a slot drawn with it, and the call's `$error` in its state. Kept, it was handed
    // to every guest until it expired, and every address whose own call throws (a byte the database
    // refuses in a slug, a number too big for its column) was an entry of its own, so it reopened
    // the flood above through a 200. (A trace made before the field existed has no `failed`, and is
    // decided as it was.)
    if (trace.failed?.length) return { cache: false, reason: `${FAILED}${trace.failed.join(",")}` };
    // A render that drew an element where a component was named and none is registered is a page
    // missing a part: keeping it would hand the hole to every guest until it expired. (A trace
    // made before the field existed has no `unknown`, and is decided as it was.)
    if (trace.unknown?.length) return { cache: false, reason: `unknown:${trace.unknown.join(",")}` };
    if (trace.flags.length) return { cache: false, reason: `volatile:${trace.flags.join(",")}` };
    const unkeyed = trace.roots.filter((root) => unkeyedRoots.includes(root));
    if (unkeyed.length) return { cache: false, reason: `request-state:${unkeyed.join(",")}` };
    if (trace.static) return { cache: true, reason: "static", forever: true, services: [] };
    return { cache: true, reason: "dependent", forever: false, services: trace.services };
}

export function createPageCache({
    unkeyedRoots = [],           // state roots that vary per request but are NOT in the URL
    ttlMs = 60_000,
    staleMs = 10 * 60_000,
    maxEntries = 1000,
    // How many of those may be pages whose key carries a query (see `pageCacheKey`). The key keeps a
    // parameter pages read with whatever value a visitor sends, so `?q=1`, `?q=2`, … are an entry
    // each: without a share of their own, a guest sending values could push every page out. Once
    // they hold their share, a new one takes the room of the least recently used of them, and the
    // pages without a query stay. A quarter unless told; 1 or more.
    maxQueryEntries = Math.max(1, Math.floor(maxEntries / 4)),
    invalidatable = null,        // Set of service names some `touches` can name; null = don't check
    onWarn = null,
    now = () => Date.now(),
} = {}) {
    const entries = new Map();    // key -> { entry, services: Set, forever, at, regenerating }; insertion order = recency
    const versions = new Map();   // service name -> how many times it has been invalidated
    let epoch = 0;                // bumped by an unnamed change: everything dependent may have moved
    const warned = new Set();
    const stats = { hits: 0, stale: 0, misses: 0, stores: 0, skipped: 0, raced: 0, invalidations: 0, dropped: 0, evicted: 0, regenerated: 0, released: 0 };

    const version = (name) => versions.get(name) ?? 0;
    const touch = (key, hit) => { entries.delete(key); entries.set(key, hit); };   // most recent = last
    const queried = (key) => key.includes("?");                  // a path never carries a raw "?"
    const queryCount = () => { let n = 0; for (const key of entries.keys()) if (queried(key)) n++; return n; };
    // The least recently used entry `which` accepts goes.
    const evict = (which) => {
        for (const key of entries.keys()) if (which(key)) { entries.delete(key); stats.evicted++; return; }
    };

    return {
        // Take before a render starts. `put` compares against it: a page whose data was announced
        // changed while it rendered is refused, because it is already wrong.
        snapshot() {
            return { epoch, versions: new Map(versions) };
        },

        // Store `entry` under `key` if the decision allows it AND nothing it depends on moved since
        // `snapshot`. Returns the decision. A refused put also removes whatever was there: a page that
        // just turned volatile or personal must not keep being served from an older copy. Except a
        // failed render, which leaves the page kept before it as it was (below).
        put(key, entry, trace, context, snapshot = null) {
            const decision = decide(trace, { unkeyedRoots, ...context });
            const previous = entries.get(key);
            if (!decision.cache) {
                stats.skipped++;
                // A render that failed says nothing about the page kept before it, which no change
                // has been announced for: that copy stays, and a replacement handed out for it is
                // handed back, so the next visitor tries again, as `release` does for one that threw.
                if (decision.reason.startsWith(FAILED)) {
                    if (previous?.regenerating) { previous.regenerating = false; stats.released++; }
                    return decision;
                }
                if (previous) { entries.delete(key); stats.dropped++; }
                return decision;
            }
            // Every page, a static one too: it depends on no service, but a `$pages` invalidation or a
            // clear() during its render said every page then being made is wrong, and a static page
            // let in past it would be kept until the next one.
            if (snapshot) {
                const moved = snapshot.epoch !== epoch || decision.services.some((s) => (snapshot.versions.get(s) ?? 0) !== version(s));
                if (moved) {
                    // Rendered from data that has since been announced changed. Do not store it, and do
                    // not keep serving the older copy either — the next visitor renders fresh.
                    stats.raced++;
                    if (previous) { entries.delete(key); stats.dropped++; }
                    return { ...decision, cache: false, reason: "raced" };
                }
            }
            if (invalidatable && !decision.forever) {
                for (const s of decision.services) {
                    if (!invalidatable.has(s) && !warned.has(s)) {
                        warned.add(s);
                        onWarn?.(`page cache: pages depend on "${s}" but no mutation's touches names it — they will only ever expire by TTL`);
                    }
                }
            }
            if (previous?.regenerating) stats.regenerated++;
            if (!previous) {
                if (queried(key) && queryCount() >= maxQueryEntries) evict(queried);
                if (entries.size >= maxEntries) evict(() => true);
            }
            entries.delete(key);
            entries.set(key, { entry, services: new Set(decision.services), forever: decision.forever, at: now(), regenerating: false });
            stats.stores++;
            return decision;
        },

        // { entry, stale } or null. `stale` means: serve this, and regenerate it now. The flag is
        // handed out once per staleness, so many concurrent visitors trigger one regeneration.
        get(key) {
            const hit = entries.get(key);
            if (!hit) { stats.misses++; return null; }
            const age = now() - hit.at;
            if (hit.forever || age < ttlMs) { stats.hits++; touch(key, hit); return { entry: hit.entry, stale: false }; }
            if (age >= staleMs) { entries.delete(key); stats.misses++; return null; }
            const first = !hit.regenerating;
            hit.regenerating = true;
            stats.stale++;
            touch(key, hit);
            return { entry: hit.entry, stale: first };
        },

        // A regeneration that failed: hand the flag back so the next visitor tries again, rather
        // than everyone getting the stale page until it ages out.
        release(key) {
            const hit = entries.get(key);
            if (hit?.regenerating) { hit.regenerating = false; stats.released++; }
        },

        // `targets` as the change bus carries them: strings or { name, ... }. A $pages target, or
        // anything unrecognisable, clears everything — the conservative reading of an unknown change.
        // Either way the versions move, so a render in flight cannot store what it read before this.
        invalidate(targets) {
            const list = Array.isArray(targets) ? targets : [targets];
            const names = new Set();
            let everything = false;
            for (const target of list) {
                const name = typeof target === "string" ? target : target?.name;
                if (!name || name === EVERYTHING) everything = true;
                else names.add(name);
            }
            stats.invalidations++;
            for (const name of names) versions.set(name, version(name) + 1);
            if (everything) { epoch++; stats.dropped += entries.size; entries.clear(); return; }
            for (const [key, hit] of entries) {
                if (hit.forever) continue;                       // depends on nothing; no change can stale it
                for (const name of names) if (hit.services.has(name)) { entries.delete(key); stats.dropped++; break; }
            }
        },

        // Drop entries past staleMs that nobody has asked for since — get() only removes the key it
        // is asked about, so a key requested once would otherwise sit in memory forever.
        purge() {
            const cutoff = now() - staleMs;
            let removed = 0;
            for (const [key, hit] of entries) if (!hit.forever && hit.at < cutoff) { entries.delete(key); removed++; }
            stats.evicted += removed;
            return removed;
        },

        clear() { epoch++; stats.dropped += entries.size; entries.clear(); },
        stats: () => ({ ...stats, entries: entries.size, static: [...entries.values()].filter((h) => h.forever).length, maxEntries,
            queryEntries: queryCount(), maxQueryEntries }),
        has: (key) => entries.has(key),
    };
}

// One spelling of a request path: no doubled, leading-double or trailing slashes, and no dot segments.
// A server redirects anything else to this before its guards, its cache key and its render read the
// path, so that all three read the same one. Each spelling they could read differently is a way past
// a guard or into another page's cache entry: a doubled slash ("/admin//") that a guard's exact match
// misses while the router trims it; a leading "//" that a URL parser takes for a host, so the key is
// "/"; and a dot segment (`%2e%2e`) that the parsed path resolves while the router decodes it into a
// parameter "..", so the guard and the key see one page and the render draws another. Parsing here,
// as a URL, resolves `.` and `..` in any spelling, reads `\` as `/`, and encodes what a path may not
// carry raw (`"`, `<`, `>`). The scheme and host are prepended, not passed as a base, so a leading
// `//` stays a path.
const slashes = (path) => "/" + path.split("/").filter(Boolean).join("/");
export const canonicalPath = (rawUrl) => {
    const [path, query] = String(rawUrl ?? "/").split(/\?(.*)/s);
    let canonical = slashes(path);
    try { canonical = slashes(new URL(`http://canonical${canonical}`).pathname); } catch { /* unparseable: slashes only */ }
    return { path, canonical, query, redirect: path === canonical ? null : canonical + (query !== undefined ? `?${query}` : "") };
};

// The cache key for a page: its path and the query parameters pages actually read, in a fixed order.
// Otherwise every "?x=N" is a separate entry of the same page, and junk query strings evict real pages.
export const pageCacheKey = (url, known) => {
    const kept = [...url.searchParams].filter(([k]) => known.has(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return url.pathname + (kept.length ? `?${new URLSearchParams(kept)}` : "");
};

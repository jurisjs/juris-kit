// The HTTP pieces every server on Juris needs around its pages and services: cookies, the client's
// address, request bodies, the methods an address takes, and responses sent from memory or from
// disk, conditional requests read as RFC 9110 reads them. Node only; it imports nothing but Node's
// own modules and reads no environment: what a deployment decides (is there a proxy in front, is
// the site on https) is passed in by the app.
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream";

// ---- cookies ----------------------------------------------------------------------------------

// Every cookie in a Cookie header that can be read, by name, in an object with no prototype (a
// cookie named `__proto__` is just a name). The header carries every cookie any site on the domain
// set, not only this server's, so it is read one cookie at a time: one that cannot be decoded, or a
// part with no `=` or no name, is skipped. Decoding the header in one pass would throw on the first
// malformed %-escape, and every request from that browser would fail until the cookie was cleared.
// A repeated name keeps its last readable value.
export function parseCookies(header) {
    const cookies = Object.create(null);
    for (const part of String(header ?? "").split(";")) {
        const i = part.indexOf("=");
        const name = part.slice(0, i).trim();
        if (i < 0 || !name) continue;
        try { cookies[name] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* unreadable: skipped */ }
    }
    return cookies;
}

// A cookie name is an RFC 6265 token: anything else is refused, since a browser would read it
// differently from the server that wrote it.
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const SAME_SITE = { strict: "Strict", lax: "Lax", none: "None" };

// One Set-Cookie value. The value is %-encoded, so it can never end the value and add an attribute,
// and parseCookies reads it back. The attributes are written in a fixed order (Path, HttpOnly,
// SameSite, Expires, Max-Age, Secure), and the defaults are the safe ones: the whole site, no
// script, not sent on another site's requests, https only. An app that wants less says so (a
// development server on plain http passes `secure: false`). Anything a browser would misread or
// silently drop (a name that is not a token, a path with `;` or a control character, SameSite=None
// without Secure, an invalid date, a Max-Age that is not an integer) throws a TypeError instead of
// being written.
export function serializeCookie(name, value, { path = "/", httpOnly = true, sameSite = "Lax", secure = true, expires, maxAge } = {}) {
    if (typeof name !== "string" || !TOKEN.test(name)) throw new TypeError(`serializeCookie: ${JSON.stringify(name)} is not a cookie name`);
    if (typeof path !== "string" || /[;\x00-\x1f\x7f]/.test(path)) throw new TypeError(`serializeCookie: ${JSON.stringify(path)} is not a cookie path`);
    const site = SAME_SITE[String(sameSite).toLowerCase()];
    if (!site) throw new TypeError(`serializeCookie: SameSite must be Strict, Lax or None, not ${JSON.stringify(sameSite)}`);
    if (site === "None" && !secure) throw new TypeError("serializeCookie: SameSite=None needs Secure; browsers drop it without");
    if (expires !== undefined && !(expires instanceof Date && !Number.isNaN(expires.getTime()))) throw new TypeError("serializeCookie: expires must be a valid Date");
    if (maxAge !== undefined && !Number.isInteger(maxAge)) throw new TypeError("serializeCookie: maxAge must be an integer number of seconds");
    let cookie = `${name}=${encodeURIComponent(String(value ?? ""))}; Path=${path}`;
    if (httpOnly) cookie += "; HttpOnly";
    cookie += `; SameSite=${site}`;
    if (expires !== undefined) cookie += `; Expires=${expires.toUTCString()}`;
    if (maxAge !== undefined) cookie += `; Max-Age=${maxAge}`;
    if (secure) cookie += "; Secure";
    return cookie;
}

// Adds a Set-Cookie to a response that has not been written yet, beside any already set.
// `res.setHeader("set-cookie", …)` would replace them.
export function appendSetCookie(res, cookie) {
    const prior = res.getHeader("set-cookie");
    const list = prior === undefined ? [] : Array.isArray(prior) ? prior : [String(prior)];
    res.setHeader("set-cookie", [...list, cookie]);
}

// ---- the client's address ---------------------------------------------------------------------

// Who sent the request. With no proxy trusted it is the socket's address, and X-Forwarded-For is
// not read at all: anyone can write that header. Behind proxies, `trustProxy: { hops }` says how many
// (`true`, or no `hops`, is one): each appends the address it received the request from, so the
// client is the entry `hops` from the right, and whatever a client wrote in the header itself sits
// further left, where it is never read. A header with fewer entries gives its left-most; an empty or
// missing one, the socket's address. Behind one proxy that replaces the header with the one address
// it saw, rather than appending to it, this is that address, as a left-most read would be.
export function clientIp(req, { trustProxy = false } = {}) {
    const peer = req.socket?.remoteAddress;
    if (!trustProxy) return peer;
    const hops = trustProxy === true ? 1 : trustProxy.hops ?? 1;
    if (!Number.isInteger(hops) || hops < 1) throw new TypeError(`clientIp: trustProxy.hops must be a whole number of proxies, at least 1, not ${String(hops)}`);
    const entries = String(req.headers["x-forwarded-for"] ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
    if (!entries.length) return peer;
    return entries[Math.max(0, entries.length - hops)];
}

// ---- redirects --------------------------------------------------------------------------------

// Where an answer may send the browser when the location came with the request: a path on this
// site. That is decided by the URL parser the browser will use, not by prefixes: it drops tabs and
// newlines and reads "\" as "/", so "/<TAB>/elsewhere.example/" and "/\elsewhere.example/" name
// another host, and a prefix guard cannot list every spelling. A path resolves on whatever site it
// is read against; a location that names a host resolves to that host against both of these, so it
// can equal at most one of them (against one site alone, a location naming that site would pass).
export const onThisSite = (location) => typeof location === "string" && location.startsWith("/") && !location.startsWith("//")
    && ["http://one.invalid", "http://two.invalid"].every((site) => {
        try { return new URL(location, `${site}/`).origin === site; } catch { return false; }
    });

// ---- request bodies ---------------------------------------------------------------------------

// The request's body as a Buffer, or null once it passes `limit` bytes (a megabyte unless told):
// reading stops there, and the caller answers 413 in its own words. Counted as it arrives, so a
// body with no Content-Length, or one that lies, is held to the same limit. The request stream is
// left as it is, paused with the rest still to come (the iterator's default would destroy it, and
// Node then reads that socket no more): the caller drains it (drainBody) before answering.
export async function readBody(req, { limit = 1_000_000 } = {}) {
    if (typeof limit !== "number" || !(limit >= 0)) throw new TypeError(`readBody: limit must be a number of bytes, not ${String(limit)}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > limit) return null;
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

// The rest of a body nobody will read, read and dropped before the answer goes out. Answered at once
// and closed, a request refused part-way (a 413 at the limit, a 415 at its type) leaves the client's
// remaining bytes to meet a closed socket, and the reset that answers them can take the answer down
// with it: the client then sees a failed connection, not the 413. Left open without reading, the
// connection is poisoned instead: whatever arrives next is taken for the rest of that body (a proxy
// in front that pools the connection sends the next request into it). So, as nginx's lingering close
// does, the rest is read while it keeps coming, at most `idleMs` between pieces and `totalMs` in all,
// and the answer then goes with `connection: close`. A client that has stopped sending, or never
// stops, is not waited for beyond that. Resolves once the body has ended or the window has closed.
export function drainBody(req, { idleMs = 1000, totalMs = 5000 } = {}) {
    return new Promise((resolve) => {
        if (req.complete || req.readableEnded || req.destroyed) return resolve();
        let idle = null;
        const done = () => {
            clearTimeout(idle);
            clearTimeout(whole);
            req.off("data", onData);
            req.off("end", done);
            req.off("close", done);
            req.off("error", done);
            resolve();
        };
        const onData = () => { clearTimeout(idle); idle = setTimeout(done, idleMs); };
        const whole = setTimeout(done, totalMs);
        idle = setTimeout(done, idleMs);
        req.on("data", onData);
        req.once("end", done);
        req.once("close", done);
        req.once("error", done);
        req.resume();
    });
}

// ---- methods ----------------------------------------------------------------------------------

// What an address answers to a method it does not take, as RFC 9110 has it. `allow` is the methods
// it takes, GET and HEAD unless told. An OPTIONS is a 204 with Allow, the header a successful
// OPTIONS sends (9.3.7), and no Content-Length, which a 204 never carries (8.6). Any other method is
// a 405 with Allow, which every 405 carries (15.5.6), and a sentence naming them, never kept. True
// when it answered; false, with nothing written, for a method in `allow`, which the caller answers.
// The request's body is not read: Node reads and drops what is left of it once the answer has gone.
const isMethodName = (name) => typeof name === "string" && TOKEN.test(name);
export function refuseMethod(req, res, allow = ["GET", "HEAD"]) {
    if (!Array.isArray(allow) || allow.length === 0 || !allow.every(isMethodName)) {
        throw new TypeError('refuseMethod: allow is a list of method names, such as ["GET", "HEAD"]');
    }
    if (allow.includes(req.method)) return false;
    const listed = allow.join(", ");
    if (req.method === "OPTIONS") {
        res.writeHead(204, { allow: listed });
        res.end();
        return true;
    }
    res.writeHead(405, {
        allow: listed,
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
    });
    res.end(`This address takes ${listed}.`);
    return true;
}

// ---- responses --------------------------------------------------------------------------------

// What a response may be kept as, by name, and the Cache-Control each name sends. `private` is for a
// response made for one person (a page rendered for a signed-in viewer): their browser may keep it,
// and revalidates it; a shared cache in front never does. `public` may be kept by anyone and is
// revalidated on every use. `immutable` is for a URL whose content never changes (one that names a
// version of it). `no-store` keeps nothing, which is what a development server wants.
export const CACHE_CONTROL = Object.freeze({
    "no-store": "no-store",
    private: "private, no-cache",
    public: "public, max-age=0, must-revalidate",
    immutable: "public, max-age=31536000, immutable",
});

const cacheControl = (cache) => {
    if (!Object.hasOwn(CACHE_CONTROL, cache)) throw new TypeError(`unknown cache policy ${JSON.stringify(cache)}: one of ${Object.keys(CACHE_CONTROL).join(", ")}`);
    return CACHE_CONTROL[cache];
};

// A caller's headers with their names lowercased, as the ones send and sendFile write are, so that
// a caller's `Cache-Control` meets the `cache-control` written here and one of the two wins. Merged
// by the name as given, the two went out side by side, as two headers (and two Content-Lengths
// that disagree are a response no client can read).
const lowercased = (headers) => Object.fromEntries(Object.entries(headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]));

// A body ready to send many times: the bytes, gzipped once, a weak ETag, the status to answer with,
// and when it was made. The ETag is the body's length and the first 128 bits of its SHA-256, so it
// names these bytes and nothing else: one body has one tag on every instance and every Node, and a
// changed body has a new one even at the same length (a tag that fell back to the length alone would
// answer 304 for the old bytes, and the browser would keep them). Weak, because the gzip and the
// bytes share it: they are one content in two encodings, and `send` says Vary: Accept-Encoding.
// `gzip: false` keeps no gzip (`gz` is null), for bytes that are compressed already (a picture, a
// font), which gzipping again only costs time and memory; `send` then answers with the bytes
// whatever the client accepts.
export function pack(text, { status = 200, gzip = true } = {}) {
    const body = Buffer.from(text);
    const hash = createHash("sha256").update(body).digest("hex").slice(0, 32);
    return { body, gz: gzip ? zlib.gzipSync(body, { level: 6 }) : null, etag: `W/"${body.length.toString(36)}-${hash}"`, status, at: Date.now() };
}

// The entity tags an If-None-Match lists, each `"…"` or `W/"…"`. A tag may hold a comma, so the
// list is read tag by tag rather than split on commas.
const ENTITY_TAG = /(?:W\/)?"[^"]*"/g;
const opaqueTag = (tag) => (tag.startsWith("W/") ? tag.slice(2) : tag);

// Whether the client already holds this answer, so that it is a 304 Not Modified: its If-None-Match
// names `etag`, or is `*`, read as RFC 9110 reads it. Only a GET or a HEAD is answered 304 (13.1.2),
// and only when its answer would otherwise be a 2xx (`status`, 200 unless told): a server ignores the
// conditional headers for any other answer (a 404 is a 404, whatever the client holds) and for a
// method that selects no representation (13.2.1). A tag matches by the weak comparison (8.8.3.2):
// `W/` aside, the same quoted text, so a client that sends the tag unmarked still matches, and any
// tag of a list does.
export function notModified(req, { etag, status = 200 } = {}) {
    const header = req.headers["if-none-match"];
    if (header === undefined) return false;
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    if (!(status >= 200 && status <= 299)) return false;
    if (header.trim() === "*") return true;
    const tags = header.match(ENTITY_TAG) ?? [];
    return typeof etag === "string" && tags.some((tag) => opaqueTag(tag) === opaqueTag(etag));
}

// Sends a packed body: gzip to a client whose Accept-Encoding names it, the bytes otherwise, and
// 304 to a GET or a HEAD whose If-None-Match names this ETag, when the entry is a 2xx (notModified,
// above: a 404 is never a 304, whatever the client holds). The body is chosen by Accept-Encoding, so
// every answer says `Vary: Accept-Encoding`, or a cache could hand the gzip to a client that never
// asked for it; a 304 repeats the ETag, Cache-Control and Vary of the response it stands for.
// `cache` is a name from CACHE_CONTROL, `private` unless told: a response nobody classified is never
// kept by a shared cache.
// `headers` are the caller's own (a page's Content-Security-Policy), on the 200 and the 304 alike;
// the ones written here are never theirs to replace, in whatever case they are given (lowercased).
export function send(req, res, entry, { type, cache = "private", headers = null } = {}) {
    const common = { ...lowercased(headers), etag: entry.etag, "cache-control": cacheControl(cache), vary: "Accept-Encoding" };
    if (notModified(req, entry)) {
        res.writeHead(304, common);
        return res.end();
    }
    const gzip = Boolean(entry.gz) && /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");
    res.writeHead(entry.status ?? 200, {
        ...common,
        "content-type": type,
        ...(gzip ? { "content-encoding": "gzip" } : {}),
    });
    res.end(gzip ? entry.gz : entry.body);
}

// The one byte range a Range header asks for in a file of `size` bytes, read as RFC 9110 reads it:
// `{ start, end }` (both inclusive) to send, `false` when it cannot be satisfied, or `null` to ignore
// the header and send the whole file. `first-last` and `first-` start at `first`, and an end past the
// file is clamped to its last byte; `-N` is the last N bytes, all of them when the file is shorter.
// Unsatisfiable: a first at or past the end, or a suffix of 0. A last before its first is invalid,
// and refused the same way (RFC 9110 lets a server ignore or reject it). Everything else, another
// unit, several ranges, anything malformed, is ignored, which RFC 9110 allows any server to do; so is
// a suffix of an empty file, which is satisfiable but has no bytes a Content-Range could name. The
// unit is matched in any case, as RFC 9110 says range units are.
function byteRange(header, size) {
    const match = /^bytes=(?:(\d+)-(\d*)|-(\d+))$/i.exec(header);
    if (!match) return null;
    const [, first, last, suffix] = match;
    if (suffix !== undefined) {
        const length = Number(suffix);
        if (length === 0) return false;
        if (size === 0) return null;
        return { start: Math.max(0, size - length), end: size - 1 };
    }
    const start = Number(first);
    const end = last === "" ? Infinity : Number(last);
    if (end < start || start >= size) return false;
    return { start, end: Math.min(end, size - 1) };
}

// Streams a file from disk, so a large one never sits in memory, and answers a single byte range
// (`Range: bytes=first-last`, `first-`, or `-N` for the last N bytes: see byteRange) with 206 and
// those bytes, so a <video> can seek. A range that cannot be satisfied is 416; a Range header that is
// not one byte range is ignored and the whole file sent. HEAD gets the headers GET would, alone.
// `size` is the file's, when the caller already knows it; otherwise the file is stat'ed, and a
// missing file throws before anything is written. `headers` are added to every answer but the 416 (a
// Content-Disposition, say), in whatever case they are given (lowercased): one of the type, the
// Accept-Ranges or the Cache-Control replaces sendFile's own, while the Content-Range and the
// Content-Length are always the bytes sent. A read error once the stream has started ends the
// connection: the status line is gone by then. The file is read through `pipeline`, which closes
// it however the answer ends: `pipe` left the read stream open when the client went away (a video
// seeking cuts the download it no longer wants), and each such download held a file descriptor
// until the process ran out of them.
// A Range that comes with an If-Range is honoured only when the If-Range names the ETag this answer
// carries by the strong comparison (RFC 9110, 13.1.5): otherwise the client's partial copy is of
// other bytes, and it gets the whole file. sendFile makes no ETag of its own, so only one the caller
// gives in `headers` can be named; a date, a weak tag or another tag sends the whole file.
export async function sendFile(req, res, file, { type, cache = "private", size, headers = {} } = {}) {
    const common = { "content-type": type, "accept-ranges": "bytes", "cache-control": cacheControl(cache), ...lowercased(headers) };
    size ??= (await stat(file)).size;
    const ifRange = req.headers["if-range"];
    const current = ifRange === undefined || (ifRange === common.etag && !ifRange.startsWith("W/"));
    const range = current ? byteRange(String(req.headers.range ?? ""), size) : null;
    if (range === false) { res.writeHead(416, { "content-range": `bytes */${size}` }); return res.end(); }
    if (range) {
        const { start, end } = range;
        res.writeHead(206, { ...common, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
        if (req.method === "HEAD") return res.end();
        return void pipeline(createReadStream(file, { start, end }), res, () => {});
    }
    res.writeHead(200, { ...common, "content-length": size });
    if (req.method === "HEAD") return res.end();
    return void pipeline(createReadStream(file), res, () => {});
}

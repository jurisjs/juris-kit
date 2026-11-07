// The HTML document around a server-rendered page. `renderDocument` writes the doctype, <html>,
// the <head> an app describes as data, the rendered body in its root element, the serialised
// state, and the loader that boots the app's browser entry. Node only; it is never served.
//
// Every value it is given is escaped where it is written, with the escapers the SSR renderer
// (ssr-renderer.js, beside this file) uses for the body: a title is text, never markup, whoever
// wrote it. A page's title is often made from its own data (a record's name, written by a user),
// and a page kept in a shared cache carries whatever its head says to every later visitor. The one exception is `trustedHead`, the slot an
// app's own inline scripts go in (a script that sets the theme before the first paint, say), which
// is written as given. It is code, so nothing a request carries belongs in it.
//
// What escaping cannot make safe is refused instead, with the rules both renderers apply
// (html-safety.js): an attribute name taken from data (`onload` is the injection, whatever its
// value), a URL whose scheme runs code, and code that would end its own raw-text element (`</style`
// in a style's text, `</script` or `<!--` in the reload script). A refusal throws; nothing is
// quietly dropped or rewritten.
//
// The contract between the document and the browser entry: the body is in `#app`, the state is
// JSON in `<script type="application/json" id="state">`, the names of the services the browser may
// call, when the document carries them, are a JSON list in `<script type="application/json"
// id="services">`, in development a `<script type="application/json" id="juris-dev">` turns the
// browser's devMode on (client.js hydrate), and the entry module exports `start()`, which the loader
// calls once the page is idle. A page cached before a deploy boots the entry of whichever build serves it next, so these
// names do not change from one build to the next.
import { createHash } from "node:crypto";
import { escapeText, escapeAttribute } from "./ssr-renderer.js";
import { checkAttribute, safeUrl } from "juris/html-safety.js";

// ` name="value"` for each attribute, in the order given: `true` writes the bare name, and
// `null`, `undefined` and `false` write nothing.
function attributes(attrs, where) {
    if (attrs === null || typeof attrs !== "object" || Array.isArray(attrs)) {
        throw new TypeError(`renderDocument: ${where} takes an object of attributes`);
    }
    let out = "";
    for (const [name, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue;
        const check = checkAttribute(name, value === true ? null : value);
        if (!check.ok) throw new Error(`renderDocument: ${where}: ${check.reason}`);
        out += value === true ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`;
    }
    return out;
}

// Attributes for an element whose `rel` the framework writes itself.
function withoutRel(attrs, where) {
    if (attrs && typeof attrs === "object" && Object.hasOwn(attrs, "rel")) {
        throw new Error(`renderDocument: ${where} writes its own rel; leave it out`);
    }
    return attributes(attrs, where);
}

// A `<meta http-equiv="refresh">` navigates to the URL in its content (`5; url=/next`), which no
// URL attribute check sees: the URL part is held to the scheme rules a link's href is, and a
// refused one throws. The URL is found as the browser finds it: after the delay, a `;` or `,`, an
// optional `url=`, and an optional quote.
function checkRefresh(tag, where) {
    const named = (wanted) => Object.keys(tag).find((name) => name.toLowerCase() === wanted);
    const equiv = named("http-equiv");
    if (equiv === undefined || String(tag[equiv]).trim().toLowerCase() !== "refresh") return;
    const content = String(tag[named("content")] ?? "");
    let url = content.replace(/^[\t\n\f\r ]*[0-9.]*[\t\n\f\r ]*[;,]?[\t\n\f\r ]*/, "");
    url = url.replace(/^url[\t\n\f\r ]*=[\t\n\f\r ]*/i, "");
    if (/^["']/.test(url)) {
        const end = url.indexOf(url[0], 1);
        url = end === -1 ? url.slice(1) : url.slice(1, end);
    }
    if (!safeUrl(url)) throw new Error(`renderDocument: ${where}: a refresh to "${url.slice(0, 40)}": scheme not allowed`);
}

// Code written into a raw-text element cannot be escaped without changing what it means, so the
// sequences that would end the element early (or, in a script, change how its end is found) are
// refused.
function rawText(text, element, where) {
    const source = String(text);
    const closing = new RegExp(`</${element}`, "i");
    if (closing.test(source)) throw new Error(`renderDocument: ${where} contains </${element}, which would end the element`);
    if (element === "script" && source.includes("<!--")) throw new Error(`renderDocument: ${where} contains <!--, which changes where the script ends`);
    return source;
}

// A string as a JavaScript string literal that is safe inside a <script>: JSON, with `<` escaped so
// that nothing in it can close the element, and the two line separators JSON leaves raw escaped.
const scriptString = (value) => JSON.stringify(String(value))
    .replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

// renderDocument({ html, json }, options) → the whole document, as a string.
//
// `html` and `json` are what `renderRequest` returns: the body's markup, which the SSR renderer
// has already escaped, and the serialised state, whose `<` is escaped here as well (a no-op for
// `serializeState`'s output), because it sits inside a <script>.
//
// The head is written in this order, and only what is given is written:
//   <meta charset="utf-8">
//   viewport      the viewport meta's content ("width=device-width, initial-scale=1" unless told;
//                 null for none)
//   title         text (an empty <title> when not given)
//   description   the description meta's content
//   canonical     the canonical link's href, an absolute URL
//   links         [{ rel, href, … }]: <link> elements, each an object of attributes in its order
//   meta          [{ name | property, content, … }]: <meta> elements, likewise
//   buildMeta     { name, content }: a meta naming the build that wrote the page, for a browser
//                 that wants to know whether the server has moved on since
//   preload       [{ href, as, type, crossorigin, … }]: <link rel="preload"> elements
//   styles        [{ text } | { href, … }]: an inline <style>, or a <link rel="stylesheet">
//   trustedHead   markup, written as given, last
// `lang` (default "en") and `htmlAttrs` are the <html> element's attributes. The body holds the
// markup in `rootId` (default "app"), the state in `stateId` (default "state"), when given the
// callable service names (`serviceNames`, a list of strings) as JSON in `#services`, when given
// `jurisDev` (development's data for the browser's devtools, a plain object, `{}` today) as JSON in
// `#juris-dev`, which turns the browser's devMode on, the loader for `entry` (the URL of the app's
// browser entry, required), and, when given, `devReload`: the development reload client, as the
// source of a script. Each value above is escaped as the place it is written requires;
// `trustedHead` alone is not.
export function renderDocument({ html = "", json = "{}" } = {}, {
    lang = "en",
    htmlAttrs = {},
    viewport = "width=device-width, initial-scale=1",
    title = "",
    description = null,
    canonical = null,
    links = [],
    meta = [],
    buildMeta = null,
    preload = [],
    styles = [],
    trustedHead = "",
    entry,
    serviceNames = null,
    devReload = null,
    jurisDev = null,
    rootId = "app",
    stateId = "state",
} = {}) {
    if (typeof entry !== "string" || entry === "") throw new TypeError("renderDocument: entry, the URL of the browser entry, is required");
    if (jurisDev !== null && (typeof jurisDev !== "object" || Object.getPrototypeOf(jurisDev) !== Object.prototype)) {
        throw new TypeError("renderDocument: jurisDev is the page's development data, a plain object written as JSON in #juris-dev, or null for none");
    }
    if (serviceNames !== null && serviceNames !== undefined && !(Array.isArray(serviceNames) && serviceNames.every((name) => typeof name === "string"))) {
        throw new TypeError("renderDocument: serviceNames is a list of service names (strings), or null for none");
    }

    const head = ['<meta charset="utf-8">'];
    if (viewport !== null && viewport !== undefined) head.push(`<meta name="viewport" content="${escapeAttribute(viewport)}">`);
    head.push(`<title>${escapeText(title ?? "")}</title>`);
    if (description !== null && description !== undefined) head.push(`<meta name="description" content="${escapeAttribute(description)}">`);
    if (canonical !== null && canonical !== undefined) head.push(`<link${attributes({ rel: "canonical", href: canonical }, "canonical")}>`);
    for (const link of links) head.push(`<link${attributes(link, "links")}>`);
    for (const tag of meta) {
        const written = attributes(tag, "meta");
        checkRefresh(tag, "meta");
        head.push(`<meta${written}>`);
    }
    if (buildMeta !== null && buildMeta !== undefined) {
        if (typeof buildMeta?.name !== "string" || buildMeta.name === "") throw new TypeError("renderDocument: buildMeta needs a name");
        head.push(`<meta${attributes({ name: buildMeta.name, content: buildMeta.content ?? "" }, "buildMeta")}>`);
    }
    for (const link of preload) head.push(`<link rel="preload"${withoutRel(link, "preload")}>`);
    for (const style of styles) {
        if (style && typeof style === "object" && Object.hasOwn(style, "text")) {
            head.push(`<style>${rawText(style.text, "style", "a style's text")}</style>`);
        } else if (style && typeof style === "object" && Object.hasOwn(style, "href")) {
            head.push(`<link rel="stylesheet"${withoutRel(style, "a stylesheet")}>`);
        } else {
            throw new TypeError("renderDocument: each of styles is { text } or { href }");
        }
    }
    if (trustedHead) head.push(String(trustedHead));

    const reload = devReload ? `<script>${rawText(devReload, "script", "devReload")}</script>` : "";
    // Data, like the state: JSON with `<` escaped, so no name can close the element.
    const names = Array.isArray(serviceNames)
        ? `<script type="application/json" id="services">${JSON.stringify(serviceNames).replace(/</g, "\\u003c")}</script>\n`
        : "";
    const dev = jurisDev === null ? "" : `<script type="application/json" id="juris-dev">${JSON.stringify(jurisDev).replace(/</g, "\\u003c")}</script>\n`;
    // The loader asks whether requestIdleCallback is a function, never whether it is there: where a
    // browser has none (Safari), an element with id="requestIdleCallback" in the body is what the
    // global name finds, and calling it threw, so the page never booted.
    return `<!doctype html>
<html lang="${escapeAttribute(lang)}"${attributes(htmlAttrs, "htmlAttrs")}>
<head>
${head.join("\n")}
</head>
<body>
<div id="${escapeAttribute(rootId)}">${html}</div>
<script type="application/json" id="${escapeAttribute(stateId)}">${String(json).replace(/</g, "\\u003c")}</script>
${names}${dev}<script type="module">
  const boot = () => import(${scriptString(entry)}).then((m) => m.start());
  const idle = typeof requestIdleCallback === "function" ? requestIdleCallback : (fn) => setTimeout(fn, 1);
  if (document.readyState === "complete") idle(boot);
  else addEventListener("load", () => idle(boot), { once: true });
</script>
${reload}
</body>
</html>`;
}

// The CSP source of every script a document written above runs inline: `'sha256-…'` of the loader,
// and of the reload client in development. The JSON blocks (#state, #services) run nothing and are not
// named. A hash, not a nonce: a page a cache shares is the same bytes for every reader. The page's
// own markup holds no <script> (html-safety refuses the tag), so these are the document's own.
export function inlineScriptHashes(document) {
    const out = [];
    for (const m of String(document).matchAll(/<script(?: type="module")?>([\s\S]*?)<\/script>/g)) out.push(`'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`);
    return out;
}

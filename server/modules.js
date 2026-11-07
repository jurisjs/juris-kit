// Serving an app's browser modules with no build step: the files on disk are the modules, and what
// makes that safe across a rolling deploy lives here.
//
//   const modules = await createModuleServer({ root, dev, build, mounts, assets, rootFiles, static, minify });
//   if (await modules.handle(req, res, url)) return;      // true when it answered
//   const href = await modules.versioned("/app/boot.js");  // for the page's own tags
//
// What is served is declared once, as mounts: `{ url, dir, depth, only }` serves the files in `dir`
// (relative to `root`, and inside it unless the mount says `outside: true`, for modules an app installs
// beside itself) under the URL prefix `url`, down `depth` levels of subdirectories (0 unless
// told), with the extensions in `only` ([".js"] unless told, and only ".js", a module typed and
// import-stamped, or ".css", a stylesheet typed). Names are plain (letters, digits, `_`
// and `-`), so a URL can never walk out of its directory. `assets` are single files served the same
// way (a stylesheet, the browser entry), each at a URL no mount serves. The framework's own browser
// half is always mounted, flat, at /src/: the top-level files of the juris package, wherever it is
// installed, and never a subdirectory of them; the kit's Node-only server/ is never served,
// whatever the mounts say. A mount, an asset, a root file or a static entry that reaches into
// either is refused at construction, by the file it names and not only by its URL, since an app
// that vendors the framework has it somewhere other than node_modules. The paths compared are as
// written, not real paths: pass `root` as the real directory (a file: URL from
// the app's own import.meta.url is one), since through a symlink these refusals do not hold. From
// the mounts come what a URL may name, the boot snapshot, and which absolute imports are stamped, so
// the three cannot disagree.
//
// `rootFiles` are the files a browser finds by a fixed name and asks for again whenever it likes, such
// as a service worker and a web app manifest, which live at the root so that their scope is the whole
// site: `{ "/sw.js": { file: "web/sw.js", headers: { "service-worker-allowed": "/" } },
// "/manifest.webmanifest": "web/manifest.webmanifest" }`. They are not modules: sent as they are on
// disk (never stamped or minified), with no `?v` and no part in the code id, always `no-cache`, typed
// by extension unless `type` says, with any other headers the app gives them. They change what an
// installed app does, so production snapshots them too, and a declared one missing at start refuses
// construction.
//
// `static` is what a site serves that is not its code: fonts, pictures, a library vendored byte for
// byte. `{ url, dir, depth, only }` serves a directory's files with those extensions, as a mount
// does, and `{ url, file }` one file at one URL; either says how long a browser may keep it,
// `immutable: true` for a name that changes whenever the file does (a font's, a vendored folder
// that carries its version), or `maxAge` in seconds (0 unless told: asked again on every use).
// Names may carry dots (`chart-4.1.0/chart.js`) but start with a letter, a digit, `_` or `-`,
// so no name is `..`. A static file is sent as it is on disk, typed by its extension unless `type`
// says, never stamped or minified; text is gzipped for a browser that asks for it (and the answer
// varies by encoding), while a font or a picture is already compressed and goes one way. Its ETag
// names its bytes. Static files are not modules: no `?v`, no part in the code id, and not in the
// snapshot. Production reads each the first time it is asked for and keeps it, so an instance still
// on the old build may serve the new checkout's copy mid-roll, which a versioned name makes
// harmless; development reads the disk on every request. A declared name with no file behind it is
// a 404.
//
// Why each piece exists:
//
// - The snapshot. In production the served files are read ONCE, at construction. Every instance of
//   an app usually runs from one checkout, and a rolling deploy changes the files before it restarts
//   each instance; an instance still waiting its turn that read the files lazily would serve the new
//   code under its old URLs. It serves what it started with, and only that: a file the checkout
//   gained since is not found (404, `no-store`), because read from disk it would be the next build's
//   code with its imports stamped with this build's id, a module graph half of each. A page from
//   the next build that asks this instance for such a file cannot load it: it stays the readable
//   server-rendered page it is, and its next full load is one build's.
// - The code id. One hash of everything in the snapshot, plus the build, which the app passes, and
//   the transform this server applies (its stamper's and minifier's version, and whether and with
//   what it minifies). Module URLs carry it, so a URL changes exactly when the bytes served under it
//   can, and a rollback to the same code is the same URLs.
// - `versioned(path)`: the path with `?v=<content hash>-<code id>`, for the tags an app writes itself.
// - Import stamping. Every import a served module makes of another is rewritten to carry `?v=<code
//   id>`, so a browser never reuses a module it cached from another build. Relative specifiers and
//   absolute ones under a mount are stamped in every form a browser follows: `from` (imports and
//   re-exports), a side-effect `import "x"`, and `import(…)`. One form left unstamped is a second
//   URL for any module another form also reaches, so two module instances, two copies of every
//   module-level variable, and a "register once" guard that guards one of them (the symptom, when
//   a dynamic import of an absolute path was the form left out, was a component "already
//   registered" during hydration). A specifier that is not a string literal (or, as `import()`'s
//   argument, a template with no substitution) cannot be stamped, and a string, a comment or a
//   template's text that only spells an import is not code, and is left as it is.
// - `immutable` only for this process's own code id. Mid-roll, a page from an instance on the other
//   build can ask this one for a module under that build's URL. It gets an answer, but not one a
//   browser may keep for a year under a URL that names different code.
//
// In development (`dev: true`) nothing is snapshotted, minified or kept: every request reads the file
// from disk and stamps it again, so what a browser gets is what is on disk now, whether or not
// anything watches that file and whether or not a reload remembered to clear anything. A stack
// trace lands on a real line, and every answer is `no-store`. `clear()` forgets what production
// built from its snapshot, and has nothing to forget in development.
import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateHeaderName, validateHeaderValue } from "node:http";
import { pack, send, notModified } from "./http.js";
import { minifyJs, minifyCss, jsTokens } from "./minify.js";

// The framework's browser half: the flat *.js of the juris package, wherever it is installed. The kit
// itself, one directory up from this file, is Node-only, and refused wherever the framework is.
const FRAMEWORK_DIR = path.dirname(fileURLToPath(import.meta.resolve("juris")));
const KIT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const FRAMEWORK = Object.freeze({ url: "/src/", dir: FRAMEWORK_DIR, depth: 0, only: Object.freeze([".js"]) });

// What a mount or an asset may serve: a module, typed and import-stamped as .js, and a stylesheet,
// typed as .css (it imports no module). Anything else would go out text/plain, which a browser will
// not run as a module, and an import of it would be left unstamped, kept across builds: refused at
// construction rather than served as something it is not.
const TYPES = { ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const isModuleExtension = (ext) => Object.hasOwn(TYPES, ext);
const MODULE_EXTENSIONS = Object.keys(TYPES).map((ext) => JSON.stringify(ext)).join(" or ");
const PLAIN = /^[\w-]+$/;
const NOT_STARTED_WITH = "JURIS_NOT_IN_SNAPSHOT";         // the error code for a file the checkout gained since
const ROOT_TYPES = {
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json",
};
// What this server does to a module's bytes beyond reading them: the import stamper here and the
// framework's minifier. The code id folds it in, since a server upgraded under the same build and the
// same files serves other bytes under URLs a browser keeps for a year: bump it with any change to
// either that changes what they write.
const TRANSFORM_VERSION = 3;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const within = (dir, parent) => dir === parent || dir.startsWith(parent + path.sep);
// Whether a directory served `depth` levels down, or a file (depth 0), is the framework's or the
// kit's: inside either, or above it and deep enough to reach its files. Either would serve the
// framework under a second URL (two module instances) or serve Node-only code.
const reachesFramework = (absolute, depth = 0) => [FRAMEWORK_DIR, KIT_DIR].some((dir) =>
    within(absolute, dir) || (within(dir, absolute) && path.relative(absolute, dir).split(path.sep).length <= depth));

// The mounts as the server uses them: the framework's first, then the app's, each checked, with its
// directory absolute. A mount is refused rather than half-honoured, and so is one under another's
// URL that the other also reaches (deep enough, and with one of its extensions): development
// answered from the first, while the snapshot kept the last.
function mountsFor(root, mounts) {
    if (!Array.isArray(mounts)) throw new TypeError("createModuleServer: `mounts` is a list of { url, dir, depth, only }");
    const seen = new Set([FRAMEWORK.url]);
    const built = [FRAMEWORK, ...mounts.map((mount) => {
        const { url, dir, depth = 0, only = [".js"], outside } = mount ?? {};
        const where = `createModuleServer: mount ${JSON.stringify(url)}`;
        if (typeof url !== "string" || !/^\/(?:[\w-]+\/)+$/.test(url)) throw new TypeError(`${where}: a url is a path of plain names that starts and ends with "/"`);
        if (url.startsWith(FRAMEWORK.url)) throw new TypeError(`${where}: /src/ is the framework's, mounted flat by the module server itself`);
        if (seen.has(url)) throw new TypeError(`${where}: mounted twice`);
        seen.add(url);
        if (typeof dir !== "string" || !dir) throw new TypeError(`${where}: no dir`);
        if (outside !== undefined && outside !== true) throw new TypeError(`${where}: outside is true or left out`);
        const absolute = path.resolve(root, dir);
        // Outside the root only when the app says so: modules it installs beside itself (plug-ins in a
        // folder the installation owns), never by a dir that walks out of the tree unnoticed.
        if (!outside && !within(absolute, root)) throw new TypeError(`${where}: its dir is outside the root`);
        if (!Number.isInteger(depth) || depth < 0) throw new TypeError(`${where}: depth is a whole number of subdirectory levels`);
        if (reachesFramework(absolute, depth)) throw new TypeError(`${where}: its dir reaches the framework, which is served only flat, at /src/`);
        if (!Array.isArray(only) || !only.length || !only.every(isModuleExtension)) throw new TypeError(`${where}: only is a list of the extensions a module is served with, ${MODULE_EXTENSIONS}`);
        return Object.freeze({ url, dir: absolute, depth, only: Object.freeze([...only]) });
    })];
    // One answer per URL: `outer` serves a URL of `inner`'s when `inner`'s is under its own, no more
    // levels down than its depth, and they share an extension.
    const reaches = (outer, inner) => inner.url.startsWith(outer.url)
        && inner.url.slice(outer.url.length).split("/").length - 1 <= outer.depth
        && outer.only.some((ext) => inner.only.includes(ext));
    built.forEach((mount, i) => {
        for (const other of built.slice(0, i)) {
            const [outer, inner] = reaches(other, mount) ? [other, mount] : reaches(mount, other) ? [mount, other] : [];
            if (outer) throw new TypeError(`createModuleServer: mount ${JSON.stringify(inner.url)}: served twice (the mount ${outer.url} reaches its URLs too)`);
        }
    });
    return built;
}

// The assets as the server uses them: URL -> file (absolute). Refused by its file as well as by its
// URL: under an app that vendors the framework (<root>/lib/juris, say) a URL outside /src/ can
// name a file of it, Node-only or a flat one under a second URL. One a mount also serves is refused
// rather than shadowed: development served the asset, while production's snapshot kept the mount's
// file.
function assetsFor(root, assets, mounts) {
    if (!Array.isArray(assets)) throw new TypeError("createModuleServer: `assets` is a list of URL paths");
    return new Map(assets.map((url) => {
        if (typeof url !== "string" || !/^\/(?:[\w-]+\/)*[\w-]+\.\w+$/.test(url)) throw new TypeError(`createModuleServer: asset ${JSON.stringify(url)} is not a path of plain names`);
        if (url.startsWith(FRAMEWORK.url)) throw new TypeError(`createModuleServer: asset ${url}: /src/ is the framework's`);
        if (!isModuleExtension(path.extname(url))) throw new TypeError(`createModuleServer: asset ${url}: an asset is served as a module is, with ${MODULE_EXTENSIONS}`);
        if (fileFor(url, mounts, new Map()) !== null) throw new TypeError(`createModuleServer: asset ${url}: a mount also serves that URL`);
        const file = path.join(root, url.slice(1));
        if (reachesFramework(file)) throw new TypeError(`createModuleServer: asset ${url}: its file is the framework's, which is served only flat, at /src/`);
        return [url, file];
    }));
}

// The root files as the server uses them: URL -> { file (absolute), type, headers }. A URL is a path
// of plain names (a dot-led folder such as .well-known included), and one a mount or an asset also
// serves is refused rather than shadowed.
function rootFilesFor(root, rootFiles, mounts, assets) {
    if (rootFiles === null || typeof rootFiles !== "object" || Array.isArray(rootFiles)) {
        throw new TypeError("createModuleServer: `rootFiles` maps a URL to a file, or to { file, type, headers }");
    }
    return new Map(Object.entries(rootFiles).map(([url, entry]) => {
        const where = `createModuleServer: root file ${JSON.stringify(url)}`;
        const names = url.split("/");
        if (names.shift() !== "" || !names.every((name) => /^\.?[\w-]+(?:\.[\w-]+)*$/.test(name))) {
            throw new TypeError(`${where}: a URL is a path of plain names that starts with "/"`);
        }
        if (url.startsWith(FRAMEWORK.url)) throw new TypeError(`${where}: /src/ is the framework's`);
        if (fileFor(url, mounts, assets) !== null) throw new TypeError(`${where}: a mount or an asset also serves that URL`);
        const { file, type = ROOT_TYPES[path.extname(url)], headers = {} } = typeof entry === "string" ? { file: entry } : (entry ?? {});
        if (typeof file !== "string" || !file) throw new TypeError(`${where}: no file`);
        const absolute = path.resolve(root, file);
        if (!within(absolute, root)) throw new TypeError(`${where}: its file is outside the root`);
        // Not a module's door: a file of the framework's here would be Node-only code served, or a
        // flat module under a second URL, unstamped.
        if (reachesFramework(absolute)) throw new TypeError(`${where}: its file is the framework's, which is served only flat, at /src/`);
        if (typeof type !== "string" || !type) throw new TypeError(`${where}: say its type; its extension names none`);
        if (headers === null || typeof headers !== "object" || Array.isArray(headers)) throw new TypeError(`${where}: headers are { name: value }`);
        for (const [name, value] of Object.entries(headers)) {
            if (/^(content-type|cache-control)$/i.test(name)) throw new TypeError(`${where}: ${name} is not the app's to set: a root file is typed by \`type\`, and always revalidated`);
            if (typeof value !== "string") throw new TypeError(`${where}: header ${name} is not a string`);
            try { validateHeaderName(name); validateHeaderValue(name, value); } catch { throw new TypeError(`${where}: header ${JSON.stringify(name)} is not one a response can carry`); }
        }
        return [url, Object.freeze({ file: absolute, type, headers: Object.freeze({ ...headers }) })];
    }));
}

// What a static file is, by extension, when its entry does not say. Text is gzipped for a browser
// that asks; everything else here is compressed already.
const STATIC_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
};
const compressible = (type) => /^text\/|javascript|json|\+xml/.test(type);
const STATIC_NAME = /^[\w-][\w.-]*$/;

// The static entries as the server uses them: [{ url, dir | file (absolute), depth, only, types,
// cache }], each checked. An entry is refused rather than half-honoured, and so is one that would
// answer a URL a mount, an asset, a root file or another entry answers.
function staticFor(root, entries, mounts, assets, rootFiles) {
    if (!Array.isArray(entries)) throw new TypeError("createModuleServer: `static` is a list of { url, dir, depth, only } or { url, file }");
    const built = entries.map((entry) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError("createModuleServer: a static entry is { url, dir, depth, only } or { url, file }");
        const { url, dir, file, depth = 0, only, type, immutable = false, maxAge } = entry;
        const where = `createModuleServer: static ${JSON.stringify(url)}`;
        if ((dir === undefined) === (file === undefined)) throw new TypeError(`${where}: give it a dir (a directory's files) or a file (one), not both`);
        const directory = dir !== undefined;
        if (typeof url !== "string" || !(directory ? /^\/(?:[\w-]+\/)+$/ : /^\/(?:[\w-]+\/)*[\w-][\w.-]*\.\w+$/).test(url)) {
            throw new TypeError(`${where}: a url is a path of plain names that starts with "/", and ${directory ? "ends with \"/\"" : "names a file with an extension"}`);
        }
        if (url.startsWith(FRAMEWORK.url)) throw new TypeError(`${where}: /src/ is the framework's`);
        const source = directory ? dir : file;
        if (typeof source !== "string" || !source) throw new TypeError(`${where}: no ${directory ? "dir" : "file"}`);
        const absolute = path.resolve(root, source);
        if (!within(absolute, root)) throw new TypeError(`${where}: its ${directory ? "dir" : "file"} is outside the root`);
        if (!Number.isInteger(depth) || depth < 0) throw new TypeError(`${where}: depth is a whole number of subdirectory levels`);
        if (reachesFramework(absolute, directory ? depth : 0)) throw new TypeError(`${where}: it reaches the framework, which is served only flat, at /src/`);
        if (type !== undefined && (typeof type !== "string" || !type)) throw new TypeError(`${where}: type is a content type`);
        const extensions = directory ? only : [path.extname(url)];
        if (directory && (!Array.isArray(only) || !only.length || !only.every((ext) => /^\.\w+$/.test(ext)))) {
            throw new TypeError(`${where}: only is a list of extensions such as ".woff2"`);
        }
        const types = Object.fromEntries(extensions.map((ext) => {
            const named = type ?? STATIC_TYPES[ext.toLowerCase()];
            if (!named) throw new TypeError(`${where}: say its type; ${ext} names none`);
            return [ext, named];
        }));
        if (typeof immutable !== "boolean") throw new TypeError(`${where}: immutable is true or false`);
        if (maxAge !== undefined && !(Number.isInteger(maxAge) && maxAge >= 0)) throw new TypeError(`${where}: maxAge is a whole number of seconds`);
        if (immutable && maxAge !== undefined) throw new TypeError(`${where}: immutable or a maxAge, not both`);
        const cache = immutable ? "public, max-age=31536000, immutable" : maxAge ? `public, max-age=${maxAge}` : "public, max-age=0, must-revalidate";
        return Object.freeze({ url, dir: directory ? absolute : null, file: directory ? null : absolute, depth, only: Object.freeze([...extensions]), types: Object.freeze(types), cache });
    });
    // One answer per URL: nothing a mount, an asset, a root file or another entry answers.
    const related = (a, b) => a.startsWith(b) || b.startsWith(a);
    built.forEach((entry, i) => {
        const where = `createModuleServer: static ${entry.url}`;
        for (const other of built.slice(0, i)) {
            if (entry.url === other.url || (entry.dir && other.dir && related(entry.url, other.url))) throw new TypeError(`${where}: served twice (another static entry at ${other.url})`);
        }
        if (entry.dir) {
            for (const mount of mounts) if (related(entry.url, mount.url)) throw new TypeError(`${where}: a module mount (${mount.url}) also serves under it`);
            for (const url of [...assets.keys(), ...rootFiles.keys()]) if (staticFileFor(url, [entry]) !== null) throw new TypeError(`${where}: an asset or a root file also serves ${url}`);
        } else if (fileFor(entry.url, mounts, assets) !== null || rootFiles.has(entry.url)) {
            throw new TypeError(`${where}: a mount, an asset or a root file also serves that URL`);
        }
    });
    built.forEach((entry, i) => {
        for (const other of built.slice(0, i)) {
            if (!entry.dir !== !other.dir && staticFileFor((entry.file ? entry : other).url, [entry.dir ? entry : other]) !== null) {
                throw new TypeError(`createModuleServer: static ${entry.url}: served twice (another static entry also serves ${(entry.file ? entry : other).url})`);
            }
        }
    });
    return built;
}

// The static file a URL path names, as { file, type, cache }, or null when no entry serves it.
function staticFileFor(pathname, entries) {
    for (const entry of entries) {
        if (entry.file) {
            if (pathname === entry.url) return { file: entry.file, type: entry.types[entry.only[0]], cache: entry.cache };
            continue;
        }
        if (!pathname.startsWith(entry.url)) continue;
        const parts = pathname.slice(entry.url.length).split("/");
        const name = parts.pop();
        const ext = path.extname(name);
        if (parts.length > entry.depth || !parts.every((part) => STATIC_NAME.test(part)) || !STATIC_NAME.test(name)) continue;
        if (!entry.only.includes(ext)) continue;
        return { file: path.join(entry.dir, ...parts, name), type: entry.types[ext], cache: entry.cache };
    }
    return null;
}

const rootOf = (root) => {
    if (root instanceof URL) return path.resolve(fileURLToPath(root));
    if (typeof root === "string" && root) return path.resolve(root);
    throw new TypeError("createModuleServer: `root` is the directory the mounts are relative to (a path or a file: URL)");
};

// The file a URL path names, or null when no mount or asset serves it.
function fileFor(pathname, mounts, assets) {
    if (assets.has(pathname)) return assets.get(pathname);
    for (const mount of mounts) {
        if (!pathname.startsWith(mount.url)) continue;
        const parts = pathname.slice(mount.url.length).split("/");
        const name = parts.pop();
        const ext = path.extname(name);
        if (parts.length > mount.depth || !parts.every((part) => PLAIN.test(part))) continue;
        if (!mount.only.includes(ext) || !PLAIN.test(name.slice(0, -ext.length))) continue;
        return path.join(mount.dir, ...parts, name);
    }
    return null;
}

// Every file the mounts and assets serve, as [url, file] pairs sorted by URL: what the snapshot
// reads, and what an app's own checks (a test that minifies everything it serves, for one) walk.
// A name is a module's only with a file behind it: a directory called `x.js` is none, and read as one
// it stopped production starting.
async function listFiles(mounts, assets) {
    const found = [...assets];
    const walk = async (mount, dir, prefix, depth) => {
        for (const name of await readdir(dir).catch(() => [])) {
            const ext = path.extname(name);
            const file = path.join(dir, name);
            if (mount.only.includes(ext) && PLAIN.test(name.slice(0, -ext.length)) && (await stat(file)).isFile()) found.push([`${prefix}${name}`, file]);
            else if (depth > 0 && PLAIN.test(name)) await walk(mount, file, `${prefix}${name}/`, depth - 1);
        }
    };
    for (const mount of mounts) await walk(mount, mount.dir, mount.url, mount.depth);
    return found.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

export async function listModules({ root, mounts = [], assets = [] } = {}) {
    const base = rootOf(root);
    const MOUNTS = mountsFor(base, mounts);
    return (await listFiles(MOUNTS, assetsFor(base, assets, MOUNTS))).map(([url, file]) => ({ url, file }));
}

export async function createModuleServer({ root, dev = false, build, mounts = [], assets = [], rootFiles = {}, static: staticFiles = [], minify } = {}) {
    const base = rootOf(root);
    if (typeof build !== "string" || !build) throw new TypeError("createModuleServer: `build` names this deploy (a non-empty string); it is part of the code id");
    const MOUNTS = mountsFor(base, mounts);
    const ASSETS = assetsFor(base, assets, MOUNTS);
    const ROOT_FILES = rootFilesFor(base, rootFiles, MOUNTS, ASSETS);
    const STATIC = staticFor(base, staticFiles, MOUNTS, ASSETS, ROOT_FILES);
    const { js: minifyScript = minifyJs, css: minifyStyle = minifyCss } = minify === false ? { js: (t) => t, css: (t) => t } : (minify ?? {});
    // The transform, as the code id names it: this server's own version, whether production minifies,
    // and with what (the framework's minifier, or the source text of the app's own).
    const minifier = (given, own) => (given === own ? "juris" : `custom:${String(given)}`);
    const TRANSFORM = `transform ${TRANSFORM_VERSION}; ${minify === false ? "no minify" : `minify js ${minifier(minifyScript, minifyJs)}; css ${minifier(minifyStyle, minifyCss)}`}`;
    const pathOf = (file) => {
        const found = fileFor(file, MOUNTS, ASSETS);
        if (found === null) throw new TypeError(`not a file this module server serves: ${file}`);
        return found;
    };

    // Read once, at start, in production, and served only from there: a file the checkout gained
    // since is not this process's code (the snapshot, above). Development reads the disk on every
    // request.
    const SNAPSHOT = new Map();                           // "/app/boot.js" -> source text
    if (!dev) for (const [url, file] of await listFiles(MOUNTS, ASSETS)) SNAPSHOT.set(url, await readFile(file, "utf8"));
    const sourceOf = async (file) => {
        const onDisk = pathOf(file);
        if (dev) return readFile(onDisk, "utf8");
        if (SNAPSHOT.has(file)) return SNAPSHOT.get(file);
        throw Object.assign(new Error(`${file} is not in the snapshot this server started with: the checkout gained it since`), { code: NOT_STARTED_WITH });
    };
    // The root files, as bytes: not modules, so not in the code id.
    const ROOT_SNAPSHOT = new Map();                      // "/sw.js" -> Buffer
    if (!dev) for (const [url, { file }] of ROOT_FILES) ROOT_SNAPSHOT.set(url, await readFile(file));
    const CODE_ID = createHash("sha256").update([...SNAPSHOT].sort().map(([f, c]) => `${f}\n${c}`).join("\0") + build + "\0" + TRANSFORM).digest("base64url").slice(0, 10);

    // `immutable` is honest only when the URL changes with the bytes: a content hash, plus the code id.
    const hashes = new Map();
    const hashOf = async (file) => {
        if (hashes.has(file)) return hashes.get(file);
        const hash = createHash("sha256").update(await sourceOf(file)).digest("base64url").slice(0, 8);
        if (!dev) hashes.set(file, hash);
        return hash;
    };
    const versioned = async (file) => `${file}?v=${await hashOf(file)}-${CODE_ID}`;

    // The specifiers this server stamps: every relative one, and the absolute ones under a mount or
    // naming an asset that is a module. Each is stamped wherever a browser follows it: after `from`
    // (an import or a re-export), after `import` alone (a module run for its side effects), and as
    // the first argument of `import(…)` (a string, or a template with no substitution), however the
    // source spaces them. One form left out is a second URL for any module also reached by another
    // form, so a second instance of it. Only code is read (the minifier's tokens): a regex over the
    // raw text also rewrote a string, a comment or a template that merely spelled an import, and
    // missed import(`./b.js`), which then loaded under a second URL.
    const SPECIFIER = new RegExp(`^(?:${[
        `\\.{1,2}\\/[^"'\`]+?\\.js`,
        ...MOUNTS.map((mount) => `${escapeRegExp(mount.url)}[^"'\`]+?\\.js`),
        ...[...ASSETS.keys()].filter((url) => url.endsWith(".js")).map(escapeRegExp),
    ].join("|")})$`);
    const stampImports = (source) => {
        const tokens = jsTokens(source);
        const code = tokens.filter((token) => token.type !== "space" && token.type !== "comment");
        const isImport = (token) => token?.type === "word" && token.text === "import" && !token.property;
        const isPunct = (token, text) => token?.type === "punct" && token.text === text;
        for (let k = 0; k < code.length; k++) {
            const token = code[k];
            const plainTemplate = token.type === "template" && !token.open && /^`[^]*`$/.test(token.text);
            if (token.type !== "string" && !plainTemplate) continue;
            const [a, b, next] = [code[k - 1], code[k - 2], code[k + 1]];
            const dynamic = isPunct(a, "(") && isImport(b) && (isPunct(next, ")") || isPunct(next, ","));
            const declared = token.type === "string" && ((a?.type === "word" && a.text === "from" && !a.property) || isImport(a));
            if (!dynamic && !declared) continue;
            const specifier = token.text.slice(1, -1);
            if (SPECIFIER.test(specifier)) token.text = `${token.text[0]}${specifier}?v=${CODE_ID}${token.text[0]}`;
        }
        return tokens.map((token) => token.text).join("");
    };

    const notFound = (res) => { res.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" }); res.end("not found"); return true; };

    // A root file goes out as it is, and a browser asks again on every use (`no-cache`): a service
    // worker that is kept is one that never updates.
    const serveRootFile = async (res, url) => {
        const { file, type, headers } = ROOT_FILES.get(url.pathname);
        const body = dev
            ? await readFile(file).catch((error) => { if (error.code === "ENOENT" || error.code === "EISDIR" || error.code === "ENOTDIR") return null; throw error; })
            : ROOT_SNAPSHOT.get(url.pathname);
        if (body === null) return notFound(res);
        res.writeHead(200, { "content-type": type, "cache-control": "no-cache", ...headers });
        res.end(body);
        return true;
    };

    // A static file goes out as it is on disk, read the first time it is asked for and kept (in
    // production; development reads it every time). Text is gzipped for a browser that asks, and so
    // varies by encoding; a font or a picture is sent one way. A 304 says again what it stands for,
    // and is the answer to a GET or a HEAD alone, as send's is (notModified).
    const kept = new Map();                               // URL path -> packed body
    const serveStatic = async (req, res, url, { file, type, cache }) => {
        let entry = kept.get(url.pathname);
        if (entry === undefined) {
            const body = await readFile(file).catch((error) => {
                if (error.code === "ENOENT" || error.code === "EISDIR" || error.code === "ENOTDIR") return null;
                throw error;
            });
            if (body === null) return notFound(res);
            // Gzipped only when it is ever sent gzipped: a picture, a font or a video is compressed
            // already, and gzipping it anyway stalled the event loop on its first request and kept
            // it twice.
            entry = pack(body, { gzip: compressible(type) });
            if (!dev) kept.set(url.pathname, entry);
        }
        const text = compressible(type);
        const common = { etag: entry.etag, "cache-control": dev ? "no-store" : cache, ...(text ? { vary: "Accept-Encoding" } : {}) };
        if (notModified(req, entry)) {
            res.writeHead(304, common);
            res.end();
            return true;
        }
        const gzip = text && /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");
        res.writeHead(200, { "content-type": type, ...common, ...(gzip ? { "content-encoding": "gzip" } : {}) });
        res.end(gzip ? entry.gz : entry.body);
        return true;
    };

    // What production built, per URL: packed once and kept for the process's life. Development keeps
    // nothing, so each request builds again from the disk.
    const files = new Map();                              // URL path -> packed body
    const handle = async (req, res, url) => {
        if (ROOT_FILES.has(url.pathname)) return serveRootFile(res, url);
        if (fileFor(url.pathname, MOUNTS, ASSETS) === null) {
            const found = staticFileFor(url.pathname, STATIC);
            return found === null ? false : serveStatic(req, res, url, found);
        }
        let entry = files.get(url.pathname);
        if (entry === undefined) {
            // A URL the mounts accept can still name no file (nothing there, a directory, or a path
            // through a file), or, in production, a file this process did not start with. Either is
            // a 404, and says nothing else: the error would carry the path on disk.
            const source = await sourceOf(url.pathname).catch((error) => {
                if (error.code === "ENOENT" || error.code === "EISDIR" || error.code === "ENOTDIR" || error.code === NOT_STARTED_WITH) return null;
                throw error;
            });
            if (source === null) return notFound(res);
            // JS is import-stamped either way; CSS passes through. In production both are then
            // minified, once per file, and kept for the process's life. Development serves the
            // source untouched.
            const isJs = url.pathname.endsWith(".js");
            const stamped = isJs ? stampImports(source) : source;
            const built = dev ? stamped
                : isJs ? minifyScript(stamped)
                : url.pathname.endsWith(".css") ? minifyStyle(stamped)
                : stamped;
            entry = pack(built);
            if (!dev) files.set(url.pathname, entry);
        }
        // Immutable only when the URL names THIS process's code.
        const v = url.searchParams.get("v") ?? "";
        const ours = v === CODE_ID || v.endsWith(`-${CODE_ID}`);
        send(req, res, entry, { type: TYPES[path.extname(url.pathname)] ?? "text/plain", cache: dev ? "no-store" : ours ? "immutable" : "public" });
        return true;
    };

    return {
        handle,
        versioned,
        get codeId() { return CODE_ID; },
        clear() { hashes.clear(); files.clear(); kept.clear(); },
    };
}

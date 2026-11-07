// Development reload: a development server that restarts itself when code it runs changes, and
// reloads the pages open on it when only what browsers load changed.
//
//   const reload = devReload({
//       root,                                  // the app's directory (a path or a file: URL)
//       restartOn: ["server", "app.mjs"],      // code the server runs, relative to root
//       reloadOn: ["client/theme.css"],        // what only browsers load
//       onRestart: (file) => { … },            // replace this process (required)
//       onReload: (file, { clients }) => { … },// forget what was built from the old files (optional)
//   });
//   renderDocument(page, { …, devReload: reload.script });   // the client, at the end of the body
//   if (reload.handle(req, res, url)) return;                // true when it answered /__reload
//   reload.close();                                          // on shutdown
//
// Why each piece exists:
//
// - Restarting, not re-importing. A server loads its code once, and Node has no honest way to load
//   a module again, so the one reload that gives a server its new code is a new process. The
//   framework cannot start one itself (it never touches `process`: only an app's entry does), so
//   `onRestart(file)` is the app's: it starts the successor and lets this process go. It is called
//   once. Whatever this process hears after it is ignored, since it is on its way out.
// - What restarts. Everything under the framework's own directories (the juris package, and the kit's
//   server/, this file's), always, and whatever `restartOn` names. A directory is watched
//   recursively, so a folder made inside it later is covered the moment it exists (`server/` was
//   missed exactly that way by a list of directories); a file is watched through its directory, filtered by name, since
//   editors often save by writing a copy and renaming it over the file, and a watch on the file
//   itself follows the replaced file and hears nothing after the first such save. A watched path
//   that does not exist, or is outside `root`, is refused when this is made.
// - What only reloads. `reloadOn` names files browsers load that the server does not run: a
//   stylesheet, the browser entry. `onReload(file, { clients })` runs first, so the app can move
//   its build id and drop what it rendered, and then every open page is told to reload.
// - One decision per burst. A checkout or a formatter writes several files at once, so changes are
//   gathered until 150 ms pass without one. A burst that touched anything a restart covers restarts,
//   whatever else it touched and in whatever order: a restart reloads the pages too, and a reload
//   would leave the server running the old code.
// - A watcher that fails counts as a change to what it watched. It can no longer say what changed,
//   so the server does what such a change would have made it do; a restart watches everything again.
// - The page's side. `script` is the client, which `renderDocument` writes at the end of the body.
//   It listens at `/__reload` (the path is fixed: pages already open know it) and reloads the page on
//   an explicit `reload` event, or when the `build` event it hears on connecting names another
//   process than the one it heard first. That is how a restart reaches the page: the stream drops,
//   the browser tries again every second, and the process that answers is a new one. Each
//   reloader names its own process with a random id, never the app's build: an app that pins its
//   build (from its environment, say) keeps it across a restart, and the page would not reload.
import { watch as fsWatch, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The framework's own code: the juris package, wherever it is installed, and the kit's server/, this
// directory. Only server/ of the kit: the kit's directory may hold its own node_modules.
const FRAMEWORK_DIRS = [
    path.dirname(fileURLToPath(import.meta.resolve("juris"))),
    path.resolve(fileURLToPath(new URL(".", import.meta.url))),
];

const PATH = "/__reload";
const QUIET_MS = 150;

// The client, as the pages already open have it: a new version of it must still be understood by
// the server they are connected to, and theirs by the new server.
const SCRIPT = `(()=>{const es=new EventSource("${PATH}");let seen=null;
es.addEventListener("reload",()=>location.reload());
es.addEventListener("build",(e)=>{if(seen&&seen!==e.data)location.reload();seen=e.data;});})()`;

const within = (file, dir) => file === dir || file.startsWith(dir + path.sep);

const rootOf = (root) => {
    if (root instanceof URL) return path.resolve(fileURLToPath(root));
    if (typeof root === "string" && root) return path.resolve(root);
    throw new TypeError("devReload: `root` is the directory the watched paths are relative to (a path or a file: URL)");
};

// Each path an app names, checked and resolved: [{ full, label, directory }].
function pathsFor(base, list, name) {
    if (!Array.isArray(list)) throw new TypeError(`devReload: \`${name}\` is a list of paths relative to the root`);
    return list.map((given) => {
        if (typeof given !== "string" || !given) throw new TypeError(`devReload: \`${name}\` holds paths relative to the root, as non-empty strings`);
        if (path.isAbsolute(given)) throw new TypeError(`devReload: ${given} in \`${name}\` is absolute; paths are relative to the root`);
        const full = path.resolve(base, given);
        if (!within(full, base)) throw new TypeError(`devReload: ${given} in \`${name}\` is outside the root`);
        let stats;
        try { stats = statSync(full); } catch { throw new TypeError(`devReload: ${given} in \`${name}\` does not exist under the root`); }
        return { full, label: labelOf(base, full), directory: stats.isDirectory() };
    });
}

// How a file is named to the app's hooks: relative to the root, with `/`, when it is under it.
function labelOf(base, full) {
    return within(full, base) ? path.relative(base, full).split(path.sep).join("/") || "." : full;
}

export function devReload({ root, restartOn = [], reloadOn = [], onRestart, onReload = () => {}, watch = fsWatch } = {}) {
    const base = rootOf(root);
    if (typeof onRestart !== "function") throw new TypeError("devReload: `onRestart(file)` is required: it is the app's entry that replaces this server with a fresh one");
    if (typeof onReload !== "function") throw new TypeError("devReload: `onReload(file, { clients })` is a function, when given");
    if (typeof watch !== "function") throw new TypeError("devReload: `watch` is a function with fs.watch's signature, when given");

    // Checked in full before anything is watched, so a refusal leaves nothing open.
    const named = [
        ...FRAMEWORK_DIRS.map((full) => ({ full, label: labelOf(base, full), directory: true, action: "restart" })),
        ...pathsFor(base, restartOn, "restartOn").map((entry) => ({ ...entry, action: "restart" })),
        ...pathsFor(base, reloadOn, "reloadOn").map((entry) => ({ ...entry, action: "reload" })),
    ];

    const ID = randomBytes(9).toString("base64url");
    const clients = new Set();
    const watchers = [];
    let pending = { restart: null, reload: null };
    let timer = null;
    let restarting = false;
    let closed = false;

    const settle = () => {
        timer = null;
        const { restart, reload } = pending;
        pending = { restart: null, reload: null };
        if (restart !== null) {
            restarting = true;
            onRestart(restart);
            return;
        }
        if (reload === null) return;
        onReload(reload, { clients: clients.size });
        for (const res of clients) res.write("event: reload\ndata: 1\n\n");
    };
    const changed = (action, file) => {
        if (restarting || closed) return;
        pending[action] = file;
        clearTimeout(timer);
        timer = setTimeout(settle, QUIET_MS);
    };

    // A directory: one recursive watch. Files: one flat watch of each directory they are in, with
    // what each name does.
    const directories = named.filter((entry) => entry.directory);
    const files = new Map();                                  // directory -> Map(name -> [{ action, label }])
    for (const entry of named.filter((e) => !e.directory)) {
        const dir = path.dirname(entry.full);
        if (!files.has(dir)) files.set(dir, new Map());
        const names = files.get(dir);
        const name = path.basename(entry.full);
        if (!names.has(name)) names.set(name, []);
        names.get(name).push(entry);
    }
    try {
        for (const { full, label, action } of directories) {
            const watcher = watch(full, { recursive: true }, (_, name) => changed(action, name ? `${label}/${String(name).split(path.sep).join("/")}` : label));
            watcher.on?.("error", () => changed(action, label));
            watchers.push(watcher);
        }
        for (const [dir, names] of files) {
            const every = [...names.values()].flat();
            const watcher = watch(dir, { recursive: false }, (_, name) => {
                // No name: the platform could not say which file, so it may be any of them.
                for (const { action, label } of name ? names.get(String(name)) ?? [] : every) changed(action, label);
            });
            watcher.on?.("error", () => { for (const { action, label } of every) changed(action, label); });
            watchers.push(watcher);
        }
    } catch (error) {
        for (const watcher of watchers) watcher.close();
        throw error;
    }

    // The page's stream. It names this process first; a page that heard another name before
    // reloads. Opened after close(), it gets the same first lines and ends at once, and the browser
    // tries again a second later, by when the next process is listening.
    const handle = (req, res, url) => {
        if (url.pathname !== PATH) return false;
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(`retry: 1000\n\nevent: build\ndata: ${ID}\n\n`);
        if (closed) { res.end(); return true; }
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return true;
    };

    const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        for (const watcher of watchers) watcher.close();
        for (const res of clients) res.end();
        clients.clear();
    };

    return { script: SCRIPT, handle, close };
}

// How an app's entry starts: in this process, or as the primary of several workers on one port.
// Node only; never served. An entry calls it first, before it opens a pool, runs a migration or
// starts a job, because what it refuses must be refused before any of those exist.
//
// startProcess(options) → "serve" | "primary"
//
//   "serve"    this process serves: one worker, or a worker the primary forked
//   "primary"  this process forked the workers and serves nothing itself; the entry says so and
//              stops there
//
// Workers on one port are refused beside live queries. A live query's event stream and the
// subscribe calls that feed it are separate connections, and Node's cluster hands each connection
// to whichever worker is next; the registry of open streams is in memory, in one worker. So the
// subscribe lands on a worker that never minted that client and answers 403: every page still
// renders, since that is the server's own work, and every live query is empty. More than one
// process is served by separate instances behind a balancer that pins a client to one of them.
// `allow` is for an app that knows otherwise (one that has made its live layer cross-worker), and
// an app with no live queries says `liveQueries: false`.
//
// The refusal is decided before anything is forked: a primary that forked first would see each
// worker refuse and exit, and replace it, forever.
//
// When workers are allowed, every one is forked with the same `env` (an app passes its build id,
// so all of them stamp identical module URLs and answer the same build), and a worker id of its
// own in `workerIdEnv` ("1" to n). A worker that exits unasked is replaced with the same `env` and
// the id "r"; one that exits cleanly or on SIGTERM or SIGINT was asked to stop, and is not.
// A replacement waits, and the wait doubles while workers keep dying young: a worker that cannot
// start (the database is down) was replaced at once, forever, and the primary did nothing but fork.
//
// The framework never touches the environment or ends the Node process itself (only an app's entry
// does), so the entry passes both in: the values it read (`workers`, `allow`, `env`), and `exit`,
// its own way to stop. Without an `exit`, a refusal is thrown instead, which stops an entry that
// calls this at its top level just the same, with the message and exit code 1.
import nodeCluster from "node:cluster";

// What the refusal says when the app does not say it in its own words, which can name the setting
// that asked for workers and the one that overrides this.
const defaultRefusal = (workers) => [
    `${workers} workers on one port would break live queries: a client's event stream and its`,
    "  subscribe calls are separate connections, which land on different workers, so every live",
    "  query answers 403. Run several instances behind a sticky balancer instead, or one worker.",
].join("\n");

// startProcess(options):
//   workers        how many workers to run on this port (a number; anything not above 1 is one)
//   liveQueries    whether the app serves live queries (true unless told)
//   allow          run workers beside live queries anyway
//   env            what every worker is forked with, beside the primary's own environment
//   workerIdEnv    the name of the variable that carries each worker's id, or null for none
//   refusal        the message, a string or (workers) → string
//   exit(code)     the entry's way to stop; without one, a refusal is thrown
//   onWorkerExit(worker, code, signal)   a worker exited unasked, before it is replaced (logged
//                                        through `log.log` unless given)
//   log            where the refusal and the replacements are written (console unless given)
//   backoff        { minMs = 1000, maxMs = 30000, resetAfterMs = 30000 }: a replacement waits minMs,
//                  twice that after the next crash, and so on up to maxMs; a worker that ran at
//                  least resetAfterMs before it died starts the count over
//   cluster        Node's cluster, unless a test gives another
//   timers         { setTimeout, now }, unless a test gives others
export function startProcess({
    workers = 1,
    liveQueries = true,
    allow = false,
    env = {},
    workerIdEnv = null,
    refusal = defaultRefusal,
    exit = null,
    onWorkerExit = null,
    log = console,
    backoff = {},
    cluster = nodeCluster,
    timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), now: () => Date.now() },
} = {}) {
    if (env === null || typeof env !== "object") throw new TypeError("startProcess: env is the variables every worker is forked with, an object");
    if (workerIdEnv !== null && typeof workerIdEnv !== "string") throw new TypeError("startProcess: workerIdEnv is a variable's name, or null");
    if (exit !== null && typeof exit !== "function") throw new TypeError("startProcess: exit is a function, the entry's own way to stop");
    const many = workers > 1;
    const { minMs = 1000, maxMs = 30000, resetAfterMs = 30000 } = backoff ?? {};
    for (const [name, value] of Object.entries({ minMs, maxMs, resetAfterMs })) {
        if (!Number.isInteger(value) || value < 0) throw new TypeError(`startProcess: backoff.${name} is a whole number of milliseconds, not ${String(value)}`);
    }

    if (many && liveQueries && !allow) {
        const message = typeof refusal === "function" ? refusal(workers) : String(refusal);
        if (exit) {
            log.error(message);
            exit(1);
        }
        // A real exit does not return. If this one did, or there is none, the entry must still not
        // go on to fork or serve.
        throw new Error(message);
    }

    if (!many || !cluster.isPrimary) return "serve";

    // When each worker was forked, so its exit says how long it lived.
    const born = new WeakMap();
    const fork = (id) => {
        const worker = cluster.fork(workerIdEnv ? { ...env, [workerIdEnv]: id } : { ...env });
        if (worker !== null && typeof worker === "object") born.set(worker, timers.now());
        return worker;
    };
    for (let i = 0; i < workers; i++) fork(String(i + 1));
    let delay = minMs;
    cluster.on("exit", (worker, code, signal) => {
        if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") return;   // asked to stop
        // One that lived a while died of something that is not the start itself: the count starts over.
        const since = worker !== null && typeof worker === "object" ? born.get(worker) : undefined;
        if (since !== undefined && timers.now() - since >= resetAfterMs) delay = minMs;
        const wait = delay;
        delay = Math.min(maxMs, Math.max(delay * 2, 1));
        if (onWorkerExit) onWorkerExit(worker, code, signal);
        else log.log(`  worker ${worker.id} exited (${signal ?? code}), replacing it in ${wait / 1000} s`);
        timers.setTimeout(() => fork("r"), wait);
    });
    return "primary";
}

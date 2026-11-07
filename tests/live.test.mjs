// The live layer: the event stream and subscribe path of the dispatcher, the diff both ends
// compute, the change buses, the database adapters' transactions, and the primary's replacements.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { serviceDispatcher } from "../server/service-dispatcher.js";
import { diff, canAddress, liveKey, LIVE_CODES } from "juris/live-protocol.js";
import { createPgOutboxBus } from "../server/bus/pg-outbox.js";
import { createOutboxBus } from "../server/bus/mysql-outbox.js";
import { fromPg, fromMysql2, fromMariadb } from "../server/db.js";
import { startProcess } from "../server/process.js";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (check, ms = 1000) => {
    const end = Date.now() + ms;
    while (!check()) {
        if (Date.now() > end) return false;
        await tick(2);
    }
    return true;
};

const unhandled = [];
process.on("unhandledRejection", (error) => unhandled.push(error));

// A real server around a dispatcher. A rejection out of the handler is what a host would answer 500
// to; it is recorded, so a test can say there was none.
async function serve(handler) {
    const failures = [];
    const server = http.createServer((req, res) => {
        Promise.resolve(handler(req, res)).then(
            (handled) => { if (!handled) { res.statusCode = 404; res.end(); } },
            (error) => { failures.push(error); if (!res.headersSent) res.statusCode = 500; res.end(); });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    return {
        port,
        failures,
        connections: () => new Promise((resolve) => server.getConnections((_, n) => resolve(n))),
        close: () => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); },
    };
}

// Opens the event stream and resolves at its hello (or at once for a refusal).
function openStream(port, client) {
    return new Promise((resolve) => {
        const path = `/api/events${client ? `?client=${encodeURIComponent(client)}` : ""}`;
        const req = http.request({ port, host: "127.0.0.1", path, agent: false });
        req.on("error", () => { });
        req.on("response", (res) => {
            const stream = { req, res, status: res.statusCode, events: [], ended: false, id: null };
            stream.done = new Promise((done) => {
                const end = () => { stream.ended = true; done(); };
                res.on("end", end);
                res.on("close", end);
            });
            if (res.statusCode !== 200) { res.resume(); resolve(stream); return; }
            let buffer = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
                buffer += chunk;
                let at;
                while ((at = buffer.indexOf("\n\n")) >= 0) {
                    const block = buffer.slice(0, at);
                    buffer = buffer.slice(at + 2);
                    const event = /^event: (.*)$/m.exec(block)?.[1];
                    const data = /^data: (.*)$/m.exec(block)?.[1];
                    if (event === "hello") { stream.id = JSON.parse(data).client; resolve(stream); }
                    else if (event) stream.events.push({ event, data: JSON.parse(data) });
                }
            });
        });
        req.end();
    });
}

const post = async (port, path, body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { }
    return { status: response.status, body: json };
};
const subscribe = (port, client, name, args = []) =>
    post(port, "_live", { client, subscribe: { key: liveKey(name, args), name, args } });

// ---- F13: one client id, one socket --------------------------------------------------------------

test("F13: a reconnect with the same client id ends the stream it replaces", async () => {
    const handler = serviceDispatcher({ q: () => 1 }, "/api", { live: { queries: ["q"], public: true, maxStreamsPerCaller: 2 } });
    const host = await serve(handler);
    try {
        const first = await openStream(host.port);
        assert.equal(first.status, 200);
        const replaced = [first];
        let last = first;
        for (let i = 0; i < 4; i++) {
            last = await openStream(host.port, first.id);
            assert.equal(last.status, 200);
            assert.equal(last.id, first.id);
            replaced.push(last);
        }
        replaced.pop();
        await Promise.race([Promise.all(replaced.map((stream) => stream.done)), tick(1000)]);
        for (const stream of replaced) assert.equal(stream.ended, true, "a replaced stream is ended");
        assert.equal(last.ended, false);
        assert.equal(handler.stats().connected, 1);
        for (let i = 0; i < 100 && (await host.connections()) !== 1; i++) await tick(5);
        assert.equal(await host.connections(), 1, "one socket for the one client id");
        // The old streams' close must not drop the live one's client.
        await tick(20);
        assert.equal(handler.stats().clients, 1);
        const other = await openStream(host.port);
        assert.equal(other.status, 200);
    } finally {
        handler.close();
        await host.close();
    }
});

// ---- F14: a stream aborted while identify runs -----------------------------------------------------

test("F14: a stream request aborted during identify creates no client and leaves room for the next", async () => {
    let hold = true;
    let release;
    let asked;
    const askedOnce = new Promise((resolve) => { asked = resolve; });
    const identify = () => {
        if (!hold) return "owner-1";
        asked();
        return new Promise((resolve) => { release = resolve; });
    };
    const handler = serviceDispatcher({ q: () => 1 }, "/api", { live: { queries: ["q"], public: true, identify, maxStreamsPerCaller: 1 } });
    const host = await serve(handler);
    try {
        const req = http.request({ port: host.port, host: "127.0.0.1", path: "/api/events", agent: false });
        req.on("error", () => { });
        req.end();
        await askedOnce;
        req.destroy();
        await tick(30);
        hold = false;
        release("owner-1");
        await tick(30);
        assert.equal(handler.stats().connected, 0);
        assert.equal(handler.stats().clients, 0);
        const next = await openStream(host.port);
        assert.equal(next.status, 200, "the aborted stream holds no place under the ceiling");
        assert.deepEqual(host.failures, []);
    } finally {
        handler.close();
        await host.close();
    }
});

// ---- F15: the grace period expiring while authorize runs -----------------------------------------

test("F15: a client dropped by its grace period during authorize leaves no orphan group", async () => {
    const handler = serviceDispatcher({ q: () => 1 }, "/api", {
        live: { queries: ["q"], graceMs: 40, authorize: async () => { await tick(150); return true; } },
    });
    const host = await serve(handler);
    try {
        const stream = await openStream(host.port);
        stream.req.destroy();
        await tick(10);
        const answer = await subscribe(host.port, stream.id, "q");
        assert.equal(answer.status, 403);
        assert.equal(answer.body.code, LIVE_CODES.CLIENT_UNKNOWN);
        await tick(20);
        assert.equal(handler.stats().groups, 0);
        assert.equal(handler.stats().subscriptions, 0);
        assert.equal(handler.stats().clients, 0);
    } finally {
        handler.close();
        await host.close();
    }
});

// ---- F16: invalidateAccess with recheckMs 0 ------------------------------------------------------

test("F16: invalidateAccess re-asks authorize even with recheckMs: 0", async () => {
    let allowed = true;
    let asked = 0;
    const handler = serviceDispatcher({ q: () => 1 }, "/api", {
        live: { queries: ["q"], recheckMs: 0, authorize: () => { asked += 1; return allowed; } },
    });
    const host = await serve(handler);
    try {
        const stream = await openStream(host.port);
        assert.equal((await subscribe(host.port, stream.id, "q")).status, 200);
        assert.equal(handler.stats().subscriptions, 1);
        allowed = false;
        const before = asked;
        const dropped = await handler.invalidateAccess(() => true);
        assert.equal(asked, before + 1, "authorize was asked");
        assert.equal(dropped, 1);
        assert.equal(handler.stats().subscriptions, 0);
        assert.ok(await until(() => stream.events.some((e) => e.data.error === "not allowed")));
    } finally {
        handler.close();
        await host.close();
    }
});

test("F16: recheckMs: 0 still turns the periodic re-check off", async () => {
    let asked = 0;
    let value = 1;
    const handler = serviceDispatcher({ q: () => value }, "/api", {
        live: { queries: ["q"], recheckMs: 0, authorize: () => { asked += 1; return true; } },
    });
    const host = await serve(handler);
    try {
        const stream = await openStream(host.port);
        await subscribe(host.port, stream.id, "q");
        const before = asked;
        value = 2;
        await handler.invalidate("q");
        assert.equal(asked, before, "a patch asks nothing when the periodic re-check is off");
    } finally {
        handler.close();
        await host.close();
    }
});

// ---- F17: the diff's keys ------------------------------------------------------------------------

test("F17: an own key \"\" is not addressable, so the object is sent whole at its own path", () => {
    assert.equal(canAddress({ "": 1 }), false);
    assert.deepEqual(diff({ "": 1, a: 1 }, { "": 2, a: 1 }), { set: [["", { "": 2, a: 1 }]], del: [] });
    assert.deepEqual(diff({ x: { "": 1 }, y: 1 }, { x: { "": 2 }, y: 1 }), { set: [["x", { "": 2 }]], del: [] });
    assert.deepEqual(diff({ x: { "": 1 } }, { x: {} }), { set: [["x", {}]], del: [] });
});

test("F17: a removed key named after an Object.prototype member is deleted", () => {
    assert.deepEqual(diff({ constructor: 1, a: 1 }, { a: 1 }), { set: [], del: ["constructor"] });
    assert.deepEqual(diff({ row: { toString: "x", hasOwnProperty: 2 } }, { row: {} }), { set: [], del: ["row.toString", "row.hasOwnProperty"] });
});

test("F17: ordinary diffs are unchanged", () => {
    assert.deepEqual(diff({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } }), { set: [["b.c", 3]], del: [] });
    assert.deepEqual(diff({ a: 1, b: 2 }, { a: 1 }), { set: [], del: ["b"] });
    assert.deepEqual(diff([1, 2], [1, 3]), { set: [["1", 3]], del: [] });
    assert.deepEqual(diff([1, 2], [1, 2, 3]), { set: [["", [1, 2, 3]]], del: [] });
    assert.deepEqual(diff({ "a.b": 1 }, { "a.b": 2 }), { set: [["", { "a.b": 2 }]], del: [] });
    assert.deepEqual(diff(1, 1), { set: [], del: [] });
    assert.equal(canAddress({ a: 1 }), true);
});

// ---- F18: the bus never holds this instance's own updates back -----------------------------------

test("F18: a publish that never resolves does not hold local re-runs back", async () => {
    let runs = 0;
    const handler = serviceDispatcher({ q: () => ++runs }, "/api", {
        live: { queries: ["q"], public: true, bus: { publish: () => new Promise(() => { }), subscribe: () => { } } },
    });
    const host = await serve(handler);
    try {
        const stream = await openStream(host.port);
        await subscribe(host.port, stream.id, "q");
        assert.ok(await until(() => runs === 1));
        handler.invalidate("q");
        assert.ok(await until(() => runs === 2, 300), "the re-run happened without waiting for publish");
        assert.ok(await until(() => stream.events.some((e) => e.data.set)));
    } finally {
        handler.close();
        await host.close();
    }
});

test("F18: bus delivery does not wait for the re-runs it causes, and failures are reported", async () => {
    let deliver;
    let calls = 0;
    const errors = [];
    const handler = serviceDispatcher({ q: () => (++calls === 1 ? 1 : new Promise(() => { })) }, "/api", {
        live: { queries: ["q"], public: true, bus: { publish: async () => { }, subscribe: (fn) => { deliver = fn; } } },
        onError: (error, where) => errors.push(where),
    });
    const host = await serve(handler);
    try {
        const stream = await openStream(host.port);
        await subscribe(host.port, stream.id, "q");
        assert.ok(await until(() => calls === 1));
        const outcome = await Promise.race([Promise.resolve(deliver(["q"])).then(() => "applied"), tick(200).then(() => "stalled")]);
        assert.equal(outcome, "applied");
        assert.equal(calls, 2, "the re-run was started");
    } finally {
        handler.close();
        await host.close();
    }
});

// ---- F19: touches run whatever happens to the answer ---------------------------------------------

test("F19: a committed mutation whose result cannot be sent still runs its touches", async () => {
    const told = [];
    const handler = serviceDispatcher({ q: () => 1, m: () => 1n }, "/api", {
        live: { queries: ["q"], public: true, touches: { m: ["q"] }, onInvalidate: (targets) => told.push(targets) },
    });
    const host = await serve(handler);
    try {
        const answer = await post(host.port, "m", []);
        assert.ok(answer.status >= 400);
        assert.ok(await until(() => told.length === 1), "the touches ran");
        assert.deepEqual(told[0], ["q"]);
        assert.deepEqual(host.failures, []);
    } finally {
        handler.close();
        await host.close();
    }
});

test("F19: a live query whose result JSON cannot carry is reported, never an unhandled rejection", async () => {
    const errors = [];
    const handler = serviceDispatcher({ q: () => ({ n: 1n }) }, "/api", {
        live: { queries: ["q"], public: true },
        onError: (error, where) => errors.push({ error, where }),
    });
    const host = await serve(handler);
    const before = unhandled.length;
    try {
        const stream = await openStream(host.port);
        assert.equal((await subscribe(host.port, stream.id, "q")).status, 200);
        assert.ok(await until(() => errors.length >= 1));
        assert.equal(errors[0].where, "q");
        assert.ok(errors[0].error instanceof TypeError);
        assert.ok(await until(() => stream.events.some((e) => e.data.error)), "the subscriber is told it failed");
        await handler.invalidate("q");
        assert.ok(errors.length >= 2);
        await tick(20);
        assert.deepEqual(host.failures, []);
        assert.equal(unhandled.length, before);
    } finally {
        handler.close();
        await host.close();
    }
});

// ---- F20: the Postgres LISTEN connection ---------------------------------------------------------

function fakePg({ connectFailures = 0, listenFailures = 0 } = {}) {
    const pool = {
        connectFailures,
        listenFailures,
        connects: 0,
        clients: [],
        queries: [],
        async query(sql) {
            pool.queries.push(sql);
            if (/MAX\(id\)/.test(sql)) return { rows: [{ id: 0 }] };
            return { rows: [] };
        },
        async connect() {
            pool.connects += 1;
            if (pool.connectFailures > 0) { pool.connectFailures -= 1; throw new Error("connection refused"); }
            const client = new EventEmitter();
            client.queries = [];
            client.released = [];
            client.query = async (sql) => {
                client.queries.push(sql);
                if (/^LISTEN/.test(sql) && pool.listenFailures > 0) { pool.listenFailures -= 1; throw new Error("LISTEN failed"); }
                return { rows: [] };
            };
            client.release = (arg) => { client.released.push(arg ?? null); };
            pool.clients.push(client);
            return client;
        },
    };
    return pool;
}

test("F20: a failed start leaves the bus startable again", async () => {
    const pool = fakePg({ connectFailures: 1 });
    const bus = createPgOutboxBus({ pool, targets: {}, onError: () => { } });
    await assert.rejects(bus.start());
    await bus.start();
    assert.equal(pool.connects, 2);
    assert.ok(pool.clients.at(-1).queries.some((sql) => /^LISTEN/.test(sql)));
    await bus.stop();
});

test("F20: a LISTEN that throws releases (and destroys) the client it checked out", async () => {
    const pool = fakePg({ listenFailures: 1 });
    const bus = createPgOutboxBus({ pool, targets: {}, onError: () => { } });
    await assert.rejects(bus.start());
    assert.equal(pool.clients[0].released.length, 1);
    assert.ok(pool.clients[0].released[0], "released with an error, so the pool destroys it");
    await bus.start();
    await bus.stop();
    assert.equal(pool.clients[1].released.length, 1);
});

test("F20: a dropped LISTEN connection is retried with backoff until it is back", async () => {
    const pool = fakePg();
    const errors = [];
    const bus = createPgOutboxBus({ pool, targets: {}, reconnectMs: 1, onError: (error) => errors.push(error) });
    await bus.start();
    pool.connectFailures = 3;
    pool.listenFailures = 1;
    const reads = pool.queries.length;
    pool.clients[0].emit("error", new Error("terminated"));
    assert.deepEqual(pool.clients[0].released, [true]);
    assert.ok(await until(() => pool.clients.length === 3 && pool.clients[2].queries.includes("LISTEN change_events"), 2000), "reconnected");
    assert.equal(pool.connects, 1 + 3 + 2);
    assert.ok(pool.clients[1].released[0], "the client whose LISTEN failed was released");
    assert.ok(await until(() => pool.queries.length > reads), "read after reconnecting");
    await bus.stop();
});

test("F20: stop ends the reconnect attempts", async () => {
    const pool = fakePg();
    const bus = createPgOutboxBus({ pool, targets: {}, reconnectMs: 1, onError: () => { } });
    await bus.start();
    pool.connectFailures = Infinity;
    pool.clients[0].emit("error", new Error("terminated"));
    assert.ok(await until(() => pool.connects >= 3));
    await bus.stop();
    const connects = pool.connects;
    await tick(50);
    assert.equal(pool.connects, connects);
});

// ---- the rows say their columns ------------------------------------------------------------------

test("db: pg and mysql2 rows carry their column names, not enumerable, even with no rows", async () => {
    const fields = [{ name: "lot_no" }, { name: "qty" }];
    const pgPool = { query: async () => ({ rows: [], fields }), connect: async () => ({ query: async () => ({ rows: [{ lot_no: "1", qty: 2 }], fields }), release() {} }) };
    const empty = await fromPg(pgPool).query("SELECT lot_no, qty FROM lot WHERE false");
    assert.deepEqual(empty.fields, ["lot_no", "qty"]);
    assert.deepEqual(Object.keys(empty), [], "not enumerable");
    const inTx = await fromPg(pgPool).transaction((tx) => tx.query("SELECT lot_no, qty FROM lot"));
    assert.deepEqual(inTx.fields, ["lot_no", "qty"]);
    assert.equal(JSON.stringify(inTx), '[{"lot_no":"1","qty":2}]', "serializes as before");
    const mysql = await fromMysql2({ query: async () => [[], fields] }).query("SELECT lot_no, qty FROM lot WHERE false");
    assert.deepEqual(mysql.fields, ["lot_no", "qty"]);
    const write = await fromMysql2({ query: async () => [{ affectedRows: 1 }, undefined] }).query("UPDATE lot SET qty = 1");
    assert.equal(write.affectedRows, 1, "a write's answer is left as the driver gave it");
});

// ---- F26: a transaction whose ROLLBACK fails -----------------------------------------------------

test("F26: pg: a failed ROLLBACK destroys the client instead of pooling it", async () => {
    const released = [];
    const client = {
        query: async (sql) => { if (sql === "ROLLBACK") throw new Error("connection lost"); return { rows: [] }; },
        release: (arg) => released.push(arg),
    };
    const db = fromPg({ connect: async () => client });
    const failure = new Error("the transaction's own");
    await assert.rejects(db.transaction(async () => { throw failure; }), (error) => error === failure);
    assert.equal(released.length, 1);
    assert.ok(released[0] instanceof Error, "release(error) destroys the client");
});

test("F26: pg: a transaction rolled back cleanly releases the client normally", async () => {
    const released = [];
    const client = { query: async () => ({ rows: [] }), release: (arg) => released.push(arg) };
    const db = fromPg({ connect: async () => client });
    await assert.rejects(db.transaction(async () => { throw new Error("no"); }));
    assert.deepEqual(released, [undefined]);
    assert.equal(await db.transaction(async () => 7), 7);
    assert.deepEqual(released, [undefined, undefined]);
});

for (const [label, from] of [["mysql2", fromMysql2], ["mariadb", fromMariadb]]) {
    test(`F26: ${label}: a failed rollback destroys the connection instead of pooling it`, async () => {
        const calls = [];
        const conn = {
            beginTransaction: async () => { },
            commit: async () => { },
            rollback: async () => { throw new Error("connection lost"); },
            query: async () => [[]],
            release: () => calls.push("release"),
            destroy: () => calls.push("destroy"),
        };
        const db = from({ getConnection: async () => conn });
        const failure = new Error("the transaction's own");
        await assert.rejects(db.transaction(async () => { throw failure; }), (error) => error === failure);
        assert.deepEqual(calls, ["destroy"]);
    });
    test(`F26: ${label}: a clean rollback releases the connection`, async () => {
        const calls = [];
        const conn = {
            beginTransaction: async () => { },
            commit: async () => { },
            rollback: async () => { },
            query: async () => [[]],
            release: () => calls.push("release"),
            destroy: () => calls.push("destroy"),
        };
        const db = from({ getConnection: async () => conn });
        await assert.rejects(db.transaction(async () => { throw new Error("no"); }));
        assert.deepEqual(calls, ["release"]);
    });
}

// ---- F26: a crashing worker is replaced with backoff ---------------------------------------------

function fakeCluster() {
    const cluster = new EventEmitter();
    cluster.isPrimary = true;
    cluster.forks = [];
    cluster.fork = (env) => {
        const worker = { id: cluster.forks.length + 1, env };
        cluster.forks.push(worker);
        return worker;
    };
    return cluster;
}
function fakeTimers() {
    const timers = { clock: 0, pending: [] };
    timers.setTimeout = (fn, ms) => { timers.pending.push({ fn, ms }); return timers.pending.length; };
    timers.now = () => timers.clock;
    timers.runNext = () => { const next = timers.pending.shift(); timers.clock += next.ms; next.fn(); return next.ms; };
    return timers;
}

test("F26: a worker that keeps crashing is replaced after a delay that doubles to 30 s", () => {
    const cluster = fakeCluster();
    const timers = fakeTimers();
    const log = { log: () => { }, error: () => { } };
    assert.equal(startProcess({ workers: 2, liveQueries: false, cluster, timers, log }), "primary");
    assert.equal(cluster.forks.length, 2);
    const delays = [];
    for (let i = 0; i < 7; i++) {
        cluster.emit("exit", cluster.forks.at(-1), 1, null);
        assert.equal(cluster.forks.length, 2 + i, "not replaced at once");
        delays.push(timers.runNext());
        assert.equal(cluster.forks.length, 3 + i);
        assert.equal(cluster.forks.at(-1).env.constructor, Object);
    }
    assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    // A worker that has run a while before it crashed starts the backoff over.
    timers.clock += 5 * 60_000;
    cluster.emit("exit", cluster.forks.at(-1), 1, null);
    assert.equal(timers.runNext(), 1000);
    // Asked to stop: not replaced at all.
    cluster.emit("exit", cluster.forks.at(-1), 0, null);
    cluster.emit("exit", cluster.forks.at(-1), null, "SIGTERM");
    assert.equal(timers.pending.length, 0);
});

// ---- the MariaDB bus's poll lock -----------------------------------------------------------------

test("mysql-outbox: a full batch does not let a second poll run beside the first, and stop waits for it", async () => {
    let id = 0;
    let fetches = 0;
    let delivering = 0;
    let most = 0;
    let gate = null;
    const db = {
        async query(sql) {
            if (/MAX\(id\)/.test(sql)) return [{ id: 0 }];
            if (/WHERE id >/.test(sql)) { fetches += 1; id += 1; return [{ id, entity: "e", entity_id: String(id), payload: null, created_at: new Date() }]; }
            return [];
        },
    };
    const bus = createOutboxBus({ db, targets: { e: (x) => ({ name: "q", args: [x] }) }, batchSize: 1, intervalMs: 1e6 });
    bus.subscribe(async () => {
        delivering += 1;
        most = Math.max(most, delivering);
        await (gate ?? tick(5));
        delivering -= 1;
    });
    await bus.start();
    let open;
    gate = new Promise((resolve) => { open = resolve; });
    bus.poll();
    await tick(30);
    assert.equal(fetches, 1, "no second poll while the first is still delivering");
    gate = null;
    open();
    await until(() => fetches >= 4);
    await bus.stop();
    assert.equal(delivering, 0, "stop resolved with no poll running");
    const after = fetches;
    await tick(20);
    assert.equal(fetches, after);
    assert.equal(most, 1);
});

// ---- numeric live options ------------------------------------------------------------------------

test("live's numeric options are whole numbers, refused at construction otherwise", () => {
    const make = (extra) => serviceDispatcher({ q: () => 1 }, "/api", { live: { queries: ["q"], public: true, ...extra } });
    for (const bad of [{ keepAlive: 0 }, { keepAlive: "1000" }, { maxGroups: "5" }, { graceMs: -1 }, { recheckMs: 1.5 },
        { maxStreamsPerCaller: NaN }, { maxKeysPerClient: 0 }, { maxBufferBytes: -5 }, { maxPostsPerMinute: "x" }, { maxGroupsPerCaller: "256" }, { keepAlive: 2 ** 31 }]) {
        assert.throws(() => make(bad), TypeError, JSON.stringify(bad));
    }
    for (const good of [{ keepAlive: 1000 }, { maxGroups: 5 }, { graceMs: 0 }, { recheckMs: 0 }, { maxStreamsPerCaller: 0 },
        { maxPostsPerMinute: Infinity }, { maxBufferBytes: 1 }]) {
        make(good).close();
    }
});

// ---- default mode: a touches target's name is subscribable, not the target -----------------------

test("default mode makes the NAME of an object touches target subscribable", async () => {
    const handler = serviceDispatcher({ q: () => 1, m: () => 1 }, "/api", {
        live: { public: true, touches: { m: [{ name: "q", args: [1] }] } },
    });
    const host = await serve(handler);
    try {
        const stream = await openStream(host.port);
        assert.equal((await subscribe(host.port, stream.id, "q", [1])).status, 200);
    } finally {
        handler.close();
        await host.close();
    }
});

// ---- the forms path ------------------------------------------------------------------------------

test("forms: an upload aborted mid-body does not reject out of the dispatcher", async () => {
    const handler = serviceDispatcher({ f: () => 1 }, "/api", { forms: { allow: ["f"], redirect: () => "/done" } });
    const host = await serve(handler);
    try {
        const req = http.request({
            port: host.port, host: "127.0.0.1", path: "/api/f", method: "POST", agent: false,
            headers: { "content-type": "application/x-www-form-urlencoded", origin: `http://127.0.0.1:${host.port}`, "content-length": 1000 },
        });
        req.on("error", () => { });
        req.write("a=1&b=");
        await tick(30);
        req.destroy();
        await tick(50);
        assert.deepEqual(host.failures, []);
    } finally {
        handler.close();
        await host.close();
    }
});

test("a thrown status that is no HTTP error status answers 500", async () => {
    const thrower = (status) => () => { throw Object.assign(new Error("no"), { status }); };
    const handler = serviceDispatcher({ s999: thrower(999), s302: thrower(302), sText: thrower("bad"), s404: thrower(404), s418: thrower(418), s0: thrower(0) }, "/api");
    const host = await serve(handler);
    try {
        assert.equal((await post(host.port, "s999", [])).status, 500);
        assert.equal((await post(host.port, "s302", [])).status, 500);
        assert.equal((await post(host.port, "sText", [])).status, 500);
        assert.equal((await post(host.port, "s0", [])).status, 500);
        assert.equal((await post(host.port, "s404", [])).status, 404);
        assert.equal((await post(host.port, "s418", [])).status, 418);
        assert.equal((await handler.invoke("s999", [])).status, 500);
        assert.deepEqual(host.failures, []);
    } finally {
        handler.close();
        await host.close();
    }
});

// ---- a refusal before the body has arrived whole closes the connection ---------------------------------

test("a refusal answered before the body has arrived whole says connection: close, and the socket ends with it", async () => {
    const handler = serviceDispatcher({ f: () => 1 }, "/api", {});
    const host = await serve(handler);
    // Keep-alive from the client's side, so a `connection: close` in the answer is the server's word alone.
    const agent = new http.Agent({ keepAlive: true });
    // A body sent in pieces, the answer taken as it comes (the server may answer while the body is still on
    // its way; a write that fails after that is the connection going, which is the point).
    const sendBody = (path, headers, total) => new Promise((resolve) => {
        const req = http.request({ port: host.port, host: "127.0.0.1", path, method: "POST", agent, headers: { ...headers, "content-length": total } });
        req.on("error", () => { });
        req.on("response", (res) => {
            const socket = res.socket;   // detached from `res` once the agent takes it back: hold it to look later
            res.resume();
            res.on("end", () => setTimeout(() => resolve({ status: res.statusCode, connection: res.headers.connection, destroyed: socket.destroyed }), 100));
        });
        const piece = Buffer.alloc(64 * 1024, 120);
        let sent = 0;
        const write = () => {
            while (sent < total) {
                const n = Math.min(piece.length, total - sent);
                sent += n;
                if (!req.write(piece.subarray(0, n))) return req.once("drain", write);
            }
            req.end();
        };
        write();
    });
    try {
        // 1.5 MB against the default limit of 1 MB: refused part-way, and the connection ends with the answer
        const tooLarge = await sendBody("/api/f", { "content-type": "application/json" }, 1_500_000);
        assert.equal(tooLarge.status, 413);
        assert.equal(tooLarge.connection, "close");
        assert.equal(tooLarge.destroyed, true, "the socket is closed after a 413 part-way through the body");
        // the wrong type, refused before the body is read: the same
        const wrongType = await sendBody("/api/f", { "content-type": "text/plain" }, 100_000);
        assert.equal(wrongType.status, 415);
        assert.equal(wrongType.connection, "close");
        assert.equal(wrongType.destroyed, true, "the socket is closed after a 415 with a body still to come");
        // a body read whole, refused for another reason: the connection is kept, as before
        const whole = await new Promise((resolve) => {
            const req = http.request({ port: host.port, host: "127.0.0.1", path: "/api/nothere", method: "POST", agent, headers: { "content-type": "application/json" } });
            req.on("response", (res) => { const socket = res.socket; res.resume(); res.on("end", () => setTimeout(() => resolve({ status: res.statusCode, connection: res.headers.connection, destroyed: socket.destroyed }), 100)); });
            req.end("[1]");
        });
        assert.equal(whole.status, 404);
        assert.notEqual(whole.connection, "close");
        assert.equal(whole.destroyed, false, "a refusal after the whole body keeps the connection");
        assert.deepEqual(host.failures, []);
    } finally {
        agent.destroy();
        await host.close();
    }
});

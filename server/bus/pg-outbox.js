// The same change bus as ./mysql-outbox.js, on PostgreSQL instead of MariaDB.
//
// The difference that matters: Postgres has LISTEN/NOTIFY, so an instance is woken by the database the
// moment a change commits instead of discovering it on its next poll. MariaDB has no equivalent, which
// is why its feeder polls at a fixed interval and pays that interval in latency and in query load.
//
// NOTIFY alone is not enough, though, and a bus built on it alone drops changes:
//   - a notification is delivered only to sessions listening AT THAT MOMENT, so anything published while
//     an instance is restarting, failing over or reconnecting is gone;
//   - it is not persisted and cannot be replayed.
// So this keeps the outbox table as the source of truth and uses NOTIFY purely as a doorbell: the
// listener wakes, reads the table, and a slow sweep runs anyway to catch whatever the doorbell missed.
//
// Usage:
//   await pool.query(SCHEMA);                     // or schemaFor({ table, channel }), once, at migration
//   const bus = createPgOutboxBus({ pool, targets: { chat: (id) => ({ name: "chat", args: [id] }) } });
//   const handler = serviceDispatcher(services, "/api", { live: { queries, touches, bus } });
//   await bus.start();
//   setInterval(() => bus.prune().catch(report), 10 * 60_000).unref();   // the table is not history

import { fromPg } from "../db.js";

// The default names are shared by every instance that reads the table, old builds included while a
// deploy is half rolled, so they never change: a bus on another table or channel reaches only the
// instances given the same.
export const CHANGE_TABLE = "change_events";
export const CHANNEL = "change_events";

// How long `prune` keeps a row unless told otherwise: far past any reader's lookback.
export const PRUNE_AFTER_MS = 60 * 60_000;

// A table or channel name is written into the DDL, into the bus's queries, and into a string literal,
// as it is: anything but a plain identifier is refused rather than quoted. And it is lowercase,
// because the two ends of the doorbell treat case differently: the trigger's pg_notify('<channel>')
// sends the string exactly as written, while the bus's unquoted LISTEN <channel> is folded to
// lowercase. A capital would notify one channel and listen on another, and every change would wait
// for the sweep. schemaFor and the bus both check, since either may be given the name alone.
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const identifier = (name, what, who) => {
    if (typeof name !== "string" || !IDENTIFIER.test(name)) throw new TypeError(`${who}: ${what} must be a lowercase SQL identifier (a-z, 0-9, _; Postgres folds an unquoted name to lowercase, but not the channel pg_notify is given), not ${JSON.stringify(name)}`);
    return name;
};

// The table, its index, and the trigger that turns every committed row into a notification on
// `channel` (by default the table's own name, as the bus's `channel` is). `pg_notify` inside an AFTER
// INSERT trigger fires at COMMIT, not at INSERT, so a listener never hears about a change that then
// rolls back. The index, the function and the trigger are named after the table, so two outboxes in
// one database share nothing.
export const schemaFor = ({ table = CHANGE_TABLE, channel = table } = {}) => {
    identifier(table, "table", "schemaFor");
    identifier(channel, "channel", "schemaFor");
    return `
CREATE TABLE IF NOT EXISTS ${table} (
  id         bigserial PRIMARY KEY,
  entity     varchar(64) NOT NULL,
  entity_id  varchar(64) NOT NULL,
  payload    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ${table}_time ON ${table} (created_at);

CREATE OR REPLACE FUNCTION ${table}_notify() RETURNS trigger AS $$
BEGIN
  -- Payload stays tiny on purpose: it is a doorbell, not the data. The row is read from the table.
  PERFORM pg_notify('${channel}', NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ${table}_notify_trigger ON ${table};
CREATE TRIGGER ${table}_notify_trigger
AFTER INSERT ON ${table}
FOR EACH ROW EXECUTE FUNCTION ${table}_notify();
`;
};

export const SCHEMA = schemaFor();

export const emit = (tx, entity, entityId, table = CHANGE_TABLE) =>
    tx.query(`INSERT INTO ${table} (entity, entity_id) VALUES ($1, $2)`, [String(entity), String(entityId)]);

export const writeWithChanges = (db, fn, table = CHANGE_TABLE) =>
    db.transaction(async (tx) => {
        const result = await fn(tx);
        const changes = Array.isArray(result) ? result : (result?.changes ?? []);
        for (const [entity, entityId] of changes) await emit(tx, entity, entityId, table);
        return Array.isArray(result) ? undefined : result?.value;
    });

export function createPgOutboxBus({
    pool,                       // pg.Pool — used for reads and for the dedicated LISTEN connection
    targets,
    sweepMs = 2000,             // the safety net, not the main path: NOTIFY does the waking
    coalesceMs = 8,             // wait this long after a notification before reading (see below)
    lookbackMs = 5000,
    batchSize = 500,
    table = CHANGE_TABLE,
    channel = table,            // as in schemaFor: the table's own name, so CHANNEL by default
    onError = null,
    now = () => Date.now(),
    origin = globalThis.crypto.randomUUID(),   // marks the rows this bus publishes, so it skips its own echo
    reconnectMs = 500,          // the first wait before a lost LISTEN connection is opened again
    reconnectMaxMs = 30_000,    // what the wait doubles up to while it keeps failing
}) {
    if (!pool) throw new Error("createPgOutboxBus: pool is required");
    for (const [name, value] of Object.entries({ reconnectMs, reconnectMaxMs })) {
        if (!Number.isInteger(value) || value < 1) throw new TypeError(`createPgOutboxBus: ${name} is a whole number of milliseconds from 1, not ${String(value)}`);
    }
    identifier(table, "table", "createPgOutboxBus");
    identifier(channel, "channel", "createPgOutboxBus");
    const db = fromPg(pool);

    let cursor = 0;
    let listener = null;        // a dedicated connection: a client running LISTEN cannot be shared
    let retry = null;           // the timer that opens it again after it was lost
    let sweep = null;
    let reading = false;
    let stopped = true;
    let starts = 0;             // which start is the latest: only it may keep a connection and a sweep
    const letGone = new WeakSet();   // the connections the bus has let go (letGo): their errors are not its
    let deliver = null;
    let pending = false;        // a notification arrived while a read was in flight
    let wake = null;            // the trailing-edge timer
    let lastRead = 0;           // when the last read started, for leading-edge coalescing
    const seen = new Map();
    const stats = { notifies: 0, sweeps: 0, reads: 0, events: 0, duplicates: 0, ownEchoes: 0, delivered: 0, errors: 0, lastErrorAt: null, lagMs: 0 };
    Object.defineProperty(stats, "gaps", { enumerable: true, get: () => gaps.size });

    // Same serial hazard as the MariaDB bus: ids are assigned at INSERT, rows become visible at
    // COMMIT, and those orders differ — a transaction can take id 5, commit after id 6, and a plain
    // `WHERE id > cursor` reader moves past 5 for good.
    //
    // It used to re-read the whole lookback window on every read, in id order: already-seen rows
    // filled each batch first, so above ~100 changes/s new rows waited seconds (measured 1.7 s at
    // 150/s, 3.8 s at 400/s), and every NOTIFY re-read the window on every instance. Now it reads
    // only what is new, and remembers the ids it jumped over — a GAP is a transaction still in
    // flight (or one that rolled back) — re-checking exactly those until they appear or age out of
    // the lookback. Precise, and the cost no longer grows with the write rate.
    const gaps = new Map();                            // id -> when it was first found missing
    const MAX_GAP_SPAN = 1000;                         // a sequence jump larger than this is not a race
    const fetchBatch = async () => {
        const fresh = await db.query(
            `SELECT id, entity, entity_id, payload, created_at FROM ${table} WHERE id > $1 ORDER BY id LIMIT $2`,
            [cursor, batchSize]);
        const late = gaps.size
            ? await db.query(`SELECT id, entity, entity_id, payload, created_at FROM ${table} WHERE id = ANY($1::bigint[])`, [[...gaps.keys()]])
            : [];
        return { rows: [...late, ...fresh], full: fresh.length === batchSize };
    };
    // After a batch: the ids between the old cursor and each new row that did not come back are gaps.
    const noteGaps = (freshIds, from) => {
        let expect = from + 1;
        for (const id of freshIds) {
            if (id - expect <= MAX_GAP_SPAN) for (let k = expect; k < id; k++) if (!gaps.has(k)) gaps.set(k, now());
            expect = id + 1;
        }
        const cutoff = now() - lookbackMs;
        for (const [id, at] of gaps) if (at < cutoff) gaps.delete(id);
    };

    const forgetSeen = () => {
        const cutoff = now() - lookbackMs * 2;
        for (const [id, at] of seen) if (at < cutoff) seen.delete(id);
    };

    const toTargets = (entity, entityId) => {
        // The registry's own entries only: an entity named constructor or toString ran
        // Object.prototype's function as its builder.
        const build = Object.hasOwn(targets ?? {}, entity) ? targets[entity] : undefined;
        if (!build) return [];
        const out = build(entityId);
        return Array.isArray(out) ? out : out ? [out] : [];
    };

    const read = async () => {
        if (stopped) return;
        if (reading) { pending = true; return; }       // coalesce a burst into one read
        reading = true;
        try {
            do {
                pending = false;
                stats.reads++;
                const { rows, full } = await fetchBatch();
                const from = cursor;
                const freshIds = [];
                const fresh = [];
                for (const row of rows) {
                    const id = Number(row.id);
                    gaps.delete(id);                                   // a late commit has arrived
                    if (seen.has(id)) stats.duplicates++;
                    else fresh.push(row);
                    seen.set(id, seen.get(id) ?? now());
                    if (id > from) freshIds.push(id);
                    if (id > cursor) cursor = id;
                }
                noteGaps(freshIds.sort((a, b) => a - b), from);
                if (full) pending = true;                          // more waiting: read again at once
                forgetSeen();
                if (!fresh.length) continue;
                stats.events += fresh.length;
                stats.lagMs = Math.max(0, now() - fresh.reduce((min, row) => {
                    const at = new Date(row.created_at).getTime();
                    return Number.isFinite(at) ? Math.min(min, at) : min;
                }, now()));

                const distinct = new Map();
                for (const row of fresh) distinct.set(row.payload ? `p|${row.id}` : `${row.entity}|${row.entity_id}`, row);
                const list = [];
                for (const row of distinct.values()) {
                    if (row.payload) {
                        // A row this instance published was already applied locally when `touches` fired.
                        // Re-running it here would double every read for no change — skip our own echo.
                        try {
                            const parsed = JSON.parse(row.payload);
                            if (parsed?.o === origin) { stats.ownEchoes++; continue; }
                            list.push(...(parsed?.t ?? parsed));
                        } catch { stats.errors++; }
                        continue;
                    }
                    list.push(...toTargets(row.entity, String(row.entity_id)));
                }
                if (!list.length || !deliver) continue;
                stats.delivered += list.length;
                await deliver(list);
            } while (pending && !stopped);
        } catch (error) {
            // When, never what: stats() is read by whatever an app shows, a public /healthz among them,
            // and a driver's words (a role, a database, a socket) are for the log, which onError is.
            stats.errors++;
            stats.lastErrorAt = now();
            if (onError) onError(error);
        } finally {
            reading = false;
        }
    };

    // Checks out a dedicated connection, LISTENs on it, and answers it: its caller makes it the bus's
    // listener, or lets it go (letGo) when the bus has moved on while it opened. A client whose LISTEN
    // fails is released with the error, which destroys it, rather than kept checked out by nobody:
    // the pool's slot was lost with it.
    const connectListener = async () => {
        const client = await pool.connect();
        client.on("notification", (msg) => {
            if (msg.channel !== channel) return;
            stats.notifies++;
            // Leading-edge coalescing. NOTIFY fires per committed change, so a burst of writes to one
            // chat would re-run its query once per write; a polling feeder gets batching for free
            // because its interval IS a window (measured: 601 reads for NOTIFY vs 224 for a 25ms poll
            // over the same 200 writes). A plain debounce fixes that but taxes every quiet update by
            // the full delay (p50 7ms → 15ms, measured). So: read immediately when nothing has been
            // read recently — the common case, and the one users feel — and batch into a single
            // trailing read only while a burst is actually in progress.
            const since = now() - lastRead;
            if (since >= coalesceMs) { lastRead = now(); read(); return; }
            if (wake) return;
            wake = setTimeout(() => { wake = null; lastRead = now(); read(); }, coalesceMs - since);
            wake.unref?.();
        });
        // A dropped LISTEN connection is silent: no notifications, no error anyone sees. Reconnect and
        // read immediately, because anything published while it was down was never delivered.
        let lost = false;
        client.on("error", () => {
            // A connection the bus has let go is released already and no longer its own: an error
            // on it used to count in stats() and release it a second time.
            if (lost || letGone.has(client)) return;
            lost = true;
            stats.errors++;
            try { client.release(true); } catch {}
            if (listener !== client) return;       // still opening: its caller hears
            listener = null;
            reconnect(reconnectMs);
        });
        try {
            await client.query(`LISTEN ${channel}`);
        } catch (error) {
            if (!lost) { lost = true; try { client.release(error); } catch {} }
            throw error;
        }
        if (lost) throw new Error("the LISTEN connection was lost while it was being opened");
        return client;
    };
    // Tried again until it is back or the bus is stopped, the wait doubling up to reconnectMaxMs: a
    // single attempt, made while the database was still restarting, left the bus on the sweep alone
    // for good. The attempts belong to the start whose connection was lost (`mine`): once a stop()
    // or a newer start has come, one under way lets its connection go and none follows it, so it
    // never takes the place of the newer start's connection (it used to, and that one was never let
    // go).
    const reconnect = (wait, mine = starts) => {
        if (stopped || retry || mine !== starts) return;
        retry = setTimeout(async () => {
            retry = null;
            if (stopped) return;
            let client;
            try {
                client = await connectListener();
            } catch (error) {
                stats.errors++;
                stats.lastErrorAt = now();
                if (onError) onError(error);
                reconnect(Math.min(reconnectMaxMs, wait * 2), mine);
                return;
            }
            if (stopped || mine !== starts) { await letGo(client); return; }
            listener = client;
            await read();
        }, wait);
        retry.unref?.();
    };
    const letGo = async (client) => {
        letGone.add(client);
        try { await client.query(`UNLISTEN ${channel}`); } catch {}
        try { client.release(); } catch {}
    };
    const releaseListener = async () => {
        const client = listener;
        listener = null;
        if (client) await letGo(client);
    };

    return {
        // Durable publish: written to the table the feeders read, so `touches` crosses instances too.
        // The trigger turns it into a NOTIFY at commit. See mysql-outbox.js for why writeWithChanges is
        // the stronger option — its notice commits with the data, this one does not.
        async publish(targets) {
            if (!targets?.length) return;
            await pool.query(`INSERT INTO ${table} (entity, entity_id, payload) VALUES ($1, $2, $3)`,
                ["$targets", "-", JSON.stringify({ o: origin, t: targets })]);
        },
        subscribe(handler) {
            deliver = handler;
            return () => { deliver = null; };
        },

        // Deletes the rows written more than `olderThanMs` ago, by the database's own clock (the one
        // created_at was written with), and answers how many. The table says what to tell the other
        // instances; it is not history, and once every reader has read a row nothing else deletes
        // it. A reader re-checks an id it jumped over for `lookbackMs`, so a younger row may be one
        // it has not read yet: less than that is refused, and nothing is asked of the database.
        async prune({ olderThanMs = PRUNE_AFTER_MS } = {}) {
            if (typeof olderThanMs !== "number" || !Number.isFinite(olderThanMs) || olderThanMs < lookbackMs) {
                throw new RangeError(`prune: olderThanMs must be a number of milliseconds, no less than lookbackMs (${lookbackMs}), not ${olderThanMs}`);
            }
            const result = await pool.query(`DELETE FROM ${table} WHERE created_at < now() - $1::double precision * interval '1 millisecond'`, [olderThanMs]);
            return result.rowCount;
        },

        // A start that fails (the cursor cannot be read, the LISTEN connection cannot be opened)
        // rejects and leaves the bus stopped, so a later start() tries again rather than finding
        // it "already started" and doing nothing. A start that a stop() or a newer start overtook
        // while it opened lets its connection go, sets nothing (no cursor, no sweep) and answers as
        // before: it used to keep its connection and sweep beside the newer start's, one of each
        // never let go. Only the latest start's failure leaves the bus stopped.
        async start({ from = "end" } = {}) {
            if (!stopped) return this;
            stopped = false;
            const mine = ++starts;
            let client;
            try {
                if (from === "end") {
                    const rows = await db.query(`SELECT COALESCE(MAX(id), 0) AS id FROM ${table}`);
                    if (mine === starts) cursor = Number(rows[0]?.id ?? 0);
                } else if (typeof from === "number") {
                    cursor = from;
                }
                client = await connectListener();
            } catch (error) {
                if (mine === starts) stopped = true;
                throw error;
            }
            if (stopped || mine !== starts) { await letGo(client); return this; }   // stop() or a newer start came while it started
            listener = client;
            sweep = setInterval(() => { stats.sweeps++; read(); }, sweepMs);   // catches whatever the doorbell missed
            sweep.unref?.();
            return this;
        },
        async stop() {
            stopped = true;
            clearTimeout(wake);
            wake = null;
            clearTimeout(retry);
            retry = null;
            clearInterval(sweep);
            sweep = null;
            await releaseListener();
            while (reading) await new Promise((resolve) => setImmediate(resolve));
        },
        read,
        get cursor() { return cursor; },
        stats: () => ({ ...stats, cursor, tracked: seen.size }),
    };
}

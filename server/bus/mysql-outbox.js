// A change bus for serviceDispatcher, backed by a database table instead of a message broker.
//
//   mutation ──┐ (one transaction)
//              ├─→ the data row
//              └─→ a change_events row
//                        │
//                        ├─→ feeder on instance 1 ─→ dispatcher.invalidate(targets, { local: true })
//                        ├─→ feeder on instance 2 ─→ …
//                        └─→ feeder on instance 3 ─→ …
//
// Why a table and not Redis: the change notice commits with the data or not at all, so nothing is lost
// if a process dies mid-write, and it adds no infrastructure to run, secure and back up. The cost is one
// re-read per instance per change and a poll interval of latency. MariaDB has no LISTEN/NOTIFY (that is
// Postgres), so the feeder polls; at 25ms that measured p50 19ms end to end.
//
// Usage:
//   await db.query(SCHEMA);                       // or schemaFor({ table }), once, at migration
//   const bus = createOutboxBus({ db: fromMysql2(pool), targets: { chat: (id) => ({ name: "chat", args: [id] }) } });
//   const handler = serviceDispatcher(services, "/api", { live: { queries, touches, bus } });
//   await bus.start();
//   setInterval(() => bus.prune().catch(report), 10 * 60_000).unref();   // the table is not history

// The default names are shared by every instance that reads the table, old builds included while a
// deploy is half rolled, so they never change.
export const CHANGE_TABLE = "change_events";

// How long `prune` keeps a row unless told otherwise: far past any reader's lookback.
export const PRUNE_AFTER_MS = 60 * 60_000;

// A table name is written into the DDL as it is: anything but a plain identifier is refused rather
// than quoted.
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

// The table and its two keys, named after it, so two outboxes in one database share nothing.
export const schemaFor = ({ table = CHANGE_TABLE } = {}) => {
    if (typeof table !== "string" || !IDENTIFIER.test(table)) throw new TypeError(`schemaFor: table must be a plain SQL identifier (letters, digits, _), not ${JSON.stringify(table)}`);
    return `CREATE TABLE IF NOT EXISTS ${table} (
  id         bigint unsigned NOT NULL AUTO_INCREMENT,
  entity     varchar(64) NOT NULL,
  entity_id  varchar(64) NOT NULL,
  payload    text NULL,
  created_at datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (id),
  KEY ${table}_scan (id),
  KEY ${table}_time (created_at)
) ENGINE=InnoDB`;
};

export const SCHEMA = schemaFor();

// ---- driver adapters ---------------------------------------------------------------------------
// The two drivers in use disagree about return shapes and transactions, so the bus takes an adapter:
// fromMysql2 or fromMariadb, from ../db.js.

// ---- writing ------------------------------------------------------------------------------------

// Record a change inside the caller's transaction. Calling it anywhere else defeats the point.
export const emit = (tx, entity, entityId, table = CHANGE_TABLE) =>
    tx.query(`INSERT INTO ${table} (entity, entity_id) VALUES (?, ?)`, [String(entity), String(entityId)]);

// The shape a mutation should use — the write and its change notice share one transaction:
//
//   await writeWithChanges(db, async (tx) => {
//       await tx.query("INSERT INTO chat_messages …", [...]);
//       return { changes: [["chat", chatId]], value: { ok: true } };
//   });
export const writeWithChanges = (db, fn, table = CHANGE_TABLE) =>
    db.transaction(async (tx) => {
        const result = await fn(tx);
        const changes = Array.isArray(result) ? result : (result?.changes ?? []);
        for (const [entity, entityId] of changes) await emit(tx, entity, entityId, table);
        return Array.isArray(result) ? undefined : result?.value;
    });

// ---- the bus ------------------------------------------------------------------------------------

export function createOutboxBus({
    db,                        // adapter: fromMysql2(pool) / fromMariadb(pool)
    targets,                   // { [entity]: (entityId) => target | target[] } — targets must be serializable
    intervalMs = 25,
    lookbackMs = 5000,
    batchSize = 500,
    table = CHANGE_TABLE,
    onError = null,
    now = () => Date.now(),
    origin = globalThis.crypto.randomUUID(),   // marks the rows this bus publishes, so it skips its own echo
}) {
    if (!db) throw new Error("createOutboxBus: db adapter is required");

    let cursor = 0;
    let timer = null;
    let polling = false;
    let stopped = true;
    let starts = 0;                  // which start is the latest: only it may set the cursor and the interval
    let deliver = null;              // set by subscribe(), called with the targets to apply locally
    const seen = new Map();          // id -> when first seen, pruned past the lookback window
    const stats = { polls: 0, events: 0, duplicates: 0, ownEchoes: 0, delivered: 0, errors: 0, lastErrorAt: null, lagMs: 0 };

    // The AUTO_INCREMENT gap, which a naive `WHERE id > cursor` feeder gets wrong:
    // ids are handed out at INSERT, but rows become visible at COMMIT, and those orders differ.
    // Transaction A can take id 5 while B takes id 6 and commits first; a feeder that consumed 6 and
    // moved its cursor would never see 5 — a change silently lost for every client on that instance.
    // So each poll also re-reads rows committed inside a lookback window and skips ids already handled.
    // The window only has to exceed the longest write transaction, and a duplicate costs nothing:
    // invalidation re-runs a query whose result is diffed, so an unchanged re-run sends nothing.
    // New rows by id, plus a re-check of exactly the ids jumped over (see ./pg-outbox.js, which
    // does the same). It used to re-read a lookback window built from a UTC string compared with
    // DATETIMEs in the session's LOCAL time — on a +08 database every row of the last 8 hours was
    // "in the window", the cursor stuck after 500, and old changes were delivered again; behind UTC
    // the window matched nothing. No wall clock is compared with the database's any more.
    const gaps = new Map();
    const MAX_GAP_SPAN = 1000;
    const fetchBatch = async () => {
        const fresh = await db.query(
            `SELECT id, entity, entity_id, payload, created_at FROM ${table} WHERE id > ? ORDER BY id LIMIT ?`,
            [cursor, batchSize]);
        const ids = [...gaps.keys()];
        const late = ids.length
            ? await db.query(`SELECT id, entity, entity_id, payload, created_at FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")})`, ids)
            : [];
        return { rows: [...late, ...fresh], full: fresh.length === batchSize };
    };
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

    const poll = async () => {
        if (polling || stopped) return;
        polling = true;
        let more = false;
        try {
            stats.polls++;
            const { rows, full } = await fetchBatch();
            const from = cursor;
            const freshIds = [];
            const fresh = [];
            for (const row of rows) {
                const id = Number(row.id);
                gaps.delete(id);
                if (seen.has(id)) stats.duplicates++;
                else fresh.push(row);
                seen.set(id, seen.get(id) ?? now());
                if (id > from) freshIds.push(id);
                if (id > cursor) cursor = id;
            }
            noteGaps(freshIds.sort((a, b) => a - b), from);
            more = full;   // more waiting: poll again as soon as this one is done (below)
            forgetSeen();
            if (!fresh.length) return;
            stats.events += fresh.length;

            const oldest = fresh.reduce((min, row) => {
                const at = new Date(row.created_at).getTime();
                return Number.isFinite(at) ? Math.min(min, at) : min;
            }, now());
            stats.lagMs = Math.max(0, now() - oldest);

            // Collapse the batch: fifty messages in one chat re-run that chat's query once, not fifty times.
            const distinct = new Map();
            for (const row of fresh) distinct.set(row.payload ? `p|${row.id}` : `${row.entity}|${row.entity_id}`, row);
            const list = [];
            for (const row of distinct.values()) {
                // A published row carries its targets; an outbox row is mapped through the registry.
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
            if (!list.length || !deliver) return;
            stats.delivered += list.length;
            await deliver(list);
        } catch (error) {
            // When, never what: stats() is read by whatever an app shows, a public /healthz among them,
            // and a driver's words (a role, a database, a socket) are for the log, which onError is.
            stats.errors++;
            stats.lastErrorAt = now();
            if (onError) onError(error);
        } finally {
            polling = false;
            // Only once this poll has delivered: the next one used to be let in by a setImmediate
            // while this one still awaited `deliver`, so two ran at once, and stop() could resolve
            // with one of them still running.
            if (more && !stopped) setImmediate(poll);
        }
    };

    return {
        // --- the interface serviceDispatcher expects -------------------------------------------
        // Durable publish: the targets are written to the same table the feeders read, so an
        // invalidation raised by `touches` (or by hand) reaches every instance without the mutation
        // having to know about the bus.
        //
        // Atomicity differs by route, and it matters:
        //   writeWithChanges  the change notice commits WITH the data — nothing can be lost
        //   publish (touches) the notice is written AFTER the mutation returned, so a process that
        //                     dies in between leaves other instances unaware. Use writeWithChanges
        //                     for anything where a missed update is worse than a slower write.
        async publish(targets) {
            if (!targets?.length) return;
            await db.query(`INSERT INTO ${table} (entity, entity_id, payload) VALUES (?, ?, ?)`,
                ["$targets", "-", JSON.stringify({ o: origin, t: targets })]);
        },
        subscribe(handler) {
            deliver = handler;
            return () => { deliver = null; };
        },

        // Deletes the rows written more than `olderThanMs` ago, by the database's own clock (NOW(3),
        // the clock created_at was written with; a DATETIME carries no zone, so this process's clock
        // is never compared with it), and answers how many. As in ./pg-outbox.js: the table is not
        // history, and less than `lookbackMs` is refused, with nothing asked of the database.
        async prune({ olderThanMs = PRUNE_AFTER_MS } = {}) {
            if (typeof olderThanMs !== "number" || !Number.isFinite(olderThanMs) || olderThanMs < lookbackMs) {
                throw new RangeError(`prune: olderThanMs must be a number of milliseconds, no less than lookbackMs (${lookbackMs}), not ${olderThanMs}`);
            }
            const result = await db.query(`DELETE FROM ${table} WHERE created_at < NOW(3) - INTERVAL ? MICROSECOND`, [Math.round(olderThanMs * 1000)]);
            return Number(result?.affectedRows ?? 0);
        },

        // --- lifecycle -------------------------------------------------------------------------
        // A start whose cursor cannot be read rejects and leaves the bus stopped, as in
        // ./pg-outbox.js, so a later start() tries again rather than finding it "already started"
        // and doing nothing. A start that a stop() or a newer start overtook while it read the
        // cursor sets nothing (no cursor, no interval) and answers as before: an interval set
        // anyway was overwritten, never cleared, by the next start's, and its late cursor moved the
        // newer one back. Only the latest start's failure leaves the bus stopped.
        async start({ from = "end" } = {}) {
            if (!stopped) return this;
            stopped = false;
            const mine = ++starts;
            try {
                if (from === "end") {
                    const rows = await db.query(`SELECT COALESCE(MAX(id), 0) AS id FROM ${table}`);
                    if (mine === starts) cursor = Number(rows[0]?.id ?? 0);   // a new instance does not replay history
                } else if (typeof from === "number") {
                    cursor = from;
                }
            } catch (error) {
                if (mine === starts) stopped = true;
                throw error;
            }
            if (stopped || mine !== starts) return this;   // stop() or a newer start came while it started
            timer = setInterval(poll, intervalMs);
            timer.unref?.();
            return this;
        },
        async stop() {
            stopped = true;
            clearInterval(timer);
            timer = null;
            while (polling) await new Promise((resolve) => setImmediate(resolve));
        },
        poll,                                        // forcing a tick keeps tests deterministic
        get cursor() { return cursor; },
        stats: () => ({ ...stats, cursor, tracked: seen.size, gaps: gaps.size }),
    };
}

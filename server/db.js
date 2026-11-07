// Database adapters: one small interface over the drivers a server may use, so the code that reads
// and writes (an app's services, a change bus) never sees a driver's return shape or its way of
// running a transaction.
//
//   const db = fromPg(pool);                      // or fromMysql2(pool), fromMariadb(pool)
//   const rows = await db.query(sql, params);     // params default to []
//   const out = await db.transaction(async (tx) => {
//       await tx.query(sql, params);              // one connection, between BEGIN and COMMIT
//       return value;                             // what the transaction answers
//   });
//
// `query` answers the rows of a statement that returns rows. For one that does not, it answers what
// the driver reports: pg gives `[]`, the MySQL and MariaDB drivers an object with `affectedRows` and
// `insertId`. A transaction whose function throws, or whose COMMIT fails, is rolled back and that
// error rethrown (a failed ROLLBACK does not replace it). The connection goes back to the pool,
// unless that ROLLBACK failed: then nothing says it is out of the transaction, and the next caller
// to be handed it would run inside it, so it is destroyed instead (the pool opens a new one).
//
// The rows of a statement that returns rows also say their columns, in order: `rows.fields`, the
// column names (pg and mysql2), a property that is not enumerable, so the rows serialize and iterate
// as before. A statement that returns no rows still has them, which is how a caller learns the shape
// of an empty result.
//
// The driver is the app's: it passes a pool in, so this module imports nothing and the framework
// depends on no driver.

// `rows`, with the names of `fields` ({ name }) attached as rows.fields.
const withFields = (rows, fields) => {
    if (Array.isArray(rows) && Array.isArray(fields)) Object.defineProperty(rows, "fields", { value: fields.map((f) => f?.name), enumerable: false });
    return rows;
};

// pg (node-postgres): `pool.query` answers `{ rows }`, and a transaction needs one client of its own
// from `pool.connect()`.
const pgRows = (result) => withFields(result.rows, result.fields);
export const fromPg = (pool) => ({
    query: async (sql, params = []) => pgRows(await pool.query(sql, params)),
    transaction: async (fn) => {
        const client = await pool.connect();
        let broken;   // why ROLLBACK failed, if it did: pg destroys a client released with an error
        try {
            await client.query("BEGIN");
            const out = await fn({ query: async (sql, params = []) => pgRows(await client.query(sql, params)) });
            await client.query("COMMIT");
            return out;
        } catch (error) {
            await client.query("ROLLBACK").catch((failed) => { broken = failed instanceof Error ? failed : new Error("ROLLBACK failed"); });
            throw error;
        } finally {
            client.release(broken);
        }
    },
});

// mysql2/promise: `pool.query` answers `[rows, fields]`. mariadb: `pool.query` answers the rows, and
// this adapter's `query` answers plain copies of them (a transaction's `tx.query` answers the
// driver's own). Both take a transaction's connection from `pool.getConnection()`.
export const fromMysql2 = (pool) => ({
    query: async (sql, params = []) => { const [rows, fields] = await pool.query(sql, params); return withFields(rows, fields); },
    transaction: async (fn) => {
        const conn = await pool.getConnection();
        let broken = false;
        try {
            await conn.beginTransaction();
            const out = await fn({ query: async (sql, params = []) => { const [rows, fields] = await conn.query(sql, params); return withFields(rows, fields); } });
            await conn.commit();
            return out;
        } catch (error) {
            await conn.rollback().catch(() => { broken = true; });
            throw error;
        } finally {
            // A failed rollback leaves the connection in the transaction: destroyed, never pooled.
            if (broken) conn.destroy();
            else conn.release();
        }
    },
});

export const fromMariadb = (pool) => ({
    query: async (sql, params = []) => {
        const rows = await pool.query(sql, params);
        return Array.isArray(rows) ? rows.map((row) => ({ ...row })) : rows;
    },
    transaction: async (fn) => {
        const conn = await pool.getConnection();
        let broken = false;
        try {
            await conn.beginTransaction();
            const out = await fn({ query: (sql, params = []) => conn.query(sql, params) });
            await conn.commit();
            return out;
        } catch (error) {
            await conn.rollback().catch(() => { broken = true; });
            throw error;
        } finally {
            // A failed rollback leaves the connection in the transaction: destroyed, never pooled.
            if (broken) conn.destroy();
            else conn.release();
        }
    },
});

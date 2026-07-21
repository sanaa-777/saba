const fs = require('fs');
const { parentPort } = require('worker_threads');
const { Pool, types } = require('pg');

types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
types.setTypeParser(21, (v) => (v === null ? null : Number(v)));
types.setTypeParser(23, (v) => (v === null ? null : Number(v)));
types.setTypeParser(700, (v) => (v === null ? null : Number(v)));
types.setTypeParser(701, (v) => (v === null ? null : Number(v)));
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required for PostgreSQL worker');
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: parseInt(process.env.PG_POOL_MAX || '4', 10)
});

parentPort.on('message', async (job) => {
  const signal = new Int32Array(job.signalBuffer);
  const payloadPath = job.payloadPath;

  try {
    const result = await pool.query(job.sql, job.params || []);
    fs.writeFileSync(payloadPath, JSON.stringify({
      ok: true,
      rows: result.rows,
      rowCount: result.rowCount,
      command: result.command
    }));
  } catch (error) {
    fs.writeFileSync(payloadPath, JSON.stringify({
      ok: false,
      error: {
        message: error.message,
        code: error.code,
        detail: error.detail,
        hint: error.hint,
        position: error.position,
        stack: error.stack
      }
    }));
  } finally {
    Atomics.store(signal, 0, 1);
    Atomics.notify(signal, 0, 1);
  }
});

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { config } from './config.js';

const db = new DatabaseSync(config.dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id            TEXT PRIMARY KEY,
    source        TEXT NOT NULL,
    company       TEXT NOT NULL,
    title         TEXT NOT NULL,
    url           TEXT NOT NULL,
    location      TEXT,
    description   TEXT,
    found_at      TEXT NOT NULL,
    status        TEXT NOT NULL,   -- pending | applied | skipped | failed | manual
    cover_letter  TEXT,
    decided_at    TEXT,
    note          TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_found  ON jobs(found_at);
`);

/**
 * Stable identity for a posting. Deliberately NOT the raw URL — the same job
 * on RemoteOK and Himalayas has different URLs but must dedupe to one entry.
 */
export function jobId(job) {
  const key = `${job.company}|${job.title}`.toLowerCase().replace(/[^a-z0-9|]/g, '');
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
}

export function isKnown(id) {
  return db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(id) !== undefined;
}

export function insertJob(job) {
  const id = jobId(job);
  db.prepare(`
    INSERT OR IGNORE INTO jobs
      (id, source, company, title, url, location, description, found_at, status, cover_letter)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    id, job.source, job.company, job.title, job.url,
    job.location ?? '', job.description ?? '', new Date().toISOString(),
    job.coverLetter ?? null,
  );
  return id;
}

export const getJob = (id) => db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);

export function setStatus(id, status, note = null) {
  db.prepare('UPDATE jobs SET status = ?, decided_at = ?, note = ? WHERE id = ?')
    .run(status, new Date().toISOString(), note, id);
}

export const setCoverLetter = (id, letter) =>
  db.prepare('UPDATE jobs SET cover_letter = ? WHERE id = ?').run(letter, id);

export const pendingJobs = () =>
  db.prepare(`SELECT * FROM jobs WHERE status = 'pending' ORDER BY found_at DESC`).all();

/** Everything that happened since local midnight, for the evening report. */
export function todaysActivity() {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const iso = since.toISOString();
  return {
    found: db.prepare('SELECT * FROM jobs WHERE found_at >= ?').all(iso),
    decided: db.prepare('SELECT * FROM jobs WHERE decided_at >= ?').all(iso),
  };
}

export const totals = () =>
  db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all();

export default db;

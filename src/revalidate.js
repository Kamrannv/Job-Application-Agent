/**
 * Re-applies the current filters to everything still awaiting your decision,
 * and auto-skips anything that no longer qualifies. Run this after changing
 * match.js or geo.js so stale cards can't be acted on by mistake.
 *
 *   npm run revalidate
 */
import { matchJob } from './match.js';
import { pendingJobs, setStatus } from './db.js';

const pending = pendingJobs();
console.log(`${pending.length} job(s) currently pending\n`);

let dropped = 0;
for (const job of pending) {
  const verdict = matchJob(job);
  if (!verdict.ok) {
    setStatus(job.id, 'skipped', `auto-skipped: ${verdict.reason}`);
    console.log(`  ✗ ${job.company} — ${job.title}\n      ${verdict.reason}`);
    dropped++;
  } else {
    console.log(`  ✓ ${job.company} — ${job.title}`);
  }
}

console.log(`\n${dropped} skipped, ${pending.length - dropped} still valid.`);

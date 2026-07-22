/**
 * Dry run of the search half of the pipeline — no Telegram, no API key, no
 * applications. Shows exactly which jobs would land in your inbox tomorrow.
 *
 *   npm run check
 */
import { fetchAllJobs } from './sources.js';
import { filterAndRank } from './match.js';
import { detectAts } from './apply.js';

console.log('Fetching every source…\n');
const raw = await fetchAllJobs();

console.log(`\nTotal postings fetched: ${raw.length}`);
const matched = filterAndRank(raw);
console.log(`Passed iOS + remote + not-Azerbaijan filters: ${matched.length}\n`);

for (const job of matched.slice(0, 30)) {
  const ats = detectAts(job.url);
  const auto = ats === 'greenhouse' || ats === 'lever' ? 'auto' : 'manual';
  console.log(`[${String(job.score).padStart(3)}] ${job.company} — ${job.title}`);
  console.log(`      ${job.location || 'Remote'} · ${job.source} · ${ats} (${auto})`);
  console.log(`      ${job.url}\n`);
}

if (matched.length > 30) console.log(`…and ${matched.length - 30} more.`);

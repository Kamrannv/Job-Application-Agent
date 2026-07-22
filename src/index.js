import fs from 'node:fs';
import path from 'node:path';
import cron from 'node-cron';
import { config, assertReady, ROOT } from './config.js';
import { fetchAllJobs } from './sources.js';
import { filterAndRank } from './match.js';
import { writeCoverLetter } from './letter.js';
import { isKnown, jobId, insertJob, getJob } from './db.js';
import { bot, send, sendJobCard, dailyReport, onSearchRequest } from './bot.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);

// Remembers which day the search and report last completed, so a run missed
// while the Mac was asleep is picked up rather than lost.
const statePath = path.join(ROOT, 'data', 'state.json');
const state = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
  : { lastSearch: null, lastReport: null };

export async function runSearch() {
  log('Search starting');
  await send('🔍 Searching for new remote iOS jobs…');

  const raw = await fetchAllJobs(log);
  log(`Fetched ${raw.length} raw postings`);

  const matched = filterAndRank(raw);
  log(`${matched.length} passed the iOS + remote filters`);

  // Dedupe against everything ever seen, and against repeats within this run.
  const seenThisRun = new Set();
  const fresh = [];
  for (const job of matched) {
    const id = jobId(job);
    if (seenThisRun.has(id) || isKnown(id)) continue;
    seenThisRun.add(id);
    fresh.push(job);
  }

  const batch = fresh.slice(0, config.maxJobsPerDay);
  log(`${fresh.length} new; sending ${batch.length} (cap ${config.maxJobsPerDay})`);

  if (!batch.length) {
    await send('No new iOS roles today. Everything found was already seen.');
    return 0;
  }

  let sent = 0;
  for (const job of batch) {
    try {
      job.coverLetter = await writeCoverLetter(job);
      job.geoNote = job.geoNote ?? null;
      const id = insertJob(job);
      await sendJobCard(getJob(id));
      sent++;
    } catch (err) {
      log(`Failed on ${job.company} — ${job.title}: ${err.message}`);
    }
  }

  await send(`Done. <b>${sent}</b> job(s) waiting for your ✅ or ⏭.`);
  log(`Search complete, ${sent} sent`);
  return sent;
}

// Lets /search in Telegram drive the same pipeline the schedule uses.
onSearchRequest(runSearch);

async function main() {
  const problems = assertReady();
  if (problems.length) {
    console.error('\nSetup incomplete:\n' + problems.map((p) => `  • ${p}`).join('\n') + '\n');
    process.exit(1);
  }

  const args = process.argv.slice(2);

  if (args.includes('--search-now')) {
    await runSearch();
    process.exit(0);
  }
  if (args.includes('--report-now')) {
    await dailyReport();
    process.exit(0);
  }

  // A plain daily cron silently skips its slot if the Mac is asleep at that
  // minute — a closed lid at 09:00 would mean no jobs that day, with no sign
  // anything was missed. So instead of firing at an exact minute, check every
  // few minutes whether today's run is still owed, and catch up on wake.
  const due = (kind, at) => {
    const [h, m] = at.split(':').map(Number);
    const now = new Date();
    const today = now.toLocaleDateString('en-CA');           // YYYY-MM-DD, local
    if (state[kind] === today) return false;                 // already done today
    return now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
  };

  const markDone = (kind) => {
    state[kind] = new Date().toLocaleDateString('en-CA');
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  };

  const tick = async () => {
    if (due('lastSearch', config.searchTime)) {
      markDone('lastSearch');                                 // mark first, so a
      await runSearch().catch((e) => log('search error', e)); // crash can't loop
    }
    if (due('lastReport', config.reportTime)) {
      markDone('lastReport');
      await dailyReport().catch((e) => log('report error', e));
    }
  };

  cron.schedule('*/5 * * * *', () => { tick(); }, { timezone: config.timezone });
  setTimeout(tick, 15000);  // and check once shortly after startup

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  // With long polling, bot.launch() only settles once the bot STOPS — so the
  // ready notification has to go in the onLaunch callback, not after an await.
  bot.launch({}, () => {
    log(`Bot running. Search ${config.searchTime}, report ${config.reportTime} (${config.timezone}).`);
    send(
      `🤖 Job bot online.\n`
      + `Daily search at <b>${config.searchTime}</b>, report at <b>${config.reportTime}</b>.\n\n`
      + `/search — search right now\n`
      + `/pending — jobs awaiting your decision\n`
      + `/report — today's summary\n`
      + `/stats — totals so far\n`
      + `/help — this list`,
    ).catch((e) => log('startup message failed', e.message));
  }).catch((err) => {
    log('bot stopped:', err?.message ?? err);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

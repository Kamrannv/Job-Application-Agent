import cron from 'node-cron';
import { config, assertReady } from './config.js';
import { fetchAllJobs } from './sources.js';
import { filterAndRank } from './match.js';
import { writeCoverLetter } from './letter.js';
import { isKnown, jobId, insertJob, getJob } from './db.js';
import { bot, send, sendJobCard, dailyReport } from './bot.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);

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

  const [sh, sm] = config.searchTime.split(':');
  const [rh, rm] = config.reportTime.split(':');
  const opts = { timezone: config.timezone };

  cron.schedule(`${sm} ${sh} * * *`, () => runSearch().catch((e) => log('search error', e)), opts);
  cron.schedule(`${rm} ${rh} * * *`, () => dailyReport().catch((e) => log('report error', e)), opts);

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  // With long polling, bot.launch() only settles once the bot STOPS — so the
  // ready notification has to go in the onLaunch callback, not after an await.
  bot.launch({}, () => {
    log(`Bot running. Search ${config.searchTime}, report ${config.reportTime} (${config.timezone}).`);
    send(
      `🤖 Job bot online.\n`
      + `Daily search at <b>${config.searchTime}</b>, report at <b>${config.reportTime}</b>.\n\n`
      + `/pending — jobs awaiting your decision\n/stats — totals so far`,
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

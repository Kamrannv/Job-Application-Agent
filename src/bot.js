import fs from 'node:fs';
import { Telegraf, Markup } from 'telegraf';
import { config } from './config.js';
import { getJob, setStatus, setCoverLetter, pendingJobs, todaysActivity, totals } from './db.js';
import { applyToJob, detectAts } from './apply.js';
import { writeCoverLetter } from './letter.js';

export const bot = new Telegraf(config.telegramToken);

const esc = (s = '') => String(s).replace(/[<&>]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const trunc = (s = '', n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const send = (text, extra = {}) =>
  bot.telegram.sendMessage(config.telegramChatId, text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });

/** One card per job: what it is, the letter, and the two buttons. */
export function jobCard(job) {
  const ats = detectAts(job.url);
  const auto = ats === 'greenhouse' || ats === 'lever';

  // Be explicit about how confident we are that you can actually take the job.
  const geo = job.geo_note
    ? `⚠️ ${esc(job.geo_note)} — verify they hire outside that country`
    : `🌍 Open region — no country restriction found`;

  const text = [
    `<b>${esc(job.title)}</b>`,
    `🏢 ${esc(job.company)}   📍 ${esc(job.location || 'Remote')}`,
    geo,
    `🔗 <a href="${esc(job.url)}">View posting</a>  ·  <i>${esc(job.source)}</i>`,
    auto ? `⚙️ Auto-apply supported (${ats})` : `✍️ ${ats} — I'll fill what I can, you finish it`,
    '',
    '<b>Cover letter</b>',
    `<i>${esc(trunc(job.cover_letter || '(none)', 1200))}</i>`,
  ].join('\n');

  return {
    text,
    keyboard: Markup.inlineKeyboard([
      [Markup.button.callback('✅ Apply', `apply:${job.id}`), Markup.button.callback('⏭ Skip', `skip:${job.id}`)],
      [Markup.button.callback('🔄 Rewrite letter', `rewrite:${job.id}`)],
    ]),
  };
}

export async function sendJobCard(job) {
  const { text, keyboard } = jobCard(job);
  await send(text, keyboard);
}

// ------------------------------------------------------------------ buttons

bot.action(/^apply:(.+)$/, async (ctx) => {
  const job = getJob(ctx.match[1]);
  if (!job) return ctx.answerCbQuery('Job not found');
  if (job.status !== 'pending') return ctx.answerCbQuery(`Already ${job.status}`);

  await ctx.answerCbQuery('Applying…');
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  await send(`⏳ Applying to <b>${esc(job.title)}</b> at ${esc(job.company)}…`);

  const result = await applyToJob(job);
  setStatus(job.id, result.status, result.note);

  const icon = { applied: '✅', manual: '✍️', failed: '❌' }[result.status];
  await send(`${icon} <b>${esc(job.company)}</b> — ${esc(job.title)}\n${esc(result.note)}\n\n🔗 ${esc(job.url)}`);

  if (result.screenshot && fs.existsSync(result.screenshot)) {
    await bot.telegram.sendPhoto(config.telegramChatId, { source: result.screenshot }).catch(() => {});
  }
});

bot.action(/^skip:(.+)$/, async (ctx) => {
  const job = getJob(ctx.match[1]);
  if (!job) return ctx.answerCbQuery('Job not found');
  setStatus(job.id, 'skipped', 'skipped by you');
  await ctx.answerCbQuery('Skipped');
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
});

bot.action(/^rewrite:(.+)$/, async (ctx) => {
  const job = getJob(ctx.match[1]);
  if (!job) return ctx.answerCbQuery('Job not found');
  await ctx.answerCbQuery('Rewriting…');
  try {
    const letter = await writeCoverLetter(job);
    setCoverLetter(job.id, letter);
    const { text, keyboard } = jobCard(getJob(job.id));
    await ctx.editMessageText(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...keyboard });
  } catch (err) {
    await send(`❌ Couldn't rewrite: ${esc(err.message)}`);
  }
});

// ----------------------------------------------------------------- commands

bot.command('pending', async (ctx) => {
  const jobs = pendingJobs();
  if (!jobs.length) return ctx.reply('Nothing waiting on you. 🎉');
  await ctx.reply(`${jobs.length} job(s) waiting:`);
  for (const job of jobs.slice(0, 10)) await sendJobCard(job);
});

bot.command('stats', async (ctx) => {
  const rows = totals();
  const body = rows.length
    ? rows.map((r) => `${r.status}: <b>${r.n}</b>`).join('\n')
    : 'No jobs tracked yet.';
  await ctx.replyWithHTML(`<b>All time</b>\n${body}`);
});

export function dailyReport() {
  const { found, decided } = todaysActivity();
  const by = (s) => decided.filter((j) => j.status === s);

  const applied = by('applied');
  const manual = by('manual');
  const failed = by('failed');
  const stillPending = pendingJobs();

  const lines = [
    `📊 <b>Daily report — ${new Date().toLocaleDateString()}</b>`,
    '',
    `🔍 New matches found: <b>${found.length}</b>`,
    `✅ Applied: <b>${applied.length}</b>`,
    `✍️ Needs you to finish: <b>${manual.length}</b>`,
    `❌ Failed: <b>${failed.length}</b>`,
    `⏳ Still awaiting your tap: <b>${stillPending.length}</b>`,
  ];

  if (applied.length) {
    lines.push('', '<b>Applied today</b>', ...applied.map((j) => `• ${esc(j.company)} — ${esc(j.title)}`));
  }
  if (manual.length) {
    lines.push('', '<b>Finish these yourself</b>', ...manual.map((j) => `• ${esc(j.company)} — ${esc(j.title)}\n  ${esc(j.url)}`));
  }
  if (failed.length) {
    lines.push('', '<b>Failed</b>', ...failed.map((j) => `• ${esc(j.company)} — ${esc(j.note || '')}\n  ${esc(j.url)}`));
  }

  return send(lines.join('\n'));
}

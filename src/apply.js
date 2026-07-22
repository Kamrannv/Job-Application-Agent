import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { config, profile } from './config.js';

/**
 * Auto-submission only covers ATS platforms with stable, predictable forms.
 * Anything else is returned as `manual` with the link, rather than guessed at —
 * a wrong guess submits a broken application under the user's real name.
 */
export function detectAts(url) {
  if (/greenhouse\.io/i.test(url)) return 'greenhouse';
  if (/lever\.co/i.test(url)) return 'lever';
  if (/ashbyhq\.com/i.test(url)) return 'ashby';
  if (/workable\.com/i.test(url)) return 'workable';
  if (/myworkdayjobs\.com/i.test(url)) return 'workday';
  return 'unknown';
}

const SUPPORTED = new Set(['greenhouse', 'lever']);

async function fillFirst(page, selectors, value) {
  if (!value) return false;
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.count() && await el.isVisible().catch(() => false)) {
      await el.fill(String(value));
      return true;
    }
  }
  return false;
}

async function uploadResume(page) {
  const input = page.locator('input[type="file"]').first();
  if (!await input.count()) return false;
  // Greenhouse/Lever hide the real input behind a styled button.
  await input.setInputFiles(config.resumePdf);
  await page.waitForTimeout(2500); // let the upload/parse finish
  return true;
}

async function applyGreenhouse(page, job) {
  await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  const filled = {};
  filled.first = await fillFirst(page, ['input#first_name', 'input[name="first_name"]', 'input[autocomplete="given-name"]'], profile.firstName);
  filled.last = await fillFirst(page, ['input#last_name', 'input[name="last_name"]', 'input[autocomplete="family-name"]'], profile.lastName);
  filled.email = await fillFirst(page, ['input#email', 'input[name="email"]', 'input[type="email"]'], profile.email);
  await fillFirst(page, ['input#phone', 'input[name="phone"]', 'input[type="tel"]'], profile.phone);
  await fillFirst(page, ['input[name*="linkedin" i]', 'input[id*="linkedin" i]'], profile.linkedin);
  await fillFirst(page, ['input[name*="github" i]', 'input[id*="github" i]'], profile.github);
  await fillFirst(page, ['input[name*="website" i]', 'input[id*="portfolio" i]'], profile.portfolio);

  filled.resume = await uploadResume(page);
  await fillFirst(page, ['textarea[name*="cover" i]', 'textarea#cover_letter_text'], job.cover_letter);

  if (!filled.first || !filled.email || !filled.resume) {
    throw new Error(`form did not fill cleanly (name:${filled.first} email:${filled.email} resume:${filled.resume})`);
  }
  return page.locator('button[type="submit"], input[type="submit"]').first();
}

async function applyLever(page, job) {
  const url = job.url.replace(/\/$/, '');
  await page.goto(url.endsWith('/apply') ? url : `${url}/apply`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  const filled = {};
  filled.name = await fillFirst(page, ['input[name="name"]'], `${profile.firstName} ${profile.lastName}`);
  filled.email = await fillFirst(page, ['input[name="email"]'], profile.email);
  await fillFirst(page, ['input[name="phone"]'], profile.phone);
  await fillFirst(page, ['input[name="urls[LinkedIn]"]'], profile.linkedin);
  await fillFirst(page, ['input[name="urls[GitHub]"]'], profile.github);
  await fillFirst(page, ['input[name="urls[Portfolio]"]'], profile.portfolio);

  filled.resume = await uploadResume(page);
  await fillFirst(page, ['textarea[name="comments"]'], job.cover_letter);

  if (!filled.name || !filled.email || !filled.resume) {
    throw new Error(`form did not fill cleanly (name:${filled.name} email:${filled.email} resume:${filled.resume})`);
  }
  return page.locator('button[type="submit"], input[type="submit"]').first();
}

/**
 * @returns {Promise<{status:'applied'|'manual'|'failed', note:string, screenshot?:string}>}
 */
export async function applyToJob(job, { dryRun = false } = {}) {
  const ats = detectAts(job.url);
  if (!SUPPORTED.has(ats)) {
    return { status: 'manual', note: `${ats} form — needs a human. Cover letter is ready to paste.` };
  }
  if (!fs.existsSync(config.resumePdf)) {
    return { status: 'failed', note: 'resume/resume.pdf is missing' };
  }

  const browser = await chromium.launch({ headless: config.headless });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
  const shot = path.join(config.screenshotDir, `${job.id}-${Date.now()}.png`);

  try {
    const submit = ats === 'greenhouse'
      ? await applyGreenhouse(page, job)
      : await applyLever(page, job);

    await page.screenshot({ path: shot, fullPage: true });

    if (dryRun) {
      return { status: 'manual', note: 'DRY RUN — form filled but not submitted', screenshot: shot };
    }
    if (!await submit.count()) throw new Error('submit button not found');

    await submit.click();
    await page.waitForTimeout(6000);

    const confirmed = /thank|received|submitted|confirmation|success/i.test(await page.content());
    await page.screenshot({ path: shot, fullPage: true });

    return confirmed
      ? { status: 'applied', note: `submitted via ${ats}`, screenshot: shot }
      : { status: 'manual', note: `submitted via ${ats} but no confirmation text found — verify manually`, screenshot: shot };
  } catch (err) {
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    return { status: 'failed', note: `${ats}: ${err.message}`, screenshot: shot };
  } finally {
    await browser.close();
  }
}

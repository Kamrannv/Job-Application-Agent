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

/**
 * Greenhouse renders company-specific questions with unpredictable `name`
 * attributes, so those have to be found by their visible label instead.
 */
async function fillByLabel(page, pattern, value) {
  if (!value) return false;
  const field = page.getByLabel(pattern).first();
  try {
    if (!await field.count()) return false;
    const tag = await field.evaluate((el) => el.tagName.toLowerCase());
    if (tag === 'select') {
      await field.selectOption({ label: String(value) }).catch(() => field.selectOption(String(value)));
    } else {
      await field.fill(String(value));
    }
    return true;
  } catch {
    return false;
  }
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

  // Company-specific required questions, matched by their visible label.
  await fillByLabel(page, /legal first name/i, profile.firstName);
  await fillByLabel(page, /legal last name/i, profile.lastName);
  await fillByLabel(page, /preferred first name/i, profile.firstName);
  await fillByLabel(page, /^\s*city|location \(city\)/i, profile.city || profile.location);
  await fillByLabel(page, /^\s*state|province/i, profile.state);
  await fillByLabel(page, /country/i, profile.country || profile.location);
  await fillByLabel(page, /linkedin/i, profile.linkedin);
  await fillByLabel(page, /github/i, profile.github);
  await fillByLabel(page, /website|portfolio/i, profile.portfolio);

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
 * Required fields still empty *before* submitting. Clicking submit with any of
 * these is guaranteed to fail, so it is better to hand the job back to you than
 * to fire a doomed request and call it an application.
 */
async function unfilledRequired(page) {
  return page.evaluate(() => {
    const missing = new Set();

    const labelFor = (el) => {
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l?.textContent.trim()) return l.textContent.trim();
      }
      for (let n = el.parentElement, hops = 0; n && hops < 4; n = n.parentElement, hops++) {
        const l = n.querySelector('label');
        if (l?.textContent.trim()) return l.textContent.trim();
      }
      return el.name || el.id || 'unnamed field';
    };

    for (const el of document.querySelectorAll('input, select, textarea')) {
      if (el.type === 'hidden' || el.type === 'file' || el.disabled) continue;
      if (!el.getBoundingClientRect().height) continue;

      const label = labelFor(el);
      const required = el.required
        || el.getAttribute('aria-required') === 'true'
        || /\*/.test(label);
      if (!required) continue;
      if (String(el.value || '').trim()) continue;

      missing.add(label.replace(/\s*\*\s*$/, '').replace(/\s+/g, ' ').slice(0, 60));
    }
    return [...missing];
  });
}

/**
 * Reads the validation messages a rejected form renders. Their presence means
 * nothing was submitted, no matter what else the page says.
 */
async function validationErrors(page) {
  return page.evaluate(() => {
    const out = new Set();
    const isRequiredMsg = (t) => /required|please (enter|select|complete)|cannot be blank|must be/i.test(t);

    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length) continue;                       // leaf nodes only
      const text = (el.textContent || '').trim();
      if (!text || text.length > 120 || !isRequiredMsg(text)) continue;
      if (!el.getBoundingClientRect().height) continue;        // must be visible

      // Walk up to find the field this message belongs to, and name it.
      let label = '';
      for (let n = el.parentElement, hops = 0; n && hops < 4; n = n.parentElement, hops++) {
        const l = n.querySelector('label');
        if (l && l.textContent.trim()) { label = l.textContent.trim().replace(/\s*\*\s*$/, ''); break; }
      }
      out.add(label || text);
    }
    return [...out];
  });
}

/**
 * Only a genuine confirmation counts. Checked against visible body text and the
 * URL — never the raw HTML, which contains words like "success" in every
 * analytics snippet ever written.
 */
async function confirmedSubmitted(page) {
  if (/confirmation|thank|success|applied/i.test(page.url())) return true;
  const text = await page.evaluate(() => document.body.innerText || '');
  return /thank you for applying|application (was )?(submitted|received)|your application has been|we(?:'ve| have) received your application|thanks for applying/i.test(text);
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

    const missing = await unfilledRequired(page);

    if (dryRun) {
      const note = missing.length
        ? `DRY RUN — filled, but ${missing.length} required field(s) still empty: ${missing.slice(0, 6).join(', ')}`
        : 'DRY RUN — all required fields filled, not submitted';
      return { status: 'manual', note, screenshot: shot };
    }

    // Refuse to submit a form that cannot succeed.
    if (missing.length) {
      return {
        status: 'manual',
        note: `not submitted — this form needs ${missing.length} field(s) I can't answer: ${missing.slice(0, 6).join(', ')}. Everything else is filled; finish it in the browser.`,
        screenshot: shot,
      };
    }
    if (!await submit.count()) throw new Error('submit button not found');

    await submit.click();
    await page.waitForTimeout(6000);
    await page.screenshot({ path: shot, fullPage: true });

    // Validation errors are the definitive signal that nothing was submitted.
    // Check them FIRST — a rejected form still renders the whole page.
    const errors = await validationErrors(page);
    if (errors.length) {
      return {
        status: 'failed',
        note: `not submitted — ${errors.length} required field(s) rejected: ${errors.slice(0, 6).join(', ')}`,
        screenshot: shot,
      };
    }

    if (await confirmedSubmitted(page)) {
      return { status: 'applied', note: `submitted via ${ats}`, screenshot: shot };
    }
    return {
      status: 'manual',
      note: `clicked submit on ${ats} but saw no confirmation — check the screenshot and verify by hand`,
      screenshot: shot,
    };
  } catch (err) {
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    return { status: 'failed', note: `${ats}: ${err.message}`, screenshot: shot };
  } finally {
    await browser.close();
  }
}

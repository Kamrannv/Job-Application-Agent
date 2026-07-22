import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

function readIfExists(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

export const config = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',

  // "09:00" style, local time on this Mac
  searchTime: process.env.SEARCH_TIME || '09:00',
  reportTime: process.env.REPORT_TIME || '21:00',
  timezone: process.env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,

  maxJobsPerDay: Number(process.env.MAX_JOBS_PER_DAY || 15),
  headless: process.env.HEADLESS !== 'false',

  dbPath: path.join(ROOT, 'data', 'jobs.db'),
  screenshotDir: path.join(ROOT, 'data', 'screenshots'),
  resumePdf: findResumePdf(),
  resumeTextPath: path.join(ROOT, 'resume', 'resume.md'),
};

/** Accept whatever the PDF is called — people rarely name it exactly resume.pdf. */
function findResumePdf() {
  const dir = path.join(ROOT, 'resume');
  if (!fs.existsSync(dir)) return path.join(dir, 'resume.pdf');
  const pdfs = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf'));
  // Prefer one literally named resume.pdf, else take the only/first one present.
  const exact = pdfs.find((f) => f.toLowerCase() === 'resume.pdf');
  return path.join(dir, exact || pdfs[0] || 'resume.pdf');
}

export const profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'profile.json'), 'utf8'));

export const resumeText = readIfExists(config.resumeTextPath);

export function assertReady() {
  const problems = [];
  for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'ANTHROPIC_API_KEY']) {
    if (!process.env[key]) problems.push(`${key} is not set in .env — copy .env.example to .env and fill it in`);
  }
  if (!resumeText || resumeText.trim().length < 100) {
    problems.push(`resume/resume.md is missing or too short — paste your full resume text there`);
  }
  if (!fs.existsSync(config.resumePdf)) {
    problems.push(`No PDF found in resume/ — application forms need a PDF to upload`);
  }
  if (!profile.firstName || !profile.email) {
    problems.push(`profile.json is incomplete — firstName and email are required`);
  }
  return problems;
}

fs.mkdirSync(config.screenshotDir, { recursive: true });

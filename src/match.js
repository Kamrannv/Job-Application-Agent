/**
 * Decides which postings are worth your time. Runs before any API call, so
 * cover letters are only generated for jobs that already passed every filter.
 */
import { geoCheck } from './geo.js';

const IOS_STRONG = /\b(ios|swiftui|uikit|swift|objective-?c|xcode|app\s*store|core\s?data|combine|apple\s?platform|visionos|watchos|tvos)\b/i;
const IOS_TITLE = /\b(ios|swift|apple|mobile|iphone|ipad)\b/i;

// Titles that mention mobile but explicitly aren't iOS.
const NOT_IOS = /\b(android\s+(developer|engineer)|kotlin\s+(developer|engineer)|flutter|react\s?native\s+only)\b/i;

const REMOTE = /\b(remote|anywhere|distributed|work\s+from\s+home|wfh|worldwide|global)\b/i;
const ONSITE = /\b(on-?site\s+only|hybrid\s+required|must\s+be\s+(located|based)\s+in\s+the\s+office|no\s+remote)\b/i;

// Hard exclusion the user asked for.
const AZERBAIJAN = /\b(azerbaijan|azərbaycan|baku|bakı|baki)\b/i;

const SENIORITY_NOISE = /\b(intern|internship|apprentice)\b/i;

export function matchJob(job) {
  const title = job.title || '';
  const text = `${title} ${job.description || ''}`;
  const where = `${job.location || ''} ${job.description || ''}`;

  if (AZERBAIJAN.test(`${where} ${job.company}`)) {
    return { ok: false, reason: 'Azerbaijan — excluded' };
  }
  if (SENIORITY_NOISE.test(title)) {
    return { ok: false, reason: 'internship' };
  }
  if (NOT_IOS.test(title)) {
    return { ok: false, reason: 'Android/other platform, not iOS' };
  }

  // Needs iOS signal in the title, or a title that is at least mobile-adjacent
  // backed by real iOS vocabulary in the body.
  const iosInTitle = IOS_STRONG.test(title);
  const iosInBody = IOS_STRONG.test(text);
  if (!iosInTitle && !(IOS_TITLE.test(title) && iosInBody)) {
    return { ok: false, reason: 'not an iOS role' };
  }

  if (ONSITE.test(where)) {
    return { ok: false, reason: 'on-site only' };
  }
  // Aggregators that only carry remote listings vouch for the job themselves;
  // company career boards mix remote and on-site, so those must say so.
  if (!job.remoteOnly && !REMOTE.test(where)) {
    return { ok: false, reason: 'not marked remote' };
  }

  // Remote is not enough — it has to be remote in a region that can hire you.
  const geo = geoCheck(job);
  if (!geo.ok) {
    return { ok: false, reason: geo.reason };
  }

  // Rough ranking so the best matches reach you first each morning.
  let score = 0;
  if (iosInTitle) score += 40;
  if (/\bswift\s?ui\b/i.test(text)) score += 15;
  if (/\bsenior|staff|lead\b/i.test(title)) score += 10;
  if (job.source.startsWith('Greenhouse') || job.source.startsWith('Lever')) score += 20;

  // A role you can definitely be hired into outranks one you merely might.
  if (geo.confidence === 'high') score += 30;
  if (/\bworldwide|anywhere|global\b/i.test(job.location || '')) score += 20;
  if (/\b(emea|europe|european)\b/i.test(job.location || '')) score += 15;

  return { ok: true, score, geoConfidence: geo.confidence, geoNote: geo.note };
}

export function filterAndRank(jobs) {
  return jobs
    .map((job) => ({ job, verdict: matchJob(job) }))
    .filter(({ verdict }) => verdict.ok)
    .sort((a, b) => b.verdict.score - a.verdict.score)
    .map(({ job, verdict }) => ({ ...job, score: verdict.score, geoConfidence: verdict.geoConfidence, geoNote: verdict.geoNote }));
}

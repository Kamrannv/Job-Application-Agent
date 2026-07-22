import Parser from 'rss-parser';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ios-job-bot';
const rss = new Parser({ timeout: 20000, headers: { 'User-Agent': UA } });

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

const strip = (html = '') =>
  String(html).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- job boards

// These boards list *only* remote jobs, so a posting from them is remote even
// when its location field says something like "USA Only" or is blank.
const REMOTE_ONLY = true;

async function remoteok() {
  // RemoteOK silently ignores ?tag= filters, so there is only one useful feed.
  const rows = await getJson('https://remoteok.com/api');
  // The first element is RemoteOK's legal notice, not a job.
  return rows.filter((r) => r && r.position).map((r) => ({
    source: 'RemoteOK',
    company: r.company,
    title: r.position,
    url: r.url || r.apply_url,
    location: r.location || 'Remote',
    description: strip(r.description),
    remoteOnly: REMOTE_ONLY,
  }));
}

async function remotive() {
  const urls = [
    'https://remotive.com/api/remote-jobs?category=software-dev&limit=200',
    'https://remotive.com/api/remote-jobs?search=ios&limit=100',
    'https://remotive.com/api/remote-jobs?search=swift&limit=100',
    'https://remotive.com/api/remote-jobs?search=mobile%20engineer&limit=100',
  ];
  const results = await Promise.all(urls.map((u) => getJson(u).then((d) => d.jobs || []).catch(() => [])));
  return results.flat().map((j) => ({
    source: 'Remotive',
    company: j.company_name,
    title: j.title,
    url: j.url,
    location: j.candidate_required_location || 'Remote',
    description: strip(j.description),
    remoteOnly: REMOTE_ONLY,
  }));
}

async function arbeitnow() {
  const { data = [] } = await getJson('https://www.arbeitnow.com/api/job-board-api');
  return data.filter((j) => j.remote).map((j) => ({
    source: 'Arbeitnow',
    company: j.company_name,
    title: j.title,
    url: j.url,
    location: j.location || 'Remote',
    description: strip(j.description),
    remoteOnly: REMOTE_ONLY,
  }));
}

async function himalayas() {
  const { jobs = [] } = await getJson('https://himalayas.app/jobs/api?limit=100');
  return jobs.map((j) => ({
    source: 'Himalayas',
    company: j.companyName,
    title: j.title,
    url: j.applicationLink || j.guid,
    location: (j.locationRestrictions || []).join(', ') || 'Remote',
    description: strip(j.excerpt || j.description),
    remoteOnly: REMOTE_ONLY,
  }));
}

async function jobicy() {
  // Jobicy supports a geo filter, so ask it directly for the regions that can
  // actually hire you instead of filtering a US-heavy firehose afterwards.
  const urls = [
    'https://jobicy.com/api/v2/remote-jobs?industry=dev&count=50',
    'https://jobicy.com/api/v2/remote-jobs?geo=europe&count=50',
    'https://jobicy.com/api/v2/remote-jobs?geo=emea&count=50',
  ];
  const results = await Promise.all(urls.map((u) => getJson(u).then((d) => d.jobs || []).catch(() => [])));
  return results.flat().map((j) => ({
    source: 'Jobicy',
    company: j.companyName,
    title: j.jobTitle,
    url: j.url,
    location: j.jobGeo || 'Remote',
    description: strip(j.jobExcerpt || j.jobDescription),
    remoteOnly: REMOTE_ONLY,
  }));
}

/**
 * HubMub has no API, but its listing pages are plain server-rendered HTML and
 * robots.txt allows crawling. Listings carry title/company/country; the full
 * description lives on the detail page, so those are fetched only for the
 * postings that actually look like iOS roles.
 */
async function hubmub() {
  const html = async (url) => {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.text();
  };

  const decode = (s = '') => s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();

  // categories[]=30 is HubMub's software/engineering category.
  const searches = ['ios', 'swift', 'swiftui'];
  const pages = [1, 2];
  const listUrls = searches.flatMap((q) =>
    pages.map((p) => `https://www.hubmub.com/jobs?search=${q}&type%5B%5D=Remote&categories%5B%5D=30&page=${p}`));

  const bodies = await Promise.all(listUrls.map((u) => html(u).catch(() => '')));

  const found = new Map(); // url -> job, dedupes across the search terms
  for (const body of bodies) {
    // Each card opens with a full-bleed anchor to the job detail page.
    const cards = body.split(/<a href="https:\/\/www\.hubmub\.com\/jobs\//).slice(1);
    for (const card of cards) {
      const urlMatch = card.match(/^([^"]+)"/);
      if (!urlMatch) continue;
      const url = `https://www.hubmub.com/jobs/${decode(urlMatch[1])}`;

      const title = decode((card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1] || '')
        .replace(/<[^>]+>/g, '').trim();
      const company = decode((card.match(/alt="([^"]*)"/) || [])[1] || '');
      // Country sits in a span right after its flag emoji.
      const country = decode((card.match(/[\u{1F1E6}-\u{1F1FF}]{2}<\/span>\s*<span class="truncate">([^<]+)<\/span>/u) || [])[1] || '');

      if (!title || !company) continue;
      found.set(url, {
        source: 'HubMub',
        company,
        title,
        url,
        // Cards tagged Remote with no country are worldwide-remote.
        location: country || 'Remote',
        description: '',
        remoteOnly: /<span>Remote<\/span>/.test(card) ? REMOTE_ONLY : false,
      });
    }
  }

  // Only pay for detail pages on postings that read as iOS roles.
  const candidates = [...found.values()]
    .filter((j) => /\b(ios|swift|swiftui|apple|mobile)\b/i.test(j.title))
    .slice(0, 25);

  await Promise.all(candidates.map(async (job) => {
    try {
      const page = await html(job.url);
      const prose = page.match(/<div class="prose[^"]*">([\s\S]*?)<\/div>/);
      if (prose) job.description = strip(decode(prose[1])).slice(0, 8000);
    } catch { /* description is optional; the listing data still stands */ }
  }));

  return candidates;
}

async function workingnomads() {
  const rows = await getJson('https://www.workingnomads.com/api/exposed_jobs/');
  return (rows || []).map((j) => ({
    source: 'WorkingNomads',
    company: j.company_name,
    title: j.title,
    url: j.url,
    location: j.location || 'Remote',
    description: strip(j.description),
    remoteOnly: REMOTE_ONLY,
  }));
}

async function weworkremotely() {
  const feed = await rss.parseURL('https://weworkremotely.com/categories/remote-programming-jobs.rss');
  return (feed.items || []).map((i) => {
    // WWR titles are "Company: Job Title"
    const [company, ...rest] = (i.title || '').split(':');
    return {
      source: 'WeWorkRemotely',
      company: rest.length ? company.trim() : 'Unknown',
      title: (rest.join(':') || i.title || '').trim(),
      url: i.link,
      location: 'Remote',
      description: strip(i.contentSnippet || i.content),
      remoteOnly: REMOTE_ONLY,
    };
  });
}

// ------------------------------------------- company career pages (ATS APIs)

async function greenhouse(token) {
  const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
  return (data.jobs || []).map((j) => ({
    source: `Greenhouse:${token}`,
    company: token,
    title: j.title,
    url: j.absolute_url,
    location: j.location?.name || '',
    description: strip(j.content),
  }));
}

async function lever(token) {
  const rows = await getJson(`https://api.lever.co/v0/postings/${token}?mode=json`);
  return (rows || []).map((j) => ({
    source: `Lever:${token}`,
    company: token,
    title: j.text,
    url: j.hostedUrl,
    location: j.categories?.location || '',
    description: strip(j.descriptionPlain || j.description),
  }));
}

// ------------------------------------------------------------------ fan-out

export async function fetchAllJobs(log = console.log) {
  const companies = JSON.parse(fs.readFileSync(path.join(ROOT, 'companies.json'), 'utf8'));

  const tasks = [
    ['RemoteOK', remoteok],
    ['Remotive', remotive],
    ['Arbeitnow', arbeitnow],
    ['Himalayas', himalayas],
    ['Jobicy', jobicy],
    ['HubMub', hubmub],
    ['WorkingNomads', workingnomads],
    ['WeWorkRemotely', weworkremotely],
    ...companies.greenhouse.map((t) => [`Greenhouse:${t}`, () => greenhouse(t)]),
    ...companies.lever.map((t) => [`Lever:${t}`, () => lever(t)]),
  ];

  const settled = await Promise.allSettled(tasks.map(([, fn]) => fn()));

  const jobs = [];
  for (const [i, result] of settled.entries()) {
    const name = tasks[i][0];
    if (result.status === 'fulfilled') {
      log(`  ${name}: ${result.value.length} postings`);
      jobs.push(...result.value.filter((j) => j.company && j.title && j.url));
    } else {
      // One dead board must never sink the whole run.
      log(`  ${name}: FAILED (${result.reason?.message ?? result.reason})`);
    }
  }
  return jobs;
}

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
  const { jobs = [] } = await getJson('https://jobicy.com/api/v2/remote-jobs?industry=dev&count=50');
  return jobs.map((j) => ({
    source: 'Jobicy',
    company: j.companyName,
    title: j.jobTitle,
    url: j.url,
    location: j.jobGeo || 'Remote',
    description: strip(j.jobExcerpt || j.jobDescription),
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

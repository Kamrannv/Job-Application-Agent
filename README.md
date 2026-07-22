# iOS Job Bot

Searches ~25 job boards every morning for **remote iOS roles you can actually be
hired into from Azerbaijan**, skips anything you've already seen, writes a cover
letter tailored to each posting, and sends you a Telegram card with **✅ Apply**
and **⏭ Skip** buttons. Tapping ✅ fills and submits the real application form.
At 21:00 you get a report.

You never search. You tap.

## What counts as a match

The hard part isn't finding iOS jobs — it's discarding the ~95% that say
"remote" but mean "remote *within the United States*". A posting has to clear
three gates:

1. **Genuinely iOS** — Swift, SwiftUI, UIKit, Objective-C or Xcode in the role,
   not just "mobile"
2. **Genuinely remote** — not hybrid, not on-site
3. **Geographically open to you** — see below. This is the strictest gate.

`src/geo.js` requires *positive evidence* that a role hires beyond one country:

Three tiers, not a yes/no:

| Location says | Verdict | Card shows |
|---|---|---|
| Worldwide / Anywhere / Global | ✅ open | 🌍 Open region |
| EMEA / Europe / CEE / CIS / Caucasus | ✅ open | 🌍 Open region |
| Azerbaijan | ✅ open | 🌍 Open region |
| Bare "Remote", no country named | ✅ open | 🌍 Open region |
| Poland / Spain / UK / UAE / Turkey / Georgia … | ⚠️ plausible | ⚠️ *X*-scoped |
| United States, Canada, US city or state | ❌ rejected | — |
| India, Singapore, Australia, Brazil … | ❌ rejected | — |
| Body demands US/EU/UK work authorization | ❌ rejected | — |

The middle tier matters. A role posted as "Poland" is not guaranteed, but
European and CIS employers routinely engage remote contractors across the
region and the timezone works — so it is surfaced with a ⚠️ label and you
decide. Far countries are rejected outright: timezone, payroll, and visa all
bite, and you said US and Canada remote are useless.

Note that one role often appears once per country (Ruby Labs "Lead iOS
Engineer" is listed for Poland, Lithuania and Latvia). Deduplication is by
company + title, so you see it once.

---

## Setup — 5 steps

### 1. Get a Telegram bot token

Open Telegram, message **@BotFather**, send `/newbot`, follow the prompts.
It replies with a token like `8123456789:AAH...`.

### 2. Get your chat ID

Send your bot any message in Telegram, then run `npm run chatid`. It finds the ID
and writes it into `.env` for you.

### 3. Get an Anthropic API key

[console.anthropic.com](https://console.anthropic.com) → API keys → Create key.

### 4. Fill in your details

```bash
cd ~/Desktop/JobApplication
cp .env.example .env
cp profile.example.json profile.json
open -e .env            # paste the three values from steps 1–3
open -e profile.json    # your name, phone, LinkedIn, GitHub, portfolio
```

Both `.env` and `profile.json` are gitignored — your details never leave this Mac.

Then add your resume in **both** formats — the PDF gets uploaded to application
forms, the Markdown is what the cover letter writer reads (the `resume/` folder
is gitignored too):

- `resume/resume.pdf` — your actual resume file
- `resume/resume.md` — the same content as plain text

### 5. Start it

```bash
npm start
```

You should get a Telegram message saying the bot is online.

---

## Everyday use

| What you do | What happens |
|---|---|
| Nothing, at 09:00 | Bot searches, writes letters, sends you job cards |
| Tap **✅ Apply** | Browser opens, fills the form, uploads your resume, submits, sends you a screenshot |
| Tap **⏭ Skip** | Job is marked skipped and never shown again |
| Tap **🔄 Rewrite letter** | Generates a different cover letter for that job |
| Send `/search` | Searches every board right now, without waiting for tomorrow |
| Send `/pending` | Re-sends anything still awaiting your decision |
| Send `/report` | Today's summary on demand |
| Send `/stats` | Totals: applied / skipped / failed |
| Send `/help` | The command list |
| Nothing, at 21:00 | Daily report arrives |

`/search` is safe to run as often as you like — already-seen jobs are never
sent twice, so a repeat search costs nothing unless something new appeared.
Only one search runs at a time; a second request is told to wait.

### Useful commands

```bash
npm run check     # dry run: see today's matches, no Telegram, no applying
npm run search    # force a search right now
npm run report    # force the daily report right now
```

---

## What it can and can't submit automatically

| Platform | Auto-apply |
|---|---|
| Greenhouse | ✅ Yes |
| Lever | ✅ Yes |
| Ashby, Workable, Workday, custom sites | ❌ Sent to you as "finish this yourself" with the letter ready to paste |

Roughly 60–70% of startup iOS jobs run on Greenhouse or Lever. The rest still get
found and still get a cover letter — you just paste it yourself.

**LinkedIn and Indeed are deliberately not included.** Scraping them violates their
terms and gets accounts restricted.

---

## Expect very few jobs, and that is correct

A live run found **2,433 postings** across all sources. Exactly **1** was a
senior iOS role that was both genuinely remote and genuinely open to a candidate
in Azerbaijan.

That is not the filter failing — that is the market. Most "remote" iOS jobs are
remote-within-the-US. Filtering them out is the single most valuable thing this
bot does, because every one it discards is an application that could never have
succeeded.

Expect **0–2 matches per day**, and many days with none. Some weeks will be
empty. The value is that you stop checking, and when a genuinely open role
appears you hear about it that morning with the letter already written.

If you want more volume, in order of impact:

1. **Add companies to `companies.json`** — especially EU and remote-first ones
2. **Loosen `src/geo.js`** — e.g. accept single European countries if you would
   consider relocating
3. **Widen `src/match.js`** — accept mid-level as well as senior roles

---

## Tuning

| File | What to change |
|---|---|
| `companies.json` | Add companies you want to work at (biggest impact on results) |
| `src/match.js` | Which titles count as iOS, what counts as remote, exclusions |
| `src/letter.js` | The cover letter style and rules |
| `.env` | Search/report times, daily cap, `HEADLESS=false` to watch the browser |

**First few applications: set `HEADLESS=false` in `.env`.** You'll see the browser
fill each form in real time, which is the fastest way to confirm it's doing the
right thing before you trust it.

---

## Running all day

The bot must be running for the Telegram buttons to respond. To keep it alive
across restarts and logins:

```bash
./install-autostart.sh
```

This registers it with macOS `launchd` so it starts at login and restarts if it
crashes. Logs land in `data/bot.log`. To stop it:

```bash
launchctl unload ~/Library/LaunchAgents/com.kamran.iosjobbot.plist
```

Note: your Mac must be awake and online. Closing the lid pauses everything until
you open it again — the 09:00 search will simply run late rather than be skipped.

---

## Cost

Cover letters are the only paid part: roughly **$0.10–0.20 per letter**, so about
**$1–4/month** at typical volume. The `MAX_JOBS_PER_DAY` cap in `.env` bounds the
worst case. Everything else — job boards, Telegram, Playwright — is free.

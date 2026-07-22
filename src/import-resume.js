/**
 * One-time setup: reads your resume PDF and writes resume/resume.md plus the
 * contact fields in profile.json, so you don't have to retype anything.
 *
 *   npm run import-resume
 *
 * Re-run it any time you update the PDF.
 */
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { config, ROOT } from './config.js';

if (!config.anthropicKey) {
  console.error('ANTHROPIC_API_KEY is not set in .env');
  process.exit(1);
}
if (!fs.existsSync(config.resumePdf)) {
  console.error('No PDF found in resume/ — drop your resume there first.');
  process.exit(1);
}

console.log(`Reading ${path.basename(config.resumePdf)} …`);

const client = new Anthropic({ apiKey: config.anthropicKey });
const pdf = fs.readFileSync(config.resumePdf).toString('base64');

const message = await client.messages.create({
  model: 'claude-opus-4-8',
  max_tokens: 8000,
  output_config: {
    format: {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          resumeMarkdown: {
            type: 'string',
            description: 'The complete resume as clean Markdown. Preserve every job, date, bullet, skill and project. Do not summarise or omit anything.',
          },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          linkedin: { type: 'string' },
          github: { type: 'string' },
          portfolio: { type: 'string' },
          location: { type: 'string' },
          yearsExperience: { type: 'string' },
        },
        required: ['resumeMarkdown', 'firstName', 'lastName', 'email'],
        additionalProperties: false,
      },
    },
  },
  messages: [{
    role: 'user',
    content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } },
      {
        type: 'text',
        text: 'Transcribe this resume into Markdown and extract the contact details. '
            + 'Copy the content faithfully — every role, date, bullet point, and skill. '
            + 'Leave a field as an empty string if it genuinely is not in the document. '
            + 'Do not invent anything.',
      },
    ],
  }],
});

if (message.stop_reason === 'refusal') {
  console.error('The model declined to read this document.');
  process.exit(1);
}

const data = JSON.parse(message.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));

fs.writeFileSync(config.resumeTextPath, data.resumeMarkdown.trim() + '\n');
console.log(`Wrote resume/resume.md (${data.resumeMarkdown.length} chars)`);

const profilePath = path.join(ROOT, 'profile.json');
const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
const filled = [];
for (const key of ['firstName', 'lastName', 'email', 'phone', 'linkedin', 'github', 'portfolio', 'location', 'yearsExperience']) {
  // Never overwrite something you already typed in by hand.
  if (data[key] && !profile[key]) {
    profile[key] = data[key];
    filled.push(key);
  }
}
fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n');

console.log(filled.length ? `Filled in profile.json: ${filled.join(', ')}` : 'profile.json already complete');

const stillEmpty = ['phone', 'linkedin', 'github', 'portfolio'].filter((k) => !profile[k]);
if (stillEmpty.length) {
  console.log(`\nNot found in the PDF — add by hand if you have them: ${stillEmpty.join(', ')}`);
}

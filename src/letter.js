import Anthropic from '@anthropic-ai/sdk';
import { config, profile, resumeText } from './config.js';

const client = new Anthropic({ apiKey: config.anthropicKey });

const SYSTEM = `You write cover letters for a specific iOS engineer applying to a specific job.

Rules:
- 150-220 words. Three short paragraphs. No greeting line beyond "Dear Hiring Team," and no sign-off block beyond the candidate's name.
- Ground every claim in the resume. Never invent employers, dates, metrics, or technologies the candidate has not listed.
- Paragraph 1: the role and why this specific company, referencing something concrete from the job description.
- Paragraph 2: the two or three most relevant things from the resume, tied to what the posting actually asks for.
- Paragraph 3: one sentence of closing interest.
- Plain, direct language. No "I am writing to express my enthusiasm", no "passionate", no "leverage", no "synergy".
- Output only the letter body. No preamble, no commentary, no markdown formatting.`;

export async function writeCoverLetter(job) {
  const message = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 2000,
    system: SYSTEM,
    output_config: { effort: 'medium' },
    messages: [{
      role: 'user',
      content: `CANDIDATE NAME: ${profile.firstName} ${profile.lastName}

RESUME:
${resumeText}

---

JOB POSTING
Company: ${job.company}
Title: ${job.title}
Location: ${job.location}

Description:
${(job.description || '').slice(0, 6000)}

---

Write the cover letter.`,
    }],
  });

  if (message.stop_reason === 'refusal') {
    throw new Error('Model declined to write this letter');
  }
  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

/**
 * Finds your Telegram chat ID without needing a second bot.
 *
 *   1. Open Telegram, find your bot, send it any message (e.g. "hi")
 *   2. npm run chatid
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';

if (!config.telegramToken) {
  console.error('TELEGRAM_BOT_TOKEN is not set in .env');
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/getUpdates`);
const { ok, result = [] } = await res.json();

if (!ok) {
  console.error('Telegram rejected the token. Check TELEGRAM_BOT_TOKEN in .env');
  process.exit(1);
}

const chats = new Map();
for (const u of result) {
  const chat = u.message?.chat || u.edited_message?.chat || u.callback_query?.message?.chat;
  if (chat) chats.set(chat.id, chat);
}

if (!chats.size) {
  console.log('No messages yet.\n\nOpen Telegram, send your bot any message, then run this again.');
  process.exit(0);
}

for (const [id, chat] of chats) {
  console.log(`Chat ID: ${id}   (${chat.first_name || chat.title || chat.username || 'unknown'})`);
}

// Write it straight into .env so there is nothing to copy by hand.
const [id] = [...chats.keys()];
const envPath = path.join(ROOT, '.env');
const env = fs.readFileSync(envPath, 'utf8');
fs.writeFileSync(envPath, env.replace(/^TELEGRAM_CHAT_ID=.*$/m, `TELEGRAM_CHAT_ID=${id}`));
console.log(`\nSaved TELEGRAM_CHAT_ID=${id} to .env`);

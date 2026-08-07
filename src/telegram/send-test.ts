import 'dotenv/config';
import { TelegramService } from './telegram.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
if (!token || !chatId) {
  throw new Error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env first.');
}

const telegram = new TelegramService(token, chatId);
const messageId = await telegram.sendTestMessage();
console.log(`Telegram test message sent successfully (message_id=${messageId}).`);

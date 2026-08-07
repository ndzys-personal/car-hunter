import 'dotenv/config';

interface Update {
  message?: { chat?: { id?: number; type?: string; title?: string; username?: string } };
}

interface UpdatesResponse {
  ok: boolean;
  result?: Update[];
  description?: string;
}

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Set TELEGRAM_BOT_TOKEN in .env first.');
  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  const payload = (await response.json()) as UpdatesResponse;
  if (!response.ok || !payload.ok)
    throw new Error(payload.description ?? 'Telegram getUpdates failed');
  const chats = new Map<number, NonNullable<Update['message']>['chat']>();
  for (const update of payload.result ?? []) {
    const chat = update.message?.chat;
    if (chat?.id) chats.set(chat.id, chat);
  }
  if (!chats.size) {
    console.log('No chats found. Send the bot a message and run this command again.');
    return;
  }
  for (const [id, chat] of chats) {
    console.log(`${id}\t${chat?.type ?? ''}\t${chat?.title ?? chat?.username ?? ''}`);
  }
}

await main();

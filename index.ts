import { loadConfig } from "./config/env.js";
import { TelegramService } from "./services/telegram.service.js";
import { OpenAIService } from "./services/openai.service.js";
import { ChatStorageService } from "./services/chat-storage.service.js";
import { MessageHandler } from "./handlers/message.handler.js";
import { MemberHandler } from "./handlers/member.handler.js";
import type { Message } from "./types/message.types.js";

const config = loadConfig();

const telegramService = new TelegramService(config);
const openaiService = new OpenAIService(config.openaiApiKey);
const chatStorage = new ChatStorageService(config);
const messageHandler = new MessageHandler(
  telegramService,
  openaiService,
  chatStorage,
  config
);
const memberHandler = new MemberHandler(
  telegramService,
  chatStorage,
  config
);

telegramService.initialize().then(async () => {
  console.log(
    `✅ Бот @${telegramService.botUsername} (${config.name}) запущен и готов к работе!`
  );
  console.log(
    `⚠️  ВАЖНО: Для работы в группах отключите Privacy Mode через BotFather:`
  );
  console.log(`   1. Напишите @BotFather в Telegram`);
  console.log(`   2. Отправьте /mybots`);
  console.log(`   3. Выберите вашего бота`);
  console.log(`   4. Bot Settings → Group Privacy → Turn OFF`);

  const chats = chatStorage.loadChats();
  if (chats.size > 0) {
    console.log(`📤 Отправка сообщения о запуске в ${chats.size} чат(ов)...`);
    for (const chatIdStr of chats) {
      try {
        if (chatIdStr === config.targetChatId) {
          await telegramService.sendMessage(chatIdStr, config.startupMessage);
          console.log(`✅ Сообщение отправлено в чат ${chatIdStr}`);
        }
      } catch (error: any) {
        console.error(
          `❌ Ошибка при отправке в чат ${chatIdStr}:`,
          error.message || error
        );
      }
    }
  }
}).catch((error: Error) => {
  console.error("❌ Ошибка при получении информации о боте:", error);
  process.exit(1);
});

telegramService.onMessage(async (msg: Message) => {
  await messageHandler.handleMessage(msg);
});

telegramService.onNewChatMembers(async (msg: Message) => {
  await memberHandler.handleNewChatMembers(msg);
});

telegramService.onLeftChatMember((msg: Message) => {
  memberHandler.handleLeftChatMember(msg);
});

telegramService.onPollingError((error: Error) => {
  console.error("❌ Ошибка polling:", error);
});

telegramService.onError((error: Error) => {
  console.error("❌ Ошибка бота:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});

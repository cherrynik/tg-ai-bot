import { loadConfig } from "./config/env.js";
import { TelegramService } from "./services/telegram.service.js";
import { OpenAIService } from "./services/openai.service.js";
import { ChatStorageService } from "./services/chat-storage.service.js";
import { UserStorageService } from "./services/user-storage.service.js";
import { MessageHandler } from "./handlers/message.handler.js";
import { MemberHandler } from "./handlers/member.handler.js";
import type { Message } from "./types/message.types.js";

const config = loadConfig();

const telegramService = new TelegramService(config);
const openaiService = new OpenAIService(config.openaiApiKey);
const chatStorage = new ChatStorageService(config);
const userStorage = new UserStorageService(config);
const messageHandler = new MessageHandler(
  telegramService,
  openaiService,
  chatStorage,
  userStorage,
  config
);
const memberHandler = new MemberHandler(
  telegramService,
  chatStorage,
  userStorage,
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
          await telegramService.sendMessage(
            chatIdStr,
            `✅ ${config.name} включён и готов к работе! 🚀`
          );
          console.log(`✅ Сообщение о запуске отправлено в чат ${chatIdStr}`);
        }
      } catch (error: any) {
        console.error(
          `❌ Ошибка при отправке в чат ${chatIdStr}:`,
          error.message || error
        );
      }
    }
  } else {
    console.log("ℹ️  Бот ещё не добавлен в групповой чат. Добавьте бота в группу для начала работы.");
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

// Обработка завершения процесса
async function sendShutdownMessage() {
  try {
    const chats = chatStorage.loadChats();
    if (chats.size > 0) {
      console.log(`📤 Отправка сообщения об отключении в ${chats.size} чат(ов)...`);
      for (const chatIdStr of chats) {
        try {
          if (chatIdStr === config.targetChatId) {
            await telegramService.sendMessage(
              chatIdStr,
              `⚠️ ${config.name} отключён. Бот временно не работает.`
            );
            console.log(`✅ Сообщение об отключении отправлено в чат ${chatIdStr}`);
          }
        } catch (error: any) {
          console.error(
            `❌ Ошибка при отправке сообщения об отключении в чат ${chatIdStr}:`,
            error.message || error
          );
        }
      }
    }
  } catch (error) {
    console.error("❌ Ошибка при отправке сообщений об отключении:", error);
  }
}

// Обработка сигналов завершения
process.on("SIGINT", async () => {
  console.log("\n⚠️  Получен сигнал SIGINT, отправляю сообщения об отключении...");
  await sendShutdownMessage();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n⚠️  Получен сигнал SIGTERM, отправляю сообщения об отключении...");
  await sendShutdownMessage();
  process.exit(0);
});

// Обработка необработанных исключений
process.on("uncaughtException", async (error) => {
  console.error("❌ Uncaught Exception:", error);
  await sendShutdownMessage();
  process.exit(1);
});

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram/tl/index.js";
import { NewMessage } from "telegram/events/index.js";
import OpenAI from "openai";
import dotenv from "dotenv";
import { readFileSync, writeFileSync, existsSync } from "fs";
import prompt from "prompt-sync";

dotenv.config();

const BOT_NAME: string = process.env.BOT_NAME || "AI Assistant";
const API_ID: number = parseInt(process.env.API_ID || "0");
const API_HASH: string = process.env.API_HASH || "";
const SESSION_STRING: string = process.env.SESSION_STRING || "";
const OPENAI_API_KEY: string | undefined = process.env.OPENAI_API_KEY;
const TARGET_CHAT_ID: string = process.env.TARGET_CHAT_ID || "-100336528885";
const STARTUP_MESSAGE: string =
  process.env.STARTUP_MESSAGE || `Привет! Я ${BOT_NAME}, готов к работе! 🚀`;
const CHATS_FILE = "chats.json";

if (!API_ID || !API_HASH) {
  console.error(
    "Ошибка: API_ID и API_HASH не установлены в переменных окружения"
  );
  console.error(
    "Получите их на https://my.telegram.org/apps после регистрации"
  );
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error("Ошибка: OPENAI_API_KEY не установлен в переменных окружения");
  process.exit(1);
}

const stringSession = new StringSession(SESSION_STRING);
const client = new TelegramClient(stringSession, API_ID, API_HASH, {
  connectionRetries: 5,
});

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

const userContexts = new Map<number, ConversationMessage[]>();
let botUsername: string | null = null;
let botId: number | null = null;

function loadChats(): Set<string> {
  if (existsSync(CHATS_FILE)) {
    try {
      const data = readFileSync(CHATS_FILE, "utf-8");
      const chats = JSON.parse(data);
      return new Set(Array.isArray(chats) ? chats : []);
    } catch (error) {
      console.error("Ошибка при чтении файла чатов:", error);
      return new Set();
    }
  }
  return new Set();
}

function saveChat(chatId: string): void {
  const chats = loadChats();
  chats.add(chatId);
  try {
    writeFileSync(
      CHATS_FILE,
      JSON.stringify(Array.from(chats), null, 2),
      "utf-8"
    );
  } catch (error) {
    console.error("Ошибка при сохранении чата:", error);
  }
}


async function transcribeMediaMessage(mediaMessage: Api.Message): Promise<string | null> {
  try {
    const hasVoice = mediaMessage.voice !== undefined;
    const hasVideo = mediaMessage.video !== undefined;
    const hasMedia = mediaMessage.media !== undefined;

    if (!hasVoice && !hasVideo && !hasMedia) {
      return null;
    }

    let mimeType = "audio/ogg";
    let fileName = "voice.ogg";

    if (hasVideo) {
      mimeType = "video/mp4";
      fileName = "video.mp4";
    } else if (hasMedia && mediaMessage.media instanceof Api.MessageMediaDocument) {
      const media = mediaMessage.media;
      const document = media.document;
      if (document instanceof Api.Document) {
        mimeType = document.mimeType || "audio/ogg";
        if (mimeType.startsWith("video/")) {
          fileName = "video.mp4";
        } else if (mimeType.startsWith("audio/")) {
          fileName = "audio.ogg";
        }
      }
    }

    const buffer = await client.downloadMedia(mediaMessage, {});
    if (!buffer) {
      console.error("Не удалось скачать медиа сообщение");
      return null;
    }

    const bufferData = buffer instanceof Buffer ? buffer : Buffer.from(buffer as any);
    const blob = new Blob([bufferData], { type: mimeType });
    const file = new File([blob], fileName, { type: mimeType });
    
    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: "whisper-1",
      language: "ru",
    });

    return transcription.text;
  } catch (error) {
    console.error("Ошибка при транскрипции медиа сообщения:", error);
    return null;
  }
}

async function checkIfAddressed(messageText: string): Promise<boolean> {
  try {
    const systemPrompt = `Ты полезный AI-ассистент по имени ${BOT_NAME}. 

КРИТИЧЕСКИ ВАЖНО: Анализируй ТОЛЬКО последнее сообщение. Твоя задача - определить, обращаются ли к тебе.

Отвечай ТОЛЬКО если к тебе обращаются напрямую по имени "${BOT_NAME}" или если сообщение явно адресовано тебе. 

Если сообщение НЕ адресовано тебе (не содержит твоего имени или прямого обращения к тебе), верни ТОЛЬКО слово "SKIP" без каких-либо других символов или текста. 

Если обращаются к тебе, верни ТОЛЬКО слово "ANSWER" без каких-либо других символов или текста.

НЕ ищи информацию, НЕ отвечай на вопросы - только определи, обращаются ли к тебе.`;

    const completion = await openai.responses.create({
      model: "gpt-5.2",
      input: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: messageText,
        },
      ],
      temperature: 0.3,
    });

    const response = completion.output.find((item) => 'content' in item)?.content[0].text;
    const isAddressed = response?.trim().toUpperCase() === "ANSWER";
    console.log(`🔍 Проверка обращения: "${messageText.substring(0, 50)}..." -> ${isAddressed ? "ANSWER" : "SKIP"}`);
    return isAddressed;
  } catch (error) {
    console.error("Ошибка при проверке обращения:", error);
    return false;
  }
}

async function getAIResponse(
  userId: number,
  messageText: string,
  contextMessages?: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>,
  mainMessage?: string
): Promise<string> {
  try {
    let systemPrompt = `Ты полезный AI-ассистент по имени ${BOT_NAME}${botUsername ? ` (@${botUsername})` : ""}. Отвечай дружелюбно и по делу.`;

    if (mainMessage) {
      systemPrompt += `\n\nВАЖНО: Пользователь отвечает на конкретное сообщение. Твой ответ должен быть СФОКУСИРОВАН на этом сообщении. Это основное сообщение, на которое нужно ответить:\n\n"${mainMessage}"\n\nОстальные сообщения ниже - это только контекст для понимания общей ситуации в беседе. Но твой ответ должен быть именно на основное сообщение выше.`;
    }

    const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
      {
        role: "system",
        content: systemPrompt,
      },
    ];

    if (contextMessages && contextMessages.length > 0) {
      const contextOnly = contextMessages.filter(
        (msg) => !msg.content.includes("[ОСНОВНОЕ СООБЩЕНИЕ]")
      );
      messages.push(...contextOnly);
    }

    messages.push({
      role: "user",
      content: messageText,
    });

    const completion = await openai.responses.create({
      model: "o3",
      tools: [{ type: "web_search" }],
      input: messages,
      // temperature: 0.7,
    });

    const aiResponse = completion.output.find((item) => 'content' in item)?.content[0].text;

    if (!aiResponse) {
      return "Извините, не удалось получить ответ от AI.";
    }

    return aiResponse;
  } catch (error) {
    console.error("Ошибка OpenAI API:", error);
    return "Извините, произошла ошибка при обработке запроса.";
  }
}


(async () => {
  console.log("🚀 Запуск userbot...");

  const input = prompt();
  await client.start({
    phoneNumber: async () => input("Введите номер телефона: ") || "",
    password: async () => input("Введите пароль (если есть): ") || "",
    phoneCode: async () =>
      input("Введите код подтверждения из Telegram: ") || "",
    onError: (err: Error) => console.error("Ошибка авторизации:", err),
  });

  console.log("✅ Userbot авторизован!");

  const me = (await client.getMe()) as Api.User;
  botUsername = me.username || null;
  botId = me.id?.toJSNumber() || null;

  console.log(`✅ Userbot @${botUsername} (${BOT_NAME}) готов к работе!`);
  console.log(
    `📌 Userbot видит ВСЕ сообщения в группах без ограничений Privacy Mode!`
  );

  const sessionString = client.session.save();
  if (typeof sessionString === "string" && sessionString !== SESSION_STRING) {
    console.log("\n⚠️  ВАЖНО: Сохраните SESSION_STRING в .env файл:");
    console.log(`SESSION_STRING=${sessionString}\n`);
  }

  const chats = loadChats();
  if (chats.size > 0) {
    console.log(`📤 Отправка сообщения о запуске в ${chats.size} чат(ов)...`);
    for (const chatIdStr of chats) {
      try {
        if (chatIdStr === TARGET_CHAT_ID) {
          const entity = await client.getEntity(chatIdStr);
          await client.sendMessage(entity, { message: STARTUP_MESSAGE });
          console.log(`✅ Сообщение отправлено в чат ${chatIdStr}`);
        }
      } catch (error: any) {
        console.error(`❌ Ошибка при отправке в чат ${chatIdStr}:`, error.message || error);
      }
    }
  }

  client.addEventHandler(async (event: NewMessage) => {
    const message = (event as any).message as Api.Message;
    if (!message || !(message instanceof Api.Message)) return;
    if (!message.text) return;

    const messageText = message.text;
    const chat = await message.getChat();

    let chatId: string = "";
    let chatTitle = "Без названия";

    if (chat instanceof Api.Chat) {
      chatId = chat.id.toString();
      chatTitle = chat.title || "Без названия";
    } else if (chat instanceof Api.Channel) {
      chatId = chat.id.toString();
      chatTitle = chat.title || "Без названия";
    } else if (chat instanceof Api.User) {
      chatId = chat.id.toString();
      chatTitle = chat.firstName || "Пользователь";
    }

    let currentChatId: string = "";

    if (chat instanceof Api.Channel) {
      currentChatId = chat.id.toString();
    } else if (chat instanceof Api.Chat) {
      currentChatId = chat.id.toString();
    } else {
      return;
    }

    if (currentChatId !== TARGET_CHAT_ID) {
      return;
    }

    console.log(
      `✅ Получено сообщение из целевого чата ${TARGET_CHAT_ID} (${chatTitle})`
    );

    const isGroup =
      chat instanceof Api.Chat ||
      (chat instanceof Api.Channel && !chat.broadcast);

    const userId = message.fromId;
    if (!userId || !(userId instanceof Api.PeerUser)) return;

    const userIdNumber = userId.userId.toJSNumber();

    if (isGroup) {
      saveChat(chatId);

      console.log(
        `\n📨 [${chatTitle}] (ID: ${chatId}): "${messageText.substring(
          0,
          50
        )}..."`
      );

      console.log(`🤔 Проверяю, обращаются ли к боту (только последнее сообщение)...`);

      const isAddressed = await checkIfAddressed(messageText);
      
      if (!isAddressed) {
        console.log(`ℹ️  Нейросеть определила, что обращение не к боту, пропускаю`);
        return;
      }

      console.log(`✅ Нейросеть определила обращение к боту, обрабатываю...`);

      if (message.replyTo) {
        try {
          const replyToMsgId = message.replyTo.replyToMsgId;
          if (replyToMsgId) {
            const replyMessages = await client.getMessages(chatId, {
              ids: [replyToMsgId],
            });

            if (
              replyMessages.length > 0 &&
              replyMessages[0] instanceof Api.Message
            ) {
              const replyMsg = replyMessages[0];
              
              const isMediaMessage = 
                replyMsg.voice !== undefined ||
                replyMsg.video !== undefined ||
                (replyMsg.media instanceof Api.MessageMediaDocument && 
                 replyMsg.media.document instanceof Api.Document &&
                 (replyMsg.media.document.mimeType?.startsWith("audio/") || 
                  replyMsg.media.document.mimeType?.startsWith("video/") ||
                  replyMsg.media.document.mimeType === "audio/ogg"));

              if (isMediaMessage) {
                const mediaType = replyMsg.video ? "видео" : "голосовое";
                console.log(`🎤 Обнаружен ответ на ${mediaType} сообщение, проверяю запрос...`);
                
                const transcriptionPrompt = `Пользователь отвечает на ${mediaType} сообщение (голосовое или видео) и пишет: "${messageText}".

ВАЖНО: Если пользователь задает вопрос о содержимом ${mediaType} сообщения (например: "что тут?", "что там?", "что сказано?", "что говорит?", "что здесь?", "о чем это?", "что в этом?"), или прямо просит транскрибировать/расшифровать - это ЗАПРОС НА ТРАНСКРИПЦИЮ.

Примеры запросов на транскрипцию:
- "что тут?" - ЗАПРОС
- "что там?" - ЗАПРОС  
- "что сказано?" - ЗАПРОС
- "расшифруй" - ЗАПРОС
- "транскрипция" - ЗАПРОС
- "переведи в текст" - ЗАПРОС
- "что говорит?" - ЗАПРОС

Если это запрос на транскрипцию - верни ТОЛЬКО слово "TRANSCRIBE".
Если это НЕ запрос на транскрипцию (например, обычный вопрос или комментарий) - верни ТОЛЬКО слово "SKIP".`;

                const transcriptionRequest = await getAIResponse(
                  userIdNumber,
                  transcriptionPrompt,
                  [],
                  undefined
                );

                if (transcriptionRequest && transcriptionRequest.trim().toUpperCase() === "TRANSCRIBE") {
                  console.log(`✅ Нейросеть определила запрос на транскрипцию`);
                  const transcription = await transcribeMediaMessage(replyMsg);
                  
                  if (transcription) {
                    await client.sendMessage(chat, {
                      message: transcription,
                      replyTo: message.id,
                    });
                    console.log(`✅ Транскрипция отправлена`);
                    return;
                  } else {
                    console.log(`⚠️  Не удалось транскрибировать ${mediaType} сообщение`);
                    return;
                  }
                } else {
                  console.log(`ℹ️  Нейросеть определила, что транскрипция не требуется`);
                }
              }
            }
          }
        } catch (error) {
          console.log(`⚠️  Ошибка при обработке запроса на транскрипцию:`, error);
        }
      }

      try {
        const contextMessages: Array<{
          role: "user" | "assistant" | "system";
          content: string;
        }> = [];
        let mainReplyMessage: string | undefined = undefined;

        if (message.replyTo) {
          try {
            const replyToMsgId = message.replyTo.replyToMsgId;
            if (replyToMsgId) {
              const replyMessages = await client.getMessages(chatId, {
                ids: [replyToMsgId],
              });

              if (
                replyMessages.length > 0 &&
                replyMessages[0] instanceof Api.Message
              ) {
                const replyMsg = replyMessages[0];
                if (replyMsg.text) {
                  mainReplyMessage = replyMsg.text;
                  contextMessages.push({
                    role: "user",
                    content: `[ОСНОВНОЕ СООБЩЕНИЕ - ОТВЕТЬ НА ЭТО] ${replyMsg.text}`,
                  });
                  console.log(`📎 Добавлено основное сообщение для ответа в контекст`);
                }
              }
            }
          } catch (error) {
            console.log(`⚠️  Не удалось получить сообщение для ответа:`, error);
          }
        }

        try {
          const recentMessages = await client.getMessages(chatId, {
            limit: 6,
          });

          const filteredMessages = recentMessages
            .filter(
              (msg) =>
                msg instanceof Api.Message && msg.text && msg.id !== message.id
            )
            .reverse()
            .slice(0, 5);

          for (const msg of filteredMessages) {
            if (msg instanceof Api.Message && msg.text) {
              const msgText = msg.text.substring(0, 300);
              const msgAuthor =
                msg.fromId instanceof Api.PeerUser
                  ? `Пользователь`
                  : "Неизвестно";
              contextMessages.push({
                role: "user",
                content: `[Предыдущее сообщение от ${msgAuthor}] ${msgText}`,
              });
            }
          }

          if (filteredMessages.length > 0) {
            console.log(
              `📚 Добавлено ${filteredMessages.length} предыдущих сообщений в контекст`
            );
          }
        } catch (error) {
          console.log(`⚠️  Не удалось получить историю сообщений:`, error);
        }

        const response = await getAIResponse(
          userIdNumber,
          messageText,
          contextMessages,
          mainReplyMessage
        );

        if (!response || response.trim() === "" || response.trim().toUpperCase() === "SKIP") {
          console.log(`ℹ️  Нейросеть определила, что обращение не к боту, пропускаю`);
          return;
        }

        console.log(`✅ Нейросеть определила обращение к боту, отвечаю...`);
        await client.sendMessage(chat, {
          message: response,
          replyTo: message.id,
        });
        console.log(`✅ Ответ отправлен в "${chatTitle}"`);
      } catch (error: any) {
        console.error(
          `❌ Ошибка при отправке в "${chatTitle}":`,
          error.message || error
        );
      }
    } else if (chat instanceof Api.User) {
      console.log(`📨 Личное сообщение: "${messageText.substring(0, 50)}..."`);
      try {
        const response = await getAIResponse(userIdNumber, messageText);
        await client.sendMessage(chatId, { message: response });
      } catch (error) {
        console.error("❌ Ошибка при отправке:", error);
      }
    }
  }, new NewMessage({}));

  console.log("👂 Userbot слушает сообщения...");
})();

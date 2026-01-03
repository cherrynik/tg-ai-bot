import type { Message, ConversationMessage } from "../types/message.types.js";
import type { TelegramService } from "../services/telegram.service.js";
import type { OpenAIService } from "../services/openai.service.js";
import type { ChatStorageService } from "../services/chat-storage.service.js";
import type { BotConfig } from "../types/config.types.js";
import {
  createAddressCheckPrompt,
  createSystemPrompt,
  createTranscriptionPrompt,
  createTrollCommentPrompt,
} from "../utils/prompts.js";
import {
  isMediaMessage,
  getMediaInfo,
  getMediaTypeLabel,
} from "../utils/media.utils.js";
import {
  getChatInfo,
  formatUserInfo,
  formatUserInfoDetailed,
} from "../utils/chat.utils.js";
import {
  CONTEXT_MESSAGE_LIMIT,
  MAX_CONTEXT_MESSAGE_LENGTH,
  MAX_MESSAGE_PREVIEW_LENGTH,
  TROLL_COMMENT_PROBABILITY,
  REACTION_PROBABILITY,
  AVAILABLE_REACTIONS,
} from "../config/constants.js";

export class MessageHandler {
  constructor(
    private telegramService: TelegramService,
    private openaiService: OpenAIService,
    private chatStorage: ChatStorageService,
    private config: BotConfig
  ) {}

  async handleMessage(msg: Message): Promise<void> {
    const chatId = msg.chat.id.toString();
    const messageText = msg.text;
    const userId = msg.from?.id;
    const chatTitle = (msg.chat as any).title || "Без названия";
    const chatType = msg.chat.type;

    if (!userId || !messageText) return;

    // if (chatId !== this.config.targetChatId) {
    //   return;
    // }

    const isGroupChat = msg.chat.type === "group";
    const isSupergroup = msg.chat.type === "supergroup";
    const isPrivateChat = msg.chat.type === "private";

    if (isGroupChat || isSupergroup) {
      await this.handleGroupMessage(msg, chatId, messageText, userId, chatTitle, chatType);
    } else if (isPrivateChat) {
      await this.handlePrivateMessage(msg, chatId, messageText, userId);
    }
  }

  private async handleGroupMessage(
    msg: Message,
    chatId: string,
    messageText: string,
    userId: number,
    chatTitle: string,
    chatType: string
  ): Promise<void> {
    this.chatStorage.saveChat(chatId);
    this.telegramService.addMessageToHistory(chatId, msg);

    // Случайная реакция на сообщение (только если это не сообщение бота)
    if (
      msg.from &&
      this.telegramService.botId &&
      msg.from.id !== this.telegramService.botId &&
      Math.random() < REACTION_PROBABILITY
    ) {
      const randomReaction =
        AVAILABLE_REACTIONS[
          Math.floor(Math.random() * AVAILABLE_REACTIONS.length)
        ];
      try {
        await this.telegramService.setMessageReaction(chatId, msg.message_id, [
          randomReaction,
        ]);
        console.log(`🎭 Установлена случайная реакция ${randomReaction} на сообщение`);
      } catch (error) {
        // Игнорируем ошибки реакций (могут быть ограничения API)
      }
    }

    console.log(
      `\n📨 [${chatTitle}] (${chatType}, ID: ${chatId}): "${messageText.substring(
        0,
        MAX_MESSAGE_PREVIEW_LENGTH
      )}..."`
    );

    // Проверяем, является ли сообщение ответом на сообщение бота
    const isReplyToBot = this.isReplyToBotMessage(msg);
    
    console.log(
      isReplyToBot
        ? `💬 Обнаружен ответ на сообщение бота, проверяю обращение через AI...`
        : `🤔 Проверяю, обращаются ли к боту (только последнее сообщение)...`
    );

    const addressPrompt = createAddressCheckPrompt(this.config.name, isReplyToBot);
    const isAddressed = await this.openaiService.checkIfAddressed(
      messageText,
      addressPrompt,
      isReplyToBot
    );

    if (!isAddressed) {
      console.log(`ℹ️  Нейросеть определила, что обращение не к боту, пропускаю`);
      
      // Случайный троллинг комментарий (только если не обращаются к боту)
      if (Math.random() < TROLL_COMMENT_PROBABILITY) {
        await this.handleTrollComment(msg, chatId, messageText, userId);
      }
      
      return;
    }

    console.log(`✅ Нейросеть определила обращение к боту, обрабатываю...`);

    if (msg.reply_to_message) {
      const transcriptionHandled = await this.handleTranscriptionRequest(
        msg,
        chatId,
        messageText,
        userId
      );
      if (transcriptionHandled) {
        return;
      }
    }

    await this.handleAIResponse(msg, chatId, messageText, userId, chatTitle);
  }

  private async handleTranscriptionRequest(
    msg: Message,
    chatId: string,
    messageText: string,
    userId: number
  ): Promise<boolean> {
    try {
      const replyMsg = msg.reply_to_message!;

      if (!isMediaMessage(replyMsg)) {
        return false;
      }

      const mediaInfo = getMediaInfo(replyMsg);
      if (!mediaInfo) {
        return false;
      }

      const mediaType = getMediaTypeLabel(mediaInfo);
      console.log(
        `🎤 Обнаружен ответ на ${mediaType} сообщение, проверяю запрос...`
      );

      const transcriptionPrompt = createTranscriptionPrompt(
        messageText,
        mediaType
      );

      const systemPrompt = createSystemPrompt(
        this.config.name,
        this.telegramService.botUsername
      );

      const transcriptionRequest = await this.openaiService.getResponse(
        transcriptionPrompt,
        [],
        systemPrompt
      );

      if (
        transcriptionRequest &&
        transcriptionRequest.trim().toUpperCase() === "TRANSCRIBE"
      ) {
        console.log(`✅ Нейросеть определила запрос на транскрипцию`);

        // Отправляем статус "печатает..." во время транскрипции
        await this.telegramService.sendChatAction(chatId, "typing");

        const bot = this.telegramService.getBot();
        const transcription = await this.openaiService.transcribeMedia(
          bot,
          mediaInfo.fileId,
          mediaInfo.mimeType
        );

        if (transcription) {
          await this.telegramService.sendMessage(chatId, transcription, {
            reply_to_message_id: msg.message_id,
          });
          console.log(`✅ Транскрипция отправлена`);
          return true;
        } else {
          console.log(
            `⚠️  Не удалось транскрибировать ${mediaType} сообщение`
          );
          return true;
        }
      } else {
        console.log(`ℹ️  Нейросеть определила, что транскрипция не требуется`);
        return false;
      }
    } catch (error) {
      console.log(`⚠️  Ошибка при обработке запроса на транскрипцию:`, error);
      return false;
    }
  }

  private async handleAIResponse(
    msg: Message,
    chatId: string,
    messageText: string,
    userId: number,
    chatTitle: string
  ): Promise<void> {
    try {
      // Отправляем статус "печатает..."
      await this.telegramService.sendChatAction(chatId, "typing");

      const contextMessages = this.buildContextMessages(msg, chatId);
      const mainReplyMessage = msg.reply_to_message?.text;
      const chatInfo = getChatInfo(msg);
      const usersInfo = this.buildUsersInfo(msg, chatId);

      const systemPrompt = createSystemPrompt(
        this.config.name,
        this.telegramService.botUsername,
        mainReplyMessage,
        chatInfo,
        usersInfo
      );

      const response = await this.openaiService.getResponse(
        messageText,
        contextMessages,
        systemPrompt
      );

      if (
        !response ||
        response.trim() === "" ||
        response.trim().toUpperCase() === "SKIP"
      ) {
        console.log(`ℹ️  Нейросеть определила, что обращение не к боту, пропускаю`);
        return;
      }

      console.log(`✅ Нейросеть определила обращение к боту, отвечаю...`);
      await this.telegramService.sendMessage(chatId, response, {
        reply_to_message_id: msg.message_id,
        parse_mode: "Markdown" as const,
      });
      console.log(`✅ Ответ отправлен в "${chatTitle}"`);
    } catch (error: any) {
      console.error(
        `❌ Ошибка при отправке в "${chatTitle}":`,
        error.message || error
      );
    }
  }

  private buildContextMessages(
    msg: Message,
    chatId: string
  ): ConversationMessage[] {
    const contextMessages: ConversationMessage[] = [];

    if (msg.reply_to_message?.text) {
      const replyAuthor = msg.reply_to_message.from;
      const authorInfo = replyAuthor
        ? formatUserInfo(replyAuthor)
        : "Неизвестный пользователь";
      contextMessages.push({
        role: "user",
        content: `[ОСНОВНОЕ СООБЩЕНИЕ - ОТВЕТЬ НА ЭТО] От ${authorInfo}: ${msg.reply_to_message.text}`,
      });
      console.log(`📎 Добавлено основное сообщение для ответа в контекст`);
    }

    const chatHistory = this.telegramService.getChatHistory(chatId);
    const filteredMessages = chatHistory
      .filter((m) => m.text && m.message_id !== msg.message_id)
      .reverse()
      .slice(0, CONTEXT_MESSAGE_LIMIT);

    for (const m of filteredMessages) {
      if (m.text) {
        const msgText = m.text.substring(0, MAX_CONTEXT_MESSAGE_LENGTH);
        const msgAuthor = m.from ? formatUserInfo(m.from) : "Пользователь";
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

    return contextMessages;
  }

  private buildUsersInfo(msg: Message, chatId: string): string {
    const userInfoMap = new Map<number, string>();

    // Добавляем информацию о пользователе, на чье сообщение отвечают
    if (msg.reply_to_message?.from) {
      const user = msg.reply_to_message.from;
      userInfoMap.set(user.id, formatUserInfoDetailed(user));
    }

    // Добавляем информацию о текущем пользователе
    if (msg.from) {
      userInfoMap.set(msg.from.id, formatUserInfoDetailed(msg.from));
    }

    // Собираем информацию о пользователях из истории сообщений
    const chatHistory = this.telegramService.getChatHistory(chatId);
    const recentMessages = chatHistory
      .filter((m) => m.text && m.message_id !== msg.message_id)
      .reverse()
      .slice(0, CONTEXT_MESSAGE_LIMIT);

    for (const m of recentMessages) {
      if (m.from && !userInfoMap.has(m.from.id)) {
        userInfoMap.set(m.from.id, formatUserInfoDetailed(m.from));
      }
    }

    if (userInfoMap.size === 0) {
      return "";
    }

    const userInfoList = Array.from(userInfoMap.values())
      .map((info, index) => `${index + 1}. ${info}`)
      .join("\n");

    console.log(`👥 Добавлена информация о ${userInfoMap.size} участниках чата в контекст`);
    return userInfoList;
  }

  private isReplyToBotMessage(msg: Message): boolean {
    if (!msg.reply_to_message) {
      return false;
    }

    const botId = this.telegramService.botId;
    if (!botId) {
      return false;
    }

    return msg.reply_to_message.from?.id === botId;
  }

  private async handleTrollComment(
    msg: Message,
    chatId: string,
    messageText: string,
    userId: number
  ): Promise<void> {
    try {
      if (!msg.from) {
        return;
      }

      console.log(`🎭 Генерирую троллинг комментарий...`);

      // Отправляем статус "печатает..."
      await this.telegramService.sendChatAction(chatId, "typing");

      const userInfo = formatUserInfoDetailed(msg.from);
      const trollPrompt = createTrollCommentPrompt(
        this.config.name,
        userInfo,
        messageText
      );

      const systemPrompt = createSystemPrompt(
        this.config.name,
        this.telegramService.botUsername
      );

      const trollComment = await this.openaiService.getResponse(
        trollPrompt,
        [],
        systemPrompt
      );

      if (trollComment && trollComment.trim() && trollComment.trim().toUpperCase() !== "SKIP") {
        await this.telegramService.sendMessage(chatId, trollComment, {
          reply_to_message_id: msg.message_id,
        });
        console.log(`✅ Троллинг комментарий отправлен`);
      }
    } catch (error) {
      console.error("❌ Ошибка при генерации троллинг комментария:", error);
    }
  }

  private async handlePrivateMessage(
    msg: Message,
    chatId: string,
    messageText: string,
    userId: number
  ): Promise<void> {
    console.log(`📨 Личное сообщение: "${messageText.substring(0, MAX_MESSAGE_PREVIEW_LENGTH)}..."`);
    try {
      const systemPrompt = createSystemPrompt(
        this.config.name,
        this.telegramService.botUsername
      );
      const response = await this.openaiService.getResponse(
        messageText,
        [],
        systemPrompt
      );
      await this.telegramService.sendMessage(chatId, response);
    } catch (error) {
      console.error("❌ Ошибка при отправке:", error);
    }
  }
}


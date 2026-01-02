import type { Message, ConversationMessage } from "../types/message.types.js";
import type { TelegramService } from "../services/telegram.service.js";
import type { OpenAIService } from "../services/openai.service.js";
import type { ChatStorageService } from "../services/chat-storage.service.js";
import type { BotConfig } from "../types/config.types.js";
import {
  createAddressCheckPrompt,
  createSystemPrompt,
  createTranscriptionPrompt,
} from "../utils/prompts.js";
import {
  isMediaMessage,
  getMediaInfo,
  getMediaTypeLabel,
} from "../utils/media.utils.js";
import {
  CONTEXT_MESSAGE_LIMIT,
  MAX_CONTEXT_MESSAGE_LENGTH,
  MAX_MESSAGE_PREVIEW_LENGTH,
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

    console.log(
      `\n📨 [${chatTitle}] (${chatType}, ID: ${chatId}): "${messageText.substring(
        0,
        MAX_MESSAGE_PREVIEW_LENGTH
      )}..."`
    );

    console.log(`🤔 Проверяю, обращаются ли к боту (только последнее сообщение)...`);

    const addressPrompt = createAddressCheckPrompt(this.config.name);
    const isAddressed = await this.openaiService.checkIfAddressed(
      messageText,
      addressPrompt
    );

    if (!isAddressed) {
      console.log(`ℹ️  Нейросеть определила, что обращение не к боту, пропускаю`);
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
      const contextMessages = this.buildContextMessages(msg, chatId);
      const mainReplyMessage = msg.reply_to_message?.text;

      const systemPrompt = createSystemPrompt(
        this.config.name,
        this.telegramService.botUsername,
        mainReplyMessage
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
      contextMessages.push({
        role: "user",
        content: `[ОСНОВНОЕ СООБЩЕНИЕ - ОТВЕТЬ НА ЭТО] ${msg.reply_to_message.text}`,
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
        const msgAuthor = m.from?.first_name || "Пользователь";
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


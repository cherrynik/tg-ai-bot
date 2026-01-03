import TelegramBot from "node-telegram-bot-api";
import type { BotConfig } from "../types/config.types.js";
import type { Message } from "../types/message.types.js";
import { MAX_CHAT_HISTORY } from "../config/constants.js";

export class TelegramService {
  private bot: TelegramBot;
  private chatMessages = new Map<string, Message[]>();
  public botUsername: string | null = null;
  public botId: number | null = null;

  constructor(config: BotConfig) {
    this.bot = new TelegramBot(config.telegramToken, { polling: true });
  }

  getBot(): TelegramBot {
    return this.bot;
  }

  async initialize(): Promise<void> {
    const botInfo = await this.bot.getMe();
    this.botUsername = botInfo.username || null;
    this.botId = botInfo.id;
  }

  addMessageToHistory(chatId: string, message: Message): void {
    if (!this.chatMessages.has(chatId)) {
      this.chatMessages.set(chatId, []);
    }
    const messages = this.chatMessages.get(chatId)!;
    messages.push(message);
    if (messages.length > MAX_CHAT_HISTORY) {
      messages.shift();
    }
  }

  getChatHistory(chatId: string): Message[] {
    return this.chatMessages.get(chatId) || [];
  }

  async sendMessage(
    chatId: string,
    text: string,
    options?: TelegramBot.SendMessageOptions
  ): Promise<TelegramBot.Message> {
    try {
      return await this.bot.sendMessage(chatId, text, options);
    } catch (error: any) {
      // Если ошибка парсинга Markdown, отправляем без форматирования
      if (
        error.response?.body?.error_code === 400 &&
        (error.response?.body?.description?.includes("parse") ||
          error.response?.body?.description?.includes("Can't find end of the entity") ||
          error.response?.body?.description?.includes("can't parse entities"))
      ) {
        console.log(`⚠️  Ошибка парсинга Markdown, отправляю без форматирования...`);
        const fallbackOptions: TelegramBot.SendMessageOptions = {
          ...options,
          parse_mode: undefined,
        };
        return await this.bot.sendMessage(chatId, text, fallbackOptions);
      }
      throw error;
    }
  }

  async sendChatAction(
    chatId: string,
    action: TelegramBot.ChatAction
  ): Promise<boolean> {
    return this.bot.sendChatAction(chatId, action);
  }

  async setMessageReaction(
    chatId: string,
    messageId: number,
    reaction: string[]
  ): Promise<boolean> {
    try {
      const reactionTypes: TelegramBot.ReactionType[] = reaction.map(
        (emoji) =>
          ({
            type: "emoji",
            emoji: emoji as TelegramBot.TelegramEmoji,
          }) as TelegramBot.ReactionTypeEmoji
      );
      await this.bot.setMessageReaction(chatId, messageId, {
        reaction: reactionTypes,
      });
      return true;
    } catch (error) {
      console.error("Ошибка при установке реакции:", error);
      return false;
    }
  }

  async getChatAdministrators(chatId: string): Promise<TelegramBot.ChatMember[] | null> {
    try {
      return await this.bot.getChatAdministrators(chatId);
    } catch (error) {
      console.error("Ошибка при получении администраторов чата:", error);
      return null;
    }
  }

  async getChatMember(chatId: string, userId: number): Promise<TelegramBot.ChatMember | null> {
    try {
      return await this.bot.getChatMember(chatId, userId);
    } catch (error) {
      console.error(`Ошибка при получении информации о пользователе ${userId}:`, error);
      return null;
    }
  }

  getAllUsersFromHistory(chatId: string): Map<number, TelegramBot.User> {
    const userMap = new Map<number, TelegramBot.User>();
    const chatHistory = this.getChatHistory(chatId);
    
    for (const message of chatHistory) {
      if (message.from) {
        if (!userMap.has(message.from.id)) {
          userMap.set(message.from.id, message.from);
        }
      }
      if (message.reply_to_message?.from) {
        if (!userMap.has(message.reply_to_message.from.id)) {
          userMap.set(message.reply_to_message.from.id, message.reply_to_message.from);
        }
      }
      // Также собираем упомянутых пользователей
      const mentionedUsers = this.extractMentionedUsers(message);
      for (const user of mentionedUsers) {
        if (!userMap.has(user.id)) {
          userMap.set(user.id, user);
        }
      }
    }
    
    return userMap;
  }

  async enrichUserInfo(
    chatId: string,
    user: TelegramBot.User
  ): Promise<TelegramBot.User> {
    try {
      const chatMember = await this.getChatMember(chatId, user.id);
      if (chatMember && chatMember.user) {
        // Объединяем информацию из сообщения и из getChatMember
        return {
          ...user,
          ...chatMember.user,
          // Предпочитаем более полную информацию из getChatMember
          first_name: chatMember.user.first_name || user.first_name,
          last_name: chatMember.user.last_name || user.last_name,
          username: chatMember.user.username || user.username,
        };
      }
    } catch (error) {
      // Игнорируем ошибки
    }
    return user;
  }

  async getChatMembersCount(chatId: string): Promise<number | null> {
    try {
      return await this.bot.getChatMemberCount(chatId);
    } catch (error) {
      console.error("Ошибка при получении количества участников чата:", error);
      return null;
    }
  }

  extractMentionedUsers(msg: Message): TelegramBot.User[] {
    const mentionedUsers: TelegramBot.User[] = [];
    
    if (!msg.entities) {
      return mentionedUsers;
    }

    for (const entity of msg.entities) {
      if (entity.type === "mention" && entity.user) {
        mentionedUsers.push(entity.user);
      } else if (entity.type === "text_mention" && entity.user) {
        mentionedUsers.push(entity.user);
      }
    }

    return mentionedUsers;
  }

  onMessage(
    callback: (msg: Message) => void | Promise<void>
  ): void {
    this.bot.on("message", callback);
  }

  onNewChatMembers(
    callback: (msg: Message) => void | Promise<void>
  ): void {
    this.bot.on("new_chat_members", callback);
  }

  onLeftChatMember(
    callback: (msg: Message) => void | Promise<void>
  ): void {
    this.bot.on("left_chat_member", callback);
  }

  onPollingError(callback: (error: Error) => void): void {
    this.bot.on("polling_error", callback);
  }

  onError(callback: (error: Error) => void): void {
    this.bot.on("error", callback);
  }
}


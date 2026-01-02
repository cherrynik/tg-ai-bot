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
    return this.bot.sendMessage(chatId, text, options);
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


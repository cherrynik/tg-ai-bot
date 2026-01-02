import TelegramBot from "node-telegram-bot-api";

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface MessageContext {
  mainMessage?: string;
  recentMessages: ConversationMessage[];
}

export interface MediaInfo {
  fileId: string;
  mimeType: string;
  type: "voice" | "video" | "video_note" | "document";
}

export type ChatType = "group" | "supergroup" | "private";

export interface ChatInfo {
  id: string;
  title: string;
  type: ChatType;
}

export type Message = TelegramBot.Message;


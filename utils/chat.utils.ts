import TelegramBot from "node-telegram-bot-api";
import type { Message } from "../types/message.types.js";

export interface ChatContextInfo {
  type: string;
  title?: string;
  description?: string;
}

export interface UserInfo {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  isBot?: boolean;
}

export function getChatInfo(msg: Message): ChatContextInfo {
  const chat = msg.chat;
  return {
    type: chat.type,
    title: (chat as any).title,
    description: (chat as any).description,
  };
}

export function formatUserInfo(user: TelegramBot.User): string {
  const parts: string[] = [];
  
  if (user.first_name) {
    parts.push(user.first_name);
  }
  
  if (user.last_name) {
    parts.push(user.last_name);
  }
  
  const name = parts.join(" ");
  const username = user.username ? `@${user.username}` : "";
  
  return username ? `${name} (${username})` : name;
}

export function formatUserInfoDetailed(user: TelegramBot.User): string {
  const parts: string[] = [];
  
  if (user.first_name) {
    parts.push(`Имя: ${user.first_name}`);
  }
  
  if (user.last_name) {
    parts.push(`Фамилия: ${user.last_name}`);
  }
  
  if (user.username) {
    parts.push(`Тэг: @${user.username}`);
  }
  
  if (user.is_bot !== undefined) {
    parts.push(`Бот: ${user.is_bot ? "Да" : "Нет"}`);
  }
  
  return parts.join(", ");
}

export function extractUserInfo(user: TelegramBot.User): UserInfo {
  return {
    id: user.id,
    firstName: user.first_name || "Неизвестно",
    lastName: user.last_name,
    username: user.username,
    isBot: user.is_bot,
  };
}


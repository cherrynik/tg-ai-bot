import { readFileSync, writeFileSync, existsSync } from "fs";
import type { BotConfig } from "../types/config.types.js";

export class ChatStorageService {
  private chatsFile: string;

  constructor(config: BotConfig) {
    this.chatsFile = config.chatsFile;
  }

  loadChats(): Set<string> {
    if (existsSync(this.chatsFile)) {
      try {
        const data = readFileSync(this.chatsFile, "utf-8");
        const chats = JSON.parse(data);
        return new Set(Array.isArray(chats) ? chats : []);
      } catch (error) {
        console.error("Ошибка при чтении файла чатов:", error);
        return new Set();
      }
    }
    return new Set();
  }

  saveChat(chatId: string): void {
    const chats = this.loadChats();
    chats.add(chatId);
    try {
      writeFileSync(
        this.chatsFile,
        JSON.stringify(Array.from(chats), null, 2),
        "utf-8"
      );
    } catch (error) {
      console.error("Ошибка при сохранении чата:", error);
    }
  }
}


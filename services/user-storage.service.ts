import { readFileSync, writeFileSync, existsSync } from "fs";
import TelegramBot from "node-telegram-bot-api";
import type { BotConfig } from "../types/config.types.js";

interface StoredUserInfo {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  isBot?: boolean;
  lastSeen?: number; // timestamp последнего упоминания
}

export class UserStorageService {
  private usersFile: string;

  constructor(config: BotConfig) {
    this.usersFile = `users_${config.targetChatId.replace(/-/g, "_")}.json`;
  }

  loadUsers(): Map<number, StoredUserInfo> {
    const userMap = new Map<number, StoredUserInfo>();
    
    if (existsSync(this.usersFile)) {
      try {
        const data = readFileSync(this.usersFile, "utf-8");
        const users = JSON.parse(data);
        
        if (Array.isArray(users)) {
          for (const user of users) {
            userMap.set(user.id, user);
          }
        }
      } catch (error) {
        console.error("Ошибка при чтении файла пользователей:", error);
      }
    }
    
    return userMap;
  }

  saveUser(user: TelegramBot.User): void {
    const users = this.loadUsers();
    
    const userInfo: StoredUserInfo = {
      id: user.id,
      firstName: user.first_name || "Неизвестно",
      lastName: user.last_name,
      username: user.username,
      isBot: user.is_bot,
      lastSeen: Date.now(),
    };
    
    users.set(user.id, userInfo);
    this.saveUsers(users);
  }

  saveUsers(users: Map<number, StoredUserInfo>): void {
    try {
      const usersArray = Array.from(users.values());
      writeFileSync(
        this.usersFile,
        JSON.stringify(usersArray, null, 2),
        "utf-8"
      );
    } catch (error) {
      console.error("Ошибка при сохранении пользователей:", error);
    }
  }

  getAllUsers(): StoredUserInfo[] {
    return Array.from(this.loadUsers().values());
  }
}


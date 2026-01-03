import type { Message } from "../types/message.types.js";
import type { TelegramService } from "../services/telegram.service.js";
import type { ChatStorageService } from "../services/chat-storage.service.js";
import type { UserStorageService } from "../services/user-storage.service.js";
import type { BotConfig } from "../types/config.types.js";

export class MemberHandler {
  constructor(
    private telegramService: TelegramService,
    private chatStorage: ChatStorageService,
    private userStorage: UserStorageService,
    private config: BotConfig
  ) {}

  async handleNewChatMembers(msg: Message): Promise<void> {
    const chatId = msg.chat.id.toString();
    const chatTitle = (msg.chat as any).title || "Без названия";
    const newMembers = msg.new_chat_members;

    if (newMembers && this.telegramService.botId) {
      const isBotAdded = newMembers.some(
        (member) => member.id === this.telegramService.botId
      );
      
      if (isBotAdded) {
        console.log(
          `✅ Бот добавлен в группу "${chatTitle}" (ID: ${chatId}, тип: ${msg.chat.type})`
        );
        this.chatStorage.saveChat(chatId);
        
        // Сохраняем информацию о новых участниках
        for (const member of newMembers) {
          this.userStorage.saveUser(member);
        }
        
        try {
          await this.telegramService.sendMessage(chatId, this.config.startupMessage);
          console.log(`✅ Приветствие отправлено в группу "${chatTitle}"`);
        } catch (error: any) {
          console.error(
            `❌ Ошибка при отправке приветствия в "${chatTitle}":`,
            error.message || error
          );
        }
      } else {
        // Сохраняем информацию о новых участниках (не бот)
        for (const member of newMembers) {
          if (member.id !== this.telegramService.botId) {
            this.userStorage.saveUser(member);
          }
        }
      }
    }
  }

  handleLeftChatMember(msg: Message): void {
    const chatId = msg.chat.id.toString();
    const chatTitle = (msg.chat as any).title || "Без названия";
    const leftMember = msg.left_chat_member;

    if (
      leftMember &&
      this.telegramService.botId &&
      leftMember.id === this.telegramService.botId
    ) {
      console.log(`⚠️  Бот удален из группы "${chatTitle}" (ID: ${chatId})`);
    }
  }
}


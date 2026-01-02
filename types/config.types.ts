export interface BotConfig {
  name: string;
  telegramToken: string;
  openaiApiKey: string;
  targetChatId: string;
  startupMessage: string;
  chatsFile: string;
}

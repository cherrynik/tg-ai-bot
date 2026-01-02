import OpenAI from "openai";
import type { ConversationMessage } from "../types/message.types.js";
import { OPENAI_CONFIG } from "../config/env.js";
import TelegramBot from "node-telegram-bot-api";

export class OpenAIService {
  private client: OpenAI;
  private config = OPENAI_CONFIG;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async checkIfAddressed(
    messageText: string,
    systemPrompt: string
  ): Promise<boolean> {
    try {
      const completion = await this.client.responses.create({
        model: this.config.response.model,
        input: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: messageText,
          },
        ],
      });

      const response = completion.output
        .find((item) => "content" in item)
        ?.content[0].text;
      const isAddressed = response?.trim().toUpperCase() === "ANSWER";
      
      console.log(
        `🔍 Проверка обращения: "${messageText.substring(0, 50)}..." -> ${
          isAddressed ? "ANSWER" : "SKIP"
        }`
      );
      
      return isAddressed;
    } catch (error) {
      console.error("Ошибка при проверке обращения:", error);
      return false;
    }
  }

  async getResponse(
    messageText: string,
    contextMessages: ConversationMessage[],
    systemPrompt: string
  ): Promise<string> {
    try {
      const messages: ConversationMessage[] = [
        {
          role: "system",
          content: systemPrompt,
        },
        ...contextMessages,
        {
          role: "user",
          content: messageText,
        },
      ];

      const completion = await this.client.responses.create({
        model: this.config.response.model,
        tools: [{ type: "web_search" }],
        input: messages,
      });

      const aiResponse = completion.output
        .find((item) => "content" in item)
        ?.content[0].text;

      if (!aiResponse) {
        return "Извините, не удалось получить ответ от AI.";
      }

      return aiResponse;
    } catch (error) {
      console.error("Ошибка OpenAI API:", error);
      return "Извините, произошла ошибка при обработке запроса.";
    }
  }

  async transcribeMedia(
    bot: TelegramBot,
    fileId: string,
    mimeType: string
  ): Promise<string | null> {
    try {
      const fileStream = bot.getFileStream(fileId);
      const chunks: Buffer[] = [];

      for await (const chunk of fileStream) {
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);
      const blob = new Blob([buffer], { type: mimeType });
      const fileName = mimeType.startsWith("video/")
        ? "video.mp4"
        : "audio.ogg";
      const file = new File([blob], fileName, { type: mimeType });

      const transcription = await this.client.audio.transcriptions.create({
        file: file,
        model: this.config.transcriptionModel,
        language: this.config.transcriptionLanguage,
      });

      return transcription.text;
    } catch (error) {
      console.error("Ошибка при транскрипции медиа сообщения:", error);
      return null;
    }
  }
}


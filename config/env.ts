import dotenv from "dotenv";
import {
  DEFAULT_BOT_NAME,
  DEFAULT_TARGET_CHAT_ID,
  CHATS_FILE,
} from "./constants.js";
import type { BotConfig } from "../types/config.types.js";
import OpenAI from "openai";

dotenv.config();

function getEnvVar(name: string, defaultValue?: string): string {
  const value = process.env[name] || defaultValue;
  if (!value) {
    throw new Error(`Ошибка: ${name} не установлен в переменных окружения`);
  }
  return value;
}

export function loadConfig(): BotConfig {
  const botName = process.env.BOT_NAME || DEFAULT_BOT_NAME;
  
  return {
    name: botName,
    telegramToken: getEnvVar("TELEGRAM_TOKEN"),
    openaiApiKey: getEnvVar("OPENAI_API_KEY"),
    targetChatId: process.env.TARGET_CHAT_ID || DEFAULT_TARGET_CHAT_ID,
    startupMessage:
      process.env.STARTUP_MESSAGE || `Привет! Я ${botName}, готов к работе! 🚀`,
    chatsFile: CHATS_FILE,
  };
}

export const OPENAI_CONFIG = {
  checkIfAddressed: {
    model: "o1-mini" as OpenAI.Responses.ResponseCreateParamsNonStreaming["model"],
  },
  transcription: {
    model: "whisper-1" as OpenAI.Audio.Transcriptions.TranscriptionCreateParamsNonStreaming["model"],
    language: "ru",
  },
  response: {
    model: "o3" as OpenAI.Responses.ResponseCreateParamsNonStreaming["model"],
    temperature: 0.3,
  },
} as const;

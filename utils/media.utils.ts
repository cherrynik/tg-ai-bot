import TelegramBot from "node-telegram-bot-api";
import type { MediaInfo } from "../types/message.types.js";

export function isMediaMessage(message: TelegramBot.Message): boolean {
  return (
    message.voice !== undefined ||
    message.video !== undefined ||
    message.video_note !== undefined ||
    (message.document !== undefined &&
      (message.document.mime_type?.startsWith("audio/") ||
        message.document.mime_type?.startsWith("video/")))
  );
}

export function getMediaInfo(
  message: TelegramBot.Message
): MediaInfo | null {
  if (message.voice) {
    return {
      fileId: message.voice.file_id,
      mimeType: "audio/ogg",
      type: "voice",
    };
  }

  if (message.video) {
    return {
      fileId: message.video.file_id,
      mimeType: "video/mp4",
      type: "video",
    };
  }

  if (message.video_note) {
    return {
      fileId: message.video_note.file_id,
      mimeType: "video/mp4",
      type: "video_note",
    };
  }

  if (message.document) {
    const mimeType =
      message.document.mime_type || "application/octet-stream";
    if (
      mimeType.startsWith("audio/") ||
      mimeType.startsWith("video/")
    ) {
      return {
        fileId: message.document.file_id,
        mimeType,
        type: "document",
      };
    }
  }

  return null;
}

export function getMediaTypeLabel(mediaInfo: MediaInfo): string {
  switch (mediaInfo.type) {
    case "video":
      return "видео";
    case "video_note":
      return "кружочек";
    case "voice":
    default:
      return "голосовое";
  }
}


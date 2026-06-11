export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  DEEPSEEK_API_KEY: string;
  DEEPSEEK_BASE_URL: string;
  DEEPSEEK_MODEL: string;
  GIGACHAT_CLIENT_ID: string;
  GIGACHAT_CLIENT_SECRET: string;
  GIGACHAT_AUTH_URL: string;
  GIGACHAT_API_URL: string;
  WHISPER_API_KEY: string;
  WHISPER_BASE_URL: string;
  DATABASE_URL: string;
  BOT_PORT: number;
  ALLOWED_TELEGRAM_IDS: number[];
  DEFAULT_LANGUAGE: string;
  TIMEZONE: string;
}

export function loadEnv(): Env {
  const required = ["TELEGRAM_BOT_TOKEN", "DEEPSEEK_API_KEY"];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  return {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || "",
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL || "https://api.vsegpt.ru/v1",
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL || "deepseek/deepseek-chat",
    GIGACHAT_CLIENT_ID: process.env.GIGACHAT_CLIENT_ID || "",
    GIGACHAT_CLIENT_SECRET: process.env.GIGACHAT_CLIENT_SECRET || "",
    GIGACHAT_AUTH_URL: process.env.GIGACHAT_AUTH_URL || "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
    GIGACHAT_API_URL: process.env.GIGACHAT_API_URL || "https://gigachat.devices.sberbank.ru/api/v1",
    WHISPER_API_KEY: process.env.WHISPER_API_KEY || process.env.DEEPSEEK_API_KEY || "",
    WHISPER_BASE_URL: process.env.WHISPER_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.vsegpt.ru/v1",
    DATABASE_URL: process.env.DATABASE_URL || "file:../../db/custom.db",
    BOT_PORT: parseInt(process.env.BOT_PORT || "3003"),
    ALLOWED_TELEGRAM_IDS: (process.env.ALLOWED_TELEGRAM_IDS || "")
      .split(",")
      .filter(Boolean)
      .map(Number),
    DEFAULT_LANGUAGE: process.env.DEFAULT_LANGUAGE || "ru",
    TIMEZONE: process.env.TIMEZONE || "Europe/Kaliningrad",
  };
}

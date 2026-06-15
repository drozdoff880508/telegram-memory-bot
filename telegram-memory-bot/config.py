"""Configuration module — reads environment variables."""

import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    # Telegram
    BOT_TOKEN: str = os.getenv("BOT_TOKEN", "")

    # LLM API (VseGPT / OpenAI-compatible)
    LLM_API_KEY: str = os.getenv("LLM_API_KEY", "")
    LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "https://api.vsegpt.ru/v1")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "deepseek/deepseek-chat")

    # Vision model (for image analysis)
    VISION_MODEL: str = os.getenv("VISION_MODEL", "openai/gpt-4o-mini")

    # STT model (for voice transcription) — VseGPT uses stt- prefix
    STT_MODEL: str = os.getenv("STT_MODEL", "stt-openai/whisper-1")

    # Memory
    DB_PATH: str = os.getenv("DB_PATH", "bot_memory.db")
    MAX_HISTORY_MESSAGES: int = int(os.getenv("MAX_HISTORY_MESSAGES", "30"))
    USER_PROFILE_MAX_CHARS: int = int(os.getenv("USER_PROFILE_MAX_CHARS", "1500"))

    # Generation
    MAX_TOKENS: int = int(os.getenv("MAX_TOKENS", "2000"))
    TEMPERATURE: float = float(os.getenv("TEMPERATURE", "0.7"))

    # System prompt
    SYSTEM_PROMPT: str = os.getenv(
        "SYSTEM_PROMPT",
        "Ты персональный ИИ-ассистент. Умеешь: помнить контекст, ставить напоминания, "
        "искать в интернете, анализировать картинки и голосовые сообщения, делать заметки. "
        "Отвечай кратко на языке пользователя. Если просят напомнить — используй /remind. "
        "Если просят записать — используй /note. Если нужен поиск — используй /search.",
    )

    # Allowed users (comma-separated Telegram IDs, empty = allow all)
    ALLOWED_USERS: list[int] = [
        int(uid.strip())
        for uid in os.getenv("ALLOWED_USERS", "").split(",")
        if uid.strip().isdigit()
    ]

    # Telegram API fallback IP (for Russia where api.telegram.org is blocked)
    TELEGRAM_FALLBACK_IP: str = os.getenv("TELEGRAM_FALLBACK_IP", "")

    # Reminder check interval (seconds)
    REMINDER_CHECK_INTERVAL: int = int(os.getenv("REMINDER_CHECK_INTERVAL", "30"))

    @classmethod
    def validate(cls) -> list[str]:
        """Return list of missing required config values."""
        missing = []
        if not cls.BOT_TOKEN:
            missing.append("BOT_TOKEN")
        if not cls.LLM_API_KEY:
            missing.append("LLM_API_KEY")
        return missing

#!/bin/bash
# Deploy/update script for Telegram Memory Bot
# Run on VPS: curl -sL <url> | bash  OR  bash deploy.sh
set -e

BOT_DIR="/opt/telegram-memory-bot"
cd "$BOT_DIR"

echo "=== Stopping bot if running ==="
pkill -f "python bot.py" 2>/dev/null || true
sleep 1

echo "=== Updating files ==="

# bot.py
cat > bot.py << 'ENDOFFILE'
"""Main entry point — starts the Telegram bot with reminder scheduler."""

import asyncio
import logging
import socket
import sys
import time

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

from config import Config
from memory import Memory
from llm_client import LLMClient
from handlers import router, init as handlers_init

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def patch_dns_for_telegram(fallback_ip: str):
    _original_getaddrinfo = socket.getaddrinfo

    def _patched_getaddrinfo(host, *args, **kwargs):
        if host == "api.telegram.org":
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (fallback_ip, 443))]
        return _original_getaddrinfo(host, *args, **kwargs)

    socket.getaddrinfo = _patched_getaddrinfo
    logger.info(f"DNS patched: api.telegram.org → {fallback_ip}")


async def reminder_checker(bot: Bot, memory: Memory):
    """Background task that checks and sends due reminders."""
    while True:
        try:
            now = time.time()
            pending = memory.get_pending_reminders(now)

            for reminder in pending:
                try:
                    await bot.send_message(
                        reminder["user_id"],
                        f"⏰ Напоминание:\n\n{reminder['text']}",
                    )
                    memory.mark_reminder_done(reminder["id"])
                    logger.info(f"Reminder {reminder['id']} sent to user {reminder['user_id']}")
                except Exception as e:
                    logger.error(f"Failed to send reminder {reminder['id']}: {e}")

        except Exception as e:
            logger.error(f"Reminder checker error: {e}")

        await asyncio.sleep(Config.REMINDER_CHECK_INTERVAL)


async def main():
    # Validate config
    missing = Config.validate()
    if missing:
        logger.error(f"Missing required config: {', '.join(missing)}")
        logger.error("Set them in .env file or environment variables")
        sys.exit(1)

    # Patch DNS for Russia
    if Config.TELEGRAM_FALLBACK_IP:
        patch_dns_for_telegram(Config.TELEGRAM_FALLBACK_IP)

    # Initialize components
    memory = Memory()
    llm = LLMClient()

    bot = Bot(
        token=Config.BOT_TOKEN,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )

    handlers_init(memory, llm, bot)

    dp = Dispatcher()
    dp.include_router(router)

    # Startup info
    try:
        me = await bot.get_me()
        logger.info(f"Bot started: @{me.username} (ID: {me.id})")
    except Exception as e:
        logger.error(f"Failed to connect to Telegram: {e}")
        sys.exit(1)

    logger.info(f"Model: {Config.LLM_MODEL}")
    logger.info(f"STT: {Config.STT_MODEL}")
    logger.info(f"Allowed users: {Config.ALLOWED_USERS or 'all'}")

    # Start reminder checker in background
    reminder_task = asyncio.create_task(reminder_checker(bot, memory))

    try:
        await dp.start_polling(bot)
    finally:
        reminder_task.cancel()
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
ENDOFFILE

# config.py
cat > config.py << 'ENDOFFILE'
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

    # STT model (for voice transcription)
    STT_MODEL: str = os.getenv("STT_MODEL", "openai/whisper-1")

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
ENDOFFILE

# handlers.py
cat > handlers.py << 'ENDOFFILE'
"""Telegram bot handlers — messages, commands, reminders, notes, search."""

import asyncio
import base64
import logging
import re
import time
from datetime import datetime, timedelta
from typing import Optional

import httpx
from aiogram import Router, F
from aiogram.types import Message
from aiogram.filters import CommandStart, Command

from config import Config
from memory import Memory
from llm_client import LLMClient
from web_search import search_and_summarize

logger = logging.getLogger(__name__)

router = Router()

memory: Optional[Memory] = None
llm: Optional[LLMClient] = None
bot_instance = None  # Will be set from main.py for sending reminders

PROFILE_UPDATE_INTERVAL = 10


def init(memory_instance: Memory, llm_instance: LLMClient, bot=None):
    global memory, llm, bot_instance
    memory = memory_instance
    llm = llm_instance
    bot_instance = bot


def is_allowed(user_id: int) -> bool:
    if not Config.ALLOWED_USERS:
        return True
    return user_id in Config.ALLOWED_USERS


# ── Commands ────────────────────────────────────────────────

@router.message(CommandStart())
async def cmd_start(message: Message):
    if not is_allowed(message.from_user.id):
        await message.answer("⛔ Доступ запрещён.")
        return

    await message.answer(
        "👋 Привет! Я персональный ИИ-ассистент.\n\n"
        "Умею:\n"
        "💬 Общаться и помнить контекст\n"
        "🎤 Расшифровывать голосовые сообщения\n"
        "🖼️ Анализировать картинки\n"
        "⏰ Напоминать о событиях\n"
        "🔍 Искать в интернете\n"
        "📝 Делать заметки\n\n"
        "Просто напиши «напомни через 30 минут позвонить» или «запомни: пароль от wifi — abc123»\n\n"
        "📋 /help — все команды"
    )


@router.message(Command("help"))
async def cmd_help(message: Message):
    if not is_allowed(message.from_user.id):
        return

    await message.answer(
        "🤖 Персональный ИИ-ассистент\n\n"
        "💬 Просто пиши — я отвечу и запомню контекст\n"
        "🎤 Отправь голосовое — я расшифрую\n"
        "🖼️ Отправь картинку — я опишу\n\n"
        "⏰ Напоминания:\n"
        "  Напиши: «напомни через 30 минут позвонить»\n"
        "  /reminders — список напоминаний\n"
        "  /cancel N — отменить напоминание\n\n"
        "📝 Заметки:\n"
        "  Напиши: «запомни: пароль — abc123»\n"
        "  /notes — все заметки\n"
        "  /delnote N — удалить заметку\n\n"
        "🔍 /search запрос — поиск в интернете\n\n"
        "📋 /profile — что я о тебе знаю\n"
        "🗑️ /clear — очистить историю\n"
        "📊 /stats — статистика"
    )


@router.message(Command("clear"))
async def cmd_clear(message: Message):
    if not is_allowed(message.from_user.id):
        return
    memory.clear_history(message.from_user.id)
    await message.answer("🗑️ История очищена. Заметки и напоминания сохранены.")


@router.message(Command("profile"))
async def cmd_profile(message: Message):
    if not is_allowed(message.from_user.id):
        return
    profile = memory.get_profile(message.from_user.id)
    if profile:
        await message.answer(f"📋 Что я о тебе знаю:\n\n{profile}")
    else:
        await message.answer("📋 Пока ничего не знаю. Пообщаемся!")


@router.message(Command("stats"))
async def cmd_stats(message: Message):
    if not is_allowed(message.from_user.id):
        return
    stats = memory.get_stats(message.from_user.id)
    await message.answer(
        f"📊 Статистика:\n\n"
        f"💬 Сообщений: {stats['message_count']}\n"
        f"📝 Заметок: {stats['note_count']}\n"
        f"⏰ Активных напоминаний: {stats['active_reminders']}\n"
        f"📅 Первое сообщение: {stats['first_message']}\n"
        f"🧠 Модель: {Config.LLM_MODEL}"
    )


# ── Reminders ───────────────────────────────────────────────

@router.message(Command("reminders"))
async def cmd_reminders(message: Message):
    if not is_allowed(message.from_user.id):
        return
    reminders = memory.get_user_reminders(message.from_user.id)
    if not reminders:
        await message.answer("⏰ Нет активных напоминаний.")
        return

    text = "⏰ Напоминания:\n\n"
    for r in reminders:
        when = datetime.fromtimestamp(r["remind_at"]).strftime("%d.%m %H:%M")
        text += f"  {r['id']}. {when} — {r['text']}\n"
    text += "\n/cancel N — отменить"
    await message.answer(text)


@router.message(Command("cancel"))
async def cmd_cancel_reminder(message: Message):
    if not is_allowed(message.from_user.id):
        return
    try:
        reminder_id = int(message.text.split()[1])
    except (IndexError, ValueError):
        await message.answer("Используй: /cancel N (где N — номер напоминания)")
        return

    if memory.cancel_reminder(reminder_id, message.from_user.id):
        await message.answer("✅ Напоминание отменено.")
    else:
        await message.answer("❌ Напоминание не найдено.")


# ── Notes ───────────────────────────────────────────────────

@router.message(Command("notes"))
async def cmd_notes(message: Message):
    if not is_allowed(message.from_user.id):
        return
    notes = memory.get_notes(message.from_user.id)
    if not notes:
        await message.answer("📝 Нет заметок. Напиши «запомни: ...» чтобы создать.")
        return

    text = "📝 Заметки:\n\n"
    for n in notes:
        when = datetime.fromtimestamp(n["created_at"]).strftime("%d.%m")
        title = n["title"] or "Без заголовка"
        content_preview = n["content"][:60] + ("..." if len(n["content"]) > 60 else "")
        text += f"  {n['id']}. [{when}] {title}\n     {content_preview}\n"
    text += "\n/delnote N — удалить"
    await message.answer(text)


@router.message(Command("delnote"))
async def cmd_delete_note(message: Message):
    if not is_allowed(message.from_user.id):
        return
    try:
        note_id = int(message.text.split()[1])
    except (IndexError, ValueError):
        await message.answer("Используй: /delnote N (где N — номер заметки)")
        return

    if memory.delete_note(note_id, message.from_user.id):
        await message.answer("✅ Заметка удалена.")
    else:
        await message.answer("❌ Заметка не найдена.")


# ── Search ──────────────────────────────────────────────────

@router.message(Command("search"))
async def cmd_search(message: Message):
    if not is_allowed(message.from_user.id):
        return
    query = message.text.replace("/search", "", 1).strip()
    if not query:
        await message.answer("Используй: /search запрос")
        return

    await message.chat.do("typing")
    result = await search_and_summarize(query, llm)
    await _send_long_message(message, result)


# ── Photo Handler ───────────────────────────────────────────

@router.message(F.photo)
async def handle_photo(message: Message):
    if not is_allowed(message.from_user.id):
        return

    user_id = message.from_user.id
    prompt = message.caption or "Опиши что на этой картинке."

    await message.chat.do("typing")

    try:
        photo = message.photo[-1]
        file_info = await message.bot.get_file(photo.file_id)
        file_data = await _download_telegram_file(file_info.file_path)
        b64 = base64.b64encode(file_data).decode()
        image_url = f"data:image/jpeg;base64,{b64}"

        history = memory.get_history(user_id)
        profile = memory.get_profile(user_id)
        response = await llm.analyze_image(image_url, prompt, history, profile)

        memory.add_message(user_id, "user", f"[изображение] {prompt}")
        memory.add_message(user_id, "assistant", response)

        await _send_long_message(message, response)
    except Exception as e:
        logger.error(f"Photo error: {e}")
        await message.answer(f"❌ Ошибка: {str(e)[:100]}")


# ── Voice/Audio Handler ────────────────────────────────────

@router.message(F.voice | F.audio)
async def handle_voice(message: Message):
    if not is_allowed(message.from_user.id):
        return

    user_id = message.from_user.id
    await message.chat.do("typing")
    await message.answer("🎤 Обрабатываю голосовое...")

    try:
        # Get file
        if message.voice:
            file_info = await message.bot.get_file(message.voice.file_id)
        else:
            file_info = await message.bot.get_file(message.audio.file_id)

        # Download audio
        audio_data = await _download_telegram_file(file_info.file_path)

        # Transcribe
        transcription = await llm.transcribe_audio(audio_data)

        if transcription.startswith("❌"):
            await message.answer(transcription)
            return

        # Summarize key points
        summary = await llm.summarize_text(transcription, "Выдели главное из этого текста")

        result = f"🎤 Транскрипция:\n\n{transcription}\n\n📌 Главное:\n{summary}"

        memory.add_message(user_id, "user", f"[голосовое] {transcription}")
        memory.add_message(user_id, "assistant", summary)

        await _send_long_message(message, result)
    except Exception as e:
        logger.error(f"Voice error: {e}")
        await message.answer(f"❌ Ошибка обработки: {str(e)[:100]}")


# ── Text Handler (main chat) ───────────────────────────────

@router.message(F.text)
async def handle_text(message: Message):
    if not is_allowed(message.from_user.id):
        return

    user_id = message.from_user.id
    user_text = message.text

    # Skip commands already handled
    if user_text.startswith("/") and any(
        user_text.split()[0] == f"/{cmd}"
        for cmd in ["start", "help", "clear", "profile", "stats", "reminders", "cancel", "notes", "delnote", "search"]
    ):
        return

    await message.chat.do("typing")

    # Check if it's a reminder request
    reminder = await llm.extract_reminder(user_text)
    if reminder:
        minutes = reminder["minutes"]
        remind_text = reminder["text"]
        remind_at = time.time() + minutes * 60
        reminder_id = memory.add_reminder(user_id, remind_text, remind_at)
        when = datetime.fromtimestamp(remind_at).strftime("%d.%m.%Y %H:%M")
        await message.answer(f"⏰ Напомню {when}:\n{remind_text}\n\n(/{reminder_id}, /cancel {reminder_id} — отменить)")
        memory.add_message(user_id, "user", user_text)
        memory.add_message(user_id, "assistant", f"⏰ Напоминание установлено на {when}")
        return

    # Check if it's a note request
    note_info = await llm.extract_note(user_text)
    if note_info:
        title = note_info.get("title", "Заметка")
        content = note_info["content"]
        note_id = memory.add_note(user_id, title, content)
        await message.answer(f"📝 Сохранено:\n\n{title}\n{content}\n\n(#{note_id})")
        memory.add_message(user_id, "user", user_text)
        memory.add_message(user_id, "assistant", f"📝 Заметка сохранена: {title}")
        return

    # Regular chat
    history = memory.get_history(user_id)
    profile = memory.get_profile(user_id)
    memory.add_message(user_id, "user", user_text)

    response = await llm.chat(history + [{"role": "user", "content": user_text}], profile)
    memory.add_message(user_id, "assistant", response)

    # Profile update
    stats = memory.get_stats(user_id)
    if stats["message_count"] % PROFILE_UPDATE_INTERVAL == 0 and stats["message_count"] > 0:
        asyncio.create_task(_update_profile_background(user_id))

    await _send_long_message(message, response)


# ── Helpers ─────────────────────────────────────────────────

async def _download_telegram_file(file_path: str) -> bytes:
    download_url = f"https://api.telegram.org/file/bot{Config.BOT_TOKEN}/{file_path}"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(download_url)
        resp.raise_for_status()
        return resp.content


async def _update_profile_background(user_id: int):
    try:
        history = memory.get_history(user_id, limit=30)
        current_profile = memory.get_profile(user_id)
        new_profile = await llm.update_profile(history, current_profile)
        memory.update_profile(user_id, new_profile)
        logger.info(f"Profile updated for user {user_id}")
    except Exception as e:
        logger.error(f"Profile update failed: {e}")


async def _send_long_message(message: Message, text: str):
    MAX_LENGTH = 4096

    if len(text) <= MAX_LENGTH:
        await message.answer(text)
        return

    chunks = []
    current_chunk = ""

    for paragraph in text.split("\n"):
        if len(paragraph) > MAX_LENGTH:
            if current_chunk:
                chunks.append(current_chunk)
                current_chunk = ""
            for i in range(0, len(paragraph), MAX_LENGTH):
                chunks.append(paragraph[i:i + MAX_LENGTH])
        elif len(current_chunk) + len(paragraph) + 1 > MAX_LENGTH:
            chunks.append(current_chunk)
            current_chunk = paragraph
        else:
            current_chunk = current_chunk + "\n" + paragraph if current_chunk else paragraph

    if current_chunk:
        chunks.append(current_chunk)

    for chunk in chunks:
        try:
            await message.answer(chunk)
        except Exception as e:
            logger.error(f"Send chunk error: {e}")
            break
        if len(chunks) > 1:
            await asyncio.sleep(0.2)
ENDOFFILE

# llm_client.py
cat > llm_client.py << 'ENDOFFILE'
"""LLM client — DeepSeek / VseGPT via OpenAI-compatible API."""

import logging
import tempfile
from typing import Optional

import httpx
from openai import AsyncOpenAI

from config import Config

logger = logging.getLogger(__name__)


class LLMClient:
    """Async LLM client with conversation memory context."""

    def __init__(self):
        self.client = AsyncOpenAI(
            api_key=Config.LLM_API_KEY,
            base_url=Config.LLM_BASE_URL,
        )

    async def chat(
        self,
        messages: list[dict],
        profile: str = "",
    ) -> str:
        """Send a chat completion request and return the assistant's reply."""
        system_content = Config.SYSTEM_PROMPT
        if profile:
            system_content += f"\n\n[Профиль пользователя]: {profile}"

        full_messages = [{"role": "system", "content": system_content}] + messages

        try:
            response = await self.client.chat.completions.create(
                model=Config.LLM_MODEL,
                messages=full_messages,
                max_tokens=Config.MAX_TOKENS,
                temperature=Config.TEMPERATURE,
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            logger.error(f"LLM chat error: {e}")
            return f"❌ Ошибка LLM: {str(e)[:200]}"

    async def extract_reminder(self, text: str) -> Optional[dict]:
        """Extract reminder details from user text using LLM.

        Returns dict with 'text' and 'minutes' (int) or None if not a reminder.
        """
        prompt = (
            "Проанализируй сообщение пользователя. Если это просьба о напоминании — "
            "извлеки: 1) через сколько минут напомнить (число), 2) текст напоминания.\n"
            "Если это НЕ напоминание — верни JSON: {\"reminder\": false}\n"
            "Если это напоминание — верни JSON: {\"reminder\": true, \"minutes\": ЧИСЛО, \"text\": \"ТЕКСТ\"}\n\n"
            f"Сообщение: {text}"
        )
        try:
            response = await self.client.chat.completions.create(
                model=Config.LLM_MODEL,
                messages=[
                    {"role": "system", "content": "Ты парсер напоминаний. Отвечай ТОЛЬКО JSON."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=200,
                temperature=0.1,
            )
            import json
            content = response.choices[0].message.content or ""
            # Try to parse JSON from response
            content = content.strip()
            if content.startswith("```"):
                content = content.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
            result = json.loads(content)
            if result.get("reminder") and result.get("minutes") and result.get("text"):
                return result
            return None
        except Exception as e:
            logger.debug(f"Reminder extraction failed: {e}")
            return None

    async def extract_note(self, text: str) -> Optional[dict]:
        """Extract note details from user text using LLM.

        Returns dict with 'title' and 'content' or None.
        """
        prompt = (
            "Проанализируй сообщение пользователя. Если это просьба записать/запомнить/сохранить информацию — "
            "извлеки: 1) короткий заголовок (до 50 символов), 2) полное содержание заметки.\n"
            "Если это НЕ просьба записать — верни JSON: {\"note\": false}\n"
            "Если это просьба записать — верни JSON: {\"note\": true, \"title\": \"ЗАГОЛОВОК\", \"content\": \"СОДЕРЖАНИЕ\"}\n\n"
            f"Сообщение: {text}"
        )
        try:
            response = await self.client.chat.completions.create(
                model=Config.LLM_MODEL,
                messages=[
                    {"role": "system", "content": "Ты парсер заметок. Отвечай ТОЛЬКО JSON."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=300,
                temperature=0.1,
            )
            import json
            content = response.choices[0].message.content or ""
            content = content.strip()
            if content.startswith("```"):
                content = content.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
            result = json.loads(content)
            if result.get("note") and result.get("content"):
                return result
            return None
        except Exception as e:
            logger.debug(f"Note extraction failed: {e}")
            return None

    async def analyze_image(
        self,
        image_url: str,
        prompt: str = "Опиши что на этой картинке.",
        messages: list[dict] | None = None,
        profile: str = "",
    ) -> str:
        """Analyze an image using a vision-capable model."""
        system_content = Config.SYSTEM_PROMPT
        if profile:
            system_content += f"\n\n[Профиль пользователя]: {profile}"

        full_messages = [{"role": "system", "content": system_content}]

        if messages:
            for msg in messages[-10:]:
                if msg["role"] != "system":
                    full_messages.append(msg)

        full_messages.append(
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": image_url}},
                ],
            }
        )

        try:
            response = await self.client.chat.completions.create(
                model=Config.VISION_MODEL,
                messages=full_messages,
                max_tokens=Config.MAX_TOKENS,
                temperature=Config.TEMPERATURE,
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            logger.error(f"Vision error: {e}")
            return f"❌ Ошибка анализа изображения: {str(e)[:200]}"

    async def transcribe_audio(self, audio_data: bytes) -> str:
        """Transcribe audio using Whisper via VseGPT."""
        try:
            # Write to temp file (Whisper API needs a file)
            with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as f:
                f.write(audio_data)
                temp_path = f.name

            with open(temp_path, "rb") as audio_file:
                transcription = await self.client.audio.transcriptions.create(
                    model=Config.STT_MODEL,
                    file=audio_file,
                    response_format="text",
                    language="ru",
                )

            # Cleanup temp file
            import os
            os.unlink(temp_path)

            return transcription if isinstance(transcription, str) else str(transcription)
        except Exception as e:
            logger.error(f"Transcription error: {e}")
            # Try alternative model name
            try:
                with open(temp_path, "rb") as audio_file:
                    transcription = await self.client.audio.transcriptions.create(
                        model="whisper-1",
                        file=audio_file,
                        response_format="text",
                        language="ru",
                    )
                import os
                os.unlink(temp_path)
                return transcription if isinstance(transcription, str) else str(transcription)
            except Exception as e2:
                logger.error(f"Transcription fallback error: {e2}")
                return f"❌ Ошибка транскрипции: {str(e2)[:100]}"

    async def summarize_text(self, text: str, instruction: str = "Выдели главное") -> str:
        """Summarize/extract key points from text."""
        try:
            response = await self.client.chat.completions.create(
                model=Config.LLM_MODEL,
                messages=[
                    {"role": "system", "content": f"{instruction}. Отвечай кратко на русском."},
                    {"role": "user", "content": text},
                ],
                max_tokens=500,
                temperature=0.3,
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            logger.error(f"Summarize error: {e}")
            return f"❌ Ошибка: {str(e)[:100]}"

    async def update_profile(self, history: list[dict], current_profile: str) -> str:
        """Generate an updated user profile based on conversation history."""
        if not history:
            return current_profile

        prompt = (
            "На основе истории переписки обнови профиль пользователя. "
            "Укажи: имя/обращение, интересы, предпочтения, стиль общения, важные факты. "
            "Будь кратким — максимум 500 символов.\n\n"
        )
        if current_profile:
            prompt += f"[Текущий профиль]: {current_profile}\n\n"
        prompt += "[Последние сообщения]:\n"
        for msg in history[-20:]:
            role = "Пользователь" if msg["role"] == "user" else "Ассистент"
            prompt += f"{role}: {msg['content'][:200]}\n"

        try:
            response = await self.client.chat.completions.create(
                model=Config.LLM_MODEL,
                messages=[
                    {"role": "system", "content": "Ты анализируешь переписку и создаёшь краткий профиль."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=500,
                temperature=0.3,
            )
            return response.choices[0].message.content or current_profile
        except Exception as e:
            logger.error(f"Profile update error: {e}")
            return current_profile
ENDOFFILE

# memory.py
cat > memory.py << 'ENDOFFILE'
"""SQLite-based memory module — conversation history, profiles, reminders, notes."""

import sqlite3
import time
from typing import Optional

from config import Config


class Memory:
    """Manages conversation history, user profiles, reminders, and notes in SQLite."""

    def __init__(self, db_path: str = Config.DB_PATH):
        self.db_path = db_path
        self._persistent = db_path != ":memory:"
        self._mem_conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        if self._persistent:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            return conn
        else:
            if self._mem_conn is None:
                self._mem_conn = sqlite3.connect(":memory:")
                self._mem_conn.row_factory = sqlite3.Row
            return self._mem_conn

    def _close_conn(self, conn: sqlite3.Connection):
        if self._persistent:
            conn.close()

    def _init_db(self):
        conn = self._get_conn()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
                content TEXT NOT NULL,
                created_at REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_user_time
            ON messages(user_id, created_at DESC)
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_profiles (
                user_id INTEGER PRIMARY KEY,
                profile TEXT NOT NULL DEFAULT '',
                updated_at REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (user_id, key)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS reminders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                remind_at REAL NOT NULL,
                created_at REAL NOT NULL,
                done INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_reminders_active
            ON reminders(user_id, done, remind_at)
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL,
                created_at REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_notes_user
            ON notes(user_id, created_at DESC)
        """)
        conn.commit()
        self._close_conn(conn)

    # ── Message History ──────────────────────────────────────

    def add_message(self, user_id: int, role: str, content: str):
        conn = self._get_conn()
        conn.execute(
            "INSERT INTO messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (user_id, role, content, time.time()),
        )
        conn.commit()
        self._close_conn(conn)

    def get_history(self, user_id: int, limit: int = Config.MAX_HISTORY_MESSAGES) -> list[dict]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT role, content FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        self._close_conn(conn)
        return [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]

    def clear_history(self, user_id: int):
        conn = self._get_conn()
        conn.execute("DELETE FROM messages WHERE user_id = ?", (user_id,))
        conn.commit()
        self._close_conn(conn)

    # ── User Profiles ────────────────────────────────────────

    def get_profile(self, user_id: int) -> str:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT profile FROM user_profiles WHERE user_id = ?", (user_id,)
        ).fetchone()
        self._close_conn(conn)
        return row["profile"] if row else ""

    def update_profile(self, user_id: int, profile: str):
        profile = profile[: Config.USER_PROFILE_MAX_CHARS]
        conn = self._get_conn()
        conn.execute(
            """INSERT INTO user_profiles (user_id, profile, updated_at) VALUES (?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET profile=?, updated_at=?""",
            (user_id, profile, time.time(), profile, time.time()),
        )
        conn.commit()
        self._close_conn(conn)

    # ── Reminders ────────────────────────────────────────────

    def add_reminder(self, user_id: int, text: str, remind_at: float) -> int:
        """Add a reminder. Returns the reminder ID."""
        conn = self._get_conn()
        cursor = conn.execute(
            "INSERT INTO reminders (user_id, text, remind_at, created_at) VALUES (?, ?, ?, ?)",
            (user_id, text, remind_at, time.time()),
        )
        reminder_id = cursor.lastrowid
        conn.commit()
        self._close_conn(conn)
        return reminder_id

    def get_pending_reminders(self, now: float) -> list[dict]:
        """Get all reminders that are due and not yet done."""
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT id, user_id, text, remind_at FROM reminders WHERE done = 0 AND remind_at <= ?",
            (now,),
        ).fetchall()
        self._close_conn(conn)
        return [dict(r) for r in rows]

    def mark_reminder_done(self, reminder_id: int):
        conn = self._get_conn()
        conn.execute("UPDATE reminders SET done = 1 WHERE id = ?", (reminder_id,))
        conn.commit()
        self._close_conn(conn)

    def get_user_reminders(self, user_id: int) -> list[dict]:
        """Get all active (not done) reminders for a user."""
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT id, text, remind_at FROM reminders WHERE user_id = ? AND done = 0 ORDER BY remind_at",
            (user_id,),
        ).fetchall()
        self._close_conn(conn)
        return [dict(r) for r in rows]

    def cancel_reminder(self, reminder_id: int, user_id: int) -> bool:
        """Cancel a reminder. Returns True if found and cancelled."""
        conn = self._get_conn()
        cursor = conn.execute(
            "UPDATE reminders SET done = 1 WHERE id = ? AND user_id = ? AND done = 0",
            (reminder_id, user_id),
        )
        affected = cursor.rowcount
        conn.commit()
        self._close_conn(conn)
        return affected > 0

    # ── Notes ────────────────────────────────────────────────

    def add_note(self, user_id: int, title: str, content: str) -> int:
        conn = self._get_conn()
        cursor = conn.execute(
            "INSERT INTO notes (user_id, title, content, created_at) VALUES (?, ?, ?, ?)",
            (user_id, title, content, time.time()),
        )
        note_id = cursor.lastrowid
        conn.commit()
        self._close_conn(conn)
        return note_id

    def get_notes(self, user_id: int, limit: int = 20) -> list[dict]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT id, title, content, created_at FROM notes WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        self._close_conn(conn)
        return [dict(r) for r in reversed(rows)]

    def delete_note(self, note_id: int, user_id: int) -> bool:
        conn = self._get_conn()
        cursor = conn.execute(
            "DELETE FROM notes WHERE id = ? AND user_id = ?",
            (note_id, user_id),
        )
        affected = cursor.rowcount
        conn.commit()
        self._close_conn(conn)
        return affected > 0

    def search_notes(self, user_id: int, query: str) -> list[dict]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT id, title, content, created_at FROM notes WHERE user_id = ? AND (title LIKE ? OR content LIKE ?) ORDER BY created_at DESC LIMIT 10",
            (user_id, f"%{query}%", f"%{query}%"),
        ).fetchall()
        self._close_conn(conn)
        return [dict(r) for r in rows]

    # ── User Settings ────────────────────────────────────────

    def get_setting(self, user_id: int, key: str, default: str = "") -> str:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT value FROM user_settings WHERE user_id = ? AND key = ?",
            (user_id, key),
        ).fetchone()
        self._close_conn(conn)
        return row["value"] if row else default

    def set_setting(self, user_id: int, key: str, value: str):
        conn = self._get_conn()
        conn.execute(
            """INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
               ON CONFLICT(user_id, key) DO UPDATE SET value=?""",
            (user_id, key, value, value),
        )
        conn.commit()
        self._close_conn(conn)

    # ── Stats ────────────────────────────────────────────────

    def get_stats(self, user_id: int) -> dict:
        conn = self._get_conn()
        msg_count = conn.execute(
            "SELECT COUNT(*) as c FROM messages WHERE user_id = ?", (user_id,)
        ).fetchone()["c"]
        first_msg = conn.execute(
            "SELECT MIN(created_at) as t FROM messages WHERE user_id = ?", (user_id,)
        ).fetchone()["t"]
        note_count = conn.execute(
            "SELECT COUNT(*) as c FROM notes WHERE user_id = ?", (user_id,)
        ).fetchone()["c"]
        active_reminders = conn.execute(
            "SELECT COUNT(*) as c FROM reminders WHERE user_id = ? AND done = 0", (user_id,)
        ).fetchone()["c"]
        self._close_conn(conn)
        return {
            "message_count": msg_count,
            "first_message": time.strftime("%Y-%m-%d", time.localtime(first_msg)) if first_msg else "never",
            "note_count": note_count,
            "active_reminders": active_reminders,
        }

    # ── Cleanup ──────────────────────────────────────────────

    def prune_old_messages(self, user_id: int, keep_last: int = 200):
        conn = self._get_conn()
        conn.execute(
            """DELETE FROM messages WHERE user_id = ? AND id NOT IN (
               SELECT id FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
            )""",
            (user_id, user_id, keep_last),
        )
        conn.commit()
        self._close_conn(conn)
ENDOFFILE

# web_search.py
cat > web_search.py << 'ENDOFFILE'
"""Web search via DuckDuckGo — free, no API key needed."""

import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

DDGS_API = "https://html.duckduckgo.com/html/"
DDGS_LITE_API = "https://lite.duckduckgo.com/lite/"


async def search(query: str, max_results: int = 5) -> list[dict]:
    """Search DuckDuckGo and return results.

    Returns list of dicts with 'title', 'url', 'snippet' keys.
    """
    results = []

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.post(
                DDGS_API,
                data={"q": query, "b": ""},
                headers={
                    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            )

            if resp.status_code != 200:
                logger.error(f"DDG search failed: {resp.status_code}")
                return results

            # Parse HTML results
            from html.parser import HTMLParser

            class DDGParser(HTMLParser):
                def __init__(self):
                    super().__init__()
                    self.results = []
                    self.current = {}
                    self.in_result = False
                    self.in_title = False
                    self.in_snippet = False
                    self.capture = False
                    self.capture_text = ""

                def handle_starttag(self, tag, attrs):
                    attrs_dict = dict(attrs)
                    cls = attrs_dict.get("class", "")

                    if "result" in cls and "results" not in cls:
                        self.in_result = True
                        self.current = {}

                    if self.in_result:
                        if tag == "a" and "result__a" in cls:
                            self.in_title = True
                            self.current["url"] = attrs_dict.get("href", "")
                            self.capture = True
                            self.capture_text = ""
                        elif tag == "a" and "result__snippet" in cls:
                            self.in_snippet = True
                            self.capture = True
                            self.capture_text = ""

                def handle_endtag(self, tag):
                    if self.in_title and tag == "a":
                        self.current["title"] = self.capture_text.strip()
                        self.in_title = False
                        self.capture = False
                    elif self.in_snippet and tag == "a":
                        self.current["snippet"] = self.capture_text.strip()
                        self.in_snippet = False
                        self.capture = False
                        if self.current.get("title") and self.current.get("snippet"):
                            self.results.append(dict(self.current))
                        self.in_result = False

                def handle_data(self, data):
                    if self.capture:
                        self.capture_text += data

            parser = DDGParser()
            parser.feed(resp.text)
            results = parser.results[:max_results]

    except Exception as e:
        logger.error(f"Search error: {e}")

    return results


async def search_and_summarize(query: str, llm_client) -> str:
    """Search the web and return a formatted summary."""
    from llm_client import LLMClient

    results = await search(query)

    if not results:
        return "🔍 Ничего не найдено. Попробуй другой запрос."

    # Format results
    text = f"🔍 Результаты по запросу «{query}»:\n\n"
    for i, r in enumerate(results, 1):
        title = r.get("title", "Без названия")
        snippet = r.get("snippet", "")
        url = r.get("url", "")
        text += f"{i}. {title}\n"
        if snippet:
            text += f"   {snippet}\n"
        if url:
            text += f"   🔗 {url}\n"
        text += "\n"

    return text
ENDOFFILE

# requirements.txt
cat > requirements.txt << 'ENDOFFILE'
aiogram>=3.13
openai>=1.50
python-dotenv>=1.0
httpx>=0.27
ENDOFFILE

# systemd service
cat > telegram-memory-bot.service << 'ENDOFFILE'
[Unit]
Description=Telegram Memory Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/telegram-memory-bot
ExecStart=/opt/telegram-memory-bot/venv/bin/python bot.py
EnvironmentFile=/opt/telegram-memory-bot/.env
Restart=always
RestartSec=5
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
ENDOFFILE

echo "=== Installing/updating dependencies ==="
source venv/bin/activate
pip install -q -r requirements.txt

echo "=== Files updated! ==="
echo ""
echo "Now run: python bot.py"
echo ""
echo "Or install as systemd service:"
echo "  sudo cp telegram-memory-bot.service /etc/systemd/system/"
echo "  sudo systemctl daemon-reload"
echo "  sudo systemctl enable telegram-memory-bot"
echo "  sudo systemctl start telegram-memory-bot"

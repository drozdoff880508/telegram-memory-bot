"""Telegram bot handlers — message processing and commands."""

import asyncio
import base64
import logging
import time
from typing import Optional

import httpx
from aiogram import Router, F
from aiogram.types import Message
from aiogram.filters import CommandStart, Command

from config import Config
from memory import Memory
from llm_client import LLMClient

logger = logging.getLogger(__name__)

router = Router()

# These will be set from main.py
memory: Optional[Memory] = None
llm: Optional[LLMClient] = None

# Profile update interval (every N messages per user)
PROFILE_UPDATE_INTERVAL = 10


def init(memory_instance: Memory, llm_instance: LLMClient):
    """Initialize handlers with shared instances."""
    global memory, llm
    memory = memory_instance
    llm = llm_instance


def is_allowed(user_id: int) -> bool:
    """Check if user is allowed to use the bot."""
    if not Config.ALLOWED_USERS:
        return True
    return user_id in Config.ALLOWED_USERS


@router.message(CommandStart())
async def cmd_start(message: Message):
    if not is_allowed(message.from_user.id):
        await message.answer("⛔ Доступ запрещён.")
        return

    await message.answer(
        "👋 Привет! Я ИИ-ассистент с памятью.\n\n"
        "Я запоминаю наш разговор и твои предпочтения.\n\n"
        "📋 Команды:\n"
        "/clear — очистить историю\n"
        "/profile — мой профиль\n"
        "/stats — статистика\n"
        "/help — помощь"
    )


@router.message(Command("help"))
async def cmd_help(message: Message):
    if not is_allowed(message.from_user.id):
        return

    await message.answer(
        "🤖 ИИ-ассистент с памятью\n\n"
        "Просто напиши мне — я отвечу и запомню контекст.\n"
        "Можешь отправить картинку — я её опишу.\n\n"
        "📋 Команды:\n"
        "/clear — очистить историю разговора\n"
        "/profile — посмотреть мой профиль о тебе\n"
        "/stats — статистика использования\n"
        "/help — эта справка"
    )


@router.message(Command("clear"))
async def cmd_clear(message: Message):
    if not is_allowed(message.from_user.id):
        return

    memory.clear_history(message.from_user.id)
    await message.answer("🗑️ История разговора очищена. Память профиля сохранена.")


@router.message(Command("profile"))
async def cmd_profile(message: Message):
    if not is_allowed(message.from_user.id):
        return

    profile = memory.get_profile(message.from_user.id)
    if profile:
        await message.answer(f"📋 Твой профиль:\n\n{profile}")
    else:
        await message.answer("📋 Профиль пока пуст. Пообщайся со мной — я соберу информацию!")


@router.message(Command("stats"))
async def cmd_stats(message: Message):
    if not is_allowed(message.from_user.id):
        return

    stats = memory.get_stats(message.from_user.id)
    await message.answer(
        f"📊 Статистика:\n\n"
        f"💬 Сообщений: {stats['message_count']}\n"
        f"📅 Первое сообщение: {stats['first_message']}\n"
        f"🧠 Модель: {Config.LLM_MODEL}"
    )


async def _download_telegram_file(file_path: str) -> bytes:
    """Download a file from Telegram API, using fallback IP if needed."""
    download_url = f"https://api.telegram.org/file/bot{Config.BOT_TOKEN}/{file_path}"

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(download_url)
        resp.raise_for_status()
        return resp.content


@router.message(F.photo)
async def handle_photo(message: Message):
    """Handle photo messages — analyze with vision model."""
    if not is_allowed(message.from_user.id):
        return

    user_id = message.from_user.id
    prompt = message.caption or "Опиши что на этой картинке."

    await message.chat.do("typing")

    try:
        # Get the largest photo size
        photo = message.photo[-1]
        file_info = await message.bot.get_file(photo.file_id)

        # Download and convert to base64 data URL
        file_data = await _download_telegram_file(file_info.file_path)
        b64 = base64.b64encode(file_data).decode()
        image_url = f"data:image/jpeg;base64,{b64}"

        # Get context
        history = memory.get_history(user_id)
        profile = memory.get_profile(user_id)

        # Analyze image
        response = await llm.analyze_image(image_url, prompt, history, profile)

        # Save to memory
        memory.add_message(user_id, "user", f"[изображение] {prompt}")
        memory.add_message(user_id, "assistant", response)

        await _send_long_message(message, response)

    except Exception as e:
        logger.error(f"Photo handling error: {e}")
        await message.answer(f"❌ Не удалось обработать изображение: {str(e)[:100]}")


@router.message(F.voice | F.audio)
async def handle_voice(message: Message):
    """Handle voice/audio messages — inform user text-only for now."""
    if not is_allowed(message.from_user.id):
        return

    await message.answer(
        "🎤 Пока не умею обрабатывать голосовые сообщения. "
        "Напиши текстом, пожалуйста!"
    )


@router.message(F.text)
async def handle_text(message: Message):
    """Handle text messages — main chat handler."""
    if not is_allowed(message.from_user.id):
        return

    user_id = message.from_user.id
    user_text = message.text

    # Show typing indicator
    await message.chat.do("typing")

    # Get context
    history = memory.get_history(user_id)
    profile = memory.get_profile(user_id)

    # Save user message
    memory.add_message(user_id, "user", user_text)

    # Call LLM with full history
    response = await llm.chat(history + [{"role": "user", "content": user_text}], profile)

    # Save assistant response
    memory.add_message(user_id, "assistant", response)

    # Periodically update user profile
    stats = memory.get_stats(user_id)
    if stats["message_count"] % PROFILE_UPDATE_INTERVAL == 0 and stats["message_count"] > 0:
        asyncio.create_task(_update_profile_background(user_id))

    # Send response
    await _send_long_message(message, response)


async def _update_profile_background(user_id: int):
    """Update user profile in background."""
    try:
        history = memory.get_history(user_id, limit=30)
        current_profile = memory.get_profile(user_id)
        new_profile = await llm.update_profile(history, current_profile)
        memory.update_profile(user_id, new_profile)
        logger.info(f"Profile updated for user {user_id}")
    except Exception as e:
        logger.error(f"Background profile update failed: {e}")


async def _send_long_message(message: Message, text: str):
    """Send a message, splitting into chunks if it exceeds Telegram's limit."""
    MAX_LENGTH = 4096

    if len(text) <= MAX_LENGTH:
        await message.answer(text)
        return

    # Split by paragraphs, then by sentences if a single paragraph is too long
    chunks = []
    current_chunk = ""

    for paragraph in text.split("\n"):
        # If a single paragraph is too long, split by sentences
        if len(paragraph) > MAX_LENGTH:
            if current_chunk:
                chunks.append(current_chunk)
                current_chunk = ""
            sentence_buffer = ""
            for char in paragraph:
                sentence_buffer += char
                if len(sentence_buffer) >= MAX_LENGTH:
                    chunks.append(sentence_buffer)
                    sentence_buffer = ""
            if sentence_buffer:
                current_chunk = sentence_buffer
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
            logger.error(f"Failed to send chunk: {e}")
            break
        if len(chunks) > 1:
            await asyncio.sleep(0.2)

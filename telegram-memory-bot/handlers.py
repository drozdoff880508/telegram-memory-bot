"""Telegram bot handlers — messages, commands, reminders, notes, search."""

import asyncio
import base64
import logging
import os
import re
import time
import traceback
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
        # Use medium photo size (not the largest) to save tokens/money
        photo = message.photo[1] if len(message.photo) > 2 else message.photo[-1]
        file_info = await message.bot.get_file(photo.file_id)
        file_data = await _download_telegram_file(file_info.file_path)

        # Resize image to save tokens (max 768px width)
        file_data = _resize_image(file_data, max_width=768)

        b64 = base64.b64encode(file_data).decode()
        image_url = f"data:image/jpeg;base64,{b64}"

        # Don't send history with images — saves tokens
        response = await llm.analyze_image(image_url, prompt)

        memory.add_message(user_id, "user", f"[изображение] {prompt}")
        memory.add_message(user_id, "assistant", response)

        await _send_long_message(message, response)
    except Exception as e:
        logger.error(f"Photo error: {type(e).__name__}: {e}\n{traceback.format_exc()}")
        await message.answer(f"❌ Ошибка фото ({type(e).__name__}): {str(e)[:150]}")


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
        logger.error(f"Voice error: {type(e).__name__}: {e}\n{traceback.format_exc()}")
        await message.answer(f"❌ Ошибка голосового ({type(e).__name__}): {str(e)[:150]}")


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
    # Try fallback IP first (Russia blocks api.telegram.org)
    if Config.TELEGRAM_FALLBACK_IP:
        download_url = f"https://{Config.TELEGRAM_FALLBACK_IP}/file/bot{Config.BOT_TOKEN}/{file_path}"
    else:
        download_url = f"https://api.telegram.org/file/bot{Config.BOT_TOKEN}/{file_path}"

    headers = {"Host": "api.telegram.org"}

    try:
        async with httpx.AsyncClient(timeout=30, verify=False) as client:
            resp = await client.get(download_url, headers=headers)
            resp.raise_for_status()
            logger.info(f"Downloaded file: {file_path} ({len(resp.content)} bytes)")
            return resp.content
    except Exception as e:
        logger.warning(f"Download via fallback IP failed: {type(e).__name__}: {e}")
        # Try normal URL as fallback
        download_url2 = f"https://api.telegram.org/file/bot{Config.BOT_TOKEN}/{file_path}"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(download_url2)
            resp.raise_for_status()
            logger.info(f"Downloaded file (direct): {file_path} ({len(resp.content)} bytes)")
            return resp.content


def _resize_image(data: bytes, max_width: int = 768, quality: int = 75) -> bytes:
    """Resize image to reduce token count and cost."""
    try:
        from PIL import Image
        import io

        img = Image.open(io.BytesIO(data))

        # Convert RGBA to RGB if needed
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")

        # Resize if wider than max_width
        if img.width > max_width:
            ratio = max_width / img.width
            new_height = int(img.height * ratio)
            img = img.resize((max_width, new_height), Image.LANCZOS)

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        result = buf.getvalue()
        logger.info(f"Image resized: {len(data)} -> {len(result)} bytes")
        return result
    except ImportError:
        # PIL not available — return original
        logger.warning("PIL not available, sending original image")
        return data
    except Exception as e:
        logger.warning(f"Image resize failed: {e}, sending original")
        return data


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

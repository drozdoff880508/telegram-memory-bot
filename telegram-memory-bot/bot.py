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

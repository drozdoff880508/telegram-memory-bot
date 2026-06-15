"""Main entry point — starts the Telegram bot."""

import asyncio
import logging
import socket
import sys

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
    """Monkey-patch DNS resolution to use fallback IP for api.telegram.org.

    This is needed in Russia where api.telegram.org is blocked by ISPs.
    The patch makes all connections to api.telegram.org go through the
    specified IP address instead of DNS resolution.
    """
    _original_getaddrinfo = socket.getaddrinfo

    def _patched_getaddrinfo(host, *args, **kwargs):
        if host == "api.telegram.org":
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (fallback_ip, 443))]
        return _original_getaddrinfo(host, *args, **kwargs)

    socket.getaddrinfo = _patched_getaddrinfo
    logger.info(f"DNS patched: api.telegram.org → {fallback_ip}")


async def main():
    # Validate config
    missing = Config.validate()
    if missing:
        logger.error(f"Missing required config: {', '.join(missing)}")
        logger.error("Set them in .env file or environment variables")
        sys.exit(1)

    # Patch DNS for Russia if fallback IP is set
    if Config.TELEGRAM_FALLBACK_IP:
        patch_dns_for_telegram(Config.TELEGRAM_FALLBACK_IP)

    # Initialize components
    memory = Memory()
    llm = LLMClient()
    handlers_init(memory, llm)

    # Initialize bot
    bot = Bot(
        token=Config.BOT_TOKEN,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )

    dp = Dispatcher()
    dp.include_router(router)

    # Startup info
    try:
        me = await bot.get_me()
        logger.info(f"Bot started: @{me.username} (ID: {me.id})")
    except Exception as e:
        logger.error(f"Failed to connect to Telegram: {e}")
        logger.error("Check BOT_TOKEN and network connectivity")
        sys.exit(1)

    logger.info(f"Model: {Config.LLM_MODEL}")
    logger.info(f"Allowed users: {Config.ALLOWED_USERS or 'all'}")

    try:
        await dp.start_polling(bot)
    finally:
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())

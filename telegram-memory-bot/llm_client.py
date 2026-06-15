"""LLM client — DeepSeek / VseGPT via OpenAI-compatible API."""

import logging
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
        self.vision_client = AsyncOpenAI(
            api_key=Config.LLM_API_KEY,
            base_url=Config.LLM_BASE_URL,
        )

    async def chat(
        self,
        messages: list[dict],
        profile: str = "",
    ) -> str:
        """Send a chat completion request and return the assistant's reply."""
        # Build system message with optional profile
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

        # Add conversation context if provided
        if messages:
            for msg in messages[-10:]:  # Last 10 messages for context
                if msg["role"] != "system":
                    full_messages.append(msg)

        # Add image message
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
            response = await self.vision_client.chat.completions.create(
                model=Config.VISION_MODEL,
                messages=full_messages,
                max_tokens=Config.MAX_TOKENS,
                temperature=Config.TEMPERATURE,
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            logger.error(f"Vision error: {e}")
            return f"❌ Ошибка анализа изображения: {str(e)[:200]}"

    async def update_profile(self, history: list[dict], current_profile: str) -> str:
        """Generate an updated user profile based on conversation history."""
        if not history:
            return current_profile

        prompt = (
            "На основе истории переписки обнови профиль пользователя. "
            "Укажи: имя/обращение, интересы, предпочтения, стиль общения, важные факты. "
            "Будь кратким — максимум 500 символов. "
            "Если профиля нет — создай. Если есть — обнови.\n\n"
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
                    {"role": "system", "content": "Ты анализируешь переписку и создаёшь краткий профиль пользователя."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=500,
                temperature=0.3,
            )
            return response.choices[0].message.content or current_profile
        except Exception as e:
            logger.error(f"Profile update error: {e}")
            return current_profile

"""LLM client — DeepSeek / VseGPT via OpenAI-compatible API."""

import logging
import os
import tempfile
import traceback
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
        temp_path = None
        try:
            # Write to temp file (Whisper API needs a file)
            with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as f:
                f.write(audio_data)
                temp_path = f.name

            logger.info(f"Transcribing audio: {len(audio_data)} bytes, file={temp_path}")

            # Try multiple model names that VseGPT might accept
            models_to_try = [Config.STT_MODEL, "whisper-1", "openai/whisper"]
            last_error = None

            for model_name in models_to_try:
                try:
                    logger.info(f"Trying STT model: {model_name}")
                    with open(temp_path, "rb") as audio_file:
                        transcription = await self.client.audio.transcriptions.create(
                            model=model_name,
                            file=audio_file,
                            response_format="text",
                            language="ru",
                        )
                    result = transcription if isinstance(transcription, str) else str(transcription)
                    logger.info(f"Transcription OK (model={model_name}): {result[:100]}")
                    return result
                except Exception as model_err:
                    last_error = model_err
                    logger.warning(f"STT model {model_name} failed: {type(model_err).__name__}: {model_err}")
                    continue

            # All models failed - try direct HTTP request as last resort
            logger.info("Trying direct HTTP transcription request...")
            try:
                async with httpx.AsyncClient(timeout=30) as http_client:
                    with open(temp_path, "rb") as audio_file:
                        resp = await http_client.post(
                            f"{Config.LLM_BASE_URL}/audio/transcriptions",
                            headers={"Authorization": f"Bearer {Config.LLM_API_KEY}"},
                            data={"model": "whisper-1", "language": "ru", "response_format": "text"},
                            files={"file": ("audio.ogg", audio_file, "audio/ogg")},
                        )
                    if resp.status_code == 200:
                        result = resp.text
                        logger.info(f"Direct HTTP transcription OK: {result[:100]}")
                        return result
                    else:
                        logger.error(f"Direct HTTP failed: {resp.status_code} {resp.text[:200]}")
            except Exception as http_err:
                logger.error(f"Direct HTTP transcription error: {http_err}")

            return f"❌ Все модели STT не сработали: {type(last_error).__name__}: {str(last_error)[:100]}"
        except Exception as e:
            logger.error(f"Transcription error: {type(e).__name__}: {e}\n{traceback.format_exc()}")
            return f"❌ Ошибка транскрипции: {type(e).__name__}: {str(e)[:100]}"
        finally:
            if temp_path and os.path.exists(temp_path):
                os.unlink(temp_path)

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

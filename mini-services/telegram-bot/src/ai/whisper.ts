import OpenAI from "openai";
import type { Env } from "../env";
import { getGigachatToken } from "./gigachat-auth";

let whisperClient: OpenAI | null = null;

function getClient(env: Env): OpenAI {
  if (!whisperClient) {
    whisperClient = new OpenAI({
      apiKey: env.WHISPER_API_KEY,
      baseURL: env.WHISPER_BASE_URL,
    });
  }
  return whisperClient;
}

/**
 * Transcribe audio using the best available method.
 * Priority: GigaChat Audio (free, best Russian) → Whisper (reliable) → error
 */
export async function transcribeAudio(
  env: Env,
  audioBuffer: Buffer,
  fileName: string,
  language = "ru"
): Promise<{ text: string; duration?: number; model: string }> {
  // Try GigaChat Audio first (free, best for Russian)
  if (env.GIGACHAT_CLIENT_ID && env.GIGACHAT_CLIENT_SECRET) {
    try {
      const result = await transcribeWithGigaChat(env, audioBuffer, fileName);
      if (result.text) {
        console.log("✅ Transcribed with GigaChat Audio");
        return { ...result, model: "GigaChat-ASR" };
      }
    } catch (error: any) {
      console.warn("⚠️ GigaChat Audio failed, falling back to Whisper:", error.message);
    }
  }

  // Fallback: Whisper via VseGPT
  try {
    const result = await transcribeWithWhisper(env, audioBuffer, fileName, language);
    console.log("✅ Transcribed with Whisper");
    return { ...result, model: "whisper-1" };
  } catch (error: any) {
    console.error("❌ All ASR providers failed:", error.message);
    throw new Error("Не удалось расшифровать аудио: все провайдеры недоступны");
  }
}

/**
 * Whisper ASR via VseGPT (OpenAI-compatible API)
 */
async function transcribeWithWhisper(
  env: Env,
  audioBuffer: Buffer,
  fileName: string,
  language: string
): Promise<{ text: string; duration?: number }> {
  const client = getClient(env);

  const file = new File([audioBuffer], fileName, {
    type: getMimeType(fileName),
  });

  const response = await client.audio.transcriptions.create({
    model: "whisper-1",
    file,
    language,
    response_format: "verbose_json",
  });

  return {
    text: response.text,
    duration: response.duration,
  };
}

/**
 * GigaChat Audio — speech-to-text via Sber API
 * Free for non-commercial use, best Russian language support.
 * Docs: https://developers.sber.ru/help/gigachat-api/convert-audio-to-text
 */
async function transcribeWithGigaChat(
  env: Env,
  audioBuffer: Buffer,
  fileName: string
): Promise<{ text: string; duration?: number }> {
  // Step 1: Get auth token
  const token = await getGigachatToken(env);

  // Step 2: Upload audio file to GigaChat
  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: getMimeType(fileName) }), fileName);
  formData.append("model", "GigaChat");

  const uploadResponse = await fetch(`${env.GIGACHAT_API_URL}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!uploadResponse.ok) {
    const errText = await uploadResponse.text();
    throw new Error(`GigaChat file upload failed: ${uploadResponse.status} - ${errText}`);
  }

  const uploadData = await uploadResponse.json();
  const fileId = uploadData.id;

  // Step 3: Send chat request with audio attachment
  const chatResponse = await fetch(`${env.GIGACHAT_API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: "GigaChat-Pro",
      messages: [
        {
          role: "user",
          content: "Расшифруй аудиозапись. Выведи только текст расшифровки, без комментариев.",
          attachments: [fileId],
        },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    }),
  });

  if (!chatResponse.ok) {
    const errText = await chatResponse.text();
    throw new Error(`GigaChat chat failed: ${chatResponse.status} - ${errText}`);
  }

  const chatData = await chatResponse.json();
  const transcription = chatData.choices?.[0]?.message?.content || "";

  return {
    text: transcription.trim(),
  };
}

// === Helpers ===

function getMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    ogg: "audio/ogg",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    webm: "audio/webm",
    flac: "audio/flac",
  };
  return mimeMap[ext || ""] || "audio/ogg";
}

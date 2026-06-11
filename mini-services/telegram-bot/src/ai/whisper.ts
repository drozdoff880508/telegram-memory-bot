import OpenAI from "openai";
import type { Env } from "../env";

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
 * Transcribe audio file using Whisper API (via VseGPT).
 * Accepts a Buffer of audio data and the filename.
 */
export async function transcribeAudio(
  env: Env,
  audioBuffer: Buffer,
  fileName: string,
  language = "ru"
): Promise<{ text: string; duration?: number }> {
  try {
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
  } catch (error: any) {
    console.error("❌ Whisper transcription error:", error.message);
    throw new Error(`Не удалось расшифровать аудио: ${error.message}`);
  }
}

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

import OpenAI from "openai";
import type { Env } from "../env";

let openaiClient: OpenAI | null = null;

function getClient(env: Env): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: env.DEEPSEEK_API_KEY,
      baseURL: env.DEEPSEEK_BASE_URL,
    });
  }
  return openaiClient;
}

export interface ChatOptions {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResult {
  content: string;
  usage?: { promptTokens: number; completionTokens: number };
  model: string;
}

/**
 * Send a chat completion request to DeepSeek (via VseGPT).
 * Falls back to GigaChat if DeepSeek fails.
 */
export async function chat(env: Env, options: ChatOptions): Promise<ChatResult> {
  try {
    return await deepseekChat(env, options);
  } catch (error: any) {
    console.error("❌ DeepSeek error:", error.message);
    console.log("🔄 Falling back to GigaChat...");
    try {
      return await gigachatChat(env, options);
    } catch (gigaError: any) {
      console.error("❌ GigaChat error:", gigaError.message);
      return {
        content: "⚠️ Оба AI-провайдера недоступны. Попробуйте позже.",
        model: "none",
      };
    }
  }
}

async function deepseekChat(env: Env, options: ChatOptions): Promise<ChatResult> {
  const client = getClient(env);
  const model = options.model || env.DEEPSEEK_MODEL;

  const response = await client.chat.completions.create({
    model,
    messages: options.messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 2048,
  });

  const choice = response.choices[0];
  return {
    content: choice?.message?.content || "",
    usage: response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
        }
      : undefined,
    model: response.model || model,
  };
}

/**
 * Send a vision request — image + text to DeepSeek V4 Vision.
 */
export async function analyzeImage(
  env: Env,
  imageUrl: string,
  prompt: string,
  history: { role: "system" | "user" | "assistant"; content: string }[] = []
): Promise<ChatResult> {
  try {
    const client = getClient(env);
    const response = await client.chat.completions.create({
      model: "deepseek-chat", // VseGPT routes to DeepSeek V4 Vision
      messages: [
        ...history,
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl } },
          ] as any,
        },
      ],
      temperature: 0.7,
      max_tokens: 2048,
    });

    const choice = response.choices[0];
    return {
      content: choice?.message?.content || "",
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
          }
        : undefined,
      model: response.model || "deepseek-vision",
    };
  } catch (error: any) {
    console.error("❌ DeepSeek Vision error:", error.message);
    return {
      content: "⚠️ Не удалось распознать изображение. Попробуйте ещё раз.",
      model: "none",
    };
  }
}

// === GigaChat Fallback ===

let gigachatToken: string | null = null;
let gigachatTokenExpiry = 0;

async function getGigachatToken(env: Env): Promise<string> {
  if (gigachatToken && Date.now() < gigachatTokenExpiry) {
    return gigachatToken;
  }

  const response = await fetch(env.GIGACHAT_AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      RqUID: crypto.randomUUID(),
    },
    body: `grant_type=client_credentials&client_id=${env.GIGACHAT_CLIENT_ID}&client_secret=${env.GIGACHAT_CLIENT_SECRET}`,
  });

  if (!response.ok) {
    throw new Error(`GigaChat auth failed: ${response.status}`);
  }

  const data = await response.json();
  gigachatToken = data.access_token;
  gigachatTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return gigachatToken!;
}

async function gigachatChat(env: Env, options: ChatOptions): Promise<ChatResult> {
  if (!env.GIGACHAT_CLIENT_ID || !env.GIGACHAT_CLIENT_SECRET) {
    throw new Error("GigaChat credentials not configured");
  }

  const token = await getGigachatToken(env);

  const response = await fetch(`${env.GIGACHAT_API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: "GigaChat-Pro",
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`GigaChat API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];

  return {
    content: choice?.message?.content || "",
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens || 0,
          completionTokens: data.usage.completion_tokens || 0,
        }
      : undefined,
    model: "GigaChat-Pro",
  };
}

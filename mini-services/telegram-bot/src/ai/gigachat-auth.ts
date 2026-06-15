import type { Env } from "../env";

let gigachatToken: string | null = null;
let gigachatTokenExpiry = 0;

/**
 * Get GigaChat OAuth token.
 * Caches the token until it expires.
 * Shared between deepseek.ts (chat fallback) and whisper.ts (audio transcription).
 */
export async function getGigachatToken(env: Env): Promise<string> {
  if (gigachatToken && Date.now() < gigachatTokenExpiry) {
    return gigachatToken;
  }

  if (!env.GIGACHAT_CLIENT_ID || !env.GIGACHAT_CLIENT_SECRET) {
    throw new Error("GigaChat credentials not configured");
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

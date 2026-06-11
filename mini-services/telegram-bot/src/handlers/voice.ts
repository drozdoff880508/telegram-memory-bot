import { Bot } from "grammy";
import type { DB } from "../db";
import type { Env } from "../env";
import { chat } from "../ai/deepseek";
import { transcribeAudio } from "../ai/whisper";

export function registerVoiceHandler(bot: Bot, db: DB, env: Env) {
  // Handle voice messages
  bot.on("message:voice", async (ctx) => {
    await handleAudio(ctx, db, env, ctx.message.voice, "voice");
  });

  // Handle audio files
  bot.on("message:audio", async (ctx) => {
    await handleAudio(ctx, db, env, ctx.message.audio, "audio");
  });
}

async function handleAudio(ctx: any, db: DB, env: Env, audio: any, type: "voice" | "audio") {
  const user = db.ensureUser(ctx.from!.id, ctx.from!.first_name, ctx.from!.last_name, ctx.from!.username);

  await ctx.reply("🎤 Расшифровываю аудио...");
  await ctx.replyWithChatAction("typing");

  try {
    // Download audio file
    const fileId = audio.file_id;
    const file = await ctx.api.getFile(fileId);

    if (!file.file_path) {
      await ctx.reply("⚠️ Не удалось скачать аудиофайл.");
      return;
    }

    const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const response = await fetch(fileUrl);
    if (!response.ok) {
      await ctx.reply("⚠️ Ошибка скачивания аудио.");
      return;
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const fileName = type === "voice" ? `voice_${Date.now()}.ogg` : audio.file_name || `audio_${Date.now()}.mp3`;

    // Transcribe with Whisper
    const transcription = await transcribeAudio(env, audioBuffer, fileName, env.DEFAULT_LANGUAGE);

    // Save transcription as user message
    db.addMessage(user.id, "user", `[АУДИО] ${transcription.text}`, "voice", fileName);

    // Analyze with AI
    const history = db.getConversationHistory(user.id, 10);
    const systemMessage = {
      role: "system" as const,
      content: `Пользователь прислал аудиозапись. Вот расшифровка:\n\n"${transcription.text}"\n\nИзвлеки из этого ключевые моменты: задачи, дедлайны, важные договорённости. Если есть что-то, что нужно запомнить или напомнить — укажи это. Формат:\n- Если есть напоминание: [НАПОМИНАНИЕ] текст | время\n- Если есть задача для списка покупок: [ПОКУПКИ] товар1, товар2\n- Если есть заметка: [ЗАМЕТКА] заголовок | содержание`,
    };

    const messages = [systemMessage];
    const result = await chat(env, { messages });

    db.addMessage(user.id, "assistant", result.content, "text");

    // Send transcription and analysis
    const durationStr = transcription.duration ? ` (${Math.round(transcription.duration)}с)` : "";
    await ctx.reply(
      `📝 **Расшифровка**${durationStr}:\n\n${transcription.text}\n\n---\n\n🧠 **Анализ:**\n${result.content}`,
      { parse_mode: "Markdown" }
    );
  } catch (error: any) {
    console.error("❌ Voice handler error:", error);
    await ctx.reply(`⚠️ Ошибка обработки аудио: ${error.message}`);
  }
}

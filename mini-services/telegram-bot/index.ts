import { Bot, GrammyError, HttpError } from "grammy";
import { loadEnv } from "./src/env";
import { createDB } from "./src/db";
import { registerCommands } from "./src/handlers/commands";
import { registerTextHandler } from "./src/handlers/text";
import { registerVoiceHandler } from "./src/handlers/voice";
import { registerImageHandler } from "./src/handlers/image";
import { startReminderScheduler } from "./src/scheduler/reminders";

async function main() {
  const env = loadEnv();
  const db = createDB();

  console.log("🤖 AI Assistant Bot starting...");
  console.log(`📡 DeepSeek model: ${env.DEEPSEEK_MODEL}`);
  console.log(`🌐 Timezone: ${env.TIMEZONE}`);

  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // Error handling — MUST be registered before bot.start()
  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError) {
      console.error("❌ Grammy error:", e.description);
    } else if (e instanceof HttpError) {
      console.error("❌ HTTP error:", e);
    } else {
      console.error("❌ Unknown error:", e);
    }
  });

  // Middleware: check allowed users
  if (env.ALLOWED_TELEGRAM_IDS.length > 0) {
    bot.use(async (ctx, next) => {
      if (ctx.from && env.ALLOWED_TELEGRAM_IDS.includes(ctx.from.id)) {
        await next();
      } else {
        await ctx.reply("⛔ Доступ запрещён. Этот бот приватный.");
        console.log(`❌ Unauthorized access from user ${ctx.from?.id}`);
      }
    });
  }

  // Register all handlers
  registerCommands(bot, db, env);
  registerTextHandler(bot, db, env);
  registerVoiceHandler(bot, db, env);
  registerImageHandler(bot, db, env);

  // Start reminder scheduler
  startReminderScheduler(bot, db, env);

  // Start bot
  await bot.start({
    onStart: (info) => {
      console.log(`✅ Bot @${info.username} is running!`);
    },
  });
}

main().catch((err) => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});

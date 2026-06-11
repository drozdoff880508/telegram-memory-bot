import { Bot, GrammyError, HttpError } from "grammy";
import { loadEnv } from "./src/env";
import { createDB } from "./src/db";
import { registerCommands } from "./src/handlers/commands";
import { registerTextHandler } from "./src/handlers/text";
import { registerVoiceHandler } from "./src/handlers/voice";
import { registerImageHandler } from "./src/handlers/image";
import { startReminderScheduler } from "./src/scheduler/reminders";

// Global crash handlers
process.on("uncaughtException", (err) => {
  console.error("🔥 UNCAUGHT EXCEPTION:", err);
  console.error("Stack:", err.stack);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("🔥 UNHANDLED REJECTION:", reason);
});

process.on("SIGTERM", () => {
  console.log("📛 SIGTERM received");
});

process.on("SIGINT", () => {
  console.log("📛 SIGINT received");
  process.exit(0);
});

async function main() {
  const env = loadEnv();
  const db = createDB();

  console.log("🤖 AI Assistant Bot starting...");
  console.log(`📡 DeepSeek model: ${env.DEEPSEEK_MODEL}`);
  console.log(`🌐 Timezone: ${env.TIMEZONE}`);
  console.log(`🔑 API Key: ${env.DEEPSEEK_API_KEY.substring(0, 10)}...`);

  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // Error handling — MUST be registered before bot.start()
  bot.catch((err) => {
    console.error("❌ Grammy catch:", err.error);
    if (err.error instanceof Error) {
      console.error("❌ Stack:", err.error.stack);
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

  // Start bot with long polling
  console.log("🔄 Connecting to Telegram...");
  await bot.start({
    onStart: (info) => {
      console.log(`✅ Bot @${info.username} is running!`);
    },
    allowed_updates: ["message", "callback_query"],
  });
}

main().catch((err) => {
  console.error("💥 Fatal error:", err);
  console.error("💥 Stack:", err.stack);
  process.exit(1);
});

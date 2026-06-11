import { Bot } from "grammy";
import type { DB } from "../db";
import type { Env } from "../env";
import { analyzeImage } from "../ai/deepseek";

export function registerImageHandler(bot: Bot, db: DB, env: Env) {
  bot.on("message:photo", async (ctx) => {
    const user = db.ensureUser(ctx.from!.id, ctx.from!.first_name, ctx.from!.last_name, ctx.from!.username);

    await ctx.reply("📸 Анализирую изображение...");
    await ctx.replyWithChatAction("typing");

    try {
      // Get the largest photo size
      const photos = ctx.message.photo;
      const photo = photos[photos.length - 1]; // highest resolution

      // Download photo
      const file = await ctx.api.getFile(photo.file_id);
      if (!file.file_path) {
        await ctx.reply("⚠️ Не удалось скачать изображение.");
        return;
      }

      const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

      // Get caption or default prompt
      const caption = ctx.message.caption || "Опиши что изображено на этой картинке. Если это чек — перечисли покупки и сумму. Если документ — извлеки ключевую информацию. Если скриншот — опиши что происходит.";

      // Analyze with DeepSeek Vision
      const result = await analyzeImage(env, fileUrl, caption);

      db.addMessage(user.id, "user", `[ФОТО] ${caption}`, "image");
      db.addMessage(user.id, "assistant", result.content, "text");

      // Check for special commands (receipt -> shopping list, etc.)
      const shoppingMatch = result.content.match(/(?:позиции|покупки|товары):?\s*\n([\s\S]+?)(?:\n\n|\nИтого|$)/i);
      if (shoppingMatch && caption.toLowerCase().includes("чек")) {
        const items = shoppingMatch[1]
          .split("\n")
          .map((s: string) => s.replace(/^[-•\d.)\s]+/, "").trim())
          .filter((s: string) => s.length > 0 && !s.toLowerCase().includes("итого"));

        items.forEach((item: string) => {
          db.addShoppingItem(user.id, item, "1", "food");
        });
      }

      await ctx.reply(result.content, { parse_mode: "Markdown" });
    } catch (error: any) {
      console.error("❌ Image handler error:", error);
      await ctx.reply(`⚠️ Ошибка анализа изображения: ${error.message}`);
    }
  });
}

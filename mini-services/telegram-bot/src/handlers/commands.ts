import { Bot } from "grammy";
import type { DB } from "../db";
import type { Env } from "../env";

export function registerCommands(bot: Bot, db: DB, env: Env) {
  // /start — welcome message
  bot.command("start", async (ctx) => {
    const user = db.ensureUser(ctx.from!.id, ctx.from!.first_name, ctx.from!.last_name, ctx.from!.username);
    await ctx.reply(
      `👋 Привет, ${ctx.from!.first_name}!\n\n` +
      `Я твой персональный AI-ассистент. Вот что я умею:\n\n` +
      `📝 **Текст** — просто напиши, и я отвечу\n` +
      `🎤 **Голос/аудио** — пришли запись, я расшифрую и извлеку суть\n` +
      `📸 **Фото** — пришли картинку, я пойму что на ней\n` +
      `🔔 **Напоминания** — «напомни в 15:00 позвонить Иванову»\n` +
      `🛒 **Список покупок** — «добавь молоко и хлеб»\n` +
      `📋 **Заметки** — «запиши: идея для проекта X...»\n\n` +
      `Команды:\n` +
      `/help — подробная справка\n` +
      `/reminders — мои напоминания\n` +
      `/shop — список покупок\n` +
      `/notes — мои заметки\n` +
      `/clear — очистить контекст диалога`,
      { parse_mode: "Markdown" }
    );
  });

  // /help — detailed help
  bot.command("help", async (ctx) => {
    await ctx.reply(
      `📖 **Справка по командам**\n\n` +
      `**Основные:**\n` +
      `Просто напиши мне что угодно — я отвечу с учётом контекста нашего разговора\n\n` +
      `**Голосовые и аудио:**\n` +
      `Пришли голосовое сообщение или аудиофайл — я расшифрую и извлеку главное\n\n` +
      `**Фото:**\n` +
      `Пришли фото чека, документа, скриншот — я пойму что там\n\n` +
      `**Напоминания:**\n` +
      `• «напомни в 15:00 позвонить маме»\n` +
      `• «напомни завтра в 9:00 купить билет»\n` +
      `• «напомни каждый понедельник в 10:00 созвон»\n\n` +
      `**Список покупок:**\n` +
      `• «добавь в покупки молоко и хлеб»\n` +
      `• «покажи список покупок»\n` +
      `• «купил молоко, вычеркни»\n\n` +
      `**Заметки:**\n` +
      `• «запиши: идея для проекта — сделать X»\n` +
      `• «покажи заметки»\n\n` +
      `**Команды:**\n` +
      `/reminders — список активных напоминаний\n` +
      `/shop — список покупок\n` +
      `/notes — мои заметки\n` +
      `/clear — начать диалог заново`,
      { parse_mode: "Markdown" }
    );
  });

  // /reminders — show active reminders
  bot.command("reminders", async (ctx) => {
    const user = db.ensureUser(ctx.from!.id);
    const reminders = db.getUserReminders(user.id);

    if (reminders.length === 0) {
      await ctx.reply("🔕 У тебя нет активных напоминаний.");
      return;
    }

    const text = reminders
      .map((r: any, i: number) => {
        const date = new Date(r.remindAt);
        const timeStr = date.toLocaleString("ru-RU", { timeZone: env.TIMEZONE });
        return `${i + 1}. 🔔 ${r.text}\n   ⏰ ${timeStr}`;
      })
      .join("\n\n");

    await ctx.reply(`🔔 **Твои напоминания:**\n\n${text}`, { parse_mode: "Markdown" });
  });

  // /shop — shopping list
  bot.command("shop", async (ctx) => {
    const user = db.ensureUser(ctx.from!.id);
    const items = db.getShoppingList(user.id);

    if (items.length === 0) {
      await ctx.reply("🛒 Список покупок пуст. Напиши «добавь [товар]».");
      return;
    }

    const grouped: Record<string, any[]> = {};
    items.forEach((item: any) => {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    });

    const categoryNames: Record<string, string> = {
      food: "🍎 Еда",
      household: "🏠 Дом",
      other: "📦 Другое",
    };

    let text = "🛒 **Список покупок:**\n\n";
    for (const [cat, catItems] of Object.entries(grouped)) {
      text += `${categoryNames[cat] || cat}:\n`;
      catItems.forEach((item: any) => {
        text += `  • ${item.text} (${item.quantity})\n`;
      });
      text += "\n";
    }

    await ctx.reply(text, { parse_mode: "Markdown" });
  });

  // /notes — show notes
  bot.command("notes", async (ctx) => {
    const user = db.ensureUser(ctx.from!.id);
    const notes = db.getNotes(user.id);

    if (notes.length === 0) {
      await ctx.reply("📋 У тебя нет заметок. Напиши «запиши: ...».");
      return;
    }

    const text = notes
      .slice(0, 10)
      .map((n: any, i: number) => `${i + 1}. 📌 **${n.title}**\n   ${n.content.substring(0, 100)}${n.content.length > 100 ? "..." : ""}`)
      .join("\n\n");

    await ctx.reply(`📋 **Твои заметки:**\n\n${text}`, { parse_mode: "Markdown" });
  });

  // /clear — reset conversation context
  bot.command("clear", async (ctx) => {
    const user = db.ensureUser(ctx.from!.id);
    db.updateUserContext(user.id, { conversationSummary: "" });
    await ctx.reply("🧹 Контекст диалога очищен. Начинаем с чистого листа!");
  });
}

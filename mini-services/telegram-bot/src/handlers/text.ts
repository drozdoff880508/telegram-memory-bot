import { Bot, InlineKeyboard } from "grammy";
import type { DB } from "../db";
import type { Env } from "../env";
import { chat } from "../ai/deepseek";

const SYSTEM_PROMPT = `Ты — персональный AI-ассистент. Ты помогаешь пользователю с повседневными задачами.

Твои возможности:
- Отвечать на вопросы и вести беседу
- Анализировать расшифровки звонков и извлекать задачи/дедлайны
- Управлять напоминаниями, списком покупок, заметками

Правила:
1. Отвечай на русском языке
2. Будь кратким и по делу, но дружелюбным
3. Используй эмодзи для наглядности

Формат ответа для особых запросов:
- Напоминание: начни с [НАПОМИНАНИЕ] текст | время
- Покупки: начни с [ПОКУПКИ] товар1, товар2, ...
- Заметка: начни с [ЗАМЕТКА] заголовок | содержание`;

export function registerTextHandler(bot: Bot, db: DB, env: Env) {
  bot.on("message:text", async (ctx) => {
    const fromId = ctx.from?.id;
    const text = ctx.message?.text;
    console.log(`📩 Text from ${fromId}: ${text}`);

    try {
      const user = db.ensureUser(ctx.from!.id, ctx.from!.first_name, ctx.from!.last_name, ctx.from!.username);
      console.log(`👤 User resolved: ${user.id}`);

      db.addMessage(user.id, "user", text, "text");

      await ctx.replyWithChatAction("typing");
      console.log(`⌨️ Typing indicator sent`);

      const context = db.getUserContext(user.id);
      const history = db.getConversationHistory(user.id, 10);
      console.log(`📚 History length: ${history.length}`);

      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
        {
          role: "system",
          content: SYSTEM_PROMPT + (context?.conversationSummary ? `\n\nКонтекст:\n${context.conversationSummary}` : ""),
        },
        ...history,
      ];

      console.log(`🤖 Calling DeepSeek...`);
      const result = await chat(env, { messages });
      console.log(`✅ DeepSeek responded: ${result.content.substring(0, 100)}...`);

      db.addMessage(user.id, "assistant", result.content, "text");

      // Handle special commands
      await handleSpecialCommands(ctx, db, user.id, result.content, env);

      // Clean response for user
      const cleanResponse = result.content
        .replace(/\[НАПОМИНАНИЕ\].*/g, "")
        .replace(/\[ПОКУПКИ\].*/g, "")
        .replace(/\[ЗАМЕТКА\].*/g, "")
        .trim();

      if (cleanResponse) {
        await ctx.reply(cleanResponse);
        console.log(`📤 Reply sent`);
      }
    } catch (error: any) {
      console.error(`❌ Error in text handler: ${error.message}`);
      console.error(`❌ Stack: ${error.stack}`);
      try {
        await ctx.reply("⚠️ Ошибка обработки. Попробуй ещё раз.");
      } catch {}
    }
  });

  // Inline button handlers
  bot.callbackQuery(/^shop_done_(.+)$/, async (ctx) => {
    const itemId = ctx.match[1];
    db.toggleShoppingItem(itemId);
    await ctx.answerCallbackQuery("✅ Отмечено!");
    await ctx.editMessageText("✅ Куплено!");
  });

  bot.callbackQuery("shop_list", async (ctx) => {
    const user = db.ensureUser(ctx.from!.id);
    const items = db.getShoppingList(user.id);
    if (items.length === 0) {
      await ctx.answerCallbackQuery("🛒 Список пуст!");
      return;
    }
    const text = items.map((item: any) => `• ${item.text} (${item.quantity})`).join("\n");
    await ctx.answerCallbackQuery();
    await ctx.reply(`🛒 Список покупок:\n\n${text}`);
  });
}

async function handleSpecialCommands(
  ctx: any,
  db: DB,
  userId: string,
  text: string,
  env: Env
): Promise<void> {
  // Parse reminders: [НАПОМИНАНИЕ] текст | время
  const reminderMatch = text.match(/\[НАПОМИНАНИЕ\]\s*(.+?)\s*\|\s*(.+)/);
  if (reminderMatch) {
    const reminderText = reminderMatch[1].trim();
    const timeStr = reminderMatch[2].trim();
    const remindAt = parseTimeString(timeStr, env.TIMEZONE);
    if (remindAt) {
      db.addReminder(userId, reminderText, remindAt);
      console.log(`🔔 Reminder added: ${reminderText} at ${remindAt.toISOString()}`);
    }
  }

  // Parse shopping items
  const shoppingMatch = text.match(/\[ПОКУПКИ\]\s*(.+)/);
  if (shoppingMatch) {
    const items = shoppingMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
    items.forEach((item) => {
      db.addShoppingItem(userId, item, "1", categorizeItem(item));
    });
    console.log(`🛒 Shopping items added: ${items.join(", ")}`);
  }

  // Parse notes
  const noteMatch = text.match(/\[ЗАМЕТКА\]\s*(.+?)\s*\|\s*(.+)/);
  if (noteMatch) {
    db.addNote(userId, noteMatch[1].trim(), noteMatch[2].trim());
    console.log(`📋 Note added: ${noteMatch[1]}`);
  }
}

function parseTimeString(timeStr: string, timezone: string): Date | null {
  const nowStr = new Date().toLocaleString("en-US", { timeZone: timezone });
  const now = new Date(nowStr);

  const timeOnly = timeStr.match(/(?:в\s+)?(\d{1,2}):(\d{2})/);
  if (timeOnly) {
    const date = new Date(now);
    date.setHours(parseInt(timeOnly[1]), parseInt(timeOnly[2]), 0, 0);
    if (date <= now) date.setDate(date.getDate() + 1);
    return date;
  }

  const tomorrow = timeStr.match(/завтра\s+(?:в\s+)?(\d{1,2}):(\d{2})/i);
  if (tomorrow) {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(parseInt(tomorrow[1]), parseInt(tomorrow[2]), 0, 0);
    return date;
  }

  if (/завтра/i.test(timeStr)) {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
    return date;
  }

  const inMinutes = timeStr.match(/через\s+(\d+)\s*(минут|мин|м)/i);
  if (inMinutes) {
    return new Date(Date.now() + parseInt(inMinutes[1]) * 60 * 1000);
  }

  const inHours = timeStr.match(/через\s+(\d+)\s*(час|ч)/i);
  if (inHours) {
    return new Date(Date.now() + parseInt(inHours[1]) * 60 * 60 * 1000);
  }

  const inDays = timeStr.match(/через\s+(\d+)\s*(день|дня|дней|д)/i);
  if (inDays) {
    return new Date(Date.now() + parseInt(inDays[1]) * 24 * 60 * 60 * 1000);
  }

  return new Date(Date.now() + 60 * 60 * 1000);
}

function categorizeItem(item: string): string {
  const foodKeywords = ["молоко", "хлеб", "сыр", "мясо", "рыба", "овощ", "фрукт", "яйц", "масло", "сахар", "мука", "кефир", "творог", "йогурт", "колбас", "сосиск", "макарон", "круп", "рис", "гречк", "чай", "кофе", "сок", "вода", "пиво", "вино", "конфет", "печень", "шоколад", "мороженое"];
  const householdKeywords = ["мыло", "шампунь", "порошок", "средств", "салфетк", "бумаг", "свечк", "батарейк", "лампочк"];

  const lower = item.toLowerCase();
  if (foodKeywords.some((k) => lower.includes(k))) return "food";
  if (householdKeywords.some((k) => lower.includes(k))) return "household";
  return "other";
}

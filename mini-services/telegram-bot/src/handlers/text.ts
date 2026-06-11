import { Bot, InlineKeyboard } from "grammy";
import type { DB } from "../db";
import type { Env } from "../env";
import { chat } from "../ai/deepseek";

const SYSTEM_PROMPT = `Ты — персональный AI-ассистент. Ты помогаешь пользователю с повседневными задачами.

Твои возможности:
- Отвечать на вопросы и вести беседу
- Анализировать расшифровки звонков и извлекать задачи/дедлайны
- Распознавать изображения (чеки, документы, скриншоты)
- Управлять напоминаниями, списком покупок, заметками

Правила:
1. Отвечай на русском языке
2. Будь кратким и по делу, но дружелюбным
3. Если пользователь просит напомнить — извлеки текст напоминания и время
4. Если просит добавить в список покупок — перечисли товары
5. Если просит записать заметку — выдели заголовок и содержание
6. Используй эмодзи для наглядности

Формат ответа для особых запросов:
- Напоминание: начни с [НАПОМИНАНИЕ] текст | время
- Покупки: начни с [ПОКУПКИ] товар1, товар2, ...
- Заметка: начни с [ЗАМЕТКА] заголовок | содержание`;

export function registerTextHandler(bot: Bot, db: DB, env: Env) {
  bot.on("message:text", async (ctx) => {
    const user = db.ensureUser(ctx.from!.id, ctx.from!.first_name, ctx.from!.last_name, ctx.from!.username);
    const userText = ctx.message.text;

    // Save user message
    db.addMessage(user.id, "user", userText, "text");

    // Send "typing" indicator
    await ctx.replyWithChatAction("typing");

    try {
      // Build conversation with system prompt + context + history
      const context = db.getUserContext(user.id);
      const history = db.getConversationHistory(user.id, 16);

      const systemMessage = {
        role: "system" as const,
        content: SYSTEM_PROMPT + (context?.conversationSummary ? `\n\nКонтекст прошлых разговоров:\n${context.conversationSummary}` : ""),
      };

      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [systemMessage, ...history];

      const result = await chat(env, { messages });

      // Save assistant response
      db.addMessage(user.id, "assistant", result.content, "text");

      // Handle special commands extracted from AI response
      const specialResult = await handleSpecialCommands(ctx, db, user.id, result.content, env);

      // Send response (remove special markers for user)
      const cleanResponse = result.content
        .replace(/\[НАПОМИНАНИЕ\].*/g, "")
        .replace(/\[ПОКУПКИ\].*/g, "")
        .replace(/\[ЗАМЕТКА\].*/g, "")
        .trim();

      if (cleanResponse) {
        await ctx.reply(cleanResponse, { parse_mode: "Markdown" });
      }

      // Send inline keyboard for shopping/notes if items were added
      if (specialResult.shoppingAdded.length > 0) {
        const kb = new InlineKeyboard();
        specialResult.shoppingAdded.forEach((item) => {
          kb.text(`✅ ${item.text}`, `shop_done_${item.id}`).row();
        });
        kb.text("🛒 Весь список", "shop_list");
        await ctx.reply("🛒 Добавлено в список покупок:", { reply_markup: kb });
      }
    } catch (error: any) {
      console.error("❌ Text handler error:", error);
      await ctx.reply("⚠️ Произошла ошибка. Попробуй ещё раз.");
    }
  });

  // Inline button handlers
  bot.callbackQuery(/^shop_done_(.+)$/, async (ctx) => {
    const itemId = ctx.match[1];
    db.toggleShoppingItem(itemId);
    await ctx.answerCallbackQuery("✅ Отмечено как купленное!");
    await ctx.editMessageText("✅ Куплено!");
  });

  bot.callbackQuery("shop_list", async (ctx) => {
    const user = db.ensureUser(ctx.from!.id);
    const items = db.getShoppingList(user.id);
    if (items.length === 0) {
      await ctx.answerCallbackQuery("🛒 Список пуст!");
      return;
    }
    const text = items
      .map((item: any) => `• ${item.text} (${item.quantity})`)
      .join("\n");
    await ctx.answerCallbackQuery();
    await ctx.reply(`🛒 **Список покупок:**\n\n${text}`, { parse_mode: "Markdown" });
  });
}

interface SpecialCommandResult {
  shoppingAdded: { id: string; text: string }[];
}

async function handleSpecialCommands(
  ctx: any,
  db: DB,
  userId: string,
  text: string,
  env: Env
): Promise<SpecialCommandResult> {
  const result: SpecialCommandResult = { shoppingAdded: [] };

  // Parse reminders: [НАПОМИНАНИЕ] текст | время
  const reminderMatch = text.match(/\[НАПОМИНАНИЕ\]\s*(.+?)\s*\|\s*(.+)/);
  if (reminderMatch) {
    const reminderText = reminderMatch[1].trim();
    const timeStr = reminderMatch[2].trim();
    const remindAt = parseTimeString(timeStr, env.TIMEZONE);
    if (remindAt) {
      db.addReminder(userId, reminderText, remindAt);
    }
  }

  // Parse shopping items: [ПОКУПКИ] товар1, товар2
  const shoppingMatch = text.match(/\[ПОКУПКИ\]\s*(.+)/);
  if (shoppingMatch) {
    const items = shoppingMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
    items.forEach((item) => {
      const added = db.addShoppingItem(userId, item, "1", categorizeItem(item));
      result.shoppingAdded.push({ id: added.id, text: item });
    });
  }

  // Parse notes: [ЗАМЕТКА] заголовок | содержание
  const noteMatch = text.match(/\[ЗАМЕТКА\]\s*(.+?)\s*\|\s*(.+)/);
  if (noteMatch) {
    const title = noteMatch[1].trim();
    const content = noteMatch[2].trim();
    db.addNote(userId, title, content);
  }

  return result;
}

/**
 * Parse Russian time expressions into a Date object.
 * Uses the specified timezone instead of system UTC.
 */
function parseTimeString(timeStr: string, timezone: string): Date | null {
  // Get current time in user's timezone
  const nowStr = new Date().toLocaleString("en-US", { timeZone: timezone });
  const now = new Date(nowStr);

  // "в 15:00" or "15:00"
  const timeOnly = timeStr.match(/(?:в\s+)?(\d{1,2}):(\d{2})/);
  if (timeOnly) {
    const hours = parseInt(timeOnly[1]);
    const minutes = parseInt(timeOnly[2]);
    const date = new Date(now);
    date.setHours(hours, minutes, 0, 0);
    if (date <= now) date.setDate(date.getDate() + 1);
    return toUTCDate(date, timezone);
  }

  // "завтра в 15:00"
  const tomorrow = timeStr.match(/завтра\s+(?:в\s+)?(\d{1,2}):(\d{2})/i);
  if (tomorrow) {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(parseInt(tomorrow[1]), parseInt(tomorrow[2]), 0, 0);
    return toUTCDate(date, timezone);
  }

  // "завтра" (without time)
  if (/завтра/i.test(timeStr)) {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0); // Default to 9:00 AM
    return toUTCDate(date, timezone);
  }

  // "через 30 минут"
  const inMinutes = timeStr.match(/через\s+(\d+)\s*(минут|мин|м)/i);
  if (inMinutes) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + parseInt(inMinutes[1]));
    return date;
  }

  // "через 2 часа"
  const inHours = timeStr.match(/через\s+(\d+)\s*(час|ч)/i);
  if (inHours) {
    const date = new Date();
    date.setHours(date.getHours() + parseInt(inHours[1]));
    return date;
  }

  // "через 2 дня"
  const inDays = timeStr.match(/через\s+(\d+)\s*(день|дня|дней|д)/i);
  if (inDays) {
    const date = new Date();
    date.setDate(date.getDate() + parseInt(inDays[1]));
    return date;
  }

  // Default: 1 hour from now
  return new Date(Date.now() + 60 * 60 * 1000);
}

/**
 * Convert a local-time Date in a given timezone to a proper UTC Date.
 * This ensures reminders fire at the correct wall-clock time.
 */
function toUTCDate(localDate: Date, timezone: string): Date {
  // Create a date string in the target timezone, then parse it back as UTC
  const localStr = localDate.toLocaleString("en-US", { timeZone: timezone });
  const utcStr = new Date().toLocaleString("en-US", { timeZone: "UTC" });

  const localMs = new Date(localStr).getTime();
  const utcMs = new Date(utcStr).getTime();
  const offset = utcMs - localMs; // timezone offset in ms

  return new Date(localDate.getTime() - offset + (Date.now() - new Date(utcStr).getTime()));
}

function categorizeItem(item: string): string {
  const foodKeywords = ["молоко", "хлеб", "сыр", "мясо", "рыба", "овощ", "фрукт", "яйц", "масло", "сахар", "мука", "кефир", "творог", "йогурт", "колбас", "сосиск", "макарон", "круп", "рис", "гречк", "чай", "кофе", "сок", "вода", "пиво", "вино", "конфет", "печень", "шоколад", "мороженое"];
  const householdKeywords = ["мыло", "шампунь", "порошок", "средств", "салфетк", "бумаг", "свечк", "батарейк", "лампочк"];

  const lower = item.toLowerCase();
  if (foodKeywords.some((k) => lower.includes(k))) return "food";
  if (householdKeywords.some((k) => lower.includes(k))) return "household";
  return "other";
}

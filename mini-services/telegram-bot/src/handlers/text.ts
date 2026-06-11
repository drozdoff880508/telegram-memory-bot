import { Bot } from "grammy";
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

      const messages = [systemMessage, ...history];

      const result = await chat(env, { messages });

      // Save assistant response
      db.addMessage(user.id, "assistant", result.content, "text");

      // Handle special commands extracted from AI response
      await handleSpecialCommands(ctx, db, user.id, result.content);

      // Send response (remove special markers for user)
      const cleanResponse = result.content
        .replace(/\[НАПОМИНАНИЕ\].*/g, "")
        .replace(/\[ПОКУПКИ\].*/g, "")
        .replace(/\[ЗАМЕТКА\].*/g, "")
        .trim();

      if (cleanResponse) {
        await ctx.reply(cleanResponse, { parse_mode: "Markdown" });
      }
    } catch (error: any) {
      console.error("❌ Text handler error:", error);
      await ctx.reply("⚠️ Произошла ошибка. Попробуй ещё раз.");
    }
  });
}

async function handleSpecialCommands(ctx: any, db: DB, userId: string, text: string) {
  // Parse reminders: [НАПОМИНАНИЕ] текст | время
  const reminderMatch = text.match(/\[НАПОМИНАНИЕ\]\s*(.+?)\s*\|\s*(.+)/);
  if (reminderMatch) {
    const reminderText = reminderMatch[1].trim();
    const timeStr = reminderMatch[2].trim();
    const remindAt = parseTimeString(timeStr);
    if (remindAt) {
      db.addReminder(userId, reminderText, remindAt);
    }
  }

  // Parse shopping items: [ПОКУПКИ] товар1, товар2
  const shoppingMatch = text.match(/\[ПОКУПКИ\]\s*(.+)/);
  if (shoppingMatch) {
    const items = shoppingMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
    items.forEach((item) => {
      db.addShoppingItem(userId, item, "1", categorizeItem(item));
    });
  }

  // Parse notes: [ЗАМЕТКА] заголовок | содержание
  const noteMatch = text.match(/\[ЗАМЕТКА\]\s*(.+?)\s*\|\s*(.+)/);
  if (noteMatch) {
    const title = noteMatch[1].trim();
    const content = noteMatch[2].trim();
    db.addNote(userId, title, content);
  }
}

function parseTimeString(timeStr: string): Date | null {
  const now = new Date();

  // "в 15:00" or "15:00"
  const timeOnly = timeStr.match(/(?:в\s+)?(\d{1,2}):(\d{2})/);
  if (timeOnly) {
    const hours = parseInt(timeOnly[1]);
    const minutes = parseInt(timeOnly[2]);
    const date = new Date(now);
    date.setHours(hours, minutes, 0, 0);
    if (date <= now) date.setDate(date.getDate() + 1);
    return date;
  }

  // "завтра в 15:00"
  const tomorrow = timeStr.match(/завтра\s+(?:в\s+)?(\d{1,2}):(\d{2})/i);
  if (tomorrow) {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(parseInt(tomorrow[1]), parseInt(tomorrow[2]), 0, 0);
    return date;
  }

  // "через 30 минут"
  const inMinutes = timeStr.match(/через\s+(\d+)\s*(минут|мин)/i);
  if (inMinutes) {
    return new Date(now.getTime() + parseInt(inMinutes[1]) * 60 * 1000);
  }

  // "через 2 часа"
  const inHours = timeStr.match(/через\s+(\d+)\s*(час|ч)/i);
  if (inHours) {
    return new Date(now.getTime() + parseInt(inHours[1]) * 60 * 60 * 1000);
  }

  // Default: 1 hour from now
  return new Date(now.getTime() + 60 * 60 * 1000);
}

function categorizeItem(item: string): string {
  const foodKeywords = ["молоко", "хлеб", "сыр", "мясо", "рыба", "овощ", "фрукт", "яйц", "масло", "сахар", "мука", "кефир", "творог", "йогурт", "колбас", "сосиск", "макарон", "круп", "рис", "гречк", "чай", "кофе", "сок", "вода", "пиво", "вино", "конфет", "печень", "шоколад", "мороженое"];
  const householdKeywords = ["мыло", "шампунь", "порошок", "средств", "салфетк", "бумаг", "свечк", "батарейк", "лампочк"];

  const lower = item.toLowerCase();
  if (foodKeywords.some((k) => lower.includes(k))) return "food";
  if (householdKeywords.some((k) => lower.includes(k))) return "household";
  return "other";
}

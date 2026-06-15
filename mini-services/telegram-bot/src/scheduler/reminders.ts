import { Bot } from "grammy";
import type { DB } from "../db";
import type { Env } from "../env";
import cron from "node-cron";

export function startReminderScheduler(bot: Bot, db: DB, env: Env) {
  // Check reminders every minute
  cron.schedule("* * * * *", async () => {
    try {
      const pending = db.getPendingReminders();

      for (const reminder of pending) {
        const telegramId = db.getTelegramIdByUserId(reminder.userId);
        if (!telegramId) {
          console.warn(`⚠️ No telegramId found for userId ${reminder.userId}, skipping reminder`);
          db.markReminderSent(reminder.id); // Mark as sent to avoid infinite retry
          continue;
        }

        try {
          await bot.api.sendMessage(
            telegramId,
            `🔔 **Напоминание!**\n\n${reminder.text}`,
            { parse_mode: "Markdown" }
          );

          db.markReminderSent(reminder.id);
          console.log(`✅ Reminder sent: "${reminder.text}" to user ${telegramId}`);

          // Handle repeat reminders
          if (reminder.isRepeat && reminder.repeatInterval) {
            const nextDate = getNextRepeatDate(reminder.repeatInterval);
            if (nextDate) {
              db.addReminder(reminder.userId, reminder.text, nextDate, true, reminder.repeatInterval);
            }
          }
        } catch (err) {
          console.error(`❌ Failed to send reminder to ${telegramId}:`, err);
        }
      }
    } catch (err) {
      console.error("❌ Reminder scheduler error:", err);
    }
  });

  // Morning digest at 8:00 AM in user's timezone
  cron.schedule("0 8 * * *", async () => {
    try {
      const pendingReminders = db.getPendingReminders();
      if (pendingReminders.length === 0) return;

      // Group by user
      const byUser: Record<string, any[]> = {};
      for (const r of pendingReminders) {
        if (!byUser[r.userId]) byUser[r.userId] = [];
        byUser[r.userId].push(r);
      }

      for (const [userId, reminders] of Object.entries(byUser)) {
        const telegramId = db.getTelegramIdByUserId(userId);
        if (!telegramId) continue;

        const todayReminders = reminders.filter((r) => {
          const d = new Date(r.remindAt);
          const now = new Date();
          return d.toDateString() === now.toDateString();
        });

        if (todayReminders.length > 0) {
          const text = todayReminders
            .map((r) => `• ${r.text} — ${new Date(r.remindAt).toLocaleTimeString("ru-RU", { timeZone: env.TIMEZONE, hour: "2-digit", minute: "2-digit" })}`)
            .join("\n");

          try {
            await bot.api.sendMessage(
              telegramId,
              `☀️ **Доброе утро!**\n\nНапоминания на сегодня:\n${text}`,
              { parse_mode: "Markdown" }
            );
          } catch (err) {
            console.error("❌ Failed to send digest:", err);
          }
        }
      }
    } catch (err) {
      console.error("❌ Morning digest error:", err);
    }
  });

  console.log("⏰ Reminder scheduler started");
}

function getNextRepeatDate(interval: string): Date | null {
  const now = new Date();
  switch (interval) {
    case "daily":
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case "weekly":
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    case "monthly":
      const next = new Date(now);
      next.setMonth(next.getMonth() + 1);
      return next;
    default:
      return null;
  }
}

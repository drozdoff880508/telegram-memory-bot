import Database from "better-sqlite3";
import path from "path";

export interface DB {
  getUserByTelegramId(telegramId: number): any | null;
  createUser(telegramId: number, firstName?: string, lastName?: string, username?: string): any;
  ensureUser(telegramId: number, firstName?: string, lastName?: string, username?: string): any;

  addMessage(userId: string, role: string, content: string, messageType?: string, fileName?: string): void;
  getRecentMessages(userId: string, limit?: number): any[];
  getConversationHistory(userId: string, limit?: number): { role: string; content: string }[];

  addReminder(userId: string, text: string, remindAt: Date, isRepeat?: boolean, repeatInterval?: string): any;
  getPendingReminders(): any[];
  markReminderSent(id: string): void;
  getUserReminders(userId: string): any[];
  deleteReminder(id: string): void;

  addShoppingItem(userId: string, text: string, quantity?: string, category?: string): any;
  getShoppingList(userId: string): any[];
  toggleShoppingItem(id: string): void;
  deleteShoppingItem(id: string): void;
  clearBoughtItems(userId: string): void;

  addNote(userId: string, title: string, content: string, tags?: string): any;
  getNotes(userId: string): any[];
  deleteNote(id: string): void;

  getUserContext(userId: string): any | null;
  updateUserContext(userId: string, data: { preferences?: string; conversationSummary?: string }): void;
}

export function createDB(): DB {
  const dbPath = path.resolve(__dirname, "../../db/custom.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");

  return {
    getUserByTelegramId(telegramId: number) {
      return sqlite.prepare("SELECT * FROM TgUser WHERE telegramId = ?").get(telegramId);
    },

    createUser(telegramId: number, firstName?: string, lastName?: string, username?: string) {
      const result = sqlite
        .prepare(
          "INSERT INTO TgUser (id, telegramId, firstName, lastName, username, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))"
        )
        .run(cuid(), telegramId, firstName || null, lastName || null, username || null);
      return sqlite.prepare("SELECT * FROM TgUser WHERE id = ?").get(result.lastInsertRowid);
    },

    ensureUser(telegramId: number, firstName?: string, lastName?: string, username?: string) {
      let user = this.getUserByTelegramId(telegramId);
      if (!user) {
        user = this.createUser(telegramId, firstName, lastName, username);
        // Create empty context
        sqlite.prepare(
          "INSERT INTO UserContext (id, userId, preferences, conversationSummary, lastInteraction, createdAt, updatedAt) VALUES (?, ?, '{}', '', datetime('now'), datetime('now'), datetime('now'))"
        ).run(cuid(), user.id);
      } else {
        // Update user info
        sqlite
          .prepare("UPDATE TgUser SET firstName = ?, lastName = ?, username = ?, updatedAt = datetime('now') WHERE telegramId = ?")
          .run(firstName || null, lastName || null, username || null, telegramId);
      }
      return user;
    },

    addMessage(userId: string, role: string, content: string, messageType = "text", fileName?: string) {
      sqlite
        .prepare(
          "INSERT INTO Message (id, userId, role, content, messageType, fileName, createdAt) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
        )
        .run(cuid(), userId, role, content, messageType, fileName || null);
    },

    getRecentMessages(userId: string, limit = 20) {
      return sqlite
        .prepare("SELECT * FROM Message WHERE userId = ? ORDER BY createdAt DESC LIMIT ?")
        .all(userId, limit)
        .reverse();
    },

    getConversationHistory(userId: string, limit = 20) {
      const messages = this.getRecentMessages(userId, limit);
      return messages.map((m: any) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      }));
    },

    addReminder(userId: string, text: string, remindAt: Date, isRepeat = false, repeatInterval?: string) {
      const result = sqlite
        .prepare(
          "INSERT INTO Reminder (id, userId, text, remindAt, isSent, isRepeat, repeatInterval, createdAt) VALUES (?, ?, ?, ?, 0, ?, ?, datetime('now'))"
        )
        .run(cuid(), userId, text, remindAt.toISOString(), isRepeat ? 1 : 0, repeatInterval || null);
      return sqlite.prepare("SELECT * FROM Reminder WHERE id = ?").get(result.lastInsertRowid);
    },

    getPendingReminders() {
      return sqlite
        .prepare("SELECT * FROM Reminder WHERE isSent = 0 AND remindAt <= datetime('now')")
        .all();
    },

    markReminderSent(id: string) {
      sqlite.prepare("UPDATE Reminder SET isSent = 1 WHERE id = ?").run(id);
    },

    getUserReminders(userId: string) {
      return sqlite
        .prepare("SELECT * FROM Reminder WHERE userId = ? AND isSent = 0 ORDER BY remindAt ASC")
        .all(userId);
    },

    deleteReminder(id: string) {
      sqlite.prepare("DELETE FROM Reminder WHERE id = ?").run(id);
    },

    addShoppingItem(userId: string, text: string, quantity = "1", category = "other") {
      const result = sqlite
        .prepare(
          "INSERT INTO ShoppingItem (id, userId, text, quantity, isBought, category, createdAt) VALUES (?, ?, ?, ?, 0, ?, datetime('now'))"
        )
        .run(cuid(), userId, text, quantity, category);
      return sqlite.prepare("SELECT * FROM ShoppingItem WHERE id = ?").get(result.lastInsertRowid);
    },

    getShoppingList(userId: string) {
      return sqlite
        .prepare("SELECT * FROM ShoppingItem WHERE userId = ? AND isBought = 0 ORDER BY category, createdAt ASC")
        .all(userId);
    },

    toggleShoppingItem(id: string) {
      sqlite.prepare("UPDATE ShoppingItem SET isBought = CASE WHEN isBought = 0 THEN 1 ELSE 0 END WHERE id = ?").run(id);
    },

    deleteShoppingItem(id: string) {
      sqlite.prepare("DELETE FROM ShoppingItem WHERE id = ?").run(id);
    },

    clearBoughtItems(userId: string) {
      sqlite.prepare("DELETE FROM ShoppingItem WHERE userId = ? AND isBought = 1").run(userId);
    },

    addNote(userId: string, title: string, content: string, tags = "") {
      const result = sqlite
        .prepare(
          "INSERT INTO Note (id, userId, title, content, tags, createdAt) VALUES (?, ?, ?, ?, ?, datetime('now'))"
        )
        .run(cuid(), userId, title, content, tags);
      return sqlite.prepare("SELECT * FROM Note WHERE id = ?").get(result.lastInsertRowid);
    },

    getNotes(userId: string) {
      return sqlite.prepare("SELECT * FROM Note WHERE userId = ? ORDER BY createdAt DESC").all(userId);
    },

    deleteNote(id: string) {
      sqlite.prepare("DELETE FROM Note WHERE id = ?").run(id);
    },

    getUserContext(userId: string) {
      return sqlite.prepare("SELECT * FROM UserContext WHERE userId = ?").get(userId);
    },

    updateUserContext(userId: string, data: { preferences?: string; conversationSummary?: string }) {
      const fields: string[] = [];
      const values: any[] = [];
      if (data.preferences !== undefined) {
        fields.push("preferences = ?");
        values.push(data.preferences);
      }
      if (data.conversationSummary !== undefined) {
        fields.push("conversationSummary = ?");
        values.push(data.conversationSummary);
      }
      fields.push("updatedAt = datetime('now')");
      fields.push("lastInteraction = datetime('now')");
      values.push(userId);
      sqlite.prepare(`UPDATE UserContext SET ${fields.join(", ")} WHERE userId = ?`).run(...values);
    },
  };
}

// Simple CUID-like ID generator
function cuid(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}${random}`;
}

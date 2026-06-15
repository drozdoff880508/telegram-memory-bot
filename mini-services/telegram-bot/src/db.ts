import path from "path";
import fs from "fs";

export interface DB {
  getUserByTelegramId(telegramId: number): any | null;
  createUser(telegramId: number, firstName?: string, lastName?: string, username?: string): any;
  ensureUser(telegramId: number, firstName?: string, lastName?: string, username?: string): any;

  addMessage(userId: string, role: string, content: string, messageType?: string, fileName?: string): void;
  getRecentMessages(userId: string, limit?: number): any[];
  getConversationHistory(userId: string, limit?: number): { role: "system" | "user" | "assistant"; content: string }[];

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

  getTelegramIdByUserId(userId: string): number | null;
}

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS TgUser (
    id TEXT PRIMARY KEY,
    telegramId INTEGER UNIQUE NOT NULL,
    firstName TEXT,
    lastName TEXT,
    username TEXT,
    languageCode TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS Message (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    messageType TEXT DEFAULT 'text',
    fileName TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (userId) REFERENCES TgUser(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS Reminder (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    text TEXT NOT NULL,
    remindAt TEXT NOT NULL,
    isSent INTEGER DEFAULT 0,
    isRepeat INTEGER DEFAULT 0,
    repeatInterval TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (userId) REFERENCES TgUser(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ShoppingItem (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    text TEXT NOT NULL,
    quantity TEXT DEFAULT '1',
    isBought INTEGER DEFAULT 0,
    category TEXT DEFAULT 'other',
    createdAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (userId) REFERENCES TgUser(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS Note (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (userId) REFERENCES TgUser(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS UserContext (
    id TEXT PRIMARY KEY,
    userId TEXT UNIQUE NOT NULL,
    preferences TEXT DEFAULT '{}',
    conversationSummary TEXT DEFAULT '',
    lastInteraction TEXT DEFAULT (datetime('now')),
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (userId) REFERENCES TgUser(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS BotSetting (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_message_userId ON Message(userId);
  CREATE INDEX IF NOT EXISTS idx_reminder_pending ON Reminder(isSent, remindAt);
  CREATE INDEX IF NOT EXISTS idx_reminder_userId ON Reminder(userId);
  CREATE INDEX IF NOT EXISTS idx_shopping_userId ON ShoppingItem(userId);
  CREATE INDEX IF NOT EXISTS idx_note_userId ON Note(userId);
  CREATE INDEX IF NOT EXISTS idx_usercontext_userId ON UserContext(userId);
`;

// Wrapper that works with both bun:sqlite and better-sqlite3
interface SQLiteWrapper {
  exec(sql: string): void;
  query(sql: string): { get(...params: any[]): any; all(...params: any[]): any[] };
  run(sql: string, ...params: any[]): { lastInsertRowid: number | bigint };
}

function wrapBun(db: any): SQLiteWrapper {
  return {
    exec(sql: string) { db.exec(sql); },
    query(sql: string) {
      const stmt = db.query(sql);
      return {
        get(...params: any[]) { return stmt.get(...params); },
        all(...params: any[]) { return stmt.all(...params); },
      };
    },
    run(sql: string, ...params: any[]) { return db.run(sql, ...params); },
  };
}

function wrapBetter(db: any): SQLiteWrapper {
  return {
    exec(sql: string) { db.exec(sql); },
    query(sql: string) {
      const stmt = db.prepare(sql);
      return {
        get(...params: any[]) { return stmt.get(...params); },
        all(...params: any[]) { return stmt.all(...params); },
      };
    },
    run(sql: string, ...params: any[]) { return stmt_run(db, sql, params); },
  };
}

function stmt_run(db: any, sql: string, params: any[]) {
  const stmt = db.prepare(sql);
  return stmt.run(...params);
}

export function createDB(): DB {
  const dbPath = path.resolve(process.cwd(), "db/custom.db");

  // Ensure db directory exists
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Try to open database — prefer better-sqlite3, fallback to bun:sqlite
  let sqlite: SQLiteWrapper;
  try {
    const BetterDatabase = require("better-sqlite3");
    const raw = new BetterDatabase(dbPath);
    raw.pragma("journal_mode = WAL");
    raw.pragma("foreign_keys = ON");
    sqlite = wrapBetter(raw);
    console.log("✅ Using better-sqlite3");
  } catch {
    const { Database: BunDatabase } = require("bun:sqlite");
    const raw = new BunDatabase(dbPath);
    raw.exec("PRAGMA journal_mode = WAL");
    raw.exec("PRAGMA foreign_keys = ON");
    sqlite = wrapBun(raw);
    console.log("✅ Using bun:sqlite");
  }

  // Create tables
  sqlite.exec(CREATE_TABLES_SQL);
  console.log("✅ Database tables ready");

  // Helper: run a query that returns nothing
  const run = (sql: string, ...params: any[]) => sqlite.run(sql, ...params);
  const get = (sql: string, ...params: any[]) => sqlite.query(sql).get(...params);
  const all = (sql: string, ...params: any[]) => sqlite.query(sql).all(...params);

  return {
    getUserByTelegramId(telegramId: number) {
      return get("SELECT * FROM TgUser WHERE telegramId = ?", telegramId) as any | null;
    },

    createUser(telegramId: number, firstName?: string, lastName?: string, username?: string) {
      const id = cuid();
      run("INSERT INTO TgUser (id, telegramId, firstName, lastName, username, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
        id, telegramId, firstName || null, lastName || null, username || null);
      return get("SELECT * FROM TgUser WHERE id = ?", id);
    },

    ensureUser(telegramId: number, firstName?: string, lastName?: string, username?: string) {
      let user = this.getUserByTelegramId(telegramId);
      if (!user) {
        user = this.createUser(telegramId, firstName, lastName, username);
        run("INSERT INTO UserContext (id, userId, preferences, conversationSummary, lastInteraction, createdAt, updatedAt) VALUES (?, ?, '{}', '', datetime('now'), datetime('now'), datetime('now'))",
          cuid(), user.id);
      } else {
        run("UPDATE TgUser SET firstName = ?, lastName = ?, username = ?, updatedAt = datetime('now') WHERE telegramId = ?",
          firstName || null, lastName || null, username || null, telegramId);
      }
      return user;
    },

    addMessage(userId: string, role: string, content: string, messageType = "text", fileName?: string) {
      run("INSERT INTO Message (id, userId, role, content, messageType, fileName, createdAt) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
        cuid(), userId, role, content, messageType, fileName || null);
    },

    getRecentMessages(userId: string, limit = 20) {
      return all("SELECT * FROM Message WHERE userId = ? ORDER BY createdAt DESC LIMIT ?", userId, limit).reverse();
    },

    getConversationHistory(userId: string, limit = 20): { role: "system" | "user" | "assistant"; content: string }[] {
      const messages = this.getRecentMessages(userId, limit);
      return messages.map((m: any) => ({
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      }));
    },

    addReminder(userId: string, text: string, remindAt: Date, isRepeat = false, repeatInterval?: string) {
      const id = cuid();
      run("INSERT INTO Reminder (id, userId, text, remindAt, isSent, isRepeat, repeatInterval, createdAt) VALUES (?, ?, ?, ?, 0, ?, ?, datetime('now'))",
        id, userId, text, remindAt.toISOString(), isRepeat ? 1 : 0, repeatInterval || null);
      return get("SELECT * FROM Reminder WHERE id = ?", id);
    },

    getPendingReminders() {
      return all("SELECT * FROM Reminder WHERE isSent = 0 AND remindAt <= datetime('now')");
    },

    markReminderSent(id: string) {
      run("UPDATE Reminder SET isSent = 1 WHERE id = ?", id);
    },

    getUserReminders(userId: string) {
      return all("SELECT * FROM Reminder WHERE userId = ? AND isSent = 0 ORDER BY remindAt ASC", userId);
    },

    deleteReminder(id: string) {
      run("DELETE FROM Reminder WHERE id = ?", id);
    },

    addShoppingItem(userId: string, text: string, quantity = "1", category = "other") {
      const id = cuid();
      run("INSERT INTO ShoppingItem (id, userId, text, quantity, isBought, category, createdAt) VALUES (?, ?, ?, ?, 0, ?, datetime('now'))",
        id, userId, text, quantity, category);
      return get("SELECT * FROM ShoppingItem WHERE id = ?", id);
    },

    getShoppingList(userId: string) {
      return all("SELECT * FROM ShoppingItem WHERE userId = ? AND isBought = 0 ORDER BY category, createdAt ASC", userId);
    },

    toggleShoppingItem(id: string) {
      run("UPDATE ShoppingItem SET isBought = CASE WHEN isBought = 0 THEN 1 ELSE 0 END WHERE id = ?", id);
    },

    deleteShoppingItem(id: string) {
      run("DELETE FROM ShoppingItem WHERE id = ?", id);
    },

    clearBoughtItems(userId: string) {
      run("DELETE FROM ShoppingItem WHERE userId = ? AND isBought = 1", userId);
    },

    addNote(userId: string, title: string, content: string, tags = "") {
      const id = cuid();
      run("INSERT INTO Note (id, userId, title, content, tags, createdAt) VALUES (?, ?, ?, ?, ?, datetime('now'))",
        id, userId, title, content, tags);
      return get("SELECT * FROM Note WHERE id = ?", id);
    },

    getNotes(userId: string) {
      return all("SELECT * FROM Note WHERE userId = ? ORDER BY createdAt DESC", userId);
    },

    deleteNote(id: string) {
      run("DELETE FROM Note WHERE id = ?", id);
    },

    getUserContext(userId: string) {
      return get("SELECT * FROM UserContext WHERE userId = ?", userId) as any | null;
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
      run(`UPDATE UserContext SET ${fields.join(", ")} WHERE userId = ?`, ...values);
    },

    getTelegramIdByUserId(userId: string): number | null {
      const row = get("SELECT telegramId FROM TgUser WHERE id = ?", userId) as any;
      return row?.telegramId ?? null;
    },
  };
}

function cuid(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}${random}`;
}

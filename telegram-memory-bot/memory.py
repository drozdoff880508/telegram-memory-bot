"""SQLite-based memory module — conversation history, profiles, reminders, notes."""

import sqlite3
import time
from typing import Optional

from config import Config


class Memory:
    """Manages conversation history, user profiles, reminders, and notes in SQLite."""

    def __init__(self, db_path: str = Config.DB_PATH):
        self.db_path = db_path
        self._persistent = db_path != ":memory:"
        self._mem_conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        if self._persistent:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            return conn
        else:
            if self._mem_conn is None:
                self._mem_conn = sqlite3.connect(":memory:")
                self._mem_conn.row_factory = sqlite3.Row
            return self._mem_conn

    def _close_conn(self, conn: sqlite3.Connection):
        if self._persistent:
            conn.close()

    def _init_db(self):
        conn = self._get_conn()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
                content TEXT NOT NULL,
                created_at REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_user_time
            ON messages(user_id, created_at DESC)
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_profiles (
                user_id INTEGER PRIMARY KEY,
                profile TEXT NOT NULL DEFAULT '',
                updated_at REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (user_id, key)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS reminders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                remind_at REAL NOT NULL,
                created_at REAL NOT NULL,
                done INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_reminders_active
            ON reminders(user_id, done, remind_at)
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL,
                created_at REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_notes_user
            ON notes(user_id, created_at DESC)
        """)
        conn.commit()
        self._close_conn(conn)

    # ── Message History ──────────────────────────────────────

    def add_message(self, user_id: int, role: str, content: str):
        conn = self._get_conn()
        conn.execute(
            "INSERT INTO messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (user_id, role, content, time.time()),
        )
        conn.commit()
        self._close_conn(conn)

    def get_history(self, user_id: int, limit: int = Config.MAX_HISTORY_MESSAGES) -> list[dict]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT role, content FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        self._close_conn(conn)
        return [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]

    def clear_history(self, user_id: int):
        conn = self._get_conn()
        conn.execute("DELETE FROM messages WHERE user_id = ?", (user_id,))
        conn.commit()
        self._close_conn(conn)

    # ── User Profiles ────────────────────────────────────────

    def get_profile(self, user_id: int) -> str:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT profile FROM user_profiles WHERE user_id = ?", (user_id,)
        ).fetchone()
        self._close_conn(conn)
        return row["profile"] if row else ""

    def update_profile(self, user_id: int, profile: str):
        profile = profile[: Config.USER_PROFILE_MAX_CHARS]
        conn = self._get_conn()
        conn.execute(
            """INSERT INTO user_profiles (user_id, profile, updated_at) VALUES (?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET profile=?, updated_at=?""",
            (user_id, profile, time.time(), profile, time.time()),
        )
        conn.commit()
        self._close_conn(conn)

    # ── Reminders ────────────────────────────────────────────

    def add_reminder(self, user_id: int, text: str, remind_at: float) -> int:
        """Add a reminder. Returns the reminder ID."""
        conn = self._get_conn()
        cursor = conn.execute(
            "INSERT INTO reminders (user_id, text, remind_at, created_at) VALUES (?, ?, ?, ?)",
            (user_id, text, remind_at, time.time()),
        )
        reminder_id = cursor.lastrowid
        conn.commit()
        self._close_conn(conn)
        return reminder_id

    def get_pending_reminders(self, now: float) -> list[dict]:
        """Get all reminders that are due and not yet done."""
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT id, user_id, text, remind_at FROM reminders WHERE done = 0 AND remind_at <= ?",
            (now,),
        ).fetchall()
        self._close_conn(conn)
        return [dict(r) for r in rows]

    def mark_reminder_done(self, reminder_id: int):
        conn = self._get_conn()
        conn.execute("UPDATE reminders SET done = 1 WHERE id = ?", (reminder_id,))
        conn.commit()
        self._close_conn(conn)

    def get_user_reminders(self, user_id: int) -> list[dict]:
        """Get all active (not done) reminders for a user."""
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT id, text, remind_at FROM reminders WHERE user_id = ? AND done = 0 ORDER BY remind_at",
            (user_id,),
        ).fetchall()
        self._close_conn(conn)
        return [dict(r) for r in rows]

    def cancel_reminder(self, reminder_id: int, user_id: int) -> bool:
        """Cancel a reminder. Returns True if found and cancelled."""
        conn = self._get_conn()
        cursor = conn.execute(
            "UPDATE reminders SET done = 1 WHERE id = ? AND user_id = ? AND done = 0",
            (reminder_id, user_id),
        )
        affected = cursor.rowcount
        conn.commit()
        self._close_conn(conn)
        return affected > 0

    # ── Notes ────────────────────────────────────────────────

    def add_note(self, user_id: int, title: str, content: str) -> int:
        conn = self._get_conn()
        cursor = conn.execute(
            "INSERT INTO notes (user_id, title, content, created_at) VALUES (?, ?, ?, ?)",
            (user_id, title, content, time.time()),
        )
        note_id = cursor.lastrowid
        conn.commit()
        self._close_conn(conn)
        return note_id

    def get_notes(self, user_id: int, limit: int = 20) -> list[dict]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT id, title, content, created_at FROM notes WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        self._close_conn(conn)
        return [dict(r) for r in reversed(rows)]

    def delete_note(self, note_id: int, user_id: int) -> bool:
        conn = self._get_conn()
        cursor = conn.execute(
            "DELETE FROM notes WHERE id = ? AND user_id = ?",
            (note_id, user_id),
        )
        affected = cursor.rowcount
        conn.commit()
        self._close_conn(conn)
        return affected > 0

    def search_notes(self, user_id: int, query: str) -> list[dict]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT id, title, content, created_at FROM notes WHERE user_id = ? AND (title LIKE ? OR content LIKE ?) ORDER BY created_at DESC LIMIT 10",
            (user_id, f"%{query}%", f"%{query}%"),
        ).fetchall()
        self._close_conn(conn)
        return [dict(r) for r in rows]

    # ── User Settings ────────────────────────────────────────

    def get_setting(self, user_id: int, key: str, default: str = "") -> str:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT value FROM user_settings WHERE user_id = ? AND key = ?",
            (user_id, key),
        ).fetchone()
        self._close_conn(conn)
        return row["value"] if row else default

    def set_setting(self, user_id: int, key: str, value: str):
        conn = self._get_conn()
        conn.execute(
            """INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
               ON CONFLICT(user_id, key) DO UPDATE SET value=?""",
            (user_id, key, value, value),
        )
        conn.commit()
        self._close_conn(conn)

    # ── Stats ────────────────────────────────────────────────

    def get_stats(self, user_id: int) -> dict:
        conn = self._get_conn()
        msg_count = conn.execute(
            "SELECT COUNT(*) as c FROM messages WHERE user_id = ?", (user_id,)
        ).fetchone()["c"]
        first_msg = conn.execute(
            "SELECT MIN(created_at) as t FROM messages WHERE user_id = ?", (user_id,)
        ).fetchone()["t"]
        note_count = conn.execute(
            "SELECT COUNT(*) as c FROM notes WHERE user_id = ?", (user_id,)
        ).fetchone()["c"]
        active_reminders = conn.execute(
            "SELECT COUNT(*) as c FROM reminders WHERE user_id = ? AND done = 0", (user_id,)
        ).fetchone()["c"]
        self._close_conn(conn)
        return {
            "message_count": msg_count,
            "first_message": time.strftime("%Y-%m-%d", time.localtime(first_msg)) if first_msg else "never",
            "note_count": note_count,
            "active_reminders": active_reminders,
        }

    # ── Cleanup ──────────────────────────────────────────────

    def prune_old_messages(self, user_id: int, keep_last: int = 200):
        conn = self._get_conn()
        conn.execute(
            """DELETE FROM messages WHERE user_id = ? AND id NOT IN (
               SELECT id FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
            )""",
            (user_id, user_id, keep_last),
        )
        conn.commit()
        self._close_conn(conn)

"""SQLite-based memory module — conversation history + user profiles."""

import sqlite3
import time
from typing import Optional

from config import Config


class Memory:
    """Manages conversation history and user profiles in SQLite."""

    def __init__(self, db_path: str = Config.DB_PATH):
        self.db_path = db_path
        self._persistent = db_path != ":memory:"
        self._mem_conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        """Get a database connection.

        For persistent DBs: creates a new connection each time (thread-safe).
        For :memory: DBs: returns a single shared connection (data survives across calls).
        """
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
        """Close connection only for persistent DBs."""
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
        conn.commit()
        self._close_conn(conn)

    # ── Message History ──────────────────────────────────────

    def add_message(self, user_id: int, role: str, content: str):
        """Add a message to conversation history."""
        conn = self._get_conn()
        conn.execute(
            "INSERT INTO messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (user_id, role, content, time.time()),
        )
        conn.commit()
        self._close_conn(conn)

    def get_history(self, user_id: int, limit: int = Config.MAX_HISTORY_MESSAGES) -> list[dict]:
        """Get recent conversation messages for a user."""
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT role, content FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        self._close_conn(conn)
        # Return in chronological order
        return [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]

    def clear_history(self, user_id: int):
        """Clear conversation history for a user."""
        conn = self._get_conn()
        conn.execute("DELETE FROM messages WHERE user_id = ?", (user_id,))
        conn.commit()
        self._close_conn(conn)

    # ── User Profiles ────────────────────────────────────────

    def get_profile(self, user_id: int) -> str:
        """Get user profile (auto-generated summary of preferences/context)."""
        conn = self._get_conn()
        row = conn.execute(
            "SELECT profile FROM user_profiles WHERE user_id = ?", (user_id,)
        ).fetchone()
        self._close_conn(conn)
        return row["profile"] if row else ""

    def update_profile(self, user_id: int, profile: str):
        """Update user profile."""
        profile = profile[: Config.USER_PROFILE_MAX_CHARS]
        conn = self._get_conn()
        conn.execute(
            """INSERT INTO user_profiles (user_id, profile, updated_at) VALUES (?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET profile=?, updated_at=?""",
            (user_id, profile, time.time(), profile, time.time()),
        )
        conn.commit()
        self._close_conn(conn)

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
        """Get usage statistics for a user."""
        conn = self._get_conn()
        msg_count = conn.execute(
            "SELECT COUNT(*) as c FROM messages WHERE user_id = ?", (user_id,)
        ).fetchone()["c"]
        first_msg = conn.execute(
            "SELECT MIN(created_at) as t FROM messages WHERE user_id = ?", (user_id,)
        ).fetchone()["t"]
        self._close_conn(conn)
        return {
            "message_count": msg_count,
            "first_message": time.strftime("%Y-%m-%d", time.localtime(first_msg)) if first_msg else "never",
        }

    # ── Cleanup ──────────────────────────────────────────────

    def prune_old_messages(self, user_id: int, keep_last: int = 200):
        """Keep only the most recent messages for a user."""
        conn = self._get_conn()
        conn.execute(
            """DELETE FROM messages WHERE user_id = ? AND id NOT IN (
               SELECT id FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
            )""",
            (user_id, user_id, keep_last),
        )
        conn.commit()
        self._close_conn(conn)

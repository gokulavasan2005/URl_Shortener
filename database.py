"""
database.py
-----------
Handles all PostgreSQL database interactions for the URL Shortener.
Creates the DB tables on first run, and exposes helper functions
used by app.py routes.

Uses psycopg2 with a DATABASE_URL environment variable.
Falls back to SQLite for local development if DATABASE_URL is not set.
"""

import os
from datetime import datetime

DATABASE_URL = os.environ.get("DATABASE_URL")

if DATABASE_URL:
    # -----------------------------------------------------------------------
    # PostgreSQL mode (Render / production)
    # -----------------------------------------------------------------------
    import psycopg2
    import psycopg2.extras

    def get_connection():
        """Return a new PostgreSQL connection with dict cursor support."""
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = False
        return conn

    def init_db():
        """Create tables if they don't exist. Safe to call on every cold start."""
        conn = get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS urls (
                        id          SERIAL PRIMARY KEY,
                        short_code  TEXT    NOT NULL UNIQUE,
                        original_url TEXT   NOT NULL,
                        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
                        expires_at  TIMESTAMP,
                        click_count INTEGER  NOT NULL DEFAULT 0,
                        creator_ip  TEXT
                    );

                    CREATE INDEX IF NOT EXISTS idx_urls_short_code
                        ON urls(short_code);

                    CREATE INDEX IF NOT EXISTS idx_urls_creator_ip_created
                        ON urls(creator_ip, created_at);

                    CREATE TABLE IF NOT EXISTS clicks (
                        id          SERIAL PRIMARY KEY,
                        url_id      INTEGER NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
                        clicked_at  TIMESTAMP NOT NULL DEFAULT NOW(),
                        referrer    TEXT,
                        user_agent  TEXT
                    );

                    CREATE INDEX IF NOT EXISTS idx_clicks_url_id
                        ON clicks(url_id);

                    CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at
                        ON clicks(clicked_at);
                """)
            conn.commit()
        finally:
            conn.close()

    # --- URL helpers -------------------------------------------------------

    def create_url(short_code: str, original_url: str, creator_ip: str,
                   expires_at: str | None = None) -> dict:
        """
        Insert a new URL mapping.
        Returns the newly created row as a dict.
        """
        conn = get_connection()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    INSERT INTO urls (short_code, original_url, creator_ip, expires_at)
                    VALUES (%s, %s, %s, %s)
                    RETURNING *
                    """,
                    (short_code, original_url, creator_ip, expires_at),
                )
                row = cur.fetchone()
            conn.commit()
            # Convert datetime objects to ISO strings for consistency
            return _row_to_dict(row)
        finally:
            conn.close()

    def get_url_by_code(short_code: str) -> dict | None:
        """Fetch a URL row by its short code. Returns dict or None."""
        conn = get_connection()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT * FROM urls WHERE short_code = %s", (short_code,))
                row = cur.fetchone()
            return _row_to_dict(row) if row else None
        finally:
            conn.close()

    def get_all_urls() -> list[dict]:
        """Return all URL rows ordered by creation date (newest first)."""
        conn = get_connection()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT * FROM urls ORDER BY created_at DESC")
                rows = cur.fetchall()
            return [_row_to_dict(r) for r in rows]
        finally:
            conn.close()

    def delete_url(short_code: str) -> bool:
        """Delete a URL and its click history. Returns True if something was deleted."""
        conn = get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM urls WHERE short_code = %s", (short_code,))
                deleted = cur.rowcount > 0
            conn.commit()
            return deleted
        finally:
            conn.close()

    def short_code_exists(short_code: str) -> bool:
        """Quick existence check for custom alias validation."""
        conn = get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM urls WHERE short_code = %s", (short_code,))
                return cur.fetchone() is not None
        finally:
            conn.close()

    # --- Click helpers -----------------------------------------------------

    def record_click(url_id: int, referrer: str | None, user_agent: str | None):
        """Log a click and increment the denormalised click_count on urls."""
        conn = get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO clicks (url_id, referrer, user_agent) VALUES (%s, %s, %s)",
                    (url_id, referrer, user_agent),
                )
                cur.execute(
                    "UPDATE urls SET click_count = click_count + 1 WHERE id = %s",
                    (url_id,),
                )
            conn.commit()
        finally:
            conn.close()

    def get_clicks_over_time(url_id: int) -> list[dict]:
        """
        Return daily click counts for the last 30 days for a given URL.
        Result: [{"date": "YYYY-MM-DD", "count": N}, ...]
        """
        conn = get_connection()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT
                        TO_CHAR(clicked_at, 'YYYY-MM-DD') AS date,
                        COUNT(*)                           AS count
                    FROM clicks
                    WHERE url_id = %s
                      AND clicked_at >= NOW() - INTERVAL '30 days'
                    GROUP BY TO_CHAR(clicked_at, 'YYYY-MM-DD')
                    ORDER BY date ASC
                    """,
                    (url_id,),
                )
                rows = cur.fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def count_recent_urls_by_ip(ip: str, hours: int = 1) -> int:
        """Return how many URLs this IP created in the last `hours` hours."""
        conn = get_connection()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT COUNT(*) AS cnt
                    FROM urls
                    WHERE creator_ip = %s
                      AND created_at >= NOW() - (%s * INTERVAL '1 hour')
                    """,
                    (ip, hours),
                )
                row = cur.fetchone()
            return row["cnt"] if row else 0
        finally:
            conn.close()

    # --- Helpers -----------------------------------------------------------

    def _row_to_dict(row: dict) -> dict:
        """Convert a RealDictRow to a plain dict with ISO-formatted datetime strings."""
        d = dict(row)
        for key in ("created_at", "expires_at", "clicked_at"):
            if key in d and isinstance(d[key], datetime):
                d[key] = d[key].strftime("%Y-%m-%d %H:%M:%S")
        return d


else:
    # -----------------------------------------------------------------------
    # SQLite mode (local development without DATABASE_URL)
    # -----------------------------------------------------------------------
    import sqlite3

    DB_PATH = os.path.join(os.path.dirname(__file__), "url_shortener.db")

    def get_connection():
        """Return a new SQLite connection with Row factory for dict-like access."""
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")  # better concurrency
        return conn

    def init_db():
        """Create tables if they don't exist. Safe to call on every startup."""
        conn = get_connection()
        with conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS urls (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    short_code  TEXT    NOT NULL UNIQUE,
                    original_url TEXT   NOT NULL,
                    created_at  DATETIME NOT NULL DEFAULT (datetime('now')),
                    expires_at  DATETIME,               -- NULL means never expires
                    click_count INTEGER  NOT NULL DEFAULT 0,
                    creator_ip  TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_urls_short_code
                    ON urls(short_code);

                CREATE INDEX IF NOT EXISTS idx_urls_creator_ip_created
                    ON urls(creator_ip, created_at);

                CREATE TABLE IF NOT EXISTS clicks (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    url_id      INTEGER NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
                    clicked_at  DATETIME NOT NULL DEFAULT (datetime('now')),
                    referrer    TEXT,
                    user_agent  TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_clicks_url_id
                    ON clicks(url_id);

                CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at
                    ON clicks(clicked_at);
            """)
        conn.close()

    # --- URL helpers -------------------------------------------------------

    def create_url(short_code: str, original_url: str, creator_ip: str,
                   expires_at: str | None = None) -> dict:
        """
        Insert a new URL mapping.
        Returns the newly created row as a dict.
        Raises sqlite3.IntegrityError if short_code already exists.
        """
        conn = get_connection()
        with conn:
            conn.execute(
                """
                INSERT INTO urls (short_code, original_url, creator_ip, expires_at)
                VALUES (?, ?, ?, ?)
                """,
                (short_code, original_url, creator_ip, expires_at),
            )
        row = get_url_by_code(short_code)
        conn.close()
        return row

    def get_url_by_code(short_code: str) -> dict | None:
        """Fetch a URL row by its short code. Returns dict or None."""
        conn = get_connection()
        row = conn.execute(
            "SELECT * FROM urls WHERE short_code = ?", (short_code,)
        ).fetchone()
        conn.close()
        return dict(row) if row else None

    def get_all_urls() -> list[dict]:
        """Return all URL rows ordered by creation date (newest first)."""
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM urls ORDER BY created_at DESC"
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def delete_url(short_code: str) -> bool:
        """Delete a URL and its click history. Returns True if something was deleted."""
        conn = get_connection()
        with conn:
            cur = conn.execute(
                "DELETE FROM urls WHERE short_code = ?", (short_code,)
            )
        conn.close()
        return cur.rowcount > 0

    def short_code_exists(short_code: str) -> bool:
        """Quick existence check for custom alias validation."""
        conn = get_connection()
        row = conn.execute(
            "SELECT 1 FROM urls WHERE short_code = ?", (short_code,)
        ).fetchone()
        conn.close()
        return row is not None

    # --- Click helpers -----------------------------------------------------

    def record_click(url_id: int, referrer: str | None, user_agent: str | None):
        """Log a click and increment the denormalised click_count on urls."""
        conn = get_connection()
        with conn:
            conn.execute(
                """
                INSERT INTO clicks (url_id, referrer, user_agent)
                VALUES (?, ?, ?)
                """,
                (url_id, referrer, user_agent),
            )
            conn.execute(
                "UPDATE urls SET click_count = click_count + 1 WHERE id = ?",
                (url_id,),
            )
        conn.close()

    def get_clicks_over_time(url_id: int) -> list[dict]:
        """
        Return daily click counts for the last 30 days for a given URL.
        Result: [{"date": "YYYY-MM-DD", "count": N}, ...]
        """
        conn = get_connection()
        rows = conn.execute(
            """
            SELECT
                strftime('%Y-%m-%d', clicked_at) AS date,
                COUNT(*)                          AS count
            FROM clicks
            WHERE url_id = ?
              AND clicked_at >= datetime('now', '-30 days')
            GROUP BY strftime('%Y-%m-%d', clicked_at)
            ORDER BY date ASC
            """,
            (url_id,),
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]

    # --- Rate-limit helpers ------------------------------------------------

    def count_recent_urls_by_ip(ip: str, hours: int = 1) -> int:
        """Return how many URLs this IP created in the last `hours` hours."""
        conn = get_connection()
        row = conn.execute(
            """
            SELECT COUNT(*) AS cnt
            FROM urls
            WHERE creator_ip = ?
              AND created_at >= datetime('now', ? )
            """,
            (ip, f"-{hours} hours"),
        ).fetchone()
        conn.close()
        return row["cnt"] if row else 0

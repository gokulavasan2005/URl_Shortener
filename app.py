"""
app.py
------
Flask entry point for the URL Shortener application.

Routes
------
GET  /                        → serve the single-page app
POST /api/shorten             → create a short URL
GET  /api/urls                → list all URLs + stats
GET  /api/stats/<short_code>  → clicks-over-time data for Chart.js
DELETE /api/urls/<short_code> → delete a mapping
GET  /api/qr/<short_code>     → return QR code as PNG
GET  /<short_code>            → redirect (or show expired / 404 page)
"""

import io
import os
import re
import string
import random
from datetime import datetime, UTC
from urllib.parse import urlparse

from flask import (
    Flask, redirect, request, jsonify,
    render_template, send_file, abort, session,
)
from werkzeug.security import generate_password_hash, check_password_hash

import database as db

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = Flask(
    __name__,
    static_folder="static",
    template_folder="templates",
)
app.secret_key = os.environ.get("SECRET_KEY", "snapurl-super-secret-key-2026")

# Initialise DB tables on import so gunicorn workers create them on cold start
db.init_db()

# Rate-limit: max URLs a single IP may shorten per hour
RATE_LIMIT = 10

# Short-code settings
BASE62_CHARS = string.digits + string.ascii_letters  # 0-9 A-Z a-z
SHORT_CODE_LENGTH = 6
CUSTOM_ALIAS_PATTERN = re.compile(r"^[A-Za-z0-9_-]{3,30}$")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def generate_short_code(length: int = SHORT_CODE_LENGTH) -> str:
    """
    Generate a unique Base62 short code.
    Loops until a code not already in the DB is found (collision is rare
    with 62^6 = 56 billion possibilities).
    """
    while True:
        code = "".join(random.choices(BASE62_CHARS, k=length))
        if not db.short_code_exists(code):
            return code


def validate_url(url: str) -> bool:
    """Return True only for http/https URLs with a valid netloc."""
    try:
        parsed = urlparse(url)
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)
    except Exception:
        return False


def get_client_ip() -> str:
    """Return real client IP, honouring X-Forwarded-For if present."""
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip()
    return request.remote_addr or "unknown"


def row_to_api(row: dict, base_url: str) -> dict:
    """Convert a DB url row to the API shape sent to the frontend."""
    return {
        "id":           row["id"],
        "short_code":   row["short_code"],
        "short_url":    f"{base_url}/{row['short_code']}",
        "original_url": row["original_url"],
        "created_at":   row["created_at"],
        "expires_at":   row["expires_at"],
        "click_count":  row["click_count"],
        "is_expired":   _is_expired(row),
    }


def _is_expired(row: dict) -> bool:
    if not row.get("expires_at"):
        return False
    try:
        exp = datetime.fromisoformat(row["expires_at"])
        # Normalise both sides to UTC-aware for a safe comparison
        now = datetime.now(UTC)
        if exp.tzinfo is None:
            # Treat naive DB timestamps as UTC
            exp = exp.replace(tzinfo=UTC)
        return now > exp
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Main SPA route
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------

@app.route("/api/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    email = (data.get("email") or "").strip()
    password = data.get("password") or ""

    if not username or len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters."}), 400
    if not email or "@" not in email:
        return jsonify({"error": "Valid email address is required."}), 400
    if not password or len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters."}), 400

    if db.get_user_by_username(username):
        return jsonify({"error": "Username is already taken."}), 409
    if db.get_user_by_email(email):
        return jsonify({"error": "Email is already registered."}), 409

    pwd_hash = generate_password_hash(password)
    try:
        user = db.create_user(username, email, pwd_hash)
        session["user_id"] = user["id"]
        return jsonify({"message": "Registered successfully", "user": {"id": user["id"], "username": user["username"], "email": user["email"]}}), 201
    except Exception as e:
        app.logger.error("Error in registration: %s", e)
        return jsonify({"error": "Could not register user."}), 500


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    login_id = (data.get("login") or "").strip()  # email or username
    password = data.get("password") or ""

    if not login_id or not password:
        return jsonify({"error": "Username/Email and Password are required."}), 400

    user = db.get_user_by_email(login_id) if "@" in login_id else db.get_user_by_username(login_id)
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid credentials."}), 401

    session["user_id"] = user["id"]
    return jsonify({"message": "Logged in successfully", "user": {"id": user["id"], "username": user["username"], "email": user["email"]}}), 200


@app.route("/api/logout", methods=["POST"])
def logout():
    session.pop("user_id", None)
    return jsonify({"message": "Logged out successfully."}), 200


@app.route("/api/me", methods=["GET"])
def get_me():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"user": None}), 200

    user = db.get_user_by_id(user_id)
    if not user:
        session.pop("user_id", None)
        return jsonify({"user": None}), 200

    return jsonify({"user": user}), 200


# ---------------------------------------------------------------------------
# POST /api/shorten
# ---------------------------------------------------------------------------

@app.route("/api/shorten", methods=["POST"])
def shorten():
    data = request.get_json(silent=True) or {}

    # --- input validation ---
    original_url = (data.get("url") or "").strip()
    if not original_url:
        return jsonify({"error": "URL is required."}), 400
    if not validate_url(original_url):
        return jsonify({"error": "Invalid URL. Must start with http:// or https://."}), 400

    custom_alias = (data.get("alias") or "").strip()
    expires_at   = (data.get("expires_at") or "").strip() or None

    # --- custom alias validation ---
    if custom_alias:
        if not CUSTOM_ALIAS_PATTERN.match(custom_alias):
            return jsonify({
                "error": "Alias must be 3–30 characters and contain only letters, digits, _ or -."
            }), 400
        if db.short_code_exists(custom_alias):
            return jsonify({"error": f"The alias '{custom_alias}' is already taken."}), 409

    # --- expiry date validation ---
    if expires_at:
        try:
            exp_dt = datetime.fromisoformat(expires_at)
            # Normalise to UTC-aware for comparison
            now_utc = datetime.now(UTC)
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=UTC)
            if exp_dt <= now_utc:
                return jsonify({"error": "Expiry date must be in the future."}), 400
            expires_at = exp_dt.strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            return jsonify({"error": "Invalid expiry date format."}), 400

    # --- rate limiting ---
    client_ip = get_client_ip()
    user_id = session.get("user_id")
    if not user_id and db.count_recent_urls_by_ip(client_ip) >= RATE_LIMIT:
        return jsonify({
            "error": f"Rate limit exceeded. You can create at most {RATE_LIMIT} links per hour."
        }), 429

    # --- create URL ---
    short_code = custom_alias if custom_alias else generate_short_code()
    try:
        row = db.create_url(short_code, original_url, client_ip, expires_at, user_id)
    except Exception as e:
        app.logger.error("DB error in /api/shorten: %s", e)
        return jsonify({"error": "Could not save URL. Please try again."}), 500

    base_url = request.host_url.rstrip("/")
    return jsonify(row_to_api(row, base_url)), 201


# ---------------------------------------------------------------------------
# GET /api/urls
# ---------------------------------------------------------------------------

@app.route("/api/urls", methods=["GET"])
def list_urls():
    user_id  = session.get("user_id")
    rows     = db.get_all_urls(user_id=user_id)
    base_url = request.host_url.rstrip("/")
    return jsonify([row_to_api(r, base_url) for r in rows])


# ---------------------------------------------------------------------------
# DELETE /api/urls/<short_code>
# ---------------------------------------------------------------------------

@app.route("/api/urls/<short_code>", methods=["DELETE"])
def delete_url(short_code):
    deleted = db.delete_url(short_code)
    if not deleted:
        return jsonify({"error": "Short code not found."}), 404
    return jsonify({"message": "Deleted successfully."}), 200


# ---------------------------------------------------------------------------
# GET /api/stats/<short_code>
# ---------------------------------------------------------------------------

@app.route("/api/stats/<short_code>", methods=["GET"])
def stats(short_code):
    row = db.get_url_by_code(short_code)
    if not row:
        return jsonify({"error": "Short code not found."}), 404

    base_url    = request.host_url.rstrip("/")
    clicks_data = db.get_clicks_over_time(row["id"])
    return jsonify({
        "url":    row_to_api(row, base_url),
        "clicks": clicks_data,
    })


# ---------------------------------------------------------------------------
# GET /api/qr/<short_code>
# ---------------------------------------------------------------------------

@app.route("/api/qr/<short_code>", methods=["GET"])
def qr_code(short_code):
    row = db.get_url_by_code(short_code)
    if not row:
        return jsonify({"error": "Short code not found."}), 404

    try:
        import qrcode
        short_url = f"{request.host_url.rstrip('/')}/{short_code}"
        img = qrcode.make(short_url)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        return send_file(buf, mimetype="image/png",
                         download_name=f"{short_code}_qr.png")
    except ImportError:
        return jsonify({"error": "QR library not installed. Run: pip install qrcode[pil]"}), 500
    except Exception as e:
        app.logger.error("QR generation error: %s", e)
        return jsonify({"error": "Could not generate QR code."}), 500


# ---------------------------------------------------------------------------
# GET /<short_code>  — the redirect endpoint
# ---------------------------------------------------------------------------

@app.route("/<short_code>")
def redirect_to_url(short_code):
    row = db.get_url_by_code(short_code)

    if not row:
        return render_template("404.html", short_code=short_code), 404

    if _is_expired(row):
        return render_template(
            "expired.html",
            short_code=short_code,
            original_url=row["original_url"],
            expires_at=row["expires_at"],
        ), 410

    # Record the click asynchronously-safe (single-threaded Flask default)
    db.record_click(
        url_id     = row["id"],
        referrer   = request.referrer,
        user_agent = request.user_agent.string,
    )

    return redirect(row["original_url"], code=302)


# ---------------------------------------------------------------------------
# Custom error handlers
# ---------------------------------------------------------------------------

@app.errorhandler(404)
def page_not_found(e):
    return render_template("404.html", short_code=""), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": "Internal server error."}), 500


# ---------------------------------------------------------------------------
# Entry point (local development only — production uses gunicorn)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "false").lower() in ("1", "true", "yes")
    port = int(os.environ.get("PORT", 5000))
    print("=" * 50)
    print(f"  URL Shortener running at http://127.0.0.1:{port}")
    print("=" * 50)
    app.run(debug=debug, host="0.0.0.0", port=port)

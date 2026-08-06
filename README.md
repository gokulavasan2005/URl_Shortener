# ⚡ SnapURL — URL Shortener

> **College Mini Project** | Full-Stack Web Application

A production-quality URL shortener built with **Python (Flask)** and **SQLite** on the backend, and a single-page **HTML/CSS/JavaScript** frontend. Fully self-hosted — no external databases, no paid APIs, no cloud required.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔗 **URL Shortening** | Generates unique 6-character Base62 codes (62⁶ ≈ 56 billion combinations) |
| 📊 **Click Analytics** | Tracks every redirect with timestamp, referrer, and user agent |
| 📈 **Interactive Chart** | Chart.js bar graph showing clicks per day (last 30 days) |
| 📋 **Copy to Clipboard** | One-click copy for every short link |
| 🎨 **Custom Aliases** | Choose your own short code (e.g. `/my-link`) |
| ⏰ **Link Expiration** | Set an optional expiry date — expired links show a 410 page |
| 📱 **QR Code Generation** | Instant QR codes downloadable as PNG |
| 🔒 **Rate Limiting** | Max 10 links per IP per hour to prevent abuse |
| 🔍 **Dashboard Search** | Live filter across all your shortened links |
| 🚫 **Custom 404 Page** | Styled error page for invalid/deleted short codes |

---

## 🗂️ Project Structure

```
SnapURL/
├── app.py              # Flask app — all routes and business logic
├── database.py         # SQLite schema, init, and helper functions
├── requirements.txt    # Python dependencies
├── README.md
├── url_shortener.db    # Auto-created SQLite database (after first run)
│
├── templates/
│   ├── index.html      # Main single-page application shell
│   ├── 404.html        # Custom "Not Found" page
│   └── expired.html    # Custom "Link Expired" (410) page
│
└── static/
    ├── css/
    │   └── style.css   # Full design system (dark glassmorphism theme)
    └── js/
        └── app.js      # Frontend SPA logic (no frameworks)
```

---

## 🗄️ Database Schema

### `urls`
| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment primary key |
| `short_code` | TEXT UNIQUE | 6-char Base62 code or custom alias |
| `original_url` | TEXT | Full destination URL |
| `created_at` | DATETIME | Timestamp when link was created |
| `expires_at` | DATETIME | Optional expiry (NULL = never) |
| `click_count` | INTEGER | Denormalised running total |
| `creator_ip` | TEXT | IP used for rate limiting |

### `clicks`
| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `url_id` | INTEGER FK | References `urls.id` (cascade delete) |
| `clicked_at` | DATETIME | Exact time of each redirect |
| `referrer` | TEXT | HTTP Referrer header |
| `user_agent` | TEXT | Browser / client info |

---

## 🚀 Setup & Run

### Prerequisites
- **Python 3.10+** — [Download](https://python.org/downloads)
- `pip` (comes with Python)

### 1 — Clone / download the project

```bash
# If using git:
git clone <your-repo-url>
cd SnapURL

# Or just unzip the project folder and open a terminal inside it
```

### 2 — Create a virtual environment (recommended)

```bash
python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate
```

### 3 — Install dependencies

```bash
pip install -r requirements.txt
```

### 4 — Run the server

```bash
python app.py
```

You should see:
```
==================================================
  URL Shortener running at http://127.0.0.1:5000
==================================================
```

### 5 — Open in your browser

Navigate to **[http://127.0.0.1:5000](http://127.0.0.1:5000)**

> The SQLite database (`url_shortener.db`) is created automatically on first run.

---

## 🔌 API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Serve the single-page application |
| `POST` | `/api/shorten` | Create a short URL |
| `GET` | `/api/urls` | List all URLs with stats |
| `GET` | `/api/stats/<code>` | Click analytics for a URL |
| `DELETE` | `/api/urls/<code>` | Delete a URL mapping |
| `GET` | `/api/qr/<code>` | Return QR code as PNG |
| `GET` | `/<code>` | Redirect to original URL |

### POST `/api/shorten` — Request Body

```json
{
  "url":        "https://example.com/very-long-path",
  "alias":      "my-link",
  "expires_at": "2025-12-31 23:59:00"
}
```

> `alias` and `expires_at` are optional.

### Response (201)

```json
{
  "id": 1,
  "short_code": "my-link",
  "short_url": "http://127.0.0.1:5000/my-link",
  "original_url": "https://example.com/very-long-path",
  "created_at": "2025-01-15 10:30:00",
  "expires_at": "2025-12-31 23:59:00",
  "click_count": 0,
  "is_expired": false
}
```

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| **Web Framework** | Python Flask 3.x |
| **Database** | SQLite (via Python's built-in `sqlite3`) |
| **Frontend** | Vanilla HTML5 + CSS3 + JavaScript (ES2022) |
| **Charting** | Chart.js 4 (CDN) |
| **QR Codes** | `qrcode[pil]` Python library |
| **Fonts** | Google Fonts — Inter |

---

## 🎨 Design Highlights

- **Dark glassmorphism** UI with animated background orbs
- **Gradient accent** palette (violet → cyan)
- **Micro-animations** on all interactive elements
- **Fully responsive** — works on mobile, tablet, and desktop
- **Accessible** — semantic HTML5, ARIA roles, keyboard navigable

---

## 📋 Usage Examples

### Shorten a URL via curl

```bash
curl -X POST http://127.0.0.1:5000/api/shorten \
  -H "Content-Type: application/json" \
  -d '{"url": "https://github.com/some/very-long-repo-path"}'
```

### Shorten with custom alias and expiry

```bash
curl -X POST http://127.0.0.1:5000/api/shorten \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "alias": "demo", "expires_at": "2025-12-31 23:59:00"}'
```

### View analytics

```bash
curl http://127.0.0.1:5000/api/stats/demo
```

---

## 🔐 Security Notes

- **Input validation**: All URLs are validated for `http://` / `https://` scheme
- **Custom alias validation**: Only alphanumeric, `-`, and `_` allowed (3–30 chars)
- **Rate limiting**: 10 links per IP per hour (configurable via `RATE_LIMIT` in `app.py`)
- **SQL injection**: All queries use parameterized statements via SQLite's `?` placeholders
- **XSS**: All user content is HTML-escaped before rendering in the dashboard

---

## 🤝 Project Report Notes

This mini project demonstrates:

1. **Full-stack web development** with Python and vanilla JavaScript
2. **RESTful API design** with proper HTTP status codes
3. **Relational database design** with foreign keys and indexes
4. **Data analytics** — collecting and visualising click data over time
5. **Input validation and error handling** at both client and server layers
6. **Modern UI/UX** design principles — responsive, accessible, animated

---

*Built as a college mini project submission. All code is original and self-contained.*

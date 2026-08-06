# 🔗 URL Shortener

A full-featured URL shortener built with **Flask**, featuring click analytics, QR code generation, custom aliases, link expiration, and rate limiting.

## ✨ Features

- **Shorten URLs** with auto-generated Base62 short codes
- **Custom aliases** (3–30 chars, letters/digits/underscore/hyphen)
- **Link expiration** — set an optional expiry date
- **Click analytics** — track clicks over time with Chart.js graphs
- **QR codes** — generate downloadable QR codes for any short link
- **Rate limiting** — max 10 URLs per IP per hour
- **Responsive UI** — works on desktop and mobile

## 🛠️ Tech Stack

| Layer      | Technology       |
|------------|------------------|
| Backend    | Flask (Python)   |
| Database   | PostgreSQL (prod) / SQLite (local) |
| Server     | Gunicorn (prod)  |
| Frontend   | HTML, CSS, Vanilla JS, Chart.js |
| Hosting    | Render (free tier) |

---

## 🚀 Local Development Setup

### Prerequisites
- Python 3.10+
- pip

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/gokulavasan2005/URl_Shortener.git
cd URl_Shortener

# 2. Create a virtual environment (optional but recommended)
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux

# 3. Install dependencies
pip install -r requirements.txt

# 4. (Optional) Copy env file for local config
copy .env.example .env       # Windows
# cp .env.example .env       # macOS/Linux

# 5. Run the app
python app.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000) in your browser.

> **Note:** Locally, the app uses **SQLite** (`url_shortener.db`) — no database setup needed.
> Set `FLASK_DEBUG=true` in your `.env` for auto-reload during development.

---

## ☁️ Deploy to Render (Free Tier)

### 1. Push to GitHub

```bash
git add .
git commit -m "Prepare for Render deployment"
git push origin main
```

### 2. Create a PostgreSQL Database on Render

1. Go to [dashboard.render.com](https://dashboard.render.com)
2. Click **New → PostgreSQL**
3. Fill in:
   - **Name:** `url-shortener-db`
   - **Region:** Pick the closest to you
   - **Plan:** Free
4. Click **Create Database**
5. Once created, copy the **Internal Database URL** (starts with `postgresql://...`)

### 3. Create a Web Service on Render

1. Click **New → Web Service**
2. Connect your GitHub repo (`gokulavasan2005/URl_Shortener`)
3. Configure:

| Setting          | Value                              |
|------------------|------------------------------------|
| **Name**         | `url-shortener`                    |
| **Region**       | Same as your database              |
| **Runtime**      | Python 3                           |
| **Build Command**| `pip install -r requirements.txt`  |
| **Start Command**| `gunicorn app:app`                 |
| **Plan**         | Free                               |

4. Under **Environment Variables**, add:

| Key            | Value                                          |
|----------------|------------------------------------------------|
| `DATABASE_URL` | *(paste the Internal Database URL from step 2)* |
| `FLASK_DEBUG`  | `false`                                        |

5. Click **Create Web Service**

### 4. Verify Deployment

Once deployed (takes ~2 minutes), Render gives you a URL like `https://url-shortener-xxxx.onrender.com`.

Test the flow:
1. Open the URL → you should see the shortener UI
2. Paste a long URL → click Shorten → get a short link
3. Open the short link in a new tab → should redirect to the original URL
4. Check the analytics chart on the dashboard

---

## 📁 Project Structure

```
URl_Shortener/
├── app.py              # Flask routes and application logic
├── database.py         # Database layer (PostgreSQL + SQLite fallback)
├── requirements.txt    # Python dependencies
├── Procfile            # Render/Gunicorn start command
├── .env.example        # Template for environment variables
├── .gitignore          # Files excluded from git
├── static/
│   ├── css/style.css   # Stylesheet
│   └── js/app.js       # Frontend JavaScript
└── templates/
    ├── index.html      # Main SPA page
    ├── 404.html        # Not found page
    └── expired.html    # Expired link page
```

## 🔧 Environment Variables

| Variable       | Required | Default  | Description                        |
|----------------|----------|----------|------------------------------------|
| `DATABASE_URL` | Prod     | —        | PostgreSQL connection string       |
| `FLASK_DEBUG`  | No       | `false`  | Enable debug mode (`true`/`false`) |
| `PORT`         | No       | `5000`   | Server port (Render sets this)     |

## 📄 API Endpoints

| Method | Endpoint                   | Description              |
|--------|----------------------------|--------------------------|
| GET    | `/`                        | Serve the SPA            |
| POST   | `/api/shorten`             | Create a short URL       |
| GET    | `/api/urls`                | List all URLs + stats    |
| GET    | `/api/stats/<short_code>`  | Click analytics data     |
| DELETE | `/api/urls/<short_code>`   | Delete a URL mapping     |
| GET    | `/api/qr/<short_code>`     | Download QR code as PNG  |
| GET    | `/<short_code>`            | Redirect to original URL |

---

## 📝 License

MIT

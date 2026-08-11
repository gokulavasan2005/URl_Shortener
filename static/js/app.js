/**
 * app.js — SnapURL Frontend
 * -------------------------
 * Single-page app logic. Handles:
 *  - View toggling (Shorten / Dashboard)
 *  - URL shortening form submission
 *  - Dashboard loading + live search
 *  - Copy to clipboard
 *  - QR code modal
 *  - Chart.js analytics modal
 *  - Toast notification system
 *  - Delete URL
 */

"use strict";

/* =========================================================
   Constants
   ========================================================= */
const API = {
  shorten  : "/api/shorten",
  urls     : "/api/urls",
  stats    : (code) => `/api/stats/${code}`,
  qr       : (code) => `/api/qr/${code}`,
  delete   : (code) => `/api/urls/${code}`,
  register : "/api/register",
  login    : "/api/login",
  logout   : "/api/logout",
  me       : "/api/me",
};

/* =========================================================
   State
   ========================================================= */
let allUrls = [];         // full list from API, used for search filtering
let chartInstance = null; // holds active Chart.js instance
let currentUser = null;   // holds logged in user object

/* =========================================================
   DOM references
   ========================================================= */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// Views
const viewShorten   = $("#view-shorten");
const viewDashboard = $("#view-dashboard");

// Nav buttons
const navShorten   = $("#nav-shorten");
const navDashboard = $("#nav-dashboard");

// Shorten form
const shortenForm    = $("#shorten-form");
const inputUrl       = $("#input-url");
const inputAlias     = $("#input-alias");
const inputExpiry    = $("#input-expiry");
const submitBtn      = $("#submit-btn");
const submitText     = $("#submit-text");
const submitSpinner  = $("#submit-spinner");
const errorMsg       = $("#error-msg");
const resultCard     = $("#result-card");
const resultLink     = $("#result-link");
const resultOriginal = $("#result-original");
const resultCreated  = $("#result-created");
const resultExpiry   = $("#result-expiry");
const copyMainBtn    = $("#copy-main-btn");
const qrMainBtn      = $("#qr-main-btn");

// Dashboard
const dashboardBody  = $("#dashboard-body");
const searchInput    = $("#search-input");
const totalLinksEl   = $("#total-links");
const totalClicksEl  = $("#total-clicks");
const activeLinksEl  = $("#active-links");

// Modals
const chartModal   = $("#chart-modal");
const qrModal      = $("#qr-modal");
const chartCanvas  = $("#analytics-chart");
const qrImage      = $("#qr-image");
const qrShortUrl   = $("#qr-short-url");
const qrDownloadBtn = $("#qr-download-btn");

// Toast
const toastContainer = $("#toast-container");

/* =========================================================
   View Toggle
   ========================================================= */
function showView(view) {
  viewShorten.classList.toggle("active", view === "shorten");
  viewDashboard.classList.toggle("active", view === "dashboard");
  navShorten.classList.toggle("active", view === "shorten");
  navDashboard.classList.toggle("active", view === "dashboard");

  if (view === "dashboard") {
    loadDashboard();
  }
}

navShorten.addEventListener("click",   () => showView("shorten"));
navDashboard.addEventListener("click", () => showView("dashboard"));

/* =========================================================
   Shorten Form
   ========================================================= */
shortenForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();

  const url      = inputUrl.value.trim();
  const alias    = inputAlias.value.trim();
  const expiry   = inputExpiry.value;

  // Check login requirement
  if (!currentUser) {
    showError("🔒 Please log in or sign up first to shorten links.");
    openAuthModal("login");
    return;
  }

  // Client-side quick validation
  if (!url) {
    showError("Please enter a URL.");
    return;
  }
  if (!/^https?:\/\/.+/.test(url)) {
    showError("URL must start with http:// or https://");
    return;
  }

  setLoading(true);
  resultCard.classList.remove("visible");

  try {
    const payload = { url };
    if (alias)  payload.alias      = alias;
    if (expiry) payload.expires_at = expiry.replace("T", " ");

    const res  = await fetch(API.shorten, {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || "Something went wrong.");
      return;
    }

    // Show result card
    showResult(data);
    showToast("✅ Short link created!", "success");

    // Trigger 3D Hologram Burst Effect
    if (window.hologramEngine) {
      window.hologramEngine.burst();
    }

    // Reset form (keep URL, clear alias + expiry)
    inputAlias.value  = "";
    inputExpiry.value = "";

  } catch (err) {
    showError("Network error. Make sure the server is running.");
  } finally {
    setLoading(false);
  }
});

function setLoading(on) {
  submitBtn.disabled      = on;
  submitText.textContent  = on ? "Creating…" : "✨ Shorten URL";
  submitSpinner.style.display = on ? "inline-block" : "none";
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.add("visible");
  inputUrl.classList.add("error");
}

function clearError() {
  errorMsg.classList.remove("visible");
  inputUrl.classList.remove("error");
}

function showResult(data) {
  resultLink.textContent = data.short_url;
  resultLink.href        = data.short_url;
  resultOriginal.textContent = "→ " + data.original_url;
  resultCreated.textContent  = "Created " + formatDate(data.created_at);
  resultExpiry.textContent   = data.expires_at
    ? "Expires " + formatDate(data.expires_at)
    : "Never expires";

  // Store short_code for copy / QR
  resultCard.dataset.shortCode = data.short_code;
  resultCard.dataset.shortUrl  = data.short_url;

  resultCard.classList.add("visible");
  resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Copy button on result card
copyMainBtn.addEventListener("click", () => {
  const url = resultCard.dataset.shortUrl;
  copyToClipboard(url, copyMainBtn);
});

// QR button on result card
qrMainBtn.addEventListener("click", () => {
  const code = resultCard.dataset.shortCode;
  if (code) openQrModal(code);
});

/* =========================================================
   Dashboard
   ========================================================= */
async function loadDashboard() {
  renderSkeleton();
  try {
    const res  = await fetch(API.urls);
    const data = await res.json();
    allUrls = data;
    renderDashboard(allUrls);
    updateStats(allUrls);
  } catch {
    dashboardBody.innerHTML = `
      <tr><td colspan="6" class="empty-state">
        <div class="emoji">⚠️</div>
        <h3>Failed to load links</h3>
        <p>Make sure the Flask server is running.</p>
      </td></tr>`;
  }
}

function updateStats(urls) {
  const total  = urls.length;
  const clicks = urls.reduce((s, u) => s + u.click_count, 0);
  const active = urls.filter(u => !u.is_expired).length;

  animateNumber(totalLinksEl,  total);
  animateNumber(totalClicksEl, clicks);
  animateNumber(activeLinksEl, active);
}

function animateNumber(el, target) {
  const start    = parseInt(el.textContent) || 0;
  const duration = 600;
  const startTime = performance.now();
  const step = (now) => {
    const progress = Math.min((now - startTime) / duration, 1);
    el.textContent = Math.round(start + (target - start) * easeOut(progress));
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

function renderSkeleton() {
  const rows = Array.from({ length: 4 }, () => `
    <tr>
      ${Array.from({ length: 6 }, () =>
        `<td><div class="skeleton" style="height:18px;width:${60+Math.random()*40}px"></div></td>`
      ).join("")}
    </tr>`).join("");
  dashboardBody.innerHTML = rows;
}

function renderDashboard(urls) {
  if (!urls.length) {
    dashboardBody.innerHTML = `
      <tr><td colspan="6">
        <div class="empty-state">
          <div class="emoji">🔗</div>
          <h3>No links yet</h3>
          <p>Go to the Shorten tab and create your first short link!</p>
        </div>
      </td></tr>`;
    return;
  }

  dashboardBody.innerHTML = urls.map((u) => {
    const isExpired  = u.is_expired;
    const hasExpiry  = !!u.expires_at;
    const daysLeft   = hasExpiry ? daysUntil(u.expires_at) : null;
    const warnExpiry = !isExpired && daysLeft !== null && daysLeft <= 3;

    const badgeHtml = isExpired
      ? `<span class="badge badge-expired">⏰ Expired</span>`
      : warnExpiry
        ? `<span class="badge badge-expiring">⚡ ${daysLeft}d left</span>`
        : hasExpiry
          ? `<span class="badge badge-active">✓ ${daysLeft}d left</span>`
          : `<span class="badge badge-active">✓ Active</span>`;

    return `
      <tr id="row-${u.short_code}">
        <td class="td-code">
          <a href="${u.short_url}" target="_blank" rel="noopener">
            /${u.short_code}
          </a>
        </td>
        <td class="td-original" title="${escapeHtml(u.original_url)}">
          ${escapeHtml(truncate(u.original_url, 50))}
        </td>
        <td class="td-clicks">
          <span style="background:var(--gradient-text);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
            ${u.click_count}
          </span>
        </td>
        <td class="td-date">${formatDate(u.created_at)}</td>
        <td>${badgeHtml}</td>
        <td class="td-actions">
          <button class="btn btn-sm btn-copy"
            id="copy-btn-${u.short_code}"
            onclick="copyToClipboard('${u.short_url}', this)"
            title="Copy short URL">
            📋
          </button>
          <button class="btn btn-sm btn-chart"
            onclick="openChartModal('${u.short_code}')"
            title="View analytics">
            📊
          </button>
          <button class="btn btn-sm btn-qr"
            onclick="openQrModal('${u.short_code}')"
            title="QR Code">
            ⬛
          </button>
          <button class="btn btn-sm btn-danger"
            onclick="deleteUrl('${u.short_code}')"
            title="Delete">
            🗑️
          </button>
        </td>
      </tr>`;
  }).join("");
}

// Live search / filter
searchInput.addEventListener("input", () => {
  const q = searchInput.value.toLowerCase();
  const filtered = allUrls.filter(u =>
    u.short_code.toLowerCase().includes(q) ||
    u.original_url.toLowerCase().includes(q)
  );
  renderDashboard(filtered);
});

/* =========================================================
   Delete URL
   ========================================================= */
async function deleteUrl(code) {
  if (!confirm(`Delete /${code}? This cannot be undone.`)) return;

  try {
    const res = await fetch(API.delete(code), { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json();
      showToast(d.error || "Delete failed.", "error");
      return;
    }

    // Remove from local state + DOM
    allUrls = allUrls.filter(u => u.short_code !== code);
    const row = document.getElementById(`row-${code}`);
    if (row) {
      row.style.opacity = "0";
      row.style.transition = "opacity 0.3s";
      setTimeout(() => { renderDashboard(allUrls); updateStats(allUrls); }, 310);
    }
    showToast(`🗑️ /${code} deleted.`, "info");
  } catch {
    showToast("Network error.", "error");
  }
}

/* =========================================================
   Copy to Clipboard
   ========================================================= */
function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = "✓ Copied!";
    btn.classList.add("copied");
    showToast("📋 Copied to clipboard!", "success");
    setTimeout(() => {
      btn.innerHTML = orig;
      btn.classList.remove("copied");
    }, 2000);
  }).catch(() => {
    // Fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showToast("📋 Copied!", "success");
  });
}

/* =========================================================
   QR Modal
   ========================================================= */
async function openQrModal(code) {
  qrModal.classList.add("open");
  qrImage.src       = "";
  qrImage.style.display = "none";
  qrShortUrl.textContent = `/${code}`;
  qrDownloadBtn.href = API.qr(code);
  qrDownloadBtn.download = `${code}_qr.png`;

  // Load QR image
  try {
    const url = API.qr(code);
    qrImage.onload = () => { qrImage.style.display = "block"; };
    qrImage.src = url;
  } catch {
    showToast("Could not load QR code.", "error");
  }
}

$("#qr-modal-close").addEventListener("click", () => {
  qrModal.classList.remove("open");
});

qrModal.addEventListener("click", (e) => {
  if (e.target === qrModal) qrModal.classList.remove("open");
});

/* =========================================================
   Chart Modal
   ========================================================= */
async function openChartModal(code) {
  chartModal.classList.add("open");
  $("#chart-modal-title").textContent = `Analytics — /${code}`;
  $("#chart-modal-subtitle").textContent = "Last 30 days of click activity";

  // Destroy previous chart
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  const container  = $(".chart-container");
  container.innerHTML = `<canvas id="analytics-chart"></canvas>`;

  try {
    const res  = await fetch(API.stats(code));
    const data = await res.json();

    const { url, clicks } = data;
    $("#chart-total-clicks").textContent = url.click_count;
    $("#chart-created").textContent      = formatDate(url.created_at);
    $("#chart-status").textContent       = url.is_expired ? "Expired" : "Active";

    if (!clicks.length) {
      container.innerHTML = `
        <div class="chart-no-data">
          <span style="font-size:2.5rem">📭</span>
          <span>No clicks in the last 30 days</span>
        </div>`;
      return;
    }

    // Build date-filled series (fill 0 for missing days)
    const dateMap = {};
    clicks.forEach(c => { dateMap[c.date] = c.count; });
    const labels = getLast30Days();
    const values = labels.map(d => dateMap[d] || 0);

    const canvas = $("canvas", container);
    chartInstance = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Clicks",
          data: values,
          backgroundColor: "rgba(124,58,237,0.35)",
          borderColor: "rgba(167,139,250,0.9)",
          borderWidth: 1.5,
          borderRadius: 5,
          hoverBackgroundColor: "rgba(124,58,237,0.6)",
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#161625",
            borderColor: "rgba(124,58,237,0.4)",
            borderWidth: 1,
            titleColor: "#f1f5f9",
            bodyColor: "#94a3b8",
            padding: 10,
            callbacks: {
              label: (ctx) => ` ${ctx.parsed.y} click${ctx.parsed.y !== 1 ? "s" : ""}`,
            },
          },
        },
        scales: {
          x: {
            grid  : { color: "rgba(255,255,255,0.04)" },
            ticks : { color: "#64748b", font: { size: 10 }, maxTicksLimit: 10 },
          },
          y: {
            grid  : { color: "rgba(255,255,255,0.04)" },
            ticks : { color: "#64748b", font: { size: 11 }, precision: 0 },
            beginAtZero: true,
          },
        },
      },
    });

  } catch (err) {
    container.innerHTML = `<div class="chart-no-data">⚠️ Failed to load analytics.</div>`;
  }
}

$("#chart-modal-close").addEventListener("click", () => {
  chartModal.classList.remove("open");
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
});

chartModal.addEventListener("click", (e) => {
  if (e.target === chartModal) {
    chartModal.classList.remove("open");
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  }
});

/* =========================================================
   Toast Notifications
   ========================================================= */
function showToast(message, type = "info") {
  const icons = { success: "✅", error: "❌", info: "ℹ️" };
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || "ℹ️"}</span><span>${message}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("hide");
    setTimeout(() => toast.remove(), 350);
  }, 3000);
}

/* =========================================================
   Utility Functions
   ========================================================= */
function formatDate(dateStr) {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr.replace(" ", "T") + (dateStr.includes("T") ? "" : "Z"));
    return d.toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return dateStr; }
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  try {
    const exp = new Date(dateStr.replace(" ", "T") + (dateStr.includes("T") ? "" : "Z"));
    const now = new Date();
    return Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
  } catch { return null; }
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + "…" : str;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getLast30Days() {
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().split("T")[0]);
  }
  return days;
}

/* =========================================================
   User Authentication Logic
   ========================================================= */
const authModal        = $("#auth-modal");
const openLoginBtn     = $("#open-login-btn");
const openRegisterBtn  = $("#open-register-btn");
const authModalClose   = $("#auth-modal-close");
const authTabLogin     = $("#auth-tab-login");
const authTabRegister  = $("#auth-tab-register");
const loginForm        = $("#login-form");
const registerForm     = $("#register-form");
const loginErrorMsg    = $("#login-error-msg");
const regErrorMsg      = $("#reg-error-msg");
const authLoggedOut    = $("#auth-logged-out");
const authLoggedIn     = $("#auth-logged-in");
const userChipName     = $("#user-chip-name");
const logoutBtn        = $("#logout-btn");

function updateAuthUI(user) {
  currentUser = user;
  if (user) {
    userChipName.textContent = `👤 ${user.username}`;
    authLoggedOut.style.display = "none";
    authLoggedIn.style.display = "flex";
  } else {
    authLoggedOut.style.display = "flex";
    authLoggedIn.style.display = "none";
  }
}

async function checkAuthSession() {
  try {
    const res = await fetch(API.me);
    const data = await res.json();
    updateAuthUI(data.user);
  } catch (err) {
    updateAuthUI(null);
  }
}

function openAuthModal(tab = "login") {
  switchAuthTab(tab);
  authModal.classList.add("open");
}

function closeAuthModal() {
  authModal.classList.remove("open");
  loginErrorMsg.classList.remove("visible");
  regErrorMsg.classList.remove("visible");
}

function switchAuthTab(tab) {
  if (tab === "login") {
    authTabLogin.classList.add("active");
    authTabRegister.classList.remove("active");
    loginForm.style.display = "block";
    registerForm.style.display = "none";
  } else {
    authTabRegister.classList.add("active");
    authTabLogin.classList.remove("active");
    registerForm.style.display = "block";
    loginForm.style.display = "none";
  }
}

openLoginBtn?.addEventListener("click", () => openAuthModal("login"));
openRegisterBtn?.addEventListener("click", () => openAuthModal("register"));
authModalClose?.addEventListener("click", closeAuthModal);
authTabLogin?.addEventListener("click", () => switchAuthTab("login"));
authTabRegister?.addEventListener("click", () => switchAuthTab("register"));

authModal?.addEventListener("click", (e) => {
  if (e.target === authModal) closeAuthModal();
});

// Login Form Submit
loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginErrorMsg.classList.remove("visible");
  const loginVal = $("#login-input-id").value.trim();
  const pwdVal = $("#login-input-pwd").value;

  try {
    const res = await fetch(API.login, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: loginVal, password: pwdVal }),
    });
    const data = await res.json();
    if (!res.ok) {
      loginErrorMsg.textContent = data.error || "Login failed.";
      loginErrorMsg.classList.add("visible");
      return;
    }

    updateAuthUI(data.user);
    closeAuthModal();
    showToast(`Welcome back, ${data.user.username}! 👋`, "success");
    if (viewDashboard.classList.contains("active")) loadDashboard();
  } catch (err) {
    loginErrorMsg.textContent = "Network error during login.";
    loginErrorMsg.classList.add("visible");
  }
});

// Register Form Submit
registerForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  regErrorMsg.classList.remove("visible");
  const userVal = $("#reg-input-user").value.trim();
  const emailVal = $("#reg-input-email").value.trim();
  const pwdVal = $("#reg-input-pwd").value;

  try {
    const res = await fetch(API.register, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: userVal, email: emailVal, password: pwdVal }),
    });
    const data = await res.json();
    if (!res.ok) {
      regErrorMsg.textContent = data.error || "Registration failed.";
      regErrorMsg.classList.add("visible");
      return;
    }

    updateAuthUI(data.user);
    closeAuthModal();
    showToast(`Account created! Welcome, ${data.user.username} 🎉`, "success");
    if (viewDashboard.classList.contains("active")) loadDashboard();
  } catch (err) {
    regErrorMsg.textContent = "Network error during registration.";
    regErrorMsg.classList.add("visible");
  }
});

// Logout Button
logoutBtn?.addEventListener("click", async () => {
  try {
    await fetch(API.logout, { method: "POST" });
    updateAuthUI(null);
    showToast("Logged out.", "info");
    if (viewDashboard.classList.contains("active")) loadDashboard();
  } catch {
    showToast("Error logging out.", "error");
  }
});

/* =========================================================
   Global exposure (for inline onclick handlers in table rows)
   ========================================================= */
window.copyToClipboard = copyToClipboard;
window.openQrModal     = openQrModal;
window.openChartModal  = openChartModal;
window.deleteUrl       = deleteUrl;

/* =========================================================
   Init
   ========================================================= */
(async function init() {
  showView("shorten");
  await checkAuthSession();

  // Set min expiry to now
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  inputExpiry.min = now.toISOString().slice(0, 16);
  init3DTilt();

  // Initialize 3D Hologram Engine
  if (typeof THREE !== "undefined") {
    window.hologramEngine = new HologramEngine("hologram-canvas");
  }
})();

/* =========================================================
   Interactive 3D Tilt FX
   ========================================================= */
function init3DTilt() {
  document.querySelectorAll(".tilt-card, .hero-3d-wrapper, .hologram-stage-wrapper").forEach((card) => {
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateX = ((y - centerY) / centerY) * -10;
      const rotateY = ((x - centerX) / centerX) * 10;
      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.01)`;
    });

    card.addEventListener("mouseleave", () => {
      card.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)";
    });
  });
}

/* =========================================================
   Three.js Interactive 3D Hologram Engine
   ========================================================= */
class HologramEngine {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas || typeof THREE === "undefined") return;

    this.scene = null;
    this.camera = null;
    this.renderer = null;

    this.holoGroup = null;
    this.outerMesh = null;
    this.innerMesh = null;
    this.ringsGroup = null;
    this.particlesMesh = null;
    this.laserDisc = null;

    this.currentMode = "sphere";
    this.targetRotationX = 0;
    this.targetRotationY = 0;
    this.currentRotationX = 0;
    this.currentRotationY = 0;

    this.burstEnergy = 0;
    this.frameCount = 0;
    this.lastFpsCheck = performance.now();
    this.fps = 60;

    this.initScene();
    this.buildHologram("sphere");
    this.setupEvents();
    this.animate();
  }

  initScene() {
    const wrapper = this.canvas.parentElement;
    const width = wrapper.clientWidth || 440;
    const height = wrapper.clientHeight || 380;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    this.camera.position.set(0, 0, 7);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const ambientLight = new THREE.AmbientLight(0x06b6d4, 0.9);
    this.scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0x7c3aed, 2.5, 50);
    pointLight.position.set(2, 4, 5);
    this.scene.add(pointLight);

    const pointLight2 = new THREE.PointLight(0x06b6d4, 2.0, 50);
    pointLight2.position.set(-3, -2, 4);
    this.scene.add(pointLight2);
  }

  buildHologram(mode = "sphere") {
    if (this.holoGroup) {
      this.scene.remove(this.holoGroup);
    }

    this.currentMode = mode;
    this.holoGroup = new THREE.Group();

    // 1. Outer Wireframe Geometry
    let outerGeo;
    if (mode === "sphere") {
      outerGeo = new THREE.IcosahedronGeometry(1.75, 2);
    } else if (mode === "ring") {
      outerGeo = new THREE.TorusGeometry(1.5, 0.45, 16, 100);
    } else {
      outerGeo = new THREE.BoxGeometry(2.3, 2.3, 2.3);
    }

    const outerMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      wireframe: true,
      emissive: 0x06b6d4,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.8,
      roughness: 0.2,
    });
    this.outerMesh = new THREE.Mesh(outerGeo, outerMat);
    this.holoGroup.add(this.outerMesh);

    // 2. Inner Core Geometry
    const innerGeo = new THREE.OctahedronGeometry(0.85, 0);
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0x7c3aed,
      wireframe: true,
      emissive: 0xff00c8,
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.9,
    });
    this.innerMesh = new THREE.Mesh(innerGeo, innerMat);
    this.holoGroup.add(this.innerMesh);

    // 3. Orbiting Data Rings
    this.ringsGroup = new THREE.Group();
    const ringGeo = new THREE.TorusGeometry(2.2, 0.025, 16, 100);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.8,
    });
    const ring1 = new THREE.Mesh(ringGeo, ringMat);
    ring1.rotation.x = Math.PI / 3;
    const ring2 = new THREE.Mesh(ringGeo, ringMat);
    ring2.rotation.y = Math.PI / 4;
    this.ringsGroup.add(ring1, ring2);
    this.holoGroup.add(this.ringsGroup);

    // 4. Rising Holographic Data Stream Particles
    const particleCount = 400;
    const pGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 5;
      positions[i + 1] = (Math.random() - 0.5) * 5;
      positions[i + 2] = (Math.random() - 0.5) * 5;
    }
    pGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const pMat = new THREE.PointsMaterial({
      color: 0x06b6d4,
      size: 0.045,
      transparent: true,
      opacity: 0.85,
    });
    this.particlesMesh = new THREE.Points(pGeo, pMat);
    this.holoGroup.add(this.particlesMesh);

    // 5. Vertical Laser Scan Plane
    const laserGeo = new THREE.RingGeometry(0.1, 2.4, 32);
    const laserMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.3,
    });
    this.laserDisc = new THREE.Mesh(laserGeo, laserMat);
    this.laserDisc.rotation.x = Math.PI / 2;
    this.holoGroup.add(this.laserDisc);

    this.scene.add(this.holoGroup);
  }

  setupEvents() {
    const wrapper = this.canvas.parentElement;

    wrapper.addEventListener("mousemove", (e) => {
      const rect = wrapper.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      this.targetRotationY = x * 1.5;
      this.targetRotationX = y * 1.5;
    });

    wrapper.addEventListener("mouseleave", () => {
      this.targetRotationX = 0;
      this.targetRotationY = 0;
    });

    window.addEventListener("resize", () => {
      if (!wrapper) return;
      const width = wrapper.clientWidth;
      const height = wrapper.clientHeight;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    });

    // Control buttons
    const btnSphere = document.getElementById("holo-mode-sphere");
    const btnRing = document.getElementById("holo-mode-ring");
    const btnMatrix = document.getElementById("holo-mode-matrix");

    const setModeBtn = (activeBtn) => {
      [btnSphere, btnRing, btnMatrix].forEach((b) => b?.classList.remove("active"));
      activeBtn?.classList.add("active");
    };

    btnSphere?.addEventListener("click", () => {
      setModeBtn(btnSphere);
      this.buildHologram("sphere");
    });
    btnRing?.addEventListener("click", () => {
      setModeBtn(btnRing);
      this.buildHologram("ring");
    });
    btnMatrix?.addEventListener("click", () => {
      setModeBtn(btnMatrix);
      this.buildHologram("matrix");
    });
  }

  burst() {
    this.burstEnergy = 1.0;
    const statusEl = document.getElementById("holo-status");
    if (statusEl) {
      statusEl.textContent = "⚡ 3D HOLOGRAPHIC LINK MATRIX GENERATED!";
      statusEl.style.color = "#06b6d4";
      setTimeout(() => {
        statusEl.textContent = "Drag cursor to rotate 3D view";
        statusEl.style.color = "rgba(255,255,255,0.4)";
      }, 4000);
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    if (!this.holoGroup) return;

    // Smooth lerp rotation from mouse tracking
    this.currentRotationX += (this.targetRotationX - this.currentRotationX) * 0.05;
    this.currentRotationY += (this.targetRotationY - this.currentRotationY) * 0.05;

    const speed = 0.008 + this.burstEnergy * 0.05;
    this.holoGroup.rotation.y += speed;
    if (this.outerMesh) this.outerMesh.rotation.x += speed * 0.5;
    if (this.innerMesh) {
      this.innerMesh.rotation.y -= speed * 1.5;
      this.innerMesh.rotation.z += speed * 0.8;
    }
    if (this.ringsGroup) {
      this.ringsGroup.rotation.z += speed * 0.4;
    }

    this.holoGroup.rotation.x = this.currentRotationX;
    this.holoGroup.rotation.y += this.currentRotationY * 0.05;

    // Laser Disc scan plane
    const time = performance.now() * 0.002;
    if (this.laserDisc) {
      this.laserDisc.position.y = Math.sin(time * 2) * 1.5;
    }

    // Particle field motion
    if (this.particlesMesh) {
      const positions = this.particlesMesh.geometry.attributes.position.array;
      for (let i = 1; i < positions.length; i += 3) {
        positions[i] += 0.015 + this.burstEnergy * 0.03;
        if (positions[i] > 2.5) positions[i] = -2.5;
      }
      this.particlesMesh.geometry.attributes.position.needsUpdate = true;
    }

    // Burst energy decay
    if (this.burstEnergy > 0) {
      this.burstEnergy *= 0.95;
      if (this.outerMesh) {
        this.outerMesh.material.emissiveIntensity = 0.6 + this.burstEnergy * 2.5;
      }
    }

    // FPS counter
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsCheck >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsCheck = now;
      const fpsEl = document.getElementById("holo-fps");
      if (fpsEl) fpsEl.textContent = `${this.fps} FPS`;
    }

    this.renderer.render(this.scene, this.camera);
  }
}


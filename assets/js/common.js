/* common.js — perkongsian: config, PWA, utils BM */
"use strict";

const APP = {
  DATA_URL: "data.json",
  data: null,
  deferredPrompt: null,
};

/** Muat data.json (palette, pages, dsb.) */
async function loadAppData() {
  if (APP.data) return APP.data;
  const res = await fetch(APP.DATA_URL, { cache: "no-cache" });
  if (!res.ok) throw new Error("Gagal memuatkan data.json");
  APP.data = await res.json();
  return APP.data;
}

/** Papar toast mesej */
let _toastTimer = null;
function toast(msg, ms = 2200) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

/** Dialog pengesahan (BM) — return Promise<boolean> */
function confirmDialog({ title, message, okText = "Ya, teruskan", cancelText = "Batal", danger = false }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop open";
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3></h3>
        <p></p>
        <div class="modal-actions">
          <button class="btn ghost" data-cancel></button>
          <button class="btn ${danger ? "danger" : ""}" data-ok></button>
        </div>
      </div>`;
    backdrop.querySelector("h3").textContent = title;
    backdrop.querySelector("p").textContent = message;
    const okBtn = backdrop.querySelector("[data-ok]");
    const cancelBtn = backdrop.querySelector("[data-cancel]");
    okBtn.textContent = okText;
    cancelBtn.textContent = cancelText;
    const close = (val) => { backdrop.remove(); resolve(val); };
    okBtn.onclick = () => close(true);
    cancelBtn.onclick = () => close(false);
    backdrop.onclick = (e) => { if (e.target === backdrop) close(false); };
    document.body.appendChild(backdrop);
  });
}

/* ---------- IndexedDB: simpan lukisan setiap halaman ---------- */
const DB_NAME = "buku-mewarna-ceria";
const DB_STORE = "lukisan";
let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

async function saveDrawing(pageId, dataURL) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(dataURL, String(pageId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadDrawing(pageId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(String(pageId));
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteDrawing(pageId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(String(pageId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function hasAnyDrawing(pageId) {
  const d = await loadDrawing(pageId);
  return d != null;
}

/* ---------- PWA: daftar service worker + pasang butang ---------- */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) =>
      console.warn("SW gagal:", err)
    );
  });
}

function setupInstallButton() {
  const banner = document.getElementById("installBanner");
  const btn = document.getElementById("installBtn");
  const closeBtn = document.getElementById("installClose");
  if (!banner || !btn) return;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    APP.deferredPrompt = e;
    if (localStorage.getItem("mewarna.hideInstall") !== "1") banner.classList.add("show");
  });

  btn.addEventListener("click", async () => {
    if (!APP.deferredPrompt) return;
    APP.deferredPrompt.prompt();
    const { outcome } = await APP.deferredPrompt.userChoice;
    if (outcome === "accepted") toast("Terima kasih! Aplikasi dipasang 🎉");
    APP.deferredPrompt = null;
    banner.classList.remove("show");
  });

  closeBtn?.addEventListener("click", () => {
    banner.classList.remove("show");
    localStorage.setItem("mewarna.hideInstall", "1");
  });

  window.addEventListener("appinstalled", () => {
    banner.classList.remove("show");
    toast("Berjaya dipasang! Buka dari skrin utama 📱");
  });
}

/** Indikator dalam talian / luar talian */
function setupNetworkBadge() {
  const el = document.getElementById("netBadge");
  if (!el) return;
  const update = () => {
    if (navigator.onLine) {
      el.className = "badge";
      el.innerHTML = '<span class="dot"></span>Dalam talian';
    } else {
      el.className = "badge offline";
      el.innerHTML = '<span class="dot"></span>Luar talian — sedia guna';
    }
  };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

/** Sembunyikan splash selepas siap */
function hideSplash() {
  const el = document.getElementById("splash");
  if (!el) return;
  requestAnimationFrame(() => {
    el.classList.add("hide");
    setTimeout(() => el.remove(), 400);
  });
}

function pad2(n) { return String(n).padStart(2, "0"); }

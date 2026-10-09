/* editor.js — penyunting mewarna sebenar
   · Berus 5 tahap (3/6/12/15/20 px)
   · Palet 16 warna cerah + warna tersuai
   · Undo 30 langkah + Redo
   · Padam lapisan lukisan sahaja
   · Simpan = gabung line-art + lukisan → PNG
   · Autosave IndexedDB setiap hentakan berus
*/
"use strict";

(function editor() {
  registerServiceWorker();

  const params = new URLSearchParams(window.location.search);
  const pageId = parseInt(params.get("page") || "1", 10);

  const els = {
    pageTitle: document.getElementById("pageTitle"),
    stage: document.getElementById("stage"),
    lineArt: document.getElementById("lineArt"),
    canvas: document.getElementById("drawLayer"),
    palette: document.getElementById("palette"),
    brushRow: document.getElementById("brushRow"),
    btnBack: document.getElementById("btnBack"),
    btnUndo: document.getElementById("btnUndo"),
    btnRedo: document.getElementById("btnRedo"),
    btnClear: document.getElementById("btnClear"),
    btnSave: document.getElementById("btnSave"),
    toolPen: document.getElementById("toolPen"),
    toolEraser: document.getElementById("toolEraser"),
    btnZoomIn: document.getElementById("btnZoomIn"),
    btnZoomOut: document.getElementById("btnZoomOut"),
    zoomLevel: document.getElementById("zoomLevel"),
    cursor: document.getElementById("brushCursor"),
    wrap: document.getElementById("canvasWrap"),
  };

  const ctx = els.canvas.getContext("2d", { willReadFrequently: false });

  const state = {
    page: null,
    color: "#FF5A5F",
    brush: 6,
    tool: "pen", // pen | eraser
    drawing: false,
    lastX: 0,
    lastY: 0,
    undoStack: [],
    redoStack: [],
    maxUndo: 30,
    natural: { w: 0, h: 0 },
    css: { w: 0, h: 0 },
    fit: { w: 0, h: 0 },
    zoom: 1,
    dpr: 1,
    dirty: false,
    saveTimer: null,
  };

  const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 4;

  /* ---------- Muat halaman ---------- */
  async function init() {
    let data;
    try {
      data = await loadAppData();
    } catch {
      toast("Gagal memuatkan data aplikasi");
      return;
    }
    const page = data.pages.find((p) => p.id === pageId) || data.pages[0];
    state.page = page;
    els.pageTitle.textContent = page.title;
    document.title = `${page.title} — Adventures Coloring Studio`;

    // muat line-art
    await new Promise((resolve, reject) => {
      els.lineArt.onload = resolve;
      els.lineArt.onerror = reject;
      els.lineArt.src = page.file;
    });
    state.natural.w = els.lineArt.naturalWidth;
    state.natural.h = els.lineArt.naturalHeight;

    buildPalette(data.palette);
    buildBrushes(data.brushSizes);
    setupPointer();
    setupButtons();
    window.addEventListener("resize", debounce(layoutCanvas, 120));

    // pulihkan lukisan tersimpan
    try {
      const saved = await loadDrawing(page.id);
      layoutCanvas();
      if (saved) await restoreFromDataURL(saved);
    } catch {
      layoutCanvas();
    }
    hideSplash();
  }

  /* ---------- Susun atur kanvas ---------- */
  function layoutCanvas() {
    if (!state.page || !state.natural.w) return;
    const wrapEl = els.wrap;
    const wrapRect = wrapEl.getBoundingClientRect();
    const cs = getComputedStyle(wrapEl);
    const availW = wrapRect.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = wrapRect.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const ratio = state.natural.w / state.natural.h;
    let w = availW;
    let h = w / ratio;
    if (h > availH) {
      h = availH;
      w = h * ratio;
    }
    state.fit.w = Math.max(80, Math.floor(w));
    state.fit.h = Math.max(80, Math.floor(h));
    resizeStage();
  }

  /** Saiz stage & buffer mengikut zoom semasa; kandungan lukisan dikekalkan. */
  function resizeStage() {
    const w = Math.max(80, Math.round(state.fit.w * state.zoom));
    const h = Math.max(80, Math.round(state.fit.h * state.zoom));
    const oldCanvasData = state.css.w ? els.canvas.toDataURL("image/png") : null;

    els.stage.style.width = w + "px";
    els.stage.style.height = h + "px";

    // DPR diohadkan supaya telefon/tablet kekal lancar walau pada zum tinggi
    const dprBase = Math.min(window.devicePixelRatio || 1, 2.5);
    const dpr = Math.max(1, Math.min(dprBase, 3000 / Math.max(w, h)));
    state.dpr = dpr;
    state.css.w = w;
    state.css.h = h;
    els.canvas.width = Math.round(w * dpr);
    els.canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (oldCanvasData) restoreFromDataURL(oldCanvasData);
  }

  /** Pratonton saiz stage sahaja (tanpa realokasi buffer — semasa pinch). */
  function previewStageSize() {
    const w = Math.max(80, Math.round(state.fit.w * state.zoom));
    const h = Math.max(80, Math.round(state.fit.h * state.zoom));
    els.stage.style.width = w + "px";
    els.stage.style.height = h + "px";
  }

  function updateZoomLabel() {
    if (els.zoomLevel) els.zoomLevel.textContent = Math.round(state.zoom * 100) + "%";
  }

  function setZoom(z, opts = {}) {
    z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    if (Math.abs(z - state.zoom) < 0.001) return;
    state.zoom = z;
    updateZoomLabel();
    if (opts.commit === false) {
      previewStageSize(); // pratonton pantas semasa pinch
    } else {
      resizeStage();
      centerWrap();
    }
  }

  function stepZoom(dir) {
    let target = null;
    if (dir > 0) target = ZOOM_LEVELS.find((l) => l > state.zoom + 1e-6);
    else target = [...ZOOM_LEVELS].reverse().find((l) => l < state.zoom - 1e-6);
    if (target == null) {
      toast(dir > 0 ? "Zum sudah maksimum (400%)" : "Zum sudah minimum (50%)");
      return;
    }
    setZoom(target);
  }

  function centerWrap() {
    const wrap = els.wrap;
    wrap.scrollLeft = (wrap.scrollWidth - wrap.clientWidth) / 2;
    wrap.scrollTop = (wrap.scrollHeight - wrap.clientHeight) / 2;
  }

  function restoreFromDataURL(dataURL) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
        ctx.drawImage(img, 0, 0, els.canvas.width, els.canvas.height);
        ctx.restore();
        resolve();
      };
      img.src = dataURL;
    });
  }

  /* ---------- Palet warna ---------- */
  function buildPalette(colors) {
    els.palette.innerHTML = "";
    colors.forEach((c, i) => {
      const b = document.createElement("button");
      b.className = "swatch" + (c.hex === state.color || (i === 0 && state.color === "#FF5A5F") ? " active" : "");
      if (i === 0) { state.color = c.hex; b.classList.add("active"); }
      else b.classList.remove("active");
      b.style.background = c.hex;
      if (c.hex.toLowerCase() === "#ffffff") b.style.boxShadow = "0 0 0 2px #dfe6e9, var(--shadow-sm)";
      b.title = c.name;
      b.setAttribute("aria-label", `Warna ${c.name}`);
      b.addEventListener("click", () => selectColor(c.hex, b));
      els.palette.appendChild(b);
    });
    // warna tersuai
    const custom = document.createElement("label");
    custom.className = "swatch custom";
    custom.title = "Warna tersuai";
    custom.innerHTML = `＋<input type="color" value="${state.color}" aria-label="Pilih warna tersuai">`;
    const input = custom.querySelector("input");
    input.addEventListener("input", () => selectColor(input.value, custom));
    els.palette.appendChild(custom);
  }

  function selectColor(hex, btn) {
    state.color = hex;
    if (state.tool !== "pen") setTool("pen");
    document.querySelectorAll(".palette .swatch").forEach((s) => s.classList.remove("active"));
    btn.classList.add("active");
  }

  /* ---------- Saiz berus ---------- */
  function buildBrushes(sizes) {
    els.brushRow.innerHTML = "";
    sizes.forEach((sz) => {
      const b = document.createElement("button");
      b.className = "brush-btn" + (sz === state.brush ? " active" : "");
      b.dataset.size = sz;
      const dotPx = Math.min(18, Math.max(4, sz));
      b.innerHTML = `<span class="dot" style="width:${dotPx}px;height:${dotPx}px"></span>${sz}`;
      b.setAttribute("aria-label", `Saiz berus ${sz} piksel`);
      b.addEventListener("click", () => {
        state.brush = sz;
        document.querySelectorAll(".brush-btn").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        updateCursor();
      });
      els.brushRow.appendChild(b);
    });
  }

  /* ---------- Alat ---------- */
  function setTool(tool) {
    state.tool = tool;
    els.toolPen.classList.toggle("active", tool === "pen");
    els.toolEraser.classList.toggle("active", tool === "eraser");
    updateCursor();
  }

  /* ---------- Kursor berus (desktop) ---------- */
  function updateCursor() {
    if (!els.cursor) return;
    // Diametor kursor = saiz berus pada skrin semasa (px berus × zum)
    const d = Math.max(4, state.brush * state.zoom);
    els.cursor.style.width = d + "px";
    els.cursor.style.height = d + "px";
    els.cursor.style.background = state.tool === "eraser" ? "rgba(255,255,255,0.55)" : hexToRGBA(state.color, 0.45);
    els.cursor.style.borderStyle = state.tool === "eraser" ? "dashed" : "solid";
  }

  function hexToRGBA(hex, a) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  /* ---------- Lukis + pinch/pan dua jari ---------- */
  function setupPointer() {
    const canvas = els.canvas;
    const pointers = new Map(); // pointerId -> {x, y}
    let pinch = null;

    function twoPointerSnapshot() {
      const [a, b] = [...pointers.values()];
      return {
        d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    }

    function startPinch() {
      const { d, mid } = twoPointerSnapshot();
      pinch = {
        d0: d,
        z0: state.zoom,
        mid0: mid,
        scrollL: els.wrap.scrollLeft,
        scrollT: els.wrap.scrollTop,
        changed: false,
      };
    }

    function updatePinch() {
      if (!pinch || pointers.size < 2) return;
      const { d, mid } = twoPointerSnapshot();
      // 1) Pan: ikut gerakan titik tengah
      els.wrap.scrollLeft = pinch.scrollL - (mid.x - pinch.mid0.x);
      els.wrap.scrollTop = pinch.scrollT - (mid.y - pinch.mid0.y);
      // 2) Zum: nisbah jarak dua jari
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pinch.z0 * (d / pinch.d0)));
      if (Math.abs(z - state.zoom) > 0.02) {
        state.zoom = z;
        updateZoomLabel();
        previewStageSize();
        pinch.changed = true;
      }
    }

    function endPinch() {
      if (!pinch) return;
      if (pinch.changed) {
        // komit: realokasi buffer supaya tajam semula + kekalkan lukisan
        const z = Math.round(state.zoom * 100) / 100;
        state.zoom = z;
        resizeStage();
        centerWrap();
        updateZoomLabel();
      }
      pinch = null;
    }

    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 2) {
        // Dua jari = pinch zum + pan — batalkan coretan yang baru bermula
        if (state.drawing) {
          state.drawing = false;
          const snap = state.undoStack.pop();
          updateUndoButtons();
          if (snap) restoreFromDataURL(snap);
          scheduleAutosave();
        }
        startPinch();
        return;
      }
      if (pointers.size > 2) return;

      pushUndo();
      state.drawing = true;
      state.dirty = true;
      const pt = getPoint(e);
      state.lastX = pt.x;
      state.lastY = pt.y;
      drawDot(pt.x, pt.y, e);
      scheduleAutosave();
    });

    canvas.addEventListener("pointermove", (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pinch && pointers.size >= 2) {
        e.preventDefault();
        updatePinch();
        return;
      }

      moveCursor(e);
      if (!state.drawing) return;
      e.preventDefault();
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events) {
        const pt = getPoint(ev);
        strokeSegment(state.lastX, state.lastY, pt.x, pt.y, ev);
        state.lastX = pt.x;
        state.lastY = pt.y;
      }
    });

    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pinch && pointers.size < 2) endPinch();
      if (!state.drawing) return;
      state.drawing = false;
      scheduleAutosave();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", () => { els.cursor.style.display = "none"; });
    canvas.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse") { updateCursor(); els.cursor.style.display = "block"; }
    });
  }

  function moveCursor(e) {
    if (e.pointerType !== "mouse" || !els.cursor) return;
    updateCursor();
    els.cursor.style.display = "block";
    els.cursor.style.left = e.clientX + "px";
    els.cursor.style.top = e.clientY + "px";
  }

  function getPoint(e) {
    const rect = els.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left),
      y: (e.clientY - rect.top),
    };
  }

  function currentSize(e) {
    let s = state.brush;
    if (e && e.pointerType === "pen" && e.pressure > 0) s *= 0.7 + 0.6 * e.pressure;
    return Math.max(1, s);
  }

  function applyStyle(e) {
    ctx.globalCompositeOperation = state.tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = state.color;
    ctx.fillStyle = state.color;
    // Darab zoom: saiz coretan kekal konsisten pada imej walau berubah zum
    ctx.lineWidth = currentSize(e) * state.zoom;
  }

  function drawDot(x, y, e) {
    applyStyle(e);
    ctx.beginPath();
    ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }

  function strokeSegment(x1, y1, x2, y2, e) {
    applyStyle(e);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }

  /* ---------- Undo / Redo ---------- */
  function snapshot() {
    return els.canvas.toDataURL("image/png");
  }

  function pushUndo() {
    try {
      state.undoStack.push(snapshot());
      if (state.undoStack.length > state.maxUndo) state.undoStack.shift();
      state.redoStack.length = 0;
      updateUndoButtons();
    } catch (err) {
      console.warn("Undo penuh:", err);
    }
  }

  async function undo() {
    if (!state.undoStack.length) return;
    state.redoStack.push(snapshot());
    const prev = state.undoStack.pop();
    await restoreFromDataURL(prev);
    updateUndoButtons();
    scheduleAutosave();
  }

  async function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push(snapshot());
    const next = state.redoStack.pop();
    await restoreFromDataURL(next);
    updateUndoButtons();
    scheduleAutosave();
  }

  function updateUndoButtons() {
    els.btnUndo.disabled = state.undoStack.length === 0;
    els.btnRedo.disabled = state.redoStack.length === 0;
  }

  /* ---------- Autosave ---------- */
  function scheduleAutosave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(async () => {
      try {
        await saveDrawing(state.page.id, snapshot());
      } catch (e) {
        console.warn("Autosave gagal:", e);
      }
    }, 700);
  }

  /* ---------- Padam lapisan lukisan ---------- */
  async function clearLayer() {
    const ok = await confirmDialog({
      title: "Padam lukisan?",
      message: "Semua warna pada halaman ini akan dipadam. Garisan asal kekal. Anda boleh tekan Undo selepas ini.",
      okText: "Padam",
      danger: true,
    });
    if (!ok) return;
    pushUndo();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
    ctx.restore();
    scheduleAutosave();
    toast("Lapisan lukisan dipadam");
  }

  /* ---------- Simpan PNG (gabung line-art + lukisan) ---------- */
  async function savePNG() {
    if (!navigator.onLine && false) {} // allow always
    els.btnSave.disabled = true;
    try {
      const natW = state.natural.w;
      const natH = state.natural.h;
      const out = document.createElement("canvas");
      out.width = natW;
      out.height = natH;
      const octx = out.getContext("2d");
      // 1) line-art asal
      octx.fillStyle = "#FFFFFF";
      octx.fillRect(0, 0, natW, natH);
      octx.drawImage(els.lineArt, 0, 0, natW, natH);
      // 2) lapisan lukisan (diskalakan ke saiz asal)
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = "high";
      octx.drawImage(els.canvas, 0, 0, natW, natH);

      const filename = `coloring_page_${pad2(state.page.id)}.png`;
      const blob = await new Promise((res) => out.toBlob(res, "image/png"));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast(`Disimpan: ${filename} ✓`);
      // pastikan autosave terkini
      await saveDrawing(state.page.id, snapshot());
    } catch (e) {
      console.error(e);
      toast("Gagal menyimpan PNG");
    } finally {
      els.btnSave.disabled = false;
    }
  }

  /* ---------- Butang ---------- */
  function setupButtons() {
    els.btnBack.addEventListener("click", () => { window.location.href = "index.html"; });
    els.btnUndo.addEventListener("click", undo);
    els.btnRedo.addEventListener("click", redo);
    els.btnClear.addEventListener("click", clearLayer);
    els.btnSave.addEventListener("click", savePNG);
    els.toolPen.addEventListener("click", () => setTool("pen"));
    els.toolEraser.addEventListener("click", () => setTool("eraser"));
    els.btnZoomIn.addEventListener("click", () => stepZoom(1));
    els.btnZoomOut.addEventListener("click", () => stepZoom(-1));
    updateUndoButtons();
    updateZoomLabel();

    // Ctrl/Cmd + wheel atau trackpad pinch → zum
    els.wrap.addEventListener("wheel", (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const z = state.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12);
      setZoom(Math.round(z * 100) / 100, { commit: true });
    }, { passive: false });

    window.addEventListener("keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); redo(); }
      else if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); savePNG(); }
      else if (mod && (e.key === "+" || e.key === "=")) { e.preventDefault(); stepZoom(1); }
      else if (mod && e.key === "-") { e.preventDefault(); stepZoom(-1); }
      else if (mod && e.key === "0") { e.preventDefault(); setZoom(1); }
    });

    // cegah scroll halaman semasa melukis di luar kanvas
    document.addEventListener("touchmove", (e) => {
      if (state.drawing) e.preventDefault();
    }, { passive: false });
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  init().catch((e) => {
    console.error(e);
    toast("Ralat memulakan penyunting");
    hideSplash();
  });
})();

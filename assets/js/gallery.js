/* gallery.js — halaman grid 41 helaian mewarna */
"use strict";

(async function initGallery() {
  registerServiceWorker();
  setupInstallButton();
  setupNetworkBadge();

  let data;
  try {
    data = await loadAppData();
  } catch (e) {
    document.getElementById("grid").innerHTML =
      `<p style="grid-column:1/-1;text-align:center;color:#636e72;padding:30px 0">Gagal memuatkan senarai halaman. Sila muat semula.</p>`;
    hideSplash();
    return;
  }

  document.getElementById("heroCount").textContent = `${data.totalPages} helaian menanti warna anda 🎨`;

  const grid = document.getElementById("grid");
  const frag = document.createDocumentFragment();

  for (const page of data.pages) {
    const card = document.createElement("button");
    card.className = "page-card";
    card.setAttribute("aria-label", `Warna ${page.title}`);
    card.innerHTML = `
      <img class="page-thumb" loading="lazy" decoding="async" src="${page.file}" alt="${page.title}">
      <div class="page-meta">
        <span class="name">${page.title}</span>
        <span class="state clean">Kosong</span>
      </div>`;
    card.addEventListener("click", () => {
      window.location.href = `editor.html?page=${page.id}`;
    });
    frag.appendChild(card);

    // status lukisan tersimpan
    hasAnyDrawing(page.id).then((has) => {
      if (has) {
        const st = card.querySelector(".state");
        st.textContent = "Diteruskan ✓";
        st.classList.remove("clean");
      }
    }).catch(() => {});
  }

  grid.appendChild(frag);
  hideSplash();
})();

// UserScript
// @name         YouTube limpio + utilidades (quitar Shorts, copiar título, velocidad)
// @namespace    alumno-isi
// @version      1.0.0
// @description  Oculta Shorts en YouTube, añade botón de copiar título+URL y controla la velocidad por defecto con un mini-widget.
// @match        https://www.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @grant        GM_setClipboard
// @grant        GM_addStyle
// /UserScript

(function () { 
  'use strict';

  // ---------------------------
  // Configuración inicial
  // ---------------------------
  // Velocidades que iremos ciclando con Shift+S
  const SPEED_STEPS = [1.0, 1.25, 1.5, 1.75, 2.0];
  // Clave para recordar la velocidad elegida por defecto
  const LS_KEY_SPEED = 'tmk_default_playback_rate';

  // ---------------------------
  // Utilidades
  // ---------------------------

  /**
   * Espera a que exista un elemento que cumpla el selector.
   * Útil porque YouTube es una SPA y carga cosas por AJAX.
   */
  function waitForEl(selector, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const obs = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          obs.disconnect();
          resolve(found);
        }
      });

      obs.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
      });

      setTimeout(() => {
        obs.disconnect();
        reject(new Error('Timeout esperando ' + selector));
      }, timeout);
    });
  }

  /**
   * Devuelve true si estamos en la página de reproducción de vídeo.
   */
  function isWatchPage() {
    return location.pathname === '/watch';
  }

  /**
   * Obtiene/establece la velocidad por defecto persistida.
   */
  function getSavedSpeed() {
    const v = parseFloat(localStorage.getItem(LS_KEY_SPEED));
    return Number.isFinite(v) ? v : 1.25; // valor por defecto razonable
  }
  function saveSpeed(v) {
    localStorage.setItem(LS_KEY_SPEED, String(v));
  }

  /**
   * Aplica una función cada vez que hay cambios relevantes en la página (SPA).
   */
  function onDomChanged(fn) {
    const obs = new MutationObserver(() => fn());
    obs.observe(document.body, { childList: true, subtree: true });
    // primera ejecución
    fn();
  }

  // ---------------------------
  // 1) Ocultar Shorts
  // ---------------------------

  /**
   * Elimina/oculta elementos relacionados con Shorts en home y resultados.
   */
  function hideShorts() {
    // Estanterías de Shorts (home)
    document.querySelectorAll('ytd-reel-shelf-renderer').forEach((n) => n.remove());
    // Tarjetas/links que apuntan a /shorts/*
    document.querySelectorAll('a[href^="/shorts/"]').forEach((a) => {
      const card = a.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer');
      if (card) card.remove();
    });
    // Fila "Shorts" en la barra lateral (por si aparece)
    document.querySelectorAll('a[title="Shorts"]').forEach((n) => n.parentElement?.remove());
  }

  // CSS extra por si algo se escapa (defensa en profundidad)
  GM_addStyle(`
    ytd-reel-shelf-renderer{ display:none !important; }
    a[href^="/shorts/"]{ display:none !important; }
  `);

  // ---------------------------
  // 2) Botón "Copiar título + URL" en la página del vídeo
  // ---------------------------

  /**
   * Inserta el botón de copiado junto al título del vídeo.
   */
  async function ensureCopyButton() {
    if (!isWatchPage()) return;

    // Evitar duplicados si YouTube rehidrata el DOM
    if (document.getElementById('tmk-copy-title-btn')) return;

    // Seleccionamos el contenedor del título de la página de vídeo
    // (YouTube cambia el DOM a menudo: probamos con varios selectores)
    const titleEl =
      document.querySelector('ytd-watch-metadata h1') ||
      document.querySelector('#title h1') ||
      (await waitForEl('ytd-watch-metadata h1').catch(() => null));

    if (!titleEl) return;

    // Creamos el botón
    const btn = document.createElement('button');
    btn.id = 'tmk-copy-title-btn';
    btn.textContent = 'Copiar título+URL';
    btn.style.marginLeft = '8px';
    btn.style.padding = '6px 10px';
    btn.style.borderRadius = '8px';
    btn.style.border = '1px solid #ccc';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '12px';

    // Al hacer click, copiamos "Título — URL"
    btn.addEventListener('click', () => {
      const title = (titleEl.textContent || '').trim();
      const text = `${title} — ${location.href}`;
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text);
      } else {
        navigator.clipboard?.writeText(text).catch(() => {});
      }
      // Feedback visual simple
      btn.textContent = '¡Copiado!';
      setTimeout(() => (btn.textContent = 'Copiar título+URL'), 1200);
    });

    // Lo insertamos al lado del título
    titleEl.parentElement?.appendChild(btn);
  }

  // ---------------------------
  // 3) Velocidad por defecto + mini-widget
  // ---------------------------

  /**
   * Fuerza la velocidad del <video> cuando aparece y cuando cambia la fuente.
   */
  function applyPlaybackRate(video, rate) {
    if (!video) return;
    video.playbackRate = rate;

    // Si cambia el src/stream al saltar a otro vídeo, volvemos a aplicar
    const reapply = () => (video.playbackRate = rate);
    video.addEventListener('loadeddata', reapply, { passive: true });
    video.addEventListener('ratechange', () => {
      // Si el usuario la cambia manualmente, actualizamos el widget
      updateSpeedWidget(video.playbackRate);
    }, { passive: true });
  }

  /**
   * Crea un mini-widget flotante para mostrar/cambiar la velocidad.
   */
  function ensureSpeedWidget() {
    if (document.getElementById('tmk-speed-widget')) return;

    const div = document.createElement('div');
    div.id = 'tmk-speed-widget';
    div.innerHTML = `
      <div class="tmk-box">
        <span class="tmk-label">Velocidad</span>
        <button class="tmk-btn" data-act="down">-</button>
        <span class="tmk-val">1.00x</span>
        <button class="tmk-btn" data-act="up">+</button>
      </div>
    `;
    document.body.appendChild(div);

    GM_addStyle(`
      #tmk-speed-widget{
        position: fixed; right: 12px; bottom: 12px; z-index: 99999;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      }
      #tmk-speed-widget .tmk-box{
        background: rgba(0,0,0,.7); color: #fff; padding: 8px 10px;
        border-radius: 10px; display: inline-flex; align-items: center; gap: 6px;
        backdrop-filter: blur(2px);
      }
      #tmk-speed-widget .tmk-btn{
        border: 1px solid #888; background:#181818; color:#fff; border-radius:8px;
        padding: 2px 8px; cursor:pointer; font-size: 12px;
      }
      #tmk-speed-widget .tmk-btn:hover{ filter: brightness(1.2); }
      #tmk-speed-widget .tmk-label{ opacity:.8; font-size:12px; }
      #tmk-speed-widget .tmk-val{ min-width: 44px; text-align:center; font-variant-numeric: tabular-nums; }
    `);

    // Listeners para +/-
    div.addEventListener('click', (e) => {
      const btn = e.target.closest('.tmk-btn');
      if (!btn) return;

      const video = document.querySelector('video');
      if (!video) return;

      const current = Number(video.playbackRate) || 1.0;
      const idx = nearestIndex(SPEED_STEPS, current);

      let nextIdx = idx;
      if (btn.dataset.act === 'up') nextIdx = Math.min(SPEED_STEPS.length - 1, idx + 1);
      if (btn.dataset.act === 'down') nextIdx = Math.max(0, idx - 1);

      const next = SPEED_STEPS[nextIdx];
      setSpeed(next);
    });
  }

  /**
   * Devuelve el índice del valor más cercano en un array numérico.
   */
  function nearestIndex(arr, val) {
    let best = 0;
    let d = Infinity;
    arr.forEach((x, i) => {
      const nd = Math.abs(x - val);
      if (nd < d) { d = nd; best = i; }
    });
    return best;
  }

  /**
   * Actualiza la etiqueta numérica del widget.
   */
  function updateSpeedWidget(v) {
    const span = document.querySelector('#tmk-speed-widget .tmk-val');
    if (span) span.textContent = `${v.toFixed(2)}x`;
  }

  /**
   * Aplica velocidad a <video>, actualiza widget y la guarda.
   */
  function setSpeed(v) {
    saveSpeed(v);
    updateSpeedWidget(v);
    const video = document.querySelector('video');
    if (video) video.playbackRate = v;
  }

  /**
   * Inicializa velocidad cuando hay un <video> disponible.
   */
  function initPlaybackSpeed() {
    const video = document.querySelector('video');
    if (!video) return; // aún no cargó el player

    const prefer = getSavedSpeed();
    ensureSpeedWidget();
    updateSpeedWidget(prefer);
    applyPlaybackRate(video, prefer);
  }

  // ---------------------------
  // 4) Atajos de teclado
  // ---------------------------

  /**
   * Atajos:
   *  - Shift+S: ciclar velocidad (guarda preferencia)
   *  - Shift+C: copiar "Título — URL" del vídeo
   */
  function initHotkeys() {
    window.addEventListener('keydown', (e) => {
      if (!e.shiftKey) return;

      // Shift+S para velocidad
      if (e.key.toLowerCase() === 's') {
        const video = document.querySelector('video');
        if (!video) return;
        const current = Number(video.playbackRate) || getSavedSpeed();
        const idx = nearestIndex(SPEED_STEPS, current);
        const next = SPEED_STEPS[(idx + 1) % SPEED_STEPS.length];
        setSpeed(next);
        e.preventDefault();
      }

      // Shift+C para copiar título + URL
      if (e.key.toLowerCase() === 'c' && isWatchPage()) {
        const titleEl = document.querySelector('ytd-watch-metadata h1') || document.querySelector('#title h1');
        if (!titleEl) return;
        const text = `${titleEl.textContent.trim()} — ${location.href}`;
        if (typeof GM_setClipboard === 'function') {
          GM_setClipboard(text);
        } else {
          navigator.clipboard?.writeText(text).catch(() => {});
        }
        e.preventDefault();
      }
    }, { passive: false });
  }

  // ---------------------------
  // Arranque
  // ---------------------------

  // Observamos cambios de la SPA y re-aplicamos las mejoras
  onDomChanged(() => {
    hideShorts();
    ensureCopyButton();
    initPlaybackSpeed();
  });

  // Inicializamos atajos una vez
  initHotkeys();
})();

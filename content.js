const MPD = (() => {
  const RELEASES_LATEST_URL = 'https://api.github.com/repos/ButterScans/Manga-PayWall-Downloader/releases/latest';
  const STATE_KEY = 'mpd_state_v1';
  const LOCAL_VERSION_KEY = 'mpd_local_version_override';
  const DEFAULT_SKIP_SECONDS = 24 * 60 * 60;

  function log(...args) { console.log('[MPD]', ...args); }
  function logError(...args) { console.error('[MPD][ERROR]', ...args); }
  function now() { return Date.now(); }

  function readState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); }
    catch (e) { logError('Falha ao ler estado:', e); return {}; }
  }

  function writeState(s) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); }
    catch (e) { logError('Falha ao gravar estado:', e); }
  }

  function setLocalVersion(v) {
    try { localStorage.setItem(LOCAL_VERSION_KEY, String(v)); log('local version override set to', v); }
    catch (e) { logError('Erro setLocalVersion:', e); }
  }

  function getLocalVersion() {
    try {
      const override = localStorage.getItem(LOCAL_VERSION_KEY);
      if (override) {
        log('local version from override (priority):', override);
        return override;
      }
    } catch (e) {
      logError('Erro lendo override de versão:', e);
    }

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
        const m = chrome.runtime.getManifest();
        if (m && m.version) {
          log('local version from manifest (fallback):', m.version);
          return m.version;
        }
      }
    } catch (e) {
      log('manifest read failed or not available:', e);
    }

    log('local version unknown; usando "0.0.0" como fallback');
    return '0.0.0';
  }

  function normalizeVer(v) {
    if (!v) return '0.0.0';
    let s = String(v).trim().toLowerCase();
    s = s.replace(/^[^\d]*/, '');
    s = s.replace(/[^0-9.]/g, '');
    s = s.replace(/\.{2,}/g, '.').replace(/\.$/, '');
    if (!s) return '0.0.0';
    return s;
  }

  function semverCompare(a, b) {
    const pa = normalizeVer(a).split('.').map(n => parseInt(n, 10) || 0);
    const pb = normalizeVer(b).split('.').map(n => parseInt(n, 10) || 0);
    const max = Math.max(pa.length, pb.length);
    for (let i = 0; i < max; i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  }

  async function fetchLatestRelease(etag) {
    log('fetchLatestRelease() — iniciando request', RELEASES_LATEST_URL, etag ? '(usando etag)' : '');
    try {
      const headers = { 'Accept': 'application/vnd.github.v3+json' };
      if (etag) headers['If-None-Match'] = etag;
      const res = await fetch(RELEASES_LATEST_URL, { headers, cache: 'no-store' });
      if (res.status === 304) { log('GitHub returned 304 Not Modified'); return { notModified: true, status: 304 }; }
      if (!res.ok) {
        const text = await res.text().catch(() => null);
        throw new Error(`HTTP ${res.status} ${res.statusText} ${text ? '| ' + text.slice(0, 200) : ''}`);
      }
      const et = res.headers.get('etag') || null;
      const json = await res.json();
      log('fetchLatestRelease() — received', json.tag_name || json.name || '(sem tag)', 'etag:', et);
      return { data: json, etag: et };
    } catch (err) { logError('fetchLatestRelease error:', err); throw err; }
  }

  function createCheckerModal() {
    let existing = document.getElementById('mpd-update-checker-modal');
    if (existing) return existing;
    const modal = document.createElement('div');
    modal.id = 'mpd-update-checker-modal';
    modal.className = 'comicfuz-modal';
    modal.style.zIndex = 9999999;
    modal.innerHTML = `
      <div class="comicfuz-modal-card" style="min-width:320px;">
        <h3>Verificando atualizações</h3>
        <div id="mpd-update-status" class="comicfuz-status">verificando atualizações...</div>
        <div style="display:flex; gap:8px; margin-top:12px;">
          <button id="mpd-update-close-btn">Fechar</button>
          <button id="mpd-update-force-btn">Forçar checagem</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('mpd-update-close-btn').onclick = () => modal.remove();
    document.getElementById('mpd-update-force-btn').onclick = () => {
      startUpdateFlow(true).catch(err => {
        setStatusUI('Erro ao forçar checagem: ' + (err?.message || err));
        logError('Erro forçando checagem:', err);
      });
    };
    return modal;
  }

  function setStatusUI(msg) {
    const el = document.getElementById('mpd-update-status');
    if (el) el.innerText = msg;
    log('status:', msg);
  }

  function ensureUpdateModalStylesExists() {
    if (document.getElementById('mpd-update-styles')) return;
    const style = document.createElement('style');
    style.id = 'mpd-update-styles';
    style.textContent = `
      .mpd-modal, .comicfuz-modal { position: fixed; inset: 0; display:flex; align-items:center; justify-content:center; z-index:9999999; }
      .mpd-modal-backdrop { position: absolute; inset:0; background: rgba(0,0,0,0.45); backdrop-filter: blur(2px); }
      .mpd-modal-card, .comicfuz-modal-card {
        position: relative;
        z-index: 2;
        width: 420px;
        max-width: calc(100% - 32px);
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.25);
        padding: 18px;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
      }
      .mpd-modal-card h3 { margin: 0 0 12px 0; font-size:18px; text-align:center; }
      .mpd-update-desc {
        max-height: 240px;
        overflow:auto;
        padding:10px;
        border-radius:8px;
        background:#fafafa;
        border:1px solid #eee;
        white-space: pre-wrap;
      }
      .mpd-actions { display:flex; justify-content:center; gap:12px; margin-top:14px; }
      .mpd-btn {
        appearance:none;
        border:0;
        padding:8px 14px;
        border-radius:10px;
        font-weight:600;
        cursor:pointer;
        box-shadow: 0 4px 10px rgba(0,0,0,0.08);
      }
      .mpd-btn-primary {
        background: linear-gradient(180deg,#2b8fff,#1a6fe0);
        color:#fff;
      }
      .mpd-btn-ghost {
        background: transparent;
        color:#333;
        border:1px solid #ddd;
      }
      /* tentativa de reaproveitar estilos do comic-fuz caso existam */
      .mpd-btn.comicfuz-save-button { padding:8px 12px; }
    `;
    document.head.appendChild(style);
  }

  function showAvailableModal(releaseData) {
    try {
      const checker = document.getElementById('mpd-update-checker-modal');
      if (checker) checker.remove();

      const old = document.getElementById('mpd-update-available-modal');
      if (old) old.remove();

      ensureUpdateModalStylesExists();

      const state = readState();
      const name = releaseData.name || releaseData.tag_name || 'release';
      const savedBody = state.latestBody || '';
      const bodyRaw = (releaseData && typeof releaseData.body === 'string' && releaseData.body.trim()) ? releaseData.body : savedBody;
      const bodyPreview = (bodyRaw || '').slice(0, 2000);

      const modalWrap = document.createElement('div');
      modalWrap.id = 'mpd-update-available-modal';
      modalWrap.className = 'mpd-modal comicfuz-modal';

      modalWrap.innerHTML = `
        <div class="mpd-modal-backdrop" onclick="document.getElementById('mpd-update-available-modal')?.remove()"></div>
        <div class="mpd-modal-card comicfuz-modal-card" role="dialog" aria-labelledby="mpd-update-title">
          <h3 id="mpd-update-title">🔥 Atualização disponível!</h3>
          <div style="text-align:center; margin-bottom:10px;">Versão: ${escapeHtml(name)}</div>
          <div id="mpd-update-desc" class="mpd-update-desc">${escapeHtml(bodyPreview)}</div>
          <div class="mpd-actions">
            <button id="mpd-update-go-btn" class="mpd-btn mpd-btn-primary comicfuz-save-button">Baixe aqui</button>
          </div>
        </div>
      `;

      document.body.appendChild(modalWrap);

      document.getElementById('mpd-update-go-btn').onclick = () => {
        const url = (releaseData && releaseData.html_url) ? releaseData.html_url : 'https://github.com/ButterScans/Manga-PayWall-Downloader/releases';
        log('Redirecionando para releases:', url);
        try { window.open(url, '_blank'); } catch (e) { location.href = url; }
      };

      if (releaseData && releaseData.body) {
        setStateAfterCheck(releaseData, false);
      }
    } catch (e) {
      logError('Erro showAvailableModal:', e);
    }
  }

  function showNoUpdateThenOpenDownloader() {
    const checker = document.getElementById('mpd-update-checker-modal');
    if (checker) checker.remove();
    if (typeof MPD._afterCheckOpenDownloader === 'function') {
      MPD._afterCheckOpenDownloader();
      MPD._afterCheckOpenDownloader = null;
    } else { log('Nenhum callback de downloader encontrado — nada para abrir'); }
  }

  function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

  function setStateAfterCheck(releaseData, treatAsUpToDate = false) {
    try {
      const state = readState();
      state.lastChecked = now();

      const newLatestTag = (releaseData && (releaseData.tag_name || releaseData.name)) ? (releaseData.tag_name || releaseData.name) : state.latestTag || null;
      state.latestTag = newLatestTag;

      state.etag = (releaseData && releaseData._mpd_etag) ? releaseData._mpd_etag : state.etag || null;

      if (releaseData && releaseData.body && typeof releaseData.body === 'string' && releaseData.body.trim()) {
        state.latestBody = releaseData.body;
      }

      if (treatAsUpToDate) {
        state.isLatest = true;
      } else if (newLatestTag) {
        try {
          state.isLatest = (semverCompare(getLocalVersion(), newLatestTag || '0.0.0') >= 0);
        } catch (e) {
          state.isLatest = false;
        }
      } else {
        state.isLatest = state.isLatest || false;
      }

      writeState(state);
      log('Estado atualizado:', state);
    } catch (e) { logError('Erro setStateAfterCheck:', e); }
  }

  async function startUpdateFlow(force = false) {
    log('startUpdateFlow called. force:', force);
    const modal = createCheckerModal();
    setStatusUI('verificando atualizações');

    const state = readState();
    const localVer = getLocalVersion();

    if (!force && state.lastChecked && (now() - state.lastChecked) < DEFAULT_SKIP_SECONDS * 1000) {
      if (state.latestTag && semverCompare(localVer, state.latestTag) >= 0) {
        log('estado indica up-to-date e última checagem recente. pulando fetch e abrindo downloader.');
        setStatusUI('versão local é a mais recente (checada anteriormente). iniciando downloader...');
        setStateAfterCheck({ tag_name: state.latestTag, _mpd_etag: state.etag }, true);
        showNoUpdateThenOpenDownloader();
        return;
      } else {
        log('última checagem recente, mas versão local menor que remote. realizando fetch para confirmar.');
      }
    }

    const etag = state.etag || null;

    try {
      const res = await fetchLatestRelease(etag);

      if (res.notModified) {
        const remoteTag = state.latestTag || null;
        log('fetch returned 304. remoteTag from state:', remoteTag);

        if (remoteTag && semverCompare(localVer, remoteTag) >= 0) {
          setStatusUI('nenhuma nova release encontrada (304). abrindo downloader...');
          setStateAfterCheck({ tag_name: remoteTag, _mpd_etag: state.etag }, true);
          showNoUpdateThenOpenDownloader();
          return;
        } else {
          setStatusUI(`Nova versão disponível: ${remoteTag}`);
          setStateAfterCheck({ tag_name: remoteTag, _mpd_etag: state.etag }, false);
          showAvailableModal({ tag_name: remoteTag, name: remoteTag, body: '' });
          return;
        }
      }

      const release = res.data;
      if (res.etag) release._mpd_etag = res.etag;

      const remoteTag = release.tag_name || release.name || null;
      if (!remoteTag) {
        setStatusUI('erro: release sem tag_name. abrindo downloader por segurança.');
        logError('release sem tag_name recebido:', release);
        setStateAfterCheck(release, true);
        showNoUpdateThenOpenDownloader();
        return;
      }

      const cmp = semverCompare(localVer, remoteTag);
      log('Comparando versões - local:', localVer, '(', normalizeVer(localVer), ')',
        'remote:', remoteTag, '(', normalizeVer(remoteTag), ')', 'cmp:', cmp);

      if (cmp >= 0) {
        setStatusUI(`Você está usando a versão mais recente (${localVer}). Iniciando o GUI de download...`);
        setStateAfterCheck(release, true);
        showNoUpdateThenOpenDownloader();
        return;
      } else {
        setStatusUI(`Nova versão disponível: ${remoteTag}`);
        setStateAfterCheck(release, false);
        showAvailableModal(release);
        return;
      }
    } catch (err) {
      setStatusUI('Erro ao verificar se há atualizações: ' + (err?.message || err));
      logError('Erro no fluxo de verificação:', err);
      setTimeout(() => {
        setStatusUI('abrindo o GUI de download (fallback)...');
        showNoUpdateThenOpenDownloader();
      }, 1200);
    }
  }

  function resetState() {
    localStorage.removeItem(STATE_KEY);
    localStorage.removeItem(LOCAL_VERSION_KEY);
    log('mpd state resetado');
  }

  function forceSetRemoteTag(tag) {
    const state = readState();
    state.latestTag = tag;
    state.isLatest = semverCompare(getLocalVersion(), tag) >= 0;
    state.lastChecked = now();
    writeState(state);
    log('Forçado remoteTag para', tag);
  }

  return {
    startUpdateFlow,
    setLocalVersion,
    getLocalVersion,
    readState,
    resetState,
    forceSetRemoteTag,
    _afterCheckOpenDownloader: null,
    log,
  };
})();

try { window.__MPD_content = MPD; } catch (e) { /* ignore */ }

window.addEventListener('message', async (ev) => {
  try {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== 'mpd-page') return;
    const { id, cmd, args } = d;
    if (!id || !cmd) {
      window.postMessage({ source: 'mpd-content', id: id || null, error: 'invalid request' });
      return;
    }
    if (typeof MPD[cmd] !== 'function') {
      window.postMessage({ source: 'mpd-content', id, error: 'unknown command: ' + cmd });
      return;
    }
    try {
      const result = await MPD[cmd].apply(MPD, args || []);
      window.postMessage({ source: 'mpd-content', id, result });
    } catch (err) {
      window.postMessage({ source: 'mpd-content', id, error: err && err.message ? err.message : String(err) });
    }
  } catch (e) {
    console.error('[MPD] message handler fatal:', e);
  }
}, false);

(function injectPageBridge() {
  const code = `(${function () {
    if (window.MPD && window.MPD.__isPageBridge) return;
    const methods = ['startUpdateFlow', 'setLocalVersion', 'getLocalVersion', 'readState', 'resetState', 'forceSetRemoteTag', 'log'];
    window.MPD = window.MPD || {};
    methods.forEach(m => {
      window.MPD[m] = function (...args) {
        return new Promise((resolve, reject) => {
          try {
            const id = Math.random().toString(36).slice(2);
            function onRes(ev) {
              if (ev.source !== window || !ev.data || ev.data.source !== 'mpd-content' || ev.data.id !== id) return;
              window.removeEventListener('message', onRes);
              if (ev.data.error) reject(ev.data.error);
              else resolve(ev.data.result);
            }
            window.addEventListener('message', onRes);
            window.postMessage({ source: 'mpd-page', id, cmd: m, args }, '*');
          } catch (e) { reject(e?.message || e); }
        });
      };
    });
    window.MPD.__isPageBridge = true;
  }} )();`;
  const s = document.createElement('script');
  s.textContent = code;
  (document.documentElement || document.head || document.body).appendChild(s);
  s.parentNode.removeChild(s);
})();

window.MPD = {
  startUpdateFlow: MPD.startUpdateFlow,
  setLocalVersion: MPD.setLocalVersion,
  getLocalVersion: MPD.getLocalVersion,
  readState: MPD.readState,
  resetState: MPD.resetState,
  forceSetRemoteTag: MPD.forceSetRemoteTag,
  log: MPD.log
};

console.log('[MPD] módulos carregados! Caso seja um desenvolvedor responsável, os comandos estão prontos.');

async function handleSaveClick(openDownloadCallback) {
  try {
    console.log('[MPD] botão "Salvar páginas" clicado — iniciando fluxo de checagem');
    MPD._afterCheckOpenDownloader = openDownloadCallback;
    await MPD.startUpdateFlow(false);
  } catch (e) {
    console.error('[MPD] erro em handleSaveClick:', e);
    try { openDownloadCallback(); } catch (ee) { console.error('[MPD] falha ao abrir downloader fallback:', ee); }
  }
}

const hostname = location.hostname;

if (hostname.includes("comic-fuz.com")) { //https://comic-fuz.com/
  initComicFuz();
}

function initComicFuz() { //https://comic-fuz.com/ 
  const COUNTER_KEY = 'comicfuz_page_counter';
  const BUTTON_ID = 'comicfuz-save-btn';
  const MODAL_ID = 'comicfuz-save-modal';

  function findChapterTitleElement() {
    return document.querySelector(
      'h2.title_detail_viewer__detail__info__viewerTitle__GrN4D'
    );
  }

  function createButton(titleEl) {
    if (!titleEl) return;

    const container = titleEl.parentElement;
    if (container.querySelector(`#${BUTTON_ID}`)) return;

    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'space-between';
    container.style.gap = '12px';

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.className = 'comicfuz-save-button';
    btn.innerHTML = `
    <span>📷</span>
    <span>Salvar páginas</span>
  `;

    btn.addEventListener('click', () => handleSaveClick(openDownloadModal_comicfuz));
    container.appendChild(btn);
  }

  function openDownloadModal_comicfuz() {
    if (document.getElementById(MODAL_ID)) return;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'comicfuz-modal';
    modal.innerHTML = `
    <div class="comicfuz-modal-card">
      <h3>Salvar página em formato:</h3>

      <div class="comicfuz-format-row">
        <label><input type="radio" name="cfz-format" value="image/webp"> webp</label>
        <label><input type="radio" name="cfz-format" value="image/png" checked> png</label>
        <label><input type="radio" name="cfz-format" value="image/jpeg"> jpg</label>
      </div>

      <div class="comicfuz-actions" style="display:flex; align-items:center; gap:10px;">
        <button id="cfz-reset-btn" style="margin-right:auto;">Resetar</button>
        <button id="cfz-download-btn">Baixar</button>
        <button id="cfz-cancel-btn">Cancelar</button>
      </div>

      <div id="cfz-status" class="comicfuz-status"></div>
    </div>
  `;

    document.body.appendChild(modal);

    document.getElementById('cfz-cancel-btn').onclick = () => modal.remove();

    document.getElementById('cfz-reset-btn').onclick = () => {
      localStorage.removeItem(COUNTER_KEY);
      setStatus('Contador resetado.');
    };

    document.getElementById('cfz-download-btn').onclick = async () => {
      setStatus('Preparando as imagens...');

      try {
        const format = document.querySelector('input[name="cfz-format"]:checked').value;
        const chapterEl = findChapterTitleElement();
        const chapterKey = chapterEl ? chapterEl.innerText.trim() : 'default';

        let counters = JSON.parse(localStorage.getItem(COUNTER_KEY) || '{}');

        if (!counters[chapterKey]) {
          counters = {};
          counters[chapterKey] = 1;
        }

        const dataUrls = await captureCurrentPages(format);

        const ext =
          format === 'image/png'
            ? 'png'
            : format === 'image/jpeg'
              ? 'jpg'
              : 'webp';

        for (const dataUrl of dataUrls) {
          const pageNumber = String(counters[chapterKey]).padStart(2, '0');
          downloadDirect(dataUrl, `${pageNumber}.${ext}`);
          counters[chapterKey]++;
        }

        localStorage.setItem(COUNTER_KEY, JSON.stringify(counters));

        setStatus(`Baixando as imagens... (${dataUrls.length} página${dataUrls.length > 1 ? 's' : ''})`);

        setTimeout(() => {
          modal.remove();
        }, 2500);

      } catch (err) {
        setStatus('Erro: ' + (err?.message || err));
      }
    };
  }

  async function capturePageArea() {
    const page = document.querySelector(".js-page-area");
    if (!page) {
      console.error("[MPD] capturePageArea: Elemento não encontrado");
      return;
    }

    const rect = page.getBoundingClientRect();

    chrome.runtime.sendMessage({ type: "CAPTURE" }, (res) => {
      if (res?.error) {
        console.error("[MPD] Erro ao capturar:", res.error);
        return;
      }

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = rect.width;
        canvas.height = rect.height;
        const ctx = canvas.getContext("2d");

        ctx.drawImage(
          img,
          rect.left, rect.top, rect.width, rect.height,
          0, 0, rect.width, rect.height
        );

        const croppedDataUrl = canvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.href = croppedDataUrl;
        link.download = "page.png";
        link.click();
      };
      img.src = res.dataUrl;
    });
  }

  capturePageArea();

  function setStatus(msg) {
    const el = document.getElementById('cfz-status');
    if (el) el.innerText = msg;
    console.log('[MPD][comic-fuz] status:', msg);
  }

  async function captureCurrentPages(mimeType) {
    const images = Array.from(document.querySelectorAll('img.G54Y0W_page'));

    if (!images.length) {
      throw new Error('Nenhuma imagem foi encontrada.');
    }

    const visibleImages = images.filter(img => {
      const rect = img.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.right <= window.innerWidth
      );
    });

    if (!visibleImages.length) {
      throw new Error('Nenhuma imagem visível na tela.');
    }

    visibleImages.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      const centerA = rectA.left + rectA.width / 2;
      const centerB = rectB.left + rectB.width / 2;
      return centerB - centerA;
    });

    const results = [];

    for (const img of visibleImages) {
      if (!img.complete || img.naturalWidth === 0) {
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
        });
      }

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const dataUrl =
        mimeType === 'image/jpeg' || mimeType === 'image/webp'
          ? canvas.toDataURL(mimeType, 0.92)
          : canvas.toDataURL(mimeType);

      results.push(dataUrl);
    }

    return results;
  }

  function downloadDirect(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    console.log('[MPD][comic-fuz] downloadDirect:', filename);
  }

  function ensureButton() {
    const titleEl = findChapterTitleElement();
    if (titleEl) createButton(titleEl);
  }

  ensureButton();

  const mo = new MutationObserver(ensureButton);
  mo.observe(document.body, { childList: true, subtree: true });
}

if (hostname.includes("cycomi.com")) { //https://cycomi.com/
  initCycomi();
}

function initCycomi() { //https://cycomi.com/

  const COUNTER_KEY = 'cycomi_page_counter';
  const BUTTON_ID = 'comicfuz-save-btn';
  const MODAL_ID = 'comicfuz-save-modal';

  function findButtonContainer() {
    return document.querySelector(
      '.MuiGrid2-root.MuiGrid2-container.css-1lzw85y'
    );
  }

  function createButton(container) {

    if (!container) return;
    if (document.getElementById(BUTTON_ID)) return;

    const children = Array.from(container.children);
    if (children.length < 2) return;

    const btnWrapper = document.createElement('div');
    btnWrapper.style.display = 'flex';
    btnWrapper.style.alignItems = 'center';
    btnWrapper.style.justifyContent = 'center';
    btnWrapper.style.padding = '0 12px';

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.className = 'comicfuz-save-button';
    btn.textContent = '📷 Salvar páginas';

    btn.onclick = () => handleSaveClick(openDownloadModal_cycomi);

    btnWrapper.appendChild(btn);

    container.insertBefore(btnWrapper, children[1]);

    container.style.display = 'flex';
    container.style.alignItems = 'center';
  }

  function openDownloadModal_cycomi() {
    if (document.getElementById(MODAL_ID)) return;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'comicfuz-modal';
    modal.innerHTML = `
      <div class="comicfuz-modal-card">
        <h3>Salvar página em formato:</h3>

        <div class="comicfuz-format-row">
          <label><input type="radio" name="cfz-format" value="image/webp"> webp</label>
          <label><input type="radio" name="cfz-format" value="image/png" checked> png</label>
          <label><input type="radio" name="cfz-format" value="image/jpeg"> jpg</label>
        </div>

        <div class="comicfuz-actions" style="display:flex; align-items:center; gap:10px;">
          <button id="cfz-reset-btn" style="margin-right:auto;">Resetar</button>
          <button id="cfz-download-btn">Baixar</button>
          <button id="cfz-cancel-btn">Cancelar</button>
        </div>

        <div id="cfz-status" class="comicfuz-status"></div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('cfz-cancel-btn').onclick = () => modal.remove();

    document.getElementById('cfz-reset-btn').onclick = () => {
      localStorage.removeItem(COUNTER_KEY);
      setStatus('Contador resetado.');
    };

    document.getElementById('cfz-download-btn').onclick = async () => {
      setStatus('Preparando as imagens...');

      try {
        const format = document.querySelector('input[name="cfz-format"]:checked').value;
        let counters = JSON.parse(localStorage.getItem(COUNTER_KEY) || '{}');

        const chapterKey = location.pathname;

        if (!counters[chapterKey]) {
          counters = {};
          counters[chapterKey] = 1;
        }

        const dataUrls = await captureCurrentCanvases(format);

        const ext =
          format === 'image/png'
            ? 'png'
            : format === 'image/jpeg'
              ? 'jpg'
              : 'webp';

        for (const dataUrl of dataUrls) {
          const pageNumber = String(counters[chapterKey]).padStart(2, '0');
          downloadDirect(dataUrl, `${pageNumber}.${ext}`);
          counters[chapterKey]++;
        }

        localStorage.setItem(COUNTER_KEY, JSON.stringify(counters));

        setStatus(`Baixando as imagens... (${dataUrls.length})`);

        setTimeout(() => {
          modal.remove();
        }, 2500);

      } catch (err) {
        setStatus('Erro: ' + (err?.message || err));
      }
    };
  }

  function setStatus(msg) {
    const el = document.getElementById('cfz-status');
    if (el) el.innerText = msg;
    console.log('[MPD][cycomi] status:', msg);
  }

  async function captureCurrentCanvases(mimeType) {

    const canvases = Array.from(
      document.querySelectorAll('canvas.page-image, canvas.css-1gvy8c4')
    );

    if (!canvases.length) {
      throw new Error('Nenhum canva(imagem) foi encontrado.');
    }

    const visible = canvases.filter(c => {
      const rect = c.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.right <= window.innerWidth
      );
    });

    if (!visible.length) {
      throw new Error('Nenhum canva(imagem) está visível.');
    }

    visible.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      return rectB.left - rectA.left;
    });

    const results = [];

    for (const canvas of visible) {
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;

      const ctx = copy.getContext('2d');
      ctx.drawImage(canvas, 0, 0);

      const dataUrl =
        mimeType === 'image/jpeg' || mimeType === 'image/webp'
          ? copy.toDataURL(mimeType, 0.92)
          : copy.toDataURL(mimeType);

      results.push(dataUrl);
    }

    return results;
  }

  function downloadDirect(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    console.log('[MPD][cycomi] downloadDirect:', filename);
  }

  function ensureButton() {
    const container = findButtonContainer();
    if (container) createButton(container);
  }

  ensureButton();

  const mo = new MutationObserver(ensureButton);
  mo.observe(document.body, { childList: true, subtree: true });
}

if (hostname.includes("takecomic.jp")) { //https://takecomic.jp/
  initTakeComic();
}

function initTakeComic() { //https://takecomic.jp/

  const COUNTER_KEY = 'comicfuz_page_counter';
  const BUTTON_ID = 'comicfuz-save-btn';
  const MODAL_ID = 'comicfuz-save-modal';

  function findChapterTitleElement() {
    return document.querySelector('.ep-main-h-h');
  }

  function createButton(titleEl) {
    if (!titleEl) return;

    const header = document.querySelector('.ep-main-h-main');
    if (!header) return;

    if (header.querySelector(`#${BUTTON_ID}`)) return;

    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.gap = '12px';

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.className = 'comicfuz-save-button';
    btn.innerHTML = `
      <span>📷</span>
      <span>Salvar páginas</span>
    `;

    btn.addEventListener('click', () => handleSaveClick(openDownloadModal_takecomic));

    header.appendChild(btn);
  }

  function openDownloadModal_takecomic() {
    if (document.getElementById(MODAL_ID)) return;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'comicfuz-modal';
    modal.innerHTML = `
      <div class="comicfuz-modal-card">
        <h3>Salvar página em formato:</h3>

        <div class="comicfuz-format-row">
          <label><input type="radio" name="cfz-format" value="image/webp"> webp</label>
          <label><input type="radio" name="cfz-format" value="image/png" checked> png</label>
          <label><input type="radio" name="cfz-format" value="image/jpeg"> jpg</label>
        </div>

        <div class="comicfuz-actions" style="display:flex; align-items:center; gap:10px;">
          <button id="cfz-reset-btn" style="margin-right:auto;">Resetar</button>
          <button id="cfz-download-btn">Baixar</button>
          <button id="cfz-cancel-btn">Cancelar</button>
        </div>

        <div id="cfz-status" class="comicfuz-status"></div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('cfz-cancel-btn').onclick = () => modal.remove();

    document.getElementById('cfz-reset-btn').onclick = () => {
      localStorage.removeItem(COUNTER_KEY);
      setStatus('Contador resetado.');
    };

    document.getElementById('cfz-download-btn').onclick = async () => {
      setStatus('Preparando as imagens...');

      try {
        const format = document.querySelector('input[name="cfz-format"]:checked').value;
        const chapterEl = findChapterTitleElement();
        const chapterKey = chapterEl ? chapterEl.innerText.trim() : 'default';

        let counters = JSON.parse(localStorage.getItem(COUNTER_KEY) || '{}');

        if (!counters[chapterKey]) {
          counters = {};
          counters[chapterKey] = 1;
        }

        const dataUrls = await captureCurrentPages(format);

        const ext =
          format === 'image/png'
            ? 'png'
            : format === 'image/jpeg'
              ? 'jpg'
              : 'webp';

        for (const dataUrl of dataUrls) {
          const pageNumber = String(counters[chapterKey]).padStart(2, '0');
          downloadDirect(dataUrl, `${pageNumber}.${ext}`);
          counters[chapterKey]++;
        }

        localStorage.setItem(COUNTER_KEY, JSON.stringify(counters));

        setStatus(`Baixando as imagens... (${dataUrls.length} página${dataUrls.length > 1 ? 's' : ''})`);

        setTimeout(() => {
          modal.remove();
        }, 2500);

      } catch (err) {
        setStatus('Erro: ' + (err?.message || err));
      }
    };
  }

  function setStatus(msg) {
    const el = document.getElementById('cfz-status');
    if (el) el.innerText = msg;
    console.log('[MPD][takecomic] status:', msg);
  }

  async function captureCurrentPages(mimeType) {

    const container = document.querySelector('#xCVPages');
    if (!container) {
      throw new Error('Container de páginas não foi encontrado.');
    }

    const pages = Array.from(
      container.querySelectorAll('.-cv-page.mode-loaded.mode-rendered')
    );

    if (!pages.length) {
      throw new Error('Nenhuma página renderizada foi encontrada.');
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const visiblePages = pages
      .map(page => {

        const canvas = page.querySelector('canvas');
        if (!canvas) return null;
        if (canvas.width === 0 || canvas.height === 0) return null;

        const rect = page.getBoundingClientRect();

        const visibleWidth = Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0);
        const visibleHeight = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);

        if (visibleWidth <= 0 || visibleHeight <= 0) return null;

        const visibleArea = visibleWidth * visibleHeight;
        const totalArea = rect.width * rect.height;

        const visibilityRatio = visibleArea / totalArea;

        if (visibilityRatio < 0.4) return null;

        return {
          canvas,
          left: rect.left
        };
      })
      .filter(Boolean);

    if (!visiblePages.length) {
      throw new Error('Nenhuma página está visível.');
    }

    visiblePages.sort((a, b) => b.left - a.left);

    const results = [];

    for (const item of visiblePages) {

      const originalCanvas = item.canvas;

      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = originalCanvas.width;
      exportCanvas.height = originalCanvas.height;

      const ctx = exportCanvas.getContext('2d');
      ctx.drawImage(originalCanvas, 0, 0);

      const dataUrl =
        mimeType === 'image/jpeg' || mimeType === 'image/webp'
          ? exportCanvas.toDataURL(mimeType, 0.92)
          : exportCanvas.toDataURL(mimeType);

      results.push(dataUrl);
    }

    return results;
  }

  function downloadDirect(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    console.log('[MPD][takecomic] downloadDirect:', filename);
  }

  function ensureButton() {
    const titleEl = findChapterTitleElement();
    if (titleEl) createButton(titleEl);
  }

  ensureButton();

  const mo = new MutationObserver(ensureButton);
  mo.observe(document.body, { childList: true, subtree: true });
}

if (hostname.includes("manga-mee.jp")) { //https://manga-mee.jp/
  initMangaMee();
}

function initMangaMee() { //https://manga-mee.jp/

  const COUNTER_KEY = 'mangamee_page_counter';
  const BUTTON_ID = 'comicfuz-save-btn';
  const MODAL_ID = 'comicfuz-save-modal';

  function findChapterTitleElement() {
    return document.querySelector(
      'h1.text-xl.font-semibold.leading-5.text-greyish-brown'
    );
  }

  function createButton(titleEl) {
    if (!titleEl) return;

    const container = titleEl.parentElement;
    if (container.querySelector(`#${BUTTON_ID}`)) return;

    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '12px';

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.className = 'comicfuz-save-button';
    btn.innerHTML = `
      <span>📷</span>
      <span>Salvar páginas</span>
    `;

    btn.addEventListener('click', () => handleSaveClick(openDownloadModal_mangamee));

    titleEl.insertAdjacentElement('afterend', btn);
  }

  function openDownloadModal_mangamee() {
    if (document.getElementById(MODAL_ID)) return;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'comicfuz-modal';
    modal.innerHTML = `
      <div class="comicfuz-modal-card">
        <h3>Salvar página em formato:</h3>

        <div class="comicfuz-format-row">
          <label><input type="radio" name="cfz-format" value="image/webp"> webp</label>
          <label><input type="radio" name="cfz-format" value="image/png" checked> png</label>
          <label><input type="radio" name="cfz-format" value="image/jpeg"> jpg</label>
        </div>

        <div class="comicfuz-actions" style="display:flex; align-items:center; gap:10px;">
          <button id="cfz-reset-btn" style="margin-right:auto;">Resetar</button>
          <button id="cfz-download-btn">Baixar</button>
          <button id="cfz-cancel-btn">Cancelar</button>
        </div>

        <div id="cfz-status" class="comicfuz-status"></div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('cfz-cancel-btn').onclick = () => modal.remove();

    document.getElementById('cfz-reset-btn').onclick = () => {
      localStorage.removeItem(COUNTER_KEY);
      setStatus('Contador resetado.');
    };

    document.getElementById('cfz-download-btn').onclick = async () => {
      setStatus('Preparando as imagens...');

      try {
        const format = document.querySelector('input[name="cfz-format"]:checked').value;
        const chapterEl = findChapterTitleElement();
        const chapterKey = chapterEl ? chapterEl.innerText.trim() : 'default';

        let counters = JSON.parse(localStorage.getItem(COUNTER_KEY) || '{}');

        if (!counters[chapterKey]) {
          counters = {};
          counters[chapterKey] = 1;
        }

        const dataUrls = await captureCurrentPagesMangaMee(format);

        const ext =
          format === 'image/png'
            ? 'png'
            : format === 'image/jpeg'
              ? 'jpg'
              : 'webp';

        for (const dataUrl of dataUrls) {
          const pageNumber = String(counters[chapterKey]).padStart(2, '0');
          downloadDirect(dataUrl, `${pageNumber}.${ext}`);
          counters[chapterKey]++;
        }

        localStorage.setItem(COUNTER_KEY, JSON.stringify(counters));

        setStatus(`Baixando as imagens... (${dataUrls.length})`);

        setTimeout(() => {
          modal.remove();
        }, 2500);

      } catch (err) {
        setStatus('Erro: ' + (err?.message || err));
      }
    };
  }

  function setStatus(msg) {
    const el = document.getElementById('cfz-status');
    if (el) el.innerText = msg;
    console.log('[MPD][manga-mee] status:', msg);
  }

  async function captureCurrentPagesMangaMee(mimeType) {

    const images = Array.from(document.querySelectorAll('img.G54Y0W_page'));

    if (!images.length) {
      throw new Error('Nenhuma imagem foi encontrada.');
    }

    const visibleImages = images.filter(img => {
      const rect = img.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.right <= window.innerWidth
      );
    });

    if (!visibleImages.length) {
      throw new Error('Nenhuma imagem está visível.');
    }

    visibleImages.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      return rectB.left - rectA.left;
    });

    const results = [];

    for (const img of visibleImages) {
      if (!img.complete || img.naturalWidth === 0) {
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
        });
      }

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const dataUrl =
        mimeType === 'image/jpeg' || mimeType === 'image/webp'
          ? canvas.toDataURL(mimeType, 0.92)
          : canvas.toDataURL(mimeType);

      results.push(dataUrl);
    }

    return results;
  }

  function downloadDirect(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    console.log('[MPD][manga-mee] downloadDirect:', filename);
  }

  function ensureButton() {
    const titleEl = findChapterTitleElement();
    if (titleEl) createButton(titleEl);
  }

  ensureButton();

  const mo = new MutationObserver(ensureButton);
  mo.observe(document.body, { childList: true, subtree: true });
}

if (hostname.includes("championcross.jp")) { //https://championcross.jp/
  initChampionCross();
}

function initChampionCross() { //https://championcross.jp/

  const COUNTER_KEY = 'comicfuz_page_counter';
  const BUTTON_ID = 'comicfuz-save-btn';
  const MODAL_ID = 'comicfuz-save-modal';

  function createButton() {

    const titleSection = document.querySelector('.article-title-section');
    const title = document.querySelector('.article-title');

    if (!titleSection || !title) return;
    if (document.getElementById(BUTTON_ID)) return;

    titleSection.style.display = 'flex';
    titleSection.style.alignItems = 'center';
    titleSection.style.justifyContent = 'space-between';

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.className = 'comicfuz-save-button';

    btn.innerHTML = `
    <span>📷</span>
    <span>Salvar páginas</span>
  `;

    btn.addEventListener('click', () => handleSaveClick(openDownloadModal_champion));

    titleSection.appendChild(btn);
  }

  function openDownloadModal_champion() {

    if (document.getElementById(MODAL_ID)) return;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'comicfuz-modal';

    modal.innerHTML = `
    <div class="comicfuz-modal-card">
      <h3>Salvar página em formato:</h3>

      <div class="comicfuz-format-row">
        <label><input type="radio" name="cfz-format" value="image/webp"> webp</label>
        <label><input type="radio" name="cfz-format" value="image/png" checked> png</label>
        <label><input type="radio" name="cfz-format" value="image/jpeg"> jpg</label>
      </div>

      <div class="comicfuz-actions">
        <button id="cfz-reset-btn" style="margin-right:auto;">Resetar</button>
        <button id="cfz-download-btn">Baixar</button>
        <button id="cfz-cancel-btn">Cancelar</button>
      </div>

      <div id="cfz-status" class="comicfuz-status"></div>
    </div>
  `;

    document.body.appendChild(modal);

    document.getElementById('cfz-cancel-btn').onclick = () => modal.remove();

    document.getElementById('cfz-reset-btn').onclick = () => {
      localStorage.removeItem(COUNTER_KEY);
      setStatus('Contador resetado.');
    };

    document.getElementById('cfz-download-btn').onclick = async () => {

      setStatus('Preparando as imagens...');

      try {

        const format = document.querySelector('input[name="cfz-format"]:checked').value;

        const chapterTitle = document.querySelector('.article-title');
        const chapterKey = chapterTitle
          ? chapterTitle.innerText.trim()
          : 'default';

        let counters = JSON.parse(localStorage.getItem(COUNTER_KEY) || '{}');

        if (!counters[chapterKey]) {
          counters[chapterKey] = 1;
        }

        const dataUrls = await captureCurrentPages(format);

        const ext =
          format === 'image/png'
            ? 'png'
            : format === 'image/jpeg'
              ? 'jpg'
              : 'webp';

        for (const dataUrl of dataUrls) {
          const pageNumber = String(counters[chapterKey]).padStart(2, '0');
          downloadDirect(dataUrl, `${pageNumber}.${ext}`);
          counters[chapterKey]++;
        }

        localStorage.setItem(COUNTER_KEY, JSON.stringify(counters));

        setStatus(`Baixando as imagens... (${dataUrls.length} página${dataUrls.length > 1 ? 's' : ''})`);

        setTimeout(() => {
          modal.remove();
        }, 2500);

      } catch (err) {
        setStatus('Erro: ' + (err?.message || err));
      }
    };
  }

  function setStatus(msg) {
    const el = document.getElementById('cfz-status');
    if (el) el.innerText = msg;
    console.log('[MPD][championcross] status:', msg);
  }

  async function captureCurrentPages(mimeType) {

    const pages = Array.from(
      document.querySelectorAll('.-cv-page.mode-loaded.mode-rendered')
    );

    if (!pages.length) {
      throw new Error('Nenhuma página foi carregada.');
    }

    const screenCenter = window.innerWidth / 2;
    const candidates = [];

    for (const page of pages) {

      const canvas = page.querySelector('canvas');
      if (!canvas) continue;

      const rect = page.getBoundingClientRect();

      const isVisible =
        rect.right > 0 && rect.left < window.innerWidth;

      if (!isVisible) continue;

      const distanceFromCenter = Math.abs(
        (rect.left + rect.right) / 2 - screenCenter
      );

      candidates.push({
        canvas,
        rect,
        distanceFromCenter
      });
    }

    if (!candidates.length) {
      throw new Error('Nenhuma página está visível.');
    }

    candidates.sort((a, b) => a.distanceFromCenter - b.distanceFromCenter);
    const activePages = candidates.slice(0, 2);

    activePages.sort((a, b) => b.rect.left - a.rect.left);

    const results = [];

    for (const item of activePages) {

      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = item.canvas.width;
      exportCanvas.height = item.canvas.height;

      const ctx = exportCanvas.getContext('2d');
      ctx.drawImage(item.canvas, 0, 0);

      const dataUrl =
        mimeType === 'image/jpeg' || mimeType === 'image/webp'
          ? exportCanvas.toDataURL(mimeType, 0.92)
          : exportCanvas.toDataURL(mimeType);

      results.push(dataUrl);
    }

    return results;
  }

  function downloadDirect(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    console.log('[MPD][championcross] downloadDirect:', filename);
  }

  function ensureButton() {
    createButton();
  }

  ensureButton();

  const mo = new MutationObserver(ensureButton);
  mo.observe(document.body, { childList: true, subtree: true });
}

if (hostname.includes("firecross.jp")) { //https://firecross.jp/
  initFireCross();
}

function initFireCross() { //https://firecross.jp/

  const COUNTER_KEY = 'comicfuz_page_counter';
  const BUTTON_ID = 'comicfuz-save-btn';
  const MODAL_ID = 'comicfuz-save-modal';

  function findChapterTitleElement() {
    return document.querySelector('title');
  }

  function createButton() {

    if (document.getElementById(BUTTON_ID)) return;

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.className = 'comicfuz-save-button';
    btn.innerHTML = `
      <span>📷</span>
      <span>Salvar páginas</span>
    `;

    btn.style.position = 'fixed';
    btn.style.top = '20px';
    btn.style.right = '20px';
    btn.style.zIndex = '999999';

    btn.addEventListener('click', () => handleSaveClick(openDownloadModal_firecross));
    document.body.appendChild(btn);
  }

  function openDownloadModal_firecross() {

    if (document.getElementById(MODAL_ID)) return;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'comicfuz-modal';
    modal.innerHTML = `
      <div class="comicfuz-modal-card">
        <h3>Salvar página em formato:</h3>

        <div class="comicfuz-format-row">
          <label><input type="radio" name="cfz-format" value="image/webp"> webp</label>
          <label><input type="radio" name="cfz-format" value="image/png" checked> png</label>
          <label><input type="radio" name="cfz-format" value="image/jpeg"> jpg</label>
        </div>

        <div class="comicfuz-actions" style="display:flex; align-items:center; gap:10px;">
          <button id="cfz-reset-btn" style="margin-right:auto;">Resetar</button>
          <button id="cfz-download-btn">Baixar</button>
          <button id="cfz-cancel-btn">Cancelar</button>
        </div>

        <div id="cfz-status" class="comicfuz-status"></div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('cfz-cancel-btn').onclick = () => modal.remove();

    document.getElementById('cfz-reset-btn').onclick = () => {
      localStorage.removeItem(COUNTER_KEY);
      setStatus('Contador resetado.');
    };

    document.getElementById('cfz-download-btn').onclick = async () => {

      setStatus('Preparando as imagens...');

      try {

        const format = document.querySelector('input[name="cfz-format"]:checked').value;
        const chapterEl = findChapterTitleElement();
        const chapterKey = chapterEl ? chapterEl.innerText.trim() : location.pathname;

        let counters = JSON.parse(localStorage.getItem(COUNTER_KEY) || '{}');

        if (!counters[chapterKey]) {
          counters = {};
          counters[chapterKey] = 1;
        }

        const dataUrls = await captureCurrentPages(format);

        const ext =
          format === 'image/png'
            ? 'png'
            : format === 'image/jpeg'
              ? 'jpg'
              : 'webp';

        for (const dataUrl of dataUrls) {

          const pageNumber = String(counters[chapterKey]).padStart(2, '0');
          downloadDirect(dataUrl, `${pageNumber}.${ext}`);
          counters[chapterKey]++;
        }

        localStorage.setItem(COUNTER_KEY, JSON.stringify(counters));

        setStatus(`Baixando as imagens... (${dataUrls.length} Páginas)`);
        setTimeout(() => modal.remove(), 2500);

      } catch (err) {
        setStatus('Erro: ' + (err?.message || err));
      }
    };
  }

  function setStatus(msg) {
    const el = document.getElementById('cfz-status');
    if (el) el.innerText = msg;
  }

  function isBlankPage(canvas) {

    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;

    let nonWhite = 0;
    const total = width * height;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a === 0) continue;

      if (!(r > 245 && g > 245 && b > 245)) {
        nonWhite++;
        if (nonWhite > total * 0.01) return false;
      }
    }

    return true;
  }

  function cropRealContent(canvas) {

    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    let top = height;
    let bottom = 0;
    let left = width;
    let right = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {

        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        if (a === 0) continue;
        if (r === 0 && g === 0 && b === 0) continue;

        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }

    if (right <= left || bottom <= top) return canvas;

    const newCanvas = document.createElement('canvas');
    const newW = right - left + 1;
    const newH = bottom - top + 1;
    newCanvas.width = newW;
    newCanvas.height = newH;

    newCanvas.getContext('2d').drawImage(
      canvas,
      left,
      top,
      newW,
      newH,
      0,
      0,
      newW,
      newH
    );

    return newCanvas;
  }

  async function captureCurrentPages(mimeType) {

    let canvas = document.querySelector('#screen_layer canvas');
    if (!canvas) {
      const canvases = Array.from(document.querySelectorAll('#screen_layer canvas'));
      canvas = canvases.find(c => {
        const s = c.getAttribute('style') || '';
        return !/display\s*:\s*none/.test(s);
      }) || canvases[0];
    }
    if (!canvas) throw new Error('Os/As Canvas(Imagens) não foram encontrado(s).');

    const results = [];
    const width = canvas.width;
    const height = canvas.height;

    const isDouble = width > height * 1.3;
    const pages = isDouble
      ? [{ x: width / 2 }, { x: 0 }]
      : [{ x: 0 }];

    for (const p of pages) {

      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = isDouble ? Math.floor(width / 2) : width;
      exportCanvas.height = height;

      exportCanvas.getContext('2d').drawImage(
        canvas,
        p.x,
        0,
        exportCanvas.width,
        height,
        0,
        0,
        exportCanvas.width,
        height
      );

      if (isBlankPage(exportCanvas)) continue;

      const cropped = cropRealContent(exportCanvas);

      const dataUrl =
        mimeType === 'image/jpeg' || mimeType === 'image/webp'
          ? cropped.toDataURL(mimeType, 0.92)
          : cropped.toDataURL('image/png');

      results.push(dataUrl);
    }

    return results;
  }

  function downloadDirect(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  const observer = new MutationObserver(() => {
    if (document.querySelector('#screen_layer canvas')) {
      createButton();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

if (hostname.includes("viewer.bookwalker")) { //https://bookwalker.jp/ + https://viewer.bookwalker.jp/
  initBookWalker();
}

function initBookWalker() { //https://bookwalker.jp/ + https://viewer.bookwalker.jp/

  const COUNTER_KEY = 'bookwalker_page_counter';
  const BUTTON_ID = 'comicfuz-save-btn';
  const MODAL_ID = 'comicfuz-save-modal';

  function createFloatingButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.className = 'comicfuz-save-button';
    btn.innerHTML = `
      <span>📷</span>
      <span>Salvar páginas</span>
    `;

    btn.style.position = 'fixed';
    btn.style.top = '20px';
    btn.style.right = '20px';
    btn.style.zIndex = '999999';
    btn.style.boxShadow = '0 4px 12px rgb(255, 255, 255)';

    btn.addEventListener('click', () => handleSaveClick(openModal));

    document.body.appendChild(btn);
  }

  function openModal() {
    if (document.getElementById(MODAL_ID)) return;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'comicfuz-modal';
    modal.innerHTML = `
      <div class="comicfuz-modal-card">
        <h3>Salvar página em formato:</h3>

        <div class="comicfuz-format-row">
          <label><input type="radio" name="cfz-format" value="image/png" checked> png</label>
          <label><input type="radio" name="cfz-format" value="image/jpeg"> jpg</label>
          <label><input type="radio" name="cfz-format" value="image/webp"> webp</label>
        </div>

        <div class="comicfuz-actions" style="display:flex; align-items:center; gap:10px;">
          <button id="cfz-reset-btn" style="margin-right:auto;">Resetar Contador</button>
          <button id="cfz-download-btn">Baixar</button>
          <button id="cfz-cancel-btn">Cancelar</button>
        </div>

        <div id="cfz-status" class="comicfuz-status"></div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('cfz-cancel-btn').onclick = () => modal.remove();

    document.getElementById('cfz-reset-btn').onclick = () => {
      localStorage.removeItem(COUNTER_KEY);
      setStatus('Contador resetado.');
    };

    document.getElementById('cfz-download-btn').onclick = async () => {

      try {
        setStatus('Preparando as imagens...');

        const format = document.querySelector('input[name="cfz-format"]:checked').value;

        const chapterKey = document.querySelector('#pagetitle span')?.innerText || 'default';

        let counters = JSON.parse(localStorage.getItem(COUNTER_KEY) || '{}');

        if (!counters[chapterKey]) {
          counters = {};
          counters[chapterKey] = 1;
        }

        const dataUrls = await captureBookWalker(format);

        const ext =
          format === 'image/png'
            ? 'png'
            : format === 'image/jpeg'
              ? 'jpg'
              : 'webp';

        for (const dataUrl of dataUrls) {
          const pageNumber = String(counters[chapterKey]).padStart(2, '0');
          downloadDirect(dataUrl, `${pageNumber}.${ext}`);
          counters[chapterKey]++;
        }

        localStorage.setItem(COUNTER_KEY, JSON.stringify(counters));

        setStatus('Baixando as imagens...');

        setTimeout(() => {
          modal.remove();
        }, 2500);

      } catch (err) {
        setStatus('Erro: ' + (err?.message || err));
      }
    };
  }

  function setStatus(msg) {
    const el = document.getElementById('cfz-status');
    if (el) el.innerText = msg;
    console.log('[MPD][bookwalker] status:', msg);
  }

  async function captureBookWalker(mimeType) {
    const REF_CANVAS_W = 2390;
    const REF_CANVAS_H = 1165;
    const REF_CROP_X = 375;
    const REF_CROP_Y = 0;
    const REF_CROP_W = 820;
    const REF_CROP_H = 1165;

    function pickCurrentCanvas() {
      const prefer = document.querySelector('#viewport1.currentScreen canvas, #viewport0.currentScreen canvas');
      if (prefer) return prefer;

      const canvases = Array.from(document.querySelectorAll('#viewport1 canvas, #viewport0 canvas'));
      if (!canvases.length && document.querySelector('canvas')) return document.querySelector('canvas');
      if (!canvases.length) return null;

      const renderer = document.querySelector('#renderer');
      const center = renderer
        ? (() => {
          const r = renderer.getBoundingClientRect();
          return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
        })()
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 };

      for (const c of canvases) {
        const r = c.getBoundingClientRect();
        if (center.x >= r.left && center.x <= r.right && center.y >= r.top && center.y <= r.bottom) return c;
      }

      let best = null, bestScore = -Infinity;
      for (const c of canvases) {
        const r = c.getBoundingClientRect();
        const visW = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0));
        const visH = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
        const visArea = visW * visH;
        if (visArea <= 0) continue;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dist = Math.hypot(cx - window.innerWidth / 2, cy - window.innerHeight / 2);
        const score = visArea - dist * 10;
        if (score > bestScore) { bestScore = score; best = c; }
      }
      return best;
    }

    function canvasCropToDataUrl(srcCanvas, sx, sy, sw, sh, mime) {
      sx = Math.max(0, Math.min(sx, srcCanvas.width - 1));
      sy = Math.max(0, Math.min(sy, srcCanvas.height - 1));
      sw = Math.max(1, Math.min(sw, srcCanvas.width - sx));
      sh = Math.max(1, Math.min(sh, srcCanvas.height - sy));

      const out = document.createElement('canvas');
      out.width = sw;
      out.height = sh;
      out.getContext('2d').drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

      return (mime === 'image/jpeg' || mime === 'image/webp')
        ? out.toDataURL(mime, 0.92)
        : out.toDataURL('image/png');
    }

    const canvas = pickCurrentCanvas();
    if (!canvas) throw new Error('Os/As Canvas(Imagens) não foram encontrado(s).');

    const cw = canvas.width;
    const ch = canvas.height;

    const scaleX = cw / REF_CANVAS_W;
    const scaleY = ch / REF_CANVAS_H;

    const cropW = Math.round(REF_CROP_W * scaleX);
    const cropH = Math.round(REF_CROP_H * scaleY);
    const baseX = Math.round(REF_CROP_X * scaleX);
    const baseY = Math.round(REF_CROP_Y * scaleY);

    const isSpread = cw / ch > 1.05;

    const results = [];

    if (!isSpread) {
      const sx = Math.max(0, Math.min(baseX, cw - cropW));
      const sy = Math.max(0, Math.min(baseY, ch - cropH));
      results.push(canvasCropToDataUrl(canvas, sx, sy, cropW, cropH, mimeType));
      return results;
    }

    const leftX = Math.max(0, Math.min(baseX, cw - cropW));
    const rightX = Math.max(0, Math.min(baseX + cropW, cw - cropW));

    const leftDataUrl = canvasCropToDataUrl(canvas, leftX, baseY, cropW, cropH, mimeType);
    const rightDataUrl = canvasCropToDataUrl(canvas, rightX, baseY, cropW, cropH, mimeType);

    results.push(rightDataUrl, leftDataUrl);
    return results;
  }

  function exportCanvas(canvas, mimeType) {
    return mimeType === 'image/jpeg' || mimeType === 'image/webp'
      ? canvas.toDataURL(mimeType, 0.92)
      : canvas.toDataURL(mimeType);
  }

  function downloadDirect(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    console.log('[MPD][bookwalker] downloadDirect:', filename);
  }

  createFloatingButton();
}

if (hostname.includes("manga-one.com")) { //https://manga-one.com/
  initMangaOne();
}

function initMangaOne() { //https://manga-one.com/
  const COUNTER_KEY = 'comicfuz_page_counter';
  const BUTTON_ID = 'comicfuz-save-btn';
  const MODAL_ID = 'comicfuz-save-modal';

  function findChapterTitleElement() {
    return document.querySelector('h1.truncate.text-lg.font-bold.text-white.switch\\:text-xl');
  }

  function createButton(titleEl) {
    if (!titleEl) return;

    if (document.getElementById(BUTTON_ID)) return;

    let wrapper = titleEl.closest('.mpd-title-button-wrapper');
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'mpd-title-button-wrapper';
      wrapper.style.display = 'flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.gap = '12px';
      titleEl.parentNode.insertBefore(wrapper, titleEl);
      wrapper.appendChild(titleEl);
    }

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.className = 'comicfuz-save-button';
    btn.innerHTML = `<span>📷</span><span>Salvar páginas</span>`;

    btn.style.marginLeft = '6px';
    btn.addEventListener('click', () => handleSaveClick(openDownloadModal_mangaone));

    wrapper.appendChild(btn);
  }

  function openDownloadModal_mangaone() {
    if (document.getElementById(MODAL_ID)) return;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'comicfuz-modal';
    modal.innerHTML = `
      <div class="comicfuz-modal-card">
        <h3>Salvar página em formato:</h3>

        <div class="comicfuz-format-row">
          <label><input type="radio" name="cfz-format" value="image/webp"> webp</label>
          <label><input type="radio" name="cfz-format" value="image/png" checked> png</label>
          <label><input type="radio" name="cfz-format" value="image/jpeg"> jpg</label>
        </div>

        <div class="comicfuz-actions" style="display:flex; align-items:center; gap:10px;">
          <button id="cfz-reset-btn" style="margin-right:auto;">Resetar</button>
          <button id="cfz-download-btn">Baixar</button>
          <button id="cfz-cancel-btn">Cancelar</button>
        </div>

        <div id="cfz-status" class="comicfuz-status"></div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('cfz-cancel-btn').onclick = () => modal.remove();

    document.getElementById('cfz-reset-btn').onclick = () => {
      localStorage.removeItem(COUNTER_KEY);
      setStatus('Contador resetado.');
    };

    document.getElementById('cfz-download-btn').onclick = async () => {
      setStatus('Preparando as imagens...');
      try {
        const format = document.querySelector('input[name="cfz-format"]:checked').value;
        const chapterEl = findChapterTitleElement();
        const chapterKey = chapterEl ? chapterEl.innerText.trim() : 'default';

        let counters = JSON.parse(localStorage.getItem(COUNTER_KEY) || '{}');
        if (!counters[chapterKey]) counters[chapterKey] = 1;

        const dataUrls = await captureCurrentPages(format);

        const ext =
          format === 'image/png' ? 'png' :
            format === 'image/jpeg' ? 'jpg' : 'webp';

        for (const dataUrl of dataUrls) {
          const pageNumber = String(counters[chapterKey]).padStart(2, '0');
          downloadDirect(dataUrl, `${pageNumber}.${ext}`);
          counters[chapterKey]++;
        }

        localStorage.setItem(COUNTER_KEY, JSON.stringify(counters));
        setStatus(`Baixando as imagens... (${dataUrls.length} página${dataUrls.length > 1 ? 's' : ''})`);

        setTimeout(() => modal.remove(), 2500);
      } catch (err) {
        setStatus('Erro: ' + (err?.message || err));
      }
    };
  }

  function setStatus(msg) {
    const el = document.getElementById('cfz-status');
    if (el) el.innerText = msg;
    console.log('[MPD][manga-one] status:', msg);
  }

  async function captureCurrentPages(mimeType) {
    const images = Array.from(document.querySelectorAll('img.G54Y0W_page'));

    if (!images.length) {
      throw new Error('Nenhuma imagem foi encontrada.');
    }

    const bySrc = new Map();
    for (const img of images) {
      if (!img || !img.src) continue;
      bySrc.set(img.src, img);
    }
    const uniqueImages = Array.from(bySrc.values());

    const visibleImages = uniqueImages.filter(img => {
      const rect = img.getBoundingClientRect();
      const fullyVertical = rect.top >= 0 && rect.bottom <= window.innerHeight;
      const fullyHorizontal = rect.left >= 0 && rect.right <= window.innerWidth;
      const hasSize = rect.width > 0 && rect.height > 0;
      return hasSize && fullyVertical && fullyHorizontal;
    });

    if (!visibleImages.length) {
      throw new Error('Nenhuma imagem totalmente visível na tela. Role para posicionar a(s) página(s) dentro do visor e tente novamente.');
    }

    visibleImages.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const ca = ra.left + ra.width / 2;
      const cb = rb.left + rb.width / 2;
      return cb - ca;
    });

    const results = [];

    for (const img of visibleImages) {
      if (!img.complete || img.naturalWidth === 0) {
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
        });
      }

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const dataUrl =
        mimeType === 'image/jpeg' || mimeType === 'image/webp'
          ? canvas.toDataURL(mimeType, 0.92)
          : canvas.toDataURL(mimeType);

      results.push(dataUrl);
    }

    return results;
  }

  function downloadDirect(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    console.log('[MPD][manga-one] downloadDirect:', filename);
  }

  function ensureButton() {
    const titleEl = findChapterTitleElement();
    if (titleEl) createButton(titleEl);
  }

  ensureButton();
  const mo = new MutationObserver(ensureButton);
  mo.observe(document.body, { childList: true, subtree: true });
}

if (hostname.includes("ynjn.jp")) { //https://ynjn.jp/
  initYnJn();
}

function initYnJn() { //https://ynjn.jp/
  const COUNTER_KEY = 'comicfuz_page_counter';
  const BUTTON_ID = 'ynjn-save-btn';
  const MODAL_ID = 'ynjn-save-modal';

  function findTitleElement() {
    const candidates = Array.from(document.querySelectorAll('h1'));
    for (const el of candidates) {
      if (!el.innerText) continue;
      if (el.innerText.includes('私のこと好きじゃなかったのかよ') || el.innerText.includes('俺のことが好きなのか') || el.classList.contains('typography-heading-xs')) {
        return el;
      }
    }
    return document.querySelector('h1.typography-heading-xs') || null;
  }

  function ensureYnjnButtonStylesExists() {
    if (document.getElementById('ynjn-button-styles')) return;
    const s = document.createElement('style');
    s.id = 'ynjn-button-styles';
    s.textContent = `
  /* botão principal (pill) */
  .comicfuz-save-button, .ynjn-save-button {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    border-radius: 999px;
    background: #000000;
    color: #fff;
    font-weight: 600;
    font-size: 13px;
    line-height: 1;
    border: none;
    cursor: pointer;
    box-shadow: 0 6px 18px rgba(0,0,0,0.35);
    transition: transform .12s ease, box-shadow .12s ease, opacity .12s ease;

    /* mantém próximo ao título */
    margin-left: 12px;
    white-space: nowrap;
    flex: 0 0 auto;
    order: 1;
  }

  .comicfuz-save-button span.icon, .ynjn-save-button span.icon {
    display:inline-flex;
    align-items:center;
    justify-content:center;
    width:20px;
    height:20px;
    border-radius:6px;
    background: rgb(0, 0, 0);
    font-size:12px;
  }

  .comicfuz-save-button:hover, .ynjn-save-button:hover {
    transform: translateY(-1px);
    box-shadow: 0 8px 22px rgba(0,0,0,0.45);
    opacity: 0.98;
  }

  /* evita que estilos externos quebrem o botão */
  .comicfuz-save-button:focus, .ynjn-save-button:focus { outline: none; }
`;
    document.head.appendChild(s);
  }

  function createButton(titleEl) {
    if (!titleEl) return;
    ensureYnjnButtonStylesExists();

    if (document.getElementById(BUTTON_ID)) return;

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.className = 'comicfuz-save-button ynjn-save-button';
    btn.type = 'button';
    btn.innerHTML = `<span class="icon">📷</span><span class="label">Salvar páginas</span>`;

    btn.addEventListener('click', () => handleSaveClick(openDownloadModal_ynjn));

    try {
      titleEl.style.display = titleEl.style.display || 'inline-flex';
      titleEl.style.alignItems = 'center';
      titleEl.style.gap = titleEl.style.gap || '12px';

      btn.style.marginLeft = '8px';
      btn.style.whiteSpace = 'nowrap';
      btn.style.flex = '0 0 auto';

      titleEl.appendChild(btn);

    } catch (e) {
      console.warn('[MPD][ynjn] fallback inserir botão após o título', e);
      if (titleEl.parentElement && !titleEl.parentElement.querySelector(`#${BUTTON_ID}`)) {
        titleEl.parentElement.insertBefore(btn, titleEl.nextSibling);
        btn.style.marginLeft = '12px';
      } else {
        document.body.appendChild(btn);
        btn.style.position = 'fixed';
        btn.style.top = '80px';
        btn.style.right = '18px';
        btn.style.zIndex = 999999;
      }
    }
  }

  function ensureButton() {
    const titleEl = findTitleElement();
    if (titleEl) createButton(titleEl);
  }

  function openDownloadModal_ynjn() {
    if (document.getElementById(MODAL_ID)) return;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'comicfuz-modal';
    modal.innerHTML = `
      <div class="comicfuz-modal-card">
        <h3>Salvar página em formato:</h3>

        <div class="comicfuz-format-row">
          <label><input type="radio" name="ynjn-format" value="image/webp"> webp</label>
          <label><input type="radio" name="ynjn-format" value="image/png" checked> png</label>
          <label><input type="radio" name="ynjn-format" value="image/jpeg"> jpg</label>
        </div>

        <div class="comicfuz-actions" style="display:flex; align-items:center; gap:10px;">
          <button id="ynjn-reset-btn" style="margin-right:auto;">Resetar</button>
          <button id="ynjn-download-btn">Baixar</button>
          <button id="ynjn-cancel-btn">Cancelar</button>
        </div>

        <div id="ynjn-status" class="comicfuz-status"></div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('ynjn-cancel-btn').onclick = () => modal.remove();
    document.getElementById('ynjn-reset-btn').onclick = () => {
      localStorage.removeItem(COUNTER_KEY);
      setStatus('Contador resetado.');
    };

    document.getElementById('ynjn-download-btn').onclick = async () => {
      setStatus('Preparando as imagens...');
      try {
        const format = document.querySelector('input[name="ynjn-format"]:checked').value;
        const chapterEl = findTitleElement();
        const chapterKey = chapterEl ? chapterEl.innerText.trim() : 'default';

        let counters = JSON.parse(localStorage.getItem(COUNTER_KEY) || '{}');
        if (!counters[chapterKey]) {
          counters = {};
          counters[chapterKey] = 1;
        }

        const dataUrls = await captureVisibleYnjnCanvases(format);
        if (!dataUrls || !dataUrls.length) throw new Error('Nenhuma página encontrada para download.');

        const ext = format === 'image/png' ? 'png' : format === 'image/jpeg' ? 'jpg' : 'webp';

        for (const dataUrl of dataUrls) {
          const pageNumber = String(counters[chapterKey]).padStart(2, '0');
          downloadDirect(dataUrl, `${pageNumber}.${ext}`);
          counters[chapterKey]++;
        }

        localStorage.setItem(COUNTER_KEY, JSON.stringify(counters));
        setStatus(`Baixando as imagens... (${dataUrls.length} página${dataUrls.length > 1 ? 's' : ''})`);

        setTimeout(() => modal.remove(), 1500);
      } catch (err) {
        setStatus('Erro: ' + (err && err.message ? err.message : err));
      }
    };
  }

  function setStatus(msg) {
    const el = document.getElementById('ynjn-status');
    if (el) el.innerText = msg;
    console.log('[MPD][ynjn] status:', msg);
  }

  function downloadDirect(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    console.log('[MPD][ynjn] downloadDirect:', filename);
  }

  async function captureVisibleYnjnCanvases(mimeType) {
    const containerSelectors = ['div[data-v-006a2a88]', '.viewer', '.reading-view', '.manga-page', 'article'];
    const containers = Array.from(document.querySelectorAll(containerSelectors.join(',')));
    const scope = containers.length ? containers : [document];

    const allCanvases = scope.flatMap(s => Array.from(s.querySelectorAll('canvas')));
    const allImgs = scope.flatMap(s => Array.from(s.querySelectorAll('img')));

    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const intersects = !(rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw);
      return intersects && rect.width > 1 && rect.height > 1;
    }

    const visibleCanvases = allCanvases.filter(isVisible);
    const visibleImgs = allImgs.filter(isVisible);

    if (!visibleCanvases.length && !visibleImgs.length) {
      throw new Error('Nenhum canvas ou imagem visível no seletor esperado.');
    }

    function median(arr) {
      if (!arr.length) return 0;
      const s = arr.slice().sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }

    const sizesW = [];
    const sizesH = [];
    visibleCanvases.forEach(c => { const r = c.getBoundingClientRect(); sizesW.push(r.width); sizesH.push(r.height); });
    visibleImgs.forEach(i => { const r = i.getBoundingClientRect(); sizesW.push(r.width); sizesH.push(r.height); });

    const refW = median(sizesW) || window.innerWidth * 0.7;
    const refH = median(sizesH) || window.innerHeight * 0.7;
    const refAspect = refW && refH ? (refW / refH) : 1.0;

    const REL_DIFF_THRESHOLD = 0.25;
    const ASPECT_DIFF_THRESHOLD = 0.20;
    const MIN_PIXELS = 100;
    const candidateCanvases = [];
    const excluded = [];
    for (const c of visibleCanvases) {
      const rect = c.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w < MIN_PIXELS || h < MIN_PIXELS) {
        excluded.push({ c, reason: `too small ${Math.round(w)}x${Math.round(h)}` });
        continue;
      }
      const relW = Math.abs(w - refW) / (refW || 1);
      const relH = Math.abs(h - refH) / (refH || 1);
      const aspect = w / h;
      const aspectDiff = Math.abs(aspect - refAspect) / (refAspect || 1);

      if (relW > REL_DIFF_THRESHOLD || relH > REL_DIFF_THRESHOLD || aspectDiff > ASPECT_DIFF_THRESHOLD) {
        excluded.push({ c, reason: `outlier relW=${relW.toFixed(2)} relH=${relH.toFixed(2)} aspectDiff=${aspectDiff.toFixed(2)} size=${Math.round(w)}x${Math.round(h)}` });
        continue;
      }
      candidateCanvases.push(c);
    }

    const processingCanvases = candidateCanvases.length ? candidateCanvases : visibleCanvases.slice();

    console.log('[MPD][ynjn] ref size:', Math.round(refW), 'x', Math.round(refH), 'refAspect:', refAspect.toFixed(3));
    console.log('[MPD][ynjn] canvases encontrados:', visibleCanvases.length, ' -> processando:', processingCanvases.length);
    excluded.forEach(e => {
      try {
        console.log('[MPD][ynjn] excluido canvas:', e.reason, e.c);
      } catch (_) { }
    });

    const mime = (mimeType === 'image/jpeg') ? 'image/jpeg' : (mimeType === 'image/webp' ? 'image/webp' : 'image/png');
    const results = [];

    async function canvasToDataURL_direct(c) {
      try { return c.toDataURL(mime, 0.92); } catch (e) { return null; }
    }
    async function canvasToDataURL_viaBlob(c) {
      try {
        const blob = await new Promise((res, rej) => {
          c.toBlob(b => (b ? res(b) : rej(new Error('toBlob retornou null'))), mime, 0.92);
        });
        return await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = (e) => rej(e);
          fr.readAsDataURL(blob);
        });
      } catch (e) { return null; }
    }
    async function canvasToDataURL_viaWebGLRead(c) {
      try {
        const w = c.width || Math.max(1, Math.round(c.getBoundingClientRect().width));
        const h = c.height || Math.max(1, Math.round(c.getBoundingClientRect().height));
        const gl = c.getContext('webgl') || c.getContext('experimental-webgl') || c.getContext('webgl2');
        if (!gl) return null;
        try { gl.finish && gl.finish(); } catch (e) { }
        const pixels = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const clamped = new Uint8ClampedArray(w * h * 4);
        for (let row = 0; row < h; row++) {
          const dstRow = h - 1 - row;
          for (let col = 0; col < w; col++) {
            const srcI = (row * w + col) * 4;
            const dstI = (dstRow * w + col) * 4;
            clamped[dstI] = pixels[srcI];
            clamped[dstI + 1] = pixels[srcI + 1];
            clamped[dstI + 2] = pixels[srcI + 2];
            clamped[dstI + 3] = pixels[srcI + 3];
          }
        }
        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        const ctx = tmp.getContext('2d');
        const imgData = new ImageData(clamped, w, h);
        ctx.putImageData(imgData, 0, 0);
        return tmp.toDataURL(mime, 0.92);
      } catch (e) {
        console.warn('[MPD][ynjn] webgl readPixels falhou:', e);
        return null;
      }
    }
    async function imgElementToDataURL(img) {
      try {
        if (!img.complete) await new Promise(res => { img.onload = res; img.onerror = res; });
        const rect = img.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.round(rect.width * dpr));
        const h = Math.max(1, Math.round(rect.height * dpr));
        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        const ctx = tmp.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        return tmp.toDataURL(mime, 0.92);
      } catch (e) { return null; }
    }
    async function isMostlyBlack(dataUrl) {
      try {
        const img = new Image();
        img.src = dataUrl;
        await new Promise(res => { img.onload = res; img.onerror = res; });
        const w = Math.max(1, Math.min(50, img.naturalWidth));
        const h = Math.max(1, Math.min(50, img.naturalHeight));
        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        const ctx = tmp.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const imgd = ctx.getImageData(0, 0, w, h).data;
        let dark = 0, total = imgd.length / 4;
        for (let i = 0; i < imgd.length; i += 4) {
          const r = imgd[i], g = imgd[i + 1], b = imgd[i + 2];
          if (r < 20 && g < 20 && b < 20) dark++;
        }
        return (dark / total) > 0.9;
      } catch (e) { return false; }
    }

    for (const c of processingCanvases) {
      try {
        let dataUrl = await canvasToDataURL_direct(c);
        if (!dataUrl) dataUrl = await canvasToDataURL_viaBlob(c);
        if (!dataUrl) dataUrl = await canvasToDataURL_viaWebGLRead(c);

        if (!dataUrl) {
          const imgFallback = c.closest('div') ? c.closest('div').querySelector('img') : null;
          if (imgFallback && isVisible(imgFallback)) {
            dataUrl = await imgElementToDataURL(imgFallback);
          }
        }

        if (!dataUrl) {
          console.warn('[MPD][ynjn] não obteve dataUrl do canvas, pulando.');
          continue;
        }

        const black = await isMostlyBlack(dataUrl);
        if (black) {
          console.log('[MPD][ynjn] imagem parecida com PRETO detectada; tentando WebGL novamente e/ou img fallback.');
          const webglAttempt = await canvasToDataURL_viaWebGLRead(c);
          if (webglAttempt) {
            const stillBlack = await isMostlyBlack(webglAttempt);
            if (!stillBlack) { results.push(webglAttempt); continue; }
          }
          const imgFallback = c.closest('div') ? c.closest('div').querySelector('img') : null;
          if (imgFallback && isVisible(imgFallback)) {
            const alt = await imgElementToDataURL(imgFallback);
            if (alt) { results.push(alt); continue; }
          }
          console.log('[MPD][ynjn] decidido pular canvas porque ficou preto após tentativas.');
          continue;
        }

        results.push(dataUrl);
      } catch (e) {
        console.error('[MPD][ynjn] erro ao capturar canvas(imagem):', e);
      }
    }

    if (!results.length && visibleImgs.length) {
      for (const img of visibleImgs) {
        try {
          const dataUrl = await imgElementToDataURL(img);
          if (dataUrl) results.push(dataUrl);
        } catch (e) {
          console.warn('[MPD][ynjn] falha ao capturar a imagem visível:', e);
        }
      }
    }

    if (!results.length) {
      throw new Error('Nenhuma página foi encontrada para download.');
    }

    return results;
  }

  ensureButton();
  const mo = new MutationObserver(ensureButton);
  mo.observe(document.body, { childList: true, subtree: true });
}
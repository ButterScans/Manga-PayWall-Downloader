const hostname = location.hostname;

if (hostname.includes("comic-fuz.com")) {
  initComicFuz();
}

function initComicFuz() {
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

  btn.addEventListener('click', openModal);
  container.appendChild(btn);
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
    setStatus('Preparando imagens...');

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

      setStatus(`Download iniciado (${dataUrls.length} página${dataUrls.length > 1 ? 's' : ''})`);

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
}

async function captureCurrentPages(mimeType) {
  const images = Array.from(document.querySelectorAll('img.G54Y0W_page'));

  if (!images.length) {
    throw new Error('Nenhuma imagem encontrada.');
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
}

function ensureButton() {
  const titleEl = findChapterTitleElement();
  if (titleEl) createButton(titleEl);
}

ensureButton();

const mo = new MutationObserver(ensureButton);
mo.observe(document.body, { childList: true, subtree: true });
}

//if (hostname.includes("teste")) {
  teste();
//}
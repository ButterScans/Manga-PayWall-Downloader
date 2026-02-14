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
    const page = document.querySelector(".js-page-area"); // pega o elemento da página
    if (!page) return console.error("Elemento não encontrado");

    const rect = page.getBoundingClientRect(); // pega largura, altura, posição

    chrome.runtime.sendMessage({ type: "CAPTURE" }, (res) => {
      if (res?.error) return console.error("Erro ao capturar:", res.error);

      // cria imagem do screenshot
      const img = new Image();
      img.onload = () => {
        // cria canvas temporário com tamanho do elemento
        const canvas = document.createElement("canvas");
        canvas.width = rect.width;
        canvas.height = rect.height;
        const ctx = canvas.getContext("2d");

        // recorta a região do elemento
        ctx.drawImage(
          img,
          rect.left, rect.top, rect.width, rect.height, // origem
          0, 0, rect.width, rect.height // destino
        );

        // salva
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

    btn.onclick = openModal;

    btnWrapper.appendChild(btn);

    container.insertBefore(btnWrapper, children[1]);

    container.style.display = 'flex';
    container.style.alignItems = 'center';
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

    btn.addEventListener('click', openModal);

    header.appendChild(btn);
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

    btn.addEventListener('click', openModal);

    titleEl.insertAdjacentElement('afterend', btn);
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

    btn.addEventListener('click', openModal);

    titleSection.appendChild(btn);
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

    btn.addEventListener('click', openModal);
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
    newCanvas.width = right - left + 1;
    newCanvas.height = bottom - top + 1;

    newCanvas.getContext('2d').drawImage(
      canvas,
      left,
      top,
      newCanvas.width,
      newCanvas.height,
      0,
      0,
      newCanvas.width,
      newCanvas.height
    );

    return newCanvas;
  }

  async function captureCurrentPages(mimeType) {

    const canvas = document.querySelector('#screen_layer canvas');
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
      exportCanvas.width = isDouble ? width / 2 : width;
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
          : cropped.toDataURL(mimeType);

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

if (hostname.includes("viewer.bookwalker")) { //https://bookwalker.jp + https://viewer.bookwalker.jp/
  initBookWalker();
}

function initBookWalker() { //https://bookwalker.jp + https://viewer.bookwalker.jp/

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
    btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';

    btn.addEventListener('click', openModal);

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
        ? {
          x: (renderer.getBoundingClientRect().left + renderer.getBoundingClientRect().right) / 2,
          y: (renderer.getBoundingClientRect().top + renderer.getBoundingClientRect().bottom) / 2
        }
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

    const rightDataUrl = canvasCropToDataUrl(canvas, rightX, baseY, cropW, cropH, mimeType);
    const leftDataUrl = canvasCropToDataUrl(canvas, leftX, baseY, cropW, cropH, mimeType);

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
  }

  createFloatingButton();
}
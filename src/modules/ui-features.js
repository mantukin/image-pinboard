function rgbToHex(r, g, b) {
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;
}

export function createPipetteController({
  pipetteBtn,
  pipetteHud,
  pipetteColorPreview,
  pipetteHexCode,
  pipetteCopyBtn,
  pipetteMagnifier,
  fullWidthImage,
  navigatorRef = navigator
}) {
  let isPipetteMode = false;
  const defaultCopyText = pipetteCopyBtn ? (pipetteCopyBtn.textContent || 'Copy') : 'Copy';
  let copyResetTimer = null;

  function resetCopyButtonText() {
    if (copyResetTimer) {
      clearTimeout(copyResetTimer);
      copyResetTimer = null;
    }
    if (pipetteCopyBtn) {
      pipetteCopyBtn.textContent = defaultCopyText;
    }
  }

  function disable() {
    isPipetteMode = false;
    if (pipetteBtn) pipetteBtn.classList.remove('active');
    if (pipetteHud) pipetteHud.style.display = 'none';
    if (pipetteMagnifier) pipetteMagnifier.style.display = 'none';
    if (fullWidthImage) fullWidthImage.style.cursor = '';
    resetCopyButtonText();
  }

  function toggle() {
    isPipetteMode = !isPipetteMode;
    if (isPipetteMode) {
      if (pipetteBtn) pipetteBtn.classList.add('active');
      if (pipetteMagnifier) {
        pipetteMagnifier.style.opacity = '0';
        pipetteMagnifier.style.display = 'block';
      }
      if (fullWidthImage) fullWidthImage.style.cursor = 'none';
      if (pipetteHud) pipetteHud.style.display = 'none';
      return;
    }
    disable();
  }

  function handleMouseMove(event) {
    if (!isPipetteMode || !pipetteMagnifier || !fullWidthImage) return;
    const rect = fullWidthImage.getBoundingClientRect();
    const cx = event.clientX;
    const cy = event.clientY;

    pipetteMagnifier.style.left = `${cx - 48}px`;
    pipetteMagnifier.style.top = `${cy - 48}px`;

    const imgRatio = fullWidthImage.naturalWidth / fullWidthImage.naturalHeight;
    const boxRatio = rect.width / rect.height;

    let renderWidth;
    let renderHeight;
    let offsetX = 0;
    let offsetY = 0;

    if (imgRatio > boxRatio) {
      renderWidth = rect.width;
      renderHeight = rect.width / imgRatio;
      offsetY = (rect.height - renderHeight) / 2;
    } else {
      renderHeight = rect.height;
      renderWidth = rect.height * imgRatio;
      offsetX = (rect.width - renderWidth) / 2;
    }

    const rx = cx - rect.left - offsetX;
    const ry = cy - rect.top - offsetY;

    const ctx = pipetteMagnifier.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    if (rx < 0 || rx > renderWidth || ry < 0 || ry > renderHeight) {
      ctx.clearRect(0, 0, 96, 96);
      pipetteMagnifier.style.opacity = '0';
      fullWidthImage.style.cursor = '';
      return;
    }

    pipetteMagnifier.style.opacity = '1';
    fullWidthImage.style.cursor = 'none';

    const scaleX = fullWidthImage.naturalWidth / renderWidth;
    const scaleY = fullWidthImage.naturalHeight / renderHeight;

    const nx = Math.floor(rx * scaleX);
    const ny = Math.floor(ry * scaleY);

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 96, 96);

    const srcSize = 48;
    const halfSrc = Math.floor(srcSize / 2);

    ctx.drawImage(fullWidthImage, nx - halfSrc, ny - halfSrc, srcSize, srcSize, 0, 0, 96, 96);

    let hex = '#000000';
    try {
      const pixel = ctx.getImageData(48, 48, 1, 1).data;
      if (pixel[3] !== 0) {
        hex = rgbToHex(pixel[0], pixel[1], pixel[2]);
      }
    } catch (e) {
      // noop
    }

    fullWidthImage.dataset.lastSampledHex = hex;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(47, 47, 2, 2);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.strokeRect(46, 46, 4, 4);
  }

  function sampleCurrentColor() {
    if (!isPipetteMode || !pipetteMagnifier || !fullWidthImage) return;
    const hex = fullWidthImage.dataset.lastSampledHex;
    if (!hex) return;

    if (pipetteColorPreview) pipetteColorPreview.style.backgroundColor = hex;
    if (pipetteHexCode) pipetteHexCode.textContent = hex;
    if (pipetteHud) pipetteHud.style.display = 'flex';
  }

  if (pipetteCopyBtn) {
    pipetteCopyBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const hex = pipetteHexCode ? pipetteHexCode.textContent : '';
      if (!hex) return;

      try {
        await navigatorRef.clipboard.writeText(hex);
        pipetteCopyBtn.textContent = 'Copied!';
        if (copyResetTimer) {
          clearTimeout(copyResetTimer);
        }
        copyResetTimer = setTimeout(() => {
          pipetteCopyBtn.textContent = defaultCopyText;
          copyResetTimer = null;
        }, 1000);
      } catch (error) {
        console.error('Failed to copy color to clipboard', error);
      }
    });
  }

  return {
    disable,
    toggle,
    isActive: () => isPipetteMode,
    handleMouseMove,
    sampleCurrentColor
  };
}

export function createImageViewerController({
  imageViewModal,
  fullWidthImage,
  closeImageViewBtn,
  windowOpacitySlider,
  hideUiCheckbox,
  clickThroughCheckbox,
  dragHandle,
  pipetteBtn,
  pipette,
  convertFileSrc,
  invoke
}) {
  let imageScale = 1.0;
  let currentPanX = 0;
  let currentPanY = 0;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;

  function setWindowOpacity(value, hideUi = false) {
    if (invoke) {
      invoke('set_window_opacity', { alpha: parseFloat(value), hideUi }).catch(err => {
        console.error('Failed to set window opacity:', err);
      });
    }
  }
  function open(imageRecord) {
    fullWidthImage.src = convertFileSrc(imageRecord.file_path);
    fullWidthImage.crossOrigin = 'anonymous';
    fullWidthImage.dataset.filePath = imageRecord.file_path;
    fullWidthImage.dataset.hash = imageRecord.hash;
    imageViewModal.classList.add('visible');

    if (windowOpacitySlider) {
      windowOpacitySlider.value = "1.0";
      setWindowOpacity(1.0, false);
    }
    if (hideUiCheckbox) {
      hideUiCheckbox.checked = false;
      document.body.classList.remove('ui-hidden');
    }
    if (clickThroughCheckbox) {
      clickThroughCheckbox.checked = false;
      document.body.classList.remove('click-through-mode');
      if (invoke) {
        invoke('set_click_through', { enabled: false, x: 0, y: 0, w: 0, h: 0 }).catch(console.error);
      }
    }

    imageScale = 1.0;
    currentPanX = 0;
    currentPanY = 0;
    fullWidthImage.style.transform = `translate(${currentPanX}px, ${currentPanY}px) scale(${imageScale})`;
  }

  function close() {
    fullWidthImage.src = '';
    fullWidthImage.removeAttribute('crossOrigin');
    fullWidthImage.dataset.filePath = '';
    fullWidthImage.dataset.hash = '';
    imageViewModal.classList.remove('visible');
    pipette.disable();

    if (windowOpacitySlider) {
      windowOpacitySlider.value = "1.0";
      setWindowOpacity(1.0, false);
    }
    if (hideUiCheckbox) {
      hideUiCheckbox.checked = false;
      document.body.classList.remove('ui-hidden');
    }
    if (clickThroughCheckbox) {
      clickThroughCheckbox.checked = false;
      document.body.classList.remove('click-through-mode');
      if (invoke) {
        invoke('set_click_through', { enabled: false, x: 0, y: 0, w: 0, h: 0 }).catch(console.error);
      }
    }

    imageScale = 1.0;
    currentPanX = 0;
    currentPanY = 0;
    fullWidthImage.style.transform = `translate(${currentPanX}px, ${currentPanY}px) scale(${imageScale})`;
  }

  function bindEvents() {
    if (closeImageViewBtn) {
      closeImageViewBtn.addEventListener('click', close);
    }

    if (windowOpacitySlider) {
      windowOpacitySlider.addEventListener('input', (e) => {
        setWindowOpacity(e.target.value, hideUiCheckbox ? hideUiCheckbox.checked : false);
      });
    }

    if (hideUiCheckbox) {
      hideUiCheckbox.addEventListener('change', (e) => {
        document.body.classList.toggle('ui-hidden', e.target.checked);
        if (windowOpacitySlider) {
          setWindowOpacity(windowOpacitySlider.value, e.target.checked);
        }
      });
    }

    if (clickThroughCheckbox) {
      clickThroughCheckbox.addEventListener('change', (e) => {
        document.body.classList.toggle('click-through-mode', e.target.checked);
        if (invoke) {
          const rect = document.querySelector('.image-view-actions').getBoundingClientRect();
          invoke('set_click_through', {
            enabled: e.target.checked,
            x: rect.x,
            y: rect.y,
            w: rect.width,
            h: rect.height
          }).catch(console.error);
        }
      });

      window.addEventListener('resize', () => {
        if (clickThroughCheckbox.checked && invoke) {
          const rect = document.querySelector('.image-view-actions').getBoundingClientRect();
          invoke('set_click_through', {
            enabled: true,
            x: rect.x,
            y: rect.y,
            w: rect.width,
            h: rect.height
          }).catch(console.error);
        }
      });
    }

    imageViewModal.addEventListener('wheel', (e) => {
      // Zoom logic
      if (!clickThroughCheckbox || !clickThroughCheckbox.checked || e.target === fullWidthImage || e.target === imageViewModal) {
        e.preventDefault();
        const zoomDelta = e.deltaY < 0 ? 1.08 : 0.92;
        imageScale = Math.max(0.1, Math.min(imageScale * zoomDelta, 10.0));
        fullWidthImage.style.transform = `translate(${currentPanX}px, ${currentPanY}px) scale(${imageScale})`;
      }
    }, { passive: false });

    imageViewModal.addEventListener('mousedown', (e) => {
      if (e.button === 1 && (e.target === fullWidthImage || e.target === imageViewModal)) { // middle mouse button
        e.preventDefault();
        isPanning = true;
        panStartX = e.clientX - currentPanX;
        panStartY = e.clientY - currentPanY;
        imageViewModal.style.cursor = 'grabbing';
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 1 && isPanning) {
        isPanning = false;
        imageViewModal.style.cursor = '';
      }
    });

    if (pipetteBtn) {
      pipetteBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        pipette.toggle();
      });
    }

    if (dragHandle) {
      dragHandle.addEventListener('mousedown', (e) => {
        if (e.button === 0 && invoke) {
          invoke('start_window_drag').catch(console.error);
        }
      });
    }

    imageViewModal.addEventListener('mousemove', (event) => {
      if (isPanning) {
        event.preventDefault();
        currentPanX = event.clientX - panStartX;
        currentPanY = event.clientY - panStartY;
        fullWidthImage.style.transform = `translate(${currentPanX}px, ${currentPanY}px) scale(${imageScale})`;
      } else {
        pipette.handleMouseMove(event);
      }
    });

    imageViewModal.addEventListener('click', (event) => {
      if (pipette.isActive()) {
        if (event.target === fullWidthImage) {
          pipette.sampleCurrentColor();
        }
        return;
      }

      if (event.target === imageViewModal || event.target === fullWidthImage) {
        close();
      }
    });
  }

  return {
    open,
    close,
    bindEvents
  };
}

export function createNoteEditorController({
  noteEditModal,
  noteEditContent,
  noteEditText,
  noteFontSize,
  noteColorList,
  noteDeleteBtn,
  noteCloseBtn,
  noteDeleteConfirmModal,
  confirmNoteDeleteBtn,
  cancelNoteDeleteBtn,
  noteColors,
  normalizeNoteColor,
  getNoteById,
  onNoteVisualUpdate,
  onNotePreviewUpdate,
  onQueueSave,
  onDeleteNote
}) {
  let editingNoteId = null;
  let noteToDeleteId = null;

  function applyTheme(color, fontSizeRatio = 3) {
    if (!noteEditText) {
      return;
    }
    const safeColor = normalizeNoteColor(color);
    noteEditText.style.backgroundColor = safeColor;

    // Base editor size is roughly 400x400. 
    // Using the same formula for dynamic size as on canvas: Math.min(W, H) * 0.04 * ratio
    const editorFontSize = Math.max(16, 400 * 0.04 * fontSizeRatio);
    noteEditText.style.fontSize = `${editorFontSize}px`;

    if (noteEditContent) {
      noteEditContent.style.setProperty('--note-editor-color', safeColor);
    }
  }

  function renderColorList() {
    if (!noteColorList) {
      return;
    }

    noteColorList.innerHTML = '';
    for (const color of noteColors) {
      const chip = document.createElement('button');
      chip.className = 'note-color-chip';
      chip.type = 'button';
      chip.style.backgroundColor = color;
      chip.dataset.color = color;
      chip.title = color;
      chip.addEventListener('click', () => {
        if (!editingNoteId) {
          return;
        }
        const note = getNoteById(editingNoteId);
        if (!note) {
          return;
        }
        note.color = color;
        onNoteVisualUpdate(note.id);
        applyTheme(note.color, note.fontSize);
        onQueueSave(note.id, true);
        renderColorList();
      });

      if (editingNoteId) {
        const editing = getNoteById(editingNoteId);
        if (editing && normalizeNoteColor(editing.color) === color) {
          chip.classList.add('active');
        }
      }

      noteColorList.appendChild(chip);
    }
  }

  function openDeleteConfirm(noteId) {
    if (!noteDeleteConfirmModal || !noteId) {
      return;
    }
    noteToDeleteId = noteId;
    noteDeleteConfirmModal.classList.add('visible');
  }

  function closeDeleteConfirm() {
    if (!noteDeleteConfirmModal) {
      return;
    }
    noteDeleteConfirmModal.classList.remove('visible');
    noteToDeleteId = null;
  }

  function open(noteId) {
    const note = getNoteById(noteId);
    if (!note || !noteEditModal || !noteEditText) {
      return;
    }

    editingNoteId = noteId;
    noteEditText.value = note.text || '';
    if (noteFontSize) {
      noteFontSize.value = note.fontSize || 3;
    }
    applyTheme(note.color, note.fontSize);
    noteEditModal.classList.add('visible');
    renderColorList();
    queueMicrotask(() => {
      noteEditText.focus();
      noteEditText.setSelectionRange(noteEditText.value.length, noteEditText.value.length);
    });
  }

  function close() {
    if (!noteEditModal || !noteEditText) {
      return;
    }

    if (editingNoteId) {
      const editingNote = getNoteById(editingNoteId);
      if (editingNote) {
        editingNote.text = noteEditText.value;
        onNotePreviewUpdate(editingNoteId);
      }
      onQueueSave(editingNoteId, true);
    }
    editingNoteId = null;
    noteEditModal.classList.remove('visible');
    noteEditText.style.removeProperty('background-color');
    noteEditText.style.removeProperty('font-size');
    if (noteEditContent) {
      noteEditContent.style.removeProperty('--note-editor-color');
    }
    noteEditText.value = '';
    if (noteToDeleteId) {
      closeDeleteConfirm();
    }
  }

  function bindEvents() {
    if (noteCloseBtn) {
      noteCloseBtn.addEventListener('click', () => close());
    }

    if (noteEditModal) {
      noteEditModal.addEventListener('click', (event) => {
        if (event.target === noteEditModal) {
          close();
        }
      });
    }

    if (noteDeleteBtn) {
      noteDeleteBtn.addEventListener('click', () => {
        if (!editingNoteId) {
          return;
        }
        openDeleteConfirm(editingNoteId);
      });
    }

    if (cancelNoteDeleteBtn) {
      cancelNoteDeleteBtn.addEventListener('click', () => {
        closeDeleteConfirm();
      });
    }

    if (confirmNoteDeleteBtn) {
      confirmNoteDeleteBtn.addEventListener('click', async () => {
        if (!noteToDeleteId) {
          closeDeleteConfirm();
          return;
        }
        const targetId = noteToDeleteId;
        closeDeleteConfirm();
        if (editingNoteId === targetId) {
          close();
        }
        await onDeleteNote(targetId);
      });
    }

    if (noteDeleteConfirmModal) {
      noteDeleteConfirmModal.addEventListener('click', (event) => {
        if (event.target === noteDeleteConfirmModal) {
          closeDeleteConfirm();
        }
      });
    }

    if (noteEditText) {
      noteEditText.addEventListener('input', () => {
        if (!editingNoteId) {
          return;
        }
        const note = getNoteById(editingNoteId);
        if (!note) {
          return;
        }
        note.text = noteEditText.value;
        onNotePreviewUpdate(note.id);
        onQueueSave(note.id, false);
      });

      noteEditText.addEventListener('blur', () => {
        if (editingNoteId) {
          const note = getNoteById(editingNoteId);
          if (note) {
            note.text = noteEditText.value;
            onNotePreviewUpdate(note.id);
          }
          onQueueSave(editingNoteId, true);
        }
      });
    }

    if (noteFontSize) {
      noteFontSize.addEventListener('input', () => {
        if (!editingNoteId) return;
        const note = getNoteById(editingNoteId);
        if (!note) return;
        note.fontSize = parseFloat(noteFontSize.value);
        applyTheme(note.color, note.fontSize);
        onNoteVisualUpdate(note.id);
        onQueueSave(note.id, false);
      });
    }
  }

  return {
    open,
    close,
    openDeleteConfirm,
    closeDeleteConfirm,
    getEditingNoteId: () => editingNoteId,
    getPendingDeleteId: () => noteToDeleteId,
    renderColorList,
    bindEvents
  };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => fn(...args), delay);
  };
}

export async function loadTauriAPI(win = window) {
  if (!win.__TAURI__) {
    throw new Error('Tauri API not available');
  }

  const invoke = win.__TAURI__.core?.invoke || win.__TAURI__.invoke;
  const convertFileSrc = win.__TAURI__.core?.convertFileSrc || win.__TAURI__.convertFileSrc;

  let listen = null;
  if (win.__TAURI__.event) {
    listen = win.__TAURI__.event.listen;
  } else if (win.__TAURI__.core?.event) {
    listen = win.__TAURI__.core.event.listen;
  } else if (win.__TAURI__.listen) {
    listen = win.__TAURI__.listen;
  }

  if (!invoke || !convertFileSrc) {
    throw new Error('Required Tauri API methods not found');
  }

  return { invoke, convertFileSrc, listen };
}

function generateHeaderDither(doc) {
  const ditherEl = doc.getElementById('header-dither-bg');
  const headerRow = doc.querySelector('.header-row');
  const headerText = doc.querySelector('.header-text');
  const headerButtons = doc.querySelector('.header-buttons');
  if (!ditherEl || !headerRow || !headerText || !headerButtons) return;

  const PIXEL = 4;
  const rowRect = headerRow.getBoundingClientRect();
  const textRect = headerText.getBoundingClientRect();

  const width = 2560;
  const height = 240;
  const cols = Math.ceil(width / PIXEL);
  const rows = Math.ceil(height / PIXEL);

  const textEnd = Math.floor(textRect.right - rowRect.left);
  const solidEndPx = textEnd - 200;
  const dissolveEndPx = solidEndPx + 420;

  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let seed = 1337;
  function rand() {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  const noiseField = [];
  for (let r = 0; r < rows; r++) {
    noiseField[r] = [];
    for (let c = 0; c < cols; c++) {
      noiseField[r][c] = rand();
    }
  }

  const bayer8 = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21]
  ];

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const pxX = c * PIXEL;
      const pxY = r * PIXEL;
      const yNorm = Math.min(1.0, pxY / 100.0);
      const skewPx = (1.0 - yNorm) * 175;
      const tPx = pxX + skewPx;

      let probability;
      if (tPx <= solidEndPx) {
        probability = 1.0;
      } else if (tPx >= dissolveEndPx) {
        probability = 0.0;
      } else {
        const progress = (tPx - solidEndPx) / (dissolveEndPx - solidEndPx);
        probability = Math.pow(1.0 - progress, 1.4);
      }

      if (probability <= 0) continue;

      const bayerVal = bayer8[r % 8][c % 8] / 64.0;
      const randomVal = noiseField[r][c];
      const threshold = bayerVal * 0.25 + randomVal * 0.75;

      if (threshold < probability) {
        ctx.fillRect(pxX, pxY, PIXEL, PIXEL);
      }
    }
  }

  ditherEl.style.backgroundImage = `url(${canvas.toDataURL('image/png')})`;
  ditherEl.style.backgroundSize = `${width}px ${height}px`;
  ditherEl.style.width = `${width}px`;
  ditherEl.style.height = `${height}px`;
}

export function setupHeaderDither(doc = document, win = window) {
  generateHeaderDither(doc);

  const headerRowEl = doc.querySelector('.header-row');
  if (!headerRowEl || !win.ResizeObserver) {
    return;
  }

  let ditherResizeTimer = null;
  const observer = new win.ResizeObserver(() => {
    clearTimeout(ditherResizeTimer);
    ditherResizeTimer = setTimeout(() => generateHeaderDither(doc), 150);
  });
  observer.observe(headerRowEl);
}

export function createImageIntake({ invoke, onImageAdded }) {
  async function addFromFilePath(filePath) {
    const result = await invoke('add_image_from_file', { filePath });
    if (result) {
      onImageAdded(result);
    }
  }

  async function addFromBytes(uint8Array) {
    const result = await invoke('add_image_from_bytes', { imageData: uint8Array });
    if (result) {
      onImageAdded(result);
    }
  }

  async function addFromUrl(url) {
    const result = await invoke('add_image_from_url', { url });
    if (result) {
      onImageAdded(result);
    }
  }

  function extractImageUrl(dataTransfer) {
    const uriList = dataTransfer.getData('text/uri-list');
    if (uriList) {
      const urls = uriList
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith('#'));
      for (const url of urls) {
        if (url.startsWith('http://') || url.startsWith('https://')) {
          return url.trim();
        }
      }
    }

    const urlData = dataTransfer.getData('URL');
    if (urlData && (urlData.startsWith('http://') || urlData.startsWith('https://'))) {
      return urlData;
    }

    const htmlData = dataTransfer.getData('text/html');
    if (htmlData) {
      const imgMatch = htmlData.match(/<img[^>]+src=[\"']([^\"']+)[\"']/i);
      if (imgMatch && imgMatch[1]) {
        const src = imgMatch[1];
        if (src.startsWith('http://') || src.startsWith('https://')) {
          return src;
        }
      }
    }

    const textData = dataTransfer.getData('text/plain');
    if (!textData) {
      return null;
    }

    const trimmed = textData.trim();
    if (
      (trimmed.startsWith('http://') || trimmed.startsWith('https://'))
      && /\.(jpe?g|png|gif|bmp|webp|svg|avif|ico|tiff?)/i.test(trimmed)
    ) {
      return trimmed;
    }

    return null;
  }

  return {
    addFromFilePath,
    addFromBytes,
    addFromUrl,
    extractImageUrl
  };
}

import {
  clamp,
  debounce,
  createImageIntake,
  createImageViewerController,
  createNoteEditorController,
  createPipetteController,
  loadTauriAPI,
  setupHeaderDither
} from './modules/ui-features.js';

import { setTauriApi, DOM, state, canvasState, maps, config, controllers } from './modules/store.js';
import { loadMoreImages, removeImageFromUI, addImageToState, attachNativeFileDrag, swapImageSrcSeamless, resolvePendingImage, ensureGridSeededFromCache, initializeGridIfNeeded } from './modules/grid-ops.js';
import { setMode, resetCanvasView, applyCanvasTransform, refreshCanvasItemVisuals, refreshCanvasImageQualityAll, resizeDrawingLayer, canvasCoordinatesFromClient, beginCanvasBoxSelection, clearCanvasSelection, selectCanvasImagesOlderThanDays, getSelectedImageHashes, ensureCanvasLayout, updateCanvasImageQuality, flushLayoutSavesDebounced } from './modules/canvas-ops.js';
import { createCanvasNote, normalizeNoteColor, updateCanvasNoteVisual, updateCanvasNotePreview, queueNoteSave, deleteCanvasNote, refreshCanvasNoteVisuals, flushNoteSavesDebounced } from './modules/canvas-notes.js';
import { setDrawingTool, queueDrawingSave, updateDrawCursor, renderDrawings } from './modules/canvas-draw.js';

function createEmptyDeleteRequest() {
  return { hash: null, hashes: [], wrapper: null, source: 'single' };
}

async function initApp() {
  let appSettings = {};

  try {
    const api = await loadTauriAPI(window);
    setTauriApi(api);
  } catch (error) {
    document.body.innerHTML = `<div style="padding: 20px; color: red;">Error: Tauri API not initialized. ${error.message}</div>`;
    return;
  }

  setupHeaderDither(document, window);

  const persistAppSettings = debounce(async () => {
    try {
      await (await import('./modules/store.js')).invoke('save_app_settings', { settings: JSON.stringify(appSettings) });
    } catch (error) {
      console.error('Failed to save settings', error);
    }
  }, 150);

  try {
    const settingsStr = await (await import('./modules/store.js')).invoke('get_app_settings');
    appSettings = JSON.parse(settingsStr || '{}');
    if (appSettings.isWindowPinned) {
      state.isWindowPinned = true;
      if (DOM.pinAppBtn) DOM.pinAppBtn.classList.add('active');
      await (await import('./modules/store.js')).invoke('toggle_always_on_top', { state: true });
    }
    state.savedCanvasScale = clamp(Number(appSettings.canvasZoom) || 1, canvasState.minScale, canvasState.maxScale);
  } catch (e) {
    console.warn('Failed to load settings', e);
  }

  controllers.pipette = createPipetteController({
    pipetteBtn: DOM.pipetteBtn,
    pipetteHud: DOM.pipetteHud,
    pipetteColorPreview: DOM.pipetteColorPreview,
    pipetteHexCode: DOM.pipetteHexCode,
    pipetteCopyBtn: DOM.pipetteCopyBtn,
    pipetteMagnifier: DOM.pipetteMagnifier,
    fullWidthImage: DOM.fullWidthImage,
    navigatorRef: navigator
  });

  controllers.imageViewer = createImageViewerController({
    imageViewModal: DOM.imageViewModal,
    fullWidthImage: DOM.fullWidthImage,
    closeImageViewBtn: DOM.closeImageViewBtn,
    windowOpacitySlider: DOM.windowOpacitySlider,
    hideUiCheckbox: DOM.hideUiCheckbox,
    clickThroughCheckbox: DOM.clickThroughCheckbox,
    dragHandle: DOM.dragHandle,
    pipetteBtn: DOM.pipetteBtn,
    pipette: controllers.pipette,
    convertFileSrc: (await import('./modules/store.js')).convertFileSrc,
    invoke: (await import('./modules/store.js')).invoke
  });

  controllers.noteEditor = createNoteEditorController({
    noteEditModal: DOM.noteEditModal,
    noteEditContent: DOM.noteEditContent,
    noteEditText: DOM.noteEditText,
    noteFontSize: DOM.noteFontSize,
    noteColorList: DOM.noteColorList,
    noteDeleteBtn: DOM.noteDeleteBtn,
    noteCloseBtn: DOM.noteCloseBtn,
    noteDeleteConfirmModal: DOM.noteDeleteConfirmModal,
    confirmNoteDeleteBtn: DOM.confirmNoteDeleteBtn,
    cancelNoteDeleteBtn: DOM.cancelNoteDeleteBtn,
    noteColors: config.NOTE_COLORS,
    normalizeNoteColor,
    getNoteById: (noteId) => maps.canvasNotesById.get(noteId),
    onNoteVisualUpdate: (noteId) => updateCanvasNoteVisual(noteId),
    onNotePreviewUpdate: (noteId) => updateCanvasNotePreview(noteId),
    onQueueSave: (noteId, immediate) => queueNoteSave(noteId, immediate),
    onDeleteNote: async (noteId) => deleteCanvasNote(noteId)
  });

  controllers.imageIntake = createImageIntake({
    invoke: (await import('./modules/store.js')).invoke,
    onImageAdded: (imageRecord) => addImageToState(imageRecord, true)
  });

  function setCleanupPanelOpen(isOpen) {
    state.isCleanupPanelOpen = isOpen;
    if (DOM.cleanupPanel) DOM.cleanupPanel.classList.toggle('hidden', !isOpen);
    if (DOM.cleanupToggleBtn) DOM.cleanupToggleBtn.classList.toggle('active', isOpen);
  }

  function updateCleanupDaysLabel() {
    if (!DOM.cleanupDaysLabel) {
      return;
    }

    const days = Math.max(1, Math.round(state.cleanupDays || 1));
    DOM.cleanupDaysLabel.textContent = `Older than ${days} day${days === 1 ? '' : 's'}`;
  }

  function updateCleanupSelectionState(imageHashes = getSelectedImageHashes()) {
    const imageCount = imageHashes.length;

    if (DOM.cleanupSelectedCount) {
      DOM.cleanupSelectedCount.textContent = `${imageCount} image${imageCount === 1 ? '' : 's'} selected`;
    }

    if (DOM.cleanupDeleteBtn) {
      DOM.cleanupDeleteBtn.disabled = imageCount === 0;
    }
  }

  function queueDeleteConfirmation(hashes, source = 'single') {
    const uniqueHashes = [...new Set((hashes || []).filter(Boolean))];
    if (uniqueHashes.length === 0) {
      return;
    }

    state.imageToDelete = {
      hash: uniqueHashes[0] || null,
      hashes: uniqueHashes,
      wrapper: null,
      source,
    };

    if (DOM.confirmDialogMessage) {
      DOM.confirmDialogMessage.textContent = uniqueHashes.length === 1
        ? 'Delete this image?'
        : `Delete ${uniqueHashes.length} selected images?`;
    }

    DOM.confirmDialog.classList.add('visible');
  }

  async function deleteImagesByHashes(hashes, source = 'single') {
    const uniqueHashes = [...new Set((hashes || []).filter(Boolean))];
    let deletedCount = 0;

    for (const hash of uniqueHashes) {
      try {
        await (await import('./modules/store.js')).invoke('delete_image', { hash });
        removeImageFromUI(hash);
        deletedCount += 1;
      } catch (error) {
        console.error(`Error deleting image ${hash}:`, error);
      }
    }

    if (deletedCount > 0) {
      state.currentOffset = Math.max(0, state.currentOffset - deletedCount);
      if (source === 'bulk') {
        clearCanvasSelection();
      }
    }
  }

  DOM.importBtn.addEventListener('click', async () => {
    DOM.importBtn.disabled = true;
    try {
      const clipboardData = await navigator.clipboard.read();
      for (const item of clipboardData) {
        const imageType = item.types.find((type) => type.startsWith('image/'));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = Array.from(new Uint8Array(arrayBuffer));
        await controllers.imageIntake.addFromBytes(uint8Array);
        break;
      }
    } catch (error) {
      console.error('Error importing from clipboard:', error);
      alert('Failed to import image from clipboard.');
    } finally {
      DOM.importBtn.disabled = false;
    }
  });

  DOM.openFileBtn.addEventListener('click', async () => {
    DOM.openFileBtn.disabled = true;
    try {
      const { open } = window.__TAURI__.dialog || {};
      if (!open) {
        alert('File dialog not available');
        return;
      }
      const selected = await open({
        multiple: true,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }],
      });
      if (!selected) return;
      const files = Array.isArray(selected) ? selected : [selected];
      for (const filePath of files) {
        try {
          await controllers.imageIntake.addFromFilePath(filePath);
        } catch (error) {
          console.error('Error adding image from file:', error);
        }
      }
    } catch (error) {
      console.error('Error opening file dialog:', error);
      alert('Failed to open file dialog.');
    } finally {
      DOM.openFileBtn.disabled = false;
    }
  });

  if (DOM.pinAppBtn) {
    DOM.pinAppBtn.addEventListener('click', async () => {
      state.isWindowPinned = !state.isWindowPinned;
      try {
        await (await import('./modules/store.js')).invoke('toggle_always_on_top', { state: state.isWindowPinned });
        DOM.pinAppBtn.classList.toggle('active', state.isWindowPinned);
        appSettings.isWindowPinned = state.isWindowPinned;
        persistAppSettings();
      } catch (error) {
        console.error('Error toggling always on top:', error);
        state.isWindowPinned = !state.isWindowPinned;
      }
    });
  }

  DOM.cancelDeleteBtn.addEventListener('click', () => {
    DOM.confirmDialog.classList.remove('visible');
    state.imageToDelete = createEmptyDeleteRequest();
  });

  DOM.confirmDeleteBtn.addEventListener('click', async () => {
    const hashes = state.imageToDelete.hashes?.length
      ? state.imageToDelete.hashes
      : (state.imageToDelete.hash ? [state.imageToDelete.hash] : []);
    if (hashes.length === 0) return;

    await deleteImagesByHashes(hashes, state.imageToDelete.source || 'single');
    DOM.confirmDialog.classList.remove('visible');
    state.imageToDelete = createEmptyDeleteRequest();
  });

  controllers.imageViewer.bindEvents();
  controllers.noteEditor.bindEvents();

  function closeDrawClearConfirm() {
    if (DOM.drawClearConfirmModal) {
      DOM.drawClearConfirmModal.classList.remove('visible');
    }
  }

  if (DOM.drawClearConfirmModal) {
    DOM.drawClearConfirmModal.addEventListener('click', (event) => {
      if (event.target === DOM.drawClearConfirmModal) closeDrawClearConfirm();
    });
  }

  if (DOM.cancelDrawClearBtn) DOM.cancelDrawClearBtn.addEventListener('click', closeDrawClearConfirm);

  if (DOM.confirmDrawClearBtn) {
    DOM.confirmDrawClearBtn.addEventListener('click', () => {
      state.drawingStrokes = [];
      renderDrawings();
      queueDrawingSave();
      closeDrawClearConfirm();
    });
  }

  if (DOM.addNoteBtn) {
    DOM.addNoteBtn.addEventListener('click', () => {
      setMode('canvas');
      createCanvasNote();
    });
  }

  if (DOM.cleanupAgeSlider) {
    DOM.cleanupAgeSlider.value = String(state.cleanupDays);
    DOM.cleanupAgeSlider.addEventListener('input', (event) => {
      state.cleanupDays = parseInt(event.target.value, 10) || 30;
      updateCleanupDaysLabel();
    });
  }

  if (DOM.cleanupToggleBtn) {
    DOM.cleanupToggleBtn.addEventListener('click', () => {
      setCleanupPanelOpen(!state.isCleanupPanelOpen);
      updateCleanupSelectionState();
    });
  }

  if (DOM.cleanupApplyBtn) {
    DOM.cleanupApplyBtn.addEventListener('click', () => {
      const selectedCount = selectCanvasImagesOlderThanDays(state.cleanupDays);
      if (DOM.cleanupSelectedCount && selectedCount === 0) {
        DOM.cleanupSelectedCount.textContent = `0 images older than ${state.cleanupDays} day${state.cleanupDays === 1 ? '' : 's'}`;
      }
    });
  }

  if (DOM.cleanupDeleteBtn) {
    DOM.cleanupDeleteBtn.addEventListener('click', () => {
      const selectedImageHashes = getSelectedImageHashes();
      if (selectedImageHashes.length === 0) {
        return;
      }

      queueDeleteConfirmation(selectedImageHashes, 'bulk');
    });
  }

  document.addEventListener('canvas-selection-change', (event) => {
    updateCleanupSelectionState(event.detail?.imageHashes || []);
  });

  if (DOM.githubRepoLink) {
    DOM.githubRepoLink.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await (await import('./modules/store.js')).invoke('open_url', { url: DOM.githubRepoLink.href });
      } catch (err) {
        console.error('Failed to open github link:', err);
      }
    });
  }

  attachNativeFileDrag(DOM.fullWidthImage, () => ({
    path: DOM.fullWidthImage.dataset.filePath,
    hash: DOM.fullWidthImage.dataset.hash,
  }));

  DOM.gridModeBtn.addEventListener('click', () => {
    setMode('grid');
    setCleanupPanelOpen(false);
    initializeGridIfNeeded();
    ensureGridSeededFromCache();
    loadMoreImages();
  });
  DOM.canvasModeBtn.addEventListener('click', () => setMode('canvas'));

  function persistCanvasZoom(scale) {
    state.savedCanvasScale = clamp(scale, canvasState.minScale, canvasState.maxScale);
    appSettings.canvasZoom = state.savedCanvasScale;
    persistAppSettings();
  }

  DOM.canvasResetBtn.addEventListener('click', () => {
    persistCanvasZoom(1);
    resetCanvasView(1);
  });

  DOM.canvasView.addEventListener('wheel', (event) => {
    event.preventDefault();
    const zoomFactor = event.deltaY < 0 ? 1.08 : 0.92;
    const prevScale = canvasState.scale;
    const newScale = clamp(prevScale * zoomFactor, canvasState.minScale, canvasState.maxScale);

    if (newScale === prevScale) return;

    const rect = DOM.canvasView.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const worldX = (mouseX - canvasState.x) / prevScale;
    const worldY = (mouseY - canvasState.y) / prevScale;

    canvasState.scale = newScale;
    canvasState.x = mouseX - worldX * newScale;
    canvasState.y = mouseY - worldY * newScale;

    applyCanvasTransform();
    refreshCanvasItemVisuals();
    refreshCanvasNoteVisuals();
    refreshCanvasImageQualityAll();
    persistCanvasZoom(newScale);
  }, { passive: false });

  DOM.canvasView.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (
      target.closest('.canvas-hud') ||
      target.closest('.canvas-cleanup-cluster') ||
      target.closest('.canvas-drawing-tools') ||
      target.closest('.import-btn') ||
      target.closest('.action-btn') ||
      target.closest('.canvas-resize-handle')
    ) {
      return;
    }

    if (state.currentDrawingTool !== 'pan' && event.button === 0) {
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const ptr = canvasCoordinatesFromClient(startX, startY);

      state.currentStroke = {
        isEraser: state.currentDrawingTool === 'eraser',
        color: DOM.drawColorPicker ? DOM.drawColorPicker.value : '#ff0000',
        size: state.currentDrawingTool === 'eraser' ? state.eraserSize : state.brushSize,
        points: [{ x: ptr.x, y: ptr.y }]
      };

      state.drawingStrokes.push(state.currentStroke);
      renderDrawings();

      let lastWorldX = Math.floor(ptr.x);
      let lastWorldY = Math.floor(ptr.y);

      function onDrawMove(moveEvent) {
        moveEvent.preventDefault();
        const curPtr = canvasCoordinatesFromClient(moveEvent.clientX, moveEvent.clientY);
        const cwX = Math.floor(curPtr.x);
        const cwY = Math.floor(curPtr.y);

        if (cwX !== lastWorldX || cwY !== lastWorldY) {
          state.currentStroke.points.push({ x: curPtr.x, y: curPtr.y });
          lastWorldX = cwX;
          lastWorldY = cwY;
          renderDrawings();
        }
      }

      function onDrawUp() {
        window.removeEventListener('pointermove', onDrawMove);
        window.removeEventListener('pointerup', onDrawUp);
        state.currentStroke = null;
        queueDrawingSave();
      }

      window.addEventListener('pointermove', onDrawMove);
      window.addEventListener('pointerup', onDrawUp);
      return;
    }

    const inItem = target.closest('.canvas-item');

    if (event.button === 0 && event.shiftKey && state.currentDrawingTool === 'pan' && !inItem) {
      if (beginCanvasBoxSelection(event)) {
        return;
      }
    }

    if (event.button !== 1 && (inItem || event.button !== 0)) {
      return;
    }

    event.preventDefault();
    if (event.button === 0) {
      clearCanvasSelection();
    }
    canvasState.isPanning = true;
    DOM.canvasView.classList.add('panning');

    const startX = event.clientX;
    const startY = event.clientY;
    const startPanX = canvasState.x;
    const startPanY = canvasState.y;

    function onMove(moveEvent) {
      canvasState.x = startPanX + (moveEvent.clientX - startX);
      canvasState.y = startPanY + (moveEvent.clientY - startY);
      applyCanvasTransform();
    }

    function onUp() {
      canvasState.isPanning = false;
      DOM.canvasView.classList.remove('panning');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  DOM.workspace.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    DOM.workspace.classList.add('drag-over');
  });

  DOM.workspace.addEventListener('dragleave', (event) => {
    if (event.target === DOM.workspace || !DOM.workspace.contains(event.relatedTarget)) {
      DOM.workspace.classList.remove('drag-over');
    }
  });

  DOM.workspace.addEventListener('drop', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    DOM.workspace.classList.remove('drag-over');

    const files = event.dataTransfer.files;
    let handled = false;

    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const filePath = file.path;

        try {
          if (filePath) {
            await controllers.imageIntake.addFromFilePath(filePath);
            handled = true;
          } else if (file.type.startsWith('image/')) {
            const arrayBuffer = await file.arrayBuffer();
            const uint8Array = Array.from(new Uint8Array(arrayBuffer));
            await controllers.imageIntake.addFromBytes(uint8Array);
            handled = true;
          }
        } catch (error) {
          console.error('Error handling dropped file:', error);
        }
      }
    }

    if (!handled) {
      const imageUrl = controllers.imageIntake.extractImageUrl(event.dataTransfer);
      if (imageUrl) {
        try {
          await controllers.imageIntake.addFromUrl(imageUrl);
          handled = true;
        } catch (error) {
          console.error('Error adding image from URL:', error);
        }
      }
    }

    if (!handled) {
      console.warn('Drop event received but no processable data found');
    }
  });

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && state.currentMode === 'grid') {
        loadMoreImages();
      }
    },
    { root: DOM.gridView, threshold: 0.1 },
  );

  observer.observe(DOM.loadingIndicator);

  const listen = (await import('./modules/store.js')).listen;
  const convertFileSrc = (await import('./modules/store.js')).convertFileSrc;

  if (listen) {
    listen('thumbnail-generated', (event) => {
      const payload = event.payload;
      const { hash, thumbnail_path: thumbnailPath } = payload;

      resolvePendingImage(hash);

      const imageRecord = maps.imagesByHash.get(hash);
      if (imageRecord) {
        imageRecord.thumbnail_path = thumbnailPath;
        maps.imagesByHash.set(hash, imageRecord);
      }

      const gridWrapper = maps.gridElementsByHash.get(hash);
      if (gridWrapper) {
        const img = gridWrapper.querySelector('img');
        if (img) {
          swapImageSrcSeamless(img, convertFileSrc(thumbnailPath)).finally(() => {
            img.style.opacity = '1.0';
          });
        }
        gridWrapper.classList.remove('pending-thumbnail');
      }

      const canvasWrapper = maps.canvasElementsByHash.get(hash);
      if (canvasWrapper) {
        const thumbImg = canvasWrapper.querySelector('.canvas-image-thumb');
        if (thumbImg) {
          swapImageSrcSeamless(thumbImg, convertFileSrc(thumbnailPath)).finally(() => {
            thumbImg.style.opacity = '1.0';
          });
        }
        canvasWrapper.classList.remove('pending-thumbnail');
        updateCanvasImageQuality(hash);
      }
    });

    listen('thumbnail-error', (event) => {
      const payload = event.payload;
      const { hash, error } = payload;
      console.error('Thumbnail generation failed for hash:', hash, error);

      resolvePendingImage(hash);

      const gridWrapper = maps.gridElementsByHash.get(hash);
      if (gridWrapper) {
        gridWrapper.classList.remove('pending-thumbnail');
      }

      const canvasWrapper = maps.canvasElementsByHash.get(hash);
      if (canvasWrapper) {
        canvasWrapper.classList.remove('pending-thumbnail');
      }
    });
  }

  window.addEventListener('beforeunload', () => {
    flushLayoutSavesDebounced.flush?.() || flushLayoutSavesDebounced();
    flushNoteSavesDebounced.flush?.() || flushNoteSavesDebounced();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      flushLayoutSavesDebounced.flush?.() || flushLayoutSavesDebounced();
      flushNoteSavesDebounced.flush?.() || flushNoteSavesDebounced();
    }
  });

  if (DOM.noteEditModal) {
    controllers.noteEditor.renderColorList();
  }

  if (DOM.toolPanBtn) DOM.toolPanBtn.addEventListener('click', () => setDrawingTool('pan'));
  if (DOM.toolBrushBtn) DOM.toolBrushBtn.addEventListener('click', () => setDrawingTool('brush'));
  if (DOM.toolEraserBtn) DOM.toolEraserBtn.addEventListener('click', () => setDrawingTool('eraser'));
  if (DOM.drawClearBtn) DOM.drawClearBtn.addEventListener('click', () => {
    if (DOM.drawClearConfirmModal) DOM.drawClearConfirmModal.classList.add('visible');
  });

  if (DOM.drawColorPicker) {
    DOM.drawColorPicker.addEventListener('click', (e) => {
      if (state.isColorPickerOpen) {
        e.preventDefault();
        DOM.drawColorPicker.type = 'text';
        DOM.drawColorPicker.type = 'color';
        state.isColorPickerOpen = false;
      } else {
        state.isColorPickerOpen = true;
      }
    });

    window.addEventListener('pointerdown', (e) => {
      if (e.target !== DOM.drawColorPicker && (!DOM.drawColorPicker || !DOM.drawColorPicker.contains(e.target))) {
        state.isColorPickerOpen = false;
      }
    }, { capture: true });
  }

  if (DOM.drawSizePicker) {
    DOM.drawSizePicker.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (state.currentDrawingTool === 'brush') {
        state.brushSize = val;
      } else if (state.currentDrawingTool === 'eraser') {
        state.eraserSize = val;
      }
      updateDrawCursor(state.lastMouseX, state.lastMouseY);
    });
  }

  DOM.canvasView.addEventListener('pointermove', (event) => {
    state.lastMouseX = event.clientX;
    state.lastMouseY = event.clientY;

    if (event.target.closest('.canvas-hud, .canvas-cleanup-cluster, .canvas-drawing-tools, .import-btn')) {
      if (DOM.drawCursor) DOM.drawCursor.classList.add('hidden');
    } else {
      updateDrawCursor(event.clientX, event.clientY);
    }
  });

  DOM.canvasView.addEventListener('pointerleave', () => {
    if (DOM.drawCursor) DOM.drawCursor.classList.add('hidden');
  });

  DOM.canvasView.addEventListener('pointerenter', (event) => {
    if (state.currentDrawingTool !== 'pan') {
      if (event.target.closest('.canvas-hud, .canvas-cleanup-cluster, .canvas-drawing-tools, .import-btn')) {
        if (DOM.drawCursor) DOM.drawCursor.classList.add('hidden');
      } else {
        updateDrawCursor(event.clientX, event.clientY);
      }
    }
  });

  window.addEventListener('resize', resizeDrawingLayer);

  updateCleanupDaysLabel();
  updateCleanupSelectionState();
  setCleanupPanelOpen(false);

  await initializeGridIfNeeded();
  resetCanvasView(state.savedCanvasScale);
  setMode('grid');
  ensureGridSeededFromCache();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

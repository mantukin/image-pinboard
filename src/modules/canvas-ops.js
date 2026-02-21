import { clamp, debounce } from './ui-features.js';
import { invoke, convertFileSrc, DOM, state, canvasState, maps, config, controllers } from './store.js';
import { buildActionsContainer, getImageSrc, swapImageSrcSeamless } from './grid-ops.js';
import { ensureCanvasNote, refreshCanvasNoteVisuals } from './canvas-notes.js';
import { renderDrawings } from './canvas-draw.js';

export function canvasCoordinatesFromClient(clientX, clientY) {
    const rect = DOM.canvasView.getBoundingClientRect();
    const x = (clientX - rect.left - canvasState.x) / canvasState.scale;
    const y = (clientY - rect.top - canvasState.y) / canvasState.scale;
    return { x, y };
}

export function getCanvasCenterWorld() {
    const centerX = DOM.canvasView.clientWidth / 2;
    const centerY = DOM.canvasView.clientHeight / 2;
    return {
        x: (centerX - canvasState.x) / canvasState.scale,
        y: (centerY - canvasState.y) / canvasState.scale,
    };
}

export function getDefaultCanvasLayout(hash) {
    const index = maps.canvasLayoutByHash.size;
    const cols = 6;
    const gap = 280;
    const row = Math.floor(index / cols);
    const col = index % cols;
    return {
        hash,
        x: col * gap,
        y: row * gap,
        scale: 1,
        width: config.BASE_ITEM_SIZE,
        height: config.BASE_ITEM_SIZE,
        zIndex: index + 1,
    };
}

export function bringCanvasItemToFront(hash) {
    const layout = maps.canvasLayoutByHash.get(hash);
    const wrapper = maps.canvasElementsByHash.get(hash);

    if (!layout || !wrapper) {
        return;
    }

    state.maxCanvasZ += 1;
    layout.zIndex = state.maxCanvasZ;
    wrapper.style.zIndex = String(layout.zIndex);
    queueLayoutSave(hash);
}

export function getCanvasControlMetrics(rawUiScale) {
    const uiScale = Math.round(clamp(rawUiScale, 0.7, 2.4) * 4) / 4;
    return {
        uiScale,
        actionBtnSize: Math.max(18, Math.round(24 * uiScale)),
        actionsGap: Math.max(6, Math.round(12 * uiScale)),
        noteActionsGap: Math.max(5, Math.round(8 * uiScale))
    };
}

export function updateCanvasItemVisual(hash) {
    const layout = maps.canvasLayoutByHash.get(hash);
    const wrapper = maps.canvasElementsByHash.get(hash);

    if (!layout || !wrapper) {
        return;
    }

    const snappedX = Math.round(layout.x);
    const snappedY = Math.round(layout.y);
    const snappedW = Math.round(layout.width);
    const snappedH = Math.round(layout.height);
    const itemScaleFactor = Math.min(snappedW, snappedH) / config.BASE_ITEM_SIZE;
    const viewportCompensation = 1 / canvasState.scale;
    const rawUiScale = itemScaleFactor * viewportCompensation;
    const controlsBaseWidth = 96;
    const maxBySize = Math.max(0.7, Math.min((snappedW - 10) / controlsBaseWidth, (snappedH - 10) / 26));
    const uiScale = clamp(rawUiScale, 0.7, Math.min(2.4, maxBySize));
    const controlMetrics = getCanvasControlMetrics(uiScale);

    wrapper.style.left = `${snappedX}px`;
    wrapper.style.top = `${snappedY}px`;
    wrapper.style.width = `${snappedW}px`;
    wrapper.style.height = `${snappedH}px`;
    wrapper.style.setProperty('--canvas-ui-scale', controlMetrics.uiScale.toString());
    wrapper.style.setProperty('--canvas-action-btn-size', `${controlMetrics.actionBtnSize}px`);
    wrapper.style.setProperty('--canvas-actions-gap', `${controlMetrics.actionsGap}px`);
    wrapper.style.setProperty('--canvas-note-actions-gap', `${controlMetrics.noteActionsGap}px`);
    wrapper.style.zIndex = String(layout.zIndex);

    updateCanvasImageQuality(hash);
}

export function refreshCanvasItemVisuals() {
    for (const hash of maps.canvasElementsByHash.keys()) {
        updateCanvasItemVisual(hash);
    }
}

export function getCanvasImageLayers(hash) {
    const wrapper = maps.canvasElementsByHash.get(hash);
    if (!wrapper) {
        return null;
    }

    const thumbImg = wrapper.querySelector('.canvas-image-thumb');
    const fullImg = wrapper.querySelector('.canvas-image-full');

    if (!thumbImg || !fullImg) {
        return null;
    }

    return { wrapper, thumbImg, fullImg };
}

export function ensureFullImageLoaded(hash) {
    const layers = getCanvasImageLayers(hash);
    const imageRecord = maps.imagesByHash.get(hash);

    if (!layers || !imageRecord) {
        return Promise.resolve(false);
    }

    const { fullImg } = layers;
    if (fullImg.dataset.loaded === 'true') {
        return Promise.resolve(true);
    }

    if (maps.fullImageLoadPromises.has(hash)) {
        return maps.fullImageLoadPromises.get(hash);
    }

    const loadPromise = new Promise((resolve) => {
        const markReady = async () => {
            if (typeof fullImg.decode === 'function') {
                try {
                    await fullImg.decode();
                } catch (_) {
                    // ignore
                }
            }
            fullImg.dataset.loaded = 'true';
            maps.fullImageLoadPromises.delete(hash);
            resolve(true);
            updateCanvasImageQuality(hash);
        };

        const markFailed = () => {
            fullImg.dataset.loaded = 'error';
            maps.fullImageLoadPromises.delete(hash);
            resolve(false);
        };

        fullImg.addEventListener('load', markReady, { once: true });
        fullImg.addEventListener('error', markFailed, { once: true });

        const originalSrc = convertFileSrc(imageRecord.file_path);
        fullImg.dataset.loaded = 'loading';
        if (fullImg.src !== originalSrc) {
            fullImg.src = originalSrc;
        } else if (fullImg.complete && fullImg.naturalWidth > 0) {
            markReady();
        }
    });

    maps.fullImageLoadPromises.set(hash, loadPromise);
    return loadPromise;
}

export function updateCanvasImageQuality(hash) {
    const layout = maps.canvasLayoutByHash.get(hash);
    const layers = getCanvasImageLayers(hash);
    if (!layout || !layers) {
        return;
    }

    const { wrapper, fullImg } = layers;
    const maxVisibleSize = Math.max(layout.width, layout.height) * canvasState.scale;
    const shouldShowFull = maxVisibleSize >= config.FULL_RES_THRESHOLD;
    const fullReady = fullImg.dataset.loaded === 'true';

    if (shouldShowFull && !fullReady) {
        ensureFullImageLoaded(hash);
    }

    wrapper.classList.toggle('show-full', shouldShowFull && fullReady);
}

export function refreshCanvasImageQualityAll() {
    for (const hash of maps.canvasElementsByHash.keys()) {
        updateCanvasImageQuality(hash);
    }
}

export function setActiveCanvasElement(wrapper) {
    if (state.activeCanvasElement === wrapper) {
        return;
    }

    if (state.activeCanvasElement && state.activeCanvasElement.isConnected) {
        state.activeCanvasElement.classList.remove('active');
    }

    state.activeCanvasElement = wrapper || null;

    if (state.activeCanvasElement) {
        state.activeCanvasElement.classList.add('active');
    }
}

export function setActiveCanvasItem(hash) {
    state.activeCanvasHash = hash;
    setActiveCanvasElement(maps.canvasElementsByHash.get(hash) || null);
}

export function beginCanvasResize(imageRecord, direction, event) {
    if (event.button !== 0) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    setActiveCanvasItem(imageRecord.hash);
    bringCanvasItemToFront(imageRecord.hash);

    const layout = maps.canvasLayoutByHash.get(imageRecord.hash);
    if (!layout) {
        return;
    }

    const startPointer = canvasCoordinatesFromClient(event.clientX, event.clientY);
    const startLeft = layout.x;
    const startTop = layout.y;
    const startRight = layout.x + layout.width;
    const startBottom = layout.y + layout.height;

    const offsetLeft = startPointer.x - startLeft;
    const offsetRight = startPointer.x - startRight;
    const offsetTop = startPointer.y - startTop;
    const offsetBottom = startPointer.y - startBottom;

    function onMove(moveEvent) {
        const pointer = canvasCoordinatesFromClient(moveEvent.clientX, moveEvent.clientY);

        let left = startLeft;
        let right = startRight;
        let top = startTop;
        let bottom = startBottom;

        if (direction.includes('e')) {
            const targetRight = pointer.x - offsetRight;
            right = clamp(targetRight, left + config.CANVAS_MIN_ITEM_SIZE, left + config.CANVAS_MAX_ITEM_SIZE);
        }

        if (direction.includes('w')) {
            const targetLeft = pointer.x - offsetLeft;
            left = clamp(targetLeft, right - config.CANVAS_MAX_ITEM_SIZE, right - config.CANVAS_MIN_ITEM_SIZE);
        }

        if (direction.includes('s')) {
            const targetBottom = pointer.y - offsetBottom;
            bottom = clamp(targetBottom, top + config.CANVAS_MIN_ITEM_SIZE, top + config.CANVAS_MAX_ITEM_SIZE);
        }

        if (direction.includes('n')) {
            const targetTop = pointer.y - offsetTop;
            top = clamp(targetTop, bottom - config.CANVAS_MAX_ITEM_SIZE, bottom - config.CANVAS_MIN_ITEM_SIZE);
        }

        layout.x = left;
        layout.y = top;
        layout.width = clamp(right - left, config.CANVAS_MIN_ITEM_SIZE, config.CANVAS_MAX_ITEM_SIZE);
        layout.height = clamp(bottom - top, config.CANVAS_MIN_ITEM_SIZE, config.CANVAS_MAX_ITEM_SIZE);
        layout.scale = clamp(Math.min(layout.width, layout.height) / config.BASE_ITEM_SIZE, 0.2, 40);

        updateCanvasItemVisual(imageRecord.hash);
    }

    function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        queueLayoutSave(imageRecord.hash);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
}

export function ensureCanvasLayout(imageRecord) {
    if (maps.canvasLayoutByHash.has(imageRecord.hash)) {
        const existing = maps.canvasLayoutByHash.get(imageRecord.hash);
        if (!existing.width || !existing.height) {
            const size = clamp((existing.scale || 1) * config.BASE_ITEM_SIZE, config.CANVAS_MIN_ITEM_SIZE, config.CANVAS_MAX_ITEM_SIZE);
            existing.width = size;
            existing.height = size;
            existing.scale = size / config.BASE_ITEM_SIZE;
            queueLayoutSave(imageRecord.hash);
        }
        return existing;
    }

    const layout = getDefaultCanvasLayout(imageRecord.hash);
    state.maxCanvasZ = Math.max(state.maxCanvasZ, layout.zIndex);
    maps.canvasLayoutByHash.set(imageRecord.hash, layout);
    queueLayoutSave(imageRecord.hash);
    return layout;
}

export function createCanvasImageElement(imageRecord) {
    const wrapper = document.createElement('div');
    wrapper.className = 'img-wrapper canvas-item';
    wrapper.dataset.hash = imageRecord.hash;
    wrapper.dataset.filePath = imageRecord.file_path;

    const thumbImg = document.createElement('img');
    thumbImg.className = 'canvas-image-layer canvas-image-thumb';
    thumbImg.src = getImageSrc(imageRecord);

    const fullImg = document.createElement('img');
    fullImg.className = 'canvas-image-layer canvas-image-full';
    fullImg.decoding = 'async';
    fullImg.dataset.loaded = 'false';

    if (imageRecord.thumbnail_path === 'PENDING') {
        wrapper.classList.add('pending-thumbnail');
        thumbImg.style.opacity = '0.7';
    }

    const actions = buildActionsContainer(imageRecord, wrapper);
    wrapper.appendChild(thumbImg);
    wrapper.appendChild(fullImg);
    wrapper.appendChild(actions);

    const resizeDirections = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
    for (const direction of resizeDirections) {
        const handle = document.createElement('div');
        handle.className = `canvas-resize-handle canvas-resize-${direction}`;
        handle.dataset.direction = direction;
        handle.addEventListener('pointerdown', (resizeEvent) => beginCanvasResize(imageRecord, direction, resizeEvent));
        wrapper.appendChild(handle);
    }

    wrapper.addEventListener('dblclick', () => {
        if (controllers.imageViewer) controllers.imageViewer.open(imageRecord);
    });

    wrapper.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) {
            return;
        }

        const target = event.target;
        if (target.closest('.action-btn') || target.classList.contains('canvas-resize-handle')) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        setActiveCanvasItem(imageRecord.hash);
        bringCanvasItemToFront(imageRecord.hash);

        const startPointer = canvasCoordinatesFromClient(event.clientX, event.clientY);
        const layout = maps.canvasLayoutByHash.get(imageRecord.hash);
        const startX = layout.x;
        const startY = layout.y;

        function onMove(moveEvent) {
            const pointer = canvasCoordinatesFromClient(moveEvent.clientX, moveEvent.clientY);
            layout.x = startX + (pointer.x - startPointer.x);
            layout.y = startY + (pointer.y - startPointer.y);
            updateCanvasItemVisual(imageRecord.hash);
        }

        function onUp() {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            queueLayoutSave(imageRecord.hash);
        }

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    });

    maps.canvasElementsByHash.set(imageRecord.hash, wrapper);
    DOM.canvasSurface.appendChild(wrapper);

    ensureCanvasLayout(imageRecord);
    updateCanvasItemVisual(imageRecord.hash);
}

export function ensureCanvasItem(imageRecord) {
    const existing = maps.canvasElementsByHash.get(imageRecord.hash);
    if (existing) {
        const thumbImg = existing.querySelector('.canvas-image-thumb');
        const fullImg = existing.querySelector('.canvas-image-full');
        if (thumbImg) {
            swapImageSrcSeamless(thumbImg, getImageSrc(imageRecord));
        }
        if (fullImg) {
            maps.fullImageLoadPromises.delete(imageRecord.hash);
            fullImg.dataset.loaded = 'false';
            fullImg.removeAttribute('src');
        }
        existing.classList.remove('show-full');
        updateCanvasImageQuality(imageRecord.hash);
        return;
    }

    createCanvasImageElement(imageRecord);
}

export function queueLayoutSave(hash) {
    maps.pendingLayoutSaves.add(hash);
    flushLayoutSavesDebounced();
}

export async function _flushLayoutSaves() {
    if (maps.pendingLayoutSaves.size === 0) {
        return;
    }

    const items = [];
    for (const hash of maps.pendingLayoutSaves) {
        const layout = maps.canvasLayoutByHash.get(hash);
        if (!layout) {
            continue;
        }
        items.push({
            hash,
            x: layout.x,
            y: layout.y,
            scale: layout.scale,
            width: layout.width,
            height: layout.height,
            z_index: layout.zIndex,
        });
    }

    maps.pendingLayoutSaves.clear();

    if (items.length === 0) {
        return;
    }

    try {
        await invoke('save_canvas_layout', { items });
    } catch (error) {
        console.error('Failed to save canvas layout:', error);
    }
}

export const flushLayoutSavesDebounced = debounce(_flushLayoutSaves, 250);

export async function initializeCanvasIfNeeded() {
    if (state.canvasLayoutLoaded) {
        return;
    }

    state.canvasLayoutLoaded = true;

    try {
        const layoutItems = await invoke('get_canvas_layout');
        for (const item of layoutItems) {
            const width = clamp(item.width ?? config.BASE_ITEM_SIZE, config.CANVAS_MIN_ITEM_SIZE, config.CANVAS_MAX_ITEM_SIZE);
            const height = clamp(item.height ?? config.BASE_ITEM_SIZE, config.CANVAS_MIN_ITEM_SIZE, config.CANVAS_MAX_ITEM_SIZE);
            const normalized = {
                hash: item.hash,
                x: item.x,
                y: item.y,
                scale: clamp(item.scale ?? width / config.BASE_ITEM_SIZE, 0.2, 40),
                width,
                height,
                zIndex: item.z_index ?? item.zIndex ?? 1,
            };
            maps.canvasLayoutByHash.set(item.hash, normalized);
            state.maxCanvasZ = Math.max(state.maxCanvasZ, normalized.zIndex);
        }

        const noteItems = await invoke('get_canvas_notes');
        for (const note of noteItems) {
            ensureCanvasNote(note);
        }

        try {
            const drawingsStr = await invoke('get_canvas_drawings');
            const parsed = JSON.parse(drawingsStr);
            if (Array.isArray(parsed)) {
                state.drawingStrokes = parsed;
                renderDrawings();
            }
        } catch (err) {
            console.error('Failed to load canvas drawings:', err);
        }

        for (const imageRecord of maps.imagesByHash.values()) {
            ensureCanvasItem(imageRecord);
        }
    } catch (error) {
        console.error('Failed to load canvas layout:', error);
    }
}

export function resetCanvasView() {
    canvasState.x = Math.round(DOM.canvasView.clientWidth * 0.15);
    canvasState.y = Math.round(DOM.canvasView.clientHeight * 0.15);
    canvasState.scale = 1;
    applyCanvasTransform();
    refreshCanvasItemVisuals();
    refreshCanvasNoteVisuals();
    refreshCanvasImageQualityAll();
}

export function applyCanvasTransform() {
    DOM.canvasSurface.style.transform = `translate(${canvasState.x}px, ${canvasState.y}px) scale(${canvasState.scale})`;
    updateCanvasGridLayer();
    updateCanvasZoomLabel();
    renderDrawings();
}

export function updateCanvasZoomLabel() {
    DOM.canvasZoomLabel.textContent = `${Math.round(canvasState.scale * 100)}%`;
}

export function updateCanvasGridLayer() {
    const coarseStep = 180 * canvasState.scale;
    const fineStep = 36 * canvasState.scale;

    if (coarseStep <= 0 || fineStep <= 0) {
        return;
    }

    const fineOffsetX = ((canvasState.x % fineStep) + fineStep) % fineStep;
    const fineOffsetY = ((canvasState.y % fineStep) + fineStep) % fineStep;
    const coarseOffsetX = ((canvasState.x % coarseStep) + coarseStep) % coarseStep;
    const coarseOffsetY = ((canvasState.y % coarseStep) + coarseStep) % coarseStep;

    if (DOM.canvasGridFine) {
        DOM.canvasGridFine.style.backgroundSize = `${fineStep}px ${fineStep}px, ${fineStep}px ${fineStep}px`;
        DOM.canvasGridFine.style.backgroundPosition = `${fineOffsetX}px ${fineOffsetY}px, ${fineOffsetX}px ${fineOffsetY}px`;
    }

    if (DOM.canvasGridCoarse) {
        DOM.canvasGridCoarse.style.backgroundSize = `${coarseStep}px ${coarseStep}px, ${coarseStep}px ${coarseStep}px`;
        DOM.canvasGridCoarse.style.backgroundPosition = `${coarseOffsetX}px ${coarseOffsetY}px, ${coarseOffsetX}px ${coarseOffsetY}px`;
    }
}

export function resizeDrawingLayer() {
    if (!DOM.canvasDrawingLayer) return;
    const rect = DOM.canvasView.getBoundingClientRect();
    if (DOM.canvasDrawingLayer.width !== rect.width || DOM.canvasDrawingLayer.height !== rect.height) {
        DOM.canvasDrawingLayer.width = rect.width;
        DOM.canvasDrawingLayer.height = rect.height;
        renderDrawings();
    }
}

export function setMode(mode) {
    state.currentMode = mode;
    const isCanvas = mode === 'canvas';

    DOM.gridView.classList.toggle('hidden', isCanvas);
    DOM.canvasView.classList.toggle('hidden', !isCanvas);
    DOM.gridModeBtn.classList.toggle('active', !isCanvas);
    DOM.canvasModeBtn.classList.toggle('active', isCanvas);

    if (isCanvas) {
        initializeCanvasIfNeeded();
        requestAnimationFrame(() => {
            resizeDrawingLayer();
            applyCanvasTransform();
            refreshCanvasItemVisuals();
            refreshCanvasNoteVisuals();
            refreshCanvasImageQualityAll();
        });
    }
}

import { clamp, debounce } from './ui-features.js';

export let invoke;
export let convertFileSrc;
export let listen;

export function setTauriApi(api) {
    invoke = api.invoke;
    convertFileSrc = api.convertFileSrc;
    listen = api.listen;
}

export const DOM = {
    get workspace() { return document.getElementById('workspace'); },
    get gridView() { return document.getElementById('grid-view'); },
    get canvasView() { return document.getElementById('canvas-view'); },
    get canvasGridCoarse() { return document.getElementById('canvas-grid-coarse'); },
    get canvasGridFine() { return document.getElementById('canvas-grid-fine'); },
    get canvasSurface() { return document.getElementById('canvas-surface'); },
    get canvasDrawingLayer() { return document.getElementById('canvas-drawing-layer'); },
    get toolPanBtn() { return document.getElementById('tool-pan-btn'); },
    get toolBrushBtn() { return document.getElementById('tool-brush-btn'); },
    get toolEraserBtn() { return document.getElementById('tool-eraser-btn'); },
    get drawColorPicker() { return document.getElementById('draw-color-picker'); },
    get drawSizePicker() { return document.getElementById('draw-size-picker'); },
    get drawClearBtn() { return document.getElementById('draw-clear-btn'); },
    get drawCursor() { return document.getElementById('draw-cursor'); },
    get gridModeBtn() { return document.getElementById('grid-mode-btn'); },
    get canvasModeBtn() { return document.getElementById('canvas-mode-btn'); },
    get canvasZoomLabel() { return document.getElementById('canvas-zoom-label'); },
    get canvasResetBtn() { return document.getElementById('canvas-reset-btn'); },
    get addNoteBtn() { return document.getElementById('add-note-btn'); },
    get githubRepoLink() { return document.getElementById('github-repo-link'); },

    get placeholder() { return document.getElementById('placeholder'); },
    get loadingIndicator() { return document.getElementById('loading-indicator'); },
    get importBtn() { return document.getElementById('import-btn'); },
    get openFileBtn() { return document.getElementById('open-file-btn'); },
    get pinAppBtn() { return document.getElementById('pin-app-btn'); },
    get confirmDialog() { return document.getElementById('confirm-dialog'); },
    get confirmDeleteBtn() { return document.getElementById('confirm-delete-btn'); },
    get cancelDeleteBtn() { return document.getElementById('cancel-delete-btn'); },
    get imageViewModal() { return document.getElementById('image-view-modal'); },
    get fullWidthImage() { return document.getElementById('full-width-image'); },
    get closeImageViewBtn() { return document.getElementById('close-image-view'); },
    get windowOpacitySlider() { return document.getElementById('window-opacity-slider'); },
    get hideUiCheckbox() { return document.getElementById('hide-ui-checkbox'); },
    get clickThroughCheckbox() { return document.getElementById('click-through-checkbox'); },
    get dragHandle() { return document.getElementById('drag-handle'); },

    get pipetteBtn() { return document.getElementById('pipette-btn'); },
    get pipetteHud() { return document.getElementById('pipette-hud'); },
    get pipetteColorPreview() { return document.getElementById('pipette-color-preview'); },
    get pipetteHexCode() { return document.getElementById('pipette-hex-code'); },
    get pipetteCopyBtn() { return document.getElementById('pipette-copy-btn'); },
    get pipetteMagnifier() { return document.getElementById('pipette-magnifier'); },

    get noteEditModal() { return document.getElementById('note-edit-modal'); },
    get noteEditContent() { return document.querySelector('.note-modal-content'); },
    get noteEditText() { return document.getElementById('note-edit-text'); },
    get noteColorList() { return document.getElementById('note-color-list'); },
    get noteDeleteBtn() { return document.getElementById('note-delete-btn'); },
    get noteCloseBtn() { return document.getElementById('note-close-btn'); },
    get noteDeleteConfirmModal() { return document.getElementById('note-delete-confirm-modal'); },
    get confirmNoteDeleteBtn() { return document.getElementById('confirm-note-delete-btn'); },
    get cancelNoteDeleteBtn() { return document.getElementById('cancel-note-delete-btn'); },

    get drawClearConfirmModal() { return document.getElementById('draw-clear-confirm-modal'); },
    get confirmDrawClearBtn() { return document.getElementById('confirm-draw-clear-btn'); },
    get cancelDrawClearBtn() { return document.getElementById('cancel-draw-clear-btn'); },

    get statusBar() { return document.getElementById('status-bar'); },
    get statusCount() { return document.getElementById('status-count'); },
    get statusFill() { return document.getElementById('status-progress-fill'); }
};

export const state = {
    currentOffset: 0,
    isLoading: false,
    allImagesLoaded: false,
    currentMode: 'grid',
    isWindowPinned: false,

    imageToDelete: { hash: null, wrapper: null },
    activeCanvasHash: null,
    activeCanvasElement: null,
    canvasLayoutLoaded: false,
    maxCanvasZ: 0,
    batchTotal: 0,

    currentDrawingTool: 'pan',
    drawingStrokes: [],
    currentStroke: null,
    brushSize: 2,
    eraserSize: 12,
    lastMouseX: 0,
    lastMouseY: 0,
    isColorPickerOpen: false,
};

export const canvasState = {
    x: 180,
    y: 120,
    scale: 1,
    minScale: 0.2,
    maxScale: 2.8,
    isPanning: false,
};

export const maps = {
    imagesByHash: new Map(),
    gridElementsByHash: new Map(),
    canvasElementsByHash: new Map(),
    canvasLayoutByHash: new Map(),
    canvasNotesById: new Map(),
    canvasNoteElementsById: new Map(),
    fullImageLoadPromises: new Map(),
    pendingHashes: new Set(),
    pendingLayoutSaves: new Set(),
    pendingNoteSaves: new Set(),
};

export const config = {
    PAGE_SIZE: 20,
    CANVAS_MIN_ITEM_SIZE: 128,
    CANVAS_MAX_ITEM_SIZE: 4096,
    FULL_RES_THRESHOLD: 320,
    BASE_ITEM_SIZE: 220,
    NOTE_MIN_SIZE: 140,
    NOTE_MAX_SIZE: 2048,
    NOTE_DEFAULT_WIDTH: 260,
    NOTE_DEFAULT_HEIGHT: 220,
    NOTE_COLORS: ['#fef08a', '#fecaca', '#bfdbfe', '#bbf7d0', '#e9d5ff', '#fed7aa'],
};

export const controllers = {
    pipette: null,
    imageViewer: null,
    noteEditor: null,
    imageIntake: null
};

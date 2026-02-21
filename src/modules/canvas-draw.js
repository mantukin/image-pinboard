import { debounce } from './ui-features.js';
import { invoke, DOM, state, canvasState } from './store.js';
import { canvasCoordinatesFromClient } from './canvas-ops.js';

export function renderDrawings() {
    if (!DOM.canvasDrawingLayer) return;
    const ctx = DOM.canvasDrawingLayer.getContext('2d');
    ctx.clearRect(0, 0, DOM.canvasDrawingLayer.width, DOM.canvasDrawingLayer.height);

    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.translate(canvasState.x, canvasState.y);
    ctx.scale(canvasState.scale, canvasState.scale);

    for (const stroke of state.drawingStrokes) {
        if (stroke.isEraser) {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = 'rgba(0,0,0,1)';
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = stroke.color;
        }

        const size = stroke.size || (stroke.isEraser ? 12 : 2);
        const offset = -Math.floor(size / 2);

        const pLen = stroke.points.length;
        if (pLen === 1) {
            ctx.fillRect(Math.floor(stroke.points[0].x) + offset, Math.floor(stroke.points[0].y) + offset, size, size);
            continue;
        }

        for (let i = 0; i < pLen - 1; i++) {
            const p1 = stroke.points[i];
            const p2 = stroke.points[i + 1];

            let x0 = Math.floor(p1.x); let y0 = Math.floor(p1.y);
            let x1 = Math.floor(p2.x); let y1 = Math.floor(p2.y);
            const dx = Math.abs(x1 - x0); const sx = x0 < x1 ? 1 : -1;
            const dy = Math.abs(y1 - y0); const sy = y0 < y1 ? 1 : -1;
            let err = dx - dy;

            while (true) {
                ctx.fillRect(x0 + offset, y0 + offset, size, size);

                if (x0 === x1 && y0 === y1) break;
                const e2 = 2 * err;
                if (e2 > -dy) { err -= dy; x0 += sx; }
                if (e2 < dx) { err += dx; y0 += sy; }
            }
        }
    }
    ctx.restore();
}

export function updateDrawCursor(clientX, clientY) {
    if (!DOM.drawCursor || state.currentDrawingTool === 'pan') return;

    DOM.drawCursor.classList.remove('hidden');
    const size = state.currentDrawingTool === 'brush' ? state.brushSize : state.eraserSize;
    const ptr = canvasCoordinatesFromClient(clientX, clientY);
    const offset = -Math.floor(size / 2);

    const worldLeft = Math.floor(ptr.x) + offset;
    const worldTop = Math.floor(ptr.y) + offset;

    const localScreenLeft = (worldLeft * canvasState.scale) + canvasState.x;
    const localScreenTop = (worldTop * canvasState.scale) + canvasState.y;
    const drawnSize = size * canvasState.scale;

    DOM.drawCursor.style.left = `${localScreenLeft}px`;
    DOM.drawCursor.style.top = `${localScreenTop}px`;
    DOM.drawCursor.style.width = `${drawnSize}px`;
    DOM.drawCursor.style.height = `${drawnSize}px`;
}

export function setDrawingTool(tool) {
    state.currentDrawingTool = tool;
    if (DOM.toolPanBtn) DOM.toolPanBtn.classList.toggle('active', tool === 'pan');
    if (DOM.toolBrushBtn) DOM.toolBrushBtn.classList.toggle('active', tool === 'brush');
    if (DOM.toolEraserBtn) DOM.toolEraserBtn.classList.toggle('active', tool === 'eraser');

    if (tool !== 'pan') {
        DOM.canvasView.classList.add('drawing-mode');
        if (DOM.drawSizePicker) {
            DOM.drawSizePicker.value = tool === 'brush' ? state.brushSize : state.eraserSize;
        }
        updateDrawCursor(state.lastMouseX, state.lastMouseY);
    } else {
        DOM.canvasView.classList.remove('drawing-mode');
        if (DOM.drawCursor) DOM.drawCursor.classList.add('hidden');
    }
}

export const queueDrawingSave = debounce(async () => {
    try {
        await invoke('save_canvas_drawings', { drawings: JSON.stringify(state.drawingStrokes) });
    } catch (error) {
        console.error('Failed to save drawings:', error);
    }
}, 500);

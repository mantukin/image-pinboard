import { clamp, debounce } from './ui-features.js';
import { invoke, maps, state, config, controllers, DOM, canvasState } from './store.js';
import { getCanvasCenterWorld, getCanvasControlMetrics, canvasCoordinatesFromClient, setActiveCanvasElement } from './canvas-ops.js';


export function createNoteId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `note_${crypto.randomUUID()}`;
    }
    return `note_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

export function normalizeNoteColor(color) {
    if (config.NOTE_COLORS.includes(color)) {
        return color;
    }
    return config.NOTE_COLORS[0];
}

export function updateCanvasNotePreview(noteId) {
    const note = maps.canvasNotesById.get(noteId);
    const wrapper = maps.canvasNoteElementsById.get(noteId);
    if (!note || !wrapper) {
        return;
    }

    const textEl = wrapper.querySelector('.canvas-note-text');
    if (!textEl) {
        return;
    }

    const text = (note.text || '').trim();
    if (text.length === 0) {
        textEl.textContent = 'Double-click to edit';
        textEl.classList.add('empty');
    } else {
        textEl.textContent = note.text;
        textEl.classList.remove('empty');
    }
}

export function updateCanvasNoteVisual(noteId) {
    const note = maps.canvasNotesById.get(noteId);
    const wrapper = maps.canvasNoteElementsById.get(noteId);
    if (!note || !wrapper) {
        return;
    }

    const snappedX = Math.round(note.x);
    const snappedY = Math.round(note.y);
    const snappedW = Math.round(note.width);
    const snappedH = Math.round(note.height);
    const itemScaleFactor = Math.min(snappedW, snappedH) / config.BASE_ITEM_SIZE;
    const viewportCompensation = 1 / canvasState.scale;

    const rawUiScale = itemScaleFactor * viewportCompensation;
    const controlsBaseWidth = 96;
    const maxBySize = Math.max(0.7, Math.min((snappedW - 10) / controlsBaseWidth, (snappedH - 10) / 26));
    const uiScale = clamp(rawUiScale, 0.7, Math.min(2.4, maxBySize));
    const controlMetrics = getCanvasControlMetrics(uiScale);
    const dynamicFontSize = clamp(Math.min(snappedW, snappedH) * 0.12, 18, 52);

    wrapper.style.left = `${snappedX}px`;
    wrapper.style.top = `${snappedY}px`;
    wrapper.style.width = `${snappedW}px`;
    wrapper.style.height = `${snappedH}px`;
    wrapper.style.zIndex = String(note.zIndex);
    wrapper.style.setProperty('--canvas-ui-scale', controlMetrics.uiScale.toString());
    wrapper.style.setProperty('--canvas-action-btn-size', `${controlMetrics.actionBtnSize}px`);
    wrapper.style.setProperty('--canvas-actions-gap', `${controlMetrics.actionsGap}px`);
    wrapper.style.setProperty('--canvas-note-actions-gap', `${controlMetrics.noteActionsGap}px`);
    wrapper.style.setProperty('--note-color', normalizeNoteColor(note.color));
    wrapper.style.setProperty('--note-font-size', `${Math.round(dynamicFontSize * 10) / 10}px`);
}

export function refreshCanvasNoteVisuals() {
    for (const id of maps.canvasNoteElementsById.keys()) {
        updateCanvasNoteVisual(id);
    }
}

export function queueNoteSave(id, immediate = false) {
    maps.pendingNoteSaves.add(id);
    if (immediate) {
        _flushNoteSaves();
        return;
    }
    flushNoteSavesDebounced();
}

export async function _flushNoteSaves() {
    if (maps.pendingNoteSaves.size === 0) {
        return;
    }

    const items = [];
    for (const id of maps.pendingNoteSaves) {
        const note = maps.canvasNotesById.get(id);
        if (!note) {
            continue;
        }
        items.push({
            id: note.id,
            text: note.text || '',
            color: normalizeNoteColor(note.color),
            x: note.x,
            y: note.y,
            width: note.width,
            height: note.height,
            z_index: note.zIndex,
        });
    }

    maps.pendingNoteSaves.clear();

    if (items.length === 0) {
        return;
    }

    try {
        await invoke('save_canvas_notes', { items });
    } catch (error) {
        console.error('Failed to save canvas notes:', error);
        for (const item of items) {
            maps.pendingNoteSaves.add(item.id);
        }
        flushNoteSavesDebounced();
    }
}

export const flushNoteSavesDebounced = debounce(_flushNoteSaves, 120);

export function bringCanvasNoteToFront(noteId) {
    const note = maps.canvasNotesById.get(noteId);
    const wrapper = maps.canvasNoteElementsById.get(noteId);
    if (!note || !wrapper) {
        return;
    }

    state.maxCanvasZ += 1;
    note.zIndex = state.maxCanvasZ;
    wrapper.style.zIndex = String(note.zIndex);
    queueNoteSave(noteId);
}

export async function deleteCanvasNote(noteId) {
    const note = maps.canvasNotesById.get(noteId);
    if (!note) {
        return;
    }

    try {
        await invoke('delete_canvas_note', { id: noteId });
    } catch (error) {
        console.error('Failed to delete note:', error);
        return;
    }

    const wrapper = maps.canvasNoteElementsById.get(noteId);
    if (wrapper) {
        wrapper.remove();
        maps.canvasNoteElementsById.delete(noteId);
    }
    maps.canvasNotesById.delete(noteId);
    maps.pendingNoteSaves.delete(noteId);

    if (controllers.noteEditor && controllers.noteEditor.getEditingNoteId() === noteId) {
        controllers.noteEditor.close();
    }
    if (state.activeCanvasElement === wrapper) {
        setActiveCanvasElement(null);
    }
}

export function beginCanvasNoteResize(noteId, direction, event) {
    if (event.button !== 0) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    const note = maps.canvasNotesById.get(noteId);
    const wrapper = maps.canvasNoteElementsById.get(noteId);
    if (!note || !wrapper) {
        return;
    }

    setActiveCanvasElement(wrapper);
    bringCanvasNoteToFront(noteId);

    const startPointer = canvasCoordinatesFromClient(event.clientX, event.clientY);
    const startLeft = note.x;
    const startTop = note.y;
    const startRight = note.x + note.width;
    const startBottom = note.y + note.height;

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
            right = clamp(targetRight, left + config.NOTE_MIN_SIZE, left + config.NOTE_MAX_SIZE);
        }

        if (direction.includes('w')) {
            const targetLeft = pointer.x - offsetLeft;
            left = clamp(targetLeft, right - config.NOTE_MAX_SIZE, right - config.NOTE_MIN_SIZE);
        }

        if (direction.includes('s')) {
            const targetBottom = pointer.y - offsetBottom;
            bottom = clamp(targetBottom, top + config.NOTE_MIN_SIZE, top + config.NOTE_MAX_SIZE);
        }

        if (direction.includes('n')) {
            const targetTop = pointer.y - offsetTop;
            top = clamp(targetTop, bottom - config.NOTE_MAX_SIZE, bottom - config.NOTE_MIN_SIZE);
        }

        note.x = left;
        note.y = top;
        note.width = clamp(right - left, config.NOTE_MIN_SIZE, config.NOTE_MAX_SIZE);
        note.height = clamp(bottom - top, config.NOTE_MIN_SIZE, config.NOTE_MAX_SIZE);
        updateCanvasNoteVisual(noteId);
    }

    function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        queueNoteSave(noteId);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
}

export function createCanvasNoteElement(note) {
    const wrapper = document.createElement('div');
    wrapper.className = 'img-wrapper canvas-item canvas-note-item';
    wrapper.dataset.noteId = note.id;
    wrapper.style.setProperty('--note-color', normalizeNoteColor(note.color));

    const content = document.createElement('div');
    content.className = 'canvas-note-content';
    const textEl = document.createElement('div');
    textEl.className = 'canvas-note-text';
    content.appendChild(textEl);
    wrapper.appendChild(content);

    const actions = document.createElement('div');
    actions.className = 'actions-container note-actions-container';

    const editBtn = document.createElement('button');
    editBtn.className = 'action-btn note-edit-btn';
    editBtn.title = 'Edit note';
    const editIcon = document.createElement('img');
    editIcon.src = 'assets/icons/edit_note_icon.webp';
    editIcon.alt = 'Edit';
    editBtn.appendChild(editIcon);
    editBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (controllers.noteEditor) controllers.noteEditor.open(note.id);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'action-btn delete-btn';
    deleteBtn.title = 'Delete note';
    const deleteIcon = document.createElement('img');
    deleteIcon.src = 'assets/icons/delete_icon.webp';
    deleteIcon.alt = 'Delete';
    deleteBtn.appendChild(deleteIcon);
    deleteBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (controllers.noteEditor) controllers.noteEditor.openDeleteConfirm(note.id);
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    wrapper.appendChild(actions);

    const resizeDirections = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
    for (const direction of resizeDirections) {
        const handle = document.createElement('div');
        handle.className = `canvas-resize-handle canvas-resize-${direction}`;
        handle.dataset.direction = direction;
        handle.addEventListener('pointerdown', (resizeEvent) => beginCanvasNoteResize(note.id, direction, resizeEvent));
        wrapper.appendChild(handle);
    }

    wrapper.addEventListener('dblclick', () => {
        if (controllers.noteEditor) controllers.noteEditor.open(note.id);
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

        setActiveCanvasElement(wrapper);
        bringCanvasNoteToFront(note.id);

        const startPointer = canvasCoordinatesFromClient(event.clientX, event.clientY);
        const startX = note.x;
        const startY = note.y;

        function onMove(moveEvent) {
            const pointer = canvasCoordinatesFromClient(moveEvent.clientX, moveEvent.clientY);
            note.x = startX + (pointer.x - startPointer.x);
            note.y = startY + (pointer.y - startPointer.y);
            updateCanvasNoteVisual(note.id);
        }

        function onUp() {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            queueNoteSave(note.id);
        }

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    });

    maps.canvasNoteElementsById.set(note.id, wrapper);
    DOM.canvasSurface.appendChild(wrapper);

    updateCanvasNotePreview(note.id);
    // Wait, I need real canvasState for updateCanvasNoteVisual. I'll pass it properly at top level.
    updateCanvasNoteVisual(note.id);
}

export function ensureCanvasNote(noteRecord) {
    const note = {
        id: noteRecord.id,
        text: noteRecord.text || '',
        color: normalizeNoteColor(noteRecord.color),
        x: noteRecord.x,
        y: noteRecord.y,
        width: clamp(noteRecord.width ?? config.NOTE_DEFAULT_WIDTH, config.NOTE_MIN_SIZE, config.NOTE_MAX_SIZE),
        height: clamp(noteRecord.height ?? config.NOTE_DEFAULT_HEIGHT, config.NOTE_MIN_SIZE, config.NOTE_MAX_SIZE),
        zIndex: noteRecord.z_index ?? noteRecord.zIndex ?? 1,
    };

    maps.canvasNotesById.set(note.id, note);
    state.maxCanvasZ = Math.max(state.maxCanvasZ, note.zIndex);

    if (maps.canvasNoteElementsById.has(note.id)) {
        updateCanvasNotePreview(note.id);
        updateCanvasNoteVisual(note.id);
        return;
    }

    createCanvasNoteElement(note);
}

export function createCanvasNote() {
    const center = getCanvasCenterWorld();
    state.maxCanvasZ += 1;

    const note = {
        id: createNoteId(),
        text: '',
        color: config.NOTE_COLORS[0],
        x: Math.round((center.x - config.NOTE_DEFAULT_WIDTH / 2) * 10) / 10,
        y: Math.round((center.y - config.NOTE_DEFAULT_HEIGHT / 2) * 10) / 10,
        width: config.NOTE_DEFAULT_WIDTH,
        height: config.NOTE_DEFAULT_HEIGHT,
        zIndex: state.maxCanvasZ,
    };

    maps.canvasNotesById.set(note.id, note);
    createCanvasNoteElement(note);
    queueNoteSave(note.id, true);
    if (controllers.noteEditor) controllers.noteEditor.open(note.id);
}

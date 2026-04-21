import { invoke, convertFileSrc, DOM, state, maps, config, controllers } from './store.js';
import { ensureCanvasItem, getCanvasSelectionKey, removeCanvasSelectionKey } from './canvas-ops.js';

export function getImageSrc(imageRecord) {
    if (imageRecord.thumbnail_path === 'PENDING') {
        return convertFileSrc(imageRecord.file_path);
    }
    return convertFileSrc(imageRecord.thumbnail_path);
}

export function preloadImageForSwap(src) {
    return new Promise((resolve, reject) => {
        const loader = new Image();
        loader.decoding = 'async';

        const onReady = async () => {
            if (typeof loader.decode === 'function') {
                try {
                    await loader.decode();
                } catch (_) {
                    // decode() may reject even when image is renderable.
                }
            }
            resolve(true);
        };

        loader.addEventListener('load', onReady, { once: true });
        loader.addEventListener('error', () => reject(new Error('Image preload failed')), { once: true });
        loader.src = src;

        if (loader.complete && loader.naturalWidth > 0) {
            onReady();
        }
    });
}

export function swapImageSrcSeamless(img, nextSrc) {
    if (!img || !nextSrc) {
        return Promise.resolve(false);
    }

    const currentSrc = img.getAttribute('src') || '';
    if (currentSrc === nextSrc) {
        return Promise.resolve(true);
    }

    const swapToken = `${Date.now()}-${Math.random()}`;
    img.dataset.swapToken = swapToken;

    return preloadImageForSwap(nextSrc)
        .then(() => {
            if (img.dataset.swapToken !== swapToken) {
                return false;
            }
            img.src = nextSrc;
            return true;
        })
        .catch(() => {
            if (img.dataset.swapToken !== swapToken) {
                return false;
            }
            img.src = nextSrc;
            return false;
        });
}

export function updateProgressBar() {
    const statusBar = DOM.statusBar;
    const statusCount = DOM.statusCount;
    const statusFill = DOM.statusFill;

    if (!statusBar || !statusCount || !statusFill) {
        return;
    }

    const remaining = maps.pendingHashes.size;

    if (remaining > 0) {
        statusBar.classList.remove('hidden');
        statusCount.textContent = `${remaining} remaining`;

        const safeTotal = Math.max(state.batchTotal, remaining);
        const processed = safeTotal - remaining;
        const percent = safeTotal > 0 ? (processed / safeTotal) * 100 : 0;
        statusFill.style.width = `${percent}%`;
    } else {
        statusFill.style.width = '100%';
        statusCount.textContent = 'Done';

        setTimeout(() => {
            if (maps.pendingHashes.size === 0) {
                statusBar.classList.add('hidden');
                statusFill.style.width = '0%';
                state.batchTotal = 0;
            }
        }, 1000);
    }
}

export function trackPendingImage(imageRecord) {
    if (imageRecord.thumbnail_path !== 'PENDING') {
        return;
    }

    if (maps.pendingHashes.has(imageRecord.hash)) {
        return;
    }

    if (maps.pendingHashes.size === 0) {
        state.batchTotal = 0;
    }

    maps.pendingHashes.add(imageRecord.hash);
    state.batchTotal += 1;
    updateProgressBar();
}

export function resolvePendingImage(hash) {
    if (!maps.pendingHashes.has(hash)) {
        return;
    }

    maps.pendingHashes.delete(hash);
    updateProgressBar();
}

export function attachNativeFileDrag(img, getPayloadFn) {
    img.draggable = false;

    img.addEventListener('mousedown', (event) => {
        if (event.button !== 0) {
            return;
        }

        const startX = event.clientX;
        const startY = event.clientY;
        const threshold = 5;
        let dragging = false;

        function onMove(moveEvent) {
            if (dragging) {
                return;
            }
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            if (Math.abs(dx) <= threshold && Math.abs(dy) <= threshold) {
                return;
            }

            dragging = true;
            cleanup();

            const payload = getPayloadFn();
            if (!payload?.path || !payload?.hash) {
                return;
            }

            invoke('start_drag', {
                path: payload.path,
                hash: payload.hash,
            }).catch((error) => {
                console.error('Native drag failed:', error);
            });
        }

        function cleanup() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }

        function onUp() {
            cleanup();
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

export function buildActionsContainer(imageRecord, wrapper) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'action-btn delete-btn';
    deleteBtn.title = 'Delete image';
    const deleteIcon = document.createElement('img');
    deleteIcon.src = 'assets/icons/delete_icon.webp';
    deleteIcon.alt = 'Delete';
    deleteBtn.appendChild(deleteIcon);
    deleteBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        state.imageToDelete = {
            hash: imageRecord.hash,
            hashes: [imageRecord.hash],
            wrapper: wrapper,
            source: 'single'
        };
        if (DOM.confirmDialogMessage) {
            DOM.confirmDialogMessage.textContent = 'Delete this image?';
        }
        DOM.confirmDialog.classList.add('visible');
    });

    const copyBtn = document.createElement('button');
    copyBtn.className = 'action-btn copy-btn';
    copyBtn.title = 'Copy file path';
    const copyIcon = document.createElement('img');
    copyIcon.src = 'assets/icons/copy_to_clipboard_icon.webp';
    copyIcon.alt = 'Copy';
    copyBtn.appendChild(copyIcon);
    copyBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        try {
            await navigator.clipboard.writeText(imageRecord.file_path);
            copyBtn.classList.add('copied');
            setTimeout(() => copyBtn.classList.remove('copied'), 1000);
        } catch (error) {
            console.error('Failed to copy path:', error);
        }
    });

    const explorerBtn = document.createElement('button');
    explorerBtn.className = 'action-btn explorer-btn';
    explorerBtn.title = 'Open in Explorer';
    const explorerIcon = document.createElement('img');
    explorerIcon.src = 'assets/icons/open_image_explorer_icon.webp';
    explorerIcon.alt = 'Explorer';
    explorerBtn.appendChild(explorerIcon);
    explorerBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        try {
            await invoke('open_in_explorer', { path: imageRecord.file_path });
        } catch (error) {
            console.error('Failed to open in explorer:', error);
        }
    });

    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'actions-container';
    actionsContainer.appendChild(explorerBtn);
    actionsContainer.appendChild(copyBtn);
    actionsContainer.appendChild(deleteBtn);
    return actionsContainer;
}

export function createGridImageElement(imageRecord) {
    const wrapper = document.createElement('div');
    wrapper.className = 'img-wrapper';
    wrapper.dataset.hash = imageRecord.hash;
    wrapper.dataset.filePath = imageRecord.file_path;

    const img = document.createElement('img');
    img.src = getImageSrc(imageRecord);
    if (imageRecord.thumbnail_path === 'PENDING') {
        wrapper.classList.add('pending-thumbnail');
        img.style.opacity = '0.7';
    }

    attachNativeFileDrag(img, () => ({ path: imageRecord.file_path, hash: imageRecord.hash }));

    wrapper.appendChild(img);
    wrapper.appendChild(buildActionsContainer(imageRecord, wrapper));
    wrapper.addEventListener('click', () => {
        if (controllers.imageViewer) {
            controllers.imageViewer.open(imageRecord);
        }
    });

    return wrapper;
}

function upsertImageRecord(imageRecord) {
    const existing = maps.imagesByHash.get(imageRecord.hash);
    const mergedRecord = existing ? { ...existing, ...imageRecord } : imageRecord;
    maps.imagesByHash.set(mergedRecord.hash, mergedRecord);
    return mergedRecord;
}

function ensureGridImageElement(imageRecord, prepend) {
    const existingWrapper = maps.gridElementsByHash.get(imageRecord.hash);
    if (existingWrapper) {
        return existingWrapper;
    }

    DOM.placeholder.style.display = 'none';

    const gridWrapper = createGridImageElement(imageRecord);
    maps.gridElementsByHash.set(imageRecord.hash, gridWrapper);

    if (prepend) {
        const firstCard = [...DOM.gridView.querySelectorAll('.img-wrapper')][0] || DOM.loadingIndicator;
        DOM.gridView.insertBefore(gridWrapper, firstCard);
    } else {
        DOM.gridView.insertBefore(gridWrapper, DOM.loadingIndicator);
    }

    return gridWrapper;
}

function getCachedImagesSorted() {
    return [...maps.imagesByHash.values()].sort((left, right) => (right.timestamp || 0) - (left.timestamp || 0));
}

export async function initializeGridIfNeeded() {
    if (state.isGridHydrated || state.isLoading) {
        return;
    }

    state.isLoading = true;
    DOM.loadingIndicator.classList.add('visible');

    try {
        const images = await invoke('get_all_images');

        if (images.length > 0) {
            DOM.placeholder.style.display = 'none';
        }

        for (const imageRecord of images) {
            const mergedRecord = upsertImageRecord(imageRecord);
            ensureGridImageElement(mergedRecord, false);
            trackPendingImage(mergedRecord);
        }

        state.currentOffset = images.length;
        state.allImagesLoaded = true;
        state.isGridHydrated = true;
    } catch (error) {
        console.error('Error hydrating grid:', error);
    } finally {
        state.isLoading = false;
        DOM.loadingIndicator.classList.remove('visible');
    }
}

export function ensureGridSeededFromCache() {
    if (maps.gridElementsByHash.size > 0 || maps.imagesByHash.size === 0) {
        return false;
    }

    const cachedImages = getCachedImagesSorted();
    const seedCount = Math.min(config.PAGE_SIZE, cachedImages.length);

    for (let index = 0; index < seedCount; index += 1) {
        const imageRecord = cachedImages[index];
        ensureGridImageElement(imageRecord, false);
        trackPendingImage(imageRecord);
    }

    state.currentOffset = Math.max(state.currentOffset, seedCount);
    state.allImagesLoaded = seedCount >= cachedImages.length;
    return seedCount > 0;
}

export function addImageToState(imageRecord, prepend) {
    const mergedRecord = upsertImageRecord(imageRecord);
    const hadGridElement = maps.gridElementsByHash.has(mergedRecord.hash);

    ensureGridImageElement(mergedRecord, prepend);

    if (prepend && !hadGridElement) {
        state.currentOffset += 1;
    }

    if (state.canvasLayoutLoaded || state.currentMode === 'canvas') {
        ensureCanvasItem(mergedRecord);
    }
    trackPendingImage(mergedRecord);
}

export function removeImageFromUI(hash) {
    resolvePendingImage(hash);

    const gridWrapper = maps.gridElementsByHash.get(hash);
    if (gridWrapper) {
        gridWrapper.remove();
        maps.gridElementsByHash.delete(hash);
    }

    const canvasWrapper = maps.canvasElementsByHash.get(hash);
    if (canvasWrapper) {
        removeCanvasSelectionKey(getCanvasSelectionKey('image', hash));
        canvasWrapper.remove();
        maps.canvasElementsByHash.delete(hash);
    }

    maps.canvasLayoutByHash.delete(hash);
    maps.imagesByHash.delete(hash);

    if (state.activeCanvasHash === hash) {
        state.activeCanvasHash = null;
    }

    const remainingImages = DOM.gridView.querySelectorAll('.img-wrapper').length;
    if (remainingImages === 0) {
        DOM.placeholder.style.display = 'block';
    }
}

export async function loadMoreImages() {
    if (!state.isGridHydrated) {
        await initializeGridIfNeeded();
        return;
    }

    ensureGridSeededFromCache();

    if (state.isLoading || state.allImagesLoaded) {
        return;
    }

    state.isLoading = true;
    DOM.loadingIndicator.classList.add('visible');

    try {
        const images = await invoke('get_images', {
            limit: config.PAGE_SIZE,
            offset: state.currentOffset,
        });

        if (images.length > 0) {
            DOM.placeholder.style.display = 'none';
        }

        for (const imageRecord of images) {
            if (maps.gridElementsByHash.has(imageRecord.hash)) {
                continue;
            }
            addImageToState(imageRecord, false);
        }

        state.currentOffset += images.length;

        if (images.length < config.PAGE_SIZE) {
            state.allImagesLoaded = true;
        }
    } catch (error) {
        console.error('Error loading images:', error);
    } finally {
        state.isLoading = false;
        DOM.loadingIndicator.classList.remove('visible');
    }
}

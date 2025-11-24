// Offscreen Document - Main coordinator for background downloads

let storageManager = null;
let downloadManager = null;
let keepAliveInterval = null;
let manifests = new Map(); // Store manifests in memory since we can't access chrome.storage

function sendMessage(message) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
            chrome.runtime.sendMessage(message).catch((error) => {
            });
        } catch (error) {
        }
    } else {
    }
}

async function initialize() {

    // Check if chrome runtime is available
    if (typeof chrome === 'undefined' || !chrome.runtime) {
        console.error('[Offscreen] Chrome runtime not available!');
        if (typeof chrome !== 'undefined') {
        }
    }

    // Initialize managers
    storageManager = new StorageManager();

    // Use progressive download manager for new exports
    // Keep old download manager for backwards compatibility
    if (typeof ProgressiveDownloadManager !== 'undefined') {
        downloadManager = new ProgressiveDownloadManager(storageManager);
    } else {
        downloadManager = new DownloadManager(storageManager);
    }

    // Setup message listener
    if (chrome && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener(handleMessage);
    } else {
        console.error('[Offscreen] Cannot add message listener - chrome.runtime.onMessage not available');
    }

    // Keep service worker alive
    startKeepAlive();

}

async function handleMessage(request, sender, sendResponse) {

    // Ensure we're initialized before processing any requests
    if (!storageManager || !downloadManager) {
        storageManager = new StorageManager();

        // Use progressive download manager for new exports
        // Keep old download manager for backwards compatibility
        if (typeof ProgressiveDownloadManager !== 'undefined') {
            downloadManager = new ProgressiveDownloadManager(storageManager);
        } else {
            downloadManager = new DownloadManager(storageManager);
        }
    }

    // Handle the message asynchronously
    (async () => {
        try {
            switch (request.type || request.action) {
                case 'START_DOWNLOADS':
                    // Send immediate response to prevent port closing
                    sendResponse({ success: true, message: 'Downloads starting' });
                    // Handle downloads asynchronously
                    await handleStartDownloads(request);
                    break;

                case 'RESUME_DOWNLOADS':
                    sendResponse({ success: true });
                    await handleResumeDownloads(request);
                    break;

                case 'CANCEL_DOWNLOADS':
                    sendResponse({ success: true });
                    await handleCancelDownloads(request);
                    break;

                case 'CREATE_ZIP':
                    sendResponse({ success: true, message: 'Creating ZIP' });
                    await handleCreateZip(request);
                    break;

                case 'GET_MANIFEST':
                    // Get from memory since offscreen can't access chrome.storage
                    const manifest = manifests.get(request.manifestId) ||
                                   storageManager.getManifestFromMemory(request.manifestId);
                    sendResponse({ success: true, manifest });
                    break;

                case 'GET_STORAGE_INFO':
                    const info = await storageManager.getStorageInfo();
                    sendResponse({ success: true, info });
                    break;

                case 'CLEANUP_OLD':
                    await storageManager.cleanupOldDownloads();
                    sendResponse({ success: true });
                    break;

                case 'KEEP_ALIVE':
                    // Just acknowledge to keep service worker connection alive
                    sendResponse({ success: true, alive: true });
                    break;

                default:
                    sendResponse({ success: false, error: 'Unknown action' });
            }
        } catch (error) {
            console.error('[Offscreen] Error handling message:', error);
            sendResponse({ success: false, error: error.message });
        }
    })();

    return true; // Will respond asynchronously
}

async function handleStartDownloads(request) {
    const { manifestId, manifest } = request;


    try {
        // Store manifest in memory
        if (manifest) {
            manifests.set(manifestId, manifest);
        }

        // Get manifest from memory or request
        const activeManifest = manifest || manifests.get(manifestId);
        if (!activeManifest) {
            console.error(`[Offscreen] Manifest not provided or found for ID: ${manifestId}`);
            throw new Error(`Manifest not found: ${manifestId}`);
        }

        // Store manifest in storage manager's memory first
        storageManager.storeManifestInMemory(manifestId, activeManifest);

        // Initialize storage manager if needed
        if (!storageManager.initialized) {
            await storageManager.initialize();
        }

        // Estimate required space (rough estimate)
        const estimatedSize = activeManifest.playlists.reduce((total, playlist) => {
            const audioSize = (playlist.audioFiles?.length || 0) * 10 * 1024 * 1024; // 10MB avg
            const imageSize = 5 * 1024 * 1024; // 5MB for images
            return total + audioSize + imageSize;
        }, 0);


        const hasSpace = await storageManager.hasStorageSpace(estimatedSize);
        if (!hasSpace) {
            throw new Error('Insufficient storage space for download');
        }

        // Start processing - pass the manifest directly

        // Check if we're using progressive manager
        const isProgressive = downloadManager.constructor.name === 'ProgressiveDownloadManager';

        downloadManager.processManifest(manifestId, activeManifest).catch(error => {
            console.error('[Offscreen] Error processing manifest:', error);
            sendMessage({
                type: 'EXPORT_ERROR',
                manifestId: manifestId,
                error: error.message
            });
        });

        // Only send DOWNLOADS_STARTED for standard manager
        // Progressive manager sends its own PROGRESSIVE_EXPORT_STARTED message
        if (!isProgressive) {
            sendMessage({
                type: 'DOWNLOADS_STARTED',
                manifestId: manifestId,
                totalFiles: getTotalFileCount(activeManifest)
            });
        }

    } catch (error) {
        console.error('[Offscreen] Failed to start downloads:', error);
        // Send error back to service worker
        sendMessage({
            type: 'EXPORT_ERROR',
            manifestId: manifestId,
            error: error.message
        });
        throw error;
    }
}

async function handleResumeDownloads(request) {
    const { manifestId } = request;


    try {
        await downloadManager.resumeManifest(manifestId);

        sendMessage({
            type: 'DOWNLOADS_RESUMED',
            manifestId: manifestId
        });
    } catch (error) {
        console.error('[Offscreen] Failed to resume downloads:', error);
        throw error;
    }
}

async function handleCancelDownloads(request) {
    const { manifestId } = request;


    try {
        // Cancel active downloads
        await downloadManager.cancelDownloads();

        // Update manifest status
        if (manifestId) {
            await storageManager.updateManifest(manifestId, {
                status: 'cancelled',
                cancelledAt: Date.now()
            });
        }

        sendMessage({
            type: 'DOWNLOADS_CANCELLED',
            manifestId: manifestId
        });
    } catch (error) {
        console.error('[Offscreen] Failed to cancel downloads:', error);
        throw error;
    }
}

async function handleCreateZip(request) {
    const { manifestId, playlistIds, manifest } = request;


    try {
        // Store manifest if provided (from service worker)
        if (manifest) {
            manifests.set(manifestId, manifest);
            storageManager.storeManifestInMemory(manifestId, manifest);
        }

        // Make sure the manifest is in storage manager's memory
        const activeManifest = manifest || manifests.get(manifestId);
        if (!activeManifest) {
            console.error(`[Offscreen] No manifest found for ID: ${manifestId}`);
            throw new Error(`Manifest not found: ${manifestId}`);
        }

        if (activeManifest && !manifest) {
            storageManager.storeManifestInMemory(manifestId, activeManifest);
        }


        // Pass in-memory files from downloadManager if available
        const inMemoryFiles = downloadManager ? downloadManager.inMemoryFiles : null;

        const blob = await storageManager.createZipFromManifest(manifestId, playlistIds, inMemoryFiles);

        if (!blob) {
            throw new Error('Failed to create ZIP blob - no blob returned');
        }

        const blobSizeMB = blob.size / 1024 / 1024;

        if (blob.size === 0) {
            console.error('[Offscreen] ZIP blob is empty!');
            throw new Error('Created ZIP file is empty');
        }

        // Generate filename with UTC date and timestamp in format: yoto-yyyy-mm-dd-timestamp.zip
        const now = new Date();
        const year = now.getUTCFullYear();
        const month = String(now.getUTCMonth() + 1).padStart(2, '0');
        const day = String(now.getUTCDate()).padStart(2, '0');
        const hours = String(now.getUTCHours()).padStart(2, '0');
        const minutes = String(now.getUTCMinutes()).padStart(2, '0');
        const seconds = String(now.getUTCSeconds()).padStart(2, '0');

        const filename = `yoto-${year}-${month}-${day}-${hours}${minutes}${seconds}.zip`;


        // Create a blob URL that can be accessed for download
        const blobUrl = URL.createObjectURL(blob);

        // For Chrome extensions, we need to handle the download differently
        // Option 1: Try using chrome.downloads API if available in offscreen
        if (typeof chrome !== 'undefined' && chrome.downloads) {
            try {
                const downloadId = await chrome.downloads.download({
                    url: blobUrl,
                    filename: filename,
                    saveAs: false,
                    conflictAction: 'uniquify'
                });

                // Notify service worker of successful download
                sendMessage({
                    type: 'ZIP_DOWNLOADED',
                    manifestId: manifestId,
                    filename: filename,
                    size: blob.size
                });

                // Clean up blob URL after a delay
                setTimeout(() => {
                    URL.revokeObjectURL(blobUrl);
                }, 10000);

                return blob;
            } catch (error) {
            }
        }

        // Option 2: Send blob URL to service worker for download

        // Keep the blob URL alive for download
        const blobUrls = window.blobUrls || new Map();
        blobUrls.set(manifestId, blobUrl);
        window.blobUrls = blobUrls;

        // Send blob URL to service worker
        sendMessage({
            type: 'DOWNLOAD_ZIP_BLOB_URL',
            manifestId: manifestId,
            filename: filename,
            blobUrl: blobUrl,
            size: blob.size
        });


        // Clean up blob URL after 60 seconds
        setTimeout(() => {
            if (blobUrls.has(manifestId)) {
                URL.revokeObjectURL(blobUrls.get(manifestId));
                blobUrls.delete(manifestId);
            }
        }, 60000);

        return blob;
    } catch (error) {
        console.error('[Offscreen] Failed to create ZIP:', error);
        console.error('[Offscreen] Error stack:', error.stack);

        // Send error message to service worker
        sendMessage({
            type: 'ZIP_CREATION_ERROR',
            manifestId: manifestId,
            error: error.message
        });

        throw error;
    }
}

function getTotalFileCount(manifest) {
    return manifest.playlists.reduce((total, playlist) => {
        const audioCount = playlist.audioFiles?.length || 0;
        const coverCount = playlist.coverImage ? 1 : 0;
        const iconCount = playlist.iconImages?.length || 0;
        return total + audioCount + coverCount + iconCount;
    }, 0);
}

function startKeepAlive() {
    // Send keepalive message every 20 seconds
    keepAliveInterval = setInterval(() => {
        sendMessage({ type: 'KEEP_ALIVE' });
    }, 20000);
}

// Cleanup on unload
window.addEventListener('unload', () => {
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
    }
});

// Initialize on load
initialize().catch(error => {
    console.error('[Offscreen] Failed to initialize:', error);
});

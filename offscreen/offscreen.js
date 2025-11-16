/**
 * Offscreen Document - Main coordinator for background downloads
 */

let storageManager = null;
let downloadManager = null;
let keepAliveInterval = null;
let manifests = new Map(); // Store manifests in memory since we can't access chrome.storage

/**
 * Safe message sender that checks if chrome.runtime is available
 */
function sendMessage(message) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
            chrome.runtime.sendMessage(message).catch((error) => {
                console.warn('[Offscreen] Failed to send message:', message.type, error);
            });
        } catch (error) {
            console.warn('[Offscreen] Error sending message:', message.type, error);
        }
    } else {
        console.warn('[Offscreen] Cannot send message - chrome.runtime not available:', message.type);
    }
}

/**
 * Initialize the offscreen document
 */
async function initialize() {
    console.log('[Offscreen] Initializing background downloader');

    // Check if chrome runtime is available
    if (typeof chrome === 'undefined' || !chrome.runtime) {
        console.error('[Offscreen] Chrome runtime not available!');
        console.log('[Offscreen] typeof chrome:', typeof chrome);
        if (typeof chrome !== 'undefined') {
            console.log('[Offscreen] chrome.runtime:', chrome.runtime);
        }
    }

    // Initialize managers
    storageManager = new StorageManager();
    downloadManager = new DownloadManager(storageManager);

    // Setup message listener
    if (chrome && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener(handleMessage);
    } else {
        console.error('[Offscreen] Cannot add message listener - chrome.runtime.onMessage not available');
    }

    // Keep service worker alive
    startKeepAlive();

    console.log('[Offscreen] Initialization complete');
}

/**
 * Handle messages from service worker and content scripts
 */
async function handleMessage(request, sender, sendResponse) {
    console.log('[Offscreen] Received message:', request.type || request.action);

    // Ensure we're initialized before processing any requests
    if (!storageManager || !downloadManager) {
        console.warn('[Offscreen] Managers not initialized yet, initializing now');
        storageManager = new StorageManager();
        downloadManager = new DownloadManager(storageManager);
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
                    console.log('[Offscreen] Received CREATE_ZIP message with manifestId:', request.manifestId);
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

/**
 * Start downloads for a manifest
 */
async function handleStartDownloads(request) {
    const { manifestId, manifest } = request;

    console.log(`[Offscreen] Starting downloads for manifest: ${manifestId}`);

    try {
        // Store manifest in memory
        if (manifest) {
            manifests.set(manifestId, manifest);
            console.log(`[Offscreen] Stored manifest in memory for ID: ${manifestId}`);
        }

        // Get manifest from memory or request
        const activeManifest = manifest || manifests.get(manifestId);
        if (!activeManifest) {
            console.error(`[Offscreen] Manifest not provided or found for ID: ${manifestId}`);
            throw new Error(`Manifest not found: ${manifestId}`);
        }

        // Store manifest in storage manager's memory first
        console.log('[Offscreen] Storing manifest in StorageManager memory');
        storageManager.storeManifestInMemory(manifestId, activeManifest);

        // Initialize storage manager if needed
        if (!storageManager.initialized) {
            console.log('[Offscreen] Initializing storage manager');
            await storageManager.initialize();
        }

        console.log(`[Offscreen] Found manifest with ${activeManifest.playlists?.length || 0} playlists`);
        console.log('[Offscreen] Manifest structure:', {
            id: activeManifest.id,
            status: activeManifest.status,
            playlistCount: activeManifest.playlists?.length,
            fileCount: Object.keys(activeManifest.files || {}).length
        });

        // Estimate required space (rough estimate)
        const estimatedSize = activeManifest.playlists.reduce((total, playlist) => {
            const audioSize = (playlist.audioFiles?.length || 0) * 10 * 1024 * 1024; // 10MB avg
            const imageSize = 5 * 1024 * 1024; // 5MB for images
            return total + audioSize + imageSize;
        }, 0);

        console.log(`[Offscreen] Estimated download size: ${(estimatedSize / 1024 / 1024).toFixed(2)} MB`);

        const hasSpace = await storageManager.hasStorageSpace(estimatedSize);
        if (!hasSpace) {
            throw new Error('Insufficient storage space for download');
        }

        // Start processing - pass the manifest directly
        console.log('[Offscreen] Starting download manager processing');
        console.log('[Offscreen] First playlist in manifest:', activeManifest.playlists?.[0]);

        downloadManager.processManifest(manifestId, activeManifest).catch(error => {
            console.error('[Offscreen] Error processing manifest:', error);
            sendMessage({
                type: 'EXPORT_ERROR',
                manifestId: manifestId,
                error: error.message
            });
        });

        // Notify that downloads have started
        sendMessage({
            type: 'DOWNLOADS_STARTED',
            manifestId: manifestId,
            totalFiles: getTotalFileCount(activeManifest)
        });

        console.log('[Offscreen] Downloads initiated successfully');
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

/**
 * Resume downloads for a manifest
 */
async function handleResumeDownloads(request) {
    const { manifestId } = request;

    console.log(`[Offscreen] Resuming downloads for manifest: ${manifestId}`);

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

/**
 * Cancel ongoing downloads
 */
async function handleCancelDownloads(request) {
    const { manifestId } = request;

    console.log(`[Offscreen] Cancelling downloads for manifest: ${manifestId}`);

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

/**
 * Create ZIP file from downloaded files
 */
async function handleCreateZip(request) {
    const { manifestId, playlistIds, manifest } = request;

    console.log(`[Offscreen] Creating ZIP for manifest: ${manifestId}`);
    console.log(`[Offscreen] Playlist IDs: ${playlistIds ? playlistIds.join(', ') : 'all playlists'}`);

    try {
        // Store manifest if provided (from service worker)
        if (manifest) {
            console.log('[Offscreen] Storing manifest from service worker');
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
            console.log('[Offscreen] Using existing manifest from memory');
            storageManager.storeManifestInMemory(manifestId, activeManifest);
        }

        console.log(`[Offscreen] Manifest has ${activeManifest.playlists?.length || 0} playlists`);

        // Pass in-memory files from downloadManager if available
        const inMemoryFiles = downloadManager ? downloadManager.inMemoryFiles : null;
        console.log(`[Offscreen] In-memory files available: ${inMemoryFiles ? inMemoryFiles.size : 0} files`);

        console.log('[Offscreen] Creating ZIP from manifest...');
        const blob = await storageManager.createZipFromManifest(manifestId, playlistIds, inMemoryFiles);

        if (!blob) {
            throw new Error('Failed to create ZIP blob - no blob returned');
        }

        const blobSizeMB = blob.size / 1024 / 1024;
        console.log(`[Offscreen] ZIP blob created successfully, size: ${blob.size} bytes (${blobSizeMB.toFixed(2)} MB)`);

        if (blob.size === 0) {
            console.error('[Offscreen] ZIP blob is empty!');
            throw new Error('Created ZIP file is empty');
        }

        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = playlistIds?.length === 1
            ? `yoto-export-${playlistIds[0]}-${timestamp}.zip`
            : `yoto-export-${timestamp}.zip`;

        console.log(`[Offscreen] Generated filename: ${filename}`);

        // Create a blob URL that can be accessed for download
        const blobUrl = URL.createObjectURL(blob);
        console.log(`[Offscreen] Created blob URL: ${blobUrl}`);
        console.log(`[Offscreen] ZIP size: ${blob.size} bytes (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);

        // For Chrome extensions, we need to handle the download differently
        // Option 1: Try using chrome.downloads API if available in offscreen
        if (typeof chrome !== 'undefined' && chrome.downloads) {
            console.log('[Offscreen] Using chrome.downloads API directly from offscreen');
            try {
                const downloadId = await chrome.downloads.download({
                    url: blobUrl,
                    filename: filename,
                    saveAs: false,
                    conflictAction: 'uniquify'
                });
                console.log(`[Offscreen] Download initiated with ID: ${downloadId}`);

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
                    console.log('[Offscreen] Blob URL cleaned up');
                }, 10000);

                return blob;
            } catch (error) {
                console.log('[Offscreen] chrome.downloads not available, falling back to alternative method');
            }
        }

        // Option 2: Send blob URL to service worker for download
        console.log('[Offscreen] Sending blob URL to service worker for download...');

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

        console.log('[Offscreen] Sent blob URL to service worker for download');

        // Clean up blob URL after 60 seconds
        setTimeout(() => {
            if (blobUrls.has(manifestId)) {
                URL.revokeObjectURL(blobUrls.get(manifestId));
                blobUrls.delete(manifestId);
                console.log('[Offscreen] Blob URL cleaned up for manifest:', manifestId);
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

/**
 * Get total file count from manifest
 */
function getTotalFileCount(manifest) {
    return manifest.playlists.reduce((total, playlist) => {
        const audioCount = playlist.audioFiles?.length || 0;
        const coverCount = playlist.coverImage ? 1 : 0;
        const iconCount = playlist.iconImages?.length || 0;
        return total + audioCount + coverCount + iconCount;
    }, 0);
}

/**
 * Keep service worker alive
 */
function startKeepAlive() {
    // Send keepalive message every 20 seconds
    keepAliveInterval = setInterval(() => {
        sendMessage({ type: 'KEEP_ALIVE' });
    }, 20000);
}

/**
 * Cleanup on unload
 */
window.addEventListener('unload', () => {
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
    }
});

// Initialize on load
initialize().catch(error => {
    console.error('[Offscreen] Failed to initialize:', error);
});
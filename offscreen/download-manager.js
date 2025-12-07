/**
 * Download Manager - Handles file downloads with retry, streaming, and concurrency control
 */

/**
 * Safe message sender that checks if chrome.runtime is available
 */
function sendMessage(message) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
            chrome.runtime.sendMessage(message).catch((error) => {
                console.warn('[DownloadManager] Failed to send message:', message.type, error);
            });
        } catch (error) {
            console.warn('[DownloadManager] Error sending message:', message.type, error);
        }
    }
}

function sanitizeFolderName(name) {
    return name
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);
}

class DownloadManager {
    constructor(storageManager) {
        this.storageManager = storageManager;
        this.downloadQueue = [];
        this.activeDownloads = new Map();
        this.failedDownloads = new Map();
        this.maxConcurrent = 6; // Optimal for most browsers
        this.maxRetries = 3;
        this.retryDelay = 1000; // Base delay for exponential backoff
        this.largeFileThreshold = 10 * 1024 * 1024; // 10MB
        this.cancelled = false; // Track cancellation state
        this.abortControllers = new Map(); // Track abort controllers for cancellation
    }

    /**
     * Start processing downloads for a manifest
     */
    async processManifest(manifestId, manifest) {
        console.log(`[DownloadManager] Processing manifest: ${manifestId}`);

        // Reset cancellation flag
        this.cancelled = false;
        this.abortControllers.clear();

        // Accept manifest passed directly since offscreen can't access chrome.storage
        if (!manifest) {
            // Try to get from storage manager's memory cache
            manifest = this.storageManager.getManifestFromMemory(manifestId);
            if (!manifest) {
                console.error(`[DownloadManager] Manifest not found for ID: ${manifestId}`);
                throw new Error(`Manifest not found: ${manifestId}`);
            }
        }

        console.log(`[DownloadManager] Found manifest with ${manifest.playlists?.length} playlists`);

        // Store manifest in memory for future reference
        this.storageManager.storeManifestInMemory(manifestId, manifest);

        // Update manifest status in memory
        manifest.status = 'downloading';
        manifest.startedAt = Date.now();

        // Build download queue
        console.log('[DownloadManager] Building download queue...');
        this.buildDownloadQueue(manifest, manifestId);
        console.log(`[DownloadManager] Queue built with ${this.downloadQueue.length} files`);

        // Start processing queue
        console.log('[DownloadManager] Starting queue processing...');
        await this.processQueue(manifestId);

        // Check if all downloads completed successfully
        const finalManifest = this.storageManager.getManifestFromMemory(manifestId) || manifest;
        const allCompleted = Object.values(finalManifest.files || {})
            .every(f => f.stored || f.failed);

        if (allCompleted) {
            await this.storageManager.updateManifest(manifestId, {
                status: 'completed',
                completedAt: Date.now()
            });

            // Notify completion
            sendMessage({
                type: 'EXPORT_COMPLETED',
                manifestId: manifestId,
                stats: this.getDownloadStats(finalManifest)
            });
        }
    }

    /**
     * Build download queue from manifest
     */
    buildDownloadQueue(manifest, manifestId) {
        this.downloadQueue = [];

        console.log(`[DownloadManager] Building queue for ${manifest.playlists?.length || 0} playlists`);

        for (const playlist of manifest.playlists) {
            console.log(`[DownloadManager] Processing playlist: ${playlist.title} (${playlist.id})`);
            console.log(`[DownloadManager] - Audio files: ${playlist.audioFiles?.length || 0}`);
            console.log(`[DownloadManager] - Cover image: ${!!playlist.coverImage}`);
            console.log(`[DownloadManager] - Icon images: ${playlist.iconImages?.length || 0}`);

            // Log first audio file for debugging
            if (playlist.audioFiles && playlist.audioFiles.length > 0) {
                console.log(`[DownloadManager] First audio file:`, playlist.audioFiles[0]);
            }

            // Add audio files
            if (playlist.audioFiles) {
                for (const audio of playlist.audioFiles) {
                    console.log(`[DownloadManager] Adding audio file to queue: ${audio.filename} (${audio.url})`);
                    this.downloadQueue.push({
                        id: audio.id || crypto.randomUUID(),
                        url: audio.url,
                        filename: audio.filename,
                        type: 'audio',
                        playlistId: playlist.id,
                        playlistTitle: playlist.title,
                        manifestId: manifestId,
                        size: audio.size,
                        priority: 1 // Audio files have higher priority
                    });
                }
            }

            // Add cover image
            if (playlist.coverImage) {
                let extension = 'jpg';
                if (playlist.coverImage.filename) {
                    const parts = playlist.coverImage.filename.split('.');
                    extension = parts.length > 1 ? parts[parts.length - 1] : 'jpg';
                } else if (playlist.coverImage.url) {
                    const urlParts = playlist.coverImage.url.split('.');
                    extension = urlParts.length > 1 ? urlParts[urlParts.length - 1].split('?')[0] : 'jpg';
                }

                const sanitizedTitle = sanitizeFolderName(playlist.title || 'playlist');
                const coverFilename = playlist.coverImage.filename || `${sanitizedTitle}-cover.${extension}`;

                this.downloadQueue.push({
                    id: playlist.coverImage.id || `cover_${playlist.id}`,
                    url: playlist.coverImage.url,
                    filename: coverFilename,
                    type: 'cover',
                    playlistId: playlist.id,
                    playlistTitle: playlist.title,
                    manifestId: manifestId,
                    size: playlist.coverImage.size,
                    priority: 2
                });
            }

            // Add icon images
            if (playlist.iconImages) {
                for (const icon of playlist.iconImages) {
                    this.downloadQueue.push({
                        id: icon.id || crypto.randomUUID(),
                        url: icon.url,
                        filename: icon.filename,
                        type: 'icon',
                        playlistId: playlist.id,
                        playlistTitle: playlist.title,
                        manifestId: manifestId,
                        size: icon.size,
                        priority: 3
                    });
                }
            }
        }

        // Sort by priority (lower number = higher priority)
        this.downloadQueue.sort((a, b) => a.priority - b.priority);

        console.log(`[DownloadManager] Queue built with ${this.downloadQueue.length} files`);
    }

    /**
     * Process the download queue with concurrency control
     */
    async processQueue(manifestId) {
        const promises = [];

        while ((this.downloadQueue.length > 0 || this.activeDownloads.size > 0) && !this.cancelled) {
            // Check if cancelled
            if (this.cancelled) {
                console.log('[DownloadManager] Download queue cancelled');
                break;
            }

            // Fill up to max concurrent downloads
            while (this.activeDownloads.size < this.maxConcurrent && this.downloadQueue.length > 0 && !this.cancelled) {
                const fileInfo = this.downloadQueue.shift();
                const downloadPromise = this.downloadFile(fileInfo);

                this.activeDownloads.set(fileInfo.id, downloadPromise);

                // Remove from active when done
                downloadPromise.finally(() => {
                    this.activeDownloads.delete(fileInfo.id);
                    this.abortControllers.delete(fileInfo.id);
                });

                promises.push(downloadPromise);
            }

            // Wait for at least one download to complete
            if (this.activeDownloads.size > 0 && !this.cancelled) {
                await Promise.race(Array.from(this.activeDownloads.values()));
            }
        }

        // Wait for all remaining downloads
        await Promise.allSettled(promises);

        // Process any failed downloads with retry
        if (this.failedDownloads.size > 0) {
            console.log(`[DownloadManager] Processing ${this.failedDownloads.size} failed downloads`);
            await this.retryFailedDownloads(manifestId);
        }
    }

    /**
     * Download a single file with retry logic
     */
    async downloadFile(fileInfo, retryCount = 0) {
        console.log(`[DownloadManager] Downloading: ${fileInfo.filename} (${fileInfo.type})`);

        // Check if cancelled
        if (this.cancelled) {
            console.log(`[DownloadManager] Download cancelled: ${fileInfo.filename}`);
            return false;
        }

        try {
            // Check if file already exists
            const manifest = this.storageManager.getManifestFromMemory(fileInfo.manifestId);
            if (manifest && manifest.files?.[fileInfo.id]?.stored) {
                console.log(`[DownloadManager] File already downloaded: ${fileInfo.filename}`);
                return true;
            }

            // Create abort controller for this download
            const abortController = new AbortController();
            this.abortControllers.set(fileInfo.id, abortController);

            // Report download start
            sendMessage({
                type: 'DOWNLOAD_STARTED',
                manifestId: fileInfo.manifestId,
                fileId: fileInfo.id,
                filename: fileInfo.filename,
                playlistTitle: fileInfo.playlistTitle
            });

            // Determine if we should use streaming based on file size
            const shouldStream = fileInfo.size && fileInfo.size > this.largeFileThreshold;

            if (shouldStream) {
                await this.downloadLargeFile(fileInfo, abortController.signal);
            } else {
                await this.downloadSmallFile(fileInfo, abortController.signal);
            }

            // Report success
            sendMessage({
                type: 'DOWNLOAD_COMPLETED',
                manifestId: fileInfo.manifestId,
                fileId: fileInfo.id,
                filename: fileInfo.filename
            });

            return true;
        } catch (error) {
            // Check if error is due to cancellation
            if (error.name === 'AbortError' || this.cancelled) {
                console.log(`[DownloadManager] Download aborted: ${fileInfo.filename}`);
                return false;
            }

            console.error(`[DownloadManager] Download failed: ${fileInfo.filename}`, error);

            if (retryCount < this.maxRetries && !this.cancelled) {
                // Exponential backoff
                const delay = this.retryDelay * Math.pow(2, retryCount);
                console.log(`[DownloadManager] Retrying in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);

                await new Promise(resolve => setTimeout(resolve, delay));
                return this.downloadFile(fileInfo, retryCount + 1);
            } else if (!this.cancelled) {
                // Mark as failed only if not cancelled
                await this.storageManager.updateManifest(fileInfo.manifestId, {
                    files: {
                        [fileInfo.id]: {
                            failed: true,
                            error: error.message,
                            failedAt: Date.now()
                        }
                    }
                });

                // Track failed download
                this.failedDownloads.set(fileInfo.id, fileInfo);

                // Report failure
                sendMessage({
                    type: 'DOWNLOAD_FAILED',
                    manifestId: fileInfo.manifestId,
                    fileId: fileInfo.id,
                    filename: fileInfo.filename,
                    error: error.message
                });

                return false;
            }

            return false;
        }
    }

    /**
     * Download small file (load entirely into memory)
     */
    async downloadSmallFile(fileInfo, signal) {
        console.log(`[DownloadManager] Fetching small file from: ${fileInfo.url}`);

        try {
            // Try direct fetch first
            let response;
            try {
                response = await fetch(fileInfo.url, {
                    method: 'GET',
                    headers: {
                        'Accept': '*/*'
                    },
                    signal: signal
                });
            } catch (fetchError) {
                // If direct fetch fails (likely CORS), proxy through service worker
                console.log(`[DownloadManager] Direct fetch failed (${fetchError.message}), proxying through service worker`);
                console.log(`[DownloadManager] Attempting proxy for URL: ${fileInfo.url}`);

                const proxyResponse = await chrome.runtime.sendMessage({
                    type: 'PROXY_DOWNLOAD',
                    fileId: fileInfo.id,
                    url: fileInfo.url,
                    filename: fileInfo.filename
                });

                if (!proxyResponse || !proxyResponse.success) {
                    throw new Error(proxyResponse?.error || 'Proxy download failed');
                }

                // Convert base64 to ArrayBuffer
                const base64 = proxyResponse.data;
                const binaryString = atob(base64);
                const buffer = new ArrayBuffer(binaryString.length);
                const view = new Uint8Array(buffer);
                for (let i = 0; i < binaryString.length; i++) {
                    view[i] = binaryString.charCodeAt(i);
                }

                console.log(`[DownloadManager] Downloaded ${(buffer.byteLength / 1024).toFixed(2)} KB for ${fileInfo.filename} via proxy`);

                // Try to save to storage, but continue even if it fails
                try {
                    await this.storageManager.saveFileFromBuffer(buffer, fileInfo, fileInfo.manifestId);
                    console.log(`[DownloadManager] Saved ${fileInfo.filename} to storage`);
                } catch (storageError) {
                    console.warn(`[DownloadManager] Failed to save ${fileInfo.filename} to OPFS, keeping in memory`, storageError.message);

                    // Store in memory as fallback
                    if (!this.inMemoryFiles) {
                        this.inMemoryFiles = new Map();
                    }
                    this.inMemoryFiles.set(fileInfo.id, {
                        buffer: buffer,
                        fileInfo: fileInfo
                    });

                    // Update manifest to indicate file is downloaded (even if not in OPFS)
                    await this.storageManager.updateManifest(fileInfo.manifestId, {
                        files: {
                            [fileInfo.id]: {
                                stored: true, // Mark as stored even if only in memory
                                inMemoryOnly: true,
                                path: `memory/${fileInfo.id}`,
                                size: buffer.byteLength,
                                completedAt: Date.now()
                            }
                        }
                    });
                }
                return;
            }

            if (!response.ok) {
                console.error(`[DownloadManager] HTTP error for ${fileInfo.url}:`, response.status, response.statusText);
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const buffer = await response.arrayBuffer();
            console.log(`[DownloadManager] Downloaded ${(buffer.byteLength / 1024).toFixed(2)} KB for ${fileInfo.filename}`);

            // Try to save to storage, but continue even if it fails
            try {
                await this.storageManager.saveFileFromBuffer(buffer, fileInfo, fileInfo.manifestId);
                console.log(`[DownloadManager] Saved ${fileInfo.filename} to storage`);
            } catch (storageError) {
                console.warn(`[DownloadManager] Failed to save ${fileInfo.filename} to OPFS, keeping in memory`, storageError.message);

                // Store in memory as fallback
                if (!this.inMemoryFiles) {
                    this.inMemoryFiles = new Map();
                }
                this.inMemoryFiles.set(fileInfo.id, {
                    buffer: buffer,
                    fileInfo: fileInfo
                });

                // Update manifest to indicate file is downloaded (even if not in OPFS)
                await this.storageManager.updateManifest(fileInfo.manifestId, {
                    files: {
                        [fileInfo.id]: {
                            stored: true, // Mark as stored even if only in memory
                            inMemoryOnly: true,
                            path: `memory/${fileInfo.id}`,
                            size: buffer.byteLength,
                            completedAt: Date.now()
                        }
                    }
                });
            }
        } catch (error) {
            // Enhanced error logging
            let errorInfo = {
                filename: fileInfo.filename,
                url: fileInfo.url,
                type: fileInfo.type,
                playlistId: fileInfo.playlistId,
                errorName: error.name || 'Unknown',
                errorMessage: error.message || 'No message',
                errorStack: error.stack
            };

            // Check if this is a storage error
            if (error.message && error.message.includes('StorageManager')) {
                errorInfo.isStorageError = true;
                console.error(`[DownloadManager] Storage save failed for ${fileInfo.filename}`);
            }

            // Check for DOMException
            if (error instanceof DOMException || error.name?.includes('Error')) {
                errorInfo.isDOMException = error instanceof DOMException;
                errorInfo.domExceptionType = error.name;

                // Add context for common OPFS errors
                if (error.name === 'NotAllowedError') {
                    errorInfo.context = 'OPFS access denied - may need to check browser permissions or context';
                } else if (error.name === 'QuotaExceededError') {
                    errorInfo.context = 'Storage quota exceeded - need more space';
                } else if (error.name === 'InvalidStateError') {
                    errorInfo.context = 'File system in invalid state - may need to reinitialize';
                }
            }

            console.error(`[DownloadManager] Failed to download ${fileInfo.filename}:`, error.toString());
            console.error(`[DownloadManager] Error details:`, JSON.stringify(errorInfo, null, 2));

            throw error;
        }
    }

    /**
     * Download large file with streaming and progress reporting
     */
    async downloadLargeFile(fileInfo, signal) {
        const response = await fetch(fileInfo.url, {
            method: 'GET',
            headers: {
                'Accept': '*/*'
            },
            signal: signal
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentLength = response.headers.get('content-length');
        const totalSize = contentLength ? parseInt(contentLength) : fileInfo.size || 0;

        const reader = response.body.getReader();
        let receivedBytes = 0;
        let lastProgressReport = Date.now();

        // Create a transform stream for progress reporting
        const transformStream = new TransformStream({
            async transform(chunk, controller) {
                receivedBytes += chunk.length;

                // Report progress every 500ms or every 10%
                const now = Date.now();
                const progressPercentage = totalSize ? (receivedBytes / totalSize) * 100 : 0;

                if (now - lastProgressReport > 500 || progressPercentage % 10 === 0) {
                    sendMessage({
                        type: 'DOWNLOAD_PROGRESS',
                        manifestId: fileInfo.manifestId,
                        fileId: fileInfo.id,
                        filename: fileInfo.filename,
                        progress: progressPercentage,
                        received: receivedBytes,
                        total: totalSize
                    });
                    lastProgressReport = now;
                }

                controller.enqueue(chunk);
            }
        });

        // Create the stream pipeline
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) {
                            controller.close();
                            break;
                        }
                        controller.enqueue(value);
                    }
                } catch (error) {
                    controller.error(error);
                }
            }
        }).pipeThrough(transformStream);

        // Save the stream to storage
        await this.storageManager.saveFile(stream, fileInfo, fileInfo.manifestId);
    }

    /**
     * Retry failed downloads with fresh attempts
     */
    async retryFailedDownloads(manifestId) {
        if (this.failedDownloads.size === 0) return;

        console.log(`[DownloadManager] Retrying ${this.failedDownloads.size} failed downloads`);

        const failedFiles = Array.from(this.failedDownloads.values());
        this.failedDownloads.clear();

        for (const fileInfo of failedFiles) {
            await this.downloadFile(fileInfo);
        }
    }

    /**
     * Cancel all active downloads
     */
    async cancelDownloads() {
        console.log('[DownloadManager] Cancelling all downloads');

        // Set cancelled flag
        this.cancelled = true;

        // Clear the queue
        this.downloadQueue = [];

        // Abort all active downloads
        for (const [id, controller] of this.abortControllers) {
            console.log(`[DownloadManager] Aborting download: ${id}`);
            controller.abort();
        }
        this.abortControllers.clear();

        // Clear active downloads
        this.activeDownloads.clear();

        // Clear failed downloads
        this.failedDownloads.clear();
    }

    /**
     * Get download statistics
     */
    getDownloadStats(manifest) {
        const files = Object.values(manifest.files || {});
        return {
            total: files.length,
            completed: files.filter(f => f.stored).length,
            failed: files.filter(f => f.failed).length,
            pending: files.filter(f => !f.stored && !f.failed).length
        };
    }

    /**
     * Resume a partially completed manifest
     */
    async resumeManifest(manifestId) {
        const manifest = await this.storageManager.getManifest(manifestId);
        if (!manifest) {
            throw new Error(`Manifest not found: ${manifestId}`);
        }

        // Rebuild queue with only incomplete files
        this.downloadQueue = [];

        for (const playlist of manifest.playlists) {
            const allFiles = [
                ...(playlist.audioFiles || []),
                playlist.coverImage ? [playlist.coverImage] : [],
                ...(playlist.iconImages || [])
            ].flat();

            for (const file of allFiles) {
                const fileId = file.id || crypto.randomUUID();
                const fileStatus = manifest.files?.[fileId];

                // Skip already downloaded files
                if (fileStatus?.stored) continue;

                this.downloadQueue.push({
                    ...file,
                    id: fileId,
                    playlistId: playlist.id,
                    playlistTitle: playlist.title,
                    manifestId: manifestId
                });
            }
        }

        console.log(`[DownloadManager] Resuming with ${this.downloadQueue.length} remaining files`);

        // Update manifest status
        await this.storageManager.updateManifest(manifestId, {
            status: 'resuming',
            resumedAt: Date.now()
        });

        // Process the queue
        await this.processQueue(manifestId);
    }
}
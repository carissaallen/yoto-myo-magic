// Progressive Download Manager - Downloads and creates ZIPs per playlist

function sendMessage(message) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
            chrome.runtime.sendMessage(message).catch((error) => {
            });
        } catch (error) {
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

class ProgressiveDownloadManager {
    constructor(storageManager) {
        this.storageManager = storageManager;
        this.activeDownloads = new Map();
        this.maxConcurrent = 6; // Optimal for most browsers
        this.maxRetries = 3;
        this.retryDelay = 1000; // Base delay for exponential backoff
        this.largeFileThreshold = 10 * 1024 * 1024; // 10MB
        this.cancelled = false; // Track cancellation state
        this.abortControllers = new Map(); // Track abort controllers for cancellation
        this.inMemoryFiles = new Map(); // Store files in memory as fallback
        this.failedPlaylists = []; // Track playlists that failed
        this.completedPlaylists = []; // Track successfully exported playlists
    }

    async processManifest(manifestId, manifest) {

        // Reset state
        this.cancelled = false;
        this.abortControllers.clear();
        this.failedPlaylists = [];
        this.completedPlaylists = [];

        if (!manifest) {
            manifest = this.storageManager.getManifestFromMemory(manifestId);
            if (!manifest) {
                console.error(`[ProgressiveDownloadManager] Manifest not found for ID: ${manifestId}`);
                throw new Error(`Manifest not found: ${manifestId}`);
            }
        }


        // Store manifest in memory
        this.storageManager.storeManifestInMemory(manifestId, manifest);

        // Update manifest status
        manifest.status = 'downloading';
        manifest.startedAt = Date.now();

        // Notify start
        sendMessage({
            type: 'PROGRESSIVE_EXPORT_STARTED',
            manifestId: manifestId,
            totalPlaylists: manifest.playlists.length
        });

        // Process each playlist individually
        for (let i = 0; i < manifest.playlists.length; i++) {
            if (this.cancelled) {
                break;
            }

            const playlist = manifest.playlists[i];

            // Notify playlist start
            sendMessage({
                type: 'PLAYLIST_EXPORT_STARTED',
                manifestId: manifestId,
                playlistIndex: i + 1,
                totalPlaylists: manifest.playlists.length,
                playlistTitle: playlist.title
            });

            // Process this playlist with timeout
            try {

                // Add a timeout to prevent hanging forever (5 minutes per playlist)
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Playlist processing timeout after 5 minutes')), 5 * 60 * 1000)
                );

                const processPromise = this.processPlaylist(playlist, manifestId, manifest);
                const success = await Promise.race([processPromise, timeoutPromise]).catch(err => {
                    console.error(`[ProgressiveDownloadManager] Error in processPlaylist: ${err.message}`);
                    return false;
                });


                if (success) {
                    // Check if playlist has any files before trying to create ZIP
                    const playlistFiles = this.inMemoryFiles.get(playlist.id);
                    if (playlistFiles && playlistFiles.size > 0) {
                        this.completedPlaylists.push(playlist.title);

                        // Create and download ZIP for this playlist
                        try {
                            await this.createAndDownloadPlaylistZip(playlist, manifestId);

                            sendMessage({
                                type: 'PLAYLIST_EXPORT_COMPLETED',
                                manifestId: manifestId,
                                playlistTitle: playlist.title,
                                playlistIndex: i + 1,
                                totalPlaylists: manifest.playlists.length
                            });
                        } catch (zipError) {
                            console.error(`[ProgressiveDownloadManager] Failed to create/download ZIP for ${playlist.title}:`, zipError);
                            this.failedPlaylists.push(playlist.title);

                            sendMessage({
                                type: 'PLAYLIST_EXPORT_FAILED',
                                manifestId: manifestId,
                                playlistTitle: playlist.title,
                                playlistIndex: i + 1,
                                totalPlaylists: manifest.playlists.length,
                                error: `ZIP creation failed: ${zipError.message}`
                            });
                        }
                    } else {
                        // No files to export (might be empty or dynamic playlist)
                        this.failedPlaylists.push(playlist.title);

                        sendMessage({
                            type: 'PLAYLIST_EXPORT_FAILED',
                            manifestId: manifestId,
                            playlistTitle: playlist.title,
                            playlistIndex: i + 1,
                            totalPlaylists: manifest.playlists.length,
                            error: 'No files available for export (possibly a dynamic playlist)'
                        });
                    }
                } else {
                    this.failedPlaylists.push(playlist.title);

                    sendMessage({
                        type: 'PLAYLIST_EXPORT_FAILED',
                        manifestId: manifestId,
                        playlistTitle: playlist.title,
                        playlistIndex: i + 1,
                        totalPlaylists: manifest.playlists.length
                    });
                }
            } catch (playlistError) {
                console.error(`[ProgressiveDownloadManager] Error processing playlist ${playlist.title}:`, playlistError);
                this.failedPlaylists.push(playlist.title);

                sendMessage({
                    type: 'PLAYLIST_EXPORT_FAILED',
                    manifestId: manifestId,
                    playlistTitle: playlist.title,
                    playlistIndex: i + 1,
                    totalPlaylists: manifest.playlists.length,
                    error: playlistError.message
                });
            }
        }

        // Send final completion message
        sendMessage({
            type: 'PROGRESSIVE_EXPORT_COMPLETED',
            manifestId: manifestId,
            stats: {
                total: manifest.playlists.length,
                completed: this.completedPlaylists.length,
                failed: this.failedPlaylists.length,
                completedTitles: this.completedPlaylists,
                failedTitles: this.failedPlaylists
            }
        });

        // Clean up after a short delay
        setTimeout(() => {
            this.inMemoryFiles.clear();
        }, 5000);
    }

    async processPlaylist(playlist, manifestId, manifest) {
        const startTime = Date.now();
        const playlistFiles = [];
        let hasFailures = false;

        // Build file list for this playlist
        if (playlist.audioFiles) {
            for (const audio of playlist.audioFiles) {
                playlistFiles.push({
                    id: audio.id || crypto.randomUUID(),
                    url: audio.url,
                    filename: audio.filename,
                    type: 'audio',
                    playlistId: playlist.id,
                    playlistTitle: playlist.title,
                    manifestId: manifestId,
                    size: audio.size
                });
            }
        }

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

            playlistFiles.push({
                id: playlist.coverImage.id || `cover_${playlist.id}`,
                url: playlist.coverImage.url,
                filename: coverFilename,
                type: 'cover',
                playlistId: playlist.id,
                playlistTitle: playlist.title,
                manifestId: manifestId,
                size: playlist.coverImage.size
            });
        }

        if (playlist.iconImages) {
            for (const icon of playlist.iconImages) {
                playlistFiles.push({
                    id: icon.id || crypto.randomUUID(),
                    url: icon.url,
                    filename: icon.filename,
                    type: 'icon',
                    playlistId: playlist.id,
                    playlistTitle: playlist.title,
                    manifestId: manifestId,
                    size: icon.size
                });
            }
        }


        // Download files with concurrency control
        const downloadPromises = [];
        for (const fileInfo of playlistFiles) {
            if (this.cancelled) break;

            // Wait if we have too many concurrent downloads
            while (this.activeDownloads.size >= this.maxConcurrent && !this.cancelled) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            if (!this.cancelled) {
                const promise = this.downloadFile(fileInfo).then(success => {
                    this.activeDownloads.delete(fileInfo.id);
                    if (!success) hasFailures = true;
                    return success;
                });

                this.activeDownloads.set(fileInfo.id, promise);
                downloadPromises.push(promise);
            }
        }

        // Wait for all downloads to complete
        await Promise.allSettled(downloadPromises);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        // Return success only if no failures (or it's a dynamic playlist error we can handle)
        return !hasFailures || playlist.isDynamic;
    }

    async downloadFile(fileInfo, retryCount = 0) {
        const startTime = Date.now();

        if (this.cancelled) {
            return false;
        }

        try {
            // Create abort controller
            const abortController = new AbortController();
            this.abortControllers.set(fileInfo.id, abortController);

            // Try direct fetch first
            let buffer;
            try {
                const response = await fetch(fileInfo.url, {
                    signal: abortController.signal
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                buffer = await response.arrayBuffer();
            } catch (fetchError) {
                // If CORS fails, proxy through service worker

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
                buffer = new ArrayBuffer(binaryString.length);
                const view = new Uint8Array(buffer);
                for (let i = 0; i < binaryString.length; i++) {
                    view[i] = binaryString.charCodeAt(i);
                }
            }


            // Store in memory for this playlist (we'll include in ZIP shortly)
            const playlistMemory = this.inMemoryFiles.get(fileInfo.playlistId) || new Map();
            playlistMemory.set(fileInfo.id, {
                buffer: buffer,
                fileInfo: fileInfo
            });
            this.inMemoryFiles.set(fileInfo.playlistId, playlistMemory);

            // Update manifest
            if (!this.storageManager.getManifestFromMemory(fileInfo.manifestId).files) {
                this.storageManager.getManifestFromMemory(fileInfo.manifestId).files = {};
            }

            this.storageManager.getManifestFromMemory(fileInfo.manifestId).files[fileInfo.id] = {
                stored: true,
                inMemoryOnly: true,
                size: buffer.byteLength,
                completedAt: Date.now()
            };

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            return true;

        } catch (error) {
            if (error.name === 'AbortError' || this.cancelled) {
                return false;
            }

            console.error(`[ProgressiveDownloadManager] Download failed: ${fileInfo.filename}`, error);

            if (retryCount < this.maxRetries && !this.cancelled) {
                const delay = this.retryDelay * Math.pow(2, retryCount);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.downloadFile(fileInfo, retryCount + 1);
            }

            // Mark as failed
            if (!this.storageManager.getManifestFromMemory(fileInfo.manifestId).files) {
                this.storageManager.getManifestFromMemory(fileInfo.manifestId).files = {};
            }

            this.storageManager.getManifestFromMemory(fileInfo.manifestId).files[fileInfo.id] = {
                failed: true,
                error: error.message,
                failedAt: Date.now()
            };

            return false;
        } finally {
            this.abortControllers.delete(fileInfo.id);
        }
    }

    async createAndDownloadPlaylistZip(playlist, manifestId) {

        try {
            const zip = new JSZip();
            const playlistFolder = zip.folder(this.sanitizePlaylistName(playlist.title));
            const audioFolder = playlistFolder.folder('audio');
            const iconsFolder = playlistFolder.folder('icons');
            const coverFolder = playlistFolder.folder('cover');

            // Get files for this playlist from memory
            const playlistFiles = this.inMemoryFiles.get(playlist.id);
            if (!playlistFiles || playlistFiles.size === 0) {
                // Don't create a ZIP if there are no files, but don't throw an error either
                // This can happen with dynamic playlists that can't be resolved
                return;
            }

            let filesAdded = 0;
            for (const [fileId, fileData] of playlistFiles) {
                const { buffer, fileInfo } = fileData;
                let targetFolder;

                if (fileInfo.type === 'audio') {
                    targetFolder = audioFolder;
                } else if (fileInfo.type === 'icon') {
                    targetFolder = iconsFolder;
                } else if (fileInfo.type === 'cover' || (fileInfo.filename && fileInfo.filename.includes('-cover.'))) {
                    targetFolder = coverFolder;
                } else {
                    // Default to icons folder for other images
                    targetFolder = iconsFolder;
                }

                targetFolder.file(fileInfo.filename || fileId, buffer);
                filesAdded++;
            }


            // Generate ZIP
            const blob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 }
            });


            const sanitizedTitle = this.sanitizePlaylistName(playlist.title);
            const filename = `${sanitizedTitle}.zip`;

            // Create blob URL and trigger download
            const blobUrl = URL.createObjectURL(blob);

            // Try to use chrome.downloads if available
            if (typeof chrome !== 'undefined' && chrome.downloads) {
                try {
                    const downloadId = await chrome.downloads.download({
                        url: blobUrl,
                        filename: filename,
                        saveAs: false,
                        conflictAction: 'uniquify'
                    });
                } catch (error) {
                    // Fall back to service worker
                    sendMessage({
                        type: 'DOWNLOAD_ZIP_BLOB_URL',
                        manifestId: manifestId,
                        blobUrl: blobUrl,
                        filename: filename,
                        size: blob.size,
                        playlistTitle: playlist.title
                    });
                }
            } else {
                // Send to service worker for download
                sendMessage({
                    type: 'DOWNLOAD_ZIP_BLOB_URL',
                    manifestId: manifestId,
                    blobUrl: blobUrl,
                    filename: filename,
                    size: blob.size,
                    playlistTitle: playlist.title
                });
            }

            // Clean up memory for this playlist after a delay
            setTimeout(() => {
                this.inMemoryFiles.delete(playlist.id);
                URL.revokeObjectURL(blobUrl);
            }, 10000);

        } catch (error) {
            console.error(`[ProgressiveDownloadManager] Failed to create ZIP for playlist: ${playlist.title}`, error);
            throw error;
        }
    }

    sanitizeName(name) {
        if (!name) return 'untitled';
        return name
            .replace(/[<>:"|?*\\/]/g, '_')
            .replace(/\s+/g, '_')
            .replace(/\.+/g, '.')
            .replace(/_+/g, '_')
            .trim();
    }

    sanitizePlaylistName(name) {
        if (!name) return 'untitled';
        return name
            .replace(/[<>:"|?*\\/]/g, '')
            .replace(/\s+/g, ' ')
            .replace(/\.+$/g, '')
            .trim();
    }

    async cancelDownloads() {
        this.cancelled = true;

        // Abort all active downloads
        for (const [id, controller] of this.abortControllers) {
            controller.abort();
        }

        this.abortControllers.clear();
        this.activeDownloads.clear();
        this.inMemoryFiles.clear();
    }

    async resumeManifest(manifestId) {
        const manifest = this.storageManager.getManifestFromMemory(manifestId);
        if (!manifest) {
            throw new Error('Manifest not found for resume');
        }

        // Reset and restart
        this.cancelled = false;
        await this.processManifest(manifestId, manifest);
    }
}

// Export for use in offscreen document
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProgressiveDownloadManager;
}

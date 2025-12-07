// Storage Manager - Handles OPFS, and manifest persistence
// Manages temporary file storage and progressive download state

class StorageManager {
    constructor() {
        this.root = null;
        this.tempDir = null;
        this.initialized = false;
        this.manifests = new Map(); // Store manifests in memory since offscreen can't access chrome.storage
    }

    async initialize() {
        if (this.initialized) return;

        try {
            if (!navigator.storage || !navigator.storage.getDirectory) {
                throw new Error('OPFS (Origin Private File System) is not available in this context');
            }

            console.log('[StorageManager] Attempting to access OPFS...');

            this.root = await navigator.storage.getDirectory();
            console.log('[StorageManager] Got OPFS root directory');

            this.tempDir = await this.root.getDirectoryHandle('yoto-downloads', { create: true });
            console.log('[StorageManager] Created/accessed yoto-downloads directory');

            if (navigator.storage.estimate) {
                const estimate = await navigator.storage.estimate();
                const usedMB = (estimate.usage / 1024 / 1024).toFixed(2);
                const quotaMB = (estimate.quota / 1024 / 1024).toFixed(2);
                console.log(`[StorageManager] Storage status: ${usedMB} MB used of ${quotaMB} MB quota`);

                if (estimate.usage / estimate.quota > 0.9) {
                    console.warn('[StorageManager] Storage is over 90% full!');
                }
            }

            // Clean up old downloads on startup (skip if no manifests exist)
            if (this.manifests.size > 0) {
                await this.cleanupOldDownloads();
            }

            this.initialized = true;
            console.log('[StorageManager] Initialized successfully');
        } catch (error) {
            console.error('[StorageManager] Initialization failed:', error.toString());
            console.error('[StorageManager] Init error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack,
                hasNavigatorStorage: !!navigator.storage,
                hasGetDirectory: !!(navigator.storage && navigator.storage.getDirectory)
            });
            this.initialized = false;
            throw error;
        }
    }

    storeManifestInMemory(manifestId, manifest) {
        this.manifests.set(manifestId, manifest);
        console.log(`[StorageManager] Stored manifest ${manifestId} in memory`);
    }

    getManifestFromMemory(manifestId) {
        return this.manifests.get(manifestId);
    }

    async getManifest(manifestId) {
        // In offscreen context, we only use memory storage
        return this.manifests.get(manifestId) || null;
    }

    async saveManifest(manifestId, manifest) {
        this.manifests.set(manifestId, manifest);
        // Notify service worker of updates
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            try {
                chrome.runtime.sendMessage({
                    type: 'MANIFEST_UPDATE',
                    manifestId: manifestId,
                    manifest: manifest
                });
            } catch (error) {
                console.warn('[StorageManager] Could not notify service worker of manifest update:', error);
            }
        }
    }

    async updateManifest(manifestId, updates) {
        const manifest = this.manifests.get(manifestId);
        if (!manifest) {
            console.error('[StorageManager] Manifest not found:', manifestId);
            return;
        }

        // Deep merge updates - properly handle nested files object
        if (updates.files) {
            if (!manifest.files) manifest.files = {};

            // Deep merge each file's properties instead of replacing the whole file object
            Object.keys(updates.files).forEach(fileId => {
                if (!manifest.files[fileId]) {
                    // If file doesn't exist, create it
                    manifest.files[fileId] = updates.files[fileId];
                    console.log(`[StorageManager] Created file entry ${fileId}:`, updates.files[fileId]);
                } else {
                    // Deep merge the file properties
                    manifest.files[fileId] = {
                        ...manifest.files[fileId],
                        ...updates.files[fileId]
                    };
                    console.log(`[StorageManager] Updated file ${fileId}:`, {
                        was: manifest.files[fileId],
                        now: updates.files[fileId]
                    });
                }
            });

            // Log total files status
            const storedCount = Object.values(manifest.files).filter(f => f.stored).length;
            const failedCount = Object.values(manifest.files).filter(f => f.failed).length;
            const totalCount = Object.keys(manifest.files).length;
            console.log(`[StorageManager] Manifest ${manifestId} file status: ${storedCount} stored, ${failedCount} failed, ${totalCount} total`);
        }

        // Create a copy of updates for sending to service worker (before modifying)
        const updatesToSend = { ...updates };
        if (updates.files) {
            updatesToSend.files = { ...updates.files };
            delete updates.files;
        }

        Object.assign(manifest, updates);

        this.manifests.set(manifestId, manifest);

        // Notify service worker of updates (including files)
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            try {
                chrome.runtime.sendMessage({
                    type: 'MANIFEST_UPDATE',
                    manifestId: manifestId,
                    updates: updatesToSend
                });
            } catch (error) {
                console.warn('[StorageManager] Could not notify service worker of manifest update:', error);
            }
        }
    }

    async saveFile(stream, fileInfo, manifestId) {
        try {
            // Ensure we're initialized
            if (!this.initialized || !this.tempDir) {
                console.log('[StorageManager] Initializing before save...');
                await this.initialize();
            }

            // Sanitize names
            const playlistId = this.sanitizeName(fileInfo.playlistId);
            const fileType = fileInfo.type || 'audio';
            const filename = this.sanitizeName(fileInfo.filename);

            console.log(`[StorageManager] Saving ${fileType} file: ${filename} for playlist: ${playlistId}`);

            const playlistDir = await this.tempDir.getDirectoryHandle(playlistId, { create: true });
            const subDir = await playlistDir.getDirectoryHandle(fileType, { create: true });
            const fileHandle = await subDir.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await stream.pipeTo(writable);

            const filePath = `${playlistId}/${fileType}/${filename}`;
            await this.updateManifest(manifestId, {
                files: {
                    [fileInfo.id]: {
                        stored: true,
                        path: filePath,
                        size: fileInfo.size || 0,
                        completedAt: Date.now()
                    }
                }
            });

            console.log(`[StorageManager] Successfully saved file: ${filePath}`);
            return filePath;
        } catch (error) {
            // Create a detailed error message for DOMException
            let errorDetails = {
                name: error.name || 'Unknown',
                message: error.message || 'No message',
                code: error.code,
                stack: error.stack,
                fileInfo: {
                    id: fileInfo.id,
                    filename: fileInfo.filename,
                    type: fileInfo.type,
                    playlistId: fileInfo.playlistId,
                    sanitizedFilename: filename,
                    path: `${playlistId}/${fileType}/${filename}`
                }
            };

            // Special handling for DOMException
            if (error instanceof DOMException) {
                errorDetails.isDOMException = true;
                errorDetails.domExceptionName = error.name;

                // Common OPFS error types
                if (error.name === 'NotAllowedError') {
                    errorDetails.likelyCause = 'File system access denied or OPFS not available in this context';
                } else if (error.name === 'SecurityError') {
                    errorDetails.likelyCause = 'Security restrictions prevent file system access';
                } else if (error.name === 'QuotaExceededError') {
                    errorDetails.likelyCause = 'Storage quota exceeded';
                } else if (error.name === 'NotFoundError') {
                    errorDetails.likelyCause = 'Directory or file not found';
                } else if (error.name === 'InvalidStateError') {
                    errorDetails.likelyCause = 'File system is in an invalid state';
                } else if (error.name === 'TypeMismatchError') {
                    errorDetails.likelyCause = 'Type mismatch in file operation';
                }
            }

            console.error('[StorageManager] Error saving file:', error.toString());
            console.error('[StorageManager] Error details:', JSON.stringify(errorDetails, null, 2));

            throw error;
        }
    }

    async saveFileFromBuffer(buffer, fileInfo, manifestId) {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array(buffer));
                controller.close();
            }
        });
        return await this.saveFile(stream, fileInfo, manifestId);
    }

    async getFile(filePath) {
        if (!this.initialized) await this.initialize();

        const parts = filePath.split('/');
        let currentDir = this.tempDir;

        for (let i = 0; i < parts.length - 1; i++) {
            currentDir = await currentDir.getDirectoryHandle(parts[i]);
        }

        const fileHandle = await currentDir.getFileHandle(parts[parts.length - 1]);
        return await fileHandle.getFile();
    }

    async createZipFromManifest(manifestId, playlistIds = null, inMemoryFiles = null) {
        const manifest = this.manifests.get(manifestId);
        if (!manifest) {
            throw new Error('Manifest not found');
        }

        const zip = new JSZip();
        const playlists = playlistIds
            ? manifest.playlists.filter(p => playlistIds.includes(p.id))
            : manifest.playlists;

        let filesAdded = 0;
        let filesSkipped = 0;

        for (const playlist of playlists) {
            const playlistFolder = zip.folder(this.sanitizeName(playlist.title));
            const audioFolder = playlistFolder.folder('audio');
            const coverFolder = playlistFolder.folder('cover');
            const iconsFolder = playlistFolder.folder('icons');

            for (const fileId in manifest.files) {
                const fileInfo = manifest.files[fileId];

                // Skip files from other playlists or not yet downloaded
                if (!fileInfo.stored) {
                    filesSkipped++;
                    continue;
                }

                // Check if this file belongs to the current playlist
                const belongsToPlaylist = fileInfo.playlistId === playlist.id ||
                                         fileInfo.path?.startsWith(playlist.id);
                if (!belongsToPlaylist) {
                    continue;
                }

                try {
                    let arrayBuffer;

                    // Check if file is in memory (fallback storage)
                    if (fileInfo.inMemoryOnly && inMemoryFiles && inMemoryFiles.has(fileId)) {
                        console.log(`[StorageManager] Getting file from memory: ${fileInfo.filename}`);
                        const memoryFile = inMemoryFiles.get(fileId);
                        arrayBuffer = memoryFile.buffer;
                    } else {
                        // Try to get from OPFS
                        console.log(`[StorageManager] Getting file from OPFS: ${fileInfo.path}`);
                        const file = await this.getFile(fileInfo.path);
                        arrayBuffer = await file.arrayBuffer();
                    }

                    // Determine target folder based on file type
                    let targetFolder;
                    if (fileInfo.type === 'audio') {
                        targetFolder = audioFolder;
                    } else if (fileInfo.type === 'cover') {
                        targetFolder = coverFolder;
                    } else {
                        targetFolder = iconsFolder; // icons or other images
                    }
                    targetFolder.file(fileInfo.filename || fileId, arrayBuffer);
                    filesAdded++;
                } catch (error) {
                    console.error(`[StorageManager] Failed to add file to ZIP: ${fileInfo.path || fileId}`, error.message);
                    filesSkipped++;
                }
            }
        }

        console.log(`[StorageManager] ZIP creation: ${filesAdded} files added, ${filesSkipped} files skipped`);

        // Generate ZIP blob
        const blob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 } // Balanced compression
        });

        return blob;
    }

    async cleanupOldDownloads() {
        const now = Date.now();
        const ONE_DAY = 24 * 60 * 60 * 1000;
        const ONE_WEEK = 7 * ONE_DAY;
        const toRemove = [];

        // Clean up from memory storage
        for (const [manifestId, manifest] of this.manifests.entries()) {
            if (!manifest || !manifest.createdAt) continue;

            const age = now - manifest.createdAt;

            // Remove completed downloads after 1 day or incomplete after 1 week
            if ((manifest.status === 'completed' && age > ONE_DAY) ||
                (manifest.status !== 'completed' && age > ONE_WEEK)) {
                toRemove.push(manifestId);
            }
        }

        // Clean up identified manifests
        for (const manifestId of toRemove) {
            await this.removeManifestAndFiles(manifestId);
        }

        if (toRemove.length > 0) {
            console.log(`[StorageManager] Cleaned up ${toRemove.length} old manifests`);
        }
    }

    async removeManifestAndFiles(manifestId) {
        const manifest = this.manifests.get(manifestId);
        if (!manifest) return;

        // Remove files from OPFS
        if (manifest.playlists) {
            for (const playlist of manifest.playlists) {
                try {
                    await this.tempDir.removeEntry(
                        this.sanitizeName(playlist.id),
                        { recursive: true }
                    );
                } catch (error) {
                    // Directory might not exist
                    console.log(`[StorageManager] Could not remove directory: ${playlist.id}`);
                }
            }
        }

        // Remove manifest from memory
        this.manifests.delete(manifestId);

        // Notify service worker to clean up its storage
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            try {
                chrome.runtime.sendMessage({
                    type: 'REMOVE_MANIFEST',
                    manifestId: manifestId
                });
            } catch (error) {
                console.warn('[StorageManager] Could not notify service worker of manifest removal:', error);
            }
        }

        console.log(`[StorageManager] Cleaned up manifest: ${manifestId}`);
    }

    async getStorageInfo() {
        const estimate = await navigator.storage.estimate();
        return {
            used: estimate.usage || 0,
            quota: estimate.quota || 0,
            percentage: ((estimate.usage || 0) / (estimate.quota || 1)) * 100
        };
    }

    async hasStorageSpace(requiredBytes) {
        const info = await this.getStorageInfo();
        const available = info.quota - info.used;
        const buffer = 100 * 1024 * 1024; // 100MB buffer
        return available > (requiredBytes + buffer);
    }

    sanitizeName(name) {
        return String(name)
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 200) || 'untitled';
    }

    deepMerge(target, source) {
        const result = { ...target };

        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = this.deepMerge(result[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }

        return result;
    }
}
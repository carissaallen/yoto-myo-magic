const CONFIG = {
    YOTO_API_BASE: 'https://api.yotoplay.com',
    YOTO_AUTH_BASE: 'https://login.yotoplay.com',
    CLIENT_ID: '91cvZsRLdqJpX2PDNJxjsm9yvco0xnQh',
    CLIENT_SECRET: '',
    EXTENSION_ID: 'mjljammaehdojchngjnooekefnogdhol',
    TOKEN_STORAGE_KEY: 'yoto_auth_tokens',
    ICON_CACHE_KEY: 'yoto_icon_cache',
    STATS_KEY: 'yoto_stats'
};

function getRedirectUri() {
    return `chrome-extension://${CONFIG.EXTENSION_ID}/callback.html`;
}

class TokenManager {
    static async getTokens() {
        const result = await chrome.storage.local.get(CONFIG.TOKEN_STORAGE_KEY);
        return result[CONFIG.TOKEN_STORAGE_KEY] || null;
    }

    static async setTokens(tokens) {
        await chrome.storage.local.set({
            [CONFIG.TOKEN_STORAGE_KEY]: {
                ...tokens,
                timestamp: Date.now()
            }
        });
    }

    static async clearTokens() {
        await chrome.storage.local.remove(CONFIG.TOKEN_STORAGE_KEY);
    }

    static async isTokenValid() {
        const tokens = await this.getTokens();
        if (!tokens || !tokens.access_token) return false;

        // Check if access token is expired
        return !isTokenExpired(tokens.access_token);
    }

    static async refreshToken() {
        const tokens = await this.getTokens();
        if (!tokens || !tokens.refresh_token) {
            throw new Error('No refresh token available');
        }

        try {
            const response = await fetch('https://login.yotoplay.com/oauth/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    client_id: CONFIG.CLIENT_ID,
                    refresh_token: tokens.refresh_token
                })
            });

            if (!response.ok) {
                throw new Error('Failed to refresh token');
            }

            const newTokens = await response.json();
            await this.setTokens(newTokens);
            return newTokens;
        } catch (error) {
            await this.clearTokens();
            throw error;
        }
    }
}

function isTokenExpired(token) {
    if (!token) return true;

    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const exp = payload.exp;
        return Date.now() >= exp * 1000;
    } catch (error) {
        return true;
    }
}

async function startOAuthFlow() {
    const authUrl = 'https://login.yotoplay.com/authorize';

    const scopes = ['openid', 'profile', 'offline_access'];

    const params = new URLSearchParams({
        audience: 'https://api.yotoplay.com',
        scope: scopes.join(' '),
        response_type: 'code',
        client_id: CONFIG.CLIENT_ID,
        redirect_uri: getRedirectUri()
    });

    const fullAuthUrl = `${authUrl}?${params.toString()}`;
    chrome.tabs.create({url: fullAuthUrl});

    return {success: true};
}

async function exchangeCodeForTokens(code) {
    try {
        const response = await fetch('https://login.yotoplay.com/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: CONFIG.CLIENT_ID,
                code: code,
                redirect_uri: getRedirectUri()
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Token exchange failed: ${error}`);
        }

        const tokens = await response.json();
        await TokenManager.setTokens(tokens);
        return {success: true, tokens};
    } catch (error) {
        return {success: false, error: error.message};
    }
}

async function makeAuthenticatedRequest(endpoint, options = {}) {
    let tokens = await TokenManager.getTokens();

    if (tokens && isTokenExpired(tokens.access_token)) {
        try {
            tokens = await TokenManager.refreshToken();
        } catch (error) {
            return {error: 'Authentication required', needsAuth: true};
        }
    }

    if (!tokens || !tokens.access_token) {
        return {error: 'Not authenticated', needsAuth: true};
    }

    try {
        const url = endpoint.startsWith('http') ? endpoint : `${CONFIG.YOTO_API_BASE}${endpoint}`;

        // Don't set Content-Type for FormData - let browser set it with boundary
        const isFormData = options.body instanceof FormData;
        const authHeaders = {
            'Authorization': `Bearer ${tokens.access_token}`,
            ...(isFormData ? {} : {'Content-Type': 'application/json'}),
            ...options.headers
        };

        const response = await fetch(url, {
            ...options,
            headers: authHeaders
        });

        if (response.status === 401) {
            tokens = await TokenManager.refreshToken();
            return makeAuthenticatedRequest(endpoint, options);
        }

        if (response.status === 403) {
            throw new Error(`API request forbidden: ${response.status}`);
        }

        if (!response.ok) {
            const errorText = await response.text();
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.error?.message) {
                    throw new Error(`API error: ${errorJson.error.message}`);
                }
            } catch (e) {
                // Not JSON, use raw text
            }
            throw new Error(`API request failed: ${response.status} - ${errorText}`);
        }

        return await response.json();
    } catch (error) {
        throw error;
    }
}

async function getMyCards() {
    try {
        try {
            const v1Response = await makeAuthenticatedRequest('/v1/cards');
            if (v1Response.cards) return v1Response;
        } catch (e) {}

        try {
            const mineResponse = await makeAuthenticatedRequest('/card/mine');
            return mineResponse;
        } catch (e) {}

        try {
            const cardsResponse = await makeAuthenticatedRequest('/cards');
            return cardsResponse;
        } catch (e) {}

        return {cards: []};
    } catch (error) {
        return {cards: []};
    }
}

async function getCardContent(cardId) {
    try {
        return await makeAuthenticatedRequest(`/content/${cardId}`);
    } catch (contentError) {
        return {error: `Could not fetch card content: ${contentError.message}`};
    }
}

async function searchIcons(query) {
    try {
        const lowerQuery = query.toLowerCase();
        let allIcons = [];

        try {
            const yotoResponse = await makeAuthenticatedRequest('/media/displayIcons/user/yoto');
            if (yotoResponse && !yotoResponse.error) {
                const yotoIcons = Array.isArray(yotoResponse) ? yotoResponse : (yotoResponse.displayIcons || []);
                
                yotoIcons.forEach(icon => {
                    icon.source = 'yoto-public';
                });
                allIcons = allIcons.concat(yotoIcons);
            }
        } catch (error) {}

        const yotoMatches = allIcons.filter(icon => {
            const allText = [
                icon.title,
                icon.mediaId,
                ...(icon.publicTags || [])
            ].filter(Boolean).join(' ').toLowerCase();
            return allText.includes(lowerQuery);
        });

        if (yotoMatches.length === 0) {
            const yotoiconsUrl = `https://www.yotoicons.com/icons?tag=${encodeURIComponent(query)}`;
            const yotoiconsPlaceholder = {
                title: `Search "${query}" on yotoicons.com`,
                description: 'Click to search on yotoicons.com',
                url: yotoiconsUrl,
                source: 'yotoicons-link',
                mediaId: 'yotoicons-search',
                isPlaceholder: true
            };
            allIcons.push(yotoiconsPlaceholder);
        }

        const filteredIcons = allIcons.filter(icon => {
            if (icon.isPlaceholder) {
                return true;
            }
            const allText = [
                icon.title,
                icon.mediaId,
                ...(icon.publicTags || [])
            ].filter(Boolean).join(' ').toLowerCase();
            return allText.includes(lowerQuery);
        });

        filteredIcons.sort((a, b) => {
            const aExact = a.title?.toLowerCase() === lowerQuery;
            const bExact = b.title?.toLowerCase() === lowerQuery;
            if (aExact && !bExact) return -1;
            if (!aExact && bExact) return 1;

            if (a.source === 'yoto-public' && b.source !== 'yoto-public') return -1;
            if (a.source !== 'yoto-public' && b.source === 'yoto-public') return 1;

            return 0;
        });

        return {icons: filteredIcons};
    } catch (error) {
        return {icons: []};
    }
}

async function matchIcons(tracks) {
    const matches = [];

    for (const track of tracks) {
        let iconOptions = [];

        try {
            const fullResults = await searchIcons(track.title);
            if (fullResults.icons && fullResults.icons.length > 0) {
                const validIcons = fullResults.icons.filter(icon => 
                    !icon.isPlaceholder && 
                    !icon.url?.includes('yotoicons.com')
                ).slice(0, 10);
                
                iconOptions = validIcons.map(icon => {
                    let iconUrl = icon.url || icon.mediaUrl || null;
                    
                    if (!iconUrl && icon.mediaId) {
                        iconUrl = `https://api.yotoplay.com/media/${icon.mediaId}`;
                    }
                    
                    const isValidUrl = iconUrl && 
                                     iconUrl.startsWith('http') && 
                                     iconUrl.length < 2000 && 
                                     !iconUrl.includes('data:');
                    
                    return {
                        url: isValidUrl ? iconUrl : null,
                        iconId: icon.mediaId || icon.id || icon.displayIconId,
                        title: icon.title || null
                    };
                });
                
                iconOptions = iconOptions.filter(option => option.url !== null);
            }
        } catch (error) {}

        if (iconOptions.length < 5) {
            const keywords = track.title.toLowerCase().split(' ').filter(word => word.length >= 3);

            for (const keyword of keywords) {
                if (iconOptions.length >= 10) break;
                
                try {
                    const results = await searchIcons(keyword);
                    if (results.icons && results.icons.length > 0) {
                        const validIcons = results.icons.filter(icon =>
                            !icon.isPlaceholder && 
                            !icon.url?.includes('yotoicons.com') &&
                            !iconOptions.some(opt => opt.iconId === (icon.mediaId || icon.id || icon.displayIconId))
                        );

                        const newOptions = validIcons.slice(0, 10 - iconOptions.length).map(icon => {
                            let iconUrl = icon.url || icon.mediaUrl || null;
                            
                            if (!iconUrl && icon.mediaId) {
                                iconUrl = `https://api.yotoplay.com/media/${icon.mediaId}`;
                            }
                            
                            const isValidUrl = iconUrl && 
                                             iconUrl.startsWith('http') && 
                                             iconUrl.length < 2000 && 
                                             !iconUrl.includes('data:');
                            
                            return {
                                url: isValidUrl ? iconUrl : null,
                                iconId: icon.mediaId || icon.id || icon.displayIconId,
                                title: icon.title || null
                            };
                        });

                        const validNewOptions = newOptions.filter(option => option.url !== null);
                        iconOptions = iconOptions.concat(validNewOptions);
                    }
                } catch (error) {}
            }
        }

        const matchResult = {
            trackId: track.id,
            trackTitle: track.title,
            iconOptions: iconOptions,
            selectedIndex: 0
        };

        matches.push(matchResult);
    }

    return matches;
}

async function updateStats(stats) {
    try {
        const current = await chrome.storage.local.get(CONFIG.STATS_KEY);
        const updated = {
            ...current[CONFIG.STATS_KEY],
            ...stats,
            lastUpdated: new Date().toISOString()
        };

        await chrome.storage.local.set({[CONFIG.STATS_KEY]: updated});
    } catch (error) {}
}

async function updateCardIcons(cardId, iconMatches) {
    try {
        const defaultIcon = 'yoto:#fqAuu4nSrOwNU-xbNVsGG-Om_PEe3S161UJ-nTXeBIQ';

        const cardContent = await getCardContent(cardId);
        if (cardContent.error) {
            return {success: false, error: 'Failed to get card content'};
        }

        let iconsUpdated = 0;
        
        if (cardContent.card?.content?.chapters && Array.isArray(cardContent.card.content.chapters)) {
            cardContent.card.content.chapters.forEach((chapter) => {
                let chapterIconId = null;

                if (chapter.tracks && chapter.tracks.length > 0) {
                    for (const track of chapter.tracks) {
                        const iconMatch = iconMatches.find(match =>
                            match.trackTitle === track.title
                        );

                        if (iconMatch && iconMatch.iconId) {
                            chapterIconId = iconMatch.iconId.startsWith('yoto:#')
                                ? iconMatch.iconId
                                : `yoto:#${iconMatch.iconId}`;
                            break;
                        }
                    }
                }

                if (!chapterIconId) {
                    chapterIconId = defaultIcon;
                }

                if (!chapter.display) {
                    chapter.display = {};
                }
                chapter.display.icon16x16 = chapterIconId;

                if (chapter.tracks && chapter.tracks.length > 0) {
                    chapter.tracks.forEach((track) => {
                        if (!track.display) {
                            track.display = {};
                        }
                        track.display.icon16x16 = chapterIconId;
                    });
                }

                iconsUpdated++;
            });
        }

        if (iconsUpdated === 0) {
            return {success: false, error: 'No chapters found to update'};
        }

        const requestBody = {
            createdByClientId: cardContent.card.createdByClientId,
            cardId: cardId,
            userId: cardContent.card.userId,
            createdAt: cardContent.card.createdAt,
            updatedAt: cardContent.card.updatedAt,
            content: cardContent.card.content,
            metadata: cardContent.card.metadata || {},
            title: cardContent.card.title || "Untitled"
        };

        try {
            const updateResponse = await makeAuthenticatedRequest('/content', {
                method: 'POST',
                body: JSON.stringify(requestBody)
            });

            if (!updateResponse.error) {
                await updateStats({
                    iconsMatched: iconsUpdated,
                    cardsUpdated: 1
                });
                return {success: true, message: `Updated ${iconsUpdated} chapter icons`};
            } else {
                if (updateResponse.error && updateResponse.error.includes('500')) {
                    return {
                        success: false,
                        error: updateResponse.error,
                        warning: 'Got 500 error but update may have succeeded. Please check your card.',
                        possibleSuccess: true
                    };
                } else {
                    return {success: false, error: updateResponse.error};
                }
            }
        } catch (e) {
            if (e.message && e.message.includes('500')) {
                return {
                    success: false,
                    error: e.message,
                    warning: 'Got 500 error but update may have succeeded. Please check your card.',
                    possibleSuccess: true
                };
            }
            return {success: false, error: e.message};
        }

    } catch (error) {
        return {success: false, error: error.message};
    }
}

// Upload icon to Yoto
async function uploadIcon(fileData) {
    try {
        // Handle base64 encoded file data from content script
        let fileBuffer;
        let filename = 'icon';
        let contentType = 'image/png';
        
        if (fileData.data) {
            // Convert base64 to ArrayBuffer
            const binaryString = atob(fileData.data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            fileBuffer = bytes.buffer;
            filename = fileData.name ? fileData.name.split('.')[0] : 'icon';
            contentType = fileData.type || 'image/png';
        } else {
            fileBuffer = fileData;
        }
        
        const response = await makeAuthenticatedRequest(
            `/media/displayIcons/user/me/upload?autoConvert=true&filename=${encodeURIComponent(filename)}`,
            {
                method: 'POST',
                body: fileBuffer,
                headers: {
                    'Content-Type': contentType
                }
            }
        );

        if (response.error) {
            throw new Error(response.error);
        }

        // Return the icon ID in the format needed for tracks
        const iconId = response.displayIcon?.mediaId;
        return iconId ? `yoto:#${iconId}` : null;
    } catch (error) {
        console.error('Error uploading icon:', error);
        throw error;
    }
}

// Upload audio file and handle transcoding
async function uploadAudio(fileData) {
    try {
        // Handle base64 encoded file data from content script
        let fileBuffer;
        let contentType = 'audio/mpeg';
        let fileName = 'audio';
        
        if (fileData.data) {
            // Convert base64 to ArrayBuffer
            const binaryString = atob(fileData.data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            fileBuffer = bytes.buffer;
            contentType = fileData.type || 'audio/mpeg';
            fileName = fileData.name || 'audio';
        } else {
            fileBuffer = fileData;
        }
        // Step 1: Get upload URL
        const uploadUrlResponse = await makeAuthenticatedRequest(
            '/media/transcode/audio/uploadUrl',
            {
                method: 'GET'
            }
        );

        if (uploadUrlResponse.error) {
            throw new Error(`Failed to get upload URL: ${uploadUrlResponse.error}`);
        }

        const { upload: { uploadUrl: audioUploadUrl, uploadId } } = uploadUrlResponse;

        if (!audioUploadUrl) {
            throw new Error('Failed to get upload URL');
        }

        // Step 2: Upload audio file
        const uploadResponse = await fetch(audioUploadUrl, {
            method: 'PUT',
            body: fileBuffer,
            headers: {
                'Content-Type': contentType
            }
        });

        if (!uploadResponse.ok) {
            throw new Error(`Failed to upload audio: ${uploadResponse.status}`);
        }

        // Step 3: Wait for transcoding
        let transcodedAudio = null;
        let attempts = 0;
        const maxAttempts = 60; // 30 seconds with 500ms intervals

        while (attempts < maxAttempts) {
            const transcodeResponse = await makeAuthenticatedRequest(
                `/media/upload/${uploadId}/transcoded?loudnorm=false`,
                {
                    method: 'GET'
                }
            );

            if (transcodeResponse.transcode?.transcodedSha256) {
                transcodedAudio = transcodeResponse.transcode;
                break;
            }

            await new Promise(resolve => setTimeout(resolve, 500));
            attempts++;
        }

        if (!transcodedAudio) {
            throw new Error('Transcoding timed out');
        }

        // Return the transcoded audio data
        return {
            trackUrl: `yoto:#${transcodedAudio.transcodedSha256}`,
            duration: transcodedAudio.transcodedInfo?.duration,
            fileSize: transcodedAudio.transcodedInfo?.fileSize,
            channels: transcodedAudio.transcodedInfo?.channels,
            format: transcodedAudio.transcodedInfo?.format,
            title: transcodedAudio.transcodedInfo?.metadata?.title || fileName
        };
    } catch (error) {
        console.error('Error uploading audio:', error);
        throw error;
    }
}

// Create or update playlist content with uploaded audio and icons
async function createPlaylistContent(title, audioTracks, iconIds, cardId) {
    try {
        // If we have a valid cardId, fetch existing content first
        let existingContent = null;
        if (cardId && cardId.length === 5) {
            try {
                existingContent = await getCardContent(cardId);
                if (existingContent.error) {
                    console.log('Could not fetch existing card, creating new content');
                    existingContent = null;
                }
            } catch (e) {
                console.log('Error fetching existing card:', e);
                existingContent = null;
            }
        }

        const chapters = [];
        
        // Create a chapter for each audio track
        audioTracks.forEach((track, index) => {
            const chapterKey = String(index).padStart(2, '0');
            const iconId = iconIds[index] || 'yoto:#fqAuu4nSrOwNU-xbNVsGG-Om_PEe3S161UJ-nTXeBIQ'; // Default icon
            
            chapters.push({
                key: chapterKey,
                title: track.title || `Track ${index + 1}`,
                overlayLabel: String(index + 1),
                tracks: [{
                    key: chapterKey,
                    title: track.title || `Track ${index + 1}`,
                    trackUrl: track.trackUrl,
                    duration: track.duration,
                    fileSize: track.fileSize,
                    channels: track.channels || 'stereo',
                    format: track.format || 'aac',
                    type: 'audio',
                    overlayLabel: String(index + 1),
                    display: {
                        icon16x16: iconId
                    }
                }],
                display: {
                    icon16x16: iconId
                },
                fileSize: track.fileSize,
                duration: track.duration,
                availableFrom: null,
                ambient: null,
                defaultTrackDisplay: null,
                defaultTrackAmbient: null
            });
        });

        // Calculate total duration and file size
        const totalDuration = audioTracks.reduce((sum, track) => sum + (track.duration || 0), 0);
        const totalFileSize = audioTracks.reduce((sum, track) => sum + (track.fileSize || 0), 0);

        // Get user info from token
        const tokens = await TokenManager.getTokens();
        let userId = 'unknown';
        if (tokens?.access_token) {
            try {
                const payload = JSON.parse(atob(tokens.access_token.split('.')[1]));
                userId = payload.sub || 'unknown';
            } catch (e) {
                console.error('Error parsing token:', e);
            }
        }

        // Build request body based on whether we're updating or creating
        let requestBody;
        
        if (existingContent && existingContent.card) {
            // Update existing card - use the exact structure from the existing card
            requestBody = {
                createdByClientId: existingContent.card.createdByClientId || CONFIG.CLIENT_ID,
                cardId: cardId,
                userId: existingContent.card.userId || userId,
                createdAt: existingContent.card.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                content: {
                    chapters,
                    playbackType: 'linear',
                    config: {
                        resumeTimeout: 2592000
                    }
                },
                metadata: {
                    description: `Imported playlist: ${title}`,
                    media: {
                        duration: totalDuration,
                        readableDuration: formatDuration(totalDuration),
                        fileSize: totalFileSize,
                        readableFileSize: Math.round((totalFileSize / 1024 / 1024) * 10) / 10,
                        hasStreams: false
                    },
                    cover: existingContent.card.metadata?.cover || {}
                },
                title: title
            };
        } else {
            // Create new playlist
            requestBody = {
                content: {
                    chapters,
                    playbackType: 'linear',
                    config: {
                        resumeTimeout: 2592000
                    }
                },
                metadata: {
                    description: `Imported playlist: ${title}`,
                    media: {
                        duration: totalDuration,
                        readableDuration: formatDuration(totalDuration),
                        fileSize: totalFileSize,
                        readableFileSize: Math.round((totalFileSize / 1024 / 1024) * 10) / 10,
                        hasStreams: false
                    }
                },
                title: title,
                createdByClientId: CONFIG.CLIENT_ID,
                userId: userId,
                createdAt: new Date().toISOString()
            };
            
            // Only add cardId if it's provided and valid (5 characters)
            if (cardId && cardId.length === 5) {
                requestBody.cardId = cardId;
            }
        }

        const response = await makeAuthenticatedRequest('/content', {
            method: 'POST',
            body: JSON.stringify(requestBody)
        });

        if (response.error) {
            throw new Error(`Failed to create/update playlist: ${response.error}`);
        }

        return response;
    } catch (error) {
        console.error('Error creating playlist content:', error);
        throw error;
    }
}

// Helper function to format duration
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    } else {
        return `${secs}s`;
    }
}

// Upload icon to Yoto
async function uploadIcon(iconFileData) {
    try {
        // Convert base64 to blob if needed
        const iconBlob = iconFileData.blob || new Blob(
            [Uint8Array.from(atob(iconFileData.data), c => c.charCodeAt(0))],
            { type: iconFileData.type || 'image/png' }
        );
        
        // Build FormData for the icon upload
        const formData = new FormData();
        formData.append('file', iconBlob, iconFileData.name || 'icon.png');
        
        // Upload the icon
        const response = await makeAuthenticatedRequest(
            `/media/displayIcons/user/me/upload?autoConvert=true&filename=${encodeURIComponent(iconFileData.name || 'icon')}`,
            {
                method: 'POST',
                body: formData
            }
        );
        
        if (response.error) {
            return { error: response.error };
        }
        
        if (response.displayIcon) {
            // Return the icon ID in the correct format for use in tracks
            const iconId = response.displayIcon.mediaId;
            return {
                success: true,
                iconId: iconId.startsWith('yoto:#') ? iconId : `yoto:#${iconId}`,
                displayIconId: response.displayIcon.displayIconId,
                isNew: response.displayIcon.new || false
            };
        }
        
        return { error: 'No icon data in response' };
    } catch (error) {
        return { error: error.message };
    }
}

// Upload audio file to Yoto
async function uploadAudioFile(audioFileData) {
    try {
        // Step 1: Get upload URL
        const uploadUrlResponse = await makeAuthenticatedRequest('/media/transcode/audio/uploadUrl', {
            method: 'GET'
        });
        
        if (uploadUrlResponse.error) {
            return { error: uploadUrlResponse.error };
        }
        
        const { upload } = uploadUrlResponse;
        if (!upload?.uploadUrl || !upload?.uploadId) {
            return { error: 'Failed to get upload URL' };
        }
        
        // Step 2: Upload the file
        const uploadResponse = await fetch(upload.uploadUrl, {
            method: 'PUT',
            body: audioFileData.blob,
            headers: {
                'Content-Type': audioFileData.type || 'audio/mpeg'
            }
        });
        
        if (!uploadResponse.ok) {
            return { error: 'Failed to upload audio file' };
        }
        
        // Step 3: Wait for transcoding
        let transcodedAudio = null;
        let attempts = 0;
        const maxAttempts = 30;
        
        while (attempts < maxAttempts) {
            const transcodeResponse = await makeAuthenticatedRequest(
                `/media/upload/${upload.uploadId}/transcoded?loudnorm=false`
            );
            
            if (!transcodeResponse.error && transcodeResponse.transcode?.transcodedSha256) {
                transcodedAudio = transcodeResponse.transcode;
                break;
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
        }
        
        if (!transcodedAudio) {
            return { error: 'Transcoding timed out' };
        }
        
        return {
            success: true,
            transcodedAudio,
            uploadId: upload.uploadId
        };
    } catch (error) {
        return { error: error.message };
    }
}

// Create playlist with uploaded content
async function createPlaylistContent(title, audioTracks, iconIds = []) {
    try {
        const chapters = audioTracks.map((audio, index) => {
            const chapterKey = String(index + 1).padStart(2, '0');
            const iconId = iconIds[index] || 'yoto:#aUm9i3ex3qqAMYBv-i-O-pYMKuMJGICtR3Vhf289u2Q'; // Default icon
            
            return {
                key: chapterKey,
                title: audio.title || `Track ${index + 1}`,
                overlayLabel: String(index + 1),
                tracks: [{
                    key: chapterKey,
                    title: audio.title || `Track ${index + 1}`,
                    trackUrl: `yoto:#${audio.transcodedAudio.transcodedSha256}`,
                    duration: audio.transcodedAudio.transcodedInfo?.duration,
                    fileSize: audio.transcodedAudio.transcodedInfo?.fileSize,
                    channels: audio.transcodedAudio.transcodedInfo?.channels,
                    format: audio.transcodedAudio.transcodedInfo?.format,
                    type: 'audio',
                    overlayLabel: String(index + 1),
                    display: {
                        icon16x16: iconId
                    }
                }],
                display: {
                    icon16x16: iconId
                }
            };
        });
        
        const totalDuration = audioTracks.reduce((sum, audio) => 
            sum + (audio.transcodedAudio.transcodedInfo?.duration || 0), 0);
        const totalFileSize = audioTracks.reduce((sum, audio) => 
            sum + (audio.transcodedAudio.transcodedInfo?.fileSize || 0), 0);
        
        const content = {
            title: title,
            content: {
                chapters
            },
            metadata: {
                media: {
                    duration: totalDuration,
                    fileSize: totalFileSize,
                    readableFileSize: Math.round((totalFileSize / 1024 / 1024) * 10) / 10
                }
            }
        };
        
        const createResponse = await makeAuthenticatedRequest('/content', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(content)
        });
        
        return createResponse;
    } catch (error) {
        return { error: error.message };
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        try {
            switch (request.action) {
                case 'CHECK_AUTH':
                    const isValid = await TokenManager.isTokenValid();
                    sendResponse({authenticated: isValid});
                    break;

                case 'START_AUTH':
                    const authResult = await startOAuthFlow();
                    sendResponse(authResult);
                    break;

                case 'EXCHANGE_CODE':
                    const exchangeResult = await exchangeCodeForTokens(request.code);
                    sendResponse(exchangeResult);
                    break;

                case 'GET_CARDS':
                    const cards = await getMyCards();
                    sendResponse(cards);
                    break;

                case 'GET_CARD_CONTENT':
                    const content = await getCardContent(request.cardId);
                    sendResponse(content);
                    break;

                case 'MATCH_ICONS':
                    const matches = await matchIcons(request.tracks);
                    sendResponse({matches});
                    break;

                case 'SEARCH_ICONS':
                    const icons = await searchIcons(request.query);
                    sendResponse(icons);
                    break;

                case 'UPDATE_STATS':
                    await updateStats(request.stats);
                    sendResponse({success: true});
                    break;

                case 'UPDATE_CARD_ICONS':
                    const updateResult = await updateCardIcons(request.cardId, request.iconMatches);
                    sendResponse(updateResult);
                    break;
                    
                case 'UPLOAD_AUDIO':
                    // Convert base64 to blob
                    const audioBlob = new Blob([Uint8Array.from(atob(request.file.data), c => c.charCodeAt(0))], {
                        type: request.file.type
                    });
                    sendResponse(await uploadAudioFile({
                        blob: audioBlob,
                        type: request.file.type,
                        name: request.file.name
                    }));
                    break;
                    
                case 'UPLOAD_ICON':
                    sendResponse(await uploadIcon({
                        data: request.file.data,
                        type: request.file.type,
                        name: request.file.name
                    }));
                    break;
                    
                case 'CREATE_PLAYLIST':
                    sendResponse(await createPlaylistContent(
                        request.title,
                        request.audioTracks,
                        request.iconIds
                    ));
                    break;


                case 'GET_ACCESS_TOKEN':
                    const tokens = await TokenManager.getTokens();
                    if (tokens && tokens.access_token) {
                        sendResponse({
                            success: true,
                            accessToken: tokens.access_token,
                            tokenType: tokens.token_type || 'Bearer'
                        });
                    } else {
                        sendResponse({success: false, error: 'No access token available'});
                    }
                    break;

                case 'LOGOUT':
                    await TokenManager.clearTokens();
                    sendResponse({success: true});
                    break;

                case 'UPLOAD_ICON':
                    const iconId = await uploadIcon(request.file);
                    sendResponse({success: true, iconId});
                    break;

                case 'UPLOAD_AUDIO':
                    const audioData = await uploadAudio(request.file);
                    sendResponse({success: true, ...audioData});
                    break;

                case 'CREATE_PLAYLIST_CONTENT':
                    const result = await createPlaylistContent(
                        request.title,
                        request.audioTracks,
                        request.iconIds,
                        request.cardId
                    );
                    sendResponse({success: true, result});
                    break;

                default:
                    sendResponse({error: 'Unknown action'});
            }
        } catch (error) {
            sendResponse({error: error.message});
        }
    })();

    return true;
});

chrome.runtime.onInstalled.addListener(async () => {
    const isValid = await TokenManager.isTokenValid();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && 
        tab.url?.includes('my.yotoplay.com') && 
        tab.url?.includes('/card/') && 
        tab.url?.includes('/edit')) {
        
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content/content-simple.js']
            });
            
            const isValid = await TokenManager.isTokenValid();
            if (isValid) {
                chrome.tabs.sendMessage(tabId, {
                    action: 'AUTH_STATUS',
                    authenticated: true
                }).catch(() => {});
            }
        } catch (error) {
            // Content script injection failed
        }
    }
});


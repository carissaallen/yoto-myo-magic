importScripts('../config.js');
importScripts('../lib/analytics.js');
importScripts('../lib/utils.js');
importScripts('../lib/translate.js');

const CONFIG = ExtensionConfig;

const yotoIconsCache = new Map();
const chunkedUploads = new Map();

function getRedirectUri() {
    return chrome.identity.getRedirectURL();
}

function cleanEpisodeTitle(title) {
    let cleanedTitle = title;

    cleanedTitle = cleanedTitle.replace(/_/g, ' ');

    cleanedTitle = cleanedTitle.replace(/^\d+[\.\-\s:]+/, '');

    cleanedTitle = cleanedTitle.replace(/\s+/g, ' ');
    cleanedTitle = cleanedTitle.trim();

    if (!cleanedTitle || cleanedTitle.length === 0) {
        return title;
    }

    return cleanedTitle;
}

class TokenManager {
    static async getTokens() {
        const result = await chrome.storage.local.get(CONFIG.TOKEN_STORAGE_KEY);
        const tokens = result[CONFIG.TOKEN_STORAGE_KEY] || null;
        return tokens;
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
    
    static async clearAllAuthData() {
        let userCacheKey = null;
        try {
            const tokens = await this.getTokens();
            if (tokens?.access_token) {
                const payload = JSON.parse(atob(tokens.access_token.split('.')[1]));
                const userId = payload.sub || 'default';
                const safeUserId = userId.replace(/[|:]/g, '_');
                userCacheKey = `yoto_icons_cache_${safeUserId}`;
            }
        } catch (e) {
        }

        await chrome.storage.local.remove(CONFIG.TOKEN_STORAGE_KEY);

        if (userCacheKey) {
            await chrome.storage.local.remove(userCacheKey);
        }
        yotoIconsCache.clear();

        try {
            await chrome.identity.clearAllCachedAuthTokens?.();
        } catch (e) {
        }
        await chrome.storage.local.remove('oauth_state');
        
    }

    static async isTokenValid() {
        const tokens = await this.getTokens();
        if (!tokens || !tokens.access_token) return false;

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
                    client_id: CONFIG.YOTO_CLIENT_ID,
                    refresh_token: tokens.refresh_token
                })
            });

            if (!response.ok) {
                const error = new Error(`Failed to refresh token: ${response.status}`);
                YotoAnalytics.trackError(error, {
                    action: 'token_refresh',
                    code: response.status,
                    component: 'service-worker'
                });
                throw error;
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

async function startOAuthFlow(interactive = true) {
    const authUrl = 'https://login.yotoplay.com/authorize';

    const state = crypto.randomUUID();

    await chrome.storage.local.set({
        'oauth_state': state
    });
    
    const params = new URLSearchParams({
        audience: 'https://api.yotoplay.com',
        scope: 'offline_access openid profile',
        response_type: 'code',
        client_id: CONFIG.YOTO_CLIENT_ID,
        redirect_uri: getRedirectUri(),
        state: state,
        ...(interactive ? { prompt: 'login' } : {})
    });

    const fullAuthUrl = `${authUrl}?${params.toString()}`;
    
    try {
        const responseUrl = await chrome.identity.launchWebAuthFlow({
            url: fullAuthUrl,
            interactive: interactive
        });

        if (!responseUrl) {
            return {success: false, error: 'No response URL received'};
        }

        const url = new URL(responseUrl);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        const returnedState = url.searchParams.get('state');

        if (error) {
            if (error === 'access_denied') {
                return {success: false, cancelled: true};
            }
            return {success: false, error: `Authentication error: ${error}`};
        }

        if (!code) {
            return {success: false, error: 'No authorization code received'};
        }

        const storedData = await chrome.storage.local.get(['oauth_state']);
        const expectedState = storedData.oauth_state;

        if (returnedState !== expectedState) {
            return {success: false, error: 'Invalid state parameter - possible CSRF attack'};
        }

        const tokenResult = await exchangeCodeForTokens(code);

        await chrome.storage.local.remove(['oauth_state']);
        if (tokenResult.success) {
            return {
                success: true, 
                authenticated: true, 
                silent: !interactive,
                tokens: tokenResult.tokens
            };
        } else {
            return {success: false, error: tokenResult.error};
        }
        
    } catch (error) {
        if (error.message && error.message.includes('user did not approve')) {
            return {success: false, cancelled: true};
        }

        if (!interactive) {
            return {success: false, error: 'Silent authentication failed', needsInteractive: true};
        }
        
        YotoAnalytics.trackCriticalError(error, {
            action: 'oauth_flow',
            component: 'service-worker',
            authenticated: false
        });
        return {success: false, error: error.message};
    }
}

async function exchangeCodeForTokens(code) {
    try {
        const tokenRequestBody = {
            grant_type: 'authorization_code',
            client_id: CONFIG.YOTO_CLIENT_ID,
            code: code,
            redirect_uri: getRedirectUri()
        };
        
        
        const response = await fetch('https://login.yotoplay.com/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams(tokenRequestBody)
        });

        if (!response.ok) {
            const error = await response.text();
            const err = new Error(`Token exchange failed: ${error}`);
            YotoAnalytics.trackCriticalError(err, {
                action: 'token_exchange',
                code: response.status,
                component: 'service-worker'
            });
            throw err;
        }

        const tokens = await response.json();
        await TokenManager.setTokens(tokens);

        if (typeof YotoAnalytics !== 'undefined') {
            YotoAnalytics.trackAuth(true);
        }

        return {success: true, tokens};
    } catch (error) {
        return {success: false, error: error.message};
    }
}

async function makeAuthenticatedRequest(endpoint, options = {}) {
    // Extract or initialize retry parameters
    const maxRetries = options.maxRetries ?? 3;
    const currentRetry = options.currentRetry ?? 0;
    const baseDelay = options.baseDelay ?? 1000; // Start with 1 second

    let tokens = await TokenManager.getTokens();

    if (tokens?.access_token) {
        try {
            const payload = JSON.parse(atob(tokens.access_token.split('.')[1]));
            const scopes = payload.scope || payload.scopes || '';
        } catch (e) {
            console.warn('[API Auth] Could not decode token scopes');
        }
    }

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

        const isFormData = options.body instanceof FormData;
        const isBinary = options.body instanceof ArrayBuffer || options.body instanceof Uint8Array;
        const hasContentType = options.headers && 'Content-Type' in options.headers;

        const defaultHeaders = {};
        if (!isFormData && !isBinary && !hasContentType) {
            defaultHeaders['Content-Type'] = 'application/json';
        }

        const authHeaders = {
            'Authorization': `Bearer ${tokens.access_token}`,
            ...defaultHeaders,
            ...options.headers
        };

        const response = await fetch(url, {
            ...options,
            headers: authHeaders
        });

        if (response.status === 401) {
            YotoAnalytics.trackError('401 Unauthorized - Token expired', {
                action: 'api_request',
                code: 401,
                url: endpoint,
                component: 'service-worker'
            });
            tokens = await TokenManager.refreshToken();
            return makeAuthenticatedRequest(endpoint, options);
        }

        // Handle rate limiting with exponential backoff
        if (response.status === 429) {
            if (currentRetry >= maxRetries) {
                console.error(`[API] Max retries (${maxRetries}) exceeded for rate limited request to ${endpoint}`);
                const retryAfter = response.headers.get('Retry-After');
                const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : baseDelay * Math.pow(2, currentRetry);
                throw new Error(`Rate limited: Too many requests. Please wait ${Math.ceil(waitTime / 1000)} seconds before retrying.`);
            }

            // Check for Retry-After header
            const retryAfter = response.headers.get('Retry-After');
            let delay;

            if (retryAfter) {
                // If server provides Retry-After, use it (convert to milliseconds)
                delay = parseInt(retryAfter) * 1000;
                console.log(`[API] Rate limited on ${endpoint}, server says retry after ${retryAfter} seconds`);
            } else {
                // Otherwise use exponential backoff: 1s, 2s, 4s, 8s, etc.
                delay = baseDelay * Math.pow(2, currentRetry);
                console.log(`[API] Rate limited on ${endpoint}, retrying after ${delay}ms (attempt ${currentRetry + 1}/${maxRetries})`);
            }

            // Add jitter to prevent thundering herd (random 0-10% additional delay)
            const jitter = delay * Math.random() * 0.1;
            delay = Math.min(delay + jitter, 30000); // Cap at 30 seconds

            if (typeof YotoAnalytics !== 'undefined') {
                YotoAnalytics.trackRateLimitEvent(endpoint, currentRetry + 1, delay);
            }

            await new Promise(resolve => setTimeout(resolve, delay));

            // Retry with incremented counter
            return makeAuthenticatedRequest(endpoint, {
                ...options,
                currentRetry: currentRetry + 1,
                maxRetries,
                baseDelay
            });
        }

        if (response.status === 403) {
            const errorText = await response.text();
            const error = new Error(`API request forbidden: ${response.status}`);
            YotoAnalytics.trackCriticalError(error, {
                action: 'api_request',
                code: 403,
                url: endpoint,
                component: 'service-worker'
            });
            throw error;
        }

        if (!response.ok) {
            const errorText = await response.text();
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.error?.message) {
                    throw new Error(`API error: ${errorJson.error.message}`);
                }
            } catch (e) {
            }
            throw new Error(`API request failed: ${response.status} - ${errorText}`);
        }

        // Check if response is JSON or HTML
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('text/html')) {
            // If HTML is returned, it's likely a redirect or error page
            console.log(`[API] Received HTML response from ${endpoint}, likely a redirect`);
            const htmlContent = await response.text();
            // Check if it's a redirect to share.yoto.co
            if (htmlContent.includes('share.yoto.co')) {
                throw new Error('Endpoint redirected to share page - not an API endpoint');
            }
            throw new Error('Received HTML instead of JSON');
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
        const response = await makeAuthenticatedRequest(`/content/${cardId}`);

        return response;
    } catch (contentError) {
        return {error: `Could not fetch card content: ${contentError.message}`};
    }
}

async function getUserCards() {
    try {
        const response = await makeAuthenticatedRequest('/content/mine');
        const cards = response?.cards || (Array.isArray(response) ? response : []);
        return { cards };
    } catch (error) {
        return { cards: [], error: error.message };
    }
}

async function resolvePlaylist(playlistId) {
    try {
        console.log(`[Resolve API] Attempting to resolve playlist ${playlistId}`);

        // Try the exact endpoints specified by the user
        // First try /card/resolve/{playlistId}
        try {
            console.log(`[Resolve API] Trying /card/resolve/${playlistId}`);

            // Make a direct fetch request to handle potential redirects
            const tokens = await TokenManager.getTokens();
            if (!tokens || !tokens.access_token) {
                throw new Error('No authentication token available');
            }

            const cardResolveUrl = `https://api.yotoplay.com/card/resolve/${playlistId}`;
            const response = await fetch(cardResolveUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${tokens.access_token}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                redirect: 'manual' // Don't follow redirects automatically
            });

            console.log(`[Resolve API] Response status: ${response.status}, type: ${response.type}`);
            console.log(`[Resolve API] Response headers:`, {
                contentType: response.headers.get('content-type'),
                location: response.headers.get('location'),
                redirected: response.redirected,
                url: response.url
            });

            // Check if it's a redirect or opaqueredirect
            if (response.type === 'opaqueredirect') {
                console.log('[Resolve API] Got opaque redirect, cannot access details');
            } else if (response.status === 301 || response.status === 302 || response.status === 303 || response.status === 307 || response.status === 308) {
                const redirectUrl = response.headers.get('location');
                console.log(`[Resolve API] Redirect detected to: ${redirectUrl}`);

                // If it redirects to share.yoto.co, we can't use this endpoint for API access
                if (redirectUrl && redirectUrl.includes('share.yoto.co')) {
                    console.log('[Resolve API] Endpoint redirects to share page, not suitable for API access');
                } else if (redirectUrl) {
                    // Try following the redirect with auth header
                    const redirectResponse = await fetch(redirectUrl, {
                        headers: {
                            'Authorization': `Bearer ${tokens.access_token}`,
                            'Accept': 'application/json'
                        }
                    });

                    if (redirectResponse.ok) {
                        const contentType = redirectResponse.headers.get('content-type');
                        if (contentType && contentType.includes('application/json')) {
                            const data = await redirectResponse.json();
                            console.log('[Resolve API] Got JSON from redirect');
                            //console.log('[Resolve API] Raw response data:', JSON.stringify(data, null, 2));
                            return { data };
                        }
                    }
                }
            } else if (response.ok) {
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const data = await response.json();
                    console.log('[Resolve API] Successfully resolved via /card/resolve');
                    //console.log('[Resolve API] Raw response data:', JSON.stringify(data, null, 2));
                    return { data };
                }
            }
        } catch (err) {
            console.log(`[Resolve API] /card/resolve failed:`, err.message);
        }

        try {
            console.log(`[Resolve API] Trying /content/resolve/${playlistId}`);
            const contentResolveResponse = await makeAuthenticatedRequest(`/content/resolve/${playlistId}`);

            if (!contentResolveResponse.error) {
                console.log('[Resolve API] Successfully resolved via /content/resolve');
                //console.log('[Resolve API] Raw response data:', JSON.stringify(contentResolveResponse, null, 2));
                return { data: contentResolveResponse };
            }
        } catch (err) {
            console.log(`[Resolve API] /content/resolve failed:`, err.message);
        }

        // If both resolve endpoints fail, fall back to regular content endpoint
        console.log('[Resolve API] Both resolve endpoints failed, using standard content endpoint');
        const contentResponse = await getCardContent(playlistId);

        if (!contentResponse.error && contentResponse.card) {
            console.log('[Resolve API] Got card data from content endpoint');
            console.log('[Resolve API] Card structure has:', {
                hasContent: !!contentResponse.card.content,
                hasChapters: !!contentResponse.card.content?.chapters,
                chapterCount: contentResponse.card.content?.chapters?.length || 0,
                hasMetadata: !!contentResponse.card.metadata,
                cardKeys: Object.keys(contentResponse.card)
            });
            return {
                data: contentResponse.card,
                warning: 'Audio URLs not available - resolve endpoints did not return playable content'
            };
        }

        return {
            error: `Could not resolve playlist ${playlistId}`
        };

    } catch (error) {
        console.error('[Resolve API] Unexpected error:', error);
        return { error: error.message };
    }
}

async function getBatteryStatus() {
    try {
        const devicesResponse = await makeAuthenticatedRequest('/device-v2/devices/mine');

        if (devicesResponse.error) {
            return { error: devicesResponse.error };
        }

        const deviceArray = devicesResponse.devices || [];

        if (deviceArray.length === 0) {
            return { devices: [] };
        }

        const deviceStatuses = await Promise.all(
            deviceArray.map(async (device) => {
                try {
                    const statusResponse = await makeAuthenticatedRequest(`/device-v2/${device.deviceId}/status`);

                    if (statusResponse.error) {
                        return {
                            name: device.name || device.deviceId,
                            batteryLevel: null,
                            isCharging: false,
                            isOnline: false,
                            error: true,
                            deviceFamily: device.deviceFamily || 'Unknown',
                            deviceType: device.deviceType
                        };
                    }

                    return {
                        name: device.name || device.deviceId,
                        batteryLevel: statusResponse.batteryLevelPercentage || 0,
                        isCharging: statusResponse.isCharging || false,
                        isOnline: statusResponse.isOnline !== false,
                        powerSource: statusResponse.powerSource,
                        wifiStrength: statusResponse.wifiStrength,
                        systemVolume: statusResponse.systemVolumePercentage,
                        deviceId: device.deviceId,
                        deviceFamily: device.deviceFamily || 'Unknown',
                        deviceType: device.deviceType
                    };
                } catch (error) {
                    return {
                        name: device.name || device.deviceId,
                        batteryLevel: null,
                        isCharging: false,
                        isOnline: false,
                        error: true,
                        deviceFamily: device.deviceFamily || 'Unknown',
                        deviceType: device.deviceType
                    };
                }
            })
        );

        return { devices: deviceStatuses };
    } catch (error) {
        return { error: `Failed to fetch device status: ${error.message}` };
    }
}

async function getUserSpecificCacheKey() {
    try {
        const tokens = await TokenManager.getTokens();
        if (tokens?.access_token) {
            const payload = JSON.parse(atob(tokens.access_token.split('.')[1]));
            const userId = payload.sub || 'default';
            const safeUserId = userId.replace(/[|:]/g, '_');
            return `yoto_icons_cache_${safeUserId}`;
        }
    } catch (error) {
        console.warn('Failed to get user ID for cache key:', error);
    }
    return null;
}

const rateLimiter = {
    lastRequest: 0,
    minInterval: 1000, // 1 second between requests
    
    async wait() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequest;
        if (timeSinceLastRequest < this.minInterval) {
            const waitTime = this.minInterval - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        this.lastRequest = Date.now();
    }
};

async function loadIconsCache() {
    try {
        yotoIconsCache.clear();

        const cacheKey = await getUserSpecificCacheKey();
        if (!cacheKey) {
            return;
        }

        const result = await chrome.storage.local.get(cacheKey);
        const cached = result[cacheKey];
        if (cached && typeof cached === 'object') {
            Object.entries(cached).forEach(([key, value]) => {
                yotoIconsCache.set(key, value);
            });
        } else {
        }
    } catch (error) {
        console.warn('Failed to load icons cache:', error);
        yotoIconsCache.clear();
    }
}

async function saveIconsCache() {
    try {
        const cacheKey = await getUserSpecificCacheKey();
        if (!cacheKey) {
            return;
        }

        const cacheObj = Object.fromEntries(yotoIconsCache);
        await chrome.storage.local.set({
            [cacheKey]: cacheObj
        });
    } catch (error) {
        console.warn('Failed to save icons cache:', error);
    }
}

async function fetchFromYotoicons(query) {
    try {
        const allIcons = [];
        const seenIds = new Set();

        for (let page = 1; page <= 25; page++) {
            await rateLimiter.wait();

            const searchUrl = `https://www.yotoicons.com/icons?tag=${encodeURIComponent(query)}&sort=popular&type=singles&page=${page}`;

            const response = await fetch(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
                }
            });

            if (!response.ok) {
                break;
            }

            const html = await response.text();
            const pageIcons = [];

            const pattern = /\/static\/uploads\/(\d+)\.png/g;
            let match;

            while ((match = pattern.exec(html)) !== null) {
                const iconId = match[1];

                if (seenIds.has(iconId)) continue;
                seenIds.add(iconId);

                const iconUrl = `https://www.yotoicons.com/static/uploads/${iconId}.png`;

                pageIcons.push({
                    id: iconId,
                    url: iconUrl,
                    title: `${query} icon ${iconId}`,
                    author: 'unknown',
                    source: 'yotoicons',
                    searchQuery: query
                });

                if (allIcons.length + pageIcons.length >= 500) break;
            }

            allIcons.push(...pageIcons);

            if (pageIcons.length === 0) {
                break;
            }

            if (allIcons.length >= 500) {
                break;
            }
        }

        return allIcons.slice(0, 500);
    } catch (error) {
        return [];
    }
}

async function downloadAndUploadIcon(yotoIcon) {
    try {
        const cacheKey = yotoIcon.id;
        if (yotoIconsCache.has(cacheKey)) {
            const cached = yotoIconsCache.get(cacheKey);

            if (cached.dataUrl) {
                return {
                    title: `${yotoIcon.title} (cached)`,
                    mediaId: cached.mediaId,
                    url: cached.dataUrl,
                    source: 'yotoicons-cached',
                    author: yotoIcon.author,
                    iconId: cached.iconId,
                    searchQuery: yotoIcon.searchQuery,
                    originalIconId: yotoIcon.id
                };
            } else {
                try {
                    const imageResponse = await fetch(yotoIcon.url);
                    if (imageResponse.ok) {
                        const arrayBuffer = await imageResponse.arrayBuffer();
                        const bytes = new Uint8Array(arrayBuffer);
                        let binary = '';
                        bytes.forEach(byte => binary += String.fromCharCode(byte));
                        const base64 = btoa(binary);
                        const dataUrl = `data:image/png;base64,${base64}`;

                        cached.dataUrl = dataUrl;
                        yotoIconsCache.set(cacheKey, cached);
                        saveIconsCache().catch(() => {});
                        
                        return {
                            title: `${yotoIcon.title} (cached)`,
                            mediaId: cached.mediaId,
                            url: dataUrl,
                            source: 'yotoicons-cached',
                            author: yotoIcon.author,
                            iconId: cached.iconId,
                            searchQuery: yotoIcon.searchQuery,
                            originalIconId: yotoIcon.id
                        };
                    }
                } catch (error) {
                }

                return {
                    title: `${yotoIcon.title} (cached)`,
                    mediaId: cached.mediaId,
                    url: cached.url, // Use original URL as fallback
                    source: 'yotoicons-cached',
                    author: yotoIcon.author,
                    iconId: cached.iconId,
                    searchQuery: yotoIcon.searchQuery,
                    originalIconId: yotoIcon.id
                };
            }
        }

        const response = await fetch(yotoIcon.url);
        if (!response.ok) {
            throw new Error(`Failed to download icon: ${response.status}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        let binary = '';
        bytes.forEach(byte => binary += String.fromCharCode(byte));
        const base64 = btoa(binary);

        const uploadResult = await uploadIcon({
            data: base64,
            type: 'image/png',
            name: `yotoicon_${yotoIcon.id}.png`
        });
        
        if (uploadResult.error) {
            throw new Error(uploadResult.error);
        }

        const dataUrl = `data:image/png;base64,${base64}`;

        const cacheEntry = {
            mediaId: uploadResult.mediaId,
            iconId: uploadResult.iconId,
            url: `https://api.yotoplay.com/media/${uploadResult.mediaId}`,
            dataUrl: dataUrl,
            uploadedAt: new Date().toISOString()
        };
        yotoIconsCache.set(cacheKey, cacheEntry);

        saveIconsCache().catch(console.warn);
        
        return {
            title: `${yotoIcon.title} (by @${yotoIcon.author})`,
            mediaId: uploadResult.mediaId,
            url: dataUrl,
            source: 'yotoicons-uploaded',
            author: yotoIcon.author,
            iconId: uploadResult.iconId,
            searchQuery: yotoIcon.searchQuery,
            originalIconId: yotoIcon.id
        };
        
    } catch (error) {
        return null;
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

        const matchesWholeWord = (text, word) => {
            if (/^\d+$/.test(word)) {
                const patterns = [
                    `\\b${word}\\b`,
                    `#${word}\\b`,
                    `number ${word}\\b`,
                    `no\\.?\\s*${word}\\b`
                ];
                const regex = new RegExp(patterns.join('|'), 'i');
                return regex.test(text);
            }
            const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            return regex.test(text);
        };

        try {
            let yotoIconsResults = await fetchFromYotoicons(query);

            if (yotoIconsResults.length === 0 && Utils.isPlural(query)) {
                const singular = Utils.singularize(query);
                if (singular !== query) {
                    yotoIconsResults = await fetchFromYotoicons(singular);
                }
            }

            if (yotoIconsResults.length > 0) {
                allIcons = allIcons.concat(yotoIconsResults);
            }
        } catch (error) {
        }

        if (allIcons.filter(icon => !icon.isPlaceholder).length === 0) {
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

        const searchTerms = [lowerQuery];
        if (Utils.isPlural(query)) {
            const singular = Utils.singularize(query);
            if (singular !== query) {
                searchTerms.push(singular.toLowerCase());
            }
        }

        const filteredIcons = allIcons.filter(icon => {
            if (icon.isPlaceholder) {
                return true;
            }

            if (icon.source?.startsWith('yotoicons')) {
                return true;
            }
            
            const allText = [
                icon.title,
                icon.mediaId,
                ...(icon.publicTags || [])
            ].filter(Boolean).join(' ');

            return searchTerms.some(term => matchesWholeWord(allText, term));
        });

        filteredIcons.sort((a, b) => {
            const aExact = searchTerms.some(term => a.title?.toLowerCase() === term);
            const bExact = searchTerms.some(term => b.title?.toLowerCase() === term);
            if (aExact && !bExact) return -1;
            if (!aExact && bExact) return 1;

            const sourceOrder = {
                'yoto-public': 1,
                'yotoicons-cached': 2,
                'yotoicons-uploaded': 3,
                'yotoicons-link': 4
            };
            
            const aOrder = sourceOrder[a.source] || 5;
            const bOrder = sourceOrder[b.source] || 5;
            
            if (aOrder !== bOrder) return aOrder - bOrder;

            return 0;
        });

        return {icons: filteredIcons};
    } catch (error) {
        return {icons: []};
    }
}

const categorySearchCache = new Map();

async function searchIconsByCategory(category, loadMore = false) {
    try {
        const translatedCategory = await TranslationService.translateToEnglish(category);
        const searchQuery = translatedCategory || category;
        const cacheKey = searchQuery.toLowerCase();

        if (categorySearchCache.has(cacheKey)) {
            const cached = categorySearchCache.get(cacheKey);

            if (loadMore) {
                return { icons: cached.allIcons, isComplete: cached.isComplete };
            } else {
                return { icons: cached.allIcons, isComplete: cached.isComplete };
            }
        }

        // Categories to skip in initial search due to fuzzy match issues (e.g. 'art' returns any icons with 'art' in the word)
        const skipInitialSearch = ['art'];
        const shouldSkipInitial = skipInitialSearch.includes(searchQuery.toLowerCase());

        let allIcons = [];
        let searchedTerms = [];
        let relatedTerms = getRelatedTerms(searchQuery);
        let remainingTerms = [...relatedTerms];

        if (shouldSkipInitial && relatedTerms.length > 0) {
            // For categories we skip, search the first related term instead
            const firstTerm = remainingTerms.shift();
            const searchResult = await searchIcons(firstTerm);
            allIcons = searchResult.icons || [];
            searchedTerms = [firstTerm];
        } else if (!shouldSkipInitial) {
            const searchResult = await searchIcons(searchQuery);
            allIcons = searchResult.icons || [];
            searchedTerms = [searchQuery];
        }

        categorySearchCache.set(cacheKey, {
            allIcons: allIcons,
            isComplete: false,
            searchedTerms: searchedTerms
        });

        searchRelatedTermsInBackground(cacheKey, remainingTerms, allIcons, searchedTerms);

        return { icons: allIcons, isComplete: false };
    } catch (error) {
        return { error: error.message };
    }
}

async function searchRelatedTermsInBackground(cacheKey, relatedTerms, initialIcons, alreadySearchedTerms) {
    try {
        let allIcons = [...initialIcons];
        const searchedTerms = Array.isArray(alreadySearchedTerms) ? [...alreadySearchedTerms] : [];

        for (const term of relatedTerms) {
            const additionalResults = await searchIcons(term);
            if (additionalResults.icons) {
                const existingIds = new Set(allIcons.map(i => i.mediaId || i.id));
                const newIcons = additionalResults.icons.filter(i => !existingIds.has(i.mediaId || i.id));
                allIcons = allIcons.concat(newIcons);
                searchedTerms.push(term);

                categorySearchCache.set(cacheKey, {
                    allIcons: allIcons,
                    isComplete: false,
                    searchedTerms: searchedTerms
                });
            }
        }

        categorySearchCache.set(cacheKey, {
            allIcons: allIcons,
            isComplete: true,
            searchedTerms: searchedTerms
        });
    } catch (error) {
        console.error('Background search error:', error);
    }
}

function getRelatedTerms(category) {
    const categoryMap = {
        'animals': ['animal', 'pet', 'zoo', 'farm', 'wildlife', 'dog', 'cat', 'bird', 'bear'],
        'art': ['paint', 'draw', 'color', 'crayon', 'paintbrush', 'palette', 'pencil', 'easel', 'scissors'],
        'buildings': ['house', 'home', 'office', 'city', 'architecture', 'building', 'tower'],
        'chapters': ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'number', 'numbers', 'book'],
        'emotions': ['happy', 'sad', 'love', 'angry', 'smile', 'heart', 'feeling', 'silly', 'laugh'],
        'fantasy': ['magic', 'fairy', 'dragon', 'unicorn', 'wizard', 'castle', 'princess'],
        'food': ['fruit', 'vegetable', 'meal', 'snack', 'drink', 'cooking', 'kitchen', 'cook', 'bake', 'ice cream'],
        'games': ['play', 'toy', 'puzzle', 'board', 'video', 'fun', 'entertainment'],
        'holiday': ['christmas', 'easter', 'halloween', 'birthday', 'celebration', 'party', 'santa', 'holly',],
        'music': ['musical', 'instrument', 'song', 'note', 'piano', 'guitar', 'drum'],
        'nature': ['tree', 'flower', 'plant', 'forest', 'mountain', 'sun', 'cloud', 'ocean'],
        'school': ['education', 'learning', 'book', 'pencil', 'classroom', 'teacher', 'student'],
        'science': ['experiment', 'chemistry', 'physics', 'biology', 'lab', 'research', 'magnet', 'electricity', 'lab coat', 'evolution'],
        'space': ['star', 'planet', 'moon', 'rocket', 'astronaut', 'galaxy', 'universe'],
        'sports': ['sport', 'ball', 'game', 'team', 'football', 'basketball', 'soccer', 'baseball', 'volleyball', 'tennis'],
        'tools': ['hammer', 'wrench', 'screwdriver', 'build', 'fix', 'repair', 'construction'],
        'transportation': ['car', 'train', 'plane', 'boat', 'bike', 'bus', 'vehicle', 'truck'],
        'weather': ['rain', 'snow', 'sun', 'cloud', 'storm', 'wind', 'temperature', 'umbrella']
    };
    
    const lowerCategory = category.toLowerCase();
    return categoryMap[lowerCategory] || [category];
}

async function applyCategoryIcons(cardId, selectedIcons, selectedTracks) {
    try {
        const cardContent = await getCardContent(cardId);
        if (cardContent.error) {
            return { error: cardContent.error };
        }

        if (!cardContent.card?.content?.chapters || !Array.isArray(cardContent.card.content.chapters)) {
            return { error: 'No chapters found in card' };
        }

        const processedIcons = [];
        for (const icon of selectedIcons) {
            let processedIcon = icon;

            if (icon.source === 'yotoicons' || icon.source === 'yotoicons-uploaded' || (icon.url && icon.url.includes('yotoicons.com'))) {
                const uploadResult = await downloadAndUploadIcon({
                    id: icon.originalIconId || icon.id,
                    url: icon.url,
                    title: icon.title,
                    author: icon.author,
                    searchQuery: icon.searchQuery || ''
                });

                if (uploadResult) {
                    processedIcon = uploadResult;
                }
            }

            let iconId = processedIcon.iconId || processedIcon.mediaId || processedIcon.displayIconId;
            if (iconId && !iconId.startsWith('yoto:#')) {
                iconId = `yoto:#${iconId}`;
            }

            processedIcons.push(iconId);
        }

        const selectedTrackTitles = new Set(selectedTracks.map(t => t.title));

        let iconIndex = 0;
        let iconsUpdated = 0;

        cardContent.card.content.chapters.forEach((chapter) => {
            let shouldUpdateChapter = false;

            if (chapter.tracks && chapter.tracks.length > 0) {
                chapter.tracks.forEach((track) => {
                    if (selectedTrackTitles.has(track.title)) {
                        shouldUpdateChapter = true;

                        const iconId = processedIcons[iconIndex % processedIcons.length];

                        if (!track.display) {
                            track.display = {};
                        }
                        track.display.icon16x16 = iconId;

                        iconsUpdated++;
                        iconIndex++;
                    }
                });
            }

            if (shouldUpdateChapter && chapter.tracks && chapter.tracks.length > 0) {
                const firstTrack = chapter.tracks[0];
                if (firstTrack.display && firstTrack.display.icon16x16) {
                    if (!chapter.display) {
                        chapter.display = {};
                    }
                    chapter.display.icon16x16 = firstTrack.display.icon16x16;
                }
            }
        });
        
        if (iconsUpdated === 0) {
            return { error: 'No chapters found to update' };
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
        
        const updateResult = await makeAuthenticatedRequest(
            '/content',
            {
                method: 'POST',
                body: JSON.stringify(requestBody)
            }
        );
        
        if (updateResult.error) {
            return { error: updateResult.error };
        }
        
        return { 
            success: true, 
            appliedCount: iconsUpdated,
            totalTracks: cardContent.card.content.chapters.length 
        };
        
    } catch (error) {
        return { error: error.message };
    }
}

async function matchIcons(tracks) {
    const matches = [];
    
    // Common words to exclude from searches (stop words)
    const stopWords = new Set([
        'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
        'before', 'after', 'above', 'below', 'between', 'under', 'how', 'what',
        'when', 'where', 'why', 'who', 'which', 'i', 'me', 'my', 'we', 'our',
        'you', 'your', 'he', 'she', 'it', 'they', 'them', 'their', 'this',
        'that', 'these', 'those', 'is', 'are', 'was', 'were', 'be', 'been',
        'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
        'could', 'should', 'may', 'might', 'must', 'can', 'shall'
    ]);
    
    const extractKeywords = (title) => {
        const words = title
            .toLowerCase()
            .replace(/['']s\b/gi, '') // Remove possessives
            .replace(/[^\w\s]/g, ' ') // Remove punctuation
            .split(/\s+/)
            .filter(word => {
                // Keep words that are:
                // - At least 2 characters long
                // - Not in the stop words list
                // - Not just numbers
                return word.length >= 2 && 
                       !stopWords.has(word) && 
                       !/^\d+$/.test(word);
            });
        
        return [...new Set(words)];
    };

    for (const track of tracks) {
        let iconOptions = [];

        // Translate track title to English if not already in English (do this once per track)
        const translatedTitle = await TranslationService.translateToEnglish(track.title);
        const searchTitle = translatedTitle || track.title;

        try {
            const cleanedTitle = searchTitle
                .replace(/['']s\b/gi, '') // Remove possessives
                .replace(/[^\w\s]/g, ' ') // Remove punctuation
                .split(/\s+/)
                .filter(word => word.length > 0 && !stopWords.has(word.toLowerCase()))
                .join(' ')
                .trim();

            const fullResults = await searchIcons(cleanedTitle);
            if (fullResults.icons && fullResults.icons.length > 0) {
                const validIcons = fullResults.icons.filter(icon => {
                    return !icon.isPlaceholder && icon.url && (icon.url.startsWith('http') || icon.url.startsWith('data:'));
                }).slice(0, 15);

                iconOptions = validIcons.map(icon => {
                    let iconUrl = icon.url || icon.mediaUrl || null;

                    if (!iconUrl && icon.mediaId) {
                        iconUrl = `https://api.yotoplay.com/media/${icon.mediaId}`;
                    }

                    const isValidUrl = iconUrl && (
                        iconUrl.startsWith('http') ||
                        iconUrl.startsWith('data:')
                    );

                    return {
                        url: isValidUrl ? iconUrl : null,
                        iconId: icon.mediaId || icon.id || icon.displayIconId || icon.iconId,
                        title: icon.title || null
                    };
                });

                iconOptions = iconOptions.filter(option => option.url !== null);
            }
        } catch (error) {}

        // Always search keywords if we have 0 results, or if we have fewer than 3 results
        // This ensures phrases like "The Poop Collector" (0 results) get keyword searches,
        // while still allowing phrases like "Lightning McQueen" to show full phrase results first
        const MAX_ICONS_PER_TRACK = 15;

        if (iconOptions.length === 0 || iconOptions.length < 3) {
            // Use translated title for keyword extraction
            const keywords = extractKeywords(searchTitle);

            if (keywords.length > 0) {
                const remainingSlots = MAX_ICONS_PER_TRACK - iconOptions.length;
                const iconsPerKeyword = Math.ceil(remainingSlots / keywords.length);

                const keywordResults = new Map(); // Track results per keyword for backfill

                for (const keyword of keywords) {
                    try {
                        const results = await searchIcons(keyword);
                        if (results.icons && results.icons.length > 0) {
                            const validIcons = results.icons.filter(icon =>
                                !icon.isPlaceholder &&
                                !iconOptions.some(opt => opt.iconId === (icon.mediaId || icon.id || icon.displayIconId))
                            );

                            keywordResults.set(keyword, validIcons);

                            const iconsToTake = Math.min(iconsPerKeyword, validIcons.length);
                            const selectedIcons = validIcons.slice(0, iconsToTake);

                            const newOptions = selectedIcons.map(icon => {
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
                            }).filter(option => option.url !== null);

                            iconOptions = iconOptions.concat(newOptions);
                        }
                    } catch (error) {}
                }

                // Second pass: backfill if we still have slots available
                if (iconOptions.length < MAX_ICONS_PER_TRACK) {
                    for (const [, validIcons] of keywordResults) {
                        if (iconOptions.length >= MAX_ICONS_PER_TRACK) break;

                        // Skip icons we already used
                        const unusedIcons = validIcons.filter(icon =>
                            !iconOptions.some(opt => opt.iconId === (icon.mediaId || icon.id || icon.displayIconId))
                        );

                        const remainingSlots = MAX_ICONS_PER_TRACK - iconOptions.length;
                        const iconsToTake = Math.min(remainingSlots, unusedIcons.length);

                        if (iconsToTake > 0) {
                            const selectedIcons = unusedIcons.slice(0, iconsToTake);

                            const newOptions = selectedIcons.map(icon => {
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
                            }).filter(option => option.url !== null);

                            iconOptions = iconOptions.concat(newOptions);
                        }
                    }
                }
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
        const yotoDefaultIcon = 'yoto:#aUm9i3ex3qqAMYBv-i-O-pYMKuMJGICtR3Vhf289u2Q';

        const cardContent = await getCardContent(cardId);
        if (cardContent.error) {
            return {success: false, error: 'Failed to get card content'};
        }

        let iconsUpdated = 0;

        const processedIconMatches = [];
        for (const match of iconMatches) {
            let processedMatch = {...match};

            if (match.suggestedIcon && match.suggestedIcon.includes('yotoicons.com')) {
                try {
                    const uploadResult = await downloadAndUploadIcon({
                        id: match.iconId,
                        url: match.suggestedIcon,
                        title: match.iconTitle || match.trackTitle,
                        author: '',
                        searchQuery: match.trackTitle
                    });

                    if (uploadResult && uploadResult.iconId) {
                        processedMatch.iconId = uploadResult.iconId;
                    }
                } catch (error) {
                    console.error('[Icon Match] Failed to upload icon:', error);
                }
            }

            processedIconMatches.push(processedMatch);
        }

        if (cardContent.card.content.chapters && Array.isArray(cardContent.card.content.chapters)) {
            cardContent.card.content.chapters.forEach((chapter) => {
                let hasMatch = false;
                let chapterIconId = null;

                if (chapter.tracks && chapter.tracks.length > 0) {
                    for (const track of chapter.tracks) {
                        const iconMatch = processedIconMatches.find(match =>
                            match.trackTitle === track.title
                        );

                        if (iconMatch && iconMatch.iconId) {
                            hasMatch = true;
                            chapterIconId = iconMatch.iconId.startsWith('yoto:#')
                                ? iconMatch.iconId
                                : `yoto:#${iconMatch.iconId}`;
                            break;
                        }
                    }
                }

                if (hasMatch && chapterIconId) {
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
                }
                // If no match found, preserve the existing icon
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
            content: cardContent.card.content,  // Use the modified original content
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
            if (e.message && (e.message.includes('403') || e.message.includes('forbidden'))) {
                return {
                    success: false,
                    error: 'The Yoto API requires special permissions to update this card (403 Forbidden).'
                };
            }
            return {success: false, error: e.message || 'Failed to update card icons'};
        }

    } catch (error) {
        if (error.message && (error.message.includes('403') || error.message.includes('forbidden'))) {
            return {
                success: false,
                error: 'The Yoto API requires special permissions to update this card (403 Forbidden).'
            };
        }
        return {success: false, error: error.message || 'Failed to update card icons'};
    }
}

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

async function uploadCoverImage(imageFileData) {
    try {
        const binaryString = atob(imageFileData.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        const imageFile = new File([bytes], imageFileData.name || 'cover.png', {
            type: imageFileData.type || 'image/png'
        });
        
        const response = await makeAuthenticatedRequest(
            `/media/coverImage/user/me/upload?coverType=default`,
            {
                method: 'POST',
                body: bytes.buffer, // Send the ArrayBuffer directly
                headers: {
                    'Content-Type': imageFileData.type || 'image/png'
                }
            }
        );
        
        if (response.error) {
            return { error: response.error };
        }
        
        // The response should contain the URL for the uploaded cover image
        // Based on the actual response structure: { coverImage: { mediaId, mediaUrl } }
        if (response.coverImage && response.coverImage.mediaUrl) {
            return {
                success: true,
                url: response.coverImage.mediaUrl,
                mediaId: response.coverImage.mediaId
            };
        }
        
        // Fallback checks for other possible response structures
        if (response.url) {
            return {
                success: true,
                url: response.url
            };
        } else if (response.imageUrl) {
            return {
                success: true,
                url: response.imageUrl
            };
        } else if (response.mediaUrl) {
            return {
                success: true,
                url: response.mediaUrl
            };
        }
        
        return { error: 'Unexpected response structure from cover upload' };
    } catch (error) {
        return { error: error.message };
    }
}

async function uploadIcon(iconFileData) {
    const uploadStartTime = Date.now();
    const fileSize = iconFileData.data ? iconFileData.data.length * 0.75 : 0;

    try {
        const binaryString = atob(iconFileData.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        // Extract filename without extension for the query parameter
        const filename = iconFileData.name ? iconFileData.name.split('.')[0] : 'icon';

        const response = await makeAuthenticatedRequest(
            `/media/displayIcons/user/me/upload?autoConvert=true&filename=${encodeURIComponent(filename)}`,
            {
                method: 'POST',
                body: bytes.buffer,  // Send the ArrayBuffer directly
                headers: {
                    'Content-Type': iconFileData.type || 'image/png'
                }
            }
        );
        
        if (response.error) {
            if (typeof YotoAnalytics !== 'undefined') {
                YotoAnalytics.trackUploadPerformance('icon', Date.now() - uploadStartTime, fileSize, false, response.error);
            }
            return { error: response.error };
        }

        if (response.displayIcon) {
            const mediaId = response.displayIcon.mediaId;
            if (typeof YotoAnalytics !== 'undefined') {
                YotoAnalytics.trackUploadPerformance('icon', Date.now() - uploadStartTime, fileSize, true);
            }
            return {
                success: true,
                iconId: mediaId.startsWith('yoto:#') ? mediaId : `yoto:#${mediaId}`,
                mediaId: response.displayIcon.mediaId,
                displayIconId: response.displayIcon.displayIconId,
                isNew: response.displayIcon.new || false
            };
        }

        const errorMsg = 'No icon data in response';
        if (typeof YotoAnalytics !== 'undefined') {
            YotoAnalytics.trackUploadPerformance('icon', Date.now() - uploadStartTime, fileSize, false, errorMsg);
        }
        return { error: errorMsg };
    } catch (error) {
        if (typeof YotoAnalytics !== 'undefined') {
            YotoAnalytics.trackUploadPerformance('icon', Date.now() - uploadStartTime, fileSize, false, error.message);
        }
        return { error: error.message };
    }
}

async function uploadGif(gifFileData) {
    const uploadStartTime = Date.now();
    const fileSize = gifFileData.data ? gifFileData.data.length * 0.75 : 0;

    try {
        const binaryString = atob(gifFileData.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const filename = gifFileData.name ? gifFileData.name.split('.')[0] : 'icon';

        // Use autoConvert=false to preserve GIF animation (requires 16x16 dimensions)
        const response = await makeAuthenticatedRequest(
            `/media/displayIcons/user/me/upload?autoConvert=false&filename=${encodeURIComponent(filename)}`,
            {
                method: 'POST',
                body: bytes.buffer,
                headers: {
                    'Content-Type': 'image/gif'
                }
            }
        );

        if (response.error) {
            if (typeof YotoAnalytics !== 'undefined') {
                YotoAnalytics.trackUploadPerformance('gif', Date.now() - uploadStartTime, fileSize, false, response.error);
            }
            return { error: response.error };
        }

        if (response.displayIcon) {
            const mediaId = response.displayIcon.mediaId;
            if (typeof YotoAnalytics !== 'undefined') {
                YotoAnalytics.trackUploadPerformance('gif', Date.now() - uploadStartTime, fileSize, true);
            }
            return {
                success: true,
                iconId: mediaId.startsWith('yoto:#') ? mediaId : `yoto:#${mediaId}`,
                mediaId: response.displayIcon.mediaId,
                displayIconId: response.displayIcon.displayIconId,
                isNew: response.displayIcon.new || false
            };
        }

        const errorMsg = 'No icon data in response';
        if (typeof YotoAnalytics !== 'undefined') {
            YotoAnalytics.trackUploadPerformance('gif', Date.now() - uploadStartTime, fileSize, false, errorMsg);
        }
        return { error: errorMsg };
    } catch (error) {
        if (typeof YotoAnalytics !== 'undefined') {
            YotoAnalytics.trackUploadPerformance('gif', Date.now() - uploadStartTime, fileSize, false, error.message);
        }
        return { error: error.message };
    }
}

async function uploadAudioFile(audioFileData) {
    const uploadStartTime = Date.now();
    const fileSize = audioFileData.blob?.size || 0;
    const fileSizeMB = fileSize / 1024 / 1024;
    const fileName = audioFileData.name || 'Unknown';

    // Warn about very large files
    if (fileSizeMB > 100) {
        console.warn(`[Upload] Large file warning: ${fileName} is ${fileSizeMB.toFixed(2)}MB. Files over 100MB may experience transcoding issues.`);
    }

    try {
        const getUrlStartTime = Date.now();
        const uploadUrlResponse = await makeAuthenticatedRequest('/media/transcode/audio/uploadUrl', {
            method: 'GET'
        });

        if (typeof YotoAnalytics !== 'undefined') {
            YotoAnalytics.trackUploadLatency('get_upload_url', Date.now() - getUrlStartTime, 'audio');
        }

        if (uploadUrlResponse.needsAuth) {
            return { error: 'Authentication required. Please log in again.' };
        }

        if (uploadUrlResponse.error) {
            return { error: uploadUrlResponse.error };
        }

        const { upload } = uploadUrlResponse;
        if (!upload?.uploadUrl || !upload?.uploadId) {
            return { error: 'Failed to get upload URL - invalid response structure' };
        }

        // Upload to S3 with retry logic for rate limiting
        let uploadAttempts = 0;
        const maxUploadAttempts = 3;
        let uploadResponse;
        const s3UploadStartTime = Date.now();

        while (uploadAttempts < maxUploadAttempts) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes

                uploadResponse = await fetch(upload.uploadUrl, {
                    method: 'PUT',
                    body: audioFileData.blob,
                    headers: {
                        'Content-Type': audioFileData.type || 'audio/mpeg'
                    },
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                // Handle S3 rate limiting (429 or 503)
                if (uploadResponse.status === 429 || uploadResponse.status === 503) {
                    uploadAttempts++;
                    const retryAfter = uploadResponse.headers.get('Retry-After');
                    const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.min(2000 * Math.pow(2, uploadAttempts - 1), 10000);

                    if (typeof YotoAnalytics !== 'undefined') {
                        YotoAnalytics.trackRateLimitEvent('s3_upload', uploadAttempts, delay);
                    }

                    if (uploadAttempts >= maxUploadAttempts) {
                        const errorMsg = `Upload rate limited after ${maxUploadAttempts} attempts. Please wait and try again.`;
                        if (typeof YotoAnalytics !== 'undefined') {
                            YotoAnalytics.trackUploadPerformance('audio', Date.now() - uploadStartTime, fileSize, false, errorMsg);
                        }
                        return { error: errorMsg };
                    }

                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                break; // Success or non-retryable error
            } catch (fetchError) {
                uploadAttempts++;

                const isTimeout = fetchError.name === 'AbortError';
                const errorMsg = isTimeout ? 'Upload timed out after 5 minutes' : fetchError.message;

                // Use warn for retries, error only for final failure
                if (uploadAttempts >= maxUploadAttempts) {
                    console.error(`[Upload] S3 fetch failed (attempt ${uploadAttempts}/${maxUploadAttempts}):`, errorMsg);
                } else {
                    console.warn(`[Upload] S3 fetch failed (attempt ${uploadAttempts}/${maxUploadAttempts}), retrying...`, errorMsg);
                }

                if (uploadAttempts >= maxUploadAttempts) {
                    const finalError = `S3 upload failed after ${maxUploadAttempts} attempts: ${errorMsg}`;
                    if (typeof YotoAnalytics !== 'undefined') {
                        YotoAnalytics.trackUploadPerformance('audio', Date.now() - uploadStartTime, fileSize, false, finalError);
                    }
                    return { error: finalError };
                }

                // Exponential backoff for retries
                const delay = Math.min(2000 * Math.pow(2, uploadAttempts - 1), 10000);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
        }

        if (typeof YotoAnalytics !== 'undefined') {
            YotoAnalytics.trackUploadLatency('s3_upload', Date.now() - s3UploadStartTime, 'audio');
            // Track that this was a direct S3 upload for large files
            YotoAnalytics.sendEvent('large_file_upload', {
                file_size_mb: Math.round(fileSizeMB * 100) / 100,
                upload_method: 'direct_s3',
                s3_upload_duration_ms: Date.now() - s3UploadStartTime
            });
        }

        if (!uploadResponse.ok) {
            const errorMsg = `Failed to upload audio file: ${uploadResponse.status} ${uploadResponse.statusText}`;
            if (typeof YotoAnalytics !== 'undefined') {
                YotoAnalytics.trackUploadPerformance('audio', Date.now() - uploadStartTime, fileSize, false, errorMsg);
            }
            return { error: errorMsg };
        }


        let transcodedAudio = null;
        let attempts = 0;

        // Adaptive timeout based on file size
        const baseAttempts = 30;
        const additionalAttempts = fileSizeMB > 35 ? Math.floor((fileSizeMB - 35) / 5) : 0;
        const maxAttempts = Math.min(baseAttempts + additionalAttempts, 120);

        let pollInterval = 500;
        const maxPollInterval = 5000; // Max 5 seconds between polls
        let totalElapsedTime = 0;
        const transcodingStartTime = Date.now();


        while (attempts < maxAttempts) {
            const transcodeResponse = await makeAuthenticatedRequest(
                `/media/upload/${upload.uploadId}/transcoded?loudnorm=false`
            );

            if (transcodeResponse.error) {
                // If we get a specific error, don't keep retrying
                if (transcodeResponse.error.includes('403') ||
                    transcodeResponse.error.includes('forbidden') ||
                    transcodeResponse.error.includes('not allowed')) {
                    console.error(`[Transcoding] Upload rejected for ${fileName}: ${transcodeResponse.error}`);
                    return { error: `Upload rejected: ${transcodeResponse.error}. The file may contain copyrighted content.` };
                }

                // Check for permanent errors
                if (transcodeResponse.error.includes('404') ||
                    transcodeResponse.error.includes('not found')) {
                    console.error(`[Transcoding] Upload not found for ${fileName}: ${transcodeResponse.error}`);
                    return { error: `Upload failed: ${transcodeResponse.error}. Please try uploading again.` };
                }

                // Handle rate limiting - increase backoff significantly
                if (transcodeResponse.error.includes('429') ||
                    transcodeResponse.error.includes('rate limit') ||
                    transcodeResponse.error.includes('too many')) {
                    pollInterval = Math.min(pollInterval * 2, 10000); // Double the interval, max 10s
                }
            }

            // Check for successful transcoding
            if (!transcodeResponse.error && transcodeResponse.transcode?.transcodedSha256) {
                transcodedAudio = transcodeResponse.transcode;
                break;
            }

            // Also check alternate response structure
            if (!transcodeResponse.error && transcodeResponse.transcodedAudio?.transcodedSha256) {
                transcodedAudio = transcodeResponse.transcodedAudio;
                break;
            }

            await new Promise(resolve => setTimeout(resolve, pollInterval));
            totalElapsedTime += pollInterval;
            attempts++;

            // Exponential backoff: increase interval by 1.5x each attempt, up to max
            pollInterval = Math.min(Math.floor(pollInterval * 1.5), maxPollInterval);
        }

        if (!transcodedAudio) {
            const totalTimeSeconds = Math.ceil(totalElapsedTime / 1000);
            const errorMsg = `Transcoding timed out after ${totalTimeSeconds} seconds (${attempts} attempts). The file may be too large or in an unsupported format.`;
            if (typeof YotoAnalytics !== 'undefined') {
                YotoAnalytics.trackUploadPerformance('audio', Date.now() - uploadStartTime, fileSize, false, errorMsg);
            }
            return { error: errorMsg };
        }

        if (typeof YotoAnalytics !== 'undefined') {
            const transcodingDuration = Date.now() - transcodingStartTime;
            YotoAnalytics.trackUploadPerformance('audio', Date.now() - uploadStartTime, fileSize, true);
            YotoAnalytics.trackUploadLatency('transcoding', transcodingDuration, 'audio');
            // Track transcoding performance separately
            YotoAnalytics.sendEvent('transcoding_performance', {
                file_size_mb: Math.round(fileSizeMB * 100) / 100,
                transcoding_duration_ms: transcodingDuration,
                polling_attempts: attempts,
                success: true
            });
        }

        return {
            success: true,
            transcodedAudio,
            uploadId: upload.uploadId
        };
    } catch (error) {
        if (typeof YotoAnalytics !== 'undefined') {
            YotoAnalytics.trackUploadPerformance('audio', Date.now() - uploadStartTime, fileSize, false, error.message);
        }
        return { error: error.message };
    }
}

function generateRandomId() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

async function updatePlaylistContent(cardId, existingChapters, newTracks, newIcons, metadata, title) {
    try {
        const cardContent = await getCardContent(cardId);
        if (cardContent.error) {
            return { error: cardContent.error };
        }

        let chapters = [...(existingChapters || [])];

        if (newTracks && newTracks.length > 0) {
            let maxChapterNum = 0;
            chapters.forEach(chapter => {
                const num = parseInt(chapter.key);
                if (!isNaN(num) && num > maxChapterNum) {
                    maxChapterNum = num;
                }
            });

            newTracks.forEach((track, index) => {
                const chapterNum = maxChapterNum + index + 1;
                const chapterKey = String(chapterNum).padStart(2, '0');

                let iconId = 'yoto:#aUm9i3ex3qqAMYBv-i-O-pYMKuMJGICtR3Vhf289u2Q';
                if (newIcons && newIcons[index]) {
                    iconId = newIcons[index].startsWith('yoto:#') ? newIcons[index] : `yoto:#${newIcons[index]}`;
                }

                let format = track.format || 'mp3';
                const validFormats = ['mp3', 'aac', 'alac', 'flac', 'pcm_s16le', 'opus', 'ogg', 'x-m4a', 'wav', 'aiff', 'mpeg'];
                if (!validFormats.includes(format)) {
                    format = 'mp3';
                }

                const chapter = {
                    key: chapterKey,
                    title: track.title || `Track ${chapterNum}`,
                    overlayLabel: String(chapterNum),
                    display: {
                        icon16x16: iconId,
                        overlayLabel: {
                            label: String(chapterNum)
                        }
                    },
                    tracks: [{
                        format: format,
                        key: track.key,
                        trackId: generateRandomId(),
                        title: track.title || `Track ${chapterNum}`,
                        trackUrl: track.trackUrl || `yoto:#${track.key}`,
                        type: 'audio',
                        display: {
                            icon16x16: iconId
                        },
                        duration: track.duration || 0
                    }]
                };

                chapters.push(chapter);
            });
        }
        // If we only have icons (no new tracks), update existing chapters with new icons
        else if (newIcons && newIcons.length > 0) {
            chapters.forEach((chapter, chapterIndex) => {
                if (newIcons[chapterIndex]) {
                    const iconId = newIcons[chapterIndex].startsWith('yoto:#')
                        ? newIcons[chapterIndex]
                        : `yoto:#${newIcons[chapterIndex]}`;

                    if (chapter.display) {
                        chapter.display.icon16x16 = iconId;
                    } else {
                        chapter.display = { icon16x16: iconId };
                    }

                    if (chapter.tracks && Array.isArray(chapter.tracks)) {
                        chapter.tracks.forEach(track => {
                            if (track.display) {
                                track.display.icon16x16 = iconId;
                            } else {
                                track.display = { icon16x16: iconId };
                            }
                        });
                    }
                }
            });
        }

        const updateBody = {
            createdByClientId: cardContent.card.createdByClientId,
            cardId: cardId,
            userId: cardContent.card.userId,
            createdAt: cardContent.card.createdAt,
            updatedAt: new Date().toISOString(),
            content: {
                ...cardContent.card.content,
                chapters: chapters
            },
            metadata: metadata || cardContent.card.metadata || {},
            title: title || cardContent.card.title || "Untitled"
        };

        const updateResponse = await makeAuthenticatedRequest(
            '/content',
            {
                method: 'POST',
                body: JSON.stringify(updateBody)
            }
        );

        if (updateResponse.error) {
            return { error: updateResponse.error };
        }

        const addedTracks = (newTracks && newTracks.length > 0) ? newTracks.length : 0;
        const updatedIcons = (newIcons && newTracks && newTracks.length === 0) ? newIcons.filter(icon => icon).length : 0;

        return {
            success: true,
            cardId: cardId,
            addedTracks: addedTracks,
            updatedIcons: updatedIcons,
            totalChapters: chapters.length
        };

    } catch (error) {
        return { error: error.message };
    }
}

async function createPlaylistContent(title, audioTracks, iconIds = [], coverUrl = null, isVisualTimer = false, alwaysPlayFromStart = null) {
    try {
        const chapters = audioTracks.map((audio, index) => {
            const chapterKey = String(index + 1).padStart(2, '0');
            // Use yoto:# format for icons - this is what the API expects
            const iconId = iconIds[index] || 'yoto:#aUm9i3ex3qqAMYBv-i-O-pYMKuMJGICtR3Vhf289u2Q'; // Default Yoto icon

            const chapter = {
                key: chapterKey,
                title: audio.title || `Track ${index + 1}`,
                tracks: [{
                    key: chapterKey,
                    title: audio.title || `Track ${index + 1}`,
                    trackUrl: `yoto:#${audio.transcodedAudio.transcodedSha256}`,
                    duration: audio.transcodedAudio.transcodedInfo?.duration,
                    fileSize: audio.transcodedAudio.transcodedInfo?.fileSize,
                    channels: audio.transcodedAudio.transcodedInfo?.channels === 1 ? 'mono' : 'stereo',
                    format: audio.transcodedAudio.transcodedInfo?.format,
                    type: 'audio',
                    display: {
                        icon16x16: iconId
                    }
                }],
                display: {
                    icon16x16: iconId
                },
                fileSize: audio.transcodedAudio.transcodedInfo?.fileSize,
                duration: audio.transcodedAudio.transcodedInfo?.duration,
                availableFrom: null,
                ambient: null,
                defaultTrackDisplay: null,
                defaultTrackAmbient: null
            };

            // Only add overlayLabel for non-Visual Timer playlists
            if (!isVisualTimer) {
                chapter.overlayLabel = String(index + 1);
                chapter.tracks[0].overlayLabel = String(index + 1);
            }

            return chapter;
        });
        
        const totalDuration = audioTracks.reduce((sum, audio) => 
            sum + (audio.transcodedAudio.transcodedInfo?.duration || 0), 0);
        const totalFileSize = audioTracks.reduce((sum, audio) => 
            sum + (audio.transcodedAudio.transcodedInfo?.fileSize || 0), 0);
        
        const tokens = await TokenManager.getTokens();
        let userId = 'unknown';
        if (tokens?.access_token) {
            try {
                const payload = JSON.parse(atob(tokens.access_token.split('.')[1]));
                userId = payload.sub || 'unknown';
            } catch (e) {
                // Ignore decode errors for user ID
            }
        }
        
        // Ensure coverUrl is a string or null
        const coverUrlString = typeof coverUrl === 'string' ? coverUrl : null;
        
        const metadata = {
            description: '',
            media: {
                duration: totalDuration,
                readableDuration: formatDuration(totalDuration),
                fileSize: totalFileSize,
                readableFileSize: Math.round((totalFileSize / 1024 / 1024) * 10) / 10,
                hasStreams: false
            },
            visible: true,
            category: 'music'
        };
        
        // Only add cover if we have a valid URL
        if (coverUrlString) {
            metadata.cover = {
                imageL: coverUrlString
            };
        }
        
        let configSettings = {
            resumeTimeout: 2592000 // Default: 30 days
        };

        // If alwaysPlayFromStart is explicitly set, use it
        if (alwaysPlayFromStart !== null) {
            configSettings.resumeTimeout = alwaysPlayFromStart ? 0 : 2592000;
        } else if (isVisualTimer) {
            configSettings.resumeTimeout = 0; // Default for timers: always play from start
        }

        if (configSettings.resumeTimeout === 0) {
        }

        const content = {
            content: {
                chapters,
                playbackType: 'linear',
                config: configSettings
            },
            metadata: metadata,
            title: title,
            createdByClientId: CONFIG.YOTO_CLIENT_ID,
            userId: userId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        let createResponse = await makeAuthenticatedRequest('/content', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(content)
        });
        
        // If it fails with a cover, try without the cover
        if (createResponse.error && coverUrlString) {
            delete metadata.cover;
            const contentWithoutCover = {
                ...content,
                metadata: metadata
            };
            
            createResponse = await makeAuthenticatedRequest('/content', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(contentWithoutCover)
            });
            
            if (!createResponse.error) {
                // Retry without cover succeeded
            }
        }
        
        if (createResponse.cardId) {
            // Try to fetch the created card to verify it exists
            try {
                const verifyResponse = await makeAuthenticatedRequest(`/content/${createResponse.cardId}`);
            } catch (e) {
                // Verification failed, but card was created successfully
            }
        }

        return createResponse;
    } catch (error) {
        return { error: error.message };
    }
}

// Cache implementation for API responses
const apiCache = {
    cache: new Map(),
    
    getKey: (endpoint, params = {}) => {
        const sortedParams = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
        return `${endpoint}?${sortedParams}`;
    },
    
    get: function(endpoint, params = {}, ttlMinutes = 60) {
        const key = this.getKey(endpoint, params);
        const cached = this.cache.get(key);
        
        if (!cached) return null;
        
        const now = Date.now();
        const age = (now - cached.timestamp) / 1000 / 60; // age in minutes
        
        if (age > ttlMinutes) {
            this.cache.delete(key);
            return null;
        }
        
        return cached.data;
    },
    
    set: function(endpoint, params = {}, data) {
        const key = this.getKey(endpoint, params);
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    },
    
    clear: function(endpoint = null) {
        if (endpoint) {
            const keysToDelete = [];
            for (const key of this.cache.keys()) {
                if (key.startsWith(endpoint)) {
                    keysToDelete.push(key);
                }
            }
            keysToDelete.forEach(key => this.cache.delete(key));
        } else {
            this.cache.clear();
        }
    }
};

// Curated podcast recommendations with iTunes IDs
// To add more: find iTunes ID from podcast URL (e.g., .../id1233834541 -> '1233834541')
const CURATED_PODCASTS = [
    { itunesId: '1233834541', name: 'Wow in the World' },
    { itunesId: '719585944', name: 'Story Pirates' },
    { itunesId: '1103320303', name: 'But Why' },
    { itunesId: '703720228', name: 'Brains On!' },
    { itunesId: '1483233279', name: 'Greeking Out' },
    { itunesId: '1504895463', name: 'Terrestrials' },
    { itunesId: '1718989781', name: 'Work It Out Wombats!' },
    { itunesId: '984771479', name: 'Tumble Science' },
    { itunesId: '1561861786', name: 'Goodnight World!' },
    { itunesId: '1506815544', name: 'Thomas & Friends' },
    { itunesId: '1746567248', name: 'Smologies' },
    { itunesId: '1687544181', name: 'Keyshawn Solves It' },
    { itunesId: '1450820162', name: 'Molly of Denali' },
    { itunesId: '1565581033', name: "Quentin and Alfie's" },
    { itunesId: '1479312117', name: 'Eat Your Spanish' },
    { itunesId: '1139672164', name: 'The Alien Adventures of Finn Caspian' },
    { itunesId: '1836539554', name: 'The Bedtime Scientist' },
    { itunesId: '1711281052', name: 'Silly Stories for Kids' },
    { itunesId: '1648149849', name: 'Arthur' },
    { itunesId: '1348469682', name: 'The Big Fib' },
    { itunesId: '1771688947', name: 'Momma Bear Audio' },
    { itunesId: '1597620394', name: 'Koala Moon' },
    { itunesId: '1635154611', name: 'Yoto Daily' },
    { itunesId: '1838933610', name: 'The Download' },
    { itunesId: '1739331611', name: "Blippi & Meekah's Road Trip" },
    { itunesId: '1243077660', name: 'The Purple Rocket Podcast' },
    { itunesId: '1836987791', name: 'The Gnomes of Wondergarten' },
    { itunesId: '1786330034', name: 'Sleepytime Pups' },
    { itunesId: '1574162442', name: "Lei's Little Golden Books" },
    { itunesId: '1613054810', name: 'Ryers Readers' },
    { itunesId: '1533462141', name: 'Who Smarted?' },
    { itunesId: '1418029100', name: 'KidNuz' },
    { itunesId: '1566472174', name: 'Whose Amazing Life?' },
    { itunesId: '1440083927', name: 'Forever Ago' },
    { itunesId: '948976028', name: 'Stories Podcast' },
    { itunesId: '1382789861', name: 'Smash Boom Best' }
];

// Static fallback data for when API is unavailable or limit reached
const staticPodcastData = {
    popularKidsPodcasts: [
        {
            id: "1233834541",
            title: "Wow in the World",
            publisher: "Tinkercast | Wondery",
            description: "The #1 science podcast for kids and their grown-ups.",
            thumbnail: null,
            total_episodes: 500
        },
        {
            id: "719585944",
            title: "Story Pirates",
            publisher: "Gimlet",
            description: "Stories written by kids brought to life by comedy troupe.",
            thumbnail: null,
            total_episodes: 200
        },
        {
            id: "1103320303",
            title: "But Why: A Podcast For Curious Kids",
            publisher: "Vermont Public",
            description: "A podcast that answers kids' questions about the world.",
            thumbnail: null,
            total_episodes: 300
        },
        {
            id: "703720228",
            title: "Brains On! Science podcast for kids",
            publisher: "American Public Media",
            description: "Science podcast for kids and curious adults.",
            thumbnail: null,
            total_episodes: 300
        },
        {
            id: "948976028",
            title: "Stories Podcast",
            publisher: "Stories Podcast",
            description: "A free bedtime story podcast for kids.",
            thumbnail: null,
            total_episodes: 400
        }
    ]
};

async function searchPodcasts(query) {
    try {
        const cached = apiCache.get('search', { q: query });
        if (cached) {
            return cached;
        }

        const response = await fetch(
            `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=podcast&entity=podcast&limit=25`
        );

        if (!response.ok) {
            if (response.status === 403 || response.status === 429) {
                return {
                    error: 'rate_limited',
                    rateLimited: true,
                    message: "We've reached the maximum allowed use of the podcast search service for now. Please try again later, or browse the popular podcasts below.",
                    podcasts: staticPodcastData.popularKidsPodcasts,
                    fromCache: true,
                    isStatic: true
                };
            }
            return { error: `Failed to search podcasts: ${response.statusText}` };
        }

        const data = await response.json();

        const podcasts = data.results.slice(0, 10).map(podcast => ({
            id: String(podcast.collectionId),
            title: podcast.collectionName,
            publisher: podcast.artistName,
            thumbnail: podcast.artworkUrl600 || podcast.artworkUrl100,
            total_episodes: podcast.trackCount || 0,
            description: '',
            feedUrl: podcast.feedUrl
        }));

        const result = { podcasts };
        apiCache.set('search', { q: query }, result);

        return result;
    } catch (error) {
        return {
            podcasts: staticPodcastData.popularKidsPodcasts,
            fromCache: true,
            isStatic: true,
            error: 'Using fallback data due to API error'
        };
    }
}

async function getBestPodcasts(genreId = null, page = 1) {
    try {
        const cached = apiCache.get('best_podcasts', { page: page }, 60);
        if (cached) {
            return cached;
        }

        // Select random subset from curated list for variety
        const shuffled = [...CURATED_PODCASTS].sort(() => Math.random() - 0.5);
        const selected = shuffled.slice(0, Math.min(8, CURATED_PODCASTS.length));

        const promises = selected.map(async (podcast) => {
            try {
                const response = await fetch(
                    `https://itunes.apple.com/lookup?id=${podcast.itunesId}`
                );
                if (!response.ok) return null;

                const data = await response.json();
                const result = data.results[0];
                if (!result) return null;

                return {
                    id: String(result.collectionId),
                    title: result.collectionName,
                    publisher: result.artistName,
                    thumbnail: result.artworkUrl600 || result.artworkUrl100,
                    total_episodes: result.trackCount || 0,
                    description: '',
                    feedUrl: result.feedUrl
                };
            } catch {
                return null;
            }
        });

        const allPodcasts = (await Promise.all(promises)).filter(p => p !== null);
        const seenIds = new Set();
        const podcasts = allPodcasts.filter(p => {
            if (seenIds.has(p.id)) return false;
            seenIds.add(p.id);
            return true;
        });

        const result = {
            podcasts: podcasts.length > 0 ? podcasts : staticPodcastData.popularKidsPodcasts,
            has_next: false,
            has_previous: false,
            page_number: 1,
            total: podcasts.length || staticPodcastData.popularKidsPodcasts.length,
            fromCache: false,
            isStatic: podcasts.length === 0
        };

        apiCache.set('best_podcasts', { page: page }, result);
        return result;

    } catch (error) {
        return {
            podcasts: staticPodcastData.popularKidsPodcasts,
            has_next: false,
            has_previous: false,
            page_number: 1,
            total: staticPodcastData.popularKidsPodcasts.length,
            fromCache: true,
            isStatic: true,
            error: 'Using fallback data due to API error'
        };
    }
}

function parseDuration(duration) {
    if (!duration) return 0;
    if (/^\d+$/.test(duration)) return parseInt(duration, 10);
    const parts = duration.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
}

async function parseRSSForEpisodes(feedUrl, limit = 20) {
    const response = await fetch(feedUrl);
    const xmlText = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');

    const channelImage = doc.querySelector('channel > image > url')?.textContent ||
                        doc.querySelector('channel > itunes\\:image, channel > [href]')?.getAttribute('href') ||
                        '';

    const items = doc.querySelectorAll('item');
    return Array.from(items).slice(0, limit).map((item, index) => {
        const enclosure = item.querySelector('enclosure');
        const durationText = item.querySelector('itunes\\:duration, duration')?.textContent || '0';
        const episodeImage = item.querySelector('itunes\\:image')?.getAttribute('href') || channelImage;

        return {
            id: `rss_${index}`,
            title: cleanEpisodeTitle(item.querySelector('title')?.textContent || 'Untitled'),
            description: item.querySelector('description')?.textContent || '',
            audio: enclosure?.getAttribute('url') || '',
            audio_length_sec: parseDuration(durationText),
            thumbnail: episodeImage,
            pub_date_ms: new Date(item.querySelector('pubDate')?.textContent || Date.now()).getTime()
        };
    });
}

async function getPodcastEpisodes(podcastId, feedUrl = null, offset = 0) {
    try {
        const cacheKey = `${podcastId}_all_episodes`;
        const pageSize = 20;

        let allEpisodes = apiCache.get('podcast_episodes_all', { key: cacheKey }, 720);

        if (!allEpisodes) {
            const response = await fetch(
                `https://itunes.apple.com/lookup?id=${podcastId}&media=podcast&entity=podcastEpisode&limit=100`
            );

            if (!response.ok) {
                if (response.status === 403 || response.status === 429) {
                    return {
                        error: 'rate_limited',
                        rateLimited: true,
                        message: "We've reached the maximum allowed use of the podcast service for now. Please try again later."
                    };
                }
                return { error: `Failed to get podcast episodes: ${response.statusText}` };
            }

            const data = await response.json();

            // First result is the podcast info, rest are episodes
            const podcastInfo = data.results[0];
            const episodesData = data.results.slice(1);

            // iTunes episodeUrl is preferred; fall back to RSS parsing when unavailable
            if (episodesData.length > 0 && episodesData[0].episodeUrl) {
                allEpisodes = episodesData.map(ep => ({
                    id: String(ep.trackId),
                    title: cleanEpisodeTitle(ep.trackName || 'Untitled'),
                    description: ep.description || '',
                    audio: ep.episodeUrl,
                    audio_length_sec: Math.round((ep.trackTimeMillis || 0) / 1000),
                    thumbnail: ep.artworkUrl600 || ep.artworkUrl160 || podcastInfo?.artworkUrl600 || '',
                    pub_date_ms: new Date(ep.releaseDate).getTime()
                }));
            } else if (feedUrl || podcastInfo?.feedUrl) {
                try {
                    allEpisodes = await parseRSSForEpisodes(feedUrl || podcastInfo.feedUrl, 100);
                } catch (rssError) {
                    return { error: 'Failed to parse podcast RSS feed' };
                }
            } else {
                return { error: 'No episode source available for this podcast' };
            }

            apiCache.set('podcast_episodes_all', { key: cacheKey }, allEpisodes);
        }

        const paginatedEpisodes = allEpisodes.slice(offset, offset + pageSize);
        const hasMore = offset + pageSize < allEpisodes.length;

        return {
            episodes: paginatedEpisodes,
            has_more: hasMore,
            total_episodes: allEpisodes.length,
            offset: offset,
            next_offset: hasMore ? offset + pageSize : null
        };
    } catch (error) {
        return { error: 'Failed to get podcast episodes' };
    }
}

async function updateCardWithPodcastEpisodes(cardId, newAudioTracks, coverImageUrl = null) {
    try {
        const cardContent = await getCardContent(cardId);

        if (cardContent.error || !cardContent.card) {
            return { error: chrome.i18n.getMessage('error_failedToGetCardContent') };
        }

        const existingChapters = cardContent.card.content?.chapters || [];
        const existingMetadata = cardContent.card.metadata || {};
        const existingTitle = cardContent.card.title || 'Untitled Card';

        const formattedTracks = newAudioTracks.map((audio, index) => ({
            title: audio.title,
            key: String(index + 1), // Simple incrementing key, will be regenerated by updatePlaylistContent
            trackUrl: `yoto:#${audio.transcodedAudio.transcodedSha256}`,
            duration: audio.transcodedAudio.transcodedInfo?.duration || 0,
            format: audio.transcodedAudio.transcodedInfo?.format || 'mp3'
        }));

        const updateResult = await updatePlaylistContent(
            cardId,
            existingChapters,
            formattedTracks,
            [], // No icons for podcast episodes
            existingMetadata,
            existingTitle
        );

        return updateResult;

    } catch (error) {
        return { error: error.message || chrome.i18n.getMessage('error_failedToUpdateCardWithEpisodes') };
    }
}

async function importPodcastEpisodes(podcast, episodes, updateMode = false, cardId = null) {
    try {
        await chrome.storage.local.remove(['podcastImportResult', 'podcastImportTimestamp']);

        await chrome.storage.local.set({
            podcastImportProgress: {
                status: 'in_progress',
                current: 0,
                total: episodes.length,
                message: updateMode ? chrome.i18n.getMessage('status_addingEpisodesToCard') : chrome.i18n.getMessage('status_startingImport')
            }
        });

        const isValid = await TokenManager.isTokenValid();
        if (!isValid) {
            return { error: 'Not authenticated. Please log in first.' };
        }
        const playlistName = `${podcast.title} - Podcast`;
        
        const CONCURRENT_LIMIT = 3;
        const audioTracks = [];
        let processedCount = 0;
        let failedCount = 0;
        const encounteredDomains = new Set(); // Track domains that need permissions

        const updateProgress = async (episodeIndex) => {
            const failedText = failedCount > 0 ? ` (${failedCount} ${chrome.i18n.getMessage('status_podcastFailed')})` : '';
            const message = chrome.i18n.getMessage('status_podcastProcessing', [String(processedCount), String(episodes.length)]) + failedText;

            await chrome.storage.local.set({
                podcastImportProgress: {
                    status: 'in_progress',
                    current: processedCount,
                    total: episodes.length,
                    currentEpisode: episodeIndex + 1,
                    message: message
                }
            });
        };

        const processEpisode = async (episode, index) => {
            if (episode.audio_length_sec > 3600) {
                console.warn(`Episode "${episode.title}" exceeds 60 minutes, it may be truncated by Yoto`);
            }

            try {
                let audioBlob = null;
                let audioUrl = episode.audio;

                try {
                    try {
                        const headResponse = await fetch(audioUrl, {
                            method: 'HEAD',
                            redirect: 'follow'
                        });

                        if (headResponse.url !== audioUrl) {
                            const finalUrl = new URL(headResponse.url);

                            const hasPermission = await chrome.permissions.contains({
                                origins: [`${finalUrl.protocol}//${finalUrl.hostname}/*`]
                            });

                            if (!hasPermission) {
                                encounteredDomains.add(`${finalUrl.protocol}//${finalUrl.hostname}/*`);
                            }
                        }
                    } catch (headError) {
                    }

                    const audioResponse = await fetch(audioUrl, {
                        method: 'GET',
                        redirect: 'follow'
                    });

                    try {
                        const finalUrl = new URL(audioResponse.url);
                    } catch (e) {
                    }

                    if (!audioResponse.ok) {
                        throw new Error(`HTTP ${audioResponse.status}`);
                    }

                    audioBlob = await audioResponse.blob();

                    if (!audioBlob || audioBlob.size === 0) {
                        throw new Error('Empty audio file');
                    }
                } catch (fetchError) {
                    if (fetchError.message && fetchError.message.includes('Failed to fetch')) {
                        if (encounteredDomains.size === 0) {
                            try {
                                const url = new URL(audioUrl);
                            } catch (e) {
                            }
                        }
                    }

                    failedCount++;
                    return null;
                }

                const uploadResult = await uploadAudioFile({
                    blob: audioBlob,
                    name: `${episode.title}.mp3`,
                    type: 'audio/mpeg'
                });

                if (uploadResult.error) {
                    failedCount++;
                    return null;
                }

                return {
                    title: episode.title,
                    transcodedAudio: uploadResult.transcodedAudio,
                    originalIndex: index
                };

            } catch (error) {
                failedCount++;
                return null;
            } finally {
                processedCount++;
                await updateProgress(index);
            }
        };
        
        const results = [];
        for (let i = 0; i < episodes.length; i += CONCURRENT_LIMIT) {
            const batch = episodes.slice(i, Math.min(i + CONCURRENT_LIMIT, episodes.length));
            const batchPromises = batch.map((episode, batchIndex) => 
                processEpisode(episode, i + batchIndex)
            );
            
            // Wait for current batch to complete before starting next batch
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
        }
        
        const successfulTracks = results
            .filter(track => track !== null)
            .sort((a, b) => a.originalIndex - b.originalIndex)
            .map(track => ({
                title: track.title,
                transcodedAudio: track.transcodedAudio
            }));
        
        audioTracks.push(...successfulTracks);
        
        
        
        if (audioTracks.length === 0) {
            // Check if we encountered domains we don't have permission for
            if (encounteredDomains.size > 0 && failedCount > 0) {
                const domainsArray = Array.from(encounteredDomains);
                
                return { 
                    error: 'Failed to import episodes. The podcast audio is hosted on external domains that require additional permissions.',
                    needsPermission: true,
                    requiredDomains: domainsArray
                };
            }
            
            return { error: 'Failed to import episodes. The podcast audio may be hosted on a domain that requires additional permissions.' };
        }
        
        let coverImageUrl = null;
        if (podcast.thumbnail) {
            try {
                const imageResponse = await fetch(podcast.thumbnail, {
                    method: 'GET'
                });
                
                if (imageResponse.ok) {
                    const imageBlob = await imageResponse.blob();
                    const reader = new FileReader();
                    const imageData = await new Promise((resolve) => {
                        reader.onloadend = () => {
                            const base64 = reader.result.split(',')[1];
                            resolve(base64);
                        };
                        reader.readAsDataURL(imageBlob);
                    });
                    
                    const coverResult = await uploadCoverImage({
                        data: imageData,
                        name: 'podcast_cover.jpg',
                        type: imageBlob.type
                    });
                    
                    if (coverResult.url) {
                        coverImageUrl = coverResult.url;
                    }
                } else {
                }
            } catch (error) {
                // Continue without cover image
            }
        }
        
        await chrome.storage.local.set({
            podcastImportProgress: {
                status: 'in_progress',
                current: audioTracks.length,
                total: episodes.length,
                message: updateMode ? chrome.i18n.getMessage('status_updatingCard') : chrome.i18n.getMessage('status_creatingMyoCardPlaylist')
            }
        });

        let result;

        if (updateMode && cardId) {
            result = await updateCardWithPodcastEpisodes(
                cardId,
                audioTracks,
                coverImageUrl
            );
        } else {
            result = await createPlaylistContent(
                playlistName,
                audioTracks,
                [], // No custom icons for now
                coverImageUrl
            );
        }

        if (result.error) {
            const errorResult = { error: updateMode ? chrome.i18n.getMessage('error_failedToUpdateCard', [result.error]) : chrome.i18n.getMessage('error_failedToCreateMyoCard', [result.error]) };
            await chrome.storage.local.set({
                podcastImportResult: errorResult,
                podcastImportTimestamp: Date.now(),
                podcastImportProgress: {
                    status: 'error',
                    message: errorResult.error
                }
            });
            return errorResult;
        }

        const successResult = {
            success: true,
            contentId: result.contentId,
            tracksImported: audioTracks.length,
            updated: updateMode
        };

        await chrome.storage.local.set({
            podcastImportResult: successResult,
            podcastImportTimestamp: Date.now(),
            podcastImportProgress: {
                status: 'complete',
                message: updateMode ? chrome.i18n.getMessage('status_successfullyAddedEpisodes', [audioTracks.length]) : chrome.i18n.getMessage('status_successfullyImportedEpisodes', [audioTracks.length])
            }
        });

        return successResult;
        
    } catch (error) {
        const errorResult = { error: error.message || 'Failed to import podcast episodes' };
        
        await chrome.storage.local.set({
            podcastImportResult: errorResult,
            podcastImportTimestamp: Date.now(),
            podcastImportProgress: {
                status: 'error',
                message: errorResult.error
            }
        });
        
        return errorResult;
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Skip messages that use 'type' instead of 'action' - they'll be handled by the other listener
    if (!request.action && request.type) {
        return false; // Let other listeners handle this
    }

    (async () => {
        try {
            console.log('[DEBUG] Received message with action:', request.action, 'Full request:', request);
            switch (request.action) {
                case 'CHECK_AUTH':
                    const isValid = await TokenManager.isTokenValid();
                    let userEmail = null;
                    if (isValid) {
                        // Also return the authenticated user's email so UI can verify it matches
                        const tokens = await TokenManager.getTokens();
                        if (tokens?.access_token) {
                            try {
                                const payload = JSON.parse(atob(tokens.access_token.split('.')[1]));
                                userEmail = payload.email || payload.preferred_username || null;
                            } catch (e) {
                                // Ignore decode errors
                            }
                        }
                    }
                    sendResponse({
                        authenticated: isValid,
                        userEmail: userEmail
                    });
                    break;

                case 'CLEAR_AUTH':
                    await TokenManager.clearAllAuthData();
                    sendResponse({success: true, message: 'All authentication data cleared'});
                    break;

                case 'START_AUTH':
                    // Only try silent authentication - never automatically open interactive
                    let authResult = await startOAuthFlow(false); // Silent attempt only
                    sendResponse(authResult);
                    break;
                    
                case 'START_AUTH_INTERACTIVE':
                    // Explicitly requested interactive authentication (from popup or user action)
                    const interactiveResult = await startOAuthFlow(true);
                    
                    // Broadcast auth status change to all tabs if successful
                    if (interactiveResult.success) {
                        const tabs = await chrome.tabs.query({});
                        for (const tab of tabs) {
                            try {
                                await chrome.tabs.sendMessage(tab.id, {
                                    action: 'AUTH_STATUS',
                                    authenticated: true
                                });
                            } catch (e) {
                                // Tab might not have content script
                            }
                        }
                    }
                    
                    sendResponse(interactiveResult);
                    break;

                case 'EXCHANGE_CODE':
                    const exchangeResult = await exchangeCodeForTokens(request.code);
                    sendResponse(exchangeResult);
                    break;

                case 'GET_CARDS':
                    const cards = await getMyCards();
                    sendResponse(cards);
                    break;

                case 'VERIFY_CARD_ACCESS':
                    // Quick check if we can access this card - used before icon matching
                    const verifyResult = await getCardContent(request.cardId);
                    if (verifyResult.error && verifyResult.error.includes('403')) {
                        // Clear everything to force fresh auth
                        await TokenManager.clearAllAuthData();
                        yotoIconsCache.clear();
                        sendResponse({
                            success: false,
                            needsAuth: true,
                            error: 'Account mismatch detected. Please authenticate again.'
                        });
                    } else if (verifyResult.error) {
                        sendResponse({
                            success: false,
                            error: verifyResult.error
                        });
                    } else {
                        sendResponse({
                            success: true,
                            trackCount: verifyResult.card?.content?.chapters?.length || 0
                        });
                    }
                    break;

                case 'VERIFY_AUTH':
                    try {
                        const isValid = await TokenManager.isTokenValid();
                        if (!isValid) {
                            await TokenManager.clearAllAuthData();
                            yotoIconsCache.clear();
                            sendResponse({
                                success: false,
                                needsAuth: true,
                                error: 'Authentication required.'
                            });
                            break;
                        }
                        sendResponse({
                            success: true,
                            authenticated: true
                        });
                    } catch (error) {
                        await TokenManager.clearAllAuthData();
                        yotoIconsCache.clear();
                        sendResponse({
                            success: false,
                            needsAuth: true,
                            error: 'Authentication error. Please try again.'
                        });
                    }
                    break;

                case 'GET_CARD_CONTENT':
                    const content = await getCardContent(request.cardId);
                    sendResponse(content);
                    break;

                case 'GET_USER_CARDS':
                    const userCards = await getUserCards();
                    sendResponse(userCards);
                    break;

                case 'MATCH_ICONS':
                    const matches = await matchIcons(request.tracks);
                    sendResponse({matches});
                    break;

                case 'SEARCH_ICONS':
                    const icons = await searchIcons(request.query);
                    sendResponse(icons);
                    break;
                
                case 'SEARCH_ICONS_BY_CATEGORY':
                    const categoryIcons = await searchIconsByCategory(request.category, request.loadMore || false);
                    sendResponse(categoryIcons);
                    break;
                
                case 'APPLY_CATEGORY_ICONS':
                    const applyResult = await applyCategoryIcons(request.cardId, request.icons, request.selectedTracks);
                    sendResponse(applyResult);
                    break;

                case 'CLEAR_YOTOICONS_CACHE':
                    // Clear the yotoicons cache to force re-download with dataUrls
                    try {
                        const cacheSize = yotoIconsCache.size;
                        yotoIconsCache.clear();

                        // Get user-specific cache key
                        const cacheKey = await getUserSpecificCacheKey();
                        if (cacheKey) {
                            await chrome.storage.local.remove(cacheKey);
                        }

                        sendResponse({
                            success: true,
                            message: `Cleared ${cacheSize} cached yotoicons`,
                            clearedCount: cacheSize
                        });
                    } catch (error) {
                        sendResponse({
                            success: false,
                            error: error.message
                        });
                    }
                    break;

                case 'UPDATE_STATS':
                    await updateStats(request.stats);
                    sendResponse({success: true});
                    break;

                case 'UPDATE_CARD_ICONS':
                    const updateIconsResult = await updateCardIcons(request.cardId, request.iconMatches);
                    sendResponse(updateIconsResult);
                    break;
                    
                case 'UPLOAD_TIMER_AUDIO':
                    try {
                        const audioUrl = chrome.runtime.getURL(`assets/audio/timer/${request.fileName}`);
                        const audioResponse = await fetch(audioUrl);

                        if (!audioResponse.ok) {
                            sendResponse({ error: `Failed to load timer audio: ${request.fileName}` });
                            break;
                        }

                        const audioBlob = await audioResponse.blob();
                        const reader = new FileReader();

                        reader.onloadend = async function() {
                            const base64Data = reader.result.split(',')[1];

                            const binaryString = atob(base64Data);
                            const bytes = new Uint8Array(binaryString.length);
                            for (let i = 0; i < binaryString.length; i++) {
                                bytes[i] = binaryString.charCodeAt(i);
                            }
                            const audioBlob = new Blob([bytes], { type: 'audio/wav' });

                            const uploadResult = await uploadAudioFile({
                                blob: audioBlob,
                                type: 'audio/wav',
                                name: request.trackName
                            });

                            sendResponse(uploadResult);
                        };

                        reader.readAsDataURL(audioBlob);

                        // Return true to indicate we'll respond asynchronously
                        return true;
                    } catch (error) {
                        sendResponse({ error: error.message || 'Failed to upload timer audio' });
                    }
                    break;


                case 'GET_UPLOAD_URL':
                    // Just get the presigned URL, don't upload anything
                    try {
                        const uploadUrlResponse = await makeAuthenticatedRequest('/media/transcode/audio/uploadUrl', {
                            method: 'GET'
                        });

                        if (uploadUrlResponse.needsAuth) {
                            sendResponse({ error: 'Authentication required. Please log in again.' });
                            break;
                        }

                        if (uploadUrlResponse.error) {
                            sendResponse({ error: uploadUrlResponse.error });
                            break;
                        }

                        const { upload } = uploadUrlResponse;
                        if (!upload?.uploadUrl || !upload?.uploadId) {
                            sendResponse({ error: 'Failed to get upload URL - invalid response structure' });
                            break;
                        }

                        // Return the presigned URL and upload ID to content script
                        sendResponse({
                            success: true,
                            uploadUrl: upload.uploadUrl,
                            uploadId: upload.uploadId
                        });
                    } catch (error) {
                        console.error('[Upload] Error getting upload URL:', error);
                        sendResponse({ error: error.message });
                    }
                    break;

                case 'CHECK_TRANSCODE_STATUS':
                    // Check if transcoding is complete
                    try {
                        const transcodeResponse = await makeAuthenticatedRequest(
                            `/media/upload/${request.uploadId}/transcoded?loudnorm=false`
                        );

                        if (transcodeResponse.error) {
                            sendResponse({ error: transcodeResponse.error });
                            break;
                        }

                        // Check for transcoded audio in all possible response formats
                        const transcodedAudio = transcodeResponse.transcode ||
                                               transcodeResponse.transcodedAudio ||
                                               transcodeResponse.result;

                        // Check for completion by looking for transcodedSha256
                        if (transcodedAudio?.transcodedSha256) {
                            sendResponse({
                                success: true,
                                transcodedAudio: transcodedAudio,
                                ready: true
                            });
                        } else {
                            sendResponse({
                                success: true,
                                ready: false
                            });
                        }
                    } catch (error) {
                        console.error('[Transcode] Error checking status:', error);
                        sendResponse({ error: error.message });
                    }
                    break;

                case 'START_CHUNKED_AUDIO_UPLOAD':
                    try {
                        const uploadId = `chunk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                        // Initialize chunks array with correct size to avoid sparse array issues
                        const chunksArray = new Array(request.totalChunks);
                        for (let i = 0; i < request.totalChunks; i++) {
                            chunksArray[i] = null;
                        }

                        chunkedUploads.set(uploadId, {
                            fileName: request.fileName,
                            fileType: request.fileType,
                            fileSize: request.fileSize,
                            totalChunks: request.totalChunks,
                            chunks: chunksArray,
                            receivedChunks: 0
                        });
                        sendResponse({ success: true, uploadId: uploadId });
                    } catch (error) {
                        console.error('[Chunked Upload] Error starting upload:', error);
                        sendResponse({ error: error.message });
                    }
                    break;

                case 'SEND_AUDIO_CHUNK':
                    try {
                        const upload = chunkedUploads.get(request.uploadId);
                        if (!upload) {
                            console.error(`[Chunked Upload] Invalid upload ID for chunk: ${request.uploadId}`);
                            sendResponse({ error: 'Invalid upload ID' });
                            break;
                        }

                        // Validate chunk data
                        if (!request.chunkData || typeof request.chunkData !== 'string' || request.chunkData.length === 0) {
                            console.error(`[Chunked Upload] Invalid chunk data for chunk ${request.chunkIndex}/${upload.totalChunks}`);
                            sendResponse({ error: `Invalid chunk data for chunk ${request.chunkIndex}` });
                            break;
                        }

                        // Ensure chunk data is not literally "null" or "undefined"
                        if (request.chunkData === 'null' || request.chunkData === 'undefined') {
                            console.error(`[Chunked Upload] Chunk data is literally '${request.chunkData}' for chunk ${request.chunkIndex}/${upload.totalChunks}`);
                            sendResponse({ error: `Invalid chunk data (${request.chunkData}) for chunk ${request.chunkIndex}` });
                            break;
                        }

                        // Validate chunk index
                        if (request.chunkIndex < 0 || request.chunkIndex >= upload.totalChunks) {
                            console.error(`[Chunked Upload] Invalid chunk index ${request.chunkIndex} (total chunks: ${upload.totalChunks})`);
                            sendResponse({ error: `Invalid chunk index ${request.chunkIndex}` });
                            break;
                        }


                        // Check if this chunk was already received
                        if (upload.chunks[request.chunkIndex] !== null) {
                            // Don't increment receivedChunks for duplicates
                            upload.chunks[request.chunkIndex] = request.chunkData;
                        } else {
                            // First time receiving this chunk
                            upload.chunks[request.chunkIndex] = request.chunkData;
                            upload.receivedChunks++;
                        }

                        sendResponse({ success: true, received: upload.receivedChunks, total: upload.totalChunks });
                    } catch (error) {
                        console.error(`[Chunked Upload] Error receiving chunk:`, error);
                        sendResponse({ error: error.message });
                    }
                    break;

                case 'CANCEL_CHUNKED_UPLOAD':
                    try {
                        const upload = chunkedUploads.get(request.uploadId);
                        if (upload) {
                            chunkedUploads.delete(request.uploadId);
                            sendResponse({ success: true, message: 'Upload cancelled' });
                        } else {
                            sendResponse({ success: true, message: 'Upload not found (may have already been cleaned up)' });
                        }
                    } catch (error) {
                        console.error('[Chunked Upload] Error cancelling upload:', error);
                        sendResponse({ error: error.message });
                    }
                    break;

                case 'COMPLETE_CHUNKED_AUDIO_UPLOAD':
                    try {
                        const upload = chunkedUploads.get(request.uploadId);
                        if (!upload) {
                            console.error(`[Chunked Upload] Invalid upload ID: ${request.uploadId}`);
                            sendResponse({ error: 'Invalid upload ID' });
                            break;
                        }

                        if (upload.receivedChunks !== upload.totalChunks) {
                            console.error(`[Chunked Upload] Missing chunks for ${upload.fileName}: received ${upload.receivedChunks}/${upload.totalChunks}`);
                            sendResponse({ error: `Missing chunks: received ${upload.receivedChunks}/${upload.totalChunks}` });
                            break;
                        }

                        // Verify all chunks are present
                        const missingChunks = [];
                        for (let i = 0; i < upload.totalChunks; i++) {
                            if (upload.chunks[i] === undefined || upload.chunks[i] === null) {
                                missingChunks.push(i);
                            }
                        }

                        if (missingChunks.length > 0) {
                            console.error(`[Chunked Upload] Missing ${missingChunks.length} chunks for ${upload.fileName}`);
                            sendResponse({ error: `Missing chunks: ${missingChunks.join(', ')}` });
                            chunkedUploads.delete(request.uploadId);
                            return;
                        }

                        // Filter out any undefined/null values AND string "null" values
                        const validChunks = upload.chunks.filter(chunk => {
                            return chunk !== undefined &&
                                   chunk !== null &&
                                   chunk !== 'null' &&
                                   chunk !== 'undefined' &&
                                   typeof chunk === 'string' &&
                                   chunk.length > 0;
                        });

                        if (validChunks.length !== upload.totalChunks) {
                            console.error(`[Chunked Upload] Chunk count mismatch for ${upload.fileName}: expected ${upload.totalChunks}, got ${validChunks.length}`);
                            sendResponse({ error: `Chunk count mismatch: expected ${upload.totalChunks}, got ${validChunks.length} valid chunks` });
                            chunkedUploads.delete(request.uploadId);
                            return;
                        }

                        const fullBase64 = validChunks.join('');

                        let binaryString;
                        try {
                            binaryString = atob(fullBase64);
                        } catch (decodeError) {
                            console.error(`[Chunked Upload] Base64 decode error for ${upload.fileName}:`, decodeError.message);
                            sendResponse({ error: `Failed to decode base64: ${decodeError.message || decodeError.toString()}` });
                            chunkedUploads.delete(request.uploadId);
                            return;
                        }

                        const bytes = new Uint8Array(binaryString.length);
                        for (let i = 0; i < binaryString.length; i++) {
                            bytes[i] = binaryString.charCodeAt(i);
                        }
                        const audioBlob = new Blob([bytes], { type: upload.fileType });

                        const uploadResult = await uploadAudioFile({
                            blob: audioBlob,
                            type: upload.fileType,
                            name: upload.fileName
                        });

                        chunkedUploads.delete(request.uploadId);

                        if (!uploadResult) {
                            console.error('[Chunked Upload] uploadAudioFile returned undefined!');
                            sendResponse({ error: 'Upload failed - no result returned' });
                        } else {
                            sendResponse(uploadResult);
                        }
                    } catch (error) {
                        console.error(`[Chunked Upload] Error in COMPLETE_CHUNKED_AUDIO_UPLOAD:`, error);
                        chunkedUploads.delete(request.uploadId);
                        sendResponse({ error: error.message });
                    }
                    break;

                case 'UPLOAD_AUDIO':
                    try {

                        // Check if we have the required data
                        if (!request.file || !request.file.data) {
                            sendResponse({ error: 'Missing file data' });
                            break;
                        }

                        // Check base64 string size - prevent processing extremely large strings that might crash
                        const base64Size = request.file.data.length;
                        const estimatedFileSize = base64Size * 0.75; // Rough estimate of original file size

                        if (base64Size > 150 * 1024 * 1024) {
                            sendResponse({
                                error: `File "${request.file.name}" is too large (${(estimatedFileSize / 1024 / 1024).toFixed(2)}MB). Maximum file size is 100MB. Please split the file or use smaller files.`
                            });
                            break;
                        }

                        let audioBlob;
                        try {
                            // For large files, decode in chunks to avoid memory issues
                            if (base64Size > 20 * 1024 * 1024) { // If > 20MB base64

                                // Decode base64 string
                                const binaryString = atob(request.file.data);

                                // Create Uint8Array in chunks to avoid memory spikes
                                const chunkSize = 1024 * 1024; // 1MB chunks
                                const chunks = [];

                                for (let i = 0; i < binaryString.length; i += chunkSize) {
                                    const chunk = new Uint8Array(Math.min(chunkSize, binaryString.length - i));
                                    for (let j = 0; j < chunk.length; j++) {
                                        chunk[j] = binaryString.charCodeAt(i + j);
                                    }
                                    chunks.push(chunk);
                                }

                                // Combine chunks into single blob
                                audioBlob = new Blob(chunks, {
                                    type: request.file.type || 'audio/mpeg'
                                });
                            } else {
                                // Standard decode for smaller files
                                const binaryString = atob(request.file.data);
                                const bytes = new Uint8Array(binaryString.length);
                                for (let i = 0; i < binaryString.length; i++) {
                                    bytes[i] = binaryString.charCodeAt(i);
                                }
                                audioBlob = new Blob([bytes], {
                                    type: request.file.type || 'audio/mpeg'
                                });
                            }

                        } catch (decodeError) {
                            sendResponse({ error: `Failed to process file "${request.file.name}": ${decodeError.message}. The file may be corrupted or too large.` });
                            break;
                        }

                        const uploadResult = await uploadAudioFile({
                            blob: audioBlob,
                            type: request.file.type,
                            name: request.file.name
                        });

                        sendResponse(uploadResult);
                    } catch (error) {
                        sendResponse({ error: error.message || 'Upload failed' });
                    }
                    break;

                    
                case 'UPLOAD_ICON':
                    const iconResponse = await uploadIcon({
                        data: request.file.data,
                        type: request.file.type,
                        name: request.file.name
                    });
                    sendResponse(iconResponse);
                    break;

                case 'UPLOAD_GIF':
                    const gifResponse = await uploadGif({
                        data: request.file.data,
                        type: request.file.type,
                        name: request.file.name
                    });
                    sendResponse(gifResponse);
                    break;

                case 'UPLOAD_COVER':
                    const coverResponse = await uploadCoverImage({
                        data: request.file.data,
                        type: request.file.type,
                        name: request.file.name
                    });
                    sendResponse(coverResponse);
                    break;
                    
                case 'CREATE_PLAYLIST':
                    sendResponse(await createPlaylistContent(
                        request.title,
                        request.audioTracks,
                        request.iconIds,
                        request.coverUrl,
                        request.isVisualTimer,
                        request.alwaysPlayFromStart
                    ));
                    break;

                case 'CREATE_PLAYLIST_CONTENT':
                    const result = await createPlaylistContent(
                        request.title,
                        request.audioTracks,
                        request.iconIds,
                        request.coverUrl
                    );
                    sendResponse({success: true, result});
                    break;

                case 'UPDATE_PLAYLIST':
                    const updatePlaylistResult = await updatePlaylistContent(
                        request.cardId,
                        request.existingChapters,
                        request.newTracks,
                        request.newIcons,
                        request.metadata,
                        request.title
                    );
                    sendResponse(updatePlaylistResult);
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
                    yotoIconsCache.clear();

                    await TokenManager.clearAllAuthData();

                    if (yotoIconsCache.size > 0) {
                        yotoIconsCache.clear();
                    }

                    sendResponse({success: true, message: 'Logged out and cleared all auth data'});
                    break;
                    
                case 'TRACK_ERROR':
                    // Track errors to GA4
                    if (typeof YotoAnalytics !== 'undefined') {
                        YotoAnalytics.trackError(request.error, request.context || {});
                    }
                    sendResponse({success: true});
                    break;
                    
                case 'TRACK_EVENT':
                    // Track analytics events
                    if (typeof YotoAnalytics !== 'undefined') {
                        if (request.eventName === 'import_playlist') {
                            YotoAnalytics.trackImport(
                                request.parameters.source,
                                request.parameters.fileCount,
                                request.parameters.success
                            );
                        } else if (request.eventName === 'icon_match') {
                            YotoAnalytics.trackIconMatch(
                                request.parameters.matchCount,
                                request.parameters.automated
                            );
                        } else {
                            YotoAnalytics.track(
                                request.eventName,
                                request.parameters.category,
                                request.parameters.label,
                                request.parameters.value
                            );
                        }
                    }
                    sendResponse({success: true});
                    break;

                case 'TRACK_ANALYTICS':
                    if (typeof YotoAnalytics !== 'undefined') {
                        const data = request.data;
                        switch(request.eventName) {
                            case 'queue_status':
                                YotoAnalytics.trackQueueStatus(
                                    data.queueType,
                                    data.currentLength,
                                    data.maxLength,
                                    data.processingRate
                                );
                                break;
                            case 'batch_metrics':
                                YotoAnalytics.trackBatchUploadMetrics(
                                    data.batchType,
                                    data.queueLength,
                                    data.processedCount,
                                    data.failureCount,
                                    data.totalDuration
                                );
                                break;
                            case 'upload_performance':
                                YotoAnalytics.trackUploadPerformance(
                                    data.fileType,
                                    data.duration,
                                    data.fileSize,
                                    data.success,
                                    data.errorMessage
                                );
                                break;
                            case 'upload_latency':
                                YotoAnalytics.trackUploadLatency(
                                    data.operation,
                                    data.latencyMs,
                                    data.stage
                                );
                                break;
                        }
                    }
                    sendResponse({success: true});
                    break;

                case 'SEARCH_PODCASTS':
                    const searchResults = await searchPodcasts(request.query);
                    sendResponse(searchResults);
                    break;

                case 'GET_PODCAST_EPISODES':
                    const episodesResult = await getPodcastEpisodes(request.podcastId, request.feedUrl, request.offset || 0);
                    sendResponse(episodesResult);
                    break;

                case 'GET_BEST_PODCASTS':
                    const bestPodcastsResult = await getBestPodcasts(request.genreId, request.page);
                    sendResponse(bestPodcastsResult);
                    break;

                case 'OPEN_EXTENSION_PAGE':
                    chrome.tabs.create({
                        url: chrome.runtime.getURL(request.page)
                    });
                    sendResponse({opened: true});
                    break;
                    
                case 'CHECK_ALL_URLS_PERMISSION':
                    // Check if we have permission for all URLs
                    const hasPerm = await chrome.permissions.contains({
                        origins: ['<all_urls>']
                    });
                    sendResponse({granted: hasPerm});
                    break;
                    
                case 'REQUEST_ALL_URLS_PERMISSION':
                    // Request permission for all URLs
                    try {
                        const granted = await chrome.permissions.request({
                            origins: ['<all_urls>']
                        });
                        
                        if (granted) {
                            // Notify content script that permission was granted
                            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                                if (tabs[0]) {
                                    chrome.tabs.sendMessage(tabs[0].id, {
                                        action: 'PERMISSION_GRANTED',
                                        permission: 'all_urls'
                                    });
                                }
                            });
                        }
                        
                        sendResponse({granted: granted});
                    } catch (error) {
                        sendResponse({granted: false, error: error.message});
                    }
                    break;
                    
                case 'REQUEST_SPECIFIC_PERMISSIONS':
                    // Request permission for specific domains
                    const domains = request.domains;
                    
                    // Store the domains for the permission page to use
                    await chrome.storage.local.set({
                        pendingPermissionDomains: domains
                    });
                    
                    sendResponse({stored: true});
                    break;
                    
                case 'CHECK_SPECIFIC_PERMISSIONS':
                    // Check if we have permission for specific domains
                    const checkDomains = request.domains;
                    const hasSpecificPerms = await chrome.permissions.contains({
                        origins: checkDomains
                    });
                    sendResponse({granted: hasSpecificPerms});
                    break;
                    
                case 'IMPORT_PODCAST_EPISODES':
                    // Don't check permissions upfront - try first and see if it works
                    // Start the import process asynchronously
                    // Return immediately to avoid timeout
                    sendResponse({status: 'started', message: 'Import process started'});

                    // Run the actual import in the background
                    importPodcastEpisodes(
                        request.podcast,
                        request.episodes,
                        request.updateMode || false,
                        request.cardId || null
                    ).then(result => {
                        chrome.storage.local.set({
                            podcastImportResult: result,
                            podcastImportTimestamp: Date.now()
                        });
                    }).catch(error => {
                        chrome.storage.local.set({
                            podcastImportResult: {error: error.message || 'Import failed'},
                            podcastImportTimestamp: Date.now()
                        });
                    });
                    break;
                    
                case 'GET_PODCAST_IMPORT_STATUS':
                    // Allow checking the import status
                    const storage = await chrome.storage.local.get(['podcastImportResult', 'podcastImportTimestamp', 'podcastImportProgress']);
                    if (storage.podcastImportResult) {
                        sendResponse(storage.podcastImportResult);
                    } else if (storage.podcastImportProgress) {
                        sendResponse({status: 'pending', progress: storage.podcastImportProgress});
                    } else {
                        sendResponse({status: 'pending'});
                    }
                    break;

                case 'CANCEL_PODCAST_IMPORT':
                    await chrome.storage.local.remove(['podcastImportResult', 'podcastImportTimestamp', 'podcastImportProgress']);
                    
                    await chrome.storage.local.set({
                        podcastImportResult: {cancelled: true, message: 'Import cancelled by user'},
                        podcastImportTimestamp: Date.now()
                    });

                    sendResponse({success: true, message: 'Import cancelled'});
                    break;

                case 'GET_BATTERY_STATUS':
                    const batteryResult = await getBatteryStatus();
                    sendResponse(batteryResult);
                    break;

                case 'GET_USER_PLAYLISTS':
                    const playlistsResult = await getUserCards();
                    sendResponse(playlistsResult);
                    break;

                case 'RESOLVE_PLAYLIST':
                    const resolveResult = await resolvePlaylist(request.playlistId);
                    sendResponse(resolveResult);
                    break;

                case 'START_BULK_EXPORT':
                    const exportResult = await startBulkExport(request);
                    sendResponse(exportResult);
                    break;

                case 'RESUME_BULK_EXPORT':
                    const resumeResult = await resumeBulkExport(request.manifestId);
                    sendResponse(resumeResult);
                    break;

                case 'CANCEL_BULK_EXPORT':
                    const cancelResult = await cancelBulkExport(request.manifestId);
                    sendResponse(cancelResult);
                    break;

                case 'GET_EXPORT_STATUS':
                    const statusResult = await getExportStatus(request.manifestId);
                    sendResponse(statusResult);
                    break;

                case 'DOWNLOAD_EXPORT_ZIP':
                    // Send immediate response to prevent timeout
                    sendResponse({ success: true, message: 'Download initiated' });
                    // Process download asynchronously
                    downloadExportZip(request.manifestId, request.playlistIds).then(result => {
                        if (result.error) {
                            // Notify content script of error
                            chrome.tabs.query({ url: 'https://my.yotoplay.com/*' }, (tabs) => {
                                tabs.forEach(tab => {
                                    chrome.tabs.sendMessage(tab.id, {
                                        type: 'ZIP_DOWNLOAD_ERROR',
                                        manifestId: request.manifestId,
                                        error: result.error
                                    }).catch(() => {});
                                });
                            });
                        }
                    }).catch(error => {
                        console.error('[BulkExport] downloadExportZip failed:', error);
                        // Notify content script of error
                        chrome.tabs.query({ url: 'https://my.yotoplay.com/*' }, (tabs) => {
                            tabs.forEach(tab => {
                                chrome.tabs.sendMessage(tab.id, {
                                    type: 'ZIP_DOWNLOAD_ERROR',
                                    manifestId: request.manifestId,
                                    error: error.message
                                }).catch(() => {});
                            });
                        });
                    });
                    break;

                case 'PROXY_DOWNLOAD':
                    // Handle proxy download for offscreen document
                    (async () => {
                        try {
                            const response = await fetch(request.url);

                            if (!response.ok) {
                                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                            }

                            const buffer = await response.arrayBuffer();

                            // Convert to base64 for transfer
                            const bytes = new Uint8Array(buffer);
                            let binary = '';
                            for (let i = 0; i < bytes.byteLength; i++) {
                                binary += String.fromCharCode(bytes[i]);
                            }
                            const base64 = btoa(binary);

                            sendResponse({
                                success: true,
                                data: base64
                            });
                        } catch (error) {
                            console.error(`[BulkExport] Proxy download failed:`, error);
                            sendResponse({
                                success: false,
                                error: error.message
                            });
                        }
                    })();
                    return true; // Keep message channel open for async response

                default:
                    sendResponse({error: 'Unknown action'});
            }
        } catch (error) {
            sendResponse({error: error.message});
        }
    })();

    return true;
});

chrome.runtime.onInstalled.addListener(async (details) => {
    // Track installation/update
    if (typeof YotoAnalytics !== 'undefined') {
        await YotoAnalytics.loadEnabledState();

        if (details.reason === 'install') {
            YotoAnalytics.sendEvent('extension_installed', {
                version: chrome.runtime.getManifest().version
            });
        } else if (details.reason === 'update') {
            YotoAnalytics.sendEvent('extension_updated', {
                version: chrome.runtime.getManifest().version,
                previous_version: details.previousVersion
            });

            // Clean up old global cache from previous versions
            try {
                await chrome.storage.local.remove('yoto_icons_cache');
            } catch (e) {
                // Ignore errors during cleanup
            }
        }
    }

    const isValid = await TokenManager.isTokenValid();

    // Load user-specific yotoicons cache
    await loadIconsCache();
});

chrome.runtime.onStartup.addListener(async () => {
    await loadIconsCache();
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

/**
 * ============================================
 * BULK EXPORT CONTROLLER
 * ============================================
 */

let offscreenDocument = null;
let exportManifests = new Map();

/**
 * Ensure offscreen document exists
 */
async function ensureOffscreenDocument() {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length > 0) {
        return true;
    }

    try {
        await chrome.offscreen.createDocument({
            url: 'offscreen/offscreen.html',
            reasons: ['BLOBS'],
            justification: 'Background download and ZIP creation for bulk export'
        });


        // Wait for the offscreen document to be fully loaded and ready
        // This ensures the message listener is set up before we send messages
        await new Promise(resolve => setTimeout(resolve, 500));

        // Verify the offscreen document is ready by sending a keep-alive message
        try {
            await chrome.runtime.sendMessage({ type: 'KEEP_ALIVE' });
        } catch (error) {
        }

        offscreenDocument = true;
        return true;
    } catch (error) {
        console.error('[BulkExport] Failed to create offscreen document:', error);
        return false;
    }
}

async function closeOffscreenDocument() {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length > 0) {
        try {
            await chrome.offscreen.closeDocument();
            offscreenDocument = false;
        } catch (error) {
            console.error('[BulkExport] Failed to close offscreen document:', error);
        }
    }
}

/**
 * Start bulk export process
 */
async function startBulkExport(request) {
    const { playlists } = request;


    try {
        // Ensure offscreen document exists
        const offscreenReady = await ensureOffscreenDocument();
        if (!offscreenReady) {
            console.error('[BulkExport] Failed to create offscreen document');
            return { error: 'Failed to initialize background downloader' };
        }

        // Create export manifest
        const manifestId = crypto.randomUUID();
        const manifest = await createExportManifest(playlists, manifestId);

        // Save only essential manifest metadata to chrome.storage to avoid quota issues
        const manifestMetadata = {
            id: manifest.id,
            createdAt: manifest.createdAt,
            status: manifest.status,
            playlistCount: manifest.playlists.length,
            fileCount: Object.keys(manifest.files || {}).length,
            progress: manifest.progress
        };
        await chrome.storage.local.set({
            [`manifest_${manifestId}`]: manifestMetadata
        });

        // Verify metadata was saved
        const saved = await chrome.storage.local.get(`manifest_${manifestId}`);

        // Store reference locally
        exportManifests.set(manifestId, manifest);

        // Send message to offscreen document to start downloads
        // Pass the full manifest since offscreen can't access chrome.storage
        try {
            const offscreenResponse = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    type: 'START_DOWNLOADS',
                    manifestId: manifestId,
                    manifest: manifest  // Pass full manifest data
                }, response => {
                    if (chrome.runtime.lastError) {
                        console.error('[BulkExport] Error sending to offscreen:', chrome.runtime.lastError);
                        // Resolve anyway - the offscreen document might still be processing
                        resolve({ success: false, error: chrome.runtime.lastError.message });
                    } else {
                        resolve(response);
                    }
                });
            });

            if (offscreenResponse && offscreenResponse.success) {
            } else {
            }
        } catch (error) {
            console.error('[BulkExport] Failed to communicate with offscreen document:', error);
            // Continue anyway, the offscreen document is likely still processing
        }


        return {
            success: true,
            manifestId: manifestId,
            totalFiles: getTotalFileCount(manifest)
        };
    } catch (error) {
        console.error('[BulkExport] Failed to start export:', error);
        return { error: error.message };
    }
}

/**
 * Create export manifest from playlists
 */
async function createExportManifest(playlists, manifestId) {

    const manifest = {
        id: manifestId,
        createdAt: Date.now(),
        status: 'pending',
        playlists: [],
        files: {},
        progress: {
            total: 0,
            completed: 0,
            failed: 0
        }
    };

    // Get current auth tokens for authenticated URLs
    const tokens = await TokenManager.getTokens();
    if (!tokens || !tokens.access_token) {
        throw new Error('Authentication required for export');
    }

    // Process each playlist
    for (const playlist of playlists) {
        const playlistId = playlist.cardId || playlist.id || playlist._id;

        // Resolve playlist to get full details
        const resolvedResult = await resolvePlaylist(playlistId);

        if (resolvedResult.error) {
            console.error(`[BulkExport] Failed to resolve playlist ${playlistId}:`, resolvedResult.error);
            continue;
        }

        const resolvedData = resolvedResult.data;
        const playlistManifest = {
            id: playlistId,
            title: playlist.title || 'Untitled',
            audioFiles: [],
            coverImage: null,
            iconImages: []
        };

        let trackCounter = 1; // Track counter for audio file prefixes

        // Extract audio files and icons from chapters
        const chapters = resolvedData?.card?.content?.chapters || resolvedData?.chapters || [];

        for (let i = 0; i < chapters.length; i++) {
            const chapter = chapters[i];

            // Process tracks (audio files)
            if (chapter.tracks && Array.isArray(chapter.tracks)) {
                for (let j = 0; j < chapter.tracks.length; j++) {
                    const track = chapter.tracks[j];
                    const trackUrl = track.trackUrl || track.url || track.audioUrl || track.mediaUrl || track.downloadUrl;

                    if (trackUrl && (trackUrl.startsWith('http://') || trackUrl.startsWith('https://'))) {
                        const fileId = `${playlistId}_audio_${i}_${j}`;
                        const trackTitle = track.title || `Track ${trackCounter}`;
                        const baseFilename = sanitizeFilename(trackTitle);
                        const filename = `${String(trackCounter).padStart(2, '0')}-${baseFilename}.mp3`;

                        const audioFile = {
                            id: fileId,
                            url: trackUrl,
                            filename: filename,
                            trackTitle: trackTitle,
                            trackNumber: trackCounter,
                            size: track.size || track.fileSize
                        };

                        playlistManifest.audioFiles.push(audioFile);

                        // Initialize file tracking
                        manifest.files[fileId] = {
                            type: 'audio',
                            playlistId: playlistId,
                            filename: audioFile.filename,
                            stored: false
                        };

                    } else if (trackUrl && trackUrl.startsWith('yoto:#')) {
                    } else {
                    }

                    // Track-level icon
                    const trackIcon = track.display?.icon16x16 ||
                                    track.display?.displayIcon?.imageL ||
                                    track.icon?.imageL;

                    if (trackIcon) {
                        const iconId = `${playlistId}_icon_${i}_${j}`;
                        const trackTitle = track.title || `Track ${trackCounter}`;
                        const baseIconName = sanitizeFilename(trackTitle);
                        const iconFilename = `${String(trackCounter).padStart(2, '0')}-${baseIconName}-icon.png`;

                        playlistManifest.iconImages.push({
                            id: iconId,
                            url: trackIcon,
                            filename: iconFilename
                        });

                        manifest.files[iconId] = {
                            type: 'icon',
                            playlistId: playlistId,
                            filename: iconFilename,
                            stored: false
                        };
                    }

                    // Increment track counter after processing this track
                    trackCounter++;
                }
            } else {
                const chapterUrl = chapter.trackUrl || chapter.url || chapter.audioUrl || chapter.mediaUrl || chapter.downloadUrl;

                if (chapterUrl && (chapterUrl.startsWith('http://') || chapterUrl.startsWith('https://'))) {
                    const fileId = `${playlistId}_audio_${i}`;
                    const trackTitle = chapter.title || `Track ${trackCounter}`;
                    const baseFilename = sanitizeFilename(trackTitle);
                    const filename = `${String(trackCounter).padStart(2, '0')}-${baseFilename}.mp3`;

                    const audioFile = {
                        id: fileId,
                        url: chapterUrl,
                        filename: filename,
                        trackTitle: trackTitle,
                        trackNumber: trackCounter,
                        size: chapter.size || chapter.fileSize
                    };

                    playlistManifest.audioFiles.push(audioFile);

                    manifest.files[fileId] = {
                        type: 'audio',
                        playlistId: playlistId,
                        filename: audioFile.filename,
                        stored: false
                    };

                } else if (chapterUrl && chapterUrl.startsWith('yoto:#')) {
                } else {
                }

                const chapterIcon = chapter.display?.icon16x16 ||
                                  chapter.display?.displayIcon?.imageL ||
                                  chapter.icon?.imageL;

                if (chapterIcon) {
                    const iconId = `${playlistId}_icon_${i}`;
                    const trackTitle = chapter.title || `Track ${trackCounter}`;
                    const baseIconName = sanitizeFilename(trackTitle);
                    const iconFilename = `${String(trackCounter).padStart(2, '0')}-${baseIconName}-icon.png`;

                    playlistManifest.iconImages.push({
                        id: iconId,
                        url: chapterIcon,
                        filename: iconFilename
                    });

                    manifest.files[iconId] = {
                        type: 'icon',
                        playlistId: playlistId,
                        filename: iconFilename,
                        stored: false
                    };
                }

                // Increment track counter after processing this chapter
                trackCounter++;
            }
        }

        // Extract cover image
        let coverUrl = resolvedData?.card?.metadata?.cover?.imageL ||
                       resolvedData?.coverImageL ||
                       playlist.coverImageL;

        // Convert yoto:# references to actual API URLs
        if (coverUrl && coverUrl.startsWith('yoto:#')) {
            const coverId = coverUrl.replace('yoto:#', '');
            coverUrl = `https://api.yotoplay.com/media/${coverId}`;
        }

        if (coverUrl) {
            const coverId = `${playlistId}_cover`;

            // Extract file extension from URL
            // For yoto API URLs (like /media/{id}), default to jpg
            let extension = 'jpg';
            if (coverUrl.includes('.')) {
                const urlParts = coverUrl.split('.');
                const potentialExt = urlParts[urlParts.length - 1].split('?')[0].split('/')[0].toLowerCase();
                // Only use if it's a valid image extension
                if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(potentialExt)) {
                    extension = potentialExt;
                }
            }

            // Use playlist title for cover filename
            const sanitizedTitle = sanitizeFilename(playlist.title || 'playlist');
            const coverFilename = `${sanitizedTitle}-cover.${extension}`;

            playlistManifest.coverImage = {
                id: coverId,
                url: coverUrl,
                filename: coverFilename
            };

            manifest.files[coverId] = {
                type: 'cover',
                playlistId: playlistId,
                filename: coverFilename,
                stored: false
            };
        }

        manifest.playlists.push(playlistManifest);
    }

    // Update total count
    manifest.progress.total = Object.keys(manifest.files).length;

    return manifest;
}

function getTotalFileCount(manifest) {
    return Object.keys(manifest.files || {}).length;
}

function sanitizeFilename(name) {
    return String(name)
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200) || 'untitled';
}

async function resumeBulkExport(manifestId) {

    try {
        // Ensure offscreen document exists
        const offscreenReady = await ensureOffscreenDocument();
        if (!offscreenReady) {
            return { error: 'Failed to initialize background downloader' };
        }

        // Send resume message to offscreen document
        await chrome.runtime.sendMessage({
            type: 'RESUME_DOWNLOADS',
            manifestId: manifestId
        });

        return { success: true };
    } catch (error) {
        console.error('[BulkExport] Failed to resume export:', error);
        return { error: error.message };
    }
}

async function cancelBulkExport(manifestId) {

    try {
        // Ensure offscreen document exists
        const offscreenReady = await ensureOffscreenDocument();
        if (!offscreenReady) {
            return { error: 'Failed to initialize background downloader' };
        }

        await chrome.runtime.sendMessage({
            type: 'CANCEL_DOWNLOADS',
            manifestId: manifestId
        });

        await chrome.storage.local.remove(`manifest_${manifestId}`);
        exportManifests.delete(manifestId);

        await closeOffscreenDocument();

        return { success: true };
    } catch (error) {
        console.error('[BulkExport] Failed to cancel export:', error);
        return { error: error.message };
    }
}

async function getExportStatus(manifestId) {

    try {
        let manifest = exportManifests.get(manifestId);

        if (!manifest) {
            const stored = await chrome.storage.local.get(`manifest_${manifestId}`);
            const manifestMetadata = stored[`manifest_${manifestId}`];
            if (!manifestMetadata) {
                return { error: 'Manifest not found' };
            }
            // Return status based on metadata only
            return {
                success: true,
                status: manifestMetadata.status || 'unknown',
                progress: manifestMetadata.progress || { total: 0, completed: 0, failed: 0 }
            };
        }

        // Calculate progress from full manifest
        const totalFiles = getTotalFileCount(manifest);
        const completedFiles = Object.values(manifest.files || {})
            .filter(f => f.stored || f.failed).length;

        return {
            success: true,
            status: manifest.status,
            progress: {
                total: totalFiles,
                completed: completedFiles,
                percentage: totalFiles > 0 ? Math.round((completedFiles / totalFiles) * 100) : 0
            },
            manifest: manifest
        };
    } catch (error) {
        console.error('[BulkExport] Failed to get status:', error);
        return { error: error.message };
    }
}

async function downloadExportZip(manifestId, playlistIds) {

    try {
        // Ensure offscreen document exists
        const offscreenReady = await ensureOffscreenDocument();
        if (!offscreenReady) {
            console.error('[BulkExport] Failed to initialize offscreen document');
            return { error: 'Failed to initialize background downloader' };
        }

        let manifest = exportManifests.get(manifestId);

        if (!manifest) {
            console.error(`[BulkExport] Manifest not found in memory for ID: ${manifestId}`);
            const stored = await chrome.storage.local.get(`manifest_${manifestId}`);
            const manifestMetadata = stored[`manifest_${manifestId}`];
            if (!manifestMetadata) {
                console.error('[BulkExport] Manifest metadata not found in storage either');
                return { error: 'Export manifest not found' };
            }
            console.error('[BulkExport] Only metadata available in storage - full manifest required for ZIP creation');
            return { error: 'Export manifest data not available - please try exporting again' };
        }


        // Check if files have been downloaded
        const totalFiles = getTotalFileCount(manifest);
        const downloadedFiles = Object.values(manifest.files || {})
            .filter(f => f.stored).length;
        const failedFiles = Object.values(manifest.files || {})
            .filter(f => f.failed).length;


        if (downloadedFiles === 0 && failedFiles === 0) {
            return { error: 'No files have been downloaded yet. Please wait for downloads to complete.' };
        }

        if (downloadedFiles === 0 && failedFiles > 0) {
            console.error('[BulkExport] All file downloads failed');
            return { error: `All file downloads failed (${failedFiles} files). Please try again.` };
        }


        // Send message to offscreen document to create and download ZIP
        // Pass the manifest since offscreen can't access chrome.storage
        const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
                type: 'CREATE_ZIP',
                manifestId: manifestId,
                playlistIds: playlistIds,
                manifest: manifest  // Include manifest data
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('[BulkExport] Error sending CREATE_ZIP message:', chrome.runtime.lastError);
                    resolve({ success: false, error: chrome.runtime.lastError.message });
                } else {
                    resolve(response || { success: true });
                }
            });
        });

        if (response && !response.success) {
            console.error('[BulkExport] CREATE_ZIP failed:', response.error);
            return { error: response.error || 'Failed to create ZIP file' };
        }

        return { success: true, downloadedFiles, totalFiles };
    } catch (error) {
        console.error('[BulkExport] Failed to create/download ZIP:', error);
        console.error('[BulkExport] Error stack:', error.stack);
        return { error: error.message };
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Handle proxy download requests from offscreen document
    if (request.type === 'PROXY_DOWNLOAD') {
        (async () => {
            try {
                const response = await fetch(request.url);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const buffer = await response.arrayBuffer();

                const bytes = new Uint8Array(buffer);
                let binary = '';
                for (let i = 0; i < bytes.byteLength; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                const base64 = btoa(binary);

                sendResponse({
                    success: true,
                    data: base64
                });
            } catch (error) {
                console.error(`[BulkExport] Proxy download failed:`, error);
                sendResponse({
                    success: false,
                    error: error.message
                });
            }
        })();
        return true; // Keep message channel open for async response
    }

    // Handle manifest updates from offscreen document
    if (request.type === 'MANIFEST_UPDATE') {
        (async () => {
            const { manifestId, updates } = request;

            let manifest = exportManifests.get(manifestId);
            if (!manifest) {
                // Cannot update manifest if not in memory
                return;
            }

            if (manifest && updates) {
                if (updates.files) {
                    if (!manifest.files) manifest.files = {};

                    Object.keys(updates.files).forEach(fileId => {
                        if (!manifest.files[fileId]) {
                            manifest.files[fileId] = updates.files[fileId];
                        } else {
                            // Deep merge file properties
                            manifest.files[fileId] = {
                                ...manifest.files[fileId],
                                ...updates.files[fileId]
                            };
                        }
                    });

                    delete updates.files;
                }

                Object.assign(manifest, updates);

                // Update progress stats
                if (manifest.files) {
                    manifest.progress = {
                        total: Object.keys(manifest.files).length,
                        completed: Object.values(manifest.files).filter(f => f.stored).length,
                        failed: Object.values(manifest.files).filter(f => f.failed).length
                    };
                }


                // Save back to memory and only metadata to storage to avoid quota issues
                exportManifests.set(manifestId, manifest);
                const manifestMetadata = {
                    id: manifest.id,
                    createdAt: manifest.createdAt,
                    status: manifest.status,
                    playlistCount: manifest.playlists ? manifest.playlists.length : 0,
                    fileCount: manifest.files ? Object.keys(manifest.files).length : 0,
                    progress: manifest.progress
                };
                await chrome.storage.local.set({ [`manifest_${manifestId}`]: manifestMetadata });
            }
        })();
        return false;
    }

    // Handle ZIP download with blob URL from offscreen document
    if (request.type === 'DOWNLOAD_ZIP_BLOB_URL') {

        (async () => {
            try {
                const sanitizedFilename = request.filename
                    .replace(/[<>:"|?*]/g, '_')
                    .replace(/\\/g, '/')
                    .replace(/\.{2,}/g, '.');


                const downloadId = await chrome.downloads.download({
                    url: request.blobUrl,
                    filename: sanitizedFilename,
                    saveAs: false,
                    conflictAction: 'uniquify'
                });


                chrome.downloads.onChanged.addListener(function downloadListener(delta) {
                    if (delta.id === downloadId && delta.state) {
                        if (delta.state.current === 'complete') {
                            chrome.downloads.onChanged.removeListener(downloadListener);

                            // Notify content script
                            chrome.tabs.query({ url: 'https://my.yotoplay.com/*' }, (tabs) => {
                                tabs.forEach(tab => {
                                    chrome.tabs.sendMessage(tab.id, {
                                        type: 'ZIP_DOWNLOADED',
                                        manifestId: request.manifestId,
                                        filename: sanitizedFilename
                                    }).catch(() => {});
                                });
                            });

                            // Only close offscreen document for non-progressive exports
                            // Progressive exports handle their own cleanup
                            if (!request.playlistTitle) {
                                setTimeout(async () => {
                                    await closeOffscreenDocument();
                                    if (request.manifestId && exportManifests.has(request.manifestId)) {
                                        exportManifests.delete(request.manifestId);
                                    }
                                }, 5000);
                            } else {
                            }
                        } else if (delta.state.current === 'interrupted') {
                            console.error(`[BulkExport] Download interrupted: ${sanitizedFilename}`);
                            chrome.downloads.onChanged.removeListener(downloadListener);

                            chrome.downloads.search({id: downloadId}, (results) => {
                                const error = results[0]?.error || 'Download was interrupted';
                                console.error(`[BulkExport] Download error details: ${error}`);

                                // Notify content script
                                chrome.tabs.query({ url: 'https://my.yotoplay.com/*' }, (tabs) => {
                                    tabs.forEach(tab => {
                                        chrome.tabs.sendMessage(tab.id, {
                                            type: 'ZIP_DOWNLOAD_ERROR',
                                            manifestId: request.manifestId,
                                            error: `Download interrupted: ${error}`
                                        }).catch(() => {});
                                    });
                                });
                            });
                        }
                    }
                });

            } catch (error) {
                console.error('[BulkExport] Failed to download ZIP:', error);

                // Notify content script
                chrome.tabs.query({ url: 'https://my.yotoplay.com/*' }, (tabs) => {
                    tabs.forEach(tab => {
                        chrome.tabs.sendMessage(tab.id, {
                            type: 'ZIP_DOWNLOAD_ERROR',
                            manifestId: request.manifestId,
                            error: error.message
                        }).catch(() => {});
                    });
                });
            }
        })();

        return false;
    }

    // Handle ZIP download from offscreen document (for small files)
    if (request.type === 'DOWNLOAD_ZIP') {

        (async () => {
            try {
                if (!request.dataUrl) {
                    throw new Error('No data URL received from offscreen document');
                }


                const sanitizedFilename = request.filename
                    .replace(/[<>:"|?*]/g, '_')  // Replace invalid characters
                    .replace(/\\/g, '/')          // Ensure forward slashes
                    .replace(/\.{2,}/g, '.');     // Remove multiple dots


                const downloadId = await chrome.downloads.download({
                    url: request.dataUrl,
                    filename: sanitizedFilename,
                    saveAs: false, // Automatically save to Downloads folder
                    conflictAction: 'uniquify' // Add number if file exists
                });


                // Monitor download progress
                chrome.downloads.onChanged.addListener(function downloadListener(delta) {
                    if (delta.id === downloadId) {
                        if (delta.state) {

                            if (delta.state.current === 'complete') {
                                chrome.downloads.onChanged.removeListener(downloadListener);

                                // Notify content script that ZIP was downloaded
                                chrome.tabs.query({ url: 'https://my.yotoplay.com/*' }, (tabs) => {
                                    tabs.forEach(tab => {
                                        chrome.tabs.sendMessage(tab.id, {
                                            type: 'ZIP_DOWNLOADED',
                                            manifestId: request.manifestId,
                                            filename: sanitizedFilename,
                                            downloadId: downloadId
                                        }).catch((error) => {
                                        });
                                    });
                                });

                                // Only close offscreen document for non-progressive exports
                                // Progressive exports handle their own cleanup
                                if (!request.isProgressive) {
                                    setTimeout(async () => {
                                        await closeOffscreenDocument();
                                        if (request.manifestId && exportManifests.has(request.manifestId)) {
                                            exportManifests.delete(request.manifestId);
                                        }
                                    }, 5000);
                                } else {
                                }
                            } else if (delta.state.current === 'interrupted') {
                                console.error(`[BulkExport] Download interrupted: ${sanitizedFilename}`);
                                chrome.downloads.onChanged.removeListener(downloadListener);

                                // Get error details
                                chrome.downloads.search({id: downloadId}, (results) => {
                                    const error = results[0]?.error || 'Download was interrupted';
                                    console.error(`[BulkExport] Download error details: ${error}`);

                                    // Notify content script of error
                                    chrome.tabs.query({ url: 'https://my.yotoplay.com/*' }, (tabs) => {
                                        tabs.forEach(tab => {
                                            chrome.tabs.sendMessage(tab.id, {
                                                type: 'ZIP_DOWNLOAD_ERROR',
                                                manifestId: request.manifestId,
                                                error: `Download interrupted: ${error}`
                                            }).catch(() => {});
                                        });
                                    });
                                });
                            }
                        }

                        if (delta.error) {
                            console.error(`[BulkExport] Download error: ${delta.error.current}`);
                        }
                    }
                });

            } catch (error) {
                console.error('[BulkExport] Failed to download ZIP:', error);
                console.error('[BulkExport] Error stack:', error.stack);

                // Notify content script of error
                chrome.tabs.query({ url: 'https://my.yotoplay.com/*' }, (tabs) => {
                    tabs.forEach(tab => {
                        chrome.tabs.sendMessage(tab.id, {
                            type: 'ZIP_DOWNLOAD_ERROR',
                            manifestId: request.manifestId,
                            error: error.message
                        }).catch(() => {});
                    });
                });
            }
        })();

        return false;
    }

    // Handle progressive export completion
    if (request.type === 'PROGRESSIVE_EXPORT_COMPLETED') {

        // Forward to all Yoto tabs first
        chrome.tabs.query({ url: 'https://my.yotoplay.com/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, request).catch((error) => {
                });
            });
        });

        // Clean up offscreen document and manifest after a delay
        setTimeout(async () => {
            await closeOffscreenDocument();
            if (request.manifestId && exportManifests.has(request.manifestId)) {
                exportManifests.delete(request.manifestId);
            }
        }, 5000);

        return false;
    }

    // Forward other progress updates from offscreen document to content script
    if (request.type === 'DOWNLOAD_PROGRESS' ||
        request.type === 'DOWNLOAD_COMPLETED' ||
        request.type === 'DOWNLOAD_FAILED' ||
        request.type === 'DOWNLOAD_STARTED' ||
        request.type === 'EXPORT_COMPLETED' ||
        request.type === 'DOWNLOADS_STARTED' ||
        request.type === 'ZIP_CREATED' ||
        request.type === 'EXPORT_ERROR' ||
        request.type === 'PROGRESSIVE_EXPORT_STARTED' ||
        request.type === 'PLAYLIST_EXPORT_STARTED' ||
        request.type === 'PLAYLIST_EXPORT_COMPLETED' ||
        request.type === 'PLAYLIST_EXPORT_FAILED') {


        // Forward to all Yoto tabs
        chrome.tabs.query({ url: 'https://my.yotoplay.com/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, request).catch((error) => {
                    // Tab might not have content script loaded, that's okay
                });
            });
        });
    }

    // Don't send response for these forwarded messages
    return false;
});


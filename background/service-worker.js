// Import configuration and analytics
importScripts('../config.js');
importScripts('../lib/analytics.js');
importScripts('../lib/utils.js');

// Use config from the centralized config file
const CONFIG = ExtensionConfig;

function getRedirectUri() {
    // Use Chrome's built-in redirect URI for extensions
    return chrome.identity.getRedirectURL();
}

// PKCE utilities for secure OAuth flow
function generateCodeVerifier() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return base64URLEncode(array);
}

async function generateCodeChallenge(codeVerifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return base64URLEncode(new Uint8Array(digest));
}

function base64URLEncode(buffer) {
    const base64 = btoa(String.fromCharCode(...buffer));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

class TokenManager {
    static async getTokens() {
        const result = await chrome.storage.local.get(CONFIG.TOKEN_STORAGE_KEY);
        const tokens = result[CONFIG.TOKEN_STORAGE_KEY] || null;
        
        if (tokens) {
            console.log('[TokenManager] Retrieved tokens:', {
                hasAccessToken: !!tokens.access_token,
                hasRefreshToken: !!tokens.refresh_token,
                accessTokenLength: tokens.access_token?.length || 0,
                accessTokenStart: tokens.access_token?.substring(0, 50) || 'none'
            });
        }
        
        return tokens;
    }

    static async setTokens(tokens) {
        console.log('[TokenManager] Storing tokens:', {
            hasAccessToken: !!tokens.access_token,
            hasRefreshToken: !!tokens.refresh_token,
            accessTokenLength: tokens.access_token?.length || 0,
            accessTokenStart: tokens.access_token?.substring(0, 50) || 'none'
        });
        
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
        // Clear stored tokens
        await chrome.storage.local.remove(CONFIG.TOKEN_STORAGE_KEY);
        
        // Clear Chrome identity cache by attempting to revoke access
        // This forces the next auth to re-authenticate
        try {
            // Clear web auth flow cache
            await chrome.identity.clearAllCachedAuthTokens?.();
        } catch (e) {
            // API might not be available in all Chrome versions
        }
        
        // Clear any stored OAuth state
        await chrome.storage.local.remove('oauth_state');
        
        console.log('[Auth] Cleared all authentication data and cache');
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
                    client_id: CONFIG.YOTO_CLIENT_ID,
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

async function startOAuthFlow(interactive = true) {
    const authUrl = 'https://login.yotoplay.com/authorize';

    // Generate state parameter for CSRF protection
    const state = crypto.randomUUID();
    
    // Store state for later verification
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
        // Add prompt=login to force re-authentication when interactive
        // This ensures we don't use cached sessions from wrong account
        ...(interactive ? { prompt: 'login' } : {})
    });

    const fullAuthUrl = `${authUrl}?${params.toString()}`;
    
    try {
        // Use Chrome's built-in OAuth flow - this is the proper way for extensions!
        const responseUrl = await chrome.identity.launchWebAuthFlow({
            url: fullAuthUrl,
            interactive: interactive // false for silent auth, true for user interaction
        });

        if (!responseUrl) {
            return {success: false, error: 'No response URL received'};
        }

        // Extract the authorization code from the response URL
        const url = new URL(responseUrl);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        const returnedState = url.searchParams.get('state');

        console.log('[OAuth] Response params:', {
            code: code ? 'present' : 'missing',
            error: error,
            state: returnedState,
            expectedState: state
        });

        if (error) {
            if (error === 'access_denied') {
                return {success: false, cancelled: true};
            }
            return {success: false, error: `Authentication error: ${error}`};
        }

        if (!code) {
            return {success: false, error: 'No authorization code received'};
        }

        // Get stored state for verification
        const storedData = await chrome.storage.local.get(['oauth_state']);
        const expectedState = storedData.oauth_state;
        
        // Verify state parameter for CSRF protection
        if (returnedState !== expectedState) {
            return {success: false, error: 'Invalid state parameter - possible CSRF attack'};
        }

        // Exchange the code for tokens immediately
        const tokenResult = await exchangeCodeForTokens(code);
        
        // Clean up stored state data
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
        
        // If this was a silent attempt and it failed, that's expected
        if (!interactive) {
            return {success: false, error: 'Silent authentication failed', needsInteractive: true};
        }
        
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
        
        console.log('[Token Exchange] Request body:', tokenRequestBody);
        
        const response = await fetch('https://login.yotoplay.com/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams(tokenRequestBody)
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Token exchange failed: ${error}`);
        }

        const tokens = await response.json();
        await TokenManager.setTokens(tokens);
        
        // Track successful authentication
        if (typeof YotoAnalytics !== 'undefined') {
            YotoAnalytics.trackAuth(true);
        }
        
        return {success: true, tokens};
    } catch (error) {
        return {success: false, error: error.message};
    }
}

async function makeAuthenticatedRequest(endpoint, options = {}) {
    let tokens = await TokenManager.getTokens();
    
    console.log('[API Auth] Token status:', {
        hasTokens: !!tokens,
        hasAccessToken: !!(tokens?.access_token),
        accessTokenLength: tokens?.access_token?.length || 0,
        isExpired: tokens?.access_token ? isTokenExpired(tokens.access_token) : 'no token'
    });
    
    // Check if token has required scopes for API access
    if (tokens?.access_token) {
        try {
            const payload = JSON.parse(atob(tokens.access_token.split('.')[1]));
            const scopes = payload.scope || payload.scopes || '';
            console.log('[API Auth] Token scopes:', scopes);
        } catch (e) {
            console.warn('[API Auth] Could not decode token scopes');
        }
    }

    if (tokens && isTokenExpired(tokens.access_token)) {
        console.log('[API Auth] Token expired, refreshing...');
        try {
            tokens = await TokenManager.refreshToken();
            console.log('[API Auth] Token refreshed successfully');
        } catch (error) {
            console.log('[API Auth] Token refresh failed:', error);
            return {error: 'Authentication required', needsAuth: true};
        }
    }

    if (!tokens || !tokens.access_token) {
        console.log('[API Auth] No valid tokens available');
        return {error: 'Not authenticated', needsAuth: true};
    }

    try {
        const url = endpoint.startsWith('http') ? endpoint : `${CONFIG.YOTO_API_BASE}${endpoint}`;

        // Don't set Content-Type for FormData - let browser set it with boundary
        // Also don't set default Content-Type if it's already specified in options.headers
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

        console.log('[API Request]', {
            url: url,
            method: options.method || 'GET',
            headers: authHeaders,
            body: options.body,
            tokenInfo: {
                tokenLength: tokens.access_token.length,
                tokenStart: tokens.access_token.substring(0, 50),
                tokenHasDots: (tokens.access_token.match(/\./g) || []).length
            }
        });

        const response = await fetch(url, {
            ...options,
            headers: authHeaders
        });

        console.log('[API Response]', {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries())
        });

        if (response.status === 401) {
            tokens = await TokenManager.refreshToken();
            return makeAuthenticatedRequest(endpoint, options);
        }

        if (response.status === 403) {
            const errorText = await response.text();
            console.log('[API 403 Error Response Body]', errorText);
            throw new Error(`API request forbidden: ${response.status}`);
        }

        if (!response.ok) {
            const errorText = await response.text();
            console.log('[API Error Response Body]', errorText);
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

        const responseJson = await response.json();
        console.log('[API Success Response Body]', responseJson);
        return responseJson;
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

// Icon cache to avoid re-uploading same icons from yotoicons.com
const yotoIconsCache = new Map();
const YOTO_ICONS_CACHE_KEY = 'yoto_icons_cache';

// Rate limiting for yotoicons.com requests
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

// Load cache from storage on startup
async function loadIconsCache() {
    try {
        const result = await chrome.storage.local.get(YOTO_ICONS_CACHE_KEY);
        const cached = result[YOTO_ICONS_CACHE_KEY];
        if (cached && typeof cached === 'object') {
            Object.entries(cached).forEach(([key, value]) => {
                yotoIconsCache.set(key, value);
            });
        }
    } catch (error) {
        console.warn('Failed to load icons cache:', error);
    }
}

// Save cache to storage
async function saveIconsCache() {
    try {
        const cacheObj = Object.fromEntries(yotoIconsCache);
        await chrome.storage.local.set({
            [YOTO_ICONS_CACHE_KEY]: cacheObj
        });
    } catch (error) {
        console.warn('Failed to save icons cache:', error);
    }
}

// Fetch icons from yotoicons.com
async function fetchFromYotoicons(query) {
    try {
        // Rate limiting
        await rateLimiter.wait();
        
        const searchUrl = `https://www.yotoicons.com/icons?tag=${encodeURIComponent(query)}`;
        
        const response = await fetch(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const html = await response.text();
        
        // Parse HTML to extract icon information
        const icons = [];
        
        // More comprehensive regex patterns
        const iconRegex = /<img[^>]+src=["']\/static\/uploads\/(\d+)\.png["'][^>]*>/g;
        
        let match;
        const seenIds = new Set();
        
        while ((match = iconRegex.exec(html)) !== null) {
            const iconId = match[1];
            
            // Skip duplicates
            if (seenIds.has(iconId)) continue;
            seenIds.add(iconId);
            
            const iconUrl = `https://www.yotoicons.com/static/uploads/${iconId}.png`;
            
            // Extract author and title from surrounding context
            const contextStart = Math.max(0, match.index - 500);
            const contextEnd = Math.min(html.length, match.index + 500);
            const context = html.slice(contextStart, contextEnd);
            
            // Look for author pattern
            const authorMatch = context.match(/@([a-zA-Z0-9_-]+)/);
            const author = authorMatch ? authorMatch[1] : 'unknown';
            
            // Look for title or alt text
            const altMatch = match[0].match(/alt=["']([^"']+)["']/);
            const titleMatch = context.match(/title=["']([^"']+)["']/);
            
            let title = `Icon ${iconId}`;
            if (altMatch && altMatch[1] && !altMatch[1].includes('.png')) {
                title = altMatch[1];
            } else if (titleMatch && titleMatch[1]) {
                title = titleMatch[1];
            }
            
            icons.push({
                id: iconId,
                url: iconUrl,
                title: `${query} icon ${iconId}`, // Include search term in title
                author: author,
                source: 'yotoicons',
                searchQuery: query // Store original query for reference
            });
            
            // Limit to first 10 results for performance
            if (icons.length >= 10) break;
        }
        
        return icons;
    } catch (error) {
        return [];
    }
}

// Download icon from yotoicons.com and upload to Yoto
async function downloadAndUploadIcon(yotoIcon) {
    try {
        // Check cache first
        const cacheKey = yotoIcon.id;
        if (yotoIconsCache.has(cacheKey)) {
            const cached = yotoIconsCache.get(cacheKey);
            
            // Return cached entry regardless of dataUrl - we'll fix missing dataUrls by re-downloading the image
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
                // For old cache entries without dataUrl, re-download just the image to create dataUrl
                try {
                    const imageResponse = await fetch(yotoIcon.url);
                    if (imageResponse.ok) {
                        const arrayBuffer = await imageResponse.arrayBuffer();
                        const bytes = new Uint8Array(arrayBuffer);
                        let binary = '';
                        bytes.forEach(byte => binary += String.fromCharCode(byte));
                        const base64 = btoa(binary);
                        const dataUrl = `data:image/png;base64,${base64}`;
                        
                        // Update cache with dataUrl
                        cached.dataUrl = dataUrl;
                        yotoIconsCache.set(cacheKey, cached);
                        saveIconsCache().catch(console.warn);
                        
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
                    // Silently fail and use fallback
                }
                
                // Fall back to original cached entry with API URL
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
        
        // Download the icon
        const response = await fetch(yotoIcon.url);
        if (!response.ok) {
            throw new Error(`Failed to download icon: ${response.status}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        
        // Convert to base64 for upload
        let binary = '';
        bytes.forEach(byte => binary += String.fromCharCode(byte));
        const base64 = btoa(binary);
        
        // Upload to Yoto
        const uploadResult = await uploadIcon({
            data: base64,
            type: 'image/png',
            name: `yotoicon_${yotoIcon.id}.png`
        });
        
        if (uploadResult.error) {
            throw new Error(uploadResult.error);
        }
        
        // Create a data URL for display purposes (since uploaded icons are private)
        const dataUrl = `data:image/png;base64,${base64}`;
        
        // Cache the result
        const cacheEntry = {
            mediaId: uploadResult.mediaId,
            iconId: uploadResult.iconId,
            url: `https://api.yotoplay.com/media/${uploadResult.mediaId}`,
            dataUrl: dataUrl, // Store data URL for display
            uploadedAt: new Date().toISOString()
        };
        yotoIconsCache.set(cacheKey, cacheEntry);
        
        // Save cache to storage (fire and forget)
        saveIconsCache().catch(console.warn);
        
        return {
            title: `${yotoIcon.title} (by @${yotoIcon.author})`,
            mediaId: uploadResult.mediaId,
            url: dataUrl, // Use data URL for display instead of API URL
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

        let yotoMatches = allIcons.filter(icon => {
            const allText = [
                icon.title,
                icon.mediaId,
                ...(icon.publicTags || [])
            ].filter(Boolean).join(' ').toLowerCase();
            return allText.includes(lowerQuery);
        });

        // If no matches and word appears plural, try singular form
        if (yotoMatches.length === 0 && Utils.isPlural(query)) {
            const singular = Utils.singularize(query);
            if (singular !== query) {
                console.log(`No matches for "${query}", trying singular: "${singular}"`);
                const singularLower = singular.toLowerCase();
                
                yotoMatches = allIcons.filter(icon => {
                    const allText = [
                        icon.title,
                        icon.mediaId,
                        ...(icon.publicTags || [])
                    ].filter(Boolean).join(' ').toLowerCase();
                    return allText.includes(singularLower);
                });
            }
        }

        // If no public Yoto icons found, search yotoicons.com and upload results
        if (yotoMatches.length === 0) {
            try {
                // Try yotoicons.com with original query first
                let yotoIconsResults = await fetchFromYotoicons(query);
                
                // If no results and word appears plural, try singular on yotoicons.com
                if (yotoIconsResults.length === 0 && Utils.isPlural(query)) {
                    const singular = Utils.singularize(query);
                    if (singular !== query) {
                        console.log(`No yotoicons.com results for "${query}", trying singular: "${singular}"`);
                        yotoIconsResults = await fetchFromYotoicons(singular);
                    }
                }
                
                if (yotoIconsResults.length > 0) {
                    // Download and upload icons in parallel, but limit concurrency
                    const uploadPromises = yotoIconsResults.slice(0, 5).map(icon => 
                        downloadAndUploadIcon(icon)
                    );
                    
                    const uploadResults = await Promise.allSettled(uploadPromises);
                    
                    // Process successful uploads
                    uploadResults.forEach(result => {
                        if (result.status === 'fulfilled' && result.value) {
                            allIcons.push(result.value);
                        }
                    });
                }
            } catch (error) {
                // Silently continue if yotoicons.com fails
            }
            
            // Add fallback link if still no results
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
        }

        // Prepare search terms (original + singular if applicable)
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
            
            // Always include yotoicons that were just uploaded for this search
            if (icon.source?.startsWith('yotoicons')) {
                return true;
            }
            
            const allText = [
                icon.title,
                icon.mediaId,
                ...(icon.publicTags || [])
            ].filter(Boolean).join(' ').toLowerCase();
            
            // Check if text matches any of our search terms
            return searchTerms.some(term => allText.includes(term));
        });

        filteredIcons.sort((a, b) => {
            // Check for exact matches with any search term
            const aExact = searchTerms.some(term => a.title?.toLowerCase() === term);
            const bExact = searchTerms.some(term => b.title?.toLowerCase() === term);
            if (aExact && !bExact) return -1;
            if (!aExact && bExact) return 1;

            // Prioritize: yoto-public > yotoicons-cached > yotoicons-uploaded > yotoicons-link > others
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

async function matchIcons(tracks) {
    const matches = [];

    for (const track of tracks) {
        let iconOptions = [];

        try {
            const fullResults = await searchIcons(track.title);
            if (fullResults.icons && fullResults.icons.length > 0) {
                const validIcons = fullResults.icons.filter(icon => {
                    return !icon.isPlaceholder && icon.url && (icon.url.startsWith('http') || icon.url.startsWith('data:'));
                }).slice(0, 10);
                
                iconOptions = validIcons.map(icon => {
                    let iconUrl = icon.url || icon.mediaUrl || null;
                    
                    if (!iconUrl && icon.mediaId) {
                        iconUrl = `https://api.yotoplay.com/media/${icon.mediaId}`;
                    }
                    
                    // Updated validation to support data URLs
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

// This function has been moved to line 811 to avoid duplication

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
        const maxAttempts = 120; // 60 seconds with 500ms intervals - increased for larger files

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
        
        throw error;
    }
}

// Removed duplicate createPlaylistContent function - using the simpler one below

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

// Upload cover image and get public URL
async function uploadCoverImage(imageFileData) {
    try {
        // Convert base64 string to binary array
        const binaryString = atob(imageFileData.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        // Create a File object from the bytes
        const imageFile = new File([bytes], imageFileData.name || 'cover.png', {
            type: imageFileData.type || 'image/png'
        });
        
        // Upload the cover image using the dedicated coverImage endpoint
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
        
        // If we get here, log the entire response to understand its structure
        
        return { error: 'Unexpected response structure from cover upload' };
    } catch (error) {
        return { error: error.message };
    }
}

// Upload icon to Yoto
async function uploadIcon(iconFileData) {
    try {
        // Convert base64 string to binary array
        const binaryString = atob(iconFileData.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        // Extract filename without extension for the query parameter
        const filename = iconFileData.name ? iconFileData.name.split('.')[0] : 'icon';
        
        // Upload the icon - send binary data directly in body
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
            return { error: response.error };
        }
        
        if (response.displayIcon) {
            // Return the mediaId in yoto:# format for use in tracks
            const mediaId = response.displayIcon.mediaId;
            return {
                success: true,
                iconId: mediaId.startsWith('yoto:#') ? mediaId : `yoto:#${mediaId}`,
                mediaId: response.displayIcon.mediaId,
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
        const maxAttempts = 60; // 60 seconds - increased for larger files
        
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
async function createPlaylistContent(title, audioTracks, iconIds = [], coverUrl = null) {
    try {
        const chapters = audioTracks.map((audio, index) => {
            const chapterKey = String(index + 1).padStart(2, '0');
            // Use yoto:# format for icons - this is what the API expects
            const iconId = iconIds[index] || 'yoto:#aUm9i3ex3qqAMYBv-i-O-pYMKuMJGICtR3Vhf289u2Q'; // Default Yoto icon
            
            const chapter = {
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
                },
                fileSize: audio.transcodedAudio.transcodedInfo?.fileSize,
                duration: audio.transcodedAudio.transcodedInfo?.duration,
                availableFrom: null,
                ambient: null,
                defaultTrackDisplay: null,
                defaultTrackAmbient: null
            };
            
            return chapter;
        });
        
        const totalDuration = audioTracks.reduce((sum, audio) => 
            sum + (audio.transcodedAudio.transcodedInfo?.duration || 0), 0);
        const totalFileSize = audioTracks.reduce((sum, audio) => 
            sum + (audio.transcodedAudio.transcodedInfo?.fileSize || 0), 0);
        
        // Get user info from token
        const tokens = await TokenManager.getTokens();
        let userId = 'unknown';
        if (tokens?.access_token) {
            try {
                const payload = JSON.parse(atob(tokens.access_token.split('.')[1]));
                userId = payload.sub || 'unknown';
            } catch (e) {
                
            }
        }
        
        // Ensure coverUrl is a string or null
        const coverUrlString = typeof coverUrl === 'string' ? coverUrl : null;
        
        // Build metadata object
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
        } else {
            
        }
        
        const content = {
            content: {
                chapters,
                playbackType: 'linear',
                config: {
                    resumeTimeout: 2592000
                }
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
        
        console.log('[CREATE_PLAYLIST] API Response:', {
            hasError: !!createResponse.error,
            hasCardId: !!createResponse.cardId,
            cardId: createResponse.cardId,
            fullResponse: createResponse
        });
        
        // If it fails with a cover, try without the cover
        if (createResponse.error && coverUrlString) {
            console.log('[CREATE_PLAYLIST] Retrying without cover image...');
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
                console.log('[CREATE_PLAYLIST] Retry successful without cover');
            }
        }
        
        // Check if we got a cardId in the response - this means success
        if (createResponse.cardId) {
            console.log('[CREATE_PLAYLIST] Success! Card created with ID:', createResponse.cardId);
            
            // Try to fetch the created card to verify it exists
            try {
                const verifyResponse = await makeAuthenticatedRequest(`/content/${createResponse.cardId}`);
                console.log('[CREATE_PLAYLIST] Verification of created card:', {
                    exists: !verifyResponse.error,
                    hasContent: !!verifyResponse.card,
                    title: verifyResponse.card?.title
                });
            } catch (e) {
                console.warn('[CREATE_PLAYLIST] Could not verify created card:', e);
            }
        }
        
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

                case 'DEBUG_TOKENS':
                    const debugTokens = await TokenManager.getTokens();
                    if (debugTokens && debugTokens.access_token) {
                        try {
                            // Decode the JWT payload to see scopes
                            const payload = JSON.parse(atob(debugTokens.access_token.split('.')[1]));
                            sendResponse({
                                success: true,
                                scopes: payload.scope || payload.scp || 'No scopes found',
                                audience: payload.aud,
                                expiry: new Date(payload.exp * 1000).toISOString()
                            });
                        } catch (error) {
                            sendResponse({success: false, error: 'Could not decode token'});
                        }
                    } else {
                        sendResponse({success: false, error: 'No tokens found'});
                    }
                    break;

                case 'CLEAR_AUTH':
                    await TokenManager.clearAllAuthData();
                    sendResponse({success: true, message: 'All authentication data cleared'});
                    break;

                case 'START_AUTH':
                    // Try silent authentication first (like MYO Studio)
                    let authResult = await startOAuthFlow(false); // Silent attempt
                    
                    if (!authResult.success && authResult.needsInteractive) {
                        // Silent auth failed, try interactive
                        authResult = await startOAuthFlow(true); // Interactive fallback
                    }
                    
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

                case 'CLEAR_YOTOICONS_CACHE':
                    // Clear the yotoicons cache to force re-download with dataUrls
                    try {
                        const cacheSize = yotoIconsCache.size;
                        yotoIconsCache.clear();
                        await chrome.storage.local.remove(YOTO_ICONS_CACHE_KEY);
                        
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
                    const iconResponse = await uploadIcon({
                        data: request.file.data,
                        type: request.file.type,
                        name: request.file.name
                    });
                    sendResponse(iconResponse);
                    break;
                    
                case 'UPLOAD_COVER':
                    // Upload cover image and get its public URL
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
                        request.coverUrl
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
                    await TokenManager.clearAllAuthData();
                    sendResponse({success: true, message: 'Logged out and cleared all auth data'});
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
        }
    }
    
    const isValid = await TokenManager.isTokenValid();
    
    // Load yotoicons cache
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


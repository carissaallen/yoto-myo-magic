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


function base64URLEncode(buffer) {
    const base64 = btoa(String.fromCharCode(...buffer));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function cleanEpisodeTitle(title) {
    // Clean episode title similar to cleanTrackTitle in content.js
    let cleanedTitle = title;
    
    // Replace underscores with spaces
    cleanedTitle = cleanedTitle.replace(/_/g, ' ');
    
    // Remove leading digits and any following separators (period, dash, space, colon)
    // This handles formats like:
    // "1. Episode Name" -> "Episode Name"
    // "001 - Episode Name" -> "Episode Name"
    // "2: Episode Name" -> "Episode Name"
    // "Episode 5: The Title" stays as is (digits not at start)
    cleanedTitle = cleanedTitle.replace(/^\d+[\.\-\s:]+/, '');
    
    // Clean up any multiple spaces
    cleanedTitle = cleanedTitle.replace(/\s+/g, ' ');
    
    // Trim whitespace
    cleanedTitle = cleanedTitle.trim();
    
    // If title is empty after cleaning, return original
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
    
    
    // Check if token has required scopes for API access
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
                // Not JSON, use raw text
            }
            throw new Error(`API request failed: ${response.status} - ${errorText}`);
        }

        const responseJson = await response.json();
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

        const matchesWholeWord = (text, word) => {
            // For numbers, do exact matching or look for the number in common formats
            if (/^\d+$/.test(word)) {
                const patterns = [
                    `\\b${word}\\b`,  // exact number
                    `#${word}\\b`,     // hashtag format like #1
                    `number ${word}\\b`, // "number 1" format
                    `no\\.?\\s*${word}\\b` // "no. 1" or "no 1" format
                ];
                const regex = new RegExp(patterns.join('|'), 'i');
                return regex.test(text);
            }
            // For text, use word boundaries
            const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            return regex.test(text);
        };

        let yotoMatches = allIcons.filter(icon => {
            const allText = [
                icon.title,
                icon.mediaId,
                ...(icon.publicTags || [])
            ].filter(Boolean).join(' ');
            return matchesWholeWord(allText, query);
        });

        // If no matches and word appears plural, try singular form
        if (yotoMatches.length === 0 && Utils.isPlural(query)) {
            const singular = Utils.singularize(query);
            if (singular !== query) {
                yotoMatches = allIcons.filter(icon => {
                    const allText = [
                        icon.title,
                        icon.mediaId,
                        ...(icon.publicTags || [])
                    ].filter(Boolean).join(' ');
                    return matchesWholeWord(allText, singular);
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
            ].filter(Boolean).join(' ');
            
            // Check if text matches any of our search terms using whole word matching
            return searchTerms.some(term => matchesWholeWord(allText, term));
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

async function searchIconsByCategory(category) {
    try {
        // Search for icons using the category as a query
        const searchResult = await searchIcons(category);
        
        // If we have enough icons from the initial search, return them
        if (searchResult.icons && searchResult.icons.length >= 20) {
            return { icons: searchResult.icons.slice(0, 50) };
        }
        
        // If not enough icons, try related terms
        const relatedTerms = getRelatedTerms(category);
        let allIcons = searchResult.icons || [];
        
        for (const term of relatedTerms) {
            if (allIcons.length >= 50) break;
            
            const additionalResults = await searchIcons(term);
            if (additionalResults.icons) {
                // Filter out duplicates based on mediaId
                const existingIds = new Set(allIcons.map(i => i.mediaId));
                const newIcons = additionalResults.icons.filter(i => !existingIds.has(i.mediaId));
                allIcons = allIcons.concat(newIcons);
            }
        }
        
        return { icons: allIcons.slice(0, 50) };
    } catch (error) {
        return { error: error.message };
    }
}

function getRelatedTerms(category) {
    const categoryMap = {
        'animals': ['animal', 'pet', 'zoo', 'farm', 'wildlife', 'dog', 'cat', 'bird'],
        'art': ['paint', 'draw', 'color', 'brush', 'canvas', 'creative', 'craft'],
        'buildings': ['house', 'home', 'office', 'city', 'architecture', 'building', 'tower'],
        'chapters': ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'number', 'numbers', 'book'],
        'emotions': ['happy', 'sad', 'love', 'angry', 'smile', 'heart', 'feeling'],
        'fantasy': ['magic', 'fairy', 'dragon', 'unicorn', 'wizard', 'castle', 'princess'],
        'food': ['fruit', 'vegetable', 'meal', 'snack', 'drink', 'cooking', 'kitchen'],
        'games': ['play', 'toy', 'puzzle', 'board', 'video', 'fun', 'entertainment'],
        'holiday': ['christmas', 'easter', 'halloween', 'birthday', 'celebration', 'party'],
        'music': ['musical', 'instrument', 'song', 'note', 'piano', 'guitar', 'drum'],
        'nature': ['tree', 'flower', 'plant', 'forest', 'mountain', 'sun', 'cloud'],
        'school': ['education', 'learning', 'book', 'pencil', 'classroom', 'teacher', 'student'],
        'science': ['experiment', 'chemistry', 'physics', 'biology', 'lab', 'research'],
        'space': ['star', 'planet', 'moon', 'rocket', 'astronaut', 'galaxy', 'universe'],
        'sports': ['sport', 'ball', 'game', 'team', 'football', 'basketball', 'soccer'],
        'tools': ['hammer', 'wrench', 'screwdriver', 'build', 'fix', 'repair', 'construction'],
        'transportation': ['car', 'train', 'plane', 'boat', 'bike', 'bus', 'vehicle'],
        'weather': ['rain', 'snow', 'sun', 'cloud', 'storm', 'wind', 'temperature']
    };
    
    const lowerCategory = category.toLowerCase();
    return categoryMap[lowerCategory] || [category];
}

async function applyCategoryIcons(cardId, selectedIcons) {
    try {
        // Get card content
        const cardContent = await getCardContent(cardId);
        if (cardContent.error) {
            return { error: cardContent.error };
        }
        
        if (!cardContent.card?.content?.chapters || !Array.isArray(cardContent.card.content.chapters)) {
            return { error: 'No chapters found in card' };
        }
        
        // Process icons - upload yotoicons.com icons if needed
        const processedIcons = [];
        for (const icon of selectedIcons) {
            let processedIcon = icon;
            
            // Upload icon if it's from yotoicons.com
            if (icon.source === 'yotoicons-uploaded' || (icon.url && icon.url.includes('yotoicons.com'))) {
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
            
            // Get the proper icon ID format
            let iconId = processedIcon.iconId || processedIcon.mediaId || processedIcon.displayIconId;
            if (iconId && !iconId.startsWith('yoto:#')) {
                iconId = `yoto:#${iconId}`;
            }
            
            processedIcons.push(iconId);
        }
        
        // Apply icons to chapters in a repeating pattern
        let iconIndex = 0;
        let iconsUpdated = 0;
        
        cardContent.card.content.chapters.forEach((chapter) => {
            const iconId = processedIcons[iconIndex];
            
            // Update chapter display icon
            if (!chapter.display) {
                chapter.display = {};
            }
            chapter.display.icon16x16 = iconId;
            
            // Update all tracks in the chapter with the same icon
            if (chapter.tracks && chapter.tracks.length > 0) {
                chapter.tracks.forEach((track) => {
                    if (!track.display) {
                        track.display = {};
                    }
                    track.display.icon16x16 = iconId;
                });
            }
            
            iconsUpdated++;
            
            // Move to next icon (wrap around if necessary)
            iconIndex = (iconIndex + 1) % processedIcons.length;
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
        // Remove punctuation and possessives, split into words
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
        
        // Remove duplicates while preserving order
        return [...new Set(words)];
    };

    for (const track of tracks) {
        let iconOptions = [];

        try {
            // First try with the full cleaned title
            const cleanedTitle = track.title.replace(/['']s\b/gi, '');
            const fullResults = await searchIcons(cleanedTitle);
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

        // If we don't have enough icons, search by individual keywords
        if (iconOptions.length < 5) {
            const keywords = extractKeywords(track.title);

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
                // Ignore decode errors for user ID
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
        
        // Check if we got a cardId in the response - this means success
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

// Listen Notes API functions

// Cache implementation for API responses
const apiCache = {
    cache: new Map(),
    
    // Generate a cache key from the request
    getKey: (endpoint, params = {}) => {
        const sortedParams = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
        return `${endpoint}?${sortedParams}`;
    },
    
    // Get cached data if it exists and is not expired
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
    
    // Store data in cache
    set: function(endpoint, params = {}, data) {
        const key = this.getKey(endpoint, params);
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    },
    
    // Clear all cache or specific endpoint
    clear: function(endpoint = null) {
        if (endpoint) {
            // Clear specific endpoint
            const keysToDelete = [];
            for (const key of this.cache.keys()) {
                if (key.startsWith(endpoint)) {
                    keysToDelete.push(key);
                }
            }
            keysToDelete.forEach(key => this.cache.delete(key));
        } else {
            // Clear all
            this.cache.clear();
        }
    }
};

// Static fallback data for when API is unavailable or limit reached
const staticPodcastData = {
    popularKidsPodcasts: [
        {
            id: "static_1",
            title: "Wow in the World",
            publisher: "Tinkercast",
            description: "The #1 science podcast for kids and their grown-ups. Hosts Mindy Thomas and Guy Raz guide curious kids and their grown-ups on a journey into the wonders of the world around them.",
            thumbnail: null,
            total_episodes: 500
        },
        {
            id: "static_2",
            title: "Story Pirates",
            publisher: "Gimlet Media",
            description: "The Story Pirates Podcast is a wildly fun show for kids and families. Each episode features stories written by kids brought to life by the Story Pirates' talented comedy troupe.",
            thumbnail: null,
            total_episodes: 200
        },
        {
            id: "static_3",
            title: "Radiolab for Kids",
            publisher: "WNYC Studios",
            description: "Radiolab for Kids is a place where children and adults investigate the world together. We ask questions and go wherever curiosity takes us.",
            thumbnail: null,
            total_episodes: 100
        },
        {
            id: "static_4",
            title: "Work It Out Wombats!",
            publisher: "GBH & PBS Kids",
            description: "Work It Out Wombats! follows a playful trio of marsupial siblings who live with their grandmother in a fantastical treehouse apartment complex.",
            thumbnail: null,
            total_episodes: 50
        },
        {
            id: "static_5",
            title: "Tumble Science Podcast for Kids",
            publisher: "Tumble Media",
            description: "Tumble is a science podcast created to be enjoyed by the entire family. Hosted by Lindsay Patterson and Marshall Escamilla.",
            thumbnail: null,
            total_episodes: 200
        }
    ],
    
    genres: [
        { id: 132, name: "Kids & Family", parent_id: 0 },
        { id: 133, name: "Stories for Kids", parent_id: 132 },
        { id: 134, name: "Education for Kids", parent_id: 132 }
    ]
};

async function searchPodcasts(query) {
    try {
        const cached = apiCache.get('search', { q: query });
        if (cached) {
            return cached;
        }

        const response = await fetch(`${CONFIG.PROXY_SERVER_URL}/api/search?q=${encodeURIComponent(query)}&type=podcast&only_in=title,description&language=English&safe_mode=0`);

        if (!response.ok) {
            if (response.status === 401) {
                return { error: 'API authentication failed. Please check the proxy server configuration.' };
            }
            if (response.status === 429) {
                // Rate limited - return rate limit error with user-friendly message
                return { 
                    error: 'rate_limited',
                    rateLimited: true,
                    message: "We've reached the maximum allowed use of the podcast search service for now. To keep this extension free for all users, we have usage limits that reset periodically. Please try again later, or browse the popular podcasts below.",
                    podcasts: staticPodcastData.popularKidsPodcasts,
                    fromCache: true,
                    isStatic: true
                };
            }
            return { error: `Failed to search podcasts: ${response.statusText}` };
        }

        const data = await response.json();
        
        // Transform the results to a simpler format
        const podcasts = data.results.slice(0, 10).map(podcast => ({
            id: podcast.id,
            title: podcast.title_original,
            publisher: podcast.publisher_original,
            thumbnail: podcast.thumbnail,
            total_episodes: podcast.total_episodes,
            description: podcast.description_original
        }));

        const result = { podcasts };
        
        // Cache the result
        apiCache.set('search', { q: query }, result);
        
        return result;
    } catch (error) {
        
        // If API fails, try to return static fallback data
        return { 
            podcasts: staticPodcastData.popularKidsPodcasts,
            fromCache: true,
            isStatic: true,
            error: 'Using fallback data due to API error'
        };
    }
}

async function getGenres() {
    try {
        // Check cache first (genres rarely change - 24 hour TTL)
        const cached = apiCache.get('genres', {}, 1440); // 1440 minutes = 24 hours
        if (cached) {
            return cached;
        }

        return {
            genres: staticPodcastData.genres,
            kidsGenres: staticPodcastData.genres,
            fromCache: false,
            isStatic: true
        };

        // The code below is commented out since we're using static genres for now
        // Will be implemented when proxy server has genres endpoint
    } catch (error) {
        
        return {
            genres: staticPodcastData.genres,
            kidsGenres: staticPodcastData.genres,
            fromCache: true,
            isStatic: true,
            error: 'Using fallback genres due to API error'
        };
    }
}

async function getBestPodcasts(genreId = null, page = 1) {
    try {
        // Use the search API to get popular kids podcasts
        // Search for general kids content to get a variety of popular podcasts
        const searchTerms = [
            'kids stories',
            'science for kids', 
            'educational kids',
            'bedtime stories',
            'kids adventure'
        ];
        
        // Pick a random search term for variety
        const searchTerm = searchTerms[Math.floor(Math.random() * searchTerms.length)];
        
        // Check cache first
        const cacheKey = `best_podcasts_${searchTerm}_${page}`;
        const cached = apiCache.get('best_podcasts', { term: searchTerm, page: page }, 60); // 1 hour cache
        if (cached) {
            return cached;
        }
        
        const response = await fetch(`${CONFIG.PROXY_SERVER_URL}/api/search?q=${encodeURIComponent(searchTerm)}&type=podcast&only_in=title,description&language=English&safe_mode=1&offset=${(page - 1) * 10}`);
        
        if (!response.ok) {
            throw new Error(`API response not ok: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Transform results to match expected format
        const podcasts = data.results ? data.results.slice(0, 10).map(podcast => ({
            id: podcast.id,
            title: podcast.title_original,
            publisher: podcast.publisher_original,
            thumbnail: podcast.thumbnail,
            total_episodes: podcast.total_episodes,
            description: podcast.description_original
        })) : [];
        
        const result = {
            podcasts: podcasts,
            has_next: data.next_offset ? true : false,
            has_previous: page > 1,
            page_number: page,
            total: data.total || podcasts.length,
            fromCache: false,
            isStatic: false
        };
        
        // Cache the result
        apiCache.set('best_podcasts', { term: searchTerm, page: page }, result);
        
        return result;

    } catch (error) {
        console.error('Error fetching best podcasts:', error);
        // Fall back to static data if API fails
        return { 
            podcasts: staticPodcastData.popularKidsPodcasts,
            has_next: false,
            has_previous: page > 1,
            page_number: page,
            total: staticPodcastData.popularKidsPodcasts.length,
            fromCache: true,
            isStatic: true,
            error: 'Using fallback data due to API error'
        };
    }
}

async function getPodcastEpisodes(podcastId) {
    try {
        const cached = apiCache.get('podcast_episodes', { id: podcastId }, 720); // 720 minutes = 12 hours
        if (cached) {
            return cached;
        }

        const response = await fetch(`${CONFIG.PROXY_SERVER_URL}/api/podcast/${podcastId}?sort=recent_first`);

        if (!response.ok) {
            if (response.status === 429) {
                // Rate limited - return error with user-friendly message
                return { 
                    error: 'rate_limited',
                    rateLimited: true,
                    message: "We've reached the maximum allowed use of the podcast service for now. To keep this extension free for all users, we have usage limits that reset periodically. Please try again later. We appreciate your patience and hope to expand the allowed usage in the future."
                };
            }
            return { error: `Failed to get podcast episodes: ${response.statusText}` };
        }

        const data = await response.json();
        
        // Get the most recent episodes (max 10)
        const episodes = data.episodes.slice(0, 10).map(episode => ({
            id: episode.id,
            title: cleanEpisodeTitle(episode.title), // Use comprehensive title cleaning
            description: episode.description,
            audio: episode.audio,
            audio_length_sec: episode.audio_length_sec,
            thumbnail: episode.thumbnail || data.thumbnail,
            pub_date_ms: episode.pub_date_ms
        }));

        const result = { episodes };
        
        // Cache the result
        apiCache.set('podcast_episodes', { id: podcastId }, result);
        
        return result;
    } catch (error) {
        return { error: 'Failed to get podcast episodes' };
    }
}

async function importPodcastEpisodes(podcast, episodes) {
    try {
        // Clear any previous import status
        await chrome.storage.local.remove(['podcastImportResult', 'podcastImportTimestamp']);
        
        // Set initial progress
        await chrome.storage.local.set({
            podcastImportProgress: {
                status: 'in_progress',
                current: 0,
                total: episodes.length,
                message: 'Starting import...'
            }
        });
        
        // Check if authenticated
        const isValid = await TokenManager.isTokenValid();
        if (!isValid) {
            return { error: 'Not authenticated. Please log in first.' };
        }
        
        // Track domains we've encountered for debugging
        const encounteredDomains = new Set();

        // Create a new playlist for the podcast
        const playlistName = `${podcast.title} - Podcast`;
        
        // Process episodes in parallel with controlled concurrency
        const CONCURRENT_LIMIT = 3; // Process up to 3 episodes at once
        const audioTracks = [];
        let processedCount = 0;
        let failedCount = 0;
        
        // Helper function to process a single episode
        const processEpisode = async (episode, index) => {
            // Check episode duration (Yoto limit is 60 minutes = 3600 seconds)
            if (episode.audio_length_sec > 3600) {
                console.warn(`Episode "${episode.title}" exceeds 60 minutes, it may be truncated by Yoto`);
            }
            
            try {
                let audioBlob = null;
                let audioUrl = episode.audio;
                
                
                // Listen Notes URLs often redirect to the actual podcast host
                if (!audioUrl.includes('listennotes.com')) {
                    console.warn(`Non-Listen Notes URL detected: ${audioUrl}. This may fail due to CORS.`);
                }
                
                // Download the audio
                try {
                    // Log the original URL
                    
                    // First, try a HEAD request to see where it redirects without downloading
                    try {
                        const headResponse = await fetch(audioUrl, {
                            method: 'HEAD',
                            redirect: 'follow'
                        });
                        
                        if (headResponse.url !== audioUrl) {
                            const finalUrl = new URL(headResponse.url);
                            
                            // Check if we have permission for this domain
                            const hasPermission = await chrome.permissions.contains({
                                origins: [`${finalUrl.protocol}//${finalUrl.hostname}/*`]
                            });
                            
                            if (!hasPermission) {
                                encounteredDomains.add(`${finalUrl.protocol}//${finalUrl.hostname}/*`);
                            }
                        }
                    } catch (headError) {
                        // HEAD request failed, continue with GET
                    }
                    
                    const audioResponse = await fetch(audioUrl, {
                        method: 'GET',
                        redirect: 'follow'
                    });
                    
                    // Log the final URL after redirects
                    
                    // Parse and log the domain for analysis
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
                    
                    // Log detailed error information
                    
                    // Try to extract the domain that caused the failure
                    // The error message in Chrome often contains the blocked URL
                    if (fetchError.message && fetchError.message.includes('Failed to fetch')) {
                        // If we already know the domain from HEAD request, it's in encounteredDomains
                        if (encounteredDomains.size === 0) {
                            // Try to extract from the original URL
                            try {
                                const url = new URL(audioUrl);
                                // For Listen Notes, we know it redirects, so we need the actual domain
                                // This will be captured by the HEAD request above
                            } catch (e) {
                                // Ignore URL parse errors
                            }
                        }
                    }
                    
                    failedCount++;
                    return null;
                }
                
                
                // Upload audio to Yoto
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
                // Update progress
                await chrome.storage.local.set({
                    podcastImportProgress: {
                        status: 'in_progress',
                        current: processedCount,
                        total: episodes.length,
                        message: `Processing episodes: ${processedCount} of ${episodes.length} complete${failedCount > 0 ? ` (${failedCount} failed)` : ''}`
                    }
                });
            }
        };
        
        // Process episodes in batches with concurrency control
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
        
        // Filter out failed episodes and sort by original order
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
        
        // Upload podcast cover image as playlist cover
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
        
        // Update progress for playlist creation
        await chrome.storage.local.set({
            podcastImportProgress: {
                status: 'in_progress',
                current: audioTracks.length,
                total: episodes.length,
                message: 'Creating MYO card playlist...'
            }
        });
        
        // Use the existing createPlaylistContent function which has the correct API structure
        const result = await createPlaylistContent(
            playlistName,
            audioTracks,
            [], // No custom icons for now
            coverImageUrl
        );
        
        if (result.error) {
            const errorResult = { error: `Failed to create MYO card: ${result.error}` };
            // Store the error result
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
            tracksImported: audioTracks.length
        };
        
        // Store the successful result
        await chrome.storage.local.set({
            podcastImportResult: successResult,
            podcastImportTimestamp: Date.now(),
            podcastImportProgress: {
                status: 'complete',
                message: `Successfully imported ${audioTracks.length} episodes`
            }
        });
        
        return successResult;
        
    } catch (error) {
        const errorResult = { error: error.message || 'Failed to import podcast episodes' };
        
        // Store the error result
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
                
                case 'SEARCH_ICONS_BY_CATEGORY':
                    const categoryIcons = await searchIconsByCategory(request.category);
                    sendResponse(categoryIcons);
                    break;
                
                case 'APPLY_CATEGORY_ICONS':
                    const applyResult = await applyCategoryIcons(request.cardId, request.icons);
                    sendResponse(applyResult);
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

                case 'SEARCH_PODCASTS':
                    const searchResults = await searchPodcasts(request.query);
                    sendResponse(searchResults);
                    break;

                case 'GET_PODCAST_EPISODES':
                    const episodesResult = await getPodcastEpisodes(request.podcastId);
                    sendResponse(episodesResult);
                    break;

                case 'GET_GENRES':
                    const genresResult = await getGenres();
                    sendResponse(genresResult);
                    break;

                case 'GET_BEST_PODCASTS':
                    const bestPodcastsResult = await getBestPodcasts(request.genreId, request.page);
                    sendResponse(bestPodcastsResult);
                    break;

                case 'OPEN_EXTENSION_PAGE':
                    // Open an extension page in a new tab
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
                    importPodcastEpisodes(request.podcast, request.episodes).then(result => {
                        // Store the result for later retrieval
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
                    // Cancel the podcast import
                    // Clear any stored import data
                    await chrome.storage.local.remove(['podcastImportResult', 'podcastImportTimestamp', 'podcastImportProgress']);
                    
                    // Set a cancelled status
                    await chrome.storage.local.set({
                        podcastImportResult: {cancelled: true, message: 'Import cancelled by user'},
                        podcastImportTimestamp: Date.now()
                    });
                    
                    sendResponse({success: true, message: 'Import cancelled'});
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


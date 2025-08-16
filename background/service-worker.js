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

        const authHeaders = {
            'Authorization': `Bearer ${tokens.access_token}`,
            'Content-Type': 'application/json',
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


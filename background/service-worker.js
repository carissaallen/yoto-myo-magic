// Service Worker for Yoto Card Magic Extension
// Handles browser-based OAuth and API calls

// Configuration
const CONFIG = {
  YOTO_API_BASE: 'https://api.yotoplay.com',
  YOTO_AUTH_BASE: 'https://login.yotoplay.com',
  CLIENT_ID: '91cvZsRLdqJpX2PDNJxjsm9yvco0xnQh',
  CLIENT_SECRET: '', // Not needed for public client
  EXTENSION_ID: 'mjljammaehdojchngjnooekefnogdhol',
  TOKEN_STORAGE_KEY: 'yoto_auth_tokens',
  ICON_CACHE_KEY: 'yoto_icon_cache',
  STATS_KEY: 'yoto_stats'
};

// Get redirect URI
function getRedirectUri() {
  return `chrome-extension://${CONFIG.EXTENSION_ID}/callback.html`;
}

// Token management
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
      console.error('Token refresh error:', error);
      // Clear invalid tokens
      await this.clearTokens();
      throw error;
    }
  }
}

// Check if token is expired
function isTokenExpired(token) {
  if (!token) return true;
  
  try {
    // Parse JWT token
    const payload = JSON.parse(atob(token.split('.')[1]));
    const exp = payload.exp;
    
    // Check if expired (exp is in seconds)
    return Date.now() >= exp * 1000;
  } catch (error) {
    console.error('Error checking token expiration:', error);
    return true;
  }
}

// Start OAuth flow
async function startOAuthFlow() {
  const authUrl = 'https://login.yotoplay.com/authorize';
  
  // Include openid, profile, and offline_access scopes
  const scopes = [
    'openid',         // OpenID Connect scope
    'profile',        // User profile information
    'offline_access'  // For refresh tokens
  ];
  
  const params = new URLSearchParams({
    audience: 'https://api.yotoplay.com',
    scope: scopes.join(' '),
    response_type: 'code',
    client_id: CONFIG.CLIENT_ID,
    redirect_uri: getRedirectUri()
  });
  
  console.log('Requesting scopes:', scopes.join(' '));

  const fullAuthUrl = `${authUrl}?${params.toString()}`;
  console.log('Starting OAuth flow:', fullAuthUrl);

  // Open auth URL in new tab
  chrome.tabs.create({ url: fullAuthUrl });
  
  return { success: true };
}

// Exchange authorization code for tokens
async function exchangeCodeForTokens(code) {
  try {
    console.log('=== EXCHANGING CODE FOR TOKENS ===');
    console.log('Code:', code.substring(0, 10) + '...');
    console.log('Redirect URI:', getRedirectUri());
    
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

    console.log('Token exchange response status:', response.status);

    if (!response.ok) {
      const error = await response.text();
      console.error('Token exchange failed:', error);
      throw new Error(`Token exchange failed: ${error}`);
    }

    const tokens = await response.json();
    console.log('Successfully got tokens');
    console.log('Access token:', tokens.access_token?.substring(0, 20) + '...');
    console.log('Refresh token:', tokens.refresh_token ? 'present' : 'missing');
    console.log('Token type:', tokens.token_type);
    console.log('Expires in:', tokens.expires_in);
    
    // Decode the access token to see what scopes were granted
    try {
      const payload = JSON.parse(atob(tokens.access_token.split('.')[1]));
      console.log('Token payload:', payload);
      console.log('Granted scopes:', payload.scope || 'No scope field in token');
      console.log('Token audience:', payload.aud);
      console.log('Token issuer:', payload.iss);
    } catch (e) {
      console.log('Could not decode token');
    }
    
    // Store tokens
    await TokenManager.setTokens(tokens);
    console.log('Tokens stored successfully');
    
    return { success: true, tokens };
  } catch (error) {
    console.error('Token exchange error:', error);
    return { success: false, error: error.message };
  }
}

// Make authenticated API request
async function makeAuthenticatedRequest(endpoint, options = {}) {
  let tokens = await TokenManager.getTokens();
  
  console.log('Making authenticated request to:', endpoint);
  console.log('Token exists:', !!tokens);
  
  // Check if we need to refresh
  if (tokens && isTokenExpired(tokens.access_token)) {
    console.log('Token expired, refreshing...');
    try {
      tokens = await TokenManager.refreshToken();
      console.log('Token refreshed successfully');
    } catch (error) {
      console.error('Token refresh failed:', error);
      // Need to re-authenticate
      return { error: 'Authentication required', needsAuth: true };
    }
  }
  
  if (!tokens || !tokens.access_token) {
    console.error('No access token available');
    return { error: 'Not authenticated', needsAuth: true };
  }
  
  try {
    const url = endpoint.startsWith('http') ? endpoint : `${CONFIG.YOTO_API_BASE}${endpoint}`;
    
    console.log('Full URL:', url);
    console.log('Using access token:', tokens.access_token.substring(0, 20) + '...');
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    console.log('Response status:', response.status);
    console.log('Response headers:', response.headers);
    
    if (response.status === 401) {
      console.log('Got 401, token might be expired');
      // Token expired, try refresh
      tokens = await TokenManager.refreshToken();
      // Retry request with new token
      return makeAuthenticatedRequest(endpoint, options);
    }
    
    if (response.status === 403) {
      console.error('Got 403 Forbidden - check if the client_id has access to this endpoint');
      const errorText = await response.text();
      console.error('403 Error response body:', errorText);
      console.error('403 Error endpoint:', url);
      console.error('403 Error method:', options.method || 'GET');
      throw new Error(`API request forbidden: ${response.status}`);
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API error response:', errorText);
      throw new Error(`API request failed: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('API request error:', error);
    throw error;
  }
}

// Get user's MYO cards
async function getMyCards() {
  try {
    // Try different endpoints
    console.log('Trying to fetch user cards...');
    
    // Try v1 endpoint
    try {
      const v1Response = await makeAuthenticatedRequest('/v1/cards');
      console.log('v1/cards response:', v1Response);
      if (v1Response.cards) return v1Response;
    } catch (e) {
      console.log('v1/cards failed:', e.message);
    }
    
    // Try card/mine endpoint
    try {
      const mineResponse = await makeAuthenticatedRequest('/card/mine');
      console.log('card/mine response:', mineResponse);
      return mineResponse;
    } catch (e) {
      console.log('card/mine failed:', e.message);
    }
    
    // Try cards endpoint
    try {
      const cardsResponse = await makeAuthenticatedRequest('/cards');
      console.log('cards response:', cardsResponse);
      return cardsResponse;
    } catch (e) {
      console.log('cards failed:', e.message);
    }
    
    return { cards: [] };
  } catch (error) {
    console.error('Error fetching cards:', error);
    return { cards: [] };
  }
}

// Get card content by ID
async function getCardContent(cardId) {
  try {
    console.log('=== FETCHING CARD CONTENT ===');
    console.log('Card ID from URL:', cardId);
    
    // First, test if auth is working
    console.log('Testing authentication...');
    try {
      const testResponse = await makeAuthenticatedRequest('/user');
      console.log('User endpoint response:', testResponse);
    } catch (e) {
      console.log('User endpoint failed, trying /me');
      try {
        const meResponse = await makeAuthenticatedRequest('/me');
        console.log('Me endpoint response:', meResponse);
      } catch (e2) {
        console.log('Me endpoint also failed');
      }
    }
    
    // Method 1: Try to get all user's cards first and find the right one
    console.log('Method 1: Fetching all user cards...');
    try {
      const myCardsResponse = await makeAuthenticatedRequest('/card/mine');
      console.log('My cards response:', myCardsResponse);
      
      if (myCardsResponse.cards && Array.isArray(myCardsResponse.cards)) {
        console.log(`Found ${myCardsResponse.cards.length} cards`);
        
        // Log all card IDs to see the format and find matching card
        console.log('=== ALL USER CARDS ===');
        myCardsResponse.cards.forEach((card, index) => {
          console.log(`Card ${index + 1}:`);
          console.log(`  - id: ${card.id || 'none'}`);
          console.log(`  - cardId: ${card.cardId || 'none'}`);
          console.log(`  - slug: ${card.slug || 'none'}`);
          console.log(`  - title: ${card.title || 'none'}`);
          console.log(`  - content:`, card.content ? 'present' : 'none');
          
          // Check if this card's title matches what we're looking for
          if (card.title && (card.title.includes('Jiggliest') || card.title.includes('Jellyfish'))) {
            console.log('  ^^^ THIS MIGHT BE OUR CARD ^^^');
          }
        });
        
        // Try different matching strategies
        const targetCard = myCardsResponse.cards.find(card => {
          // Check various ID formats
          const matches = 
            card.cardId === cardId || 
            card.id === cardId ||
            card.slug === cardId ||
            card.cardId === `C${cardId}` ||
            card.id === `C${cardId}` ||
            // Check if the URL ID is part of a longer ID
            (card.cardId && card.cardId.includes(cardId)) ||
            (card.id && card.id.includes(cardId)) ||
            (card.slug && card.slug.includes(cardId));
            
          if (matches) {
            console.log(`Found potential match: ${JSON.stringify(card)}`);
          }
          
          return matches;
        });
        
        // If no ID match, try to match by title (as a fallback)
        let cardToUse = targetCard;
        if (!cardToUse) {
          console.log('No ID match found, trying to match by title...');
          cardToUse = myCardsResponse.cards.find(card => 
            card.title && (card.title.includes('Jiggliest') || card.title.includes('Jellyfish'))
          );
          if (cardToUse) {
            console.log('Found card by title match:', cardToUse);
          }
        }
        
        if (cardToUse) {
          console.log('Using card:', cardToUse);
          
          // Check if the card already has content with chapters
          if (cardToUse.content && cardToUse.content.chapters) {
            console.log('Card already has content with chapters!');
            return { card: cardToUse };
          }
          
          // Otherwise try to fetch full content
          const contentId = cardToUse.contentId || cardToUse.id || cardToUse.cardId;
          console.log('Trying to fetch content with ID:', contentId);
          
          try {
            const contentResponse = await makeAuthenticatedRequest(`/content/${contentId}`);
            console.log('Content response:', contentResponse);
            return contentResponse;
          } catch (contentError) {
            console.log('Content endpoint failed, returning card data directly');
            return { card: cardToUse };
          }
        } else {
          console.log('No matching card found at all');
        }
      } else {
        console.log('No cards array in response or empty');
      }
    } catch (cardsError) {
      console.error('Failed to fetch user cards:', cardsError);
    }
    
    // Method 3: Try direct content endpoint with the URL ID
    console.log('Method 3: Trying direct content endpoint...');
    try {
      const contentResponse = await makeAuthenticatedRequest(`/content/${cardId}`);
      console.log('Direct content response:', contentResponse);
      return contentResponse;
    } catch (contentError) {
      console.log('Direct content failed:', contentError.message);
    }
    
    // Method 4: Try card endpoint with the URL ID
    console.log('Method 4: Trying card endpoint...');
    try {
      const cardResponse = await makeAuthenticatedRequest(`/card/${cardId}`);
      console.log('Card endpoint response:', cardResponse);
      return { card: cardResponse };
    } catch (cardError) {
      console.log('Card endpoint failed:', cardError.message);
    }
    
    console.log('=== ALL METHODS FAILED ===');
    return { error: 'Could not fetch card content' };
    
  } catch (error) {
    console.error('Unexpected error in getCardContent:', error);
    return { error: error.message };
  }
}

// Search for icons
async function searchIcons(query) {
  try {
    console.log('Searching for icons with query:', query);
    const lowerQuery = query.toLowerCase();
    let allIcons = [];
    
    // Step 1: Check Yoto's public icons
    try {
      console.log('Step 1: Checking Yoto public icons...');
      const yotoResponse = await makeAuthenticatedRequest('/media/displayIcons/user/yoto');
      
      if (yotoResponse && !yotoResponse.error) {
        const yotoIcons = Array.isArray(yotoResponse) ? yotoResponse : (yotoResponse.displayIcons || []);
        console.log(`Found ${yotoIcons.length} Yoto public icons`);
        
        // Log first few icons to see their structure
        if (yotoIcons.length > 0) {
          console.log('Sample icon structure:', yotoIcons[0]);
        }
        
        // Add source info to each icon
        yotoIcons.forEach(icon => {
          icon.source = 'yoto-public';
        });
        
        allIcons = allIcons.concat(yotoIcons);
      }
    } catch (error) {
      console.error('Error fetching Yoto public icons:', error);
    }
    
    // Step 2: If no Yoto matches found, check yotoicons.com
    // Filter Yoto icons first to see if we have matches
    const yotoMatches = allIcons.filter(icon => {
      const allText = [
        icon.title,
        icon.mediaId,
        icon.description,
        ...(icon.publicTags || [])
      ].filter(Boolean).join(' ').toLowerCase();
      
      return allText.includes(lowerQuery);
    });
    
    if (yotoMatches.length === 0) {
      console.log('Step 2: No Yoto matches, checking yotoicons.com...');
      try {
        // Try to fetch from yotoicons.com
        // Note: This will likely face CORS issues, but we can try
        const yotoiconsUrl = `https://www.yotoicons.com/icons?tag=${encodeURIComponent(query)}`;
        console.log('Fetching from:', yotoiconsUrl);
        
        // We'll need to scrape or use a proxy for this
        // For now, we'll create placeholder icons that link to yotoicons.com
        console.log('Note: Direct fetch from yotoicons.com will likely fail due to CORS');
        
        // Create a placeholder suggestion to check yotoicons.com
        const yotoiconsPlaceholder = {
          title: `Search "${query}" on yotoicons.com`,
          description: 'Click to search on yotoicons.com',
          url: yotoiconsUrl,
          source: 'yotoicons-link',
          mediaId: 'yotoicons-search',
          isPlaceholder: true
        };
        
        allIcons.push(yotoiconsPlaceholder);
        
      } catch (error) {
        console.error('Error with yotoicons.com:', error);
      }
    }
    
    console.log(`Total icons from all sources: ${allIcons.length}`);
    
    // Filter icons that match the query
    const filteredIcons = allIcons.filter(icon => {
      // Special case: placeholder links always match
      if (icon.isPlaceholder) {
        return true;
      }
      
      // Check all text fields
      const allText = [
        icon.title,
        icon.mediaId,
        icon.description,
        icon.displayIconId,
        ...(icon.publicTags || [])
      ].filter(Boolean).join(' ').toLowerCase();
      
      return allText.includes(lowerQuery);
    });
    
    console.log(`Found ${filteredIcons.length} icons matching "${query}"`);
    
    // Sort by relevance and source (prefer Yoto public, then user custom)
    filteredIcons.sort((a, b) => {
      // Exact matches first
      const aExact = a.title?.toLowerCase() === lowerQuery;
      const bExact = b.title?.toLowerCase() === lowerQuery;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      
      // Then by source (Yoto public first)
      if (a.source === 'yoto-public' && b.source !== 'yoto-public') return -1;
      if (a.source !== 'yoto-public' && b.source === 'yoto-public') return 1;
      
      return 0;
    });
    
    // Log first few matches for debugging
    if (filteredIcons.length > 0) {
      console.log('First matches:', filteredIcons.slice(0, 3).map(i => ({
        title: i.title || i.mediaId,
        source: i.source,
        tags: i.publicTags,
        url: i.url
      })));
    }
    
    return { icons: filteredIcons };
  } catch (error) {
    console.error('Error searching icons:', error);
    return { icons: [] };
  }
}

// Match icons to tracks
async function matchIcons(tracks) {
  const matches = [];
  console.log('Starting icon matching for tracks:', tracks);
  
  for (const track of tracks) {
    console.log(`Matching icons for track: "${track.title}"`);
    
    // Try searching for the full title first
    let bestMatch = null;
    let highestConfidence = 0;
    
    try {
      // Search with full title
      const fullResults = await searchIcons(track.title);
      if (fullResults.icons && fullResults.icons.length > 0) {
        bestMatch = fullResults.icons[0];
        highestConfidence = 90; // High confidence for full title match
        console.log(`Found ${fullResults.icons.length} icons for full title "${track.title}"`);
      }
    } catch (error) {
      console.error(`Error searching for full title "${track.title}":`, error);
    }
    
    // If no match with full title, try individual keywords
    if (!bestMatch) {
      const keywords = track.title.toLowerCase().split(' ').filter(word => word.length >= 3);
      console.log('No full title match, trying keywords:', keywords);
      
      for (const keyword of keywords) {
        try {
          const results = await searchIcons(keyword);
          if (results.icons && results.icons.length > 0) {
            // Check if any icon specifically matches this keyword well
            const exactMatch = results.icons.find(icon => 
              icon.title?.toLowerCase().includes(keyword) ||
              icon.publicTags?.some(tag => tag.toLowerCase() === keyword)
            );
            
            bestMatch = exactMatch || results.icons[0];
            highestConfidence = exactMatch ? 80 : 60;
            console.log(`Found match for keyword "${keyword}":`, bestMatch?.title);
            break;
          }
        } catch (error) {
          console.error(`Error searching for keyword "${keyword}":`, error);
        }
      }
    }
    
    const matchResult = {
      trackId: track.id,
      trackTitle: track.title,
      suggestedIcon: bestMatch?.url || bestMatch?.mediaUrl || null,
      iconId: bestMatch?.displayIconId || bestMatch?.mediaId || null,
      iconTitle: bestMatch?.title || null,
      confidence: highestConfidence
    };
    
    console.log('Match result:', matchResult);
    matches.push(matchResult);
  }
  
  console.log('All matches complete:', matches);
  return matches;
}

// Update statistics
async function updateStats(stats) {
  try {
    const current = await chrome.storage.local.get(CONFIG.STATS_KEY);
    const updated = {
      ...current[CONFIG.STATS_KEY],
      ...stats,
      lastUpdated: new Date().toISOString()
    };
    
    await chrome.storage.local.set({ [CONFIG.STATS_KEY]: updated });
  } catch (error) {
    console.error('Error updating stats:', error);
  }
}

// Update card icons via Yoto API
async function updateCardIcons(cardId, iconMatches) {
  try {
    console.log('=== UPDATING CARD ICONS ===');
    console.log('Card ID:', cardId);
    console.log('Icon matches:', iconMatches);
    
    // First, we need to get ALL user's cards to find the right one
    const myCardsResponse = await makeAuthenticatedRequest('/card/mine');
    console.log('Fetched user cards to find target card');
    
    if (!myCardsResponse.cards || myCardsResponse.error) {
      console.error('Failed to get user cards');
      return { success: false, error: 'Failed to get user cards' };
    }
    
    // Find the actual card with correct ID format
    let targetCard = myCardsResponse.cards.find(card => 
      card.cardId === cardId || 
      card.id === cardId ||
      card.slug === cardId ||
      (card.cardId && card.cardId.includes(cardId)) ||
      (card.id && card.id.includes(cardId))
    );
    
    if (!targetCard) {
      console.error('Could not find card in user\'s cards');
      return { success: false, error: 'Card not found' };
    }
    
    const actualCardId = targetCard.cardId || targetCard.id;
    console.log('Found actual card ID:', actualCardId);
    console.log('Card has content?', !!targetCard.content);
    
    // Clone the card's content for updating
    const updatedCard = JSON.parse(JSON.stringify(targetCard));
    
    // Update icons in the card's content
    let iconsUpdated = 0;
    if (updatedCard.content && updatedCard.content.chapters) {
      updatedCard.content.chapters.forEach(chapter => {
        if (chapter.tracks) {
          chapter.tracks.forEach(track => {
            const iconMatch = iconMatches.find(match => 
              match.trackTitle === track.title
            );
            
            if (iconMatch) {
              console.log(`Matching icon for "${track.title}"`);
              
              // Try different ways to set the icon
              if (iconMatch.suggestedIcon) {
                // Set the icon URL directly
                track.icon = iconMatch.suggestedIcon;
                track.iconUrl = iconMatch.suggestedIcon;
                track.displayIcon = iconMatch.suggestedIcon;
                
                // Also try setting icon ID if available
                if (iconMatch.iconId) {
                  track.iconId = iconMatch.iconId;
                  track.displayIconId = iconMatch.iconId;
                }
                
                iconsUpdated++;
                console.log(`Set icon for track "${track.title}":`, iconMatch.suggestedIcon);
              }
            }
          });
        }
      });
    }
    
    if (iconsUpdated === 0) {
      console.log('No icons were matched to tracks');
      return { success: false, error: 'No icons could be matched to tracks' };
    }
    
    console.log(`Updated ${iconsUpdated} track icons in payload`);
    
    // Try different update methods
    
    // Method 1: Update just the content
    try {
      console.log('Trying to update card content...');
      const updateResponse = await makeAuthenticatedRequest(`/card/${actualCardId}`, {
        method: 'PUT',
        body: JSON.stringify({
          content: updatedCard.content
        })
      });
      
      if (!updateResponse.error) {
        console.log('Successfully updated card!');
        await updateStats({
          iconsMatched: iconsUpdated,
          cardsUpdated: 1
        });
        return { success: true, message: `Updated ${iconsUpdated} icons` };
      }
    } catch (e) {
      console.log('Content update failed:', e.message);
    }
    
    // Method 2: Update the entire card
    try {
      console.log('Trying to update entire card...');
      const updateResponse = await makeAuthenticatedRequest(`/card/${actualCardId}`, {
        method: 'PUT',
        body: JSON.stringify(updatedCard)
      });
      
      if (!updateResponse.error) {
        console.log('Successfully updated entire card!');
        await updateStats({
          iconsMatched: iconsUpdated,
          cardsUpdated: 1
        });
        return { success: true, message: `Updated ${iconsUpdated} icons` };
      }
    } catch (e) {
      console.log('Full card update failed:', e.message);
    }
    
    // Method 3: Try PATCH instead of PUT
    try {
      console.log('Trying PATCH method...');
      const patchResponse = await makeAuthenticatedRequest(`/card/${actualCardId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          content: updatedCard.content
        })
      });
      
      if (!patchResponse.error) {
        console.log('Successfully patched card!');
        await updateStats({
          iconsMatched: iconsUpdated,
          cardsUpdated: 1
        });
        return { success: true, message: `Updated ${iconsUpdated} icons` };
      }
    } catch (e) {
      console.log('PATCH failed:', e.message);
    }
    
    // If all methods failed
    console.error('All update methods failed');
    return { 
      success: false, 
      error: 'Unable to update card. The API may require special permissions.' 
    };
    
  } catch (error) {
    console.error('Error updating card icons:', error);
    return { success: false, error: error.message };
  }
}

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request.action);
  
  // Handle async responses
  (async () => {
    try {
      switch (request.action) {
        case 'CHECK_AUTH':
          const isValid = await TokenManager.isTokenValid();
          sendResponse({ authenticated: isValid });
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
          sendResponse({ matches });
          break;
          
        case 'SEARCH_ICONS':
          const icons = await searchIcons(request.query);
          sendResponse(icons);
          break;
          
        case 'UPDATE_STATS':
          await updateStats(request.stats);
          sendResponse({ success: true });
          break;
          
        case 'UPDATE_CARD_ICONS':
          const updateResult = await updateCardIcons(request.cardId, request.iconMatches);
          sendResponse(updateResult);
          break;
          
        case 'LOGOUT':
          await TokenManager.clearTokens();
          sendResponse({ success: true });
          break;
          
        default:
          sendResponse({ error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Message handling error:', error);
      sendResponse({ error: error.message });
    }
  })();
  
  // Return true to indicate async response
  return true;
});

// Check auth status on install
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Yoto Card Magic extension installed');
  
  // Check if we have valid tokens
  const isValid = await TokenManager.isTokenValid();
  if (!isValid) {
    console.log('No valid authentication found');
  }
});

// Listen for tab updates to inject content script if needed
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('my.yotoplay.com')) {
    // Check if user is authenticated
    TokenManager.isTokenValid().then(isValid => {
      if (isValid) {
        // Send message to content script that auth is ready
        chrome.tabs.sendMessage(tabId, { 
          action: 'AUTH_STATUS', 
          authenticated: true 
        }).catch(() => {
          // Content script might not be ready yet
        });
      }
    });
  }
});

console.log('Yoto Card Magic service worker initialized');
// Service Worker for Yoto Card Magic Extension
// Handles authentication, API calls, and messaging

// Configuration
const CONFIG = {
  YOTO_API_BASE: 'https://api.yotoplay.com',
  YOTO_AUTH_BASE: 'https://login.yotoplay.com',
  CLIENT_ID: 'YOUR_CLIENT_ID_HERE', // Will be replaced with actual client ID
  TOKEN_STORAGE_KEY: 'yoto_auth_tokens',
  ICON_CACHE_KEY: 'yoto_icon_cache'
};

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
    if (!tokens) return false;
    
    // Check if token is expired (assuming 1 hour expiry)
    const expiryTime = tokens.timestamp + (60 * 60 * 1000);
    return Date.now() < expiryTime;
  }

  static async refreshToken() {
    const tokens = await this.getTokens();
    if (!tokens || !tokens.refresh_token) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await fetch(`${CONFIG.YOTO_AUTH_BASE}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
          client_id: CONFIG.CLIENT_ID
        })
      });

      if (!response.ok) {
        throw new Error('Token refresh failed');
      }

      const newTokens = await response.json();
      await this.setTokens(newTokens);
      return newTokens;
    } catch (error) {
      console.error('Token refresh error:', error);
      throw error;
    }
  }
}

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle async responses
  (async () => {
    try {
      switch (request.action) {
        case 'CHECK_AUTH':
          const isValid = await TokenManager.isTokenValid();
          sendResponse({ authenticated: isValid });
          break;

        case 'GET_TOKENS':
          const tokens = await TokenManager.getTokens();
          sendResponse({ tokens });
          break;

        case 'START_AUTH':
          // Initiate OAuth device flow
          startOAuthFlow().then(sendResponse).catch(error => {
            sendResponse({ error: error.message });
          });
          break;

        case 'LOGOUT':
          await TokenManager.clearTokens();
          sendResponse({ success: true });
          break;

        case 'API_REQUEST':
          // Handle API requests with authentication
          handleAPIRequest(request.endpoint, request.options)
            .then(sendResponse)
            .catch(error => sendResponse({ error: error.message }));
          break;

        case 'GET_CACHED_ICONS':
          const cache = await chrome.storage.local.get(CONFIG.ICON_CACHE_KEY);
          sendResponse({ icons: cache[CONFIG.ICON_CACHE_KEY] || [] });
          break;

        case 'MATCH_ICONS':
          // Process icon matching request
          matchIcons(request.tracks)
            .then(sendResponse)
            .catch(error => sendResponse({ error: error.message }));
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

// OAuth Device Flow
async function startOAuthFlow() {
  try {
    // Step 1: Request device code
    const deviceResponse = await fetch(`${CONFIG.YOTO_AUTH_BASE}/oauth/device/code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: CONFIG.CLIENT_ID
      })
    });

    if (!deviceResponse.ok) {
      throw new Error('Failed to get device code');
    }

    const deviceData = await deviceResponse.json();
    
    // Return device code info for user display
    return {
      device_code: deviceData.device_code,
      user_code: deviceData.user_code,
      verification_uri: deviceData.verification_uri,
      interval: deviceData.interval || 5
    };
  } catch (error) {
    console.error('OAuth flow error:', error);
    throw error;
  }
}

// Poll for token after user authorization
async function pollForToken(deviceCode, interval = 5) {
  const pollInterval = interval * 1000; // Convert to milliseconds
  
  return new Promise((resolve, reject) => {
    const intervalId = setInterval(async () => {
      try {
        const response = await fetch(`${CONFIG.YOTO_AUTH_BASE}/oauth/token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            device_code: deviceCode,
            client_id: CONFIG.CLIENT_ID
          })
        });

        const data = await response.json();

        if (response.ok) {
          clearInterval(intervalId);
          await TokenManager.setTokens(data);
          resolve(data);
        } else if (data.error === 'authorization_pending') {
          // Continue polling
        } else if (data.error === 'slow_down') {
          // Increase polling interval
          clearInterval(intervalId);
          pollForToken(deviceCode, interval + 5).then(resolve).catch(reject);
        } else {
          clearInterval(intervalId);
          reject(new Error(data.error || 'Token polling failed'));
        }
      } catch (error) {
        clearInterval(intervalId);
        reject(error);
      }
    }, pollInterval);

    // Timeout after 5 minutes
    setTimeout(() => {
      clearInterval(intervalId);
      reject(new Error('Authorization timeout'));
    }, 5 * 60 * 1000);
  });
}

// API request handler with authentication
async function handleAPIRequest(endpoint, options = {}) {
  // Ensure we have valid tokens
  if (!await TokenManager.isTokenValid()) {
    try {
      await TokenManager.refreshToken();
    } catch (error) {
      throw new Error('Authentication required');
    }
  }

  const tokens = await TokenManager.getTokens();
  
  const requestOptions = {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${tokens.access_token}`,
      'Content-Type': 'application/json'
    }
  };

  const response = await fetch(`${CONFIG.YOTO_API_BASE}${endpoint}`, requestOptions);
  
  if (response.status === 401) {
    // Try refreshing token once
    await TokenManager.refreshToken();
    const newTokens = await TokenManager.getTokens();
    requestOptions.headers['Authorization'] = `Bearer ${newTokens.access_token}`;
    
    const retryResponse = await fetch(`${CONFIG.YOTO_API_BASE}${endpoint}`, requestOptions);
    if (!retryResponse.ok) {
      throw new Error(`API request failed: ${retryResponse.status}`);
    }
    return await retryResponse.json();
  }

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return await response.json();
}

// Icon matching placeholder
async function matchIcons(tracks) {
  // This will be implemented with the actual matching algorithm
  // For now, return a basic structure
  return {
    matches: tracks.map(track => ({
      trackId: track.id,
      trackTitle: track.title,
      suggestedIcon: null,
      confidence: 0,
      alternativeIcons: []
    }))
  };
}

// Extension installation/update
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Yoto Card Magic extension installed');
    // Initialize storage
    chrome.storage.local.set({
      [CONFIG.ICON_CACHE_KEY]: [],
      settings: {
        autoMatch: true,
        confidenceThreshold: 70,
        defaultIcon: null
      }
    });
  } else if (details.reason === 'update') {
    console.log('Yoto Card Magic extension updated');
  }
});

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  // This is handled by the popup
});

console.log('Yoto Card Magic service worker initialized');
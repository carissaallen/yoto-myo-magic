// Configuration file for Yoto MYO Magic Extension
// This file contains all configuration values including API keys and IDs

// Only declare if not already declared (for service worker importScripts)
if (typeof ExtensionConfig === 'undefined') {
    var ExtensionConfig = {
    // Google Analytics 4
    GA_MEASUREMENT_ID: 'G-2V0YLJ70QW',
    
    // Yoto OAuth Configuration
    // Note: OAuth client IDs are designed to be public - they identify the app
    // The security comes from the redirect URI validation on Yoto's side
    YOTO_CLIENT_ID: '91cvZsRLdqJpX2PDNJxjsm9yvco0xnQh',
    
    // Public Google Chrome Extension ID
    EXTENSION_ID: 'iehnjhgdgfepcjlbfkpngibijmffcmpp',
    
    // API Endpoints
    YOTO_API_BASE: 'https://api.yotoplay.com',
    YOTO_AUTH_BASE: 'https://login.yotoplay.com',
    
    // Storage Keys
    TOKEN_STORAGE_KEY: 'yoto_auth_tokens',
    ICON_CACHE_KEY: 'yoto_icon_cache',
    STATS_KEY: 'yoto_stats',
    
    PROXY_SERVER_URL: 'https://yoto-proxy-77274378579.us-central1.run.app'
    };
}

// Export for use in extension
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExtensionConfig;
}
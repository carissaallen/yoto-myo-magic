// Configuration file for Yoto MYO Magic Extension
// This file contains all configuration values including API keys and IDs

// Only declare if not already declared (for service worker importScripts)
if (typeof ExtensionConfig === 'undefined') {
    var ExtensionConfig = {
    // Google Analytics 4
    GA_MEASUREMENT_ID: 'G-LRJ60JW11S',
    GA_API_SECRET: 'E9Ejkde3TKWnu2-yW-IPZg',
    
    // Yoto OAuth Configuration
    // Note: OAuth client IDs are designed to be public - they identify the app
    // The security comes from the redirect URI validation on Yoto's side
    YOTO_CLIENT_ID: '91cvZsRLdqJpX2PDNJxjsm9yvco0xnQh',
    
    // Extension Configuration
    EXTENSION_ID: 'mjljammaehdojchngjnooekefnogdhol',
    
    // API Endpoints
    YOTO_API_BASE: 'https://api.yotoplay.com',
    YOTO_AUTH_BASE: 'https://login.yotoplay.com',
    
    // Storage Keys
    TOKEN_STORAGE_KEY: 'yoto_auth_tokens',
    ICON_CACHE_KEY: 'yoto_icon_cache',
    STATS_KEY: 'yoto_stats'
    };
}

// Export for use in extension
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExtensionConfig;
}
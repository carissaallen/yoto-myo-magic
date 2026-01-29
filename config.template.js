// Configuration template for Yoto MYO Magic Extension
// Copy this file to config.js and fill in your values

// Only declare if not already declared (for service worker importScripts)
if (typeof ExtensionConfig === 'undefined') {
    var ExtensionConfig = {
    // Google Analytics 4
    GA_MEASUREMENT_ID: 'G-XXXXXXXXXX', // Your GA4 Measurement ID
    GA_API_SECRET: '', // Optional: Your GA4 API Secret
    
    // Yoto OAuth Configuration
    // Note: This client ID is safe to be public - it's meant to identify the app
    YOTO_CLIENT_ID: '91cvZsRLdqJpX2PDNJxjsm9yvco0xnQh',
    
    // Extension Configuration  
    EXTENSION_ID: 'YOUR_EXTENSION_ID', // Your Chrome extension ID
    
    // API Endpoints (don't change these)
    YOTO_API_BASE: 'https://api.yotoplay.com',
    YOTO_AUTH_BASE: 'https://login.yotoplay.com',

    // Proxy server for API calls
    PROXY_SERVER_URL: 'https://api.yotomyomagic.com',
    
    // Storage Keys (don't change these)
    TOKEN_STORAGE_KEY: 'yoto_auth_tokens',
    ICON_CACHE_KEY: 'yoto_icon_cache',
    STATS_KEY: 'yoto_stats'
    };
}

// Export for use in extension
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExtensionConfig;
}
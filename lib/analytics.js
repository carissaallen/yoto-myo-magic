// Google Analytics 4 Integration for Chrome Extension
// Config should be imported before this file in the service worker
const GA_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

class Analytics {
    constructor() {
        this.clientId = null; // Will be set asynchronously
        this.sessionId = this.createSessionId();
        this.enabled = true; // Can be controlled via settings
        this.initializeClientId(); // Initialize client ID asynchronously
    }
    
    async initializeClientId() {
        this.clientId = await this.getOrCreateClientId();
    }

    // Get or create a persistent client ID
    async getOrCreateClientId() {
        // Use chrome.storage instead of localStorage (not available in service workers)
        try {
            const result = await chrome.storage.local.get('ga_client_id');
            if (result.ga_client_id) {
                return result.ga_client_id;
            }
            
            const clientId = this.generateUUID();
            await chrome.storage.local.set({ ga_client_id: clientId });
            return clientId;
        } catch (error) {
            // Fallback to a temporary ID if storage fails
            return this.generateUUID();
        }
    }

    // Create a session ID
    createSessionId() {
        return Date.now().toString();
    }

    // Generate UUID v4
    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // Send event to GA4
    async sendEvent(eventName, parameters = {}) {
        if (!this.enabled || !ExtensionConfig.GA_MEASUREMENT_ID || ExtensionConfig.GA_MEASUREMENT_ID === 'G-XXXXXXXXXX') {
            return; // Analytics not configured or disabled
        }
        
        // Ensure client ID is initialized
        if (!this.clientId) {
            await this.initializeClientId();
        }
        
        if (!this.clientId) {
            return; // Unable to get client ID
        }

        try {
            const payload = {
                client_id: this.clientId,
                events: [{
                    name: eventName,
                    params: {
                        ...parameters,
                        session_id: this.sessionId,
                        engagement_time_msec: 100,
                        extension_version: chrome.runtime.getManifest().version
                    }
                }]
            };

            const url = `${GA_ENDPOINT}?measurement_id=${ExtensionConfig.GA_MEASUREMENT_ID}` + 
                       (ExtensionConfig.GA_API_SECRET ? `&api_secret=${ExtensionConfig.GA_API_SECRET}` : '');

            await fetch(url, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
        } catch (error) {
            // Silently fail - don't impact user experience
        }
    }

    // Track custom events
    track(eventName, category, label, value) {
        this.sendEvent(eventName, {
            event_category: category,
            event_label: label,
            value: value
        });
    }

    trackError(error, context = {}) {
        let errorMessage = '';
        let errorStack = '';
        
        if (typeof error === 'string') {
            errorMessage = error;
        } else if (error instanceof Error) {
            errorMessage = error.message;
            errorStack = error.stack ? error.stack.substring(0, 500) : ''; // Limit stack trace size
        } else if (error && error.message) {
            errorMessage = error.message;
        } else {
            errorMessage = JSON.stringify(error).substring(0, 200);
        }
        
        // Send as exception event (GA4 standard)
        this.sendEvent('exception', {
            description: errorMessage,
            fatal: false,
            // Additional context
            error_context: context.action || 'unknown',
            error_code: context.code || '',
            error_url: context.url || '',
            error_stack: errorStack,
            // User context
            authenticated: context.authenticated || false,
            extension_version: chrome.runtime.getManifest().version
        });
        
        this.sendEvent('extension_error', {
            error_message: errorMessage,
            error_action: context.action || 'unknown',
            error_code: context.code || '',
            error_component: context.component || 'unknown',
            error_severity: context.severity || 'error'
        });
    }
    
    trackCriticalError(error, context = {}) {
        context.severity = 'critical';
        this.trackError(error, context);
    }

    // Common events for the extension
    trackImport(source, fileCount, success) {
        this.sendEvent('import_playlist', {
            import_source: source, // 'zip' or 'folder'
            file_count: fileCount,
            success: success
        });
    }

    trackIconMatch(matchCount, automated) {
        this.sendEvent('icon_match', {
            match_count: matchCount,
            automated: automated
        });
    }

    trackAuth(success) {
        this.sendEvent('authentication', {
            success: success
        });
    }

    // Load enabled state from storage
    async loadEnabledState() {
        if (chrome.storage && chrome.storage.local) {
            const result = await chrome.storage.local.get('analyticsEnabled');
            this.enabled = result.analyticsEnabled !== false; // Default to true
        }
    }
}

const analytics = new Analytics();

// Export for use in extension
if (typeof module !== 'undefined' && module.exports) {
    module.exports = analytics;
} else if (typeof window !== 'undefined') {
    window.YotoAnalytics = analytics;
}
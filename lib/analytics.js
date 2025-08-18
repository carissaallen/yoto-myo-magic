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

    // Track page views
    pageView(pagePath, pageTitle) {
        this.sendEvent('page_view', {
            page_path: pagePath,
            page_title: pageTitle
        });
    }

    // Track custom events
    track(eventName, category, label, value) {
        this.sendEvent(eventName, {
            event_category: category,
            event_label: label,
            value: value
        });
    }

    // Track errors (non-fatal)
    trackError(description, fatal = false) {
        this.sendEvent('exception', {
            description: description,
            fatal: fatal
        });
    }

    // Track timing events
    trackTiming(category, variable, time, label) {
        this.sendEvent('timing_complete', {
            event_category: category,
            name: variable,
            value: time,
            event_label: label
        });
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

    trackFeatureUse(feature) {
        this.sendEvent('feature_use', {
            feature_name: feature
        });
    }

    // Set user properties
    setUserProperty(name, value) {
        this.sendEvent('user_property_set', {
            [name]: value
        });
    }

    // Toggle analytics on/off
    setEnabled(enabled) {
        this.enabled = enabled;
        if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ analyticsEnabled: enabled });
        }
    }

    // Load enabled state from storage
    async loadEnabledState() {
        if (chrome.storage && chrome.storage.local) {
            const result = await chrome.storage.local.get('analyticsEnabled');
            this.enabled = result.analyticsEnabled !== false; // Default to true
        }
    }
}

// Create singleton instance
const analytics = new Analytics();

// Export for use in extension
if (typeof module !== 'undefined' && module.exports) {
    module.exports = analytics;
} else if (typeof window !== 'undefined') {
    window.YotoAnalytics = analytics;
}
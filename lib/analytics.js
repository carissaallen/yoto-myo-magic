// Google Analytics 4 Integration for Chrome Extension
// Config should be imported before this file in the service worker
const GA_PROXY_ENDPOINT = ExtensionConfig?.PROXY_SERVER_URL ?
    `${ExtensionConfig.PROXY_SERVER_URL}/api/analytics/event` : null;

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

    async sendEvent(eventName, parameters = {}) {
        if (!this.enabled || !ExtensionConfig.GA_MEASUREMENT_ID || ExtensionConfig.GA_MEASUREMENT_ID === 'G-XXXXXXXXXX') {
            return; // Analytics not configured or disabled
        }
        
        if (!GA_PROXY_ENDPOINT) {
            return; // Proxy not configured
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

            await fetch(GA_PROXY_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
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

    trackUploadPerformance(fileType, duration, fileSize, success, errorMessage = null) {
        const durationSeconds = duration / 1000;
        const fileSizeMB = fileSize / (1024 * 1024);
        const throughputMBps = fileSizeMB / durationSeconds;

        this.sendEvent('file_upload_performance', {
            file_type: fileType,
            duration_ms: Math.round(duration),
            duration_seconds: Math.round(durationSeconds * 100) / 100,
            file_size_bytes: fileSize,
            file_size_mb: Math.round(fileSizeMB * 100) / 100,
            throughput_mbps: Math.round(throughputMBps * 100) / 100,
            success: success,
            error_message: errorMessage || '',
            timestamp: new Date().toISOString()
        });
    }

    trackBatchUploadMetrics(batchType, queueLength, processedCount, failureCount, totalDuration) {
        const averageDuration = processedCount > 0 ? totalDuration / processedCount : 0;
        const errorRate = processedCount > 0 ? (failureCount / processedCount) * 100 : 0;

        this.sendEvent('batch_upload_metrics', {
            batch_type: batchType,
            queue_length: queueLength,
            processed_count: processedCount,
            failure_count: failureCount,
            success_count: processedCount - failureCount,
            total_duration_ms: Math.round(totalDuration),
            average_duration_ms: Math.round(averageDuration),
            error_rate_percent: Math.round(errorRate * 100) / 100,
            timestamp: new Date().toISOString()
        });
    }

    trackQueueStatus(queueType, currentLength, maxLength, processingRate) {
        this.sendEvent('upload_queue_status', {
            queue_type: queueType,
            current_length: currentLength,
            max_length: maxLength,
            utilization_percent: Math.round((currentLength / maxLength) * 100),
            processing_rate_per_second: Math.round(processingRate * 100) / 100,
            timestamp: new Date().toISOString()
        });
    }

    trackUploadLatency(operation, latencyMs, stage) {
        this.sendEvent('upload_latency', {
            operation: operation,
            latency_ms: Math.round(latencyMs),
            latency_seconds: Math.round(latencyMs / 1000 * 100) / 100,
            stage: stage,
            timestamp: new Date().toISOString()
        });
    }

    trackRateLimitEvent(endpoint, retryCount, delayMs) {
        this.sendEvent('rate_limit_encountered', {
            endpoint: endpoint,
            retry_count: retryCount,
            delay_ms: delayMs,
            timestamp: new Date().toISOString()
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
} else {
    // For service worker context (no window object)
    self.YotoAnalytics = analytics;
}
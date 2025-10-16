// Monitor what happens when saving card settings
console.log('💾 Monitoring card save operations...');

// Track the checkbox state
let alwaysPlayFromStart = false;
let cardId = null;

// Try to find the current card ID
function findCardId() {
    // Look in the URL
    const urlMatch = window.location.pathname.match(/card[s]?\/([^\/]+)/);
    if (urlMatch) {
        cardId = urlMatch[1];
        console.log('📇 Found card ID in URL:', cardId);
        return;
    }

    // Look for card ID in data attributes
    const cardElement = document.querySelector('[data-card-id]');
    if (cardElement) {
        cardId = cardElement.dataset.cardId;
        console.log('📇 Found card ID in element:', cardId);
    }
}

// Find and monitor the checkbox
function monitorCheckbox() {
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        const parent = cb.closest('label') || cb.parentElement;
        const text = parent?.textContent || '';

        if (text.toLowerCase().includes('always') && text.toLowerCase().includes('play') && text.toLowerCase().includes('start')) {
            const previousState = alwaysPlayFromStart;
            alwaysPlayFromStart = cb.checked;

            if (previousState !== alwaysPlayFromStart) {
                console.log('📌 "Always play from start" is now:', alwaysPlayFromStart);
            }

            // Remove existing listeners to avoid duplicates
            cb.removeEventListener('change', handleCheckboxChange);
            cb.addEventListener('change', handleCheckboxChange);
        }
    });
}

function handleCheckboxChange(e) {
    alwaysPlayFromStart = e.target.checked;
    console.log('🔄 "Always play from start" changed to:', alwaysPlayFromStart);
    console.log('⏳ Waiting for save operation...');
}

// Intercept ALL fetch requests to see what's being sent
const originalFetch = window.fetch;
window.fetch = function(...args) {
    const [url, options] = args;

    // Log any POST/PUT/PATCH requests that might be saving the card
    if (options?.method && ['POST', 'PUT', 'PATCH'].includes(options.method)) {
        console.log(`📤 ${options.method} request to:`, url);

        if (options.body) {
            try {
                const body = JSON.parse(options.body);
                console.log('📦 Request body:', body);

                // Look for the setting in different possible locations
                if (body.content?.config) {
                    console.log('🎯 Config in request:', body.content.config);
                }
                if (body.metadata) {
                    console.log('🎯 Metadata in request:', body.metadata);
                }
                if (body.settings) {
                    console.log('🎯 Settings in request:', body.settings);
                }

                // Check for any property that might relate to playback
                const checkForPlaybackSettings = (obj, path = '') => {
                    for (const [key, value] of Object.entries(obj)) {
                        const currentPath = path ? `${path}.${key}` : key;

                        if (typeof key === 'string' &&
                            (key.toLowerCase().includes('play') ||
                             key.toLowerCase().includes('resume') ||
                             key.toLowerCase().includes('start') ||
                             key.toLowerCase().includes('reset'))) {
                            console.log(`🔍 Found potential playback setting at ${currentPath}:`, value);
                        }

                        if (value && typeof value === 'object' && !Array.isArray(value)) {
                            checkForPlaybackSettings(value, currentPath);
                        }
                    }
                };

                checkForPlaybackSettings(body);

            } catch(e) {
                console.log('Body (non-JSON):', options.body);
            }
        }

        // Also log the response
        return originalFetch.apply(this, args).then(response => {
            const cloned = response.clone();
            cloned.json().then(data => {
                console.log('✅ Response for', options.method, 'to', url);
                console.log('Response data:', data);

                // Check if the response contains updated card data
                if (data.content?.config) {
                    console.log('🎯 Config in response:', data.content.config);
                }
            }).catch(() => {});
            return response;
        });
    }

    return originalFetch.apply(this, args);
};

// Also intercept XMLHttpRequest
const originalXHRSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function(body) {
    const method = this._method || 'GET';
    const url = this._url || '';

    if (['POST', 'PUT', 'PATCH'].includes(method)) {
        console.log(`📤 XHR ${method} to:`, url);
        if (body) {
            try {
                const parsed = JSON.parse(body);
                console.log('📦 XHR body:', parsed);
            } catch(e) {
                console.log('XHR body (non-JSON):', body);
            }
        }
    }

    return originalXHRSend.apply(this, arguments);
};

const originalXHROpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url) {
    this._method = method;
    this._url = url;
    return originalXHROpen.apply(this, arguments);
};

// Monitor save button clicks
document.addEventListener('click', function(e) {
    const target = e.target;
    const text = target.textContent || target.innerText || '';

    if (text.toLowerCase().includes('save') ||
        text.toLowerCase().includes('update') ||
        text.toLowerCase().includes('done') ||
        target.closest('button[type="submit"]')) {

        console.log('💾 Possible save button clicked:', text);
        console.log('Current "Always play from start" state:', alwaysPlayFromStart);
    }
}, true);

// Initial setup
findCardId();
monitorCheckbox();

// Check every 2 seconds
setInterval(() => {
    monitorCheckbox();
    if (!cardId) findCardId();
}, 2000);

console.log('✅ Save monitor ready!');
console.log('1️⃣ Toggle "Always play from start"');
console.log('2️⃣ Click Save/Done/Update button');
console.log('3️⃣ Watch for the request that saves the setting');
// Simple script to monitor the "Always play from start" checkbox
console.log('🎯 Monitoring for "Always play from start" option...');

// Function to find and monitor the checkbox
function findPlayFromStartCheckbox() {
    // Look for all checkboxes
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');

    checkboxes.forEach(cb => {
        const parent = cb.closest('label') || cb.parentElement;
        const text = parent?.textContent || '';

        // Check if this is the "Always play from start" checkbox
        if (text.toLowerCase().includes('always') && text.toLowerCase().includes('play') && text.toLowerCase().includes('start')) {
            console.log('✅ Found "Always play from start" checkbox!');
            console.log('Current state:', cb.checked);
            console.log('Element details:', {
                id: cb.id,
                name: cb.name,
                value: cb.value,
                className: cb.className,
                dataset: {...cb.dataset}
            });

            // Monitor changes
            cb.addEventListener('change', function(e) {
                console.log('🔄 "Always play from start" changed to:', e.target.checked);

                // Check what happens after the change
                setTimeout(() => {
                    // Check if any network request was made
                    console.log('Checking for changes after toggle...');

                    // Look for any data attributes that might have changed
                    const cardElement = cb.closest('[data-card-id]') || cb.closest('[id*="card"]');
                    if (cardElement) {
                        console.log('Card element data:', {...cardElement.dataset});
                    }

                    // Check localStorage
                    console.log('localStorage after change:', {...localStorage});
                }, 500);
            });
        }
    });
}

// Also intercept any POST requests to /content endpoint
const originalFetch = window.fetch;
window.fetch = function(...args) {
    const [url, options] = args;

    if (url.includes('/content') && options?.method === 'POST') {
        console.log('📤 POST to /content detected!');
        if (options.body) {
            try {
                const body = JSON.parse(options.body);
                console.log('Request body:', body);

                // Look specifically for playback-related config
                if (body.content?.config) {
                    console.log('🎯 Config found in request:', body.content.config);
                }
            } catch(e) {
                console.log('Body (non-JSON):', options.body);
            }
        }
    }

    return originalFetch.apply(this, args);
};

// Check every second for the checkbox (in case it's dynamically added)
const checkInterval = setInterval(() => {
    findPlayFromStartCheckbox();
}, 1000);

// Stop checking after 30 seconds
setTimeout(() => {
    clearInterval(checkInterval);
    console.log('Stopped checking for checkbox');
}, 30000);

console.log('✅ Script ready! Now open a card to edit and look for the "Always play from start" option');
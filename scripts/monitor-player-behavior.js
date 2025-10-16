// Monitor what happens when playing a card with "Always play from start" enabled
console.log('🎵 Monitoring player behavior...');

// Track the checkbox state
let alwaysPlayFromStart = false;

// Find and monitor the checkbox
function monitorCheckbox() {
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        const parent = cb.closest('label') || cb.parentElement;
        const text = parent?.textContent || '';

        if (text.toLowerCase().includes('always') && text.toLowerCase().includes('play') && text.toLowerCase().includes('start')) {
            alwaysPlayFromStart = cb.checked;
            console.log('📌 "Always play from start" is currently:', alwaysPlayFromStart);

            cb.addEventListener('change', function(e) {
                alwaysPlayFromStart = e.target.checked;
                console.log('🔄 "Always play from start" changed to:', alwaysPlayFromStart);
            });
        }
    });
}

// Monitor for play button clicks
document.addEventListener('click', function(e) {
    // Check if this is a play button
    if (e.target.closest('button[aria-label*="Play"]') ||
        e.target.closest('button[title*="Play"]') ||
        e.target.closest('[class*="play"]') ||
        e.target.closest('svg[data-testid*="Play"]')) {

        console.log('▶️ Play button clicked!');
        console.log('Current "Always play from start" setting:', alwaysPlayFromStart);

        // Monitor for iframe creation in the next few seconds
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.tagName === 'IFRAME') {
                        console.log('🎧 Player iframe created!');
                        console.log('Iframe src:', node.src);

                        // Parse the URL for parameters
                        try {
                            const url = new URL(node.src);
                            const params = Object.fromEntries(url.searchParams);
                            console.log('🔗 Player URL parameters:', params);

                            // Check if there's a resume or start parameter
                            if (params.resume !== undefined || params.start !== undefined || params.position !== undefined) {
                                console.log('⚠️ Found playback position parameter!');
                            }
                        } catch(e) {}

                        observer.disconnect();
                    }
                });
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Stop observing after 5 seconds
        setTimeout(() => observer.disconnect(), 5000);
    }
}, true);

// Intercept fetch calls to see if any player-related data is requested
const originalFetch = window.fetch;
window.fetch = function(...args) {
    const [url, options] = args;

    // Log player-related requests
    if (url.includes('player') || url.includes('play') || url.includes('resume') || url.includes('position')) {
        console.log('🌐 Player-related request:', url, options);
    }

    // Check if we're fetching card content before playing
    if (url.includes('/content/') && !url.includes('/content/mine')) {
        console.log('📋 Fetching card content:', url);

        return originalFetch.apply(this, args).then(response => {
            const cloned = response.clone();
            cloned.json().then(data => {
                console.log('📦 Card content response:', {
                    config: data.content?.config,
                    playbackType: data.content?.playbackType,
                    metadata: data.metadata
                });
            }).catch(() => {});
            return response;
        });
    }

    return originalFetch.apply(this, args);
};

// Check sessionStorage for player state
function checkPlayerState() {
    const keys = Object.keys(sessionStorage);
    const playerKeys = keys.filter(k => k.includes('player') || k.includes('resume') || k.includes('position'));
    if (playerKeys.length > 0) {
        console.log('📊 Player state in sessionStorage:', playerKeys.map(k => ({[k]: sessionStorage[k]})));
    }
}

// Initial setup
monitorCheckbox();
checkPlayerState();

// Check for checkbox every 2 seconds (in case page changes)
setInterval(monitorCheckbox, 2000);

console.log('✅ Player monitor ready! Toggle "Always play from start" then click play to see what happens.');
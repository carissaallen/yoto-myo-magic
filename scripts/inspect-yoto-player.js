// Yoto Player Inspector Script
// Run this in the browser console on the Yoto page to inspect player behavior

(function() {
    console.log('🔍 Yoto Player Inspector Starting...');

    // 1. Check all localStorage and sessionStorage
    console.group('📦 Storage Analysis');
    console.log('localStorage:', {...localStorage});
    console.log('sessionStorage:', {...sessionStorage});
    console.groupEnd();

    // 2. Find all checkboxes and their states
    console.group('☑️ Checkbox Analysis');
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        const label = cb.parentElement?.textContent || cb.getAttribute('aria-label') || 'Unknown';
        console.log({
            label: label.trim(),
            checked: cb.checked,
            id: cb.id,
            name: cb.name,
            value: cb.value,
            dataset: {...cb.dataset}
        });
    });
    console.groupEnd();

    // 3. Find iframes (player containers)
    console.group('🎵 Player/Iframe Analysis');
    document.querySelectorAll('iframe').forEach(iframe => {
        console.log({
            src: iframe.src,
            id: iframe.id,
            className: iframe.className,
            dataset: {...iframe.dataset}
        });

        try {
            const url = new URL(iframe.src);
            console.log('URL params:', Object.fromEntries(url.searchParams));
        } catch(e) {}
    });
    console.groupEnd();

    // 4. Intercept XHR/Fetch requests
    console.group('🌐 Network Interception Setup');

    // Intercept fetch
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
        const [url, options] = args;
        console.log('FETCH:', url, options);

        return originalFetch.apply(this, args).then(response => {
            // Clone response to read it
            const cloned = response.clone();
            if (url.includes('content') || url.includes('play')) {
                cloned.json().then(data => {
                    console.log('FETCH Response:', url, data);
                }).catch(() => {});
            }
            return response;
        });
    };

    // Intercept XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        console.log('XHR:', method, url);
        this.addEventListener('load', function() {
            if (url.includes('content') || url.includes('play')) {
                try {
                    const data = JSON.parse(this.responseText);
                    console.log('XHR Response:', url, data);
                } catch(e) {}
            }
        });
        return originalOpen.apply(this, arguments);
    };

    console.log('Network interception active - make changes to see requests');
    console.groupEnd();

    // 5. Look for React/Vue/Angular properties
    console.group('🎯 Framework Data');

    // Try to find React props
    const findReactProps = (element) => {
        const keys = Object.keys(element);
        const reactKey = keys.find(key => key.startsWith('__react'));
        return reactKey ? element[reactKey] : null;
    };

    // Check checkboxes for React props
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        const label = cb.parentElement?.textContent || '';
        if (label.toLowerCase().includes('play') && label.toLowerCase().includes('start')) {
            const reactProps = findReactProps(cb);
            if (reactProps) {
                console.log('React props for "play from start":', reactProps);
            }

            // Check parent elements for data
            let parent = cb.parentElement;
            for (let i = 0; i < 5 && parent; i++) {
                const parentReactProps = findReactProps(parent);
                if (parentReactProps) {
                    console.log(`React props ${i} levels up:`, parentReactProps);
                }
                parent = parent.parentElement;
            }
        }
    });
    console.groupEnd();

    // 6. Monitor changes to checkboxes
    console.group('👁️ Change Monitoring');
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', function(e) {
            const label = this.parentElement?.textContent || '';
            console.log('Checkbox changed:', {
                label: label.trim(),
                checked: this.checked,
                element: this
            });

            // Wait a bit then check what changed in storage/network
            setTimeout(() => {
                console.log('Post-change localStorage:', {...localStorage});
                console.log('Post-change sessionStorage:', {...sessionStorage});
            }, 100);
        });
    });
    console.log('Monitoring checkbox changes - toggle options to see logs');
    console.groupEnd();

    console.log('✅ Yoto Player Inspector Ready!');
    console.log('Toggle the "Always play from start" option to see what happens');
})();
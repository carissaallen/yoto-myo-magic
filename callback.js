// Handle OAuth callback

// Get the authorization code from URL
const urlParams = new URLSearchParams(window.location.search);
const code = urlParams.get('code');
const error = urlParams.get('error');

const messageEl = document.getElementById('message');
const statusEl = document.querySelector('.status');
const spinnerEl = document.querySelector('.spinner');

if (error) {
    // Handle error
    statusEl.textContent = 'Authentication failed';
    spinnerEl.style.display = 'none';
    messageEl.className = 'error';
    messageEl.textContent = `Error: ${error}`;
    
    // Try to redirect back to original page
    setTimeout(() => {
        redirectToOriginalPage();
    }, 3000);
} else if (code) {
    // Exchange code for tokens
    statusEl.textContent = 'Exchanging authorization code...';
    
    // Send code to background script for token exchange
    chrome.runtime.sendMessage({
        action: 'EXCHANGE_CODE',
        code: code
    }, (response) => {
        if (response.success) {
            statusEl.textContent = 'Authentication successful!';
            spinnerEl.style.display = 'none';
            messageEl.className = 'success';
            messageEl.textContent = '✓ You can now use Yoto MYO Magic';
            
            // Redirect back to original page after success
            setTimeout(() => {
                redirectToOriginalPage(true);
            }, 1300);
        } else {
            statusEl.textContent = 'Token exchange failed';
            spinnerEl.style.display = 'none';
            messageEl.className = 'error';
            messageEl.textContent = response.error || 'Failed to complete authentication';
            
            setTimeout(() => {
                redirectToOriginalPage();
            }, 3000);
        }
    });
} else {
    // No code or error
    statusEl.textContent = 'Invalid response';
    spinnerEl.style.display = 'none';
    messageEl.className = 'error';
    messageEl.textContent = 'No authorization code received';
    
    setTimeout(() => {
        redirectToOriginalPage();
    }, 3000);
}

// Function to redirect back to the original page
async function redirectToOriginalPage(success = false) {
    try {
        const result = await chrome.storage.local.get('auth_return_tab');
        const returnTab = result.auth_return_tab;
        
        let targetUrl;
        if (returnTab && returnTab.url) {
            targetUrl = returnTab.url;
        } else {
            // Fallback to My Playlists page
            targetUrl = 'https://my.yotoplay.com/my-cards/playlists';
        }
        
        // Add success parameter if authentication was successful
        if (success) {
            const url = new URL(targetUrl);
            url.searchParams.set('auth_success', 'true');
            targetUrl = url.toString();
        }
        
        // Navigate back to the original URL
        window.location.href = targetUrl;
        
        // Clean up the stored return tab info
        chrome.storage.local.remove('auth_return_tab');
    } catch (error) {
        // Fallback redirect
        let fallbackUrl = 'https://my.yotoplay.com/my-cards/playlists';
        if (success) {
            fallbackUrl += '?auth_success=true';
        }
        window.location.href = fallbackUrl;
    }
}
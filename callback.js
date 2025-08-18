// Handle OAuth callback
console.log('OAuth callback handler loaded');

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
    
    // Close window after delay
    setTimeout(() => {
        window.close();
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
            
            // Close window and redirect to Yoto
            setTimeout(() => {
                chrome.tabs.create({ url: 'https://my.yotoplay.com/my-cards' });
                window.close();
            }, 1500);
        } else {
            statusEl.textContent = 'Token exchange failed';
            spinnerEl.style.display = 'none';
            messageEl.className = 'error';
            messageEl.textContent = response.error || 'Failed to complete authentication';
            
            setTimeout(() => {
                window.close();
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
        window.close();
    }, 3000);
}
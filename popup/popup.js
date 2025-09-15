document.addEventListener('DOMContentLoaded', async function() {
  const goToYotoButton = document.getElementById('go-to-yoto');
  const manageExtensionButton = document.getElementById('manage-extension');
  const signOutButton = document.getElementById('sign-out');
  const authButton = document.getElementById('auth-button');
  const authStatus = document.getElementById('auth-status');
  const authText = authStatus.querySelector('.auth-text');
  
  // Check authentication status
  async function checkAuthStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });

      if (response.authenticated) {
        authStatus.className = 'auth-status authenticated';
        // Show user email if available, otherwise just show authenticated
        if (response.userEmail) {
          authText.innerHTML = `Authenticated with Yoto<br><span style="font-size: 11px; opacity: 0.8;">${response.userEmail}</span>`;
        } else {
          authText.textContent = 'Authenticated with Yoto';
        }
        authButton.style.display = 'none';
        signOutButton.style.display = 'block';
      } else {
        authStatus.className = 'auth-status not-authenticated';
        authText.textContent = 'Not authenticated';
        authButton.style.display = 'block';
        signOutButton.style.display = 'none';
      }
    } catch (error) {
      authStatus.className = 'auth-status not-authenticated';
      authText.textContent = 'Authentication status unknown';
      authButton.style.display = 'block';
      signOutButton.style.display = 'none';
    }
  }
  
  // Initial auth check
  await checkAuthStatus();
  
  // Auth button handler
  authButton.addEventListener('click', async function() {
    authButton.disabled = true;
    authButton.textContent = 'Authenticating...';
    
    try {
      // Request interactive authentication
      const result = await chrome.runtime.sendMessage({ action: 'START_AUTH_INTERACTIVE' });
      
      if (result.success) {
        await checkAuthStatus();
        
        // Notify content scripts about auth status change
        chrome.runtime.sendMessage({ 
          action: 'BROADCAST_AUTH_STATUS', 
          authenticated: true 
        });
      } else if (result.cancelled) {
        authButton.textContent = 'Sign in with Yoto';
        authButton.disabled = false;
      } else {
        authButton.textContent = 'Authentication failed - Try again';
        authButton.disabled = false;
        
        setTimeout(() => {
          authButton.textContent = 'Sign in with Yoto';
        }, 3000);
      }
    } catch (error) {
      authButton.textContent = 'Error - Try again';
      authButton.disabled = false;
      
      setTimeout(() => {
        authButton.textContent = 'Sign in with Yoto';
      }, 3000);
    }
  });
  
  goToYotoButton.addEventListener('click', function() {
    chrome.tabs.create({
      url: 'https://my.yotoplay.com/my-cards/playlists'
    });
    window.close();
  });
  
  manageExtensionButton.addEventListener('click', function() {
    chrome.tabs.create({
      url: 'chrome://extensions/?id=' + chrome.runtime.id
    });
    window.close();
  });

  if (signOutButton) {
    signOutButton.addEventListener('click', async function() {
      signOutButton.disabled = true;
      signOutButton.textContent = 'Signing out...';

      try {
        const result = await chrome.runtime.sendMessage({ action: 'CLEAR_AUTH' });

        if (result.success) {
          authStatus.className = 'auth-status not-authenticated';
          authText.textContent = 'Not authenticated';
          authButton.style.display = 'block';
          signOutButton.style.display = 'none';
          signOutButton.textContent = 'Sign Out';
          signOutButton.disabled = false;
        } else {
          signOutButton.textContent = 'Error - Try again';
          signOutButton.disabled = false;

          setTimeout(() => {
            signOutButton.textContent = 'Sign Out';
          }, 2000);
        }
      } catch (error) {
        signOutButton.textContent = 'Error - Try again';
        signOutButton.disabled = false;

        setTimeout(() => {
          signOutButton.textContent = 'Sign Out';
        }, 2000);
      }
    });
  }
  
  // Listen for auth status updates
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'AUTH_STATUS_CHANGED') {
      checkAuthStatus();
    }
  });
});
let state = {
  isMyoPage: false,
  authenticated: false,
  tracks: [],
  observer: null,
  injectedUI: false,
  authCacheTime: 0,
  iconMatchCache: new Map()
};

const AUTH_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function init() {
  
  // Check auth status with caching
  const now = Date.now();
  if (!state.authenticated || now - state.authCacheTime > AUTH_CACHE_DURATION) {
    chrome.runtime.sendMessage({ action: 'CHECK_AUTH' }).then(async response => {
      if (response.authenticated) {
        state.authenticated = true;
        state.authCacheTime = now;
        removeAuthBanner();
      } else {
        try {
          const authResult = await chrome.runtime.sendMessage({ action: 'START_AUTH' });
          if (authResult && authResult.success && authResult.authenticated && authResult.silent) {
            state.authenticated = true;
            state.authCacheTime = now;
            removeAuthBanner();
          } else {
            state.authenticated = false;
            if (state.isMyoPage) {
              showAuthBanner();
            }
          }
        } catch (error) {
          state.authenticated = false;
          console.error('[Auth] Silent auth error:', error);
          chrome.runtime.sendMessage({
            action: 'TRACK_ERROR',
            error: error.message,
            context: {
              action: 'silent_auth',
              component: 'content',
              authenticated: false
            }
          });
          if (state.isMyoPage) {
            showAuthBanner();
          }
        }
      }
    });
  }
  
  setupObserver();
  setupNavigationListener();
  
  setTimeout(() => {
    checkForMyoPage();
  }, 1000);
  
  
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'AUTH_STATUS') {
      state.authenticated = request.authenticated;
      state.authCacheTime = Date.now();
      updateButtonIcon(request.authenticated);
      
      if (request.authenticated) {
        removeAuthBanner();
        if (state.isMyoPage) {
          showNotification('Authentication successful! You can now use icon matching.', 'success');
        }
      }
    } else if (request.action === 'PERMISSION_GRANTED') {
      // Handle when permission is granted from the popup
      showNotification('Permission granted! You can now retry importing the podcast.', 'success');
      
      // Check if we're in the podcast import modal and update the UI
      const statusText = document.querySelector('#import-status');
      if (statusText) {
        statusText.innerHTML = `
          <div style="color: #28a745;">
            <p>Permission granted! You can now close this modal and try importing again.</p>
          </div>
        `;
      }
    }
  });
}

function checkForMyoPage() {
  const url = window.location.href;
  const path = window.location.pathname;
  
  if (!url.includes('my.yotoplay.com')) {
    return;
  }
  
  
  if (path.includes('/my-cards/playlists') || path === '/my-cards' || path === '/my-cards/') {
    state.isMyoPage = true;
    state.pageType = 'my-playlists';
    // Always attempt to inject buttons when detecting playlists page
    waitForMyoElements();
  } else if (path.includes('/card/') && path.includes('/edit')) {
    state.isMyoPage = true;
    state.pageType = 'edit-card';
  } else {
    state.isMyoPage = false;
    state.pageType = null;
  }
}

function showAuthBanner() {
  if (document.querySelector('#yoto-auth-banner')) {
    return;
  }
  
  if (sessionStorage.getItem('yoto-auth-banner-dismissed') === 'true') {
    return;
  }
  
  const banner = document.createElement('div');
  banner.id = 'yoto-auth-banner';
  banner.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: white;
    padding: 10px 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 15px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    overflow: hidden;
    height: 60px;
  `;
  
  banner.innerHTML = `
    <img src="${chrome.runtime.getURL('assets/images/myo-magic-banner.png')}" style="
      height: 40px;
      width: auto;
      max-width: 100%;
      object-fit: contain;
    " alt="MYO Magic - Please sign in to enable features">
    <button id="auth-banner-btn" style="
      background-color: #ffffff;
      color: #3b82f6;
      border: 1px solid #3b82f6;
      padding: 8px 20px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      position: relative;
      white-space: nowrap;
    ">
      Authenticate
    </button>
    <button id="auth-banner-close" style="
      background: transparent;
      border: none;
      color: #1558d1;
      cursor: pointer;
      padding: 4px;
      margin-left: 10px;
      opacity: 0.7;
      transition: opacity 0.2s;
    " onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'">
      <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
        <path d="M6 18L18 6M6 6l12 12" stroke="#1558d1" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </button>
  `;
  
  document.body.appendChild(banner);
  
  document.body.style.marginTop = '60px';
  
  // Add hover effects for the authenticate button
  const authBtn = document.getElementById('auth-banner-btn');
  authBtn.addEventListener('mouseenter', () => {
    authBtn.style.backgroundColor = '#ffffff';
    authBtn.style.color = '#F85D41';
    authBtn.style.borderColor = '#F85D41';
    authBtn.style.transform = 'translateY(-1px)';
    authBtn.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.15)';
  });
  
  authBtn.addEventListener('mouseleave', () => {
    authBtn.style.backgroundColor = '#ffffff';
    authBtn.style.color = '#3b82f6';
    authBtn.style.borderColor = '#3b82f6';
    authBtn.style.transform = 'translateY(0)';
    authBtn.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
  });
  
  document.getElementById('auth-banner-btn').addEventListener('click', async () => {
    const btn = document.getElementById('auth-banner-btn');
    btn.textContent = 'Authenticating...';
    btn.disabled = true;
    
    try {
      const authResult = await chrome.runtime.sendMessage({ action: 'START_AUTH_INTERACTIVE' });
      
      if (authResult && authResult.success) {
        state.authenticated = true;
        state.authCacheTime = Date.now();
        removeAuthBanner();
        showNotification('✓ Authentication successful! Icon matching enabled.', 'success');
        updateButtonIcon(true);
      } else if (authResult && authResult.cancelled) {
        btn.textContent = 'Authenticate Now';
        btn.disabled = false;
      } else {
        btn.textContent = 'Try Again';
        btn.disabled = false;
        showNotification('Authentication failed. Please try again.', 'error');
      }
    } catch (error) {
      btn.textContent = 'Try Again';
      btn.disabled = false;
      showNotification('Authentication error. Please try again.', 'error');
    }
  });
  
  document.getElementById('auth-banner-close').addEventListener('click', () => {
    removeAuthBanner();
    sessionStorage.setItem('yoto-auth-banner-dismissed', 'true');
  });
}

function removeAuthBanner() {
  const banner = document.querySelector('#yoto-auth-banner');
  if (banner) {
    banner.remove();
    document.body.style.marginTop = '';
  }
}

function waitForMyoElements() {
  const path = window.location.pathname;
  
  if (path.includes('/my-cards/playlists') || path === '/my-cards' || path === '/my-cards/') {
    if (!document.querySelector('#yoto-import-btn') && !document.querySelector('#yoto-import-container')) {
      checkAndInjectImportButton();
    }
    
    const attempts = [500, 1500, 3000];
    
    attempts.forEach((delay) => {
      setTimeout(() => {
        if (!document.querySelector('#yoto-import-btn') && !document.querySelector('#yoto-import-container')) {
          checkAndInjectImportButton();
        }
      }, delay);
    });
    return;
  }
}

function checkAndInjectImportButton() {
  const path = window.location.pathname;
  if (path.includes('/edit') || path.includes('/card/')) {
    return false;
  }
  
  if (document.querySelector('#yoto-import-btn') || document.querySelector('#yoto-import-container')) {
    return true;
  }
  
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
  
  const playlistsHeading = headings.find(el => {
    const text = el.textContent?.trim()?.toLowerCase() || '';
    // Only match main playlists page headings, not edit page headings
    return (text.includes('my playlist') || text.includes('my cards') || text.includes('cards')) && 
           !text.includes('edit');
  });
  
  if (playlistsHeading) {
    // Look for the container that holds both the heading and the content below it
    const mainContainer = playlistsHeading.parentNode;
    
    if (mainContainer) {
      // Find the descriptive text element after the heading
      let targetElement = playlistsHeading;
      let nextElement = playlistsHeading.nextElementSibling;
      
      // Look for the descriptive text in the next few siblings
      while (nextElement && targetElement === playlistsHeading) {
        const text = nextElement.textContent?.trim() || '';
        if (text.includes('Create playlists here')) {
          targetElement = nextElement;
          break;
        }
        nextElement = nextElement.nextElementSibling;
        
        // Don't search more than 3 siblings to avoid going too far
        if (!nextElement || nextElement === playlistsHeading.parentNode?.lastElementChild) {
          break;
        }
      }
      
      // Create the button container
      const buttonContainer = document.createElement('div');
      buttonContainer.style.cssText = 'margin: 20px 0 24px 0; padding: 0; display: flex; gap: 12px; align-items: center;';
      buttonContainer.id = 'yoto-import-container';
      
      const importButton = createImportButton();
      const bulkImportButton = createBulkImportButton();
      const podcastButton = createPodcastButton();
      
      buttonContainer.appendChild(importButton);
      buttonContainer.appendChild(bulkImportButton);
      if (podcastButton) {
        buttonContainer.appendChild(podcastButton);
      }
      
      // Insert after the target element (either heading or descriptive text)
      if (targetElement.nextSibling) {
        targetElement.parentNode.insertBefore(buttonContainer, targetElement.nextSibling);
      } else {
        targetElement.parentNode.appendChild(buttonContainer);
      }
      return true;
    }
  }
  
  return false;
}


function createImportButton() {
  const button = document.createElement('button');
  button.id = 'yoto-import-btn';
  
  const importIcon = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <g id="Import">
        <g>
          <path d="M5.552,20.968a2.577,2.577,0,0,1-2.5-2.73c-.012-2.153,0-4.306,0-6.459a.5.5,0,0,1,1,0c0,2.2-.032,4.4,0,6.6.016,1.107.848,1.589,1.838,1.589H18.353A1.546,1.546,0,0,0,19.825,19a3.023,3.023,0,0,0,.1-1.061V11.779h0a.5.5,0,0,1,1,0c0,2.224.085,4.465,0,6.687a2.567,2.567,0,0,1-2.67,2.5Z" stroke="currentColor" stroke-width="2" fill="none"/>
          <path d="M11.63,15.818a.459.459,0,0,0,.312.138c.014,0,.027.005.042.006s.027,0,.041-.006a.457.457,0,0,0,.312-.138l3.669-3.669a.5.5,0,0,0-.707-.707l-2.815,2.815V3.515a.5.5,0,0,0-1,0V14.257L8.668,11.442a.5.5,0,0,0-.707.707Z" stroke="currentColor" stroke-width="2" fill="none"/>
        </g>
      </g>
    </svg>
  `;
  
  button.style.cssText = `
    background-color: #ffffff;
    color: #3b82f6;
    border: 1px solid #3b82f6;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: all 0.2s ease;
    white-space: nowrap;
    line-height: 1.5;
    height: 40px;
  `;
  
  button.innerHTML = `
    ${importIcon}
    <span>Import Playlist</span>
  `;
  
  button.onmouseenter = () => {
    button.style.backgroundColor = '#ffffff';
    button.style.color = '#F85D41';
    button.style.borderColor = '#F85D41';
    button.style.transform = 'translateY(-1px)';
  };
  
  button.onmouseleave = () => {
    button.style.backgroundColor = '#ffffff';
    button.style.color = '#3b82f6';
    button.style.borderColor = '#3b82f6';
    button.style.transform = 'translateY(0)';
  };
  
  button.addEventListener('click', handleImportClick);
  
  return button;
}

function createBulkImportButton() {
  const button = document.createElement('button');
  button.id = 'yoto-bulk-import-btn';
  
  // Bulk import icon SVG - using multiple stacked folders icon
  const bulkIcon = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <g id="BulkImport">
        <g>
          <path d="M22 11v6a2 2 0 01-2 2H10a2 2 0 01-2-2v-6a2 2 0 012-2h3l2 2h5a2 2 0 012 2z" stroke="currentColor" stroke-width="2" fill="none"/>
          <path d="M2 6v9a2 2 0 002 2h3" stroke="currentColor" stroke-width="2" fill="none" opacity="0.6"/>
          <path d="M5 3v6" stroke="currentColor" stroke-width="2" fill="none" opacity="0.4"/>
        </g>
      </g>
    </svg>
  `;
  
  button.style.cssText = `
    background-color: #ffffff;
    color: #3b82f6;
    border: 1px solid #3b82f6;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: all 0.2s ease;
    white-space: nowrap;
    line-height: 1.5;
    height: 40px;
  `;
  
  button.innerHTML = `
    ${bulkIcon}
    <span>Bulk Import</span>
  `;
  
  button.onmouseenter = () => {
    button.style.backgroundColor = '#ffffff';
    button.style.color = '#10b981';
    button.style.borderColor = '#10b981';
    button.style.transform = 'translateY(-1px)';
  };
  
  button.onmouseleave = () => {
    button.style.backgroundColor = '#ffffff';
    button.style.color = '#3b82f6';
    button.style.borderColor = '#3b82f6';
    button.style.transform = 'translateY(0)';
  };
  
  button.addEventListener('click', handleBulkImportClick);
  
  return button;
}

// Show podcast permission request modal
function showPodcastPermissionModal() {
  const modal = document.createElement('div');
  modal.id = 'podcast-permission-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    z-index: 99999;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 20vh;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    animation: fadeIn 0.3s ease;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 30px;
    max-width: 500px;
    width: 90%;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    animation: slideDown 0.3s ease;
  `;
  
  content.innerHTML = `
    <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" style="vertical-align: middle; margin-right: 8px;">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
        <line x1="12" y1="19" x2="12" y2="23"></line>
        <line x1="8" y1="23" x2="16" y2="23"></line>
      </svg>
      Import Podcast - Permission Required
    </h2>
    
    <div style="margin-bottom: 24px; color: #4b5563; line-height: 1.6;">
      <p style="margin: 0 0 16px 0;">To import podcast episodes, we need permission to download audio files from various podcast hosting services.</p>
      
      <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0 0 8px 0; font-weight: 600; color: #374151;">Why is this needed?</p>
        <ul style="margin: 8px 0 0 0; padding-left: 20px; color: #6b7280;">
          <li style="margin: 4px 0;">Podcasts are hosted on many different domains</li>
          <li style="margin: 4px 0;">We need to download and convert audio files for Yoto</li>
          <li style="margin: 4px 0;">Chrome requires explicit permission for this access</li>
        </ul>
      </div>
      
      <p style="margin: 16px 0 0 0; font-size: 14px; color: #6b7280;">
        <strong>Note:</strong> This permission is only used when you import podcasts. Your browsing data remains private.
      </p>
    </div>
    
    <div style="display: flex; gap: 12px; justify-content: flex-end;">
      <button id="permission-cancel" style="
        background: #f3f4f6;
        color: #374151;
        border: none;
        padding: 10px 20px;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s;
      " onmouseover="this.style.background='#e5e7eb'" onmouseout="this.style.background='#f3f4f6'">
        Cancel
      </button>
      <button id="permission-grant" style="
        background: #3b82f6;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s;
        display: flex;
        align-items: center;
        gap: 8px;
      " onmouseover="this.style.background='#2563eb'" onmouseout="this.style.background='#3b82f6'">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 11l3 3L22 4"></path>
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"></path>
        </svg>
        Grant Permission
      </button>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  // Handle grant permission
  document.getElementById('permission-grant').addEventListener('click', async () => {
    try {
      // Request permission for all URLs
      const granted = await chrome.permissions.request({
        origins: ['<all_urls>']
      });
      
      if (granted) {
        showNotification('Permission granted! You can now import podcasts.', 'success');
        modal.remove();
        // Proceed to show the podcast search modal
        showPodcastSearchModal();
      } else {
        showNotification('Permission denied. You won\'t be able to import podcasts.', 'error');
        modal.remove();
      }
    } catch (error) {
      await chrome.runtime.sendMessage({
        action: 'REQUEST_ALL_URLS_PERMISSION'
      });
      
      // Show waiting state
      content.innerHTML = `
        <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">Requesting Permission...</h2>
        <p style="color: #6b7280;">Please grant the permission in the popup window that appears.</p>
        <p style="color: #6b7280; font-size: 14px; margin-top: 16px;">If no popup appears, please check your browser's extension settings.</p>
      `;
      
      // Wait a moment then check if permission was granted
      setTimeout(async () => {
        const check = await chrome.runtime.sendMessage({
          action: 'CHECK_ALL_URLS_PERMISSION'
        });
        
        if (check.granted) {
          showNotification('Permission granted! You can now import podcasts.', 'success');
          modal.remove();
          showPodcastSearchModal();
        } else {
          modal.remove();
        }
      }, 1000);
    }
  });
  
  // Handle cancel
  document.getElementById('permission-cancel').addEventListener('click', () => {
    modal.remove();
  });
  
}

// Handle podcast import button click
async function handlePodcastImportClick() {
  // Track podcast import click
  chrome.runtime.sendMessage({
    action: 'TRACK_EVENT',
    eventName: 'podcast_import_click',
    parameters: {}
  });
  // Check if we have permission for all URLs first
  const permissionCheck = await chrome.runtime.sendMessage({
    action: 'CHECK_ALL_URLS_PERMISSION'
  });
  if (!permissionCheck.granted) {
    // Show a modal explaining why we need permission
    showPodcastPermissionModal();
  } else {
    // We have permission, proceed directly to search
    showPodcastSearchModal();
  }
}

function createPodcastButton() {
  try {
    const button = document.createElement('button');
    button.id = 'yoto-podcast-btn';
    
    const podcastIcon = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
        <line x1="12" y1="19" x2="12" y2="23"></line>
        <line x1="8" y1="23" x2="16" y2="23"></line>
      </svg>
    `;
    
    button.style.cssText = `
      background-color: #ffffff;
      color: #3b82f6;
      border: 1px solid #3b82f6;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.2s ease;
      white-space: nowrap;
      line-height: 1.5;
      height: 40px;
    `;
    
    button.innerHTML = `
      ${podcastIcon}
      <span>Import Podcast</span>
    `;
    
    button.onmouseenter = () => {
      button.style.backgroundColor = '#ffffff';
      button.style.color = '#9333ea';  // Purple color for podcast
      button.style.borderColor = '#9333ea';
      button.style.transform = 'translateY(-1px)';
    };
    
    button.onmouseleave = () => {
      button.style.backgroundColor = '#ffffff';
      button.style.color = '#3b82f6';
      button.style.borderColor = '#3b82f6';
      button.style.transform = 'translateY(0)';
    };
    
    button.addEventListener('click', handlePodcastImportClick);
    
    return button;
  } catch (error) {
    return null;
  }
}

function updateButtonIcon(authenticated) {
  const button = document.getElementById('yoto-magic-bulk-btn');
  if (!button) return;
  
  const iconSvg = authenticated ? 
    // Magic wand icon
    `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"></path>
    </svg>` :
    // Lock icon
    `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
    </svg>`;
  
  button.innerHTML = `
    ${iconSvg}
    <span>Bulk Icon Match</span>
  `;
}



async function handleImportClick() {
  try {
    const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });

    if (!authResponse || !authResponse.authenticated) {
      showNotification('Please authenticate to use import features', 'info');
      showAuthBanner();
      return;
    }
    
    // Show import options
    openFolderSelector();
  } catch (error) {
    showNotification('Error occurred. Please try again.', 'error');
    // Track import errors
    chrome.runtime.sendMessage({
      action: 'TRACK_ERROR',
      error: error.message || 'Import initialization failed',
      context: {
        action: 'import_init',
        component: 'content',
        authenticated: state.authenticated
      }
    });
    // If auth check fails, still show the import options
    showNotification('Proceeding without auth check...', 'warning');
    openFolderSelector();
  }
}

function openFolderSelector() {
  showImportOptionsModal();
}

async function handleBulkImportClick() {
  try {
    const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });

    if (!authResponse || !authResponse.authenticated) {
      showNotification('Please authenticate to use bulk import', 'info');
      showAuthBanner();
      return;
    }

    // User is authenticated, show bulk import modal
    showBulkImportOptionsModal();
  } catch (error) {
    showNotification('Error occurred. Please try again.', 'error');
    // Track import errors
    chrome.runtime.sendMessage({
      action: 'TRACK_ERROR',
      error: error.message || 'Bulk import initialization failed',
      context: {
        action: 'bulk_import_init',
        component: 'content',
        authenticated: state.authenticated
      }
    });
    // If auth check fails, still show the import options
    showNotification('Proceeding without auth check...', 'warning');
    showBulkImportOptionsModal();
  }
}

function showImportOptionsModal() {
  const existingModal = document.getElementById('yoto-import-options-modal');
  if (existingModal) existingModal.remove();
  
  const modal = document.createElement('div');
  modal.id = 'yoto-import-options-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 999999;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 20vh;
    background-color: rgba(0, 0, 0, 0.5);
  `;
  
  modal.innerHTML = `
    <div style="
      background-color: white;
      border-radius: 8px;
      padding: 24px;
      max-width: 400px;
      width: 90%;
      margin: 0 16px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    ">
      <h2 style="font-size: 20px; font-weight: bold; margin-bottom: 16px; color: #1f2937;">Choose Import Method</h2>
      <p style="color: #6b7280; margin-bottom: 24px;">Select how you want to import your playlist:</p>
      
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <button id="import-zip-btn" style="
          width: 100%;
          padding: 12px 16px;
          background-color: #3b82f6;
          color: white;
          border: none;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          cursor: pointer;
          font-size: 16px;
          font-weight: 500;
          transition: background-color 0.2s;
        " onmouseover="this.style.backgroundColor='#2563eb'" onmouseout="this.style.backgroundColor='#3b82f6'">
          <svg style="width: 20px; height: 20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
          </svg>
          <span>Import ZIP File</span>
        </button>
        
        <button id="import-folder-btn" style="
          width: 100%;
          padding: 12px 16px;
          background-color: #10b981;
          color: white;
          border: none;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          cursor: pointer;
          font-size: 16px;
          font-weight: 500;
          transition: background-color 0.2s;
        " onmouseover="this.style.backgroundColor='#059669'" onmouseout="this.style.backgroundColor='#10b981'">
          <svg style="width: 20px; height: 20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
          </svg>
          <span>Import Folder</span>
        </button>
      </div>
      
      <button id="import-cancel-btn" style="
        width: 100%;
        margin-top: 16px;
        padding: 8px 16px;
        background: none;
        border: none;
        color: #6b7280;
        cursor: pointer;
        font-size: 14px;
        transition: color 0.2s;
      " onmouseover="this.style.color='#1f2937'" onmouseout="this.style.color='#6b7280'">
        Cancel
      </button>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Add event listeners
  document.getElementById('import-zip-btn').addEventListener('click', () => {
    modal.remove();
    selectZipFile();
  });
  
  document.getElementById('import-folder-btn').addEventListener('click', () => {
    modal.remove();
    selectFolder();
  });
  
  document.getElementById('import-cancel-btn').addEventListener('click', () => {
    modal.remove();
  });
  
}

function showBulkImportOptionsModal() {
  const existingModal = document.getElementById('yoto-bulk-import-options-modal');
  if (existingModal) existingModal.remove();
  
  const modal = document.createElement('div');
  modal.id = 'yoto-bulk-import-options-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 999999;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 20vh;
    background-color: rgba(0, 0, 0, 0.5);
  `;
  
  modal.innerHTML = `
    <div style="
      background-color: white;
      border-radius: 8px;
      padding: 24px;
      max-width: 400px;
      width: 90%;
      margin: 0 16px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    ">
      <h2 style="font-size: 20px; font-weight: bold; margin-bottom: 16px; color: #1f2937;">Bulk Import Playlists</h2>
      <p style="color: #6b7280; margin-bottom: 24px;">Select a ZIP file containing multiple playlists. Each playlist should be in its own ZIP file or folder within the main ZIP.</p>
      
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <button id="bulk-import-zip-btn" style="
          width: 100%;
          padding: 12px 16px;
          background-color: #10b981;
          color: white;
          border: none;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          cursor: pointer;
          font-size: 16px;
          font-weight: 500;
          transition: background-color 0.2s;
        " onmouseover="this.style.backgroundColor='#059669'" onmouseout="this.style.backgroundColor='#10b981'">
          <svg style="width: 20px; height: 20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
          </svg>
          <span>Select ZIP File</span>
        </button>
        
        <button id="bulk-import-folder-btn" style="
          width: 100%;
          padding: 12px 16px;
          background-color: #3b82f6;
          color: white;
          border: none;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          cursor: pointer;
          font-size: 16px;
          font-weight: 500;
          transition: background-color 0.2s;
        " onmouseover="this.style.backgroundColor='#2563eb'" onmouseout="this.style.backgroundColor='#3b82f6'">
          <svg style="width: 20px; height: 20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
          </svg>
          <span>Select Folder</span>
        </button>
      </div>
      
      <button id="bulk-import-cancel-btn" style="
        width: 100%;
        margin-top: 16px;
        padding: 8px 16px;
        background: none;
        border: none;
        color: #6b7280;
        cursor: pointer;
        font-size: 14px;
        transition: color 0.2s;
      " onmouseover="this.style.color='#1f2937'" onmouseout="this.style.color='#6b7280'">
        Cancel
      </button>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Add event listeners
  document.getElementById('bulk-import-zip-btn').addEventListener('click', () => {
    modal.remove();
    selectBulkZipFile();
  });
  
  document.getElementById('bulk-import-folder-btn').addEventListener('click', () => {
    modal.remove();
    selectBulkFolder();
  });
  
  document.getElementById('bulk-import-cancel-btn').addEventListener('click', () => {
    modal.remove();
  });
  
}

function selectZipFile() {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.zip,application/zip,application/x-zip-compressed';
  fileInput.style.display = 'none';
  
  document.body.appendChild(fileInput);
  
  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    fileInput.remove();
    
    if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
      showNotification('Processing ZIP file...', 'info');
      await processZipFile(files[0]);
    } else if (files.length > 0) {
      showNotification('Please select a valid ZIP file', 'error');
    }
  });
  
  fileInput.click();
}

function selectFolder() {
  const folderInput = document.createElement('input');
  folderInput.type = 'file';
  folderInput.webkitdirectory = true;
  folderInput.directory = true;
  folderInput.multiple = true;
  folderInput.style.display = 'none';
  
  document.body.appendChild(folderInput);
  
  folderInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    folderInput.remove();
    
    if (files.length > 0) {
      showNotification('Processing folder...', 'info');
      await processFolderFiles(files);
    }
  });
  
  folderInput.click();
}

// Load best kids' podcasts with randomization
async function loadBestKidsPodcasts() {
  const loadingDiv = document.getElementById('best-podcasts-loading');
  const carouselDiv = document.getElementById('best-podcasts-carousel');
  const listDiv = document.getElementById('best-podcasts-list');
  
  try {
    // Define kids genre IDs - only kid-friendly genres
    const kidsGenreIds = {
      'Stories for Kids': 198,
      'Education for Kids': 195
    };
    
    // Randomly choose a strategy for variety
    const strategies = [
      'stories-only',     // Show only story podcasts
      'education-only',   // Show only educational podcasts
      'mixed-balanced',   // Equal mix of both genres
      'stories-heavy',    // Mostly stories with some educational
      'education-heavy'   // Mostly educational with some stories
    ];
    
    const randomStrategy = strategies[Math.floor(Math.random() * strategies.length)];
    
    let allPodcasts = [];
    
    switch (randomStrategy) {
      case 'stories-only': {
        // Show only story podcasts from random page
        const randomPage = Math.floor(Math.random() * 3) + 1; // Pages 1-3
        
        const response = await chrome.runtime.sendMessage({
          action: 'GET_BEST_PODCASTS',
          genreId: kidsGenreIds['Stories for Kids'],
          page: randomPage
        });
        
        if (!response.error && response.podcasts) {
          allPodcasts = response.podcasts;
        }
        break;
      }
      
      case 'education-only': {
        // Show only educational podcasts from random page
        const randomPage = Math.floor(Math.random() * 3) + 1; // Pages 1-3
        
        const response = await chrome.runtime.sendMessage({
          action: 'GET_BEST_PODCASTS',
          genreId: kidsGenreIds['Education for Kids'],
          page: randomPage
        });
        
        if (!response.error && response.podcasts) {
          allPodcasts = response.podcasts;
        }
        break;
      }
      
      case 'mixed-balanced': {
        // Equal mix from both genres
        
        const [storiesResponse, eduResponse] = await Promise.all([
          chrome.runtime.sendMessage({
            action: 'GET_BEST_PODCASTS',
            genreId: kidsGenreIds['Stories for Kids'],
            page: 1
          }),
          chrome.runtime.sendMessage({
            action: 'GET_BEST_PODCASTS',
            genreId: kidsGenreIds['Education for Kids'],
            page: 1
          })
        ]);
        
        const stories = storiesResponse.podcasts || [];
        const educational = eduResponse.podcasts || [];
        
        // Interleave for balanced mix
        const maxLength = Math.max(stories.length, educational.length);
        for (let i = 0; i < maxLength; i++) {
          if (i < stories.length) {
            allPodcasts.push(stories[i]);
          }
          if (i < educational.length) {
            allPodcasts.push(educational[i]);
          }
        }
        
        // Limit to reasonable number
        allPodcasts = allPodcasts.slice(0, 14);
        break;
      }
      
      case 'stories-heavy': {
        // Mostly stories with some educational
        
        const storiesResponse = await chrome.runtime.sendMessage({
          action: 'GET_BEST_PODCASTS',
          genreId: kidsGenreIds['Stories for Kids'],
          page: 1
        });
        
        const eduResponse = await chrome.runtime.sendMessage({
          action: 'GET_BEST_PODCASTS',
          genreId: kidsGenreIds['Education for Kids'],
          page: 1
        });
        
        if (!storiesResponse.error && storiesResponse.podcasts) {
          // Take mostly stories
          allPodcasts = storiesResponse.podcasts.slice(0, 9);
          
          // Add a few educational
          if (!eduResponse.error && eduResponse.podcasts) {
            allPodcasts.push(...eduResponse.podcasts.slice(0, 3));
          }
        }
        break;
      }
      
      case 'education-heavy':
      default: {
        // Mostly educational with some stories
        
        const eduResponse = await chrome.runtime.sendMessage({
          action: 'GET_BEST_PODCASTS',
          genreId: kidsGenreIds['Education for Kids'],
          page: 1
        });
        
        const storiesResponse = await chrome.runtime.sendMessage({
          action: 'GET_BEST_PODCASTS',
          genreId: kidsGenreIds['Stories for Kids'],
          page: 1
        });
        
        if (!eduResponse.error && eduResponse.podcasts) {
          // Take mostly educational
          allPodcasts = eduResponse.podcasts.slice(0, 9);
          
          // Add a few stories
          if (!storiesResponse.error && storiesResponse.podcasts) {
            allPodcasts.push(...storiesResponse.podcasts.slice(0, 3));
          }
        }
        break;
      }
    }
    
    // Shuffle the final podcast list for additional randomness
    if (allPodcasts.length > 0) {
      // Fisher-Yates shuffle
      for (let i = allPodcasts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allPodcasts[i], allPodcasts[j]] = [allPodcasts[j], allPodcasts[i]];
      }
      
      // Limit display to avoid overwhelming the carousel
      const displayPodcasts = allPodcasts.slice(0, 12);
      
      // Display the podcasts
      listDiv.innerHTML = '';
      displayPodcasts.forEach(podcast => {
        const podcastCard = createPodcastCard(podcast, true);
        listDiv.appendChild(podcastCard);
      });
      
      carouselDiv.style.display = 'block';
    }
    
    loadingDiv.style.display = 'none';
    
  } catch (error) {
    loadingDiv.style.display = 'none';
  }
}

// Create a podcast card for display
function createPodcastCard(podcast, isCompact = false) {
  const card = document.createElement('div');
  
  if (isCompact) {
    // Compact card for carousel - responsive sizing
    card.style.cssText = `
      flex: 0 0 auto;
      min-width: 140px;
      width: 140px;
      max-width: 180px;
      display: inline-block;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 12px;
      cursor: pointer;
      transition: all 0.2s;
      background: white;
      flex-shrink: 0;
    `;
    
    card.innerHTML = `
      ${podcast.thumbnail ? 
        `<img src="${podcast.thumbnail}" alt="${podcast.title}" style="
          width: 100%;
          height: 120px;
          object-fit: cover;
          border-radius: 6px;
          margin-bottom: 8px;
          background: #f3f4f6;
        " onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">` :
        ''
      }
      <div style="
        width: 100%;
        height: 120px;
        border-radius: 6px;
        margin-bottom: 8px;
        background: linear-gradient(135deg, #1558d1 0%, #0f47a8 100%);
        display: ${podcast.thumbnail ? 'none' : 'flex'};
        align-items: center;
        justify-content: center;
        font-size: 32px;
        font-weight: bold;
        color: white;
      ">
        🎙️
      </div>
      <h4 style="
        margin: 0 0 4px 0;
        font-size: 13px;
        font-weight: 600;
        color: #1f2937;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      ">${podcast.title}</h4>
      <p style="
        margin: 0;
        font-size: 11px;
        color: #6b7280;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      ">${podcast.publisher || ''}</p>
    `;
    
    card.onmouseenter = () => {
      card.style.transform = 'translateY(-2px)';
      card.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
    };
    
    card.onmouseleave = () => {
      card.style.transform = 'translateY(0)';
      card.style.boxShadow = 'none';
    };
    
  } else {
    // Full card for search results
    card.style.cssText = `
      display: flex;
      gap: 12px;
      padding: 12px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      margin-bottom: 10px;
      cursor: pointer;
      transition: all 0.2s;
    `;
    
    card.innerHTML = `
      ${podcast.thumbnail ? 
        `<img src="${podcast.thumbnail}" alt="${podcast.title}" style="
          width: 60px;
          height: 60px;
          object-fit: cover;
          border-radius: 6px;
          flex-shrink: 0;
          background: #f3f4f6;
        " onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">` :
        ''
      }
      <div style="
        width: 60px;
        height: 60px;
        border-radius: 6px;
        flex-shrink: 0;
        background: linear-gradient(135deg, #1558d1 0%, #0f47a8 100%);
        display: ${podcast.thumbnail ? 'none' : 'flex'};
        align-items: center;
        justify-content: center;
        font-size: 20px;
        font-weight: bold;
        color: white;
      ">
        🎙️
      </div>
      <div style="flex: 1; min-width: 0;">
        <h4 style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600; color: #1f2937;">${podcast.title}</h4>
        <p style="margin: 0 0 4px 0; font-size: 12px; color: #6b7280;">${podcast.publisher || ''}</p>
        <p style="margin: 0; font-size: 11px; color: #9ca3af;">${podcast.total_episodes || 0} episodes</p>
      </div>
    `;
    
    card.onmouseenter = () => {
      card.style.backgroundColor = '#f9fafb';
      card.style.borderColor = '#3b82f6';
    };
    
    card.onmouseleave = () => {
      card.style.backgroundColor = 'transparent';
      card.style.borderColor = '#e5e7eb';
    };
  }
  
  // Handle click to select podcast
  card.addEventListener('click', () => selectPodcast(podcast));
  
  return card;
}

// Handle podcast selection
async function selectPodcast(podcast) {
  // Track podcast selection
  chrome.runtime.sendMessage({
    action: 'TRACK_EVENT',
    eventName: 'podcast_selected',
    parameters: {
      podcast_title: podcast.title,
      podcast_id: podcast.id
    }
  });
  
  // Close search modal if it exists
  const searchModal = document.getElementById('podcast-search-modal');
  if (searchModal) {
    searchModal.remove();
  }
  
  // Create episode selection modal
  const modal = document.createElement('div');
  modal.id = 'episode-selection-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    z-index: 99999;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 20vh;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    animation: fadeIn 0.3s ease;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 30px;
    max-width: 600px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    animation: slideDown 0.3s ease;
  `;
  
  content.innerHTML = `
    <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">Import ${podcast.title}</h2>
    <div style="display: flex; gap: 16px; margin-bottom: 20px;">
      ${podcast.thumbnail ? 
        `<img src="${podcast.thumbnail}" alt="${podcast.title}" style="
          width: 80px;
          height: 80px;
          border-radius: 8px;
          object-fit: cover;
          background: #f3f4f6;
        " onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'" />` :
        ''
      }
      <div style="
        width: 80px;
        height: 80px;
        border-radius: 8px;
        background: linear-gradient(135deg, #1558d1 0%, #0f47a8 100%);
        display: ${podcast.thumbnail ? 'none' : 'flex'};
        align-items: center;
        justify-content: center;
        font-size: 28px;
        font-weight: bold;
        color: white;
        flex-shrink: 0;
      ">
        🎙️
      </div>
      <div>
        <h3 style="margin: 0 0 4px 0; font-size: 18px; color: #1f2937;">${podcast.title}</h3>
        <p style="margin: 0; font-size: 14px; color: #6b7280;">${podcast.publisher || ''}</p>
      </div>
    </div>
    <div id="episode-loading" style="text-align: center; padding: 40px;">
      <div style="display: inline-block; width: 40px; height: 40px; border: 3px solid #f3f4f6; border-top-color: #3b82f6; border-radius: 50%; animation: spin 1s linear infinite;"></div>
      <p style="margin-top: 10px; color: #6b7280;">Loading episodes...</p>
    </div>
    <div id="episode-content" style="display: none;">
      <div style="margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <label style="font-weight: 500; color: #374151;">
            Select episodes to import: <span id="selected-count" style="color: #3b82f6;"></span>
          </label>
          <div style="display: flex; gap: 8px;">
            <button id="select-all-episodes" style="
              padding: 4px 12px;
              font-size: 12px;
              background: #3b82f6;
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
            ">Select All</button>
            <button id="deselect-all-episodes" style="
              padding: 4px 12px;
              font-size: 12px;
              background: #6b7280;
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
            ">Deselect All</button>
          </div>
        </div>
        <div id="episode-list" style="
          max-height: 400px;
          overflow-y: auto;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          padding: 12px;
          background: #f9fafb;
        "></div>
      </div>
      <div id="import-progress" style="display: none; margin: 20px 0;">
        <div style="background: #f0f0f0; border-radius: 4px; height: 8px; overflow: hidden;">
          <div id="import-progress-bar" style="background: #3b82f6; height: 100%; width: 0%; transition: width 0.3s;"></div>
        </div>
        <p id="import-status" style="margin-top: 10px; color: #666; font-size: 14px;"></p>
      </div>
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button id="episode-cancel" style="
          padding: 10px 20px;
          background: #f3f4f6;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
        ">Cancel</button>
        <button id="start-import" style="
          padding: 10px 20px;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
        ">Import Episodes</button>
      </div>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  // Store pagination data
  let allEpisodes = [];
  let nextEpisodePubDate = null;
  let hasMoreEpisodes = false;
  
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'GET_PODCAST_EPISODES',
      podcastId: podcast.id
    });
    
    document.getElementById('episode-loading').style.display = 'none';
    document.getElementById('episode-content').style.display = 'block';
    
    if (response.error === 'rate_limited' && response.rateLimited) {
      // Show rate limit message in the modal instead of removing it
      document.getElementById('episode-content').innerHTML = `
        <div style="padding: 20px;">
          <div style="background: #fff8e1; border: 1px solid #ffcc00; border-radius: 8px; padding: 20px;">
            <div style="display: flex; align-items: start; gap: 12px;">
              <span style="font-size: 24px;">⚠️</span>
              <div>
                <h3 style="margin: 0 0 10px; color: #f57c00;">Usage Limit Reached</h3>
                <p style="margin: 0; color: #666; line-height: 1.6;">${response.message}</p>
              </div>
            </div>
          </div>
        </div>
      `;
      return;
    }
    
    if (response.error) {
      showNotification(response.error, 'error');
      modal.remove();
      return;
    }
    
    allEpisodes = response.episodes || [];
    nextEpisodePubDate = response.next_episode_pub_date || null;
    hasMoreEpisodes = response.has_more || false;
    
    if (allEpisodes.length === 0) {
      showNotification('No episodes found for this podcast', 'error');
      modal.remove();
      return;
    }
    
    const episodeList = document.getElementById('episode-list');
    
    let selectedEpisodeIndices = new Set();
    
    const renderEpisodeList = (preserveSelection = false) => {
      // If not preserving selection and this is the initial load, don't select any by default
      if (!preserveSelection) {
        selectedEpisodeIndices.clear();
      }
      
      episodeList.innerHTML = allEpisodes.map((ep, index) => {
      const isOverLimit = ep.audio_length_sec > 3600;
      const durationColor = isOverLimit ? '#ef4444' : '#6b7280';
      const warningAsterisk = isOverLimit ? '*' : '';
      const isChecked = selectedEpisodeIndices.has(index);
      
      return `
        <div style="
          display: flex;
          align-items: center;
          margin-bottom: 8px;
          padding: 10px;
          background: white;
          border-radius: 4px;
          border: 1px solid #e5e7eb;
        ">
          <input type="checkbox" 
            id="episode-${index}" 
            value="${index}"
            ${isChecked ? 'checked' : ''}
            style="
              margin-right: 12px;
              cursor: pointer;
              width: 16px;
              height: 16px;
            "
          />
          <label for="episode-${index}" style="
            flex: 1;
            cursor: pointer;
            font-size: 14px;
            line-height: 1.5;
          ">
            <div style="font-weight: 500; color: #1f2937; margin-bottom: 4px;">
              ${ep.title}
            </div>
            <div style="font-size: 12px; color: ${durationColor};">
              ${formatDuration(ep.audio_length_sec)}${warningAsterisk}
              ${ep.pub_date_ms ? ` • ${new Date(ep.pub_date_ms).toLocaleDateString()}` : ''}
            </div>
          </label>
        </div>
      `;
      }).join('');
      
      const hasLongEpisodes = allEpisodes.some(ep => ep.audio_length_sec > 3600);
      if (hasLongEpisodes) {
        episodeList.innerHTML += `
          <p style="margin: 12px 0 0 0; font-size: 12px; color: #6b7280; font-style: italic;">
            <span style="color: #ef4444;">*</span> Episodes over 60 minutes may exceed Yoto's official track limit.
          </p>
        `;
      }
      
      if (hasMoreEpisodes) {
        episodeList.innerHTML += `
          <div style="text-align: center; margin-top: 16px;">
            <button id="load-more-episodes" style="
              padding: 8px 20px;
              background: #f3f4f6;
              color: #4b5563;
              border: 1px solid #d1d5db;
              border-radius: 6px;
              font-size: 14px;
              cursor: pointer;
              transition: all 0.2s;
            ">
              Load More Episodes
            </button>
          </div>
        `;
        
        setTimeout(() => {
          const loadMoreBtn = document.getElementById('load-more-episodes');
          if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', async () => {
              loadMoreBtn.disabled = true;
              loadMoreBtn.textContent = 'Loading...';
              
              try {
                selectedEpisodeIndices.clear();
                allEpisodes.forEach((_, index) => {
                  const checkbox = document.getElementById(`episode-${index}`);
                  if (checkbox && checkbox.checked) {
                    selectedEpisodeIndices.add(index);
                  }
                });
                
                const moreResponse = await chrome.runtime.sendMessage({
                  action: 'GET_PODCAST_EPISODES',
                  podcastId: podcast.id,
                  nextEpisodePubDate: nextEpisodePubDate
                });
                
                if (moreResponse.episodes && moreResponse.episodes.length > 0) {
                  allEpisodes = [...allEpisodes, ...moreResponse.episodes];
                  nextEpisodePubDate = moreResponse.next_episode_pub_date || null;
                  hasMoreEpisodes = moreResponse.has_more || false;
                  
                  renderEpisodeList(true);
                  
                  attachEventListeners();
                } else {
                  loadMoreBtn.style.display = 'none';
                }
              } catch (error) {
                showNotification('Failed to load more episodes', 'error');
                loadMoreBtn.disabled = false;
                loadMoreBtn.textContent = 'Load More Episodes';
              }
            });
          }
        }, 100);
      }
    };
    
    const updateSelectedCount = () => {
      let selectedCount = 0;
      allEpisodes.forEach((_, index) => {
        const checkbox = document.getElementById(`episode-${index}`);
        if (checkbox && checkbox.checked) {
          selectedCount++;
        }
      });
      const countElement = document.getElementById('selected-count');
      if (countElement) {
        countElement.textContent = `(${selectedCount} selected)`;
      }
    };
    
    const attachEventListeners = () => {
      allEpisodes.forEach((_, index) => {
        const checkbox = document.getElementById(`episode-${index}`);
        if (checkbox) {
          checkbox.removeEventListener('change', updateSelectedCount);
          
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
              selectedEpisodeIndices.add(index);
            } else {
              selectedEpisodeIndices.delete(index);
            }
            updateSelectedCount();
          });
        }
      });
      
      updateSelectedCount();
    };
    
    renderEpisodeList();
    attachEventListeners();
    
    document.getElementById('select-all-episodes').addEventListener('click', () => {
      allEpisodes.forEach((_, index) => {
        const checkbox = document.getElementById(`episode-${index}`);
        if (checkbox) {
          checkbox.checked = true;
          selectedEpisodeIndices.add(index);
        }
      });
      updateSelectedCount();
    });
    
    document.getElementById('deselect-all-episodes').addEventListener('click', () => {
      allEpisodes.forEach((_, index) => {
        const checkbox = document.getElementById(`episode-${index}`);
        if (checkbox) {
          checkbox.checked = false;
          selectedEpisodeIndices.delete(index);
        }
      });
      updateSelectedCount();
    });
    
    // Handle import button click
    document.getElementById('start-import').addEventListener('click', async () => {
      const selectedIndices = [];
      allEpisodes.forEach((_, index) => {
        const checkbox = document.getElementById(`episode-${index}`);
        if (checkbox && checkbox.checked) {
          selectedIndices.push(index);
        }
      });
      
      if (selectedIndices.length === 0) {
        showNotification('Please select at least one episode to import', 'warning');
        return;
      }
      
      const selectedEpisodes = selectedIndices.map(index => allEpisodes[index]);
      
      const progressDiv = document.getElementById('import-progress');
      const progressBar = document.getElementById('import-progress-bar');
      const statusText = document.getElementById('import-status');
      const importBtn = document.getElementById('start-import');
      const cancelBtn = document.getElementById('episode-cancel');
      
      progressDiv.style.display = 'block';
      importBtn.disabled = true;
      importBtn.textContent = 'Importing...';
      // Keep cancel button enabled so user can cancel
      cancelBtn.textContent = 'Cancel Import';
      
      statusText.textContent = `Starting import of ${selectedEpisodes.length} episode${selectedEpisodes.length > 1 ? 's' : ''}...`;
      progressBar.style.width = '5%';
      
      // Create a flag to track if import was cancelled
      let importCancelled = false;
      
      // Update cancel button to stop the import
      const cancelHandler = async () => {
        importCancelled = true;
        statusText.textContent = 'Cancelling import...';
        progressBar.style.width = '0%';
        
        // Notify service worker to stop the import
        try {
          await chrome.runtime.sendMessage({
            action: 'CANCEL_PODCAST_IMPORT'
          });
        } catch (e) {
        }
        
        // Clear any stored import data
        await chrome.storage.local.remove(['podcastImportResult', 'podcastImportTimestamp', 'podcastImportProgress']);
        
        // Close modal after brief delay
        setTimeout(() => {
          modal.remove();
        }, 500);
      };
      
      // Replace the existing cancel handler
      cancelBtn.onclick = cancelHandler;
      
      try {
        // Start the import process
        const startResponse = await chrome.runtime.sendMessage({
          action: 'IMPORT_PODCAST_EPISODES',
          podcast: podcast,
          episodes: selectedEpisodes
        });
        
        if (startResponse.error) {
          throw new Error(startResponse.error);
        }
        
        if (startResponse.status !== 'started') {
          throw new Error('Failed to start import');
        }
        
        // Poll for import status
        let importComplete = false;
        let pollAttempts = 0;
        const maxAttempts = 120; // 2 minutes timeout
        
        progressBar.style.width = '10%';
        statusText.textContent = 'Downloading and processing episodes...';
        
        while (!importComplete && !importCancelled && pollAttempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
          
          // Check if cancelled
          if (importCancelled) {
            break;
          }
          
          const statusResponse = await chrome.runtime.sendMessage({
            action: 'GET_PODCAST_IMPORT_STATUS'
          });
          
          if (statusResponse) {
            // Update progress
            if (statusResponse.progress) {
              const progress = statusResponse.progress;
              if (progress.status === 'in_progress') {
                const percent = progress.total > 0 
                  ? Math.min(10 + (progress.current / progress.total * 80), 90)
                  : 10;
                progressBar.style.width = `${percent}%`;
                statusText.textContent = progress.message || 'Processing...';
              }
            }
            
            // Check for completion
            if (statusResponse.success) {
              importComplete = true;
              progressBar.style.width = '100%';
              statusText.textContent = `Successfully imported ${statusResponse.tracksImported || selectedEpisodes.length} episodes!`;
              importBtn.textContent = 'Completed';
              
              // Clear storage
              await chrome.storage.local.remove(['podcastImportResult', 'podcastImportTimestamp', 'podcastImportProgress']);
              
              // Close modal and reload after delay
              setTimeout(() => {
                modal.remove();
                window.location.reload();
              }, 2000);
            } else if (statusResponse.cancelled) {
              // Import was cancelled
              importComplete = true;
              importCancelled = true;
              break;
            } else if (statusResponse.needsPermission) {
              // This shouldn't happen anymore since we request permission upfront
              // But keep as fallback just in case
              importComplete = true;
              statusText.innerHTML = `
                <div style="color: #dc3545;">
                  <p>Permission required to access podcast audio files.</p>
                  <p style="font-size: 14px; margin-top: 10px;">Please close this modal and try importing again.</p>
                </div>
              `;
              progressBar.style.width = '0%';
              importBtn.style.display = 'none';
              cancelBtn.textContent = 'Close';
            } else if (statusResponse.error) {
              throw new Error(statusResponse.error);
            }
          }
          
          pollAttempts++;
        }
        
        if (!importComplete) {
          throw new Error('Import is taking longer than expected. Please refresh the page.');
        }
        
      } catch (error) {
        statusText.textContent = `Error: ${error.message}`;
        progressBar.style.width = '0%';
        importBtn.disabled = false;
        importBtn.textContent = 'Import Episodes';
        cancelBtn.textContent = 'Close';
        cancelBtn.onclick = () => modal.remove();
        showNotification(`Import failed: ${error.message}`, 'error');
      }
    });
    
    // Handle cancel
    document.getElementById('episode-cancel').addEventListener('click', () => {
      modal.remove();
    });
    
  } catch (error) {
    showNotification('Failed to load podcast episodes', 'error');
    modal.remove();
  }
  
}


// Show podcast search modal
function showPodcastSearchModal() {
  const modal = document.createElement('div');
  modal.id = 'podcast-search-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    z-index: 99999;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 20vh;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    animation: fadeIn 0.3s ease;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 30px;
    max-width: 750px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    overflow-x: visible;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    animation: slideDown 0.3s ease;
  `;
  
  content.innerHTML = `
    <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">Import Podcast</h2>
    <div style="margin-bottom: 20px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #374151;">
        Enter podcast name to search:
      </label>
      <input type="text" id="podcast-search-input" placeholder="e.g., Radiolab for Kids" style="
        width: 100%;
        padding: 10px 12px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 14px;
        box-sizing: border-box;
      " />
    </div>
    
    <!-- Best Kids' Podcasts Section -->
    <div id="best-podcasts-section" style="margin-bottom: 20px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #374151;">
        Popular Kids' Podcasts:
      </label>
      <div id="best-podcasts-loading" style="text-align: center; padding: 20px;">
        <div style="display: inline-block; width: 30px; height: 30px; border: 3px solid #f3f4f6; border-top-color: #3b82f6; border-radius: 50%; animation: spin 1s linear infinite;"></div>
      </div>
      <div id="best-podcasts-carousel" style="
        display: none;
        overflow-x: scroll;
        overflow-y: hidden;
        padding: 10px 0 25px 0;
        margin: 0;
        scrollbar-width: thin;
        scrollbar-color: #cbd5e0 #f3f4f6;
        -webkit-overflow-scrolling: touch;
        position: relative;
      ">
        <div id="best-podcasts-list" style="
          display: inline-flex;
          flex-wrap: nowrap;
          gap: 12px;
          padding: 0 10px;
          width: max-content;
        "></div>
      </div>
      <style>
        #best-podcasts-carousel {
          scrollbar-width: auto !important;
          scrollbar-color: #6b7280 #e5e7eb !important;
        }
        #best-podcasts-carousel::-webkit-scrollbar {
          height: 16px !important;
          display: block !important;
          visibility: visible !important;
          opacity: 1 !important;
        }
        #best-podcasts-carousel::-webkit-scrollbar-track {
          background: #e5e7eb;
          border-radius: 8px;
          border: 1px solid #d1d5db;
        }
        #best-podcasts-carousel::-webkit-scrollbar-thumb {
          background: #6b7280;
          border-radius: 8px;
          border: 2px solid #e5e7eb;
          min-width: 40px;
        }
        #best-podcasts-carousel::-webkit-scrollbar-thumb:hover {
          background: #4b5563;
        }
        #best-podcasts-carousel::-webkit-scrollbar-thumb:active {
          background: #374151;
        }
        
        /* Responsive adjustments for different viewports */
        @media (max-width: 480px) {
          #best-podcasts-carousel {
            margin: 0 -15px;
            padding: 10px 15px 20px 15px;
          }
          #best-podcasts-list {
            padding: 0 5px !important;
          }
        }
        
        @media (min-width: 768px) and (max-width: 1024px) {
          /* iPad and tablet optimization */
          #best-podcasts-carousel {
            padding-bottom: 25px;
          }
          #best-podcasts-carousel::-webkit-scrollbar {
            height: 14px !important;
          }
        }
        
        @media (min-width: 1025px) {
          /* Desktop optimization */
          #best-podcasts-carousel::-webkit-scrollbar {
            height: 14px !important;
          }
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
    </div>
    
    <div id="podcast-search-results" style="display: none; margin-bottom: 20px;">
      <div id="podcast-loading" style="display: none; text-align: center; padding: 20px;">
        <div style="display: inline-block; width: 40px; height: 40px; border: 3px solid #f3f4f6; border-top-color: #3b82f6; border-radius: 50%; animation: spin 1s linear infinite;"></div>
        <p style="margin-top: 10px; color: #6b7280;">Searching podcasts...</p>
      </div>
      <div id="podcast-list" style="max-height: 300px; overflow-y: auto;"></div>
      <div id="podcast-error" style="display: none; color: #ef4444; padding: 10px; background: #fee; border-radius: 6px;"></div>
    </div>
    <div style="display: flex; gap: 12px; justify-content: flex-end;">
      <button id="podcast-cancel" style="
        padding: 10px 20px;
        background: #f3f4f6;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">Cancel</button>
      <button id="podcast-search-btn" style="
        padding: 10px 20px;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">Search</button>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  // Load best kids' podcasts
  loadBestKidsPodcasts();
  
  // Focus on input
  const searchInput = document.getElementById('podcast-search-input');
  searchInput.focus();
  
  // Handle search
  const searchBtn = document.getElementById('podcast-search-btn');
  const handleSearch = async () => {
    const query = searchInput.value.trim();
    if (!query) {
      showNotification('Please enter a podcast name', 'error');
      return;
    }
    
    const resultsDiv = document.getElementById('podcast-search-results');
    const loadingDiv = document.getElementById('podcast-loading');
    const listDiv = document.getElementById('podcast-list');
    const errorDiv = document.getElementById('podcast-error');
    
    resultsDiv.style.display = 'block';
    loadingDiv.style.display = 'block';
    listDiv.innerHTML = '';
    errorDiv.style.display = 'none';
    
    try {
      // Search for podcasts via service worker
      const response = await chrome.runtime.sendMessage({
        action: 'SEARCH_PODCASTS',
        query: query
      });
      
      loadingDiv.style.display = 'none';
      
      if (response.error === 'rate_limited' && response.rateLimited) {
        // Show the rate limit message
        errorDiv.innerHTML = `
          <div style="padding: 15px; background: #fff8e1; border: 1px solid #ffcc00; border-radius: 8px; margin-bottom: 20px;">
            <div style="display: flex; align-items: start; gap: 10px;">
              <span style="font-size: 20px;">⚠️</span>
              <div>
                <strong style="color: #f57c00;">Usage Limit Reached</strong>
                <p style="margin: 8px 0 0 0; color: #666; line-height: 1.5;">${response.message}</p>
              </div>
            </div>
          </div>
        `;
        errorDiv.style.display = 'block';
        
        // If we have fallback podcasts, still show them
        if (response.podcasts && response.podcasts.length > 0) {
          const suggestionDiv = document.createElement('div');
          suggestionDiv.innerHTML = '<h3 style="margin: 20px 0 10px;">Popular Kids Podcasts:</h3>';
          listDiv.appendChild(suggestionDiv);
          
          response.podcasts.forEach(podcast => {
            const podcastCard = createPodcastCard(podcast, false);
            listDiv.appendChild(podcastCard);
          });
        }
        return;
      }
      
      if (response.error) {
        errorDiv.textContent = response.error;
        errorDiv.style.display = 'block';
        return;
      }
      
      if (!response.podcasts || response.podcasts.length === 0) {
        errorDiv.textContent = `No podcasts found for "${query}"`;
        errorDiv.style.display = 'block';
        return;
      }
      
      // Display podcast results using the createPodcastCard function
      response.podcasts.forEach(podcast => {
        const podcastCard = createPodcastCard(podcast, false);
        listDiv.appendChild(podcastCard);
      });
      
    } catch (error) {
      loadingDiv.style.display = 'none';
      errorDiv.textContent = 'Failed to search podcasts. Please try again.';
      errorDiv.style.display = 'block';
    }
  };
  
  searchBtn.addEventListener('click', handleSearch);
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  });
  
  // Handle cancel
  document.getElementById('podcast-cancel').addEventListener('click', () => {
    modal.remove();
  });
  
}
// Format duration from seconds to readable format
function formatDuration(seconds) {
  if (!seconds) return 'Unknown';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
  }
  return `${mins}m ${secs}s`;
}

async function processFolderFiles(files) {
  let folderName = 'Imported Playlist';
  if (files[0] && files[0].webkitRelativePath) {
    const pathParts = files[0].webkitRelativePath.split('/');
    if (pathParts.length > 0) {
      folderName = pathParts[0]; // Get the root folder name
    }
  }
  
  // Supported audio and image extensions (same as ZIP processing)
  const audioExtensions = ['m4a', 'mp3', 'mp4', 'm4b', 'wav', 'ogg', 'aac', 'flac'];
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
  
  // Filter out Mac metadata and non-media files
  const cleanFiles = Array.from(files).filter(f => {
    if (f.name.startsWith('._') || f.webkitRelativePath.includes('__MACOSX/')) {
      return false;
    }
    if (f.name === '.DS_Store' || f.name === 'Thumbs.db') {
      return false;
    }
    const ext = f.name.split('.').pop().toLowerCase();
    return audioExtensions.includes(ext) || imageExtensions.includes(ext);
  });
  
  const allAudioFiles = [];
  const allImageFiles = [];
  
  cleanFiles.forEach(f => {
    const ext = f.name.split('.').pop().toLowerCase();
    f.fileSize = f.size; // Add fileSize property for consistency
    
    if (audioExtensions.includes(ext)) {
      allAudioFiles.push(f);
    } else if (imageExtensions.includes(ext)) {
      allImageFiles.push(f);
    }
  });
  
  let audioFiles = [];
  
  // 1. First, look for folders containing 'audio' in the name
  const audioFolderFiles = allAudioFiles.filter(f => 
    f.webkitRelativePath.toLowerCase().includes('/audio')
  );
  
  if (audioFolderFiles.length > 0) {
    audioFiles = audioFolderFiles;
  } 
  // 2. If not found, use all audio files found
  else if (allAudioFiles.length > 0) {
    // Find the most common directory containing audio files
    const audioDirs = {};
    allAudioFiles.forEach(f => {
      const dir = f.webkitRelativePath.substring(0, f.webkitRelativePath.lastIndexOf('/'));
      audioDirs[dir] = (audioDirs[dir] || 0) + 1;
    });
    
    // Use files from the directory with most audio files, or all if in root
    if (Object.keys(audioDirs).length > 0) {
      const mainAudioDir = Object.keys(audioDirs).reduce((a, b) => 
        audioDirs[a] > audioDirs[b] ? a : b, ''
      );
      audioFiles = allAudioFiles.filter(f => 
        f.webkitRelativePath.startsWith(mainAudioDir)
      );
    } else {
      audioFiles = allAudioFiles;
    }
  }
  
  // Smart image folder detection (same logic as ZIP)
  let imageFiles = [];
  
  // 1. First, look for folders containing 'images' or 'icons' in the name
  const imageFolderFiles = allImageFiles.filter(f => {
    const path = f.webkitRelativePath.toLowerCase();
    return path.includes('/image') || path.includes('/icon');
  });
  
  if (imageFolderFiles.length > 0) {
    imageFiles = imageFolderFiles;
  }
  // 2. If not found, use all image files found
  else if (allImageFiles.length > 0) {
    // Find the most common directory containing image files
    const imageDirs = {};
    allImageFiles.forEach(f => {
      const dir = f.webkitRelativePath.substring(0, f.webkitRelativePath.lastIndexOf('/'));
      imageDirs[dir] = (imageDirs[dir] || 0) + 1;
    });
    
    // Use files from the directory with most image files, or all if in root
    if (Object.keys(imageDirs).length > 0) {
      const mainImageDir = Object.keys(imageDirs).reduce((a, b) => 
        imageDirs[a] > imageDirs[b] ? a : b, ''
      );
      imageFiles = allImageFiles.filter(f => 
        f.webkitRelativePath.startsWith(mainImageDir)
      );
    } else {
      imageFiles = allImageFiles;
    }
  }
  
  // Sort audio files naturally (handle numbers properly)
  audioFiles.sort((a, b) => {
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
  
  // Intelligently separate track icons from cover images (same logic as ZIP)
  const trackIcons = [];
  let coverImage = null;
  
  // First, separate by naming pattern
  const numericImages = [];
  const nonNumericImages = [];
  
  imageFiles.forEach(f => {
    const fileName = f.name.split('/').pop();
    // Check if filename contains a number pattern (supports "01.png", "Icon 01.png", "icon_01.png", "icn3.png", etc.)
    // Extract the number to ensure proper sorting
    const numberMatch = fileName.match(/(\d+)\.(png|jpg|jpeg|gif|webp|bmp)$/i);
    if (numberMatch) {
      // Store the extracted number for sorting
      f.extractedNumber = parseInt(numberMatch[1]);
      numericImages.push(f);
    } else {
      nonNumericImages.push(f);
    }
  });
  
  // Sort numeric images by their extracted number
  numericImages.sort((a, b) => {
    return (a.extractedNumber || 0) - (b.extractedNumber || 0);
  });
  
  // Use numeric images as track icons
  if (numericImages.length > 0) {
    trackIcons.push(...numericImages);
  }
  
  // Find cover image from non-numeric images (typically the largest one)
  if (nonNumericImages.length > 0) {
    coverImage = nonNumericImages.reduce((largest, current) => {
      return (current.fileSize > largest.fileSize) ? current : largest;
    });
  }
  
  // If no non-numeric cover found, check for significantly larger image
  if (!coverImage && imageFiles.length > 0) {
    const avgSize = imageFiles.reduce((sum, f) => sum + f.fileSize, 0) / imageFiles.length;
    const largeImages = imageFiles.filter(f => f.fileSize > avgSize * 3);
    if (largeImages.length > 0) {
      coverImage = largeImages[0];
      // Remove cover from track icons if it was included
      const coverIndex = trackIcons.findIndex(f => f.name === coverImage.name);
      if (coverIndex !== -1) {
        trackIcons.splice(coverIndex, 1);
      }
    }
  }
  
  if (audioFiles.length === 0) {
    showNotification('No audio files found. Please ensure your folder contains audio files (.mp3, .m4a, .m4b, etc.).', 'error');
    return;
  }
  
  // Files processed successfully
  showNotification(`Folder processed: ${audioFiles.length} tracks, ${trackIcons.length} icons${coverImage ? ', 1 cover' : ''}`, 'success');
  
  // Show import modal with the files
  showImportModal(audioFiles, trackIcons, coverImage, folderName, 'folder');
}

async function processZipFile(file) {
  try {
    // JSZip is now loaded via manifest.json
    const zip = new JSZip();
    const contents = await zip.loadAsync(file);
    
    let folderName = file.name.replace(/\.zip$/i, '');
    
    const audioExtensions = ['m4a', 'mp3', 'mp4', 'm4b', 'wav', 'ogg', 'aac', 'flac'];
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
    
    // First, check if this ZIP contains other ZIP files
    let containsZipFiles = false;
    let zipFileCount = 0;
    const zipFiles = [];
    
    for (const [path, zipEntry] of Object.entries(contents.files)) {
      if (zipEntry.dir) continue;
      
      // Skip Mac metadata files
      if (path.includes('__MACOSX/') || path.includes('._')) {
        continue;
      }
      
      const fileName = path.split('/').pop();
      const ext = fileName.split('.').pop().toLowerCase();
      
      if (ext === 'zip') {
        containsZipFiles = true;
        zipFileCount++;
        zipFiles.push(fileName);
      }
    }
    
    // If this is a ZIP of ZIPs, show an informative message and redirect to bulk import
    if (containsZipFiles) {
      
      // Close any existing modals first
      const existingModal = document.querySelector('#yoto-import-modal');
      if (existingModal) existingModal.remove();
      
      // Create redirect notification modal
      const redirectModal = document.createElement('div');
      redirectModal.id = 'yoto-redirect-modal';
      redirectModal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
      `;
      
      redirectModal.innerHTML = `
        <div style="
          background: white;
          border-radius: 12px;
          padding: 32px;
          max-width: 450px;
          text-align: center;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
          animation: slideIn 0.3s ease-out;
        ">
          <div style="
            width: 64px;
            height: 64px;
            margin: 0 auto 20px;
            background: #fbbf24;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <svg width="32" height="32" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 style="
            margin: 0 0 16px;
            font-size: 24px;
            font-weight: 600;
            color: #1f2937;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          ">Collection Detected!</h2>
          <p style="
            margin: 0 0 8px;
            font-size: 16px;
            color: #4b5563;
            line-height: 1.5;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          ">
            This ZIP contains <strong>${zipFileCount} playlist${zipFileCount > 1 ? 's' : ''}</strong> (nested ZIP files).
          </p>
          <p style="
            margin: 0 0 24px;
            font-size: 16px;
            color: #4b5563;
            line-height: 1.5;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          ">
            Please use <strong>Bulk Import</strong> to import multiple playlists at once.
          </p>
          <div style="
            display: flex;
            gap: 12px;
            justify-content: center;
          ">
            <button id="redirect-now" style="
              padding: 10px 24px;
              background: #10b981;
              color: white;
              border: none;
              border-radius: 6px;
              font-size: 14px;
              font-weight: 500;
              cursor: pointer;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            ">Proceed to Bulk Import</button>
            <button id="redirect-cancel" style="
              padding: 10px 24px;
              background: #f3f4f6;
              color: #4b5563;
              border: none;
              border-radius: 6px;
              font-size: 14px;
              font-weight: 500;
              cursor: pointer;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            ">Cancel</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(redirectModal);
      
      // Add CSS animation
      const style = document.createElement('style');
      style.textContent = `
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `;
      document.head.appendChild(style);
      
      // No auto-redirect - user must click Proceed
      // Handle proceed button
      document.getElementById('redirect-now').addEventListener('click', () => {
        redirectModal.remove();
        showBulkImportOptionsModal();
      });
      
      // Handle cancel button
      document.getElementById('redirect-cancel').addEventListener('click', () => {
        redirectModal.remove();
      });
      
      return; // Exit early, don't process as single playlist
    }
    
    const allAudioFiles = [];
    const allImageFiles = [];
    const filesByPath = {};
    
    for (const [path, zipEntry] of Object.entries(contents.files)) {
      if (zipEntry.dir) continue;
      
      // Skip Mac metadata files
      if (path.includes('__MACOSX/') || path.includes('._')) {
        continue;
      }
      
      // Get the file extension and name
      const fileName = path.split('/').pop();
      const ext = fileName.split('.').pop().toLowerCase();
      
      // Skip non-media files (.txt, .DS_Store, etc.)
      if (!audioExtensions.includes(ext) && !imageExtensions.includes(ext)) {
        continue;
      }
      
      filesByPath[path] = zipEntry;
      
      // Collect audio files
      if (audioExtensions.includes(ext)) {
        const blob = await zipEntry.async('blob');
        const fileSize = blob.size;
        const file = new File([blob], fileName, { type: `audio/${ext}` });
        file.webkitRelativePath = path;
        file.fileSize = fileSize;
        allAudioFiles.push(file);
      }
      
      // Collect image files
      if (imageExtensions.includes(ext)) {
        const blob = await zipEntry.async('blob');
        const fileSize = blob.size;
        const file = new File([blob], fileName, { type: `image/${ext}` });
        file.webkitRelativePath = path;
        file.fileSize = fileSize;
        allImageFiles.push(file);
      }
    }
    
    let audioFiles = [];
    
    // 1. First, look for folders containing 'audio' in the name
    const audioFolderFiles = allAudioFiles.filter(f => 
      f.webkitRelativePath.toLowerCase().includes('/audio')
    );
    
    if (audioFolderFiles.length > 0) {
      audioFiles = audioFolderFiles;
    } 
    // 2. If not found, look for any folder with audio files
    else if (allAudioFiles.length > 0) {
      // Find the most common directory containing audio files
      const audioDirs = {};
      allAudioFiles.forEach(f => {
        const dir = f.webkitRelativePath.substring(0, f.webkitRelativePath.lastIndexOf('/'));
        audioDirs[dir] = (audioDirs[dir] || 0) + 1;
      });
      
      // Use files from the directory with most audio files
      const mainAudioDir = Object.keys(audioDirs).reduce((a, b) => 
        audioDirs[a] > audioDirs[b] ? a : b, ''
      );
      
      audioFiles = allAudioFiles.filter(f => 
        f.webkitRelativePath.startsWith(mainAudioDir)
      );
    }
    
    let imageFiles = [];
    
    // 1. First, look for folders containing 'images' or 'icons' in the name
    const imageFolderFiles = allImageFiles.filter(f => {
      const path = f.webkitRelativePath.toLowerCase();
      return path.includes('/image') || path.includes('/icon');
    });
    
    if (imageFolderFiles.length > 0) {
      imageFiles = imageFolderFiles;
    }
    // 2. If not found, look for any folder with image files
    else if (allImageFiles.length > 0) {
      // Find the most common directory containing image files
      const imageDirs = {};
      allImageFiles.forEach(f => {
        const dir = f.webkitRelativePath.substring(0, f.webkitRelativePath.lastIndexOf('/'));
        imageDirs[dir] = (imageDirs[dir] || 0) + 1;
      });
      
      // Use files from the directory with most image files
      const mainImageDir = Object.keys(imageDirs).reduce((a, b) => 
        imageDirs[a] > imageDirs[b] ? a : b, ''
      );
      
      imageFiles = allImageFiles.filter(f => 
        f.webkitRelativePath.startsWith(mainImageDir)
      );
    }
    
    // Sort audio files naturally (handle numbers properly)
    audioFiles.sort((a, b) => {
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
    
    // Intelligently separate track icons from cover images
    // Icons: small files with numeric names
    // Cover: larger file with non-numeric name
    const trackIcons = [];
    let coverImage = null;
    
    const numericImages = [];
    const nonNumericImages = [];
    
    imageFiles.forEach(f => {
      // Check if filename contains a number pattern (supports "01.png", "Icon 01.png", "icon_01.png", "icn3.png", etc.)
      // Extract the number to ensure proper sorting
      const numberMatch = f.name.match(/(\d+)\.(png|jpg|jpeg|gif|webp|bmp)$/i);
      if (numberMatch) {
        f.extractedNumber = parseInt(numberMatch[1]);
        numericImages.push(f);
      } else {
        nonNumericImages.push(f);
      }
    });
    
    numericImages.sort((a, b) => {
      return (a.extractedNumber || 0) - (b.extractedNumber || 0);
    });
    
    if (numericImages.length > 0) {
      trackIcons.push(...numericImages);
    }
    
    // Find cover image from non-numeric images (typically the largest one)
    if (nonNumericImages.length > 0) {
      coverImage = nonNumericImages.reduce((largest, current) => {
        return (current.fileSize > largest.fileSize) ? current : largest;
      });
    }
    
    if (!coverImage && imageFiles.length > 0) {
      const avgSize = imageFiles.reduce((sum, f) => sum + f.fileSize, 0) / imageFiles.length;
      const largeImages = imageFiles.filter(f => f.fileSize > avgSize * 3); // 3x larger than average
      if (largeImages.length > 0) {
        coverImage = largeImages[0];
        // Remove cover from track icons if it was included
        const coverIndex = trackIcons.findIndex(f => f.name === coverImage.name);
        if (coverIndex !== -1) {
          trackIcons.splice(coverIndex, 1);
        }
      }
    }
    
    if (audioFiles.length === 0) {
      showNotification('No audio files found in the ZIP. Please ensure your ZIP contains audio files (.mp3, .m4a, .m4b, etc.).', 'error');
      return;
    }
    
    // Files processed successfully
    showNotification(`ZIP processed: ${audioFiles.length} tracks, ${trackIcons.length} icons${coverImage ? ', 1 cover' : ''}`, 'success');
    
    // Show import modal with the extracted files
    showImportModal(audioFiles, trackIcons, coverImage, folderName, 'zip');
    
  } catch (error) {
    showNotification('Error processing file. Please check the file format.', 'error');
    showNotification('Failed to process ZIP file. Error: ' + error.message, 'error');
    // Track ZIP processing errors
    chrome.runtime.sendMessage({
      action: 'TRACK_ERROR',
      error: error.message || 'ZIP processing failed',
      context: {
        action: 'process_zip',
        component: 'content',
        authenticated: state.authenticated
      }
    });
  }
}

function selectBulkZipFile() {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.zip,application/zip,application/x-zip-compressed';
  fileInput.style.display = 'none';
  
  document.body.appendChild(fileInput);
  
  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    fileInput.remove();
    
    if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
      // Don't show notification here, the loading modal will handle it
      await processBulkZipFile(files[0]);
    } else if (files.length > 0) {
      showNotification('Please select a valid ZIP file', 'error');
    }
  });
  
  fileInput.click();
}

function selectBulkFolder() {
  const folderInput = document.createElement('input');
  folderInput.type = 'file';
  folderInput.webkitdirectory = true;
  folderInput.directory = true;
  folderInput.multiple = true;
  folderInput.style.display = 'none';
  
  document.body.appendChild(folderInput);
  
  folderInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    folderInput.remove();
    
    if (files.length > 0) {
      showNotification('Processing bulk folder...', 'info');
      await processBulkFolderFiles(files);
    }
  });
  
  folderInput.click();
}

async function processBulkZipFile(file) {
  // Create extraction loading modal
  const loadingModal = document.createElement('div');
  loadingModal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 20vh;
    z-index: 10001;
  `;
  
  const loadingContent = document.createElement('div');
  loadingContent.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 32px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    text-align: center;
    min-width: 320px;
  `;
  
  loadingContent.innerHTML = `
    <div style="margin-bottom: 20px;">
      <div style="
        width: 50px;
        height: 50px;
        border: 4px solid #e5e7eb;
        border-top-color: #3b82f6;
        border-radius: 50%;
        margin: 0 auto;
        animation: spin 1s linear infinite;
      "></div>
      <style>
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    </div>
    <h3 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 600; color: #1f2937;">Extracting Files...</h3>
    <p id="extraction-status" style="margin: 0 0 8px 0; color: #6b7280; font-size: 14px;">Opening ZIP archive...</p>
    <p id="extraction-details" style="margin: 0; color: #9ca3af; font-size: 13px;"></p>
  `;
  
  loadingModal.appendChild(loadingContent);
  document.body.appendChild(loadingModal);
  
  try {
    const statusElement = document.getElementById('extraction-status');
    const detailsElement = document.getElementById('extraction-details');
    
    statusElement.textContent = 'Loading ZIP file...';
    detailsElement.textContent = `File: ${file.name}`;
    
    const zip = new JSZip();
    const contents = await zip.loadAsync(file, {
      async: true
    });
    
    statusElement.textContent = 'Analyzing folder structure...';
    detailsElement.textContent = `Found ${Object.keys(contents.files).length} items`;
    
    const playlists = [];
    const processedPaths = new Set();
    
    // Identify playlist structures (nested ZIPs or folders)
    const nestedZips = [];
    const folders = new Map();
    const rootFiles = [];
    
    let maxDepth = 0;
    let hasMultipleTopLevelFolders = false;
    const topLevelFolders = new Set();
    
    for (const [path] of Object.entries(contents.files)) {
      if (path.includes('__MACOSX/') || path.includes('._') || path.includes('.DS_Store')) {
        continue;
      }
      const pathParts = path.split('/').filter(p => p);
      if (pathParts.length > 0) {
        topLevelFolders.add(pathParts[0]);
        maxDepth = Math.max(maxDepth, pathParts.length);
      }
    }
    
    hasMultipleTopLevelFolders = topLevelFolders.size > 1;
    const singleRootFolder = topLevelFolders.size === 1 ? Array.from(topLevelFolders)[0] : null;
    
    console.log(`Structure analysis: ${topLevelFolders.size} top-level folder(s), max depth: ${maxDepth}, single root: ${singleRootFolder}`);
    
    for (const [path, zipEntry] of Object.entries(contents.files)) {
      if (path.includes('__MACOSX/') || path.includes('._') || path.includes('.DS_Store')) {
        continue;
      }
      
      if (!zipEntry.dir && path.toLowerCase().endsWith('.zip')) {
        nestedZips.push({ path, zipEntry });
        processedPaths.add(path);
      }
      else if (!zipEntry.dir) {
        const pathParts = path.split('/').filter(p => p);
        
        if (pathParts.length > 1) {
          let folderName;
          
          // If there's only one top-level folder and it contains subfolders,
          // treat the subfolders as individual playlists
          if (singleRootFolder && pathParts.length > 2) {
            // Use the second-level folder (e.g., MAIN/Folder1/file.mp3 -> Folder1)
            folderName = pathParts[1];
          } else if (hasMultipleTopLevelFolders) {
            // Multiple top-level folders - each is a playlist
            folderName = pathParts[0];
          } else {
            // Single folder with files directly in it
            folderName = pathParts[0];
          }
          
          if (!folders.has(folderName)) {
            folders.set(folderName, []);
          }
          folders.get(folderName).push({ path, zipEntry });
          processedPaths.add(path);
        } else {
          rootFiles.push({ path, zipEntry });
        }
      }
    }
    
    console.log(`Bulk import analysis: ${nestedZips.length} nested ZIPs, ${folders.size} folders, ${rootFiles.length} root files`);
    
    if (nestedZips.length > 0) {
      statusElement.textContent = 'Extracting playlists...';
      detailsElement.textContent = `Found ${nestedZips.length} playlist${nestedZips.length > 1 ? 's' : ''}`;
    }
    
    // Process nested ZIP files
    const failedZips = [];
    for (let i = 0; i < nestedZips.length; i++) {
      const { path, zipEntry } = nestedZips[i];
      
      if (statusElement) {
        statusElement.textContent = `Extracting playlist ${i + 1} of ${nestedZips.length}...`;
        const playlistName = path.replace(/\.zip$/i, '').split('/').pop();
        detailsElement.textContent = playlistName;
      }
      
      try {
        const nestedZipBlob = await zipEntry.async('blob');
        console.log(`Processing nested ZIP: ${path}, size: ${nestedZipBlob.size} bytes`);
        
        const nestedZip = new JSZip();
        const nestedContents = await nestedZip.loadAsync(nestedZipBlob);
        
        // Log the contents of the nested ZIP for debugging
        const nestedFileCount = Object.keys(nestedContents.files).length;
        console.log(`Nested ZIP ${path} contains ${nestedFileCount} entries`);
        
        const playlistName = path.replace(/\.zip$/i, '').split('/').pop();
        
        const playlist = await extractPlaylistFromZip(nestedContents, playlistName);
        
        if (playlist && playlist.audioFiles.length > 0) {
          console.log(`Successfully extracted ${playlist.audioFiles.length} audio files from ${playlistName}`);
          playlists.push(playlist);
        } else {
          // Log detailed info about what was in the ZIP to help diagnose issues
          const fileList = Object.keys(nestedContents.files).filter(f => !nestedContents.files[f].dir);
          console.warn(`No audio files found in nested ZIP: ${playlistName}. Files in ZIP: ${fileList.join(', ')}`);
          failedZips.push({ name: playlistName, reason: 'No audio files found' });
        }
      } catch (error) {
        console.error('Error processing nested ZIP:', path, error);
        const playlistName = path.replace(/\.zip$/i, '').split('/').pop();
        failedZips.push({ name: playlistName, reason: error.message || 'Failed to extract' });
      }
    }
    
    if (failedZips.length > 0) {
      const failedNames = failedZips.map(f => `${f.name} (${f.reason})`).join(', ');
      
      if (nestedZips.length > 0 && failedZips.length === nestedZips.length) {
        showNotification(`Failed to extract playlists from ZIP files. ${failedNames}. Please ensure each nested ZIP contains audio files.`, 'error');
        
        loadingModal.remove();
        return;
      } else if (failedZips.length > 0) {
        showNotification(`Warning: Failed to process ${failedZips.length} ZIP file(s): ${failedNames}`, 'warning');
      }
    }
    
    // Process folders as individual playlists
    if (folders.size > 0 && statusElement) {
      statusElement.textContent = 'Processing folders...';
      detailsElement.textContent = `Found ${folders.size} folder${folders.size > 1 ? 's' : ''}`;
    }
    
    let folderIndex = 0;
    for (const [folderName, files] of folders) {
      folderIndex++;
      if (statusElement) {
        statusElement.textContent = `Processing folder ${folderIndex} of ${folders.size}...`;
        detailsElement.textContent = folderName;
      }
      const playlist = await extractPlaylistFromFiles(files, folderName, contents);
      if (playlist && playlist.audioFiles.length > 0) {
        playlists.push(playlist);
      }
    }
    
    // For bulk import, only create a single playlist if:
    // 1. There were NO nested ZIPs (the expected bulk structure)
    // 2. There were NO folders (another expected bulk structure)
    // 3. There ARE root-level audio files (edge case: flat ZIP with audio files)
    if (playlists.length === 0 && nestedZips.length === 0 && folders.size === 0 && rootFiles.length > 0) {
      console.log('No nested structure found (no ZIPs or folders), processing root files as single playlist');
      
      const playlist = await extractPlaylistFromFiles(rootFiles, file.name.replace(/\.zip$/i, ''), contents);
      if (playlist && playlist.audioFiles.length > 0) {
        showNotification('Note: Found audio files at root level. Processing as single playlist. For bulk import, organize files into folders or separate ZIPs.', 'warning');
        playlists.push(playlist);
      }
    }
    
    loadingModal.remove();
    
    if (playlists.length === 0) {
      if (nestedZips.length > 0) {
        showNotification('No valid playlists could be extracted from the nested ZIP files. Please ensure each ZIP contains audio files.', 'error');
      } else if (folders.size > 0) {
        showNotification('No valid audio files found in the folders. Please ensure folders contain audio files.', 'error');
      } else {
        showNotification('No valid playlists found. For bulk import, upload a ZIP containing multiple playlist ZIPs or folders.', 'error');
      }
      return;
    }
    
    const sourceType = nestedZips.length > 0 ? 'ZIP file' : 'folder';
    const sourcePlural = playlists.length > 1 ? 's' : '';
    showNotification(`Successfully extracted ${playlists.length} playlist${sourcePlural} from ${sourceType}${sourcePlural}. Preparing import...`, 'success');
    showBulkImportModal(playlists);
    
  } catch (error) {
    if (loadingModal && loadingModal.parentNode) {
      loadingModal.remove();
    }
    showNotification('Error processing bulk ZIP file: ' + error.message, 'error');
    chrome.runtime.sendMessage({
      action: 'TRACK_ERROR',
      error: error.message || 'Bulk ZIP processing failed',
      context: {
        action: 'process_bulk_zip',
        component: 'content',
        authenticated: state.authenticated
      }
    });
  }
}

async function processBulkFolderFiles(files) {
  try {
    const playlists = [];
    
    // Group files by their immediate parent folder
    const folderMap = new Map();
    
    for (const file of files) {
      if (file.webkitRelativePath) {
        const pathParts = file.webkitRelativePath.split('/');
        
        // The first part is the root folder selected, subsequent parts are subfolders
        // We want to group by the immediate subfolder (second level)
        if (pathParts.length < 2) continue;
        
        // If there's only one level (files directly in selected folder), use root as playlist
        const playlistFolder = pathParts.length === 2 ? pathParts[0] : pathParts[1];
        
        if (!folderMap.has(playlistFolder)) {
          folderMap.set(playlistFolder, []);
        }
        folderMap.get(playlistFolder).push(file);
      }
    }
    
    // Process each folder as a playlist
    for (const [folderName, folderFiles] of folderMap) {
      const playlist = await extractPlaylistFromFolderFiles(folderFiles, folderName);
      if (playlist && playlist.audioFiles.length > 0) {
        playlists.push(playlist);
      }
    }
    
    if (playlists.length === 0) {
      showNotification('No valid playlists found in the selected folder', 'error');
      return;
    }
    
    showNotification(`Found ${playlists.length} playlist${playlists.length > 1 ? 's' : ''}. Preparing import...`, 'success');
    showBulkImportModal(playlists);
    
  } catch (error) {
    showNotification('Error processing bulk folder: ' + error.message, 'error');
    chrome.runtime.sendMessage({
      action: 'TRACK_ERROR',
      error: error.message || 'Bulk folder processing failed',
      context: {
        action: 'process_bulk_folder',
        component: 'content',
        authenticated: state.authenticated
      }
    });
  }
}

async function extractPlaylistFromZip(zipContents, playlistName) {
  
  const audioExtensions = ['m4a', 'mp3', 'mp4', 'm4b', 'wav', 'ogg', 'aac', 'flac'];
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
  
  const allAudioFiles = [];
  const allImageFiles = [];
  let skippedFiles = 0;
  let totalFiles = 0;
  
  // Extract all files first
  for (const [path, zipEntry] of Object.entries(zipContents.files)) {
    if (zipEntry.dir) {
      continue;
    }
    
    totalFiles++;
    
    // Skip Mac metadata files
    if (path.includes('__MACOSX/') || path.includes('._') || path.includes('.DS_Store')) {
      skippedFiles++;
      continue;
    }
    
    const fileName = path.split('/').pop();
    const ext = fileName.split('.').pop().toLowerCase();
    
    // Skip non-media files
    if (!audioExtensions.includes(ext) && !imageExtensions.includes(ext)) {
      skippedFiles++;
      console.log(`Skipping non-media file in ${playlistName}: ${fileName} (extension: ${ext})`);
      continue;
    }
    
    if (audioExtensions.includes(ext)) {
      try {
        const blob = await zipEntry.async('blob');
        const file = new File([blob], fileName, { type: `audio/${ext}` });
        file.webkitRelativePath = path;
        file.fileSize = blob.size;
        file.size = blob.size; // Ensure both size properties are set
        allAudioFiles.push(file);
      } catch (err) {
        console.error(`[Extract ZIP] Failed to extract audio file ${path}:`, err);
      }
    } else if (imageExtensions.includes(ext)) {
      try {
        const blob = await zipEntry.async('blob');
        const file = new File([blob], fileName, { type: `image/${ext}` });
        file.webkitRelativePath = path;
        file.fileSize = blob.size;
        file.size = blob.size; // Ensure both size properties are set
        allImageFiles.push(file);
      } catch (err) {
        console.error(`[Extract ZIP] Failed to extract image file ${path}:`, err);
      }
    }
  }
  
  // Smart audio folder detection (same as processZipFile)
  let audioFiles = [];
  
  // 1. First, look for folders containing 'audio' in the name
  const audioFolderFiles = allAudioFiles.filter(f => 
    f.webkitRelativePath.toLowerCase().includes('/audio')
  );
  
  if (audioFolderFiles.length > 0) {
    audioFiles = audioFolderFiles;
  } 
  // 2. If not found, use all audio files found
  else if (allAudioFiles.length > 0) {
    audioFiles = allAudioFiles;
  }
  
  // Smart image folder detection
  let imageFiles = [];
  
  // 1. First, look for folders containing 'images' or 'icons' in the name
  const imageFolderFiles = allImageFiles.filter(f => {
    const path = f.webkitRelativePath.toLowerCase();
    return path.includes('/image') || path.includes('/icon');
  });
  
  if (imageFolderFiles.length > 0) {
    imageFiles = imageFolderFiles;
  } else if (allImageFiles.length > 0) {
    imageFiles = allImageFiles;
  }
  
  // Sort audio files naturally
  audioFiles.sort((a, b) => {
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
  
  // Separate track icons from cover image
  const { trackIcons, coverImage } = separateImagesIntelligently(imageFiles);

  console.log(`Playlist ${playlistName} summary: ${totalFiles} total files, ${audioFiles.length} audio, ${imageFiles.length} images, ${skippedFiles} skipped`);

  return {
    name: playlistName,
    audioFiles,
    trackIcons,
    coverImage
  };
}

async function extractPlaylistFromFiles(files, playlistName, zipContents) {
  const audioExtensions = ['m4a', 'mp3', 'mp4', 'm4b', 'wav', 'ogg', 'aac', 'flac'];
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
  
  const audioFiles = [];
  const imageFiles = [];
  
  for (const { path, zipEntry } of files) {
    const fileName = path.split('/').pop();
    const ext = fileName.split('.').pop().toLowerCase();
    
    if (audioExtensions.includes(ext)) {
      const blob = await zipEntry.async('blob');
      const file = new File([blob], fileName, { type: `audio/${ext}` });
      file.webkitRelativePath = path;
      file.fileSize = blob.size;
      audioFiles.push(file);
    } else if (imageExtensions.includes(ext)) {
      const blob = await zipEntry.async('blob');
      const file = new File([blob], fileName, { type: `image/${ext}` });
      file.webkitRelativePath = path;
      file.fileSize = blob.size;
      imageFiles.push(file);
    }
  }
  
  // Sort audio files naturally
  audioFiles.sort((a, b) => {
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
  
  // Separate track icons from cover image
  const { trackIcons, coverImage } = separateImagesIntelligently(imageFiles);
  
  return {
    name: playlistName,
    audioFiles,
    trackIcons,
    coverImage
  };
}

async function extractPlaylistFromFolderFiles(files, playlistName) {
  const audioExtensions = ['m4a', 'mp3', 'mp4', 'm4b', 'wav', 'ogg', 'aac', 'flac'];
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
  
  const audioFiles = [];
  const imageFiles = [];
  
  for (const file of files) {
    const ext = file.name.split('.').pop().toLowerCase();
    
    // Skip metadata files
    if (file.name.startsWith('._') || file.name === '.DS_Store' || file.name === 'Thumbs.db') {
      continue;
    }
    
    if (audioExtensions.includes(ext)) {
      file.fileSize = file.size;
      audioFiles.push(file);
    } else if (imageExtensions.includes(ext)) {
      file.fileSize = file.size;
      imageFiles.push(file);
    }
  }
  
  // Sort audio files naturally
  audioFiles.sort((a, b) => {
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
  
  // Separate track icons from cover image
  const { trackIcons, coverImage } = separateImagesIntelligently(imageFiles);
  
  return {
    name: playlistName,
    audioFiles,
    trackIcons,
    coverImage
  };
}

function separateImagesIntelligently(imageFiles) {
  
  const trackIcons = [];
  let coverImage = null;
  
  // First, separate by naming pattern
  const numericImages = [];
  const nonNumericImages = [];
  
  imageFiles.forEach(f => {
    const fileName = f.name.split('/').pop();
    // Check if filename contains a number pattern - more flexible pattern
    // Matches: "01.png", "Icon 01.png", "icon_01.png", "icn3.png", etc.
    const numberMatch = fileName.match(/(\d+)\.(png|jpg|jpeg|gif|webp|bmp)$/i);
    
    // Check for common cover image names (including cover_image.png style)
    const lowerFileName = fileName.toLowerCase();
    const isCoverName = lowerFileName.includes('cover') || 
                        lowerFileName.includes('album') || 
                        lowerFileName.includes('art') ||
                        lowerFileName === 'folder.jpg' ||
                        lowerFileName === 'folder.png';
    
    if (isCoverName) {
      nonNumericImages.push(f);
    } else if (numberMatch) {
      f.extractedNumber = parseInt(numberMatch[1]);
      numericImages.push(f);
    } else {
      nonNumericImages.push(f);
    }
  });
  
  // Sort numeric images by their extracted number
  numericImages.sort((a, b) => {
    return (a.extractedNumber || 0) - (b.extractedNumber || 0);
  });
  
  // Use numeric images as track icons
  if (numericImages.length > 0) {
    trackIcons.push(...numericImages);
  }
  
  // Find cover image from non-numeric images (typically the largest one)
  if (nonNumericImages.length > 0) {
    const namedCovers = nonNumericImages.filter(f => {
      const name = f.name.toLowerCase();
      return name.includes('cover') || name.includes('album') || name.includes('artwork') || name.includes('front');
    });
    
    if (namedCovers.length > 0) {
      coverImage = namedCovers.reduce((largest, current) => {
        return (current.fileSize > largest.fileSize) ? current : largest;
      });
    } else {
      // Otherwise use the largest non-numeric image
      coverImage = nonNumericImages.reduce((largest, current) => {
        return (current.fileSize > largest.fileSize) ? current : largest;
      });
    }
  }
  
  // If no non-numeric cover found, check for significantly larger image among all images
  if (!coverImage && imageFiles.length > 0) {
    const avgSize = imageFiles.reduce((sum, f) => sum + f.fileSize, 0) / imageFiles.length;
    const largeImages = imageFiles.filter(f => f.fileSize > avgSize * 2.5); // Lowered threshold from 3x to 2.5x
    if (largeImages.length > 0) {
      // Sort by size and take the largest
      largeImages.sort((a, b) => b.fileSize - a.fileSize);
      coverImage = largeImages[0];
      
      // Remove cover from track icons if it was included
      const coverIndex = trackIcons.findIndex(f => f.name === coverImage.name);
      if (coverIndex !== -1) {
        trackIcons.splice(coverIndex, 1);
      }
    }
  }
  
  
  return { trackIcons, coverImage };
}

function showNotification(message, type = 'info') {
  // Remove existing notification
  const existing = document.querySelector('.yoto-magic-notification');
  if (existing) existing.remove();
  
  const notification = document.createElement('div');
  notification.className = 'yoto-magic-notification';
  
  const bgColor = type === 'error' ? 'bg-red-500' : type === 'success' ? 'bg-green-500' : 'bg-blue-500';
  
  notification.className = `fixed bottom-4 right-4 ${bgColor} text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-slide-up`;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 5000);
}

function setupNavigationListener() {
  // Listen for popstate events (back/forward navigation)
  window.addEventListener('popstate', () => {
    const path = window.location.pathname;
    if (path.includes('/my-cards/playlists') || path === '/my-cards' || path === '/my-cards/') {
      // Small delay to let the page update
      setTimeout(() => {
        checkForMyoPage();
      }, 100);
    }
  });
  
  // Also listen for pushstate/replacestate for SPA navigation
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  
  history.pushState = function() {
    originalPushState.apply(history, arguments);
    setTimeout(() => {
      checkForMyoPage();
    }, 100);
  };
  
  history.replaceState = function() {
    originalReplaceState.apply(history, arguments);
    setTimeout(() => {
      checkForMyoPage();
    }, 100);
  };
}


// Set up mutation observer
function setupObserver() {
  if (state.observer) return;
  
  state.observer = new MutationObserver((mutations) => {
    // Check if we've navigated to a MYO page
    const currentPath = window.location.pathname;
    if (currentPath.includes('/my-cards/playlists') || 
        currentPath === '/my-cards' || 
        currentPath === '/my-cards/') {
      checkForMyoPage();
    } else if (currentPath.includes('/card/')) {
      state.isMyoPage = false;
    }
  });
  
  state.observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}


// Add CSS for animations
function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slide-up {
      from {
        transform: translateY(100%);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }
    
    .animate-slide-up {
      animation: slide-up 0.3s ease-out;
    }
    
    @keyframes spin {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }
    
    .animate-spin {
      animation: spin 1s linear infinite;
    }
  `;
  document.head.appendChild(style);
}

function cleanTrackTitle(filename) {
  
  let title = filename;
  
  const audioExtensions = /\.(mp3|m4a|m4b|wav|ogg|aac|flac|mp4)$/i;
  if (audioExtensions.test(title)) {
    title = title.replace(audioExtensions, '');
  } else {
  }
  
  title = title.replace(/_/g, '');
  
  
  title = title.replace(/^\d+[\.\-\s]*/g, '');
  
  title = title.replace(/\s+/g, ' ');
  
  title = title.trim();
  
  if (!title || title.length === 0) {
    title = filename.replace(audioExtensions, '');
  }
  
  
  return title;
}

// Utility function for chunked parallel uploads (optimized)
async function uploadInChunks(items, uploadFn, chunkSize = 8, onProgress) {
  const results = [];
  const totalItems = items.length;
  let completedItems = 0;
  
  // Increased chunk size for better parallelization
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkPromises = chunk.map((item, index) => 
      uploadFn(item, i + index).then(result => {
        completedItems++;
        if (onProgress) {
          onProgress(completedItems, totalItems);
        }
        return result;
      }).catch(error => {
        completedItems++;
        if (onProgress) {
          onProgress(completedItems, totalItems);
        }
        return { status: 'rejected', reason: error };
      })
    );
    
    const chunkResults = await Promise.allSettled(chunkPromises);
    results.push(...chunkResults);
  }
  
  return results;
}

// Utility function for parallel uploads with retry
async function uploadWithRetry(uploadFn, maxRetries = 3, retryDelay = 1000, timeoutMs = 60000) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      
      // Increased timeout to 60 seconds by default, can be overridden
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Upload timeout after ${timeoutMs/1000} seconds`)), timeoutMs)
      );
      
      const result = await Promise.race([uploadFn(), timeoutPromise]);
      return { status: 'fulfilled', value: result };
    } catch (error) {
      console.error(`[Upload Retry] Attempt ${attempt + 1} failed:`, error.message);
      if (attempt === maxRetries - 1) {
        console.error(`[Upload Retry] All ${maxRetries} attempts failed`);
        return { status: 'rejected', reason: error };
      }
      // Exponential backoff
      const delay = retryDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Show bulk import modal
function showBulkImportModal(playlists) {
  // Remove existing modal if any
  const existing = document.querySelector('#yoto-bulk-import-modal');
  if (existing) existing.remove();
  
  const modal = document.createElement('div');
  modal.id = 'yoto-bulk-import-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    z-index: 99999;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10vh;
    animation: fadeIn 0.3s ease;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 30px;
    max-width: 900px;
    max-height: 85vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  `;
  
  // Generate playlist previews
  const playlistPreviews = playlists.map((playlist, index) => `
    <div style="
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
      background: #f9fafb;
    ">
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
        <input type="checkbox" id="playlist-${index}" checked style="width: 18px; height: 18px;">
        <input type="text" id="playlist-name-${index}" value="${playlist.name}" style="
          flex: 1;
          padding: 6px 10px;
          border: 1px solid #d1d5db;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
        ">
      </div>
      <div style="color: #6b7280; font-size: 13px; padding-left: 30px;">
        ${playlist.audioFiles.length} tracks${playlist.trackIcons.length > 0 ? `, ${playlist.trackIcons.length} icons` : ''}${playlist.coverImage ? ', cover image' : ''}
      </div>
    </div>
  `).join('');
  
  content.innerHTML = `
    <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">Bulk Import Playlists</h2>
    <div style="margin-bottom: 20px; color: #666;">
      <p>Found ${playlists.length} playlist${playlists.length > 1 ? 's' : ''} ready to import:</p>
    </div>
    
    <div style="margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <label style="font-weight: 500; margin-right: 16px;">Select playlists to import:</label>
        <div style="display: flex; gap: 8px;">
          <button id="select-all" style="
            padding: 4px 12px;
            background: #f3f4f6;
            border: 1px solid #d1d5db;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
          ">Select All</button>
          <button id="deselect-all" style="
            padding: 4px 12px;
            background: #f3f4f6;
            border: 1px solid #d1d5db;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
          ">Deselect All</button>
        </div>
      </div>
      <div style="max-height: 300px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px;">
        ${playlistPreviews}
      </div>
    </div>
    
    <div id="bulk-import-progress" style="display: none; margin: 20px 0;">
      <div style="margin-bottom: 12px;">
        <p id="overall-status" style="color: #666; font-size: 14px; margin-bottom: 8px;">Overall Progress:</p>
        <div style="background: #f0f0f0; border-radius: 4px; height: 8px; overflow: hidden;">
          <div id="overall-progress-bar" style="background: #10b981; height: 100%; width: 0%; transition: width 0.3s;"></div>
        </div>
      </div>
      <div style="margin-top: 16px;">
        <p id="current-playlist-status" style="color: #666; font-size: 14px; margin-bottom: 8px;">Current Playlist:</p>
        <div style="background: #f0f0f0; border-radius: 4px; height: 8px; overflow: hidden;">
          <div id="current-progress-bar" style="background: #3b82f6; height: 100%; width: 0%; transition: width 0.3s;"></div>
        </div>
      </div>
      <div id="import-log" style="
        margin-top: 16px;
        padding: 12px;
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        max-height: 150px;
        overflow-y: auto;
        font-size: 13px;
        font-family: monospace;
        color: #4b5563;
      "></div>
    </div>
    
    <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 30px;">
      <button id="cancel-bulk-import" style="
        padding: 10px 20px;
        background: #f3f4f6;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">Cancel</button>
      <button id="start-bulk-import" style="
        padding: 10px 20px;
        background: #10b981;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">Start Bulk Import</button>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  // Event handlers for select/deselect all
  document.querySelector('#select-all').onclick = () => {
    playlists.forEach((_, index) => {
      const checkbox = document.querySelector(`#playlist-${index}`);
      if (checkbox) checkbox.checked = true;
    });
  };
  
  document.querySelector('#deselect-all').onclick = () => {
    playlists.forEach((_, index) => {
      const checkbox = document.querySelector(`#playlist-${index}`);
      if (checkbox) checkbox.checked = false;
    });
  };
  
  // Prevent input clicks from bubbling
  playlists.forEach((_, index) => {
    const nameInput = document.querySelector(`#playlist-name-${index}`);
    if (nameInput) {
      nameInput.onclick = (e) => e.stopPropagation();
      nameInput.onkeydown = (e) => e.stopPropagation();
    }
  });
  
  // Cancel button
  document.querySelector('#cancel-bulk-import').onclick = () => modal.remove();
  
  // Start bulk import
  document.querySelector('#start-bulk-import').onclick = async () => {
    // Get selected playlists
    const selectedPlaylists = [];
    playlists.forEach((playlist, index) => {
      const checkbox = document.querySelector(`#playlist-${index}`);
      const nameInput = document.querySelector(`#playlist-name-${index}`);
      if (checkbox && checkbox.checked) {
        selectedPlaylists.push({
          ...playlist,
          name: nameInput ? nameInput.value : playlist.name
        });
      }
    });
    
    if (selectedPlaylists.length === 0) {
      showNotification('Please select at least one playlist to import', 'error');
      return;
    }
    
    // Start the bulk import process
    await processBulkImport(selectedPlaylists, modal);
  };
}

async function processBulkImport(playlists, modal) {
  // Check if extension context is valid before starting
  if (!chrome.runtime?.id) {
    showNotification('Extension connection lost. Please refresh the page and try again.', 'error');
    modal.remove();
    return;
  }
  
  const progressDiv = document.querySelector('#bulk-import-progress');
  const overallProgressBar = document.querySelector('#overall-progress-bar');
  const currentProgressBar = document.querySelector('#current-progress-bar');
  const overallStatus = document.querySelector('#overall-status');
  const currentStatus = document.querySelector('#current-playlist-status');
  const importLog = document.querySelector('#import-log');
  const startButton = document.querySelector('#start-bulk-import');
  const cancelButton = document.querySelector('#cancel-bulk-import');
  
  const playlistSelectionArea = document.querySelector('#bulk-import-progress').previousElementSibling;
  if (playlistSelectionArea) {
    playlistSelectionArea.style.display = 'none';
  }
  
  const foundPlaylistsText = document.querySelector('#bulk-import-progress').parentElement.querySelector('div[style*="margin-bottom: 20px; color: #666;"]');
  if (foundPlaylistsText) {
    foundPlaylistsText.style.display = 'none';
  }
  
  progressDiv.style.display = 'block';
  startButton.disabled = true;
  startButton.style.opacity = '0.5';
  startButton.style.cursor = 'not-allowed';
  cancelButton.textContent = 'Close';
  
  const totalPlaylists = playlists.length;
  let completedPlaylists = 0;
  let successfulImports = 0;
  let failedImports = 0;
  
  // Add log entry
  function addLogEntry(message, type = 'info') {
    const entry = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString();
    const color = type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#6b7280';
    entry.style.cssText = `color: ${color}; margin-bottom: 4px;`;
    entry.textContent = `[${timestamp}] ${message}`;
    importLog.appendChild(entry);
    importLog.scrollTop = importLog.scrollHeight;
  }
  
  addLogEntry(`Starting bulk import of ${totalPlaylists} playlist${totalPlaylists > 1 ? 's' : ''}...`);
  
  // Process each playlist
  for (const playlist of playlists) {
    const playlistNumber = completedPlaylists + 1;
    overallStatus.textContent = `Overall Progress: ${playlistNumber}/${totalPlaylists} playlists`;
    currentStatus.textContent = `Importing: ${playlist.name}`;
    currentProgressBar.style.width = '0%';
    
    addLogEntry(`Starting import of "${playlist.name}"...`);
    
    try {
      // Import the playlist using the same logic as single import
      await importSinglePlaylist(
        playlist.audioFiles,
        playlist.trackIcons,
        playlist.coverImage,
        playlist.name,
        (progress, status) => {
          currentProgressBar.style.width = `${progress}%`;
          if (status) {
            currentStatus.textContent = `${playlist.name}: ${status}`;
          }
        }
      );
      
      successfulImports++;
      addLogEntry(`✓ Successfully imported "${playlist.name}"`, 'success');
      
    } catch (error) {
      failedImports++;
      const errorMessage = error.message || 'Unknown error';
      addLogEntry(`✗ Failed to import "${playlist.name}": ${errorMessage}`, 'error');
      
      // Track error (wrapped in try-catch in case extension context is lost)
      try {
        if (chrome.runtime?.id) {
          chrome.runtime.sendMessage({
            action: 'TRACK_ERROR',
            error: errorMessage,
            context: {
              action: 'bulk_import_playlist',
              playlistName: playlist.name,
              component: 'content'
            }
          });
        }
      } catch (trackError) {
        console.error('Failed to track error:', trackError);
      }
      
      // If extension context is lost, stop processing
      if (errorMessage.includes('Extension context') || errorMessage.includes('chrome.runtime')) {
        addLogEntry('⚠️ Extension connection lost. Please refresh the page and try again.', 'error');
        break;
      }
    }
    
    completedPlaylists++;
    const overallProgress = (completedPlaylists / totalPlaylists) * 100;
    overallProgressBar.style.width = `${overallProgress}%`;
  }
  
  // Final status
  overallStatus.textContent = `Import Complete: ${successfulImports} successful, ${failedImports} failed`;
  currentStatus.textContent = '';
  currentProgressBar.style.width = '0%';
  
  if (successfulImports > 0 && failedImports === 0) {
    addLogEntry(`✓ All ${successfulImports} playlist${successfulImports > 1 ? 's' : ''} imported successfully!`, 'success');
    showNotification(`Successfully imported ${successfulImports} playlist${successfulImports > 1 ? 's' : ''}!`, 'success');
  } else if (successfulImports > 0) {
    addLogEntry(`Import completed with ${successfulImports} success${successfulImports > 1 ? 'es' : ''} and ${failedImports} failure${failedImports > 1 ? 's' : ''}`, 'info');
    showNotification(`Imported ${successfulImports} playlist${successfulImports > 1 ? 's' : ''}, ${failedImports} failed`, 'warning');
  } else {
    addLogEntry(`✗ All imports failed`, 'error');
    showNotification(`Failed to import all playlists`, 'error');
  }
  
  // Track bulk import analytics (wrapped in try-catch)
  try {
    if (chrome.runtime?.id) {
      chrome.runtime.sendMessage({
        action: 'TRACK_EVENT',
        eventName: 'bulk_import_complete',
        parameters: {
          category: 'import',
          label: 'bulk',
          value: successfulImports,
          totalAttempted: totalPlaylists,
          failed: failedImports
        }
      });
    }
  } catch (error) {
    console.error('Failed to track analytics:', error);
  }
  
  // Show success modal and auto-refresh if successful
  if (successfulImports > 0) {
    const successModal = document.createElement('div');
    successModal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 20vh;
      z-index: 10002;
    `;
    
    const successContent = document.createElement('div');
    successContent.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      text-align: center;
      min-width: 300px;
    `;
    
    successContent.innerHTML = `
      <div style="margin-bottom: 16px;">
        <svg style="width: 48px; height: 48px; color: #10b981; margin: 0 auto;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
      </div>
      <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 600; color: #1f2937;">Import Successful!</h3>
      <p style="margin: 0; color: #6b7280; font-size: 14px;">Refreshing page to show new playlists...</p>
    `;
    
    successModal.appendChild(successContent);
    
    // Remove the bulk import modal
    modal.remove();
    
    // Show success modal
    document.body.appendChild(successModal);
    
    // Auto-refresh after brief delay
    setTimeout(() => {
      window.location.reload();
    }, 1500);
  } else {
    // Enable close button for failure case
    cancelButton.style.opacity = '1';
    cancelButton.onclick = () => {
      modal.remove();
    };
  }
}

async function importSinglePlaylist(audioFiles, trackIcons, coverImage, playlistName, progressCallback) {
  
  
  // Check if extension context is still valid
  if (!chrome.runtime?.id) {
    throw new Error('Extension context lost. Please refresh the page and try again.');
  }
  
  // Log file details for debugging
  if (audioFiles.length === 0) {
    console.error(`[Bulk Import] No audio files for "${playlistName}"`);
    throw new Error('No audio files to upload');
  }
  
  // Calculate total size and determine upload strategy
  const totalSize = audioFiles.reduce((sum, f) => sum + (f.size || f.fileSize || 0), 0);
  const avgFileSize = totalSize / audioFiles.length;
  const totalSizeMB = totalSize / (1024 * 1024);
  
  
  // Determine parallel upload count based on file characteristics
  let parallelCount = 1;
  let delayBetweenBatches = 500;
  
  if (avgFileSize < 5 * 1024 * 1024) { // Average < 5MB
    if (audioFiles.length <= 10) {
      parallelCount = 3; // Small playlist, small files - more parallel
      delayBetweenBatches = 200;
    } else {
      parallelCount = 2; // Many small files - moderate parallel
      delayBetweenBatches = 300;
    }
  } else if (avgFileSize < 15 * 1024 * 1024) { // Average < 15MB
    parallelCount = 2; // Medium files - moderate parallel
    delayBetweenBatches = 400;
  } else {
    parallelCount = 1; // Large files - sequential
    delayBetweenBatches = 500;
  }
  
  
  progressCallback(10, 'Uploading audio files...');
  
  // Process audio files with controlled parallelism
  const uploadedTracks = [];
  const audioResults = [];
  
  for (let batchStart = 0; batchStart < audioFiles.length; batchStart += parallelCount) {
    const batch = audioFiles.slice(batchStart, Math.min(batchStart + parallelCount, audioFiles.length));
    const batchPromises = [];
    
    for (let i = 0; i < batch.length; i++) {
      const file = batch[i];
      const globalIndex = batchStart + i;
      const progress = 10 + (globalIndex / audioFiles.length) * 30; // Progress from 10% to 40%
      progressCallback(Math.round(progress), `Uploading audio ${globalIndex + 1}/${audioFiles.length}...`);
      
      
      // Upload with retry and longer timeout for larger files
      const fileSize = file.size || file.fileSize || 0;
      const timeoutMs = fileSize > 10 * 1024 * 1024 ? 120000 : 60000; // 2 min for files > 10MB, else 1 min
      
      const uploadPromise = uploadWithRetry(async () => {
        // Check context before each upload
        if (!chrome.runtime?.id) {
          throw new Error('Extension context lost during upload.');
        }
        
        // Convert file to base64 format expected by service worker
        let base64Data;
        try {
          base64Data = await convertFileToBase64(file);
        } catch (convError) {
          console.error(`[Bulk Import] Failed to convert ${file.name} to base64:`, convError);
          throw new Error(`Failed to convert ${file.name}: ${convError.message}`);
        }
        
        const uploadResult = await chrome.runtime.sendMessage({
          action: 'UPLOAD_AUDIO',
          file: base64Data
        });
        
        if (!uploadResult) {
          console.error(`[Bulk Import] No response for ${file.name}`);
          throw new Error('No response from extension. Please refresh and try again.');
        }
        
        if (uploadResult.error) {
          console.error(`[Bulk Import] Upload failed for ${file.name}:`, uploadResult.error);
          throw new Error(`Audio upload failed: ${uploadResult.error}`);
        }
        
        
        // Clean track title
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
        const cleanedTitle = cleanTrackTitle(nameWithoutExt);
        
        return {
          title: cleanedTitle,
          originalIndex: globalIndex,
          transcodedAudio: uploadResult.transcodedAudio
        };
      }, 3, 1000, timeoutMs);
      
      batchPromises.push(uploadPromise);
    }
    
    // Wait for all uploads in this batch to complete
    const batchResults = await Promise.all(batchPromises);
    
    // Process results
    for (const result of batchResults) {
      audioResults.push(result);
      if (result.status === 'fulfilled') {
        uploadedTracks[result.value.originalIndex] = result.value;
      } else {
        console.error(`[Bulk Import] Batch upload failed:`, result.reason);
      }
    }
    
    // Delay between batches if not the last batch
    if (batchStart + parallelCount < audioFiles.length) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
  }
  
  const successfulUploads = uploadedTracks.filter(t => t).length;
  
  if (successfulUploads === 0) {
    throw new Error('Failed to upload any audio files');
  }
  
  const audioProgress = 40;
  progressCallback(audioProgress, 'Uploading icons...');
  
  // Upload track icons with optimized parallelism
  const uploadedIconIds = [];
  if (trackIcons.length > 0) {
    
    // Icons are usually small, so we can be more aggressive with parallelism
    const iconParallelCount = Math.min(4, trackIcons.length); // Up to 4 parallel icon uploads
    const iconDelayBetweenBatches = 100; // Short delay for icons
    
    for (let batchStart = 0; batchStart < trackIcons.length; batchStart += iconParallelCount) {
      const batch = trackIcons.slice(batchStart, Math.min(batchStart + iconParallelCount, trackIcons.length));
      const batchPromises = [];
      
      for (let i = 0; i < batch.length; i++) {
        const file = batch[i];
        const globalIndex = batchStart + i;
        const iconProgress = 40 + (globalIndex / trackIcons.length) * 20; // Progress from 40% to 60%
        progressCallback(Math.round(iconProgress), `Uploading icons ${globalIndex + 1}/${trackIcons.length}...`);
        
        const iconPromise = uploadWithRetry(async () => {
          // Check context before upload
          if (!chrome.runtime?.id) {
            throw new Error('Extension context lost during icon upload.');
          }
          
          // Convert file to base64 format expected by service worker
          const base64Data = await convertFileToBase64(file);
          
          const result = await chrome.runtime.sendMessage({
            action: 'UPLOAD_ICON',
            file: base64Data
          });
          
          if (!result) {
            throw new Error('No response from extension during icon upload.');
          }
          
          if (result.error) {
            throw new Error(`Icon upload failed: ${result.error}`);
          }
          
          return {
            index: file.extractedNumber ? file.extractedNumber - 1 : globalIndex,
            iconId: result.iconId
          };
        }, 2, 1000, 30000); // 30 second timeout for icons
        
        batchPromises.push(iconPromise);
      }
      
      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          uploadedIconIds[result.value.index] = result.value.iconId;
        } else {
          console.error(`[Bulk Import] Icon batch upload failed:`, result.reason);
        }
      }
      
      // Small delay between icon batches
      if (batchStart + iconParallelCount < trackIcons.length) {
        await new Promise(resolve => setTimeout(resolve, iconDelayBetweenBatches));
      }
    }
    
  }
  
  const iconProgress = 70;
  progressCallback(iconProgress, 'Uploading cover image...');
  
  // Upload cover image
  let uploadedCoverUrl = null;
  if (coverImage) {
    try {
      // Check context before upload
      if (!chrome.runtime?.id) {
        throw new Error('Extension context lost during cover upload.');
      }
      
      // Convert file to base64 format expected by service worker
      const base64Data = await convertFileToBase64(coverImage);
      
      const coverResult = await chrome.runtime.sendMessage({
        action: 'UPLOAD_COVER',
        file: base64Data
      });
      
      
      if (coverResult && !coverResult.error) {
        // Check for different possible response formats
        uploadedCoverUrl = coverResult.url || coverResult.coverUrl || coverResult.imageUrl;
        if (uploadedCoverUrl) {
        } else {
          console.error(`[Bulk Import] Cover upload succeeded but no URL returned:`, coverResult);
        }
      } else if (coverResult && coverResult.error) {
        console.error(`[Bulk Import] Cover upload error: ${coverResult.error}`);
      }
    } catch (error) {
      console.error('[Bulk Import] Cover upload failed:', error);
      // Continue without cover image
    }
  } else {
  }
  
  progressCallback(90, 'Creating playlist...');
  
  // Check context before creating playlist
  if (!chrome.runtime?.id) {
    throw new Error('Extension context lost. Please refresh the page and try again.');
  }
  
  // Create the playlist
  const createResponse = await chrome.runtime.sendMessage({
    action: 'CREATE_PLAYLIST',
    title: playlistName,
    audioTracks: uploadedTracks.filter(t => t),
    iconIds: uploadedIconIds,
    coverUrl: uploadedCoverUrl
  });
  
  if (!createResponse) {
    throw new Error('No response from extension. Please refresh and try again.');
  }
  
  if (createResponse.error) {
    throw new Error(`Failed to create playlist: ${createResponse.error}`);
  }
  
  progressCallback(100, 'Complete');
  
  return createResponse;
}

// Helper function to convert file to base64 (for compatibility)
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Helper function to convert file to base64 format expected by service worker
async function convertFileToBase64(file) {
  return new Promise((resolve, reject) => {
    // Verify the file is valid
    if (!file || !(file instanceof Blob)) {
      console.error('[convertFileToBase64] Invalid file object:', file);
      reject(new Error('Invalid file object provided'));
      return;
    }
    
    
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const arrayBuffer = reader.result;
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        bytes.forEach(byte => binary += String.fromCharCode(byte));
        const base64 = btoa(binary);
      
      // Ensure proper MIME type
      let mimeType = file.type;
      if (!mimeType && file.name) {
        // Guess MIME type from extension if not provided
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'mp3') mimeType = 'audio/mpeg';
        else if (ext === 'm4a') mimeType = 'audio/mp4';
        else if (ext === 'm4b') mimeType = 'audio/mp4';
        else if (ext === 'wav') mimeType = 'audio/wav';
        else if (ext === 'ogg') mimeType = 'audio/ogg';
        else if (ext === 'aac') mimeType = 'audio/aac';
        else if (ext === 'flac') mimeType = 'audio/flac';
        else if (ext === 'png') mimeType = 'image/png';
        else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
        else if (ext === 'gif') mimeType = 'image/gif';
      }
      
      resolve({
        data: base64,
        type: mimeType || 'application/octet-stream',
        name: file.name
      });
      } catch (error) {
        console.error('[convertFileToBase64] Error during conversion:', error);
        reject(error);
      }
    };
    reader.onerror = (error) => {
      console.error('[convertFileToBase64] FileReader error:', error);
      reject(error);
    };
    reader.readAsArrayBuffer(file);
  });
}


// Show import modal
function showImportModal(audioFiles, trackIcons, coverImage, defaultName = 'Imported Playlist', sourceType = 'unknown') {
  // Remove existing modal if any
  const existing = document.querySelector('#yoto-import-modal');
  if (existing) existing.remove();
  
  const modal = document.createElement('div');
  modal.id = 'yoto-import-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    z-index: 99999;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 20vh;
    animation: fadeIn 0.3s ease;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 30px;
    max-width: 600px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  `;
  
  content.innerHTML = `
    <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">Import Playlist</h2>
    <div style="margin-bottom: 20px; color: #666;">
      <p>Ready to import:</p>
      <ul style="margin: 10px 0; padding-left: 20px;">
        <li>${audioFiles.length} audio file${audioFiles.length !== 1 ? 's' : ''}</li>
        <li>${trackIcons.length} track icon${trackIcons.length !== 1 ? 's' : ''}</li>
        ${coverImage ? '<li>1 cover image</li>' : ''}
      </ul>
    </div>
    <div style="margin-bottom: 20px;">
      <label style="display: block; margin-bottom: 5px; font-weight: 500;">Playlist Name:</label>
      <input type="text" id="import-playlist-name" value="${defaultName}" style="
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #ddd;
        border-radius: 6px;
        font-size: 14px;
      ">
    </div>
    <div id="import-progress" style="display: none; margin: 20px 0;">
      <div style="background: #f0f0f0; border-radius: 4px; height: 8px; overflow: hidden;">
        <div id="import-progress-bar" style="background: #3b82f6; height: 100%; width: 0%; transition: width 0.3s;"></div>
      </div>
      <p id="import-status" style="margin-top: 10px; color: #666; font-size: 14px;"></p>
    </div>
    <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 30px;">
      <button id="cancel-import" style="
        padding: 10px 20px;
        background: #f3f4f6;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">Cancel</button>
      <button id="start-import" style="
        padding: 10px 20px;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">Start Import</button>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  // Prevent any click on the content area from bubbling up
  content.onclick = (e) => e.stopPropagation();
  
  // Prevent text selection from closing modal
  content.onmousedown = (e) => e.stopPropagation();
  content.onmouseup = (e) => e.stopPropagation();
  content.onmousemove = (e) => e.stopPropagation();
  
  // Prevent input from causing issues
  const nameInput = document.querySelector('#import-playlist-name');
  if (nameInput) {
    nameInput.onclick = (e) => e.stopPropagation();
    nameInput.onkeydown = (e) => e.stopPropagation();
    nameInput.onkeyup = (e) => e.stopPropagation();
    nameInput.onfocus = (e) => e.stopPropagation();
    nameInput.onselect = (e) => e.stopPropagation();
    
    // Focus the input for convenience
    nameInput.focus();
    nameInput.select();
  }
  
  // Event handlers - only Cancel button closes the modal
  document.querySelector('#cancel-import').onclick = () => modal.remove();
  
  document.querySelector('#start-import').onclick = async () => {
    const playlistName = document.querySelector('#import-playlist-name').value || 'Imported Playlist';
    const progressDiv = document.querySelector('#import-progress');
    const progressBar = document.querySelector('#import-progress-bar');
    const statusText = document.querySelector('#import-status');
    const startButton = document.querySelector('#start-import');
    
    progressDiv.style.display = 'block';
    startButton.disabled = true;
    startButton.textContent = 'Importing...';
    
    try {
      const totalFiles = audioFiles.length + trackIcons.length + (coverImage ? 1 : 0);
      let completedFiles = 0;
      
      // Show initial status
      statusText.textContent = 'Starting upload...';
      
      // Helper function to update progress
      const updateProgress = () => {
        completedFiles++;
        const percentage = Math.round((completedFiles / totalFiles) * 100);
        statusText.textContent = `${percentage}% complete`;
        progressBar.style.width = `${(completedFiles / totalFiles) * 70}%`;
      };
      
      // Automatically choose upload strategy based on file count
      // Use chunked strategy for 10+ audio files for better performance
      const uploadStrategy = audioFiles.length >= 10 ? 'chunked' : 'parallel';
      
      
      let uploadedCoverUrl = null;
      const uploadedIconIds = [];
      const uploadedTracks = [];
      
      if (uploadStrategy === 'chunked') {
        // CHUNKED UPLOAD (For playlists with 10+ audio files)
        statusText.textContent = 'Uploading files...';
        const chunkSize = 8; // Upload 8 files at a time for better throughput
        
        // Upload cover first if exists
        if (coverImage) {
          const coverBase64 = await fileToBase64(coverImage);
          const coverResponse = await chrome.runtime.sendMessage({
            action: 'UPLOAD_COVER',
            file: coverBase64
          });
          if (!coverResponse.error && coverResponse.url) {
            uploadedCoverUrl = coverResponse.url;
          }
          updateProgress();
        }
        
        // Upload icons in chunks
        if (trackIcons.length > 0) {
          const iconResults = await uploadInChunks(
            trackIcons,
            async (iconFile, index) => {
              const iconBase64 = await fileToBase64(iconFile);
              const response = await chrome.runtime.sendMessage({
                action: 'UPLOAD_ICON',
                file: iconBase64
              });
              return { response, iconFile, index };
            },
            chunkSize,
            (completed, total) => {
              const totalProgress = completedFiles + completed;
              const percentage = Math.round((totalProgress / totalFiles) * 100);
              statusText.textContent = `${percentage}% complete`;
              progressBar.style.width = `${totalProgress / totalFiles * 70}%`;
            }
          );
          
          iconResults.forEach((result) => {
            if (result.status === 'fulfilled' && !result.value.response.error) {
              // Use the pre-extracted number (already stored when detecting icons)
              const iconNumber = (result.value.iconFile.extractedNumber || parseInt(result.value.iconFile.name.match(/\d+/)?.[0] || '1')) - 1;
              uploadedIconIds[iconNumber] = result.value.response.iconId;
            }
          });
          completedFiles += trackIcons.length;
        }
        
        // Upload audio in chunks
        const audioResults = await uploadInChunks(
          audioFiles,
          async (audioFile, index) => {
            const base64Data = await fileToBase64(audioFile);
            const response = await chrome.runtime.sendMessage({
              action: 'UPLOAD_AUDIO',
              file: base64Data
            });
            return { response, audioFile, index };
          },
          chunkSize,
          (completed, total) => {
            const totalProgress = completedFiles + completed;
            const percentage = Math.round((totalProgress / totalFiles) * 100);
            statusText.textContent = `${percentage}% complete`;
            progressBar.style.width = `${totalProgress / totalFiles * 70}%`;
          }
        );
        
        audioResults.forEach((result, index) => {
          if (result.status === 'fulfilled' && !result.value.response.error) {
            uploadedTracks[index] = {
              title: cleanTrackTitle(result.value.audioFile.name),
              transcodedAudio: result.value.response.transcodedAudio
            };
          } else if (result.status === 'rejected' || result.value.response.error) {
            throw new Error(`Failed to upload audio: ${result.reason || result.value.response.error}`);
          }
        });
        
      } else {
        // PARALLEL UPLOAD (Default strategy - fastest for < 20 audio files)
        statusText.textContent = 'Uploading files...';
        
        // Prepare all upload promises
        const uploadPromises = [];
        const uploadTypes = [];
        
        // 1. Prepare cover image upload (if any)
        if (coverImage) {
          const coverPromise = fileToBase64(coverImage).then(base64 => 
            chrome.runtime.sendMessage({
              action: 'UPLOAD_COVER',
              file: base64
            }).then(response => {
              updateProgress();
              return response;
            })
          );
          uploadPromises.push(coverPromise);
          uploadTypes.push('cover');
        }
        
        // 2. Prepare all icon uploads in parallel
        const iconPromises = trackIcons.map((iconFile, index) => 
          fileToBase64(iconFile).then(base64 => 
            chrome.runtime.sendMessage({
              action: 'UPLOAD_ICON',
              file: base64
            }).then(response => {
              updateProgress();
              return { response, iconFile, index };
            })
          )
        );
        uploadPromises.push(...iconPromises);
        uploadTypes.push(...Array(iconPromises.length).fill('icon'));
        
        // 3. Prepare all audio uploads in parallel
        const audioPromises = audioFiles.map((audioFile, index) => 
          fileToBase64(audioFile).then(base64 => 
            chrome.runtime.sendMessage({
              action: 'UPLOAD_AUDIO',
              file: base64
            }).then(response => {
              updateProgress();
              return { response, audioFile, index };
            })
          )
        );
        uploadPromises.push(...audioPromises);
        uploadTypes.push(...Array(audioPromises.length).fill('audio'));
        
        // Execute all uploads in parallel
        const uploadResults = await Promise.allSettled(uploadPromises);
        
        // Process parallel upload results
        uploadResults.forEach((result, index) => {
          const type = uploadTypes[index];
          
          if (result.status === 'fulfilled') {
            const value = result.value;
            
            if (type === 'cover') {
              if (!value.error && value.url) {
                uploadedCoverUrl = value.url;
              } else {
                
              }
            } else if (type === 'icon') {
              const { response, iconFile } = value;
              if (!response.error && response.iconId) {
                // Store icon ID at correct index based on filename
                // Use the pre-extracted number (already stored when detecting icons)
                const iconNumber = (iconFile.extractedNumber || parseInt(iconFile.name.match(/\d+/)?.[0] || '1')) - 1;
                uploadedIconIds[iconNumber] = response.iconId;
              } else {
                
              }
            } else if (type === 'audio') {
              const { response, audioFile, index: audioIndex } = value;
              if (!response.error && response.transcodedAudio) {
                uploadedTracks[audioIndex] = {
                  title: cleanTrackTitle(audioFile.name),
                  transcodedAudio: response.transcodedAudio
                };
              } else {
                throw new Error(`Failed to upload ${audioFile.name}: ${response.error || 'Unknown error'}`);
              }
            }
          } else {
            // Handle rejected promises
            if (type === 'audio') {
              throw new Error(`Audio upload failed: ${result.reason}`);
            } else {
              
            }
          }
        });
      }
      
      // Ensure all audio tracks were uploaded successfully
      const validTracks = uploadedTracks.filter(t => t);
      if (validTracks.length === 0) {
        throw new Error('No audio files were uploaded successfully');
      }
      
      // Create the playlist with icons
      statusText.textContent = 'Finalizing playlist...';
      progressBar.style.width = '90%';
      
      const createResponse = await chrome.runtime.sendMessage({
        action: 'CREATE_PLAYLIST',
        title: playlistName,
        audioTracks: uploadedTracks,
        iconIds: uploadedIconIds, // Pass the uploaded icon IDs
        coverUrl: uploadedCoverUrl // Pass the cover image URL
      });
      
      if (createResponse.error) {
        throw new Error(`Failed to create playlist: ${createResponse.error}`);
      }
      
      progressBar.style.width = '100%';
      statusText.textContent = 'Import complete!';
      
      // Show success message with auto-refresh
      // Clear modal but keep it positioned
      modal.innerHTML = '';
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        z-index: 99999;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding-top: 20vh;
        animation: fadeIn 0.3s ease;
      `;
      
      const successContent = document.createElement('div');
      successContent.style.cssText = `
        background: white;
        border-radius: 12px;
        padding: 30px;
        max-width: 500px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        text-align: center;
      `;
      
      successContent.innerHTML = `
          <div style="
            width: 60px;
            height: 60px;
            background: #10b981;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 20px;
          ">
            <svg width="30" height="30" fill="white" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
            </svg>
          </div>
          <h2 style="margin: 0 0 10px 0; color: #2c3e50; font-size: 24px;">Import Complete!</h2>
          <p style="margin: 0 0 20px 0; color: #666; font-size: 16px;">
            <strong>"${playlistName}"</strong> has been created
          </p>
          <div style="
            background: #f3f4f6;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 25px;
          ">
            <p style="margin: 0 0 10px 0; color: #4b5563; font-size: 14px;">Successfully imported:</p>
            <div style="display: flex; justify-content: center; gap: 30px; color: #2c3e50; font-size: 14px;">
              <span>${audioFiles.length} audio file${audioFiles.length !== 1 ? 's' : ''}</span>
              ${trackIcons.length > 0 ? `<span>${trackIcons.length} icon${trackIcons.length !== 1 ? 's' : ''}</span>` : ''}
            </div>
          </div>
          <div style="
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            color: #6b7280;
            font-size: 14px;
          ">
            <div style="
              width: 20px;
              height: 20px;
              border: 2px solid #3b82f6;
              border-top-color: transparent;
              border-radius: 50%;
              animation: spin 1s linear infinite;
            "></div>
            <span>Refreshing page...</span>
          </div>
        </div>
      `;
      
      modal.appendChild(successContent);
      
      // Add animation style if not already present
      if (!document.getElementById('yoto-spin-animation')) {
        const style = document.createElement('style');
        style.id = 'yoto-spin-animation';
        style.textContent = `
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `;
        document.head.appendChild(style);
      }
      
      showNotification('Playlist created successfully!', 'success');
      
      // Track successful import
      chrome.runtime.sendMessage({
        action: 'TRACK_EVENT',
        eventName: 'import_playlist',
        parameters: {
          source: sourceType,
          fileCount: audioFiles.length,
          success: true
        }
      });
      
      // Auto refresh after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 2000);
      
    } catch (error) {
      showNotification('Import failed: ' + error.message, 'error');
      // Track import failures
      chrome.runtime.sendMessage({
        action: 'TRACK_ERROR',
        error: error.message || 'Playlist import failed',
        context: {
          action: 'import_playlist',
          component: 'content',
          authenticated: state.authenticated
        }
      });
      
      // Track failed import
      chrome.runtime.sendMessage({
        action: 'TRACK_EVENT',
        eventName: 'import_playlist',
        parameters: {
          source: sourceType,
          fileCount: audioFiles ? audioFiles.length : 0,
          success: false
        }
      });
      
      // Show error in modal
      progressDiv.innerHTML = `
        <div style="background: #fee2e2; border: 1px solid #ef4444; border-radius: 6px; padding: 12px; margin-top: 20px;">
          <p style="margin: 0; color: #991b1b; font-size: 14px;">
            <strong>Error:</strong> ${error.message}
          </p>
        </div>
      `;
      
      startButton.disabled = false;
      startButton.textContent = 'Start Import';
    }
  };
  
  // Helper function to convert File to base64
  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const arrayBuffer = reader.result;
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        bytes.forEach(byte => binary += String.fromCharCode(byte));
        const base64 = btoa(binary);
        
        // Ensure proper MIME type for images
        let mimeType = file.type;
        if (!mimeType && file.name) {
          // Guess MIME type from extension if not provided
          const ext = file.name.split('.').pop().toLowerCase();
          if (ext === 'png') mimeType = 'image/png';
          else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
          else if (ext === 'gif') mimeType = 'image/gif';
        }
        
        resolve({
          data: base64,
          type: mimeType || 'image/png',
          name: file.name
        });
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }
  
  // Prevent content area clicks from bubbling up
  content.onclick = (e) => {
    e.stopPropagation();
  };
}

// Check if user just returned from authentication
function checkForAuthReturn() {
  const urlParams = new URLSearchParams(window.location.search);
  const authSuccess = urlParams.get('auth_success');
  
  if (authSuccess === 'true') {
    // Clean up URL
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, '', cleanUrl);
    
    // Show success message
    showNotification('✓ Authentication successful! You can now use import features.', 'success');
    
    // Update auth state
    state.authenticated = true;
  }
}

// Initialize the content script
injectStyles();
checkForAuthReturn();
init();
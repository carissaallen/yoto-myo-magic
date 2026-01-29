let state = {
  isMyoPage: false,
  authenticated: false,
  tracks: [],
  observer: null,
  injectedUI: false,
  authCacheTime: 0,
  iconMatchCache: new Map(),
  pageType: null,
  currentCardId: null
};

const AUTH_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Verifies that the current session is still valid and matches the Yoto account.
 * Should be called before critical operations (imports, exports) to prevent
 * operations being performed on the wrong account after a user switches accounts.
 *
 * @returns {Promise<{valid: boolean, userEmail?: string, error?: string}>}
 */
async function verifyAccountBeforeOperation() {
  try {
    const verification = await chrome.runtime.sendMessage({ action: 'VERIFY_ACCOUNT_MATCH' });

    if (!verification.valid || verification.mismatch || verification.needsReauth) {
      // Session is invalid or account mismatch detected
      state.authenticated = false;
      state.authCacheTime = 0;

      // Build notification message, including the previous email if available
      let message;
      if (verification.mismatch && verification.previousEmail) {
        // Show which account they were signed into
        const template = chrome.i18n.getMessage('notification_accountMismatchWithEmail') ||
          'Your Yoto account has changed (was: {{email}}). Please sign in again.';
        message = template.replace('{{email}}', verification.previousEmail);
      } else if (verification.mismatch) {
        message = chrome.i18n.getMessage('notification_accountMismatch') || 'Your Yoto account has changed. Please sign in again.';
      } else {
        message = chrome.i18n.getMessage('notification_sessionExpired') || 'Your session has expired. Please sign in again.';
      }

      showNotification(message, 'warning');
      showAuthBanner();

      return { valid: false, error: message };
    }

    // Session is valid
    state.authenticated = true;
    state.authCacheTime = Date.now();
    return { valid: true, userEmail: verification.userEmail };
  } catch (error) {
    console.warn('[Session] Account verification failed:', error.message);
    // On error, allow operation to proceed but log the issue
    return { valid: true, error: 'Verification check failed, proceeding anyway' };
  }
}

function init() {

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

  // Wait for DOM to be ready before checking for MYO page
  const checkWhenReady = () => {
    if (document.readyState === 'loading') {
      // DOM not ready yet, wait for it
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(checkForMyoPage, 500);
      });
    } else {
      // DOM already ready (interactive or complete)
      setTimeout(checkForMyoPage, 500);
    }
  };

  checkWhenReady();

  // Check for active export on page load/refresh
  // Also remove any stale modal from DOM
  const staleModal = document.getElementById('yoto-bulk-export-modal');
  if (staleModal) {
    staleModal.remove();
  }
  checkForActiveExport();


  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'AUTH_STATUS') {
      state.authenticated = request.authenticated;
      state.authCacheTime = Date.now();
      updateButtonIcon(request.authenticated);

      if (request.authenticated) {
        removeAuthBanner();
        if (state.isMyoPage) {
          showNotification(chrome.i18n.getMessage('notification_authSuccess'), 'success');
        }
      }
    } else if (request.action === 'PERMISSION_GRANTED') {
      // Handle when permission is granted from the popup
      showNotification(chrome.i18n.getMessage('notification_permissionGrantedRetry'), 'success');

      const statusText = document.querySelector('#import-status');
      if (statusText) {
        statusText.innerHTML = `
          <div style="color: #28a745;">
            <p>Permission granted! You can now close this modal and try importing again.</p>
          </div>
        `;
      }
    }
    // Bulk Export Progress Handlers
    else if (request.type === 'EXPORT_ERROR') {
      console.error('[Bulk Export] Export error:', request.error);
      const status = document.getElementById('export-status');
      if (status) {
        status.textContent = `Error: ${request.error}`;
        status.style.color = '#ef4444';
      }
      // Show notification to user
      showNotification(chrome.i18n.getMessage('bulkExport_exportError').replace('{{error}}', request.error), 'error');
    } else if (request.type === 'DOWNLOAD_PROGRESS') {
      handleDownloadProgress(request);
    } else if (request.type === 'DOWNLOAD_COMPLETED') {
      handleDownloadCompleted(request);
    } else if (request.type === 'DOWNLOAD_FAILED') {
      console.warn('[Bulk Export] File failed:', request.filename, request.error);
      handleDownloadFailed(request);
    } else if (request.type === 'EXPORT_COMPLETED') {
      handleExportCompleted(request);
    }
    // Progressive Export Handlers
    else if (request.type === 'PROGRESSIVE_EXPORT_STARTED') {
      handleProgressiveExportStarted(request);
    } else if (request.type === 'PLAYLIST_EXPORT_STARTED') {
      handlePlaylistExportStarted(request);
    } else if (request.type === 'PLAYLIST_EXPORT_COMPLETED') {
      handlePlaylistExportCompleted(request);
    } else if (request.type === 'PLAYLIST_EXPORT_FAILED') {
      handlePlaylistExportFailed(request);
    } else if (request.type === 'PROGRESSIVE_EXPORT_COMPLETED') {
      handleProgressiveExportCompleted(request);
    }
    else if (request.type === 'ZIP_DOWNLOADED') {
      // Check if we're in progressive export mode
      if (window.totalPlaylists && window.totalPlaylists > 0) {
        return;
      }

      // Old single-ZIP behavior - only runs for non-progressive exports
      const status = document.getElementById('export-status');
      if (status) {
        status.textContent = chrome.i18n.getMessage('bulkExport_zipDownloaded');
        status.style.color = '#10b981';
      }

      // Show success notification
      showNotification('Export complete! ZIP has been downloaded to your Downloads folder.', 'success');

      // Clean up after a short delay
      setTimeout(() => {
        document.getElementById('yoto-bulk-export-modal')?.remove();
        removeExportStatusIndicator();

        // Clear export state
        window.currentExportManifestId = null;
        window.exportTotalFiles = 0;
        window.exportCompletedFiles = 0;
        window.exportFailedFiles = 0;
      }, 3000);
    } else if (request.type === 'ZIP_DOWNLOAD_ERROR') {
      console.error('[Bulk Export] ZIP download error:', request.error);

      // Update status in the export modal
      const status = document.getElementById('export-status');
      if (status) {
        status.textContent = `Error: ${request.error}`;
        status.style.color = '#ef4444';
      }

      // Show error notification
      showNotification(chrome.i18n.getMessage('bulkExport_exportError').replace('{{error}}', request.error), 'error');
    } else if (request.type === 'ZIP_CREATION_ERROR') {
      console.error('[Bulk Export] ZIP creation error:', request.error);

      // Update status in the export modal
      const status = document.getElementById('export-status');
      if (status) {
        status.textContent = `Error: ${request.error}`;
        status.style.color = '#ef4444';
      }

      // Show error notification
      showNotification(chrome.i18n.getMessage('bulkExport_exportError').replace('{{error}}', request.error), 'error');
    } else if (request.type === 'DOWNLOADS_STARTED') {
      handleDownloadsStarted(request);
    } else if (request.type === 'DOWNLOAD_STARTED') {
      // Clear timeout since downloads are working
      if (window.exportProgressTimeout) {
        clearTimeout(window.exportProgressTimeout);
        window.exportProgressTimeout = null;
      }
    } else if (request.type === 'DOWNLOADS_CANCELLED') {
      // Remove all UI elements
      const modal = document.getElementById('yoto-bulk-export-modal');
      if (modal) modal.remove();
      removeExportStatusIndicator();

      // Clear export state
      window.currentExportManifestId = null;
      window.exportTotalFiles = 0;
      window.exportCompletedFiles = 0;
      window.exportFailedFiles = 0;
    }
  });
}

function checkForMyoPage() {
  const url = window.location.href;
  const path = window.location.pathname;

  if (!url.includes('my.yotoplay.com')) {
    return;
  }

  injectMobileStyles();

  if (path.includes('/my-cards/playlists') || path === '/my-cards' || path === '/my-cards/') {
    state.isMyoPage = true;
    state.pageType = 'my-playlists';
    state.currentCardId = null;
    waitForMyoElements();
  } else if (path.includes('/card/') && path.includes('/edit')) {
    state.isMyoPage = true;
    state.pageType = 'edit-card';
    // Extract cardId from URL: /card/{cardId}/edit
    const cardIdMatch = path.match(/\/card\/([^\/]+)\/edit/);
    state.currentCardId = cardIdMatch ? cardIdMatch[1] : null;
    waitForMyoElements();
  } else {
    state.isMyoPage = false;
    state.pageType = null;
    state.currentCardId = null;
  }
}

function injectMobileStyles() {
  if (document.getElementById('yoto-mobile-styles')) {
    return;
  }

  // Wait for head to be available (important when using document_start)
  if (!document.head) {
    setTimeout(injectMobileStyles, 10);
    return;
  }

  const styleTag = document.createElement('style');
  styleTag.id = 'yoto-mobile-styles';
  styleTag.textContent = `
    #yoto-import-btn,
    #yoto-update-btn,
    #yoto-bulk-import-btn,
    #yoto-podcast-btn,
    #yoto-timer-btn,
    #yoto-bulk-export-btn,
    #auth-banner-btn {
      touch-action: manipulation;
      -webkit-tap-highlight-color: rgba(59, 130, 246, 0.2);
    }

    #yoto-import-btn:active,
    #yoto-update-btn:active,
    #yoto-bulk-import-btn:active,
    #yoto-podcast-btn:active,
    #yoto-timer-btn:active,
    #yoto-bulk-export-btn:active,
    #auth-banner-btn:active {
      background-color: #eff6ff !important;
      transform: scale(0.98) !important;
    }

    @media (max-width: 768px) {
      #yoto-import-container {
        flex-direction: column !important;
        width: 100% !important;
      }

      #yoto-import-btn,
      #yoto-update-btn,
      #yoto-bulk-import-btn,
      #yoto-podcast-btn,
      #yoto-visual-timer-btn,
      #yoto-bulk-export-btn {
        width: 100% !important;
        justify-content: center !important;
        margin: 0 !important;
        white-space: normal !important;
        min-height: 44px !important;
        padding: 10px 16px !important;
      }

      #yoto-card-edit-buttons {
        flex-wrap: wrap !important;
        gap: 12px !important;
      }

      #yoto-update-playlist-container {
        flex-basis: 100% !important;
        margin-top: 16px !important;
        margin-left: 8px !important;
      }

      #yoto-auth-banner {
        flex-direction: column !important;
        height: auto !important;
        padding: 16px 20px !important;
        gap: 12px !important;
      }

      #yoto-auth-banner img {
        height: 42px !important;
        max-width: 260px !important;
      }

      #yoto-auth-banner #auth-banner-btn {
        width: 100% !important;
        max-width: 280px !important;
        padding: 10px 20px !important;
        min-height: 44px !important;
      }

      #yoto-auth-banner #auth-banner-close {
        position: absolute !important;
        top: 8px !important;
        right: 8px !important;
        margin-left: 0 !important;
      }
    }

    @media (max-width: 480px) {
      #yoto-import-btn span,
      #yoto-update-btn span,
      #yoto-bulk-import-btn span,
      #yoto-podcast-btn span,
      #yoto-visual-timer-btn span,
      #yoto-bulk-export-btn span {
        font-size: 13px !important;
      }

      #yoto-auth-banner img {
        height: 38px !important;
        max-width: 220px !important;
      }

      #yoto-auth-banner {
        padding: 12px 16px !important;
        gap: 10px !important;
      }
    }
  `;

  document.head.appendChild(styleTag);
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

  const isMobile = window.innerWidth <= 768;
  const bannerHeight = isMobile ? 'auto' : '60px';
  const marginTop = isMobile ? '100px' : '60px';
  document.body.style.marginTop = marginTop;
  
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
    btn.textContent = chrome.i18n.getMessage('button_authenticating');
    btn.disabled = true;
    
    try {
      const authResult = await chrome.runtime.sendMessage({ action: 'START_AUTH_INTERACTIVE' });
      
      if (authResult && authResult.success) {
        state.authenticated = true;
        state.authCacheTime = Date.now();
        removeAuthBanner();
        showNotification(chrome.i18n.getMessage('notification_authSuccessIconMatch'), 'success');
        updateButtonIcon(true);
      } else if (authResult && authResult.cancelled) {
        btn.textContent = chrome.i18n.getMessage('button_authenticateNow');
        btn.disabled = false;
      } else {
        btn.textContent = chrome.i18n.getMessage('button_tryAgain');
        btn.disabled = false;
        showNotification(chrome.i18n.getMessage('notification_authFailed'), 'error');
      }
    } catch (error) {
      btn.textContent = chrome.i18n.getMessage('button_tryAgain');
      btn.disabled = false;
      showNotification(chrome.i18n.getMessage('notification_authError'), 'error');
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

// Persistent observer for playlist page buttons
let playlistPageObserver = null;
let lastPlaylistInjectionAttempt = 0;
const PLAYLIST_MIN_INJECTION_INTERVAL = 500;

function waitForMyoElements() {
  const path = window.location.pathname;

  if (path.includes('/my-cards/playlists') || path === '/my-cards' || path === '/my-cards/') {
    // Initial injection attempt
    checkAndInjectImportButton();

    // Early retry attempts
    const attempts = [500, 1500, 3000];
    attempts.forEach((delay) => {
      setTimeout(() => checkAndInjectImportButton(), delay);
    });

    // Set up persistent observer for this page if not already set up
    if (!playlistPageObserver) {
      playlistPageObserver = new MutationObserver(() => {
        const now = Date.now();
        if (now - lastPlaylistInjectionAttempt >= PLAYLIST_MIN_INJECTION_INTERVAL) {
          lastPlaylistInjectionAttempt = now;
          // Check if we're still on the playlist page
          const currentPath = window.location.pathname;
          if (currentPath.includes('/my-cards/playlists') || currentPath === '/my-cards' || currentPath === '/my-cards/') {
            checkAndInjectImportButton();
          }
        }
      });

      if (document.body) {
        playlistPageObserver.observe(document.body, {
          childList: true,
          subtree: true
        });
      }
    }

    return;
  }
}

function checkAndInjectImportButton() {
  const path = window.location.pathname;

  // Skip card/edit pages - they have their own "Add Content" dropdown
  if (path.includes('/edit') || path.includes('/card/')) {
    return false;
  }

  // Simple check - if container exists, don't inject again
  if (document.querySelector('#yoto-import-container')) {
    return true;
  }

  const headingPatterns = [
    'my playlist', 'my cards', 'cards',
    'mes playlists', 'mes cartes', 'cartes',
    'meine playlists', 'meine karten', 'karten',
    'mis playlists', 'mis listas', 'mis tarjetas', 'tarjetas',
    'le mie playlist', 'le mie carte', 'carte',
    'moji seznami', 'moje kartice', 'kartice'
  ];

  const descriptionPatterns = [
    'create playlists here',
    'créez vos playlists', 'creez vos playlists',
    'playlists hier erstellen', 'erstellen sie hier playlists',
    'crear listas de reproducción aquí', 'crea listas aquí',
    'crea playlist qui', 'crea le playlist qui',
    'ustvari sezname predvajanja tukaj'
  ];

  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5'));

  const playlistsHeading = headings.find(el => {
    const text = el.textContent?.trim()?.toLowerCase() || '';
    const matchesPattern = headingPatterns.some(pattern => text.includes(pattern));
    const isNotEdit = !text.includes('edit') && !text.includes('modifier') &&
                      !text.includes('bearbeiten') && !text.includes('editar') &&
                      !text.includes('modifica') && !text.includes('uredi');
    return matchesPattern && isNotEdit;
  });

  if (playlistsHeading && injectButtonsAfterElement(playlistsHeading, descriptionPatterns)) {
    return true;
  }

  if (path === '/my-cards' || path === '/my-cards/' || path.includes('/my-cards/playlists')) {
    const mainContainers = Array.from(document.querySelectorAll('main, [role="main"], .content, .main-content'));
    for (const container of mainContainers) {
      const firstHeading = container.querySelector('h1, h2, h3');
      if (firstHeading && injectButtonsAfterElement(firstHeading, descriptionPatterns)) {
        return true;
      }
    }

    const firstHeading = document.querySelector('main h1, main h2, h1, h2');
    if (firstHeading && injectButtonsAfterElement(firstHeading, descriptionPatterns)) {
      return true;
    }
  }

  return false;
}

function injectButtonsAfterElement(targetElement, descriptionPatterns) {
  if (!targetElement) return false;

  const mainContainer = targetElement.parentNode;
  if (!mainContainer) return false;

  let injectionPoint = targetElement;
  let nextElement = targetElement.nextElementSibling;

  while (nextElement && injectionPoint === targetElement) {
    const text = nextElement.textContent?.trim()?.toLowerCase() || '';
    if (descriptionPatterns.some(pattern => text.includes(pattern))) {
      injectionPoint = nextElement;
      break;
    }
    nextElement = nextElement.nextElementSibling;

    if (!nextElement || nextElement === targetElement.parentNode?.lastElementChild) {
      break;
    }
  }

  const buttonContainer = document.createElement('div');
  buttonContainer.style.cssText = 'margin: 20px 0 24px 0; padding: 0; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; width: 100%;';
  buttonContainer.id = 'yoto-import-container';

  const importButton = createImportButton();
  const updateButton = createUpdateButton();
  const bulkImportButton = createBulkImportButton();
  const podcastButton = createPodcastButton();
  const visualTimerButton = createVisualTimerButton();
  const bulkExportButton = createBulkExportButton();

  buttonContainer.appendChild(importButton);
  buttonContainer.appendChild(updateButton);
  buttonContainer.appendChild(bulkImportButton);
  if (podcastButton) {
    buttonContainer.appendChild(podcastButton);
  }
  buttonContainer.appendChild(visualTimerButton);
  buttonContainer.appendChild(bulkExportButton);

  if (injectionPoint.nextSibling) {
    injectionPoint.parentNode.insertBefore(buttonContainer, injectionPoint.nextSibling);
  } else {
    injectionPoint.parentNode.appendChild(buttonContainer);
  }

  return true;
}

function createImportButton() {
  const button = document.createElement('button');
  button.id = 'yoto-import-btn';
  
  const importIcon = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <polyline points="7 10 12 15 17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
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
    <span>${chrome.i18n.getMessage('button_importPlaylist')}</span>
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

function createUpdateButton() {
  const button = document.createElement('button');
  button.id = 'yoto-update-btn';

  const updateIcon = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M12 19H5C3.89543 19 3 18.1046 3 17V7C3 5.89543 3.89543 5 5 5H9.58579C9.851 5 10.1054 5.10536 10.2929 5.29289L12 7H19C20.1046 7 21 7.89543 21 9V11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M18 14V17M18 20V17M18 17H15M18 17H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
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
    ${updateIcon}
    <span>${chrome.i18n.getMessage('button_updatePlaylist')}</span>
  `;

  button.onmouseenter = () => {
    button.style.backgroundColor = '#ffffff';
    button.style.color = '#ffdd00';
    button.style.borderColor = '#ffdd00';
    button.style.transform = 'translateY(-1px)';
  };

  button.onmouseleave = () => {
    button.style.backgroundColor = '#ffffff';
    button.style.color = '#3b82f6';
    button.style.borderColor = '#3b82f6';
    button.style.transform = 'translateY(0)';
  };

  button.addEventListener('click', handleUpdateClick);

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
    <span>${chrome.i18n.getMessage('button_bulkImport')}</span>
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
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 30px;
    max-width: 500px;
    width: 90%;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  `;
  
  content.innerHTML = `
    <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" style="vertical-align: middle; margin-right: 8px;">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
        <line x1="12" y1="19" x2="12" y2="23"></line>
        <line x1="8" y1="23" x2="16" y2="23"></line>
      </svg>
      ${chrome.i18n.getMessage('modal_importPodcastPermission')}
    </h2>
    
    <div style="margin-bottom: 24px; color: #4b5563; line-height: 1.6;">
      <p style="margin: 0 0 16px 0;">${chrome.i18n.getMessage('modal_permissionDescription')}</p>

      <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0 0 8px 0; font-weight: 600; color: #374151;">${chrome.i18n.getMessage('modal_permissionTitle')}</p>
        <ul style="margin: 8px 0 0 0; padding-left: 20px; color: #6b7280;">
          <li style="margin: 4px 0;">${chrome.i18n.getMessage('modal_permissionReason1')}</li>
          <li style="margin: 4px 0;">${chrome.i18n.getMessage('modal_permissionReason2')}</li>
          <li style="margin: 4px 0;">${chrome.i18n.getMessage('modal_permissionReason3')}</li>
        </ul>
      </div>

      <p style="margin: 16px 0 0 0; font-size: 14px; color: #6b7280;">
        ${chrome.i18n.getMessage('modal_permissionNote')}
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
        ${chrome.i18n.getMessage('button_cancel')}
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
        ${chrome.i18n.getMessage('button_grantPermission')}
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
        showNotification(chrome.i18n.getMessage('notification_permissionGranted'), 'success');
        modal.remove();
        // Proceed to show the podcast search modal
        showPodcastSearchModal();
      } else {
        showNotification(chrome.i18n.getMessage('notification_permissionDenied'), 'error');
        modal.remove();
      }
    } catch (error) {
      await chrome.runtime.sendMessage({
        action: 'REQUEST_ALL_URLS_PERMISSION'
      });
      
      content.innerHTML = `
        <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">${chrome.i18n.getMessage('modal_requestingPermission')}</h2>
        <p style="color: #6b7280;">${chrome.i18n.getMessage('modal_grantPermissionInPopup')}</p>
        <p style="color: #6b7280; font-size: 14px; margin-top: 16px;">${chrome.i18n.getMessage('modal_noPopupInstruction')}</p>
      `;
      
      // Wait a moment then check if permission was granted
      setTimeout(async () => {
        const check = await chrome.runtime.sendMessage({
          action: 'CHECK_ALL_URLS_PERMISSION'
        });
        
        if (check.granted) {
          showNotification(chrome.i18n.getMessage('notification_permissionGranted'), 'success');
          modal.remove();
          showPodcastSearchModal();
        } else {
          modal.remove();
        }
      }, 1000);
    }
  });
  
  document.getElementById('permission-cancel').addEventListener('click', () => {
    modal.remove();
  });
  
}

async function handlePodcastImportClick() {
  // Track podcast import click
  chrome.runtime.sendMessage({
    action: 'TRACK_EVENT',
    eventName: 'podcast_import_click',
    parameters: {}
  });

  // Set update mode if we're on an edit page with a cardId
  if (state.pageType === 'edit-card' && state.currentCardId) {
    window.yotoUpdateMode = {
      isUpdateMode: true,
      cardId: state.currentCardId
    };
  } else {
    // Clear any previous update mode
    if (window.yotoUpdateMode) {
      delete window.yotoUpdateMode;
    }
  }

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
      <span>${chrome.i18n.getMessage('button_importPodcast')}</span>
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

function createVisualTimerButton() {
  const button = document.createElement('button');
  button.id = 'yoto-visual-timer-btn';

  const timerIcon = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/>
      <path d="M12 7v5l3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M9 2h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M12 2v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
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
    ${timerIcon}
    <span>${chrome.i18n.getMessage('button_visualTimer')}</span>
  `;

  button.onmouseenter = () => {
    button.style.backgroundColor = '#ffffff';
    button.style.color = '#ec4899';
    button.style.borderColor = '#ec4899';
    button.style.transform = 'translateY(-1px)';
  };

  button.onmouseleave = () => {
    button.style.backgroundColor = '#ffffff';
    button.style.color = '#3b82f6';
    button.style.borderColor = '#3b82f6';
    button.style.transform = 'translateY(0)';
  };

  button.onclick = (e) => {
    e.preventDefault();
    handleVisualTimerClick();
  };

  return button;
}

function createBulkExportButton() {
  const button = document.createElement('button');
  button.id = 'yoto-bulk-export-btn';

  const exportIcon = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <polyline points="17 8 12 3 7 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="12" y1="3" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
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
    ${exportIcon}
    <span>${chrome.i18n.getMessage('button_bulkExport') || 'Bulk Export'}</span>
  `;

  button.onmouseenter = () => {
    button.style.backgroundColor = '#ffffff';
    button.style.color = '#7f7f7f';
    button.style.borderColor = '#7f7f7f';
    button.style.transform = 'translateY(-1px)';
  };

  button.onmouseleave = () => {
    button.style.backgroundColor = '#ffffff';
    button.style.color = '#3b82f6';
    button.style.borderColor = '#3b82f6';
    button.style.transform = 'translateY(0)';
  };

  button.onclick = (e) => {
    e.preventDefault();
    handleBulkExportClick();
  };

  return button;
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

async function handleUpdateClick() {
  try {
    const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });

    if (!authResponse || !authResponse.authenticated) {
      showNotification(chrome.i18n.getMessage('notification_authRequiredForUpdate'), 'info');
      showAuthBanner();
      return;
    }

    chrome.runtime.sendMessage({
      action: 'TRACK_EVENT',
      eventName: 'update_playlist_click',
      parameters: {}
    });

    showCardSelectionModal();
  } catch (error) {
    showNotification(chrome.i18n.getMessage('notification_errorOccurred'), 'error');
    chrome.runtime.sendMessage({
      action: 'TRACK_ERROR',
      error: error.message || 'Update initialization failed',
      context: {
        action: 'update_init',
        component: 'content',
        authenticated: state.authenticated
      }
    });
  }
}

async function handleImportClick() {
  try {
    // Verify account match before proceeding with import
    // This prevents importing to wrong account after user switches Yoto accounts
    const verification = await verifyAccountBeforeOperation();

    if (!verification.valid) {
      // Account mismatch or session expired - user has been notified
      return;
    }

    openFolderSelector();
  } catch (error) {
    showNotification(chrome.i18n.getMessage('notification_errorOccurred'), 'error');
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
    showNotification(chrome.i18n.getMessage('notification_proceedingWithoutAuth'), 'warning');
    openFolderSelector();
  }
}

function openFolderSelector() {
  showImportOptionsModal();
}

async function handleBulkImportClick() {
  try {
    // Verify account match before proceeding with bulk import
    const verification = await verifyAccountBeforeOperation();

    if (!verification.valid) {
      // Account mismatch or session expired - user has been notified
      return;
    }

    // User is authenticated and account verified, show bulk import modal
    showBulkImportOptionsModal();
  } catch (error) {
    showNotification(chrome.i18n.getMessage('notification_errorOccurred'), 'error');
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
    showNotification(chrome.i18n.getMessage('notification_proceedingWithoutAuth'), 'warning');
    showBulkImportOptionsModal();
  }
}

async function handleVisualTimerClick() {
  try {
    const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });

    if (!authResponse || !authResponse.authenticated) {
      showNotification(chrome.i18n.getMessage('notification_authRequiredForTimer'), 'info');
      showAuthBanner();
      return;
    }

    chrome.runtime.sendMessage({
      action: 'TRACK_EVENT',
      eventName: 'visual_timer_click',
      parameters: {}
    });

    showVisualTimerModal();
  } catch (error) {
    showNotification(chrome.i18n.getMessage('notification_errorOccurred'), 'error');
    chrome.runtime.sendMessage({
      action: 'TRACK_ERROR',
      error: error.message || 'Visual timer initialization failed',
      context: {
        action: 'visual_timer_init',
        component: 'content',
        authenticated: state.authenticated
      }
    });
  }
}

async function handleBulkExportClick() {
  try {
    const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });

    if (!authResponse || !authResponse.authenticated) {
      showNotification(chrome.i18n.getMessage('notification_authRequiredForExport') || 'Authentication required for bulk export', 'info');
      showAuthBanner();
      return;
    }

    chrome.runtime.sendMessage({
      action: 'TRACK_EVENT',
      eventName: 'bulk_export_click',
      parameters: {}
    });

    showBulkExportModal();
  } catch (error) {
    showNotification(chrome.i18n.getMessage('notification_errorOccurred') || 'An error occurred', 'error');
    chrome.runtime.sendMessage({
      action: 'TRACK_ERROR',
      error: error.message || 'Bulk export initialization failed',
      context: {
        action: 'bulk_export_init',
        component: 'content',
        authenticated: state.authenticated
      }
    });
  }
}

async function showBulkExportModal() {
  const existingModal = document.getElementById('yoto-bulk-export-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'yoto-bulk-export-modal';
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
    padding-top: 10vh;
    background-color: rgba(0, 0, 0, 0.5);
    overflow-y: auto;
  `;

  const modalContent = document.createElement('div');
  modalContent.style.cssText = `
    background-color: white;
    border-radius: 8px;
    padding: 24px;
    max-width: 600px;
    width: 90%;
    margin: 20px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    position: relative;
  `;

  modalContent.innerHTML = `
    <h2 style="font-size: 20px; font-weight: bold; color: #1f2937; margin: 0 0 20px 0;">${chrome.i18n.getMessage('bulkExport_modalTitle')}</h2>
    <button id="close-modal-btn" style="
      position: absolute;
      top: 12px;
      right: 12px;
      background: none;
      border: none;
      font-size: 20px;
      color: #9ca3af;
      cursor: pointer;
      padding: 4px;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: all 0.2s;
    " onmouseover="this.style.backgroundColor='#f3f4f6'; this.style.color='#6b7280';" onmouseout="this.style.backgroundColor='transparent'; this.style.color='#9ca3af';">×</button>

    <p style="color: #6b7280; margin-bottom: 20px;">${chrome.i18n.getMessage('bulkExport_description')}</p>

    <div style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
      <div>
        <button id="select-all-playlists" style="
        background-color: #f3f4f6;
        color: #374151;
        border: 1px solid #d1d5db;
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 14px;
        cursor: pointer;
        margin-right: 8px;
        transition: all 0.2s;
      ">${chrome.i18n.getMessage('bulkExport_selectAll')}</button>
      <button id="deselect-all-playlists" style="
        background-color: #f3f4f6;
        color: #374151;
        border: 1px solid #d1d5db;
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.2s;
      ">${chrome.i18n.getMessage('bulkExport_deselectAll')}</button>
      </div>

      <select id="sort-playlists" style="
        background-color: white;
        color: #374151;
        border: 1px solid #d1d5db;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 14px;
        cursor: pointer;
        outline: none;
        transition: border-color 0.2s;
      ">
        <option value="name-asc">${chrome.i18n.getMessage('bulkExport_sortAZ')}</option>
        <option value="name-desc">${chrome.i18n.getMessage('bulkExport_sortZA')}</option>
        <option value="updated" selected>${chrome.i18n.getMessage('bulkExport_sortUpdated')}</option>
        <option value="created">${chrome.i18n.getMessage('bulkExport_sortCreated')}</option>
      </select>
    </div>

    <div id="playlists-loading" style="text-align: center; padding: 40px;">
      <div style="
        width: 40px;
        height: 40px;
        border: 4px solid #f3f4f6;
        border-top-color: #3b82f6;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 16px;
      "></div>
      <p style="color: #6b7280;">${chrome.i18n.getMessage('bulkExport_loading')}</p>
    </div>

    <div id="playlists-container" style="display: none;">
      <div id="playlists-list" style="
        max-height: 400px;
        overflow-y: auto;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        padding: 12px;
        margin-bottom: 20px;
      "></div>

      <div id="export-progress" style="display: none; margin-bottom: 16px;">
        <div style="
          background-color: #f3f4f6;
          border-radius: 6px;
          padding: 12px;
        ">
          <p id="export-status" style="margin-bottom: 8px; font-size: 14px; color: #374151;"></p>
          <div style="
            background-color: #e5e7eb;
            height: 8px;
            border-radius: 4px;
            overflow: hidden;
          ">
            <div id="export-progress-bar" style="
              height: 100%;
              background-color: #3b82f6;
              width: 0%;
              transition: width 0.3s;
            "></div>
          </div>
        </div>
      </div>

      <div style="display: flex; gap: 12px; justify-content: space-between;">
        <button id="cancel-export" style="
          background-color: #f3f4f6;
          color: #374151;
          border: none;
          padding: 10px 20px;
          border-radius: 6px;
          font-size: 14px;
          cursor: pointer;
          transition: background-color 0.2s;
        ">${chrome.i18n.getMessage('bulkExport_cancelExport')}</button>
        <div style="display: flex; gap: 12px;">
          <button id="close-export" style="
            background-color: #f3f4f6;
            color: #374151;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            font-size: 14px;
            cursor: pointer;
            transition: background-color 0.2s;
          ">${chrome.i18n.getMessage('bulkExport_close')}</button>
          <button id="start-export" style="
            background-color: #3b82f6;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            font-size: 14px;
            cursor: pointer;
            transition: background-color 0.2s;
          ">${chrome.i18n.getMessage('bulkExport_startExport')}</button>
        </div>
      </div>
    </div>
  `;

  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);

  // Cancel button - cancels the export process
  const cancelBtn = document.getElementById('cancel-export');
  cancelBtn.onclick = async () => {
    if (window.currentExportManifestId) {
      // Cancel the background export
      await chrome.runtime.sendMessage({
        action: 'CANCEL_BULK_EXPORT',
        manifestId: window.currentExportManifestId
      });
      showNotification(chrome.i18n.getMessage('bulkExport_exportCancelled'), 'info');
    }
    modal.remove();
  };
  cancelBtn.onmouseover = function() { this.style.backgroundColor = '#e5e7eb'; };
  cancelBtn.onmouseout = function() { this.style.backgroundColor = '#f3f4f6'; };

  const closeModalBtn = document.getElementById('close-modal-btn');
  if (closeModalBtn) {
    closeModalBtn.onclick = () => {
      modal.remove();
    };
  }

  // Close button - only closes the modal, doesn't cancel the export
  const closeBtn = document.getElementById('close-export');
  closeBtn.onclick = () => {
    modal.remove();
  };
  closeBtn.onmouseover = function() { this.style.backgroundColor = '#e5e7eb'; };
  closeBtn.onmouseout = function() { this.style.backgroundColor = '#f3f4f6'; };

  // Click outside modal to close
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  };

  await loadUserPlaylists();
}

async function loadUserPlaylists() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_USER_PLAYLISTS' });

    if (response.error) {
      document.getElementById('playlists-loading').innerHTML = `
        <p style="color: #ef4444;">Error loading playlists: ${response.error}</p>
      `;
      return;
    }

    const playlists = response.cards || [];
    if (playlists.length > 0) {
    }

    if (playlists.length === 0) {
      document.getElementById('playlists-loading').innerHTML = `
        <p style="color: #6b7280;">No playlists found in your library.</p>
      `;
      return;
    }

    document.getElementById('playlists-loading').style.display = 'none';
    document.getElementById('playlists-container').style.display = 'block';

    window.allExportPlaylists = playlists;
    displaySortedPlaylists('updated');

    document.getElementById('select-all-playlists').onclick = () => {
      document.querySelectorAll('.playlist-checkbox').forEach(cb => cb.checked = true);
    };

    document.getElementById('deselect-all-playlists').onclick = () => {
      document.querySelectorAll('.playlist-checkbox').forEach(cb => cb.checked = false);
    };

    const startBtn = document.getElementById('start-export');
    startBtn.onclick = () => startBulkExport(window.allExportPlaylists);
    startBtn.onmouseover = function() { this.style.backgroundColor = '#2563eb'; };
    startBtn.onmouseout = function() { this.style.backgroundColor = '#3b82f6'; };

    document.getElementById('sort-playlists').onchange = (e) => {
      displaySortedPlaylists(e.target.value);
    };

  } catch (error) {
    document.getElementById('playlists-loading').innerHTML = `
      <p style="color: #ef4444;">Error: ${error.message}</p>
    `;
  }
}

function displaySortedPlaylists(sortType) {
  const playlists = [...window.allExportPlaylists];

  switch(sortType) {
    case 'name-asc':
      playlists.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      break;
    case 'name-desc':
      playlists.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
      break;
    case 'updated':
      playlists.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
      break;
    case 'created':
      playlists.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      break;
  }

  const listContainer = document.getElementById('playlists-list');
  listContainer.innerHTML = playlists.map((playlist) => {
    const playlistId = playlist.cardId || playlist.id || playlist._id;
    return `
      <label style="
        display: flex;
        align-items: center;
        padding: 8px;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.2s;
      " onmouseover="this.style.backgroundColor='#f9fafb'" onmouseout="this.style.backgroundColor='transparent'">
        <input type="checkbox" value="${playlistId}" data-title="${playlist.title || playlist.name || 'Untitled'}" style="
          width: 18px;
          height: 18px;
          margin-right: 12px;
          cursor: pointer;
        " class="playlist-checkbox">
        <div style="flex: 1;">
          <div style="font-weight: 500; color: #1f2937;">${playlist.title || playlist.name || 'Untitled'}</div>
        </div>
      </label>
    `;
  }).join('');
}

async function startBulkExport(allPlaylists) {
  // Verify account match before starting export
  // This prevents exporting from wrong account after user switches Yoto accounts
  const verification = await verifyAccountBeforeOperation();

  if (!verification.valid) {
    // Account mismatch or session expired - user has been notified
    return;
  }

  const selectedCheckboxes = document.querySelectorAll('.playlist-checkbox:checked');

  if (selectedCheckboxes.length === 0) {
    showNotification('Please select at least one playlist to export', 'warning');
    return;
  }

  const selectedIds = Array.from(selectedCheckboxes).map(cb => cb.value);

  const selectedPlaylists = allPlaylists.filter(p => {
    const playlistId = p.cardId || p.id || p._id;
    return selectedIds.includes(playlistId);
  });


  // Disable UI controls
  document.getElementById('start-export').disabled = true;
  document.getElementById('cancel-export').disabled = false; // Keep cancel enabled
  document.getElementById('export-progress').style.display = 'block';

  const status = document.getElementById('export-status');
  const progressBar = document.getElementById('export-progress-bar');
  const cancelButton = document.getElementById('cancel-export');

  status.textContent = `Initializing export for ${selectedPlaylists.length} playlists...`;

  try {
    // Send request to service worker to start bulk export
    const response = await chrome.runtime.sendMessage({
      action: 'START_BULK_EXPORT',
      playlists: selectedPlaylists
    });


    if (response.error) {
      console.error('[Bulk Export] Service worker returned error:', response.error);
      throw new Error(response.error);
    }

    // Store manifest ID for tracking
    window.currentExportManifestId = response.manifestId;
    window.exportTotalFiles = response.totalFiles;
    window.exportCompletedFiles = 0;
    window.exportFailedFiles = 0;

    status.textContent = `Starting downloads for ${response.totalFiles} files...`;
    progressBar.style.width = '0%';

    // Set a timeout to show error if no progress within 10 seconds
    window.exportProgressTimeout = setTimeout(() => {
      if (window.exportCompletedFiles === 0 && window.exportFailedFiles === 0) {
        status.textContent = `⚠️ Downloads may be stalled. Check the browser console for errors.`;
        status.style.color = '#f59e0b';
      }
    }, 10000);

    // Update the cancel button to just say "Cancel" with gray styling
    cancelButton.textContent = 'Cancel';
    cancelButton.style.backgroundColor = '#f3f4f6';
    cancelButton.style.color = '#374151';
    cancelButton.style.border = '1px solid #d1d5db';

    // Keep the cancel functionality
    cancelButton.onclick = async () => {
      cancelButton.disabled = true;
      cancelButton.textContent = 'Cancelling...';

      // Cancel the background export
      await chrome.runtime.sendMessage({
        action: 'CANCEL_BULK_EXPORT',
        manifestId: window.currentExportManifestId
      });

      // Remove all modals and indicators
      document.getElementById('yoto-bulk-export-modal')?.remove();
      removeExportStatusIndicator();

      // Clear export state
      window.currentExportManifestId = null;
      window.exportTotalFiles = 0;
      window.exportCompletedFiles = 0;
      window.exportFailedFiles = 0;

      showNotification(chrome.i18n.getMessage('bulkExport_exportCancelled'), 'info');
    };

    // Update UI to show background mode
    const modalContent = document.querySelector('#yoto-bulk-export-modal > div');
    if (modalContent) {
      // Add background mode indicator
      const bgIndicator = document.createElement('div');
      bgIndicator.id = 'bg-mode-indicator';
      bgIndicator.style.cssText = `
        background-color: #10b981;
        color: white;
        padding: 8px 12px;
        border-radius: 6px;
        margin-bottom: 16px;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 8px;
      `;
      bgIndicator.innerHTML = `
        <svg style="width: 16px; height: 16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
        </svg>
        <span>Downloads running in background - You can safely close this modal</span>
      `;
      modalContent.insertBefore(bgIndicator, modalContent.firstChild.nextSibling);
    }

    addExportStatusIndicator();

  } catch (error) {
    console.error('[Bulk Export] Failed to start export:', error);
    status.textContent = `Error: ${error.message}`;
    document.getElementById('start-export').disabled = false;
    showNotification(chrome.i18n.getMessage('bulkExport_exportFailed').replace('{{error}}', error.message), 'error');
  }
}

// Bulk Export Progress Handlers
function handleDownloadProgress(request) {
  if (!window.currentExportManifestId || request.manifestId !== window.currentExportManifestId) return;

  // Update progress if modal is still visible
  const progressBar = document.getElementById('export-progress-bar');
  const status = document.getElementById('export-status');

  if (progressBar && status) {
    // Update individual file progress
  }
}

function handleDownloadCompleted(request) {
  if (!window.currentExportManifestId) return;

  // Clear timeout since we're receiving progress
  if (window.exportProgressTimeout) {
    clearTimeout(window.exportProgressTimeout);
    window.exportProgressTimeout = null;
  }

  window.exportCompletedFiles = (window.exportCompletedFiles || 0) + 1;
  updateExportProgress();
}

function handleDownloadFailed(request) {
  if (!window.currentExportManifestId) return;

  // Clear timeout since we're receiving progress
  if (window.exportProgressTimeout) {
    clearTimeout(window.exportProgressTimeout);
    window.exportProgressTimeout = null;
  }

  window.exportFailedFiles = (window.exportFailedFiles || 0) + 1;
  updateExportProgress();

  console.error(`[Bulk Export] Download failed: ${request.filename} - ${request.error}`);
}

function handleDownloadsStarted(request) {
  if (!window.currentExportManifestId || request.manifestId !== window.currentExportManifestId) return;

  // Don't update status if we're in progressive mode
  if (window.totalPlaylists && window.totalPlaylists > 0) {
    return;
  }

  const status = document.getElementById('export-status');
  if (status) {
    status.textContent = `Downloading ${request.totalFiles} files in background...`;
  }
}

function handleExportCompleted(request) {
  // Use the manifestId from the request or fall back to the window variable
  const manifestId = request.manifestId || window.currentExportManifestId;

  if (!manifestId) {
    console.error('[Bulk Export] No manifestId available for completed export');
    return;
  }

  // Check if this is our export
  if (window.currentExportManifestId && manifestId !== window.currentExportManifestId) {
    return;
  }

  const status = document.getElementById('export-status');
  const progressBar = document.getElementById('export-progress-bar');
  const stats = request.stats || { completed: window.exportCompletedFiles, failed: window.exportFailedFiles };

  if (status && progressBar) {
    progressBar.style.width = '100%';
    const failedText = stats.failed > 0 ? ` (${stats.failed} failed)` : '';
    const zipMsg = stats.failed > 0
      ? chrome.i18n.getMessage('bulkExport_creatingZipWithFailed')
          .replace('{{completed}}', stats.completed)
          .replace('{{failed}}', stats.failed)
      : chrome.i18n.getMessage('bulkExport_creatingZipWithFiles')
          .replace('{{completed}}', stats.completed);
    status.textContent = zipMsg;
  }

  // Automatically download the ZIP

  (async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'DOWNLOAD_EXPORT_ZIP',
        manifestId: manifestId
      });
      if (response && response.error !== 'Unknown action') {
      }

      if (response && response.success) {
      } else if (response && response.error && response.error !== 'Unknown action') {
        throw new Error(response.error);
      }

      if (status) {
        status.textContent = chrome.i18n.getMessage('bulkExport_statusCreatingZip');
      }
    } catch (error) {
      if (error.message !== 'Unknown action') {
        console.error('[Bulk Export] Failed to create ZIP:', error);
        if (status) {
          status.textContent = `Failed to create ZIP: ${error.message}`;
        }
        showNotification(chrome.i18n.getMessage('bulkExport_zipFailed'), 'error');
      }
    }
  })();

  // Update the floating indicator to show completion
  const indicator = document.getElementById('yoto-export-indicator');
  if (indicator) {
    // Change color to green for completion
    indicator.style.background = 'linear-gradient(135deg, #10b981, #059669)';

    // Update the spinner to a checkmark
    const spinnerDiv = indicator.querySelector('div:first-child');
    if (spinnerDiv) {
      spinnerDiv.style.animation = 'none';
      spinnerDiv.style.border = 'none';
      spinnerDiv.innerHTML = `
        <svg style="width: 24px; height: 24px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path>
        </svg>
      `;
    }

    // Update status text
    const statusText = document.getElementById('export-indicator-status');
    if (statusText) {
      statusText.textContent = stats.failed > 0
          ? chrome.i18n.getMessage('bulkExport_creatingZipWithFailed')
              .replace('{{completed}}', stats.completed)
              .replace('{{failed}}', stats.failed)
          : chrome.i18n.getMessage('bulkExport_statusComplete');
    }

    // Show notification
    showNotification('Export complete! Click the indicator to download ZIP.', 'success');
  }

  // Clear the export reference after a delay
  setTimeout(() => {
    window.currentExportManifestId = null;
    window.exportTotalFiles = 0;
    window.exportCompletedFiles = 0;
    window.exportFailedFiles = 0;
  }, 5000);
}

function updateExportProgress() {
  const progressBar = document.getElementById('export-progress-bar');
  const status = document.getElementById('export-status');

  if (progressBar && status && window.exportTotalFiles) {
    const completed = window.exportCompletedFiles || 0;
    const failed = window.exportFailedFiles || 0;
    const total = window.exportTotalFiles;
    const processed = completed + failed;
    const percentage = (processed / total) * 100;

    progressBar.style.width = `${percentage}%`;

    status.textContent = failed > 0
        ? chrome.i18n.getMessage('bulkExport_downloadProgressWithFailed')
            .replace('{{processed}}', processed)
            .replace('{{total}}', total)
            .replace('{{failed}}', failed)
        : chrome.i18n.getMessage('bulkExport_downloadProgress')
            .replace('{{processed}}', processed)
            .replace('{{total}}', total);
  }

  updateExportProgressModal();
  updateExportStatusIndicator();
}

// Add floating status indicator for background exports
function addExportStatusIndicator() {
  // Remove existing indicator if present
  const existing = document.getElementById('yoto-export-indicator');
  if (existing) existing.remove();

  const indicator = document.createElement('div');
  indicator.id = 'yoto-export-indicator';
  indicator.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: linear-gradient(135deg, #3b82f6, #2563eb);
    color: white;
    padding: 12px 16px;
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    cursor: pointer;
    z-index: 9999;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.3s ease;
    animation: slideIn 0.3s ease-out;
  `;

  indicator.title = 'Click to view export progress';

  indicator.innerHTML = `
    <div style="
      width: 24px;
      height: 24px;
      border: 3px solid rgba(255, 255, 255, 0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    "></div>
    <div style="flex: 1;">
      <div style="font-size: 12px; opacity: 0.9;">${chrome.i18n.getMessage('bulkExport_floatingIndicator')}</div>
      <div id="export-indicator-status" style="font-size: 11px; opacity: 0.8;">Processing...</div>
    </div>
  `;

  // Add hover effect
  indicator.onmouseover = () => {
    indicator.style.transform = 'scale(1.05)';
    indicator.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.2)';
  };

  indicator.onmouseout = () => {
    indicator.style.transform = 'scale(1)';
    indicator.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
  };

  // Click to reopen modal where user can cancel or monitor progress
  indicator.onclick = () => {
    reopenExportModal();
  };

  document.body.appendChild(indicator);

  // Add animation styles
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(400px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);

  updateExportStatusIndicator();
}

function updateExportProgressModal() {
  const modal = document.getElementById('yoto-bulk-export-modal');
  if (!modal || !window.currentExportManifestId) return;

  const completed = window.exportCompletedFiles || 0;
  const failed = window.exportFailedFiles || 0;
  const total = window.exportTotalFiles || 0;
  const processed = completed + failed;
  const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;

  const progressBar = modal.querySelector('div[style*="background: linear-gradient"]');
  if (progressBar) {
    progressBar.style.width = `${percentage}%`;
  }

  const statusText = modal.querySelector('p[style*="margin-bottom: 12px"]');
  if (statusText) {
    const statusLabel = chrome.i18n.getMessage('bulkExport_statusLabel');
    const statusValue = percentage === 100
      ? chrome.i18n.getMessage('bulkExport_statusComplete')
      : chrome.i18n.getMessage('bulkExport_statusDownloading');
    statusText.innerHTML = `<strong>${statusLabel}</strong> ${statusValue}`;
  }

  // Update the file count
  const fileCountSpan = modal.querySelector('span');
  if (fileCountSpan && fileCountSpan.textContent.includes('of')) {
    fileCountSpan.textContent = `${processed} of ${total} files`;
  }

  const percentageSpans = modal.querySelectorAll('span');
  percentageSpans.forEach(span => {
    if (span.textContent.includes('%') && !span.textContent.includes('of')) {
      span.textContent = `${percentage}%`;
    }
  });

  const failedWarning = modal.querySelector('p[style*="color: #ef4444"]');
  if (failed > 0) {
    if (!failedWarning) {
      const warningContainer = modal.querySelector('div[style*="background-color: #f3f4f6"]');
      if (warningContainer) {
        const warning = document.createElement('p');
        warning.style.cssText = 'color: #ef4444; font-size: 13px; margin-top: 8px;';
        warning.textContent = `⚠️ ${failed} files failed to download`;
        warningContainer.appendChild(warning);
      }
    } else {
      failedWarning.textContent = `⚠️ ${failed} files failed to download`;
    }
  }

  if (percentage === 100) {
    const completionDiv = modal.querySelector('div[style*="background-color: #10b981"]');
    if (!completionDiv) {
      const modalContent = modal.querySelector('div[style*="background-color: white"]');
      const existingCompletion = modalContent.querySelector('div[style*="display: flex; justify-content: center"]');
      if (!existingCompletion) {
        const completionHTML = `
          <div style="display: flex; justify-content: center; margin-top: 16px;">
            <div style="
              background-color: #10b981;
              color: white;
              padding: 10px 20px;
              border-radius: 6px;
              font-size: 14px;
              text-align: center;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 8px;
            ">
              <svg style="width: 16px; height: 16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
              </svg>
              ZIP Downloaded to Downloads folder
            </div>
          </div>
        `;
        modalContent.insertAdjacentHTML('beforeend', completionHTML);
      }
    }
  }
}

function updateExportStatusIndicator() {
  const indicator = document.getElementById('export-indicator-status');
  if (!indicator || !window.currentExportManifestId) return;

  // Check if we're in progressive mode
  const isProgressive = window.totalPlaylists && window.totalPlaylists > 0;

  if (isProgressive) {
    // Show playlist progress for progressive exports
    const completedPlaylists = window.completedPlaylists || 0;
    const totalPlaylists = window.totalPlaylists || 0;
    const percentage = totalPlaylists > 0 ? Math.round((completedPlaylists / totalPlaylists) * 100) : 0;

    indicator.textContent = `${percentage}% (${completedPlaylists}/${totalPlaylists} playlists)`;
  } else {
    // Show file progress for old-style exports
    const completed = window.exportCompletedFiles || 0;
    const failed = window.exportFailedFiles || 0;
    const total = window.exportTotalFiles || 0;
    const processed = completed + failed;
    const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;

    indicator.textContent = `${percentage}% (${processed}/${total} files)`;
  }
}

// Remove the status indicator
function removeExportStatusIndicator() {
  const indicator = document.getElementById('yoto-export-indicator');
  if (indicator) {
    indicator.style.animation = 'slideOut 0.3s ease-out forwards';
    setTimeout(() => indicator.remove(), 300);
  }
}

async function checkForActiveExport() {
  try {
    const storage = await chrome.storage.local.get(null);

    // Clean up any stale manifests from previous sessions
    // Only show indicator if there's a truly active export happening right now
    let hasActiveExport = false;
    const staleManifeststoClean = [];

    for (const key in storage) {
      if (key.startsWith('manifest_')) {
        const manifest = storage[key];

        // Check if this manifest is stale (older than 30 minutes)
        const isStale = manifest && manifest.timestamp &&
          (Date.now() - manifest.timestamp > 30 * 60 * 1000);

        if (isStale || manifest?.status === 'completed' || manifest?.status === 'cancelled') {
          // Mark for cleanup
          staleManifeststoClean.push(key);
        } else if (manifest && manifest.status === 'downloading' && !isStale) {
          // Only consider it active if it's recent and actually downloading
          const manifestId = key.replace('manifest_', '');

          // For old-style exports only (has files property)
          if (manifest.files) {
            hasActiveExport = true;
            window.currentExportManifestId = manifestId;

            // Calculate progress
            const files = Object.values(manifest.files || {});
            const completed = files.filter(f => f.stored).length;
            const failed = files.filter(f => f.failed).length;
            const total = files.length;

            window.exportTotalFiles = total;
            window.exportCompletedFiles = completed;
            window.exportFailedFiles = failed;

            // Only add indicator for genuinely active exports
            addExportStatusIndicator();
            showNotification('Bulk export is still running in the background', 'info');
          }

          break; // Only handle one active export
        }
      }
    }

    // Clean up stale manifests
    if (staleManifeststoClean.length > 0) {
      await chrome.storage.local.remove(staleManifeststoClean);
    }

    // Check for active progressive export based on window variables
    // Consider it stale if older than 30 minutes
    if (window.progressiveExportStartTime &&
        (Date.now() - window.progressiveExportStartTime < 30 * 60 * 1000) &&
        window.totalPlaylists && window.completedPlaylists < window.totalPlaylists) {
      // There's an active progressive export - show indicator
      addExportStatusIndicator();
      hasActiveExport = true;
    }

    // Clear any stale window variables if no active export
    if (!hasActiveExport) {
      window.currentExportManifestId = null;
      window.exportTotalFiles = null;
      window.exportCompletedFiles = null;
      window.exportFailedFiles = null;
      window.totalPlaylists = null;
      window.completedPlaylists = null;
      window.failedPlaylistTitles = null;
      window.progressiveExportStartTime = null;
    }
  } catch (error) {
  }
}

// Reopen the export modal to check status
async function reopenExportModal() {
  // Check if modal already exists
  const existingModal = document.getElementById('yoto-bulk-export-modal');
  if (existingModal) {
    existingModal.style.display = 'flex';
    return;
  }

  // Create a simplified status modal
  const modal = document.createElement('div');
  modal.id = 'yoto-bulk-export-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 999999;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(0, 0, 0, 0.5);
    animation: fadeIn 0.3s ease-out;
  `;

  const completed = window.exportCompletedFiles || 0;
  const failed = window.exportFailedFiles || 0;
  const total = window.exportTotalFiles || 0;
  const processed = completed + failed;
  const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;

  // Determine if we're in progressive mode
  const isProgressive = window.totalPlaylists && window.totalPlaylists > 0;
  const progressiveCompleted = window.completedPlaylists || 0;
  const progressiveTotal = window.totalPlaylists || 0;
  const progressivePercentage = progressiveTotal > 0 ? Math.round((progressiveCompleted / progressiveTotal) * 100) : 0;

  modal.innerHTML = `
    <div style="
      background-color: white;
      border-radius: 12px;
      padding: 24px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
      animation: scaleIn 0.3s ease-out;
      position: relative;
    ">
      <h2 style="font-size: 20px; font-weight: bold; color: #1f2937; margin: 0 0 20px 0;">${chrome.i18n.getMessage('bulkExport_progressTitle')}</h2>
      <button id="close-modal" style="
        position: absolute;
        top: 12px;
        right: 12px;
        background: none;
        border: none;
        font-size: 20px;
        color: #9ca3af;
        cursor: pointer;
        padding: 4px;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: all 0.2s;
      " onmouseover="this.style.backgroundColor='#f3f4f6'; this.style.color='#6b7280';" onmouseout="this.style.backgroundColor='transparent'; this.style.color='#9ca3af';">×</button>

      <!-- Add export-progress container for progressive mode -->
      <div id="export-progress" style="${isProgressive ? 'display: block;' : 'display: none;'} margin-bottom: 16px;">
        <div style="
          background-color: #f3f4f6;
          border-radius: 6px;
          padding: 12px;
        ">
          <p id="export-status" style="margin-bottom: 8px; font-size: 14px; color: #374151;">
            ${isProgressive ? `Processing playlist ${progressiveCompleted} of ${progressiveTotal}` : ''}
          </p>
          <div style="
            background-color: #e5e7eb;
            height: 8px;
            border-radius: 4px;
            overflow: hidden;
          ">
            <div id="export-progress-bar" style="
              height: 100%;
              background-color: #3b82f6;
              width: ${progressivePercentage}%;
              transition: width 0.3s;
            "></div>
          </div>
        </div>
      </div>

      <!-- Original status for non-progressive mode -->
      <div style="
        background-color: #f3f4f6;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 20px;
        ${isProgressive ? 'display: none;' : 'display: block;'}
      ">
        <p style="margin-bottom: 12px; font-size: 14px; color: #374151;">
          <strong>${chrome.i18n.getMessage('bulkExport_statusLabel')}</strong> ${percentage === 100 ? chrome.i18n.getMessage('bulkExport_statusComplete') : chrome.i18n.getMessage('bulkExport_statusDownloading')}
        </p>

        <div style="margin-bottom: 8px;">
          <div style="display: flex; justify-content: space-between; font-size: 13px; color: #6b7280; margin-bottom: 4px;">
            <span>${processed} of ${total} files</span>
            <span>${percentage}%</span>
          </div>
          <div style="
            background-color: #e5e7eb;
            height: 8px;
            border-radius: 4px;
            overflow: hidden;
          ">
            <div style="
              height: 100%;
              background: linear-gradient(90deg, #3b82f6, #2563eb);
              width: ${percentage}%;
              transition: width 0.3s;
            "></div>
          </div>
        </div>

        ${failed > 0 ? `
          <p style="color: #ef4444; font-size: 13px; margin-top: 8px;">
            ⚠️ ${failed} files failed to download
          </p>
        ` : ''}
      </div>

      ${percentage === 100 ? `
      <div style="display: flex; justify-content: center; margin-top: 16px;">
        <div style="
          background-color: #10b981;
          color: white;
          padding: 10px 20px;
          border-radius: 6px;
          font-size: 14px;
          text-align: center;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        ">
          <svg style="width: 16px; height: 16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
          </svg>
          ZIP Downloaded to Downloads folder
        </div>
      </div>
      ` : ''}
    </div>
  `;

  document.body.appendChild(modal);

  const closeBtn = document.getElementById('close-modal');
  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.remove();
      if (window.exportProgressModalInterval) {
        clearInterval(window.exportProgressModalInterval);
        window.exportProgressModalInterval = null;
      }
    };
  }

  // Add animation styles if not already present
  if (!document.getElementById('export-modal-styles')) {
    const style = document.createElement('style');
    style.id = 'export-modal-styles';
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes scaleIn {
        from { transform: scale(0.9); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }
      @keyframes slideOut {
        to { transform: translateX(400px); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  // Add cancel button if export is still in progress
  if (percentage < 100) {
    const cancelBtnContainer = document.createElement('div');
    cancelBtnContainer.style.cssText = 'display: flex; justify-content: center; margin-top: 16px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'cancel-export-btn';
    cancelBtn.style.cssText = `
      background-color: #f3f4f6;
      color: #374151;
      border: 1px solid #d1d5db;
      padding: 10px 20px;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
      transition: background-color 0.2s;
    `;
    cancelBtn.textContent = 'Cancel Export';
    cancelBtn.onmouseover = () => {
      cancelBtn.style.backgroundColor = '#e5e7eb';
    };
    cancelBtn.onmouseout = () => {
      cancelBtn.style.backgroundColor = '#f3f4f6';
    };
    cancelBtn.onclick = async () => {
      cancelBtn.disabled = true;
      cancelBtn.textContent = 'Cancelling...';

      // Clear the update interval
      if (window.exportProgressModalInterval) {
        clearInterval(window.exportProgressModalInterval);
        window.exportProgressModalInterval = null;
      }

      // Send cancel request to service worker
      await chrome.runtime.sendMessage({
        action: 'CANCEL_BULK_EXPORT',
        manifestId: window.currentExportManifestId
      });

      // Remove all modals and indicators
      modal.remove();
      removeExportStatusIndicator();

      // Clear export state
      window.currentExportManifestId = null;
      window.exportTotalFiles = 0;
      window.exportCompletedFiles = 0;
      window.exportFailedFiles = 0;

      showNotification(chrome.i18n.getMessage('bulkExport_exportCancelled'), 'info');
    };

    cancelBtnContainer.appendChild(cancelBtn);
    modal.querySelector('div[style*="background-color: white"]').appendChild(cancelBtnContainer);
  }

  // Event handlers
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.remove();
      if (window.exportProgressModalInterval) {
        clearInterval(window.exportProgressModalInterval);
        window.exportProgressModalInterval = null;
      }
    }
  };

  if (percentage < 100) {
    window.exportProgressModalInterval = setInterval(() => {
      updateExportProgressModal();

      const currentPercentage = window.exportTotalFiles > 0 ?
        Math.round(((window.exportCompletedFiles || 0) + (window.exportFailedFiles || 0)) / window.exportTotalFiles * 100) : 0;

      if (currentPercentage >= 100 || !window.currentExportManifestId) {
        clearInterval(window.exportProgressModalInterval);
        window.exportProgressModalInterval = null;
      }
    }, 500); // Update every 500ms for smooth progress
  }
}

async function exportPlaylist(playlist) {
  const playlistId = playlist.cardId || playlist.id || playlist._id;

  const response = await chrome.runtime.sendMessage({
    action: 'RESOLVE_PLAYLIST',
    playlistId: playlistId
  });

  if (response.error) {
    console.error('[Bulk Export] Resolve error:', response.error);
    throw new Error(response.error);
  }

  if (response.warning) {
    console.warn('[Bulk Export] Warning:', response.warning);
    showNotification(response.warning, 'warning');
  }

  const resolvedData = response.data;


  const folderName = sanitizeFolderName(playlist.title || 'Untitled');

  const exportData = {
    folderName: folderName,
    audioFiles: [],
    coverImage: null,
    iconImages: []
  };

  // Try different possible structures for cover image
  let coverUrl = resolvedData.card?.metadata?.cover?.imageL ||
                 resolvedData.card?.content?.cover?.imageL ||
                 resolvedData.metadata?.cover?.imageL ||
                 resolvedData.metadata?.cover?.imageS ||
                 resolvedData.cover?.imageL ||
                 resolvedData.coverImageL;

  if (coverUrl && coverUrl.startsWith('yoto:#')) {
    const coverId = coverUrl.replace('yoto:#', '');
    coverUrl = `https://api.yotoplay.com/media/${coverId}`;
  }

  if (coverUrl) {
    const urlParts = coverUrl.split('.');
    const extension = urlParts.length > 1 ? urlParts[urlParts.length - 1].split('?')[0] : 'jpg';

    exportData.coverImage = {
      url: coverUrl,
      filename: `${folderName}-cover.${extension}`
    };
  }

  // Try to find chapters in different possible locations
  const chapters = resolvedData.card?.content?.chapters ||
                  resolvedData.content?.chapters ||
                  resolvedData.chapters ||
                  resolvedData.tracks ||
                  [];

  if (chapters && chapters.length > 0) {

    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];

      // NEW: Check if chapter has tracks array (as shown in the actual data)
      if (chapter.tracks && chapter.tracks.length > 0) {
        // Chapter has multiple tracks, process each one
        for (let j = 0; j < chapter.tracks.length; j++) {
          const track = chapter.tracks[j];
          let trackUrl = track.trackUrl || track.url || track.audioUrl || track.mediaUrl;

          if (!trackUrl && track.downloadUrl) {
            trackUrl = track.downloadUrl;
          }
          if (!trackUrl && track.contentUrl) {
            trackUrl = track.contentUrl;
          }

          if (trackUrl && (trackUrl.startsWith('http://') || trackUrl.startsWith('https://'))) {
            const trackNumber = String(i + 1).padStart(2, '0');
            const trackSubNumber = chapter.tracks.length > 1 ? `-${String(j + 1).padStart(2, '0')}` : '';
            const trackTitle = sanitizeFilename(track.title || chapter.title || `Track ${i + 1}`);
            exportData.audioFiles.push({
              url: trackUrl,
              filename: `${trackNumber}${trackSubNumber} - ${trackTitle}.mp3`
            });
          } else if (trackUrl && trackUrl.startsWith('yoto:#')) {
            exportData.protectedTracks = (exportData.protectedTracks || 0) + 1;
          } else {

            // Use track's icon if available (preferred over chapter icon)
            let trackIconUrl = track.display?.icon16x16 ||
                                track.display?.displayIcon?.imageL ||
                                track.display?.displayIcon?.imageS;

            // Convert yoto:# icon URLs to actual downloadable URLs
            if (trackIconUrl && trackIconUrl.startsWith('yoto:#')) {
              const iconId = trackIconUrl.replace('yoto:#', '');
              trackIconUrl = `https://api.yotoplay.com/media/${iconId}`;
            }

            if (trackIconUrl) {
              const iconFilename = chapter.tracks.length > 1 ? `icon-${i}-${j}.png` : `icon-${i}.png`;
              exportData.iconImages.push({
                url: trackIconUrl,
                filename: iconFilename
              });
            }
          }
        }
      } else {
        // Fallback to old structure (single track per chapter)
        let trackUrl = chapter.track?.trackUrl ||
                      chapter.track?.url ||
                      chapter.trackUrl ||
                      chapter.url ||
                      chapter.audio?.url ||
                      chapter.audioUrl ||
                      chapter.mediaUrl ||
                      chapter.downloadUrl ||
                      chapter.contentUrl;

        // Process the URL if it's a valid http/https URL
        if (trackUrl && (trackUrl.startsWith('http://') || trackUrl.startsWith('https://'))) {
          const trackNumber = String(i + 1).padStart(2, '0');
          const trackTitle = sanitizeFilename(chapter.title || `Track ${i + 1}`);
          exportData.audioFiles.push({
            url: trackUrl,
            filename: `${trackNumber} - ${trackTitle}.mp3`
          });
        } else if (trackUrl && trackUrl.startsWith('yoto:#')) {
          exportData.protectedTracks = (exportData.protectedTracks || 0) + 1;
        } else {
        }
      }

      // Only use chapter-level icon if we didn't get track-level icons
      // (track-level icons are handled inside the tracks loop above)
      if (!chapter.tracks || chapter.tracks.length === 0) {
        let iconUrl = chapter.display?.icon16x16 ||  // From actual data structure
                     chapter.display?.displayIcon?.imageL ||
                     chapter.display?.displayIcon?.imageS ||
                     chapter.displayIcon?.imageL ||
                     chapter.icon?.imageL ||
                     chapter.iconImageL;

        // Convert yoto:# icon URLs to actual downloadable URLs
        if (iconUrl && iconUrl.startsWith('yoto:#')) {
          const iconId = iconUrl.replace('yoto:#', '');
          iconUrl = `https://api.yotoplay.com/media/${iconId}`;
        }

        if (iconUrl) {
          exportData.iconImages.push({
            url: iconUrl,
            filename: `icon-${i}.png`
          });
        }
      } else if (chapter.tracks && !chapter.tracks.some(t => t.display?.icon16x16)) {
        // If tracks don't have icons, fall back to chapter icon
        let chapterIconUrl = chapter.display?.icon16x16 ||
                            chapter.display?.displayIcon?.imageL ||
                            chapter.display?.displayIcon?.imageS;

        // Convert yoto:# icon URLs to actual downloadable URLs
        if (chapterIconUrl && chapterIconUrl.startsWith('yoto:#')) {
          const iconId = chapterIconUrl.replace('yoto:#', '');
          chapterIconUrl = `https://api.yotoplay.com/media/${iconId}`;
        }

        if (chapterIconUrl) {
          exportData.iconImages.push({
            url: chapterIconUrl,
            filename: `icon-${i}.png`
          });
        }
      }
    }
  } else {
  }


  if (exportData.protectedTracks > 0) {
    const warningMsg = chrome.i18n.getMessage('bulkExport_protectedContent').replace('{{count}}', exportData.protectedTracks);
    console.warn(`[Bulk Export] ${warningMsg}`);
    showNotification(warningMsg, 'warning');
  }

  // Check if we have anything to export
  if (exportData.audioFiles.length === 0 && exportData.iconImages.length === 0 && !exportData.coverImage) {
    console.warn('[Bulk Export] No exportable content found for this playlist');

    if (exportData.protectedTracks > 0) {
      throw new Error(chrome.i18n.getMessage('bulkExport_protectedOnly').replace('{{count}}', exportData.protectedTracks));
    } else {
      throw new Error(chrome.i18n.getMessage('bulkExport_noContent'));
    }
  }

  await downloadExportData(exportData);
}

async function downloadExportData(exportData) {

  try {
    const zip = new JSZip();
    const folder = zip.folder(exportData.folderName);
    const audioFolder = folder.folder('audio');
    const coverFolder = folder.folder('cover');
    const iconsFolder = folder.folder('icons');

    const downloadFile = async (url, folder, filename) => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch ${filename}: ${response.status}`);
        const blob = await response.blob();
        folder.file(filename, blob);
        return true;
      } catch (error) {
        console.error(`[Bulk Export] Failed to download ${filename}:`, error);
        return false;
      }
    };

    const downloadPromises = [];

    for (const audio of exportData.audioFiles) {
      downloadPromises.push(downloadFile(audio.url, audioFolder, audio.filename));
    }

    if (exportData.coverImage) {
      downloadPromises.push(downloadFile(exportData.coverImage.url, coverFolder, exportData.coverImage.filename));
    }

    for (const icon of exportData.iconImages) {
      downloadPromises.push(downloadFile(icon.url, iconsFolder, icon.filename));
    }

    const results = await Promise.all(downloadPromises);
    const successCount = results.filter(r => r).length;

    const content = await zip.generateAsync({ type: 'blob' });

    const downloadUrl = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = downloadUrl;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    a.download = `${exportData.folderName}_${timestamp}.zip`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);

  } catch (error) {
    console.error('[Bulk Export] Error in downloadExportData:', error);
    throw error;
  }
}

function sanitizeFolderName(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
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
      <h2 style="font-size: 20px; font-weight: bold; margin-bottom: 16px; color: #1f2937;">${chrome.i18n.getMessage('modal_chooseImportMethod')}</h2>
      <p style="color: #6b7280; margin-bottom: 24px;">${chrome.i18n.getMessage('modal_selectHowToImport')}</p>
      
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
          <span>${chrome.i18n.getMessage('button_importZipFile')}</span>
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
          <span>${chrome.i18n.getMessage('button_importFolder')}</span>
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
        ${chrome.i18n.getMessage('button_cancel')}
      </button>
    </div>
  `;
  
  document.body.appendChild(modal);
  
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

async function showCardSelectionModal() {
  const existingModal = document.getElementById('yoto-card-selection-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'yoto-card-selection-modal';
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
    padding-top: 10vh;
    background-color: rgba(0, 0, 0, 0.5);
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    background-color: white;
    border-radius: 12px;
    padding: 24px;
    max-width: 600px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    margin: 0 16px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  `;

  content.innerHTML = `
    <h2 style="font-size: 18px; font-weight: 600; margin-bottom: 16px; color: #1f2937;">${chrome.i18n.getMessage('modal_selectCardToUpdate')}</h2>
    <p style="color: #6b7280; margin-bottom: 20px;">${chrome.i18n.getMessage('modal_chooseCardDescription')}</p>

    <div style="margin-bottom: 20px;">
      <input type="text" id="card-search-input" placeholder="${chrome.i18n.getMessage('input_searchCards')}" style="
        width: 100%;
        padding: 10px 12px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 14px;
        outline: none;
        transition: border-color 0.2s;
      " onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#d1d5db'">
    </div>

    <div id="cards-loading" style="text-align: center; padding: 40px;">
      <div style="display: inline-block; width: 40px; height: 40px; border: 3px solid #f3f4f6; border-top-color: #3b82f6; border-radius: 50%; animation: spin 1s linear infinite;"></div>
      <p style="margin-top: 10px; color: #6b7280;">${chrome.i18n.getMessage('status_loadingCards')}</p>
    </div>

    <div id="cards-list" style="display: none;">
      <!-- Cards will be populated here -->
    </div>

    <button id="card-cancel-btn" style="
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
      ${chrome.i18n.getMessage('button_cancel')}
    </button>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

  content.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  try {
    const cardsResponse = await chrome.runtime.sendMessage({ action: 'GET_USER_CARDS' });
    const loadingDiv = document.getElementById('cards-loading');
    const listDiv = document.getElementById('cards-list');

    if (cardsResponse && cardsResponse.cards && cardsResponse.cards.length > 0) {
      loadingDiv.style.display = 'none';
      listDiv.style.display = 'block';

      const sortedCards = cardsResponse.cards.sort((a, b) =>
        new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
      );

      displayCards(sortedCards, listDiv);

      const searchInput = document.getElementById('card-search-input');
      searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const filteredCards = sortedCards.filter(card =>
          (card.title || chrome.i18n.getMessage('label_untitledCard')).toLowerCase().includes(searchTerm)
        );
        displayCards(filteredCards, listDiv);
      });
    } else {
      loadingDiv.innerHTML = `
        <p style="color: #6b7280;">No MYO cards found. Please create a card first.</p>
      `;
    }
  } catch (error) {
    document.getElementById('cards-loading').innerHTML = `
      <p style="color: #ef4444;">${chrome.i18n.getMessage('error_loadingCards')}</p>
    `;
  }

  document.getElementById('card-cancel-btn').addEventListener('click', () => {
    modal.remove();
  });
}

function displayCards(cards, container) {
  container.innerHTML = cards.map(card => {
    let trackCount = 0;

    if (card.content?.chapters) {
      trackCount = card.content.chapters.reduce((sum, ch) =>
        sum + (ch.tracks?.length || 1), 0);
    }
    else if (card.chapters) {
      trackCount = card.chapters.reduce((sum, ch) =>
        sum + (ch.tracks?.length || 1), 0);
    }
    else if (card.tracks) {
      trackCount = card.tracks.length;
    }
    else if (card.chapterCount) {
      trackCount = card.chapterCount;
    } else if (card.trackCount) {
      trackCount = card.trackCount;
    }

    const lastUpdated = card.updatedAt ?
      new Date(card.updatedAt).toLocaleDateString() :
      chrome.i18n.getMessage('label_unknown');

    return `
      <div class="card-item" data-card-id="${card.cardId || card.id}" style="
        padding: 10px 12px;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        margin-bottom: 8px;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: space-between;
      " onmouseover="this.style.backgroundColor='#f9fafb'; this.style.borderColor='#3b82f6'; this.style.boxShadow='0 1px 3px rgba(0,0,0,0.1)'"
         onmouseout="this.style.backgroundColor='transparent'; this.style.borderColor='#e5e7eb'; this.style.boxShadow='none'">
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <svg style="width: 16px; height: 16px; color: #9ca3af; flex-shrink: 0;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path>
            </svg>
            <h3 style="margin: 0; font-size: 14px; font-weight: 600; color: #1f2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${card.title || card.name || chrome.i18n.getMessage('label_untitledCard')}
            </h3>
          </div>
          <p style="margin: 4px 0 0 24px; font-size: 11px; color: #6b7280;">
            ${trackCount > 0 ? `${trackCount} track${trackCount !== 1 ? 's' : ''} • ` : ''}Updated ${lastUpdated}
          </p>
        </div>
        <svg style="width: 20px; height: 20px; color: #9ca3af; flex-shrink: 0; margin-left: 12px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
        </svg>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.card-item').forEach(item => {
    item.addEventListener('click', () => {
      const cardId = item.dataset.cardId;
      const cardTitle = item.querySelector('h3').textContent;
      selectCardForUpdate(cardId, cardTitle);
    });
  });
}

async function selectCardForUpdate(cardId, cardTitle) {
  const selectionModal = document.getElementById('yoto-card-selection-modal');
  if (selectionModal) selectionModal.remove();

  chrome.runtime.sendMessage({
    action: 'TRACK_EVENT',
    eventName: 'update_card_selected',
    parameters: {
      cardId: cardId
    }
  });

  state.updateCardId = cardId;
  state.updateCardTitle = cardTitle;

  showUpdateImportOptionsModal(cardId, cardTitle);
}

function showUpdateImportOptionsModal(cardId, cardTitle) {
  const existingModal = document.getElementById('yoto-update-import-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'yoto-update-import-modal';
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
      <h2 style="font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #1f2937;">${chrome.i18n.getMessage('label_update')} ${cardTitle}</h2>
      <p style="color: #6b7280; margin-bottom: 24px;">${chrome.i18n.getMessage('modal_selectFilesToAdd')}</p>

      <div style="display: flex; flex-direction: column; gap: 12px;">
        <button id="update-zip-btn" style="
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
          <span>${chrome.i18n.getMessage('button_importZipFile')}</span>
        </button>

        <button id="update-folder-btn" style="
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
          <span>${chrome.i18n.getMessage('button_importFolder')}</span>
        </button>
      </div>

      <button id="update-cancel-btn" style="
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
        ${chrome.i18n.getMessage('button_cancel')}
      </button>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById('update-zip-btn').addEventListener('click', () => {
    modal.remove();
    selectZipFileForUpdate(cardId);
  });

  document.getElementById('update-folder-btn').addEventListener('click', () => {
    modal.remove();
    selectFolderForUpdate(cardId);
  });

  document.getElementById('update-cancel-btn').addEventListener('click', () => {
    modal.remove();
  });
}

function showBulkImportOptionsModal(preSelectedFiles = null, preSelectedZipFile = null) {
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

  const modalTitle = preSelectedFiles || preSelectedZipFile ?
    chrome.i18n.getMessage('modal_multiplePlaylistsDetected') :
    chrome.i18n.getMessage('modal_bulkImportSettings');

  const modalDescription = preSelectedFiles || preSelectedZipFile ?
    chrome.i18n.getMessage('modal_chooseImportMethod') :
    chrome.i18n.getMessage('modal_selectZipOrFolder');

  modal.innerHTML = `
    <div style="
      background-color: white;
      border-radius: 8px;
      padding: 24px;
      max-width: 450px;
      width: 90%;
      margin: 0 16px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    ">
      <h2 style="font-size: 20px; font-weight: bold; margin-bottom: 16px; color: #1f2937;">${modalTitle}</h2>
      <p style="color: #6b7280; margin-bottom: 20px;">${modalDescription}</p>

      <div style="
        background-color: #f3f4f6;
        border-radius: 6px;
        padding: 16px;
        margin-bottom: 20px;
      ">
        <label style="display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 12px;">
          ${chrome.i18n.getMessage('label_importMode')}
        </label>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input type="radio" name="import-mode" value="separate" checked style="width: 16px; height: 16px;">
            <div>
              <div style="font-size: 14px; font-weight: 500; color: #1f2937;">${chrome.i18n.getMessage('label_separatePlaylists')}</div>
              <div style="font-size: 12px; color: #6b7280;">${chrome.i18n.getMessage('label_separatePlaylistsDescription')}</div>
            </div>
          </label>
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input type="radio" name="import-mode" value="merged" style="width: 16px; height: 16px;">
            <div>
              <div style="font-size: 14px; font-weight: 500; color: #1f2937;">${chrome.i18n.getMessage('label_singleMergedPlaylist')}</div>
              <div style="font-size: 12px; color: #6b7280;">${chrome.i18n.getMessage('label_singlePlaylistDescription')}</div>
            </div>
          </label>
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 12px;">
        ${preSelectedFiles || preSelectedZipFile ? `
          <button id="bulk-import-continue-btn" style="
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
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
            </svg>
            <span>${chrome.i18n.getMessage('button_continueImport')}</span>
          </button>
        ` : `
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
            <span>${chrome.i18n.getMessage('button_selectZipFile')}</span>
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
            <span>${chrome.i18n.getMessage('button_selectFolder')}</span>
          </button>
        `}
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
        ${chrome.i18n.getMessage('button_cancel')}
      </button>
    </div>
  `;

  document.body.appendChild(modal);

  if (preSelectedFiles || preSelectedZipFile) {
    const continueBtn = document.getElementById('bulk-import-continue-btn');
    if (continueBtn) {
      continueBtn.addEventListener('click', async () => {
        const importMode = document.querySelector('input[name="import-mode"]:checked').value;
        modal.remove();

        showNotification(
          chrome.i18n.getMessage('status_processingBulkFolder'),
          'info'
        );

        if (preSelectedFiles) {
          await processBulkFolderFiles(preSelectedFiles, importMode);
        } else if (preSelectedZipFile) {
          await processBulkZipFile(preSelectedZipFile, importMode);
        }
      });
    }
  } else {
    const zipBtn = document.getElementById('bulk-import-zip-btn');
    const folderBtn = document.getElementById('bulk-import-folder-btn');

    if (zipBtn) {
      zipBtn.addEventListener('click', () => {
        const importMode = document.querySelector('input[name="import-mode"]:checked').value;
        modal.remove();
        selectBulkZipFile(importMode);
      });
    }

    if (folderBtn) {
      folderBtn.addEventListener('click', () => {
        const importMode = document.querySelector('input[name="import-mode"]:checked').value;
        modal.remove();
        selectBulkFolder(importMode);
      });
    }
  }

  document.getElementById('bulk-import-cancel-btn').addEventListener('click', () => {
    modal.remove();
  });

}

// Pizza icon generation function
async function generatePizzaTimerIcon(progress, totalSegments, currentSegment) {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, 16, 16);

  try {
    const img = new Image();
    img.src = chrome.runtime.getURL('assets/timer/icons/pizza.png');

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    ctx.drawImage(img, 0, 0, 16, 16);

    // Pizza typically has 8 slices, but we'll divide based on totalSegments
    const slicesToRemove = currentSegment;
    if (slicesToRemove > 0) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'black';

      const centerX = 8;
      const centerY = 8;
      const radius = 10; // Slightly larger to ensure we remove the crust too
      const sliceAngle = (2 * Math.PI) / totalSegments;

      for (let i = 0; i < slicesToRemove; i++) {
        const startAngle = -Math.PI / 2 + (i * sliceAngle);
        const endAngle = startAngle + sliceAngle;

        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        // Make the arc slightly larger to ensure complete removal including crust
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.closePath();
        ctx.fill();
      }
    }
  } catch (e) {
    // Fallback: use the old pie/pizza generation
    const pizzaRadius = 7.5;
    const centerX = 8;
    const centerY = 8;

    if (progress > 0) {
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + (2 * Math.PI * progress);
      ctx.arc(centerX, centerY, pizzaRadius, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = '#D2691E';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, pizzaRadius - 1.2, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = '#FFD700';
      ctx.fill();

      const numDots = Math.ceil(progress * 6);
      for (let i = 0; i < numDots; i++) {
        const angle = startAngle + (i / 6) * 2 * Math.PI;
        const dotRadius = 0.7;
        const dotDistance = pizzaRadius - 3.5;
        const dotX = centerX + Math.cos(angle) * dotDistance;
        const dotY = centerY + Math.sin(angle) * dotDistance;

        ctx.beginPath();
        ctx.arc(dotX, dotY, dotRadius, 0, 2 * Math.PI);
        ctx.fillStyle = '#DC143C';
        ctx.fill();
      }

      const totalSlices = totalSegments;
      const remainingSlices = Math.ceil(progress * totalSlices);

      ctx.strokeStyle = '#8B4513';
      ctx.lineWidth = 0.5;

      for (let i = 0; i <= remainingSlices; i++) {
        const angle = startAngle + (i / totalSlices) * 2 * Math.PI;
        if (angle <= endAngle) {
          ctx.beginPath();
          ctx.moveTo(centerX, centerY);
          ctx.lineTo(
            centerX + Math.cos(angle) * (pizzaRadius - 1.2),
            centerY + Math.sin(angle) * (pizzaRadius - 1.2)
          );
          ctx.stroke();
        }
      }
    }
  }

  return canvas.toDataURL('image/png');
}

// Flower icon generation functions

function showVisualTimerModal() {
  const existingModal = document.getElementById('yoto-visual-timer-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'yoto-visual-timer-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 999999;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(0, 0, 0, 0.5);
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    background-color: white;
    border-radius: 12px;
    padding: 32px;
    max-width: 500px;
    width: 90%;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  `;

  // Timer type selection modal
  content.innerHTML = `
    <h2 style="margin: 0 0 20px 0; color: #1f2937; font-size: 20px; font-weight: 600;">${chrome.i18n.getMessage('modal_visualTimerSettings')}</h2>

    <p style="margin: 0 0 20px 0; color: #6b7280; font-size: 14px;">${chrome.i18n.getMessage('modal_selectTimerType')}</p>

    <div style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 12px; font-weight: 500; color: #374151; font-size: 14px;">
        ${chrome.i18n.getMessage('label_timerType')}
      </label>

      <div style="display: flex; flex-direction: column; gap: 12px;">
        <label style="
          display: flex;
          align-items: center;
          padding: 12px 16px;
          border: 2px solid #e5e7eb;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
          background-color: white;
        " onmouseover="this.style.borderColor='#3b82f6'; this.style.backgroundColor='#f0f9ff'"
           onmouseout="this.style.borderColor='#e5e7eb'; this.style.backgroundColor='white'">
          <input type="radio" name="timer-type" value="ready-made" style="margin-right: 12px;">
          <div style="flex: 1;">
            <div style="font-weight: 500; color: #1f2937; font-size: 14px; margin-bottom: 2px;">${chrome.i18n.getMessage('modal_readyMadeTimers')}</div>
            <div style="color: #6b7280; font-size: 12px;">${chrome.i18n.getMessage('label_readyMadeDescription')}</div>
          </div>
        </label>

        <label style="
          display: flex;
          align-items: center;
          padding: 12px 16px;
          border: 2px solid #e5e7eb;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
          background-color: white;
        " onmouseover="this.style.borderColor='#3b82f6'; this.style.backgroundColor='#f0f9ff'"
           onmouseout="this.style.borderColor='#e5e7eb'; this.style.backgroundColor='white'">
          <input type="radio" name="timer-type" value="custom" style="margin-right: 12px;">
          <div style="flex: 1;">
            <div style="font-weight: 500; color: #1f2937; font-size: 14px; margin-bottom: 2px;">${chrome.i18n.getMessage('label_customTimer')}</div>
            <div style="color: #6b7280; font-size: 12px;">${chrome.i18n.getMessage('label_customTimerDescription')}</div>
          </div>
        </label>
      </div>
    </div>

    <div style="display: flex; gap: 12px; justify-content: center; margin-top: 24px;">
      <button id="timer-next-btn" disabled style="
        padding: 10px 24px;
        background-color: #10b981;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: not-allowed;
        opacity: 0.5;
        transition: all 0.2s;
      ">
        ${chrome.i18n.getMessage('button_continue')}
      </button>

      <button id="timer-cancel-btn" style="
        padding: 10px 24px;
        background-color: white;
        color: #6b7280;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      " onmouseover="this.style.backgroundColor='#f9fafb'" onmouseout="this.style.backgroundColor='white'">
        ${chrome.i18n.getMessage('button_cancel')}
      </button>
    </div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  const radioInputs = content.querySelectorAll('input[name="timer-type"]');
  const nextBtn = document.getElementById('timer-next-btn');
  let selectedType = null;

  radioInputs.forEach(input => {
    input.addEventListener('change', () => {
      selectedType = input.value;
      nextBtn.disabled = false;
      nextBtn.style.cursor = 'pointer';
      nextBtn.style.opacity = '1';

      content.querySelectorAll('label').forEach(label => {
        if (label.querySelector('input[name="timer-type"]')) {
          const radio = label.querySelector('input[name="timer-type"]');
          if (radio.checked) {
            label.style.borderColor = '#3b82f6';
            label.style.backgroundColor = '#f0f9ff';
          } else {
            label.style.borderColor = '#e5e7eb';
            label.style.backgroundColor = 'white';
          }
        }
      });
    });
  });

  nextBtn.addEventListener('click', () => {
    if (selectedType === 'ready-made') {
      modal.remove();
      showReadyMadeTimerModal();
    } else if (selectedType === 'custom') {
      modal.remove();
      showCustomTimerModal();
    }
  });

  document.getElementById('timer-cancel-btn').addEventListener('click', () => {
    modal.remove();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// New function for Ready-Made Timer modal
function showReadyMadeTimerModal() {
  const existingModal = document.getElementById('yoto-ready-timer-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'yoto-ready-timer-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 999999;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(0, 0, 0, 0.5);
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    background-color: white;
    border-radius: 12px;
    padding: 32px;
    max-width: 500px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  `;

  content.innerHTML = `
    <h2 style="margin: 0 0 24px 0; color: #1f2937; font-size: 24px; font-weight: 600;">${chrome.i18n.getMessage('modal_readyMadeTimers')}</h2>

    <form id="ready-timer-form" style="display: flex; flex-direction: column; gap: 20px;">
      <!-- Timer Selection -->
      <div>
        <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #374151;">
          ${chrome.i18n.getMessage('timer_labelSelectTimer')}
        </label>
        <select id="ready-timer-type" style="
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 14px;
          background-color: white;
          cursor: pointer;
        ">
          <option value="">${chrome.i18n.getMessage('timer_chooseTimer')}</option>
          <option value="toothbrush">${chrome.i18n.getMessage('timer_toothbrushTimer')}</option>
        </select>
      </div>

      <!-- Timer Details (shown after selection) -->
      <div id="timer-details" style="display: none;">
        <div style="padding: 16px; background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px;">
          <h3 style="margin: 0 0 12px 0; color: #0369a1; font-size: 16px; font-weight: 600;">${chrome.i18n.getMessage('timer_labelTimerDetails')}</h3>
          <div id="timer-info" style="color: #0c4a6e; font-size: 14px; line-height: 1.6;"></div>
        </div>
      </div>

      <!-- Sound Options (for future use) -->
      <div id="sound-options" style="display: none;">
        <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #374151;">
          Timer Sound
        </label>
        <select id="timer-sound" style="
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 14px;
          background-color: white;
          cursor: pointer;
        ">
          <option value="silent" selected>Silent</option>
          <!-- Future music options will go here -->
        </select>
      </div>

      <!-- Alarm Sound -->
      <div id="alarm-options" style="display: none;">
        <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #374151;">
          ${chrome.i18n.getMessage('timer_labelEndAlarmSound')}
        </label>
        <select id="ready-timer-alarm-sound" style="
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 14px;
          background-color: white;
          cursor: pointer;
        ">
          <option value="">${chrome.i18n.getMessage('timer_alarmNone')}</option>
          <option value="friendly-alarm.mp3" selected>${chrome.i18n.getMessage('timer_alarmFriendlyChime')}</option>
          <option value="soft-alarm.mp3">${chrome.i18n.getMessage('timer_alarmSoftBell')}</option>
          <option value="happy-alarm.mp3">${chrome.i18n.getMessage('timer_alarmHappyTune')}</option>
          <option value="sunshine-alarm.mp3">${chrome.i18n.getMessage('timer_alarmSunshineMelody')}</option>
          <option value="calm-alarm.mp3">${chrome.i18n.getMessage('timer_alarmCalmBells')}</option>
          <option value="calm-christmas-alarm.mp3">${chrome.i18n.getMessage('timer_alarmChristmasBells')}</option>
          <option value="spooky-alarm.mp3">${chrome.i18n.getMessage('timer_alarmSpookySound')}</option>
        </select>
      </div>

      <!-- Status Message -->
      <div id="ready-timer-status" style="display: none; padding: 12px; border-radius: 6px; font-size: 14px;"></div>

      <!-- Buttons -->
      <div style="display: flex; gap: 12px; margin-top: 8px;">
        <button type="button" id="ready-timer-back-btn" style="
          padding: 12px 24px;
          background-color: #f3f4f6;
          color: #4b5563;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.2s;
        " onmouseover="this.style.backgroundColor='#e5e7eb'" onmouseout="this.style.backgroundColor='#f3f4f6'">
          ${chrome.i18n.getMessage('timer_buttonBack')}
        </button>
        <button type="submit" id="ready-timer-create-btn" disabled style="
          flex: 1;
          padding: 12px 24px;
          background-color: #3b82f6;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.2s;
          opacity: 0.5;
        ">
          ${chrome.i18n.getMessage('timer_buttonCreateTimer')}
        </button>
        <button type="button" id="ready-timer-cancel-btn" style="
          padding: 12px 24px;
          background-color: #f3f4f6;
          color: #4b5563;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.2s;
        " onmouseover="this.style.backgroundColor='#e5e7eb'" onmouseout="this.style.backgroundColor='#f3f4f6'">
          ${chrome.i18n.getMessage('button_cancel')}
        </button>
      </div>
    </form>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  const timerSelect = document.getElementById('ready-timer-type');
  const timerDetails = document.getElementById('timer-details');
  const timerInfo = document.getElementById('timer-info');
  const alarmOptions = document.getElementById('alarm-options');
  const createBtn = document.getElementById('ready-timer-create-btn');

  timerSelect.addEventListener('change', () => {
    if (timerSelect.value === 'toothbrush') {
      timerDetails.style.display = 'block';
      alarmOptions.style.display = 'block';
      timerInfo.innerHTML = `
        <div>${chrome.i18n.getMessage('timer_detailsDuration')}</div>
        <div>${chrome.i18n.getMessage('timer_detailsSegments')}</div>
        <div>${chrome.i18n.getMessage('timer_detailsPerfectFor')}</div>
      `;
      createBtn.disabled = false;
      createBtn.style.opacity = '1';
      createBtn.style.cursor = 'pointer';
      createBtn.onmouseover = function() { this.style.backgroundColor='#2563eb'; };
      createBtn.onmouseout = function() { this.style.backgroundColor='#3b82f6'; };
    } else {
      timerDetails.style.display = 'none';
      alarmOptions.style.display = 'none';
      createBtn.disabled = true;
      createBtn.style.opacity = '0.5';
      createBtn.style.cursor = 'not-allowed';
      createBtn.onmouseover = null;
      createBtn.onmouseout = null;
    }
  });

  document.getElementById('ready-timer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (timerSelect.value === 'toothbrush') {
      await createToothbrushTimer();
    }
  });

  document.getElementById('ready-timer-back-btn').addEventListener('click', () => {
    modal.remove();
    showVisualTimerModal();
  });

  document.getElementById('ready-timer-cancel-btn').addEventListener('click', () => {
    modal.remove();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// Rename the existing function for custom timers
function showCustomTimerModal() {
  const existingModal = document.getElementById('yoto-custom-timer-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'yoto-custom-timer-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 999999;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(0, 0, 0, 0.5);
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    background-color: white;
    border-radius: 12px;
    padding: 32px;
    max-width: 500px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  `;

  content.innerHTML = `
    <h2 style="margin: 0 0 24px 0; color: #1f2937; font-size: 24px; font-weight: 600;">${chrome.i18n.getMessage('modal_customVisualTimer')}</h2>

    <form id="visual-timer-form" style="display: flex; flex-direction: column; gap: 20px;">
      <!-- Card Title -->
      <div>
        <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #374151;">
          ${chrome.i18n.getMessage('label_timerName')}
        </label>
        <input type="text" id="timer-name" placeholder="${chrome.i18n.getMessage('input_timerNamePlaceholder')}" style="
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 14px;
          box-sizing: border-box;
        " value="${chrome.i18n.getMessage('timer_defaultName', ['5', chrome.i18n.getMessage('label_minutes')])}">
      </div>

      <!-- Timer Duration -->
      <div>
        <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #374151;">
          ${chrome.i18n.getMessage('timer_customDuration')}
        </label>
        <select id="timer-duration" style="
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 14px;
          background-color: white;
          cursor: pointer;
        ">
          <option value="2">${chrome.i18n.getMessage('timer_duration2min')}</option>
          <option value="5" selected>${chrome.i18n.getMessage('timer_duration5min')}</option>
          <option value="10">${chrome.i18n.getMessage('timer_duration10min')}</option>
          <option value="15">${chrome.i18n.getMessage('timer_duration15min')}</option>
          <option value="20">${chrome.i18n.getMessage('timer_duration20min')}</option>
          <option value="30">${chrome.i18n.getMessage('timer_duration30min')}</option>
          <option value="60">${chrome.i18n.getMessage('timer_duration60min')}</option>
          <option value="custom">${chrome.i18n.getMessage('timer_customDuration')}...</option>
        </select>
      </div>

      <!-- Custom Duration Input (hidden by default) -->
      <div id="custom-duration-container" style="display: none;">
        <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #374151;">
          ${chrome.i18n.getMessage('timer_customDuration')}
        </label>
        <input type="number" id="custom-duration-input" min="1" max="120" placeholder="${chrome.i18n.getMessage('input_customDurationPlaceholder')}" style="
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 14px;
          box-sizing: border-box;
        ">
        <p style="margin-top: 8px; font-size: 12px; color: #6b7280;">
          ${chrome.i18n.getMessage('label_timerOptimized')}
        </p>
      </div>

      <!-- Icon Style -->
      <div>
        <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #374151;">
          ${chrome.i18n.getMessage('timer_labelIconStyle')}
        </label>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
          <label style="
            display: flex;
            align-items: center;
            padding: 12px;
            border: 2px solid #3b82f6;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
          " onmouseover="this.style.borderColor='#3b82f6'" onmouseout="this.style.borderColor=this.querySelector('input').checked?'#3b82f6':'#e5e7eb'">
            <input type="radio" name="icon-style" value="blocks" checked style="margin-right: 8px;">
            <span>${chrome.i18n.getMessage('timer_iconStyleBlocks')}</span>
          </label>
          <label style="
            display: flex;
            align-items: center;
            padding: 12px;
            border: 2px solid #e5e7eb;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
          " onmouseover="this.style.borderColor='#3b82f6'" onmouseout="this.style.borderColor=this.querySelector('input').checked?'#3b82f6':'#e5e7eb'">
            <input type="radio" name="icon-style" value="circle" style="margin-right: 8px;">
            <span>${chrome.i18n.getMessage('timer_iconStyleCircle')}</span>
          </label>
          <label style="
            display: flex;
            align-items: center;
            padding: 12px;
            border: 2px solid #e5e7eb;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
          " onmouseover="this.style.borderColor='#3b82f6'" onmouseout="this.style.borderColor=this.querySelector('input').checked?'#3b82f6':'#e5e7eb'">
            <input type="radio" name="icon-style" value="dots" style="margin-right: 8px;">
            <span>${chrome.i18n.getMessage('timer_iconStyleDots')}</span>
          </label>
          <label style="
            display: flex;
            align-items: center;
            padding: 12px;
            border: 2px solid #e5e7eb;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
          " onmouseover="this.style.borderColor='#3b82f6'" onmouseout="this.style.borderColor=this.querySelector('input').checked?'#3b82f6':'#e5e7eb'">
            <input type="radio" name="icon-style" value="pizza" style="margin-right: 8px;">
            <span>${chrome.i18n.getMessage('timer_iconStylePizza')}</span>
          </label>
          <label style="
            display: flex;
            align-items: center;
            padding: 12px;
            border: 2px solid #e5e7eb;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
          " onmouseover="this.style.borderColor='#3b82f6'" onmouseout="this.style.borderColor=this.querySelector('input').checked?'#3b82f6':'#e5e7eb'">
            <input type="radio" name="icon-style" value="flower" style="margin-right: 8px;">
            <span>${chrome.i18n.getMessage('timer_iconStyleFlower')}</span>
          </label>
          <label style="
            display: flex;
            align-items: center;
            padding: 12px;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            background: linear-gradient(135deg, #f3e7e9 0%, #e3eeff 100%);
          " onmouseover="this.style.borderColor='#3b82f6'" onmouseout="this.style.borderColor=this.querySelector('input').checked?'#3b82f6':'#e5e7eb'">
            <input type="radio" name="icon-style" value="ghost" style="margin-right: 8px;">
            <span>${chrome.i18n.getMessage('timer_iconStyleGhost')}</span>
          </label>
          <label style="
            display: flex;
            align-items: center;
            padding: 12px;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            background: linear-gradient(45deg, #f0f9ff 25%, #e0f2fe 25%);
          " onmouseover="this.style.borderColor='#3b82f6'" onmouseout="this.style.borderColor=this.querySelector('input').checked?'#3b82f6':'#e5e7eb'">
            <input type="radio" name="icon-style" value="tree-lights" style="margin-right: 8px;">
            <span>${chrome.i18n.getMessage('timer_iconStyleTreeLights')}</span>
          </label>
        </div>
      </div>

      <!-- Alarm Sound -->
      <div>
        <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #374151;">
          ${chrome.i18n.getMessage('timer_labelEndAlarmSound')}
        </label>
        <select id="timer-alarm-sound" style="
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 14px;
          background-color: white;
          cursor: pointer;
        ">
          <option value="">${chrome.i18n.getMessage('timer_alarmNone')}</option>
          <option value="friendly-alarm.mp3" selected>${chrome.i18n.getMessage('timer_alarmFriendlyChime')}</option>
          <option value="soft-alarm.mp3">${chrome.i18n.getMessage('timer_alarmSoftBell')}</option>
          <option value="happy-alarm.mp3">${chrome.i18n.getMessage('timer_alarmHappyTune')}</option>
          <option value="sunshine-alarm.mp3">${chrome.i18n.getMessage('timer_alarmSunshineMelody')}</option>
          <option value="calm-alarm.mp3">${chrome.i18n.getMessage('timer_alarmCalmBells')}</option>
          <option value="calm-christmas-alarm.mp3">${chrome.i18n.getMessage('timer_alarmChristmasBells')}</option>
          <option value="spooky-alarm.mp3">${chrome.i18n.getMessage('timer_alarmSpookySound')}</option>
        </select>
      </div>

      <!-- Status Message -->
      <div id="timer-status" style="display: none; padding: 12px; border-radius: 6px; font-size: 14px;"></div>

      <!-- Buttons -->
      <div style="display: flex; gap: 12px; margin-top: 8px;">
        <button type="submit" style="
          flex: 1;
          padding: 12px 24px;
          background-color: #3b82f6;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.2s;
        " onmouseover="this.style.backgroundColor='#2563eb'" onmouseout="this.style.backgroundColor='#3b82f6'">
          ${chrome.i18n.getMessage('timer_buttonCreateTimer')}
        </button>
        <button type="button" id="timer-cancel-btn" style="
          flex: 1;
          padding: 12px 24px;
          background-color: #f3f4f6;
          color: #4b5563;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.2s;
        " onmouseover="this.style.backgroundColor='#e5e7eb'" onmouseout="this.style.backgroundColor='#f3f4f6'">
          ${chrome.i18n.getMessage('button_cancel')}
        </button>
      </div>
    </form>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  const radioInputs = content.querySelectorAll('input[name="icon-style"]');
  radioInputs.forEach(input => {
    input.addEventListener('change', () => {
      content.querySelectorAll('label').forEach(label => {
        if (label.querySelector('input[name="icon-style"]')) {
          label.style.borderColor = label.querySelector('input').checked ? '#3b82f6' : '#e5e7eb';
        }
      });
    });
  });

  const durationSelect = document.getElementById('timer-duration');
  const customContainer = document.getElementById('custom-duration-container');
  const timerNameInput = document.getElementById('timer-name');
  const customDurationInput = document.getElementById('custom-duration-input');

  // Track if user has manually edited the timer name
  let userEditedName = false;
  timerNameInput.addEventListener('input', () => {
    // If user clears the field, allow auto-updates again
    if (timerNameInput.value.trim() === '') {
      userEditedName = false;
    } else {
      userEditedName = true;
    }
  });

  const updateTimerName = (minutes) => {
    if (!userEditedName) {
      const minuteText = minutes === 1 ? chrome.i18n.getMessage('label_minute') : chrome.i18n.getMessage('label_minutes');
      timerNameInput.value = chrome.i18n.getMessage('timer_defaultName', [minutes.toString(), minuteText]);
    }
  };

  updateTimerName(5);

  durationSelect.addEventListener('change', () => {
    if (durationSelect.value === 'custom') {
      customContainer.style.display = 'block';
      // Don't update name until they enter a custom value
    } else {
      customContainer.style.display = 'none';
      const minutes = parseInt(durationSelect.value);
      updateTimerName(minutes);
    }
  });

  customDurationInput.addEventListener('input', () => {
    const minutes = parseInt(customDurationInput.value);
    if (minutes && minutes > 0 && minutes <= 120) {
      updateTimerName(minutes);
    }
  });

  document.getElementById('visual-timer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await createVisualTimer();
  });

  document.getElementById('timer-cancel-btn').addEventListener('click', () => {
    modal.remove();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

async function createToothbrushTimer() {
  const alarmSound = document.getElementById('ready-timer-alarm-sound').value;
  const statusDiv = document.getElementById('ready-timer-status');
  const submitButton = document.querySelector('#ready-timer-form button[type="submit"]');

  statusDiv.style.display = 'block';
  statusDiv.style.backgroundColor = '#dbeafe';
  statusDiv.style.color = '#1e40af';
  statusDiv.textContent = chrome.i18n.getMessage('status_preparingToothbrushTimer');
  submitButton.disabled = true;
  submitButton.style.opacity = '0.5';
  submitButton.style.cursor = 'not-allowed';

  try {
    // Toothbrush timer configuration: 2 minutes 5 seconds total
    // 1 x 5 second intro + 8 x 15 second segments
    const tracks = [];

    tracks.push({
      title: chrome.i18n.getMessage('timer_toothbrushIntro'),
      duration: 5, // Approximately 4.38 seconds, but keeping 5 for consistency
      silentFile: 'toothbrush-intro-composite.wav'
    });

    // Middle tracks: 8 x 15 seconds each
    // Total time after 5 second intro = 2:00 minutes
    // Each track is 15 seconds, countdown shows time remaining
    const brushingTitles = [
      chrome.i18n.getMessage('timer_topLeftFront'),      // 15 sec track, 2:00 remaining
      chrome.i18n.getMessage('timer_topLeftBack'),       // 15 sec track, 1:45 remaining
      chrome.i18n.getMessage('timer_topRightFront'),     // 15 sec track, 1:30 remaining
      chrome.i18n.getMessage('timer_topRightBack'),      // 15 sec track, 1:15 remaining
      chrome.i18n.getMessage('timer_bottomLeftFront'),   // 15 sec track, 1:00 remaining
      chrome.i18n.getMessage('timer_bottomLeftBack'),    // 15 sec track, 0:45 remaining
      chrome.i18n.getMessage('timer_bottomRightFront'),  // 15 sec track, 0:30 remaining
      chrome.i18n.getMessage('timer_bottomRightBack')    // 15 sec track, 0:15 remaining (renamed to Sparkly Smile!)
    ];

    for (let i = 0; i < 8; i++) {
      // Tracks 2-7 have boing at the end, track 8 doesn't (to avoid boing->alarm)
      const audioFile = i < 7 ? `toothbrush-track-${i + 2}.wav` : 'toothbrush-track-8.wav';

      tracks.push({
        title: brushingTitles[i],
        duration: 15,
        silentFile: audioFile
      });
    }

    statusDiv.textContent = chrome.i18n.getMessage('status_loadingAudioFiles');

    const audioCache = {};
    const uniqueFiles = [
      'toothbrush-intro-composite.wav',
      'toothbrush-track-2.wav',
      'toothbrush-track-3.wav',
      'toothbrush-track-4.wav',
      'toothbrush-track-5.wav',
      'toothbrush-track-6.wav',
      'toothbrush-track-7.wav',
      'toothbrush-track-8.wav'
    ];

    for (const fileName of uniqueFiles) {
      const audioUrl = chrome.runtime.getURL(`assets/audio/timer/${fileName}`);

      try {
        const audioResponse = await fetch(audioUrl);
        if (!audioResponse.ok) {
          throw new Error(`Failed to load audio file: ${fileName} - Status: ${audioResponse.status}`);
        }

        const audioBlob = await audioResponse.blob();

        const MAX_SIZE = 10 * 1024 * 1024; // 10MB limit
        if (audioBlob.size > MAX_SIZE) {
          audioCache[fileName] = { blob: audioBlob, isLarge: true };
        } else {
          const audioBase64 = await blobToBase64(audioBlob);
          audioCache[fileName] = { base64: audioBase64, isLarge: false };
        }
      } catch (audioError) {
        console.error(`Error loading ${fileName}:`, audioError);
        throw new Error(`Failed to load audio file ${fileName}: ${audioError.message}`);
      }
    }

    let alarmAudioBase64 = null;
    if (alarmSound) {
      const alarmUrl = chrome.runtime.getURL(`assets/audio/alarms/${alarmSound}`);

      const alarmResponse = await fetch(alarmUrl);
      if (!alarmResponse.ok) {
        throw new Error(`Failed to load alarm file: ${alarmSound}`);
      }

      const alarmBlob = await alarmResponse.blob();
      alarmAudioBase64 = await blobToBase64(alarmBlob);
    }

    statusDiv.textContent = chrome.i18n.getMessage('status_generatingTimerIcons');

    // For now, we'll use a default icon style for toothbrush timer
    // Later you can provide specific toothbrush-themed icons
    const iconStyle = 'blocks'; // Or create a special toothbrush icon set

    // Import the icon generator functions
    let generateTimerIcon, generateDotsTimerIcon, generateBlocksTimerIcon;
    try {
      const module = await import(chrome.runtime.getURL('utils/timerIconGenerator.js'));
      generateTimerIcon = module.generateTimerIcon;
      generateDotsTimerIcon = module.generateDotsTimerIcon;
      generateBlocksTimerIcon = module.generateBlocksTimerIcon;
    } catch (importError) {
      console.error('Failed to import icon generator:', importError);
      throw new Error(`Failed to import icon generator: ${importError.message}`);
    }

    const uploadedIcons = [];
    const totalTracks = tracks.length;

    for (let i = 0; i < totalTracks; i++) {
      statusDiv.textContent = chrome.i18n.getMessage('status_uploadingIcon', [(i + 1).toString(), totalTracks.toString()]);

      let iconBase64;

      if (i === 0) {
        const toothbrushUrl = chrome.runtime.getURL('assets/timer/icons/toothbrush.png');
        const toothbrushResponse = await fetch(toothbrushUrl);
        const toothbrushBlob = await toothbrushResponse.blob();
        const toothbrushDataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(toothbrushBlob);
        });
        iconBase64 = toothbrushDataUrl.split(',')[1];
      } else if (i === totalTracks - 1) {
        const happyTeethUrl = chrome.runtime.getURL('assets/timer/icons/happy-teeth.png');
        const happyTeethResponse = await fetch(happyTeethUrl);
        const happyTeethBlob = await happyTeethResponse.blob();
        const happyTeethDataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(happyTeethBlob);
        });
        iconBase64 = happyTeethDataUrl.split(',')[1];
      } else {
        // Tracks 2-8 - use generated tooth icons with decreasing plaque
        const trackNum = i + 1; // Track numbers are 1-based
        const toothIconUrl = chrome.runtime.getURL(`assets/timer/icons/tooth-track-${trackNum}.png`);

        try {
          const toothIconResponse = await fetch(toothIconUrl);
          if (toothIconResponse.ok) {
            const toothIconBlob = await toothIconResponse.blob();
            const toothIconDataUrl = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.readAsDataURL(toothIconBlob);
            });
            iconBase64 = toothIconDataUrl.split(',')[1];
          } else {
            // Fallback to generated countdown icon if tooth icon not found
            const progress = 1 - (i / totalTracks);
            const iconDataUrl = generateBlocksTimerIcon(progress);
            iconBase64 = iconDataUrl.split(',')[1];
          }
        } catch (err) {
          // Fallback to generated countdown icon
          const progress = 1 - (i / totalTracks);
          const iconDataUrl = generateBlocksTimerIcon(progress);
          iconBase64 = iconDataUrl.split(',')[1];
        }
      }

      const uploadResponse = await chrome.runtime.sendMessage({
        action: 'UPLOAD_ICON',
        file: {
          data: iconBase64,
          type: 'image/png',
          name: `timer-icon-${i}.png`
        }
      });

      if (uploadResponse.error) {
        throw new Error(`Failed to upload icon ${i + 1}: ${uploadResponse.error}`);
      }

      uploadedIcons.push(uploadResponse.iconId);
    }

    // Rename the last track to "Sparkly Smile!"
    tracks[tracks.length - 1].title = chrome.i18n.getMessage('timer_sparklySmile');

    statusDiv.textContent = chrome.i18n.getMessage('status_uploadingCover');

    let coverUrl = null;
    try {
      const coverPath = chrome.runtime.getURL('assets/timer/covers/toothbrush-timer-cover.png');
      const coverResponse = await fetch(coverPath);
      if (!coverResponse.ok) {
        throw new Error(`Failed to fetch toothbrush cover: ${coverResponse.status}`);
      }

      const coverBlob = await coverResponse.blob();
      const coverBase64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(coverBlob);
      });

      const base64Data = coverBase64.split(',')[1];

      const uploadCoverResponse = await chrome.runtime.sendMessage({
        action: 'UPLOAD_COVER',
        file: {
          data: base64Data,
          type: 'image/png',
          name: 'toothbrush-timer-cover.png'
        }
      });

      if (uploadCoverResponse && !uploadCoverResponse.error) {
        coverUrl = uploadCoverResponse.url;
      }
    } catch (coverError) {
      console.error('Cover upload error:', coverError);
      // Continue without cover
    }

    statusDiv.textContent = chrome.i18n.getMessage('status_uploadingAudioTracks');

    const audioTracks = [];
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const audioData = audioCache[track.silentFile];

      if (!audioData) {
        throw new Error(`Audio file not found in cache: ${track.silentFile}`);
      }

      let audioResponse;

      if (audioData.isLarge) {
        // For large files, have the service worker load and upload directly
        audioResponse = await chrome.runtime.sendMessage({
          action: 'UPLOAD_TIMER_AUDIO',
          fileName: track.silentFile,
          trackName: `track-${i}.wav`
        });
      } else {
        // For smaller files, use the regular upload with base64
        audioResponse = await chrome.runtime.sendMessage({
          action: 'UPLOAD_AUDIO',
          file: {
            data: audioData.base64,
            type: 'audio/wav',
            name: track.silentFile
          }
        });
      }

      if (audioResponse.error) {
        throw new Error(`Failed to upload audio track ${i + 1}: ${audioResponse.error}`);
      }

      audioTracks.push({
        title: track.title,
        transcodedAudio: audioResponse.transcodedAudio
      });
    }

    if (alarmAudioBase64 && audioTracks.length > 0) {
      const alarmResponse = await chrome.runtime.sendMessage({
        action: 'UPLOAD_AUDIO',
        file: {
          data: alarmAudioBase64,
          type: 'audio/mp3',
          name: alarmSound
        }
      });

      if (alarmResponse.error) {
        throw new Error(`Failed to upload alarm: ${alarmResponse.error}`);
      }

      // Replace the last track's audio with the alarm
      audioTracks[audioTracks.length - 1].transcodedAudio = alarmResponse.transcodedAudio;
    }

    statusDiv.textContent = chrome.i18n.getMessage('status_creatingCard');

    const createResponse = await chrome.runtime.sendMessage({
      action: 'CREATE_PLAYLIST',
      title: chrome.i18n.getMessage('timer_toothbrushTitle'),
      audioTracks: audioTracks,
      iconIds: uploadedIcons,
      coverUrl: coverUrl,
      isVisualTimer: true,
      alwaysPlayFromStart: true
    });

    if (!createResponse.error) {
      statusDiv.style.backgroundColor = '#dcfce7';
      statusDiv.style.color = '#166534';
      statusDiv.textContent = chrome.i18n.getMessage('status_toothbrushTimerSuccess');

      setTimeout(() => {
        document.getElementById('yoto-ready-timer-modal').remove();
        window.location.reload();
      }, 1500);
    } else {
      throw new Error(createResponse.error || 'Failed to create timer card');
    }

  } catch (error) {
    console.error('Error creating toothbrush timer:', error);
    statusDiv.style.backgroundColor = '#fee2e2';
    statusDiv.style.color = '#991b1b';
    statusDiv.textContent = `${chrome.i18n.getMessage("error_generic", [error.message])}`;
    submitButton.disabled = false;
    submitButton.style.opacity = '1';
    submitButton.style.cursor = 'pointer';
  }
}

async function createVisualTimer() {
  const timerName = document.getElementById('timer-name').value || chrome.i18n.getMessage('label_visualTimerDefault');
  const durationSelect = document.getElementById('timer-duration');
  let duration;

  if (durationSelect.value === 'custom') {
    const customInput = document.getElementById('custom-duration-input');
    duration = parseInt(customInput.value);
    if (!duration || duration < 1 || duration > 120) {
      alert(chrome.i18n.getMessage('error_invalidDuration'));
      return;
    }
  } else {
    duration = parseInt(durationSelect.value);
  }

  const iconStyle = document.querySelector('input[name="icon-style"]:checked').value;
  const alarmSound = document.getElementById('timer-alarm-sound').value;
  const alwaysPlayFromStart = true; // Always play timers from start
  const statusDiv = document.getElementById('timer-status');
  const submitButton = document.querySelector('#visual-timer-form button[type="submit"]');

  statusDiv.style.display = 'block';
  statusDiv.style.backgroundColor = '#dbeafe';
  statusDiv.style.color = '#1e40af';
  statusDiv.textContent = chrome.i18n.getMessage('status_preparingTimerTracks');
  submitButton.disabled = true;
  submitButton.style.opacity = '0.5';
  submitButton.style.cursor = 'not-allowed';

  try {
    let segmentDuration, numSegments, silentFiles;

    // New segment calculation for better visual timer experience
    if (duration === 1) {
      numSegments = 5;
      segmentDuration = 12;
      silentFiles = ['silent-12s.wav'];
    } else if (duration === 2) {
      numSegments = 8;
      segmentDuration = 15;
      silentFiles = ['silent-15s.wav'];
    } else if (duration === 3) {
      numSegments = 6;
      segmentDuration = 30;
      silentFiles = ['silent-30s.wav'];
    } else if (duration === 4) {
      numSegments = 8;
      segmentDuration = 30;
      silentFiles = ['silent-30s.wav'];
    } else if (duration >= 5 && duration <= 10) {
      numSegments = duration;
      segmentDuration = 60;
      silentFiles = ['silent-1m.wav'];
    } else if (duration >= 11 && duration <= 20) {
      if (duration % 2 === 0) {
        numSegments = duration / 2;
        segmentDuration = 120;
        silentFiles = ['silent-2m.wav'];
      } else {
        numSegments = duration;
        segmentDuration = 60;
        silentFiles = ['silent-1m.wav'];
      }
    } else if (duration === 25) {
      numSegments = 5;
      segmentDuration = 300;
      silentFiles = ['silent-5m.wav'];
    } else if (duration === 30) {
      numSegments = 6;
      segmentDuration = 300;
      silentFiles = ['silent-5m.wav'];
    } else if (duration >= 31 && duration < 50) {
      // Use largest audio file that divides evenly (priority: 5min > 2min > 1min)
      if (duration % 5 === 0) {
        numSegments = duration / 5;
        segmentDuration = 300;
        silentFiles = ['silent-5m.wav'];
      } else if (duration % 2 === 0) {
        numSegments = duration / 2;
        segmentDuration = 120;
        silentFiles = ['silent-2m.wav'];
      } else {
        numSegments = duration;
        segmentDuration = 60;
        silentFiles = ['silent-1m.wav'];
      }
    } else if (duration >= 50) {
      // Use largest audio file that divides evenly (priority: 10min > 5min > 2min > 1min)
      if (duration % 10 === 0) {
        numSegments = duration / 10;
        segmentDuration = 600;
        silentFiles = ['silent-10m.wav'];
      } else if (duration % 5 === 0) {
        numSegments = duration / 5;
        segmentDuration = 300;
        silentFiles = ['silent-5m.wav'];
      } else if (duration % 2 === 0) {
        numSegments = duration / 2;
        segmentDuration = 120;
        silentFiles = ['silent-2m.wav'];
      } else {
        numSegments = duration;
        segmentDuration = 60;
        silentFiles = ['silent-1m.wav'];
      }
    } else {
      numSegments = Math.min(10, Math.max(5, duration));
      segmentDuration = (duration * 60) / numSegments;
      silentFiles = ['silent-1m.wav'];
    }

    statusDiv.textContent = chrome.i18n.getMessage('status_loadingAudioFiles');

    const audioCache = {};
    const uniqueFiles = [...new Set(silentFiles)];

    for (const fileName of uniqueFiles) {
      const audioUrl = chrome.runtime.getURL(`assets/audio/timer/${fileName}`);

      const audioResponse = await fetch(audioUrl);
      if (!audioResponse.ok) {
        throw new Error(`Failed to load audio file: ${fileName}`);
      }

      const audioBlob = await audioResponse.blob();

      const MAX_SIZE = 10 * 1024 * 1024; // 10MB limit for safe message passing
      if (audioBlob.size > MAX_SIZE) {
        // For large files, we'll handle them differently
        audioCache[fileName] = { blob: audioBlob, isLarge: true };
      } else {
        const audioBase64 = await blobToBase64(audioBlob);
        audioCache[fileName] = { base64: audioBase64, isLarge: false };
      }
    }

    let alarmAudioBase64 = null;
    if (alarmSound) {
      const alarmUrl = chrome.runtime.getURL(`assets/audio/alarms/${alarmSound}`);

      const alarmResponse = await fetch(alarmUrl);
      if (!alarmResponse.ok) {
        throw new Error(`Failed to load alarm file: ${alarmSound}`);
      }

      const alarmBlob = await alarmResponse.blob();
      alarmAudioBase64 = await blobToBase64(alarmBlob);
    }

    statusDiv.textContent = chrome.i18n.getMessage('status_generatingTimerIcons');

    const { generateTimerIcon, generateDotsTimerIcon, generateBlocksTimerIcon, generateGhostTimerIcon } = await import(chrome.runtime.getURL('utils/timerIconGenerator.js'));

    const iconDataUrls = [];
    for (let i = 0; i < numSegments; i++) {
      const progress = 1 - (i / numSegments);

      let iconDataUrl;
      if (iconStyle === 'tree-lights') {
        const treePath = `assets/icons/timer/tree-lights/tree-${numSegments}-${i}.png`;
        iconDataUrl = chrome.runtime.getURL(treePath);
        const treeResponse = await fetch(iconDataUrl);
        const treeBlob = await treeResponse.blob();
        const reader = new FileReader();
        iconDataUrl = await new Promise((resolve) => {
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(treeBlob);
        });
      } else if (iconStyle === 'ghost') {
        const pngUrl = chrome.runtime.getURL(`assets/icons/timer/ghost/ghost-${numSegments}-${i}.png`);
        const pngResponse = await fetch(pngUrl);

        if (!pngResponse.ok) {
          throw new Error(`Ghost PNG not found: ghost-${numSegments}-${i}.png`);
        }

        const pngBlob = await pngResponse.blob();
        const reader = new FileReader();
        iconDataUrl = await new Promise((resolve) => {
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(pngBlob);
        });
      } else if (iconStyle === 'flower') {
        iconDataUrl = generateTimerIcon(progress, 'flower');
      } else if (iconStyle === 'pizza') {
        iconDataUrl = await generatePizzaTimerIcon(progress, numSegments, i);
      } else if (iconStyle === 'dots') {
        iconDataUrl = generateDotsTimerIcon(progress, numSegments);
      } else if (iconStyle === 'blocks') {
        iconDataUrl = generateBlocksTimerIcon(progress, numSegments);
      } else {
        iconDataUrl = generateTimerIcon(progress, iconStyle);
      }

      iconDataUrls.push(iconDataUrl);
    }

    const BATCH_SIZE = 20;
    const uploadedIcons = [];

    for (let batchStart = 0; batchStart < numSegments; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, numSegments);
      const batchPromises = [];

      for (let i = batchStart; i < batchEnd; i++) {
        const iconBase64 = iconDataUrls[i].split(',')[1];
        const iconType = 'image/png';

        const uploadPromise = chrome.runtime.sendMessage({
          action: 'UPLOAD_ICON',
          file: {
            data: iconBase64,
            type: iconType,
            name: `timer-icon-${i}.png`
          }
        }).then(response => {
          if (response.error) {
            return null;
          }
          return response.iconId;
        }).catch(() => null);

        batchPromises.push(uploadPromise);
      }

      const batchResults = await Promise.all(batchPromises);
      uploadedIcons.push(...batchResults);

      const progress = Math.round((batchEnd / numSegments) * 100);
      statusDiv.textContent = chrome.i18n.getMessage('status_uploadingIconsPercent', [progress.toString()]);
    }

    const totalSeconds = duration * 60;
    const secondsPerSegment = totalSeconds / numSegments;

    const trackDataList = [];
    for (let i = 0; i < numSegments; i++) {
      const currentTime = totalSeconds - (i * secondsPerSegment);
      const audioFileName = silentFiles.length === 1 ? silentFiles[0] : silentFiles[i];
      const audioData = audioCache[audioFileName];

      if (!audioData) {
        throw new Error(`Audio file not found in cache: ${audioFileName}`);
      }

      const displayMinutes = Math.floor(currentTime / 60);
      const displaySeconds = currentTime % 60;

      let trackTitle;
      if (displayMinutes === 0) {
        trackTitle = chrome.i18n.getMessage('timer_secondsLeft', [displaySeconds.toString()]);
      } else if (displaySeconds === 0) {
        trackTitle = displayMinutes === 1 ? chrome.i18n.getMessage('timer_minuteLeft') : chrome.i18n.getMessage('timer_minutesLeft', [displayMinutes.toString()]);
      } else {
        const secondPlural = displaySeconds === 1 ? '' : 's';
        trackTitle = displayMinutes === 1
          ? chrome.i18n.getMessage('timer_minuteSecondsLeft', [displaySeconds.toString(), secondPlural])
          : chrome.i18n.getMessage('timer_minutesSecondsLeft', [displayMinutes.toString(), displaySeconds.toString(), secondPlural]);
      }

      trackDataList.push({
        index: i,
        title: trackTitle,
        audioFileName: audioFileName,
        audioData: audioData
      });
    }

    const TRACK_BATCH_SIZE = 12;
    const uploadedTracks = [];

    statusDiv.textContent = chrome.i18n.getMessage('status_uploadingTracksPercent', ['0']);

    for (let batchStart = 0; batchStart < numSegments; batchStart += TRACK_BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + TRACK_BATCH_SIZE, numSegments);
      const batchPromises = [];

      for (let i = batchStart; i < batchEnd; i++) {
        const trackData = trackDataList[i];

        const uploadPromise = (async () => {
          try {
            let uploadResponse;

            if (trackData.audioData.isLarge) {
              uploadResponse = await chrome.runtime.sendMessage({
                action: 'UPLOAD_TIMER_AUDIO',
                fileName: trackData.audioFileName,
                trackName: `timer-segment-${trackData.index}.wav`
              });
            } else {
              const audioBase64 = trackData.audioData.base64;

              if (!audioBase64 || audioBase64.length === 0) {
                throw new Error(`Invalid base64 data for track ${trackData.index + 1}`);
              }

              uploadResponse = await chrome.runtime.sendMessage({
                action: 'UPLOAD_AUDIO',
                file: {
                  data: audioBase64,
                  type: 'audio/wav',
                  name: `timer-segment-${trackData.index}.wav`
                }
              });
            }

            if (!uploadResponse) {
              throw new Error(`No response when uploading track ${trackData.index + 1}`);
            }

            if (uploadResponse.error) {
              throw new Error(`Failed to upload track ${trackData.index + 1}: ${uploadResponse.error}`);
            }

            if (!uploadResponse.success || !uploadResponse.transcodedAudio) {
              throw new Error(`Failed to upload track ${trackData.index + 1}: No transcoded audio returned`);
            }

            return {
              title: trackData.title,
              transcodedAudio: uploadResponse.transcodedAudio
            };
          } catch (error) {
            console.error(`Error uploading track ${trackData.index + 1}:`, error);
            throw error;
          }
        })();

        batchPromises.push(uploadPromise);
      }

      const batchResults = await Promise.all(batchPromises);
      uploadedTracks.push(...batchResults);

      const progress = Math.round((batchEnd / (numSegments + (alarmSound ? 1 : 0))) * 100);
      statusDiv.textContent = chrome.i18n.getMessage('status_uploadingTracksPercent', [progress.toString()]);
    }

    if (alarmAudioBase64) {
      const alarmResponse = await chrome.runtime.sendMessage({
        action: 'UPLOAD_AUDIO',
        file: {
          data: alarmAudioBase64,
          type: 'audio/mpeg',
          name: alarmSound
        }
      });

      if (alarmResponse.error) {
        throw new Error(`Failed to upload alarm: ${alarmResponse.error}`);
      }

      if (!alarmResponse.success || !alarmResponse.transcodedAudio) {
        throw new Error('Failed to upload alarm: No transcoded audio returned');
      }

      uploadedTracks.push({
        title: chrome.i18n.getMessage('timer_timesUp'),
        transcodedAudio: alarmResponse.transcodedAudio
      });

      statusDiv.textContent = chrome.i18n.getMessage('status_uploadingTracksPercent', ['100']);
    } else {
      const silentFileName = silentFiles && silentFiles.length > 0 ? silentFiles[0] : 'silent-1m.wav';

      // If the file isn't in cache, try to load it
      let silentAudioObj = audioCache[silentFileName];

      if (!silentAudioObj) {
        // Try to load the fallback file
        const fallbackUrl = chrome.runtime.getURL(`assets/audio/timer/${silentFileName}`);
        try {
          const fallbackResponse = await fetch(fallbackUrl);
          if (fallbackResponse.ok) {
            const fallbackBlob = await fallbackResponse.blob();
            const MAX_SIZE = 10 * 1024 * 1024;
            if (fallbackBlob.size > MAX_SIZE) {
              silentAudioObj = { blob: fallbackBlob, isLarge: true };
            } else {
              const fallbackBase64 = await blobToBase64(fallbackBlob);
              silentAudioObj = { base64: fallbackBase64, isLarge: false };
            }
            audioCache[silentFileName] = silentAudioObj;
          }
        } catch (error) {
          console.error(`Failed to load fallback silent file: ${silentFileName}`, error);
        }
      }

      if (!silentAudioObj) {
        // Skip adding a silent final track if we can't load the audio
      } else {
        let silentResponse;

        if (silentAudioObj.isLarge) {
          // For large files, have the service worker load and upload directly
          silentResponse = await chrome.runtime.sendMessage({
            action: 'UPLOAD_TIMER_AUDIO',
            fileName: silentFileName,
            trackName: 'timer-complete-silent.wav'
          });
        } else {
          // For smaller files, use the regular upload with base64
          const silentAudioData = silentAudioObj.base64;

          if (!silentAudioData) {
            throw new Error(`No base64 data for silent track: ${silentFileName}`);
          }

          silentResponse = await chrome.runtime.sendMessage({
            action: 'UPLOAD_AUDIO',
            file: {
              data: silentAudioData,
              type: 'audio/wav',
              name: silentFileName
            }
          });
        }

        if (silentResponse.error) {
          throw new Error(`Failed to upload silent track: ${silentResponse.error}`);
        }

        uploadedTracks.push({
          title: chrome.i18n.getMessage('timer_complete'),
          transcodedAudio: silentResponse.transcodedAudio
        });

        statusDiv.textContent = chrome.i18n.getMessage('status_uploadingTracksPercent', ['100']);
      }
    }

    if (iconStyle === 'ghost') {
      const pumpkinIcon = 'yoto:#bOEw9RBCHNv1ZRssedCImm4dG0ZwU2vHZhZSqPDp8DI';
      uploadedIcons.push(pumpkinIcon);
    } else if (iconStyle === 'tree-lights') {
      const treeIcon = 'yoto:#rJatTQ_Y6mlIATEti0EEDFxBws4uUpnDuiWo9rw03KY';
      uploadedIcons.push(treeIcon);
    } else if (iconStyle === 'flower') {
      try {
        const fullFlowerDataUrl = generateTimerIcon(0, 'flower');
        const base64Data = fullFlowerDataUrl.split(',')[1];

        const celebrationIconResponse = await chrome.runtime.sendMessage({
          action: 'UPLOAD_ICON',
          file: {
            data: base64Data,
            type: 'image/png',
            name: 'flower-celebration.png'
          }
        });

        if (celebrationIconResponse.error) {
          // Fallback to a default celebration icon
          const fallbackIcon = 'yoto:#tNXOIzQIPO6OjSzmT5WFofHhK3-KRGYvnlBxE1oF0-4'; // celebrate
          uploadedIcons.push(fallbackIcon);
        } else {
          uploadedIcons.push(celebrationIconResponse.iconId);
        }
      } catch (error) {
        // Fallback to a default celebration icon
        const fallbackIcon = 'yoto:#tNXOIzQIPO6OjSzmT5WFofHhK3-KRGYvnlBxE1oF0-4'; // celebrate
        uploadedIcons.push(fallbackIcon);
      }
    } else if (iconStyle === 'pizza') {
      // Use the specified Yoto pizza icon for the alarm track
      const pizzaAlarmIcon = 'yoto:#AnKy11MQUYBPjOm8DqkyhGRy1Xat3MvDXEjoGoAx7aI';
      uploadedIcons.push(pizzaAlarmIcon);
    } else {
      const celebrationIcons = [
        'yoto:#tNXOIzQIPO6OjSzmT5WFofHhK3-KRGYvnlBxE1oF0-4', // celebrate
        'yoto:#idzbpyi9ucjYfVWrfR637M6WkBKZsrP-34x7e5XFV4Y', // gold bell
        'yoto:#0Iqxsda8bJiWuN4SaGiQiOPuAfZWS1Rbzae3d7P53RU', // clock
        'yoto:#_WWpLHoOj6iqeREcGkJnGlsis2QSF6znM0UPFdXTjf8'  // music notes
      ];
      const randomIcon = celebrationIcons[Math.floor(Math.random() * celebrationIcons.length)];
      uploadedIcons.push(randomIcon);
    }

    statusDiv.textContent = chrome.i18n.getMessage('status_uploadingCover');

    let coverUrl = null;
    try {
      const coverPath = chrome.runtime.getURL('assets/timer/covers/generic-timer-cover.png');
      const coverResponse = await fetch(coverPath);
      if (!coverResponse.ok) {
        throw new Error(`Failed to fetch cover: ${coverResponse.status}`);
      }

      const coverBlob = await coverResponse.blob();
      const coverBase64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(coverBlob);
      });

      const base64Data = coverBase64.split(',')[1];

      const uploadCoverResponse = await chrome.runtime.sendMessage({
        action: 'UPLOAD_COVER',
        file: {
          data: base64Data,
          type: 'image/png',
          name: 'timer-cover.png'
        }
      });

      if (uploadCoverResponse && !uploadCoverResponse.error) {
        coverUrl = uploadCoverResponse.url;
      }
    } catch (coverError) {
    }

    statusDiv.textContent = chrome.i18n.getMessage('status_creatingCard');

    const createResponse = await chrome.runtime.sendMessage({
      action: 'CREATE_PLAYLIST',
      title: timerName,
      audioTracks: uploadedTracks,
      iconIds: uploadedIcons, // Pass the uploaded icon IDs
      coverUrl: coverUrl,
      isVisualTimer: true, // Flag to indicate this is a Visual Timer
      alwaysPlayFromStart: true // Always play timers from start
    });

    if (createResponse.error) {
      throw new Error(`Failed to create timer: ${createResponse.error}`);
    }

    // Success!
    statusDiv.style.backgroundColor = '#d1fae5';
    statusDiv.style.color = '#065f46';
    statusDiv.textContent = chrome.i18n.getMessage('status_timerCreatedSuccess');

    // Track event
    chrome.runtime.sendMessage({
      action: 'TRACK_EVENT',
      eventName: 'visual_timer_created',
      parameters: {
        duration: duration,
        icon_style: iconStyle,
        has_alarm: !!alarmSound,
        alarm_type: alarmSound || 'none'
      }
    });

    // Refresh after short delay
    setTimeout(() => {
      window.location.reload();
    }, 2000);

  } catch (error) {
    statusDiv.style.backgroundColor = '#fee2e2';
    statusDiv.style.color = '#991b1b';
    statusDiv.textContent = `${chrome.i18n.getMessage("error_generic", [error.message])}`;
    submitButton.disabled = false;
    submitButton.style.opacity = '1';
    submitButton.style.cursor = 'pointer';

    // Track error
    chrome.runtime.sendMessage({
      action: 'TRACK_ERROR',
      error: error.message,
      context: {
        action: 'create_visual_timer',
        component: 'content'
      }
    });
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // Make sure we have a valid result
      if (reader.result && typeof reader.result === 'string') {
        // Extract just the base64 part (remove the data:audio/wav;base64, prefix)
        const base64String = reader.result.split(',')[1];
        if (base64String) {
          // Clean the base64 string - remove any whitespace or line breaks
          const cleanBase64 = base64String.replace(/[\s\n\r]/g, '');

          const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
          if (!base64Regex.test(cleanBase64)) {
            reject(new Error('Invalid base64 characters detected'));
          } else {
            resolve(cleanBase64);
          }
        } else {
          reject(new Error('Failed to extract base64 from blob'));
        }
      } else {
        reject(new Error('FileReader did not return a valid result'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

function fileToBase64(file) {
  return blobToBase64(file);
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result.split(',')[1];
      resolve(base64String);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function extractZipContents(zip) {
  const files = {};

  // Filter non-directory entries
  const validEntries = Object.entries(zip.files).filter(([name, entry]) => !entry.dir);

  // Process files in parallel batches
  const FILE_BATCH_SIZE = 8; // Increased from 5 to 8 for faster file extraction
  for (let batchStart = 0; batchStart < validEntries.length; batchStart += FILE_BATCH_SIZE) {
    const batch = validEntries.slice(batchStart, Math.min(batchStart + FILE_BATCH_SIZE, validEntries.length));

    const batchPromises = batch.map(async ([entryName, zipEntry]) => {
      try {
        const blob = await zipEntry.async('blob');
        const fileName = entryName.split('/').pop();

        const ext = fileName.split('.').pop().toLowerCase();
        let mimeType = 'application/octet-stream';

        if (['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac'].includes(ext)) {
          mimeType = `audio/${ext === 'm4a' ? 'mp4' : ext}`;
        } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
          mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext}`;
        }

        const file = new File([blob], fileName, { type: mimeType });

        return { entryName, file };
      } catch (error) {
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach(result => {
      if (result) {
        files[result.entryName] = result.file;
      }
    });
  }

  return files;
}

function selectZipFileForUpdate(cardId) {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.zip,application/zip,application/x-zip-compressed';
  fileInput.style.display = 'none';

  fileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (file) {
      try {
        const zip = await JSZip.loadAsync(file);
        const files = await extractZipContents(zip);
        processUpdateFiles(files, file.name, cardId);
      } catch (error) {
        console.error('ZIP extraction error:', error);
        showNotification(chrome.i18n.getMessage('notification_errorReadingZip'), 'error');
      }
    }
  });

  fileInput.click();
}

function selectFolderForUpdate(cardId) {
  const folderInput = document.createElement('input');
  folderInput.type = 'file';
  folderInput.webkitdirectory = true;
  folderInput.directory = true;
  folderInput.multiple = true;
  folderInput.style.display = 'none';

  folderInput.addEventListener('change', async (event) => {
    const files = Array.from(event.target.files);
    if (files.length > 0) {
      const folderName = files[0].webkitRelativePath.split('/')[0];
      processUpdateFiles(files, folderName, cardId);
    }
  });

  folderInput.click();
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
      showNotification(chrome.i18n.getMessage('status_processingZip'), 'info');
      await processZipFile(files[0]);
    } else if (files.length > 0) {
      showNotification(chrome.i18n.getMessage('notification_invalidZip'), 'error');
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
      showNotification(chrome.i18n.getMessage('status_processingFolder'), 'info');
      await processFolderFiles(files);
    }
  });
  
  folderInput.click();
}

async function loadBestKidsPodcasts() {
  const loadingDiv = document.getElementById('best-podcasts-loading');
  const carouselDiv = document.getElementById('best-podcasts-carousel');
  const listDiv = document.getElementById('best-podcasts-list');

  try {
    // Fetch curated kids podcasts (already shuffled in service worker)
    const response = await chrome.runtime.sendMessage({
      action: 'GET_BEST_PODCASTS'
    });

    if (!response.error && response.podcasts && response.podcasts.length > 0) {
      listDiv.innerHTML = '';
      response.podcasts.forEach(podcast => {
        const podcastCard = createPodcastCardForMix(podcast, true);
        listDiv.appendChild(podcastCard);
      });

      carouselDiv.style.display = 'block';
    }

    loadingDiv.style.display = 'none';

  } catch (error) {
    console.error('[Podcast Carousel] Error loading podcasts:', error);
    loadingDiv.style.display = 'none';
  }
}

let podcastEpisodeQueue = [];
let currentPodcastView = null;
let podcastMixModalRef = null;

function generateQueueId(podcastId, episodeId) {
  return `${podcastId}_${episodeId}_${Date.now()}`;
}

function addEpisodeToQueue(episode, podcast) {
  const existingIndex = podcastEpisodeQueue.findIndex(
    item => item.podcast.id === podcast.id && item.id === episode.id
  );

  if (existingIndex !== -1) {
    return false;
  }

  const queuedEpisode = {
    ...episode,
    podcast: {
      id: podcast.id,
      title: podcast.title,
      thumbnail: podcast.thumbnail,
      publisher: podcast.publisher
    },
    queueId: generateQueueId(podcast.id, episode.id),
    addedAt: Date.now()
  };

  podcastEpisodeQueue.push(queuedEpisode);
  return true;
}

function removeEpisodeFromQueue(queueId) {
  const index = podcastEpisodeQueue.findIndex(item => item.queueId === queueId);
  if (index !== -1) {
    podcastEpisodeQueue.splice(index, 1);
    return true;
  }
  return false;
}

function removeEpisodeFromQueueByIds(podcastId, episodeId) {
  const index = podcastEpisodeQueue.findIndex(
    item => item.podcast.id === podcastId && item.id === episodeId
  );
  if (index !== -1) {
    podcastEpisodeQueue.splice(index, 1);
    return true;
  }
  return false;
}

function isEpisodeInQueue(podcastId, episodeId) {
  return podcastEpisodeQueue.some(
    item => item.podcast.id === podcastId && item.id === episodeId
  );
}

function getQueuedPodcasts() {
  const podcastMap = new Map();

  podcastEpisodeQueue.forEach(item => {
    const existing = podcastMap.get(item.podcast.id);
    if (existing) {
      existing.count++;
    } else {
      podcastMap.set(item.podcast.id, {
        ...item.podcast,
        count: 1
      });
    }
  });

  return Array.from(podcastMap.values());
}

function reorderQueue(fromIndex, toIndex) {
  if (fromIndex < 0 || fromIndex >= podcastEpisodeQueue.length) return;
  if (toIndex < 0 || toIndex >= podcastEpisodeQueue.length) return;

  const [removed] = podcastEpisodeQueue.splice(fromIndex, 1);
  podcastEpisodeQueue.splice(toIndex, 0, removed);
}

function clearEpisodeQueue() {
  podcastEpisodeQueue = [];
  currentPodcastView = null;
}

// SVG Icon helpers for podcast mix UI
function getSvgIcon(iconName) {
  const icons = {
    add: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
    check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`,
    remove: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`,
    back: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>`,
    dragHandle: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>`,
    chevronDown: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`,
    chevronUp: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>`
  };
  return icons[iconName] || '';
}

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
  
  card.addEventListener('click', () => selectPodcast(podcast));
  
  return card;
}

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
  
  const searchModal = document.getElementById('podcast-search-modal');
  if (searchModal) {
    searchModal.remove();
  }

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
  `;
  
  content.innerHTML = `
    <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">${chrome.i18n.getMessage('label_import')} ${podcast.title}</h2>
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
      <p style="margin-top: 10px; color: #6b7280;">${chrome.i18n.getMessage('status_loadingEpisodes')}</p>
    </div>
    <div id="episode-content" style="display: none;">
      <div style="margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <label style="font-weight: 500; color: #374151;">
            ${chrome.i18n.getMessage('label_selectEpisodesToImport')} <span id="selected-count" style="color: #3b82f6;"></span>
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
            ">${chrome.i18n.getMessage('button_selectAll')}</button>
            <button id="deselect-all-episodes" style="
              padding: 4px 12px;
              font-size: 12px;
              background: #6b7280;
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
            ">${chrome.i18n.getMessage('button_deselectAll')}</button>
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
        ">${chrome.i18n.getMessage('button_cancel')}</button>
        <button id="start-import" style="
          padding: 10px 20px;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
        ">${chrome.i18n.getMessage('button_import')}</button>
      </div>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  let allEpisodes = [];

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'GET_PODCAST_EPISODES',
      podcastId: podcast.id,
      feedUrl: podcast.feedUrl,
      feedId: podcast.feedId
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
                <h3 style="margin: 0 0 10px; color: #f57c00;">${chrome.i18n.getMessage('error_usageLimitReached')}</h3>
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

    if (allEpisodes.length === 0) {
      showNotification(chrome.i18n.getMessage('notification_noEpisodesFound'), 'error');
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
    
    document.getElementById('start-import').addEventListener('click', async () => {
      const selectedIndices = [];
      allEpisodes.forEach((_, index) => {
        const checkbox = document.getElementById(`episode-${index}`);
        if (checkbox && checkbox.checked) {
          selectedIndices.push(index);
        }
      });
      
      if (selectedIndices.length === 0) {
        showNotification(chrome.i18n.getMessage('notification_selectAtLeastOneEpisode'), 'warning');
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
      importBtn.textContent = chrome.i18n.getMessage('button_importing');
      // Keep cancel button enabled so user can cancel
      cancelBtn.textContent = chrome.i18n.getMessage('button_cancel');

      statusText.textContent = chrome.i18n.getMessage("status_startingImport");
      progressBar.style.width = '5%';
      
      let importCancelled = false;

      const cancelHandler = async () => {
        importCancelled = true;
        statusText.textContent = chrome.i18n.getMessage('status_cancellingImport');
        progressBar.style.width = '0%';
        
        // Notify service worker to stop the import
        try {
          await chrome.runtime.sendMessage({
            action: 'CANCEL_PODCAST_IMPORT'
          });
        } catch (e) {
        }
        
        await chrome.storage.local.remove(['podcastImportResult', 'podcastImportTimestamp', 'podcastImportProgress']);
        
        setTimeout(() => {
          modal.remove();
        }, 500);
      };
      
      // Replace the existing cancel handler
      cancelBtn.onclick = cancelHandler;

      // Verify account match before starting podcast import
      const accountVerification = await verifyAccountBeforeOperation();
      if (!accountVerification.valid) {
        // Account mismatch or session expired - user has been notified
        progressDiv.style.display = 'none';
        importBtn.disabled = false;
        importBtn.textContent = chrome.i18n.getMessage('button_startImport') || 'Start Import';
        return;
      }

      try {
        const isUpdateMode = window.yotoUpdateMode && window.yotoUpdateMode.isUpdateMode;
        const updateCardId = isUpdateMode ? window.yotoUpdateMode.cardId : null;

        // Start the import process
        const startResponse = await chrome.runtime.sendMessage({
          action: 'IMPORT_PODCAST_EPISODES',
          podcast: podcast,
          episodes: selectedEpisodes,
          updateMode: isUpdateMode,
          cardId: updateCardId
        });
        
        if (startResponse.error) {
          throw new Error(startResponse.error);
        }
        
        if (startResponse.status !== 'started') {
          throw new Error('Failed to start import');
        }
        
        let importComplete = false;
        const episodeCount = selectedEpisodes.length;

        // Scale inactivity timeout based on episode count - large imports need more time per episode
        // 5 min base + 2 min per episode (e.g., 21 episodes = 5 + 42 = 47 min max inactivity)
        const INACTIVITY_TIMEOUT_SECONDS = Math.max(300, 300 + (episodeCount * 120));
        let lastProgressCount = 0;
        let lastProgressTime = Date.now();
        let totalElapsedSeconds = 0;

        progressBar.style.width = '10%';
        statusText.textContent = chrome.i18n.getMessage('status_downloadingEpisodes');

        while (!importComplete && !importCancelled) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
          totalElapsedSeconds++;

          if (importCancelled) {
            break;
          }

          const statusResponse = await chrome.runtime.sendMessage({
            action: 'GET_PODCAST_IMPORT_STATUS'
          });

          if (statusResponse) {
            if (statusResponse.progress) {
              const progress = statusResponse.progress;
              if (progress.status === 'in_progress') {
                const percent = progress.total > 0
                  ? Math.min(10 + (progress.current / progress.total * 80), 90)
                  : 10;
                progressBar.style.width = `${percent}%`;
                statusText.textContent = progress.message || chrome.i18n.getMessage('status_processing');

                const currentCount = progress.current || 0;
                if (currentCount > lastProgressCount) {
                  lastProgressCount = currentCount;
                  lastProgressTime = Date.now();
                }
              }
            }

            if (statusResponse.success) {
              importComplete = true;
              progressBar.style.width = '100%';

              if (statusResponse.partial) {
                const imported = statusResponse.tracksImported || 0;
                const total = statusResponse.totalEpisodes || selectedEpisodes.length;
                const failed = statusResponse.failedCount || (total - imported);

                // Log failed episodes to console for debugging
                console.warn(`[PodcastImport:UI] Partial import: ${imported}/${total} episodes succeeded, ${failed} failed`);
                if (statusResponse.failureReasons && statusResponse.failureReasons.length > 0) {
                  console.warn(`[PodcastImport:UI] Failed episodes:`);
                  statusResponse.failureReasons.forEach((reason, i) => {
                    console.warn(`  ${i + 1}. "${reason.episode}" - ${reason.phase}: ${reason.error}`);
                  });
                }

                statusText.innerHTML = `
                  <div style="color: #28a745;">
                    <p>${chrome.i18n.getMessage("status_successfullyImportedEpisodes", [imported])}</p>
                    <p style="font-size: 14px; margin-top: 8px; color: #856404;">
                      Note: ${failed} episode${failed !== 1 ? 's' : ''} could not be imported due to errors. Check browser console for details.
                    </p>
                  </div>
                `;
              } else {
                statusText.textContent = `${chrome.i18n.getMessage("status_successfullyImportedEpisodes", [statusResponse.tracksImported || selectedEpisodes.length])}`;
              }

              importBtn.textContent = chrome.i18n.getMessage('status_completed');

              await chrome.storage.local.remove(['podcastImportResult', 'podcastImportTimestamp', 'podcastImportProgress']);

              setTimeout(() => {
                modal.remove();
                window.location.reload();
              }, statusResponse.partial ? 4000 : 2000); // Give more time to read partial message
            } else if (statusResponse.cancelled) {
              // Import was cancelled
              importComplete = true;
              importCancelled = true;
              break;
            } else if (statusResponse.needsPermission) {
              importComplete = true;
              statusText.innerHTML = `
                <div style="color: #dc3545;">
                  <p>${chrome.i18n.getMessage('error_permissionRequired')}</p>
                  <p style="font-size: 14px; margin-top: 10px;">${chrome.i18n.getMessage('error_closeModalAndRetry')}</p>
                </div>
              `;
              progressBar.style.width = '0%';
              importBtn.style.display = 'none';
              cancelBtn.textContent = chrome.i18n.getMessage('button_close');
            } else if (statusResponse.error) {
              // Log detailed failure info to console for debugging
              console.error(`[PodcastImport:UI] Import failed: ${statusResponse.error}`);
              if (statusResponse.failureReasons && statusResponse.failureReasons.length > 0) {
                console.error(`[PodcastImport:UI] Detailed failure reasons:`);
                statusResponse.failureReasons.forEach((reason, i) => {
                  console.error(`  ${i + 1}. "${reason.episode}" - ${reason.phase}: ${reason.error}`);
                  if (reason.details) {
                    console.error(`     Details:`, reason.details);
                  }
                });
              }
              throw new Error(statusResponse.error);
            }
          }

          const secondsSinceProgress = (Date.now() - lastProgressTime) / 1000;
          if (secondsSinceProgress >= INACTIVITY_TIMEOUT_SECONDS) {
            console.error(`[PodcastImport:UI] No progress for ${secondsSinceProgress.toFixed(0)}s - timing out`);

            const finalStatus = await chrome.runtime.sendMessage({
              action: 'GET_PODCAST_IMPORT_STATUS'
            });

            if (finalStatus && finalStatus.success) {
              importComplete = true;
              progressBar.style.width = '100%';
              statusText.textContent = `${chrome.i18n.getMessage("status_successfullyImportedEpisodes", [finalStatus.tracksImported || selectedEpisodes.length])}`;
              importBtn.textContent = chrome.i18n.getMessage('status_completed');

              await chrome.storage.local.remove(['podcastImportResult', 'podcastImportTimestamp', 'podcastImportProgress']);

              setTimeout(() => {
                modal.remove();
                window.location.reload();
              }, 2000);
            } else {
              throw new Error(chrome.i18n.getMessage('error_importTakingTooLong'));
            }
          }
        }

        if (window.yotoUpdateMode) {
          delete window.yotoUpdateMode;
        }

      } catch (error) {
        console.error(`[PodcastImport:UI] Import error:`, error.message);

        statusText.textContent = `${chrome.i18n.getMessage("error_generic", [error.message])}`;
        progressBar.style.width = '0%';
        importBtn.disabled = false;
        importBtn.textContent = chrome.i18n.getMessage('button_importPlaylist');
        cancelBtn.textContent = chrome.i18n.getMessage('button_close');
        cancelBtn.onclick = () => modal.remove();
        showNotification(`${chrome.i18n.getMessage("notification_importFailedMessage", [error.message])}`, 'error');

        if (window.yotoUpdateMode) {
          delete window.yotoUpdateMode;
        }
      }
    });
    
    document.getElementById('episode-cancel').addEventListener('click', () => {
      modal.remove();
      if (window.yotoUpdateMode) {
        delete window.yotoUpdateMode;
      }
    });
    
  } catch (error) {
    showNotification(chrome.i18n.getMessage('notification_failedToLoadPodcastEpisodes'), 'error');
    modal.remove();
  }
  
}

function showPodcastSearchModal() {
  clearEpisodeQueue();

  const modal = document.createElement('div');
  modal.id = 'podcast-mix-modal';
  podcastMixModalRef = modal;
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
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    border-radius: 12px;
    max-width: 800px;
    width: 90%;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    overflow: hidden;
  `;

  content.innerHTML = `
    <div style="padding: 24px 24px 0 24px; flex-shrink: 0;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <button id="header-back-btn" style="
            display: none;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            padding: 0;
            background: #f3f4f6;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            cursor: pointer;
            color: #374151;
            transition: all 0.15s;
          " title="${chrome.i18n.getMessage('button_backToSearch') || 'Back'}"
             onmouseover="this.style.background='#e5e7eb'; this.style.borderColor='#9ca3af'; this.style.color='#1f2937';"
             onmouseout="this.style.background='#f3f4f6'; this.style.borderColor='#d1d5db'; this.style.color='#374151';">
            ${getSvgIcon('back')}
          </button>
          <h2 style="margin: 0; color: #2c3e50; font-size: 22px;">${chrome.i18n.getMessage('modal_mixPodcastEpisodes') || 'Add Podcast Episodes'}</h2>
        </div>
        <button id="podcast-mix-close" style="background: none; border: none; cursor: pointer; padding: 4px; color: #6b7280;">
          ${getSvgIcon('remove')}
        </button>
      </div>
      <div style="display: flex; gap: 8px; margin-bottom: 16px;">
        <div style="flex: 1; position: relative;">
          <input type="text" id="podcast-search-input" placeholder="${chrome.i18n.getMessage('placeholder_podcastSearch')}" style="
            width: 100%;
            padding: 10px 40px 10px 12px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            font-size: 14px;
            box-sizing: border-box;
          " />
          <button id="podcast-filter-btn" title="Search filters" style="
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            background: none;
            border: none;
            cursor: pointer;
            padding: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #6b7280;
            transition: color 0.15s;
          " onmouseover="this.style.color='#374151'" onmouseout="this.style.color='#6b7280'">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 7L20 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
              <path d="M4 7L8 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
              <path d="M17 17L20 17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
              <path d="M4 17L12 17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
              <circle cx="10" cy="7" r="2" transform="rotate(90 10 7)" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></circle>
              <circle cx="15" cy="17" r="2" transform="rotate(90 15 17)" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></circle>
            </svg>
          </button>
          <div id="podcast-filter-dropdown" style="
            display: none;
            position: absolute;
            top: 100%;
            right: 0;
            margin-top: 4px;
            background: white;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 100;
            min-width: 200px;
            padding: 8px 0;
          ">
            <div style="padding: 8px 12px; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">
              Search By
            </div>
            <label style="display: flex; align-items: center; padding: 8px 12px; cursor: pointer; transition: background 0.15s;" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='transparent'">
              <input type="radio" name="podcast-search-type" value="bytitle" checked style="margin-right: 10px; accent-color: #3b82f6;">
              <span style="color: #374151; font-size: 14px;">Podcast Title</span>
            </label>
            <label style="display: flex; align-items: center; padding: 8px 12px; cursor: pointer; transition: background 0.15s;" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='transparent'">
              <input type="radio" name="podcast-search-type" value="byperson" style="margin-right: 10px; accent-color: #3b82f6;">
              <span style="color: #374151; font-size: 14px;">Episodes by Person</span>
            </label>
            <label style="display: flex; align-items: center; padding: 8px 12px; cursor: pointer; transition: background 0.15s;" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='transparent'">
              <input type="radio" name="podcast-search-type" value="music" style="margin-right: 10px; accent-color: #3b82f6;">
              <span style="color: #374151; font-size: 14px;">Music</span>
            </label>
          </div>
        </div>
        <button id="podcast-search-btn" style="
          padding: 10px 16px;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          white-space: nowrap;
        ">${chrome.i18n.getMessage('button_search')}</button>
      </div>
    </div>

    <div id="podcast-mix-content" style="flex: 1; overflow-y: auto; padding: 0 24px;">
      <div id="podcast-search-view">
        <div id="best-podcasts-section" style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #374151;">
            ${chrome.i18n.getMessage('label_popularKidsPodcasts')}
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
        </div>

        <div id="podcast-search-results" style="display: none; margin-bottom: 20px;">
          <div id="podcast-loading" style="display: none; text-align: center; padding: 20px;">
            <div style="display: inline-block; width: 40px; height: 40px; border: 3px solid #f3f4f6; border-top-color: #3b82f6; border-radius: 50%; animation: spin 1s linear infinite;"></div>
            <p style="margin-top: 10px; color: #6b7280;">${chrome.i18n.getMessage('status_searchingPodcasts')}</p>
          </div>
          <div id="podcast-list" style="max-height: 300px; overflow-y: auto;"></div>
          <div id="podcast-error" style="display: none; color: #ef4444; padding: 10px; background: #fee; border-radius: 6px;"></div>
        </div>
      </div>

      <div id="podcast-episode-view" style="display: none;"></div>
    </div>

    <div id="podcast-queue-footer" style="display: none; border-top: 1px solid #e5e7eb; background: #f9fafb; flex-shrink: 0;"></div>

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
        #best-podcasts-carousel {
          padding-bottom: 25px;
        }
        #best-podcasts-carousel::-webkit-scrollbar {
          height: 14px !important;
        }
      }
      @media (min-width: 1025px) {
        #best-podcasts-carousel::-webkit-scrollbar {
          height: 14px !important;
        }
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      .podcast-episode-row:hover {
        background: #f3f4f6 !important;
      }
      .podcast-queue-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 12px;
      }
      .drag-over {
        border-top: 2px solid #3b82f6 !important;
      }
      .dragging {
        opacity: 0.5;
      }
    </style>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  loadBestKidsPodcasts();

  const searchInput = document.getElementById('podcast-search-input');
  searchInput.focus();

  // Filter dropdown toggle
  const filterBtn = document.getElementById('podcast-filter-btn');
  const filterDropdown = document.getElementById('podcast-filter-dropdown');

  filterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isVisible = filterDropdown.style.display === 'block';
    filterDropdown.style.display = isVisible ? 'none' : 'block';
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (filterDropdown && !filterDropdown.contains(e.target) && e.target !== filterBtn) {
      filterDropdown.style.display = 'none';
    }
  });

  // Get current search type
  const getSearchType = () => {
    const selected = document.querySelector('input[name="podcast-search-type"]:checked');
    return selected ? selected.value : 'bytitle';
  };

  const searchBtn = document.getElementById('podcast-search-btn');
  const handleSearch = async () => {
    const query = searchInput.value.trim();
    if (!query) {
      showNotification(chrome.i18n.getMessage('notification_enterPodcastName'), 'error');
      return;
    }

    // Close filter dropdown if open
    filterDropdown.style.display = 'none';

    const searchType = getSearchType();
    showSearchViewInMixModal();

    const resultsDiv = document.getElementById('podcast-search-results');
    const loadingDiv = document.getElementById('podcast-loading');
    const listDiv = document.getElementById('podcast-list');
    const errorDiv = document.getElementById('podcast-error');

    resultsDiv.style.display = 'block';
    loadingDiv.style.display = 'block';
    listDiv.innerHTML = '';
    errorDiv.style.display = 'none';

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'SEARCH_PODCASTS',
        query: query,
        searchType: searchType
      });

      loadingDiv.style.display = 'none';

      if (response.error === 'rate_limited' && response.rateLimited) {
        errorDiv.innerHTML = `
          <div style="padding: 15px; background: #fff8e1; border: 1px solid #ffcc00; border-radius: 8px; margin-bottom: 20px;">
            <div style="display: flex; align-items: start; gap: 10px;">
              <span style="font-size: 20px;">⚠️</span>
              <div>
                <strong style="color: #f57c00;">${chrome.i18n.getMessage('error_usageLimitReached')}</strong>
                <p style="margin: 8px 0 0 0; color: #666; line-height: 1.5;">${response.message}</p>
              </div>
            </div>
          </div>
        `;
        errorDiv.style.display = 'block';

        if (response.podcasts && response.podcasts.length > 0) {
          const suggestionDiv = document.createElement('div');
          suggestionDiv.innerHTML = `<h3 style="margin: 20px 0 10px;">${chrome.i18n.getMessage('label_popularKidsPodcasts')}</h3>`;
          listDiv.appendChild(suggestionDiv);

          response.podcasts.forEach(podcast => {
            const podcastCard = createPodcastCardForMix(podcast, false);
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

      // Handle byperson search (returns episodes directly)
      if (response.searchType === 'byperson') {
        if (!response.episodes || response.episodes.length === 0) {
          errorDiv.textContent = `No episodes found for "${query}"`;
          errorDiv.style.display = 'block';
          return;
        }

        // Show episodes directly - they can be added to the queue
        listDiv.innerHTML = `
          <div style="margin-bottom: 12px;">
            <span style="font-size: 14px; color: #6b7280;">${response.episodes.length} episodes found</span>
          </div>
        `;

        response.episodes.forEach(episode => {
          const episodeRow = createEpisodeRowForPersonSearch(episode);
          listDiv.appendChild(episodeRow);
        });
        return;
      }

      // Handle podcast search (bytitle and music)
      if (!response.podcasts || response.podcasts.length === 0) {
        errorDiv.textContent = chrome.i18n.getMessage('error_noPodcastsFound', [query]);
        errorDiv.style.display = 'block';
        return;
      }

      response.podcasts.forEach(podcast => {
        const podcastCard = createPodcastCardForMix(podcast, false);
        listDiv.appendChild(podcastCard);
      });

    } catch (error) {
      loadingDiv.style.display = 'none';
      errorDiv.textContent = chrome.i18n.getMessage('error_failedSearch');
      errorDiv.style.display = 'block';
    }
  };

  searchBtn.addEventListener('click', handleSearch);
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  });

  document.getElementById('podcast-mix-close').addEventListener('click', () => {
    clearEpisodeQueue();
    modal.remove();
    podcastMixModalRef = null;
  });

  document.getElementById('header-back-btn').addEventListener('click', showSearchViewInMixModal);

  updateQueueFooter();
}

function showSearchViewInMixModal() {
  const searchView = document.getElementById('podcast-search-view');
  const episodeView = document.getElementById('podcast-episode-view');
  const headerBackBtn = document.getElementById('header-back-btn');
  if (searchView) searchView.style.display = 'block';
  if (episodeView) episodeView.style.display = 'none';
  if (headerBackBtn) headerBackBtn.style.display = 'none';
  currentPodcastView = null;
}

function createEpisodeRowForPersonSearch(episode) {
  const row = document.createElement('div');
  row.className = 'podcast-episode-row';
  row.style.cssText = `
    display: flex;
    align-items: center;
    padding: 12px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    margin-bottom: 8px;
    gap: 12px;
    transition: background 0.15s;
  `;

  const isInQueue = episodeQueue.some(ep => ep.id === episode.id);
  const durationMin = Math.floor((episode.audio_length_sec || 0) / 60);
  const durationSec = (episode.audio_length_sec || 0) % 60;
  const durationStr = `${durationMin}:${durationSec.toString().padStart(2, '0')}`;

  const pubDate = episode.pub_date_ms ? new Date(episode.pub_date_ms).toLocaleDateString() : '';

  row.innerHTML = `
    <img src="${episode.thumbnail || episode.feedImage || ''}" alt="" style="
      width: 50px;
      height: 50px;
      border-radius: 6px;
      object-fit: cover;
      background: #f3f4f6;
      flex-shrink: 0;
    " onerror="this.style.display='none'">
    <div style="flex: 1; min-width: 0;">
      <div style="font-weight: 500; color: #1f2937; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${episode.title}
      </div>
      <div style="font-size: 12px; color: #6b7280; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${episode.feedTitle || 'Unknown Podcast'}
      </div>
      <div style="font-size: 11px; color: #9ca3af; margin-top: 2px;">
        ${durationStr}${pubDate ? ` • ${pubDate}` : ''}
      </div>
    </div>
    <button class="episode-add-btn" style="
      padding: 6px 12px;
      background: ${isInQueue ? '#ef4444' : '#3b82f6'};
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      flex-shrink: 0;
    ">${isInQueue ? 'Remove' : 'Add'}</button>
  `;

  const addBtn = row.querySelector('.episode-add-btn');
  addBtn.addEventListener('click', () => {
    const currentlyInQueue = episodeQueue.some(ep => ep.id === episode.id);

    if (currentlyInQueue) {
      removeFromEpisodeQueue(episode.id);
      addBtn.textContent = 'Add';
      addBtn.style.background = '#3b82f6';
    } else {
      if (episodeQueue.length >= 100) {
        showNotification('Maximum 100 episodes allowed per playlist', 'error');
        return;
      }
      addToEpisodeQueue({
        id: episode.id,
        title: episode.title,
        audio: episode.audio,
        duration: episode.audio_length_sec,
        thumbnail: episode.thumbnail || episode.feedImage,
        podcastTitle: episode.feedTitle || 'Unknown Podcast'
      });
      addBtn.textContent = 'Remove';
      addBtn.style.background = '#ef4444';
    }
    updateQueueFooter();
  });

  return row;
}

function createPodcastCardForMix(podcast, isCompact = false) {
  const card = document.createElement('div');

  if (isCompact) {
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

  card.addEventListener('click', () => showEpisodesInMixModal(podcast));

  return card;
}

async function showEpisodesInMixModal(podcast) {
  chrome.runtime.sendMessage({
    action: 'TRACK_EVENT',
    eventName: 'podcast_selected',
    parameters: {
      podcast_title: podcast.title,
      podcast_id: podcast.id
    }
  });

  currentPodcastView = podcast;

  const searchView = document.getElementById('podcast-search-view');
  const episodeView = document.getElementById('podcast-episode-view');
  const headerBackBtn = document.getElementById('header-back-btn');

  if (searchView) searchView.style.display = 'none';
  if (headerBackBtn) headerBackBtn.style.display = 'flex';
  if (!episodeView) return;

  episodeView.style.display = 'block';
  episodeView.innerHTML = `
    <div style="display: flex; gap: 16px; margin-bottom: 16px; align-items: flex-start;">
      ${podcast.thumbnail ?
        `<img src="${podcast.thumbnail}" alt="${podcast.title}" style="
          width: 80px;
          height: 80px;
          border-radius: 8px;
          object-fit: cover;
          background: #f3f4f6;
          flex-shrink: 0;
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
        color: white;
        flex-shrink: 0;
      ">
        🎙️
      </div>
      <div style="flex: 1; min-width: 0;">
        <h3 style="margin: 0 0 4px 0; font-size: 18px; color: #1f2937; font-weight: 600;">${podcast.title}</h3>
        <p style="margin: 0 0 8px 0; font-size: 13px; color: #6b7280;">${podcast.publisher || ''}</p>
        <p id="podcast-description-text" style="
          margin: 0;
          font-size: 13px;
          color: #4b5563;
          line-height: 1.4;
          display: ${podcast.description ? 'block' : 'none'};
          max-height: 60px;
          overflow-y: auto;
        ">${podcast.description || ''}</p>
      </div>
    </div>
    <div id="episode-loading" style="text-align: center; padding: 40px;">
      <div style="display: inline-block; width: 40px; height: 40px; border: 3px solid #f3f4f6; border-top-color: #3b82f6; border-radius: 50%; animation: spin 1s linear infinite;"></div>
      <p style="margin-top: 10px; color: #6b7280;">${chrome.i18n.getMessage('status_loadingEpisodes')}</p>
    </div>
    <div id="episode-list-container" style="display: none;">
      <div style="margin-bottom: 8px; display: flex; gap: 8px; align-items: center;">
        <input type="text" id="episode-filter-input" placeholder="${chrome.i18n.getMessage('placeholder_filterEpisodes') || 'Filter episodes...'}" style="
          flex: 1;
          padding: 8px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 14px;
          box-sizing: border-box;
        " />
        <select id="episode-sort-select" style="
          padding: 8px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 14px;
          background: white;
          cursor: pointer;
          color: #374151;
        ">
          <option value="newest">${chrome.i18n.getMessage('sort_newestFirst') || 'Newest first'}</option>
          <option value="oldest">${chrome.i18n.getMessage('sort_oldestFirst') || 'Oldest first'}</option>
        </select>
      </div>
      <div style="margin-bottom: 12px; display: flex; gap: 8px;">
        <button id="select-all-episodes-btn" style="
          padding: 6px 12px;
          background: #f3f4f6;
          color: #374151;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
        ">${chrome.i18n.getMessage('button_selectAll') || 'Select All'}</button>
        <button id="deselect-all-episodes-btn" style="
          padding: 6px 12px;
          background: #f3f4f6;
          color: #374151;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
        ">${chrome.i18n.getMessage('button_deselectAll') || 'Deselect All'}</button>
      </div>
      <div id="mix-episode-list" style="
        max-height: 350px;
        overflow-y: auto;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: #f9fafb;
        margin-bottom: 16px;
      "></div>
    </div>
  `;

  // Fetch podcast description from RSS if not already available
  if (!podcast.description && podcast.feedUrl) {
    chrome.runtime.sendMessage({
      action: 'FETCH_PODCAST_DESCRIPTION',
      feedUrl: podcast.feedUrl
    }).then(result => {
      if (result?.description) {
        const descEl = document.getElementById('podcast-description-text');
        if (descEl) {
          descEl.textContent = result.description;
          descEl.style.display = 'block';
        }
      }
    }).catch(() => {});
  }

  let allEpisodes = [];

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'GET_PODCAST_EPISODES',
      podcastId: podcast.id,
      feedUrl: podcast.feedUrl,
      feedId: podcast.feedId
    });

    document.getElementById('episode-loading').style.display = 'none';
    document.getElementById('episode-list-container').style.display = 'block';

    if (response.error === 'rate_limited' && response.rateLimited) {
      document.getElementById('mix-episode-list').innerHTML = `
        <div style="padding: 20px;">
          <div style="background: #fff8e1; border: 1px solid #ffcc00; border-radius: 8px; padding: 20px;">
            <div style="display: flex; align-items: start; gap: 12px;">
              <span style="font-size: 24px;">⚠️</span>
              <div>
                <h3 style="margin: 0 0 10px; color: #f57c00;">${chrome.i18n.getMessage('error_usageLimitReached')}</h3>
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
      showSearchViewInMixModal();
      return;
    }

    allEpisodes = response.episodes || [];

    if (allEpisodes.length === 0) {
      showNotification(chrome.i18n.getMessage('notification_noEpisodesFound'), 'error');
      showSearchViewInMixModal();
      return;
    }

    // Helper to get current filter/sort state
    const getFilterSortState = () => {
      const filterInput = document.getElementById('episode-filter-input');
      const sortSelect = document.getElementById('episode-sort-select');
      return {
        filterTerm: filterInput?.value.trim().toLowerCase() || '',
        sortOrder: sortSelect?.value || 'newest'
      };
    };

    renderMixEpisodeList(podcast, allEpisodes);

    const filterInput = document.getElementById('episode-filter-input');
    const sortSelect = document.getElementById('episode-sort-select');

    if (filterInput) {
      filterInput.addEventListener('input', function() {
        const { filterTerm, sortOrder } = getFilterSortState();
        renderMixEpisodeList(podcast, allEpisodes, filterTerm, sortOrder);
      });
    }

    if (sortSelect) {
      sortSelect.addEventListener('change', function() {
        const { filterTerm, sortOrder } = getFilterSortState();
        renderMixEpisodeList(podcast, allEpisodes, filterTerm, sortOrder);
      });
    }

    const selectAllBtn = document.getElementById('select-all-episodes-btn');
    const deselectAllBtn = document.getElementById('deselect-all-episodes-btn');

    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', function() {
        const { filterTerm, sortOrder } = getFilterSortState();
        const episodesToSelect = filterTerm
          ? allEpisodes.filter(ep => ep.title.toLowerCase().includes(filterTerm))
          : allEpisodes;

        episodesToSelect.forEach(episode => {
          if (!isEpisodeInQueue(podcast.id, episode.id)) {
            addEpisodeToQueue(episode, podcast);
          }
        });
        renderMixEpisodeList(podcast, allEpisodes, filterTerm, sortOrder);
        updateQueueFooter();
      });
    }

    if (deselectAllBtn) {
      deselectAllBtn.addEventListener('click', function() {
        const { filterTerm, sortOrder } = getFilterSortState();
        const episodesToDeselect = filterTerm
          ? allEpisodes.filter(ep => ep.title.toLowerCase().includes(filterTerm))
          : allEpisodes;

        episodesToDeselect.forEach(episode => {
          if (isEpisodeInQueue(podcast.id, episode.id)) {
            removeEpisodeFromQueueByIds(podcast.id, episode.id);
          }
        });
        renderMixEpisodeList(podcast, allEpisodes, filterTerm, sortOrder);
        updateQueueFooter();
      });
    }

  } catch (error) {
    showNotification(chrome.i18n.getMessage('notification_failedToLoadPodcastEpisodes'), 'error');
    showSearchViewInMixModal();
  }
}

function renderMixEpisodeList(podcast, episodes, filterTerm = '', sortOrder = 'newest') {
  const listContainer = document.getElementById('mix-episode-list');
  if (!listContainer) return;

  // Filter first
  let processedEpisodes = filterTerm
    ? episodes.filter(ep => ep.title.toLowerCase().includes(filterTerm))
    : [...episodes];

  // Then sort by publish date
  processedEpisodes.sort((a, b) => {
    const dateA = a.pub_date_ms || 0;
    const dateB = b.pub_date_ms || 0;
    return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
  });

  if (processedEpisodes.length === 0 && filterTerm) {
    listContainer.innerHTML = `
      <div style="padding: 24px; text-align: center; color: #6b7280;">
        <p style="margin: 0;">${chrome.i18n.getMessage('label_noEpisodesMatch') || 'No episodes match your filter'}</p>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = processedEpisodes.map((ep, processedIndex) => {
    const originalIndex = episodes.indexOf(ep);
    const isInQueue = isEpisodeInQueue(podcast.id, ep.id);
    const isOverLimit = ep.audio_length_sec > 3600;
    const durationColor = isOverLimit ? '#ef4444' : '#6b7280';
    const warningAsterisk = isOverLimit ? '*' : '';

    return `
      <div class="podcast-episode-row" data-episode-index="${originalIndex}" style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px;
        border-bottom: 1px solid #e5e7eb;
        background: white;
        transition: background 0.15s;
      ">
        <div style="flex: 1; min-width: 0; margin-right: 12px;">
          <div style="font-weight: 500; color: #1f2937; margin-bottom: 4px; font-size: 14px;">
            ${ep.title}
          </div>
          <div style="font-size: 12px; color: ${durationColor};">
            ${formatDuration(ep.audio_length_sec)}${warningAsterisk}
            ${ep.pub_date_ms ? ` • ${new Date(ep.pub_date_ms).toLocaleDateString()}` : ''}
          </div>
        </div>
        <button class="episode-add-btn" data-podcast-id="${podcast.id}" data-episode-index="${originalIndex}" style="
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: ${isInQueue ? '#dcfce7' : '#f3f4f6'};
          color: ${isInQueue ? '#16a34a' : '#374151'};
          border: 1px solid ${isInQueue ? '#86efac' : '#d1d5db'};
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          transition: all 0.15s;
          white-space: nowrap;
        ">
          ${isInQueue ? getSvgIcon('check') : getSvgIcon('add')}
          ${isInQueue ? (chrome.i18n.getMessage('button_added') || 'Added') : (chrome.i18n.getMessage('button_addToQueue') || 'Add')}
        </button>
      </div>
    `;
  }).join('');

  if (processedEpisodes.some(ep => ep.audio_length_sec > 3600)) {
    listContainer.innerHTML += `
      <p style="margin: 12px; font-size: 12px; color: #6b7280; font-style: italic;">
        <span style="color: #ef4444;">*</span> Episodes over 60 minutes may exceed Yoto's official track limit.
      </p>
    `;
  }

  listContainer.querySelectorAll('.episode-add-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const episodeIndex = parseInt(this.dataset.episodeIndex);
      const episode = episodes[episodeIndex];

      if (isEpisodeInQueue(podcast.id, episode.id)) {
        removeEpisodeFromQueueByIds(podcast.id, episode.id);
      } else {
        addEpisodeToQueue(episode, podcast);
      }

      const currentFilter = document.getElementById('episode-filter-input')?.value.trim().toLowerCase() || '';
      const currentSort = document.getElementById('episode-sort-select')?.value || 'newest';
      renderMixEpisodeList(podcast, episodes, currentFilter, currentSort);
      updateQueueFooter();
    });
  });
}

function updateQueueFooter() {
  const footer = document.getElementById('podcast-queue-footer');
  if (!footer) return;

  const queueLength = podcastEpisodeQueue.length;

  if (queueLength === 0) {
    footer.style.display = 'none';
    return;
  }

  footer.style.display = 'block';
  const podcasts = getQueuedPodcasts();
  const isExpanded = footer.dataset.expanded === 'true';

  footer.innerHTML = `
    <div style="padding: 12px 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <button id="queue-toggle" style="
          display: flex;
          align-items: center;
          gap: 8px;
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
          font-size: 14px;
          font-weight: 500;
          color: #374151;
        ">
          ${isExpanded ? getSvgIcon('chevronDown') : getSvgIcon('chevronUp')}
          <span>${queueLength} ${queueLength === 1 ? 'episode' : 'episodes'} from ${podcasts.length} ${podcasts.length === 1 ? 'podcast' : 'podcasts'}</span>
        </button>
        <button id="review-import-btn" style="
          padding: 8px 16px;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 6px;
        ">
          ${chrome.i18n.getMessage('button_reviewAndImport') || 'Review & Import'}
        </button>
      </div>
      ${isExpanded ? `
        <div style="margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px;">
          ${podcasts.map(p => `
            <div style="
              display: flex;
              align-items: center;
              gap: 8px;
              padding: 6px 10px;
              background: white;
              border: 1px solid #e5e7eb;
              border-radius: 6px;
            ">
              ${p.thumbnail ?
                `<img src="${p.thumbnail}" style="width: 24px; height: 24px; border-radius: 4px; object-fit: cover;">` :
                `<div style="width: 24px; height: 24px; border-radius: 4px; background: linear-gradient(135deg, #1558d1 0%, #0f47a8 100%); display: flex; align-items: center; justify-content: center; font-size: 12px;">🎙️</div>`
              }
              <span style="font-size: 13px; color: #374151;">${p.title}</span>
              <span style="font-size: 12px; color: #6b7280; background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">${p.count}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;

  document.getElementById('queue-toggle').addEventListener('click', () => {
    footer.dataset.expanded = isExpanded ? 'false' : 'true';
    updateQueueFooter();
  });

  document.getElementById('review-import-btn').addEventListener('click', showPodcastReviewModal);
}

function showPodcastReviewModal() {
  if (podcastEpisodeQueue.length === 0) {
    showNotification(chrome.i18n.getMessage('notification_selectAtLeastOneEpisode') || 'Please add at least one episode', 'warning');
    return;
  }

  const firstPodcast = podcastEpisodeQueue[0].podcast;

  const modal = document.createElement('div');
  modal.id = 'podcast-review-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    z-index: 100000;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10vh;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    border-radius: 12px;
    max-width: 600px;
    width: 90%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    overflow: hidden;
  `;

  const podcasts = getQueuedPodcasts();

  // Check if we're in update mode (adding to existing playlist)
  const isUpdateMode = window.yotoUpdateMode && window.yotoUpdateMode.isUpdateMode;
  const modalTitle = isUpdateMode
    ? (chrome.i18n.getMessage('modal_addEpisodesToPlaylist') || 'Add Episodes to Playlist')
    : (chrome.i18n.getMessage('modal_reviewYourPlaylist') || 'Review Your Playlist');
  const importButtonText = isUpdateMode
    ? (chrome.i18n.getMessage('button_addEpisodes') || 'Add Episodes')
    : (chrome.i18n.getMessage('button_import') || 'Import');

  content.innerHTML = `
    <div style="padding: 24px; border-bottom: 1px solid #e5e7eb;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h2 style="margin: 0; color: #2c3e50; font-size: 20px;">${modalTitle}</h2>
        <button id="review-close" style="background: none; border: none; cursor: pointer; padding: 4px; color: #6b7280;">
          ${getSvgIcon('remove')}
        </button>
      </div>
      <div style="display: flex; gap: 16px; align-items: center;">
        ${firstPodcast.thumbnail ?
          `<img src="${firstPodcast.thumbnail}" style="width: 60px; height: 60px; border-radius: 8px; object-fit: cover; background: #f3f4f6;">` :
          `<div style="width: 60px; height: 60px; border-radius: 8px; background: linear-gradient(135deg, #1558d1 0%, #0f47a8 100%); display: flex; align-items: center; justify-content: center; font-size: 24px; color: white;">🎙️</div>`
        }
        <div style="flex: 1; ${isUpdateMode ? 'display: none;' : ''}">
          <label style="display: block; margin-bottom: 6px; font-size: 13px; color: #6b7280;">${chrome.i18n.getMessage('label_playlistName') || 'Playlist Name'}</label>
          <input type="text" id="playlist-name-input" style="
            width: 100%;
            padding: 8px 12px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            font-size: 14px;
            box-sizing: border-box;
          " />
        </div>
      </div>
    </div>

    <div style="flex: 1; overflow-y: auto; padding: 16px 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <span style="font-size: 14px; color: #6b7280;">${podcastEpisodeQueue.length} ${podcastEpisodeQueue.length === 1 ? 'episode' : 'episodes'}</span>
        <span style="font-size: 12px; color: #9ca3af;">${chrome.i18n.getMessage('label_dragToReorder') || 'Drag to reorder'}</span>
      </div>
      <div id="review-episode-list" style="
        border: 1px solid #d1d5db;
        border-radius: 8px;
        overflow: hidden;
      "></div>
    </div>

    <div id="review-progress" style="display: none; padding: 16px 24px; border-top: 1px solid #e5e7eb;">
      <div style="background: #f0f0f0; border-radius: 4px; height: 8px; overflow: hidden; margin-bottom: 12px;">
        <div id="review-progress-bar" style="background: #3b82f6; height: 100%; width: 0%; transition: width 0.3s;"></div>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <div id="review-spinner" style="
          width: 18px;
          height: 18px;
          border: 2px solid #e5e7eb;
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        "></div>
        <p id="review-status" style="margin: 0; color: #666; font-size: 14px;"></p>
      </div>
    </div>

    <div id="review-buttons" style="padding: 16px 24px; border-top: 1px solid #e5e7eb; display: flex; gap: 12px; justify-content: flex-end;">
      <button id="review-cancel" style="
        padding: 10px 20px;
        background: #f3f4f6;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">${chrome.i18n.getMessage('button_cancel')}</button>
      <button id="review-import" style="
        padding: 10px 20px;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">${importButtonText}</button>
    </div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  // Set the playlist name input value programmatically to avoid HTML escaping issues with special characters
  const playlistNameInput = document.getElementById('playlist-name-input');
  if (playlistNameInput) {
    // Use first podcast title, add localized "& More" suffix if episodes from multiple podcasts
    const andMoreSuffix = chrome.i18n.getMessage('suffix_andMore') || '& More';
    const defaultPlaylistName = podcasts.length === 1
      ? firstPodcast.title
      : `${firstPodcast.title} ${andMoreSuffix}`;
    playlistNameInput.value = defaultPlaylistName;
  }

  renderReviewEpisodeList();

  document.getElementById('review-close').addEventListener('click', () => modal.remove());

  let importCancelled = false;
  const cancelBtn = document.getElementById('review-cancel');

  cancelBtn.addEventListener('click', async () => {
    if (importCancelled) {
      modal.remove();
      return;
    }

    const importBtn = document.getElementById('review-import');
    if (importBtn && importBtn.disabled) {
      importCancelled = true;
      cancelBtn.disabled = true;
      cancelBtn.textContent = chrome.i18n.getMessage('status_cancellingImport') || 'Cancelling...';

      try {
        await chrome.runtime.sendMessage({ action: 'CANCEL_PODCAST_IMPORT' });
      } catch (e) {
      }

      await chrome.storage.local.remove(['podcastImportResult', 'podcastImportTimestamp', 'podcastImportProgress']);

      setTimeout(() => {
        modal.remove();
      }, 500);
    } else {
      modal.remove();
    }
  });

  document.getElementById('review-import').addEventListener('click', async () => {
    // Fallback to first podcast title (with localized "& More" suffix if multiple podcasts)
    const andMoreFallback = chrome.i18n.getMessage('suffix_andMore') || '& More';
    const fallbackName = podcasts.length === 1 ? firstPodcast.title : `${firstPodcast.title} ${andMoreFallback}`;
    const playlistName = document.getElementById('playlist-name-input').value.trim() || fallbackName;
    const coverImageUrl = firstPodcast.thumbnail || null;

    const progressDiv = document.getElementById('review-progress');
    const progressBar = document.getElementById('review-progress-bar');
    const statusText = document.getElementById('review-status');
    const buttonsDiv = document.getElementById('review-buttons');
    const importBtn = document.getElementById('review-import');

    progressDiv.style.display = 'block';
    importBtn.disabled = true;
    importBtn.textContent = chrome.i18n.getMessage('button_importing') || 'Importing...';
    cancelBtn.textContent = chrome.i18n.getMessage('button_cancel') || 'Cancel';
    statusText.textContent = chrome.i18n.getMessage('status_startingImport') || 'Starting import...';
    progressBar.style.width = '5%';

    // Verify account match before starting podcast import
    const accountVerification = await verifyAccountBeforeOperation();
    if (!accountVerification.valid) {
      // Account mismatch or session expired - user has been notified
      progressDiv.style.display = 'none';
      importBtn.disabled = false;
      importBtn.textContent = chrome.i18n.getMessage('button_import') || 'Import';
      return;
    }

    try {
      // Check if we're in update mode (adding to existing playlist)
      const isUpdateMode = window.yotoUpdateMode && window.yotoUpdateMode.isUpdateMode;
      const updateCardId = isUpdateMode ? window.yotoUpdateMode.cardId : null;

      const startResponse = await chrome.runtime.sendMessage({
        action: 'IMPORT_PODCAST_EPISODES',
        episodes: podcastEpisodeQueue,
        playlistName: playlistName,
        coverImageUrl: coverImageUrl,
        updateMode: isUpdateMode,
        cardId: updateCardId
      });

      if (startResponse.error) {
        showNotification(startResponse.error, 'error');
        progressDiv.style.display = 'none';
        importBtn.disabled = false;
        importBtn.textContent = chrome.i18n.getMessage('button_import') || 'Import';
        return;
      }

      let importComplete = false;
      const INACTIVITY_TIMEOUT_SECONDS = 300;
      let lastProgressCount = 0;
      let lastProgressTime = Date.now();

      while (!importComplete && !importCancelled) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (importCancelled) {
          return;
        }

        const statusResponse = await chrome.runtime.sendMessage({
          action: 'GET_PODCAST_IMPORT_STATUS'
        });

        if (statusResponse) {
          if (statusResponse.cancelled) {
            return;
          }

          if (statusResponse.progress) {
            const progress = statusResponse.progress;
            if (progress.status === 'in_progress') {
              const percent = progress.total > 0
                ? Math.min(10 + (progress.current / progress.total * 80), 90)
                : 10;
              progressBar.style.width = `${percent}%`;
              statusText.textContent = progress.message || chrome.i18n.getMessage('status_processing');

              const currentCount = progress.current || 0;
              if (currentCount > lastProgressCount) {
                lastProgressCount = currentCount;
                lastProgressTime = Date.now();
              }
            }
          }

          if (statusResponse.success) {
            importComplete = true;
            progressBar.style.width = '100%';
            document.getElementById('review-spinner').style.display = 'none';

            if (statusResponse.partial) {
              const imported = statusResponse.tracksImported || 0;
              const failed = statusResponse.failedCount || 0;
              statusText.innerHTML = `
                <div style="color: #28a745;">
                  ${chrome.i18n.getMessage('status_successfullyImportedEpisodes', [imported])}
                  ${failed > 0 ? `<br><span style="color: #856404; font-size: 13px;">${failed} episode${failed !== 1 ? 's' : ''} could not be imported</span>` : ''}
                </div>
              `;

              importBtn.textContent = chrome.i18n.getMessage('status_completed') || 'Completed!';
              buttonsDiv.innerHTML = `
                <button id="review-done" style="
                  padding: 10px 20px;
                  background: #28a745;
                  color: white;
                  border: none;
                  border-radius: 6px;
                  cursor: pointer;
                  font-size: 14px;
                  font-weight: 500;
                ">${chrome.i18n.getMessage('button_done') || 'Done'}</button>
              `;

              document.getElementById('review-done').addEventListener('click', () => {
                modal.remove();
                if (podcastMixModalRef) {
                  podcastMixModalRef.remove();
                  podcastMixModalRef = null;
                }
                clearEpisodeQueue();
                window.location.reload();
              });
            } else {
              statusText.textContent = chrome.i18n.getMessage('status_successfullyImportedEpisodes', [statusResponse.tracksImported || podcastEpisodeQueue.length]);
              buttonsDiv.style.display = 'none';

              setTimeout(() => {
                modal.remove();
                if (podcastMixModalRef) {
                  podcastMixModalRef.remove();
                  podcastMixModalRef = null;
                }
                clearEpisodeQueue();
                window.location.reload();
              }, 1500);
            }

            return;
          }

          if (statusResponse.error) {
            throw new Error(statusResponse.error);
          }
        }

        const secondsSinceProgress = (Date.now() - lastProgressTime) / 1000;
        if (secondsSinceProgress >= INACTIVITY_TIMEOUT_SECONDS) {
          throw new Error(chrome.i18n.getMessage('error_importTakingTooLong') || 'Import is taking too long');
        }
      }

    } catch (error) {
      showNotification(error.message || chrome.i18n.getMessage('error_importFailed'), 'error');
      progressDiv.style.display = 'none';
      importBtn.disabled = false;
      importBtn.textContent = chrome.i18n.getMessage('button_import') || 'Import';
    }
  });

  function renderReviewEpisodeList() {
    const listContainer = document.getElementById('review-episode-list');
    if (!listContainer) return;

    listContainer.innerHTML = podcastEpisodeQueue.map((item, index) => `
      <div class="review-episode-item" data-index="${index}" draggable="true" style="
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        background: white;
        border-bottom: 1px solid #e5e7eb;
        cursor: grab;
        transition: background 0.15s;
      ">
        <span class="drag-handle" style="color: #9ca3af; cursor: grab;">
          ${getSvgIcon('dragHandle')}
        </span>
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 500; color: #1f2937; font-size: 14px; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${item.title}
          </div>
          <div style="font-size: 12px; color: #6b7280; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${item.podcast.title} • ${formatDuration(item.audio_length_sec)}
          </div>
        </div>
        <button class="remove-episode-btn" data-index="${index}" style="
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px;
          color: #9ca3af;
          transition: color 0.15s;
        " onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#9ca3af'">
          ${getSvgIcon('remove')}
        </button>
      </div>
    `).join('');

    listContainer.querySelectorAll('.remove-episode-btn').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const index = parseInt(this.dataset.index);
        podcastEpisodeQueue.splice(index, 1);

        if (podcastEpisodeQueue.length === 0) {
          modal.remove();
          updateQueueFooter();
          return;
        }

        renderReviewEpisodeList();
      });
    });

    let draggedIndex = null;

    listContainer.querySelectorAll('.review-episode-item').forEach(item => {
      item.addEventListener('dragstart', function(e) {
        draggedIndex = parseInt(this.dataset.index);
        this.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      item.addEventListener('dragend', function() {
        this.classList.remove('dragging');
        listContainer.querySelectorAll('.review-episode-item').forEach(el => {
          el.classList.remove('drag-over');
        });
        draggedIndex = null;
      });

      item.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const targetIndex = parseInt(this.dataset.index);
        if (draggedIndex !== null && targetIndex !== draggedIndex) {
          this.classList.add('drag-over');
        }
      });

      item.addEventListener('dragleave', function() {
        this.classList.remove('drag-over');
      });

      item.addEventListener('drop', function(e) {
        e.preventDefault();
        this.classList.remove('drag-over');
        const targetIndex = parseInt(this.dataset.index);

        if (draggedIndex !== null && targetIndex !== draggedIndex) {
          const [removed] = podcastEpisodeQueue.splice(draggedIndex, 1);
          podcastEpisodeQueue.splice(targetIndex, 0, removed);
          renderReviewEpisodeList();
        }
      });
    });
  }
}

function formatDuration(seconds) {
  if (!seconds) return chrome.i18n.getMessage('label_unknown');
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
  }
  return `${mins}m ${secs}s`;
}

function hasCoverKeywords(fileName) {
  const lowerFileName = fileName.toLowerCase();

  // Exclude back covers
  const backKeywords = [
    'back-sticker', 'back_sticker', 'back-cover', 'back_cover',
    'rückseite', 'rücken', 'hinten',  // German
    'trasera', 'posterior', 'atras',  // Spanish
    'arriere', 'dos', 'verso',        // French
    'retro', 'posteriore', 'dietro',  // Italian
    'zadnja', 'hrbtna'                // Slovenian
  ];

  for (const keyword of backKeywords) {
    if (lowerFileName.includes(keyword)) {
      return false;
    }
  }

  if (lowerFileName.includes('back') && (lowerFileName.includes('sticker') || lowerFileName.includes('card'))) {
    return false;
  }

  const coverKeywords = [
    // English
    'cover', 'front', 'sticker', 'front-sticker', 'front_sticker',
    'image', 'art', 'card', 'artwork',
    // German
    'vorderseite', 'deckblatt', 'titelbild', 'umschlag',
    // Spanish
    'portada', 'caratula', 'frontal', 'frente',
    // French
    'couverture', 'jaquette', 'pochette', 'avant', 'recto',
    // Italian
    'copertina', 'fronte', 'anteriore',
    // Slovenian
    'naslovnica', 'platnica', 'sprednja'
  ];

  for (const keyword of coverKeywords) {
    if (lowerFileName.includes(keyword)) {
      return true;
    }
  }

  // Standard album art filenames used by media players and operating systems
  const standardCoverFilenames = [
    'folder.jpg', 'folder.png', 'folder.jpeg',
    'albumart.jpg', 'albumart.png', 'albumart.jpeg',
    'albumartsmall.jpg', 'albumartsmall.png',
    'albumartlarge.jpg', 'albumartlarge.png',
    'thumb.jpg', 'thumb.png', 'thumbnail.jpg', 'thumbnail.png'
  ];

  return standardCoverFilenames.includes(lowerFileName);
}

function findCoverImage(imageFiles, minSize = 50 * 1024) {
  if (!imageFiles || imageFiles.length === 0) return null;

  const potentialCovers = imageFiles.map(f => {
    const fileName = f.name.split('/').pop();
    const fileSize = f.fileSize || f.size || 0;
    const hasKeyword = hasCoverKeywords(fileName);

    return {
      file: f,
      size: fileSize,
      hasKeyword: hasKeyword,
      score: (hasKeyword ? 1000000 : 0) + fileSize
    };
  }).filter(c => c.size > minSize);

  if (potentialCovers.length === 0) return null;

  potentialCovers.sort((a, b) => b.score - a.score);
  return potentialCovers[0].file;
}

function findCoverImageWithPriority(allImages, minSize = 50 * 1024) {
  if (!allImages || allImages.length === 0) return null;

  const rootImages = [];
  const subfolderImages = [];

  allImages.forEach(f => {
    const path = f.webkitRelativePath || f.name;
    const pathParts = path.split('/');

    if (pathParts.length === 2) {
      rootImages.push(f);
    } else {
      subfolderImages.push(f);
    }
  });

  const rootCover = findCoverImage(rootImages, minSize);
  if (rootCover) return rootCover;

  // Preferred folder names in multiple languages
  const preferredFolders = [
    // English
    '/cover/', '/image/', '/images/', '/icon/', '/icons/', '/art/', '/artwork/', '/sticker/',
    // German
    '/bilder/', '/bild/', '/grafik/', '/grafiken/', '/symbole/', '/symbol/', '/umschlag/',
    // Spanish
    '/imagenes/', '/imagen/', '/portada/', '/portadas/', '/iconos/', '/icono/', '/arte/',
    // French
    '/images/', '/image/', '/couverture/', '/icones/', '/icone/', '/pochette/',
    // Italian
    '/immagini/', '/immagine/', '/copertina/', '/copertine/', '/icone/', '/icona/', '/arte/',
    // Slovenian
    '/slike/', '/slika/', '/ikone/', '/ikona/', '/naslovnica/'
  ];
  const preferredImages = subfolderImages.filter(f => {
    const path = (f.webkitRelativePath || f.name).toLowerCase();
    return preferredFolders.some(folder => path.includes(folder));
  });

  const preferredCover = findCoverImage(preferredImages, minSize);
  if (preferredCover) return preferredCover;

  return findCoverImage(subfolderImages, minSize);
}

function separateImagesIntelligently(imageFiles) {
  const trackIcons = [];
  const ICON_MAX_SIZE = 50 * 1024;
  const numericImages = [];
  const nonNumericImages = [];

  imageFiles.forEach(f => {
    const fileName = f.name.split('/').pop();
    const fileSize = f.fileSize || f.size || 0;

    let numberMatch = fileName.match(/(\d+)\.(png|jpg|jpeg|gif|webp|bmp)$/i);
    if (!numberMatch) {
      numberMatch = fileName.match(/^(\d+)[\s\-_.]/i);
    }
    if (!numberMatch) {
      numberMatch = fileName.match(/[\s\-_](\d+)[\s\-_.].*\.(png|jpg|jpeg|gif|webp|bmp)$/i);
    }

    const isCoverName = hasCoverKeywords(fileName);

    if (isCoverName && fileSize > ICON_MAX_SIZE) {
      nonNumericImages.push(f);
    } else if (numberMatch && fileSize <= ICON_MAX_SIZE) {
      f.extractedNumber = parseInt(numberMatch[1]);
      numericImages.push(f);
    } else if (fileSize > ICON_MAX_SIZE) {
      nonNumericImages.push(f);
    } else if (numberMatch) {
      f.extractedNumber = parseInt(numberMatch[1]);
      numericImages.push(f);
    } else {
      nonNumericImages.push(f);
    }
  });

  numericImages.sort((a, b) => (a.extractedNumber || 0) - (b.extractedNumber || 0));

  const validIcons = numericImages.filter(f => {
    const fileSize = f.fileSize || f.size || 0;
    return fileSize <= ICON_MAX_SIZE;
  });

  if (validIcons.length > 0) {
    trackIcons.push(...validIcons);
  }

  // Use priority-based cover detection: root first, then preferred folders, then all folders
  const coverImage = findCoverImageWithPriority(nonNumericImages, ICON_MAX_SIZE);

  if (coverImage) {
    const coverIndex = trackIcons.findIndex(f => f.name === coverImage.name);
    if (coverIndex !== -1) {
      trackIcons.splice(coverIndex, 1);
    }
  }

  return { trackIcons, coverImage };
}

async function processFolderFiles(files) {
  let folderName = chrome.i18n.getMessage('label_importedPlaylist');
  if (files[0] && files[0].webkitRelativePath) {
    const pathParts = files[0].webkitRelativePath.split('/');
    if (pathParts.length > 0) {
      folderName = pathParts[0];
    }
  }

  const audioExtensions = ['m4a', 'mp3', 'mp4', 'm4b', 'wav', 'ogg', 'aac', 'flac'];
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];

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
    f.fileSize = f.size;

    if (audioExtensions.includes(ext)) {
      allAudioFiles.push(f);
    } else if (imageExtensions.includes(ext)) {
      allImageFiles.push(f);
    }
  });

  if (allAudioFiles.length > 0) {
    const topLevelDirs = new Map();

    allAudioFiles.forEach(f => {
      const pathParts = f.webkitRelativePath.split('/');
      if (pathParts.length >= 3) {
        const subfolderName = pathParts[1];
        if (!topLevelDirs.has(subfolderName)) {
          topLevelDirs.set(subfolderName, 0);
        }
        topLevelDirs.set(subfolderName, topLevelDirs.get(subfolderName) + 1);
      }
    });

    if (topLevelDirs.size > 1) {
      const playlistCount = topLevelDirs.size;

      showNotification(
        chrome.i18n.getMessage('notification_multiplePlaylistsDetected', [playlistCount.toString()]),
        'info'
      );

      showBulkImportOptionsModal(files, null);
      return;
    }
  }
  
  let audioFiles = [];

  const audioFolderFiles = allAudioFiles.filter(f =>
    f.webkitRelativePath.toLowerCase().includes('/audio')
  );

  if (audioFolderFiles.length > 0) {
    audioFiles = audioFolderFiles;
  }
  else if (allAudioFiles.length > 0) {
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
  
  // Use ALL image files - the priority-based detection will handle finding the best cover
  // This works with any folder structure and any language (bilder, imágenes, etc.)
  const imageFiles = allImageFiles;
  
  audioFiles.sort((a, b) => {
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
  
  // Intelligently separate track icons from cover images using the shared function
  const { trackIcons, coverImage } = separateImagesIntelligently(imageFiles);
  
  if (audioFiles.length === 0) {
    showNotification(chrome.i18n.getMessage('notification_noAudioFiles'), 'error');
    return;
  }
  
  // Files processed successfully
  showNotification(chrome.i18n.getMessage("notification_folderProcessed", [audioFiles.length, trackIcons.length, coverImage ? ', 1 cover' : '']), 'success');
  
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
      document.getElementById('redirect-now').addEventListener('click', () => {
        redirectModal.remove();
        showBulkImportOptionsModal();
      });
      
      document.getElementById('redirect-cancel').addEventListener('click', () => {
        redirectModal.remove();
      });
      
      return; // Exit early, don't process as single playlist
    }
    
    // First, analyze ZIP structure WITHOUT extracting files to detect multiple playlists quickly
    const audioFilePaths = [];
    const validEntries = Object.entries(contents.files).filter(([path, zipEntry]) => {
      if (zipEntry.dir) return false;

      // Skip Mac metadata files
      if (path.includes('__MACOSX/') || path.includes('._')) {
        return false;
      }

      const fileName = path.split('/').pop();
      const ext = fileName.split('.').pop().toLowerCase();

      // Track audio file paths for structure analysis
      if (audioExtensions.includes(ext)) {
        audioFilePaths.push(path);
      }

      // Skip non-media files (.txt, .DS_Store, etc.)
      if (!audioExtensions.includes(ext) && !imageExtensions.includes(ext)) {
        return false;
      }

      return true;
    });

    // Analyze structure BEFORE extracting any files
    if (audioFilePaths.length > 0) {
      const folderStructure = new Map();
      let hasRootFiles = false;

      audioFilePaths.forEach(path => {
        const pathParts = path.split('/');

        if (pathParts.length === 1 && pathParts[0]) {
          hasRootFiles = true;
          if (!folderStructure.has('__root__')) {
            folderStructure.set('__root__', 0);
          }
          folderStructure.set('__root__', folderStructure.get('__root__') + 1);
        } else if (pathParts.length === 2) {
          hasRootFiles = true;
          if (!folderStructure.has('__root__')) {
            folderStructure.set('__root__', 0);
          }
          folderStructure.set('__root__', folderStructure.get('__root__') + 1);
        } else if (pathParts.length >= 3) {
          const playlistFolder = pathParts[1];
          if (!folderStructure.has(playlistFolder)) {
            folderStructure.set(playlistFolder, 0);
          }
          folderStructure.set(playlistFolder, folderStructure.get(playlistFolder) + 1);
        }
      });

      const foldersWithAudio = Array.from(folderStructure.keys()).filter(key => key !== '__root__');

      let shouldUseBulkImport = false;
      let playlistCount = 0;

      if (foldersWithAudio.length >= 2) {
        shouldUseBulkImport = true;
        playlistCount = foldersWithAudio.length;
      } else if (hasRootFiles && foldersWithAudio.length > 0) {
        shouldUseBulkImport = true;
        playlistCount = foldersWithAudio.length + 1;
      }

      if (shouldUseBulkImport) {
        // Exit early - show bulk import modal without extracting files
        const existingModal = document.querySelector('#yoto-import-modal');
        if (existingModal) existingModal.remove();

        showNotification(
          chrome.i18n.getMessage('notification_multiplePlaylistsDetected', [playlistCount.toString()]),
          'info'
        );

        showBulkImportOptionsModal(null, file);
        return;
      }
    }

    // Only extract files if it's a single playlist
    const allAudioFiles = [];
    const allImageFiles = [];

    // Process files in parallel batches
    const FILE_BATCH_SIZE = 8; // Increased from 5 to 8 for faster file extraction
    for (let batchStart = 0; batchStart < validEntries.length; batchStart += FILE_BATCH_SIZE) {
      const batch = validEntries.slice(batchStart, Math.min(batchStart + FILE_BATCH_SIZE, validEntries.length));

      const batchPromises = batch.map(async ([path, zipEntry]) => {
        const fileName = path.split('/').pop();
        const ext = fileName.split('.').pop().toLowerCase();

        try {
          const blob = await zipEntry.async('blob');
          const fileSize = blob.size;

          if (audioExtensions.includes(ext)) {
            const file = new File([blob], fileName, { type: `audio/${ext}` });
            file.fileSize = fileSize;
            file.zipPath = path; // Store ZIP path since webkitRelativePath is read-only
            file.webkitRelativePath = path;
            return { type: 'audio', file, path };
          } else if (imageExtensions.includes(ext)) {
            const file = new File([blob], fileName, { type: `image/${ext}` });
            file.fileSize = fileSize;
            file.zipPath = path; // Store ZIP path since webkitRelativePath is read-only
            file.webkitRelativePath = path;
            return { type: 'image', file, path };
          }
        } catch (err) {
          console.error(`Error processing ${path}:`, err);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(result => {
        if (result) {
          if (result.type === 'audio') {
            allAudioFiles.push(result.file);
          } else if (result.type === 'image') {
            allImageFiles.push(result.file);
          }
        }
      });
    }

    // At this point, we know it's a single playlist, so proceed with normal import
    let audioFiles = [];

    const audioFolderFiles = allAudioFiles.filter(f => {
      const path = f.zipPath || f.webkitRelativePath || '';
      return path.toLowerCase().includes('/audio');
    });

    if (audioFolderFiles.length > 0) {
      audioFiles = audioFolderFiles;
    }
    else if (allAudioFiles.length > 0) {
      const audioDirs = {};
      allAudioFiles.forEach(f => {
        const path = f.zipPath || f.webkitRelativePath || '';
        const dir = path.substring(0, path.lastIndexOf('/'));
        audioDirs[dir] = (audioDirs[dir] || 0) + 1;
      });

      // Use files from the directory with most audio files
      const mainAudioDir = Object.keys(audioDirs).reduce((a, b) =>
        audioDirs[a] > audioDirs[b] ? a : b, ''
      );

      audioFiles = allAudioFiles.filter(f => {
        const path = f.zipPath || f.webkitRelativePath || '';
        return path.startsWith(mainAudioDir);
      });
    }
    
    // Use ALL image files - the priority-based detection will handle finding the best cover
    // This works with any folder structure and any language (bilder, imágenes, etc.)
    const imageFiles = allImageFiles;

    audioFiles.sort((a, b) => {
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
    
    const { trackIcons, coverImage } = separateImagesIntelligently(imageFiles);
    
    if (audioFiles.length === 0) {
      showNotification(chrome.i18n.getMessage('notification_noAudioFilesZip'), 'error');
      return;
    }
    
    // Files processed successfully
    showNotification(chrome.i18n.getMessage("notification_zipProcessed", [audioFiles.length, trackIcons.length, coverImage ? ', 1 cover' : '']), 'success');

    showImportModal(audioFiles, trackIcons, coverImage, folderName, 'zip');
    
  } catch (error) {
    showNotification(chrome.i18n.getMessage('notification_failedToProcessZip', [error.message]), 'error');
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

function selectBulkZipFile(importMode = 'separate') {
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
      await processBulkZipFile(files[0], importMode);
    } else if (files.length > 0) {
      showNotification(chrome.i18n.getMessage('notification_invalidZip'), 'error');
    }
  });

  fileInput.click();
}

function selectBulkFolder(importMode = 'separate') {
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
      showNotification(chrome.i18n.getMessage('status_processingBulkFolder'), 'info');
      await processBulkFolderFiles(files, importMode);
    }
  });

  folderInput.click();
}

async function processBulkZipFile(file, importMode = 'separate') {
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
    
    statusElement.textContent = chrome.i18n.getMessage('status_loadingZip');
    detailsElement.textContent = `File: ${file.name}`;
    
    const zip = new JSZip();
    const contents = await zip.loadAsync(file, {
      async: true
    });
    
    statusElement.textContent = chrome.i18n.getMessage('status_analyzingFolder');
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
          if (singleRootFolder && pathParts.length === 2) {
            // This is a file directly in the single root folder (e.g., "root/cover.jpg")
            const fileName = pathParts[1];
            const ext = fileName.split('.').pop().toLowerCase();
            const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];

            // If it's an image file at root level, add to rootFiles for cover detection
            if (imageExtensions.includes(ext)) {
              rootFiles.push({ path, zipEntry });
              processedPaths.add(path);
              continue;
            }
          }

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
    

    if (nestedZips.length > 0) {
      statusElement.textContent = chrome.i18n.getMessage('status_extractingPlaylists');
      detailsElement.textContent = `Found ${nestedZips.length} playlist${nestedZips.length > 1 ? 's' : ''}`;
    }

    const failedZips = [];

    // Process nested ZIPs in parallel batches
    const ZIP_BATCH_SIZE = 5; // Increased from 3 to 5 for faster parallel processing
    for (let batchStart = 0; batchStart < nestedZips.length; batchStart += ZIP_BATCH_SIZE) {
      const batch = nestedZips.slice(batchStart, Math.min(batchStart + ZIP_BATCH_SIZE, nestedZips.length));

      if (statusElement) {
        const currentBatch = Math.floor(batchStart / ZIP_BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(nestedZips.length / ZIP_BATCH_SIZE);
        statusElement.textContent = `Extracting playlists (batch ${currentBatch}/${totalBatches})`;
        detailsElement.textContent = `Processing ${batch.length} ZIP${batch.length > 1 ? 's' : ''} in parallel`;
      }

      const batchPromises = batch.map(async ({ path, zipEntry }) => {
        try {
          const nestedZipBlob = await zipEntry.async('blob');

          const nestedZip = new JSZip();
          const nestedContents = await nestedZip.loadAsync(nestedZipBlob);

          const nestedFileCount = Object.keys(nestedContents.files).length;

          const playlistName = path.replace(/\.zip$/i, '').split('/').pop();

          const playlist = await extractPlaylistFromZip(nestedContents, playlistName);

          if (playlist && playlist.audioFiles.length > 0) {
            return playlist;
          } else {
            // Log detailed info about what was in the ZIP to help diagnose issues
            const fileList = Object.keys(nestedContents.files).filter(f => !nestedContents.files[f].dir);
            failedZips.push({ name: playlistName, reason: 'No audio files found' });
            return null;
          }
        } catch (error) {
          const playlistName = path.replace(/\.zip$/i, '').split('/').pop();
          failedZips.push({ name: playlistName, reason: error.message || 'Failed to extract' });
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(playlist => {
        if (playlist) playlists.push(playlist);
      });
    }
    
    if (failedZips.length > 0) {
      const failedNames = failedZips.map(f => `${f.name} (${f.reason})`).join(', ');
      
      if (nestedZips.length > 0 && failedZips.length === nestedZips.length) {
        showNotification(`${chrome.i18n.getMessage("notification_failedToProcessZip", [failedNames])}`, 'error');
        
        loadingModal.remove();
        return;
      } else if (failedZips.length > 0) {
        showNotification(`${chrome.i18n.getMessage("notification_errorProcessingBulkZip", [failedZips.length, failedNames])}`, 'warning');
      }
    }
    
    if (folders.size > 0 && statusElement) {
      statusElement.textContent = chrome.i18n.getMessage('status_processingFolders');
      detailsElement.textContent = `Found ${folders.size} folder${folders.size > 1 ? 's' : ''}`;
    }

    // Process folders in parallel batches
    const FOLDER_BATCH_SIZE = 5; // Increased from 3 to 5 for faster parallel processing
    const folderEntries = Array.from(folders.entries());
    for (let batchStart = 0; batchStart < folderEntries.length; batchStart += FOLDER_BATCH_SIZE) {
      const batch = folderEntries.slice(batchStart, Math.min(batchStart + FOLDER_BATCH_SIZE, folderEntries.length));

      if (statusElement) {
        const currentBatch = Math.floor(batchStart / FOLDER_BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(folderEntries.length / FOLDER_BATCH_SIZE);
        statusElement.textContent = `Processing folders (batch ${currentBatch}/${totalBatches})`;
        detailsElement.textContent = `Processing ${batch.length} folder${batch.length > 1 ? 's' : ''} in parallel`;
      }

      const batchPromises = batch.map(async ([folderName, files]) => {
        const playlist = await extractPlaylistFromFiles(files, folderName, contents);
        return playlist && playlist.audioFiles.length > 0 ? playlist : null;
      });

      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(playlist => {
        if (playlist) playlists.push(playlist);
      });
    }
    
    // For bulk import, only create a single playlist if:
    if (playlists.length === 0 && nestedZips.length === 0 && folders.size === 0 && rootFiles.length > 0) {
      
      const playlist = await extractPlaylistFromFiles(rootFiles, file.name.replace(/\.zip$/i, ''), contents);
      if (playlist && playlist.audioFiles.length > 0) {
        showNotification(chrome.i18n.getMessage('notification_rootLevelAudioFiles'), 'warning');
        playlists.push(playlist);
      }
    }
    
    loadingModal.remove();

    if (playlists.length === 0) {
      if (nestedZips.length > 0) {
        showNotification(chrome.i18n.getMessage('notification_noValidPlaylistsZip'), 'error');
      } else if (folders.size > 0) {
        showNotification(chrome.i18n.getMessage('notification_noAudioFilesInAudioFolder'), 'error');
      } else {
        showNotification(chrome.i18n.getMessage('notification_noValidPlaylists'), 'error');
      }
      return;
    }

    if (importMode === 'merged' && playlists.length > 0) {
      let rootCoverImage = null;
      const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
      const allImageFiles = [];

      for (const [path, zipEntry] of Object.entries(contents.files)) {
        if (zipEntry.dir || path.includes('__MACOSX/') || path.includes('._') || path.includes('.DS_Store')) {
          continue;
        }

        const fileName = path.split('/').pop();
        const ext = fileName.split('.').pop().toLowerCase();

        if (imageExtensions.includes(ext)) {
          try {
            const blob = await zipEntry.async('blob');
            const file = new File([blob], fileName, { type: `image/${ext}` });
            file.fileSize = blob.size;
            file.webkitRelativePath = path;
            allImageFiles.push(file);
          } catch (err) {
          }
        }
      }

      if (allImageFiles.length > 0) {
        rootCoverImage = findCoverImageWithPriority(allImageFiles);
      }

      const mergedPlaylist = await mergePlaylists(playlists, file.name.replace(/\.zip$/i, ''), rootCoverImage);
      if (mergedPlaylist) {
        showNotification(chrome.i18n.getMessage('notification_mergedToSinglePlaylist'), 'success');
        showBulkImportModal([mergedPlaylist], importMode);
      } else {
        showNotification(chrome.i18n.getMessage('notification_failedToMergePlaylists'), 'error');
      }
    } else {
      const sourceType = nestedZips.length > 0 ? 'ZIP file' : 'folder';
      const sourcePlural = playlists.length > 1 ? 's' : '';
      showNotification(`${chrome.i18n.getMessage("notification_extractedPlaylists", [playlists.length, sourceType])}`, 'success');
      showBulkImportModal(playlists, importMode);
    }
    
  } catch (error) {
    if (loadingModal && loadingModal.parentNode) {
      loadingModal.remove();
    }
    showNotification(chrome.i18n.getMessage('notification_errorProcessingBulkZip', [error.message]), 'error');
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

async function processBulkFolderFiles(files, importMode = 'separate') {
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
    
    // Process folders in parallel batches
    const FOLDER_BATCH_SIZE = 5; // Increased from 3 to 5 for faster parallel processing
    const folderEntries = Array.from(folderMap.entries());

    for (let batchStart = 0; batchStart < folderEntries.length; batchStart += FOLDER_BATCH_SIZE) {
      const batch = folderEntries.slice(batchStart, Math.min(batchStart + FOLDER_BATCH_SIZE, folderEntries.length));

      const batchPromises = batch.map(async ([folderName, folderFiles]) => {
        const playlist = await extractPlaylistFromFolderFiles(folderFiles, folderName);
        return playlist && playlist.audioFiles.length > 0 ? playlist : null;
      });

      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(playlist => {
        if (playlist) playlists.push(playlist);
      });
    }
    
    if (playlists.length === 0) {
      showNotification(chrome.i18n.getMessage('notification_noValidPlaylistsFolder'), 'error');
      return;
    }

    if (importMode === 'merged' && playlists.length > 0) {
      const rootFolderName = files[0]?.webkitRelativePath?.split('/')[0] || 'Merged Playlist';

      let rootCoverImage = null;
      const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
      const allImageFiles = [];

      for (const file of files) {
        if (file.webkitRelativePath) {
          const fileName = file.name;
          const ext = fileName.split('.').pop().toLowerCase();

          if (imageExtensions.includes(ext)) {
            const imageFile = file;
            imageFile.fileSize = file.size;
            allImageFiles.push(imageFile);
          }
        }
      }

      if (allImageFiles.length > 0) {
        rootCoverImage = findCoverImageWithPriority(allImageFiles);
      }

      const mergedPlaylist = await mergePlaylists(playlists, rootFolderName, rootCoverImage);
      if (mergedPlaylist) {
        showNotification(chrome.i18n.getMessage('notification_mergedFoldersToPlaylist'), 'success');
        showBulkImportModal([mergedPlaylist], importMode);
      } else {
        showNotification(chrome.i18n.getMessage('notification_failedToMergePlaylists'), 'error');
      }
    } else {
      showNotification(`${chrome.i18n.getMessage("notification_foundPlaylists", [playlists.length])}`, 'success');
      showBulkImportModal(playlists, importMode);
    }
    
  } catch (error) {
    showNotification(chrome.i18n.getMessage('notification_errorProcessingBulkFolder', [error.message]), 'error');
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

async function mergePlaylists(playlists, mergedName, rootCoverImage = null) {
  try {
    const mergedPlaylist = {
      name: mergedName,
      audioFiles: [],
      trackIcons: [],
      coverImage: rootCoverImage
    };

    let currentTrackIndex = 0;
    const playlistCovers = [];

    for (const playlist of playlists) {
      if (playlist.audioFiles && playlist.audioFiles.length > 0) {
        playlist.audioFiles.forEach((file, fileIndex) => {
          mergedPlaylist.audioFiles.push(file);

          if (playlist.trackIcons && playlist.trackIcons[fileIndex]) {
            const icon = playlist.trackIcons[fileIndex];
            icon.extractedNumber = currentTrackIndex + 1;
            mergedPlaylist.trackIcons[currentTrackIndex] = icon;
          }

          currentTrackIndex++;
        });
      }

      if (playlist.coverImage) {
        playlistCovers.push(playlist.coverImage);
      }
    }

    if (!mergedPlaylist.coverImage && playlistCovers.length > 0) {
      mergedPlaylist.coverImage = findCoverImage(playlistCovers);
    }

    return mergedPlaylist;
  } catch (error) {
    return null;
  }
}

async function extractPlaylistFromZip(zipContents, playlistName) {
  
  const audioExtensions = ['m4a', 'mp3', 'mp4', 'm4b', 'wav', 'ogg', 'aac', 'flac'];
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
  
  const allAudioFiles = [];
  const allImageFiles = [];
  let skippedFiles = 0;
  let totalFiles = 0;
  
  // Extract all files in parallel batches
  const entries = Object.entries(zipContents.files).filter(([path, zipEntry]) => {
    if (zipEntry.dir) return false;
    totalFiles++;

    // Skip Mac metadata files
    if (path.includes('__MACOSX/') || path.includes('._') || path.includes('.DS_Store')) {
      skippedFiles++;
      return false;
    }

    const fileName = path.split('/').pop();
    const ext = fileName.split('.').pop().toLowerCase();

    // Skip non-media files
    if (!audioExtensions.includes(ext) && !imageExtensions.includes(ext)) {
      skippedFiles++;
      return false;
    }

    return true;
  });

  // Process files in parallel batches
  const FILE_BATCH_SIZE = 8; // Increased from 5 to 8 for faster file extraction
  for (let batchStart = 0; batchStart < entries.length; batchStart += FILE_BATCH_SIZE) {
    const batch = entries.slice(batchStart, Math.min(batchStart + FILE_BATCH_SIZE, entries.length));

    const batchPromises = batch.map(async ([path, zipEntry]) => {
      const fileName = path.split('/').pop();
      const ext = fileName.split('.').pop().toLowerCase();

      try {
        const blob = await zipEntry.async('blob');

        if (audioExtensions.includes(ext)) {
          const file = new File([blob], fileName, { type: `audio/${ext}` });
          file.webkitRelativePath = path;
          file.fileSize = blob.size;
          file.size = blob.size; // Ensure both size properties are set
          return { type: 'audio', file };
        } else if (imageExtensions.includes(ext)) {
          const file = new File([blob], fileName, { type: `image/${ext}` });
          file.webkitRelativePath = path;
          file.fileSize = blob.size;
          file.size = blob.size; // Ensure both size properties are set
          return { type: 'image', file };
        }
      } catch (err) {
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach(result => {
      if (result) {
        if (result.type === 'audio') {
          allAudioFiles.push(result.file);
        } else if (result.type === 'image') {
          allImageFiles.push(result.file);
        }
      }
    });
  }
  
  // Smart audio folder detection (same as processZipFile)
  let audioFiles = [];
  
  const audioFolderFiles = allAudioFiles.filter(f => 
    f.webkitRelativePath.toLowerCase().includes('/audio')
  );
  
  if (audioFolderFiles.length > 0) {
    audioFiles = audioFolderFiles;
  } 
  else if (allAudioFiles.length > 0) {
    audioFiles = allAudioFiles;
  }
  
  // Use ALL image files - the priority-based detection will handle finding the best cover
  // This works with any folder structure and any language (bilder, imágenes, etc.)
  const imageFiles = allImageFiles;

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

async function extractPlaylistFromFiles(files, playlistName, zipContents) {
  const audioExtensions = ['m4a', 'mp3', 'mp4', 'm4b', 'wav', 'ogg', 'aac', 'flac'];
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
  
  const audioFiles = [];
  const imageFiles = [];

  // Process files in parallel batches
  const FILE_BATCH_SIZE = 8; // Increased from 5 to 8 for faster file extraction
  for (let batchStart = 0; batchStart < files.length; batchStart += FILE_BATCH_SIZE) {
    const batch = files.slice(batchStart, Math.min(batchStart + FILE_BATCH_SIZE, files.length));

    const batchPromises = batch.map(async ({ path, zipEntry }) => {
      const fileName = path.split('/').pop();
      const ext = fileName.split('.').pop().toLowerCase();

      if (audioExtensions.includes(ext)) {
        const blob = await zipEntry.async('blob');
        const file = new File([blob], fileName, { type: `audio/${ext}` });
        file.webkitRelativePath = path;
        file.fileSize = blob.size;
        return { type: 'audio', file };
      } else if (imageExtensions.includes(ext)) {
        const blob = await zipEntry.async('blob');
        const file = new File([blob], fileName, { type: `image/${ext}` });
        file.webkitRelativePath = path;
        file.fileSize = blob.size;
        return { type: 'image', file };
      }
      return null;
    });

    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach(result => {
      if (result) {
        if (result.type === 'audio') {
          audioFiles.push(result.file);
        } else if (result.type === 'image') {
          imageFiles.push(result.file);
        }
      }
    });
  }
  
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

// Progressive Export Handlers
function handleProgressiveExportStarted(request) {
  window.currentExportManifestId = request.manifestId;
  window.totalPlaylists = request.totalPlaylists;
  window.completedPlaylists = 0;
  window.failedPlaylistTitles = [];
  window.progressiveExportStartTime = Date.now(); // Track when export started

  // Clear the timeout since progressive export has started
  if (window.exportProgressTimeout) {
    clearTimeout(window.exportProgressTimeout);
    window.exportProgressTimeout = null;
  }

  // Add the blue export status indicator
  addExportStatusIndicator();

  // Only try to update the modal if it actually exists
  const modal = document.getElementById('yoto-bulk-export-modal');
  if (modal) {
    // Show the export progress container and update buttons
    const exportProgressContainer = document.getElementById('export-progress');
    if (exportProgressContainer) {
      exportProgressContainer.style.display = 'block';
    } else {
    }
  } else {
  }

  // Disable start button, enable cancel button
  const startBtn = document.getElementById('start-export');
  const cancelBtn = document.getElementById('cancel-export');
  if (startBtn) startBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = false;

  const status = document.getElementById('export-status');
  const progressBar = document.getElementById('export-progress-bar');

  if (status) {
    status.textContent = `Starting export of ${request.totalPlaylists} playlists...`;
    status.style.color = '#3b82f6';
  }

  if (progressBar) {
    progressBar.style.width = '0%';
  }
}

function handlePlaylistExportStarted(request) {
  const status = document.getElementById('export-status');
  const progressBar = document.getElementById('export-progress-bar');
  const progressText = document.getElementById('export-progress-text');

  if (status) {
    // Add a pulsing animation to show activity
    status.innerHTML = `
      <span style="display: inline-flex; align-items: center;">
        <span style="
          display: inline-block;
          width: 8px;
          height: 8px;
          background: #3b82f6;
          border-radius: 50%;
          margin-right: 8px;
          animation: pulse 1.5s infinite;
        "></span>
        Downloading files for playlist ${request.playlistIndex} of ${request.totalPlaylists}: ${request.playlistTitle}
      </span>
    `;
    status.style.color = '#3b82f6';

    // Add pulse animation if not already present
    if (!document.getElementById('pulse-animation-style')) {
      const style = document.createElement('style');
      style.id = 'pulse-animation-style';
      style.textContent = `
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.4; }
          100% { opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
  }

  // Show progress of playlists being processed
  if (progressText) {
    progressText.textContent = `Processing ${request.playlistIndex} of ${request.totalPlaylists} playlists`;
  }

  if (progressBar) {
    // Show progress based on what's starting (but keep previous completions in mind)
    const completedSoFar = window.completedPlaylists || 0;
    const totalPlaylists = window.totalPlaylists || request.totalPlaylists || 1;
    const percentage = (completedSoFar / totalPlaylists) * 100;
    progressBar.style.width = `${percentage}%`;
    // Force update with important flag
    progressBar.style.cssText = `
      height: 100%;
      background-color: #3b82f6;
      width: ${percentage}% !important;
      transition: width 0.3s ease;
    `;
  } else {
  }
}

function handlePlaylistExportCompleted(request) {
  window.completedPlaylists = (window.completedPlaylists || 0) + 1;

  const status = document.getElementById('export-status');
  const progressBar = document.getElementById('export-progress-bar');

  // Use window.totalPlaylists which was set at start, fallback to request if needed
  const totalPlaylists = window.totalPlaylists || request.totalPlaylists || 1;

  if (status) {
    status.textContent = `Completed: ${request.playlistTitle} (${window.completedPlaylists}/${totalPlaylists})`;
    status.style.color = '#10b981';
  }

  // Update progress bar to show completed percentage
  if (progressBar) {
    const percentage = (window.completedPlaylists / totalPlaylists) * 100;
    progressBar.style.width = `${percentage}%`;
    // Force update with important flag
    progressBar.style.cssText = `
      height: 100%;
      background-color: #3b82f6;
      width: ${percentage}% !important;
      transition: width 0.3s ease;
    `;
  } else {
  }

  // Update the blue export status indicator as well
  updateExportStatusIndicator();

  // Show quick success notification for each playlist
  showNotification(`Downloaded: ${request.playlistTitle}`, 'success');
}

function handlePlaylistExportFailed(request) {
  window.failedPlaylistTitles = window.failedPlaylistTitles || [];
  window.failedPlaylistTitles.push(request.playlistTitle);

  const status = document.getElementById('export-status');

  if (status) {
    status.textContent = `Failed to export: ${request.playlistTitle}`;
    status.style.color = '#ef4444';
  }

  // Show error notification
  showNotification(`Failed to export: ${request.playlistTitle}`, 'error');
}

function handleProgressiveExportCompleted(request) {
  const status = document.getElementById('export-status');
  const progressBar = document.getElementById('export-progress-bar');
  const stats = request.stats;

  if (progressBar) {
    progressBar.style.width = '100%';
  }

  // Build completion message
  let message = `Export complete! ${stats.completed} of ${stats.total} playlists exported successfully.`;

  if (stats.failed > 0) {
    message = `Export finished with errors: ${stats.completed} succeeded, ${stats.failed} failed.`;
  }

  if (status) {
    status.textContent = message;
    status.style.color = stats.failed > 0 ? '#f59e0b' : '#10b981';
  }

  // Show failed playlists if any
  if (stats.failedTitles && stats.failedTitles.length > 0) {
    const failedList = document.createElement('div');
    failedList.style.cssText = `
      margin-top: 10px;
      padding: 10px;
      background-color: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 4px;
      max-height: 150px;
      overflow-y: auto;
    `;

    failedList.innerHTML = `
      <div style="font-weight: bold; color: #dc2626; margin-bottom: 5px;">
        Failed playlists (${stats.failedTitles.length}):
      </div>
      <ul style="margin: 0; padding-left: 20px; color: #7f1d1d;">
        ${stats.failedTitles.map(title => `<li>${title}</li>`).join('')}
      </ul>
    `;

    const exportProgress = document.getElementById('export-progress');
    if (exportProgress) {
      // Remove any existing failed list
      const existingList = exportProgress.querySelector('div[style*="fef2f2"]');
      if (existingList) existingList.remove();

      exportProgress.appendChild(failedList);
    }
  }

  // Show completion notification
  showNotification(message, stats.failed > 0 ? 'warning' : 'success');

  // Re-enable buttons
  const startBtn = document.getElementById('start-export');
  const cancelBtn = document.getElementById('cancel-export');

  if (startBtn) startBtn.disabled = false;
  if (cancelBtn) cancelBtn.disabled = true;

  // Clean up after a delay
  setTimeout(() => {
    // Don't auto-close if there were failures - let user review them
    if (stats.failed === 0) {
      document.getElementById('yoto-bulk-export-modal')?.remove();
    }
    removeExportStatusIndicator();

    // Clear export state
    window.currentExportManifestId = null;
    window.totalPlaylists = 0;
    window.completedPlaylists = 0;
    window.failedPlaylistTitles = [];
  }, stats.failed > 0 ? 10000 : 3000);
}

function showNotification(message, type = 'info') {
  const existing = document.querySelector('.yoto-magic-notification');
  if (existing) existing.remove();

  const notification = document.createElement('div');
  notification.className = 'yoto-magic-notification';

  const bgColor = type === 'error' ? '#ef4444' :
                  type === 'success' ? '#10b981' :
                  type === 'warning' ? '#f59e0b' :
                  '#3b82f6';

  notification.style.cssText = `
    position: fixed;
    top: 20vh;
    left: 50%;
    transform: translateX(-50%);
    background: ${bgColor};
    color: white;
    padding: 16px 24px;
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
    z-index: 10001;
    max-width: 90%;
    width: auto;
    min-width: 280px;
    text-align: center;
    font-size: 15px;
    font-weight: 500;
    animation: slideDown 0.3s ease-out;
  `;
  notification.textContent = message;

  if (!document.getElementById('yoto-notification-animation')) {
    const style = document.createElement('style');
    style.id = 'yoto-notification-animation';
    style.textContent = `
      @keyframes slideDown {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(-20px);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(notification);

  const duration = type === 'success' ? 2000 : 5000;
  setTimeout(() => {
    notification.remove();
  }, duration);
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

function setupObserver() {
  if (state.observer) return;

  // Wait for body to be available (important when using document_start)
  if (!document.body) {
    setTimeout(setupObserver, 10);
    return;
  }

  state.observer = new MutationObserver((mutations) => {
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

function injectStyles() {
  // Wait for head to be available (important when using document_start)
  if (!document.head) {
    setTimeout(injectStyles, 10);
    return;
  }

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

async function uploadWithRetry(uploadFn, maxRetries = 3, retryDelay = 1000, timeoutMs = 60000) {
  let rateLimitRetries = 0;
  const maxRateLimitRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {

      // Increased timeout to 60 seconds by default, can be overridden
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Upload timeout after ${timeoutMs/1000} seconds`)), timeoutMs)
      );

      const result = await Promise.race([uploadFn(), timeoutPromise]);
      return { status: 'fulfilled', value: result };
    } catch (error) {
      // Check if it's a rate limit error (from our background service)
      const errorMsg = error?.message || error?.error || '';
      const isRateLimited = errorMsg.includes('Rate limited') ||
                           errorMsg.includes('rate_limited') ||
                           errorMsg.includes('429') ||
                           errorMsg.includes('Too many requests');

      if (isRateLimited) {
        rateLimitRetries++;
        if (rateLimitRetries > maxRateLimitRetries) {
          console.error('[Upload] Max rate limit retries exceeded');
          return { status: 'rejected', reason: new Error('Too many requests. Please wait a moment and try again.') };
        }

        console.warn(`[Upload] Rate limited (retry ${rateLimitRetries}/${maxRateLimitRetries}):`, errorMsg);
        // For rate limiting, use a longer delay with exponential backoff
        const rateLimitDelay = Math.min(5000 * Math.pow(2, rateLimitRetries - 1), 30000); // 5s, 10s, 20s, max 30s
        await new Promise(resolve => setTimeout(resolve, rateLimitDelay));
        // Don't count rate limit retries against normal attempt counter
        attempt--;
        continue;
      }

      if (attempt === maxRetries - 1) {
        return { status: 'rejected', reason: error };
      }
      // Exponential backoff for other errors
      const delay = retryDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

function showBulkImportModal(playlists, importMode = 'separate') {
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
        ${chrome.i18n.getMessage('label_numTracks', [playlist.audioFiles.length.toString()])}${playlist.trackIcons.length > 0 ? `, ${playlist.trackIcons.length} icons` : ''}${playlist.coverImage ? ', cover image' : ''}
      </div>
    </div>
  `).join('');
  
  const modalTitle = importMode === 'merged' ? chrome.i18n.getMessage('modal_importMergedPlaylist') : 'Bulk Import Playlists';
  const modalDescription = importMode === 'merged'
    ? chrome.i18n.getMessage('label_contentWillUploadSinglePlaylist', [playlists[0].audioFiles.length.toString()])
    : `Found ${playlists.length} playlist${playlists.length > 1 ? 's' : ''} ready to import:`;

  content.innerHTML = `
    <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">${modalTitle}</h2>
    <div style="margin-bottom: 20px; color: #666;">
      <p>${modalDescription}</p>
    </div>
    
    <div style="margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <label style="font-weight: 500; margin-right: 16px;">${importMode === 'merged' ? chrome.i18n.getMessage('label_playlistDetails') : 'Select playlists to import:'}</label>
        ${importMode === 'merged' ? '' : `
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
        `}
      </div>
      <div style="max-height: 300px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px;">
        ${playlistPreviews}
      </div>
    </div>
    
    <div id="bulk-import-progress" style="display: none; margin: 20px 0;">
      <div style="margin-bottom: 12px;">
        <p id="current-playlist-status" style="color: #666; font-size: 14px; margin-bottom: 4px;">${importMode === 'merged' ? 'Upload Progress:' : 'Overall Progress:'}</p>
        <p id="current-track-status" style="color: #888; font-size: 12px; margin-bottom: 8px; font-style: italic; min-height: 18px;"></p>
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
      ">${chrome.i18n.getMessage('button_cancel')}</button>
      <button id="start-bulk-import" style="
        padding: 10px 20px;
        background: #10b981;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">${chrome.i18n.getMessage('button_start')}</button>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  const selectAllBtn = document.querySelector('#select-all');
  if (selectAllBtn) {
    selectAllBtn.onclick = () => {
      playlists.forEach((_, index) => {
        const checkbox = document.querySelector(`#playlist-${index}`);
        if (checkbox) checkbox.checked = true;
      });
    };
  }

  const deselectAllBtn = document.querySelector('#deselect-all');
  if (deselectAllBtn) {
    deselectAllBtn.onclick = () => {
      playlists.forEach((_, index) => {
        const checkbox = document.querySelector(`#playlist-${index}`);
        if (checkbox) checkbox.checked = false;
      });
    };
  }
  
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
      showNotification(chrome.i18n.getMessage('notification_selectAtLeastOnePlaylist'), 'error');
      return;
    }

    let totalLargeFiles = [];
    let totalFileCount = 0;

    selectedPlaylists.forEach(playlist => {
      const largeFiles = checkAudioFileSizes(playlist.audioFiles);
      if (largeFiles.length > 0) {
        largeFiles.forEach(file => {
          totalLargeFiles.push({
            ...file,
            playlistName: playlist.name
          });
        });
      }
      totalFileCount += playlist.audioFiles.length;
    });

    if (totalLargeFiles.length > 0) {
      const shouldContinue = await showLargeFilesWarningModal(
        totalLargeFiles,
        totalFileCount,
        `${selectedPlaylists.length} playlist${selectedPlaylists.length > 1 ? 's' : ''}`
      );

      if (!shouldContinue) {
        return; // User cancelled
      }

      selectedPlaylists.forEach(playlist => {
        const largeFiles = checkAudioFileSizes(playlist.audioFiles);
        if (largeFiles.length > 0) {
          playlist.audioFiles = playlist.audioFiles.filter((_, index) =>
            !largeFiles.some(lf => lf.index === index)
          );
          // Also filter track icons to match
          playlist.trackIcons = playlist.trackIcons.filter((_, index) =>
            !largeFiles.some(lf => lf.index === index)
          );

          playlist.trackIcons.forEach(icon => {
            if (icon && icon.extractedNumber !== undefined) {
              delete icon.extractedNumber;
            }
          });
        }
      });

      const validPlaylists = selectedPlaylists.filter(p => p.audioFiles.length > 0);

      if (validPlaylists.length === 0) {
        showNotification(chrome.i18n.getMessage('notification_noValidFilesAfterFilter'), 'error');
        modal.remove();
        return;
      }

      selectedPlaylists.length = 0;
      selectedPlaylists.push(...validPlaylists);
    }

    // Start the bulk import process
    await processBulkImport(selectedPlaylists, modal, importMode);
  };
}

async function processUpdateFiles(files, sourceName, cardId) {
  // Remove common file extensions from sourceName for cleaner playlist titles
  const cleanSourceName = sourceName.replace(/\.(zip|rar|7z|tar|gz)$/i, '');

  const audioFiles = [];
  const iconFiles = [];

  const ICON_MAX_SIZE = 50 * 1024;  // Icons are typically < 50KB

  if (Array.isArray(files)) {
    files.forEach(file => {
      const fileName = file.name.toLowerCase();
      const path = file.webkitRelativePath || file.name;
      const fileSize = file.size || 0;

      if (fileName.match(/\.(mp3|m4a|wav|ogg|aac|flac)$/)) {
        audioFiles.push({
          file: file,
          name: file.name,
          path: path
        });
      } else if (fileName.match(/\.(jpg|jpeg|png|gif|webp|svg)$/)) {
        const isCoverImage = hasCoverKeywords(file.name) && fileSize > ICON_MAX_SIZE;

        if (!isCoverImage && fileSize <= ICON_MAX_SIZE) {
          iconFiles.push({
            file: file,
            name: file.name,
            path: path,
            fileSize: fileSize
          });
        }
      }
    });
  } else {
    // From ZIP extraction
    Object.entries(files).forEach(([path, file]) => {
      const fileName = path.toLowerCase();
      const baseName = path.split('/').pop().toLowerCase();
      const fileSize = file.size || 0;

      if (fileName.match(/\.(mp3|m4a|wav|ogg|aac|flac)$/)) {
        audioFiles.push({
          file: file,
          name: path.split('/').pop(),
          path: path
        });
      } else if (fileName.match(/\.(jpg|jpeg|png|gif|webp|svg)$/)) {
        const isCoverImage = hasCoverKeywords(baseName) && fileSize > ICON_MAX_SIZE;

        if (!isCoverImage && fileSize <= ICON_MAX_SIZE) {
          iconFiles.push({
            file: file,
            name: path.split('/').pop(),
            path: path,
            fileSize: fileSize
          });
        }
      }
    });
  }

  if (audioFiles.length === 0 && iconFiles.length === 0) {
    showNotification(chrome.i18n.getMessage('notification_noAudioOrIconFiles'), 'error');
    return;
  }

  audioFiles.sort((a, b) => {
    const pathA = a.path || a.name;
    const pathB = b.path || b.name;
    return pathA.localeCompare(pathB, undefined, { numeric: true, sensitivity: 'base' });
  });

  const numericIcons = [];
  const nonNumericIcons = [];

  iconFiles.forEach(f => {
    // - Files ending with number: "01.png", "icon01.png", "icn3.png"
    // - Files starting with number: "1 Farmer Joe.png", "01 - Track Name.png", "1.Track.png"
    // - Files with number in middle: "Icon 01.png", "icon_01.png", "Track 01 Name.png"
    let numberMatch = f.name.match(/(\d+)[^0-9]*\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i); // Files ending with number (existing pattern)
    if (!numberMatch) {
      numberMatch = f.name.match(/^(\d+)[\s\-_.]/i); // Files starting with number followed by separator
    }
    if (!numberMatch) {
      numberMatch = f.name.match(/[\s\-_](\d+)[\s\-_.].*\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i); // Number in middle
    }

    if (numberMatch) {
      f.extractedNumber = parseInt(numberMatch[1]);
      numericIcons.push(f);
    } else {
      nonNumericIcons.push(f);
    }
  });

  numericIcons.sort((a, b) => {
    return (a.extractedNumber || 0) - (b.extractedNumber || 0);
  });

  iconFiles.length = 0;
  iconFiles.push(...numericIcons, ...nonNumericIcons);

  showUpdateProgressModal(audioFiles, iconFiles, cardId, cleanSourceName);
}

async function showUpdateProgressModal(audioFiles, iconFiles, cardId, sourceName) {
  // Try to get the card title for existing cards
  let cardTitle = state.updateCardTitle || sourceName || 'Untitled';

  // If we have a card ID and it looks valid, try to get the actual card title
  if (cardId && cardId !== 'new' && !cardId.startsWith('temp-')) {
    try {
      const cardContent = await chrome.runtime.sendMessage({
        action: 'GET_CARD_CONTENT',
        cardId: cardId
      });

      if (!cardContent.error && cardContent.card && cardContent.card.title) {
        cardTitle = cardContent.card.title;
      }
    } catch (e) {
      // If we can't get the card title, use what we have
    }
  }

  const largeFiles = checkAudioFileSizes(audioFiles.map(af => af.file));

  if (largeFiles.length > 0) {
    const shouldContinue = await showLargeFilesWarningModal(
      largeFiles,
      audioFiles.length,
      cardTitle
    );

    if (!shouldContinue) {
      return; // User canceled
    }

    const validAudioFiles = audioFiles.filter((_, index) =>
      !largeFiles.some(lf => lf.index === index)
    );

    // Also filter icons to match
    const validIconFiles = iconFiles.filter((_, index) =>
      !largeFiles.some(lf => lf.index === index)
    );

    if (validAudioFiles.length === 0 && validIconFiles.length === 0) {
      showNotification(chrome.i18n.getMessage('notification_noFilesToUpdate'), 'error');
      return;
    }

    audioFiles = validAudioFiles;
    iconFiles = validIconFiles;
  }

  const modal = document.createElement('div');
  modal.id = 'yoto-update-progress-modal';
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
    max-width: 500px;
    width: 90%;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    animation: slideDown 0.3s ease;
  `;

  content.innerHTML = `
    <h2 style="margin: 0 0 16px 0; color: #2c3e50; font-size: 18px; font-weight: 600;">
      Update Card: ${cardTitle}
    </h2>

    <div style="margin-bottom: 20px; color: #666;">
      <p style="margin: 0 0 8px 0;">${audioFiles.length > 0 ? 'Ready to add to existing card:' : 'Ready to update existing card icons:'}</p>
      <ul style="margin: 8px 0; padding-left: 20px; font-size: 14px;">
        ${audioFiles.length > 0 ? `<li>${audioFiles.length} audio file${audioFiles.length !== 1 ? 's' : ''}</li>` : ''}
        ${iconFiles.length > 0 ? `<li>${iconFiles.length} icon file${iconFiles.length !== 1 ? 's' : ''} ${audioFiles.length === 0 ? '(will update existing tracks by number)' : ''}</li>` : ''}
      </ul>
      <p style="color: #10b981; font-size: 13px; margin: 8px 0;">✓ Existing content will be preserved</p>
      <p style="color: #10b981; font-size: 13px; margin: 8px 0;">✓ Cover image will not be changed</p>
      ${audioFiles.length === 0 && iconFiles.length > 0 ? `<p style="color: #3b82f6; font-size: 13px; margin: 8px 0; display: flex; align-items: center; gap: 6px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink: 0;">
          <circle cx="12" cy="12" r="10" stroke="#3b82f6" stroke-width="2"/>
          <path d="M12 16V12" stroke="#3b82f6" stroke-width="2" stroke-linecap="round"/>
          <circle cx="12" cy="8" r="1" fill="#3b82f6"/>
        </svg>
        <span>Icons will be applied to tracks based on filename numbers</span>
      </p>` : ''}
    </div>

    <div style="margin: 20px 0;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
        <span id="update-status" style="color: #666; font-size: 14px;">Preparing update...</span>
        <span id="update-percentage" style="color: #3b82f6; font-size: 14px;">0%</span>
      </div>
      <div style="width: 100%; height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden;">
        <div id="update-progress-bar" style="width: 0%; height: 100%; background: #3b82f6; transition: width 0.3s;"></div>
      </div>
    </div>

    <button id="cancel-update" style="
      width: 100%;
      padding: 12px;
      background: #6b7280;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 500;
      cursor: pointer;
      margin-top: 16px;
    " onmouseover="this.style.backgroundColor='#4b5563'" onmouseout="this.style.backgroundColor='#6b7280'">
      Cancel
    </button>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  performCardUpdate(audioFiles, iconFiles, cardId, modal, sourceName);

  document.getElementById('cancel-update').addEventListener('click', () => {
    modal.remove();
  });
}

function isZeroBasedIconNumbering(iconFiles) {
  if (!iconFiles || iconFiles.length === 0) return false;
  const firstNumberedIcon = iconFiles.find(icon => icon.extractedNumber !== undefined);

  // If the first numbered icon starts with 0, it's 0-based numbering
  return firstNumberedIcon && firstNumberedIcon.extractedNumber === 0;
}

async function performCardUpdate(audioFiles, iconFiles, cardId, modal, sourceName) {
  const statusText = document.getElementById('update-status');
  const progressBar = document.getElementById('update-progress-bar');
  const percentageText = document.getElementById('update-percentage');
  const cancelBtn = document.getElementById('cancel-update');

  cancelBtn.disabled = true;
  cancelBtn.style.opacity = '0.5';
  cancelBtn.style.cursor = 'not-allowed';

  try {
    let isNewCard = false;
    let cardContent = null;
    let existingChapters = [];
    let existingMetadata = {};
    // For new cards, use folder name if available, otherwise 'Untitled'
    // For existing cards, this will be overwritten with the actual title
    let existingTitle = state.updateCardTitle || sourceName || 'Untitled';

    if (cardId && cardId !== 'new' && !cardId.startsWith('temp-')) {
      statusText.textContent = chrome.i18n.getMessage('status_fetchingCardContent');
      progressBar.style.width = '10%';
      percentageText.textContent = '10%';

      cardContent = await chrome.runtime.sendMessage({
        action: 'GET_CARD_CONTENT',
        cardId: cardId
      });

      // Check if we got a 404 error (card doesn't exist)
      if (cardContent.error && cardContent.error.includes('not-found')) {
        isNewCard = true;
      } else if (cardContent.error) {
        throw new Error(cardContent.error);
      } else {
        // Card exists, preserve existing content
        existingChapters = cardContent.card?.content?.chapters || [];
        existingMetadata = cardContent.card?.metadata || {};
        existingTitle = cardContent.card?.title || state.updateCardTitle;
      }
    } else {
      isNewCard = true;
    }

    const uploadedTracks = [];

    // Only upload audio files if we have any
    if (audioFiles.length > 0) {
      statusText.textContent = chrome.i18n.getMessage('status_uploadingFiles');
      progressBar.style.width = '30%';
      percentageText.textContent = '30%';

      const uploadStrategy = audioFiles.length >= 10 ? 'chunked' : 'parallel';

    if (uploadStrategy === 'chunked') {
      const chunkSize = 8;
      const audioResults = await uploadInChunks(
        audioFiles,
        async (audio, index) => {
          const fileSize = audio.file.size || audio.file.fileSize || 0;
          const MAX_SINGLE_FILE = 35 * 1024 * 1024;

          let uploadResult;

          if (fileSize > MAX_SINGLE_FILE) {

            // Get presigned URL from service worker
            const urlResult = await chrome.runtime.sendMessage({
              action: 'GET_UPLOAD_URL'
            });

            if (urlResult.error) {
              throw new Error(`Failed to get upload URL: ${urlResult.error}`);
            }

            const { uploadUrl, uploadId } = urlResult;

            // Upload directly to S3 from content script

            try {
              const uploadResponse = await fetch(uploadUrl, {
                method: 'PUT',
                body: audio.file,
                headers: {
                  'Content-Type': audio.file.type || 'audio/mpeg'
                }
              });

              if (!uploadResponse.ok) {
                throw new Error(`S3 upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
              }


              // Poll for transcoding completion
              let transcodedAudio = null;
              let attempts = 0;
              const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);

              // Adaptive timeout based on file size
              const baseAttempts = 60;
              const additionalAttempts = fileSize > (35 * 1024 * 1024)
                  ? Math.floor((fileSize / (1024 * 1024) - 35) * 2)
                  : 0;
              const maxAttempts = Math.min(baseAttempts + additionalAttempts, 600);

              // Initial polling with exponential backoff
              let pollDelay = 500; // Start at 500ms
              const maxPollDelay = 3000; // Max 3 seconds between polls
              let totalElapsed = 0;


              while (attempts < maxAttempts && !transcodedAudio) {
                attempts++;

                await new Promise(resolve => setTimeout(resolve, pollDelay));
                totalElapsed += pollDelay;

                const transcodeResult = await chrome.runtime.sendMessage({
                  action: 'CHECK_TRANSCODE_STATUS',
                  uploadId: uploadId
                });

                if (transcodeResult.error) {
                  // Check for specific errors that indicate rejection
                  if (transcodeResult.error.includes('403') ||
                      transcodeResult.error.includes('forbidden') ||
                      transcodeResult.error.includes('not allowed')) {
                    throw new Error(`Upload rejected: ${transcodeResult.error}`);
                  }
                  // Check for permanent errors
                  if (transcodeResult.error.includes('404') ||
                      transcodeResult.error.includes('not found')) {
                    throw new Error(`Upload failed: ${transcodeResult.error}. Please try uploading again.`);
                  }
                  // Log other errors but continue polling
                  if (attempts % 10 === 0) {
                  }
                } else if (transcodeResult.ready && transcodeResult.transcodedAudio) {
                  transcodedAudio = transcodeResult.transcodedAudio;
                  const elapsedSeconds = Math.round(totalElapsed / 1000);
                  break;
                }

                // Show progress with more realistic estimates
                if (attempts % 10 === 0) {
                  const elapsedSeconds = Math.round(totalElapsed / 1000);
                  // More conservative estimate: 3-4 seconds per MB for large files
                  const estimatedTotal = Math.round(fileSizeMB * (fileSizeMB > 50 ? 4 : 3));
                  const percentComplete = Math.min(95, Math.round((elapsedSeconds / estimatedTotal) * 100));
                }

                // Exponential backoff: increase delay by 1.5x each time, up to max
                pollDelay = Math.min(Math.floor(pollDelay * 1.5), maxPollDelay);
              }

              if (!transcodedAudio) {
                const elapsedSeconds = Math.round(totalElapsed / 1000);
                throw new Error(`Transcoding timeout after ${elapsedSeconds} seconds (${attempts} attempts). The file may be too large or complex.`);
              }

              uploadResult = {
                success: true,
                transcodedAudio: transcodedAudio,
                uploadId: uploadId
              };

            } catch (uploadError) {
              console.error(`[Update Playlist] Direct upload failed:`, uploadError);
              throw new Error(`Upload failed: ${uploadError.message}`);
            }

            if (uploadResult.error) {
              throw new Error(uploadResult.error);
            }

            // Small delay after large file upload to prevent overwhelming the system
            await new Promise(resolve => setTimeout(resolve, 100));
          } else {
            const fileData = audio.file instanceof File ?
              await readFileAsBase64(audio.file) :
              audio.file;

            uploadResult = await chrome.runtime.sendMessage({
              action: 'UPLOAD_AUDIO',
              file: {
                data: fileData,
                type: audio.file.type || 'audio/mpeg',
                name: audio.name
              }
            });
          }

          return { uploadResult, audio, index };
        },
        chunkSize,
        (completed, total) => {
          const progressPercent = 30 + (completed / total) * 40;
          progressBar.style.width = `${progressPercent}%`;
          percentageText.textContent = `${Math.round(progressPercent)}%`;
          statusText.textContent = chrome.i18n.getMessage('status_uploadingFiles');
        }
      );

      audioResults.forEach((result) => {
        if (result.status === 'fulfilled' && result.value.uploadResult.success) {
          const { uploadResult, audio, index } = result.value;
          const transcodedAudio = uploadResult?.transcodedAudio || uploadResult;
          let trackKey = transcodedAudio?.key || uploadResult?.uploadId || '';
          if (trackKey.length > 20) {
            trackKey = trackKey.substring(trackKey.length - 20);
          }

          const trackUrl = transcodedAudio?.transcodedSha256 ?
            `yoto:#${transcodedAudio.transcodedSha256}` :
            `yoto:#${trackKey}`;

          uploadedTracks[index] = {
            title: cleanTrackTitle(audio.name),
            duration: transcodedAudio?.duration || transcodedAudio?.transcodedInfo?.duration || 0,
            key: trackKey,
            trackUrl: trackUrl,
            format: transcodedAudio?.transcodedInfo?.format || 'mp3'
          };
        }
      });
    } else {
      const audioPromises = audioFiles.map(async (audio, index) => {
        const fileSize = audio.file.size || audio.file.fileSize || 0;
        const MAX_SINGLE_FILE = 35 * 1024 * 1024;

        let uploadResult;

        if (fileSize > MAX_SINGLE_FILE) {
          const CHUNK_SIZE = 10 * 1024 * 1024;
          const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
          const startResult = await chrome.runtime.sendMessage({
            action: 'START_CHUNKED_AUDIO_UPLOAD',
            fileName: audio.name,
            fileType: audio.file.type || 'audio/mpeg',
            fileSize: fileSize,
            totalChunks: totalChunks
          });

          if (startResult.error) {
            throw new Error(startResult.error);
          }

          const uploadId = startResult.uploadId;

          for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            const start = chunkIndex * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, fileSize);
            const chunk = audio.file.slice(start, end);

            const reader = new FileReader();
            const chunkBase64 = await new Promise((resolve, reject) => {
              reader.onload = () => {
                const dataUrl = reader.result;
                const base64Index = dataUrl.indexOf(',');
                if (base64Index === -1) {
                  reject(new Error(`Invalid data URL for chunk ${chunkIndex}`));
                  return;
                }
                const base64Part = dataUrl.substring(base64Index + 1);
                if (!base64Part) {
                  reject(new Error(`Empty base64 for chunk ${chunkIndex}`));
                  return;
                }
                resolve(base64Part);
              };
              reader.onerror = () => reject(new Error(`Failed to read chunk ${chunkIndex}`));
              reader.readAsDataURL(chunk);
            });

            const chunkResult = await chrome.runtime.sendMessage({
              action: 'SEND_AUDIO_CHUNK',
              uploadId: uploadId,
              chunkIndex: chunkIndex,
              chunkData: chunkBase64,
              isLastChunk: chunkIndex === totalChunks - 1
            });

            if (chunkResult.error) {
              throw new Error(chunkResult.error);
            }
          }

          uploadResult = await chrome.runtime.sendMessage({
            action: 'COMPLETE_CHUNKED_AUDIO_UPLOAD',
            uploadId: uploadId
          });

          if (uploadResult.error) {
            throw new Error(uploadResult.error);
          }
        } else {
          const fileData = audio.file instanceof File ?
            await readFileAsBase64(audio.file) :
            audio.file;

          uploadResult = await chrome.runtime.sendMessage({
            action: 'UPLOAD_AUDIO',
            file: {
              data: fileData,
              type: audio.file.type || 'audio/mpeg',
              name: audio.name
            }
          });
        }

        const progressPercent = 30 + ((index + 1) / audioFiles.length) * 40;
        progressBar.style.width = `${progressPercent}%`;
        percentageText.textContent = `${Math.round(progressPercent)}%`;

        return { uploadResult, audio, index };
      });

      const results = await Promise.allSettled(audioPromises);

      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value.uploadResult.success) {
          const { uploadResult, audio, index } = result.value;
          const transcodedAudio = uploadResult?.transcodedAudio || uploadResult;
          let trackKey = transcodedAudio?.key || uploadResult?.uploadId || '';
          if (trackKey.length > 20) {
            trackKey = trackKey.substring(trackKey.length - 20);
          }

          const trackUrl = transcodedAudio?.transcodedSha256 ?
            `yoto:#${transcodedAudio.transcodedSha256}` :
            `yoto:#${trackKey}`;

          uploadedTracks[index] = {
            title: cleanTrackTitle(audio.name),
            duration: transcodedAudio?.duration || transcodedAudio?.transcodedInfo?.duration || 0,
            key: trackKey,
            trackUrl: trackUrl,
            format: transcodedAudio?.transcodedInfo?.format || 'mp3'
          };
        }
      });
    }
    } // Close the if (audioFiles.length > 0) block

    const validTracks = uploadedTracks.filter(track => track !== undefined);

    let uploadedIcons = [];
    if (iconFiles.length > 0) {
      statusText.textContent = chrome.i18n.getMessage('status_uploadingIconFiles');
      // Adjust progress based on whether we had audio files
      const iconProgressStart = audioFiles.length > 0 ? 75 : 30;
      progressBar.style.width = `${iconProgressStart}%`;
      percentageText.textContent = `${iconProgressStart}%`;

      // Handle icon filename formats that start with 0 or 1
      const isZeroBased = isZeroBasedIconNumbering(iconFiles);

      for (let i = 0; i < iconFiles.length; i++) {
        const icon = iconFiles[i];
        const fileData = icon.file instanceof File ?
          await readFileAsBase64(icon.file) :
          icon.file;

        const uploadResult = await chrome.runtime.sendMessage({
          action: 'UPLOAD_ICON',
          file: {
            data: fileData,
            type: icon.file.type || 'image/png',
            name: icon.name
          }
        });

        if (uploadResult.iconId) {
          if (icon.extractedNumber !== undefined) {
            // If icons are 0-based (0.png -> track 1), use extractedNumber directly
            // If icons are 1-based (1.png -> track 1), subtract 1 to get 0-based index
            const iconIndex = isZeroBased ? icon.extractedNumber : icon.extractedNumber - 1;
            uploadedIcons[iconIndex] = uploadResult.iconId;
          } else {
            uploadedIcons.push(uploadResult.iconId);
          }
        }
      }
    }

    let result;
    if (isNewCard) {
      // For new cards, use CREATE_PLAYLIST workflow
      statusText.textContent = chrome.i18n.getMessage('status_creatingCard');
      progressBar.style.width = '90%';
      percentageText.textContent = '90%';

      // Transform tracks to match the structure expected by CREATE_PLAYLIST
      const finalTracks = validTracks.map((track, index) => {
        const sha256Match = track.trackUrl?.match(/^yoto:#(.+)$/);
        const sha256 = sha256Match ? sha256Match[1] : track.key || '';

        return {
          title: track.title,
          transcodedAudio: {
            transcodedSha256: sha256,
            transcodedInfo: {
              duration: track.duration || 0,
              format: track.format || 'mp3',
              fileSize: track.fileSize || 0,
              channels: track.channels === 1 ? 'mono' : 'stereo'
            }
          }
        };
      });

      result = await chrome.runtime.sendMessage({
        action: 'CREATE_PLAYLIST',
        title: existingTitle,
        audioTracks: finalTracks,
        iconIds: uploadedIcons.filter(icon => icon),
        coverUrl: null
      });

      if (result.error) {
        throw new Error(result.error);
      }
    } else {
      // For existing cards, use UPDATE_PLAYLIST workflow
      statusText.textContent = chrome.i18n.getMessage('status_updatingCard');
      progressBar.style.width = '90%';
      percentageText.textContent = '90%';

      result = await chrome.runtime.sendMessage({
        action: 'UPDATE_PLAYLIST',
        cardId: cardId,
        existingChapters: existingChapters,
        newTracks: validTracks,
        newIcons: uploadedIcons,
        metadata: existingMetadata,
        title: existingTitle
      });

      if (result.error) {
        throw new Error(result.error);
      }
    }

    statusText.textContent = isNewCard ?
      chrome.i18n.getMessage('status_cardCreatedSuccess') || 'Card created successfully!' :
      chrome.i18n.getMessage('status_cardUpdatedSuccess');
    progressBar.style.width = '100%';
    percentageText.textContent = '100%';
    progressBar.style.background = '#10b981';

    let successMessage = isNewCard ?
      `Successfully created "${existingTitle}"` :
      `Successfully updated "${existingTitle}"`;
    if (validTracks.length > 0 && uploadedIcons.length > 0) {
      successMessage += ` with ${validTracks.length} new tracks and ${uploadedIcons.filter(icon => icon).length} icons`;
    } else if (validTracks.length > 0) {
      successMessage += ` with ${validTracks.length} new tracks`;
    } else if (result.updatedIcons > 0) {
      successMessage += ` with ${result.updatedIcons} new icons`;
    }

    setTimeout(() => {
      modal.remove();

      // Try to find the card ID from various possible locations in the response
      const cardId = result.cardId || result.id || result.card?.id || result.card?.cardId;

      // For new cards, navigate to the newly created card's URL
      if (isNewCard && cardId) {
        // Redirect to the newly created card's edit page
        const newCardUrl = `https://my.yotoplay.com/card/${cardId}/edit`;
        window.location.href = newCardUrl;
      } else {
        // For existing cards, just reload the page
        window.location.reload();
      }
    }, 2000);

  } catch (error) {
    statusText.textContent = chrome.i18n.getMessage('status_updateFailed') + ': ' + error.message;
    progressBar.style.background = '#ef4444';
    cancelBtn.textContent = chrome.i18n.getMessage('button_close');
    cancelBtn.disabled = false;

    showNotification(chrome.i18n.getMessage('error_failedToUpdateCard', [error.message]), 'error');

    chrome.runtime.sendMessage({
      action: 'TRACK_ERROR',
      error: error.message,
      context: {
        action: 'update_card',
        cardId: cardId
      }
    });
  }
}

function checkAudioFileSizes(audioFiles) {
  const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB limit (effectively unlimited)
  const largeFiles = [];

  audioFiles.forEach((file, index) => {
    const fileSize = file.size || file.fileSize || 0;
    if (fileSize > MAX_FILE_SIZE) {
      largeFiles.push({
        name: file.name || `Track ${index + 1}`,
        size: fileSize,
        sizeFormatted: `${(fileSize / 1024 / 1024).toFixed(1)}MB`,
        index: index
      });
    }
  });

  return largeFiles;
}

async function showLargeFilesWarningModal(largeFiles, totalFiles, playlistName) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      z-index: 100000;
      display: flex;
      align-items: center;
      justify-content: center;
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

    const filesList = largeFiles.map(file => `
      <li style="margin-bottom: 8px; color: #374151;">
        <strong>${file.name}</strong> (${file.sizeFormatted})
      </li>
    `).join('');

    const remainingFiles = totalFiles - largeFiles.length;

    content.innerHTML = `
      <div style="
        display: flex;
        align-items: center;
        margin-bottom: 20px;
      ">
        <div style="
          width: 48px;
          height: 48px;
          background: #fbbf24;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-right: 16px;
          flex-shrink: 0;
        ">
          <svg width="24" height="24" fill="white" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
          </svg>
        </div>
        <div>
          <h2 style="margin: 0 0 4px 0; color: #111827; font-size: 20px;">Large Files Detected</h2>
          <p style="margin: 0; color: #6b7280; font-size: 14px;">
            ${largeFiles.length} of ${totalFiles} files exceed the 2GB limit
          </p>
        </div>
      </div>

      <div style="
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 20px;
      ">
        <div style="font-weight: 500; margin-bottom: 12px; color: #374151;">
          These files will be skipped:
        </div>
        <ul style="margin: 0 0 16px 0; padding-left: 20px; max-height: 150px; overflow-y: auto; color: #374151;">
          ${filesList}
        </ul>
        <div style="font-size: 14px;">
          ${remainingFiles > 0 ?
            `<span style="color: #10b981;">✓ ${remainingFiles} file${remainingFiles !== 1 ? 's' : ''} will be imported normally.</span>` :
            '<span style="color: #374151;">⚠️ No files can be imported. All files exceed the size limit.</span>'
          }
        </div>
      </div>

      <div style="
        background: #f3f4f6;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 16px;
      ">
        <div style="font-weight: 500; margin-bottom: 8px; color: #374151;">
          What to do with large files:
        </div>
        <div style="color: #374151; font-size: 14px; line-height: 1.6;">
          <ol style="margin: 8px 0 0 0; padding-left: 20px;">
            <li>Upload them directly through Yoto; or</li>
            <li>Compress the file(s) to a smaller size</li>
          </ol>
        </div>

        <details style="margin-top: 12px;">
          <summary style="
            cursor: pointer;
            color: #3b82f6;
            font-size: 14px;
            font-weight: 500;
            padding: 4px 0;
            user-select: none;
          ">
            Show compression instructions
          </summary>
          <div style="
            margin-top: 12px;
            padding: 12px;
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            font-size: 13px;
            line-height: 1.6;
            color: #374151;
          ">
            <strong>Easy Online Tool (Free):</strong><br>
            1. Go to <a href="https://online-audio-converter.com" target="_blank" style="color: #3b82f6;">online-audio-converter.com</a><br>
            2. Upload your MP3 files<br>
            3. Select Standard Quality → Bitrate: 128 kbps<br>
            4. Convert and download the smaller files<br>
            5. Re-import using the compressed files
          </div>
        </details>
      </div>

      <div style="
        font-size: 12px;
        color: #6b7280;
        margin-bottom: 20px;
        text-align: center;
      ">
        Note: This size limit is due to Chrome's messaging protocol size limit.
      </div>

      <div style="display: flex; gap: 12px; justify-content: center;">
        <button id="cancel-import-warning" style="
          padding: 12px 24px;
          background: #f3f4f6;
          color: #374151;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 16px;
          font-weight: 500;
        ">Cancel</button>
        ${remainingFiles > 0 ? `
          <button id="continue-import-warning" style="
            padding: 12px 24px;
            background: #3b82f6;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            font-weight: 500;
          ">Continue</button>
        ` : ''}
      </div>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    document.querySelector('#cancel-import-warning').onclick = () => {
      modal.remove();
      resolve(false);
    };

    const continueBtn = document.querySelector('#continue-import-warning');
    if (continueBtn) {
      continueBtn.onclick = () => {
        modal.remove();
        resolve(true);
      };
    }
  });
}

// Helper function to get random fun status message
function getRandomFunStatus() {
  const messageCount = 10; // We have 10 fun status messages
  const randomIndex = Math.floor(Math.random() * messageCount) + 1;
  return chrome.i18n.getMessage(`bulkImport_funStatus${randomIndex}`);
}

async function processBulkImport(playlists, modal, importMode = 'separate') {
  if (!chrome.runtime?.id) {
    showNotification(chrome.i18n.getMessage('notification_connectionLost'), 'error');
    modal.remove();
    return;
  }

  const progressDiv = document.querySelector('#bulk-import-progress');
  const currentProgressBar = document.querySelector('#current-progress-bar');
  const currentStatus = document.querySelector('#current-playlist-status');
  const currentTrackStatus = document.querySelector('#current-track-status');
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

  const totalPlaylists = playlists.length;
  let completedPlaylists = 0;
  let successfulImports = 0;
  let failedImports = 0;
  let hasDroppedFiles = false;
  let isCancelled = false;

  cancelButton.textContent = chrome.i18n.getMessage('button_cancel');
  cancelButton.onclick = () => {
    isCancelled = true;
    addLogEntry('Cancelling import...', 'info');
    currentStatus.textContent = 'Cancelled';

    setTimeout(() => {
      if (successfulImports > 0) {
        window.location.reload();
      } else {
        modal.remove();
      }
    }, 500);
  };
  
  function addLogEntry(message, type = 'info') {
    const entry = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString();
    let color;

    if (type === 'error') {
      color = '#ef4444'; // Red
    } else if (type === 'success') {
      color = '#10b981'; // Green (reserved for success only)
    } else if (type === 'fun') {
      // Random fun colors from brand palette (excluding green - reserved for success)
      const funColors = ['#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899'];
      color = funColors[Math.floor(Math.random() * funColors.length)];
    } else {
      color = '#6b7280'; // Gray
    }

    entry.style.cssText = `color: ${color}; margin-bottom: 4px;${type === 'fun' ? ' font-weight: 500;' : ''}`;
    entry.textContent = `[${timestamp}] ${message}`;
    importLog.appendChild(entry);
    importLog.scrollTop = importLog.scrollHeight;
  }
  
  addLogEntry(`Starting bulk import of ${totalPlaylists} playlist${totalPlaylists > 1 ? 's' : ''}...`);

  const bulkImportStartTime = Date.now();
  const CONCURRENT_PLAYLISTS = 2;

  // Add activity spinner after progress bar
  const spinner = document.createElement('span');
  spinner.id = 'activity-spinner';
  spinner.textContent = '⏳';
  spinner.style.cssText = 'display: inline-block; margin-left: 8px; animation: pulse 2s ease-in-out infinite;';
  currentStatus.appendChild(spinner);

  // Add CSS animation for spinner
  if (!document.querySelector('#bulk-import-animations')) {
    const style = document.createElement('style');
    style.id = 'bulk-import-animations';
    style.textContent = `
      @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(1.1); }
      }
    `;
    document.head.appendChild(style);
  }

  // Timer to occasionally show fun messages
  let lastFunMessageTime = Date.now();
  const FUN_MESSAGE_INTERVAL = 15000; // Show fun message every 15 seconds

  const funMessageTimer = setInterval(() => {
    // Show fun messages periodically during long imports
    if (Date.now() - lastFunMessageTime > FUN_MESSAGE_INTERVAL && !isCancelled) {
      const funMessage = getRandomFunStatus();
      addLogEntry(funMessage, 'fun'); // Use 'fun' type for colorful messages
      lastFunMessageTime = Date.now();
    }
  }, 1000);

  window.bulkImportActive = true;

  for (let batchStart = 0; batchStart < playlists.length; batchStart += CONCURRENT_PLAYLISTS) {
    if (isCancelled) {
      addLogEntry('Import cancelled by user', 'info');
      break;
    }

    const batch = playlists.slice(batchStart, Math.min(batchStart + CONCURRENT_PLAYLISTS, playlists.length));
    const currentBatch = Math.floor(batchStart / CONCURRENT_PLAYLISTS) + 1;
    const totalBatches = Math.ceil(playlists.length / CONCURRENT_PLAYLISTS);

    const remainingPlaylists = playlists.length - batchStart;
    const processingRate = completedPlaylists / ((Date.now() - bulkImportStartTime) / 1000) || 0;

    chrome.runtime.sendMessage({
      action: 'TRACK_ANALYTICS',
      eventName: 'queue_status',
      data: {
        queueType: 'bulk_import_playlists',
        currentLength: remainingPlaylists,
        maxLength: playlists.length,
        processingRate: processingRate
      }
    });

    if (batch.length > 1) {
      const playlistNames = batch.map(p => `"${p.name}"`).join(', ');
      addLogEntry(`Processing batch ${currentBatch}/${totalBatches}: ${batch.length} playlists in parallel`);
    } else if (totalBatches > 1) {
      addLogEntry(`Processing batch ${currentBatch}/${totalBatches}: "${batch[0].name}"`);
    }

    const batchPromises = batch.map((playlist, batchIndex) => {
      return (async () => {
        const isFirstInBatch = batchIndex === 0;

        if (batch.length === 1) {
          addLogEntry(`Starting import of "${playlist.name}"...`);
        }

        try {
          const playlistStartTime = Date.now();
          const result = await importSinglePlaylist(
            playlist.audioFiles,
            playlist.trackIcons,
            playlist.coverImage,
            playlist.name,
            (progress, status, currentTrack) => {
              if (isFirstInBatch) {
                const overallProgress = ((completedPlaylists / totalPlaylists) * 100) + (progress / totalPlaylists);
                currentProgressBar.style.width = `${Math.min(overallProgress, 99)}%`;
                if (status) {
                  // Line 1: Batch info with status
                  const batchInfo = totalBatches > 1 ? `Batch ${currentBatch}/${totalBatches}: ` : '';
                  currentStatus.textContent = `${batchInfo}${status}`;

                  // Line 2: Playlist name with current track (if provided)
                  if (currentTrack) {
                    currentTrackStatus.textContent = `Importing ${playlist.name}: ${currentTrack}`;
                  } else {
                    currentTrackStatus.textContent = `Importing ${playlist.name}`;
                  }
                }
              }
            }
          );

          const playlistDuration = (Date.now() - playlistStartTime) / 1000;

          if (result.droppedFiles && result.droppedFiles.length > 0) {
            hasDroppedFiles = true;
          }

          return { success: true, playlist, result, duration: playlistDuration, droppedFiles: result.droppedFiles || [] };
        } catch (error) {
          return { success: false, playlist, error };
        }
      })();
    });

    const batchResults = await Promise.allSettled(batchPromises);

    let shouldBreak = false;

    for (let i = 0; i < batchResults.length; i++) {
      const settledResult = batchResults[i];
      const playlist = batch[i];
      const playlistNumber = batchStart + i + 1;

      if (settledResult.status === 'fulfilled') {
        const result = settledResult.value;

        if (result.success) {
          successfulImports++;
          const durationText = result.duration ? ` (${result.duration.toFixed(2)}s)` : '';

          // Check for dropped files and log them
          if (result.droppedFiles && result.droppedFiles.length > 0) {
            const totalTracks = result.result.createResponse?.trackCount || (result.droppedFiles.length + (result.playlist.audioFiles?.length || 0));
            addLogEntry(`⚠ Imported "${result.playlist.name}" with ${result.droppedFiles.length} failed track${result.droppedFiles.length > 1 ? 's' : ''}${durationText}`, 'error');

            // Log each dropped file
            result.droppedFiles.forEach(dropped => {
              addLogEntry(`  ✗ Track #${dropped.trackNumber}: ${dropped.audioName} (${dropped.audioSize}) - ${dropped.reason || 'Upload failed'}`, 'error');
            });
          } else {
            addLogEntry(`✓ Successfully imported "${result.playlist.name}"${durationText}`, 'success');
          }
        } else {
          failedImports++;
          const errorMessage = result.error.message || 'Unknown error';
          addLogEntry(`✗ Failed to import "${result.playlist.name}": ${errorMessage}`, 'error');
          console.error(`[Bulk Import] Failed: "${result.playlist.name}"`, result.error);

          try {
            if (chrome.runtime?.id) {
              chrome.runtime.sendMessage({
                action: 'TRACK_ERROR',
                error: errorMessage,
                context: {
                  action: 'bulk_import_playlist',
                  playlistName: result.playlist.name,
                  component: 'content'
                }
              });
            }
          } catch (trackError) {
          }

          if (errorMessage.includes('Extension context') || errorMessage.includes('chrome.runtime')) {
            addLogEntry(chrome.i18n.getMessage('notification_connectionLost'), 'error');
            shouldBreak = true;
          }
        }
      } else {
        failedImports++;
        addLogEntry(`✗ Failed to import "${playlist.name}": Promise rejected`, 'error');
      }

      completedPlaylists++;
    }

    if (shouldBreak) {
      break;
    }

    // Update status after batch completes
    if (currentBatch < totalBatches) {
      const nextBatchStart = batchStart + CONCURRENT_PLAYLISTS;
      const remainingCount = playlists.length - nextBatchStart;
      currentStatus.textContent = `Preparing next batch (${remainingCount} playlist${remainingCount !== 1 ? 's' : ''} remaining)...`;
      currentProgressBar.style.width = `${(completedPlaylists / totalPlaylists * 100)}%`;
      addLogEntry(`Batch ${currentBatch} complete. ${remainingCount} playlist${remainingCount !== 1 ? 's' : ''} remaining.`, 'info');
    }
  }

  if (isCancelled) {
    currentStatus.textContent = 'Cancelled';
    currentProgressBar.style.width = '0%';
    addLogEntry(`Import cancelled. Completed ${successfulImports} of ${totalPlaylists} playlist${totalPlaylists > 1 ? 's' : ''}`, 'info');
    if (successfulImports > 0) {
      showNotification(`Import cancelled. ${successfulImports} playlist${successfulImports > 1 ? 's were' : ' was'} imported successfully.`, 'warning');
    } else {
      showNotification('Import cancelled', 'info');
    }
  } else {
    currentStatus.textContent = importMode === 'merged' ? 'Upload Complete' : 'Import Complete';
    currentProgressBar.style.width = '100%';

    if (successfulImports > 0 && failedImports === 0) {
      addLogEntry(`✓ All ${successfulImports} playlist${successfulImports > 1 ? 's' : ''} imported successfully!`, 'success');
    } else if (successfulImports > 0) {
      addLogEntry(`Import completed with ${successfulImports} success${successfulImports > 1 ? 'es' : ''} and ${failedImports} failure${failedImports > 1 ? 's' : ''}`, 'info');
    } else {
      addLogEntry(`✗ All imports failed`, 'error');
      showNotification(chrome.i18n.getMessage("notification_importAllFailed"), 'error');
    }
  }

  const totalDuration = Date.now() - bulkImportStartTime;
  const totalSeconds = totalDuration / 1000;
  const avgTimePerPlaylist = successfulImports > 0 ? (totalDuration / successfulImports / 1000).toFixed(2) : 0;

  // Cleanup timer and spinner
  clearInterval(funMessageTimer);
  const spinnerElement = document.querySelector('#activity-spinner');
  if (spinnerElement) spinnerElement.remove();

  window.bulkImportActive = false;

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

      chrome.runtime.sendMessage({
        action: 'TRACK_ANALYTICS',
        eventName: 'batch_metrics',
        data: {
          batchType: 'bulk_import',
          queueLength: totalPlaylists,
          processedCount: completedPlaylists,
          failureCount: failedImports,
          totalDuration: totalDuration
        }
      });
    }
  } catch (error) {
  }
  
  if (successfulImports > 0 && !isCancelled) {
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

    const iconColor = (failedImports > 0 || hasDroppedFiles) ? '#f59e0b' : '#10b981';
    const statusText = failedImports > 0
      ? chrome.i18n.getMessage('notification_importPartialSuccess', [successfulImports, failedImports])
      : chrome.i18n.getMessage('notification_importSuccess', [successfulImports]);

    successContent.innerHTML = `
      <div style="margin-bottom: 16px;">
        <svg style="width: 48px; height: 48px; color: ${iconColor}; margin: 0 auto;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
      </div>
      <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 600; color: #1f2937;">${statusText}</h3>
      <p style="margin: 0; color: #6b7280; font-size: 14px;">Refreshing page to show new playlists...</p>
    `;

    successModal.appendChild(successContent);
    modal.remove();
    document.body.appendChild(successModal);

    setTimeout(() => {
      window.location.reload();
    }, 1500);
  } else {
    cancelButton.disabled = false;
    cancelButton.style.opacity = '1';
    cancelButton.style.cursor = 'pointer';
    cancelButton.textContent = chrome.i18n.getMessage('button_close');
    cancelButton.onclick = () => {
      if (isCancelled && successfulImports > 0) {
        window.location.reload();
      } else {
        modal.remove();
      }
    };
  }
}

async function importSinglePlaylist(audioFiles, trackIcons, coverImage, playlistName, progressCallback) {


  if (!chrome.runtime?.id) {
    throw new Error('Extension context lost. Please refresh the page and try again.');
  }

  if (audioFiles.length === 0) {
    throw new Error('No audio files to upload');
  }

  const totalSize = audioFiles.reduce((sum, f) => sum + (f.size || f.fileSize || 0), 0);
  const avgFileSize = totalSize / audioFiles.length;

  let parallelCount;
  let delayBetweenBatches;

  if (avgFileSize < 5 * 1024 * 1024) {
    if (audioFiles.length <= 10) {
      parallelCount = 4;  // Reduced to prevent API overload
      delayBetweenBatches = 100;
    } else {
      parallelCount = 3;   // Reduced to prevent API overload
      delayBetweenBatches = 150;
    }
  } else if (avgFileSize < 15 * 1024 * 1024) {
    parallelCount = 3;     // Reduced to prevent API overload
    delayBetweenBatches = 200;
  } else {
    parallelCount = 2;     // Reduced to prevent API overload
    delayBetweenBatches = 300;
  }

  progressCallback(10, chrome.i18n.getMessage('status_uploadingFiles'));

  const uploadedTracks = [];
  const failedUploads = []; // Track failed uploads for retry

  for (let batchStart = 0; batchStart < audioFiles.length; batchStart += parallelCount) {
    const batch = audioFiles.slice(batchStart, Math.min(batchStart + parallelCount, audioFiles.length));
    const batchPromises = [];

    for (let i = 0; i < batch.length; i++) {
      const file = batch[i];
      const globalIndex = batchStart + i;
      const progress = 10 + (globalIndex / audioFiles.length) * 30; // Progress from 10% to 40%
      const uploadPercent = Math.round((globalIndex / audioFiles.length) * 100);

      // Show file name being uploaded for better visibility
      const fileName = file.name || `Track ${globalIndex + 1}`;
      const uploadStatus = chrome.i18n.getMessage('status_uploadingAudioFilePercent', [uploadPercent.toString()]);
      progressCallback(Math.round(progress), uploadStatus, fileName);

      const fileSize = file.size || file.fileSize || 0;
      // More generous timeouts when bulk import is active
      const baseTimeout = fileSize > 10 * 1024 * 1024 ? 180000 : 120000; // 3 min for files > 10MB, else 2 min
      const timeoutMs = window.bulkImportActive ? baseTimeout * 1.5 : baseTimeout; // Extra time during bulk operations
      
      const uploadPromise = uploadWithRetry(async () => {
        if (!chrome.runtime?.id) {
          throw new Error('Extension context lost during upload.');
        }
        
        let uploadResult;
        const fileSize = file.size || file.fileSize || 0;
        const MAX_SINGLE_FILE = 35 * 1024 * 1024;

        if (fileSize > MAX_SINGLE_FILE) {

          // Get presigned URL from service worker
          const urlResult = await chrome.runtime.sendMessage({
            action: 'GET_UPLOAD_URL'
          });

          if (urlResult.error) {
            throw new Error(`Failed to get upload URL: ${urlResult.error}`);
          }

          const { uploadUrl, uploadId } = urlResult;

          // Upload directly to S3 from content script

          try {
            const uploadResponse = await fetch(uploadUrl, {
              method: 'PUT',
              body: file,
              headers: {
                'Content-Type': file.type || 'audio/mpeg'
              }
            });

            if (!uploadResponse.ok) {
              throw new Error(`S3 upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
            }


            // Poll for transcoding completion
            let transcodedAudio = null;
            let attempts = 0;
            const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);

            // Adaptive timeout based on file size
            const baseAttempts = 60;
            const additionalAttempts = fileSize > (35 * 1024 * 1024)
                ? Math.floor((fileSize / (1024 * 1024) - 35) * 2)
                : 0;
            const maxAttempts = Math.min(baseAttempts + additionalAttempts, 600);

            // Initial polling with exponential backoff
            let pollDelay = 500; // Start at 500ms
            const maxPollDelay = 3000; // Max 3 seconds between polls
            let totalElapsed = 0;


            while (attempts < maxAttempts && !transcodedAudio) {
              attempts++;

              await new Promise(resolve => setTimeout(resolve, pollDelay));
              totalElapsed += pollDelay;

              const transcodeResult = await chrome.runtime.sendMessage({
                action: 'CHECK_TRANSCODE_STATUS',
                uploadId: uploadId
              });

              if (transcodeResult.error) {
                // Check for specific errors that indicate rejection
                if (transcodeResult.error.includes('403') ||
                    transcodeResult.error.includes('forbidden') ||
                    transcodeResult.error.includes('not allowed')) {
                  throw new Error(`Upload rejected: ${transcodeResult.error}`);
                }
                // Check for permanent errors
                if (transcodeResult.error.includes('404') ||
                    transcodeResult.error.includes('not found')) {
                  throw new Error(`Upload failed: ${transcodeResult.error}. Please try uploading again.`);
                }
                // Log other errors but continue polling
                if (attempts % 10 === 0) {
                }
              } else if (transcodeResult.ready && transcodeResult.transcodedAudio) {
                transcodedAudio = transcodeResult.transcodedAudio;
                const elapsedSeconds = Math.round(totalElapsed / 1000);
                break;
              }

              // Show progress with more realistic estimates
              if (attempts % 10 === 0) {
                const elapsedSeconds = Math.round(totalElapsed / 1000);
                // More conservative estimate: 3-4 seconds per MB for large files
                const estimatedTotal = Math.round(fileSizeMB * (fileSizeMB > 50 ? 4 : 3));
                const percentComplete = Math.min(95, Math.round((elapsedSeconds / estimatedTotal) * 100));
              }

              // Exponential backoff: increase delay by 1.5x each time, up to max
              pollDelay = Math.min(Math.floor(pollDelay * 1.5), maxPollDelay);
            }

            if (!transcodedAudio) {
              const elapsedSeconds = Math.round(totalElapsed / 1000);
              throw new Error(`Transcoding timeout after ${elapsedSeconds} seconds (${attempts} attempts). The file may be too large or complex.`);
            }

            uploadResult = {
              success: true,
              transcodedAudio: transcodedAudio,
              uploadId: uploadId
            };

          } catch (uploadError) {
            console.error(`[Bulk Import] Direct upload failed:`, uploadError);
            throw new Error(`Upload failed: ${uploadError.message}`);
          }

          if (uploadResult.error) {
            throw new Error(uploadResult.error);
          }

          // Small delay after large file upload to prevent overwhelming the system
          await new Promise(resolve => setTimeout(resolve, 100));
        } else {
          let base64Data;
          try {
            base64Data = await convertFileToBase64(file);
          } catch (convError) {
            const fileName = file.name || 'unknown';
            throw new Error(`Failed to convert ${fileName}: ${convError.message}`);
          }

          uploadResult = await chrome.runtime.sendMessage({
            action: 'UPLOAD_AUDIO',
            file: base64Data
          });
        }

        if (!uploadResult) {
          throw new Error('No response from extension. Please refresh and try again.');
        }

        if (uploadResult.error) {
          if (uploadResult.error.includes('Failed to fetch')) {
            const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);
            throw new Error(chrome.i18n.getMessage('error_networkUploadFailed', [file.name, fileSizeMB]));
          }
          throw new Error(`Audio upload failed: ${uploadResult.error}`);
        }
        

        const fileName = file.name || 'Track';
        const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
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

    for (let i = 0; i < batchResults.length; i++) {
      const result = batchResults[i];
      const file = batch[i];
      const globalIndex = batchStart + i;

      if (result.status === 'fulfilled') {
        uploadedTracks[result.value.originalIndex] = result.value;
      } else {
        // Log and track failed upload for retry
        const fileName = file?.name || `Track ${globalIndex + 1}`;
        const fileSize = file?.size || file?.fileSize || 0;
        const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);
        const errorMsg = result.reason?.message || 'Upload failed';

        console.error(`[Bulk Import] Failed upload: ${fileName} (${fileSizeMB}MB) - ${errorMsg}`);

        // Track for retry
        failedUploads.push({
          file: file,
          originalIndex: globalIndex,
          error: errorMsg,
          fileName: fileName,
          fileSize: fileSizeMB
        });
      }
    }
    
    // Delay between batches if not the last batch
    if (batchStart + parallelCount < audioFiles.length) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
  }

  // Automatic retry for failed uploads
  if (failedUploads.length > 0) {
    const retryCount = failedUploads.length;
    progressCallback(35, `Retrying ${retryCount} failed upload${retryCount > 1 ? 's' : ''}...`);

    console.info(`[Bulk Import] Retrying ${retryCount} failed uploads...`);

    // Retry failed uploads sequentially (not in parallel) to avoid overwhelming the API
    for (let retryIndex = 0; retryIndex < failedUploads.length; retryIndex++) {
      const failedUpload = failedUploads[retryIndex];
      const file = failedUpload.file;
      const originalIndex = failedUpload.originalIndex;

      const retryProgress = 35 + ((retryIndex + 1) / retryCount) * 5; // 35% to 40%
      progressCallback(Math.round(retryProgress), `Retrying failed upload${retryCount > 1 ? 's' : ''} (${retryIndex + 1}/${retryCount})`, failedUpload.fileName);

      try {
        const fileSize = file.size || file.fileSize || 0;
        // Use longer timeout for retries
        const retryTimeoutMs = fileSize > 10 * 1024 * 1024 ? 240000 : 180000; // 4 min / 3 min

        const retryResult = await uploadWithRetry(async () => {
          if (!chrome.runtime?.id) {
            throw new Error('Extension context lost during upload.');
          }

          let uploadResult;
          const fileSize = file.size || file.fileSize || 0;
          const MAX_SINGLE_FILE = 35 * 1024 * 1024;

          if (fileSize > MAX_SINGLE_FILE) {
            // Get presigned URL from service worker
            const urlResult = await chrome.runtime.sendMessage({
              action: 'GET_UPLOAD_URL'
            });

            if (urlResult.error) {
              throw new Error(`Failed to get upload URL: ${urlResult.error}`);
            }

            const { uploadUrl, uploadId } = urlResult;

            // Upload directly to S3 from content script
            try {
              const uploadResponse = await fetch(uploadUrl, {
                method: 'PUT',
                body: file,
                headers: {
                  'Content-Type': file.type || 'audio/mpeg'
                }
              });

              if (!uploadResponse.ok) {
                throw new Error(`S3 upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
              }

              // Poll for transcoding completion
              let transcodedAudio = null;
              let attempts = 0;
              const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);

              // Adaptive timeout based on file size
              const baseAttempts = 60;
              const additionalAttempts = fileSize > (35 * 1024 * 1024)
                  ? Math.floor((fileSize / (1024 * 1024) - 35) * 2)
                  : 0;
              const maxAttempts = Math.min(baseAttempts + additionalAttempts, 600);

              // Initial polling with exponential backoff
              let pollDelay = 500;
              const maxPollDelay = 3000;
              let totalElapsed = 0;

              while (attempts < maxAttempts && !transcodedAudio) {
                attempts++;

                await new Promise(resolve => setTimeout(resolve, pollDelay));
                totalElapsed += pollDelay;

                const transcodeResult = await chrome.runtime.sendMessage({
                  action: 'CHECK_TRANSCODE_STATUS',
                  uploadId: uploadId
                });

                if (transcodeResult.error) {
                  if (transcodeResult.error.includes('403') ||
                      transcodeResult.error.includes('forbidden') ||
                      transcodeResult.error.includes('not allowed')) {
                    throw new Error(`Upload rejected: ${transcodeResult.error}`);
                  }
                  if (transcodeResult.error.includes('404') ||
                      transcodeResult.error.includes('not found')) {
                    throw new Error(`Upload failed: ${transcodeResult.error}. Please try uploading again.`);
                  }
                } else if (transcodeResult.ready && transcodeResult.transcodedAudio) {
                  transcodedAudio = transcodeResult.transcodedAudio;
                  break;
                }

                pollDelay = Math.min(Math.floor(pollDelay * 1.5), maxPollDelay);
              }

              if (!transcodedAudio) {
                const elapsedSeconds = Math.round(totalElapsed / 1000);
                throw new Error(`Transcoding timeout after ${elapsedSeconds} seconds (${attempts} attempts). The file may be too large or complex.`);
              }

              uploadResult = {
                success: true,
                transcodedAudio: transcodedAudio,
                uploadId: uploadId
              };

            } catch (uploadError) {
              console.error(`[Bulk Import Retry] Direct upload failed:`, uploadError);
              throw new Error(`Upload failed: ${uploadError.message}`);
            }

            if (uploadResult.error) {
              throw new Error(uploadResult.error);
            }

            await new Promise(resolve => setTimeout(resolve, 100));
          } else {
            let base64Data;
            try {
              base64Data = await convertFileToBase64(file);
            } catch (convError) {
              const fileName = file.name || 'unknown';
              throw new Error(`Failed to convert ${fileName}: ${convError.message}`);
            }

            uploadResult = await chrome.runtime.sendMessage({
              action: 'UPLOAD_AUDIO',
              file: base64Data
            });
          }

          if (!uploadResult) {
            throw new Error('No response from extension. Please refresh and try again.');
          }

          if (uploadResult.error) {
            if (uploadResult.error.includes('Failed to fetch')) {
              const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);
              throw new Error(chrome.i18n.getMessage('error_networkUploadFailed', [file.name, fileSizeMB]));
            }
            throw new Error(`Audio upload failed: ${uploadResult.error}`);
          }

          const fileName = file.name || 'Track';
          const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
          const cleanedTitle = cleanTrackTitle(nameWithoutExt);

          return {
            title: cleanedTitle,
            originalIndex: originalIndex,
            transcodedAudio: uploadResult.transcodedAudio
          };
        }, 2, 2000, retryTimeoutMs); // 2 retries with 2s delay for retry attempts

        if (retryResult.status === 'fulfilled') {
          uploadedTracks[originalIndex] = retryResult.value;
          console.info(`[Bulk Import] Retry successful: ${failedUpload.fileName}`);
        } else {
          console.error(`[Bulk Import] ✗ Retry failed: ${failedUpload.fileName} - ${retryResult.reason?.message}`);
        }

        // Add delay between retry attempts to prevent overwhelming API
        if (retryIndex < failedUploads.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (retryError) {
        console.error(`[Bulk Import] ✗ Retry exception: ${failedUpload.fileName}`, retryError);
      }
    }

    const retriedSuccessCount = failedUploads.filter(fu => uploadedTracks[fu.originalIndex]).length;
    console.info(`[Bulk Import] Retry complete: ${retriedSuccessCount}/${retryCount} succeeded`);
  }

  const successfulUploads = uploadedTracks.filter(t => t).length;
  
  if (successfulUploads === 0) {
    throw new Error('Failed to upload any audio files');
  }
  
  const audioProgress = 40;

  const hasIcons = trackIcons.length > 0;
  const hasCover = coverImage !== null && coverImage !== undefined;

  if (hasIcons && hasCover) {
    progressCallback(audioProgress, chrome.i18n.getMessage('status_uploadingIcons') + ' & cover image');
  } else if (hasIcons) {
    progressCallback(audioProgress, chrome.i18n.getMessage('status_uploadingIcons'));
  } else if (hasCover) {
    progressCallback(audioProgress, chrome.i18n.getMessage('status_uploadingCoverImage'));
  }

  const uploadedIconIds = [];
  let uploadedCoverUrl = null;

  const uploadPromises = [];

  if (hasIcons) {
    const iconUploadPromise = (async () => {
      const isZeroBased = isZeroBasedIconNumbering(trackIcons);
      const iconParallelCount = Math.min(20, trackIcons.length);
      const iconDelayBetweenBatches = 0;

      for (let batchStart = 0; batchStart < trackIcons.length; batchStart += iconParallelCount) {
        const batch = trackIcons.slice(batchStart, Math.min(batchStart + iconParallelCount, trackIcons.length));
        const batchPromises = [];

        for (let i = 0; i < batch.length; i++) {
          const file = batch[i];
          const globalIndex = batchStart + i;
          const iconProgress = 40 + (globalIndex / trackIcons.length) * 30;
          const iconFileName = file.name || `Icon ${globalIndex + 1}`;
          progressCallback(Math.round(iconProgress), chrome.i18n.getMessage('status_uploadingIcons', [(globalIndex + 1).toString(), trackIcons.length.toString()]), iconFileName);

          const iconPromise = uploadWithRetry(async () => {
            if (!chrome.runtime?.id) {
              throw new Error('Extension context lost during icon upload.');
            }

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
              index: file.extractedNumber ? (isZeroBased ? file.extractedNumber : file.extractedNumber - 1) : globalIndex,
              iconId: result.iconId
            };
          }, 2, 1000, 30000);

          batchPromises.push(iconPromise);
        }

        const batchResults = await Promise.all(batchPromises);

        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            uploadedIconIds[result.value.index] = result.value.iconId;
          }
        }

        if (batchStart + iconParallelCount < trackIcons.length) {
          await new Promise(resolve => setTimeout(resolve, iconDelayBetweenBatches));
        }
      }

      return uploadedIconIds;
    })();

    uploadPromises.push(iconUploadPromise);
  }

  if (hasCover) {
    const coverUploadPromise = (async () => {
      try {
        if (!chrome.runtime?.id) {
          throw new Error('Extension context lost during cover upload.');
        }

        const base64Data = await convertFileToBase64(coverImage);

        const coverResult = await chrome.runtime.sendMessage({
          action: 'UPLOAD_COVER',
          file: base64Data
        });

        if (coverResult && !coverResult.error) {
          return coverResult.url || coverResult.coverUrl || coverResult.imageUrl;
        }
        return null;
      } catch (error) {
        return null;
      }
    })();

    uploadPromises.push(coverUploadPromise);
  }

  if (uploadPromises.length > 0) {
    const results = await Promise.all(uploadPromises);

    if (hasCover) {
      uploadedCoverUrl = hasIcons ? results[1] : results[0];
    }
  }
  
  progressCallback(90, chrome.i18n.getMessage('status_creatingPlaylist'));

  if (!chrome.runtime?.id) {
    throw new Error('Extension context lost. Please refresh the page and try again.');
  }

  const finalTracks = [];
  const finalIconIds = [];
  const droppedFiles = [];

  // Create a map of failed uploads by index for quick lookup
  const failedUploadMap = new Map();
  failedUploads.forEach(fu => {
    failedUploadMap.set(fu.originalIndex, fu.error);
  });

  uploadedTracks.forEach((track, index) => {
    if (track) {
      finalTracks.push(track);
      if (uploadedIconIds[index]) {
        finalIconIds.push(uploadedIconIds[index]);
      } else {
        finalIconIds.push(null); // No icon for this track
      }
    } else {
      const audioFile = audioFiles[index];
      const iconFile = trackIcons[index];

      if (audioFile) {
        const errorReason = failedUploadMap.get(index) || 'Upload failed (retries exhausted)';
        const dropped = {
          audioName: audioFile.name,
          audioSize: `${(audioFile.size / 1024 / 1024).toFixed(1)}MB`,
          iconName: iconFile ? iconFile.name : 'N/A',
          trackNumber: index + 1,
          reason: errorReason
        };
        droppedFiles.push(dropped);

        console.warn(
          `Dropped Track #${dropped.trackNumber}:`,
          `\n  Audio: ${dropped.audioName} (${dropped.audioSize})`,
          iconFile ? `\n  Icon: ${dropped.iconName} (not applied)` : '\n  Icon: None',
          `\n  Reason: ${dropped.reason}`
        );
      }
    }
  });

  if (droppedFiles.length > 0) {
    console.warn(
      `📊 Import Summary: ${droppedFiles.length} file(s) dropped out of ${audioFiles.length} total`,
      '\nDropped files:', droppedFiles,
      '\nIcons have been realigned with successful uploads.'
    );
  }

  const createResponse = await chrome.runtime.sendMessage({
    action: 'CREATE_PLAYLIST',
    title: playlistName,
    audioTracks: finalTracks,
    iconIds: finalIconIds,
    coverUrl: uploadedCoverUrl
  });
  
  if (!createResponse) {
    throw new Error('No response from extension. Please refresh and try again.');
  }
  
  if (createResponse.error) {
    throw new Error(`Failed to create playlist: ${createResponse.error}`);
  }

  progressCallback(100, 'Complete');

  return {
    createResponse: createResponse,
    droppedFiles: droppedFiles
  };
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function convertFileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file || !(file instanceof Blob)) {
      reject(new Error('Invalid file object provided'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        // Get base64 directly from data URL
        const dataUrl = reader.result;
        const base64 = dataUrl.split(',')[1];

        let mimeType = file.type;
        const fileName = file.name || '';
        if (!mimeType && fileName) {
          const ext = fileName.split('.').pop().toLowerCase();
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
          name: fileName
        });
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = (error) => {
      reject(error);
    };
    reader.readAsDataURL(file);
  });
}

function showImportModal(audioFiles, trackIcons, coverImage, defaultName = chrome.i18n.getMessage('label_importedPlaylist'), sourceType = chrome.i18n.getMessage('label_unknown')) {
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
  
  const audioFilePlural = audioFiles.length !== 1 ? 's' : '';
  const trackIconPlural = trackIcons.length !== 1 ? 's' : '';

  content.innerHTML = `
    <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">${chrome.i18n.getMessage('modal_importPlaylistTitle')}</h2>
    <div style="margin-bottom: 20px; color: #666;">
      <p>${chrome.i18n.getMessage('label_readyToImport')}</p>
      <ul style="margin: 10px 0; padding-left: 20px;">
        <li>${chrome.i18n.getMessage('label_audioFiles', [audioFiles.length.toString(), audioFilePlural])}</li>
        <li>${chrome.i18n.getMessage('label_trackIcons', [trackIcons.length.toString(), trackIconPlural])}</li>
        ${coverImage ? `<li>${chrome.i18n.getMessage('label_coverImage')}</li>` : ''}
      </ul>
    </div>
    <div style="margin-bottom: 20px;">
      <label style="display: block; margin-bottom: 5px; font-weight: 500;">${chrome.i18n.getMessage('label_playlistNameColon')}</label>
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
      ">${chrome.i18n.getMessage('button_cancel')}</button>
      <button id="start-import" style="
        padding: 10px 20px;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">${chrome.i18n.getMessage('button_startImport')}</button>
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
  
  document.querySelector('#cancel-import').onclick = () => modal.remove();
  
  document.querySelector('#start-import').onclick = async () => {
    const playlistName = document.querySelector('#import-playlist-name').value || 'Imported Playlist';
    const progressDiv = document.querySelector('#import-progress');
    const progressBar = document.querySelector('#import-progress-bar');
    const statusText = document.querySelector('#import-status');
    const startButton = document.querySelector('#start-import');

    const largeFiles = checkAudioFileSizes(audioFiles);

    if (largeFiles.length > 0) {
      const shouldContinue = await showLargeFilesWarningModal(largeFiles, audioFiles.length, playlistName);

      if (!shouldContinue) {
        return; // User cancelled
      }

      const validFiles = audioFiles.filter((_, index) =>
        !largeFiles.some(lf => lf.index === index)
      );

      const validTrackIcons = trackIcons.filter((_, index) =>
        !largeFiles.some(lf => lf.index === index)
      );

      if (validFiles.length === 0) {
        return; // No files to import after filtering
      }

      validTrackIcons.forEach(icon => {
        if (icon && icon.extractedNumber !== undefined) {
          delete icon.extractedNumber;
        }
      });

      audioFiles = validFiles;
      trackIcons = validTrackIcons;
    }

    progressDiv.style.display = 'block';
    startButton.disabled = true;
    startButton.textContent = chrome.i18n.getMessage('button_importing');

    try {
      const totalFiles = audioFiles.length + trackIcons.length + (coverImage ? 1 : 0);
      let completedFiles = 0;
      
      statusText.textContent = chrome.i18n.getMessage('status_startingUpload');

      const updateProgress = () => {
        completedFiles++;
        const percentage = Math.round((completedFiles / totalFiles) * 100);
        statusText.textContent = chrome.i18n.getMessage('status_percentComplete', [percentage.toString()]);
        progressBar.style.width = `${(completedFiles / totalFiles) * 70}%`;
      };

      // Automatically choose upload strategy based on file count
      // Use chunked strategy for 5+ audio files for better performance (lowered threshold)
      const uploadStrategy = audioFiles.length >= 5 ? 'chunked' : 'parallel';

      let uploadedCoverUrl = null;
      const uploadedIconIds = [];
      const uploadedTracks = [];

      if (uploadStrategy === 'chunked') {
        // CHUNKED UPLOAD (For playlists with 5+ audio files)
        statusText.textContent = chrome.i18n.getMessage('status_uploadingFiles');
        const chunkSize = 5; // Upload 5 files at a time for better balance between speed and stability
        
        if (coverImage) {
          const coverBase64 = await convertFileToBase64(coverImage);
          const coverResponse = await chrome.runtime.sendMessage({
            action: 'UPLOAD_COVER',
            file: coverBase64
          });
          if (!coverResponse.error && coverResponse.url) {
            uploadedCoverUrl = coverResponse.url;
          }
          updateProgress();
        }
        
        if (trackIcons.length > 0) {
          const isZeroBased = isZeroBasedIconNumbering(trackIcons);
          const iconResults = await uploadInChunks(
            trackIcons,
            async (iconFile, index) => {
              const iconBase64 = await convertFileToBase64(iconFile);
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
              statusText.textContent = chrome.i18n.getMessage('status_percentComplete', [percentage.toString()]);
              progressBar.style.width = `${totalProgress / totalFiles * 70}%`;
            }
          );

          iconResults.forEach((result) => {
            if (result.status === 'fulfilled' && !result.value.response.error) {
              // Use the pre-extracted number (already stored when detecting icons)
              const extractedNum = result.value.iconFile.extractedNumber || parseInt(result.value.iconFile.name.match(/\d+/)?.[0] || '1');
              // If icons are 0-based (0.png -> track 1), use extractedNumber directly
              // If icons are 1-based (1.png -> track 1), subtract 1 to get 0-based index
              const iconNumber = isZeroBased ? extractedNum : extractedNum - 1;
              uploadedIconIds[iconNumber] = result.value.response.iconId;
            }
          });
          completedFiles += trackIcons.length;
        }
        
        const audioResults = await uploadInChunks(
          audioFiles,
          async (audioFile, index) => {
            const fileSize = audioFile.size || audioFile.fileSize || 0;
            const MAX_SINGLE_FILE = 35 * 1024 * 1024;

            let response;

            if (fileSize > MAX_SINGLE_FILE) {

              // Get presigned URL from service worker
              const urlResult = await chrome.runtime.sendMessage({
                action: 'GET_UPLOAD_URL'
              });

              if (urlResult.error) {
                throw new Error(`Failed to get upload URL: ${urlResult.error}`);
              }

              const { uploadUrl, uploadId } = urlResult;

              // Upload directly to S3 from content script

              try {
                const s3UploadStartTime = Date.now();
                const uploadResponse = await fetch(uploadUrl, {
                  method: 'PUT',
                  body: audioFile,
                  headers: {
                    'Content-Type': audioFile.type || 'audio/mpeg'
                  }
                });

                if (!uploadResponse.ok) {
                  throw new Error(`S3 upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
                }

                // Track direct S3 upload from content script
                const uploadDuration = Date.now() - s3UploadStartTime;
                chrome.runtime.sendMessage({
                  action: 'TRACK_ANALYTICS',
                  eventName: 'upload_performance',
                  data: {
                    fileType: 'audio_direct_s3',
                    duration: uploadDuration,
                    fileSize: fileSize,
                    success: true
                  }
                });

                // Poll for transcoding completion
                let transcodedAudio = null;
                let attempts = 0;
                const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);

                // Adaptive timeout based on file size
                // Base: 60 attempts (60 seconds) for files up to 35MB
                // Add 2 attempts per MB over 35MB, up to max 600 attempts (10 minutes)
                const baseAttempts = 60;
                const additionalAttempts = fileSize > (35 * 1024 * 1024)
                    ? Math.floor((fileSize / (1024 * 1024) - 35) * 2)
                    : 0;
                const maxAttempts = Math.min(baseAttempts + additionalAttempts, 600);

                // Initial polling with exponential backoff
                let pollDelay = 500; // Start at 500ms
                const maxPollDelay = 3000; // Max 3 seconds between polls
                let totalElapsed = 0;


                while (attempts < maxAttempts && !transcodedAudio) {
                  attempts++;

                  await new Promise(resolve => setTimeout(resolve, pollDelay));
                  totalElapsed += pollDelay;

                  const transcodeResult = await chrome.runtime.sendMessage({
                    action: 'CHECK_TRANSCODE_STATUS',
                    uploadId: uploadId
                  });

                  if (transcodeResult.error) {
                    // Check for specific errors that indicate rejection
                    if (transcodeResult.error.includes('403') ||
                        transcodeResult.error.includes('forbidden') ||
                        transcodeResult.error.includes('not allowed')) {
                      throw new Error(`Upload rejected: ${transcodeResult.error}`);
                    }
                    // Check for permanent errors
                    if (transcodeResult.error.includes('404') ||
                        transcodeResult.error.includes('not found')) {
                      throw new Error(`Upload failed: ${transcodeResult.error}. Please try uploading again.`);
                    }
                    // Log other errors but continue polling
                    if (attempts % 10 === 0) {
                    }
                  } else if (transcodeResult.ready && transcodeResult.transcodedAudio) {
                    transcodedAudio = transcodeResult.transcodedAudio;
                    const elapsedSeconds = Math.round(totalElapsed / 1000);
                    break;
                  }

                  // Show progress with more realistic estimates
                  if (attempts % 10 === 0) {
                    const elapsedSeconds = Math.round(totalElapsed / 1000);
                    // More conservative estimate: 3-4 seconds per MB for large files
                    const estimatedTotal = Math.round(fileSizeMB * (fileSizeMB > 50 ? 4 : 3));
                    const percentComplete = Math.min(95, Math.round((elapsedSeconds / estimatedTotal) * 100));
                  }

                  // Exponential backoff: increase delay by 1.5x each time, up to max
                  pollDelay = Math.min(Math.floor(pollDelay * 1.5), maxPollDelay);
                }

                if (!transcodedAudio) {
                  const elapsedSeconds = Math.round(totalElapsed / 1000);
                  throw new Error(`Transcoding timeout after ${elapsedSeconds} seconds (${attempts} attempts). The file may be too large or complex.`);
                }

                response = {
                  success: true,
                  transcodedAudio: transcodedAudio,
                  uploadId: uploadId
                };

              } catch (uploadError) {
                throw new Error(`Upload failed: ${uploadError.message}`);
              }

              if (response.error) {
                throw new Error(response.error);
              }

              await new Promise(resolve => setTimeout(resolve, 100));
            } else {
              const base64Data = await convertFileToBase64(audioFile);

              let retryCount = 0;
              const maxRetries = 2;

              while (retryCount <= maxRetries) {
                try {
                  response = await chrome.runtime.sendMessage({
                    action: 'UPLOAD_AUDIO',
                    file: base64Data
                  });

                  if (response !== undefined) {
                    break;
                  }
                } catch (error) {
                  // Silent catch for retry logic
                }

                if (retryCount < maxRetries) {
                  await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
                  retryCount++;
                } else {
                  break;
                }
              }
            }

            if (response === undefined) {
              throw new Error(chrome.i18n.getMessage('error_uploadFailedTooLarge', [audioFile.name]));
            }

            // Validate the response has the expected structure
            if (!response.transcodedAudio) {
              throw new Error(`Upload completed but no transcoded audio returned for ${audioFile.name}`);
            }

            return { response, audioFile, index };
          },
          chunkSize,
          (completed, total) => {
            const totalProgress = completedFiles + completed;
            const percentage = Math.round((totalProgress / totalFiles) * 100);
            statusText.textContent = chrome.i18n.getMessage('status_percentComplete', [percentage.toString()]);
            progressBar.style.width = `${totalProgress / totalFiles * 70}%`;
          }
        );
        
        audioResults.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value && result.value.response) {
            // For chunked uploads, the response IS the upload result with transcodedAudio at the top level
            // For regular uploads, it's the same structure
            if (result.value.response.transcodedAudio && !result.value.response.error) {
              uploadedTracks[index] = {
                title: cleanTrackTitle(result.value.audioFile.name),
                transcodedAudio: result.value.response.transcodedAudio
              };
            } else if (result.value.response.success && result.value.response.transcodedAudio) {
              // Handle the response from chunked upload which has success: true
              uploadedTracks[index] = {
                title: cleanTrackTitle(result.value.audioFile.name),
                transcodedAudio: result.value.response.transcodedAudio
              };
            } else {
              uploadedTracks[index] = null;
            }
          } else {
            uploadedTracks[index] = null;

            let errorMessage = chrome.i18n.getMessage('label_unknown');
            if (result.status === 'rejected') {
              errorMessage = result.reason?.message || result.reason;
            } else if (result.value && result.value.response && result.value.response.error) {
              errorMessage = result.value.response.error;
            } else if (result.value && result.value.response && !result.value.response.transcodedAudio) {
              errorMessage = 'No transcoded audio in response';
            }

            console.error(`Failed to upload track ${index + 1} (${audioFiles[index]?.name}): ${errorMessage}`, {
              status: result.status,
              value: result.value,
              audioFile: audioFiles[index]?.name,
              fileSize: audioFiles[index]?.size
            });
          }
        });
        
      } else {
        // PARALLEL UPLOAD (Default strategy - fastest for < 20 audio files)
        statusText.textContent = chrome.i18n.getMessage('status_uploadingFiles');
        const isZeroBased = isZeroBasedIconNumbering(trackIcons);

        // Prepare all upload promises
        const uploadPromises = [];
        const uploadTypes = [];

        if (coverImage) {
          const coverPromise = convertFileToBase64(coverImage).then(base64 =>
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

        const iconBase64Promises = trackIcons.map(file => convertFileToBase64(file));
        const iconBase64Results = await Promise.all(iconBase64Promises);

        const iconPromises = iconBase64Results.map((base64, index) =>
          chrome.runtime.sendMessage({
            action: 'UPLOAD_ICON',
            file: base64
          }).then(response => {
            updateProgress();
            return { response, iconFile: trackIcons[index], index };
          })
        );
        uploadPromises.push(...iconPromises);
        uploadTypes.push(...Array(iconPromises.length).fill('icon'));
        
        const audioPromises = audioFiles.map((audioFile, index) =>
          (async () => {
            try {
              const fileSize = audioFile.size || audioFile.fileSize || 0;
              const MAX_SINGLE_FILE = 35 * 1024 * 1024;

              let response;

              if (fileSize > MAX_SINGLE_FILE) {

              // Get presigned URL from service worker
              const urlResult = await chrome.runtime.sendMessage({
                action: 'GET_UPLOAD_URL'
              });

              if (urlResult.error) {
                throw new Error(`Failed to get upload URL: ${urlResult.error}`);
              }

              const { uploadUrl, uploadId } = urlResult;

              // Upload directly to S3 from content script

              try {
                const s3UploadStartTime = Date.now();
                const uploadResponse = await fetch(uploadUrl, {
                  method: 'PUT',
                  body: audioFile,
                  headers: {
                    'Content-Type': audioFile.type || 'audio/mpeg'
                  }
                });

                if (!uploadResponse.ok) {
                  throw new Error(`S3 upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
                }

                // Track direct S3 upload from content script
                const uploadDuration = Date.now() - s3UploadStartTime;
                chrome.runtime.sendMessage({
                  action: 'TRACK_ANALYTICS',
                  eventName: 'upload_performance',
                  data: {
                    fileType: 'audio_direct_s3',
                    duration: uploadDuration,
                    fileSize: fileSize,
                    success: true
                  }
                });

                // Poll for transcoding completion
                let transcodedAudio = null;
                let attempts = 0;
                const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);

                // Adaptive timeout based on file size
                // Base: 60 attempts (60 seconds) for files up to 35MB
                // Add 2 attempts per MB over 35MB, up to max 600 attempts (10 minutes)
                const baseAttempts = 60;
                const additionalAttempts = fileSize > (35 * 1024 * 1024)
                    ? Math.floor((fileSize / (1024 * 1024) - 35) * 2)
                    : 0;
                const maxAttempts = Math.min(baseAttempts + additionalAttempts, 600);

                // Initial polling with exponential backoff
                let pollDelay = 500; // Start at 500ms
                const maxPollDelay = 3000; // Max 3 seconds between polls
                let totalElapsed = 0;


                while (attempts < maxAttempts && !transcodedAudio) {
                  attempts++;

                  await new Promise(resolve => setTimeout(resolve, pollDelay));
                  totalElapsed += pollDelay;

                  const transcodeResult = await chrome.runtime.sendMessage({
                    action: 'CHECK_TRANSCODE_STATUS',
                    uploadId: uploadId
                  });

                  if (transcodeResult.error) {
                    // Check for specific errors that indicate rejection
                    if (transcodeResult.error.includes('403') ||
                        transcodeResult.error.includes('forbidden') ||
                        transcodeResult.error.includes('not allowed')) {
                      throw new Error(`Upload rejected: ${transcodeResult.error}`);
                    }
                    // Check for permanent errors
                    if (transcodeResult.error.includes('404') ||
                        transcodeResult.error.includes('not found')) {
                      throw new Error(`Upload failed: ${transcodeResult.error}. Please try uploading again.`);
                    }
                    // Log other errors but continue polling
                    if (attempts % 10 === 0) {
                    }
                  } else if (transcodeResult.ready && transcodeResult.transcodedAudio) {
                    transcodedAudio = transcodeResult.transcodedAudio;
                    const elapsedSeconds = Math.round(totalElapsed / 1000);
                    break;
                  }

                  // Show progress with more realistic estimates
                  if (attempts % 10 === 0) {
                    const elapsedSeconds = Math.round(totalElapsed / 1000);
                    // More conservative estimate: 3-4 seconds per MB for large files
                    const estimatedTotal = Math.round(fileSizeMB * (fileSizeMB > 50 ? 4 : 3));
                    const percentComplete = Math.min(95, Math.round((elapsedSeconds / estimatedTotal) * 100));
                  }

                  // Exponential backoff: increase delay by 1.5x each time, up to max
                  pollDelay = Math.min(Math.floor(pollDelay * 1.5), maxPollDelay);
                }

                if (!transcodedAudio) {
                  const elapsedSeconds = Math.round(totalElapsed / 1000);
                  throw new Error(`Transcoding timeout after ${elapsedSeconds} seconds (${attempts} attempts). The file may be too large or complex.`);
                }

                response = {
                  success: true,
                  transcodedAudio: transcodedAudio,
                  uploadId: uploadId
                };

              } catch (uploadError) {
                throw new Error(`Upload failed: ${uploadError.message}`);
              }

              if (response.error) {
                throw new Error(response.error);
              }
            } else {
              const base64 = await convertFileToBase64(audioFile);

              let retryCount = 0;
              const maxRetries = 2;

              while (retryCount <= maxRetries) {
                try {
                  response = await chrome.runtime.sendMessage({
                    action: 'UPLOAD_AUDIO',
                    file: base64
                  });

                  if (response !== undefined) {
                    break;
                  }
                } catch (error) {
                }

                if (retryCount < maxRetries) {
                  await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
                  retryCount++;
                } else {
                  break;
                }
              }
            }

              if (response === undefined) {
                throw new Error(chrome.i18n.getMessage('error_uploadFailedTooLarge', [audioFile.name]));
              }

              updateProgress();
              return { response, audioFile, index };
            } catch (error) {
              throw error;
            }
          })()
        );
        uploadPromises.push(...audioPromises);
        uploadTypes.push(...Array(audioPromises.length).fill('audio'));

        // Execute all uploads in parallel
        const uploadResults = await Promise.allSettled(uploadPromises);

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
                // Use the pre-extracted number (already stored when detecting icons)
                const extractedNum = iconFile.extractedNumber || parseInt(iconFile.name.match(/\d+/)?.[0] || '1');
                // If icons are 0-based (0.png -> track 1), use extractedNumber directly
                // If icons are 1-based (1.png -> track 1), subtract 1 to get 0-based index
                const iconNumber = isZeroBased ? extractedNum : extractedNum - 1;
                uploadedIconIds[iconNumber] = response.iconId;
              } else {

              }
            } else if (type === 'audio') {
              const { response, audioFile, index: audioIndex } = value;

              if (response && !response.error && response.transcodedAudio) {
                uploadedTracks[audioIndex] = {
                  title: cleanTrackTitle(audioFile.name),
                  transcodedAudio: response.transcodedAudio
                };
              } else {
                uploadedTracks[audioIndex] = null;
              }
            }
          } else {
            if (type === 'audio') {
            } else {

            }
          }
        });
      }
      
      const validTracksWithIcons = [];
      const validIconIds = [];
      const failedTracks = [];

      uploadedTracks.forEach((track, index) => {
        if (track) {
          validTracksWithIcons.push(track);
          // Only include the icon if the corresponding track was uploaded successfully
          if (uploadedIconIds[index]) {
            validIconIds.push(uploadedIconIds[index]);
          } else {
            validIconIds.push(null); // No icon for this track
          }
        } else {
          // Track failed to upload - record it for user notification
          if (audioFiles[index]) {
            const iconFile = trackIcons[index];
            failedTracks.push({
              name: audioFiles[index].name,
              size: audioFiles[index].size,
              trackNumber: index + 1,
              audioName: audioFiles[index].name,
              audioSize: `${(audioFiles[index].size / 1024 / 1024).toFixed(1)}MB`,
              iconName: iconFile ? iconFile.name : 'N/A'
            });
          }
        }
      });

      if (validTracksWithIcons.length === 0) {
        throw new Error('No audio files were uploaded successfully');
      }

      // Notify user about any failed tracks
      if (failedTracks.length > 0) {
        const failedTrackNames = failedTracks.map(t => `${t.name} (${(t.size / 1024 / 1024).toFixed(1)}MB)`).join(', ');
        statusText.innerHTML = `
          <div style="color: #ef4444; font-weight: 500;">
            Warning: ${failedTracks.length} file(s) failed to upload: ${failedTrackNames}
          </div>
          <div style="color: #666; font-size: 12px; margin-top: 5px;">
            These files were skipped. You can upload them manually later or compress them first.
          </div>
        `;
        // Give user time to read the warning
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      statusText.textContent = chrome.i18n.getMessage('status_finalizingPlaylist');
      progressBar.style.width = '90%';

      const createResponse = await chrome.runtime.sendMessage({
        action: 'CREATE_PLAYLIST',
        title: playlistName,
        audioTracks: validTracksWithIcons,
        iconIds: validIconIds, // Pass the properly aligned icon IDs
        coverUrl: uploadedCoverUrl // Pass the cover image URL
      });
      
      if (createResponse.error) {
        throw new Error(`Failed to create playlist: ${createResponse.error}`);
      }
      
      progressBar.style.width = '100%';
      statusText.textContent = chrome.i18n.getMessage('status_importComplete');
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

      let successMessage = `<strong>"${playlistName}"</strong> has been created`;
      if (failedTracks.length > 0) {
        successMessage += `<br><span style="color: #ef4444; font-size: 14px;">Note: ${failedTracks.length} file(s) were skipped due to size limits</span>`;
      }

      successContent.innerHTML = `
          <div style="
            width: 60px;
            height: 60px;
            background: ${failedTracks.length > 0 ? '#f59e0b' : '#10b981'};
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
          <h2 style="margin: 0 0 10px 0; color: #2c3e50; font-size: 24px;">Import ${failedTracks.length > 0 ? 'Partially' : ''} Complete!</h2>
          <p style="margin: 0 0 20px 0; color: #666; font-size: 16px;">
            ${successMessage}
          </p>
          ${failedTracks.length > 0 ? `
          <div style="
            background: #fef3c7;
            border: 1px solid #fbbf24;
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 20px;
            text-align: left;
          ">
            <div style="font-weight: 500; margin-bottom: 8px; color: #92400e;">Files Skipped (upload failed):</div>
            <ul style="margin: 0; padding-left: 20px; color: #78350f; font-size: 14px;">
              ${failedTracks.map(t => `<li>${t.name} (${(t.size / 1024 / 1024).toFixed(1)}MB)</li>`).join('')}
            </ul>
            <div style="margin-top: 8px; font-size: 12px; color: #92400e;">
              These files failed to upload. They may be too large (>100MB), in an unsupported format, or the server may have timed out. Try compressing them or uploading directly in the Yoto app.
            </div>
          </div>
          ` : ''}
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
      
      if (failedTracks.length > 0) {
        const refreshDiv = successContent.querySelector('div[style*="gap: 10px"]');
        if (refreshDiv) {
          refreshDiv.innerHTML = `
            <div style="
              color: #ef4444;
              font-weight: 500;
              margin-bottom: 12px;
            ">
              ⚠️ Some files were too large to upload
            </div>
            <button id="manual-refresh-btn" style="
              padding: 10px 24px;
              background: #3b82f6;
              color: white;
              border: none;
              border-radius: 6px;
              cursor: pointer;
              font-size: 14px;
              font-weight: 500;
            ">Refresh Page</button>
          `;

          setTimeout(() => {
            const btn = document.getElementById('manual-refresh-btn');
            if (btn) {
              btn.onclick = () => {
                window.location.reload();
              };
            }
          }, 100);
        }
      } else {
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      }
      
    } catch (error) {
      const isFileSizeError = error.message && (error.message.includes('too large') && error.message.includes('MB'));

      const isPossibleSizeError = error.message && (
        error.message.includes('Unexpected response format') ||
        error.message.includes('Failed to upload audio')
      ) && audioFiles && audioFiles.some(f => f.size > 35 * 1024 * 1024); // Check if any file is > 35MB

      if (isFileSizeError || isPossibleSizeError) {
        // Extract filename from error message if present
        const fileMatch = error.message.match(/File "([^"]+)"/);
        let errorContent = '';

        if (isPossibleSizeError && !isFileSizeError) {
          const largeFiles = audioFiles.filter(f => f.size > 35 * 1024 * 1024);
          errorContent = `
            <div style="margin-bottom: 15px; color: #374151;">
              ${chrome.i18n.getMessage('error_uploadFailedLargeFiles')}
            </div>
            <ul style="margin: 0 0 15px 20px; color: #374151;">
              ${largeFiles.map(f => `<li><strong>${f.name}</strong> (${(f.size / 1024 / 1024).toFixed(1)}MB)</li>`).join('')}
            </ul>
          `;
        } else {
          const fileName = fileMatch ? fileMatch[1] : 'One or more files';
          errorContent = `
            <div style="margin-bottom: 15px; color: #374151;">
              ${chrome.i18n.getMessage('error_fileTooLarge40MB', [fileName])}
            </div>
          `;
        }

        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
          background: #fee;
          border: 1px solid #fcc;
          border-radius: 6px;
          padding: 15px;
          margin: 20px 0;
          color: #000;
        `;
        errorDiv.innerHTML = `
          <div style="font-size: 16px; font-weight: bold; margin-bottom: 10px; color: #374151;">
            File Size Limit Exceeded
          </div>
          ${errorContent}
          <div style="background: #fef3c7; border: 1px solid #fbbf24; border-radius: 4px; padding: 12px; margin-bottom: 10px;">
            <div style="font-weight: bold; margin-bottom: 8px; color: #92400e;">How to Fix:</div>
            <div style="color: #78350f; line-height: 1.6;">
              <strong>Option 1: Easy Online Tool (Free)</strong><br>
              1. Go to <a href="https://cloudconvert.com" target="_blank" style="color: #1e40af;">cloudconvert.com</a><br>
              2. Upload your MP3 files<br>
              3. Click Settings → Audio Codec: "MP3" → Bitrate: "64 kbps"<br>
              4. Convert and download the smaller files<br>
              <small style="color: #92400e;">(This reduces size by 50-75% with no noticeable quality loss for audiobooks)</small>
            </div>
          </div>
          <details style="margin-top: 10px;">
            <summary style="cursor: pointer; color: #4b5563; font-size: 14px;">More Options</summary>
            <div style="margin-top: 10px; padding: 10px; background: #f9fafb; border-radius: 4px; font-size: 13px; line-height: 1.5;">
              <strong>Desktop Software:</strong><br>
              • Mac: Music app, Audacity (free)<br>
              • Windows: VLC Media Player, Audacity (free)<br>
              <br>
              <strong>Command Line:</strong><br>
              <code style="background: #e5e7eb; padding: 4px 6px; border-radius: 3px; display: block; margin-top: 5px;">
                ffmpeg -i input.mp3 -b:a 64k output.mp3
              </code>
            </div>
          </details>
        `;

        // Replace progress area with error message
        const progressDiv = document.querySelector('#import-progress');
        if (progressDiv) {
          progressDiv.innerHTML = '';
          progressDiv.appendChild(errorDiv);
        }

        const startButton = document.querySelector('#start-import');
        if (startButton) {
          startButton.disabled = true;
          startButton.textContent = chrome.i18n.getMessage('button_startImport');
        }
      } else {
        // For other errors, show simple notification
        showNotification(chrome.i18n.getMessage('notification_importFailed', [error.message]), 'error');
      }

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

      progressDiv.innerHTML = `
        <div style="background: #fee2e2; border: 1px solid #ef4444; border-radius: 6px; padding: 12px; margin-top: 20px;">
          <p style="margin: 0; color: #991b1b; font-size: 14px;">
            <strong>Error:</strong> ${error.message}
          </p>
        </div>
      `;
      
      startButton.disabled = false;
      startButton.textContent = chrome.i18n.getMessage('button_startImport');
    }
  };
  
  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('No file provided'));
        return;
      }

      const MAX_SIZE = 2 * 1024 * 1024 * 1024; // 2GB limit (matching chunking capability)
      if (file.size > MAX_SIZE) {
        reject(new Error(`File too large: ${file.name} exceeds 2GB limit`));
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const arrayBuffer = reader.result;
          const bytes = new Uint8Array(arrayBuffer);

          // Use optimized chunked approach for large files to avoid memory issues
          const CHUNK_SIZE = 0x8000; // 32KB chunks - optimal for String.fromCharCode.apply
          let binary = '';

          for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
            const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
            binary += String.fromCharCode.apply(null, chunk);
          }

          const base64 = btoa(binary);

          // Ensure proper MIME type for images and audio
          let mimeType = file.type;
          if (!mimeType && file.name) {
            // Guess MIME type from extension if not provided
            const ext = file.name.split('.').pop().toLowerCase();
            if (ext === 'png') mimeType = 'image/png';
            else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
            else if (ext === 'gif') mimeType = 'image/gif';
            else if (ext === 'mp3') mimeType = 'audio/mpeg';
            else if (ext === 'm4a' || ext === 'm4b') mimeType = 'audio/mp4';
            else if (ext === 'wav') mimeType = 'audio/wav';
          }

          resolve({
            data: base64,
            type: mimeType || 'application/octet-stream',
            name: file.name
          });
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = (error) => {
        reject(error);
      };
      reader.readAsArrayBuffer(file);
    });
  }
  
  // Prevent content area clicks from bubbling up
  content.onclick = (e) => {
    e.stopPropagation();
  };
}

function checkForAuthReturn() {
  const urlParams = new URLSearchParams(window.location.search);
  const authSuccess = urlParams.get('auth_success');
  
  if (authSuccess === 'true') {
    // Clean up URL
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, '', cleanUrl);
    
    showNotification(chrome.i18n.getMessage('notification_authSuccessImport'), 'success');
    
    state.authenticated = true;
  }
}

injectStyles();
checkForAuthReturn();
init();
// Content script loaded


// Configuration
const CONFIG = {
  CHECK_INTERVAL: 1000, // Check for MYO elements every second
  DEBOUNCE_DELAY: 500,
  SELECTORS: {
    // Updated selectors based on actual Yoto website structure
    // Page detection
    ADD_PLAYLIST_PAGE: 'h2:has-text("Add a playlist")',
    MY_PLAYLISTS_PAGE: 'h1:has-text("My playlists")',
    
    // Button containers where we'll inject our UI
    BUTTON_ROW: '.flex.gap-2', // Container with existing buttons like "Icons & Titles"
    ACTION_BUTTONS: 'button:has-text("Icons & Titles"), button:has-text("Download")',
    
    // Playlist elements
    PLAYLIST_NAME_INPUT: 'input[placeholder="Playlist name"]',
    PLAYLIST_DESCRIPTION: 'textarea[placeholder*="maximum 500 characters"]',
    ARTWORK_SECTION: '.flex.flex-col:has(img[alt*="artwork"])',
    
    // Audio/Track elements  
    ADD_AUDIO_BUTTON: 'button:has-text("Add audio")',
    ADD_STREAM_BUTTON: 'button:has-text("Add stream")',
    TRACK_CONTAINER: '.space-y-2:has(button:has-text("Add audio"))',
    
    // My Playlists page specific
    PLAYLISTS_TOOLBAR: '.flex.items-center.justify-between',
    PLAYLIST_CARD: '.rounded-lg.shadow',
    SORT_BUTTON: 'button:has-text("Sort Playlists")',
    
    // MYO Studio buttons (to detect and position relative to)
    MYO_STUDIO_BUTTONS: 'button:has-text("MYO Magic"), button:has-text("Import"), button:has-text("Actions")',
    COFFEE_BUTTON: 'button:has-text("Say thanks with a Coffee")'
  }
};

// State
let state = {
  isMyoPage: false,
  authenticated: false,
  tracks: [],
  observer: null,
  injectedUI: false
};

// Initialize - simplified approach
function init() {
  console.log('[Yoto MYO Magic] Extension loaded on:', window.location.pathname);
  
  // Check auth status
  chrome.runtime.sendMessage({ action: 'CHECK_AUTH' }).then(response => {
    state.authenticated = response.authenticated;
  });
  
  // Simple delay then check for MYO page
  setTimeout(() => {
    checkForMyoPage();
    setupObserver();
  }, 1000);
  
  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener(handleMessage);
  
  // Listen for auth status updates
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'AUTH_STATUS') {
      state.authenticated = request.authenticated;
      updateButtonIcon(request.authenticated);
      
      if (request.authenticated && state.isMyoPage) {
        showNotification('Authentication successful! You can now use icon matching.', 'success');
      }
    }
  });
}

// Check if current page is a MYO editing page
function checkForMyoPage() {
  const url = window.location.href;
  const path = window.location.pathname;
  
  // Check if we're on my.yotoplay.com
  if (!url.includes('my.yotoplay.com')) {
    return;
  }
  
  // Determine page type
  if (path.includes('/my-cards/playlists')) {
    console.log('[Yoto MYO Magic] Playlists page detected - setting up Import Playlist button...');
    state.isMyoPage = true;
    state.pageType = 'my-playlists';
    waitForMyoElements();
  } else if (path.includes('/card/') && path.includes('/edit')) {
    state.isMyoPage = true;
    state.pageType = 'edit-card';
    // For edit pages, we need to inject the Icon Match button using content-simple.js
    // That's handled by the service worker
  }
}

// Wait for MYO elements to appear - simplified approach
function waitForMyoElements() {
  // For playlists page, use simple retry logic like Icon Match button
  if (window.location.pathname.includes('/my-cards/playlists')) {
    // Simple retry pattern - matches the working Icon Match approach
    const attempts = [500, 2000, 4000];
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

// Simple injection function using "My playlists" heading as reliable anchor point
function checkAndInjectImportButton() {
  // Don't inject if already exists
  if (document.querySelector('#yoto-import-btn') || document.querySelector('#yoto-import-container')) {
    return;
  }
  
  // Primary approach: Find "My playlists" heading and position button in optimal spot below it
  const playlistsHeading = Array.from(document.querySelectorAll('h1, h2, h3')).find(el => {
    const text = el.textContent?.trim()?.toLowerCase() || '';
    return text.includes('playlist');
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
      buttonContainer.style.cssText = 'margin: 20px 0 24px 0; padding: 0;';
      buttonContainer.id = 'yoto-import-container';
      
      const importButton = createImportButton();
      buttonContainer.appendChild(importButton);
      
      // Insert after the target element (either heading or descriptive text)
      if (targetElement.nextSibling) {
        targetElement.parentNode.insertBefore(buttonContainer, targetElement.nextSibling);
      } else {
        targetElement.parentNode.appendChild(buttonContainer);
      }
      
      console.log('[Yoto MYO Magic] Import Playlist button injected successfully');
      
      return true;
    }
  }
  
  return false;
}

// These functions are no longer needed since we're not adding the Bulk Match button
// Keeping them empty to avoid breaking any references
function fallbackInject() {
  // Not used anymore
}

function findMyoContainer() {
  // Not used anymore
  return null;
}

// Initialize MYO features
function initializeMyoFeatures(container) {
  // Initialize MYO features
  
  // Extract track information
  extractTracks(container);
  
  // Inject UI elements
  if (!state.injectedUI) {
    injectUI(container);
    state.injectedUI = true;
  }
  
  // Set up track observers
  observeTracks(container);
}

// Extract track information (when on edit page with tracks)
function extractTracks(container) {
  state.tracks = [];
  
  // This will be implemented when we have access to the actual edit page
  // For now, we'll focus on button injection
  // Track extraction for edit pages
}

// Inject UI elements
function injectUI(container) {
  // Inject UI based on page type
  
  if (state.pageType === 'add-playlist') {
    injectAddPlaylistUI(container);
  } else if (state.pageType === 'my-playlists') {
    injectMyPlaylistsUI(container);
  }
  
  // Create preview overlay (hidden by default)
  if (!document.getElementById('yoto-magic-overlay')) {
    const overlay = createPreviewOverlay();
    document.body.appendChild(overlay);
  }
}

// Inject UI for Add Playlist page
function injectAddPlaylistUI(container) {
  // Find the button row with MYO Studio buttons
  const buttonRows = document.querySelectorAll('.flex.gap-2');
  
  for (const row of buttonRows) {
    // Check if this row has MYO Studio buttons
    const hasMyoStudio = row.querySelector('button')?.textContent?.includes('Icons & Titles') ||
                        row.querySelector('button')?.textContent?.includes('MYO Magic');
    
    if (hasMyoStudio && !row.querySelector('#yoto-magic-match-btn')) {
      const button = createAutoMatchButton();
      // Insert after the last button in the row
      row.appendChild(button);
      // Auto-Match button added
      break;
    }
  }
}


// Create auto-match button (Yoto-styled)
function createAutoMatchButton() {
  const button = document.createElement('button');
  button.id = 'yoto-magic-match-btn';
  button.className = 'inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500';
  button.innerHTML = `
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"></path>
    </svg>
    <span>Auto-Match Icons</span>
  `;
  
  // Add click handler
  button.addEventListener('click', handleAutoMatchClick);
  
  return button;
}

// Create import button for My Playlists page
function createImportButton() {
  const button = document.createElement('button');
  button.id = 'yoto-import-btn';
  
  // Import icon SVG
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

// Create bulk match button for My Playlists page
function createBulkMatchButton() {
  const button = document.createElement('button');
  button.id = 'yoto-magic-bulk-btn';
  
  // Match the style of other buttons on the page
  button.className = 'inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500';
  
  // Check auth state to determine icon
  const iconSvg = state.authenticated ? 
    // Magic wand icon for authenticated
    `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"></path>
    </svg>` :
    // Lock icon for not authenticated
    `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
    </svg>`;
  
  button.innerHTML = `
    ${iconSvg}
    <span>Bulk Icon Match</span>
  `;
  
  // Add click handler
  button.addEventListener('click', handleBulkMatchClick);
  
  return button;
}

// Update button icon based on auth state
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

// Create preview overlay
function createPreviewOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'yoto-magic-overlay';
  overlay.className = 'yoto-magic-overlay';
  overlay.style.cssText = `
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    z-index: 10000;
    animation: fadeIn 0.3s ease;
  `;
  
  overlay.innerHTML = `
    <div class="yoto-magic-modal" style="
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      border-radius: 12px;
      padding: 30px;
      max-width: 800px;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    ">
      <h2 style="margin: 0 0 20px 0; color: #2c3e50;">Icon Matching Preview</h2>
      <div id="yoto-magic-preview-content">
        <!-- Dynamic content will be inserted here -->
      </div>
      <div class="yoto-magic-actions" style="
        display: flex;
        gap: 12px;
        justify-content: flex-end;
        margin-top: 30px;
        padding-top: 20px;
        border-top: 1px solid #e5e7eb;
      ">
        <button id="yoto-magic-cancel" style="
          padding: 10px 20px;
          background: #f3f4f6;
          border: none;
          border-radius: 6px;
          cursor: pointer;
        ">Cancel</button>
        <button id="yoto-magic-apply" style="
          padding: 10px 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
        ">Apply Changes</button>
      </div>
    </div>
  `;
  
  // Add event listeners
  overlay.querySelector('#yoto-magic-cancel').addEventListener('click', hideOverlay);
  overlay.querySelector('#yoto-magic-apply').addEventListener('click', applyIconChanges);
  
  return overlay;
}

// Handle auto-match button click
async function handleAutoMatchClick() {
  // Auto-match clicked
  
  // Check if we're authenticated with Yoto API
  const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });
  
  if (!authResponse.authenticated) {
    // Start auth flow
    // Start authentication
    chrome.runtime.sendMessage({ action: 'START_AUTH' });
    return;
  }
  
  // Get playlist name for context
  const playlistName = document.querySelector('input[placeholder="Playlist name"]')?.value || 'Untitled Playlist';
  
  // Show loading state
  const button = document.getElementById('yoto-magic-match-btn');
  const originalContent = button.innerHTML;
  button.innerHTML = `
    <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    <span>Matching icons...</span>
  `;
  button.disabled = true;
  
  try {
    // For now, show a demo of what will happen
    // API integration placeholder
    setTimeout(() => {
      showNotification(`Icon matching for "${playlistName}" will be implemented soon!`, 'info');
      button.innerHTML = originalContent;
      button.disabled = false;
    }, 1500);
  } catch (error) {
    showNotification('Error matching icons. Please try again.', 'error');
    showNotification('Failed to match icons. Please try again.', 'error');
    button.innerHTML = originalContent;
    button.disabled = false;
  }
}

// Handle bulk match button click
async function handleBulkMatchClick() {
  
  
  // Check if we're authenticated with Yoto API
  const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });
  
  if (!authResponse.authenticated) {
    // Start auth flow
    showNotification('Please authorize the app to continue...', 'info');
    // Start authentication
    await chrome.runtime.sendMessage({ action: 'START_AUTH' });
    return;
  }
  
  // Update button icon to show we're authenticated
  state.authenticated = true;
  updateButtonIcon(true);
  
  showNotification('Fetching your cards...', 'info');
  
  // Test API by fetching cards
  const cardsResponse = await chrome.runtime.sendMessage({ action: 'GET_CARDS' });
  
  
  if (cardsResponse.error) {
    if (cardsResponse.needsAuth) {
      // Token might be expired, try again
      state.authenticated = false;
      updateButtonIcon(false);
      showNotification('Session expired. Please authorize again.', 'error');
      chrome.runtime.sendMessage({ action: 'START_AUTH' });
    } else {
      showNotification('Error fetching cards: ' + cardsResponse.error, 'error');
    }
    return;
  }
  
  if (cardsResponse.cards && cardsResponse.cards.length > 0) {
    showNotification(`Found ${cardsResponse.cards.length} cards! Feature coming soon...`, 'success');
    // Card selection UI would go here
  } else {
    showNotification('No cards found. Create a card first to use this feature.', 'info');
  }
}

// Handle import button click
async function handleImportClick() {
  // Import clicked
  
  try {
    // Check authentication first
    const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });
    // Check auth response
    
    if (!authResponse || !authResponse.authenticated) {
      showNotification('Please authenticate first. Click the extension icon.', 'info');
      // Try to start auth
      chrome.runtime.sendMessage({ action: 'START_AUTH' }).catch(err => {
        showNotification('Failed to start authentication. Please try again.', 'error');
      });
      return;
    }
    
    // Show import options
    openFolderSelector();
  } catch (error) {
    showNotification('Error occurred. Please try again.', 'error');
    // If auth check fails, still show the import options
    showNotification('Proceeding without auth check...', 'warning');
    openFolderSelector();
  }
}

// Open folder selector directly
function openFolderSelector() {
  // Show import options modal
  showImportOptionsModal();
}

// Show modal with import options
function showImportOptionsModal() {
  // Show import options
  
  // Remove any existing modal
  const existingModal = document.getElementById('yoto-import-options-modal');
  if (existingModal) existingModal.remove();
  
  // Create modal with inline styles
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
    align-items: center;
    justify-content: center;
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
  
  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// Select ZIP file
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

// Select folder
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

// Deprecated - kept for backward compatibility if needed
// Use showImportOptionsModal() instead
function showCustomFilePicker() {
  showImportOptionsModal();
}

// Process files from folder selection
async function processFolderFiles(files) {
  // Extract folder name from the first file's path
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
    // Skip Mac metadata files
    if (f.name.startsWith('._') || f.webkitRelativePath.includes('__MACOSX/')) {
      return false;
    }
    
    // Skip .DS_Store and other system files
    if (f.name === '.DS_Store' || f.name === 'Thumbs.db') {
      return false;
    }
    
    // Check if it's a media file
    const ext = f.name.split('.').pop().toLowerCase();
    return audioExtensions.includes(ext) || imageExtensions.includes(ext);
  });
  
  // Collect all audio and image files with file sizes
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
  
  // Smart audio folder detection (same logic as ZIP)
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
    // Check if filename starts with a number
    if (/^[\d\s_-]*\d+[\s_-]*\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(fileName)) {
      numericImages.push(f);
    } else {
      nonNumericImages.push(f);
    }
  });
  
  // Sort numeric images by their number
  numericImages.sort((a, b) => {
    const fileNameA = a.name.split('/').pop();
    const fileNameB = b.name.split('/').pop();
    const numA = parseInt(fileNameA.match(/\d+/)[0]);
    const numB = parseInt(fileNameB.match(/\d+/)[0]);
    return numA - numB;
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

// Process ZIP file
async function processZipFile(file) {
  try {
    // JSZip is now loaded via manifest.json
    const zip = new JSZip();
    const contents = await zip.loadAsync(file);
    
    // Extract folder name from zip filename
    let folderName = file.name.replace(/\.zip$/i, '');
    
    // Supported audio and image extensions
    const audioExtensions = ['m4a', 'mp3', 'mp4', 'm4b', 'wav', 'ogg', 'aac', 'flac'];
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
    
    // Collect all files first
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
    
    // Smart audio folder detection
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
    
    // Smart image folder detection
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
      // Natural sort that handles numbers properly
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
    
    // Intelligently separate track icons from cover images
    // Icons: small files with numeric names
    // Cover: larger file with non-numeric name
    const trackIcons = [];
    let coverImage = null;
    
    // First, separate by naming pattern and size
    const numericImages = [];
    const nonNumericImages = [];
    
    imageFiles.forEach(f => {
      // Check if filename starts with a number (allowing for 01, 1, 001, etc.)
      if (/^[\d\s_-]*\d+[\s_-]*\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(f.name)) {
        numericImages.push(f);
      } else {
        nonNumericImages.push(f);
      }
    });
    
    // Sort numeric images by their number
    numericImages.sort((a, b) => {
      const numA = parseInt(a.name.match(/\d+/)[0]);
      const numB = parseInt(b.name.match(/\d+/)[0]);
      return numA - numB;
    });
    
    // If we have numeric images, use them as track icons
    if (numericImages.length > 0) {
      trackIcons.push(...numericImages);
    }
    
    // Find cover image from non-numeric images (typically the largest one)
    if (nonNumericImages.length > 0) {
      // Pick the largest non-numeric image as the cover
      coverImage = nonNumericImages.reduce((largest, current) => {
        return (current.fileSize > largest.fileSize) ? current : largest;
      });
    }
    
    // If no non-numeric cover found but we have images, 
    // check if there's a significantly larger image that could be the cover
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
  }
}



// Show notification
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

// Show preview overlay
function showPreview(matches) {
  const overlay = document.getElementById('yoto-magic-overlay');
  const content = document.getElementById('yoto-magic-preview-content');
  
  // Generate preview content
  content.innerHTML = `
    <div class="preview-list" style="display: flex; flex-direction: column; gap: 12px;">
      ${matches.map(match => `
        <div class="preview-item" style="
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 12px;
          background: #f9fafb;
          border-radius: 8px;
        " data-track-id="${match.trackId}">
          <div class="preview-icon" style="
            width: 48px;
            height: 48px;
            background: #e5e7eb;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            ${match.suggestedIcon ? 
              `<img src="${match.suggestedIcon}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">` :
              '?'}
          </div>
          <div class="preview-details" style="flex: 1;">
            <div style="font-weight: 500; color: #2c3e50;">${match.trackTitle}</div>
            <div style="font-size: 12px; color: #94a3b8;">
              Confidence: ${match.confidence}%
            </div>
          </div>
          <div class="confidence-badge" style="
            padding: 4px 8px;
            background: ${match.confidence > 80 ? '#4ade80' : match.confidence > 50 ? '#fbbf24' : '#f87171'};
            color: white;
            border-radius: 4px;
            font-size: 12px;
          ">
            ${match.confidence > 80 ? 'Excellent' : match.confidence > 50 ? 'Good' : 'Low'}
          </div>
        </div>
      `).join('')}
    </div>
  `;
  
  // Store matches for applying later
  overlay.dataset.matches = JSON.stringify(matches);
  
  // Show overlay
  overlay.style.display = 'block';
}

// Hide overlay
function hideOverlay() {
  const overlay = document.getElementById('yoto-magic-overlay');
  overlay.style.display = 'none';
}

// Apply icon changes
async function applyIconChanges() {
  
  
  const overlay = document.getElementById('yoto-magic-overlay');
  const matches = JSON.parse(overlay.dataset.matches || '[]');
  
  // Update icons via API
  // This would involve calling the Yoto API through the background script
  
  alert('Icon changes would be applied here (implementation pending)');
  
  hideOverlay();
  
  // Update stats
  chrome.runtime.sendMessage({
    action: 'UPDATE_STATS',
    stats: {
      iconsMatched: matches.length,
      cardsUpdated: 1
    }
  });
  
  // Track icon matching
  chrome.runtime.sendMessage({
    action: 'TRACK_EVENT',
    eventName: 'icon_match',
    parameters: {
      matchCount: matches.length,
      automated: false
    }
  });
}

// Set up mutation observer
function setupObserver() {
  if (state.observer) return;
  
  state.observer = new MutationObserver((mutations) => {
    // Check if we've navigated to a MYO page
    if (!state.isMyoPage && window.location.href.includes('/myo/')) {
      checkForMyoPage();
    }
  });
  
  state.observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Observe track changes
function observeTracks(container) {
  const trackObserver = new MutationObserver(() => {
    extractTracks(container);
  });
  
  trackObserver.observe(container, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

// Handle messages from popup/background
function handleMessage(request, sender, sendResponse) {
  switch (request.action) {
    case 'START_MATCHING':
      handleAutoMatchClick();
      sendResponse({ success: true });
      break;
      
    case 'GET_TRACKS':
      sendResponse({ tracks: state.tracks });
      break;
      
    case 'IS_MYO_PAGE':
      sendResponse({ isMyoPage: state.isMyoPage });
      break;
      
    default:
      sendResponse({ error: 'Unknown action' });
  }
  
  return true; // Keep channel open for async response
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

// Utility function for chunked parallel uploads
async function uploadInChunks(items, uploadFn, chunkSize = 5, onProgress) {
  const results = [];
  const totalItems = items.length;
  let completedItems = 0;
  
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkPromises = chunk.map((item, index) => 
      uploadFn(item, i + index).then(result => {
        completedItems++;
        if (onProgress) {
          onProgress(completedItems, totalItems);
        }
        return result;
      })
    );
    
    const chunkResults = await Promise.allSettled(chunkPromises);
    results.push(...chunkResults);
  }
  
  return results;
}

// Utility function for parallel uploads with retry
async function uploadWithRetry(uploadFn, maxRetries = 3, retryDelay = 1000) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await uploadFn();
      return { status: 'fulfilled', value: result };
    } catch (error) {
      if (attempt === maxRetries - 1) {
        return { status: 'rejected', reason: error };
      }
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
    }
  }
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
  
  // Prevent input from causing modal to close
  const nameInput = document.querySelector('#import-playlist-name');
  if (nameInput) {
    nameInput.onclick = (e) => e.stopPropagation();
    nameInput.onkeydown = (e) => e.stopPropagation();
    nameInput.onkeyup = (e) => e.stopPropagation();
    nameInput.onfocus = (e) => e.stopPropagation();
  }
  
  // Event handlers
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
      // Use chunked strategy for 20+ audio files to prevent browser overload
      const uploadStrategy = audioFiles.length >= 20 ? 'chunked' : 'parallel';
      
      
      let uploadedCoverUrl = null;
      const uploadedIconIds = [];
      const uploadedTracks = [];
      
      if (uploadStrategy === 'chunked') {
        // CHUNKED UPLOAD (For large playlists with 20+ audio files)
        statusText.textContent = 'Uploading files...';
        const chunkSize = 5; // Upload 5 files at a time
        
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
              const iconNumber = parseInt(result.value.iconFile.name.match(/\d+/)[0]) - 1;
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
              title: result.value.audioFile.name.replace(/\.[^/.]+$/, ''),
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
                const iconNumber = parseInt(iconFile.name.match(/\d+/)[0]) - 1;
                uploadedIconIds[iconNumber] = response.iconId;
              } else {
                
              }
            } else if (type === 'audio') {
              const { response, audioFile, index: audioIndex } = value;
              if (!response.error && response.transcodedAudio) {
                uploadedTracks[audioIndex] = {
                  title: audioFile.name.replace(/\.[^/.]+$/, ''),
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
      // Clear modal but keep it centered
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
        align-items: center;
        justify-content: center;
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
  
  // Close on background click only
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  };
  
  // Prevent content area clicks from bubbling up
  content.onclick = (e) => {
    e.stopPropagation();
  };
}

// Initialize the content script
injectStyles();
init();
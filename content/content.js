console.log('[Yoto Card Magic] Content script loaded at:', window.location.href);

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

// Initialize
function init() {
  console.log('[Yoto Card Magic] Initializing content script');
  
  // Check auth status first
  chrome.runtime.sendMessage({ action: 'CHECK_AUTH' }).then(response => {
    console.log('[Yoto Card Magic] Auth status:', response.authenticated);
    state.authenticated = response.authenticated;
  });
  
  // Add a small delay to ensure page is loaded
  setTimeout(() => {
    // Check if we're on a MYO page
    checkForMyoPage();
    
    // Set up mutation observer for dynamic content
    setupObserver();
  }, 1000);
  
  // Additional check specifically for the playlists page
  if (window.location.pathname.includes('/my-cards/playlists')) {
    console.log('[Yoto Card Magic] Detected playlists page, setting up additional checks');
    // Try multiple times to inject the button
    const injectAttempts = [1500, 2500, 3500, 5000];
    injectAttempts.forEach(delay => {
      setTimeout(() => {
        if (!document.querySelector('#yoto-import-btn')) {
          console.log(`[Yoto Card Magic] Retry injection at ${delay}ms`);
          injectMyPlaylistsUI(null);
        }
      }, delay);
    });
  }
  
  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener(handleMessage);
  
  // Listen for auth status updates
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'AUTH_STATUS') {
      console.log('[Yoto Card Magic] Auth status updated:', request.authenticated);
      state.authenticated = request.authenticated;
      
      // Update button icon
      updateButtonIcon(request.authenticated);
      
      // Re-check page if we just got authenticated
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
  
  console.log('[Yoto Card Magic] Checking page:', url);
  
  // Check if we're on my.yotoplay.com
  if (!url.includes('my.yotoplay.com')) {
    console.log('[Yoto Card Magic] Not on my.yotoplay.com, skipping');
    return;
  }
  
  // Determine page type
  if (path.includes('/my-cards/playlists')) {
    console.log('[Yoto Card Magic] On playlists page');
    state.isMyoPage = true;
    state.pageType = 'my-playlists';
    waitForMyoElements();
  } else if (path.includes('/card/') && path.includes('/edit')) {
    console.log('[Yoto Card Magic] On card edit page');
    state.isMyoPage = true;
    state.pageType = 'edit-card';
    // For edit pages, we need to inject the Icon Match button using content-simple.js
    // That's handled by the service worker
  } else {
    console.log('[Yoto Card Magic] Not on a relevant page');
  }
  
  console.log('[Yoto Card Magic] Page type:', state.pageType);
}

// Wait for MYO elements to appear
function waitForMyoElements() {
  // For playlists page, we only need to inject the Import button
  if (window.location.pathname.includes('/my-cards/playlists')) {
    console.log('[Yoto Card Magic] On playlists page, injecting Import button');
    // Give the page a moment to render, then inject
    setTimeout(() => {
      injectMyPlaylistsUI(null);
    }, 500);
    // Try again after a bit more time in case the page loads slowly
    setTimeout(() => {
      if (!document.querySelector('#yoto-import-btn')) {
        injectMyPlaylistsUI(null);
      }
    }, 1500);
    // No need to look for containers or do 30 attempts
    return;
  }
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
  console.log('Initializing MYO features');
  
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
  console.log('Track extraction will be implemented for edit pages');
}

// Inject UI elements
function injectUI(container) {
  console.log('Injecting UI for page type:', state.pageType);
  
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
      console.log('Added Auto-Match button to Add Playlist page');
      break;
    }
  }
}

// Inject UI for My Playlists page  
function injectMyPlaylistsUI(container) {
  // Check if we already added the Import button
  if (document.querySelector('#yoto-import-btn')) {
    return;
  }
  
  // Try multiple approaches to find the right place for the Import button
  
  // Approach 1: Find the heading "My playlists"
  const heading = Array.from(document.querySelectorAll('h1, h2, h3')).find(el => 
    el.textContent?.trim() === 'My playlists'
  );
  
  if (heading) {
    // Look for the subtitle text after the heading
    let targetElement = heading.nextElementSibling;
    while (targetElement && !targetElement.textContent?.includes('Create playlists here')) {
      targetElement = targetElement.nextElementSibling;
      if (targetElement && targetElement.querySelector('h1, h2, h3')) {
        // Stop if we hit another heading
        break;
      }
    }
    
    if (targetElement) {
      // Create a container for the Import button
      const buttonContainer = document.createElement('div');
      buttonContainer.style.cssText = 'margin-top: 20px; margin-bottom: 24px;';
      
      // Add Import button
      const importButton = createImportButton();
      buttonContainer.appendChild(importButton);
      
      // Insert after the subtitle
      if (targetElement.nextSibling) {
        targetElement.parentNode.insertBefore(buttonContainer, targetElement.nextSibling);
      } else {
        targetElement.parentNode.appendChild(buttonContainer);
      }
    } else {
      // Just place it after the heading
      const buttonContainer = document.createElement('div');
      buttonContainer.style.cssText = 'margin-top: 20px; margin-bottom: 24px;';
      
      const importButton = createImportButton();
      buttonContainer.appendChild(importButton);
      
      if (heading.nextSibling) {
        heading.parentNode.insertBefore(buttonContainer, heading.nextSibling);
      } else {
        heading.parentNode.appendChild(buttonContainer);
      }
    }
  } else {
    // Approach 2: Find the first playlist card and insert before it
    // Look for the "Add Playlist" card or the container with playlist cards
    const addPlaylistCard = document.querySelector('[href*="/card/new"]')?.closest('div');
    const playlistGrid = addPlaylistCard?.parentElement;
    
    if (playlistGrid) {
      const buttonContainer = document.createElement('div');
      buttonContainer.style.cssText = 'margin-bottom: 24px;';
      
      const importButton = createImportButton();
      buttonContainer.appendChild(importButton);
      
      playlistGrid.parentNode.insertBefore(buttonContainer, playlistGrid);
    }
  }
  
  // We're not adding the Bulk Match button anymore - it wasn't working properly
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
    background-color: #3b82f6;
    color: #ffffff;
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
    button.style.backgroundColor = '#2563eb';
    button.style.borderColor = '#2563eb';
    button.style.transform = 'translateY(-1px)';
  };
  
  button.onmouseleave = () => {
    button.style.backgroundColor = '#3b82f6';
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
  console.log('[Yoto Card Magic] Auto-match clicked');
  
  // Check if we're authenticated with Yoto API
  const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });
  
  if (!authResponse.authenticated) {
    console.log('[Yoto Card Magic] Not authenticated, starting auth flow');
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
    // TODO: Implement actual API integration
    setTimeout(() => {
      showNotification(`Icon matching for "${playlistName}" will be implemented soon!`, 'info');
      button.innerHTML = originalContent;
      button.disabled = false;
    }, 1500);
  } catch (error) {
    console.error('Matching error:', error);
    showNotification('Failed to match icons. Please try again.', 'error');
    button.innerHTML = originalContent;
    button.disabled = false;
  }
}

// Handle bulk match button click
async function handleBulkMatchClick() {
  console.log('[Yoto Card Magic] Bulk match clicked');
  
  // Check if we're authenticated with Yoto API
  const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });
  
  if (!authResponse.authenticated) {
    console.log('[Yoto Card Magic] Not authenticated, starting auth flow');
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
  console.log('[Yoto Card Magic] Cards response:', cardsResponse);
  
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
    // TODO: Show card selection UI
  } else {
    showNotification('No cards found. Create a card first to use this feature.', 'info');
  }
}

// Handle import button click
async function handleImportClick() {
  console.log('[Yoto Card Magic] Import clicked');
  
  // Check authentication first
  const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });
  if (!authResponse.authenticated) {
    showNotification('Authorizing...', 'info');
    chrome.runtime.sendMessage({ action: 'START_AUTH' });
    return;
  }
  
  // Show a simple import modal first, before file selection
  showImportStartModal();
}

// Show initial import modal
function showImportStartModal() {
  // Remove existing modal if any
  const existing = document.querySelector('#yoto-import-start-modal');
  if (existing) existing.remove();
  
  const modal = document.createElement('div');
  modal.id = 'yoto-import-start-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    z-index: 10000;
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
    max-width: 500px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  `;
  
  content.innerHTML = `
    <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">Import Playlist</h2>
    <div style="margin-bottom: 20px; color: #666;">
      <p>Select a folder with the following structure:</p>
      <ul style="margin: 10px 0; padding-left: 20px; font-size: 14px;">
        <li><strong>audio_files/</strong> - Your audio files (MP3, M4A, etc.)</li>
        <li><strong>images/</strong> - Track icons (1.png, 2.png, etc.)</li>
      </ul>
    </div>
    <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 30px;">
      <button id="cancel-import-start" style="
        padding: 10px 20px;
        background: #f3f4f6;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">Cancel</button>
      <button id="select-folder" style="
        padding: 10px 20px;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">Select Folder</button>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  // Event handlers
  document.querySelector('#cancel-import-start').onclick = () => modal.remove();
  
  document.querySelector('#select-folder').onclick = () => {
    // Create file input for folder selection
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.directory = true;
    input.multiple = true;
    input.style.display = 'none'; // Hide the input
    
    // Add to document temporarily
    document.body.appendChild(input);
    
    // Set up the change handler BEFORE triggering click
    input.addEventListener('change', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Get files immediately
      const files = e.target.files ? Array.from(e.target.files) : [];
      
      // Remove the input element
      input.remove();
      
      if (files.length === 0) {
        // User cancelled - don't close the modal
        return;
      }
      
      // Close the start modal only after we have files
      if (modal && modal.parentNode) {
        modal.remove();
      }
      
      // Sort files into audio and images
      const audioFiles = files.filter(f => 
        /\.(m4a|mp3|wav|ogg|aac)$/i.test(f.name) && f.webkitRelativePath.includes('/audio_files/')
      ).sort((a, b) => a.name.localeCompare(b.name));
      
      const imageFiles = files.filter(f => 
        /\.(png|jpg|jpeg|gif|webp)$/i.test(f.name) && f.webkitRelativePath.includes('/images/')
      );
      
      // Separate track icons (numeric names) from cover images
      const trackIcons = imageFiles.filter(f => /^\d+\.(png|jpg|jpeg)$/i.test(f.name.split('/').pop()))
        .sort((a, b) => {
          const numA = parseInt(a.name.match(/\d+/)[0]);
          const numB = parseInt(b.name.match(/\d+/)[0]);
          return numA - numB;
        });
      
      const coverImage = imageFiles.find(f => !/^\d+\.(png|jpg|jpeg)$/i.test(f.name.split('/').pop()));
      
      if (audioFiles.length === 0) {
        showNotification('No audio files found in audio_files folder', 'error');
        return;
      }
      
      // Show import modal with the files - add small delay to ensure clean transition
      setTimeout(() => {
        showImportModal(audioFiles, trackIcons, coverImage);
      }, 100);
    });
    
    // Trigger the file picker after a small delay to ensure event handlers are set
    setTimeout(() => {
      input.click();
    }, 50);
  };
  
  // Close on background click
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  };
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
  console.log('Applying icon changes');
  
  const overlay = document.getElementById('yoto-magic-overlay');
  const matches = JSON.parse(overlay.dataset.matches || '[]');
  
  // TODO: Implement actual API calls to update icons
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

// Show import modal
function showImportModal(audioFiles, trackIcons, coverImage) {
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
      <input type="text" id="import-playlist-name" value="Imported Playlist" style="
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
      const uploadedTracks = [];
      const uploadedIconIds = [];
      const totalFiles = audioFiles.length + trackIcons.length;
      let currentFile = 0;
      
      // Upload icons first (if any)
      if (trackIcons.length > 0) {
        statusText.textContent = 'Uploading track icons...';
        
        for (let i = 0; i < trackIcons.length; i++) {
          const iconFile = trackIcons[i];
          currentFile++;
          statusText.textContent = `Uploading icon ${i + 1} of ${trackIcons.length}: ${iconFile.name}`;
          progressBar.style.width = `${(currentFile / totalFiles) * 70}%`;
          
          // Convert icon to base64
          const iconBase64 = await fileToBase64(iconFile);
          
          // Upload icon via background script
          const iconResponse = await chrome.runtime.sendMessage({
            action: 'UPLOAD_ICON',
            file: iconBase64
          });
          
          if (iconResponse.error) {
            console.warn(`Failed to upload icon ${iconFile.name}: ${iconResponse.error}`);
            // Continue without this icon - use default
            uploadedIconIds[i] = null;
          } else {
            // Store the icon ID at the correct index (based on numeric filename)
            const iconNumber = parseInt(iconFile.name.match(/\d+/)[0]) - 1; // Convert to 0-based index
            uploadedIconIds[iconNumber] = iconResponse.iconId;
          }
        }
      }
      
      // Upload each audio file
      for (let i = 0; i < audioFiles.length; i++) {
        const file = audioFiles[i];
        currentFile++;
        statusText.textContent = `Uploading audio ${i + 1} of ${audioFiles.length}: ${file.name}`;
        progressBar.style.width = `${(currentFile / totalFiles) * 70}%`;
        
        // Convert file to base64
        const base64Data = await fileToBase64(file);
        
        // Upload via background script
        const uploadResponse = await chrome.runtime.sendMessage({
          action: 'UPLOAD_AUDIO',
          file: base64Data
        });
        
        if (uploadResponse.error) {
          throw new Error(`Failed to upload ${file.name}: ${uploadResponse.error}`);
        }
        
        uploadedTracks.push({
          title: file.name.replace(/\.[^/.]+$/, ''), // Remove extension
          transcodedAudio: uploadResponse.transcodedAudio
        });
      }
      
      // Create the playlist with icons
      statusText.textContent = 'Creating playlist...';
      progressBar.style.width = '90%';
      
      const createResponse = await chrome.runtime.sendMessage({
        action: 'CREATE_PLAYLIST',
        title: playlistName,
        audioTracks: uploadedTracks,
        iconIds: uploadedIconIds // Pass the uploaded icon IDs
      });
      
      if (createResponse.error) {
        throw new Error(`Failed to create playlist: ${createResponse.error}`);
      }
      
      progressBar.style.width = '100%';
      statusText.textContent = 'Import complete!';
      
      // Show success message
      modal.innerHTML = `
        <div style="
          background: white;
          border-radius: 12px;
          padding: 30px;
          max-width: 600px;
          margin: auto;
          position: relative;
          top: 50%;
          transform: translateY(-50%);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        ">
          <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">✅ Import Complete!</h2>
          <div style="margin-bottom: 20px; color: #666;">
            <p><strong>Playlist "${playlistName}" has been created!</strong></p>
            <p style="margin-top: 15px;">Successfully uploaded:</p>
            <ul style="margin: 10px 0; padding-left: 20px;">
              <li>${audioFiles.length} audio file${audioFiles.length !== 1 ? 's' : ''}</li>
              ${trackIcons.length > 0 ? `<li>${trackIcons.length} track icon${trackIcons.length !== 1 ? 's' : ''}</li>` : ''}
            </ul>
            <div style="background: #d1fae5; border: 1px solid #10b981; border-radius: 6px; padding: 12px; margin-top: 20px;">
              <p style="margin: 0; color: #065f46; font-size: 14px;">
                Your playlist is now available in your Yoto library. You can link it to a Make Your Own card via the Yoto app or player.
              </p>
            </div>
          </div>
          <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 30px;">
            <button onclick="window.location.href='https://my.yotoplay.com/my-cards/playlists'" style="
              padding: 10px 20px;
              background: #f3f4f6;
              border: none;
              border-radius: 6px;
              cursor: pointer;
              font-size: 14px;
              font-weight: 500;
            ">View Playlists</button>
            <button onclick="document.querySelector('#yoto-import-modal').remove()" style="
              padding: 10px 20px;
              background: #3b82f6;
              color: white;
              border: none;
              border-radius: 6px;
              cursor: pointer;
              font-size: 14px;
              font-weight: 500;
            ">Close</button>
          </div>
        </div>
      `;
      
      showNotification('Playlist created successfully!', 'success');
      
    } catch (error) {
      console.error('Import error:', error);
      showNotification('Import failed: ' + error.message, 'error');
      
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
        resolve({
          data: base64,
          type: file.type,
          name: file.name
        });
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }
  
  // Close on background click
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  };
}

// Initialize the content script
injectStyles();
init();
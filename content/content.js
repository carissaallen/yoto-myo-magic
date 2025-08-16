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
  
  // We're on the right domain, let's inject our UI
  console.log('[Yoto Card Magic] On my.yotoplay.com, looking for injection point');
  state.isMyoPage = true;
  
  // Determine page type
  if (path.includes('/my-cards')) {
    state.pageType = 'my-playlists';
  } else if (path.includes('/card')) {
    state.pageType = 'add-playlist';
  } else {
    state.pageType = 'unknown';
  }
  
  console.log('[Yoto Card Magic] Page type:', state.pageType);
  waitForMyoElements();
}

// Wait for MYO elements to appear
function waitForMyoElements() {
  let attempts = 0;
  const maxAttempts = 30;
  
  console.log('[Yoto Card Magic] Starting to look for container...');
  
  const checkInterval = setInterval(() => {
    attempts++;
    console.log(`[Yoto Card Magic] Attempt ${attempts}/${maxAttempts}`);
    
    const container = findMyoContainer();
    
    if (container) {
      clearInterval(checkInterval);
      console.log('[Yoto Card Magic] Container found!', container);
      initializeMyoFeatures(container);
    } else if (attempts >= maxAttempts) {
      clearInterval(checkInterval);
      console.log('[Yoto Card Magic] Giving up after', maxAttempts, 'attempts');
      
      // Try one more time with a fallback approach
      fallbackInject();
    }
  }, CONFIG.CHECK_INTERVAL);
}

// Fallback injection method
function fallbackInject() {
  console.log('[Yoto Card Magic] Trying fallback injection...');
  
  // Check if button already exists
  if (document.querySelector('#yoto-magic-bulk-btn')) {
    console.log('[Yoto Card Magic] Button already exists');
    return;
  }
  
  // Find the button container with MYO Studio buttons
  const container = document.querySelector('.flex.gap-2');
  
  if (container && container.querySelector('button')) {
    const button = createBulkMatchButton();
    button.style.marginLeft = '8px';
    container.appendChild(button);
    console.log('[Yoto Card Magic] Added button to button container (fallback)');
  } else {
    // Last resort: fixed position
    const button = createBulkMatchButton();
    button.style.position = 'fixed';
    button.style.bottom = '20px';
    button.style.right = '20px';
    button.style.zIndex = '9999';
    button.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    document.body.appendChild(button);
    console.log('[Yoto Card Magic] Added floating button (fallback)');
  }
}

// Find MYO container element
function findMyoContainer() {
  console.log('Looking for container to inject button...');
  
  // First, look for MYO Studio's button container
  const sortButton = Array.from(document.querySelectorAll('button')).find(btn => 
    btn.textContent?.trim() === 'Sort Playlists'
  );
  
  if (sortButton) {
    console.log('Found Sort Playlists button, using its parent');
    // Get the parent that contains all the buttons
    let parent = sortButton.parentElement;
    
    // Walk up to find the flex container
    while (parent && !parent.classList.contains('flex')) {
      parent = parent.parentElement;
    }
    
    if (parent) {
      return parent;
    }
  }
  
  // Look for any container with multiple buttons
  const allButtons = document.querySelectorAll('button');
  console.log(`Found ${allButtons.length} buttons on page`);
  
  // Find a flex container that has buttons
  const flexContainers = document.querySelectorAll('.flex');
  for (const container of flexContainers) {
    const buttons = container.querySelectorAll('button');
    if (buttons.length >= 1) {
      // Check if any button mentions MYO Studio features
      const hasMYOButton = Array.from(buttons).some(btn => {
        const text = btn.textContent || '';
        return text.includes('Sort') || text.includes('Print') || text.includes('Filter');
      });
      
      if (hasMYOButton) {
        console.log('Found flex container with MYO Studio buttons');
        return container;
      }
    }
  }
  
  console.log('No suitable container found');
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
  console.log('Injecting UI for My Playlists/Cards page');
  
  // Check if we already added our button
  if (document.querySelector('#yoto-magic-bulk-btn')) {
    console.log('Button already exists');
    return;
  }
  
  // Simply add our button to the container
  const button = createBulkMatchButton();
  
  // If container is valid, add the button
  if (container) {
    // Add some spacing
    button.style.marginLeft = '8px';
    container.appendChild(button);
    console.log('Added Bulk Match button to container');
  } else {
    console.log('No valid container found');
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

// Initialize the content script
injectStyles();
init();
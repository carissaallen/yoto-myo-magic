console.log('Yoto Card Magic content script loaded');

// Configuration
const CONFIG = {
  CHECK_INTERVAL: 1000, // Check for MYO elements every second
  DEBOUNCE_DELAY: 500,
  SELECTORS: {
    // These selectors will need to be updated based on actual Yoto website structure
    MYO_CONTAINER: '[data-testid="myo-editor"], .myo-editor, .playlist-editor',
    TRACK_LIST: '.track-list, .playlist-tracks, [data-testid="track-list"]',
    TRACK_ITEM: '.track-item, .playlist-track, [data-testid="track"]',
    TRACK_TITLE: '.track-title, .track-name, [data-testid="track-title"]',
    TRACK_ICON: '.track-icon, .track-image, [data-testid="track-icon"]',
    EDIT_BUTTON: '.edit-button, [data-testid="edit-button"]'
  }
};

// State
let state = {
  isMyoPage: false,
  tracks: [],
  observer: null,
  injectedUI: false
};

// Initialize
function init() {
  // Check if we're on a MYO page
  checkForMyoPage();
  
  // Set up mutation observer for dynamic content
  setupObserver();
  
  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener(handleMessage);
}

// Check if current page is a MYO editing page
function checkForMyoPage() {
  const url = window.location.href;
  const isMyoUrl = url.includes('/myo/') || 
                   url.includes('/edit/') || 
                   url.includes('/playlist/') ||
                   url.includes('/card/') && url.includes('/edit');
  
  if (isMyoUrl) {
    console.log('MYO page detected');
    state.isMyoPage = true;
    waitForMyoElements();
  }
}

// Wait for MYO elements to appear
function waitForMyoElements() {
  const checkInterval = setInterval(() => {
    const container = findMyoContainer();
    
    if (container) {
      clearInterval(checkInterval);
      console.log('MYO container found');
      initializeMyoFeatures(container);
    }
  }, CONFIG.CHECK_INTERVAL);
  
  // Stop checking after 30 seconds
  setTimeout(() => clearInterval(checkInterval), 30000);
}

// Find MYO container element
function findMyoContainer() {
  // Try multiple selectors
  const selectors = CONFIG.SELECTORS.MYO_CONTAINER.split(', ');
  
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) return element;
  }
  
  // Fallback: look for common patterns
  const possibleContainers = document.querySelectorAll('[class*="myo"], [class*="playlist"], [class*="edit"]');
  for (const container of possibleContainers) {
    if (container.querySelector('[class*="track"]')) {
      return container;
    }
  }
  
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

// Extract track information
function extractTracks(container) {
  state.tracks = [];
  
  const trackElements = container.querySelectorAll(CONFIG.SELECTORS.TRACK_ITEM);
  
  trackElements.forEach((trackEl, index) => {
    const titleEl = trackEl.querySelector(CONFIG.SELECTORS.TRACK_TITLE);
    const iconEl = trackEl.querySelector(CONFIG.SELECTORS.TRACK_ICON);
    
    if (titleEl) {
      state.tracks.push({
        index: index,
        element: trackEl,
        title: titleEl.textContent.trim(),
        currentIcon: iconEl ? iconEl.src || iconEl.style.backgroundImage : null
      });
    }
  });
  
  console.log(`Found ${state.tracks.length} tracks`);
}

// Inject UI elements
function injectUI(container) {
  // Create auto-match button
  const button = createAutoMatchButton();
  
  // Find suitable location for button
  const header = container.querySelector('.header, .toolbar, [class*="header"], [class*="toolbar"]');
  const firstTrack = container.querySelector(CONFIG.SELECTORS.TRACK_ITEM);
  
  if (header) {
    header.appendChild(button);
  } else if (firstTrack) {
    container.insertBefore(button, firstTrack);
  } else {
    container.prepend(button);
  }
  
  // Create preview overlay (hidden by default)
  const overlay = createPreviewOverlay();
  document.body.appendChild(overlay);
}

// Create auto-match button
function createAutoMatchButton() {
  const button = document.createElement('button');
  button.id = 'yoto-magic-match-btn';
  button.className = 'yoto-magic-btn';
  button.innerHTML = `
    <span class="yoto-magic-icon">✨</span>
    <span>Auto-Match Icons</span>
  `;
  
  // Style the button
  button.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    margin: 10px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 2px 10px rgba(102, 126, 234, 0.3);
  `;
  
  // Add hover effect
  button.addEventListener('mouseenter', () => {
    button.style.transform = 'translateY(-2px)';
    button.style.boxShadow = '0 4px 20px rgba(102, 126, 234, 0.4)';
  });
  
  button.addEventListener('mouseleave', () => {
    button.style.transform = 'translateY(0)';
    button.style.boxShadow = '0 2px 10px rgba(102, 126, 234, 0.3)';
  });
  
  // Add click handler
  button.addEventListener('click', handleAutoMatchClick);
  
  return button;
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
  console.log('Auto-match clicked');
  
  // Check authentication
  const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });
  
  if (!authResponse.authenticated) {
    alert('Please connect your Yoto account first. Click the extension icon to get started.');
    return;
  }
  
  // Show loading state
  const button = document.getElementById('yoto-magic-match-btn');
  const originalContent = button.innerHTML;
  button.innerHTML = '<span>Matching icons...</span>';
  button.disabled = true;
  
  try {
    // Request icon matching from background
    const response = await chrome.runtime.sendMessage({
      action: 'MATCH_ICONS',
      tracks: state.tracks.map(t => ({
        id: t.index,
        title: t.title
      }))
    });
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    // Show preview
    showPreview(response.matches);
  } catch (error) {
    console.error('Matching error:', error);
    alert('Failed to match icons. Please try again.');
  } finally {
    // Restore button
    button.innerHTML = originalContent;
    button.disabled = false;
  }
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

// Initialize the content script
init();
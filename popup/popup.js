// DOM Elements
const elements = {
  statusIndicator: document.getElementById('statusIndicator'),
  authView: document.getElementById('authView'),
  mainView: document.getElementById('mainView'),
  connectingView: document.getElementById('connectingView'),
  connectBtn: document.getElementById('connectBtn'),
  optionsBtn: document.getElementById('optionsBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  currentPageInfo: document.getElementById('currentPageInfo'),
  iconsMatched: document.getElementById('iconsMatched'),
  cardsUpdated: document.getElementById('cardsUpdated'),
  recentCards: document.getElementById('recentCards'),
  userCode: document.getElementById('userCode'),
  copyCodeBtn: document.getElementById('copyCodeBtn'),
  verificationLink: document.getElementById('verificationLink')
};

// State
let currentState = {
  authenticated: false,
  currentTab: null,
  stats: {
    iconsMatched: 0,
    cardsUpdated: 0
  },
  recentCards: []
};

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Yoto MYO Magic popup initialized');
  await checkAuthStatus();
  await getCurrentTabInfo();
  await loadStats();
  setupEventListeners();
});

// Check authentication status
async function checkAuthStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });
    currentState.authenticated = response.authenticated;
    
    updateStatusIndicator(response.authenticated);
    showAppropriateView();
  } catch (error) {
    console.error('Error checking auth status:', error);
    updateStatusIndicator(false);
    showView('authView');
  }
}

// Update status indicator
function updateStatusIndicator(isConnected) {
  const statusDot = elements.statusIndicator.querySelector('.status-dot');
  const statusText = elements.statusIndicator.querySelector('.status-text');
  
  if (isConnected) {
    statusDot.classList.add('connected');
    statusDot.classList.remove('disconnected');
    statusText.textContent = 'Connected';
  } else {
    statusDot.classList.remove('connected');
    statusDot.classList.add('disconnected');
    statusText.textContent = 'Not Connected';
  }
}

// Show appropriate view based on auth status
function showAppropriateView() {
  if (currentState.authenticated) {
    showView('mainView');
  } else {
    showView('authView');
  }
}

// Show specific view
function showView(viewId) {
  // Hide all views
  document.querySelectorAll('.view').forEach(view => {
    view.style.display = 'none';
  });
  
  // Show requested view
  const view = document.getElementById(viewId);
  if (view) {
    view.style.display = 'block';
  }
}

// Get current tab information
async function getCurrentTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentState.currentTab = tab;
    
    // Check if we're on a Yoto page
    if (tab.url && (tab.url.includes('yotoplay.com') || tab.url.includes('my.yotoplay.com'))) {
      updateCurrentPageInfo(tab);
    } else {
      showNoYotoPage();
    }
  } catch (error) {
    console.error('Error getting current tab:', error);
  }
}

// Update current page info section
function updateCurrentPageInfo(tab) {
  const isMyoPage = tab.url.includes('/myo/') || 
                    tab.url.includes('/edit/') || 
                    tab.url.includes('/playlist/');
  
  if (isMyoPage) {
    elements.currentPageInfo.classList.add('active');
    elements.currentPageInfo.innerHTML = `
      <h3>MYO Card Detected!</h3>
      <p>Click below to auto-match icons for this playlist</p>
      <button class="btn btn-primary match-button" id="quickMatchBtn">
        Auto-Match Icons
      </button>
    `;
    
    // Add event listener for quick match button
    const quickMatchBtn = document.getElementById('quickMatchBtn');
    if (quickMatchBtn) {
      quickMatchBtn.addEventListener('click', handleQuickMatch);
    }
  } else {
    elements.currentPageInfo.innerHTML = `
      <h3>Yoto Website</h3>
      <p>Navigate to a MYO card to start matching icons</p>
    `;
  }
}

// Show no Yoto page message
function showNoYotoPage() {
  elements.currentPageInfo.innerHTML = `
    <p>Visit yotoplay.com and open a MYO card to start matching icons</p>
  `;
}

// Load statistics
async function loadStats() {
  try {
    const result = await chrome.storage.local.get('stats');
    if (result.stats) {
      currentState.stats = result.stats;
      updateStatsDisplay();
    }
    
    // Load recent cards
    const cardsResult = await chrome.storage.local.get('recentCards');
    if (cardsResult.recentCards) {
      currentState.recentCards = cardsResult.recentCards;
      updateRecentCardsDisplay();
    }
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

// Update stats display
function updateStatsDisplay() {
  elements.iconsMatched.textContent = currentState.stats.iconsMatched || 0;
  elements.cardsUpdated.textContent = currentState.stats.cardsUpdated || 0;
}

// Update recent cards display
function updateRecentCardsDisplay() {
  const cardsList = elements.recentCards.querySelector('.cards-list');
  
  if (currentState.recentCards.length === 0) {
    cardsList.innerHTML = `
      <div class="empty-state">
        <p>No recent cards yet</p>
      </div>
    `;
    return;
  }
  
  cardsList.innerHTML = currentState.recentCards
    .slice(0, 3) // Show only last 3 cards
    .map(card => `
      <div class="card-item" data-card-id="${card.id}">
        <div class="card-title">${card.title}</div>
        <div class="card-meta">${card.trackCount} tracks • ${card.date}</div>
      </div>
    `)
    .join('');
}

// Setup event listeners
function setupEventListeners() {
  elements.connectBtn?.addEventListener('click', handleConnect);
  elements.optionsBtn?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  elements.logoutBtn?.addEventListener('click', handleLogout);
  elements.copyCodeBtn?.addEventListener('click', handleCopyCode);
}

// Handle connect button click
async function handleConnect() {
  try {
    showView('connectingView');
    
    // Start OAuth flow
    const response = await chrome.runtime.sendMessage({ action: 'START_AUTH' });
    
    if (response.error) {
      console.error('Auth error:', response.error);
      alert('Failed to start authentication. Please try again.');
      showView('authView');
      return;
    }
    
    // Display device code
    elements.userCode.textContent = response.user_code;
    elements.verificationLink.href = response.verification_uri;
    elements.verificationLink.textContent = response.verification_uri;
    
    // Start polling for completion
    pollForAuthCompletion(response.device_code, response.interval);
  } catch (error) {
    console.error('Connect error:', error);
    alert('Connection failed. Please try again.');
    showView('authView');
  }
}

// Poll for auth completion
async function pollForAuthCompletion(deviceCode, interval) {
  const pollInterval = setInterval(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ 
        action: 'POLL_AUTH',
        deviceCode: deviceCode
      });
      
      if (response.authenticated) {
        clearInterval(pollInterval);
        currentState.authenticated = true;
        updateStatusIndicator(true);
        showView('mainView');
        
        // Show success message
        showNotification('Successfully connected to Yoto!', 'success');
      } else if (response.error) {
        clearInterval(pollInterval);
        console.error('Auth polling error:', response.error);
        showView('authView');
        showNotification('Authentication failed. Please try again.', 'error');
      }
    } catch (error) {
      clearInterval(pollInterval);
      console.error('Polling error:', error);
      showView('authView');
    }
  }, interval * 1000);
  
  // Timeout after 5 minutes
  setTimeout(() => {
    clearInterval(pollInterval);
    showView('authView');
    showNotification('Authentication timeout. Please try again.', 'error');
  }, 5 * 60 * 1000);
}

// Handle logout
async function handleLogout() {
  if (confirm('Are you sure you want to disconnect your Yoto account?')) {
    try {
      await chrome.runtime.sendMessage({ action: 'LOGOUT' });
      currentState.authenticated = false;
      updateStatusIndicator(false);
      showView('authView');
      showNotification('Successfully logged out', 'success');
    } catch (error) {
      console.error('Logout error:', error);
      showNotification('Logout failed', 'error');
    }
  }
}

// Handle copy code
function handleCopyCode() {
  const code = elements.userCode.textContent;
  navigator.clipboard.writeText(code).then(() => {
    showNotification('Code copied to clipboard!', 'success');
  }).catch(error => {
    console.error('Copy failed:', error);
    showNotification('Failed to copy code', 'error');
  });
}

// Handle quick match from current page
async function handleQuickMatch() {
  try {
    // Send message to content script to start matching
    const response = await chrome.tabs.sendMessage(currentState.currentTab.id, {
      action: 'START_MATCHING'
    });
    
    if (response.success) {
      showNotification('Icon matching started!', 'success');
      window.close(); // Close popup
    } else {
      showNotification('Failed to start matching', 'error');
    }
  } catch (error) {
    console.error('Quick match error:', error);
    showNotification('Please refresh the page and try again', 'error');
  }
}

// Show notification
function showNotification(message, type = 'info') {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    background: ${type === 'success' ? '#4ade80' : type === 'error' ? '#f87171' : '#667eea'};
    color: white;
    border-radius: 6px;
    font-size: 13px;
    z-index: 1000;
    animation: slideIn 0.3s ease;
  `;
  
  document.body.appendChild(notification);
  
  // Remove after 3 seconds
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

console.log('Popup script loaded');
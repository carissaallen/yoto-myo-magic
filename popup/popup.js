// DOM Elements
const elements = {
  statusIndicator: document.getElementById('statusIndicator'),
  mainView: document.getElementById('mainView'),
  optionsBtn: document.getElementById('optionsBtn'),
  currentPageInfo: document.getElementById('currentPageInfo'),
  iconsMatched: document.getElementById('iconsMatched'),
  cardsUpdated: document.getElementById('cardsUpdated'),
  recentCards: document.getElementById('recentCards')
};

// State
let currentState = {
  isYotoPage: false,
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
  await getCurrentTabInfo();
  await loadStats();
  setupEventListeners();
  
  // Always show main view - no auth needed
  showView('mainView');
});

// Update status indicator
function updateStatusIndicator(isOnYoto) {
  const statusDot = elements.statusIndicator.querySelector('.status-dot');
  const statusText = elements.statusIndicator.querySelector('.status-text');
  
  if (isOnYoto) {
    statusDot.classList.add('connected');
    statusDot.classList.remove('disconnected');
    statusText.textContent = 'Ready';
  } else {
    statusDot.classList.remove('connected');
    statusDot.classList.add('disconnected');
    statusText.textContent = 'Visit Yoto';
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
    if (tab.url && tab.url.includes('yotoplay.com')) {
      currentState.isYotoPage = true;
      updateStatusIndicator(true);
      showYotoPageInfo(tab);
    } else {
      currentState.isYotoPage = false;
      updateStatusIndicator(false);
      showNoYotoPage();
    }
  } catch (error) {
    console.error('Error getting tab info:', error);
  }
}

// Show Yoto page info
function showYotoPageInfo(tab) {
  let pageType = 'Yoto Page';
  let actionText = '';
  
  if (tab.url.includes('/my-cards')) {
    pageType = 'My Cards';
    actionText = 'Look for the "Bulk Icon Match" button on the page';
  } else if (tab.url.includes('/card/edit')) {
    pageType = 'Edit Card';
    actionText = 'Look for the "Auto-Match Icons" button on the page';
  } else if (tab.url.includes('/card/')) {
    pageType = 'Card Details';
    actionText = 'Edit the card to use icon matching';
  }
  
  elements.currentPageInfo.innerHTML = `
    <h3>${pageType}</h3>
    <p>${actionText}</p>
  `;
  elements.currentPageInfo.classList.add('active');
}

// Show non-Yoto page message
function showNoYotoPage() {
  elements.currentPageInfo.innerHTML = `
    <p>Visit <a href="#" id="goToYoto">my.yotoplay.com</a> to start matching icons</p>
  `;
  
  // Add click handler for the link
  document.getElementById('goToYoto')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://my.yotoplay.com/my-cards' });
  });
}

// Load statistics
async function loadStats() {
  try {
    const result = await chrome.storage.local.get('yoto_stats');
    if (result.yoto_stats) {
      currentState.stats = result.yoto_stats;
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
  elements.optionsBtn?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  // Listen for tab changes
  chrome.tabs.onActivated.addListener(() => {
    getCurrentTabInfo();
  });
  
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete') {
      getCurrentTabInfo();
    }
  });
}

// Show notification
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 3000);
}
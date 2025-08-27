const DEFAULT_SETTINGS = {
  debugMode: false
};

// DOM Elements
const elements = {
  // Auth
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  authButton: document.getElementById('authButton'),
  
  
  // Advanced
  clearCacheBtn: document.getElementById('clearCacheBtn'),
  cacheSize: document.getElementById('cacheSize'),
  debugMode: document.getElementById('debugMode'),
  
  // Data & Privacy
  resetSettingsBtn: document.getElementById('resetSettingsBtn'),
  exportBtn: document.getElementById('exportBtn'),
  importBtn: document.getElementById('importBtn'),
  importFile: document.getElementById('importFile'),
  
  
  // Other
  saveNotification: document.getElementById('saveNotification')
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  
  
  await loadSettings();
  await checkAuthStatus();
  await loadCacheInfo();
  
  setupEventListeners();
});

// Load settings from storage
async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get('settings');
    const settings = { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
    
    // Apply settings to UI
    if (elements.debugMode) {
      elements.debugMode.checked = settings.debugMode;
    }
  } catch (error) {
    
  }
}

// Save settings to storage
async function saveSettings() {
  try {
    const settings = {
      debugMode: elements.debugMode ? elements.debugMode.checked : false
    };
    
    await chrome.storage.sync.set({ settings });
    showSaveNotification();
  } catch (error) {
    
  }
}

// Check authentication status
async function checkAuthStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });
    updateAuthStatus(response.authenticated);
  } catch (error) {
    
    updateAuthStatus(false);
  }
}

// Update auth status display
function updateAuthStatus(isAuthenticated) {
  if (isAuthenticated) {
    elements.statusDot.classList.add('connected');
    elements.statusDot.classList.remove('disconnected');
    elements.statusText.textContent = 'Connected';
    elements.authButton.textContent = 'Disconnect';
  } else {
    elements.statusDot.classList.remove('connected');
    elements.statusDot.classList.add('disconnected');
    elements.statusText.textContent = 'Not Connected';
    elements.authButton.textContent = 'Connect';
  }
}


// Load cache information
async function loadCacheInfo() {
  try {
    const result = await chrome.storage.local.get('yoto_icon_cache');
    const cache = result.yoto_icon_cache || [];
    elements.cacheSize.textContent = `${cache.length} icons cached`;
  } catch (error) {
    
  }
}

// Setup event listeners
function setupEventListeners() {
  // Auth button
  elements.authButton.addEventListener('click', handleAuthToggle);
  
  // Settings changes
  if (elements.debugMode) {
    elements.debugMode.addEventListener('change', debouncedSave);
  }
  
  // Clear cache
  elements.clearCacheBtn.addEventListener('click', handleClearCache);
  
  // Reset settings
  elements.resetSettingsBtn.addEventListener('click', handleResetSettings);
  
  // Export/Import
  elements.exportBtn.addEventListener('click', handleExportSettings);
  elements.importBtn.addEventListener('click', () => elements.importFile.click());
  elements.importFile.addEventListener('change', handleImportSettings);
}

// Debounced save
const debouncedSave = debounce(saveSettings, 500);

// Debounce helper
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Handle auth toggle
async function handleAuthToggle() {
  const statusText = elements.statusText.textContent;
  
  if (statusText === 'Connected') {
    // Disconnect
    if (confirm('Are you sure you want to disconnect your Yoto account?')) {
      try {
        await chrome.runtime.sendMessage({ action: 'LOGOUT' });
        updateAuthStatus(false);
        showNotification('Successfully disconnected from Yoto');
      } catch (error) {
        
        showNotification('Failed to disconnect', 'error');
      }
    }
  } else {
    // Connect - open popup for auth flow
    chrome.action.openPopup();
  }
}

// Handle clear cache
async function handleClearCache() {
  if (confirm('This will clear all cached icons. Are you sure?')) {
    try {
      await chrome.storage.local.remove('yoto_icon_cache');
      elements.cacheSize.textContent = '0 icons cached';
      showNotification('Cache cleared successfully');
    } catch (error) {
      
      showNotification('Failed to clear cache', 'error');
    }
  }
}

// Handle reset settings
async function handleResetSettings() {
  if (confirm('This will reset all settings to defaults. Are you sure?')) {
    try {
      await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
      await loadSettings();
      showNotification('Settings reset to defaults');
    } catch (error) {
      
      showNotification('Failed to reset settings', 'error');
    }
  }
}

// Handle export settings
async function handleExportSettings() {
  try {
    const result = await chrome.storage.sync.get('settings');
    const settings = result.settings || DEFAULT_SETTINGS;
    
    const dataStr = JSON.stringify(settings, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    
    const exportLink = document.createElement('a');
    exportLink.setAttribute('href', dataUri);
    exportLink.setAttribute('download', 'yoto-card-magic-settings.json');
    document.body.appendChild(exportLink);
    exportLink.click();
    document.body.removeChild(exportLink);
    
    showNotification('Settings exported successfully');
  } catch (error) {
    
    showNotification('Failed to export settings', 'error');
  }
}

// Handle import settings
async function handleImportSettings(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  try {
    const text = await file.text();
    const settings = JSON.parse(text);
    
    // Validate settings structure
    if (typeof settings !== 'object') {
      throw new Error('Invalid settings format');
    }
    
    await chrome.storage.sync.set({ settings });
    await loadSettings();
    showNotification('Settings imported successfully');
    
    // Clear file input
    elements.importFile.value = '';
  } catch (error) {
    
    showNotification('Failed to import settings', 'error');
  }
}

// Show save notification
function showSaveNotification() {
  elements.saveNotification.classList.add('show');
  setTimeout(() => {
    elements.saveNotification.classList.remove('show');
  }, 2000);
}

// Show notification
function showNotification(message, type = 'success') {
  const notification = elements.saveNotification;
  notification.textContent = message;
  
  if (type === 'error') {
    notification.style.background = '#ef4444';
  } else {
    notification.style.background = '#1558d1';
  }
  
  notification.classList.add('show');
  setTimeout(() => {
    notification.classList.remove('show');
  }, 3000);
}


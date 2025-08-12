const DEFAULT_SETTINGS = {
  confidenceThreshold: 70,
  autoMatchEnabled: false,
  synonymsEnabled: true,
  defaultIcon: 'question',
  preferredThemes: ['animals'],
  statsEnabled: true,
  debugMode: false
};

// DOM Elements
const elements = {
  // Auth
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  authButton: document.getElementById('authButton'),
  
  // Preferences
  confidenceThreshold: document.getElementById('confidenceThreshold'),
  confidenceValue: document.getElementById('confidenceValue'),
  autoMatchEnabled: document.getElementById('autoMatchEnabled'),
  synonymsEnabled: document.getElementById('synonymsEnabled'),
  
  // Default Icons
  defaultIcon: document.getElementById('defaultIcon'),
  themeChips: document.getElementById('themeChips'),
  
  // Advanced
  clearCacheBtn: document.getElementById('clearCacheBtn'),
  cacheSize: document.getElementById('cacheSize'),
  statsEnabled: document.getElementById('statsEnabled'),
  debugMode: document.getElementById('debugMode'),
  
  // Data & Privacy
  resetSettingsBtn: document.getElementById('resetSettingsBtn'),
  exportBtn: document.getElementById('exportBtn'),
  importBtn: document.getElementById('importBtn'),
  importFile: document.getElementById('importFile'),
  
  // Stats
  totalMatched: document.getElementById('totalMatched'),
  cardsProcessed: document.getElementById('cardsProcessed'),
  averageConfidence: document.getElementById('averageConfidence'),
  timeSaved: document.getElementById('timeSaved'),
  
  // Other
  saveNotification: document.getElementById('saveNotification')
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Options page initialized');
  
  await loadSettings();
  await checkAuthStatus();
  await loadStats();
  await loadCacheInfo();
  
  setupEventListeners();
});

// Load settings from storage
async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get('settings');
    const settings = { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
    
    // Apply settings to UI
    elements.confidenceThreshold.value = settings.confidenceThreshold;
    elements.confidenceValue.textContent = `${settings.confidenceThreshold}%`;
    elements.autoMatchEnabled.checked = settings.autoMatchEnabled;
    elements.synonymsEnabled.checked = settings.synonymsEnabled;
    elements.defaultIcon.value = settings.defaultIcon;
    elements.statsEnabled.checked = settings.statsEnabled;
    elements.debugMode.checked = settings.debugMode;
    
    // Set theme chips
    const themeInputs = elements.themeChips.querySelectorAll('input[type="checkbox"]');
    themeInputs.forEach(input => {
      input.checked = settings.preferredThemes.includes(input.value);
    });
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

// Save settings to storage
async function saveSettings() {
  try {
    // Collect theme preferences
    const themeInputs = elements.themeChips.querySelectorAll('input[type="checkbox"]:checked');
    const preferredThemes = Array.from(themeInputs).map(input => input.value);
    
    const settings = {
      confidenceThreshold: parseInt(elements.confidenceThreshold.value),
      autoMatchEnabled: elements.autoMatchEnabled.checked,
      synonymsEnabled: elements.synonymsEnabled.checked,
      defaultIcon: elements.defaultIcon.value,
      preferredThemes: preferredThemes,
      statsEnabled: elements.statsEnabled.checked,
      debugMode: elements.debugMode.checked
    };
    
    await chrome.storage.sync.set({ settings });
    showSaveNotification();
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}

// Check authentication status
async function checkAuthStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });
    updateAuthStatus(response.authenticated);
  } catch (error) {
    console.error('Error checking auth status:', error);
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

// Load statistics
async function loadStats() {
  try {
    const result = await chrome.storage.local.get('stats');
    const stats = result.stats || {
      totalMatched: 0,
      cardsProcessed: 0,
      totalConfidence: 0,
      timeSaved: 0
    };
    
    elements.totalMatched.textContent = stats.totalMatched.toLocaleString();
    elements.cardsProcessed.textContent = stats.cardsProcessed.toLocaleString();
    
    const avgConfidence = stats.totalMatched > 0 
      ? Math.round(stats.totalConfidence / stats.totalMatched) 
      : 0;
    elements.averageConfidence.textContent = `${avgConfidence}%`;
    
    // Estimate time saved (30 seconds per icon)
    const minutesSaved = Math.round((stats.totalMatched * 30) / 60);
    elements.timeSaved.textContent = `${minutesSaved}m`;
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

// Load cache information
async function loadCacheInfo() {
  try {
    const result = await chrome.storage.local.get('yoto_icon_cache');
    const cache = result.yoto_icon_cache || [];
    elements.cacheSize.textContent = `${cache.length} icons cached`;
  } catch (error) {
    console.error('Error loading cache info:', error);
  }
}

// Setup event listeners
function setupEventListeners() {
  // Auth button
  elements.authButton.addEventListener('click', handleAuthToggle);
  
  // Settings changes
  elements.confidenceThreshold.addEventListener('input', (e) => {
    elements.confidenceValue.textContent = `${e.target.value}%`;
    debouncedSave();
  });
  
  elements.autoMatchEnabled.addEventListener('change', debouncedSave);
  elements.synonymsEnabled.addEventListener('change', debouncedSave);
  elements.defaultIcon.addEventListener('change', debouncedSave);
  elements.statsEnabled.addEventListener('change', debouncedSave);
  elements.debugMode.addEventListener('change', debouncedSave);
  
  // Theme chips
  const themeInputs = elements.themeChips.querySelectorAll('input[type="checkbox"]');
  themeInputs.forEach(input => {
    input.addEventListener('change', debouncedSave);
  });
  
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
        console.error('Logout error:', error);
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
      console.error('Clear cache error:', error);
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
      console.error('Reset settings error:', error);
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
    console.error('Export error:', error);
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
    console.error('Import error:', error);
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
    notification.style.background = 'linear-gradient(135deg, #f87171 0%, #ef4444 100%)';
  } else {
    notification.style.background = 'linear-gradient(135deg, #4ade80 0%, #22c55e 100%)';
  }
  
  notification.classList.add('show');
  setTimeout(() => {
    notification.classList.remove('show');
  }, 3000);
}

console.log('Options script loaded');
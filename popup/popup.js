// Initialize i18n translations
function initializeI18n() {
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const messageKey = element.getAttribute('data-i18n');
    const message = chrome.i18n.getMessage(messageKey);
    if (message) {
      element.textContent = message;
    }
  });
}

document.addEventListener('DOMContentLoaded', async function() {
  // Initialize translations first
  initializeI18n();

  const goToYotoButton = document.getElementById('go-to-yoto');
  const manageExtensionButton = document.getElementById('manage-extension');
  const signOutButton = document.getElementById('sign-out');
  const authButton = document.getElementById('auth-button');
  const authStatus = document.getElementById('auth-status');
  const authText = authStatus.querySelector('.auth-text');
  const batteryButton = document.getElementById('battery-status');
  const batteryModal = document.getElementById('battery-modal');
  const batteryContent = document.getElementById('battery-content');
  const closeModal = document.querySelector('.close-modal');

  // Check battery levels and update icon
  async function checkBatteryLevels() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'GET_BATTERY_STATUS' });

      if (response.devices && response.devices.length > 0) {
        const hasLowBattery = response.devices.some(device => {
          const batteryLevel = device.batteryLevel;
          return batteryLevel !== null && batteryLevel !== undefined && batteryLevel <= 25;
        });

        const batteryIcon = batteryButton.querySelector('.battery-icon');
        if (batteryIcon) {
          if (hasLowBattery) {
            batteryIcon.textContent = '🪫';
            batteryIcon.style.color = '';
          } else {
            batteryIcon.textContent = '🔋';
            batteryIcon.style.color = '';
          }
        }
      }
    } catch (error) {
      // Silently fail - don't interrupt the UI if battery check fails
    }
  }

  // Check authentication status
  async function checkAuthStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });

      if (response.authenticated) {
        authStatus.className = 'auth-status authenticated';
        // Show user email if available, otherwise just show authenticated
        if (response.userEmail) {
          authText.innerHTML = `${chrome.i18n.getMessage("status_authenticated")}<br><span style="font-size: 11px; opacity: 0.8;">${response.userEmail}</span>`;
        } else {
          authText.textContent = chrome.i18n.getMessage('status_authenticated');
        }
        authButton.style.display = 'none';
        signOutButton.style.display = 'block';
        batteryButton.style.display = 'block';
        checkBatteryLevels();
      } else {
        authStatus.className = 'auth-status not-authenticated';
        authText.textContent = chrome.i18n.getMessage('status_notAuthenticated');
        authButton.style.display = 'block';
        signOutButton.style.display = 'none';
        batteryButton.style.display = 'none';
      }
    } catch (error) {
      authStatus.className = 'auth-status not-authenticated';
      authText.textContent = chrome.i18n.getMessage('status_authStatusUnknown');
      authButton.style.display = 'block';
      signOutButton.style.display = 'none';
      batteryButton.style.display = 'none';
    }
  }
  
  // Initial auth check
  await checkAuthStatus();
  
  // Auth button handler
  authButton.addEventListener('click', async function() {
    authButton.disabled = true;
    authButton.textContent = chrome.i18n.getMessage('status_authenticating');

    try {
      // Request interactive authentication
      const result = await chrome.runtime.sendMessage({ action: 'START_AUTH_INTERACTIVE' });

      if (result.success) {
        await checkAuthStatus();

        // Notify content scripts about auth status change
        chrome.runtime.sendMessage({
          action: 'BROADCAST_AUTH_STATUS',
          authenticated: true
        });
      } else if (result.cancelled) {
        authButton.textContent = chrome.i18n.getMessage('popup_signIn');
        authButton.disabled = false;
      } else {
        authButton.textContent = chrome.i18n.getMessage('button_tryAgain');
        authButton.disabled = false;

        setTimeout(() => {
          authButton.textContent = chrome.i18n.getMessage('popup_signIn');
        }, 3000);
      }
    } catch (error) {
      authButton.textContent = chrome.i18n.getMessage('button_tryAgain');
      authButton.disabled = false;

      setTimeout(() => {
        authButton.textContent = chrome.i18n.getMessage('popup_signIn');
      }, 3000);
    }
  });
  
  goToYotoButton.addEventListener('click', function() {
    chrome.tabs.create({
      url: 'https://my.yotoplay.com/my-cards/playlists'
    });
    window.close();
  });
  
  manageExtensionButton.addEventListener('click', function() {
    chrome.tabs.create({
      url: 'chrome://extensions/?id=' + chrome.runtime.id
    });
    window.close();
  });

  if (signOutButton) {
    signOutButton.addEventListener('click', async function() {
      signOutButton.disabled = true;
      signOutButton.textContent = chrome.i18n.getMessage('button_signingOut');

      try {
        const result = await chrome.runtime.sendMessage({ action: 'CLEAR_AUTH' });

        if (result.success) {
          authStatus.className = 'auth-status not-authenticated';
          authText.textContent = chrome.i18n.getMessage('status_notAuthenticated');
          authButton.style.display = 'block';
          signOutButton.style.display = 'none';
          signOutButton.textContent = chrome.i18n.getMessage('popup_signOut');
          signOutButton.disabled = false;
        } else {
          signOutButton.textContent = chrome.i18n.getMessage('button_errorTryAgain');
          signOutButton.disabled = false;

          setTimeout(() => {
            signOutButton.textContent = chrome.i18n.getMessage('popup_signOut');
          }, 2000);
        }
      } catch (error) {
        signOutButton.textContent = chrome.i18n.getMessage('button_errorTryAgain');
        signOutButton.disabled = false;

        setTimeout(() => {
          signOutButton.textContent = chrome.i18n.getMessage('popup_signOut');
        }, 2000);
      }
    });
  }
  
  // Battery button handler
  if (batteryButton) {
    batteryButton.addEventListener('click', async function() {
      batteryModal.style.display = 'flex';
      batteryContent.innerHTML = `<div class="loading">${chrome.i18n.getMessage('popup_loadingDeviceInfo')}</div>`;

      try {
        const response = await chrome.runtime.sendMessage({ action: 'GET_BATTERY_STATUS' });

        if (response.error) {
          batteryContent.innerHTML = `<div class="error-message">${response.error}</div>`;
        } else if (response.devices && response.devices.length > 0) {
          const devicesByFamily = {};
          response.devices.forEach(device => {
            const family = device.deviceFamily || 'Unknown';
            if (!devicesByFamily[family]) {
              devicesByFamily[family] = [];
            }
            devicesByFamily[family].push(device);
          });

          let html = '';

          const familyDisplayNames = {
            'v2': chrome.i18n.getMessage('device_yotoPlayerV2'),
            'v3': chrome.i18n.getMessage('device_yotoPlayerV3'),
            'mini': chrome.i18n.getMessage('device_yotoMini'),
            'Unknown': chrome.i18n.getMessage('device_otherDevices')
          };

          Object.keys(devicesByFamily).sort().forEach(family => {
            const displayName = familyDisplayNames[family] || family;

            if (Object.keys(devicesByFamily).length > 1) {
              html += `<div class="device-family-group">
                <div class="device-family-header">${displayName}</div>`;
            }

            devicesByFamily[family].forEach(device => {
              const batteryLevel = device.batteryLevel || 0;
              const isCharging = device.isCharging || false;
              const isOnline = device.isOnline !== false;

              let batteryClass = 'high';
              if (batteryLevel < 30) batteryClass = 'low';
              else if (batteryLevel < 60) batteryClass = 'medium';

              html += `
                <div class="device-item">
                  <div class="device-name">${device.name || chrome.i18n.getMessage('device_unknownDevice')}</div>
                  <div class="battery-info">
                    <div class="battery-bar">
                      <div class="battery-fill ${batteryClass}" style="width: ${batteryLevel}%"></div>
                    </div>
                    <span class="battery-percent">${batteryLevel}%</span>
                  </div>
                  <div class="device-status">
                    ${isCharging ? `<span class="status-item charging-indicator">⚡ ${chrome.i18n.getMessage('label_charging')}</span>` : ''}
                    ${!isOnline ? `<span class="status-item offline-indicator">• ${chrome.i18n.getMessage('label_offline')}</span>` : `<span class="status-item">• ${chrome.i18n.getMessage('label_online')}</span>`}
                  </div>
                </div>
              `;
            });

            if (Object.keys(devicesByFamily).length > 1) {
              html += `</div>`;
            }
          });

          batteryContent.innerHTML = html;

          const hasLowBattery = response.devices.some(device => {
            const batteryLevel = device.batteryLevel;
            return batteryLevel !== null && batteryLevel !== undefined && batteryLevel <= 25;
          });

          const batteryIcon = batteryButton.querySelector('.battery-icon');
          if (batteryIcon) {
            if (hasLowBattery) {
              batteryIcon.textContent = '🪫';
              batteryIcon.style.color = '';
            } else {
              batteryIcon.textContent = '🔋';
              batteryIcon.style.color = '';
            }
          }
        } else {
          batteryContent.innerHTML = `<div class="error-message">${chrome.i18n.getMessage('label_noDevicesFound')}</div>`;
        }
      } catch (error) {
        batteryContent.innerHTML = `<div class="error-message">${chrome.i18n.getMessage('label_failedToLoadDeviceInfo')}</div>`;
      }
    });
  }

  if (closeModal) {
    closeModal.addEventListener('click', function() {
      batteryModal.style.display = 'none';
    });
  }

  batteryModal.addEventListener('click', function(e) {
    if (e.target === batteryModal) {
      batteryModal.style.display = 'none';
    }
  });

  // Listen for auth status updates
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'AUTH_STATUS_CHANGED') {
      checkAuthStatus();
    }
  });
});
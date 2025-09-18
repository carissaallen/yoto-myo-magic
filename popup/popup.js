document.addEventListener('DOMContentLoaded', async function() {
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
          authText.innerHTML = `Authenticated with Yoto<br><span style="font-size: 11px; opacity: 0.8;">${response.userEmail}</span>`;
        } else {
          authText.textContent = 'Authenticated with Yoto';
        }
        authButton.style.display = 'none';
        signOutButton.style.display = 'block';
        batteryButton.style.display = 'block';
        checkBatteryLevels();
      } else {
        authStatus.className = 'auth-status not-authenticated';
        authText.textContent = 'Not authenticated';
        authButton.style.display = 'block';
        signOutButton.style.display = 'none';
        batteryButton.style.display = 'none';
      }
    } catch (error) {
      authStatus.className = 'auth-status not-authenticated';
      authText.textContent = 'Authentication status unknown';
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
    authButton.textContent = 'Authenticating...';
    
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
        authButton.textContent = 'Sign in with Yoto';
        authButton.disabled = false;
      } else {
        authButton.textContent = 'Authentication failed - Try again';
        authButton.disabled = false;
        
        setTimeout(() => {
          authButton.textContent = 'Sign in with Yoto';
        }, 3000);
      }
    } catch (error) {
      authButton.textContent = 'Error - Try again';
      authButton.disabled = false;
      
      setTimeout(() => {
        authButton.textContent = 'Sign in with Yoto';
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
      signOutButton.textContent = 'Signing out...';

      try {
        const result = await chrome.runtime.sendMessage({ action: 'CLEAR_AUTH' });

        if (result.success) {
          authStatus.className = 'auth-status not-authenticated';
          authText.textContent = 'Not authenticated';
          authButton.style.display = 'block';
          signOutButton.style.display = 'none';
          signOutButton.textContent = 'Sign Out';
          signOutButton.disabled = false;
        } else {
          signOutButton.textContent = 'Error - Try again';
          signOutButton.disabled = false;

          setTimeout(() => {
            signOutButton.textContent = 'Sign Out';
          }, 2000);
        }
      } catch (error) {
        signOutButton.textContent = 'Error - Try again';
        signOutButton.disabled = false;

        setTimeout(() => {
          signOutButton.textContent = 'Sign Out';
        }, 2000);
      }
    });
  }
  
  // Battery button handler
  if (batteryButton) {
    batteryButton.addEventListener('click', async function() {
      batteryModal.style.display = 'flex';
      batteryContent.innerHTML = '<div class="loading">Loading device information...</div>';

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
            'v2': 'Yoto Player (V2)',
            'v3': 'Yoto Player (V3)',
            'mini': 'Yoto Mini',
            'Unknown': 'Other Devices'
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
                  <div class="device-name">${device.name || 'Unknown Device'}</div>
                  <div class="battery-info">
                    <div class="battery-bar">
                      <div class="battery-fill ${batteryClass}" style="width: ${batteryLevel}%"></div>
                    </div>
                    <span class="battery-percent">${batteryLevel}%</span>
                  </div>
                  <div class="device-status">
                    ${isCharging ? '<span class="status-item charging-indicator">⚡ Charging</span>' : ''}
                    ${!isOnline ? '<span class="status-item offline-indicator">• Offline</span>' : '<span class="status-item">• Online</span>'}
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
          batteryContent.innerHTML = '<div class="error-message">No devices found. Make sure your Yoto devices are connected to your account.</div>';
        }
      } catch (error) {
        batteryContent.innerHTML = '<div class="error-message">Failed to load device information. Please try again.</div>';
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
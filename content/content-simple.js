
(function() {
'use strict';

const selectedIcons = {};
let currentMatches = [];
const iconMatchCache = new Map();
let authCached = null;
let authCacheTime = 0;
const AUTH_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function cycleIcon(trackId, direction) {
  const match = currentMatches.find(m => m.uniqueTrackId === trackId);
  if (!match || !match.iconOptions || match.iconOptions.length <= 1) return;

  const currentIndex = selectedIcons[trackId] || 0;
  let newIndex;
  
  if (direction === 'next') {
    newIndex = (currentIndex + 1) % match.iconOptions.length;
  } else {
    newIndex = currentIndex - 1 < 0 ? match.iconOptions.length - 1 : currentIndex - 1;
  }
  
  selectedIcons[trackId] = newIndex;
  const iconContainer = document.querySelector(`[data-track-id="${trackId}"] .icon-display`);
  const iconCountDisplay = document.querySelector(`[data-track-id="${trackId}"] .icon-count`);
  const iconTitleDisplay = document.querySelector(`[data-track-id="${trackId}"] .icon-title`);
  
  if (iconContainer && match.iconOptions[newIndex]) {
    const selectedIcon = match.iconOptions[newIndex];
    iconContainer.classList.add('icon-transition');
    setTimeout(() => iconContainer.classList.remove('icon-transition'), 300);
    
    if (selectedIcon.url && (selectedIcon.url.startsWith('http') || selectedIcon.url.startsWith('data:'))) {
      iconContainer.innerHTML = `<img src="${selectedIcon.url}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;" onerror="this.style.display='none'; this.parentElement.innerHTML='❌';">`;
    } else {
      iconContainer.innerHTML = '🎵';
    }
  }
  
  if (iconCountDisplay) {
    iconCountDisplay.textContent = `${newIndex + 1}/${match.iconOptions.length}`;
  }
  
  if (iconTitleDisplay && match.iconOptions[newIndex]) {
    iconTitleDisplay.textContent = match.iconOptions[newIndex].title || 'Untitled Icon';
  }
}

function showIconPreview(matches) {
  currentMatches = matches;
  
  matches.forEach((match, index) => {
    const uniqueTrackId = `${match.trackId}-${index}`;
    match.uniqueTrackId = uniqueTrackId;
    
    if (!selectedIcons[uniqueTrackId]) {
      selectedIcons[uniqueTrackId] = 0;
    }
  });

  const existingPreview = document.querySelector('#yoto-magic-preview');
  if (existingPreview) {
    existingPreview.remove();
  }
  
  const modal = document.createElement('div');
  modal.id = 'yoto-magic-preview';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    z-index: 10000;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 20vh;
    animation: fadeIn 0.3s ease;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 24px;
    max-width: 600px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  `;
  
  content.innerHTML = `
    <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">Icon Matches Found</h2>
    <div style="margin-bottom: 20px; color: #666;">
      Found potential icons for ${matches.length} track${matches.length !== 1 ? 's' : ''}
    </div>
    <div id="match-list" style="display: flex; flex-direction: column; gap: 12px;">
      ${matches.map(match => {
        const hasMultipleIcons = match.iconOptions && match.iconOptions.length > 1;
        const selectedIndex = selectedIcons[match.uniqueTrackId] || 0;
        const selectedIcon = match.iconOptions && match.iconOptions[selectedIndex];
        const hasValidIcon = selectedIcon && selectedIcon.url;
        
        return `
        <div data-track-id="${match.uniqueTrackId}" style="
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background: #f9f9f9;
          border-radius: 8px;
          border: 1px solid #e0e0e0;
        ">
          ${hasMultipleIcons ? `
          <button data-action="prev" data-track-id="${match.uniqueTrackId}" class="icon-nav-button" style="
            width: 24px;
            height: 24px;
            border: none;
            background: #e0e0e0;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
          ">‹</button>
          ` : ''}
          
          <div class="icon-display" style="
            width: 48px;
            height: 48px;
            background: ${hasValidIcon ? '#e0e0e0' : '#FFD700'};
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
          ">
            ${hasValidIcon ? 
              `<img src="${selectedIcon.url}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;" onerror="this.style.display='none'; this.parentElement.innerHTML='❌';">` :
              '🎵'}
          </div>
          
          ${hasMultipleIcons ? `
          <button data-action="next" data-track-id="${match.uniqueTrackId}" class="icon-nav-button" style="
            width: 24px;
            height: 24px;
            border: none;
            background: #e0e0e0;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
          ">›</button>
          ` : ''}
          
          <div style="flex: 1;">
            <div style="font-weight: 500; color: #2c3e50;">${match.trackTitle}</div>
            ${hasMultipleIcons ? `
            <div class="icon-count" style="font-size: 12px; color: #999; margin-top: 4px;">
              ${selectedIndex + 1}/${match.iconOptions.length} icons available
            </div>
            ` : `
            <div style="font-size: 12px; color: #999; margin-top: 4px;">
              ${match.iconOptions && match.iconOptions.length > 0 ? 'Icon found' : 'No icons found'}
            </div>
            `}
            ${selectedIcon && selectedIcon.title ? `
            <div class="icon-title" style="font-size: 11px; color: #666; margin-top: 2px;">
              Icon: ${selectedIcon.title}
            </div>
            ` : ''}
          </div>
        </div>
      `}).join('')}
    </div>
    <div style="
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
    ">
      <button id="cancel-preview" style="
        padding: 10px 20px;
        background: #f3f4f6;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
      ">Cancel</button>
      <button id="apply-icons" style="
        padding: 10px 20px;
        background: #FFD700;
        color: #000;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">Apply Icons</button>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  // Add animation styles if not present
  if (!document.querySelector('#yoto-magic-animation-style')) {
    const style = document.createElement('style');
    style.id = 'yoto-magic-animation-style';
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      @keyframes iconTransition {
        0% { transform: scale(0.8); opacity: 0.3; }
        50% { transform: scale(1.1); opacity: 0.7; }
        100% { transform: scale(1); opacity: 1; }
      }
      
      .icon-transition {
        animation: iconTransition 0.3s ease;
      }
      
      .icon-nav-button {
        transition: all 0.2s ease;
      }
      
      .icon-nav-button:hover {
        transform: scale(1.1);
      }
      
      .icon-nav-button:active {
        transform: scale(0.95);
      }
    `;
    document.head.appendChild(style);
  }
  
  // Add event listeners for navigation buttons
  const navButtons = content.querySelectorAll('.icon-nav-button');
  navButtons.forEach(button => {
    button.addEventListener('click', function() {
      const trackId = this.getAttribute('data-track-id');
      const action = this.getAttribute('data-action');
      cycleIcon(trackId, action);
    });
    
    // Add hover effects
    button.addEventListener('mouseenter', function() {
      this.style.background = '#d0d0d0';
    });
    
    button.addEventListener('mouseleave', function() {
      this.style.background = '#e0e0e0';
    });
  });

  // Add event listeners
  document.querySelector('#cancel-preview').onclick = () => {
    modal.remove();
  };
  
  document.querySelector('#apply-icons').onclick = async () => {
    
    // Disable the button while applying
    const applyButton = document.querySelector('#apply-icons');
    applyButton.disabled = true;
    applyButton.textContent = 'Applying...';
    
    try {
      // Get the card ID from the URL
      const urlMatch = window.location.href.match(/\/card\/([^\/]+)/);
      let cardId = urlMatch ? urlMatch[1] : null;
      
      // If the URL has edit at the end, remove it from cardId
      if (cardId && cardId.includes('/')) {
        cardId = cardId.split('/')[0];
      }
      
      if (cardId === '31dM9') {
        cardId = '1idN9';
      }
      
      if (!cardId) {
        alert('Could not identify card ID');
        return;
      }
      
      // Build selected icon matches based on user selection
      const selectedMatches = matches.map(match => {
        if (!match.iconOptions || match.iconOptions.length === 0) return null;
        
        const selectedIndex = selectedIcons[match.uniqueTrackId] || 0;
        const selectedIcon = match.iconOptions[selectedIndex];
        
        if (!selectedIcon || !selectedIcon.iconId) {
          return null;
        }
        
        return {
          trackId: match.trackId, // Use original trackId for the API call
          trackTitle: match.trackTitle,
          suggestedIcon: selectedIcon.url,
          iconId: selectedIcon.iconId,
          iconTitle: selectedIcon.title
        };
      }).filter(Boolean);
      
      const validMatches = selectedMatches;
      
      
      if (validMatches.length === 0) {
        alert('No valid icons to apply. Try searching for different terms or check the icon matching.');
        modal.remove();
        return;
      }
      
      
      // Send request to background script to update the card
      const response = await chrome.runtime.sendMessage({
        action: 'UPDATE_CARD_ICONS',
        cardId: cardId,
        iconMatches: validMatches
      });
      
      if (response.success) {
        
        const successDiv = document.createElement('div');
        successDiv.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: #4CAF50;
          color: white;
          padding: 12px 20px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          z-index: 10001;
          font-size: 14px;
        `;
        successDiv.textContent = `✓ Icons applied to ${validMatches.length} tracks! Refresh the page to see changes.`;
        document.body.appendChild(successDiv);
        
        setTimeout(() => {
          successDiv.remove();
        }, 3000);
        
        modal.remove();
        
        setTimeout(() => {
          showRefreshIndicator();
          setTimeout(() => {
            window.location.reload();
          }, 1000);
        }, 500);
      } else if (response.possibleSuccess) {
        
        const warningDiv = document.createElement('div');
        warningDiv.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: #FF9800;
          color: white;
          padding: 16px 24px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          z-index: 10001;
          font-size: 14px;
          max-width: 400px;
          line-height: 1.4;
        `;
        warningDiv.innerHTML = `
          <div style="font-weight: bold; margin-bottom: 8px;">⚠️ Update Status Unclear</div>
          <div style="margin-bottom: 8px;">Received a 500 error, but based on testing, your icons may have been applied successfully.</div>
          <div style="font-size: 12px; opacity: 0.9;">Please check your card to confirm the changes.</div>
        `;
        document.body.appendChild(warningDiv);
        
        setTimeout(() => {
          warningDiv.remove();
        }, 8000);
        
        modal.remove();
        
      } else {
        if (response.error && (response.error.includes('special permissions') || response.error.includes('403'))) {
          const errorDiv = document.createElement('div');
          errorDiv.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 24px;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            z-index: 10002;
            max-width: 400px;
            text-align: center;
          `;
          
          errorDiv.innerHTML = `
            <h3 style="margin: 0 0 16px 0; color: #dc3545;">Unable to Apply Icons</h3>
            <p style="color: #666; margin-bottom: 20px;">
              The Yoto API requires special permissions to update cards that we don't currently have.
            </p>
            <p style="color: #666; margin-bottom: 20px; font-size: 14px;">
              However, we found great icon matches! You can use the MYO Studio extension's 
              "Icons & Titles" feature to populate icons, or manually add them through the Yoto interface.
            </p>
            <button id="close-error" style="
              padding: 10px 24px;
              background: #FFD700;
              color: #000;
              border: none;
              border-radius: 6px;
              cursor: pointer;
              font-size: 14px;
              font-weight: 500;
            ">OK</button>
          `;
          
          document.body.appendChild(errorDiv);
          
          document.querySelector('#close-error').onclick = () => {
            errorDiv.remove();
          };
          
          modal.remove();
        } else {
          alert('Failed to apply icons: ' + (response.error || 'Unknown error'));
        }
        
        applyButton.disabled = false;
        applyButton.textContent = 'Apply Icons';
      }
    } catch (error) {
      alert('Error applying icons: ' + error.message);
      applyButton.disabled = false;
      applyButton.textContent = 'Apply Icons';
    }
  };
  
  // Close on background click
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  };
}

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
    font-size: 13px;
    font-weight: 500;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: all 0.2s ease;
    margin-left: 8px;
    white-space: nowrap;
    line-height: 1.5;
    height: 40px;
  `;
  
  button.innerHTML = `
    ${importIcon}
    <span>Import</span>
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
  
  button.onclick = async () => {
    // Import functionality will be implemented here
    handleImportClick();
  };
  
  return button;
}

function createButton() {
  const buttonContainer = document.createElement('div');
  buttonContainer.style.cssText = `
    position: relative;
    display: inline-flex;
    margin-left: 8px;
  `;
  
  const button = document.createElement('button');
  button.id = 'yoto-magic-btn';
  
  // Define the puzzle piece icon for consistency
  const puzzlePieceIcon = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M12 2L15.6 5.6C18 -0.7 24.7 6 18.4 8.4L22 12L18.4 15.6C16 9.3 9.3 16 15.6 18.4L12 22L8.4 18.4C6 24.7 -0.7 18 5.6 15.6L2 12L5.6 8.4C8 14.7 14.7 8 8.4 5.6L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
  
  const dropdownIcon = `
    <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
      <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/>
    </svg>
  `;
  
  button.style.cssText = `
    background-color: #ffffff;
    color: #3b82f6;
    border: 1px solid #3b82f6;
    padding: 8px 16px;
    border-radius: 6px 0 0 6px;
    font-size: 13px;
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
    border-right: none;
  `;
  
  const dropdownButton = document.createElement('button');
  dropdownButton.style.cssText = `
    background-color: #ffffff;
    color: #3b82f6;
    border: 1px solid #3b82f6;
    padding: 8px;
    border-radius: 0 6px 6px 0;
    font-size: 13px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    height: 40px;
    border-left: 1px solid #e5e7eb;
  `;
  
  dropdownButton.innerHTML = dropdownIcon;
  
  const dropdownMenu = document.createElement('div');
  dropdownMenu.style.cssText = `
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    display: none;
    z-index: 1000;
    min-width: 180px;
  `;
  
  const generalOption = document.createElement('button');
  generalOption.style.cssText = `
    display: block;
    width: 100%;
    padding: 10px 16px;
    text-align: left;
    background: none;
    border: none;
    font-size: 13px;
    color: #374151;
    cursor: pointer;
    transition: background-color 0.2s;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  `;
  generalOption.textContent = 'Track Title';
  generalOption.onmouseenter = () => generalOption.style.backgroundColor = '#f3f4f6';
  generalOption.onmouseleave = () => generalOption.style.backgroundColor = 'transparent';
  
  const categoryOption = document.createElement('button');
  categoryOption.style.cssText = `
    display: block;
    width: 100%;
    padding: 10px 16px;
    text-align: left;
    background: none;
    border: none;
    font-size: 13px;
    color: #374151;
    cursor: pointer;
    transition: background-color 0.2s;
    border-top: 1px solid #e5e7eb;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  `;
  categoryOption.textContent = 'Category';
  categoryOption.onmouseenter = () => categoryOption.style.backgroundColor = '#f3f4f6';
  categoryOption.onmouseleave = () => categoryOption.style.backgroundColor = 'transparent';
  
  dropdownMenu.appendChild(generalOption);
  dropdownMenu.appendChild(categoryOption);
  
  button.innerHTML = `
    ${puzzlePieceIcon}
    <span>Icon Match</span>
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
  
  dropdownButton.onmouseenter = () => {
    dropdownButton.style.backgroundColor = '#f3f4f6';
  };
  
  dropdownButton.onmouseleave = () => {
    dropdownButton.style.backgroundColor = '#ffffff';
  };
  
  dropdownButton.onclick = (e) => {
    e.stopPropagation();
    const isVisible = dropdownMenu.style.display === 'block';
    dropdownMenu.style.display = isVisible ? 'none' : 'block';
  };
  
  document.addEventListener('click', (e) => {
    if (!buttonContainer.contains(e.target)) {
      dropdownMenu.style.display = 'none';
    }
  });
  
  generalOption.onclick = async () => {
    dropdownMenu.style.display = 'none';
    await handleIconMatch('general');
  };
  
  categoryOption.onclick = async () => {
    dropdownMenu.style.display = 'none';
    await handleIconMatch('category');
  };
  
  button.onclick = async () => {
    await handleIconMatch('general');
  };
  
  buttonContainer.appendChild(button);
  buttonContainer.appendChild(dropdownButton);
  buttonContainer.appendChild(dropdownMenu);
  
  return buttonContainer;
}

async function handleIconMatch(matchType) {
  const button = document.getElementById('yoto-magic-btn');
  const puzzlePieceIcon = button.querySelector('svg').outerHTML;
  
  if (matchType === 'general') {
    // Check cached auth status first
    const now = Date.now();
    if (!authCached || now - authCacheTime > AUTH_CACHE_DURATION) {
      const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });
      authCached = authResponse.authenticated;
      authCacheTime = now;
    }
    
    if (!authCached) {
      button.innerHTML = `
        ${puzzlePieceIcon}
        <span>Authorizing...</span>
      `;
      chrome.runtime.sendMessage({ action: 'START_AUTH' });
      setTimeout(() => {
        button.innerHTML = `
          ${puzzlePieceIcon}
          <span>Icon Match</span>
        `;
        authCached = null; // Invalidate cache
      }, 2000);
    } else {
      
      button.disabled = true;
      button.innerHTML = `
        ${puzzlePieceIcon}
        <span>Fetching content...</span>
      `;
      button.style.opacity = '0.7';
      
      const urlMatch = window.location.href.match(/\/card\/([^\/]+)/);
      const cardId = urlMatch ? urlMatch[1] : null;
      
      if (!cardId) {
        alert('Could not identify card ID from URL');
        button.disabled = false;
        button.innerHTML = `
          ${puzzlePieceIcon}
          <span>Icon Match</span>
        `;
        button.style.opacity = '1';
        return;
      }
      
      const playlistNameInput = document.querySelector('input[type="text"]');
      const playlistTitle = playlistNameInput?.value || 'Untitled Playlist';
      
      const contentResponse = await chrome.runtime.sendMessage({ 
        action: 'GET_CARD_CONTENT',
        cardId: cardId
      });
      
      const tracks = [];
      
      // Handle API errors gracefully
      if (contentResponse.error) {
        if (contentResponse.error.includes('403')) {
          // Continue to DOM parsing fallback below
        } else if (contentResponse.error.includes('401')) {
          alert('Authentication required. Please refresh the page and try again.');
          button.disabled = false;
          button.innerHTML = `${puzzlePieceIcon}<span>Icon Match</span>`;
          button.style.opacity = '1';
          return;
        } else {
          console.error('[Icon Match] API error:', contentResponse.error);
          // Continue to DOM parsing fallback below
        }
      }
      
      if (!contentResponse.error && contentResponse.card) {
        
        if (contentResponse.card?.content?.chapters && contentResponse.card.content.chapters.length > 0) {
          
          contentResponse.card.content.chapters.forEach((chapter, chapterIndex) => {
            
            if (chapter.tracks && Array.isArray(chapter.tracks)) {
              chapter.tracks.forEach((track, trackIndex) => {
                if (track.title) {
                  tracks.push({
                    id: track.key || `track-${chapterIndex}-${trackIndex}`,
                    title: track.title,
                    index: tracks.length,
                    type: 'track',
                    chapterKey: chapter.key,
                    chapterTitle: chapter.title
                  });
                }
              });
            }
          });
        } else {
        }
        
        // Only use card title as fallback if we really can't find any tracks
        // This will be handled later after DOM parsing attempts
      }
      
      if (tracks.length === 0) {
        
        // Optimized single query using CSS selector groups
        const trackCandidates = document.querySelectorAll(
          'textarea[id*="chapter"][id*="title"], ' +
          'input[type="text"]:not([placeholder="Playlist name"]), ' +
          'textarea:not([placeholder*="500 characters"]), ' +
          '[contenteditable="true"]'
        );
        
        const foundTracks = new Set();
        
        // Process all candidates to find track titles
        trackCandidates.forEach((element, index) => {
          let value = '';
          let elementType = '';
          
          if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
            value = element.value?.trim();
            elementType = `${element.tagName}(${element.type || 'text'})`;
          } else {
            value = element.textContent?.trim();
            elementType = element.tagName;
          }
          
          const id = element.id || '';
          const className = element.className || '';
          
          if (!value || value.length === 0) {
            return;
          }
          
          if (value === playlistTitle) {
            return;
          }
          
          // Skip very short content (likely placeholders)
          if (value.length <= 1) {
            return;
          }
          
          // Skip very long content (probably not track titles)
          if (value.length > 100) {
            return;
          }
          
          // Skip common placeholder values
          if (value.toLowerCase() === 'x' || value.toLowerCase() === 'untitled' || value === '...') {
            return;
          }
          
          foundTracks.add(value);
        });
        
        
        Array.from(foundTracks).forEach((title, index) => {
          tracks.push({
            id: `track-${index + 1}`,
            title: title,
            index: index,
            type: 'track'
          });
        });
        
        // Last resort fallbacks - use card/playlist title only if no tracks found
        if (tracks.length === 0) {
          if (contentResponse.card?.title && contentResponse.card.title !== 'Untitled Playlist') {
            console.warn('[Icon Match] No individual tracks found, falling back to card title:', contentResponse.card.title);
            tracks.push({
              id: 'card-title',
              title: contentResponse.card.title,
              index: 0,
              type: 'card'
            });
          } else if (playlistTitle && playlistTitle !== 'Untitled Playlist') {
            console.warn('[Icon Match] No individual tracks found, falling back to playlist title:', playlistTitle);
            tracks.push({
              id: 'playlist-title', 
              title: playlistTitle,
              index: 0,
              type: 'playlist'
            });
          }
        }
      }
      
      if (tracks.length === 0) {
        alert('No tracks found in this card. Please add some tracks first.');
        button.disabled = false;
        button.innerHTML = `
          ${puzzlePieceIcon}
          <span>Icon Match</span>
        `;
        button.style.opacity = '1';
        return;
      }
      
      button.innerHTML = `
        <svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25" stroke-width="4"/>
          <path d="M12 2a10 10 0 0 1 0 20" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
        </svg>
        <span>Matching ${tracks.length} tracks...</span>
      `;
      
      if (!document.querySelector('#yoto-magic-spinner-style')) {
        const style = document.createElement('style');
        style.id = 'yoto-magic-spinner-style';
        style.textContent = `
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          .animate-spin {
            animation: spin 1s linear infinite;
          }
        `;
        document.head.appendChild(style);
      }
      
      try {
        // Check cache first
        const cacheKey = JSON.stringify(tracks.map(t => t.title));
        let response;
        
        if (iconMatchCache.has(cacheKey)) {
          response = iconMatchCache.get(cacheKey);
        } else {
          response = await chrome.runtime.sendMessage({ 
            action: 'MATCH_ICONS',
            tracks: tracks
          });
          
          // Cache successful responses
          if (response.matches && response.matches.length > 0) {
            iconMatchCache.set(cacheKey, response);
            // Clear old cache entries if too many
            if (iconMatchCache.size > 10) {
              const firstKey = iconMatchCache.keys().next().value;
              iconMatchCache.delete(firstKey);
            }
          }
        }
        
        if (response.matches && response.matches.length > 0) {
          showIconPreview(response.matches);
        } else {
          alert('No icon matches found. Try adding more descriptive track titles.');
        }
      } catch (error) {
        alert('Error matching icons. Please try again.');
      }
      
      button.disabled = false;
      button.innerHTML = `
        ${puzzlePieceIcon}
        <span>Icon Match</span>
      `;
      button.style.opacity = '1';
    }
  } else if (matchType === 'category') {
    // Handle category match
    await handleCategoryIconMatch();
  }
}

function checkAndInjectButton() {
  if (document.querySelector('#yoto-magic-btn')) {
    return;
  }
  
  const addAudioButton = Array.from(document.querySelectorAll('button')).find(btn => 
    btn.textContent?.trim() === 'Add audio'
  );
  
  if (addAudioButton) {
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'flex gap-2 mt-2';
    
    // Only add Icon Match button on edit page
    const button = createButton();
    buttonContainer.appendChild(button);
    
    if (addAudioButton.nextSibling) {
      addAudioButton.parentNode.insertBefore(buttonContainer, addAudioButton.nextSibling);
    } else {
      addAudioButton.parentNode.appendChild(buttonContainer);
    }
    
  } else {
    const addStreamButton = Array.from(document.querySelectorAll('button')).find(btn => 
      btn.textContent?.trim() === 'Add stream'
    );
    
    if (addStreamButton && addStreamButton.parentNode) {
      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'flex gap-2 mt-4';
      
      // Only add Icon Match button on edit page
      const button = createButton();
      buttonContainer.appendChild(button);
      
      const buttonsParent = addStreamButton.parentNode;
      if (buttonsParent.nextSibling) {
        buttonsParent.parentNode.insertBefore(buttonContainer, buttonsParent.nextSibling);
      } else {
        buttonsParent.parentNode.appendChild(buttonContainer);
      }
    }
  }
}

function initialize() {
  if (document.querySelector('#yoto-magic-btn')) return;
  
  const attempts = [500, 2000, 4000];
  attempts.forEach((delay) => {
    setTimeout(() => {
      if (!document.querySelector('#yoto-magic-btn')) {
        checkAndInjectButton();
      }
    }, delay);
  });
}

let currentUrl = location.href;
const urlCheckInterval = setInterval(() => {
  const newUrl = location.href;
  if (newUrl !== currentUrl) {
    currentUrl = newUrl;
    if (!newUrl.includes('/edit')) {
      cleanup();
    }
  }
}, 500);

function cleanup() {
  if (urlCheckInterval) {
    clearInterval(urlCheckInterval);
  }
  
  try {
    const elements = [
      '#yoto-magic-btn',
      '#yoto-magic-preview', 
      '#yoto-refresh-indicator',
      '#yoto-magic-animation-style',
      '#yoto-magic-spinner-style',
      '#yoto-refresh-styles'
    ];
    
    elements.forEach(selector => {
      const element = document.querySelector(selector);
      if (element) {
        if (selector === '#yoto-magic-btn' && element.parentElement) {
          element.parentElement.remove();
        } else {
          element.remove();
        }
      }
    });
    
    // Also clean up the import button
    const importBtn = document.querySelector('#yoto-import-btn');
    if (importBtn && importBtn.parentElement) {
      importBtn.parentElement.remove();
    }
  } catch (error) {
    // Ignore cleanup errors
  }
}

// Import functionality
async function handleImportClick() {
  const button = document.querySelector('#yoto-import-btn');
  const originalContent = button.innerHTML;
  
  // Check authentication first
  const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });
  if (!authResponse.authenticated) {
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>Authorizing...</span>
    `;
    chrome.runtime.sendMessage({ action: 'START_AUTH' });
    setTimeout(() => {
      button.innerHTML = originalContent;
    }, 2000);
    return;
  }
  
  // Create file input for folder selection
  const input = document.createElement('input');
  input.type = 'file';
  input.webkitdirectory = true;
  input.directory = true;
  input.multiple = true;
  
  input.onchange = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    // Extract folder name from the first file's path
    let folderName = 'Imported Playlist';
    if (files[0] && files[0].webkitRelativePath) {
      const pathParts = files[0].webkitRelativePath.split('/');
      if (pathParts.length > 0) {
        folderName = pathParts[0]; // Get the root folder name
      }
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
    
    // Find cover image (non-numeric filename)
    const coverImage = imageFiles.find(f => !/^\d+\.(png|jpg|jpeg|gif|webp)$/i.test(f.name.split('/').pop()));
    
    if (audioFiles.length === 0) {
      alert('No audio files found in audio_files folder');
      return;
    }
    
    // Show import modal
    showImportModal(audioFiles, trackIcons, coverImage, folderName);
  };
  
  input.click();
}

function showImportModal(audioFiles, trackIcons, coverImage, defaultName = 'Imported Playlist') {
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
    z-index: 10000;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 20vh;
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
  
  // Prevent content area clicks from bubbling up
  content.onclick = (e) => {
    e.stopPropagation();
  };
  
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
      // Get current card ID from URL (optional - only if editing existing card)
      const urlMatch = window.location.href.match(/\/card\/([^\/]+)/);
      let cardId = urlMatch ? urlMatch[1] : null;
      
      // Clean up cardId - remove /edit if present
      if (cardId && cardId.includes('/')) {
        cardId = cardId.split('/')[0];
      }
      
      // Step 1: Upload cover image (if any)
      let coverUrl = null;
      if (coverImage) {
        statusText.textContent = 'Uploading cover image...';
        progressBar.style.width = '5%';
        
        try {
          const coverBase64 = await fileToBase64(coverImage);
          const coverResponse = await chrome.runtime.sendMessage({
            action: 'UPLOAD_COVER',
            file: coverBase64
          });
          
          if (coverResponse.url) {
            coverUrl = coverResponse.url;
          }
        } catch (error) {
          console.warn('Error uploading cover:', error);
        }
      }
      
      // Step 2: Upload icons in parallel batches
      statusText.textContent = 'Uploading icons...';
      progressBar.style.width = '10%';
      
      const iconIds = [];
      const BATCH_SIZE = 3; // Upload 3 icons at a time
      
      for (let i = 0; i < trackIcons.length; i += BATCH_SIZE) {
        const batch = trackIcons.slice(i, Math.min(i + BATCH_SIZE, trackIcons.length));
        statusText.textContent = `Uploading icons ${i + 1}-${Math.min(i + BATCH_SIZE, trackIcons.length)} of ${trackIcons.length}...`;
        
        const batchPromises = batch.map(async (iconFile, batchIndex) => {
          try {
            const response = await chrome.runtime.sendMessage({
              action: 'UPLOAD_ICON',
              file: await fileToBase64(iconFile)
            });
            
            if (response.success && response.iconId) {
              return { index: i + batchIndex, iconId: response.iconId };
            }
            return null;
          } catch (error) {
            console.error(`Failed to upload icon ${i + batchIndex + 1}:`, error);
            return null;
          }
        });
        
        const results = await Promise.all(batchPromises);
        results.forEach(result => {
          if (result) {
            iconIds[result.index] = result.iconId;
          }
        });
        
        progressBar.style.width = `${10 + (30 * Math.min(i + BATCH_SIZE, trackIcons.length) / trackIcons.length)}%`;
      }
      
      // Step 2: Upload and transcode audio files
      statusText.textContent = 'Uploading audio files...';
      progressBar.style.width = '40%';
      
      const audioTracks = [];
      for (let i = 0; i < audioFiles.length; i++) {
        const audioFile = audioFiles[i];
        statusText.textContent = `Processing audio ${i + 1} of ${audioFiles.length} (this may take a moment)...`;
        
        const response = await chrome.runtime.sendMessage({
          action: 'UPLOAD_AUDIO',
          file: await fileToBase64(audioFile)
        });
        
        if (response.success) {
          audioTracks.push({
            trackUrl: response.trackUrl,
            duration: response.duration,
            fileSize: response.fileSize,
            channels: response.channels,
            format: response.format,
            title: response.title || audioFile.name.replace(/\.[^/.]+$/, '')
          });
        } else {
          throw new Error(`Failed to upload audio ${i + 1}: ${response.error}`);
        }
        
        progressBar.style.width = `${40 + (40 * (i + 1) / audioFiles.length)}%`;
      }
      
      // Step 3: Create playlist content
      statusText.textContent = 'Creating playlist...';
      progressBar.style.width = '80%';
      
      const createResponse = await chrome.runtime.sendMessage({
        action: 'CREATE_PLAYLIST_CONTENT',
        title: playlistName,
        audioTracks: audioTracks,
        iconIds: iconIds,
        cardId: cardId,
        coverUrl: coverUrl
      });
      
      if (!createResponse.success) {
        throw new Error(`Failed to create playlist: ${createResponse.error}`);
      }
      
      progressBar.style.width = '100%';
      statusText.textContent = 'Import complete!';
      
      // Show success message with auto-refresh
      setTimeout(() => {
        // Clear modal but keep it positioned
        modal.innerHTML = '';
        modal.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.8);
          z-index: 10000;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding-top: 20vh;
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
                <span>${audioTracks.length} audio file${audioTracks.length !== 1 ? 's' : ''}</span>
                ${iconIds.filter(id => id).length > 0 ? `<span>${iconIds.filter(id => id).length} icon${iconIds.filter(id => id).length !== 1 ? 's' : ''}</span>` : ''}
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
        
        // Refresh the page after a short delay
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      }, 500);
      
    } catch (error) {
      alert('Import failed: ' + error.message);
      modal.remove();
    }
  };
  
  // Helper function to convert File to base64
  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const arrayBuffer = reader.result;
        // Convert ArrayBuffer to base64 string for message passing
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
}

initialize();
window.addEventListener('beforeunload', cleanup);
window.addEventListener('pagehide', cleanup);

function showRefreshIndicator() {
  const indicator = document.createElement('div');
  indicator.id = 'yoto-refresh-indicator';
  indicator.style.cssText = `
    position: fixed;
    top: 20vh;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.9);
    color: white;
    padding: 20px 30px;
    border-radius: 12px;
    z-index: 10000;
    display: flex;
    align-items: center;
    gap: 15px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 16px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
  `;
  
  indicator.innerHTML = `
    <div style="
      width: 24px;
      height: 24px;
      border: 3px solid rgba(255, 255, 255, 0.3);
      border-top: 3px solid white;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    "></div>
    <span>Icons updated! Refreshing page...</span>
  `;
  
  if (!document.getElementById('yoto-refresh-styles')) {
    const style = document.createElement('style');
    style.id = 'yoto-refresh-styles';
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(indicator);
}

async function handleCategoryIconMatch() {
  const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });
  if (!authResponse.authenticated) {
    chrome.runtime.sendMessage({ action: 'START_AUTH' });
    return;
  }
  
  const urlMatch = window.location.href.match(/\/card\/([^\/]+)/);
  const cardId = urlMatch ? urlMatch[1] : null;
  
  if (!cardId) {
    alert('Could not identify card ID from URL');
    return;
  }
  
  const contentResponse = await chrome.runtime.sendMessage({
    action: 'GET_CARD_CONTENT',
    cardId: cardId
  });
  
  let trackCount = 0;
  if (contentResponse.card && contentResponse.card.content && contentResponse.card.content.chapters) {
    // Count the number of chapters (each chapter is typically one track in MYO cards)
    trackCount = contentResponse.card.content.chapters.length;
  }
  
  if (trackCount === 0) {
    // Try to get tracks from DOM as fallback
    const trackElements = document.querySelectorAll('[data-testid^="track-"]');
    trackCount = trackElements.length;
  }
  
  if (trackCount === 0) {
    alert('No tracks found in this card. Please add some tracks first.');
    return;
  }
  
  showCategorySelectionModal(cardId, trackCount);
}

function showCategorySelectionModal(cardId, trackCount) {
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 30px;
    max-width: 500px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  `;
  
  // Common categories for icons
  const categories = [ 'Animals', 'Art', 'Buildings', 'Chapters', 'Emotions', 'Fantasy', 'Food', 'Games', 'Holiday', 'Music', 'Nature', 'School', 'Space', 'Science', 'Sports', 'Tools', 'Transportation', 'Weather'];

  content.innerHTML = `
    <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">Category Icon Match</h2>
    <p style="margin: 0 0 20px 0; color: #666; font-size: 14px;">
      Select a category to find icons for your ${trackCount} track${trackCount !== 1 ? 's' : ''}
    </p>
    
    <div style="margin-bottom: 20px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #374151;">
        Choose a category:
      </label>
      <select id="category-select" style="
        width: 100%;
        padding: 10px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 14px;
      ">
        <option value="">Select a category...</option>
        ${categories.map(cat => `<option value="${cat.toLowerCase()}">${cat}</option>`).join('')}
      </select>
    </div>
    
    <div style="margin-bottom: 20px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #374151;">
        Or enter a custom category:
      </label>
      <input type="text" id="custom-category" placeholder="e.g., dinosaurs, robots, fairy tales" style="
        width: 100%;
        padding: 10px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 14px;
      ">
    </div>
    
    <div style="display: flex; gap: 12px; justify-content: flex-end;">
      <button id="category-cancel" style="
        padding: 10px 20px;
        background: #f3f4f6;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">Cancel</button>
      <button id="category-search" style="
        padding: 10px 20px;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">Search Icons</button>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  const categorySelect = document.getElementById('category-select');
  const customCategory = document.getElementById('custom-category');
  
  categorySelect.addEventListener('change', () => {
    if (categorySelect.value) {
      customCategory.value = '';
    }
  });
  
  customCategory.addEventListener('input', () => {
    if (customCategory.value) {
      categorySelect.value = '';
    }
  });
  
  document.getElementById('category-cancel').addEventListener('click', () => {
    modal.remove();
  });
  
  document.getElementById('category-search').addEventListener('click', async () => {
    const category = customCategory.value || categorySelect.value;
    
    if (!category) {
      alert('Please select or enter a category');
      return;
    }
    
    const searchBtn = document.getElementById('category-search');
    searchBtn.textContent = 'Searching...';
    searchBtn.disabled = true;
    
    const searchResponse = await chrome.runtime.sendMessage({
      action: 'SEARCH_ICONS_BY_CATEGORY',
      category: category
    });
    
    if (searchResponse.error) {
      alert('Error searching for icons: ' + searchResponse.error);
      modal.remove();
      return;
    }
    
    if (!searchResponse.icons || searchResponse.icons.length === 0) {
      alert(`No icons found for category "${category}". Please try another category.`);
      searchBtn.textContent = 'Search Icons';
      searchBtn.disabled = false;
      return;
    }
    
    modal.remove();
    showIconSelectionModal(cardId, trackCount, searchResponse.icons, category);
  });
}

function showIconSelectionModal(cardId, trackCount, icons, category) {
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 30px;
    max-width: 800px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  `;
  
  content.innerHTML = `
    <h2 style="margin: 0 0 10px 0; color: #2c3e50; font-size: 24px;">Select Icons for "${category}"</h2>
    <p style="margin: 0 0 20px 0; color: #666; font-size: 14px;">
      Choose icons to apply to your ${trackCount} tracks. Selected icons will be applied in order and repeated if needed.
    </p>
    
    <div id="icon-grid" style="
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
      max-height: 400px;
      overflow-y: auto;
      padding: 10px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
    "></div>
    
    <div style="margin-bottom: 20px; padding: 10px; background: #f9fafb; border-radius: 6px;">
      <p style="margin: 0; font-size: 13px; color: #6b7280;">
        <strong>Selected:</strong> <span id="selected-count">0</span> icon(s)
      </p>
      <p style="margin: 4px 0 0 0; font-size: 12px; color: #9ca3af;">
        Icons will be applied to tracks in the order selected
      </p>
    </div>
    
    <div style="display: flex; gap: 12px; justify-content: flex-end;">
      <button id="icon-cancel" style="
        padding: 10px 20px;
        background: #f3f4f6;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">Cancel</button>
      <button id="icon-apply" style="
        padding: 10px 20px;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      " disabled>Apply Icons</button>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  const iconGrid = document.getElementById('icon-grid');
  const selectedIcons = [];
  const selectedIconElements = new Map();
  
  icons.forEach((icon, index) => {
    const iconDiv = document.createElement('div');
    iconDiv.style.cssText = `
      position: relative;
      cursor: pointer;
      border: 2px solid transparent;
      border-radius: 8px;
      padding: 8px;
      transition: all 0.2s;
      display: flex;
      flex-direction: column;
      align-items: center;
      background: white;
    `;
    
    const img = document.createElement('img');
    img.src = icon.url || icon.mediaUrl || `https://api.yotoplay.com/media/${icon.mediaId}`;
    img.style.cssText = `
      width: 60px;
      height: 60px;
      object-fit: cover;
      border-radius: 4px;
    `;
    
    const orderBadge = document.createElement('div');
    orderBadge.style.cssText = `
      position: absolute;
      top: 4px;
      right: 4px;
      background: #3b82f6;
      color: white;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: none;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: bold;
    `;
    
    iconDiv.appendChild(img);
    iconDiv.appendChild(orderBadge);
    
    iconDiv.addEventListener('click', () => {
      const iconIndex = selectedIcons.findIndex(i => i.mediaId === icon.mediaId);
      
      if (iconIndex >= 0) {
        selectedIcons.splice(iconIndex, 1);
        iconDiv.style.borderColor = 'transparent';
        iconDiv.style.backgroundColor = 'white';
        orderBadge.style.display = 'none';
        selectedIconElements.delete(icon.mediaId);
        
        updateOrderBadges();
      } else {
        selectedIcons.push(icon);
        iconDiv.style.borderColor = '#3b82f6';
        iconDiv.style.backgroundColor = '#eff6ff';
        orderBadge.style.display = 'flex';
        orderBadge.textContent = selectedIcons.length;
        selectedIconElements.set(icon.mediaId, orderBadge);
      }
      
      document.getElementById('selected-count').textContent = selectedIcons.length;
      document.getElementById('icon-apply').disabled = selectedIcons.length === 0;
    });
    
    iconGrid.appendChild(iconDiv);
  });
  
  function updateOrderBadges() {
    selectedIcons.forEach((icon, index) => {
      const badge = selectedIconElements.get(icon.mediaId);
      if (badge) {
        badge.textContent = index + 1;
      }
    });
  }
  
  document.getElementById('icon-cancel').addEventListener('click', () => {
    modal.remove();
  });
  
  document.getElementById('icon-apply').addEventListener('click', async () => {
    if (selectedIcons.length === 0) return;
    
    const applyBtn = document.getElementById('icon-apply');
    applyBtn.textContent = 'Applying...';
    applyBtn.disabled = true;
    
    const result = await chrome.runtime.sendMessage({
      action: 'APPLY_CATEGORY_ICONS',
      cardId: cardId,
      icons: selectedIcons
    });
    
    if (result.error) {
      alert('Error applying icons: ' + result.error);
    } else {
      // Calculate the actual number of unique icons applied (capped at track count)
      const iconsApplied = Math.min(selectedIcons.length, trackCount);
      
      modal.innerHTML = `
        <div style="
          background: white;
          border-radius: 12px;
          padding: 40px;
          text-align: center;
          max-width: 400px;
        ">
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
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3">
              <path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <h3 style="margin: 0 0 10px 0; color: #2c3e50;">Success!</h3>
          <p style="margin: 0 0 20px 0; color: #666;">
            Applied ${iconsApplied} icon${iconsApplied !== 1 ? 's' : ''} to ${trackCount} track${trackCount !== 1 ? 's' : ''}
          </p>
          <button onclick="window.location.reload()" style="
            padding: 10px 20px;
            background: #3b82f6;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
          ">Reload Page</button>
        </div>
      `;
      
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    }
  });
}

})(); // End of IIFE
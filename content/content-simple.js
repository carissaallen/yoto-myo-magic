
(function() {
'use strict';

const selectedIcons = {};
let currentMatches = [];
const iconMatchCache = new Map();
let authCached = null;
let authCacheTime = 0;
const AUTH_CACHE_DURATION = 5 * 60 * 1000;

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
    iconTitleDisplay.textContent = match.iconOptions[newIndex].title || chrome.i18n.getMessage('modal_untitledIcon');
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
    <h2 style=\"margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;\">${chrome.i18n.getMessage('modal_iconMatchesFound')}</h2>
    <div style="margin-bottom: 20px; color: #666;">
      ${chrome.i18n.getMessage('modal_foundIconsForTracks', [matches.length.toString(), matches.length !== 1 ? 's' : ''])}
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
              ${chrome.i18n.getMessage('iconMatch_iconsAvailableOf', [(selectedIndex + 1).toString(), match.iconOptions.length.toString()])}
            </div>
            ` : `
            <div style="font-size: 12px; color: #999; margin-top: 4px;">
              ${match.iconOptions && match.iconOptions.length > 0 ? chrome.i18n.getMessage('modal_iconFound') : chrome.i18n.getMessage('modal_noIconsFound')}
            </div>
            `}
            ${selectedIcon && selectedIcon.title ? `
            <div class="icon-title" style="font-size: 11px; color: #666; margin-top: 2px;">
              ${chrome.i18n.getMessage('iconMatch_iconLabel', [selectedIcon.title])}
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
      ">${chrome.i18n.getMessage('button_cancel')}</button>
      <button id="apply-icons" style="
        padding: 10px 20px;
        background: #FFD700;
        color: #000;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">${chrome.i18n.getMessage('button_applyIcons')}</button>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);

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
  
  const navButtons = content.querySelectorAll('.icon-nav-button');
  navButtons.forEach(button => {
    button.addEventListener('click', function() {
      const trackId = this.getAttribute('data-track-id');
      const action = this.getAttribute('data-action');
      cycleIcon(trackId, action);
    });
    
    button.addEventListener('mouseenter', function() {
      this.style.background = '#d0d0d0';
    });
    
    button.addEventListener('mouseleave', function() {
      this.style.background = '#e0e0e0';
    });
  });

  document.querySelector('#cancel-preview').onclick = () => {
    modal.remove();
  };
  
  document.querySelector('#apply-icons').onclick = async () => {

    const applyButton = document.querySelector('#apply-icons');
    applyButton.disabled = true;
    applyButton.textContent = chrome.i18n.getMessage('button_applying');
    
    try {
      const urlMatch = window.location.href.match(/\/card\/([^\/]+)/);
      let cardId = urlMatch ? urlMatch[1] : null;

      if (cardId && cardId.includes('/')) {
        cardId = cardId.split('/')[0];
      }
      
      if (cardId === '31dM9') {
        cardId = '1idN9';
      }
      
      if (!cardId) {
        alert(chrome.i18n.getMessage('error_couldNotIdentifyCardId'));
        return;
      }

      const selectedMatches = matches.map(match => {
        if (!match.iconOptions || match.iconOptions.length === 0) return null;
        
        const selectedIndex = selectedIcons[match.uniqueTrackId] || 0;
        const selectedIcon = match.iconOptions[selectedIndex];
        
        if (!selectedIcon || !selectedIcon.iconId) {
          return null;
        }
        
        return {
          trackId: match.trackId,
          trackTitle: match.trackTitle,
          suggestedIcon: selectedIcon.url,
          iconId: selectedIcon.iconId,
          iconTitle: selectedIcon.title
        };
      }).filter(Boolean);
      
      const validMatches = selectedMatches;
      
      
      if (validMatches.length === 0) {
        alert(chrome.i18n.getMessage('notification_noValidIcons'));
        modal.remove();
        return;
      }

      const response = await chrome.runtime.sendMessage({
        action: 'UPDATE_CARD_ICONS',
        cardId: cardId,
        iconMatches: validMatches
      });
      
      if (response.success) {
        modal.remove();

        const refreshNotice = document.createElement('div');
        refreshNotice.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: #3b82f6;
          color: white;
          padding: 30px 40px;
          border-radius: 12px;
          font-size: 16px;
          z-index: 10000;
          box-shadow: 0 10px 25px rgba(0,0,0,0.2);
          text-align: center;
          min-width: 300px;
        `;
        refreshNotice.innerHTML = `
          <div style="width: 48px; height: 48px; background: rgba(255, 255, 255, 0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px auto;">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <div style="margin-bottom: 15px; font-size: 18px; font-weight: 600;">${chrome.i18n.getMessage('notification_iconsAppliedSuccessfully')}</div>
          <div style="font-size: 14px; opacity: 0.95;">${chrome.i18n.getMessage('notification_pleaseRefreshPage')}</div>
        `;
        document.body.appendChild(refreshNotice);

        setTimeout(() => {
          refreshNotice.remove();
        }, 6000);
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
            <h3 style=\"margin: 0 0 16px 0; color: #dc3545;\">${chrome.i18n.getMessage('iconMatch_unableToApplyIcons')}</h3>
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
          const errorMessage = response.error || chrome.i18n.getMessage('error_unknownError');
          alert(chrome.i18n.getMessage('error_failedToApplyIcons', [errorMessage]));
        }

        applyButton.disabled = false;
        applyButton.textContent = chrome.i18n.getMessage('button_applyIcons');
      }
    } catch (error) {
      alert(chrome.i18n.getMessage('error_failedToApplyIcons', [error.message]));
      applyButton.disabled = false;
      applyButton.textContent = chrome.i18n.getMessage('button_applyIcons');
    }
  };

  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  };
}

function createImportButton() {
  const button = document.createElement('button');
  button.id = 'yoto-import-btn';

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
    <span>${chrome.i18n.getMessage('button_import')}</span>
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
    handleImportClick();
  };
  
  return button;
}

function createIconArtButton() {
  const button = document.createElement('button');
  button.id = 'yoto-icon-art-btn';

  const createIcon = `
    <svg width="16" height="16" viewBox="-30 0 155 155" fill="currentColor">
      <path d="M65.3694 99.0891C65.2239 100.017 65.1332 100.953 65.0977 101.892C65.2617 108.397 65.6084 114.902 65.6182 121.408C65.6274 128.127 65.4245 134.854 65.0931 141.565C64.8819 143.571 64.3711 145.535 63.5776 147.39C63.1865 148.511 62.563 149.538 61.7479 150.402C60.9328 151.267 59.9444 151.949 58.8474 152.406C54.1471 154.404 48.8783 154.614 44.0338 152.996C40.1837 151.743 37.6673 148.879 37.3569 144.879C36.8673 138.637 36.7071 132.352 36.759 126.088C36.8148 119.361 37.2841 112.639 37.5532 105.913C37.6018 104.709 37.5603 103.503 37.5603 101.802C35.8322 101.802 34.5255 101.867 33.2286 101.789C28.203 101.475 23.1118 101.515 18.1722 100.673C11.0476 99.4619 6.60551 94.9962 5.27905 87.7831C4.69228 84.5906 4.34311 81.3509 3.98344 78.1211C3.36386 72.558 2.53951 66.9988 2.30257 61.4168C1.71843 47.6337 1.41716 33.8316 1.00564 20.0374C0.909158 16.7859 0.718824 13.5311 0.788396 10.2829C0.902305 8.97763 1.25072 7.70361 1.81689 6.52207C3.03899 3.56855 5.32566 2.80524 8.48137 2.72714C18.6828 2.47445 28.8711 1.73208 39.0719 1.40982C49.2727 1.08755 59.4794 1.04306 69.6836 0.877663C74.0601 0.806779 78.4359 0.694513 82.8104 0.68073C86.8016 0.670885 88.3945 1.76236 89.0561 5.75421C89.8726 10.3926 90.3675 15.082 90.5368 19.7887C90.8997 34.0489 91.6578 48.262 94.0279 62.3523C94.2005 63.3479 94.2937 64.3556 94.3061 65.366C94.3337 70.3993 94.3232 75.4334 94.314 80.4669C94.314 81.2545 94.2484 82.0368 94.2175 82.8218C93.9498 89.2946 90.6221 93.4919 84.6238 95.6854C79.5398 97.4929 74.2189 98.547 68.8304 98.8154C67.7271 98.8916 66.6317 98.9913 65.3694 99.0891ZM69.5228 19.1475C67.8163 22.8663 68.1051 26.1814 67.5479 29.3397C66.8876 33.0808 66.3475 36.8988 65.1194 40.4653C63.598 44.8864 59.232 46.1098 55.1948 43.747C54.1086 43.1413 53.1644 42.3103 52.4254 41.3101C51.6862 40.3097 51.1695 39.1632 50.9096 37.9469C50.2139 34.6712 49.8713 31.3179 49.4164 27.9942C49.1434 25.9996 49.0529 23.9728 48.6492 22.0084C48.5286 21.6553 48.3229 21.3372 48.0504 21.0823C47.7779 20.8274 47.4468 20.6436 47.0864 20.5468C46.608 20.4983 45.7738 21.3199 45.5467 21.925C44.8352 23.8074 44.3692 25.7817 43.745 27.7008C43.0887 29.7171 42.0655 31.3704 39.6659 31.6389C37.2099 31.9165 35.1332 31.1794 33.8396 29.0962C32.9719 27.6975 32.527 26.0338 31.9179 24.4783C31.5057 23.4236 31.1394 22.351 30.7528 21.2865L29.8339 21.4393C29.4999 23.2796 29.2889 25.1401 29.2025 27.0084C29.2557 30.7069 29.7822 34.4065 29.6942 38.0965C29.6053 41.329 29.2024 44.5454 28.4911 47.7C28.2981 48.8257 27.753 49.8611 26.9342 50.6574C26.1155 51.4537 25.0654 51.9699 23.9348 52.1316C21.2077 52.5419 19.2393 51.0395 18.1492 48.8906C16.8681 46.2877 15.886 43.548 15.2219 40.7239C14.4724 37.6851 14.2571 34.5189 13.6723 31.4334C13.3704 29.8405 13.2457 28.0566 11.5877 27.1246C8.13476 28.6217 7.74693 29.0798 7.88147 32.2729C8.10811 37.6549 8.38791 43.0325 8.72087 48.4057C9.02541 53.22 9.4389 58.0275 9.82023 62.8372C10.0499 65.731 10.3552 66.0081 13.3048 66.1531C13.5286 66.1636 13.7537 66.1647 13.9782 66.1615C24.5255 66.0177 35.0781 66.0304 45.6189 65.6884C58.4018 65.2769 71.1755 64.5725 83.9491 63.9758C84.7374 63.8839 85.5191 63.7394 86.2883 63.5429C85.5539 53.0139 84.8332 42.6803 84.104 32.2235C80.1004 32.6226 76.8259 31.7216 73.9636 29.4972C70.8499 27.0773 71.5391 22.947 69.5209 19.1481L69.5228 19.1475ZM9.79595 71.8761C10.1298 76.8668 10.9354 81.8143 12.2021 86.6528C13.2569 90.6624 15.7004 93.0758 19.725 93.8995C21.0342 94.1961 22.3637 94.3937 23.7024 94.4902C28.4077 94.7291 33.117 94.884 37.8249 95.0697C40.5605 95.176 42.2394 96.5793 42.7475 99.2447C43.2251 101.317 43.5271 103.427 43.6499 105.55C43.795 113.735 43.7116 121.925 43.8546 130.11C43.9255 134.142 44.1867 138.183 44.6081 142.191C44.7512 143.545 45.2986 145.276 46.2805 146.038C48.5528 147.797 51.3408 147.528 54.0252 146.811C56.3093 146.2 56.8764 144.296 56.9322 142.367C57.1258 135.652 57.3332 128.928 57.1947 122.218C57.0267 114.145 56.4813 106.084 56.1728 98.0154C56.1375 96.786 56.3111 95.5587 56.6861 94.3865C57.4304 92.0381 59.1054 91.1192 61.5916 91.2577C62.9114 91.3142 64.2337 91.2551 65.5434 91.0818C67.7684 90.8134 69.998 90.5226 72.1935 90.0822C75.8256 89.4397 79.4224 88.6153 82.9718 87.6111C84.3042 87.2009 85.9044 85.9151 86.3441 84.6628C87.9114 80.2089 88.0427 75.5397 87.664 70.4308C85.9621 70.4308 84.6448 70.3829 83.3322 70.438C70.4443 70.9808 57.5603 71.6437 44.6691 72.0598C36.268 72.3309 27.863 72.2961 19.4593 72.304C16.345 72.3053 13.2384 72.0369 9.79135 71.8767L9.79595 71.8761ZM37.92 27.7829L38.7431 27.7671C39.1369 26.7826 39.5779 25.8172 39.9054 24.8136C40.4607 23.1071 40.8099 21.3277 41.4807 19.6764C42.6556 16.8003 44.5838 15.8276 47.6725 16.3658C50.1627 16.799 52.0878 18.1177 53.0283 20.4798C53.5665 21.9488 53.933 23.475 54.1205 25.0282C54.6232 28.4667 54.8667 31.9485 55.4987 35.3615C55.8355 36.8774 56.5002 38.3012 57.4461 39.5327C58.2567 40.6347 59.5182 40.4777 60.1509 39.1683C60.766 37.9717 61.1944 36.6878 61.4209 35.3615C61.9984 31.2574 62.3903 27.1278 62.8917 23.0119C63.1936 20.5369 63.7568 18.1347 65.4803 16.2005C67.859 13.5305 71.0593 13.4733 73.2987 16.2359C74.2163 17.5004 74.9442 18.8917 75.4607 20.3662C75.9202 21.499 76.016 22.7718 76.3907 23.9447C77.4547 27.2697 79.845 27.9089 82.5347 25.7706C83.0815 25.3857 83.5179 24.8635 83.7988 24.2565C84.0797 23.6495 84.1959 22.9791 84.1355 22.313C83.9872 19.4008 83.9826 16.4794 83.7798 13.5718C83.6256 11.377 83.2547 9.19678 82.9561 6.81162C57.1271 4.87608 31.7978 7.15813 6.08965 8.10457C6.54384 13.2509 6.96195 17.9877 7.40235 23.0107C8.23262 22.7704 8.74121 22.6169 9.25316 22.4771C12.989 21.4525 15.6406 22.4659 17.4127 25.8539C18.1715 27.3529 18.7256 28.9469 19.0602 30.5933C19.834 34.2123 20.3636 37.8825 21.1145 41.5062C21.4545 43.147 22.0846 44.7297 22.5827 46.339C24.4539 43.8495 24.559 41.3552 24.3155 38.7712C23.9473 34.8647 23.495 30.9543 23.4038 27.0379C23.3277 23.7786 23.732 20.5001 25.9117 17.8019C28.6684 14.3889 32.6365 14.6588 34.6469 18.5653C35.6038 20.4247 35.9458 22.5952 36.6251 24.6036C36.9901 25.6872 37.481 26.7255 37.9155 27.7835L37.92 27.7829Z"/>
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
    white-space: nowrap;
    line-height: 1.5;
    height: 40px;
    margin-left: 8px;
  `;

  button.innerHTML = `
    ${createIcon}
    <span>${chrome.i18n.getMessage('button_createIcon')}</span>
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

  button.onclick = (e) => {
    e.preventDefault();
    openIconArtModal();
  };

  return button;
}

function createAddGifButton() {
  try {
    const button = document.createElement('button');
    button.id = 'yoto-add-gif-btn';

    const gifIcon = `
      <svg width="16" height="16" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2.5 10.5H2V11H2.5V10.5ZM4.5 10.5V11H5V10.5H4.5ZM13.5 3.5H14V3.29289L13.8536 3.14645L13.5 3.5ZM10.5 0.5L10.8536 0.146447L10.7071 0H10.5V0.5ZM2 6V10.5H3V6H2ZM2.5 11H4.5V10H2.5V11ZM5 10.5V8.5H4V10.5H5ZM3 7H5V6H3V7ZM2 5V1.5H1V5H2ZM13 3.5V5H14V3.5H13ZM2.5 1H10.5V0H2.5V1ZM10.1464 0.853553L13.1464 3.85355L13.8536 3.14645L10.8536 0.146447L10.1464 0.853553ZM2 1.5C2 1.22386 2.22386 1 2.5 1V0C1.67157 0 1 0.671573 1 1.5H2ZM1 12V13.5H2V12H1ZM2.5 15H12.5V14H2.5V15ZM14 13.5V12H13V13.5H14ZM12.5 15C13.3284 15 14 14.3284 14 13.5H13C13 13.7761 12.7761 14 12.5 14V15ZM1 13.5C1 14.3284 1.67157 15 2.5 15V14C2.22386 14 2 13.7761 2 13.5H1ZM6 7H9V6H6V7ZM6 11H9V10H6V11ZM7 6.5V10.5H8V6.5H7ZM10.5 7H13V6H10.5V7ZM10 6V11H11V6H10ZM10.5 9H12V8H10.5V9Z" fill="currentColor"/>
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
      white-space: nowrap;
      line-height: 1.5;
      height: 40px;
      margin-left: 8px;
    `;

    button.innerHTML = `
      ${gifIcon}
      <span>${chrome.i18n.getMessage('button_addGif') || 'Add GIF'}</span>
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

    button.onclick = (e) => {
      e.preventDefault();
      openGifFilePicker();
    };

    return button;
  } catch (error) {
    console.error('Error creating Add GIF button:', error);
    // Return a fallback button if something goes wrong
    const fallbackButton = document.createElement('button');
    fallbackButton.id = 'yoto-add-gif-btn';
    fallbackButton.textContent = 'Add GIF';
    fallbackButton.style.cssText = `
      background-color: #ffffff;
      color: #3b82f6;
      border: 1px solid #3b82f6;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      height: 40px;
      margin-left: 8px;
    `;
    fallbackButton.onclick = (e) => {
      e.preventDefault();
      openGifFilePicker();
    };
    return fallbackButton;
  }
}

function openGifFilePicker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/gif';
  input.style.display = 'none';

  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file type
    if (file.type !== 'image/gif') {
      showGifError(chrome.i18n.getMessage('error_gifInvalidType'));
      return;
    }

    // Validate file size (max 1MB for icons)
    const maxSize = 1 * 1024 * 1024; // 1MB
    if (file.size > maxSize) {
      showGifError(chrome.i18n.getMessage('error_gifTooLarge'));
      return;
    }

    // Validate dimensions (must be exactly 16x16 for animated GIF preservation)
    const dimensionsValid = await validateGifDimensions(file);
    if (!dimensionsValid) {
      showGifError(chrome.i18n.getMessage('error_gifWrongDimensions'));
      return;
    }

    // Upload the GIF
    await uploadGifIcon(file);
  };

  document.body.appendChild(input);
  input.click();
  document.body.removeChild(input);
}

function validateGifDimensions(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve(img.width === 16 && img.height === 16);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      resolve(false);
    };
    img.src = URL.createObjectURL(file);
  });
}

async function uploadGifIcon(file) {
  const loadingNotice = document.createElement('div');
  loadingNotice.id = 'gif-upload-loading';
  loadingNotice.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #3b82f6;
    color: white;
    padding: 30px 40px;
    border-radius: 12px;
    font-size: 16px;
    z-index: 10000;
    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    text-align: center;
    min-width: 300px;
  `;
  loadingNotice.innerHTML = `
    <div style="font-size: 18px; font-weight: 600;">${chrome.i18n.getMessage('status_uploadingGif')}</div>
  `;
  document.body.appendChild(loadingNotice);

  try {
    // Read file as base64 using Promise
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result.split(',')[1];
        resolve(result);
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });

    const response = await chrome.runtime.sendMessage({
      action: 'UPLOAD_GIF',
      file: {
        data: base64,
        type: 'image/gif',
        name: file.name || 'custom-icon.gif'
      }
    });

    loadingNotice.remove();

    if (response && response.success) {
      const tracks = extractTracks();
      if (tracks.length > 0 && response.iconId) {
        await applyCustomIconToTracks(tracks, response.iconId);
      }

      const successNotice = document.createElement('div');
      successNotice.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #10b981;
        color: white;
        padding: 30px 40px;
        border-radius: 12px;
        font-size: 16px;
        z-index: 10000;
        box-shadow: 0 10px 25px rgba(0,0,0,0.2);
        text-align: center;
        min-width: 300px;
      `;
      successNotice.innerHTML = `
        <div style="margin-bottom: 10px; font-size: 18px; font-weight: 600;">${chrome.i18n.getMessage('notification_gifUploadedSuccess') || 'GIF icon uploaded successfully!'}</div>
        <div style="font-size: 14px; opacity: 0.95;">${chrome.i18n.getMessage('notification_gifRefreshToView') || "Refresh the page to view in 'My Icons'"}</div>
      `;
      document.body.appendChild(successNotice);

      setTimeout(() => {
        successNotice.remove();
      }, 5000);
    } else {
      showGifError(chrome.i18n.getMessage('error_gifUploadFailed', [response?.error || chrome.i18n.getMessage('error_unknownError')]));
    }
  } catch (error) {
    loadingNotice.remove();
    showGifError(chrome.i18n.getMessage('error_gifUploadFailed', [error.message || chrome.i18n.getMessage('error_unknownError')]));
  }
}

function showGifError(message) {
  const errorNotice = document.createElement('div');
  errorNotice.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #ef4444;
    color: white;
    padding: 30px 40px;
    border-radius: 12px;
    font-size: 16px;
    z-index: 10000;
    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    text-align: center;
    min-width: 300px;
    max-width: 500px;
  `;
  errorNotice.innerHTML = `
    <div style="font-size: 18px; font-weight: 600;">${message}</div>
  `;
  document.body.appendChild(errorNotice);

  setTimeout(() => {
    errorNotice.remove();
  }, 5000);
}

function createUpdatePlaylistButton() {
  const buttonContainer = document.createElement('div');
  buttonContainer.id = 'yoto-update-playlist-container';
  buttonContainer.style.cssText = `
    position: relative;
    display: inline-flex;
    margin-left: 8px;
  `;

  const button = document.createElement('button');
  button.id = 'yoto-update-playlist-btn';

  const updateIcon = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M12 19H5C3.89543 19 3 18.1046 3 17V7C3 5.89543 3.89543 5 5 5H9.58579C9.851 5 10.1054 5.10536 10.2929 5.29289L12 7H19C20.1046 7 21 7.89543 21 9V11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M18 14V17M18 20V17M18 17H15M18 17H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
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

  const audioAndIconsOption = document.createElement('button');
  audioAndIconsOption.style.cssText = `
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
  audioAndIconsOption.textContent = chrome.i18n.getMessage('button_audioAndIcons') || 'Audio + Icons';
  audioAndIconsOption.onmouseenter = () => audioAndIconsOption.style.backgroundColor = '#f3f4f6';
  audioAndIconsOption.onmouseleave = () => audioAndIconsOption.style.backgroundColor = 'transparent';

  const iconsOnlyOption = document.createElement('button');
  iconsOnlyOption.style.cssText = `
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
  iconsOnlyOption.textContent = chrome.i18n.getMessage('button_iconsOnly') || 'Icons Only';
  iconsOnlyOption.onmouseenter = () => iconsOnlyOption.style.backgroundColor = '#f3f4f6';
  iconsOnlyOption.onmouseleave = () => iconsOnlyOption.style.backgroundColor = 'transparent';

  const podcastEpisodesOption = document.createElement('button');
  podcastEpisodesOption.style.cssText = `
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
  podcastEpisodesOption.textContent = chrome.i18n.getMessage('button_podcastEpisodes') || 'Podcast Episodes';
  podcastEpisodesOption.onmouseenter = () => podcastEpisodesOption.style.backgroundColor = '#f3f4f6';
  podcastEpisodesOption.onmouseleave = () => podcastEpisodesOption.style.backgroundColor = 'transparent';

  dropdownMenu.appendChild(audioAndIconsOption);
  dropdownMenu.appendChild(iconsOnlyOption);
  dropdownMenu.appendChild(podcastEpisodesOption);

  button.innerHTML = `
    ${updateIcon}
    <span>${chrome.i18n.getMessage('button_addContent') || 'Add Content'}</span>
  `;

  button.onmouseenter = () => {
    button.style.backgroundColor = '#ffffff';
    button.style.color = '#ffdd00';
    button.style.borderColor = '#ffdd00';
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

  audioAndIconsOption.onclick = async () => {
    dropdownMenu.style.display = 'none';
    await handleUpdatePlaylistAudioIcons(false); // false = don't ignore audio
  };

  iconsOnlyOption.onclick = async () => {
    dropdownMenu.style.display = 'none';
    await handleUpdatePlaylistAudioIcons(true); // true = ignore audio files
  };

  podcastEpisodesOption.onclick = async () => {
    dropdownMenu.style.display = 'none';
    await handleUpdatePlaylistPodcast();
  };

  button.onclick = async () => {
    await handleUpdatePlaylistAudioIcons(false);
  };

  buttonContainer.appendChild(button);
  buttonContainer.appendChild(dropdownButton);
  buttonContainer.appendChild(dropdownMenu);

  return buttonContainer;
}

function openIconArtModal() {
  const existingModal = document.querySelector('#yoto-icon-art-modal');
  if (existingModal) {
    existingModal.remove();
  }

  const modal = document.createElement('div');
  modal.id = 'yoto-icon-art-modal';
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
    padding: 20px;
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 24px;
    width: 90%;
    max-width: 500px;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  `;

  content.innerHTML = `
    <style>
      .mode-select-btn {
        padding: 20px;
        background: #ffffff;
        border: 2px solid #3b82f6;
        border-radius: 8px;
        cursor: pointer;
        width: 200px;
        text-align: center;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        transform-style: preserve-3d;
        transform: perspective(1000px) rotateX(0deg) rotateY(0deg);
      }

      .mode-select-btn:hover {
        border-color: #f45536;
        transform: perspective(1000px) rotateX(-5deg) rotateY(5deg) scale(1.05);
        box-shadow: 0 10px 30px rgba(244, 85, 54, 0.2);
      }

      .mode-select-btn:active {
        transform: perspective(1000px) rotateX(-2deg) rotateY(2deg) scale(1.02);
      }

      .mode-select-btn img {
        transition: all 0.3s ease;
      }

      .mode-select-btn:hover img {
        filter: hue-rotate(-10deg) saturate(1.2);
      }

      #blank-mode-btn:hover {
        transform: perspective(1000px) rotateX(-5deg) rotateY(-5deg) scale(1.05);
      }

      #blank-mode-btn:active {
        transform: perspective(1000px) rotateX(-2deg) rotateY(-2deg) scale(1.02);
      }
    </style>

    <h2 style=\"margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;\">${chrome.i18n.getMessage('modal_createIcon')}</h2>
    <p style="margin-bottom: 20px; color: #666;">${chrome.i18n.getMessage('createIcon_chooseHowToCreate')}</p>

    <div id="mode-selection" style="margin-bottom: 20px; display: flex; gap: 20px; justify-content: center;">
      <button id="image-mode-btn" class="mode-select-btn">
        <img src="${chrome.runtime.getURL('assets/images/upload-image-150.png')}"
             style="width: 150px; height: auto; object-fit: contain;"
             alt="Upload Image">
      </button>
      <button id="blank-mode-btn" class="mode-select-btn">
        <img src="${chrome.runtime.getURL('assets/images/blank-canvas-150.png')}"
             style="width: 150px; height: auto; object-fit: contain;"
             alt="Blank Canvas">
      </button>
    </div>

    <div id="upload-section" style="margin-bottom: 20px; display: none;">
      <input type="file" id="artwork-upload" accept="image/*" style="display: none;">
      <button id="upload-btn" style="
        padding: 12px 24px;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">${chrome.i18n.getMessage('createIcon_chooseImage')}</button>
    </div>

    <div id="positioning-section" style="display: none;">
      <p style="margin-bottom: 10px; color: #666; text-align: center;">${chrome.i18n.getMessage('createIcon_positionAndScale')}</p>
      <div id="positioning-container" style="
        position: relative;
        margin: 20px auto;
        width: 400px;
        height: 400px;
        border: 2px solid #e0e0e0;
        border-radius: 8px;
        overflow: hidden;
        background: #f9f9f9;
      ">
        <img id="positioning-image" style="
          position: absolute;
          cursor: move;
          user-select: none;
          -webkit-user-drag: none;
        ">
        <div id="grid-overlay" style="
          position: absolute;
          width: 400px;
          height: 400px;
          border: 2px solid #9ca3af;
          pointer-events: none;
          box-shadow: 0 0 0 1000px rgba(0, 0, 0, 0.5);
          background: transparent;
        "></div>
        <canvas id="grid-lines" style="
          position: absolute;
          width: 400px;
          height: 400px;
          pointer-events: none;
        "></canvas>
      </div>

      <div id="scale-controls" style="margin: 20px 0; text-align: center;">
        <label style="display: block; margin-bottom: 10px; color: #666;">${chrome.i18n.getMessage('createIcon_scale')} <span id="scale-value">100%</span></label>
        <input type="range" id="scale-slider" min="10" max="300" value="100" style="width: 300px;">
      </div>

      <div style="text-align: center;">
        <button id="convert-to-pixel" style="
          padding: 12px 24px;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
        ">${chrome.i18n.getMessage('createIcon_convertToPixelArt')}</button>
      </div>
    </div>

    <div id="editor-section" style="display: none;">
      <div style="display: flex; gap: 20px; align-items: start; justify-content: center;">
        <!-- Original image reference on the left -->
        <div id="reference-section" style="display: none;">
          <p style="margin: 0 0 10px 0; color: #666; font-size: 14px; text-align: center;">${chrome.i18n.getMessage('createIcon_original')}</p>
          <div style="
            width: 200px;
            height: 200px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            overflow: hidden;
            background: #f9f9f9;
            position: relative;
          ">
            <img id="reference-image" style="
              width: 100%;
              height: 100%;
              object-fit: contain;
            ">
          </div>
          <button id="reset-grid" style="
            margin-top: 10px;
            padding: 8px 16px;
            background: #6b7280;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            width: 100%;
          ">${chrome.i18n.getMessage('createIcon_resetGrid')}</button>
        </div>

        <!-- Pixelated grid for editing on the right -->
        <div>
          <p id="pixel-edit-label" style="margin: 0 0 10px 0; color: #666; font-size: 14px; text-align: center; display: none;">${chrome.i18n.getMessage('createIcon_touchUpPixelArt')}</p>
          <div id="canvas-container" style="
            position: relative;
            margin: 0 auto;
            width: 400px;
            height: 400px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            overflow: hidden;
            background: #f9f9f9;
          ">
            <img id="artwork-image" style="
              position: absolute;
              cursor: move;
              user-select: none;
              -webkit-user-drag: none;
              display: none;
            ">
            <canvas id="pixelated-canvas" width="400" height="400" style="
              position: absolute;
              top: 0;
              left: 0;
              width: 400px;
              height: 400px;
              image-rendering: pixelated;
              display: none;
            "></canvas>
            <canvas id="eraser-canvas" style="
              position: absolute;
              width: 400px;
              height: 400px;
              pointer-events: none;
              cursor: crosshair;
              display: none;
            "></canvas>
            <canvas id="grid-lines" style="
              position: absolute;
              width: 400px;
              height: 400px;
              pointer-events: none;
            "></canvas>
          </div>
        </div>
      </div>

      <div id="color-palette" style="margin: 20px auto; width: 400px;">
        <div style="
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          padding: 10px;
          background: white;
        ">
          <div id="preset-colors" style="
            display: grid;
            grid-template-columns: repeat(16, 22px);
            gap: 2px;
            margin-bottom: 10px;
            justify-content: center;
          ">
            <!-- Row 1 - Grays, greens, reds/oranges -->
            <button class="color-preset selected" data-color="#FFFFFF" style="width: 22px; height: 22px; background: #FFFFFF; border: 2px solid #3b82f6; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#D0D0D4" style="width: 22px; height: 22px; background: #D0D0D4; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#2E468B" style="width: 22px; height: 22px; background: #2E468B; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#435073" style="width: 22px; height: 22px; background: #435073; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#4E398C" style="width: 22px; height: 22px; background: #4E398C; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#7B95A7" style="width: 22px; height: 22px; background: #7B95A7; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#996CBF" style="width: 22px; height: 22px; background: #996CBF; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#84C5D1" style="width: 22px; height: 22px; background: #84C5D1; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#D0D0D4" style="width: 22px; height: 22px; background: #D0D0D4; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#F1F4F7" style="width: 22px; height: 22px; background: #F1F4F7; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#D02829" style="width: 22px; height: 22px; background: #D02829; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#154237" style="width: 22px; height: 22px; background: #154237; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#235C44" style="width: 22px; height: 22px; background: #235C44; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#317545" style="width: 22px; height: 22px; background: #317545; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#428F42" style="width: 22px; height: 22px; background: #428F42; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#6EA84A" style="width: 22px; height: 22px; background: #6EA84A; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <!-- Row 2 - Greens, reds, oranges, yellows -->
            <button class="color-preset" data-color="#A3C285" style="width: 22px; height: 22px; background: #A3C285; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#CFDB72" style="width: 22px; height: 22px; background: #CFDB72; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#F6D010" style="width: 22px; height: 22px; background: #F6D010; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#B4241A" style="width: 22px; height: 22px; background: #B4241A; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#B34428" style="width: 22px; height: 22px; background: #B34428; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#D16630" style="width: 22px; height: 22px; background: #D16630; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#E68D3E" style="width: 22px; height: 22px; background: #E68D3E; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#EDAC4A" style="width: 22px; height: 22px; background: #EDAC4A; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#FFCB83" style="width: 22px; height: 22px; background: #FFCB83; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#FFEA63" style="width: 22px; height: 22px; background: #FFEA63; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#5C1E1C" style="width: 22px; height: 22px; background: #5C1E1C; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#7B362A" style="width: 22px; height: 22px; background: #7B362A; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#915237" style="width: 22px; height: 22px; background: #915237; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#A07044" style="width: 22px; height: 22px; background: #A07044; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#C78C58" style="width: 22px; height: 22px; background: #C78C58; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#E0AB72" style="width: 22px; height: 22px; background: #E0AB72; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <!-- Row 3 - Browns, purples, pinks, blues -->
            <button class="color-preset" data-color="#EBC48A" style="width: 22px; height: 22px; background: #EBC48A; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#F5D9A6" style="width: 22px; height: 22px; background: #F5D9A6; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#5F1A4D" style="width: 22px; height: 22px; background: #5F1A4D; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#8D2975" style="width: 22px; height: 22px; background: #8D2975; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#9A3989" style="width: 22px; height: 22px; background: #9A3989; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#B350BD" style="width: 22px; height: 22px; background: #B350BD; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#CC6B8A" style="width: 22px; height: 22px; background: #CC6B8A; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#E8948F" style="width: 22px; height: 22px; background: #E8948F; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#F7B5AA" style="width: 22px; height: 22px; background: #F7B5AA; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#FD1662" style="width: 22px; height: 22px; background: #FD1662; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#212870" style="width: 22px; height: 22px; background: #212870; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#2C488F" style="width: 22px; height: 22px; background: #2C488F; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#3973AD" style="width: 22px; height: 22px; background: #3973AD; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#534CCC" style="width: 22px; height: 22px; background: #534CCC; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#74C6DA" style="width: 22px; height: 22px; background: #74C6DA; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
            <button class="color-preset" data-color="#A1E2F8" style="width: 22px; height: 22px; background: #A1E2F8; border: 1px solid #ddd; cursor: pointer; border-radius: 2px;"></button>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="color" id="color-picker" value="#FFFFFF" style="
              width: 40px;
              height: 24px;
              border: 1px solid #ddd;
              border-radius: 4px;
              cursor: pointer;
            ">
            <span style="color: #666; font-size: 14px;">${chrome.i18n.getMessage('createIcon_customColor')}</span>
          </div>
        </div>
      </div>

      <div style="text-align: center; margin-bottom: 20px;">
        <button id="reset-position" style="
          padding: 8px 16px;
          background: #f3f4f6;
          color: #374151;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          margin-right: 10px;
        ">${chrome.i18n.getMessage('createIcon_reset')}</button>
        <button id="toggle-paint" style="
          padding: 8px 16px;
          background: #f3f4f6;
          color: #374151;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          margin-right: 10px;
          display: none;
        ">
          <span id="paint-text">${chrome.i18n.getMessage('createIcon_paint')}</span>
        </button>
        <button id="toggle-eraser" style="
          padding: 8px 16px;
          background: #f3f4f6;
          color: #374151;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          margin-right: 10px;
        ">
          <span id="eraser-text">${chrome.i18n.getMessage('createIcon_eraser')}</span>
        </button>
        <button id="undo-action" style="
          padding: 8px 16px;
          background: #f3f4f6;
          color: #374151;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          margin-right: 10px;
        ">${chrome.i18n.getMessage('createIcon_undo')}</button>
        <button id="preview-icon" style="
          padding: 8px 16px;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
        ">${chrome.i18n.getMessage('createIcon_previewIcon')}</button>
      </div>

      <div id="preview-section" style="display: none; margin-top: 20px; padding: 20px; background: #f9f9f9; border-radius: 8px;">
        <h3 style="margin: 0 0 10px 0; color: #2c3e50;">${chrome.i18n.getMessage('createIcon_iconPreview')}</h3>
        <div style="display: flex; align-items: center; gap: 20px;">
          <canvas id="preview-canvas" width="16" height="16" style="
            width: 64px;
            height: 64px;
            image-rendering: pixelated;
            border: 1px solid #e0e0e0;
          "></canvas>
          <div>
            <p style="margin: 5px 0; color: #666; font-size: 14px;">${chrome.i18n.getMessage('createIcon_actualSize')}</p>
            <p style="margin: 5px 0; color: #666; font-size: 14px;">${chrome.i18n.getMessage('createIcon_format')}</p>
          </div>
        </div>
      </div>
    </div>

    <div style="
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
    ">
      <button id="cancel-art" style="
        padding: 10px 20px;
        background: #f3f4f6;
        color: #374151;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
      ">${chrome.i18n.getMessage('button_cancel')}</button>
      <button id="upload-icon" style="
        padding: 10px 20px;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        display: none;
      ">${chrome.i18n.getMessage('createIcon_uploadIconToYoto')}</button>
    </div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  initializeIconArtEditor();

  document.getElementById('cancel-art').onclick = () => modal.remove();
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove();
  };
}

function initializeIconArtEditor() {
  let imageData = null;
  let imageScale = 1;
  let imageX = 0;
  let imageY = 0;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let eraserMode = false;
  let paintMode = true; // Paint mode is now default
  let erasedPixels = new Set();
  let eraserHistory = [];
  let paintedPixels = new Map();
  let paintHistory = [];
  let actionHistory = []; // Combined history for undo
  let selectedColor = '#FFFFFF'; // Default to white
  let isBlankCanvas = false;
  let isPainting = false; // Track if we're actively painting/erasing by dragging
  let lastPaintedPixel = null; // Track last painted pixel to avoid duplicates
  let currentStrokeActions = [];

  const uploadBtn = document.getElementById('upload-btn');
  const fileInput = document.getElementById('artwork-upload');
  const positioningSection = document.getElementById('positioning-section');
  const positioningImage = document.getElementById('positioning-image');
  const editorSection = document.getElementById('editor-section');
  const artworkImage = document.getElementById('artwork-image');
  const pixelatedCanvas = document.getElementById('pixelated-canvas');
  const referenceSection = document.getElementById('reference-section');
  const referenceImage = document.getElementById('reference-image');
  const pixelEditLabel = document.getElementById('pixel-edit-label');
  const canvasContainer = document.getElementById('canvas-container');
  const gridOverlay = document.getElementById('grid-overlay');
  const gridCanvases = document.querySelectorAll('#grid-lines');
  const gridCanvas = gridCanvases[1] || gridCanvases[0];  // Use the second one if available
  const scaleSlider = document.getElementById('scale-slider');
  const scaleValue = document.getElementById('scale-value');
  const convertToPixelBtn = document.getElementById('convert-to-pixel');
  const previewCanvas = document.getElementById('preview-canvas');
  const uploadIconBtn = document.getElementById('upload-icon');
  const eraserCanvas = document.getElementById('eraser-canvas');
  const togglePaintBtn = document.getElementById('toggle-paint');
  const toggleEraserBtn = document.getElementById('toggle-eraser');
  const undoBtn = document.getElementById('undo-action');
  const paintText = document.getElementById('paint-text');
  const eraserText = document.getElementById('eraser-text');
  const colorPicker = document.getElementById('color-picker');
  const colorPresets = document.querySelectorAll('.color-preset');
  const modeSelection = document.getElementById('mode-selection');
  const uploadSection = document.getElementById('upload-section');
  const scaleControls = document.getElementById('scale-controls');
  const colorPalette = document.getElementById('color-palette');

  function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  }

  const containerSize = 400;
  const gridSize = 400;
  const gridX = 0;
  const gridY = 0;
  gridOverlay.style.left = `${gridX}px`;
  gridOverlay.style.top = `${gridY}px`;
  gridCanvas.style.left = `${gridX}px`;
  gridCanvas.style.top = `${gridY}px`;
  eraserCanvas.style.left = `${gridX}px`;
  eraserCanvas.style.top = `${gridY}px`;

  const ctx = gridCanvas.getContext('2d');
  gridCanvas.width = gridSize;
  gridCanvas.height = gridSize;

  function drawGrid() {
    ctx.clearRect(0, 0, gridSize, gridSize);
    ctx.strokeStyle = 'rgba(200, 200, 200, 0.4)';  // Lighter gray with less opacity
    ctx.lineWidth = 1;

    for (let i = 1; i < 16; i++) {
      const pos = (i * gridSize) / 16;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, gridSize);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(gridSize, pos);
      ctx.stroke();
    }
  }

  drawGrid();

  document.getElementById('image-mode-btn').onclick = () => {
    modeSelection.style.display = 'none';
    uploadSection.style.display = 'block';
    isBlankCanvas = false;
  };

  document.getElementById('blank-mode-btn').onclick = () => {
    modeSelection.style.display = 'none';
    editorSection.style.display = 'block';
    uploadIconBtn.style.display = 'inline-block';
    scaleControls.style.display = 'none';
    isBlankCanvas = true;
    paintMode = true;

    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctxTemp = canvas.getContext('2d');
    ctxTemp.fillStyle = 'white';
    ctxTemp.fillRect(0, 0, 16, 16);

    artworkImage.style.display = 'none';

    eraserCanvas.style.display = 'block';
    eraserCanvas.style.pointerEvents = 'auto';
    colorPalette.style.display = 'block';

    // Ensure grid is visible on top
    gridCanvas.style.zIndex = '10';
    gridCanvas.style.pointerEvents = 'none';

    // Redraw the grid for blank canvas mode
    drawGrid();
  };

  uploadBtn.onclick = () => fileInput.click();

  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        imageData = img;
        positioningImage.src = event.target.result;

        // Initial positioning - center the image
        const initialScale = Math.min(containerSize / img.width, containerSize / img.height);
        const scalePercent = Math.round(initialScale * 100);

        // Ensure scale is within slider bounds (10-300%)
        const boundedScalePercent = Math.max(10, Math.min(300, scalePercent));
        imageScale = boundedScalePercent / 100;

        scaleSlider.value = boundedScalePercent;
        scaleValue.textContent = `${boundedScalePercent}%`;

        // Center the image initially
        const scaledWidth = imageData.width * imageScale;
        const scaledHeight = imageData.height * imageScale;
        imageX = (containerSize - scaledWidth) / 2;
        imageY = (containerSize - scaledHeight) / 2;

        updatePositioningImage();
        uploadSection.style.display = 'none';
        positioningSection.style.display = 'block';

        // Widen the modal for image positioning
        const modalContent = document.querySelector('#yoto-icon-art-modal > div');
        if (modalContent) {
          modalContent.style.maxWidth = '800px';
        }

        paintMode = false;
        eraserMode = false;
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  function updateImagePosition() {
    if (!imageData) return;

    const scaledWidth = imageData.width * imageScale;
    const scaledHeight = imageData.height * imageScale;

    artworkImage.style.width = `${scaledWidth}px`;
    artworkImage.style.height = `${scaledHeight}px`;
    artworkImage.style.left = `${imageX}px`;
    artworkImage.style.top = `${imageY}px`;
  }

  function updatePositioningImage() {
    if (!imageData) return;

    const scaledWidth = imageData.width * imageScale;
    const scaledHeight = imageData.height * imageScale;

    positioningImage.style.width = `${scaledWidth}px`;
    positioningImage.style.height = `${scaledHeight}px`;
    positioningImage.style.left = `${imageX}px`;
    positioningImage.style.top = `${imageY}px`;
  }

  togglePaintBtn.onclick = () => {
    paintMode = !paintMode;

    if (paintMode) {
      if (eraserMode) {
        eraserMode = false;
        eraserText.textContent = chrome.i18n.getMessage('createIcon_eraser');
        toggleEraserBtn.style.background = '#f3f4f6';
        toggleEraserBtn.style.color = '#374151';
      }

      paintText.textContent = chrome.i18n.getMessage('button_disablePaint');
      togglePaintBtn.style.background = '#10b981';
      togglePaintBtn.style.color = 'white';
      eraserCanvas.style.display = 'block';
      eraserCanvas.style.pointerEvents = 'auto';
      artworkImage.style.pointerEvents = 'none';
      colorPalette.style.display = 'block';
      drawPaintedPixels();
    } else {
      paintText.textContent = chrome.i18n.getMessage('button_paint');
      togglePaintBtn.style.background = '#f3f4f6';
      togglePaintBtn.style.color = '#374151';
      eraserCanvas.style.display = 'none';
      eraserCanvas.style.pointerEvents = 'none';
      artworkImage.style.pointerEvents = 'auto';
      colorPalette.style.display = 'none';
    }
  };

  toggleEraserBtn.onclick = () => {
    eraserMode = !eraserMode;
    if (eraserMode) {
      if (paintMode) {
        paintMode = false;
        paintText.textContent = chrome.i18n.getMessage('button_paint');
        togglePaintBtn.style.background = '#f3f4f6';
        togglePaintBtn.style.color = '#374151';
      }

      eraserText.textContent = chrome.i18n.getMessage('createIcon_disableEraser');
      toggleEraserBtn.style.background = '#ef4444';
      toggleEraserBtn.style.color = 'white';
      eraserCanvas.style.display = 'block';
      eraserCanvas.style.pointerEvents = 'auto';
      artworkImage.style.pointerEvents = 'none';
      colorPalette.style.display = 'none';
      drawErasedPixels(); // This will now also draw painted pixels
    } else {
      eraserText.textContent = chrome.i18n.getMessage('createIcon_eraser');
      toggleEraserBtn.style.background = '#f3f4f6';
      toggleEraserBtn.style.color = '#374151';

      if (isBlankCanvas) {
        // For blank canvas, re-enable paint mode
        paintMode = true;
        eraserCanvas.style.display = 'block';
        eraserCanvas.style.pointerEvents = 'auto';
        colorPalette.style.display = 'block';
        drawPaintedPixels();
      } else {
        // For image mode, return to positioning mode
        eraserCanvas.style.display = 'none';
        eraserCanvas.style.pointerEvents = 'none';
        artworkImage.style.pointerEvents = 'auto';
        colorPalette.style.display = 'none';
      }
    }
  };

  undoBtn.onclick = () => {
    if (actionHistory.length > 0) {
      const lastAction = actionHistory.pop();

      if (lastAction.type === 'stroke') {
        for (let i = lastAction.actions.length - 1; i >= 0; i--) {
          const action = lastAction.actions[i];
          if (action.type === 'erase') {
            erasedPixels.delete(action.pixelKey);
            // Restore painted pixel if it was painted before
            if (action.previousPaint) {
              paintedPixels.set(action.pixelKey, action.previousPaint);
            }
          } else if (action.type === 'paint') {
            if (action.previousColor) {
              paintedPixels.set(action.pixelKey, action.previousColor);
            } else {
              paintedPixels.delete(action.pixelKey);
            }
          }
        }
      } else if (lastAction.type === 'erase') {
        erasedPixels.delete(lastAction.pixelKey);
      } else if (lastAction.type === 'paint') {
        if (lastAction.previousColor) {
          paintedPixels.set(lastAction.pixelKey, lastAction.previousColor);
        } else {
          paintedPixels.delete(lastAction.pixelKey);
        }
      }

      // Redraw based on current mode
      if (eraserMode) {
        drawErasedPixels();
      } else {
        drawPaintedPixels();
      }
    }
  };

  // Color picker handlers
  colorPicker.onchange = (e) => {
    selectedColor = e.target.value;
    colorPresets.forEach(p => {
      p.classList.remove('selected');
      p.style.border = 'none';
    });
  };

  colorPresets.forEach(preset => {
    preset.onclick = () => {
      selectedColor = preset.dataset.color;
      colorPicker.value = selectedColor;

      colorPresets.forEach(p => {
        p.classList.remove('selected');
        p.style.border = 'none';
      });
      preset.classList.add('selected');
      preset.style.border = '2px solid #3b82f6';
    };
  });

  function drawPaintedPixels() {
    const eraserCtx = eraserCanvas.getContext('2d');
    eraserCanvas.width = gridSize;
    eraserCanvas.height = gridSize;
    eraserCtx.clearRect(0, 0, gridSize, gridSize);

    erasedPixels.forEach(pixelKey => {
      const [px, py] = pixelKey.split(',').map(Number);
      const pixelSize = gridSize / 16;
      const x = px * pixelSize;
      const y = py * pixelSize;

      eraserCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      eraserCtx.fillRect(x, y, pixelSize, pixelSize);
    });

    paintedPixels.forEach((color, pixelKey) => {
      const [px, py] = pixelKey.split(',').map(Number);
      const pixelSize = gridSize / 16;
      const x = px * pixelSize;
      const y = py * pixelSize;

      eraserCtx.fillStyle = color;
      eraserCtx.fillRect(x, y, pixelSize, pixelSize);

      eraserCtx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
      eraserCtx.lineWidth = 0.5;
      eraserCtx.strokeRect(x, y, pixelSize, pixelSize);
    });
  }

  function drawErasedPixels() {
    const eraserCtx = eraserCanvas.getContext('2d');
    eraserCanvas.width = gridSize;
    eraserCanvas.height = gridSize;
    eraserCtx.clearRect(0, 0, gridSize, gridSize);

    paintedPixels.forEach((color, pixelKey) => {
      const [px, py] = pixelKey.split(',').map(Number);
      const pixelSize = gridSize / 16;
      const x = px * pixelSize;
      const y = py * pixelSize;

      eraserCtx.fillStyle = color;
      eraserCtx.fillRect(x, y, pixelSize, pixelSize);

      eraserCtx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
      eraserCtx.lineWidth = 0.5;
      eraserCtx.strokeRect(x, y, pixelSize, pixelSize);
    });

    eraserCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';

    erasedPixels.forEach(pixelKey => {
      const [px, py] = pixelKey.split(',').map(Number);
      const pixelSize = gridSize / 16;
      const x = px * pixelSize;
      const y = py * pixelSize;

      // Fill with white to show erased area
      eraserCtx.fillRect(x, y, pixelSize, pixelSize);

      eraserCtx.strokeStyle = 'rgba(200, 200, 200, 0.5)';
      eraserCtx.lineWidth = 0.5;
      eraserCtx.strokeRect(x, y, pixelSize, pixelSize);
    });
  }

  function processPixel(x, y, isNewStroke = false) {
    const pixelSize = gridSize / 16;
    const px = Math.floor(x / pixelSize);
    const py = Math.floor(y / pixelSize);

    if (px >= 0 && px < 16 && py >= 0 && py < 16) {
      const pixelKey = `${px},${py}`;

      // Skip if we just painted this pixel (avoid duplicates while dragging)
      if (!isNewStroke && lastPaintedPixel === pixelKey) return;
      lastPaintedPixel = pixelKey;

      if (paintMode) {
        const previousColor = paintedPixels.get(pixelKey) || null;

        // Only paint if it's not already the selected color
        if (!paintedPixels.has(pixelKey) || paintedPixels.get(pixelKey) !== selectedColor) {
          paintedPixels.set(pixelKey, selectedColor);
          const action = { type: 'paint', pixelKey, previousColor, newColor: selectedColor };
          currentStrokeActions.push(action);
          erasedPixels.delete(pixelKey);
          drawPaintedPixels();
        }
      } else if (eraserMode) {
        // Eraser mode
        if (!erasedPixels.has(pixelKey)) {
          const previousPaint = paintedPixels.get(pixelKey) || null;

          erasedPixels.add(pixelKey);
          const action = { type: 'erase', pixelKey, previousPaint };
          currentStrokeActions.push(action);
          paintedPixels.delete(pixelKey);
          drawErasedPixels();
        }
      }
    }
  }

  // Mouse down - start painting/erasing
  eraserCanvas.onmousedown = (e) => {
    if (!paintMode && !eraserMode) return;

    isPainting = true;
    currentStrokeActions = []; // Start new stroke
    lastPaintedPixel = null;

    const rect = eraserCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    processPixel(x, y, true); // Process the initial pixel
    e.preventDefault();
  };

  // Mouse move - continue painting/erasing if mouse is down
  eraserCanvas.onmousemove = (e) => {
    if (!isPainting) return;

    const rect = eraserCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    processPixel(x, y);
    e.preventDefault();
  };

  // Mouse up - stop painting/erasing and save to history
  eraserCanvas.onmouseup = (e) => {
    if (!isPainting) return;

    isPainting = false;
    lastPaintedPixel = null;

    if (currentStrokeActions.length > 0) {
      if (currentStrokeActions.length === 1) {
        // Single pixel - add as single action
        actionHistory.push(currentStrokeActions[0]);
      } else {
        // Multiple pixels - add as a group
        actionHistory.push({ type: 'stroke', actions: currentStrokeActions });
      }
    }
    currentStrokeActions = [];
  };

  // Mouse leave - stop painting if we leave the canvas
  eraserCanvas.onmouseleave = (e) => {
    if (!isPainting) return;

    isPainting = false;
    lastPaintedPixel = null;

    if (currentStrokeActions.length > 0) {
      if (currentStrokeActions.length === 1) {
        actionHistory.push(currentStrokeActions[0]);
      } else {
        actionHistory.push({ type: 'stroke', actions: currentStrokeActions });
      }
    }
    currentStrokeActions = [];
  };

  // Dragging functionality for both images
  artworkImage.onmousedown = (e) => {
    if (eraserMode || paintMode) return; // Can't drag in eraser or paint mode
    isDragging = true;
    dragStartX = e.clientX - imageX;
    dragStartY = e.clientY - imageY;
    artworkImage.style.cursor = 'grabbing';
    e.preventDefault();
  };

  positioningImage.onmousedown = (e) => {
    isDragging = true;
    dragStartX = e.clientX - imageX;
    dragStartY = e.clientY - imageY;
    positioningImage.style.cursor = 'grabbing';
    e.preventDefault();
  };

  document.onmousemove = (e) => {
    if (!isDragging) return;

    // Positioning mode - allow dragging
    if (positioningSection.style.display !== 'none') {
      imageX = e.clientX - dragStartX;
      imageY = e.clientY - dragStartY;
      updatePositioningImage();
    }
    // Editor mode - only allow dragging if not in paint/eraser mode
    else if (!eraserMode && !paintMode) {
      imageX = e.clientX - dragStartX;
      imageY = e.clientY - dragStartY;
      updateImagePosition();
    }
  };

  document.onmouseup = () => {
    // Stop image dragging
    if (isDragging) {
      isDragging = false;
      if (positioningSection.style.display !== 'none') {
        positioningImage.style.cursor = 'move';
      } else if (!eraserMode && !paintMode) {
        artworkImage.style.cursor = 'move';
      }
    }

    // Stop painting if mouse is released anywhere
    if (isPainting) {
      isPainting = false;
      lastPaintedPixel = null;

      if (currentStrokeActions.length > 0) {
        if (currentStrokeActions.length === 1) {
          actionHistory.push(currentStrokeActions[0]);
        } else {
          actionHistory.push({ type: 'stroke', actions: currentStrokeActions });
        }
      }
      currentStrokeActions = [];
    }
  };

  // Scale slider
  scaleSlider.oninput = () => {
    imageScale = scaleSlider.value / 100;
    scaleValue.textContent = `${scaleSlider.value}%`;

    if (positioningSection.style.display !== 'none') {
      updatePositioningImage();
    } else {
      updateImagePosition();
    }
  };

  const resetGridBtn = document.getElementById('reset-grid');
  if (resetGridBtn) {
    resetGridBtn.onclick = () => {
      const modalContent = document.querySelector('#yoto-icon-art-modal > div');
      if (modalContent) {
        modalContent.style.maxWidth = '800px';
      }

      positioningSection.style.display = 'block';
      editorSection.style.display = 'none';

      referenceSection.style.display = 'none';
      pixelEditLabel.style.display = 'none';

      pixelatedCanvas.style.display = 'none';

      erasedPixels.clear();
      paintedPixels.clear();
      actionHistory = [];

      paintMode = false;
      eraserMode = false;
      eraserCanvas.style.display = 'none';
      eraserCanvas.style.pointerEvents = 'none';
      colorPalette.style.display = 'none';
    };
  }

  if (convertToPixelBtn) {
    convertToPixelBtn.onclick = () => {
      if (!imageData) return;

      const modalContent = document.querySelector('#yoto-icon-art-modal > div');
      if (modalContent) {
        modalContent.style.maxWidth = '1100px';
      }

      positioningSection.style.display = 'none';
      editorSection.style.display = 'block';

      referenceSection.style.display = 'block';
      pixelEditLabel.style.display = 'block';

      const pixCanvas = pixelatedCanvas;
      const pixCtx = pixCanvas.getContext('2d');

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 16;
      tempCanvas.height = 16;
      const tempCtx = tempCanvas.getContext('2d');

      const scaledWidth = imageData.width * imageScale;
      const scaledHeight = imageData.height * imageScale;

      const sourceX = Math.max(0, (containerSize / 2 - imageX) / imageScale - (gridSize / 2) / imageScale);
      const sourceY = Math.max(0, (containerSize / 2 - imageY) / imageScale - (gridSize / 2) / imageScale);
      const sourceWidth = gridSize / imageScale;
      const sourceHeight = gridSize / imageScale;

      tempCtx.imageSmoothingEnabled = true;
      tempCtx.imageSmoothingQuality = 'high';

      tempCtx.drawImage(
        imageData,
        sourceX, sourceY, sourceWidth, sourceHeight,
        0, 0, 16, 16
      );

      const imageData16 = tempCtx.getImageData(0, 0, 16, 16);
      const data = imageData16.data;

      for (let i = 0; i < data.length; i += 4) {
        const factor = 1.1; // Contrast factor (1.0 = no change)
        data[i] = Math.min(255, Math.max(0, factor * (data[i] - 128) + 128));     // R
        data[i + 1] = Math.min(255, Math.max(0, factor * (data[i + 1] - 128) + 128)); // G
        data[i + 2] = Math.min(255, Math.max(0, factor * (data[i + 2] - 128) + 128)); // B

        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const gray = 0.2989 * r + 0.5870 * g + 0.1140 * b;
        const satFactor = 1.15; // Saturation factor

        data[i] = Math.min(255, Math.max(0, gray + satFactor * (r - gray)));
        data[i + 1] = Math.min(255, Math.max(0, gray + satFactor * (g - gray)));
        data[i + 2] = Math.min(255, Math.max(0, gray + satFactor * (b - gray)));
      }

      tempCtx.putImageData(imageData16, 0, 0);

      const refCanvas = document.createElement('canvas');
      refCanvas.width = 200;
      refCanvas.height = 200;
      const refCtx = refCanvas.getContext('2d');

      refCtx.drawImage(
        imageData,
        sourceX, sourceY, sourceWidth, sourceHeight,
        0, 0, 200, 200
      );

      referenceImage.src = refCanvas.toDataURL();

      pixCtx.imageSmoothingEnabled = false;
      pixCtx.clearRect(0, 0, containerSize, containerSize);
      pixCtx.drawImage(tempCanvas, 0, 0, 16, 16, 0, 0, containerSize, containerSize);

      pixelatedCanvas.style.display = 'block';
      artworkImage.style.display = 'none';

      paintMode = true;
      eraserMode = false;
      eraserCanvas.style.display = 'block';
      eraserCanvas.style.pointerEvents = 'auto';
      colorPalette.style.display = 'block';
      togglePaintBtn.style.display = 'none'; // Hide paint toggle since we're in edit mode
      uploadIconBtn.style.display = 'inline-block';
    };
  }

  document.getElementById('reset-position').onclick = () => {
    imageX = 0;
    imageY = 0;
    imageScale = 1;
    scaleSlider.value = 100;
    scaleValue.textContent = '100%';

    if (positioningSection.style.display !== 'none') {
      updatePositioningImage();
    } else {
      updateImagePosition();
    }

    erasedPixels.clear();
    paintedPixels.clear();
    actionHistory = [];

    // Redraw based on current mode
    if (eraserMode) {
      drawErasedPixels();
    } else {
      drawPaintedPixels();
    }
  };

  // Preview icon
  document.getElementById('preview-icon').onclick = () => {
    if (!imageData && !isBlankCanvas) return;

    const previewCtx = previewCanvas.getContext('2d', { willReadFrequently: true });
    previewCtx.clearRect(0, 0, 16, 16);

    // For blank canvas mode, just show the painted pixels
    if (isBlankCanvas) {
      // White background for blank canvas
      previewCtx.fillStyle = 'white';
      previewCtx.fillRect(0, 0, 16, 16);
    } else if (pixelatedCanvas.style.display !== 'none') {
      previewCtx.imageSmoothingEnabled = false;
      previewCtx.drawImage(pixelatedCanvas, 0, 0, containerSize, containerSize, 0, 0, 16, 16);
    } else if (imageData) {
      const sourceX = (gridX - imageX) / imageScale;
      const sourceY = (gridY - imageY) / imageScale;
      const sourceWidth = gridSize / imageScale;
      const sourceHeight = gridSize / imageScale;

      previewCtx.drawImage(
        imageData,
        sourceX, sourceY, sourceWidth, sourceHeight,
        0, 0, 16, 16
      );
    }

    const imageData16 = previewCtx.getImageData(0, 0, 16, 16);
    const data = imageData16.data;

    for (let i = 0; i < data.length; i += 4) {
      const pixelIndex = i / 4;
      const px = pixelIndex % 16;
      const py = Math.floor(pixelIndex / 16);
      const pixelKey = `${px},${py}`;

      if (paintedPixels.has(pixelKey)) {
        const color = paintedPixels.get(pixelKey);
        const rgb = hexToRgb(color);
        data[i] = rgb.r;     // Red
        data[i + 1] = rgb.g; // Green
        data[i + 2] = rgb.b; // Blue
        data[i + 3] = 255;   // Alpha (opaque)
      }
      // If this pixel is erased, make it transparent
      else if (erasedPixels.has(pixelKey)) {
        data[i] = 0;     // Red
        data[i + 1] = 0; // Green
        data[i + 2] = 0; // Blue
        data[i + 3] = 0; // Alpha (transparent)
      } else if (!isBlankCanvas) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        // If pixel is very dark (near black), lighten it to dark gray
        if (a > 0 && r < 40 && g < 40 && b < 40) {
          data[i] = Math.max(40, r);     // Red
          data[i + 1] = Math.max(40, g); // Green
          data[i + 2] = Math.max(40, b); // Blue
        }
      }
    }

    previewCtx.putImageData(imageData16, 0, 0);

    document.getElementById('preview-section').style.display = 'block';
  };

  uploadIconBtn.onclick = async () => {
    if (!imageData && !isBlankCanvas) return;

    uploadIconBtn.disabled = true;
    uploadIconBtn.textContent = chrome.i18n.getMessage('button_uploading');

    try {
      const iconCanvas = document.createElement('canvas');
      iconCanvas.width = 16;
      iconCanvas.height = 16;
      const iconCtx = iconCanvas.getContext('2d', { alpha: true, willReadFrequently: true });

      // Clear canvas to ensure transparency
      iconCtx.clearRect(0, 0, 16, 16);

      if (isBlankCanvas) {
        // For blank canvas, start with white background
        iconCtx.fillStyle = 'white';
        iconCtx.fillRect(0, 0, 16, 16);
      } else if (pixelatedCanvas.style.display !== 'none') {
        iconCtx.imageSmoothingEnabled = false;
        iconCtx.drawImage(pixelatedCanvas, 0, 0, containerSize, containerSize, 0, 0, 16, 16);
      } else if (imageData) {
        const sourceX = (gridX - imageX) / imageScale;
        const sourceY = (gridY - imageY) / imageScale;
        const sourceWidth = gridSize / imageScale;
        const sourceHeight = gridSize / imageScale;

        iconCtx.drawImage(
          imageData,
          sourceX, sourceY, sourceWidth, sourceHeight,
          0, 0, 16, 16
        );
      }

      const imageData16 = iconCtx.getImageData(0, 0, 16, 16);
      const data = imageData16.data;

      for (let i = 0; i < data.length; i += 4) {
        const pixelIndex = i / 4;
        const px = pixelIndex % 16;
        const py = Math.floor(pixelIndex / 16);
        const pixelKey = `${px},${py}`;

        if (paintedPixels.has(pixelKey)) {
          const color = paintedPixels.get(pixelKey);
          const rgb = hexToRgb(color);
          data[i] = rgb.r;     // Red
          data[i + 1] = rgb.g; // Green
          data[i + 2] = rgb.b; // Blue
          data[i + 3] = 255;   // Alpha (opaque)
        }
        // If this pixel is erased, make it transparent
        else if (erasedPixels.has(pixelKey)) {
          data[i] = 0;     // Red
          data[i + 1] = 0; // Green
          data[i + 2] = 0; // Blue
          data[i + 3] = 0; // Alpha (transparent)
        } else if (!isBlankCanvas) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];

          // If pixel is very dark (near black), lighten it to dark gray
          if (a > 0 && r < 40 && g < 40 && b < 40) {
            data[i] = Math.max(40, r);     // Red
            data[i + 1] = Math.max(40, g); // Green
            data[i + 2] = Math.max(40, b); // Blue
          }
        }
      }

      iconCtx.putImageData(imageData16, 0, 0);

      iconCanvas.toBlob(async (blob) => {
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = reader.result.split(',')[1];

          const response = await chrome.runtime.sendMessage({
            action: 'UPLOAD_ICON',
            file: {
              data: base64,
              type: 'image/png',
              name: 'custom-icon.png'
            }
          });

          if (response && response.success) {
            uploadIconBtn.textContent = chrome.i18n.getMessage('button_uploaded');
            uploadIconBtn.style.background = '#10b981';

            const tracks = extractTracks();
            if (tracks.length > 0 && response.iconId) {
              await applyCustomIconToTracks(tracks, response.iconId);
            }

            const successNotice = document.createElement('div');
            successNotice.style.cssText = `
              position: fixed;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              background: #10b981;
              color: white;
              padding: 30px 40px;
              border-radius: 12px;
              font-size: 16px;
              z-index: 10000;
              box-shadow: 0 10px 25px rgba(0,0,0,0.2);
              text-align: center;
              min-width: 300px;
            `;
            successNotice.innerHTML = `
              <div style="margin-bottom: 15px; font-size: 18px; font-weight: 600;">${chrome.i18n.getMessage('notification_iconUploadedSuccess')}</div>
              <div style="font-size: 14px; opacity: 0.95;">${chrome.i18n.getMessage('notification_pleaseRefreshPage')}</div>
            `;
            document.body.appendChild(successNotice);

            setTimeout(() => {
              document.getElementById('yoto-icon-art-modal').remove();
            }, 1500);

            setTimeout(() => {
              successNotice.remove();
            }, 6000);
          } else {
            console.error('Icon upload failed:', response?.error || 'Unknown error');
            uploadIconBtn.textContent = chrome.i18n.getMessage('button_uploadFailed');
            uploadIconBtn.style.background = '#ef4444';
            setTimeout(() => {
              uploadIconBtn.textContent = chrome.i18n.getMessage('createIcon_uploadIconToYoto');
              uploadIconBtn.style.background = '#3b82f6';
              uploadIconBtn.disabled = false;
            }, 2000);
          }
        };
        reader.readAsDataURL(blob);
      }, 'image/png');
    } catch (error) {
      console.error('Error uploading icon:', error);
      uploadIconBtn.textContent = chrome.i18n.getMessage('button_uploadFailed');
      uploadIconBtn.style.background = '#ef4444';
      setTimeout(() => {
        uploadIconBtn.textContent = chrome.i18n.getMessage('createIcon_uploadIconToYoto');
        uploadIconBtn.style.background = '#3b82f6';
        uploadIconBtn.disabled = false;
      }, 2000);
    }
  };
}

function extractTracks() {
  // Extract tracks from the page DOM
  const tracks = [];

  // Try to find track elements on the page
  const trackElements = document.querySelectorAll(
    '[class*="track"], [class*="chapter"], div[draggable="true"]'
  );

  trackElements.forEach((element, index) => {
    // Look for text content that might be track titles
    const titleElement = element.querySelector('h3, h4, p, span') || element;
    const title = titleElement.textContent?.trim();

    if (title && title.length > 0) {
      tracks.push({
        key: `chapter-${String(index + 1).padStart(2, '0')}`,
        id: `track-${index}`,
        title: title,
        index: index
      });
    }
  });

  // If no tracks found from DOM, return a default track for the card itself
  if (tracks.length === 0) {
    const playlistNameInput = document.querySelector('input[type="text"]');
    const playlistTitle = playlistNameInput?.value || 'Card Content';

    tracks.push({
      key: 'chapter-01',
      id: 'track-0',
      title: playlistTitle,
      index: 0
    });
  }

  return tracks;
}

async function applyCustomIconToTracks(tracks, iconId) {
  const urlMatch = window.location.pathname.match(/\/card\/([^\/]+)/);
  if (!urlMatch) {
    return;
  }
  const cardId = urlMatch[1];

  for (const track of tracks) {
    try {
      await chrome.runtime.sendMessage({
        action: 'UPDATE_TRACK_ICON',
        cardId: cardId,
        trackKey: track.key || track.id,  // Use track key or id
        iconId: iconId
      });
    } catch (error) {
      console.error('Error applying icon to track:', error);
    }
  }
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
  generalOption.textContent = chrome.i18n.getMessage('button_trackTitle');
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
  categoryOption.textContent = chrome.i18n.getMessage('button_category');
  categoryOption.onmouseenter = () => categoryOption.style.backgroundColor = '#f3f4f6';
  categoryOption.onmouseleave = () => categoryOption.style.backgroundColor = 'transparent';
  
  dropdownMenu.appendChild(generalOption);
  dropdownMenu.appendChild(categoryOption);
  
  button.innerHTML = `
    ${puzzlePieceIcon}
    <span>${chrome.i18n.getMessage('button_iconMatch')}</span>
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
    await handleIconMatch('category');
  };
  
  buttonContainer.appendChild(button);
  buttonContainer.appendChild(dropdownButton);
  buttonContainer.appendChild(dropdownMenu);
  
  return buttonContainer;
}

function showTrackSelectionModal(tracks, callback, matchType, contentResponse = null, button = null) {
  const modal = document.createElement('div');
  modal.id = 'track-selection-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 30px;
    max-width: 600px;
    width: 90%;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  `;

  const tracksWithIcons = tracks.map((track, index) => {
    let hasIcon = track.hasIcon || false;
    let iconUrl = track.iconUrl || null;

    if (!hasIcon && contentResponse && contentResponse.card && contentResponse.card.content && contentResponse.card.content.chapters) {
      const targetChapter = contentResponse.card.content.chapters.find(ch => ch.key === track.chapterKey);
      if (targetChapter && targetChapter.tracks && Array.isArray(targetChapter.tracks)) {
        const apiTrack = targetChapter.tracks.find(t => t.key === track.id);
        if (apiTrack) {
          const trackIcon = apiTrack.display?.icon16x16 || apiTrack.icon16x16 || apiTrack.iconAudioId;
          if (trackIcon) {
            const isDefaultIcon = trackIcon === 'yoto:#aUm9i3ex3qqAMYBv-i-O-pYMKuMJGICtR3Vhf289u2Q' ||
                                  trackIcon.includes('aUm9i3ex3qqAMYBv-i-O-pYMKuMJGICtR3Vhf289u2Q');
            if (!isDefaultIcon) {
              hasIcon = true;
              iconUrl = trackIcon;
            }
          }
        }
      }
    }

    // More thorough DOM checking as fallback
    if (!iconUrl) {
      const trackElements = document.querySelectorAll('[draggable="true"]');
      trackElements.forEach(element => {
        const titleElements = element.querySelectorAll('p, span, h3, h4');
        for (const titleEl of titleElements) {
          const text = titleEl.textContent?.trim();
          if (text === track.title) {
            const iconImg = element.querySelector('img');
            if (iconImg && iconImg.src) {
              const isDefaultIcon = iconImg.src.includes('aUm9i3ex3qqAMYBv-i-O-pYMKuMJGICtR3Vhf289u2Q');
              if (!iconImg.src.includes('data:image') &&
                  !iconImg.src.includes('placeholder') &&
                  !isDefaultIcon &&
                  (iconImg.src.includes('yotocdn') ||
                   iconImg.src.includes('yoto') ||
                   iconImg.src.includes('icon'))) {
                hasIcon = true;
                iconUrl = iconImg.src;
                break;
              }
            }
          }
        }
      });
    }

    return { ...track, hasIcon, selected: !hasIcon, iconUrl };
  });

  const updateContinueButton = () => {
    const selectedCount = tracksWithIcons.filter(t => t.selected).length;
    const continueBtn = document.getElementById('continue-icon-match');
    if (continueBtn) {
      continueBtn.disabled = selectedCount === 0;
      continueBtn.textContent = chrome.i18n.getMessage('button_continue');
      continueBtn.style.opacity = selectedCount === 0 ? '0.5' : '1';
      continueBtn.style.cursor = selectedCount === 0 ? 'not-allowed' : 'pointer';
    }
  };

  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  let xOffset = 0;
  let yOffset = 0;

  content.innerHTML = `
    <div id="modal-header" style="
      margin: -30px -30px 20px -30px;
      padding: 20px 30px;
      background: #f9fafb;
      border-radius: 12px 12px 0 0;
      cursor: move;
      border-bottom: 1px solid #e5e7eb;
    ">
      <h2 style="margin: 0; color: #1f2937; font-size: 20px; font-weight: 600;">
        ${matchType === 'category' ? chrome.i18n.getMessage('modal_selectTracksForIconCategory') : chrome.i18n.getMessage('modal_selectTracksForIconMatch')}
      </h2>
    </div>
    <p style="margin: 0 0 20px 0; color: #6b7280; font-size: 14px;">
      ${chrome.i18n.getMessage('modal_chooseTracksToSearch')}
    </p>

    <div style="display: flex; gap: 10px; margin-bottom: 20px;">
      <button id="select-all-tracks" style="
        padding: 8px 16px;
        background: #f3f4f6;
        color: #374151;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        transition: background-color 0.2s;
      " onmouseover="this.style.backgroundColor='#e5e7eb'" onmouseout="this.style.backgroundColor='#f3f4f6'">${chrome.i18n.getMessage('button_selectAll')}</button>
      <button id="select-none-tracks" style="
        padding: 8px 16px;
        background: #f3f4f6;
        color: #374151;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        transition: background-color 0.2s;
      " onmouseover="this.style.backgroundColor='#e5e7eb'" onmouseout="this.style.backgroundColor='#f3f4f6'">${chrome.i18n.getMessage('button_selectNone')}</button>
      <button id="select-without-icons" style="
        padding: 8px 16px;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        transition: background-color 0.2s;
      " onmouseover="this.style.backgroundColor='#2563eb'" onmouseout="this.style.backgroundColor='#3b82f6'">${chrome.i18n.getMessage('button_selectTracksWithoutIcons')}</button>
    </div>

    <div style="
      flex: 1;
      overflow-y: auto;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 8px;
      background: #ffffff;
    ">
      ${tracksWithIcons.map((track, index) => {
        const defaultIconUrl = chrome.runtime.getURL('assets/images/default-icon.png');
        let iconUrl = defaultIconUrl;

        if (track.iconUrl) {
          iconUrl = track.iconUrl;

          if (iconUrl.startsWith('yoto:#')) {
            const mediaId = iconUrl.replace('yoto:#', '');

            let foundUrl = null;
            const allImages = document.querySelectorAll('img');
            for (const img of allImages) {
              if (img.src && img.src.includes(mediaId)) {
                foundUrl = img.src;
                break;
              }
            }

            if (!foundUrl) {
              iconUrl = `https://api.yotoplay.com/media/${mediaId}/16x16.png`;
            } else {
              iconUrl = foundUrl;
            }
          }
        }

        if (iconUrl === defaultIconUrl && track.hasIcon) {
          const trackElements = document.querySelectorAll('[draggable="true"]');
          trackElements.forEach(element => {
            const titleElements = element.querySelectorAll('p, span, h3, h4');
            for (const titleEl of titleElements) {
              if (titleEl.textContent?.trim() === track.title) {
                const iconImg = element.querySelector('img');
                if (iconImg && iconImg.src && !iconImg.src.includes('data:image')) {
                  iconUrl = iconImg.src;
                  break;
                }
              }
            }
          });
        }

        return `
          ${index > 0 ? `<div style="height: 1px; background: #A4A4A4; background-image: repeating-linear-gradient(90deg, transparent, transparent 2px, #A4A4A4 2px, #A4A4A4 4px); opacity: 0.3; margin: 0 12px;"></div>` : ''}
          <label style="
            display: flex;
            align-items: center;
            padding: 10px 12px;
            background: white;
            cursor: pointer;
            transition: all 0.2s;
          " class="track-selection-item"
          onmouseover="this.style.backgroundColor='#f9fafb'"
          onmouseout="this.style.backgroundColor='white'">
            <input type="checkbox"
              data-track-index="${index}"
              ${track.selected ? 'checked' : ''}
              style="
                margin-right: 8px;
                width: 14px;
                height: 14px;
                cursor: pointer;
                flex-shrink: 0;
              ">
            <div style="
              padding: 0 6px;
              display: flex;
              align-items: center;
              justify-content: center;
            ">
              <img src="${iconUrl}"
                style="
                  width: 32px;
                  height: 32px;
                  border-radius: 4px;
                  object-fit: cover;
                  flex-shrink: 0;
                  image-rendering: pixelated;
                "
                onerror="this.src='${defaultIconUrl}'"
              >
            </div>
            <div style="flex: 1; min-width: 0; margin-left: 8px;">
              <div style="
                font-size: 14px;
                color: #1f2937;
                font-weight: 400;
                line-height: 1.4;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              ">
                ${track.title}
              </div>
            </div>
          </label>
        `;
      }).join('')}
    </div>

    <div style="
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 20px;
    ">
      <button id="cancel-track-selection" style="
        padding: 10px 20px;
        background: #f3f4f6;
        color: #374151;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        transition: background-color 0.2s;
      " onmouseover="this.style.backgroundColor='#e5e7eb'" onmouseout="this.style.backgroundColor='#f3f4f6'">${chrome.i18n.getMessage('button_cancel')}</button>
      <button id="continue-icon-match" style="
        padding: 10px 24px;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: background-color 0.2s;
      " onmouseover="this.style.backgroundColor='#2563eb'" onmouseout="this.style.backgroundColor='#3b82f6'">${chrome.i18n.getMessage('button_continue')}</button>
    </div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  const header = document.getElementById('modal-header');

  function dragStart(e) {
    if (e.type === "touchstart") {
      initialX = e.touches[0].clientX - xOffset;
      initialY = e.touches[0].clientY - yOffset;
    } else {
      initialX = e.clientX - xOffset;
      initialY = e.clientY - yOffset;
    }

    if (e.target === header || header.contains(e.target)) {
      isDragging = true;
    }
  }

  function dragEnd(e) {
    initialX = currentX;
    initialY = currentY;
    isDragging = false;
  }

  function drag(e) {
    if (isDragging) {
      e.preventDefault();

      if (e.type === "touchmove") {
        currentX = e.touches[0].clientX - initialX;
        currentY = e.touches[0].clientY - initialY;
      } else {
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;
      }

      xOffset = currentX;
      yOffset = currentY;

      content.style.transform = `translate(${currentX}px, ${currentY}px)`;
    }
  }

  header.addEventListener('mousedown', dragStart);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', dragEnd);
  header.addEventListener('touchstart', dragStart, { passive: false });
  document.addEventListener('touchmove', drag, { passive: false });
  document.addEventListener('touchend', dragEnd);

  const checkboxes = modal.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const index = parseInt(e.target.dataset.trackIndex);
      tracksWithIcons[index].selected = e.target.checked;
      updateContinueButton();
    });
  });

  document.getElementById('select-all-tracks').onclick = () => {
    checkboxes.forEach((checkbox, index) => {
      checkbox.checked = true;
      tracksWithIcons[index].selected = true;
    });
    updateContinueButton();
  };

  document.getElementById('select-none-tracks').onclick = () => {
    checkboxes.forEach((checkbox, index) => {
      checkbox.checked = false;
      tracksWithIcons[index].selected = false;
    });
    updateContinueButton();
  };

  document.getElementById('select-without-icons').onclick = () => {
    checkboxes.forEach((checkbox, index) => {
      const shouldSelect = !tracksWithIcons[index].hasIcon;
      checkbox.checked = shouldSelect;
      tracksWithIcons[index].selected = shouldSelect;
    });
    updateContinueButton();
  };

  const cleanup = () => {
    document.removeEventListener('mousemove', drag);
    document.removeEventListener('mouseup', dragEnd);
    document.removeEventListener('touchmove', drag);
    document.removeEventListener('touchend', dragEnd);
    modal.remove();
  };

  document.getElementById('cancel-track-selection').onclick = () => {
    cleanup();
    if (button) {
      const puzzlePieceIcon = button.querySelector('svg')?.outerHTML || '';
      button.disabled = false;
      button.innerHTML = `
        ${puzzlePieceIcon}
        <span>${chrome.i18n.getMessage('button_iconMatch')}</span>
      `;
      button.style.opacity = '1';
    }
  };

  document.getElementById('continue-icon-match').onclick = () => {
    const selectedTracks = tracksWithIcons.filter(t => t.selected);
    cleanup();
    callback(selectedTracks);
  };

  updateContinueButton();
}

async function handleIconMatch(matchType) {
  const button = document.getElementById('yoto-magic-btn');
  const puzzlePieceIcon = button.querySelector('svg').outerHTML;

  if (matchType === 'general') {
    const now = Date.now();
    if (!authCached || now - authCacheTime > AUTH_CACHE_DURATION) {
      const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });
      authCached = authResponse.authenticated;
      authCacheTime = now;
    }
    
    if (!authCached) {
      button.innerHTML = `
        ${puzzlePieceIcon}
        <span>${chrome.i18n.getMessage('button_authorizing')}</span>
      `;
      chrome.runtime.sendMessage({ action: 'START_AUTH' });
      setTimeout(() => {
        button.innerHTML = `
          ${puzzlePieceIcon}
          <span>${chrome.i18n.getMessage('button_iconMatch')}</span>
        `;
        authCached = null; // Invalidate cache
      }, 2000);
    } else {
      
      button.disabled = true;
      button.innerHTML = `
        ${puzzlePieceIcon}
        <span>${chrome.i18n.getMessage('button_verifyingAccess')}</span>
      `;
      button.style.opacity = '0.7';

      const urlMatch = window.location.href.match(/\/card\/([^\/]+)/);
      const cardId = urlMatch ? urlMatch[1] : null;

      if (!cardId) {
        alert(chrome.i18n.getMessage('error_couldNotIdentifyCardIdFromUrl'));
        button.disabled = false;
        button.innerHTML = `
          ${puzzlePieceIcon}
          <span>${chrome.i18n.getMessage('button_iconMatch')}</span>
        `;
        button.style.opacity = '1';
        return;
      }

      const verifyResponse = await chrome.runtime.sendMessage({
        action: 'VERIFY_CARD_ACCESS',
        cardId: cardId
      });

      if (verifyResponse.needsAuth) {
        button.innerHTML = `
          ${puzzlePieceIcon}
          <span>${chrome.i18n.getMessage('button_reAuthenticating')}</span>
        `;

        const authResult = await chrome.runtime.sendMessage({ action: 'START_AUTH' });

        if (!authResult.authenticated) {
          alert(chrome.i18n.getMessage('notification_authRequiredForIconMatch'));
          button.disabled = false;
          button.innerHTML = `
            ${puzzlePieceIcon}
            <span>${chrome.i18n.getMessage('button_iconMatch')}</span>
          `;
          button.style.opacity = '1';
          return;
        }

      } else if (!verifyResponse.success) {
        alert(`Error: ${verifyResponse.error}`);
        button.disabled = false;
        button.innerHTML = `
          ${puzzlePieceIcon}
          <span>${chrome.i18n.getMessage('button_iconMatch')}</span>
        `;
        button.style.opacity = '1';
        return;
      }

      button.innerHTML = `
        ${puzzlePieceIcon}
        <span>${chrome.i18n.getMessage('button_fetchingContent')}</span>
      `;
      
      const playlistNameInput = document.querySelector('input[type="text"]');
      const playlistTitle = playlistNameInput?.value || 'Untitled Playlist';
      
      const contentResponse = await chrome.runtime.sendMessage({ 
        action: 'GET_CARD_CONTENT',
        cardId: cardId
      });
      
      const tracks = [];
      
      if (contentResponse.error) {
        if (contentResponse.error.includes('403')) {
        } else if (contentResponse.error.includes('401')) {
          alert(chrome.i18n.getMessage('error_authRequiredRefresh'));
          button.disabled = false;
          button.innerHTML = `${puzzlePieceIcon}<span>${chrome.i18n.getMessage('button_iconMatch')}</span>`;
          button.style.opacity = '1';
          return;
        } else {
          console.error('[Icon Match] API error:', contentResponse.error);
        }
      }
      
      if (!contentResponse.error && contentResponse.card) {
        
        if (contentResponse.card?.content?.chapters && contentResponse.card.content.chapters.length > 0) {
          
          contentResponse.card.content.chapters.forEach((chapter, chapterIndex) => {

            if (chapter.tracks && Array.isArray(chapter.tracks)) {
              chapter.tracks.forEach((track, trackIndex) => {
                if (track.title) {
                  const iconValue = track.display?.icon16x16 || track.icon16x16 || track.iconAudioId;
                  const isDefaultIcon = iconValue && (
                    iconValue === 'yoto:#aUm9i3ex3qqAMYBv-i-O-pYMKuMJGICtR3Vhf289u2Q' ||
                    iconValue === 'yoto:#public/icon.png' ||
                    iconValue.includes('aUm9i3ex3qqAMYBv-i-O-pYMKuMJGICtR3Vhf289u2Q')
                  );
                  const hasIcon = !!(iconValue && !isDefaultIcon);
                  let iconUrl = track.display?.icon16x16 || track.icon16x16 || null;

                  tracks.push({
                    id: track.key || `track-${chapterIndex}-${trackIndex}`,
                    title: track.title,
                    index: tracks.length,
                    type: 'track',
                    chapterKey: chapter.key,
                    chapterTitle: chapter.title,
                    hasIcon: hasIcon,
                    iconUrl: iconUrl
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
          
          if (value.length <= 1) {
            return;
          }
          
          if (value.length > 100) {
            return;
          }
          
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
        
        if (tracks.length === 0) {
          if (contentResponse.card?.title && contentResponse.card.title !== 'Untitled Playlist') {
            tracks.push({
              id: 'card-title',
              title: contentResponse.card.title,
              index: 0,
              type: 'card'
            });
          } else if (playlistTitle && playlistTitle !== 'Untitled Playlist') {
            tracks.push({
              id: 'playlist-title', 
              title: playlistTitle,
              index: 0,
              type: 'playlist'
            });
          }
        }
      }
      
      const actualTracks = tracks.filter(t => t.type === 'track' || (!t.type && t.title && t.title !== playlistTitle));

      if (actualTracks.length === 0) {
        alert(chrome.i18n.getMessage('error_noTracksFound'));
        button.disabled = false;
        button.innerHTML = `
          ${puzzlePieceIcon}
          <span>${chrome.i18n.getMessage('button_iconMatch')}</span>
        `;
        button.style.opacity = '1';
        return;
      }

      showTrackSelectionModal(actualTracks, async (selectedTracks) => {
        if (selectedTracks.length === 0) {
          button.disabled = false;
          button.innerHTML = `
            ${puzzlePieceIcon}
            <span>${chrome.i18n.getMessage('button_iconMatch')}</span>
          `;
          button.style.opacity = '1';
          return;
        }

        button.innerHTML = `
          <svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25" stroke-width="4"/>
            <path d="M12 2a10 10 0 0 1 0 20" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
          </svg>
          <span>${chrome.i18n.getMessage('status_matchingTracks', [selectedTracks.length.toString(), selectedTracks.length !== 1 ? 's' : ''])}</span>
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
          const cacheKey = JSON.stringify(selectedTracks.map(t => t.title));
          let response;

          if (iconMatchCache.has(cacheKey)) {
            response = iconMatchCache.get(cacheKey);
          } else {
            response = await chrome.runtime.sendMessage({
              action: 'MATCH_ICONS',
              tracks: selectedTracks
            });

            if (response.matches && response.matches.length > 0) {
              iconMatchCache.set(cacheKey, response);
              if (iconMatchCache.size > 10) {
                const firstKey = iconMatchCache.keys().next().value;
                iconMatchCache.delete(firstKey);
              }
            }
          }

          if (response.matches && response.matches.length > 0) {
            showIconPreview(response.matches);
          } else {
            alert(chrome.i18n.getMessage('notification_noIconMatchesFound'));
          }
        } catch (error) {
          alert(chrome.i18n.getMessage('notification_errorMatchingIcons'));
        }

        button.disabled = false;
        button.innerHTML = `
          ${puzzlePieceIcon}
          <span>${chrome.i18n.getMessage('button_iconMatch')}</span>
        `;
        button.style.opacity = '1';
      }, matchType, contentResponse, button);
    }
  } else if (matchType === 'category') {
    await handleCategoryIconMatch(button);
  }
}

async function handleUpdatePlaylistAudioIcons(ignoreAudio = false) {
  // Get the cardId from the URL
  const urlMatch = window.location.pathname.match(/\/card\/([^\/]+)/);
  if (!urlMatch) {
    alert(chrome.i18n.getMessage('notification_cardNotFound') || 'Card not found in URL');
    return;
  }
  const cardId = urlMatch[1];

  // Check authentication
  try {
    const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });
    if (!authResponse || !authResponse.authenticated) {
      alert(chrome.i18n.getMessage('notification_authRequiredForUpdate') || 'Authentication required for update');
      return;
    }
  } catch (error) {
    console.error('Auth check failed:', error);
  }

  // Track event
  chrome.runtime.sendMessage({
    action: 'TRACK_EVENT',
    eventName: 'update_playlist_audio_icons_click',
    parameters: { source: 'edit_card_page', ignoreAudio: ignoreAudio }
  });

  // Show the file selection modal (zip or folder)
  showUpdateFileSelectionModal(cardId, ignoreAudio);
}

async function showUpdateFileSelectionModal(cardId, ignoreAudio = false) {
  const existingModal = document.getElementById('yoto-update-file-selection-modal');
  if (existingModal) existingModal.remove();

  // First try to get the title from the input field on the page (for new cards)
  let cardTitle = chrome.i18n.getMessage('label_untitledCard') || 'Untitled Card';
  const inputTitle = document.querySelector('input[placeholder="Give me a name"]')?.value;
  if (inputTitle && inputTitle.trim() !== '') {
    cardTitle = inputTitle;
  }

  // Only fetch card content if it's an existing playlist
  if (cardId && cardId !== 'new' && !cardId.startsWith('temp-')) {
    try {
      const cardContent = await chrome.runtime.sendMessage({
        action: 'GET_CARD_CONTENT',
        cardId: cardId
      });

      if (cardContent && !cardContent.error && cardContent.card && cardContent.card.title) {
        cardTitle = cardContent.card.title;
      }
    } catch (error) {
      console.error('Failed to fetch card content for title:', error);
    }
  }

  const modal = document.createElement('div');
  modal.id = 'yoto-update-file-selection-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 999999;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 20vh;
    background-color: rgba(0, 0, 0, 0.5);
  `;

  modal.innerHTML = `
    <div style="
      background-color: white;
      border-radius: 8px;
      padding: 24px;
      max-width: 400px;
      width: 90%;
      margin: 0 16px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    ">
      <h2 style="font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #1f2937;">${chrome.i18n.getMessage('label_update')} ${cardTitle}</h2>
      <p style="color: #6b7280; margin-bottom: 24px;">${chrome.i18n.getMessage('modal_selectFilesToAdd')}</p>

      <div style="display: flex; flex-direction: column; gap: 12px;">
        <button id="update-zip-btn" style="
          width: 100%;
          padding: 12px 16px;
          background-color: #3b82f6;
          color: white;
          border: none;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          cursor: pointer;
          font-size: 16px;
          font-weight: 500;
          transition: background-color 0.2s;
        " onmouseover="this.style.backgroundColor='#2563eb'" onmouseout="this.style.backgroundColor='#3b82f6'">
          <svg style="width: 20px; height: 20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
          </svg>
          <span>${chrome.i18n.getMessage('button_importZipFile')}</span>
        </button>

        <button id="update-folder-btn" style="
          width: 100%;
          padding: 12px 16px;
          background-color: #10b981;
          color: white;
          border: none;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          cursor: pointer;
          font-size: 16px;
          font-weight: 500;
          transition: background-color 0.2s;
        " onmouseover="this.style.backgroundColor='#059669'" onmouseout="this.style.backgroundColor='#10b981'">
          <svg style="width: 20px; height: 20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
          </svg>
          <span>${chrome.i18n.getMessage('button_importFolder')}</span>
        </button>
      </div>

      <button id="update-cancel-btn" style="
        width: 100%;
        margin-top: 16px;
        padding: 8px 16px;
        background: none;
        border: none;
        color: #6b7280;
        cursor: pointer;
        font-size: 14px;
        transition: color 0.2s;
      " onmouseover="this.style.color='#1f2937'" onmouseout="this.style.color='#6b7280'">
        ${chrome.i18n.getMessage('button_cancel')}
      </button>
    </div>
  `;

  document.body.appendChild(modal);

  // These functions are defined in content.js and are globally available
  document.getElementById('update-zip-btn').addEventListener('click', () => {
    modal.remove();
    if (typeof selectZipFileForUpdate !== 'undefined') {
      selectZipFileForUpdate(cardId, ignoreAudio);
    }
  });

  document.getElementById('update-folder-btn').addEventListener('click', () => {
    modal.remove();
    if (typeof selectFolderForUpdate !== 'undefined') {
      selectFolderForUpdate(cardId, ignoreAudio);
    }
  });

  document.getElementById('update-cancel-btn').addEventListener('click', () => {
    modal.remove();
  });
}

async function handleUpdatePlaylistPodcast() {
  // Get the cardId from the URL
  const urlMatch = window.location.pathname.match(/\/card\/([^\/]+)/);
  if (!urlMatch) {
    alert(chrome.i18n.getMessage('notification_cardNotFound') || 'Card not found in URL');
    return;
  }
  const cardId = urlMatch[1];

  // Check authentication
  try {
    const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });
    if (!authResponse || !authResponse.authenticated) {
      alert(chrome.i18n.getMessage('notification_authRequiredForUpdate') || 'Authentication required for update');
      return;
    }
  } catch (error) {
    console.error('Auth check failed:', error);
  }

  // Track event
  chrome.runtime.sendMessage({
    action: 'TRACK_EVENT',
    eventName: 'update_playlist_podcast_click',
    parameters: { source: 'edit_card_page', cardId: cardId }
  });

  // Check for all URLs permission (same as Import Podcast)
  const permissionCheck = await chrome.runtime.sendMessage({
    action: 'CHECK_ALL_URLS_PERMISSION'
  });

  if (!permissionCheck.granted) {
    // Show permission modal first
    showPodcastPermissionModalForUpdate(cardId);
  } else {
    // We have permission, proceed directly to podcast search
    showPodcastSearchModalForUpdate(cardId);
  }
}

function showPodcastPermissionModalForUpdate(cardId) {
  const existingModal = document.getElementById('podcast-permission-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'podcast-permission-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    z-index: 99999;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 20vh;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    animation: fadeIn 0.3s ease;
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 30px;
    max-width: 500px;
    width: 90%;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    animation: slideDown 0.3s ease;
  `;

  content.innerHTML = `
    <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" style="vertical-align: middle; margin-right: 8px;">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
        <line x1="12" y1="19" x2="12" y2="23"></line>
        <line x1="8" y1="23" x2="16" y2="23"></line>
      </svg>
      ${chrome.i18n.getMessage('modal_importPodcastPermission')}
    </h2>

    <div style="margin-bottom: 24px; color: #4b5563; line-height: 1.6;">
      <p style="margin: 0 0 16px 0;">${chrome.i18n.getMessage('modal_permissionDescription')}</p>

      <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0 0 8px 0; font-weight: 600; color: #374151;">${chrome.i18n.getMessage('modal_permissionTitle')}</p>
        <ul style="margin: 8px 0 0 0; padding-left: 20px; color: #6b7280;">
          <li style="margin: 4px 0;">${chrome.i18n.getMessage('modal_permissionReason1')}</li>
          <li style="margin: 4px 0;">${chrome.i18n.getMessage('modal_permissionReason2')}</li>
          <li style="margin: 4px 0;">${chrome.i18n.getMessage('modal_permissionReason3')}</li>
        </ul>
      </div>

      <p style="margin: 16px 0 0 0; font-size: 14px; color: #6b7280;">
        ${chrome.i18n.getMessage('modal_permissionNote')}
      </p>
    </div>

    <div style="display: flex; gap: 12px; justify-content: flex-end;">
      <button id="permission-cancel" style="
        background: #f3f4f6;
        color: #374151;
        border: none;
        padding: 10px 20px;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s;
      " onmouseover="this.style.background='#e5e7eb'" onmouseout="this.style.background='#f3f4f6'">
        ${chrome.i18n.getMessage('button_cancel')}
      </button>
      <button id="permission-grant" style="
        background: #3b82f6;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s;
      " onmouseover="this.style.background='#2563eb'" onmouseout="this.style.background='#3b82f6'">
        ${chrome.i18n.getMessage('button_grantPermission')}
      </button>
    </div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  document.getElementById('permission-grant').addEventListener('click', async () => {
    const result = await chrome.runtime.sendMessage({
      action: 'REQUEST_ALL_URLS_PERMISSION'
    });

    if (result.granted) {
      content.innerHTML = `
        <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">
          ${chrome.i18n.getMessage('modal_permissionGranted') || 'Permission Granted'}
        </h2>
        <p style="color: #6b7280;">
          ${chrome.i18n.getMessage('modal_proceedingToPodcastSearch') || 'Proceeding to podcast search...'}
        </p>
      `;

      setTimeout(() => {
        modal.remove();
        showPodcastSearchModalForUpdate(cardId);
      }, 1000);
    } else {
      content.innerHTML = `
        <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">
          ${chrome.i18n.getMessage('modal_requestingPermission') || 'Requesting Permission...'}
        </h2>
        <p style="color: #6b7280;">
          ${chrome.i18n.getMessage('modal_checkBrowserSettings') || 'Please grant the permission in the popup window that appears.'}
        </p>
      `;

      setTimeout(async () => {
        const check = await chrome.runtime.sendMessage({
          action: 'CHECK_ALL_URLS_PERMISSION'
        });

        if (check.granted) {
          modal.remove();
          showPodcastSearchModalForUpdate(cardId);
        } else {
          modal.remove();
        }
      }, 1000);
    }
  });

  document.getElementById('permission-cancel').addEventListener('click', () => {
    modal.remove();
  });
}

function showPodcastSearchModalForUpdate(cardId) {
  // This will call the existing showPodcastSearchModal but we need to modify it
  // to handle the cardId and append mode. For now, we'll create a wrapper
  // that stores the cardId and mode, then calls the original function

  // Store the cardId and mode in a global variable so the existing podcast import code can access it
  window.yotoUpdateMode = {
    isUpdateMode: true,
    cardId: cardId,
    appendOnly: true  // This tells the podcast import to only append, not replace
  };

  // Call the existing podcast search modal function from content.js
  if (typeof showPodcastSearchModal !== 'undefined') {
    showPodcastSearchModal();
  } else {
    alert(chrome.i18n.getMessage('error_podcastSearchNotAvailable'));
  }
}

function checkAndInjectButton() {
  // Check if we're on an edit page
  if (!window.location.pathname.includes('/edit')) {
    return false;
  }

  // Check if buttons already exist and are visible
  const existingContainer = document.querySelector('#yoto-card-edit-buttons');
  if (existingContainer && document.body.contains(existingContainer)) {
    // Check if the container is actually visible
    const rect = existingContainer.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      // Also verify the Add GIF button exists (in case of version mismatch)
      const addGifButton = existingContainer.querySelector('#yoto-add-gif-btn');
      if (addGifButton) {
        return true; // Buttons exist and are visible
      }
      // Add GIF button is missing, remove old container and recreate
      existingContainer.remove();
    }
  }

  // Multi-language patterns for "Add audio" button
  const addAudioPatterns = [
    'add audio',           // English
    'ajouter audio',       // French
    'ajouter de l\'audio', // French alternative
    'audio hinzufügen',    // German
    'añadir audio',        // Spanish
    'aggiungi audio',      // Italian
    'dodaj zvok'           // Slovenian
  ];

  const addAudioButton = Array.from(document.querySelectorAll('button')).find(btn => {
    const btnText = btn.textContent?.trim()?.toLowerCase() || '';
    return addAudioPatterns.some(pattern => btnText === pattern || btnText.includes(pattern));
  });

  if (addAudioButton) {
    const buttonContainer = document.createElement('div');
    buttonContainer.id = 'yoto-card-edit-buttons';
    buttonContainer.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 16px;
    `;

    const iconMatchButton = createButton();
    const iconArtButton = createIconArtButton();
    const addGifButton = createAddGifButton();
    const updatePlaylistButton = createUpdatePlaylistButton();
    buttonContainer.appendChild(iconMatchButton);
    buttonContainer.appendChild(iconArtButton);
    buttonContainer.appendChild(addGifButton);
    buttonContainer.appendChild(updatePlaylistButton);

    if (addAudioButton.nextSibling) {
      addAudioButton.parentNode.insertBefore(buttonContainer, addAudioButton.nextSibling);
    } else {
      addAudioButton.parentNode.appendChild(buttonContainer);
    }

    return true;

  } else {
    // Multi-language patterns for "Add stream" button
    const addStreamPatterns = [
      'add stream',          // English
      'ajouter streaming',   // French
      'stream hinzufügen',   // German
      'añadir stream',       // Spanish
      'aggiungi stream',     // Italian
      'dodaj pretok'         // Slovenian
    ];

    const addStreamButton = Array.from(document.querySelectorAll('button')).find(btn => {
      const btnText = btn.textContent?.trim()?.toLowerCase() || '';
      return addStreamPatterns.some(pattern => btnText === pattern || btnText.includes(pattern));
    });

    if (addStreamButton && addStreamButton.parentNode) {
      const buttonContainer = document.createElement('div');
      buttonContainer.id = 'yoto-card-edit-buttons';
      buttonContainer.style.cssText = `
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 16px;
      `;

      const iconMatchButton = createButton();
      const iconArtButton = createIconArtButton();
      const addGifButton = createAddGifButton();
      const updatePlaylistButton = createUpdatePlaylistButton();
      buttonContainer.appendChild(iconMatchButton);
      buttonContainer.appendChild(iconArtButton);
      buttonContainer.appendChild(addGifButton);
      buttonContainer.appendChild(updatePlaylistButton);

      const buttonsParent = addStreamButton.parentNode;
      if (buttonsParent.nextSibling) {
        buttonsParent.parentNode.insertBefore(buttonContainer, buttonsParent.nextSibling);
      } else {
        buttonsParent.parentNode.appendChild(buttonContainer);
      }

      return true;
    } else {
      return false;
    }
  }
}

// Debounce helper to prevent excessive re-injection attempts
let debounceTimer = null;
function debounce(func, delay) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(func, delay);
}

// Persistent observer that keeps watching for DOM changes
let persistentObserver = null;
let lastInjectionAttempt = 0;
const MIN_INJECTION_INTERVAL = 500; // Minimum 500ms between injection attempts

function initialize() {
  // Initial injection attempt
  checkAndInjectButton();

  // Set up persistent observer that never disconnects
  if (!persistentObserver) {
    persistentObserver = new MutationObserver((mutations) => {
      // Debounce to avoid excessive calls during rapid DOM changes
      debounce(() => {
        const now = Date.now();
        // Rate limit injection attempts to once per 500ms
        if (now - lastInjectionAttempt >= MIN_INJECTION_INTERVAL) {
          lastInjectionAttempt = now;
          checkAndInjectButton();
        }
      }, 250); // 250ms debounce delay
    });

    // Wait for DOM to be ready before observing
    const startObserver = () => {
      if (document.body) {
        persistentObserver.observe(document.body, {
          childList: true,
          subtree: true
        });
      } else {
        // If body doesn't exist yet, wait a bit
        setTimeout(startObserver, 10);
      }
    };

    startObserver();
  }

  // Early retry attempts for initial page load (SPAs often render in stages)
  const earlyAttempts = [100, 300, 600, 1000, 2000];
  earlyAttempts.forEach((delay) => {
    setTimeout(() => checkAndInjectButton(), delay);
  });
}

let currentUrl = location.href;
const urlCheckInterval = setInterval(() => {
  const newUrl = location.href;
  if (newUrl !== currentUrl) {
    const wasOnEditPage = currentUrl.includes('/edit');
    const isOnEditPage = newUrl.includes('/edit');
    currentUrl = newUrl;

    if (!isOnEditPage && wasOnEditPage) {
      // Left edit page - cleanup
      cleanup();
    } else if (isOnEditPage && !wasOnEditPage) {
      // Entered edit page - reinitialize
      initialize();
    }
  }
}, 500);

function cleanup() {
  try {
    // Clean up button containers
    const buttonContainer = document.querySelector('#yoto-card-edit-buttons');
    if (buttonContainer) {
      buttonContainer.remove();
    }

    // Clean up modals and overlays
    const elements = [
      '#yoto-icon-art-modal',
      '#yoto-magic-preview',
      '#yoto-refresh-indicator',
      '#yoto-magic-animation-style',
      '#yoto-magic-spinner-style',
      '#yoto-refresh-styles',
      '#yoto-import-modal',
      '#track-selection-modal',
      '#podcast-permission-modal'
    ];

    elements.forEach(selector => {
      const element = document.querySelector(selector);
      if (element) {
        element.remove();
      }
    });
  } catch (error) {
    console.error('[Yoto MYO Magic] Cleanup error:', error);
  }
}

// Import functionality
async function handleImportClick() {
  const button = document.querySelector('#yoto-import-btn');
  const originalContent = button.innerHTML;
  const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });
  if (!authResponse.authenticated) {
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>${chrome.i18n.getMessage('button_authorizing')}</span>
    `;
    chrome.runtime.sendMessage({ action: 'START_AUTH' });
    setTimeout(() => {
      button.innerHTML = originalContent;
    }, 2000);
    return;
  }
  
  const input = document.createElement('input');
  input.type = 'file';
  input.webkitdirectory = true;
  input.directory = true;
  input.multiple = true;
  
  input.onchange = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    let folderName = chrome.i18n.getMessage('label_importedPlaylist');
    if (files[0] && files[0].webkitRelativePath) {
      const pathParts = files[0].webkitRelativePath.split('/');
      if (pathParts.length > 0) {
        folderName = pathParts[0];
      }
    }
    
    const audioFiles = files.filter(f =>
      /\.(m4a|mp3|wav|ogg|aac)$/i.test(f.name) &&
      (f.webkitRelativePath.includes('/audio/') || f.webkitRelativePath.includes('/audio_files/'))
    ).sort((a, b) => a.name.localeCompare(b.name));

    const imageFiles = files.filter(f =>
      /\.(png|jpg|jpeg|gif|webp)$/i.test(f.name)
    );
    
    // Separate track icons (numeric names) from cover images
    const trackIcons = imageFiles.filter(f => /^\d+\.(png|jpg|jpeg)$/i.test(f.name.split('/').pop()))
      .sort((a, b) => {
        const numA = parseInt(a.name.match(/\d+/)[0]);
        const numB = parseInt(b.name.match(/\d+/)[0]);
        return numA - numB;
      });
    
    const coverImage = imageFiles.find(f => !/^\d+\.(png|jpg|jpeg|gif|webp)$/i.test(f.name.split('/').pop()));
    
    if (audioFiles.length === 0) {
      alert(chrome.i18n.getMessage('error_noAudioFilesInFolder'));
      return;
    }
    
    showImportModal(audioFiles, trackIcons, coverImage, folderName);
  };
  
  input.click();
}

function showImportModal(audioFiles, trackIcons, coverImage, defaultName = chrome.i18n.getMessage('label_importedPlaylist')) {
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
    <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">${chrome.i18n.getMessage('modal_importPlaylistTitle')}</h2>
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
      ">${chrome.i18n.getMessage('button_startImport')}</button>
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
  
  document.querySelector('#cancel-import').onclick = () => modal.remove();
  
  document.querySelector('#start-import').onclick = async () => {
    const playlistName = document.querySelector('#import-playlist-name').value || chrome.i18n.getMessage('label_importedPlaylist');
    const progressDiv = document.querySelector('#import-progress');
    const progressBar = document.querySelector('#import-progress-bar');
    const statusText = document.querySelector('#import-status');
    const startButton = document.querySelector('#start-import');
    
    progressDiv.style.display = 'block';
    startButton.disabled = true;
    startButton.textContent = chrome.i18n.getMessage('button_importing');
    
    try {
      const urlMatch = window.location.href.match(/\/card\/([^\/]+)/);
      let cardId = urlMatch ? urlMatch[1] : null;

      if (cardId && cardId.includes('/')) {
        cardId = cardId.split('/')[0];
      }
      
      let coverUrl = null;
      if (coverImage) {
        statusText.textContent = chrome.i18n.getMessage('status_uploadingCoverImage');
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
      
      statusText.textContent = chrome.i18n.getMessage('status_uploadingIcons');
      progressBar.style.width = '10%';

      const iconIds = [];
      const BATCH_SIZE = 5; // Upload 5 icons at a time for better parallelism

      // Pre-convert all icons to base64 in parallel for faster processing
      const iconBase64Promises = trackIcons.map(file => fileToBase64(file));
      const iconBase64Results = await Promise.all(iconBase64Promises);

      for (let i = 0; i < trackIcons.length; i += BATCH_SIZE) {
        const batch = iconBase64Results.slice(i, Math.min(i + BATCH_SIZE, trackIcons.length));
        statusText.textContent = chrome.i18n.getMessage('status_uploadingIconsProgress', [(i + 1).toString(), Math.min(i + BATCH_SIZE, trackIcons.length).toString(), trackIcons.length.toString()]);

        const batchPromises = batch.map(async (iconBase64, batchIndex) => {
          try {
            const response = await chrome.runtime.sendMessage({
              action: 'UPLOAD_ICON',
              file: iconBase64
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
      
      statusText.textContent = chrome.i18n.getMessage('status_processingAudioFiles');
      progressBar.style.width = '40%';

      const audioTracks = [];
      const AUDIO_BATCH_SIZE = 3; // Process 3 audio files concurrently to avoid overload

      // Pre-convert audio files to base64 in smaller batches to manage memory
      for (let i = 0; i < audioFiles.length; i += AUDIO_BATCH_SIZE) {
        const audioBatch = audioFiles.slice(i, Math.min(i + AUDIO_BATCH_SIZE, audioFiles.length));
        statusText.textContent = chrome.i18n.getMessage('status_processingAudioProgress', [(i + 1).toString(), Math.min(i + AUDIO_BATCH_SIZE, audioFiles.length).toString(), audioFiles.length.toString()]);

        const audioBase64Promises = audioBatch.map(file => fileToBase64(file));
        const audioBase64Results = await Promise.all(audioBase64Promises);

        const uploadPromises = audioBase64Results.map(async (audioBase64, batchIndex) => {
          const fileIndex = i + batchIndex;
          try {
            const response = await chrome.runtime.sendMessage({
              action: 'UPLOAD_AUDIO',
              file: audioBase64
            });

            if (response.success) {
              return {
                index: fileIndex,
                track: {
                  trackUrl: response.trackUrl,
                  duration: response.duration,
                  fileSize: response.fileSize,
                  channels: response.channels,
                  format: response.format,
                  title: response.title || audioFiles[fileIndex].name.replace(/\.[^/.]+$/, '')
                }
              };
            } else {
              throw new Error(`Failed to upload audio ${fileIndex + 1}: ${response.error}`);
            }
          } catch (error) {
            console.error(`Failed to upload audio ${fileIndex + 1}:`, error);
            throw error;
          }
        });

        const results = await Promise.all(uploadPromises);

        results.sort((a, b) => a.index - b.index);
        results.forEach(result => audioTracks.push(result.track));

        progressBar.style.width = `${40 + (40 * Math.min(i + AUDIO_BATCH_SIZE, audioFiles.length) / audioFiles.length)}%`;
      }
      
      statusText.textContent = chrome.i18n.getMessage('status_creatingPlaylist');
      progressBar.style.width = '80%';

      // Transform audioTracks to the expected format for createPlaylistContent
      const formattedAudioTracks = audioTracks.map(track => {
        // Extract SHA256 from trackUrl (format: "yoto:#<sha256>")
        const sha256Match = track.trackUrl?.match(/^yoto:#(.+)$/);
        const sha256 = sha256Match ? sha256Match[1] : '';

        return {
          title: track.title,
          transcodedAudio: {
            transcodedSha256: sha256,
            transcodedInfo: {
              duration: track.duration || 0,
              format: track.format || 'mp3',
              fileSize: track.fileSize || 0,
              channels: track.channels === 1 ? 'mono' : 'stereo'
            }
          }
        };
      });

      const createResponse = await chrome.runtime.sendMessage({
        action: 'CREATE_PLAYLIST_CONTENT',
        title: playlistName,
        audioTracks: formattedAudioTracks,
        iconIds: iconIds,
        cardId: cardId,
        coverUrl: coverUrl
      });
      
      if (!createResponse.success) {
        throw new Error(`Failed to create playlist: ${createResponse.error}`);
      }
      
      progressBar.style.width = '100%';
      statusText.textContent = chrome.i18n.getMessage('status_importComplete');
      
      setTimeout(() => {
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
            <h2 style="margin: 0 0 10px 0; color: #2c3e50; font-size: 24px;">${chrome.i18n.getMessage('modal_importComplete')}</h2>
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
        
        // Removed automatic refresh to avoid interrupting audio uploads
        // User can manually refresh when ready
        // setTimeout(() => {
        //   window.location.reload();
        // }, 2000);
      }, 500);
      
    } catch (error) {
      alert(chrome.i18n.getMessage('notification_importFailedMessage', [error.message]));
      modal.remove();
    }
  };
  
  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const arrayBuffer = reader.result;
        const bytes = new Uint8Array(arrayBuffer);

        // Use faster base64 encoding for larger files
        const chunkSize = 0x8000; // 32KB chunks
        let binary = '';
        for (let i = 0; i < bytes.length; i += chunkSize) {
          const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
          binary += String.fromCharCode.apply(null, chunk);
        }

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

// Initialize based on document ready state
function initializeWhenReady() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(initialize, 100); // Small delay to let the page framework initialize
    });
  } else {
    initialize();
  }
}

// Additional check on full page load (for SPAs that lazy-load content)
window.addEventListener('load', () => {
  // Trigger a check, the persistent observer will handle re-injection if needed
  setTimeout(() => checkAndInjectButton(), 500);
});

// Start initialization
initializeWhenReady();

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

async function handleCategoryIconMatch(button) {
  const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });
  if (!authResponse.authenticated) {
    chrome.runtime.sendMessage({ action: 'START_AUTH' });
    return;
  }

  const urlMatch = window.location.href.match(/\/card\/([^\/]+)/);
  const cardId = urlMatch ? urlMatch[1] : null;

  if (!cardId) {
    alert(chrome.i18n.getMessage('error_couldNotIdentifyCardIdFromUrl'));
    return;
  }

  const contentResponse = await chrome.runtime.sendMessage({
    action: 'GET_CARD_CONTENT',
    cardId: cardId
  });

  const tracks = [];

  if (contentResponse.card && contentResponse.card.content && contentResponse.card.content.chapters) {
    contentResponse.card.content.chapters.forEach((chapter, chapterIndex) => {
      const chapterIcon = chapter.display?.icon16x16 || null;

      if (chapter.tracks && Array.isArray(chapter.tracks)) {
        chapter.tracks.forEach((track, trackIndex) => {
          if (track.title) {
            const trackIcon = track.display?.icon16x16 || track.icon16x16 || track.iconAudioId;
            const iconValue = trackIcon || chapterIcon;

            const isDefaultIcon = iconValue && (
              iconValue === 'yoto:#aUm9i3ex3qqAMYBv-i-O-pYMKuMJGICtR3Vhf289u2Q' ||
              iconValue.includes('aUm9i3ex3qqAMYBv-i-O-pYMKuMJGICtR3Vhf289u2Q')
            );
            const hasIcon = !!(iconValue && !isDefaultIcon);
            let iconUrl = iconValue || null;

            tracks.push({
              id: track.key || `track-${chapterIndex}-${trackIndex}`,
              title: track.title,
              index: tracks.length,
              type: 'track',
              chapterKey: chapter.key,
              chapterTitle: chapter.title,
              hasIcon: hasIcon,
              iconUrl: iconUrl
            });
          }
        });
      }
    });
  }

  const actualTracks = tracks.filter(t => t.type === 'track');

  if (actualTracks.length === 0) {
    alert(chrome.i18n.getMessage('error_noTracksFound'));

    if (button) {
      const puzzlePieceIcon = button.querySelector('svg')?.outerHTML || '';
      button.disabled = false;
      button.innerHTML = `
        ${puzzlePieceIcon}
        <span>${chrome.i18n.getMessage('button_iconMatch')}</span>
      `;
      button.style.opacity = '1';
    }
    return;
  }

  const tracksWithIcons = actualTracks.map((track) => {
    let iconUrl = track.iconUrl || null;

    if (!iconUrl && contentResponse && contentResponse.card && contentResponse.card.content && contentResponse.card.content.chapters) {
      const targetChapter = contentResponse.card.content.chapters.find(ch => ch.key === track.chapterKey);
      if (targetChapter && targetChapter.tracks && Array.isArray(targetChapter.tracks)) {
        const apiTrack = targetChapter.tracks.find(t => t.key === track.id);
        if (apiTrack) {
          const trackIcon = apiTrack.display?.icon16x16 || apiTrack.icon16x16 || apiTrack.iconAudioId;
          if (trackIcon) {
            iconUrl = trackIcon;
          }
        }
      }
    }

    // DOM fallback
    if (!iconUrl) {
      const trackElements = document.querySelectorAll('[draggable="true"]');
      trackElements.forEach(element => {
        if (iconUrl) return;
        const titleElements = element.querySelectorAll('p, span, h3, h4');
        for (const titleEl of titleElements) {
          const text = titleEl.textContent?.trim();
          if (text === track.title) {
            const iconImg = element.querySelector('img');
            if (iconImg && iconImg.src && !iconImg.src.includes('data:image') && !iconImg.src.includes('placeholder')) {
              iconUrl = iconImg.src;
              break;
            }
          }
        }
      });
    }

    return { ...track, iconUrl };
  });

  showCategorySelectionModal(cardId, tracksWithIcons);
}

function showCategorySelectionModal(cardId, selectedTracks) {
  const trackCount = selectedTracks.length;
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

  // Common categories for icons - value is English (for API), label is localized
  const categories = [
    { value: 'animals', label: chrome.i18n.getMessage('category_animals') },
    { value: 'art', label: chrome.i18n.getMessage('category_art') },
    { value: 'buildings', label: chrome.i18n.getMessage('category_buildings') },
    { value: 'chapters', label: chrome.i18n.getMessage('category_chapters') },
    { value: 'emotions', label: chrome.i18n.getMessage('category_emotions') },
    { value: 'fantasy', label: chrome.i18n.getMessage('category_fantasy') },
    { value: 'food', label: chrome.i18n.getMessage('category_food') },
    { value: 'games', label: chrome.i18n.getMessage('category_games') },
    { value: 'holiday', label: chrome.i18n.getMessage('category_holiday') },
    { value: 'music', label: chrome.i18n.getMessage('category_music') },
    { value: 'nature', label: chrome.i18n.getMessage('category_nature') },
    { value: 'school', label: chrome.i18n.getMessage('category_school') },
    { value: 'space', label: chrome.i18n.getMessage('category_space') },
    { value: 'science', label: chrome.i18n.getMessage('category_science') },
    { value: 'sports', label: chrome.i18n.getMessage('category_sports') },
    { value: 'tools', label: chrome.i18n.getMessage('category_tools') },
    { value: 'transportation', label: chrome.i18n.getMessage('category_transportation') },
    { value: 'weather', label: chrome.i18n.getMessage('category_weather') }
  ];

  const plural = trackCount !== 1 ? 's' : '';
  content.innerHTML = `
    <style>
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    </style>
    <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">${chrome.i18n.getMessage('modal_categoryIconMatch')}</h2>
    <p style="margin: 0 0 20px 0; color: #666; font-size: 14px;">
      ${chrome.i18n.getMessage('modal_categoryDescription', [trackCount.toString(), plural])}
    </p>

    <div style="margin-bottom: 20px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #374151;">
        ${chrome.i18n.getMessage('modal_chooseCategory')}
      </label>
      <select id="category-select" style="
        width: 100%;
        padding: 10px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 14px;
      ">
        <option value="">${chrome.i18n.getMessage('modal_selectCategory')}</option>
        ${categories.map(cat => `<option value="${cat.value}">${cat.label}</option>`).join('')}
      </select>
    </div>

    <div style="margin-bottom: 20px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #374151;">
        ${chrome.i18n.getMessage('modal_customCategory')}
      </label>
      <div id="keyword-chips-container" style="
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 8px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        min-height: 42px;
        align-items: center;
        cursor: text;
        background: white;
      ">
        <input type="text" id="custom-category" placeholder="${chrome.i18n.getMessage('modal_customCategoryPlaceholder')}" style="
          flex: 1;
          min-width: 120px;
          border: none;
          outline: none;
          font-size: 14px;
          padding: 2px 4px;
        ">
      </div>
      <p style="margin: 6px 0 0 0; font-size: 12px; color: #9ca3af;">${chrome.i18n.getMessage('label_pressEnterToAdd')}</p>
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
      ">${chrome.i18n.getMessage('button_cancel')}</button>
      <button id="category-search" style="
        padding: 10px 20px;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">${chrome.i18n.getMessage('button_searchIcons')}</button>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);

  const categorySelect = document.getElementById('category-select');
  const customCategory = document.getElementById('custom-category');
  const chipsContainer = document.getElementById('keyword-chips-container');
  const keywords = [];

  chipsContainer.addEventListener('click', () => {
    customCategory.focus();
  });

  function createChip(keyword) {
    const chip = document.createElement('span');
    chip.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #f3f4f6;
      color: #374151;
      padding: 4px 8px 4px 12px;
      border-radius: 16px;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    `;
    chip.dataset.keyword = keyword;

    const text = document.createElement('span');
    text.textContent = keyword;

    const removeBtn = document.createElement('button');
    removeBtn.innerHTML = '&times;';
    removeBtn.style.cssText = `
      background: none;
      border: none;
      color: #6b7280;
      font-size: 16px;
      cursor: pointer;
      padding: 0 2px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    removeBtn.addEventListener('mouseenter', () => {
      removeBtn.style.color = '#374151';
    });
    removeBtn.addEventListener('mouseleave', () => {
      removeBtn.style.color = '#6b7280';
    });
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = keywords.indexOf(keyword);
      if (index > -1) {
        keywords.splice(index, 1);
      }
      chip.remove();
      customCategory.placeholder = keywords.length === 0 ? chrome.i18n.getMessage('modal_customCategoryPlaceholder') : '';
    });

    chip.appendChild(text);
    chip.appendChild(removeBtn);
    return chip;
  }

  function addKeyword(keyword) {
    const trimmed = keyword.trim().toLowerCase();
    if (!trimmed || keywords.includes(trimmed)) {
      return false;
    }
    keywords.push(trimmed);
    const chip = createChip(trimmed);
    chipsContainer.insertBefore(chip, customCategory);
    customCategory.value = '';
    customCategory.placeholder = '';
    categorySelect.value = '';
    return true;
  }

  categorySelect.addEventListener('change', () => {
    if (categorySelect.value) {
      keywords.length = 0;
      const chips = chipsContainer.querySelectorAll('span[data-keyword]');
      chips.forEach(chip => chip.remove());
      customCategory.value = '';
      customCategory.placeholder = chrome.i18n.getMessage('modal_customCategoryPlaceholder');
    }
  });

  customCategory.addEventListener('input', () => {
    if (customCategory.value || keywords.length > 0) {
      categorySelect.value = '';
    }
  });

  customCategory.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (customCategory.value.trim()) {
        addKeyword(customCategory.value);
      } else if (keywords.length > 0 || categorySelect.value) {
        // Trigger search if we have keywords or category selected
        document.getElementById('category-search').click();
      }
    } else if (e.key === 'Backspace' && customCategory.value === '' && keywords.length > 0) {
      // Remove last chip on backspace when input is empty
      const lastKeyword = keywords.pop();
      const lastChip = chipsContainer.querySelector(`span[data-keyword="${lastKeyword}"]`);
      if (lastChip) lastChip.remove();
      customCategory.placeholder = keywords.length === 0 ? chrome.i18n.getMessage('modal_customCategoryPlaceholder') : '';
    }
  });

  customCategory.addEventListener('blur', () => {
    if (customCategory.value.trim()) {
      addKeyword(customCategory.value);
    }
  });

  categorySelect.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('category-search').click();
    }
  });

  document.getElementById('category-cancel').addEventListener('click', () => {
    modal.remove();
  });

  document.getElementById('category-search').addEventListener('click', async () => {
    if (customCategory.value.trim()) {
      addKeyword(customCategory.value);
    }

    const searchKeywords = keywords.length > 0 ? [...keywords] : (categorySelect.value ? [categorySelect.value] : []);
    const displayCategory = keywords.length > 0 ? keywords.join(', ') : categorySelect.value;

    if (searchKeywords.length === 0) {
      alert(chrome.i18n.getMessage('notification_selectOrEnterCategory'));
      return;
    }

    const searchBtn = document.getElementById('category-search');
    const originalBtnContent = searchBtn.innerHTML;
    searchBtn.innerHTML = `
      <div style="display: inline-flex; align-items: center; gap: 8px;">
        <div style="
          width: 14px;
          height: 14px;
          border: 2px solid white;
          border-top-color: transparent;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        "></div>
        <span>Searching...</span>
      </div>
    `;
    searchBtn.disabled = true;

    const searchResponse = await chrome.runtime.sendMessage({
      action: 'SEARCH_ICONS_BY_CATEGORY',
      category: searchKeywords.length === 1 ? searchKeywords[0] : null,
      keywords: searchKeywords
    });

    if (searchResponse.error) {
      alert(chrome.i18n.getMessage('notification_errorSearchingIcons', [searchResponse.error]));
      searchBtn.innerHTML = originalBtnContent;
      searchBtn.disabled = false;
      modal.remove();
      return;
    }

    if (!searchResponse.icons || searchResponse.icons.length === 0) {
      alert(`${chrome.i18n.getMessage('modal_noIconsFound')} for "${displayCategory}". Please try other keywords.`);
      searchBtn.innerHTML = originalBtnContent;
      searchBtn.disabled = false;
      return;
    }

    modal.remove();
    showIconSelectionModal(cardId, selectedTracks, searchResponse.icons, displayCategory, searchKeywords);
  });
}

function showIconSelectionModal(cardId, selectedTracks, icons, category, searchKeywords = null) {
  const trackCount = selectedTracks.length;
  const pollKeywords = searchKeywords || [category];
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
    padding: 0;
    max-width: 800px;
    width: 90%;
    max-height: 80vh;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    position: relative;
  `;

  const iconsPerPage = 500;

  const skipIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12,24C5.4,24,0,18.6,0,12S5.4,0,12,0s12,5.4,12,12S18.6,24,12,24z M12,2C6.5,2,2,6.5,2,12s4.5,10,10,10s10-4.5,10-10S17.5,2,12,2z"/>
    <path d="M8,17c-0.3,0-0.5-0.1-0.7-0.3c-0.4-0.4-0.4-1,0-1.4l8-8c0.4-0.4,1-0.4,1.4,0s0.4,1,0,1.4l-8,8C8.5,16.9,8.3,17,8,17z"/>
    <path d="M16,17c-0.3,0-0.5-0.1-0.7-0.3l-8-8c-0.4-0.4-0.4-1,0-1.4s1-0.4,1.4,0l8,8c0.4,0.4,0.4,1,0,1.4C16.5,16.9,16.3,17,16,17z"/>
  </svg>`;

  const defaultIconUrl = chrome.runtime.getURL('assets/images/default-icon.png');

  function resolveIconUrl(track) {
    let iconUrl = defaultIconUrl;

    if (track.iconUrl) {
      iconUrl = track.iconUrl;

      if (iconUrl.startsWith('yoto:#')) {
        const mediaId = iconUrl.replace('yoto:#', '');

        let foundUrl = null;
        const allImages = document.querySelectorAll('img');
        for (const img of allImages) {
          if (img.src && img.src.includes(mediaId)) {
            foundUrl = img.src;
            break;
          }
        }

        if (foundUrl) {
          iconUrl = foundUrl;
        } else {
          iconUrl = `https://api.yotoplay.com/media/${mediaId}/16x16.png`;
        }
      }
    }

    if (iconUrl === defaultIconUrl) {
      const trackElements = document.querySelectorAll('[draggable="true"]');
      trackElements.forEach(element => {
        const titleElements = element.querySelectorAll('p, span, h3, h4');
        for (const titleEl of titleElements) {
          if (titleEl.textContent?.trim() === track.title) {
            const iconImg = element.querySelector('img');
            if (iconImg && iconImg.src && !iconImg.src.includes('data:image')) {
              iconUrl = iconImg.src;
              break;
            }
          }
        }
      });
    }

    return iconUrl;
  }

  const trackListHtml = selectedTracks.map((track, index) => {
    const currentIconUrl = resolveIconUrl(track);
    const iconPreviewHtml = `<img class="track-icon-preview" src="${currentIconUrl}" data-original-icon="${currentIconUrl}" style="
          width: 24px;
          height: 24px;
          object-fit: cover;
          border-radius: 4px;
          flex-shrink: 0;
        " onerror="this.src='${defaultIconUrl}';" />`;

    return `
    <div class="track-row" data-track-index="${index}" data-original-icon="${currentIconUrl || ''}" style="
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 10px;
      border-radius: 4px;
      transition: all 0.2s;
    ">
      ${iconPreviewHtml}
      <span class="track-name" style="
        font-size: 13px;
        color: #374151;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      ">${index + 1}. ${track.title || track.trackTitle || chrome.i18n.getMessage('label_untitled')}</span>
      <button class="skip-btn" data-track-index="${index}" title="${chrome.i18n.getMessage('tooltip_skipTrack')}" style="
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #9ca3af;
        transition: color 0.2s;
        border-radius: 4px;
      ">${skipIconSvg}</button>
    </div>
  `;
  }).join('');

  content.innerHTML = `
    <style>
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .track-row:hover {
        background-color: #f9fafb;
      }
      .track-row.skipped {
        background-color: #fef2f2;
      }
      .track-row.skipped .track-name {
        color: #9ca3af;
      }
      .skip-btn:hover {
        background-color: #f3f4f6;
      }
    </style>
    <div id="modal-header" style="
      padding: 20px 30px 15px 30px;
      cursor: move;
      border-bottom: 1px solid #e5e7eb;
      background: #f9fafb;
      border-radius: 12px 12px 0 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
    ">
      <div>
        <h2 style="margin: 0 0 5px 0; color: #2c3e50; font-size: 20px;">${chrome.i18n.getMessage('modal_selectIconsFor', [category])}</h2>
        <p style="margin: 0; color: #666; font-size: 13px;">
          ${chrome.i18n.getMessage('modal_chooseIconsDescription')}
        </p>
      </div>
      <div style="display: flex; align-items: center; gap: 8px; color: #9ca3af;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 9h14M5 15h14"/>
        </svg>
      </div>
    </div>
    <div id="modal-body" style="padding: 20px 30px 30px 30px; overflow-y: auto; max-height: calc(80vh - 120px);">

    <div style="margin-bottom: 15px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
        <label style="font-size: 13px; font-weight: 500; color: #374151;">${chrome.i18n.getMessage('label_tracks')} <span style="color: #9ca3af; font-weight: normal;">(${chrome.i18n.getMessage('label_clickToSkip')})</span></label>
        <span id="skip-count" style="font-size: 12px; color: #9ca3af;"></span>
      </div>
      <div id="track-list" style="
        max-height: 150px;
        overflow-y: auto;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        padding: 4px;
      ">
        ${trackListHtml}
      </div>
    </div>

    <div style="margin-bottom: 8px;">
      <label style="font-size: 13px; font-weight: 500; color: #374151;">${chrome.i18n.getMessage('label_selectIcons')}</label>
    </div>
    <div id="icon-grid" style="
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
      gap: 8px;
      margin-bottom: 15px;
      max-height: 280px;
      overflow-y: auto;
      padding: 10px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
    "></div>

    <div id="selection-summary" style="margin-bottom: 15px; padding: 10px; background: #f9fafb; border-radius: 6px;">
      <p id="selection-text" style="margin: 0; font-size: 13px; color: #6b7280;">
        ${chrome.i18n.getMessage('label_selectedIconsFor', ['0', trackCount.toString()])}
      </p>
    </div>

    <div style="display: flex; gap: 12px; justify-content: space-between; align-items: center;">
      <div id="search-status" style="
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        color: #6b7280;
        font-weight: 500;
      ">
        <svg id="loading-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;">
          <circle cx="12" cy="12" r="10" opacity="0.25"></circle>
          <path d="M12 2 A10 10 0 0 1 22 12" opacity="1"></path>
        </svg>
        <svg id="complete-checkmark" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display: none;">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span id="status-text">${chrome.i18n.getMessage('status_loading')}</span>
      </div>
      <div style="display: flex; gap: 12px;">
        <button id="icon-cancel" style="
          padding: 10px 20px;
          background: #f3f4f6;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: background-color 0.2s;
        " onmouseover="this.style.backgroundColor='#e5e7eb'" onmouseout="this.style.backgroundColor='#f3f4f6'">${chrome.i18n.getMessage('button_cancel')}</button>
        <button id="icon-apply" style="
          padding: 10px 20px;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: background-color 0.2s;
        " onmouseover="this.style.backgroundColor='#2563eb'" onmouseout="this.style.backgroundColor='#3b82f6'" disabled>${chrome.i18n.getMessage('button_applyIcons')}</button>
      </div>
    </div>
    </div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  const modalHeader = document.getElementById('modal-header');
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };

  modalHeader.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
    isDragging = true;
    const rect = content.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    content.style.position = 'fixed';
    content.style.margin = '0';
    content.style.left = rect.left + 'px';
    content.style.top = rect.top + 'px';
    modal.style.alignItems = 'flex-start';
    modal.style.justifyContent = 'flex-start';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const newX = e.clientX - dragOffset.x;
    const newY = e.clientY - dragOffset.y;

    const maxX = window.innerWidth - content.offsetWidth;
    const maxY = window.innerHeight - content.offsetHeight;
    content.style.left = Math.max(0, Math.min(newX, maxX)) + 'px';
    content.style.top = Math.max(0, Math.min(newY, maxY)) + 'px';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });

  const iconGrid = document.getElementById('icon-grid');
  const selectedIcons = [];
  const selectedIconElements = new Map();
  let currentlyDisplayed = 0;
  let allIcons = [...icons];
  let isSearchComplete = false;
  let pollInterval = null;

  const skippedTracks = new Set();

  function updateSkipCount() {
    const skipCountEl = document.getElementById('skip-count');
    const activeCount = trackCount - skippedTracks.size;

    if (skippedTracks.size > 0) {
      skipCountEl.textContent = chrome.i18n.getMessage('label_numSkipped', [skippedTracks.size.toString()]);
    } else {
      skipCountEl.textContent = '';
    }

    const selectionTextEl = document.getElementById('selection-text');
    if (selectionTextEl) {
      selectionTextEl.textContent = chrome.i18n.getMessage('label_selectedIconsFor', [selectedIcons.length.toString(), activeCount.toString()]);
    }
  }

  function getActiveTrackIndices() {
    return selectedTracks.map((_, i) => i).filter(i => !skippedTracks.has(i));
  }

  document.querySelectorAll('.skip-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const trackIndex = parseInt(btn.dataset.trackIndex);
      const trackRow = btn.closest('.track-row');

      if (skippedTracks.has(trackIndex)) {
        skippedTracks.delete(trackIndex);
        trackRow.classList.remove('skipped');
        btn.style.color = '#9ca3af';
        btn.title = chrome.i18n.getMessage('tooltip_skipTrack');
      } else {
        skippedTracks.add(trackIndex);
        trackRow.classList.add('skipped');
        btn.style.color = '#ef4444';
        btn.title = chrome.i18n.getMessage('tooltip_includeTrack');
      }

      updateSkipCount();
      updateOrderBadges();
    });
  });

  function renderIcons(startIndex, endIndex) {
    const iconsToRender = allIcons.slice(startIndex, endIndex);

    iconsToRender.forEach((icon, relativeIndex) => {
      const index = startIndex + relativeIndex;
      const iconDiv = document.createElement('div');
      iconDiv.style.cssText = `
        position: relative;
        cursor: pointer;
        border: 2px solid transparent;
        border-radius: 6px;
        padding: 4px;
        transition: all 0.2s;
        display: flex;
        flex-direction: column;
        align-items: center;
        background: white;
      `;

      const img = document.createElement('img');
      img.src = icon.url || icon.mediaUrl || `https://api.yotoplay.com/media/${icon.mediaId}`;
      img.style.cssText = `
        width: 40px;
        height: 40px;
        object-fit: cover;
        border-radius: 4px;
      `;

      const orderBadge = document.createElement('div');
      orderBadge.style.cssText = `
        position: absolute;
        top: 2px;
        right: 2px;
        background: #3b82f6;
        color: white;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        display: none;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: bold;
      `;

      iconDiv.appendChild(img);
      iconDiv.appendChild(orderBadge);

      iconDiv.addEventListener('click', () => {
        const iconId = icon.mediaId || icon.id;
        const iconIndex = selectedIcons.findIndex(i => (i.mediaId || i.id) === iconId);
        const activeTrackCount = trackCount - skippedTracks.size;

        if (iconIndex >= 0) {
          // Deselecting - always allowed
          selectedIcons.splice(iconIndex, 1);
          iconDiv.style.borderColor = 'transparent';
          iconDiv.style.backgroundColor = 'white';
          orderBadge.style.display = 'none';
          selectedIconElements.delete(iconId);
        } else {
          // Selecting - only allow if we haven't reached max icons
          if (selectedIcons.length >= activeTrackCount) {
            // Already have enough icons for all active tracks
            return;
          }
          selectedIcons.push(icon);
          iconDiv.style.borderColor = '#3b82f6';
          iconDiv.style.backgroundColor = '#eff6ff';
          orderBadge.style.display = 'flex';
          selectedIconElements.set(iconId, { badge: orderBadge, iconDiv: iconDiv });
        }

        document.getElementById('icon-apply').disabled = selectedIcons.length === 0;

        // Update all badges with track numbers
        updateOrderBadges();
      });

      iconGrid.appendChild(iconDiv);
    });

    currentlyDisplayed = endIndex;

    updateLoadMoreButton();
  }

  function updateLoadMoreButton() {
    const spinner = document.getElementById('loading-spinner');
    const checkmark = document.getElementById('complete-checkmark');
    const statusText = document.getElementById('status-text');

    if (isSearchComplete) {
      spinner.style.display = 'none';
      checkmark.style.display = 'block';
      statusText.textContent = chrome.i18n.getMessage('status_allIconsLoaded');
      statusText.style.color = '#10b981';
    } else {
      spinner.style.display = 'block';
      checkmark.style.display = 'none';
      statusText.textContent = chrome.i18n.getMessage('status_loading');
      statusText.style.color = '#6b7280';
    }
  }

  function updateOrderBadges() {
    const activeIndices = getActiveTrackIndices();

    selectedIcons.forEach((icon, selectionIndex) => {
      const iconId = icon.mediaId || icon.id;
      const element = selectedIconElements.get(iconId);
      if (element && element.badge) {
        if (activeIndices.length === 0 || selectionIndex >= activeIndices.length) {
          element.badge.textContent = '-';
        } else {
          const trackIndex = activeIndices[selectionIndex];
          element.badge.textContent = trackIndex + 1;
        }
      }
    });

    updateSkipCount();
    updateTrackIconPreviews();
  }

  function updateTrackIconPreviews() {
    const activeIndices = getActiveTrackIndices();
    const trackRows = document.querySelectorAll('.track-row');

    trackRows.forEach((row) => {
      const trackIndex = parseInt(row.dataset.trackIndex);
      const originalIconUrl = row.dataset.originalIcon || defaultIconUrl;
      let imgElement = row.querySelector('img.track-icon-preview');

      let iconToShow = originalIconUrl;

      if (skippedTracks.has(trackIndex)) {
        iconToShow = originalIconUrl;
      } else if (selectedIcons.length === 0) {
        iconToShow = originalIconUrl;
      } else {
        const activePosition = activeIndices.indexOf(trackIndex);
        if (activePosition !== -1 && activePosition < selectedIcons.length) {
          const assignedIcon = selectedIcons[activePosition];
          iconToShow = assignedIcon.url || assignedIcon.mediaUrl || `https://api.yotoplay.com/media/${assignedIcon.mediaId}`;
        } else {
          iconToShow = originalIconUrl;
        }
      }

      if (imgElement) {
        imgElement.src = iconToShow;
      }
    });
  }

  async function pollForNewIcons() {
    if (isSearchComplete) {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'SEARCH_ICONS_BY_CATEGORY',
        category: pollKeywords.length === 1 ? pollKeywords[0] : null,
        keywords: pollKeywords,
        loadMore: true
      });

      if (response.icons && response.icons.length > allIcons.length) {
        const previousLength = allIcons.length;
        allIcons = response.icons;
        isSearchComplete = response.isComplete || false;

        const maxToDisplay = Math.min(currentlyDisplayed + iconsPerPage, allIcons.length);
        if (maxToDisplay > currentlyDisplayed) {
          renderIcons(currentlyDisplayed, maxToDisplay);
        }

        updateLoadMoreButton();
      }

      if (response.isComplete) {
        isSearchComplete = true;
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        updateLoadMoreButton();
      }
    } catch (error) {
      console.error('Error polling for icons:', error);
    }
  }

  renderIcons(0, Math.min(iconsPerPage, allIcons.length));

  pollInterval = setInterval(pollForNewIcons, 2000);

  document.getElementById('icon-cancel').addEventListener('click', () => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    modal.remove();
  });
  
  document.getElementById('icon-apply').addEventListener('click', async () => {
    if (selectedIcons.length === 0) return;

    const activeCount = trackCount - skippedTracks.size;
    if (activeCount === 0) {
      alert('All tracks are skipped. Please select at least one track to apply icons.');
      return;
    }

    const applyBtn = document.getElementById('icon-apply');
    applyBtn.textContent = chrome.i18n.getMessage('button_applying');
    applyBtn.disabled = true;

    const skippedTrackIndices = Array.from(skippedTracks);

    const result = await chrome.runtime.sendMessage({
      action: 'APPLY_CATEGORY_ICONS',
      cardId: cardId,
      icons: selectedIcons,
      selectedTracks: selectedTracks,
      skippedTrackIndices: skippedTrackIndices
    });
    
    if (result.error) {
      alert(chrome.i18n.getMessage('error_failedToApplyIcons', [result.error]));
    } else {
      const successNotice = document.createElement('div');
      successNotice.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #3b82f6;
        color: white;
        padding: 30px 40px;
        border-radius: 12px;
        font-size: 16px;
        z-index: 100000;
        box-shadow: 0 10px 25px rgba(0,0,0,0.2);
        text-align: center;
        min-width: 300px;
      `;

      successNotice.innerHTML = `
        <div style="width: 48px; height: 48px; background: rgba(255, 255, 255, 0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px auto;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <div style="font-size: 14px; opacity: 0.95;">${chrome.i18n.getMessage('notification_pleaseRefreshPage')}</div>
      `;

      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      modal.remove();
      document.body.appendChild(successNotice);

      setTimeout(() => {
        successNotice.remove();
      }, 6000);
    }
  });
}

})(); // End of IIFE
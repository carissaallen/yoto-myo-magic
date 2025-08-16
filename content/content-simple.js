
function showIconPreview(matches) {
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
    align-items: center;
    justify-content: center;
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
        const isYotoiconsLink = match.suggestedIcon && match.suggestedIcon.includes('yotoicons.com');
        
        return `
        <div style="
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background: #f9f9f9;
          border-radius: 8px;
          border: 1px solid #e0e0e0;
        ">
          <div style="
            width: 48px;
            height: 48px;
            background: ${match.suggestedIcon ? '#e0e0e0' : '#FFD700'};
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
          ">
            ${isYotoiconsLink ? 
              '🔗' :
              (match.suggestedIcon ? 
                `<img src="${match.suggestedIcon}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;" onerror="this.style.display='none'; this.parentElement.innerHTML='❌';">` :
                '🎵')}
          </div>
          <div style="flex: 1;">
            <div style="font-weight: 500; color: #2c3e50;">${match.trackTitle}</div>
            <div style="font-size: 12px; color: #999; margin-top: 4px;">
              ${isYotoiconsLink ? 
                `<a href="${match.suggestedIcon}" target="_blank" style="color: #0066cc; text-decoration: underline;">Search on yotoicons.com</a>` :
                (match.confidence > 0 ? `Confidence: ${match.confidence}%` : 'No match found')}
            </div>
            ${match.iconTitle ? `<div style="font-size: 11px; color: #666; margin-top: 2px;">Icon: ${match.iconTitle}</div>` : ''}
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
  
  // Add animation style if not present
  if (!document.querySelector('#yoto-magic-animation-style')) {
    const style = document.createElement('style');
    style.id = 'yoto-magic-animation-style';
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }
  
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
      
      // Filter out yotoicons.com links and only get real icon URLs
      const validMatches = matches.filter(match => 
        match.suggestedIcon && 
        !match.suggestedIcon.includes('yotoicons.com') &&
        match.suggestedIcon.startsWith('http')
      );
      
      if (validMatches.length === 0) {
        alert('No valid icons to apply. Please search for icons on yotoicons.com manually.');
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

function createButton() {
  const button = document.createElement('button');
  button.id = 'yoto-magic-btn';
  
  button.style.cssText = `
    background-color: #FFD700;
    color: #000000;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 14px;
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
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
    </svg>
    <span>Icon Match</span>
  `;
  
  button.onmouseenter = () => {
    button.style.backgroundColor = '#FFC700';
    button.style.transform = 'translateY(-1px)';
  };
  
  button.onmouseleave = () => {
    button.style.backgroundColor = '#FFD700';
    button.style.transform = 'translateY(0)';
  };
  
  button.onclick = async () => {
    const tokenResponse = await chrome.runtime.sendMessage({ action: 'GET_ACCESS_TOKEN' });
    
    const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });
    
    if (!authResponse.authenticated) {
      button.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
        <span>Authorizing...</span>
      `;
      chrome.runtime.sendMessage({ action: 'START_AUTH' });
      setTimeout(() => {
        button.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
          <span>Icon Match</span>
        `;
      }, 2000);
    } else {
      
      button.disabled = true;
      button.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
        <span>Fetching content...</span>
      `;
      button.style.opacity = '0.7';
      
      const urlMatch = window.location.href.match(/\/card\/([^\/]+)/);
      const cardId = urlMatch ? urlMatch[1] : null;
      
      if (!cardId) {
        alert('Could not identify card ID from URL');
        button.disabled = false;
        button.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
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
        }
        
        if (tracks.length === 0 && contentResponse.card?.title) {
          tracks.push({
            id: 'card-title',
            title: contentResponse.card.title,
            index: 0,
            type: 'card'
          });
        }
      }
      
      if (tracks.length === 0) {
        
        let allTextInputs = Array.from(document.querySelectorAll('input[type="text"]'));
        const allInputs = Array.from(document.querySelectorAll('input'));
        const editableElements = Array.from(document.querySelectorAll('[contenteditable="true"]'));
        const allElements = Array.from(document.querySelectorAll('*'));
        const trackElements = allElements.filter(el => {
          const text = el.textContent?.trim() || '';
          return /^\d+\.\s+\w+/.test(text) && !el.querySelector('*');
        });
        
        const foundTracks = new Set();
        
        allInputs.forEach((input, index) => {
          const value = input.value?.trim();
          
          if (!value || value.length === 0) return;
          
          if (value === playlistTitle) {
            return;
          }
          
          foundTracks.add(value);
        });
        
        editableElements.forEach(el => {
          const value = el.textContent?.trim();
          if (value && value !== playlistTitle && value.length > 0) {
            foundTracks.add(value);
          }
        });
        
        Array.from(foundTracks).forEach((title, index) => {
          tracks.push({
            id: `track-${index + 1}`,
            title: title,
            index: index,
            type: 'track'
          });
        });
        
        if (tracks.length === 0 && playlistTitle && playlistTitle !== 'Untitled Playlist') {
          tracks.push({
            id: 'playlist-title',
            title: playlistTitle,
            index: 0,
            type: 'playlist'
          });
        }
      }
      
      if (tracks.length === 0) {
        alert('No tracks found in this card. Please add some tracks first.');
        button.disabled = false;
        button.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
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
        const response = await chrome.runtime.sendMessage({ 
          action: 'MATCH_ICONS',
          tracks: tracks
        });
        
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
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
        <span>Icon Match</span>
      `;
      button.style.opacity = '1';
    }
  };
  
  return button;
}

function checkAndInjectButton() {
  const url = window.location.href;
  if (!url.includes('my.yotoplay.com/card/') || !url.includes('/edit')) {
    return;
  }
  
  if (document.querySelector('#yoto-magic-btn')) {
    return;
  }
  
  const addAudioButton = Array.from(document.querySelectorAll('button')).find(btn => 
    btn.textContent?.trim() === 'Add audio'
  );
  
  if (addAudioButton) {
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'flex gap-2 mt-2';
    
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

setTimeout(checkAndInjectButton, 2000);

let lastUrl = location.href;
let checkInterval = null;

function startChecking() {
  if (checkInterval) {
    clearInterval(checkInterval);
  }
  
  checkAndInjectButton();
  
  let checks = 0;
  checkInterval = setInterval(() => {
    checks++;
    checkAndInjectButton();
    
    if (checks >= 10) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  }, 500);
}

const urlObserver = new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    const existingButton = document.querySelector('#yoto-magic-btn');
    if (existingButton && existingButton.parentElement) {
      existingButton.parentElement.remove();
    }
    
    if (url.includes('my.yotoplay.com/card/') && url.includes('/edit')) {
      startChecking();
    }
  }
});

urlObserver.observe(document, {subtree: true, childList: true});

const contentObserver = new MutationObserver((mutations) => {
  const url = location.href;
  if (url.includes('my.yotoplay.com/card/') && url.includes('/edit')) {
    const addAudioButton = Array.from(document.querySelectorAll('button')).find(btn => 
      btn.textContent?.trim() === 'Add audio'
    );
    const ourButton = document.querySelector('#yoto-magic-btn');
    
    if (addAudioButton && !ourButton) {
      checkAndInjectButton();
    }
  }
});

contentObserver.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: false,
  characterData: false
});

function showRefreshIndicator() {
  const indicator = document.createElement('div');
  indicator.id = 'yoto-refresh-indicator';
  indicator.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
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
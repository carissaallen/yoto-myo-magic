// Simplified content script for Yoto Card Magic
console.log('[Yoto Card Magic] Content script loaded');

// Function to extract track titles from the page
function extractTrackTitles() {
  const tracks = [];
  
  // Look for track input fields - they typically have numbered labels like "1. ", "2. ", etc.
  const trackInputs = document.querySelectorAll('input[type="text"]');
  
  trackInputs.forEach((input, index) => {
    // Check if this looks like a track title input
    const label = input.previousElementSibling?.textContent || '';
    const placeholder = input.placeholder || '';
    
    // Track inputs usually have a number label or are after the audio file inputs
    if ((label && /^\d+\./.test(label)) || 
        (input.value && input.value.trim() && !placeholder.includes('Playlist'))) {
      const title = input.value.trim();
      if (title) {
        tracks.push({
          id: `track-${index}`,
          title: title,
          index: index
        });
      }
    }
  });
  
  // Alternative: Look for displayed track titles in the list
  if (tracks.length === 0) {
    const trackElements = document.querySelectorAll('[class*="track"], [class*="title"]');
    trackElements.forEach((el, index) => {
      if (el.textContent && !el.textContent.includes('Add audio')) {
        const title = el.textContent.trim();
        if (title && title.length > 0 && title.length < 100) { // Basic validation
          tracks.push({
            id: `track-${index}`,
            title: title,
            index: index
          });
        }
      }
    });
  }
  
  return tracks;
}

// Function to show icon preview modal
function showIconPreview(matches) {
  // Remove any existing preview
  const existingPreview = document.querySelector('#yoto-magic-preview');
  if (existingPreview) {
    existingPreview.remove();
  }
  
  // Create preview modal
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
        // Check if this is a yotoicons.com link
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
    console.log('[Yoto Card Magic] Applying icons...');
    
    // Disable the button while applying
    const applyButton = document.querySelector('#apply-icons');
    applyButton.disabled = true;
    applyButton.textContent = 'Applying...';
    
    try {
      // Get the card ID from the URL
      const urlMatch = window.location.href.match(/\/card\/([^\/]+)/);
      const cardId = urlMatch ? urlMatch[1] : null;
      
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
      
      console.log('[Yoto Card Magic] Applying icons to card:', cardId);
      console.log('[Yoto Card Magic] Valid matches:', validMatches);
      
      // Send request to background script to update the card
      const response = await chrome.runtime.sendMessage({
        action: 'UPDATE_CARD_ICONS',
        cardId: cardId,
        iconMatches: validMatches
      });
      
      if (response.success) {
        console.log('[Yoto Card Magic] Icons applied successfully');
        
        // Show success message
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
        
        // Remove success message after 3 seconds
        setTimeout(() => {
          successDiv.remove();
        }, 3000);
        
        // Close modal
        modal.remove();
        
        // Optionally refresh the page to show the new icons
        setTimeout(() => {
          if (confirm('Icons applied! Would you like to refresh the page to see the changes?')) {
            window.location.reload();
          }
        }, 500);
      } else {
        console.error('[Yoto Card Magic] Failed to apply icons:', response.error);
        
        // Check if it's a permission error
        if (response.error && (response.error.includes('special permissions') || response.error.includes('403'))) {
          // Show a more helpful error message
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
          
          // Close original modal
          modal.remove();
        } else {
          alert('Failed to apply icons: ' + (response.error || 'Unknown error'));
        }
        
        // Re-enable button
        applyButton.disabled = false;
        applyButton.textContent = 'Apply Icons';
      }
    } catch (error) {
      console.error('[Yoto Card Magic] Error applying icons:', error);
      alert('Error applying icons: ' + error.message);
      
      // Re-enable button
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

// Function to create the Icon Match button
function createButton() {
  const button = document.createElement('button');
  button.id = 'yoto-magic-btn';
  
  // Match the exact style of MYO Studio buttons but with yellow background
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
  
  // Add icon and text - simple star icon
  button.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
    </svg>
    <span>Icon Match</span>
  `;
  
  // Add hover effect
  button.onmouseenter = () => {
    button.style.backgroundColor = '#FFC700';
    button.style.transform = 'translateY(-1px)';
  };
  
  button.onmouseleave = () => {
    button.style.backgroundColor = '#FFD700';
    button.style.transform = 'translateY(0)';
  };
  
  button.onclick = async () => {
    console.log('[Yoto Card Magic] Button clicked');
    
    const authResponse = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });
    
    if (!authResponse.authenticated) {
      console.log('[Yoto Card Magic] Not authenticated, starting auth');
      button.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
        <span>Authorizing...</span>
      `;
      chrome.runtime.sendMessage({ action: 'START_AUTH' });
      
      // Reset button text after a moment
      setTimeout(() => {
        button.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
          <span>Icon Match</span>
        `;
      }, 2000);
    } else {
      console.log('[Yoto Card Magic] Authenticated, fetching card content');
      
      button.disabled = true;
      button.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
        <span>Fetching content...</span>
      `;
      button.style.opacity = '0.7';
      
      // Extract card ID from URL
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
      
      console.log('[Yoto Card Magic] Card ID:', cardId);
      
      // First, let's try to get the playlist title from the page as a fallback
      const playlistNameInput = document.querySelector('input[type="text"]');
      const playlistTitle = playlistNameInput?.value || 'Untitled Playlist';
      
      // Try to fetch card content from API
      const contentResponse = await chrome.runtime.sendMessage({ 
        action: 'GET_CARD_CONTENT',
        cardId: cardId
      });
      
      // Extract tracks - either from API or from the page
      const tracks = [];
      
      if (!contentResponse.error && contentResponse.card) {
        // Extract ONLY tracks from API response (not chapters to avoid duplicates)
        if (contentResponse.card?.content?.chapters && contentResponse.card.content.chapters.length > 0) {
          contentResponse.card.content.chapters.forEach((chapter, chapterIndex) => {
            // Only add tracks within chapters, not the chapter titles themselves
            if (chapter.tracks && Array.isArray(chapter.tracks)) {
              chapter.tracks.forEach((track, trackIndex) => {
                if (track.title) {
                  tracks.push({
                    id: track.key || `track-${chapterIndex}-${trackIndex}`,
                    title: track.title,
                    index: tracks.length,
                    type: 'track',
                    chapterKey: chapter.key,
                    chapterTitle: chapter.title // Store chapter title for reference but don't match icons to it
                  });
                }
              });
            }
          });
        }
        
        // If no tracks found but card has a title, use that as fallback
        if (tracks.length === 0 && contentResponse.card?.title) {
          tracks.push({
            id: 'card-title',
            title: contentResponse.card.title,
            index: 0,
            type: 'card'
          });
        }
      }
      
      // If API didn't work or no tracks found, extract from the page
      if (tracks.length === 0) {
        console.log('[Yoto Card Magic] No tracks from API, extracting from page');
        
        // Try multiple strategies to find track inputs
        
        // Strategy 1: Look for all text inputs
        let allTextInputs = Array.from(document.querySelectorAll('input[type="text"]'));
        console.log('[Yoto Card Magic] Found text inputs:', allTextInputs.length);
        
        // Strategy 2: Also look for inputs without explicit type
        const allInputs = Array.from(document.querySelectorAll('input'));
        console.log('[Yoto Card Magic] Found all inputs:', allInputs.length);
        
        // Strategy 3: Look for contenteditable elements (in case tracks use these)
        const editableElements = Array.from(document.querySelectorAll('[contenteditable="true"]'));
        console.log('[Yoto Card Magic] Found contenteditable elements:', editableElements.length);
        
        // Strategy 4: Look for elements with specific text patterns
        const allElements = Array.from(document.querySelectorAll('*'));
        const trackElements = allElements.filter(el => {
          const text = el.textContent?.trim() || '';
          // Look for elements that have track numbers like "1." followed by text
          return /^\d+\.\s+\w+/.test(text) && !el.querySelector('*'); // Leaf nodes only
        });
        console.log('[Yoto Card Magic] Found numbered elements:', trackElements.length);
        
        // Log details about inputs found
        allInputs.forEach((input, index) => {
          if (input.value) {
            console.log(`[Yoto Card Magic] Input ${index}: value="${input.value}", placeholder="${input.placeholder || ''}", name="${input.name || ''}", id="${input.id || ''}"`);
          }
        });
        
        // Look through all inputs to find tracks
        const foundTracks = new Set(); // Use Set to avoid duplicates
        
        allInputs.forEach((input, index) => {
          const value = input.value?.trim();
          
          // Skip empty inputs
          if (!value || value.length === 0) return;
          
          // Skip the playlist title
          if (value === playlistTitle) {
            console.log('[Yoto Card Magic] Skipping playlist title:', value);
            return;
          }
          
          // This could be a track - add it
          console.log(`[Yoto Card Magic] Found potential track: "${value}"`);
          foundTracks.add(value);
        });
        
        // Also check contenteditable elements
        editableElements.forEach(el => {
          const value = el.textContent?.trim();
          if (value && value !== playlistTitle && value.length > 0) {
            console.log(`[Yoto Card Magic] Found potential track in contenteditable: "${value}"`);
            foundTracks.add(value);
          }
        });
        
        // Convert Set to array and create track objects
        Array.from(foundTracks).forEach((title, index) => {
          tracks.push({
            id: `track-${index + 1}`,
            title: title,
            index: index,
            type: 'track'
          });
        });
        
        // Log what we found
        console.log('[Yoto Card Magic] Extracted tracks from page:', tracks);
        
        // If still no tracks but we have a playlist title, use that as fallback
        if (tracks.length === 0 && playlistTitle && playlistTitle !== 'Untitled Playlist') {
          console.log('[Yoto Card Magic] Using playlist title as fallback');
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
      
      console.log('[Yoto Card Magic] Found tracks from API:', tracks);
      
      // Update button to show matching in progress
      button.innerHTML = `
        <svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25" stroke-width="4"/>
          <path d="M12 2a10 10 0 0 1 0 20" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
        </svg>
        <span>Matching ${tracks.length} tracks...</span>
      `;
      
      // Add CSS for spinner animation if not already present
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
        // Send tracks to background for icon matching
        const response = await chrome.runtime.sendMessage({ 
          action: 'MATCH_ICONS',
          tracks: tracks
        });
        
        if (response.matches && response.matches.length > 0) {
          console.log('[Yoto Card Magic] Matches found:', response.matches);
          
          // Show preview of matches
          showIconPreview(response.matches);
        } else {
          alert('No icon matches found. Try adding more descriptive track titles.');
        }
      } catch (error) {
        console.error('[Yoto Card Magic] Error matching icons:', error);
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

// Function to check and inject button
function checkAndInjectButton() {
  // Only run on card edit pages
  const url = window.location.href;
  if (!url.includes('my.yotoplay.com/card/') || !url.includes('/edit')) {
    console.log('[Yoto Card Magic] Not on card edit page, skipping');
    return;
  }
  
  console.log('[Yoto Card Magic] On card edit page, injecting button');
  
  // Check if button already exists
  if (document.querySelector('#yoto-magic-btn')) {
    console.log('[Yoto Card Magic] Button already exists');
    return;
  }
  
  // Find the "Add audio" button
  const addAudioButton = Array.from(document.querySelectorAll('button')).find(btn => 
    btn.textContent?.trim() === 'Add audio'
  );
  
  if (addAudioButton) {
    // Create a container for our button
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'flex gap-2 mt-2'; // Match the styling with margin-top for spacing
    
    const button = createButton();
    buttonContainer.appendChild(button);
    
    // Insert our button container directly after the Add audio button
    if (addAudioButton.nextSibling) {
      addAudioButton.parentNode.insertBefore(buttonContainer, addAudioButton.nextSibling);
    } else {
      addAudioButton.parentNode.appendChild(buttonContainer);
    }
    
    console.log('[Yoto Card Magic] Added Icon Match button under Add audio button');
  } else {
    console.log('[Yoto Card Magic] Add audio button not found, trying alternative placement');
    
    // Alternative: Look for the Add stream button as a fallback
    const addStreamButton = Array.from(document.querySelectorAll('button')).find(btn => 
      btn.textContent?.trim() === 'Add stream'
    );
    
    if (addStreamButton && addStreamButton.parentNode) {
      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'flex gap-2 mt-4'; // Add more margin since we're after both buttons
      
      const button = createButton();
      buttonContainer.appendChild(button);
      
      // Insert after the parent container of Add audio/Add stream buttons
      const buttonsParent = addStreamButton.parentNode;
      if (buttonsParent.nextSibling) {
        buttonsParent.parentNode.insertBefore(buttonContainer, buttonsParent.nextSibling);
      } else {
        buttonsParent.parentNode.appendChild(buttonContainer);
      }
      
      console.log('[Yoto Card Magic] Added Icon Match button after Add audio/stream buttons');
    } else {
      console.log('[Yoto Card Magic] Could not find suitable placement for button');
    }
  }
}

// Initial check after delay
setTimeout(checkAndInjectButton, 2000);

// Watch for URL changes and DOM changes (in case of single-page navigation)
let lastUrl = location.href;
let checkInterval = null;

// Function to start checking for button injection
function startChecking() {
  // Clear any existing interval
  if (checkInterval) {
    clearInterval(checkInterval);
  }
  
  // Check immediately
  checkAndInjectButton();
  
  // Then check every 500ms for the next 5 seconds
  let checks = 0;
  checkInterval = setInterval(() => {
    checks++;
    checkAndInjectButton();
    
    // Stop checking after 10 attempts (5 seconds)
    if (checks >= 10) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  }, 500);
}

// Watch for URL changes
const urlObserver = new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    console.log('[Yoto Card Magic] URL changed to:', url);
    
    // Remove existing button if any
    const existingButton = document.querySelector('#yoto-magic-btn');
    if (existingButton && existingButton.parentElement) {
      // Remove the container div as well
      existingButton.parentElement.remove();
    }
    
    // Start checking if we should inject on new page
    if (url.includes('my.yotoplay.com/card/') && url.includes('/edit')) {
      startChecking();
    }
  }
});

urlObserver.observe(document, {subtree: true, childList: true});

// Also watch for changes to the main content area
const contentObserver = new MutationObserver((mutations) => {
  // Check if we're on an edit page and button doesn't exist
  const url = location.href;
  if (url.includes('my.yotoplay.com/card/') && url.includes('/edit')) {
    // Check if Add audio button appeared but our button isn't there
    const addAudioButton = Array.from(document.querySelectorAll('button')).find(btn => 
      btn.textContent?.trim() === 'Add audio'
    );
    const ourButton = document.querySelector('#yoto-magic-btn');
    
    if (addAudioButton && !ourButton) {
      console.log('[Yoto Card Magic] Add audio button detected, injecting our button');
      checkAndInjectButton();
    }
  }
});

// Start observing the body for changes
contentObserver.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: false,
  characterData: false
});

// Listen for auth updates
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'AUTH_STATUS') {
    console.log('[Yoto Card Magic] Auth status updated:', request.authenticated);
  }
});
// Handles the UI for the audio splitter feature

function showAudioSplitterModal() {
  if (!window.AudioSplitter) {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('lib/audioSplitter.js');
    script.onload = () => {
      createAudioSplitterModal();
    };
    document.head.appendChild(script);
  } else {
    createAudioSplitterModal();
  }
}

function createAudioSplitterModal() {
  const existing = document.querySelector('#yoto-audio-splitter-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'yoto-audio-splitter-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    animation: fadeIn 0.3s ease;
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 30px;
    max-width: 600px;
    width: 100%;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    animation: slideDown 0.3s ease;
  `;

  content.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <h2 style="margin: 0; color: #2c3e50; font-size: 24px; display: flex; align-items: center; gap: 8px;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1e40af" stroke-width="2">
          <rect x="3" y="5" width="18" height="4" rx="1"/>
          <rect x="3" y="11" width="18" height="4" rx="1"/>
          <rect x="3" y="17" width="18" height="4" rx="1"/>
          <path d="M9 7L9 7" stroke-linecap="round"/>
          <path d="M15 13L15 13" stroke-linecap="round"/>
          <path d="M12 19L12 19" stroke-linecap="round"/>
        </svg>
        Audio Splitter
      </h2>
      <button id="audio-splitter-close" style="
        background: transparent;
        border: none;
        color: #6b7280;
        cursor: pointer;
        padding: 4px;
      ">
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
          <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <div style="margin-bottom: 24px; color: #4b5563; line-height: 1.6;">
      <p style="margin: 0 0 16px 0;">Upload an audio file to automatically split it into chapters based on silence detection.</p>

      <div style="background: #f0f9ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0 0 8px 0; font-weight: 600; color: #1e40af;">How it works:</p>
        <ul style="margin: 8px 0 0 0; padding-left: 20px; color: #1e40af;">
          <li style="margin: 4px 0;">Detects silence gaps in your audio file</li>
          <li style="margin: 4px 0;">Splits audio into separate tracks at silence points</li>
          <li style="margin: 4px 0;">Allows you to name and edit each chapter</li>
          <li style="margin: 4px 0;">Imports as a new Yoto playlist</li>
        </ul>
      </div>
    </div>

    <div id="audio-upload-section">
      <label for="audio-file-input" style="
        display: block;
        width: 100%;
        padding: 40px 20px;
        background: #f9fafb;
        border: 2px dashed #d1d5db;
        border-radius: 8px;
        text-align: center;
        cursor: pointer;
        transition: all 0.2s;
      " onmouseover="this.style.borderColor='#3b82f6'; this.style.background='#f0f9ff'"
         onmouseout="this.style.borderColor='#d1d5db'; this.style.background='#f9fafb'">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" style="margin: 0 auto 12px;">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
        <p style="margin: 0 0 8px 0; color: #374151; font-size: 16px; font-weight: 500;">
          Click to upload audio file
        </p>
        <p style="margin: 0; color: #6b7280; font-size: 14px;">
          Supported formats: MP3, WAV, M4A, OGG, FLAC
        </p>
        <p style="margin: 8px 0 0 0; color: #9ca3af; font-size: 12px;">
          Maximum file size: 100MB
        </p>
      </label>
      <input type="file" id="audio-file-input" accept="audio/*" style="display: none;">

      <div style="margin-top: 16px; padding: 12px; background: #fef3c7; border: 1px solid #fbbf24; border-radius: 6px;">
        <p style="margin: 0; color: #92400e; font-size: 13px;">
          <strong>Tip:</strong> For best results, use audio files with clear pauses between chapters (at least 1 second of silence).
        </p>
      </div>
    </div>

    <div id="audio-processing-section" style="display: none;">
      <div style="text-align: center; padding: 40px 20px;">
        <div style="width: 48px; height: 48px; border: 4px solid #e5e7eb; border-top-color: #3b82f6; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 16px;"></div>
        <p style="margin: 0 0 8px 0; color: #374151; font-size: 16px; font-weight: 500;">Processing audio...</p>
        <p id="processing-status" style="margin: 0; color: #6b7280; font-size: 14px;">Analyzing audio for silence detection</p>
        <div id="processing-progress" style="margin-top: 20px; display: none;">
          <div style="background: #e5e7eb; height: 4px; border-radius: 2px; overflow: hidden;">
            <div id="progress-bar" style="background: #3b82f6; height: 100%; width: 0%; transition: width 0.3s;"></div>
          </div>
        </div>
      </div>
    </div>

    <div id="audio-chapters-section" style="display: none;">
      <h3 style="margin: 0 0 16px 0; color: #374151; font-size: 18px;">Detected Chapters</h3>
      <div id="chapters-list" style="max-height: 300px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px;">
      </div>

      <div style="margin-top: 20px;">
        <label style="display: block; margin-bottom: 8px; color: #374151; font-weight: 500;">
          Playlist Name:
        </label>
        <input type="text" id="split-playlist-name" value="Split Audio" style="
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 14px;
        ">
      </div>

      <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
        <button id="audio-splitter-cancel" style="
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
          Cancel
        </button>
        <button id="audio-splitter-import" style="
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
          Import as Playlist
        </button>
      </div>
    </div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  if (!document.querySelector('#audio-splitter-styles')) {
    const style = document.createElement('style');
    style.id = 'audio-splitter-styles';
    style.textContent = `
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideDown {
        from { transform: translateY(-20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  document.getElementById('audio-splitter-close').addEventListener('click', () => modal.remove());
  document.getElementById('audio-file-input').addEventListener('change', handleAudioFileUpload);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

async function handleAudioFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (file.size > 100 * 1024 * 1024) {
    showNotification('File too large. Please select a file under 100MB.', 'error');
    return;
  }

  document.getElementById('audio-upload-section').style.display = 'none';
  document.getElementById('audio-processing-section').style.display = 'block';

  try {
    updateProcessingStatus('Loading audio file...', 10);

    const splitter = new window.AudioSplitter();

    updateProcessingStatus('Analyzing audio for silence...', 30);
    const chapters = await splitter.processAudioFile(file);

    updateProcessingStatus('Creating chapters...', 80);

    if (chapters && chapters.length > 0) {
      updateProcessingStatus('Complete!', 100);
      setTimeout(() => {
        displayDetectedChapters(chapters, file, splitter);
      }, 500);
    } else {
      showNotification('No chapters detected. Try adjusting silence threshold.', 'warning');
      resetAudioSplitterModal();
    }
  } catch (error) {
    console.error('Error processing audio:', error);
    showNotification('Error processing audio file. Please try again.', 'error');
    resetAudioSplitterModal();
  }
}

function updateProcessingStatus(message, progress) {
  const statusEl = document.getElementById('processing-status');
  const progressContainer = document.getElementById('processing-progress');
  const progressBar = document.getElementById('progress-bar');

  if (statusEl) statusEl.textContent = message;

  if (progress !== undefined && progressContainer && progressBar) {
    progressContainer.style.display = 'block';
    progressBar.style.width = `${progress}%`;
  }
}

function displayDetectedChapters(chapters, originalFile, splitter) {
  document.getElementById('audio-processing-section').style.display = 'none';
  document.getElementById('audio-chapters-section').style.display = 'block';

  const chaptersList = document.getElementById('chapters-list');
  chaptersList.innerHTML = '';

  const modal = document.querySelector('#yoto-audio-splitter-modal');
  modal.audioChapters = chapters;
  modal.audioSplitter = splitter;

  chapters.forEach((chapter, index) => {
    const chapterItem = document.createElement('div');
    chapterItem.style.cssText = `
      padding: 12px;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      align-items: center;
      gap: 12px;
    `;

    const duration = formatDuration(chapter.duration);

    chapterItem.innerHTML = `
      <span style="color: #6b7280; font-size: 14px; min-width: 30px;">${chapter.index}.</span>
      <input type="text" value="${chapter.name}" data-chapter-index="${index}" class="chapter-name-input" style="
        flex: 1;
        padding: 6px 10px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 14px;
      ">
      <span style="color: #6b7280; font-size: 13px;">${duration}</span>
      <button class="play-chapter-btn" data-chapter-index="${index}" style="
        background: transparent;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        padding: 4px 8px;
        cursor: pointer;
        color: #6b7280;
      " title="Preview">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      </button>
    `;

    chaptersList.appendChild(chapterItem);
  });

  const playlistName = originalFile.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
  document.getElementById('split-playlist-name').value = playlistName;

  document.querySelectorAll('.play-chapter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.currentTarget.dataset.chapterIndex);
      const modal = document.querySelector('#yoto-audio-splitter-modal');
      if (modal && modal.audioSplitter && modal.audioChapters) {
        modal.audioSplitter.previewChapter(modal.audioChapters[index]);
      }
    });
  });

  document.getElementById('audio-splitter-import').addEventListener('click', () => {
    importSplitChapters();
  });

  document.getElementById('audio-splitter-cancel').addEventListener('click', () => {
    document.querySelector('#yoto-audio-splitter-modal').remove();
  });
}

async function importSplitChapters() {
  const modal = document.querySelector('#yoto-audio-splitter-modal');
  if (!modal || !modal.audioChapters || !modal.audioSplitter) {
    showNotification('Error: Chapters not found', 'error');
    return;
  }

  const chapters = modal.audioChapters;
  const splitter = modal.audioSplitter;
  const playlistName = document.getElementById('split-playlist-name').value || 'Split Audio';

  document.querySelectorAll('.chapter-name-input').forEach((input, index) => {
    if (chapters[index]) {
      chapters[index].name = input.value || chapters[index].name;
    }
  });

  try {
    const audioFiles = await splitter.chaptersToAudioFiles(chapters);
    modal.remove();
    showImportModal(audioFiles, [], null, playlistName, 'audio-splitter');
  } catch (error) {
    console.error('Error importing chapters:', error);
    showNotification('Error importing chapters. Please try again.', 'error');
  }
}

function resetAudioSplitterModal() {
  document.getElementById('audio-upload-section').style.display = 'block';
  document.getElementById('audio-processing-section').style.display = 'none';
  document.getElementById('audio-chapters-section').style.display = 'none';
  document.getElementById('audio-file-input').value = '';

  const progressContainer = document.getElementById('processing-progress');
  if (progressContainer) {
    progressContainer.style.display = 'none';
    const progressBar = document.getElementById('progress-bar');
    if (progressBar) progressBar.style.width = '0%';
  }
}

window.showAudioSplitterModal = showAudioSplitterModal;
// Launcher script to call showAudioSplitterModal after the UI script loads
// This avoids CSP inline script violations

if (typeof showAudioSplitterModal === 'function') {
  showAudioSplitterModal();
} else {
  console.error('showAudioSplitterModal is not defined');
}
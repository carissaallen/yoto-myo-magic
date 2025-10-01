// Initialize the audio splitter with the correct URL
// This script is injected from content script with the URL already set

// The URL is passed as a data attribute on this script element
const currentScript = document.currentScript;
if (currentScript && currentScript.dataset.audioSplitterUrl) {
  window.audioSplitterURL = currentScript.dataset.audioSplitterUrl;
}
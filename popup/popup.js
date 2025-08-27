document.addEventListener('DOMContentLoaded', function() {
  const goToYotoButton = document.getElementById('go-to-yoto');
  const manageExtensionButton = document.getElementById('manage-extension');
  
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
});
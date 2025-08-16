document.addEventListener('DOMContentLoaded', function() {
  const openOptionsButton = document.getElementById('open-options');
  const viewPermissionsButton = document.getElementById('view-permissions');
  
  openOptionsButton.addEventListener('click', function() {
    chrome.runtime.openOptionsPage();
    window.close();
  });
  
  viewPermissionsButton.addEventListener('click', function() {
    chrome.tabs.create({
      url: 'chrome://extensions/?id=' + chrome.runtime.id
    });
    window.close();
  });
});
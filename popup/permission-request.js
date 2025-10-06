// Load and display the specific domains we need permission for
async function loadRequiredDomains() {
    const storage = await chrome.storage.local.get('pendingPermissionDomains');
    const domains = storage.pendingPermissionDomains || [];
    
    if (domains.length > 0) {
        // Update the UI to show specific domains
        const domainList = document.createElement('div');
        domainList.style.cssText = 'margin: 15px 0; padding: 10px; background: #f8f9fa; border-radius: 4px;';
        domainList.innerHTML = `
            <p style="margin: 0 0 10px 0; font-weight: bold;">Required domains:</p>
            <ul style="margin: 0; padding-left: 20px;">
                ${domains.map(d => `<li>${d.replace('https://', '').replace('/*', '')}</li>`).join('')}
            </ul>
        `;
        
        // Insert before the button group
        const buttonGroup = document.querySelector('.button-group');
        buttonGroup.parentNode.insertBefore(domainList, buttonGroup);
    }
    
    return domains;
}

document.getElementById('grant-permission').addEventListener('click', async () => {
    try {
        // Get the specific domains to request
        const domains = await loadRequiredDomains();
        
        // Request permission for specific domains or fall back to all_urls
        const permissionRequest = domains.length > 0
            ? { origins: domains }
            : { origins: ['<all_urls>'] };

        const granted = await chrome.permissions.request(permissionRequest);
        
        if (granted) {
            // Permission granted - notify and close
            chrome.runtime.sendMessage({
                action: 'PERMISSION_GRANTED',
                permission: domains.length > 0 ? 'specific' : 'all_urls',
                domains: domains
            });
            
            // Clear the stored domains
            await chrome.storage.local.remove('pendingPermissionDomains');
            
            // Show success message
            document.body.innerHTML = `
                <div style="text-align: center; padding: 40px 20px;">
                    <h2 style="color: #28a745;">✓ Permission Granted</h2>
                    <p>You can now import podcasts from ${domains.length > 0 ? 'the requested domains' : 'any source'}.</p>
                    <p style="color: #666; font-size: 14px;">This window will close automatically...</p>
                </div>
            `;
            
            // Close the popup after a short delay
            setTimeout(() => {
                window.close();
            }, 2000);
        } else {
            // Permission denied
            document.body.innerHTML = `
                <div style="text-align: center; padding: 40px 20px;">
                    <h2 style="color: #dc3545;">Permission Denied</h2>
                    <p>You won't be able to import podcasts from external sources.</p>
                    <p style="color: #666; font-size: 14px;">This window will close automatically...</p>
                </div>
            `;
            
            setTimeout(() => {
                window.close();
            }, 3000);
        }
    } catch (error) {
        console.error('Error requesting permission:', error);
        document.body.innerHTML = `
            <div style="text-align: center; padding: 40px 20px;">
                <h2 style="color: #dc3545;">Error</h2>
                <p>Failed to request permission: ${error.message}</p>
            </div>
        `;
    }
});

document.getElementById('cancel').addEventListener('click', () => {
    window.close();
});

// Load domains when page loads
loadRequiredDomains();
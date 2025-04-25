// Extension download handler
const EXTENSION_ZIP_PATH = '/EMA-extension/EMA-extension.zip';
const INSTALL_GUIDE_URL = '#install-guide';

function handleExtensionDownload() {
    downloadExtensionZip();
    // Show installation instructions modal
    showInstallInstructions();
}

function downloadExtensionZip() {
    const link = document.createElement('a');
    link.href = EXTENSION_ZIP_PATH;
    link.download = 'EMA-extension.zip';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function showInstallInstructions() {
    const modal = document.createElement('div');
    modal.className = 'install-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <h2>Installation Instructions</h2>
            <ol>
                <li>Right-click the downloaded ZIP file and select "Extract All..."</li>
                <li>Choose a location to extract the files and click "Extract"</li>
                <li>Open Chrome and type <code>chrome://extensions</code> in the address bar</li>
                <li>Enable "Developer mode" using the toggle in the top right</li>
                <li>Click "Load unpacked" and select the <strong>extracted folder</strong> (not the ZIP file)</li>
                <li>The EMA extension should now appear in your Chrome toolbar!</li>
            </ol>
            <div class="warning-note">
                <p>⚠️ Important: You must extract the ZIP file first. Do not try to load the ZIP file directly.</p>
            </div>
            <button class="button primary-button" onclick="this.parentElement.parentElement.remove()">Got it!</button>
        </div>
    `;
    document.body.appendChild(modal);
}

// Add click event listeners to all download buttons
document.addEventListener('DOMContentLoaded', () => {
    const downloadButtons = document.querySelectorAll('.primary-button');
    downloadButtons.forEach(button => {
        if (button.textContent.includes('Get EMA') || button.textContent.includes('Add to Chrome')) {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                handleExtensionDownload();
            });
        }
    });
}); 
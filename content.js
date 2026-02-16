// Shopify PDF Auto-Downloader - Content Script
// Injects a "Download Both" button and captures PDF URLs

const PDF_URLS = {
  shippingLabel: null,
  packingSlip: null
};

// Broomfitters red color
const BROOMFITTERS_RED = '#C41E3A';

// Function to find print buttons (supports both native <button> and Shopify <s-internal-button>)
function findPrintButtons() {
  // Search both native buttons and Shopify's custom button elements
  const candidates = Array.from(document.querySelectorAll('button, s-internal-button'));
  console.log('[PDF-DL] Found', candidates.length, 'button candidates');
  console.log('[PDF-DL] Button texts:', candidates.map(b => `<${b.tagName.toLowerCase()}> "${b.textContent.trim()}"`));

  const shippingLabelButton = candidates.find(btn =>
    btn.textContent.includes('Print 1 shipping label') ||
    btn.textContent.includes('Reprint 1 shipping label')
  );
  const packingSlipButton = candidates.find(btn =>
    btn.textContent.includes('Print 1 packing slip')
  );

  console.log('[PDF-DL] Shipping label button:', shippingLabelButton ? `found <${shippingLabelButton.tagName.toLowerCase()}>` : 'NOT FOUND');
  console.log('[PDF-DL] Packing slip button:', packingSlipButton ? `found <${packingSlipButton.tagName.toLowerCase()}>` : 'NOT FOUND');

  return { shippingLabelButton, packingSlipButton };
}

// Function to find the button container
function findPrintButtonsContainer() {
  const { shippingLabelButton } = findPrintButtons();

  if (shippingLabelButton) {
    // Find the parent container that holds both buttons
    const container = shippingLabelButton.closest('.Polaris-LegacyStack--vertical');
    console.log('[PDF-DL] .Polaris-LegacyStack--vertical container:', container ? 'found' : 'NOT FOUND');
    if (!container) {
      // Log the parent chain to help debug
      let el = shippingLabelButton;
      const chain = [];
      while (el && chain.length < 10) {
        chain.push(`<${el.tagName.toLowerCase()}${el.className ? ' class="' + el.className + '"' : ''}>`);
        el = el.parentElement;
      }
      console.log('[PDF-DL] Parent chain from button:', chain.join(' → '));
    }
    return container;
  }
  return null;
}

// Function to create and inject the "Download Both" button
function injectDownloadButton() {
  const container = findPrintButtonsContainer();
  if (!container) {
    console.log('[PDF-DL] Print buttons container not found, retrying...');
    return false;
  }

  // Check if button already exists
  if (document.getElementById('broomfitters-download-both')) {
    return true;
  }

  // Create the button wrapper (matching Shopify's structure)
  const buttonWrapper = document.createElement('div');
  buttonWrapper.className = 'Polaris-LegacyStack__Item';

  const button = document.createElement('button');
  button.id = 'broomfitters-download-both';
  button.className = 'Polaris-Button Polaris-Button--pressable Polaris-Button--variantPrimary Polaris-Button--sizeMedium Polaris-Button--textAlignCenter Polaris-Button--fullWidth';
  button.style.backgroundColor = BROOMFITTERS_RED;
  button.style.borderColor = BROOMFITTERS_RED;
  button.setAttribute('type', 'button');
  button.setAttribute('aria-disabled', 'false');

  const buttonText = document.createElement('span');
  buttonText.className = 'Polaris-Text--root Polaris-Text--bodySm Polaris-Text--semibold';
  buttonText.textContent = 'Print both';

  button.appendChild(buttonText);
  buttonWrapper.appendChild(button);

  // Insert at the beginning of the container (above other buttons)
  container.insertBefore(buttonWrapper, container.firstChild);

  // Add click handler
  button.addEventListener('click', handleDownloadBothClick);

  console.log('[PDF-DL] Download Both button injected successfully');
  return true;
}

// Handle click on "Download Both" button
async function handleDownloadBothClick(e) {
  e.preventDefault();
  const button = e.currentTarget;
  const originalText = button.querySelector('span').textContent;

  // Update button text
  button.querySelector('span').textContent = 'Downloading...';
  button.disabled = true;

  try {
    // Trigger both downloads
    await triggerDownloads();

    // Show success state briefly
    button.querySelector('span').textContent = 'Downloaded!';
    setTimeout(() => {
      button.querySelector('span').textContent = originalText;
      button.disabled = false;
    }, 2000);
  } catch (error) {
    console.error('Download failed:', error);
    button.querySelector('span').textContent = 'Error - Try Again';
    setTimeout(() => {
      button.querySelector('span').textContent = originalText;
      button.disabled = false;
    }, 2000);
  }
}

// Trigger the actual downloads by clicking the original buttons and capturing URLs
async function triggerDownloads() {
  // Find the original buttons
  const { shippingLabelButton, packingSlipButton } = findPrintButtons();

  if (!shippingLabelButton || !packingSlipButton) {
    const candidates = Array.from(document.querySelectorAll('button, s-internal-button'));
    console.error('Could not find buttons. Available buttons:', candidates.map(b => b.textContent));
    throw new Error('Could not find original print buttons');
  }

  // Notify background script to start capture
  chrome.runtime.sendMessage({ action: 'startCapture' });

  // Set up URL capture before clicking
  const urlPromises = setupURLCapture();

  // Click packing slip first (slower printer)
  console.log('Clicking packing slip button...');
  packingSlipButton.click();

  // Small delay between clicks
  await new Promise(resolve => setTimeout(resolve, 1000));

  console.log('Clicking shipping label button...');
  shippingLabelButton.click();

  // Wait for URLs to be captured
  console.log('Waiting for URLs to be captured...');
  const urls = await urlPromises;

  console.log('URLs captured:', urls);

  // Stop capture mode
  chrome.runtime.sendMessage({ action: 'stopCapture' });

  // Send URLs to background script for download
  chrome.runtime.sendMessage({
    action: 'downloadPDFs',
    urls: urls
  });
}

// Set up URL capture by monitoring window.open and new tabs
function setupURLCapture() {
  return new Promise((resolve) => {
    const capturedURLs = [];
    let checkCount = 0;
    const maxChecks = 20; // 10 seconds max

    // Listen for messages from background script with URLs
    const messageListener = (message) => {
      if (message.action === 'capturedURL') {
        capturedURLs.push(message.url);

        if (capturedURLs.length >= 2) {
          chrome.runtime.onMessage.removeListener(messageListener);
          resolve(capturedURLs);
        }
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    // Timeout fallback
    const checkInterval = setInterval(() => {
      checkCount++;
      if (checkCount >= maxChecks) {
        clearInterval(checkInterval);
        chrome.runtime.onMessage.removeListener(messageListener);
        if (capturedURLs.length > 0) {
          resolve(capturedURLs);
        } else {
          resolve([]);
        }
      }
    }, 500);
  });
}

// Initialize the extension
function init() {
  // Try to inject button immediately
  if (injectDownloadButton()) {
    console.log('[PDF-DL] Initialized successfully');
    return;
  }

  console.log('[PDF-DL] Buttons not ready, watching for DOM changes...');

  // If not found, watch for DOM changes
  const observer = new MutationObserver(() => {
    if (injectDownloadButton()) {
      observer.disconnect();
      console.log('[PDF-DL] Initialized after DOM change');
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Don't stop observing - Shopify is an SPA that dynamically loads content
  // The observer will auto-disconnect once it successfully injects the button
}

// Re-initialize on URL changes (for SPA navigation)
let lastUrl = location.href;
new MutationObserver(() => {
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    console.log('[PDF-DL] URL changed to', currentUrl, '- re-initializing');
    // Small delay to let Shopify load the new content
    setTimeout(init, 500);
  }
}).observe(document, { subtree: true, childList: true });

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

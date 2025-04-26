// Cache for storing email summaries in memory
const emailSummaryCache = new Map();

// Function to get a saved email summary from storage
async function getEmailSummary(emailId) {
  // First check our local cache
  if (emailSummaryCache.has(emailId)) {
    return emailSummaryCache.get(emailId);
  }
  
  // If not in local cache, check Chrome storage
  return new Promise((resolve) => {
    chrome.storage.local.get(['emailSummaries'], (result) => {
      const summaries = result.emailSummaries || {};
      const savedSummary = summaries[emailId];
      
      // Check if we have a saved summary and it's less than 7 days old
      if (savedSummary && (Date.now() - savedSummary.timestamp < 7 * 24 * 60 * 60 * 1000)) {
        console.log(`🎯 Retrieved cached summary for email ${emailId}`);
        // Update our local cache
        emailSummaryCache.set(emailId, savedSummary.summary);
        resolve(savedSummary.summary);
      } else {
        resolve(null);
      }
    });
  });
}

// Styles for the EMA marker and summary popup
function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    /* Higher specificity selector targeting our markers */
    html body .ema-marker,
    body div .ema-marker,
    [role="main"] .ema-marker {
      width: 18px;
      height: 18px;
      cursor: pointer;
      margin-right: 8px;
      margin-left: -10px;
      display: inline-block;
      vertical-align: middle;
      position: relative;
      z-index: 999;
      opacity: 1;
      visibility: visible;
      transition: transform 0.2s ease;
      pointer-events: auto;
    }
    
    /* Still need !important for hover state to override Gmail */
    html body .ema-marker:hover {
      transform: scale(1.2) !important;
    }
    
    [role="main"] .ema-marker img,
    html body .ema-marker img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }
  
    /* Higher specificity for popup elements */
    body .ema-summary-popup,
    html .ema-summary-popup {
      position: absolute;
      z-index: 9999;
      background-color: white;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      padding: 0;
      width: 250px;
      max-width: calc(100vw - 40px);
      max-height: 300px;
      overflow: hidden;
      font-family: 'Roboto', sans-serif;
      animation: ema-fade-in 0.2s ease-out;
    }
    
    @keyframes ema-fade-in {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    body .ema-popup-header,
    html .ema-popup-header {
      background-image: linear-gradient(45deg, #94a8f5, #f67c79, #6680e3);
      color: white;
      padding: 6px 10px;
      font-weight: 500;
      font-size: 13px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top-left-radius: 8px;
      border-top-right-radius: 8px;
      height: 24px;
    }
    
    body .ema-popup-close,
    html .ema-popup-close {
      background: transparent;
      border: none;
      color: rgba(255, 255, 255, 0.8);
      font-size: 18px;
      font-weight: bold;
      cursor: pointer;
      padding: 0 4px;
      line-height: 1;
      opacity: 0.8;
      transition: opacity 0.2s;
    }
    
    body .ema-popup-close:hover,
    html .ema-popup-close:hover {
      opacity: 1;
    }
    
    body .ema-popup-content,
    html .ema-popup-content {
      padding: 16px;
      font-size: 14px;
      line-height: 1.5;
      color: #333;
      overflow-y: auto;
      max-height: 250px;
    }
    
    body .ema-summary-text,
    html .ema-summary-text {
      font-size: 14px;
      line-height: 1.5;
    }
    
    body .ema-loading,
    html .ema-loading {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 50px;
      color: #666;
    }
    
    body .ema-error,
    html .ema-error {
      color: #d32f2f;
      text-align: center;
      padding: 10px;
    }
    
    body .ema-popup-footer,
    html .ema-popup-footer {
      padding: 8px 12px;
      background-color: #f5f5f5;
      border-top: 1px solid #eee;
      font-size: 12px;
      color: #666;
      text-align: right;
    }
  `;
  document.head.appendChild(style);
}

// Helper to get email ID from Gmail elements
function getEmailId(element) {
  try {
    // Look up the DOM tree for elements with data attributes that might contain the email ID
    let current = element;
    let depth = 0;
    const maxDepth = 10;
    
    while (current && depth < maxDepth) {
      // Check common Gmail attributes that may contain email ID
      if (current.dataset && current.dataset.messageId) {
        return current.dataset.messageId;
      }
      
      if (current.getAttribute('data-thread-id')) {
        return current.getAttribute('data-thread-id');
      }
      
      if (current.getAttribute('data-legacy-thread-id')) {
        return current.getAttribute('data-legacy-thread-id');
      }
      
      // Gmail sometimes includes ID in the href of certain elements
      const idFromHref = current.href?.match(/\/([a-f0-9]+)$/)?.[1];
      if (idFromHref && idFromHref.length > 10) {
        return idFromHref;
      }
      
      current = current.parentElement;
      depth++;
    }
    
    // Fallback: try to find the ID from row attributes
    const row = element.closest('tr[role="row"]');
    if (row) {
      const idElement = row.querySelector('[data-thread-id], [data-legacy-thread-id], [data-message-id]');
      if (idElement) {
        return idElement.getAttribute('data-thread-id') || 
               idElement.getAttribute('data-legacy-thread-id') || 
               idElement.getAttribute('data-message-id');
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting email ID:', error);
    return null;
  }
}

// Store email summary to Chrome storage
async function storeEmailSummary(emailId, summary) {
  // Update local cache
  emailSummaryCache.set(emailId, summary);
  
  return new Promise((resolve) => {
    chrome.storage.local.get(['emailSummaries'], (result) => {
      const summaries = result.emailSummaries || {};
      
      // Add the new summary
      summaries[emailId] = {
        summary: summary,
        timestamp: Date.now()
      };
      
      // Store back to Chrome storage
      chrome.storage.local.set({ emailSummaries: summaries }, () => {
        console.log(`Stored summary for email ${emailId}`);
        resolve();
      });
    });
  });
}

// Generate summary for an email
async function generateSummary(emailContent, emailSubject, emailDate) {
  try {
    console.log('EMA: Generating summary for email', emailSubject);
    
    // Create a unique key for this email
    const cacheKey = `summary-${emailSubject}-${emailDate}`;
    
    return new Promise((resolve, reject) => {
      // First check if we have a cached summary
      chrome.storage.local.get([cacheKey], (result) => {
        if (result[cacheKey]) {
          console.log('EMA: Using cached summary');
          return resolve(result[cacheKey]);
        }
        
        // No cached summary, need to generate a new one using Gmail API and Gemini API
        console.log('EMA: No cached summary found, fetching full email and generating summary');
        
        // Show a loading message in the UI
        chrome.runtime.sendMessage({
          action: "updateSummaryStatus",
          status: "Accessing Gmail API..."
        });
        
        // Send request for the full email content via Gmail API
        chrome.runtime.sendMessage({
          action: 'fetchEmailForSummary',
          emailSubject: emailSubject,
          emailDate: emailDate
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('EMA: Error fetching email:', chrome.runtime.lastError);
            return resolve(`Unable to retrieve full email content for "${emailSubject}". Please try again.`);
          }
          
          if (!response || !response.success) {
            console.error('EMA: Failed to fetch email:', response?.error || 'Unknown error');
            return resolve(`Unable to generate summary for "${emailSubject}". Gmail API access failed.`);
          }
          
          // We now have the full email from Gmail API
          const fetchedEmail = response.email;
          if (!fetchedEmail) {
            return resolve(`Email "${emailSubject}" could not be located for summarization.`);
          }
          
          console.log('EMA: Successfully fetched email from Gmail API');
          
          // Extract important parts from the fetched email
          const fetchedSubject = fetchedEmail.subject || emailSubject;
          const fetchedSender = fetchedEmail.from || 'Unknown sender';
          const fetchedContent = fetchedEmail.content || emailContent;
          
          // Show status update
          chrome.runtime.sendMessage({
            action: "updateSummaryStatus",
            status: "Generating summary with Gemini..."
          });
          
          // Send to Gemini API for summarization
          chrome.runtime.sendMessage({
            action: 'summarizeWithGemini',
            prompt: `Summarize this email in one or two concise sentences:
            
Subject: ${fetchedSubject}
From: ${fetchedSender}
Content: ${fetchedContent}`,
          }, (summaryResponse) => {
            if (chrome.runtime.lastError) {
              console.error('EMA: Error generating summary with Gemini:', chrome.runtime.lastError);
              return resolve(`Email from ${fetchedSender} about "${fetchedSubject}". Could not generate detailed summary.`);
            }
            
            if (!summaryResponse || !summaryResponse.success) {
              console.error('EMA: Gemini API failed:', summaryResponse?.error || 'Unknown error');
              return resolve(`Email from ${fetchedSender} about "${fetchedSubject}". AI summary generation failed.`);
            }
            
            const generatedSummary = summaryResponse.summary;
            console.log('EMA: Successfully generated summary with Gemini API');
            
            // Cache the summary for future use
            chrome.storage.local.set({ [cacheKey]: generatedSummary }, () => {
              console.log('EMA: Cached summary for future use');
            });
            
            // Return the generated summary
            return resolve(generatedSummary);
          });
        });
      });
    });
  } catch (error) {
    console.error('EMA: Error in generateSummary:', error);
    return `Email about "${emailSubject}". Unable to summarize due to an error.`;
  }
}

// Create and show summary popup
function showSummaryPopup(emailContent, emailSubject, emailSender, emailDate, position) {
  try {
    console.log('EMA: Showing summary popup');
    
  // Remove any existing popups
    const existingPopup = document.getElementById('ema-summary-popup');
  if (existingPopup) {
    existingPopup.remove();
  }
  
    // Create a summary popup
  const popup = document.createElement('div');
    popup.id = 'ema-summary-popup';
  popup.className = 'ema-summary-popup';
  
    // Set popup position based on the marker position
    if (position) {
      popup.style.top = `${position.top + 25}px`;
      popup.style.left = `${position.left}px`;
    } else {
      // Default position
      popup.style.top = '100px';
      popup.style.left = '50%';
      popup.style.transform = 'translateX(-50%)';
    }
    
    // Create popup header with close button
    const popupHeader = document.createElement('div');
    popupHeader.className = 'ema-popup-header';
    
    const popupTitle = document.createElement('h3');
    popupTitle.textContent = 'Email Summary';
    popupTitle.style.cssText = 'margin: 0; font-size: 13px; font-weight: 500;';
    popupHeader.appendChild(popupTitle);
    
    const closeButton = document.createElement('button');
    closeButton.innerHTML = '&times;';
    closeButton.className = 'ema-popup-close';
    closeButton.addEventListener('click', () => {
      popup.remove();
    });
    popupHeader.appendChild(closeButton);
    popup.appendChild(popupHeader);
    
    // Create popup content
    const popupContent = document.createElement('div');
    popupContent.className = 'ema-popup-content';
    
    // Create summary section
    const summarySection = document.createElement('div');
    summarySection.className = 'ema-summary-section';
    
    // Check storage for existing summary
    chrome.storage.local.get([`summary-${emailSubject}-${emailDate}`], (result) => {
      const existingSummary = result[`summary-${emailSubject}-${emailDate}`];
      
      if (existingSummary) {
        console.log('EMA: Existing summary found, displaying it');
        // Display existing summary
        summarySection.innerHTML = `
          <div class="ema-summary-text">${existingSummary}</div>
        `;
    } else {
        console.log('EMA: No existing summary found, generating one automatically');
        // Show loading message
        summarySection.innerHTML = `
          <div class="ema-summary-text">Generating summary, please wait...</div>
        `;
        
        // Automatically generate summary
        generateSummary(emailContent, emailSubject, emailDate)
          .then(summary => {
            summarySection.innerHTML = `
              <div class="ema-summary-text">${summary || 'Unable to generate summary. Please try again later.'}</div>
            `;
          })
          .catch(error => {
            console.error('EMA: Error generating summary:', error);
            summarySection.innerHTML = `
              <div class="ema-summary-text">Sorry, we couldn't generate a summary at this time. Please try again later.</div>
            `;
          });
          
        // Add a timeout to avoid being stuck indefinitely on loading
        setTimeout(() => {
          // Check if we're still showing the loading message
          if (summarySection.querySelector('.ema-summary-text') && 
              summarySection.querySelector('.ema-summary-text').textContent.includes('Generating summary, please wait')) {
            console.log('EMA: Summary generation took too long, showing fallback message');
            summarySection.innerHTML = `
              <div class="ema-summary-text">Summary generation timed out. This email might be too complex or the service is currently busy.</div>
            `;
          }
        }, 10000); // 10-second timeout
      }
    });
    
    popupContent.appendChild(summarySection);
    popup.appendChild(popupContent);
    
    // Add popup to the page
    document.body.appendChild(popup);
    
    // Add event listener to close the popup when clicking outside
    document.addEventListener('click', (event) => {
      if (!popup.contains(event.target) && 
          !event.target.classList.contains('ema-marker') && 
          !event.target.closest('.ema-marker')) {
        popup.remove();
      }
    });
    
    return popup;
  } catch (error) {
    console.error('EMA: Error showing summary popup:', error);
    alert('Error showing summary popup. Please try again.');
    return null;
  }
}

// Create and add marker to an email element
function addMarkerToEmail(emailHeader, emailContent, isEvent = false) {
  try {
    console.log('EMA: Adding summary marker to email - header:', emailHeader);
    
    // Verify extension context is still valid
    try {
      chrome.runtime.getURL('logo.png');
    } catch (runtimeError) {
      console.error('EMA: Extension context invalid when adding marker:', runtimeError);
      return;
    }
    
    // If summary marker already exists, don't add another one
    if (emailHeader.querySelector('.ema-summary-marker')) {
      console.log('EMA: Summary marker already exists on this email');
      return;
    }
    
    // Create the summary marker button with the logo
    const summaryMarker = document.createElement('div');
    summaryMarker.className = 'ema-marker ema-summary-marker ema-extension-element';
    summaryMarker.title = 'Generate Email Summary';
    
    // Use the logo image instead of text
    summaryMarker.innerHTML = `<img src="${chrome.runtime.getURL('logo.png')}" alt="Summary" style="width: 100%; height: 100%; object-fit: contain;" />`;
    
    // Use high specificity instead of !important
    summaryMarker.setAttribute('style', `
      width: 18px;
      height: 18px;
      cursor: pointer;
      margin-right: 8px;
      margin-left: -10px;
      display: inline-block;
      vertical-align: middle;
      position: relative;
      z-index: 999;
      pointer-events: auto;
    `);
    
    console.log('EMA: Created summary marker element with logo');
    
    // Try different insertion strategies for better compatibility
    try {
      // Strategy 1: Insert at beginning of header
      const firstChild = emailHeader.firstChild;
      if (firstChild) {
        emailHeader.insertBefore(summaryMarker, firstChild);
        console.log('EMA: Inserted marker at the beginning of header');
      } else {
        // Strategy 2: Append to header
        emailHeader.appendChild(summaryMarker);
        console.log('EMA: Appended marker to header (no firstChild)');
      }
    } catch (insertError) {
      console.error('EMA: Error inserting marker into header:', insertError);
      
      // Strategy 3: Try appending to header
      try {
        emailHeader.appendChild(summaryMarker);
        console.log('EMA: Appended marker after insertion error');
      } catch (appendError) {
        console.error('EMA: Error appending marker to header:', appendError);
        return;
      }
    }
    
    // Get the email container for extracting email ID
    const emailContainer = emailHeader.closest('tr');
    
    // Add click event for summary marker
    summaryMarker.addEventListener('click', async (e) => {
      try {
        e.stopPropagation();
        console.log('EMA: Summary marker clicked');
        
        // Verify extension context is still valid before proceeding
        try {
          chrome.runtime.getURL('logo.png');
        } catch (runtimeError) {
          console.error('EMA: Extension context invalid when handling summary marker click:', runtimeError);
          return;
        }
        
        // Get the email ID
        const emailId = getEmailId(emailContainer);
        
        if (!emailId) {
          console.error('EMA: Could not determine email ID for summary');
          return;
        }
        
        console.log('EMA: Got email ID:', emailId);
        
        // Extract email details from the container
        let emailSubject = '';
        let emailSender = '';
        let emailDate = new Date().toISOString();
        
        // Try to extract email details from various elements
        try {
          // Try to find subject line
          const subjectElements = emailContainer.querySelectorAll('.y6, .bog, .bqe, [data-thread-title], [data-legacy-thread-title]');
          if (subjectElements.length > 0) {
            emailSubject = subjectElements[0].textContent.trim();
          }
          
          // Try to find sender
          const senderElements = emailContainer.querySelectorAll('.yW, .bA4, [email], .gD');
          if (senderElements.length > 0) {
            emailSender = senderElements[0].textContent.trim();
          } else if (emailContainer.querySelector('[email]')) {
            emailSender = emailContainer.querySelector('[email]').getAttribute('email');
          }
          
          // Try to find date
          const dateElements = emailContainer.querySelectorAll('.xW, .g3, .timestamp');
          if (dateElements.length > 0) {
            emailDate = dateElements[0].textContent.trim();
          }
          
          // Try to extract email content (body) from the message
          let extractedContent = '';
          
          // First try to find an open email in the view
          const messageBody = document.querySelector('.a3s, .ii.gt, [role="main"] .gs');
          if (messageBody) {
            extractedContent = messageBody.textContent || '';
          }
          
          // If we couldn't find the body or it's empty, use the subject as a fallback
          if (!extractedContent || extractedContent.length < 50) {
            extractedContent = `Subject: ${emailSubject}\nFrom: ${emailSender}\n\nThis email is currently shown in preview mode. Click to open the full message for a better summary.`;
          }
          
          // Use the extracted content
          emailContent = extractedContent;
          
        } catch (parseError) {
          console.error('EMA: Error parsing email details:', parseError);
        }
        
        // Calculate position for the popup
        const position = {
          top: summaryMarker.getBoundingClientRect().top + window.scrollY,
          left: summaryMarker.getBoundingClientRect().left + window.scrollX
        };
        
        // Show the summary popup
        await showSummaryPopup(emailContent, emailSubject, emailSender, emailDate, position);
        
      } catch (error) {
        console.error('EMA: Error in summary marker click handler:', error);
      }
    });
    
    console.log('EMA: Successfully added summary marker to email');
  } catch (error) {
    console.error('EMA: Error adding summary marker to email:', error);
  }
}

// Process all visible emails to add markers
function processEmails() {
  try {
    // First, verify the extension context is still valid
    try {
      chrome.runtime.getURL('logo.png');
    } catch (runtimeError) {
      console.error('EMA: Extension context invalid during email processing:', runtimeError);
      return; // Exit early if extension context is invalid
    }
    
    // Log Gmail structure to help debugging
    console.log('EMA: Gmail structure analysis:');
    
    // Alternative selectors for Gmail - try different known patterns
    const emailSelectors = [
      '.zA[role="row"]',                     // Message row
      'tr.zA[role="row"]',                   // Message row with tr
      '.h7',                                 // Classic selector
      '.UI div[role="main"] .zA',            // New Gmail
      'div[role="main"] .aDP div[role="listitem"]', // Grid view
      'div[role="main"] .BltHke[role="main"] .zA'   // Recent Gmail
    ];
    
    // Try multiple selectors to find emails
    let emailContainers = [];
    let matchedSelector = '';
    
    for (const selector of emailSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        emailContainers = elements;
        matchedSelector = selector;
        console.log(`EMA: Found ${elements.length} email containers using selector "${selector}"`);
        break;
      }
    }
    
    if (emailContainers.length === 0) {
      console.log('EMA: No email containers found. Gmail structure might have changed.');
      
      // Log the DOM structure for debugging
      const mainContent = document.querySelector('div[role="main"]');
      if (mainContent) {
        console.log('EMA: Main content structure:', mainContent.outerHTML.substring(0, 500) + '...');
      } else {
        console.log('EMA: Could not find main content area');
      }
      
      return;
    }
    
    console.log(`EMA: Processing ${emailContainers.length} potential email containers`);
    
    // Process each email container
    emailContainers.forEach((container, index) => {
      try {
        // Skip if already processed
        if (container.dataset.emaProcessed === 'true') {
          return;
        }
        
        // Mark as processed so we don't duplicate work
        container.dataset.emaProcessed = 'true';
        
        // Try multiple selectors for email header
        const emailHeaderSelectors = [
          '.a4W',                 // Classic selector
          '.gK',                  // New format
          '.adn',                 // Alternative
          '.bAk',                 // Recent Gmail
          '.px3',                 // Another variation
          'td[role="cell"]'       // Generic cell
        ];
        
        let emailHeader = null;
        for (const selector of emailHeaderSelectors) {
          emailHeader = container.querySelector(selector);
          if (!emailHeader) {
            emailHeader = container.closest('tr')?.querySelector(selector);
          }
          if (emailHeader) break;
        }
        
        if (!emailHeader) {
          console.log(`EMA: Email #${index} - No email header found`);
          return; // Cannot find the email header
        }
        
        console.log(`EMA: Email #${index} - Found valid email container with header`);
        
        // Try to get some basic content from the row to help with summarization
        let emailContent = '';
        
        // Try to extract snippets or preview content from the row
        const snippetElement = container.querySelector('.y2, .xS, .xT, .a4U');
        if (snippetElement) {
          emailContent = snippetElement.textContent || '';
          console.log(`EMA: Email #${index} - Found snippet: ${emailContent.substring(0, 50)}...`);
        }
        
        // Add summary marker to every email regardless of content
        try {
          console.log(`EMA: Email #${index} - Adding summary marker to email`);
          addMarkerToEmail(emailHeader, emailContent, false);
        } catch (error) {
          console.error(`EMA: Email #${index} - Error adding marker to email:`, error);
        }
        
      } catch (error) {
        console.error('EMA: Error processing email container:', error);
      }
    });
  } catch (error) {
    console.error('EMA: Error in processEmails function:', error);
  }
}

// Initialize the content script
function initialize() {
  try {
  console.log('EMA: Initializing content script');
  
    // Check if extension context is valid
    try {
  // Make the logo.png available for content script use
  chrome.runtime.getURL('logo.png');
    } catch (runtimeError) {
      console.error('EMA: Extension context invalid during initialization:', runtimeError);
      // If we can't access runtime APIs, we can't proceed with initialization
      return;
    }
  
  // Inject our styles
  injectStyles();
  
    // Also inject a style tag directly with higher specificity for the logo marker
    const forceStyles = document.createElement('style');
    forceStyles.id = 'ema-force-styles';
    forceStyles.textContent = `
      /* High specificity selectors to override Gmail styles */
      html body .ema-marker,
      [role="main"] .ema-marker,
      body div[role="main"] .ema-marker {
        display: inline-block;
        visibility: visible;
        opacity: 1;
        pointer-events: auto;
        position: relative;
        z-index: 999;
        margin-left: -10px;
      }
      
      html body .ema-marker img,
      [role="main"] .ema-marker img {
        display: block;
        visibility: visible;
        opacity: 1;
        pointer-events: auto;
      }
      
      /* Additional selector to prevent Gmail from hiding our markers */
      html body .ema-marker::after,
      [role="main"] .ema-marker::after {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 999;
      }
    `;
    document.head.appendChild(forceStyles);
    
    console.log('EMA: Styles injected successfully');
    
    // Process existing emails with a slight delay to ensure Gmail has loaded
    setTimeout(() => {
      console.log('EMA: Delayed email processing starting...');
  processEmails();
    }, 1000);
    
    // Define a function to check for missing markers and reapply them
    function checkAndRepairMarkers() {
      try {
        // Verify extension context is still valid
        chrome.runtime.getURL('logo.png');
        
        console.log('EMA: Checking for missing markers...');
        
        // Get all email containers that should have markers
        const emailContainers = document.querySelectorAll('[data-ema-processed="true"]');
        console.log(`EMA: Found ${emailContainers.length} processed email containers to check`);
        
        // For each container, verify it still has a marker
        emailContainers.forEach((container, index) => {
          // Find the header within this container
          const emailHeaderSelectors = [
            '.a4W', '.gK', '.adn', '.bAk', '.px3', 'td[role="cell"]'
          ];
          
          let emailHeader = null;
          for (const selector of emailHeaderSelectors) {
            emailHeader = container.querySelector(selector);
            if (!emailHeader) {
              emailHeader = container.closest('tr')?.querySelector(selector);
            }
            if (emailHeader) break;
          }
          
          if (!emailHeader) {
            console.log(`EMA: Email container #${index} - No header found during repair check`);
            return;
          }
          
          // Check if this header has a marker
          const hasMarker = emailHeader.querySelector('.ema-marker');
          if (!hasMarker) {
            console.log(`EMA: Email container #${index} - Marker missing, reapplying`);
            // Reapply marker
            addMarkerToEmail(emailHeader, '');
          }
        });
      } catch (error) {
        console.error('EMA: Error checking for missing markers:', error);
      }
    }
    
    // Set up observer for new emails and DOM changes
  const observer = new MutationObserver((mutations) => {
      try {
    let shouldProcess = false;
    
    for (const mutation of mutations) {
          // Process if nodes were added
      if (mutation.addedNodes.length) {
        shouldProcess = true;
        break;
      }
          
          // Also process if attributes changed on relevant elements
          if (mutation.type === 'attributes' && 
              (mutation.target.classList.contains('zA') || 
               mutation.target.closest('.zA') ||
               mutation.target.tagName === 'TR')) {
            shouldProcess = true;
            break;
          }
          
          // Also check if any markers were removed
          if (mutation.removedNodes.length) {
            for (let i = 0; i < mutation.removedNodes.length; i++) {
              const node = mutation.removedNodes[i];
              if (node.nodeType === 1 && 
                  (node.classList?.contains('ema-marker') || 
                   node.querySelector?.('.ema-marker'))) {
                console.log('EMA: Marker was removed, will reprocess');
                shouldProcess = true;
                break;
              }
            }
            if (shouldProcess) break;
      }
    }
    
    if (shouldProcess) {
          // Check if extension context is still valid before processing
          try {
            chrome.runtime.getURL('logo.png');
      // Delay processing slightly to ensure DOM is ready
            setTimeout(() => {
              processEmails();
              // Also check for missing markers
              setTimeout(checkAndRepairMarkers, 500);
            }, 100);
          } catch (runtimeError) {
            console.error('EMA: Extension context invalid during observer callback:', runtimeError);
            // If context is invalid, disconnect the observer to prevent further errors
            observer.disconnect();
          }
        }
      } catch (error) {
        console.error('EMA: Error in mutation observer:', error);
        // If we encounter any error in the observer, disconnect it to be safe
        observer.disconnect();
      }
    });
    
    // Start observing the main content area with more complete options
  const mainContent = document.body;
    observer.observe(mainContent, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'display']
    });
    
    console.log('EMA: MutationObserver initialized with enhanced options');
  
    // Re-process more frequently to catch any missed emails
    const intervalId = setInterval(() => {
      try {
        // Verify extension context is still valid
        chrome.runtime.getURL('logo.png');
        processEmails();
        // Also check for missing markers
        checkAndRepairMarkers();
      } catch (error) {
        console.error('EMA: Error in interval processing, stopping interval:', error);
        clearInterval(intervalId);
      }
    }, 2000); // More frequent check - every 2 seconds
    
    console.log('EMA: Periodic email processing interval set with frequent checks');
    
  } catch (error) {
    console.error('EMA: Error during initialization:', error);
  }
}

// Start the script
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

// Listen for messages from the extension
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.action === 'refreshMarkers') {
      // Clear all processed flags and re-process
      document.querySelectorAll('[data-ema-processed]').forEach(el => {
        delete el.dataset.emaProcessed;
      });
      
      // Remove existing markers
      document.querySelectorAll('.ema-marker').forEach(marker => {
        marker.remove();
      });
      
      // Re-process emails
      processEmails();
      
      sendResponse({ success: true });
    }
    // Add handler for summary response
    else if (message.action === 'summaryGenerated') {
      console.log('EMA: Received summary from background script');
      
      // Update any open popups
      const popup = document.getElementById('ema-summary-popup');
      if (popup) {
        const summarySection = popup.querySelector('.ema-summary-section');
        if (summarySection && message.summary) {
          summarySection.innerHTML = `
            <div class="ema-summary-text">${message.summary}</div>
          `;
        }
      }
      
      sendResponse({ success: true });
    }
  } catch (error) {
    console.error('EMA: Error handling message:', error);
    sendResponse({ success: false, error: error.message });
  }
}); 
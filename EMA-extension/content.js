// content.js - Content script for Gmail

// Configuration for email categories and their visual indicators
const emailCategories = {
  personal: {
    label: 'Personal',
    color: '#e57373',
    textColor: '#d32f2f',
    className: 'ema-personal'
  },
  work: {
    label: 'Student',
    color: '#9575cd',
    textColor: '#5e35b1',
    className: 'ema-work'
  },
  promo: {
    label: 'Promo',
    color: '#66bb6a',
    textColor: '#2e7d32',
    className: 'ema-promo'
  }
};

// Create and inject styles
function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .ema-category-tag {
      display: inline-flex;
      align-items: center;
      margin-right: 8px;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
      line-height: 16px;
      cursor: default;
      user-select: none;
    }
    
    .ema-personal {
      background-color: rgba(229, 115, 115, 0.1);
      color: #d32f2f;
      border: 1px solid #e57373;
    }
    
    .ema-work {
      background-color: rgba(149, 117, 205, 0.1);
      color: #5e35b1;
      border: 1px solid #9575cd;
    }
    
    .ema-promo {
      background-color: rgba(102, 187, 106, 0.1);
      color: #2e7d32;
      border: 1px solid #66bb6a;
    }
  `;
  document.head.appendChild(style);
}

// Function to determine email category
function determineEmailCategory(emailElement) {
  try {
    // Try to find category from Gmail's own categories first
    const categories = emailElement.querySelectorAll('[role="link"]');
    for (const category of categories) {
      const text = category.textContent.toLowerCase();
      if (text.includes('promotions') || text.includes('promo')) return 'promo';
      if (text.includes('social') || text.includes('personal')) return 'personal';
      if (text.includes('updates') || text.includes('forum')) return 'work';
    }
    
    // Check subject line for keywords
    const subject = emailElement.querySelector('span[email]') || 
                   emailElement.querySelector('.bog') ||
                   emailElement.querySelector('[data-thread-id]');
                   
    if (subject) {
      const text = subject.textContent.toLowerCase();
      if (text.includes('assignment') || text.includes('homework') || 
          text.includes('class') || text.includes('course')) return 'work';
      if (text.includes('offer') || text.includes('deal') || 
          text.includes('sale') || text.includes('discount')) return 'promo';
      if (text.includes('family') || text.includes('friend') || 
          text.includes('personal')) return 'personal';
    }
    
    return 'work'; // Default category
  } catch (error) {
    console.log('Error determining category:', error);
    return 'work';
  }
}

// Function to add category indicator
function addCategoryIndicator(emailElement) {
  try {
    // Skip if already processed
    if (emailElement.querySelector('.ema-category-tag')) return;
    
    const category = determineEmailCategory(emailElement);
    const config = emailCategories[category];
    
    // Create the tag element
    const tag = document.createElement('span');
    tag.className = `ema-category-tag ${config.className}`;
    tag.textContent = config.label;
    
    // Find insertion point - try multiple possible selectors
    const insertPoint = emailElement.querySelector('[data-thread-id]') || 
                       emailElement.querySelector('.bog') ||
                       emailElement.querySelector('span[email]');
                       
    if (insertPoint && insertPoint.parentNode) {
      insertPoint.parentNode.insertBefore(tag, insertPoint);
    }
  } catch (error) {
    console.log('Error adding category indicator:', error);
  }
}

// Function to process all visible emails
function processEmails() {
  try {
    // Find all email rows using Gmail's attributes
    const emailRows = document.querySelectorAll('tr[role="row"]');
    emailRows.forEach(row => {
      if (!row.dataset.emaProcessed) {
        addCategoryIndicator(row);
        row.dataset.emaProcessed = 'true';
      }
    });
  } catch (error) {
    console.log('Error processing emails:', error);
  }
}

// Initialize the content script
function initialize() {
  // Inject our styles
  injectStyles();
  
  // Process existing emails
  processEmails();
  
  // Set up observer for new emails
  const observer = new MutationObserver((mutations) => {
    let shouldProcess = false;
    
    for (const mutation of mutations) {
      if (mutation.addedNodes.length) {
        shouldProcess = true;
        break;
      }
    }
    
    if (shouldProcess) {
      // Delay processing slightly to ensure DOM is ready
      setTimeout(processEmails, 100);
    }
  });
  
  // Start observing the main content area
  const mainContent = document.querySelector('div[role="main"]');
  if (mainContent) {
    observer.observe(mainContent, {
      childList: true,
      subtree: true
    });
  }
}

// Start the script
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

// Add a retry mechanism
setTimeout(() => {
  const tags = document.querySelectorAll('.ema-category-tag');
  if (tags.length === 0) {
    initialize();
  }
}, 2000); 
import { summarizeWithGemini } from './geminiApi.js';
import { getEmailSummary, saveEmailSummary, cleanupOldSummaries } from './storage.js';

// When popup opens, request emails from background script
document.addEventListener('DOMContentLoaded', function() {
    const chatInput = document.getElementById('chat-input');
    const chatbox = document.getElementById('chatbox');
    const sendButton = document.getElementById('send-button');
    const micButton = document.getElementById('mic-button');
    const statusMessage = document.getElementById('status-message');
    const emailFilter = document.getElementById('email-filter');
    const readFilter = document.getElementById('read-filter');
    const refreshButton = document.getElementById('refresh-emails');
    const refreshSummaryButton = document.getElementById('refresh-summary');
    const emailSummary = document.getElementById('email-summary');
    const calendarEvents = document.getElementById('calendar-events');
    const refreshEvents = document.getElementById('refresh-events');

    console.log("📅 Popup: DOMContentLoaded - initializing popup");

    // Immediately load the latest events from storage and display them
    chrome.storage.local.get(['events'], function(result) {
        if (result.events && result.events.length > 0) {
            console.log(`📅 Popup: Found ${result.events.length} events in storage, displaying immediately`);
            displayCalendarEvents(result.events);
            
            // Sync with Google Calendar to update event statuses
            console.log("📅 Popup: Syncing events with Google Calendar on startup");
            chrome.runtime.sendMessage(
                {action: "syncCalendarEvents"},
                function(syncResponse) {
                    if (syncResponse && syncResponse.success && syncResponse.events) {
                        console.log(`📅 Popup: Calendar sync complete, updating events (${syncResponse.events.length} events)`);
                        displayCalendarEvents(syncResponse.events);
                    }
                }
            );
        } else {
            console.log("📅 Popup: No stored events found, waiting for fetch");
            calendarEvents.innerHTML = '<p class="events-placeholder">Loading events...</p>';
        }
    });

    // Speech recognition setup
    let recognition = null;
    let isListening = false;
    
    // Store the currently displayed emails for refresh summary function
    let currentEmails = null;
    
    // Listen for messages from background scripts
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        // Listen for events updated notification
        if (request.action === "eventsUpdated" && request.events) {
            console.log(`📅 Popup: Events updated notification received with ${request.events.length} events, refreshing UI`);
            displayCalendarEvents(request.events);
        }
        
        // Pass through status updates for the summary
        if (request.action === "updateSummaryStatus") {
            const statusMessage = request.status || "Processing...";
            emailSummary.innerHTML = `<p class="summary-loading">${statusMessage}</p>`;
        }
    });

    // Initial load - fetch emails and extract events
    console.log("📅 Popup: Initial fetch of emails");
    fetchEmails();
    
    // Make sure event extraction runs even if fetchEmails doesn't trigger it
    console.log("📅 Popup: Ensuring calendar events are extracted on load");
    setTimeout(() => {
        if (calendarEvents.innerHTML.trim() === '' || 
            calendarEvents.innerHTML.includes('events-placeholder')) {
            console.log("📅 Popup: Triggering calendar event extraction manually");
            extractCalendarEvents(true); // Force refresh on load
        }
    }, 1000);

    // Check if browser supports speech recognition
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        // Initialize speech recognition
        recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        // Handle recognition results
        recognition.onresult = function(event) {
            const transcript = Array.from(event.results)
                .map(result => result[0].transcript)
                .join('');
            
            chatInput.value = transcript;
            
            // Show the transcript as it's being recognized
            showStatus(transcript);
        };

        // Handle end of speech
        recognition.onend = function() {
            isListening = false;
            micButton.classList.remove('active');
            hideStatus();
            
            // If we got text, send the message after a brief delay
            if (chatInput.value.trim()) {
                setTimeout(() => {
                    sendMessage();
                }, 500);
            }
        };

        // Handle errors
        recognition.onerror = function(event) {
            console.error('Speech recognition error:', event.error);
            isListening = false;
            micButton.classList.remove('active');
            
            if (event.error === 'not-allowed') {
                showStatus('Microphone access denied', 3000);
            } else {
                showStatus('Speech recognition error', 3000);
            }
        };

        // Set up microphone button
        micButton.addEventListener('click', toggleSpeechRecognition);
    } else {
        // Hide mic button if speech recognition is not supported
        micButton.style.display = 'none';
        console.warn('Speech recognition not supported in this browser');
    }

    // Function to toggle speech recognition
    function toggleSpeechRecognition() {
        if (isListening) {
            recognition.stop();
            isListening = false;
            micButton.classList.remove('active');
            hideStatus();
        } else {
            recognition.start();
            isListening = true;
            micButton.classList.add('active');
            showStatus('Listening...');
            // Clear any existing text
            chatInput.value = '';
        }
    }

    // Function to show status message
    function showStatus(message, duration = 0) {
        statusMessage.textContent = message;
        statusMessage.classList.add('visible');
        
        if (duration > 0) {
            setTimeout(() => {
                hideStatus();
            }, duration);
        }
    }

    // Function to hide status message
    function hideStatus() {
        statusMessage.classList.remove('visible');
    }

    // Add initial greeting
    addMessageToChat("Hi! I'm EMA, your email assistant. I can help you find information in your emails or answer questions about them. What would you like to know?", 'bot');

    // Function to handle sending messages
    function sendMessage() {
        const message = chatInput.value.trim();
        if (!message) return;
    
        // Add user message to chat
        addMessageToChat(message, 'user');
        chatInput.value = '';
    
        // Send to background for Gemini processing
        chrome.runtime.sendMessage(
            { action: "processMessage", message: message },
            async function(response) {
                if (!response) {
                    addMessageToChat("Something went wrong.", 'bot');
                    return;
                }
    
                // Show Gemini's reply regardless
                if (response.reply) {
                    addMessageToChat(response.reply, 'bot');
                }
    
                // If Gemini says this is a calendar event, create it
                if (response.intent === "create_event" && response.eventDetails) {
                    console.log("📅 Detected event intent:", response.eventDetails);
                    
                    const success = await createEventFromDetails(response.eventDetails);
                    if (success) {
                        addMessageToChat(`✅ I added "${response.eventDetails.title}" to your calendar.`, 'bot');
                    } else {
                        addMessageToChat(`❌ I tried to add the event but ran into a problem.`, 'bot');
                    }
                }
            }
        );
    }
    async function createEventFromDetails(details) {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { action: "createCalendarEvent", event: details },
            (response) => {
              console.log("📬 Response from background:", response);
              resolve(response?.success || false);
            }
          );
        });
      }
      
        

    // Set up chat input listeners
    chatInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    sendButton.addEventListener('click', sendMessage);

    // Function to fetch emails based on filters
    function fetchEmails() {
        const timeFilterValue = emailFilter.value;
        const readFilterValue = readFilter.value;
        
        // Show loading state
        emailSummary.innerHTML = '<p class="summary-placeholder">Loading emails...</p>';
        calendarEvents.innerHTML = '<p class="events-placeholder">Scanning emails for calendar events...</p>';
        
        // Request emails from background script with filters
        chrome.runtime.sendMessage(
            {
                action: "getEmails", 
                timeFilter: timeFilterValue,
                readFilter: readFilterValue
            },
            function(response) {
                if (response && response.emails) {
                    // Store emails for potential refresh
                    currentEmails = response.emails;
                    
                    generateEmailSummary(response.emails);
                    
                    // Process calendar events
                    if (response.events && response.events.length > 0) {
                        displayCalendarEvents(response.events);
                    } else {
                        // Force refresh of calendar events
                        extractCalendarEvents(true);
                    }
                } else {
                    emailSummary.innerHTML = '<p class="summary-placeholder">No emails found.</p>';
                    calendarEvents.innerHTML = '<p class="events-placeholder">No events found.</p>';
                }
            }
        );
    }

    // Function to generate email summary
    function generateEmailSummary(emails, forceRegenerate = false) {
        if (!emails || emails.length === 0) {
            emailSummary.innerHTML = '<p class="summary-placeholder">No emails to summarize.</p>';
            return;
        }

        // Show loading state
        emailSummary.innerHTML = '<p class="summary-placeholder">Generating summary...</p>';
        
        // Get current filter values to check if they've changed
        const timeFilterValue = emailFilter.value;
        const readFilterValue = readFilter.value;
        
        // Send emails to background script for summarization
        chrome.runtime.sendMessage(
            {
                action: "summarizeEmails", 
                emails: emails,
                timeFilter: timeFilterValue,
                readFilter: readFilterValue,
                forceRegenerate: forceRegenerate
            },
            function(response) {
                if (response && response.summary) {
                    // Display the summary as text
                    emailSummary.innerHTML = `<p>${response.summary}</p>`;
                } else {
                    emailSummary.innerHTML = '<p class="summary-placeholder">Could not generate summary.</p>';
                }
            }
        );
    }
    
    // Function to extract calendar events from emails
    function extractCalendarEvents(forceRefresh = false) {
        console.log("📅 Popup: extractCalendarEvents called with forceRefresh =", forceRefresh);
        
        // Show loading state if not already shown
        const loadingPlaceholder = '<p class="events-placeholder">Scanning emails for calendar events...</p>';
        
        if (calendarEvents.innerHTML.trim() === '' || 
            !calendarEvents.innerHTML.includes('event-item')) {
            calendarEvents.innerHTML = loadingPlaceholder;
        }
        
        // Clear any previous timeouts to prevent multiple requests
        if (window.extractEventsTimeout) {
            clearTimeout(window.extractEventsTimeout);
        }
        
        // Add a small spinner to the refresh button
        const refreshButton = document.getElementById('refresh-events');
        if (refreshButton) {
            const originalContent = refreshButton.innerHTML;
            refreshButton.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spinning">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                </svg>
                Refreshing...
            `;
            
            // Disable the button while refreshing
            refreshButton.style.pointerEvents = 'none';
            refreshButton.style.opacity = '0.7';
            
            // Restore button after 5 seconds if no response
            window.refreshButtonTimeout = setTimeout(() => {
                refreshButton.innerHTML = originalContent;
                refreshButton.style.pointerEvents = '';
                refreshButton.style.opacity = '';
            }, 5000);
        }
        
        // First, sync with Google Calendar to ensure our event statuses are up-to-date
        console.log("📅 Popup: Sending syncCalendarEvents message");
        chrome.runtime.sendMessage(
            {action: "syncCalendarEvents"},
            function(syncResponse) {
                console.log("📅 Popup: Calendar sync result:", syncResponse);
                
                // Now request event extraction or use the updated events from sync
                if (syncResponse && syncResponse.success && syncResponse.events) {
                    console.log("📅 Popup: Using events from sync response");
                    // Use events returned from sync
                    handleEventsResponse(syncResponse);
                } else {
                    console.log("📅 Popup: Fallback to regular event extraction");
                    // Fallback to regular event extraction
                    chrome.runtime.sendMessage(
                        {action: "extractEvents", forceRefresh: forceRefresh},
                        function(response) {
                            console.log("📅 Popup: extractEvents response received", response);
                            handleEventsResponse(response);
                        }
                    );
                }
            }
        );
        
        // Helper function to handle event response and update UI
        function handleEventsResponse(response) {
            console.log("📅 Popup: handleEventsResponse called with:", response);
            // Clear loading spinner
            if (refreshButton && window.refreshButtonTimeout) {
                clearTimeout(window.refreshButtonTimeout);
                refreshButton.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                    </svg>
                    Refresh
                `;
                refreshButton.style.pointerEvents = '';
                refreshButton.style.opacity = '';
            }
            
            if (response && response.events && response.events.length > 0) {
                console.log(`📅 Popup: Displaying ${response.events.length} calendar events`);
                displayCalendarEvents(response.events);
            } else {
                console.log("📅 Popup: No calendar events found or error occurred");
                calendarEvents.innerHTML = '<p class="events-placeholder">No events found in your emails.</p>';
            }
        }
    }
    
    // Function to display calendar events
    function displayCalendarEvents(events) {
        if (!events || events.length === 0) {
            calendarEvents.innerHTML = '<p class="events-placeholder">No calendar events found.</p>';
            return;
        }
        
        // Clear the current content
        calendarEvents.innerHTML = '';
        
        // Filter out events based on user preference (can be added later)
        const showAddedEvents = localStorage.getItem('showAddedEvents') !== 'false'; // Default to true
        
        // Sort events by date (most recent first)
        events.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return dateA - dateB;
        });
        
        // Count how many valid events we're displaying
        let validEventsCount = 0;
        
        // Create HTML for each event
        events.forEach(event => {
            // Skip invalid events
            if (!event.date) {
                console.warn("Skipping event without date: ", event);
                return;
            }
            
            // Skip events that have been added to calendar if showAddedEvents is false
            if (!showAddedEvents && event.added) {
                return;
            }
            
            validEventsCount++;
            
            const eventElement = document.createElement('div');
            eventElement.className = `event-item${event.added ? ' added' : ''}`;
            eventElement.setAttribute('data-event-id', event.id);
            
            // Format date for display
            let formattedDate = "Unknown Date";
            try {
                const eventDate = new Date(event.date);
                if (!isNaN(eventDate.getTime())) {
                    formattedDate = eventDate.toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    });
                } else {
                    // If standard date parsing fails, show the original format
                    formattedDate = event.date;
                }
            } catch (error) {
                console.warn("Error formatting date:", error);
                formattedDate = event.date || "Unknown Date";
            }
            
            // Title fallback
            const title = event.title || "Untitled Event";
            
            // Create HTML structure for the event
            eventElement.innerHTML = `
                <div class="event-title">${title}</div>
                <div class="event-info">
                    <div class="event-date">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        ${formattedDate}
                    </div>
                    ${event.time ? `
                    <div class="event-time">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        ${event.time}
                    </div>
                    ` : ''}
                </div>
                ${event.location ? `
                <div class="event-location">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                        <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                    ${event.location}
                </div>
                ` : ''}
                ${event.description ? `<div class="event-description">${event.description.substring(0, 100)}${event.description.length > 100 ? '...' : ''}</div>` : ''}
                <div class="event-actions">
                    ${event.added ? `
                    <div class="event-added-badge">Added to Calendar</div>
                    ` : `
                    <button class="add-to-calendar" data-event-id="${event.id}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6"></path>
                            <path d="M3 10h18"></path>
                            <path d="M16 2v4"></path>
                            <path d="M8 2v4"></path>
                            <path d="M12 14v4"></path>
                            <path d="M10 16h4"></path>
                        </svg>
                        Add to Calendar
                    </button>
                    `}
                    ${event.sourceEmailId ? `
                    <button class="show-email" data-email-id="${event.sourceEmailId}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                            <polyline points="22,6 12,13 2,6"></polyline>
                        </svg>
                        Show Email
                    </button>
                    ` : ''}
                </div>
            `;
            
            calendarEvents.appendChild(eventElement);
        });
        
        // Show placeholder if no valid events after filtering
        if (validEventsCount === 0) {
            if (!showAddedEvents) {
                calendarEvents.innerHTML = '<p class="events-placeholder">No new events found. <a href="#" id="show-added-events">Show added events</a></p>';
                document.getElementById('show-added-events').addEventListener('click', function(e) {
                    e.preventDefault();
                    localStorage.setItem('showAddedEvents', 'true');
                    displayCalendarEvents(events);
                });
            } else {
                calendarEvents.innerHTML = '<p class="events-placeholder">No calendar events found.</p>';
            }
            return;
        }
        
        // Add event listeners to the "Add to Calendar" buttons
        const addButtons = calendarEvents.querySelectorAll('.add-to-calendar');
        addButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                const eventId = e.currentTarget.getAttribute('data-event-id');
                addEventToCalendar(eventId, events);
            });
        });
        
        // Add event listeners to the "Show Email" buttons
        const showEmailButtons = calendarEvents.querySelectorAll('.show-email');
        showEmailButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                const emailId = e.currentTarget.getAttribute('data-email-id');
                openEmailInGmail(emailId);
            });
        });
        
        // Add option to hide added events if there are any
        if (events.some(e => e.added) && showAddedEvents) {
            const controlElement = document.createElement('div');
            controlElement.className = 'events-control';
            controlElement.innerHTML = `
                <label>
                    <input type="checkbox" id="hide-added-events" ${!showAddedEvents ? 'checked' : ''}>
                    Hide events already added to calendar
                </label>
            `;
            calendarEvents.insertBefore(controlElement, calendarEvents.firstChild);
            
            document.getElementById('hide-added-events').addEventListener('change', function(e) {
                localStorage.setItem('showAddedEvents', !e.target.checked);
                displayCalendarEvents(events);
            });
        }
    }
    
    // Function to add an event to Google Calendar
    function addEventToCalendar(eventId, allEvents) {
        // Find the event with the matching ID
        const event = allEvents.find(e => e.id === eventId);
        if (!event) return;
        
        // Disable the button and show loading state
        const button = calendarEvents.querySelector(`button[data-event-id="${eventId}"]`);
        if (button) {
            button.disabled = true;
            button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> Adding...';
        }
        
        // Send the event to the background script to add to Calendar
        chrome.runtime.sendMessage(
            {action: "addToCalendar", event: event},
            function(response) {
                if (response && response.success) {
                    // Update the event in the UI
                    const eventElement = calendarEvents.querySelector(`div[data-event-id="${eventId}"]`);
                    if (eventElement) {
                        eventElement.classList.add('added');
                        
                        // Replace the button with a "Added to Calendar" badge
                        eventElement.innerHTML = eventElement.innerHTML.replace(
                            /<button class="add-to-calendar".*?<\/button>/s,
                            '<div class="event-added-badge">Added to Calendar</div>'
                        );
                    }
                    
                    // Show appropriate success message based on whether the event was already in the calendar
                    if (response.exists) {
                        addMessageToChat(`"${event.title}" is already in your Google Calendar.`, 'bot');
                    } else {
                        addMessageToChat(`I've added "${event.title}" to your Google Calendar.`, 'bot');
                    }
                    
                    // Refresh the events list to get the updated event statuses
                    setTimeout(extractCalendarEvents, 1000);
                } else {
                    // Re-enable the button
                    if (button) {
                        button.disabled = false;
                        button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6"></path><path d="M3 10h18"></path><path d="M16 2v4"></path><path d="M8 2v4"></path><path d="M12 14v4"></path><path d="M10 16h4"></path></svg> Add to Calendar';
                    }
                    
                    let errorMessage = 'I couldn\'t add the event to your calendar.';
                    
                    // Handle specific error cases
                    if (response?.error) {
                        if (response.error.includes('authorization') || 
                            response.error.includes('authenticate') ||
                            response.error.includes('permission')) {
                            errorMessage = `${errorMessage} ${response.error} You may need to reload the extension.`;
                        } else {
                            errorMessage = `${errorMessage} ${response.error}`;
                        }
                    } else {
                        errorMessage = `${errorMessage} Please try again.`;
                    }
                    
                    // Show error message
                    addMessageToChat(errorMessage, 'bot');
                }
            }
        );
    }

    // Function to open the source email in Gmail
    function openEmailInGmail(emailId) {
        if (!emailId) {
            addMessageToChat("Sorry, I couldn't find the source email for this event.", 'bot');
            return;
        }
        
        // Construct Gmail URL for the specific email
        const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${emailId}`;
        
        // Check if we have tabs permission
        chrome.permissions.contains({ permissions: ['tabs'] }, function(hasPermission) {
            if (hasPermission) {
                // Open in a new tab
                chrome.tabs.create({ url: gmailUrl });
                
                // Add a message to the chat
                addMessageToChat("I've opened the source email in a new tab.", 'bot');
            } else {
                // If we don't have permission, notify user and provide link
                const linkElement = document.createElement('a');
                linkElement.href = gmailUrl;
                linkElement.target = '_blank';
                linkElement.textContent = 'Open Email in Gmail';
                linkElement.className = 'email-link';
                
                const messageDiv = document.createElement('div');
                messageDiv.className = 'message bot';
                messageDiv.textContent = "Click this link to view the email: ";
                messageDiv.appendChild(linkElement);
                
                document.getElementById('chatbox').appendChild(messageDiv);
                
                // Scroll to bottom with smooth animation
                chatbox.scrollTo({
                    top: chatbox.scrollHeight,
                    behavior: 'smooth'
                });
            }
        });
    }

    // Set up event listeners for email filtering
    emailFilter.addEventListener('change', fetchEmails);
    readFilter.addEventListener('change', fetchEmails);
    refreshButton.addEventListener('click', fetchEmails);
    
    // Set up event listener for refreshing summary
    refreshSummaryButton.addEventListener('click', refreshSummary);
    
    // Set up event listeners for buttons
    if (refreshEvents) {
        console.log("📅 Popup: Setting up refresh events button listener");
        refreshEvents.addEventListener('click', function() {
            console.log("📅 Popup: Refresh events button clicked");
            extractCalendarEvents(true); // Force refresh when button is clicked
        });
    } else {
        console.warn("📅 Popup: Refresh events button not found");
    }

    // Initial fetch with default filter
    fetchEmails();

    // Function to regenerate summary without using cache
    function refreshSummary() {
        if (currentEmails && currentEmails.length > 0) {
            generateEmailSummary(currentEmails, true);
        } else {
            // If no emails are available, fetch them first
            fetchEmails();
        }
    }
});

function addMessageToChat(text, sender) {
    const chatbox = document.getElementById('chatbox');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    messageDiv.textContent = text;
    chatbox.appendChild(messageDiv);
    
    // Scroll to bottom with smooth animation
    chatbox.scrollTo({
        top: chatbox.scrollHeight,
        behavior: 'smooth'
    });
}

function updateEmailCounts(emails) {
    // Update the circle counts based on email categories
    let personalCount = 0;
    let workCount = 0;
    let promoCount = 0;

    emails.forEach(email => {
        // Simple categorization based on email content/labels
        if (email.labelIds && email.labelIds.includes('CATEGORY_PERSONAL')) {
            personalCount++;
        } else if (email.labelIds && email.labelIds.includes('CATEGORY_PROMOTIONS')) {
            promoCount++;
        } else {
            workCount++;
        }
    });

    // Update the UI circles
    document.querySelector('.circle-pink').textContent = personalCount;
    document.querySelector('.circle-purple').textContent = workCount;
    document.querySelector('.circle-green').textContent = promoCount;
}

// Example function to display the summary
function displaySummary(summaryText) {
    const summaryContainer = document.getElementById("summaryContainer");
    summaryContainer.textContent = summaryText; // Update the container with the summary
}

document.addEventListener("DOMContentLoaded", () => {
   

    const chatbox = document.getElementById("chatbox");
    const messageInput = document.getElementById("chat-input");
    const sendBtn = document.getElementById("sendBtn");
  
    // Load chat history from storage
    chrome.storage.local.get("chatHistory", (data) => {
      if (data.chatHistory) {
        chatbox.innerHTML = data.chatHistory;
      }
    });
  
    // Function to send message
    function sendMessage() {
      const message = messageInput.value.trim();
      if (message === "") return;
  
      // Create user message element
      const userMessage = `<div class="message user">${message}</div>`;
      chatbox.innerHTML += userMessage;
  
      // Auto-reply (Fake AI response for now)
      setTimeout(() => {
        const botMessage = `<div class="message bot">I received: "${message}"</div>`;
        chatbox.innerHTML += botMessage;
        chatbox.scrollTop = chatbox.scrollHeight; // Auto-scroll to bottom
  
        // Save messages to Chrome storage
        chrome.storage.local.set({ chatHistory: chatbox.innerHTML });
      }, 1000);
  
      messageInput.value = "";
      chatbox.scrollTop = chatbox.scrollHeight; // Auto-scroll to bottom
  
      // Save messages to Chrome storage
      chrome.storage.local.set({ chatHistory: chatbox.innerHTML });
    }
  
    // Event listeners
    if (sendBtn) {
        sendBtn.addEventListener("click", sendMessage);
    }
    if (messageInput) {
        messageInput.addEventListener("keypress", (event) => {
            if (event.key === "Enter") sendMessage();
        });
    }
});

setInterval(() => {
    console.log("🟢 Keeping background alive...");
  }, 15000);
  
  const openEmailsPageBtn = document.getElementById("open-emails-page");
  const fetchedEmailsContainer = document.getElementById("fetched-emails");
  const hideEmailsBtn = document.getElementById("hide-emails-btn");
  
  if (openEmailsPageBtn) {
    openEmailsPageBtn.addEventListener("click", () => {
      openEmailsPageBtn.disabled = true;
      openEmailsPageBtn.innerHTML = "⏳ Fetching emails...";

      // Clean up old summaries when fetching new emails
      cleanupOldSummaries().then(() => {
        const filterValue = document.getElementById("email-filter").value;
        chrome.runtime.sendMessage({ action: "getEmails", filter: filterValue }, async (response) => {

          if (!response || !response.emails) {
            fetchedEmailsContainer.innerHTML = "<p>Could not fetch emails.</p>";
            openEmailsPageBtn.textContent = "View All Fetched Emails";
            openEmailsPageBtn.disabled = false;
            return;
          }

          let emails = response.emails;
          if (!isNaN(filterValue)) {
            emails = emails.slice(0, parseInt(filterValue));
          }
          hideEmailsBtn.style.display = "inline-block";
          openEmailsPageBtn.style.display = "none";

          fetchedEmailsContainer.innerHTML = "";

          for (let i = 0; i < emails.length; i++) {
            const email = emails[i];
            const subject = email.payload?.headers?.find(h => h.name === "Subject")?.value || "No Subject";
            const from = email.from || "Unknown";
            const sender = from.includes("@") ? from.split("@")[0] : from;
            
            // Get the email ID
            const emailId = email.id;
            
            // Check if we have a cached summary for this email
            let summary = await getEmailSummary(emailId);
            let fromCache = false;
            
            // If no cached summary, generate a new one
            if (!summary) {
              console.log(`No cached summary found for email ${emailId}, generating new one...`);
              
              // Extract the full email content
              let emailContent = "";
              
              // Check if the email has a payload with parts (MIME structure)
              if (email.payload && (email.payload.body || email.payload.parts)) {
                // Try to get content from main body
                if (email.payload.body && email.payload.body.data) {
                  emailContent = atob(email.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
                } 
                // Or check in parts
                else if (email.payload.parts) {
                  // Find text parts
                  for (const part of email.payload.parts) {
                    if (part.mimeType === 'text/plain' && part.body && part.body.data) {
                      const partContent = atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
                      emailContent += partContent + "\n";
                    }
                  }
                }
              }
              
              // Fall back to snippet if parsing failed
              if (!emailContent || emailContent.length < 10) {
                emailContent = email.body || email.snippet || "No body";
                console.log(`Using fallback content for email ${i+1} (snippet)`);
              } else {
                console.log(`Successfully extracted full content for email ${i+1} (length: ${emailContent.length})`);
              }
              
              const prompt = `Summarize this email in **1 or 2 short sentences max**.
                Skip all promotions, jobs, and greetings. Focus only on the main update.

                Subject: ${subject}
                From: ${from}
                Body: ${emailContent}`;
      
              summary = await summarizeWithGemini(prompt);
              
              // Save the summary to cache for future use
              if (summary) {
                await saveEmailSummary(emailId, summary);
              }
            } else {
              console.log(`Using cached summary for email ${emailId}`);
              fromCache = true;
            }
            
            console.log('Email summary: ', summary);

            const card = document.createElement("div");
            card.style = `
              background: #f8f8f8;
              border-radius: 10px;
              padding: 12px;
              margin-bottom: 12px;
              box-shadow: 0 2px 5px rgba(0,0,0,0.05);
              font-size: 14px;
              position: relative;
            `;

            card.innerHTML = `
<div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
  <span style="background: #d3e5ef; color: #333; padding: 2px 8px; border-radius: 6px; font-weight: bold;">General</span>
  <span style="color: #555; font-weight: bold;">${sender}</span>
</div>
<div style="margin-bottom: 8px;">
  <strong>Summary:</strong> ${summary || "No summary generated."}
</div>
`;

            fetchedEmailsContainer.appendChild(card);
          }

          openEmailsPageBtn.textContent = "View All Fetched Emails";
          openEmailsPageBtn.disabled = false;
        });
      });
    });
  }
 



  hideEmailsBtn.addEventListener("click", () => {
    fetchedEmailsContainer.innerHTML = "";
    hideEmailsBtn.style.display = "none";
    openEmailsPageBtn.style.display = "inline-block";
  });
  
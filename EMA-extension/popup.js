import { summarizeWithGemini } from './geminiApi.js';
import { getEmailSummary, saveEmailSummary, cleanupOldSummaries, 
         getSummaryFromDB, getChatHistoryFromDB, clearChatHistoryInDB, 
         storeChatMessageInDB, deleteEventFromDB } from './storage.js';

// Global variables at the top of the file to track ongoing requests
let activeEmailRequest = null;
let activeSummaryRequest = null;
let activeEventsRequest = null;

// When popup opens, request emails from background script
document.addEventListener('DOMContentLoaded', function() {
    const chatInput = document.getElementById('chat-input');
    const chatbox = document.getElementById('chatbox');
    const sendButton = document.getElementById('send-button');
    const micButton = document.getElementById('mic-button');
    const statusMessage = document.getElementById('status-message');
    const refreshSummaryButton = document.getElementById('refresh-summary');
    const emailSummary = document.getElementById('email-summary');
    const calendarEvents = document.getElementById('calendar-events');
    const refreshEvents = document.getElementById('refresh-events');
    const readFilter = document.getElementById('read-filter');
    const refreshButton = document.getElementById('refresh-button');
    
    // Add pendingEmail variable initialization
    let pendingEmail = null;
    
    // Settings elements
    const settingsButton = document.getElementById('settings-button');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettings = document.getElementById('close-settings');
    const settingsTimePeriod = document.getElementById('settings-time-period');
    const settingsStatus = document.getElementById('settings-status');
    const settingsInboxOnly = document.getElementById('settings-inbox-only');
    const settingsExcludeOther = document.getElementById('settings-exclude-other');
    const settingsExcludePromotions = document.getElementById('settings-exclude-promotions');
    const settingsExcludeSocial = document.getElementById('settings-exclude-social');
    const settingsApply = document.getElementById('settings-apply');

    console.log("📅 Popup: DOMContentLoaded - initializing popup");
    
    // First clear IndexedDB chat history, then clear UI and add initial greeting
    clearChatHistoryInDB().then(() => {
        console.log('🧹 Cleared chat history from IndexedDB on startup');
        
        // Clear chat UI
        chatbox.innerHTML = '';
        
        // Also clear Chrome storage
        chrome.storage.local.remove(['chatHistory', 'conversationHistory'], function() {
            console.log('🧹 Cleared chat history from Chrome storage on startup');
            
            // Add initial greeting
            addMessageToChat("Hi! I'm EMA, your email assistant. I can help you find information in your emails or answer questions about them. What would you like to know?", 'bot');
        });
    }).catch(error => {
        console.error("Error clearing chat history from IndexedDB:", error);
        // Fallback if clearing fails
        chatbox.innerHTML = '';
        addMessageToChat("Hi! I'm EMA, your email assistant. I can help you find information in your emails or answer questions about them. What would you like to know?", 'bot');
    });

    // Initialize default settings if not already set
    chrome.storage.local.get(['emailSettings'], function(result) {
        if (!result.emailSettings) {
            const defaultSettings = {
                timePeriod: 'week',
                status: 'all',
                inboxOnly: true,
                excludeOther: true,
                excludePromotions: true,
                excludeSocial: true
            };
            chrome.storage.local.set({ emailSettings: defaultSettings });
            console.log('Initialized default email settings');
        }
    });

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

    // After fetching emails, also fetch contacts
    setTimeout(() => {
        fetchContacts();
    }, 1000); // Delay to allow email fetching to complete first

    // Settings handlers
    // Open settings modal
    settingsButton.addEventListener('click', function() {
        // Update settings form with current values from storage
        chrome.storage.local.get(['emailSettings'], function(result) {
            const settings = result.emailSettings || {
                timePeriod: 'week',
                status: 'all',
                inboxOnly: true,
                excludeOther: true,
                excludePromotions: true,
                excludeSocial: true
            };
            
            // Set values in form
            settingsTimePeriod.value = settings.timePeriod;
            settingsStatus.value = settings.status;
            settingsInboxOnly.checked = settings.inboxOnly;
            settingsExcludeOther.checked = settings.excludeOther;
            settingsExcludePromotions.checked = settings.excludePromotions;
            settingsExcludeSocial.checked = settings.excludeSocial;
        });
        
        // Show modal
        settingsModal.style.display = 'flex';
    });
    
    // Close settings modal
    closeSettings.addEventListener('click', function() {
        settingsModal.style.display = 'none';
    });
    
    // Close modal when clicking outside content
    settingsModal.addEventListener('click', function(e) {
        if (e.target === settingsModal) {
            settingsModal.style.display = 'none';
        }
    });
    
    // Apply settings
    settingsApply.addEventListener('click', function() {
        // Cancel any ongoing processes
        terminateActiveProcesses();
        // Clear all events from storage
        chrome.storage.local.remove(['events'], function() {
          console.log('Calendar events cleared from storage');
        
          // Get settings from form
          const settings = {
              timePeriod: settingsTimePeriod.value,
              status: settingsStatus.value,
              inboxOnly: settingsInboxOnly.checked,
              excludeOther: settingsExcludeOther.checked,
              excludePromotions: settingsExcludePromotions.checked,
              excludeSocial: settingsExcludeSocial.checked
          };
          
          // Save settings to storage
          chrome.storage.local.set({ emailSettings: settings }, function() {
              console.log('Email settings saved:', settings);
              
              // Close modal
              settingsModal.style.display = 'none';
              
              // Add a small delay to ensure storage is cleared before fetching
              calendarEvents.innerHTML = '<p class="events-placeholder">Refreshing events with new settings...</p>';
              
              // Use setTimeout to ensure complete cleanup before fetching new data
              setTimeout(() => {
                  // Fetch emails with new settings
                  fetchEmails();
              }, 500);
          });
        });
    });

    // Check if browser supports audio recording
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        let mediaRecorder;
        let audioChunks = [];
        const GEMINI_API_KEY = "AIzaSyBhlM0p5vFbeG0uR9oqb66ya2Gd8NuY6Ks";
        
        // Set up microphone button
        micButton.addEventListener('click', toggleSpeechRecognition);
        
        // Function to toggle speech recognition
        function toggleSpeechRecognition() {
            if (isListening) {
                stopRecording();
                isListening = false;
                micButton.classList.remove('active');
                hideStatus();
            } else {
                // Check for microphone permission first
                if (navigator.permissions && navigator.permissions.query) {
                    navigator.permissions.query({ name: 'microphone' })
                        .then(permissionStatus => {
                            if (permissionStatus.state === 'granted') {
                                // Permission already granted, start recording
                                startRecording();
                            } else if (permissionStatus.state === 'prompt') {
                                // Will show permission prompt, prepare user with our custom popup first
                                showMicrophonePermissionPopup();
                                
                                // Listen for permission changes
                                permissionStatus.onchange = function() {
                                    if (this.state === 'granted') {
                                        // Once granted, close our popup and start
                                        const tooltip = document.getElementById('mic-permission-tooltip');
                                        if (tooltip) tooltip.remove();
                                        
                                        startRecording();
                                    }
                                };
                                
                                // Try to start (will trigger browser's permission dialog)
                                startRecording();
                            } else if (permissionStatus.state === 'denied') {
                                // Permission previously denied
                                showMicrophonePermissionPopup();
                            }
                        })
                        .catch(error => {
                            console.error('Error checking permission:', error);
                            // Fallback to direct approach if permissions API fails
                            startRecording();
                        });
                } else {
                    // Permissions API not supported, try direct approach
                    startRecording();
                }
            }
        }
        
        // Variable to store the listening indicator interval
        let listeningIndicatorInterval = null;
        
        // Function to start the listening indicator animation
        function startListeningIndicator() {
            if (listeningIndicatorInterval) {
                clearInterval(listeningIndicatorInterval);
            }
            
            let dots = '';
            let count = 0;
            
            // Create and add a listening indicator element
            const indicatorContainer = document.createElement('div');
            indicatorContainer.id = 'listening-indicator';
            indicatorContainer.style.cssText = `
                position: fixed;
                bottom: 60px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(212, 79, 79, 0.9);
                color: white;
                padding: 6px 12px;
                border-radius: 20px;
                font-size: 14px;
                font-weight: bold;
                box-shadow: 0 2px 10px rgba(0,0,0,0.2);
                display: flex;
                align-items: center;
                z-index: 1000;
            `;
            
            // Add microphone icon
            indicatorContainer.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                </svg>
                <span>Listening<span id="listening-dots">...</span></span>
            `;
            
            document.body.appendChild(indicatorContainer);
            
            const dotsElement = document.getElementById('listening-dots');
            
            // Animate the dots
            listeningIndicatorInterval = setInterval(() => {
                count = (count + 1) % 4;
                dots = '.'.repeat(count);
                if (dotsElement) {
                    dotsElement.textContent = dots;
                }
            }, 500);
            
           
        }
        
        // Function to stop the listening indicator
        function stopListeningIndicator() {
            if (listeningIndicatorInterval) {
                clearInterval(listeningIndicatorInterval);
                listeningIndicatorInterval = null;
            }
            
            const indicator = document.getElementById('listening-indicator');
            if (indicator) {
                // Add fade-out animation
                indicator.style.transition = 'opacity 0.3s ease-out';
                indicator.style.opacity = '0';
                
                // Remove after animation completes
                setTimeout(() => {
                    if (indicator.parentElement) {
                        indicator.parentElement.removeChild(indicator);
                    }
                }, 300);
            }
        }
        
        // Start recording audio from microphone
        function startRecording() {
            console.log("Starting audio recording...");
            
            
            
            
            navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            })
            .then(stream => {
                console.log("Microphone access granted, initializing recording...");
                isListening = true;
                micButton.classList.add('active');
                
                // Start listening indicator with animated dots
                startListeningIndicator();
                
                // Clear any existing text
                chatInput.value = '';
                
                try {
                    // Initialize the Media Recorder with specific mime type and bitrate
                    mediaRecorder = new MediaRecorder(stream, {
                        mimeType: 'audio/webm;codecs=opus',
                        audioBitsPerSecond: 16000
                    });
                    audioChunks = [];
                    
                    console.log("MediaRecorder state:", mediaRecorder.state);
                    
                    // Collect audio chunks
                    mediaRecorder.addEventListener('dataavailable', event => {
                        console.log("Data available event, data size:", event.data.size);
                        if (event.data.size > 0) {
                            audioChunks.push(event.data);
                        }
                    });
                    
                    // When recording stops, transcribe the audio
                    mediaRecorder.addEventListener('stop', () => {
                        console.log("Recording stopped, processing audio...");
                        console.log("Collected audio chunks:", audioChunks.length);
                        
                        // Stop the listening indicator
                        stopListeningIndicator();
                        
                        // Only process if we have audio data
                        if (audioChunks.length > 0 && audioChunks.some(chunk => chunk.size > 0)) {
                            // Convert audio chunks to blob
                            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                            console.log("Audio blob created, size:", audioBlob.size);
                            
                            // Check if we have actual audio data
                            if (audioBlob.size > 100) {  // Arbitrary small threshold to check for data
                                
                                
                                // Send audio to Google Cloud Speech-to-Text API
                                transcribeAudio(audioBlob);
                            } else {
                                console.error("Audio blob too small, likely no audio recorded");
                                
                            }
                        } else {
                            console.error("No audio chunks collected");
                            
                        }
                        
                        // Stop all audio tracks
                        stream.getTracks().forEach(track => track.stop());
                    });
                    
                    // Handle recording errors
                    mediaRecorder.addEventListener('error', error => {
                        console.error("MediaRecorder error:", error);
                        stopListeningIndicator();
                        
                    });
                    
                    // Start recording with 10ms timeslices to get data frequently
                    mediaRecorder.start(10);
                    console.log("MediaRecorder started");
                    
                    // Automatically stop recording after 15 seconds
                    setTimeout(() => {
                        if (mediaRecorder && mediaRecorder.state === 'recording') {
                            console.log("Auto-stopping recording after timeout");
                            stopRecording();
                        }
                    }, 15000);
                } catch (error) {
                    console.error("Error setting up MediaRecorder:", error);
                    stopListeningIndicator();
                    
                    
                    // Clean up
                    isListening = false;
                    micButton.classList.remove('active');
                    stream.getTracks().forEach(track => track.stop());
                }
            })
            .catch(error => {
                console.error('Error accessing microphone:', error);
                isListening = false;
                micButton.classList.remove('active');
                
            });
        }
        
        // Stop recording audio
        function stopRecording() {
            console.log("Stopping recording...");
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                
                stopListeningIndicator(); // Stop the listening indicator
                mediaRecorder.stop();
                console.log("MediaRecorder stopped");
            } else {
                console.warn("Tried to stop recording, but MediaRecorder is not recording");
                stopListeningIndicator(); // Ensure indicator is stopped even if recorder isn't running
                hideStatus();
                isListening = false;
                micButton.classList.remove('active');
            }
        }
        
        // Transcribe audio using Google Cloud Speech-to-Text
        async function transcribeAudio(audioBlob) {
            try {
                console.log("Starting transcription for audio blob:", audioBlob.size, "bytes");
                
                // Convert Blob to base64
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                
                reader.onloadend = async () => {
                    try {
                        console.log("Audio file read complete");
                        
                        // Remove the data URL prefix to get just the base64 string
                        const base64Audio = reader.result.split(',')[1];
                        console.log("Base64 audio length:", base64Audio.length);
                        
                        if (!base64Audio || base64Audio.length < 100) {
                            console.error("Base64 audio data too small");
                            
                            return;
                        }
                        
                        // Using Google Cloud Speech-to-Text API
                        const apiUrl = `https://speech.googleapis.com/v1/speech:recognize?key=${GEMINI_API_KEY}`;
                        console.log("Sending request to Speech-to-Text API:", apiUrl);
                        
                        
                        
                        const requestData = {
                            config: {
                                encoding: "WEBM_OPUS",
                                sampleRateHertz: 48000,
                                languageCode: "en-US",  // Primary language (required)
                                model: "default",
                                enableAutomaticPunctuation: true
                            },
                            audio: {
                                content: base64Audio
                            }
                        };
                        
                        console.log("API Request config:", JSON.stringify(requestData.config));
                        
                        // Send request to Google Cloud Speech-to-Text
                        console.log("Sending API request...");
                        const response = await fetch(apiUrl, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(requestData)
                        });
                        
                        console.log("API response status:", response.status);
                        
                        if (!response.ok) {
                            const errorText = await response.text();
                            console.error("API error response:", errorText);
                            
                            return;
                        }
                        
                        const responseData = await response.json();
                        console.log("API response data:", JSON.stringify(responseData));
                        
                        // Check if we got results
                        if (responseData.results && responseData.results.length > 0) {
                            const transcript = responseData.results
                                .map(result => result.alternatives[0].transcript)
                                .join(' ');
                            
                            // Show detected language
                            if (responseData.results[0].languageCode) {
                                const detectedLang = responseData.results[0].languageCode;
                                console.log('Detected language:', detectedLang);
                                
                            }
                                
                            console.log('Transcription result:', transcript);
                            
                            // Update the input field with the transcript
                            chatInput.value = transcript;
            
            // If we got text, send the message after a brief delay
            if (chatInput.value.trim()) {
                setTimeout(() => {
                    sendMessage();
                }, 500);
                            } else {
                                
                            }
                        } else {
                            console.error('No transcription results:', responseData);
                            
                        }
                    } catch (innerError) {
                        console.error("Error in audio processing:", innerError);
                        
                    }
                };
                
                reader.onerror = (error) => {
                    console.error("FileReader error:", error);
                    
                };
            } catch (error) {
                console.error("Transcription error:", error);
                
            }
        }
        
        // Helper function to get language name from code
        function getLanguageName(langCode) {
            const languages = {
                'en': 'English',
                'en-US': 'English',
                'ar': 'Arabic',
                'ar-SA': 'Arabic',
                'ar-EG': 'Arabic (Egypt)',
                'fr': 'French',
                'fr-FR': 'French',
                'es': 'Spanish',
                'es-ES': 'Spanish'
            };
            
            // Check for exact match or just the language part (e.g., 'en' from 'en-US')
            return languages[langCode] || languages[langCode.split('-')[0]] || langCode;
        }
    } else {
        // Hide mic button if audio recording is not supported
        micButton.style.display = 'none';
        console.warn('Audio recording not supported in this browser');
    }


 

    // Function to show a mic permission tooltip bubble above the mic button
    function showMicrophonePermissionPopup() {
        // First remove any existing tooltip
        const existingTooltip = document.getElementById('mic-permission-tooltip');
        if (existingTooltip) {
            existingTooltip.remove();
        }
        
        // Get the mic button position
        const micButton = document.getElementById('mic-button');
        
        // Create tooltip container
        const tooltip = document.createElement('div');
        tooltip.id = 'mic-permission-tooltip';
        tooltip.style.cssText = `
            position: absolute;
            bottom: 100%;
            margin-bottom: 10px;
            background: white;
            padding: 12px 15px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
            z-index: 1000;
            max-width: 250px;
            text-align: center;
            animation: fadeIn 0.3s ease-out;
            transform-origin: bottom center;
        `;
        
        // Add tooltip content
        tooltip.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 5px; color: #e74c3c;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: text-bottom; margin-right: 5px;">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                </svg>
                Microphone Access Needed
            </div>
            <p style="margin: 5px 0; font-size: 12px; color: #555;">
                To allow: Right click icon > Manage extension > Site settings > Allow access to microphone
            </p>
        `;
        
        // Add tooltip to the chat input container
        const chatInputContainer = document.querySelector('.chat-input-container');
        chatInputContainer.style.position = 'relative';
        chatInputContainer.appendChild(tooltip);
        
        // Position the tooltip to be centered above the mic button
        // Get the mic button's position and size
        const micButtonRect = micButton.getBoundingClientRect();
        const containerRect = chatInputContainer.getBoundingClientRect();
        
        // Calculate the position to center tooltip over mic button
        const micButtonCenterX = micButtonRect.left + (micButtonRect.width / 2) - containerRect.left;
        const tooltipWidth = tooltip.offsetWidth;
        const leftPosition = micButtonCenterX - (tooltipWidth / 2);
        
        // Make sure tooltip doesn't go off the container edges
        const finalLeft = Math.max(10, Math.min(leftPosition, containerRect.width - tooltipWidth - 10));
        
        // Update tooltip position
        tooltip.style.left = `${finalLeft}px`;
        
        // Add tooltip arrow
        const arrow = document.createElement('div');
        arrow.style.cssText = `
            position: absolute;
            bottom: -8px;
            left: ${micButtonCenterX - finalLeft}px;
            width: 0;
            height: 0;
            border-left: 8px solid transparent;
            border-right: 8px solid transparent;
            border-top: 8px solid white;
            transform: translateX(-50%);
        `;
        
        tooltip.appendChild(arrow);
        
        // Add fade-in animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes fadeIn {
                from {
                    opacity: 0;
                    transform: scale(0.9) translateY(5px);
                }
                to {
                    opacity: 1;
                    transform: scale(1) translateY(0);
                }
            }
        `;
        document.head.appendChild(style);
        
        // Auto-hide after a few seconds
        setTimeout(() => {
            if (tooltip.parentElement) {
                tooltip.style.animation = 'fadeOut 0.3s ease-in forwards';
                
                // Add fade-out animation
                const fadeOutStyle = document.createElement('style');
                fadeOutStyle.textContent = `
                    @keyframes fadeOut {
                        from {
                            opacity: 1;
                            transform: scale(1) translateY(0);
                        }
                        to {
                            opacity: 0;
                            transform: scale(0.9) translateY(5px);
                        }
                    }
                `;
                document.head.appendChild(fadeOutStyle);
                
                // Remove after animation completes
                setTimeout(() => {
                    if (tooltip.parentElement) {
                        tooltip.remove();
                    }
                }, 300);
            }
        }, 6000);
    }


 

    // Function to hide status message
    function hideStatus() {
        if (!statusMessage) {
            return;
        }
        statusMessage.classList.remove('visible');
    }

    // Function to handle sending messages
    function sendMessage() {
        processChat();
    }
    
    // Set up chat input listeners
    chatInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            processChat();
        }
    });

    // Add the send button if it doesn't exist
    if (!sendButton) {
        const newSendButton = document.createElement('button');
        newSendButton.id = 'send-button';
        newSendButton.className = 'send-button';
        newSendButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
        document.querySelector('.chat-input-container').appendChild(newSendButton);
        sendButton = newSendButton;
    }

    // Attach event listener to the send button
    sendButton.addEventListener('click', processChat);

    // Function to terminate any active processes
    function terminateActiveProcesses() {
        console.log("Terminating active processes before applying new settings");
        
        // Cancel active email request
        if (activeEmailRequest) {
            chrome.runtime.sendMessage({
                action: "cancelRequest",
                requestId: activeEmailRequest
            });
            activeEmailRequest = null;
        }
        
        // Cancel active summary request
        if (activeSummaryRequest) {
            chrome.runtime.sendMessage({
                action: "cancelRequest",
                requestId: activeSummaryRequest
            });
            activeSummaryRequest = null;
        }
        
        // Cancel active events request
        if (activeEventsRequest) {
            chrome.runtime.sendMessage({
                action: "cancelRequest",
                requestId: activeEventsRequest
            });
            activeEventsRequest = null;
        }
        
        // Clear any pending timeouts
        if (window.extractEventsTimeout) {
            clearTimeout(window.extractEventsTimeout);
        }
        
        if (window.refreshButtonTimeout) {
            clearTimeout(window.refreshButtonTimeout);
        }
    }

    function fetchEmails() {
        // Get settings from storage
        chrome.storage.local.get(['emailSettings'], function(result) {
            const settings = result.emailSettings || {
                timePeriod: 'week',
                status: 'all',
                inboxOnly: true,
                excludeOther: true,
                excludePromotions: true,
                excludeSocial: true
            };
            
            // Show loading state
            emailSummary.innerHTML = '<p class="summary-placeholder">Loading emails...</p>';
            calendarEvents.innerHTML = '<p class="events-placeholder">Scanning emails for calendar events...</p>';
            
            // Generate a unique request ID
            activeEmailRequest = Date.now().toString();
            
            // Request emails from background script with filters
            chrome.runtime.sendMessage(
                {
                    action: "getEmails", 
                    requestId: activeEmailRequest,
                    timeFilter: settings.timePeriod,
                    readFilter: settings.status,
                    additionalFilters: {
                        inboxOnly: settings.inboxOnly,
                        excludeOther: settings.excludeOther,
                        excludePromotions: settings.excludePromotions,
                        excludeSocial: settings.excludeSocial
                    }
                },
                function(response) {
                    // Clear the active request ID
                    activeEmailRequest = null;
                    
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
        });
    }

    // Function to generate email summary
    function generateEmailSummary(emails, forceRegenerate = false) {
        if (!emails || emails.length === 0) {
            emailSummary.innerHTML = '<p class="summary-placeholder">No emails to summarize.</p>';
            return;
        }

        // Show loading state
        emailSummary.innerHTML = '<p class="summary-placeholder">Generating summary...</p>';
        
        // Get current filter values from storage rather than undefined variables
        chrome.storage.local.get(['emailSettings'], function(result) {
            const settings = result.emailSettings || {
                timePeriod: 'week',
                status: 'all'
            };
            
            // Generate a unique request ID
            activeSummaryRequest = Date.now().toString();
            
            // Send emails to background script for summarization
            chrome.runtime.sendMessage(
                {
                    action: "summarizeEmails", 
                    requestId: activeSummaryRequest,
                    emails: emails,
                    timeFilter: settings.timePeriod,
                    readFilter: settings.status,
                    forceRegenerate: forceRegenerate
                },
                function(response) {
                    // Clear the active request ID
                    activeSummaryRequest = null;
                    
                    if (response && response.summary) {
                        // Display the summary as text
                        emailSummary.innerHTML = `<p>${response.summary}</p>`;
                    } else {
                        emailSummary.innerHTML = '<p class="summary-placeholder">Could not generate summary.</p>';
                    }
                }
            );
        });
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
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spinning">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                </svg>

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
        
        // Generate a unique request ID
        activeEventsRequest = Date.now().toString();
        
        // First, sync with Google Calendar to ensure our event statuses are up-to-date
        console.log("📅 Popup: Sending syncCalendarEvents message");
        chrome.runtime.sendMessage(
            {
                action: "syncCalendarEvents",
                requestId: activeEventsRequest
            },
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
                        {
                            action: "extractEvents", 
                            requestId: activeEventsRequest,
                            forceRefresh: forceRefresh
                        },
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
            
            // Clear the active request ID
            activeEventsRequest = null;
            
            // Clear loading spinner
            if (refreshButton && window.refreshButtonTimeout) {
                clearTimeout(window.refreshButtonTimeout);
                refreshButton.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                </svg>
                    
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
        
        // Add option to hide added events if there are any - add this BEFORE we filter events
        if (events.some(e => e.added)) {
            const controlElement = document.createElement('div');
            controlElement.className = 'events-control';
            controlElement.innerHTML = `
                <label>
                    <input type="checkbox" id="hide-added-events" ${!showAddedEvents ? 'checked' : ''}>
                    Hide events already added to calendar
                </label>
            `;
            calendarEvents.appendChild(controlElement);
            
            document.getElementById('hide-added-events').addEventListener('change', function(e) {
                localStorage.setItem('showAddedEvents', !e.target.checked);
                displayCalendarEvents(events);
            });
        }
        
        // Add filtering controls for dated/undated events
        const viewMode = localStorage.getItem('eventViewMode') || 'with-dates'; // Default to showing events with dates
        
        const filterControlElement = document.createElement('div');
        filterControlElement.className = 'events-filter-controls';
        filterControlElement.innerHTML = `
            <div class="events-view-options">
                
                <label class="view-option ${viewMode === 'with-dates' ? 'active' : ''}">
                    <input type="radio" name="event-view" value="with-dates" ${viewMode === 'with-dates' ? 'checked' : ''}>
                    Events with Dates
                </label>
                <label class="view-option ${viewMode === 'without-dates' ? 'active' : ''}">
                    <input type="radio" name="event-view" value="without-dates" ${viewMode === 'without-dates' ? 'checked' : ''}>
                    Events without Dates
                </label>
            </div>
        `;
        calendarEvents.appendChild(filterControlElement);
        
        // Add event listeners to filter options
        const viewOptions = filterControlElement.querySelectorAll('input[name="event-view"]');
        viewOptions.forEach(option => {
            option.addEventListener('change', function(e) {
                const viewMode = e.target.value;
                localStorage.setItem('eventViewMode', viewMode);
                displayCalendarEvents(events);
            });
        });
        
        // Track events with and without dates
        let datedEvents = [];
        let undatedEvents = [];
        
        // Separate events with and without dates
        events.forEach(event => {
            // Skip events that have been added to calendar if showAddedEvents is false
            if (!showAddedEvents && event.added) {
                return;
            }
            
            if (event.date) {
                datedEvents.push(event);
            } else {
                undatedEvents.push(event);
            }
        });
        
        // Sort dated events by date (most recent first)
        datedEvents.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return dateA - dateB;
        });
        
        // Check for overlapping events
        const overlappingEventIds = new Set();
        
        // Function to check if two events overlap
        function eventsOverlap(event1, event2) {
            // Events must be on the same day to overlap
            if (event1.date !== event2.date) {
                return false;
            }
            
            // If either event doesn't have a time, we can't determine overlap
            if (!event1.time || !event2.time) {
                return false;
            }
            
            // Parse time strings, accounting for various formats (HH:MM, H:MM AM/PM, etc.)
            function parseTimeToMinutes(timeStr) {
                // Handle different time formats
                let hours = 0;
                let minutes = 0;
                
                // Extract hours and minutes from time string
                if (timeStr.includes(':')) {
                    // Format like "14:30" or "2:30 PM"
                    const timeParts = timeStr.split(':');
                    hours = parseInt(timeParts[0], 10);
                    
                    // Handle minutes part which might include AM/PM
                    if (timeParts[1].includes('PM') || timeParts[1].includes('pm')) {
                        minutes = parseInt(timeParts[1].split(/\s+|PM|pm/)[0], 10);
                        if (hours < 12) hours += 12; // Convert to 24-hour
                    } else if (timeParts[1].includes('AM') || timeParts[1].includes('am')) {
                        minutes = parseInt(timeParts[1].split(/\s+|AM|am/)[0], 10);
                        if (hours === 12) hours = 0; // Convert 12 AM to 0
                    } else {
                        // Just a regular time like "14:30"
                        minutes = parseInt(timeParts[1], 10);
                    }
                } else {
                    // Handle times without colons, like "1400"
                    if (timeStr.length >= 3) {
                        hours = parseInt(timeStr.substring(0, timeStr.length - 2), 10);
                        minutes = parseInt(timeStr.substring(timeStr.length - 2), 10);
                    } else {
                        hours = parseInt(timeStr, 10);
                    }
                }
                
                // Make sure we have valid numbers
                hours = isNaN(hours) ? 0 : hours;
                minutes = isNaN(minutes) ? 0 : minutes;
                
                return hours * 60 + minutes;
            }
            
            // Get start times in minutes for both events
            const start1 = parseTimeToMinutes(event1.time);
            const start2 = parseTimeToMinutes(event2.time);
            
            // Default duration is 1 hour if not specified
            const duration1 = event1.duration ? parseTimeToMinutes(event1.duration) : 60; 
            const duration2 = event2.duration ? parseTimeToMinutes(event2.duration) : 60;
            
            // Calculate end times
            const end1 = start1 + duration1;
            const end2 = start2 + duration2;
            
            // Check for overlap - events overlap if one starts before the other ends
            return (start1 < end2 && start2 < end1);
        }
        
        // Find overlapping events
        for (let i = 0; i < datedEvents.length; i++) {
            for (let j = i + 1; j < datedEvents.length; j++) {
                if (eventsOverlap(datedEvents[i], datedEvents[j])) {
                    console.log(`📅 Found overlapping events: "${datedEvents[i].title}" and "${datedEvents[j].title}" on ${datedEvents[i].date}`);
                    overlappingEventIds.add(datedEvents[i].id);
                    overlappingEventIds.add(datedEvents[j].id);
                }
            }
        }
        
        console.log(`📅 Found ${overlappingEventIds.size} events with overlaps`);
        if (overlappingEventIds.size > 0) {
            console.log(`📅 Overlapping event IDs: ${[...overlappingEventIds].join(', ')}`);
        }
        
        // Count how many valid events we're displaying
        let validEventsCount = 0;
        
        // Display dated events if viewMode is 'with-dates'
        if (datedEvents.length > 0 && viewMode === 'with-dates') {
            const datedEventsContainer = document.createElement('div');
            datedEventsContainer.className = 'dated-events';
            
            // Create HTML for each dated event
            datedEvents.forEach(event => {
                validEventsCount++;
                
                // Pass the overlap information to the createEventElement function
                const isOverlapping = overlappingEventIds.has(event.id);
                const eventElement = createEventElement(event, isOverlapping);
                datedEventsContainer.appendChild(eventElement);
            });
            
            calendarEvents.appendChild(datedEventsContainer);
        }
        
        // Display undated events if viewMode is 'without-dates'
        if (undatedEvents.length > 0 && viewMode === 'without-dates') {
            const undatedHeader = document.createElement('div');
            undatedHeader.className = 'floating-events-header';
            undatedHeader.innerHTML = `
                <h4>Events without Dates <span class="undated-count">${undatedEvents.length}</span></h4>
                <div class="floating-events-info">Events without specific date information</div>
            `;
            calendarEvents.appendChild(undatedHeader);
            
            const undatedEventsContainer = document.createElement('div');
            undatedEventsContainer.className = 'undated-events';
            
            // Create HTML for each undated event
            undatedEvents.forEach(event => {
                validEventsCount++;
                
                const eventElement = createEventElement(event, false); // Undated events can't overlap
                undatedEventsContainer.appendChild(eventElement);
            });
            
            calendarEvents.appendChild(undatedEventsContainer);
            }
            
        // Show placeholder if no valid events after filtering
        if (validEventsCount === 0) {
            if (!showAddedEvents) {
                const placeholderElement = document.createElement('p');
                placeholderElement.className = 'events-placeholder';
                placeholderElement.innerHTML = 'No new events found. <a href="#" id="show-added-events">Show added events</a>';
                calendarEvents.appendChild(placeholderElement);
                
                document.getElementById('show-added-events').addEventListener('click', function(e) {
                    e.preventDefault();
                    localStorage.setItem('showAddedEvents', 'true');
                    displayCalendarEvents(events);
                });
            } else {
                const placeholderElement = document.createElement('p'); 
                placeholderElement.className = 'events-placeholder';
                
                // Customize message based on view mode
                if (viewMode === 'with-dates') {
                    placeholderElement.textContent = 'No events with dates found.';
                    
                    // If we have undated events, suggest switching to that view
                    if (undatedEvents.length > 0) {
                        placeholderElement.innerHTML += ` <a href="#" id="switch-to-undated">View ${undatedEvents.length} events without dates</a>`;
                        
                        // Add event listener after the element is added to DOM
                        setTimeout(() => {
                            const switchLink = document.getElementById('switch-to-undated');
                            if (switchLink) {
                                switchLink.addEventListener('click', function(e) {
                                    e.preventDefault();
                                    localStorage.setItem('eventViewMode', 'without-dates');
                                    displayCalendarEvents(events);
                                });
                            }
                        }, 0);
                    }
                } else {
                    placeholderElement.textContent = 'No events without dates found.';
                    
                    // If we have dated events, suggest switching to that view
                    if (datedEvents.length > 0) {
                        placeholderElement.innerHTML += ` <a href="#" id="switch-to-dated">View ${datedEvents.length} events with dates</a>`;
                        
                        // Add event listener after the element is added to DOM
                        setTimeout(() => {
                            const switchLink = document.getElementById('switch-to-dated');
                            if (switchLink) {
                                switchLink.addEventListener('click', function(e) {
                                    e.preventDefault();
                                    localStorage.setItem('eventViewMode', 'with-dates');
                                    displayCalendarEvents(events);
                                });
                            }
                        }, 0);
                    }
                }
                
                calendarEvents.appendChild(placeholderElement);
            }
                return;
            }
            
        // Add event listeners to all buttons
        addEventListeners();
            
        // Helper function to create an event element
        function createEventElement(event, isOverlapping) {
            const eventElement = document.createElement('div');
            eventElement.className = `event-item${event.added ? ' added' : ''}${isOverlapping ? ' overlapping' : ''}`;
            eventElement.setAttribute('data-event-id', event.id);
            
            // Format date for display or show placeholder for undated events
            let formattedDate = "Flexible Timing";
            if (event.date) {
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
                    formattedDate = event.date || "Flexible Timing";
                }
            }
            
            // Title fallback
            const title = event.title || "Untitled Event";
            
            // Create HTML structure for the event
            eventElement.innerHTML = `
                <div class="event-header">
                <div class="event-title">${title}</div>
                    ${isOverlapping ? '<div class="event-overlap-indicator" title="This event overlaps with another event on the same day">⚠️ Scheduling Conflict</div>' : ''}
                    <button class="delete-event-x" data-event-id="${event.id}" title="Remove this event">×</button>
                </div>
                <div class="event-info">
                    <div class="event-date">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            ${event.date ? `
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                            ` : `
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                            `}
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
                    <button class="remove-from-calendar" data-event-id="${event.id}.remove">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                        Remove from Calendar
                    </button>
                    ` : `
                    ${event.date ? `
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
                    ` : `
                    <button class="add-to-calendar disabled" disabled title="A date is required to add to calendar">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6"></path>
                            <path d="M3 10h18"></path>
                            <path d="M16 2v4"></path>
                            <path d="M8 2v4"></path>
                            <path d="M12 14v4"></path>
                            <path d="M10 16h4"></path>
                        </svg>
                        Date Required
                    </button>
                    `}
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
            
            return eventElement;
        }
        
        // Helper function to add event listeners to all buttons
        function addEventListeners() {
        // Add event listeners to the "Add to Calendar" buttons
        const addButtons = calendarEvents.querySelectorAll('.add-to-calendar');
        addButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                const eventId = e.currentTarget.getAttribute('data-event-id');
                addEventToCalendar(eventId, events);
            });
        });
            
            // Add event listeners to the "Remove from Calendar" buttons
            const removeButtons = calendarEvents.querySelectorAll('.remove-from-calendar');
            removeButtons.forEach(button => {
                button.addEventListener('click', function(e) {
                    const eventId = e.currentTarget.getAttribute('data-event-id').split('.')[0];
                    removeEventFromCalendar(eventId, events);
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
        
        // Add event listeners to the "Delete Event" buttons
            const deleteButtons = calendarEvents.querySelectorAll('.delete-event-x');
        deleteButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                const eventId = e.currentTarget.getAttribute('data-event-id');
                deleteEvent(eventId, events);
            });
            });
        }
    }
    
    // Function to add an event to Google Calendar
    function addEventToCalendar(eventId, allEvents) {
        // Find the event with the matching ID
        const event = allEvents.find(e => e.id === eventId);
        if (!event) return;
        
        // Check if event has a date - if not, don't proceed
        if (!event.date) {
            console.log("⚠️ Cannot add event to calendar - no date specified:", event.title);
            addMessageToChat(`I can't add "${event.title}" to your calendar because it doesn't have a date. Please specify a date first.`, 'bot');
            return;
        }
        
        // Disable the button and show loading state
        const button = calendarEvents.querySelector(`button[data-event-id="${eventId}"]`);
        if (button) {
            button.disabled = true;
            button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
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

    // Function to delete an event from the list
    function deleteEvent(eventId, allEvents) {
        if (!eventId) return;
        
        // Find the event element
        const eventElement = calendarEvents.querySelector(`div[data-event-id="${eventId}"]`);
        
        if (eventElement) {
            // Remove the element from DOM with animation
            eventElement.style.opacity = "0";
            eventElement.style.height = "0";
            eventElement.style.marginBottom = "0";
            eventElement.style.padding = "0";
            eventElement.style.overflow = "hidden";
            eventElement.style.transition = "all 0.3s ease";
            
            // After animation completes, remove it completely
            setTimeout(() => {
                eventElement.remove();
                
                // If it was the last event, show "no events" message
                if (calendarEvents.querySelectorAll('.event-item').length === 0) {
                    calendarEvents.innerHTML = '<p class="events-placeholder">No calendar events found.</p>';
                }
                
                // Show a message to the user
                addMessageToChat("Event has been removed from your list.", 'bot');
                
                // Remove from storage by filtering out this event
                chrome.storage.local.get(['events'], function(result) {
                    if (result.events && result.events.length > 0) {
                        const updatedEvents = result.events.filter(event => event.id !== eventId);
                        chrome.storage.local.set({ events: updatedEvents });
                    }
                });
                
                // Also remove from the database
                deleteEventFromDB(eventId)
                    .then(success => {
                        if (success) {
                            console.log(`✅ Event ${eventId} successfully removed from database`);
                        } else {
                            console.warn(`⚠️ Failed to remove event ${eventId} from database`);
                        }
                    })
                    .catch(error => {
                        console.error(`❌ Error removing event from database:`, error);
                    });
            }, 300);
        }
    }

    // Function to remove an event from Google Calendar
    function removeEventFromCalendar(eventId, allEvents) {
        // Find the event in our list
        const event = allEvents.find(e => e.id === eventId);
        if (!event) {
            console.error("Event not found:", eventId);
            return;
        }
        
        // Disable the button and show loading state
        const button = calendarEvents.querySelector(`button[data-event-id="${eventId}.remove"]`);
        if (button) {
            button.disabled = true;
            button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> Removing...';
        }
        
        // Send the event to the background script to remove from Calendar
        chrome.runtime.sendMessage(
            {action: "removeFromCalendar", event: event},
            function(response) {
                if (response && response.success) {
                    // Update the event in the storage
                    chrome.storage.local.get(['events'], function(result) {
                        if (result.events && result.events.length > 0) {
                            const updatedEvents = result.events.map(e => {
                                if (e.id === eventId) {
                                    return { ...e, added: false };
                                }
                                return e;
                            });
                            
                            // Update storage and then refresh the UI based on current display settings
                            chrome.storage.local.set({ events: updatedEvents }, function() {
                                console.log(`📅 Event ${eventId} marked as not added in storage`);
                                
                                // Check visibility settings and re-render the events list
                                const showAddedEvents = localStorage.getItem('showAddedEvents') !== 'false';
                                
                                // Re-render the events list to properly update the UI
                                displayCalendarEvents(updatedEvents);
                                
                                // Show a success message
                                addMessageToChat("Event has been removed from your Google Calendar.", 'bot');
                            });
                        }
                    });
                } else {
                    // Show an error message
                    addMessageToChat("Failed to remove the event from your Google Calendar. Please try again.", 'bot');
                    
                    // Re-enable the button
                    if (button) {
                        button.disabled = false;
                        button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> Remove from Calendar';
                    }
                }
            }
        );
    }

    // Set up event listeners for email filtering
    if (readFilter) {
        readFilter.addEventListener('change', fetchEmails);
    }
    
    if (refreshButton) {
        refreshButton.addEventListener('click', fetchEmails);
    }
    
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

        const refreshSummaryButton = document.getElementById('refresh-summary');
        if (refreshSummaryButton) {
            const originalContent = refreshSummaryButton.innerHTML;
            refreshSummaryButton.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spinning">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                </svg>
           `;
            
            // Disable the button while refreshing
            refreshSummaryButton.style.pointerEvents = 'none';
            refreshSummaryButton.style.opacity = '0.7';
            
            // Restore button after 5 seconds if no response
            window.refreshSummaryButtonTimeout = setTimeout(() => {
                refreshSummaryButton.innerHTML = originalContent;
                refreshSummaryButton.style.pointerEvents = '';
                refreshSummaryButton.style.opacity = '';
            }, 5000);
        }
    }

    // Add listener to clear storage when popup closes
    window.addEventListener('unload', function() {
        console.log('🧹 Clearing chat history as popup closes');
        
        // Clear chat-related items from Chrome storage
        chrome.storage.local.remove(['chatHistory', 'conversationHistory']);
        
        // Also clear chat history from IndexedDB
        clearChatHistoryInDB().then(() => {
            console.log('Chat history successfully cleared from IndexedDB');
        }).catch(error => {
            console.error('Error clearing chat history from IndexedDB:', error);
        });
    });

    // Add a function to fetch contacts
    function fetchContacts() {
        // Update status text to indicate we're fetching contacts
        const statusEl = document.getElementById('status-text');
        if (statusEl) {
            statusEl.innerHTML += `<br>👥 Fetching contacts...`;
        }
        
        chrome.runtime.sendMessage({ action: "fetchContacts" }, function(response) {
            if (response && response.status === "success") {
                console.log(`✅ Fetched ${response.count} contacts`);
                
                // Update the UI to indicate contacts are loaded
                const statusEl = document.getElementById('status-text');
                if (statusEl) {
                    // Replace the previous status with success message
                    statusEl.innerHTML = statusEl.innerHTML.replace("👥 Fetching contacts...", `✅ ${response.count} contacts loaded`);
                }
            } else {
                console.error("Error fetching contacts:", response);
                
                // Update the UI to indicate an error
                const statusEl = document.getElementById('status-text');
                if (statusEl) {
                    // Replace the previous status with error message
                    statusEl.innerHTML = statusEl.innerHTML.replace("👥 Fetching contacts...", `❌ Failed to load contacts`);
                }
            }
        });
    }

    // Process and send a chat message
    function processChat() {
        const message = chatInput.value.trim();
        if (!message) return;
        
        // Add user message to the chat
        addMessageToChat(message, 'user');
        
        // Clear input
        chatInput.value = '';
        
        // Show loading indicator
        addLoadingIndicator();
        
        // Clear the request type cache first
        chrome.runtime.sendMessage(
            {
                action: "clearRequestTypeCache",
                message: message
            },
            function() {
                // Create the context object, only include pendingEmail if it exists
                const context = {};
                if (pendingEmail) {
                    context.pendingEmail = pendingEmail;
                }
                
                // Send message to background script
                chrome.runtime.sendMessage(
                    {
                        action: "processMessage",
                        message: message,
                        context: context
                    },
                    function(response) {
                        // Remove loading indicator
                        removeLoadingIndicator();
                        
                        if (response && response.reply) {
                            // Add response to the chat
                            addMessageToChat(response.reply, 'bot');
                            
                            // Check if we need to update our pending email
                            if (response.needsConfirmation) {
                                console.log("📧 Email draft needs confirmation");
                                
                                // If there's a pendingEmail in the response, use it, otherwise try to create one from context
                                if (response.pendingEmail) {
                                    console.log("📧 Using pendingEmail from response");
                                    pendingEmail = response.pendingEmail;
                                } else {
                                    // The old email probably got stored in Chrome storage
                                    console.log("📧 No pendingEmail in response, checking Chrome storage");
                                    chrome.storage.local.get(['pendingEmail'], function(result) {
                                        if (result.pendingEmail) {
                                            console.log("📧 Found pendingEmail in Chrome storage");
                                            pendingEmail = result.pendingEmail;
                                        } else {
                                            console.warn("⚠️ No pendingEmail found despite needsConfirmation=true");
                                        }
                                    });
                                }
                            } else if (response.clearedPending) {
                                console.log("📧 Clearing pendingEmail");
                                pendingEmail = null;
                                chrome.storage.local.remove(['pendingEmail']);
                            }
                            
                            // Check if an event was added and needs to be displayed
                            if (response.eventAdded && response.event) {
                                // Add the event to our display
                                const eventsArray = [response.event];
                                displayCalendarEvents(eventsArray);
                                
                                // Extract events to update our cached events
                                extractCalendarEvents(true);
                            }
                        } else {
                            addMessageToChat("Sorry, I couldn't process your request. Please try again.", 'bot');
                        }
                    }
                );
            }
        );
    }

    // Function to add loading indicator to chat
    function addLoadingIndicator() {
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'message bot loading';
        loadingDiv.id = 'loading-indicator';
        loadingDiv.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
        chatbox.appendChild(loadingDiv);
        
        // Scroll to bottom
        chatbox.scrollTop = chatbox.scrollHeight;
    }
    
    // Function to remove loading indicator
    function removeLoadingIndicator() {
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.remove();
        }
    }

    // Remove the nested event listener entirely
});

// Update the addMessageToChat function to use the DB storage while preserving formatting
function addMessageToChat(text, sender) {
    const chatbox = document.getElementById('chatbox');
  if (!chatbox) return;
  
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    
    // Process text - handle formatting and preserve newlines
    if (sender === 'bot') {
        // Convert markdown-style bold (**text**) to HTML bold tags
        text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        
        // Handle newlines and lists
        const lines = text.split('\n');
        messageDiv.innerHTML = ''; // Use innerHTML instead of textContent
        
        let inList = false;
        
        lines.forEach((line, index) => {
            // Handle lines starting with * as list items
            if (line.trim().startsWith('* ')) {
                // If this is the first list item, start a new list
                if (!inList) {
                    messageDiv.innerHTML += '<ul style="margin: 0; padding-left: 20px;">';
                    inList = true;
                }
                
                // Add the list item (removing the * prefix)
                const itemContent = line.trim().substring(2);
                messageDiv.innerHTML += `<li>${itemContent}</li>`;
            } else {
                // Close the list if we were in one
                if (inList) {
                    messageDiv.innerHTML += '</ul>';
                    inList = false;
                }
                
                // Add the regular line
                messageDiv.innerHTML += line;
                
                // Add line break if not the last line
                if (index < lines.length - 1) {
                    messageDiv.innerHTML += '<br>';
                }
            }
        });
        
        // Close the list if it's still open at the end
        if (inList) {
            messageDiv.innerHTML += '</ul>';
        }
    } else {
        // For user messages, just use textContent
    messageDiv.textContent = text;
    }
    
    chatbox.appendChild(messageDiv);
  
  // Store message in IndexedDB (store the plain text version)
  storeChatMessageInDB(text, sender).catch(err => 
    console.error("Failed to store chat message in DB:", err)
  );
    
    // Scroll to bottom with smooth animation
    chatbox.scrollTo({
        top: chatbox.scrollHeight,
        behavior: 'smooth'
    });
  
  return messageDiv;
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
        // Get the email filter limit
        const emailFilterElement = document.getElementById("email-filter");
        const limitValue = emailFilterElement ? emailFilterElement.value : '20'; // Default to 20 emails if element doesn't exist
        
        // Get the current email settings from storage to use the same filters as the main email fetch
        chrome.storage.local.get(['emailSettings'], function(result) {
          const settings = result.emailSettings || {
            timePeriod: 'week',
            status: 'all',
            inboxOnly: true,
            excludeOther: true,
            excludePromotions: true,
            excludeSocial: true
          };
          
          // Send request with all settings
          chrome.runtime.sendMessage({ 
            action: "getEmails", 
            filter: limitValue,
            timeFilter: settings.timePeriod,
            readFilter: settings.status,
            additionalFilters: {
              inboxOnly: settings.inboxOnly,
              excludeOther: settings.excludeOther,
              excludePromotions: settings.excludePromotions,
              excludeSocial: settings.excludeSocial
            }
          }, async (response) => {

          if (!response || !response.emails) {
            fetchedEmailsContainer.innerHTML = "<p>Could not fetch emails.</p>";
            openEmailsPageBtn.textContent = "View All Fetched Emails";
            openEmailsPageBtn.disabled = false;
            return;
          }

          let emails = response.emails;
            if (!isNaN(limitValue)) {
              emails = emails.slice(0, parseInt(limitValue));
          }
          hideEmailsBtn.style.display = "inline-block";
          openEmailsPageBtn.style.display = "none";

          fetchedEmailsContainer.innerHTML = "";

            // Show which filters were applied
            const filterInfo = document.createElement("div");
            filterInfo.className = "filter-info";
            filterInfo.innerHTML = `
              <div style="background: #f5f5f5; padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; font-size: 0.8rem; color: #666;">
                <strong>Applied filters:</strong> 
                ${settings.timePeriod === 'week' ? 'Past week' : 
                  settings.timePeriod === 'month' ? 'Past month' : 
                  settings.timePeriod === 'year' ? 'Past year' : 'All time'} | 
                ${settings.status === 'all' ? 'All emails' : 
                  settings.status === 'unread' ? 'Unread only' : 'Read only'} |
                ${settings.inboxOnly ? 'Inbox only' : 'All folders'} |
                Limit: ${limitValue} emails
              </div>
            `;
            if (emails.length > 0) {
              fetchedEmailsContainer.appendChild(filterInfo);
            }

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
              
                const prompt = `Summarize this email to the receiver in 2 -3 sentences highlight the most important points:\n\nSubject: ${subject}\nFrom: ${from}\nBody: ${emailContent}`;
      
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

            // Show message if no emails found
            if (emails.length === 0) {
              fetchedEmailsContainer.innerHTML = `
                <p class="events-placeholder">No emails found with the current filters.</p>
                <p style="text-align: center; margin-top: 10px; font-size: 0.9rem;">
                  <a href="#" id="open-settings-link" style="color: #7d93ef; text-decoration: none;">
                    Adjust filter settings
                  </a>
                </p>
              `;
              
              // Add event listener to open settings
              document.getElementById('open-settings-link').addEventListener('click', (e) => {
                e.preventDefault();
                const settingsModal = document.getElementById('settings-modal');
                if (settingsModal) {
                  settingsModal.style.display = 'flex';
                }
            });
          }

          openEmailsPageBtn.textContent = "View All Fetched Emails";
          openEmailsPageBtn.disabled = false;
          });
        });
      });
    });
  }
 



  hideEmailsBtn.addEventListener("click", () => {
    fetchedEmailsContainer.innerHTML = "";
    hideEmailsBtn.style.display = "none";
    openEmailsPageBtn.style.display = "inline-block";
  });
  
  // Function to display a summary bubble for a specific email
  function showSummaryBubble(emailId, summary, markerElement) {
    // Remove any existing bubbles
    document.querySelectorAll('.summary-bubble').forEach(bubble => {
      bubble.remove();
    });
    
    // Create new bubble
    const bubble = document.createElement('div');
    bubble.className = 'summary-bubble';
    bubble.innerHTML = `
      <div class="summary-bubble-content">
        <div class="summary-bubble-header">
          <span>Email Summary</span>
          <button class="summary-bubble-close">×</button>
        </div>
        <div class="summary-bubble-body">
          ${summary || "No summary available."}
        </div>
      </div>
    `;
    
    // Position bubble near the marker
    const markerRect = markerElement.getBoundingClientRect();
    bubble.style.position = 'absolute';
    bubble.style.left = `${markerRect.right + 10}px`;
    bubble.style.top = `${markerRect.top - 10}px`;
    
    // Add to DOM
    document.body.appendChild(bubble);
    
    // Handle close button
    bubble.querySelector('.summary-bubble-close').addEventListener('click', () => {
      bubble.remove();
    });
  }
  
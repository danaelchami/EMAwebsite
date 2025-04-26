// handlers.js
import { authenticateUser, forceReauthenticate } from './auth.js';
import { fetchEmails, fetchEmailContent } from './gmailApi.js';
import { summarizeEmails, extractCalendarEvents, processEmailQuery, summarizeWithGemini } from './geminiApi.js';
import { fetchCalendarEvents, addEventToCalendar, syncCalendarEvents, verifyEventInCalendar, removeEventFromCalendar } from './calendar.js';
import { initSummaryDB, storeEmails, getSummaryFromDB, storeSummaryInDB, getEventsFromDB, storeEventsInCache, cleanupOldCacheEntries, getCachedItem, storeCachedItem, storeContactsInDB, getContactsFromDB, saveEmailSummary } from './storage.js';
import { standardizeDate, convertTimeToISO, getEndTime, generateEmailContentHash, createBasicEventsFromEmails } from './utils.js';
import { processAgentRequest, fetchAndStoreEmails, sendEmail as agentSendEmail } from './agent.js';
import { fetchAndStoreContacts, fetchContacts } from './contactsApi.js';

// Object to track active requests
const activeRequests = {};


export function registerHandlers() {
    console.log("📅 Handlers: Registering message handlers");
    
    // Initialize the summary database
    initSummaryDB().then(() => {
        console.log("✅ Summary database initialized");
    }).catch(err => {
        console.error("❌ Error initializing summary database:", err);
    });
    
    // Trigger authentication and processing on extension installation or startup
    chrome.runtime.onInstalled.addListener(() => {
        authenticateUser(processEmailsAndSummarize);
    });
    
    chrome.runtime.onStartup.addListener(() => {
        authenticateUser(processEmailsAndSummarize);
    });
    

    // Main message listener
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        console.log("📅 Handlers: Received message: ", request.action);
        
        // Cancel request handler
        if (request.action === "cancelRequest") {
            const requestId = request.requestId;
            if (requestId && activeRequests[requestId]) {
                console.log(`Cancelling request with ID: ${requestId}`);
                // Mark the request as cancelled
                activeRequests[requestId].cancelled = true;
                // Clean up the entry
                delete activeRequests[requestId];
                sendResponse({success: true});
            } else {
                console.log(`Request ID not found or already cancelled: ${requestId}`);
                sendResponse({success: false, error: "Request not found"});
            }
            return true;
        }
        
        // Handle request to generate summary for a specific email
        if (request.action === "generateSummaryForEmail") {
            const emailId = request.emailId;
            if (!emailId) {
                sendResponse({success: false, error: "No email ID provided"});
                return true;
            }
            
            console.log(`🔍 Generating summary for email: ${emailId}`);
            
            // Register this as an active request
            const requestId = `summary_${Date.now()}`;
            activeRequests[requestId] = { 
                action: "generateSummaryForEmail",
                timestamp: Date.now(),
                cancelled: false
            };
            
            // Authenticate and process
            authenticateUser(async function(token) {
                try {
                    // Check if request was cancelled
                    if (activeRequests[requestId]?.cancelled) {
                        console.log(`Request ${requestId} was cancelled, aborting`);
                        delete activeRequests[requestId];
                        return;
                    }
                    
                    // Fetch the specific email content
                    const email = await fetchEmailContent(token, emailId);
                    
                    if (!email) {
                        console.error(`❌ Email with ID ${emailId} not found`);
                        delete activeRequests[requestId];
                        sendResponse({success: false, error: "Email not found"});
                        return;
                    }
                    
                    // Check if request was cancelled
                    if (activeRequests[requestId]?.cancelled) {
                        console.log(`Request ${requestId} was cancelled, aborting`);
                        delete activeRequests[requestId];
                        return;
                    }
                    
                    // Extract subject and content from the email
                    const subject = email.payload?.headers?.find(h => h.name === "Subject")?.value || "No Subject";
                    const from = email.payload?.headers?.find(h => h.name === "From")?.value || "Unknown";
                    
                    // Extract email content
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
                    }
                    
                    // Check if request was cancelled
                    if (activeRequests[requestId]?.cancelled) {
                        console.log(`Request ${requestId} was cancelled, aborting`);
                        delete activeRequests[requestId];
                        return;
                    }
                    
                    // Create prompt for summarization
                    const prompt = `Summarize this email:\n\nSubject: ${subject}\nFrom: ${from}\nBody: ${emailContent}`;
                    
                    // Get summary from Gemini API
                    const summary = await summarizeWithGemini(prompt);
                    
                    if (!summary) {
                        console.error(`❌ Failed to generate summary for email ${emailId}`);
                        delete activeRequests[requestId];
                        sendResponse({success: false, error: "Failed to generate summary"});
                        return;
                    }
                    
                    // Store the summary
                    await saveEmailSummary(emailId, summary);
                    
                    // Clean up and send response
                    delete activeRequests[requestId];
                    sendResponse({success: true, summary: summary});
                    
                } catch (error) {
                    console.error(`❌ Error generating summary for email ${emailId}:`, error);
                    delete activeRequests[requestId];
                    sendResponse({success: false, error: "Error generating summary: " + error.message});
                }
            });
            
            return true; // Required for async response
        }
        
        // Handle request to clear request type cache
        if (request.action === "clearRequestTypeCache") {
            console.log("🧹 Clearing request type cache for message:", request.message);
            const message = request.message || "";
            
            // Handle clearing asynchronously
            (async () => {
                if (message) {
                    // Import the functions we need
                    
                    try {
                        // Generate the cache key
                        const cacheKey = `request_type_${generateEmailContentHash([{snippet: message}])}`;
                        // Delete the cached item
                        await storeCachedItem(cacheKey, "");
                        console.log("🧹 Cleared cache for key:", cacheKey);
                    } catch (error) {
                        console.error("❌ Error clearing request type cache:", error);
                    }
                }
                sendResponse({ success: true });
            })();
            return true;
        }
        
        // Pass through status updates to the popup
        if (request.action === "updateSummaryStatus") {
            // Forward the message to all open extension pages
            chrome.runtime.sendMessage(request);
            return true;
        }
        
        if (request.action === "getEmails") {
            const timeFilter = request.timeFilter || 'week';
            const readFilter = request.readFilter || 'all';
            const additionalFilters = request.additionalFilters || {
                inboxOnly: true,
                excludeOther: true,
                excludePromotions: true,
                excludeSocial: true
            };
            
            // Register the request if it has an ID
            if (request.requestId) {
                activeRequests[request.requestId] = { 
                    action: "getEmails",
                    timestamp: Date.now(),
                    cancelled: false
                };
            }
            
            // Authenticate and fetch emails with the filters
            authenticateUser(async function(token) {
                try {
                    // Check if request was cancelled
                    if (request.requestId && activeRequests[request.requestId]?.cancelled) {
                        console.log(`Request ${request.requestId} was cancelled, aborting`);
                        delete activeRequests[request.requestId];
                        return;
                    }
                    
                    const messages = await fetchEmails(token);
                    
                    // Check if request was cancelled
                    if (request.requestId && activeRequests[request.requestId]?.cancelled) {
                        console.log(`Request ${request.requestId} was cancelled, aborting`);
                        delete activeRequests[request.requestId];
                        return;
                    }
                    
                    // Fetch full content for each message ID
                    let emailPromises = messages.map(msg => fetchEmailContent(token, msg.id));
                    const fullEmails = await Promise.all(emailPromises);
                    
                    // Check if request was cancelled
                    if (request.requestId && activeRequests[request.requestId]?.cancelled) {
                        console.log(`Request ${request.requestId} was cancelled, aborting`);
                        delete activeRequests[request.requestId];
                        return;
                    }
                    
                    // Filter out any failed fetches
                    const validEmails = fullEmails.filter(email => email !== null);
                    
                    // Store emails in IndexedDB
                    await storeEmails(validEmails);
                    
                    // Store the full emails in Chrome Storage
                    chrome.storage.local.set({ emails: validEmails }, () => {
                        console.log("Emails stored in Chrome Storage.");
                    });
                    
                    // Extract calendar events
                    const events = await extractCalendarEvents(validEmails);
                    
                    // Check if request was cancelled before sending response
                    if (request.requestId && activeRequests[request.requestId]?.cancelled) {
                        console.log(`Request ${request.requestId} was cancelled, aborting`);
                        delete activeRequests[request.requestId];
                        return;
                    }
                    
                    // Clean up the tracking entry
                    if (request.requestId) {
                        delete activeRequests[request.requestId];
                    }
                    
                    // Send the emails and events back to the popup
                    sendResponse({
                        emails: validEmails || [],
                        events: events || []
                    });
                } catch (error) {
                    console.error("❌ Error processing emails:", error);
                    
                    // Clean up the tracking entry
                    if (request.requestId) {
                        delete activeRequests[request.requestId];
                    }
                    
                    sendResponse({
                        error: "Failed to fetch emails. Please try again.",
                        emails: [],
                        events: []
                    });
                }
            });
            
            return true; // Required for async response
        }
        
        if (request.action === "summarizeEmails") {
            // Get emails from the request
            const emails = request.emails || [];
            
            // Get filter values if provided
            const timeFilter = request.timeFilter || null;
            const readFilter = request.readFilter || null;
            
            // Check if we should force regeneration
            const forceRegenerate = request.forceRegenerate || false;
            
            // Register the request if it has an ID
            if (request.requestId) {
                activeRequests[request.requestId] = { 
                    action: "summarizeEmails",
                    timestamp: Date.now(),
                    cancelled: false
                };
            }
            
            // Generate summary using Gemini API (with caching logic)
            summarizeEmails(emails, { 
                timeFilter: timeFilter,
                readFilter: readFilter,
                forceRegenerate: forceRegenerate 
            }).then(summary => {
                // Check if request was cancelled before sending response
                if (request.requestId && activeRequests[request.requestId]?.cancelled) {
                    console.log(`Request ${request.requestId} was cancelled, aborting`);
                    delete activeRequests[request.requestId];
                    return;
                }
                
                // Clean up the tracking entry
                if (request.requestId) {
                    delete activeRequests[request.requestId];
                }
                
                sendResponse({summary: summary});
            });
            
            return true; // Required for async response
        }
        
        if (request.action === "extractEvents") {
            // Get emails from the request or from storage
            const forceRefresh = request.forceRefresh || false;
            console.log("📅 Handler received extractEvents request, forceRefresh:", forceRefresh);
            
            // Register the request if it has an ID
            if (request.requestId) {
                activeRequests[request.requestId] = { 
                    action: "extractEvents",
                    timestamp: Date.now(),
                    cancelled: false
                };
            }
            
            if (request.emails && request.emails.length > 0) {
                console.log(`📅 Using ${request.emails.length} emails provided in request`);
                extractCalendarEvents(request.emails, { forceRefresh }).then(events => {
                    // Check if request was cancelled before sending response
                    if (request.requestId && activeRequests[request.requestId]?.cancelled) {
                        console.log(`Request ${request.requestId} was cancelled, aborting`);
                        delete activeRequests[request.requestId];
                        return;
                    }
                    
                    console.log(`📅 Extracted ${events.length} events, sending response`);
                    
                    // Clean up the tracking entry
                    if (request.requestId) {
                        delete activeRequests[request.requestId];
                    }
                    
                    sendResponse({events: events});
                }).catch(error => {
                    console.error("Error extracting events:", error);
                    
                    // Clean up the tracking entry
                    if (request.requestId) {
                        delete activeRequests[request.requestId];
                    }
                    
                    sendResponse({events: [], error: "Failed to extract events"});
                });
            } else {
                console.log("📅 No emails in request, getting from storage");
                chrome.storage.local.get(['emails'], function(result) {
                    const emails = result.emails || [];
                    console.log(`📅 Retrieved ${emails.length} emails from storage`);
                    
                    if (emails.length === 0) {
                        console.log("📅 No emails found in storage, returning empty array");
                        
                        // Clean up the tracking entry
                        if (request.requestId) {
                            delete activeRequests[request.requestId];
                        }
                        
                        sendResponse({events: []});
                        return;
                    }
                    
                    extractCalendarEvents(emails, { forceRefresh }).then(events => {
                        // Check if request was cancelled before sending response
                        if (request.requestId && activeRequests[request.requestId]?.cancelled) {
                            console.log(`Request ${request.requestId} was cancelled, aborting`);
                            delete activeRequests[request.requestId];
                            return;
                        }
                        
                        console.log(`📅 Extracted ${events.length} events from storage emails, sending response`);
                        
                        // Clean up the tracking entry
                        if (request.requestId) {
                            delete activeRequests[request.requestId];
                        }
                        
                        sendResponse({events: events});
                    }).catch(error => {
                        console.error("Error extracting events:", error);
                        
                        // Clean up the tracking entry
                        if (request.requestId) {
                            delete activeRequests[request.requestId];
                        }
                        
                        sendResponse({events: [], error: "Failed to extract events"});
                    });
                });
            }
            return true; // Required for async response
        }
        
        if (request.action === "syncCalendarEvents") {
            // Register the request if it has an ID
            if (request.requestId) {
                activeRequests[request.requestId] = { 
                    action: "syncCalendarEvents",
                    timestamp: Date.now(),
                    cancelled: false
                };
            }
            
            // Authenticate and sync calendar events
            authenticateUser(async function(token) {
                try {
                    // Check if request was cancelled
                    if (request.requestId && activeRequests[request.requestId]?.cancelled) {
                        console.log(`Request ${request.requestId} was cancelled, aborting`);
                        delete activeRequests[request.requestId];
                        return;
                    }
                    
                    // Perform calendar sync
                    const result = await syncCalendarEvents(token);
                    
                    // Check if request was cancelled
                    if (request.requestId && activeRequests[request.requestId]?.cancelled) {
                        console.log(`Request ${request.requestId} was cancelled, aborting`);
                        delete activeRequests[request.requestId];
                        return;
                    }
                    
                    // Reload events after sync
                    chrome.storage.local.get(['emails'], async function(result) {
                        const emails = result.emails || [];
                        const updatedEvents = await getEventsFromDB();
                        
                        // Check if request was cancelled before sending response
                        if (request.requestId && activeRequests[request.requestId]?.cancelled) {
                            console.log(`Request ${request.requestId} was cancelled, aborting`);
                            delete activeRequests[request.requestId];
                            return;
                        }
                        
                        // Clean up the tracking entry
                        if (request.requestId) {
                            delete activeRequests[request.requestId];
                        }
                        
                        sendResponse({
                            success: true,
                            syncedCount: result.synced,
                            events: updatedEvents
                        });
                    });
                } catch (error) {
                    console.error("❌ Error syncing calendar events: ", error);
                    
                    // Clean up the tracking entry
                    if (request.requestId) {
                        delete activeRequests[request.requestId];
                    }
                    
                    sendResponse({
                        success: false,
                        error: "Failed to sync with Google Calendar."
                    });
                }
            });
            
            return true; // Required for async response
        }
        
        if (request.action === "addToCalendar") {
            // Get the event data from the request
            const eventData = request.event;
            
            if (!eventData) {
                sendResponse({success: false, error: "No event data provided"});
                return true;
            }
            
            // Authenticate and add event to calendar
            authenticateUser(async function(token) {
                try {
                    const result = await addEventToCalendar(token, eventData);
                    // Add safety check for result and result.id
                    if (!result) {
                        console.error("❌ No result returned from addEventToCalendar");
                        sendResponse({
                            success: false,
                            error: "Calendar API returned an invalid response"
                        });
                        return;
                    }
                    
                    sendResponse({
                        success: true,
                        eventId: result.id || "unknown-id", // Provide fallback for missing ID
                        exists: result.exists || false
                    });
                } catch (error) {
                    console.error("❌ Error adding event to calendar:", error);
                    
                    // If it's a permission error, try to get a new token with the right scopes
                    if (error.message && error.message.includes('Calendar permission denied')) {
                        console.log("🔄 Need to re-authenticate with calendar scopes");
                        
                        // Use the force re-authentication function
                        forceReauthenticate(async (newToken) => {
                            if (!newToken) {
                                sendResponse({
                                    success: false,
                                    error: "Could not authenticate with calendar. Please reload the extension and try again."
                                });
                                return;
                            }
                            
                            // Try again with the new token
                            try {
                                const result = await addEventToCalendar(newToken, eventData);
                                // Add same safety check here
                                if (!result) {
                                    console.error("❌ No result returned from addEventToCalendar after reauth");
                                    sendResponse({
                                        success: false,
                                        error: "Calendar API returned an invalid response after re-authentication"
                                    });
                                    return;
                                }
                                
                                sendResponse({
                                    success: true,
                                    eventId: result.id || "unknown-id", // Provide fallback for missing ID
                                    exists: result.exists || false
                                });
                            } catch (retryError) {
                                sendResponse({
                                    success: false,
                                    error: "Calendar access failed even after re-authentication. Please try again later."
                                });
                            }
                        });
                    } else {
                        sendResponse({
                            success: false,
                            error: error.message || "Unknown error adding event to calendar"
                        });
                    }
                }
            });
            
            return true; // Required for async response
        }
        
        if (request.action === "removeFromCalendar") {
            // Get the event data from the request
            const eventData = request.event;
            
            if (!eventData) {
                sendResponse({success: false, error: "No event data provided"});
                return true;
            }
            
            // Authenticate and remove event from calendar
            authenticateUser(async function(token) {
                try {
                    const result = await removeEventFromCalendar(token, eventData);
                    sendResponse({
                        success: true
                    });
                } catch (error) {
                    console.error("❌ Error removing event from calendar:", error);
                    
                    // If it's a permission error, try to get a new token with the right scopes
                    if (error.message && error.message.includes('Calendar permission denied')) {
                        console.log("🔄 Need to re-authenticate with calendar scopes");
                        
                        // Use the force re-authentication function
                        forceReauthenticate(async (newToken) => {
                            if (!newToken) {
                                sendResponse({
                                    success: false,
                                    error: "Could not authenticate with calendar. Please reload the extension and try again."
                                });
                                return;
                            }
                            
                            // Try again with the new token
                            try {
                                const result = await removeEventFromCalendar(newToken, eventData);
                                sendResponse({
                                    success: true
                                });
                            } catch (retryError) {
                                sendResponse({
                                    success: false,
                                    error: "Calendar access failed even after re-authentication. Please try again later."
                                });
                            }
                        });
                    } else {
                        sendResponse({
                            success: false,
                            error: error.message || "Unknown error removing event from calendar"
                        });
                    }
                }
            });
            
            return true; // Required for async response
        }
        
        if (request.action === "fetchContacts") {
            if (activeRequests["fetchContacts"]) {
                sendResponse({ status: "busy", message: "Already fetching contacts" });
                return true;
            }
            
            activeRequests["fetchContacts"] = true;
            
            authenticateUser(async function(token) {
                try {
                    const result = await fetchAndStoreContacts(token);
                    sendResponse({ 
                        status: "success", 
                        contacts: result.contacts, 
                        count: result.count 
                    });
                } catch (error) {
                    console.error("❌ Error fetching contacts:", error);
                    sendResponse({ 
                        status: "error", 
                        message: error.toString() 
                    });
                } finally {
                    delete activeRequests["fetchContacts"];
                }
            });
            
            return true;
        }
        
        if (request.action === "processMessage") {
            // Get the user's message from the request
            const message = request.message;
            
            if (!message) {
                sendResponse({reply: "I didn't receive any message to process."});
                return true;
            }
            
            // Set context from request if provided, otherwise use empty object
            const context = request.context || {};
            
            // Process the message with the agent
            (async () => {
                try {
                    console.log("📝 Processing message:", message);
                    console.log("📝 With context:", JSON.stringify(context));
                    
                    // Get agent response
                    console.log("📝 Calling processAgentRequest with message:", message);
                    const agentResponse = await processAgentRequest(message, context);
                    console.log("📝 Agent response:", JSON.stringify(agentResponse));
                    
                    // If agent says we need to fetch emails first
                    if (agentResponse.needsFetch) {
                        authenticateUser(async (token) => {
                            try {
                                // Fetch emails
                                const fetchResult = await fetchAndStoreEmails(token);
                                
                                // Now that we have emails, process the request again
                                const newContext = {
                                    ...context,
                                    emails: fetchResult.emails,
                                    knownContacts: fetchResult.contacts
                                };
                                
                                const finalResponse = await processAgentRequest(request.message, newContext);
                                sendResponse({ 
                                    reply: finalResponse.reply,
                                    needsConfirmation: finalResponse.needsConfirmation || false,
                                    clearedPending: finalResponse.clearedPending || false,
                                    pendingEmail: finalResponse.pendingEmail || null
                                });
                            } catch (error) {
                                console.error("Error fetching emails:", error);
                                sendResponse({ reply: "I had trouble accessing your emails. Please try again later." });
                            }
                        });
                        return;
                    }
                    
                    // If a calendar event was added, propagate the event details back to the UI
                    if (agentResponse.eventAdded && agentResponse.event) {
                        console.log("📅 Calendar event detected and added:", agentResponse.event);
                        sendResponse({ 
                            reply: agentResponse.reply,
                            eventAdded: true,
                            event: agentResponse.event
                        });
                        return;
                    }
                    
                    // Handle normal responses
                    sendResponse({ 
                        reply: agentResponse.reply,
                        needsConfirmation: agentResponse.needsConfirmation || false,
                        clearedPending: agentResponse.clearedPending || false,
                        pendingEmail: agentResponse.pendingEmail || null
                    });
                } catch (error) {
                    console.error("Error processing message:", error);
                    sendResponse({ reply: "I encountered an error processing your message. Please try again." });
                }
            })();
            
            return true;
        }
        
        // Handle request to fetch email for summary
        if (request.action === 'fetchEmailForSummary') {
            const emailSubject = request.emailSubject;
            const emailDate = request.emailDate;
            
            if (!emailSubject) {
                sendResponse({success: false, error: "No email subject provided"});
                return true;
            }
            
            console.log(`🔍 Fetching email for summary: "${emailSubject}"`);
            
            // Authenticate and fetch email
            authenticateUser(async function(token) {
                try {
                    // Try to find the email using Gmail API
                    // First query for emails matching this subject
                    const query = `subject:${emailSubject.replace(/[^\w\s]/g, ' ')}`;
                    const url = `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}`;
                    
                    const response = await fetch(url, {
                        method: "GET",
                        headers: {
                            Authorization: `Bearer ${token}`,
                            "Content-Type": "application/json"
                        }
                    });
                    
                    const data = await response.json();
                    
                    if (data.error) {
                        console.error("❌ Gmail API Error:", data.error.message);
                        sendResponse({success: false, error: data.error.message});
                        return;
                    }
                    
                    if (!data.messages || data.messages.length === 0) {
                        console.warn(`⚠️ No emails found for subject: "${emailSubject}"`);
                        sendResponse({success: false, error: "Email not found"});
                        return;
                    }
                    
                    // Get the first matching email
                    const emailId = data.messages[0].id;
                    
                    // Fetch the full email content
                    const email = await fetchEmailContent(token, emailId);
                    
                    if (!email) {
                        console.error(`❌ Failed to fetch email content for: ${emailId}`);
                        sendResponse({success: false, error: "Failed to fetch email content"});
                        return;
                    }
                    
                    // Extract email parts
                    const subject = email.payload?.headers?.find(h => h.name === "Subject")?.value || emailSubject;
                    const from = email.payload?.headers?.find(h => h.name === "From")?.value || "Unknown";
                    
                    // Extract email content
                    let content = "";
                    
                    // Check if the email has a payload with parts (MIME structure)
                    if (email.payload && (email.payload.body || email.payload.parts)) {
                        // Try to get content from main body
                        if (email.payload.body && email.payload.body.data) {
                            content = atob(email.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
                        } 
                        // Or check in parts
                        else if (email.payload.parts) {
                            // Find text parts
                            for (const part of email.payload.parts) {
                                if (part.mimeType === 'text/plain' && part.body && part.body.data) {
                                    const partContent = atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
                                    content += partContent + "\n";
                                }
                            }
                        }
                    }
                    
                    // Fall back to snippet if parsing failed
                    if (!content || content.length < 10) {
                        content = email.body || email.snippet || "No body";
                    }
                    
                    // Prepare the email data
                    const emailData = {
                        id: emailId,
                        subject: subject,
                        from: from,
                        content: content,
                        date: emailDate
                    };
                    
                    // Send the response
                    sendResponse({success: true, email: emailData});
                    
                } catch (error) {
                    console.error(`❌ Error fetching email for summary:`, error);
                    sendResponse({success: false, error: error.message});
                }
            });
            
            return true; // Required for async response
        }
        
        // Handle request to summarize with Gemini
        if (request.action === 'summarizeWithGemini') {
            const prompt = request.prompt;
            
            if (!prompt) {
                sendResponse({success: false, error: "No prompt provided"});
                return true;
            }
            
            console.log(`🔍 Summarizing with Gemini API`);
            
            // Process asynchronously
            (async () => {
                try {
                    // Use the Gemini API to summarize
                    const summary = await summarizeWithGemini(prompt);
                    
                    if (!summary) {
                        console.error('❌ Failed to generate summary with Gemini');
                        sendResponse({success: false, error: "Failed to generate summary"});
                        return;
                    }
                    
                    // Send the response
                    sendResponse({success: true, summary: summary});
                    
                } catch (error) {
                    console.error(`❌ Error summarizing with Gemini:`, error);
                    sendResponse({success: false, error: error.message});
                }
            })();
            
            return true; // Required for async response
        }
    });
     
    console.log("📅 Handlers: Message handlers registered successfully");
}

// Main function to fetch emails, process their content, and summarize them
async function processEmailsAndSummarize(token) {
    try {
     
      // Use default values from Chrome storage
      const messages = await fetchEmails(token);
      
      // Fetch full content for each message ID
      let emailPromises = messages.map(msg => fetchEmailContent(token, msg.id));
     
      const fullEmails = await Promise.all(emailPromises);
      const validEmails = fullEmails.filter(email => email !== null);
  
      // Filter out any failed fetches
      const contactsMap = new Map();
  
      validEmails.forEach(email => {
        const fromHeader = email.from || "";
        const toHeader = email.to || "";
      
        [fromHeader, toHeader].forEach(raw => {
          if (!raw) return;
          raw.split(',').forEach(entry => {
            const match = entry.match(/(.*)<(.*)>/);  // "Name <email>"
            if (match) {
              const name = match[1].trim();
              const emailAddr = match[2].trim();
              contactsMap.set(name, emailAddr);
            } else if (entry.includes('@')) {
              const emailOnly = entry.trim();
              contactsMap.set(emailOnly.split('@')[0], emailOnly);
            }
          });
        });
      });
      
      const knownContacts = Array.from(contactsMap.entries()); // <-- array of [name, email]
      // Store contacts in IndexedDB using the new function
      await storeContactsInDB(knownContacts);

      console.log("👥 Contacts found in inbox:", knownContacts);
  
      // Store emails in IndexedDB
      await storeEmails(validEmails);
      
      // Generate summary
      const summary = await summarizeEmails(validEmails);
      
      if (summary) {
        // Store the summary in Chrome Storage for use in your extension's UI
        chrome.storage.local.set({ summary: summary }, () => {
          console.log("Summary stored in Chrome Storage.");
        });
      }
      
      // Extract calendar events
      const events = await extractCalendarEvents(validEmails);
      
      return {
        summary: summary,
        events: events
      };
    } catch (error) {
      console.error("❌ Error in processEmailsAndSummarize:", error);
      return {
        summary: "Unable to generate summary.",
        events: []
      };
    }
}
  



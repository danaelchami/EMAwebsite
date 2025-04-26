// geminiApi.js
import { getSummaryFromDB, storeSummaryInDB, getEventsFromDB, storeEventsInCache } from './storage.js';
import { createBasicEventsFromEmails } from './utils.js';
import { fetchEmailContent } from './gmailApi.js';
import { authenticateUser } from './auth.js';

const GEMINI_API_KEY = 'AIzaSyBhlM0p5vFbeG0uR9oqb66ya2Gd8NuY6Ks';

export async function summarizeEmails(emails, options = {}) {
    if (!emails || emails.length === 0) {
      console.warn("⚠️ No emails provided for summarization.");
      return "No emails to summarize.";
    }
    
    try {
      // Check if force regeneration is requested or filter has changed
      const forceRegenerate = options.forceRegenerate || false;
      const currentFilter = options.filter || null;
      
      // Get previous filter from storage (if any)
      let previousFilter = null;
      try {
        previousFilter = await new Promise(resolve => {
          chrome.storage.local.get(['lastEmailFilter'], result => {
            resolve(result.lastEmailFilter || null);
          });
        });
      } catch (err) {
        console.warn("Unable to get previous filter setting", err);
      }
      
      // Store current filter for future comparison
      if (currentFilter) {
        chrome.storage.local.set({ lastEmailFilter: currentFilter });
      }
      
      // Check if filter has changed
      const filterChanged = previousFilter !== null && previousFilter !== currentFilter;
      
      // Only check cache if we're not forcing regeneration and filter hasn't changed
      if (!forceRegenerate && !filterChanged) {
        // Check if we have a cached summary - with a timeout
        const cachedSummaryPromise = getSummaryFromDB(emails);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Cache timeout')), 2000)
        );
        
        try {
          const cachedSummary = await Promise.race([cachedSummaryPromise, timeoutPromise]);
          if (cachedSummary) {
            console.log("🎯 Using cached summary (no filter change detected)");
            return cachedSummary;
          }
        } catch (cacheError) {
          console.log("Cache retrieval timed out or failed, proceeding with detailed summary");
        }
      } else if (filterChanged) {
        console.log("🔄 Filter changed from", previousFilter, "to", currentFilter, "- generating new summary");
      } else if (forceRegenerate) {
        console.log("🔄 Force regenerate requested - generating new summary");
      }
      
      // Instead of returning a basic summary, wait for the detailed summary
      // But first, prepare a loading message to show in the UI
      chrome.runtime.sendMessage({
        action: "updateSummaryStatus",
        status: "Generating summary with AI..."
      });
      
      // Generate the detailed summary and wait for it
      try {
        const detailedSummary = await generateDetailedSummary(emails);
        
        if (detailedSummary) {
          // Store the detailed summary in cache for future use
          storeSummaryInDB(emails, detailedSummary).catch(err => 
            console.error("Failed to store summary in DB:", err)
          );
          
          // Return the detailed summary
          return detailedSummary;
        } else {
          // If detailed summary fails, fall back to basic summary
          console.log("Falling back to basic summary due to detailed summary failure");
          return generateBasicSummary(emails);
        }
      } catch (error) {
        console.error("Error generating detailed summary:", error);
        return generateBasicSummary(emails);
      }
    } catch (err) {
      console.error("❌ Error in summarizeEmails:", err);
      return generateBasicSummary(emails);
    }
}

// Helper function to generate a basic summary without API call
function generateBasicSummary(emails) {
    if (!emails || emails.length === 0) return "No emails to summarize.";
    
    const emailCount = emails.length;
    const recentSubjects = emails
      .slice(0, 3)
      .map(email => email.subject || "Untitled")
      .join(", ");
    
    return `${emailCount} recent email${emailCount > 1 ? 's' : ''} including: ${recentSubjects}`;
}

// Helper function to generate a detailed summary using Gemini API
async function generateDetailedSummary(emails) {
    try {
      const emailContent = emails.map(email => email.data?.payload?.body?.data || email.snippet || "").join("\n\n");
      
      const prompt = `Create an extremely concise summary of these emails in 2-3 short sentences only.
      Focus ONLY on the most critical information.
      Maintain a conversational tone but prioritize brevity above all else.
      The summary should fit in a small UI area without requiring scrolling.
      
      Emails to summarize:
      ${emailContent}`;
      
      // Log the full prompt being sent to the API
      console.log("📝 SUMMARY PROMPT SENT TO GEMINI API:", prompt);
      
      const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`;
      
      const requestBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 100,
          topP: 0.8,
          topK: 40
        }
      };
      
      const options = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      };
      
      const response = await fetch(url, options);
      const data = await response.json();
      
      if (!response.ok || data.error) {
        throw new Error(data?.error?.message || "API error");
      }
      
      // Log the response from the API
      console.log("📝 SUMMARY RESPONSE FROM GEMINI API:", data.candidates?.[0]?.content?.parts?.[0]?.text);
      
      return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
      
    } catch (err) {
      console.error("Failed to generate detailed summary:", err);
      return null;
    }
}
  
// Extract calendar events from emails using Gemini API
export async function extractCalendarEvents(emails, options = {}) {
    // Replace with your actual Gemini API key
    const GEMINI_API_KEY = "AIzaSyBhlM0p5vFbeG0uR9oqb66ya2Gd8NuY6Ks";
  
    if (!emails || emails.length === 0) {
      console.warn("No emails provided for event extraction.");
      return [];
    }
    
    try {
      const forceRefresh = options.forceRefresh || false;
      console.log("Extracting calendar events, forceRefresh =", forceRefresh);
      
      // Get cached events
      let cachedEvents = [];
      try {
        cachedEvents = await getEventsFromDB() || [];
        console.log(`🎯 Retrieved ${cachedEvents.length} events from DB`);
      } catch (cacheError) {
        console.error("❌ Error retrieving events from DB:", cacheError);
        cachedEvents = [];
      }
      
      // Create a map of already processed email IDs from the cache
      const processedEmailIds = new Set();
      cachedEvents.forEach(event => {
        if (event.sourceEmailId) {
          processedEmailIds.add(event.sourceEmailId);
        }
      });
      
      console.log(`🔍 Found ${processedEmailIds.size} already processed email IDs in cache`);
      
      // Filter out emails that have already been processed (skip if forcing refresh)
      const emailsToProcess = forceRefresh 
        ? emails // Process all emails if force refresh
        : emails.filter(email => !processedEmailIds.has(email.id));
      
      console.log(`📧 Processing ${emailsToProcess.length} out of ${emails.length} emails (${emails.length - emailsToProcess.length} already in cache)`);
      
      // If all emails have been processed before and we're not forcing a refresh,
      // just return the cached events
      if (emailsToProcess.length === 0 && !forceRefresh) {
        console.log("🎯 All emails already processed, using cached events");
        return cachedEvents;
      }
      
      
      // Process each new email individually
      let newEvents = [];
      
      // Get token for email content fetching
      let token = null;
      try {
        token = await new Promise((resolve) => {
          authenticateUser((userToken) => {
            resolve(userToken);
          });
        });
        
        if (!token) {
          console.error("❌ Could not get authentication token");
          return cachedEvents;
        }
      } catch (authError) {
        console.error("❌ Authentication error:", authError);
        return cachedEvents;
      }
      
      for (let i = 0; i < emailsToProcess.length; i++) {
        const email = emailsToProcess[i];
        console.log(`Processing email ${i+1}/${emailsToProcess.length} with ID ${email.id}`);
        
        // Fetch full email content if token is available
        let emailWithBody = email;
        
        if (token && !email.body) {
          try {
            console.log(`Fetching full content for email ${email.id}`);
            emailWithBody = await fetchEmailContent(token, email.id);
            
            if (!emailWithBody) {
              console.log(`Failed to fetch content for email ${email.id}, using original email object`);
              emailWithBody = email;
            }
          } catch (fetchError) {
            console.error(`❌ Error fetching email content for ID ${email.id}:`, fetchError);
            emailWithBody = email;
          }
        }
        
        // Extract the email body from the fetched content
        let emailContent = "";
        
        // Check if the email has a payload with parts (MIME structure)
        if (emailWithBody.payload && (emailWithBody.payload.body || emailWithBody.payload.parts)) {
          // Try to get content from main body
          if (emailWithBody.payload.body && emailWithBody.payload.body.data) {
            emailContent = atob(emailWithBody.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
          } 
          // Or check in parts
          else if (emailWithBody.payload.parts) {
            // Find text parts
            for (const part of emailWithBody.payload.parts) {
              if (part.mimeType === 'text/plain' && part.body && part.body.data) {
                const partContent = atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
                emailContent += partContent + "\n";
              }
            }
          }
        }
        
        // Fall back to body property or snippet if parsing failed
        if (!emailContent || emailContent.length < 10) {
          emailContent = emailWithBody.body || emailWithBody.snippet || "";
          console.log(`Using fallback content for email ${i+1} (length: ${emailContent.length})`);
        } else {
          console.log(`Successfully extracted email body for email ${i+1} (length: ${emailContent.length})`);
        }
        
        if (!emailContent || emailContent.length < 10) {
          console.log(`Skipping email ${i} - insufficient content`);
          continue;
        }
        
        // Extract email timestamp to use as reference date for relative dates
        let emailSentDate = null;
        let emailSentDateStr = "unknown";
        
        if (emailWithBody.internalDate) {
          emailSentDate = new Date(parseInt(emailWithBody.internalDate));
          emailSentDateStr = emailSentDate.toISOString().split('T')[0];
        } else if (emailWithBody.payload?.headers) {
          const dateHeader = emailWithBody.payload.headers.find(h => h.name.toLowerCase() === 'date');
          if (dateHeader?.value) {
            emailSentDate = new Date(dateHeader.value);
            emailSentDateStr = emailSentDate.toISOString().split('T')[0];
          }
        }
        
        // If no valid date found, use current date
        if (!emailSentDate || isNaN(emailSentDate.getTime())) {
          emailSentDate = new Date();
          emailSentDateStr = emailSentDate.toISOString().split('T')[0];
        }
        
        // Extract sender and subject information
        const sender = emailWithBody.from || 
                       emailWithBody.payload?.headers?.find(h => h.name.toLowerCase() === 'from')?.value || 
                       "Unknown Sender";
        const subject = emailWithBody.subject || 
                        emailWithBody.payload?.headers?.find(h => h.name.toLowerCase() === 'subject')?.value || 
                        "No Subject";
        
        // Build prompt for this specific email
        const prompt = `Extract all dates, times, and events from this email. 
        For each event, please provide:
        1. Title of the event (add with who if meeting)
        2. Date (in YYYY-MM-DD format) if only the year is not mentioned, set it to ${emailSentDate.getFullYear()}
        3. Time (if available)
        4. Location (if available)
        5. A brief description
        
        Format the output as a JSON array with objects containing these fields:
        [{
          "title": "Event title",
          "date": "YYYY-MM-DD",
          "time": "HH:MM AM/PM",
          "location": "Location",
          "description": "Brief description of the event"
        }]
        
        IMPORTANT: This email was sent on ${emailSentDateStr}. 
        Handle relative dates using this as the reference date:
        - "tomorrow" should be ${new Date(emailSentDate.getTime() + 86400000).toISOString().split('T')[0]}
        - "today" should be ${emailSentDateStr}
        - For days of the week like "next Monday" or "this Tuesday", use the next occurrence relative to ${emailSentDateStr}
        
        Only extract real events with actual dates. Include hypothetical events and requests for events. ignore past events.
        IMPORTANT: Do not include promotions, discount offers, discounts expirations, deals expirations, or marketing campaigns. Do not extract any expiration dates related to deals, discounts, sales, or limited-time offers.
        If there are no events, return an empty array.
        
        Email details:
        From: ${sender}
        Subject: ${subject}
        
        Email content:
        ${emailContent}`;
  
        console.log(`📝 Constructed prompt for email ${i+1}`);
  
        // Gemini API URL
        const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`;
  
        const requestBody = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            topP: 0.8,
            topK: 40
          }
        };
  
        const fetchOptions = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody)
        };
  
        console.log(`🚀 Sending request to Gemini API for email ${i+1}...`);
  
        try {
          const response = await fetch(url, fetchOptions);
          const data = await response.json();
  
          if (!response.ok || data.error) {
            console.error(`❌ Error extracting events from email ${i+1}:`, data?.error?.message || "Unknown error");
            
            // Check if this is a quota/rate limit error
            const errorMessage = data?.error?.message || "";
            if (errorMessage.includes("quota") || errorMessage.includes("rate limit")) {
              // Store the timestamp of when we hit the rate limit
              chrome.storage.local.set({ [rateLimitKey]: Date.now() });
              // Return combined events or fallback
              return [...cachedEvents, ...newEvents].length > 0 
                ? [...cachedEvents, ...newEvents] 
                : createBasicEventsFromEmails(emails);
            }
            
            continue; // Skip this email and move to the next
          }
  
          // Extract events from Gemini response
          const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          console.log(`✅ Raw event extraction received for email ${i+1}`,rawText);
          
          // Parse JSON from response
          try {
            // Find the JSON part in the response
            const jsonMatch = rawText.match(/\[\s*\{.*\}\s*\]/s);
            if (jsonMatch) {
              const jsonText = jsonMatch[0];
              const emailEvents = JSON.parse(jsonText);
              
              // Add unique IDs, timestamps, and source email IDs to events
              const processedEvents = emailEvents.map((event, index) => {
                return {
                  ...event,
                  id: `event_${Date.now()}_${i}_${index}`,
                  timestamp: Date.now(),
                  eventDate: new Date(event.date).getTime() || Date.now(),
                  added: false,
                  sourceEmailId: email.id
                };
              });
              
              newEvents = [...newEvents, ...processedEvents];
              console.log(`Added ${processedEvents.length} events from email ${i+1}`);
            } else {
              console.log(`No events found in email ${i+1}`);
            }
          } catch (error) {
            console.error(`❌ Error parsing events JSON for email ${i+1}:`, error);
          }
        } catch (err) {
          console.error(`❌ Network/Fetch error for email ${i+1}:`, err);
          // Continue to next email
        }
      }
      
      // Combine cached events with new events
      let allEvents = [];
      
      if (forceRefresh) {
        // If forcing refresh, only use new events and keep events from emails we didn't reprocess
        const emailIdsProcessed = new Set(emailsToProcess.map(email => email.id));
        const eventsToKeep = cachedEvents.filter(event => 
          event.sourceEmailId && !emailIdsProcessed.has(event.sourceEmailId)
        );
        
        allEvents = [...eventsToKeep, ...newEvents];
      } else {
        // Otherwise combine all events
        allEvents = [...cachedEvents, ...newEvents];
      }
      
      console.log(`✅ Total events: ${allEvents.length} (${cachedEvents.length} from cache, ${newEvents.length} newly extracted)`);
      
      // Store all events in cache
      if (allEvents.length > 0) {
        try {
          await storeEventsInCache(allEvents);
          console.log("✅ Successfully stored all events in cache");
          
          // Notify UI that new events are available
          chrome.runtime.sendMessage({
            action: "eventsUpdated",
            events: allEvents
          });
        } catch (storageError) {
          console.error("❌ Error storing events in cache:", storageError);
          
          // This should now only happen if both IndexedDB and Chrome Storage failed
          console.error("❌ Both storage methods failed:", storageError);
          
          // Notify UI with the events we have anyway
          chrome.runtime.sendMessage({
            action: "eventsUpdated",
            events: allEvents
          });
        }
      }
      
      return allEvents;
    } catch (err) {
      console.error("❌ Network/Fetch error in event extraction:", err);
      // In case of any error, try to extract events with a simple approach
      return createBasicEventsFromEmails(emails);
    }
}
  
// New function to process email questions dynamically
export async function processEmailQuery(query, emails) {
    if (!emails || emails.length === 0) {
      return "I don't have any emails to analyze. Please refresh your emails first.";
    }
    
    try {
      console.log("Processing email query:", query);
      
      // Format emails for better context
      const formattedEmails = emails.map((email, index) => {
        const from = email.from || "Unknown";
        const subject = email.subject || email.payload?.headers?.find(h => h.name === "Subject")?.value || "No Subject";
        const date = email.internalDate ? new Date(parseInt(email.internalDate)).toLocaleString() : "Unknown date";
        
        return `Email ${index + 1}:
          From: ${from}
          Subject: ${subject}
          Date: ${date}
          Content: ${email.snippet || "No content"}
        `;
      }).join("\n\n");
      
      const prompt = `You are EMA, an email assistant AI. Answer the following question about these emails.
      Be concise, helpful, and conversational.
      
      If asked about specific email content, provide relevant details from the emails.
      If asked for summaries, focus on the most important information.
      If asked about senders, recipients, or dates, extract that information accurately.
      
      User's question: "${query}"
      
      Emails to analyze:
      ${formattedEmails}`;
      
      const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`;
      
      const requestBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 300,
          topP: 0.8,
          topK: 40
        }
      };
      
      const options = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      };
      
      console.log("Sending query to Gemini API...");
      
      const response = await fetch(url, options);
      const data = await response.json();
      
      if (!response.ok || data.error) {
        console.error("Error processing query:", data?.error?.message || "Unknown error");
        return "I'm having trouble analyzing your emails right now. Could you try asking in a different way?";
      }
      
      const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;
      return answer || "I couldn't find a good answer to your question in these emails.";
      
    } catch (error) {
      console.error("Error in processEmailQuery:", error);
      return "Sorry, I encountered an error while processing your question. Please try again.";
    }
}
  
export async function summarizeWithGemini(prompt) {
  const GEMINI_API_KEY = "AIzaSyBhlM0p5vFbeG0uR9oqb66ya2Gd8NuY6Ks"; // Replace with your actual Gemini API key
  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 100,
      topP: 0.8,
      topK: 40,
    }
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.error("Gemini API error:", err);
    return null;
  }
}

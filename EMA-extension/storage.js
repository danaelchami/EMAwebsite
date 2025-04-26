// storage.js
// Import the missing generateEmailContentHash function
import { generateEmailContentHash } from './utils.js';

// Initialize the IndexedDB for caching summaries
export function initSummaryDB() {
    return new Promise((resolve, reject) => {
      const dbRequest = indexedDB.open('EMADatabase', 2); // Increase version to trigger upgrade
      
      dbRequest.onupgradeneeded = function(event) {
        const db = event.target.result;
        const oldVersion = event.oldVersion;
        console.log(`Upgrading IndexedDB from version ${oldVersion} to ${db.version}`);
        
        // Create a store for email summaries if it doesn't exist
        if (!db.objectStoreNames.contains('summaries')) {
          console.log("Creating 'summaries' store");
          const summaryStore = db.createObjectStore('summaries', { keyPath: 'id' });
          summaryStore.createIndex('hash', 'hash', { unique: true });
          summaryStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
        
        // Create a store for email metadata if it doesn't exist
        if (!db.objectStoreNames.contains('emails')) {
          console.log("Creating 'emails' store");
          const emailStore = db.createObjectStore('emails', { keyPath: 'id' });
          emailStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
        // Create a store for singular email summaries if it doesn't exist
        if (!db.objectStoreNames.contains('emailSummaries')) {
          console.log("Creating 'emailSummaries' store");
          const emailSummaryStore = db.createObjectStore('emailSummaries', { keyPath: 'id' });
          emailSummaryStore.createIndex('emailId', 'emailId', { unique: true });
          emailSummaryStore.createIndex('hash', 'hash', { unique: false });
          emailSummaryStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
        // Create a store for calendar events if it doesn't exist
        if (!db.objectStoreNames.contains('events')) {
          console.log("Creating 'events' store");
          const eventStore = db.createObjectStore('events', { keyPath: 'id' });
          eventStore.createIndex('timestamp', 'timestamp', { unique: false });
          eventStore.createIndex('eventDate', 'eventDate', { unique: false });
        }
        
        // Create a store for contacts if it doesn't exist
        if (!db.objectStoreNames.contains('contacts')) {
          console.log("Creating 'contacts' store");
          const contactStore = db.createObjectStore('contacts', { keyPath: 'id' });
          contactStore.createIndex('email', 'email', { unique: true });
          contactStore.createIndex('name', 'name', { unique: false });
          contactStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
        
        // Create a store for chat history if it doesn't exist
        if (!db.objectStoreNames.contains('chatHistory')) {
          console.log("Creating 'chatHistory' store");
          const chatStore = db.createObjectStore('chatHistory', { keyPath: 'id', autoIncrement: true });
          chatStore.createIndex('timestamp', 'timestamp', { unique: false });
          chatStore.createIndex('conversationId', 'conversationId', { unique: false });
        }
      };
      
      dbRequest.onsuccess = function(event) {
        console.log("IndexedDB initialized successfully");
        resolve(event.target.result);
      };
      
      dbRequest.onerror = function(event) {
        console.error("Error initializing IndexedDB:", event.target.error);
        reject(event.target.error);
      };
    });
}
  
// Function to store emails in IndexedDB
export async function storeEmails(emails) {
  try {
    const db = await initSummaryDB();
    const transaction = db.transaction(['emails'], 'readwrite');
    const emailStore = transaction.objectStore('emails');
    
    // Timestamp for this batch
    const timestamp = Date.now();
    
    // Store each email with timestamp
    emails.forEach(email => {
      emailStore.put({
        id: email.id,
        data: email,
        timestamp: timestamp
      });
    });
    
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        console.log(`Stored ${emails.length} emails in IndexedDB`);
        resolve();
      };
      transaction.onerror = (event) => {
        console.error(" Error storing emails:", event.target.error);
        reject(event.target.error);
      };
    });
  } catch (error) {
    console.error(" Error in storeEmails:", error);
  }
}

// Check if a summary exists in cache for given emails
export async function getSummaryFromDB(emails) {
    try {
      // Generate a hash for the email content
      const contentHash = generateEmailContentHash(emails);
      
      const db = await initSummaryDB();
      const transaction = db.transaction(['summaries'], 'readonly');
      const summaryStore = transaction.objectStore('summaries');
      const hashIndex = summaryStore.index('hash');
      
      return new Promise((resolve, reject) => {
        const request = hashIndex.get(contentHash);
        
        request.onsuccess = function(event) {
          const cachedSummary = event.target.result;
          console.log("✅ Summary found in DB:", cachedSummary);
        };
        
        request.onerror = function(event) {
          console.error("❌ Error retrieving cached summary:", event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      console.error("❌ Error in getSummaryFromDB:", error);
      return null;
    }
}
  
// Store a summary in the cache
export async function storeSummaryInDB(emails, summary) {
    try {
      const contentHash = generateEmailContentHash(emails);
      
      const db = await initSummaryDB();
      const transaction = db.transaction(['summaries'], 'readwrite');
      const summaryStore = transaction.objectStore('summaries');
      const hashIndex = summaryStore.index('hash');
      
      // Check if a summary with this hash already exists
      const existingRequest = hashIndex.get(contentHash);
      
      return new Promise((resolve, reject) => {
        existingRequest.onsuccess = function(event) {
          const existingSummary = event.target.result;
          
          // Create a unique ID or use existing one
          const summaryId = existingSummary ? existingSummary.id : 'summary_' + Date.now();
          
          // Update existing summary or add new one
          summaryStore.put({
            id: summaryId,
            hash: contentHash,
            summary: summary,
            timestamp: Date.now(),
            emailCount: emails.length
          });
          
          transaction.oncomplete = function() {
            if (existingSummary) {
              console.log("✅ Updated existing summary in DB");
            } else {
              console.log("✅ Added new summary to DB");
            }
            resolve();
          };
          
          transaction.onerror = function(event) {
            console.error("❌ Error storing summary in DB:", event.target.error);
            reject(event.target.error);
          };
        };
        
        existingRequest.onerror = function(event) {
          console.error("❌ Error checking for existing summary:", event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      console.error("❌ Error in storeSummaryInDB:", error);
    }
}
  
// Get events from database
export async function getEventsFromDB() {
    try {
      const db = await initSummaryDB();
      const transaction = db.transaction(['events'], 'readonly');
      const eventStore = transaction.objectStore('events');
      
      return new Promise((resolve, reject) => {
        const request = eventStore.getAll();
        
        request.onsuccess = function(event) {
          const events = event.target.result || [];
          
          // Sort by event date, closest first
          events.sort((a, b) => a.eventDate - b.eventDate);
          
          resolve(events);
        };
        
        request.onerror = function(event) {
          console.error("❌ Error retrieving events from DB:", event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      console.error("❌ Error in getEventsFromDB:", error);
      // Return empty array if we hit an error
      return [];
    }
}

// Store events in cache
export async function storeEventsInCache(events) {
    try {
      // First ensure we have initialization
      const db = await initSummaryDB();
      
      // Make sure the events store exists
      if (!db.objectStoreNames.contains('events')) {
        throw new Error("Events store not found in IndexedDB");
      }
      
      // First get existing events to check for duplicates
      const existingEvents = await getEventsFromDB();
      
      // Filter out duplicate events based on content
      const uniqueEvents = events.filter(newEvent => {
        // Check if this event already exists (same title, date, and time)
        const isDuplicate = existingEvents.some(existingEvent => 
          existingEvent.title === newEvent.title && 
          existingEvent.date === newEvent.date &&
          existingEvent.time === newEvent.time
        );
        
        if (isDuplicate) {
          console.log(`⚠️ Skipping duplicate event: "${newEvent.title}" on ${newEvent.date} at ${newEvent.time}`);
          return false;
        }
        return true;
      });
      
      console.log(`📅 Filtered ${events.length - uniqueEvents.length} duplicate events`);
      
      // If there are no non-duplicate events, nothing to store
      if (uniqueEvents.length === 0) {
        console.log("📅 No new unique events to store");
        return Promise.resolve();
      }
      
      // Proceed with storing the unique events in IndexedDB
      const transaction = db.transaction(['events'], 'readwrite');
      const eventStore = transaction.objectStore('events');
      
      // Store each event
      uniqueEvents.forEach(event => {
        eventStore.put(event);
      });
      
      // Also store to Chrome Storage with deduplication
      const storeChromeStorage = new Promise((resolve, reject) => {
        chrome.storage.local.get(['events'], (result) => {
          const existingStorageEvents = result.events || [];
          
          // Check for duplicates in Chrome Storage
          const uniqueForStorage = uniqueEvents.filter(newEvent => {
            return !existingStorageEvents.some(existingEvent => 
              existingEvent.title === newEvent.title && 
              existingEvent.date === newEvent.date &&
              existingEvent.time === newEvent.time
            );
          });
          
          // Combine with existing events
          const allStorageEvents = [...existingStorageEvents, ...uniqueForStorage];
          
          // Store in Chrome Storage
          chrome.storage.local.set({ events: allStorageEvents }, () => {
            console.log(`✅ Also stored ${uniqueForStorage.length} unique events in Chrome Storage`);
            resolve();
          });
        });
      });
      
      return new Promise((resolve, reject) => {
        transaction.oncomplete = function() {
          console.log(`✅ Stored ${uniqueEvents.length} unique events in IndexedDB cache`);
          
          // Wait for Chrome Storage to complete too
          storeChromeStorage.then(() => {
            resolve();
          }).catch(error => {
            console.error("❌ Error storing events in Chrome Storage:", error);
            resolve(); // Still resolve as IndexedDB succeeded
          });
        };
        
        transaction.onerror = function(event) {
          console.error("❌ Error storing events in IndexedDB cache:", event.target.error);
          
          // Try Chrome Storage as fallback
          storeChromeStorage.then(() => {
            resolve(); // Resolve as Chrome Storage succeeded
          }).catch(error => {
            console.error("❌ Error storing events in Chrome Storage too:", error);
            reject(event.target.error);
          });
        };
      });
    } catch (error) {
      console.error("❌ Error in storeEventsInCache:", error);
      
      // Try Chrome Storage as fallback
      return new Promise((resolve, reject) => {
        chrome.storage.local.get(['events'], (result) => {
          const existingStorageEvents = result.events || [];
          
          // Check for duplicates in Chrome Storage
          const uniqueForStorage = events.filter(newEvent => {
            return !existingStorageEvents.some(existingEvent => 
              existingEvent.title === newEvent.title && 
              existingEvent.date === newEvent.date &&
              existingEvent.time === newEvent.time
            );
          });
          
          // Combine with existing events
          const allStorageEvents = [...existingStorageEvents, ...uniqueForStorage];
          
          // Store in Chrome Storage
          chrome.storage.local.set({ events: allStorageEvents }, () => {
            console.log(`✅ Fallback: stored ${uniqueForStorage.length} unique events in Chrome Storage`);
            resolve();
          });
        });
      });
    }
}
  
// Clean up old cache entries
export async function cleanupOldCacheEntries() {
    try {
      const db = await initSummaryDB();
      const transaction = db.transaction(['summaries', 'emails', 'events'], 'readwrite');
      const summaryStore = transaction.objectStore('summaries');
      const emailStore = transaction.objectStore('emails');
      const eventStore = transaction.objectStore('events');
      
      // Get all summary entries sorted by timestamp
      const summaryTimestampIndex = summaryStore.index('timestamp');
      const emailTimestampIndex = emailStore.index('timestamp');
      const eventTimestampIndex = eventStore.index('timestamp');
      
      // Max age for cache entries (7 days)
      const maxAge = 7 * 24 * 60 * 60 * 1000;
      const cutoffTime = Date.now() - maxAge;
      
      // Clean up old summaries
      const summaryRange = IDBKeyRange.upperBound(cutoffTime);
      summaryTimestampIndex.openCursor(summaryRange).onsuccess = function(event) {
        const cursor = event.target.result;
        if (cursor) {
          summaryStore.delete(cursor.value.id);
          cursor.continue();
        }
      };
      
      // Clean up old emails
      const emailRange = IDBKeyRange.upperBound(cutoffTime);
      emailTimestampIndex.openCursor(emailRange).onsuccess = function(event) {
        const cursor = event.target.result;
        if (cursor) {
          emailStore.delete(cursor.value.id);
          cursor.continue();
        }
      };
      
      // Clean up old events
      const eventRange = IDBKeyRange.upperBound(cutoffTime);
      eventTimestampIndex.openCursor(eventRange).onsuccess = function(event) {
        const cursor = event.target.result;
        if (cursor) {
          eventStore.delete(cursor.value.id);
          cursor.continue();
        }
      };
      
      return new Promise((resolve) => {
        transaction.oncomplete = function() {
          console.log("✅ Old cache entries cleaned up");
          resolve();
        };
      });
    } catch (error) {
      console.error("❌ Error cleaning up old cache entries:", error);
    }
}

// Helper functions for the chat cache
export async function getCachedItem(key) {
    return new Promise((resolve) => {
        chrome.storage.local.get([key], function(result) {
            resolve(result[key] || null);
        });
    });
}

export async function storeCachedItem(key, value) {
    chrome.storage.local.set({[key]: value}, function() {
        console.log(`Cached item stored with key: ${key}`);
    });
}

// Mark an event as not added in the cache
export async function markEventAsNotAdded(eventId) {
    try {
      console.log("Marking event as not added:", eventId);
      
      // Update in Chrome storage first
      const storageResult = await new Promise((resolve) => {
        chrome.storage.local.get(['events'], function(result) {
          const events = result.events || [];
          let eventFound = false;
          
          const updatedEvents = events.map(event => {
            if (event.id === eventId) {
              eventFound = true;
              return { ...event, added: false };
            }
            return event;
          });
          
          if (eventFound) {
            chrome.storage.local.set({ events: updatedEvents }, () => {
              console.log("✅ Updated event status in Chrome storage");
              resolve(true);
            });
          } else {
            console.warn("⚠️ Event not found in Chrome storage:", eventId);
            resolve(false);
          }
        });
      });
      
      // Update in IndexedDB
      try {
        const db = await initSummaryDB();
        const transaction = db.transaction(['events'], 'readwrite');
        const eventStore = transaction.objectStore('events');
        
        return new Promise((resolve, reject) => {
          const request = eventStore.get(eventId);
          
          request.onsuccess = function(event) {
            const eventData = event.target.result;
            if (eventData) {
              eventData.added = false;
              eventStore.put(eventData);
              console.log("✅ Updated event status in IndexedDB");
            } else {
              console.warn("⚠️ Event not found in IndexedDB:", eventId);
            }
          };
          
          transaction.oncomplete = function() {
            resolve(true);
          };
          
          transaction.onerror = function(event) {
            console.error("❌ IndexedDB error:", event.target.error);
            reject(event.target.error);
          };
        });
      } catch (dbError) {
        console.error("❌ Error updating event in IndexedDB:", dbError);
        // Continue even if IndexedDB fails, as we've already updated Chrome storage
        return storageResult;
      }
    } catch (error) {
      console.error("❌ Error marking event as not added:", error);
      throw error;
    }
}
   
// Mark an event as added in the cache
export async function markEventAsAdded(eventId) {
    try {
      console.log("Marking event as added:", eventId);
      
      // Update in Chrome storage first
      const storageResult = await new Promise((resolve) => {
        chrome.storage.local.get(['events'], function(result) {
          const events = result.events || [];
          let eventFound = false;
          
          const updatedEvents = events.map(event => {
            if (event.id === eventId) {
              eventFound = true;
              return { ...event, added: true };
            }
            return event;
          });
          
          if (eventFound) {
            chrome.storage.local.set({ events: updatedEvents }, () => {
              console.log("✅ Updated event in Chrome storage");
              
              // Notify UI that events have been updated
              chrome.runtime.sendMessage({
                action: "eventsUpdated",
                events: updatedEvents
              });
              
              resolve(true);
            });
          } else {
            console.warn("⚠️ Event not found in Chrome storage:", eventId);
            resolve(false);
          }
        });
      });
      
      // Update in IndexedDB
      try {
        const db = await initSummaryDB();
        const transaction = db.transaction(['events'], 'readwrite');
        const eventStore = transaction.objectStore('events');
        
        return new Promise((resolve, reject) => {
          const request = eventStore.get(eventId);
          
          request.onsuccess = function(event) {
            const eventData = event.target.result;
            if (eventData) {
              eventData.added = true;
              eventStore.put(eventData);
              console.log("✅ Updated event in IndexedDB");
            } else {
              console.warn("⚠️ Event not found in IndexedDB:", eventId);
            }
          };
          
          transaction.oncomplete = function() {
            // Get all updated events
            getEventsFromDB().then(allEvents => {
              // Notify UI that events have been updated after IndexedDB changes
              chrome.runtime.sendMessage({
                action: "eventsUpdated",
                events: allEvents
              });
            });
            
            resolve(true);
          };
          
          transaction.onerror = function(event) {
            console.error("❌ IndexedDB error:", event.target.error);
            reject(event.target.error);
          };
        });
      } catch (dbError) {
        console.error("❌ Error updating event in IndexedDB:", dbError);
        // Continue even if IndexedDB fails, as we've already updated Chrome storage
        return storageResult;
      }
    } catch (error) {
      console.error("❌ Error marking event as added:", error);
      throw error;
    }
}

// Function to save an email summary to storage
export async function saveEmailSummary(emailId, summary) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['emailSummaries'], (result) => {
      const summaries = result.emailSummaries || {};
      summaries[emailId] = {
        summary: summary,
        timestamp: Date.now()
      };
      
      chrome.storage.local.set({ emailSummaries: summaries }, () => {
        console.log(`✅ Saved summary for email ${emailId}`);
        resolve(true);
      });
    });
  });
}

// Function to get a saved email summary from storage
export async function getEmailSummary(emailId) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['emailSummaries'], (result) => {
      const summaries = result.emailSummaries || {};
      const savedSummary = summaries[emailId];
      
      // Check if we have a saved summary and it's less than 7 days old
      if (savedSummary && (Date.now() - savedSummary.timestamp < 7 * 24 * 60 * 60 * 1000)) {
        console.log(`🎯 Retrieved cached summary for email ${emailId}`);
        resolve(savedSummary.summary);
      } else {
        resolve(null);
      }
    });
  });
}

// Function to clean up old summaries (older than 7 days)
export async function cleanupOldSummaries() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['emailSummaries'], (result) => {
      const summaries = result.emailSummaries || {};
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      let cleaned = false;
      
      // Remove summaries older than 7 days
      for (const emailId in summaries) {
        if (summaries[emailId].timestamp < sevenDaysAgo) {
          delete summaries[emailId];
          cleaned = true;
        }
      }
      
      if (cleaned) {
        chrome.storage.local.set({ emailSummaries: summaries }, () => {
          console.log('🧹 Cleaned up old email summaries');
          resolve(true);
        });
      } else {
        resolve(false);
      }
    });
  });
}

// Store contacts in IndexedDB
export async function storeContactsInDB(contacts) {
  try {
    const db = await initSummaryDB();
    const transaction = db.transaction(['contacts'], 'readwrite');
    const contactStore = transaction.objectStore('contacts');
    
    for (const [name, email] of contacts) {
      contactStore.put({
        id: email,
        name: name,
        email: email,
        timestamp: Date.now()
      });
    }
    
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        console.log(`✅ Stored ${contacts.length} contacts in IndexedDB`);
        resolve();
      };
      transaction.onerror = (event) => {
        console.error("❌ Error storing contacts:", event.target.error);
        reject(event.target.error);
      };
    });
  } catch (error) {
    console.error("❌ Error storing contacts in IndexedDB:", error);
    throw error;
  }
}

// Store chat message in IndexedDB
export async function storeChatMessageInDB(message, sender, conversationId = 'default') {
  try {
    const db = await initSummaryDB();
    const transaction = db.transaction(['chatHistory'], 'readwrite');
    const chatStore = transaction.objectStore('chatHistory');
    
    const chatMessage = {
      message: message,
      sender: sender, // 'user' or 'bot'
      conversationId: conversationId,
      timestamp: Date.now()
    };
    
    return new Promise((resolve, reject) => {
      const request = chatStore.add(chatMessage);
      
      transaction.oncomplete = function() {
        console.log(`✅ Added message to chat history in DB`);
        resolve(request.result); // This will be the generated ID
      };
      
      transaction.onerror = function(event) {
        console.error("❌ Error storing chat message in DB:", event.target.error);
        reject(event.target.error);
      };
    });
  } catch (error) {
    console.error("❌ Error in storeChatMessageInDB:", error);
    throw error;
  }
}

// Get chat history from IndexedDB
export async function getChatHistoryFromDB(conversationId = 'default') {
  try {
    const db = await initSummaryDB();
    const transaction = db.transaction(['chatHistory'], 'readonly');
    const chatStore = transaction.objectStore('chatHistory');
    const conversationIndex = chatStore.index('conversationId');
    
    return new Promise((resolve, reject) => {
      const request = conversationIndex.getAll(conversationId);
      
      request.onsuccess = function(event) {
        const messages = event.target.result || [];
        
        // Sort by timestamp
        messages.sort((a, b) => a.timestamp - b.timestamp);
        
        console.log(`✅ Retrieved ${messages.length} chat messages from DB`);
        resolve(messages);
      };
      
      request.onerror = function(event) {
        console.error("❌ Error retrieving chat messages from DB:", event.target.error);
        reject(event.target.error);
      };
    });
  } catch (error) {
    console.error("❌ Error in getChatHistoryFromDB:", error);
    return [];
  }
}

// Clear chat history for a specific conversation
export async function clearChatHistoryInDB(conversationId = 'default') {
  try {
    const db = await initSummaryDB();
    const transaction = db.transaction(['chatHistory'], 'readwrite');
    const chatStore = transaction.objectStore('chatHistory');
    const conversationIndex = chatStore.index('conversationId');
    
    return new Promise((resolve, reject) => {
      // First get all message IDs for this conversation
      const getRequest = conversationIndex.getAllKeys(conversationId);
      
      getRequest.onsuccess = function(event) {
        const messageKeys = event.target.result || [];
        let deletedCount = 0;
        
        if (messageKeys.length === 0) {
          console.log(`No chat messages found for conversation ${conversationId}`);
          resolve(0);
          return;
        }
        
        // Delete each message
        messageKeys.forEach(key => {
          const deleteRequest = chatStore.delete(key);
          deleteRequest.onsuccess = function() {
            deletedCount++;
            if (deletedCount === messageKeys.length) {
              console.log(`✅ Deleted ${deletedCount} chat messages from DB`);
              resolve(deletedCount);
            }
          };
          deleteRequest.onerror = function(event) {
            console.error(`❌ Error deleting chat message ${key}:`, event.target.error);
          };
        });
      };
      
      getRequest.onerror = function(event) {
        console.error("❌ Error retrieving chat message keys:", event.target.error);
        reject(event.target.error);
      };
    });
  } catch (error) {
    console.error("❌ Error in clearChatHistoryInDB:", error);
    throw error;
  }
}

// Clean up old chat messages (older than 30 days)
export async function cleanupOldChatMessages() {
  try {
    const db = await initSummaryDB();
    const transaction = db.transaction(['chatHistory'], 'readwrite');
    const chatStore = transaction.objectStore('chatHistory');
    const timestampIndex = chatStore.index('timestamp');
    
    // Max age for chat messages (30 days)
    const maxAge = 30 * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - maxAge;
    
    // Delete old messages
    const range = IDBKeyRange.upperBound(cutoffTime);
    
    return new Promise((resolve) => {
      let deletedCount = 0;
      
      timestampIndex.openCursor(range).onsuccess = function(event) {
        const cursor = event.target.result;
        if (cursor) {
          chatStore.delete(cursor.primaryKey);
          deletedCount++;
          cursor.continue();
        }
      };
      
      transaction.oncomplete = function() {
        console.log(`✅ Cleaned up ${deletedCount} old chat messages`);
        resolve(deletedCount);
      };
    });
  } catch (error) {
    console.error("❌ Error cleaning up old chat messages:", error);
  }
}

// Delete a specific event from the database
export async function deleteEventFromDB(eventId) {
  try {
    console.log("🗑️ Deleting event from DB:", eventId);
    
    // Get database connection
    const db = await initSummaryDB();
    const transaction = db.transaction(['events'], 'readwrite');
    const eventStore = transaction.objectStore('events');
    
    return new Promise((resolve, reject) => {
      // Delete the event
      const request = eventStore.delete(eventId);
      
      request.onsuccess = function() {
        console.log("✅ Event deleted from IndexedDB:", eventId);
        resolve(true);
      };
      
      request.onerror = function(event) {
        console.error("❌ Error deleting event from IndexedDB:", event.target.error);
        reject(event.target.error);
      };
      
      transaction.oncomplete = function() {
        // Notify UI that events have been updated
        chrome.runtime.sendMessage({
          action: "eventsUpdated"
        }).catch(err => {
          // Ignore errors if no listeners
          console.log("No listeners for eventsUpdated event");
        });
      };
    });
  } catch (error) {
    console.error("❌ Error in deleteEventFromDB:", error);
    return false;
  }
}

// Get contacts from database
export async function getContactsFromDB() {
  try {
    const db = await initSummaryDB();
    const transaction = db.transaction(['contacts'], 'readonly');
    const contactStore = transaction.objectStore('contacts');
    
    return new Promise((resolve, reject) => {
      const request = contactStore.getAll();
      
      request.onsuccess = function(event) {
        const contacts = event.target.result || [];
        console.log(`✅ Retrieved ${contacts.length} contacts from DB`);
        
        // Transform database format to [name, email] format for consistency
        const formattedContacts = contacts.map(contact => [contact.name, contact.email]);
        
        resolve(formattedContacts);
      };
      
      request.onerror = function(event) {
        console.error("❌ Error retrieving contacts from DB:", event.target.error);
        reject(event.target.error);
      };
    });
  } catch (error) {
    console.error("❌ Error in getContactsFromDB:", error);
    return [];
  }
}

// Look up a contact by email in the database
export async function lookupContactInDB(email) {
  if (!email) return null;
  
  try {
    const db = await initSummaryDB();
    const transaction = db.transaction(['contacts'], 'readonly');
    const contactStore = transaction.objectStore('contacts');
    
    return new Promise((resolve, reject) => {
      const request = contactStore.get(email);
      
      request.onsuccess = function(event) {
        const contact = event.target.result;
        if (contact) {
          console.log(`✅ Found contact in DB: ${contact.name} (${contact.email})`);
          resolve([contact.name, contact.email]);
        } else {
          console.log(`⚠️ Contact not found in DB: ${email}`);
          resolve(null);
        }
      };
      
      request.onerror = function(event) {
        console.error("❌ Error looking up contact in DB:", event.target.error);
        reject(event.target.error);
      };
    });
  } catch (error) {
    console.error("❌ Error in lookupContactInDB:", error);
    return null;
  }
}

// Search for contacts by name in the database
export async function searchContactsByNameInDB(name) {
  if (!name) return [];
  
  try {
    const db = await initSummaryDB();
    const transaction = db.transaction(['contacts'], 'readonly');
    const contactStore = transaction.objectStore('contacts');
    const nameIndex = contactStore.index('name');
    
    // Get all contacts, then filter by name (case-insensitive partial match)
    return new Promise((resolve, reject) => {
      const request = contactStore.getAll();
      
      request.onsuccess = function(event) {
        const allContacts = event.target.result || [];
        const normalizedQuery = name.toLowerCase().trim();
        
        // Filter contacts where name contains the search term
        const matchingContacts = allContacts.filter(contact => 
          contact.name.toLowerCase().includes(normalizedQuery)
        );
        
        console.log(`✅ Found ${matchingContacts.length} contacts matching "${name}"`);
        
        // Transform to [name, email] format
        const formattedContacts = matchingContacts.map(contact => [contact.name, contact.email]);
        resolve(formattedContacts);
      };
      
      request.onerror = function(event) {
        console.error("❌ Error searching contacts in DB:", event.target.error);
        reject(event.target.error);
      };
    });
  } catch (error) {
    console.error("❌ Error in searchContactsByNameInDB:", error);
    return [];
  }
}

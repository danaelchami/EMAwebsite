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
        
        // Create a store for calendar events if it doesn't exist
        if (!db.objectStoreNames.contains('events')) {
          console.log("Creating 'events' store");
          const eventStore = db.createObjectStore('events', { keyPath: 'id' });
          eventStore.createIndex('timestamp', 'timestamp', { unique: false });
          eventStore.createIndex('eventDate', 'eventDate', { unique: false });
        }
      };
      
      dbRequest.onsuccess = function(event) {
        console.log("IndexedDB initialized successfully");
        resolve(event.target.result);
      };
      
      dbRequest.onerror = function(event) {
        console.error(" Error initializing IndexedDB:", event.target.error);
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
export async function getSummaryFromCache(emails) {
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
          
          if (cachedSummary) {
            console.log("✅ Summary found in cache:", cachedSummary);
            
            // Check if cache is still valid (less than 24 hours old)
            const age = Date.now() - cachedSummary.timestamp;
            const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
            
            if (age < maxAge) {
              resolve(cachedSummary.summary);
            } else {
              console.log("⚠️ Cached summary expired");
              resolve(null);
            }
          } else {
            console.log("⚠️ No cached summary found");
            resolve(null);
          }
        };
        
        request.onerror = function(event) {
          console.error("❌ Error retrieving cached summary:", event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      console.error("❌ Error in getSummaryFromCache:", error);
      return null;
    }
}
  
// Store a summary in the cache
export async function storeSummaryInCache(emails, summary) {
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
              console.log("✅ Updated existing summary in cache");
            } else {
              console.log("✅ Added new summary to cache");
            }
            resolve();
          };
          
          transaction.onerror = function(event) {
            console.error("❌ Error storing summary in cache:", event.target.error);
            reject(event.target.error);
          };
        };
        
        existingRequest.onerror = function(event) {
          console.error("❌ Error checking for existing summary:", event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      console.error("❌ Error in storeSummaryInCache:", error);
    }
}
  
// Get events from cache
export async function getEventsFromCache() {
    try {
      // First check if events are in Chrome Storage for quick access
      const storageResult = await new Promise((resolve) => {
        chrome.storage.local.get(['events'], function(result) {
          resolve(result.events || null);
        });
      });
      
      if (storageResult && storageResult.length > 0) {
        console.log("🎯 Using events from Chrome Storage");
        return storageResult;
      }
      
      // If not in Chrome Storage, check IndexedDB
      const db = await initSummaryDB();
      
      // Make sure the events store exists
      if (!db.objectStoreNames.contains('events')) {
        console.warn("⚠️ Events store not found in IndexedDB");
        return [];
      }
      
      const transaction = db.transaction(['events'], 'readonly');
      const eventStore = transaction.objectStore('events');
      
      return new Promise((resolve, reject) => {
        const request = eventStore.getAll();
        
        request.onsuccess = function(event) {
          const events = event.target.result || [];
          
          // Filter out events that are more than 7 days old
          const currentTime = Date.now();
          const filteredEvents = events.filter(event => {
            const eventAge = currentTime - event.timestamp;
            return eventAge < 7 * 24 * 60 * 60 * 1000; // 7 days
          });
          
          // Sort by event date, closest first
          filteredEvents.sort((a, b) => a.eventDate - b.eventDate);
          
          resolve(filteredEvents);
        };
        
        request.onerror = function(event) {
          console.error("❌ Error retrieving events from cache:", event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      console.error("❌ Error in getEventsFromCache:", error);
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
      
      const transaction = db.transaction(['events'], 'readwrite');
      const eventStore = transaction.objectStore('events');
      
      // Store each event
      events.forEach(event => {
        eventStore.put(event);
      });
      
      return new Promise((resolve, reject) => {
        transaction.oncomplete = function() {
          console.log("✅ Events stored in cache");
          chrome.storage.local.set({ events: events }, () => {
            console.log("Events also stored in Chrome Storage.");
          });
          resolve();
        };
        
        transaction.onerror = function(event) {
          console.error("❌ Error storing events in cache:", event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      console.error("❌ Error in storeEventsInCache:", error);
      // Store in Chrome Storage as fallback
      chrome.storage.local.set({ events: events });
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
            getEventsFromCache().then(allEvents => {
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

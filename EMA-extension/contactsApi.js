// contactsApi.js - Functions for interacting with Google Contacts API
import { storeContactsInDB } from './storage.js';

/**
 * Fetches the user's contacts from Google Contacts API
 * @param {string} token - OAuth token for authentication
 * @returns {Promise<Array>} - Array of contact objects
 */
export async function fetchContacts(token) {
  try {
    console.log("👥 Fetching contacts from Google Contacts API");
    
    // Fetch contacts with basic information
    const response = await fetch(
      "https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses&pageSize=100", 
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    const data = await response.json();
    
    if (data.error) {
      console.error("❌ Contacts API Error:", data.error.message);
      return [];
    }
    
    if (!data.connections || data.connections.length === 0) {
      console.warn("⚠️ No contacts found");
      return [];
    }
    
    // Process and format contacts into a simple format
    const contacts = data.connections
      .filter(person => person.emailAddresses && person.emailAddresses.length > 0)
      .map(person => {
        const name = person.names?.[0]?.displayName || "Unknown";
        const email = person.emailAddresses?.[0]?.value || "";
        
        return [name, email]; // Format consistent with existing knownContacts format
      });
    
    console.log(`✅ Contacts fetched: ${contacts.length}`);
    return contacts;
  } catch (error) {
    console.error("❌ Error fetching contacts:", error);
    return [];
  }
}

/**
 * Fetches and stores the user's contacts in IndexedDB
 * @param {string} token - OAuth token for authentication
 * @returns {Promise<Object>} - Object containing the contacts and count
 */
export async function fetchAndStoreContacts(token) {
  try {
    const contacts = await fetchContacts(token);
    
    // Store fetch timestamp in Chrome storage (small data only)
    chrome.storage.local.set({ 
      lastContactsFetch: Date.now()
    }, () => {
      console.log("👥 Contacts fetch timestamp stored");
    });
    
    // Store contacts in IndexedDB
    if (contacts.length > 0) {
      await storeContactsInDB(contacts);
      console.log("👥 Contacts stored in IndexedDB");
    }
    
    return {
      contacts,
      count: contacts.length
    };
  } catch (error) {
    console.error("❌ Error fetching and storing contacts:", error);
    throw error;
  }
}

/**
 * Looks up a contact by partial name or email
 * @param {Array} contacts - Array of contact arrays [name, email]
 * @param {string} query - Partial name or email to search for
 * @returns {Array|null} - Matching contact or null if not found
 */
export function lookupContact(contacts, query) {
  if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
    return null;
  }
  
  const normalizedQuery = query.toLowerCase().trim();
  
  // First try exact matches
  for (const contact of contacts) {
    const [name, email] = contact;
    
    if (name.toLowerCase() === normalizedQuery || 
        email.toLowerCase() === normalizedQuery) {
      return contact;
    }
  }
  
  // Then try partial matches
  for (const contact of contacts) {
    const [name, email] = contact;
    
    if (name.toLowerCase().includes(normalizedQuery) || 
        email.toLowerCase().includes(normalizedQuery)) {
      return contact;
    }
  }
  
  return null;
} 
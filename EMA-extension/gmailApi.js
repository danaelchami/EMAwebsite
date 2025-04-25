// Fetch a list of email message IDs (single batch)
export function fetchEmails(token, timeFilter = 'week', readFilter = 'all') {
    let maxResults = 100; // Default max results
    
    // Build the query based on filters
    let query = '';
    
    // Add time period filter
    if (timeFilter === 'week') {
      // Emails from the past 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const formattedDate = sevenDaysAgo.toISOString().split('T')[0]; // YYYY-MM-DD
      query += `after:${formattedDate}`;
    } else if (timeFilter === 'month') {
      // Emails from the past 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const formattedDate = thirtyDaysAgo.toISOString().split('T')[0];
      query += `after:${formattedDate}`;
    } else if (timeFilter === 'year') {
      // Emails from the past 365 days
      const yearAgo = new Date();
      yearAgo.setDate(yearAgo.getDate() - 365);
      const formattedDate = yearAgo.toISOString().split('T')[0];
      query += `after:${formattedDate}`;
    }
    // For 'all', we don't add a time filter
    
    // Add read/unread filter
    if (readFilter === 'unread') {
      if (query) query += ' ';
      query += 'is:unread';
    } else if (readFilter === 'read') {
      if (query) query += ' ';
      query += 'is:read';
    }
    
    // If timeFilter is all and we want large number of results
    if (timeFilter === 'all') {
      maxResults = 200; // Increase max results for 'all' option
    }
    if (query) {
      query += ' in:inbox';
    } else {
      query = 'in:inbox';
    }
    
    // Construct the URL with query parameters
    const url = `https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}${query ? '&q=' + encodeURIComponent(query) : ''}`;
    
    console.log(`📧 Fetching emails with query: "${query}", maxResults: ${maxResults}`);
    
    return fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    })
      .then(response => response.json())
      .then(data => {
        console.log("Raw API Response:", JSON.stringify(data, null, 2));
  
        if (data.error) {
          console.error("❌ Gmail API Error:", data.error.message);
          return [];
        }
  
        if (!data.messages || data.messages.length === 0) {
          console.warn("⚠️ No emails found.");
          return [];
        }
  
        console.log(`✅ Emails fetched: ${data.messages.length}`);
        return data.messages;
      })
      .catch(error => {
        console.error("❌ Error fetching emails:", error);
        return [];
      });
}

export function fetchEmailContent(token, messageId) {
  return fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`, {
      method: "GET",
      headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
      }
  })
      .then(response => response.json())
      .then(data => {
      const headers = data.payload?.headers || [];
      const from = headers.find(h => h.name.toLowerCase() === "from")?.value || "";
      const to = headers.find(h => h.name.toLowerCase() === "to")?.value || "";

      return {
          ...data,
          from,
          to
      };
      })
      .catch(error => {
      console.error(`❌ Error fetching email content for message ${messageId}:`, error);
      return null;
      });
}
  
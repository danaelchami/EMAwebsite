// Helper function to standardize date formats
export function standardizeDate(dateStr, referenceDate = null) {
    // Try different date formats
    let date;
    
    // Use provided reference date or current date
    const baseDate = referenceDate ? new Date(referenceDate) : new Date();
    const targetYear = baseDate.getFullYear();
    
    // Check for special keywords
    if (typeof dateStr === 'string') {
        const lowerDateStr = dateStr.toLowerCase();
        
        // Handle 'tomorrow'
        if (lowerDateStr.includes('tomorrow')) {
            const tomorrow = new Date(baseDate);
            tomorrow.setDate(baseDate.getDate() + 1);
            return tomorrow.toISOString().split('T')[0];
        }
        
        // Handle 'today'
        if (lowerDateStr.includes('today')) {
            return baseDate.toISOString().split('T')[0];
        }
        
        // Handle 'next monday', 'this tuesday', etc.
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        for (let i = 0; i < dayNames.length; i++) {
            if (lowerDateStr.includes(dayNames[i])) {
                const targetDay = i;
                const result = new Date(baseDate);
                const currentDay = result.getDay();
                
                // Calculate days to add
                let daysToAdd = targetDay - currentDay;
                if (daysToAdd <= 0) daysToAdd += 7; // Next week if today or past day of week
                
                // If it's "next", add a week
                if (lowerDateStr.includes('next')) {
                    daysToAdd += 7;
                }
                
                result.setDate(result.getDate() + daysToAdd);
                return result.toISOString().split('T')[0];
            }
        }
    }
    
    // Check for date formats with only month and day (MM/DD or DD/MM)
    const monthDayRegex = /^(\d{1,2})[\/.-](\d{1,2})$/;
    if (monthDayRegex.test(dateStr)) {
      const [_, first, second] = dateStr.match(monthDayRegex);
      
      // Try as MM/DD first
      const month = parseInt(first);
      const day = parseInt(second);
      
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        date = new Date(targetYear, month - 1, day);
        if (!isNaN(date)) {
          return date.toISOString().split('T')[0];
        }
      }
      
      // Try as DD/MM
      const dayAlt = parseInt(first);
      const monthAlt = parseInt(second);
      
      if (monthAlt >= 1 && monthAlt <= 12 && dayAlt >= 1 && dayAlt <= 31) {
        date = new Date(targetYear, monthAlt - 1, dayAlt);
        if (!isNaN(date)) {
          return date.toISOString().split('T')[0];
        }
      }
      
      // If we get here, neither MM/DD nor DD/MM worked with valid values
      // Assume it's MM/DD regardless and let JavaScript handle it
      return new Date(targetYear, first - 1, second).toISOString().split('T')[0];
    }
    
    // Try direct parsing first
    date = new Date(dateStr);
    if (!isNaN(date)) {
      // Check if the original date string didn't specify year
      // If no year specified, use targetYear instead
      if (!dateStr.match(/\d{4}/) && !isNaN(date.getFullYear())) {
        date.setFullYear(targetYear);
        return date.toISOString().split('T')[0];
      }
      return date.toISOString().split('T')[0]; // YYYY-MM-DD
    }
    
    // Try MM/DD/YYYY or DD/MM/YYYY
    const slashParts = dateStr.split(/[\/.-]/);
    if (slashParts.length === 3) {
      // Assume MM/DD/YYYY first
      const month = parseInt(slashParts[0]);
      const day = parseInt(slashParts[1]);
      let year = parseInt(slashParts[2]);
      
      // Add century if needed
      if (year < 100) {
        year += year < 50 ? 2000 : 1900;
      }
      
      // Validate parts
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        date = new Date(year, month - 1, day);
        if (!isNaN(date)) {
          return date.toISOString().split('T')[0];
        }
      }
      
      // Try DD/MM/YYYY if MM/DD/YYYY failed
      const dayAlt = parseInt(slashParts[0]);
      const monthAlt = parseInt(slashParts[1]);
      
      if (monthAlt >= 1 && monthAlt <= 12 && dayAlt >= 1 && dayAlt <= 31) {
        date = new Date(year, monthAlt - 1, dayAlt);
        if (!isNaN(date)) {
          return date.toISOString().split('T')[0];
        }
      }
    }
    
    // If all parsing fails, return the original string
    return dateStr;
}

// Helper function to convert 12-hour time to ISO time format
export function convertTimeToISO(timeStr) {
    if (!timeStr) return '09:00:00'; // Default time if none provided
    
    try {
      // Handle various time formats
      let hours = 0;
      let minutes = 0;
      
      // Try to parse the time string
      if (timeStr.match(/(\d+)(?::(\d+))?\s*(am|pm)/i)) {
        const [_, hourStr, minuteStr, ampm] = timeStr.match(/(\d+)(?::(\d+))?\s*(am|pm)/i);
        hours = parseInt(hourStr);
        minutes = minuteStr ? parseInt(minuteStr) : 0;
        
        // Convert to 24-hour format
        if (ampm.toLowerCase() === 'pm' && hours < 12) {
          hours += 12;
        } else if (ampm.toLowerCase() === 'am' && hours === 12) {
          hours = 0;
        }
      } else if (timeStr.match(/(\d+):(\d+)/)) {
        // Handle 24-hour format
        const [_, hourStr, minuteStr] = timeStr.match(/(\d+):(\d+)/);
        hours = parseInt(hourStr);
        minutes = parseInt(minuteStr);
      }
      
      // Ensure valid ranges
      hours = Math.min(23, Math.max(0, hours));
      minutes = Math.min(59, Math.max(0, minutes));
      
      // Format to ISO time
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
    } catch (error) {
      console.error("❌ Error converting time format:", error);
      return '09:00:00'; // Default time if parsing fails
    }
}

// Helper function to calculate end time (1 hour after start by default)
export function getEndTime(timeStr) {
    const startTime = convertTimeToISO(timeStr);
    if (startTime === '09:00:00') return '10:00:00'; // Default end time
    
    try {
      const [hours, minutes] = startTime.split(':').map(num => parseInt(num));
      
      // Add 1 hour
      let endHours = hours + 1;
      if (endHours > 23) {
        endHours = 23;
        minutes = 59;
      }
      
      return `${endHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
    } catch (error) {
      console.error("❌ Error calculating end time:", error);
      return '10:00:00'; // Default end time if calculation fails
    }
}
  
// Generate a hash for email content to use as cache key
export function generateEmailContentHash(emails) {
    // Create a string from the email IDs and snippets
    const contentString = emails
      .map(email => `${email.id}:${email.snippet?.substring(0, 100)}`)
      .sort()
      .join('|');
    
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < contentString.length; i++) {
      const char = contentString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString();
}

// Simple function to extract basic event information from emails without using AI
export function createBasicEventsFromEmails(emails) {
    console.log("🔍 Creating basic events from email content");
    const events = [];
    const dateRegex = /(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}|\d{4}-\d{2}-\d{2})/g;
    const timeRegex = /(\d{1,2}[:\.]\d{2}\s*(am|pm|AM|PM)?)/g;
    
    emails.forEach((email, emailIndex) => {
      const snippet = email.snippet || "";
      
      // Skip if snippet is too short
      if (snippet.length < 10) return;
      
      // Extract email timestamp to use as reference date for relative dates
      let emailSentDate = null;
      if (email.internalDate) {
        emailSentDate = new Date(parseInt(email.internalDate));
      } else if (email.payload?.headers) {
        const dateHeader = email.payload.headers.find(h => h.name.toLowerCase() === 'date');
        if (dateHeader?.value) {
          emailSentDate = new Date(dateHeader.value);
        }
      }
      
      // Use email date if valid, otherwise fall back to current date
      if (!emailSentDate || isNaN(emailSentDate.getTime())) {
        emailSentDate = new Date();
      }
      
      // Look for dates in the snippet
      const dateMatches = snippet.match(dateRegex);
      if (dateMatches) {
        dateMatches.forEach((dateMatch, index) => {
          // Try to find a time near this date
          const timeMatches = snippet.match(timeRegex);
          const time = timeMatches && timeMatches.length > index ? timeMatches[index] : null;
          
          // Create a standardized date format (YYYY-MM-DD) using email sent date as reference
          const standardDate = standardizeDate(dateMatch, emailSentDate);
          
          // Create a title from the words before and after the date
          const words = snippet.split(/\s+/);
          const datePosition = words.findIndex(word => word.includes(dateMatch));
          const titleStart = Math.max(0, datePosition - 3);
          const titleEnd = Math.min(words.length, datePosition + 4);
          const title = words.slice(titleStart, titleEnd).join(" ").replace(/[^\w\s]/g, "");
          
          events.push({
            id: `event_${Date.now()}_${emailIndex}_${index}`,
            title: title || "Event from email",
            date: standardDate,
            time: time || "",
            location: "",
            description: snippet.substring(0, 100) + "...",
            timestamp: Date.now(),
            eventDate: new Date(standardDate).getTime() || Date.now(),
            added: false,
            sourceEmailId: email.id
          });
        });
      }
    });
    
    // Store these basic events in Chrome Storage
    if (events.length > 0) {
      chrome.storage.local.set({ events: events });
    }
    
    return events;
  }
  
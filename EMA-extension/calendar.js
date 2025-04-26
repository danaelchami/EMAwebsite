// calendar.js
import { standardizeDate, convertTimeToISO, getEndTime } from './utils.js';
import { markEventAsAdded, markEventAsNotAdded, getEventsFromDB } from './storage.js';

// Fetch events from Google Calendar
export async function fetchCalendarEvents(token, timeMin, timeMax) {
    try {
      // Default time range: 7 days before and after current date if not specified
      const currentDate = new Date();
      if (!timeMin) {
        const sevenDaysAgo = new Date(currentDate);
        sevenDaysAgo.setDate(currentDate.getDate() - 7);
        timeMin = sevenDaysAgo.toISOString();
      }
      if (!timeMax) {
        const sevenDaysLater = new Date(currentDate);
        sevenDaysLater.setDate(currentDate.getDate() + 30);
        timeMax = sevenDaysLater.toISOString();
      }
  
      console.log("🔍 Fetching calendar events from", timeMin, "to", timeMax);
  
      const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
      url.searchParams.append('timeMin', timeMin);
      url.searchParams.append('timeMax', timeMax);
      url.searchParams.append('singleEvents', 'true');
      url.searchParams.append('orderBy', 'startTime');
      url.searchParams.append('maxResults', '100');
  
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
  
      if (!response.ok) {
        const errorData = await response.json();
        console.error("❌ Error fetching calendar events:", errorData);
        throw new Error(errorData.error?.message || 'Failed to fetch calendar events');
      }
  
      const data = await response.json();
      console.log(`✅ Retrieved ${data.items?.length || 0} calendar events`);
      return data.items || [];
    } catch (error) {
      console.error("❌ Error in fetchCalendarEvents:", error);
      throw error;
    }
}
  
// Check if an event exists in Google Calendar
export async function verifyEventInCalendar(token, event) {
    try {
      // Get the date of the event to search
      const eventDate = new Date(event.date);
      if (isNaN(eventDate.getTime())) {
        console.error("❌ Invalid event date:", event.date);
        return false;
      }
  
      // Set time range to search (the day of the event)
      const startOfDay = new Date(eventDate);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(eventDate);
      endOfDay.setHours(23, 59, 59, 999);
  
      // Fetch calendar events for this day
      const calendarEvents = await fetchCalendarEvents(
        token, 
        startOfDay.toISOString(), 
        endOfDay.toISOString()
      );
  
      // Check if any event matches our event
      const eventExists = calendarEvents.some(calEvent => {
        // Compare event titles (summary in Google Calendar)
        const titleMatch = calEvent.summary?.toLowerCase() === event.title.toLowerCase();
        
        // Compare dates
        let dateMatch = false;
        if (calEvent.start?.dateTime) {
          const calEventDate = new Date(calEvent.start.dateTime);
          dateMatch = calEventDate.toDateString() === eventDate.toDateString();
        } else if (calEvent.start?.date) {
          const calEventDate = new Date(calEvent.start.date);
          dateMatch = calEventDate.toDateString() === eventDate.toDateString();
        }
        
        // Return true if both title and date match
        return titleMatch && dateMatch;
      });
  
      console.log(`🔍 Event "${event.title}" on ${event.date} ${eventExists ? 'found' : 'not found'} in calendar`);
      
      // If the event was previously marked as added but is no longer in calendar, update it
      if (!eventExists && event.added) {
        console.log(`⚠️ Event "${event.title}" was marked as added but not found in calendar - resetting status`);
        await markEventAsNotAdded(event.id);
      }
      
      return eventExists;
    } catch (error) {
      console.error("❌ Error verifying event in calendar:", error);
      return false;
    }
}
  
// Add event to Google Calendar
export async function addEventToCalendar(token, event) {
// Send the event to the background script to add to Calendar
      try {
        // First, verify if the event already exists in the calendar
        const eventExists = await verifyEventInCalendar(token, event);
        if (eventExists) {
          console.log("✅ Event already exists in calendar:", event.title);
          // Mark as added in our system
          await markEventAsAdded(event.id);
          return { id: "existing-event", exists: true };
        }

        // Format the event for Google Calendar API
        const calendarEvent = {
          'summary': event.title,
          'location': event.location || '',
          'description': event.description || '',
          'start': {
            'dateTime': `${event.date}T${convertTimeToISO(event.time) || '09:00:00'}`,
            'timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone
          },
          'end': {
            'dateTime': `${event.date}T${getEndTime(event.time) || '10:00:00'}`,
            'timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone
          }
        };
        
        console.log("🔄 Attempting to add event to calendar:", calendarEvent);
        
        // Call Google Calendar API to create event
        const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(calendarEvent)
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          console.error("❌ Calendar API error:", data.error);
          
          // Check if this is a permission/scope issue
          if (data.error?.status === 'PERMISSION_DENIED' || 
              data.error?.message?.includes('insufficient authentication scopes')) {
            console.error("❌ Authentication scope issue detected");
            // Get a new token with the right scopes by requesting interactive authentication
            throw new Error('Calendar permission denied. Please reload the extension to authorize calendar access.');
          }
          
          throw new Error(data.error?.message || 'Failed to add event to calendar');
              }
        
        console.log("✅ Event added to calendar:", data);
        
        // Update the event in our cache to mark it as added
        await markEventAsAdded(event.id);
        
        // Check if data has an id property before returning
        if (!data.id) {
          console.error("❌ Calendar API response missing ID:", data);
          return { 
            id: "unknown-id", 
            exists: false,
            success: true
          };
        }
        
        return data;
      } catch (error) {
        console.error("❌ Error adding event to calendar:", error);
        throw error;
      }
}

  
// Check and sync calendar events with extension
export async function syncCalendarEvents(token) {
    try {
        console.log("🔄 Starting calendar events sync...");
        
        // Get events from our cache
        const ourEvents = await getEventsFromDB();
        if (!ourEvents || ourEvents.length === 0) {
            console.log("ℹ️ No events in cache to sync");
            return { synced: 0 };
        }
        
        let syncedCount = 0;
        
        // Process each event to check if it exists in calendar
        for (const event of ourEvents) {
            // Verify if the event exists in calendar
            const exists = await verifyEventInCalendar(token, event);
            
            // If event exists in calendar but not marked as added in our system
            if (exists && !event.added) {
                console.log(`✅ Event "${event.title}" found in calendar - marking as added`);
                await markEventAsAdded(event.id);
                syncedCount++;
            }
            // If event doesn't exist in calendar but is marked as added in our system
            else if (!exists && event.added) {
                console.log(`⚠️ Event "${event.title}" not found in calendar - marking as not added`);
                await markEventAsNotAdded(event.id);
                syncedCount++;
            }
        }
        
        console.log(`✅ Calendar events sync completed - ${syncedCount} events updated`);
        return { synced: syncedCount };
    } catch (error) {
        console.error("❌ Error syncing calendar events:", error);
        throw error;
    }
}

// Add function to remove an event from Google Calendar
export async function removeEventFromCalendar(token, event) {
    try {
        console.log("🔄 Attempting to remove event from calendar:", event.title);
        
        // First, find the event in Google Calendar
        const eventDate = new Date(event.date);
        if (isNaN(eventDate.getTime())) {
            console.error("❌ Invalid event date:", event.date);
            throw new Error("Invalid event date");
        }
        
        // Set time range to search (the day of the event)
        const startOfDay = new Date(eventDate);
        startOfDay.setHours(0, 0, 0, 0);
        
        const endOfDay = new Date(eventDate);
        endOfDay.setHours(23, 59, 59, 999);
        
        // Fetch calendar events for this day
        const calendarEvents = await fetchCalendarEvents(
            token, 
            startOfDay.toISOString(), 
            endOfDay.toISOString()
        );
        
        // Find the matching event in Google Calendar
        const matchingEvent = calendarEvents.find(calEvent => {
            // Compare event titles (summary in Google Calendar)
            const titleMatch = calEvent.summary?.toLowerCase() === event.title.toLowerCase();
            
            // Compare dates
            let dateMatch = false;
            if (calEvent.start?.dateTime) {
                const calEventDate = new Date(calEvent.start.dateTime);
                dateMatch = calEventDate.toDateString() === eventDate.toDateString();
            } else if (calEvent.start?.date) {
                const calEventDate = new Date(calEvent.start.date);
                dateMatch = calEventDate.toDateString() === eventDate.toDateString();
            }
            
            // Return true if both title and date match
            return titleMatch && dateMatch;
        });
        
        if (!matchingEvent) {
            console.log("⚠️ Event not found in Google Calendar:", event.title);
            // Update the event in our cache to mark it as not added
            await markEventAsNotAdded(event.id);
            return { success: false, message: "Event not found in Google Calendar" };
        }
        
        // Delete the event from Google Calendar using its Google Calendar ID
        const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${matchingEvent.id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
            }
        });
        
        if (response.status === 204 || response.status === 200) {
            console.log("✅ Event removed from Google Calendar:", event.title);
            
            // Update the event in our cache to mark it as not added
            await markEventAsNotAdded(event.id);
            
            return { success: true };
        } else {
            const errorData = await response.json();
            console.error("❌ Error removing event from calendar:", errorData);
            throw new Error(errorData.error?.message || 'Failed to remove event from calendar');
        }
    } catch (error) {
        console.error("❌ Error removing event from calendar:", error);
        throw error;
    }
}
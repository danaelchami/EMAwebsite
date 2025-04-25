// agent.js
import { authenticateUser } from './auth.js';
import { fetchEmails, fetchEmailContent } from './gmailApi.js';
import { generateEmailContentHash } from './utils.js';
import { storeEmails, getCachedItem, storeCachedItem } from './storage.js';

// Constants
const GEMINI_API_KEY = "AIzaSyBhlM0p5vFbeG0uR9oqb66ya2Gd8NuY6Ks";
const MAX_CONVERSATION_HISTORY = 10; // Maximum number of conversation turns to remember

/**
 * Main agent function that processes user requests
 * @param {string} userInput - The user's message/request
 * @param {Object} context - Current context like stored emails, contacts, etc.
 * @returns {Object} - Response with reply and any additional data
 */
export async function processAgentRequest(userInput, context = {}) {
  // Get conversation history or initialize it if it doesn't exist
  const conversationHistory = await getConversationHistory();

  // Check if this is a follow-up to a pending email
  const pendingEmail = context.pendingEmail;
  if (pendingEmail && !isYesNoResponse(userInput)) {
    // This might be an edit request for the pending email
    const isEditRequest = await isEmailEditRequest(userInput);
    if (isEditRequest) {
      const response = await handleEmailEditRequest(userInput, pendingEmail, context, conversationHistory);
      
      // Add this interaction to history
      await addToConversationHistory(userInput, response.reply);
      
      return response;
    }
  }

  // First determine what type of request this is
  const requestType = await determineRequestType(userInput);
  
  console.log("📌 Agent determined request type:", requestType);
  
  let response;
  switch (requestType.type) {
    case "send_email":
      response = await handleSendEmailRequest(userInput, context, conversationHistory);
      break;
    
    case "email_question":
      response = await handleEmailQuestion(userInput, context, conversationHistory);
      break;
      
    case "conversation":
    default:
      response = await handleConversation(userInput, context, conversationHistory);
      break;
  }
  
  // Add this interaction to history
  await addToConversationHistory(userInput, response.reply);
  
  return response;
}

/**
 * Get the conversation history from storage
 */
async function getConversationHistory() {
  return new Promise(resolve => {
    chrome.storage.local.get(['conversationHistory'], result => {
      resolve(result.conversationHistory || []);
    });
  });
}

/**
 * Add a new interaction to the conversation history
 */
async function addToConversationHistory(userMessage, agentResponse) {
  const conversationHistory = await getConversationHistory();
  
  // Create a new entry
  const newEntry = {
    timestamp: Date.now(),
    user: userMessage,
    agent: agentResponse
  };
  
  // Add to the start of the array (newest first)
  const updatedHistory = [newEntry, ...conversationHistory].slice(0, MAX_CONVERSATION_HISTORY);
  
  // Store the updated history
  chrome.storage.local.set({ conversationHistory: updatedHistory });
  
  return updatedHistory;
}

/**
 * Format conversation history for inclusion in prompts
 */
function formatConversationHistory(history, maxTurns = 5) {
  if (!history || history.length === 0) {
    return "";
  }
  
  // Take the most recent messages, up to maxTurns
  const recentHistory = history.slice(0, maxTurns);
  
  // Format them from oldest to newest
  return recentHistory.reverse().map(entry => {
    return `User: ${entry.user}\nAssistant: ${entry.agent}`;
  }).join('\n\n');
}

/**
 * Check if the input is a simple yes/no response
 */
function isYesNoResponse(input) {
  const lowerInput = input.toLowerCase().trim();
  return lowerInput === 'yes' || lowerInput === 'no';
}

/**
 * Determine if the input is a request to edit a pending email
 */
async function isEmailEditRequest(userInput) {
  // Quick check for common edit keywords
  const editKeywords = /edit|change|update|modify|revise|rewrite|fix|improve|make it|add|remove|shorter|longer|professional|formal|friendly|casual|tone/i;
  return editKeywords.test(userInput);
}

/**
 * Handle a request to edit a pending email
 */
async function handleEmailEditRequest(userInput, pendingEmail, context, conversationHistory) {
  const { to, subject, body } = pendingEmail;
  
  // Format conversation history for context
  const historyText = formatConversationHistory(conversationHistory);
  const hasHistory = historyText.length > 0;
  
  try {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`;
    
    const prompt = `
    You are an email assistant. I have already drafted an email, but the user wants to modify it according to this instruction:
    "${userInput}"
    
    The current email is:
    
    To: ${to}
    Subject: ${subject}
    Body:
    ${body}
    
    ${hasHistory ? `Recent conversation history:\n${historyText}\n\n` : ''}
    
    Please rewrite the email based on the user's request. Only change what's necessary to fulfill the request.
    Keep the recipient the same, but you may adjust the subject and body.
    
    Follow this format exactly:
    To: [same recipient]
    Subject: [modified subject if needed]
    Body:
    [modified body]
    `;
    
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 500
        }
      })
    });

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "⚠️ Couldn't edit the email.";

    // Parse the edited email
    const toMatch = text.match(/To:\s*(.*)/i);
    const subjectMatch = text.match(/Subject:\s*(.*)/i);
    const bodyMatch = text.match(/Body:\s*([\s\S]*)/i);
    
    if (!toMatch || !subjectMatch || !bodyMatch) {
      return { 
        reply: "❌ I had trouble editing your email. Would you like to try a different modification or send the original version?" 
      };
    }
    
    // Use the original 'to' address to ensure it doesn't change
    const newSubject = subjectMatch[1].trim();
    const newBody = bodyMatch[1].trim();
    
    // Update the pending email
    const updatedEmail = {
      to: to, // Keep the original recipient
      subject: newSubject,
      body: newBody
    };
    
    // Store the updated email
    chrome.storage.local.set({
      pendingEmail: updatedEmail
    });

    return {
      reply: `I've updated your email:\n\nTo: ${to}\nSubject: ${newSubject}\n\n${newBody}\n\nDo you want to send this version? (Yes/No)`,
      needsConfirmation: true
    };
  } catch (err) {
    console.error("❌ Gemini error during email edit:", err);
    return { 
      reply: "❌ I encountered an error while trying to edit your email. Would you like to try again with different instructions or send the original version?" 
    };
  }
}

/**
 * Determines what type of request the user is making
 */
async function determineRequestType(userInput) {
  // Check cache first
  const cacheKey = `request_type_${generateEmailContentHash([{snippet: userInput}])}`;
  const cachedType = await getCachedItem(cacheKey);
  
  if (cachedType) {
    console.log("🎯 Using cached request type");
    return JSON.parse(cachedType);
  }
  
  // Email sending patterns
  const sendEmailPattern = /send\s+(an|a)?\s*email|write\s+(an|a)?\s*email|email\s+to|compose\s+(an|a)?\s*email|draft\s+(an|a)?\s*email/i;
  
  // Email question patterns
  const emailQuestionPattern = /email|inbox|message|unread|read|spam|sent|trash|draft|folder|label|attachment|file|document|subject|from|sender|received|date|time/i;
  
  // Simple pattern matching first (faster than API call)
  if (sendEmailPattern.test(userInput)) {
    const result = { type: "send_email", confidence: 0.9 };
    await storeCachedItem(cacheKey, JSON.stringify(result));
    return result;
  }
  
  if (emailQuestionPattern.test(userInput)) {
    const result = { type: "email_question", confidence: 0.8 };
    await storeCachedItem(cacheKey, JSON.stringify(result));
    return result;
  }
  
  // If no clear match, use Gemini to classify more accurately
  try {
    const prompt = `
    Classify the following user input into exactly one of these categories:
    1. send_email - User wants to send or compose an email
    2. email_question - User is asking about emails, inbox, or wants information from their emails
    3. conversation - General conversation not directly related to emails
    
    User input: "${userInput}"
    
    Return only the category name and confidence (0-1):
    { "type": "category_name", "confidence": 0.X }
    `;
    
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 50
        }
      })
    });
    
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    
    if (text) {
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        // Cache the result
        await storeCachedItem(cacheKey, JSON.stringify(result));
        return result;
      }
    }
    
    // Default fallback if API fails
    return { type: "conversation", confidence: 0.5 };
    
  } catch (error) {
    console.error("Error classifying request:", error);
    return { type: "conversation", confidence: 0.5 };
  }
}

/**
 * Handle requests to send an email
 */
async function handleSendEmailRequest(userInput, context, conversationHistory) {
  const { knownContacts = [] } = context;
  
  let contactLines = "";
  
  if (Array.isArray(knownContacts) && knownContacts.length > 0) {
    contactLines = knownContacts.map(([name, email]) => `- ${name}: ${email}`).join('\n');
  } else {
    contactLines = "- someone@example.com";
  }

  // Format conversation history for context
  const historyText = formatConversationHistory(conversationHistory);
  const hasHistory = historyText.length > 0;

  try {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`;
    
    const prompt = `
    You are an email assistant. You MUST generate a professional email based on the user's request.
    
    1. ONLY use the contacts listed below.
    2. Do NOT invent contacts. If no match, clearly say "Contact not found", and ask for email  "
    3. The subject and body should directly reflect what the user asked.
    4. the email should be professional and well written, and a proper length.
    5. sign it with the users name from the email that you are sending from.(do not write sent from)
    6. Follow this format exactly:
    
    To: [recipient@example.com]  
    Subject: [email subject]  
    Body:  
    [email message]
    
    Known contacts:
    ${contactLines}
    
    ${hasHistory ? `Recent conversation history:\n${historyText}\n\n` : ''}
    User's current request: "${userInput}"
    `;
    
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "⚠️ Couldn't generate an email.";

    const toMatch = text.match(/To:\s*(.*)/i);
    const subjectMatch = text.match(/Subject:\s*(.*)/i);
    const bodyMatch = text.match(/Body:\s*([\s\S]*)/i);
    
    if (!toMatch || !subjectMatch || !bodyMatch) {
      return { 
        reply: "❌ I couldn't generate a complete email. Please rephrase your request or provide more details." 
      };
    }
    
    const to = toMatch[1].trim();
    const subject = subjectMatch[1].trim();
    const body = bodyMatch[1].trim();
    
    // Store in pendingEmail for confirmation
    chrome.storage.local.set({
      pendingEmail: { to, subject, body }
    });

    return {
      reply: `Here's your email:\n\nTo: ${to}\nSubject: ${subject}\n\n${body}\n\nDo you want to send this? (Yes/No)`,
      needsConfirmation: true
    };
  } catch (err) {
    console.error("❌ Gemini error:", err);
    return { reply: "❌ Error generating the email. Try again later." };
  }
}

/**
 * Handle questions about emails
 */
async function handleEmailQuestion(userInput, context, conversationHistory) {
  const { emails = [] } = context;
  
  // Format conversation history for context
  const historyText = formatConversationHistory(conversationHistory);
  const hasHistory = historyText.length > 0;
  
  // If we don't have emails yet, fetch them
  if (emails.length === 0) {
    return { 
      reply: "I need to fetch your emails first before I can answer that. Give me a moment...",
      needsFetch: true 
    };
  }
  
  try {
    // Format emails for the AI to analyze
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
    }).join('\n\n');
    
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`;
    
    const prompt = `
    You are EMA, an intelligent email assistant. Answer the following question about the user's emails.
    Be precise, helpful, and conversational.
    
    If asked about specific email content, find and provide relevant details.
    If asked for summaries, focus on the most important information.
    If asked about senders, recipients, or dates, extract that information accurately.
    
    ${hasHistory ? `Recent conversation history:\n${historyText}\n\n` : ''}
    User's current question: "${userInput}"
    
    Emails to analyze:
    ${formattedEmails}
    `;
    
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 300
        }
      })
    });
    
    const data = await response.json();
    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text || 
                 "I couldn't find a good answer in your emails.";
    
    return { reply: answer };
  } catch (error) {
    console.error("Error analyzing emails:", error);
    return { reply: "I encountered an error analyzing your emails. Please try again." };
  }
}

/**
 * Handle general conversation
 */
async function handleConversation(userInput, context, conversationHistory) {
  try {
    // Check cache for this conversation first (for efficiency)
    const cacheKey = `chat_${generateEmailContentHash([{snippet: userInput}])}`;
    const cachedResponse = await getCachedItem(cacheKey);
    
    // Only use cache if it's a simple query without much context dependency
    const isSimpleQuery = userInput.length < 20 && !containsReferenceTerms(userInput);
    if (cachedResponse && isSimpleQuery) {
      console.log("🎯 Using cached chat response");
      return { reply: cachedResponse };
    }
    
    // Format conversation history for context
    const historyText = formatConversationHistory(conversationHistory);
    const hasHistory = historyText.length > 0;
    
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`;
    
    const prompt = `
    You are EMA (Email Management Assistant), a helpful and friendly AI assistant.
    You can understand both English and Arabic written in English letters (Arabizi/Franco-Arab).

    Important language rules:
    - Keep responses friendly and natural in the appropriate language
    - Keep all email analysis functionality working as normal
    - Maintain continuity with previous parts of the conversation
    - If the user refers to something mentioned earlier, answer based on that context
    
    ${hasHistory ? `Recent conversation history:\n${historyText}\n\n` : ''}
    User's current message: ${userInput}
    `;
    
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          topP: 0.8,
          topK: 40
        }
      })
    });
    
    const data = await response.json();
    
    if (!response.ok || data.error) {
      console.error("Error processing message:", data?.error?.message || "Unknown error");
      return { reply: "Sorry, I encountered an error. Please try again." };
    }
    
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || 
                "I couldn't process that. Please try again.";
    
    // Only cache simple responses that don't depend heavily on context
    if (isSimpleQuery) {
      await storeCachedItem(cacheKey, reply);
    }
    
    return { reply };
  } catch (error) {
    console.error("Error in conversation processing:", error);
    return { reply: "Sorry, I encountered an error processing your message." };
  }
}

/**
 * Check if the message contains terms that likely refer to previous context
 */
function containsReferenceTerms(message) {
  const referenceTerms = /it|that|they|them|those|these|this|their|he|she|him|her|his|previous|earlier|before|mentioned|said|told|asked|you said|you mentioned|we discussed/i;
  return referenceTerms.test(message);
}

/**
 * Function to send an email via the Gmail API
 */
export async function sendEmail(token, to, subject, body) {
  const email = 
    `To: ${to}\r\n` +
    `Subject: ${subject}\r\n` +
    `Content-Type: text/plain; charset="UTF-8"\r\n\r\n` +
    `${body}`;

  const encodedMessage = btoa(unescape(encodeURIComponent(email)))
    .replace(/\+/g, '-').replace(/\//g, '_');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw: encodedMessage })
  });

  const data = await res.json();
  return data;
}

/**
 * Function to fetch emails and store them for analysis
 */
export async function fetchAndStoreEmails(token, timeFilter = 'week', readFilter = 'all') {
  try {
    const messages = await fetchEmails(token, timeFilter, readFilter);
    
    // Fetch full content for each message ID
    let emailPromises = messages.map(msg => fetchEmailContent(token, msg.id));
    const fullEmails = await Promise.all(emailPromises);
    const validEmails = fullEmails.filter(email => email !== null);
    
    // Store emails in storage systems
    await storeEmails(validEmails);
    chrome.storage.local.set({ emails: validEmails }, () => {
      console.log("Emails stored in Chrome Storage.");
    });
    
    // Extract contacts for future use
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
    
    const knownContacts = Array.from(contactsMap.entries()); // [name, email]
    chrome.storage.local.set({ knownContacts });
    
    return {
      emails: validEmails,
      contacts: knownContacts,
      count: validEmails.length
    };
  } catch (error) {
    console.error("Error fetching and storing emails:", error);
    throw error;
  }
} 
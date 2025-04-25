// Authenticate user and get OAuth token
export function authenticateUser(callback) {
    chrome.identity.getAuthToken({ 
      interactive: true,
      scopes: [
        
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/gmail.send"
      ]
      
    }, function (token) {
      if (chrome.runtime.lastError) {
        console.error("Authentication failed:", chrome.runtime.lastError);
        return;
      }
      console.log("User authenticated. Token received successfully.");
      callback(token);
    });
}

// Force re-authentication by removing tokens and getting a fresh one
export function forceReauthenticate(callback) {
    console.log("🔄 Forcing re-authentication...");
    
    // First clear any cached tokens
    chrome.identity.clearAllCachedAuthTokens(() => {
        console.log("🧹 Cleared all cached auth tokens");
        
        // Now request a new token with all required scopes
        chrome.identity.getAuthToken({ 
            interactive: true,
            scopes: [
                "https://www.googleapis.com/auth/gmail.readonly",
                "https://www.googleapis.com/auth/userinfo.email",
                "https://www.googleapis.com/auth/calendar",
                "https://www.googleapis.com/auth/calendar.events"
            ]
        }, function (token) {
            if (chrome.runtime.lastError) {
                console.error("❌ Re-authentication failed:", chrome.runtime.lastError);
                if (callback) callback(null);
                return;
            }
            
            console.log("✅ Re-authentication successful");
            if (callback) callback(token);
        });
    });
}
/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const { onValueCreated, onValueUpdated, onValueDeleted } = require("firebase-functions/v2/database");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { DateTime } = require('luxon');
const { getMedia, sendMediaToTG, sendTelegramMessage, telegramWebhook, sendHostToGroup } = require("./telegram");
const { messages } = require("./messages");
const { labels } = require("./labels");
admin.initializeApp();

// Telegram bot configuration
const CHAT_IDS = [
  "-1002673859693", // https://t.me/pomchatdev
  "-1002412279665", // https://t.me/pomchatpop
  "-1002642186417", // https://t.me/pomchatvip
  "-1002603412953", // https://t.me/pomchatlive
  "-1002560028339", // https://t.me/pomchat
  "-1002559668222", // https://t.me/pombabe
  "-1002307647703", // https://t.me/pomchat06
]; 

const db = admin.database();

// Helper function to get today's date string in YYYY-MM-DD format
const getTodayDateStr = () => DateTime.now().setZone('America/Vancouver').toISODate();

// Helper function to get current time in Vancouver timezone
const getVancouverTime = () => DateTime.now().setZone('America/Vancouver').toMillis();

// Helper function to calculate duration in minutes
const calculateDuration = (startTime) => Math.round((getVancouverTime() - startTime) / 60000);

// Helper function to log session data
const logSessionData = (userId, action, data = {}) => {
  console.log(`[${action}] User: ${userId}`, data);
};

// Helper function to get or initialize daily stats
const getDailyStats = async (dateStr, userId, defaultData = {}) => {
  const dailyStatsRef = db.ref(`/dailyStats/${dateStr}/${userId}`);
  const dailyStats = await dailyStatsRef.once('value');
  return dailyStats.val() || {
    totalTime: 0,
    sessions: 0,
    nickname: defaultData.nickname || '',
    platform: defaultData.platform || '',
    status: defaultData.status || '',
    lastSeen: getVancouverTime(),
    ...defaultData
  };
};

// Helper function to update daily stats
const updateDailyStats = async (dateStr, userId, updateData) => {
  const dailyStatsRef = db.ref(`/dailyStats/${dateStr}/${userId}`);
  await dailyStatsRef.update(updateData);
};

// Helper function to validate session data
const validateSessionData = (sessionData, action) => {
  if (!sessionData || !sessionData.loginAt) {
    logSessionData('UNKNOWN', `${action}_NO_DATA`);
    return false;
  }

  return true;
};

// Helper function to create session data
const createSessionData = (userData, now) => {
  const { nickname, status, platform } = userData;
  return {
    loginAt: now,
    nickname,
    status,
    platform,
    lastSeen: now
  };
};

// Simple HTTP function to test if Firebase Functions is working
exports.testHttpFunction = onRequest((request, response) => {
  console.log("HTTP function called!");
  console.log("Request method:", request.method);
  console.log("Request body:", request.body);
  console.log("Request query:", request.query);

  // Set CORS headers
  response.set('Access-Control-Allow-Origin', '*');
  response.set('Access-Control-Allow-Methods', 'GET, POST');
  response.set('Access-Control-Allow-Headers', 'Content-Type');

  response.json({
    message: "Hello from Firebase Functions!",
    timestamp: Date.now(),
    method: request.method,
    body: request.body,
    query: request.query,
    success: true
  });
});

// HTTP function that writes to database
exports.writeToDatabase = onRequest(async (request, response) => {
  console.log("Write to database function called!");

  try {
    const testData = {
      message: "Test data from HTTP function",
      timestamp: Date.now(),
      source: "HTTP function"
    };

    // Write to database
    await db.ref('/testData').push(testData);

    console.log("Data written to database successfully");

    response.json({
      success: true,
      message: "Data written to database",
      data: testData
    });
  } catch (error) {
    console.error("Error writing to database:", error);
    response.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// HTTP function to add/update user status
exports.addUserStatus = onRequest(async (request, response) => {
  try {
    const userId = request.query.userId || 'user123';
    const userData = {
      nickname: request.query.nickname || 'TestUser',
      status: request.query.status || 'online',
      platform: request.query.platform || 'web',
      lastSeen: getVancouverTime()
    };

    await db.ref(`/status/${userId}`).set(userData);
    logSessionData(userId, 'STATUS_ADDED', userData);

    response.json({
      success: true,
      message: `User status added for ${userId}`,
      data: userData
    });
  } catch (error) {
    console.error("Error adding user status:", error);
    response.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Track when a user comes online
exports.trackUserSessionCreate = onValueCreated("/status/{userId}", async (event) => {
  const userId = event.params.userId;
  const now = getVancouverTime();
  const dateStr = getTodayDateStr();

  // Get user data and create session data
  const userData = event.data.val();
  const sessionData = createSessionData(userData, now);

  // Validate session data
  if (!validateSessionData(sessionData, 'SESSION_START')) {
    return null;
  }


  // Save to active sessions
  await db.ref(`/activeSessions/${userId}`).set(sessionData);

  // Get current daily stats and update them
  const currentStats = await getDailyStats(dateStr, userId, {
    nickname: sessionData.nickname,
    platform: sessionData.platform,
    status: sessionData.status
  });

  await updateDailyStats(dateStr, userId, {
    nickname: sessionData.nickname || currentStats.nickname,
    platform: sessionData.platform || currentStats.platform,
    totalTime: currentStats.totalTime || 0,
    sessions: (currentStats.sessions || 0) + 1,
    lastSeen: now,
    status: sessionData.status || currentStats.status
  });


  // logSessionData('SESSION_STARTED', userId, sessionData);
  // console.log("xxxxxxxxxxxxxxxxxxxxxxxsessionData.status", userId, sessionData.status);
  // //send host to tg group
  // if (sessionData.status === "b") {
  //   // Check if user was recently online (within 5 minutes)
  //   const activeSessionRef = db.ref(`/activeSessions/${userId}`);
  //   // const activeSession = await activeSessionRef.once('value');
  //   // const existingSession = activeSession.val();
  //   // const fiveMinutesAgo = getVancouverTime() - (5 * 60 * 1000); // 5 minutes in milliseconds
  //   // const wasRecentlyOnline = existingSession && existingSession.lastSeen > fiveMinutesAg
  //   // if (!wasRecentlyOnline) {
  //   // // if (true) {
  //   //   console.log("xxxxxxxxxxxxxxxxxxxxxxxuserId", userId);
  //   //   const media = await getMedia(userId);
  //   //   if (media) {
  //   //     const caption = `🎉 ${sessionData.nickname} is LIVE now!🔥📽️\n\n ${messages[Math.floor(Math.random() * messages.length)]} \n\n ${labels[Math.floor(Math.random() * labels.length)]}`;
  //   //     const sendPromises = CHAT_IDS.map(async (chatId) => {
  //   //       console.log("xxxxxxxxxxxxxxxxxxxxxxxchatId", chatId);
  //   //       const result = await sendMediaToTG(media.path, media.type, chatId, caption);
  //   //       if (result.success) {
  //   //         logger.info(`✅ Successfully sent media for user ${userId} to Telegram chat ${chatId}`);
  //   //         return { success: true, chatId };
  //   //       } else {
  //   //         logger.error(`❌ Failed to send media for user ${userId} to chat ${chatId}:`, result.error);
  //   //         return { success: false, chatId, error: result.error };
  //   //       }
  //   //     });

  //   //     const results = await Promise.all(sendPromises);
  //   //     const successCount = results.filter(r => r.success).length;
  //   //     const errorCount = results.filter(r => !r.success).length;
        
  //   //     if (errorCount === 0) {
  //   //       logger.info(`✅ Successfully sent media for user ${userId} to all ${successCount} Telegram chats`);
  //   //     } else {
  //   //       logger.error(`❌ Failed to send media for user ${userId} to ${errorCount} chats, succeeded: ${successCount}`);
  //   //     }
  //   //   }
  //   // } else {
  //   //   console.log(`User ${userId} was recently online (within 5 minutes), skipping media send`);
  //   // }
  // }
  // Send notification to Telegram group  

  return null;
});

// Track when a user goes offline
exports.trackUserSessionDelete = onValueDeleted("/status/{userId}", async (event) => {
  const userId = event.params.userId;
  const now = getVancouverTime();
  const dateStr = getTodayDateStr();

  // Get active session data
  const activeSessionRef = db.ref(`/activeSessions/${userId}`);
  const activeSession = await activeSessionRef.once('value');
  const sessionData = activeSession.val();

  if (!sessionData || !sessionData.loginAt) {
    logSessionData(userId, 'SESSION_ENDED_NO_DATA');
    return null;
  }

  // If host, don't update daily stats
  if (sessionData.status === "b") return null;

  // Calculate session duration
  const duration = calculateDuration(sessionData.loginAt);

  // Update daily stats
  const dailyStatsRef = db.ref(`/dailyStats/${dateStr}/${userId}`);
  const dailyStats = await dailyStatsRef.once('value');
  const currentStats = dailyStats.val() || {
    totalTime: 0,
    sessions: 0,
    nickname: sessionData.nickname,
    platform: sessionData.platform,
    status: sessionData.status,
    lastSeen: now
  };

  const newTotalTime = (currentStats.totalTime || 0) + duration;

  await dailyStatsRef.update({
    nickname: sessionData.nickname,
    platform: sessionData.platform,
    totalTime: newTotalTime,
    lastSessionDuration: duration,
    lastSeen: now,
    status: sessionData.status
  });

  // Remove from active sessions
  await activeSessionRef.remove();

  logSessionData(userId, 'SESSION_ENDED', {
    duration,
    totalTime: newTotalTime
  });

  return null;
});

// Telegram bot webhook !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! important
// exports.telegramWebhook = onRequest((req, res) => {
//   logger.info("📥 Telegram Update:", req.body);

//   const chat = req.body?.message?.chat;
//   const message = req.body?.message?.text;
//   const from = req.body?.message?.from;

//   if (chat) {
//     logger.info(`📢 Chat ID: ${chat.id}`);
//     logger.info(`💬 Chat Type: ${chat.type}`);
//     logger.info(`📝 Chat Title: ${chat.title || 'Private Chat'}`);
//   }

//   if (from) {
//     logger.info(`👤 From User: ${from.first_name} ${from.last_name || ''} (ID: ${from.id})`);
//     logger.info(`🔗 Username: @${from.username || 'No username'}`);
//   }

//   if (message) {
//     logger.info(`💭 Message: "${message}"`);
//   }

//   res.sendStatus(200);
// });


// Test function to manually trigger the scheduled logic
exports.testScheduledFunction = onRequest(async (req, res) => {
  try {
    logger.info("🧪 Test function triggered - getting random user");

    // Get all users from status
    const statusRef = db.ref('/status');
    const statusSnapshot = await statusRef.once('value');
    const allUsers = statusSnapshot.val();

    if (!allUsers) {
      logger.info("❌ No users found in status");
      res.status(200).json({ success: false, message: "No users found" });
      return;
    }

    // Convert to array and filter for hosts (status "b")
    const userEntries = Object.entries(allUsers);
    const hostUsers = userEntries.filter(([userId, userData]) => userData.status === "b");

    if (hostUsers.length === 0) {
      logger.info("❌ No host users found");
      res.status(200).json({ success: false, message: "No host users found" });
      return;
    }

    // Select random user
    const randomIndex = Math.floor(Math.random() * hostUsers.length);
    const [randomUserId, randomUserData] = hostUsers[randomIndex];

    logger.info(`🎲 Selected random user: ${randomUserId} (${randomUserData.nickname})`);

    // Get media for the random user (using userId as account_id)
    const media = await getMedia(randomUserId);
    if (!media) {
      logger.info(`❌ No media found for user ${randomUserId}`);
      res.status(200).json({ success: false, message: "No media found" });
      return;
    }

    // Send media to Telegram
    const caption = `🎉 ${randomUserData.nickname} is LIVE now! 🔥\n\n ${messages[Math.floor(Math.random() * messages.length)]} \n\n ${labels[Math.floor(Math.random() * labels.length)]}`;
    
    const sendPromises = CHAT_IDS.map(async (chatId) => {
      console.log("xxxxxxxxxxxxxxxxxxxxxxxchatId", chatId);
      const result = await sendMediaToTG(media.path, media.type, chatId, caption);
      if (result.success) {
        logger.info(`✅ Successfully sent media for user ${randomUserId} to Telegram chat ${chatId}`);
        return { success: true, chatId };
      } else {
        logger.error(`❌ Failed to send media for user ${randomUserId} to chat ${chatId}:`, result.error);
        return { success: false, chatId, error: result.error };
      }
    });

    const results = await Promise.all(sendPromises);
    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;
    
    if (errorCount === 0) {
      logger.info(`✅ Successfully sent media for user ${randomUserId} to all ${successCount} Telegram chats`);
      res.status(200).json({
        success: true,
        message: "Media sent successfully",
        user: {
          id: randomUserId,
          nickname: randomUserData.nickname,
          userId: randomUserId
        },
        media: {
          path: media.path,
          type: media.type
        }
      });
    } else {
      logger.error(`❌ Failed to send media for user ${randomUserId} to ${errorCount} chats, succeeded: ${successCount}`);
      res.status(500).json({ success: false, message: "Failed to send media to some chats", errorCount, successCount });
    }

  } catch (error) {
    logger.error("❌ Error in test function:", error);
    res.status(500).json({ success: false, message: "Error occurred", error: error.message });
  }
});

// Cloud Scheduler function that runs every 1 minute (minimum supported interval)
// Note: Cloud Scheduler doesn't support intervals shorter than 1 minute
exports.scheduledRandomUserMedia = onSchedule({
  schedule: "every 1 minutes", 
  timeZone: "America/Vancouver"
}, async (event) => {
  try {
    logger.info("🕐 Scheduled function triggered - getting random user");

    // Get all users from status
    const statusRef = db.ref('/status');
    const statusSnapshot = await statusRef.once('value');
    const allUsers = statusSnapshot.val();

    if (!allUsers) {
      logger.info("❌ No users found in status");
      return;
    }

    // Convert to array and filter out hosts (status "b")
    const userEntries = Object.entries(allUsers);
    const nonHostUsers = userEntries.filter(([userId, userData]) => userData.status === "b");

    if (nonHostUsers.length === 0) {
      logger.info("❌ No host users found");
      return;
    }

    // Select random user
    const randomIndex = Math.floor(Math.random() * nonHostUsers.length);
    const [randomUserId, randomUserData] = nonHostUsers[randomIndex];

    logger.info(`🎲 Selected random user: ${randomUserId} (${randomUserData.nickname})`);

    // Get media for the random user (using userId as account_id)
    const media = await getMedia(randomUserId);
    if (!media) {
      logger.info(`❌ No media found for user ${randomUserId}`);
      return;
    }

    // Send media to Telegram
    const caption = `🎉 ${randomUserData.nickname} is LIVE now! 🔥\n\n ${messages[Math.floor(Math.random() * messages.length)]} \n\n ${labels[Math.floor(Math.random() * labels.length)]}`;
    
    const sendPromises = CHAT_IDS.map(async (chatId) => {
      console.log("xxxxxxxxxxxxxxxxxxxxxxxchatId", chatId);
      const result = await sendMediaToTG(media.path, media.type, chatId, caption);
      if (result.success) {
        logger.info(`✅ Successfully sent media for user ${randomUserId} to Telegram chat ${chatId}`);
        return { success: true, chatId };
      } else {
        logger.error(`❌ Failed to send media for user ${randomUserId} to chat ${chatId}:`, result.error);
        return { success: false, chatId, error: result.error };
      }
    });

    const results = await Promise.all(sendPromises);
    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;
    
    if (errorCount === 0) {
      logger.info(`✅ Successfully sent media for user ${randomUserId} to all ${successCount} Telegram chats`);
    } else {
      logger.error(`❌ Failed to send media for user ${randomUserId} to ${errorCount} chats, succeeded: ${successCount}`);
    }

  } catch (error) {
    logger.error("❌ Error in scheduled function:", error);
  }
});

exports.testSendAd = onRequest(async (req, res) => {
  try {
    const caption = `❤️ 1on1 Video Chat 💋

  ⏺️ White Black Asian girls
  ⏺️ students, accountants, teachers, nurses, part-time worker 
  ⏺️ AI voice translator

💋 Alive AI Girlfriend
⏺️ Every AI is based on a real hostess you can Video Call

🔥 Exclusive videos and photos of the hosts

You'll always find one you like!`;
    
    const sendPromises = CHAT_IDS.map(async (chatId) => {
      console.log("xxxxxxxxxxxxxxxxxxxxxxxchatId", chatId);
      const result = await sendMediaToTG("https://pomchat.live/ad.jpg", 1, chatId, caption);
      if (result.success) {
        logger.info(`✅ Successfully sent ad to Telegram chat ${chatId}`);
        return { success: true, chatId };
      } else {
        logger.error(`❌ Failed to send ad to chat ${chatId}:`, result.error);
        return { success: false, chatId, error: result.error };
      }
    });

    const results = await Promise.all(sendPromises);
    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;
    
    if (errorCount === 0) {
      logger.info("✅ Successfully sent ad to all Telegram chats");
      res.status(200).json({ success: true, message: `Ad sent successfully to ${successCount} chats` });
    } else {
      logger.error(`❌ Failed to send ad to ${errorCount} chats`);
      res.status(500).json({ success: false, message: `Failed to send ad to ${errorCount} chats`, successCount, errorCount });
    }
  } catch (error) {
    logger.error("❌ Error in testSendAd:", error);
    res.status(500).json({ success: false, message: "Error occurred", error: error.message });
  }
});

//send ad to tg group
exports.scheduledSendAd = onSchedule({
  schedule: "every 13 minutes", 
  timeZone: "America/Vancouver"
}, async (event) => {
  try {
    const caption = `❤️ 1on1 Video Chat 💋

  ⏺️ White Black Asian girls
  ⏺️ students, accountants, teachers, nurses, part-time worker 
  ⏺️ AI voice translator

💋 Alive AI Girlfriend
⏺️ Every AI is based on a real hostess you can Video Call

🔥 Exclusive videos and photos of the hosts

You'll always find one you like!`;
    
    const sendPromises = CHAT_IDS.map(async (chatId) => {
      console.log("xxxxxxxxxxxxxxxxxxxxxxxchatId", chatId);
      const result = await sendMediaToTG("https://pomchat.live/ad.jpg", 1, chatId, caption);
      if (result.success) {
        logger.info(`✅ Successfully sent ad to Telegram chat ${chatId}`);
        return { success: true, chatId };
      } else {
        logger.error(`❌ Failed to send ad to chat ${chatId}:`, result.error);
        return { success: false, chatId, error: result.error };
      }
    });

    const results = await Promise.all(sendPromises);
    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;
    
    if (errorCount === 0) {
      logger.info(`✅ Successfully sent ad to all ${successCount} Telegram chats`);
    } else {
      logger.error(`❌ Failed to send ad to ${errorCount} chats, succeeded: ${successCount}`);
    }

  } catch (error) {
    logger.error("❌ Error in scheduledSendAd:", error);
  }
});

// Export Telegram functions
// exports.telegramWebhook = onRequest(telegramWebhook);  //to find out chat id, use ngork for local
exports.sendHostToGroup = onRequest(sendHostToGroup);
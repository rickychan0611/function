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
const { chinese_messages } = require("./chinese_message");
const { chinese_labels } = require("./chinese_label");

admin.initializeApp();

// Telegram bot configuration
const CHAT_IDS = [
  { chatId: "-1002673859693", inviteCode: "pomchatpopbot", isChinese: false },
  { chatId: "-1002412279665", inviteCode: "pomchatpopbot", isChinese: false },
  { chatId: "-1002642186417", inviteCode: "pomchatvipbot", isChinese: false },
  { chatId: "-1002603412953", inviteCode: "pomchatlivebot", isChinese: false},
  { chatId: "-1002559668222", inviteCode: "pombabe", isChinese: false },
  { chatId: "-1002307647703", inviteCode: "pomchat06bot", isChinese: false },
  { chatId: "-1002388447971", inviteCode: "pomchatus", isChinese: false },
  // { chatId: "-1002814655337", inviteCode: "pomchatvvip", isChinese: false },
  // { chatId: "-1002560028339", inviteCode: "pomchat", isChinese: false },
]
const blackList = [
  "6cfbfe70-e65f-4e53-8bb3-c806b75da1bb",
  "0b018e2d-360c-4919-a81c-d8c733a27b59"
]

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
exports.telegramWebhook = onRequest((req, res) => {
  logger.info("📥 Telegram Update:", req.body);

  const chat = req.body?.message?.chat;
  const message = req.body?.message?.text;
  const from = req.body?.message?.from;

  if (chat) {
    logger.info(`📢 Chat ID: ${chat.id}`);
    logger.info(`💬 Chat Type: ${chat.type}`);
    logger.info(`📝 Chat Title: ${chat.title || 'Private Chat'}`);
  }

  if (from) {
    logger.info(`👤 From User: ${from.first_name} ${from.last_name || ''} (ID: ${from.id})`);
    logger.info(`🔗 Username: @${from.username || 'No username'}`);
  }

  if (message) {
    logger.info(`💭 Message: "${message}"`);
  }

  res.sendStatus(200);
});


// Test function to manually trigger the scheduled logic
exports.testScheduledFunction = onRequest(async (req, res) => {
  try {
    logger.info("🧪 Test function triggered - getting random user");

    // Get chatId from query parameter, default to first chat in CHAT_IDS
    const chatId = req.query.chatId || CHAT_IDS[0].chatId;
    logger.info(`📱 Target chat ID: ${chatId}`);

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
    const hostUsers = userEntries.filter(([userId, userData]) => userData && userData.status === "b");

    if (hostUsers.length === 0) {
      logger.info("❌ No host users found");
      res.status(200).json({ success: false, message: "No host users found" });
      return;
    }

    // Try up to 5 users to find one with media
    const maxAttempts = Math.min(5, hostUsers.length);
    let selectedUser = null;
    let selectedMedia = null;
    let attempts = 0;
    let triedUsers = new Set(); // Track tried users

    for (let i = 0; i < maxAttempts; i++) {
      // Filter out already tried users
      const availableUsers = hostUsers.filter(([userId]) => !triedUsers.has(userId));

      if (availableUsers.length === 0) {
        logger.info("❌ No more users to try");
        break;
      }

      // Select random user from remaining users
      const randomIndex = Math.floor(Math.random() * availableUsers.length);
      const [randomUserId, randomUserData] = availableUsers[randomIndex];

      attempts++;
      logger.info(`🎲 Attempt ${attempts}: Trying user ${randomUserId} (${randomUserData.nickname})`);

      // Get media for the random user
      const media = await getMedia(randomUserId);
      if (media) {
        selectedUser = { userId: randomUserId, userData: randomUserData };
        selectedMedia = media;
        logger.info(`✅ Found media for user ${randomUserId} on attempt ${attempts}`);
        break;
      } else {
        logger.info(`❌ No media found for user ${randomUserId}, trying next user...`);
        triedUsers.add(randomUserId); // Mark as tried
      }
    }

    if (!selectedUser || !selectedMedia) {
      logger.info(`❌ No media found after trying ${attempts} users`);
      res.status(200).json({
        success: false,
        message: `No media found after trying ${attempts} users`,
        attempts: attempts
      });
      return;
    }

    // Send media to specific chat
    const caption = CHAT_IDS.find(c => c.chatId === chatId)?.isChinese ?
      `🎉 ${selectedUser.userData.nickname} 在线! 💋🔥  真人女孩  💃👀\n\n ${chinese_messages[Math.floor(Math.random() * chinese_messages.length)]} \n\n ${chinese_labels[Math.floor(Math.random() * chinese_labels.length)]}` :
      `🎉 ${selectedUser.userData.nickname} is LIVE now!  💋🔥  Real girl  💃👀\n\n ${messages[Math.floor(Math.random() * messages.length)]} \n\n ${labels[Math.floor(Math.random() * labels.length)]}`;

    const result = await sendMediaToTG(selectedMedia.path, selectedMedia.type, chatId, caption, CHAT_IDS.find(c => c.chatId === chatId)?.isChinese, CHAT_IDS.find(c => c.chatId === chatId)?.inviteCode);
    if (result.success) {
      logger.info(`✅ Successfully sent media for user ${selectedUser.userId} to Telegram chat ${chatId}`);
      res.status(200).json({
        success: true,
        message: "Media sent successfully",
        attempts: attempts,
        targetChatId: chatId,
        user: {
          id: selectedUser.userId,
          nickname: selectedUser.userData.nickname,
          userId: selectedUser.userId
        },
        media: {
          path: selectedMedia.path,
          type: selectedMedia.type
        }
      });
    } else {
      logger.error(`❌ Failed to send media for user ${selectedUser.userId} to chat ${chatId}:`, result.error);
      res.status(500).json({
        success: false,
        message: "Failed to send media",
        targetChatId: chatId,
        error: result.error
      });
    }

  } catch (error) {
    logger.error("❌ Error in test function:", error);
    res.status(500).json({ success: false, message: "Error occurred", error: error.message });
  }
});

// Cloud Scheduler function that runs every 1 minute
exports.scheduledRandomUserMedia = onSchedule({
  schedule: "every 15 minutes",
  timeZone: "America/Vancouver"
}, async (event) => {
  try {
    logger.info("🕐 Scheduled function triggered - cycling through users");

    // Check if function is already running (simple lock)
    const lockRef = db.ref('/scheduledFunctionLock');
    const lockSnapshot = await lockRef.once('value');
    const lockData = lockSnapshot.val();

    if (lockData && lockData.isRunning && (getVancouverTime() - lockData.timestamp) < 60000) {
      logger.info("⚠️ Function already running, skipping this execution");
      return;
    }

    // Set lock
    await lockRef.set({
      isRunning: true,
      timestamp: getVancouverTime()
    });

    try {
      // Get current snapshot of users
      const statusRef = db.ref('/status');
      const statusSnapshot = await statusRef.once('value');
      const allUsers = statusSnapshot.val();

      if (!allUsers) {
        logger.info("❌ No users found in status");
        return;
      }

      // Convert to array and filter for hosts (status "b")
      const userEntries = Object.entries(allUsers);
      const hostUsers = userEntries.filter(([userId, userData]) => userData && userData.status === "b");

      if (hostUsers.length === 0) {
        logger.info("❌ No host users found");
        return;
      }

      // Get current snapshot and counter from database
      const snapshotRef = db.ref('/scheduledUserSnapshot');
      const counterRef = db.ref('/scheduledUserCounter');

      const [snapshotData, counterData] = await Promise.all([
        snapshotRef.once('value'),
        counterRef.once('value')
      ]);

      let currentSnapshot = snapshotData.val();
      let currentIndex = counterData.val() || 0;

      // Check if we need a new snapshot (only if no snapshot exists)
      const currentSnapshotIds = currentSnapshot ? Object.keys(currentSnapshot) : [];
      const currentHostIds = hostUsers.map(([userId]) => userId);

      const needsNewSnapshot = !currentSnapshot;

      if (needsNewSnapshot) {
        logger.info("📸 Taking new snapshot of host users");

        // Create new snapshot with user IDs and data
        const newSnapshot = {};
        hostUsers.forEach(([userId, userData]) => {
          newSnapshot[userId] = {
            nickname: userData.nickname,
            status: userData.status,
            platform: userData.platform,
            timestamp: getVancouverTime()
          };
        });

        // Save new snapshot and reset counter
        await Promise.all([
          snapshotRef.set(newSnapshot),
          counterRef.set(0)
        ]);

        currentSnapshot = newSnapshot;
        currentIndex = 0;

        logger.info(`📸 New snapshot created with ${Object.keys(newSnapshot).length} users`);
      }

      // Get current user from snapshot
      const snapshotUserIds = Object.keys(currentSnapshot);
      if (snapshotUserIds.length === 0) {
        logger.info("❌ No users in snapshot");
        return;
      }

      // Ensure index is within bounds
      if (currentIndex >= snapshotUserIds.length) {
        currentIndex = 0; // Reset to first user
      }

      // Get the current user
      const currentUserId = snapshotUserIds[currentIndex];
      const currentUserData = currentSnapshot[currentUserId];

      logger.info(`🎯 Selected user ${currentIndex + 1}/${snapshotUserIds.length}: ${currentUserId} (${currentUserData.nickname})`);

      // Get media for the current user
      const media = await getMedia(currentUserId);
      if (!media) {
        logger.info(`❌ No media found for user ${currentUserId}`);
        // Move to next user even if no media
        await counterRef.set((currentIndex + 1) % snapshotUserIds.length);
        return;
      }

      // Send media to Telegram
      const sendPromises = CHAT_IDS.map(async (chat) => {
        // Determine if this is a Chinese chat

        // Generate caption based on the specific chat ID
        const caption = chat.isChinese ?
          `🎉 ${currentUserData.nickname} 在线! 💋🔥  真人女孩  💃👀\n\n ${chinese_messages[Math.floor(Math.random() * chinese_messages.length)]} \n\n ${chinese_labels[Math.floor(Math.random() * chinese_labels.length)]}` :
          `🎉 ${currentUserData.nickname} is LIVE now! 💋🔥  Real girl  💃👀\n\n ${messages[Math.floor(Math.random() * messages.length)]} \n\n ${labels[Math.floor(Math.random() * labels.length)]}`;

        const result = await sendMediaToTG(media.path, media.type, chat.chatId, caption, chat.isChinese, chat.inviteCode);
        if (result.success) {
          logger.info(`✅ Successfully sent media for user ${currentUserId} to Telegram chat ${chat.chatId}`);
          return { success: true, chatId: chat.chatId };
        } else {
          logger.error(`❌ Failed to send media for user ${currentUserId} to chat ${chat.chatId}:`, result.error);
          return { success: false, chatId: chat.chatId, error: result.error };
        }
      });

      const results = await Promise.all(sendPromises);
      const successCount = results.filter(r => r.success).length;
      const errorCount = results.filter(r => !r.success).length;

      if (errorCount === 0) {
        logger.info(`✅ Successfully sent media for user ${currentUserId} to all ${successCount} Telegram chats`);
      } else {
        logger.error(`❌ Failed to send media for user ${currentUserId} to ${errorCount} chats, succeeded: ${successCount}`);
      }

      // Move to next user (cycle back to 0 if at end)
      const nextIndex = (currentIndex + 1) % snapshotUserIds.length;
      await counterRef.set(nextIndex);

      // If we've completed the cycle, create a new snapshot for next cycle
      if (nextIndex === 0) {
        logger.info("🔄 Completed cycle through all users in snapshot");

        // Always create new snapshot after completing a cycle
        logger.info("📸 Creating new snapshot for next cycle");

        // Create new snapshot with current host users
        const newSnapshot = {};
        hostUsers.forEach(([userId, userData]) => {
          newSnapshot[userId] = {
            nickname: userData.nickname,
            status: userData.status,
            platform: userData.platform,
            timestamp: getVancouverTime()
          };
        });

        // Save new snapshot (counter will start at 0 on next run)
        await snapshotRef.set(newSnapshot);
        logger.info(`📸 New snapshot created with ${Object.keys(newSnapshot).length} users for next cycle`);
      }

      logger.info(`🔄 Next user index: ${nextIndex}`);

    } finally {
      // Release lock
      await lockRef.set({
        isRunning: false,
        timestamp: getVancouverTime()
      });
    }

  } catch (error) {
    logger.error("❌ Error in scheduled function:", error);
    // Release lock on error
    try {
      await db.ref('/scheduledFunctionLock').set({
        isRunning: false,
        timestamp: getVancouverTime()
      });
    } catch (lockError) {
      logger.error("❌ Error releasing lock:", lockError);
    }
  }
});

exports.testSendAd = onRequest(async (req, res) => {
  try {
    const sendPromises = CHAT_IDS.map(async (chat) => {

      // Generate caption based on language
      const caption = chat.isChinese ?
        `❤️ 1v1视频聊天 💋

  ⏺️ 白人 黑人 亚洲女孩
  ⏺️ 学生、会计师、教师、护士、兼职工作者
  ⏺️ AI语音翻译

💋 真人AI女友
⏺️ 每个AI都基于一个真人主播你可以1v1视频通话

🔥 主播的独家视频和照片

你总能找到一个你喜欢的！` :
        `❤️ 1on1 Video Chat 💋

  ⏺️ White Black Asian girls
  ⏺️ students, accountants, teachers, nurses, part-time worker 
  ⏺️ AI voice translator

💋 Alive AI Girlfriend
⏺️ Every AI is based on a real hostess you can Video Call

🔥 Exclusive videos and photos of the hosts

You'll always find one you like!`;

      const result = await sendMediaToTG("https://pomchat.live/ad.jpg", 1, chat.chatId, caption, chat.isChinese, chat.inviteCode);
      if (result.success) {
        logger.info(`✅ Successfully sent ad to Telegram chat ${chat.chatId}`);
        return { success: true, chatId: chat.chatId };
      } else {
        logger.error(`❌ Failed to send ad to chat ${chat.chatId}:`, result.error);
        return { success: false, chatId: chat.chatId, error: result.error };
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
    const sendPromises = CHAT_IDS.map(async (chat) => {
      // Determine if this is a Chinese chat

      // Generate caption based on language
      const caption = chat.isChinese ?
        `❤️ 1v1视频聊天 💋

  ⏺️ 白人 黑人 亚洲女孩
  ⏺️ 学生、会计师、教师、护士、兼职工作者
  ⏺️ AI语音翻译

💋 真人AI女友
⏺️ 每个AI都基于一个真人主播你可以1v1视频通话

🔥 主播的独家视频和照片

你总能找到一个你喜欢的！` :
        `❤️ 1on1 Video Chat 💋

  ⏺️ White Black Asian girls
  ⏺️ students, accountants, teachers, nurses, part-time worker 
  ⏺️ AI voice translator

💋 Alive AI Girlfriend
⏺️ Every AI is based on a real hostess you can Video Call

🔥 Exclusive videos and photos of the hosts

You'll always find one you like!`;

      const result = await sendMediaToTG("https://pomchat.live/ad.jpg", 1, chat.chatId, caption, chat.isChinese, chat.inviteCode);
      if (result.success) {
        logger.info(`✅ Successfully sent ad to Telegram chat ${chat.chatId}`);
        return { success: true, chatId: chat.chatId };
      } else {
        logger.error(`❌ Failed to send ad to chat ${chat.chatId}:`, result.error);
        return { success: false, chatId: chat.chatId, error: result.error };
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

// Test function to send audio with photo
// exports.testSendAudioWithPhoto = onRequest(async (req, res) => {
//   try {
//     const caption = `❤️ 1on1 Video Chat 💋

//   ⏺️ White Black Asian girls
//   ⏺️ students, accountants, teachers, nurses, part-time worker 
//   ⏺️ AI voice translator

// 💋 Alive AI Girlfriend
// ⏺️ Every AI is based on a real hostess you can Video Call

// 🔥 Exclusive videos and photos of the hosts

// You'll always find one you like!`;

//     // Example URLs - replace with your actual photo and audio URLs
//     const photoUrl = "https://pomchat.live/ad.jpg";
//     const audioUrl = "https://example.com/audio.mp3"; // Replace with your audio URL

//     const sendPromises = CHAT_IDS.map(async (chatId) => {
//       console.log("xxxxxxxxxxxxxxxxxxxxxxxchatId", chatId);
//       const result = await sendAudioWithPhotoToTG(photoUrl, audioUrl, chatId, caption);
//       if (result.success) {
//         logger.info(`✅ Successfully sent audio with photo to Telegram chat ${chatId}`);
//         return { success: true, chatId };
//       } else {
//         logger.error(`❌ Failed to send audio with photo to chat ${chatId}:`, result.error);
//         return { success: false, chatId, error: result.error };
//       }
//     });

//     const results = await Promise.all(sendPromises);
//     const successCount = results.filter(r => r.success).length;
//     const errorCount = results.filter(r => !r.success).length;

//     if (errorCount === 0) {
//       logger.info("✅ Successfully sent audio with photo to all Telegram chats");
//       res.status(200).json({ success: true, message: `Audio with photo sent successfully to ${successCount} chats` });
//     } else {
//       logger.error(`❌ Failed to send audio with photo to ${errorCount} chats`);
//       res.status(500).json({ success: false, message: `Failed to send audio with photo to ${errorCount} chats`, successCount, errorCount });
//     }
//   } catch (error) {
//     logger.error("❌ Error in testSendAudioWithPhoto:", error);
//     res.status(500).json({ success: false, message: "Error occurred", error: error.message });
//   }
// });

// Function to reset the user counter and view current status
exports.resetUserCounter = onRequest(async (req, res) => {
  try {
    const action = req.query.action || 'view';

    if (action === 'reset') {
      // Reset counter to 0
      await db.ref('/scheduledUserCounter').set(0);
      logger.info("🔄 User counter reset to 0");
      res.status(200).json({ success: true, message: "User counter reset to 0" });
    } else if (action === 'new-snapshot') {
      // Force a new snapshot
      const statusRef = db.ref('/status');
      const statusSnapshot = await statusRef.once('value');
      const allUsers = statusSnapshot.val();

      if (!allUsers) {
        res.status(200).json({ success: false, message: "No users found in status" });
        return;
      }

      const userEntries = Object.entries(allUsers);
      const hostUsers = userEntries.filter(([userId, userData]) => userData && userData.status === "b");

      if (hostUsers.length === 0) {
        res.status(200).json({ success: false, message: "No host users found" });
        return;
      }

      // Create new snapshot
      const newSnapshot = {};
      hostUsers.forEach(([userId, userData]) => {
        newSnapshot[userId] = {
          nickname: userData.nickname,
          status: userData.status,
          platform: userData.platform,
          timestamp: getVancouverTime()
        };
      });

      // Save new snapshot and reset counter
      await Promise.all([
        db.ref('/scheduledUserSnapshot').set(newSnapshot),
        db.ref('/scheduledUserCounter').set(0)
      ]);

      logger.info(`📸 New snapshot forced with ${Object.keys(newSnapshot).length} users`);
      res.status(200).json({
        success: true,
        message: `New snapshot created with ${Object.keys(newSnapshot).length} users`,
        userCount: Object.keys(newSnapshot).length
      });
    } else {
      // View current status
      const [counterData, snapshotData] = await Promise.all([
        db.ref('/scheduledUserCounter').once('value'),
        db.ref('/scheduledUserSnapshot').once('value')
      ]);

      const currentIndex = counterData.val() || 0;
      const currentSnapshot = snapshotData.val();

      let totalHosts = 0;
      let snapshotInfo = null;

      if (currentSnapshot) {
        totalHosts = Object.keys(currentSnapshot).length;
        snapshotInfo = {
          userCount: totalHosts,
          timestamp: Object.values(currentSnapshot)[0]?.timestamp || 'Unknown',
          users: Object.keys(currentSnapshot).slice(0, 5) // Show first 5 users
        };
      }

      // Get current status for comparison
      const statusRef = db.ref('/status');
      const statusSnapshot = await statusRef.once('value');
      const allUsers = statusSnapshot.val();

      let currentHosts = 0;
      if (allUsers) {
        const userEntries = Object.entries(allUsers);
        const hostUsers = userEntries.filter(([userId, userData]) => userData && userData.status === "b");
        currentHosts = hostUsers.length;
      }

      res.status(200).json({
        success: true,
        currentIndex,
        snapshotHosts: totalHosts,
        currentHosts,
        needsNewSnapshot: totalHosts !== currentHosts,
        snapshotInfo,
        message: `Current index: ${currentIndex}, Snapshot hosts: ${totalHosts}, Current hosts: ${currentHosts}`
      });
    }
  } catch (error) {
    logger.error("❌ Error in resetUserCounter:", error);
    res.status(500).json({ success: false, message: "Error occurred", error: error.message });
  }
});

// Test function to demonstrate snapshot-based user cycling
exports.testSnapshotCycling = onRequest(async (req, res) => {
  try {
    logger.info("🧪 Test snapshot cycling function triggered");

    // Get current snapshot of users
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
    const hostUsers = userEntries.filter(([userId, userData]) => userData && userData.status === "b");

    if (hostUsers.length === 0) {
      logger.info("❌ No host users found");
      res.status(200).json({ success: false, message: "No host users found" });
      return;
    }

    // Create snapshot for testing
    const testSnapshot = {};
    hostUsers.forEach(([userId, userData]) => {
      testSnapshot[userId] = {
        nickname: userData.nickname,
        status: userData.status,
        platform: userData.platform,
        timestamp: getVancouverTime()
      };
    });

    const snapshotUserIds = Object.keys(testSnapshot);

    res.status(200).json({
      success: true,
      message: `Snapshot created with ${snapshotUserIds.length} users`,
      userCount: snapshotUserIds.length,
      users: snapshotUserIds.slice(0, 10), // Show first 10 users
      sampleUser: testSnapshot[snapshotUserIds[0]] || null
    });

  } catch (error) {
    logger.error("❌ Error in testSnapshotCycling:", error);
    res.status(500).json({ success: false, message: "Error occurred", error: error.message });
  }
});

// Export Telegram functions
// exports.telegramWebhook = onRequest(telegramWebhook);  //to find out chat id, use ngork for local
exports.sendHostToGroup = onRequest(sendHostToGroup);
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
    logger.info("🧪 Test function triggered - getting random host ID");

    // Get chatId from query parameter, default to first chat in CHAT_IDS
    const chatId = req.query.chatId || CHAT_IDS[0].chatId;
    logger.info(`📱 Target chat ID: ${chatId}`);

    // Get host IDs from database
    const hostIdsRef = db.ref('/host_ids');
    const hostIdsSnapshot = await hostIdsRef.once('value');
    const hostIdsData = hostIdsSnapshot.val();

    if (!hostIdsData) {
      logger.info("❌ No host IDs found in database");
      res.status(200).json({ success: false, message: "No host IDs found in database" });
      return;
    }

    // Convert host IDs object to array
    const hostIds = Object.keys(hostIdsData);
    
    if (hostIds.length === 0) {
      logger.info("❌ No host IDs found in database");
      res.status(200).json({ success: false, message: "No host IDs found in database" });
      return;
    }

    // Try up to 5 host IDs to find one with media
    const maxAttempts = Math.min(5, hostIds.length);
    let selectedHostId = null;
    let selectedMedia = null;
    let attempts = 0;
    let triedHostIds = new Set(); // Track tried host IDs

    for (let i = 0; i < maxAttempts; i++) {
      // Filter out already tried host IDs
      const availableHostIds = hostIds.filter(hostId => !triedHostIds.has(hostId));

      if (availableHostIds.length === 0) {
        logger.info("❌ No more host IDs to try");
        break;
      }

      // Select random host ID from remaining host IDs
      const randomIndex = Math.floor(Math.random() * availableHostIds.length);
      const randomHostId = availableHostIds[randomIndex];

      attempts++;
      logger.info(`🎲 Attempt ${attempts}: Trying host ID ${randomHostId}`);

      // Get media for the random host ID
      const media = await getMedia(randomHostId);
      if (media) {
        selectedHostId = randomHostId;
        selectedMedia = media;
        logger.info(`✅ Found media for host ID ${randomHostId} on attempt ${attempts}`);
        break;
      } else {
        logger.info(`❌ No media found for host ID ${randomHostId}, trying next host ID...`);
        triedHostIds.add(randomHostId); // Mark as tried
      }
    }

    if (!selectedHostId || !selectedMedia) {
      logger.info(`❌ No media found after trying ${attempts} host IDs`);
      res.status(200).json({
        success: false,
        message: `No media found after trying ${attempts} host IDs`,
        attempts: attempts
      });
      return;
    }

    // Send media to specific chat
    const caption = CHAT_IDS.find(c => c.chatId === chatId)?.isChinese ?
      `🎉 ${selectedMedia.nickname || 'Host'} 在线! 💋🔥  真人女孩  💃👀\n\n ${chinese_messages[Math.floor(Math.random() * chinese_messages.length)]} \n\n ${chinese_labels[Math.floor(Math.random() * chinese_labels.length)]}` :
      `🎉 ${selectedMedia.nickname || 'Host'} is LIVE now!  💋🔥  Real girl  💃👀\n\n ${messages[Math.floor(Math.random() * messages.length)]} \n\n ${labels[Math.floor(Math.random() * labels.length)]}`;

    const result = await sendMediaToTG(selectedMedia.path, selectedMedia.type, chatId, caption, CHAT_IDS.find(c => c.chatId === chatId)?.isChinese, CHAT_IDS.find(c => c.chatId === chatId)?.inviteCode);
    if (result.success) {
      logger.info(`✅ Successfully sent media for host ID ${selectedHostId} to Telegram chat ${chatId}`);
      res.status(200).json({
        success: true,
        message: "Media sent successfully",
        attempts: attempts,
        targetChatId: chatId,
        hostId: selectedHostId,
        media: {
          path: selectedMedia.path,
          type: selectedMedia.type
        }
      });
    } else {
      logger.error(`❌ Failed to send media for host ID ${selectedHostId} to chat ${chatId}:`, result.error);
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
  schedule: "every 7 minutes",
  timeZone: "America/Vancouver"
}, async (event) => {
  try {
    logger.info("🕐 Scheduled function triggered - cycling through host IDs");

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
      // Get host IDs from database
      const hostIdsRef = db.ref('/host_ids');
      const hostIdsSnapshot = await hostIdsRef.once('value');
      const hostIdsData = hostIdsSnapshot.val();

      if (!hostIdsData) {
        logger.info("❌ No host IDs found in database");
        return;
      }

      // Convert host IDs object to array
      const hostIds = Object.keys(hostIdsData);
      
      if (hostIds.length === 0) {
        logger.info("❌ No host IDs found in database");
        return;
      }

      // Get current index from database
      const counterRef = db.ref('/scheduledHostIdCounter');
      const counterData = await counterRef.once('value');
      let currentIndex = counterData.val() || 0;

      // Ensure index is within bounds
      if (currentIndex >= hostIds.length) {
        currentIndex = 0; // Reset to first host ID
      }

      // Get the current host ID
      const currentHostId = hostIds[currentIndex];

      logger.info(`🎯 Selected host ID ${currentIndex + 1}/${hostIds.length}: ${currentHostId}`);

      // Get media for the current host ID
      const media = await getMedia(currentHostId);
      if (!media) {
        logger.info(`❌ No media found for host ID ${currentHostId}`);
        // Move to next host ID even if no media
        const nextIndex = (currentIndex + 1) % hostIds.length;
        await counterRef.set(nextIndex);
        logger.info(`🔄 Moving to next host ID index: ${nextIndex}`);
        return;
      }

      // Send media to Telegram
      const sendPromises = CHAT_IDS.map(async (chat) => {
        // Generate caption based on the specific chat ID
        const caption = chat.isChinese ?
          `🎉 ${media.nickname || 'Host'} 在线! 💋🔥  真人女孩  💃👀\n\n ${chinese_messages[Math.floor(Math.random() * chinese_messages.length)]} \n\n ${chinese_labels[Math.floor(Math.random() * chinese_labels.length)]}` :
          `🎉 ${media.nickname || 'Host'} is LIVE now! 💋🔥  Real girl  💃👀\n\n ${messages[Math.floor(Math.random() * messages.length)]} \n\n ${labels[Math.floor(Math.random() * labels.length)]}`;

        const result = await sendMediaToTG(media.path, media.type, chat.chatId, caption, chat.isChinese, chat.inviteCode);
        if (result.success) {
          logger.info(`✅ Successfully sent media for host ID ${currentHostId} to Telegram chat ${chat.chatId}`);
          return { success: true, chatId: chat.chatId };
        } else {
          logger.error(`❌ Failed to send media for host ID ${currentHostId} to chat ${chat.chatId}:`, result.error);
          return { success: false, chatId: chat.chatId, error: result.error };
        }
      });

      const results = await Promise.all(sendPromises);
      const successCount = results.filter(r => r.success).length;
      const errorCount = results.filter(r => !r.success).length;

      if (errorCount === 0) {
        logger.info(`✅ Successfully sent media for host ID ${currentHostId} to all ${successCount} Telegram chats`);
      } else {
        logger.error(`❌ Failed to send media for host ID ${currentHostId} to ${errorCount} chats, succeeded: ${successCount}`);
      }

      // Move to next host ID (cycle back to 0 if at end)
      const nextIndex = (currentIndex + 1) % hostIds.length;
      await counterRef.set(nextIndex);

      logger.info(`🔄 Next host ID index: ${nextIndex} (${hostIds[nextIndex]})`);

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
  schedule: "every 30 minutes",
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

// Export Telegram functions
// exports.telegramWebhook = onRequest(telegramWebhook);  //to find out chat id, use ngork for local
exports.sendHostToGroup = onRequest(sendHostToGroup);

// Function to add host IDs to database
exports.addHostIds = onRequest(async (req, res) => {
  try {
    const hostIds = [
      "856a0c11-964f-4520-a4a9-827a9193909e",
      "684e716e-14e2-412d-8054-f3ac70808751",
      "125b4332-89df-4738-8751-9dc922972853",
      "6de45798-154a-4611-bb1c-298fb1385103",
      "e1d988eb-eb64-4d52-9b63-ea930166e1dc",
      "1a418d10-e0f0-46f8-9e06-e9ec9c8c9933",
      "0eb9d582-4179-44db-b225-0403de273ecb",
      "290aaafd-bdca-4a5d-b793-2671d9e5cdb3",
      "ed4c1e3b-eed3-4a1b-9170-2b8b781ee7c6",
      "e39a117c-bc31-4082-b82d-cd4d067e2d39",
      "0a200a2e-2e72-4a59-94a8-fc070e9d8f6d",
      "075d0069-9abe-448a-b768-3373d12f3a3c",
      "fb8ae6c0-9122-4ead-9f8b-f30c11d2de1a",
      "a1e9c1e0-1156-41a8-a5e0-38ab128d1bdb",
      "5abe8812-ea3a-47ca-a6a9-826b27aca8e7",
      "39ce0381-6d5b-4789-acb2-74d621b6030e",
      "e8b25253-8f1a-4a53-8b0d-d8aec98b2f02",
      "a505d778-8b80-4348-ab20-f19e5c3ae1e9",
      "18dfeafa-1b6e-4067-b976-ba4894e2d0a7",
      "94029526-49d5-41f2-8fee-9e42f35c2e37",
      "a578791b-0e4d-49ab-8395-4411a3809e21",
      "1a941c4e-fd2b-4305-a857-e66f5c2cc9fe",
      "5ef4a120-6bf5-486a-b361-1a860754fd16",
      "b7dfe9c2-70ec-4722-adff-6f5477cb5fe1",
      "50caeb4e-2b6d-462c-b2bb-a62d64714876",
      "50caeb4e-2b6d-462c-b2bb-a62d64714876",
      "f00f5091-6dca-4968-9ee4-afcd92a3e4a5",
      "f00f5091-6dca-4968-9ee4-afcd92a3e4a5",
      "c2d192ad-6088-41d9-827b-7a2ca37a9ecc",
      "971ec58c-4dad-43ac-a29b-2c35e2ceedd9",
      "c21098b9-113d-492a-be32-39fdd482ffd2",
      "781dbda5-dcaf-4165-a956-78c1f43dbe75",
      "ec6327ca-98e9-4d5c-b1a0-b9bf27651b89",
      "23d11daf-b3bc-4884-b947-3971dea05ba8",
      "0519a12f-9f2b-436a-b8a8-27d4ab7afb1a",
      "404521db-d07c-4a5d-a31b-528f8e6d8726",
      "a66989c3-d229-4002-9115-f5b0dca70c33",
      "e7367c1c-28cd-48af-8a71-b2fc18846abe",
      "7ac73e3e-0874-4cf6-a055-a3b370ab43d6",
      "88ff18f3-0db5-4bc2-97cf-2d0392263d8b",
      "6a99ea25-3ace-426c-a43f-d32b2450eb3f",
      "5c669a3c-c60a-48c0-a60a-8585584fc851",
      "c0026f52-0301-4de1-9638-14791951df8f",
      "7b806398-54bb-47a3-bb7b-d49492a741d9",
      "c67570fc-38b4-43bd-b32a-45f4da86bf80",
      "db45b0a2-78d7-40b0-9982-e063c707dcca",
      "d16213f8-da9a-4f36-9dff-52f630ee6402",
      "19852243-8e4b-4f76-be37-e76991d4d875",
      "edfe3d87-7969-4261-bbcd-c1f67a95d9cd",
      "29df64c4-5ce7-4b5e-85eb-df8bdb70fd61",
      "30936f12-e473-40a7-93aa-5fbd27fe1976",
      "24a97e40-6eb9-4a1a-9f7f-5e809d255f8f",
      "3a6c1976-c3d1-46e3-8dfe-21233eab69da",
      "8371d8ba-2001-420d-aac8-fa4121597f1a",
      "681aa4ff-0879-464a-a454-edf577d99a80",
      "5688e568-5d8c-48bc-9b53-dec772cf0b8b"
    ];

    // Remove duplicates from the array
    const uniqueHostIds = [...new Set(hostIds)];
    
    // Create an object with host IDs as keys and true as values
    const hostIdsObject = {};
    uniqueHostIds.forEach(id => {
      hostIdsObject[id] = true;
    });

    // Write to database at /host_id path
    await db.ref('/host_ids').set(hostIdsObject);

    logger.info(`✅ Successfully added ${uniqueHostIds.length} unique host IDs to database`);
    
    res.status(200).json({
      success: true,
      message: `Successfully added ${uniqueHostIds.length} unique host IDs to database`,
      totalIds: uniqueHostIds.length,
      duplicateRemoved: hostIds.length - uniqueHostIds.length
    });

  } catch (error) {
    logger.error("❌ Error adding host IDs to database:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
const axios = require('axios');
const logger = require("firebase-functions/logger");
const { messages } = require("./messages");
const { labels } = require("./labels");

// Telegram bot configuration
const botToken = "8046669247:AAF4lMRGlcJWJMM2iykXLH9G_3moBS-rZvc";

// Helper function to get media from AvatarLive API
const getMedia = async (id) => {
  try {
    console.log("xxxxxxxxxxxxxxxxxxxxxxxgetMedia", id);
    const gettoken = await axios.post("https://avatarlive.ai/api/user/login", {
      email: "firebase@pop.com",
      password: "96e79218965eb72c92a549dd5a330112",
      ip: "207.216.143.95"
    }, {
      headers: {
        "Content-Type": "application/json"
      }
    });

    const url = "https://avatarlive.ai/api/post/getBroadcasterPosts?page=1&limit=70&type=2&account_id=" + id;

    const token = gettoken.data.data.access_token;
    console.log("vvvvvvvvvvvvvvvvvvvvvvvvvv:", token);
    const result = await axios.get(url, {
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json"
      }
    });
    console.log("API response:", result.data);

    const posts = result.data.data.posts_list;
    if (!posts || posts.length === 0) {
      console.log("No posts found for userId:", id);
      return null;
    }

    const filteredPosts = posts.filter(post => post.paid_content === 0);
    if (filteredPosts.length === 0) {
      console.log("No free posts found for userId:", id);
      return null;
    }

    const index = Math.floor(Math.random() * filteredPosts.length);
    const selectedPost = filteredPosts[index];
    console.log("Selected post:", selectedPost);

    return selectedPost;
  } catch (error) {
    console.error("Error fetching media URL:", error.response?.data || error.message);
    return null;
  }
};

// Helper function to send media to Telegram group
const sendMediaToTG = async (url, type, chat_id, caption) => {
  try {
    const telegramURL = `https://api.telegram.org/bot${botToken}/${type === 1 ? "sendPhoto" : "sendVideo"}`;
    const response = await axios.post(telegramURL, {
      chat_id,
      [type === 1 ? "photo" : "video"]: url,
      caption,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "Start now!",
              url: "https://t.me/pomchatpopbot/pomchat"
            }
          ]
        ]
      }
    });

    logger.info("✅ Media sent with mini app button:", response.data);
    return { success: true, data: response.data };
  } catch (error) {
    logger.error("❌ Failed to send media:", error.response?.data || error.message);
    return { success: false, error: error.response?.data || error.message };
  }
};

// Helper function to send message to Telegram group
const sendTelegramMessage = async (messageText = "🔥 Hello group from Firebase!") => {
  try {
    const telegramURL = `https://api.telegram.org/bot${botToken}/sendMessage`;

    const response = await axios.post(telegramURL, {
      chat_id: chatId,
      text: messageText,
      parse_mode: "HTML"
    });

    logger.info("✅ Message sent:", response.data);
    return { success: true, data: response.data };
  } catch (error) {
    logger.error("❌ Failed to send message:", error.response?.data || error.message);
    return { success: false, error: error.response?.data || error.message };
  }
};

// Telegram bot webhook
const telegramWebhook = (req, res) => {
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
};

// HTTP function to send message to Telegram group
const sendHostToGroup = async (req, res) => {
  const result = await sendTelegramMessage("🔥 Hello group from Firebase!");

  if (result.success) {
    res.status(200).send("Message sent!");
  } else {
    res.status(500).send("Error sending message.");
  }
};

module.exports = {
  getMedia,
  sendMediaToTG,
  sendTelegramMessage,
  telegramWebhook,
  sendHostToGroup
}; 
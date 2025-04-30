// const TelegramBot = require("node-telegram-bot-api");

// // Replace with your actual bot token from BotFather
// const token = "";

// // Create a bot using polling
// const bot = new TelegramBot(token, {polling: true});

// // Listen for any text message
// bot.on("message", (msg) => {
//   const chatId = msg.chat.id;
//   const text = msg.text;
//   const isGroup = msg.chat.type.includes("group");

//   if (isGroup) {
//     if (text === "/hello") {
//       bot.sendMessage(chatId, "Hello group members!");
//     }
//   } else {
//     if (text === "/start") {
//       bot.sendMessage(chatId, "Welcome! I am your simple bot.");
//     } else {
//       bot.sendMessage(chatId, `You said: "${text}"`);
//     }
//   }
// });
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const {GoogleGenAI} = require("@google/genai");
const Parser = require("rss-parser");
const cron = require("node-cron");
const mongoose = require("mongoose");

// --- CONFIGURATION --- //
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const RSS_FEED_URL = process.env.RSS_FEED_URL;
const MONGODB_URI = process.env.MONGODB_URI;

// --- SETUP --- //
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {polling: true});
const ai = new GoogleGenAI({apiKey: GEMINI_API_KEY});
const parser = new Parser({
  headers: {
    "User-Agent": "Mozilla/5.0 (TelegramBot/1.0; +https://example.com)",
  },
});

// --- DATABASE SETUP --- //
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const LastSentSchema = new mongoose.Schema({
  key: {type: String, unique: true},
  url: String,
});

const LastSent = mongoose.model("LastSent", LastSentSchema);

async function getLastSentUrl() {
  const record = await LastSent.findOne({key: "latest"});
  return record?.url || null;
}

async function setLastSentUrl(url) {
  await LastSent.findOneAndUpdate(
    {key: "latest"},
    {url},
    {upsert: true, new: true}
  );
}

// --- FUNCTION: Fetch News --- //
async function fetchCryptoNews() {
  const feed = await parser.parseURL(RSS_FEED_URL);
  const firstItem = feed.items[0];
  return {
    title: firstItem.title,
    content: firstItem.contentSnippet || firstItem.content || "",
    url: firstItem.link,
  };
}

// --- FUNCTION: Summarize with Gemini --- //
async function summarizeNews(title, content, url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `
Summarize this crypto news article in a casual, friendly tone like you're chatting with a buddy.
Keep it short and fun. End with 👉 [Read full article](${url})

Title: ${title}
Content: ${content}
              `,
              },
            ],
          },
        ],
      });

      if (res?.candidates?.[0]?.content?.parts?.[0]?.text) {
        return res.candidates[0].content.parts[0].text;
      } else {
        return "Sorry, no summary could be generated.";
      }
    } catch (err) {
      console.error(`Attempt ${attempt} failed:`, err.message);
      if (attempt < retries) {
        console.log(`⏳ Retrying in 5 seconds...`);
        await new Promise((resolve) => setTimeout(resolve, 5000)); // wait 5 seconds
      } else {
        return "Sorry, Gemini API was unavailable after multiple tries.";
      }
    }
  }
}

async function generateWelcomeMessage(name, retries = 3) {
  const prompt = `
Welcome a new group member named ${name} with a joyful, casual tone.
Let them know that this bot keeps everyone up to date with the latest crypto news—even if they miss a beat!
Encourage them to stay tuned and enjoy the updates. Keep it friendly and enthusiastic!
  `;

  const footer = `\n\n🌐 *Need help with marketing, mobile or web development?* [Visit our website](https://adroitsdigital.com) or reach out to us!`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [
          {
            role: "user",
            parts: [{text: prompt}],
          },
        ],
      });

      if (res?.candidates?.[0]?.content?.parts?.[0]?.text) {
        return res.candidates[0].content.parts[0].text + footer;
      } else {
        return (
          `👋 Welcome ${name}! This bot keeps you updated with the latest in the crypto market. Stay tuned!` +
          footer
        );
      }
    } catch (err) {
      console.error(`Error generating welcome message: ${err.message}`);
      if (attempt < retries) {
        console.log(`⏳ Retrying in 5 seconds...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      } else {
        return (
          `👋 Welcome ${name}! This bot keeps you updated with the latest in the crypto market. Stay tuned!` +
          footer
        );
      }
    }
  }
}

bot.on("new_chat_members", async (msg) => {
  const newMembers = msg.new_chat_members;
  for (const member of newMembers) {
    const name = member.first_name || "there";
    const welcomeMessage = await generateWelcomeMessage(name);
    try {
      await bot.sendMessage(msg.chat.id, welcomeMessage, {
        parse_mode: "Markdown",
      });
      console.log(`👋 Sent welcome message to ${name}`);
    } catch (err) {
      console.error("Error sending welcome message:", err.message);
    }
  }
});

// --- FUNCTION: Send News --- //
// --- SEND NEWS --- //
async function sendCryptoNews(chatId) {
  try {
    const {title, content, url} = await fetchCryptoNews();
    const lastSentUrl = await getLastSentUrl();

    if (url === lastSentUrl) {
      console.log("🟡 Duplicate article, skipping...");
      return;
    }

    const summary = await summarizeNews(title, content, url);
    await bot.sendMessage(chatId, summary, {parse_mode: "Markdown"});
    await setLastSentUrl(url);
    console.log("✅ News sent:", title);
  } catch (err) {
    console.error("Error sending news:", err.message);
    bot.sendMessage(chatId, "⚠️ Error fetching news or summary.");
  }
}

// --- Manual Command: /news --- //
bot.onText(/\/news/, async (msg) => {
  await sendCryptoNews(msg.chat.id);
});

// --- Auto Post Hourly --- //
cron.schedule("0 * * * *", async () => {
  await sendCryptoNews(TELEGRAM_CHAT_ID);
});

// cron.schedule("*/1 * * * *", async () => {
//   // Change cron for 1-minute interval for testing
//   await sendCryptoNews(TELEGRAM_CHAT_ID);
// });

//CryptoNewsAdroits
//@Adroits_Crypto_News_bot

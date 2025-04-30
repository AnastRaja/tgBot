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

const TelegramBot = require("node-telegram-bot-api");
const {GoogleGenAI} = require("@google/genai");
const Parser = require("rss-parser");
const cron = require("node-cron");
const mongoose = require("mongoose");

// --- CONFIGURATION --- //
const TELEGRAM_BOT_TOKEN = "7102869832:AAHPeeFgdsr6Ess7s-YN1zt8aRCapJN-RWI";
const GEMINI_API_KEY = "AIzaSyAsi28aI9hC7gsq8LLt6yuAcVc59aQx-Ao";
const TELEGRAM_CHAT_ID = "-1002679482222"; // Get from message.chat.id
const RSS_FEED_URL = "https://www.coindesk.com/arc/outboundfeeds/rss/";
const MONGODB_URI =
  "mongodb+srv://digitaladroits:CjGgmE7ZRcHXJ79h@cluster0.44omql4.mongodb.net/blogapi";

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
async function summarizeNews(title, content, url) {
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

    // Log the entire response object to ensure we understand its structure
    console.log("Gemini API Response:", JSON.stringify(res, null, 2));

    // Accessing the summary from the 'candidates' array
    if (res && res.candidates && res.candidates.length > 0) {
      const summary = res.candidates[0].content.parts[0].text; // Get the text from the first candidate
      return summary;
    } else {
      return "Sorry, no summary could be generated.";
    }
  } catch (err) {
    console.error("Error in summarizeNews:", err.message);
    return "Sorry, there was an error generating the summary.";
  }
}

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

// // --- Auto Post Hourly --- //
// cron.schedule("0 * * * *", async () => {
//   await sendCryptoNews(TELEGRAM_CHAT_ID);
// });

cron.schedule("*/1 * * * *", async () => {
  // Change cron for 1-minute interval for testing
  await sendCryptoNews(TELEGRAM_CHAT_ID);
});

//CryptoNewsAdroits
//@Adroits_Crypto_News_bot

// ...existing code from event/index.js will be placed here...

import fs from "fs";
import twilio from "twilio";

// =================================
// ENV VARIABLES
// =================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.CHAT_ID;
const COOKIE = process.env.COOKIE;

const URL = "https://bip.bitsathy.ac.in/nova-api/student-activity-masters?page=1";

const HEADERS = {
  cookie: COOKIE,
  "user-agent": "Mozilla/5.0"
};

// =================================
// GLOBALS
// =================================
let lastUpdateId = 0;
let storedEvents = [];
let users = [];

// =================================
// LOAD / SAVE seen.json
// =================================
function loadSeenData() {
  console.log("📂 Checking seen.json...");
  if (fs.existsSync("seen.json")) {
    try {
      const raw = fs.readFileSync("seen.json");
      const parsed = JSON.parse(raw);
      storedEvents = parsed.events || [];
      console.log(`✅ Loaded ${storedEvents.length} stored events`);
    } catch (e) {
      console.log("❌ Error parsing seen.json, starting fresh.");
      storedEvents = [];
    }
  } else {
    console.log("⚠️ seen.json not found, starting fresh.");
  }
}

function saveSeenData() {
  fs.writeFileSync(
    "seen.json",
    JSON.stringify({ events: storedEvents }, null, 2)
  );
  console.log("💾 seen.json updated");
}

// =================================
// LOAD / SAVE users.json
// =================================
function loadUsers() {
  if (fs.existsSync("users.json")) {
    const raw = fs.readFileSync("users.json");
    const parsed = JSON.parse(raw);
    users = parsed.users || [];
  }

  if (ADMIN_ID && !users.includes(ADMIN_ID)) {
    users.push(ADMIN_ID);
    saveUsers();
  }
}

function saveUsers() {
  fs.writeFileSync("users.json", JSON.stringify({ users }, null, 2));
}

// =================================
// TELEGRAM SEND
// =================================
async function sendMessage(chatId, message) {
  // Twilio SMS integration
  const accountSid = 'ACc5be0ff28147dfbca5b43b02dfe0068a';
  const authToken = '867a88b13d4b15bb2110f4bc05152f4f';
  const client = twilio(accountSid, authToken);

  // Send an SMS
  client.messages.create({
    body: message,
    from: '+12233621993',
    to: chatId
  })
  .then(msg => console.log('SMS sent, SID:', msg.sid))
  .catch(err => console.error('SMS error:', err));
}

async function broadcast(message) {
  for (const user of users) {
    await sendMessage(user, message);
  }
}

// =================================
// HELPERS
// =================================
function extractFields(fields) {
  const data = {};
  for (const f of fields) {
    data[f.validationKey] = f.value;
  }
  return data;
}

function isValid(event) {
  return (
    event.status === "Active" &&
    ["ONLINE", "OFFLINE"].includes(event.location) &&
    ["Competition", "Paper Presentation", "Events-Attended"].includes(event.event_category)
  );
}

// =================================
// FETCH EVENTS
// =================================
async function fetchEvents() {
  console.log("🌐 Fetching from API...");
  try {
    const res = await fetch(URL, { headers: HEADERS });
    if (res.status !== 200) return { expired: true, events: [] };

    const data = await res.json();
    const validEvents = [];

    for (const e of data.resources) {
      const fields = extractFields(e.fields || []);
      const event = {
        title: e.title || "No Title",
        event_code: fields.event_code,
        event_category: fields.event_category,
        status: fields.status,
        location: fields.location
      };

      if (event.event_code && isValid(event)) {
        validEvents.push(event);
      }
    }
    return { expired: false, events: validEvents };
  } catch (err) {
    return { expired: false, events: [] };
  }
}

// =================================
// CHECK LOGIC (Newest at Index 0)
// =================================
async function checkEvents(manual = false, chatId = null) {
  const result = await fetchEvents();
  if (result.expired) {
    if (manual) await sendMessage(chatId, "⚠️ Session expired!");
    else await broadcast("⚠️ Session expired! Update COOKIE.");
    return;
  }

  let newFound = false;

  // IMPORTANT: Process the API results in REVERSE (oldest to newest)
  // so that the absolute newest one is the LAST to be unshifted to index 0.
  const apiEvents = [...result.events].reverse();

  for (const event of apiEvents) {
    const exists = storedEvents.some(e => e.event_code === event.event_code);
    
    if (!exists) {
      storedEvents.unshift(event); // Add to the very top
      newFound = true;

      await broadcast(
        `🚨 NEW EVENT FOUND\n\n${event.title}\n` +
        `Category: ${event.event_category}\n` +
        `Location: ${event.location}`
      );
    }
  }

  if (newFound) {
    // Keep only the last 50 events in file to save space
    if (storedEvents.length > 50) storedEvents = storedEvents.slice(0, 50);
    saveSeenData();
  } else if (manual && chatId) {
    await sendMessage(chatId, "✅ No new events found.");
  }
}

// =================================
// LAST 5 (Simple Slice)
// =================================
async function sendLast5(chatId) {
  if (storedEvents.length === 0) {
    await sendMessage(chatId, "📭 No events stored. Try /check first.");
    return;
  }

  // Newest are already at the beginning of the array
  const last5 = storedEvents.slice(0, 5);
  let msg = "📌 Latest 5 Events:\n\n";
  last5.forEach((e, i) => {
    msg += `${i + 1}. ${e.title}\n`;
  });

  await sendMessage(chatId, msg);
}

// =================================
// TELEGRAM POLLING
// =================================
async function listenCommands() {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}`);
    const data = await res.json();
    if (!data.ok) return;

    for (const update of data.result) {
      lastUpdateId = update.update_id;
      const text = update.message?.text;
      const chatId = update.message?.chat?.id?.toString();
      if (!text || !chatId) continue;

      if (!users.includes(chatId)) {
        users.push(chatId);
        saveUsers();
      }

      const cmd = text.replace("/", "").toLowerCase();
      if (cmd === "ping") await sendMessage(chatId, "🏓 Bot is active.");
      else if (cmd === "check") await checkEvents(true, chatId);
      else if (cmd === "last5") await sendLast5(chatId);
      else if (cmd === "status") {
        const check = await fetchEvents();
        await sendMessage(chatId, check.expired ? "❌ Cookie Expired" : "✅ Cookie Active");
      }
    }
  } catch (e) {}
}

// =================================
// START
// =================================
async function start() {
  console.log("🚀 Monitor Started.");
  loadSeenData();
  loadUsers();

  setInterval(() => checkEvents(false), 5 * 60 * 1000); // 5 min
  setInterval(listenCommands, 4000); // 4 sec
  
  listenCommands();
}

start();


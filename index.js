const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");
const express = require("express");

// ===== Telegram =====
const BOT_TOKEN = "8124828151:AAFjrILEs-G37E6zcixB3c7SZYFGZ1T4Ito";
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ===== Firebase =====
admin.initializeApp({
  credential: admin.credential.cert(require("./firebase.json"))
});
const db = admin.firestore();

// ===== Admin =====
const ADMINS = [5307228059]; // Telegram ID

// ===== Web Server =====
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running on port", PORT));

// ===== Start =====
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 أهلاً بك\n📜 /scripts لعرض السكربتات"
  );
});

// ===== عرض السكربتات =====
bot.onText(/\/scripts/, async (msg) => {
  const snap = await db.collection("scripts").get();
  if (snap.empty) {
    return bot.sendMessage(msg.chat.id, "❌ لا يوجد سكربتات");
  }

  snap.forEach(doc => {
    const s = doc.data();

    bot.sendMessage(
      msg.chat.id,
      `📌 *${s.name}*`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[
            {
              text: "⬇️ تحميل السكربت",
              url: `https://xs-tau-three.vercel.ap/download.html?id=${doc.id}&tg=${msg.from.id}`
            }
          ]]
        }
      }
    );
  });
});

// ================== أوامر الأدمن ==================

// ➕ إضافة سكربت
bot.onText(/\/add (.+)\|(.+)/, async (msg, match) => {
  if (!ADMINS.includes(msg.from.id)) return;

  await db.collection("scripts").add({
    name: match[1],
    finalLink: match[2],
    created: new Date()
  });

  bot.sendMessage(msg.chat.id, "✅ تم إضافة السكربت");
});

// ✏️ تعديل سكربت
bot.onText(/\/edit (.+)\|(.+)\|(.+)/, async (msg, match) => {
  if (!ADMINS.includes(msg.from.id)) return;

  const snap = await db.collection("scripts")
    .where("name", "==", match[1]).get();

  snap.forEach(doc => {
    doc.ref.update({
      name: match[2],
      finalLink: match[3]
    });
  });

  bot.sendMessage(msg.chat.id, "✏️ تم تعديل السكربت");
});

// ❌ حذف سكربت
bot.onText(/\/delete (.+)/, async (msg, match) => {
  if (!ADMINS.includes(msg.from.id)) return;

  const snap = await db.collection("scripts")
    .where("name", "==", match[1]).get();

  snap.forEach(doc => doc.ref.delete());

  bot.sendMessage(msg.chat.id, "🗑️ تم حذف السكربت");
});

// ================== Verify ==================
app.post("/verify", async (req, res) => {
  const { scriptId, tgId } = req.body;

  const snap = await db.collection("scripts").doc(scriptId).get();
  if (!snap.exists) return res.sendStatus(404);

  await bot.sendMessage(
    tgId,
    `✅ تم فتح السكربت:\n${snap.data().finalLink}`
  );

  res.sendStatus(200);
});

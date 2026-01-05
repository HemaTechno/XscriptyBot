const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");
const express = require("express");

// ===== Telegram =====
const BOT_TOKEN = process.env.BOT_TOKEN || "PUT_YOUR_BOT_TOKEN";
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
app.listen(PORT, () => console.log("🚀 Server running on port", PORT));

// ================== /start ==================
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 أهلاً بك\n📜 /scripts لعرض السكربتات"
  );
});

// ================== عرض السكربتات ==================
bot.onText(/\/scripts/, async (msg) => {
  try {
    const snap = await db.collection("scripts").get();
    if (snap.empty) {
      return bot.sendMessage(msg.chat.id, "❌ لا يوجد سكربتات");
    }

    snap.forEach(doc => {
      const s = doc.data();

      bot.sendMessage(
        msg.chat.id,
        `📌 *${s.name}*\n📝 _${s.description}_`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[
              {
                text: "⬇️ تحميل السكربت",
                url: `https://xs-tau-three.vercel.app/download.html?id=${doc.id}&tg=${msg.from.id}`
              }
            ]]
          }
        }
      );
    });
  } catch (err) {
    console.error(err);
    bot.sendMessage(msg.chat.id, "❌ حصل خطأ، حاول مرة أخرى");
  }
});

// ================== إضافة سكربت بالحوار ==================
const addState = {}; // لتخزين حالة كل أدمن

bot.onText(/\/add/, (msg) => {
  if (!ADMINS.includes(msg.from.id)) return;

  addState[msg.from.id] = { step: 1, data: {} };
  bot.sendMessage(msg.chat.id, "📝 ارسل اسم السكربت:");
});

bot.on("message", async (msg) => {
  const id = msg.from.id;

  if (!ADMINS.includes(id)) return; // فقط الأدمن

  if (addState[id]) {
    const state = addState[id];

    // خطوة الاسم
    if (state.step === 1) {
      state.data.name = msg.text.trim();
      state.step = 2;
      return bot.sendMessage(msg.chat.id, "✏️ ارسل وصف السكربت:");
    }

    // خطوة الوصف
    if (state.step === 2) {
      state.data.description = msg.text.trim();
      state.step = 3;
      return bot.sendMessage(msg.chat.id, "🔗 ارسل رابط السكربت النهائي (Raw Pastebin أو GitHub):");
    }

    // خطوة الرابط
    if (state.step === 3) {
      state.data.finalLink = msg.text.trim();

      // إضافة إلى Firebase
      try {
        await db.collection("scripts").add({
          name: state.data.name,
          description: state.data.description,
          finalLink: state.data.finalLink,
          created: new Date()
        });

        bot.sendMessage(msg.chat.id, `✅ تم إضافة السكربت: *${state.data.name}*`, { parse_mode: "Markdown" });
      } catch (err) {
        console.error(err);
        bot.sendMessage(msg.chat.id, "❌ حصل خطأ أثناء إضافة السكربت");
      }

      // إزالة الحالة
      delete addState[id];
    }
  }
});

// ================== تعديل سكربت ==================
bot.onText(/\/edit (.+)\|(.+)\|(.+)/, async (msg, match) => {
  if (!ADMINS.includes(msg.from.id)) return;

  try {
    const snap = await db.collection("scripts")
      .where("name", "==", match[1].trim()).get();

    if (snap.empty) {
      return bot.sendMessage(msg.chat.id, "❌ لم أجد سكربت بهذا الاسم");
    }

    const updatePromises = [];
    snap.forEach(doc => {
      updatePromises.push(doc.ref.update({
        name: match[2].trim(),
        description: match[3].trim(), // وصف جديد
        // إذا عايز تعدل الرابط كمان ممكن تضيف finalLink هنا
      }));
    });

    await Promise.all(updatePromises);
    bot.sendMessage(msg.chat.id, "✏️ تم تعديل السكربت");
  } catch (err) {
    console.error(err);
    bot.sendMessage(msg.chat.id, "❌ خطأ أثناء تعديل السكربت");
  }
});

// ================== حذف سكربت ==================
bot.onText(/\/delete (.+)/, async (msg, match) => {
  if (!ADMINS.includes(msg.from.id)) return;

  try {
    const snap = await db.collection("scripts")
      .where("name", "==", match[1].trim()).get();

    if (snap.empty) {
      return bot.sendMessage(msg.chat.id, "❌ لم أجد سكربت بهذا الاسم");
    }

    const deletePromises = [];
    snap.forEach(doc => deletePromises.push(doc.ref.delete()));
    await Promise.all(deletePromises);

    bot.sendMessage(msg.chat.id, "🗑️ تم حذف السكربت");
  } catch (err) {
    console.error(err);
    bot.sendMessage(msg.chat.id, "❌ خطأ أثناء حذف السكربت");
  }
});

// ================== Verify ==================
app.post("/verify", async (req, res) => {
  const { scriptId, tgId } = req.body;

  try {
    const snap = await db.collection("scripts").doc(scriptId).get();
    if (!snap.exists) return res.sendStatus(404);

    await bot.sendMessage(
      tgId,
      `✅ تم فتح السكربت:\n${snap.data().finalLink}`
    );

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

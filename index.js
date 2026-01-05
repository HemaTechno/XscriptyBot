const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");
const express = require("express");

// ===== Environment Variables =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is required in environment variables");
  process.exit(1);
}

// ===== Telegram =====
const bot = new TelegramBot(BOT_TOKEN, { 
  polling: true,
  // زيادة المهلة لتجنب مشاكل الاتصال
  request: {
    timeout: 60000
  }
});

// ===== Firebase =====
try {
  // استخدم متغيرات البيئة بدلاً من ملف JSON
  const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG || '{}');
  
  if (!serviceAccount.project_id) {
    throw new Error("Firebase configuration is missing");
  }
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} catch (error) {
  console.error("❌ Firebase initialization error:", error.message);
  // يمكنك اختيار إيقاف البرنامج أو الاستمرار بدون Firebase
  process.exit(1);
}

const db = admin.firestore();

// ===== Admin =====
const ADMINS_STRING = process.env.ADMINS || "5307228059";
const ADMINS = ADMINS_STRING.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

// ===== Web Server =====
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// إضافة روت صحي للتحقق من عمل السيرفر
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`👑 Admins: ${ADMINS.join(', ')}`);
});

// ===== Add State Management =====
const userStates = new Map();

// ================== /start ==================
bot.onText(/\/start/, async (msg) => {
  try {
    await bot.sendMessage(
      msg.chat.id,
      "👋 أهلاً بك في بوت السكربتات\n\n" +
      "📜 /scripts - لعرض جميع السكربتات المتاحة\n" +
      "🔍 /search [كلمة] - للبحث عن سكربت\n" +
      (ADMINS.includes(msg.from.id) ? 
        "\n⚡ أوامر الأدمن:\n" +
        "➕ /add - إضافة سكربت جديد\n" +
        "✏️ /edit - تعديل سكربت\n" +
        "🗑️ /delete - حذف سكربت\n" +
        "📊 /stats - إحصائيات" : "")
    );
  } catch (error) {
    console.error("Error in /start:", error);
  }
});

// ================== عرض السكربتات ==================
bot.onText(/\/scripts(?:@\w+)?$/, async (msg) => {
  try {
    const chatId = msg.chat.id;
    
    await bot.sendChatAction(chatId, "typing");
    
    const snap = await db.collection("scripts")
      .orderBy("created", "desc")
      .limit(20)
      .get();
    
    if (snap.empty) {
      return bot.sendMessage(chatId, "📭 لا يوجد سكربتات متاحة حالياً.");
    }

    let scripts = [];
    snap.forEach(doc => {
      scripts.push({ id: doc.id, ...doc.data() });
    });

    // إرسال رسالة أولية
    const message = await bot.sendMessage(
      chatId,
      `📚 *السكربتات المتاحة (${scripts.length})*\n` +
      `استخدم الأزرار أدناه للتصفح:`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            ...scripts.slice(0, 5).map(script => [
              {
                text: `📌 ${script.name.substring(0, 30)}${script.name.length > 30 ? '...' : ''}`,
                callback_data: `script_${script.id}`
              }
            ]),
            scripts.length > 5 ? [
              { text: "⏩ الصفحة التالية", callback_data: "next_page_2" }
            ] : []
          ]
        }
      }
    );

    // حفظ بيانات الصفحة
    userStates.set(`${chatId}_${message.message_id}`, {
      scripts,
      currentPage: 1,
      itemsPerPage: 5
    });

  } catch (err) {
    console.error("Error in /scripts:", err);
    bot.sendMessage(msg.chat.id, "❌ حدث خطأ أثناء جلب السكربتات، حاول مرة أخرى.");
  }
});

// ================== معالجة Callback Queries ==================
bot.on("callback_query", async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;
  
  try {
    // زر "التالي" أو "السابق"
    if (data.startsWith("next_page_") || data.startsWith("prev_page_")) {
      const page = parseInt(data.split('_')[2]);
      const stateKey = `${chatId}_${messageId}`;
      const state = userStates.get(stateKey);
      
      if (!state) {
        return bot.answerCallbackQuery(callbackQuery.id, { text: "انتهت صلاحية البيانات" });
      }
      
      const startIndex = (page - 1) * state.itemsPerPage;
      const endIndex = startIndex + state.itemsPerPage;
      const pageScripts = state.scripts.slice(startIndex, endIndex);
      
      if (pageScripts.length === 0) {
        return bot.answerCallbackQuery(callbackQuery.id, { text: "لا توجد سكربتات في هذه الصفحة" });
      }
      
      const keyboard = pageScripts.map(script => [
        {
          text: `📌 ${script.name.substring(0, 30)}${script.name.length > 30 ? '...' : ''}`,
          callback_data: `script_${script.id}`
        }
      ]);
      
      const navButtons = [];
      if (page > 1) {
        navButtons.push({ text: "⏪ الصفحة السابقة", callback_data: `prev_page_${page - 1}` });
      }
      if (endIndex < state.scripts.length) {
        navButtons.push({ text: "⏩ الصفحة التالية", callback_data: `next_page_${page + 1}` });
      }
      
      if (navButtons.length > 0) {
        keyboard.push(navButtons);
      }
      
      await bot.editMessageReplyMarkup(
        { inline_keyboard: keyboard },
        {
          chat_id: chatId,
          message_id: messageId
        }
      );
      
      state.currentPage = page;
      userStates.set(stateKey, state);
      return bot.answerCallbackQuery(callbackQuery.id);
    }
    
    // عرض تفاصيل السكربت
    if (data.startsWith("script_")) {
      const scriptId = data.split('_')[1];
      const scriptDoc = await db.collection("scripts").doc(scriptId).get();
      
      if (!scriptDoc.exists) {
        return bot.answerCallbackQuery(callbackQuery.id, { text: "السكربت غير موجود" });
      }
      
      const script = scriptDoc.data();
      const isAdmin = ADMINS.includes(callbackQuery.from.id);
      
      const inlineKeyboard = [[
        {
          text: "⬇️ تحميل السكربت",
          url: `${process.env.WEB_URL || 'https://your-domain.vercel.app'}/download.html?id=${scriptId}&tg=${callbackQuery.from.id}`
        }
      ]];
      
      if (isAdmin) {
        inlineKeyboard.push([
          { text: "✏️ تعديل", callback_data: `edit_${scriptId}` },
          { text: "🗑️ حذف", callback_data: `delete_${scriptId}` }
        ]);
      }
      
      await bot.sendMessage(
        chatId,
        `📌 *${script.name}*\n\n` +
        `📝 *الوصف:*\n${script.description}\n\n` +
        `📅 *تاريخ الإضافة:* ${script.created?.toDate?.().toLocaleDateString('ar-SA') || 'غير محدد'}\n` +
        `🆔 *الرقم:* ${scriptId.substring(0, 8)}...`,
        {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: inlineKeyboard }
        }
      );
      
      return bot.answerCallbackQuery(callbackQuery.id);
    }
    
    // حذف السكربت (للمشرفين)
    if (data.startsWith("delete_")) {
      if (!ADMINS.includes(callbackQuery.from.id)) {
        return bot.answerCallbackQuery(callbackQuery.id, { text: "ليس لديك صلاحية" });
      }
      
      const scriptId = data.split('_')[1];
      const scriptDoc = await db.collection("scripts").doc(scriptId).get();
      
      if (!scriptDoc.exists) {
        return bot.answerCallbackQuery(callbackQuery.id, { text: "السكربت غير موجود" });
      }
      
      const scriptName = scriptDoc.data().name;
      
      // تأكيد الحذف
      await bot.sendMessage(
        chatId,
        `⚠️ *تأكيد الحذف*\n\nهل أنت متأكد من حذف السكربت:\n"${scriptName}"؟`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ نعم، احذفه", callback_data: `confirm_delete_${scriptId}` },
                { text: "❌ إلغاء", callback_data: `cancel_delete` }
              ]
            ]
          }
        }
      );
      
      return bot.answerCallbackQuery(callbackQuery.id);
    }
    
    // تأكيد الحذف
    if (data.startsWith("confirm_delete_")) {
      const scriptId = data.split('_')[2];
      
      try {
        await db.collection("scripts").doc(scriptId).delete();
        
        await bot.sendMessage(chatId, "✅ تم حذف السكربت بنجاح");
        
        // حذف الرسالة الأصلية
        try {
          await bot.deleteMessage(chatId, messageId);
        } catch (e) {
          console.log("Could not delete message:", e.message);
        }
        
      } catch (error) {
        console.error("Delete error:", error);
        await bot.sendMessage(chatId, "❌ حدث خطأ أثناء الحذف");
      }
      
      return bot.answerCallbackQuery(callbackQuery.id);
    }
    
    // إلغاء الحذف
    if (data === "cancel_delete") {
      await bot.deleteMessage(chatId, messageId);
      return bot.answerCallbackQuery(callbackQuery.id, { text: "تم الإلغاء" });
    }
    
  } catch (error) {
    console.error("Callback error:", error);
    try {
      await bot.answerCallbackQuery(callbackQuery.id, { text: "حدث خطأ" });
    } catch (e) {
      console.error("Error answering callback:", e);
    }
  }
});

// ================== إضافة سكربت بالحوار ==================
bot.onText(/\/add(?:@\w+)?$/, (msg) => {
  const userId = msg.from.id;
  
  if (!ADMINS.includes(userId)) {
    return bot.sendMessage(msg.chat.id, "❌ ليس لديك صلاحية للقيام بهذا الإجراء.");
  }
  
  userStates.set(`add_${userId}`, {
    step: 1,
    data: {}
  });
  
  bot.sendMessage(
    msg.chat.id,
    "📝 *مرحباً بك في أداة إضافة السكربتات*\n\n" +
    "الخطوة 1/3: أرسل اسم السكربت\n\n" +
    "✏️ *مثال:* `سكربت تسجيل يوزرات`\n" +
    "❌ للإلغاء أرسل: /cancel",
    { parse_mode: "Markdown" }
  );
});

// ================== معالجة الرسائل للإضافة ==================
bot.on("message", async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  
  // تجاهل الأوامر
  if (text?.startsWith('/')) {
    return;
  }
  
  const addKey = `add_${userId}`;
  const addState = userStates.get(addKey);
  
  if (addState) {
    try {
      if (addState.step === 1) {
        if (!text || text.length < 2) {
          return bot.sendMessage(chatId, "❌ الاسم قصير جداً، أرسل اسم صحيح.");
        }
        
        addState.data.name = text;
        addState.step = 2;
        userStates.set(addKey, addState);
        
        return bot.sendMessage(
          chatId,
          "✅ *تم حفظ الاسم*\n\n" +
          "الخطوة 2/3: أرسل وصف السكربت\n\n" +
          "✏️ *مثال:* `سكربت لتسجيل يوزرات تيك توك تلقائياً مع كود المصدر`\n" +
          "❌ للإلغاء أرسل: /cancel",
          { parse_mode: "Markdown" }
        );
      }
      
      if (addState.step === 2) {
        if (!text || text.length < 10) {
          return bot.sendMessage(chatId, "❌ الوصف قصير جداً، أرسل وصف مفصل.");
        }
        
        addState.data.description = text;
        addState.step = 3;
        userStates.set(addKey, addState);
        
        return bot.sendMessage(
          chatId,
          "✅ *تم حفظ الوصف*\n\n" +
          "الخطوة 3/3: أرسل رابط السكربت\n\n" +
          "🔗 *أنواع الروابط المقبولة:*\n" +
          "• رابط GitHub RAW\n" +
          "• رابط Pastebin\n" +
          "• رابط مباشر\n\n" +
          "✏️ *مثال:* `https://raw.githubusercontent.com/user/repo/main/script.lua`\n" +
          "❌ للإلغاء أرسل: /cancel",
          { parse_mode: "Markdown" }
        );
      }
      
      if (addState.step === 3) {
        if (!text || !isValidUrl(text)) {
          return bot.sendMessage(chatId, "❌ الرابط غير صالح، أرسل رابط صحيح.");
        }
        
        addState.data.finalLink = text;
        
        // تأكيد الإضافة
        await bot.sendMessage(
          chatId,
          `📋 *تأكيد معلومات السكربت*\n\n` +
          `📌 *الاسم:* ${addState.data.name}\n` +
          `📝 *الوصف:* ${addState.data.description.substring(0, 100)}${addState.data.description.length > 100 ? '...' : ''}\n` +
          `🔗 *الرابط:* ${addState.data.finalLink}\n\n` +
          `هل تريد إضافة السكربت بهذه المعلومات؟`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ نعم، أضف", callback_data: `confirm_add_${userId}` },
                  { text: "❌ إلغاء", callback_data: `cancel_add_${userId}` }
                ]
              ]
            }
          }
        );
        
        userStates.set(addKey, addState);
      }
      
    } catch (error) {
      console.error("Add script error:", error);
      userStates.delete(addKey);
      bot.sendMessage(chatId, "❌ حدث خطأ، يرجى المحاولة مرة أخرى.");
    }
  }
});

// ================== تأكيد إضافة السكربت ==================
bot.on("callback_query", async (callbackQuery) => {
  const data = callbackQuery.data;
  
  if (data.startsWith("confirm_add_")) {
    const userId = parseInt(data.split('_')[2]);
    const addKey = `add_${userId}`;
    const addState = userStates.get(addKey);
    
    if (!addState) {
      return bot.answerCallbackQuery(callbackQuery.id, { text: "انتهت صلاحية العملية" });
    }
    
    try {
      await db.collection("scripts").add({
        name: addState.data.name,
        description: addState.data.description,
        finalLink: addState.data.finalLink,
        created: admin.firestore.FieldValue.serverTimestamp(),
        addedBy: userId
      });
      
      await bot.sendMessage(
        callbackQuery.message.chat.id,
        `✅ *تمت إضافة السكربت بنجاح*\n\n` +
        `📌 ${addState.data.name}\n` +
        `تم إضافته إلى قاعدة البيانات.`,
        { parse_mode: "Markdown" }
      );
      
      // حذف رسالة التأكيد
      await bot.deleteMessage(callbackQuery.message.chat.id, callbackQuery.message.message_id);
      
    } catch (error) {
      console.error("Add to DB error:", error);
      await bot.sendMessage(callbackQuery.message.chat.id, "❌ حدث خطأ أثناء حفظ السكربت");
    } finally {
      userStates.delete(addKey);
      await bot.answerCallbackQuery(callbackQuery.id, { text: "تمت الإضافة" });
    }
  }
  
  if (data.startsWith("cancel_add_")) {
    const userId = parseInt(data.split('_')[2]);
    userStates.delete(`add_${userId}`);
    
    await bot.sendMessage(callbackQuery.message.chat.id, "❌ تم إلغاء عملية الإضافة.");
    await bot.deleteMessage(callbackQuery.message.chat.id, callbackQuery.message.message_id);
    await bot.answerCallbackQuery(callbackQuery.id, { text: "تم الإلغاء" });
  }
});

// ================== البحث عن سكربت ==================
bot.onText(/\/search(?:@\w+)? (.+)/, async (msg, match) => {
  try {
    const searchTerm = match[1].toLowerCase();
    const snap = await db.collection("scripts").get();
    
    const results = [];
    snap.forEach(doc => {
      const script = doc.data();
      if (
        script.name.toLowerCase().includes(searchTerm) ||
        script.description.toLowerCase().includes(searchTerm)
      ) {
        results.push({ id: doc.id, ...script });
      }
    });
    
    if (results.length === 0) {
      return bot.sendMessage(msg.chat.id, "🔍 لم أجد نتائج للبحث.");
    }
    
    let message = `🔍 *نتائج البحث عن "${match[1]}"*\n\n`;
    results.forEach((script, index) => {
      message += `${index + 1}. ${script.name}\n`;
    });
    
    message += `\n📊 العدد: ${results.length} سكربت`;
    
    await bot.sendMessage(msg.chat.id, message, { parse_mode: "Markdown" });
    
  } catch (error) {
    console.error("Search error:", error);
    bot.sendMessage(msg.chat.id, "❌ حدث خطأ أثناء البحث.");
  }
});

// ================== إحصائيات ==================
bot.onText(/\/stats(?:@\w+)?$/, async (msg) => {
  if (!ADMINS.includes(msg.from.id)) return;
  
  try {
    const scriptsSnap = await db.collection("scripts").get();
    const totalScripts = scriptsSnap.size;
    
    // جلب آخر 5 سكربتات مضافة
    const recentScripts = [];
    scriptsSnap.forEach(doc => {
      const data = doc.data();
      recentScripts.push({
        name: data.name,
        date: data.created?.toDate?.() || new Date()
      });
    });
    
    // ترتيب حسب التاريخ
    recentScripts.sort((a, b) => b.date - a.date);
    
    let message = `📊 *إحصائيات البوت*\n\n`;
    message += `📚 إجمالي السكربتات: *${totalScripts}*\n`;
    message += `👑 عدد المشرفين: *${ADMINS.length}*\n\n`;
    
    if (recentScripts.length > 0) {
      message += `🆕 *آخر السكربتات:*\n`;
      recentScripts.slice(0, 5).forEach((script, index) => {
        message += `${index + 1}. ${script.name}\n`;
      });
    }
    
    await bot.sendMessage(msg.chat.id, message, { parse_mode: "Markdown" });
    
  } catch (error) {
    console.error("Stats error:", error);
    bot.sendMessage(msg.chat.id, "❌ حدث خطأ أثناء جلب الإحصائيات.");
  }
});

// ================== إلغاء الأمر ==================
bot.onText(/\/cancel(?:@\w+)?$/, (msg) => {
  const userId = msg.from.id;
  const addKey = `add_${userId}`;
  
  if (userStates.has(addKey)) {
    userStates.delete(addKey);
    bot.sendMessage(msg.chat.id, "❌ تم إلغاء عملية الإضافة.");
  } else {
    bot.sendMessage(msg.chat.id, "⚠️ لا توجد عملية نشطة لإلغائها.");
  }
});

// ================== Verify Endpoint ==================
app.post("/verify", async (req, res) => {
  try {
    const { scriptId, tgId } = req.body;
    
    if (!scriptId || !tgId) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    
    const scriptDoc = await db.collection("scripts").doc(scriptId).get();
    
    if (!scriptDoc.exists) {
      return res.status(404).json({ error: "Script not found" });
    }
    
    const script = scriptDoc.data();
    
    // إرسال الرابط للمستخدم
    await bot.sendMessage(
      tgId,
      `✅ *تم تفعيل السكربت بنجاح*\n\n` +
      `📌 ${script.name}\n` +
      `🔗 ${script.finalLink}\n\n` +
      `قم بنسخ الرابط واستخدامه في التطبيق.`,
      { parse_mode: "Markdown" }
    );
    
    // تسجيل عملية التحميل
    await db.collection("downloads").add({
      scriptId,
      scriptName: script.name,
      userId: tgId,
      downloadedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    res.status(200).json({ 
      success: true, 
      message: "تم إرسال الرابط للمستخدم" 
    });
    
  } catch (error) {
    console.error("Verify error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ================== وظيفة مساعدة للتحقق من الرابط ==================
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
}

// ================== معالجة الأخطاء ==================
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  // لا تغلق البرنامج، استمر في العمل
});

// ================== تنظيف الذاكرة ==================
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of userStates.entries()) {
    if (key.startsWith('add_')) {
      // حذف عمليات الإضافة القديمة (أكثر من 30 دقيقة)
      if (now - (value.timestamp || 0) > 30 * 60 * 1000) {
        userStates.delete(key);
      }
    }
  }
}, 10 * 60 * 1000); // كل 10 دقائق

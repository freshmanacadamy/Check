require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const admin = require('firebase-admin');

// Initialize Firebase
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();
const bot = new Telegraf(process.env.BOT_TOKEN);

// Global variables
let confessionCounter = 0;
const userCooldown = new Map();

// Initialize confession counter
async function initializeCounter() {
  try {
    const snapshot = await db.collection('confessions')
      .where('status', '==', 'approved')
      .orderBy('confessionNumber', 'desc')
      .limit(1)
      .get();
    
    if (!snapshot.empty) {
      const latest = snapshot.docs[0].data();
      confessionCounter = latest.confessionNumber || 0;
    }
  } catch (error) {
    console.error('Counter init error:', error);
  }
}

// Initialize session and counter
bot.use(session());
bot.use(async (ctx, next) => {
  ctx.session = ctx.session || {};
  await next();
});

// ==================== START COMMAND ====================
bot.command('start', async (ctx) => {
  const text = `🤫 *Welcome to JU Confession Bot!*\n\nShare your thoughts anonymously. Your identity is completely hidden!`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✍️ Send Confession', 'send_confession')],
    [Markup.button.callback('📌 Rules', 'show_rules')],
    [Markup.button.callback('ℹ️ About', 'show_about')]
  ]);

  await ctx.replyWithMarkdown(text, keyboard);
});

// ==================== RULES ====================
bot.action('show_rules', async (ctx) => {
  const text = `📌 *Confession Rules*\n\n✅ Be respectful\n✅ No personal attacks\n✅ No spam or ads\n✅ Keep it anonymous`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✍️ Send Confession', 'send_confession')],
    [Markup.button.callback('🔙 Main Menu', 'main_menu')]
  ]);

  await ctx.editMessageText(text, { 
    parse_mode: 'Markdown',
    reply_markup: keyboard.reply_markup 
  });
  await ctx.answerCbQuery();
});

// ==================== ABOUT ====================
bot.action('show_about', async (ctx) => {
  const text = `ℹ️ *About*\n\nAnonymous confession platform for JU students. 100% private and secure.`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✍️ Send Confession', 'send_confession')],
    [Markup.button.callback('🔙 Main Menu', 'main_menu')]
  ]);

  await ctx.editMessageText(text, { 
    parse_mode: 'Markdown',
    reply_markup: keyboard.reply_markup 
  });
  await ctx.answerCbQuery();
});

// ==================== MAIN MENU ====================
bot.action('main_menu', async (ctx) => {
  const text = `🤫 *JU Confession Bot*\n\nChoose an option below:`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✍️ Send Confession', 'send_confession')],
    [Markup.button.callback('📌 Rules', 'show_rules')],
    [Markup.button.callback('ℹ️ About', 'show_about')]
  ]);

  await ctx.editMessageText(text, { 
    parse_mode: 'Markdown',
    reply_markup: keyboard.reply_markup 
  });
  await ctx.answerCbQuery();
});

// ==================== SEND CONFESSION ====================
bot.action('send_confession', async (ctx) => {
  const userId = ctx.from.id;
  const now = Date.now();
  
  // Cooldown check
  const lastSubmit = userCooldown.get(userId);
  if (lastSubmit && (now - lastSubmit) < 60000) {
    const waitTime = Math.ceil((60000 - (now - lastSubmit)) / 1000);
    await ctx.answerCbQuery(`Please wait ${waitTime} seconds`);
    return;
  }

  await ctx.replyWithMarkdown(
    `✍️ *Send Your Confession*\n\nType your confession below (max 1000 characters):`
  );
  
  ctx.session.waitingForConfession = true;
  await ctx.answerCbQuery();
});

// ==================== HANDLE CONFESSION TEXT ====================
bot.on('text', async (ctx) => {
  // Handle confession submission
  if (ctx.session.waitingForConfession) {
    await handleConfession(ctx, ctx.message.text);
    return;
  }
  
  // Handle rejection reason
  if (ctx.session.rejectingConfession) {
    await handleRejection(ctx, ctx.message.text);
    return;
  }
  
  // Handle admin messages to users
  if (ctx.session.messagingUser) {
    await handleAdminMessage(ctx, ctx.message.text);
    return;
  }
});

async function handleConfession(ctx, text) {
  const userId = ctx.from.id;
  const now = Date.now();

  // Validate confession
  if (!text || text.trim().length < 5) {
    await ctx.reply('❌ Confession too short. Minimum 5 characters.');
    ctx.session.waitingForConfession = false;
    return;
  }

  if (text.length > 1000) {
    await ctx.reply('❌ Confession too long. Maximum 1000 characters.');
    ctx.session.waitingForConfession = false;
    return;
  }

  try {
    const confessionId = `confess_${userId}_${now}`;
    
    // Save to Firebase
    await db.collection('confessions').doc(confessionId).set({
      confessionId: confessionId,
      userId: userId,
      text: text.trim(),
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    // Set cooldown
    userCooldown.set(userId, now);

    // Notify admin
    await notifyAdmins(confessionId, text);
    
    ctx.session.waitingForConfession = false;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✍️ Send Another', 'send_confession')],
      [Markup.button.callback('🔙 Main Menu', 'main_menu')]
    ]);

    await ctx.replyWithMarkdown(
      `✅ *Confession Submitted!*\n\nYour confession is under review. You'll be notified when approved.`,
      keyboard
    );
    
  } catch (error) {
    console.error('Submission error:', error);
    await ctx.reply('❌ Error submitting confession. Please try again.');
    ctx.session.waitingForConfession = false;
  }
}

// ==================== ADMIN NOTIFICATION ====================
async function notifyAdmins(confessionId, text) {
  const adminIds = process.env.ADMIN_IDS?.split(',') || [];
  
  const message = `🤫 *New Confession*\n\n${text}\n\n*Actions:*`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Approve', `approve_${confessionId}`),
      Markup.button.callback('❌ Reject', `reject_${confessionId}`)
    ]
  ]);

  for (const adminId of adminIds) {
    try {
      await bot.telegram.sendMessage(adminId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard.reply_markup
      });
    } catch (error) {
      console.error(`Admin notify error ${adminId}:`, error);
    }
  }
}

// ==================== ADMIN APPROVAL ====================
bot.action(/approve_(.+)/, async (ctx) => {
  const confessionId = ctx.match[1];
  
  try {
    const doc = await db.collection('confessions').doc(confessionId).get();
    if (!doc.exists) {
      await ctx.answerCbQuery('❌ Confession not found');
      return;
    }

    const confession = doc.data();
    
    // Increment counter
    confessionCounter += 1;
    
    // Update confession
    await db.collection('confessions').doc(confessionId).update({
      status: 'approved',
      confessionNumber: confessionCounter,
      approvedAt: new Date().toISOString()
    });

    // Post to channel
    await postToChannel(confession.text, confessionCounter);

    // Notify user
    await notifyUser(confession.userId, confessionCounter, 'approved');

    // Update admin message
    await ctx.editMessageText(
      `✅ *Confession #${confessionCounter} Approved!*\n\nPosted to channel successfully.`,
      { parse_mode: 'Markdown' }
    );
    
    await ctx.answerCbQuery('Approved!');

  } catch (error) {
    console.error('Approval error:', error);
    await ctx.answerCbQuery('❌ Approval failed');
  }
});

// ==================== ADMIN REJECTION ====================
bot.action(/reject_(.+)/, async (ctx) => {
  const confessionId = ctx.match[1];
  
  await ctx.editMessageText(
    `❌ *Rejecting Confession*\n\nPlease provide rejection reason:`,
    { parse_mode: 'Markdown' }
  );
  ctx.session.rejectingConfession = confessionId;
  await ctx.answerCbQuery();
});

async function handleRejection(ctx, reason) {
  const confessionId = ctx.session.rejectingConfession;
  
  try {
    const doc = await db.collection('confessions').doc(confessionId).get();
    if (doc.exists) {
      const confession = doc.data();
      
      await db.collection('confessions').doc(confessionId).update({
        status: 'rejected',
        rejectionReason: reason,
        rejectedAt: new Date().toISOString()
      });

      // Notify user
      await notifyUser(confession.userId, 0, 'rejected', reason);

      await ctx.reply(`✅ Confession rejected.`);
    }
  } catch (error) {
    console.error('Rejection error:', error);
    await ctx.reply('❌ Rejection failed');
  }
  
  ctx.session.rejectingConfession = null;
}

// ==================== CHANNEL POSTING ====================
async function postToChannel(text, number) {
  const channelId = process.env.CHANNEL_ID;
  
  const message = `#${number}\n\n${text}\n\n[ 👁️‍🗨️ View/Add Comments (0) ]`;

  try {
    // For now, just log the channel post
    console.log(`WOULD POST TO CHANNEL ${channelId}:`, message);
    // await bot.telegram.sendMessage(channelId, message);
  } catch (error) {
    console.error('Channel post error:', error);
  }
}

// ==================== USER NOTIFICATION ====================
async function notifyUser(userId, number, status, reason = '') {
  try {
    let message = '';
    if (status === 'approved') {
      message = `🎉 *Your Confession #${number} was approved!*\n\nIt has been posted to the channel.`;
    } else {
      message = `❌ *Confession Not Approved*\n\nReason: ${reason}\n\nYou can submit a new one.`;
    }

    await bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('User notify error:', error);
  }
}

// ==================== ADMIN MESSAGING ====================
bot.action(/message_(.+)/, async (ctx) => {
  const userId = ctx.match[1];
  await ctx.editMessageText(`📩 Messaging user\n\nType your message:`);
  ctx.session.messagingUser = userId;
  await ctx.answerCbQuery();
});

async function handleAdminMessage(ctx, text) {
  const userId = ctx.session.messagingUser;

  try {
    await bot.telegram.sendMessage(userId, `📩 *Admin Message*\n\n${text}`, { parse_mode: 'Markdown' });
    await ctx.reply(`✅ Message sent to user.`);
  } catch (error) {
    await ctx.reply(`❌ Failed to send message. User may have blocked bot.`);
  }
  
  ctx.session.messagingUser = null;
}

// ==================== ERROR HANDLING ====================
bot.catch((err, ctx) => {
  console.error(`Bot error:`, err);
  ctx.reply('❌ An error occurred. Please try again.');
});

// ==================== VERCEL HANDLER ====================
module.exports = async (req, res) => {
  try {
    // Initialize counter on first request
    if (confessionCounter === 0) {
      await initializeCounter();
    }
    
    await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).send('OK');
  }
};

// ==================== LOCAL DEVELOPMENT ====================
if (process.env.NODE_ENV === 'development') {
  initializeCounter().then(() => {
    bot.launch().then(() => {
      console.log('🤫 JU Confession Bot running locally');
    });
  });
  
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

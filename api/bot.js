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
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

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
    console.log(`Confession counter initialized: ${confessionCounter}`);
  } catch (error) {
    console.error('Counter init error:', error);
  }
}

// ==================== SESSION MIDDLEWARE ====================
bot.use(session());
bot.use(async (ctx, next) => {
  ctx.session = ctx.session || {};
  await next();
});

// ==================== START COMMAND ====================
bot.command('start', async (ctx) => {
  const userId = ctx.from.id;
  
  // Create user if doesn't exist
  let user = await db.collection('users').doc(userId.toString()).get();
  if (!user.exists) {
    await db.collection('users').doc(userId.toString()).set({
      userId: userId,
      username: ctx.from.username || ctx.from.first_name,
      aura: 0,
      followers: [],
      following: [],
      bio: 'No bio set',
      profileEmoji: 'None',
      nickname: 'Anonymous',
      privacySettings: {
        showConfessions: false,
        showComments: true,
        showFollowing: false,
        showFollowers: false,
        allowChats: true
      },
      settings: {
        commentsPerPage: 15,
        notifications: true
      },
      joinedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString()
    });
  }

  const welcomeText = `🤫 *Welcome to JU Confession Bot!*\n\nShare your thoughts anonymously. Your identity is completely hidden!`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✍️ Send Confession', 'send_confession')],
    [Markup.button.callback('📌 Rules', 'show_rules')],
    [Markup.button.callback('ℹ️ About', 'show_about')],
    [Markup.button.callback('👤 My Profile', 'show_profile')]
  ]);

  await ctx.replyWithMarkdown(welcomeText, keyboard);
});

// ==================== RULES BUTTON ====================
bot.action('show_rules', async (ctx) => {
  const rulesText = `📌 *Confession Rules*\n\n` +
    `✅ *Allowed:*\n` +
    `• Personal thoughts and feelings\n` +
    `• Crushes and relationships\n` +
    `• Academic struggles\n` +
    `• Friendly messages\n\n` +
    `❌ *Not Allowed:*\n` +
    `• Hate speech or bullying\n` +
    `• Personal attacks\n` +
    `• Spam or advertisements\n` +
    `• Illegal content\n\n` +
    `🚫 *Violations will result in ban*`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✍️ Send Confession', 'send_confession')],
    [Markup.button.callback('🔙 Main Menu', 'main_menu')]
  ]);

  await ctx.editMessageText(rulesText, { 
    parse_mode: 'Markdown',
    reply_markup: keyboard.reply_markup 
  });
  await ctx.answerCbQuery();
});

// ==================== ABOUT BUTTON ====================
bot.action('show_about', async (ctx) => {
  const aboutText = `ℹ️ *About JU Confession Bot*\n\n` +
    `• 100% Anonymous - No one sees your identity\n` +
    `• Admin moderated - Safe content only\n` +
    `• Social features - Follow users, build reputation\n` +
    `• Private messaging - Connect anonymously\n` +
    `• Free to use - No charges ever`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✍️ Send Confession', 'send_confession')],
    [Markup.button.callback('🔙 Main Menu', 'main_menu')]
  ]);

  await ctx.editMessageText(aboutText, { 
    parse_mode: 'Markdown',
    reply_markup: keyboard.reply_markup 
  });
  await ctx.answerCbQuery();
});

// ==================== MAIN MENU BUTTON ====================
bot.action('main_menu', async (ctx) => {
  const welcomeText = `🤫 *JU Confession Bot*\n\nChoose an option below:`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✍️ Send Confession', 'send_confession')],
    [Markup.button.callback('📌 Rules', 'show_rules')],
    [Markup.button.callback('ℹ️ About', 'show_about')],
    [Markup.button.callback('👤 My Profile', 'show_profile')]
  ]);

  await ctx.editMessageText(welcomeText, { 
    parse_mode: 'Markdown',
    reply_markup: keyboard.reply_markup 
  });
  await ctx.answerCbQuery();
});

// ==================== SEND CONFESSION BUTTON ====================
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
    `✍️ *Send Your Confession*\n\nType your confession below (max 1000 characters):\n\n` +
    `💡 *Tip:* Add hashtags like #Relationship #CampusLife #MentalHealth`
  );
  
  ctx.session.waitingForConfession = true;
  await ctx.answerCbQuery();
});

// ==================== SHOW PROFILE BUTTON ====================
bot.action('show_profile', async (ctx) => {
  const userId = ctx.from.id;
  
  try {
    const userDoc = await db.collection('users').doc(userId.toString()).get();
    if (!userDoc.exists) {
      await ctx.answerCbQuery('❌ User not found');
      return;
    }

    const user = userDoc.data();
    const profileText = `👤 *${user.nickname}* ${user.profileEmoji !== 'None' ? user.profileEmoji : ''}\n\n` +
      `✨ *Aura:* ${user.aura}\n` +
      `👥 *Followers:* ${user.followers.length} | *Following:* ${user.following.length}\n\n` +
      `📝 *Bio:* ${user.bio}\n\n` +
      `🕒 Last seen: ${new Date(user.lastSeen).toLocaleTimeString()}`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⚙️ Edit Profile', 'edit_profile')],
      [Markup.button.callback('🔧 Settings', 'user_settings')],
      [Markup.button.callback('📊 My Stats', 'user_stats')],
      [Markup.button.callback('🔙 Main Menu', 'main_menu')]
    ]);

    if (ctx.updateType === 'callback_query') {
      await ctx.editMessageText(profileText, { 
        parse_mode: 'Markdown',
        reply_markup: keyboard.reply_markup 
      });
    } else {
      await ctx.replyWithMarkdown(profileText, keyboard);
    }
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Profile error:', error);
    await ctx.answerCbQuery('❌ Error loading profile');
  }
});

// ==================== EDIT PROFILE BUTTON ====================
bot.action('edit_profile', async (ctx) => {
  const profileEditText = `⚙️ *Profile Customization*\n\nCustomize your public appearance:\n\n` +
    `🎭 *Profile Emoji:* None\n` +
    `📛 *Nickname:* Anonymous\n` +
    `📝 *Bio:* No bio set\n\n` +
    `*Customization Options:*`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🎭 Change Emoji', 'change_emoji')],
    [Markup.button.callback('📛 Change Nickname', 'change_nickname')],
    [Markup.button.callback('📝 Set Bio', 'set_bio')],
    [Markup.button.callback('👁️ Privacy Settings', 'privacy_settings')],
    [Markup.button.callback('🔙 Back to Profile', 'show_profile')]
  ]);

  await ctx.editMessageText(profileEditText, { 
    parse_mode: 'Markdown',
    reply_markup: keyboard.reply_markup 
  });
  await ctx.answerCbQuery();
});

// ==================== USER SETTINGS BUTTON ====================
bot.action('user_settings', async (ctx) => {
  const settingsText = `🔧 *User Settings*\n\n` +
    `📄 *Comments Per Page:* 15\n` +
    `💬 *Allow Chat Requests:* ✅ Yes\n\n` +
    `*Notification Settings:*\n` +
    `🔔 Push Notifications: ✅ Enabled`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📄 Set Comments Per Page', 'set_comments_page')],
    [Markup.button.callback('💬 Toggle Chat Requests', 'toggle_chats')],
    [Markup.button.callback('🔔 Notification Settings', 'notification_settings')],
    [Markup.button.callback('🔙 Back to Profile', 'show_profile')]
  ]);

  await ctx.editMessageText(settingsText, { 
    parse_mode: 'Markdown',
    reply_markup: keyboard.reply_markup 
  });
  await ctx.answerCbQuery();
});

// ==================== USER STATS BUTTON ====================
bot.action('user_stats', async (ctx) => {
  const userId = ctx.from.id;
  
  try {
    // Get user's confessions count
    const confessionsSnapshot = await db.collection('confessions')
      .where('userId', '==', userId)
      .where('status', '==', 'approved')
      .get();

    // Get user's comments count
    const commentsSnapshot = await db.collection('comments')
      .where('userId', '==', userId)
      .get();

    const statsText = `📊 *Your Statistics*\n\n` +
      `💡 Confessions Posted: ${confessionsSnapshot.size}\n` +
      `💬 Comments Made: ${commentsSnapshot.size}\n` +
      `👥 Followers: 0\n` +
      `📈 Following: 0\n` +
      `✨ Aura Points: 0\n\n` +
      `🎯 *Engagement Rate:* 0%\n` +
      `⭐ *Rank:* New User`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📈 View Analytics', 'view_analytics')],
      [Markup.button.callback('🔙 Back to Profile', 'show_profile')]
    ]);

    await ctx.editMessageText(statsText, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard.reply_markup 
    });
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Stats error:', error);
    await ctx.answerCbQuery('❌ Error loading stats');
  }
});

// ==================== HANDLE CONFESSION SUBMISSION ====================
bot.on('text', async (ctx) => {
  // Handle confession submission
  if (ctx.session.waitingForConfession) {
    await handleConfessionSubmission(ctx, ctx.message.text);
    return;
  }
  
  // Handle rejection reason from admin
  if (ctx.session.rejectingConfession) {
    await handleRejectionReason(ctx, ctx.message.text);
    return;
  }
  
  // Handle admin messages to users
  if (ctx.session.messagingUser) {
    await handleAdminMessage(ctx, ctx.message.text);
    return;
  }

  // Handle nickname change
  if (ctx.session.changingNickname) {
    await handleNicknameChange(ctx, ctx.message.text);
    return;
  }

  // Handle bio change
  if (ctx.session.changingBio) {
    await handleBioChange(ctx, ctx.message.text);
    return;
  }
});

async function handleConfessionSubmission(ctx, text) {
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
    
    // Extract hashtags
    const hashtags = text.match(/#\w+/g) || [];
    
    // Save to Firebase
    await db.collection('confessions').doc(confessionId).set({
      confessionId: confessionId,
      userId: userId,
      text: text.trim(),
      hashtags: hashtags,
      status: 'pending',
      createdAt: new Date().toISOString(),
      submittedAt: new Date().toISOString()
    });

    // Set cooldown
    userCooldown.set(userId, now);

    // Notify admin
    await notifyAdmins(confessionId, text, ctx.from.username || ctx.from.first_name);
    
    ctx.session.waitingForConfession = false;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✍️ Send Another', 'send_confession')],
      [Markup.button.callback('🔙 Main Menu', 'main_menu')]
    ]);

    await ctx.replyWithMarkdown(
      `✅ *Confession Submitted!*\n\nYour confession is under review. You'll be notified when approved.\n\n` +
      `📝 *Status:* Waiting for admin approval\n` +
      `⏰ *Note:* You'll get a notification when it's posted`,
      keyboard
    );
    
  } catch (error) {
    console.error('Submission error:', error);
    await ctx.reply('❌ Error submitting confession. Please try again.');
    ctx.session.waitingForConfession = false;
  }
}

// ==================== ADMIN NOTIFICATION ====================
async function notifyAdmins(confessionId, text, username) {
  const adminIds = process.env.ADMIN_IDS?.split(',') || [];
  
  const message = `🤫 *New Confession Submission*\n\n` +
    `👤 *From:* ${username || 'Anonymous'}\n` +
    `🆔 *Confession ID:* ${confessionId}\n\n` +
    `*Confession Text:*\n"${text}"\n\n` +
    `*Admin Actions:*`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Approve', `approve_${confessionId}`),
      Markup.button.callback('❌ Reject', `reject_${confessionId}`)
    ],
    [
      Markup.button.callback('📩 Message User', `message_${confessionId.split('_')[1]}`)
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

// ==================== ADMIN APPROVAL BUTTON ====================
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
      approvedAt: new Date().toISOString(),
      approvedBy: ctx.from.username || 'Admin'
    });

    // Post to channel
    await postToChannel(confession.text, confessionCounter, confession.hashtags);

    // Notify user
    await notifyUser(confession.userId, confessionCounter, 'approved');

    // Update admin message (remove buttons)
    await ctx.editMessageText(
      `✅ *Confession #${confessionCounter} Approved!*\n\n` +
      `Confession has been posted to the channel successfully.\n\n` +
      `User has been notified.`,
      { parse_mode: 'Markdown' }
    );
    
    await ctx.answerCbQuery('✅ Confession approved!');

  } catch (error) {
    console.error('Approval error:', error);
    await ctx.answerCbQuery('❌ Approval failed');
  }
});

// ==================== ADMIN REJECTION BUTTON ====================
bot.action(/reject_(.+)/, async (ctx) => {
  const confessionId = ctx.match[1];
  
  await ctx.editMessageText(
    `❌ *Rejecting Confession*\n\nPlease provide rejection reason:`,
    { parse_mode: 'Markdown' }
  );
  ctx.session.rejectingConfession = confessionId;
  await ctx.answerCbQuery();
});

async function handleRejectionReason(ctx, reason) {
  const confessionId = ctx.session.rejectingConfession;
  
  try {
    const doc = await db.collection('confessions').doc(confessionId).get();
    if (doc.exists) {
      const confession = doc.data();
      
      await db.collection('confessions').doc(confessionId).update({
        status: 'rejected',
        rejectionReason: reason,
        rejectedAt: new Date().toISOString(),
        rejectedBy: ctx.from.username || 'Admin'
      });

      // Notify user
      await notifyUser(confession.userId, 0, 'rejected', reason);

      await ctx.reply(`✅ Confession rejected with reason.`);
    }
  } catch (error) {
    console.error('Rejection error:', error);
    await ctx.reply('❌ Rejection failed');
  }
  
  ctx.session.rejectingConfession = null;
}

// ==================== ADMIN MESSAGE BUTTON ====================
bot.action(/message_(.+)/, async (ctx) => {
  const userId = ctx.match[1];
  await ctx.editMessageText(`📩 Messaging user ${userId}\n\nType your message:`);
  ctx.session.messagingUser = userId;
  await ctx.answerCbQuery();
});

async function handleAdminMessage(ctx, text) {
  const userId = ctx.session.messagingUser;

  try {
    await bot.telegram.sendMessage(userId, `📩 *Message from Admin*\n\n${text}`, { parse_mode: 'Markdown' });
    await ctx.reply(`✅ Message sent to user ${userId}.`);
  } catch (error) {
    await ctx.reply(`❌ Failed to send message. User may have blocked bot.`);
  }
  
  ctx.session.messagingUser = null;
}

// ==================== CHANGE NICKNAME BUTTON ====================
bot.action('change_nickname', async (ctx) => {
  await ctx.reply('📛 *Enter your new nickname:*\n\nThis will be displayed instead of "Anonymous"', { parse_mode: 'Markdown' });
  ctx.session.changingNickname = true;
  await ctx.answerCbQuery();
});

async function handleNicknameChange(ctx, nickname) {
  const userId = ctx.from.id;
  
  if (!nickname || nickname.trim().length < 2) {
    await ctx.reply('❌ Nickname too short. Minimum 2 characters.');
    ctx.session.changingNickname = false;
    return;
  }

  if (nickname.length > 20) {
    await ctx.reply('❌ Nickname too long. Maximum 20 characters.');
    ctx.session.changingNickname = false;
    return;
  }

  try {
    await db.collection('users').doc(userId.toString()).update({
      nickname: nickname.trim(),
      lastSeen: new Date().toISOString()
    });

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Back to Profile', 'show_profile')]
    ]);

    await ctx.replyWithMarkdown(`✅ *Nickname updated!*\n\nYour nickname is now: *${nickname.trim()}*`, keyboard);
    ctx.session.changingNickname = false;
  } catch (error) {
    console.error('Nickname error:', error);
    await ctx.reply('❌ Error updating nickname');
    ctx.session.changingNickname = false;
  }
}

// ==================== SET BIO BUTTON ====================
bot.action('set_bio', async (ctx) => {
  await ctx.reply('📝 *Enter your bio:*\n\nDescribe yourself in a few words (max 100 characters)', { parse_mode: 'Markdown' });
  ctx.session.changingBio = true;
  await ctx.answerCbQuery();
});

async function handleBioChange(ctx, bio) {
  const userId = ctx.from.id;
  
  if (!bio || bio.trim().length === 0) {
    await ctx.reply('❌ Bio cannot be empty.');
    ctx.session.changingBio = false;
    return;
  }

  if (bio.length > 100) {
    await ctx.reply('❌ Bio too long. Maximum 100 characters.');
    ctx.session.changingBio = false;
    return;
  }

  try {
    await db.collection('users').doc(userId.toString()).update({
      bio: bio.trim(),
      lastSeen: new Date().toISOString()
    });

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Back to Profile', 'show_profile')]
    ]);

    await ctx.replyWithMarkdown(`✅ *Bio updated!*\n\nYour new bio: "${bio.trim()}"`, keyboard);
    ctx.session.changingBio = false;
  } catch (error) {
    console.error('Bio error:', error);
    await ctx.reply('❌ Error updating bio');
    ctx.session.changingBio = false;
  }
}

// ==================== CHANGE EMOJI BUTTON ====================
bot.action('change_emoji', async (ctx) => {
  const emojiText = `🎭 *Choose Profile Emoji*\n\nSelect an emoji for your profile:`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⭐ Star', 'set_emoji_⭐'), Markup.button.callback('🔥 Fire', 'set_emoji_🔥')],
    [Markup.button.callback('🎯 Target', 'set_emoji_🎯'), Markup.button.callback('🌟 Glow', 'set_emoji_🌟')],
    [Markup.button.callback('💫 Sparkle', 'set_emoji_💫'), Markup.button.callback('🦋 Butterfly', 'set_emoji_🦋')],
    [Markup.button.callback('🚀 Rocket', 'set_emoji_🚀'), Markup.button.callback('🎨 Artist', 'set_emoji_🎨')],
    [Markup.button.callback('❌ Remove Emoji', 'set_emoji_None')],
    [Markup.button.callback('🔙 Back', 'edit_profile')]
  ]);

  await ctx.editMessageText(emojiText, { 
    parse_mode: 'Markdown',
    reply_markup: keyboard.reply_markup 
  });
  await ctx.answerCbQuery();
});

// ==================== SET EMOJI BUTTONS ====================
bot.action(/set_emoji_(.+)/, async (ctx) => {
  const emoji = ctx.match[1];
  const userId = ctx.from.id;

  try {
    await db.collection('users').doc(userId.toString()).update({
      profileEmoji: emoji,
      lastSeen: new Date().toISOString()
    });

    const successText = emoji === 'None' ? 
      '✅ Emoji removed from your profile!' : 
      `✅ Profile emoji set to: ${emoji}`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Back to Profile', 'show_profile')]
    ]);

    await ctx.editMessageText(successText, { reply_markup: keyboard.reply_markup });
    await ctx.answerCbQuery('✅ Emoji updated!');
  } catch (error) {
    console.error('Emoji error:', error);
    await ctx.answerCbQuery('❌ Error updating emoji');
  }
});

// ==================== PRIVACY SETTINGS BUTTON ====================
bot.action('privacy_settings', async (ctx) => {
  const userId = ctx.from.id;
  
  try {
    const userDoc = await db.collection('users').doc(userId.toString()).get();
    if (!userDoc.exists) {
      await ctx.answerCbQuery('❌ User not found');
      return;
    }

    const user = userDoc.data();
    const privacyText = `👁️ *Privacy Settings*\n\nControl what others can see:\n\n` +
      `${user.privacySettings.showConfessions ? '✅' : '❌'} My Confessions\n` +
      `${user.privacySettings.showComments ? '✅' : '❌'} My Comments\n` +
      `${user.privacySettings.showFollowing ? '✅' : '❌'} Who I Follow\n` +
      `${user.privacySettings.showFollowers ? '✅' : '❌'} My Followers\n` +
      `${user.privacySettings.allowChats ? '✅' : '❌'} Allow Chat Requests`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('👁️ Toggle Confessions', 'toggle_confessions')],
    [Markup.button.callback('💬 Toggle Comments', 'toggle_comments')],
    [Markup.button.callback('👥 Toggle Following', 'toggle_following')],
    [Markup.button.callback('📢 Toggle Followers', 'toggle_followers')],
    [Markup.button.callback('🔒 Toggle Chats', 'toggle_chat_requests')],
    [Markup.button.callback('🔙 Back', 'edit_profile')]
  ]);

    await ctx.editMessageText(privacyText, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard.reply_markup 
    });
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Privacy error:', error);
    await ctx.answerCbQuery('❌ Error loading privacy settings');
  }
});

// ==================== TOGGLE BUTTONS ====================
const toggleButtons = {
  'toggle_confessions': 'showConfessions',
  'toggle_comments': 'showComments', 
  'toggle_following': 'showFollowing',
  'toggle_followers': 'showFollowers',
  'toggle_chat_requests': 'allowChats'
};

for (const [action, setting] of Object.entries(toggleButtons)) {
  bot.action(action, async (ctx) => {
    const userId = ctx.from.id;
    
    try {
      const userDoc = await db.collection('users').doc(userId.toString()).get();
      if (userDoc.exists) {
        const user = userDoc.data();
        const newValue = !user.privacySettings[setting];
        
        await db.collection('users').doc(userId.toString()).update({
          [`privacySettings.${setting}`]: newValue,
          lastSeen: new Date().toISOString()
        });

        await ctx.answerCbQuery(newValue ? '✅ Enabled' : '❌ Disabled');
        // Refresh privacy settings
        await bot.action('privacy_settings', ctx);
      }
    } catch (error) {
      console.error('Toggle error:', error);
      await ctx.answerCbQuery('❌ Error updating setting');
    }
  });
}

// ==================== CHANNEL POSTING ====================
async function postToChannel(text, number, hashtags = []) {
  const channelId = process.env.CHANNEL_ID;
  
  const hashtagString = hashtags.length > 0 ? `\n\n${hashtags.join(' ')}` : '';
  const message = `#${number}\n\n${text}${hashtagString}\n\n[ 👁️‍🗨️ View/Add Comments (0) ]`;

  try {
    await bot.telegram.sendMessage(channelId, message);
    console.log(`✅ Confession #${number} posted to channel`);
  } catch (error) {
    console.error('Channel post error:', error);
  }
}

// ==================== USER NOTIFICATION ====================
async function notifyUser(userId, number, status, reason = '') {
  try {
    let message = '';
    if (status === 'approved') {
      message = `🎉 *Your Confession #${number} was approved!*\n\n` +
        `It has been posted to the channel. People can now view and comment on it!\n\n` +
        `Thank you for sharing! 💖`;
    } else {
      message = `❌ *Confession Not Approved*\n\n` +
        `*Reason:* ${reason}\n\n` +
        `You can submit a new confession following the guidelines.`;
    }

    await bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('User notify error:', error);
  }
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
